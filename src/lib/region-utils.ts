export const REGCODE_PROXY = 'https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes';

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
