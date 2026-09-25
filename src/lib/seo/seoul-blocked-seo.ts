// SEOUL_BETA_PRELAUNCH_SEO_SAFETY_FIX_V1 — 공개 차단된 서울 단지 화면의 색인 정책.
//
// SEOUL_BETA_EXPOSURE_LEAK_CLOSE_V1은 **데이터**를 닫았지만 메타데이터는 그대로였다. 운영 확인(2026-09-24):
// `/report/apt/11440-136`·`/apt/…?lawdCd=11440…`이 HTTP 200 + 단지명 <title> + self canonical + robots 없음 —
// 화면은 "준비 중"인데 검색엔진에는 색인 가능한 단지 페이지로 보였다.
//
// 판정은 enablement 축에만 위임한다(여기서 규칙을 새로 만들지 않는다):
//   · 해당 기능 축이 닫힘(beta OFF 서울 전부 · beta ON 강남/나머지 17구 · 리포트는 서울 전부)
//       → BLOCKED : 일반 제목, noindex·nofollow, canonical 없음
//   · 기능은 열렸지만 `seoIndex` 축이 닫힘(beta ON 승인 8구 상세)
//       → NOINDEX : 사용자용 단지 제목은 유지, noindex·nofollow, canonical 없음
//   · 열린 지역(부산 전 축 · 서울 8구 상세의 seoIndex 제외) → NONE : 기존 메타데이터 그대로
//
// GYEONGGI_PUBLIC_EXPOSURE_GUARD_V1 — 판정 기준을 서울 deny-list에서 공개 allowlist로 바꿨다. 예전에는
// 서울이 아니면(경기·대구·registry 밖 코드) 무조건 NONE이라, 경기 단지 상세가 self-canonical로 색인 가능했다
// (운영 실측 2026-09-25: /apt/동신2단지?lawdCd=41111). 이제 축이 닫힌 모든 지역이 BLOCKED다.
// 지역 코드가 하나도 없는 URL(이름만)은 지역을 알 수 없으므로 기존 동작(NONE, canonical 없음)을 유지한다.
// 경로를 404로 바꾸지 않는다 — beta를 켜는 순간 같은 URL이 그대로 열려야 하기 때문이다.
import { isPublicRegionAllowed, type RegionEnablement } from '@/lib/region/enablement';

export type SeoulSeoDecision = 'NONE' | 'BLOCKED' | 'NOINDEX';

/** 색인 금지 + 링크 추적 금지. 차단 화면에는 따라갈 만한 서울 링크가 없다. */
export const SEOUL_NOINDEX_ROBOTS = { index: false, follow: false } as const;

export type SeoulBlockedCheck = (lawdCd: string, feature: keyof RegionEnablement) => boolean;

/** 기본 판정: 그 축이 공개되지 않았으면 막힘(모르는 코드 포함). */
export const publicRegionBlocked: SeoulBlockedCheck = (lawdCd, feature) => !isPublicRegionAllowed(lawdCd, feature);

/** aptSeq(`11440-136`)의 앞 5자리 canonical 구 코드. 형태가 다르면 추측하지 않는다. */
export function lawdCdFromAptSeq(aptSeq: string | null | undefined): string | null {
  const m = /^(\d{5})-\d+$/.exec((aptSeq ?? '').trim());
  return m ? m[1] : null;
}

/**
 * 주어진 구 코드들(쿼리 lawdCd, aptSeq 앞자리 등) 중 **하나라도** 막혀 있으면 막는다 —
 * 쿼리 lawdCd와 aptSeq가 서로 다른 구를 가리키는 조작 URL도 덜 열린 쪽으로 판정된다.
 * `blocked`는 테스트에서 beta ON 상태를 시뮬레이션할 때만 바꾼다.
 */
export function decidePublicSeo(
  lawdCds: ReadonlyArray<string | null | undefined>,
  feature: 'app' | 'detail' | 'report',
  blocked: SeoulBlockedCheck = publicRegionBlocked
): SeoulSeoDecision {
  const codes = lawdCds.filter((c): c is string => !!c);
  if (codes.some((c) => blocked(c, feature))) return 'BLOCKED';
  if (codes.some((c) => blocked(c, 'seoIndex'))) return 'NOINDEX';
  return 'NONE';
}
