import { NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';

export const dynamic = 'force-dynamic';

const API_KEY = process.env.DATA_GO_KR_API_KEY || '';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const aptName = decodeURIComponent(name);
    
    const { searchParams } = new URL(request.url);
    const lawdCd = searchParams.get('lawdCd') || '11680';
    const dong = searchParams.get('dong') || '';
    
    const info: Record<string, string> = {};

    // 1. 네이버 스크래핑 (기본 세대수, 준공연도 등) - 헤더 보강하여 차단 방지
    try {
      const query = encodeURIComponent(`${aptName} 아파트 정보`);
      const searchUrl = `https://search.naver.com/search.naver?query=${query}`;
      
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        signal: AbortSignal.timeout(2500) // 2.5초 타임아웃 추가
      });
      
      if (response.ok) {
        const html = await response.text();
        const householdMatch = html.match(/(?:총\s*)?([0-9,]+)세대/);
        if (householdMatch) info['세대수'] = `${householdMatch[1]}세대`;
        
        const yearMatch = html.match(/([0-9]{4})년\s*(?:준공|입주)/);
        if (yearMatch) info['사용승인일'] = `${yearMatch[1]}년`;
        
        const parkingMatch = html.match(/(?:주차대수|총주차대수)\s*([0-9,]+대)/);
        if (parkingMatch) info['총주차대수'] = parkingMatch[1];
      }
    } catch (e) {
      console.warn('Naver scraping failed', e);
    }

    // 2. K-APT(건축물대장 표제부) 공공데이터 호출 — 주차대수(세대당 포함), 용적률, 건폐율, 주용도를 가져온다.
    // 이전에는 네이버 스크래핑이 총주차대수를 먼저 채우면 이 블록 전체가 스킵되어 세대당
    // 계산이 누락되는 버그가 있었다. 네이버 결과 존재 여부와 무관하게 항상 조회하고, 성공하면
    // 더 상세한 이 결과로 덮어쓴다. Vercel 배포 환경에서는 공공데이터 API 키 문제로 막힐 수
    // 있으므로 안전하게 감싼다.
    if (API_KEY && lawdCd && dong) {
      try {
        // 법정동 코드 조회 (법정동명 기준 10자리 코드)
        const regRes = await fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?is_ignore_zero=true`);
        const regData = await regRes.json();
        let fullLawdCd = lawdCd + '10100'; // fallback

        if (regData.regcodes) {
          const match = regData.regcodes.find((r: any) => (r.name || '').includes(dong) && r.code.startsWith(lawdCd));
          if (match) fullLawdCd = match.code;
        }

        const bjdongCd = fullLawdCd.substring(5, 10);
        const cleanKey = encodeURIComponent(decodeURIComponent(API_KEY.trim().replace(/['"]/g, '')));

        let bldUrl = `http://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo?serviceKey=${cleanKey}&sigunguCd=${lawdCd}&bjdongCd=${bjdongCd}&numOfRows=100`;

        // 지번 파싱
        const jibun = searchParams.get('jibun') || '';
        if (jibun) {
          const parts = jibun.split('-');
          const bunNum = parseInt(parts[0], 10);
          const jiNum = parts.length > 1 ? parseInt(parts[1], 10) : 0;
          if (!isNaN(bunNum)) {
            const bun = bunNum.toString().padStart(4, '0');
            const ji = jiNum.toString().padStart(4, '0');
            bldUrl += `&platGbCd=0&bun=${bun}&ji=${ji}`;
          }
        }

        const bldRes = await fetch(bldUrl, { signal: AbortSignal.timeout(3000) });
        if (bldRes.ok) {
          const xmlData = await bldRes.text();
          const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
          const jsonObj = parser.parse(xmlData);
          const items = jsonObj.response?.body?.items?.item;
          if (items) {
            const itemsArr = Array.isArray(items) ? items : [items];
            // 단지명과 가장 유사한 항목 찾기
            const aptCleanName = aptName.replace(/\s+/g, '').replace(/아파트$/, '');
            const target = itemsArr.find((it: any) => {
              const bldNm = (it.bldNm || '').replace(/\s+/g, '');
              return bldNm.includes(aptCleanName) || aptCleanName.includes(bldNm);
            }) || itemsArr[0]; // 못찾으면 첫번째거라도 (대표 번지)

            if (target) {
              const parkingCnt = parseInt(target.totPkngCnt, 10);
              if (!isNaN(parkingCnt) && parkingCnt > 0) {
                info['총주차대수'] = `${target.totPkngCnt}대`;
                // 세대당 주차대수 계산
                if (info['세대수']) {
                  const totalH = parseInt(info['세대수'].replace(/,/g, ''), 10);
                  if (totalH > 0) {
                    const perH = (parseInt(target.totPkngCnt, 10) / totalH).toFixed(2);
                    info['총주차대수'] = `${target.totPkngCnt}대 (세대당 ${perH}대)`;
                  }
                }
              }

              const vlRat = parseFloat(target.vlRat);
              if (!isNaN(vlRat) && vlRat > 0) info['용적률'] = `${vlRat}%`;

              const bcRat = parseFloat(target.bcRat);
              if (!isNaN(bcRat) && bcRat > 0) info['건폐율'] = `${bcRat}%`;

              if (target.mainPurpsCdNm) info['주용도'] = target.mainPurpsCdNm;
            }
          }
        }
      } catch (e) {
        console.warn('Public API building registry failed', e);
      }
    }

    // 추정치 제공 금지 (정확한 데이터만 사용)
    // if (!info['총주차대수']) { ... }

    return NextResponse.json({ 
      success: true, 
      aptName,
      info: Object.keys(info).length > 0 ? info : null 
    });
    
  } catch (error) {
    console.error('Info route error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch info' }, { status: 500 });
  }
}
