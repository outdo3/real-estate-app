# ADMIN USER BEHAVIOR ANALYTICS V1 — PHASE 2 IMPLEMENTATION

**Date:** 2026-09-03
**Baseline:** `main` @ `8b739fe` (follows `ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE1.md`)
**Scope:** Trusted behavior dashboard. Reuses the existing `PageView`/event/`SearchLog` schema
exactly as-is — zero DB schema/migration/index changes. Write-time traffic exclusion (no tagging
column exists, so exclusion happens before a row is ever created). Historical rows never touched.

---

## 1. Final Architecture

No new tables. Three new modules:
- `src/lib/analytics/traffic-classification.ts` — write-time exclusion gate (bot / non-production
  environment / admin session / QA suppression).
- `src/lib/analytics/qa-suppression.ts` — client-side, ephemeral, non-propagating QA opt-out.
- `src/lib/analytics/search-redaction.ts` — PII redaction for `SearchLog`.
- `src/lib/admin-analytics/{types,query}.ts` — the new aggregate query layer and data contract.
- `src/app/api/admin/behavior/route.ts` + `src/app/admin/behavior/page.tsx` — the new dashboard,
  reusing `requireAdmin()` unchanged.

## 2. Traffic Exclusion

`classifyTraffic()` checks four signals, in this priority order, and returns a reason (or `null`
to proceed with the write):

1. **QA_SUPPRESSED** — client explicitly flagged this request (see §3).
2. **ADMIN_SESSION** — `isAdminSessionUser()` (same check `requireAdmin()` uses — `role === 'ADMIN'`
   or `ADMIN_EMAIL` env match), extracted into a shared exported function so the two admin checks
   can never drift apart.
3. **BOT** — conservative UA regex (`Googlebot`, `bingbot`, `curl/`, `python-requests`, common
   crawler/health-check tokens). Empty UA is **not** treated as a bot (avoids false positives over
   missing a bot).
4. **NON_PRODUCTION** — `process.env.VERCEL_ENV !== 'production'`. `VERCEL_ENV` is automatically
   provided by Vercel Functions (no config needed) and is `undefined` outside Vercel — so this one
   check covers local dev **and** Vercel Preview deployments without a host-header check (host
   headers can be proxied/spoofed; `VERCEL_ENV` cannot).

Applied identically in `/api/log/view`, `/api/log/event`, `/api/log/search`, `/api/log/heartbeat`.
`/api/log/leave` (delete-only, no counting) is intentionally left unguarded.

**Direct proof this fixes the exact contamination Phase 1 found:** live-tested on the dev server
(`localhost:3000`) — a manual `/api/log/view` call now returns
`{"success":true,"excluded":"NON_PRODUCTION"}` instead of creating a row. This is the exact traffic
class (localhost dev-server QA) that Phase 1 proved had skewed "대신롯데캐슬" to 34% of all detail
views.

## 3. QA Mode

Design constraints from the task spec: never auto-applied, must not propagate via a shared URL,
not a permanent fingerprint, no sensitive data stored.

**Mechanism:** visiting any URL with `?__ejip_qa=1` triggers `initQaSuppressionFromUrl()`
(mounted once in `ViewTracker`, the globally-mounted tracker component), which:
1. Sets `sessionStorage.ejip_qa_suppress = '1'` (per-tab, cleared when the browser session ends —
   not `localStorage`, not a cookie).
2. **Immediately strips the param from the address bar** via `history.replaceState`, preserving
   any other query params.

**Live-verified on the dev server:** navigating to `http://localhost:3000/?__ejip_qa=1&foo=bar`
resulted in the address bar showing `http://localhost:3000/?foo=bar` and
`sessionStorage.getItem('ejip_qa_suppress') === '1'` — confirming a copied/shared version of that
URL (now `?foo=bar`, no trigger) would **not** suppress tracking for whoever opens it next.

`isQaSuppressed()` is checked client-side before firing `ViewTracker`'s pageview/heartbeat fetches,
`trackEvent()`, `apt-client.tsx`'s direct detail-page log, and the AI-search log call — and the
flag is *also* sent in every request body so the server-side `classifyTraffic()` independently
enforces it (defense in depth: even a call site that forgot the client-side check still can't
write a row).

## 4. Historical Data

Rows written before this STEP's deploy were **not** filtered by any of the above (the gate didn't
exist yet) — Phase 1's own contaminated numbers remain in the table, untouched (no DELETE was
performed, per this STEP's explicit prohibition). The new dashboard surfaces an honest, permanent
note (`historicalDataNote`) rather than claiming the data is clean:

> "내부 테스트 제외 정책(관리자 세션·봇·비운영 환경·QA suppression) 적용 이전에 기록된 데이터에는
> 내부 테스트 활동이 일부 포함될 수 있습니다."

## 5-8. PageView / Events / Search Redaction / Session Definition

- **PageView**: unchanged schema; `/__event__/` prefix still separates events from real pageviews
  everywhere (query layer, existing dashboard) — no formula drift introduced.
- **Events**: `next_action_click` now optionally carries `?action=<NextActionType>` in its
  `/__event__/next_action_click` URL — the same reserved-namespace trick already used for the
  event name itself, so `startsWith('/__event__/')` and `LIKE '/__event__/next_action_click%'`
  checks everywhere (old dashboard included) remain valid unchanged.
- **Search redaction**: `redactSearchQuery()` — normalize → redact (email + phone patterns,
  Korean mobile and area-code formats in one regex) → truncate to 200 chars, in that exact order
  so a PII pattern can never be sliced in half at the truncation boundary and leave a fragment
  exposed. Amounts/apartment names are never redacted (not PII). 10 unit tests, including one that
  specifically constructs a phone number straddling the 200-char boundary and asserts no raw
  digits survive.
- **Session definition**: distinct `sessionId` — UI always labels this "방문 세션" (visit
  sessions), never "순 방문자"/"사용자 수," with an explicit caption
  ("브라우저 세션(익명 sessionId) 단위 집계입니다") on every load of the new dashboard.

## 9. KPIs

Sessions, page views, detail views, compare starts, favorite adds, finance-fit calculates, share
attempts/successes — 7 tiles, matching §13's "5~7개" guidance. All computed in a **single** SQL
query using `COUNT(*) FILTER (WHERE ...)` conditional aggregation over one table scan (see §20).

## 10. Funnel

3 stages, session-counted (never PageView-counted — a session viewing the same detail page 10
times still counts once):
1. **방문** (entry) — any real (non-event) pageview.
2. **단지 상세 확인** (detail) — a pageview with `url LIKE '/apt/%'`.
3. **비교 / 관심 / 자금계산** (decision action) — an event row for `compare_start`,
   `favorite_add`, or `finance_fit_start`.

Labels are deliberately literal ("방문," not "검색 유입") since no real search-session
denominator exists to justify a "검색 전환율" claim (§28). No cross-stage causal attribution is
claimed — the funnel counts sessions reaching each stage within the window, not that stage N
*caused* stage N+1.

**Real numbers observed (read-only verification query, 7-day window):** 97 entry sessions → 58
detail sessions (59.8% of entry) → 3 decision-action sessions (5.2% of detail). Sane, plausible
numbers, not synthetic.

## 11. Popular Apartments

Grouped by `complexId` (`lawdCd|dong|name`), **not** `aptName` alone — this is a real fix over the
existing `/admin/dashboard`'s own popular-apartment query, which groups by `aptName` only and is
therefore vulnerable to exactly the same-name-collision risk this whole project has spent multiple
STEPs eliminating everywhere else. The existing dashboard's query was **not** modified (out of
scope, avoids disrupting it per the task's own "기존 dashboard를 무너뜨리지 않는다"), but this
discrepancy is recorded here so it's not silently forgotten as a future fix candidate for the old
route too.

## 12. Popular Regions

Deliberately a **separate** query/metric from Phase 1's existing search-keyword region ranking
(already shown on `/admin/dashboard`) — grouped by `complexId`'s embedded `lawdCd`/`dong`, labeled
"상세조회 기준 관심지역" so it's never confused with "검색 기준" interest, per the task's explicit
instruction not to blend the two into one number.

## 13. Feature Usage

Exact mapping from the task spec (§14): Search→`SearchLog` count, Compare→`compare_start`,
Favorite→`favorite_add`, Finance Fit→`finance_fit_calculate`, Share→`share_success`. Map and Stats
have no dedicated event, so they're shown with an explicit "추정" (estimate) badge and classified
`PAGEVIEW_PROXY` in the data contract — never silently presented as equally trustworthy as the
event-backed rows.

## 14. Next Actions

`NEXT_ACTION_TYPES` (the real `NextActionType` runtime array, now the single source of truth the
type is derived from) is the only accepted allowlist — validated **server-side** in
`/api/log/event/route.ts`, never trusting the client's string. An invalid/unrecognized value is
**dropped, not the whole event** (per §17's explicit instruction) — the event still records, just
without an actionType. Pre-Phase-2 `next_action_click` rows (no `?action=` at all) are shown as a
clearly-labeled "(미지정 — Phase 2 이전 기록)" bucket rather than being hidden or miscounted —
**live-verified**: the read-only query against real data found exactly 4 such legacy rows, all
correctly bucketed.

## 15. Compare

`compare_start` is labeled "비교 사용" / "비교 시작" — never "비교 실행 완료," since no event
exists for a fully-completed 2-apartment comparison (§30's explicit instruction). Building that
event is out of this STEP's scope.

## 16. Finance Fit

Feature-usage row uses `finance_fit_calculate` per the task's own explicit mapping. No amount,
rate, cash, or loan value is stored or displayed anywhere in this dashboard — this remains
structurally guaranteed by `TrackEventContext`'s fixed shape (unchanged this STEP, still has no
field for any financial value).

## 17. Favorites

`favorite_add` event count only. The dashboard never reads the `Favorite` table directly (that
table is per-user product data — reading it for aggregate analytics would cross into per-user
profiling, which this STEP explicitly avoids per §32/§45).

## 18. Privacy

- **Stored**: nothing new. No new PII field, no new fingerprint, no raw per-session/per-user list
  exposed through the new dashboard (§45) — every value in `BehaviorSummary` is a `COUNT`/
  `COUNT(DISTINCT)`/`GROUP BY` aggregate.
- **Not stored**: financial fields (already impossible), raw un-redacted search text (redacted
  before it ever reaches `SearchLog`), individual `sessionId`/`userId` values (never selected out
  of the query layer).
- **Admin exposure**: aggregate counts and top-10 lists only. No drill-down to an individual
  session exists in this dashboard.

## 19. Admin UI

New route `/admin/behavior`, added as a 4th admin link on `/my` (next to the existing "관리자
대시보드"/"데이터 운영 센터" cards, admin-role-gated identically). Reuses `AuthGate` +
`useSession().user.role === 'ADMIN'` exactly as `/admin/dashboard` does — no new auth code. Range
selector (오늘/7일/30일, `AnalyticsRange`-allowlisted server-side per §48 — an arbitrary range
string falls back to `'7d'` rather than running an unbounded query).

## 20. Query Architecture

**6 total queries per dashboard load** (well under the task's own "몇 개로 묶는다" guidance):
1. One combined conditional-aggregate query over `page_views` (KPI's 8 fields + all 3 funnel
   stage counts — 14 `FILTER (WHERE ...)` clauses, single table scan, single round trip).
2. `SearchLog.count()` (separate table).
3. Popular apartments (`GROUP BY complex_id, apt_name`, `LIMIT 10`).
4. Popular regions (`GROUP BY` on `split_part(complex_id, ...)`, `LIMIT 10`).
5. Next-action breakdown (`GROUP BY` on the parsed `action=` query param).

All run via `Promise.all` (parallel, no waterfall). Cached 5 minutes via the existing
`getOrSetCache` helper (identical TTL convention to `/api/admin/dashboard`'s own cache — no new
number invented, per §49's "다른 formula를 만들지 않는다").

No raw-row materialization anywhere — confirmed by reading every query in `query.ts`: all are
`COUNT`/`COUNT(DISTINCT)`/`GROUP BY`, nothing selects individual PageView rows into JS.

## 21. Indexes

No index added (out of scope this STEP). Existing indexes (`createdAt`, `[aptName, createdAt]`,
`[sessionId, createdAt]`) were sufficient at current volume (~2,754 rows) — the read-only
verification query run against real production data during QA returned in well under a second for
every one of the 6 queries above, with no performance issue observed. A `[complexId, createdAt]`
index remains a flagged-but-deferred Phase 1 recommendation if volume grows enough to need it.

## 22. Deferred Work

- `compare_complete` (real 2-apartment-comparison-finished event) — not built this STEP.
- `[complexId, createdAt]` index — deferred pending volume growth, needs separate approval per
  this STEP's own DB-change constraint.
- Existing `/admin/dashboard`'s `aptName`-only popular-apartment query is not fixed to use
  `complexId` (out of scope — the new dashboard's version is correct; the old one's known gap is
  recorded here, not silently left undocumented).
- Share success rate anomaly observed in real data (successes momentarily exceeding attempts in a
  low-volume window, e.g. 1 attempt / 2 successes in the 7-day sample) — this reflects a
  pre-existing quirk in `useSharePage.ts`'s own instrumentation (it fires `share_success` from two
  separate code paths — native share and clipboard-copy fallback — while `share_attempt` fires
  once), not a bug introduced by this STEP's query logic. Not silently clamped to look "clean" —
  documented honestly instead, and will naturally dilute as real volume grows.
