import * as shapefile from 'shapefile';
const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';
async function main() {
  const source = await shapefile.open(`${BASE}/elementary/초등학교통학구역.shp`, `${BASE}/elementary/초등학교통학구역.dbf`, { encoding: 'EUC-KR' });
  let r = await source.read();
  let ilbangCount = 0, busanGb1Count = 0;
  const ilbangSamples: any[] = [];
  while (!r.done) {
    const p: any = r.value.properties;
    if (p.SD_CD === '26' && p.HAKGUDO_GB === '1') {
      busanGb1Count++;
      if (p.HAKGUDO_NM.includes('일방') || p.HAKGUDO_NM.includes('온천') || p.HAKGUDO_NM.includes('금성') || p.HAKGUDO_NM.includes('공덕')) {
        ilbangSamples.push({ id: p.HAKGUDO_ID, nm: p.HAKGUDO_NM, sgg: p.SGG_CD });
      }
      if (p.HAKGUDO_NM.includes('일방')) ilbangCount++;
    }
    r = await source.read();
  }
  console.log('busan GB=1 total:', busanGb1Count);
  console.log('일방 count:', ilbangCount);
  console.log('온천/금성/공덕 matches:', JSON.stringify(ilbangSamples, null, 1));
}
main().catch(console.error);
