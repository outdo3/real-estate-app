import { SOURCE_BUSAN, SOURCE_MOLIT } from './types';
import type { CanonicalBusinessType, CanonicalStage, ParsedSourceRecord } from './types';

export interface CanonicalFields {
  canonicalName: string;
  businessType: CanonicalBusinessType;
  stage: CanonicalStage;
  householdCount: number | null;
  primarySource: string;
  needsReview: boolean;
  needsReviewReason: string | null;
}

// R2 권장 source priority(R3B가 그대로 채택) — 필드별로 다르다:
//   존재/일반유형(재개발·재건축·주거환경개선) → 국토부 우선
//   소규모주택정비(가로주택정비·소규모재건축) → 부산(국토부에 대응 코드 자체가 없음)
//   진행단계/세대수 → 부산(더 세밀하거나 더 자주 갱신됨, R2 근거)
//   좌표 → geocoding 결과(이 함수 책임 아님, ingestion 단계에서 별도 처리)
const GENERAL_BUSINESS_TYPES: CanonicalBusinessType[] = ['REDEVELOPMENT', 'RECONSTRUCTION', 'RESIDENTIAL_ENVIRONMENT'];

function parseHouseholdCount(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '해당없음') return null;
  const n = parseInt(trimmed.replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function mergeCanonicalFields(records: ParsedSourceRecord[]): CanonicalFields {
  if (records.length === 0) {
    throw new Error('mergeCanonicalFields: records가 비어있다 — 최소 1개 SourceRecord 필요');
  }

  const molitRecords = records.filter((r) => r.source === SOURCE_MOLIT);
  const busanRecords = records.filter((r) => r.source === SOURCE_BUSAN);

  // 사업유형: 소규모주택정비법 계열(부산만 정의)이면 부산 우선, 그 외 일반 유형은 국토부 우선.
  const busanSmallHousingType = busanRecords.find(
    (r) => r.businessType === 'SMALL_RECONSTRUCTION' || r.businessType === 'BLOCK_HOUSING'
  );
  const molitGeneralType = molitRecords.find((r) => GENERAL_BUSINESS_TYPES.includes(r.businessType));

  let businessType: CanonicalBusinessType = 'UNKNOWN';
  if (busanSmallHousingType) {
    businessType = busanSmallHousingType.businessType;
  } else if (molitGeneralType) {
    businessType = molitGeneralType.businessType;
  } else {
    const anyKnown = records.find((r) => r.businessType !== 'UNKNOWN');
    businessType = anyKnown?.businessType ?? 'UNKNOWN';
  }

  // 진행단계: 부산(더 세밀한 12단계, R2 권장) 우선, 없으면 국토부.
  const busanWithStage = busanRecords.find((r) => r.stage !== 'UNKNOWN');
  const molitWithStage = molitRecords.find((r) => r.stage !== 'UNKNOWN');
  const stage: CanonicalStage = busanWithStage?.stage ?? molitWithStage?.stage ?? 'UNKNOWN';

  // 세대수: 부산 우선(R2 권장), 국토부는 초기단계 스냅샷에서 0으로 기록된 사례가 실측됨.
  const busanHousehold = busanRecords
    .map((r) => parseHouseholdCount(r.rawHouseholdCount))
    .find((v) => v !== null && v > 0);
  const molitHousehold = molitRecords
    .map((r) => parseHouseholdCount(r.rawHouseholdCount))
    .find((v) => v !== null && v > 0);
  const householdCount = busanHousehold ?? molitHousehold ?? null;

  // 존재/canonicalName: 국토부 우선(전국 공식 통합 데이터, R2 근거), 없으면 부산.
  const primary = molitRecords[0] ?? busanRecords[0];
  const canonicalName = primary.rawName;
  const primarySource = molitRecords.length > 0 ? SOURCE_MOLIT : SOURCE_BUSAN;

  const { needsReview, reason } = detectConflicts(records);

  return { canonicalName, businessType, stage, householdCount, primarySource, needsReview, needsReviewReason: reason };
}

// R3A가 실증한 두 가지 충돌 패턴을 그대로 검출한다:
//  1) businessType이 서로 다른 known 값으로 갈린 SourceRecord가 한 Project에 묶임
//     (예: 국토부 내부에 "5)주거환경개선+세대수0"과 "재개발/재건축+실세대수"가 같은
//     구역명으로 중복 존재하는 패턴 — R3A 16건 중 13건).
//  2) 세대수가 있는 레코드끼리 30% 이상 차이(명서1: 1521 vs 785 같은 사례 대응).
// 자동으로 "무엇이 최신/정답"인지 판단하지 않고 사람 검토로 넘긴다(R3B YAGNI 정책).
function detectConflicts(records: ParsedSourceRecord[]): { needsReview: boolean; reason: string | null } {
  const knownTypes = new Set(records.map((r) => r.businessType).filter((t) => t !== 'UNKNOWN'));
  if (knownTypes.size > 1) {
    return { needsReview: true, reason: `businessType 충돌: ${[...knownTypes].join(', ')}` };
  }

  const households = records
    .map((r) => parseHouseholdCount(r.rawHouseholdCount))
    .filter((v): v is number => v !== null && v > 0);
  if (households.length >= 2) {
    const max = Math.max(...households);
    const min = Math.min(...households);
    if (max > 0 && (max - min) / max >= 0.3) {
      return { needsReview: true, reason: `세대수 30%+ 불일치: ${households.join(' vs ')}` };
    }
  }

  return { needsReview: false, reason: null };
}
