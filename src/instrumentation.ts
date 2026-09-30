// Next.js instrumentation — 서버 인스턴스가 시작될 때 한 번, 요청을 받기 전에 실행된다(node_modules/next/dist/docs 기준).
// REALTOR_PRO_PREVIEW_EXTERNAL_GUARD_V1 — Realtor Pro Preview(VERCEL_ENV=preview + REALTOR_PRO_ENABLED=true)에서만
// 외부 데이터 API 호출을 네트워크 없이 막는다. Production·로컬·다른 Preview에서는 아무것도 하지 않는다.
export async function register() {
  const { installPreviewExternalGuard } = await import('./lib/preview-external-guard');
  installPreviewExternalGuard(process.env as Record<string, string | undefined>);
}
