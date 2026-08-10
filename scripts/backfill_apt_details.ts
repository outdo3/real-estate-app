/**
 * apartments 테이블의 parking_count/far/bcr(주차대수/용적률/건폐율) 중 비어있는 값을
 * 건축물대장 공공데이터로 채우는 배치 스크립트.
 *
 * 사용법:
 *   # DB에 이미 있는 단지 중 값이 비어있는 것만 전부 채우기 (기본 동작)
 *   npx ts-node scripts/backfill_apt_details.ts
 *
 *   # DB에 아직 없는 단지 하나를 새로 추가/갱신 (jibun 필수 — 아래 "jibun이 꼭 필요한 이유" 참고)
 *   npx ts-node scripts/backfill_apt_details.ts --name "단지명" --lawdCd 11680 --dong 역삼동 --jibun 123-45
 *
 *   # 여러 단지를 한 번에 (crawl_facilities.py의 --list와 동일한 형식, 각 항목에 jibun 필수)
 *   npx ts-node scripts/backfill_apt_details.ts --list ./targets.json
 *
 * ts-node가 tsconfig의 module:esnext를 그대로 쓰면 실행이 안 되므로(실측 확인: "Unknown
 * file extension .ts") commonjs로 강제해야 한다:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill_apt_details.ts ...
 *
 * jibun이 꼭 필요한 이유: 건축물대장 공공데이터(총괄표제부)는 지번 없이 법정동 전체를
 * 조회하면 페이지네이션이 무시되고 그 동에서 등록번호가 가장 앞선 건물(군사시설·관공서인
 * 경우가 흔했음) 딱 1건만 돌려준다 — 실측으로 확인된 이 API 자체의 한계다. jibun 없는
 * 대상은 조용히 건너뛴다(엉뚱한 건물 값을 그 단지 것처럼 잘못 저장하는 것보다 안전).
 * /api/apt/[name]/info 라우트가 실거래 데이터에서 얻은 jibun으로 조회할 때마다 DB에
 * jibun을 저장해두므로, 이 스크립트의 기본 모드(인자 없이 실행)는 그렇게 이미 jibun이
 * 채워진 단지만 자동으로 골라 처리한다.
 *
 * /api/apt/[name]/info 라우트가 페이지뷰마다 조금씩 채우는 것과 별개로, 미리 대량으로
 * 채워두고 싶을 때 쓰는 도구다. 조회 로직(src/lib/apt-building-info.ts)은 라우트와
 * 완전히 동일한 함수를 공유하므로 결과가 어긋나지 않는다.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { fetchBuildingRegistryInfo } from '../src/lib/apt-building-info';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const prisma = new PrismaClient();

interface Target {
  name: string;
  lawdCd: string;
  dong: string;
  jibun?: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    name: get('--name'),
    lawdCd: get('--lawdCd'),
    dong: get('--dong'),
    jibun: get('--jibun'),
    listFile: get('--list'),
  };
}

async function loadTargetsFromMissingRows(): Promise<Target[]> {
  const rows = await prisma.apartment.findMany({
    where: {
      OR: [{ parkingCount: null }, { far: null }, { bcr: null }],
      lawdCd: { not: null },
      dong: { not: null },
      jibun: { not: null },
    },
  });
  return rows
    .filter((r) => r.lawdCd && r.dong && r.jibun)
    .map((r) => ({ name: r.name, lawdCd: r.lawdCd as string, dong: r.dong as string, jibun: r.jibun as string }));
}

async function backfillOne(target: Target): Promise<void> {
  if (!target.jibun) {
    console.log(`[건너뜀] ${target.name}(${target.dong}): jibun이 없어 조회할 수 없습니다.`);
    return;
  }
  const registry = await fetchBuildingRegistryInfo(target.name, target.lawdCd, target.dong, target.jibun);
  if (!registry || (!registry.parkingCount && !registry.far && !registry.bcr)) {
    console.log(`[실패] ${target.name}(${target.dong}): 건축물대장에서 값을 찾지 못했습니다.`);
    return;
  }

  await prisma.apartment.upsert({
    where: { name_dong: { name: target.name, dong: target.dong } },
    create: {
      name: target.name,
      dong: target.dong,
      lawdCd: target.lawdCd,
      jibun: target.jibun,
      parkingCount: registry.parkingCount ?? undefined,
      far: registry.far ?? undefined,
      bcr: registry.bcr ?? undefined,
      totalHouseholds: registry.totalHouseholds ?? undefined,
    },
    update: {
      ...(registry.parkingCount ? { parkingCount: registry.parkingCount } : {}),
      ...(registry.far ? { far: registry.far } : {}),
      ...(registry.bcr ? { bcr: registry.bcr } : {}),
      ...(registry.totalHouseholds ? { totalHouseholds: registry.totalHouseholds } : {}),
    },
  });

  console.log(
    `[성공] ${target.name}(${target.dong}) -> 주차 ${registry.parkingCount ?? '-'}대, 용적률 ${registry.far ?? '-'}%, 건폐율 ${registry.bcr ?? '-'}%`
  );
}

async function main() {
  const { name, lawdCd, dong, jibun, listFile } = parseArgs();

  let targets: Target[];
  if (listFile) {
    const raw = JSON.parse(fs.readFileSync(listFile, 'utf-8'));
    targets = raw.map((t: any) => ({ name: t.name, lawdCd: t.lawdCd, dong: t.dong, jibun: t.jibun }));
  } else if (name && lawdCd && dong) {
    targets = [{ name, lawdCd, dong, jibun }];
  } else {
    console.log('대상이 지정되지 않아 DB에서 값이 비어있는 단지를 자동으로 찾습니다...');
    targets = await loadTargetsFromMissingRows();
    if (targets.length === 0) {
      console.log('보완이 필요한 단지가 없습니다(모두 채워져 있거나, DB에 lawdCd/dong이 있는 단지가 아직 없음).');
      return;
    }
    console.log(`${targets.length}개 단지를 처리합니다.`);
  }

  let ok = 0;
  for (const t of targets) {
    try {
      await backfillOne(t);
      ok++;
    } catch (e) {
      console.error(`[오류] ${t.name}:`, e);
    }
    // 건축물대장 공공데이터포털에도 초당 요청 제한이 있으므로 요청 사이 짧게 대기한다.
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n완료: ${targets.length}건 중 처리 시도 ${targets.length}건`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
