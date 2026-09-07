/**
 * OFFICETEL_MAP_LAYER_V1 §22 — 부산 16개 구·군별 지도 마커 커버리지 실측 (STRICT READ ONLY).
 *
 * 지도 레이어는 "저장된 좌표"만 쓴다(런타임 지오코딩 금지). 그래서 구별로
 *   master 수 / 좌표 보유 수(=마커로 뜰 수 있는 수) / 제외 수
 * 를 추정 없이 센다. 좌표가 없는 master는 마커에서 제외되며 그 사실을 숫자로 남긴다.
 *
 * 또한 동일 좌표를 공유하는 master 그룹(SITE_LEVEL 의심)을 세어, 지도에서 완전히
 * 겹쳐 선택 불가능해질 수 있는 규모를 파악한다 — 좌표가 같다는 이유로 서로 다른
 * master를 하나로 합치지 않기 위한 근거 데이터다(§10).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '../../src/lib/prisma';
import { getOfficetelMarkersByLawdCd } from '../../src/lib/officetel/map-marker-read';

const BUSAN_SGG: Record<string, string> = {
  '26110': '중구', '26140': '서구', '26170': '동구', '26200': '영도구',
  '26230': '부산진구', '26260': '동래구', '26290': '남구', '26320': '북구',
  '26350': '해운대구', '26380': '사하구', '26410': '금정구', '26440': '강서구',
  '26470': '연제구', '26500': '수영구', '26530': '사상구', '26710': '기장군',
};

async function main() {
  console.log('OFFICETEL_MAP_LAYER_V1 §22 — BUSAN DISTRICT MARKER COVERAGE (READ ONLY)\n');

  const rows: any[] = await prisma.$queryRawUnsafe(`
    SELECT sgg_cd,
           COUNT(*)::int AS masters,
           COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS with_geo
    FROM officetel_masters
    GROUP BY sgg_cd
    ORDER BY sgg_cd
  `);

  let tm = 0, tg = 0;
  console.log('sggCd  구·군      master  좌표(마커)  제외');
  for (const r of rows) {
    const name = BUSAN_SGG[r.sgg_cd] ?? '(부산 외)';
    const excluded = r.masters - r.with_geo;
    tm += r.masters; tg += r.with_geo;
    console.log(
      `${r.sgg_cd}  ${name.padEnd(8)}  ${String(r.masters).padStart(5)}  ${String(r.with_geo).padStart(9)}  ${String(excluded).padStart(4)}`
    );
  }
  console.log(`\n합계: master ${tm}건 / 좌표 ${tg}건 / 제외 ${tm - tg}건`);
  console.log(`부산 구·군 등장 수: ${rows.filter((r) => BUSAN_SGG[r.sgg_cd]).length} / 16`);
  const maxPerSgg = rows.reduce((a: number, r: any) => Math.max(a, r.with_geo), 0);
  console.log(`한 구 최대 마커 수(=한 번의 레이어 fetch 최대 payload): ${maxPerSgg}건`);

  // 완전 동일 좌표를 공유하는 master 그룹.
  const dup: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS groups, COALESCE(SUM(c),0)::int AS masters_in_groups, COALESCE(MAX(c),0)::int AS max_group
    FROM (
      SELECT latitude, longitude, COUNT(*)::int AS c
      FROM officetel_masters
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      GROUP BY latitude, longitude
      HAVING COUNT(*) > 1
    ) t
  `);
  console.log(
    `\n동일 좌표 공유: 그룹 ${dup[0].groups}개 / 해당 master ${dup[0].masters_in_groups}건 / 최대 그룹 크기 ${dup[0].max_group}`
  );

  // 표시명이 비어 있는 master(§8 blank-name fallback 대상) 중 좌표를 가진 수.
  const blank: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n
    FROM officetel_masters
    WHERE btrim(officetel_name) = '' AND latitude IS NOT NULL AND longitude IS NOT NULL
  `);
  console.log(`표시명 없는 master 중 마커 대상: ${blank[0].n}건`);

  // 실제 지도 READ 계층(getOfficetelMarkersByLawdCd)을 구별로 그대로 호출한다 —
  // 위 raw SQL 집계와 숫자가 일치해야 "화면이 받는 것"과 "DB에 있는 것"이 같다고 말할 수 있다.
  console.log('\n== READ 계층 구별 호출(응답 그대로) ==');
  let sumMarkers = 0, sumExcluded = 0, sumMasters = 0, mismatches = 0;
  for (const [code, name] of Object.entries(BUSAN_SGG)) {
    const t0 = Date.now();
    const payload = await getOfficetelMarkersByLawdCd(code);
    const ms = Date.now() - t0;
    sumMarkers += payload.markers.length;
    sumExcluded += payload.excludedNoCoordinate;
    sumMasters += payload.masterCount;
    const expected = rows.find((r) => r.sgg_cd === code);
    const ok = expected && expected.with_geo === payload.markers.length && expected.masters === payload.masterCount;
    if (!ok) mismatches += 1;
    // identity/좌표 계약 검증: 모든 마커가 유효 좌표 + 고유 id + canonicalKey를 갖는다.
    const badGeo = payload.markers.filter((m) => !Number.isFinite(m.lat) || !Number.isFinite(m.lng)).length;
    const ids = new Set(payload.markers.map((m) => m.id));
    const keys = new Set(payload.markers.map((m) => m.canonicalKey));
    const blankName = payload.markers.filter((m) => m.displayName.endsWith(' 오피스텔')).length;
    console.log(
      `${code} ${name.padEnd(6)} marker=${String(payload.markers.length).padStart(4)} master=${String(payload.masterCount).padStart(4)} excluded=${payload.excludedNoCoordinate} ` +
      `badGeo=${badGeo} uniqIds=${ids.size} uniqKeys=${keys.size} 이름폴백=${blankName} ${ms}ms ${ok ? 'OK' : 'MISMATCH'}`
    );
  }
  console.log(`\nREAD 합계: marker=${sumMarkers} master=${sumMasters} excluded=${sumExcluded} / 집계 불일치 구=${mismatches}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
