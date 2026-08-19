/**
 * STEP R4 — 국토부_전국 도시정비사업 통합 데이터(1,566건) importer.
 *
 * data.go.kr 공식 다운로드 흐름(selectFileDataDownload.do → check-limit.json →
 * fileDownload.do)을 그대로 재현해 실제 CSV를 매 실행마다 새로 받는다(R2에서 검증한
 * 흐름과 동일 — URL을 임의로 추측하지 않는다). 받은 CSV는 디스크에 저장하지 않고
 * 메모리에서만 파싱한다(대용량 원본을 저장소에 commit하지 않는다는 R4 원칙).
 *
 * 사용법:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' -r ./scripts/_register-paths.js \
 *     scripts/redevelopment/import_molit.ts [--dry-run]
 *
 * --dry-run: 다운로드/파싱/정규화/집계까지 전부 수행하고 DB에는 아무것도 쓰지 않는다.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { parseCsv } from '@/lib/redevelopment/csv';
import { parseMolitRow } from '@/lib/redevelopment/parse';
import { ingestRecord } from '@/lib/redevelopment/ingest';
import type { MolitRawRow, ParsedSourceRecord } from '@/lib/redevelopment/types';
import { prisma } from '@/lib/prisma';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

const PUBLIC_DATA_PK = '15160169';
const PUBLIC_DATA_DETAIL_PK = 'uddi:4d7f16a9-b0fd-4d07-b266-d0ad82aeaf34';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const REFERER = `https://www.data.go.kr/data/${PUBLIC_DATA_PK}/fileData.do`;

async function resolveDownloadTarget(): Promise<{ atchFileId: string; fileDetailSn: string; dataNm: string }> {
  const res = await fetch('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Referer: REFERER },
    body: new URLSearchParams({
      publicDataDetailPk: PUBLIC_DATA_DETAIL_PK,
      publicDataPk: PUBLIC_DATA_PK,
      atchFileId: '',
      fileDetailSn: '1',
      publicDataTyCode: 'PR0051',
    }),
  });
  const json = await res.json();
  if (!json.status || !json.atchFileId) {
    throw new Error(`selectFileDataDownload.do 실패: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return {
    atchFileId: json.atchFileId,
    fileDetailSn: String(json.fileDetailSn),
    dataNm: json.fileDataRegistVO?.dataNm ?? json.dataSetFileDetailInfo?.dataNm ?? '전국_도시정비사업_통합_데이터',
  };
}

async function checkLimit(atchFileId: string, fileDetailSn: string): Promise<void> {
  const res = await fetch('https://www.data.go.kr/cmm/cmm/check-limit.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Referer: REFERER },
    body: new URLSearchParams({ atchFileId, fileDetailSn }),
  });
  const json = await res.json();
  if (json.needCaptcha) {
    throw new Error('CAPTCHA_REQUIRED — 자동화로 다운로드 불가, 관리자가 브라우저로 직접 확인 필요');
  }
}

async function downloadCsv(atchFileId: string, fileDetailSn: string, dataNm: string): Promise<Buffer> {
  const url = `https://www.data.go.kr/cmm/cmm/fileDownload.do?${new URLSearchParams({ atchFileId, fileDetailSn, dataNm })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: REFERER } });
  if (!res.ok) throw new Error(`fileDownload.do HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// CP949(EUC-KR) 인코딩 — R2에서 실측 확인. Node 기본 Buffer는 cp949를 모르므로 iconv
// 없이는 완벽 디코딩이 어렵다 — 이 프로젝트에 iconv 의존성이 없어, 실제 사용되는 값은
// 전부 조합형/완성형 한글 범위 안이라는 전제로 최소 cp949→utf8 매핑 대신 Python 서브
// 프로세스에 위임하지 않고, Node 21+ TextDecoder가 지원하는 인코딩 목록에 euc-kr이
// 있어 이를 사용한다(cp949는 euc-kr의 상위호환이라 실사용 범위에서 안전).
function decodeCp949(buf: Buffer): string {
  return new TextDecoder('euc-kr').decode(buf);
}

async function fetchAndParseMolitRows(): Promise<ParsedSourceRecord[]> {
  const { atchFileId, fileDetailSn, dataNm } = await resolveDownloadTarget();
  await checkLimit(atchFileId, fileDetailSn);
  const buf = await downloadCsv(atchFileId, fileDetailSn, dataNm);
  const text = decodeCp949(buf);
  const rows = parseCsv(text);
  const [header, ...dataRows] = rows;

  const expectedHeader = ['시도', '시군구', '구역명칭', '현 사업추진단계', '사업유형', '사업시행자', '공급 예정 세대수'];
  const actualHeader = header.map((h) => h.trim());
  if (JSON.stringify(actualHeader) !== JSON.stringify(expectedHeader)) {
    throw new Error(
      `SCHEMA_IMPLEMENTATION_ADJUSTMENT — CSV 헤더가 R1/R2 실측과 다름: ${JSON.stringify(actualHeader)}`
    );
  }

  return dataRows
    .filter((r) => r.length >= 7 && r.some((c) => c.trim() !== ''))
    .map((r) => {
      const raw: MolitRawRow = {
        시도: r[0],
        시군구: r[1],
        구역명칭: r[2],
        현사업추진단계: r[3],
        사업유형: r[4],
        사업시행자: r[5],
        공급예정세대수: r[6],
      };
      return parseMolitRow(raw);
    });
}

interface ImportSummary {
  fetched: number;
  identicalDuplicateRows: number;
  conflictingDuplicateRows: number;
  conflictingDuplicateSamples: Array<{ sido: string; sigungu: string; rawName: string; values: (string | null)[] }>;
  upserted: number;
  createdProject: number;
  matchedExisting: number;
  autoMatched: number;
  reviewRequired: number;
  unmatched: number;
  unknownBusinessType: number;
  unknownStage: number;
  sidoBreakdown: Record<string, number>;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[import_molit] 시작 (dryRun=${dryRun})`);

  const parsed = await fetchAndParseMolitRows();
  console.log(`[import_molit] CSV 파싱 완료: ${parsed.length}행`);

  // fingerprint 중복 — R3B 정책상 stage/세대수는 fingerprint에 포함되지 않으므로,
  // 같은 (sido+sigungu+rawName+rawBusinessType) 조합이 여러 행으로 나타나면 전부 같은
  // SourceRecord로 흡수된다(마지막 행이 최종 raw 값을 갖는다 — upsert의 update 경로와
  // 동일 동작). identical(완전히 같은 행, R2에서 확인한 1건 포함)과 conflicting(세대수
  // 등 나머지 필드가 다른 행)을 구분해서 보고한다(섹션 17 요구사항) — conflicting은
  // "최신을 추정"하지 않고 마지막 행 값으로 덮어써진다는 사실만 정직하게 기록한다.
  const bySourceRecordId = new Map<string, ParsedSourceRecord>();
  let identicalDuplicateRows = 0;
  let conflictingDuplicateRows = 0;
  const conflictingDuplicateSamples: ImportSummary['conflictingDuplicateSamples'] = [];
  for (const rec of parsed) {
    const prior = bySourceRecordId.get(rec.sourceRecordId);
    if (prior) {
      const identical = prior.rawStage === rec.rawStage && prior.rawHouseholdCount === rec.rawHouseholdCount;
      if (identical) {
        identicalDuplicateRows++;
      } else {
        conflictingDuplicateRows++;
        conflictingDuplicateSamples.push({
          sido: rec.sido,
          sigungu: rec.sigungu,
          rawName: rec.rawName,
          values: [prior.rawHouseholdCount, rec.rawHouseholdCount],
        });
      }
    }
    bySourceRecordId.set(rec.sourceRecordId, rec);
  }
  const uniqueRecords = [...bySourceRecordId.values()];

  const summary: ImportSummary = {
    fetched: parsed.length,
    identicalDuplicateRows,
    conflictingDuplicateRows,
    conflictingDuplicateSamples,
    upserted: 0,
    createdProject: 0,
    matchedExisting: 0,
    autoMatched: 0,
    reviewRequired: 0,
    unmatched: 0,
    unknownBusinessType: uniqueRecords.filter((r) => r.businessType === 'UNKNOWN').length,
    unknownStage: uniqueRecords.filter((r) => r.stage === 'UNKNOWN').length,
    sidoBreakdown: {},
  };
  for (const r of uniqueRecords) {
    summary.sidoBreakdown[r.sido] = (summary.sidoBreakdown[r.sido] ?? 0) + 1;
  }

  if (dryRun) {
    console.log('[import_molit] DRY RUN — DB 쓰기 없음. 요약:');
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  const now = new Date();
  for (const rec of uniqueRecords) {
    const outcome = await ingestRecord(prisma as any, rec, now);
    summary.upserted++;
    if (outcome.action === 'created_project') summary.createdProject++;
    else summary.matchedExisting++;
    if (outcome.mergeStatus === 'AUTO_MATCHED') summary.autoMatched++;
    else if (outcome.mergeStatus === 'REVIEW_REQUIRED') summary.reviewRequired++;
    else summary.unmatched++;
  }

  console.log('[import_molit] 완료:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[import_molit] 실패:', err);
      process.exitCode = 1;
    });
}

export { run as importMolit, fetchAndParseMolitRows };
