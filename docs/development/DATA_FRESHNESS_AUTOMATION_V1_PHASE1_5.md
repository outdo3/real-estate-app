# DATA FRESHNESS AUTOMATION V1 — PHASE 1.5: Activation Readiness Fix

**Date:** 2026-09-03
**Baseline:** `main` @ `5738215` (follows `DATA_FRESHNESS_AUTOMATION_V1_PHASE1.md`)
**Scope:** Fix the two pre-activation blockers Phase 1 proved with real evidence. **No Production
APPLY, no Cron registration, no Production DB write.** Every claim below is backed by a real
dry-run or unit test executed this session — `git status` confirmed zero unintended writes after
every step.

---

## 1. Sale Pagination Bug

Root cause reconfirmed exactly as Phase 1 documented: `fetchMolitData()` (`src/lib/api-molit.ts`)
requests `numOfRows=1000` with no `pageNo`/`totalCount` verification. The sync engine's
`fetchOneRegionMonth()` (`scripts/backfill-trade-history.ts`) called this directly, so any
district-month with genuinely >1,000 sale trades would be silently truncated with no signal.

## 2. Pagination Fix

**Design decision:** did **not** modify `fetchMolitData()` itself — it's used by many live
user-facing paths (search, detail, dashboard) that only ever need "recent trades," not full-month
completeness; changing its behavior there would be unnecessary risk for zero benefit. Instead:

- Extracted `fetchMolitData()`'s item-mapping logic into an exported pure function `mapMolitItems()`
  (same file) — byte-identical output, zero behavior change for `fetchMolitData()`'s existing
  callers (confirmed: `fetchMolitData` still ends by calling `mapMolitItems()` with the exact same
  inputs it always computed).
- Built `scripts/sale-molit-fetch.ts` (`fetchSaleRegionMonth()`) — a dedicated paginated fetcher
  mirroring the already-proven `scripts/rent-trade-history/rent-molit-fetch.ts` pattern exactly
  (same retry/backoff/rate-limit constants, same `totalCount`-driven page loop), reusing
  `mapMolitItems()` per page so its output shape is identical to `fetchMolitData()`'s.
- Built `scripts/sale-pagination-logic.ts` (`classifySaleCellCompleteness()`) — the same
  COMPLETE/EMPTY_VALID/PARTIAL/INVALID model rent already uses, kept as sale's own independent
  copy (matching this project's existing convention of per-pipeline status enums — rent's own file
  explicitly documents choosing NOT to force-share sale's original enum, so sale doesn't force-share
  rent's either; this also means zero risk to rent's already-proven, already-tested code).
- Swapped `fetchOneRegionMonth()`'s **internals only** to call `fetchSaleRegionMonth()`. Its
  external signature `{items, failed}` is unchanged, so its 3 existing callers (`backfill-trade-
  history.ts` itself, `resync-cancellation-v2.ts`, `incremental-sync-nationwide.ts`) needed zero
  code changes. Any non-COMPLETE/EMPTY_VALID result (including PARTIAL — some pages succeeded, not
  all) is treated as `failed: true` with empty items — never trust a partial collection as if it
  were complete; this naturally routes into each caller's existing "retry next run" logic without
  requiring any of them to learn a new status.

## 3. Sale Dry Run

Re-ran the **exact same** dry-run command from Phase 1 (16 Busan districts, `--overlapMonths=1`,
no `--apply`) after the fix:

```
REGIONS resolved=16
START apply=false regions=16 overlapMonths=1 cells=17
PROGRESS 17/17 fetched=71 invalidRows=0 insert=23 flipFalseToTrue=0 skippedTrueToFalse=0
  conflicts=0 reviewRequired=0 COMPLETE=11 EMPTY_VALID=6 FAILED=0 INVALID=0 elapsed=13.5s
DONE mode=DRY_RUN regions=16 cells=17 COMPLETE=11 EMPTY_VALID=6 FAILED=0 INVALID=0
  insert=23 ... SAFE_GATE=true elapsedSec=13.5
```

**Identical results to Phase 1's pre-fix run** (fetched=71, insert=23, COMPLETE=11,
EMPTY_VALID=6, FAILED=0, INVALID=0) — proves zero regression: at current Busan volume (well under
1,000/month per district, confirmed in Phase 1), every cell still fits in one page, so the fix is
invisible in output but now actively verifies `totalCount` on every cell instead of blindly
trusting page 1. `git status` after this run showed no manifest/file changes (dry-run correctly
persisted nothing).

## 4. Rent Manual Coverage Root Cause

Reconfirmed: `RENT_VERIFIED_FROM`/`RENT_VERIFIED_TO` (`src/lib/rent-verified-range.ts`) were plain
`const` literals a human had to edit after every real sync — the sync script only printed a
reminder, never wrote the update itself. Used by exactly one consumer,
`src/lib/rent-history-read.ts` (confirmed server-only — imports `prisma`, so no client-bundle risk
from anything this STEP added).

## 5. New Coverage Architecture

Chose **Option D: reuse sale's manifest pattern** (a git-tracked JSON file, read live at call
time) — the same architecture sale's `data/trade-history/nationwide-sync-manifest.json` already
uses and that's already integrated into `/admin/ops`. New file:
`data/rent-trade-history/coverage-manifest.json`, shape:

```json
{ "legacyBootstrap": { "from": "202408", "to": "202608", "source": "...", "bootstrappedAt": "..." },
  "cells": { "<lawdCd>:<dealYmd>": { "status": "COMPLETE" | ... } } }
```

`RENT_VERIFIED_FROM`/`RENT_VERIFIED_TO` are now computed at module load by reading this file and
walking forward from `legacyBootstrap.to` — **the exported constant names and their consumer's
import statement are completely unchanged**, so `rent-history-read.ts` needed zero edits.

## 6. Manifest/Provenance

`computeVerifiedRangeFromManifest()` (exported, pure, in `rent-verified-range.ts` itself — kept
in the same file rather than a separate importable module, to respect the file's documented
constraint that its own `.test.mjs` toolchain can't resolve extensionless relative imports between
local `.ts` files; `fs`/`path` are Node builtins and unaffected by that constraint, confirmed
empirically by re-running the existing test after adding them):

- `from` is always `legacyBootstrap.from` — never extended backward.
- `to` walks forward one month at a time from `legacyBootstrap.to`, requiring **all 16 districts**
  to show `status: 'COMPLETE'` in `cells` for that month before advancing; stops at the first gap.
- Hard-guards against ever including the current (in-progress) calendar month, independent of
  whatever the manifest might claim — a second, defense-in-depth enforcement of §17's absolute
  rule, not reliance on a single upstream check.
- On any read/parse failure, falls back to the exact same `202408`/`202608` values the old
  hardcoded constants held — not a guess, the last real proven value.

## 7. Historical Bootstrap

`legacyBootstrap` carries the existing `202408`–`202608` range forward **as-is, explicitly
labeled as not re-verified this STEP** (no Production APPLY was performed to re-check it against
the new pagination-aware completeness standard) — its `source` field documents this honestly. This
preserves the historical range without silently upgrading its trust level or performing any new
verification work this STEP wasn't scoped to do.

## 8. Dry-run Safety

`shouldRecordCoverageCell(mode, status)` (`scripts/rent-trade-history/rent-coverage-writer-logic.ts`)
— pure decision logic for the *future* apply-mode sync script: `dry-run` mode **never** returns
true regardless of status; `apply` mode only returns true for `COMPLETE`/`EMPTY_VALID`. This isn't
wired into a live sync path this STEP (that would require performing real applies, out of scope),
but the safety logic itself is built and unit-tested now so Phase 2 activation has zero ambiguity
about this rule.

## 9. Partial Failure

Directly tested: if 15/16 (or any subset) districts show `COMPLETE` for a month but one doesn't,
`computeVerifiedRangeFromManifest()` does not advance `to` past that month — confirmed via a
synthetic-manifest unit test with 2/3 districts complete.

## 10. Mutation Guard

Confirmed via unit test that a district retried and later showing `COMPLETE` correctly allows the
range to advance on the *next* computation — matching the existing sale/rent runner behavior where
a failed cell is naturally retried on the next scheduled run (nothing new needed here; this test
just proves the *derivation* function reacts correctly once that retry eventually succeeds).

## 11. Routing

`rent-history-read.ts` is unchanged and needed no changes — it already imports
`RENT_VERIFIED_FROM`/`RENT_VERIFIED_TO`/`clipDateRangeToVerified` by name; those names now resolve
to auto-derived values instead of hand-edited literals, transparently. Confirmed via the existing
`rent-verified-range.test.mjs` suite (12/12 still pass, values still exactly `202408`/`202608`) —
a real regression proof that the new mechanism reproduces the old value exactly, not just "should."

## 12. Admin Ops

`/admin/ops` (`src/app/api/admin/ops/route.ts` + `src/app/admin/ops/page.tsx`) gained a new **RENT
coverage section**, mirroring sale's existing display exactly: live district-count query (not a
hardcoded "16/16" claim), total rows, latest deal date, the auto-derived verified range, and — per
§20's explicit instruction — a `scheduler: { value: 'OFF', ... }` marker identical in honesty to
sale's own, since no Cron is registered. Also surfaces `legacyBootstrap` provenance and an explicit
note that rent has no cancellation concept (never let the new UI imply otherwise).

## 13. Cron Routes

Built `src/app/api/cron/sale-sync/route.ts` and `src/app/api/cron/rent-sync/route.ts` — **code
only, not registered** (`vercel.json` still contains only `{"regions": ["icn1"]}`, confirmed
unchanged via direct file read after this STEP's work). Both routes: check `CRON_SECRET` via a
real, unit-tested auth gate, then — deliberately — return `501 NOT_WIRED` rather than a fake
success. The actual sync-engine invocation is **not** wired into these routes this STEP: the
underlying engines (`incremental-sync-nationwide.ts`, `incremental-sync-completed-month.ts`) are
CLI scripts (dotenv loading, argv parsing, `process.exit`), and safely bridging that into a Next.js
serverless Function is real Phase 2 activation work, not "route preparation" — building it now
would mean either performing real writes to prove it works (banned this STEP) or shipping unproven
code, neither acceptable.

## 14. Security

`isAuthorizedCronRequest()` (`src/lib/cron-auth.ts`) — pure, unit-tested (6 cases: no secret
configured, no header, wrong secret, correct secret, missing Bearer prefix, case/whitespace
mismatch). Fails closed if `CRON_SECRET` isn't set — and it genuinely isn't set anywhere in this
environment right now (this STEP performed no Vercel environment mutation, per its own STOP
condition), so **both cron routes cannot be successfully invoked by anyone, including accidentally
during this STEP's own testing** — verified live: `curl` against both routes on the dev server
returned `401` with no secret and `401` with a wrong secret.

## 15. Schedule

No change from Phase 1's recommendation (매월 3일, both sale and rent, separate invocations) — this
STEP didn't find new evidence to revise that recommendation, and revising it without evidence would
violate the "추측 금지" principle governing this whole audit line.

## 16. Timeout

Real dry-run timing after the pagination fix: sale 17 cells → 13.5s (vs. Phase 1's pre-fix 10.5s —
the small increase is the cost of now actually verifying `totalCount` on every request, not
multiple pages, since Busan volume stays under the 1,000 cap). Both cron routes declare
`export const maxDuration = 60` — a conservative, honest declaration matching Phase 1's own timing
estimate; actual Vercel plan limits remain unconfirmed (same carried-over gap from Phase 1, still
not a blocker given the margin).

## 17. Observability

Cron routes' `501 NOT_WIRED` response already includes a `note` field explaining exactly what's
missing — no silent failure. Once Phase 2 wires the real engines in, the same response shape
should be extended with `status`/`range`/`cells`/`inserted`/`updated`/`blocked`/`failed`/`duration`
per this task's own §27 request — flagged for that STEP, not built prematurely without real data
to populate it.

## 17.5 Production Verification (post-deploy, commit `33826f0`)

Live-tested directly against `https://real-estate-app-park11.vercel.app` (read-only, GET-only,
per §32's explicit allowance):

```
sale-sync (no secret):     401
rent-sync (no secret):     401
sale-sync (wrong secret):  401
```

Confirms the fail-closed design holds in the real deployed environment, not just locally — both
cron routes are genuinely unreachable for any actual sync invocation right now. No `sync --apply`
or successful cron invocation was performed, per this STEP's own STOP conditions.

## 18. Activation Checklist

1. Wire `scripts/incremental-sync-nationwide.ts`'s core logic into `/api/cron/sale-sync` (real
   engineering task: extract the sync loop from its CLI wrapper into an importable function).
2. Wire `scripts/rent-trade-history/incremental-sync-completed-month.ts`'s core logic into
   `/api/cron/rent-sync`, including a real call to `shouldRecordCoverageCell()` + writing
   `data/rent-trade-history/coverage-manifest.json` (only in apply mode, only for
   COMPLETE/EMPTY_VALID cells — logic already built and tested this STEP).
3. Add `CRON_SECRET` to Vercel Production env config (dashboard action, out of code scope).
4. Register both routes in `vercel.json`'s `crons` array (매월 3일, per Phase 1's schedule
   recommendation).
5. First few real Cron-triggered runs: manually re-verify DB state against the dry-run
   methodology from Phase 1/1.5 before fully trusting unattended operation.
6. First real rent UPDATE (if/when `hasContentDiff` ever returns true in production): pause and
   PM-review that specific event per Phase 1's own flagged risk.
7. Confirm actual Vercel plan/timeout limits from the dashboard (carried-over gap, low risk given
   current timing margin).
