import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startOfKstDay, startOfKstDaysAgo } from '../kst-day';
import { rangeStart } from './query';

// ADMIN_ANALYTICS_DATE_PARITY_FIX_V1 §13 — 관리자 대시보드와 사용자 행동 분석이 같은
// "오늘"을 보는지 고정한다. 순수 함수만 다루므로 프로세스 TZ와 무관하게 같은 답이 나온다.

const kstMidnightOf = (isoDate: string) => new Date(`${isoDate}T00:00:00+09:00`);

// ── A~C. today 경계 ──────────────────────────────────────────────────────────

test('§A today는 KST 00:00에서 시작한다 — 대시보드의 startOfKstDay와 완전히 같은 순간', () => {
  const now = new Date('2026-09-21T07:28:33.757Z'); // 16:28 KST
  assert.equal(rangeStart('today', now).toISOString(), '2026-09-20T15:00:00.000Z');
  assert.equal(rangeStart('today', now).getTime(), startOfKstDay(now).getTime());
  assert.equal(rangeStart('today', now).toISOString(), kstMidnightOf('2026-09-21').toISOString());
});

test('§B KST 08:59 — UTC로는 아직 전날이어도 같은 KST day로 처리한다', () => {
  // 옛 구현(setHours on TZ=UTC)이라면 여기서 "오늘"이 09-20 00:00Z가 됐다.
  const now = new Date('2026-09-20T23:59:00.000Z');
  assert.equal(rangeStart('today', now).toISOString(), kstMidnightOf('2026-09-21').toISOString());
  assert.notEqual(rangeStart('today', now).toISOString(), '2026-09-20T00:00:00.000Z');
});

test('§C KST 09:00 — UTC 날짜 변경이 "오늘"을 리셋하지 않는다', () => {
  const justBefore = new Date('2026-09-20T23:59:59.999Z'); // 08:59:59.999 KST
  const justAfter = new Date('2026-09-21T00:00:00.000Z'); // 09:00:00.000 KST
  assert.equal(rangeStart('today', justBefore).getTime(), rangeStart('today', justAfter).getTime());
  // 그리고 그 순간이 바로 옛 UTC 자정이다 — 리셋이 일어나던 지점.
  assert.notEqual(rangeStart('today', justAfter).toISOString(), justAfter.toISOString());
});

// ── D~E. 7일 / 30일 달력일 계약 ──────────────────────────────────────────────

test('§D 7일 = 오늘 포함 최근 7개 KST 달력일', () => {
  const now = new Date('2026-09-21T07:28:33.757Z'); // 2026-09-21 16:28 KST
  const start = rangeStart('7d', now);
  assert.equal(start.toISOString(), kstMidnightOf('2026-09-15').toISOString());
  assert.equal(start.getTime(), startOfKstDaysAgo(6, now).getTime());
  // 정확히 7개 달력일: 09-15 … 09-21
  const days = (startOfKstDay(now).getTime() - start.getTime()) / 86_400_000 + 1;
  assert.equal(days, 7);
});

test('§E 30일 = 오늘 포함 최근 30개 KST 달력일', () => {
  const now = new Date('2026-09-21T07:28:33.757Z');
  const start = rangeStart('30d', now);
  assert.equal(start.toISOString(), kstMidnightOf('2026-08-23').toISOString());
  assert.equal(start.getTime(), startOfKstDaysAgo(29, now).getTime());
  const days = (startOfKstDay(now).getTime() - start.getTime()) / 86_400_000 + 1;
  assert.equal(days, 30);
});

test('§D/§E 달력일 경계는 조회 시각에 따라 움직이지 않는다 — rolling이 아니다', () => {
  // 같은 KST 날짜 안이라면 아침에 봐도 저녁에 봐도 같은 구간을 가리켜야 한다.
  const morning = new Date('2026-09-21T00:30:00.000Z'); // 09:30 KST
  const evening = new Date('2026-09-21T13:00:00.000Z'); // 22:00 KST
  for (const range of ['today', '7d', '30d'] as const) {
    assert.equal(
      rangeStart(range, morning).getTime(),
      rangeStart(range, evening).getTime(),
      `${range}가 조회 시각에 따라 달라진다`
    );
  }
  // rolling 구현이었다면 두 값이 12.5시간 어긋났을 것이다.
  const rolling = (at: Date) => new Date(at.getTime() - 7 * 86_400_000);
  assert.notEqual(rolling(morning).getTime(), rolling(evening).getTime());
});

// ── F~G. 대시보드 ↔ 행동 분석 parity (같은 fixture) ──────────────────────────

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--).*$/gm, '');
const DASHBOARD = read('src/app/api/admin/dashboard/route.ts');
const QUERY = read('src/lib/admin-analytics/query.ts');
const BEHAVIOR_ROUTE = read('src/app/api/admin/behavior/route.ts');

/**
 * 같은 원천 fixture를 두 화면의 정의대로 세어본다. 두 정의가 같은 식이어야 하므로
 * 결과도 반드시 같아야 한다 — 하나라도 필터가 갈라지면 여기서 잡힌다.
 */
interface Row {
  sessionId: string;
  url: string;
}
const EVENT_PREFIX = '/__event__/';
const FIXTURE: Row[] = [
  { sessionId: 's1', url: '/' },
  { sessionId: 's1', url: '/apt/A' },
  { sessionId: 's1', url: `${EVENT_PREFIX}favorite_add` },
  { sessionId: 's2', url: '/map' },
  { sessionId: 's2', url: '/map' },
  { sessionId: 's3', url: `${EVENT_PREFIX}share_copy` }, // 이벤트만 있고 페이지뷰가 없는 세션
  { sessionId: 's4', url: '/stats/volume' },
];

const isEvent = (r: Row) => r.url.startsWith(EVENT_PREFIX);
/** 대시보드: COUNT(DISTINCT session_id) WHERE url NOT LIKE '/__event__/%' */
const dashboardSessions = (rows: Row[]) => new Set(rows.filter((r) => !isEvent(r)).map((r) => r.sessionId)).size;
const dashboardPageViews = (rows: Row[]) => rows.filter((r) => !isEvent(r)).length;
/** 행동 분석: 같은 식이어야 한다. */
const behaviorSessions = dashboardSessions;
const behaviorPageViews = dashboardPageViews;

test('§F 같은 fixture에서 방문 세션이 정확히 일치한다', () => {
  assert.equal(behaviorSessions(FIXTURE), dashboardSessions(FIXTURE));
  // s3는 이벤트만 남긴 세션이라 **양쪽 모두** 방문 세션으로 세지 않는다(3 = s1,s2,s4).
  assert.equal(dashboardSessions(FIXTURE), 3);
  assert.equal(new Set(FIXTURE.map((r) => r.sessionId)).size, 4, 'fixture에 이벤트 전용 세션이 없다');
});

test('§G 같은 fixture에서 페이지뷰가 정확히 일치한다', () => {
  assert.equal(behaviorPageViews(FIXTURE), dashboardPageViews(FIXTURE));
  assert.equal(dashboardPageViews(FIXTURE), 5);
  assert.equal(FIXTURE.length, 7, '이벤트 행이 페이지뷰로 새어 들어간다');
});

// ── 배선 계약 ────────────────────────────────────────────────────────────────

test('§6 두 화면이 같은 KST helper 하나를 쓴다 — 사본을 만들지 않는다', () => {
  for (const [name, src] of [
    ['dashboard route', DASHBOARD],
    ['behavior query', QUERY],
  ] as const) {
    assert.ok(/from '@\/lib\/kst-day'/.test(src), `${name}이 공통 KST helper를 쓰지 않는다`);
    // 런타임 TZ에 의존하는 계산이 돌아오면 안 된다.
    assert.ok(!/setHours\(0, ?0, ?0, ?0\)/.test(stripComments(src)), `${name}에 로컬 TZ 자정 계산이 있다`);
  }
});

test('§2/§5 행동 분석의 방문 세션이 이벤트 행을 제외한다 — 대시보드와 같은 정의', () => {
  const code = stripComments(QUERY);
  assert.ok(
    /COUNT\(DISTINCT session_id\) FILTER \(WHERE url NOT LIKE '\/__event__\/%'\) as sessions/.test(code),
    '방문 세션이 이벤트 행까지 센다'
  );
  // 퍼널 1단계(entry)와 KPI 방문 세션이 같은 식이어야 한다.
  assert.ok(/COUNT\(DISTINCT session_id\) FILTER \(WHERE url NOT LIKE '\/__event__\/%'\) as entry_sessions/.test(code));
});

test('§8 대시보드의 7일/30일도 KST 달력일이다 — rolling N×24h가 아니다', () => {
  const code = stripComments(DASHBOARD);
  assert.ok(/const sevenDaysAgo = startOfKstDaysAgo\(6\);/.test(code));
  assert.ok(/const thirtyDaysAgo = startOfKstDaysAgo\(29\);/.test(code));
  assert.ok(!/Date\.now\(\) - 7 \* 24/.test(code), 'rolling 7×24h가 남아 있다');
  assert.ok(!/Date\.now\(\) - 30 \* 24/.test(code), 'rolling 30×24h가 남아 있다');
});

test('§9/§10 "오늘"은 캐시하지 않는다 — 대시보드와 같은 시점을 본다', () => {
  const code = stripComments(BEHAVIOR_ROUTE);
  assert.ok(/range === 'today'/.test(code), 'today를 따로 다루지 않는다');
  const at = code.indexOf("range === 'today'");
  const todayBranch = code.slice(at, code.indexOf('return NextResponse', at));
  const [freshPath] = todayBranch.split('getOrSetCache');
  // BEHAVIOR_ANALYTICS_CONNECTION_POOL_SAFETY_V1 — 부분 실패 로거를 넘기게 됐다(인자 추가). 캐시 우회 계약은 같다.
  assert.ok(/getBehaviorSummary\(range(, \{ onMetricError: noteMetricFailure \})?\)/.test(freshPath), 'today가 캐시를 거친다');
  // 7일/30일은 기존 5분 캐시 관례를 유지한다.
  assert.ok(/getOrSetCache\(`admin-behavior:\$\{range\}`, CACHE_TTL_MS/.test(code));
});

test('§9 응답이 자기가 재고 있는 창을 밝힌다', () => {
  assert.ok(/rangeStartsAt: since\.toISOString\(\)/.test(QUERY));
  assert.ok(/todayStartsAt/.test(DASHBOARD), '대시보드의 창 표시가 사라졌다');
});
