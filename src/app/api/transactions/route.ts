import { NextResponse } from 'next/server';
import { fetchMolitData, formatKoreanPrice, redactMolitFailureMessage, DataType } from '@/lib/api-molit';
import { prisma } from '@/lib/prisma';
import { buildMasterCoordIndex, resolveApartmentCoords, type MasterCoordRow } from '@/lib/map-marker-coords';
import { aptNamesMatch } from '@/lib/apt-name-match';
import { recentMonths } from '@/lib/molit-months';
import { resolveTrustworthyPyeongBatch, pyeongLookupKeyId, type PyeongLookupKey } from '@/lib/statistics-pyeong-resolver';
import { queryTrades } from '@/lib/trade-history-read';
import { getOrSetCache } from '@/lib/server-cache';
import { getMasterCoords } from '@/lib/master-coords-cache';
import {
  classifyMolitMonthResult,
  foldMonthResults,
  summarizeTradeCompleteness,
  type MonthFetchOutcome,
} from '@/lib/apt-trade-completeness';

// MAP_PERFORMANCE_V1 — 이 route가 지도(map/page.tsx)·분위지도(stats type-client.tsx)·
// AI 검색 조건검색(ai-search.ts runConditionSearch) 3곳 모두에서 정확히 같은 모양
// (`type=apt&lawdCd=X&months=12`, dong/loadMore 없음)으로만 호출된다는 것을 실제
// 호출부 전수 확인으로 검증했다. 이 정확한 모양일 때만 부산 지역에 한해 DB-first로
// 전환한다(TRADE_DB_FIRST_V1 STEP A/AREA84 SQL PUSHDOWN과 동일한 "정확히 알려진 모양만
// 좁혀서 전환" 원칙 — 다른 파라미터 조합은 기존 MOLIT-live 경로를 그대로 탄다, 회귀 없음).
// 지도의 첫 마커 로드가 이 route를 기다리는 동안 실측 3.6~4.5s가 걸렸는데(부산 16개 구
// 중 큰 구는 더 심함), 원인은 이 route가 이미 완성된 apartment_trade_histories DB를 전혀
// 쓰지 않고 12개월치 MOLIT 실시간 호출(월별 병렬)을 그대로 하고 있었기 때문이다.
// PERCEIVED_PERFORMANCE_V2_1 §2 — 마커 응답의 CDN 캐시.
//
// 실측(배포 후): fields=marker 응답은 해운대구 기준 63,660 B로 줄었지만
// `x-vercel-cache: MISS`가 100%였다 — Next의 동적 라우트 기본값이
// `max-age=0, must-revalidate`라 CDN이 아무것도 보관하지 않는다. 같은 구를 보는
// 사용자가 매번 원본까지 간다는 뜻이다.
//
// 정책은 /api/transit/bus-stops(QUICK WIN B)에서 이미 검증된 것을 그대로 쓴다:
// **완전하게 성공한 응답만** 캐시하고, 부분 실패/실패는 절대 캐시하지 않는다.
// 실패를 CDN에 얹으면 "성공한 빈 결과"가 TTL 동안 굳어져 FAILED가 ZERO로 접힌다.
//
// TTL 근거: 이 응답은 실거래에서 파생된다. 원천인 MOLIT 월 캐시가 1시간이고
// (molit-month-cache.ts), 상세페이지의 클라이언트 캐시가 5분이다. 같은 값으로
// 맞춰 **s-maxage=300**을 쓴다 — 서버가 같은 순간에 돌려줬을 값보다 더 오래된 값을
// 만들지 않으면서, 지도에서 같은 구를 보는 사용자들 사이의 히트를 얻는다.
// stale-while-revalidate=1800은 갱신 중에도 화면이 비지 않게 한다(값의 나이는
// 최대 30분이며, 취소/신규 거래 반영이 그만큼 늦어질 수 있음을 감수한 범위다).
//
// 캐시 키는 Vercel CDN이 **전체 URL(쿼리스트링 포함)**로 잡으므로 lawdCd·type·
// months·fields가 자동으로 키에 들어간다 — 구/옵션 간 교차 오염이 구조적으로 없다.
// 이 라우트는 인증/쿠키/사용자별 데이터를 일절 읽지 않는다(전수 확인).
const MARKER_SUCCESS_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=1800';
const NO_STORE_CACHE_CONTROL = 'no-store';

/** 완전하게 성공한 응답에만 CDN 캐시를 허용한다. */
function cacheHeaders(fullySuccessful: boolean) {
  return { 'Cache-Control': fullySuccessful ? MARKER_SUCCESS_CACHE_CONTROL : NO_STORE_CACHE_CONTROL };
}

const BUSAN_SIDO_CODE = '26';

async function fetchApt12MonthsFromDb(lawdCd: string): Promise<any[]> {
  const from = new Date();
  from.setMonth(from.getMonth() - 12);
  // SUPABASE_EGRESS_P0_FIX_V1 — 이 호출부는 meta를 전혀 쓰지 않는다(구조분해가 trades만
  // 꺼낸다). 기본값이면 동일 where로 MAX(dealDate) aggregate가 한 번 더 실행돼, 부산 구
  // 단위 12개월 스캔을 매 요청마다 두 번 하게 된다 — 감사에서 PROVEN된 낭비라 끈다.
  const { trades } = await queryTrades({ lawdCd, from, withLatestDealDate: false });
  return trades.map((t) => {
    const areaNum = Number(t.exclusiveArea);
    const tradeDate = t.dealDate.toISOString().slice(0, 10);
    return {
      id: `db-apt-${t.id}`,
      rank: 0,
      name: t.aptName,
      price: formatKoreanPrice(t.dealAmount),
      dealAmount: t.dealAmount,
      monthlyRent: 0,
      priceChange: '',
      changeType: 'new',
      typeLabel: '실거래',
      dong: t.dong,
      buildYear: t.buildYear != null ? String(t.buildYear) : '',
      jibun: t.jibun || '',
      dealCanceled: t.dealCanceled,
      aptSeq: t.aptSeq,
      area: `${areaNum}m²`,
      areaNum,
      floor: t.floor ?? 0,
      tradeDate,
    };
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const changeType = searchParams.get('changeType');
    const type = searchParams.get('type') as DataType;
    const lawdCd = searchParams.get('lawdCd');
    const dong = searchParams.get('dong');
    const loadMore = parseInt(searchParams.get('loadMore') || '0', 10);
    // 지도 마커처럼 "최근 3개월에 거래가 없어도 그 단지의 가장 최근 실거래로라도 마커를
    // 띄워야" 하는 호출부를 위한 단발성 넓은 윈도우. loadMore 기반 페이지네이션과는
    // 별개 파라미터라 기존 호출부(홈 화면 "더보기")는 영향받지 않는다.
    const monthsParam = searchParams.get('months');

    // 1. type과 lawdCd가 있으면 국토부 API 실시간 호출(단, 아래 조건에 맞으면 DB-first)
    if (type && lawdCd) {
      // MAP_PERFORMANCE_V1 — 지도/분위지도/AI조건검색이 실제로 쓰는 정확히 이 모양
      // (apt, 12개월, dong/loadMore 없음)이고 부산 지역이면 DB-first. 캐시는 기존
      // getOrSetCache 재사용(신규 인프라 없음), TTL 30분 — Score/area84가 이미 쓰는
      // "배치 갱신 데이터라 30분 지연은 문제 없음" 원칙과 동일.
      const isMapMarkerShape = type === 'apt' && monthsParam === '12' && loadMore === 0 && (!dong || dong === 'all');
      const isDbFirstEligible = isMapMarkerShape && lawdCd.startsWith(BUSAN_SIDO_CODE);

      let data: any[];
      let usedDbFirst = false;
      // TRANSACTIONS_API_TRUST_V1 — 이 응답이 "요청한 기간 전체를 실제로 읽은 결과"인지
      // 소비자가 알 수 있어야 한다. DB 경로는 단일 쿼리라 성공 아니면 throw(=500)이므로
      // 부분 상태가 없다. MOLIT 경로만 월 단위로 부분 실패할 수 있다.
      let completeness = { partial: false, failedMonths: [] as string[], monthsRequested: 0, monthsSucceeded: 0 };

      if (isDbFirstEligible) {
        data = await getOrSetCache(`transactions-apt-12mo-db:${lawdCd}`, 30 * 60 * 1000, () => fetchApt12MonthsFromDb(lawdCd));
        usedDbFirst = true;
        // DB 경로: 12개월 창을 한 번의 쿼리로 읽는다. 실패는 예외로 드러나므로 여기까지
        // 왔다는 것은 그 창을 온전히 읽었다는 뜻이다(행이 0건이어도 "검증된 0건").
        completeness = { partial: false, failedMonths: [], monthsRequested: 12, monthsSucceeded: 12 };
      } else {
        // loadMore=0 -> offset=0 (last 3 months)
        // loadMore=1 -> offset=3 (previous 3 months)
        const months = monthsParam
          ? recentMonths(Math.max(1, parseInt(monthsParam, 10) || 3), 0)
          : recentMonths(3, loadMore * 3);

        // 공공데이터 API 병렬 호출 (속도 개선)
        // fetchMolitData는 실패해도 throw하지 않고 typeLabel:'에러' 플레이스홀더 1건을
        // 반환한다. 예전에는 그 플레이스홀더가 그대로 data에 섞여 응답으로 나갔고, 좌표/
        // 평형이 없다는 이유로 소비자에서 조용히 걸러져 "그 달은 원래 거래가 없었다"와
        // 구분되지 않았다 — 12개 월을 동시에 호출하는 경로라(초당 제한에 걸리기 쉽다)
        // 실제로 일어날 수 있는 과소집계였다. /api/apt/[name]가 이미 쓰는 판정 함수를
        // 그대로 재사용해 월별 성공/실패를 보존한다(새 의미 만들지 않음).
        const promises = months.map(dealYmd => fetchMolitData({ lawdCd, dealYmd, type }));
        const results = await Promise.all(promises);
        const outcomes: MonthFetchOutcome[] = months.map((dealYmd, i) => ({
          dealYmd,
          items: results[i],
          status: classifyMolitMonthResult(results[i]),
        }));
        // 실패 월의 플레이스홀더는 거래 배열에 넣지 않는다(가짜 행 제거).
        const folded = foldMonthResults(outcomes);
        data = folded.items;
        const summary = summarizeTradeCompleteness(folded.cells);
        completeness = {
          partial: summary.partial,
          failedMonths: summary.failedMonths,
          monthsRequested: summary.monthsRequested,
          monthsSucceeded: summary.monthsSucceeded,
        };
      }

      if (dong && dong !== 'all') {
        data = data.filter((item: any) => item.dong === dong);
      }

      // 정렬/표시용 필드 보강: info 문자열("면적 • 층 • 계약일")에서 층·계약일자를
      // 파싱한다 (api/apt/[name]/route.ts와 동일한 규칙). 여러 달치 데이터를 합친 뒤이므로
      // 단순 배열 순서로는 최신순이 보장되지 않아, 실제 계약일자 기준으로 명시적으로 정렬한다.
      // DB-first 경로는 fetchApt12MonthsFromDb()가 이미 area/floor/tradeDate/areaNum을
      // 최종 형태로 채워뒀으므로(가짜 .info 문자열을 만들어 다시 파싱하는 왕복 금지) 이
      // 재파싱 단계를 건너뛴다.
      // FIX_STATISTICS_DATA_TRUST — 예전에는 `areaNum / 3.3058`로 "평형"을 만들어
      // 그대로 내려줬다(가짜 평형, AGENTS.md Unit Master 보호 원칙 위반). 이제
      // raw ㎡만 파싱하고, pyung은 아래에서 Unit Master를 batch 조회해서만 채운다
      // (없으면 null — raw ㎡만 표시).
      if (!usedDbFirst) {
        data = data.map((item: any) => {
          const infoParts = (item.info || '').split('•');
          const area = infoParts[0]?.trim() || '';
          const floor = parseInt(infoParts[1]?.trim() || '0', 10) || 0;
          const tradeDate = infoParts[infoParts.length - 1]?.trim() || '';
          const areaNum = parseFloat(area) || null;
          return { ...item, area, floor, tradeDate, areaNum };
        });
      }

      {
        const lookupKeys = new Map<string, PyeongLookupKey>();
        for (const item of data as any[]) {
          if (item.areaNum == null) continue;
          const key: PyeongLookupKey = { name: item.name, dong: item.dong || '', aptSeq: item.aptSeq ?? null, rawAreaM2: item.areaNum };
          lookupKeys.set(pyeongLookupKeyId(key), key);
        }
        const pyeongMap = await resolveTrustworthyPyeongBatch(prisma, Array.from(lookupKeys.values()));
        data = data.map((item: any) => {
          if (item.areaNum == null) return { ...item, pyung: null };
          const key: PyeongLookupKey = { name: item.name, dong: item.dong || '', aptSeq: item.aptSeq ?? null, rawAreaM2: item.areaNum };
          return { ...item, pyung: pyeongMap.get(pyeongLookupKeyId(key)) ?? null };
        });
      }

      data.sort((a: any, b: any) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());

      // 지도 마커(단지 칩) 표시를 위해 아파트 매매(apt)·분양권(silv) 데이터에 한해 좌표 보강.
      // MAP_SURROUNDING_MARKER_PERFORMANCE_V1: 이전에는 단지별로 Kakao 키워드 지오코딩을
      // N회 호출해 좌표를 얻었다(N+1 외부 API, 실측 지연 592ms~5.76s). ApartmentMaster가
      // 이미 이 지역 단지 전체의 검증된 좌표(Kakao geocoding 결과를 사전에 저장한 canonical
      // source, Busan coverage 100%)를 갖고 있으므로 외부 API 호출 없이 단일 DB 쿼리로
      // 대체한다.
      if ((type === 'apt' || type === 'silv') && data.length > 0) {
        // SUPABASE_EGRESS_P1 — 이 조회는 select는 좁았지만 이 route의 getOrSetCache
        // **바깥**이라 매 요청 실행됐고, 감사에서 sgg_cd 조회 45,225회/약 3.9GB의 한
        // 축으로 확인됐다. 인스턴스 간 공유되는 캐시로 옮긴다(master-coords-cache.ts).
        const masters: MasterCoordRow[] = await getMasterCoords(lawdCd);

        // 실측(연산동 26470, 207개 단지): dong+name 완전일치만으로 206건이 이미 매칭됐지만
        // Kakao 지오코딩은 그중 19건에서 실패했었다(오래된/소규모 단지, 지번 병기 표기 등) —
        // ApartmentMaster는 그 19건 전부 유효 좌표를 갖고 있어 이 교체만으로 marker coverage가
        // 오히려 개선된다. 매칭/좌표 결합 규칙 자체는 src/lib/map-marker-coords.ts(순수 함수,
        // 단위 테스트 있음)에 있다.
        const masterIndex = buildMasterCoordIndex(masters);
        const fuzzyCache = new Map<string, MasterCoordRow | null>();

        data = data.map((item: any) => {
          const resolved = resolveApartmentCoords(masterIndex, item.dong, item.name, aptNamesMatch, fuzzyCache);
          return { ...item, ...resolved };
        });
      }

      // PERCEIVED_PERFORMANCE_V2_DATAFLOW §8 — 지도 마커 전용 슬림 응답(opt-in).
      //
      // 실측: 해운대구 12개월 응답은 4,579행 / 1,822,597 B인데 실제 마커가 되는 단지는
      // 276개뿐이고, 마커에 쓰이는 필드는 11개다 — 나머지 94%는 클라이언트가 받아서
      // 곧바로 버린다(4G에서 다운로드에만 1.0~2.5초).
      //
      // 왜 기본 동작을 바꾸지 않고 opt-in인가: 이 라우트의 소비자 3곳은 **서로 다른
      // dedup 규칙**을 쓴다.
      //   /map            좌표 없음 + 취소 건 제외 → 단지별 최신 1건
      //   /stats/[type]   좌표/평형 없음 제외      → 단지별 최신 1건
      //   ai-search       취소 건을 제외하지 않음  → 단지별 최신 1건
      // 그래서 공용 응답을 "단지별 1건"으로 줄이면 최소 두 소비자의 의미가 조용히
      // 달라진다. fields=marker는 **/map의 규칙을 서버에서 그대로 재현**하므로 그
      // 화면에서는 결과가 완전히 동일하고, 다른 소비자는 기존 응답을 그대로 받는다.
      if (searchParams.get('fields') === 'marker') {
        const byComplex = new Map<string, any>();
        for (const item of data as any[]) {
          if (!item.lat || !item.lng) continue;     // /map과 동일
          if (item.dealCanceled) continue;          // /map과 동일(취소 가격 표시 금지)
          const key = `${item.dong}|${item.name}`;
          if (!byComplex.has(key)) byComplex.set(key, item);
        }
        const markers = Array.from(byComplex.values()).map((item: any) => ({
          aptSeq: item.aptSeq ?? null,
          completionYear: item.completionYear ?? null,
          name: item.name,
          dong: item.dong || '',
          price: item.price ?? '',
          dealAmount: typeof item.dealAmount === 'number' ? item.dealAmount : null,
          pyung: typeof item.pyung === 'number' ? item.pyung : null,
          // 마커의 면적 라벨은 이 필드를 그대로 쓴다 — 값이 없으면 없는 대로 둔다
          // (여기서 areaNum 등으로 대체하면 화면 표기가 바뀐다).
          excluUseArea: typeof item.excluUseArea === 'number' ? item.excluUseArea : null,
          lat: item.lat,
          lng: item.lng,
          // 소비자가 취소 여부를 다시 판단할 수 있게 남긴다(값은 항상 false다).
          dealCanceled: false,
        }));
        // 부분 실패(partial)면 캐시하지 않는다 — 일시적 MOLIT 실패가 CDN에 굳으면
        // 그 구의 마커가 TTL 동안 계속 적게 보인다.
        return NextResponse.json(
          { transactions: markers, ...completeness },
          { headers: cacheHeaders(!completeness.partial) }
        );
      }

      // TRANSACTIONS_API_TRUST_V1 — bare array였던 응답을 envelope으로 바꾼다. 완전성을
      // 담을 자리가 없어서 부분 실패를 말할 방법 자체가 없었다. 소비자는 공유 리더
      // (resolveTransactionsReadState)를 쓰며, 그 리더는 배열도 계속 받아들이므로
      // 배포 중 버전이 잠시 어긋나도 화면이 깨지지 않는다.
      return NextResponse.json(
        { transactions: data, ...completeness },
        { headers: cacheHeaders(!completeness.partial) }
      );
    }

    // 2. 파라미터가 없으면 기존 DB 데이터(TOP 5) 반환
    const transactions: any[] = [];

    return NextResponse.json({ transactions, partial: false, failedMonths: [], monthsRequested: 0, monthsSucceeded: 0 });
  } catch (error) {
    // TRANSACTIONS_API_TRUST_V1 §9 — 응답 body는 원래부터 고정 문구라 유출 경로가 아니다.
    // 로그만 원본 error 객체를 통째로 찍고 있었는데, 이 라우트는 MOLIT 호출과 DB 조회를
    // 모두 거치므로 실패 메시지에 요청 URL/접속 정보가 담길 수 있다. 다른 공공데이터
    // 경로와 동일하게 공유 마스킹 함수를 통과시킨다.
    console.error('Failed to fetch transactions:', redactMolitFailureMessage((error as Error)?.message));
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500, headers: cacheHeaders(false) });
  }
}
