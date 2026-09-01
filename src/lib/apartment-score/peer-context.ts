// EJIP_SCORE_V2_PHASE2 — Peer-relative context for the E-JIP Score.
//
// Architecture decision (PHASE 1/1.5/1.6 audits): V2's engine (score-v2/engine.ts)
// stays pure and absolute — it never compares apartments to each other, and this
// file does not change that. Peer comparison lives entirely OUTSIDE the engine,
// exactly like `ScoreV2Result.relativeContext`'s own doc comment already says
// ("engine이 계산하지 않는다 — 호출부가 외부에서 공급"). This module is that
// "호출부" — it re-uses each apartment's already-computed V2 overallScore and
// ranks it against a hierarchical peer pool.
//
// The actual hierarchy/size-band/percentile/confidence math lives in the
// dependency-free sibling file peer-context-pure.ts (testable via plain
// `node --test`, see peer-context.test.mjs) — this file only does DB batch
// fetching + caching, then delegates to computePeerContext().
//
// Performance: calculateApartmentScore() is unsuitable for building the peer
// universe because V1's orchestration re-fetches the ENTIRE sigungu cohort on
// every single call (see calculate.ts:55-68) — calling it 2,800+ times to build
// a universe is exactly the O(n^2)-ish cost that made the PHASE 1 analysis
// scripts take ~15-20 minutes. V2 itself is a pure function with no DB access
// (score-v2/engine.ts), so this module batch-fetches ApartmentMaster +
// ApartmentLocationFeature ONCE and calls adaptToV2Input/calculateScoreV2
// directly per row — O(n) total DB cost, matching what a single cold API
// request can afford. The result is cached via the existing getOrSetCache
// (no new cache infra) since the underlying registry/location data is
// batch-updated, not real-time.

import { prisma } from '@/lib/prisma';
import { getOrSetCache } from '@/lib/server-cache';
import { calculateScoreV2 } from '@/lib/score-v2/engine';
import { adaptToV2Input } from '@/lib/score-v2/adapter';
import { getApartmentEducationZone } from '@/lib/education/attendance-zone';
import { computePeerContext, type PeerContext, type PeerContextTarget, type PeerUniverseRow } from './peer-context-pure';

export type { PeerContext, PeerContextTarget, PeerUniverseRow, SizeBand, PeerLevel, PeerConfidence } from './peer-context-pure';
export { sizeBandOf, decadeOf, percentileRank, confidenceFor, computePeerContext, UNAVAILABLE_PEER_CONTEXT } from './peer-context-pure';

const SIDO_VALUE = '부산';
// calculate.ts:150과 반드시 동일한 값이어야 한다 — 여기서 계산한 peer universe의
// v2Score가 개별 단지 상세 API가 보여주는 v2Score와 어긋나면(cross-check 실패)
// PHASE 2 QA §32가 요구하는 "mismatch = 0" 조건이 깨진다.
const V2_REFERENCE_YEAR = 2026;
const PEER_UNIVERSE_CACHE_KEY = 'score-v2-peer-universe:busan';
const PEER_UNIVERSE_TTL_MS = 60 * 60 * 1000; // 1시간 — 등록된 registry/location 배치 갱신 주기에 비해 충분히 김

/**
 * PHASE 2 성능 설계 — calculateApartmentScore()를 2,800회 이상 호출하지 않는다
 * (개별 호출마다 sigungu 전체 cohort를 재조회하는 V1 orchestration 비용을
 * 피하기 위해). ApartmentMaster/ApartmentLocationFeature를 한 번씩만 배치
 * 조회하고, 순수 함수인 calculateScoreV2를 직접 호출한다 — DB round-trip은
 * 이 함수 전체에서 2회 고정(N+1 없음).
 */
async function buildPeerUniverse(): Promise<PeerUniverseRow[]> {
  const masters = await prisma.apartmentMaster.findMany({
    where: { sido: SIDO_VALUE, aptSeq: { not: null } },
    select: {
      aptSeq: true, sggCd: true, sigungu: true, umdName: true,
      buildYear: true, totalHouseholds: true, parkingCount: true,
      mainBuildingCount: true, geocodeQuality: true,
    },
  });
  const locations = await prisma.apartmentLocationFeature.findMany({
    where: { aptSeq: { in: masters.map((m) => m.aptSeq!) } },
  });
  const locByAptSeq = new Map(locations.map((l) => [l.aptSeq, l]));

  const rows: PeerUniverseRow[] = [];
  for (const m of masters) {
    const loc = locByAptSeq.get(m.aptSeq!);
    if (!loc) continue; // PHASE 1의 "location-feature 보유" universe와 동일 기준
    let v2Score: number | null = null;
    try {
      const eduZone = getApartmentEducationZone(m.aptSeq!);
      const attendanceZoneStatus = eduZone ? eduZone.elementary.status : 'NOT_AVAILABLE';
      const v2Input = adaptToV2Input(m as any, loc as any, attendanceZoneStatus as any);
      const v2 = calculateScoreV2(v2Input, V2_REFERENCE_YEAR);
      if (v2.eligibility !== 'NOT_ENOUGH_DATA' && v2.overallScore != null) {
        v2Score = Math.round(v2.overallScore);
      }
    } catch {
      // 개별 단지 계산 실패는 peer universe에서 조용히 제외 — 전체 요청을 막지 않는다.
    }
    if (v2Score == null) continue;
    rows.push({ aptSeq: m.aptSeq!, sigungu: m.sigungu, buildYear: m.buildYear, totalHouseholds: m.totalHouseholds, v2Score });
  }
  return rows;
}

async function getPeerUniverse(): Promise<PeerUniverseRow[]> {
  return getOrSetCache(PEER_UNIVERSE_CACHE_KEY, PEER_UNIVERSE_TTL_MS, buildPeerUniverse);
}

/**
 * 대상 단지의 peer-relative context를 계산한다(DB/cache 접근 wrapper). 대상
 * 자신은 이미 계산된 v2Score를 그대로 받는다(중복 계산 금지 — score-v2
 * route가 이미 계산한 값을 그대로 전달). 실제 fallback/percentile/confidence
 * 로직은 peer-context-pure.ts의 computePeerContext()에 있다.
 */
export async function getPeerContext(target: PeerContextTarget): Promise<PeerContext> {
  const universe = await getPeerUniverse();
  // 자기 자신을 정확히 하나만 포함시킨다 — universe에 target이 이미 있으면
  // 중복 집계하지 않고, 없으면(예: 아직 캐시가 갱신 안 됨) 직접 추가한다.
  // percentile denominator는 반드시 self-included(PHASE 1.6 §2/§3)이므로 이
  // 처리를 생략하면 self-exclusion 버그가 생긴다.
  const hasTarget = universe.some((r) => r.aptSeq === target.aptSeq);
  const pool: PeerUniverseRow[] = hasTarget
    ? universe
    : [...universe, { aptSeq: target.aptSeq, sigungu: target.sigungu, buildYear: target.buildYear, totalHouseholds: target.totalHouseholds, v2Score: target.v2Score }];
  return computePeerContext(target, pool);
}
