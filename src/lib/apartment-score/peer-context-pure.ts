// EJIP_SCORE_V2_PHASE2 — pure peer-context logic, zero external imports on
// purpose (matches this repo's existing testable-pure-module convention,
// e.g. src/lib/map-marker-coords.ts) so it can run under plain
// `node --experimental-strip-types --test` without the `@/` alias resolution
// gap that blocks other test files in this repo (see peer-context.test.mjs
// and docs/development/EJIP_SCORE_V2_PHASE2_IMPLEMENTATION.md). All DB/cache
// access lives in the sibling file peer-context.ts, which imports this one.
//
// Hierarchy, size bands, MIN_PEER_SAMPLE, comparisonCount/peerCount/percentile
// semantics, and confidence thresholds are copied verbatim from the validated
// PHASE 1.5/1.6 simulation scripts (scripts/apartment-score/
// ejip-score-v2-phase1_6-verification.ts) — do not redefine the percentile
// formula or fallback order here without re-running that simulation.

// PHASE 1.6 §11 실측 결과 8이 4개 후보(8/10/15/20) 중 커버리지·bias 전부 최선 —
// 임의 값이 아니다. 바꾸려면 반드시 phase1_6 시뮬레이션을 다시 돌려 재검증한다.
export const MIN_PEER_SAMPLE = 8;
// PHASE 1.5/1.6에서 실측·검증된 tertile 경계(50/221) 그대로 — 재조정 시 재검증 필요.
export const SIZE_BAND_T1 = 50;
export const SIZE_BAND_T2 = 221;

export type SizeBand = 'small' | 'mid' | 'large' | 'UNKNOWN';
export type PeerLevel = 'SIGUNGU_DECADE_SIZE' | 'SIGUNGU_DECADE' | 'DECADE_BUSAN' | 'BUSAN_ALL';
export type PeerConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_AVAILABLE';

export interface PeerContext {
  available: boolean;
  level: PeerLevel | null;
  /** percentile 분모, self 포함 (PHASE 1.6 §2/§3 정의 그대로). */
  comparisonCount: number | null;
  /** 사용자 표시용 — comparisonCount - 1 (self 제외, PHASE 1.6 §13 확정). */
  peerCount: number | null;
  /** 0~100, target의 절대점수가 comparisonCount 모집단 내 어디쯤인지. */
  percentile: number | null;
  confidence: PeerConfidence;
  basis: {
    sigungu: string | null;
    buildDecade: string | null;
    sizeBand: SizeBand | null;
  } | null;
}

export interface PeerUniverseRow {
  aptSeq: string;
  sigungu: string | null;
  buildYear: number | null;
  totalHouseholds: number | null;
  v2Score: number;
}

export interface PeerContextTarget {
  aptSeq: string;
  sigungu: string | null;
  buildYear: number | null;
  totalHouseholds: number | null;
  v2Score: number;
}

export function sizeBandOf(totalHouseholds: number | null): SizeBand {
  if (totalHouseholds == null) return 'UNKNOWN';
  if (totalHouseholds < SIZE_BAND_T1) return 'small';
  if (totalHouseholds < SIZE_BAND_T2) return 'mid';
  return 'large';
}

export function decadeOf(buildYear: number | null): string {
  return buildYear != null ? `${Math.floor(buildYear / 10) * 10}s` : 'NA';
}

function l1Key(gu: string | null, buildYear: number | null, households: number | null): string {
  return `${gu || 'NA'}|${decadeOf(buildYear)}|${sizeBandOf(households)}`;
}
function l2Key(gu: string | null, buildYear: number | null): string {
  return `${gu || 'NA'}|${decadeOf(buildYear)}`;
}
function l3Key(buildYear: number | null): string {
  return decadeOf(buildYear);
}

export function percentileRank(value: number, pool: number[]): number {
  const below = pool.filter((v) => v < value).length;
  const equal = pool.filter((v) => v === value).length;
  return Math.round(((below + equal / 2) / pool.length) * 1000) / 10;
}

// PHASE 1.5/1.6 확정 규칙: HIGH=L1+comparisonCount>=15 / MEDIUM=L1(8~14) 또는 L2
// / LOW=L3·L4(더 넓은 fallback). L2('SIGUNGU_DECADE')와 L3('DECADE_BUSAN')를
// 서로 바꿔 쓰지 않도록 주의 — 한 번 실제로 뒤바뀐 채 구현됐다가 peer-context.
// test.mjs로 잡힌 적이 있다.
export function confidenceFor(level: PeerLevel, comparisonCount: number): PeerConfidence {
  if (level === 'SIGUNGU_DECADE_SIZE' && comparisonCount >= 15) return 'HIGH';
  if (level === 'SIGUNGU_DECADE_SIZE' || level === 'SIGUNGU_DECADE') return 'MEDIUM';
  return 'LOW'; // DECADE_BUSAN(L3) / BUSAN_ALL(L4)
}

export const UNAVAILABLE_PEER_CONTEXT: PeerContext = { available: false, level: null, comparisonCount: null, peerCount: null, percentile: null, confidence: 'NOT_AVAILABLE', basis: null };

/**
 * 순수 함수 — DB/cache에 접근하지 않는다. 이미 준비된 pool(대상 자신 포함,
 * self-included)을 받아 4단계 fallback으로 peer context를 계산한다. 실제
 * 서버 코드(peer-context.ts의 getPeerContext)와 테스트
 * (peer-context.test.mjs) 양쪽에서 이 함수 하나만 쓴다 — percentile/
 * fallback/confidence 정의가 둘로 갈라지는 것을 방지한다. PHASE 1.6에서
 * 검증한 것과 동일한 4단계:
 * L1(구+연식대+규모) → L2(구+연식대) → L3(연식대, 부산 전체) → L4(부산 전체).
 * 모든 fallback을 거쳐도 MIN_PEER_SAMPLE 미만이면 available=false — 다른
 * 비교군으로 억지로 숫자를 만들지 않는다(PHASE 1.5 §16 원칙).
 */
export function computePeerContext(target: PeerContextTarget, pool: PeerUniverseRow[]): PeerContext {
  const l1 = pool.filter((r) => l1Key(r.sigungu, r.buildYear, r.totalHouseholds) === l1Key(target.sigungu, target.buildYear, target.totalHouseholds));
  const l2 = pool.filter((r) => l2Key(r.sigungu, r.buildYear) === l2Key(target.sigungu, target.buildYear));
  const l3 = pool.filter((r) => l3Key(r.buildYear) === l3Key(target.buildYear));
  const l4 = pool;

  let level: PeerLevel | null = null;
  let comparisonPool: PeerUniverseRow[] | null = null;
  // PHASE 1.6 §9와 동일 이유: totalHouseholds가 unknown이면 sizeBandOf가 'UNKNOWN'을
  // 반환하고, l1Key에 'UNKNOWN'이 그대로 들어가 "다른 UNKNOWN 단지들"과만 묶인다 —
  // 세대수 불명 단지를 억지로 특정 규모밴드에 배정하지 않고, 더 넓은 L2/L3로
  // 자연스럽게 fallback되도록 한다(§9 요구사항: "size-aware L1을 억지로 배정하지 않음").
  if (target.totalHouseholds != null && l1.length >= MIN_PEER_SAMPLE) { level = 'SIGUNGU_DECADE_SIZE'; comparisonPool = l1; }
  else if (l2.length >= MIN_PEER_SAMPLE) { level = 'SIGUNGU_DECADE'; comparisonPool = l2; }
  else if (l3.length >= MIN_PEER_SAMPLE) { level = 'DECADE_BUSAN'; comparisonPool = l3; }
  else if (l4.length >= MIN_PEER_SAMPLE) { level = 'BUSAN_ALL'; comparisonPool = l4; }

  if (!level || !comparisonPool) return UNAVAILABLE_PEER_CONTEXT;

  const comparisonCount = comparisonPool.length;
  const percentile = percentileRank(target.v2Score, comparisonPool.map((r) => r.v2Score));
  return {
    available: true,
    level,
    comparisonCount,
    peerCount: comparisonCount - 1,
    percentile,
    confidence: confidenceFor(level, comparisonCount),
    basis: { sigungu: target.sigungu, buildDecade: decadeOf(target.buildYear), sizeBand: level === 'SIGUNGU_DECADE_SIZE' ? sizeBandOf(target.totalHouseholds) : null },
  };
}
