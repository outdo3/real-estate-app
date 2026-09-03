# DATA FRESHNESS AUTOMATION V1 — PHASE 2: Durable Coverage + Cron Wiring

Status: **ACTIVATED — both crons registered and scheduled daily; first unattended run pending.**
See §23 (sale apply), §24 (rent apply) and §25 (cron activation) for evidence (2026-09-03).
Work start: `main` @ `acee1a6`, worktree preserved (pre-existing user files untouched).
Cross-links: [Phase 1](./DATA_FRESHNESS_AUTOMATION_V1_PHASE1.md),
[Phase 1.5](./DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5.md),
[Rent architecture](./RENT_TRADE_HISTORY_V1_ARCHITECTURE.md),
[Admin Ops V1.2](./ADMIN_OPS_V1_2_EVIDENCE_CORRECTION.md).

Per §26 (NO FAKE ACTIVATION), the scheduler now reports `SCHEDULED` — because a schedule really is
registered — and that is deliberately **not** the same claim as "an unattended run succeeded". No
unattended run has been observed yet; the separate "last run" field still shows the supervised
applies.

Sections 1–22 below describe the wiring work as it stood before activation, and several of them
(§4 Environment, §5 Schedule) were written when `CRON_SECRET` was unset and nothing was deployed.
**§23–§25 supersede them** and record what is actually true now: the code is deployed,
`CRON_SECRET` is configured, both first supervised production applies have run — SALE (377
inserts, 2 cancellation flips) and RENT (90 inserts, 0 mutations) — and both jobs are now
registered to run daily.

---

## 1. Architecture

The activation gate in §24/§25 failed as originally designed, and the redesign is the substance
of this STEP.

### Why the file-manifest design could not work (measured, not assumed)

Phase 1.5's checklist item #2 planned for the cron Lambda to write
`data/rent-trade-history/coverage-manifest.json`. That cannot be durable on Vercel:

**Evidence A — the manifest is a *build input*, copied per function.** Both manifests are
git-tracked, and a local `npm run build` shows Next.js file tracing copies each manifest into
**every reading function's own bundle, separately**:

```
api/admin/ops/route.js.nft.json       → coverage-manifest.json, nationwide-sync-manifest.json, cancellation snapshot
api/stats/dashboard/route.js.nft.json → coverage-manifest.json
api/cron/rent-sync/route.js.nft.json  → NONE
api/cron/sale-sync/route.js.nft.json  → NONE
```

`/api/stats/dashboard` and `/api/admin/ops` each read a **private build-time copy**. A write
inside the cron function could never be observed by them — different bundles, different
instances. This defeats the design before filesystem permissions even matter.

**Evidence B — the derived range was frozen at module load.** The old
`src/lib/rent-verified-range.ts` did `fs.readFileSync` once per instance at module load and froze
the result into exported constants, so even a shared writable file would not be re-read by a warm
instance.

**Evidence C — Vercel's read-only function filesystem** (except ephemeral, per-instance `/tmp`) —
documented platform behavior, labeled as such. A and B were independently sufficient, so no
preview deployment was spent proving it.

### The replacement

Coverage state now lives in one durable, transactional, cross-function source of truth:
`sync_coverage_cells`. The split is deliberate:

| Concern | Where | Why |
|---|---|---|
| Advance rules (pure) | `src/lib/rent-verified-range.ts` | No `fs`, no prisma — fully unit-testable with synthetic input |
| Coverage I/O + cache | `src/lib/sync-coverage.ts` | DB reads/writes, 5-min cache, bootstrap file read |
| Sync orchestration | `src/lib/sync/{shared,rent-sync-core,sale-sync-core}.ts` | Serverless-safe; imports the existing proven pure modules |
| Cron entry points | `src/app/api/cron/{sale,rent}-sync/route.ts` | Auth, mode parsing, structured JSON, status policy |

`legacyBootstrap` still comes from the git-tracked manifest file — it is **static provenance**
that changes only by commit, so reading it from the bundle is correct. The thing that was
impossible was runtime *writing*.

## 2. Cron Wiring

§4 required that CLI and Cron never diverge in calculation or identity logic. The cores therefore
import the existing proven pure modules rather than reimplementing them:

- fetch + pagination + completeness — `rent-molit-fetch.ts` / `sale-molit-fetch.ts`
- normalization / identity / `occurrenceIndex` — `rent-history-logic.ts` / `trade-history-logic.ts`
- write eligibility — `rent-completeness-logic.ts` (`shouldPersistCellRows`)
- per-row action — `write-policy-logic.ts` (`classifyRow`)
- completed-month math — `incremental-sync-completed-month-logic.ts`

The CLI *entry points* could not be imported directly: they assume `dotenv` + `__dirname` +
`process.argv` + `process.exit` + an fs logger + a module-level `new PrismaClient()`. Notably
`process.argv` is empty inside a route, so a naive import of sale's `main()` would have silently
run **nationwide, dry-run, overlap=3**. The pure modules above have none of those side effects,
which is what made reuse-without-rewrite possible.

## 3. Auth

Unchanged and fail-closed: `Authorization: Bearer ${CRON_SECRET}`, rejecting when the secret is
unset (`src/lib/cron-auth.ts`). No secret is hardcoded or logged. Verified locally with a
throwaway secret: no header → **401**, wrong secret → **401**, correct secret → runs.

## 4. Environment

> **Superseded by §23.** `CRON_SECRET` is now set in Vercel Production. (Written when it was
> deliberately unset.)

## 5. Schedule

> **Superseded by §25.** Both crons are now registered and run **daily** (not monthly as sketched
> here): sale `0 19 * * *` UTC = 04:00 KST, rent `0 20 * * *` UTC = 05:00 KST.

## 6. Sale Policy

Scope is **Busan 16 districts**, not the CLI's nationwide default (~250 sigungu × 3 months ≈ 753
cells ≈ 10 min, roughly 10× the 60s limit). Range is the last 3 completed months **plus the
in-progress current month** — sale freshness is core to the product — but per §15 the current
month is synced without ever being recorded as verified coverage. Writes allowed: new-row INSERT
(`aptSeq` required) and the already-proven cancellation flip `false→true`. Blocked: rows without
`aptSeq` (`reviewRequired`), `conflict`, and any `true→false` un-cancel.

## 7. Rent Policy

Busan 16 × last 2 completed months. Current month never included, and an explicit range is
clamped to `latestCompleteMonth` anyway. Inserts use `createMany({skipDuplicates: true})`, which
structurally cannot overwrite an existing row.

## 8. Rent Mutation Guard

§13 is enforced in the core: when an existing row differs in any of the 9 non-natural-key fields,
the run does **not** update it. It records a `ReviewItem` (identity + field name + old/new value,
no personal data), returns `status: NEEDS_REVIEW` (HTTP 207, never a 2xx success), and — this is
the important part — **does not record that cell's coverage at all**. Absence of a record means
"not yet verified", so coverage cannot advance past an unreviewed mutation, and the cell is
naturally retried next run. Recording it as `PARTIAL` would have been a lie about completeness.

The live dry-run found **0 mutation candidates**, consistent with the historical observation that
rent rows have never truly mutated in production.

## 9. Coverage Durability

Solved by the table. Cross-invocation visibility is inherent: any function reading
`sync_coverage_cells` sees writes from any other. The 5-minute cache bounds propagation delay —
versus the old design, where a cron write would have been invisible **forever** (until redeploy).

Advance rules, all unit-tested against synthetic input:
- `from` never extends backward.
- `to` advances only when **all 16 districts** are verified for that month; stops at the first gap.
- The current calendar month is never verified, regardless of what is recorded.
- dry-run never records coverage — enforced both at the call site and again inside
  `recordCoverageCells` (defense in depth), and proven live (`coverageRecorded: 0`).

### EMPTY_VALID semantics fix

The writer recorded `COMPLETE` **or** `EMPTY_VALID`; the reader accepted only `COMPLETE`. A
district-month with genuinely zero rent transactions would therefore have stalled coverage
**forever**. Both sides now accept `COMPLETE` and `EMPTY_VALID`, because a successful,
fully-paginated `totalCount = 0` is a trustworthy true zero under the project's data-truth policy
— unlike `PARTIAL`/`INVALID`, which remain unverified.

This is not hypothetical: the sale dry-run returned **3 `EMPTY_VALID` cells** out of 64.

## 10. PARTIAL write bug (P0, fixed)

Independently of coverage, the rent engine had a live data-integrity bug: only `INVALID`
short-circuited, so a `PARTIAL` cell (truncated multi-page fetch) **was persisted** in apply mode.
Because `occurrenceIndex` is numbered per `(lawdCd, dealYmd)` batch from the *full* feed, a
truncated feed renumbers occurrences and produces different natural keys for the same real
transactions — silent duplicates that a later complete run cannot reconcile, and that the unique
constraint cannot catch (the keys genuinely differ).

Fixed via `shouldPersistCellRows(status)` (only `COMPLETE` persists), applied in both the CLI
(`sync-rent-history.ts`) and the new core, with tests.

## 11. First Sale Run / 12. First Rent Run

**Not performed** — not approved. Only dry-runs were executed (below).

## 13. Dry-run evidence (local, against production DB reads + real MOLIT)

| | Rent | Sale |
|---|---|---|
| Range | 202607–202608 | 202606–202609 (incl. current month) |
| Cells | 32 / 32 processed | 64 / 64 processed |
| Cell statuses | `COMPLETE: 32` | `COMPLETE: 61`, `EMPTY_VALID: 3` |
| Fetched | 6,887 | 7,271 |
| Would insert | 90 | 377 |
| Would update | 0 | 2 (cancellation flips) |
| Blocked / failed | 0 / 0 | 0 / 0 |
| needsReview | 0 | — |
| **coverageRecorded** | **0** | **0** |
| Duration | 13.8s | 34.3s |

Sale's measured 34.3s for all 64 cells (~0.54 s/cell) is comfortably inside the 60s limit —
better than the 0.79 s/cell estimate from the CLI logs, so district chunking
(`?districtOffset`/`?districtLimit`) is available but not needed today.

## 14. Production DB Writes

| Operation | Count |
|---|---|
| Sale INSERT / UPDATE | 0 / 0 |
| Rent INSERT / UPDATE | 0 / 0 |
| DELETE | **0** |
| Schema | 1 additive migration (approved) |

Verified after all dry-runs: `sync_coverage_cells` = 0 rows;
`apartment_trade_histories` = 855,179; `apartment_rent_histories` = 125,320 — unchanged from the
post-migration baseline.

## 15. Migration

`20260903000000_sync_coverage_cells_v1`, applied with `prisma migrate deploy` (never
`migrate dev` — `DATABASE_URL` points at production, so `migrate dev` could have reset it).
Pre-flight `migrate status` showed no drift. Purely additive: 2 `CREATE TYPE`, 1 `CREATE TABLE`,
2 `CREATE INDEX`; no `ALTER`, no `DROP`, no data mutation.

Rollback: `DROP TABLE sync_coverage_cells; DROP TYPE "SyncCellStatus"; DROP TYPE "SyncDataset";`
Nothing else depends on the table; with it absent, `getRentVerifiedRange()` falls back to
`legacyBootstrap`, i.e. exactly today's behavior.

## 16. Admin Ops

`/admin/ops` now reads coverage **live from the DB** for both datasets (`coverageCells`: total,
per-status breakdown, `latestVerifiedAt`) instead of trusting a file manifest. The rent
`no cancellation field` limitation note is preserved. Both schedulers still read `OFF`, honestly.

## 17. Observability & HTTP status

Structured JSON: `status, mode, runId, from, to, cells, cellsProcessed, fetched, inserted,
updated, blocked, failed, coverageRecorded, durationMs, needsReview, cellStatusCounts`. Per §19,
only `SUCCESS` returns 200; `PARTIAL`/`NEEDS_REVIEW`/`PARTIAL_RUN` return **207** so a scheduler
cannot mistake them for success; `FAILED` returns 500. Logs carry start/range/per-cell/summary
lines and never contain the secret or personal data.

## 18. Timeout

Per §21, no timeout was raised. `maxDuration` stays 60, and a `TimeBudget` (50s) stops cleanly at
a **cell boundary**, returning `PARTIAL_RUN` so the remainder is picked up next run rather than
being truncated mid-write.

## 19. Region

`vercel.json`'s `regions: ["icn1"]` was preserved untouched.

## 20. Remaining Risks

1. **Concurrency** — the MOLIT rate limiter is a module-global (`lastFetchAt`), which is
   per-instance and resets on cold start; overlapping invocations could exceed the intended
   request rate. Mitigated by schedule spacing, not by a DB lock (§22 correctly ruled that out).
2. **Sale manifest** — the CLI still writes `nationwide-sync-manifest.json`; the cron path does
   not use it (it is stateless by design, since `computeMonthsForRegion` falls back to a rolling
   window). The CLI is unaffected.
3. **`tmp/` scripts** — the user's untracked scratch scripts call the old
   `splitVerifiedMonths`/`clipDateRangeToVerified` signatures and now fail typecheck. Left
   untouched per worktree-preservation policy.
4. **First production apply is still unproven** — dry-run parity is strong evidence, not proof of
   write behavior.

## 21. Tests / Build

- **359 / 362** logic tests pass. The 3 failures are pre-existing and unrelated
  (`master-coverage-sync-logic`, `repair-recent-missing-masters-logic`, `trade-history-read` — all
  fail on the repo's documented extensionless-relative-import constraint, in files not touched here).
- `npx tsc --noEmit`: **0 errors in `src/`**. 24 total vs. a 20-error baseline; the 4 new ones are
  all in the user's `tmp/` scratch scripts (see Remaining Risks 3) — `FAIL_EXISTING_SCRIPT_ERRORS`.
- `npm run build`: exit 0.
- `npx eslint` on all changed paths: exit 0. (Repo-wide `npm run lint` exceeds a 6m40s timeout —
  a pre-existing repo characteristic.)
- `src/lib/rent-verified-range-advance.test.ts` was **never actually running** before this STEP
  (extensionless import → `ERR_MODULE_NOT_FOUND`); it is now `.test.mjs` and genuinely executes.

## 22. Not done (requires approval)

- First production sale apply
- First production rent apply
- Cron registration / activation (`vercel.json` crons, `CRON_SECRET` in Production)
- First real rent mutation UPDATE

---

## 23. First supervised SALE production apply (2026-09-03)

Deployed `8778a91`; `CRON_SECRET` set in Vercel Production (Production scope only, 48 bytes of
`crypto.randomBytes` as base64url, piped via stdin so it never appeared on a command line);
redeployed as `dpl_6PNxxpmaRDVZSLbZHR6TFLnGWyxm`, which carries the production alias.

### Auth (production)

| Case | Result |
|---|---|
| No header | **401** |
| Wrong secret | **401** |
| Correct secret, default mode | **200**, `mode: dry-run` — authorization proven without applying |

`?mode=apply` without a valid secret is also 401. All responses carry `X-Vercel-Id: icn1::icn1::…`.

### Predicted vs actual

Prediction came from a production dry-run taken immediately before the apply — not from the
earlier local run.

| | Predicted | Actual |
|---|---|---|
| Range | 202606–202609 | 202606–202609 |
| Cells | 64 (61 `COMPLETE`, 3 `EMPTY_VALID`) | identical |
| Fetched | 7,271 | 7,271 |
| Inserted | 377 | **377** |
| Cancellation flips | 2 | **2** |
| Blocked / failed | 0 / 0 | **0 / 0** |
| Duration | ~33s | 30.6s |

`status: SUCCESS`, `coverageRecorded: 48`.

### Post-write verification

| Metric | Pre | Post | Delta |
|---|---|---|---|
| `apartment_trade_histories` total | 855,179 | 855,556 | **+377** |
| Busan, 4-month scope | 6,898 | 7,275 | **+377** |
| Canceled in scope | 224 | 239 | +15 |
| `apartment_rent_histories` | 125,320 | 125,320 | **0** |
| `sync_coverage_cells` | 0 | 48 | +48 |

The **+15 canceled** needed explaining, since the engine reported only 2 updates. Forensics
resolved it exactly: of the 377 newly inserted rows, **13 were already canceled at source on
insert**, plus the **2** genuine `false→true` flips on pre-existing rows — 13 + 2 = 15. Confirmed
by splitting on `createdAt` vs the run start timestamp:

```
inserted rows      : 377   (of which canceled at source: 13, aptSeq NULL: 0)
existing modified  : 2     (both now canceled)
```

`aptSeq NULL` on inserted rows = **0**, so the identity policy held with no name-based fallback.

### Completeness and coverage

- Every `COMPLETE` cell satisfies `sourceTotalCount == fetchedCount` — **0** violations.
- Coverage written: 16/16 districts × 202606, 202607, 202608 = **48**, all `COMPLETE`.
- **202609 (current month) coverage cells = 0** — §15 held: the current month was *synced*
  (49 rows inserted) but never recorded as verified.
- RENT coverage cells = **0**; rent untouched, and the rent verified range is still
  **202408–202608** (SALE cells do not leak into the RENT computation — the query filters on
  `dataset`).
- Coverage `insertedCount` sums to 328; +49 current-month inserts (not coverage-recorded) = 377. ✓

### Idempotency

Re-running the identical scope fetched the same 7,271 source rows and produced
**inserted 0, updated 0, blocked 0, failed 0**. DB counters after the re-check were byte-identical
to the post-apply values, confirming the dry-run itself wrote nothing.

### Security / observability

The literal secret value appears **0** times in: git history (`git log --all -S`), tracked files,
`docs/`, `src/`+`scripts/`+`prisma/`, `vercel.json`, and the fetched production logs. Logs contain
structured `START` / per-cell / `DONE` lines with no secret and no personal data. No error- or
warning-level entries.

### Regression

Post-apply, all Busan read routes returned 200: dashboard (`sidoCode=26`, `lawdCd=26140`),
rankings (`area84`, `rise`, `decline`, `record-high`), `/api/transactions`, `/api/apt/대신롯데캐슬`.

### Not observed

`/api/admin/ops` could not be read — no admin session was available in the automation browser, and
credential entry is out of scope. Its inputs were verified directly against the DB instead
(48 SALE cells all `COMPLETE`; RENT range 202408–202608; no cron registered, so scheduler `OFF`
remains factually correct), but the endpoint's own response is **unobserved**.

### Still not done

RENT production apply, cron registration (`vercel.json` `crons`), and flipping the `/admin/ops`
scheduler indicator to ACTIVE. SALE is currently **manually triggered only** — there is no
schedule, so it will not run again on its own.

---

## 24. First supervised RENT production apply (2026-09-03)

Ran on `dpl_CcGBEUy2KzW26edZSR8F9Y9oA6Bv` (icn1, production alias).

**Secret note.** The `CRON_SECRET` scratchpad copy was deleted at the end of the sale step, and
Vercel **cannot return secret values** — `vercel env pull` writes `[SENSITIVE]` placeholders
(verified: the extracted string was literally `[SENSITIVE]`). The secret was therefore rotated
with user approval before this run. Blast radius was nil: its only consumers are the two cron
routes and no cron is registered. Env count stayed 18, so nothing else was touched.

### Predicted vs actual

Prediction from a production dry-run taken immediately before the apply.

| | Predicted | Actual |
|---|---|---|
| Range | 202607–202608 | 202607–202608 |
| Cells | 32, all `COMPLETE` | identical |
| Fetched | 6,887 | **6,887** |
| Inserted | 90 | **90** |
| Updates | 0 | **0** |
| Mutation candidates (`needsReview`) | 0 | **0** |
| Blocked / failed | 0 / 0 | **0 / 0** |
| Duration | 11.1s | 11.7s |

`status: SUCCESS`, `coverageRecorded: 32`.

### Post-write verification

| Metric | Pre | Post |
|---|---|---|
| `apartment_rent_histories` total | 125,320 | **125,410** (+90) |
| Busan 202607–202608 | 6,797 | **6,887** (+90) |
| rent rows with `aptSeq` NULL | 0 | **0** |
| `apartment_trade_histories` | 855,556 | **855,556** (+0) |
| RENT coverage cells | 0 | **32** |
| SALE coverage cells | 48 | **48** (unchanged) |

The scope count landed exactly on the source count — 6,887 rows in DB vs 6,887 fetched — so
source and DB now match completely for the applied months. Inserted rows split
jeonse 36 / wolse 54.

Forensics on `createdAt` vs the run start timestamp:

```
inserted rows       : 90   (aptSeq NULL: 0)
existing rows mutated: 0   <- first-mutation guard held
```

### Completeness, coverage and identity

- Every `COMPLETE` cell satisfies `sourceTotalCount == fetchedCount` — **0** violations.
- Coverage written: 16/16 districts for 202607 and 202608 = **32**, all `COMPLETE`.
- **202609+ coverage cells = 0** — the current month was never recorded.
- No rent cancellation state was created or inferred; the source has no such field.

### Verified range — unchanged, and that is correct

The range stayed **202408–202608**. Both applied months already sit inside the legacy bootstrap,
and the next advance candidate (202609) is the in-progress current month, which the guard refuses.
Rent coverage can first advance in **October 2026**, once 202609 is a completed month and all 16
districts sync `COMPLETE`.

### Idempotency

Identical scope re-run: same 6,887 fetched, **0 inserted, 0 updated, 0 blocked, 0 failed**.

### /admin/ops (now readable by the operator)

Matches the database exactly — RENT: scheduler `OFF`, 총 row 125,410, 동기화 coverage(DB)
**32 cells COMPLETE** (last verified 14:13), 검증 범위 202408–202608, legacy bootstrap shown, and
the "source has no cancellation field" warning intact. SALE regression: scheduler `OFF`,
coverage still **48 cells COMPLETE**.

### Regression

All 200: `/`, `/my`, dashboard (sido + district), rankings (area84/rise/decline/record-high),
transactions, apartment detail. All four admin APIs return `success: true` and all four admin
pages render for the admin session with no denial message. Cron routes remain **401** on all four
shapes (with/without `?mode=apply`). Unauthenticated `/admin/*` still 307 → `/my`.

### Admin dashboard overflow fix

Fixed in the same session. `.errorMessage` had no wrapping rule, so a space-less error string
rendered 1002px wide and dragged its parent card out with it. Measured on production via
same-origin iframes, before → after:

| Viewport | Before (`scrollWidth`/`clientWidth`) | After |
|---|---|---|
| 360px | 1059 / 345 — overflow | **345 / 345 — none** |
| 375px | 1059 / 360 — overflow | **360 / 360 — none** |
| 390px | 1059 / 375 — overflow | **375 / 375 — none** |
| 1280px | — | **1265 / 1265 — none** |

`overflow-wrap: anywhere` (not `break-word`, which is not taken into account when computing
min-content width). All 20 error messages still render; no structural change.

---

## 25. Cron activation (2026-09-03)

Deployed `dpl_3QqDGMt7acKPwYWvpf9n6y9cXoXF` (production alias, all functions `icn1`).

### Schedule

| Job | UTC | KST | Path |
|---|---|---|---|
| SALE | `0 19 * * *` | 매일 04:00 | `/api/cron/sale-sync?mode=apply` |
| RENT | `0 20 * * *` | 매일 05:00 | `/api/cron/rent-sync?mode=apply` |

The conversion was **computed, not assumed** — `Date.UTC(...19:00)` rendered in `Asia/Seoul`
gives 04:00 the next day, re-checked against a January date since Korea has no DST.

### Plan limits

The Vercel dashboard states *"Cron jobs on Hobby have a flexible time window of 1-hour"*, which
identifies the plan as **Hobby** (the CLI exposes no plan field). Hobby permits **2 cron jobs at
once-daily frequency** — exactly what is registered, so the config is within limits. Independently,
Vercel validates cron limits at deploy time, so an over-limit schedule would have failed the
deployment rather than silently activating.

**Consequence worth knowing:** Hobby fires within a **1-hour window**, not at the exact minute. The
intended 1-hour sale→rent spacing can therefore compress — worst case sale at 19:59 UTC and rent at
20:00 UTC. Sale runs ~34s and rent ~12s, so a brief overlap is possible. That matters only for the
module-global MOLIT rate limiter (per-instance, so two concurrent functions do not share it).

### Auth

Unchanged and fail-closed. Vercel Cron supplies `Authorization: Bearer $CRON_SECRET` automatically
because `CRON_SECRET` is set on the project — the mechanism `src/lib/cron-auth.ts` was written
against. Post-deploy: no header → **401**, wrong secret → **401**, empty bearer → **401**, and a
plain public request to `?mode=apply` returns `unauthorized`. The secret literal appears **0** times
in git history, tracked files, `vercel.json`, and the client bundle.

The dashboard confirms the registered paths **retain their query strings**
(`/api/cron/sale-sync?mode=apply`), which was the open question — had they been stripped, the jobs
would have run in dry-run and written nothing.

### Admin display — the part that was most likely to lie

Two places asserted `OFF` as a literal: the scheduler field in the API and the "자동 수집" status
tile in the page. Both would have kept claiming OFF after registration. They now derive from the
deployed `vercel.json` through `readCronRegistration()`, so the status self-corrects if a cron is
removed, and an unreadable file reports `UNKNOWN` rather than assuming either direction.
`vercel.json` is confirmed traced into the ops function bundle via `.nft.json`.

Registration is deliberately **not** conflated with success:

- `SCHEDULED` = a schedule exists.
- A separate **last run** field shows the `runId` and timestamp of the run that last recorded
  coverage.

Live after deploy: SALE `SCHEDULED` / `0 19 * * *` / 매일 04:00 KST, last run
`sale-2026-09-03T03-43-00-962Z`; RENT `SCHEDULED` / `0 20 * * *` / 매일 05:00 KST, last run
`rent-2026-09-03T05-13-02-161Z`. Both last-run values are still the **supervised** applies — no
unattended success is claimed, because none has happened yet.

### Data state — unchanged by activation

SALE coverage 48 `COMPLETE`, RENT coverage 32 `COMPLETE`, rent rows 125,410, Busan trade rows
855,424, rent verified range 202408–202608. **0 production DB writes during setup.**

### First unattended run — pending

At activation time the next fires were ~12.7h away (SALE 2026-09-03 19:00 UTC / 09-04 04:00 KST;
RENT 20:00 UTC / 05:00 KST), so no unattended run has been observed. The local `CRON_SECRET`
scratch copy was deleted after registration; the Vercel Production variable was **not** removed or
rotated.
