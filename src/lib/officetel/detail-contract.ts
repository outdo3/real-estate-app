// OFFICETEL_V1 STEP 4A — 오피스텔 상세 READ 계약의 **순수 로직**(DB/네트워크 없음).
//
// 이 파일은 zero-import를 유지한다 — `node --experimental-strip-types --test`가 확장자 없는
// 상대 import를 해석하지 못하기 때문이다(identity.ts / rent-group-guard-logic.ts와 동일 제약).
//
// 여기 담긴 것은 "무엇을 노출해도 되는가"의 규칙이다. 아파트 상세의 의미론을 그대로
// 복사하지 않는다 — 오피스텔은 별도 상품이고 원천이 주는 것도 다르다:
//   - 규모는 **호수(hoCnt)**다. `세대수`라는 말을 쓰지 않는다(§3).
//   - 공급면적/평형은 어느 원천에도 없다 → **평 라벨을 만들지 않는다**(STEP 1 §11).
//   - 84㎡/59㎡ 같은 아파트 대표평형 관례를 적용하지 않는다(§6).
//   - RENT 원천에는 취소 개념 자체가 없다. SALE 취소는 2020년부터만 제공된다(§9).

/** 조회 상한 — 상세 한 화면이 전체 이력을 끌어오지 않게 한다(§12). */
export const OFFICETEL_TX_DEFAULT_LIMIT = 50;
/** PERFORMANCE_V2 §3 — 상세 화면 한 페이지 크기. 서버 SSR 프리로드와 클라이언트 더보기가
 *  **같은 값**을 써야 첫 페이지 캐시 키와 `hasMore` 계산이 어긋나지 않는다. */
export const OFFICETEL_TX_PAGE_SIZE = 20;
export const OFFICETEL_TX_MAX_LIMIT = 500;

/**
 * §9 CANCELLATION TRUST — 오피스텔 SALE 원천이 취소를 제공하기 시작한 첫 달.
 *
 * STEP 3A/3B 실측: 2006~2019 57,555행 중 취소 **0건**. 이는 "취소가 없었다"가 아니라
 * **원천이 취소 필드를 제공하지 않는다**는 뜻이다(아파트에서 `역대 최고가`를 영구
 * BLOCKED로 만든 것과 같은 성질의 절벽). 이 구분을 잃으면 안 된다.
 */
export const OFFICETEL_CANCELLATION_COVERAGE_FROM = '2020-01';

export type OfficetelTxType = 'sale' | 'rent';
export type OfficetelRentType = 'jeonse' | 'wolse';
/** 취소 여부를 원천이 실제로 알려주는 구간인가. */
export type CancellationCoverage = 'PROVIDED' | 'NOT_PROVIDED_BY_SOURCE';

/**
 * 전세/월세 판정. 오피스텔 RENT 테이블에는 dealType 컬럼이 없어 조회 시점에 파생한다.
 * STEP 3A 실측에서 보증금 0원이 **한 건도 없어**(226,291행) "0/0 의미불명" 케이스가
 * 존재하지 않는다 — 월세 단독으로 안전하게 가른다.
 */
export function classifyOfficetelRentType(monthlyRent: number): OfficetelRentType {
  return monthlyRent > 0 ? 'wolse' : 'jeonse';
}

/**
 * §9 — 이 거래일의 취소 정보를 원천이 제공하는 구간인가.
 * `dealCanceled === false`가 **검증된 참인지 아닌지**를 읽기 경로가 알 수 있게 한다.
 */
export function cancellationCoverageFor(dealDateIso: string): CancellationCoverage {
  return dealDateIso.slice(0, 7) >= OFFICETEL_CANCELLATION_COVERAGE_FROM ? 'PROVIDED' : 'NOT_PROVIDED_BY_SOURCE';
}

/**
 * §3 SCALE — 오피스텔 규모 라벨. 단위는 **호**이며 `세대`가 아니다.
 * 값이 없으면 지어내지 않고 null을 준다(호출부가 "정보 없음"으로 표시).
 */
export function officetelScaleLabel(hoCnt: number | null | undefined): string | null {
  return typeof hoCnt === 'number' && hoCnt > 0 ? `${hoCnt.toLocaleString()}호` : null;
}

/** 주차 대수 합계. 네 값이 전부 없으면 0이 아니라 null(=정보 없음)이다. */
export function officetelParkingTotal(p: {
  indoorMechanicalParking: number | null;
  indoorAutoParking: number | null;
  outdoorMechanicalParking: number | null;
  outdoorAutoParking: number | null;
}): number | null {
  const vals = [p.indoorMechanicalParking, p.indoorAutoParking, p.outdoorMechanicalParking, p.outdoorAutoParking];
  if (vals.every((v) => v == null)) return null;
  return vals.reduce<number>((a, v) => a + (v ?? 0), 0);
}

/** 빈 문자열 표시명을 null로 접는다 — master 390건(7.71%)이 실제로 비어 있다. */
export function officetelDisplayName(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  return s === '' ? null : s;
}

/**
 * STEP 4B §3 EMPTY-NAME POLICY — 표시명이 없는 master(실측 390건, 7.71%)의 **화면 표시용**
 * 라벨. `전포동 897-0 오피스텔` 형태로, 실제로 저장돼 있는 주소 성분만 조합한다.
 *
 * 건물 이름을 지어내는 것이 아니다 — 원천에 이름이 없다는 사실을 그대로 두고, 사용자가
 * 목록에서 항목을 구분할 수 있게 주소로 부른다. **DB에 절대 쓰지 않는다**(표시 전용).
 * identity는 언제나 그 아래의 master id / canonicalKey다.
 */
export function officetelFallbackDisplayName(m: {
  officetelName?: string | null;
  umdNm?: string | null;
  jibun?: string | null;
}): string {
  const real = officetelDisplayName(m.officetelName);
  if (real) return real;
  const parts = [(m.umdNm ?? '').trim(), (m.jibun ?? '').trim()].filter((s) => s !== '');
  return parts.length > 0 ? `${parts.join(' ')} 오피스텔` : '오피스텔';
}

/**
 * 사용승인일 표시 형식. 원천은 `YYYYMMDD` 문자열(예: `20051125`)로 저장돼 있다.
 * **표기만** 바꾼다 — 값을 해석하거나 보정하지 않으며, 형식이 다르면 원본을 그대로 보여준다
 * (모르는 형식을 억지로 날짜처럼 꾸미지 않는다).
 */
export function formatUseApprovalDate(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (s === '') return null;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : s;
}

export class OfficetelQueryError extends Error {}

export interface OfficetelTxQuery {
  type: OfficetelTxType;
  /** 정확한 전용면적(㎡) 문자열. 원본 정밀도를 잃지 않도록 문자열로 보관한다. */
  area: string | null;
  limit: number;
  offset: number;
  /** SALE 전용. 기본 false — 가격/추이 표시에서 취소 거래를 제외한다(§4). */
  includeCanceled: boolean;
  /**
   * RENT 전용 — 전세/월세 중 하나만 받는다. null이면 둘 다.
   *
   * 왜 필요한가(STEP 4B QA 실측): 화면이 한 페이지를 받아 클라이언트에서 갈라 쓰면,
   * 최근 20건이 전부 월세인 단지에서 **전세 탭이 "거래 없음"으로 보인다**(실제로는
   * 전세 거래가 있는데도). 나누는 일은 페이지네이션 이전, 즉 서버가 해야 한다.
   */
  rentType: OfficetelRentType | null;
}

/**
 * §11/§12 — 쿼리 파라미터 파싱과 상한 강제. 잘못된 입력은 조용히 보정하지 않고 거절한다
 * (조용한 보정은 "왜 다른 결과가 나왔는가"를 설명할 수 없게 만든다).
 */
export function parseOfficetelTxQuery(get: (k: string) => string | null): OfficetelTxQuery {
  const rawType = (get('type') ?? 'sale').toLowerCase();
  if (rawType !== 'sale' && rawType !== 'rent') {
    throw new OfficetelQueryError("type은 'sale' 또는 'rent'여야 합니다.");
  }

  const rawArea = (get('area') ?? '').trim();
  let area: string | null = null;
  if (rawArea !== '') {
    // 전용면적은 원천이 준 십진 문자열이다. 소수 4자리까지 실측(STEP 3A).
    if (!/^\d{1,5}(\.\d{1,6})?$/.test(rawArea)) throw new OfficetelQueryError('area는 양수 십진수여야 합니다.');
    if (Number(rawArea) <= 0) throw new OfficetelQueryError('area는 0보다 커야 합니다.');
    area = rawArea;
  }

  const rawLimit = (get('limit') ?? '').trim();
  let limit = OFFICETEL_TX_DEFAULT_LIMIT;
  if (rawLimit !== '') {
    if (!/^\d{1,4}$/.test(rawLimit)) throw new OfficetelQueryError('limit은 정수여야 합니다.');
    limit = Number(rawLimit);
    if (limit < 1) throw new OfficetelQueryError('limit은 1 이상이어야 합니다.');
    if (limit > OFFICETEL_TX_MAX_LIMIT) throw new OfficetelQueryError(`limit은 최대 ${OFFICETEL_TX_MAX_LIMIT}입니다.`);
  }

  const rawOffset = (get('offset') ?? '').trim();
  let offset = 0;
  if (rawOffset !== '') {
    if (!/^\d{1,7}$/.test(rawOffset)) throw new OfficetelQueryError('offset은 정수여야 합니다.');
    offset = Number(rawOffset);
  }

  const rawRent = (get('rentType') ?? '').trim().toLowerCase();
  let rentType: OfficetelRentType | null = null;
  if (rawRent !== '') {
    if (rawRent !== 'jeonse' && rawRent !== 'wolse') throw new OfficetelQueryError("rentType은 'jeonse' 또는 'wolse'여야 합니다.");
    if (rawType !== 'rent') throw new OfficetelQueryError('rentType은 type=rent 일 때만 사용할 수 있습니다.');
    rentType = rawRent;
  }

  return { type: rawType, area, limit, offset, includeCanceled: get('includeCanceled') === 'true', rentType };
}

/**
 * §2 IDENTITY — 경로 파라미터를 **정확한** identity로만 해석한다.
 * 숫자면 master id, `OFFI:`로 시작하면 canonicalKey. 그 외에는 해석하지 않는다 —
 * 이름/부분일치/같은 동 첫 결과 같은 느슨한 해석은 절대 만들지 않는다(AGENTS.md).
 */
export type OfficetelIdRef =
  | { kind: 'id'; id: number }
  | { kind: 'canonicalKey'; canonicalKey: string }
  | { kind: 'invalid' };

export function parseOfficetelIdRef(raw: string): OfficetelIdRef {
  const s = (raw ?? '').trim();
  if (/^\d{1,9}$/.test(s)) {
    const id = Number(s);
    return id > 0 ? { kind: 'id', id } : { kind: 'invalid' };
  }
  if (s.startsWith('OFFI:')) {
    // 키는 5개 세그먼트(OFFI:sgg:umd:bun-ji:dong)여야 한다. 부분 키를 넓게 매칭하지 않는다.
    const parts = s.split(':');
    if (parts.length === 5 && parts.every((p) => p !== '')) return { kind: 'canonicalKey', canonicalKey: s };
    return { kind: 'invalid' };
  }
  return { kind: 'invalid' };
}

/**
 * §8 TREND — 이 응답에 붙는 해석 제한. 클라이언트가 "왜 평균을 그대로 쓰면 안 되는지"를
 * 응답만 보고 알 수 있어야 한다. 문구를 UI가 지어내게 두지 않는다.
 */
export function officetelTradeLimitations(opts: {
  hasPreCoverageRows: boolean;
  identicalSiblingRows: number;
}): string[] {
  const out: string[] = [
    '원천 행을 1:1로 보존한다 — 동일 내용 형제 거래를 합치거나 제거하지 않는다.',
  ];
  if (opts.identicalSiblingRows > 0) {
    out.push(
      `모든 필드가 동일한 형제 거래 ${opts.identicalSiblingRows}건이 포함돼 있다. 원천이 이들을 구분할 정보를 주지 않아 "중복 신고"인지 "같은 조건의 별개 계약"인지 판별할 수 없다 — 평균/중앙값은 표본 수와 함께 해석해야 한다.`
    );
  }
  if (opts.hasPreCoverageRows) {
    out.push(
      `${OFFICETEL_CANCELLATION_COVERAGE_FROM} 이전 거래는 원천이 취소 여부를 제공하지 않는다. 그 구간의 "취소 아님"은 검증된 사실이 아니다.`
    );
  }
  return out;
}

/** 이 STEP에서 절대 계산/노출하지 않는 것 — 응답에 명시해 하위 소비처의 오용을 막는다. */
export const OFFICETEL_BLOCKED_FEATURES = [
  'RECORD_HIGH', // 2020 이전 취소 미제공 + rgstDate 부재로 검증 불가
  'SCORE',       // peer cohort 근거 없음. 아파트 Score 공식 전용 금지
  'FINANCE',     // 건축물대장이 세법상 주택 여부를 판정하지 않는다
  'MAP_DISTANCE',// master 좌표 0.00%
  'SUPPLY_AREA_OR_PYEONG', // 어느 원천에도 없음
] as const;
