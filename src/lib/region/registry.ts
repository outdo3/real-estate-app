// REGION_REGISTRY_V1 — 시도/시군구/일반구 계층의 **단일 정본(canonical source)**.
//
// 왜 만드는가: 같은 법정동코드 목록이 여러 파일에 각자 하드코딩돼 있었고(부산 16개 코드가
// 3곳), `REGION_DATA`(regions.ts)는 이름만 있고 lawdCd도 일반구 계층도 없다. 그래서
// "경기 성남시"와 "경기 성남시 분당구"를 구분할 수 없었다 —
// SEOUL_GYEONGGI_EXPANSION_DATA_AUDIT_V1 §2가 확장 blocker로 지목한 구조 갭이다.
//
// 데이터 출처: 이 프로젝트가 이미 쓰고 있는 법정동코드 프록시(REGCODE_PROXY)에서 시군구
// 레벨(`{sido}*00000`)을 조회해 생성했다(2026-09-16 실측). 이름을 추측하거나 코드를
// 만들어내지 않았다. 부산 16개는 기존 report/region-scope.ts의 실측값과 완전히 일치한다.
//
// **이 파일은 "지역이 존재한다"만 말한다.** 서비스 공개 여부(app/report/stats/sitemap/
// SEO/cron)는 전혀 다른 문제이며 enablement.ts가 따로 관리한다 — registry에 서울·경기가
// 들어갔다는 것은 출시가 아니다(§13).
//
// 이 파일은 DB 모델이 아니라 정적 config다. prisma/fs/네트워크를 import하지 않는다.

/**
 * 지역 종류.
 * - METROPOLITAN_DISTRICT: 특별시·광역시의 자치구 (서울 강남구, 부산 서구)
 * - CITY: 시 (경기 김포시, 경기 성남시)
 * - COUNTY: 군 (부산 기장군, 경기 양평군)
 * - GENERAL_DISTRICT: 시 아래의 일반구 (경기 성남시 분당구)
 */
export type RegionType = 'METROPOLITAN_DISTRICT' | 'CITY' | 'COUNTY' | 'GENERAL_DISTRICT';

export interface RegionSido {
  /** 법정동코드 앞 2자리. */
  code: string;
  /** 정식 명칭. REGION_DATA(regions.ts)의 키와 같은 표기. */
  name: string;
  /** 축약 표기. ApartmentMaster.sido가 쓰는 값과 같다(예: '부산'). */
  shortName: string;
}

export interface RegionNode {
  /** 5자리 시군구 코드(= MOLIT LAWD_CD 자리). */
  lawdCd: string;
  /** 표시용 짧은 이름. 예: '서구', '분당구', '김포시'. */
  name: string;
  /** 시도까지 포함한 전체 명칭. 예: '경기도 성남시 분당구'. */
  fullName: string;
  sidoCode: string;
  type: RegionType;
  /** 일반구면 상위 시의 lawdCd, 그 외 null. */
  parentLawdCd: string | null;
  /**
   * MOLIT 실거래 API를 이 코드로 직접 조회할 수 있는가.
   *
   * 일반구를 가진 시(수원/성남/안양/안산/고양/용인)의 **부모 코드는 false**다. 부모 코드로
   * 호출하면 자식 일반구와 중복 수집될 위험이 있어, 수집은 항상 leaf 단위로만 한다
   * (MOLIT_QUOTA_SCALE_PROBE_V1 §6의 "부모 시 코드 제외, leaf 42개" 근거).
   */
  isMolitLeaf: boolean;
}

export const REGION_SIDOS: readonly RegionSido[] = [
  { code: '26', name: '부산광역시', shortName: '부산' },
  { code: '11', name: '서울특별시', shortName: '서울' },
  { code: '41', name: '경기도', shortName: '경기' },
] as const;

/**
 * 시군구 노드 전체. lawdCd는 유일하며, 순서는 시도(부산→서울→경기) 내 코드 오름차순이다
 * (결정론적 출력 보장). 생성 근거는 파일 상단 주석 참고.
 */
export const REGION_NODES: readonly RegionNode[] = [
  { lawdCd: '26110', name: '중구', fullName: '부산광역시 중구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26140', name: '서구', fullName: '부산광역시 서구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26170', name: '동구', fullName: '부산광역시 동구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26200', name: '영도구', fullName: '부산광역시 영도구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26230', name: '부산진구', fullName: '부산광역시 부산진구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26260', name: '동래구', fullName: '부산광역시 동래구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26290', name: '남구', fullName: '부산광역시 남구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26320', name: '북구', fullName: '부산광역시 북구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26350', name: '해운대구', fullName: '부산광역시 해운대구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26380', name: '사하구', fullName: '부산광역시 사하구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26410', name: '금정구', fullName: '부산광역시 금정구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26440', name: '강서구', fullName: '부산광역시 강서구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26470', name: '연제구', fullName: '부산광역시 연제구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26500', name: '수영구', fullName: '부산광역시 수영구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26530', name: '사상구', fullName: '부산광역시 사상구', sidoCode: '26', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '26710', name: '기장군', fullName: '부산광역시 기장군', sidoCode: '26', type: 'COUNTY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11110', name: '종로구', fullName: '서울특별시 종로구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11140', name: '중구', fullName: '서울특별시 중구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11170', name: '용산구', fullName: '서울특별시 용산구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11200', name: '성동구', fullName: '서울특별시 성동구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11215', name: '광진구', fullName: '서울특별시 광진구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11230', name: '동대문구', fullName: '서울특별시 동대문구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11260', name: '중랑구', fullName: '서울특별시 중랑구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11290', name: '성북구', fullName: '서울특별시 성북구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11305', name: '강북구', fullName: '서울특별시 강북구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11320', name: '도봉구', fullName: '서울특별시 도봉구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11350', name: '노원구', fullName: '서울특별시 노원구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11380', name: '은평구', fullName: '서울특별시 은평구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11410', name: '서대문구', fullName: '서울특별시 서대문구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11440', name: '마포구', fullName: '서울특별시 마포구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11470', name: '양천구', fullName: '서울특별시 양천구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11500', name: '강서구', fullName: '서울특별시 강서구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11530', name: '구로구', fullName: '서울특별시 구로구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11545', name: '금천구', fullName: '서울특별시 금천구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11560', name: '영등포구', fullName: '서울특별시 영등포구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11590', name: '동작구', fullName: '서울특별시 동작구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11620', name: '관악구', fullName: '서울특별시 관악구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11650', name: '서초구', fullName: '서울특별시 서초구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11680', name: '강남구', fullName: '서울특별시 강남구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11710', name: '송파구', fullName: '서울특별시 송파구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '11740', name: '강동구', fullName: '서울특별시 강동구', sidoCode: '11', type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41110', name: '수원시', fullName: '경기도 수원시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: false },
  { lawdCd: '41111', name: '장안구', fullName: '경기도 수원시 장안구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41110', isMolitLeaf: true },
  { lawdCd: '41113', name: '권선구', fullName: '경기도 수원시 권선구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41110', isMolitLeaf: true },
  { lawdCd: '41115', name: '팔달구', fullName: '경기도 수원시 팔달구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41110', isMolitLeaf: true },
  { lawdCd: '41117', name: '영통구', fullName: '경기도 수원시 영통구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41110', isMolitLeaf: true },
  { lawdCd: '41130', name: '성남시', fullName: '경기도 성남시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: false },
  { lawdCd: '41131', name: '수정구', fullName: '경기도 성남시 수정구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41130', isMolitLeaf: true },
  { lawdCd: '41133', name: '중원구', fullName: '경기도 성남시 중원구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41130', isMolitLeaf: true },
  { lawdCd: '41135', name: '분당구', fullName: '경기도 성남시 분당구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41130', isMolitLeaf: true },
  { lawdCd: '41150', name: '의정부시', fullName: '경기도 의정부시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41170', name: '안양시', fullName: '경기도 안양시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: false },
  { lawdCd: '41171', name: '만안구', fullName: '경기도 안양시 만안구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41170', isMolitLeaf: true },
  { lawdCd: '41173', name: '동안구', fullName: '경기도 안양시 동안구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41170', isMolitLeaf: true },
  { lawdCd: '41190', name: '부천시', fullName: '경기도 부천시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41210', name: '광명시', fullName: '경기도 광명시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41220', name: '평택시', fullName: '경기도 평택시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41250', name: '동두천시', fullName: '경기도 동두천시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41270', name: '안산시', fullName: '경기도 안산시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: false },
  { lawdCd: '41271', name: '상록구', fullName: '경기도 안산시 상록구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41270', isMolitLeaf: true },
  { lawdCd: '41273', name: '단원구', fullName: '경기도 안산시 단원구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41270', isMolitLeaf: true },
  { lawdCd: '41280', name: '고양시', fullName: '경기도 고양시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: false },
  { lawdCd: '41281', name: '덕양구', fullName: '경기도 고양시 덕양구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41280', isMolitLeaf: true },
  { lawdCd: '41285', name: '일산동구', fullName: '경기도 고양시 일산동구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41280', isMolitLeaf: true },
  { lawdCd: '41287', name: '일산서구', fullName: '경기도 고양시 일산서구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41280', isMolitLeaf: true },
  { lawdCd: '41290', name: '과천시', fullName: '경기도 과천시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41310', name: '구리시', fullName: '경기도 구리시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41360', name: '남양주시', fullName: '경기도 남양주시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41370', name: '오산시', fullName: '경기도 오산시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41390', name: '시흥시', fullName: '경기도 시흥시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41410', name: '군포시', fullName: '경기도 군포시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41430', name: '의왕시', fullName: '경기도 의왕시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41450', name: '하남시', fullName: '경기도 하남시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41460', name: '용인시', fullName: '경기도 용인시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: false },
  { lawdCd: '41461', name: '처인구', fullName: '경기도 용인시 처인구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41460', isMolitLeaf: true },
  { lawdCd: '41463', name: '기흥구', fullName: '경기도 용인시 기흥구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41460', isMolitLeaf: true },
  { lawdCd: '41465', name: '수지구', fullName: '경기도 용인시 수지구', sidoCode: '41', type: 'GENERAL_DISTRICT', parentLawdCd: '41460', isMolitLeaf: true },
  { lawdCd: '41480', name: '파주시', fullName: '경기도 파주시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41500', name: '이천시', fullName: '경기도 이천시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41550', name: '안성시', fullName: '경기도 안성시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41570', name: '김포시', fullName: '경기도 김포시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41590', name: '화성시', fullName: '경기도 화성시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41610', name: '광주시', fullName: '경기도 광주시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41630', name: '양주시', fullName: '경기도 양주시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41650', name: '포천시', fullName: '경기도 포천시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41670', name: '여주시', fullName: '경기도 여주시', sidoCode: '41', type: 'CITY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41800', name: '연천군', fullName: '경기도 연천군', sidoCode: '41', type: 'COUNTY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41820', name: '가평군', fullName: '경기도 가평군', sidoCode: '41', type: 'COUNTY', parentLawdCd: null, isMolitLeaf: true },
  { lawdCd: '41830', name: '양평군', fullName: '경기도 양평군', sidoCode: '41', type: 'COUNTY', parentLawdCd: null, isMolitLeaf: true },] as const;

// ── lookup (§10) ──────────────────────────────────────────────────────────
// 모르는 코드는 **null**이다. 어떤 지역으로도 fallback하지 않고, 이름 fuzzy 매칭도 하지 않는다.

const BY_LAWD_CD = new Map(REGION_NODES.map((n) => [n.lawdCd, n]));
const BY_SIDO_CODE = new Map(REGION_SIDOS.map((s) => [s.code, s]));

export function getRegionByLawdCd(lawdCd: string | null | undefined): RegionNode | null {
  return lawdCd ? BY_LAWD_CD.get(lawdCd) ?? null : null;
}

export function getSido(sidoCode: string | null | undefined): RegionSido | null {
  return sidoCode ? BY_SIDO_CODE.get(sidoCode) ?? null : null;
}

/** 한 시도의 시군구 전체(일반구 포함). 모르는 시도면 빈 배열. */
export function getSidoRegions(sidoCode: string): readonly RegionNode[] {
  return REGION_NODES.filter((n) => n.sidoCode === sidoCode);
}

/** 부모 시의 일반구 목록. 일반구가 없으면 빈 배열. */
export function getRegionChildren(lawdCd: string): readonly RegionNode[] {
  return REGION_NODES.filter((n) => n.parentLawdCd === lawdCd);
}

/**
 * MOLIT 수집 단위 목록. 부모 시 코드는 제외된다 — 중복 호출 방지(§3).
 * sidoCode를 주면 그 시도만.
 */
export function getMolitLeafRegions(sidoCode?: string): readonly RegionNode[] {
  return REGION_NODES.filter((n) => n.isMolitLeaf && (sidoCode == null || n.sidoCode === sidoCode));
}

export interface RegionContext {
  sido: RegionSido;
  /** 일반구면 그 상위 시, 그 외에는 자기 자신. */
  city: RegionNode;
  /** 일반구일 때만 채워진다. */
  district: RegionNode | null;
  /** 조회한 노드 자신. */
  node: RegionNode;
}

/**
 * lawdCd 하나로 시도/시/일반구 계층을 모두 돌려준다. 모르는 코드는 null —
 * 추측해서 계층을 만들지 않는다.
 */
export function getRegionContext(lawdCd: string | null | undefined): RegionContext | null {
  const node = getRegionByLawdCd(lawdCd);
  if (!node) return null;
  const sido = getSido(node.sidoCode);
  if (!sido) return null;
  if (node.parentLawdCd) {
    const city = getRegionByLawdCd(node.parentLawdCd);
    if (!city) return null; // 데이터 무결성 위반 — 추측하지 않는다(테스트가 0건임을 고정).
    return { sido, city, district: node, node };
  }
  return { sido, city: node, district: null, node };
}
