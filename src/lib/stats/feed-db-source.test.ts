import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { toFeedTrade, dedupeTrades, identityKey, areaKey, groupKey } from '../regional-feed';
import { FEED_DB_SIDO_CODE, isFeedDbBackedSido, monthRangeBounds, storedSaleToFeedRaw, storedRentToFeedRaw } from './feed-db-source';

/**
 * BUSAN_12M_STATS_PERFORMANCE_FIX_V1 — 부산 12개월 피드의 DB-first 계약.
 *
 * 고친 문제: `GET /api/stats/feed?sidoCode=26&period=12m`이 한 요청 안에서 MOLIT을
 * **384회**(16구 × 12개월 × 매매/전월세) 호출했다. 전역 스로틀(동시 6, 슬롯당 200ms)
 * 때문에 호출 수가 그대로 벽시계 시간이 되어 실측 22~25초였고, 캐시가 비는 5분마다
 * 다시 발생했다.
 *
 * 이 테스트가 막는 방향은 세 가지다:
 *   1) 느린 걸 **숨기는** 수정(TTL 늘리기 / 12개월 옵션 제거 / 로딩 문구로 덮기)
 *   2) 빨라지려고 **데이터 의미를 바꾸는** 수정(취소거래 누락, 검증 안 된 월을 DB로
 *      가장, 집계 공식·기간 경계 변경, 이름 기반 재식별)
 *   3) DB가 없는 지역(부산 외)까지 DB 경로로 보내 **빈 결과를 진짜 0건으로** 만드는 수정
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 코드·옛 수치를 인용한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROUTE = read('src/app/api/stats/feed/route.ts');
const SOURCE = read('src/lib/stats/feed-db-source.ts');
const TRADE_READ = read('src/lib/trade-history-read.ts');
const THROTTLE = read('src/lib/molit-stats-helpers.ts');

// ── A. 어느 요청이 DB 경로로 가는가 ────────────────────────────────────────────

test('DB 경로는 부산에만 적용된다 — DB에 데이터가 없는 시도는 기존 MOLIT 경로 그대로', () => {
  assert.equal(FEED_DB_SIDO_CODE, '26');
  assert.ok(isFeedDbBackedSido('26'));
  for (const other of ['11', '27', '41', '260', '2', '', ' 26', null, undefined]) {
    assert.equal(isFeedDbBackedSido(other as string | null), false, `${JSON.stringify(other)}가 DB 경로로 들어간다`);
  }
});

test('부산이 아닌 시도 전체 조회는 여전히 매매 MOLIT task를 만든다', () => {
  const code = codeOf(ROUTE);
  // 매매 task 생성이 dbBacked 여부에 걸려 있다 — 조건 자체가 사라지면(항상 생성/항상
  // 미생성) 부산 외 지역이 빈 결과가 되거나 부산이 다시 384호출로 돌아간다.
  assert.ok(/if \(!dbBacked\) tasks\.push\(\{ key: `\$\{dLawdCd\}\|apt:/.test(code), '매매 task 조건이 사라졌다');
  assert.ok(/const dbBacked = isFeedDbBackedSido\(sidoCodeParam\)/.test(code), 'DB 경로 판정이 sidoCode 기반이 아니다');
});

// ── B. 호출 수 감소가 실제로 코드에 있는가 ─────────────────────────────────────

test('부산 매매는 MOLIT을 한 번도 호출하지 않는다 — DB 소스가 MOLIT을 import하지 않는다', () => {
  const code = codeOf(SOURCE);
  assert.ok(!/api-molit|fetchMolitData|molit-stats-helpers/.test(code), 'DB 소스가 MOLIT을 끌어온다');
  // 읽는 곳은 이미 존재하는 read helper 둘뿐이다(새 원천을 만들지 않았다).
  assert.ok(/from '@\/lib\/trade-history-read'/.test(code));
  assert.ok(/from '@\/lib\/rent-history-read'/.test(code));
});

test('전월세는 검증범위 안 월만 DB로 읽는다 — 검증 안 된 월은 MOLIT 그대로', () => {
  const code = codeOf(ROUTE);
  assert.ok(/splitVerifiedMonths\(months, await getRentVerifiedRange\(\)\)/.test(code), '검증범위 분할이 없다');
  // 검증 안 된 월만 rent task가 된다.
  assert.ok(/for \(const m of rentSplit\.unverified\)/.test(code), 'unverified 월만 MOLIT으로 가지 않는다');
  // DB로는 verified 월만 넘어간다.
  assert.ok(/loadBusanFeedTradesFromDb\(lawdCds, months, rentSplit\.verified\)/.test(code), 'DB에 verified 월만 넘기지 않는다');
});

test('스로틀 정책을 건드리지 않았다 — 384개를 한꺼번에 쏘는 식으로 "빠르게" 하지 않았다', () => {
  const code = codeOf(THROTTLE);
  assert.ok(/const GLOBAL_MOLIT_CONCURRENCY = 6;/.test(code), '전역 동시성 값이 바뀌었다');
  assert.ok(/acquireMolitSlot\(\)/.test(code), '전역 세마포어가 사라졌다');
  // DB 소스도 자체 동시성 풀을 만들지 않는다(쿼리 2개 병렬이 전부).
  const src = codeOf(SOURCE);
  const parallel = (src.match(/Promise\.all\(/g) ?? []).length;
  assert.equal(parallel, 1, `DB 소스의 Promise.all이 ${parallel}개다(쿼리 병렬 1곳이어야 한다)`);
});

// ── C. 빠르게 하려고 의미를 바꾸지 않았다 ──────────────────────────────────────

test('TTL과 기간 옵션은 그대로다 — 느린 걸 숨기는 방식으로 고치지 않았다', () => {
  const code = codeOf(ROUTE);
  // 시도 전체 캐시 TTL 5분 유지(데이터 최신성 기준 무변경).
  assert.ok(/getOrSetCache\(cacheKey, 5 \* 60 \* 1000,/.test(code), 'TTL이 바뀌었다');
  assert.equal((code.match(/5 \* 60 \* 1000/g) ?? []).length, 2, '캐시 TTL 지점 수가 바뀌었다(단일 구/시도 전체 각 1회)');
  // 12개월 옵션이 그대로 살아 있다.
  assert.ok(/'12m'/.test(code), '12개월 프리셋이 사라졌다');
  assert.ok(/VALID_PRESETS: PeriodPreset\[\] = \['today', 'yesterday', '7d', 'thisWeek', 'lastWeek', '30d', '12m', 'custom'\]/.test(code),
    '기간 옵션 목록이 바뀌었다');
});

test('취소 거래를 버리지 않는다 — 피드 전용 쿼리는 취소 여부로 걸러내지 않는다', () => {
  const code = codeOf(TRADE_READ);
  const at = code.indexOf('export async function getRegionalSaleRowsForFeedFromDb');
  assert.ok(at > -1, '피드 전용 쿼리가 없다');
  const body = code.slice(at, code.indexOf('export interface YearlySaleAggregateRow'));
  assert.ok(!/deal_canceled = false/.test(body), '피드 쿼리가 취소 거래를 SQL에서 지운다');
  assert.ok(/deal_canceled as "dealCanceled"/.test(body), '취소 여부를 읽지 않는다');
  // dashboard/지도용 기존 함수는 반대로 계속 취소를 제외한다(회귀 방지).
  const dash = code.slice(code.indexOf('export async function getRegionalSaleRowsRawFromDb'), at);
  assert.ok(/deal_canceled = false/.test(dash), 'dashboard 쿼리의 취소 제외가 사라졌다');
});

test('취소 거래가 어댑터를 통과해도 살아남고 취소 플래그를 유지한다', () => {
  const raw = storedSaleToFeedRaw({
    id: 7, lawdCd: '26350', aptSeq: '26350-189', aptName: '해운대두산위브', dong: '우동',
    exclusiveArea: '84.9402', dealAmount: 58300, dealDate: new Date(Date.UTC(2026, 7, 13)), floor: 14, dealCanceled: true,
  });
  const t = toFeedTrade(raw, 'sale', '26350');
  assert.ok(t, '취소 거래가 버려졌다');
  assert.equal(t!.dealCanceled, true);
  assert.equal(t!.dealDate, '2026-08-13');
  assert.equal(t!.dealAmount, 58300);
  assert.equal(t!.aptSeq, '26350-189');
});

test('기간 경계가 MOLIT 경로와 같다 — 달 전체를 받는다(날짜로 자르지 않는다)', () => {
  const b = monthRangeBounds(['202510', '202511', '202512', '202601'])!;
  assert.equal(b.from.toISOString().slice(0, 10), '2025-10-01');
  assert.equal(b.to.toISOString().slice(0, 10), '2026-01-31');
  // 12월 경계에서 해가 넘어간다.
  const dec = monthRangeBounds(['202512'])!;
  assert.equal(dec.from.toISOString().slice(0, 10), '2025-12-01');
  assert.equal(dec.to.toISOString().slice(0, 10), '2025-12-31');
  // 입력 순서가 뒤섞여도 같은 경계가 나온다.
  const unsorted = monthRangeBounds(['202601', '202510', '202512'])!;
  assert.equal(unsorted.from.toISOString().slice(0, 10), '2025-10-01');
  assert.equal(unsorted.to.toISOString().slice(0, 10), '2026-01-31');
  assert.equal(monthRangeBounds([]), null);
});

test('전월세 타입 판정 규칙이 MOLIT 경로와 동일하다 — 월세>0이면 월세', () => {
  const base = {
    lawdCd: '26230', aptSeq: '26230-2866', aptName: '양정포레힐즈스위첸1단지', dong: '양정동',
    exclusiveArea: '84.9710', dealDate: new Date(Date.UTC(2025, 9, 25)), dealYmd: '202510', floor: 8,
    buildYear: 2024, jibun: '1-1',
  };
  const jeonse = toFeedTrade(storedRentToFeedRaw({ ...base, deposit: 40000, monthlyRent: 0, dealType: 'jeonse' }), 'jeonse', '26230')!;
  const wolse = toFeedTrade(storedRentToFeedRaw({ ...base, deposit: 5000, monthlyRent: 122, dealType: 'wolse' }), 'wolse', '26230')!;
  assert.equal(jeonse.dealType, 'jeonse');
  assert.equal(jeonse.dealAmount, 40000, '전세 보증금이 거래금액이 아니다');
  assert.equal(wolse.dealType, 'wolse');
  assert.equal(wolse.dealAmount, 5000, '월세 보증금이 거래금액이 아니다');
  // 전월세에는 취소 개념이 없다 — 기존 라이브 경로와 동일하게 항상 false다.
  assert.equal(jeonse.dealCanceled, false);
  assert.equal(wolse.dealCanceled, false);
});

test('단지 identity가 aptSeq 기준으로 유지된다 — 이름으로 재식별하지 않는다', () => {
  const t = toFeedTrade(storedSaleToFeedRaw({
    id: 1, lawdCd: '26230', aptSeq: '26230-149', aptName: '수목하우스', dong: '양정동',
    exclusiveArea: '59.9359', dealAmount: 35000, dealDate: new Date(Date.UTC(2026, 0, 5)), floor: 2, dealCanceled: false,
  }), 'sale', '26230')!;
  assert.equal(identityKey(t), 'id:26230-149');
  assert.ok(!identityKey(t).startsWith('nd:'), '이름+동 폴백으로 식별된다');
});

test('전용면적을 반올림하지 않는다 — 다른 면적이 하나로 합쳐지지 않는다', () => {
  const mk = (area: string) => toFeedTrade(storedSaleToFeedRaw({
    id: 1, lawdCd: '26350', aptSeq: '26350-1', aptName: 'A', dong: '우동',
    exclusiveArea: area, dealAmount: 50000, dealDate: new Date(Date.UTC(2026, 0, 1)), floor: 5, dealCanceled: false,
  }), 'sale', '26350')!;
  const a = mk('84.7855');
  const b = mk('84.9950');
  assert.equal(a.excluUseArea, 84.7855);
  assert.notEqual(areaKey(a), areaKey(b), '다른 전용면적이 같은 키가 됐다');
  assert.notEqual(groupKey(a), groupKey(b));
});

test('중복 제거 의미가 그대로다 — DB row도 같은 키로 접힌다', () => {
  const mk = (id: number) => toFeedTrade(storedSaleToFeedRaw({
    id, lawdCd: '26350', aptSeq: '26350-1', aptName: 'A', dong: '우동',
    exclusiveArea: '84.99', dealAmount: 50000, dealDate: new Date(Date.UTC(2026, 0, 1)), floor: 5, dealCanceled: false,
  }), 'sale', '26350')!;
  // uid가 달라도(행 id가 다름) 같은 거래 내용이면 하나로 접힌다 — MOLIT 경로와 동일.
  assert.equal(dedupeTrades([mk(1), mk(2)]).length, 1);
});

// ── D. 실패를 0이나 에러로 잘못 접지 않는다 ────────────────────────────────────

test('DB 경로에서는 전월세 한 달 실패를 전체 API 에러로 올리지 않는다', () => {
  const code = codeOf(ROUTE);
  assert.ok(/if \(!cached\.dbBacked && cached\.failedLawdCds\.length === cached\.lawdCds\.length/.test(code),
    'DB 경로에서도 MOLIT 전체 실패를 apiError로 올린다(있는 데이터를 다 숨긴다)');
  // 부분 실패는 계속 정직하게 보고한다.
  assert.ok(/partial = cached\.failedLawdCds\.length > 0;/.test(code), '부분 실패 보고가 사라졌다');
  assert.ok(/failedDistricts = cached\.failedLawdCds;/.test(code), '실패 지역 목록이 사라졌다');
});

test('DB에서 온 부분은 MOLIT 실패 판정에 섞이지 않는다', () => {
  const code = codeOf(ROUTE);
  assert.ok(/const aptFailed = !dbBacked && results\[`\$\{dLawdCd\}\|apt:\$\{m\}`\]\?\.failed;/.test(code),
    '호출하지도 않은 매매 task를 실패로 셀 수 있다');
});

// ── E. 단일 구 조회 계약은 건드리지 않았다 ─────────────────────────────────────

test('단일 구 조회 경로는 그대로다 — 이 STEP의 범위가 아니다', () => {
  const code = codeOf(ROUTE);
  assert.ok(/const rawByMonth = await getOrSetCache\(cacheKey, 5 \* 60 \* 1000,/.test(code), '단일 구 캐시가 바뀌었다');
  assert.ok(/fetchMonthsThrottled\(tasks\)/.test(code), '단일 구가 더 이상 MOLIT을 쓰지 않는다');
  assert.ok(/const MAX_LOOKBACK_MONTHS = 12;/.test(code), '단일 구 lookback이 바뀌었다');
  // §39 "API 실패 vs 거래 없음" 프로브가 그대로 있다.
  assert.ok(/typeLabel === '에러'/.test(code), 'API 실패 판별 프로브가 사라졌다');
});

test('캐시 키가 v2로 올라갔다 — 담는 값의 모양이 바뀌었기 때문이다', () => {
  const code = codeOf(ROUTE);
  assert.ok(/`stats-feed-sido:v2:\$\{sidoCodeParam\}:\$\{months\.join\(','\)\}`/.test(code), '시도 전체 캐시 키 버전이 오르지 않았다');
  // 캐시에는 조립까지 끝난 목록이 들어간다(같은 5분 안에 같은 일을 다시 하지 않는다).
  assert.ok(/return \{ trades: dedupeTrades\(trades\), failedLawdCds/.test(code), '캐시가 조립 결과를 담지 않는다');
});

// ── F. 새 인프라를 만들지 않았다 ───────────────────────────────────────────────

test('새 테이블·뷰·cron·외부 캐시를 만들지 않았다', () => {
  const code = codeOf(SOURCE) + codeOf(ROUTE);
  for (const banned of ['CREATE TABLE', 'MATERIALIZED VIEW', 'createMany', 'upsert', 'redis', 'Redis', 'cron', 'revalidate =']) {
    assert.ok(!code.includes(banned), `새 인프라/쓰기 흔적이 있다: ${banned}`);
  }
  // 읽기 전용이다 — DB 쓰기 동사가 없다.
  assert.ok(!/prisma\.\w+\.(create|update|delete|upsert)/.test(code), 'DB 쓰기가 있다');
});
