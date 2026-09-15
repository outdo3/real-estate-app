import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { calculateScoreV2 } from './score-v2/engine';
import type { ScoreV2Input } from './score-v2/types';
import type { FitImportance } from './fit-importance';
import { ANALYTICS_EVENT_NAMES, PERSONAL_FIT_EVENT_ACTIONS, eventUrl, personalFitActionType } from './analytics/events';
import { GA_EVENT_MAP } from './analytics/ga-events';
import { NEXT_ACTION_TYPES } from './decision-journey/types';
import { cardViewAction, compareViewAction, shouldLogImpression } from './analytics/personal-fit-events';
import { deriveComparePersonalFit, derivePersonalFitCard, type FitPreferenceState, type PersonalFitCardModel } from './personal-fit-ui';

/**
 * PERSONALIZED_SCORE_V1 P2-F — 개인화 analytics 계약.
 * 순수 판정(상태 enum·중복 방지)은 직접 호출, 컴포넌트 배선·payload는 소스 검사로 고정한다.
 */

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CARD = code('src/components/PersonalFitCard.tsx');
const COMPARE = code('src/components/compare/CompareV2.tsx');
const SETTINGS = code('src/components/my/FitImportanceSettings.tsx');
const WRAPPER = code('src/lib/analytics/track-personal-fit.ts');
const ROUTE = code('src/app/api/log/event/route.ts');

const IMP: FitImportance = { transport: 5, living: 3, newness: 4, parking: 5, elementarySchoolAccess: 2 };
const ready = (fitImportance: FitImportance | null): FitPreferenceState => ({ kind: 'READY', fitImportance });
function v2(over: Partial<ScoreV2Input> = {}) {
  return JSON.parse(
    JSON.stringify(
      calculateScoreV2(
        {
          aptSeq: '26000-1', buildYear: 2016, totalHouseholds: 900, parkingRatio: 1.3, parkingRawStatus: 'KNOWN',
          subwayStatus: 'VALUE', nearestSubwayDistanceM: 250, nearestBusStopDistanceM: 80, busStopCount300m: 7,
          nearestElementaryDistanceM: 300, attendanceZoneStatus: 'AVAILABLE',
          living: { martCount1000m: 2, convenienceCount500m: 10, pharmacyCount500m: 4, hospitalCount1000m: 20, parkCount1000m: 3, daycareKindergartenCount500m: 5 },
          identityEligible: true, ...over,
        },
        2026
      )
    )
  );
}
const FULL = v2();
const LIMITED = v2({ parkingRatio: null, parkingRawStatus: 'MISSING', subwayStatus: 'MISSING', nearestSubwayDistanceM: null, nearestBusStopDistanceM: null, busStopCount300m: null });
const LIMITED_IMP: FitImportance = { transport: 5, living: 1, newness: 1, parking: 5, elementarySchoolAccess: 1 };
const NO_COMMON = v2({ identityEligible: false });

/** 컴포넌트 effect와 같은 규칙으로 렌더 순서를 흉내 내 전송 횟수를 센다. */
function simulate(renders: { keys: unknown[]; action: string | null }[]) {
  const sent: string[] = [];
  let last: unknown[] | null = null;
  for (const r of renders) {
    if (r.action === null || !shouldLogImpression(last, r.keys, r.action)) continue;
    last = r.keys;
    sent.push(r.action);
  }
  return sent;
}

// ── allowlist·route ──────────────────────────────────────────────────────────

const PREVIOUS_EVENTS = [
  'favorite_add', 'favorite_remove', 'share_success', 'share_attempt', 'next_action_click',
  'compare_start', 'compare_add', 'compare_remove', 'compare_detail_click', 'compare_share',
  'finance_fit_start', 'finance_fit_calculate', 'finance_fit_from_detail', 'finance_fit_from_compare',
  'pwa_install_banner_view', 'pwa_install_click', 'pwa_install_accept', 'pwa_install_dismiss', 'pwa_install_guide_open',
  'report_view', 'report_image_save', 'report_pdf_save', 'report_share',
  'partner_cta_impression', 'partner_cta_click',
  'detail_map_view', 'detail_roadview_open', 'detail_map_return',
];

test('15. allowlist: 기존 28개 이름·순서 그대로 + 개인화 5개만 추가, GA4 매핑 없음', () => {
  assert.deepEqual([...ANALYTICS_EVENT_NAMES].slice(0, PREVIOUS_EVENTS.length), PREVIOUS_EVENTS);
  assert.deepEqual([...ANALYTICS_EVENT_NAMES].slice(PREVIOUS_EVENTS.length), [
    'personal_fit_settings_cta_click', 'personal_fit_login_cta_click', 'personal_fit_settings_save', 'personal_fit_card_view', 'personal_fit_compare_view',
  ]);
  assert.ok(!Object.keys(GA_EVENT_MAP).some((k) => k.startsWith('personal_fit_')), '제품 분석 계열 — GA4로 보내지 않음');
  assert.ok(!read('src/lib/analytics/ga.ts').includes('fit_'), 'GA4 파라미터 allowlist 확장 없음');
  // 관리자 집계의 LIKE 접두사와 겹치지 않는다
  for (const prefix of ['compare_start', 'favorite_add', 'finance_fit_start', 'finance_fit_calculate', 'share_attempt', 'share_success', 'next_action_click']) {
    assert.ok(!ANALYTICS_EVENT_NAMES.some((n) => n.startsWith('personal_fit_') && n.startsWith(prefix)));
  }
});

test('route: 개인화 이벤트는 자기 enum만 actionType으로, next_action_click 판정 그대로, 그 외 이벤트는 null', () => {
  assert.equal(personalFitActionType('personal_fit_settings_cta_click', 'DETAIL'), 'DETAIL');
  assert.equal(personalFitActionType('personal_fit_login_cta_click', 'COMPARE'), 'COMPARE');
  assert.equal(personalFitActionType('personal_fit_card_view', 'LIMITED'), 'LIMITED');
  assert.equal(personalFitActionType('personal_fit_compare_view', 'HAS_UNAVAILABLE'), 'HAS_UNAVAILABLE');
  for (const [name, raw] of [
    ['personal_fit_card_view', 'DETAIL'], ['personal_fit_card_view', '86'], ['personal_fit_card_view', '0.74'],
    ['personal_fit_settings_cta_click', 'FULL'], ['personal_fit_settings_save', 'DETAIL'], ['personal_fit_card_view', 'parking'],
    ['favorite_add', 'DETAIL'], ['compare_start', 'FULL'], ['next_action_click', 'DETAIL'], ['toString', 'x'], ['__proto__', 'x'],
  ] as const) {
    assert.equal(personalFitActionType(name, raw), null, `${name}:${raw}`);
  }
  assert.match(ROUTE, /name === 'next_action_click' && rawActionType && \(NEXT_ACTION_TYPES as readonly string\[\]\)\.includes\(rawActionType\)\s*\? rawActionType\s*:[^;]*?personalFitActionType\(name, rawActionType\);/);
  assert.equal(eventUrl('personal_fit_card_view', 'FULL'), '/__event__/personal_fit_card_view?action=FULL');
  assert.ok(NEXT_ACTION_TYPES.every((t) => personalFitActionType('next_action_click', t) === null), 'next_action_click은 기존 분기로만');
  assert.ok(!Object.values(PERSONAL_FIT_EVENT_ACTIONS).flat().some((v) => /\d/.test(v)), 'enum에 숫자 없음');
});

// ── 상세 카드 view ────────────────────────────────────────────────────────────

test('7·8·9. 카드 view 상태: FULL·LIMITED·UNAVAILABLE만, 안내·로딩·숨김 상태는 이벤트 없음', () => {
  const m = (shadow: unknown, pref: FitPreferenceState, loading = false) => derivePersonalFitCard({ scoreLoading: loading, shadowV2: shadow, preference: pref });
  assert.equal(cardViewAction(m(FULL, ready(IMP))), 'FULL');
  assert.equal(cardViewAction(m(LIMITED, ready(LIMITED_IMP))), 'LIMITED');
  assert.equal(cardViewAction(m(NO_COMMON, ready(IMP))), 'UNAVAILABLE');
  for (const model of [m(FULL, { kind: 'LOGGED_OUT' }), m(FULL, ready(null)), m(FULL, { kind: 'LOADING' }), m(FULL, { kind: 'ERROR' }), m(undefined, ready(IMP), true), m(NO_COMMON, { kind: 'LOGGED_OUT' })] as PersonalFitCardModel[]) {
    assert.equal(cardViewAction(model), null, model.kind);
  }
});

test('11. 중복 방지: 로딩 → FULL은 FULL 한 번, 리렌더 반복 없음, 다른 단지(새 응답 객체)면 다시 한 번', () => {
  const sent = simulate([
    { keys: [undefined], action: null }, // 공통 점수 로딩
    { keys: [FULL], action: null }, // 선호 로딩
    { keys: [FULL], action: 'FULL' },
    { keys: [FULL], action: 'FULL' }, // 리렌더
    { keys: [FULL], action: 'FULL' },
  ]);
  assert.deepEqual(sent, ['FULL']);
  const other = v2({ buildYear: 1990 });
  assert.deepEqual(simulate([{ keys: [FULL], action: 'FULL' }, { keys: [FULL], action: 'FULL' }, { keys: [other], action: 'LIMITED' }]), ['FULL', 'LIMITED']);
  assert.deepEqual(simulate([{ keys: [NO_COMMON], action: 'UNAVAILABLE' }, { keys: [NO_COMMON], action: 'UNAVAILABLE' }]), ['UNAVAILABLE']);
  assert.match(CARD, /const lastViewKeys = useRef<unknown\[\] \| null>\(null\);/);
  assert.match(CARD, /if \(viewAction === null \|\| !shouldLogImpression\(lastViewKeys\.current, \[shadowV2\], viewAction\)\) return;\s*lastViewKeys\.current = \[shadowV2\];\s*trackPersonalFit\('personal_fit_card_view', viewAction\);/);
});

// ── 비교 view ────────────────────────────────────────────────────────────────

test('10·12(비교). 비교 view 상태 enum과 한 번만', () => {
  const m = (a: unknown, b: unknown, pref: FitPreferenceState) => deriveComparePersonalFit({ shadowA: a, shadowB: b, preference: pref });
  assert.equal(compareViewAction(m(FULL, v2({ buildYear: 1990 }), ready(IMP))), 'FULL_FULL');
  assert.equal(compareViewAction(m(FULL, LIMITED, ready(LIMITED_IMP))), 'FULL_LIMITED');
  assert.equal(compareViewAction(m(LIMITED, FULL, ready(LIMITED_IMP))), 'FULL_LIMITED', '순서 무관');
  assert.equal(compareViewAction(m(LIMITED, LIMITED, ready(LIMITED_IMP))), 'LIMITED_LIMITED');
  assert.equal(compareViewAction(m(FULL, NO_COMMON, ready(IMP))), 'HAS_UNAVAILABLE');
  assert.equal(compareViewAction(m(NO_COMMON, LIMITED, ready(LIMITED_IMP))), 'HAS_UNAVAILABLE');
  for (const model of [m(FULL, FULL, { kind: 'LOGGED_OUT' }), m(FULL, FULL, ready(null)), m(FULL, FULL, { kind: 'LOADING' }), m(FULL, FULL, { kind: 'ERROR' }), m(NO_COMMON, undefined, ready(IMP))]) {
    assert.equal(compareViewAction(model), null, model.kind);
  }
  const B = v2({ buildYear: 1990 });
  assert.deepEqual(simulate([{ keys: [FULL, B], action: null }, { keys: [FULL, B], action: 'FULL_FULL' }, { keys: [FULL, B], action: 'FULL_FULL' }]), ['FULL_FULL']);
  assert.deepEqual(simulate([{ keys: [FULL, B], action: 'FULL_FULL' }, { keys: [FULL, LIMITED], action: 'FULL_LIMITED' }]), ['FULL_FULL', 'FULL_LIMITED'], '단지 교체 시 새 비교');
  assert.match(COMPARE, /if \(viewAction === null \|\| !shouldLogImpression\(lastViewKeys\.current, \[a\.scoreV2, b\.scoreV2\], viewAction\)\) return;\s*lastViewKeys\.current = \[a\.scoreV2, b\.scoreV2\];\s*trackPersonalFit\('personal_fit_compare_view', viewAction\);/);
});

// ── CTA·저장 ─────────────────────────────────────────────────────────────────

test('1·3. 상세 CTA: 설정 CTA 클릭 DETAIL, 로그인 CTA 클릭 DETAIL', () => {
  assert.match(CARD, /<Link href=\{FIT_SETTINGS_HREF\} className=\{styles\.ctaButton\} onClick=\{\(\) => trackPersonalFit\('personal_fit_settings_cta_click', 'DETAIL'\)\}>/);
  assert.match(CARD, /onClick=\{\(\) => \{\s*trackPersonalFit\('personal_fit_login_cta_click', 'DETAIL'\);\s*setLoginOpen\(true\);/);
  assert.ok(!/editLink[^>]*onClick/.test(CARD), '"중요도 수정" 링크는 이번 V1 이벤트 대상 아님');
});

test('2·4. 비교 CTA: 설정 CTA 클릭 COMPARE, 로그인 CTA 클릭 COMPARE', () => {
  assert.match(COMPARE, /<Link href=\{FIT_SETTINGS_HREF\} className=\{styles\.fitCta\} onClick=\{\(\) => trackPersonalFit\('personal_fit_settings_cta_click', 'COMPARE'\)\}>/);
  assert.match(COMPARE, /onClick=\{\(\) => \{\s*trackPersonalFit\('personal_fit_login_cta_click', 'COMPARE'\);\s*setLoginOpen\(true\);/);
});

test('5·6. 저장 이벤트: 서버 성공 확인·캐시 갱신 뒤에만 1회, 실패(catch)에는 없음, 버튼 선택에는 없음', () => {
  const handleSave = SETTINGS.slice(SETTINGS.indexOf('const handleSave = async () => {'), SETTINGS.indexOf('  return ('));
  const failCheck = handleSave.indexOf("if (!res.ok || !json?.success) throw new Error('save failed');");
  const tracked = handleSave.indexOf("trackPersonalFit('personal_fit_settings_save');");
  const catchAt = handleSave.indexOf('} catch {');
  assert.ok(failCheck > 0 && tracked > failCheck && tracked < catchAt, '성공 판정 뒤, catch 앞');
  assert.ok(handleSave.indexOf("setSaveState('saved');") < tracked);
  assert.equal((SETTINGS.match(/trackPersonalFit\(/g) ?? []).length, 1, '1~5 버튼·축 선택마다 이벤트 없음');
  assert.ok(!/trackPersonalFit/.test(handleSave.slice(catchAt)));
});

// ── 개인정보 ─────────────────────────────────────────────────────────────────

test('12·13·14·17. payload: 이름 + 고정 enum 하나뿐(중요도·점수·coverage·제외 축·단지 식별자 없음)', () => {
  // 래퍼는 이름과 해당 이벤트 enum만 받고 actionType 외 필드를 만들지 않는다
  assert.match(WRAPPER, /trackEvent\(name, action\.length \? \{ actionType: action\[0\] \} : \{\}\);/);
  assert.ok(!/aptName|complexId|ga:/.test(WRAPPER));
  const files = { CARD, COMPARE, SETTINGS };
  for (const [label, src] of Object.entries(files)) {
    const calls = [...src.matchAll(/trackPersonalFit\(([^)]*)\)/g)].map((m) => m[1].trim());
    assert.ok(calls.length > 0, label);
    for (const args of calls) {
      assert.match(args, /^'personal_fit_[a-z_]+'(, ('DETAIL'|'COMPARE'|viewAction))?$/, `${label}: ${args}`);
      assert.ok(!/fitImportance|importance|transport|living|newness|parking|elementarySchoolAccess|rawScore|score|coverage|excluded|aptSeq|displayName|name:/i.test(args.replace(/^'personal_fit_[a-z_]+'/, '')), `${label}: ${args}`);
    }
  }
  // 개인화 파일들이 기존 trackEvent를 직접 불러 임의 context를 싣지 않는다(래퍼만)
  const block = COMPARE.slice(COMPARE.indexOf('function PersonalFitCompareBlock('));
  assert.ok(!/trackEvent\(/.test(block) && !/trackEvent\(/.test(CARD) && !/trackEvent\(/.test(SETTINGS));
  // viewAction은 상태 enum 함수 결과
  assert.match(CARD, /const viewAction = cardViewAction\(model\);/);
  assert.match(COMPARE, /const viewAction = compareViewAction\(model\);/);
});

test('18. URL 유출 없음: 이벤트 URL은 /__event__/<이름>?action=<enum>, 설정 링크에 값 없음', () => {
  for (const [name, actions] of Object.entries(PERSONAL_FIT_EVENT_ACTIONS)) {
    for (const a of actions as readonly string[]) {
      assert.match(eventUrl(name as never, a), /^\/__event__\/personal_fit_[a-z_]+\?action=[A-Z_]+$/);
    }
  }
  assert.ok(!/router\.(push|replace)|searchParams|history\.|location\.(search|href)\s*=/.test(read('src/lib/analytics/track-personal-fit.ts')));
});

test('16. 공통 점수 불변: analytics 추가는 점수 카드·막대·응답을 읽기만 한다', () => {
  const before = JSON.stringify(FULL);
  cardViewAction(derivePersonalFitCard({ scoreLoading: false, shadowV2: FULL, preference: ready(IMP) }));
  compareViewAction(deriveComparePersonalFit({ shadowA: FULL, shadowB: LIMITED, preference: ready(IMP) }));
  assert.equal(JSON.stringify(FULL), before);
  assert.ok(!/trackPersonalFit|personal_fit_/.test(code('src/components/ApartmentScoreCard.tsx')));
  const section = COMPARE.slice(COMPARE.indexOf('function ScoreSection('), COMPARE.indexOf('function PersonalFitCompareBlock('));
  assert.ok(!/trackPersonalFit|personal_fit_/.test(section));
});

test('성능·안정성: 전송은 fire-and-forget, 실패를 삼켜 화면을 막지 않음', () => {
  assert.match(WRAPPER, /try \{\s*trackEvent\([\s\S]*?\} catch \{/);
  assert.ok(!/await/.test(WRAPPER));
  assert.match(CARD, /useEffect\(\(\) => \{\s*if \(viewAction === null/);
});

test('기존 analytics 호출 불변: 지도·상세·리포트·커뮤니티·파트너·인증 파일에 개인화 외 새 호출 없음', () => {
  const unchanged: Record<string, string[]> = {
    'src/components/compare/CompareV2.tsx': ['compare_add', 'compare_detail_click', 'compare_detail_click', 'compare_remove', 'compare_start', 'finance_fit_from_compare', 'finance_fit_from_compare'],
  };
  for (const [f, names] of Object.entries(unchanged)) {
    assert.deepEqual([...code(f).matchAll(/trackEvent\('([a-z_]+)'/g)].map((m) => m[1]).sort(), names);
  }
  for (const f of ['src/app/map/page.tsx', 'src/components/partners/PartnerCtaCard.tsx', 'src/components/LoginModal.tsx', 'src/components/report/ReportActions.tsx']) {
    let src = '';
    try {
      src = code(f);
    } catch {
      continue;
    }
    assert.ok(!/personal_fit_|trackPersonalFit/.test(src), f);
  }
});
