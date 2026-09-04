/**
 * OFFICETEL V1 STEP 2 §5/§6/§7/§8 — officetel_masters DRY-RUN / APPLY.
 *
 * 입력: scripts/officetel/_officetel_master_results/candidates.json
 *       (master-source-audit.ts가 건축물대장 표제부 전수 스윕으로 만든 후보)
 *
 * 판정 로직은 src/lib/officetel/identity.ts의 순수 함수를 그대로 쓴다 — 감사에서 본 것과
 * 다른 기준으로 적재되는 사고를 막기 위해 복제하지 않는다.
 *
 * 쓰기 정책(§7):
 *   - **INSERT only.** UPDATE / DELETE / merge 없음.
 *   - 이미 같은 canonicalKey가 있으면 **skip**(덮어쓰지 않는다).
 *   - unresolved(키 생성 실패) 및 AMBIGUOUS 충돌은 **적재하지 않는다** —
 *     잘못된 master보다 없는 master가 낫다.
 *
 * 사용법:
 *   dry-run       : ... scripts/officetel/master-apply.ts
 *   소규모 apply  : ... scripts/officetel/master-apply.ts --apply --districts=26350,26230
 *   전체 apply    : ... scripts/officetel/master-apply.ts --apply --all
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma';
import {
  buildOfficetelCanonicalKey,
  classifyJibunGroup,
  masterNormalizedFields,
  planMasterInserts,
} from '../../src/lib/officetel/identity';

const CANDIDATES_PATH = path.resolve(__dirname, '_officetel_master_results/candidates.json');
const CHUNK = 200;

interface RawCandidate {
  sggCd: string; bjdongCd: string; umdNm: string; jibun: string; platGbCd: string;
  buildingDong: string | null; officetelName: string;
  buildYear: number | null; mainPurpose: string | null; etcPurpose: string | null;
  useApprovalDate: string | null; hoCnt: number | null; hhldCnt: number | null;
  totalArea: number | null; bcRat: number | null; vlRat: number | null;
  structureName: string | null; grndFlrCnt: number | null; ugrndFlrCnt: number | null;
  indrMech: number | null; indrAuto: number | null; oudrMech: number | null; oudrAuto: number | null;
  roadAddress: string | null;
}

type Planned = RawCandidate & {
  canonicalKey: string | null;
  useApprovalDateN: string | null;
  officetelNameN: string;
  hoCntN: number | null;
  etcPurposeN: string | null;
};

function resolve(c: RawCandidate): Planned {
  // §2 — 산 지번은 resolve하지 않는다(대지/산 구분을 키가 표현하지 못함).
  const r =
    c.platGbCd === '1'
      ? ({ ok: false } as const)
      : buildOfficetelCanonicalKey({ sggCd: c.sggCd, umdNm: c.umdNm, jibun: c.jibun, buildingDong: c.buildingDong });
  return {
    ...c,
    canonicalKey: r.ok ? r.key : null,
    // planMasterInserts가 충돌 비교에 쓰는 필드(이름을 맞춰 준다)
    officetelName: c.officetelName,
    officetelNameN: c.officetelName,
    useApprovalDateN: c.useApprovalDate,
    hoCntN: c.hoCnt,
    etcPurposeN: c.etcPurpose,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const all = args.includes('--all');
  const distArg = args.find((a) => a.startsWith('--districts='));
  const districts = distArg ? distArg.replace('--districts=', '').split(',').map((s) => s.trim()).filter(Boolean) : null;

  if (apply && !all && !districts) throw new Error('--apply에는 --all 또는 --districts=... 가 필요하다');

  const raw: RawCandidate[] = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf-8'));
  const scoped = districts ? raw.filter((c) => districts.includes(c.sggCd)) : raw;
  console.log(`OFFICETEL MASTER ${apply ? 'APPLY' : 'DRY-RUN'}  후보 ${scoped.length}/${raw.length}건` +
    (districts ? ` (구 ${districts.join(',')})` : ' (부산 전체)') + '\n');

  const resolved = scoped.map(resolve);

  // planMasterInserts는 CollisionComparable 모양을 기대한다.
  const forPlan = resolved.map((r) => ({
    ...r,
    officetelName: r.officetelNameN,
    useApprovalDate: r.useApprovalDateN,
    hoCnt: r.hoCntN,
    etcPurpose: r.etcPurposeN,
  }));
  const plan = planMasterInserts(forPlan);

  console.log('=== PLAN ===');
  console.log(`  candidate rows        : ${scoped.length}`);
  console.log(`  resolved rows         : ${scoped.length - plan.unresolved.length}`);
  console.log(`  unresolved (미적재)   : ${plan.unresolved.length}`);
  console.log(`  duplicate collapsed   : ${plan.collapsed}`);
  console.log(`  AMBIGUOUS (미적재)    : ${plan.ambiguous.length}`);
  console.log(`  ==> INSERT 대상       : ${plan.inserts.length}`);

  // §2 — 다동 지번 관찰(병합 판단 아님)
  const byJibun = new Map<string, (string | null)[]>();
  for (const r of resolved) {
    const k = `${r.sggCd}|${r.umdNm}|${r.jibun}`;
    const l = byJibun.get(k); if (l) l.push(r.buildingDong); else byJibun.set(k, [r.buildingDong]);
  }
  const shapes: Record<string, number> = {};
  for (const [, d] of byJibun) { const s = classifyJibunGroup(d); shapes[s] = (shapes[s] || 0) + 1; }
  console.log(`  지번 그룹 형태        : ${JSON.stringify(shapes)}`);

  if (plan.ambiguous.length) {
    console.log('\n  --- AMBIGUOUS 상세(적재하지 않음) ---');
    plan.ambiguous.slice(0, 10).forEach((a) => {
      console.log(`   ${a.canonicalKey}`);
      a.rows.forEach((x: any) => console.log(`      name="${x.officetelName}" useApr=${x.useApprovalDate} hoCnt=${x.hoCnt} etc="${x.etcPurpose}"`));
    });
  }

  // 이미 존재하는 canonicalKey는 skip
  const keys = plan.inserts.map((x) => x.canonicalKey as string);
  const existing = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    const rows = await prisma.officetelMaster.findMany({
      where: { canonicalKey: { in: keys.slice(i, i + 500) } },
      select: { canonicalKey: true },
    });
    rows.forEach((r) => existing.add(r.canonicalKey));
  }
  const toInsert = plan.inserts.filter((x) => !existing.has(x.canonicalKey as string));
  console.log(`\n  이미 존재(skip)       : ${existing.size}`);
  console.log(`  실제 INSERT 예정      : ${toInsert.length}`);

  const before = await prisma.officetelMaster.count();
  console.log(`  현재 master row       : ${before}`);

  if (!apply) {
    console.log('\nDRY-RUN — Production write 없음.');
    await prisma.$disconnect();
    return;
  }

  console.log('\n=== APPLY (INSERT only) ===');
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const res = await prisma.officetelMaster.createMany({
      data: chunk.map((c: any) => {
        const n = masterNormalizedFields({
          umdNm: c.umdNm, jibun: c.jibun, buildingDong: c.buildingDong, officetelName: c.officetelName,
        });
        return {
          canonicalKey: c.canonicalKey as string,
          sggCd: c.sggCd,
          umdNm: c.umdNm,
          normalizedUmdNm: n.normalizedUmdNm,
          jibun: c.jibun,
          normalizedJibun: n.normalizedJibun as string,
          buildingDong: c.buildingDong,
          normalizedBuildingDong: n.normalizedBuildingDong,
          officetelName: c.officetelName,
          normalizedName: n.normalizedName,
          buildYear: c.buildYear,
          buildingRegistryMainPurpose: c.mainPurpose,
          buildingRegistryEtcPurpose: c.etcPurpose,
          useApprovalDate: c.useApprovalDate,
          hoCnt: c.hoCnt,
          totalArea: c.totalArea != null ? new Prisma.Decimal(c.totalArea) : null,
          buildingCoverageRatio: c.bcRat,
          floorAreaRatio: c.vlRat,
          structureName: c.structureName,
          groundFloorCount: c.grndFlrCnt,
          undergroundFloorCount: c.ugrndFlrCnt,
          indoorMechanicalParking: c.indrMech,
          indoorAutoParking: c.indrAuto,
          outdoorMechanicalParking: c.oudrMech,
          outdoorAutoParking: c.oudrAuto,
          roadAddress: c.roadAddress,
          // 건축물대장은 좌표를 제공하지 않는다 — 추정 금지, NULL 유지.
          latitude: null,
          longitude: null,
        };
      }),
      skipDuplicates: true,
    });
    inserted += res.count;
  }
  const after = await prisma.officetelMaster.count();
  console.log(`  inserted reported     : ${inserted}`);
  console.log(`  master row ${before} -> ${after} (delta ${after - before})`);
  console.log(`  일치 여부             : ${after - before === inserted ? 'OK' : '*** MISMATCH ***'}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
