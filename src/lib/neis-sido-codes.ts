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

// 학교 주소 문자열에서 시/군/구 이름이 "정확히" 일치하는 항목만 선택한다.
// 기존에는 addr.includes(gungu) 방식이라 "강서구".includes("서구")처럼
// 다른 구가 함께 매칭되는 문제가 있어, 주소를 토큰 단위로 쪼개 정확히
// 일치하는 토큰이 있는지로 판단한다.
export function addressMatchesRegion(addr: string, region: string, gungu: string): boolean {
  if (!addr) return false;
  const tokens = addr.split(/\s+/);
  if (addr.includes(region)) return true;
  return tokens.includes(gungu);
}
