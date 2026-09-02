// DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5 §22 — Vercel Cron의 공식 문서화된 인증
// 컨벤션(Authorization: Bearer $CRON_SECRET)을 그대로 따른다. 이 저장소에 기존
// cron이 전혀 없어(Phase 1 감사 확인) 참고할 기존 컨벤션이 없었으므로, Vercel 자체
// 문서 컨벤션을 그대로 채택한다. secret은 절대 하드코딩하지 않고, 환경변수가 설정돼
// 있지 않으면 무조건 fail closed(거부)한다 — "아직 설정 안 됨"을 "인증 불필요"로
// 착각하지 않는다.
export function isAuthorizedCronRequest(authHeader: string | null, expectedSecret: string | undefined): boolean {
  if (!expectedSecret) return false;
  if (!authHeader) return false;
  return authHeader === `Bearer ${expectedSecret}`;
}
