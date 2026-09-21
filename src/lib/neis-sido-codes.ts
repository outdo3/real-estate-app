// NEIS(교육정보 개방포털) 시/도 교육청 코드
export const NEIS_SIDO_CODES: Record<string, string> = {
  '서울특별시': 'B10', '부산광역시': 'C10', '대구광역시': 'D10', '인천광역시': 'E10',
  '광주광역시': 'F10', '대전광역시': 'G10', '울산광역시': 'H10', '세종특별자치시': 'I10',
  '경기도': 'J10', '강원특별자치도': 'K10', '충청북도': 'M10', '충청남도': 'N10',
  '전북특별자치도': 'P10', '전라남도': 'Q10', '경상북도': 'R10', '경상남도': 'S10', '제주특별자치도': 'T10'
};

// "부산광역시 서구" 형태의 region 문자열에서 시/도명으로 교육청 코드를 조회.
// 매칭되지 않으면 null을 반환한다(임의의 다른 지역으로 조용히 대체하지 않기 위함).
export function resolveNeisEduCode(sido: string): string | null {
  return NEIS_SIDO_CODES[sido] || null;
}

/**
 * 학교 주소가 **선택한 시/군/구와 정확히 일치**하는지 판정한다.
 *
 * SCHOOL_DISTRICT_IDENTITY_BUG_FIX_V1 — 예전에는 토큰 완전일치 앞에
 * `if (addr.includes(region)) return true;` 라는 **fail-open 지름길**이 있었다.
 * 시/군/구가 비어 있으면(region이 "부산광역시 " 꼴) 그 한 줄이 주소에 "부산광역시 "가
 * 들어간 **모든 학교**를 통과시켜, 부산 671곳 중 663곳이 한 목록에 쏟아졌다(실측).
 * 사용자가 본 "(가칭)명지3고등학교(부산진구) + 명지3·4중·6초(북구)가 한 화면에"가
 * 바로 이 경로다 — 서로 다른 구의 학교가 동시에 보이는 건 이 경우뿐이다.
 *
 * 규칙은 하나다: **주소 토큰 중 시/군/구와 완전히 같은 것이 있어야 한다.**
 * - `"강서구"`는 토큰 `"서구"`와 같지 않으므로 서구 목록에 들어오지 않는다.
 * - 시/군/구를 모르면 **false**다. 다른 구 데이터로 대체하지 않는다(wrong data < no data).
 */
export function addressMatchesRegion(addr: string, _region: string, gungu: string): boolean {
  if (!addr) return false;
  // 시/군/구가 없으면 "그 지역"이라고 말할 근거가 없다 — 전 지역을 열어주지 않는다.
  if (!gungu || !gungu.trim()) return false;
  return addr.split(/\s+/).includes(gungu.trim());
}

/**
 * NEIS가 **아직 개교하지 않은 학교**에 붙이는 임시 레코드인지.
 *
 * NEIS는 `(가칭)…` 학교의 `ORG_RDNMA`에 학교 부지가 아니라 **설립을 맡은 교육지원청 주소**를
 * 넣는다. 실측(부산 671곳):
 *   (가칭)명지3중학교 · (가칭)명지4중학교 · (가칭)명지6초등학교 → 셋 다 "부산광역시 북구 백양대로1016번다길 44"
 *   (가칭)명지3고등학교 → "부산광역시 부산진구 화지로 12"
 * 명지동은 **강서구**인데 주소는 북구/부산진구다. 세 학교가 한 주소를 공유하는 것만 봐도
 * 학교 위치가 아니라 사무소 주소임을 알 수 있다.
 *
 * 즉 이 레코드들은 **소속 구를 주장할 근거가 없다.** 어느 구 목록에 넣어도 틀린 주장이 되므로
 * 지역 목록·집계에서 제외한다("확인 불가"를 "그 지역"으로 바꾸지 않는다).
 * 개교해서 NEIS가 실제 주소를 채우면 `(가칭)`이 빠지고 자동으로 다시 포함된다.
 */
export function isTentativeSchoolRecord(schoolName: string | null | undefined): boolean {
  return !!schoolName && schoolName.includes('(가칭)');
}

/**
 * 지역 목록/집계에 넣어도 되는 학교인가 — 목록과 요약 카드가 **같은 기준**을 쓰도록 한 곳에 둔다.
 */
export function schoolBelongsToRegion(
  school: { SCHUL_NM?: string | null; ORG_RDNMA?: string | null; LCTN_SC_NM?: string | null },
  region: string,
  gungu: string
): boolean {
  if (isTentativeSchoolRecord(school.SCHUL_NM)) return false;
  return addressMatchesRegion(school.ORG_RDNMA || school.LCTN_SC_NM || '', region, gungu);
}

/**
 * SCHOOL_REGION_TRANSITION_COUNT_CONTRACT_FIX_V1 §5/§7 — 학교급 버킷.
 *
 * 제품 결정(OPTION B): "전체"는 그 지역의 **실제 학교 전부**다. 특수학교·외국인학교·
 * 각종학교를 목록에서 지우지 않는다 — 실재하는 학교를 숨기는 것은 정보 손실이다.
 * 대신 요약 카드가 **같은 dataset**을 쓰고, 초/중/고 밖은 "기타"로 모아 센다.
 *
 * 초/중/고는 **정확히 일치**할 때만 그 버킷이다. 예컨대 `방송통신고등학교`는 '고등학교'가
 * 아니므로 기타다 — 이름이 비슷하다고 묶으면 초/중/고 숫자가 조용히 부풀어 오른다.
 * 값이 없거나(`null`) 모르는 학교급도 **버리지 않고** 기타로 센다(§7).
 */
export type SchoolKindBucket = 'elementary' | 'middle' | 'high' | 'other';

export function classifySchoolKind(kind: string | null | undefined): SchoolKindBucket {
  if (kind === '초등학교') return 'elementary';
  if (kind === '중학교') return 'middle';
  if (kind === '고등학교') return 'high';
  return 'other';
}

/** 탭 라벨("초등"/"중등"/"고등") → 버킷. "전체"/"학원가"는 학교급 필터를 걸지 않는다. */
export function bucketForTab(tab: string): SchoolKindBucket | null {
  if (tab === '초등') return 'elementary';
  if (tab === '중등') return 'middle';
  if (tab === '고등') return 'high';
  return null;
}
