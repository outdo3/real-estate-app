import { loadAllZones, filterBusan } from './lib/attendance-zone-source';
const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';
(async () => {
  const elemAll = await loadAllZones(`${BASE}/elementary/초등학교통학구역.shp`, `${BASE}/elementary/초등학교통학구역.dbf`);
  const elemBusan = filterBusan(elemAll);
  const targets = ['Z000151619','Z000151620','Z000151621','Z000151622','Z000151623','Z000151624','Z000151625','Z000100680','Z000151585','Z000100649','Z000150049'];
  for (const zid of targets) {
    const z = elemBusan.find(r => r.zoneId === zid);
    console.log(zid, z?.zoneName, 'isShared:', z?.isShared, 'isAsymmetric:', z?.isAsymmetric);
  }
})();
