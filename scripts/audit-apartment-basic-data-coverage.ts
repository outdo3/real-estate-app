/**
 * 아파트 기본 정보(세대수/준공년도/용적률/건폐율/주차대수 등) 커버리지 read-only 감사 스크립트.
 *
 * 절대 DB에 쓰지 않는다 — SELECT류 Prisma 호출만 사용한다. 이 스크립트는
 * docs/development/APARTMENT_BASIC_DATA_COVERAGE_AUDIT_V1.md STEP의 §15 산출물이며,
 * 향후 재실행해 커버리지 추이를 다시 확인하는 용도로 재사용 가능하다.
 *
 * 사용법:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/audit-apartment-basic-data-coverage.ts
 *
 * 중요한 한계(정직하게 명시): 이 스크립트가 스캔하는 `apartments` 테이블은 "부산 전체
 * 단지 목록"이 아니라 "지금까지 상세페이지가 실제로 조회된 단지만 담기는 lazy cache"다
 * (src/app/api/apt/[name]/info/route.ts의 cache-aside upsert 패턴). 따라서 여기서 계산하는
 * coverage %는 "이미 캐시된 단지 중 필드가 채워진 비율"이지 "부산 전체 단지 중 채워진
 * 비율"이 아니다 — 두 개념을 섞어 보고하지 않는다. `apartment_masters`(ApartmentMaster)는
 * 부산 서구+해운대 33건 파일럿 상태로, 이 역시 부산 전체가 아니다
 * (docs/development/14-apartment-master-m4-expansion-analysis.md 재확인).
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const prisma = new PrismaClient();

type Row = {
  id: number;
  name: string;
  dong: string | null;
  lawdCd: string | null;
  jibun: string | null;
  aptSeq: string | null;
  totalHouseholds: number | null;
  approvalDate: string | null;
  far: number | null;
  bcr: number | null;
  parkingCount: number | null;
};

function pct(n: number, total: number): string {
  if (total === 0) return 'N/A(표본 0)';
  return `${((n / total) * 100).toFixed(1)}%`;
}

async function main() {
  const rows: Row[] = await prisma.apartment.findMany({
    select: {
      id: true,
      name: true,
      dong: true,
      lawdCd: true,
      jibun: true,
      aptSeq: true,
      totalHouseholds: true,
      approvalDate: true,
      far: true,
      bcr: true,
      parkingCount: true,
    },
    orderBy: { id: 'asc' },
  });

  const masterCount = await prisma.apartmentMaster.count();
  const masterRows = await prisma.apartmentMaster.findMany({
    select: {
      aptSeq: true,
      name: true,
      sggCd: true,
      mgmBldrgstPk: true,
      buildYear: true,
      useApprovalDate: true,
      mainBuildingCount: true,
      totalHouseholds: true,
      parkingCount: true,
      latitude: true,
      longitude: true,
    },
  });

  console.log('='.repeat(70));
  console.log('APARTMENT BASIC DATA COVERAGE AUDIT (read-only)');
  console.log('='.repeat(70));
  console.log(`\n[스캔 범위] apartments(레거시 캐시) 테이블 전체 행: ${rows.length}건`);
  console.log(
    `[참고] apartment_masters(ApartmentMaster) 테이블 전체 행: ${masterCount}건 ` +
      `(부산 서구+해운대 파일럿, 부산 전체 아님 — 14-apartment-master-m4-expansion-analysis.md 참고)\n`
  );

  const total = rows.length;
  const fields: { key: keyof Row; label: string }[] = [
    { key: 'totalHouseholds', label: '세대수(totalHouseholds)' },
    { key: 'approvalDate', label: '준공년도(approvalDate)' },
    { key: 'far', label: '용적률(far)' },
    { key: 'bcr', label: '건폐율(bcr)' },
    { key: 'parkingCount', label: '주차대수(parkingCount)' },
    { key: 'jibun', label: '지번(jibun, identity)' },
    { key: 'aptSeq', label: 'aptSeq(identity)' },
  ];

  console.log('[캐시 테이블 내 필드별 커버리지] (모집단 = 이미 캐시된 단지, 부산 전체 아님)');
  for (const f of fields) {
    const present = rows.filter((r) => {
      const v = r[f.key];
      return v !== null && v !== undefined && v !== '';
    }).length;
    console.log(`  ${f.label.padEnd(28, ' ')}: ${present}/${total} (${pct(present, total)})`);
  }

  // 패턴 분류
  const hasHousehold = (r: Row) => !!r.totalHouseholds;
  const hasBuildYear = (r: Row) => !!r.approvalDate;
  const hasFar = (r: Row) => r.far !== null && r.far !== undefined;
  const hasBcr = (r: Row) => r.bcr !== null && r.bcr !== undefined;
  const hasParking = (r: Row) => r.parkingCount !== null && r.parkingCount !== undefined;
  const hasJibun = (r: Row) => !!r.jibun;

  const patternA = rows.filter(
    (r) => hasHousehold(r) && hasBuildYear(r) && !hasFar(r) && !hasBcr(r) && !hasParking(r)
  );
  const patternC = rows.filter((r) => hasFar(r) && hasBcr(r) && !hasParking(r));
  const patternD = rows.filter((r) => !hasFar(r) && !hasBcr(r) && hasParking(r));
  const patternE = rows.filter((r) => !hasJibun(r) || !r.lawdCd || !r.dong);

  console.log('\n[고가치 결측 패턴]');
  console.log(
    `  (A) 세대수+준공년도는 있는데 FAR/BCR/주차 전부 없음: ${patternA.length}건 — ` +
      `예: ${patternA.slice(0, 5).map((r) => r.name).join(', ') || '(없음)'}`
  );
  console.log(
    `  (C) 주차만 없음(FAR/BCR는 있음): ${patternC.length}건 — ` +
      `예: ${patternC.slice(0, 5).map((r) => r.name).join(', ') || '(없음)'}`
  );
  console.log(
    `  (D) FAR/BCR만 없음(주차는 있음): ${patternD.length}건 — ` +
      `예: ${patternD.slice(0, 5).map((r) => r.name).join(', ') || '(없음)'}`
  );
  console.log(
    `  (E) identity 불완전(jibun/lawdCd/dong 중 결측): ${patternE.length}건 — ` +
      `예: ${patternE.slice(0, 5).map((r) => r.name).join(', ') || '(없음)'}`
  );

  const present3 = rows.filter((r) => hasFar(r) && hasBcr(r) && hasParking(r)).slice(0, 3);
  const missing3 = rows.filter((r) => !hasFar(r) && !hasBcr(r) && !hasParking(r)).slice(0, 3);

  console.log('\n[비교 표본] FAR/BCR/주차 전부 있는 단지 (최대 3건)');
  present3.forEach((r) =>
    console.log(`  - ${r.name} (dong=${r.dong}, aptSeq=${r.aptSeq}, far=${r.far}, bcr=${r.bcr}, parking=${r.parkingCount})`)
  );
  console.log('\n[비교 표본] FAR/BCR/주차 전부 없는 단지 (최대 3건)');
  missing3.forEach((r) =>
    console.log(`  - ${r.name} (dong=${r.dong}, aptSeq=${r.aptSeq}, jibun=${r.jibun}, household=${r.totalHouseholds})`)
  );

  // 주의: 이름만으로 찾지 않는다 — "한솔솔파크"는 연제구(연산동)/해운대구(우동) 두 개의
  // 서로 다른 단지에 공용되는 이름이다. dong까지 함께 확인해 연제구 연산동만 매칭한다.
  const target = rows.find((r) => r.name.includes('한솔솔파크') && r.dong === '연산동');
  console.log('\n[Primary case] 연산동한솔솔파크 — apartments(레거시 캐시)');
  if (target) {
    console.log('  ' + JSON.stringify(target, null, 2).split('\n').join('\n  '));
  } else {
    console.log('  캐시 테이블에 행 없음 (건축물대장 조회가 매번 실패해 upsert 자체가 한 번도 발생하지 않음 — 매 요청마다 라이브 재조회)');
  }

  // 주의: 이름만으로 찾으면 안 된다 — "한솔솔파크"라는 이름은 연제구(연산동)와 해운대구(우동)
  // 양쪽에 존재하는 서로 다른 두 단지다(brand-name collision, AGENTS.md "이름만으로
  // 재식별 금지" 원칙 실제 재현 사례). 반드시 aptSeq(26470-1040, 연제구)로만 식별한다.
  const targetMaster = masterRows.find((r) => r.aptSeq === '26470-1040');
  console.log('\n[Primary case] 연산동한솔솔파크 — apartment_masters(ApartmentMaster, 부산 전체 M4-B)');
  if (targetMaster) {
    console.log('  ' + JSON.stringify(targetMaster, null, 2).split('\n').join('\n  '));
  } else {
    console.log('  apartment_masters에 aptSeq=26470-1040 행 없음');
  }

  // ── Busan-wide coverage (ApartmentMaster, 부산 전체 M4-B 결과물) ──
  const mTotal = masterRows.length;
  console.log('\n[Busan-wide coverage] apartment_masters 전체 ' + mTotal + '건 (부산 M4-B 산출물)');
  const mFields: { key: keyof (typeof masterRows)[number]; label: string }[] = [
    { key: 'buildYear', label: '준공년도(buildYear)' },
    { key: 'useApprovalDate', label: '사용승인일(useApprovalDate)' },
    { key: 'mainBuildingCount', label: '동수(mainBuildingCount)' },
    { key: 'totalHouseholds', label: '세대수(totalHouseholds)' },
    { key: 'parkingCount', label: '주차대수(parkingCount)' },
    { key: 'mgmBldrgstPk', label: '건축물대장 관리번호(mgmBldrgstPk)' },
    { key: 'latitude', label: '좌표(latitude)' },
  ];
  for (const f of mFields) {
    const present = masterRows.filter((r) => {
      const v = r[f.key];
      return v !== null && v !== undefined;
    }).length;
    console.log(`  ${f.label.padEnd(30, ' ')}: ${present}/${mTotal} (${pct(present, mTotal)})`);
  }
  console.log('  용적률(far)                       : 0/' + mTotal + ' — 컬럼 자체가 스키마에 없음(SOURCE_MISSING at schema level, ApartmentMaster는 far/bcr 필드를 설계 시점부터 포함하지 않음)');
  console.log('  건폐율(bcr)                       : 0/' + mTotal + ' — 위와 동일');

  // 구/군별 분포 (sggCd 기준)
  const bySgg = new Map<string, { total: number; hasParking: number; hasHousehold: number }>();
  for (const r of masterRows) {
    const key = r.sggCd || 'null';
    const cur = bySgg.get(key) || { total: 0, hasParking: 0, hasHousehold: 0 };
    cur.total++;
    if (r.parkingCount !== null && r.parkingCount !== undefined) cur.hasParking++;
    if (r.totalHouseholds !== null && r.totalHouseholds !== undefined) cur.hasHousehold++;
    bySgg.set(key, cur);
  }
  console.log('\n[구/군별(sggCd) 분포] 상위 20개');
  Array.from(bySgg.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 20)
    .forEach(([sgg, v]) => {
      console.log(
        `  ${sgg}: 총 ${v.total}건, 세대수 ${v.hasHousehold}건(${pct(v.hasHousehold, v.total)}), 주차 ${v.hasParking}건(${pct(v.hasParking, v.total)})`
      );
    });

  console.log('\n' + '='.repeat(70));
  console.log('감사 종료. DB 쓰기 없음(read-only). ');
  console.log('='.repeat(70));
}

main()
  .catch((e) => {
    console.error('[audit] 오류:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
