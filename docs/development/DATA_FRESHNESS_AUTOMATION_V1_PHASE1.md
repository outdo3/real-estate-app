# DATA FRESHNESS AUTOMATION V1 — PHASE 1: Sale + Rent Incremental Sync Production Readiness Audit

**Date:** 2026-09-03
**Baseline:** `main` @ `d28dba5` (follows `ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2.md`)
**Scope:** Audit, dry-run, read-only verification only. **No Production APPLY, no Cron
activation, no schema/migration/index change.** Two background research agents reconstructed the
SALE and RENT sync architectures in full; all DB queries and dry-runs in this doc were executed by
me directly against real production data/APIs, read-only or dry-run mode only, confirmed via
`git status` showing zero file/manifest changes after every run.

---

## 1. Sale Architecture

Entry point: `scripts/incremental-sync-nationwide.ts` (CLI-only, no cron wiring). Region iteration
is **nationwide by default** via `getSidoList()`/`getSigunguListForSido()` (`region-utils.ts`) —
no hardcoded district list (contrast: the sibling `resync-cancellation-v2.ts` is deliberately
Busan-only via a hardcoded `BUSAN_16` list). Date range: `computeMonthsForRegion()`
(`incremental-sync-logic.ts:49-67`) re-walks from `lastCompleteIdx − (overlapMonths−1)` through
the current month per region, using a persisted manifest; a region with no manifest history
processes only the overlap window (bounded first-run, not deep backfill).

**Dry-run is real**, not just verbose logging — `opts.apply` gates every DB write and the manifest
save; a dry-run still fetches from MOLIT and classifies, but persists nothing.

**Upsert/classification**: `classifyAndWrite()` (`resync-cancellation-v2.ts:120-209`), natural key
= `groupKeyStr|dealAmount|dealDate|floor|occurrenceIndex`. Per-row decision via pure function
`classifyRow()`: no match + aptSeq present → insert; **no match + no aptSeq → `reviewRequired`,
never inserted** (aptSeq-first identity gate, no name+dong fallback). Cancellation: false→true
applied, **true→false always skipped** (never "un-cancels" a row) — matches the project's
established asymmetric-cancellation-guard convention.

**Real, quantified problem found — no MOLIT pagination/totalCount verification.** The fetch path
(`fetchOneRegionMonth` → `fetchMolitData`, `api-molit.ts:73,100`) requests `numOfRows=1000` with
**no `pageNo` and no `totalCount` check**. The rent pipeline already identified and fixed this
exact gap for itself (`rent-molit-fetch.ts:7-9` explicitly documents it and built a real paginated
fetcher with count verification) — **that fix was never ported to the sale sync engine**, which
still uses the old unpaginated function.

**This is not theoretical — direct proof found in production data this STEP** (read-only query
against `apartment_trade_histories`): **23 `(lawdCd, dealYmd)` cells contain exactly 1,000 rows** —
a statistically implausible coincidence for organic trade-volume distributions, and the exact
`numOfRows` cap, meaning these cells were almost certainly silently truncated at ingestion. Every
one of the 23 is from **2020-11 or earlier** (most recent: `26350/202011`; oldest: `26320/200611`)
— i.e., damage already realized, confined to historical backfill-era data, not touched by the
*incremental* engine (which only ever re-walks the recent overlap window). **Zero capped cells
exist in the last 12 months.** Checking current density directly: the busiest Busan district-months
in the last 12 months peak around **530 rows/month** (26350/202511) — comfortable headroom under
1,000 today. **Verdict: not an immediate risk to Busan-only incremental sync at current volume, but
a real, already-proven bug in the shared fetch function that the incremental engine still calls —
one demand spike or the eventual nationwide expansion (where large Seoul/Gyeonggi districts
plausibly exceed 1,000 sale trades/month) would silently reproduce it going forward.** Recommended
as a pre-activation fix (§27), not dismissed as low-priority just because current Busan volume
happens to have margin.

## 2. Rent Architecture

Entry point: `scripts/rent-trade-history/incremental-sync-completed-month.ts` (+
`sync-rent-history.ts`, `rent-history-logic.ts`). "Latest completed month" = always previous
calendar month, **no reporting-lag grace period** — the code's own header comment explicitly
records that the team considered a delay buffer and rejected it for lack of evidence
(`incremental-sync-completed-month.ts:9-18`). Overlap default = **2 months**, a plain hardcoded CLI
default (`:60-65`), **not derived from the same kind of dealDate→correction-lag evidence sale's
3-month default cites** — this is a real asymmetry worth resolving (§11).

`occurrenceIndex` is computed from a **content-deterministic** full-row JSON serialization sort
(not arrival order), so re-fetches in a different item order still reproduce identical assignment
— genuinely idempotent by construction, not just by luck. Missing aptSeq → `MISSING_APTSEQ`,
blocked from `rows[]` entirely (never a name+dong fallback) — same identity discipline as sale, in
fact stricter (sale still updates cancellation status on aptSeq-less matches; rent blocks the row
outright). Busan district list: hardcoded 16-code array (`incremental-sync-completed-month.ts:55`).

**Idempotency: proven, not just claimed.** `scripts/rent-trade-history/prove-unique-constraint.ts`
runs a real transaction asserting Prisma throws `P2002` on a duplicate natural key. Multiple real
production re-runs (per CHANGELOG) show `insert 0 / update 0` on second application. My own dry-run
this STEP (§8) reproduces this again live.

**Update/correction semantics — a real, important nuance:** the UPDATE code path exists and is
wired through the actual `upsert()` (`sync-rent-history.ts:162-164,300-313`, comparing 9 non-key
fields via `hasContentDiff()`), but **has never actually fired in any production run to date** — no
log file shows `wouldUpdate > 0`. The one real content-change event ever observed was classified as
2 new inserts, not an update to an existing row. The runner's own log messaging treats a first real
`OBSERVED_CONTENT_DIFF` as noteworthy enough to warn against silently expanding auto-update policy.
**This means: if Phase 2 activation ever produces the first real rent UPDATE, that specific event
needs PM review before treating the UPDATE path as production-trusted** (per this task's own §10
instruction).

`SCHEDULER_READY` is a **narrative self-assessment in a code comment**, not a runtime flag or
registered schedule — it means "the CLI is structured safely for repeated calling," not "something
calls it."

**Coverage tracking — the P0 this task explicitly warned about, confirmed real:**
`RENT_VERIFIED_FROM`/`RENT_VERIFIED_TO` (`src/lib/rent-verified-range.ts:20-21`) are **hardcoded
constants a human must manually edit** — the incremental sync script explicitly does **not**
auto-update them (`incremental-sync-completed-month.ts:26-31,93-98`), only prints a reminder. Per
§28's own instruction ("hardcoded month 업데이트가 필요한 구조면 P0"): **confirmed P0.** Turning on
a scheduler alone does not solve coverage decay — every downstream consumer of
`RENT_VERIFIED_FROM/TO` (trust gating elsewhere in the app) would keep reading a stale range
forever unless a human keeps editing the file, or a follow-up STEP builds an auto-update path.

## 3. Current Freshness Snapshot (READ-only, executed this session)

Both SALE (`apartment_trade_histories`) and RENT (`apartment_rent_histories`) show **`202608` as
the latest `dealYmd` present in all 16/16 Busan districts**, as of the audit run (today = early
September 2026, so `202608` is genuinely the correct "last completed calendar month" — no current-
month data is present in either table, confirming neither pipeline has ever mistakenly ingested a
partial current month).

## 4. 16-District Matrix

| lawdCd | SALE latest | SALE rows | RENT latest | RENT rows |
|---|---|---|---|---|
| 26110 | 202608 | 4,348 | 202608 | 451 |
| 26140 | 202608 | 16,050 | 202608 | 2,906 |
| 26170 | 202608 | 11,054 | 202608 | 2,599 |
| 26200 | 202608 | 23,822 | 202608 | 2,710 |
| 26230 | 202608 | 99,366 | 202608 | 18,339 |
| 26260 | 202608 | 66,422 | 202608 | 9,233 |
| 26290 | 202608 | 72,137 | 202608 | 8,663 |
| 26320 | 202608 | 88,248 | 202608 | 8,274 |
| 26350 | 202608 | 124,641 | 202608 | 16,646 |
| 26380 | 202608 | 86,961 | 202608 | 7,822 |
| 26410 | 202608 | 50,395 | 202608 | 4,726 |
| 26440 | 202608 | 22,976 | 202608 | 13,930 |
| 26470 | 202608 | 53,776 | 202608 | 8,168 |
| 26500 | 202608 | 42,308 | 202608 | 7,060 |
| 26530 | 202608 | 55,820 | 202608 | 5,370 |
| 26710 | 202608 | 36,723 | 202608 | 8,423 |

16/16 both tables. No district is behind.

## 5. Source vs DB — Dry-Run Evidence (this is the real "source vs DB" comparison; see §8/§9)

Rather than a separate spot-check, the dry-runs in §8/§9 directly compare live MOLIT against DB for
all 16 districts at once — a stronger form of this check than sampling 5 districts, since it's
exhaustive. **SALE found 23 genuinely new trades DB doesn't have yet** (confirming the task's own
stated context — "최근 month 데이터가 live MOLIT보다 뒤처진 사례가 과거 실제 확인됨" — is still
true today). **RENT found 0 new** (fully caught up, per the last manual backfill through 202608).

## 6. Current Month Policy

Both pipelines correctly exclude the in-progress current month. Sale's `computeMonthsForRegion`
walks up to "current month" in its comment but the actual overlap/completion tracking never marks
an incomplete month as `COMPLETE`. Rent's `latestCompleteMonth()` is hardcoded to previous-calendar-
month, structurally incapable of touching the current month. **Confirmed: no path in either
pipeline can mark the current partial month as verified/complete.**

## 7. Sale Dry Run (real execution, 16 Busan districts, `--overlapMonths=1`, no `--apply`)

```
REGIONS resolved=16
START apply=false regions=16 overlapMonths=1 cells=17
PROGRESS 17/17 fetched=71 invalidRows=0 insert=23 flipFalseToTrue=0 skippedTrueToFalse=0
  conflicts=0 reviewRequired=0 COMPLETE=11 EMPTY_VALID=6 FAILED=0 INVALID=0 elapsed=10.5s
DONE mode=DRY_RUN regions=16 cells=17 COMPLETE=11 EMPTY_VALID=6 FAILED=0 INVALID=0
  insert=23 flipFalseToTrue=0 skippedTrueToFalse=0 conflicts=0 reviewRequired=0
  SAFE_GATE=true elapsedSec=10.5
```

Zero DB writes (confirmed via `git status` — no manifest file touched, dry-run correctly skips
`saveNationwideManifest`). 23 real, currently-missing trades identified. Zero failures/conflicts/
review-required rows.

## 8. Rent Dry Run (real execution, 16 Busan districts × 2-month overlap = 32 cells, no `--apply`)

```
INCREMENTAL_SYNC latestCompleteMonth=202608 overlap=2 range=[202607,202608] apply=false
... (32 per-cell COMPLETE lines, all wouldInsert=0 wouldUpdate=0) ...
DONE mode=DRY_RUN cells=32 fetched=6797 invalid=0 blockedMissingAptSeq=0 wouldInsert=0
  wouldUpdate=0 unchanged=6797 persisted=0 duplicateWithinBatch=0
INCREMENTAL_SYNC_SUMMARY total=32 resolved=32 failed=0 cellsWithContentDiff=0
```

6,797 real MOLIT items fetched and classified, zero writes needed (already fully synced through
202608 from the last manual backfill), zero failures, zero blocked-missing-aptSeq, zero content
diffs.

## 9. Corrections (Update/Correction Classification)

**Sale**: real update semantics already production-proven — `flipFalseToTrue`/
`skippedTrueToFalse` are live, asymmetric-guarded cancellation-state updates, exercised across
multiple prior STEPs (`TRADE_CANCELLATION_RESYNC_V2` etc.). Not a first-time risk.

**Rent**: as detailed in §2 — the UPDATE code path is real and wired, but **empirically untriggered
in production so far**. This is not "broken," it's "unproven." Flagged as a PM-review trigger for
whenever it first fires for real (§10 task instruction), not a blocker to Phase 1 completing.

## 10. Idempotency

**Rent**: proven via a dedicated test script (`prove-unique-constraint.ts`, real `P2002` assertion)
plus multiple real double-apply production logs showing 0/0, plus my own dry-run this STEP.
**Sale**: same natural-key `@@unique` pattern (`trade_natural_key`), same `classifyAndWrite`
match-then-decide logic (no-op when unchanged) — structurally idempotent, consistent with rent's
proven pattern, though sale doesn't have a dedicated `prove-unique-constraint`-style test script of
its own (a cheap, worthwhile gap to close before Phase 2, not a blocker).

## 11. Overlap Window

| | Value | Basis |
|---|---|---|
| Sale | 3 months (`DEFAULT_OVERLAP_MONTHS`) | **Evidence-derived**: 4,709 real cancellation samples, dealDate→cancelDate lag p50=1mo/p75=2mo/**p90=3mo**/p95=4mo/p99=12mo. 3 months absorbs 92.1% of corrections every run; the long tail is handled by the separate periodic full resync. |
| Rent | 2 months (CLI default) | **Not evidence-derived** — a plain hardcoded default, no cited correction-lag data (rent has no cancellation field to measure lag from in the first place — see §31). |

**Recommendation**: keep sale's 3-month default (it has real evidence behind it and this Phase
found no reason to change it). For rent, since there's no cancellation-lag data to derive a number
from (the source doesn't report corrections the way sale does), 2 months is a reasonable,
conservative default to keep as-is rather than invent a new number without evidence — but this
should be explicitly labeled in code/docs as "a conservative default, not evidence-derived" rather
than implying parity with sale's rigor.

## 12. Latest-Complete-Month Rule

Sale: bounded by manifest completion tracking, not a fixed calendar rule alone. Rent: fixed
"previous calendar month," explicitly evidence-free about whether MOLIT's rent reporting is fully
settled by month-start (the code comment itself says a grace-period delay was considered and
rejected for lack of evidence — meaning this remains an open, acknowledged unknown, not a resolved
one). **No path in either pipeline treats the delay-uncertainty as an excuse to skip re-verification
— the overlap window is the actual mechanism absorbing this uncertainty, not the completion-date
rule itself.** No change recommended without new evidence.

## 13. Scheduler Options

`vercel.json` contains only `{"regions": ["icn1"]}` — **no `crons` key exists**. No
`src/app/api/cron/*` route exists anywhere. No `CRON_SECRET` or any cron-auth convention exists
anywhere in the repo to reuse — this would be the **first** cron job ever registered in this
project (the nearby presale-sync feature explicitly documents the same "not yet implemented"
state: `docs/development/05-presale-sync-operations.md:207`).

**Recommended: Vercel Cron** (per the task's own explicit preference and "no new external service"
constraint) — `vercel.json`'s `crons` array, invoking a new `src/app/api/cron/sale-sync` and
`src/app/api/cron/rent-sync` route pair, each guarded by Vercel's own documented
`Authorization: Bearer $CRON_SECRET` convention (a new env var, not hardcoded — needs to be added
to Vercel's env config before activation, out of this STEP's own scope to add).

## 14. Vercel Region

`vercel.json`'s `"regions": ["icn1"]` applies to Vercel Functions generally, and Vercel Cron
invocations execute as regular Function invocations — so a new cron route under the same project
inherits `icn1` automatically. No separate region config needed for cron specifically; no risk of
silently falling back to `iad1` was found (the project-level `regions` setting is the only regional
config surface, and it already applies).

## 15. Schedule

**Recommended**: run both sale and rent shortly after month-start, not daily. A monthly job avoids
unnecessary MOLIT calls while the overlap window still catches corrections discovered later in the
month via the *next* month's run. Suggested: **매월 3일** (a small buffer past the 1st/2nd, in case
of month-boundary reporting lag — this is a conservative, not evidence-derived, choice; §12 found
no hard evidence either way, so this errs toward safety rather than being asserted as proven-optimal).
Sale and rent can run on the **same day, as separate cron invocations** (separate routes/functions)
— no evidence found that they need different schedules; keeping them separate functions (not one
combined function) preserves independent retry/failure isolation regardless of same-day timing.

## 16. Concurrency

No lock schema exists, and this Phase adds none (out of scope). Risk assessment: Vercel Cron does
not by default prevent overlapping invocations if a previous run is still executing when the next
fires — for a **monthly** schedule this is a low-probability scenario (a run would need to still be
active a full month later), and the existing natural-key `@@unique` constraint is real production
protection against duplicate-insert races even if two runs did somehow overlap (a second writer
hitting the same natural key gets a constraint violation, not silent duplication). **Recommendation:
rely on the existing unique constraint for Phase 2's initial activation (matches this Phase's "no
new lock schema" constraint) — this is judged sufficient given monthly cadence, not weekly/daily.**

## 17. Timeout

Real dry-run timing this STEP: sale 17 cells → 10.5s; rent 32 cells → ~14s. Extrapolating to
production defaults (sale overlap=3 → ~48 cells ≈ 30s; rent overlap=2 → 32 cells ≈ 14s), a combined
worst case of **under 60 seconds total**, comfortably within typical Vercel Function timeouts on
either Hobby or Pro tier. **No district/month batching needed for the current Busan-only, monthly-
cadence scope.** (Nationwide expansion, if it ever happens, would need this reassessed — out of
scope here.)

**Known unresolved gap, carried over from an earlier STEP**: this project's actual Vercel plan tier
(Hobby vs Pro) was flagged as needing dashboard confirmation once before
(`docs/development/20-infra-db-connection-analysis.md:506`) and was never subsequently confirmed
in any doc found this STEP. This audit's ~60s estimate is well within either tier's defaults, so it
is **not treated as a blocker**, but Phase 2 should confirm the actual plan/timeout limits from the
Vercel dashboard before activation rather than relying on this estimate alone.

## 18. MOLIT Call Volume

Sale: 16 districts × 3-month overlap ≈ 48 calls/run. Rent: 16 districts × 2-month overlap = 32
calls/run. Combined ≈ **80 MOLIT calls per monthly cycle** (sequential, rate-limited, per the
existing `fetchOneRegionMonth` throttle already in place — concurrency=1, min 350ms interval,
already-proven pattern, not new). This STEP did not independently re-verify data.go.kr's exact
daily quota ceiling — 80 calls/month is trivially low relative to any typical government open-API
quota, but this is stated as a reasonable inference from call volume, not a confirmed quota number.

## 19. Expected Monthly Writes

Based on this STEP's real dry-run samples: sale found **23 new inserts** for a 1-month overlap
scope across 16 districts — extrapolating loosely to a 3-month overlap run, expect low-tens to
low-hundreds of inserts/month (correction volume, not bulk backfill scale) plus a small number of
cancellation-flip updates (historically low-single-digit-percent of monthly volume, per the
project's own past cancellation-audit STEPs). Rent found **0** for this cycle specifically (already
caught up) — going forward, expect INSERT volume roughly matching each new month's real transaction
count per district (hundreds, per the density samples in §4), with **UPDATE volume expected to
remain at or near 0** per §9's finding, until/unless a real correction is observed.

## 20. Failure / Retry

Both pipelines: a single district-month failure does not abort the run; it's recorded and the run
continues. Neither pipeline has an in-run retry loop beyond the existing per-request exponential
backoff (up to 6 attempts) already built into `fetchOneRegionMonth`. **A failed cell simply isn't
marked complete, so it's naturally retried on the next scheduled run** (sale via manifest
`lastCompleteIdx` never advancing past a `FAILED` cell; rent has no manifest at all — it always
re-checks the full overlap window regardless of prior success/failure, which is inherently
self-healing for this specific case). Partial success is never recorded as full success — the
`SAFE_GATE`/summary line always reflects true failed/invalid counts.

## 21. Observability

Sale: a per-run text log (git-ignored, local-only) plus a **git-tracked JSON manifest**
(`data/trade-history/nationwide-sync-manifest.json`) with per-cell status/counts — already
surfaced in `/admin/ops` via `nationwideManifestResult`/`lastSyncAt` (confirmed:
`src/app/api/admin/ops/route.ts:26,111-112,176,194`). Rent: **no equivalent persisted, admin-
visible artifact** — its run logs are local-only, and its "coverage" state
(`RENT_VERIFIED_FROM/TO`) is a source file, not something `/admin/ops` currently reads or displays
at all (confirmed: zero "rent"/"RENT" matches in `admin/ops/route.ts`). **This is a real gap**:
today, an admin has no way to see rent sync freshness from any admin screen.

## 22. Admin Ops Integration

Sale's manifest-derived freshness is already visible in `/admin/ops` (existing screen, no new admin
system needed — matches this task's explicit "새 admin system 금지"). Rent needs, at minimum, its
`RENT_VERIFIED_FROM/TO` constants and last-sync-log summary surfaced in the same existing screen —
a small, additive change for Phase 2, not a new page.

## 23. Coverage (Decay / Auto-Expansion)

Sale: manifest-driven, auto-expands correctly as each run advances `lastCompleteIdx` per region —
no human edit required for sale's own freshness tracking to stay current.
Rent: **confirmed P0** (§2) — `RENT_VERIFIED_FROM/TO` requires manual human editing after every
successful sync; the sync script deliberately does not auto-update it. **Phase 2 cannot safely
activate an unattended rent cron without also deciding**: either (a) build an auto-update
mechanism for these constants as a companion change, or (b) accept that "verified coverage" will
silently fall behind actual synced data every month until a human manually bumps the constant —
which defeats a real part of the automation's purpose. This is the single most important decision
this Phase surfaces for rent.

## 24. Provenance

Both are currently **hardcoded source-file constants**, not DB-derived, not config-file-driven.
Sale's manifest is the closer-to-automatic model (JSON file auto-written by the script, machine-
readable, git-tracked) — worth using as the template for whatever rent coverage-tracking mechanism
Phase 2 designs, rather than inventing a new pattern.

## 25. Cancellation Limitations

**Sale**: this Phase's automation readiness work does **not** claim to have solved all-time
cancellation verification — the existing 2년최고가 SAFE/LIMITED policy (per
`TRADE_CANCELLATION_RESYNC_V2`) is unchanged and still the operative trust boundary; only the
*recent* (overlap-window) cancellation-lag absorption is what this automation provides.
**Rent**: reiterated per this task's own explicit instruction — the MOLIT rent API has **zero**
cancellation fields (empirically confirmed on 2,543 real rows in an earlier phase). **No
automation-related doc, UI, or admin surface may ever say "rent cancellation verified" — this
concept does not exist for rent data and this Phase does not create it.**

## 26. Security

No cron endpoint exists yet (§13). When Phase 2 builds one, it must follow Vercel's own documented
`Authorization: Bearer $CRON_SECRET` pattern (env var, never hardcoded) — there is no existing
in-repo convention to point to since this would be the first cron route, so Phase 2 needs to
establish this pattern carefully and correctly the first time.

## 27. Activation Plan (Phase 2 scope, not performed this Phase)

1. **Fix sale pagination gap** (§1) — port `rent-molit-fetch.ts`'s paginated/totalCount-verified
   fetcher into the sale sync path, or add totalCount verification directly to
   `fetchOneRegionMonth`. This should land *before* Cron activation, not after — it's a
   correctness fix, not a scheduling concern, but an unattended monthly Cron is exactly the
   context where a silent truncation would go unnoticed longest.
2. **Decide rent coverage auto-update** (§23) — either build an automatic
   `RENT_VERIFIED_FROM/TO` update mechanism (mirroring sale's manifest pattern) as a companion
   change, or explicitly accept manual upkeep as an ongoing operational task and document who's
   responsible for it monthly.
3. **Add `CRON_SECRET`** to Vercel env config (Production), following Vercel's documented Cron
   auth convention.
4. **Build two new routes**: `src/app/api/cron/sale-sync` and `src/app/api/cron/rent-sync`,
   each invoking the existing (now pagination-fixed, for sale) runner logic in `--apply` mode,
   guarded by the `CRON_SECRET` check.
5. **Register `vercel.json`'s `crons` array** — both jobs, same day (suggested 매월 3일, §15),
   separate invocations.
6. **Extend `/admin/ops`** to surface rent freshness (§22) alongside the existing sale manifest
   display — additive to the existing screen, no new admin page.
7. **Post-run verification step**: after the first few real Cron-triggered applies, manually
   re-run this Phase's own dry-run comparison (§7/§8 methodology) to confirm DB now matches what
   the apply run claimed to have written — do not trust the apply run's own self-report alone for
   the first several cycles.
8. **PM review gate**: if/when rent's UPDATE path fires for real for the first time (§9), pause
   and review that specific event before treating rent UPDATE as routine.

## 28. Rollback

Disabling the automation is reversible and safe: remove the `crons` entries from `vercel.json`
(or revert that commit) — this stops future invocations immediately, with no effect on already-
synced data. **Rows already written by a successful apply run are real, valid production data
(same trust level as any other synced row) and must never be deleted as part of a "rollback"** —
per this task's own explicit instruction (§36) and the project's broader principle that a
correctly-written row is never punished for how it arrived. If a specific apply run is later found
to have written something wrong (e.g., due to a bug discovered after activation), the correct
response is a targeted, evidence-based correction of the specific bad rows (following this
project's established `TRADE_CANCELLATION_RESYNC_V2`-style pattern: audit → reproduce → scoped
fix), not a blanket DELETE.
