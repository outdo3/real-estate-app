import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { calculateScoreV2 } from './score-v2/engine';
import type { ScoreV2Input } from './score-v2/types';
import { FIT_AXES, type FitImportance } from './fit-importance';
import { calculatePersonalFit } from './personalized-score';
import { createFitPreferenceCache } from './fit-preference-cache';
import {
  FIT_LEVEL_MEANINGS,
  FIT_SETTINGS_HREF,
  PERSONAL_FIT_COPY,
  canSaveDraft,
  derivePersonalFitCard,
  draftFromSaved,
  draftToImportance,
  isDraftDirty,
  setDraftLevel,
  type FitPreferenceState,
} from './personal-fit-ui';

/**
 * PERSONALIZED_SCORE_V1 P2-C/P2-E — 상세 카드·MY 설정·세션 캐시 계약.
 * 순수 로직은 직접 호출, 컴포넌트 배선은 소스 검사로 고정한다.
 */

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CARD = code('src/components/PersonalFitCard.tsx');
const SETTINGS = code('src/components/my/FitImportanceSettings.tsx');
const HOOK = code('src/hooks/useFitPreference.ts');
const DETAIL = code('src/app/apt/[name]/apt-client.tsx');
const MY = code('src/app/my/page.tsx');

const IMP: FitImportance = { transport: 5, living: 3, newness: 4, parking: 5, elementarySchoolAccess: 2 };

function v2(over: Partial<ScoreV2Input> = {}) {
  return calculateScoreV2(
    {
      aptSeq: '26000-1',
      buildYear: 2016,
      totalHouseholds: 900,
      parkingRatio: 1.3,
      parkingRawStatus: 'KNOWN',
      subwayStatus: 'VALUE',
      nearestSubwayDistanceM: 250,
      nearestBusStopDistanceM: 80,
      busStopCount300m: 7,
      nearestElementaryDistanceM: 300,
      attendanceZoneStatus: 'AVAILABLE',
      living: { martCount1000m: 2, convenienceCount500m: 10, pharmacyCount500m: 4, hospitalCount1000m: 20, parkCount1000m: 3, daycareKindergartenCount500m: 5 },
      identityEligible: true,
      ...over,
    },
    2026
  );
}
const wire = (x: unknown) => JSON.parse(JSON.stringify(x));
const ready = (fitImportance: FitImportance | null): FitPreferenceState => ({ kind: 'READY', fitImportance });

// ── 상세 카드 상태 ─────────────────────────────────────────────────────────────

test('1. 비로그인 → 로그인 CTA(공통 점수가 있을 때만), 계산 없음', () => {
  assert.deepEqual(derivePersonalFitCard({ scoreLoading: false, shadowV2: wire(v2()), preference: { kind: 'LOGGED_OUT' } }), { kind: 'LOGGED_OUT' });
  assert.deepEqual(derivePersonalFitCard({ scoreLoading: false, shadowV2: undefined, preference: { kind: 'LOGGED_OUT' } }), { kind: 'HIDDEN' });
  assert.match(CARD, /\{COPY\.loggedOut\}/);
  assert.match(CARD, /<LoginModal open=\{loginOpen\}/);
  assert.equal(PERSONAL_FIT_COPY.loggedOut, '로그인하면 나에게 맞는 점수를 확인할 수 있어요');
  assert.equal(PERSONAL_FIT_COPY.loggedOutCta, '로그인하고 확인');
});

test('2·18·19. 비로그인은 선호 요청 없음, 캐시는 사용자 id로 격리, 로그아웃 시 비움', async () => {
  // 훅: 인증 상태에서만 load, unauthenticated이면 clear
  assert.match(HOOK, /const userId = status === 'authenticated' \? session\?\.user\?\.id \?\? null : null;/);
  assert.match(HOOK, /if \(status === 'unauthenticated'\) \{\s*fitPreferenceCache\.clear\(\);\s*return;\s*\}\s*if \(!userId\) return;/);
  assert.match(MY, /fitPreferenceCache\.clear\(\);\s*signOut\(\{ callbackUrl: '\/' \}\);/);

  const calls: string[] = [];
  const bodies: Record<string, unknown> = {
    userA: { success: true, data: { purposes: [], fitImportance: IMP } },
    userB: { success: true, data: { purposes: [], fitImportance: null } },
  };
  let current = 'userA';
  const cache = createFitPreferenceCache(async (url, init) => {
    calls.push(`${current}:${url}:${init?.cache}`);
    return new Response(JSON.stringify(bodies[current]), { status: 200 });
  });
  assert.deepEqual(await cache.load('userA'), IMP);
  assert.deepEqual(await cache.load('userA'), IMP, '두 번째는 캐시');
  await Promise.all([cache.load('userA'), cache.load('userA')]);
  assert.equal(calls.length, 1, '같은 사용자 반복 조회 없음');
  assert.equal(cache.peek('userB'), undefined, '다른 사용자에게 이전 값 노출 없음');
  current = 'userB';
  assert.equal(await cache.load('userB'), null);
  assert.equal(cache.peek('userA'), undefined, '사용자가 바뀌면 이전 사용자 값 폐기');
  assert.equal(calls.length, 2);
  cache.clear();
  assert.equal(cache.peek('userB'), undefined);
  assert.equal(calls[0], 'userA:/api/my/preferences:no-store');
});

test('2b. 조회 실패는 캐시하지 않고, 사용자 전환 중 늦게 온 응답이 새 사용자 값으로 남지 않는다', async () => {
  let fail = true;
  const cache = createFitPreferenceCache(async () => (fail ? new Response('{"success":false}', { status: 500 }) : new Response(JSON.stringify({ success: true, data: { fitImportance: IMP } }), { status: 200 })));
  await assert.rejects(cache.load('u1'));
  assert.equal(cache.peek('u1'), undefined);
  fail = false;
  assert.deepEqual(await cache.load('u1'), IMP);

  let release!: () => void;
  const slow = createFitPreferenceCache(
    () => new Promise<Response>((r) => (release = () => r(new Response(JSON.stringify({ success: true, data: { fitImportance: IMP } }), { status: 200 }))))
  );
  const pending = slow.load('old');
  slow.set('new', null);
  release();
  await pending;
  assert.equal(slow.peek('new'), null, '새 사용자 값 유지');
  assert.equal(slow.peek('old'), undefined);
});

test('3. 로그인 + 미설정 → 설정 CTA(MY 섹션 앵커, 값 없는 URL)', () => {
  assert.deepEqual(derivePersonalFitCard({ scoreLoading: false, shadowV2: wire(v2()), preference: ready(null) }), { kind: 'NO_SETTINGS' });
  assert.equal(FIT_SETTINGS_HREF, '/my#fit-score-settings');
  assert.match(CARD, /<Link href=\{FIT_SETTINGS_HREF\} className=\{styles\.ctaButton\}>\s*\{COPY\.noSettingsCta\}/);
  assert.equal(PERSONAL_FIT_COPY.noSettingsCta, '내 중요도 설정하기');
});

test('4·5·22·23. 저장된 중요도 → P2-B 엔진 결과를 그대로 FULL 카드로(점수·good/weak 재판정 없음)', () => {
  const shadow = wire(v2());
  const model = derivePersonalFitCard({ scoreLoading: false, shadowV2: shadow, preference: ready(IMP) });
  const engine = calculatePersonalFit({ shadowV2: shadow, fitImportance: IMP });
  if (model.kind !== 'SCORE') return assert.fail(`expected SCORE, got ${model.kind}`);
  if (engine.status === 'UNAVAILABLE') return assert.fail('engine unavailable');
  assert.equal(model.status, 'FULL');
  assert.equal(model.score, engine.score);
  assert.deepEqual(model.goodFit, engine.goodFit);
  assert.deepEqual(model.weakFit, engine.weakFit);
  assert.deepEqual(model.rows.map((r) => r.axis), [...FIT_AXES]);
  assert.deepEqual(model.rows.map((r) => r.importance), FIT_AXES.map((a) => IMP[a]));
  assert.ok(model.rows.every((r) => typeof r.displayScore === 'number'));
  // 컴포넌트는 모델만 렌더(엔진·임계값을 직접 쓰지 않음)
  assert.match(code('src/lib/personal-fit-ui.ts'), /calculatePersonalFit\(\{ shadowV2: input\.shadowV2, fitImportance: preference\.fitImportance \}\)/);
  assert.ok(!/calculatePersonalFit|PERSONAL_FIT_GOOD_MIN_SCORE|>= 75|<= 45/.test(CARD));
  assert.match(CARD, /\{model\.goodFit\.map\(\(g\) => \(\s*<li key=\{g\.axis\}>\{g\.text\}<\/li>/);
  assert.match(CARD, /\{model\.weakFit\.map\(\(w\) => \(\s*<li key=\{w\.axis\}>\{w\.text\}<\/li>/);
});

test('6·7. LIMITED: 점수 표시 + "일부 정보 부족" + 제외 축 사유, 제외 축은 0점으로 보이지 않음', () => {
  const shadow = wire(v2({ parkingRatio: null, parkingRawStatus: 'MISSING', subwayStatus: 'MISSING', nearestSubwayDistanceM: null, nearestBusStopDistanceM: null, busStopCount300m: null }));
  const model = derivePersonalFitCard({ scoreLoading: false, shadowV2: shadow, preference: ready({ transport: 5, living: 1, newness: 1, parking: 5, elementarySchoolAccess: 1 }) });
  assert.equal(model.kind, 'SCORE');
  if (model.kind !== 'SCORE') return;
  assert.equal(model.status, 'LIMITED');
  assert.deepEqual(model.excludedTexts, ['교통 정보 없음', '주차 정보 없음']);
  const parking = model.rows.find((r) => r.axis === 'parking')!;
  assert.equal(parking.displayScore, null);
  assert.equal(parking.excludedText, '주차 정보 없음');
  assert.match(CARD, /limited \? COPY\.badgeLimited : COPY\.badgeFull/);
  assert.match(CARD, /\{COPY\.limitedNote\} <span className=\{styles\.excludedInline\}>\{COPY\.excludedTitle\}: \{model\.excludedTexts\.join\(', '\)\}/);
  assert.match(CARD, /row\.displayScore != null \? \(\s*<span className=\{styles\.axisScore\}>\{row\.displayScore\}점<\/span>/);
  assert.equal(PERSONAL_FIT_COPY.badgeLimited, '일부 정보 부족');
});

test('8. 공통 점수 없음 → UNAVAILABLE, 가짜 점수 없음 / 로딩 중 → 자리만', () => {
  for (const shadow of [undefined, null, wire(v2({ identityEligible: false }))]) {
    assert.deepEqual(derivePersonalFitCard({ scoreLoading: false, shadowV2: shadow, preference: ready(IMP) }), { kind: 'UNAVAILABLE' });
  }
  assert.deepEqual(derivePersonalFitCard({ scoreLoading: true, shadowV2: undefined, preference: ready(IMP) }), { kind: 'PLACEHOLDER' });
  assert.deepEqual(derivePersonalFitCard({ scoreLoading: false, shadowV2: wire(v2()), preference: { kind: 'LOADING' } }), { kind: 'PLACEHOLDER' });
  assert.deepEqual(derivePersonalFitCard({ scoreLoading: false, shadowV2: wire(v2()), preference: { kind: 'ERROR' } }), { kind: 'ERROR' });
  assert.equal(PERSONAL_FIT_COPY.unavailable, '현재 이 단지는 나에게 맞는 점수를 계산할 정보가 부족해요.');
});

test('9. 공통 점수 불변: 카드 계산 전후 응답 객체 동일, 상세는 기존 카드를 그대로 두고 아래에 별도 카드', () => {
  const shadow = wire(v2());
  const before = JSON.stringify(shadow);
  derivePersonalFitCard({ scoreLoading: false, shadowV2: shadow, preference: ready(IMP) });
  assert.equal(JSON.stringify(shadow), before);
  assert.ok(!/\bfitImportance\b|\bFitImportance\b/.test(DETAIL) && !/\bfitImportance\b|\bFitImportance\b/.test(MY), '페이지는 중요도 값을 직접 만지지 않음');
  assert.match(DETAIL, /<ApartmentScoreCard result=\{scoreResult\} loading=\{scoreLoading\} \/>\s*<PersonalFitCard shadowV2=\{scoreResult\?\._shadowV2\} scoreLoading=\{scoreLoading\} \/>/);
  assert.ok(!/PersonalFit|fitImportance/.test(code('src/components/ApartmentScoreCard.tsx')), '공통 카드에 섞지 않음');
});

// ── MY 설정 ──────────────────────────────────────────────────────────────────

test('10·11. MY 설정: 정확히 5축(교통·생활편의·신축·주차·초등학교 접근성), 학군 없음, 1~5 의미', () => {
  assert.match(MY, /<FitImportanceSettings \/>/);
  assert.match(SETTINGS, /\{FIT_AXES\.map\(\(axis\) =>/);
  assert.match(SETTINGS, /role="radiogroup"/);
  assert.deepEqual(FIT_LEVEL_MEANINGS, { 1: '중요하지 않음', 2: '조금 중요', 3: '보통', 4: '중요', 5: '매우 중요' });
  assert.equal(PERSONAL_FIT_COPY.settingsTitle, '나에게 맞는 점수 설정');
  for (const f of ['src/components/PersonalFitCard.tsx', 'src/components/my/FitImportanceSettings.tsx', 'src/lib/personal-fit-ui.ts', 'src/hooks/useFitPreference.ts']) {
    assert.ok(!code(f).includes('학군'), f);
  }
  assert.ok(!JSON.stringify(PERSONAL_FIT_COPY).includes('학군'));
});

test('12·13. 기본값 없음: 처음엔 전부 미선택, 5개 모두 골라야 저장 가능', () => {
  const empty = draftFromSaved(null);
  assert.deepEqual(Object.values(empty), [null, null, null, null, null]);
  assert.equal(draftToImportance(empty), null);
  assert.equal(canSaveDraft(empty, null, false), false);
  let d = empty;
  for (const [i, axis] of FIT_AXES.entries()) {
    assert.equal(canSaveDraft(d, null, false), false, `${i}개 선택 상태`);
    d = setDraftLevel(d, axis, 3);
  }
  assert.equal(canSaveDraft(d, null, false), true);
  assert.equal(canSaveDraft(d, null, true), false, '저장 중에는 비활성');
  assert.ok(!/useState<FitImportanceDraft>\(\(\) => draftFromSaved\(\{/.test(SETTINGS));
  assert.match(SETTINGS, /useState<FitImportanceDraft>\(\(\) => draftFromSaved\(null\)\)/);
  assert.match(SETTINGS, /disabled=\{!canSave\}/);
});

test('14·17. 저장: fitImportance만 PUT(관심 목적은 보내지 않음), 성공 시 캐시 갱신, 실패 시 기존 값 유지', () => {
  assert.match(SETTINGS, /method: 'PUT'/);
  assert.match(SETTINGS, /body: JSON\.stringify\(\{ fitImportance: value \}\)/);
  assert.ok(!/purposes/.test(SETTINGS), '관심 목적을 보내지 않음(P2-A: 온 필드만 갱신)');
  assert.match(SETTINGS, /updateCache\(stored\);/);
  assert.match(SETTINGS, /catch \{\s*setSaveState\('error'\);\s*\}/);
});

test('15·16. 저장된 값 다시 불러오기·수정: 기존 값으로 채우고, 바뀌었을 때만 다시 저장', () => {
  const d = draftFromSaved(IMP);
  assert.deepEqual(d, IMP);
  assert.equal(isDraftDirty(d, IMP), false);
  assert.equal(canSaveDraft(d, IMP, false), false, '변경 없음');
  const edited = setDraftLevel(d, 'living', 5);
  assert.equal(isDraftDirty(edited, IMP), true);
  assert.equal(canSaveDraft(edited, IMP, false), true);
  assert.deepEqual(draftToImportance(edited), { ...IMP, living: 5 });
  assert.match(SETTINGS, /setDraft\(draftFromSaved\(state\.fitImportance\)\);/);
});

// ── 개인정보·배선 ─────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test('20·21. 중요도 값은 analytics·URL·로그·저장소(localStorage)로 나가지 않는다', () => {
  // 중요도 값을 직접 다루는 파일(값을 읽거나 보내는 곳). 카드를 렌더만 하는 상세 페이지·캐시 비우기만 하는 MY 페이지는
  // 값을 만지지 않으므로 아래 배선 테스트로 따로 확인한다.
  const valueFiles = walk(join(ROOT, 'src')).filter((f) => /\bfitImportance\b|\bFitImportance\b/.test(readFileSync(f, 'utf8')));
  assert.ok(valueFiles.length >= 6);
  for (const f of valueFiles) {
    const src = code(f.slice(ROOT.length + 1));
    assert.ok(!/trackEvent\(|gtag\(|sendBeacon/.test(src) || !/fitImportance|draft|importance/i.test(src.slice(src.search(/trackEvent\(|gtag\(|sendBeacon/))), `${f}: analytics`);
    assert.ok(!/console\.(log|info|warn|debug)\(/.test(src), `${f}: console`);
    assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(src), `${f}: persistent client storage`);
    assert.ok(!/searchParams\.(set|append)\(|[?&](fitImportance|importance|transport|parking)=/.test(src), `${f}: URL`);
  }
  assert.equal(FIT_SETTINGS_HREF.includes('?'), false);
});

test('카피: 금지 표현 없음, 제목·보조문구·면책 문구 고정', () => {
  const all = JSON.stringify(PERSONAL_FIT_COPY);
  for (const banned of ['추천 점수', '투자 점수', '투자가치', '미래가치', '수익']) assert.ok(!all.includes(banned), banned);
  // "가격 전망"은 면책 문구의 부정형("…가격 전망을 의미하지 않습니다")에만 나온다
  assert.equal(all.split('가격 전망').length - 1, 1);
  assert.equal(PERSONAL_FIT_COPY.title, '나에게 맞는 점수');
  assert.equal(PERSONAL_FIT_COPY.subtitle, '내가 중요하게 보는 조건을 반영한 적합도예요');
  assert.equal(PERSONAL_FIT_COPY.disclaimer, '개인 선호를 반영한 적합도이며, 투자 판단이나 가격 전망을 의미하지 않습니다.');
  assert.match(CARD, /<p className=\{styles\.disclaimer\}>\{COPY\.disclaimer\}<\/p>/);
  assert.match(CARD, /<Link href=\{FIT_SETTINGS_HREF\} className=\{styles\.editLink\}>\s*\{COPY\.editLink\}/);
});

test('24. 모바일: 가로 넘침 방지(min-width 0·grid minmax·줄바꿈), 터치 44px 이상', () => {
  const cardCss = read('src/components/PersonalFitCard.module.css');
  const settingsCss = read('src/components/my/FitImportanceSettings.module.css');
  assert.match(cardCss, /grid-template-columns: minmax\(0, 1fr\) auto auto;/);
  assert.match(cardCss, /\.ctaButton \{[^}]*min-height: 44px/);
  assert.match(cardCss, /\.editLink \{[^}]*min-height: 44px/);
  assert.match(cardCss, /@media \(max-width: 480px\) \{[\s\S]*\.ctaButton \{\s*width: 100%;/);
  assert.match(settingsCss, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/);
  assert.match(settingsCss, /\.level \{[^}]*min-height: 44px/);
  assert.match(settingsCss, /\.saveButton \{[^}]*min-height: 48px/);
  assert.match(cardCss, /\.scoreNumber \{[^}]*font-size: 1\.9rem/, '공통 점수(2.5rem)보다 작게');
});

test('성능: 카드는 공통 점수 로딩을 막지 않고, 선호 조회는 인증 후 카드 안에서만', () => {
  assert.match(CARD, /const \{ state \} = useFitPreference\(\);/);
  assert.ok(!/fetch\(/.test(CARD), '카드가 직접 요청하지 않음');
  assert.ok(!/PersonalFit|useFitPreference/.test(DETAIL.slice(DETAIL.indexOf('fetchCachedResource(`/api/apt/'), DETAIL.indexOf('fetchCachedResource(`/api/apt/') + 1500)), '점수 요청 흐름 무변경');
});
