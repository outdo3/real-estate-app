// OFFICETEL_V1 STEP 1 §8/§12/§18 — 오피스텔 SALE/RENT 자연키 + occurrenceIndex 계약.
//
// 아파트 계약을 그대로 복사하지 않은 이유:
//   - 아파트 자연키는 `groupKeyStr`(= `id:{aptSeq}::{면적}::sale`)에 aptSeq를 인코딩한다.
//     오피스텔에는 aptSeq가 없으므로 그 자리에 **canonicalKey**(주소 기반, identity.ts)를 쓴다.
//   - 아파트 SALE은 `(groupKey, dealAmount, dealDate, floor, occurrenceIndex)`지만
//     오피스텔은 canonicalKey에 면적이 들어있지 않으므로 **exclusiveArea를 자연키에 명시**한다.
//   - RENT는 금액이 보증금+월세 2개라 둘 다 자연키에 넣는다(아파트 RENT와 같은 이유).
//
// 실측 근거(부산 16구 × 3개월 SALE 724행): 자연키 그룹 697개 중 **다행 그룹 21개(3.01%)**.
// 유형은 A(1행 취소) 7 / **B(uncanceled+canceled) 9** / C 0 / D(둘 다 정상) 6 / E(3행+) 6.
// 독립 가정 기대값이 1.0인데 실측 B가 9 — 아파트에서 확인한 TYPE B 현상이 오피스텔에도
// 존재한다. 따라서 **occurrenceIndex는 필수**이며, TYPE B 쌍을 병합/삭제하지 않는다(§8/§9).

/** §16 — 유형 확장 지점. 생활형숙박시설은 값 추가만으로 들어온다. */
export type PropertyType = 'APARTMENT' | 'OFFICETEL';

export interface OfficetelSaleNaturalKeyParts {
  canonicalKey: string;
  /** YYYY-MM-DD */
  dealDate: string;
  /** 원본 전용면적 문자열(정밀도 손실 금지 — §13). */
  exclusiveArea: string;
  dealAmount: number;
  floor: number;
}

export interface OfficetelRentNaturalKeyParts {
  canonicalKey: string;
  dealDate: string;
  exclusiveArea: string;
  deposit: number;
  monthlyRent: number;
  floor: number;
}

/**
 * §8 — occurrenceIndex를 **제외한** 자연키 그룹 문자열.
 *
 * 같은 그룹에 원천 행이 2개 이상이면 등장 순서대로 occurrenceIndex 0,1,2…를 부여한다.
 * 이 그룹 정의는 DB unique constraint의 앞부분과 정확히 일치해야 한다(§18).
 */
export function officetelSaleGroupKey(p: OfficetelSaleNaturalKeyParts): string {
  return `${p.canonicalKey}|${p.dealDate}|${normalizeAreaToken(p.exclusiveArea)}|${p.dealAmount}|${p.floor}`;
}

export function officetelRentGroupKey(p: OfficetelRentNaturalKeyParts): string {
  return `${p.canonicalKey}|${p.dealDate}|${normalizeAreaToken(p.exclusiveArea)}|${p.deposit}|${p.monthlyRent}|${p.floor}`;
}

/**
 * 면적 토큰 정규화 — 그룹 판정 **전용**이며 저장값이 아니다.
 *
 * DB에는 원본 문자열을 Decimal로 정밀도 손실 없이 저장한다(§13). 다만 그룹 판정에서는
 * "31.56"과 "31.5600"이 같은 면적으로 묶여야 하므로 후행 0과 불필요한 소수점을 떼어
 * 비교한다. 값 자체를 반올림하지 않는다 — 자릿수 표기만 정규화한다.
 */
export function normalizeAreaToken(area: string | number): string {
  const raw = String(area ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return raw;
  return raw.includes('.') ? raw.replace(/0+$/, '').replace(/\.$/, '') : raw;
}

/**
 * §8 OCCURRENCE CONTRACT — 한 (lawdCd, dealYmd) 응답 배열 안에서만 계산한다.
 *
 * 왜 배치 안에서만인가: dealYmd는 항상 그 거래 자신의 계약연월과 같으므로 자연키 충돌은
 * **언제나 같은 fetch 배치 안에서만** 일어난다. 배치를 넘어선 occurrenceIndex 충돌은
 * 구조적으로 발생할 수 없다(아파트에서 확립한 것과 같은 성질).
 *
 * pagination 순서 취약성: 원천은 pageNo/numOfRows로 나눠 오지만 **호출부가 페이지를 순서대로
 * 이어붙인 배열**을 넘겨야 한다(실측상 부산 구·월당 최대 507행이라 numOfRows=1000이면
 * 단일 페이지로 끝나 순서가 흔들릴 여지 자체가 거의 없다). 순서가 바뀌면 같은 그룹 안에서
 * 슬롯이 뒤바뀔 수 있으나, 그룹 내 행들은 자연키 성분이 전부 동일하고 다른 것은
 * 취소 여부뿐이므로 **저장된 집합 자체는 동일하다**.
 *
 * @returns 입력과 같은 길이의 occurrenceIndex 배열
 */
export function assignOccurrenceIndexes(groupKeys: string[]): number[] {
  const counters = new Map<string, number>();
  return groupKeys.map((k) => {
    const n = counters.get(k) ?? 0;
    counters.set(k, n + 1);
    return n;
  });
}
