import { NextResponse } from 'next/server';
import { fetchMolitData } from '@/lib/api-molit';

const LAWD_CD_MAP: Record<string, string> = {
  '서울특별시 강남구': '11680',
  '부산광역시 서구': '26140',
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';
  const region = `${sido} ${gungu}`;

  let lawdCd = LAWD_CD_MAP[region] || '26140';

  const now = new Date();
  const getDealYmd = (date: Date) => {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    return `${y}${m.toString().padStart(2, '0')}`;
  };

  const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  
  const currentYmd = getDealYmd(currentMonthDate);
  const prevYmd = getDealYmd(prevMonthDate);

  try {
    const [currentData, prevData] = await Promise.all([
      fetchMolitData({ type: 'apt', lawdCd, dealYmd: currentYmd }).catch(() => []),
      fetchMolitData({ type: 'apt', lawdCd, dealYmd: prevYmd }).catch(() => [])
    ]);

    const volume = currentData.length;
    const prevVolume = prevData.length;
    const volumeChange = volume - prevVolume;
    
    const dongCount: Record<string, number> = {};
    currentData.forEach(item => {
      const d = item.dong || '기타';
      dongCount[d] = (dongCount[d] || 0) + 1;
    });
    
    const sortedDongs = Object.entries(dongCount)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], index) => ({ rank: index + 1, name, count }));

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          volume,
          volumeChange,
          supply: '데이터 없음',
          supplyStatus: '데이터 수집 중',
          chonseRate: 50.0,
          chonseChange: '+0.0'
        },
        chartData: [
          { month: prevYmd.substring(2), volume: prevVolume, priceIndex: 100 },
          { month: currentYmd.substring(2), volume: volume, priceIndex: 100.5 },
        ],
        hotIssues: sortedDongs.slice(0, 3).map((d, i) => ({
          rank: i + 1,
          name: d.name,
          price: `${d.count}건`,
          tag: '활발',
          type: 'hot'
        })),
        gapInvest: [],
        topPrices: [],
        inventory: []
      }
    });
  } catch (err) {
    console.error('Failed to fetch dashboard molit data:', err);
    return NextResponse.json({ success: false, error: 'API Error' });
  }
}
