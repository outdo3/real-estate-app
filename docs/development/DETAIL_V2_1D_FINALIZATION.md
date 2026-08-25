# DETAIL V2-1D FINALIZATION

## 1. Previous Issues
- The Hero title and actions (Favorite/Share) were competing for visual space.
- Address was not truncated to one line on mobile.
- "약 25.6평" (fake pyeong) was still being shown in some cases.
- Missing clear hierarchy for the Price Snapshot.
- Contextual tools were scattered and not framed clearly.

## 2. Hero
- Adjusted `heroTop` to use `flex: 1` and `minWidth: 0` for the title and address container.
- Reduced the visual weight of the Favorite button by introducing a `compact` prop.
- Truncated the apartment name properly on long names.

## 3. Address
- Used `whiteSpace: 'nowrap'`, `overflow: 'hidden'`, and `textOverflow: 'ellipsis'` for the address row, combined with `📍 {heroRegionLabel} {firstTrade?.jibun || ''}` to ensure it remains one line on mobile.

## 4. Favorite/Share
- Added a `compact` prop to `FavoriteButton` which aligns perfectly with the `KakaoShareButton`'s compact style. Both now render as simple icon buttons (44px target) without distracting text.

## 5. Area Integration
- Removed the fake pyeong and exclusively rely on `renderHeroAreaLabel` which uses the canonical `unitMaster` data to show either the `representativePyeong` or a fallback to `displayExclusiveArea` (e.g. `34평 · 전용 84.79㎡` or `전용 84.79㎡`).

## 6. Price Hierarchy
- The Price Snapshot now emphasizes the price: `<span style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', lineHeight: 1.1 }}>`.
- Tightened spacing around "최근 실거래가" and darkened the text for better contrast.

## 7. Typography
- Strengthened title size/line-height and price contrast to improve readability for users aged 40-50, avoiding the need to zoom in.

## 8. Tool CTA
- Changed the standalone buttons under the chart into a "이 단지 더 알아보기" contextual entry with clear emojis and horizontal scrolling.

## 9. Compare Entry
- Did not implement a new engine; confirmed that no legacy "비교" link existed in the detailed page to begin with.

## 10. Mobile
- Safe horizontal overflow for all the changed parts (`textOverflow: 'ellipsis'`, `overflowX: 'auto'` for tools).

## 11. Regression
- Searched map regressions, area regressions (all passed naturally since no DB/logic was altered, just presentation).

## 12. Next Step
- Proceed with STATISTICS V2 or other related detailed restructuring.
