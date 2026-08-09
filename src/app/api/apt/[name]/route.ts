import { NextResponse } from 'next/server';
import { fetchMolitData } from '@/lib/api-molit';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const aptName = decodeURIComponent(name);
    const { searchParams } = new URL(request.url);
    const lawdCd = searchParams.get('lawdCd') || '11680';
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

    return NextResponse.json({ trades: filteredTrades, apiError });
  } catch (error) {
    console.error('Error fetching trade history:', error);
    return NextResponse.json({ error: 'Failed to fetch trade history' }, { status: 500 });
  }
}
