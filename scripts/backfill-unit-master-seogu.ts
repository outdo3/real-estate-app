import fs from 'fs';
import readline from 'readline';
import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';

const prisma = new PrismaClient();
const RESIDENTIAL_USES = ['아파트', '다세대주택', '연립주택', '공동주택'];

async function run() {
  const isApply = process.argv.includes('--apply');
  console.log(`Starting Unit Master Backfill... (Apply mode: ${isApply})`);

  // 1. Initial count check
  const beforeCount = await prisma.apartmentUnitType.count();
  console.log(`Production ApartmentUnitType count before: ${beforeCount}`);
  if (beforeCount > 0) {
    console.warn("WARNING: Production ApartmentUnitType table is not empty!");
  }

  // 2. Load Apartments
  const apartments = await prisma.apartment.findMany({
    where: { lawdCd: { startsWith: '26140' } },
    select: { id: true, name: true, dong: true, jibun: true, lawdCd: true, totalHouseholds: true }
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
    aptMap.set(`${dong}-${bun}-${ji}`, apt);
  }

  // 3. Process Building Registry
  const commonStream = fs.createReadStream('tmp/building-registry-202607/seo-gu-common.txt', 'utf8');
  const rl = readline.createInterface({ input: commonStream, crlfDelay: Infinity });

  const units = new Map();
  for await (const line of rl) {
    const cols = line.split('|');
    const pk = cols[0];
    const bun = cols[11] || '0000';
    const ji = cols[12] || '0000';
    const dong_nm = cols[21] || '';
    const ho_nm = cols[22] || '';
    const isEx = cols[26] === '1';
    const useName = cols[35] || '';
    const area = cols[37] || '0';
    
    let foundApt = null;
    for (const [key, apt] of aptMap.entries()) {
      if (key.endsWith(`${bun}-${ji}`)) {
        foundApt = apt; break;
      }
    }

    if (foundApt) {
      const unitKey = `${foundApt.id}-${pk}-${dong_nm}-${ho_nm}`;
      if (!units.has(unitKey)) {
        units.set(unitKey, { apt: foundApt, exclusive: new Decimal(0), common: new Decimal(0), residentialCommon: new Decimal(0), exclusiveUse: '' });
      }
      const u = units.get(unitKey);
      const decArea = new Decimal(area);
      if (isEx) {
        u.exclusive = u.exclusive.plus(decArea);
        u.exclusiveUse = useName;
      } else {
        u.common = u.common.plus(decArea);
        if (useName.includes('아파트') || useName.includes('주택') || useName.includes('공용') || useName.includes('계단') || useName.includes('복도')) {
          u.residentialCommon = u.residentialCommon.plus(decArea);
        }
      }
    }
  }

  // 4. Aggregate clean types
  const types = new Map();
  const apartmentHouseholdCount = new Map();
  for (const apt of apartments) {
    apartmentHouseholdCount.set(apt.id, 0);
  }

  for (const [key, u] of units.entries()) {
    if (u.exclusive.isZero()) continue;
    if (!RESIDENTIAL_USES.some(ru => u.exclusiveUse.includes(ru))) continue;

    const supply = u.exclusive.plus(u.residentialCommon);
    const exStr = u.exclusive.toString();
    const supplyNorm = supply.toFixed(4);
    const typeKey = `${u.apt.id}_${exStr}_supply_${supplyNorm}`;
    
    if (!types.has(typeKey)) {
      types.set(typeKey, {
        apartmentId: u.apt.id,
        canonicalExclusiveArea: exStr,
        residentialCommonArea: u.residentialCommon.toString(),
        supplyArea: supply.toString(),
        variantKey: `supply_${supplyNorm}`,
        householdCount: 0,
        representativePyeong: Math.round(supply.toNumber() / 3.3058),
        representativePyeongSource: 'SUPPLY_AREA_DERIVED',
        officialType: null,
        source: 'BUILDING_REGISTRY',
        sourceMatchKey: null,
      });
    }
    const t = types.get(typeKey);
    t.householdCount++;
    apartmentHouseholdCount.set(u.apt.id, apartmentHouseholdCount.get(u.apt.id) + 1);
  }

  // 5. Categorize Ready / Review
  const READY_IDS = new Set();
  const REVIEW_IDS = new Set();
  for (const apt of apartments) {
    if (apartmentHouseholdCount.get(apt.id) > 0) {
      READY_IDS.add(apt.id);
    } else {
      REVIEW_IDS.add(apt.id);
    }
  }

  console.log(`READY Apartments: ${READY_IDS.size}, REVIEW Apartments: ${REVIEW_IDS.size}`);

  const writeSet = Array.from(types.values()).filter(t => READY_IDS.has(t.apartmentId));
  console.log(`Write Set Rows: ${writeSet.length}`);

  // 6. DB WRITE (Upsert)
  if (isApply) {
    console.log("Applying to Production DB...");
    let inserted = 0;
    let updated = 0;
    for (const row of writeSet) {
      // Find existing
      const existing = await prisma.apartmentUnitType.findUnique({
        where: {
          apartmentId_canonicalExclusiveArea_variantKey: {
            apartmentId: row.apartmentId,
            canonicalExclusiveArea: row.canonicalExclusiveArea,
            variantKey: row.variantKey
          }
        }
      });

      if (existing) {
        await prisma.apartmentUnitType.update({
          where: { id: existing.id },
          data: {
            supplyArea: row.supplyArea,
            representativePyeong: row.representativePyeong,
            representativePyeongSource: row.representativePyeongSource,
            householdCount: row.householdCount,
            source: row.source,
          }
        });
        updated++;
      } else {
        await prisma.apartmentUnitType.create({
          data: {
            apartmentId: row.apartmentId,
            canonicalExclusiveArea: row.canonicalExclusiveArea,
            variantKey: row.variantKey,
            supplyArea: row.supplyArea,
            representativePyeong: row.representativePyeong,
            representativePyeongSource: row.representativePyeongSource,
            officialType: null,
            householdCount: row.householdCount,
            source: row.source,
          }
        });
        inserted++;
      }
    }
    console.log(`[APPLY] Inserted: ${inserted}, Updated: ${updated}`);
  } else {
    console.log("[DRY RUN] Would insert/update: " + writeSet.length + " rows");
  }

  // 7. Post-check
  const afterCount = await prisma.apartmentUnitType.count();
  console.log(`Production ApartmentUnitType count after: ${afterCount}`);
  
  // Guard check
  const reviewRows = await prisma.apartmentUnitType.count({
    where: { apartmentId: { in: Array.from(REVIEW_IDS) as number[] } }
  });
  if (reviewRows > 0) {
    console.error(`FAIL: ${reviewRows} rows written to REVIEW apartments!`);
  } else {
    console.log(`Review Guard PASS (0 rows in REVIEW apartments)`);
  }
}

run().catch(console.error);
