// E-JIP SCORE V2 STEP 0.7 §3/§9 사전 점검 — 1,398건의 jibun 필드 형식 감사.
// registry 조회(fetchRegistryOnce)는 jibun을 "숫자-숫자"로 parseInt하는데, "산123"
// 같은 산지번 접두어가 있으면 parseInt가 실패해 구조적으로 100% parse_error가 난다 —
// API 호출 전에 DB만으로 확인 가능한 구조적 실패 원인을 먼저 분리한다. READ-ONLY.
import { prisma } from '../../src/lib/prisma';
import { loadUniverse } from './lib/step07-universe';

async function main() {
  const { molitCandidates } = await loadUniverse();

  let mountainPrefix = 0; // "산" 접두 지번
  let normalNumeric = 0; // "123" 또는 "123-4" 형태(정상 파싱 가능)
  let emptyJibun = 0;
  let otherFormat = 0;
  const otherSamples: string[] = [];

  for (const r of molitCandidates) {
    const j = (r.jibun || '').trim();
    if (!j) { emptyJibun++; continue; }
    if (j.startsWith('산')) { mountainPrefix++; continue; }
    const parts = j.split('-');
    const bunNum = parseInt(parts[0], 10);
    if (!isNaN(bunNum)) { normalNumeric++; continue; }
    otherFormat++;
    if (otherSamples.length < 10) otherSamples.push(j);
  }

  console.log(`[§3/§9 사전점검] jibun 필드 형식 감사(1,398건 대상, API 호출 없음)`);
  console.log(`정상 숫자 형식(파싱 가능): ${normalNumeric}건`);
  console.log(`산지번 접두("산..."): ${mountainPrefix}건 — fetchRegistryOnce의 parseInt(parts[0])가 "산"을 만나면 NaN → parse_error 확정(구조적 실패, API 응답과 무관)`);
  console.log(`jibun 빈 값: ${emptyJibun}건`);
  console.log(`기타 형식(파싱 불가 추정): ${otherFormat}건`);
  if (otherSamples.length) console.log('기타 형식 샘플:', otherSamples);

  // umdCd(법정동코드)도 registry 조회에 필수 — ApartmentMaster.umdCd 존재율 확인
  const withUmdCd = await prisma.apartmentMaster.count({
    where: { aptSeq: { in: molitCandidates.map((r) => r.aptSeq) }, umdCd: { not: null } },
  });
  console.log(`\numdCd(법정동코드) 존재: ${withUmdCd}/${molitCandidates.length}건 (registry 조회 필수 필드)`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
