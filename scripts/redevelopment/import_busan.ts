/**
 * STEP R4 — 부산광역시 정비사업 정보 API(343건) importer.
 *
 * https://apis.data.go.kr/6260000/MaintenanceBusinessStatus1/getMaintenanceBusiness1
 * numOfRows=1000으로 전체 343건을 1페이지에 받는다(R1/R2 실측 확인). 응답은 type=json을
 * 줘도 XML로 온다(재확인) — 이 프로젝트가 이미 api-molit.ts에서 쓰는 fast-xml-parser
 * 패턴을 그대로 재사용한다.
 *
 * 사용법:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' -r ./scripts/_register-paths.js \
 *     scripts/redevelopment/import_busan.ts [--dry-run]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { parseBusanRecord } from '@/lib/redevelopment/parse';
import { ingestRecord } from '@/lib/redevelopment/ingest';
import {
  fetchBusanDongRegistry,
  buildDongNameIndex,
  resolveBusanSigungu,
} from '@/lib/redevelopment/sigunguResolver';
import type { BusanRawRecord, ParsedSourceRecord } from '@/lib/redevelopment/types';
import { prisma } from '@/lib/prisma';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

const ENDPOINT = 'https://apis.data.go.kr/6260000/MaintenanceBusinessStatus1/getMaintenanceBusiness1';

async function fetchBusanRecords(): Promise<BusanRawRecord[]> {
  const apiKey = process.env.DATA_GO_KR_API_KEY;
  if (!apiKey) throw new Error('DATA_GO_KR_API_KEY가 설정되지 않았습니다 (NOT_CONFIGURED)');

  // 이 프로젝트의 기존 관례(api-molit.ts)와 동일하게, .env에 이미 URL-encode된 키가
  // 들어있을 수 있어 한 번 디코딩 후 다시 encode해 이중 인코딩을 방지한다.
  const decodedKey = decodeURIComponent(apiKey);
  const finalKey = encodeURIComponent(decodedKey);
  const url = `${ENDPOINT}?serviceKey=${finalKey}&pageNo=1&numOfRows=1000`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();

  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const parsed = parser.parse(text);

  const resultCode = parsed?.response?.header?.resultCode;
  if (resultCode !== '00' && resultCode !== 0) {
    throw new Error(`Busan API 오류: ${JSON.stringify(parsed?.response?.header ?? {}).slice(0, 300)}`);
  }

  const items = parsed?.response?.body?.items?.item;
  if (!items) return [];
  const itemsArray = Array.isArray(items) ? items : [items];

  return itemsArray.map((item: any) => {
    // parseTagValue:true라 숫자처럼 보이는 값(aCode 등)이 number로 캐스팅될 수 있어
    // 문자열로 강제한다 — aCode는 native id로 그대로 보존해야 한다("BARA_..." 접두사가
    // 있는 케이스는 안전하지만, 방어적으로 String() 처리).
    const record: BusanRawRecord = {
      ...item,
      aCode: String(item.aCode),
      areaName: String(item.areaName ?? ''),
      step: String(item.step ?? ''),
      generationJoo: item.generationJoo != null ? String(item.generationJoo) : null,
      location: item.location != null ? String(item.location) : null,
    };
    return record;
  });
}

interface ImportSummary {
  fetched: number;
  upserted: number;
  createdProject: number;
  matchedExisting: number;
  autoMatched: number;
  reviewRequired: number;
  unmatched: number;
  unknownBusinessType: number;
  unknownStage: number;
  sigunguResolved: number;
  sigunguUnresolved: number;
  sigunguResolvedButUnsafeForMatching: number;
  sigunguResolutionBySource: Record<string, number>;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[import_busan] 시작 (dryRun=${dryRun})`);

  const rawRecords = await fetchBusanRecords();
  console.log(`[import_busan] API 수신 완료: ${rawRecords.length}건`);

  // STEP R4.1 — R4의 EXPLICIT-only(148/343, 43%) 대신 REGCODE_PROXY(법정동 registry,
  // 이미 region-utils.ts가 쓰는 기존 공식 소스) + 도로명 지오코딩(bounded, office
  // 의심이면 matching에 안전하지 않다고 표시)까지 포함한 전체 resolver를 사용한다.
  const registry = await fetchBusanDongRegistry();
  const index = buildDongNameIndex(registry);
  const sigunguResolutionBySource: Record<string, number> = {};
  let sigunguResolvedButUnsafeForMatching = 0;

  const parsed: ParsedSourceRecord[] = [];
  for (const r of rawRecords) {
    const resolution = await resolveBusanSigungu(r.areaName, r.location, index);
    sigunguResolutionBySource[resolution.source] = (sigunguResolutionBySource[resolution.source] ?? 0) + 1;
    // safeForMatching=false(주로 office 의심 + 도로명 지오코딩 조합)인 경우 매칭 후보
    // 조회에 쓰이지 않도록 sigungu를 "미상"으로 남긴다(섹션 13) — sigungu 자체를 몰라서가
    // 아니라, 조합사무실이 사업구역과 다른 구에 있을 위험을 자동 매칭에 흘리지 않기 위함.
    const sigunguForMatching = resolution.sigungu && resolution.safeForMatching ? resolution.sigungu : null;
    if (resolution.sigungu && !resolution.safeForMatching) sigunguResolvedButUnsafeForMatching++;
    parsed.push(parseBusanRecord(r, '부산광역시', sigunguForMatching));
  }

  const summary: ImportSummary = {
    fetched: parsed.length,
    upserted: 0,
    createdProject: 0,
    matchedExisting: 0,
    autoMatched: 0,
    reviewRequired: 0,
    unmatched: 0,
    unknownBusinessType: parsed.filter((r) => r.businessType === 'UNKNOWN').length,
    unknownStage: parsed.filter((r) => r.stage === 'UNKNOWN').length,
    sigunguResolved: parsed.filter((r) => r.sigungu !== '미상').length,
    sigunguUnresolved: parsed.filter((r) => r.sigungu === '미상').length,
    sigunguResolvedButUnsafeForMatching,
    sigunguResolutionBySource,
  };

  if (dryRun) {
    console.log('[import_busan] DRY RUN — DB 쓰기 없음. 요약:');
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  const now = new Date();
  for (const rec of parsed) {
    const outcome = await ingestRecord(prisma as any, rec, now);
    summary.upserted++;
    if (outcome.action === 'created_project') summary.createdProject++;
    else summary.matchedExisting++;
    if (outcome.mergeStatus === 'AUTO_MATCHED') summary.autoMatched++;
    else if (outcome.mergeStatus === 'REVIEW_REQUIRED') summary.reviewRequired++;
    else summary.unmatched++;
  }

  console.log('[import_busan] 완료:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[import_busan] 실패:', err);
      process.exitCode = 1;
    });
}

export { run as importBusan, fetchBusanRecords };
