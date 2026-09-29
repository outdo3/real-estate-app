// REALTOR_PRO_MVP_V1 — 고객 브리핑: 공유 토큰 + 스냅샷 조립 + 공개 뷰 접근 판정(순수 + node:crypto).
// docs/pro/REALTOR_PRO_V1_ARCHITECTURE.md §9
//
// · 토큰: 32바이트 CSPRNG → base64url(43자). DB에는 SHA-256 해시만 저장, 원문은 생성 응답에서 1회만 돌려준다.
// · 스냅샷: 생성 시점 표시 값을 고정한다(이후 매물·고객 수정이 공유된 브리핑을 바꾸지 않음).
//   **절대 포함 안 함**: 소유자 이름·연락처, 호수, 동(기본), 출입/열람 방법, 비공개 메모·노트·태그·출처,
//   고객 이름 전체·연락처·예산 원문, 다른 고객·다른 매칭, E-JIP Score.
// · 공공 실거래는 공개 지역(detail 축)일 때만 싣는다 — Pro는 공개 게이트의 예외가 아니다.

import { createHash, randomBytes } from 'node:crypto';
import { nameInitial, floorBandOf } from './rules';
import type { BriefingRow, BriefingSnapshot, ListingRow, PublicAptInfo, RealtorProfileRow } from './types';
import type { MatchResult } from './matching';
import type { ProfileStatus } from './rules';

export const BRIEFING_TOKEN_BYTES = 32;
export const BRIEFING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const BRIEFING_SNAPSHOT_RETENTION_DAYS = 90;

export function generateBriefingToken(): string {
  return randomBytes(BRIEFING_TOKEN_BYTES).toString('base64url');
}

export function hashBriefingToken(token: string): string {
  return createHash('sha256').update(`briefing:${token}`).digest('hex');
}

export const BRIEFING_DISCLAIMER =
  '본 자료는 참고용입니다. 실거래 데이터는 국토교통부 공개 자료 기준이며(기준일 표기), 매물 정보는 중개사가 제공한 내용입니다.';

export interface SnapshotInput {
  customerName: string | null;
  listing: ListingRow | null;
  publicInfo: PublicAptInfo | null;
  match: MatchResult | null;
  realtor: Pick<RealtorProfileRow, 'displayName' | 'officeName' | 'officePhone'>;
  now: Date;
}

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const uniq = (a: string[]) => [...new Set(a)];

// 브리핑용 고정 문구(고객 조건 값 없음). 키는 matching.ts의 사유 key.
export const FIT_MATCH_LABELS: Record<string, string> = {
  budget: '예산 범위 안',
  area: '요청 면적과 일치',
  moveIn: '희망 입주 시기와 맞음',
  commute: '통근 거리 조건 충족(직선거리 기준)',
  floor: '선호 층과 일치',
  newBuild: '신축 선호 충족',
  parking: '주차 가능',
  pet: '반려동물 가능',
};
export const FIT_DIFF_LABELS: Record<string, string> = {
  budget: '예산과 차이가 있습니다(중개사와 상담)',
  budgetMax: '예산과 차이가 있습니다(중개사와 상담)',
  monthlyRentMax: '월세 조건과 차이가 있습니다(중개사와 상담)',
  area: '요청 면적과 차이가 있습니다',
  mustArea: '요청 면적과 차이가 있습니다',
  moveIn: '입주 시기 조율이 필요합니다',
  mustMoveIn: '입주 시기 조율이 필요합니다',
  commute: '통근 거리가 먼 편입니다',
  floor: '선호 층과 다릅니다',
  newBuild: '신축 선호와 다릅니다',
  parking: '주차 조건과 다릅니다',
  mustParking: '주차 조건과 다릅니다',
  pet: '반려동물 조건과 다릅니다',
  mustPet: '반려동물 조건과 다릅니다',
  region: '희망 지역 밖입니다',
  dealType: '거래 유형이 다릅니다',
  active: '현재 거래 가능한 매물이 아닙니다',
};
export const FIT_UNKNOWN_LABELS: Record<string, string> = {
  budget: '가격', area: '면적', moveIn: '입주 가능일', commute: '통근 거리', school: '학교 조건', floor: '층', newBuild: '준공연도', parking: '주차', pet: '반려동물',
};

export function buildBriefingSnapshot(input: SnapshotInput): BriefingSnapshot {
  const { listing, publicInfo, match } = input;
  const recentTrades = publicInfo && publicInfo.detailOpen && publicInfo.tradeState === 'OK' ? publicInfo.recentTrades.slice(0, 5) : [];
  const state = !publicInfo ? 'UNRESOLVED_IDENTITY' : !publicInfo.detailOpen ? 'REGION_NOT_OPEN' : publicInfo.tradeState;
  const note =
    state === 'OK' ? '최근 실거래(같은 단지, 국토교통부 공개 자료)' :
    state === 'VERIFIED_ZERO' ? '최근 기간 동안 확인된 실거래가 없습니다' :
    state === 'REGION_NOT_OPEN' ? '이 지역의 공공 실거래 정보는 준비 중입니다' :
    state === 'UNRESOLVED_IDENTITY' ? '단지 정보가 연결되지 않아 공공 실거래를 표시하지 않습니다' :
    '공공 실거래 정보를 지금 불러올 수 없습니다';

  return {
    version: 1,
    customerLabel: `${nameInitial(input.customerName ?? '')} 고객님`,
    apartment: publicInfo
      ? { name: publicInfo.name, umdName: publicInfo.umdName, buildYear: publicInfo.buildYear, totalHouseholds: publicInfo.totalHouseholds }
      : listing
        ? { name: listing.aptNameSnapshot, umdName: listing.umdName, buildYear: null, totalHouseholds: null }
        : null,
    listing: listing
      ? {
          dealType: listing.dealType,
          askingPriceManwon: listing.askingPriceManwon,
          depositManwon: listing.depositManwon,
          monthlyRentManwon: listing.monthlyRentManwon,
          exclusiveAreaM2: listing.exclusiveAreaM2,
          floorBand: floorBandOf(listing.floor, listing.floorBand), // 정확 층·동·호수는 싣지 않는다
          moveInAvailableAt: ymd(listing.moveInAvailableAt),
          moveInNegotiable: listing.moveInNegotiable,
        }
      : null,
    publicData: { state, recentTrades, note },
    fit: match
      ? {
          score: match.passedHard ? match.score : null,
          confidence: match.confidence,
          // 사유 문장(r.detail)에는 고객 조건 값(예산·월세 상한·통근지 이름·면적 범위·희망일)이 들어 있다 →
          // 링크로 전달되는 스냅샷에는 **값 없는 고정 문구**만 싣는다(SECURITY_REVIEW MEDIUM 수정).
          matched: uniq(match.reasons.filter((r) => r.verdict === 'MATCH').map((r) => FIT_MATCH_LABELS[r.key] ?? '조건과 일치')),
          differences: uniq(
            [...match.exclusions, ...match.reasons.filter((r) => r.verdict === 'PARTIAL' || r.verdict === 'MISS')].map((r) => FIT_DIFF_LABELS[r.key] ?? '조건과 차이가 있습니다(중개사와 상담)')
          ),
          unknown: uniq(match.reasons.filter((r) => r.verdict === 'UNKNOWN').map((r) => `${FIT_UNKNOWN_LABELS[r.key] ?? '일부 조건'} 확인 필요`)),
        }
      : null,
    realtor: { displayName: input.realtor.displayName, officeName: input.realtor.officeName, officePhone: input.realtor.officePhone },
    disclaimer: BRIEFING_DISCLAIMER,
    dataAsOf: (publicInfo?.dataAsOf ?? input.now).toISOString(),
  };
}

export type BriefingAccess = 'OK' | 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'UNAVAILABLE';

/** 공개 뷰 접근 판정. 만료·회수·중개사 정지(인증 해제)면 내용을 보이지 않는다. */
export function evaluateBriefingAccess(
  found: { briefing: Pick<BriefingRow, 'expiresAt' | 'revokedAt' | 'snapshot'>; realtorStatus: ProfileStatus } | null,
  now: Date
): BriefingAccess {
  if (!found) return 'NOT_FOUND';
  const { briefing, realtorStatus } = found;
  if (briefing.revokedAt) return 'REVOKED';
  if (briefing.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (realtorStatus !== 'VERIFIED') return 'UNAVAILABLE';
  if (!briefing.snapshot) return 'EXPIRED';
  return 'OK';
}

/** 스냅샷 안에 비공개 필드가 섞이지 않았는지 검사(테스트·생성 직전 방어). 발견한 키 이름을 돌려준다.
 * (공공 실거래 행의 floor는 공개 데이터라 허용 — 매물의 정확한 층은 스냅샷 listing에 floorBand로만 들어간다.) */
export const SNAPSHOT_FORBIDDEN_KEYS = [
  'ownerName', 'ownerPhone', 'ownerPhoneEnc', 'ownerPhoneHash', 'unitHo', 'buildingDong', 'viewingMethod', 'viewingNote',
  'memo', 'tags', 'source', 'repairNote', 'parkingNote', 'phone', 'phoneEnc', 'phoneHash', 'email', 'emailEnc', 'budgetMinManwon',
  'budgetMaxManwon', 'customerId', 'realtorId', 'tokenHash', 'licenseNumberEnc',
];

export function findForbiddenSnapshotKeys(snapshot: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        if (SNAPSHOT_FORBIDDEN_KEYS.includes(k)) found.add(k);
        walk(child);
      }
    }
  };
  walk(snapshot);
  return [...found];
}
