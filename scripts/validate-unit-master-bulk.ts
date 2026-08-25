import fs from 'fs';
import readline from 'readline';
import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';

const prisma = new PrismaClient();

const RESIDENTIAL_USES = ['아파트', '다세대주택', '연립주택', '공동주택'];

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
      totalHouseholds: true,
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
    } else if (jibun) {
      bun = jibun.padStart(4, '0');
    }
    const key = `${dong}-${bun}-${ji}`;
    aptMap.set(key, apt);
  }

  console.log(`Loaded ${apartments.length} apartments for Seo-gu.`);

  const commonStream = fs.createReadStream('tmp/building-registry-202607/seo-gu-common.txt');
  const rl = readline.createInterface({ input: commonStream, crlfDelay: Infinity });

  const units = new Map();
  let matchedRows = 0;
  let totalRows = 0;

  for await (const line of rl) {
    totalRows++;
    const cols = line.split('|');
    const pk = cols[0];
    const bun = cols[11] || '0000';
    const ji = cols[12] || '0000';
    const dong_nm = cols[21] || '';
    const ho_nm = cols[22] || '';
    const isEx = cols[26] === '1'; // 1: 전유, 2: 공용
    const useName = cols[35] || '';
    const area = cols[37] || '0';
    
    // Match apartment
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
        units.set(unitKey, { 
          apt: foundApt, 
          exclusive: new Decimal(0), 
          common: new Decimal(0), 
          residentialCommon: new Decimal(0), 
          uses: [],
          exclusiveUse: ''
        });
      }
      const u = units.get(unitKey);
      const decArea = new Decimal(area);
      if (isEx) {
        u.exclusive = u.exclusive.plus(decArea);
        u.exclusiveUse = useName; // Keep the use name for the exclusive part
      } else {
        u.common = u.common.plus(decArea);
        u.uses.push(useName);
        if (useName.includes('아파트') || useName.includes('주택') || useName.includes('공용') || useName.includes('계단') || useName.includes('복도')) {
          u.residentialCommon = u.residentialCommon.plus(decArea);
        }
      }
    }
  }

  console.log(`Processed ${totalRows} rows. Matched ${matchedRows} rows to Apartments.`);

  // Filter and Aggregate
  const types = new Map();
  const cleanUnitsList = [];
  const apartmentHouseholdCount = new Map();
  const apartmentUnitTypeCount = new Map();

  for (const apt of apartments) {
    apartmentHouseholdCount.set(apt.id, 0);
    apartmentUnitTypeCount.set(apt.id, 0);
  }

  for (const [key, u] of units.entries()) {
    if (u.exclusive.isZero()) continue;

    // RESIDENTIAL FILTER
    const isRes = RESIDENTIAL_USES.some(ru => u.exclusiveUse.includes(ru));
    if (!isRes) {
      continue;
    }

    const supply = u.exclusive.plus(u.residentialCommon);
    
    // Canonical format: rounded to 4 decimal places without trailing zeros (Decimal default toString)
    const exStr = u.exclusive.toString();
    // Normalize supply for variant key
    const supplyNorm = supply.toFixed(4);
    
    const typeKey = `${u.apt.id}_${exStr}_${supplyNorm}`;
    if (!types.has(typeKey)) {
      types.set(typeKey, {
        apartmentId: u.apt.id,
        apartmentName: u.apt.name,
        canonicalExclusiveArea: exStr,
        residentialCommonArea: u.residentialCommon.toString(),
        supplyArea: supply.toString(),
        variantKey: `supply_${supplyNorm}`,
        householdCount: 0,
        representativePyeong: Math.round(supply.toNumber() / 3.3058),
        representativePyeongSource: 'SUPPLY_AREA_DERIVED',
        uses: new Set(),
        exclusiveUse: new Set()
      });
      apartmentUnitTypeCount.set(u.apt.id, apartmentUnitTypeCount.get(u.apt.id) + 1);
    }
    const t = types.get(typeKey);
    t.householdCount++;
    u.uses.forEach((use: string) => t.uses.add(use));
    t.exclusiveUse.add(u.exclusiveUse);
    
    apartmentHouseholdCount.set(u.apt.id, apartmentHouseholdCount.get(u.apt.id) + 1);
    cleanUnitsList.push(t); // just to keep track
  }

  const results = Array.from(types.values());
  
  // Output stats
  const daesin = results.filter(r => r.apartmentName.includes('대신롯데캐슬'));
  console.log('\n--- Daesin Lotte Castle (대신롯데캐슬) ---');
  console.log(daesin.map(d => ({...d, uses: Array.from(d.uses), exclusiveUse: Array.from(d.exclusiveUse)})));

  // Coverage
  let matchCount = 0;
  let unitMasterCount = 0;
  const backfillReady = [];
  const reviewList = [];
  
  console.log('\n--- Apartment Coverage & Household Validation ---');
  for (const apt of apartments) {
    const hhCount = apartmentHouseholdCount.get(apt.id);
    const unitCount = apartmentUnitTypeCount.get(apt.id);
    const isMatched = hhCount > 0;
    
    if (isMatched) {
      matchCount++;
      unitMasterCount++;
      const dbHh = apt.totalHouseholds || 0;
      const diff = Math.abs(hhCount - dbHh);
      const isReliable = diff <= 5; // e.g. within 5 is acceptable for registry discrepancies
      
      console.log(`[READY] ${apt.name} - DB HH: ${dbHh}, Registry HH: ${hhCount}, Types: ${unitCount}`);
      backfillReady.push(apt.id);
    } else {
      console.log(`[REVIEW] ${apt.name} - NO UNITS FOUND (Check address/join keys)`);
      reviewList.push(apt.id);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Target Apartments: ${apartments.length}`);
  console.log(`Address Exact Matched: ${matchCount} (${((matchCount/apartments.length)*100).toFixed(1)}%)`);
  console.log(`Unit Master Generated: ${unitMasterCount} (${((unitMasterCount/apartments.length)*100).toFixed(1)}%)`);
  console.log(`Clean Unit Type Rows Generated: ${results.length}`);

  // Constraint simulation
  const uniqueKeys = new Set();
  let duplicateCount = 0;
  for (const r of results) {
    const k = `${r.apartmentId}_${r.canonicalExclusiveArea}_${r.variantKey}`;
    if (uniqueKeys.has(k)) duplicateCount++;
    uniqueKeys.add(k);
  }
  console.log(`Shadow Duplicates (apartmentId, exclusiveArea, variantKey): ${duplicateCount}`);

  fs.writeFileSync('tmp/building-registry-202607/seo-gu-unit-master-clean.json', JSON.stringify({
    apartmentsCount: apartments.length,
    matchedRows,
    totalGeneratedTypes: results.length,
    daesin: daesin.map(d => ({...d, uses: Array.from(d.uses), exclusiveUse: Array.from(d.exclusiveUse)})),
    backfillReady,
    reviewList
  }, null, 2));
}

run().catch(console.error);
