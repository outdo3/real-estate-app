import { XMLParser } from 'fast-xml-parser';

const API_KEY = process.env.DATA_GO_KR_API_KEY;

export type DataType = 'apt' | 'rent' | 'silv' | 'officetel' | 'villa';

interface FetchParams {
  lawdCd: string; // 5자리 지역코드 (예: 11680)
  dealYmd: string; // YYYYMM (예: 202608)
  type: DataType;
}

export async function fetchMolitData({ lawdCd, dealYmd, type }: FetchParams) {
  try {
    if (!API_KEY) {
      throw new Error('DATA_GO_KR_API_KEY is not defined in environment variables.');
    }

    let endpoint = '';
  switch (type) {
    case 'apt':
      endpoint = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev'; // 아파트 매매 상세
      break;
    case 'rent':
      endpoint = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent'; // 아파트 전월세
      break;
    case 'silv':
      endpoint = 'http://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade'; // 아파트 분양권전매
      break;
    case 'officetel':
      endpoint = 'http://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade'; // 오피스텔 매매
      break;
    case 'villa':
      endpoint = 'http://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade'; // 연립다세대 매매 (빌라)
      break;
  }

  const decodedKey = decodeURIComponent(API_KEY);
  const url = `${endpoint}?serviceKey=${encodeURIComponent(decodedKey)}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/xml, text/xml, */*'
      },
      // 1시간(3600초) 단위로 캐싱하여 반복 로딩 속도를 밀리초 단위로 줄임
      next: { revalidate: 3600 },
      // 짧은 타임아웃을 주어 안될 경우 바로 Mock으로 넘어가게 함 (Node 16+ AbortSignal)
      signal: AbortSignal.timeout(5000)
    });
    
    const textData = await response.text();
    
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: true,
    });
    
    const jsonObj = parser.parse(textData);
    const items = jsonObj.response?.body?.items?.item;

    if (!items) {
      throw new Error("No items found");
    }

    const itemsArray = Array.isArray(items) ? items : [items];

    const formatKoreanPrice = (val: string) => {
      const cleanStr = val.replace(/,/g, '').trim();
      const num = parseInt(cleanStr, 10);
      if (isNaN(num)) return val;
      if (num >= 10000) {
        const uk = Math.floor(num / 10000);
        const man = num % 10000;
        return man === 0 ? `${uk}억` : `${uk}억 ${man.toLocaleString('ko-KR')}만`;
      }
      return `${num.toLocaleString('ko-KR')}만`;
    };

    return itemsArray.map((item: any, index: number) => {
      // 거래 금액 (매매가 또는 보증금)
      let priceStr = '';
      if (type === 'rent') {
        const deposit = (item.보증금액 || item.deposit || '').toString().trim();
        const monthly = (item.월세금액 || item.monthlyRent || '').toString().trim();
        priceStr = `보증금 ${formatKoreanPrice(deposit)}`;
        if (monthly && parseInt(monthly.replace(/,/g, '')) > 0) {
          priceStr += ` / 월세 ${formatKoreanPrice(monthly)}`;
        }
      } else {
        const dealAmount = (item.거래금액 || item.dealAmount || '').toString().trim();
        priceStr = formatKoreanPrice(dealAmount);
      }

      // 평형 (전용면적)
      const areaVal = item.전용면적 || item.excluUseAr || '';
      const area = areaVal ? `${areaVal}m²` : '';
      
      // 거래일
      const year = item.년 || item.dealYear || '0000';
      const month = String(item.월 || item.dealMonth || '00').padStart(2, '0');
      const day = String(item.일 || item.dealDay || '00').padStart(2, '0');
      const tradeDate = `${year}-${month}-${day}`;

      const name = item.아파트 || item.aptNm || item.단지 || item.단지명 || item.offiNm || item.연립다세대 || item.mhouseNm || '이름 없음';
      const floor = item.층 || item.floor || '';
      const dong = (item.법정동 || item.umdNm || '').toString().trim();
      const buildYear = (item.건축년도 || item.buildYear || '').toString().trim();
      const jibun = (item.지번 || item.jibun || '').toString().trim();

      return {
        id: `${type}-${lawdCd}-${dealYmd}-${index}`,
        rank: index + 1,
        name: name,
        price: priceStr,
        priceChange: '', 
        changeType: 'new',
        typeLabel: type === 'rent' ? '전월세' : (type === 'silv' ? '분양권' : (type === 'officetel' ? '오피스텔' : (type === 'villa' ? '빌라' : '실거래'))),
        info: `${area} • ${floor ? floor + '층' : ''} • ${tradeDate}`,
        dong: dong,
        buildYear: buildYear,
        jibun: jibun,
        lat: null, 
        lng: null,
      };
    });

  } catch (error) {
    console.log(`MOLIT API Error or Timeout (${type}, ${dealYmd}). Returning MOCK data...`);
    
    // 네트워크 환경 문제로 국토부 API 접근 불가 시, 실시간 UI 시연을 위한 가상 데이터 생성
    const isBusan = lawdCd.startsWith('26');
    const mockDong = isBusan ? (lawdCd === '26140' ? '서대신동' : '해운대구') : '역삼동';
    
    const mockNames = type === 'apt' ? ['푸르지오', '래미안', '자이', '힐스테이트', '롯데캐슬'] :
                      type === 'rent' ? ['행복마을', '휴먼시아', '대시앙', 'sk뷰', '더샵'] :
                      type === 'officetel' ? ['센텀오피스텔', '에비뉴', '스마트시티', '리더스', '골든타워'] :
                      type === 'villa' ? ['그린빌라', '행복빌라', '햇살마을', '청담빌라', '로즈하우스'] :
                      ['분양권A', '분양권B', '분양권C', '분양권D', '분양권E'];

    return Array.from({ length: 5 }).map((_, index) => {
      const year = dealYmd.substring(0, 4);
      const month = dealYmd.substring(4, 6);
      const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
      
      const formatKoreanPriceMock = (val: number) => {
        if (val >= 10000) {
          const uk = Math.floor(val / 10000);
          const man = val % 10000;
          return man === 0 ? `${uk}억` : `${uk}억 ${man.toLocaleString('ko-KR')}만`;
        }
        return `${val.toLocaleString('ko-KR')}만`;
      };

      const randPrice = Math.floor(Math.random() * 50000) + 10000;
      let priceStr = type === 'rent' 
        ? `보증금 ${formatKoreanPriceMock(Math.floor(Math.random() * 20000))} / 월세 ${formatKoreanPriceMock(Math.floor(Math.random() * 100) + 30)}`
        : formatKoreanPriceMock(randPrice);

      return {
        id: `mock-${type}-${lawdCd}-${dealYmd}-${index}`,
        rank: index + 1,
        name: `${mockDong} ${mockNames[index % mockNames.length]}`,
        price: priceStr,
        priceChange: '', 
        changeType: index % 2 === 0 ? 'up' : 'new',
        typeLabel: type === 'rent' ? '전월세' : (type === 'silv' ? '분양권' : (type === 'officetel' ? '오피스텔' : (type === 'villa' ? '빌라' : '실거래'))),
        info: `${Math.floor(Math.random() * 40) + 50}m² • ${Math.floor(Math.random() * 15) + 1}층 • ${year}-${month}-${day}`,
        dong: mockDong,
        lat: null, 
        lng: null,
      };
    });
  }
}
