/**
 * SEOUL_SALE_NATURAL_KEY_COLLISION_PATCH_V1 §7 — 서울 전체 이력 자연키 충돌 전수 census (STRICT READ ONLY).
 *
 * DB 자연키 unique는 `(group_key, deal_amount, deal_date, floor, occurrence_index)`로
 * **lawdCd를 포함하지 않는다**. MOLIT이 같은 거래를 이웃 구 응답에도 실어 보내면 두 셀이
 * 같은 자연키 행을 만들고, 적재 시 `createMany skipDuplicates`가 뒤에 오는 쪽을 조용히 건너뛴다.
 *
 * 이미 수집해 둔 셀 원천(raw/*.json.gz)을 운영과 같은 정규화 경로로 읽어 자연키별로 묶고,
 * 같은 구 안 충돌과 구를 가로지르는 충돌을 나눠 센다. canonical owner는 **aptSeq 앞 5자리**로만
 * 정한다(추측 금지).
 *
 * DB write 0 · 외부 API 0 · master 변경 0.
 *
 *   npx tsx scripts/audit-seoul-natural-key-collisions.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { mapMolitItems } from '../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';
import { FETCH_ORDER, OUT, monthRange, kstYm, preStartCells, type CellCheckpoint } from './audit-seoul-sale-backfill-plan';
import { naturalKeyOf, canonicalLawdCdOf } from './backfill-seoul-sale-logic';

const RAW = path.join(OUT, 'raw');
const CELLS = path.join(OUT, 'cells');

function loadCells(lawdCd: string): Record<string, CellCheckpoint> {
  const p = path.join(CELLS, `${lawdCd}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

interface Occurrence { lawdCd: string; ym: string; aptSeq: string | null; aptName: string; dong: string; dealDate: string }

async function main() {
  const months = monthRange('200601', kstYm());
  const early = preStartCells();
  const byKey = new Map<string, Occurrence[]>();
  let sourceRows = 0;
  let cellsRead = 0;

  for (const d of FETCH_ORDER) {
    const cells = loadCells(d);
    const want = [...early.filter((c) => c.lawdCd === d).map((c) => c.ym), ...months];
    for (const ym of want.filter((y) => cells[y]?.status === 'COMPLETE')) {
      cellsRead++;
      const items = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RAW, d, `${ym}.json.gz`))).toString('utf8'));
      const { rows } = normalizeMolitItemsToTradeRows(mapMolitItems(items, 'apt', d, ym) as any, d, ym);
      sourceRows += rows.length;
      for (const r of rows) {
        const k = naturalKeyOf(r);
        (byKey.get(k) ?? byKey.set(k, []).get(k)!)
          .push({ lawdCd: r.lawdCd, ym, aptSeq: r.aptSeq, aptName: r.aptName, dong: r.dong, dealDate: r.dealDate });
      }
    }
  }

  const dupKeys = [...byKey.entries()].filter(([, v]) => v.length > 1);
  const sameDistrict: unknown[] = [];
  const crossDistrict: unknown[] = [];
  let ambiguousOwner = 0;

  for (const [key, occ] of dupKeys) {
    const districts = [...new Set(occ.map((o) => o.lawdCd))];
    const canonical = canonicalLawdCdOf(occ[0].aptSeq);
    const rec = {
      key, occurrences: occ.length, districts,
      aptSeq: occ[0].aptSeq, aptName: occ[0].aptName, dong: occ[0].dong, dealDate: occ[0].dealDate,
      canonicalLawdCd: canonical,
      canonicalPresent: canonical ? districts.includes(canonical) : false,
      cells: occ.map((o) => `${o.lawdCd}:${o.ym}`),
    };
    if (districts.length > 1) {
      crossDistrict.push(rec);
      // canonical owner를 aptSeq로 정할 수 없거나, 그 구가 후보에 없으면 모호하다.
      if (!canonical || !districts.includes(canonical)) ambiguousOwner++;
    } else {
      sameDistrict.push(rec);
    }
  }

  // ── §8·§9 적재 규모 재산출 (DB write 0) ──
  // 계획 insert = 원천 행 − 이미 DB에 있는 행(강남 46, 자연키 정확 일치)
  // 실제 insert = 계획 insert − 예상 skip(자연키 중복으로 skipDuplicates가 건너뛰는 수)
  const EXISTING_IN_DB = 46; // SEOUL_SALE_BACKFILL_PLAN_V1 §9 — 46/46 NATURAL_KEY_EXACT
  const expectedSkips = [...byKey.values()].reduce((s, occ) => s + (occ.length - 1), 0);
  const plannedInserts = sourceRows - EXISTING_IN_DB;
  const expectedActualInserts = plannedInserts - expectedSkips;

  // 충돌 셀이 어느 phase에 속하는지 — phase 경계는 SEOUL_SALE_FULL_HISTORY_MEASUREMENT_COMPLETION_V1 §7.
  const PHASE_OF = (lawdCd: string) =>
    lawdCd === '11140' ? 'A_중구' : lawdCd === '11110' || lawdCd === '11170' ? 'B_종로·용산' : 'C_나머지22구';
  const skipsByPhase: Record<string, number> = {};
  for (const [, occ] of dupKeys) {
    // 첫 등장이 행을 차지하고 나머지가 건너뛰어진다(적용 순서는 FETCH_ORDER가 아니라 운영자가 정한다 —
    // canonical 구를 앞에 두면 canonical이 차지한다).
    const canonical = canonicalLawdCdOf(occ[0].aptSeq);
    for (const o of occ) {
      if (canonical && o.lawdCd === canonical) continue; // canonical이 차지한다고 보고 나머지를 skip으로 센다
      const ph = PHASE_OF(o.lawdCd);
      skipsByPhase[ph] = (skipsByPhase[ph] ?? 0) + 1;
    }
  }

  const crossRows = (crossDistrict as any[]).reduce((s, r) => s + r.occurrences, 0);
  const sameRows = (sameDistrict as any[]).reduce((s, r) => s + r.occurrences, 0);
  const out = {
    at: new Date().toISOString(), readOnly: true, dbWrites: 0, apiCalls: 0,
    sourceRows, cellsRead, distinctNaturalKeys: byKey.size,
    projection: {
      formula: 'expectedActualInserts = (sourceRows - existingInDb) - expectedSkips',
      sourceRows, existingInDb: EXISTING_IN_DB, plannedInserts, expectedSkips, expectedActualInserts,
    },
    skipsByPhase,
    duplicateNaturalKeys: dupKeys.length,
    sameDistrict: { keys: sameDistrict.length, occurrences: sameRows, rowsSkippedOnApply: sameRows - sameDistrict.length },
    crossDistrict: { keys: crossDistrict.length, occurrences: crossRows, rowsSkippedOnApply: crossRows - crossDistrict.length },
    affectedAptSeqs: [...new Set((crossDistrict as any[]).concat(sameDistrict as any[]).map((r) => r.aptSeq))],
    ambiguousCanonicalOwner: ambiguousOwner,
    crossDistrictDetail: crossDistrict,
    sameDistrictDetail: sameDistrict.slice(0, 20),
  };
  fs.writeFileSync(path.join(OUT, 'natural-key-collisions.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, sameDistrictDetail: (out.sameDistrictDetail as any[]).length }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
