import type { StatsMenuItem } from '../statsMenu';
import type { RegionState } from '@/contexts/RegionContext';

// GLOBAL SHARE SYSTEM V1 §9 — "부산 전체"/"부산 서구"처럼 시도의 행정구역 접미사를 뗀
// 짧은 형태로 공유 제목을 만든다. 없는 값을 추정하지 않고 RegionState가 이미 갖고 있는
// 실제 선택값(sido/sigungu/dong)만 그대로 조합한다.
const SIDO_SUFFIX_RE = /(특별자치시|특별자치도|광역시|특별시|자치도|도)$/;

export function statsRegionShareLabel(region: Pick<RegionState, 'sido' | 'sigungu' | 'dong'>): string {
  const shortSido = region.sido.replace(SIDO_SUFFIX_RE, '') || region.sido;
  if (!region.sigungu) return `${shortSido} 전체`;
  if (region.dong && region.dong !== 'all') return `${shortSido} ${region.sigungu} ${region.dong}`;
  return `${shortSido} ${region.sigungu}`;
}

export interface StatsShareContext {
  title: string;
  text: string;
  params: Record<string, string | undefined>;
}

// 통계 상세 화면 전용 공유 title/text/params를 메뉴 메타데이터(STATS_MENU)와 현재 선택된
// 지역(RegionContext)만으로 만든다. 17개 통계 subtype이 전부 이 헬퍼 하나를 공유해
// 페이지별 bespoke 공유 컴포넌트를 만들지 않는다(§8/§9). params는 통계 지역 상태가
// RegionContext(client-only)에만 있고 URL에는 없어(감사 결과) 공유 링크에서는 잃지
// 않도록 쿼리스트링으로 실어 보낸다.
export function buildStatsShareContext(item: StatsMenuItem, region: RegionState): StatsShareContext {
  return {
    title: `${statsRegionShareLabel(region)} ${item.title} | 이집`,
    text: item.subtitle,
    params: {
      sido: region.sido,
      sidoCode: region.sidoCode,
      sigungu: region.sigungu || undefined,
      dong: region.dong && region.dong !== 'all' ? region.dong : undefined,
      lawdCd: region.lawdCd || undefined,
    },
  };
}
