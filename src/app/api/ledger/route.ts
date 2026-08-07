import { NextResponse } from 'next/server';

const API_KEY = process.env.DATA_GO_KR_API_KEY;
const API_BASE = 'http://apis.data.go.kr/1613000/BldRgstHubService';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'title';
  const lawdCd = searchParams.get('lawdCd');
  const dongName = searchParams.get('dongName');
  const jibun = searchParams.get('jibun');
  const aptName = searchParams.get('aptName') || '';
  const dong = searchParams.get('dong') || '';
  const ho = searchParams.get('ho') || '';

  if (!lawdCd || !API_KEY) {
    return NextResponse.json({ error: 'Missing required parameters or API key' }, { status: 400 });
  }

  let bun = '';
  let ji = '';
  if (jibun) {
    const parts = jibun.split('-');
    bun = parts[0].padStart(4, '0');
    if (parts.length > 1) {
      ji = parts[1].padStart(4, '0');
    } else {
      ji = '0000';
    }
  }

  try {
    let bjdongCd = '10600';
    if (dongName) {
      const regRes = await fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?regcode_pattern=${lawdCd}*&is_ignore_zero=true`);
      if (regRes.ok) {
        const regData = await regRes.json();
        const matched = regData.regcodes?.find((r: any) => r.name.includes(dongName));
        if (matched) bjdongCd = matched.code.substring(5, 10);
      }
    }

    const endpoint = type === 'title' ? 'getBrTitleInfo' : 'getBrExposInfo';
    let apiUrl = `${API_BASE}/${endpoint}?serviceKey=${API_KEY}&sigunguCd=${lawdCd}&bjdongCd=${bjdongCd}&numOfRows=1000&pageNo=1&_type=json`;
    if (bun) apiUrl += `&bun=${bun}&ji=${ji}`;
    
    const res = await fetch(apiUrl);
    const result = await res.json();
    
    // API 에러 체크
    if (result?.response?.header?.resultCode !== '00' && result?.header?.resultCode !== '00') {
      return NextResponse.json({ error: 'API_ERROR', message: result?.header?.resultMsg || '건축HUB API 연동 오류입니다.' }, { status: 500 });
    }

    const body = result.response?.body || result.body;
    let items = body?.items?.item;
    
    if (!items) {
      return NextResponse.json({ error: 'NO_DATA', message: '데이터가 없습니다.' }, { status: 404 });
    }

    let itemArray = Array.isArray(items) ? items : [items];
    
    let matchedItem = itemArray[0];
    if (aptName) {
      const candidates = itemArray.filter(i => (i.bldNm || '').includes(aptName) || (i.platPlc || '').includes(aptName));
      if (candidates.length > 0) itemArray = candidates;
    }
    
    if (type === 'title' && dong) {
      const dongMatch = itemArray.find(i => (i.dongNm || '').includes(dong) || (i.bldNm || '').includes(dong));
      if (dongMatch) matchedItem = dongMatch;
      else matchedItem = itemArray[0];
    } else if (type === 'expos' && dong && ho) {
      const hoMatch = itemArray.find(i => ((i.dongNm || '').includes(dong) || (i.bldNm || '').includes(dong)) && (i.hoNm || '').includes(ho));
      if (hoMatch) matchedItem = hoMatch;
      else matchedItem = itemArray[0];
      
      // 전유부는 건물 전체 정보(날짜, 구조 등)가 없으므로 표제부 API를 한 번 더 호출해서 병합합니다.
      try {
        let titleUrl = `${API_BASE}/getBrTitleInfo?serviceKey=${API_KEY}&sigunguCd=${lawdCd}&bjdongCd=${bjdongCd}&numOfRows=1000&pageNo=1&_type=json`;
        if (bun) titleUrl += `&bun=${bun}&ji=${ji}`;
        const titleRes = await fetch(titleUrl);
        const titleResult = await titleRes.json();
        const titleBody = titleResult.response?.body || titleResult.body;
        const titleItems = titleBody?.items?.item;
        if (titleItems) {
          let tArray = Array.isArray(titleItems) ? titleItems : [titleItems];
          let tMatch = tArray[0];
          if (aptName) {
            const tCands = tArray.filter(i => (i.bldNm || '').includes(aptName) || (i.platPlc || '').includes(aptName));
            if (tCands.length > 0) tArray = tCands;
          }
          const tDongMatch = tArray.find(i => (i.dongNm || '').includes(dong) || (i.bldNm || '').includes(dong));
          if (tDongMatch) tMatch = tDongMatch;
          
          // 병합
          matchedItem.strctCdNm = tMatch.strctCdNm;
          matchedItem.mainPurpsCdNm = tMatch.mainPurpsCdNm;
          matchedItem.pmsDay = tMatch.pmsDay;
          matchedItem.useAprDay = tMatch.useAprDay;
        }
      } catch(e) {
        console.error('Title fetch failed during expos request', e);
      }
    } else {
      matchedItem = itemArray[0];
    }
    
    // 필드명 매핑 보정 (HUB 버전의 필드명이 미세하게 다를 수 있음)
    if (matchedItem.pmsDay) matchedItem.prmsDay = matchedItem.pmsDay;
    if (matchedItem.prmsDay === ' ') matchedItem.prmsDay = '';
    if (matchedItem.useAprDay === ' ') matchedItem.useAprDay = '';
    
    // 포맷팅 헬퍼 (날짜 형식 YYYY-MM-DD 등)
    if (matchedItem.prmsDay && matchedItem.prmsDay.length === 8) matchedItem.prmsDay = `${matchedItem.prmsDay.substring(0,4)}-${matchedItem.prmsDay.substring(4,6)}-${matchedItem.prmsDay.substring(6,8)}`;
    if (matchedItem.useAprDay && matchedItem.useAprDay.length === 8) matchedItem.useAprDay = `${matchedItem.useAprDay.substring(0,4)}-${matchedItem.useAprDay.substring(4,6)}-${matchedItem.useAprDay.substring(6,8)}`;
    if (matchedItem.crtnDay && matchedItem.crtnDay.length === 8) matchedItem.crtnDay = `${matchedItem.crtnDay.substring(0,4)}-${matchedItem.crtnDay.substring(4,6)}-${matchedItem.crtnDay.substring(6,8)}`;

    return NextResponse.json({ data: matchedItem });
  } catch (error: any) {
    console.error('Ledger API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
