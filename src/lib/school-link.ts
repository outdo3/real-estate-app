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
