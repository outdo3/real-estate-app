import type { LucideIcon } from 'lucide-react';
import {
  TrendingDown, Award, TrendingUp, Activity, Scale, LayoutGrid, Coins, Target,
  Construction, Users, AlertTriangle, Plane, Map, Mountain, Building2, Eye, Rows3, Home, TrendingUpDown,
} from 'lucide-react';

// 시장 통계 탭의 17개 메뉴 정의. status: 'live'는 실제 데이터 소스로 계산해서 보여주는
// 메뉴, 'soon'은 이 앱에 아직 연동된 데이터 소스가 없어(인구통계/외지인 매수비율/
// 고도데이터/사용자 조회 로그 등) 임의의 추정치를 지어내는 대신 "데이터 집계 중"
// 안내로 정직하게 비워두는 메뉴다. status는 이후 실제 데이터 소스가 생기면 'live'로
// 바꾸기만 하면 되도록 각 항목에 이유를 코멘트로 남겨둔다.
//
// [STATISTICS V2 §12/§35] icon(emoji)은 <title> 메타데이터(브라우저 탭, page.tsx)
// 전용으로만 남기고 실제 화면 렌더링은 전부 Icon(Lucide)을 쓴다 — BOTTOM_NAV_ITEMS가
// 이미 쓰던 것과 같은 패턴. Home의 QUICK_MENU(home-client.tsx)가 decline/record-high/
// rising/volume/compare/gap-invest에 이미 쓰던 아이콘과 동일하게 맞춰 같은 지표가
// 화면마다 다른 아이콘으로 보이지 않게 했다.
export type StatsCategory = '가격' | '거래' | '수요·공급' | '지역' | '비교·분석';

// [STATISTICS_COLOR_SYSTEM_V1] 카드 아이콘 배경/강조색의 의미 카테고리.
// 상승·신고가=up(빨강), 하락=down(파랑), 위험/주의=warn(주황), 일반 거래·
// 정보=brand(브랜드 그린), 인기/관심=popular(보라). slug/로직 키는 바꾸지
// 않고 표시 색상만 이 필드로 분리한다 — 지정하지 않은 항목(수요·공급/지역/
// 비교·분석 카테고리 등)은 기존과 동일하게 브랜드 그린 기본값을 쓴다(이번
// STEP 적용 대상 7개 카드만 명시적으로 지정).
export type StatsColorToken = 'up' | 'down' | 'warn' | 'brand' | 'popular';

export interface StatsMenuItem {
  slug: string;
  icon: string;
  Icon: LucideIcon;
  title: string;
  subtitle: string;
  status: 'live' | 'soon';
  soonReason?: string;
  category: StatsCategory;
  colorToken?: StatsColorToken;
}

export const STATS_MENU: StatsMenuItem[] = [
  // STATISTICS V2 — REGIONAL TRANSACTION FEED §6/§8: 지역별 실거래를 날짜별로
  // 보여주는 신규 feed. 다른 랭킹류(하락/최고가 등)와 달리 "단지 순위"가 아니라
  // "지역 안에서 실제로 무슨 거래가 있었나"를 먼저 보여주는 진입점이라 거래
  // 카테고리 맨 앞에 둔다.
  { slug: 'feed', icon: '🧾', Icon: Rows3, title: '실거래', subtitle: '지역별 실거래 피드', status: 'live', category: '거래', colorToken: 'brand' },
  { slug: 'decline', icon: '📉', Icon: TrendingDown, title: '하락', subtitle: '하락거래 단지 모음', status: 'live', category: '가격', colorToken: 'down' },
  // FIX_PRICE_RANKINGS_V2_1_1A §6/§7/§8 — 감사 결과 MOLIT 실거래 API가
  // 단지/면적 단위 필터 없이 지역+월 단위로만 조회되어, "역대 진짜 최고가"를
  // 무제한으로 보장할 수 없다(시도 전체 집계에서 fetch 규모가 그대로
  // 폭증하고, 영구 이력 DB는 스키마 변경이 필요해 이번 STEP 범위 밖). 이 화면은
  // 트레일링 24개월(2년) 안에서의 최고가 경신만 판정하므로 무제한을 뜻하는
  // "신고가" 대신 정직하게 범위를 밝힌 "2년최고가"를 쓴다. "최고가"는 향후
  // 별도 기능(예: 84㎡ 절대가격 순위, §8)을 위해 예약해둔다.
  { slug: 'record-high', icon: '🏆', Icon: Award, title: '2년최고가', subtitle: '최근 2년 내 최고가 경신 단지', status: 'live', category: '가격', colorToken: 'up' },
  { slug: 'rising', icon: '📈', Icon: TrendingUp, title: '상승', subtitle: '가격변동 상위 단지', status: 'live', category: '가격', colorToken: 'up' },
  // 84SQM_RANKING_V1 — "국민평형"으로 불리는 전용 84㎡ 계열 실거래 가격 순위.
  // record-high 코멘트(§7/§8)가 예약해둔 자리를 채운다. 하락/상승처럼 방향성
  // 지표가 아니라 절대가격 랭킹이라 colorToken은 up/down이 아닌 brand로 둔다.
  { slug: 'area84', icon: '🏠', Icon: Home, title: '84㎡ 순위', subtitle: '전용 84㎡ 계열 실거래 가격 순위', status: 'live', category: '가격', colorToken: 'brand' },
  // STATISTICS V2.1-3 §2/§15/§19 — "역전세"는 보증금 미반환처럼 확정된
  // 사실을 뜻하는 것으로 오독될 수 있다. 이 화면이 실제로 보여주는 것은
  // "직전 전세 거래보다 가격이 낮아진 단지"일 뿐 역전세(보증금 반환 불능)
  // 여부를 판정하지 않으므로, 메뉴명 자체를 정직한 "전세위험"으로 바꾼다.
  { slug: 'jeonse-risk', icon: '⚠️', Icon: AlertTriangle, title: '전세위험', subtitle: '최근 전세가격이 이전보다 낮아진 단지를 확인해보세요.', status: 'live', category: '가격', colorToken: 'warn' },
  // REGION_PRICE_CHANGE_MAP_V2 — "지역 변동지도". 다른 가격 카테고리 항목은 단지
  // 순위형인 반면 이 메뉴는 대한민국→시도→시군구→읍면동→단지 drill-down이라
  // 성격이 달라 별도 페이지(RegionChangeMapView, slug='change-map')로 분리했다.
  // 기존 slug='price-map'(분위지도, 절대 평당가 5분위 지도)과는 다른 기능이라
  // 그 slug/라우트를 재사용하지 않는다.
  { slug: 'change-map', icon: '🗺️', Icon: TrendingUpDown, title: '변동지도', subtitle: '지역별 아파트 가격 변동률을 지도로 확인해보세요.', status: 'live', category: '가격', colorToken: 'brand' },
  { slug: 'volume', icon: '📊', Icon: Activity, title: '거래량', subtitle: '매매·전월세 거래량', status: 'live', category: '거래', colorToken: 'brand' },
  // STATISTICS V2.1-2 §2/§23 — 감사 결과 이 화면은 실제 사용자 행동(조회/검색/
  // 관심등록 등) 기반 popularity가 아니라 순수 거래건수 랭킹이었다("인기"라는
  // 이름과 보라색은 실제로 없는 신호를 있는 것처럼 보이게 하는 overclaim). 진짜
  // "인기" 기능은 아래 slug='popular'(soon)로 이미 별도 예약돼 있으므로, 이
  // 화면은 실제로 측정한 것 그대로 "거래집중"으로 정정한다. 색상도 popular
  // 보라색 대신 거래 카테고리의 기본 브랜드 그린으로 맞춘다.
  { slug: 'top-traded', icon: '📌', Icon: Target, title: '거래집중', subtitle: '최근 거래가 몰린 단지', status: 'live', category: '거래', colorToken: 'brand' },
  { slug: 'gap-invest', icon: '💰', Icon: Coins, title: '갭투자', subtitle: '최근 갭투자 형태의 거래가 많은 지역과 단지를 확인해보세요.', status: 'live', category: '거래', colorToken: 'brand' },
  // STATISTICS V2.1-4 §4/§8 — 청약홈(Presale) 데이터가 이미 있음을 확인해 입주지도+
  // 공급추이로 live 전환했다(placeholder audit V1 §5/§8 근거). 메뉴명은 §36 지시대로
  // 짧게("공급물량"→"공급").
  { slug: 'supply', icon: '🏗️', Icon: Construction, title: '공급', subtitle: '앞으로 이 지역에 입주할 물량을 확인해보세요.', status: 'live', category: '수요·공급', colorToken: 'brand' },
  {
    slug: 'population',
    icon: '👥',
    Icon: Users,
    title: '인구변화',
    subtitle: '전입·전출 및 세대수 추이',
    status: 'soon',
    soonReason: '지역별 인구·세대수 통계 데이터셋이 아직 연동되지 않았습니다.',
    category: '수요·공급',
  },
  {
    slug: 'foreign-buyer',
    icon: '✈️',
    Icon: Plane,
    title: '외지인비율',
    subtitle: '관외 매수자 거래 비율',
    status: 'soon',
    soonReason: '실거래가 공공데이터에는 매수자 거주지 정보가 포함돼 있지 않습니다.',
    category: '수요·공급',
  },
  { slug: 'price-map', icon: '🗺️', Icon: Map, title: '분위지도', subtitle: '평당가 구간 색상 지도', status: 'live', category: '지역' },
  {
    slug: 'elevation',
    icon: '⛰️',
    Icon: Mountain,
    title: '경사/고도',
    subtitle: '단지별 지형 정보',
    status: 'soon',
    soonReason: '지형 고도·경사도 데이터셋이 아직 연동되지 않았습니다.',
    category: '지역',
  },
  // STATISTICS V2.1-4 §14/§21 — ApartmentMaster(부산)에 이미 세대수 데이터가 있음을
  // 확인해 live 전환했다(placeholder audit V1 §14 근거). V1은 부산 한정 — 다른 지역
  // 선택 시 화면 내부에서 정직하게 unsupported 상태를 보여준다(빈 화면 금지).
  { slug: 'large-complex', icon: '🏢', Icon: Building2, title: '대단지', subtitle: '세대수가 많은 단지를 확인해보세요.(부산)', status: 'live', category: '지역', colorToken: 'brand' },
  { slug: 'compare', icon: '⚖️', Icon: Scale, title: '가격비교', subtitle: '2개 단지 시세 겹쳐보기', status: 'live', category: '비교·분석' },
  { slug: 'multi-compare', icon: '🏘️', Icon: LayoutGrid, title: '여러단지비교', subtitle: '다중 단지 시세 비교', status: 'live', category: '비교·분석' },
  {
    slug: 'popular',
    icon: '👁️',
    Icon: Eye,
    title: '인기단지',
    subtitle: '이집 유저 인기 조회 단지',
    status: 'soon',
    // STATISTICS_PLACEHOLDER_AUDIT_V1 §21 — PageView 로깅(/api/log/view)은 이미 live라 이전
    // 문구("아직 집계하고 있지 않습니다")는 더 이상 정확하지 않다. 실측(2026-08-28): 1,937건/
    // 17일, 단지 연결 469건 — bot/QA 트래픽 필터가 없고 표본이 아직 작아 신뢰 가능한 랭킹으로
    // 쓰기엔 이르다는 것이 이유다.
    soonReason: '방문 기록은 쌓이고 있지만, 신뢰할 수 있는 순위를 보여드리기엔 아직 데이터가 충분하지 않습니다.',
    category: '비교·분석',
  },
];

export const getStatsMenuItem = (slug: string) => STATS_MENU.find((m) => m.slug === slug) || null;

export const STATS_CATEGORIES: StatsCategory[] = ['가격', '거래', '수요·공급', '지역', '비교·분석'];
