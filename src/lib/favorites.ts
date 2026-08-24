// AUTH/MY V1 — MY-2. 관심단지(Favorites)에서 서버 API와 클라이언트 컴포넌트가
// 공통으로 쓰는 순수 로직만 모아둔다(입력 검증, 로그인 전 "찜하려던 의도" 보존).
// DB/세션 접근은 이 파일에 두지 않는다 — 그래야 node:test로 순수하게 검증할 수 있다.

export interface FavoriteIdentity {
  lawdCd: string;
  dong: string;
  name: string;
}

export interface FavoriteInput extends FavoriteIdentity {
  aptSeq?: string;
  address?: string;
}

interface ValidationOk {
  valid: true;
  data: FavoriteInput;
}
interface ValidationFail {
  valid: false;
  error: string;
}

// favorites 테이블의 identity(@@unique([userId, lawdCd, dong, name]))에 대응하는
// 필수값만 검증한다. aptSeq/address는 optional display 정보라 형식 검증만 한다.
// 이 함수는 클라이언트가 보낸 임의 문자열을 "믿고" 저장하기 위한 것이 아니라,
// 상세페이지가 이미 로드해둔 canonical 값(lawdCd/dong/name)이 최소한 비어있지
// 않은 문자열인지만 걸러낸다 — fuzzy matching/재해석은 하지 않는다.
export function validateFavoriteInput(body: unknown): ValidationOk | ValidationFail {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: '요청 형식이 올바르지 않습니다.' };
  }
  const b = body as Record<string, unknown>;

  const lawdCd = typeof b.lawdCd === 'string' ? b.lawdCd.trim() : '';
  const dong = typeof b.dong === 'string' ? b.dong.trim() : '';
  const name = typeof b.name === 'string' ? b.name.trim() : '';

  if (!lawdCd || !dong || !name) {
    return { valid: false, error: '단지 정보(지역/동/이름)가 필요합니다.' };
  }

  const aptSeq = typeof b.aptSeq === 'string' && b.aptSeq.trim() ? b.aptSeq.trim() : undefined;
  const address = typeof b.address === 'string' && b.address.trim() ? b.address.trim() : undefined;

  return { valid: true, data: { lawdCd, dong, name, aptSeq, address } };
}

const PENDING_FAVORITE_KEY = 'ejip:pendingFavorite';
// 로그인 화면을 오래 띄워두고 돌아오는 경우까지 자동 완료하면 사용자가 잊고 있던
// 의도를 되살리는 셈이라 놀랄 수 있다 — 짧은 로그인 흐름(보통 수 초~수십 초)만
// 커버하도록 넉넉히 10분으로 제한한다.
const PENDING_FAVORITE_TTL_MS = 10 * 60 * 1000;

export interface PendingFavorite extends FavoriteInput {
  savedAt: number;
}

export function buildPendingFavorite(input: FavoriteInput): PendingFavorite {
  return { ...input, savedAt: Date.now() };
}

// pending intent가 "지금 보고 있는 단지"와 정확히 같고, 저장된 지 오래되지
// 않았을 때만 유효하다고 판단한다 — 다른 단지 상세로 이동한 뒤 로그인하면
// 엉뚱한 단지가 자동으로 찜되는 것을 막는다.
export function isPendingFavoriteValid(
  pending: unknown,
  current: FavoriteIdentity,
  now: number = Date.now()
): pending is PendingFavorite {
  if (!pending || typeof pending !== 'object') return false;
  const p = pending as Record<string, unknown>;
  if (
    typeof p.lawdCd !== 'string' ||
    typeof p.dong !== 'string' ||
    typeof p.name !== 'string' ||
    typeof p.savedAt !== 'number'
  ) {
    return false;
  }
  if (p.lawdCd !== current.lawdCd || p.dong !== current.dong || p.name !== current.name) return false;
  if (now - p.savedAt > PENDING_FAVORITE_TTL_MS) return false;
  return true;
}

// 아래 3개는 클라이언트(브라우저)에서만 호출한다. localStorage 기반 recent-apartments.ts와
// 동일하게, sessionStorage 접근 실패(비활성화/쿼터 초과 등)는 조용히 무시한다 — 이 기능이
// 실패해도 상세페이지/로그인 자체는 정상 동작해야 한다. 로그인 "전" 단계이므로 여기서는
// 절대 DB에 쓰지 않는다.
export function readPendingFavorite(): PendingFavorite | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_FAVORITE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.lawdCd === 'string' &&
      typeof parsed.dong === 'string' &&
      typeof parsed.name === 'string' &&
      typeof parsed.savedAt === 'number'
    ) {
      return parsed as PendingFavorite;
    }
    return null;
  } catch {
    return null;
  }
}

export function writePendingFavorite(input: FavoriteInput): void {
  try {
    window.sessionStorage.setItem(PENDING_FAVORITE_KEY, JSON.stringify(buildPendingFavorite(input)));
  } catch {
    // sessionStorage 미지원/쿼터 초과 — 무시(로그인 후 자동 완료만 비활성화됨)
  }
}

export function clearPendingFavorite(): void {
  try {
    window.sessionStorage.removeItem(PENDING_FAVORITE_KEY);
  } catch {
    // 무시
  }
}
