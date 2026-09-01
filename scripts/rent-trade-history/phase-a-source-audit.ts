// RENT_TRADE_HISTORY_V1 PHASE A — read-only source/identity audit against the
// real MOLIT rent API (RTMSDataSvcAptRent) and the real ApartmentMaster table.
// No writes. Findings are summarized in
// docs/development/RENT_TRADE_HISTORY_V1_ARCHITECTURE.md — this script is
// kept so the same numbers can be reproduced/re-verified later.
//
// Usage: npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' -r ./scripts/_register-paths.js scripts/rent-trade-history/phase-a-source-audit.ts
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true });
import { XMLParser } from 'fast-xml-parser';
import { prisma } from '../../src/lib/prisma';

const API_KEY = process.env.DATA_GO_KR_API_KEY;
const ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

async function rawFetch(lawdCd: string, dealYmd: string): Promise<any[]> {
  const url = `${ENDPOINT}?serviceKey=${API_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000`;
  const response = await fetch(url, { headers: { Accept: 'application/xml, text/xml, */*' }, signal: AbortSignal.timeout(10000) });
  const textData = await response.text();
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const jsonObj = parser.parse(textData);
  const items = jsonObj.response?.body?.items?.item;
  return items ? (Array.isArray(items) ? items : [items]) : [];
}

function nonEmpty(v: any) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

async function main() {
  const districts: Array<[string, string]> = [
    ['서구', '26140'],
    ['해운대구', '26350'],
    ['부산진구', '26230'],
    ['동래구', '26260'],
    ['기장군', '26710'],
  ];
  const report: any = { generatedAt: new Date().toISOString(), endpoint: ENDPOINT };

  // §1 raw field capture
  const sample = await rawFetch('26140', '202601');
  const allKeys = new Set<string>();
  sample.forEach((it) => Object.keys(it).forEach((k) => allKeys.add(k)));
  report.rawFieldKeys = Array.from(allKeys).sort();
  report.cancellationFieldsPresent = ['등기일자', 'rgstDate', '해제여부', 'cdealType', '해제사유발생일', 'cdealDay'].filter((f) => allKeys.has(f));

  // §2 field coverage across time (contractType/useRRRight/preDeposit rollout)
  const months = ['202601', '202506', '202412', '202312', '202112', '202006', '201912', '201812'];
  report.fieldCoverageByMonth = [];
  for (const ym of months) {
    let items: any[] = [];
    try { items = await rawFetch('26140', ym); } catch { continue; }
    report.fieldCoverageByMonth.push({
      month: ym,
      n: items.length,
      contractTypeFilled: items.filter((it) => nonEmpty(it.contractType)).length,
      contractTypeValues: [...new Set(items.map((it) => it.contractType).filter(nonEmpty))],
      useRRRightFilled: items.filter((it) => nonEmpty(it.useRRRight)).length,
      preDepositFilled: items.filter((it) => nonEmpty(it.preDeposit)).length,
      aptSeqMissing: items.filter((it) => !nonEmpty(it.aptSeq)).length,
    });
  }

  // §3 aptSeq coverage + ApartmentMaster match rate, 5 districts, recent month
  report.identityByDistrict = [];
  const allItemsByDistrict: Record<string, any[]> = {};
  for (const [name, lawdCd] of districts) {
    const items = await rawFetch(lawdCd, '202601');
    allItemsByDistrict[lawdCd] = items;
    const aptSeqMissing = items.filter((it) => !nonEmpty(it.aptSeq)).length;
    const seqs = [...new Set(items.filter((it) => nonEmpty(it.aptSeq)).map((it) => String(it.aptSeq)))];
    const masters = await prisma.apartmentMaster.findMany({ where: { aptSeq: { in: seqs } }, select: { aptSeq: true } });
    const matchedSet = new Set(masters.map((m) => m.aptSeq));
    const matched = seqs.filter((s) => matchedSet.has(s)).length;
    report.identityByDistrict.push({ district: name, lawdCd, n: items.length, aptSeqMissing, uniqueAptSeq: seqs.length, matched, unmatched: seqs.length - matched });
  }

  // §4 natural key duplicate audit
  const allItems = Object.values(allItemsByDistrict).flat();
  const candA = new Map<string, number>();
  for (const it of allItems) {
    const key = `${it.aptSeq}|${it.dealYear}-${it.dealMonth}-${it.dealDay}|${it.excluUseAr}|${it.floor}|${it.deposit}|${it.monthlyRent}`;
    candA.set(key, (candA.get(key) || 0) + 1);
  }
  const dupA = [...candA.entries()].filter(([, c]) => c > 1);
  report.naturalKeyAudit = {
    candidate: 'aptSeq+dealDate+exclusiveArea+floor+deposit+monthlyRent',
    totalItems: allItems.length,
    uniqueKeys: candA.size,
    duplicateKeys: dupA.length,
    sampleDuplicates: dupA.slice(0, 5).map(([k, c]) => ({ key: k, count: c })),
    conclusion: 'Genuine collisions exist (multiple identical-spec units in the same building, same floor/area/price/date) -- MOLIT does not expose unit/ho number publicly. Same class of issue the existing sale TradeHistory model already solves via occurrenceIndex.',
  };

  // §5 jeonse/wolse + edge cases
  const depositZero = allItems.filter((it) => parseInt(String(it.deposit).replace(/,/g, ''), 10) === 0);
  const monthlyRentZero = allItems.filter((it) => Number(it.monthlyRent) === 0);
  const bothZero = allItems.filter((it) => parseInt(String(it.deposit).replace(/,/g, ''), 10) === 0 && Number(it.monthlyRent) === 0);
  const renewals = allItems.filter((it) => it.contractType === '갱신');
  const renewalsWithPrev = renewals.filter((it) => nonEmpty(it.preDeposit));
  const newContracts = allItems.filter((it) => it.contractType === '신규');
  const newWithPrev = newContracts.filter((it) => nonEmpty(it.preDeposit));
  report.rentTypeAndEdgeCases = {
    totalItems: allItems.length,
    jeonseCount_monthlyRentZero: monthlyRentZero.length,
    wolseCount_monthlyRentPositive: allItems.length - monthlyRentZero.length,
    depositZeroCases_pureMonthlyRent: depositZero.length,
    bothZeroCases_shouldBeZero: bothZero.length,
    renewalContracts: renewals.length,
    renewalsWithPreDepositFilled: renewalsWithPrev.length,
    newContracts: newContracts.length,
    newContractsWithPreDepositFilled_shouldBeZero: newWithPrev.length,
  };

  const outPath = path.resolve(__dirname, 'output-phase-a-audit.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n결과 저장: ${outPath}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
