// OFFICETEL_V1 STEP 1 §16 — 생활형숙박시설 확장을 위한 **최소** 추상화.
//
// 이 파일은 **타입 선언만** 담는다. 구현체(adapter)는 다음 STEP에서 유형별로 만든다.
// 지금 구현을 넣지 않는 이유: 오피스텔 수집 파이프라인이 아직 없고, 실측 없이
// 만든 범용 프레임워크는 첫 실데이터에서 반드시 틀린다(아파트 파이프라인에서 반복 확인).
//
// 명시적으로 하지 않는 것(과설계 금지):
//   - 공통 Property DB 테이블 재설계
//   - generic transaction event 모델
//   - 범용 stats 프레임워크
//   - apartment 파이프라인 refactor
// 아파트 경로는 이 파일을 import하지 않으며, 이 STEP에서 단 한 줄도 바뀌지 않았다.

/**
 * 부동산 유형. 생활형숙박시설은 여기에 값 하나를 더하는 것으로 들어온다 —
 * 그때 identity/adapter/detail provider 구현만 추가하면 되도록 아래 인터페이스를 맞춰 둔다.
 */
export type PropertyType = 'APARTMENT' | 'OFFICETEL';

/** identity를 만들 수 없을 때의 상태. 잘못 연결하느니 여기에 머문다(§17). */
export const UNRESOLVED = 'UNRESOLVED' as const;
export type Unresolved = typeof UNRESOLVED;

export type IdentityResolution =
  | { resolved: true; canonicalKey: string }
  | { resolved: false; status: Unresolved; reason: string };

/**
 * §16-3 IDENTITY RESOLVER — 원천 행 하나를 canonical building key로 바꾼다.
 *
 * 아파트: aptSeq 기반. 오피스텔: 주소 기반(src/lib/officetel/identity.ts).
 * 구현체는 **이름 단독 매칭·loose substring·first match·타 지번 fallback을 하지 않는다**.
 */
export interface IdentityResolver<TSourceRow> {
  readonly propertyType: PropertyType;
  resolveIdentity(row: TSourceRow): IdentityResolution;
}

/** 원천 셀(시군구 × 계약월) 조회 결과. 완전성 판정을 호출부가 할 수 있도록 원자료를 그대로 넘긴다. */
export interface SourceCellResult<TSourceRow> {
  /** 원천이 신고한 전체 건수. null이면 완전성을 주장할 수 없다. */
  totalCount: number | null;
  rows: TSourceRow[];
  /** totalCount와 rows.length가 일치하는가 — 불일치면 그 셀은 쓰지 않는다. */
  complete: boolean;
}

/**
 * §16-2 TRANSACTION SOURCE ADAPTER — 유형별 실거래 원천 하나를 감싼다.
 *
 * 유형이 늘어도 수집 오케스트레이션(예산/재시도/coverage 기록)은 재사용하고
 * 이 어댑터 구현만 추가한다.
 */
export interface TransactionSourceAdapter<TSourceRow> {
  readonly propertyType: PropertyType;
  /** 'SALE' | 'RENT' */
  readonly dataset: 'SALE' | 'RENT';
  fetchCell(lawdCd: string, dealYmd: string): Promise<SourceCellResult<TSourceRow>>;
}

/**
 * §16-4 DETAIL PROVIDER — 상세 화면이 쓰는 건물 정보를 유형별로 가져온다.
 *
 * 아파트와 오피스텔이 **서로 다른 건축물대장 오퍼레이션**을 쓴다는 것이 이 인터페이스가
 * 필요한 이유다: 아파트는 총괄표제부(getBrRecapTitleInfo), 오피스텔은 표제부
 * (getBrTitleInfo). 오피스텔에 총괄표제부를 쓰면 항상 0건이다(실측 3/3).
 */
export interface PropertyDetailProvider<TDetail> {
  readonly propertyType: PropertyType;
  getDetail(canonicalKey: string): Promise<TDetail | null>;
}

/**
 * §13 AREA CONTRACT — 오피스텔 면적 구간 상수.
 *
 * 아파트의 84㎡ 국민평형 로직을 쓰지 않는 이유(실측): 오피스텔 전용면적 중앙값은
 * SALE 29.24㎡ / RENT 26.30㎡이고 84㎡대는 SALE 2.76% / RENT 1.45%에 불과하다.
 *
 * 원천이 주는 면적은 **전용면적 하나뿐**이다. 공급/계약/분양면적은 어떤 오피스텔
 * 실거래 원천에도 없으므로 추정하지 않으며, 공급면적을 모르는 상태에서 "몇 평형"이라고
 * 단정하지 않는다.
 *
 * 이 STEP에서는 상수만 둔다 — 통계/UI는 구현하지 않는다.
 */
export const OFFICETEL_AREA_BANDS_SQM: readonly { readonly min: number; readonly max: number | null; readonly label: string }[] = [
  { min: 0, max: 20, label: '20㎡ 미만' },
  { min: 20, max: 30, label: '20~30㎡' },
  { min: 30, max: 40, label: '30~40㎡' },
  { min: 40, max: 60, label: '40~60㎡' },
  { min: 60, max: 85, label: '60~85㎡' },
  { min: 85, max: null, label: '85㎡ 이상' },
] as const;
