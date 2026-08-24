import { readFileSync } from 'fs';
import { loadAllZones, filterBusan, parseLinkageCsv, parseZoneSchoolNameTokens } from './lib/attendance-zone-source';

const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';
const CSV_PATH = 'D:/anti2/aaa/schoolzone-data/한국교육시설안전원_학교학구도연계정보_20260320.csv';

async function main() {
  const zones = await loadAllZones(`${BASE}/elementary/초등학교통학구역.shp`, `${BASE}/elementary/초등학교통학구역.dbf`);
  const busan = filterBusan(zones);
  console.log('national elementary zones:', zones.length, 'busan:', busan.length);

  const sample = busan.find((z) => z.zoneName.includes('장림'));
  console.log('sample zone:', sample?.zoneId, sample?.zoneName, 'lawdCd:', sample?.lawdCd);
  console.log('sample geometry type:', sample?.geometry.type);
  const coords =
    sample?.geometry.type === 'Polygon'
      ? sample.geometry.coordinates[0][0]
      : sample?.geometry.type === 'MultiPolygon'
        ? sample.geometry.coordinates[0][0][0]
        : null;
  console.log('first transformed coordinate [lng, lat]:', coords, '(부산 범위: lng 128.7-129.3, lat 35.0-35.4)');

  const asymSample = busan.find((z) => z.isAsymmetric);
  console.log('asymmetric sample:', asymSample?.zoneName, '-> tokens:', parseZoneSchoolNameTokens(asymSample!.zoneName));

  const sharedSample = busan.find((z) => z.isShared && !z.isAsymmetric);
  console.log('symmetric shared sample:', sharedSample?.zoneName, '-> tokens:', parseZoneSchoolNameTokens(sharedSample!.zoneName));

  const singleSample = busan.find((z) => !z.isShared);
  console.log('single sample:', singleSample?.zoneName, '-> tokens:', parseZoneSchoolNameTokens(singleSample!.zoneName));

  const csvRaw = readFileSync(CSV_PATH);
  const rows = parseLinkageCsv(csvRaw);
  console.log('csv total rows:', rows.length);
  console.log('csv sample row:', JSON.stringify(rows.find((r) => r.schoolName.includes('장림'))));
  const busanRows = rows.filter((r) => r.sidoEduName.includes('부산'));
  console.log('csv busan rows:', busanRows.length);
}
main().catch(console.error);
