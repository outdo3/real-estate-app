/**
 * PRESALE P2-C 지오코딩 정확도 재검증용 일회성 스크립트.
 *
 * DB에 이미 저장된 Presale의 locationAddress를 강화된 geocodeAddress() 로직으로 다시
 * 돌려보고, 새 기준(exact/normalized만 저장, area_only는 미저장)에 맞는지 확인한다.
 * Detail/Mdl API는 다시 호출하지 않는다(전체 재동기화 금지) — Kakao 지오코딩만 재실행한다.
 *
 * 기본은 보고만 한다(DB 변경 없음). --apply를 주면, 새 기준에서 'area_only'/'failed'로
 * 판정됐는데 기존에 좌표가 저장돼 있던 레코드만 latitude/longitude를 null로 정정한다
 * (그 외 필드는 절대 건드리지 않는다).
 *
 * 사용법:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' -r ./scripts/_register-paths.js \
 *     scripts/reverify_presale_geocode.ts [--apply]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { geocodeAddress } from '../src/services/cheongyakService';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');
  const presales = await prisma.presale.findMany({
    select: { id: true, houseName: true, locationAddress: true, subscriptionAreaName: true, latitude: true, longitude: true },
    orderBy: { id: 'asc' },
  });

  console.log(`재검증 대상: ${presales.length}건 (apply=${apply})`);
  let correctedCount = 0;

  for (const p of presales) {
    if (!p.locationAddress) {
      console.log(`- [${p.id}] ${p.houseName}: 주소 없음, 건너뜀`);
      continue;
    }
    const geo = await geocodeAddress(p.locationAddress, p.subscriptionAreaName);
    const hadCoord = p.latitude != null;
    const newCategory = geo ? geo.category : 'failed';
    const shouldSave = geo && geo.category !== 'area_only';

    console.log(
      `- [${p.id}] ${p.houseName} | 기존좌표: ${hadCoord ? 'O' : 'X'} | 새 판정: ${newCategory} | ${shouldSave ? '저장 유지/갱신' : '저장 안 함(null 대상)'}`
    );

    if (!shouldSave && hadCoord) {
      correctedCount += 1;
      console.log(`    -> 기존 좌표(${p.latitude}, ${p.longitude})가 새 기준으로는 부적합 — ${apply ? '정정(null) 적용' : '정정 대상(미적용, --apply로 실행 필요)'}`);
      if (apply) {
        await prisma.presale.update({ where: { id: p.id }, data: { latitude: null, longitude: null } });
      }
    } else if (shouldSave && geo) {
      // exact/normalized로 재확인됨 — 값이 달라졌으면(드묾) 갱신, 같으면 그대로.
      if (apply && (p.latitude !== geo.lat || p.longitude !== geo.lng)) {
        await prisma.presale.update({ where: { id: p.id }, data: { latitude: geo.lat, longitude: geo.lng } });
      }
    }
  }

  console.log(`\n정정 대상(기존 좌표가 새 기준 미달): ${correctedCount}건 ${apply ? '(적용됨)' : '(미적용 — --apply로 실행 필요)'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
