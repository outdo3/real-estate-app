// SEOUL_SALE_INCREMENTAL_SYNC_PREP_V1 — 매매 cron(sale-sync · sale-recheck)의 구 목록을 고르는 **유일한** 자리.
//
// 왜 enablement.cronSync가 아닌가(docs/development/SEOUL_SALE_INCREMENTAL_SYNC_READINESS_AUDIT_V1.md):
// cronSync는 이름과 달리 상세·지도·통계 피드의 **DB-first 읽기** 스위치다. 서울에 켜면 cron 범위는
// 그대로인 채 비공개인 서울 화면의 읽기 경로만 바뀐다. 동기화 범위와 공개 범위는 여기서 분리한다.
//
// 허용 목록만 받는다 — URL로 임의의 lawdCd를 넘길 수 없다.
//   scope 없음  → undefined(= 코어의 기본값 BUSAN_LAWDCD_16, 기존 동작 그대로)
//   scope=seoul → 전체 이력 backfill과 사후 검증이 끝난 서울 구만
//   scope=gyeonggi → 같은 조건을 통과한 경기 첫 배치 8구만(41135 제외)
//   그 밖       → 거부(라우트가 400)

/**
 * 전체 이력 적재 + 사후 검증(원천 = DB) 완료 구만 넣는다.
 * 11680 강남은 2026-08 한 달(46행) 파일럿뿐이라 제외 — 넣으면 최근 창만 채워져 들쭉날쭉한 부분 이력이 된다.
 * 새 구는 backfill apply → post-apply verify 통과 뒤에만 추가한다.
 *
 * SEOUL_PHASE_C_CRON_SCOPE_EXPANSION_V1 — Phase C 5구(마포·서대문·동대문·광진·금천)를 추가해 8구가 됐다.
 * 근거: 2026-09-23 Phase C apply PASS — 204,987행 적재, 원천/DB parity exact(자연키·cancel_date 다중집합
 * 셀 단위 0 불일치), 취소 2,746 = 원천, re-plan 결과 pending insert 0, 부산 회귀 0.
 * 즉 5구 모두 위 조건(전체 이력 + 사후 검증)을 충족한 뒤에 들어왔다.
 */
export const SEOUL_SALE_SYNC_LAWDCDS = [
  '11110', // 종로구
  '11140', // 중구
  '11170', // 용산구
  '11440', // 마포구   — Phase C
  '11410', // 서대문구 — Phase C
  '11230', // 동대문구 — Phase C
  '11215', // 광진구   — Phase C
  '11545', // 금천구   — Phase C
] as const;

/**
 * GYEONGGI_CRON_EXPANSION_V1 — 경기 첫 배치 8구(사용자 승인 2026-09-25). **정확한 허용 목록**이다 — 경기를 동적으로
 * 모으지 않는다. 근거: NATIONAL_FIRST_BATCH_APPLY_V1 전체 이력 539,443행 적재 + 원천/DB parity exact(취소 7,291 = 원천),
 * GYEONGGI_MASTER_FULL_BATCH_APPLY_V1 master 1,193 parity exact.
 * 41135 분당은 원천 층 공란 4행 REVIEW라 적재도 안 됐다 — 넣지 않는다.
 * 이 목록은 **동기화 범위**일 뿐 공개 범위가 아니다(경기 공개는 enablement GYEONGGI_BETA_ENABLED, 현재 false).
 */
export const GYEONGGI_SALE_SYNC_LAWDCDS = [
  '41111', // 수원시 장안구
  '41113', // 수원시 권선구
  '41115', // 수원시 팔달구
  '41117', // 수원시 영통구
  '41131', // 성남시 수정구
  '41133', // 성남시 중원구
  '41150', // 의정부시
  '41210', // 광명시
] as const;

/**
 * SEOUL_17_CRON_EXPANSION_V1(승인 2026-09-29) — 서울 나머지 17구를 2개 shard로 나눈다(한 scope 17구는 60초 창을 넘길 수 있다).
 * shard 크기는 이미 검증된 서울 8구 scope(sale 32셀 · recheck 80셀)와 같게 맞췄다.
 *   seoul-b 9구: sale 36 · recheck 90  |  seoul-c 8구: sale 32 · recheck 80  → 합계 ≤ 238 MOLIT 호출/일
 * **전제 충족**: 17구 전체 이력 적재 완료 2026-09-29 — 1,180,587행, 원천/DB parity drift 0, missing 0,
 * review 32/32 source-bound(승인 중복 2행은 11590 소유). 이 목록은 **동기화 범위**일 뿐 공개 범위가 아니다
 * (17구 Production 공개는 enablement에서 따로 — 현재 닫힘). 11680 강남 포함(이제 전체 이력).
 */
export const SEOUL_SALE_SYNC_LAWDCDS_B = ['11200', '11260', '11290', '11305', '11320', '11350', '11380', '11470', '11500'] as const;
export const SEOUL_SALE_SYNC_LAWDCDS_C = ['11530', '11560', '11590', '11620', '11650', '11680', '11710', '11740'] as const;

export type SaleSyncScope = 'busan' | 'seoul' | 'seoul-b' | 'seoul-c' | 'gyeonggi';

export type ResolvedSaleSyncScope =
  | { ok: true; scope: SaleSyncScope; lawdCds: string[] | undefined }
  | { ok: false; error: string };

export function resolveSaleSyncScope(raw: string | null): ResolvedSaleSyncScope {
  // 생략만 기본값이다. 빈 문자열(`?scope=`)은 오타일 수 있으므로 기본값으로 삼키지 않는다.
  if (raw === null) return { ok: true, scope: 'busan', lawdCds: undefined };
  if (raw === 'seoul') return { ok: true, scope: 'seoul', lawdCds: [...SEOUL_SALE_SYNC_LAWDCDS] };
  if (raw === 'seoul-b') return { ok: true, scope: 'seoul-b', lawdCds: [...SEOUL_SALE_SYNC_LAWDCDS_B] };
  if (raw === 'seoul-c') return { ok: true, scope: 'seoul-c', lawdCds: [...SEOUL_SALE_SYNC_LAWDCDS_C] };
  if (raw === 'gyeonggi') return { ok: true, scope: 'gyeonggi', lawdCds: [...GYEONGGI_SALE_SYNC_LAWDCDS] };
  return { ok: false, error: 'invalid scope' };
}
