import { NextResponse } from 'next/server';
import type { DataType } from '@/lib/api-molit';
import { prisma } from '@/lib/prisma';
import { geocodeApartmentName } from '@/lib/geocode-apt';
import { fetchMolitMonthCached } from '@/lib/molit-month-cache';
import {
  foldMonthResults,
  resolveTradeApiError,
  summarizeTradeCompleteness,
  type MonthFetchOutcome,
} from '@/lib/apt-trade-completeness';
import { logServerError } from '@/lib/log-server-error';
import { resolveStrongIdentityAptSeqs, matchesTradeIdentity, deriveCanonicalAptSeq } from '@/lib/apt-name-match';
import { resolveCanonicalCoords } from '@/lib/apt-canonical-coords';
import {
  excludeCanceled,
  readDetailSaleTradesFromDb,
  resolveDetailAptSeq,
  type DetailTrade,
} from '@/lib/apt-detail-trade-source';

export const dynamic = 'force-dynamic';

// APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX §ADMIN_LOGGING — 부분 실패는 요청당 한 줄만
// 남긴다(월마다 남기면 120개월 요청 하나가 로그 폭풍이 된다). 같은 (type, lawdCd)에 대해
// 5분 안에 반복되는 부분 실패도 한 번만 남긴다 — 스로틀링은 보통 연속으로 발생하므로
// 그대로 두면 같은 사실이 수십 번 기록된다.
const PARTIAL_LOG_THROTTLE_MS = 5 * 60 * 1000;
const lastPartialLogAt = new Map<string, number>();

function shouldLogPartialFailure(key: string, now: number): boolean {
  const previous = lastPartialLogAt.get(key);
  if (previous !== undefined && now - previous < PARTIAL_LOG_THROTTLE_MS) return false;
  if (lastPartialLogAt.size > 500) {
    for (const [k, at] of lastPartialLogAt) {
      if (now - at >= PARTIAL_LOG_THROTTLE_MS) lastPartialLogAt.delete(k);
    }
  }
  lastPartialLogAt.set(key, now);
  return true;
}

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
    // 동시성/재시도 정책은 이번 STEP에서 의도적으로 바꾸지 않는다(§8) — 목적은 실패를
    // 더 많이 성공시키는 게 아니라, 실패를 정직하게 표현하는 것이다.
    const chunkSize = 12; // 1년에 해당하는 12개월씩 끊어서 요청
    // APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX — 월별 성공/실패를 버리지 않고 모은다.
    // 이전에는 실패 월의 에러 플레이스홀더가 그대로 allTrades에 섞여 들어갔고, 단지명
    // 필터에서 조용히 걸러진 뒤 "모든 월이 실패했을 때만" apiError가 켜졌다 — 즉 12개월
    // 중 1개월만 실패하면 그 달의 거래가 통째로 빠진 채 정상 응답처럼 보였다.
    const monthOutcomes: MonthFetchOutcome[] = [];

    for (let i = 0; i < months.length; i += chunkSize) {
      const chunk = months.slice(i, i + chunkSize);
      // 이 라우트는 export const dynamic = 'force-dynamic'이라 fetchMolitData 내부의
      // next:{revalidate:3600} 캐시가 무력화된다(force-dynamic은 모든 fetch를
      // cache:'no-store'로 강제) — lawdCd+월+거래유형 단위로 별도 TTL 캐시를 둬서 같은
      // 지역의 다른 단지를 조회할 때도 이미 받아온 월별 원본 데이터를 재사용한다(과거
      // 실거래는 사실상 불변 데이터이므로 재조회할 이유가 없다). 실패한 월은 이 캐시에
      // 들어가지 않는다(molit-month-cache.ts) — 실패가 1시간 고착되던 경로를 끊는다.
      const results = await Promise.all(
        chunk.map(async (dealYmd) => ({
          dealYmd,
          ...(await fetchMolitMonthCached({ type: type as DataType, lawdCd, dealYmd })),
        }))
      );

      monthOutcomes.push(...results);
    }

    // 실패 월의 플레이스홀더는 거래 목록에 넣지 않고, 원본 실패 사유만 한 번 보존한다
    // (전 월 실패일 때 기존 apiError 메시지로 그대로 쓴다). 순수 함수로 분리해 부분 실패
    // 시나리오(A~E)를 결정적으로 테스트한다 — apt-trade-completeness.test.ts.
    const folded = foldMonthResults(monthOutcomes);
    const allTrades = folded.items;
    const completeness = summarizeTradeCompleteness(folded.cells);

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
    // SEARCH_DETAIL_IDENTITY_HOTFIX_V2 — 위 aptNamesMatch의 느슨한 양방향 부분포함
    // 규칙은 요청한 이름이 완전히 다른 실존 단지명의 부분 문자열일 때도 통과시켜버린다
    // (실측: 해운대구 우동 "경동"(1995년 준공, 지번 974)이 "해운대경동제이드"(2012년
    // 준공, 지번 763) 검색에 섞여 상세페이지 identity 전체가 바뀌는 사고로 이어짐).
    // resolveStrongIdentityAptSeqs()로 이 동 안에 정규화 후 완전히 일치하는 exact
    // match가 있는지 먼저 확인하고, 있으면 그 aptSeq(들)만 인정한다(STRONG_RESULT_
    // PROTECTION) — exact match가 전혀 없을 때만 기존 느슨한 규칙으로 폴백해 정당한
    // 표기차 alias 케이스(예: "명륜아이파크1단지")는 그대로 매칭되게 둔다.
    const strongAptSeqs = resolveStrongIdentityAptSeqs(allTrades, aptName, dong);
    const filteredTrades = allTrades
      .filter(item => {
        if (dong && item.dong !== dong) return false;
        return matchesTradeIdentity(item, aptName, strongAptSeqs);
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
          // DECISION_JOURNEY_V1.1 — 이 값은 matchesTradeIdentity가 이미 검증한(이름+동
          // 기준 strong match) 거래에서 나온 것이므로, 클라이언트가 지도/비교 등 downstream
          // 액션의 canonical identity로 안전하게 재사용할 수 있다(apt-name-match.ts의
          // deriveCanonicalAptSeq 참고).
          aptSeq: item.aptSeq || null,
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

    // ── DB_FIRST_CANCELLATION_TRUST_V1 ─────────────────────────────────────
    // §5 취소 거래는 활성 거래 집합에서 제외한다. 지도(/map)는 예전부터 제외하고
    // 있었는데 상세만 포함하고 있어, 취소된 거래가 최근 실거래/타임라인/최고·최저에
    // 그대로 들어갔다. 두 화면의 규칙을 일치시킨다.
    let activeTrades: DetailTrade[] = excludeCanceled(filteredTrades) as DetailTrade[];
    let tradeDataSource: 'DB' | 'MOLIT' = 'MOLIT';
    let canonicalAptSeqForRead: string | null = null;

    // §3 매매(sale)는 DB를 1차 소스로 쓴다. MOLIT 라이브는 시점에 따라 이미 신고된
    // 거래를 빠뜨리는 것이 실측으로 확인됐고(2026-09-05 계약 건들), DB는 지도·통계·
    // 리포트가 이미 신뢰하는 append-only 소스다.
    //
    // aptSeq를 단일하게 확정하지 못하면 DB를 쓰지 않는다(이름으로 재식별 금지).
    // DB가 0건이면 MOLIT 결과를 그대로 둔다 — DB가 가릴 데이터가 없는 경우뿐이라
    // "MOLIT가 유효한 DB 거래를 덮는" 상황이 만들어지지 않는다(§9).
    if (type === 'apt') {
      try {
        const aptSeq = await resolveDetailAptSeq(prisma, {
          aptSeqParam: searchParams.get('aptSeq'),
          aptName,
          lawdCd,
          dong,
        });
        if (aptSeq) {
          canonicalAptSeqForRead = aptSeq;
          const db = await readDetailSaleTradesFromDb(aptSeq, period);
          if (db.usedDb) {
            activeTrades = db.trades;
            tradeDataSource = 'DB';
          }
        }
      } catch (e) {
        // DB 조회 실패를 "거래 없음"으로 위장하지 않는다 — MOLIT 결과를 그대로 쓴다.
        console.warn('[apt-detail] DB-first 조회 실패, MOLIT 결과 유지:', (e as Error)?.message);
      }
    }

    // 공공데이터 API 자체가 실패한 경우(키 누락/만료 등) 에러 플레이스홀더가 아파트명 필터에서
    // 걸러지면서 "거래 내역 없음"과 구분이 안 되므로, 매 월 전부 실패했는지 여부를 별도로 알려준다.
    // apiError의 의미(=요청한 모든 월이 실패)는 기존과 동일하게 유지한다 — 기존 소비자
    // (apt-client, PriceTrendChart, QA 스크립트)의 동작을 바꾸지 않기 위함이다.
    const apiError = resolveTradeApiError(completeness, folded.upstreamFailureMessage);

    // 일부 월만 실패한 경우(partial)는 apiError로 승격하지 않되, 응답이 "완전한 집계"인
    // 것처럼 보이게 두지도 않는다. 통계 라우트가 이미 쓰는 partial/failedDistricts 표현과
    // 같은 의미의 필드를 추가한다(여기서는 셀 단위가 지역이 아니라 월이라 failedMonths).
    if (completeness.partial && !completeness.allFailed) {
      const throttleKey = `${type}:${lawdCd}`;
      if (shouldLogPartialFailure(throttleKey, Date.now())) {
        const shownMonths = completeness.failedMonths.slice(0, 12).join(',');
        const overflow = completeness.failedMonths.length > 12 ? `+${completeness.failedMonths.length - 12}` : '';
        logServerError(
          `[MOLIT_PARTIAL] source=MOLIT type=${type} lawdCd=${lawdCd} dong=${dong || '-'} period=${period} `
            + `months=${completeness.monthsRequested} ok=${completeness.monthsSucceeded} failed=${completeness.failedMonths.length} `
            + `failedMonths=${shownMonths}${overflow} reason=${(folded.upstreamFailureMessage || 'unknown').slice(0, 120)}`,
          '/api/apt/[name]'
        ).catch(() => {});
      }
    }

    // 클라이언트가 URL에 lawdCd/dong을 안 넘긴 경우, 여기서 실제로 조회에 사용한(DB 조회,
    // 지오코딩 또는 기본값) 값을 함께 돌려줘서 화면의 지역명/이후 요청들이 같은 값으로
    // 맞춰지게 한다.
    // PERCEIVED_PERFORMANCE_V2_DATAFLOW §2 — canonical 좌표를 **여기서 한 번** 해석해
    // 함께 내려보낸다. 예전에는 클라이언트의 인프라 카드 9개가 각자 "지역명 + 단지명"을
    // 지오코딩했고(실측 10/10 실패 → 키워드 검색 첫 결과 채택), 그게 이름 기반 재식별
    // 위험이자 지연의 절반이었다.
    //
    // identity는 이 라우트가 이미 검증한 것만 쓴다: filteredTrades는
    // resolveStrongIdentityAptSeqs/matchesTradeIdentity를 통과한 거래이므로 그 aptSeq는
    // 이 단지의 canonical id다(deriveCanonicalAptSeq는 후보가 하나로 좁혀질 때만 값을
    // 준다). URL이 넘겨준 aptSeq도 그 후보 집합 안에 있을 때만 채택된다.
    //
    // 좌표 조회가 실패해도 거래 응답 자체는 그대로 나간다 — 좌표는 부가 정보이고,
    // 이것 때문에 실거래가 안 보이면 안 된다.
    //
    // §6 — opt-in인 이유: 이 라우트는 상세페이지 한 번에 여러 번 호출된다(parent 1회 +
    // 차트/투자지표의 공유 60개월 창 2회). 좌표를 실제로 쓰는 건 parent 하나뿐인데
    // 무조건 조회하면 ApartmentMaster 조회가 호출 수만큼 배로 늘어난다. 파라미터를
    // 보낸 요청에만 조회한다 — 값이 생기는 조건은 그대로이고 소비자는 parent 하나뿐이라
    // 화면 동작은 바뀌지 않는다.
    const wantsCoordinate = searchParams.get('withCoordinate') === '1';
    let coordinate: unknown = null;
    if (wantsCoordinate) {
      const incomingAptSeq = searchParams.get('aptSeq');
      // DB-first가 이미 canonical aptSeq를 확정했으면 그것을 쓴다(거래 소스와 좌표
      // identity가 갈라지지 않게). 아니면 기존 규칙 그대로.
      const canonicalAptSeq =
        canonicalAptSeqForRead ?? deriveCanonicalAptSeq(filteredTrades, incomingAptSeq);
      try {
        const resolved = await resolveCanonicalCoords(prisma, {
          aptSeq: canonicalAptSeq,
          lawdCd,
          dong,
          name: activeTrades[0]?.name || filteredTrades[0]?.name || aptName,
        });
        coordinate = resolved.status === 'RESOLVED'
          ? resolved.coordinate
          : { status: 'NO_COORDINATE' as const, reason: resolved.reason };
      } catch (e) {
        console.warn('canonical coordinate lookup failed', e);
        coordinate = { status: 'NO_COORDINATE' as const, reason: 'NO_MASTER' as const };
      }
    }

    // §10 — DATA PRESENT와 COVERAGE VERIFIED를 분리한다.
    // DB에서 읽었다면 MOLIT 월별 성공/실패(partial/failedMonths)는 이 거래 목록의
    // 완전성과 무관하므로 그대로 전달하되, 소스를 명시해 소비자가 구분할 수 있게 한다.
    // DB 경로에서는 MOLIT 전월 실패(apiError)가 "거래 없음"으로 읽히면 안 되므로
    // apiError를 승격하지 않는다 — 실제로 거래를 확보했기 때문이다.
    const usedDb = tradeDataSource === 'DB';
    return NextResponse.json({
      trades: activeTrades,
      apiError: usedDb ? null : apiError,
      lawdCd,
      dong,
      ...(wantsCoordinate ? { coordinate } : {}),
      tradeDataSource,
      canceledExcluded: true,
      partial: usedDb ? false : completeness.partial,
      failedMonths: usedDb ? [] : completeness.failedMonths,
      monthsRequested: completeness.monthsRequested,
      monthsSucceeded: completeness.monthsSucceeded,
    });
  } catch (error) {
    console.error('Error fetching trade history:', error);
    // 이 라우트의 에러 로그에는 그동안 요청 정보가 전혀 없어서, 반복 발생한 오류
    // ("raw.replace is not a function")가 어떤 단지/지역/기간에서 재현되는지 사후에
    // 특정할 수 없었다. 경로+쿼리(단지명/lawdCd/dong/type/period)만 함께 남긴다.
    let requestContext = '';
    try {
      const requestUrl = new URL(request.url);
      requestContext = ` [${decodeURIComponent(requestUrl.pathname)}${requestUrl.search}]`;
    } catch { /* URL 파싱 실패 시 컨텍스트 없이 기존과 동일하게 기록한다 */ }
    logServerError(
      `${(error as Error)?.message || 'apt trades route error'}${requestContext}`,
      '/api/apt/[name]',
      (error as Error)?.stack
    ).catch(() => {});
    return NextResponse.json({ error: 'Failed to fetch trade history' }, { status: 500 });
  }
}
