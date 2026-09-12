import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { canShowStatsEmpty, resolveStatsViewState } from './view-state';

/**
 * STATS_LOADING_STATE_UX_V1 §13 — 통계 화면의 상태 우선순위 계약.
 *
 * 사용자가 본 증상: 기간 버튼을 바꾸면 조회가 진행 중인데도
 * "부산 …, 최근 12개월 기간 내 실거래가 없어요"가 잠깐 스쳤다.
 *
 * 원인은 계산이 아니라 분기였다. `!data`(아직 안 왔다)를 `length === 0`(없다)과 한
 * 조건으로 묶어 빈 상태를 먼저 렌더했다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 코드를 그대로 인용한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FEED = read('src/components/stats/TransactionFeedView.tsx');
const CONC = read('src/components/stats/ConcentrationView.tsx');
const SUPPLY = read('src/components/stats/SupplyView.tsx');
const GAP = read('src/components/stats/GapInvestView.tsx');
const PRICE = read('src/components/stats/PriceRankingView.tsx');
const AREA84 = read('src/components/stats/Area84RankingView.tsx');
const REGION_MAP = read('src/components/stats/RegionChangeMapView.tsx');

const VIEWS = [
  ['TransactionFeedView', FEED],
  ['ConcentrationView', CONC],
  ['SupplyView', SUPPLY],
  ['GapInvestView', GAP],
  ['PriceRankingView', PRICE],
  ['Area84RankingView', AREA84],
] as const;

// ── A. 상태 우선순위(§2) ───────────────────────────────────────────────────

test('§2 최초 로딩 중에는 빈 상태가 아니다', () => {
  assert.equal(
    resolveStatsViewState({ hasResponse: false, isFetching: true, hasError: false, isEmptyResult: true }),
    'loading'
  );
});

test('§2 재조회 중에는 빈 상태가 아니다 — 응답이 있어도 fetching이면 로딩', () => {
  assert.equal(
    resolveStatsViewState({ hasResponse: true, isFetching: true, hasError: false, isEmptyResult: true }),
    'loading'
  );
});

test('§2 응답이 없으면 fetching이 아니어도 빈 상태가 아니다 — 모르는 상태를 없음으로 단정하지 않는다', () => {
  assert.equal(
    resolveStatsViewState({ hasResponse: false, isFetching: false, hasError: false, isEmptyResult: true }),
    'loading'
  );
});

test('§2 응답이 도착하고 0건일 때만 빈 상태다', () => {
  assert.equal(
    resolveStatsViewState({ hasResponse: true, isFetching: false, hasError: false, isEmptyResult: true }),
    'empty'
  );
});

test('§2 정상 데이터는 success다', () => {
  assert.equal(
    resolveStatsViewState({ hasResponse: true, isFetching: false, hasError: false, isEmptyResult: false }),
    'success'
  );
});

test('§6 오류는 빈 상태로 표현하지 않는다 — 로딩보다 먼저 판단한다', () => {
  // 조회 실패를 "없음"으로 말하지 않는다.
  assert.equal(
    resolveStatsViewState({ hasResponse: false, isFetching: false, hasError: true, isEmptyResult: true }),
    'error'
  );
  // 실패한 조회를 로딩으로 붙잡아 두면 무한 스피너가 된다.
  assert.equal(
    resolveStatsViewState({ hasResponse: false, isFetching: true, hasError: true, isEmptyResult: true }),
    'error'
  );
});

test('§5 canShowStatsEmpty는 응답 도착 + 조회 완료일 때만 true다', () => {
  assert.equal(canShowStatsEmpty({ hasResponse: true, isFetching: false, hasError: false }), true);
  assert.equal(canShowStatsEmpty({ hasResponse: false, isFetching: false, hasError: false }), false);
  assert.equal(canShowStatsEmpty({ hasResponse: true, isFetching: true, hasError: false }), false);
  assert.equal(canShowStatsEmpty({ hasResponse: true, isFetching: false, hasError: true }), false);
});

test('§12 상태 판정에 조회나 계산이 섞여 있지 않다', () => {
  const code = codeOf(read('src/lib/stats/view-state.ts'));
  for (const forbidden of ['fetch', 'useSWR', 'prisma', 'await']) {
    assert.ok(!code.includes(forbidden), `상태 판정 모듈에 ${forbidden}가 있다`);
  }
});

// ── B. false empty 형태 제거(§5) ───────────────────────────────────────────

test('§5 `!data || ...length === 0` 형태가 남아 있지 않다', () => {
  for (const [name, src] of VIEWS) {
    const code = codeOf(src);
    // 이 형태가 정확히 사용자 신고 증상을 만들었다.
    assert.ok(
      !/!data \|\|[^?]*length === 0/.test(code),
      `${name}에 false empty 형태가 남아 있다`
    );
    assert.ok(
      !/!data \|\|[^?]*totalCount === 0/.test(code),
      `${name}에 false empty 형태가 남아 있다(totalCount)`
    );
    assert.ok(
      !/!data \|\|[^?]*entries\.length/.test(code),
      `${name}에 false empty 형태가 남아 있다(entries)`
    );
  }
});

test('§5 응답이 없을 때는 로딩을 렌더한다 — 각 화면에 명시적 분기가 있다', () => {
  for (const [name, src] of VIEWS) {
    // 주석을 지우면 분기가 여러 줄로 남으므로 공백을 접어서 본다.
    const code = codeOf(src).replace(/\s+/g, ' ');
    assert.ok(/!data \? \( <InlineLoading/.test(code), `${name}에 "응답 없음 → 로딩" 분기가 없다`);
  }
});

test('§3 로딩 문구가 조회 중임을 말한다 — 빈 상태 문구와 혼동되지 않는다', () => {
  for (const [name, src] of VIEWS) {
    assert.ok(/확인하고 있어요|불러오고 있어요|불러오는 중/.test(src), `${name}에 로딩 문구가 없다`);
  }
  // 로딩 문구에 "없어요"가 섞이지 않는다.
  for (const [name, src] of VIEWS) {
    const loadingLines = (src.match(/InlineLoading message=\{?[^/]*?\/>/g) ?? []).join(' ');
    assert.ok(!/없어요/.test(loadingLines), `${name}의 로딩 문구에 빈 상태 표현이 섞였다`);
  }
});

// ── C. 보고된 화면(§1) ─────────────────────────────────────────────────────

test('§1 실거래 피드: 이전 목록이 남아 있어도 전환 중에 빈 상태가 뜨지 않는다', () => {
  const code = codeOf(FEED);
  // 예전 로딩 분기는 visibleTrades.length === 0까지 요구해, 이전 목록이 있으면
  // 로딩으로 가지 못하고 `!data`에 걸려 빈 상태가 떴다.
  assert.ok(
    !/isLoading && offset === 0 && visibleTrades\.length === 0/.test(code),
    '로딩 분기가 아직 이전 목록 유무에 묶여 있다'
  );
  // 오류 → 로딩 → (지연) → 빈 상태 순서.
  const errorAt = code.indexOf("data?.status === 'ERROR'");
  const loadingAt = code.indexOf('!data ? (');
  const emptyAt = code.indexOf('canShowStatsEmpty(');
  assert.ok(errorAt > -1 && loadingAt > -1 && emptyAt > -1, '분기를 찾지 못했다');
  assert.ok(errorAt < loadingAt, '오류가 로딩보다 뒤에 판단된다');
  assert.ok(loadingAt < emptyAt, '빈 상태가 로딩보다 먼저 판단된다');
});

test('§5 피드의 빈 상태는 공용 규칙을 통과해야 렌더된다', () => {
  assert.ok(/canShowStatsEmpty\(\{ hasResponse: true, isFetching: isLoading && offset === 0, hasError: false \}\)/.test(FEED));
});

// ── D. 캐시 적중 시 빈 목록(§5) ────────────────────────────────────────────

test('§5 누적본이 비어도 현재 응답에서 목록을 살린다 — onSuccess 미호출 경로', () => {
  // dedupingInterval 안에 같은 조건으로 돌아오면 SWR은 캐시로 응답하고 onSuccess를
  // 부르지 않는다. 조건 변경 시 누적본을 비우므로 그 순간 목록만 비어 빈 상태가 떴다.
  assert.ok(
    /const baseRows = allRows\.length > 0 \? allRows : data\?\.status === 'OK' \? data\.rows : \[\]/.test(PRICE),
    'PriceRankingView에 응답 폴백이 없다'
  );
  assert.ok(
    /const visibleRows = allRows\.length > 0 \? allRows : data\?\.status === 'OK' \? data\.rows : \[\]/.test(AREA84),
    'Area84RankingView에 응답 폴백이 없다'
  );
  // 누적본이 있으면 그 쪽이 이긴다(더보기로 쌓은 페이지를 잃지 않는다).
  assert.ok(/allRows\.length > 0 \? allRows/.test(PRICE));
  assert.ok(/allRows\.length > 0 \? allRows/.test(AREA84));
});

// ── E. 경쟁 상태 / 기간·지역 전환(§7/§8) ───────────────────────────────────

test('§7/§8 전환 시 stale 응답이 최신 선택을 덮지 않는다', () => {
  // SWR을 쓰는 화면은 키가 조건을 포함하므로 옛 키의 응답이 새 키의 data가 될 수 없다.
  for (const [name, src] of VIEWS) {
    assert.ok(/useSWR/.test(src), `${name}이 SWR을 쓰지 않는다(경쟁 보호 전제가 깨짐)`);
  }
  // 수동 fetch를 쓰는 지역 변동지도는 cancelled 가드로 막는다(기존 구조 유지).
  assert.ok(/let cancelled = false;/.test(REGION_MAP), '수동 fetch에 취소 가드가 없다');
  assert.ok(/!cancelled && setScopedData/.test(REGION_MAP), 'stale 응답이 상태를 덮을 수 있다');
});

test('§8 지역 변동지도는 조회 시작과 동시에 로딩을 켠다 — 빈 화면이 먼저 보이지 않는다', () => {
  const code = codeOf(REGION_MAP);
  const i = code.indexOf('setScopedLoading(true);');
  assert.ok(i > -1, '로딩 플래그를 켜지 않는다');
  // 데이터 초기화와 같은 배치에서 로딩이 켜져야 빈 상태가 먼저 렌더되지 않는다.
  assert.ok(code.slice(i, i + 120).includes('setScopedData(null);'));
});

// ── F. 접근성(§11) ─────────────────────────────────────────────────────────

test('§11 로딩은 role="status", 오류는 role="alert"', () => {
  const loading = read('src/components/ui/InlineLoading.tsx');
  assert.ok(/role="status"/.test(loading), '로딩에 role=status가 없다');
  const error = read('src/components/ui/ErrorState.tsx');
  assert.ok(/role="alert"/.test(error), '오류에 role=alert가 없다');
});

// ── G. 범위 밖 무변경(§15) ─────────────────────────────────────────────────

test('§15 통계 계산/조회 계약을 건드리지 않았다', () => {
  for (const [name, src] of VIEWS) {
    const code = codeOf(src);
    // 상태 분기만 바꿨다 — API 경로와 파라미터는 그대로다.
    assert.ok(/\/api\/stats\//.test(code), `${name}의 API 경로가 사라졌다`);
  }
  // 집계 helper는 그대로 쓰인다.
  assert.ok(/resolveVisibleFeed|mergeFeedPage/.test(FEED), '피드 누적 로직이 바뀌었다');
});
