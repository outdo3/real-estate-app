// PERSONALIZED_SCORE_V1 P2-C/P2-E — 로그인 사용자 본인의 중요도(fitImportance) 세션 메모리 캐시.
//
// - 브라우저 탭 메모리에만 둔다(localStorage·URL·쿠키 없음). 새로고침·로그아웃 이동 시 사라진다.
// - **사용자 id로 묶는다**: 다른 id로 조회하면 이전 사용자 값을 버리고 새로 받는다. 익명 공용 key 없음.
// - 같은 사용자의 상세 이동마다 다시 조회하지 않고, 동시에 여러 번 요청되면 한 번만 보낸다.
// - 조회 실패는 캐시하지 않는다(다음 진입에서 다시 시도).
// - MY에서 저장하면 set()으로 갱신하고 구독자에게 알린다(새로고침 없이 최신 값).
import { readStoredFitImportance, type FitImportance } from './fit-importance';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type Listener = () => void;

export interface FitPreferenceCache {
  /** 캐시에 있으면 즉시 값, 없으면 undefined. */
  peek(userId: string): FitImportance | null | undefined;
  /** 본인 선호를 가져온다(캐시·요청 중복 제거). 실패 시 reject. */
  load(userId: string): Promise<FitImportance | null>;
  set(userId: string, value: FitImportance | null): void;
  clear(): void;
  subscribe(listener: Listener): () => void;
}

export function createFitPreferenceCache(fetchImpl: FetchLike): FitPreferenceCache {
  let owner: string | null = null;
  let value: FitImportance | null | undefined;
  let inflight: Promise<FitImportance | null> | null = null;
  let generation = 0;
  const listeners = new Set<Listener>();
  const notify = () => listeners.forEach((l) => l());

  const reset = () => {
    owner = null;
    value = undefined;
    inflight = null;
    generation++;
  };

  return {
    peek(userId) {
      return owner === userId ? value : undefined;
    },
    load(userId) {
      if (owner !== userId) reset();
      owner = userId;
      if (value !== undefined) return Promise.resolve(value);
      if (inflight) return inflight;
      const gen = generation;
      inflight = fetchImpl('/api/my/preferences', { cache: 'no-store', credentials: 'same-origin' })
        .then(async (res) => {
          const json = (await res.json().catch(() => null)) as { success?: boolean; data?: { fitImportance?: unknown } } | null;
          if (!res.ok || !json?.success) throw new Error('preferences unavailable');
          const parsed = readStoredFitImportance(json.data?.fitImportance ?? null);
          if (gen === generation && owner === userId) {
            value = parsed;
            notify();
          }
          return parsed;
        })
        .finally(() => {
          if (gen === generation) inflight = null;
        });
      return inflight;
    },
    set(userId, next) {
      if (owner !== userId) reset();
      owner = userId;
      value = next;
      notify();
    },
    clear() {
      reset();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** 앱 전역 단일 인스턴스(탭 메모리). 서버 렌더에서는 쓰지 않는다(훅이 로그인 확인 후에만 호출). */
export const fitPreferenceCache = createFitPreferenceCache((input, init) => fetch(input, init));
