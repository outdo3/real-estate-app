// REALTOR_PRO_MVP_V1 — 중개사 Pro 순수 규칙(React·Prisma·네트워크 없음). docs/pro/REALTOR_PRO_V1_ARCHITECTURE.md
//
// 허용 값 목록은 migration의 CHECK 제약과 **같은 목록**이어야 한다(pro-schema.test.ts가 migration.sql을 읽어 고정).
// 이 파일은 클라이언트 폼과 서버 API가 함께 쓴다 — 비밀 값·서버 전용 로직은 두지 않는다.
//
// 입력 검증은 repo 관행(feedback-rules.ts)대로 수동 검증이다. 검증 함수는 **허용 필드만** 새 객체로 복사해 돌려준다
// (mass assignment 차단 — realtorId·status·deletedAt 같은 서버 전용 필드는 입력에서 절대 오지 않는다).

export const PROFILE_STATUSES = ['PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export const SUBSCRIPTION_PLANS = ['FREE', 'PRO'] as const;
export type PlanCode = (typeof SUBSCRIPTION_PLANS)[number];
export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'BETA_GRANT', 'GRACE', 'CANCELED', 'EXPIRED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const DEAL_TYPES = ['SALE', 'JEONSE', 'MONTHLY'] as const;
export type DealType = (typeof DEAL_TYPES)[number];
export const DEAL_TYPE_LABELS: Record<DealType, string> = { SALE: '매매', JEONSE: '전세', MONTHLY: '월세' };

export const FLOOR_BANDS = ['LOW', 'MID', 'HIGH'] as const;
export type FloorBand = (typeof FLOOR_BANDS)[number];
export const FLOOR_BAND_LABELS: Record<FloorBand, string> = { LOW: '저층', MID: '중층', HIGH: '고층' };

export const TENANT_STATUSES = ['VACANT', 'OWNER_OCCUPIED', 'TENANTED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];
export const TENANT_STATUS_LABELS: Record<TenantStatus, string> = { VACANT: '공실', OWNER_OCCUPIED: '집주인 거주', TENANTED: '임차인 거주' };

export const REPAIR_STATUSES = ['ORIGINAL', 'PARTIAL', 'FULL'] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];
export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = { ORIGINAL: '기본', PARTIAL: '부분 수리', FULL: '전체 수리' };

export const VIEWING_METHODS = ['CONTACT_REALTOR', 'OWNER_PRESENT', 'TENANT_COORDINATION', 'VACANT_CONTACT_REALTOR'] as const;
export type ViewingMethod = (typeof VIEWING_METHODS)[number];
export const VIEWING_METHOD_LABELS: Record<ViewingMethod, string> = {
  CONTACT_REALTOR: '중개사 문의',
  OWNER_PRESENT: '집주인 입회',
  TENANT_COORDINATION: '임차인과 일정 조율',
  VACANT_CONTACT_REALTOR: '공실 — 중개사 문의',
};

export const LISTING_SOURCES = ['OWNER_DIRECT', 'CO_BROKER', 'WALK_IN', 'OTHER'] as const;
export type ListingSource = (typeof LISTING_SOURCES)[number];
export const LISTING_SOURCE_LABELS: Record<ListingSource, string> = { OWNER_DIRECT: '집주인 직접', CO_BROKER: '공동중개', WALK_IN: '방문 접수', OTHER: '기타' };

export const NOTE_KINDS = ['NOTE', 'PRICE_CHANGE', 'STATUS_CHANGE'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const CUSTOMER_STATUSES = ['NEW', 'ACTIVE', 'ON_HOLD', 'CONTRACTED', 'CLOSED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = { NEW: '신규', ACTIVE: '진행 중', ON_HOLD: '보류', CONTRACTED: '계약', CLOSED: '종료' };

export const CONSENT_STATUSES = ['NOT_RECORDED', 'VERBAL', 'WRITTEN', 'WITHDRAWN'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];
export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = { NOT_RECORDED: '미기록', VERBAL: '구두 동의', WRITTEN: '서면 동의', WITHDRAWN: '동의 철회' };

export const MATCH_STATES = ['NEW', 'SEEN', 'SHORTLISTED', 'DISMISSED'] as const;
export type MatchState = (typeof MATCH_STATES)[number];
export const MATCH_CONFIDENCES = ['SUFFICIENT', 'INSUFFICIENT'] as const;
export type MatchConfidence = (typeof MATCH_CONFIDENCES)[number];

export const FOLLOWUP_KINDS = ['CALL', 'VIEWING', 'CONTRACT', 'MOVE_IN', 'OTHER'] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];
export const FOLLOWUP_KIND_LABELS: Record<FollowupKind, string> = { CALL: '연락', VIEWING: '방문 안내', CONTRACT: '계약', MOVE_IN: '입주', OTHER: '기타' };
export const FOLLOWUP_STATUSES = ['OPEN', 'DONE', 'CANCELED'] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];
export const REPEAT_RULES = ['WEEKLY', 'MONTHLY'] as const;
export type RepeatRule = (typeof REPEAT_RULES)[number];

export const AUDIT_ACTOR_ROLES = ['REALTOR', 'ADMIN', 'SYSTEM'] as const;
export type AuditActorRole = (typeof AUDIT_ACTOR_ROLES)[number];
export const AUDIT_ACTIONS = [
  'PROFILE_APPLIED',
  'PROFILE_UPDATED',
  'PROFILE_STATUS_CHANGE',
  'PLAN_CHANGE',
  'LISTING_CREATED',
  'LISTING_UPDATED',
  'LISTING_ARCHIVED',
  'LISTING_DELETED',
  'CUSTOMER_CREATED',
  'CUSTOMER_VIEWED',
  'CUSTOMER_UPDATED',
  'CUSTOMER_DELETED',
  'CONTACT_DECRYPTED',
  'BRIEFING_CREATED',
  'BRIEFING_SHARED',
  'BRIEFING_REVOKED',
  'EXPORT_REQUESTED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const PRIORITY_MIN = 1;
export const PRIORITY_MAX = 3;
export const BUDGET_TOLERANCE_MAX_PCT = 10;
export const FLOOR_MIN = -5;
export const FLOOR_MAX = 200;
export const TERMS_VERSION = 'pro-beta-2026-09';

export const TEXT_LIMITS = {
  name: 40,
  officeName: 60,
  officeAddress: 120,
  phone: 20,
  email: 120,
  aptName: 80,
  shortNote: 200,
  memo: 2000,
  tag: 20,
  tagsMax: 10,
  licenseNumber: 40,
  label: 20,
} as const;

// ── SENSITIVE_DO_NOT_STORE 경고 ─────────────────────────────────────────────
// 출입 비밀번호·열쇠 위치·공동현관 번호는 저장 필드가 없다. 자유 텍스트(메모·열람 메모·노트)에 섞여 들어오는 것도
// 막기 위해 패턴을 감지하면 **저장 전에 확인을 요구**한다(오탐 가능성 때문에 강제 차단 대신 확인). 감지 여부만 쓰고
// 내용은 어디에도 로그로 남기지 않는다.
const SENSITIVE_PATTERNS: RegExp[] = [
  /비\s*번/,
  /비밀\s*번호/,
  /도어\s*락/,
  /현관\s*(번호|비번|비밀)/,
  /공동\s*현관/,
  /열쇠\s*(는|위치|보관)/,
  /키\s*박스/,
  /락\s*박스/,
  /lock\s*box/i,
  /pass\s*(word|code)/i,
  /(?:^|[^\d])[#*]\s*\d{3,}/,
  /\d{6}\s*-\s*[1-4]\d{6}/, // 주민등록번호 형식
];

export function detectSensitiveText(text: string | null | undefined): boolean {
  if (!text) return false;
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

export const SENSITIVE_WARNING =
  '출입 비밀번호·열쇠 위치·공동현관 번호·주민등록번호는 입력하지 마세요. 유출되면 범죄에 악용될 수 있습니다.';

// ── 공통 파서 ───────────────────────────────────────────────────────────────

export type FieldError = { field: string; code: string };
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

class Collector {
  errors: FieldError[] = [];
  constructor(private readonly src: Record<string, unknown>) {}
  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.src, key) && this.src[key] !== undefined;
  }
  str(key: string, max: number, opts: { required?: boolean } = {}): string | null {
    const raw = this.src[key];
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      if (opts.required) this.errors.push({ field: key, code: 'REQUIRED' });
      return null;
    }
    if (typeof raw !== 'string') { this.errors.push({ field: key, code: 'INVALID' }); return null; }
    const v = raw.trim();
    if (v.length > max) { this.errors.push({ field: key, code: 'TOO_LONG' }); return null; }
    return v;
  }
  oneOf<T extends string>(key: string, list: readonly T[], opts: { required?: boolean } = {}): T | null {
    const raw = this.src[key];
    if (raw === undefined || raw === null || raw === '') {
      if (opts.required) this.errors.push({ field: key, code: 'REQUIRED' });
      return null;
    }
    if (typeof raw !== 'string' || !(list as readonly string[]).includes(raw)) { this.errors.push({ field: key, code: 'INVALID' }); return null; }
    return raw as T;
  }
  int(key: string, min: number, max: number, opts: { required?: boolean } = {}): number | null {
    const raw = this.src[key];
    if (raw === undefined || raw === null || raw === '') {
      if (opts.required) this.errors.push({ field: key, code: 'REQUIRED' });
      return null;
    }
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < min || n > max) { this.errors.push({ field: key, code: 'INVALID' }); return null; }
    return n;
  }
  num(key: string, min: number, max: number): number | null {
    const raw = this.src[key];
    if (raw === undefined || raw === null || raw === '') return null;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < min || n > max) { this.errors.push({ field: key, code: 'INVALID' }); return null; }
    return n;
  }
  bool(key: string): boolean | null {
    const raw = this.src[key];
    if (raw === undefined || raw === null || raw === '') return null;
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    this.errors.push({ field: key, code: 'INVALID' });
    return null;
  }
  date(key: string): Date | null {
    const raw = this.src[key];
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string' && !(raw instanceof Date)) { this.errors.push({ field: key, code: 'INVALID' }); return null; }
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) { this.errors.push({ field: key, code: 'INVALID' }); return null; }
    return d;
  }
  strList(key: string, itemMax: number, maxItems: number, pattern?: RegExp): string[] {
    const raw = this.src[key];
    if (raw === undefined || raw === null || raw === '') return [];
    const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null;
    if (!arr) { this.errors.push({ field: key, code: 'INVALID' }); return []; }
    const out: string[] = [];
    for (const item of arr) {
      if (typeof item !== 'string') { this.errors.push({ field: key, code: 'INVALID' }); return []; }
      const v = item.trim();
      if (!v) continue;
      if (v.length > itemMax || (pattern && !pattern.test(v))) { this.errors.push({ field: key, code: 'INVALID' }); return []; }
      if (!out.includes(v)) out.push(v);
    }
    if (out.length > maxItems) { this.errors.push({ field: key, code: 'TOO_MANY' }); return []; }
    return out;
  }
  enumList<T extends string>(key: string, list: readonly T[]): T[] {
    const vals = this.strList(key, 20, list.length);
    for (const v of vals) if (!(list as readonly string[]).includes(v)) { this.errors.push({ field: key, code: 'INVALID' }); return []; }
    return vals as T[];
  }
}

export const APT_SEQ_PATTERN = /^\d{5}-\d{1,12}$/;
export const LAWD_CD_PATTERN = /^\d{5}$/;
const MAX_MANWON = 10_000_000; // 1,000억(만원) — 입력 오타 방지 상한

// ── 중개사 프로필 ────────────────────────────────────────────────────────────

export interface ProfileInput {
  displayName: string;
  officeName: string | null;
  officePhone: string | null;
  officeAddress: string | null;
  licenseNumber: string | null;
  officeRegNo: string | null;
  businessRegNo: string | null;
  agreeTerms: boolean;
}

export function validateProfileInput(body: unknown, opts: { requireTerms: boolean }): Validated<ProfileInput> {
  if (!isRecord(body)) return { ok: false, errors: [{ field: '_', code: 'INVALID_BODY' }] };
  const c = new Collector(body);
  const value: ProfileInput = {
    displayName: c.str('displayName', TEXT_LIMITS.name, { required: true }) ?? '',
    officeName: c.str('officeName', TEXT_LIMITS.officeName),
    officePhone: c.str('officePhone', TEXT_LIMITS.phone),
    officeAddress: c.str('officeAddress', TEXT_LIMITS.officeAddress),
    licenseNumber: c.str('licenseNumber', TEXT_LIMITS.licenseNumber),
    officeRegNo: c.str('officeRegNo', TEXT_LIMITS.licenseNumber),
    businessRegNo: c.str('businessRegNo', TEXT_LIMITS.licenseNumber),
    agreeTerms: c.bool('agreeTerms') === true,
  };
  if (value.officePhone && !normalizePhoneDigits(value.officePhone)) c.errors.push({ field: 'officePhone', code: 'INVALID' });
  if (opts.requireTerms && !value.agreeTerms) c.errors.push({ field: 'agreeTerms', code: 'REQUIRED' });
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value };
}

// ── 매물 ────────────────────────────────────────────────────────────────────

export interface ListingInput {
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
  ownerPhone: string | null; // 평문 입력 — 서비스가 즉시 암호화, 저장·로그 금지
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
}

/** 매물 입력. `partial`이면 들어온 키만 검증해 부분 갱신용 객체를 돌려준다(서버 전용 필드는 여전히 받지 않음). */
export function validateListingInput(body: unknown, opts: { partial?: boolean } = {}): Validated<Partial<ListingInput>> {
  if (!isRecord(body)) return { ok: false, errors: [{ field: '_', code: 'INVALID_BODY' }] };
  const c = new Collector(body);
  const req = !opts.partial;
  const v: Partial<ListingInput> = {};
  const take = <K extends keyof ListingInput>(key: K, fn: () => ListingInput[K]) => {
    if (!req && !c.has(key)) return;
    v[key] = fn();
  };
  take('aptSeq', () => { const s = c.str('aptSeq', 20); if (s && !APT_SEQ_PATTERN.test(s)) { c.errors.push({ field: 'aptSeq', code: 'INVALID' }); return null; } return s; });
  take('lawdCd', () => { const s = c.str('lawdCd', 5); if (s && !LAWD_CD_PATTERN.test(s)) { c.errors.push({ field: 'lawdCd', code: 'INVALID' }); return null; } return s; });
  take('umdName', () => c.str('umdName', 30));
  take('aptNameSnapshot', () => c.str('aptNameSnapshot', TEXT_LIMITS.aptName, { required: req }) ?? '');
  take('buildingDong', () => c.str('buildingDong', 10));
  take('unitHo', () => c.str('unitHo', 10));
  take('floor', () => c.int('floor', FLOOR_MIN, FLOOR_MAX));
  take('floorBand', () => c.oneOf('floorBand', FLOOR_BANDS));
  take('exclusiveAreaM2', () => c.num('exclusiveAreaM2', 5, 1000));
  take('unitTypeRef', () => c.int('unitTypeRef', 1, 2_147_483_647));
  take('dealType', () => c.oneOf('dealType', DEAL_TYPES, { required: req }) as DealType);
  take('askingPriceManwon', () => c.int('askingPriceManwon', 0, MAX_MANWON));
  take('depositManwon', () => c.int('depositManwon', 0, MAX_MANWON));
  take('monthlyRentManwon', () => c.int('monthlyRentManwon', 0, 100_000));
  take('ownerName', () => c.str('ownerName', TEXT_LIMITS.name));
  take('ownerPhone', () => { const s = c.str('ownerPhone', TEXT_LIMITS.phone); if (s && !normalizePhoneDigits(s)) { c.errors.push({ field: 'ownerPhone', code: 'INVALID' }); return null; } return s; });
  take('tenantStatus', () => c.oneOf('tenantStatus', TENANT_STATUSES));
  take('tenantLeaseEndsAt', () => c.date('tenantLeaseEndsAt'));
  take('moveInAvailableAt', () => c.date('moveInAvailableAt'));
  take('moveInNegotiable', () => c.bool('moveInNegotiable') === true);
  take('repairStatus', () => c.oneOf('repairStatus', REPAIR_STATUSES));
  take('repairNote', () => c.str('repairNote', TEXT_LIMITS.shortNote));
  take('parkingNote', () => c.str('parkingNote', TEXT_LIMITS.shortNote));
  take('parkingAvailable', () => c.bool('parkingAvailable'));
  take('petAllowed', () => c.bool('petAllowed'));
  take('viewingMethod', () => c.oneOf('viewingMethod', VIEWING_METHODS) ?? 'CONTACT_REALTOR');
  take('viewingNote', () => c.str('viewingNote', TEXT_LIMITS.shortNote));
  take('source', () => c.oneOf('source', LISTING_SOURCES));
  take('memo', () => c.str('memo', TEXT_LIMITS.memo));
  take('tags', () => c.strList('tags', TEXT_LIMITS.tag, TEXT_LIMITS.tagsMax));

  // 거래유형별 가격 필수 조합(전체 입력일 때만 — 부분 갱신은 서비스가 병합 후 다시 검사)
  if (req && v.dealType) {
    const priceErr = checkDealPrices(v as ListingInput);
    if (priceErr) c.errors.push(priceErr);
  }
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value: v };
}

export function checkDealPrices(l: Pick<ListingInput, 'dealType' | 'askingPriceManwon' | 'depositManwon' | 'monthlyRentManwon'>): FieldError | null {
  if (l.dealType === 'SALE' && l.askingPriceManwon == null) return { field: 'askingPriceManwon', code: 'REQUIRED' };
  if (l.dealType === 'JEONSE' && l.depositManwon == null) return { field: 'depositManwon', code: 'REQUIRED' };
  if (l.dealType === 'MONTHLY' && (l.depositManwon == null || l.monthlyRentManwon == null)) return { field: 'monthlyRentManwon', code: 'REQUIRED' };
  return null;
}

/** 저장 전 확인이 필요한 자유 텍스트(비밀번호·열쇠·주민번호 패턴). 필드 이름만 돌려준다. */
export function sensitiveFieldsIn(input: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((k) => typeof input[k] === 'string' && detectSensitiveText(input[k] as string));
}
export const LISTING_FREE_TEXT_KEYS = ['memo', 'viewingNote', 'repairNote', 'parkingNote'] as const;
export const CUSTOMER_FREE_TEXT_KEYS = ['memo'] as const;

// ── 고객 ────────────────────────────────────────────────────────────────────

export interface CustomerInput {
  name: string;
  phone: string | null; // 평문 입력 — 서비스가 즉시 암호화
  email: string | null;
  status: CustomerStatus;
  priority: number;
  memo: string | null;
  consentStatus: ConsentStatus;
}

export function validateCustomerInput(body: unknown, opts: { partial?: boolean } = {}): Validated<Partial<CustomerInput>> {
  if (!isRecord(body)) return { ok: false, errors: [{ field: '_', code: 'INVALID_BODY' }] };
  const c = new Collector(body);
  const req = !opts.partial;
  const v: Partial<CustomerInput> = {};
  const take = <K extends keyof CustomerInput>(key: K, fn: () => CustomerInput[K]) => {
    if (!req && !c.has(key)) return;
    v[key] = fn();
  };
  take('name', () => c.str('name', TEXT_LIMITS.name, { required: req }) ?? '');
  take('phone', () => { const s = c.str('phone', TEXT_LIMITS.phone); if (s && !normalizePhoneDigits(s)) { c.errors.push({ field: 'phone', code: 'INVALID' }); return null; } return s; });
  take('email', () => { const s = c.str('email', TEXT_LIMITS.email); if (s && !normalizeEmailAddress(s)) { c.errors.push({ field: 'email', code: 'INVALID' }); return null; } return s; });
  take('status', () => c.oneOf('status', CUSTOMER_STATUSES) ?? 'NEW');
  take('priority', () => c.int('priority', PRIORITY_MIN, PRIORITY_MAX) ?? 2);
  take('memo', () => c.str('memo', TEXT_LIMITS.memo));
  take('consentStatus', () => c.oneOf('consentStatus', CONSENT_STATUSES) ?? 'NOT_RECORDED');
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value: v };
}

export interface PreferenceInput {
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
}

export const MUST_HAVE_KEYS = ['parking', 'pet', 'moveIn', 'area'] as const;
export type MustHaveKey = (typeof MUST_HAVE_KEYS)[number];

export function validatePreferenceInput(body: unknown): Validated<PreferenceInput> {
  if (!isRecord(body)) return { ok: false, errors: [{ field: '_', code: 'INVALID_BODY' }] };
  const c = new Collector(body);
  const schoolRaw = c.strList('schoolIds', 12, 5, /^\d+$/);
  const v: PreferenceInput = {
    label: c.str('label', TEXT_LIMITS.label) ?? '기본',
    dealTypes: c.enumList('dealTypes', DEAL_TYPES),
    budgetMinManwon: c.int('budgetMinManwon', 0, MAX_MANWON),
    budgetMaxManwon: c.int('budgetMaxManwon', 0, MAX_MANWON),
    budgetTolerancePct: c.int('budgetTolerancePct', 0, BUDGET_TOLERANCE_MAX_PCT) ?? 0,
    monthlyRentMaxManwon: c.int('monthlyRentMaxManwon', 0, 100_000),
    lawdCds: c.strList('lawdCds', 5, 25, LAWD_CD_PATTERN),
    aptSeqs: c.strList('aptSeqs', 20, 20, APT_SEQ_PATTERN),
    areaMinM2: c.num('areaMinM2', 5, 1000),
    areaMaxM2: c.num('areaMaxM2', 5, 1000),
    moveInTargetAt: c.date('moveInTargetAt'),
    commuteLabel: c.str('commuteLabel', 40),
    commuteLat: c.num('commuteLat', 33, 39),
    commuteLng: c.num('commuteLng', 124, 132),
    schoolIds: schoolRaw.map(Number),
    preferNewBuild: c.bool('preferNewBuild'),
    parkingRequired: c.bool('parkingRequired'),
    floorPreference: c.oneOf('floorPreference', FLOOR_BANDS),
    petRequired: c.bool('petRequired'),
    mustHaveKeys: c.enumList('mustHaveKeys', MUST_HAVE_KEYS),
    specialConditions: c.str('specialConditions', TEXT_LIMITS.shortNote),
  };
  if (v.dealTypes.length === 0) c.errors.push({ field: 'dealTypes', code: 'REQUIRED' });
  if (v.budgetMinManwon != null && v.budgetMaxManwon != null && v.budgetMinManwon > v.budgetMaxManwon) c.errors.push({ field: 'budgetMaxManwon', code: 'RANGE' });
  if (v.areaMinM2 != null && v.areaMaxM2 != null && v.areaMinM2 > v.areaMaxM2) c.errors.push({ field: 'areaMaxM2', code: 'RANGE' });
  if ((v.commuteLat == null) !== (v.commuteLng == null)) c.errors.push({ field: 'commuteLat', code: 'PAIR' });
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value: v };
}

// ── 팔로업 ──────────────────────────────────────────────────────────────────

export interface FollowupInput {
  customerId: string | null;
  listingId: string | null;
  kind: FollowupKind;
  dueAt: Date;
  note: string | null;
  repeatRule: RepeatRule | null;
}

export function validateFollowupInput(body: unknown): Validated<FollowupInput> {
  if (!isRecord(body)) return { ok: false, errors: [{ field: '_', code: 'INVALID_BODY' }] };
  const c = new Collector(body);
  const dueAt = c.date('dueAt');
  if (!dueAt) c.errors.push({ field: 'dueAt', code: 'REQUIRED' });
  const v: FollowupInput = {
    customerId: c.str('customerId', 40),
    listingId: c.str('listingId', 40),
    kind: (c.oneOf('kind', FOLLOWUP_KINDS) ?? 'CALL') as FollowupKind,
    dueAt: dueAt ?? new Date(0),
    note: c.str('note', TEXT_LIMITS.shortNote),
    repeatRule: c.oneOf('repeatRule', REPEAT_RULES),
  };
  if (!v.customerId && !v.listingId) c.errors.push({ field: 'customerId', code: 'REQUIRED' });
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value: v };
}

// ── 연락처 정규화(순수) ──────────────────────────────────────────────────────

/** 한국 전화번호 숫자만 남긴다(+82 → 0). 유효 길이가 아니면 null. */
export function normalizePhoneDigits(raw: string): string | null {
  let d = raw.replace(/[\s\-().]/g, '');
  if (d.startsWith('+82')) d = `0${d.slice(3)}`;
  if (!/^\d+$/.test(d)) return null;
  if (d.length < 9 || d.length > 11 || !d.startsWith('0')) return null;
  return d;
}

export function normalizeEmailAddress(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (e.length > TEXT_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

/** 목록 화면용 마스킹(평문 전체를 내려보내지 않을 때). "010-****-5678". */
export function maskPhone(digits: string | null): string | null {
  if (!digits) return null;
  if (digits.length < 8) return '****';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

/** 브리핑·목록용 이름 이니셜("박OO"). */
export function nameInitial(name: string): string {
  // 앞머리 꼬리표([VIP] 등)·기호를 건너뛰고 첫 글자(한글·영문)만 쓴다. 글자가 없으면 이니셜 없이 '고객'
  const t = name.replace(/^\s*(\[[^\]]*\]|\([^)]*\))\s*/, '');
  const first = t.match(/\p{L}/u)?.[0];
  return first ? `${first}OO` : '고객';
}

/** 층 → 저/중/고 구간(단지 최고층 모를 때의 보수적 기본: 1–3 저, 4–10 중, 그 이상 고). */
export function floorBandOf(floor: number | null, explicit: FloorBand | null): FloorBand | null {
  if (explicit) return explicit;
  if (floor == null) return null;
  if (floor <= 3) return 'LOW';
  if (floor <= 10) return 'MID';
  return 'HIGH';
}
