/**
 * MOLIT_LIVE_PAGING_FIX_V1 §10 — 수정된 라이브 경로의 실 API 검증 (READ ONLY).
 *
 * fetchMolitData()를 그대로 호출해 1,000건 초과 셀이 전부 돌아오는지 확인한다.
 * DB 접근 0. write 0. MOLIT은 GET 조회만. serviceKey는 출력하지 않는다.
 *
 * 실행:
 *   npx tsx scripts/qa-molit-live-paging.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

// api-molit.ts는 모듈 로드 시점에 DATA_GO_KR_API_KEY를 읽는다. ESM import는 위 dotenv.config()
// 보다 먼저 평가되므로, 환경변수를 실은 뒤 동적으로 불러온다.
type DataType = 'apt' | 'rent' | 'silv' | 'officetel' | 'villa';

// expected는 MOLIT_QUOTA_SCALE_PROBE_V1이 실측한 totalCount.
const CASES: Array<{ label: string; type: DataType; lawdCd: string; dealYmd: string; expected: number; pages: number }> = [
  { label: '서울 강남구 전월세', type: 'rent', lawdCd: '11680', dealYmd: '202603', expected: 2091, pages: 3 },
  { label: '서울 송파구 전월세', type: 'rent', lawdCd: '11710', dealYmd: '202603', expected: 1873, pages: 2 },
  { label: '경기 분당구 전월세', type: 'rent', lawdCd: '41135', dealYmd: '202603', expected: 1358, pages: 2 },
  { label: '부산 해운대구 전월세', type: 'rent', lawdCd: '26350', dealYmd: '202603', expected: 714, pages: 1 },
  { label: '부산 해운대구 매매', type: 'apt', lawdCd: '26350', dealYmd: '202603', expected: 387, pages: 1 },
  { label: '부산 서구 매매', type: 'apt', lawdCd: '26140', dealYmd: '202603', expected: 117, pages: 1 },
];

async function main() {
  const { fetchMolitData } = await import('../src/lib/api-molit');
  let allPass = true;
  console.log('label\ttype\tlawdCd\tmonth\texpected\tfetched\tpages\tuniqueIds\tms\tverdict');

  for (const c of CASES) {
    const t0 = Date.now();
    const items = (await fetchMolitData({ type: c.type, lawdCd: c.lawdCd, dealYmd: c.dealYmd })) as Array<{
      id: string;
      typeLabel?: string;
      name?: string;
    }>;
    const ms = Date.now() - t0;

    const failed = items.some((i) => i.typeLabel === '에러');
    const uniqueIds = new Set(items.map((i) => i.id)).size;
    const pass = !failed && items.length === c.expected && uniqueIds === items.length;
    if (!pass) allPass = false;

    console.log(
      [
        c.label, c.type, c.lawdCd, c.dealYmd, c.expected,
        failed ? `ERROR(${items[0]?.name ?? ''})` : items.length,
        c.pages, uniqueIds, ms,
        pass ? 'PASS' : 'FAIL',
      ].join('\t')
    );
  }

  console.log(`\nVERDICT: ${allPass ? 'PASS' : 'FAIL'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(String(e?.message ?? e).replace(/serviceKey=[^&\s]*/gi, 'serviceKey=[redacted]'));
  process.exit(1);
});
