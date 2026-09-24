/**
 * NATIONAL_BACKFILL_ORCHESTRATOR_V1 — 전국 시군구 코드 스냅샷 생성기.
 *
 * 출처는 registry.ts를 만든 것과 **같은** 법정동코드 프록시(REGCODE_PROXY)다. 코드를 추측하거나 만들지 않는다.
 * MOLIT 호출 0회(이 프록시는 MOLIT quota와 무관). DB 접근 없음.
 *
 * 생성 후 registry.ts(부산·서울·경기, 수기 검증)와 코드·이름·leaf 구조가 **완전히 일치**해야만 저장한다.
 * 일치하지 않으면 스냅샷을 쓰지 않고 종료한다.
 *
 *   npx tsx scripts/national-backfill/build-inventory-snapshot.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { REGION_NODES } from '../../src/lib/region/registry';
import { buildInventory, crossCheckWithRegistry, type InventorySnapshot } from './orchestrator-logic';

const PROXY = 'https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes';
const OUT = path.resolve(__dirname, 'region-inventory.snapshot.json');

async function getJson(url: string): Promise<{ regcodes?: { code: string; name: string }[] }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`proxy http=${res.status}`);
  return res.json();
}

async function main() {
  const sidos = (await getJson(`${PROXY}?regcode_pattern=*00000000`)).regcodes ?? [];
  if (!sidos.length) throw new Error('proxy returned no sido');
  const sigungu: { lawdCd: string; fullName: string }[] = [];
  for (const s of sidos) {
    const c = s.code.slice(0, 2);
    const rows = (await getJson(`${PROXY}?regcode_pattern=${c}*00000&is_ignore_zero=true`)).regcodes ?? [];
    for (const r of rows) {
      const lawdCd = r.code.slice(0, 5);
      if (lawdCd === `${c}000`) continue; // 시도 자신
      sigungu.push({ lawdCd, fullName: r.name });
    }
  }
  const prev: InventorySnapshot | null = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const snapshot: InventorySnapshot = {
    source: 'REGCODE_PROXY (src/lib/molit-stats-helpers.ts) — registry.ts와 같은 출처',
    fetchedAt: new Date().toISOString(),
    sidos: sidos.map((s) => ({ code: s.code.slice(0, 2), name: s.name })),
    sigungu: sigungu.sort((a, b) => a.lawdCd.localeCompare(b.lawdCd)),
    // 사람이 검토한 메모는 재생성 때 보존한다(프록시가 주지 않는 정보이므로 덮어쓰지 않는다).
    knownGaps: prev?.knownGaps ?? [],
    reviewNotes: prev?.reviewNotes ?? {},
  };
  const inv = buildInventory(snapshot);
  const xc = crossCheckWithRegistry(inv, REGION_NODES);
  if (!xc.ok) {
    console.error('registry와 불일치 — 스냅샷을 저장하지 않는다', JSON.stringify(xc, null, 1));
    process.exit(1);
  }
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 1) + '\n');
  console.log(`saved ${OUT} — sidos=${snapshot.sidos.length} sigungu=${snapshot.sigungu.length} leaves=${inv.entries.filter((e) => e.isMolitLeaf).length}`);
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
