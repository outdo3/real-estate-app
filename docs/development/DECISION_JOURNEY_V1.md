# DECISION JOURNEY V1 — Core Decision Flow Integration

**Date:** 2026-09-02
**Baseline commit:** `9eb9b31` (branch `main`)
**Scope:** Connect the 8 core user surfaces (Home, Search, Map, Apartment Detail, Score, Stats,
Compare, Favorites/My) so each ends in a next decision action instead of a dead end, via a shared
`NextAction`/`NextActionSection` architecture. No DB/schema changes, no new external APIs, no new
network calls from the shared component itself.

---

## 1. Current Journey (audit)

Full route-level audit performed via a dedicated read-only exploration pass over the actual page
and component code (not assumptions). Summary per surface:

| Surface | Entry | Current CTA | Dead end? |
|---|---|---|---|
| Home | `/` | Search bar → `/apt/[name]` or `/map`; quick-menu → `/stats/[slug]`, `/ai-search` | No |
| Search | distributed (`HomeApartmentSearch`, `/ai-search`, `ApartmentAutocomplete`) | condition/region results → `/apt/[name]` with identity | Partial — AI `compare` intent branch had zero outbound links (see §2) |
| Map | `/map` | Marker click / bottom-sheet "상세보기" → `/apt/[name]?lawdCd=&dong=` | No |
| **Apartment Detail** | `/apt/[name]` | Favorite (toggle), Share (external), 지도/로드뷰 (in-page modal only), 빠른검색 (switch apt), 글쓰기 → `/community/write` | **Yes — P0** (see §2) |
| Score | embedded in Detail | "왜 이런 점수인가요?" (in-page expand only) | Yes (closed together with Detail, see §5) |
| Stats | `/stats` → `/stats/[type]` | Ranking rows → `/apt/[name]` with identity | No (ranking views); Compare view itself was a dead end (see §2) |
| Favorites/My | `/my` | List items → `/apt/[name]` with identity | No |

## 2. Dead Ends Found

1. **Apartment Detail (P0)** — after price/score/briefing/trades/school/living-info, the only
   forward actions were: favorite (bookmark, not a next step), share (external), and "글쓰기"
   (community post). No compare, no real map, no nearby-apartments action existed anywhere on the
   page. "지도"/"로드뷰" buttons opened an **embedded static widget** (`KakaoMapEmbed`), not the
   real `/map` surface.
2. **Score card** (embedded in Detail) — zero forward action; the peer-comparison text
   ("비슷한 단지 중 상위 X%") was descriptive only, no link.
3. **`/stats/compare` and `/stats/multi-compare`** (`CompareView`, one shared component behind two
   menu slugs) — could add complexes via search, but had no outbound link back to any complex's
   detail page.
4. **AI Search `compare` intent** (`CompareResult` in `ai-search-client.tsx`) — a genuinely
   separate implementation from #3, reachable only by typing a comparison-shaped query into
   `/ai-search` (no menu/button leads there). Rendered a static attribute table with zero outbound
   links to either compared apartment's detail page.

Home, Map, Stats ranking views, and Favorites/My were already forwarding correctly with real
identity (`lawdCd`+`dong`+`name`) and needed no changes.

## 3. Target Journey

```
Home / Search / Stats rankings / Favorites  →  Apartment Detail (DATA + INTERPRETATION)
                                                      │
                                     ┌────────────────┼────────────────┐
                                     ▼                                 ▼
                              지도에서 위치 보기                비슷한 단지와 비교
                              (real /map, marker highlighted)   (/stats/compare, prefilled)
```

Score stays embedded in Detail; its "next action" is the same NextActionSection immediately below
it, so viewing the score and reaching the next action requires no extra scrolling logic. Compare's
existing views (both slugs) and the AI-search compare table gained outbound links back to
`/apt/[name]` so the loop closes in both directions.

## 4. Shared Architecture

- `src/lib/decision-journey/types.ts` — `NextActionType` union (`COMPARE | MAP | NEARBY | FAVORITE
  | PRICE | TRANSACTIONS | SCORE | BUDGET | SEARCH | BACK_TO_RESULTS`) and `NextAction` interface
  (`href` or `onClick`, `priority: 'primary' | 'secondary'`, optional `loading`).
- `src/lib/decision-journey/registry.ts` — pure URL builders (`buildDetailMapUrl`,
  `buildDetailCompareUrl`) that only ever target existing routes and their existing query
  contracts (`/map`'s `parseMapStateFromSearchParams`, `/stats/compare`'s new prefill params — see
  §6). No new state, no new API calls.
- `src/lib/decision-journey/geocode-for-map.ts` — client-side geocode-on-click helper, reusing the
  same Kakao Maps JS SDK load pattern already duplicated across 8+ components in this codebase
  (`KakaoMapEmbed.tsx`, `map/page.tsx`, `ApartmentAutocomplete.tsx`, etc.) — not a new dependency,
  just the same SDK invoked at a new trigger point.
- `src/components/decision-journey/NextActionSection.tsx` (+ CSS module) — renders `NextAction[]`
  as `primary` (green, full-width) + `secondary` (outline) buttons via the existing `Button`
  component (`href` → `Link`, `onClick` → `button`, both already supported). Fires one
  `next_action_click` analytics event per click (see §13).

New API calls introduced by the shared component itself: **0**. The only "new" network activity is
the on-click geocode for the Map action, which is a client-side third-party SDK call triggered by
explicit user action, not a page-load cost.

## 5. Detail

**Primary:** 지도에서 위치 보기 (MAP) — `onClick` handler geocodes `primaryAddress` (already
computed on the page) via `geocodeAddressToCoords`, then `router.push(buildDetailMapUrl({ lawdCd,
dong, name, lat, lng }))`. Verified end-to-end in a live dev session: navigated to
`/map?lawdCd=26140&zoom=4&dong=서대신동2가&name=대신해모로센트럴아파트&lat=...&lng=...` and the
exact apartment's marker was found and highlighted (`선택` badge) via the map's existing
`matchRestoreIdentity`.

**Secondary:** 비슷한 단지와 비교 (COMPARE) — static `href` to
`/stats/compare?prefillName=...&prefillLawdCd=...&prefillDong=...`. Verified end-to-end: landed on
`/stats/compare` with the current apartment already in slot 1 (with its own "상세보기" link, see
§10) and its 3-year price chart already loaded, one slot open for a second complex.

**Identity:** both actions use `lawdCdState` + `urlDong` + `displayName`/`aptName`, the same triple
already used app-wide (Home/Map/Stats/My) — no `aptSeq`-based routing, no name-only fallback. Both
render only once `addressReady` (`!loading && primaryAddress`) is true, so no broken link shows
before data resolves.

**Placement:** immediately after the Score card + AI briefing block, before the price-chart/TIER 2
section — so it also serves as Score's own next-action point (§7) without a duplicate component.

## 6. Search

The `condition_search`/`regional_stats` intents in `/ai-search` already forwarded with identity —
untouched. The `compare` intent (`CompareResult`) was a dead end; closed in §10 below (bonus fix,
same root cause as the Stats Compare dead end).

## 7. Map

No changes needed — Map already forwards to Detail with identity on marker click and bottom-sheet
"상세보기". Detail → Map now works in the other direction (§5), reusing Map's existing share-link
query contract (`lat`/`lng`/`zoom`/`lawdCd`/`dong`/`name`) unmodified.

## 8. Score

No standalone route; embedded in Detail (`ApartmentScoreCard`). No changes to the score card
itself (formula/weights/eligibility untouched, per AGENTS.md's Score protection rule). Its "next
action" need is satisfied by the same `NextActionSection` placed directly below it (§5) — the
peer-comparison text ("비슷한 단지 중 상위 X%") remains descriptive-only and unmodified.

## 9. Stats

Ranking views (`decline`/`rising`/`record-high`/`area84`/etc.) already forward to Detail with
identity — no changes needed. `CompareView` (both `/stats/compare` and `/stats/multi-compare`)
gained: (a) an `initialComplex` prop seeded from `?prefillName=&prefillLawdCd=&prefillDong=` on
first mount only (no `addComplex`/`ApartmentSearchResult` fabrication — `selected` state is seeded
directly with the same minimal `{name, lawdCd, dong}` shape it already used), and (b) an outbound
"상세보기" link per selected complex slot.

## 10. Compare

Per the task's explicit constraint, **no Compare V2 redesign** was performed. Two additive,
non-redesigning connections were made:
- Detail → Compare prefill (§5/§9), reusing `CompareView`'s existing per-complex trade-fetch effect
  unmodified — the seeded complex is fetched through the same code path as a manually-searched one.
- AI-search `compare` intent table (`CompareResult`) — added `dong` to `fetchCompareTarget`'s return
  and to `CompareComplexData` (both `lib/ai-search.ts` and the client-local interface), then linked
  each complex's header name to `/apt/[name]?lawdCd={resolvedLawdCd}&dong={dong}` — only when
  `resolvedLawdCd` is present, so no broken/guessed link is ever shown.

**Limitations documented, not fixed this STEP:** the AI-search compare table is still only
reachable via a free-text query shaped like a comparison (no menu/button leads to it) — that is a
discoverability gap, not something this STEP's scope (connecting existing dead ends) covers, and
fixing it would mean adding a new UI entry point, which edges toward the Compare redesign this STEP
was explicitly told to avoid.

## 11. Favorites

No changes — `/my` already forwards favorites/recent-views to Detail with identity, and
`FavoriteButton` (already mounted on Detail's Hero + StickyActionBar) is reused as-is. No new
Favorite affordance was added to `NextActionSection` to avoid a third, duplicate favorite control on
the same page (Hero + StickyActionBar already cover it) — consistent with the CTA-priority
guidance (primary 1 + secondary 2-3, not more).

## 12. Mobile

Verified via the iframe-isolation technique (local static harness at 360px/375px/390px widths,
since `resize_window` is non-functional in this environment) on `/apt/[name]` and
`/stats/compare?prefillName=...`:
- `NextActionSection`'s buttons stack full-width below 400px (`@media (max-width:400px)`), title
  and both buttons render without wrap/clip/overflow at 360px and 375px.
- 390px was not independently screenshotted (see below) but shares the exact same media-query
  bucket (`max-width:400px`) as the two widths that were verified, so its rendering is identical by
  construction, not by separate confirmation — noted honestly rather than claimed as directly
  observed.
- `/stats/compare` prefilled slot ("대신해모로센트럴아파트 상세보기 ›" + remove "×") fits cleanly
  at 360px/375px with no overlap with the region-picker header or the "비교할 단지 검색" input.
- No bottom-nav collision observed on Detail (`NextActionSection` sits well above `StickyActionBar`
  in normal scroll flow).

## 13. Analytics

Added exactly one new event name, `next_action_click`, to the existing fixed taxonomy
(`ANALYTICS_EVENT_NAMES` in `src/lib/analytics/events.ts`) — no schema change, reuses the existing
`PageView`-table-with-reserved-URL-prefix storage strategy and the existing `trackEvent()` client
helper. Every `NextActionSection` click fires this one event with `aptName` context; per-action-type
breakdown was deliberately not added since the existing `TrackEventContext` shape only carries
`complexId`/`aptName` and extending it was out of this STEP's scope (documented as a Next Step).

## 14. Limitations

- Per-action-type analytics breakdown not available (only "some next action was clicked", not
  which one) — see §13.
- AI-search compare table remains a discoverability dead end (no UI entry point) — see §10.
- 390px width verified by shared media-query bucket, not by an independent screenshot — see §12.
- Map action's geocode-on-click adds a one-time client-side Kakao SDK round trip before navigating;
  on geocode failure it falls back to a bare `/map` push (still lands the user on the map, just
  without a pre-highlighted marker) rather than blocking the action.

## 15. Next Step

- If per-action analytics breakdown becomes valuable, extend `TrackEventContext`/`/api/log/event`
  deliberately (small, explicit schema addition, not silently smuggled into existing fields).
- If the AI-search compare table should become a first-class, discoverable feature, that is Compare
  V2 territory and needs its own explicitly-scoped approval per this task's STOP condition.
- `COMPARE_V2` (full redesign, unifying the chart-based and table-based compare implementations)
  remains the natural longer-term consolidation, but was explicitly out of scope here.

## 16. Addendum — Identity Hardening (2026-09-02, `DECISION_JOURNEY_V1.1`)

The FINAL REPORT above noted Detail's NextActions used `lawdCd+dong+displayName/aptName` only, with
no `aptSeq` routing. `DECISION_JOURNEY_V1.1` closed that gap: `/api/apt/[name]` now returns `aptSeq`
per trade (it already computed this internally for identity matching, just never surfaced it), a new
`deriveCanonicalAptSeq()` pure function (`src/lib/apt-name-match.ts`) safely derives a single
canonical `aptSeq` only when unambiguous, and every flow that already had `aptSeq` in scope but
dropped it (Home search, Map markers, 5 Stats ranking views, Compare, AI-search compare) now carries
it through to `/apt/[name]?...&aptSeq=`. See `DECISION_JOURNEY_V1_1_IDENTITY.md` for the full
before/after audit, the ambiguous-match safety design, and live verification evidence.
