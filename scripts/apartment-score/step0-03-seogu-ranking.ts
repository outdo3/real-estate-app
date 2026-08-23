// E-JIP SCORE V2 STEP 0 §10 — 서구 전체 Score read-only 계산, top30/bottom30 +
// 상식 모순 그룹 flag. DB write 없음, calculateApartmentScore() 그대로 재사용.
import { prisma } from '../../src/lib/prisma';
import { calculateApartmentScore } from '../../src/lib/apartment-score/server/calculate';

interface Row {
  aptSeq: string; name: string; umdName: string | null; buildYear: number | null;
  totalHouseholds: number | null; parkingCount: number | null;
  score: number | null; coverage: number | null; confidence: string | null;
  transport: number | null; living: number | null; parking: number | null; complex: number | null; school: number | null;
}

async function main() {
  const seogu = await prisma.apartmentMaster.findMany({
    where: { sigungu: '서구', aptSeq: { not: null } },
    select: { aptSeq: true, name: true, umdName: true, buildYear: true, totalHouseholds: true, parkingCount: true },
  });
  console.log(`서구 ApartmentMaster: ${seogu.length}건. Score 계산 중...`);

  const rows: Row[] = [];
  let i = 0;
  for (const apt of seogu) {
    i++;
    if (i % 30 === 0) console.error(`  ${i}/${seogu.length}...`);
    const r = await calculateApartmentScore(apt.aptSeq!);
    const cat = (key: string) => r.categories.find((c: any) => c.key === key)?.score ?? null;
    rows.push({
      aptSeq: apt.aptSeq!, name: apt.name, umdName: apt.umdName, buildYear: apt.buildYear,
      totalHouseholds: apt.totalHouseholds, parkingCount: apt.parkingCount,
      score: r.score, coverage: r.coverage, confidence: r.confidence,
      transport: cat('transport'), living: cat('living'), parking: cat('parking'), complex: cat('complex'), school: cat('schoolAccess'),
    });
  }

  const scored = rows.filter((r) => r.score != null).sort((a, b) => (b.score! - a.score!));
  console.log(`\n계산 완료: ${scored.length}/${rows.length}건 OK`);

  const fmt = (r: Row) => `${r.score?.toString().padStart(3)} | T${r.transport?.toFixed(0).padStart(3)} L${r.living?.toFixed(0).padStart(3)} P${r.parking?.toFixed(0).padStart(3)} C${r.complex?.toFixed(0).padStart(3)} S${r.school?.toFixed(0).padStart(3)} | ${r.buildYear ?? '?'} ${r.totalHouseholds ?? '?'}세대 | ${r.name}(${r.umdName})`;

  console.log('\n=== TOP 30 ===');
  scored.slice(0, 30).forEach((r) => console.log(fmt(r)));
  console.log('\n=== BOTTOM 30 ===');
  scored.slice(-30).reverse().forEach((r) => console.log(fmt(r)));

  console.log('\n=== 신축(2020+) TOP 10 ===');
  scored.filter((r) => (r.buildYear ?? 0) >= 2020).slice(0, 10).forEach((r) => console.log(fmt(r)));

  console.log('\n=== 구축(2005-) TOP 10 ===');
  scored.filter((r) => (r.buildYear ?? 9999) <= 2005).slice(0, 10).forEach((r) => console.log(fmt(r)));

  console.log('\n=== 대단지(500+세대) TOP 10 ===');
  scored.filter((r) => (r.totalHouseholds ?? 0) >= 500).slice(0, 10).forEach((r) => console.log(fmt(r)));

  console.log('\n=== 주차 우수(parking>=90) ===');
  scored.filter((r) => (r.parking ?? 0) >= 90).forEach((r) => console.log(fmt(r)));

  console.log('\n=== 주차 취약(parking<=15) ===');
  scored.filter((r) => (r.parking ?? 100) <= 15).forEach((r) => console.log(fmt(r)));

  // 명백한 모순 flag: 같은 peer 레벨 안에서 transport 원시값이 더 나쁜데 transport score가
  // 더 높은 케이스 등은 여기선 생략(요청 범위: "객관적 feature 간 모순" 중 가장 값싸게
  // 확인 가능한 것 — buildYear가 압도적으로 최신인데 complex score가 낮은 경우만 flag).
  console.log('\n=== FLAG: buildYear>=2020인데 complex<50 (신축인데 단지점수 낮음) ===');
  scored.filter((r) => (r.buildYear ?? 0) >= 2020 && (r.complex ?? 100) < 50).forEach((r) => console.log(fmt(r)));

  console.log('\n=== FLAG: buildYear<=2005인데 complex>=80 (구축인데 단지점수 매우 높음) ===');
  scored.filter((r) => (r.buildYear ?? 9999) <= 2005 && (r.complex ?? 0) >= 80).forEach((r) => console.log(fmt(r)));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
