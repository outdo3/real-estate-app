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
