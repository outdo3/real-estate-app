export const REGCODE_PROXY = 'https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes';

// STATISTICS REGION FILTER V2 — "시도 전체"(예: 부산광역시 전체) 조회를 지원하려면
// 시도 이름 -> 2자리 sidoCode, 그리고 그 sidoCode에 속한 전체 시군구(5자리 lawdCd)
// 목록이 필요하다. 부산 16개 구/서울 25개 구를 하드코딩하지 않고, 기존
// resolveLawdCdByNames와 동일한 전국 법정동코드 프록시를 그대로 재사용해 항상
// 최신·전국 대상으로 동적 조회한다(신규 데이터 없음, 신규 API 없음).
const sidoCodeCache = new Map<string, string | null>();
const sigunguListCache = new Map<string, { code: string; name: string }[]>();
let sidoListCache: { code: string; name: string }[] | null = null;

// REGION_PRICE_CHANGE_MAP_V2 §11 — "대한민국 전체" 첫 화면(시도 17개 타일)에
// 필요한 전국 시도 목록. RegionSelectModal.selectSido가 이미 쓰는 것과 동일한
// 프록시/패턴이라 항상 최신·전국 대상이다(새 데이터 소스 없음).
// TRADE_DB_FIRST_V1 STEP F-2 — 세종특별자치시는 대한민국에서 유일하게 구/군 하위
// 행정구역이 없는 특별자치시다(강원/제주 "특별자치도"는 일반 도처럼 시군구가 있음).
// 그래서 법정동코드 최상위 항목 자체가 다른 시도처럼 "XX00000000"(뒤 8자리 전부
// 0) 패턴이 아니라 "3611000000"(사실상 시군구 레벨과 동일한 코드 구조)이다(실측
// 확인: REGCODE_PROXY 원본 데이터 자체의 구조적 특이사항, 프록시 버그 아님 —
// `regcode_pattern=36*`로 직접 조회하면 세종의 최상위 항목이 3611000000 하나뿐임을
// 확인할 수 있다). 아래 `*00000000` 패턴은 이 구조 때문에 세종을 영영 찾지 못한다.
// `getSigunguListForSido('36')`는 이미 이 구조 덕분에 수정 없이 정상 동작한다
// (`36*00000` 패턴이 "3611000000"과 자연히 일치하므로) — sido 목록에만 명시적으로
// 보강한다. 이 지역 코드가 실제로 MOLIT lawdCd로 유효함은 "36110"이 공개적으로
// 알려진 세종 lawdCd라는 사실과 위 실측이 일치함으로 확인했다.
const SEJONG_SIDO_CODE = '36';
const SEJONG_SIDO_NAME = '세종특별자치시';

export async function getSidoList(): Promise<{ code: string; name: string }[]> {
  if (sidoListCache) return sidoListCache;
  try {
    const res = await fetch(`${REGCODE_PROXY}?regcode_pattern=*00000000`);
    const data = await res.json();
    const list = ((data.regcodes || []) as { code: string; name: string }[]).map((r) => ({ code: r.code.substring(0, 2), name: r.name }));
    if (!list.some((s) => s.code === SEJONG_SIDO_CODE)) list.push({ code: SEJONG_SIDO_CODE, name: SEJONG_SIDO_NAME });
    sidoListCache = list;
    return list;
  } catch (e) {
    console.error('[region-utils] 시도 목록 조회 실패', e);
    return [];
  }
}

export async function resolveSidoCode(sido: string): Promise<string | null> {
  if (sidoCodeCache.has(sido)) return sidoCodeCache.get(sido)!;
  try {
    const res = await fetch(`${REGCODE_PROXY}?regcode_pattern=*00000000`);
    const data = await res.json();
    const entry = ((data.regcodes || []) as { code: string; name: string }[]).find((r) => r.name === sido);
    const sidoCode = entry ? entry.code.substring(0, 2) : null;
    sidoCodeCache.set(sido, sidoCode);
    return sidoCode;
  } catch (e) {
    console.error('[region-utils] sido -> sidoCode 조회 실패', e);
    return null;
  }
}

// sidoCode에 속한 전체 시군구(5자리 lawdCd + 전체 표기 이름, 예: "부산광역시 서구")
// 목록을 반환한다. RegionSelectModal.selectSido와 동일한 조회 방식이라 그 흐름과
// 항상 같은 목록을 보게 된다(중복 조회 로직 없음).
export async function getSigunguListForSido(sidoCode: string): Promise<{ code: string; name: string }[]> {
  if (sigunguListCache.has(sidoCode)) return sigunguListCache.get(sidoCode)!;
  try {
    const res = await fetch(`${REGCODE_PROXY}?regcode_pattern=${sidoCode}*00000&is_ignore_zero=true`);
    const data = await res.json();
    const list = ((data.regcodes || []) as { code: string; name: string }[]).filter((item) => item.code.substring(0, 5) !== `${sidoCode}000`);
    sigunguListCache.set(sidoCode, list);
    return list;
  } catch (e) {
    console.error('[region-utils] sidoCode -> 시군구 목록 조회 실패', e);
    return [];
  }
}

// lawdCd(5자리 법정동코드)로 시/도·시/군/구 이름을 조회한다. REGION_DATA 및
// 앱 전역에서 쓰는 것과 동일한 표기(예: "부산광역시 서구")를 보장하기 위해
// 카카오 역지오코딩의 축약된 지역명(예: "부산") 대신 이 프록시를 신뢰한다.
export async function resolveRegionNameByLawdCd(
  lawdCd: string
): Promise<{ sido: string; sigungu: string; fullName: string } | null> {
  try {
    const res = await fetch(`${REGCODE_PROXY}?regcode_pattern=${lawdCd}00000`);
    const data = await res.json();
    const entry = (data.regcodes || [])[0];
    if (!entry?.name) return null;
    const [sido, ...rest] = entry.name.split(' ');
    return { sido, sigungu: rest.join(' '), fullName: entry.name };
  } catch (e) {
    console.error('[region-utils] lawdCd -> 지역명 조회 실패', e);
    return null;
  }
}

type RegcodeEntry = { code: string; name: string };

// URL 쿼리파라미터로 받은 "시/도 전체이름"+"시/군/구 이름"을 RegionContext가 요구하는
// lawdCd(5자리)로 변환한다. RegionSelectModal의 selectSido/selectSigungu와 동일하게
// REGCODE_PROXY를 시도 목록 → 해당 시도의 시군구 목록 순서로 조회해 이름을 매칭한다.
export async function resolveLawdCdByNames(
  sido: string,
  sigungu: string
): Promise<string | null> {
  try {
    const sidoRes = await fetch(`${REGCODE_PROXY}?regcode_pattern=*00000000`);
    const sidoData = await sidoRes.json();
    const sidoEntry = ((sidoData.regcodes || []) as RegcodeEntry[]).find((r) => r.name === sido);
    if (!sidoEntry) return null;

    const sidoCode = sidoEntry.code.substring(0, 2);
    const sigunguRes = await fetch(
      `${REGCODE_PROXY}?regcode_pattern=${sidoCode}*00000&is_ignore_zero=true`
    );
    const sigunguData = await sigunguRes.json();
    const sigunguEntry = ((sigunguData.regcodes || []) as RegcodeEntry[]).find(
      (r) => r.name === `${sido} ${sigungu}`
    );
    return sigunguEntry ? sigunguEntry.code.substring(0, 5) : null;
  } catch (e) {
    console.error('[region-utils] 지역명 -> lawdCd 조회 실패', e);
    return null;
  }
}
