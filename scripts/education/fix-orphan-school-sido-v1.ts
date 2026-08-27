/**
 * SCHOOL DATA GAP FIX — 부산 School 중 지역코드(sidoCode)가 비어 있는 orphan
 * 7건을 NEIS 공식 소스(SD_SCHUL_CODE 직접 조회)로 재확인해 안전하게 채운다.
 *
 * 조사 결과(직접 NEIS API 조회로 실측, 이름만으로 추정하지 않음): orphan 7건
 * 전부 NEIS 자체 레코드에도 ORG_RDNMA(도로명주소)가 null이라 구/군(sigunguCode)을
 * 확정할 공식 소스가 없다 — 억지로 채우지 않고 UNRESOLVED로 남긴다.
 *
 * 다만 ATPT_OFCDC_SC_CODE='C10'(부산광역시교육청)과 LCTN_SC_NM='부산광역시'는
 * 7건 전부 NEIS가 이미 명시하고 있고, 이 값은 애초에 이 School row들이
 * "부산" 테이블에 들어온 근거(ingest-schools-neis.ts가 C10 필터로 조회)와
 * 동일한 소스·동일한 기준이다 — 이름으로 추정한 새 정보가 아니라, 이미
 * 확보돼 있던 근거를 sidoCode 컬럼에 반영만 하는 것. 다른 657개 School row가
 * 전부 sidoCode='26'인 것과 동일한 값·동일한 근거로 채운다.
 *
 * canonical identity(neisSchoolCode)로만 조회하므로 이름 기반 매칭이 전혀
 * 없다 — 동명이교/오매칭 위험 자체가 없다.
 *
 * 사용법:
 *   npx tsx scripts/education/fix-orphan-school-sido-v1.ts           (dry-run)
 *   npx tsx scripts/education/fix-orphan-school-sido-v1.ts --apply   (실제 적용)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true } as any);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true } as any);

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const BUSAN_SIDO_CODE = '26'; // 기존 657개 School row 전부와 동일한 값(§근거 상단 주석)

interface NeisRow {
  ATPT_OFCDC_SC_CODE?: string;
  LCTN_SC_NM?: string;
  ORG_RDNMA?: string | null;
  ORG_RDNDA?: string | null;
}

async function fetchNeisByCode(apiKey: string, code: string): Promise<NeisRow | null> {
  const url = `https://open.neis.go.kr/hub/schoolInfo?KEY=${apiKey}&Type=json&SD_SCHUL_CODE=${code}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.schoolInfo?.[1]?.row?.[0] ?? null;
}

async function main() {
  const apiKey = process.env.NEIS_API_KEY;
  if (!apiKey) {
    console.error('BLOCKER: NEIS_API_KEY 미설정');
    process.exit(1);
  }

  const orphans = await prisma.school.findMany({
    where: { sidoCode: null },
    select: { id: true, neisSchoolCode: true, schoolName: true, schoolLevel: true },
  });

  console.log(`orphan 대상: ${orphans.length}건`);

  const results: Array<{
    neisSchoolCode: string | null;
    schoolName: string;
    status: 'READY' | 'UNRESOLVED' | 'SOURCE_LIMITATION';
    sidoCode: string | null;
    sigunguCode: string | null;
    reason: string;
  }> = [];

  for (const school of orphans) {
    if (!school.neisSchoolCode) {
      results.push({
        neisSchoolCode: null,
        schoolName: school.schoolName,
        status: 'UNRESOLVED',
        sidoCode: null,
        sigunguCode: null,
        reason: 'canonical neisSchoolCode 자체가 없음 — identity 불명확, 수정 대상 아님',
      });
      continue;
    }

    const row = await fetchNeisByCode(apiKey, school.neisSchoolCode);
    if (!row) {
      results.push({
        neisSchoolCode: school.neisSchoolCode,
        schoolName: school.schoolName,
        status: 'SOURCE_LIMITATION',
        sidoCode: null,
        sigunguCode: null,
        reason: 'NEIS 재조회 실패(네트워크/코드 미존재) — 추정 없이 UNRESOLVED 유지',
      });
      continue;
    }

    const isBusan = row.ATPT_OFCDC_SC_CODE === 'C10' || row.LCTN_SC_NM === '부산광역시';
    const roadAddress = row.ORG_RDNMA || null;

    if (!isBusan) {
      // 실제로는 발생하지 않았지만(§전수조사 확인), 방어적으로: 관할청이
      // 부산이 아니면 sidoCode를 임의로 채우지 않는다.
      results.push({
        neisSchoolCode: school.neisSchoolCode,
        schoolName: school.schoolName,
        status: 'IDENTITY_CONFLICT' as any,
        sidoCode: null,
        sigunguCode: null,
        reason: `NEIS 관할청이 부산이 아님(ATPT_OFCDC_SC_CODE=${row.ATPT_OFCDC_SC_CODE}) — 이 School row가 애초에 부산 테이블에 있는 것 자체가 재검토 필요, sidoCode 미기입`,
      });
      continue;
    }

    // sigunguCode는 NEIS 도로명주소가 있어야만 파생 가능(기존 ingest 스크립트와
    // 동일 방식) — 이번 7건은 전부 null이라 구/군은 채우지 않는다(§SOURCE_LIMITATION).
    results.push({
      neisSchoolCode: school.neisSchoolCode,
      schoolName: school.schoolName,
      status: 'READY',
      sidoCode: BUSAN_SIDO_CODE,
      sigunguCode: null,
      reason: roadAddress
        ? '예상외로 도로명주소가 확인됨(재조사 시점 갱신) — 그러나 구/군 파싱은 이번 스크립트 범위 밖, sidoCode만 반영'
        : 'NEIS 관할청(C10=부산광역시교육청)+지역명(부산광역시) 확인 — sidoCode만 안전하게 반영, 구/군은 NEIS에 도로명주소 자체가 없어 SOURCE_LIMITATION',
    });
  }

  console.log('\n=== 분류 결과 ===');
  for (const r of results) {
    console.log(`[${r.status}] ${r.schoolName}(${r.neisSchoolCode}) sidoCode=${r.sidoCode} — ${r.reason}`);
  }

  const readyCount = results.filter((r) => r.status === 'READY').length;
  console.log(`\nREADY=${readyCount}, 나머지=${results.length - readyCount}`);

  if (!APPLY) {
    console.log('\n(dry-run — 실제 write 없음. --apply로 재실행 시 반영)');
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.status !== 'READY' || !r.neisSchoolCode) {
      skipped++;
      continue;
    }
    // idempotency: sidoCode가 이미 채워져 있으면(재실행 시) 건드리지 않는다.
    const current = await prisma.school.findUnique({ where: { neisSchoolCode: r.neisSchoolCode }, select: { sidoCode: true } });
    if (current?.sidoCode != null) {
      skipped++;
      continue;
    }
    await prisma.school.update({ where: { neisSchoolCode: r.neisSchoolCode }, data: { sidoCode: r.sidoCode! } });
    updated++;
  }
  console.log(`\napply 완료: updated=${updated}, skipped=${skipped}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
