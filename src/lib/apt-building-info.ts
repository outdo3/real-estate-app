export interface BuildingRegistryInfo {
  parkingCount: number | null;
  far: number | null; // 용적률(%)
  bcr: number | null; // 건폐율(%)
  totalHouseholds: number | null;
  mainPurpose: string | null;
  approvalDate: string | null; // 사용승인일, "YYYY년" 형태
}

// 건축물대장 "총괄표제부"(여러 동으로 이뤄진 아파트 단지 전체 집계) 공공데이터 조회.
// /api/apt/[name]/info 라우트와 scripts/backfill_apt_details.ts가 이 함수 하나를
// 공유한다 — 두 곳에 같은 로직을 따로 구현하면 나중에 한쪽만 고쳐서 결과가 어긋나는
// 문제가 생기기 쉽다.
//
// jibun(지번)이 반드시 있어야 한다: 실측 확인 결과 jibun 없이 법정동 전체를 조회하면
// 이 API는 페이지네이션도 제대로 안 먹히고(numOfRows를 무시하고 대표 1건만 반환) 그
// "대표 1건"조차 군사시설·관공서처럼 전혀 무관한 건물인 경우가 흔했다(그 건물이 마침
// 그 동에서 등록번호가 가장 앞선 것일 뿐). 이름으로 사후 필터링하는 방식도 애초에
// 후보군 자체가 잘못 좁혀져 있어 소용없었다. 그래서 jibun 없이는 아예 조회를 포기하고
// null을 반환한다 — 엉뚱한 건물의 주차대수/용적률을 그 단지 것처럼 잘못 보여주는 것보다
// "정보 없음"이 낫다.
export async function fetchBuildingRegistryInfo(
  aptName: string,
  lawdCd: string,
  dong: string,
  jibun?: string
): Promise<BuildingRegistryInfo | null> {
  const apiKey = process.env.DATA_GO_KR_API_KEY || '';
  if (!apiKey || !lawdCd || !dong || !jibun) return null;

  try {
    // 법정동 코드 조회 (법정동명 기준 10자리 코드). regcode_pattern 없이 호출하면 이
    // 프록시가 27000여건을 전부 빈 객체({})로 반환해(실측 확인) 아래 find()가 항상
    // 실패하고 결국 존재하지도 않는 하드코딩 fallback bjdongCd('10100')로 엉뚱한 동을
    // 조회하게 된다 — 이게 주차대수/용적률/건폐율이 거의 항상 "정보 없음"으로 나오던
    // 원인 중 하나였다. sigungu(lawdCd) 범위로 패턴을 좁혀서 실제 동 목록을 받아온다.
    const regRes = await fetch(
      `https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?regcode_pattern=${lawdCd}*&is_ignore_zero=true`,
      { signal: AbortSignal.timeout(2500) }
    );
    const regData = await regRes.json();
    let fullLawdCd: string | null = null;

    if (regData.regcodes) {
      const match = regData.regcodes.find((r: any) => (r.name || '').includes(dong) && r.code.startsWith(lawdCd));
      if (match) fullLawdCd = match.code;
    }
    if (!fullLawdCd) return null;

    const bjdongCd = fullLawdCd.substring(5, 10);
    const cleanKey = encodeURIComponent(decodeURIComponent(apiKey.trim().replace(/['"]/g, '')));

    const parts = jibun.split('-');
    const bunNum = parseInt(parts[0], 10);
    if (isNaN(bunNum)) return null;
    const jiNum = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    const bun = bunNum.toString().padStart(4, '0');
    const ji = jiNum.toString().padStart(4, '0');

    // 이 코드가 원래 쓰던 BldRgstService_v2/getBrTitleInfo는 폐기됐다
    // (NO_OPENAPI_SERVICE_ERROR 실측 확인). 후속 서비스인 BldRgstHubService로 교체하되,
    // getBrTitleInfo(표제부 — 동 1개 단위)가 아니라 getBrRecapTitleInfo(총괄표제부 — 단지
    // 전체 집계, 세대수·총주차대수 포함)를 쓴다. 이 응답은 XML이 아니라 기본 JSON이다
    // (실측 확인 — 기존 코드는 XMLParser로 파싱하고 있었는데 애초에 안 맞았다).
    const bldUrl = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo?serviceKey=${cleanKey}&sigunguCd=${lawdCd}&bjdongCd=${bjdongCd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=5&_type=json`;

    const bldRes = await fetch(bldUrl, { signal: AbortSignal.timeout(4000) });
    if (!bldRes.ok) return null;

    const json = await bldRes.json();
    const header = json?.response?.header;
    if (header?.resultCode && header.resultCode !== '00') {
      console.warn(`BldRgstHubService error: ${header.resultCode} ${header.resultMsg}`);
      return null;
    }
    const items = json?.response?.body?.items?.item;
    if (!items) return null;

    const itemsArr = Array.isArray(items) ? items : [items];
    // 같은 지번에 총괄표제부가 여러 건 잡히는 경우(드묾) 세대수가 가장 큰 것을 대표로 쓴다.
    const target = itemsArr.reduce((best: any, cur: any) =>
      (cur.hhldCnt || 0) > (best.hhldCnt || 0) ? cur : best
    );
    if (!target) return null;

    const parkingCnt = parseInt(target.totPkngCnt, 10);
    const vlRat = parseFloat(target.vlRat); // 이 오퍼레이션은 이미 퍼센트 값으로 내려온다(실측 확인).
    const bcRat = parseFloat(target.bcRat);
    const hhldCnt = parseInt(target.hhldCnt, 10);
    // useAprDay는 "YYYYMMDD" 8자리 문자열(예: "20040315"). 앞 4자리만 쓴다.
    const useAprDay: string = target.useAprDay || '';
    const approvalYear = /^\d{8}$/.test(useAprDay) ? useAprDay.slice(0, 4) : null;

    return {
      parkingCount: !isNaN(parkingCnt) && parkingCnt > 0 ? parkingCnt : null,
      far: !isNaN(vlRat) && vlRat > 0 ? vlRat : null,
      bcr: !isNaN(bcRat) && bcRat > 0 ? bcRat : null,
      totalHouseholds: !isNaN(hhldCnt) && hhldCnt > 0 ? hhldCnt : null,
      mainPurpose: (target.etcPurps || target.mainPurpsCdNm || '').trim() || null,
      approvalDate: approvalYear ? `${approvalYear}년` : null,
    };
  } catch (e) {
    console.warn('Public API building registry failed', e);
    return null;
  }
}

// 용적률/건폐율을 "245%"처럼 불필요한 소수점 없이 깔끔하게 표기한다(소수점이 있는 경우만 1자리).
export const formatRatio = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
};

// "세대당 1.25대 (총 1,200대)" 형태로 포맷. totalHouseholds가 없으면 총 대수만 보여준다.
export const formatParking = (parkingCount: number, totalHouseholds: number | null): string => {
  const totalStr = `총 ${parkingCount.toLocaleString('ko-KR')}대`;
  if (!totalHouseholds || totalHouseholds <= 0) return totalStr;
  const perHousehold = (parkingCount / totalHouseholds).toFixed(2);
  return `세대당 ${perHousehold}대 (${totalStr})`;
};
