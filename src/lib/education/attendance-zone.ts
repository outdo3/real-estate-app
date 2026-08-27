// SCHOOL V2-C6-B §9 — SCHOOL V2-D가 바로 사용할 수 있는 read-only 헬퍼.
// data/education/attendance-zone/의 precomputed local artifact만 읽는다(DB 접근
// 없음, production write 없음). scripts/education/c6b-04-final-pipeline.ts가 생성한
// 산출물과 1:1 대응되는 타입만 정의한다.
//
// SCHOOL V2-D1 §21: 5.76MB artifact를 절대 client bundle에 포함시키지 않는다.
// npm `server-only` 패키지는 Next.js 번들러의 조건부 exports에 의존해 plain
// `node:test`(tsx --test, 이 프로젝트의 실제 test 실행 방식)에서는 무조건 throw하며
// 기존 테스트를 깨뜨린다 — 그래서 패키지 대신 동일 효과의 최소 runtime guard만 둔다.
import { readFileSync } from 'fs';
import path from 'path';
import { findZoneRelatedApartments, type ZoneRelatedApartment, type SchoolIdentityForLookup } from './school-apartment-relations';

if (typeof window !== 'undefined') {
  throw new Error('src/lib/education/attendance-zone.ts는 서버 전용입니다 — client component에서 import하지 마세요.');
}

export type AttendanceStatus = 'AVAILABLE' | 'SHARED' | 'REVIEW_REQUIRED' | 'NOT_AVAILABLE';
export type SchoolIdentityConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_MATCH';
export type ElementaryZoneType = 'SINGLE' | 'JOINT_SYMMETRIC' | 'JOINT_ASYMMETRIC';

export interface AttendanceZoneSchool {
  schoolId: number | null; // canonical School.id
  neisSchoolCode: string | null;
  schoolName: string;
  identityConfidence: SchoolIdentityConfidence;
}

export interface ElementaryAttendanceZoneInfo {
  status: AttendanceStatus;
  reasonCode: string;
  zoneName: string | null;
  zoneType: ElementaryZoneType;
  schools: AttendanceZoneSchool[];
  sourceDate: string;
  sourceName: string;
  notice: string;
}

export interface MiddleSchoolGroupInfo {
  status: AttendanceStatus;
  reasonCode: string;
  groupName: string | null;
  schools: AttendanceZoneSchool[];
  sourceDate: string;
}

export interface SchoolAccessZoneInfo {
  elementary: ElementaryAttendanceZoneInfo;
  middle: MiddleSchoolGroupInfo;
  datasetVersion: string;
  generatedAt: string;
}

interface ArtifactApartmentRecord {
  aptSeq: string;
  aptName: string;
  sigungu: string | null;
  dong: string | null;
  elementary: Omit<ElementaryAttendanceZoneInfo, 'notice'>;
  middle: MiddleSchoolGroupInfo;
}

interface Artifact {
  meta: {
    datasetVersion: string;
    sourceDate: string;
    sourceName: string;
    resolverVersion: string;
    generatedAt: string;
    totalApartments: number;
    checksum: string;
    legalNotice: string;
  };
  apartments: ArtifactApartmentRecord[];
}

const ARTIFACT_PATH = path.join(process.cwd(), 'data/education/attendance-zone/busan-attendance-zone-20260320.json');

let cachedArtifact: Artifact | null = null;
let cachedIndex: Map<string, ArtifactApartmentRecord> | null = null;

function loadArtifact(): Artifact {
  if (!cachedArtifact) {
    cachedArtifact = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf-8')) as Artifact;
  }
  return cachedArtifact;
}

function loadIndex(): { artifact: Artifact; index: Map<string, ArtifactApartmentRecord> } {
  const artifact = loadArtifact();
  if (!cachedIndex) {
    cachedIndex = new Map(artifact.apartments.map((a) => [a.aptSeq, a]));
  }
  return { artifact, index: cachedIndex };
}

/**
 * 부산 아파트(aptSeq) 기준 공식 통학구역/중학교 학교군 정보를 읽기 전용으로 반환한다.
 * artifact에 없는 aptSeq(부산 외 지역 등)는 null.
 * "가장 가까운 학교" fallback 없음 — REVIEW_REQUIRED/NOT_AVAILABLE도 그대로 노출한다.
 */
export function getApartmentEducationZone(aptSeq: string): SchoolAccessZoneInfo | null {
  const { artifact, index } = loadIndex();
  const record = index.get(aptSeq);
  if (!record) return null;
  return {
    elementary: { ...record.elementary, notice: artifact.meta.legalNotice },
    middle: record.middle,
    datasetVersion: artifact.meta.datasetVersion,
    generatedAt: artifact.meta.generatedAt,
  };
}

export function getAttendanceZoneDatasetMeta() {
  return loadArtifact().meta;
}

export type { ZoneRelatedApartment } from './school-apartment-relations';

// SCHOOLINFO / SCHOOL V2.1 §17~18 — "학교 → 관련 아파트" 방향 조회. artifact를
// 한 번만 로드/캐시하고, 실제 매칭 판정은 순수 함수(findZoneRelatedApartments)에
// 위임한다 — canonical NEIS code가 있으면 코드로만 매칭해 동명이교를 섞지 않는다.
export function getApartmentsForSchool(identity: SchoolIdentityForLookup): ZoneRelatedApartment[] {
  const { artifact } = loadIndex();
  return findZoneRelatedApartments(artifact.apartments, identity);
}
