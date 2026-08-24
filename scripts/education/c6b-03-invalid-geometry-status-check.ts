// SCHOOL V2-C6-B §2 — invalid geometry(장림초/개포초/신덕초) 25건이 현재
// classifyApartmentZoneStatus()에서 실제로 어떤 status를 받는지 확인(geometryInvalid
// 플래그가 최종 status 계산에 반영되는지 여부가 핵심 질문).
import { readFileSync } from 'fs';
import * as turf from '@turf/turf';
import { PrismaClient } from '@prisma/client';
import { loadAllZones, filterBusan, parseLinkageCsv, ZoneRecord } from './lib/attendance-zone-source';
import { resolveAllZoneSchools, type CanonicalSchool, type ZoneSchoolLink } from './lib/zone-school-identity-resolver';
import { matchPointToZones, classifyApartmentZoneStatus, type ZoneIdentitySummary } from './lib/attendance-zone-matcher';

const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';
const CSV_PATH = 'D:/anti2/aaa/schoolzone-data/한국교육시설안전원_학교학구도연계정보_20260320.csv';
const prisma = new PrismaClient();
const INVALID_ZONE_IDS = new Set(['Z000100598', 'Z000100618', 'Z000100772']);

function toFeature(z: ZoneRecord) {
  return z.geometry.type === 'Polygon' ? turf.polygon(z.geometry.coordinates) : turf.multiPolygon(z.geometry.coordinates);
}

async function main() {
  const elemAll = await loadAllZones(`${BASE}/elementary/초등학교통학구역.shp`, `${BASE}/elementary/초등학교통학구역.dbf`);
  const elemBusan = filterBusan(elemAll);
  const zoneGroups = new Map<string, { zoneId: string; zoneName: string; isShared: boolean; lawdCd: string; parts: any[]; bbox: [number, number, number, number] }>();
  for (const z of elemBusan) {
    const feature = toFeature(z);
    const g = zoneGroups.get(z.zoneId);
    if (g) { g.parts.push(feature); const b = turf.bbox(feature); g.bbox = [Math.min(g.bbox[0], b[0]), Math.min(g.bbox[1], b[1]), Math.max(g.bbox[2], b[2]), Math.max(g.bbox[3], b[3])]; }
    else zoneGroups.set(z.zoneId, { zoneId: z.zoneId, zoneName: z.zoneName, isShared: z.isShared, lawdCd: z.lawdCd, parts: [feature], bbox: turf.bbox(feature) as [number, number, number, number] });
  }

  const csvRows = parseLinkageCsv(readFileSync(CSV_PATH));
  const busanZoneIds = new Set(zoneGroups.keys());
  const busanElemLinks = csvRows.filter((r) => busanZoneIds.has(r.zoneId) && r.schoolLevelRaw === '초등학교');
  const linksByZone = new Map<string, typeof busanElemLinks>();
  for (const r of busanElemLinks) linksByZone.set(r.zoneId, [...(linksByZone.get(r.zoneId) || []), r]);

  const canonicalRaw = await prisma.school.findMany({ where: { sigunguCode: { startsWith: '26' }, schoolLevel: '초등학교' }, select: { id: true, neisSchoolCode: true, schoolName: true, schoolLevel: true, sigunguCode: true, latitude: true, longitude: true } });
  const canonical = canonicalRaw as CanonicalSchool[];
  const zoneLinks: ZoneSchoolLink[] = busanElemLinks.map((r) => ({ zoneId: r.zoneId, schoolId: r.schoolId, schoolName: r.schoolName, schoolLevelRaw: r.schoolLevelRaw, lawdCd: zoneGroups.get(r.zoneId)!.lawdCd }));
  const identityResults = resolveAllZoneSchools(zoneLinks, canonical);
  const identityByLink = new Map<string, typeof identityResults[number]>();
  for (const r of identityResults) identityByLink.set(`${r.link.zoneId}::${r.link.schoolId}`, r);

  console.log('--- invalid zone identity confidence ---');
  for (const zid of INVALID_ZONE_IDS) {
    const links = linksByZone.get(zid) || [];
    for (const l of links) {
      const im = identityByLink.get(`${zid}::${l.schoolId}`);
      console.log(zoneGroups.get(zid)!.zoneName, l.schoolName, '->', im?.confidence);
    }
  }

  const apartments = await prisma.apartmentMaster.findMany({ where: { sggCd: { startsWith: '26' } }, select: { aptSeq: true, name: true, latitude: true, longitude: true } });
  const zoneGroupList = [...zoneGroups.values()];
  console.log('--- 25건 현재 classifyApartmentZoneStatus() 결과 (geometryInvalid 미반영 여부 확인) ---');
  let matchedSingleCount = 0;
  for (const apt of apartments) {
    if (apt.latitude == null || apt.longitude == null) continue;
    const matched = matchPointToZones(apt.longitude, apt.latitude, zoneGroupList);
    const hitInvalid = matched.find((z) => INVALID_ZONE_IDS.has(z));
    if (!hitInvalid) continue;
    const zoneSummaries = new Map<string, ZoneIdentitySummary>();
    for (const zid of matched) {
      const links = linksByZone.get(zid) || [];
      const allHigh = links.every((l) => identityByLink.get(`${zid}::${l.schoolId}`)?.confidence === 'HIGH');
      zoneSummaries.set(zid, { isShared: zoneGroups.get(zid)!.isShared, allSchoolsHighConfidence: allHigh });
    }
    const status = classifyApartmentZoneStatus(matched, zoneSummaries);
    if (status === 'MATCHED_SINGLE') matchedSingleCount++;
    console.log(apt.aptSeq, apt.name, '-> currentStatus:', status, '(geometryInvalid=true, but not reflected above)');
  }
  console.log('MATCHED_SINGLE로 표시된 건수(geometryInvalid 미반영):', matchedSingleCount);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
