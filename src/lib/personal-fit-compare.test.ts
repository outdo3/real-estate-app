import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { calculateScoreV2 } from './score-v2/engine';
import type { ScoreV2Input } from './score-v2/types';
import type { FitImportance } from './fit-importance';
import { calculatePersonalFit } from './personalized-score';
import { buildScore } from './compare-v2/metrics';
import {
  FIT_SETTINGS_HREF,
  PERSONAL_FIT_COPY,
  derivePersonalFitCard,
  deriveComparePersonalFit,
  type ComparePersonalFitSide,
  type FitPreferenceState,
} from './personal-fit-ui';

/**
 * PERSONALIZED_SCORE_V1 P2-D — 비교 화면 "나에게 맞는 점수" 계약.
 * 두 단지에 같은 중요도로 P2-B 엔진(상세 카드와 같은 판정)을 적용한 결과만 쓰는지, 공통 점수·요청 흐름이 그대로인지 고정한다.
 */

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const COMPARE = code('src/components/compare/CompareV2.tsx');
const FETCH = code('src/lib/compare-v2/fetch.ts');

const IMP: FitImportance = { transport: 5, living: 3, newness: 4, parking: 5, elementarySchoolAccess: 2 };
const ready = (fitImportance: FitImportance | null): FitPreferenceState => ({ kind: 'READY', fitImportance });
const wire = (x: unknown) => JSON.parse(JSON.stringify(x));

function v2(over: Partial<ScoreV2Input> = {}) {
  return wire(
    calculateScoreV2(
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
    )
  );
}
const FULL_A = v2();
const FULL_B = v2({ buildYear: 1990, nearestSubwayDistanceM: 900, parkingRatio: 0.7 });
const LIMITED_PARKING_TRANSPORT = v2({ parkingRatio: null, parkingRawStatus: 'MISSING', subwayStatus: 'MISSING', nearestSubwayDistanceM: null, nearestBusStopDistanceM: null, busStopCount300m: null });
const NO_COMMON = v2({ identityEligible: false });
const LIMITED_IMP: FitImportance = { transport: 5, living: 1, newness: 1, parking: 5, elementarySchoolAccess: 1 };

const scores = (m: ReturnType<typeof deriveComparePersonalFit>) => {
  assert.equal(m.kind, 'SCORES');
  return m as Extract<typeof m, { kind: 'SCORES' }>;
};
const sideScore = (s: ComparePersonalFitSide) => (s.kind === 'SCORE' ? s.score : null);

test('1·2. 비로그인 → 비교 섹션 전체에 로그인 CTA 한 번, 선호 요청은 공용 훅 규칙(인증 시에만)', () => {
  assert.deepEqual(deriveComparePersonalFit({ shadowA: FULL_A, shadowB: FULL_B, preference: { kind: 'LOGGED_OUT' } }), { kind: 'LOGGED_OUT' });
  assert.equal(PERSONAL_FIT_COPY.compareLoggedOut, '로그인하면 나에게 맞는 점수로 비교할 수 있어요');
  assert.equal(PERSONAL_FIT_COPY.compareLoggedOutCta, '로그인하고 비교');
  assert.equal((COMPARE.match(/\{PERSONAL_FIT_COPY\.compareLoggedOutCta\}/g) ?? []).length, 1, 'A/B마다 반복하지 않음');
  assert.equal((COMPARE.match(/<LoginModal /g) ?? []).length, 1);
  assert.match(COMPARE, /const \{ state \} = useFitPreference\(\);/);
  assert.ok(!/\/api\/my\/preferences/.test(COMPARE), '비교 화면이 선호 API를 직접 부르지 않음(공용 캐시만)');
});

test('3. 로그인 + 미설정 → 설정 CTA 한 번(/my#fit-score-settings), 숫자 없음', () => {
  assert.deepEqual(deriveComparePersonalFit({ shadowA: FULL_A, shadowB: FULL_B, preference: ready(null) }), { kind: 'NO_SETTINGS' });
  assert.equal(PERSONAL_FIT_COPY.compareNoSettings, '중요하게 보는 조건을 설정하면 나에게 맞는 점수로 비교할 수 있어요');
  assert.equal((COMPARE.match(/<Link href=\{FIT_SETTINGS_HREF\} className=\{styles\.fitCta\}[^>]*>/g) ?? []).length, 1);
  assert.equal(FIT_SETTINGS_HREF, '/my#fit-score-settings');
});

test('4·5·15. 설정됨 → A/B 점수, 두 단지 모두 같은 중요도로 P2-B 엔진 결과와 일치', () => {
  const m = scores(deriveComparePersonalFit({ shadowA: FULL_A, shadowB: FULL_B, preference: ready(IMP) }));
  const ea = calculatePersonalFit({ shadowV2: FULL_A, fitImportance: IMP });
  const eb = calculatePersonalFit({ shadowV2: FULL_B, fitImportance: IMP });
  if (ea.status === 'UNAVAILABLE' || eb.status === 'UNAVAILABLE') return assert.fail('engine unavailable');
  assert.equal(sideScore(m.a), ea.score);
  assert.equal(sideScore(m.b), eb.score);
  assert.notEqual(ea.score, eb.score, '두 단지가 실제로 다른 점수(같은 중요도)');
  // 상세 카드와 같은 판정 경로
  const da = derivePersonalFitCard({ scoreLoading: false, shadowV2: FULL_A, preference: ready(IMP) });
  assert.ok(da.kind === 'SCORE' && m.a.kind === 'SCORE' && da.score === m.a.score && da.status === m.a.status);
});

test('6. FULL/FULL', () => {
  const m = scores(deriveComparePersonalFit({ shadowA: FULL_A, shadowB: FULL_B, preference: ready(IMP) }));
  assert.deepEqual([m.a.kind, m.b.kind], ['SCORE', 'SCORE']);
  assert.ok(m.a.kind === 'SCORE' && m.a.status === 'FULL' && m.a.excludedTexts.length === 0);
  assert.ok(m.b.kind === 'SCORE' && m.b.status === 'FULL');
});

test('7·12·13. FULL/LIMITED: 제외 축은 사유로만(점수 0 아님), 쪽마다 따로', () => {
  const m = scores(deriveComparePersonalFit({ shadowA: FULL_A, shadowB: LIMITED_PARKING_TRANSPORT, preference: ready(LIMITED_IMP) }));
  assert.ok(m.a.kind === 'SCORE' && m.a.status === 'FULL' && m.a.excludedTexts.length === 0);
  assert.ok(m.b.kind === 'SCORE' && m.b.status === 'LIMITED');
  if (m.b.kind !== 'SCORE') return;
  assert.deepEqual(m.b.excludedTexts, ['교통 정보 없음', '주차 정보 없음']);
  assert.ok(m.b.score > 0, '제외 축이 0점으로 끌어내리지 않음(재정규화)');
  assert.match(COMPARE, /side\.excludedTexts\.length > 0 \? side\.excludedTexts\.join\(', '\) : PERSONAL_FIT_COPY\.compareAllIncluded/);
  assert.equal(PERSONAL_FIT_COPY.compareAllIncluded, '전체 조건 반영');
  assert.match(COMPARE, /side\.status === 'LIMITED' && <span className=\{styles\.fitLimited\}>\{PERSONAL_FIT_COPY\.badgeLimited\}<\/span>/);
});

test('8·11. FULL/UNAVAILABLE: 계산 불가 쪽은 "정보 부족", 다른 쪽 점수는 그대로', () => {
  const m = scores(deriveComparePersonalFit({ shadowA: FULL_A, shadowB: NO_COMMON, preference: ready(IMP) }));
  assert.equal(m.a.kind, 'SCORE');
  assert.deepEqual(m.b, { kind: 'UNAVAILABLE' });
  const m2 = scores(deriveComparePersonalFit({ shadowA: undefined, shadowB: FULL_B, preference: ready(IMP) }));
  assert.deepEqual(m2.a, { kind: 'UNAVAILABLE' });
  assert.equal(m2.b.kind, 'SCORE');
  assert.equal(PERSONAL_FIT_COPY.compareUnavailable, '정보 부족');
  assert.match(COMPARE, /<span className=\{styles\.fitUnavailable\}>\{PERSONAL_FIT_COPY\.compareUnavailable\}<\/span>/);
});

test('9. LIMITED/LIMITED', () => {
  const m = scores(deriveComparePersonalFit({ shadowA: LIMITED_PARKING_TRANSPORT, shadowB: LIMITED_PARKING_TRANSPORT, preference: ready(LIMITED_IMP) }));
  assert.ok(m.a.kind === 'SCORE' && m.a.status === 'LIMITED' && m.b.kind === 'SCORE' && m.b.status === 'LIMITED');
});

test('10. UNAVAILABLE/UNAVAILABLE → 섹션 숨김(계산 대상 없음, 기존 ScoreSection도 둘 다 없으면 렌더 안 함)', () => {
  for (const pref of [ready(IMP), ready(null), { kind: 'LOGGED_OUT' } as FitPreferenceState]) {
    assert.deepEqual(deriveComparePersonalFit({ shadowA: NO_COMMON, shadowB: undefined, preference: pref }), { kind: 'HIDDEN' });
  }
  assert.match(COMPARE, /if \(!a\.score\?\.available && !b\.score\?\.available\) return null;/);
});

test('로딩·조회 실패 상태', () => {
  assert.deepEqual(deriveComparePersonalFit({ shadowA: FULL_A, shadowB: FULL_B, preference: { kind: 'LOADING' } }), { kind: 'PLACEHOLDER' });
  assert.deepEqual(deriveComparePersonalFit({ shadowA: FULL_A, shadowB: FULL_B, preference: { kind: 'ERROR' } }), { kind: 'ERROR' });
});

test('14. 공통 점수 불변: 기존 막대·peer 줄 그대로, 개인화는 그 아래 별도 블록, 응답 객체 불변', () => {
  const before = JSON.stringify([FULL_A, FULL_B]);
  deriveComparePersonalFit({ shadowA: FULL_A, shadowB: FULL_B, preference: ready(IMP) });
  assert.equal(JSON.stringify([FULL_A, FULL_B]), before);
  const section = COMPARE.slice(COMPARE.indexOf('function ScoreSection('), COMPARE.indexOf('function PersonalFitCompareBlock('));
  assert.match(section, /<div className=\{styles\.panelTitle\}>이집 분석 \(절대 평가 — 순위 아님\)<\/div>/);
  assert.match(section, /<ScoreBar score=\{da\?\.score \?\? null\} \/>\s*<ScoreBar score=\{db\?\.score \?\? null\} \/>/);
  assert.ok(section.indexOf('styles.peerRow') < section.indexOf('<PersonalFitCompareBlock a={a} b={b} />'), '공통 영역 아래');
  // 공통 점수 매핑(buildScore)은 _shadowV2를 그대로 쓰고, 새 필드는 원본을 전달만
  const s = buildScore({ _shadowV2: FULL_A, peerContext: null });
  assert.equal(s.overallScore, FULL_A.overallScore);
  assert.match(FETCH, /const score = buildScore\(scoreJson\);/);
  assert.match(FETCH, /scoreV2: scoreJson\?\._shadowV2 \?\? null,/);
});

test('16. 점수 공식 중복 없음: 비교 화면·모델이 가중합·임계값을 직접 계산하지 않음', () => {
  const block = COMPARE.slice(COMPARE.indexOf('function PersonalFitCompareBlock('));
  assert.ok(!/importance|reduce\(|\* |calculatePersonalFit|>= 0\.6|< 0\.6/.test(block));
  assert.match(code('src/lib/personal-fit-ui.ts'), /const a = derivePersonalFitCard\(\{ scoreLoading: false, shadowV2: input\.shadowA, preference: input\.preference \}\);/);
});

test('17. 선호 캐시 재사용: 비교 전용 fetch/cache 구현 없음', () => {
  assert.ok(!/createFitPreferenceCache|fitPreferenceCache|new Map|fetch\(/.test(COMPARE.slice(COMPARE.indexOf('function PersonalFitCompareBlock('))));
  assert.match(COMPARE, /import \{ useFitPreference \} from '@\/hooks\/useFitPreference';/);
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test('18·19. analytics·URL로 중요도 값이 나가지 않음, 기존 비교 analytics 호출 목록 불변', () => {
  // P2-D 이전 CompareV2.tsx(HEAD bd54269)의 호출과 이름·횟수가 같다
  const tracked = [...COMPARE.matchAll(/trackEvent\('([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(tracked, ['compare_add', 'compare_detail_click', 'compare_detail_click', 'compare_remove', 'compare_start', 'finance_fit_from_compare', 'finance_fit_from_compare']);
  const block = COMPARE.slice(COMPARE.indexOf('function PersonalFitCompareBlock('));
  assert.ok(!/trackEvent|searchParams|router\.(push|replace)|localStorage/.test(block));
  for (const f of walk(join(ROOT, 'src/lib/compare-v2'))) {
    assert.ok(!/fitImportance|FitImportance/.test(readFileSync(f, 'utf8')), `${f}: 비교 URL·공유 로직에 중요도 없음`);
  }
});

test('20. "학군" 없음, 라벨 정확', () => {
  const block = COMPARE.slice(COMPARE.indexOf('function PersonalFitCompareBlock('));
  assert.ok(!block.includes('학군'));
  assert.ok(!JSON.stringify(PERSONAL_FIT_COPY).includes('학군'));
  assert.match(block, /\{PERSONAL_FIT_COPY\.title\}/);
  assert.match(block, /\{PERSONAL_FIT_COPY\.badgeFull\}/);
  assert.equal((block.match(/\{PERSONAL_FIT_COPY\.disclaimer\}/g) ?? []).length, 1, '면책은 섹션에 한 번');
});

test('21. 모바일: A/B 칸 minmax(0,1fr)로 넘침 방지, 점수·"정보 부족" 줄바꿈 금지, 제외 사유 2줄 제한, CTA 전체 폭 44px', () => {
  const css = read('src/components/compare/CompareV2.module.css');
  assert.match(css, /\.fitRow \{[^}]*grid-template-columns: 44px minmax\(0, 1fr\) minmax\(0, 1fr\);/);
  assert.match(css, /\.domainRow \{\s*display: grid;\s*grid-template-columns: 44px 1fr 1fr;/, '공통 막대 줄과 같은 첫 칸 폭');
  assert.match(css, /\.fitScore \{[^}]*white-space: nowrap/);
  assert.match(css, /\.fitUnavailable \{[^}]*white-space: nowrap/);
  assert.match(css, /\.fitCoverage \{[^}]*-webkit-line-clamp: 2/);
  assert.match(css, /\.fitCta \{[^}]*width: 100%;[^}]*min-height: 44px/);
});

test('22. 비교 최대 2곳 동작 불변', () => {
  assert.match(COMPARE, /const \[slots, setSlots\] = useState<\(SlotState \| null\)\[\]>\(\[null, null\]\);/);
  assert.match(COMPARE, /최대 2개까지 비교할 수 있어요/);
  assert.match(COMPARE, /<ScoreSection a=\{both\[0\]\} b=\{both\[1\]\} \/>/);
});
