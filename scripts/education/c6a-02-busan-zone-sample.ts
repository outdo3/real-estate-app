import * as shapefile from 'shapefile';

const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';

async function sampleBusan(label: string, shpPath: string, dbfPath: string) {
  const source = await shapefile.open(shpPath, dbfPath, { encoding: 'EUC-KR' });
  const byGb: Record<string, any[]> = { '0': [], '1': [] };
  let r = await source.read();
  while (!r.done) {
    const p: any = r.value.properties;
    if (p.SD_CD === '26') {
      const gb = p.HAKGUDO_GB;
      if (byGb[gb] && byGb[gb].length < 8) {
        byGb[gb].push({ id: p.HAKGUDO_ID, nm: p.HAKGUDO_NM, sgg: p.SGG_CD, edu: p.EDU_NM });
      }
    }
    r = await source.read();
  }
  console.log(`\n=== ${label} Busan sample by HAKGUDO_GB ===`);
  console.log(JSON.stringify(byGb, null, 1));
}

async function main() {
  await sampleBusan('초등학교통학구역', `${BASE}/elementary/초등학교통학구역.shp`, `${BASE}/elementary/초등학교통학구역.dbf`);
  await sampleBusan('중학교학교군', `${BASE}/middle/중학교학교군.shp`, `${BASE}/middle/중학교학교군.dbf`);
}
main().catch(console.error);
