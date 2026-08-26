# Detail Price Chart V2.3.2 — Data Trust

Root cause: `InvestmentMetrics` fell back to the newest jeonse transaction when no jeonse existed for the latest sale's exact area. In `전체`, it also compared unfiltered latest transactions. This could produce a ratio such as 94.1% from different unit types.

Comparison metrics now require a selected exact area and a same-area sale plus pure-jeonse pair. Missing data remains unavailable; no cross-unit fallback is permitted. Summary cards use a vertical label/value hierarchy so long jeonse prices remain readable on mobile.
