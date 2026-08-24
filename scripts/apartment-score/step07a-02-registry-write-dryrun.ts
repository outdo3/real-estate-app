// E-JIP SCORE V2 STEP 0.7-A §5/§6/§7 — HIGH-only hard guard + dry-run report.
// 입력: step07a-01의 output/step07a-recovery-classification.json.
// 이 스크립트는 절대 DB write를 하지 않는다(read-only) — write candidate 목록과
// before/after diff, anomaly gate 결과만 산출해 output/step07a-write-plan.json에 저장.
// STEP 0.7 §26에서 승인 대상으로 명시한 4개 필드만 다룬다: roadAddress, jibunAddress,
// totalHouseholds, mgmBldrgstPk. (mainBuildingCount/parkingCount/useApprovalDate도
// registry probe에 있으나 §26 승인 범위 밖이라 이번 write에 포함하지 않는다 — 필요시
// 별도 STEP에서 재논의.)
import fs from 'fs';
import path from 'path';
import { isNameGuardExcluded, isUniverseConfirmedApartment, applyFieldPrecedence } from './lib/step07a-write-guards';

const IN_PATH = path.resolve(__dirname, 'output/step07a-recovery-classification.json');
const OUT_PATH = path.resolve(__dirname, 'output/step07a-write-plan.json');

async function main() {
  const { prisma } = await import('../../src/lib/prisma');

  const data = JSON.parse(fs.readFileSync(IN_PATH, 'utf-8'));
  const classified: any[] = data.classified;
  console.log(`입력: ${classified.length}건 (drift ${data.driftTotal}건)`);

  const byLevel: Record<string, any[]> = { RECOVERY_HIGH: [], RECOVERY_MEDIUM: [], RECOVERY_REVIEW: [], RECOVERY_FAILED: [] };
  for (const c of classified) byLevel[c.recovery.level].push(c);
  console.log('등급별:', Object.fromEntries(Object.entries(byLevel).map(([k, v]) => [k, v.length])));

  // §5 HIGH-only hard guard(lib/step07a-write-guards.ts 재사용)
  let highOnly = byLevel.RECOVERY_HIGH;
  const excludedByNameGuard = highOnly.filter((c) => isNameGuardExcluded(c.aptName));
  if (excludedByNameGuard.length > 0) {
    console.log(`[GUARD] 이름 기반 명시적 제외(구덕금호류)가 HIGH에 섞여 있음: ${excludedByNameGuard.length}건 — BLOCKER 후보`);
  }
  highOnly = highOnly.filter((c) => !isNameGuardExcluded(c.aptName));

  // §7 dry-run anomaly gates용 최종 방어선: recordCount===1 재확인(레이스 컨디션 대비, §26 point 9)
  const recordCountViolation = highOnly.filter((c) => c.probe.recordCount !== 1);
  if (recordCountViolation.length > 0) {
    console.log(`[ANOMALY] recordCount!=1인데 HIGH로 분류된 row: ${recordCountViolation.length}건 — write 대상에서 제외(guard)`);
  }
  // '공동주택' 양성 확인 없는 row(주용도 missing/mismatch)는 근거 강도와 무관하게 제외.
  // NON_TARGET/MIXED_USE는 이미 MEDIUM으로 걸러지므로, 여기 남는 건 오직 §26 UNKNOWN
  // 케이스(mainPurpsCdNm 결측)뿐 — 그래도 명시적으로 재확인해 guard로 고정한다.
  const purposeViolation = highOnly.filter((c) => !isUniverseConfirmedApartment(c.probe.mainPurpsCdNm));
  if (purposeViolation.length > 0) {
    console.log(`[GUARD] '공동주택' 양성 확인 없는 HIGH row(주용도 결측/불일치): ${purposeViolation.length}건 — write 대상에서 제외, manual review로 이관`);
    console.log(JSON.stringify(purposeViolation.map((c) => ({ aptSeq: c.aptSeq, aptName: c.aptName, mainPurpsCdNm: c.probe.mainPurpsCdNm, recordCount: c.probe.recordCount, nameMatch: c.recovery.nameMatch, buildYearConsistent: c.recovery.buildYearConsistent })), null, 1));
  }

  // 현재 DB 값 조회(4개 대상 필드 + lawdCd, 변경 전 상태 확인용)
  const aptSeqs = highOnly.map((c) => c.aptSeq);
  const currentRows = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: aptSeqs } },
    select: { aptSeq: true, name: true, sggCd: true, roadAddress: true, jibunAddress: true, totalHouseholds: true, mgmBldrgstPk: true, geocodeQuality: true, latitude: true, longitude: true },
  });
  const currentByAptSeq = new Map(currentRows.map((r) => [r.aptSeq!, r]));

  const counts = {
    TOTAL_HIGH: byLevel.RECOVERY_HIGH.length,
    WRITE_CANDIDATES: 0,
    NO_CHANGE: 0,
    ADDRESS_CHANGE: 0,
    JIBUN_CHANGE: 0,
    REGISTRY_LINK_CHANGE: 0,
    COORD_REGEOCODE_CANDIDATES: 0,
    EXCLUDED: byLevel.RECOVERY_MEDIUM.length + byLevel.RECOVERY_REVIEW.length + byLevel.RECOVERY_FAILED.length + excludedByNameGuard.length + recordCountViolation.length + purposeViolation.length,
  };

  const anomalies = {
    candidateExceedsTotal: false,
    nonHighLeakage: 0,
    lawdCdCrossRegionChange: [] as any[],
    aptSeqChange: 0,
    existingHighCoordDowngraded: [] as any[],
    existingVerifiedRegistryChanged: [] as any[],
    staleNonNullField: [] as any[], // 이미 값이 있는데 HIGH 후보에 남아있는 경우(설계상 없어야 함, 방어적 체크)
  };

  const writePlan: any[] = [];
  const samples: Record<string, any[]> = { NO_CHANGE: [], ADDRESS_CHANGE: [], JIBUN_CHANGE: [], REGISTRY_LINK_CHANGE: [], COORD_REGEOCODE_CANDIDATES: [], EXCLUDED: [] };

  for (const c of highOnly) {
    if (recordCountViolation.includes(c) || purposeViolation.includes(c)) continue; // STOP 후보는 write plan에서 자동 제외(anomaly로 이미 보고됨)
    const cur = currentByAptSeq.get(c.aptSeq);
    if (!cur) { console.log(`[WARN] 현재 DB에서 aptSeq=${c.aptSeq} 못 찾음 — skip`); continue; }

    // 필드별 precedence: VERIFIED_EXISTING(기존 non-null 값) > RECOVERY_HIGH > LOWER_CONFIDENCE
    // (lib/step07a-write-guards.ts:applyFieldPrecedence 재사용, §10)
    const before = {
      roadAddress: cur.roadAddress, jibunAddress: cur.jibunAddress,
      totalHouseholds: cur.totalHouseholds, mgmBldrgstPk: cur.mgmBldrgstPk,
    };
    const candidate = {
      roadAddress: c.probe.roadAddress as string | null, jibunAddress: c.probe.jibunAddress as string | null,
      totalHouseholds: c.probe.totalHouseholds as number | null, mgmBldrgstPk: c.probe.mgmBldrgstPk as string | null,
    };
    const { after, alreadyHasValue } = applyFieldPrecedence({ before, candidate });
    if (alreadyHasValue) {
      anomalies.staleNonNullField.push({ aptSeq: c.aptSeq, before });
    }

    const addressChanged = before.roadAddress !== after.roadAddress;
    const jibunChanged = before.jibunAddress !== after.jibunAddress;
    const registryLinkChanged = before.totalHouseholds !== after.totalHouseholds || before.mgmBldrgstPk !== after.mgmBldrgstPk;
    const anyChange = addressChanged || jibunChanged || registryLinkChanged;

    if (addressChanged) counts.ADDRESS_CHANGE++;
    if (jibunChanged) counts.JIBUN_CHANGE++;
    if (registryLinkChanged) counts.REGISTRY_LINK_CHANGE++;

    const isCoordLow = cur.geocodeQuality !== 'exact';
    if (anyChange && isCoordLow && (after.roadAddress != null || after.jibunAddress != null)) {
      counts.COORD_REGEOCODE_CANDIDATES++;
      samples.COORD_REGEOCODE_CANDIDATES.push({ aptSeq: c.aptSeq, aptName: c.aptName, after });
    }

    if (!anyChange) {
      counts.NO_CHANGE++;
      samples.NO_CHANGE.push({ aptSeq: c.aptSeq, aptName: c.aptName, reason: alreadyHasValue ? 'idempotent-already-written' : 'probe-had-no-new-data' });
      continue; // idempotency: 변경 없는 row는 write plan에 넣지 않음(re-run 시 자연히 NO_CHANGE)
    }

    counts.WRITE_CANDIDATES++;
    const item = { aptSeq: c.aptSeq, aptName: c.aptName, lawdCd: c.lawdCd, before, after, recordCount: c.probe.recordCount, tier: c.probe.tier };
    writePlan.push(item);
    if (addressChanged && samples.ADDRESS_CHANGE.length < 10) samples.ADDRESS_CHANGE.push(item);
    if (jibunChanged && samples.JIBUN_CHANGE.length < 10) samples.JIBUN_CHANGE.push(item);
    if (registryLinkChanged && samples.REGISTRY_LINK_CHANGE.length < 10) samples.REGISTRY_LINK_CHANGE.push(item);
  }
  samples.EXCLUDED = [
    ...byLevel.RECOVERY_MEDIUM.slice(0, 4).map((c) => ({ aptSeq: c.aptSeq, aptName: c.aptName, level: 'RECOVERY_MEDIUM', reason: c.recovery.reasons[0] })),
    ...byLevel.RECOVERY_REVIEW.slice(0, 4).map((c) => ({ aptSeq: c.aptSeq, aptName: c.aptName, level: 'RECOVERY_REVIEW', reason: c.recovery.reasons[0] })),
    ...byLevel.RECOVERY_FAILED.slice(0, 4).map((c) => ({ aptSeq: c.aptSeq, aptName: c.aptName, level: 'RECOVERY_FAILED', reason: c.recovery.reasons[0] })),
  ];

  // §7 anomaly gates 최종 판정
  if (counts.WRITE_CANDIDATES > counts.TOTAL_HIGH) anomalies.candidateExceedsTotal = true;
  anomalies.nonHighLeakage = excludedByNameGuard.length; // 위에서 이미 필터링했으므로 여기선 정상 0

  // 주의: recordCountViolation/purposeViolation/excludedByNameGuard는 위에서 이미
  // write 대상에서 배제됐다(guard가 정상 동작 중) — 이건 STOP이 아니라 "guard가 개입해
  // 보수적으로 축소했다"는 정보성 로그다. 진짜 STOP은 guard가 놓친(=write plan에 실제로
  // 남아있는) leakage뿐이다.
  const leakedRecordCount = writePlan.filter((w) => w.recordCount !== 1);
  const stopConditions: string[] = [];
  if (anomalies.candidateExceedsTotal) stopConditions.push('candidate > RECOVERY_HIGH total');
  if (leakedRecordCount.length > 0) stopConditions.push(`recordCount!=1 leakage IN WRITE PLAN: ${leakedRecordCount.length}건`);

  console.log('\n=== DRY-RUN REPORT ===');
  console.log(JSON.stringify(counts, null, 1));
  console.log('\n=== ANOMALIES ===');
  console.log(JSON.stringify({ ...anomalies, staleNonNullFieldCount: anomalies.staleNonNullField.length }, null, 1));
  if (anomalies.staleNonNullField.length > 0) console.log('staleNonNullField 상세(최대 10):', JSON.stringify(anomalies.staleNonNullField.slice(0, 10), null, 1));
  console.log('\n=== STOP CONDITIONS ===', stopConditions.length ? stopConditions : 'none');

  console.log('\n=== SAMPLES (before -> after) ===');
  for (const [k, v] of Object.entries(samples)) {
    console.log(`\n[${k}] (${v.length} shown)`);
    console.log(JSON.stringify(v.slice(0, 5), null, 1));
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), counts, anomalies, stopConditions, writePlan, samples }, null, 1));
  console.log(`\n결과 저장: ${OUT_PATH} (writePlan ${writePlan.length}건)`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
