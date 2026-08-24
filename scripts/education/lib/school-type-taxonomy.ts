// SCHOOL V2-C2B-B §2/§3 — canonical School.schoolLevel(NEIS 원문) → 리포트/분석용
// 5버킷(ELEMENTARY/MIDDLE/HIGH/SPECIAL/OTHER) 확정 매핑. DB에 저장된 원문은
// 절대 건드리지 않는다 — 이 표는 파생 라벨 전용.
//
// exact-value lookup만 쓴다(regex/substring 재사용 안 함) — C2A(ingest-schools-neis.ts
// bucketSchoolLevel)와 C2B-A(schoolinfo-identity-resolver.ts bucketNeisLevel)가
// 서로 다른 substring 패턴을 써서 "각종학교(중/고)", "평생학교(중/고)-*",
// "고등기술학교" 같은 케이스를 서로 다르게(때로는 둘 다 틀리게) 분류한 사고가
// 이번 STEP의 발단이었다 — 같은 부류 실수를 원천 차단하기 위해 부산 664건 전수
// 조사로 확인된 14개 원문값을 전부 명시적으로 나열한다. 새 원문값이 나타나면
// (예: 전국 확장 시) UNKNOWN_RAW_VALUE로 드러나야지 조용히 다른 버킷에 섞이면
// 안 된다.
export type SchoolTypeBucket = 'ELEMENTARY' | 'MIDDLE' | 'HIGH' | 'SPECIAL' | 'OTHER';

export const FINAL_SCHOOL_TYPE_TAXONOMY: Record<string, { bucket: SchoolTypeBucket; rationale: string }> = {
  '초등학교': { bucket: 'ELEMENTARY', rationale: '정규 초등교육과정' },
  '중학교': { bucket: 'MIDDLE', rationale: '정규 중등교육과정' },
  '방송통신중학교': { bucket: 'MIDDLE', rationale: '중학교 학력인정, 방송통신 방식 — 교육과정 급은 중학교' },
  '각종학교(중)': { bucket: 'MIDDLE', rationale: '각종학교이나 이수 과정이 중학교급' },
  '평생학교(중)-2년6학기': { bucket: 'MIDDLE', rationale: '학력인정 평생교육시설, 중학교 학력 인정 과정' },
  '고등학교': { bucket: 'HIGH', rationale: '정규 고등교육과정' },
  '방송통신고등학교': { bucket: 'HIGH', rationale: '고등학교 학력인정, 방송통신 방식' },
  '각종학교(고)': { bucket: 'HIGH', rationale: '각종학교이나 이수 과정이 고등학교급' },
  '평생학교(고)-3년6학기': { bucket: 'HIGH', rationale: '학력인정 평생교육시설, 고등학교 학력 인정(3년제 상당)' },
  '평생학교(고)-2년6학기': { bucket: 'HIGH', rationale: '학력인정 평생교육시설, 고등학교 학력 인정(2년제 상당)' },
  '고등기술학교': { bucket: 'HIGH', rationale: '산업교육진흥법 등에 근거한 고등학교급 기술교육기관' },
  '특수학교': { bucket: 'SPECIAL', rationale: '특수교육대상자를 위한 별도 학교 체계' },
  '공동실습소': { bucket: 'OTHER', rationale: '특정 학교급에 속하지 않는 실습 전용 시설 — 학생이 소속되는 "학교"가 아님' },
  '외국인학교': { bucket: 'OTHER', rationale: '국내 정규 학제(초중고) 밖의 별도 인가 체계' },
};

// 비표준 학교유형(SchoolInfo apiType=09가 실측상 다루지 않는 것으로 확인된 부류,
// C2B-B §7 실측 근거) — SOURCE_NOT_APPLICABLE 판정에 사용.
export const NON_STANDARD_LEVEL_PATTERN = /방송통신|평생학교|외국인학교|공동실습소|각종학교/;

export function finalSchoolTypeBucket(raw: string | null): SchoolTypeBucket | 'UNKNOWN_RAW_VALUE' {
  if (!raw) return 'OTHER';
  const entry = FINAL_SCHOOL_TYPE_TAXONOMY[raw];
  return entry ? entry.bucket : 'UNKNOWN_RAW_VALUE';
}
