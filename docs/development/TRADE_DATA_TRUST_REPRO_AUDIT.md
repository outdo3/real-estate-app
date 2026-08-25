# TRADE DATA TRUST — REPRODUCTION AUDIT

## Scope

Short reproduction audit for `연산동일동미라주더스타`, five entry-path contracts, and six recent-trade Busan spot checks. No exhaustive Busan scan, schema work, or data write was performed.

## Primary result

- Search identity: `Apartment.id=2831`, `aptSeq=26470-1481`, `lawdCd=26470`, `dong=연산동`, canonical name `연산동일동미라주더스타`.
- Canonical 12-month trade API: HTTP 200, 61 trades, `apiError=null`.
- Latest observed trade: 2026-08-05, 4억 6,000만, 70.9956㎡.
- Direct name-only URL recovery resolved the same `lawdCd/dong` and returned the same 61 trades.
- Detail page request returned HTTP 200.
- False no-trade was not reproduced on a successful API response.

## Entry-path contract

- Home search and detail quick search pass `lawdCd+dong` to both verification API and detail URL.
- Map search selects by `aptSeq` when available; its marker detail handoff passes `lawdCd+dong`.
- Direct marker selection passes the marker's `name+dong` and current `lawdCd`.
- Direct URL without query parameters recovers identity from the existing read path before querying trades.

## Busan spot check

All six APIs returned HTTP 200, a non-empty trade list, and no `apiError`:

- Seo-gu: 대신해모로센트럴아파트 64, 대신롯데캐슬 19.
- Yeonje-gu: 연산롯데캐슬골드포레 106, 연산자이 92.
- Other districts: Haeundae-gu 엘시티 45, Suyeong-gu 삼익비치 270.

The detail UI consumes the same `trades` array and renders a recent-trade row when non-empty. API/UI contract mismatches found: 0.

Interactive browser automation could not connect because its local runtime was denied access to the user AppData path. Entry-path UI conclusions therefore combine real local HTTP responses with source-contract inspection; no visual-browser claim is made.

## Regression protection

The upstream route already distinguishes a total monthly public-API failure with `apiError`. The client did not set `apiError` when the entire detail API returned non-2xx or the fetch rejected, which could make a transport failure look like an empty successful response. A generic, apartment-independent state classifier and four regression cases now preserve these states:

- success + trades
- success + verified zero
- HTTP/network failure
- success + upstream API error

## Original symptom

`UNKNOWN`. The current evidence does not reproduce the historical symptom and cannot distinguish a past identity mismatch, transient API/network failure, stale cache, or deployment timing. No cause is asserted without evidence.

## Validation

- `node --test --experimental-strip-types src/lib/trade-read-state.test.mjs`: PASS, 4/4.
- `npx tsc --noEmit`: `FAIL_EXISTING_SCRIPT_ERRORS`; no current-step TypeScript errors remained. Existing failures are under `scripts/`.
- `npm run lint`: started but did not complete after approximately five minutes and was stopped.
- Targeted ESLint for the three changed source/test files: exit 0, zero errors, one pre-existing unused-disable warning in `apt-client.tsx`.
- `npm run build`: PASS.
