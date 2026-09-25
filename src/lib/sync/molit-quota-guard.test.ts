import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CRON_MOLIT_QUOTA_RESERVE, kstDateOf, molitQuotaDecision } from './molit-quota-guard';
import { fetchSaleRegionMonth, saleQuotaObserved } from '../../../scripts/sale-molit-fetch';

// GYEONGGI_CRON_EXPANSION_V1 — cron 공통 MOLIT 예약분 가드.

const ROOT = resolve(__dirname, '../../..');
const code = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const NOW = Date.parse('2026-09-26T04:30:00+09:00');

test('경계: remaining 2001 → 진행 · 2000 → 중단 · 1999 → 중단 (예약분 2,000)', () => {
  assert.equal(CRON_MOLIT_QUOTA_RESERVE, 2000);
  assert.deepEqual(molitQuotaDecision({ remaining: 2001, at: NOW }, NOW), { proceed: true, reason: 'ABOVE_RESERVE', remaining: 2001 });
  assert.deepEqual(molitQuotaDecision({ remaining: 2000, at: NOW }, NOW), { proceed: false, reason: 'QUOTA_RESERVE_REACHED', remaining: 2000 });
  assert.deepEqual(molitQuotaDecision({ remaining: 1999, at: NOW }, NOW), { proceed: false, reason: 'QUOTA_RESERVE_REACHED', remaining: 1999 });
  assert.equal(molitQuotaDecision({ remaining: 0, at: NOW }, NOW).proceed, false);
});

test('모르면 지어내지 않는다: 관측 없음 → 진행(한도를 묻는 요청을 따로 보내지 않는다)', () => {
  assert.deepEqual(molitQuotaDecision({ remaining: null, at: null }, NOW), { proceed: true, reason: 'UNKNOWN', remaining: null });
  assert.deepEqual(molitQuotaDecision({ remaining: Number.NaN, at: NOW }, NOW), { proceed: true, reason: 'UNKNOWN', remaining: null });
});

test('다음 날(KST) 재개: 어제 관측한 낮은 한도로 오늘 실행을 막지 않는다', () => {
  const yesterday = Date.parse('2026-09-25T23:59:00+09:00');
  const today = Date.parse('2026-09-26T00:01:00+09:00');
  assert.equal(kstDateOf(yesterday), '2026-09-25');
  assert.equal(kstDateOf(today), '2026-09-26');
  assert.deepEqual(molitQuotaDecision({ remaining: 150, at: yesterday }, today), { proceed: true, reason: 'STALE_OTHER_KST_DAY', remaining: null });
  // 같은 KST 날짜(UTC로는 전날)면 그대로 적용
  const earlyKst = Date.parse('2026-09-26T00:30:00+09:00');
  assert.equal(molitQuotaDecision({ remaining: 150, at: earlyKst }, today + 3600_000).proceed, false);
});

function molitXml(totalCount: number) {
  const items = Array.from({ length: totalCount }, (_, i) =>
    `<item><aptNm>테스트${i}</aptNm><umdNm>정자동</umdNm><dealAmount>10,000</dealAmount><dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>1</dealDay><excluUseAr>84</excluUseAr><floor>3</floor><aptSeq>41111-1</aptSeq><sggCd>41111</sggCd></item>`).join('');
  return `<?xml version="1.0"?><response><header><resultCode>00</resultCode><resultMsg>OK</resultMsg></header><body><items>${items}</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${totalCount}</totalCount></body></response>`;
}

test('fetcher: 예약분이면 요청 0회 + 재시도 0회, 셀은 INVALID(쓰지 않음)로 quotaReserveReached', async () => {
  const realFetch = globalThis.fetch;
  process.env.DATA_GO_KR_API_KEY = process.env.DATA_GO_KR_API_KEY || 'test-key';
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(molitXml(1), { headers: { 'x-ratelimit-remaining': '2000' } }); }) as typeof fetch;
  try {
    // 2001 → 요청 1회 허용, 응답 헤더가 2000을 알려 준다
    saleQuotaObserved.remaining = 2001;
    saleQuotaObserved.at = Date.now();
    const ok = await fetchSaleRegionMonth('41111', '202609');
    assert.equal(calls, 1);
    assert.equal(ok.status, 'COMPLETE');
    assert.equal(ok.quotaReserveReached, false);
    assert.equal(saleQuotaObserved.remaining, 2000);
    // 이제 2000 → 다음 셀은 요청하지 않는다(재시도로 한도를 쓰지도 않는다)
    const stopped = await fetchSaleRegionMonth('41111', '202608');
    assert.equal(calls, 1, '예약분인데 요청을 보냈다');
    assert.equal(stopped.status, 'INVALID');
    assert.equal(stopped.quotaReserveReached, true);
    assert.equal(stopped.collectedCount, 0);
  } finally {
    globalThis.fetch = realFetch;
    saleQuotaObserved.remaining = null;
    saleQuotaObserved.at = null;
  }
});

test('cron 코어: 셀을 시작하기 전에 확인하고, 예약분이면 안전하게 멈춘다(PARTIAL_RUN · 쓰지 않음 · coverage 미기록)', () => {
  // 이 파일은 'text/xml, */*' 문자열 때문에 주석 제거 정규식이 잘못 자른다 — 원문으로 본다.
  const fetcher = readFileSync(resolve(ROOT, 'scripts/sale-molit-fetch.ts'), 'utf8');
  const onePage = fetcher.slice(fetcher.indexOf('async function fetchOnePage('), fetcher.indexOf('async function fetchOnePageWithRetry('));
  assert.ok(onePage.indexOf('saleQuotaDecision().proceed') < onePage.indexOf('await fetch(url'), '요청 뒤에 확인한다');
  assert.ok(/if \(last\.quotaStopped\) return last;/.test(fetcher), '예약분 정지 후에도 재시도한다');

  for (const p of ['src/lib/sync/sale-sync-core.ts', 'src/lib/sync/sale-recheck-core.ts']) {
    const core = code(p);
    const g = core.indexOf('const quota = saleQuotaDecision();');
    assert.ok(g > 0, `${p}: 셀 전 확인이 없다`);
    assert.ok(g < core.indexOf('await syncOneSaleCell('), `${p}: 셀 요청 뒤에 확인한다`);
    assert.ok(/QUOTA_RESERVE_REACHED/.test(core), `${p}: 정지 로그가 없다`);
    // 셀 도중 정지한 결과는 reports/coverage에 넣지 않고 멈춘다(다음 실행이 그 셀부터)
    const during = core.indexOf('if (report.quotaReserveReached) {');
    assert.ok(during > 0 && during < core.indexOf('reports.push(report);'), `${p}: 도중 정지 셀을 기록한다`);
    assert.ok(/status = 'PARTIAL_RUN'/.test(core));
    assert.ok(/quotaReserveReached: quotaStopped,/.test(core), `${p}: 요약에 정지 여부가 없다`);
  }
  // 예산 정지 규칙은 그대로(부분 sweep은 정상, 셀 0개일 때만 PARTIAL_RUN)
  assert.ok(/if \(reports\.length === 0\) status = 'PARTIAL_RUN';/.test(code('src/lib/sync/sale-recheck-core.ts')));
  assert.ok(/sweepComplete: !budgetExhausted && !quotaStopped && reports\.length === cells\.length,/.test(code('src/lib/sync/sale-recheck-core.ts')));
});

test('시간 예산·페이지 크기는 바뀌지 않았다(sale 50s · recheck 45s · 셀 여유 2.5s · 1,000행/쪽 · 350ms 간격)', () => {
  assert.ok(/new TimeBudget\(opts\.budgetMs \?\? 50_000\)/.test(code('src/lib/sync/sale-sync-core.ts')));
  assert.ok(/new TimeBudget\(opts\.budgetMs \?\? 45_000\)/.test(code('src/lib/sync/sale-recheck-core.ts')));
  const fetcher = readFileSync(resolve(ROOT, 'scripts/sale-molit-fetch.ts'), 'utf8');
  assert.ok(/const PAGE_SIZE = 1000;/.test(fetcher));
  assert.ok(/const MIN_INTERVAL_MS = 350;/.test(fetcher));
  assert.ok(/for \(let page = 2; page <= totalPages; page\+\+\)/.test(fetcher), 'pagination 루프가 바뀌었다');
});
