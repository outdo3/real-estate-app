// REPORT_TOP_COMPLEX_ROW_UI_TUNE_V1 — "거래가 많은 단지" 행의 **표시 이름**만 정하는
// 순수 함수.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────────────
// 이 섹션은 원래 2줄이었다: 단지명 아래에 작은 글씨로 `동 · N건 거래`가 다시 나왔다.
// 오른쪽(가격 자리)은 이 섹션에 가격이 없어 비어 있었고, 같은 건수 정보가 두 줄로
// 흩어져 읽기 어려웠다. 한 줄 `[단지명] [N건]`으로 바꾸면서 지역 부줄을 없앤다.
//
// 그런데 지역을 완전히 지우면 **같은 이름의 다른 단지**가 같은 목록에 나란히 설 때
// 두 행이 구분되지 않는다. Production 실측(2026-09-12, 부산 매매 최근 12개월):
//
//   같은 구 · 같은 이름 · 다른 aptSeq 그룹            43건
//     그중 법정동까지 같아 동으로도 구분 불가            1건
//   구별 상위 5위 안에 같은 이름이 둘 이상 든 경우      0건
//
// 즉 **지금은 한 건도 없지만 구조적으로 가능하다**(예: 부산진구 `유림노르웨이숲`이
// 구포동 50건 / 만덕동 13건으로 따로 존재한다). 그래서 기본은 이름만 쓰고, 같은
// 목록 안에서 이름이 겹칠 때만 그 행들에 동을 덧붙인다. 겹치지 않는 평상시에는
// 출력이 이름 그대로라 밀도가 그대로 유지된다.
//
// 하지 않는 것: 없는 지역명을 만들지 않고, 이름으로 단지를 다시 식별하지 않는다.
// identity는 여전히 aptSeq이며(행 key와 상세 링크가 그걸 쓴다) 이 파일은 **화면에
// 보일 문자열**만 고른다.

export interface ComplexRowLabelInput {
  aptName: string;
  dong: string | null;
}

/**
 * 행별 표시 이름을 만든다. 입력과 **같은 길이·같은 순서**의 배열을 돌려준다.
 *
 * - 기본: `단지명`
 * - 같은 목록에 이름이 2개 이상 있고, 그 그룹의 동이 서로 다르고, 해당 행에 동이
 *   있으면: `단지명 (동)`
 * - 동이 전부 같거나 비어 있으면 덧붙이지 않는다 — 붙여도 구분이 안 되므로
 *   소음만 늘어난다.
 *
 * `showDong=false`(동 단위 리포트처럼 이미 한 동 안인 경우)면 절대 덧붙이지 않는다.
 */
export function complexRowLabels(
  rows: ReadonlyArray<ComplexRowLabelInput>,
  showDong: boolean
): string[] {
  if (!showDong) return rows.map((r) => r.aptName);

  const dongsByName = new Map<string, Set<string>>();
  const countByName = new Map<string, number>();
  for (const r of rows) {
    countByName.set(r.aptName, (countByName.get(r.aptName) ?? 0) + 1);
    if (!dongsByName.has(r.aptName)) dongsByName.set(r.aptName, new Set());
    // 빈 동은 집합에 넣지 않는다 — "동을 모른다"를 하나의 값처럼 세지 않기 위해.
    if (r.dong) dongsByName.get(r.aptName)!.add(r.dong);
  }

  return rows.map((r) => {
    const duplicated = (countByName.get(r.aptName) ?? 0) > 1;
    const distinctDongs = dongsByName.get(r.aptName)?.size ?? 0;
    if (duplicated && distinctDongs > 1 && r.dong) return `${r.aptName} (${r.dong})`;
    return r.aptName;
  });
}

/** 행에 쓸 거래건수 라벨. "5건 거래"가 아니라 "5건" — 숫자가 먼저 읽히게 한다. */
export function complexCountLabel(count: unknown): string {
  const n = Number(count ?? 0);
  return `${Number.isFinite(n) ? n : 0}건`;
}
