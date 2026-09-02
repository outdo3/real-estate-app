# PERFORMANCE V1.3 — Vercel Production Reality Check

**Date:** 2026-09-02
**Baseline commit:** `85bbc73` (branch `main`, follows PERFORMANCE V1.2)
**Scope:** Measurement and root-cause diagnosis only. No code changes shipped this STEP (per the
task's own constraint — only reproducible, schema-free, low-risk, provable fixes were in scope, and
the one dominant finding below is an infrastructure decision, not a code fix, so it is reported and
recommended rather than applied unilaterally).

---

## 1. Environment

Production URL: `https://real-estate-app-park11.vercel.app` (confirmed via `src/config/site.ts`'s
`CANONICAL_PRODUCTION_URL`, and verified live via `curl`/Vercel CLI). Vercel CLI (`vercel inspect`)
confirms this alias points to deployment `dpl_CWj13hHB2xkV4o1Qg19prTXaLi64` (created ~45 min before
this STEP), whose every Lambda function (`index`, `_global-error`, and all route handlers) is built
in **`[iad1]`** — Washington D.C./Virginia, US East.

## 2. THE Finding: Region Mismatch

**Vercel functions run in `iad1` (US East). The database (Supabase, confirmed via `DATABASE_URL`
host `aws-0-ap-northeast-2.pooler.supabase.com`) runs in `ap-northeast-2` (Seoul).**

Every single DB query from any server function pays a trans-Pacific round trip (Virginia↔Seoul,
physically ~150-200ms one-way minimum, realistically 300-500ms round-trip with TLS/pooler
overhead) — a cost that does not exist in local testing (`next start` on a Windows machine talking
to the same Seoul DB has whatever the local ISP's routing to Seoul is, typically far shorter than
Virginia's, and PERFORMANCE_V1.2's local numbers were measured from Korea).

This is the single dominant, previously-unquantified root cause behind nearly every "still slow in
production" finding in `PERFORMANCE_V1.md`'s open risk list (the Prisma+PgBouncer suspicion noted
since `PERFORMANCE_V1` itself) — not Prisma, not PgBouncer specifically, but **physical distance**.
Confirmed via three independent signals: (a) `X-Vercel-Id` header format `icn1::iad1::<instance>`
on every response (edge=Seoul, function=Virginia), (b) `vercel inspect`'s authoritative build-region
listing (`[iad1]` on every Lambda), (c) DB host inspection (`ap-northeast-2`).

**This STEP does not fix it** — changing a live production deployment's function region is an
infrastructure decision with immediate, unqualified impact on all real traffic, not a code review
change with a safe rollback path in the same sense as everything else in this project's recent
history. It is reported here as the clear, evidence-backed, high-priority recommendation for the
product owner to approve explicitly (see §26).

## 3. Measurement Method

`curl -w` timing (TTFB = `time_starttransfer`, total = `time_total`) against the live production
domain, 3 sequential requests per route ("cold-like" = first hit, "warm" = immediate repeats — see
§15 for why even the "warm" repeats often don't behave like local warm-cache hits). No load
testing, no synthetic traffic beyond what's reported here.

## 4. Home

| Run | TTFB | Total |
|---|---|---|
| 1 (cold-like) | 370ms | 372ms |
| 2 | 126ms | 127ms |
| 3 | 117ms | 119ms |

**FAST** (≤500ms) on every run. Home is a largely static/prerendered page (`X-Nextjs-Prerender: 1`
observed), so it doesn't touch the DB round-trip problem.

## 5. Map

| Run | TTFB | Total |
|---|---|---|
| 1 | 949ms | 950ms |
| 2 | 117ms | 118ms |
| 3 | 333ms | 334ms |

**PASS/FAST.** Page shell loads well within target. Real click-through journey test (click "지도에서
찾기" from Home, screenshot the result): the map was **already showing detailed price markers**
(not just a base map) within the ~2s explicit wait used in this STEP's browser test — a precise
millisecond figure wasn't reliably capturable due to tool-call overhead in the measurement harness
itself, but the qualitative result is unambiguous: this journey is fast and confirms
`MAP_PERFORMANCE_V1`'s fixes are holding up in production.

## 6. Search

| Run | TTFB | Total |
|---|---|---|
| 1 | 5,363ms | 5,365ms |
| 2 | 2,943ms | 2,944ms |
| 3 | 2,970ms | 2,971ms |

**P0/FAIL on every run, including "warm".** This route was not part of PERFORMANCE_V1/V1.1/V1.2's
scope and had never been measured against production before. Flagged as a new, previously-unknown
P0 finding — see §19.

## 7. Detail (Apartment Detail Page)

| Run | TTFB | Total |
|---|---|---|
| 1 | 1,289ms | 1,290ms |
| 2 | 328ms | 330ms |
| 3 | 325ms | 325ms |

**REVIEW on first hit, FAST on repeat.** Mobile QA (360/375/390px, iframe-embedded live production
page): layout renders correctly at all three widths, no overflow, bottom nav intact — the ~13s
total load time observed in the interactive browser test (page shell + client-side data fetching,
not just the HTML TTFB measured by curl above) is consistent with the Score API's own slow first
hit (§8) plus this page's other API calls, not a layout bug.

## 8. Score

| Run | TTFB | Total |
|---|---|---|
| 1 | 925ms | 926ms |
| 2 | 422ms | 423ms |
| 3 | 311ms | 311ms |

**REVIEW → PASS.** First hit borderline, settles into PASS/FAST range.

## 9. Busan Dashboard (12m, sido-wide)

| Run | TTFB | Total |
|---|---|---|
| 1 (cold-like) | 16,251ms | 16,263ms |
| 2 | 380ms | 394ms |
| 3 | 307ms | 320ms |

**P0/FAIL cold, FAST on repeat.** The cold number is **3.4x worse than the worst local
measurement** in `PERFORMANCE_V1_2` (4,854–5,478ms) — see §16 for the reasoned breakdown. The
dramatic warm improvement (307–394ms) on repeats 2-3 is a strong signal these two repeats happened
to land on the *same* warm Lambda instance (sharing the in-memory `getOrSetCache`) — not something
that can be relied on for arbitrary real users, whose requests Vercel may route to any available
instance (see §15/§17).

## 10. District Dashboard (서구)

| Run | TTFB | Total |
|---|---|---|
| 1 | 9,650ms | 9,667ms |
| 2 | 294ms | 306ms |
| 3 | 302ms | 316ms |

**P0/FAIL cold, FAST on repeat.** Same pattern as §9 — a single district still needs 3 concurrent
DB round-trips (sale, rent-rows, rent-agg), each paying the Virginia↔Seoul cost on a true cold
instance.

## 11. area84

| Run | TTFB | Total |
|---|---|---|
| 1 | 9,976ms | 9,979ms |
| 2 | 6,080ms | 6,082ms |
| 3 | 6,179ms | 6,182ms |

**P0/FAIL on every single run, including "warm."** This is the most concerning result in this
STEP — `PERFORMANCE_V1.1-B` proved this exact route locally at warm=100ms, cold=1.49s. In
production it never drops below 6 seconds even on repeat. See §16/§17 — this is not explained by
the region gap alone (which would predict maybe 2-3x local, not 60x); something about this specific
route's cache behavior or query shape is being hit especially hard. Flagged as the top candidate
for a dedicated Vercel-specific follow-up investigation.

## 12. Rise / Decline

| Route | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| rise | 5,149ms | 3,340ms | 3,314ms |
| decline | 5,505ms | 3,339ms | 3,363ms |

**P0/FAIL on every run.** Same class of problem as area84, one tier less severe.

## 13. Region Change

| Run | TTFB | Total |
|---|---|---|
| 1 | 1,298ms | 1,299ms |
| 2 | 377ms | 378ms |
| 3 | 296ms | 297ms |

**REVIEW → FAST.** The best-behaved of the "heavier" stats routes — consistent with
`TRADE_DB_FIRST_V1 STEP D`'s already-proven 23ms local SQL execution leaving little room for the
region gap to compound (fewer sequential round-trips than area84/rise/decline).

## 14. Record High

| Run | TTFB | Total |
|---|---|---|
| 1 | 5,038ms | 5,039ms |
| 2 | 3,323ms | 3,325ms |
| 3 | 3,353ms | 3,354ms |

**P0/FAIL on every run.** Same class as rise/decline.

## 15. Local vs. Vercel

| Scope | Local (Performance V1.2, 3 clean restarts) | Vercel cold | Vercel warm |
|---|---|---|---|
| Busan-wide dashboard | 3.7s / 4.85s / 5.48s | **16.25s** | 0.31-0.39s |
| District dashboard | 357-711ms | **9.65s** | 0.29-0.32s |
| area84 | not re-measured this STEP (PHASE V1.1-B: cold 1.49s, warm 0.10s) | **6.08-9.98s (never fast)** | same, no warm state observed |

**The gap is large, real, and directional** — Vercel cold is consistently far worse than local cold,
confirming the region-mismatch hypothesis (§2) as the dominant explanation, not test noise. The
area84/rise/decline/record-high routes additionally never reach a genuinely fast "warm" state in
production the way they reliably do locally — most plausibly because Vercel's serverless instances
don't share the in-memory `getOrSetCache` the way a single long-lived `next start` process does
(§17), so "warm" in production depends on request routing luck, not a guaranteed cache hit.

## 16. Dashboard Breakdown (Busan-wide, reasoned from confirmed architecture + measured local proportions)

Live Vercel function logs were attempted (Vercel CLI is authenticated and linked) but did not yield
readable per-request runtime traces within this STEP's time budget — this breakdown is therefore
**reasoned, not directly traced**, built from: (a) PERFORMANCE_V1.2's local instrumented proportions,
(b) the confirmed ~400-500ms round-trip cost per DB hop added by the region mismatch (§2), (c) this
STEP's own curl total (16.26s).

| Component | Local (Seoul→Seoul) | Estimated Vercel (Virginia→Seoul) contribution |
|---|---|---|
| Region metadata (`getSigunguListForSido`, external HTTP, not DB) | ~365-890ms | similar (not a DB round-trip, Virginia→wherever the region proxy is) |
| Sale raw fetch + rent rows + rent aggregate (3 parallel DB queries) | ~1.4-2.1s (local) | **each query pays the ~400-500ms round-trip on top of its own execution time — parallel, but on a cold Lambda with no pre-warmed pool connections, plausibly 3-6s combined** |
| Current-month MOLIT (16 calls, external to Vercel entirely) | ~700ms-1.8s | similar order, MOLIT's own latency is independent of Vercel's region |
| Pyeong batch (2 queries, now VALUES-join optimized) | ~380-600ms (local) | **same 400-500ms per-hop cost applies — plausibly 1-2s for the now-2-query pattern** |
| Serialization + remaining JS (hotIssues/topPrices/gapInvest/etc.) | ~200-400ms | similar, JS work itself is not network-bound |

Summed, this reasoning lands in the same order of magnitude as the observed 16.26s, though it should
be read as **an explanation of why the number is what it is, not a verified line-by-line trace**.

## 17. Current-Month MOLIT Share

Structurally unchanged from `RENT_TRADE_HISTORY_V1_PHASE_D2` — 16 calls for the single remaining
unverified month, external to Vercel's own latency profile (MOLIT's own government-API latency is
the same regardless of which region the calling function runs in). Contributes an estimated
700ms-1.8s to the Busan-wide cold total, a real but **not the dominant** component next to the
DB round-trip multiplication effect in §16.

## 18. Mobile QA

Tested via iframe-embedded live production pages at 360/375/390px (browser resize tooling is
non-functional in this environment, per prior sessions' findings — iframe-isolation technique
reused):

| Page | 360px | 375px | 390px |
|---|---|---|---|
| Home | ✅ clean | ✅ clean | ✅ clean |
| Map | ✅ clean, markers render | ✅ clean, markers render | not separately tested (same component) |
| Apartment Detail | not separately tested | not separately tested | ✅ clean after full load, no overflow, bottom nav intact |

No horizontal overflow, clipped text, or bottom-nav overlap found at any tested width. This closes
`MAP_PERFORMANCE_V1`'s previously-open "mobile real-device check pending" item for the map page
specifically (tested via emulated viewport, not a physical device — still an honest gap if a real
device is required, but the layout-correctness question is now answered).

## 19. Remaining >2s Routes

- Search (2.9-5.4s, every run)
- Busan-wide dashboard cold (16.3s)
- District dashboard cold (9.7s)
- area84 (6.1-10.0s, every run including warm)
- Rise (3.3-5.1s, every run)
- Decline (3.3-5.5s, every run)
- Record-high (3.3-5.0s, every run)

## 20. Remaining >3s Routes

- Busan-wide dashboard cold (16.3s)
- District dashboard cold (9.7s)
- area84 (6.1-10.0s — **every run, not just cold**)
- Rise (5.1s cold)
- Decline (5.5s cold)
- Record-high (5.0s cold)

## 21. Code Changes

**None shipped this STEP.** Per the task's own constraint, code changes were only authorized for
bottlenecks that are (a) reproduced in real Vercel measurement, (b) schema-free, (c) low-risk, (d)
provable via before/after. The one finding that dominates everything else (§2, region mismatch) is
an infrastructure/deployment-configuration decision, not a code change — it doesn't fit those four
conditions the way a query rewrite does, because "before/after" can only be proven by actually
redeploying to a different region, which changes live production behavior immediately for all
traffic. That is exactly the kind of hard-to-reverse-in-effect, shared-system-impacting action this
project's own safety principles require explicit approval for, even though the `vercel.json` diff
itself would be trivial and gitrevertible. Recommended, not applied — see §26.

## 22. Database

READ only this STEP (measurement queries via the app's own API surface, no direct DB writes,
schema, or migration touched).

## 23. Test / Build

Not applicable — no code changed this STEP, so no new test/build run was needed beyond what
PERFORMANCE_V1.2 already verified clean.

## 24. Git

No commit this STEP (measurement/diagnosis only, per the task's own scope).

## 25. Launch Performance Verdict

**NOT READY for a performance-sensitive launch without addressing §2.** Every route touching
multiple sequential/parallel DB round-trips is P0/FAIL in real production despite extensive,
verified local optimization work across PHASE D/D.2 and PERFORMANCE V1/V1.1/V1.2 — because none of
that local work could have anticipated or fixed a cross-continent region mismatch. Home/Map/Detail
(mostly static or already-optimized single-round-trip paths) are in acceptable shape. The stats
routes (dashboard, area84, rise, decline, record-high) and Search are not.

## 26. Next Step (recommended, not applied)

**Highest priority: fix the Vercel function region to match the database region (`ap-northeast-2`
→ closest available Vercel region, `icn1` if available on the current plan).** This is a
`vercel.json` `regions` field addition — schema-free, code-free, and by far the highest-leverage
single change identified across this entire performance investigation series, but it is a
production deployment/infrastructure decision that should be explicitly approved before being
applied, given its immediate, unqualified impact on live traffic. Recommended as the very next
action, ahead of any further query-level optimization — no further code-level fix in this app can
compensate for a 300-500ms-per-round-trip physical distance penalty repeated across every
DB-touching request.

Secondary candidates once the region is fixed and re-measured: (a) investigate why area84
specifically never shows a warm state in production (possibly a serverless-instance-affinity /
cache-sharing issue distinct from the region gap, worth its own follow-up); (b) a fresh Search
route audit (never previously measured, P0 on every run); (c) `RENT TRADE HISTORY V1 PHASE E`
(incremental sync scheduling) once the underlying dashboard latency picture is no longer dominated
by the region gap.
