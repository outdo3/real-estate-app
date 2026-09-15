// AUTH/MY V1 MY-4 + PERSONALIZED_SCORE_V1 P2-A — 사용자 선호 GET/PUT 판정 로직(의존성 주입).
//
// 라우트는 세션 사용자와 저장소(Prisma)만 주입한다. userId는 항상 세션에서만 오고, 요청 body/query의 userId는 읽지 않는다.
// purposes와 fitImportance는 **독립 필드**다: 요청에 들어온 필드만 바꾸고 나머지는 그대로 둔다.
import { FIT_IMPORTANCE_ERROR_MESSAGE, parseFitImportance, readStoredFitImportance, type FitImportance } from './fit-importance';
import { validatePurposes, type Purpose } from './preferences';

export interface PreferencesView {
  purposes: string[];
  fitImportance: FitImportance | null;
}

export interface StoredPreferences {
  purposes: unknown;
  fitImportance: unknown;
}

export interface PreferencesStore {
  find: (userId: string) => Promise<StoredPreferences | null>;
  /** 주어진 필드만 갱신(행이 없으면 생성). fitImportance: null은 DB NULL(초기화). */
  upsert: (userId: string, patch: { purposes?: Purpose[]; fitImportance?: FitImportance | null }) => Promise<StoredPreferences>;
}

/** 실패 로그. 오류 원문은 넘기지 않는다 — Prisma 오류 메시지가 저장하려던 값(선호 내용)을 담을 수 있다. */
export type PreferencesLog = (message: string, meta: { code: string }) => void;

const errorCode = (e: unknown) => String((e as { code?: string })?.code ?? (e as { name?: string })?.name ?? 'Error');

export type PreferencesAuth = { error: string | null; status: number; user: { id: string } | null };

type Result = { status: number; body: { success: true; data: PreferencesView } | { success: false; error: string } };

const toView = (row: StoredPreferences | null): PreferencesView => ({
  purposes: row && Array.isArray(row.purposes) ? (row.purposes as string[]) : [],
  fitImportance: row ? readStoredFitImportance(row.fitImportance) : null,
});

export type PreferencesPatch = { purposes?: Purpose[]; fitImportance?: FitImportance | null };

/**
 * PUT body → 갱신할 필드. 최소 하나(purposes 또는 fitImportance) 필요.
 * - purposes: 기존 규칙 그대로(validatePurposes)
 * - fitImportance: 완전한 5축 객체 또는 null(초기화). 빈 객체·일부 key는 400(설정됨/미설정 경계를 흐리지 않기 위해).
 */
export function parsePreferencesPatch(body: unknown): { ok: true; patch: PreferencesPatch } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: '요청 형식이 올바르지 않습니다.' };
  const b = body as Record<string, unknown>;
  const hasPurposes = Object.prototype.hasOwnProperty.call(b, 'purposes');
  const hasFit = Object.prototype.hasOwnProperty.call(b, 'fitImportance');
  if (!hasPurposes && !hasFit) return { ok: false, error: 'purposes 또는 fitImportance 중 하나는 있어야 합니다.' };

  const patch: PreferencesPatch = {};
  if (hasPurposes) {
    const v = validatePurposes({ purposes: b.purposes });
    if (!v.valid) return { ok: false, error: v.error };
    patch.purposes = v.purposes;
  }
  if (hasFit) {
    if (b.fitImportance === null) {
      patch.fitImportance = null;
    } else {
      const parsed = parseFitImportance(b.fitImportance);
      if (!parsed.ok) return { ok: false, error: FIT_IMPORTANCE_ERROR_MESSAGE };
      patch.fitImportance = parsed.value;
    }
  }
  return { ok: true, patch };
}

export async function handleGetPreferences(auth: PreferencesAuth, store: PreferencesStore, log: PreferencesLog = () => {}): Promise<Result> {
  if (auth.error || !auth.user) return { status: auth.status, body: { success: false, error: auth.error ?? '로그인이 필요합니다.' } };
  try {
    return { status: 200, body: { success: true, data: toView(await store.find(auth.user.id)) } };
  } catch (e) {
    log('Failed to get preferences', { code: errorCode(e) });
    return { status: 500, body: { success: false, error: '관심 목적을 불러오지 못했습니다.' } };
  }
}

export async function handlePutPreferences(auth: PreferencesAuth, body: unknown, store: PreferencesStore, log: PreferencesLog = () => {}): Promise<Result> {
  if (auth.error || !auth.user) return { status: auth.status, body: { success: false, error: auth.error ?? '로그인이 필요합니다.' } };
  const parsed = parsePreferencesPatch(body);
  if (!parsed.ok) return { status: 400, body: { success: false, error: parsed.error } };
  try {
    return { status: 200, body: { success: true, data: toView(await store.upsert(auth.user.id, parsed.patch)) } };
  } catch (e) {
    log('Failed to update preferences', { code: errorCode(e) });
    return { status: 500, body: { success: false, error: '관심 목적을 저장하지 못했습니다.' } };
  }
}
