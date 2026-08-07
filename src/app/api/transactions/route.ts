import { NextResponse } from 'next/server';
import { fetchMolitData, DataType } from '@/lib/api-molit';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const changeType = searchParams.get('changeType');
    const type = searchParams.get('type') as DataType;
    const lawdCd = searchParams.get('lawdCd');
    const dong = searchParams.get('dong');
    const loadMore = parseInt(searchParams.get('loadMore') || '0', 10);
    
    // 1. type과 lawdCd가 있으면 국토부 API 실시간 호출
    if (type && lawdCd) {
      const getMonths = (startOffset: number, count: number) => {
        const res = [];
        for (let i = 0; i < count; i++) {
          const date = new Date();
          // Current month is 0-indexed, so we subtract startOffset + i
          date.setMonth(date.getMonth() - (startOffset + i));
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, '0');
          res.push(`${y}${m}`);
        }
        return res;
      };
      
      // loadMore=0 -> offset=0 (last 3 months)
      // loadMore=1 -> offset=3 (previous 3 months)
      const months = getMonths(loadMore * 3, 3);
      
      // 공공데이터 API 병렬 호출 (속도 개선)
      const promises = months.map(dealYmd => fetchMolitData({ lawdCd, dealYmd, type }));
      const results = await Promise.all(promises);
      
      // 데이터를 하나의 배열로 합치고 정렬 (최신이 위로 오도록 임시 처리)
      let data = results.flat().reverse();
      
      if (dong && dong !== 'all') {
        data = data.filter((item: any) => item.dong === dong);
      }
      
      return NextResponse.json(data);
    }

    // 2. 파라미터가 없으면 기존 DB 데이터(TOP 5) 반환
    const transactions: any[] = [];

    return NextResponse.json(transactions);
  } catch (error) {
    console.error('Failed to fetch transactions:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}
