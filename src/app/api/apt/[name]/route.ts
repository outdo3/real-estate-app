import { NextResponse } from 'next/server';
import { fetchMolitData } from '@/lib/api-molit';

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

    // 12개월(1년) 치 데이터 생성
    const months = [];
    const now = new Date(2026, 7, 5); // 기준일(8월)
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      months.push(`${y}${m}`);
    }

    // 공공데이터 API 병렬 호출 (속도 6배 개선)
    const promises = months.map(dealYmd => fetchMolitData({ type: type as any, lawdCd, dealYmd }));
    const results = await Promise.all(promises);

    // 모든 데이터를 하나로 합치고 대상 아파트만 필터링
    let allTrades: any[] = [];
    results.forEach(monthlyData => {
      if (Array.isArray(monthlyData)) {
        allTrades = allTrades.concat(monthlyData);
      }
    });

    const searchAptName = aptName.replace(/\s+/g, '');

    const filteredTrades = allTrades
      .filter(item => item.name && item.name.replace(/\s+/g, '').includes(searchAptName))
      .map(item => {
        // "45,000만" 에서 숫자만 추출하여 차트용 price 생성
        const priceStr = item.price;
        const match = priceStr.match(/\d+/g);
        let priceNum = 0;
        if (match) {
          // 예를 들어 '45000' 만원이면 '4.5억' 인데, 억 단위 정수로 할지... 
          // Recharts에서는 억 단위로 보여주므로 45000 / 10000 = 4.5
          const rawNum = parseInt(match.join(''), 10);
          priceNum = rawNum / 10000; 
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
