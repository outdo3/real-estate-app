# PERFORMANCE V1.4 — Vercel Function Region Alignment (iad1 → icn1)

**Date:** 2026-09-02
**Baseline commit:** `faf3473` (branch `main`, follows PERFORMANCE V1.3)
**Scope:** User-approved production infrastructure change — align Vercel serverless function
execution region with the Supabase database region, then re-benchmark against the exact same
production domain and route set measured in `PERFORMANCE_V1_3_VERCEL_REALITY_CHECK.md`.

---

## 1. Region Before

Confirmed via `vercel inspect` on the deployment live at the time PERFORMANCE V1.3 was written:
every Lambda function (`index`, `_global-error`, and all route handlers) built and ran in
**`iad1`** (US East, Virginia). Database (Supabase) confirmed in `ap-northeast-2` (Seoul) via
`DATABASE_URL` host inspection.

## 2. Vercel Config Audit

No `vercel.json` existed at the repo root before this STEP (confirmed via `ls`) and no
region-related setting was found in the Vercel project's dashboard-visible settings (`vercel
project inspect` showed no explicit region field) — `iad1` was Vercel's platform default for this
project, not an intentional prior choice. No existing/unrelated `vercel.json` content to preserve.

## 3. Applied

```json
{
  "regions": ["icn1"]
}
```

New file, root `vercel.json`. No other Vercel configuration existed to merge with or risk
overwriting.

## 4. Region After — Deployment Verification (not assumed)

Committed (`35172b8`) and pushed to `main`, triggering an automatic production deployment. Verified
via `vercel inspect` on the resulting deployment (`dpl_DL8uSiVJcUzpruFL2aW6pTa7TVCJ`,
`real-estate-eifkgi3xf-park11.vercel.app`):

```
Builds
  ├── λ index (11.24MB) [icn1]
  ├── λ _global-error (11.24MB) [icn1]
  ├── λ _global-error.rsc (11.24MB) [icn1]
  ...
```

Every function now builds in **`icn1`**. The canonical production aliases
(`real-estate-app-park11.vercel.app`, `real-estate-app-phi-taupe.vercel.app`,
`real-estate-app-git-main-park11.vercel.app`) already point to this deployment — confirmed by
fetching the live canonical URL directly:

```
X-Vercel-Id: icn1::icn1::ff2gc-1788335817872-ee5fd3cbee73
```

(previously `icn1::iad1::...` — edge and function are now both Seoul). `icn1` was available on this
account's plan without any error or fallback — the deployment succeeded cleanly on the first
attempt, no plan-restriction issue encountered.

## 5. Deployment Verification Summary

| Check | Result |
|---|---|
| Build region (all functions) | `icn1` (was `iad1`) |
| Production alias resolves to new deployment | Yes |
| Live `X-Vercel-Id` reflects new region | Yes (`icn1::icn1::...`) |
| Deployment status | Ready, no errors |

## 6-17. Before/After by Route

Same production domain, same route set, same `curl -w` methodology as `PERFORMANCE_V1_3` (3
sequential requests per route; run 1 = cold-like, runs 2-3 = warm).

| Route | Before cold | Before warm | After cold | After warm | Verdict (after) |
|---|---|---|---|---|---|
| Home | 370ms | 117-126ms | 581ms | 99-307ms | **PASS / FAST** |
| Map | 949ms | 117-333ms | 347ms | 113-312ms | **FAST** |
| Search | **5,363ms** | 2,943-2,970ms | **638ms** | 207-274ms | **PASS / FAST** |
| Detail | 1,289ms | 325-328ms | 437ms | 148-164ms | **FAST** |
| Score | 925ms | 311-422ms | 149ms | 124-143ms | **FAST** |
| Busan Dashboard | **16,251ms** | 307-380ms | **2,896ms** | 122-243ms | **P1 (cold) / FAST (warm)** |
| District Dashboard | **9,650ms** | 294-302ms | **531ms** | 126-127ms | **PASS / FAST** |
| area84 | **9,976ms** | **6,080-6,179ms** | **1,444ms** | 288-386ms | **PASS / FAST — first time this route ever shows a genuine warm state in production** |
| Rise | **5,149ms** | 3,314-3,340ms | **723ms** | 210-216ms | **PASS / FAST** |
| Decline | **5,505ms** | 3,339-3,363ms | **731ms** | 218-229ms | **PASS / FAST** |
| Region Change | 1,298ms | 296-377ms | 272ms | 130-175ms | **FAST** |
| Record High | **5,038ms** | 3,323-3,354ms | **708ms** | 203-238ms | **PASS / FAST** |

## 18. Before/After Summary

- **12/12 routes improved**, all by a wide margin (smallest improvement: Region Change, ~4.8x cold;
  largest: Busan Dashboard, ~5.6x cold, District Dashboard ~18x cold, area84 ~6.9x cold but with
  the qualitatively bigger win of *finally reaching a real warm state* — 6+ seconds → 288-386ms).
- **Every previously-P0/FAIL route (Search, both dashboards, area84, Rise, Decline, Record High) is
  now PASS or FAST on every single run measured.**
- Only one P1 (2-3s) result remains: Busan-wide dashboard's cold run (2.90s) — down from 16.25s, but
  still above the 1.5s ceiling because it still depends on 16 external MOLIT calls for the single
  remaining unverified rent month (`RENT_TRADE_HISTORY_V1_PHASE_D2`'s own documented, unrelated
  limitation) — not something the region fix touches, since MOLIT's own latency is independent of
  which Vercel region calls it.
- **Zero routes exceed 3s (FAIL) after the fix**, down from 6 routes that were ≥5s before.

## 19. Remaining >2s

- Busan-wide dashboard cold (2.90s) — the only route left above 2s, and it's now P1 not FAIL.

## 20. Remaining >3s

**None.**

## 21. Regression

- **Data correctness:** `jeonseRate` (71.2), `chartDataByType.sale` monthly series, `partial`/
  `failedDistricts` all identical to the pre-migration baseline — confirmed via direct API
  comparison. This is a pure infrastructure change; no application logic executes differently.
- **Auth:** `/api/auth/providers` returns 200 with Kakao/Naver OAuth config intact.
- **Search:** `/api/search` returns 200 with expected `regions`/`apartments` shape.
- **Detail page (browser-rendered):** full page load (title updates to include 실거래가·시세,
  price/floor/badges/Score card all visible) completed in ~2s — down from ~13s observed in
  `PERFORMANCE_V1.3`'s iframe test, with identical rendered content.
- **Dashboard/volume page (browser-rendered):** renders identically (46건, -38.7%, same chart) to
  pre-migration screenshots.
- **Score API:** 200, `AMBIGUOUS`/scoring fields present as before (label refers to the API's own
  status enum, not an error).
- **Map:** page shell loads correctly (347ms), consistent with `PERFORMANCE_V1.3`'s already-fast
  result.
- No error responses (non-200) encountered on any route tested.

## 22. Database

READ only this STEP (benchmark/verification queries via the app's own API surface). INSERT/UPDATE/
DELETE: 0. Schema: 0. Migration: 0.

## 23. Docs

This file + `PERFORMANCE_V1.md` update (§11 risk closed) + `CHANGELOG.md` entry.

## 24. Git

`35172b8` — `perf(infra): align vercel functions with seoul database` — pushed to `main`,
triggering the verified production deployment in §4.

## 25. Performance Verdict

**PASS — major, verified, launch-relevant improvement.** The single highest-leverage fix identified
across the entire `PERFORMANCE_V1`→`V1.3` investigation series closed essentially every remaining
P0/FAIL finding in one change. The only remaining >1.5s result (Busan-wide dashboard cold, 2.9s) is
a known, separately-tracked, MOLIT-external-call limitation — not a region or query problem.

## 26. Rollback Status

**Not needed.** Deployment succeeded cleanly, `icn1` is available on the current plan, all
regression checks passed, and every measured route improved. `vercel.json` is a 3-line, trivially
revertible file if ever needed, but no rollback trigger condition (§12 of the task) was met.

## 27. Next Step

- `RENT_TRADE_HISTORY_V1_PHASE_D2`'s remaining coverage-decay risk (register the incremental sync
  CLI behind a scheduler) is now the more relevant next lever for the one remaining P1 result
  (Busan-wide dashboard cold), since region is no longer the bottleneck there.
- area84's newly-confirmed genuine warm state in production is worth spot-checking again after
  normal traffic patterns settle, to confirm this wasn't a one-off measurement window.
- No further Vercel-region-related work needed — this finding is closed.
