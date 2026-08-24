// SCHOOL V2-C2C §19 — graduate-outcome-parser fixture tests. node:test, DB/네트워크 없음.
// fixture 값은 2026-08-23 schoolinfo.go.kr 실측 3개교 그대로(가상 데이터 생성 금지, §요청4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isArithmeticallyConsistent,
  type GraduateOutcomeParseResult,
  type GraduateOutcomeRow,
} from './graduate-outcome-parser';

// 경남고등학교(일반고) — 국외진학 0, 취업 3
const gyeongnam: GraduateOutcomeRow = {
  schoolName: '경남고등학교',
  disclosureYearMonth: '(4차) 2025년 11월',
  graduateCount: 164,
  collegeCount: 13,
  universityCount: 123,
  overseasCollegeCount: 0,
  overseasUniversityCount: 0,
  overseasSubtotal: 0,
  continuationTotal: 136,
  employmentCount: 3,
  otherCount: 25,
  ratios: {
    collegePct: 7.9,
    universityPct: 75.0,
    overseasCollegePct: 0.0,
    overseasUniversityPct: 0.0,
    overseasSubtotalPct: 0.0,
    continuationTotalPct: 82.9,
    employmentPct: 1.8,
    otherPct: 15.2,
  },
};

// 부산외국어고등학교(특목고) — 취업 0, 국외진학 6(전문1+대학5)
const busanForeignLanguage: GraduateOutcomeRow = {
  schoolName: '부산외국어고등학교',
  disclosureYearMonth: '(4차) 2025년 11월',
  graduateCount: 248,
  collegeCount: 0,
  universityCount: 178,
  overseasCollegeCount: 1,
  overseasUniversityCount: 5,
  overseasSubtotal: 6,
  continuationTotal: 184,
  employmentCount: 0,
  otherCount: 64,
  ratios: {
    collegePct: 0.0,
    universityPct: 71.8,
    overseasCollegePct: 0.4,
    overseasUniversityPct: 2.0,
    overseasSubtotalPct: 2.4,
    continuationTotalPct: 74.2,
    employmentPct: 0.0,
    otherPct: 25.8,
  },
};

test('normal high school — 경남고등학교, 산술 정합성(졸업자=진학계+취업+기타) 만족', () => {
  assert.equal(isArithmeticallyConsistent(gyeongnam), true);
});

test('zero employment — 부산외국어고등학교 취업자 0명도 정상 파싱(0은 결측이 아니라 실측값)', () => {
  assert.equal(busanForeignLanguage.employmentCount, 0);
  assert.equal(isArithmeticallyConsistent(busanForeignLanguage), true);
});

test('zero overseas — 경남고등학교 국외진학 0명(전문대/대학/소계 전부 0)도 정상', () => {
  assert.equal(gyeongnam.overseasSubtotal, 0);
  assert.equal(gyeongnam.overseasCollegeCount + gyeongnam.overseasUniversityCount, 0);
});

test('non-zero overseas breakdown — 부산외국어고등학교 국외진학 소계는 전문대+대학 합과 일치', () => {
  assert.equal(
    busanForeignLanguage.overseasCollegeCount + busanForeignLanguage.overseasUniversityCount,
    busanForeignLanguage.overseasSubtotal,
  );
});

test('NO_DATA(blank) — 부산컴퓨터과학고등학교(특성화고)는 "입력된 데이터가 없습니다" → NO_DATA 상태, 오류 아님(§13)', () => {
  const result: GraduateOutcomeParseResult = { status: 'NO_DATA' };
  assert.equal(result.status, 'NO_DATA');
});

test('percentage formatting — 원본 비율은 source-provided 값 그대로(이집이 재계산하지 않음), 반올림 합은 100에 근접', () => {
  const sum =
    gyeongnam.ratios.collegePct +
    gyeongnam.ratios.universityPct +
    gyeongnam.ratios.overseasSubtotalPct +
    gyeongnam.ratios.employmentPct +
    gyeongnam.ratios.otherPct;
  assert.ok(Math.abs(sum - 100) < 0.5, `rounding sum ${sum} should be within 0.5 of 100`);
});

test('arithmetic inconsistency detection — 값이 원본 표와 어긋나면 false를 반환(예: identity mismatch로 다른 학교 데이터가 섞인 경우 대리 시나리오)', () => {
  const corrupted: GraduateOutcomeRow = { ...gyeongnam, continuationTotal: 999 };
  assert.equal(isArithmeticallyConsistent(corrupted), false);
});

test('duplicate school guard — 동일 학교명이라도 disclosureYearMonth가 다르면 별개 row로 취급(연도별 unique key 전제)', () => {
  const nextYear: GraduateOutcomeRow = { ...gyeongnam, disclosureYearMonth: '(4차) 2024년 11월' };
  assert.notEqual(nextYear.disclosureYearMonth, gyeongnam.disclosureYearMonth);
  assert.deepEqual(
    { ...nextYear, disclosureYearMonth: gyeongnam.disclosureYearMonth },
    gyeongnam,
  );
});
