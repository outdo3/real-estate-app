// SELLFLOW_DATA_API_V1.3 - 건물별 단지·교육 컨텍스트 / 시군구별 지역 개발·공급 컨텍스트. 읽기 전용. DB는 `SellflowContextDb` 포트로만 만난다(테스트에서 가짜로 바꾼다).
//
// 원칙(문서 §14):
//   * 있는 데이터만 낸다. 결측을 0이나 추정값으로 채우지 않는다. 출처를 알 수 없는 단지 속성(basicSpecSource = UNKNOWN)은 값이 있어도 내지 않는다.
//   * 라이선스·재제공 조건이 확정되지 않은 데이터는 SELLFLOW로 내보내지 않고 `withheld`에 이유와 함께 적는다: Kakao 수집값(교통·생활시설 개수와 거리),
//     Kakao 좌표에서 계산한 학교까지의 거리, 학교알리미 통계, 크롤링으로 모은 단지 커뮤니티 시설. 이집 화면에 보인다는 이유로 내보내지 않는다.
//   * 교육: 공식 통학구역 자료(한국교육시설안전원, 부산)만. 구역은 학교 배정 보장이 아니다. 거리는 내지 않는다.
//   * 재개발·재건축: 좌표 없이 시군구 단위 지역 이슈로만. 단계는 자료가 말하는 그대로이고 확정이 아닌 단계를 '확정'으로 쓰지 않도록 그룹과 주의사항을 같이 낸다.
//   * 분양: 공고 날짜로 과거·접수 예정·접수 중을 가른다. 자동 갱신이 보장되지 않으므로 마지막 수집 시각을 같이 내고, 최근에 수집되지 않았으면 '현재 진행 중'으로 쓰지 못하게 한다.
//   * 자료 없음(NO_DATA), 다루지 않는 범위(NOT_COVERED), 권한 없음(ACCESS_DENIED), 조회 실패(UNAVAILABLE)는 서로 다른 값이다. 한 영역의 실패가 다른 영역을 지우지 않는다(부분 성공).
import { BUSINESS_TYPE_LABELS, SOURCE_LABELS, STAGE_LABELS } from '../../redevelopment/labels';
import type { CanonicalBusinessType, CanonicalStage } from '../../redevelopment/types';
import { getRegionByLawdCd, getSido } from '../../region/registry';
import { BUILDING_SOURCE, SellflowApiError, type PropertyType, type SourceInfo } from './contract';
import { loadMaster, mapBuilding, type BuildingDto, type MasterRow, type SellflowDb } from './service';

export type SectionStatus = 'HAS_DATA' | 'NO_DATA' | 'NOT_COVERED' | 'ACCESS_DENIED' | 'UNAVAILABLE';

// ------------------------------------------------------------------ ports
export type BasicSpecSource = 'BUILDINGHUB_GENERAL_TITLE' | 'BUILDINGHUB_TITLE' | 'UNKNOWN';
export interface ComplexAttributesRow {
  parkingCount: number | null;
  floorAreaRatio: number | null;
  buildingCoverageRatio: number | null;
  mainBuildingCount: number | null;
  useApprovalDate: string | null;
  basicSpecSource: BasicSpecSource;
  updatedAt: string | null;
}
export interface RedevelopmentGroupRow { stage: string; businessType: string; projectStatus: string; needsReview: boolean; count: number }
export interface RedevelopmentItemRow {
  name: string; businessType: string; stage: string; projectStatus: string; householdCount: number | null; primarySource: string; dataUpdatedAt: string;
}
export interface RedevelopmentRows { groups: RedevelopmentGroupRow[]; items: RedevelopmentItemRow[]; latestSourceUpdatedAt: string | null; latestCollectedAt: string | null }
export interface PresaleRow {
  houseName: string; houseType: string; totalSupplyHouseholds: number | null; announcementDate: string | null; receiptStartDate: string | null; receiptEndDate: string | null;
  moveInExpectedYm: string | null; minPrice: number | null; maxPrice: number | null; pblancUrl: string | null; locationAddress: string | null;
}
export interface PresaleRows { total: number; rows: PresaleRow[]; lastCollectedAt: string | null }

export interface SellflowContextDb {
  /** 아파트 마스터의 단지 속성(건축물대장 기반). 오피스텔은 없다. */
  getComplexAttributes(aptSeq: string): Promise<ComplexAttributesRow | null>;
  listRedevelopment(input: { sido: string; sigungu: string; take: number }): Promise<RedevelopmentRows>;
  listPresales(input: { sidoShort: string; addressPrefix: string; take: number }): Promise<PresaleRows>;
}

/** 공식 통학구역 자료 조회(부산 아파트). 파일 기반이라 DB가 없다. 없으면 null. */
export interface EducationZoneInfo {
  elementary: { status: string; reasonCode: string; zoneName: string | null; zoneType: string; schools: { schoolName: string; identityConfidence: string }[]; sourceDate: string; sourceName: string; notice: string };
  middle: { status: string; reasonCode: string; groupName: string | null; schools: { schoolName: string; identityConfidence: string }[]; sourceDate: string };
  datasetVersion: string;
  generatedAt: string;
}
export type EducationZoneLookup = (aptSeq: string) => EducationZoneInfo | null;

// ------------------------------------------------------------------ errors
/** 읽기 전용 역할에 SELECT 권한이 없을 때(42501). 조회 실패나 '자료 없음'으로 바꾸지 않고 따로 알린다. */
export function isAccessDenied(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const o = e as { message?: unknown; code?: unknown; meta?: { code?: unknown; message?: unknown } };
  const text = `${String(o.message ?? '')} ${String(o.meta?.message ?? '')}`;
  return o.code === '42501' || o.meta?.code === '42501' || /permission denied|42501/i.test(text);
}
function failureOf(e: unknown): { status: Extract<SectionStatus, 'ACCESS_DENIED' | 'UNAVAILABLE'>; code: string } {
  return isAccessDenied(e) ? { status: 'ACCESS_DENIED', code: 'DATA_ACCESS_DENIED' } : { status: 'UNAVAILABLE', code: 'DATA_UNAVAILABLE' };
}

// ------------------------------------------------------------------ withheld (라이선스·출처 미확정)
export interface Withheld { category: 'SCHOOL_DISTANCE' | 'TRANSIT' | 'LIVING_FACILITIES' | 'SCHOOL_STATISTICS' | 'COMPLEX_COMMUNITY_FACILITIES'; reason: 'LICENSE_PENDING' | 'SOURCE_UNVERIFIED'; detail: string }
export const WITHHELD: readonly Withheld[] = [
  { category: 'SCHOOL_DISTANCE', reason: 'LICENSE_PENDING', detail: '학교까지의 거리는 Kakao에서 얻은 단지 좌표로 계산한 값이라 서비스 간 재제공 조건이 확정되기 전에는 제공하지 않는다.' },
  { category: 'TRANSIT', reason: 'LICENSE_PENDING', detail: '지하철·버스 접근성(거리·개수)은 Kakao 수집값이라 제공하지 않는다.' },
  { category: 'LIVING_FACILITIES', reason: 'LICENSE_PENDING', detail: '마트·편의점·병원·공원 등 생활시설 개수와 거리는 Kakao 수집값이라 제공하지 않는다.' },
  { category: 'SCHOOL_STATISTICS', reason: 'LICENSE_PENDING', detail: '학교알리미 학생수·학급수는 이용 조건(변경 금지 여부)이 확정되지 않아 제공하지 않는다.' },
  { category: 'COMPLEX_COMMUNITY_FACILITIES', reason: 'SOURCE_UNVERIFIED', detail: '단지 커뮤니티 시설은 크롤링으로 모은 값이라 출처를 검증할 수 없어 제공하지 않는다.' },
];

// ------------------------------------------------------------------ sources
const PROVIDER_PUBLIC = '공공데이터포털(data.go.kr)';
const PROCESSED_BY = '이집(E-JIP) 수집·가공';
const ZONE_SOURCE: SourceInfo = { name: '학구도안내서비스 통학구역·학교군', dataset: '한국교육시설안전원_초등학교통학구역 / 중학교학교군 / 학교학구도연계정보', provider: '한국교육시설안전원', processedBy: PROCESSED_BY };
const REDEV_SOURCE: SourceInfo = { name: '도시정비사업 현황', dataset: '국토교통부_전국 도시정비사업 통합 데이터(CSV) · 부산광역시 정비사업 현황', provider: PROVIDER_PUBLIC, processedBy: PROCESSED_BY };
const PRESALE_SOURCE: SourceInfo = { name: '청약홈 분양정보', dataset: '한국부동산원_청약홈 분양정보 조회 서비스(APT 분양공고)', provider: PROVIDER_PUBLIC, processedBy: PROCESSED_BY };

// ================================================================== building context
export interface ComplexAttributes {
  parkingCount: number | null;
  /** 세대당 주차대수 = parkingCount ÷ 세대수. 두 값이 모두 확인될 때만 */
  parkingPerHousehold: number | null;
  floorAreaRatio: number | null;
  buildingCoverageRatio: number | null;
  mainBuildingCount: number | null;
  useApprovalDate: string | null;
}
export type OmittedReason = 'MISSING_OR_ZERO' | 'SOURCE_UNKNOWN' | 'IMPLAUSIBLE' | 'NOT_APPLICABLE';

export interface BuildingContextData {
  building: BuildingDto;
  complex: { status: SectionStatus; basis: BasicSpecSource | null; attributes: ComplexAttributes; omitted: { field: keyof ComplexAttributes; reason: OmittedReason }[]; failureCode?: string };
  education: {
    status: SectionStatus;
    attendanceZone: null | {
      elementary: { status: string; zoneType: string; zoneName: string | null; schools: { schoolName: string; identityConfidence: string }[]; sourceDate: string; sourceName: string };
      middle: { status: string; groupName: string | null; schools: { schoolName: string; identityConfidence: string }[]; sourceDate: string };
      datasetVersion: string;
      attributionNotice: string;
    };
    /** 거리는 제공하지 않는다(WITHHELD). 측정 방식을 만들어 붙이지 않는다. */
    schoolDistance: { status: 'WITHHELD'; measurement: null };
    reason?: string;
  };
  withheld: readonly Withheld[];
  sources: { building: SourceInfo; attendanceZone: SourceInfo | null };
  contentGuidance: { allowedStatements: string[]; cautions: string[] };
}

const positive = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;

export function buildComplexAttributes(master: MasterRow, row: ComplexAttributesRow | null): BuildingContextData['complex'] {
  const empty: ComplexAttributes = { parkingCount: null, parkingPerHousehold: null, floorAreaRatio: null, buildingCoverageRatio: null, mainBuildingCount: null, useApprovalDate: null };
  const fields = Object.keys(empty) as (keyof ComplexAttributes)[];
  if (master.propertyType !== 'apartment') return { status: 'NOT_COVERED', basis: null, attributes: empty, omitted: fields.map((field) => ({ field, reason: 'NOT_APPLICABLE' as const })) };
  if (!row) return { status: 'NO_DATA', basis: null, attributes: empty, omitted: fields.map((field) => ({ field, reason: 'MISSING_OR_ZERO' as const })) };
  if (row.basicSpecSource === 'UNKNOWN') return { status: 'NO_DATA', basis: 'UNKNOWN', attributes: empty, omitted: fields.map((field) => ({ field, reason: 'SOURCE_UNKNOWN' as const })) };
  const attributes: ComplexAttributes = { ...empty };
  const omitted: { field: keyof ComplexAttributes; reason: OmittedReason }[] = [];
  const take = <K extends keyof ComplexAttributes>(field: K, value: ComplexAttributes[K] | null, ok: boolean) => {
    if (ok && value !== null) attributes[field] = value;
    else omitted.push({ field, reason: 'MISSING_OR_ZERO' });
  };
  take('parkingCount', row.parkingCount, positive(row.parkingCount));
  take('floorAreaRatio', row.floorAreaRatio, positive(row.floorAreaRatio));
  take('buildingCoverageRatio', row.buildingCoverageRatio, positive(row.buildingCoverageRatio));
  take('mainBuildingCount', row.mainBuildingCount, positive(row.mainBuildingCount));
  take('useApprovalDate', row.useApprovalDate && /^\d{8}$|^\d{4}-\d{2}-\d{2}$/.test(row.useApprovalDate) ? row.useApprovalDate : null, Boolean(row.useApprovalDate && /^\d{8}$|^\d{4}-\d{2}-\d{2}$/.test(row.useApprovalDate)));
  // 세대당 주차대수: 주차대수와 세대수가 둘 다 확인될 때만 계산하고, 비현실적인 값은 내지 않는다
  if (positive(row.parkingCount) && positive(master.unitCount)) {
    const ratio = Number((row.parkingCount / master.unitCount).toFixed(2));
    if (ratio > 0 && ratio <= 5) attributes.parkingPerHousehold = ratio;
    else omitted.push({ field: 'parkingPerHousehold', reason: 'IMPLAUSIBLE' });
  } else omitted.push({ field: 'parkingPerHousehold', reason: 'MISSING_OR_ZERO' });
  const hasAny = Object.values(attributes).some((v) => v !== null);
  return { status: hasAny ? 'HAS_DATA' : 'NO_DATA', basis: row.basicSpecSource, attributes, omitted };
}

const ZONE_SCHOOL_USABLE = new Set(['HIGH', 'MEDIUM']);

export function buildEducation(master: MasterRow, lookup: EducationZoneLookup): BuildingContextData['education'] {
  const distance = { status: 'WITHHELD' as const, measurement: null };
  if (master.propertyType !== 'apartment') return { status: 'NOT_COVERED', attendanceZone: null, schoolDistance: distance, reason: '오피스텔은 공식 통학구역 자료가 없다.' };
  const z = lookup(String(master.key));
  if (!z) return { status: 'NOT_COVERED', attendanceZone: null, schoolDistance: distance, reason: '공식 통학구역 자료는 부산 아파트만 확보되어 있다.' };
  const usable = (s: { schoolName: string; identityConfidence: string }[], status: string) => (status === 'AVAILABLE' || status === 'SHARED' ? s.filter((x) => ZONE_SCHOOL_USABLE.has(x.identityConfidence)).map((x) => ({ schoolName: x.schoolName, identityConfidence: x.identityConfidence })) : []);
  const attendanceZone = {
    elementary: { status: z.elementary.status, zoneType: z.elementary.zoneType, zoneName: z.elementary.zoneName, schools: usable(z.elementary.schools, z.elementary.status), sourceDate: z.elementary.sourceDate, sourceName: z.elementary.sourceName },
    middle: { status: z.middle.status, groupName: z.middle.groupName, schools: usable(z.middle.schools, z.middle.status), sourceDate: z.middle.sourceDate },
    datasetVersion: z.datasetVersion,
    attributionNotice: z.elementary.notice,
  };
  const has = attendanceZone.elementary.schools.length > 0 || attendanceZone.middle.schools.length > 0;
  return { status: has ? 'HAS_DATA' : 'NO_DATA', attendanceZone, schoolDistance: distance, ...(has ? {} : { reason: '이 단지는 공식 통학구역을 확정할 수 없거나(검토 필요·자료 없음) 학교를 확정하지 못했다.' }) };
}

function buildingGuidance(c: BuildingContextData['complex'], e: BuildingContextData['education']): BuildingContextData['contentGuidance'] {
  const allowed: string[] = [];
  const cautions: string[] = [
    '학교까지의 거리·도보 시간, 지하철·버스·생활시설 정보는 이 응답에 없다. 만들어 쓰지 않는다(withheld).',
    "'우수 학군', '명문', '학군 프리미엄' 같은 평가 표현은 근거가 없다.",
  ];
  if (c.status === 'HAS_DATA') {
    allowed.push('건축물대장에 기재된 준공·세대수·주차대수·용적률·건폐율은 기준일을 밝혀 그대로 쓸 수 있다.');
    if (c.attributes.parkingPerHousehold !== null) allowed.push('세대당 주차대수는 주차대수÷세대수로 계산한 값임을 밝혀 쓴다.');
    cautions.push('값이 없는 속성(omitted)은 0이나 추정으로 쓰지 않는다.');
  }
  if (e.status === 'HAS_DATA') {
    allowed.push("공식 통학구역 자료에 따르면 이 단지는 '○○초등학교 통학구역'으로 안내된다고 쓸 수 있다(자료 기준일 명시).");
    cautions.push('통학구역은 학교 배정을 보장하지 않는다. 중학교는 학교군 단위 정보이며 특정 학교 배정을 뜻하지 않는다. 입학 전 교육청에서 확인하라고 안내한다.');
    if (e.attendanceZone?.elementary.status === 'SHARED') cautions.push('공동 통학구역이므로 한 학교로 단정하지 않는다.');
  }
  return { allowedStatements: allowed, cautions };
}

export async function getBuildingContext(
  masterIdRaw: string,
  allowed: PropertyType[],
  db: SellflowDb,
  ctxDb: SellflowContextDb,
  zoneLookup: EducationZoneLookup,
): Promise<{ data: BuildingContextData; rowCount: number }> {
  const master = await loadMaster(masterIdRaw, allowed, db);
  const building = mapBuilding(master);
  let complex: BuildingContextData['complex'];
  try {
    const row = master.propertyType === 'apartment' ? await ctxDb.getComplexAttributes(String(master.key)) : null;
    complex = buildComplexAttributes(master, row);
  } catch (e) {
    const f = failureOf(e);
    complex = { status: f.status, basis: null, attributes: { parkingCount: null, parkingPerHousehold: null, floorAreaRatio: null, buildingCoverageRatio: null, mainBuildingCount: null, useApprovalDate: null }, omitted: [], failureCode: f.code };
  }
  const education = buildEducation(master, zoneLookup);
  return {
    data: {
      building,
      complex,
      education,
      withheld: WITHHELD,
      sources: { building: BUILDING_SOURCE, attendanceZone: education.status === 'HAS_DATA' || education.status === 'NO_DATA' ? ZONE_SOURCE : null },
      contentGuidance: buildingGuidance(complex, education),
    },
    rowCount: 1,
  };
}

// ================================================================== area context
export type StageGroup = 'PLANNING' | 'APPROVAL' | 'CONSTRUCTION' | 'COMPLETED' | 'STOPPED' | 'UNKNOWN';
export const STAGE_GROUP: Record<CanonicalStage, StageGroup> = {
  PLANNED: 'PLANNING', ZONE_DESIGNATED: 'PLANNING', PROMOTION_COMMITTEE: 'PLANNING',
  ASSOCIATION_APPROVED: 'APPROVAL', ARCHITECTURAL_REVIEW: 'APPROVAL', PUBLIC_OPERATOR_DESIGNATED: 'APPROVAL', PROJECT_IMPLEMENTATION_APPROVED: 'APPROVAL', MANAGEMENT_DISPOSITION_APPROVED: 'APPROVAL',
  RELOCATION_DEMOLITION: 'CONSTRUCTION', CONSTRUCTION: 'CONSTRUCTION',
  COMPLETED: 'COMPLETED', TRANSFER_REGISTERED: 'COMPLETED',
  DISSOLVED: 'STOPPED', CANCELLED: 'STOPPED',
  UNKNOWN: 'UNKNOWN',
};
const stageGroupOf = (stage: string): StageGroup => STAGE_GROUP[stage as CanonicalStage] ?? 'UNKNOWN';

export interface RedevelopmentSection {
  status: SectionStatus;
  failureCode?: string;
  /** 사업 지역은 시군구 단위로만 쓴다. 좌표가 없어 어느 단지 '근처'인지는 말할 수 없다. */
  granularity: 'SIGUNGU';
  coordinates: 'NOT_USED';
  asOf: string | null;
  summary: { total: number; excludedNeedsReview: number; byStageGroup: { group: StageGroup; count: number }[]; byBusinessType: { type: string; label: string; count: number }[] };
  items: { name: string; businessType: string; businessTypeLabel: string; stage: string; stageLabel: string; stageGroup: StageGroup; projectStatus: string; householdCount: number | null; dataUpdatedAt: string; source: string }[];
  caveats: string[];
}

export function buildRedevelopmentSection(rows: RedevelopmentRows): RedevelopmentSection {
  const confirmed = rows.groups.filter((g) => !g.needsReview);
  const total = confirmed.reduce((n, g) => n + g.count, 0);
  const excludedNeedsReview = rows.groups.filter((g) => g.needsReview).reduce((n, g) => n + g.count, 0);
  const byGroup = new Map<StageGroup, number>();
  const byType = new Map<string, number>();
  for (const g of confirmed) {
    byGroup.set(stageGroupOf(g.stage), (byGroup.get(stageGroupOf(g.stage)) ?? 0) + g.count);
    byType.set(g.businessType, (byType.get(g.businessType) ?? 0) + g.count);
  }
  const caveats = [
    '사업 단계는 자료 기준일 시점의 값이며 이후 바뀔 수 있다. 계획·추진 단계의 사업을 확정된 개발로 쓰지 않는다.',
    "좌표가 없어 특정 단지 '근처'의 사업이라고 연결하지 않는다. 시군구 단위의 지역 이슈로만 쓴다.",
    "'호재', '가격 상승 요인'처럼 효과를 단정하지 않는다.",
  ];
  const base = { granularity: 'SIGUNGU' as const, coordinates: 'NOT_USED' as const, caveats };
  if (total === 0) {
    return { ...base, status: 'NO_DATA', asOf: null, summary: { total: 0, excludedNeedsReview, byStageGroup: [], byBusinessType: [] }, items: [] };
  }
  return {
    ...base,
    status: 'HAS_DATA',
    asOf: rows.latestSourceUpdatedAt ?? rows.latestCollectedAt,
    summary: {
      total,
      excludedNeedsReview,
      byStageGroup: [...byGroup.entries()].map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count || a.group.localeCompare(b.group)),
      byBusinessType: [...byType.entries()].map(([type, count]) => ({ type, label: BUSINESS_TYPE_LABELS[type as CanonicalBusinessType] ?? '기타', count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    },
    items: rows.items.slice(0, 10).map((i) => ({
      name: i.name, businessType: i.businessType, businessTypeLabel: BUSINESS_TYPE_LABELS[i.businessType as CanonicalBusinessType] ?? '기타', stage: i.stage, stageLabel: STAGE_LABELS[i.stage as CanonicalStage] ?? '확인 안 됨',
      stageGroup: stageGroupOf(i.stage), projectStatus: i.projectStatus, householdCount: i.householdCount, dataUpdatedAt: i.dataUpdatedAt, source: SOURCE_LABELS[i.primarySource] ?? i.primarySource,
    })),
  };
}

export type PresaleStatusKind = 'upcoming' | 'ongoing' | 'closed' | 'unsold';
/** 이집의 computePresaleStatus와 같은 규칙(날짜로 계산). 시각을 인자로 받아 테스트할 수 있다. */
export function presaleStatusAt(p: { houseType: string; receiptStartDate: string | null; receiptEndDate: string | null }, now: Date): PresaleStatusKind {
  if (p.houseType === 'REMAIN') return 'unsold';
  const start = p.receiptStartDate ? new Date(p.receiptStartDate) : null;
  const end = p.receiptEndDate ? new Date(p.receiptEndDate) : null;
  if (start && now < start) return 'upcoming';
  if (start && end && now >= start && now <= end) return 'ongoing';
  if (end && now > end) return 'closed';
  return 'upcoming';
}

/** 마지막 수집이 이 일수 안이어야 '접수 중·예정'을 현재 상태로 말할 수 있다. 분양 자료는 자동 갱신이 보장되지 않는다. */
export const PRESALE_FRESH_DAYS = 7;

export interface PresaleSection {
  status: SectionStatus;
  failureCode?: string;
  lastCollectedAt: string | null;
  /** 수집이 최근이 아니면 false: 접수 중·접수 예정을 '지금'의 사실로 쓸 수 없다 */
  currentStatusStatable: boolean;
  summary: { total: number; shown: number; byStatus: { status: PresaleStatusKind; count: number }[] };
  items: { houseName: string; houseType: string; status: PresaleStatusKind; totalSupplyHouseholds: number | null; announcementDate: string | null; receiptStartDate: string | null; receiptEndDate: string | null; moveInExpectedYm: string | null; minPriceManwon: number | null; maxPriceManwon: number | null; sourceUrl: string | null }[];
  caveats: string[];
}

export function buildPresaleSection(rows: PresaleRows, now: Date): PresaleSection {
  const fresh = rows.lastCollectedAt !== null && now.getTime() - new Date(rows.lastCollectedAt).getTime() <= PRESALE_FRESH_DAYS * 86_400_000;
  const caveats = [
    '분양 공고는 자동으로 갱신되지 않을 수 있다. 접수 상태는 공고 날짜로 계산한 값이며, 마지막 수집 시각(lastCollectedAt) 이후 변경됐을 수 있다.',
    '분양가(최저·최고)는 모집공고 기준 금액이다. 주변 실거래가와 같은 값이 아니며 우열을 판단하지 않는다.',
    ...(fresh ? [] : ["최근에 수집된 자료가 아니므로 '현재 접수 중', '곧 분양'처럼 지금의 상태로 쓰지 않는다. 과거 공고로만 쓴다."]),
  ];
  const items = rows.rows.map((r) => ({
    houseName: r.houseName, houseType: r.houseType, status: presaleStatusAt(r, now), totalSupplyHouseholds: r.totalSupplyHouseholds, announcementDate: r.announcementDate, receiptStartDate: r.receiptStartDate,
    receiptEndDate: r.receiptEndDate, moveInExpectedYm: r.moveInExpectedYm, minPriceManwon: r.minPrice, maxPriceManwon: r.maxPrice, sourceUrl: r.pblancUrl && r.pblancUrl.startsWith('https://') ? r.pblancUrl : null,
  }));
  const counts = new Map<PresaleStatusKind, number>();
  for (const i of items) counts.set(i.status, (counts.get(i.status) ?? 0) + 1);
  return {
    status: rows.total === 0 ? 'NO_DATA' : 'HAS_DATA',
    lastCollectedAt: rows.lastCollectedAt,
    currentStatusStatable: fresh,
    summary: { total: rows.total, shown: items.length, byStatus: [...counts.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)) },
    items,
    caveats,
  };
}

export const AREA_INCLUDE = ['redevelopment', 'presale'] as const;
export type AreaInclude = (typeof AREA_INCLUDE)[number];

export interface AreaContextData {
  area: { lawdCd: string; fullName: string; sido: string; sigungu: string };
  redevelopment: RedevelopmentSection | { status: 'NOT_REQUESTED' };
  presale: PresaleSection | { status: 'NOT_REQUESTED' };
  withheld: readonly Withheld[];
  sources: { redevelopment: SourceInfo; presale: SourceInfo };
  contentGuidance: { cautions: string[] };
}

const failedRedevelopment = (f: ReturnType<typeof failureOf>): RedevelopmentSection => ({ status: f.status, failureCode: f.code, granularity: 'SIGUNGU', coordinates: 'NOT_USED', asOf: null, summary: { total: 0, excludedNeedsReview: 0, byStageGroup: [], byBusinessType: [] }, items: [], caveats: [] });
const failedPresale = (f: ReturnType<typeof failureOf>): PresaleSection => ({ status: f.status, failureCode: f.code, lastCollectedAt: null, currentStatusStatable: false, summary: { total: 0, shown: 0, byStatus: [] }, items: [], caveats: [] });

export async function getAreaContext(lawdCd: string, include: readonly AreaInclude[], ctxDb: SellflowContextDb, now: Date): Promise<{ data: AreaContextData; rowCount: number }> {
  const node = getRegionByLawdCd(lawdCd);
  if (!node) throw new SellflowApiError(404, 'REGION_NOT_FOUND', '이집이 다루는 지역 코드가 아닙니다.');
  if (!node.isMolitLeaf) throw new SellflowApiError(400, 'INVALID_PARAMETER', '구가 있는 시는 구 단위 코드로 조회해야 합니다.');
  const sido = getSido(node.sidoCode);
  if (!sido) throw new SellflowApiError(404, 'REGION_NOT_FOUND', '이집이 다루는 지역 코드가 아닙니다.');
  const sidoFull = node.fullName.split(' ')[0];

  const [redevelopment, presale] = await Promise.all([
    include.includes('redevelopment')
      ? ctxDb.listRedevelopment({ sido: sidoFull, sigungu: node.name, take: 10 }).then(buildRedevelopmentSection, (e) => failedRedevelopment(failureOf(e)))
      : Promise.resolve({ status: 'NOT_REQUESTED' as const }),
    include.includes('presale')
      ? ctxDb.listPresales({ sidoShort: sido.shortName, addressPrefix: node.fullName, take: 10 }).then((r) => buildPresaleSection(r, now), (e) => failedPresale(failureOf(e)))
      : Promise.resolve({ status: 'NOT_REQUESTED' as const }),
  ]);
  const rowCount = (redevelopment.status === 'HAS_DATA' ? (redevelopment as RedevelopmentSection).items.length : 0) + (presale.status === 'HAS_DATA' ? (presale as PresaleSection).items.length : 0);
  return {
    data: {
      area: { lawdCd, fullName: node.fullName, sido: sidoFull, sigungu: node.name },
      redevelopment,
      presale,
      withheld: WITHHELD.filter((w) => w.category === 'TRANSIT' || w.category === 'LIVING_FACILITIES'),
      sources: { redevelopment: REDEV_SOURCE, presale: PRESALE_SOURCE },
      contentGuidance: { cautions: ['지역 개발·공급 정보는 지역 단위 배경 설명으로만 쓴다. 특정 단지의 가치·가격에 미치는 영향을 단정하지 않는다.', '자료가 없는 영역(NO_DATA)은 언급하지 않는다. 권한 없음·조회 실패는 자료 없음이 아니다.'] },
    },
    rowCount,
  };
}
