# ADMIN USER BEHAVIOR ANALYTICS V1 — PHASE 1: Existing Tracking/Events/Admin Architecture Audit

**Date:** 2026-09-03
**Baseline:** `main` @ `8ab9078` (follows `PERCEIVED_PERFORMANCE_V1.md`)
**Scope:** Audit and design only. No schema/migration/index changes, no code changes. READ-only
DB queries (aggregate counts, no row-level personal data extracted or printed). Goal: confirm what
the admin can and cannot currently measure, and produce a Phase 2 implementation plan.

---

## 1. Existing Architecture

Two background research passes (code-level architecture audit + direct read-only production DB
queries) confirm the app already has real tracking infrastructure, just not surfaced as a
dedicated behavior dashboard. There is **no separate `Event` table** — events are `PageView` rows
using a reserved URL namespace `/__event__/<eventName>` (`src/lib/analytics/events.ts`), gated by
a fixed allowlist so arbitrary event names/props can never reach the DB. Presence (`ActiveSession`)
is a fully separate table from `PageView`, updated by heartbeat, not polluting page-view counts.

## 2. PageView

**Schema** (`prisma/schema.prisma` ~line 690): `id, url, complexId (String? = "${lawdCd}|${dong}|
${name}"), aptName, sessionId (required, anonymous, client-generated), userId (nullable), createdAt`.
Indexes: `createdAt`, `[aptName, createdAt]`, `[sessionId, createdAt]`. **No `aptSeq` field** —
predates the aptSeq-first canonical-identity convention established in Decision Journey V1.1.

**Write paths:**
- `ViewTracker.tsx` (mounted once, globally, in `AppProviders`) fires on every pathname change
  (once per navigation, not per re-render) for every route **except** `/apt/*`.
- `/apt/[name]` pages log their own view directly from `apt-client.tsx`, building `complexId` as
  `${lawdCd}|${dong}|${name}` and setting `aptName` — this is why detail-page coverage is
  currently 100% for these two fields (confirmed by direct query, see §4) while every other page
  type has `complexId: null`.
- `/api/log/event` writes a `PageView` row with `url = '/__event__/<name>'`, only if `name` passes
  the allowlist (`isAnalyticsEventName`) — non-allowlisted names are silently dropped, never
  reaching the DB.
- Heartbeat (`/api/log/heartbeat`, every 30s) and leave (`/api/log/leave`, on `beforeunload` via
  `sendBeacon`) **do not write `PageView` at all** — they only touch `ActiveSession`. No heartbeat
  pollution risk to page-view/session counts.

**Production volume** (read-only query, this session, DB has data since 2026-08-11 — ~3 weeks):

| Metric | Value |
|---|---|
| Total PageView rows | 2,754 |
| Last 24h | 195 |
| Last 7d | 1,101 |
| Last 30d | 2,754 (= all-time, DB is younger than 30d) |
| Distinct `sessionId`, 24h/7d/30d | 16 / 100 / 294 |
| Event rows (`/__event__/*`) vs real pageviews, 30d | 16 vs 2,738 |
| `userId` populated, 30d | 589 / 2,754 (~21%) |
| `SearchLog` total rows | 39 |
| `ActiveSession` current rows | 115 |

## 3. Events

**Allowlist** (`ANALYTICS_EVENT_NAMES`, 14 entries): `favorite_add`, `favorite_remove`,
`share_success`, `share_attempt`, `next_action_click`, `compare_start`, `compare_add`,
`compare_remove`, `compare_detail_click`, `compare_share`, `finance_fit_start`,
`finance_fit_calculate`, `finance_fit_from_detail`, `finance_fit_from_compare`.

**Active (real call sites confirmed):** all of the above except **`compare_share`**, which has
**zero call sites anywhere** in `src/` — allowlisted but never fired, per the module's own code
comment acknowledging this gap from the Compare V2 Phase 2 STEP. An admin dashboard must not
imply `compare_share` data exists.

**Payload shape:** every event carries only `{ complexId?, aptName? }` (`TrackEventContext`) — no
event carries an "action type" sub-field. This means `next_action_click` (fired identically from
Map/Compare/Finance-Fit/BUDGET CTAs — see `PERCEIVED_PERFORMANCE_V1`/Decision Journey history)
**cannot currently be broken down by which action type was clicked** — only a raw click count.
This is a real, named gap for §20.

## 4. Coverage

Confirmed via direct query: `/apt/*` views have 100% `complexId`/`aptName` coverage (584/584 in
30d) since that page logs itself directly. All non-detail routes get a real `PageView` row via
`ViewTracker` (`Home`, `/map`, `/stats`, `/stats/compare`, `/finance-fit`, `/my`, `/ai-search`,
etc. all appear in the top-URL breakdown below) — coverage is not missing for any of the routes
listed in the task's §8 checklist. Login itself is NextAuth-managed and not separately
instrumented, but any authenticated page view already carries `userId`.

Top 25 URL prefixes, last 30 days (raw, unfiltered — see §14 for why this list is noisy):

```
/                                          510
/map                                       286
/apt/대신롯데캐슬                            196
/stats                                     184
/redevelopment                             118
/stats/decline                              88
/presales                                   88
/stats/compare                              67
/my                                         66
/stats/gap-invest                           49
/stats/volume                               48
/presales/479                               48
/stats/record-high                          47
/ai-search                                  46
/apt/대신푸르지오1차                          37
...
```

## 5. User/Session

**Current identity available:** anonymous `sessionId` (client-generated, stored in
`sessionStorage`, present on every row), optional `userId` (NextAuth session, ~21% of rows).
**No fingerprinting anywhere** — confirmed via code read, nothing beyond the client-generated
session ID exists.

**Possible today, safely:** a distinct-`sessionId`-count-per-window is a legitimate, privacy-safe
"unique visitor" proxy — already computed above (16/100/294). This is **not** a true unique-human
count (a returning visitor with a cleared `sessionStorage`, or the same person on two devices,
counts twice) — this limitation should be stated plainly in the admin UI, not hidden behind a
confident-looking "방문자" number.

**Limitations:** no session-length/duration field exists (only `createdAt` per row — session
duration would need to be derived as `max(createdAt) - min(createdAt)` grouped by `sessionId`,
computable but not stored). No "new vs returning" distinction is possible from current data (§7
below).

## 6. Apartment/Region

**Apartment:** `complexId` (`lawdCd|dong|name`) is the only identity captured for detail views —
**not `aptSeq`**. Same-name/different-location apartments are already correctly disambiguated by
this composite key (it includes `lawdCd`+`dong`), so today's "popular apartments" query does not
suffer the same-name-collision risk the rest of the app spent multiple STEPs fixing for its own
identity contract — but it is a string key, not the canonical `aptSeq`, so it cannot be joined
against `ApartmentMaster`/trade data by `aptSeq` without a name+dong lookup. Recommendation for
Phase 2: keep `complexId` as the grouping key (it's what exists and it's collision-safe), and treat
adding a real `aptSeq` column as a separate, approval-gated schema decision — not required to ship
a first popular-apartments view.

**Region:** no direct "region view" event exists; region interest today can only be approximated
via (a) `SearchLog`'s existing region-keyword extraction (already live in
`/admin/dashboard`, reusing `detectLeadingRegionKeyword` from `ai-search.ts`) or (b) grouping
`/apt/*` complexId's embedded `lawdCd`/`dong`. No direct `/map` viewport-region tracking exists.

## 7. Search

`SearchLog` (`id, query, userId, createdAt`) is written **only** from the AI-search box
(`ai-search-client.tsx`, on submitted query, not per-keystroke) — 39 total rows since inception.
**Privacy finding:** the raw free-text query is stored **verbatim, length-truncated to 200 chars,
with zero redaction**. Since this is natural-language input (per the task's own §11 concern, "자유
문장 AI search raw query"), it could in principle contain more personal content than a simple
apartment-name search (e.g., "30대 신혼부부 예산 3억" style queries). This STEP does not change
storage (no schema/write changes allowed), but flags it: **existing `SearchLog` storage is
LIMITED-trust for privacy purposes and should not be surfaced to admins as raw text without a
redaction/aggregation layer** — the existing admin dashboard already only surfaces it as a
`groupBy` top-10 count, not a raw query list, which is the right instinct and should be preserved/
extended, never regressed into a raw log viewer.

No `search_start`/`search_result_click`/`search_no_result` events exist today — only the eventual
`SearchLog` write on submission. Whether a search actually led to a detail-page click cannot be
measured today (no linking event).

## 8. Journey

Directly measurable today, session-level, using existing data with zero schema change:
`Home/Search/Map (pageview) → Detail (pageview with complexId) → Compare (compare_start event) →
Favorite (favorite_add event) / Finance Fit (finance_fit_start event)`. All of these already write
real rows carrying `sessionId`, so a session-level funnel (§12/§29/§30) is genuinely computable
today via SQL joins on `sessionId` within a time window — this is a real, not hypothetical,
capability. What's **not** measurable: which specific search or map interaction led to which
specific detail view (no linking ID between a search click and the resulting pageview beyond
temporal proximity within the same session).

## 9. Feature Usage

Directly countable today via the event allowlist: Compare (`compare_start`/`compare_add`),
Favorite (`favorite_add`/`favorite_remove`), Finance Fit (`finance_fit_start`/`_calculate`), Share
(`share_attempt`/`share_success`). **Not countable today:** Score views (no event, though Score is
always shown on every Detail page load so it's implicitly covered by Detail pageviews, just not
separately distinguishable), Map feature usage beyond raw `/map` pageviews (no marker-click event),
Stats feature usage (only raw pageviews per ranking-type URL, already visible in §4's URL
breakdown — this is usable as-is).

## 10. Compare

`compare_start`, `compare_add`, `compare_remove`, `compare_detail_click` (→ Detail from within
Compare), `finance_fit_from_compare` (→ Finance Fit from within Compare) are all real, wired
events. **Gap:** there is no `compare_complete`/`compare_view`-equivalent marking that a full
2-apartment comparison actually rendered (as opposed to a compare session that only ever got to 1
slot) — `compare_start` alone cannot distinguish "opened compare" from "successfully compared two
apartments." `compare_share` is allowlisted but unwired (§3).

## 11. Finance Fit

`finance_fit_start`, `finance_fit_calculate`, `finance_fit_from_detail`, `finance_fit_from_compare`
all exist and are wired. **Confirmed by design (not just by convention):** `TrackEventContext`
structurally supports only `{ complexId, aptName }` — there is no field in the type signature for
`purchasePrice`/`cash`/`loanAmount`/`interestRate`/`income`, so there is no code path by which
these could leak into analytics even by future accident, without a deliberate type change first.

## 12. Favorites

`favorite_add`/`favorite_remove` are real events, separate from the `Favorite` DB table itself
(which stores the actual favorited-apartment records for the product feature, `userId`-scoped, not
an analytics table — per the task's own explicit warning not to conflate the two). Admin-facing
favorite analytics should read the event stream (aggregate counts), never the `Favorite` table
directly (that table is per-user product data, not usage-aggregate data, and reading it for
analytics purposes would cross from aggregate into per-user profiling).

## 13. Share

`share_attempt` and `share_success` are both real, distinct, wired events (`useSharePage.ts`) — a
share success rate (`success/attempt`) is directly computable today with existing data, no new
instrumentation needed.

## 14. Noise/Bots

**This is the audit's most concrete, self-observed finding.** No bot/user-agent/internal-traffic
filtering exists anywhere in the logging pipeline — confirmed by code read (zero matches for
bot/crawler/UA-check terms across every `/api/log/*` route, `ViewTracker`, `presence-server.ts`).
Everything is logged indiscriminately, including the admin's own navigation (nothing exempts
`/admin/*` from `ViewTracker`).

**Direct proof from the production query itself:** "대신롯데캐슬" is the #1 most-viewed apartment
in the last 30 days by a wide margin — 197 of 584 total detail views (~34%). This complex was
repeatedly opened during this session's own live QA testing (map-marker click tests, KakaoMapEmbed
modal tests, ranking-navigation tests, run against `localhost:3000`, which — since no separate
dev/staging `DATABASE_URL` exists in this project, per prior session history — writes to the same
production database as real users). **This is not a hypothetical risk to flag; it is very likely
the actual, current cause of a skewed "popular apartment" ranking in the live data used for this
very audit.** There is currently no field anywhere in `PageView`/`ActiveSession` that distinguishes
`localhost`/QA/preview-deployment traffic from real production user traffic — confirming the
task's own §36 concern is not just plausible but almost certainly already realized in today's data.
Phase 2 must not ship a "popular apartments" widget without addressing this, or it will visibly
mislead the admin on day one.

## 15. Privacy

| Field/Event | Classification | Why |
|---|---|---|
| `sessionId` (anonymous) | SAFE | client-generated, not linked to real identity unless `userId` also present |
| `userId` (nullable) | SAFE | already-existing NextAuth identity, not new collection |
| `url`, `complexId`, `aptName` | SAFE | product-navigation metadata, no personal content |
| `favorite_add/remove`, `share_*`, `compare_*`, `next_action_click` events | SAFE | boolean/count-style, `TrackEventContext` structurally excludes financial/personal fields |
| `finance_fit_*` events | SAFE | same structural guarantee — no numeric financial payload possible |
| `SearchLog.query` (raw AI-search text) | LIMITED | free-text, no redaction; safe to keep writing (pre-existing, not new), but must only ever be *surfaced* to admins in aggregated/grouped form, never as a raw per-user log |
| Any future income/cash/loan/password/token field | DO_NOT_COLLECT | explicitly banned by this task and by `finance-fit`'s own existing type contract |

## 16. Admin Current Capability

Three admin pages exist today, all gated by the same `requireAdmin()` (server) + `proxy.ts`
(`/admin/:path*` matcher, role/email check) — this STEP reuses that auth as-is, no new auth
designed.

- **`/admin/dashboard`** — **already shows real PageView-derived usage stats**: today's
  PV/UV (excluding `/__event__/` rows), online-now count (`ActiveSession`), realtime "who's
  viewing which apt," 30-day popular apartments (`groupBy aptName`), top `SearchLog` queries +
  region-keyword ranking, community counts, error log, pipeline health, and a 7-day event-name
  breakdown parsed from the `/__event__/` prefix. **The audit's initial assumption (task's own §26
  framing, "admin이 현재 파악할 수 있는지 확정되지 않았다") undersells what already exists** — a
  real, if partial, usage-analytics section is already live, not absent.
- **`/admin/ops`** — pure data-health/pipeline-integrity (TradeHistory coverage, sync manifest,
  cancellation-verification, feature-trust table). No user-behavior data, correctly separated.
- **`/admin/users`** — user list + ban/unban. No analytics.

## 17. Query Architecture

Existing `/api/admin/dashboard` route already follows the right pattern — `groupBy`/`count`
aggregate queries, not raw-row materialization in Node, and is already cached (5-minute TTL, per
`ADMIN_OPS_V1` STEP history) to keep repeated dashboard loads cheap. Phase 2's new behavior-focused
views should extend this exact pattern (SQL `GROUP BY`/`COUNT`/`COUNT(DISTINCT ...)`, no full-table
reads into JS), which this audit's own read-only queries (§2, §14) already demonstrate is fast
enough at current volume (2,754 total rows — every query in this audit returned in well under a
second).

## 18. Indexes

Current indexes (`createdAt`, `[aptName, createdAt]`, `[sessionId, createdAt]`) already cover the
query shapes this audit ran (date-range filters, per-session lookups, per-apartment-name grouping)
at current volume. **No index gap severe enough to block Phase 1's conclusions was found** — at
2,754 total rows, sequential scans are still fast. **This will not remain true indefinitely**: a
`complexId`-based grouping query (§6/§14) has no dedicated index today; if/when volume grows
materially, a `[complexId, createdAt]` index would help the popular-apartments aggregation
specifically. Per this STEP's own scope rule, **no index is added now** — flagged for a
separate-approval Phase 2 decision if volume growth warrants it, not assumed necessary today.

## 19. Data Contract

Proposed (design only, not implemented):

```ts
// src/lib/admin-analytics/types.ts (proposed)
interface AnalyticsSummary {
  range: 'today' | '7d' | '30d';
  pageViews: number;
  uniqueSessions: number;        // distinct sessionId — labeled as a proxy, not "users"
  detailViews: number;
  compareStarts: number;
  favoriteAdds: number;
  financeFitStarts: number;
  shareAttempts: number;
  shareSuccessRate: number | null; // null if shareAttempts === 0, never displayed as 0%
}

interface FeatureUsage {
  feature: 'search' | 'map' | 'score' | 'compare' | 'favorite' | 'financeFit' | 'stats' | 'share';
  count: number;
  trust: 'MEASURED' | 'PAGEVIEW_PROXY'; // MEASURED = real event exists; PAGEVIEW_PROXY = inferred from raw pageview count only (e.g. Score, Map)
}

interface PopularApartment {
  complexId: string;   // lawdCd|dong|name — existing identity, not aptSeq
  aptName: string;
  lawdCd: string;
  dong: string;
  viewCount: number;
}

interface PopularRegion {
  lawdCd: string;
  regionLabel: string;
  detailViewCount: number;
  searchKeywordCount: number; // kept as a SEPARATE field, never summed into one blended metric (§18 task requirement)
}

interface JourneyFunnelStep {
  step: 'entry' | 'detail' | 'compareOrFavoriteOrFinance';
  sessionCount: number;      // distinct sessions reaching this step within the window
  conversionFromPrevious: number | null; // sessionCount / previous step's sessionCount
}
```

## 20. Phase 2 Scope

See §26/§29/§31 of the final report below for the full recommendation; summary: **Option A/B
(reuse existing `PageView`+event data, extend query/dashboard layer only)** — no new schema needed
to deliver a first real behavior dashboard. The one prerequisite that should ship *before* any
popular-content widget is trusted: a bot/internal/QA traffic exclusion strategy (§14), since this
audit directly proved today's raw data is already skewed by the audit's own testing traffic.
