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
      // loadMore 횟수에 따라 과거 데이터를 더 가져옵니다.
      // 0: 6, 7, 8월 / 1: 3, 4, 5월 추가 등
      const baseMonths = ['202606', '202607', '202608'];
      let months = [...baseMonths];
      
      for (let i = 1; i <= loadMore; i++) {
        // 더보기를 누를 때마다 이전 3개월 추가 (간단한 예시 연산)
        const prev1 = 202606 - (i * 3);
        const prev2 = prev1 + 1;
        const prev3 = prev1 + 2;
        months.push(String(prev1), String(prev2), String(prev3));
      }
      
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
