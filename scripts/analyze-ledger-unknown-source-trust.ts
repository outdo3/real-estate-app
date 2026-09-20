/**
 * BUILDING_LEDGER_UNKNOWN_SOURCE_TRUST_AUDIT_V1 §1~§16 — 수집된 raw를 **추가 호출 없이**
 * 집계한다. DB write 0 · 외부 호출 0.
 *
 *   npx tsx scripts/analyze-ledger-unknown-source-trust.ts
 */
import * as path from 'path';
import * as fs from 'fs';

const OUT = path.resolve(__dirname, '../tmp/unknown-source');

export type FieldDiff = 'UNCHANGED' | 'SAFE_VALUE_DIFF' | 'STORED_BUT_NOW_WITHHELD' | 'NEW_SAFE_VALUE_AVAILABLE' | 'REVIEW_REQUIRED' | 'SOURCE_EMPTY';

/** 저장값과 safe 결과를 한 필드 단위로 비교한다. safe가 값을 못 만들면 그 사실을 구분해 남긴다. */
export function diffField(stored: unknown, safe: unknown, safeAvailable: boolean, reviewed: boolean): FieldDiff {
  if (!safeAvailable) {
    if (reviewed) return 'REVIEW_REQUIRED';
    return stored == null ? 'SOURCE_EMPTY' : 'STORED_BUT_NOW_WITHHELD';
  }
  if (stored == null) return 'NEW_SAFE_VALUE_AVAILABLE';
  const same = typeof stored === 'number' && typeof safe === 'number'
    ? Math.abs(stored - safe) < 0.01 : String(stored).trim() === String(safe).trim();
  return same ? 'UNCHANGED' : 'SAFE_VALUE_DIFF';
}

/** null · undefined · 공백뿐인 문자열을 모두 "값 없음"으로 본다. */
export function isBlank(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

export type MasterClass = 'AUTO_SAFE' | 'PARTIAL_SAFE' | 'REVIEW_REQUIRED' | 'KEEP_CURRENT' | 'KEEP_NULL' | 'SOURCE_EMPTY';

function main() {
  const src = JSON.parse(fs.readFileSync(path.join(OUT, 'raw.json'), 'utf8'));
  const rows: Record<string, any>[] = src.rows;
  const tally = (f: (r: any) => string | null, list = rows) =>
    list.reduce((a: Record<string, number>, r) => { const k = f(r); if (k == null) return a; a[k] = (a[k] ?? 0) + 1; return a; }, {});
  const count = (p: (r: any) => boolean, list = rows) => list.filter(p).length;

  const complete = rows.filter((r) => r.fetch === 'COMPLETE');
  const empty = rows.filter((r) => r.fetch === 'EMPTY');
  const notFetched = rows.filter((r) => r.fetch !== 'COMPLETE' && r.fetch !== 'EMPTY');

  // §1 저장 필드 보유. **빈 문자열은 값이 아니다** — 앞선 감사에서 stored "" 를 값으로 세어
  // 허수가 생긴 적이 있다(도로명 47건이 여기 해당).
  const s = (k: string) => count((r) => !isBlank(r.stored?.[k]));
  const population = {
    households: s('households'), parking: s('parking'), parkingPerHousehold: s('pph'),
    far: s('far'), bcr: s('bcr'), approvalDate: s('approvalDate'), roadAddress: s('roadAddress'),
    buildingCount: s('buildingCount'), mgmBldrgstPk: s('mgmBldrgstPk'),
    coordinates: count((r) => r.stored?.hasCoords),
    anyLedgerDerived: count((r) => ['households', 'parking', 'far', 'bcr', 'approvalDate', 'roadAddress', 'buildingCount', 'mgmBldrgstPk'].some((k) => !isBlank(r.stored?.[k]))),
    roadAddressStoredBlankString: count((r) => r.stored?.roadAddress != null && isBlank(r.stored?.roadAddress)),
  };

  // §7 세대수 신뢰 census
  const households: Record<string, any>[] = complete.map((r) => {
    const stored = r.stored.households as number | null;
    const safe = r.safeHouseholds as number | null;
    const blocked = (r.householdsBlocked ?? []).length > 0;
    let cls: string;
    if (safe == null) cls = blocked ? 'REVIEW_REQUIRED' : 'SOURCE_EMPTY';
    else if (stored == null) cls = 'KEEP_NULL';
    else if (stored === safe) cls = 'STORED_CORRECT';
    else cls = 'AUTO_CORRECTABLE';
    // 저장값이 개별 동 한 곳의 값과 정확히 일치 = 잘림 흔적
    const truncationSign = stored != null && safe != null && stored !== safe && (r.recordHouseholds ?? []).includes(stored);
    return { ...r, hCls: cls, truncationSign, storedH: stored, safeH: safe };
  });
  const householdsCensus = {
    STORED_CORRECT: count((r) => r.hCls === 'STORED_CORRECT', households),
    AUTO_CORRECTABLE: count((r) => r.hCls === 'AUTO_CORRECTABLE', households),
    REVIEW_REQUIRED: count((r) => r.hCls === 'REVIEW_REQUIRED', households),
    KEEP_NULL: count((r) => r.hCls === 'KEEP_NULL', households),
    SOURCE_EMPTY: count((r) => r.hCls === 'SOURCE_EMPTY', households) + empty.length,
    truncationSignCount: count((r) => r.truncationSign, households),
  };

  // §6 필드별 stored vs safe
  //
  // 도로명은 diffField를 쓰지 않는다. decideRoadAddress는 **이미 일치할 때 newValue를 null로**
  // 돌려주기 때문에, 그 null을 "safe 값"으로 넘기면 일치하는 행이 전부 SAFE_VALUE_DIFF로
  // 잘못 집계된다(실측: 449건이 그렇게 잡혔다). 판정 자체를 그대로 읽는다.
  const roadDiff = (r: Record<string, any>): FieldDiff => {
    const storedBlank = isBlank(r.stored.roadAddress);
    switch (r.roadVerdict) {
      case 'ALREADY_OK': return 'UNCHANGED';
      case 'AUTO_SAFE': return storedBlank ? 'NEW_SAFE_VALUE_AVAILABLE' : 'SAFE_VALUE_DIFF';
      case 'REVIEW_REQUIRED': return 'REVIEW_REQUIRED';
      default: return storedBlank ? 'SOURCE_EMPTY' : 'STORED_BUT_NOW_WITHHELD';
    }
  };
  const fieldDiff = {
    households: tally((r) => diffField(r.storedH, r.safeH, r.safeH != null, (r.householdsBlocked ?? []).length > 0), households),
    roadAddress: tally((r) => roadDiff(r), complete),
  };

  // §8 주차 — 자동 규칙 없음, 분류와 모순만
  const parkingCensus = tally((r) => r.parkingPattern ?? null, complete);
  const parkingContradiction = complete.filter((r) => {
    const stored = r.stored.parking as number | null;
    const distinct: number[] = r.parkingDistinctNonZero ?? [];
    if (stored == null || distinct.length === 0) return false;
    // 저장값이 원본 어디에도 없고 합계와도 다르면 논리적으로 모순이다
    const sum = distinct.reduce((a, b) => a + b, 0);
    return !distinct.includes(stored) && stored !== sum;
  });

  // §11 도로명 · §12 승인일/FAR/BCR
  const roadCensus = tally((r) => r.roadVerdict ?? null, complete);
  const approvalCensus = tally((r) => r.approvalPattern ?? null, complete);
  const farCensus = tally((r) => r.farPattern ?? null, complete);
  const bcrCensus = tally((r) => r.bcrPattern ?? null, complete);

  // §9 파생비율 · §10 이상치
  const autoH = households.filter((r) => r.hCls === 'AUTO_CORRECTABLE');
  const derivedRatioProjected = count((r) => r.stored.pph != null && r.stored.parking != null, autoH);
  const ratio = (h: number | null, p: number | null) => (h && p && h > 0 ? p / h : null);
  const withRatio = rows.map((r) => ({
    aptSeq: r.aptSeq, name: r.name, storedH: r.stored.households, parking: r.stored.parking,
    safeH: r.safeHouseholds ?? null,
    old: ratio(r.stored.households, r.stored.parking),
    projected: ratio(r.safeHouseholds ?? null, r.stored.parking),
  }));
  const over = (t: number, key: 'old' | 'projected') => withRatio.filter((x) => x[key] != null && x[key]! > t);
  const severe = {
    over2: over(2, 'old').length, over5: over(5, 'old').length, over10: over(10, 'old').length,
    projectedOver2: withRatio.filter((x) => (x.projected ?? x.old ?? 0) > 2).length,
    top: over(2, 'old').sort((a, b) => b.old! - a.old!).slice(0, 30).map((x) => ({
      aptSeq: x.aptSeq, name: x.name, storedH: x.storedH, safeH: x.safeH, parking: x.parking,
      oldRatio: +x.old!.toFixed(2), projectedRatio: x.projected ? +x.projected.toFixed(2) : null,
    })),
  };

  // §14 캐시
  const cache = {
    overlap: count((r) => r.inCache), tier1Gate: count((r) => r.cacheTier1),
    tier1OnAutoH: count((r) => r.cacheTier1, autoH),
    maskingRisk: count((r) => r.cacheTier1 && r.cacheHouseholds != null, autoH),
  };

  // §15 master-level 분류
  const classified = rows.map((r) => {
    const h = households.find((x) => x.aptSeq === r.aptSeq);
    const hAuto = h?.hCls === 'AUTO_CORRECTABLE';
    const rAuto = r.roadVerdict === 'AUTO_SAFE';
    const anyReview = h?.hCls === 'REVIEW_REQUIRED' || r.roadVerdict === 'REVIEW_REQUIRED';
    let cls: MasterClass;
    if (r.fetch === 'EMPTY') cls = 'SOURCE_EMPTY';
    else if (r.fetch !== 'COMPLETE') cls = 'REVIEW_REQUIRED';
    else if ((hAuto || rAuto) && !anyReview) cls = 'AUTO_SAFE';
    else if (hAuto || rAuto) cls = 'PARTIAL_SAFE';
    else if (anyReview) cls = 'REVIEW_REQUIRED';
    else if (h?.hCls === 'KEEP_NULL') cls = 'KEEP_NULL';
    else cls = 'KEEP_CURRENT';
    return { aptSeq: r.aptSeq, name: r.name, cls, hCls: h?.hCls ?? null, roadVerdict: r.roadVerdict ?? null };
  });

  // §16 우선순위 분리
  const severeSeqs = new Set(severe.top.map((x) => x.aptSeq));
  const autoSeqs = new Set(classified.filter((c) => c.cls === 'AUTO_SAFE').map((c) => c.aptSeq));
  const priority = {
    A_severeAndAuto: [...autoSeqs].filter((s) => severeSeqs.has(s)).length,
    B_autoLowImpact: [...autoSeqs].filter((s) => !severeSeqs.has(s)).length,
    C_partialSafe: count((c) => c.cls === 'PARTIAL_SAFE', classified),
    D_reviewRequired: count((c) => c.cls === 'REVIEW_REQUIRED', classified),
  };

  const out = {
    at: new Date().toISOString(), readOnly: true, dbWrites: 0, externalCalls: 0,
    baseline: { unknownMasters: rows.length, apiCalls: src.apiCalls, rateLimited: src.rateLimited,
      backoffWaits: src.backoffWaits, unresolvedFetchFailures: (src.failures ?? []).length },
    fetch: { COMPLETE: complete.length, EMPTY: empty.length, NOT_FETCHED: notFetched.length },
    population,
    provenance: tally((r) => r.provenance),
    paginationExposure: { buckets: tally((r) => r.bucket ?? null, complete),
      multiRecord: count((r) => (r.totalCount ?? 0) > 1, complete),
      multiRecordRate: complete.length ? +((count((r) => (r.totalCount ?? 0) > 1, complete) / complete.length) * 100).toFixed(2) : 0,
      maxRecords: complete.reduce((m, r) => Math.max(m, r.totalCount ?? 0), 0) },
    fieldDiff,
    householdsCensus,
    parkingCensus,
    parkingContradiction: { count: parkingContradiction.length,
      samples: parkingContradiction.slice(0, 10).map((r) => ({ aptSeq: r.aptSeq, name: r.name, stored: r.stored.parking, sourceDistinct: r.parkingDistinctNonZero })) },
    roadCensus, approvalCensus, farCensus, bcrCensus,
    derivedRatioProjected,
    severe, cache,
    masterClasses: tally((c) => c.cls, classified),
    fieldLevelAuto: {
      householdsAuto: householdsCensus.AUTO_CORRECTABLE,
      roadAddressAuto: count((r) => r.roadVerdict === 'AUTO_SAFE', complete),
      approvalDateAuto: count((r) => (r.approvalPattern === 'ALL_SAME' || r.approvalPattern === 'SINGLE') && r.stored.approvalDate == null, complete),
      derivedRatioProjected,
    },
    priority,
    classified,
  };
  fs.writeFileSync(path.join(OUT, 'analysis.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, classified: classified.length }, null, 2));
}

if (require.main === module) main();
