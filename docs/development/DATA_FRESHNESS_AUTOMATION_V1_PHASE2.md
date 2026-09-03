# DATA FRESHNESS AUTOMATION V1 — PHASE 2: Durable Coverage + Cron Wiring

Status: **SALE ACTIVATED (manual/supervised); RENT still pending; cron schedule NOT registered.**
See §23 for the first supervised production apply evidence (2026-09-03).
Work start: `main` @ `acee1a6`, worktree preserved (pre-existing user files untouched).
Cross-links: [Phase 1](./DATA_FRESHNESS_AUTOMATION_V1_PHASE1.md),
[Phase 1.5](./DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5.md),
[Rent architecture](./RENT_TRADE_HISTORY_V1_ARCHITECTURE.md),
[Admin Ops V1.2](./ADMIN_OPS_V1_2_EVIDENCE_CORRECTION.md).

Per §26 (NO FAKE ACTIVATION), the scheduler still reports `OFF` — because it *is* off. **No cron
is registered**, so nothing runs on its own; SALE currently runs only when invoked manually with
the secret.

Sections 1–22 below describe the wiring work as it stood before activation, and several of them
(§4 Environment, §5 Schedule) were written when `CRON_SECRET` was still unset and nothing was
deployed. **§23 supersedes them** and records what is actually true now: the code is deployed,
`CRON_SECRET` is configured, and the first supervised SALE production apply has run
(377 inserts, 2 cancellation flips). RENT has still never been applied in production.

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

**Not registered.** `vercel.json` still contains only `{"regions": ["icn1"]}` and was not touched.
Recommended when activation is approved (KST 04:00 sale / 05:00 rent on the 3rd → UTC 19:00/20:00
on the 2nd): `"0 19 2 * *"` and `"0 20 2 * *"`, with `?mode=apply` on the path.

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
