import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { loadAllZones, filterBusan, parseLinkageCsv } from './lib/attendance-zone-source';
import { resolveAllZoneSchools, type CanonicalSchool, type ZoneSchoolLink } from './lib/zone-school-identity-resolver';

const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';
const CSV_PATH = 'D:/anti2/aaa/schoolzone-data/한국교육시설안전원_학교학구도연계정보_20260320.csv';
const prisma = new PrismaClient();

async function main() {
  const elemAll = await loadAllZones(`${BASE}/elementary/초등학교통학구역.shp`, `${BASE}/elementary/초등학교통학구역.dbf`);
  const elemBusan = filterBusan(elemAll);
  const zoneLawd = new Map(elemBusan.map(z => [z.zoneId, z.lawdCd]));
  const csvRows = parseLinkageCsv(readFileSync(CSV_PATH));
  const busanZoneIds = new Set(zoneLawd.keys());
  const busanElemLinks = csvRows.filter((r) => busanZoneIds.has(r.zoneId) && r.schoolLevelRaw === '초등학교');

  const canonicalRaw = await prisma.school.findMany({
    where: { sigunguCode: { startsWith: '26' }, schoolLevel: '초등학교' },
    select: { id: true, neisSchoolCode: true, schoolName: true, schoolLevel: true, sigunguCode: true, latitude: true, longitude: true },
  });
  const zoneLinks: ZoneSchoolLink[] = busanElemLinks.map((r) => ({
    zoneId: r.zoneId, schoolId: r.schoolId, schoolName: r.schoolName, schoolLevelRaw: r.schoolLevelRaw, lawdCd: zoneLawd.get(r.zoneId)!,
  }));
  const results = resolveAllZoneSchools(zoneLinks, canonicalRaw as CanonicalSchool[]);
  const noMatch = results.filter(r => r.confidence === 'NO_MATCH');
  console.log('NO_MATCH count:', noMatch.length);
  console.log(JSON.stringify(noMatch.map(r => ({ schoolName: r.link.schoolName, lawdCd: r.link.lawdCd, zoneId: r.link.zoneId, reasons: r.reasons })), null, 1));
  await prisma.$disconnect();
}
main().catch(console.error);
