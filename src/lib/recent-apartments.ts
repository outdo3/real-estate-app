// [UI-C1] 상세페이지 빠른 단지검색의 "최근 본 단지" — client-side localStorage만
// 사용한다(DB 저장/로그인 연동 없음, 원칙대로). 아파트 식별에 필요한 최소 정보만
// 저장한다: 상세페이지 canonical routing(`/apt/[name]?lawdCd=..&dong=..`, 기존
// map "상세보기" 버튼과 동일한 쿼리 형태)에 필요한 name/lawdCd/dong과, 목록에 보여줄
// 짧은 지역 라벨(address)뿐이다. jibun 등 routing에 쓰이지 않는 값은 저장하지 않는다.
export interface RecentApartment {
  name: string;
  address: string;
  lawdCd: string;
  dong: string;
  visitedAt: number;
}

const STORAGE_KEY = 'ejip:recentApartments';
const MAX_RECENT = 8;

// 같은 물리적 단지를 같은 항목으로 취급하는 키. name만으로는 다른 구/동의 동일
// 브랜드 단지(예: "롯데캐슬")가 섞일 수 있어(B1-FIX 계열에서 이미 확인된 문제) name+dong
// 조합을 식별자로 쓴다 — 이 앱 전역에서 이미 쓰고 있는 collision 방지 방식과 동일하다.
const keyOf = (name: string, dong: string) => `${name}|${dong}`;

function isValidEntry(v: unknown): v is RecentApartment {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.name === 'string' && e.name.length > 0 &&
    typeof e.address === 'string' &&
    typeof e.lawdCd === 'string' &&
    typeof e.dong === 'string' &&
    typeof e.visitedAt === 'number'
  );
}

// localStorage가 손상돼 있거나(다른 앱/확장이 값을 건드림 등) JSON 파싱이 실패해도
// 페이지가 깨지지 않도록 항상 빈 배열로 안전하게 폴백한다. 이 함수는 반드시 클라이언트
// (useEffect 등)에서만 호출한다 — SSR 중에는 호출하지 않아 하이드레이션 불일치가 없다.
export function getRecentApartments(): RecentApartment[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

// 방문 기록. 같은 단지(name+dong)를 다시 보면 새 항목을 추가하지 않고 맨 앞으로
// 갱신한다. 최대 개수를 넘으면 오래된 항목부터 제거한다. 저장 실패(예: localStorage
// 비활성화/쿼터 초과)는 조용히 무시한다 — 이 기능이 실패해도 상세페이지 자체는
// 정상 동작해야 한다.
export function recordApartmentVisit(entry: Omit<RecentApartment, 'visitedAt'>): void {
  if (!entry.name) return;
  try {
    const existing = getRecentApartments();
    const filtered = existing.filter((e) => keyOf(e.name, e.dong) !== keyOf(entry.name, entry.dong));
    const next = [{ ...entry, visitedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 미지원/쿼터 초과 등 — 무시(최근 본 단지 기능만 비활성화됨)
  }
}
