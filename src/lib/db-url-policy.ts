// SEOUL25_PREVIEW_READ_ONLY_DB_V1 — 런타임이 어떤 DB 연결을 쓰는가(순수 판정, 서버 전용).
//
// Production DATABASE_URL은 Production 환경에만 있다. Vercel Preview 빌드는 **별도의 read-only 역할**
// (SELECT 전용 · default_transaction_read_only · 공개 데이터 테이블만)로 만든 PREVIEW_DATABASE_URL만 쓴다.
//   · VERCEL_ENV === 'preview' 이고 PREVIEW_DATABASE_URL이 있으면 → 그 read-only 연결
//   · VERCEL_ENV === 'preview' 인데 없으면 → **닫힘**: 연결될 수 없는 주소를 준다. DATABASE_URL로 떨어지지 않는다.
//   · 그 밖(Production·로컬·테스트) → null = 지금과 같다(Prisma가 DATABASE_URL을 읽는다)
// NEXT_PUBLIC_* 가 아니므로 클라이언트 번들에 들어가지 않는다. 값은 로그에 남기지 않는다.

/** Preview인데 read-only 연결이 설정되지 않았을 때 쓰는 주소(.invalid TLD — 절대 해석되지 않는다). */
export const PREVIEW_DB_NOT_CONFIGURED_URL = 'postgresql://preview-db-not-configured.invalid:5432/none';

export type RuntimeDbSource = 'DEFAULT' | 'PREVIEW_READ_ONLY' | 'PREVIEW_NOT_CONFIGURED';

export function resolveRuntimeDatabaseUrl(env: Record<string, string | undefined>): { url: string | null; source: RuntimeDbSource } {
  if (env.VERCEL_ENV !== 'preview') return { url: null, source: 'DEFAULT' };
  const url = (env.PREVIEW_DATABASE_URL ?? '').trim();
  return url ? { url, source: 'PREVIEW_READ_ONLY' } : { url: PREVIEW_DB_NOT_CONFIGURED_URL, source: 'PREVIEW_NOT_CONFIGURED' };
}
