import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';
  const region = `${sido} ${gungu}`;

  // 모의 데이터 생성 (지역별 특성에 맞춰 일부 변형 가능)
  // 여기서는 사용자가 제공한 mockup 데이터를 기반으로 동적 데이터를 반환
  const mockData = {
    summary: {
      volume: 159,
      volumeChange: 112, // 월평균 대비 112%
      supply: '2,400',
      supplyStatus: '적정수요 부합',
      chonseRate: 64.5,
      chonseChange: '+0.8'
    },
    chartData: [
      { month: '23.09', volume: 80, priceIndex: 98.2 },
      { month: '23.10', volume: 95, priceIndex: 98.5 },
      { month: '23.11', volume: 85, priceIndex: 98.4 },
      { month: '23.12', volume: 70, priceIndex: 98.1 },
      { month: '24.01', volume: 90, priceIndex: 97.8 },
      { month: '24.02', volume: 110, priceIndex: 97.6 },
      { month: '24.03', volume: 130, priceIndex: 97.9 },
      { month: '24.04', volume: 145, priceIndex: 98.3 },
      { month: '24.05', volume: 160, priceIndex: 98.8 },
      { month: '24.06', volume: 155, priceIndex: 99.2 },
      { month: '24.07', volume: 150, priceIndex: 99.6 },
      { month: '24.08', volume: 159, priceIndex: 100.1 },
    ],
    hotIssues: [
      { rank: 1, name: '힐스테이트이진베이시티', price: '11억 5,000만', tag: '신고가', type: 'up' },
      { rank: 2, name: 'e편한세상송도', price: '3억 9,000만', tag: '신고가', type: 'up' },
      { rank: 3, name: '대신푸르지오 1차', price: '7억 2,000만', tag: '반등', type: 'rebound' },
      { rank: 4, name: '대신더샵', price: '6억 8,000만', tag: '반등', type: 'rebound' },
      { rank: 5, name: '대신해모로센트럴', price: '6억 5,000만', tag: '거래증가', type: 'hot' },
    ],
    gapInvest: [
      { rank: 1, name: '보수아파트', gap: '2,500만', deals: 12 },
      { rank: 2, name: '대신공원한신휴플러스', gap: '8,000만', deals: 9 },
      { rank: 3, name: '송도자이르네디오션', gap: '1억 2,000만', deals: 7 },
      { rank: 4, name: '서대신금호어울림', gap: '1억 5,000만', deals: 5 },
      { rank: 5, name: '남성한빛아파트', gap: '9,500만', deals: 4 },
    ],
    topPrices: [
      { rank: 1, name: '힐스테이트이진베이시티', pricePerPyung: '3,200만/평', price: '11.5억' },
      { rank: 2, name: '대신푸르지오 1차', pricePerPyung: '2,400만/평', price: '8.1억' },
      { rank: 3, name: 'e편한세상송도', pricePerPyung: '2,150만/평', price: '7.3억' },
      { rank: 4, name: '대신더샵', pricePerPyung: '2,080만/평', price: '7.0억' },
      { rank: 5, name: '대신해모로센트럴', pricePerPyung: '2,000만/평', price: '6.7억' },
    ],
    inventory: [
      { rank: 1, name: '힐스테이트이진베이시티', changeRate: '+15%', amount: 142 },
      { rank: 2, name: '대신푸르지오 1차', changeRate: '+12%', amount: 89 },
      { rank: 3, name: 'e편한세상송도', changeRate: '-5%', amount: 45 },
      { rank: 4, name: '대신더샵', changeRate: '+3%', amount: 67 },
      { rank: 5, name: '송도자이르네디오션', changeRate: '-8%', amount: 32 },
    ]
  };

  return NextResponse.json({ success: true, region, data: mockData });
}
