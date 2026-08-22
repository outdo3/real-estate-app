import { readFileSync, writeFileSync } from 'fs';
import * as turf from '@turf/turf';
import { PrismaClient } from '@prisma/client';
import { loadAllZones, filterBusan, parseLinkageCsv, parseZoneSchoolNameTokens, ZoneRecord } from './lib/attendance-zone-source';
import { resolveAllZoneSchools, type CanonicalSchool, type ZoneSchoolLink, type IdentityMatch } from './lib/zone-school-identity-resolver';
import { matchPointToZones, classifyApartmentZoneStatus, type ZoneIdentitySummary } from './lib/attendance-zone-matcher';

const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';
const CSV_PATH = 'D:/anti2/aaa/schoolzone-data/한국교육시설안전원_학교학구도연계정보_20260320.csv';
const SCRATCHPAD = 'C:/Users/123/AppData/Local/Temp/claude/D--anti2-aaa-real-estate-app/d12c257a-d49f-44c6-b1f1-1c67dc226310/scratchpad';

const prisma = new PrismaClient();

type ApartmentStatus =
  | 'MATCHED_SINGLE'
  | 'MATCHED_SHARED'
  | 'OVERLAP'
  | 'NO_MATCH'
  | 'COORDINATE_MISSING'
  | 'IDENTITY_UNRESOLVED';

interface ZoneGroup {
  zoneId: string;
  zoneName: string;
  isShared: boolean;
  isAsymmetric: boolean;
  lawdCd: string;
  parts: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>[];
  bbox: [number, number, number, number]; // 전체 parts를 감싸는 bbox — 사전 필터용(정확도 손실 없음)
  schoolTokenOrder: string[]; // zoneName 파싱 순서(참고용, §확정 아님)
}

function toFeature(z: ZoneRecord) {
  return z.geometry.type === 'Polygon' ? turf.polygon(z.geometry.coordinates) : turf.multiPolygon(z.geometry.coordinates);
}

function groupZonesById(zones: ZoneRecord[]): Map<string, ZoneGroup> {
  const map = new Map<string, ZoneGroup>();
  for (const z of zones) {
    const g = map.get(z.zoneId);
    const feature = toFeature(z);
    if (g) {
      g.parts.push(feature);
      const b = turf.bbox(feature);
      g.bbox = [Math.min(g.bbox[0], b[0]), Math.min(g.bbox[1], b[1]), Math.max(g.bbox[2], b[2]), Math.max(g.bbox[3], b[3])];
    } else {
      map.set(z.zoneId, {
        zoneId: z.zoneId,
        zoneName: z.zoneName,
        isShared: z.isShared,
        isAsymmetric: z.isAsymmetric,
        lawdCd: z.lawdCd,
        parts: [feature],
        bbox: turf.bbox(feature) as [number, number, number, number],
        schoolTokenOrder: parseZoneSchoolNameTokens(z.zoneName),
      });
    }
  }
  return map;
}

async function main() {
  console.log('[1/6] SHP 로드 및 부산 필터링');
  const elemAll = await loadAllZones(`${BASE}/elementary/초등학교통학구역.shp`, `${BASE}/elementary/초등학교통학구역.dbf`);
  const elemBusan = filterBusan(elemAll);
  const zoneGroups = groupZonesById(elemBusan);
  console.log('  busan elementary zone records:', elemBusan.length, '-> unique zoneId:', zoneGroups.size);

  console.log('[2/6] linkage CSV 로드 및 부산 초등 zoneId로 필터링');
  const csvRows = parseLinkageCsv(readFileSync(CSV_PATH));
  const busanZoneIds = new Set(zoneGroups.keys());
  const busanElemLinks = csvRows.filter((r) => busanZoneIds.has(r.zoneId) && r.schoolLevelRaw === '초등학교');
  console.log('  matched linkage rows:', busanElemLinks.length);
  // zoneId -> school 개수 sanity check (§7 shared zone 검증용)
  const linksByZone = new Map<string, typeof busanElemLinks>();
  for (const r of busanElemLinks) linksByZone.set(r.zoneId, [...(linksByZone.get(r.zoneId) || []), r]);

  console.log('[3/6] canonical School(부산) 로드 및 identity resolve');
  const canonicalRaw = await prisma.school.findMany({
    where: { sigunguCode: { startsWith: '26' }, schoolLevel: '초등학교' },
    select: { id: true, neisSchoolCode: true, schoolName: true, schoolLevel: true, sigunguCode: true, latitude: true, longitude: true },
  });
  const canonical = canonicalRaw as CanonicalSchool[];

  const zoneLinks: ZoneSchoolLink[] = busanElemLinks.map((r) => ({
    zoneId: r.zoneId,
    schoolId: r.schoolId,
    schoolName: r.schoolName,
    schoolLevelRaw: r.schoolLevelRaw,
    lawdCd: zoneGroups.get(r.zoneId)!.lawdCd,
  }));
  const identityResults = resolveAllZoneSchools(zoneLinks, canonical);
  const byConfidence = { HIGH: 0, MEDIUM: 0, LOW: 0, NO_MATCH: 0 };
  for (const r of identityResults) byConfidence[r.confidence]++;
  console.log('  identity 결과:', byConfidence);

  const identityByLink = new Map<string, IdentityMatch>();
  for (const r of identityResults) identityByLink.set(`${r.link.zoneId}::${r.link.schoolId}`, r);

  console.log('[4/6] ApartmentMaster(부산) 로드');
  const apartments = await prisma.apartmentMaster.findMany({
    where: { sggCd: { startsWith: '26' } },
    select: { id: true, aptSeq: true, name: true, sigungu: true, umdName: true, sggCd: true, latitude: true, longitude: true },
  });
  console.log('  총 부산 아파트:', apartments.length);

  console.log('[5/6] point-in-polygon 실행');
  const zoneGroupList = [...zoneGroups.values()];
  // 자체교차(invalid) geometry는 turf.booleanPointInPolygon에도 여전히 입력 가능하나
  // 결과 신뢰도가 낮음 — 결과 레코드에 geometryInvalid 플래그로 별도 표기.
  const invalidZoneIds = new Set(['Z000100598', 'Z000100618', 'Z000100772']); // 장림초/개포초/신덕초(§geometry audit 실측)

  const results: any[] = [];
  const districtStats = new Map<string, { total: number; matched: number }>();

  for (const apt of apartments) {
    const lawdCd = apt.sggCd || '';
    const dStat = districtStats.get(lawdCd) || { total: 0, matched: 0 };
    dStat.total++;
    districtStats.set(lawdCd, dStat);

    if (apt.latitude == null || apt.longitude == null) {
      results.push({ aptSeq: apt.aptSeq, aptName: apt.name, sigungu: apt.sigungu, dong: apt.umdName, status: 'COORDINATE_MISSING' as ApartmentStatus, zones: [] });
      continue;
    }
    const matchedZones = matchPointToZones(apt.longitude, apt.latitude, zoneGroupList);

    if (matchedZones.length === 0) {
      results.push({ aptSeq: apt.aptSeq, aptName: apt.name, sigungu: apt.sigungu, dong: apt.umdName, status: 'NO_MATCH' as ApartmentStatus, zones: [] });
      continue;
    }

    dStat.matched++;

    const zoneDetails = matchedZones.map((zid) => {
      const zg = zoneGroups.get(zid)!;
      const links = linksByZone.get(zid) || [];
      const schools = links.map((l) => {
        const im = identityByLink.get(`${zid}::${l.schoolId}`);
        return {
          schoolName: l.schoolName,
          schoolId: l.schoolId,
          identityConfidence: im?.confidence ?? 'NO_MATCH',
          matchedSchoolId: im?.matched?.id ?? null,
        };
      });
      return {
        zoneId: zid,
        zoneName: zg.zoneName,
        isShared: zg.isShared,
        isAsymmetric: zg.isAsymmetric,
        geometryInvalid: invalidZoneIds.has(zid),
        schools,
      };
    });

    const zoneSummaries = new Map<string, ZoneIdentitySummary>(
      zoneDetails.map((zd) => [zd.zoneId, { isShared: zd.isShared, allSchoolsHighConfidence: zd.schools.every((s) => s.identityConfidence === 'HIGH') }])
    );
    const status = classifyApartmentZoneStatus(matchedZones, zoneSummaries) as ApartmentStatus;

    results.push({
      aptSeq: apt.aptSeq,
      aptName: apt.name,
      sigungu: apt.sigungu,
      dong: apt.umdName,
      lawdCd,
      status,
      zones: zoneDetails,
    });
  }

  console.log('[6/6] 집계');
  const statusCounts: Record<string, number> = {};
  for (const r of results) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  console.log('전체 상태 분포:', statusCounts);
  console.log('16개 구·군별:', JSON.stringify(Object.fromEntries(districtStats), null, 1));

  writeFileSync(`${SCRATCHPAD}/c6a-pipeline-results.json`, JSON.stringify({ results, statusCounts, districtStats: Object.fromEntries(districtStats), identityByConfidence: byConfidence }, null, 1));
  console.log('결과 저장:', `${SCRATCHPAD}/c6a-pipeline-results.json`);

  await prisma.$disconnect();
}
main().catch(console.error);
