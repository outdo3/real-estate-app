import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const busanApts = [
  { name: '힐스테이트이진베이시티', price: '11억 5,000만', lng: 129.0225, lat: 35.0772, typeLabel: '신고가', info: '84m² 34평 • 26.07.18' },
  { name: '송도자이하늘채', price: '7억 8,000만', lng: 129.0261, lat: 35.0734, typeLabel: '반등', info: '59m² 24평 • 26.07.15' },
  { name: '대신푸르지오', price: '8억 3,000만', lng: 129.0157, lat: 35.1165, typeLabel: '신고가', info: '84m² 34평 • 26.07.12' },
  { name: '대신해모로센트럴', price: '7억 1,000만', lng: 129.0189, lat: 35.1121, typeLabel: '반등', info: '59m² 24평 • 26.07.10' },
  { name: '송도탑스빌', price: '6억 2,000만', lng: 129.0245, lat: 35.0781, typeLabel: '반등', info: '84m² 34평형 26.07.05' },
  { name: '동대신역비스타동원', price: '6억 5,000만', lng: 129.0190, lat: 35.1145, typeLabel: '신고가', info: '84m² 34평형 26.07.01' },
  { name: '초장센트럴파크', price: '4억 2,000만', lng: 129.0110, lat: 35.1010, typeLabel: '반등', info: '59m² 24평형 26.06.28' },
  { name: '대신롯데캐슬', price: '6억 8,000만', lng: 129.0165, lat: 35.1150, typeLabel: '신고가', info: '84m² 34평형 26.06.25' },
  { name: '대신더샵', price: '5억 9,000만', lng: 129.0165, lat: 35.1165, typeLabel: '반등', info: '84m² 34평형 26.07.20' },
  { name: '대신공원한신휴플러스', price: '4억 5,000만', lng: 129.0145, lat: 35.1145, typeLabel: '신고가', info: '84m² 34평형 26.07.22' }
];

async function main() {
  // 기존 트랜잭션 데이터 전체 삭제
  await prisma.transaction.deleteMany({});
  
  // 부산 아파트 데이터 삽입
  for (let i = 0; i < busanApts.length; i++) {
    const apt = busanApts[i];
    await prisma.transaction.create({
      data: {
        rank: i + 1,
        name: apt.name,
        price: apt.price,
        priceChange: '▲ 5,000',
        changeType: apt.typeLabel === '신고가' ? 'new' : 'up',
        typeLabel: apt.typeLabel,
        info: apt.info,
        lng: apt.lng,
        lat: apt.lat,
      }
    });
  }
  console.log('Busan apartments seeded successfully.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
