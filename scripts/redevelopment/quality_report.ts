/**
 * STEP R4 — Quality report + 부산 서구 검증(섹션 41/42~45).
 *
 * MOLIT CSV(1,566행) + 부산 API(343건)를 실제로 받아 파싱하고, ingestRecord()를
 * InMemoryRedevelopmentStore에 대해 그대로 실행해(코드 경로 100% 동일, DB만 인메모리)
 * 매칭/병합 결과를 집계한다. production DB에는 아무것도 쓰지 않는다(migration이 아직
 * 적용되지 않은 현재 상태에서도 실행 가능 — 섹션 40 dry-run 요구사항의 "match
 * simulation"에 해당).
 *
 * 사용법:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' -r ./scripts/_register-paths.js \
 *     scripts/redevelopment/quality_report.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { fetchAndParseMolitRows } from './import_molit';
import { fetchBusanRecords } from './import_busan';
import { parseBusanRecord } from '@/lib/redevelopment/parse';
import { ingestRecord } from '@/lib/redevelopment/ingest';
import { InMemoryRedevelopmentStore } from '@/lib/redevelopment/inMemoryStore';
import { fetchBusanDongRegistry, buildDongNameIndex, resolveBusanSigungu } from '@/lib/redevelopment/sigunguResolver';
import { SOURCE_BUSAN, SOURCE_MOLIT } from '@/lib/redevelopment/types';
import type { ParsedSourceRecord } from '@/lib/redevelopment/types';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

async function main() {
  console.log('[quality_report] MOLIT CSV 수신 중...');
  const molitParsed = await fetchAndParseMolitRows();
  console.log(`[quality_report] MOLIT: ${molitParsed.length}행`);

  console.log('[quality_report] 부산 API 수신 중...');
  const busanRaw = await fetchBusanRecords();
  console.log(`[quality_report] 부산: ${busanRaw.length}건`);

  console.log('[quality_report] 부산 sigungu 해석 중(REGCODE_PROXY + 도로명 지오코딩, R4.1)...');
  const registry = await fetchBusanDongRegistry();
  const index = buildDongNameIndex(registry);
  let sigunguResolvedButUnsafe = 0;
  const sigunguBySource: Record<string, number> = {};
  const busanParsed: ParsedSourceRecord[] = [];
  for (const r of busanRaw) {
    const resolution = await resolveBusanSigungu(r.areaName, r.location, index);
    sigunguBySource[resolution.source] = (sigunguBySource[resolution.source] ?? 0) + 1;
    const sigunguForMatching = resolution.sigungu && resolution.safeForMatching ? resolution.sigungu : null;
    if (resolution.sigungu && !resolution.safeForMatching) sigunguResolvedButUnsafe++;
    busanParsed.push(parseBusanRecord(r, '부산광역시', sigunguForMatching));
  }
  console.log(`[quality_report] sigungu 해석 소스별: ${JSON.stringify(sigunguBySource)}, unsafe-for-matching: ${sigunguResolvedButUnsafe}`);

  // MOLIT fingerprint 중복 흡수(import_molit.ts와 동일 정책)
  const molitBySourceRecordId = new Map<string, ParsedSourceRecord>();
  for (const rec of molitParsed) molitBySourceRecordId.set(rec.sourceRecordId, rec);
  const molitUnique = [...molitBySourceRecordId.values()];

  const store = new InMemoryRedevelopmentStore();
  const now = new Date();

  // 국토부 먼저(존재/canonical 우선순위 정책과 일관되게 먼저 넣는다), 그다음 부산.
  const outcomes: Array<{ source: string; matchConfidence: string; mergeStatus: string; action: string }> = [];
  for (const rec of molitUnique) {
    const outcome = await ingestRecord(store, rec, now);
    outcomes.push(outcome);
  }
  for (const rec of busanParsed) {
    const outcome = await ingestRecord(store, rec, now);
    outcomes.push(outcome);
  }

  const projects = store.getAllProjects();
  const sourceRecords = store.getAllSourceRecords();

  const molitOnly = projects.filter((p) => !sourceRecords.some((r) => r.projectId === p.id && r.source === SOURCE_BUSAN));
  const busanOnly = projects.filter((p) => !sourceRecords.some((r) => r.projectId === p.id && r.source === SOURCE_MOLIT));
  const merged = projects.filter(
    (p) =>
      sourceRecords.some((r) => r.projectId === p.id && r.source === SOURCE_MOLIT) &&
      sourceRecords.some((r) => r.projectId === p.id && r.source === SOURCE_BUSAN)
  );

  const confidenceCounts: Record<string, number> = { EXACT: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNMATCHED: 0 };
  for (const o of outcomes) confidenceCounts[o.matchConfidence] = (confidenceCounts[o.matchConfidence] ?? 0) + 1;

  const report = {
    generatedAt: now.toISOString(),
    input: { molitRowsFetched: molitParsed.length, molitRowsUnique: molitUnique.length, busanRecordsFetched: busanParsed.length },
    output: {
      canonicalProjects: projects.length,
      sourceRecords: sourceRecords.length,
      molitOnlyProjects: molitOnly.length,
      busanOnlyProjects: busanOnly.length,
      mergedProjects: merged.length,
    },
    matchConfidence: confidenceCounts,
    unknownBusinessType: sourceRecords.filter((r) => {
      const isMolit = r.source === SOURCE_MOLIT;
      return isMolit ? !r.rawBusinessType : false; // 부산은 애초에 공식 필드가 없어 UNKNOWN 집계 대상 아님(참고용 추정만)
    }).length,
    needsReviewProjects: projects.filter((p) => p.needsReview).length,
    busanSigunguUnresolved: busanParsed.filter((r) => r.sigungu === '미상').length,
    locationClassification: {
      PROJECT_SITE: projects.filter((p) => p.locationType === 'PROJECT_SITE').length,
      OFFICE: projects.filter((p) => p.locationType === 'OFFICE').length,
      APPROXIMATE: projects.filter((p) => p.locationType === 'APPROXIMATE').length,
      UNKNOWN: projects.filter((p) => !p.locationType || p.locationType === 'UNKNOWN').length,
    },
  };

  console.log('[quality_report] 요약:');
  console.log(JSON.stringify(report, null, 2));

  // 섹션 42~45: 부산 서구 검증
  const seoguProjects = projects.filter((p) => p.sido === '부산광역시' && p.sigungu === '서구');
  console.log(`\n[quality_report] 부산 서구 canonical project 수: ${seoguProjects.length}`);

  const findByName = (needle: string) => projects.filter((p) => p.canonicalName.includes(needle) || p.normalizedName.includes(needle));

  const seodaesin4 = findByName('서대신4');
  const ami1 = findByName('아미1');
  const ami3 = findByName('아미3');

  console.log('[quality_report] 서대신4:', JSON.stringify(seodaesin4.map((p) => ({ id: p.id, sources: sourceRecords.filter((r) => r.projectId === p.id).map((r) => r.source), stage: p.stage, householdCount: p.householdCount })), null, 2));
  console.log('[quality_report] 아미1:', JSON.stringify(ami1.map((p) => ({ id: p.id, sources: sourceRecords.filter((r) => r.projectId === p.id).map((r) => r.source), businessType: p.businessType, stage: p.stage })), null, 2));
  console.log('[quality_report] 아미3:', JSON.stringify(ami3.map((p) => ({ id: p.id, sources: sourceRecords.filter((r) => r.projectId === p.id).map((r) => r.source), businessType: p.businessType, stage: p.stage })), null, 2));

  const sidoSet = new Set(projects.map((p) => p.sido));
  console.log(`\n[quality_report] 전국 시도 coverage: ${sidoSet.size}개 — ${[...sidoSet].join(', ')}`);

  // 섹션 19(수동 검증용) + 섹션 20(collision 검사용) — merged(양쪽 소스 연결) 전체를
  // 사업명/구군/사업유형/세대수/stage와 함께 저장한다.
  const mergedDetailed = merged.map((p) => {
    const records = sourceRecords.filter((r) => r.projectId === p.id);
    return {
      id: p.id,
      canonicalName: p.canonicalName,
      normalizedName: p.normalizedName,
      sido: p.sido,
      sigungu: p.sigungu,
      businessType: p.businessType,
      stage: p.stage,
      householdCount: p.householdCount,
      needsReview: p.needsReview,
      sourceRecords: records.map((r) => ({
        source: r.source,
        rawName: r.rawName,
        rawBusinessType: r.rawBusinessType,
        rawStage: r.rawStage,
        rawHouseholdCount: r.rawHouseholdCount,
        matchConfidence: r.matchConfidence,
      })),
    };
  });

  const outDir = path.resolve(__dirname, '_results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `quality_report_${now.toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        report,
        seoguProjects: seoguProjects.map((p) => ({ id: p.id, name: p.canonicalName, stage: p.stage, businessType: p.businessType })),
        seodaesin4,
        ami1,
        ami3,
        sidoList: [...sidoSet],
        mergedDetailed,
      },
      null,
      2
    )
  );
  console.log(`\n[quality_report] 상세 결과 저장: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[quality_report] 실패:', err);
    process.exitCode = 1;
  });
