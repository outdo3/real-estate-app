// 시장 통계 탭의 16개 메뉴 정의. status: 'live'는 실거래가 API로 실제 계산해서 보여주는
// 메뉴, 'soon'은 이 앱에 아직 연동된 데이터 소스가 없어(입주예정물량/인구통계/외지인
// 매수비율/고도데이터/사용자 조회 로그 등) 임의의 추정치를 지어내는 대신 "데이터 집계 중"
// 안내로 정직하게 비워두는 메뉴다. status는 이후 실제 데이터 소스가 생기면 'live'로
// 바꾸기만 하면 되도록 각 항목에 이유를 코멘트로 남겨둔다.
export interface StatsMenuItem {
  slug: string;
  icon: string;
  title: string;
  subtitle: string;
  status: 'live' | 'soon';
  soonReason?: string;
}

export const STATS_MENU: StatsMenuItem[] = [
  { slug: 'decline', icon: '📉', title: '최근하락', subtitle: '하락거래 단지 모음', status: 'live' },
  { slug: 'record-high', icon: '🏆', title: '최고가', subtitle: '최근 신고가 단지', status: 'live' },
  { slug: 'rising', icon: '📈', title: '최고상승', subtitle: '가격변동 상위 단지', status: 'live' },
  { slug: 'volume', icon: '📊', title: '거래량', subtitle: '매매·전월세 거래량', status: 'live' },
  { slug: 'compare', icon: '⚖️', title: '가격비교', subtitle: '2개 단지 시세 겹쳐보기', status: 'live' },
  { slug: 'multi-compare', icon: '🏘️', title: '여러단지비교', subtitle: '다중 단지 시세 비교', status: 'live' },
  { slug: 'gap-invest', icon: '💰', title: '갭투자', subtitle: '매매-전세 갭 적은 단지', status: 'live' },
  { slug: 'top-traded', icon: '🛒', title: '많이산단지', subtitle: '거래량 집중 인기 단지', status: 'live' },
  {
    slug: 'supply',
    icon: '🏗️',
    title: '공급물량',
    subtitle: '입주 예정 물량',
    status: 'soon',
    soonReason: '연도별 입주예정 물량 데이터셋이 아직 연동되지 않았습니다.',
  },
  {
    slug: 'population',
    icon: '👥',
    title: '인구변화',
    subtitle: '전입·전출 및 세대수 추이',
    status: 'soon',
    soonReason: '지역별 인구·세대수 통계 데이터셋이 아직 연동되지 않았습니다.',
  },
  { slug: 'jeonse-risk', icon: '⚠️', title: '역전세', subtitle: '전세가 하락 위험 단지', status: 'live' },
  {
    slug: 'foreign-buyer',
    icon: '✈️',
    title: '외지인비율',
    subtitle: '관외 매수자 거래 비율',
    status: 'soon',
    soonReason: '실거래가 공공데이터에는 매수자 거주지 정보가 포함돼 있지 않습니다.',
  },
  { slug: 'price-map', icon: '🗺️', title: '분위지도', subtitle: '평당가 구간 색상 지도', status: 'live' },
  {
    slug: 'elevation',
    icon: '⛰️',
    title: '경사/고도',
    subtitle: '단지별 지형 정보',
    status: 'soon',
    soonReason: '지형 고도·경사도 데이터셋이 아직 연동되지 않았습니다.',
  },
  {
    slug: 'large-complex',
    icon: '🏢',
    title: '대단지',
    subtitle: '1,000세대 이상 단지',
    status: 'soon',
    soonReason: '단지별 세대수는 현재 단지 상세페이지에서 개별 조회만 가능해, 지역 전체를 한 번에 집계하지 못합니다.',
  },
  {
    slug: 'popular',
    icon: '👁️',
    title: '인기단지',
    subtitle: '이집 유저 인기 조회 단지',
    status: 'soon',
    soonReason: '단지별 조회수를 아직 집계하고 있지 않습니다.',
  },
];

export const getStatsMenuItem = (slug: string) => STATS_MENU.find((m) => m.slug === slug) || null;
