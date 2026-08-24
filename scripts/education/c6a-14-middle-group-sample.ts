import { readFileSync } from 'fs';
import * as turf from '@turf/turf';
import { PrismaClient } from '@prisma/client';
import { loadAllZones, filterBusan, parseLinkageCsv, ZoneRecord } from './lib/attendance-zone-source';

const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';
const CSV_PATH = 'D:/anti2/aaa/schoolzone-data/한국교육시설안전원_학교학구도연계정보_20260320.csv';
const prisma = new PrismaClient();

function toFeature(z: ZoneRecord) {
  return z.geometry.type === 'Polygon' ? turf.polygon(z.geometry.coordinates) : turf.multiPolygon(z.geometry.coordinates);
}

async function main() {
  const midAll = await loadAllZones(`${BASE}/middle/중학교학교군.shp`, `${BASE}/middle/중학교학교군.dbf`);
  const midBusan = filterBusan(midAll);
  console.log('부산 중학교 학교군 zone 수:', midBusan.length);

  const csvRows = parseLinkageCsv(readFileSync(CSV_PATH));
  const busanMidZoneIds = new Set(midBusan.map((z) => z.zoneId));
  const busanMidLinks = csvRows.filter((r) => busanMidZoneIds.has(r.zoneId) && r.schoolLevelRaw === '중학교');
  console.log('중학교 linkage rows:', busanMidLinks.length);

  const linksByZone = new Map<string, typeof busanMidLinks>();
  for (const r of busanMidLinks) linksByZone.set(r.zoneId, [...(linksByZone.get(r.zoneId) || []), r]);

  console.log('\n=== 학교군별 소속 중학교 수 분포 ===');
  const sizeDist = new Map<number, number>();
  for (const [, links] of linksByZone) sizeDist.set(links.length, (sizeDist.get(links.length) || 0) + 1);
  console.log(Object.fromEntries([...sizeDist.entries()].sort((a, b) => a[0] - b[0])));

  console.log('\n=== 학교군 상세 샘플 5개 ===');
  let shown = 0;
  for (const z of midBusan) {
    if (shown >= 5) break;
    const links = linksByZone.get(z.zoneId) || [];
    console.log(`${z.zoneName}(${z.zoneId}): ${links.map((l) => l.schoolName).join(', ')}`);
    shown++;
  }

  // 10개 부산 아파트 샘플 lookup
  const apartments = await prisma.apartmentMaster.findMany({
    where: { sggCd: { startsWith: '26' }, latitude: { not: null }, longitude: { not: null } },
    select: { aptSeq: true, name: true, sigungu: true, umdName: true, sggCd: true, latitude: true, longitude: true },
    orderBy: { id: 'asc' },
  });
  // 16개 구·군에서 최대한 고르게 10개 추출
  const byDistrict = new Map<string, typeof apartments>();
  for (const a of apartments) byDistrict.set(a.sggCd!, [...(byDistrict.get(a.sggCd!) || []), a]);
  const sampleApts: typeof apartments = [];
  for (const [, list] of byDistrict) {
    if (sampleApts.length >= 10) break;
    if (list.length > 0) sampleApts.push(list[0]);
  }

  console.log('\n=== 중학교 학교군 10개 아파트 샘플 lookup ===');
  for (const apt of sampleApts.slice(0, 10)) {
    const pt = turf.point([apt.longitude!, apt.latitude!]);
    let matched: ZoneRecord | null = null;
    for (const z of midBusan) {
      const feature = toFeature(z);
      if (turf.booleanPointInPolygon(pt, feature as any)) {
        matched = z;
        break;
      }
    }
    if (matched) {
      const links = linksByZone.get(matched.zoneId) || [];
      console.log(`${apt.name}(${apt.sigungu} ${apt.umdName}) -> ${matched.zoneName}: [${links.map((l) => l.schoolName).join(', ')}]`);
    } else {
      console.log(`${apt.name}(${apt.sigungu} ${apt.umdName}) -> NO_MATCH`);
    }
  }

  await prisma.$disconnect();
}
main().catch(console.error);
