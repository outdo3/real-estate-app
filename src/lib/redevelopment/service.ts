import { SIDO_LIST } from '@/lib/regions';
import { BUSINESS_TYPE_VALUES, STAGE_VALUES } from './labels';
import { SOURCE_BUSAN, SOURCE_MOLIT } from './types';
import type { CanonicalBusinessType, CanonicalStage } from './types';
import type { PrismaClient } from '@prisma/client';

// R5 — Redevelopment API/Service Layer. API route는 이 파일의 함수만 호출하고
// Prisma 쿼리를 직접 쓰지 않는다(섹션 3). schema/migration은 건드리지 않는다 — R4/R4.1이
// 만든 canonical 필드만 그대로 읽는다.
//
// 라벨 상수(BUSINESS_TYPE_VALUES/STAGE_VALUES 등)는 R6에서 labels.ts로 옮겼다 —
// 클라이언트 컴포넌트가 Prisma 타입을 끌어오지 않고도 같은 라벨을 재사용할 수 있게.
export { BUSINESS_TYPE_VALUES, STAGE_VALUES } from './labels';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface RedevelopmentListItem {
  id: number;
  name: string;
  sido: string;
  sigungu: string;
  businessType: CanonicalBusinessType;
  stage: CanonicalStage;
  status: string;
  householdCount: number | null;
  latitude: number | null;
  longitude: number | null;
  locationType: string | null;
  locationConfidence: string | null;
  hasSafeMapLocation: boolean;
  primarySource: string;
  dataUpdatedAt: string;
  needsReview: boolean;
}

export interface ListRedevelopmentParams {
  sido?: string;
  sigungu?: string;
  businessType?: string;
  stage?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface ListRedevelopmentResult {
  items: RedevelopmentListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export class InvalidRedevelopmentQueryError extends Error {}

// "부산"처럼 축약된 시도명을 canonical(SIDO_LIST 기준) 값으로 바꾼다. 사용자가 정확한
// DB 문자열("부산광역시")을 몰라도 되게 한다(섹션 12). 매칭되는 canonical이 없으면
// 원본 문자열을 그대로 쓴다(있으면 검색은 그냥 0건이 된다 — 억지로 추정하지 않음).
export function normalizeSidoInput(input: string): string {
  const trimmed = input.trim();
  if (SIDO_LIST.includes(trimmed)) return trimmed;
  const match = SIDO_LIST.find((s) => s.startsWith(trimmed));
  return match ?? trimmed;
}

// hasSafeMapLocation 계산 — 지도에 마커로 표시해도 안전한지 여부(섹션 7). 좌표가
// 있어도 locationType이 PROJECT_SITE가 아니면(OFFICE/APPROXIMATE/UNKNOWN/null)
// false다 — office 좌표를 사업 위치처럼 지도에 찍는 사고를 API 레벨에서 막는다.
export function hasSafeMapLocation(lat: number | null, lng: number | null, locationType: string | null): boolean {
  return lat != null && lng != null && locationType === 'PROJECT_SITE';
}

function toListItem(p: any): RedevelopmentListItem {
  return {
    id: p.id,
    name: p.canonicalName,
    sido: p.sido,
    sigungu: p.sigungu,
    businessType: p.businessType,
    stage: p.stage,
    status: p.projectStatus,
    householdCount: p.householdCount,
    latitude: p.lat,
    longitude: p.lng,
    locationType: p.locationType,
    locationConfidence: p.locationConfidence,
    hasSafeMapLocation: hasSafeMapLocation(p.lat, p.lng, p.locationType),
    primarySource: p.primarySource,
    dataUpdatedAt: p.updatedAt.toISOString(),
    needsReview: p.needsReview,
  };
}

export async function listRedevelopmentProjects(
  prisma: PrismaClient,
  params: ListRedevelopmentParams
): Promise<ListRedevelopmentResult> {
  const page = params.page && params.page > 0 ? Math.floor(params.page) : 1;
  const pageSize = params.pageSize && params.pageSize > 0 ? Math.min(Math.floor(params.pageSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

  if (params.businessType && !BUSINESS_TYPE_VALUES.includes(params.businessType as CanonicalBusinessType)) {
    throw new InvalidRedevelopmentQueryError(`businessType은 ${BUSINESS_TYPE_VALUES.join('/')} 중 하나여야 합니다.`);
  }
  if (params.stage && !STAGE_VALUES.includes(params.stage as CanonicalStage)) {
    throw new InvalidRedevelopmentQueryError(`stage는 ${STAGE_VALUES.join('/')} 중 하나여야 합니다.`);
  }

  const where: any = {};
  if (params.sido) where.sido = normalizeSidoInput(params.sido);
  if (params.sigungu) where.sigungu = params.sigungu;
  if (params.businessType) where.businessType = params.businessType;
  if (params.stage) where.stage = params.stage;
  if (params.q) where.canonicalName = { contains: params.q };

  const [total, projects] = await Promise.all([
    prisma.redevelopmentProject.count({ where }),
    prisma.redevelopmentProject.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { canonicalName: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: projects.map(toListItem),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface RedevelopmentSourceSummary {
  source: string;
  rawName: string;
  rawBusinessType: string | null;
  rawStage: string | null;
  rawHouseholdCount: string | null;
  sourceUpdatedAt: string | null;
  collectedAt: string;
  matchConfidence: string | null;
  mergeStatus: string;
}

export interface RedevelopmentDetail extends RedevelopmentListItem {
  canonicalName: string;
  normalizedName: string;
  sources: RedevelopmentSourceSummary[];
  dataQuality: 'OK' | 'REVIEW_REQUIRED';
  fieldProvenance: {
    businessType: string;
    stage: string;
    householdCount: string;
  };
}

// R2/R3B source priority를 그대로 서술한다(섹션 10 — 새 provenance 테이블 만들지
// 않고 SourceRecord + primarySource만으로 충분한지 검토한 결과: 충분하다. 규칙 자체는
// merge.ts와 동일한 정책을 텍스트로만 반영 — 로직을 복제하지 않고 "어느 source가
// 존재하는가"만으로 결정할 수 있다).
function describeFieldProvenance(sources: RedevelopmentSourceSummary[]): RedevelopmentDetail['fieldProvenance'] {
  const hasMolit = sources.some((s) => s.source === SOURCE_MOLIT);
  const hasBusan = sources.some((s) => s.source === SOURCE_BUSAN);

  const businessType = hasMolit ? '국토부 기준(소규모주택정비 유형은 부산시 기준)' : '부산시 기준';
  const stage = hasBusan ? '부산시 기준' : hasMolit ? '국토부 기준' : '확인 필요';
  const householdCount = hasBusan ? '부산시 기준' : hasMolit ? '국토부 기준' : '확인 필요';

  return { businessType, stage, householdCount };
}

export async function getRedevelopmentProjectById(prisma: PrismaClient, id: number): Promise<RedevelopmentDetail | null> {
  const project = await prisma.redevelopmentProject.findUnique({
    where: { id },
    include: { sourceRecords: true },
  });
  if (!project) return null;

  // rawPayload는 내부 운영용이라 상세 응답에도 포함하지 않는다(섹션 9).
  const sources: RedevelopmentSourceSummary[] = project.sourceRecords.map((r) => ({
    source: r.source,
    rawName: r.rawName,
    rawBusinessType: r.rawBusinessType,
    rawStage: r.rawStage,
    rawHouseholdCount: r.rawHouseholdCount,
    sourceUpdatedAt: r.sourceUpdatedAt ? r.sourceUpdatedAt.toISOString() : null,
    collectedAt: r.collectedAt.toISOString(),
    matchConfidence: r.matchConfidence,
    mergeStatus: r.mergeStatus,
  }));

  return {
    ...toListItem(project),
    canonicalName: project.canonicalName,
    normalizedName: project.normalizedName,
    sources,
    dataQuality: project.needsReview ? 'REVIEW_REQUIRED' : 'OK',
    fieldProvenance: describeFieldProvenance(sources),
  };
}

// 지도 전용 — 안전 좌표(hasSafeMapLocation)가 있는 project만 반환한다(섹션 7). 현재
// production에는 lat/lng가 채워진 project가 0건이라(전체 지오코딩 미실행, R4.1/R4
// FINAL 참고) 빈 배열을 반환하는 게 정상이다 — 좌표를 지어내지 않는다.
export async function getRedevelopmentMapProjects(
  prisma: PrismaClient,
  params: { sido?: string; sigungu?: string } = {}
): Promise<RedevelopmentListItem[]> {
  const where: any = { lat: { not: null }, lng: { not: null }, locationType: 'PROJECT_SITE' };
  if (params.sido) where.sido = normalizeSidoInput(params.sido);
  if (params.sigungu) where.sigungu = params.sigungu;

  const projects = await prisma.redevelopmentProject.findMany({ where, take: 500 });
  return projects.map(toListItem);
}
