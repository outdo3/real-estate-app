// [UI-C1-FIX] /api/apt/[name]/route.ts가 이미 쓰던 normalizeName(공백 제거 + 끝
// "아파트" 제거)을 그대로 유지하면서, 실측(부산 15개 표본 precheck)에서 발견된 두
// 유형의 "같은 단지인데 이름 표기만 달라서 매칭 실패"만 안전하게 보강한다.
//
// 원칙(오매칭 방지 최우선, false negative는 일부 허용):
// - 기존에 매칭되던 쌍은 절대 매칭 안 되게 만들지 않는다(상위집합으로만 확장).
// - 차수(1차/2차 등)가 서로 다르면 절대 같은 단지로 보지 않는다(추가 안전장치).
// - 브랜드 표기 alias는 실측으로 확인된 것만 작은 화이트리스트로 관리한다
//   (임의의 음차 변환/유사도 점수 없음).
// - 글자 단위 유사도(Levenshtein 등)는 쓰지 않는다.

// 카카오 POI가 "OO아파트 134동"처럼 특정 동/건물 번호를 이름 뒤에 붙이는 경우가 실측
// 확인됐다(예: "LG메트로시티3차아파트 134동"). 공백을 지우기 전에 끝에 붙은
// "공백+숫자+동" 패턴만 제거한다 — 법정동명(예: "서대신동3가")은 이름 앞쪽에 붙거나
// 공백 없이 이어지는 전혀 다른 형태라 이 패턴에 걸리지 않는다.
const BUILDING_SUFFIX_PATTERN = /\s+\d+동$/;

// 차수(예: "2차")를 이름 어디에 있든 하나의 토큰으로 뽑아낸다. 순서 차이
// ("대신2차푸르지오" vs "대신푸르지오2차")를 문자열 정렬이 아니라, 차수만 따로
// 비교하고 나머지 본문은 그대로 비교하는 방식으로 안전하게 흡수한다.
const CHASU_PATTERN = /\d+차/;

// 실측(부산 15개 표본)으로 확인된 유일한 브랜드 표기 alias. 다른 브랜드를 임의로
// 추가하지 않는다 — 필요해지면 실제 실패 사례를 근거로 추가한다.
const BRAND_ALIASES: [string, string][] = [['LG', '엘지']];

export function normalizeAptName(raw: string): string {
  if (!raw) return '';
  let s = raw.replace(BUILDING_SUFFIX_PATTERN, '');
  s = s.replace(/\s+/g, '');
  s = s.replace(/아파트$/, '');
  return s;
}

// 차수는 이름 어디에나 있을 수 있다("대신2차푸르지오"처럼 중간에 오는 실측 사례가
// 있음) — 위치를 anchor하지 않고 처음 발견되는 "숫자+차"를 뽑는다. 그런 표기가
// 전혀 없으면, MOLIT 원본이 "엘지메트로시티3"처럼 "차" 없이 끝자리 숫자만으로
// 차수를 표기하는 경우(실측 확인)를 대비해 문자열 끝의 숫자만 보조로 확인한다 —
// 이건 끝자리일 때만 인정한다(문장 중간의 숫자를 전부 차수로 오인하지 않기 위함).
function extractChasu(s: string): { base: string; chasu: string | null } {
  const explicit = s.match(CHASU_PATTERN);
  if (explicit) {
    return { base: s.replace(explicit[0], ''), chasu: explicit[0].replace('차', '') };
  }
  const bareTrailing = s.match(/\d+$/);
  if (bareTrailing) {
    return { base: s.slice(0, s.length - bareTrailing[0].length), chasu: bareTrailing[0] };
  }
  return { base: s, chasu: null };
}

// 문자열 자체가 아니라 "alias 치환된 후보들의 집합"을 만들어 비교한다 — 실제 치환
// 대상 문자열이 없으면 원본 그대로 1개짜리 집합이 되어 기존 동작과 동일하다.
function brandAliasVariants(s: string): string[] {
  const variants = new Set([s]);
  for (const [a, b] of BRAND_ALIASES) {
    for (const v of [...variants]) {
      if (v.includes(a)) variants.add(v.split(a).join(b));
      if (v.includes(b)) variants.add(v.split(b).join(a));
    }
  }
  return [...variants];
}

// 두 원본(정규화 전) 이름이 같은 단지를 가리키는지 판정한다. 기존 route.ts의
// `itemName.includes(searchAptName) || searchAptName.includes(itemName)` 양방향
// 부분포함 규칙을 그대로 최종 판정 기준으로 쓰되, 그 전에 (1) 건물번호 접미사 제거
// (2) 차수 분리 비교 (3) 브랜드 alias 치환을 거친다 — 전부 기존 규칙보다 엄격하게
// 좁히거나(차수 불일치 시 즉시 false), 기존에 안 통과되던 표기 차이만 추가로
// 흡수하는 방향이라 이미 통과되던 쌍을 깨뜨리지 않는다.
export function aptNamesMatch(nameA: string, nameB: string): boolean {
  const normA = normalizeAptName(nameA);
  const normB = normalizeAptName(nameB);
  if (!normA || !normB) return false;

  const { base: baseA, chasu: chasuA } = extractChasu(normA);
  const { base: baseB, chasu: chasuB } = extractChasu(normB);

  // 둘 다 차수가 명시돼 있는데 서로 다르면 — "대신푸르지오1차" vs "대신푸르지오2차"처럼
  // 명백히 다른 단지다. 한쪽에만 차수가 없는 경우(정보 부족)는 오판 위험이 있어
  // 배제하지 않고 아래 본문 비교로 넘어간다.
  if (chasuA && chasuB && chasuA !== chasuB) return false;

  const candidatesA = brandAliasVariants(baseA);
  const candidatesB = brandAliasVariants(baseB);
  const baseMatches = candidatesA.some((ca) => candidatesB.some((cb) => ca.includes(cb) || cb.includes(ca)));
  if (baseMatches) return true;

  // 차수 제거 전 원본 정규화 문자열끼리도 기존 규칙(양방향 부분포함) 그대로
  // 시도한다 — 차수가 없는 기존 매칭 사례(예: "명륜아이파크1단지")를 그대로 보존.
  return normA.includes(normB) || normB.includes(normA);
}

// APT INFO IDENTITY HOTFIX V1 — /api/apt/[name]/info의 dong+jibun-only(이름 제약이
// 전혀 없는) fallback 조회 결과에서 unitTypes(Unit Master)를 채택해도 되는지 판단하는
// 순수 함수. unitTypes는 건물이 아니라 특정 아파트 identity에 속한 데이터라(실측:
// 같은 주소의 "대신롯데캐슬"=8건 vs "대신롯데캐슬아파트"=0건), 두 안전장치를 모두
// 통과해야만 채택한다:
//   1) STRONGER_RESULT PROTECTION — 이미 exact(name+dong) 조회로 unitTypes를
//      찾았다면(1건 이상) 절대 이 fallback으로 덮지 않는다.
//   2) IDENTITY PROOF — fallback row가 정규화 후에도 다른 이름이면(다른 아파트일
//      위험) 채택하지 않는다. aptNamesMatch()의 느슨한 부분포함 규칙이 아니라 더
//      엄격한 normalizeAptName() 완전 일치만 인정한다(오매칭 위험을 최소화).
export function shouldAdoptFallbackUnitTypes(params: {
  currentUnitTypesCount: number;
  fallbackName: string;
  requestedAptName: string;
  fallbackUnitTypesCount: number;
}): boolean {
  const { currentUnitTypesCount, fallbackName, requestedAptName, fallbackUnitTypesCount } = params;
  if (currentUnitTypesCount > 0) return false;
  if (fallbackUnitTypesCount === 0) return false;
  return normalizeAptName(fallbackName) === normalizeAptName(requestedAptName);
}

// SEARCH_DETAIL_IDENTITY_HOTFIX_V2 — /api/apt/[name]/route.ts는 같은 법정동(dong) 안의
// MOLIT 실거래를 aptNamesMatch()의 느슨한 양방향 부분포함 규칙으로 걸러 특정 단지의
// 거래만 추린다. 이 규칙은 원래 표기 차이(예: "명륜아이파크1단지")를 흡수하려고 만든
// 것인데, 요청한 이름이 완전히 다른 실존 단지명의 부분 문자열일 때도 그대로 통과시켜
// 버리는 위험이 있다 — 실측(부산 해운대구 우동): "경동"(aptSeq 26350-2, 지번 974,
// 1995년 준공, 72세대)이 "해운대경동제이드"(aptSeq 26350-2206, 지번 763, 2012년 준공,
// 278세대) 검색에 섞여 들어와, "경동"의 최근 거래가 더 최신이라는 이유만으로 상세
// 페이지 전체 identity(이름/준공연도/세대수)가 "경동"으로 뒤바뀌는 사고로 이어졌다.
//
// STRONG_RESULT_PROTECTION(§12) 원칙을 여기 적용한다: 이 동 안에 요청한 이름과
// "정규화 후 완전히 일치"하는 거래가 하나라도 있다면, 그것이 이미 이 라우트가 얻을 수
// 있는 가장 강한 identity proof다 — 그 즉시 그 실거래의 aptSeq(들)만 인정하고, 부분
// 포함만으로 통과되는 다른 단지의 거래는 전부 배제한다. exact match가 dong 안에 하나도
// 없을 때만(예: 사용자가 "금호어울림"으로 검색했는데 국토부 등록명이 "서대신금호어울림"
// 뿐인 정당한 표기차 케이스) 기존 aptNamesMatch 느슨한 규칙으로 폴백한다 — 이미
// 통과되던 케이스를 깨뜨리지 않는 상위 안전장치일 뿐이다(집합을 줄이기만 함).
export function resolveStrongIdentityAptSeqs(
  items: Array<{ name?: string | null; dong?: string | null; aptSeq?: string | null }>,
  requestedAptName: string,
  dong?: string
): Set<string> {
  const requestedNorm = normalizeAptName(requestedAptName);
  const scoped = dong ? items.filter((item) => item.dong === dong) : items;
  const seqs = new Set<string>();
  for (const item of scoped) {
    if (!item.name || !item.aptSeq) continue;
    if (normalizeAptName(item.name) === requestedNorm) seqs.add(item.aptSeq);
  }
  return seqs;
}

// strongAptSeqs가 비어있지 않으면(exact match 확보) aptSeq 보유 항목은 그 집합에 속할
// 때만, aptSeq가 없는 항목(구주소 표기 등 일부 legacy 응답)은 정규화 이름이 완전히
// 같을 때만 인정한다 — 어느 쪽도 aptNamesMatch의 느슨한 부분포함을 쓰지 않는다.
// strongAptSeqs가 비어있으면(이 동 안에 exact match가 전혀 없으면) 기존 동작 그대로
// aptNamesMatch로 폴백한다.
export function matchesTradeIdentity(
  item: { name?: string | null; aptSeq?: string | null },
  requestedAptName: string,
  strongAptSeqs: Set<string>
): boolean {
  if (!item.name) return false;
  if (strongAptSeqs.size > 0) {
    if (item.aptSeq) return strongAptSeqs.has(item.aptSeq);
    return normalizeAptName(item.name) === normalizeAptName(requestedAptName);
  }
  return aptNamesMatch(item.name, requestedAptName);
}
