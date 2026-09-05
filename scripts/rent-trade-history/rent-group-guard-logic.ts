// RENT_OCCURRENCE_SAFETY_V1 §3/§4/§5 — Option E "group insert guard"의 순수 판정 로직.
//
// 왜 필요한가(RENT_OCCURRENCE_STABILITY_V1 실측 근거):
//   occurrenceIndex는 (lawdCd, dealYmd) 배치 안에서 **행 내용의 결정적 정렬 순위**로
//   부여된다(rent-history-logic.ts). 순서 불안정은 이것으로 이미 제거됐다. 그러나 원천에
//   **나중에 형제 행이 추가되고 그 행이 기존 형제보다 앞으로 정렬되면** 기존 행의 순위가
//   0 → 1로 밀린다. DB의 기존 행은 여전히 occurrenceIndex=0을 들고 있으므로:
//
//     source rank0(신규)  ↔ DB occ0(기존)  → 내용 diff → first-mutation guard가 UPDATE 차단
//     source rank1(기존)  ↔ DB occ1(없음)  → 매칭 실패 → INSERT
//
//   즉 UPDATE만 막고 INSERT는 그대로 실행되어, **기존 행 내용의 복제본이 새로 생기고
//   신규 행의 진짜 내용은 영영 저장되지 않는다.** 2026-09-05 실행에서 실제로 2건 발생했다
//   (26170:202608 / 26260:202607, contractTerm 오염). 원천 대조로 확정.
//
// Option E의 계약(이 파일이 강제하는 불변식):
//   그룹 G에 review candidate가 하나라도 있으면  →  UPDATE(G) = 0  AND  INSERT(G) = 0
//   깨끗한 그룹 H                                →  기존 동작 그대로 유지
//
// 셀 전체를 막지 않는다 — 같은 셀의 무관한 그룹은 정상 진행한다(§3 "prefer group-level guard").
// RENT는 애초에 기존 행을 UPDATE하는 경로가 없으므로(§13 first mutation guard) "UPDATE(G)=0"은
// 구조적으로 이미 참이며, 이 파일이 추가로 막는 것은 INSERT뿐이다.
//
// ─────────────────────────────────────────────────────────────────────────
// TODO(FUTURE / Option D — 이번 STEP 범위 아님, 별도 승인 필요):
//   이 가드는 **출혈 차단**이지 근본 해결이 아니다. 가드가 걸린 그룹은 coverage가 전진하지
//   않으므로 사람이 개입할 때까지 그 셀이 계속 보류된다(그것이 의도다 — 조용한 오염보다 낫다).
//   근본 해결은 "슬롯(occurrenceIndex) 대조"를 "그룹 내용 multiset 대조"로 바꾸는 것이다:
//     - 그룹 단위로 DB 내용 multiset과 원천 내용 multiset을 비교한다.
//     - 부족한 내용만 INSERT하고, 초과분만 REVIEW로 올린다.
//     - occurrenceIndex는 매칭 키가 아니라 **저장용 일련번호**로만 남긴다.
//   자연키/unique constraint/기존 행/스키마를 전혀 바꾸지 않고 적용할 수 있다
//   (schema migration 불필요). 설계 승인 후 별도 STEP에서 진행한다.
// ─────────────────────────────────────────────────────────────────────────
//
// 이 파일은 **zero-import**를 유지한다 — `node --experimental-strip-types --test`가
// 확장자 없는 상대 import를 해석하지 못하기 때문이다(rent-history-logic.ts와 동일한 제약).

/**
 * 자연키 **밖**의 서술 필드 비교 집합. 기존 rent-sync-core.ts의 COMPARE_FIELDS를 그대로
 * 옮겨온 것이며 값/순서를 바꾸지 않았다 — 정의가 두 곳에 갈라지지 않도록 여기를 단일
 * 출처로 삼는다(§4 "판정 규칙을 복제하지 않는다").
 */
export const RENT_COMPARE_FIELDS = [
  'aptName',
  'dong',
  'jibun',
  'buildYear',
  'contractType',
  'contractTerm',
  'preDeposit',
  'preMonthlyRent',
  'useRenewalRight',
] as const;

export type RentCompareField = (typeof RENT_COMPARE_FIELDS)[number];

/** occurrenceIndex를 제외한 자연키 성분. */
export interface RentNaturalKeyParts {
  groupKeyStr: string;
  deposit: number;
  monthlyRent: number;
  /** "YYYY-MM-DD" — 호출부가 Date를 이 형태로 정규화해서 넘긴다. */
  dealDate: string;
  floor: number | null;
}

export type RentComparableRow = RentNaturalKeyParts & {
  occurrenceIndex: number;
} & { [K in RentCompareField]?: unknown };

/**
 * §4 GROUP IDENTITY — occurrenceIndex **이전**의 자연 그룹.
 * rent-history-logic.ts가 occurrenceIndex를 매길 때 쓰는 그룹 정의와 문자 그대로 같아야 한다.
 */
export function rentOccurrenceGroupKey(r: RentNaturalKeyParts): string {
  return `${r.groupKeyStr}|${r.deposit}|${r.monthlyRent}|${r.dealDate}|${r.floor}`;
}

/** DB unique constraint(rent_natural_key)와 1:1 대응하는 매칭 키. */
export function rentNaturalKeyStr(r: RentNaturalKeyParts & { occurrenceIndex: number }): string {
  return `${r.groupKeyStr}::${r.deposit}::${r.monthlyRent}::${r.dealDate}::${r.floor}::${r.occurrenceIndex}`;
}

export interface RentReviewDiff<S, E> {
  row: S;
  match: E;
  fields: RentCompareField[];
}

export interface RentCellWritePlan<S, E> {
  /** 실제로 INSERT해도 되는 행(가드가 걸린 그룹은 제외됨). */
  inserts: S[];
  /** 가드 때문에 INSERT하지 않은 행 — 다음 실행에서 사람이 판단할 때까지 보류된다. */
  skippedInserts: S[];
  /** review candidate가 있어 통째로 보류된 그룹의 key. */
  guardedGroups: string[];
  reviewDiffs: RentReviewDiff<S, E>[];
  /** review candidate **필드** 수(기존 reviewCandidates 집계와 같은 단위). */
  reviewCandidateFieldCount: number;
  unchanged: number;
}

/**
 * 한 셀(lawdCd+dealYmd)의 쓰기 계획을 세운다. 판정만 하고 아무것도 쓰지 않는다.
 *
 * 기존 rent-sync-core의 동작과 유일하게 다른 점은 §5 INSERT SAFETY 불변식이다:
 * review candidate가 있는 그룹의 INSERT를 `skippedInserts`로 빼낸다. 깨끗한 그룹의
 * 동작(신규 INSERT / unchanged 집계 / diff 보고)은 100% 그대로다.
 */
export function planRentCellWrites<S extends RentComparableRow, E extends RentComparableRow>(
  sourceRows: S[],
  existingRows: E[]
): RentCellWritePlan<S, E> {
  const existingMap = new Map<string, E>();
  for (const e of existingRows) {
    // 자연키에 floor가 필수 — null인 행은 매칭 대상이 아니다(기존 정책과 동일).
    if (e.floor == null) continue;
    existingMap.set(rentNaturalKeyStr(e), e);
  }

  const candidateInserts: S[] = [];
  const reviewDiffs: RentReviewDiff<S, E>[] = [];
  const guarded = new Set<string>();
  let unchanged = 0;
  let reviewCandidateFieldCount = 0;

  for (const row of sourceRows) {
    const match = existingMap.get(rentNaturalKeyStr(row));
    if (!match) {
      candidateInserts.push(row);
      continue;
    }
    const fields = RENT_COMPARE_FIELDS.filter(
      (f) => (match as Record<RentCompareField, unknown>)[f] !== (row as Record<RentCompareField, unknown>)[f]
    );
    if (fields.length === 0) {
      unchanged++;
      continue;
    }
    reviewDiffs.push({ row, match, fields });
    reviewCandidateFieldCount += fields.length;
    // §3/§5 — 이 그룹 전체를 보류 대상으로 표시한다.
    guarded.add(rentOccurrenceGroupKey(row));
  }

  const inserts: S[] = [];
  const skippedInserts: S[] = [];
  for (const row of candidateInserts) {
    if (guarded.has(rentOccurrenceGroupKey(row))) skippedInserts.push(row);
    else inserts.push(row);
  }

  return {
    inserts,
    skippedInserts,
    guardedGroups: [...guarded],
    reviewDiffs,
    reviewCandidateFieldCount,
    unchanged,
  };
}
