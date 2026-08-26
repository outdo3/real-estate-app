/**
 * BUSAN DATA / UX AUTOMATED QA V1
 *
 * 목적: 부산 3,402개 단지를 사용자가 직접 눌러보며 오류를 찾는 방식에서 벗어나, 데이터
 * 누락/모순/API 오류/거래-전세 갭 불일치/상세페이지 핵심 데이터 문제/검색·지도 identity
 * 문제를 자동으로 먼저 탐지한다. 이 스크립트는 READ-ONLY다 — DB에 절대 쓰지 않는다
 * (SELECT류 Prisma 호출만 사용, /api/apt/[name] 계열 GET 라우트는 내부적으로 legacy
 * Apartment 캐시에 upsert할 수 있으나 이는 그 라우트의 기존 동작이지 이 스크립트가
 * 추가한 쓰기가 아니다).
 *
 * 4개 레이어:
 *   L1 DATABASE COVERAGE   — ApartmentMaster 3,402건 전체, 필드별 coverage + 구/군별 breakdown
 *   L2 DATA CONSISTENCY    — 3,402건 전체, per-row 이상값(음수/미래년도/좌표 범위 밖 등)
 *   L3 API CONTRACT        — 대표 단지 set(16개 구/군 x 최대 3 + 4개 고정 회귀 fixture)에
 *                            대해 실제 로컬 dev 서버로 HTTP 호출
 *   L4 PRODUCT CONTRADICTION — L3 응답을 DB 값과 대조(거래 API 오류≠거래없음, DB엔 있는데
 *                            detail API엔 없음 등)
 * 그 외 IDENTITY/TRADE TRUST/UNIT MASTER/SEARCH/MAP QA는 L3/L4에 종속되는 하위 체크로 구현.
 *
 * 사용법:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/run-busan-data-ux-qa.ts [옵션]
 *
 * 옵션:
 *   --all              (기본값) 부산 전체 DB QA + 대표 set API QA
 *   --district=<코드|이름>  L1/L2를 해당 구/군으로 한정(예: --district=26470 또는 --district=연제구)
 *   --aptSeq=<seq>     대표 set 대신 이 aptSeq 1건만 API QA
 *   --quick            대표 set을 구/군당 1건 + 4개 고정 fixture로 축소(빠른 재실행용)
 *   --no-api           L3/L4(API 호출) 생략, L1/L2/Identity/UnitMaster(DB만)만 실행
 *   --json             tmp/qa/BUSAN_DATA_UX_QA_V1.json 로 머신 판독 가능 결과 저장(커밋 금지 경로)
 *   --base-url=<url>   API 호출 대상(기본 http://localhost:3000, 로컬 dev 서버 필요)
 *
 * 중요한 한계(정직하게 명시):
 * - browser automation 인프라가 이 실행 환경에 없다 — UI 렌더링/시각 회귀는 검사하지 않는다
 *   (MANUAL_REQUIRED로 별도 분류, §11 요구사항과 일치).
 * - L3/L4는 "부산 전체 3,402건"이 아니라 대표 set(최대 16*3+4≈52건)에서만 실행한다 — 매
 *   요청마다 MOLIT/건축물대장/Kakao 같은 외부 공공 API를 부르는 라이브 라우트라, 3,402건
 *   전부를 API 레벨로 재수집하면 대량 외부 API 재호출(AGENTS.md 금지 대상)이 된다.
 * - 전세가율 등 통계 대시보드 자체(/api/stats/dashboard)는 이번 스크립트의 검증 대상이
 *   아니다 — /api/apt/[name](거래 API) 응답만으로 같은 계산(전세/반전세 분리, 매매-전세
 *   페어링)이 올바른지 자체 재현해 검증한다(gap-invest-calc.ts 재사용).
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true } as any);
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true } as any);

import { PrismaClient, BasicSpecSource } from '@prisma/client';
import { buildGapCandidates, type GapTrade } from '../src/lib/gap-invest-calc';
import { pct, parseAreaM2, toIsoDate, haversineMeters, classifyConsistency, isApiFailureMisclassifiedAsNoTrade } from './busan-qa-logic';

const prisma = new PrismaClient();

// ────────────────────────────────────────────────────────────────────────
// CLI 옵션
// ────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function flag(name: string): string | null {
  const withEq = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  return argv.includes(`--${name}`) ? '' : null;
}

const OPT = {
  district: flag('district'),
  aptSeq: flag('aptSeq'),
  quick: flag('quick') !== null,
  noApi: flag('no-api') !== null,
  json: flag('json') !== null,
  baseUrl: flag('base-url') || process.env.QA_BASE_URL || 'http://localhost:3000',
};

// ────────────────────────────────────────────────────────────────────────
// 상수: 부산 16개 구/군(sggCd), Busan bounding box(실측 3,402건 범위에 여유 마진),
// 고정 회귀 fixture(§10/§20 — 이전 STEP에서 실제로 발견/수정했던 4개 사례)
// ────────────────────────────────────────────────────────────────────────

const BUSAN_DISTRICTS: Record<string, string> = {
  '26110': '중구',
  '26140': '서구',
  '26170': '동구',
  '26200': '영도구',
  '26230': '부산진구',
  '26260': '동래구',
  '26290': '남구',
  '26320': '북구',
  '26350': '해운대구',
  '26380': '사하구',
  '26410': '금정구',
  '26440': '강서구',
  '26470': '연제구',
  '26500': '수영구',
  '26530': '사상구',
  '26710': '기장군',
};

// 실측(2026-08-26 감사 문서 §12-2 기준) ApartmentMaster 좌표 범위: lat 35.05~35.37,
// lng 128.83~129.26 — 오탐 없이 "명백히 부산 밖"만 잡도록 여유를 두고 넓힌다.
const BUSAN_BBOX = { minLat: 34.9, maxLat: 35.45, minLng: 128.6, maxLng: 129.35 };

const CURRENT_YEAR = new Date().getFullYear();

type RegressionFixture = {
  label: string;
  aptSeq: string;
  name: string;
  sggCd: string;
  umdName: string;
  jibun: string;
  note: string;
};

const KNOWN_REGRESSIONS: RegressionFixture[] = [
  {
    label: '연산동한솔솔파크',
    aptSeq: '26470-1040',
    name: '연산동한솔솔파크',
    sggCd: '26470',
    umdName: '연산동',
    jibun: '406-10',
    note: 'FAR/BCR/주차 — WRONG_SOURCE_SELECTION 회귀(APARTMENT_BASIC_DATA_COVERAGE_AUDIT_V1). ' +
      '이름만으로 찾으면 해운대구 우동의 "해운대한솔솔파크"(aptSeq 26350-2115)와 충돌하므로 반드시 aptSeq/umdName 병기.',
  },
  {
    label: '대신롯데캐슬',
    aptSeq: '26140-1164',
    name: '대신롯데캐슬',
    sggCd: '26140',
    umdName: '서대신동3가',
    jibun: '762',
    note: 'Unit Master collision(84.7855/84.9950, 59.8826/59.8839) + trade chart + same-area rent ratio/gap. ' +
      '이름만으로 찾으면 서울 강남구 대치동의 동명 단지(legacy Apartment id=14)와 충돌 — 이번 STEP에서 실측 재현/수정(§14 참고).',
  },
  {
    label: '연산동일동미라주더스타',
    aptSeq: '26470-1481',
    name: '연산동일동미라주더스타',
    sggCd: '26470',
    umdName: '연산동',
    jibun: '2335',
    note: 'Trade data trust — API 실패/unresolved identity를 "거래 없음"으로 오판하지 않는지, Unit Master 없는 경로.',
  },
  {
    label: '대신해모로센트럴아파트',
    aptSeq: '26140-1356',
    name: '대신해모로센트럴아파트',
    sggCd: '26140',
    umdName: '서대신동2가',
    jibun: '576',
    note: 'sale-only/rent-only 케이스 — 한쪽 거래 유형만 있을 때 억지로 gap을 만들지 않는지 확인.',
  },
];

// ────────────────────────────────────────────────────────────────────────
// 결과 타입
// ────────────────────────────────────────────────────────────────────────

type Severity = 'P0_DATA_TRUST' | 'P0_BROKEN_FLOW' | 'P1_COVERAGE' | 'P1_PERFORMANCE' | 'P2_UI' | 'SOURCE_LIMITATION';

type Finding = {
  severity: Severity;
  category: string; // 예: 'L2_CONSISTENCY', 'L4_BASIC_SPEC_MISMATCH', 'TRADE_TRUST', 'IDENTITY', ...
  apartment?: string;
  aptSeq?: string | null;
  field?: string;
  expected?: string;
  actual?: string;
  reproducible: boolean;
  recommendedNextStep: string;
};

type PerfSample = { label: string; ms: number; ok: boolean };

const findings: Finding[] = [];
const perfSamples: PerfSample[] = [];

function addFinding(f: Finding) {
  findings.push(f);
}

// ────────────────────────────────────────────────────────────────────────
// L1 + L2: DB COVERAGE + CONSISTENCY (부산 ApartmentMaster 전체 또는 --district 한정)
// ────────────────────────────────────────────────────────────────────────

type MasterRow = Awaited<ReturnType<typeof loadMasterRows>>[number];

async function loadMasterRows(districtFilter: string | null) {
  let sggCd: string | undefined;
  if (districtFilter) {
    if (BUSAN_DISTRICTS[districtFilter]) sggCd = districtFilter;
    else {
      const found = Object.entries(BUSAN_DISTRICTS).find(([, name]) => name === districtFilter);
      if (found) sggCd = found[0];
      else throw new Error(`알 수 없는 --district 값: ${districtFilter} (sggCd 또는 정확한 구/군 이름 필요)`);
    }
  }
  return prisma.apartmentMaster.findMany({
    where: sggCd ? { sggCd } : undefined,
    select: {
      id: true,
      aptSeq: true,
      mgmBldrgstPk: true,
      name: true,
      normalizedName: true,
      sido: true,
      sigungu: true,
      sggCd: true,
      umdName: true,
      umdCd: true,
      jibun: true,
      latitude: true,
      longitude: true,
      geocodeQuality: true,
      buildYear: true,
      useApprovalDate: true,
      mainBuildingCount: true,
      totalHouseholds: true,
      parkingCount: true,
      floorAreaRatio: true,
      buildingCoverageRatio: true,
      parkingPerHousehold: true,
      basicSpecSource: true,
    },
  });
}

type CoverageReport = {
  total: number;
  fields: Record<string, { present: number; pct: string }>;
  bySource: Record<string, number>;
  byDistrict: Array<{ sggCd: string; name: string; total: number; household: number; parking: number; far: number; bcr: number }>;
};

function computeCoverage(rows: MasterRow[]): CoverageReport {
  const total = rows.length;
  const fieldDefs: Array<{ key: keyof MasterRow; label: string }> = [
    { key: 'totalHouseholds', label: 'householdCount' },
    { key: 'buildYear', label: 'buildYear' },
    { key: 'mainBuildingCount', label: 'mainBuildingCount' },
    { key: 'parkingCount', label: 'parkingCount' },
    { key: 'parkingPerHousehold', label: 'parkingPerHousehold' },
    { key: 'floorAreaRatio', label: 'floorAreaRatio' },
    { key: 'buildingCoverageRatio', label: 'buildingCoverageRatio' },
    { key: 'mgmBldrgstPk', label: 'mgmBldrgstPk' },
    { key: 'latitude', label: 'coordinates' },
  ];
  const fields: CoverageReport['fields'] = {};
  for (const f of fieldDefs) {
    const present = rows.filter((r) => r[f.key] !== null && r[f.key] !== undefined).length;
    fields[f.label] = { present, pct: pct(present, total) };
  }

  const bySource: Record<string, number> = { BUILDINGHUB_GENERAL_TITLE: 0, BUILDINGHUB_TITLE: 0, UNKNOWN: 0 };
  for (const r of rows) bySource[r.basicSpecSource] = (bySource[r.basicSpecSource] || 0) + 1;

  const byDistrictMap = new Map<string, { total: number; household: number; parking: number; far: number; bcr: number }>();
  for (const r of rows) {
    const key = r.sggCd || 'null';
    const cur = byDistrictMap.get(key) || { total: 0, household: 0, parking: 0, far: 0, bcr: 0 };
    cur.total++;
    if (r.totalHouseholds != null) cur.household++;
    if (r.parkingCount != null) cur.parking++;
    if (r.floorAreaRatio != null) cur.far++;
    if (r.buildingCoverageRatio != null) cur.bcr++;
    byDistrictMap.set(key, cur);
  }
  const byDistrict = Array.from(byDistrictMap.entries())
    .map(([sggCd, v]) => ({ sggCd, name: BUSAN_DISTRICTS[sggCd] || sggCd, ...v }))
    .sort((a, b) => b.total - a.total);

  return { total, fields, bySource, byDistrict };
}

function runConsistencyChecks(rows: MasterRow[]): { pass: number; warn: number; fail: number } {
  let pass = 0;
  let warn = 0;
  let fail = 0;

  for (const r of rows) {
    const { hard: hardIssues, soft: softIssues } = classifyConsistency(r, BUSAN_BBOX, CURRENT_YEAR);

    if (hardIssues.length === 0 && softIssues.length === 0) {
      pass++;
      continue;
    }
    if (hardIssues.length > 0) {
      fail++;
      addFinding({
        severity: 'P0_DATA_TRUST',
        category: 'L2_CONSISTENCY',
        apartment: r.name,
        aptSeq: r.aptSeq,
        field: 'basic_specs/coordinates',
        expected: '유효한 범위/계산 일치',
        actual: hardIssues.join('; '),
        reproducible: true,
        recommendedNextStep: 'FIX_P0_DATA_TRUST 후속 STEP에서 개별 재조회/수정 검토(이번 STEP은 audit-only)',
      });
    } else {
      warn++;
      addFinding({
        severity: 'P1_COVERAGE',
        category: 'L2_CONSISTENCY_SOFT',
        apartment: r.name,
        aptSeq: r.aptSeq,
        field: 'basic_specs',
        expected: '통상적 법정 범위 이내',
        actual: softIssues.join('; '),
        reproducible: true,
        recommendedNextStep: '데이터 오류(자릿수/필드 혼동)인지, 실제 예외적 건축물인지 사람 확인 필요',
      });
    }
  }

  return { pass, warn, fail };
}

// ────────────────────────────────────────────────────────────────────────
// IDENTITY QA (전체 3,402건 + legacy Apartment 38건)
// ────────────────────────────────────────────────────────────────────────

async function runIdentityQa(rows: MasterRow[]) {
  // aptSeq duplicate(DB @unique라 정상적으론 0건이어야 함 — 방어적 재검증)
  const bySeq = new Map<string, number>();
  for (const r of rows) {
    if (!r.aptSeq) continue;
    bySeq.set(r.aptSeq, (bySeq.get(r.aptSeq) || 0) + 1);
  }
  const dupSeqs = Array.from(bySeq.entries()).filter(([, n]) => n > 1);
  if (dupSeqs.length > 0) {
    addFinding({
      severity: 'P0_DATA_TRUST',
      category: 'IDENTITY_DUPLICATE_APTSEQ',
      field: 'aptSeq',
      expected: 'unique',
      actual: `중복 ${dupSeqs.length}건: ${dupSeqs.slice(0, 5).map(([s]) => s).join(', ')}`,
      reproducible: true,
      recommendedNextStep: 'DB @unique 제약과 실제 데이터 불일치 — 즉시 원인 조사 필요',
    });
  }

  // normalizedName collision across different (sggCd, umdName) — "brand-name collision" 패턴
  // (실측 사례: 한솔솔파크=연제구 연산동/해운대구 우동). 이 자체는 버그가 아니라 정상적으로
  // 존재하는 실제 데이터 패턴이지만, "이름만으로 재식별 금지" 원칙이 실제로 왜 필요한지
  // 보여주는 회귀 감시 대상이라 개수를 추적한다.
  const byNormName = new Map<string, MasterRow[]>();
  for (const r of rows) {
    const arr = byNormName.get(r.normalizedName) || [];
    arr.push(r);
    byNormName.set(r.normalizedName, arr);
  }
  const collisionGroups = Array.from(byNormName.entries()).filter(([, arr]) => {
    const keys = new Set(arr.map((r) => `${r.sggCd}::${r.umdName}`));
    return keys.size > 1;
  });

  // legacy Apartment 테이블 name-only 재식별 위험(코드 정적 검사로 이미 발견/수정한 4개
  // 라우트의 실제 데이터 근거) — 같은 name, 다른 dong 조합이 실제로 존재하는지 재확인
  const legacyRows = await prisma.apartment.findMany({ select: { id: true, name: true, dong: true, lawdCd: true } });
  const legacyByName = new Map<string, typeof legacyRows>();
  for (const r of legacyRows) {
    const arr = legacyByName.get(r.name) || [];
    arr.push(r);
    legacyByName.set(r.name, arr as any);
  }
  const legacyCollisions = Array.from(legacyByName.entries()).filter(([, arr]) => new Set(arr.map((r) => r.dong)).size > 1);

  for (const [name, arr] of legacyCollisions) {
    addFinding({
      severity: 'P0_DATA_TRUST',
      category: 'IDENTITY_NAME_ONLY_FALLBACK_RISK',
      apartment: name,
      field: 'legacy Apartment(name unique 아님)',
      expected: '이름만으로 조회 시 단일 후보만 존재하거나, 코드가 항상 dong/lawdCd를 함께 사용',
      actual: `동일 name, 서로 다른 dong ${arr.length}건: ${arr.map((r) => `${r.dong}(${r.lawdCd})`).join(' / ')}`,
      reproducible: true,
      recommendedNextStep:
        '이번 STEP에서 /api/apt/[name]/{route,score,education,facilities}의 name-only fallback 4곳을 안전하게 수정함(§14 문서 참고). ' +
        '향후 유사 패턴(신규 라우트 추가 시) 재발 방지를 위해 코드 리뷰 체크리스트화 권장.',
    });
  }

  return {
    aptSeqDuplicates: dupSeqs.length,
    normalizedNameCollisionGroups: collisionGroups.length,
    normalizedNameCollisionExamples: collisionGroups.slice(0, 5).map(([n, arr]) => ({
      name: n,
      variants: arr.map((r) => ({ aptSeq: r.aptSeq, sggCd: r.sggCd, umdName: r.umdName })),
    })),
    legacyNameOnlyCollisions: legacyCollisions.length,
    legacyNameOnlyExamples: legacyCollisions.map(([n, arr]) => ({ name: n, rows: arr })),
  };
}

// ────────────────────────────────────────────────────────────────────────
// UNIT MASTER QA (legacy Apartment + ApartmentUnitType, DB만)
// ────────────────────────────────────────────────────────────────────────

async function runUnitMasterQa() {
  const unitTypes = await prisma.apartmentUnitType.findMany({
    select: {
      id: true,
      apartmentId: true,
      canonicalExclusiveArea: true,
      variantKey: true,
      representativePyeong: true,
      representativePyeongSource: true,
    },
  });

  // 규칙: representativePyeong이 채워져 있으면서 source가 UNKNOWN인 행 — "값은 있는데
  // 출처를 신뢰할 수 없음" 조합은 스키마 계약 위반(UNKNOWN이면 채우지 않아야 함, AGENTS.md
  // "representativePyeongSource가 UNKNOWN이면 hardcode 추정치를 쓰지 않는다" 원칙).
  const untrustedPyeong = unitTypes.filter((u) => u.representativePyeong != null && u.representativePyeongSource === 'UNKNOWN');
  for (const u of untrustedPyeong) {
    addFinding({
      severity: 'P0_DATA_TRUST',
      category: 'UNIT_MASTER_UNTRUSTED_PYEONG',
      field: 'representativePyeong',
      expected: 'source=UNKNOWN이면 representativePyeong도 null',
      actual: `apartmentUnitType.id=${u.id}(apartmentId=${u.apartmentId})에 representativePyeong=${u.representativePyeong}가 source=UNKNOWN 상태로 저장됨`,
      reproducible: true,
      recommendedNextStep: '해당 행의 유입 경로(backfill 스크립트) 재조사 필요',
    });
  }

  // canonicalExclusiveArea collision 감시: 같은 apartmentId 안에서 근접하지만 다른 값
  // (예: 84.7855/84.9950)이 실제로 별도 행으로 남아있는지 — DB unique 제약(apartmentId,
  // canonicalExclusiveArea, variantKey)이 이를 보장하지만, "표시 단계에서 반올림돼 merge된
  // 것처럼 보이는" 회귀는 API 계층에서 별도 검사(runRepresentativeApiQa의 unit master 섹션).
  const byApt = new Map<number, typeof unitTypes>();
  for (const u of unitTypes) {
    const arr = byApt.get(u.apartmentId) || [];
    arr.push(u);
    byApt.set(u.apartmentId, arr as any);
  }
  let closeButDistinctGroups = 0;
  for (const [, arr] of byApt) {
    const areas = arr.map((u) => Number(u.canonicalExclusiveArea));
    for (let i = 0; i < areas.length; i++) {
      for (let j = i + 1; j < areas.length; j++) {
        if (Math.abs(areas[i] - areas[j]) < 0.5 && areas[i] !== areas[j]) closeButDistinctGroups++;
      }
    }
  }

  return {
    totalUnitTypeRows: unitTypes.length,
    apartmentsWithUnitMaster: byApt.size,
    untrustedPyeongCount: untrustedPyeong.length,
    closeButDistinctAreaPairs: closeButDistinctGroups,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 대표 단지 SET 구성(16개 구/군 x 최대 2~3건) + 고정 회귀 fixture 병합
// ────────────────────────────────────────────────────────────────────────

type RepApartment = {
  label: string;
  aptSeq: string;
  name: string;
  sggCd: string;
  umdName: string;
  jibun: string;
  totalHouseholds: number | null;
  buildYear: number | null;
  basicSpecSource: BasicSpecSource;
  floorAreaRatio: number | null;
  buildingCoverageRatio: number | null;
  parkingCount: number | null;
  latitude: number | null;
  longitude: number | null;
  isFixture: boolean;
  fixtureNote?: string;
};

async function buildRepresentativeSet(quick: boolean, onlyAptSeq: string | null): Promise<RepApartment[]> {
  if (onlyAptSeq) {
    const row = await prisma.apartmentMaster.findUnique({ where: { aptSeq: onlyAptSeq } });
    if (!row || !row.sggCd || !row.umdName || !row.jibun) {
      throw new Error(`--aptSeq=${onlyAptSeq} 를 찾을 수 없거나 identity(sggCd/umdName/jibun)가 불완전합니다.`);
    }
    return [
      {
        label: row.name,
        aptSeq: row.aptSeq!,
        name: row.name,
        sggCd: row.sggCd,
        umdName: row.umdName,
        jibun: row.jibun,
        totalHouseholds: row.totalHouseholds,
        buildYear: row.buildYear,
        basicSpecSource: row.basicSpecSource,
        floorAreaRatio: row.floorAreaRatio,
        buildingCoverageRatio: row.buildingCoverageRatio,
        parkingCount: row.parkingCount,
        latitude: row.latitude,
        longitude: row.longitude,
        isFixture: false,
      },
    ];
  }

  const set: RepApartment[] = [];
  const seenSeq = new Set<string>();

  const push = (row: MasterRow, label: string, isFixture = false, fixtureNote?: string) => {
    if (!row.aptSeq || !row.sggCd || !row.umdName || !row.jibun) return;
    if (seenSeq.has(row.aptSeq)) return;
    seenSeq.add(row.aptSeq);
    set.push({
      label,
      aptSeq: row.aptSeq,
      name: row.name,
      sggCd: row.sggCd,
      umdName: row.umdName,
      jibun: row.jibun,
      totalHouseholds: row.totalHouseholds,
      buildYear: row.buildYear,
      basicSpecSource: row.basicSpecSource,
      floorAreaRatio: row.floorAreaRatio,
      buildingCoverageRatio: row.buildingCoverageRatio,
      parkingCount: row.parkingCount,
      latitude: row.latitude,
      longitude: row.longitude,
      isFixture,
      fixtureNote,
    });
  };

  for (const [sggCd, districtName] of Object.entries(BUSAN_DISTRICTS)) {
    const candidates = await prisma.apartmentMaster.findMany({
      where: { sggCd, aptSeq: { not: null }, umdName: { not: null }, jibun: { not: null } },
      orderBy: { totalHouseholds: 'desc' },
    });
    if (candidates.length === 0) continue;

    // 대단지(신축/구축 무관, identity 완전한 것 중 세대수 최대)
    push(candidates[0], `${districtName}-대단지`);

    if (!quick) {
      // 소단지(세대수 > 0인 것 중 최소)
      const withHousehold = candidates.filter((c) => (c.totalHouseholds ?? 0) > 0);
      const smallest = withHousehold[withHousehold.length - 1];
      if (smallest) push(smallest, `${districtName}-소단지`);

      // basicSpecSource=UNKNOWN(기본 스펙 미확보) 표본 1건 — title fallback 없음 케이스 대비
      const unknownSource = candidates.find((c) => c.basicSpecSource === 'UNKNOWN');
      if (unknownSource) push(unknownSource, `${districtName}-basicSpec미확보`);
    }
  }

  // 고정 회귀 fixture 병합(이미 set에 있으면 fixture 메타데이터만 덧씌움)
  for (const fx of KNOWN_REGRESSIONS) {
    const existingIdx = set.findIndex((r) => r.aptSeq === fx.aptSeq);
    if (existingIdx >= 0) {
      set[existingIdx].isFixture = true;
      set[existingIdx].fixtureNote = fx.note;
      continue;
    }
    const row = await prisma.apartmentMaster.findUnique({ where: { aptSeq: fx.aptSeq } });
    if (row) push(row, `FIXTURE-${fx.label}`, true, fx.note);
  }

  return set;
}

// ────────────────────────────────────────────────────────────────────────
// L3/L4: API CONTRACT + PRODUCT CONTRADICTION (대표 set에 대해 실제 HTTP 호출)
// ────────────────────────────────────────────────────────────────────────

async function fetchJson(url: string, timeoutMs = 20000): Promise<{ ok: boolean; status: number; json: any; ms: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const ms = Date.now() - start;
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* 응답이 JSON이 아님 — json은 null로 남김 */
    }
    return { ok: res.ok, status: res.status, json, ms };
  } catch (e: any) {
    return { ok: false, status: 0, json: null, ms: Date.now() - start, error: e?.message || String(e) };
  }
}

function ratioText(v: number | null): string {
  return v == null ? '' : `${v}%`;
}

async function checkBasicSpecApi(apt: RepApartment) {
  const url = `${OPT.baseUrl}/api/apt/${encodeURIComponent(apt.name)}/info?lawdCd=${apt.sggCd}&dong=${encodeURIComponent(apt.umdName)}&jibun=${encodeURIComponent(apt.jibun)}`;
  const res = await fetchJson(url);
  perfSamples.push({ label: `info:${apt.name}`, ms: res.ms, ok: res.ok });

  if (!res.ok || !res.json?.success) {
    addFinding({
      severity: 'P0_BROKEN_FLOW',
      category: 'L3_API_CONTRACT',
      apartment: apt.name,
      aptSeq: apt.aptSeq,
      field: '/api/apt/[name]/info',
      expected: 'HTTP 200 + success:true',
      actual: `status=${res.status}${res.error ? `, error=${res.error}` : ''}`,
      reproducible: true,
      recommendedNextStep: '라우트/외부 API 상태 재확인',
    });
    return;
  }

  const info = res.json.info || {};

  // L4-D: DB에 FAR/BCR 있는데 API가 null
  if (apt.floorAreaRatio != null && !info['용적률']) {
    addFinding({
      severity: 'P0_DATA_TRUST',
      category: 'L4_BASIC_SPEC_MISMATCH',
      apartment: apt.name,
      aptSeq: apt.aptSeq,
      field: '용적률(floorAreaRatio)',
      expected: `DB=${ratioText(apt.floorAreaRatio)}`,
      actual: 'API 응답에 없음(정보 없음으로 표시됨)',
      reproducible: true,
      recommendedNextStep: '/api/apt/[name]/info의 ApartmentMaster tier2 조회 조건(sggCd/umdName/jibun 매칭) 재확인',
    });
  }
  if (apt.buildingCoverageRatio != null && !info['건폐율']) {
    addFinding({
      severity: 'P0_DATA_TRUST',
      category: 'L4_BASIC_SPEC_MISMATCH',
      apartment: apt.name,
      aptSeq: apt.aptSeq,
      field: '건폐율(buildingCoverageRatio)',
      expected: `DB=${ratioText(apt.buildingCoverageRatio)}`,
      actual: 'API 응답에 없음',
      reproducible: true,
      recommendedNextStep: '/api/apt/[name]/info의 ApartmentMaster tier2 조회 조건 재확인',
    });
  }
  if (apt.parkingCount != null && !info['총주차대수']) {
    addFinding({
      severity: 'P0_DATA_TRUST',
      category: 'L4_BASIC_SPEC_MISMATCH',
      apartment: apt.name,
      aptSeq: apt.aptSeq,
      field: '총주차대수(parkingCount)',
      expected: `DB=${apt.parkingCount}`,
      actual: 'API 응답에 없음',
      reproducible: true,
      recommendedNextStep: '/api/apt/[name]/info의 ApartmentMaster tier2 조회 조건 재확인',
    });
  }
}

type TradeRaw = {
  id: string;
  name: string;
  tradeDate: string;
  price: number;
  area: string;
  tradeType: string;
  dong: string;
  monthlyRent: number;
  dealCanceled: boolean;
};

async function checkTradeApi(apt: RepApartment) {
  const url = `${OPT.baseUrl}/api/apt/${encodeURIComponent(apt.name)}?lawdCd=${apt.sggCd}&dong=${encodeURIComponent(apt.umdName)}&period=12`;
  const res = await fetchJson(url, 30000);
  perfSamples.push({ label: `trade:${apt.name}`, ms: res.ms, ok: res.ok });

  if (!res.ok) {
    addFinding({
      severity: 'P0_BROKEN_FLOW',
      category: 'L3_API_CONTRACT',
      apartment: apt.name,
      aptSeq: apt.aptSeq,
      field: '/api/apt/[name]',
      expected: 'HTTP 200',
      actual: `status=${res.status}${res.error ? `, error=${res.error}` : ''}`,
      reproducible: true,
      recommendedNextStep: '라우트/외부 API 상태 재확인',
    });
    return;
  }

  const trades: TradeRaw[] = res.json?.trades || [];
  const apiError: string | null = res.json?.apiError ?? null;

  // TRADE DATA TRUST: API 실패(apiError truthy) ≠ 거래 없음. apiError가 있는데 trades가
  // 0건이면, 그 0건은 "실제 무거래"가 아니라 "조회 실패"다 — 이걸 그대로 UI가 "거래
  // 내역 없음"으로 표시하면 §6-A/B 위반.
  if (isApiFailureMisclassifiedAsNoTrade(apiError, trades.length)) {
    addFinding({
      severity: 'P0_DATA_TRUST',
      category: 'TRADE_TRUST_API_FAILURE_MISCLASSIFIED',
      apartment: apt.name,
      aptSeq: apt.aptSeq,
      field: 'apiError vs trades.length',
      expected: 'apiError가 있으면 "거래 없음"이 아니라 API 오류로 표시되어야 함',
      actual: `apiError="${apiError}", trades=0건`,
      reproducible: true,
      recommendedNextStep: 'UI(apt-client.tsx 등)가 apiError를 별도로 렌더링하는지 확인 필요(이 라우트 자체는 이미 apiError 필드를 내려주고 있음)',
    });
  }

  if (trades.length === 0) return; // apiError 유무와 무관하게 이 apt는 더 볼 거래 데이터가 없음

  // 같은 정확한 면적 기준 매매 vs 순수전세(반전세 제외) gap/ratio 계산 — gap-invest-calc.ts의
  // 실제 프로덕션 로직(buildGapCandidates)을 그대로 재사용해, 이 QA가 별도 계산 로직을
  // 중복 구현하지 않게 한다. 반전세(monthlyRent>0)를 "순수 전세"에서 제외하는 것 자체가
  // 이전 STEP에서 발견/수정했던 회귀(반전세 혼입 → 가짜 -97% 역전세)의 재발 방지 지점이다.
  const toGapTrade = (t: TradeRaw): GapTrade | null => {
    if (t.dealCanceled) return null;
    const excluUseArea = parseAreaM2(t.area);
    if (excluUseArea == null) return null;
    return {
      name: t.name,
      dong: t.dong,
      dealAmount: t.price,
      excluUseArea,
      dealDate: toIsoDate(t.tradeDate),
      dealCanceled: t.dealCanceled,
      monthlyRent: t.monthlyRent,
      aptSeq: apt.aptSeq,
    };
  };

  const saleTrades = trades
    .filter((t) => t.tradeType?.includes('매매'))
    .map(toGapTrade)
    .filter((t): t is GapTrade => t != null);
  const pureJeonseTrades = trades
    .filter((t) => t.tradeType?.includes('전세') && (t.monthlyRent ?? 0) === 0)
    .map(toGapTrade)
    .filter((t): t is GapTrade => t != null);
  const banJeonseCount = trades.filter((t) => t.tradeType?.includes('전세') && (t.monthlyRent ?? 0) > 0).length;

  const candidates = buildGapCandidates(saleTrades, pureJeonseTrades);

  for (const c of candidates) {
    const ratio = c.latestJeonse.amount > 0 ? c.latestSale.amount / c.latestJeonse.amount : null;
    // ratio < 1(전세가 매매가보다 비쌈)은 이론상 이례적이나 실제 시장에서 발생 가능 —
    // FAIL이 아니라 WARN 정보로만 남긴다(억지 진단 금지, §1 core principle).
    if (ratio != null && ratio < 1) {
      addFinding({
        severity: 'P1_COVERAGE',
        category: 'TRADE_GAP_RATIO_ANOMALY',
        apartment: apt.name,
        aptSeq: apt.aptSeq,
        field: `면적 ${c.exclusiveAreaM2}㎡`,
        expected: '매매가 >= 전세가(일반적 패턴)',
        actual: `매매=${c.latestSale.amount}, 전세=${c.latestJeonse.amount}, ratio=${ratio.toFixed(2)}(순수전세만 사용, 반전세 ${banJeonseCount}건은 제외됨)`,
        reproducible: true,
        recommendedNextStep: '실제 시장 역전세 가능성 vs 데이터 오류 여부는 개별 확인 필요(자동 판정 불가)',
      });
    }
  }

  (apt as any)._gapCandidateCount = candidates.length;
  (apt as any)._banJeonseExcluded = banJeonseCount;
}

async function checkUnitMasterApi(apt: RepApartment) {
  const url = `${OPT.baseUrl}/api/apt/${encodeURIComponent(apt.name)}/info?lawdCd=${apt.sggCd}&dong=${encodeURIComponent(apt.umdName)}&jibun=${encodeURIComponent(apt.jibun)}`;
  const res = await fetchJson(url);
  if (!res.ok || !res.json) return;
  const unitTypes: any[] | null = res.json.unitTypes;
  if (!unitTypes) return;

  // 주의: 같은 canonicalExclusiveArea가 서로 다른 variantKey로 두 번 이상 나타나는 것은
  // 정상 설계다(스키마 @@unique([apartmentId, canonicalExclusiveArea, variantKey]) 자체가
  // 이를 허용 — 실측: 대신해모로센트럴아파트가 84.9442를 supply_112.7524/112.7930 두
  // variant로 정당하게 보유). 그래서 "같은 면적이 두 번 보인다"는 collision이 아니다.
  // 진짜 collision은 (area, variantKey) 조합이 DB엔 있는데 API 응답에서 사라지는 것.
  const legacyApt = await prisma.apartment.findFirst({
    where: { name: apt.name, dong: apt.umdName },
    include: { unitTypes: true },
  });
  if (!legacyApt) return; // legacy 캐시에 이 단지 행 자체가 없음 — 비교 불가(대상 아님)

  if (unitTypes.length !== legacyApt.unitTypes.length) {
    addFinding({
      severity: 'P0_DATA_TRUST',
      category: 'UNIT_MASTER_API_COUNT_MISMATCH',
      apartment: apt.name,
      aptSeq: apt.aptSeq,
      field: 'unitTypes[] 개수',
      expected: `DB=${legacyApt.unitTypes.length}건`,
      actual: `API 응답=${unitTypes.length}건`,
      reproducible: true,
      recommendedNextStep: '/api/apt/[name]/info의 unitTypes 직렬화 경로 확인(일부 variant가 누락/병합됐을 가능성)',
    });
  }

  const dbKeys = new Set(legacyApt.unitTypes.map((u) => `${u.canonicalExclusiveArea.toString()}::${u.variantKey}`));
  const apiKeys = new Set(unitTypes.map((u: any) => `${u.canonicalExclusiveArea}::${u.variantKey}`));
  const missingInApi = Array.from(dbKeys).filter((k) => !apiKeys.has(k));
  if (missingInApi.length > 0) {
    addFinding({
      severity: 'P0_DATA_TRUST',
      category: 'UNIT_MASTER_API_VARIANT_MISSING',
      apartment: apt.name,
      aptSeq: apt.aptSeq,
      field: 'unitTypes[].(canonicalExclusiveArea, variantKey)',
      expected: 'DB의 모든 (area, variantKey) 조합이 API 응답에도 존재',
      actual: `누락 ${missingInApi.length}건: ${missingInApi.slice(0, 3).join(', ')}`,
      reproducible: true,
      recommendedNextStep: '/api/apt/[name]/info의 unitTypes 직렬화 경로 확인',
    });
  }
}

async function runSearchQa() {
  const queries = ['연산동', '대신동', '해운대', '명지', '서면'];
  const results: Array<{ query: string; ms: number; regions: number; apartments: number; duplicateAptSeq: number }> = [];

  for (const q of queries) {
    const res = await fetchJson(`${OPT.baseUrl}/api/search?q=${encodeURIComponent(q)}`);
    perfSamples.push({ label: `search:${q}`, ms: res.ms, ok: res.ok });
    if (!res.ok) {
      addFinding({
        severity: 'P0_BROKEN_FLOW',
        category: 'SEARCH_QA',
        field: '/api/search',
        expected: 'HTTP 200',
        actual: `query="${q}" status=${res.status}`,
        reproducible: true,
        recommendedNextStep: '검색 라우트 상태 확인',
      });
      continue;
    }
    const regions = res.json?.regions?.length ?? 0;
    const apartments = res.json?.apartments ?? [];
    const seqSet = new Set<string>();
    let dup = 0;
    for (const a of apartments) {
      if (!a.aptSeq) continue;
      if (seqSet.has(a.aptSeq)) dup++;
      seqSet.add(a.aptSeq);
    }
    if (dup > 0) {
      addFinding({
        severity: 'P1_COVERAGE',
        category: 'SEARCH_QA_DUPLICATE',
        field: '/api/search apartments[]',
        expected: '중복 aptSeq 없음',
        actual: `query="${q}"에서 중복 aptSeq ${dup}건`,
        reproducible: true,
        recommendedNextStep: '검색 쿼리 dedup 로직 검토',
      });
    }
    // identity 필드 완전성(canonical aptSeq 결측 비율)
    const missingSeq = apartments.filter((a: any) => !a.aptSeq).length;
    if (apartments.length > 0 && missingSeq / apartments.length > 0.3) {
      addFinding({
        severity: 'P1_COVERAGE',
        category: 'SEARCH_QA_IDENTITY_GAP',
        field: '/api/search apartments[].aptSeq',
        expected: 'aptSeq 대부분 존재',
        actual: `query="${q}": ${missingSeq}/${apartments.length}건 aptSeq 결측`,
        reproducible: true,
        recommendedNextStep: 'ApartmentMaster.aptSeq 결측 원본 데이터 확인',
      });
    }
    results.push({ query: q, ms: res.ms, regions, apartments: apartments.length, duplicateAptSeq: dup });
  }
  return results;
}

// MAP QA: /api/search가 실제로 지도 마커에 쓰는 identity/좌표 소스다(ApartmentLocationFeature
// 테이블 기반 — ApartmentMaster.latitude/longitude와는 별개 파이프라인). 같은 aptSeq에 대해
// 두 좌표가 크게 어긋나면 "검색 결과와 지도 마커가 다른 identity를 쓰는" 문제로 이어질 수 있다.
async function runMapQa(repSet: RepApartment[]) {
  const seqs = repSet.map((r) => r.aptSeq);
  const locations = await prisma.apartmentLocationFeature.findMany({
    where: { aptSeq: { in: seqs } },
    select: { aptSeq: true, latitude: true, longitude: true },
  });
  const locMap = new Map(locations.map((l) => [l.aptSeq, l]));

  let missingLocationFeature = 0;
  let divergent = 0;
  for (const apt of repSet) {
    const loc = locMap.get(apt.aptSeq);
    if (!loc) {
      missingLocationFeature++;
      continue;
    }
    if (apt.latitude == null || apt.longitude == null) continue;
    const distM = haversineMeters(apt.latitude, apt.longitude, loc.latitude, loc.longitude);
    if (distM > 200) {
      divergent++;
      addFinding({
        severity: 'P1_COVERAGE',
        category: 'MAP_IDENTITY_DIVERGENCE',
        apartment: apt.name,
        aptSeq: apt.aptSeq,
        field: 'coordinates(ApartmentMaster vs ApartmentLocationFeature)',
        expected: '두 좌표 소스가 동일 지점(오차 <200m)',
        actual: `거리 차이 ${distM.toFixed(0)}m`,
        reproducible: true,
        recommendedNextStep: '두 테이블이 서로 다른 시점/geocoding 결과를 갖는지 확인, 지도 마커는 ApartmentLocationFeature를 쓰므로 최신값 우선순위 검토',
      });
    }
  }

  return { checked: repSet.length, missingLocationFeature, divergent };
}

// ────────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(72));
  console.log('BUSAN DATA / UX AUTOMATED QA V1 (read-only)');
  console.log('='.repeat(72));
  console.log(`옵션: ${JSON.stringify(OPT)}`);

  // ── L1 + L2 + IDENTITY + UNIT MASTER (DB 전체 또는 --district) ──
  const rows = await loadMasterRows(OPT.district);
  console.log(`\n[스캔 범위] ApartmentMaster: ${rows.length}건${OPT.district ? ` (district=${OPT.district})` : '(부산 전체)'}`);

  const coverage = computeCoverage(rows);
  console.log('\n[L1 DATABASE COVERAGE]');
  for (const [label, v] of Object.entries(coverage.fields)) {
    console.log(`  ${label.padEnd(22, ' ')}: ${v.present}/${coverage.total} (${v.pct})`);
  }
  console.log('  basicSpecSource 분포:', JSON.stringify(coverage.bySource));

  const consistency = runConsistencyChecks(rows);
  console.log('\n[L2 DATA CONSISTENCY]');
  console.log(`  PASS ${consistency.pass}  WARN ${consistency.warn}  FAIL ${consistency.fail}`);

  console.log('\n[구/군별 breakdown] (총 단지 / 세대수 coverage / 주차 coverage)');
  for (const d of coverage.byDistrict) {
    console.log(`  ${d.name.padEnd(6, ' ')}(${d.sggCd}): 총 ${d.total}건, 세대수 ${pct(d.household, d.total)}, 주차 ${pct(d.parking, d.total)}, FAR ${pct(d.far, d.total)}, BCR ${pct(d.bcr, d.total)}`);
  }

  const identity = await runIdentityQa(rows);
  console.log('\n[IDENTITY QA]');
  console.log(`  aptSeq 중복: ${identity.aptSeqDuplicates}건`);
  console.log(`  normalizedName collision 그룹(다른 구/동): ${identity.normalizedNameCollisionGroups}건`);
  console.log(`  legacy Apartment name-only fallback 위험(실측): ${identity.legacyNameOnlyCollisions}건`);

  const unitMaster = await runUnitMasterQa();
  console.log('\n[UNIT MASTER QA] (legacy Apartment 기준, DB-only)');
  console.log(`  unitType 총 ${unitMaster.totalUnitTypeRows}건 / Unit Master 보유 단지 ${unitMaster.apartmentsWithUnitMaster}건`);
  console.log(`  representativePyeongSource=UNKNOWN인데 값 존재: ${unitMaster.untrustedPyeongCount}건`);
  console.log(`  근접(diff<0.5) 별도 exclusiveArea 쌍(정상 — merge 안 됨 확인용): ${unitMaster.closeButDistinctAreaPairs}건`);

  // ── 대표 SET + L3/L4 API QA ──
  let repSet: RepApartment[] = [];
  let searchResults: Awaited<ReturnType<typeof runSearchQa>> = [];
  let mapQa: Awaited<ReturnType<typeof runMapQa>> | null = null;

  if (!OPT.noApi) {
    repSet = await buildRepresentativeSet(OPT.quick, OPT.aptSeq);
    console.log(`\n[REPRESENTATIVE SET] ${repSet.length}건 (fixture ${repSet.filter((r) => r.isFixture).length}건 포함)`);

    console.log(`\n[L3/L4 API QA] base-url=${OPT.baseUrl}`);
    // 외부 공공데이터 API(MOLIT/BuildingHUB/Kakao)에 과도한 동시 부하를 주지 않도록
    // 순차 실행한다(§21 — 이번 STEP은 성능 최적화가 아니라 baseline 측정이 목적).
    for (const apt of repSet) {
      process.stdout.write(`  - ${apt.label}(${apt.name}, aptSeq=${apt.aptSeq}) ... `);
      const t0 = Date.now();
      try {
        await checkBasicSpecApi(apt);
        await checkTradeApi(apt);
        await checkUnitMasterApi(apt);
        console.log(`done (${Date.now() - t0}ms)`);
      } catch (e: any) {
        console.log(`ERROR: ${e?.message || e}`);
        addFinding({
          severity: 'P0_BROKEN_FLOW',
          category: 'L3_API_CONTRACT_EXCEPTION',
          apartment: apt.name,
          aptSeq: apt.aptSeq,
          actual: e?.message || String(e),
          reproducible: true,
          recommendedNextStep: '스크립트 예외 재현 후 원인 분석',
        });
      }
    }

    console.log('\n[SEARCH QA]');
    searchResults = await runSearchQa();
    for (const r of searchResults) {
      console.log(`  "${r.query}": regions=${r.regions}, apartments=${r.apartments}, dup=${r.duplicateAptSeq}, ${r.ms}ms`);
    }

    console.log('\n[MAP QA] (search apartments[] 좌표 vs ApartmentMaster 좌표 교차검증)');
    mapQa = await runMapQa(repSet);
    console.log(`  checked=${mapQa.checked}, ApartmentLocationFeature 결측=${mapQa.missingLocationFeature}, 좌표 괴리(>200m)=${mapQa.divergent}`);
  } else {
    console.log('\n[L3/L4/SEARCH/MAP QA] --no-api 옵션으로 생략됨 (MANUAL_REQUIRED/SOURCE_LIMITATION)');
    addFinding({
      severity: 'SOURCE_LIMITATION',
      category: 'API_QA_SKIPPED',
      actual: '--no-api 옵션으로 L3/L4/SEARCH/MAP 생략',
      reproducible: true,
      recommendedNextStep: '--no-api 없이 재실행(로컬 dev 서버 필요)',
    });
  }

  // ── UI 시각 회귀는 이 환경에 browser automation이 없어 자동화 불가 ──
  addFinding({
    severity: 'SOURCE_LIMITATION',
    category: 'UI_VISUAL_REGRESSION_MANUAL_REQUIRED',
    actual: '이 실행 환경엔 browser automation 인프라가 없어 UI 렌더링/시각 회귀는 자동 검사하지 못함',
    reproducible: false,
    recommendedNextStep: 'MANUAL_REQUIRED — 사람이 대표 단지 상세페이지를 직접 확인하거나, 별도 세션에서 claude-in-chrome 등으로 보완',
  });

  // ── 분류/요약 ──
  const bySeverity: Record<Severity, number> = {
    P0_DATA_TRUST: 0,
    P0_BROKEN_FLOW: 0,
    P1_COVERAGE: 0,
    P1_PERFORMANCE: 0,
    P2_UI: 0,
    SOURCE_LIMITATION: 0,
  };
  for (const f of findings) bySeverity[f.severity]++;

  console.log('\n' + '='.repeat(72));
  console.log('HUMAN SUMMARY');
  console.log('='.repeat(72));
  console.log(`BUSAN APARTMENTS: ${coverage.total}`);
  console.log(`DATA TRUST(L2)   PASS ${consistency.pass}  FAIL ${consistency.fail}`);
  console.log(`BASIC SPECS      FAR ${coverage.fields.floorAreaRatio.pct}  BCR ${coverage.fields.buildingCoverageRatio.pct}  PARKING ${coverage.fields.parkingCount.pct}  HOUSEHOLD ${coverage.fields.householdCount.pct}`);
  console.log(`FINDINGS BY SEVERITY: ${JSON.stringify(bySeverity)}`);

  const topP0 = findings.filter((f) => f.severity === 'P0_DATA_TRUST' || f.severity === 'P0_BROKEN_FLOW').slice(0, 10);
  console.log(`\nTOP P0 ISSUES (최대 10건):`);
  topP0.forEach((f, i) => {
    console.log(`  ${i + 1}. [${f.category}] ${f.apartment || ''}(${f.aptSeq || '-'}) ${f.field || ''}: ${f.actual || ''}`);
  });

  if (perfSamples.length > 0) {
    const searchSamples = perfSamples.filter((p) => p.label.startsWith('search:'));
    const infoSamples = perfSamples.filter((p) => p.label.startsWith('info:'));
    const tradeSamples = perfSamples.filter((p) => p.label.startsWith('trade:'));
    const avg = (arr: PerfSample[]) => (arr.length ? Math.round(arr.reduce((s, p) => s + p.ms, 0) / arr.length) : null);
    console.log('\nPERFORMANCE BASELINE');
    console.log(`  search avg: ${avg(searchSamples)}ms (n=${searchSamples.length})`);
    console.log(`  info avg:   ${avg(infoSamples)}ms (n=${infoSamples.length})`);
    console.log(`  trade avg:  ${avg(tradeSamples)}ms (n=${tradeSamples.length})`);
  }

  // ── 알려진 회귀 fixture 재검증 요약 ──
  console.log('\nKNOWN REGRESSION FIXTURES');
  for (const fx of KNOWN_REGRESSIONS) {
    const related = findings.filter((f) => f.aptSeq === fx.aptSeq);
    console.log(`  ${fx.label}(${fx.aptSeq}): 관련 finding ${related.length}건${related.length === 0 ? ' — PASS' : ''}`);
  }

  // ── RELEASE GATE ──
  const releaseGate =
    bySeverity.P0_DATA_TRUST > 0 || bySeverity.P0_BROKEN_FLOW > 0
      ? bySeverity.P0_DATA_TRUST + bySeverity.P0_BROKEN_FLOW > 20
        ? 'BLOCKED'
        : 'LIMITED'
      : 'READY';
  console.log(`\nRELEASE_GATE = ${releaseGate} (P0_DATA_TRUST=${bySeverity.P0_DATA_TRUST}, P0_BROKEN_FLOW=${bySeverity.P0_BROKEN_FLOW})`);

  // ── JSON 산출물 ──
  if (OPT.json) {
    const outDir = path.resolve(__dirname, '../tmp/qa');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'BUSAN_DATA_UX_QA_V1.json');
    const payload = {
      generatedAt: new Date().toISOString(),
      options: OPT,
      summary: {
        busanTotal: coverage.total,
        consistency,
        bySeverity,
        releaseGate,
      },
      coverage,
      identity,
      unitMaster,
      representativeSet: repSet.map((r) => ({ label: r.label, aptSeq: r.aptSeq, name: r.name, sggCd: r.sggCd, umdName: r.umdName, isFixture: r.isFixture })),
      searchResults,
      mapQa,
      performance: perfSamples,
      failures: findings.filter((f) => f.severity === 'P0_DATA_TRUST' || f.severity === 'P0_BROKEN_FLOW'),
      warnings: findings.filter((f) => f.severity !== 'P0_DATA_TRUST' && f.severity !== 'P0_BROKEN_FLOW'),
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`\n[JSON] ${outPath} 저장됨(커밋 대상 아님)`);
  }

  console.log('\n' + '='.repeat(72));
  console.log('QA 종료. DB 쓰기 없음(read-only, 단 /api/apt/[name]/info의 기존 lazy upsert 동작은 그 라우트 자체 고유 동작).');
  console.log('='.repeat(72));
}

main()
  .catch((e) => {
    console.error('[qa] 오류:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
