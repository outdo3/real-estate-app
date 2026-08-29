/**
 * TRADE_HISTORY_DATA_V1 — §28/§29/§49/§50 QA. backfill 완료 후 실행.
 * 대표 단지 cross-check(라이브 MOLIT vs DB) + 전체 이력 기준 신고가 proof +
 * 직전거래 조회 검증. DB에 쓰지 않는다(읽기 전용).
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/qa-trade-history.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { fetchMolitData } from '../src/lib/api-molit';
import { getAllTimeHigh, getPreviousTrade, getTradeHistory } from '../src/lib/trade-history-read';

const prisma = new PrismaClient();

const NAME_PATTERNS = ['대신롯데캐슬', '비스타동원', '한솔솔파크'];

async function findRepresentativeApts() {
  const found: { aptSeq: string; aptName: string; dong: string; lawdCd: string }[] = [];
  for (const pattern of NAME_PATTERNS) {
    const rows = await prisma.apartmentTradeHistory.findMany({
      where: { aptName: { contains: pattern } },
      distinct: ['aptSeq'],
      select: { aptSeq: true, aptName: true, dong: true, lawdCd: true },
      take: 3,
    });
    found.push(...(rows.filter((r) => r.aptSeq) as any));
  }
  // 해운대구(26350)/동래구(26260) 대표 — 거래건수 상위 1건씩 동적으로 뽑는다(이름 하드코딩 없이).
  for (const lawdCd of ['26350', '26260']) {
    const top = await prisma.apartmentTradeHistory.groupBy({
      by: ['aptSeq', 'aptName', 'dong'],
      where: { lawdCd, aptSeq: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { aptSeq: 'desc' } },
      take: 1,
    });
    if (top[0]?.aptSeq) found.push({ aptSeq: top[0].aptSeq, aptName: top[0].aptName, dong: top[0].dong, lawdCd });
  }
  return found;
}

async function crossCheckOne(apt: { aptSeq: string; aptName: string; dong: string; lawdCd: string }) {
  console.log(`\n=== ${apt.aptName} (${apt.dong}, aptSeq=${apt.aptSeq}, lawdCd=${apt.lawdCd}) ===`);

  // DB 최근 거래(취소 제외, 전체 area 통합 — exact area별 조회는 대표 area 하나로 아래에서).
  const dbRecent = await prisma.apartmentTradeHistory.findMany({
    where: { aptSeq: apt.aptSeq, dealCanceled: false },
    orderBy: { dealDate: 'desc' },
    take: 3,
  });
  console.log('DB 최근 3건:', dbRecent.map((r) => `${r.dealDate.toISOString().slice(0, 10)} ${r.exclusiveArea}㎡ ${r.floor}층 ${r.dealAmount}만`));

  if (dbRecent.length === 0) {
    console.log('DB에 거래 없음 — cross-check 스킵');
    return;
  }

  // 라이브 MOLIT 같은 달 재조회해서 DB와 대조.
  const latest = dbRecent[0];
  const dealYmd = `${latest.dealYear}${String(latest.dealMonth).padStart(2, '0')}`;
  const liveItems = (await fetchMolitData({ lawdCd: apt.lawdCd, dealYmd, type: 'apt' })) as any[];
  const liveMatch = liveItems.find(
    (i: any) => i.aptSeq === apt.aptSeq && i.excluUseArea === Number(latest.exclusiveArea) && i.dealDate === latest.dealDate.toISOString().slice(0, 10) && i.dealAmount === latest.dealAmount
  );
  console.log('라이브 MOLIT 동일 거래 매칭:', liveMatch ? `OK (floor=${liveMatch.floorRaw})` : 'NOT FOUND(주의)');

  // §29 TRUE RECORD HIGH PROOF — 대표 exact area 하나(가장 최근 거래의 area)로.
  const area = Number(latest.exclusiveArea);
  const identity = { aptSeq: apt.aptSeq, name: apt.aptName, dong: apt.dong };
  const allTimeHigh = await getAllTimeHigh(identity, area);
  const history = await getTradeHistory(identity, area);
  console.log(`§29 전체 이력 기준(${area}㎡) 저장 거래 수=${history.length}, 최고가=${allTimeHigh?.amount}만 (${allTimeHigh?.date.toISOString().slice(0, 10)})`);

  // §50 직전거래
  if (history.length >= 2) {
    const last = history[history.length - 1];
    const prev = await getPreviousTrade(identity, area, last.dealDate);
    console.log(`§50 최근 거래(${last.dealDate.toISOString().slice(0, 10)}, ${last.dealAmount}만) 직전거래:`, prev ? `${prev.date.toISOString().slice(0, 10)} ${prev.amount}만` : 'NONE');
  }

  // 2년(24개월) 최고가와 전체 이력 최고가가 다를 수 있는 실제 사례 확인.
  const cutoff = new Date(latest.dealDate);
  cutoff.setMonth(cutoff.getMonth() - 24);
  const within24m = history.filter((h) => h.dealDate >= cutoff);
  const high24m = within24m.reduce((max, h) => (h.dealAmount > max ? h.dealAmount : max), 0);
  if (allTimeHigh && high24m > 0 && high24m !== allTimeHigh.amount) {
    console.log(`§49 차이 발견: 24개월 최고가=${high24m}만 vs 전체 이력 최고가=${allTimeHigh.amount}만 (다름 — 실제 사례)`);
  } else {
    console.log(`§49 24개월 최고가=${high24m || 'N/A'}만, 전체 이력 최고가=${allTimeHigh?.amount ?? 'N/A'}만 (${high24m === allTimeHigh?.amount ? '동일' : '표본 부족/비교 불가'})`);
  }
}

async function main() {
  const apts = await findRepresentativeApts();
  console.log(`대표 단지 후보 ${apts.length}건 발견`);
  for (const apt of apts) {
    await crossCheckOne(apt);
    await new Promise((r) => setTimeout(r, 300));
  }
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
