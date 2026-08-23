// E-JIP SCORE V2 STEP 0.7-A §18/§19 — re-geocode write(SAFE candidates만).
// 기본값: dry-run. --apply 플래그가 있어야 실제 write.
// 대상: output/step07a-regeocode-dryrun.json의 safeAptSeqs만.
// 필드: latitude, longitude, geocodeQuality만(schema에 이미 존재, migration 없음).
import fs from 'fs';
import path from 'path';

const DRYRUN_PATH = path.resolve(__dirname, 'output/step07a-regeocode-dryrun.json');
const RESULT_PATH = path.resolve(__dirname, 'output/step07a-regeocode-write-result.json');

async function main() {
  const apply = process.argv.includes('--apply');
  const { prisma } = await import('../../src/lib/prisma');

  const dryrun = JSON.parse(fs.readFileSync(DRYRUN_PATH, 'utf-8'));
  const safeSet = new Set<string>(dryrun.safeAptSeqs);
  const safeResults = dryrun.results.filter((r: any) => safeSet.has(r.aptSeq));
  console.log(`SAFE candidates: ${safeResults.length}건, mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  if (!apply) {
    console.log('DRY-RUN: 실제 적용하려면 --apply 플래그를 추가하세요.');
    await prisma.$disconnect();
    return;
  }

  let updated = 0, unchanged = 0, failed = 0;
  const failedRows: any[] = [];
  const updatedRows: any[] = [];

  for (const r of safeResults) {
    try {
      // 최종 방어선: apply 직전 현재 값 재확인(레이스 컨디션/이미 이 값으로 적용된 상태 대비).
      // precedence: 이미 'exact'면 절대 덮어쓰지 않음. 그 외에는 "이미 목표값과 정확히
      // 동일한가"까지 비교해야 idempotent(재실행 시 unchanged로 잡힘, §36) — geocodeQuality
      // !== 'exact'라는 이유만으로 매번 동일 값을 다시 write하면(실제 변경은 없지만) 재실행
      // 시 updated로 잘못 집계된다.
      const cur = await prisma.apartmentMaster.findUnique({ where: { aptSeq: r.aptSeq }, select: { latitude: true, longitude: true, geocodeQuality: true } });
      if (!cur) { failed++; failedRows.push({ aptSeq: r.aptSeq, error: 'row not found at apply time' }); continue; }
      if (cur.geocodeQuality === 'exact') { unchanged++; continue; }
      // 좌표는 DB round-trip에서 IEEE754 double 마지막 자리 수준의 뜬 오차가 생길 수 있어
      // (Supabase pooler 경유, 실측 diff ~1e-14도 ≈ 나노미터 단위) strict === 대신 epsilon
      // 비교를 쓴다 — 1e-9도(~0.1mm)는 실제 위치 차이를 구분하기에 충분히 촘촘하면서
      // round-trip 노이즈보다 훨씬 크다.
      const EPS = 1e-9;
      const sameAsTarget = Math.abs(cur.latitude! - r.newLatLng.lat) < EPS && Math.abs(cur.longitude! - r.newLatLng.lng) < EPS && cur.geocodeQuality === r.newStatus;
      if (sameAsTarget) { unchanged++; continue; }

      await prisma.apartmentMaster.update({
        where: { aptSeq: r.aptSeq },
        data: { latitude: r.newLatLng.lat, longitude: r.newLatLng.lng, geocodeQuality: r.newStatus },
      });
      updated++;
      updatedRows.push({ aptSeq: r.aptSeq, aptName: r.aptName, newStatus: r.newStatus });
    } catch (e: any) {
      failed++;
      failedRows.push({ aptSeq: r.aptSeq, error: e.message });
    }
    if ((updated + unchanged + failed) % 200 === 0) console.log(`  progress: updated=${updated} unchanged=${unchanged} failed=${failed}`);
  }

  console.log('\n=== REGEOCODE WRITE RESULT ===');
  console.log(JSON.stringify({ attempted: safeResults.length, updated, unchanged, failed }, null, 1));

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), attempted: safeResults.length, updated, unchanged, failed, updatedRows, failedRows }, null, 1));
  console.log(`결과 저장: ${RESULT_PATH}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
