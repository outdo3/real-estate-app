# Detail Price Chart V2.3.5 — Area identity

The chart selector previously used Unit Master canonical keys while API trades used the original MOLIT area string. Strict equality therefore returned no transactions when their precisions differed. Selector values now use actual trade-area identity keys; labels remain display-only. No rounding, tolerance matching, or cross-unit fallback was introduced.
