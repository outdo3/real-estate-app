// RENT_TRADE_HISTORY_V1 PHASE B §44 — UNMATCHED MASTER STORAGE QA(읽기 전용).
// 실제 validation write 데이터에서 ApartmentMaster에 없는 aptSeq를 가진 row가
// 정상적으로 저장돼 있는지, identityKey가 항상 aptSeq 기반("id:")이고 이름 기반
// fallback("nd:")이 단 하나도 없는지 확인한다.
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.apartmentRentHistory.findMany({ where: { lawdCd: { in: ['26140', '26230', '26350'] }, dealYmd: '202607' }, select: { aptSeq: true, identityKey: true, aptName: true } });
  console.log(`총 row 수: ${rows.length}`);

  const nameFallbackRows = rows.filter((r) => r.identityKey.startsWith('nd:'));
  console.log(`identityKey가 nd:(이름 fallback)인 row 수: ${nameFallbackRows.length} (기대값: 0)`);

  const nullAptSeqRows = rows.filter((r) => r.aptSeq == null);
  console.log(`aptSeq가 null인 row 수: ${nullAptSeqRows.length} (기대값: 0 — MISSING_APTSEQ는 이미 정규화 단계에서 blocked)`);

  const uniqueAptSeqs = [...new Set(rows.map((r) => r.aptSeq).filter((s): s is string => s != null))];
  const masters = await prisma.apartmentMaster.findMany({ where: { aptSeq: { in: uniqueAptSeqs } }, select: { aptSeq: true } });
  const matchedSet = new Set(masters.map((m) => m.aptSeq));
  const unmatchedSeqs = uniqueAptSeqs.filter((s) => !matchedSet.has(s));
  console.log(`고유 aptSeq: ${uniqueAptSeqs.length}, MATCHED: ${uniqueAptSeqs.length - unmatchedSeqs.length}, UNMATCHED: ${unmatchedSeqs.length}`);

  if (unmatchedSeqs.length > 0) {
    const sample = rows.filter((r) => r.aptSeq && unmatchedSeqs.includes(r.aptSeq)).slice(0, 5);
    console.log('UNMATCHED 샘플 row(실제로 저장되었고, identityKey가 여전히 id: 기반인지 확인):');
    for (const s of sample) console.log(`  aptSeq=${s.aptSeq} identityKey=${s.identityKey} aptName=${s.aptName}`);
    const unmatchedRowsAllIdBased = sample.every((s) => s.identityKey.startsWith('id:'));
    console.log(`UNMATCHED row 전부 identityKey가 id: 기반(name fallback 아님): ${unmatchedRowsAllIdBased}`);
  }

  const verdict = nameFallbackRows.length === 0 && nullAptSeqRows.length === 0 && unmatchedSeqs.length > 0;
  console.log(`RESULT: ${verdict ? 'PASS' : 'FAIL_OR_NO_UNMATCHED_SAMPLE'}`);

  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
