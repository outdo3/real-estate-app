// LAUNCH_TRUST_BLOCKERS_V1 — ApartmentScoreCard는 v2(_shadowV2) 결과가 있으면
// 항상 V1의 score 대신 V2의 overallScore를 화면에 보여준다(v2가 없을 때만 V1의
// 안내 문구로 대체). scoreVersion 응답도 실제로 화면에 쓰이는 엔진을 그대로
// 따라가야 label과 엔진이 어긋나지 않는다 — score formula 자체는 바꾸지 않는다.
export function resolveDisplayedScoreVersion(
  v2ScoreVersion: string | null | undefined,
  v1ScoreVersion: string | null
): string | null {
  return v2ScoreVersion ?? v1ScoreVersion;
}
