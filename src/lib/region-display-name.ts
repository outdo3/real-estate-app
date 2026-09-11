/**
 * STATS_HEADER_REGION_LABEL_UX_FIX_V1 §3 — 지역 표시 이름의 **단일 출처**.
 *
 * ── 왜 함수 하나로 모으나 ───────────────────────────────────────────────────
 * 이 라벨은 지금까지 여섯 곳에서 각자 템플릿 문자열로 만들어지고 있었다
 * (RegionContext 기본값/GPS, stats-client, school-client, stats/[type], LargeComplexView,
 * RegionSelectModal). 그래서 그중 몇 곳이 `${sido} ${sigungu} 동 전체`를 만들었고,
 * 화면에는 **"부산광역시 서구 동 전체"** 처럼 읽히는 문구가 나왔다.
 *
 * "동"은 행정 단계 이름이지 선택된 지역이 아니다. 아무 동도 고르지 않았다면 그냥
 * "서구 전체"다. 하위 단계를 고르지 않았다는 이유로 그 단계 이름을 문구에 끼워 넣으면,
 * 사용자에게는 "동"이라는 지역이 선택된 것처럼 보인다.
 *
 * 규칙을 한 곳에 두면 호출부가 늘어도 같은 문구가 보장된다.
 */

export interface RegionNameParts {
  /** 시/도 이름. 예: "부산광역시" */
  sido?: string | null;
  /** 시/군/구 짧은 이름. 예: "서구". 비어 있으면 시도 전체를 뜻한다. */
  sigungu?: string | null;
  /**
   * 읍/면/동. `'all'`(또는 빈 값)이면 **아무 동도 고르지 않았다**는 뜻이다.
   * 값이 이미 전체 주소("부산광역시 서구 동대신동3가")면 그대로 쓴다 —
   * 지역코드 API가 그 형태로 돌려주기 때문이다.
   */
  dong?: string | null;
}

/** 동을 고르지 않은 상태를 나타내는 sentinel. */
export const ALL_DONG = 'all';

export function isAllDong(dong?: string | null): boolean {
  return !dong || dong === ALL_DONG;
}

/**
 * 표시용 지역 이름.
 *
 *   시도만            → "부산광역시 전체"
 *   시도 + 구         → "부산광역시 서구 전체"      (❌ "부산광역시 서구 동 전체")
 *   시도 + 구 + 동    → "부산광역시 서구 동대신동3가"
 *
 * sido가 없으면 빈 문자열을 돌려준다 — 지역을 지어내지 않는다.
 */
export function buildRegionDisplayName({ sido, sigungu, dong }: RegionNameParts): string {
  const sidoName = (sido ?? '').trim();
  if (!sidoName) return '';

  const sigunguName = (sigungu ?? '').trim();
  if (!sigunguName) return `${sidoName} 전체`;

  if (isAllDong(dong)) return `${sidoName} ${sigunguName} 전체`;

  const dongName = (dong ?? '').trim();
  // 지역코드 API가 주는 전체 주소면 앞을 중복해서 붙이지 않는다.
  if (dongName.startsWith(sidoName)) return dongName;
  return `${sidoName} ${sigunguName} ${dongName}`;
}
