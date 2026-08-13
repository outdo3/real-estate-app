// PRESALE P2-D4-B2 — houseTy(주택형) 원본 코드에서 비교용 전용면적을 뽑아내는 helper.
//
// 정책 근거(docs/development/18-presale-nearby-market-api.md "houseTy 추가 검증" 참고):
// 청약홈 API 기술문서에는 HOUSE_TY의 의미를 "전용면적"이라고 직접 정의하는 문장이 없다.
// 다만 「주택공급에 관한 규칙」 제21조제5항(국가법령정보센터 원문 확인, 현행)이 "세대별
// 주택공급면적(=업계 관행상 '주택형' 표기)은 주거전용면적 기준으로 표시해야 한다"고
// 명시하고 있고, 기존 실측(55개 표본, 이번 STEP의 5,395건 전수 검증 100% 성공)도 이와
// 일관된다 — 사용자가 이 근거로 "조건부 비교용 사용"(판단 B)을 승인했다. 다만 이는
// 여전히 공식 API의 직접 정의는 아니므로, PresaleHouseTypeDetail.houseTy 원본 컬럼과
// supplyArea(공급면적, 기존 상세 UI가 그대로 사용 중인 값)는 이 helper가 전혀 건드리지
// 않는다 — 여기서 계산한 exclusiveArea는 오직 B2 비교 계산에만 쓰는 런타임 파생값이다.

export interface ParsedHouseType {
  raw: string;
  exclusiveArea: number;
  typeSuffix: string;
}

// "055.9700A" -> { raw, exclusiveArea: 55.97, typeSuffix: "A" }
// "099.9350"  -> { raw, exclusiveArea: 99.935, typeSuffix: "" }
// 형식이 예상과 다르면(숫자 없음, 범위 밖 등) null — 억지로 추정하지 않는다.
export function parsePresaleHouseType(houseTy: string | null | undefined): ParsedHouseType | null {
  if (!houseTy) return null;
  const trimmed = houseTy.trim();
  const match = trimmed.match(/^(\d{2,3}(?:\.\d+)?)([A-Za-z가-힣]*)$/);
  if (!match) return null;
  const exclusiveArea = parseFloat(match[1]);
  if (isNaN(exclusiveArea) || exclusiveArea <= 0 || exclusiveArea > 500) return null;
  return { raw: trimmed, exclusiveArea, typeSuffix: match[2] || '' };
}

// 유사 전용면적 판정 — ±1㎡(문서16 §10 실측 근거), 경계값 포함(inclusive).
export function isSimilarExclusiveArea(presaleArea: number, transactionArea: number, tolerance = 1): boolean {
  return Math.abs(presaleArea - transactionArea) <= tolerance;
}

// 최근 거래 최대 3건의 dealAmount(만원) 중앙값. 1건=그 값, 2건=평균, 3건=가운데 값.
export function medianPrice(amounts: number[]): number | null {
  if (amounts.length === 0) return null;
  const sorted = [...amounts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}
