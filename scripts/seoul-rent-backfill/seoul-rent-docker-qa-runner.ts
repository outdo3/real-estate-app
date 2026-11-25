/**
 * E-JIP 서울 V3.4-R — 로컬 Docker PostgreSQL 격리 환경 실제 적재 검증 러너
 *
 * 대상 DB: 로컬 Docker PostgreSQL (127.0.0.1:54332 / ejip_seoul_rent_qa)
 * 드라이버: 패키지 추가 없이 docker exec psql stdin 파이프 직접 연동 (명령줄 길이 제한 방지)
 * 안전 조건:
 * - 운영 Supabase DB 접속 일체 차단
 * - 종로구 202610 원천 데이터 1회 확보 후 tmp/qa-seoul-rent/에 저장 (캐시 재사용, 추가 API 호출 0회)
 * - 실제 INSERT, 재실행 중복 방지, Option E 가드, Checkpoint, DB 용량 실측
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { XMLParser } from 'fast-xml-parser';
import {
  RawMolitRentItem,
  classifyRentType,
  normalizeMolitRentItemsToRentRows,
  RentRowInput,
} from '../rent-trade-history/rent-history-logic';
import {
  planRentCellWrites,
  RentComparableRow,
} from '../rent-trade-history/rent-group-guard-logic';
import { evaluateDbEnvironment } from './seoul-rent-isolated-db-check';

// 환경변수 로드
dotenv.config({ path: path.resolve(process.cwd(), '../../.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
const LAWD_CD = '11110';
const DEAL_YMD = '202610';

const CONTAINER_NAME = 'ejip-seoul-rent-qa';
const DB_USER = 'qa_tester';
const DB_NAME = 'ejip_seoul_rent_qa';

const QA_DIR = path.resolve(process.cwd(), 'tmp/qa-seoul-rent');
const RAW_CACHE_FILE = path.join(QA_DIR, 'jongno-202610-raw.json');
const NORM_CACHE_FILE = path.join(QA_DIR, 'jongno-202610-normalized.json');

export interface FullQaVerificationResult {
  dbEnvironmentCheck: {
    host: string;
    isIsolated: boolean;
    status: string;
  };
  molitFetchResult: {
    fromCache: boolean;
    totalCount: number;
    returnedCount: number;
    jeonseCount: number;
    wolseCount: number;
    aptSeqMissingCount: number;
  };
  firstInsertResult: {
    insertedCount: number;
    totalRowsInDb: number;
  };
  reexecutionResult: {
    plannedInserts: number;
    unchangedCount: number;
    totalRowsInDbAfterRerun: number;
    isDuplicatePrevented: boolean;
  };
  naturalKeyIntegrityResult: {
    hasDuplicateKey: boolean;
    occurrenceMaxIndex: number;
    siblingTradeCount: number;
  };
  optionEGuardResult: {
    detectedDiffCount: number;
    guardedGroupsCount: number;
    skippedInsertsCount: number;
    isGuardTriggeredSafely: boolean;
  };
  dbCapacityMetrics: {
    totalTableSize: string;
    tableDataSize: string;
    indexesSize: string;
    estimatedBytesPerRow: number;
  };
  queryVerification: {
    jeonseDbCount: number;
    wolseDbCount: number;
    sampleApartmentsCount: number;
  };
}

/**
 * Docker psql SQL 실행 헬퍼 (stdin 스트리밍 방식, Windows 명령줄 길이 제한 원천 해결)
 */
export function execPsql(sql: string): string {
  const cmd = `docker exec -i ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -t -A`;
  return execSync(cmd, {
    input: sql,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

/**
 * Docker psql JSON 쿼리 실행 헬퍼
 */
export function execPsqlJson<T = any>(sql: string): T {
  const jsonWrapped = `SELECT json_agg(t) FROM (${sql}) t;`;
  const raw = execPsql(jsonWrapped);
  if (!raw || raw === '' || raw === 'null') return [] as unknown as T;
  return JSON.parse(raw) as T;
}

async function fetchOrLoadRawData(): Promise<{ items: RawMolitRentItem[]; fromCache: boolean; totalCount: number }> {
  if (!fs.existsSync(QA_DIR)) {
    fs.mkdirSync(QA_DIR, { recursive: true });
  }

  if (fs.existsSync(RAW_CACHE_FILE)) {
    const cached = JSON.parse(fs.readFileSync(RAW_CACHE_FILE, 'utf-8'));
    return { items: cached.items, fromCache: true, totalCount: cached.totalCount };
  }

  // 1회 호출
  const rawApiKey = process.env.DATA_GO_KR_API_KEY;
  if (!rawApiKey) throw new Error('DATA_GO_KR_API_KEY is not defined.');

  const cleanKey = rawApiKey.trim().replace(/['"]/g, '');
  const decodedKey = decodeURIComponent(cleanKey);
  const finalKey = encodeURIComponent(decodedKey);
  const url = `${ENDPOINT}?serviceKey=${finalKey}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${DEAL_YMD}&pageNo=1&numOfRows=1000`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const textData = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const jsonObj = parser.parse(textData);

  const body = jsonObj?.response?.body;
  const totalCount = Number(body?.totalCount ?? 0);
  const rawItemsNode = body?.items?.item;
  const rawItems: RawMolitRentItem[] = rawItemsNode
    ? Array.isArray(rawItemsNode)
      ? rawItemsNode
      : [rawItemsNode]
    : [];

  // 캐시 저장
  fs.writeFileSync(RAW_CACHE_FILE, JSON.stringify({ totalCount, items: rawItems }, null, 2), 'utf-8');

  return { items: rawItems, fromCache: false, totalCount };
}

export async function runDockerQaVerification(): Promise<FullQaVerificationResult> {
  // 1. 격리 DB 안전 진단
  const testDbUrl = `postgresql://${DB_USER}:***@127.0.0.1:54332/${DB_NAME}`;
  const envCheck = evaluateDbEnvironment(testDbUrl);
  if (!envCheck.hasIsolatedDb || envCheck.isOperationalHost) {
    throw new Error(`[SAFETY_BLOCK] Target database is not a verified isolated DB: ${envCheck.reason}`);
  }

  // 2. 데이터 확보 (캐시 또는 1회 호출)
  const { items: rawItems, fromCache, totalCount } = await fetchOrLoadRawData();

  // 통계 계산
  let jeonseCount = 0;
  let wolseCount = 0;
  let aptSeqMissingCount = 0;
  for (const it of rawItems) {
    const rent = it.monthlyRent != null ? parseInt(String(it.monthlyRent).replace(/,/g, ''), 10) || 0 : 0;
    if (classifyRentType(rent) === 'jeonse') jeonseCount++;
    else wolseCount++;
    if (!it.aptSeq) aptSeqMissingCount++;
  }

  // 정규화
  const normResult = normalizeMolitRentItemsToRentRows(rawItems, LAWD_CD, DEAL_YMD);
  const sourceRows = normResult.rows;

  // 캐시 저장
  fs.writeFileSync(NORM_CACHE_FILE, JSON.stringify(sourceRows, null, 2), 'utf-8');

  // 3. PostgreSQL 테이블 비우기 (초기화)
  execPsql('TRUNCATE TABLE apartment_rent_histories RESTART IDENTITY;');

  // 4. 1차 최초 INSERT 실행 (stdin으로 전체 SQL 스트리밍)
  const insertStatements: string[] = [];
  for (const r of sourceRows) {
    const aptSeqVal = r.aptSeq ? `'${r.aptSeq.replace(/'/g, "''")}'` : 'NULL';
    const jibunVal = r.jibun ? `'${r.jibun.replace(/'/g, "''")}'` : 'NULL';
    const floorVal = r.floor != null ? r.floor : 'NULL';
    const buildYearVal = r.buildYear != null ? r.buildYear : 'NULL';
    const contractTypeVal = r.contractType ? `'${r.contractType.replace(/'/g, "''")}'` : 'NULL';
    const contractTermVal = r.contractTerm ? `'${r.contractTerm.replace(/'/g, "''")}'` : 'NULL';
    const preDepositVal = r.preDeposit != null ? r.preDeposit : 'NULL';
    const preMonthlyRentVal = r.preMonthlyRent != null ? r.preMonthlyRent : 'NULL';
    const useRenewalRightVal = r.useRenewalRight != null ? (r.useRenewalRight ? 'TRUE' : 'FALSE') : 'NULL';

    insertStatements.push(`(
      'MOLIT_APT_RENT', '${r.lawdCd}', '${r.dealYmd}', ${aptSeqVal},
      '${r.identityKey.replace(/'/g, "''")}', '${r.dealType}', '${r.groupKeyStr.replace(/'/g, "''")}',
      '${r.aptName.replace(/'/g, "''")}', '${r.dong.replace(/'/g, "''")}', ${jibunVal},
      ${r.exclusiveArea}, ${r.deposit}, ${r.monthlyRent},
      ${r.dealYear}, ${r.dealMonth}, ${r.dealDay}, '${r.dealDate}',
      ${floorVal}, ${buildYearVal}, ${contractTypeVal}, ${contractTermVal},
      ${preDepositVal}, ${preMonthlyRentVal}, ${useRenewalRightVal}, ${r.occurrenceIndex}
    )`);
  }

  const insertSql = `INSERT INTO apartment_rent_histories (
    source, lawd_cd, deal_ymd, apt_seq, identity_key, deal_type, group_key,
    apt_name, dong, jibun, exclusive_area, deposit, monthly_rent,
    deal_year, deal_month, deal_day, deal_date, floor, build_year,
    contract_type, contract_term, pre_deposit, pre_monthly_rent,
    use_renewal_right, occurrence_index
  ) VALUES \n${insertStatements.join(',\n')};`;

  execPsql(insertSql);

  const countRaw1 = execPsql('SELECT COUNT(*)::int FROM apartment_rent_histories;');
  const totalRowsInDb = parseInt(countRaw1, 10);

  // 5. 2차 동일 데이터 재실행 시뮬레이션
  // DB에서 데이터 조회
  const existingRows = execPsqlJson<RentComparableRow[]>(`
    SELECT group_key AS "groupKeyStr", deposit, monthly_rent AS "monthlyRent",
           deal_date::text AS "dealDate", floor, occurrence_index AS "occurrenceIndex",
           apt_name AS "aptName", dong, jibun, build_year AS "buildYear",
           contract_type AS "contractType", contract_term AS "contractTerm",
           pre_deposit AS "preDeposit", pre_monthly_rent AS "preMonthlyRent",
           use_renewal_right AS "useRenewalRight"
    FROM apartment_rent_histories WHERE lawd_cd = '${LAWD_CD}' AND deal_ymd = '${DEAL_YMD}'
  `).map((r) => ({
    ...r,
    dealDate: r.dealDate.slice(0, 10),
  }));

  const rerunPlan = planRentCellWrites(sourceRows as unknown as RentComparableRow[], existingRows);

  const countRaw2 = execPsql('SELECT COUNT(*)::int FROM apartment_rent_histories;');
  const totalRowsInDbAfterRerun = parseInt(countRaw2, 10);

  // 6. 자연키 충돌 및 occurrenceIndex 검증
  const dupCheck = execPsqlJson<any[]>(`
    SELECT group_key, deposit, monthly_rent, deal_date, floor, occurrence_index, COUNT(*) 
    FROM apartment_rent_histories 
    GROUP BY group_key, deposit, monthly_rent, deal_date, floor, occurrence_index 
    HAVING COUNT(*) > 1
  `);

  let occurrenceMaxIndex = 0;
  let siblingTradeCount = 0;
  for (const r of sourceRows) {
    if (r.occurrenceIndex > occurrenceMaxIndex) occurrenceMaxIndex = r.occurrenceIndex;
    if (r.occurrenceIndex > 0) siblingTradeCount++;
  }

  // 7. Option E 그룹 가드 검증 (1건의 서술 필드 불일치 시뮬레이션)
  const modifiedExisting = existingRows.map((r, idx) => {
    if (idx === 0) {
      return { ...r, contractTerm: '26.10~27.10' };
    }
    return r;
  });
  const guardPlan = planRentCellWrites(sourceRows as unknown as RentComparableRow[], modifiedExisting);

  // 8. DB 용량 측정
  const sizeData = execPsqlJson<any[]>(`
    SELECT 
      pg_size_pretty(pg_total_relation_size('apartment_rent_histories')) AS total_size,
      pg_size_pretty(pg_relation_size('apartment_rent_histories')) AS table_size,
      pg_size_pretty(pg_indexes_size('apartment_rent_histories')) AS index_size,
      pg_total_relation_size('apartment_rent_histories') AS total_bytes
  `)[0];

  const totalTableSize = sizeData.total_size;
  const tableDataSize = sizeData.table_size;
  const indexesSize = sizeData.index_size;
  const estimatedBytesPerRow = Math.round(Number(sizeData.total_bytes) / totalRowsInDb);

  // 9. 실서비스 조회 경로 검증
  const queryData = execPsqlJson<any[]>(`
    SELECT 
      COUNT(*) FILTER (WHERE deal_type = 'jeonse')::int AS jeonse_count,
      COUNT(*) FILTER (WHERE deal_type = 'wolse')::int AS wolse_count,
      COUNT(DISTINCT apt_seq)::int AS apt_count
    FROM apartment_rent_histories
    WHERE lawd_cd = '${LAWD_CD}' AND deal_ymd = '${DEAL_YMD}'
  `)[0];

  return {
    dbEnvironmentCheck: {
      host: envCheck.dbHost!,
      isIsolated: envCheck.hasIsolatedDb,
      status: envCheck.status,
    },
    molitFetchResult: {
      fromCache,
      totalCount,
      returnedCount: rawItems.length,
      jeonseCount,
      wolseCount,
      aptSeqMissingCount,
    },
    firstInsertResult: {
      insertedCount: sourceRows.length,
      totalRowsInDb,
    },
    reexecutionResult: {
      plannedInserts: rerunPlan.inserts.length,
      unchangedCount: rerunPlan.unchanged,
      totalRowsInDbAfterRerun,
      isDuplicatePrevented: rerunPlan.inserts.length === 0 && totalRowsInDbAfterRerun === totalRowsInDb,
    },
    naturalKeyIntegrityResult: {
      hasDuplicateKey: dupCheck.length > 0,
      occurrenceMaxIndex,
      siblingTradeCount,
    },
    optionEGuardResult: {
      detectedDiffCount: guardPlan.reviewDiffs.length,
      guardedGroupsCount: guardPlan.guardedGroups.length,
      skippedInsertsCount: guardPlan.skippedInserts.length,
      isGuardTriggeredSafely: guardPlan.guardedGroups.length > 0,
    },
    dbCapacityMetrics: {
      totalTableSize,
      tableDataSize,
      indexesSize,
      estimatedBytesPerRow,
    },
    queryVerification: {
      jeonseDbCount: Number(queryData.jeonse_count),
      wolseDbCount: Number(queryData.wolse_count),
      sampleApartmentsCount: Number(queryData.apt_count),
    },
  };
}

if (require.main === module) {
  runDockerQaVerification()
    .then((result) => {
      console.log('--- DOCKER_QA_RESULT_START ---');
      console.log(JSON.stringify(result, null, 2));
      console.log('--- DOCKER_QA_RESULT_END ---');
      process.exit(0);
    })
    .catch((err) => {
      console.error('DOCKER_QA_ERROR:', err?.message || String(err));
      process.exit(1);
    });
}
