// E-JIP SCORE V2 STEP 0.7-A §38 — write-plan guard fixture tests. node:test, DB/네트워크 없음.
// RECOVERY_HIGH/MEDIUM/REVIEW/FAILED 판정 자체(HIGH allowed/MEDIUM·REVIEW·FAILED denied/
// same-name collision/different parcel/registry multi-tier fallback)는
// lib/step07-recovery-resolver.test.ts가 이미 15개 fixture로 검증한다 — 여기서는 그
// 판정 *이후*, 실제 write까지 가도 되는지를 결정하는 STEP 0.7-A 고유 guard만 다룬다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isNameGuardExcluded, isUniverseConfirmedApartment, applyFieldPrecedence,
  classifyDistanceBucket, isRegeocodeSafe, resolveDuplicateCoordinateGroup,
} from './step07a-write-guards';

test('NON_TARGET denied: 명시적 name guard(구덕금호류)는 HIGH로 나타나도 제외', () => {
  assert.equal(isNameGuardExcluded('구덕금호아파트'), true);
  assert.equal(isNameGuardExcluded('구덕금호'), true);
  assert.equal(isNameGuardExcluded('금호아파트'), false); // 부분 문자열 오탐 없음
});

test('UNKNOWN universe(주용도 결측, §24-25 실측 1건 26380-19) denied: "공동주택" 양성 확인 없으면 write 대상 아님', () => {
  assert.equal(isUniverseConfirmedApartment(null), false);
  assert.equal(isUniverseConfirmedApartment(undefined), false);
  assert.equal(isUniverseConfirmedApartment('단독주택'), false); // NON_TARGET
  assert.equal(isUniverseConfirmedApartment('업무시설'), false); // MIXED_USE
  assert.equal(isUniverseConfirmedApartment('공동주택'), true);
});

test('existing HIGH preserved: 이미 non-null 필드가 있으면(VERIFIED_EXISTING) candidate로 절대 덮어쓰지 않음', () => {
  const before = { roadAddress: '기존주소', jibunAddress: null, totalHouseholds: 100, mgmBldrgstPk: null };
  const candidate = { roadAddress: '새주소', jibunAddress: '새지번주소', totalHouseholds: 999, mgmBldrgstPk: 'NEW-PK' };
  const r = applyFieldPrecedence({ before, candidate });
  assert.equal(r.alreadyHasValue, true);
  assert.deepEqual(r.after, before); // 완전히 기존 값 그대로, 하나도 덮어쓰지 않음
  assert.equal(r.anyChange, false);
});

test('정상 케이스: 4개 필드 모두 null이던 row는 candidate 값으로 채워짐(anyChange=true)', () => {
  const before = { roadAddress: null, jibunAddress: null, totalHouseholds: null, mgmBldrgstPk: null };
  const candidate = { roadAddress: '새주소', jibunAddress: '새지번주소', totalHouseholds: 100, mgmBldrgstPk: 'PK-1' };
  const r = applyFieldPrecedence({ before, candidate });
  assert.equal(r.alreadyHasValue, false);
  assert.deepEqual(r.after, candidate);
  assert.equal(r.anyChange, true);
});

test('idempotency: 이미 write된(=before와 after가 candidate로 동일해진) row를 같은 candidate로 다시 넣으면 anyChange=false', () => {
  const before = { roadAddress: '주소A', jibunAddress: '지번A', totalHouseholds: 50, mgmBldrgstPk: 'PK-1' };
  const candidate = { roadAddress: '주소A', jibunAddress: '지번A', totalHouseholds: 50, mgmBldrgstPk: 'PK-1' };
  const r = applyFieldPrecedence({ before, candidate });
  assert.equal(r.anyChange, false);
});

test('distance bucket 분류: 100m/300m/1km 경계값', () => {
  assert.equal(classifyDistanceBucket(null), 'noOldCoord');
  assert.equal(classifyDistanceBucket(99), 'under100m');
  assert.equal(classifyDistanceBucket(100), 'under300m');
  assert.equal(classifyDistanceBucket(299), 'under300m');
  assert.equal(classifyDistanceBucket(300), 'under1km');
  assert.equal(classifyDistanceBucket(999), 'under1km');
  assert.equal(classifyDistanceBucket(1000), 'over1km');
  assert.equal(classifyDistanceBucket(5000), 'over1km');
});

test('region mismatch denied: regionCheck=false면 다른 조건이 전부 안전해도 SAFE 아님', () => {
  const safe = isRegeocodeSafe({ newLatLng: { lat: 35.1, lng: 129.1 }, regionCheck: false, distanceDeltaM: 10, isDuplicateSuspicious: false });
  assert.equal(safe, false);
});

test('>=1km 이동 denied: region은 일치해도 1km 이상 이동이면 SAFE 아님', () => {
  const safe = isRegeocodeSafe({ newLatLng: { lat: 35.1, lng: 129.1 }, regionCheck: true, distanceDeltaM: 1000, isDuplicateSuspicious: false });
  assert.equal(safe, false);
});

test('999m 이동은 SAFE(1km 미만 경계값 확인)', () => {
  const safe = isRegeocodeSafe({ newLatLng: { lat: 35.1, lng: 129.1 }, regionCheck: true, distanceDeltaM: 999, isDuplicateSuspicious: false });
  assert.equal(safe, true);
});

test('geocode 실패(좌표 없음) denied', () => {
  const safe = isRegeocodeSafe({ newLatLng: null, regionCheck: null, distanceDeltaM: null, isDuplicateSuspicious: false });
  assert.equal(safe, false);
});

test('duplicate suspicious denied: 좌표 충돌 그룹에 속하면 다른 조건이 안전해도 SAFE 아님', () => {
  const safe = isRegeocodeSafe({ newLatLng: { lat: 35.1, lng: 129.1 }, regionCheck: true, distanceDeltaM: 0, isDuplicateSuspicious: true });
  assert.equal(safe, false);
});

test('duplicate coordinate group: exact 품질이 정확히 1개면 그것만 안전, 나머지 unsafe(production dedup 정책과 동일)', () => {
  const group = [
    { aptSeq: 'A', newStatus: 'exact' },
    { aptSeq: 'B', newStatus: 'normalized' },
    { aptSeq: 'C', newStatus: 'normalized' },
  ];
  const unsafe = resolveDuplicateCoordinateGroup(group);
  assert.equal(unsafe.has('A'), false);
  assert.equal(unsafe.has('B'), true);
  assert.equal(unsafe.has('C'), true);
});

test('duplicate coordinate group: exact가 2개 이상이면(어느 쪽이 맞는지 판단 불가) 그룹 전체 unsafe', () => {
  const group = [
    { aptSeq: 'A', newStatus: 'exact' },
    { aptSeq: 'B', newStatus: 'exact' },
  ];
  const unsafe = resolveDuplicateCoordinateGroup(group);
  assert.equal(unsafe.size, 2);
});

test('duplicate coordinate group: exact가 0개(전부 normalized)면 그룹 전체 unsafe(§16 해운대구 실측 패턴과 동일)', () => {
  const group = [
    { aptSeq: 'A', newStatus: 'normalized' },
    { aptSeq: 'B', newStatus: 'normalized' },
    { aptSeq: 'C', newStatus: 'normalized' },
  ];
  const unsafe = resolveDuplicateCoordinateGroup(group);
  assert.equal(unsafe.size, 3);
});
