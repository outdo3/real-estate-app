# DETAIL PRICE CHART V2

## 1. Previous Problems

The former Recharts `LineChart` mapped every raw sale and pure-jeonse trade to a sequential X-axis point, then connected those points. It had no aggregation, no volume, sparse date labels, weak hierarchy, and treated detail API failures as empty arrays. Mixed-area views could therefore produce visible raw-trade saw-tooth noise.

## 2. Current Data Semantics

- Source: existing `/api/apt/[name]` GET route, one read each for `type=apt` and `type=rent`.
- Sale: individual MOLIT apartment-sale trades.
- Jeonse: individual MOLIT rent trades with `monthlyRent === 0`; monthly and semi-jeonse are excluded.
- One price point remains one raw transaction. No price average, median, or representative price was introduced.

## 3. Aggregation Decision

Price aggregation is **preserved**. Existing project documentation identifies monthly representative/median policy as a separate data-definition decision, so Chart V2 does not introduce one without approval. The new compact bars only count transactions occurring on the same calendar day and never replace a price value.

## 4. Price Series and Volume

- Sale uses E-JIP green (`#07865a`); jeonse uses blue (`#3152d6`).
- Lines use raw-price points, a small normal dot, and a white-edged selected dot.
- Daily sale/jeonse counts are drawn on a secondary volume axis in the lower chart area. Every raw price point is retained; each day has one volume bar position.

## 5. Period and Axes

1/3/5-year API periods remain unchanged. The X-axis now formats actual trade dates as `YY.MM`, limits tick density, and keeps all source points. The price Y-axis uses Recharts automatic bounds rather than a fixed zero baseline; the volume axis is separate and integer-only.

## 6. Tooltip and Focus

The tooltip shows the actual date, raw sale/jeonse value available at the selected point, and actual same-day counts. `cursor={false}` removes the chart-wide active cursor box. Keyboard `:focus-visible` remains a scoped green outline; touch highlight is scoped to the chart rather than disabled globally.

## 7. Summary Metrics and Interpretation

The chart reports latest observed sale and pure-jeonse values with their report dates. Jeonse ratio, six-month change percentages, and deterministic interpretation are not added because a new representative-price/comparison definition would be required. No metric is fabricated.

## 8. No Trade and Error

Selected exact area with zero trades renders `선택한 조건의 실거래가 없습니다.` without another-area fallback. HTTP/network and upstream API errors render an error state/notice rather than an empty chart.

## 9. Unit Master Integration

`selectedArea` remains the exact raw trade-area string. The parent passes the existing Unit Master-aware display label only for the chart header. Rounded labels never participate in filtering.

## 10. Mobile and Desktop

The chart card is compact at 360/375/390 widths and grows to a wider, 350px desktop chart above 720px. There is no global focus-outline removal. Browser screenshot automation is not retried because its prior AppData permission failure is environmental.

## 11. Benchmarks

3-year local API checks, all HTTP 200 with no API error:

- 대신롯데캐슬: sale 88, rent 70; Unit Master benchmark.
- 연산동일동미라주더스타: sale 143, rent 197; fallback-label benchmark.
- 삼익비치: sale 609, rent 1,373; high-volume benchmark.
- 명륜아이파크1단지: exact `84.919m²` sale 0/rent 0 while `84.9194m²` sale 27; no-trade exact-area benchmark.

## 12. Regression and Next Step

`price-trend-data` tests cover exact-area filtering, raw price preservation, same-day volume, no-trade, and latest-trade selection. The next candidate is PM review of whether monthly representative-price aggregation should be defined; it is intentionally not part of this change.
