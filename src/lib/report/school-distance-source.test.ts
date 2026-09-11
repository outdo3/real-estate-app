import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNearestSchool } from './nearest-school';
import { absoluteSchoolDistanceBand, ABSOLUTE_DISTANCE_THRESHOLDS_M } from '../apartment-score/server/school-distance-band';

/**
 * SCHOOL_DISTANCE_SOURCE_RECONCILIATION_V1 §7 — 학교 거리 출처 계약 회귀 테스트.
 *
 * 감사 결론(전수 3,381건): Kakao 저장값과 NEIS 계산값은 **99.4%가 5m 이내로 일치**한다.
 * 둘 다 직선거리이며 서로 다른 의미의 지표가 아니다. 그래서 이 STEP은 값을 바꾸지 않고
 * **의미 라벨만** 명시했다. 아래 테스트는 그 계약이 다시 흐려지지 않게 고정한다.
 */

// ── 이름과 거리는 같은 학교 레코드에서 나온다 ──────────────────────────────

const SCHOOLS = [
  { schoolName: '연포초등학교', latitude: 35.1345, longitude: 129.0805 },
  { schoolName: '대남초등학교', latitude: 35.1290, longitude: 129.0900 },
];

test('이름과 거리는 반드시 같은 학교 레코드에서 나온다', () => {
  const apt = { lat: 35.1366, lng: 129.0814 };
  const nearest = findNearestSchool(apt.lat, apt.lng, SCHOOLS);
  assert.ok(nearest);

  // 돌려준 이름의 좌표로 직접 다시 계산해도 같은 거리가 나와야 한다.
  const matched = SCHOOLS.find((s) => s.schoolName === nearest.name);
  assert.ok(matched, '돌려준 이름이 후보 목록에 실재해야 한다');
  const recomputed = findNearestSchool(apt.lat, apt.lng, [matched]);
  assert.equal(recomputed?.distanceM, nearest.distanceM, '이름과 거리가 다른 레코드에서 오면 안 된다');
});

test('가까운 학교의 이름에 먼 학교의 거리가 붙지 않는다', () => {
  const apt = { lat: 35.1366, lng: 129.0814 };
  const nearest = findNearestSchool(apt.lat, apt.lng, SCHOOLS)!;
  const other = SCHOOLS.find((s) => s.schoolName !== nearest.name)!;
  const otherDistance = findNearestSchool(apt.lat, apt.lng, [other])!.distanceM;
  assert.notEqual(nearest.distanceM, otherDistance, '두 학교 거리가 섞이면 이 테스트가 의미를 잃는다');
});

test('학교 신원을 확인할 수 없으면 이름 없는 거리를 대신 쓰지 않는다', () => {
  // 좌표 없는 학교만 있는 경우 — 거리를 지어낼 수 없으므로 null이어야 한다.
  assert.equal(findNearestSchool(35.1366, 129.0814, [{ schoolName: '좌표없음초', latitude: null, longitude: null }]), null);
  // 아파트 좌표가 없는 경우
  assert.equal(findNearestSchool(null, null, SCHOOLS), null);
  // 후보가 아예 없는 경우
  assert.equal(findNearestSchool(35.1366, 129.0814, []), null);
});

test('이름만 있고 좌표가 없는 학교를 이름 후보로 승격시키지 않는다', () => {
  const mixed = [
    { schoolName: '좌표없는가까운초', latitude: null, longitude: null },
    { schoolName: '연포초등학교', latitude: 35.1345, longitude: 129.0805 },
  ];
  assert.equal(findNearestSchool(35.1366, 129.0814, mixed)?.name, '연포초등학교');
});

// ── 거리 의미(직선) ─────────────────────────────────────────────────────────

test('거리는 직선거리다 — 같은 두 점이면 순서와 무관하게 같은 값이다', () => {
  const a = findNearestSchool(35.1366, 129.0814, [SCHOOLS[0]])!;
  const b = findNearestSchool(SCHOOLS[0].latitude, SCHOOLS[0].longitude, [
    { schoolName: 'x', latitude: 35.1366, longitude: 129.0814 },
  ])!;
  assert.equal(a.distanceM, b.distanceM, '직선거리는 대칭이다(경로 거리라면 대칭이 아닐 수 있다)');
});

test('같은 좌표면 0m다', () => {
  const same = findNearestSchool(35.1345, 129.0805, [SCHOOLS[0]]);
  assert.equal(same?.distanceM, 0);
});

test('1km 밖의 학교도 사실대로 돌려준다(반경으로 잘라내지 않는다)', () => {
  // 감사에서 확인된 실제 구간: Kakao는 1km 반경이라 null, NEIS는 1,052~1,422m를 찾아낸다.
  const far = [{ schoolName: '좌산초등학교', latitude: 35.1800, longitude: 129.2000 }];
  const nearest = findNearestSchool(35.1700, 129.1900, far);
  assert.ok(nearest);
  assert.ok(nearest.distanceM > 1000, '반경 밖이라는 이유로 실재하는 학교를 숨기지 않는다');
});

// ── Score 모델은 이 STEP에서 바뀌지 않았다 ─────────────────────────────────

test('학교 접근성 absolute band 임계값은 그대로다(§4 — 승인 없이 점수를 바꾸지 않는다)', () => {
  assert.deepEqual({ ...ABSOLUTE_DISTANCE_THRESHOLDS_M }, {
    VERY_CLOSE: 200,
    CLOSE: 400,
    NORMAL: 650,
    FAR: 933,
  });
});

test('band 분류 동작도 그대로다', () => {
  assert.equal(absoluteSchoolDistanceBand(null), 'UNKNOWN');
  assert.equal(absoluteSchoolDistanceBand(59), 'VERY_CLOSE');
  assert.equal(absoluteSchoolDistanceBand(200), 'VERY_CLOSE');
  assert.equal(absoluteSchoolDistanceBand(249), 'CLOSE');
  assert.equal(absoluteSchoolDistanceBand(376), 'CLOSE');
  assert.equal(absoluteSchoolDistanceBand(513), 'NORMAL');
  assert.equal(absoluteSchoolDistanceBand(933), 'FAR');
  assert.equal(absoluteSchoolDistanceBand(1359), 'VERY_FAR');
});

test('감사에서 드러난 출처 차이가 band를 실제로 옮긴다 — 그래서 승인 전에는 바꾸지 않는다', () => {
  // 26200-22 실측: Kakao 376m vs NEIS 신선초등학교 59m
  assert.equal(absoluteSchoolDistanceBand(376), 'CLOSE');
  assert.equal(absoluteSchoolDistanceBand(59), 'VERY_CLOSE');
  // 26530-104 실측: Kakao 513m vs NEIS 괘법초등학교 130m
  assert.equal(absoluteSchoolDistanceBand(513), 'NORMAL');
  assert.equal(absoluteSchoolDistanceBand(130), 'VERY_CLOSE');
  // 두 쌍 모두 band가 달라진다 = 수집기 출처를 바꾸면 점수가 움직인다는 증거.
});
