// SCHOOL V2-C6-B — 최종 파이프라인. C6-A의 순수 lib(geometry 매칭 + school identity
// resolver)은 수정하지 않고 그대로 재사용하며, 그 위에 §C6-B-5의
// attendance-zone-status.ts(최종 user-facing status 변환)를 적용해 부산 3,402개
// 아파트 전체 결과를 versioned local artifact로 생성한다. DB write 없음(읽기 전용).
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import * as turf from '@turf/turf';
import { PrismaClient } from '@prisma/client';
import { loadAllZones, filterBusan, parseLinkageCsv, parseZoneSchoolNameTokens, ZoneRecord } from './lib/attendance-zone-source';
import { resolveAllZoneSchools, type CanonicalSchool, type ZoneSchoolLink, type IdentityMatch } from './lib/zone-school-identity-resolver';
import { matchPointToZones } from './lib/attendance-zone-matcher';
import { resolveFinalAttendanceStatus, type ZoneMatchInput } from './lib/attendance-zone-status';

const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';
const CSV_PATH = 'D:/anti2/aaa/schoolzone-data/한국교육시설안전원_학교학구도연계정보_20260320.csv';
const SOURCE_DATE = '2026-03-20';
const SOURCE_NAME = '학구도안내서비스(한국교육시설안전원)';
const RESOLVER_VERSION = 'school-v2-c6b-1.0.0';
const INVALID_ELEMENTARY_ZONE_IDS = new Set(['Z000100598', 'Z000100618', 'Z000100772']); // 장림초/개포초/신덕초(§3 실측)
const OUT_DIR = `${__dirname}/../../data/education/attendance-zone`;
const OUT_FILE = `${OUT_DIR}/busan-attendance-zone-20260320.json`;

const prisma = new PrismaClient();

function toFeature(z: ZoneRecord) {
  return z.geometry.type === 'Polygon' ? turf.polygon(z.geometry.coordinates) : turf.multiPolygon(z.geometry.coordinates);
}

interface ZoneGroup {
  zoneId: string;
  zoneName: string;
  isShared: boolean;
  isAsymmetric: boolean;
  lawdCd: string;
  parts: any[];
  bbox: [number, number, number, number];
}

function groupZonesById(zones: ZoneRecord[]): Map<string, ZoneGroup> {
  const map = new Map<string, ZoneGroup>();
  for (const z of zones) {
    const feature = toFeature(z);
    const g = map.get(z.zoneId);
    if (g) {
      g.parts.push(feature);
      const b = turf.bbox(feature);
      g.bbox = [Math.min(g.bbox[0], b[0]), Math.min(g.bbox[1], b[1]), Math.max(g.bbox[2], b[2]), Math.max(g.bbox[3], b[3])];
    } else {
      map.set(z.zoneId, { zoneId: z.zoneId, zoneName: z.zoneName, isShared: z.isShared, isAsymmetric: z.isAsymmetric, lawdCd: z.lawdCd, parts: [feature], bbox: turf.bbox(feature) as [number, number, number, number] });
    }
  }
  return map;
}

type SchoolOut = { schoolId: number | null; neisSchoolCode: string | null; schoolName: string; identityConfidence: IdentityMatch['confidence'] };

async function main() {
  console.log('[1/7] 초등 zone 로드');
  const elemAll = await loadAllZones(`${BASE}/elementary/초등학교통학구역.shp`, `${BASE}/elementary/초등학교통학구역.dbf`);
  const elemBusan = filterBusan(elemAll);
  const elemZoneGroups = groupZonesById(elemBusan);

  console.log('[2/7] 중학교 학교군 zone 로드');
  const midAll = await loadAllZones(`${BASE}/middle/중학교학교군.shp`, `${BASE}/middle/중학교학교군.dbf`);
  const midBusan = filterBusan(midAll);
  const midZoneGroups = groupZonesById(midBusan);

  console.log('[3/7] linkage CSV 로드');
  const csvRows = parseLinkageCsv(readFileSync(CSV_PATH));
  const elemZoneIds = new Set(elemZoneGroups.keys());
  const midZoneIds = new Set(midZoneGroups.keys());
  const elemLinks = csvRows.filter((r) => elemZoneIds.has(r.zoneId) && r.schoolLevelRaw === '초등학교');
  const midLinks = csvRows.filter((r) => midZoneIds.has(r.zoneId) && r.schoolLevelRaw === '중학교');
  const elemLinksByZone = new Map<string, typeof elemLinks>();
  for (const r of elemLinks) elemLinksByZone.set(r.zoneId, [...(elemLinksByZone.get(r.zoneId) || []), r]);
  const midLinksByZone = new Map<string, typeof midLinks>();
  for (const r of midLinks) midLinksByZone.set(r.zoneId, [...(midLinksByZone.get(r.zoneId) || []), r]);

  console.log('[4/7] canonical School 로드 및 identity resolve(초등+중학교)');
  const canonicalRaw = await prisma.school.findMany({
    where: { sigunguCode: { startsWith: '26' } },
    select: { id: true, neisSchoolCode: true, schoolName: true, schoolLevel: true, sigunguCode: true, latitude: true, longitude: true },
  });
  const canonical = canonicalRaw as CanonicalSchool[];

  const elemZoneLinks: ZoneSchoolLink[] = elemLinks.map((r) => ({ zoneId: r.zoneId, schoolId: r.schoolId, schoolName: r.schoolName, schoolLevelRaw: r.schoolLevelRaw, lawdCd: elemZoneGroups.get(r.zoneId)!.lawdCd }));
  const midZoneLinks: ZoneSchoolLink[] = midLinks.map((r) => ({ zoneId: r.zoneId, schoolId: r.schoolId, schoolName: r.schoolName, schoolLevelRaw: r.schoolLevelRaw, lawdCd: midZoneGroups.get(r.zoneId)!.lawdCd }));
  const elemIdentity = resolveAllZoneSchools(elemZoneLinks, canonical);
  const midIdentity = resolveAllZoneSchools(midZoneLinks, canonical);
  const elemIdentityByLink = new Map<string, IdentityMatch>();
  for (const r of elemIdentity) elemIdentityByLink.set(`${r.link.zoneId}::${r.link.schoolId}`, r);
  const midIdentityByLink = new Map<string, IdentityMatch>();
  for (const r of midIdentity) midIdentityByLink.set(`${r.link.zoneId}::${r.link.schoolId}`, r);

  function schoolsOutFor(zid: string, linksByZone: Map<string, typeof elemLinks>, identityByLink: Map<string, IdentityMatch>): SchoolOut[] {
    const links = linksByZone.get(zid) || [];
    return links.map((l) => {
      const im = identityByLink.get(`${zid}::${l.schoolId}`);
      return { schoolId: im?.matched?.id ?? null, neisSchoolCode: im?.matched?.neisSchoolCode ?? null, schoolName: l.schoolName, identityConfidence: im?.confidence ?? 'NO_MATCH' };
    });
  }

  console.log('[5/7] ApartmentMaster(부산) 로드');
  const apartments = await prisma.apartmentMaster.findMany({
    where: { sggCd: { startsWith: '26' } },
    select: { aptSeq: true, name: true, sigungu: true, umdName: true, sggCd: true, latitude: true, longitude: true },
  });

  console.log('[6/7] point-in-polygon + 최종 status 계산 (', apartments.length, '건)');
  const elemZoneGroupList = [...elemZoneGroups.values()];
  const midZoneGroupList = [...midZoneGroups.values()];

  const results: any[] = [];
  const statusCounts = { elementary: {} as Record<string, number>, middle: {} as Record<string, number> };

  for (const apt of apartments) {
    let elementaryZoneMatch: ZoneMatchInput;
    let elemZoneMeta: { zoneId: string; zoneName: string } | null = null;
    let middleZoneMatch: ZoneMatchInput;
    let midZoneMeta: { zoneId: string; zoneName: string } | null = null;

    if (apt.latitude == null || apt.longitude == null) {
      elementaryZoneMatch = { geometryStatus: 'COORDINATE_MISSING', isShared: false, isAsymmetric: false, geometryInvalid: false, schools: [] };
      middleZoneMatch = { geometryStatus: 'COORDINATE_MISSING', isShared: false, isAsymmetric: false, geometryInvalid: false, schools: [] };
    } else {
      const elemMatched = matchPointToZones(apt.longitude, apt.latitude, elemZoneGroupList);
      if (elemMatched.length === 0) {
        elementaryZoneMatch = { geometryStatus: 'NO_MATCH', isShared: false, isAsymmetric: false, geometryInvalid: false, schools: [] };
      } else if (elemMatched.length > 1) {
        elementaryZoneMatch = { geometryStatus: 'OVERLAP', isShared: false, isAsymmetric: false, geometryInvalid: false, schools: [] };
      } else {
        const zid = elemMatched[0];
        const zg = elemZoneGroups.get(zid)!;
        elemZoneMeta = { zoneId: zid, zoneName: zg.zoneName };
        elementaryZoneMatch = {
          geometryStatus: zg.isShared ? 'MATCHED_SHARED' : 'MATCHED_SINGLE',
          isShared: zg.isShared,
          isAsymmetric: zg.isAsymmetric,
          geometryInvalid: INVALID_ELEMENTARY_ZONE_IDS.has(zid),
          schools: schoolsOutFor(zid, elemLinksByZone, elemIdentityByLink),
        };
      }

      const midMatched = matchPointToZones(apt.longitude, apt.latitude, midZoneGroupList);
      if (midMatched.length === 0) {
        middleZoneMatch = { geometryStatus: 'NO_MATCH', isShared: false, isAsymmetric: false, geometryInvalid: false, schools: [] };
      } else if (midMatched.length > 1) {
        middleZoneMatch = { geometryStatus: 'OVERLAP', isShared: false, isAsymmetric: false, geometryInvalid: false, schools: [] };
      } else {
        const zid = midMatched[0];
        const zg = midZoneGroups.get(zid)!;
        midZoneMeta = { zoneId: zid, zoneName: zg.zoneName };
        middleZoneMatch = {
          geometryStatus: 'MATCHED_SINGLE', // 부산 중학교 학교군: HAKGUDO_GB=1 관측 0건(C6-A §4) — shared 아님
          isShared: false,
          isAsymmetric: false,
          geometryInvalid: false,
          schools: schoolsOutFor(zid, midLinksByZone, midIdentityByLink),
        };
      }
    }

    const elemFinal = resolveFinalAttendanceStatus(elementaryZoneMatch);
    const midFinal = resolveFinalAttendanceStatus(middleZoneMatch);
    statusCounts.elementary[elemFinal.status] = (statusCounts.elementary[elemFinal.status] || 0) + 1;
    statusCounts.middle[midFinal.status] = (statusCounts.middle[midFinal.status] || 0) + 1;

    results.push({
      aptSeq: apt.aptSeq,
      aptName: apt.name,
      sigungu: apt.sigungu,
      dong: apt.umdName,
      elementary: {
        status: elemFinal.status,
        reasonCode: elemFinal.reasonCode,
        zoneId: elemZoneMeta?.zoneId ?? null,
        zoneName: elemZoneMeta?.zoneName ?? null,
        zoneType: elementaryZoneMatch.isShared ? (elementaryZoneMatch.isAsymmetric ? 'JOINT_ASYMMETRIC' : 'JOINT_SYMMETRIC') : 'SINGLE',
        schools: elementaryZoneMatch.schools,
        sourceDate: SOURCE_DATE,
        sourceName: SOURCE_NAME,
      },
      middle: {
        status: midFinal.status,
        reasonCode: midFinal.reasonCode,
        zoneId: midZoneMeta?.zoneId ?? null,
        groupName: midZoneMeta?.zoneName ?? null,
        schools: middleZoneMatch.schools,
        sourceDate: SOURCE_DATE,
      },
    });
  }

  console.log('[7/7] artifact 저장');
  mkdirSync(OUT_DIR, { recursive: true });
  const checksum = createHash('sha256').update(JSON.stringify(results)).digest('hex');
  const artifact = {
    meta: {
      datasetVersion: 'busan-attendance-zone-20260320',
      sourceDate: SOURCE_DATE,
      sourceName: SOURCE_NAME,
      resolverVersion: RESOLVER_VERSION,
      generatedAt: new Date().toISOString(),
      totalApartments: apartments.length,
      checksum,
      legalNotice: '학교 배정 등 학구(통학구역)에 대한 정확한 사항은 관할 교육청(교육지원청)에 반드시 확인하시기 바랍니다.',
    },
    apartments: results,
  };
  writeFileSync(OUT_FILE, JSON.stringify(artifact)); // 3,402건 × 2개 학교급 — pretty-print 생략, 크기 절감
  console.log('elementary status 분포:', statusCounts.elementary);
  console.log('middle status 분포:', statusCounts.middle);
  console.log('저장 위치:', OUT_FILE, `(${apartments.length}건)`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
