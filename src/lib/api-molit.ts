import { XMLParser } from 'fast-xml-parser';

const API_KEY = process.env.DATA_GO_KR_API_KEY;

export type DataType = 'apt' | 'rent' | 'silv' | 'officetel' | 'villa';

interface FetchParams {
  lawdCd: string; // 5자리 지역코드 (예: 11680)
  dealYmd: string; // YYYYMM (예: 202608)
  type: DataType;
}

// 만원 단위 정수(또는 그 문자열)를 "N억 M만" 형태의 한글 가격 문자열로 변환
export const formatKoreanPrice = (val: string | number) => {
  const cleanStr = val.toString().replace(/[\s,]/g, '');
  const num = parseInt(cleanStr, 10);
  if (isNaN(num)) return val.toString();
  if (num >= 10000) {
    const eok = Math.floor(num / 10000);
    const rest = num % 10000;
    if (eok > 0) {
      return `${eok}억 ${rest > 0 ? rest.toLocaleString('ko-KR') + '만' : ''}`.trim();
    }
  }
  return `${num.toLocaleString('ko-KR')}만`;
};

// RTMSDataSvcAptTradeDev(매매 상세) 응답에만 존재하는 실제 필드. 등기일자가 채워져 있으면
// 등기 완료, 해제여부가 'O'면 계약 해제(취소) 건으로 판단한다 — 추정치가 아닌 원본 데이터.
// TRADE_CANCELLATION_AUDIT_V1(2026-08-30): 문서상 한글 필드명(등기일자/해제여부/해제사유발생일)을
// 써왔으나, 실제 live 응답은 영문 필드명(rgstDate/cdealType/cdealDay)만 내려온다는 것을
// 실측으로 확인했다(부산 3개구 x 최근 12개월, 13,716건 스캔, cdealType='O' 786건/13716건
// 관측 — 기존 한글 필드명 매칭은 항상 실패해 dealCanceled가 늘 false로 저장되고 있었다).
// 두 이름 다 매칭하도록 남겨 향후 응답 스키마가 한글로 바뀌어도 깨지지 않게 한다.
// cancelDate(cdealDay)는 관측된 실제 포맷이 "YY.MM.DD"(예: "26.08.04")로, 모델 주석이
// 가정한 YYYYMMDD와 다르다 — 파싱하지 않고 원본 그대로 저장하므로 이 차이가 저장값에
// 영향을 주지는 않지만, 소비하는 코드가 있다면 포맷을 가정하지 말 것.
export function parseCancellationFields(item: any): { registryDate: string; dealCanceled: boolean; cancelDate: string } {
  const registryDate = (item.등기일자 || item.rgstDate || '').toString().trim();
  const dealCanceled = (item.해제여부 || item.cdealType || '').toString().trim() === 'O';
  const cancelDate = (item.해제사유발생일 || item.cdealDay || '').toString().trim();
  return { registryDate, dealCanceled, cancelDate };
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

  const cleanKey = API_KEY.trim().replace(/['"]/g, '');
  const decodedKey = decodeURIComponent(cleanKey);
  const finalKey = encodeURIComponent(decodedKey);
  const url = `${endpoint}?serviceKey=${finalKey}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000`;

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
    
    // Check for OpenAPI error first
    if (jsonObj.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg) {
      throw new Error(`OpenAPI Error: ${jsonObj.OpenAPI_ServiceResponse.cmmMsgHeader.returnAuthMsg}`);
    }

    const items = jsonObj.response?.body?.items?.item;

    if (!items) {
      // If items is empty but resultCode is 00 (Normal), just return empty array
      if (jsonObj.response?.header?.resultCode === '00' || jsonObj.response?.header?.resultCode === 0) {
        return [];
      }
      throw new Error(`No items found. Response: ${textData.substring(0, 100)}...`);
    }

    const itemsArray = Array.isArray(items) ? items : [items];

    return itemsArray.map((item: any, index: number) => {
      let priceStr = '';
      let dealAmount = 0;
      let monthlyRent = 0;
      
      if (type === 'rent') {
        const deposit = (item.보증금액 || item.deposit || '').toString().replace(/[\s,]/g, '');
        const monthly = (item.월세금액 || item.monthlyRent || '').toString().replace(/[\s,]/g, '');
        dealAmount = parseInt(deposit, 10) || 0;
        monthlyRent = parseInt(monthly, 10) || 0;
        
        priceStr = `보 ${formatKoreanPrice(deposit)}`;
        if (monthlyRent > 0) {
          priceStr += ` / 월세 ${formatKoreanPrice(monthly)}`;
        }
      } else {
        const dealStr = (item.거래금액 || item.dealAmount || '').toString().replace(/[\s,]/g, '');
        dealAmount = parseInt(dealStr, 10) || 0;
        priceStr = formatKoreanPrice(dealStr);
      }

      // 평형 (전용면적)
      const areaVal = item.전용면적 || item.excluUseAr || '';
      const area = areaVal ? `${areaVal}m²` : '';
      // 전용면적 원본 숫자값(전용면적 비교/후속 계산용) — 표시용 "area" 문자열과 별개로 보존.
      // MOLIT 필드(excluUseAr)는 공식적으로 "전용면적"임이 명시돼 있어(청약홈 HOUSE_TY와
      // 달리 의미가 불확실하지 않다) 그대로 숫자로 파싱해 보존한다.
      const excluUseArea = areaVal !== '' ? parseFloat(String(areaVal)) : null;

      // 거래일
      const year = item.년 || item.dealYear || '0000';
      const month = String(item.월 || item.dealMonth || '00').padStart(2, '0');
      const day = String(item.일 || item.dealDay || '00').padStart(2, '0');
      const tradeDate = `${year}-${month}-${day}`;

      // MOLIT 원본의 단지 고유번호(예: "26140-1361"). Number 변환 없이 문자열 그대로
      // 보존한다(M1~M4가 확립한 identifier 안전 원칙) — P2-D4-B2에서 aptSeq 기반
      // ApartmentMaster 연결에 사용한다. 없으면 null(기존 소비자에 영향 없는 optional 필드).
      const aptSeq = item.aptSeq != null ? String(item.aptSeq).trim() : null;

      const name = item.아파트 || item.aptNm || item.단지 || item.단지명 || item.offiNm || item.연립다세대 || item.mhouseNm || '이름 없음';
      const floor = item.층 || item.floor || '';
      const dong = (item.법정동 || item.umdNm || '').toString().trim();
      const buildYear = (item.건축년도 || item.buildYear || '').toString().trim();
      const jibun = (item.지번 || item.jibun || '').toString().trim();
      const { registryDate, dealCanceled, cancelDate } = parseCancellationFields(item);

      return {
        id: `${type}-${lawdCd}-${dealYmd}-${index}`,
        rank: index + 1,
        name: name,
        price: priceStr,
        dealAmount: dealAmount, // 추가
        monthlyRent: monthlyRent, // 추가
        priceChange: '',
        changeType: 'new',
        typeLabel: type === 'rent' ? '전월세' : (type === 'silv' ? '분양권' : (type === 'officetel' ? '오피스텔' : (type === 'villa' ? '빌라' : '실거래'))),
        info: `${area} • ${floor ? floor + '층' : ''} • ${tradeDate}`,
        dong: dong,
        buildYear: buildYear,
        jibun: jibun,
        registryDate: registryDate,
        dealCanceled: dealCanceled,
        cancelDate: cancelDate,
        lat: null,
        lng: null,
        // P2-D4-B2 확장分 — optional 필드로 추가, 기존 필드는 전혀 변경하지 않음(기존
        // consumer가 이 필드들을 읽지 않아도 그대로 정상 동작). dealDate는 위 tradeDate와
        // 동일 값을 별도 필드로도 노출한다(기존 info 문자열 파싱 없이 정렬/식별에 바로
        // 쓸 수 있도록).
        aptSeq,
        excluUseArea,
        dealDate: tradeDate,
        floorRaw: floor || null,
      };
    });

  } catch (error: any) {
    const maskedKey = API_KEY ? `${API_KEY.trim().substring(0, 5)}...${API_KEY.trim().substring(API_KEY.trim().length - 5)}` : 'none';
    console.log(`MOLIT API Error or Timeout (${type}, ${dealYmd}). ${error.message}`);
    // Instead of failing silently, return a special error object so the frontend can display it
    return [{
      id: `error-${type}-${lawdCd}-${dealYmd}`,
      rank: 1,
      name: `API 에러: ${error.message}`,
      price: '에러',
      priceChange: '', 
      changeType: 'new',
      typeLabel: '에러',
      info: `사용된 키 확인: ${maskedKey}`,
      dong: '오류',
      lat: null, 
      lng: null,
    }];
  }
}
