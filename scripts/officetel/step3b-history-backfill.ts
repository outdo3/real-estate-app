/**
 * OFFICETEL V1 STEP 3B — 오피스텔 실거래 이력 최초 Production 적재.
 *
 * 이 스크립트는 **최초 backfill 전용**이다. incremental re-sync가 아니며, 이 STEP에서
 * cron/스케줄러를 만들지 않는다. 같은 셀을 두 번 동기화하지 않는다(§ GUARD 1~3).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 원천: STEP 3A가 남긴 NDJSON(`step3a-{sale,rent}-rows.ndjson`, 원천 응답 순서 보존).
 *
 * 왜 MOLIT을 다시 부르지 않는가 — STEP 3A §9는 "apply 시점에 원천을 다시 부른다"고
 * 적어 뒀지만, STEP 3B 지시는 **검증된 STEP 3A 아티팩트를 쓰고 감사 수치와 정확히
 * 일치하지 않으면 STOP**하라고 요구한다. 재호출은 진행 중인 202609와 지연 취소 때문에
 * 감사 시점(314,965)과 반드시 어긋나므로 그 게이트를 통과할 수 없다. 재현 가능성
 * (§GUARD 4)도 고정된 NDJSON 쪽이 강하다.
 *
 * 그 대가는 명확히 기록한다: 적재된 취소 상태는 **NDJSON 스윕 시각 기준 스냅샷**이며,
 * 그 이후의 지연 취소는 반영돼 있지 않다. 이는 STEP 3A가 이미 식별한 재확인 스윕
 * (STEP 3C 후보, 12개월 초과 지연 취소 93건)의 대상이지 이 STEP의 결함이 아니다.
 * `sourceFetchedAt`에 now()가 아니라 **스윕 파일 mtime**을 넣는 이유도 같다 — 방금
 * 원천에서 확인한 것처럼 위장하지 않는다.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 판정 로직은 전부 STEP 1 계약 모듈을 **그대로 호출**한다(복제 금지):
 *   src/lib/officetel/identity.ts      buildOfficetelCanonicalKey / normalizeUmd / normalizeJibun
 *   src/lib/officetel/natural-key.ts   officetelSaleGroupKey / officetelRentGroupKey / assignOccurrenceIndexes
 *
 * 실행:
 *   dry-run : npx ts-node --compiler-options '{"module":"commonjs"}' scripts/officetel/step3b-history-backfill.ts
 *   apply   : ... step3b-history-backfill.ts --apply
 *   옵션    : --dataset=SALE|RENT|ALL  --maxCells=N  --no-resume
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma';
import { buildOfficetelCanonicalKey, normalizeUmd, normalizeJibun } from '../../src/lib/officetel/identity';
import { officetelSaleGroupKey, officetelRentGroupKey, assignOccurrenceIndexes } from '../../src/lib/officetel/natural-key';

const OUT_DIR = path.resolve(__dirname, '_officetel_master_results');
const SALE_NDJSON = path.join(OUT_DIR, 'step3a-sale-rows.ndjson');
const RENT_NDJSON = path.join(OUT_DIR, 'step3a-rent-rows.ndjson');
const CELLMETA_PATH = path.join(OUT_DIR, 'step3a-cell-totals.json');
const SWEEP_INCOMPLETE_PATH = path.join(OUT_DIR, 'step3a-sweep-incomplete.json');
const MANIFEST_PATH = path.join(OUT_DIR, 'step3b-apply-manifest.json');
const REPORT_PATH = path.join(OUT_DIR, 'step3b-apply-report.json');

// STEP 3A row-sweep이 NDJSON에 쓴 필드 순서. 앞의 2개는 스윕이 붙인 셀 좌표다.
const SALE_FIELDS = ['sggCd','umdNm','jibun','offiNm','dealYear','dealMonth','dealDay','excluUseAr','dealAmount','floor','cdealType','cdealDay','buildYear','dealingGbn','buyerGbn','slerGbn','estateAgentSggNm'] as const;
const RENT_FIELDS = ['sggCd','umdNm','jibun','offiNm','dealYear','dealMonth','dealDay','excluUseAr','deposit','monthlyRent','floor','useRRRight','contractTerm','contractType','preDeposit','preMonthlyRent','buildYear'] as const;

/** STEP 3A 감사가 확정한 수치. 원천이 여기서 벗어나면 write 전에 멈춘다. */
const AUDITED = {
  SALE: { rows: 88674, cells: 3984 },
  RENT: { rows: 226291, cells: 3024 },
} as const;

const CHUNK_SIZE = 500; // 아파트 backfill과 동일. 한 트랜잭션에 대량 row 금지.

type Dataset = 'SALE' | 'RENT';
type CellStatus = 'SUCCESS' | 'EMPTY_VALID' | 'PARTIAL' | 'INVALID' | 'DRY_RUN';

interface CellManifestEntry {
  status: CellStatus;
  sourceRows: number;
  inserted: number;
  skippedDuplicates: number;
  linkable: number;
  unresolved: number;
  reason?: string;
  at: string;
}

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const RESUME = !argv.includes('--no-resume');
const DATASETS: Dataset[] = (() => {
  const a = argv.find((x) => x.startsWith('--dataset='))?.split('=')[1]?.toUpperCase();
  if (a === 'SALE') return ['SALE'];
  if (a === 'RENT') return ['RENT'];
  return ['SALE', 'RENT'];
})();
const MAX_CELLS = Number(argv.find((x) => x.startsWith('--maxCells='))?.split('=')[1] ?? '0') || Infinity;

const text = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
/** STEP 3A 감사와 동일한 파서(콤마 제거 후 Number). 빈 값은 여기 들어오기 전에 걸러진다. */
const num = (s: unknown): number | null => { const v = Number(String(s).replace(/,/g, '').trim()); return Number.isFinite(v) ? v : null; };
const intOrNull = (v: unknown): number | null => { const t = text(v); if (t === null) return null; const n = num(t); return n === null ? null : Math.trunc(n); };

function loadManifest(): Record<string, CellManifestEntry> {
  if (!RESUME || !fs.existsSync(MANIFEST_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch { return {}; }
}
function saveManifest(m: Record<string, CellManifestEntry>) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 1));
}

interface RawRow { _lawd: string; _cellYm: string; [k: string]: string }

/** NDJSON을 셀(lawdCd+dealYmd) 단위로 스트리밍한다. 스윕이 셀 단위로 append했으므로
 * 한 셀의 행들은 파일에서 연속이며, 그 순서가 곧 원천 응답 순서다(occurrenceIndex의 근거). */
async function* streamCells(file: string, fields: readonly string[]): AsyncGenerator<{ lawdCd: string; dealYmd: string; rows: RawRow[] }> {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let curLawd = '', curYm = '', buf: RawRow[] = [];
  for await (const line of rl) {
    if (!line) continue;
    const arr = JSON.parse(line) as string[];
    const lawd = arr[0], ym = arr[1];
    const row: RawRow = { _lawd: lawd, _cellYm: ym };
    for (let i = 0; i < fields.length; i++) row[fields[i]] = arr[i + 2] ?? '';
    if (lawd !== curLawd || ym !== curYm) {
      if (buf.length) yield { lawdCd: curLawd, dealYmd: curYm, rows: buf };
      curLawd = lawd; curYm = ym; buf = [];
    }
    buf.push(row);
  }
  if (buf.length) yield { lawdCd: curLawd, dealYmd: curYm, rows: buf };
}

interface PreparedRow {
  canonicalKey: string;
  groupKey: string;
  occurrenceIndex: number;
  officetelMasterId: number | null;
  linkage: 'LINKABLE' | 'UNRESOLVED_MULTI' | 'MASTER_MISS';
  data: Record<string, unknown>;
}

async function main() {
  const startedAt = new Date();
  console.log(`OFFICETEL V1 STEP 3B — history backfill  [${APPLY ? 'APPLY' : 'DRY-RUN'}]  datasets=${DATASETS.join(',')} resume=${RESUME}\n`);

  // ── §0 사전 게이트 ──────────────────────────────────────────────────
  const sweepIncomplete = JSON.parse(fs.readFileSync(SWEEP_INCOMPLETE_PATH, 'utf8')) as unknown[];
  if (sweepIncomplete.length > 0) throw new Error(`ABORT: STEP 3A 스윕에 불완전 셀 ${sweepIncomplete.length}건`);

  const [{ sale, rent, masters }] = await prisma.$queryRawUnsafe<{ sale: number; rent: number; masters: number }[]>(
    `SELECT (SELECT COUNT(*) FROM officetel_trade_histories)::int AS sale,
            (SELECT COUNT(*) FROM officetel_rent_histories)::int  AS rent,
            (SELECT COUNT(*) FROM officetel_masters)::int         AS masters`
  );
  console.log(`  Production 현재: sale=${sale} rent=${rent} masters=${masters}`);
  const manifest = loadManifest();
  const resumedCells = Object.keys(manifest).length;
  if ((sale > 0 || rent > 0) && resumedCells === 0) {
    throw new Error(`ABORT: history 테이블이 비어 있지 않은데 manifest가 없다 (sale=${sale} rent=${rent}). 최초 backfill 전제가 깨졌다.`);
  }
  if (resumedCells > 0) console.log(`  manifest resume: 이미 처리된 셀 ${resumedCells}개는 건너뛴다`);

  // 셀별 원천 totalCount(스윕이 기록) — 셀 완전성 재검증에 쓴다.
  const cellTotals = new Map<string, number>(JSON.parse(fs.readFileSync(CELLMETA_PATH, 'utf8')));

  // master 주소 그룹 — STEP 3A 감사와 **동일한 규칙**
  const masterRows = await prisma.officetelMaster.findMany({
    select: { id: true, canonicalKey: true, sggCd: true, normalizedUmdNm: true, normalizedJibun: true },
  });
  const masterByAddr = new Map<string, typeof masterRows>();
  for (const m of masterRows) {
    const k = `${m.sggCd}|${m.normalizedUmdNm}|${m.normalizedJibun}`;
    const l = masterByAddr.get(k); if (l) l.push(m); else masterByAddr.set(k, [m]);
  }
  console.log(`  master 주소 그룹 ${masterByAddr.size}개 (master ${masterRows.length}건)\n`);

  const report: Record<string, unknown> = { startedAt: startedAt.toISOString(), apply: APPLY, datasets: DATASETS };

  for (const ds of DATASETS) {
    const file = ds === 'SALE' ? SALE_NDJSON : RENT_NDJSON;
    const fields = ds === 'SALE' ? SALE_FIELDS : RENT_FIELDS;
    // §GUARD 4 / provenance — 원천을 지금 확인한 것이 아니므로 now()를 쓰지 않는다.
    const sweptAt = fs.statSync(file).mtime;
    const source = ds === 'SALE' ? 'MOLIT_OFFI_TRADE' : 'MOLIT_OFFI_RENT';

    const stat = {
      cellsSeen: 0, cellsWritten: 0, cellsSkippedResume: 0, cellsEmpty: 0,
      cellsPartial: 0, cellsInvalid: 0,
      sourceRows: 0, prepared: 0, inserted: 0, skippedDuplicates: 0,
      linkable: 0, unresolvedMulti: 0, masterMiss: 0,
      keyFail: 0, invalidRows: 0,
      sweptAt: sweptAt.toISOString(),
    };
    const problemCells: { cell: string; status: CellStatus; reason: string }[] = [];
    let processedThisRun = 0;

    console.log(`──── ${ds} ────  source=${path.basename(file)}  sweptAt=${sweptAt.toISOString()}`);

    for await (const cell of streamCells(file, fields)) {
      stat.cellsSeen++;
      stat.sourceRows += cell.rows.length;
      const cellId = `${ds}|${cell.lawdCd}|${cell.dealYmd}`;

      if (manifest[cellId] && (manifest[cellId].status === 'SUCCESS' || manifest[cellId].status === 'EMPTY_VALID')) {
        stat.cellsSkippedResume++;
        continue;
      }
      if (processedThisRun >= MAX_CELLS) continue;
      processedThisRun++;

      // ── 셀 완전성 재검증: 스윕이 기록한 원천 totalCount와 실제 행 수가 같아야 한다.
      const expected = cellTotals.get(cellId);
      if (expected === undefined || expected !== cell.rows.length) {
        stat.cellsPartial++;
        const reason = `PARTIAL: rows=${cell.rows.length} vs sourceTotalCount=${expected ?? 'unknown'}`;
        problemCells.push({ cell: cellId, status: 'PARTIAL', reason });
        manifest[cellId] = { status: 'PARTIAL', sourceRows: cell.rows.length, inserted: 0, skippedDuplicates: 0, linkable: 0, unresolved: 0, reason, at: new Date().toISOString() };
        continue;
      }

      // ── 행 준비 (STEP 1 계약 모듈 호출) ─────────────────────────────
      const prepared: PreparedRow[] = [];
      let cellInvalidReason: string | null = null;

      const keyed = cell.rows.map((r) => {
        const k = buildOfficetelCanonicalKey({ sggCd: r.sggCd, umdNm: r.umdNm, jibun: r.jibun, buildingDong: null });
        const y = intOrNull(r.dealYear), m = intOrNull(r.dealMonth), d = intOrNull(r.dealDay);
        const dealDate = y && m && d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
        return { r, key: k.ok ? k.key : null, keyReason: k.ok ? null : k.reason, y, m, d, dealDate };
      });

      // 자연키 그룹 + occurrenceIndex — 파일 순서(= 원천 응답 순서) 그대로
      const groupKeys = keyed.map((p) => {
        if (!p.key || !p.dealDate) return null;
        const floor = intOrNull(p.r.floor);
        if (floor === null) return null;
        return ds === 'SALE'
          ? officetelSaleGroupKey({ canonicalKey: p.key, dealDate: p.dealDate, exclusiveArea: p.r.excluUseAr, dealAmount: num(p.r.dealAmount) ?? 0, floor })
          : officetelRentGroupKey({ canonicalKey: p.key, dealDate: p.dealDate, exclusiveArea: p.r.excluUseAr, deposit: num(p.r.deposit) ?? 0, monthlyRent: num(p.r.monthlyRent) ?? 0, floor });
      });
      const occ = assignOccurrenceIndexes(groupKeys.map((g) => g ?? ' UNRESOLVED'));

      for (let i = 0; i < keyed.length; i++) {
        const p = keyed[i];
        const r = p.r;
        if (!p.key) { cellInvalidReason = `canonicalKey 생성 실패(${p.keyReason})`; stat.keyFail++; break; }
        if (!p.dealDate || !p.y || !p.m || !p.d) { cellInvalidReason = 'dealDate 파싱 실패'; break; }
        // 셀 좌표와 행 계약연월 일치 (STEP 1 §10 occurrence 배치 전제)
        if (`${p.y}${String(p.m).padStart(2, '0')}` !== cell.dealYmd) { cellInvalidReason = `cell dealYmd(${cell.dealYmd}) != row ${p.y}-${p.m}`; break; }
        const floor = intOrNull(r.floor);
        if (floor === null) { cellInvalidReason = 'floor 파싱 실패(NOT NULL 컬럼)'; break; }
        const areaRaw = text(r.excluUseAr);
        const areaNum = areaRaw === null ? null : num(areaRaw);
        if (areaRaw === null || areaNum === null || areaNum <= 0) { cellInvalidReason = '전용면적 결측/파싱 실패'; break; }
        const gk = groupKeys[i];
        if (!gk) { cellInvalidReason = '자연키 그룹 생성 실패'; break; }

        // master linkage — 주소 그룹에 master가 정확히 1건일 때만 연결(추측 금지)
        const addr = `${text(r.sggCd)}|${normalizeUmd(r.umdNm)}|${normalizeJibun(r.jibun)}`;
        const group = masterByAddr.get(addr);
        let masterId: number | null = null;
        let linkage: PreparedRow['linkage'];
        if (!group) linkage = 'MASTER_MISS';
        else if (group.length === 1) { linkage = 'LINKABLE'; masterId = group[0].id; }
        else linkage = 'UNRESOLVED_MULTI';

        const common = {
          source,
          officetelMasterId: masterId,
          canonicalKey: p.key,
          lawdCd: cell.lawdCd,
          dealYmd: cell.dealYmd,
          umdNm: text(r.umdNm) ?? '',
          jibun: text(r.jibun) ?? '',
          offiNm: text(r.offiNm) ?? '',
          exclusiveArea: new Prisma.Decimal(areaRaw), // 원본 문자열 그대로 — 반올림 금지
          dealYear: p.y, dealMonth: p.m, dealDay: p.d,
          dealDate: new Date(`${p.dealDate}T00:00:00.000Z`),
          floor,
          buildYear: intOrNull(r.buildYear),
          occurrenceIndex: occ[i],
          sourceFetchedAt: sweptAt,
        };

        let data: Record<string, unknown>;
        if (ds === 'SALE') {
          const amount = intOrNull(r.dealAmount);
          if (amount === null || amount <= 0) { cellInvalidReason = '거래금액 결측/파싱 실패'; break; }
          data = {
            ...common,
            dealAmount: amount,
            dealingGbn: text(r.dealingGbn),
            buyerGbn: text(r.buyerGbn),
            // STEP 3A §12-5 — 원천 필드명은 sellerGbn이 아니라 slerGbn이다.
            sellerGbn: text(r.slerGbn),
            estateAgentSggNm: text(r.estateAgentSggNm),
            dealCanceled: text(r.cdealType) === 'O',
            cancelDate: text(r.cdealDay), // 원본 표기 그대로(YY.MM.DD) — 재해석 금지
          };
        } else {
          const deposit = intOrNull(r.deposit);
          const monthlyRent = intOrNull(r.monthlyRent);
          if (deposit === null || monthlyRent === null) { cellInvalidReason = '보증금/월세 파싱 실패'; break; }
          data = {
            ...common,
            deposit, monthlyRent,
            contractTerm: text(r.contractTerm),
            contractType: text(r.contractType),
            preDeposit: intOrNull(r.preDeposit),
            preMonthlyRent: intOrNull(r.preMonthlyRent),
            // 원천에 "미사용" 값이 존재하지 않는다 — false를 만들지 않는다(null=UNKNOWN).
            useRenewalRight: text(r.useRRRight) === '사용' ? true : null,
          };
        }
        prepared.push({ canonicalKey: p.key, groupKey: gk, occurrenceIndex: occ[i], officetelMasterId: masterId, linkage, data });
      }

      if (cellInvalidReason) {
        stat.cellsInvalid++;
        stat.invalidRows += cell.rows.length;
        problemCells.push({ cell: cellId, status: 'INVALID', reason: cellInvalidReason });
        manifest[cellId] = { status: 'INVALID', sourceRows: cell.rows.length, inserted: 0, skippedDuplicates: 0, linkable: 0, unresolved: 0, reason: cellInvalidReason, at: new Date().toISOString() };
        saveManifest(manifest);
        continue;
      }

      const linkable = prepared.filter((p) => p.linkage === 'LINKABLE').length;
      const multi = prepared.filter((p) => p.linkage === 'UNRESOLVED_MULTI').length;
      const miss = prepared.filter((p) => p.linkage === 'MASTER_MISS').length;
      stat.prepared += prepared.length;
      stat.linkable += linkable; stat.unresolvedMulti += multi; stat.masterMiss += miss;

      let inserted = 0, skippedDup = 0;
      if (APPLY && prepared.length > 0) {
        for (let i = 0; i < prepared.length; i += CHUNK_SIZE) {
          const chunk = prepared.slice(i, i + CHUNK_SIZE);
          const rows = chunk.map((p) => p.data);
          const res = ds === 'SALE'
            ? await prisma.officetelTradeHistory.createMany({ data: rows as never, skipDuplicates: true })
            : await prisma.officetelRentHistory.createMany({ data: rows as never, skipDuplicates: true });
          inserted += res.count;
          skippedDup += chunk.length - res.count;
        }
      }
      stat.inserted += inserted;
      stat.skippedDuplicates += skippedDup;

      const status: CellStatus = prepared.length === 0 ? 'EMPTY_VALID' : APPLY ? 'SUCCESS' : 'DRY_RUN';
      if (prepared.length === 0) stat.cellsEmpty++; else if (APPLY) stat.cellsWritten++;
      manifest[cellId] = { status, sourceRows: cell.rows.length, inserted, skippedDuplicates: skippedDup, linkable, unresolved: multi + miss, at: new Date().toISOString() };
      // manifest는 매 셀마다 전체를 다시 직렬화하면 후반부로 갈수록 급격히 느려진다.
      // 50셀마다 저장하고 마지막에 한 번 더 저장한다 — 중단 시 최대 50셀을 다시 처리하지만
      // createMany(skipDuplicates)가 멱등이라 중복이 생기지 않는다.
      if (stat.cellsSeen % 50 === 0) saveManifest(manifest);

      if (stat.cellsSeen % 400 === 0) {
        console.log(`  ...${cell.lawdCd}:${cell.dealYmd}  cells=${stat.cellsSeen} rows=${stat.sourceRows} inserted=${stat.inserted}`);
      }
    }

    saveManifest(manifest);

    // ── 원천 총계 게이트 (write 여부와 무관하게 항상 검사) ─────────────
    const auditRows = AUDITED[ds].rows, auditCells = AUDITED[ds].cells;
    const emptyCellsInFile = auditCells - stat.cellsSeen; // NDJSON에는 0행 셀이 아예 없다
    console.log(`  cells(데이터 있는) ${stat.cellsSeen} + 빈 셀 ${emptyCellsInFile} = ${auditCells} (감사값 ${auditCells})`);
    console.log(`  원천 행 ${stat.sourceRows.toLocaleString()} vs 감사값 ${auditRows.toLocaleString()} → 차이 ${stat.sourceRows - auditRows}`);
    if (stat.sourceRows !== auditRows) {
      throw new Error(`ABORT: ${ds} 원천 행 수가 감사값과 다르다 (${stat.sourceRows} vs ${auditRows}) — write 중단`);
    }
    console.log(
      `  준비 ${stat.prepared.toLocaleString()} · 적재 ${stat.inserted.toLocaleString()} · 중복skip ${stat.skippedDuplicates} · ` +
      `linkable ${stat.linkable.toLocaleString()} · multi ${stat.unresolvedMulti} · miss ${stat.masterMiss}`
    );
    console.log(`  셀 상태: written ${stat.cellsWritten} / resume-skip ${stat.cellsSkippedResume} / empty ${stat.cellsEmpty} / PARTIAL ${stat.cellsPartial} / INVALID ${stat.cellsInvalid}\n`);

    report[ds] = { ...stat, problemCells };
  }

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedAt.getTime();
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 1));
  console.log(`report → ${REPORT_PATH}`);
}

main().catch((e) => { console.error('FAILED', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
