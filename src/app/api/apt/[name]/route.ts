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
        let priceNum = item.dealAmount ? item.dealAmount / 10000 : 0;
        
        // Fallback if dealAmount is missing for some reason
        if (priceNum === 0 && priceStr) {
          const targetStrForChart = type === 'rent' ? priceStr.split('/')[0] : priceStr;
          const match = targetStrForChart.match(/\d+/g);
          if (match) {
            const rawNum = parseInt(match.join(''), 10);
            priceNum = rawNum / 10000; 
          }
        }

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
          jibun: item.jibun || ''
        };
      });

    // 날짜 최신순 정렬
    filteredTrades.sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());

    return NextResponse.json({ trades: filteredTrades });
  } catch (error) {
    console.error('Error fetching trade history:', error);
    return NextResponse.json({ error: 'Failed to fetch trade history' }, { status: 500 });
  }
}
