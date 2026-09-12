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

// RECENT_VIEWED_AUTH_PARITY_V1 — **게스트 전용** 저장소임을 키 이름으로 명시하고
// 버전을 올린다.
//
// 왜 키를 바꾸는가: 예전 키(`ejip:recentApartments`)에는 두 가지 경로로 **로그인 계정의
// 열람 기록**이 섞여 들어갔다.
//   1) 상세페이지 방문 기록을 로그인 여부와 무관하게 local에 썼다
//   2) useRecentSync가 서버(계정) 목록을 local에 mirror했다
// 홈은 세션을 보지 않고 local을 읽었으므로, 로그아웃한 뒤에도(또는 다른 계정으로
// 로그인해도) 이전 계정이 본 단지가 홈에 그대로 남았다.
//
// 코드를 고쳐도 이미 사용자 브라우저에 남아 있는 오염된 값은 사라지지 않는다. 키를
// 새로 쓰면 그 데이터를 읽지 않게 되고, 읽는 순간 옛 키를 지워 정리한다.
const STORAGE_KEY = 'ejip:recentApartments:guest:v2';
const LEGACY_STORAGE_KEY = 'ejip:recentApartments';
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
    // 옛 키에 남아 있을 수 있는 계정 기록을 읽지 않고 **지운다**(위 주석 참고).
    // 실패해도 무시한다 — 정리는 최선노력이고, 어차피 읽지 않는다.
    try {
      if (window.localStorage.getItem(LEGACY_STORAGE_KEY) !== null) {
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch { /* 무시 */ }

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
export function recordApartmentVisit(
  entry: Omit<RecentApartment, 'visitedAt'>,
  options: { authenticated?: boolean } = {}
): void {
  if (!entry.name) return;
  // RECENT_VIEWED_AUTH_PARITY_V1 §10 — 로그인 상태의 방문은 **서버에만** 기록한다.
  //
  // 예전에는 로그인 여부와 무관하게 local에도 썼다. 그래서 로그아웃하면 그 계정이 본
  // 단지가 "게스트 기록"으로 남아 홈에 계속 보였다(같은 기기의 다른 사람에게도).
  // 게스트 저장소는 이름 그대로 **비회원 상태로 본 것만** 담는다.
  if (options.authenticated) return;
  try {
    const existing = getRecentApartments();
    const filtered = existing.filter((e) => keyOf(e.name, e.dong) !== keyOf(entry.name, entry.dong));
    const next = [{ ...entry, visitedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 미지원/쿼터 초과 등 — 무시(최근 본 단지 기능만 비활성화됨)
  }
}

/**
 * 게스트 저장소 비우기.
 *
 * 지금은 호출하는 곳이 없다 — 로그아웃 시 지우지 않는 게 의도다. 로그아웃 후 남는
 * 값은 **그 사람이 이 기기에서 비회원으로 본 기록**뿐이고(로그인 중 방문은 위에서
 * 저장하지 않는다), 그건 계속 보여주는 게 맞다. 계정 기록이 섞일 경로가 생기면
 * 이 함수로 즉시 지울 수 있도록 열어둔다.
 */
export function clearGuestRecentApartments(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시
  }
}
