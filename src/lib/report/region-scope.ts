// REPORT ENGINE REPORT-1 — 부산 현행 지역 스코프의 **단일 지점**.
//
// 왜 명시 allowlist인가(§4): Production 실측에서 apartment_trade_histories의 lawd_cd는
// 18종이었고 그중 둘은 부산이 아니다 —
//   27110 = 대구광역시 중구 (남산동/수창동/대봉동, '대구역센트럴자이')
//   11680 = 서울특별시 강남구 (역삼동/대치동/압구정동, '개포래미안포레스트')
// 전국 확장 파일럿으로 1회 적재된 행이며, 해당 지역 기준으로는 유효하므로 삭제하지
// 않는다. 다만 **부산 리포트의 분자·분모 어디에도 들어가면 안 된다**
// (docs/development/REPORT_ENGINE_PRECHECK_V1.md §1~§3).
//
// `LIKE '26%'`로 거르면 지금은 우연히 맞지만, 전국 확장이 진행되면 26으로 시작하는
// 다른 시도 코드가 들어올 때 조용히 깨진다. 그래서 **검증된 16개를 그대로 적는다.**
// 아래 이름은 Production `apartment_masters`의 sgg_cd/sigungu 실측값이다(추정 아님).

import { getMolitLeafRegions } from '../region/registry';

export interface BusanDistrict {
  lawdCd: string;
  name: string;
  /** 자치구인지 군인지. 표시 문구에서 '구/군'을 섞어 쓰지 않기 위함. */
  kind: 'GU' | 'GUN';
}

/**
 * 부산광역시 현행 자치구·군 16개. 순서는 lawdCd 오름차순(결정론적 출력 보장).
 *
 * REGION_REGISTRY_V1 §12 — 코드/이름을 여기서 다시 적지 않고 canonical registry에서
 * 파생한다. **스코프 의미는 그대로다**: 이 목록은 여전히 "부산 리포트가 다루는 지역"의
 * 명시 allowlist이고, 27110/11680 같은 코드는 registry에 있든 없든 여기에 들어오지
 * 않는다(`LIKE '26%'`로 바꾼 게 아니라, 시도 코드 '26'의 MOLIT leaf만 가져온다).
 * 값이 기존 리터럴과 한 글자도 다르지 않다는 것은 region-registry.test.ts가 고정한다.
 */
export const BUSAN_DISTRICTS: readonly BusanDistrict[] = getMolitLeafRegions('26').map((r) => ({
  lawdCd: r.lawdCd,
  name: r.name,
  kind: r.type === 'COUNTY' ? 'GUN' : 'GU',
}));

export const BUSAN_CURRENT_LAWD_CODES: readonly string[] = BUSAN_DISTRICTS.map((d) => d.lawdCd);

const BY_CODE = new Map(BUSAN_DISTRICTS.map((d) => [d.lawdCd, d]));

/** 부산 현행 16개 중 하나인가. 27110/11680은 반드시 false. */
export function isBusanCurrentLawdCd(lawdCd: string | null | undefined): boolean {
  return !!lawdCd && BY_CODE.has(lawdCd);
}

/** 표시명. 모르는 코드는 **추측하지 않고** null을 돌려준다. */
export function districtName(lawdCd: string | null | undefined): string | null {
  return (lawdCd && BY_CODE.get(lawdCd)?.name) ?? null;
}

export function districtOf(lawdCd: string): BusanDistrict | null {
  return BY_CODE.get(lawdCd) ?? null;
}

export type ScopeValidation =
  | { ok: true; lawdCds: string[] }
  | { ok: false; reason: string; rejected: string[] };

/**
 * 집계에 쓸 lawdCd 목록을 확정한다.
 * - null/빈 배열 → 부산 전체 16개
 * - 그 외 → 전부 현행 16개 안에 있어야 하며, 하나라도 벗어나면 **거부한다**
 *   (조용히 걸러내면 분모가 말없이 달라진다).
 */
export function resolveScopeLawdCds(requested?: readonly string[] | null): ScopeValidation {
  if (!requested || requested.length === 0) {
    return { ok: true, lawdCds: [...BUSAN_CURRENT_LAWD_CODES] };
  }
  const rejected = requested.filter((c) => !isBusanCurrentLawdCd(c));
  if (rejected.length > 0) {
    return {
      ok: false,
      reason: '부산 현행 16개 자치구·군이 아닌 코드가 포함됐습니다(스코프 밖 데이터 혼입 방지).',
      rejected,
    };
  }
  // 중복 제거 + 결정론적 정렬.
  return { ok: true, lawdCds: [...new Set(requested)].sort() };
}

/**
 * 동 이름 정규화 — **이미 canonical한 범위에서만** 한다(§4).
 * MOLIT 원본 dong 문자열은 앞뒤 공백만 신뢰 가능한 수준으로 정리한다.
 * 표기 변형(가/동 접미사, 한자, 별칭)을 임의로 통합하지 않는다 — 그건 매핑을
 * 발명하는 일이고, PRECHECK에서 dong이 aptSeq당 1개로 안정적임을 확인했으므로
 * 지금 필요하지도 않다.
 */
export function normalizeDong(dong: string | null | undefined): string | null {
  if (typeof dong !== 'string') return null;
  const t = dong.trim();
  return t.length > 0 ? t : null;
}
