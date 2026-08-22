// SCHOOL V2-C6-B §9 — SCHOOL V2-D가 바로 사용할 수 있는 read-only 헬퍼.
// data/education/attendance-zone/의 precomputed local artifact만 읽는다(DB 접근
// 없음, production write 없음). scripts/education/c6b-04-final-pipeline.ts가 생성한
// 산출물과 1:1 대응되는 타입만 정의한다 — 이 파일 자체는 아직 어떤 API route에서도
// import되지 않는다(SCHOOL V2-D 범위, 이번 STEP은 계약 준비까지만).
import { readFileSync } from 'fs';
import path from 'path';

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
