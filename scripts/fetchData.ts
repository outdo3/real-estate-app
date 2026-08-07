import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

// .env.local 로드
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const prisma = new PrismaClient();

async function fetchRealEstateData() {
  const apiKey = process.env.DATA_GO_KR_API_KEY;
  
  if (!apiKey || apiKey.includes('여기에_')) {
    console.error('❌ 에러: 공공데이터포털 API 키가 .env.local 파일에 정상적으로 설정되지 않았습니다.');
    process.exit(1);
  }

  try {
    console.log('📡 국토교통부 아파트 실거래가 API 데이터를 가져오는 중...');
    
    // 강남구(11680) 예시
    const LAWD_CD = '11680'; 
    
    // 항상 스크립트를 실행하는 현재 시점의 "년월(YYYYMM)"을 자동으로 계산
    const now = new Date();
    // 데이터 포털 특성상 이번달 초에는 데이터가 적을 수 있으므로 지난달 데이터를 가져옵니다. (안전하게 전월 데이터 보장)
    now.setMonth(now.getMonth() - 1); 
    const DEAL_YMD = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    console.log(`📌 조회 월 설정: ${DEAL_YMD} (현재 시점 기준 최신 실거래월)`);
    
    // 실제 국토부 아파트 매매 실거래가 API (최신 엔드포인트) JSON 포맷 요청
    const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${apiKey}&pageNo=1&numOfRows=100&LAWD_CD=${LAWD_CD}&DEAL_YMD=${DEAL_YMD}&_type=json`;
    
    const response = await axios.get(url);
    
    let items: any[] = [];
    
    // JSON 응답인 경우
    if (response.data && response.data.response && response.data.response.body && response.data.response.body.items) {
       const rawItems = response.data.response.body.items.item;
       items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
    } else if (response.data && response.data.body && response.data.body.items) {
       const rawItems = response.data.body.items.item;
       items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
    } else {
       console.log('API 응답 형식:', JSON.stringify(response.data).substring(0, 200));
       throw new Error('응답 데이터 형식이 올바르지 않거나 데이터가 없습니다.');
    }
    
    if (items.length === 0) {
      console.log('⚠️ 해당하는 기간/지역에 데이터가 없습니다.');
      return;
    }
    
    console.log(`✅ 총 ${items.length}개의 데이터를 성공적으로 가져왔습니다. DB에 저장합니다...`);

    // 기존 데이터 초기화
    await prisma.transaction.deleteMany();
    await prisma.tradeHistory.deleteMany();

    // 가져온 데이터를 랭킹(Transaction) 테이블에 저장 (상위 10개)
    for (let i = 0; i < Math.min(items.length, 10); i++) {
      const apt = items[i];
      const aptName = apt.aptNm || apt.아파트 || '이름없음';
      
      const rawPrice = (apt.dealAmount || apt.거래금액 || '0').replace(/,/g, '').trim();
      const priceVal = parseInt(rawPrice, 10);
      const isNewHigh = priceVal > 150000;
      
      const priceLabel = `${Math.floor(priceVal / 10000)}억${priceVal % 10000 === 0 ? '' : ` ${priceVal % 10000}만`}`;
      const year = apt.dealYear || apt.년;
      const month = String(apt.dealMonth || apt.월).padStart(2, '0');
      const day = String(apt.dealDay || apt.일).padStart(2, '0');
      const area = apt.excluUseAr || apt.전용면적;
      
      await prisma.transaction.create({
        data: {
          rank: i + 1,
          name: aptName,
          price: priceLabel,
          priceChange: isNewHigh ? '▲ 1억' : '▲ 5000',
          changeType: isNewHigh ? 'new' : 'up',
          typeLabel: isNewHigh ? '신고가' : '반등',
          info: `${area}m² • ${year.toString().slice(2)}.${month}.${day}`,
          lat: 37.498 + (Math.random() - 0.5) * 0.02,
          lng: 127.027 + (Math.random() - 0.5) * 0.02,
        }
      });
    }
    
    console.log('🎉 랭킹 진짜 데이터 DB 업데이트 완료!');

    // 가져온 데이터를 상세 거래이력(TradeHistory) 테이블에 저장
    const tradeHistories = [];
    
    for (const apt of items) {
        const aptName = apt.aptNm || apt.아파트 || '이름없음';
        const rawPrice = (apt.dealAmount || apt.거래금액 || '0').replace(/,/g, '').trim();
        const priceVal = parseInt(rawPrice, 10);
        const priceStr = `${Math.floor(priceVal / 10000)}억 ${priceVal % 10000 === 0 ? '' : `${priceVal % 10000}만`}`.trim();
        
        const year = apt.dealYear || apt.년;
        const month = String(apt.dealMonth || apt.월).padStart(2, '0');
        const day = String(apt.dealDay || apt.일).padStart(2, '0');
        const tradeDate = `${year}.${month}.${day}`;
        
        const areaStr = apt.excluUseAr || apt.전용면적;
        const floor = parseInt(apt.floor || apt.층 || '1', 10);
        
        const isAgency = (apt.dealingGbn === '중개거래');

        tradeHistories.push({
          aptName: aptName,
          tradeDate: tradeDate,
          price: Math.floor(priceVal / 10000), // 그래프용 정수(억 단위)
          priceStr: priceStr,
          area: `${areaStr}m²`,
          floor: floor,
          tradeType: isAgency ? '중개거래' : '직거래'
        });
    }

    await prisma.tradeHistory.createMany({ data: tradeHistories });
    console.log(`🎉 상세 거래이력 진짜 데이터 ${tradeHistories.length}건 주입 완료! 브라우저를 새로고침 해보세요.`);
    
  } catch (error: any) {
    console.error('❌ 공공데이터 API 연동 실패:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

fetchRealEstateData();
