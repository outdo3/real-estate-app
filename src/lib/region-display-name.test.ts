import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegionDisplayName, isAllDong, ALL_DONG } from './region-display-name';

/**
 * STATS_HEADER_REGION_LABEL_UX_FIX_V1 §8 — 지역 라벨 계약.
 *
 * 핵심 규칙: **하위 단계를 고르지 않았다는 이유로 그 단계 이름("동")을 문구에 끼워
 * 넣지 않는다.** 아무 동도 고르지 않았으면 "서구 전체"이지 "서구 동 전체"가 아니다.
 */

// ── §8 A~D 지정 케이스 ──────────────────────────────────────────────────────

test('A. 구 선택 + 동 전체 → "부산광역시 서구 전체"', () => {
  assert.equal(
    buildRegionDisplayName({ sido: '부산광역시', sigungu: '서구', dong: 'all' }),
    '부산광역시 서구 전체'
  );
});

test('B. 다른 구에서도 같은 규칙 → "부산광역시 해운대구 전체"', () => {
  assert.equal(
    buildRegionDisplayName({ sido: '부산광역시', sigungu: '해운대구', dong: 'all' }),
    '부산광역시 해운대구 전체'
  );
  assert.equal(
    buildRegionDisplayName({ sido: '부산광역시', sigungu: '부산진구', dong: 'all' }),
    '부산광역시 부산진구 전체'
  );
});

test('C. 동을 고르면 그 동 이름을 쓴다 → "부산광역시 서구 동대신동3가"', () => {
  // 짧은 동 이름(공유 URL이 싣는 형태)
  assert.equal(
    buildRegionDisplayName({ sido: '부산광역시', sigungu: '서구', dong: '동대신동3가' }),
    '부산광역시 서구 동대신동3가'
  );
  // 지역코드 API가 주는 전체 주소 — 앞을 중복해서 붙이지 않는다
  assert.equal(
    buildRegionDisplayName({ sido: '부산광역시', sigungu: '서구', dong: '부산광역시 서구 동대신동3가' }),
    '부산광역시 서구 동대신동3가'
  );
});

test('D. 시군구를 고르지 않으면 → "부산광역시 전체"', () => {
  assert.equal(buildRegionDisplayName({ sido: '부산광역시', sigungu: '', dong: 'all' }), '부산광역시 전체');
  assert.equal(buildRegionDisplayName({ sido: '부산광역시', sigungu: null, dong: 'all' }), '부산광역시 전체');
  assert.equal(buildRegionDisplayName({ sido: '부산광역시' }), '부산광역시 전체');
});

// ── §8 E — "동 전체"가 어떤 조합에서도 생기지 않는다 ────────────────────────

test('E. 어떤 입력 조합에서도 "동 전체"라는 문구를 만들지 않는다', () => {
  const sidos = ['부산광역시', '서울특별시', '경기도'];
  const sigungus = ['', '서구', '해운대구', '부산진구', '수영구', '기장군', '성남시 분당구'];
  const dongs = [undefined, null, '', 'all', '동대신동3가', '우동', '중동'];

  for (const sido of sidos) {
    for (const sigungu of sigungus) {
      for (const dong of dongs) {
        const label = buildRegionDisplayName({ sido, sigungu, dong });
        assert.ok(!label.includes('동 전체'), `"동 전체"가 생겼다: ${JSON.stringify({ sido, sigungu, dong })} → ${label}`);
        assert.ok(!label.includes('읍면동'), `"읍면동"이 생겼다: ${label}`);
      }
    }
  }
});

test('행정 단계 이름을 지역처럼 끼워 넣지 않는다', () => {
  const label = buildRegionDisplayName({ sido: '부산광역시', sigungu: '서구', dong: 'all' });
  // "서구"와 "전체" 사이에 어떤 단계 이름도 없어야 한다.
  assert.equal(label, '부산광역시 서구 전체');
  assert.equal(label.split(' ').length, 3);
});

// ── 경계 / 빈 입력 ──────────────────────────────────────────────────────────

test('시도가 없으면 지역 이름을 지어내지 않는다', () => {
  assert.equal(buildRegionDisplayName({}), '');
  assert.equal(buildRegionDisplayName({ sido: '', sigungu: '서구', dong: '우동' }), '');
  assert.equal(buildRegionDisplayName({ sido: null }), '');
});

test('앞뒤 공백은 정리한다', () => {
  assert.equal(
    buildRegionDisplayName({ sido: '  부산광역시 ', sigungu: ' 서구 ', dong: 'all' }),
    '부산광역시 서구 전체'
  );
  assert.equal(
    buildRegionDisplayName({ sido: '부산광역시', sigungu: '서구', dong: '  동대신동3가  ' }),
    '부산광역시 서구 동대신동3가'
  );
});

test('sigungu가 공백뿐이면 시도 전체로 본다', () => {
  assert.equal(buildRegionDisplayName({ sido: '부산광역시', sigungu: '   ', dong: 'all' }), '부산광역시 전체');
});

// ── isAllDong sentinel ──────────────────────────────────────────────────────

test('isAllDong은 "고르지 않음"을 정확히 판정한다', () => {
  assert.equal(isAllDong(ALL_DONG), true);
  assert.equal(isAllDong('all'), true);
  assert.equal(isAllDong(''), true);
  assert.equal(isAllDong(null), true);
  assert.equal(isAllDong(undefined), true);
  assert.equal(isAllDong('우동'), false);
  assert.equal(isAllDong('동대신동3가'), false);
});

test('"동"으로 시작하는 실제 동 이름을 sentinel로 오해하지 않는다', () => {
  // 동래구의 동, 동대신동 등 — 이름이 "동"으로 시작해도 선택된 동이다.
  assert.equal(isAllDong('동대신동3가'), false);
  assert.equal(
    buildRegionDisplayName({ sido: '부산광역시', sigungu: '동래구', dong: '명륜동' }),
    '부산광역시 동래구 명륜동'
  );
});
