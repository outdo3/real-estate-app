import { XMLParser } from 'fast-xml-parser';
import { dedupMolitInFlight, runMolitGuarded, type MolitAttemptOutcome, type MolitGuardDeps } from './molit-rate-guard';

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

// APT_DETAIL_NAME_TYPE_HOTFIX — MOLIT 응답에서 "단지명"을 담는 태그들. 이 값들은 원본
// 계약상 텍스트(식별자)이지, 숫자가 아니다.
const MOLIT_NAME_TAGS = new Set(['aptNm', 'offiNm', 'mhouseNm', '아파트', '단지', '단지명', '연립다세대']);

// XMLParser의 parseTagValue(기본 true)는 "숫자처럼 보이는" 태그 텍스트를 number로 바꾼다.
// 거래금액/면적/년월일처럼 실제로 숫자인 필드에는 그게 맞지만, 단지명에 적용되면
// (1) 이름이 number가 되어 문자열 연산에서 터지고(실측: /api/apt/[name]의
// "raw.replace is not a function"), (2) "0101" 같은 표기의 선행 0이 사라져 원본 식별
// 표기가 훼손된다. tagValueProcessor가 undefined를 반환하면 fast-xml-parser는 원본
// 문자열을 그대로(trim만 적용) 쓰므로, 이름 태그에만 숫자 변환을 끈다 — 다른 필드는
// val을 그대로 돌려줘 기존 파싱 결과(타입 포함)를 한 글자도 바꾸지 않는다.
export function createMolitXmlParser() {
  return new XMLParser({
    ignoreAttributes: false,
    parseTagValue: true,
    tagValueProcessor: (tagName: string, tagValue: string) =>
      MOLIT_NAME_TAGS.has(tagName) ? undefined : tagValue,
  });
}

// 단지명 원본값을 "사용 가능한 이름 문자열"로만 통과시킨다. 숫자로 파싱된 값은 원본
// 텍스트가 숫자였다는 뜻이므로 그대로 문자열화하고(형제 필드 dong/jibun/buildYear가
// 이미 .toString()으로 다루는 것과 동일한 계약), 객체/배열처럼 예상 못한 shape은
// 이름을 지어내지 않고 "없음"으로 취급한다("[object Object]" 같은 가짜 이름 금지).
function toMolitNameText(value: unknown): string {
  if (typeof value === 'string') return value.trim() === '' ? '' : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  return '';
}

// MOLIT 호출 실패 메시지를 밖으로 내보내기 전에 비밀값을 지운다. fetch 실패 메시지에는
// 요청 URL이 통째로 들어오는 경우가 있고, 그 URL에는 serviceKey(공공데이터 인증키)가
// 그대로 들어있다. 이 메시지는 응답 apiError와 ErrorLog까지 흘러가므로 원본을 그대로
// 흘리면 인증키가 외부에 노출된다.
export function redactMolitFailureMessage(message: unknown): string {
  const text = typeof message === 'string' && message.trim() !== '' ? message : '알 수 없는 오류';
  return text
    .replace(/serviceKey=[^&\s]*/gi, 'serviceKey=[redacted]')
    .replace(/https?:\/\/\S+/gi, '[redacted-url]');
}

// MOLIT_LIVE_PAGING_FIX_V1 — 한 페이지에 담기는 최대 행 수. 기존 라이브 경로가 써 온
// 값이자 대량 sync fetcher(scripts/sale-molit-fetch.ts, rent-molit-fetch.ts)와 같은
// 관행값이다. 서버는 이 값을 그대로 존중하고 응답 body에 echo한다(실측 확인).
export const MOLIT_PAGE_SIZE = 1000;

/** 한 페이지의 원본 응답. 매핑 전 raw item과 서버가 알려준 전체 건수. */
export interface MolitRawPage {
  rawItems: any[];
  /** 서버가 준 totalCount. 파싱할 수 없으면 null — "0건"과 절대 혼동하지 않는다. */
  totalCount: number | null;
}

// 한 번의 HTTP 시도. 실패는 throw로 알린다 — 재시도 여부는 molit-rate-guard가
// 실패 메시지를 분류해 정한다. URL/타임아웃/캐시/파싱/빈 결과 규칙은 기존과 동일하다.
async function fetchMolitPageRaw({ lawdCd, dealYmd, type }: FetchParams, pageNo: number): Promise<MolitRawPage> {
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

  // 알 수 없는 거래 유형이면 endpoint가 빈 문자열로 남아 "?serviceKey=..."라는 상대 URL이
  // 만들어지고, fetch가 "Failed to parse URL from ?serviceKey=<키 전체>"라는 메시지로
  // 실패한다 — 그 메시지가 그대로 에러 플레이스홀더/응답/로그로 흘러 서비스 키가 노출됐다
  // (type은 쿼리스트링으로 외부에서 지정 가능하므로 실제 노출 경로였다). URL을 만들기
  // 전에 명시적으로 막는다.
  if (!endpoint) {
    throw new Error('지원하지 않는 거래 유형입니다.');
  }

  const cleanKey = API_KEY.trim().replace(/['"]/g, '');
  const decodedKey = decodeURIComponent(cleanKey);
  const finalKey = encodeURIComponent(decodedKey);
  // MOLIT_LIVE_PAGING_FIX_V1 — pageNo를 명시한다. 서버 기본값이 1이라 pageNo=1은 기존
  // 요청과 동일한 응답을 주고(대량 fetcher가 이미 같은 형태로 호출해 검증됨), 2페이지
  // 이상을 실제로 읽을 수 있게 된다.
  const url = `${endpoint}?serviceKey=${finalKey}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=${pageNo}&numOfRows=${MOLIT_PAGE_SIZE}`;

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
    
    const parser = createMolitXmlParser();

    const jsonObj = parser.parse(textData);
    
    // Check for OpenAPI error first
    if (jsonObj.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg) {
      throw new Error(`OpenAPI Error: ${jsonObj.OpenAPI_ServiceResponse.cmmMsgHeader.returnAuthMsg}`);
    }

    // MOLIT_LIVE_PAGING_FIX_V1 — 서버가 준 전체 건수. 숫자로 읽히지 않으면 null로 두고
    // 절대 0으로 떨어뜨리지 않는다("모르는 것"과 "0건"은 다르다).
    const totalCountRaw = jsonObj.response?.body?.totalCount;
    const totalCount =
      totalCountRaw != null && Number.isFinite(Number(totalCountRaw)) ? Number(totalCountRaw) : null;

    const items = jsonObj.response?.body?.items?.item;

    if (!items) {
      // If items is empty but resultCode is 00 (Normal), just return empty array
      if (jsonObj.response?.header?.resultCode === '00' || jsonObj.response?.header?.resultCode === 0) {
        return { rawItems: [], totalCount };
      }
      throw new Error(`No items found. Response: ${textData.substring(0, 100)}...`);
    }

    const itemsArray = Array.isArray(items) ? items : [items];

    return { rawItems: itemsArray, totalCount };
}

/**
 * MOLIT_LIVE_PAGING_FIX_V1 §3 — 한 (유형, lawdCd, 월) 셀의 **전체** 행을 읽는다.
 *
 * 기존 라이브 경로는 `numOfRows=1000`만 붙이고 pageNo도 totalCount도 쓰지 않아,
 * 1,000건을 넘는 셀을 조용히 잘라 "이게 전부"인 것처럼 돌려줬다(실측: 서울 강남구
 * 전월세 2026-03 totalCount 2,091 중 1,000건만 노출 — 52.2% 누락). 대량 sync
 * fetcher가 이미 쓰고 있는 검증된 패턴(pageNo → totalCount → 필요한 페이지만)을
 * 그대로 가져온다. 새 아키텍처를 만들지 않는다.
 *
 * 계약:
 * - 1,000건 이하 셀: 페이지 1회 = 수정 전과 완전히 동일한 요청·결과.
 * - 1,000건 초과 셀: 필요한 페이지를 **순서대로** 다 읽어 concat한다.
 * - 페이지 하나라도 최종 실패하면 **부분 결과를 정상처럼 돌려주지 않고** 실패로 알린다
 *   (silent truncation 금지 — 호출부는 기존 '에러' 플레이스홀더 계약으로 부분 실패를 본다).
 * - 각 페이지는 호출부가 준 동일 게이트(runMolitGuarded + ticket)를 **개별로** 통과한다.
 *   ungated Promise.all로 한꺼번에 내보내지 않는다 — 초당 제한 버스트를 악화시키지 않기 위해.
 */
async function fetchAllPagesGuarded(
  params: FetchParams,
  deps: (MolitGuardDeps & { fetchPage?: typeof fetchMolitPageRaw }) | undefined
): Promise<MolitAttemptOutcome<any[]>> {
  const { lawdCd, dealYmd, type } = params;
  const fetchPage = deps?.fetchPage ?? fetchMolitPageRaw;

  // 페이지 1장 = 게이트 1회 통과(슬롯 + 페이싱 + 차단기 + rate-limit 재시도).
  const guardedPage = async (pageNo: number): Promise<MolitAttemptOutcome<MolitRawPage>> => {
    const { outcome } = await runMolitGuarded<MolitRawPage>(async () => {
      try {
        return { ok: true as const, value: await fetchPage(params, pageNo) };
      } catch (error: any) {
        return { ok: false as const, message: String(error?.message ?? '') };
      }
    }, deps);
    return outcome;
  };

  const first = await guardedPage(1);
  if (!first.ok) return first;

  const { rawItems: firstItems, totalCount } = first.value;

  // totalCount를 못 읽은 경우. 1페이지가 상한 미만이면 더 있을 수 없으므로 수정 전과
  // 동일하게 그대로 쓴다. 상한에 닿아 있으면 잘렸는지 아닌지 알 수 없으므로 —
  // 모르는 것을 "전부"라고 말하지 않는다 — 실패로 처리한다.
  if (totalCount === null) {
    if (firstItems.length < MOLIT_PAGE_SIZE) {
      return { ok: true, value: mapMolitItems(firstItems, type, lawdCd, dealYmd) };
    }
    return {
      ok: false,
      message: `MOLIT totalCount를 읽을 수 없어 전체 건수를 확인하지 못했습니다(${firstItems.length}건 수신, 절단 가능).`,
    };
  }

  if (totalCount <= firstItems.length) {
    return { ok: true, value: mapMolitItems(firstItems, type, lawdCd, dealYmd) };
  }

  // 2페이지 이상. 페이지는 순차로만 읽는다(중복 요청 없음, 순서 결정적).
  const totalPages = Math.ceil(totalCount / MOLIT_PAGE_SIZE);
  let rawItems = firstItems;
  for (let pageNo = 2; pageNo <= totalPages; pageNo++) {
    const page = await guardedPage(pageNo);
    if (!page.ok) return page;
    rawItems = rawItems.concat(page.value.rawItems);
  }

  // 페이지를 다 읽었는데도 모자라면 부분이다. 절대 완전한 결과로 위장하지 않는다.
  if (rawItems.length < totalCount) {
    return {
      ok: false,
      message: `MOLIT 응답이 불완전합니다(${rawItems.length}/${totalCount}건, ${totalPages}페이지).`,
    };
  }

  // §13 — 비밀값 없는 계측. 여러 페이지를 실제로 읽은 셀만 남긴다(정상 단일 페이지는 조용히).
  console.log(
    `[molit] paged fetch type=${type} lawdCd=${lawdCd} dealYmd=${dealYmd} totalCount=${totalCount} pagesFetched=${totalPages} fetchedCount=${rawItems.length}`
  );

  // 매핑은 합쳐진 전체 배열에 **한 번만** 적용한다 — id/rank 인덱스가 0..N-1로 이어지도록.
  return { ok: true, value: mapMolitItems(rawItems, type, lawdCd, dealYmd) };
}

// E-JIP MOLIT PARTIAL FAILURE REDUCTION V1 — 모든 호출이 프로세스 단일 게이트
// (인스턴스당 동시성 4 / 슬롯당 250ms + 차단기 + 적응형 쿨다운)를 공유하고, "초당 요청제한"만
// 실패한 이 월 하나에 대해 bounded backoff로 재시도한다(잠금 중에는 호출 없이 실패). 반환 계약은 그대로다: 성공은 거래 배열,
// 정상 0건은 [], 최종 실패는 typeLabel:'에러' 플레이스홀더 1건.
export async function fetchMolitData(params: FetchParams, deps?: MolitFetchDeps) {
  // dedup 키는 **셀 단위**(유형:지역:월)다 — 한 셀의 페이지들은 아래에서 순차로 읽으므로
  // 같은 페이지를 두 번 요청하는 일이 없고, 동시에 같은 셀을 원한 호출부들은 여전히
  // 네트워크 시퀀스 하나를 공유한다.
  return dedupMolitInFlight(`${params.type}:${params.lawdCd}:${params.dealYmd}`, deps?.lane ?? 'interactive', (ticket) =>
    fetchMolitDataGuarded(params, { ...deps, ticket })
  );
}

export type MolitFetchDeps = MolitGuardDeps & {
  /**
   * 레거시 주입 지점(단일 페이지, 이미 매핑된 행 배열을 반환). 기존 테스트가 쓰는 계약을
   * 그대로 유지한다 — 주입되면 페이지네이션 없이 그 결과를 쓴다.
   */
  fetchOnce?: (params: FetchParams) => Promise<any[]>;
  /** 페이지 단위 주입 지점(raw item + totalCount). 페이지네이션 동작을 검증할 때 쓴다. */
  fetchPage?: typeof fetchMolitPageRaw;
};

async function fetchMolitDataGuarded(params: FetchParams, deps?: MolitFetchDeps) {
  const { lawdCd, dealYmd, type } = params;

  // 레거시 단일 페이지 주입이 있으면 기존 경로 그대로(페이지네이션 없음).
  const once = deps?.fetchOnce;
  const outcome = once
    ? (
        await runMolitGuarded<any[]>(async () => {
          try {
            return { ok: true as const, value: await once(params) };
          } catch (error: any) {
            return { ok: false as const, message: String(error?.message ?? '') };
          }
        }, deps)
      ).outcome
    : await fetchAllPagesGuarded(params, deps);

  if (outcome.ok) return outcome.value;

  // 이 메시지는 에러 플레이스홀더 → 라우트 응답(apiError) → 화면/ErrorLog까지 흘러간다.
  // 실패 원인에 따라 요청 URL(=serviceKey 포함)이 그대로 들어있을 수 있으므로 반드시
  // 마스킹한 뒤에만 밖으로 내보낸다. 키 일부를 진단용으로 붙이던 info 필드도 없앴다 —
  // 비밀값 조각을 응답/로그에 남길 이유가 없다.
  const safeMessage = redactMolitFailureMessage(outcome.message);
  console.log(`MOLIT API Error or Timeout (${type}, ${dealYmd}). ${safeMessage}`);
  // Instead of failing silently, return a special error object so the frontend can display it
  return [{
    id: `error-${type}-${lawdCd}-${dealYmd}`,
    rank: 1,
    name: `API 에러: ${safeMessage}`,
    price: '에러',
    priceChange: '',
    changeType: 'new',
    typeLabel: '에러',
    info: '공공데이터 API 호출 실패',
    dong: '오류',
    lat: null,
    lng: null,
  }];
}

// DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5 §3 — fetchMolitData()의 원본 raw-item→최종
// 표시용 shape 매핑을 별도 함수로 뽑아낸 것뿐, 로직/출력은 한 글자도 바꾸지 않았다
// (기존 fetchMolitData() 소비자 전원에게 완전히 동일한 값을 계속 반환한다). 목적은
// 이 매핑을 대량 sync 전용 pagination fetcher(scripts/sale-molit-fetch.ts)에서도
// 그대로 재사용해, "1페이지만 읽는 fetchMolitData"와 "전체 페이지를 읽는 대량 sync
// fetcher"가 서로 다른 매핑 로직을 갖는(그래서 결과 shape이 미묘하게 달라질 위험이
// 있는) 상황을 원천적으로 막기 위함이다.
export function mapMolitItems(itemsArray: any[], type: DataType, lawdCd: string, dealYmd: string) {
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

      // APT_DETAIL_NAME_TYPE_HOTFIX — 후보 우선순위(기존과 동일)는 유지하되, 각 후보를
      // toMolitNameText()로 통과시켜 name이 항상 문자열이 되게 한다. 이 매퍼는
      // fetchMolitData 외에 자체 XMLParser를 쓰는 대량 sync fetcher도 호출하므로
      // (scripts/sale-molit-fetch.ts), 파서 설정과 별개로 여기서도 계약을 지킨다.
      const nameCandidates = [item.아파트, item.aptNm, item.단지, item.단지명, item.offiNm, item.연립다세대, item.mhouseNm];
      const name = nameCandidates.map(toMolitNameText).find((candidate) => candidate !== '') ?? '이름 없음';
      // 어떤 원본 셀에서 비문자열 단지명이 실제로 오는지 알 수 있는 유일한 지점이다.
      // (이 오류를 처음 조사할 때 로그에 요청/원본 정보가 전혀 없어 재현 지역을 특정하지
      // 못했다.) 정상 데이터에서는 한 번도 찍히지 않는다 — 찍히면 그 셀이 재현 조건이다.
      const nonStringCandidate = nameCandidates.find((candidate) => candidate != null && typeof candidate !== 'string');
      if (nonStringCandidate !== undefined) {
        console.warn(
          `[molit] 단지명이 문자열이 아님(${typeof nonStringCandidate}) type=${type} lawdCd=${lawdCd} dealYmd=${dealYmd} aptSeq=${item.aptSeq ?? '-'} umdNm=${item.umdNm ?? '-'} jibun=${item.jibun ?? '-'} value=${JSON.stringify(nonStringCandidate)}`
        );
      }
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
}
