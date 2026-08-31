import assert from 'node:assert/strict';
import test from 'node:test';
import { rankApartmentMatches, normalizeSearchKeyword, matchTier } from './search-ranking.ts';

// §38 A — exact name found
test('A: 정확한 이름으로 검색하면 결과에 포함된다', () => {
  const rows = [{ name: '경동', normalizedName: '경동', totalHouseholds: 72 }];
  const result = rankApartmentMatches(rows, '경동', 15);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, '경동');
});

// §38 B — normalized exact found (아파트 접미사 제거 후 exact)
test('B: "아파트" 접미사를 붙여 검색해도 정규화된 이름과 정확히 일치하면 tier 0이다', () => {
  const normalized = normalizeSearchKeyword('경동아파트');
  assert.equal(normalized, '경동');
  const rows = [{ name: '경동', normalizedName: '경동', totalHouseholds: 72 }];
  assert.equal(matchTier(rows[0], normalized), 0);
});

// §38 C — partial search returns candidates
test('C: 부분 검색(부분 문자열)은 후보를 반환한다(정상 동작)', () => {
  const rows = [
    { name: '해운대경동리인뷰2차', normalizedName: '해운대경동리인뷰2차', totalHouseholds: 632 },
    { name: '경동메르빌', normalizedName: '경동메르빌', totalHouseholds: 451 },
  ];
  const result = rankApartmentMatches(rows, '경동', 15);
  assert.equal(result.length, 2);
});

// §38 D — exact result ranks above partial (household 수와 무관하게)
test('D: household 수가 훨씬 낮아도 exact match가 더 큰 partial match보다 항상 위에 온다', () => {
  const rows = [
    { name: '주례경동리인', normalizedName: '주례경동리인', totalHouseholds: 839 }, // partial, 훨씬 큼
    { name: '경동', normalizedName: '경동', totalHouseholds: 72 }, // exact, 훨씬 작음
  ];
  const result = rankApartmentMatches(rows, '경동', 15);
  assert.equal(result[0].name, '경동', 'exact match(72세대)가 partial match(839세대)보다 먼저 나와야 한다');
});

// §38 F(관련) — 서로 다른 exact-name 단지는 서로의 tier 계산에 영향을 주지 않는다
// (해운대경동제이드로 검색하면 해운대경동제이드만 tier 0, 경동은 tier 2로 유지되어
// 순위 안에 섞여 들어와도 최상단을 차지하지 않는다 — 상세 identity 자체는
// apt-name-match.test.mjs의 SEARCH_DETAIL_IDENTITY_HOTFIX_V2 테스트가 이미 검증).
test('F: 서로 다른 단지명은 서로 다른 tier로 독립적으로 채점된다(교차 오염 없음)', () => {
  const gyeongdong = { name: '경동', normalizedName: '경동', totalHouseholds: 72 };
  const jade = { name: '해운대경동제이드', normalizedName: '해운대경동제이드', totalHouseholds: 278 };
  assert.equal(matchTier(gyeongdong, '해운대경동제이드'), 2); // 경동은 부분포함이지만 exact 아님
  assert.equal(matchTier(jade, '해운대경동제이드'), 0); // 제이드 자신은 exact
  assert.equal(matchTier(jade, '경동'), 2); // "경동"으로 검색해도 "해운대경동제이드"는 "해운대"로 시작해 startsWith가 아니라 contains(2)일 뿐
  assert.equal(matchTier(gyeongdong, '경동'), 0); // 반대로 "경동"으로 검색하면 "경동" 자신은 exact(0)
});

// §38 H — result limit doesn't hide exact match
test('H: limit이 있어도 exact match는 잘려나가지 않는다(15개보다 많은 partial 후보 중에서도)', () => {
  const rows = [
    { name: '경동', normalizedName: '경동', totalHouseholds: 1 }, // exact, 세대수 최하위
    ...Array.from({ length: 20 }, (_, i) => ({
      name: `경동단지${i}`,
      normalizedName: `경동단지${i}`,
      totalHouseholds: 1000 - i, // 전부 훨씬 큼
    })),
  ];
  const result = rankApartmentMatches(rows, '경동', 15);
  assert.equal(result.length, 15);
  assert.ok(result.some((r) => r.name === '경동'), 'exact match는 20개의 더 큰 partial match 속에서도 top-15 안에 있어야 한다');
  assert.equal(result[0].name, '경동');
});

// §38 J — no-result
test('J: 매칭되는 row가 없으면 빈 배열을 반환한다', () => {
  const result = rankApartmentMatches([], '존재안함', 15);
  assert.deepEqual(result, []);
});

test('normalizeSearchKeyword: 공백 제거 + 끝 "아파트" 접미사 제거', () => {
  assert.equal(normalizeSearchKeyword('대신 롯데캐슬'), '대신롯데캐슬');
  assert.equal(normalizeSearchKeyword('대신롯데캐슬아파트'), '대신롯데캐슬');
  assert.equal(normalizeSearchKeyword('아파트'), '아파트'); // 전부 제거되면 원래 값으로 폴백
});
