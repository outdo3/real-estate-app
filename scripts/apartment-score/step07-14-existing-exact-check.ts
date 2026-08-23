// E-JIP SCORE V2 STEP 0.7 §11 추가조사 — 이미 geocodeQuality='exact'인 기존 row들의
// roadAddress도 "(동)" 괄호로 끝나는지 확인(§13에서 발견한 keyword-search 실패
// 원인이 recovery 후보만의 문제인지, 기존 파이프라인 전체의 잠재 이슈인지 구분).
// READ-ONLY.
import { prisma } from '../../src/lib/prisma';

async function main() {
  const rows = await prisma.apartmentMaster.findMany({
    where: { geocodeQuality: 'exact', roadAddress: { not: null } },
    select: { aptSeq: true, roadAddress: true },
    take: 20,
  });
  let withParen = 0;
  for (const r of rows) {
    const hasParen = /\([^)]*\)\s*$/.test(r.roadAddress || '');
    if (hasParen) withParen++;
    console.log(`${r.aptSeq}: "${r.roadAddress}" ${hasParen ? '← 괄호 있음' : ''}`);
  }
  console.log(`\n괄호로 끝나는 row: ${withParen}/${rows.length}`);

  const total = await prisma.apartmentMaster.count({ where: { geocodeQuality: 'exact', roadAddress: { not: null } } });
  const totalWithParen = await prisma.apartmentMaster.count({ where: { geocodeQuality: 'exact', roadAddress: { endsWith: ')' } } });
  console.log(`\n전체 exact+roadAddress 보유: ${total}건, 그 중 ")"로 끝나는 row: ${totalWithParen}건`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
