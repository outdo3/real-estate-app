// E-JIP SCORE V2 STEP 0.7 §5/§6 — name normalization 검증 + 동일 정규화이름+lawdCd
// collision 감사. 목적: "이름 유사도만으로 merge 금지" 원칙의 근거를 부산 전체
// 실측으로 수치화한다 — normalizedName을 merge key로 쓰면 안 되는 이유를 구체적
// 충돌 건수로 증명. READ-ONLY.
import { prisma } from '../../src/lib/prisma';

// §5: 기존 두 normalize 함수가 차수(1차/2차 등)를 보존하는지 재확인(공백+"아파트"
// 접미사만 제거, 문자열 재배치/치환 없음 — apartment_master_seed.ts:normalizeName과
// 완전히 동일 로직, 이번 STEP에서는 이 함수를 그대로 재사용한다).
function normalizeName(name: string): string {
  return String(name || '').replace(/\s+/g, '').replace(/아파트$/, '');
}

async function main() {
  console.log('[§5] name normalization 안전성 재확인(재사용 대상: apartment_master_seed.ts:normalizeName)');
  const chasuCases = ['롯데캐슬', '롯데캐슬아파트', '롯데캐슬1차', '롯데캐슬2차', '롯데캐슬1차아파트'];
  for (const c of chasuCases) console.log(`  "${c}" → "${normalizeName(c)}"`);
  const distinctAfterNorm = new Set(chasuCases.map(normalizeName)).size;
  console.log(`  5개 입력 → ${distinctAfterNorm}개 서로 다른 정규화 결과(차수 구분 보존 확인, 4여야 정상: 1차/1차아파트만 동일)`);

  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null } },
    select: { aptSeq: true, name: true, normalizedName: true, sggCd: true, jibun: true, roadAddress: true, buildYear: true },
  });

  // normalizedName 자체 재계산 검증 — DB 저장값과 재계산값이 다르면 별도 원인 조사 필요
  let mismatchCount = 0;
  for (const m of masters) {
    if (normalizeName(m.name) !== m.normalizedName) mismatchCount++;
  }
  console.log(`\nDB 저장된 normalizedName과 재계산 불일치: ${mismatchCount}/${masters.length}건`);

  console.log('\n[§6] 부산 전체 same normalizedName + same lawdCd(sggCd) 그룹 조사(merge 아님, 감사용)');
  const groups = new Map<string, typeof masters>();
  for (const m of masters) {
    const key = `${m.sggCd}::${m.normalizedName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  const multiGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  console.log(`동일 normalizedName+lawdCd 그룹 수(2건 이상): ${multiGroups.length}개, 관련 row 총합: ${multiGroups.reduce((s, [, r]) => s + r.length, 0)}건`);

  let ambiguousGroups = 0; // distinct jibun 2개 이상 = 서로 다른 실제 필지 = 절대 자동 merge 금지
  let sameLotDuplicateAptSeq = 0; // distinct jibun 1개인데 aptSeq가 여러 개(재건축/이력 등 별도 조사 필요)
  const ambiguousSamples: any[] = [];
  for (const [key, rows] of multiGroups) {
    const distinctJibun = new Set(rows.map((r) => r.jibun ?? 'null')).size;
    const distinctRoad = new Set(rows.map((r) => r.roadAddress ?? 'null')).size;
    const distinctYear = new Set(rows.map((r) => r.buildYear ?? -1)).size;
    const distinctSeq = new Set(rows.map((r) => r.aptSeq)).size;
    if (distinctJibun > 1) {
      ambiguousGroups++;
      if (ambiguousSamples.length < 8) {
        ambiguousSamples.push({ key, count: rows.length, distinctJibun, distinctRoad, distinctYear, distinctSeq, rows: rows.map((r) => ({ aptSeq: r.aptSeq, name: r.name, jibun: r.jibun, buildYear: r.buildYear })) });
      }
    } else if (distinctSeq > 1) {
      sameLotDuplicateAptSeq++;
    }
  }
  console.log(`\nambiguous(동일 이름+구·군인데 distinct jibun 2개 이상 = 서로 다른 필지, 자동 recovery 절대 금지): ${ambiguousGroups}개 그룹`);
  console.log(`동일 jibun(같은 필지)인데 aptSeq가 2개 이상(재건축/거래이력 분리 등 별도 조사 필요): ${sameLotDuplicateAptSeq}개 그룹`);
  console.log('\nambiguous 그룹 샘플(최대 8개):');
  ambiguousSamples.forEach((s) => console.log(JSON.stringify(s, null, 1)));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
