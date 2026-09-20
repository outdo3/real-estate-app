/**
 * BUILDING_LEDGER_PAGINATION_FIX_V1 §2 — 건축물대장 API의 실제 페이징 계약을 읽기 전용으로 확인한다.
 *
 * 확인 항목: pageNo 유무에 따른 반환 건수 · numOfRows 반영 여부 · totalCount · 빈 페이지 ·
 * 최대 페이지 크기 · 중복 가능성 · 정렬 안정성.
 *
 * DB write 0 · 외부는 조회(GET)만.
 *
 *   npx tsx scripts/audit-building-ledger-paging-contract.ts [--lawd=26350 --bjdong=10500 --bun=1104 --ji=0001]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

const OUT = path.resolve(__dirname, '../tmp/building-ledger-paging');
const BASE = 'https://apis.data.go.kr/1613000/BldRgstHubService';

const key = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));

async function call(op: string, q: Record<string, string | number>) {
  const params = Object.entries(q).map(([k, v]) => `${k}=${v}`).join('&');
  const url = `${BASE}/${op}?serviceKey=${key()}&${params}&_type=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return { http: res.status, error: `http=${res.status}` };
  const j = await res.json();
  const b = j?.response?.body;
  const raw = b?.items?.item;
  const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  return {
    http: res.status,
    resultCode: j?.response?.header?.resultCode ?? null,
    totalCount: b?.totalCount ?? null,
    numOfRows: b?.numOfRows ?? null,
    pageNo: b?.pageNo ?? null,
    itemCount: items.length,
    pks: items.map((i: any) => String(i?.mgmBldrgstPk ?? i?.mgmUpBldrgstPk ?? '')).filter(Boolean),
    dongNms: items.map((i: any) => String(i?.dongNm ?? '')),
    hhld: items.map((i: any) => Number(i?.hhldCnt ?? 0)),
  };
}

async function main() {
  const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
  const lawd = arg('lawd', '26350'), bjdong = arg('bjdong', '10500'), bun = arg('bun', '1104'), ji = arg('ji', '0001');
  const lot = { sigunguCd: lawd, bjdongCd: bjdong, platGbCd: 0, bun: bun.padStart(4, '0'), ji: ji.padStart(4, '0') };
  const out: Record<string, unknown> = { at: new Date().toISOString(), readOnly: true, dbWrites: 0, lot };

  for (const op of ['getBrTitleInfo', 'getBrRecapTitleInfo']) {
    const probes: Record<string, unknown> = {};
    // A. 운영 라이브 helper와 같은 호출 — pageNo 없음
    probes['noPageNo_numOfRows5'] = await call(op, { ...lot, numOfRows: 5 });
    // B. pageNo만 붙임
    probes['pageNo1_numOfRows5'] = await call(op, { ...lot, numOfRows: 5, pageNo: 1 });
    // C. STRICT와 같은 호출
    probes['pageNo1_numOfRows100'] = await call(op, { ...lot, numOfRows: 100, pageNo: 1 });
    // D. 페이지 경계 — 1건씩 3페이지
    probes['pageNo1_numOfRows1'] = await call(op, { ...lot, numOfRows: 1, pageNo: 1 });
    probes['pageNo2_numOfRows1'] = await call(op, { ...lot, numOfRows: 1, pageNo: 2 });
    probes['pageNo3_numOfRows1'] = await call(op, { ...lot, numOfRows: 1, pageNo: 3 });
    // E. 범위 밖 페이지(빈 페이지 동작)
    probes['pageNo999_numOfRows100'] = await call(op, { ...lot, numOfRows: 100, pageNo: 999 });
    // F. 정렬 안정성 — 같은 호출 2회
    probes['repeat_pageNo1_numOfRows100'] = await call(op, { ...lot, numOfRows: 100, pageNo: 1 });
    out[op] = probes;
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `contract-${lawd}-${bjdong}-${bun}-${ji}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
