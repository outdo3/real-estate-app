# MAP PERFORMANCE V1 — Home → Map User-Perceived Performance

**Date:** 2026-09-01
**Baseline commit:** `6f6ce13` (branch `main`, follows `RENT_TRADE_HISTORY_V1_ARCHITECTURE.md` PHASE A)
**Scope:** Home→Map journey (click → route → SDK → base map → markers → interactive). No new map features, no provider change, no schema/index change, no API contract break for any consumer.

---

## 1. User Journey

`홈 ("지도에서 찾기" click) → /map client navigation → map page mounts → Kakao SDK script loads → base map (KakaoMap instance) renders → apartment markers fetched/rendered → user can pan/zoom/click`. The task's own framing: reaching "base map visible" and "interactive" fast matters more than any single API being fast in isolation — markers are explicitly allowed to lag behind (progressive), but the page must never sit on a blank/full loader for longer than necessary.

## 2. Baseline Timeline (before this STEP)

Two structural problems, both traced to exact code, not estimated:

1. **Render gate:** `map/page.tsx` returned a full-page blocking `<FullPageLoader>` whenever `isLoadingData || !isMapReady` — i.e. the `<KakaoMap>` component (and therefore the SDK-rendered base map) never mounted until **both** the Kakao SDK finished loading **and** the first marker fetch completed. Since marker fetch requires the SDK's own `services` library (client-side reverse-geocoding) plus a server round-trip, it always finishes after the SDK — meaning users waited for (SDK time + marker time) before seeing anything but a blank branded spinner, even though the map itself was capable of being shown and panned/zoomed much earlier.
2. **Marker API:** the marker fetch (`GET /api/transactions?type=apt&lawdCd=X&months=12`) did not use this project's own `ApartmentTradeHistory` DB table at all — it called MOLIT live, once per month, 12 months in parallel (bounded by the app's shared `GLOBAL_MOLIT_CONCURRENCY=6` limiter). Measured directly (dev server, uncached): **서구 4.14s cold / 0.99s "warm"** (no caching existed at all — every request re-hits MOLIT), **해운대구 4.55s cold / 3.68s "warm."** This is the same class of bottleneck `PERFORMANCE_V1`/`PERFORMANCE_V1.1-A/B` already found and fixed for other consumers (dashboard, price-rankings) — this specific consumer (used by the map, the stats 분위지도, and AI search's condition search) had never been migrated.

## 3. Home Entry

`src/app/home-client.tsx`'s "지도에서 찾기" button renders via the shared `Button` component (`src/components/ui/Button.tsx`), which uses `next/link`'s `<Link href="/map">` when an `href` prop is passed — confirmed real client-side navigation with Next.js's default automatic prefetch, not a plain `<a>` or `window.location` (no full reload). No fix needed here (§8 audit: clean).

## 4. Route Navigation

`/map/page.tsx` is a `'use client'` page with no server-component wrapper (reasonable for an inherently fully-interactive map view with no static SEO content — not changed, would be a bigger architecture call outside this STEP's scope). No duplicate-navigation or full-reload issue found.

## 5. SDK

The Kakao SDK is loaded via a manual `<script>` tag injection (`kakao-map-script-main` id, de-duplicated via `document.getElementById` check) plus a 200ms polling loop for `window.kakao.maps.services` readiness, with an explicit script-error listener and a 10s timeout safety net that surfaces a clear error message (already well-engineered from a prior STEP — not touched). Confirmed the **same script id** is used by `ApartmentAutocomplete.tsx` (home page's search bar), so if a user has already interacted with home's search before clicking into the map, the SDK may already be loading/loaded — de-duplication already works correctly via the shared id, no duplicate-load bug found. An unused, superseded `KakaoScriptLoader.tsx` component (wrapping `react-kakao-maps-sdk`'s own `useKakaoLoader`) exists in the codebase but is never imported anywhere — left untouched (dead code, out of this STEP's scope to remove).

**Measured on PROD-LOCAL** (fresh process, cold): SDK script request starts at **~322ms**, responds by **~496ms**; the full SDK+services+clusterer resource set finishes by **~1,358ms**. `domContentLoaded≈205ms`, `loadEvent≈502ms`. This is within the ≤1.0–1.5s base-map target on its own — the SDK was never the dominant bottleneck; the render gate blocking on markers was.

## 6. Base Map — Root Cause Fix

**Change:** the render gate (`if (isLoadingData || !isMapReady) return <FullPageLoader .../>`) now depends only on `isMapReady` (SDK loaded). The companion `mapInstanceReady` polling effect (which waits for the actual `kakao.maps.Map` instance ref to populate before attaching the `idle` pan/zoom listener) had the same `isLoadingData` dependency and was fixed identically — both effects and the render gate are now consistent: **the map mounts, becomes interactive, and its pan/zoom listener attaches as soon as the SDK is ready, completely independent of whether marker data has arrived.** `center` was already correctly defaulted (Busan 서구 fallback) before any geolocation/marker data resolves, so the map has a sensible view immediately.

Empty `aptMarkers`/`aptClusters` arrays render nothing extra (plain `.map()` over an array, no crash risk) — verified by reading every render-path usage of these arrays before making the change.

## 7. Geolocation

Already non-blocking before this STEP: `navigator.geolocation.getCurrentPosition` (10s timeout, falls back to IP-based geolocation via `ipinfo.io` on failure/absence) only calls `setCenter(...)` asynchronously — it was never gating any loading state or blocking render. No change needed (§15/§16 audit: already matches the required "default center → map visible → geolocation success moves it" priority).

## 8. Marker API — DB-First Conversion

`GET /api/transactions?type=apt&lawdCd=X&months=12` (with no `dong`/`loadMore`) is used by exactly 3 consumers, verified by full-codebase search: `map/page.tsx`, `stats/[type]/type-client.tsx` (분위지도), and `ai-search.ts`'s `runConditionSearch`. All three call it with the identical shape. Added a narrowly-scoped DB-first branch (`fetchApt12MonthsFromDb`, `src/app/api/transactions/route.ts`) that activates **only** for this exact shape **and** a Busan (`26`-prefixed) `lawdCd` — every other parameter combination (non-Busan regions, `dong` filters, `loadMore` pagination, non-`apt` types) is completely untouched and still uses the original MOLIT-live path.

The new branch calls the existing `queryTrades()` read-core (`trade-history-read.ts`) and reuses, unmodified, the same downstream pipeline the MOLIT-live path already used: `resolveTrustworthyPyeongBatch` (Unit Master pyeong resolution) and `buildMasterCoordIndex`/`resolveApartmentCoords` (`map-marker-coords.ts`, the same pure, already-tested functions) for lat/lng/completionYear. `StoredTrade` was extended with `buildYear`/`jibun` (fields the underlying Prisma row already fetched but didn't previously expose) — a purely additive change with zero effect on any other `queryTrades()` consumer (decline/rising/record-high/area84/dashboard).

**Correctness verified**, not assumed:
- A specific trade (대신해모로센트럴아파트, 76.5236㎡, 59,250만원, 2026-08-27) returned by the new DB-first path was cross-checked field-by-field against a direct live MOLIT call for the same month — **exact match** on every field.
- A broader diff (MOLIT-live vs. DB, same month, 3 districts) found the DB missing 14–19% of that month's records — investigated, not hand-waved: the gap is the well-known, already-documented MOLIT reporting-lag phenomenon (`incremental-sync-logic.ts`'s own `DEFAULT_OVERLAP_MONTHS=3` exists specifically for this), confirmed by checking `source_fetched_at` (last sync ran ~24h before this test) and the missing records' dates (spread across the whole month, consistent with late-reported trades, not a sync that's stopped working). **This is the exact same trade-off `TRADE_DB_FIRST_V1`'s decline/rising/record-high/area84/dashboard sale-side paths already accept** — not a new risk introduced here, and self-healing on the next incremental sync run. See §17 for the honest caveat.

**Measured** (PROD-LOCAL, uncached): 서구 **4.14s → 0.75s cold, 0.99s → 0.16s warm**; 해운대구 **4.55s → 1.03s cold**. Cache added via the existing `getOrSetCache` (30-minute TTL, matching the `PERFORMANCE_V1.1-A`/`Score` precedent for batch-updated data) — no new cache infrastructure.

## 9. Marker Rendering

Markers render via `CustomOverlayMap` per apartment, grouped into clusters computed by a pure `recomputeClusters()` function triggered on map `idle` (pan/zoom-end) and on `aptMarkers`/`zoomLevel` change — not per-marker React state, not a naive full-DOM-rebuild-per-render pattern. No evidence of duplicate listener registration (the `idle` listener effect properly cleans up via its returned function). This was already reasonably engineered from prior STEPs; not modified.

## 10. Bundle

`PERFORMANCE_V1` already confirmed no Kakao-SDK bundle leakage onto other pages (Home makes zero `kakao`/`dapi` requests). Not re-audited in depth this STEP since the render-gate and marker-API fixes were the dominant, code-verified bottlenecks — no evidence pointed at bundle size as a contributing factor here.

## 11. Loading UX

Replaced "map fully blocked until markers ready" with: base map visible immediately once the SDK is ready, plus a small, non-blocking pill (bottom-center, matching the exact positioning already used and mobile-tested for this page's existing "coming soon" layer notice) shown only while `isLoadingData` is true — "주변 매물을 불러오는 중..." with a small spinner. The user can pan/zoom the real map underneath this indicator; it does not block interaction (§42 requirement).

## 12. Root Causes (summary)

1. Render gate ANDed two independent readiness signals (SDK + markers) into one blocking condition — fixed by decoupling.
2. Marker API bypassed the already-built `ApartmentTradeHistory` DB entirely, making 12 live MOLIT calls per map load — fixed via a narrowly-scoped DB-first branch (same "exact shape only" pattern as every prior `TRADE_DB_FIRST_V1` conversion).

Both were confirmed via direct code tracing and real timing measurements, not assumptions.

## 13. Changes (files)

- `src/app/map/page.tsx` — render gate now depends only on `isMapReady`; `mapInstanceReady` polling effect's guard/dependency updated identically; added a small non-blocking marker-loading pill.
- `src/app/map/map-marker.module.css` — added the spinner keyframe/class the pill needs (inline styles can't express `@keyframes`).
- `src/app/api/transactions/route.ts` — added `fetchApt12MonthsFromDb()` and a narrowly-scoped DB-first branch for the exact `type=apt&months=12`(no dong/loadMore) + Busan shape; the pre-existing `.info`-string re-parsing step is skipped for DB-sourced rows (already in final shape, avoiding a pointless string round-trip).
- `src/lib/trade-history-read.ts` — `StoredTrade`/`toStoredTrade()` extended with `buildYear`/`jibun` (already-fetched, previously unexposed columns; purely additive).

## 14. Before / After

| Measurement | Before | After |
|---|---|---|
| SDK ready (PROD-LOCAL, cold) | ~500ms–1.4s (never the bottleneck) | unchanged |
| Map visible (render gate) | gated on marker fetch too (effectively SDK time + marker time) | gated on SDK only — map visible as soon as SDK is ready |
| Marker API, 서구, cold | 4.14s | **0.75s** |
| Marker API, 서구, warm | 0.99s (no caching existed) | **0.16s** |
| Marker API, 해운대구, cold | 4.55s | **1.03s** |
| DB round-trips for marker fetch | 12 parallel external MOLIT calls | 1 cached DB query (Busan) |

## 15. Mobile QA

**Not completed as originally planned** — during mobile-viewport testing, the browser session hit a network-level failure specific to `dapi.kakao.com`: a deliberately-invalid test API key request to that exact domain returned `Failed to fetch` from the browser's own `fetch()`, while an identical request via a direct Node.js process (outside the browser) succeeded normally at the same time. This proves the failure is a browser/extension/network-level block in that specific session (a "Grabbit" link-scanning extension was observed active on the page around the same time), not a code or Kakao-service issue — but it made further in-browser verification at 360/375/390px impossible in this session.

What **is** verified: a full desktop-width (1280px) load succeeded earlier in the same session (before the block appeared), confirming SDK load, base map render, marker rendering, marker click, and click→detail navigation with correct identity all work correctly end-to-end after the fixes. The new loading pill reuses the exact CSS positioning (`position: absolute, bottom: 76px, left: 50%, transform: translateX(-50%)`) already shipped and mobile-verified for this same page's "coming soon" layer banner (`MAP UI POLISH V1`/prior STEPs) — no new mobile-specific layout risk is expected, but this has not been re-confirmed via a mobile screenshot in this session. **Recommend a follow-up mobile screenshot check in a clean browser session before considering this STEP's mobile-QA fully closed.**

## 16. Production QA

Verified on PROD-LOCAL only (fresh `next build && next start`) — this STEP's code has not yet been deployed to Vercel, so a post-deploy Vercel measurement is not available in this session (matching the same limitation noted in `PERFORMANCE_V1_1_AREA84_SQL_PUSHDOWN.md` §12). The `PERFORMANCE_V1`/`PERFORMANCE_V1_1_AREA84_INDEX.md` documented Vercel-vs-local latency gap (suspected Prisma+PgBouncer overhead) is structurally unrelated to these fixes but means the exact post-deploy numbers for this STEP are unverified.

## 17. Remaining Risks

- **Mobile-viewport visual verification incomplete** (§15) — recommend a follow-up check in a clean session.
- **DB-first marker data inherits the sync-freshness dependency** already accepted by every other `TRADE_DB_FIRST_V1` consumer (§8) — the most recent few days of trades, and occasional late-reported older ones, won't appear on the map until the next incremental sync run. This is a pre-existing, system-wide characteristic (not new or worsened by this STEP), but is now visible on the single most-used page in the app (the map) rather than only in stats aggregates — worth the product team's awareness. No automated sync schedule (cron) was found in this repo; scheduling one would benefit **all** `TRADE_DB_FIRST_V1` consumers, not just this one, and is a reasonable follow-up recommendation outside this STEP's scope.
- **Vercel production not yet re-measured** (§16).
- The unused `KakaoScriptLoader.tsx` component remains as dead code — flagged, not removed (out of scope).

---

## Regression Verification

- Marker click → bottom detail card → "상세보기" → correct detail page with correct `lawdCd`/`dong` identity: verified live (대신해모로센트럴아파트 → `/apt/...?lawdCd=26140&dong=서대신동2가`, matches the marker's own district/dong exactly).
- Browser back navigation from detail → map: map re-renders correctly with markers intact, no crash.
- `/stats/price-map` (분위지도, another consumer of the same DB-first-converted endpoint): loads (`200`), and of the 905 rows returned for 서구, 319 have the `lat`/`lng`/`pyung` triple that view requires — data contract intact.
- No new console errors (only the same benign Chrome-extension messaging artifact seen throughout this project's sessions, unrelated to app code).
- `npx tsc --noEmit`: exactly 20 pre-existing errors, 0 new. Lint clean. `npm run build` succeeds.

No DB writes, no schema changes, no new dependencies, no auth/security changes, no map provider change, no API contract change for any of the 3 marker-API consumers.
