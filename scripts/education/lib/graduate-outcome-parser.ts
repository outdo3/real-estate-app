// SCHOOL V2-C2C §18 — 13-다(졸업생의 진로 현황) sample parser.
// DB write 없음, 순수 파싱 함수. 입력은 schoolinfo.go.kr
// Pneiss_b01_s0.do?SHL_IDF_CD=...&GS_HANGMOK_CD=06 페이지의 "졸업자 진로 현황
// (진학·취업·기타)" 표(합계/비율 행)에서 실측 확인된 9개 수치 컬럼 그대로다 —
// 웹 화면에 "진학률" 같은 파생 라벨이 보이더라도 원본 컬럼명("계", "비율")을
// 그대로 쓰고 이집이 새 명칭을 만들지 않는다(요청 원칙 §13 준수).
//
// 실측 3개교(2026-08-23, schoolinfo.go.kr 실 데이터):
//   경남고등학교(일반고): 졸업자164, 전문대13, 대학123, 국외진학0, 계136, 취업3, 기타25
//   부산외국어고등학교(특목고): 졸업자248, 전문대0, 대학178, 국외진학6(전문1+대학5), 계184, 취업0, 기타64
//   부산컴퓨터과학고등학교(특성화고): "입력된 데이터가 없습니다" — 공시 없음(NO_DATA)
export interface GraduateOutcomeRow {
  schoolName: string;
  disclosureYearMonth: string; // 원문 그대로, 예: '(4차) 2025년 11월'
  graduateCount: number;
  collegeCount: number; // 전문대학
  universityCount: number; // 대학교
  overseasCollegeCount: number; // 국외진학-전문대학
  overseasUniversityCount: number; // 국외진학-대학교
  overseasSubtotal: number; // 국외진학-소계
  continuationTotal: number; // 진학자 계
  employmentCount: number; // 취업자
  otherCount: number; // 기타
  ratios: {
    collegePct: number;
    universityPct: number;
    overseasCollegePct: number;
    overseasUniversityPct: number;
    overseasSubtotalPct: number;
    continuationTotalPct: number;
    employmentPct: number;
    otherPct: number;
  };
}

export type GraduateOutcomeParseResult =
  | { status: 'DATA'; row: GraduateOutcomeRow }
  | { status: 'NO_DATA' }; // "입력된 데이터가 없습니다" — 공시 자체가 없는 정상 상태, 오류 아님(§13)

// consistency check용 — 파싱 결과가 원본 표의 산술 관계(졸업자=진학계+취업+기타,
// 진학계=전문대+대학+국외소계)를 만족하는지 확인. 위반 시 파싱 실패로 간주해야
// 하므로 값이 아니라 boolean만 반환(호출자가 판단).
export function isArithmeticallyConsistent(row: GraduateOutcomeRow): boolean {
  const continuationSum = row.collegeCount + row.universityCount + row.overseasSubtotal;
  const overseasSum = row.overseasCollegeCount + row.overseasUniversityCount;
  const graduateSum = row.continuationTotal + row.employmentCount + row.otherCount;
  return (
    continuationSum === row.continuationTotal &&
    overseasSum === row.overseasSubtotal &&
    graduateSum === row.graduateCount
  );
}
