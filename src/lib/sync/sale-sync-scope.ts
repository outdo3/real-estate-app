// SEOUL_SALE_INCREMENTAL_SYNC_PREP_V1 — 매매 cron(sale-sync · sale-recheck)의 구 목록을 고르는 **유일한** 자리.
//
// 왜 enablement.cronSync가 아닌가(docs/development/SEOUL_SALE_INCREMENTAL_SYNC_READINESS_AUDIT_V1.md):
// cronSync는 이름과 달리 상세·지도·통계 피드의 **DB-first 읽기** 스위치다. 서울에 켜면 cron 범위는
// 그대로인 채 비공개인 서울 화면의 읽기 경로만 바뀐다. 동기화 범위와 공개 범위는 여기서 분리한다.
//
// 허용 목록만 받는다 — URL로 임의의 lawdCd를 넘길 수 없다.
//   scope 없음  → undefined(= 코어의 기본값 BUSAN_LAWDCD_16, 기존 동작 그대로)
//   scope=seoul → 전체 이력 backfill과 사후 검증이 끝난 서울 구만
//   그 밖       → 거부(라우트가 400)

/**
 * 전체 이력 적재 + 사후 검증(원천 = DB) 완료 구만 넣는다.
 * 11680 강남은 2026-08 한 달(46행) 파일럿뿐이라 제외 — 넣으면 최근 창만 채워져 들쭉날쭉한 부분 이력이 된다.
 * 새 구는 backfill apply → post-apply verify 통과 뒤에만 추가한다.
 */
export const SEOUL_SALE_SYNC_LAWDCDS = ['11110', '11140', '11170'] as const;

export type SaleSyncScope = 'busan' | 'seoul';

export type ResolvedSaleSyncScope =
  | { ok: true; scope: SaleSyncScope; lawdCds: string[] | undefined }
  | { ok: false; error: string };

export function resolveSaleSyncScope(raw: string | null): ResolvedSaleSyncScope {
  // 생략만 기본값이다. 빈 문자열(`?scope=`)은 오타일 수 있으므로 기본값으로 삼키지 않는다.
  if (raw === null) return { ok: true, scope: 'busan', lawdCds: undefined };
  if (raw === 'seoul') return { ok: true, scope: 'seoul', lawdCds: [...SEOUL_SALE_SYNC_LAWDCDS] };
  return { ok: false, error: 'invalid scope' };
}
