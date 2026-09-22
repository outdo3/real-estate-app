import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ANALYTICS_EVENT_NAMES } from '../analytics/events';
import { startOfKstDay, startOfKstDaysAgo } from '../kst-day';
import {
  AUTO_EVENT_NAMES,
  DECISION_ACTION_EVENT_NAMES,
  EVENT_ENGAGEMENT,
  INTERACTION_EVENT_NAMES,
  INTERACTION_EVENT_URLS,
  countDecisionSessionsInRows,
  countEngagedSessionsInRows,
  engagedRate,
  isEngagedSession,
  isInteractionEventUrl,
} from './engagement';

// ADMIN_ENGAGED_SESSIONS_V1 — 참여 세션 정의를 고정한다. 순수 함수만(DB 없음).

const E = (name: string) => `/__event__/${name}`;
const rows = (sessionId: string, urls: string[]) => urls.map((url) => ({ sessionId, url }));

// ── A~F. 정의 ────────────────────────────────────────────────────────────────

test('§A 1페이지 + 상호작용 없음 → 참여 아님', () => {
  assert.equal(countEngagedSessionsInRows(rows('a', ['/'])), 0);
  assert.equal(isEngagedSession({ pageViews: 1, interactionEvents: 0 }), false);
});

test('§B 2페이지 → 참여', () => {
  assert.equal(countEngagedSessionsInRows(rows('b', ['/', '/stats'])), 1);
  // 같은 페이지 새로고침 2번도 PV 2 — 정의는 PV 수만 본다.
  assert.equal(countEngagedSessionsInRows(rows('b2', ['/map', '/map'])), 1);
});

test('§C 1페이지 + 비교 시작(검색 결과 선택) → 참여', () => {
  // search_logs에는 session_id가 없어 일반 검색은 세션에 붙일 수 없다. 세션에 남는 검색 동작은
  // 비교 화면의 검색 결과 선택(compare_start/compare_add)이다.
  assert.equal(countEngagedSessionsInRows(rows('c', ['/stats/compare', E('compare_start')])), 1);
});

test('§D 1페이지 + 공유 → 참여', () => {
  assert.equal(countEngagedSessionsInRows(rows('d', ['/', E('share_copy'), E('share_success')])), 1);
  assert.equal(countEngagedSessionsInRows(rows('d2', ['/', E('share_kakao')])), 1);
});

test('§E 1페이지 + 자동 이벤트만 → 참여 아님 (09-21 모양)', () => {
  // 09-21 KST 크롤러 세션이 남긴 이벤트가 정확히 이것들이다.
  for (const auto of ['report_view', 'detail_map_view', 'partner_cta_impression', 'finance_fit_start', 'pwa_install_banner_view']) {
    assert.equal(countEngagedSessionsInRows(rows('e', ['/x', E(auto)])), 0, `${auto}가 참여로 셌다`);
  }
  assert.equal(countEngagedSessionsInRows(rows('e2', ['/report/city/busan', E('report_view'), E('partner_cta_impression'), E('detail_map_view')])), 0);
});

test('§F 상호작용 이벤트가 여러 건이어도 세션은 1', () => {
  const r = rows('f', ['/', '/apt/A', E('favorite_add'), E('share_copy'), E('compare_add'), E('next_action_click?action=MAP')]);
  assert.equal(countEngagedSessionsInRows(r), 1);
});

test('§A~F 페이지뷰 없이 이벤트만 있는 세션은 세지 않는다 — 참여 ⊆ 방문', () => {
  // 방문 세션 정의(이벤트 행 제외)가 이 세션을 세지 않으므로 참여도 세지 않는다 → 참여율 ≤ 100%.
  assert.equal(countEngagedSessionsInRows(rows('g', [E('share_copy'), E('favorite_add')])), 0);
  assert.equal(isEngagedSession({ pageViews: 0, interactionEvents: 3 }), false);
});

test('§A~F 09-21 KST 실측 분포를 재현한다: 319 세션 중 1PV 317 · 2PV 2 → 참여 2', () => {
  const fixture: { sessionId: string; url: string }[] = [];
  for (let i = 0; i < 317; i++) {
    fixture.push({ sessionId: `one-${i}`, url: `/apt/${i}` });
    // 230개 세션이 자동 노출 이벤트를 남겼다(운영 실측 379건).
    if (i < 230) fixture.push({ sessionId: `one-${i}`, url: E(i % 2 ? 'detail_map_view' : 'report_view') });
  }
  fixture.push(...rows('two-0', ['/stats/compare', '/stats/compare']), ...rows('two-1', ['/', '/stats']));
  assert.equal(new Set(fixture.filter((r) => !r.url.startsWith('/__event__/')).map((r) => r.sessionId)).size, 319);
  assert.equal(countEngagedSessionsInRows(fixture), 2);
});

// ── 분류 계약 ────────────────────────────────────────────────────────────────

test('모든 이벤트가 정확히 하나로 분류된다 — 빠진 이벤트·겹친 이벤트 0', () => {
  assert.equal(Object.keys(EVENT_ENGAGEMENT).length, ANALYTICS_EVENT_NAMES.length);
  assert.equal(INTERACTION_EVENT_NAMES.length + AUTO_EVENT_NAMES.length, ANALYTICS_EVENT_NAMES.length);
  for (const n of INTERACTION_EVENT_NAMES) assert.ok(!AUTO_EVENT_NAMES.includes(n));
});

test('자동 이벤트는 정확히 이 8개다 — 코드상 렌더/마운트/노출로 발생', () => {
  assert.deepEqual([...AUTO_EVENT_NAMES].sort(), [
    'detail_map_view', 'feedback_open', 'finance_fit_start', 'partner_cta_impression',
    'personal_fit_card_view', 'personal_fit_compare_view', 'pwa_install_banner_view', 'report_view',
  ]);
});

test('상호작용 URL 판정 — ?action= 쿼리, 페이지뷰, 목록 밖 이벤트', () => {
  assert.ok(isInteractionEventUrl(E('next_action_click?action=COMPARE')));
  assert.ok(!isInteractionEventUrl('/apt/A'));
  assert.ok(!isInteractionEventUrl(E('report_view')));
  assert.ok(!isInteractionEventUrl(E('not_a_real_event')));
  assert.deepEqual(INTERACTION_EVENT_URLS, INTERACTION_EVENT_NAMES.map(E));
});

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

test('자동 이벤트가 정말 자동인지 코드로 확인한다 — effect/노출 안에서 호출된다', () => {
  const autoSites: [string, string, RegExp][] = [
    ['finance_fit_start', 'src/app/finance-fit/finance-fit-client.tsx', /useEffect\(\(\) => \{\s*if \(startTracked\.current\) return;[\s\S]{0,200}trackEvent\('finance_fit_start'/],
    ['report_view', 'src/components/report/ReportActions.tsx', /useEffect\(\(\) => \{[\s\S]{0,300}trackEvent\('report_view'/],
    ['feedback_open', 'src/app/feedback/feedback-client.tsx', /useEffect\(\(\) => \{[\s\S]{0,120}trackFeedbackOpen\(\)/],
    ['partner_cta_impression', 'src/components/partner/usePartnerCta.ts', /isIntersecting[\s\S]{0,300}trackEvent\('partner_cta_impression'/],
  ];
  for (const [name, file, re] of autoSites) assert.ok(re.test(read(file)), `${name}의 발생 위치가 바뀌었다 — 분류를 다시 확인하라`);
});

// ── G. 대시보드 ↔ 행동 분석 parity ───────────────────────────────────────────

test('§G 두 화면이 같은 countEngagedSessions 하나를 쓴다', () => {
  const route = read('src/app/api/admin/dashboard/route.ts');
  const query = read('src/lib/admin-analytics/query.ts');
  assert.ok(/import \{ countEngagedSessions \} from '@\/lib\/admin-analytics\/query';/.test(route));
  assert.ok(/countEngagedSessions\(today\)/.test(route), '대시보드가 오늘 KST 시작으로 세지 않는다');
  // BEHAVIOR_ANALYTICS_CONNECTION_POOL_SAFETY_V1 — 같은 함수를 isolate()로 감싸 순차 호출한다.
  assert.ok(/await m\('engagedSessions', \(\) => countEngagedSessions\(since\)\)/.test(query), '행동 분석이 같은 함수를 쓰지 않는다');
  // SQL은 분류 목록과 최소 PV 상수를 **가져다 쓴다** — 이벤트 이름을 SQL에 다시 적지 않는다.
  const sql = query.slice(query.indexOf('export async function countEngagedSessions'), query.indexOf('async function fetchPopularApartments'));
  assert.ok(/Prisma\.join\(\[\.\.\.INTERACTION_EVENT_URLS\]\)/.test(sql));
  assert.ok(/>= \$\{ENGAGED_MIN_PAGE_VIEWS\}/.test(sql));
  assert.ok(/url NOT LIKE '\/__event__\/%'\) >= 1/.test(sql), '참여 ⊆ 방문 조건이 빠졌다');
  for (const auto of AUTO_EVENT_NAMES) assert.ok(!sql.includes(auto), `SQL에 자동 이벤트 ${auto}가 적혀 있다`);
});

// ── H. KST 경계 ──────────────────────────────────────────────────────────────

test('§H KST 자정 경계 — 전날 23:59 KST의 PV는 오늘 참여 판정에 들어가지 않는다', () => {
  const now = new Date('2026-09-21T23:30:00.000Z'); // 09-22 08:30 KST (UTC로는 아직 09-21)
  const today = startOfKstDay(now); // 09-21T15:00Z
  const r = [
    { sessionId: 's', url: '/', createdAt: new Date('2026-09-21T14:59:30.000Z') }, // 09-21 23:59:30 KST
    { sessionId: 's', url: '/stats', createdAt: new Date('2026-09-21T15:00:10.000Z') }, // 09-22 00:00:10 KST
  ];
  // 오늘 범위에는 PV 1건뿐이라 참여가 아니다(어제 PV로 부풀지 않는다).
  assert.equal(countEngagedSessionsInRows(r, today), 0);
  // 7일 범위(오늘 포함 7개 KST 달력일)에서는 2건 → 참여.
  assert.equal(countEngagedSessionsInRows(r, startOfKstDaysAgo(6, now)), 1);
});

test('참여율 — 분모 0·확인 불가는 null, 그 외 engaged/visits', () => {
  assert.equal(engagedRate(0, 0), null);
  assert.equal(engagedRate(2, null), null);
  assert.equal(engagedRate(null, 319), null);
  assert.equal(engagedRate(2, 319), 2 / 319);
});

// ── BEHAVIOR_FUNNEL_AUTO_EVENT_CLEANUP_V1 — 퍼널 3단계 "비교 / 관심 / 자금계산" ─────────────

test('퍼널 §A finance_fit_start만 → 결정 세션 0 (페이지를 연 것뿐)', () => {
  assert.equal(countDecisionSessionsInRows(rows('a', ['/finance-fit', E('finance_fit_start')])), 0);
});

test('퍼널 §B finance_fit_calculate → 1', () => {
  assert.equal(countDecisionSessionsInRows(rows('b', ['/finance-fit', E('finance_fit_start'), E('finance_fit_calculate')])), 1);
});

test('퍼널 §C compare_start → 1', () => {
  assert.equal(countDecisionSessionsInRows(rows('c', ['/stats/compare', E('compare_start')])), 1);
});

test('퍼널 §D favorite_add → 1', () => {
  assert.equal(countDecisionSessionsInRows(rows('d', ['/apt/A', E('favorite_add')])), 1);
});

test('퍼널 §E 한 세션의 결정 이벤트 여러 건 → 1 (단계는 distinct session으로 센다)', () => {
  const r = [...rows('e', ['/apt/A', E('favorite_add'), E('compare_start'), E('finance_fit_calculate'), E('favorite_add')]), ...rows('e2', [E('compare_start')])];
  assert.equal(countDecisionSessionsInRows(r), 2);
});

test('퍼널 결정 이벤트는 전부 INTERACTION이다 — 자동 이벤트가 들어갈 수 없다', () => {
  for (const n of DECISION_ACTION_EVENT_NAMES) assert.equal(EVENT_ENGAGEMENT[n], 'INTERACTION', `${n}이 자동 이벤트다`);
  assert.ok(!(DECISION_ACTION_EVENT_NAMES as readonly string[]).includes('finance_fit_start'));
});

test('퍼널 SQL이 결정 이벤트 목록을 쓰고 자동 이벤트를 적지 않는다', () => {
  const query = read('src/lib/admin-analytics/query.ts');
  const start = query.indexOf('async function fetchCombinedCounts');
  const combined = query.slice(start, query.indexOf('export async function countEngagedSessions'));
  const decision = combined.slice(combined.indexOf('COUNT(DISTINCT session_id) FILTER (', combined.indexOf('detail_sessions')), combined.indexOf('as decision_sessions'));
  assert.ok(/Prisma\.join\(\[\.\.\.DECISION_ACTION_EVENT_URLS\]\)/.test(decision), '결정 단계가 공통 목록을 쓰지 않는다');
  for (const auto of AUTO_EVENT_NAMES) assert.ok(!decision.includes(auto), `결정 단계 SQL에 자동 이벤트 ${auto}가 있다`);
});

