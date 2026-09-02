# DECISION JOURNEY V1.1 — Canonical Apartment Identity Hardening

**Date:** 2026-09-02
**Baseline commit:** `f662328` (branch `main`, follows `DECISION_JOURNEY_V1`)
**Scope:** Not a UI redesign — strengthen `aptSeq` propagation across the journeys
`DECISION_JOURNEY_V1` already connected, so that once a user has selected a specific apartment,
`aptSeq` (when safely available) is preserved through every downstream hop instead of being
silently dropped to `lawdCd+dong+name`.

**Identity priority enforced everywhere in this STEP:** `aptSeq` > `lawdCd+dong+exact name` >
**no link**. Never: name-only matching, substring matching, first-match, same-dong fallback, or
"similar apartment" fallback. A wrong link is worse than no link.

---

## 1. Core Design — `deriveCanonicalAptSeq`

`/api/apt/[name]/route.ts` already computed `strongAptSeqs` internally (via
`resolveStrongIdentityAptSeqs`/`matchesTradeIdentity` in `src/lib/apt-name-match.ts`) to filter
MOLIT trades down to exactly the requested name+dong's apartment — but never returned `aptSeq` in
the response, so every downstream consumer only ever saw `lawdCd+dong+name`.

Real MOLIT data has a documented edge case (already handled by `resolveStrongIdentityAptSeqs`,
which returns a `Set<string>` for exactly this reason): the *same* apartment name in the *same*
dong can legitimately carry more than one `aptSeq` (registry/phase-split artifacts). Because of
this, a single scalar "the aptSeq" cannot always be produced safely — picking one arbitrarily when
several exist would violate the task's own priority rule (no wrong-link risk is acceptable, but an
*ambiguous-but-still-correct* candidate set must not be collapsed by guessing).

`deriveCanonicalAptSeq(trades, incomingAptSeq?)` (`src/lib/apt-name-match.ts`) resolves this:

```
1. distinctSeqs = the set of non-null aptSeq values across trades (already name+dong verified)
2. if incomingAptSeq is present AND is a member of distinctSeqs → return incomingAptSeq
3. else if distinctSeqs.size === 1 → return that one value
4. else → return null (fall back to the existing lawdCd+dong+name composite identity)
```

This gives an incoming `?aptSeq=` (from Map/Search/Stats/Compare) exactly the role the task asked
for: a **hint that is validated, never blindly trusted**. An incoming aptSeq that does *not* match
what the trustworthy trade data independently confirms is silently ignored in favor of the
server-verified value (or `null` if that's ambiguous too) — never used to pull in a different
apartment's data.

## 2. Identity Audit (per flow)

| Flow | Source has aptSeq? | URL carried it (before)? | Destination read it (before)? | Fallback occurred? | Status after |
|---|---|---|---|---|---|
| Search → Detail (Home) | Yes (`ApartmentSearchResult.aptSeq`) | No — used only for the `/verify` call, dropped before the final `router.push` | No | Composite only | **Fixed** — `navigateToApt` now carries `aptSeq` |
| Map → Detail | Yes (`AptMarker.aptSeq`) | No | No | Composite only | **Fixed** — marker click + bottom-sheet both carry `aptSeq` |
| Detail → Map | Not held as page state (dropped in API response) | N/A | N/A | Composite only | **Fixed** — trades now return `aptSeq`; `deriveCanonicalAptSeq` feeds `buildDetailMapUrl` |
| Detail → Compare | Same as above | N/A | N/A | Composite only | **Fixed** — same canonical value feeds `buildDetailCompareUrl` |
| Compare → Detail | Search-result `aptSeq` (when adding via autocomplete) or prefill | Partially — search-added complexes had it in scope but it wasn't stored/used | No | Composite only | **Fixed** — `selected`/`initialComplex` carry `aptSeq`; "상세보기" link includes it |
| AI-search Compare → Detail | Same trades API as Detail (now returns `aptSeq`) | No | No | Composite only | **Fixed** — `fetchCompareTarget` derives canonical aptSeq, `compareComplexDetailHref` includes it |
| Stats → Detail | Yes (`aptSeq: string \| null` already on 5 of 6 view row types) | No — present on the row object but never added to the outbound query | No | Composite only | **Fixed** for `PriceRankingView`, `Area84RankingView`, `GapInvestView`, `LargeComplexView`, `TransactionFeedView`. `ConcentrationView` and `RegionChangeMapView` genuinely have no aptSeq at their data source — left unchanged (see §9) |
| Favorites → Detail | No — DB unique key is `(userId, lawdCd, dong, name)`, no aptSeq column | N/A | N/A | Composite only | **Unchanged** — would require a Prisma schema change, out of scope (DB safety rule) |
| Score → actions | N/A (embedded in Detail, uses Detail's own identity) | — | — | — | Inherits Detail's canonical aptSeq automatically (same `nextActions` array) |

## 3. Detail's Own Context

**aptSeq available:** Yes, but indirectly — `apt-client.tsx` never held `aptSeq` as page state
before this STEP (confirmed: zero references to `aptSeq` anywhere in the file pre-change). The
trades it already fetches (`/api/apt/[name]`) internally resolve `strongAptSeqs` but discarded them
before responding.

**Propagated:** `/api/apt/[name]/route.ts` now includes `aptSeq: item.aptSeq || null` on every
returned trade object (one-line, additive — the trade-filtering logic itself, which has a long,
carefully-commented bug history, was **not touched**). `apt-client.tsx` reads an optional incoming
`?aptSeq=` on mount, and computes `canonicalAptSeq = deriveCanonicalAptSeq(trades, incomingAptSeq)`
once trades resolve. Both NextActions (`지도에서 위치 보기`, `비슷한 단지와 비교`) now pass
`canonicalAptSeq` through to their URL builders.

## 4. Map

**Before:** `buildDetailMapUrl` never included `aptSeq`; `/map`'s own share-link contract
(`parseMapStateFromSearchParams` / `matchRestoreIdentity` in `src/lib/map-marker-share.ts`) already
supported `aptSeq` as the top-priority restore-identity — it was simply never exercised from
Detail.

**After:** `buildDetailMapUrl` gains an optional `aptSeq` param, included alongside (not instead of)
`dong`+`name` — `parseMapStateFromSearchParams` already prefers `aptSeq` when present and falls back
to `dong`+`name` automatically, so no change was needed on the Map side at all.

**Highlight — live-verified:** clicked "지도에서 위치 보기" on 대신해모로센트럴아파트's detail
page in a dev session; the resulting URL was
`/map?lawdCd=26140&zoom=4&dong=서대신동2가&name=대신해모로센트럴아파트&aptSeq=26140-1356&lat=...&lng=...`,
and the map correctly resolved and highlighted (`선택` badge) the exact marker via the `aptSeq`
exact-match path.

## 5. Compare

**Before:** `CompareView`'s `selected`/`initialComplex` shape was `{name, lawdCd?, dong?}` — no
`aptSeq` field existed anywhere in the compare data model.

**After:** `aptSeq?: string` added to both types. `addComplex` (manual search) now captures
`result.aptSeq` from `ApartmentAutocomplete`'s existing `ApartmentSearchResult`. Detail's prefill
link carries `prefillAptSeq`, read into `initialComplex` on mount. `CompareView`'s own internal
trade-fetch logic was **not modified** — `aptSeq` only travels alongside identity, it does not
change which data gets fetched (fetching is still `lawdCd`+`dong`+`name`-keyed, matching the
pre-existing, already-safe contract).

**Canonical key:** still `name` (the `Set`/`Map` keys inside `CompareView` are unchanged) —
`aptSeq` is carried as additional identity metadata per slot, not a new key. This is a deliberate,
minimal choice: switching the internal keying to `aptSeq` would be exactly the kind of "Compare
internal redesign" this task explicitly excluded.

**Live-verified round trip:** Detail → Compare (`?prefillAptSeq=26140-1356` observed on the actual
rendered `href`) → Compare's "상세보기" link back to Detail carried
`/apt/...?lawdCd=26140&dong=서대신동2가&aptSeq=26140-1356` — the same value survived two hops.

## 6. AI Search Compare

**aptSeq source:** `fetchCompareTarget` (`src/lib/ai-search.ts`) already calls the exact same
`/api/apt/[name]` route Detail uses, so once that route started returning `aptSeq` per trade, this
function could derive a canonical value with zero new fetches — `deriveCanonicalAptSeq(trades)` is
called right where `dong` was already being extracted from `latest`.

**Navigation:** `CompareComplexData` (both the server-side interface in `lib/ai-search.ts` and the
client-local one in `ai-search-client.tsx`) gained `aptSeq: string | null`. `compareComplexDetailHref`
includes `&aptSeq=` only when present — the existing "no link at all if `resolvedLawdCd` is
missing" honesty rule is preserved and simply extended.

## 7. Stats → Detail

Re-verified all 6 ranking-style view components. Five (`PriceRankingView`, `Area84RankingView`,
`GapInvestView`, `LargeComplexView`, `TransactionFeedView`) already had `aptSeq: string | null` on
their row types (populated by their respective API routes) but never added it to the `goToApt`
`URLSearchParams` builder — a one-line fix (`if (r.aptSeq) qs.set('aptSeq', r.aptSeq)`) in each.
`ConcentrationView`'s `ConcentrationEntry` type has no `aptSeq` field at all (its underlying
`/api/stats/concentration` route doesn't compute it) — left unchanged rather than fabricating a
value; `RegionChangeMapView` similarly has no `aptSeq` anywhere in its row model (a change-between-
periods aggregate, not an identity-tracked view) — also left unchanged. Both are documented here as
"genuinely unavailable," not "forgotten."

## 8. Detail Route (`/apt/[name]`)

**Slug:** unchanged — still the display-name path segment, exactly as before. This STEP explicitly
does **not** treat the existing `/apt/[name]` route shape as canonical identity; it stays a display
slug. **Canonical identity context:** now `aptSeq` (when unambiguous) carried via the `?aptSeq=`
query param, validated against server-verified trade data before being trusted (§1) — the URL slug
and the identity context are cleanly separated, matching the task's explicit "display slug ≠
canonical identity" instruction, without any route/file-structure changes.

**Mismatch behavior:** if an incoming `?aptSeq=` does not appear among the name+dong-verified
trades' own `aptSeq` values, it is never used to select or display different data — `apt-client.tsx`
continues to render whatever the (already-safe, pre-existing) name+dong trade resolution found, and
`deriveCanonicalAptSeq` falls through to either the single verified value or `null` (composite
fallback). No new error UI was added for this case — it is a silent, safe non-adoption of an
untrusted hint, not a user-facing failure state (the page still renders correctly with composite
identity, exactly as it did before this STEP existed).

## 9. Wrong-Link / Mismatch Tests

All covered as pure-function unit tests (Node's built-in test runner, `npx tsx --test`):

- `src/lib/apt-name-match.test.ts` — 7 pre-existing (unchanged, still passing — same-name
  apartments in the same dong with different `aptSeq` do not cross-link, e.g. "경동" vs
  "해운대경동제이드") + 7 new `deriveCanonicalAptSeq` tests: single unambiguous value adopted;
  ambiguous (2+ distinct values) → `null`, never guessed; zero aptSeq present → `null`; incoming
  aptSeq in the verified candidate set → adopted; **incoming aptSeq NOT in the verified set →
  ignored, falls back to the verified single value** (the core "no weak fallback" guarantee); both
  mismatched-and-ambiguous → `null`.
- `src/lib/decision-journey/registry.test.ts` (new) — 4 tests confirming `buildDetailMapUrl`/
  `buildDetailCompareUrl` include `aptSeq` when given and omit it cleanly when absent, without
  ever dropping the existing `lawdCd`/`dong`/`name` fields.
- **All 18 tests pass** (`npx tsx --test src/lib/apt-name-match.test.ts
  src/lib/decision-journey/registry.test.ts`).

**Back navigation:** not unit-testable (browser history behavior) — verified functionally in the
same dev session as the live click-throughs (§4/§5): Detail → Map → back and Detail → Compare →
"상세보기" → back both returned to the expected prior page with no console errors. No new
`router.push`/history-manipulation calls were added anywhere in this STEP (only query strings on
existing navigations changed), so no back-navigation regression risk was introduced structurally.

## 10. Mobile

No CSS/layout was touched in this STEP (pure identity/query-param plumbing). Re-checked the Detail
page's `NextActionSection` at 360px/375px/390px via the same iframe-isolation harness used in
`DECISION_JOURNEY_V1` — visually identical to the V1 screenshots (full-width primary/secondary
buttons, no wrap/overflow). This was a smoke check, not a full re-audit, since no rendering code
changed.

## 11. Performance

Zero new initial page-load API requests. The `aptSeq` field rides on an **existing** fetch
(`/api/apt/[name]`) that both Detail and the AI-search compare path already made — no additional
network round trip was introduced anywhere. The one click-triggered network activity (Map's
geocode-on-click) is unchanged from `DECISION_JOURNEY_V1` and was not touched this STEP.

## 12. Database

READ only (verification queries via the app's own API surface during live testing). WRITE: 0.
Schema: 0. Migration: 0. Favorites' lack of `aptSeq` (§2) was identified as a genuine gap but
explicitly **not** addressed, since closing it would require a Prisma schema change to the
`(userId, lawdCd, dong, name)` unique key — out of this STEP's scope per the DB safety rule, and
per the task's own explicit database constraints (§21: READ only, WRITE 0, schema 0).

## 13. Docs

This file + a short addendum (§16) appended to `DECISION_JOURNEY_V1.md` pointing here.
`CHANGELOG.md` updated.

## 14. Git

Committed and pushed as a single commit (see CHANGELOG for hash) following
`fix(ux): preserve canonical apartment identity across journeys`.

## 15. Next Step

- Favorites remains composite-identity-only; if aptSeq-based favorites become valuable, that needs
  an explicit, approved schema change (new nullable `aptSeq` column, additive migration) — not
  bundled here.
- `ConcentrationView`/`RegionChangeMapView` could gain `aptSeq` if their underlying API routes are
  extended to compute it — not attempted here since it would require touching those routes' actual
  aggregation logic, a larger change than "wire through what's already there."
- `COMPARE_V2` (unifying the two compare implementations) remains the natural long-term
  consolidation point where `aptSeq` could become the primary internal key instead of `name` — still
  explicitly out of scope until separately approved.
