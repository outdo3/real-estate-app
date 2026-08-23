// E-JIP SCORE V2 STEP 0.7-A — write-plan 단계 guard 함수들(순수 함수, DB/네트워크 없음).
// step07a-02(registry dry-run)/step07a-06(regeocode dry-run)이 재사용한다. resolver
// 레벨 로직(RECOVERY_HIGH/MEDIUM/REVIEW/FAILED 판정)은 lib/step07-recovery-resolver.ts
// 소관이라 여기서 다시 만들지 않는다 — 이 파일은 "HIGH로 판정된 이후, 실제 write까지
// 가도 되는가"를 결정하는 한 단계 더 보수적인 방어선만 다룬다.

// §5 명시적 exclusion guard(negative benchmark) — HIGH로 나타나도 무조건 차단.
export const EXCLUDED_NAME_GUARD = ['구덕금호'];

export function isNameGuardExcluded(aptName: string | null | undefined): boolean {
  if (!aptName) return false;
  return EXCLUDED_NAME_GUARD.some((n) => aptName.includes(n));
}

// resolver의 classifyUniverse는 mainPurpsCdNm이 falsy(registry 데이터 결측)면
// universeFlag='UNKNOWN'을 반환하는데, classifyRecovery는 MIXED_USE/NON_TARGET만
// MEDIUM으로 걸러내고 UNKNOWN은 걸러내지 않는다 — 그래서 "공동주택" 양성 확인이 없는
// row는(근거가 강해 보여도) 여기서 별도로 다시 막는다(§24-25 실측 1건, 26380-19).
export function isUniverseConfirmedApartment(mainPurpsCdNm: string | null | undefined): boolean {
  return mainPurpsCdNm === '공동주택';
}

export interface FieldPrecedenceInput {
  before: { roadAddress: string | null; jibunAddress: string | null; totalHouseholds: number | null; mgmBldrgstPk: string | null };
  candidate: { roadAddress: string | null; jibunAddress: string | null; totalHouseholds: number | null; mgmBldrgstPk: string | null };
}
export interface FieldPrecedenceResult {
  after: FieldPrecedenceInput['before'];
  alreadyHasValue: boolean; // VERIFIED_EXISTING이 이미 있어 candidate로 덮어쓰지 않음(방어적 재확인 — 정상 흐름에선 발생하지 않아야 함)
  anyChange: boolean;
}
// precedence: VERIFIED_EXISTING(기존 non-null 값) > RECOVERY_HIGH candidate > LOWER_CONFIDENCE.
// 4개 필드 모두 이미 non-null이면(=highRisk 정의 위반, 이론상 불가능해야 하나 방어적으로
// 재확인) candidate로 덮어쓰지 않고 기존 값을 그대로 유지한다.
export function applyFieldPrecedence({ before, candidate }: FieldPrecedenceInput): FieldPrecedenceResult {
  const alreadyHasValue = before.roadAddress != null || before.jibunAddress != null || before.totalHouseholds != null || before.mgmBldrgstPk != null;
  const after = alreadyHasValue ? before : {
    roadAddress: candidate.roadAddress ?? before.roadAddress,
    jibunAddress: candidate.jibunAddress ?? before.jibunAddress,
    totalHouseholds: candidate.totalHouseholds ?? before.totalHouseholds,
    mgmBldrgstPk: candidate.mgmBldrgstPk ?? before.mgmBldrgstPk,
  };
  const anyChange = before.roadAddress !== after.roadAddress || before.jibunAddress !== after.jibunAddress
    || before.totalHouseholds !== after.totalHouseholds || before.mgmBldrgstPk !== after.mgmBldrgstPk;
  return { after, alreadyHasValue, anyChange };
}

export function classifyDistanceBucket(distanceDeltaM: number | null): 'noOldCoord' | 'under100m' | 'under300m' | 'under1km' | 'over1km' {
  if (distanceDeltaM == null) return 'noOldCoord';
  if (distanceDeltaM < 100) return 'under100m';
  if (distanceDeltaM < 300) return 'under300m';
  if (distanceDeltaM < 1000) return 'under1km';
  return 'over1km';
}

export interface RegeocodeSafetyInput {
  newLatLng: { lat: number; lng: number } | null;
  regionCheck: boolean | null; // true=일치, false=불일치, null=old 좌표 없어 판단 불가(신규는 아래서 별도 처리)
  distanceDeltaM: number | null;
  isDuplicateSuspicious: boolean;
}
// §16 sanity gate: region mismatch, >=1km 이동, duplicate suspicious 중 하나라도 걸리면
// 자동 write 금지(수동 검토로 이관). geocode 자체가 실패(newLatLng null)해도 당연히 제외.
export function isRegeocodeSafe(i: RegeocodeSafetyInput): boolean {
  if (i.newLatLng == null) return false;
  if (i.regionCheck === false) return false;
  if (i.distanceDeltaM != null && i.distanceDeltaM >= 1000) return false;
  if (i.isDuplicateSuspicious) return false;
  return true;
}

// production apartment_master_seed.ts:deduplicateCoordinates()와 동일한 원칙: 같은
// 좌표를 공유하는 그룹에서 exact 품질이 정확히 1개면 그것만 신뢰하고 나머지는 unsafe,
// exact가 여럿(또는 0)이면 그룹 전체 unsafe.
export function resolveDuplicateCoordinateGroup<T extends { aptSeq: string; newStatus: string }>(group: T[]): Set<string> {
  const exactMembers = group.filter((g) => g.newStatus === 'exact');
  const unsafe = exactMembers.length === 1 ? group.filter((g) => g !== exactMembers[0]) : group;
  return new Set(unsafe.map((g) => g.aptSeq));
}
