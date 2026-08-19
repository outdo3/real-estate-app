// STEP R4 — docs/development/R3B-redevelopment-master-schema-design.md 확정안 기준
// 공유 타입. ingestion 파이프라인(정규화/매칭/병합) 전체가 이 타입들을 공유한다.

export type MolitBusinessTypeCode = '1' | '2' | '3' | '4' | '5';
export type MolitStageCode = '2' | '3' | '4' | '5' | '6' | '7' | '17';

// 국토부 CSV 원본 7컬럼 그대로(컬럼명은 한글 원본 그대로 유지 — R2에서 실물 확인한
// "시도,시군구,구역명칭,현 사업추진단계,사업유형,사업시행자,공급 예정 세대수").
export interface MolitRawRow {
  시도: string;
  시군구: string;
  구역명칭: string;
  현사업추진단계: string; // 예: "6)관리처분인가"
  사업유형: string; // 예: "1)재개발(주택정비)"
  사업시행자: string; // 예: "1)조합" — 6건 결측 관측(R2)
  공급예정세대수: string; // 원본 그대로 문자열(공백/빈값 존재)
}

// 부산광역시 정비사업 API 응답 23개 키 중 이 파이프라인이 실제로 쓰는 것만 발췌.
// rawPayload에는 응답 원문 전체를 그대로 저장한다(버리지 않음, R3B).
export interface BusanRawRecord {
  aCode: string;
  areaName: string;
  step: string;
  generationJoo: string | null; // 세대수
  location: string | null;
  [key: string]: unknown; // 나머지 22개 키 포함(architect, contractor 등) — rawPayload 보존용
}

export type CanonicalBusinessType =
  | 'REDEVELOPMENT'
  | 'RECONSTRUCTION'
  | 'RESIDENTIAL_ENVIRONMENT'
  | 'SMALL_RECONSTRUCTION'
  | 'BLOCK_HOUSING'
  | 'OTHER'
  | 'UNKNOWN';

export type CanonicalStage =
  | 'PLANNED'
  | 'ZONE_DESIGNATED'
  | 'PROMOTION_COMMITTEE'
  | 'ASSOCIATION_APPROVED'
  | 'ARCHITECTURAL_REVIEW'
  | 'PUBLIC_OPERATOR_DESIGNATED'
  | 'PROJECT_IMPLEMENTATION_APPROVED'
  | 'MANAGEMENT_DISPOSITION_APPROVED'
  | 'RELOCATION_DEMOLITION'
  | 'CONSTRUCTION'
  | 'COMPLETED'
  | 'TRANSFER_REGISTERED'
  | 'DISSOLVED'
  | 'CANCELLED'
  | 'UNKNOWN';

export type CanonicalProjectStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'UNKNOWN';

export type LocationType = 'PROJECT_SITE' | 'OFFICE' | 'APPROXIMATE' | 'UNKNOWN';
export type LocationConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type GeocodeStatus = 'NOT_ATTEMPTED' | 'SUCCESS' | 'AMBIGUOUS' | 'FAILED';

export type MatchConfidence = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNMATCHED';
export type MergeStatus = 'AUTO_MATCHED' | 'REVIEW_REQUIRED' | 'MANUAL_MATCHED' | 'UNMATCHED';

export const SOURCE_MOLIT = 'MOLIT';
export const SOURCE_BUSAN = 'BUSAN_CITY';

// 국토부/부산 원본을 소스별 파서가 이 공통 shape으로 변환한 뒤에만 정규화/매칭 로직에 넘긴다
// — normalize/businessType/stage 모듈이 소스별 원본 필드명을 몰라도 되게 분리.
export interface ParsedSourceRecord {
  source: typeof SOURCE_MOLIT | typeof SOURCE_BUSAN;
  sourceRecordId: string;
  rawName: string;
  sido: string;
  sigungu: string;
  rawBusinessType: string | null;
  rawBusinessTypeCode: string | null;
  businessType: CanonicalBusinessType;
  rawStage: string | null;
  rawStageCode: string | null;
  stage: CanonicalStage;
  rawHouseholdCount: string | null;
  householdCount: number | null;
  rawLocation: string | null;
  rawPayload: unknown;
  normalizedName: string;
}
