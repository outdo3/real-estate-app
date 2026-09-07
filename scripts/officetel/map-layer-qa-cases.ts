/**
 * OFFICETEL_MAP_LAYER_V1 §21 — 지도 QA에 쓸 실제 Production 케이스를 뽑는다 (READ ONLY).
 * 좌표 공유 그룹 / 표시명 없는 master / 좌표 없는 master / 지정 id를 실제 값으로 확인한다.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '../../src/lib/prisma';

async function main() {
  console.log('== C. 동일 좌표 공유 그룹(상위 5) ==');
  const groups: any[] = await prisma.$queryRawUnsafe(`
    SELECT latitude, longitude, COUNT(*)::int AS c, array_agg(id ORDER BY id) AS ids,
           array_agg(sgg_cd ORDER BY id) AS sggs
    FROM officetel_masters
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    GROUP BY latitude, longitude
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, latitude
    LIMIT 5
  `);
  for (const g of groups) {
    console.log(`  ${g.c}개 @ ${g.latitude},${g.longitude} sgg=${g.sggs[0]} ids=${g.ids.join(',')}`);
  }

  console.log('\n== B. 표시명 없는 master(좌표 보유) 상위 3 ==');
  const blanks: any[] = await prisma.$queryRawUnsafe(`
    SELECT id, sgg_cd, umd_nm, jibun, latitude, longitude
    FROM officetel_masters
    WHERE btrim(officetel_name) = '' AND latitude IS NOT NULL
    ORDER BY id LIMIT 3
  `);
  for (const b of blanks) console.log(`  id=${b.id} sgg=${b.sgg_cd} ${b.umd_nm} ${b.jibun} @ ${b.latitude},${b.longitude}`);

  console.log('\n== E. 좌표 없는 master 전체(지도에서 제외되어야 함) ==');
  const nogeo: any[] = await prisma.$queryRawUnsafe(`
    SELECT id, sgg_cd, umd_nm, jibun, officetel_name
    FROM officetel_masters WHERE latitude IS NULL OR longitude IS NULL ORDER BY id
  `);
  for (const n of nogeo) console.log(`  id=${n.id} sgg=${n.sgg_cd} ${n.umd_nm} ${n.jibun} "${n.officetel_name}"`);

  console.log('\n== D. id=2243 ==');
  const one = await prisma.officetelMaster.findUnique({
    where: { id: 2243 },
    select: { id: true, canonicalKey: true, officetelName: true, sggCd: true, umdNm: true, jibun: true, hoCnt: true, latitude: true, longitude: true },
  });
  console.log('  ', JSON.stringify(one));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
