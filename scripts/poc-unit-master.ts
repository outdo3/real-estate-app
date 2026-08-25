import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';

const prisma = new PrismaClient();

async function main() {
  const csvPath = path.join(__dirname, 'data', 'sample_registry.csv');
  const csv = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const headers = csv[0].trim().split(',');
  const rows = csv.slice(1).map(line => {
    const values = line.trim().split(',');
    const obj: any = {};
    headers.forEach((h, i) => obj[h] = values[i]);
    return obj;
  }).filter(r => r.excluArea);

  const matched = [];
  let duplicates = 0;
  
  // Aggregate rows
  const aggregated: any = {};

  for (const row of rows) {
    // Exact match by lawdCd (sggCd) and jibun
    const apt = await prisma.apartment.findFirst({
      where: {
        lawdCd: row.sggCd,
        jibun: row.jibun
      }
    });

    if (!apt) continue;

    const exclu = new Decimal(row.excluArea);
    const common = new Decimal(row.commonArea);
    const supply = exclu.plus(common);
    
    // Normalize supply string to 4 decimal places to prevent float issues (though Decimal handles it)
    const normalizedSupplyStr = supply.toFixed(4);
    
    const variantKey = `supply_${normalizedSupplyStr}`;
    const aggKey = `${apt.id}_${exclu.toFixed(4)}_${variantKey}`;

    if (!aggregated[aggKey]) {
      aggregated[aggKey] = {
        apartmentId: apt.id,
        apartmentName: apt.name,
        lawdCd: apt.lawdCd,
        jibun: apt.jibun,
        canonicalExclusiveArea: exclu.toNumber(),
        supplyArea: supply.toNumber(),
        representativePyeong: Math.round(supply.toNumber() / 3.3058),
        representativePyeongSource: 'SUPPLY_AREA_DERIVED',
        officialType: null,
        householdCount: 0,
        source: 'BUILDING_REGISTRY',
        sourceMatchKey: `${row.sggCd}-${row.umdCd}-${row.jibun}`,
        variantKey
      };
    }
    
    aggregated[aggKey].householdCount += 1;
  }
  
  const results = Object.values(aggregated);
  
  // Check duplicates
  const keys = new Set();
  for (const r of results as any[]) {
    const k = `${r.apartmentId}_${r.canonicalExclusiveArea}_${r.variantKey}`;
    if (keys.has(k)) duplicates++;
    keys.add(k);
  }

  const output = {
    metrics: {
      rawRows: rows.length,
      generatedUnits: results.length,
      duplicates
    },
    units: results
  };

  const outPath = path.join(__dirname, '..', 'tmp');
  if (!fs.existsSync(outPath)) fs.mkdirSync(outPath);
  fs.writeFileSync(path.join(outPath, 'unit-master-shadow.json'), JSON.stringify(output, null, 2));

  console.log('POC Shadow Execution Complete');
  console.log('Generated Units:', results.length);
  console.log('Duplicates:', duplicates);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
