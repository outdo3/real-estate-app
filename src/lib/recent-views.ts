// AUTH/MY V1 — MY-3. Recent Views 서버 API와 클라이언트가 공통으로 쓰는
// 순수 로직(입력 검증, merge 알고리즘). DB/세션 접근은 이 파일에 두지 않는다.

export interface RecentViewInput {
  lawdCd: string;
  dong: string;
  name: string;
  aptSeq?: string;
  address?: string;
  /** 클라이언트가 전달하는 방문 timestamp (ms). 없으면 서버 현재시각 사용 */
  viewedAt?: number;
}

// local recent(ejip:recentApartments)의 RecentApartment와 같은 형태를 수용한다.
// visitedAt(local) → viewedAt(server)으로 통합.
export interface LocalRecentItem {
  name: string;
  address?: string;
  lawdCd: string;
  dong: string;
  visitedAt?: number; // local에서 올 때
  viewedAt?: number;  // server에서 내려줄 때도 재활용
  aptSeq?: string;
}

// Bulk sync payload — 클라이언트가 local recent 배열을 한 번에 보낼 때.
const MAX_SYNC_ITEMS = 20; // 클라이언트가 보낼 수 있는 최대 개수

interface ValidationOk {
  valid: true;
  data: RecentViewInput;
}
interface ValidationFail {
  valid: false;
  error: string;
}

/** 단일 recent upsert 입력값 검증 */
export function validateRecentInput(body: unknown): ValidationOk | ValidationFail {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: '요청 형식이 올바르지 않습니다.' };
  }
  const b = body as Record<string, unknown>;

  const lawdCd = typeof b.lawdCd === 'string' ? b.lawdCd.trim() : '';
  const dong   = typeof b.dong   === 'string' ? b.dong.trim()   : '';
  const name   = typeof b.name   === 'string' ? b.name.trim()   : '';

  if (!lawdCd || !dong || !name) {
    return { valid: false, error: '단지 정보(지역/동/이름)가 필요합니다.' };
  }

  const aptSeq  = typeof b.aptSeq  === 'string' && b.aptSeq.trim()  ? b.aptSeq.trim()  : undefined;
  const address = typeof b.address === 'string' && b.address.trim() ? b.address.trim() : undefined;
  const viewedAt =
    typeof b.viewedAt === 'number' && isFinite(b.viewedAt) && b.viewedAt > 0
      ? b.viewedAt
      : undefined;

  return { valid: true, data: { lawdCd, dong, name, aptSeq, address, viewedAt } };
}

/** sync payload — 최대 MAX_SYNC_ITEMS 개까지만 처리 */
export function validateSyncPayload(body: unknown): RecentViewInput[] {
  if (!body || !Array.isArray((body as any)?.items)) return [];
  const items: unknown[] = (body as any).items;
  const valid: RecentViewInput[] = [];

  for (const item of items.slice(0, MAX_SYNC_ITEMS)) {
    const result = validateRecentInput(item);
    if (result.valid) valid.push(result.data);
    // malformed item: skip (fuzzy correction 금지)
  }
  return valid;
}

// ── Merge 알고리즘 ──────────────────────────────────────────────────────────
//
// 동일 canonical identity: (lawdCd, dong, name) 기준.
// 최신 viewedAt 우선. 서버측 viewedAt이 없으면 그대로 유지.
//
// Example:
//   LOCAL:  [A(10:00), B(09:00), C(08:00)]
//   SERVER: [B(11:00), D(07:00)]
//   RESULT: [B(11:00), A(10:00), C(08:00), D(07:00)]  → max 20

export interface MergeItem {
  lawdCd: string;
  dong: string;
  name: string;
  aptSeq?: string | null;
  address?: string | null;
  viewedAt: number; // ms timestamp
}

const identityKey = (i: Pick<MergeItem, 'lawdCd' | 'dong' | 'name'>) =>
  `${i.lawdCd}|${i.dong}|${i.name}`;

/**
 * local list + server list → merged, deduped, sorted by viewedAt desc, max limitCount.
 * local의 visitedAt 필드를 viewedAt으로 취급한다.
 */
export function mergeRecentLists(
  local: LocalRecentItem[],
  server: MergeItem[],
  limitCount: number = 20
): MergeItem[] {
  const map = new Map<string, MergeItem>();

  // server first (먼저 올리고 local이 덮는다면 더 최신 항목이 살아남음)
  for (const item of server) {
    const k = identityKey(item);
    map.set(k, { ...item });
  }

  // local → 더 최신 viewedAt이면 교체
  for (const item of local) {
    const ts = item.viewedAt ?? item.visitedAt;
    if (!ts) continue; // timestamp 없으면 건너뜀
    const k = identityKey(item);
    const existing = map.get(k);
    if (!existing || ts > existing.viewedAt) {
      map.set(k, {
        lawdCd: item.lawdCd,
        dong: item.dong,
        name: item.name,
        aptSeq: item.aptSeq ?? existing?.aptSeq ?? null,
        address: item.address ?? existing?.address ?? null,
        viewedAt: ts,
      });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.viewedAt - a.viewedAt)
    .slice(0, limitCount);
}
