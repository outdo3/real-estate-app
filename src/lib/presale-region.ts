// STATISTICS V2.1-4 §5 — Presale(청약홈)에는 시군구 전용 필드가 없다. 안전하게 재사용
// 가능한 신호는 두 가지뿐이다: subscriptionAreaName(시/도 축약형, 청약홈 원본)과
// locationAddress(자유 텍스트, "{시도} {시군구} {동} {지번}" 형태가 일반적). 이 파일은
// 그 둘에서 "확실할 때만" 시도/시군구를 뽑아내는 순수 함수만 담는다 — 애매하면 null을
// 돌려주고, 호출부가 절대 다른 지역으로 fallback하지 않는다(§5 원칙).
import { REGION_DATA } from '@/lib/regions';

// 대한민국 17개 광역시/도는 법적으로 고정된 상수다(REGION_DATA의 키와 정확히 동일 집합) —
// 청약홈이 쓰는 축약형(예: "부산광역시" -> "부산")으로 매핑한다. 이 표는 외부 API가 아니라
// 국가 행정구역 그 자체이므로 하드코딩이 아니라 상수로 취급한다(§AGENTS 하드코딩 지양
// 원칙은 "동적으로 바뀌는 데이터"를 대상으로 한 것 — 17개 시/도 이름은 여기 해당하지 않음).
export const SIDO_FULL_TO_SHORT: Record<string, string> = {
  '서울특별시': '서울',
  '부산광역시': '부산',
  '대구광역시': '대구',
  '인천광역시': '인천',
  '광주광역시': '광주',
  '대전광역시': '대전',
  '울산광역시': '울산',
  '세종특별자치시': '세종',
  '경기도': '경기',
  '강원특별자치도': '강원',
  '충청북도': '충북',
  '충청남도': '충남',
  '전북특별자치도': '전북',
  '전라남도': '전남',
  '경상북도': '경북',
  '경상남도': '경남',
  '제주특별자치도': '제주',
};

export function sidoFullToShort(sidoFull: string): string | null {
  return SIDO_FULL_TO_SHORT[sidoFull] ?? null;
}

// locationAddress의 두 번째 토큰(시군구)이 REGION_DATA[sidoFull] 목록에 실제로 존재할
// 때만 신뢰한다 — "에코델타시티 공동주택용지"처럼 세 번째 토큰부터는 프로젝트명/지구명이
// 섞여 있어 동(洞) 추출은 하지 않는다(§6 — 동 단위 drilldown은 이번 V1 미지원).
export function parsePresaleSigungu(locationAddress: string | null, sidoFull: string): string | null {
  if (!locationAddress) return null;
  const tokens = locationAddress.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const candidate = tokens[1];
  const validSigungus = REGION_DATA[sidoFull];
  if (!validSigungus) return null;
  return validSigungus.includes(candidate) ? candidate : null;
}

// "YYYYMM" 문자열 비교 — moveInExpectedYm은 원본 그대로 문자열이라(날짜 변환 금지 원칙,
// schema.prisma 코멘트 참고) 사전식 비교가 곧 시간순 비교와 동일하다(둘 다 6자리 고정폭).
export function currentYm(now: Date = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function isFutureOrCurrentYm(ym: string | null, nowYm: string): boolean {
  if (!ym || ym.length !== 6) return false;
  return ym >= nowYm;
}

export function addMonthsToYm(ym: string, months: number): string {
  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(4, 6), 10);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
