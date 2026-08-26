import { NextResponse } from 'next/server';
import { fetchMolitData } from '@/lib/api-molit';
import { prisma } from '@/lib/prisma';
import { geocodeApartmentName } from '@/lib/geocode-apt';
import { getOrSetCache } from '@/lib/server-cache';
import { logServerError } from '@/lib/log-server-error';
import { aptNamesMatch } from '@/lib/apt-name-match';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const aptName = decodeURIComponent(name);
    const { searchParams } = new URL(request.url);

    // 지도 마커 클릭, 커뮤니티 글 링크처럼 lawdCd/dong을 안 넘기는 진입 경로가 실제로 있다 —
    // 이 경우 무조건 기본 지역(서울 강남구)으로 조회하면 다른 지역 단지는 실거래가 하나도
    // 안 잡혀 "조회 중..."에서 멈추고, 지역명도 강남구로 잘못 표시된다. 또한 dong 없이
    // 이름만으로 조회하면 같은 구 안의 다른 단지(예: 대신푸르지오1차/2차)가 섞인다.
    // (1) 이전에 이 단지명으로 조회되어 DB(apartments)에 저장된 실제 lawdCd/dong이 있는지
    // 먼저 확인하고, (2) 그래도 부족하면 단지명 자체를 지오코딩해서 알아낸다. lawdCd가 이미
    // 확실한 경우(URL 또는 DB) 지오코딩이 엉뚱한 지역의 동명 단지를 찾아버릴 위험이 있으니,
    // 지오코딩 결과의 lawdCd가 이미 알고 있는 lawdCd와 일치할 때만 그 dong을 채택한다.
    let lawdCd = searchParams.get('lawdCd') || '';
    let dong = searchParams.get('dong') || '';

    if (!lawdCd || !dong) {
      try {
        // BUSAN_DATA_UX_AUTOMATED_QA_V1 §L4/식별자 감사에서 실측 발견: lawdCd가 없을 때
        // { name: aptName }만으로 조회하면 지역 제약이 전혀 없어, 같은 이름의 타 지역
        // 단지(실측: "대신롯데캐슬"이 서울 강남구 대치동과 부산 서구 서대신동3가 양쪽에
        // 존재)를 그대로 집어올 수 있다 — 지도 마커 클릭/커뮤니티 글 링크처럼 lawdCd를
        // 안 넘기는 실제 진입 경로에서 재현됨(AGENTS.md "이름만으로 재식별 금지" 위반).
        // lawdCd가 이미 있을 때만(=지역이 좁혀졌을 때만) 이 캐시 조회를 시도한다.
        const cached = lawdCd
          ? await prisma.apartment.findFirst({
              where: { name: aptName, lawdCd },
              select: { lawdCd: true, dong: true },
            })
          : null;
        if (!lawdCd && cached?.lawdCd) lawdCd = cached.lawdCd;
        if (!dong && cached?.dong) dong = cached.dong;
      } catch (e) {
        console.warn('lawdCd/dong DB 조회 실패(DB 미설정 등)', e);
      }
    }

    if (!lawdCd || !dong) {
      const geo = await geocodeApartmentName(aptName);
      if (geo) {
        if (!lawdCd) lawdCd = geo.lawdCd;
        if (!dong && geo.lawdCd === lawdCd) dong = geo.dong;
      }
    }
    lawdCd = lawdCd || '11680';

    const type = searchParams.get('type') || 'apt';

    const periodParam = parseInt(searchParams.get('period') || '36', 10);
    const period = isNaN(periodParam) ? 36 : periodParam;

    // period 개월 치 데이터 생성
    const months = [];
    const now = new Date();
    for (let i = 0; i < period; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      months.push(`${y}${m}`);
    }

    // 공공데이터 API 병렬 호출 (청크 단위로 분할하여 Rate Limit 및 Timeout 방지)
    const chunkSize = 12; // 1년에 해당하는 12개월씩 끊어서 요청
    let allTrades: any[] = [];
    
    for (let i = 0; i < months.length; i += chunkSize) {
      const chunk = months.slice(i, i + chunkSize);
      // 이 라우트는 export const dynamic = 'force-dynamic'이라 fetchMolitData 내부의
      // next:{revalidate:3600} 캐시가 무력화된다(force-dynamic은 모든 fetch를
      // cache:'no-store'로 강제) — lawdCd+월+거래유형 단위로 별도 TTL 캐시를 둬서 같은
      // 지역의 다른 단지를 조회할 때도 이미 받아온 월별 원본 데이터를 재사용한다(과거
      // 실거래는 사실상 불변 데이터이므로 재조회할 이유가 없다).
      const promises = chunk.map(dealYmd =>
        getOrSetCache(`molit:${type}:${lawdCd}:${dealYmd}`, 3600 * 1000, () => fetchMolitData({ type: type as any, lawdCd, dealYmd })).catch(e => {
          console.warn(`Failed to fetch for ${dealYmd}:`, e.message);
          return []; // 에러 시 빈 배열 반환하여 전체 실패 방지
        })
      );
      
      const results = await Promise.all(promises);
      results.forEach(monthlyData => {
        if (Array.isArray(monthlyData)) {
          allTrades = allTrades.concat(monthlyData);
        }
      });
    }

    // 이름만으로는 같은 lawdCd(구/군) 안에 있는 서로 다른 단지가 섞여 잡힐 수 있다 —
    // 예: "롯데캐슬"로 검색하면 "대신롯데캐슬"뿐 아니라 다른 동의 "OO롯데캐슬2차"까지
    // 부분일치로 함께 잡히고, "푸르지오"는 서로 다른 두 단지("대신푸르지오1차" 서대신동2가,
    // "대신푸르지오2차" 서대신동1가)를 동시에 매칭해버리는 걸 실측으로 확인했다. dong은
    // 위에서 URL/DB/지오코딩으로 이미 최대한 확보했으므로, 있으면 그 동에 속한 거래만으로
    // 좁혀서 브랜드명이 겹치는 타 단지 데이터가 섞이는 걸 원천 차단한다.
    // [UI-C1-FIX] 이름 비교 자체는 apt-name-match.ts(공백/아파트 접미사 제거는 기존
    // 그대로, 건물번호 접미사·차수 위치·LG/엘지 alias만 안전하게 보강)로 옮겼다 — 이미
    // 매칭되던 쌍을 깨뜨리지 않고 표기 차이만 추가로 흡수하는 상위집합이라 이 라우트를
    // 쓰는 다른 진입 경로(지도, 직접 URL 등)에도 안전하다(회귀 없이 매칭만 넓어짐).
    const filteredTrades = allTrades
      .filter(item => {
        if (!item.name) return false;
        if (dong && item.dong !== dong) return false;
        return aptNamesMatch(item.name, aptName);
      })
      .map(item => {
        const priceStr = item.price;
        // dealAmount(만원 단위 정수)를 직접 사용한다. priceStr("1억"처럼 만 단위 나머지가 없는 문자열)을
        // 정규식으로 재파싱하던 이전 fallback은 자릿수를 잘못 이어붙여 1/10000로 계산되는 버그가 있었다.
        const priceNum = item.dealAmount ? item.dealAmount / 10000 : 0;

        const dateParts = item.info.split('•');
        const tradeDateStr = dateParts[dateParts.length - 1].trim();

        return {
          id: item.id,
          // 실제 국토부 데이터상의 단지명(대표명) — 플랫폼마다 표기가 다를 수 있는 검색어
          // (예: "금호어울림" vs "서대신금호어울림")와 무관하게, 상세페이지 상단 표기는
          // 항상 이 값으로 통일한다.
          name: item.name,
          tradeDate: tradeDateStr,
          price: priceNum,
          priceStr: priceStr,
          area: dateParts[0]?.trim() || '',
          floor: parseInt(dateParts[1]?.trim() || '0'),
          tradeType: item.typeLabel,
          dong: item.dong || '',
          buildYear: item.buildYear || '',
          jibun: item.jibun || '',
          monthlyRent: item.monthlyRent || 0,
          registryDate: item.registryDate || '',
          dealCanceled: item.dealCanceled || false,
          cancelDate: item.cancelDate || '',
        };
      });

    // 날짜 최신순 정렬
    filteredTrades.sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());

    // 공공데이터 API 자체가 실패한 경우(키 누락/만료 등) 에러 플레이스홀더가 아파트명 필터에서
    // 걸러지면서 "거래 내역 없음"과 구분이 안 되므로, 매 월 전부 실패했는지 여부를 별도로 알려준다.
    const errorMonths = allTrades.filter(item => item.typeLabel === '에러').length;
    const apiError = months.length > 0 && errorMonths >= months.length
      ? (allTrades.find(item => item.typeLabel === '에러')?.name.replace(/^API 에러: /, '') || '공공데이터 API 호출에 실패했습니다.')
      : null;

    // 클라이언트가 URL에 lawdCd/dong을 안 넘긴 경우, 여기서 실제로 조회에 사용한(DB 조회,
    // 지오코딩 또는 기본값) 값을 함께 돌려줘서 화면의 지역명/이후 요청들이 같은 값으로
    // 맞춰지게 한다.
    return NextResponse.json({ trades: filteredTrades, apiError, lawdCd, dong });
  } catch (error) {
    console.error('Error fetching trade history:', error);
    logServerError((error as Error)?.message || 'apt trades route error', '/api/apt/[name]', (error as Error)?.stack).catch(() => {});
    return NextResponse.json({ error: 'Failed to fetch trade history' }, { status: 500 });
  }
}
