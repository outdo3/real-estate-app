'use client';

// ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 §7 — explicit, non-persistent, admin/dev-only
// analytics suppression. Design constraints from the task spec:
//   - never auto-applied to a normal visitor
//   - sharing the URL must NOT propagate suppression to whoever opens that link
//   - not a permanent fingerprint
//   - stores nothing sensitive (a single '1' flag)
// The trigger is a URL query param, but the param is stripped from the address bar the moment
// it's read — so a copied/shared link never carries it forward. The flag itself lives in
// sessionStorage (per-tab, cleared when the browser session ends), not localStorage/cookies.
const QA_SUPPRESS_STORAGE_KEY = 'ejip_qa_suppress';
const QA_SUPPRESS_URL_PARAM = '__ejip_qa';

export function isQaSuppressed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(QA_SUPPRESS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function initQaSuppressionFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(QA_SUPPRESS_URL_PARAM) !== '1') return;
    window.sessionStorage.setItem(QA_SUPPRESS_STORAGE_KEY, '1');
    params.delete(QA_SUPPRESS_URL_PARAM);
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
  } catch {
    // sessionStorage 접근 실패(프라이빗 모드 등)해도 정상 페이지 기능에는 영향 없다.
  }
}
