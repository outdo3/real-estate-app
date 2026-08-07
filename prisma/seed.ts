import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // 기존 데이터 초기화
  await prisma.transaction.deleteMany()

  // 반등 데이터
  await prisma.transaction.createMany({
    data: [
      { rank: 1, name: '당산현대3차', price: '17억', priceChange: '▲ 7억6천500', changeType: 'up', typeLabel: '반등', info: '73.27m² 25평 • 26.07.18', lat: 37.527341, lng: 126.904838 },
      { rank: 2, name: '광명역써밋플레이스', price: '14억8천', priceChange: '▲ 3억4천', changeType: 'up', typeLabel: '반등', info: '84.853m² 36평 • 26.07.08', lat: 37.424368, lng: 126.883701 },
      { rank: 3, name: '장미마을(현대)', price: '14억5천', priceChange: '▲ 5억8천', changeType: 'up', typeLabel: '반등', info: '74.61m² 27평 • 26.07.10', lat: null, lng: null },
      { rank: 4, name: 'DMC센트레빌', price: '14억2천', priceChange: '▲ 2억2천', changeType: 'up', typeLabel: '반등', info: '114.85m² 43평 • 26.08.03', lat: null, lng: null },
    ]
  })

  // 신고가 데이터
  await prisma.transaction.createMany({
    data: [
      { rank: 1, name: '디에이치아너힐즈', price: '53억', priceChange: '▲ 2억5천', changeType: 'new', typeLabel: '신고가', info: '105.82m² 41평 • 26.08.01', lat: 37.483983, lng: 127.066497 },
      { rank: 2, name: '메이플자이', price: '49억', priceChange: '▲ 1억2천', changeType: 'new', typeLabel: '신고가', info: '99.5m² 38평 • 26.08.02', lat: null, lng: null },
    ]
  })

  console.log('Seed data inserted successfully.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
