// OFFICETEL_V1 STEP 1 §3/§4 — 오피스텔 canonical identity 계약.
//
// 왜 별도 계약이 필요한가: 아파트는 MOLIT 상세본(RTMSDataSvcAptTradeDev)이 `aptSeq`라는
// source-provided canonical id를 준다. **오피스텔에는 그런 식별자가 없다** — 상세본
// 서비스 자체가 존재하지 않는다(OFFICETEL V1 감사에서 `RTMSDataSvcOffiTradeDev` 호출 시
// NO_OPENAPI_SERVICE_ERROR 실측 확인). 원천이 주는 것은 주소(sggCd/umdNm/jibun)와
// 표시명(offiNm)뿐이다.
//
// 실측 근거(부산 16구 × 3개월, SALE 724행 / RENT 7,591행):
//   - (sggCd, umdNm, jibun) 한 지번에 이름이 2개 이상 : SALE 0.00% / RENT 0.06%
//   - 부산 전체 동명(同名) 건물 충돌                  : SALE 0.34% / RENT **4.47%**
// 즉 **주소는 강한 identity지만 이름은 아니다.** 이름 단독 매칭은 4.47% 확률로 다른
// 건물을 집는다(실제 사례: "드림빌리지"가 중구/서구/사하구 3개 지번에 존재).
//
// 그래서 identity는 **주소 기반 deterministic key**이고, `offiNm`은 표시/보조 검증
// 필드로만 쓴다. AGENTS.md의 "이름만으로 재식별 금지" 원칙을 오피스텔에도 그대로 적용한다.

/** §4 — canonicalKey의 접두사. 다른 유형(생숙 등)이 추가돼도 키 공간이 겹치지 않는다. */
export const OFFICETEL_KEY_PREFIX = 'OFFI';

/**
 * §4 — buildingDong이 없는 건물의 자리표시자.
 *
 * 빈 문자열을 쓰지 않는 이유: 세그먼트가 사라지면 `a:b::c`처럼 키 파싱이 모호해지고,
 * 정규화 결과가 빈 문자열인 dong과 "dong 없음"을 구분할 수 없다. `_`는 정규화가
 * 통과시키지 않는 문자라 실제 동 이름과 절대 충돌하지 않는다.
 */
export const NO_BUILDING_DONG = '_';

export type IdentityFailureReason =
  | 'MISSING_SGG_CD'
  | 'MISSING_UMD'
  | 'MISSING_JIBUN'
  | 'UNPARSEABLE_JIBUN';

export type CanonicalKeyResult =
  | { ok: true; key: string }
  | { ok: false; reason: IdentityFailureReason };

export interface OfficetelIdentityInput {
  sggCd: string | null | undefined;
  umdNm: string | null | undefined;
  jibun: string | null | undefined;
  /** 건축물대장 표제부 `dongNm` 또는 원천이 동을 명시한 경우에만 채운다. 추측 금지. */
  buildingDong?: string | null | undefined;
}

const s = (v: unknown): string => String(v ?? '').trim();

/**
 * 법정동명 정규화 — 공백만 제거한다.
 *
 * 접미사("동"/"읍"/"리")를 떼지 않는 이유: "좌동"에서 "동"을 떼면 "좌"가 되고,
 * "일광읍 삼성리"처럼 읍+리 복합 표기(실측 존재)가 깨진다. 원천이 같은 법정동에
 * 대해 항상 같은 문자열을 주므로(실측: 같은 지번 건축년도 불일치 0.00~0.06%)
 * 공백 제거만으로 충분하다.
 */
export function normalizeUmd(umdNm: string | null | undefined): string {
  return s(umdNm).replace(/\s+/g, '');
}

/**
 * 지번 정규화 — 본번/부번을 정수로 파싱해 `{본번}-{부번}`으로 되돌린다.
 *
 * 목적은 표기 흔들림 흡수다: "62-14" / "62 - 14" / "0062-0014"가 모두 `62-14`가 된다.
 * 부번이 없으면 `-0`을 붙여 `18` → `18-0`으로 만든다(세그먼트 수를 고정해 파싱 안정).
 * 건축물대장 조회가 쓰는 bun/ji 정수 표현과도 같은 값이라 연결이 자연스럽다.
 *
 * **"산" 지번은 파싱하지 않는다** — 건축물대장은 platGbCd로 대지(0)/산(1)을 구분하는데,
 * 그 구분을 키에 담지 않으면 다른 필지를 같은 건물로 볼 수 있다. 실측 표본에는
 * 없었지만 만들지 않은 규칙에 기대지 않는다 — 파싱 불가로 처리해 UNRESOLVED로 남긴다.
 */
export function normalizeJibun(jibun: string | null | undefined): string | null {
  const raw = s(jibun).replace(/\s+/g, '');
  if (!raw) return null;
  const m = /^(\d{1,6})(?:-(\d{1,6}))?$/.exec(raw);
  if (!m) return null;
  const bun = Number(m[1]);
  const ji = m[2] === undefined ? 0 : Number(m[2]);
  if (!Number.isFinite(bun) || !Number.isFinite(ji)) return null;
  return `${bun}-${ji}`;
}

/**
 * 건물 동(棟) 정규화.
 *
 * 실측 근거: 남구 대연동 62-14는 한 지번에 원천 표시명이 "가동"/"나동" 두 개로 나뉘어
 * 나오고, 건축물대장 표제부도 같은 지번에서 `dongNm="나동"`을 반환한다. 즉 **오피스텔은
 * 한 지번에 복수 동이 실제로 존재하며, 절대 한 건물로 합치면 안 된다**(§4).
 *
 * 값이 없으면 `NO_BUILDING_DONG`을 돌려 building-level 키가 되게 한다.
 */
export function normalizeBuildingDong(dong: string | null | undefined): string {
  const v = s(dong).replace(/\s+/g, '');
  return v === '' ? NO_BUILDING_DONG : v;
}

/**
 * §4 CANONICAL KEY.
 *
 * format: `OFFI:{sggCd}:{normalizedUmd}:{bun}-{ji}:{normalizedDong|_}`
 * 예)     `OFFI:26350:좌동:1458-5:_`
 *         `OFFI:26290:대연동:62-14:나동`
 *
 * 성질:
 *   - deterministic  — 같은 입력이면 항상 같은 문자열
 *   - stable         — offiNm(표시명)이 바뀌어도 키가 변하지 않는다
 *   - 재생성 가능    — DB row id와 무관하게 원천 행에서 다시 계산할 수 있다
 *   - 이름 비의존    — 이름은 키에 **들어가지 않는다**(§3 name-only 금지)
 *
 * 필수 성분이 하나라도 없거나 지번을 파싱할 수 없으면 **키를 만들지 않는다**.
 * "잘못된 master 연결보다 unresolved가 낫다"(§17)는 원칙을 여기서 강제한다.
 */
export function buildOfficetelCanonicalKey(input: OfficetelIdentityInput): CanonicalKeyResult {
  const sggCd = s(input.sggCd);
  if (!sggCd) return { ok: false, reason: 'MISSING_SGG_CD' };

  const umd = normalizeUmd(input.umdNm);
  if (!umd) return { ok: false, reason: 'MISSING_UMD' };

  if (!s(input.jibun)) return { ok: false, reason: 'MISSING_JIBUN' };
  const jibun = normalizeJibun(input.jibun);
  if (!jibun) return { ok: false, reason: 'UNPARSEABLE_JIBUN' };

  const dong = normalizeBuildingDong(input.buildingDong);
  return { ok: true, key: `${OFFICETEL_KEY_PREFIX}:${sggCd}:${umd}:${jibun}:${dong}` };
}

/**
 * 표시명 정규화 — **검색 보조 전용이며 identity가 아니다**(§6).
 *
 * 공백 제거 + 후행 "오피스텔" 제거로 "쥬노벨 오피스텔" / "쥬노벨오피스텔"을 같은
 * 검색어로 묶는다. 이 값이 같다고 해서 같은 건물이라고 판정하면 안 된다 —
 * 부산 전체 동명 충돌이 4.47%다.
 */
export function normalizeOfficetelName(name: string | null | undefined): string {
  return s(name).replace(/\s+/g, '').replace(/오피스텔$/, '');
}
