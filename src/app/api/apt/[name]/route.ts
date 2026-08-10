import { NextResponse } from 'next/server';
import { fetchMolitData } from '@/lib/api-molit';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// 단지명만으로 lawdCd(법정동코드 5자리)를 알아낸다 — DB(apartments)에도 아직 없는(건축물대장
// 조회가 한 번도 성공한 적 없는) 단지가 대부분이라 DB 조회만으로는 커버가 안 된다. 카카오
// 키워드 검색으로 단지 좌표를 찾은 뒤, 그 좌표를 다시 행정구역 코드로 역지오코딩한다 —
// /map 페이지가 클라이언트에서 하는 것과 같은 2단계 조회를 서버에서 재현한 것.
// 서버 인스턴스가 살아있는 동안 재사용되는 캐시로 동일 단지 중복 조회를 방지한다.
const aptLawdCdCache = new Map<string, string | null>();

async function geocodeAptNameToLawdCd(aptName: string): Promise<string | null> {
  if (aptLawdCdCache.has(aptName)) return aptLawdCdCache.get(aptName)!;

  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  if (!kakaoKey || !aptName) {
    aptLawdCdCache.set(aptName, null);
    return null;
  }

  try {
    // 이 카카오 키는 JavaScript 키라 REST 호출 시 KA/Origin 헤더가 없으면 401을 반환한다
    // (Authorization만 보내서 실측으로 재현·확인함) — api/transactions/route.ts의
    // geocodeApt와 동일한 헤더 조합을 그대로 맞춘다.
    const headers = {
      Authorization: `KakaoAK ${kakaoKey}`,
      KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
      Origin: 'http://localhost:3000',
    };

    const keywordRes = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(aptName)}`,
      { headers }
    );
    if (!keywordRes.ok) {
      aptLawdCdCache.set(aptName, null);
      return null;
    }
    const keywordData = await keywordRes.json();
    const place = keywordData.documents?.[0];
    if (!place) {
      aptLawdCdCache.set(aptName, null);
      return null;
    }

    const regionRes = await fetch(
      `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${place.x}&y=${place.y}`,
      { headers }
    );
    if (!regionRes.ok) {
      aptLawdCdCache.set(aptName, null);
      return null;
    }
    const regionData = await regionRes.json();
    const bRegion = (regionData.documents || []).find((r: any) => r.region_type === 'B');
    const lawdCd = bRegion?.code ? String(bRegion.code).substring(0, 5) : null;

    aptLawdCdCache.set(aptName, lawdCd);
    return lawdCd;
  } catch (e) {
    console.warn('아파트명 -> lawdCd 지오코딩 실패', e);
    aptLawdCdCache.set(aptName, null);
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const aptName = decodeURIComponent(name);
    const { searchParams } = new URL(request.url);

    // 지도 마커 클릭, 커뮤니티 글 링크처럼 lawdCd를 안 넘기는 진입 경로가 실제로 있다 —
    // 이 경우 무조건 기본 지역(서울 강남구)으로 조회하면 다른 지역 단지는 실거래가 하나도
    // 안 잡혀 "조회 중..."에서 멈추고, 지역명도 강남구로 잘못 표시된다. URL에 lawdCd가
    // 없으면 (1) 이전에 이 단지명으로 조회되어 DB(apartments)에 저장된 실제 lawdCd가
    // 있는지 먼저 확인하고, (2) 그마저 없으면 단지명 자체를 지오코딩해서 실제 지역을
    // 알아낸다. 그 둘 다 실패했을 때만 기본 지역으로 폴백한다.
    let lawdCd = searchParams.get('lawdCd');
    if (!lawdCd) {
      try {
        const cached = await prisma.apartment.findFirst({ where: { name: aptName }, select: { lawdCd: true } });
        if (cached?.lawdCd) lawdCd = cached.lawdCd;
      } catch (e) {
        console.warn('lawdCd DB 조회 실패(DB 미설정 등)', e);
      }
    }
    if (!lawdCd) {
      lawdCd = await geocodeAptNameToLawdCd(aptName);
    }
    lawdCd = lawdCd || '11680';

    const type = searchParams.get('type') || 'apt';

    const periodParam = parseInt(searchParams.get('period') || '36', 10);
    const period = isNaN(periodParam) ? 36 : periodParam;

    // period 개월 치 데이터 생성
    const months = [];
    const now = new Date();
    for (let i = 0; i < period; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      months.push(`${y}${m}`);
    }

    // 공공데이터 API 병렬 호출 (청크 단위로 분할하여 Rate Limit 및 Timeout 방지)
    const chunkSize = 12; // 1년에 해당하는 12개월씩 끊어서 요청
    let allTrades: any[] = [];
    
    for (let i = 0; i < months.length; i += chunkSize) {
      const chunk = months.slice(i, i + chunkSize);
      const promises = chunk.map(dealYmd => fetchMolitData({ type: type as any, lawdCd, dealYmd }).catch(e => {
        console.warn(`Failed to fetch for ${dealYmd}:`, e.message);
        return []; // 에러 시 빈 배열 반환하여 전체 실패 방지
      }));
      
      const results = await Promise.all(promises);
      results.forEach(monthlyData => {
        if (Array.isArray(monthlyData)) {
          allTrades = allTrades.concat(monthlyData);
        }
      });
    }

    const normalizeName = (name: string) => {
      if (!name) return '';
      return name.replace(/\s+/g, '').replace(/아파트$/, '');
    };

    const searchAptName = normalizeName(aptName);

    const filteredTrades = allTrades
      .filter(item => {
        if (!item.name) return false;
        const itemName = normalizeName(item.name);
        return itemName.includes(searchAptName) || searchAptName.includes(itemName);
      })
      .map(item => {
        const priceStr = item.price;
        // dealAmount(만원 단위 정수)를 직접 사용한다. priceStr("1억"처럼 만 단위 나머지가 없는 문자열)을
        // 정규식으로 재파싱하던 이전 fallback은 자릿수를 잘못 이어붙여 1/10000로 계산되는 버그가 있었다.
        const priceNum = item.dealAmount ? item.dealAmount / 10000 : 0;

        const dateParts = item.info.split('•');
        const tradeDateStr = dateParts[dateParts.length - 1].trim();

        return {
          id: item.id,
          tradeDate: tradeDateStr,
          price: priceNum,
          priceStr: priceStr,
          area: dateParts[0]?.trim() || '',
          floor: parseInt(dateParts[1]?.trim() || '0'),
          tradeType: item.typeLabel,
          dong: item.dong || '',
          buildYear: item.buildYear || '',
          jibun: item.jibun || '',
          monthlyRent: item.monthlyRent || 0,
          registryDate: item.registryDate || '',
          dealCanceled: item.dealCanceled || false,
          cancelDate: item.cancelDate || '',
        };
      });

    // 날짜 최신순 정렬
    filteredTrades.sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());

    // 공공데이터 API 자체가 실패한 경우(키 누락/만료 등) 에러 플레이스홀더가 아파트명 필터에서
    // 걸러지면서 "거래 내역 없음"과 구분이 안 되므로, 매 월 전부 실패했는지 여부를 별도로 알려준다.
    const errorMonths = allTrades.filter(item => item.typeLabel === '에러').length;
    const apiError = months.length > 0 && errorMonths >= months.length
      ? (allTrades.find(item => item.typeLabel === '에러')?.name.replace(/^API 에러: /, '') || '공공데이터 API 호출에 실패했습니다.')
      : null;

    // 클라이언트가 URL에 lawdCd를 안 넘긴 경우, 여기서 실제로 조회에 사용한(DB 조회 또는
    // 기본값) lawdCd를 함께 돌려줘서 화면의 지역명/이후 요청들이 같은 값으로 맞춰지게 한다.
    return NextResponse.json({ trades: filteredTrades, apiError, lawdCd });
  } catch (error) {
    console.error('Error fetching trade history:', error);
    return NextResponse.json({ error: 'Failed to fetch trade history' }, { status: 500 });
  }
}
