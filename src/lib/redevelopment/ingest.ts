import { mapBusanBusinessType, mapMolitBusinessType } from './businessType';
import { findBestCandidate } from './matching';
import { mergeCanonicalFields } from './merge';
import { classifyLocationText } from './officeDetector';
import { mapBusanStage, mapMolitStage, deriveProjectStatus } from './stage';
import { SOURCE_BUSAN, SOURCE_MOLIT } from './types';
import type { LocationConfidence, LocationType, MatchConfidence, ParsedSourceRecord } from './types';

// Prisma Client 타입에 직접 의존하지 않는다(스크립트/테스트 양쪽에서 재사용하기 위해
// 필요한 메서드만 구조적 타입으로 선언 — @prisma/client 생성 전에도 타입체크 가능).
export interface RedevelopmentPrismaClient {
  redevelopmentProject: {
    findMany: (args: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  redevelopmentSourceRecord: {
    findUnique: (args: any) => Promise<any | null>;
    upsert: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
  };
}

export interface IngestOutcome {
  sourceRecordId: string;
  source: string;
  rawName: string;
  matchConfidence: MatchConfidence;
  mergeStatus: 'AUTO_MATCHED' | 'REVIEW_REQUIRED' | 'UNMATCHED';
  action: 'matched_existing' | 'created_project' | 'resynced';
  projectId: number;
  needsReview: boolean;
}

// EXACT/HIGH만 자동 병합한다(R3A 정책 그대로) — MEDIUM은 review queue로 넘기되, 그래도
// SourceRecord는 어딘가 Project에 연결돼야 하므로 새 Project를 만들고 needsReview=true로
// 표시한다. LOW/UNMATCHED는 별도 사업으로 유지(버리지 않는다, R3B "unmatched 처리").
function classifyMergeStatus(confidence: MatchConfidence): IngestOutcome['mergeStatus'] {
  if (confidence === 'EXACT' || confidence === 'HIGH') return 'AUTO_MATCHED';
  if (confidence === 'MEDIUM') return 'REVIEW_REQUIRED';
  return 'UNMATCHED';
}

// DB에 저장된 SourceRecord 원본 필드로부터 canonical businessType/stage를 다시 계산한다.
// SourceRecord 테이블 자체에는 canonical 값을 저장하지 않는다(R3B 설계 — canonical은
// Project에만 있고, SourceRecord는 raw만 보존) — 그래서 recompute 시점마다 raw→canonical
// 매핑 함수를 소스별로 다시 태운다.
export function reconstructParsedFromDb(row: {
  source: string;
  sourceRecordId: string;
  rawName: string;
  sido?: string;
  sigungu?: string;
  rawBusinessType: string | null;
  rawBusinessTypeCode: string | null;
  rawStage: string | null;
  rawStageCode: string | null;
  rawHouseholdCount: string | null;
  rawLocation: string | null;
  rawPayload: unknown;
  normalizedName?: string;
}): Pick<
  ParsedSourceRecord,
  | 'source'
  | 'sourceRecordId'
  | 'rawName'
  | 'rawBusinessType'
  | 'rawBusinessTypeCode'
  | 'businessType'
  | 'rawStage'
  | 'rawStageCode'
  | 'stage'
  | 'rawHouseholdCount'
  | 'rawLocation'
  | 'rawPayload'
> {
  const isMolit = row.source === SOURCE_MOLIT;
  return {
    source: isMolit ? SOURCE_MOLIT : SOURCE_BUSAN,
    sourceRecordId: row.sourceRecordId,
    rawName: row.rawName,
    rawBusinessType: row.rawBusinessType,
    rawBusinessTypeCode: row.rawBusinessTypeCode,
    businessType: row.rawBusinessType
      ? isMolit
        ? mapMolitBusinessType(row.rawBusinessType)
        : mapBusanBusinessType(row.rawName)
      : isMolit
        ? 'UNKNOWN'
        : mapBusanBusinessType(row.rawName),
    rawStage: row.rawStage,
    rawStageCode: row.rawStageCode,
    stage: row.rawStage ? (isMolit ? mapMolitStage(row.rawStage) : mapBusanStage(row.rawStage)) : 'UNKNOWN',
    rawHouseholdCount: row.rawHouseholdCount,
    rawLocation: row.rawLocation,
    rawPayload: row.rawPayload,
  };
}

// 파싱된 SourceRecord 1건을 (1) 기존 Project와 매칭하거나 새 Project를 만들고,
// (2) SourceRecord를 upsert하고, (3) 그 Project에 연결된 모든 SourceRecord 기준으로
// canonical 필드를 재계산해 Project를 갱신한다. R3B ingestion plan의 4~6단계를
// 레코드 1건 단위로 수행하는 함수 — import_molit/import_busan이 이 함수를 반복 호출한다.
export async function ingestRecord(
  prisma: RedevelopmentPrismaClient,
  record: ParsedSourceRecord,
  now: Date
): Promise<IngestOutcome> {
  // STEP R5 — 재동기화(re-sync) 보정: 이 SourceRecord가 이미 존재하면(과거에 한 번
  // ingest돼 어떤 Project에 연결돼 있으면) 후보 매칭을 다시 계산하지 않는다. 재계산하면
  // 이미 자신이 만든 canonical project를 후보로 다시 조회하게 되어, 그 project의 값이
  // 애초에 이 레코드 자신에게서 나온 것이므로 트리비얼하게 EXACT가 나오고 원래
  // matchConfidence(최초 ingest 시점의 실제 cross-source 매칭 품질)를 덮어써버린다
  // (R4 FINAL에서 production 2회 재실행으로 실제 발견 — 감사 이력 손실 문제, 이번
  // STEP에서 수정). raw 필드(stage 진행 등 실제 갱신 가능한 값)는 계속 최신화한다.
  const existing = await prisma.redevelopmentSourceRecord.findUnique({
    where: { source_sourceRecordId: { source: record.source, sourceRecordId: record.sourceRecordId } },
  });

  if (existing) {
    await prisma.redevelopmentSourceRecord.update({
      where: { source_sourceRecordId: { source: record.source, sourceRecordId: record.sourceRecordId } },
      data: {
        rawName: record.rawName,
        rawBusinessType: record.rawBusinessType,
        rawBusinessTypeCode: record.rawBusinessTypeCode,
        rawStage: record.rawStage,
        rawStageCode: record.rawStageCode,
        rawHouseholdCount: record.rawHouseholdCount,
        rawLocation: record.rawLocation,
        rawPayload: record.rawPayload,
        collectedAt: now,
        // matchConfidence/mergeStatus/projectId는 의도적으로 갱신하지 않는다 — 최초
        // ingest 시점의 매칭 품질 이력을 보존한다.
      },
    });

    await recomputeProjectCanonicalFields(prisma, existing.projectId, now);

    return {
      sourceRecordId: record.sourceRecordId,
      source: record.source,
      rawName: record.rawName,
      matchConfidence: (existing.matchConfidence as MatchConfidence | null) ?? 'UNMATCHED',
      mergeStatus: existing.mergeStatus,
      action: 'resynced',
      projectId: existing.projectId,
      needsReview: existing.mergeStatus === 'REVIEW_REQUIRED',
    };
  }

  const candidateProjects = await prisma.redevelopmentProject.findMany({
    where: { sido: record.sido, sigungu: record.sigungu },
  });

  const best = findBestCandidate(
    {
      sido: record.sido,
      sigungu: record.sigungu,
      normalizedName: record.normalizedName,
      businessType: record.businessType,
      householdCount: record.householdCount,
    },
    candidateProjects.map((p: any) => ({
      sido: p.sido,
      sigungu: p.sigungu,
      normalizedName: p.normalizedName,
      businessType: p.businessType,
      householdCount: p.householdCount,
      _project: p,
    }))
  );

  const confidence: MatchConfidence = best?.confidence ?? 'UNMATCHED';
  const mergeStatus = classifyMergeStatus(confidence);

  let projectId: number;
  let action: IngestOutcome['action'];

  if (mergeStatus === 'AUTO_MATCHED' && best) {
    projectId = (best.candidate as any)._project.id;
    action = 'matched_existing';
  } else {
    const created = await prisma.redevelopmentProject.create({
      data: {
        canonicalName: record.rawName,
        normalizedName: record.normalizedName,
        sido: record.sido,
        sigungu: record.sigungu,
        businessType: record.businessType,
        stage: record.stage,
        projectStatus: deriveProjectStatus(record.stage),
        householdCount: record.householdCount,
        primarySource: record.source,
        collectedAt: now,
        needsReview: mergeStatus === 'REVIEW_REQUIRED',
      },
    });
    projectId = created.id;
    action = 'created_project';
  }

  // 이 지점은 findUnique로 이미 "존재하지 않음"을 확인한 뒤에만 도달한다(위 재동기화
  // 분기 참고) — 그래서 create만 하면 되고 upsert의 update 분기는 필요 없다.
  await prisma.redevelopmentSourceRecord.upsert({
    where: { source_sourceRecordId: { source: record.source, sourceRecordId: record.sourceRecordId } },
    create: {
      projectId,
      source: record.source,
      sourceRecordId: record.sourceRecordId,
      rawName: record.rawName,
      rawBusinessType: record.rawBusinessType,
      rawBusinessTypeCode: record.rawBusinessTypeCode,
      rawStage: record.rawStage,
      rawStageCode: record.rawStageCode,
      rawHouseholdCount: record.rawHouseholdCount,
      rawLocation: record.rawLocation,
      rawPayload: record.rawPayload,
      matchConfidence: confidence === 'UNMATCHED' ? null : confidence,
      mergeStatus,
      collectedAt: now,
    },
    update: {},
  });

  await recomputeProjectCanonicalFields(prisma, projectId, now);

  return {
    sourceRecordId: record.sourceRecordId,
    source: record.source,
    rawName: record.rawName,
    matchConfidence: confidence,
    mergeStatus,
    action,
    projectId,
    needsReview: mergeStatus === 'REVIEW_REQUIRED',
  };
}

export async function recomputeProjectCanonicalFields(
  prisma: RedevelopmentPrismaClient,
  projectId: number,
  now: Date
): Promise<void> {
  const linked = await prisma.redevelopmentSourceRecord.findMany({ where: { projectId } });
  if (linked.length === 0) return;

  const reconstructed: ParsedSourceRecord[] = linked.map((row: any) => ({
    ...reconstructParsedFromDb(row),
    sido: '', // mergeCanonicalFields는 sido/sigungu/normalizedName을 쓰지 않는다(Project에 이미 있음)
    sigungu: '',
    householdCount: row.rawHouseholdCount ? parseHouseholdCountLocal(row.rawHouseholdCount) : null,
    normalizedName: '',
  }));

  const canonical = mergeCanonicalFields(reconstructed);
  const location = pickBestLocationClassification(linked.map((row: any) => row.rawLocation));

  await prisma.redevelopmentProject.update({
    where: { id: projectId },
    data: {
      canonicalName: canonical.canonicalName,
      businessType: canonical.businessType,
      stage: canonical.stage,
      projectStatus: deriveProjectStatus(canonical.stage),
      householdCount: canonical.householdCount,
      primarySource: canonical.primarySource,
      needsReview: canonical.needsReview,
      locationType: location.locationType,
      locationConfidence: location.locationConfidence,
      // 좌표는 이번 STEP에서도 채우지 않는다(섹션 24 — classifyLocationText 배선은
      // 텍스트 분류만, 전체 지오코딩/좌표 확보는 R5/R6으로 이관). geocodeStatus는
      // 실제 지오코딩을 시도하지 않았으므로 항상 NOT_ATTEMPTED로 정직하게 둔다.
      geocodeStatus: 'NOT_ATTEMPTED',
      collectedAt: now,
    },
  });
}

function parseHouseholdCountLocal(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '해당없음') return null;
  const n = parseInt(trimmed.replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// 한 Project에 연결된 SourceRecord들의 rawLocation 중 "가장 유용하고 안전한" 분류를
// 고른다. PROJECT_SITE(번지/일원 등 명확한 현장 표현)를 최우선으로 보여주되, OFFICE
// 의심 신호가 있으면(R3A: 82% 위험) 절대 PROJECT_SITE보다 낮은 우선순위로 묻히지
// 않게 UNKNOWN보다는 위에 둔다 — "모른다"보다는 "사무실일 수 있다"는 경고가 더
// 안전하다. 좌표는 채우지 않으므로 이 값은 순전히 UI 안내용 신호다.
const LOCATION_TYPE_PRIORITY: Record<LocationType, number> = {
  PROJECT_SITE: 3,
  APPROXIMATE: 2,
  OFFICE: 1,
  UNKNOWN: 0,
};

function pickBestLocationClassification(rawLocations: (string | null)[]): {
  locationType: LocationType;
  locationConfidence: LocationConfidence;
} {
  let best: { locationType: LocationType; locationConfidence: LocationConfidence } = {
    locationType: 'UNKNOWN',
    locationConfidence: 'UNKNOWN',
  };

  for (const raw of rawLocations) {
    if (!raw) continue;
    const classified = classifyLocationText(raw);
    if (LOCATION_TYPE_PRIORITY[classified.locationType] > LOCATION_TYPE_PRIORITY[best.locationType]) {
      best = { locationType: classified.locationType, locationConfidence: classified.locationConfidence };
    }
  }

  return best;
}
