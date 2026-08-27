// APT_DETAIL_MOBILE_UX_REGRESSION_HOTFIX §18~22 — 순수 판정 로직만 분리했다(부작용
// 없음, EducationPanel.tsx가 이 함수만 사용). 기존 KakaoPlaces.tsx/map/page.tsx가 이미
// 쓰는 것과 동일한 /school/[id] 계약(name+lat+lng+lawdCd 쿼리스트링)을 그대로 재사용한다.
// 좌표가 없으면(과거 캐시, establishmentType 매칭 실패 등) null을 반환해 클릭 불가로
// 남긴다 — 학교명 재검색으로 다른 학교에 연결하는 name-only fallback은 만들지 않는다.

export interface SchoolLinkInput {
  name: string;
  kakaoId: string | null;
  lat: number | null;
  lng: number | null;
}

export function buildSchoolHref(school: SchoolLinkInput, lawdCd: string): string | null {
  if (school.lat == null || school.lng == null) return null;
  if (!Number.isFinite(school.lat) || !Number.isFinite(school.lng)) return null;
  const id = school.kakaoId || school.name;
  const params = new URLSearchParams({ name: school.name, lat: String(school.lat), lng: String(school.lng) });
  if (lawdCd) params.set('lawdCd', lawdCd);
  return `/school/${encodeURIComponent(id)}?${params.toString()}`;
}

// SCHOOLINFO / SCHOOL V2.1 §4/§7 — 공식 NEIS school code가 있는 학교는 좌표 없이도
// 상세페이지가 열려야 한다(핵심 PASS 조건). 이 링크는 좌표를 전혀 요구하지 않는다 —
// [id] 자리에 canonical neisSchoolCode를 그대로 써서 /api/school/[id] route가 School
// 테이블에서 직접 조회하게 한다. currentAptSeq가 있으면(아파트 상세에서 진입) 학교
// 상세페이지가 "현재 보고 있는 단지" 비교 컨텍스트를 유지할 수 있도록 함께 싣는다.
export function buildCanonicalSchoolHref(neisSchoolCode: string, opts?: { lawdCd?: string; currentAptSeq?: string }): string {
  const params = new URLSearchParams();
  if (opts?.lawdCd) params.set('lawdCd', opts.lawdCd);
  if (opts?.currentAptSeq) params.set('aptSeq', opts.currentAptSeq);
  const qs = params.toString();
  return `/school/${encodeURIComponent(neisSchoolCode)}${qs ? `?${qs}` : ''}`;
}
