/**
 * STEP R4.1 — 부산 343건 sigungu 해석률 before/after 리포트.
 * DB 쓰기 없음. Kakao 주소 검색은 EXPLICIT/DONG_NAME으로 해석 안 되는 location-있는
 * 레코드에만 호출한다(전체 343건 무조건 지오코딩 금지, 섹션 24).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { fetchBusanRecords } from './import_busan';
import { extractSigunguFromLocation } from '@/lib/redevelopment/parse';
import { fetchBusanDongRegistry, buildDongNameIndex, resolveByDongName, resolveByRoadAddress, resolveByProjectName } from '@/lib/redevelopment/sigunguResolver';
import type { SigunguResolution } from '@/lib/redevelopment/sigunguResolver';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

async function main() {
  const records = await fetchBusanRecords();
  console.log(`부산 API: ${records.length}건`);

  const registry = await fetchBusanDongRegistry();
  const index = buildDongNameIndex(registry);
  console.log(`법정동 레지스트리: ${registry.length}개 동 (REGCODE_PROXY 실시간 조회)`);

  const before = records.filter((r) => r.location && extractSigunguFromLocation(r.location)).length;

  const results: Array<{ areaName: string; location: string | null; resolution: SigunguResolution }> = [];
  let roadAddressCalls = 0;

  for (const r of records) {
    const loc = r.location;
    let resolution: SigunguResolution;

    if (loc && loc.trim()) {
      const explicit = extractSigunguFromLocation(loc);
      if (explicit) {
        resolution = { sigungu: explicit, source: 'EXPLICIT', safeForMatching: true };
      } else {
        const byDong = resolveByDongName(loc, index);
        if (byDong.sigungu) {
          resolution = byDong;
        } else {
          roadAddressCalls++;
          resolution = await resolveByRoadAddress(loc);
          if (!resolution.sigungu) {
            resolution = resolveByProjectName(r.areaName, index);
          }
        }
      }
    } else {
      resolution = resolveByProjectName(r.areaName, index);
    }

    results.push({ areaName: r.areaName, location: loc, resolution });
  }

  const bySource: Record<string, number> = {};
  for (const r of results) bySource[r.resolution.source] = (bySource[r.resolution.source] ?? 0) + 1;

  const resolved = results.filter((r) => r.resolution.sigungu !== null).length;
  const safeForMatching = results.filter((r) => r.resolution.safeForMatching).length;

  console.log('\n=== BEFORE (R4, EXPLICIT literal gu/gun만) ===');
  console.log(`resolved: ${before} / ${records.length} = ${((before / records.length) * 100).toFixed(1)}%`);

  console.log('\n=== AFTER (R4.1, EXPLICIT+DONG_NAME+ROAD_ADDRESS+PROJECT_NAME) ===');
  console.log(`resolved: ${resolved} / ${records.length} = ${((resolved / records.length) * 100).toFixed(1)}%`);
  console.log(`safeForMatching(자동 matching key로 사용 가능): ${safeForMatching}`);
  console.log(`road address Kakao 호출 수: ${roadAddressCalls}`);
  console.log('소스별 분포:', JSON.stringify(bySource, null, 2));

  console.log('\n=== ROAD_ADDRESS 판정 중 office 의심으로 safeForMatching=false 처리된 샘플 ===');
  const unsafeRoad = results.filter((r) => r.resolution.source === 'ROAD_ADDRESS' && !r.resolution.safeForMatching);
  console.log(`건수: ${unsafeRoad.length}`);
  for (const r of unsafeRoad.slice(0, 10)) console.log(JSON.stringify({ areaName: r.areaName, location: r.location, sigungu: r.resolution.sigungu }));

  console.log('\n=== 여전히 UNRESOLVED 샘플(최대 15건) ===');
  const stillUnresolved = results.filter((r) => r.resolution.source === 'UNRESOLVED');
  console.log(`건수: ${stillUnresolved.length}`);
  for (const r of stillUnresolved.slice(0, 15)) console.log(JSON.stringify({ areaName: r.areaName, location: r.location }));

  // 부산 서구만 별도 집계(섹션 15)
  const seoguResults = results.filter((r) => r.resolution.sigungu === '서구');
  console.log(`\n=== 부산 서구로 해석된 BUSAN 레코드 수: ${seoguResults.length} ===`);
  for (const r of seoguResults) console.log(JSON.stringify({ areaName: r.areaName, source: r.resolution.source }));

  const outDir = path.resolve(__dirname, '_results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `sigungu_resolution_${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ before, resolved, total: records.length, bySource, safeForMatching, results }, null, 2));
  console.log(`\n상세 결과 저장: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('실패:', err);
    process.exitCode = 1;
  });
