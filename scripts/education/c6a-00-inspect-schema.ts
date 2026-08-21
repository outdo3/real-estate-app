import * as shapefile from 'shapefile';
import { readFileSync } from 'fs';

const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';

async function inspectDbfSchema(label: string, shpPath: string, dbfPath: string) {
  const source = await shapefile.open(shpPath, dbfPath, { encoding: 'EUC-KR' });
  const result = await source.read();
  console.log(`\n=== ${label} ===`);
  if (!result.done) {
    const geom = result.value.geometry as GeoJSON.Polygon | undefined;
    console.log('geometry.type:', geom?.type);
    console.log('coordinate sample (first ring, first 3 pts):', JSON.stringify(geom?.coordinates?.[0]?.slice?.(0, 3)));
    console.log('properties:', JSON.stringify(result.value.properties, null, 1));
  }
  let count = 1;
  let r = result;
  while (!r.done) {
    r = await source.read();
    if (!r.done) count++;
  }
  console.log('total record count:', count);
}

async function main() {
  await inspectDbfSchema(
    '초등학교통학구역',
    `${BASE}/elementary/초등학교통학구역.shp`,
    `${BASE}/elementary/초등학교통학구역.dbf`
  );
  await inspectDbfSchema(
    '중학교학교군',
    `${BASE}/middle/중학교학교군.shp`,
    `${BASE}/middle/중학교학교군.dbf`
  );
}
main().catch(console.error);
