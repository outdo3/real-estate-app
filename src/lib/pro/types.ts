// REALTOR_PRO_MVP_V1 — 도메인 행 타입(저장 모양). Prisma 타입에 직접 묶지 않아 메모리 repo·테스트가 같은 계약을 쓴다.
// 연락처·자격번호는 암호문(*Enc) + 조회 해시(*Hash)만 — 평문 필드가 없다.

import type {
  AuditAction,
  AuditActorRole,
  ConsentStatus,
  CustomerStatus,
  DealType,
  FloorBand,
  FollowupKind,
  FollowupStatus,
  ListingSource,
  MatchConfidence,
  MatchState,
  MustHaveKey,
  NoteKind,
  PlanCode,
  ProfileStatus,
  RepairStatus,
  RepeatRule,
  SubscriptionStatus,
  TenantStatus,
  ViewingMethod,
} from './rules';

export interface RealtorProfileRow {
  id: string;
  userId: string;
  displayName: string;
  officeName: string | null;
  officePhone: string | null;
  officeAddress: string | null;
  logoUrl: string | null;
  licenseNumberEnc: string | null;
  officeRegNoEnc: string | null;
  businessRegNoEnc: string | null;
  status: ProfileStatus;
  statusReason: string | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  termsAgreedAt: Date;
  termsVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionRow {
  id: string;
  realtorId: string;
  plan: PlanCode;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListingRow {
  id: string;
  realtorId: string;
  aptSeq: string | null;
  lawdCd: string | null;
  umdName: string | null;
  aptNameSnapshot: string;
  buildingDong: string | null;
  unitHo: string | null;
  floor: number | null;
  floorBand: FloorBand | null;
  exclusiveAreaM2: number | null;
  unitTypeRef: number | null;
  dealType: DealType;
  askingPriceManwon: number | null;
  depositManwon: number | null;
  monthlyRentManwon: number | null;
  ownerName: string | null;
  ownerPhoneEnc: string | null;
  ownerPhoneHash: string | null;
  tenantStatus: TenantStatus | null;
  tenantLeaseEndsAt: Date | null;
  moveInAvailableAt: Date | null;
  moveInNegotiable: boolean;
  repairStatus: RepairStatus | null;
  repairNote: string | null;
  parkingNote: string | null;
  parkingAvailable: boolean | null;
  petAllowed: boolean | null;
  viewingMethod: ViewingMethod;
  viewingNote: string | null;
  source: ListingSource | null;
  memo: string | null;
  tags: string[];
  isActive: boolean;
  closedAt: Date | null;
  priceChangedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ListingWrite = Omit<ListingRow, 'id' | 'realtorId' | 'createdAt' | 'updatedAt'>;

export interface ListingNoteRow {
  id: string;
  realtorId: string;
  listingId: string;
  kind: NoteKind;
  body: string | null;
  prevPriceManwon: number | null;
  newPriceManwon: number | null;
  createdAt: Date;
}

export interface CustomerRow {
  id: string;
  realtorId: string;
  name: string;
  phoneEnc: string | null;
  phoneHash: string | null;
  emailEnc: string | null;
  emailHash: string | null;
  status: CustomerStatus;
  priority: number;
  nextFollowUpAt: Date | null;
  memo: string | null;
  consentStatus: ConsentStatus;
  consentRecordedAt: Date | null;
  lastActivityAt: Date;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CustomerWrite = Omit<CustomerRow, 'id' | 'realtorId' | 'createdAt' | 'updatedAt'>;

export interface PreferenceRow {
  id: string;
  realtorId: string;
  customerId: string;
  label: string;
  dealTypes: DealType[];
  budgetMinManwon: number | null;
  budgetMaxManwon: number | null;
  budgetTolerancePct: number;
  monthlyRentMaxManwon: number | null;
  lawdCds: string[];
  aptSeqs: string[];
  areaMinM2: number | null;
  areaMaxM2: number | null;
  moveInTargetAt: Date | null;
  commuteLabel: string | null;
  commuteLat: number | null;
  commuteLng: number | null;
  schoolIds: number[];
  preferNewBuild: boolean | null;
  parkingRequired: boolean | null;
  floorPreference: FloorBand | null;
  petRequired: boolean | null;
  mustHaveKeys: MustHaveKey[];
  specialConditions: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PreferenceWrite = Omit<PreferenceRow, 'id' | 'realtorId' | 'customerId' | 'createdAt' | 'updatedAt'>;

export type ReasonVerdict = 'MATCH' | 'PARTIAL' | 'MISS' | 'UNKNOWN';

export interface MatchReason {
  key: string;
  label: string;
  verdict: ReasonVerdict;
  weight: number; // soft 항목 가중치(hard 사유는 0)
  score: number | null; // 0~1, UNKNOWN이면 null
  detail: string;
  hard?: boolean;
}

export interface MatchRow {
  id: string;
  realtorId: string;
  customerId: string;
  preferenceId: string;
  listingId: string;
  score: number | null;
  confidence: MatchConfidence;
  passedHard: boolean;
  reasons: MatchReason[];
  engineVersion: string;
  inputHash: string;
  state: MatchState;
  computedAt: Date;
}

export interface FollowupRow {
  id: string;
  realtorId: string;
  customerId: string | null;
  listingId: string | null;
  kind: FollowupKind;
  status: FollowupStatus;
  dueAt: Date;
  note: string | null;
  doneAt: Date | null;
  repeatRule: RepeatRule | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BriefingRow {
  id: string;
  realtorId: string;
  customerId: string | null;
  listingId: string | null;
  aptSeq: string | null;
  tokenHash: string;
  snapshot: BriefingSnapshot | null;
  dataAsOf: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  firstViewedAt: Date | null;
  viewCount: number;
  createdAt: Date;
}

export interface AuditRow {
  id: string;
  actorUserId: string | null;
  actorRole: AuditActorRole;
  action: AuditAction;
  targetType: string;
  targetId: string | null;
  realtorId: string | null;
  reason: string | null;
  meta: Record<string, string | number | boolean | string[]> | null;
  createdAt: Date;
}

// ── 공공 데이터(이집 기존 데이터) ─────────────────────────────────────────────

export interface PublicTradePoint {
  dealDate: string; // YYYY-MM-DD
  priceManwon: number;
  exclusiveAreaM2: number;
  floor: number | null;
}

export type PublicTradeState = 'OK' | 'REGION_NOT_OPEN' | 'UNRESOLVED_IDENTITY' | 'UNAVAILABLE' | 'VERIFIED_ZERO';

export interface PublicAptInfo {
  aptSeq: string;
  name: string;
  lawdCd: string | null;
  umdName: string | null;
  roadAddress: string | null;
  buildYear: number | null;
  totalHouseholds: number | null;
  parkingCount: number | null;
  lat: number | null;
  lng: number | null;
  detailOpen: boolean; // getRegionEnablement(lawdCd).detail
  tradeState: PublicTradeState;
  recentTrades: PublicTradePoint[]; // detailOpen && tradeState==='OK'일 때만 채움
  areaOptionsM2: number[]; // 실거래 원본 전용면적(정확값) — 평형 계산 없음
  dataAsOf: Date;
}

// ── 브리핑 스냅샷(고객에게 보이는 값만) ──────────────────────────────────────

export interface BriefingSnapshot {
  version: 1;
  customerLabel: string; // "박OO 고객님" — 이니셜만
  apartment: {
    name: string;
    umdName: string | null;
    buildYear: number | null;
    totalHouseholds: number | null;
  } | null;
  listing: {
    dealType: DealType;
    askingPriceManwon: number | null;
    depositManwon: number | null;
    monthlyRentManwon: number | null;
    exclusiveAreaM2: number | null;
    floorBand: FloorBand | null;
    moveInAvailableAt: string | null; // YYYY-MM-DD
    moveInNegotiable: boolean;
  } | null;
  publicData: {
    state: PublicTradeState;
    recentTrades: PublicTradePoint[];
    note: string;
  };
  fit: {
    score: number | null;
    confidence: MatchConfidence;
    matched: string[];
    differences: string[];
    unknown: string[];
  } | null;
  realtor: {
    displayName: string;
    officeName: string | null;
    officePhone: string | null;
  };
  disclaimer: string;
  dataAsOf: string; // ISO
}
