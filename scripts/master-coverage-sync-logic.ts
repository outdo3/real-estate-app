// MASTER_COVERAGE_SYNC_V1 — pure functions only (no DB/network calls, unit-test
// target). Generalizes the two-step RECENT_MASTER_MISSING_16_AUDIT_V1 pipeline
// (scripts/audit-recent-master-missing-16.ts + classify-recent-master-missing-16.ts)
// into a reusable coverage/detection/classification core so it can run repeatedly
// instead of being a one-off 16-candidate snapshot.
//
// The actual INSERT-plan builder is NOT reimplemented here — it reuses
// buildAllPlans()/buildMasterRowPlan() from repair-recent-missing-masters-logic.ts
// unchanged, so there remains exactly one place in the codebase that can produce a
// write plan (§6 of MASTER_MISSING_REPAIR_V1: "update 경로 자체가 코드에 없음").
import { normalizeSearchKeyword } from '../src/lib/search-ranking';
import { BUSAN_GU_BY_LAWDCD, type RepairCandidate } from './repair-recent-missing-masters-logic';

export const BUSAN_LAWD_CODES = Object.keys(BUSAN_GU_BY_LAWDCD);

// repair-recent-missing-masters-logic.ts types masterCreateReadiness as plain
// `string`(it only ever compares against 'READY_FOR_MASTER_CREATE') — this union
// is the same 3-value contract classify-recent-master-missing-16.ts used, kept
// local here since there is no shared type to import.
export type Readiness = 'READY_FOR_MASTER_CREATE' | 'REVIEW_REQUIRED' | 'DO_NOT_CREATE';

// §8 coverage report — pure set-difference over already-fetched aptSeq lists.
export interface CoverageResult {
  tradedAptSeqCount: number;
  masterMatchedCount: number;
  missingCount: number;
  coveragePercent: number;
  missingAptSeqs: string[];
}

export function computeCoverage(tradedAptSeqs: string[], existingMasterAptSeqs: Set<string>): CoverageResult {
  const missingAptSeqs = tradedAptSeqs.filter((s) => !existingMasterAptSeqs.has(s));
  const masterMatchedCount = tradedAptSeqs.length - missingAptSeqs.length;
  const coveragePercent = tradedAptSeqs.length > 0 ? (masterMatchedCount / tradedAptSeqs.length) * 100 : 100;
  return {
    tradedAptSeqCount: tradedAptSeqs.length,
    masterMatchedCount,
    missingCount: missingAptSeqs.length,
    coveragePercent,
    missingAptSeqs,
  };
}

export interface TradeRecord {
  aptName: string;
  dong: string;
  jibun: string | null;
  lawdCd: string;
  buildYear: number | null;
}

export interface MasterAliasRow {
  aptSeq: string | null;
  name: string;
  normalizedName: string;
  umdName: string | null;
  jibun: string | null;
}

export interface CandidateProfile {
  aptSeq: string;
  canonicalName: string;
  lawdCd: string;
  dong: string;
  jibun: string;
  buildYear: number | null;
  totalTradeCount: number;
  nameVariants: string[];
  dongVariants: string[];
  jibunVariants: string[];
  aptSeqLawdMismatch: boolean;
  masterNameAliasMatches: { aptSeq: string | null; name: string; dong: string | null; jibun: string | null }[];
  masterAddressMatch: { aptSeq: string | null; name: string } | null;
}

// §9 identity evidence collection — builds one candidate profile from a missing
// aptSeq's own trade history plus already-batched Master rows (no per-aptSeq DB
// query — caller fetches everything in bulk beforehand, this is pure grouping/
// comparison over data already in memory).
export function buildForensicProfile(
  aptSeq: string,
  trades: TradeRecord[],
  allMasters: MasterAliasRow[]
): CandidateProfile {
  const nameVariants = [...new Set(trades.map((t) => t.aptName))];
  const dongVariants = [...new Set(trades.map((t) => t.dong))];
  const jibunVariants = [...new Set(trades.map((t) => t.jibun ?? ''))];

  const last = trades[trades.length - 1];
  const canonicalName = last?.aptName ?? '';
  const canonicalDong = last?.dong ?? '';
  const canonicalJibun = last?.jibun ?? '';
  const canonicalLawdCd = last?.lawdCd ?? '';
  const canonicalBuildYear = last?.buildYear ?? null;

  // aptSeq is formatted "{lawdCd}-{일련번호}"(MOLIT) — cross-check against the
  // trade rows' own lawdCd as an extra identity guard beyond the original 16-case
  // audit (which trusted trade.lawdCd alone).
  const aptSeqLawdMismatch = canonicalLawdCd.length > 0 && !aptSeq.startsWith(`${canonicalLawdCd}-`);

  const normName = normalizeSearchKeyword(canonicalName);
  const nameMatches = allMasters.filter((m) => m.normalizedName === normName);
  // Same brand name reused at a different building is not an alias/merge signal
  // (§7 "보해이브빌" case) — only same dong+jibun counts as a real collision.
  const realAliasCandidates = nameMatches.filter((m) => !(m.umdName === canonicalDong && m.jibun === canonicalJibun));
  const addressMatch = allMasters.find((m) => m.umdName === canonicalDong && m.jibun === canonicalJibun) ?? null;

  return {
    aptSeq,
    canonicalName,
    lawdCd: canonicalLawdCd,
    dong: canonicalDong,
    jibun: canonicalJibun,
    buildYear: canonicalBuildYear,
    totalTradeCount: trades.length,
    nameVariants,
    dongVariants,
    jibunVariants,
    aptSeqLawdMismatch,
    masterNameAliasMatches: realAliasCandidates.map((m) => ({ aptSeq: m.aptSeq, name: m.name, dong: m.umdName, jibun: m.jibun })),
    masterAddressMatch: addressMatch ? { aptSeq: addressMatch.aptSeq, name: addressMatch.name } : null,
  };
}

export interface ClassificationResult {
  classification: string;
  masterCreateReadiness: Readiness;
  decision: 'HIGH_CONFIDENCE' | 'REVIEW_REQUIRED' | 'INVALID';
  evidenceStrength: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  evidence: string[];
}

// §10 confidence classification — generalizes the A/F/I rules from
// classify-recent-master-missing-16.ts. Coverage is never chased by loosening
// these rules (§26): identity accuracy > wrong-apartment=0 > honest REVIEW_REQUIRED
// separation > coverage > automation, in that order.
export function classifyCandidateProfile(p: CandidateProfile): ClassificationResult {
  const sourceIdentityConflict = p.nameVariants.length > 1 || p.dongVariants.length > 1 || p.jibunVariants.length > 1;
  const evidence: string[] = [
    `MOLIT 실거래(ApartmentTradeHistory) 전체 이력 ${p.totalTradeCount}건`,
    `name=${p.nameVariants.length}종, dong=${p.dongVariants.length}종, jibun=${p.jibunVariants.length}종`,
    `Master name-alias(다른 주소)=${p.masterNameAliasMatches.length}건, 동일주소-다른aptSeq=${p.masterAddressMatch ? 1 : 0}건`,
  ];

  if (!p.aptSeq || !p.canonicalName || !p.lawdCd || !p.dong || !p.jibun) {
    return {
      classification: 'B_MISSING_REQUIRED_FIELD',
      masterCreateReadiness: 'DO_NOT_CREATE',
      decision: 'INVALID',
      evidenceStrength: 'LOW',
      reason: 'aptSeq/canonicalName/lawdCd/dong/jibun 중 필수 identity 필드 결측 — Master 생성 최소 요건 미충족',
      evidence,
    };
  }

  if (p.aptSeqLawdMismatch) {
    return {
      classification: 'G_APTSEQ_LAWDCD_MISMATCH',
      masterCreateReadiness: 'REVIEW_REQUIRED',
      decision: 'REVIEW_REQUIRED',
      evidenceStrength: 'LOW',
      reason: `aptSeq(${p.aptSeq}) 접두부가 거래 이력의 lawdCd(${p.lawdCd})와 불일치 — identity 재확인 필요`,
      evidence,
    };
  }

  if (p.masterAddressMatch) {
    return {
      classification: 'F_SOURCE_ALIAS_MISMATCH',
      masterCreateReadiness: 'REVIEW_REQUIRED',
      decision: 'REVIEW_REQUIRED',
      evidenceStrength: 'MEDIUM',
      reason: '같은 주소(dong+jibun)에 다른 aptSeq의 기존 Master row가 있어 rename/alias 여부 확인 필요',
      evidence: [...evidence, `동일 dong+jibun 기존 Master: aptSeq=${p.masterAddressMatch.aptSeq} name="${p.masterAddressMatch.name}"`],
    };
  }

  if (sourceIdentityConflict) {
    return {
      classification: 'I_UNKNOWN',
      masterCreateReadiness: 'REVIEW_REQUIRED',
      decision: 'REVIEW_REQUIRED',
      evidenceStrength: 'LOW',
      reason: '동일 aptSeq 내에서 name/dong/jibun이 거래별로 흔들림, identity 재확인 필요',
      evidence,
    };
  }

  return {
    classification: 'A_ACTIVE_APARTMENT_MASTER_OMISSION',
    masterCreateReadiness: 'READY_FOR_MASTER_CREATE',
    decision: 'HIGH_CONFIDENCE',
    evidenceStrength: p.totalTradeCount >= 5 ? 'HIGH' : 'MEDIUM',
    reason: 'identity 검증 완료 — name/dong/jibun 흔들림 없음, 기존 Master와 주소 충돌 없음',
    evidence,
  };
}

export function profileToRepairCandidate(p: CandidateProfile, classification: ClassificationResult): RepairCandidate {
  return {
    aptSeq: p.aptSeq,
    canonicalName: p.canonicalName,
    lawdCd: p.lawdCd,
    dong: p.dong,
    jibun: p.jibun,
    buildYear: p.buildYear,
    masterCreateReadiness: classification.masterCreateReadiness,
  };
}
