// E-JIP SCORE V2 STEP 0.7 §31/§32 — recovery resolver fixture tests. node:test, DB/네트워크 없음.
// 핵심 성공 기준(지시사항): false-positive(잘못된 RECOVERY_HIGH) = 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRecovery, type RecoveryInput } from './step07-recovery-resolver';
import type { RegistryProbeResult } from './step07-registry-probe';

function probe(overrides: Partial<RegistryProbeResult>): RegistryProbeResult {
  return {
    status: 'success', tier: 'title', totalHouseholds: 100, mainBuildingCount: 1, parkingCount: 50,
    mgmBldrgstPk: 'PK-1', roadAddress: '부산광역시 서구 테스트로 1', jibunAddress: '부산광역시 서구 테스트동 1',
    bldNm: '테스트아파트', mainPurpsCdNm: '공동주택', approvalYear: 2020, recordCount: 1,
    ...overrides,
  };
}
function input(overrides: Partial<RecoveryInput>): RecoveryInput {
  return { aptSeq: '26140-TEST', aptName: '테스트', buildYear: 2020, probe: probe({}), ...overrides };
}

test('exact match(§9 실측: 충무제1 케이스) -> RECOVERY_HIGH', () => {
  const r = classifyRecovery(input({ aptName: '충무제1', probe: probe({ bldNm: '충무제1아파트' }) }));
  assert.equal(r.level, 'RECOVERY_HIGH');
  assert.equal(r.nameMatch, 'exact');
});

test('normalized-safe match(§9 실측: 동부현대 vs 등록명 현대아파트, 주소 유일) -> RECOVERY_HIGH(이름 비차단, superset 신호)', () => {
  const r = classifyRecovery(input({ aptName: '동부현대', buildYear: 1985, probe: probe({ bldNm: '현대아파트', approvalYear: 1985 }) }));
  assert.equal(r.level, 'RECOVERY_HIGH');
  assert.equal(r.nameMatch, 'superset');
});

test('완전히 다른 이름(공통 부분 없음)이어도 주소가 유일하면 -> RECOVERY_HIGH(mismatch, 이름 비차단)', () => {
  const r = classifyRecovery(input({ aptName: '가나다빌라', probe: probe({ bldNm: '희망아파트' }) }));
  assert.equal(r.level, 'RECOVERY_HIGH');
  assert.equal(r.nameMatch, 'mismatch');
});

test('same-address collision(recordCount>1, §17) -> RECOVERY_REVIEW, 절대 HIGH 아님', () => {
  const r = classifyRecovery(input({ probe: probe({ recordCount: 2 }) }));
  assert.equal(r.level, 'RECOVERY_REVIEW');
});

test('차수(phase) 불일치(§17 adversarial case: 후보=2차, registry=1차) -> RECOVERY_REVIEW', () => {
  const r = classifyRecovery(input({ aptName: '롯데캐슬2차', probe: probe({ bldNm: '롯데캐슬1차' }) }));
  assert.equal(r.level, 'RECOVERY_REVIEW');
  assert.equal(r.nameMatch, 'chasu_mismatch');
});

test('후보 이름에 명시적 "N차" 없이 끝자리 숫자만 있는 경우(§9 실측: 럭키주례2) -> chasu 패턴 미매치, HIGH 유지(bare 숫자는 차수로 간주하지 않음, 과대 REVIEW 방지)', () => {
  const r = classifyRecovery(input({ aptName: '럭키주례2', probe: probe({ bldNm: '럭키주례아파트' }) }));
  assert.equal(r.level, 'RECOVERY_HIGH');
  assert.notEqual(r.nameMatch, 'chasu_mismatch');
});

test('양쪽 모두 명시적 "N차"가 있고 값이 다름(후보=1차, registry엔 차수 없이 별개 표기) -> chasu_mismatch만 registry 쪽에 없을 때도 보수적으로 REVIEW', () => {
  const r = classifyRecovery(input({ aptName: '협성르네상스2차', probe: probe({ bldNm: '협성르네상스' }) }));
  assert.equal(r.level, 'RECOVERY_REVIEW');
  assert.equal(r.nameMatch, 'chasu_mismatch');
});

test('건축년도 불일치(허용치 3년 초과) -> RECOVERY_REVIEW', () => {
  const r = classifyRecovery(input({ buildYear: 1990, probe: probe({ approvalYear: 2020 }) }));
  assert.equal(r.level, 'RECOVERY_REVIEW');
  assert.equal(r.buildYearConsistent, false);
});

test('건축년도 근소 차이(2년, 허용치 이내) -> HIGH 유지', () => {
  const r = classifyRecovery(input({ buildYear: 2018, probe: probe({ approvalYear: 2020 }) }));
  assert.equal(r.level, 'RECOVERY_HIGH');
  assert.equal(r.buildYearConsistent, true);
});

test('주용도 != 공동주택(§9 실측: 업무시설/근린생활시설) -> RECOVERY_MEDIUM(HIGH 아님)', () => {
  const r = classifyRecovery(input({ probe: probe({ mainPurpsCdNm: '업무시설' }) }));
  assert.equal(r.level, 'RECOVERY_MEDIUM');
  assert.equal(r.universeFlag, 'MIXED_USE');
});

test('주용도 != 공동주택(§12 실측: 구덕금호=단독주택, negative benchmark) -> RECOVERY_MEDIUM(HIGH 아님), universeFlag=NON_TARGET', () => {
  const r = classifyRecovery(input({ aptName: '구덕금호', probe: probe({ mainPurpsCdNm: '단독주택' }) }));
  assert.equal(r.level, 'RECOVERY_MEDIUM');
  assert.equal(r.universeFlag, 'NON_TARGET');
});

test('세대수(hhldCnt) 없음(주소만 확보) -> RECOVERY_MEDIUM', () => {
  const r = classifyRecovery(input({ probe: probe({ totalHouseholds: null }) }));
  assert.equal(r.level, 'RECOVERY_MEDIUM');
});

test('registry not_found(양쪽 tier 모두 실패) -> RECOVERY_FAILED', () => {
  const r = classifyRecovery(input({ probe: probe({ status: 'not_found', tier: null, bldNm: null, mainPurpsCdNm: null, totalHouseholds: null, recordCount: 0 }) }));
  assert.equal(r.level, 'RECOVERY_FAILED');
});

test('jibun parse_error(산지번 등 구조적 실패) -> RECOVERY_FAILED', () => {
  const r = classifyRecovery(input({ probe: probe({ status: 'parse_error', tier: null, bldNm: null, mainPurpsCdNm: null, totalHouseholds: null, recordCount: 0 }) }));
  assert.equal(r.level, 'RECOVERY_FAILED');
});

test('api_error(요청 실패, 재시도 소진) -> RECOVERY_FAILED(guess 없음)', () => {
  const r = classifyRecovery(input({ probe: probe({ status: 'api_error', tier: null, bldNm: null, mainPurpsCdNm: null, totalHouseholds: null, recordCount: 0 }) }));
  assert.equal(r.level, 'RECOVERY_FAILED');
});

test('false-positive 방지 회귀: recordCount>1 이면 다른 조건이 전부 완벽해도 HIGH 불가', () => {
  const r = classifyRecovery(input({
    aptName: '완벽매칭', buildYear: 2020,
    probe: probe({ bldNm: '완벽매칭아파트', approvalYear: 2020, mainPurpsCdNm: '공동주택', totalHouseholds: 500, recordCount: 3 }),
  }));
  assert.notEqual(r.level, 'RECOVERY_HIGH');
});
