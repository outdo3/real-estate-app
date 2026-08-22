// SCHOOL V2-C6-B §1~4 — NO_MATCH 4건 / invalid geometry 25건 / 신연초 / MEDIUM 18건 실측 조사.
// 읽기 전용(DB write 없음). c6a-10과 동일 소스/lib 재사용.
import { readFileSync, writeFileSync } from 'fs';
import * as turf from '@turf/turf';
import { PrismaClient } from '@prisma/client';
import { loadAllZones, filterBusan, parseLinkageCsv, parseZoneSchoolNameTokens, ZoneRecord } from './lib/attendance-zone-source';
import { resolveAllZoneSchools, type CanonicalSchool, type ZoneSchoolLink } from './lib/zone-school-identity-resolver';
import { matchPointToZones } from './lib/attendance-zone-matcher';

const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';
const CSV_PATH = 'D:/anti2/aaa/schoolzone-data/한국교육시설안전원_학교학구도연계정보_20260320.csv';
const OUT = 'C:/Users/123/AppData/Local/Temp/claude/D--anti2-aaa-real-estate-app/f45f4ddc-dde9-4336-8431-b9ed696f0aed/scratchpad/c6b-exceptions.json';

const prisma = new PrismaClient();

function toFeature(z: ZoneRecord) {
  return z.geometry.type === 'Polygon' ? turf.polygon(z.geometry.coordinates) : turf.multiPolygon(z.geometry.coordinates);
}

async function main() {
  const elemAll = await loadAllZones(`${BASE}/elementary/초등학교통학구역.shp`, `${BASE}/elementary/초등학교통학구역.dbf`);
  const elemBusan = filterBusan(elemAll);

  const zoneGroups = new Map<string, { zoneId: string; zoneName: string; isShared: boolean; isAsymmetric: boolean; lawdCd: string; parts: any[]; bbox: [number, number, number, number] }>();
  for (const z of elemBusan) {
    const feature = toFeature(z);
    const g = zoneGroups.get(z.zoneId);
    if (g) {
      g.parts.push(feature);
      const b = turf.bbox(feature);
      g.bbox = [Math.min(g.bbox[0], b[0]), Math.min(g.bbox[1], b[1]), Math.max(g.bbox[2], b[2]), Math.max(g.bbox[3], b[3])];
    } else {
      zoneGroups.set(z.zoneId, { zoneId: z.zoneId, zoneName: z.zoneName, isShared: z.isShared, isAsymmetric: z.isAsymmetric, lawdCd: z.lawdCd, parts: [feature], bbox: turf.bbox(feature) as [number, number, number, number] });
    }
  }

  const csvRows = parseLinkageCsv(readFileSync(CSV_PATH));
  const busanZoneIds = new Set(zoneGroups.keys());
  const busanElemLinks = csvRows.filter((r) => busanZoneIds.has(r.zoneId) && r.schoolLevelRaw === '초등학교');

  const canonicalRaw = await prisma.school.findMany({
    where: { sigunguCode: { startsWith: '26' }, schoolLevel: '초등학교' },
    select: { id: true, neisSchoolCode: true, schoolName: true, schoolLevel: true, sigunguCode: true, latitude: true, longitude: true, isActive: true, address: true, dongName: true },
  });
  const canonical = canonicalRaw as unknown as CanonicalSchool[];

  const zoneLinks: ZoneSchoolLink[] = busanElemLinks.map((r) => ({
    zoneId: r.zoneId, schoolId: r.schoolId, schoolName: r.schoolName, schoolLevelRaw: r.schoolLevelRaw, lawdCd: zoneGroups.get(r.zoneId)!.lawdCd,
  }));
  const identityResults = resolveAllZoneSchools(zoneLinks, canonical);

  // ===== §3 신연초 조사 =====
  const shinyeonCsvRows = csvRows.filter((r) => r.schoolName.includes('신연초'));
  const shinyeonCanonical = await prisma.school.findMany({ where: { schoolName: { contains: '신연' } } });
  const shinyeonIdentity = identityResults.filter((r) => r.link.schoolName.includes('신연초'));
  const school664 = await prisma.school.findUnique({ where: { id: 664 } });

  // ===== §4 MEDIUM 18(129)건 상세 =====
  const mediumLinks = identityResults.filter((r) => r.confidence === 'MEDIUM');

  // ===== 아파트 pipeline (NO_MATCH 4건 + invalid-geometry 25건 조사용) =====
  const invalidZoneIds = new Set(['Z000100598', 'Z000100618', 'Z000100772']);
  const apartments = await prisma.apartmentMaster.findMany({
    where: { sggCd: { startsWith: '26' } },
    select: { id: true, aptSeq: true, name: true, sigungu: true, umdName: true, sggCd: true, latitude: true, longitude: true, roadAddress: true, jibunAddress: true },
  });

  const zoneGroupList = [...zoneGroups.values()];
  const noMatchApts: any[] = [];
  const invalidGeomApts: any[] = [];

  for (const apt of apartments) {
    if (apt.latitude == null || apt.longitude == null) continue;
    const matched = matchPointToZones(apt.longitude, apt.latitude, zoneGroupList);

    if (matched.length === 0) {
      // nearest zone 거리 계산(진단용, fallback 아님 — 어떤 status에도 쓰지 않음)
      const pt = turf.point([apt.longitude, apt.latitude]);
      let nearest: { zoneId: string; zoneName: string; distM: number } | null = null;
      for (const zg of zoneGroupList) {
        for (const part of zg.parts) {
          const boundary = turf.polygonToLine(part as any);
          const lines = boundary.type === 'FeatureCollection' ? boundary.features : [boundary];
          for (const line of lines) {
            const nearestPt = turf.nearestPointOnLine(line as any, pt);
            const distM = (nearestPt.properties.dist || 0) * 1000;
            if (!nearest || distM < nearest.distM) nearest = { zoneId: zg.zoneId, zoneName: zoneGroups.get(zg.zoneId)!.zoneName, distM };
          }
        }
      }
      noMatchApts.push({
        aptSeq: apt.aptSeq, aptName: apt.name, sigungu: apt.sigungu, dong: apt.umdName,
        roadAddress: apt.roadAddress, jibunAddress: apt.jibunAddress,
        latitude: apt.latitude, longitude: apt.longitude,
        nearestZone: nearest?.zoneName, nearestZoneId: nearest?.zoneId, nearestBoundaryDistM: nearest ? Math.round(nearest.distM) : null,
      });
      continue;
    }

    for (const zid of matched) {
      if (invalidZoneIds.has(zid)) {
        invalidGeomApts.push({ aptSeq: apt.aptSeq, aptName: apt.name, sigungu: apt.sigungu, dong: apt.umdName, zoneId: zid, zoneName: zoneGroups.get(zid)!.zoneName });
      }
    }
  }

  const out = {
    noMatchApartments: noMatchApts,
    noMatchCount: noMatchApts.length,
    invalidGeometryApartments: invalidGeomApts,
    invalidGeometryApartmentCount: invalidGeomApts.length,
    shinyeon: {
      csvRows: shinyeonCsvRows,
      canonicalCandidates: shinyeonCanonical,
      identityResolution: shinyeonIdentity,
      school664,
    },
    mediumLinks: mediumLinks.map((r) => ({
      zoneId: r.link.zoneId, schoolName: r.link.schoolName, zoneLawdCd: r.link.lawdCd,
      matchedSchoolId: r.matched?.id, matchedSchoolSigunguCode: r.matched?.sigunguCode, matchedSchoolName: r.matched?.schoolName,
      reasons: r.reasons,
    })),
    mediumCount: mediumLinks.length,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('NO_MATCH apartments:', noMatchApts.length);
  console.log('invalid-geometry apartments:', invalidGeomApts.length);
  console.log('MEDIUM links:', mediumLinks.length);
  console.log('신연초 CSV rows:', shinyeonCsvRows.length, 'canonical candidates:', shinyeonCanonical.length);
  console.log('Saved:', OUT);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
