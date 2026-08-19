import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSidoInput,
  hasSafeMapLocation,
  listRedevelopmentProjects,
  getRedevelopmentProjectById,
  InvalidRedevelopmentQueryError,
} from './service';

test('normalizeSidoInput — 축약 시도명을 canonical로 변환', () => {
  assert.equal(normalizeSidoInput('부산'), '부산광역시');
  assert.equal(normalizeSidoInput('서울'), '서울특별시');
  assert.equal(normalizeSidoInput('경기'), '경기도');
});

test('normalizeSidoInput — 이미 canonical이면 그대로', () => {
  assert.equal(normalizeSidoInput('부산광역시'), '부산광역시');
});

test('normalizeSidoInput — 매칭 안 되면 원본 그대로(추측하지 않음)', () => {
  assert.equal(normalizeSidoInput('없는지역'), '없는지역');
});

test('hasSafeMapLocation — PROJECT_SITE + 좌표 있어야만 true', () => {
  assert.equal(hasSafeMapLocation(35.1, 129.0, 'PROJECT_SITE'), true);
  assert.equal(hasSafeMapLocation(35.1, 129.0, 'OFFICE'), false);
  assert.equal(hasSafeMapLocation(null, null, 'PROJECT_SITE'), false);
  assert.equal(hasSafeMapLocation(35.1, 129.0, null), false);
  assert.equal(hasSafeMapLocation(35.1, 129.0, 'UNKNOWN'), false);
});

function fakeProject(overrides: Partial<any> = {}) {
  return {
    id: 1,
    canonicalName: '서대신4',
    normalizedName: '서대신4',
    sido: '부산광역시',
    sigungu: '서구',
    businessType: 'REDEVELOPMENT',
    stage: 'CONSTRUCTION',
    projectStatus: 'ACTIVE',
    householdCount: 542,
    lat: null,
    lng: null,
    locationType: 'OFFICE',
    locationConfidence: 'LOW',
    primarySource: 'MOLIT',
    needsReview: false,
    updatedAt: new Date('2026-08-19T12:00:00Z'),
    sourceRecords: [],
    ...overrides,
  };
}

function fakePrisma(projects: any[]) {
  return {
    redevelopmentProject: {
      count: async (args: any) => applyWhere(projects, args.where).length,
      findMany: async (args: any) => {
        const filtered = applyWhere(projects, args.where);
        const skip = args.skip ?? 0;
        const take = args.take ?? filtered.length;
        return filtered.slice(skip, skip + take);
      },
      findUnique: async (args: any) => projects.find((p) => p.id === args.where.id) ?? null,
    },
  } as any;
}

function applyWhere(projects: any[], where: any = {}) {
  return projects.filter((p) => {
    if (where.sido && p.sido !== where.sido) return false;
    if (where.sigungu && p.sigungu !== where.sigungu) return false;
    if (where.businessType && p.businessType !== where.businessType) return false;
    if (where.stage && p.stage !== where.stage) return false;
    if (where.canonicalName?.contains && !p.canonicalName.includes(where.canonicalName.contains)) return false;
    return true;
  });
}

test('listRedevelopmentProjects — 기본 pageSize=20, page=1', async () => {
  const prisma = fakePrisma([fakeProject()]);
  const result = await listRedevelopmentProjects(prisma, {});
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 20);
  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
});

test('listRedevelopmentProjects — pageSize는 100을 넘지 못한다', async () => {
  const prisma = fakePrisma([fakeProject()]);
  const result = await listRedevelopmentProjects(prisma, { pageSize: 999999 });
  assert.equal(result.pageSize, 100);
});

test('listRedevelopmentProjects — page/pageSize가 NaN이면 기본값으로 떨어진다(500 대신 안전 처리)', async () => {
  const prisma = fakePrisma([fakeProject()]);
  const result = await listRedevelopmentProjects(prisma, { page: NaN, pageSize: NaN });
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 20);
});

test('listRedevelopmentProjects — 잘못된 businessType은 InvalidRedevelopmentQueryError', async () => {
  const prisma = fakePrisma([fakeProject()]);
  await assert.rejects(() => listRedevelopmentProjects(prisma, { businessType: 'NOPE' }), InvalidRedevelopmentQueryError);
});

test('listRedevelopmentProjects — 잘못된 stage는 InvalidRedevelopmentQueryError', async () => {
  const prisma = fakePrisma([fakeProject()]);
  await assert.rejects(() => listRedevelopmentProjects(prisma, { stage: 'NOPE' }), InvalidRedevelopmentQueryError);
});

test('listRedevelopmentProjects — sido 축약형("부산")도 필터에 반영된다', async () => {
  const prisma = fakePrisma([fakeProject(), fakeProject({ id: 2, sido: '서울특별시' })]);
  const result = await listRedevelopmentProjects(prisma, { sido: '부산' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].sido, '부산광역시');
});

test('listRedevelopmentProjects — q 검색은 canonicalName 부분일치', async () => {
  const prisma = fakePrisma([fakeProject(), fakeProject({ id: 2, canonicalName: '아미1' })]);
  const result = await listRedevelopmentProjects(prisma, { q: '아미' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].name, '아미1');
});

test('listRedevelopmentProjects — hasSafeMapLocation은 항상 false로 정직하게 반환(좌표 없음)', async () => {
  const prisma = fakePrisma([fakeProject()]);
  const result = await listRedevelopmentProjects(prisma, {});
  assert.equal(result.items[0].hasSafeMapLocation, false);
  assert.equal(result.items[0].latitude, null);
});

test('getRedevelopmentProjectById — 존재하지 않으면 null(404는 route.ts 책임)', async () => {
  const prisma = fakePrisma([]);
  const result = await getRedevelopmentProjectById(prisma, 999);
  assert.equal(result, null);
});

test('getRedevelopmentProjectById — rawPayload는 응답에 포함하지 않는다', async () => {
  const prisma = fakePrisma([
    fakeProject({
      sourceRecords: [
        {
          source: 'MOLIT',
          rawName: '서대신4',
          rawBusinessType: '1)재개발(주택정비)',
          rawStage: '7)착공',
          rawHouseholdCount: '542',
          sourceUpdatedAt: null,
          collectedAt: new Date(),
          matchConfidence: 'EXACT',
          mergeStatus: 'AUTO_MATCHED',
          rawPayload: { secret: 'internal-only' },
        },
      ],
    }),
  ]);
  const result = await getRedevelopmentProjectById(prisma, 1);
  assert.ok(result);
  const json = JSON.stringify(result);
  assert.ok(!json.includes('internal-only'));
});

test('getRedevelopmentProjectById — needsReview=true면 dataQuality=REVIEW_REQUIRED', async () => {
  const prisma = fakePrisma([fakeProject({ needsReview: true })]);
  const result = await getRedevelopmentProjectById(prisma, 1);
  assert.equal(result?.dataQuality, 'REVIEW_REQUIRED');
});

test('getRedevelopmentProjectById — fieldProvenance: BUSAN 소스가 있으면 stage/세대수는 부산시 기준', async () => {
  const prisma = fakePrisma([
    fakeProject({
      sourceRecords: [
        { source: 'MOLIT', rawName: '서대신4', rawBusinessType: null, rawStage: null, rawHouseholdCount: null, sourceUpdatedAt: null, collectedAt: new Date(), matchConfidence: null, mergeStatus: 'AUTO_MATCHED', rawPayload: {} },
        { source: 'BUSAN_CITY', rawName: '서대신4', rawBusinessType: null, rawStage: null, rawHouseholdCount: null, sourceUpdatedAt: null, collectedAt: new Date(), matchConfidence: 'EXACT', mergeStatus: 'AUTO_MATCHED', rawPayload: {} },
      ],
    }),
  ]);
  const result = await getRedevelopmentProjectById(prisma, 1);
  assert.match(result?.fieldProvenance.stage ?? '', /부산시/);
});

test('getRedevelopmentProjectById — MOLIT-only면 stage는 국토부 기준(아미1/아미3 패턴)', async () => {
  const prisma = fakePrisma([
    fakeProject({
      sourceRecords: [
        { source: 'MOLIT', rawName: '아미1', rawBusinessType: null, rawStage: null, rawHouseholdCount: null, sourceUpdatedAt: null, collectedAt: new Date(), matchConfidence: null, mergeStatus: 'UNMATCHED', rawPayload: {} },
      ],
    }),
  ]);
  const result = await getRedevelopmentProjectById(prisma, 1);
  assert.match(result?.fieldProvenance.stage ?? '', /국토부/);
});
