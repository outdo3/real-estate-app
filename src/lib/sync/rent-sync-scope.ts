// SEOUL_RENT_SYNC_PREP_V2 — 전월세 수집(rent-sync)의 구 목록 및 서울 25개 구 확장 스코프 정의.
//
// 매매(sale-sync-scope.ts)와 전월세(rent-sync-scope.ts)의 수집 범위를 완전히 분리한다.
// 전월세는 MOLIT 응답 구조(취소 거래 필드 없음, 동일 조건 다중 세대 occurrenceIndex 부여 필요)와
// 테이블(ApartmentRentHistory)이 매매와 완전히 다르므로, 수집 스코프와 백필 진행 상태를
// 독립적으로 관리해야 한다.
//
// 허용 목록만 받는다 — URL로 임의의 lawdCd를 넘길 수 없다.
//   scope 없음     → undefined(= 코어의 기본값 BUSAN_LAWDCD_16, 기존 동작 그대로)
//   scope=seoul-a  → 서울 1차 배치 8구(종로, 중구, 용산, 광진, 동대문, 서대문, 마포, 금천)
//   scope=seoul-b  → 서울 2차 배치 9구(성동, 중랑, 성북, 강북, 도봉, 노원, 은평, 양천, 강서)
//   scope=seoul-c  → 서울 3차 배치 8구(구로, 영등포, 동작, 관악, 서초, 강남, 송파, 강동)
//   scope=seoul    → seoul-a와 동일
//   그 밖          → 거부(400 invalid scope)

import { BUSAN_LAWDCD_16 } from '../rent-verified-range';

/** 서울 전월세 수집 1차 배치 8구. */
export const SEOUL_RENT_SYNC_LAWDCDS_A = [
  '11110', // 종로구
  '11140', // 중구
  '11170', // 용산구
  '11215', // 광진구
  '11230', // 동대문구
  '11410', // 서대문구
  '11440', // 마포구
  '11545', // 금천구
] as const;

/** 서울 전월세 수집 2차 배치 9구. */
export const SEOUL_RENT_SYNC_LAWDCDS_B = [
  '11200', // 성동구
  '11260', // 중랑구
  '11290', // 성북구
  '11305', // 강북구
  '11320', // 도봉구
  '11350', // 노원구
  '11380', // 은평구
  '11470', // 양천구
  '11500', // 강서구
] as const;

/** 서울 전월세 수집 3차 배치 8구. */
export const SEOUL_RENT_SYNC_LAWDCDS_C = [
  '11530', // 구로구
  '11560', // 영등포구
  '11590', // 동작구
  '11620', // 관악구
  '11650', // 서초구
  '11680', // 강남구
  '11710', // 송파구
  '11740', // 강동구
] as const;

/** 서울 25개 구 전체 목록. */
export const SEOUL_RENT_ALL_25_LAWDCDS = [
  ...SEOUL_RENT_SYNC_LAWDCDS_A,
  ...SEOUL_RENT_SYNC_LAWDCDS_B,
  ...SEOUL_RENT_SYNC_LAWDCDS_C,
] as const;

export type RentSyncScope = 'busan' | 'seoul' | 'seoul-a' | 'seoul-b' | 'seoul-c' | 'seoul-all';

export type ResolvedRentSyncScope =
  | { ok: true; scope: RentSyncScope; lawdCds: string[] | undefined }
  | { ok: false; error: string };

/**
 * 전월세 sync/backfill 요청 scope를 해석한다(순수 함수).
 * 실제 수집 실행은 사후 승인 뒤에만 가능하며, 기본값은 부산 16구 그대로다.
 */
export function resolveRentSyncScope(raw: string | null): ResolvedRentSyncScope {
  if (raw === null) return { ok: true, scope: 'busan', lawdCds: undefined };
  if (raw === 'seoul' || raw === 'seoul-a') return { ok: true, scope: raw, lawdCds: [...SEOUL_RENT_SYNC_LAWDCDS_A] };
  if (raw === 'seoul-b') return { ok: true, scope: 'seoul-b', lawdCds: [...SEOUL_RENT_SYNC_LAWDCDS_B] };
  if (raw === 'seoul-c') return { ok: true, scope: 'seoul-c', lawdCds: [...SEOUL_RENT_SYNC_LAWDCDS_C] };
  if (raw === 'seoul-all') return { ok: true, scope: 'seoul-all', lawdCds: [...SEOUL_RENT_ALL_25_LAWDCDS] };
  return { ok: false, error: 'invalid rent sync scope' };
}
