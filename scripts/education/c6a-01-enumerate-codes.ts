import * as shapefile from 'shapefile';

const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';

async function enumerate(label: string, shpPath: string, dbfPath: string) {
  const source = await shapefile.open(shpPath, dbfPath, { encoding: 'EUC-KR' });
  const gbSet = new Map<string, number>();
  const sdMap = new Map<string, string>(); // SD_CD -> EDU_UP_NM sample
  const busanSggSet = new Map<string, string>(); // SGG_CD -> EDU_NM sample (within Busan)
  let total = 0;
  let busanCount = 0;
  let r = await source.read();
  while (!r.done) {
    total++;
    const p: any = r.value.properties;
    gbSet.set(p.HAKGUDO_GB, (gbSet.get(p.HAKGUDO_GB) || 0) + 1);
    if (!sdMap.has(p.SD_CD)) sdMap.set(p.SD_CD, p.EDU_UP_NM);
    if (typeof p.EDU_UP_NM === 'string' && p.EDU_UP_NM.includes('부산')) {
      busanCount++;
      if (!busanSggSet.has(p.SGG_CD)) busanSggSet.set(p.SGG_CD, p.EDU_NM);
    }
    r = await source.read();
  }
  console.log(`\n=== ${label} ===`);
  console.log('total:', total);
  console.log('HAKGUDO_GB distribution:', Object.fromEntries(gbSet));
  console.log('SD_CD -> EDU_UP_NM map:', Object.fromEntries(sdMap));
  console.log('busan (EDU_UP_NM includes 부산) count:', busanCount);
  console.log('busan SGG_CD -> EDU_NM sample:', Object.fromEntries(busanSggSet));
}

async function main() {
  await enumerate('초등학교통학구역', `${BASE}/elementary/초등학교통학구역.shp`, `${BASE}/elementary/초등학교통학구역.dbf`);
  await enumerate('중학교학교군', `${BASE}/middle/중학교학교군.shp`, `${BASE}/middle/중학교학교군.dbf`);
}
main().catch(console.error);
