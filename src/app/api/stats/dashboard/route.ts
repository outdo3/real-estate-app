import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';
  const region = `${sido} ${gungu}`;

  // 모의 데이터 생성 (지역별 특성에 맞춰 일부 변형 가능)
  let mockData;
  
  if (sido === '서울특별시' && gungu === '강남구') {
    mockData = {
      summary: {
        volume: 320,
        volumeChange: 145, 
        supply: '1,200',
        supplyStatus: '공급 부족',
        chonseRate: 48.5,
        chonseChange: '+1.2'
      },
      chartData: [
        { month: '23.09', volume: 180, priceIndex: 102.2 },
        { month: '23.10', volume: 195, priceIndex: 102.5 },
        { month: '23.11', volume: 185, priceIndex: 102.4 },
        { month: '23.12', volume: 170, priceIndex: 102.1 },
        { month: '24.01', volume: 190, priceIndex: 101.8 },
        { month: '24.02', volume: 210, priceIndex: 102.6 },
        { month: '24.03', volume: 230, priceIndex: 103.9 },
        { month: '24.04', volume: 245, priceIndex: 105.3 },
        { month: '24.05', volume: 260, priceIndex: 106.8 },
        { month: '24.06', volume: 280, priceIndex: 108.2 },
        { month: '24.07', volume: 300, priceIndex: 110.6 },
        { month: '24.08', volume: 320, priceIndex: 112.1 },
      ],
      hotIssues: [
        { rank: 1, name: '래미안대치팰리스', price: '34억 5,000만', tag: '신고가', type: 'up' },
        { rank: 2, name: '아크로리버파크', price: '42억 9,000만', tag: '신고가', type: 'up' },
        { rank: 3, name: '은마아파트', price: '24억 2,000만', tag: '반등', type: 'rebound' },
        { rank: 4, name: '도곡렉슬', price: '28억 8,000만', tag: '반등', type: 'rebound' },
        { rank: 5, name: '개포자이프레지던스', price: '29억 5,000만', tag: '거래증가', type: 'hot' },
      ],
      gapInvest: [
        { rank: 1, name: '개포주공6단지', gap: '15억', deals: 12 },
        { rank: 2, name: '대치삼성', gap: '12억 5,000만', deals: 9 },
        { rank: 3, name: '역삼푸르지오', gap: '13억 2,000만', deals: 7 },
        { rank: 4, name: '청담자이', gap: '18억 5,000만', deals: 5 },
        { rank: 5, name: '일원가람', gap: '9억 5,000만', deals: 4 },
      ],
      topPrices: [
        { rank: 1, name: 'PH129', pricePerPyung: '1억 5,200만/평', price: '120억' },
        { rank: 2, name: '아크로리버파크', pricePerPyung: '1억 2,400만/평', price: '42.9억' },
        { rank: 3, name: '래미안대치팰리스', pricePerPyung: '1억 1,500만/평', price: '34.5억' },
        { rank: 4, name: '디에이치퍼스티어아이파크', pricePerPyung: '1억 800만/평', price: '32.0억' },
        { rank: 5, name: '도곡렉슬', pricePerPyung: '9,500만/평', price: '28.8억' },
      ],
      inventory: [
        { rank: 1, name: '은마아파트', changeRate: '+5%', amount: 142 },
        { rank: 2, name: '디에이치퍼스티어아이파크', changeRate: '+12%', amount: 289 },
        { rank: 3, name: '래미안대치팰리스', changeRate: '-5%', amount: 45 },
        { rank: 4, name: '도곡렉슬', changeRate: '+3%', amount: 167 },
        { rank: 5, name: '개포자이프레지던스', changeRate: '-8%', amount: 132 },
      ]
    };
  } else {
    mockData = {
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
  }

  return NextResponse.json({ success: true, region, data: mockData });
}
