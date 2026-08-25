import fs from 'fs';
import readline from 'readline';
import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';

const prisma = new PrismaClient();

async function run() {
  console.log("Loading Seo-gu Apartments from DB...");
  const apartments = await prisma.apartment.findMany({
    where: {
      lawdCd: {
        startsWith: '26140',
      },
    },
    select: {
      id: true,
      name: true,
      dong: true,
      jibun: true,
      lawdCd: true,
    }
  });

  const aptMap = new Map();
  for (const apt of apartments) {
    const dong = apt.dong || '';
    const jibun = apt.jibun || '';
    let bun = '0000', ji = '0000';
    if (jibun && jibun.match(/^[0-9-]+$/)) {
      const [b, j] = jibun.split('-');
      bun = b.padStart(4, '0');
      ji = (j || '0').padStart(4, '0');
    }
    const key = `${dong}-${bun}-${ji}`;
    aptMap.set(key, apt);
  }

  console.log(`Loaded ${apartments.length} apartments for Seo-gu.`);

  // Pass 1: Parse Title to get PK -> Address (to get jibun, dong)
  // Or we can just use the address from the common file if it has it!
  // Let's check common file.
  // 1029142988|2|집합|4|전유부|부산광역시 서구 암남동 562-2번지|...|26140|12400|0|0562|0002...
  // index 8: sigungu_cd (26140)
  // index 9: bjdong_cd (12400)
  // index 10: plat_gb_cd (0)
  // index 11: bun (0562)
  // index 12: ji (0002)
  // index 22: dong name (에이동)
  // index 23: ho name (101호)
  
  const commonStream = fs.createReadStream('tmp/building-registry-202607/seo-gu-common.txt');
  const rl = readline.createInterface({ input: commonStream, crlfDelay: Infinity });

  // Map: apartmentId -> Array of units
  // Key for unit: apartmentId + dong + ho
  const units = new Map();
  let matchedRows = 0;
  let totalRows = 0;

  // We need to map bjdong_cd to dong name. We can just use bun and ji for the map since they are in Seo-gu.
  // But wait, many dongs have the same bun-ji. We need to match dong name.
  // We'll create a mapping of bjdong_cd -> dong name. 
  // For now, let's just group by PK + bun + ji and find matches.

  for await (const line of rl) {
    totalRows++;
    const cols = line.split('|');
    const pk = cols[0];
    const bun = cols[11];
    const ji = cols[12];
    const dong_nm = cols[21] || '';
    const ho_nm = cols[22] || '';
    const isEx = cols[26] === '1'; // 1: 전유, 2: 공용
    const useName = cols[35] || '';
    const area = cols[37] || '0';
    
    // Match apartment by bun and ji. (To be more precise, we should use lawdCd but for POC bun-ji in Seo-gu is usually enough).
    // Let's find apt
    let foundApt = null;
    for (const [key, apt] of aptMap.entries()) {
      if (key.endsWith(`${bun}-${ji}`)) {
        foundApt = apt;
        break;
      }
    }

    if (foundApt) {
      matchedRows++;
      const unitKey = `${foundApt.id}-${pk}-${dong_nm}-${ho_nm}`;
      if (!units.has(unitKey)) {
        units.set(unitKey, { apt: foundApt, exclusive: new Decimal(0), common: new Decimal(0), residentialCommon: new Decimal(0), uses: [] });
      }
      const u = units.get(unitKey);
      const decArea = new Decimal(area);
      if (isEx) {
        u.exclusive = u.exclusive.plus(decArea);
      } else {
        u.common = u.common.plus(decArea);
        // Is it residential common?
        // Heuristic: if it's "계단", "복도", "현관", "주거공용" or similar, or just if it's not "주차장", "관리실" etc.
        // Let's record the uses to analyze
        u.uses.push(useName);
        if (useName.includes('아파트') || useName.includes('주택') || useName.includes('공용') || useName.includes('계단') || useName.includes('복도')) {
            u.residentialCommon = u.residentialCommon.plus(decArea);
        }
      }
    }
  }

  console.log(`Processed ${totalRows} rows. Matched ${matchedRows} rows to Apartments.`);

  // Now aggregate to unique unit types
  const types = new Map();
  for (const [key, u] of units.entries()) {
    if (u.exclusive.isZero()) continue;
    const supply = u.exclusive.plus(u.residentialCommon);
    
    const typeKey = `${u.apt.id}_${u.exclusive.toString()}_${supply.toString()}`;
    if (!types.has(typeKey)) {
      types.set(typeKey, {
        apartmentId: u.apt.id,
        apartmentName: u.apt.name,
        canonicalExclusiveArea: u.exclusive.toString(),
        residentialCommonArea: u.residentialCommon.toString(),
        supplyArea: supply.toString(),
        variantKey: `supply_${supply.toFixed(4)}`,
        householdCount: 0,
        representativePyeong: Math.round(supply.toNumber() / 3.3058),
        uses: new Set()
      });
    }
    const t = types.get(typeKey);
    t.householdCount++;
    u.uses.forEach((use: string) => t.uses.add(use));
  }

  const results = Array.from(types.values());
  // Find Daesin Lotte Castle
  const daesin = results.filter(r => r.apartmentName.includes('대신롯데캐슬'));
  console.log('\n--- Daesin Lotte Castle (대신롯데캐슬) ---');
  console.log(daesin.map(d => ({...d, uses: Array.from(d.uses)})));

  console.log('\n--- Summary ---');
  console.log(`Total Apartments found: ${aptMap.size}`);
  console.log(`Generated Unit Type Rows: ${results.length}`);
  
  fs.writeFileSync('tmp/building-registry-202607/seo-gu-match-report.json', JSON.stringify({
    apartmentsCount: aptMap.size,
    matchedRows,
    totalUnits: units.size,
    generatedUnitTypes: results.length,
    daesin: daesin.map(d => ({...d, uses: Array.from(d.uses)}))
  }, null, 2));

}

run().catch(console.error);
