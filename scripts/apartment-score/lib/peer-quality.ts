// E-JIP SCORE V2 STEP 0.6 — Peer Data Quality & Eligibility Model. PROTOTYPE ONLY.
// src/lib/apartment-score/server/*(production score engine)에서 이 파일을 import하지
// 않는다 — production calculateApartmentScore()는 이번 STEP에서 전혀 수정되지 않았다.
// 이 모듈은 read-only 분석/simulation 스크립트 전용이다.
//
// 설계 근거: STEP 0.5가 "distance 계산은 정확하나 peer 구성이 registry 미연결/
// 저신뢰 좌표로 오염돼 있다"(부산 50.7%)를 확정한 데 대한 후속. 여기서는 "어떤
// ApartmentMaster row가 다른 row의 peer가 될 자격이 있는가"를 실제 evidence
// (registry 연결/주소 존재/MOLIT 거래이력/geocodeQuality)만으로 분류한다 —
// "이름이 존재한다"만으로 HIGH를 주지 않는다(지시사항 §3 원칙).

export type IdentityQuality = 'IDENTITY_HIGH' | 'IDENTITY_MEDIUM' | 'IDENTITY_LOW' | 'IDENTITY_UNRESOLVED';
export type CoordQuality = 'COORD_HIGH' | 'COORD_LOW' | 'COORD_UNRESOLVED';
// [스키마 한계 명시] ApartmentMaster.geocodeQuality는 'exact'|'normalized'|'failed' 3단계만
// 저장한다(apartment_master_seed.ts:geocode() 확인) — road/jibun 주소가 있으면 'exact',
// 없거나 실패하면 "{동} {건물명}" 키워드 검색으로 'normalized', 전부 실패하면 'failed'.
// "normalized-address geocode"(C, 주소 자체를 정규화해 재시도)라는 중간 단계는 이
// 프로젝트에 별도로 존재하지 않는다 — 지시사항 §4의 A~F 후보 중 C는 이 스키마에서
// "존재하지 않음"으로 명시하고 임의로 만들어내지 않는다. COORD_MEDIUM도 동일한 이유로
// 도입하지 않는다(가짜 중간 등급을 만들면 오히려 근거 없는 정밀도를 주장하는 것).
export type PeerEligibility = 'PEER_FULL' | 'PEER_LIMITED' | 'DISPLAY_ONLY' | 'UNRESOLVED';

export interface QualityInput {
  aptSeq: string;
  roadAddress: string | null;
  jibunAddress: string | null;
  mgmBldrgstPk: string | null;
  totalHouseholds: number | null;
  parkingCount: number | null;
  mainBuildingCount: number | null;
  buildYear: number | null;
  geocodeQuality: string | null; // 'exact' | 'normalized' | 'failed' | null
  latitude: number | null;
  longitude: number | null;
  // [정정] STEP 0.5는 TradeHistory(이름 매칭) count를 썼으나, 이번 STEP에서
  // TradeHistory 테이블 자체가 전체 0 rows(DB 전역, 이 프로젝트에서 미사용 상태)임을
  // 발견했다 — STEP 0.5의 "TradeHistory 0건" 서술은 사실이었지만 그 자체가 공허한
  // 체크였다(항상 0). 실제 거래 evidence는 aptSeq로 정확히 join되는
  // ApartmentMarketFeature.transactionCount12m(market.ts가 이미 쓰는 값, MOLIT 원본)을
  // 대신 사용한다 — 이름 매칭 리스크 자체가 없는 더 안전한 source.
  transactionCount12m: number;
}

export interface QualityResult {
  aptSeq: string;
  identity: IdentityQuality;
  coord: CoordQuality;
  registryLinked: boolean; // totalHouseholds 확보(§5 registry quality axis)
  registryAttempted: boolean; // mgmBldrgstPk 존재(연결 시도는 됐으나 household 추출 실패한 80건 구분용)
  marketEvidence: 'STRONG' | 'WEAK' | 'ZERO'; // §6, MIN_TRANSACTION_SAMPLE=3(market.ts 기존 threshold 재사용)
  hasAddress: boolean;
  peerEligibility: PeerEligibility;
  // domain-specific eligibility(§8) — 공통 base(coord) + domain별 추가 요구사항 조합
  transportPeerEligible: boolean; // coordinate 품질만 요구(좌표 기반 거리 계산)
  livePeerEligible: boolean; // 동일
  schoolPeerEligible: boolean; // 동일
  parkingPeerEligible: boolean; // coordinate 무관, registry(parkingCount+totalHouseholds) 확보 필수
  complexPeerEligible: boolean; // buildYear는 MOLIT 원본이라 100% 있음 — registryLinked 여부와 무관하게 최소 buildYear peer는 가능하나, "안전한" peer로는 identity도 요구
}

function hasAddr(i: QualityInput): boolean {
  return i.roadAddress != null || i.jibunAddress != null;
}

// 지시사항 §3: "이름이 존재한다"만으로 HIGH 금지 — registry 연결(household 확보) +
// 실제 주소 존재를 함께 요구해야 HIGH. 둘 중 하나만 있으면 MEDIUM(최소 하나의 독립
// 증거는 있음). 주소도 registry도 없지만 MOLIT 거래 이력(이름 매칭)이 있으면 "적어도
// 이 이름의 실거래가 실제로 발생했다"는 최소 근거로 LOW. 그마저 없으면 UNRESOLVED —
// ApartmentMaster에 row는 있으나 identity를 뒷받침할 독립 증거가 전혀 없는 상태.
export function classifyIdentity(i: QualityInput): IdentityQuality {
  const registryLinked = i.totalHouseholds != null;
  const address = hasAddr(i);
  if (registryLinked && address) return 'IDENTITY_HIGH';
  if (registryLinked || address) return 'IDENTITY_MEDIUM';
  if (i.transactionCount12m > 0) return 'IDENTITY_LOW';
  return 'IDENTITY_UNRESOLVED';
}

export function classifyCoord(i: QualityInput): CoordQuality {
  if (i.latitude == null || i.longitude == null || i.geocodeQuality === 'failed' || i.geocodeQuality == null) return 'COORD_UNRESOLVED';
  if (i.geocodeQuality === 'exact') return 'COORD_HIGH';
  return 'COORD_LOW'; // 'normalized' — 동+건물명 키워드 검색(STEP 0.5에서 실제 오염 원인으로 확정)
}

export function classifyMarketEvidence(i: QualityInput): 'STRONG' | 'WEAK' | 'ZERO' {
  if (i.transactionCount12m >= 3) return 'STRONG'; // market.ts MIN_TRANSACTION_SAMPLE 재사용
  if (i.transactionCount12m >= 1) return 'WEAK';
  return 'ZERO';
}

// 지시사항 §7: peer eligibility. coordinate가 UNRESOLVED면 위치 기반 어떤 domain에도
// peer로 쓸 수 없다(표시조차 위치를 특정 못 하므로 무의미) → UNRESOLVED. coordinate가
// LOW(키워드 geocode)면 STEP 0.5가 실측으로 확정한 실제 오염원이라 "다른 단지의 peer
// 모집단"에는 절대 포함하지 않는다 — 그러나 이 단지 자신을 사용자에게 보여주는 것
// 자체는 막을 이유가 없다(§17 raw fact display와 분리) → DISPLAY_ONLY. coordinate가
// HIGH면 identity도 함께 확인: HIGH identity면 PEER_FULL(모든 domain), MEDIUM/LOW
// identity면 PEER_LIMITED(좌표 기반 domain만, registry 의존 domain은 제외 — §8).
export function classifyPeerEligibility(identity: IdentityQuality, coord: CoordQuality): PeerEligibility {
  if (coord === 'COORD_UNRESOLVED') return 'UNRESOLVED';
  if (coord === 'COORD_LOW') return 'DISPLAY_ONLY';
  // coord === COORD_HIGH
  if (identity === 'IDENTITY_HIGH') return 'PEER_FULL';
  return 'PEER_LIMITED'; // MEDIUM/LOW/UNRESOLVED identity라도 좌표 자체는 신뢰 가능
}

export function classify(i: QualityInput): QualityResult {
  const identity = classifyIdentity(i);
  const coord = classifyCoord(i);
  const registryLinked = i.totalHouseholds != null;
  const registryAttempted = i.mgmBldrgstPk != null;
  const marketEvidence = classifyMarketEvidence(i);
  const peerEligibility = classifyPeerEligibility(identity, coord);

  const coordOk = coord === 'COORD_HIGH';
  return {
    aptSeq: i.aptSeq,
    identity,
    coord,
    registryLinked,
    registryAttempted,
    marketEvidence,
    hasAddress: hasAddr(i),
    peerEligibility,
    // §8 domain-specific: transport/life/school은 좌표만 신뢰되면 충분(registry 무관 —
    // 이 프로젝트의 raw feature 자체가 좌표 기반 Kakao/TAGO 조회이지 registry 값이 아님).
    transportPeerEligible: coordOk,
    livePeerEligible: coordOk,
    schoolPeerEligible: coordOk,
    // parking은 registry 값(parkingCount/totalHouseholds) 자체가 없으면 애초에 라이도
    // 없어 peer 자격을 논할 필요조차 없다 — coordinate와 무관, registry 완전성이 전부.
    parkingPeerEligible: i.parkingCount != null && i.totalHouseholds != null && i.totalHouseholds > 0,
    // complex는 buildYear(MOLIT 원본, 100% coverage)만으로도 부분 계산 가능하나(STEP 0
    // §3에서 이미 확인), "안전한" peer로 인정하려면 최소 identity가 UNRESOLVED는 아니어야
    // 한다(완전히 근거 없는 row가 buildYear 하나로 다른 단지 순위를 흔드는 것 방지).
    complexPeerEligible: i.buildYear != null && identity !== 'IDENTITY_UNRESOLVED',
  };
}
