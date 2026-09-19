# E-JIP 15D BRIEFING ENTRY BUG — Production hotfix

- 날짜: 2026-09-19 (KST) · 기준 커밋 `7134df8`
- 범위: 통계 상세 페이지의 "한장 브리핑" 진입 링크. DB/schema 0 · 집계 0 · 리포트 엔진 0.

## 재현 (Production, 수정 전)

`/stats/feed` (부산광역시 전체) → "최근 15일" 선택 → 화면 "2026-09-05 ~ 2026-09-19, 실거래 1992"

| 시점 | 값 |
|---|---|
| 15일 선택 전 링크 href | `/report/city/busan` |
| 15일 선택 후 링크 href | `/report/city/busan` (변화 없음) |
| 클릭 방식 | Next `<Link>`(React onClick → client navigation) |
| 클릭 직전 URL | `https://e-jip.com/stats/feed` |
| 클릭 직후 / 렌더 후 URL | `https://e-jip.com/report/city/busan` — 쿼리는 처음부터 없었다(진입 후 사라진 것이 아니다) |
| 렌더 결과 | 최근 30일 · 2026.08.20 ~ 2026.09.18 · 1,998건 |

## 근본 원인

그 버튼은 `STATS_PERIOD_IMAGE_PARITY_V2`가 고친 **거래량 카드 안의 링크가 아니라**, 통계 상세 페이지(`src/app/stats/[type]/type-client.tsx`)가 volume/change-map을 제외한 모든 화면 위에 그리는 **공용 CTA**였다. 이 CTA는 `href={entry.href}`로 기간 없는 경로를 썼고, 선택 기간은 각 화면(`TransactionFeedView`·`ConcentrationView`) 내부 상태라 CTA에 전달될 길이 없었다. 기존 계약 테스트(`stats-report-entry.test.ts §7-5`)가 오히려 `href={entry.href}`를 고정하고 있었다.

## 숫자 1,992 vs 브리핑

실거래 피드 "전체"는 매매+전월세를 센다: 15일 1,992 = **매매 792** + 전세 669 + 월세 531. 한장 브리핑은 **매매** 리포트라 올바른 대응은 피드 "매매" 792 = 브리핑 15일 792다(거래량 요약 dashboard 15일 매매도 792). 브리핑에 1,992를 맞추면 매매 리포트에 전월세를 섞게 되므로 하지 않았고, 대신 CTA 아래에 "· 매매"를 적어 차이를 밝힌다.

## 수정 (최소)

| 파일 | 변경 |
|---|---|
| `lib/report/stats-report-entry.ts` | `withBriefingPeriod(href, key)` · `statsBriefingTarget(entry, selectedPeriod)` — 통계 기간 키면 `?period=<키>` + "최근 15일 · 2026.09.05 ~ 2026.09.19 기준 · 매매", 아니면 기본 브리핑 + "최근 30일 · 2026.08.20 ~ 2026.09.18 기준 · 매매" |
| `app/stats/[type]/type-client.tsx` | CTA가 `statsBriefingTarget`으로 링크를 만들고 기준 한 줄 표시 · 실거래/거래 많은 단지 화면에 `onPeriodChange` 전달 |
| `TransactionFeedView` · `ConcentrationView` | 선택 기간을 `onPeriodChange`로 알림(선택형 prop, 기존 동작 불변) |
| `VolumeChartCard` | 같은 `withBriefingPeriod` 사용(동작 동일) |
| `app/stats/page.module.css` | `.reportCtaBasis` 한 줄 |

브리핑에 같은 기간이 없는 선택(피드의 이번 주·지난주·12개월)이나 기간 없는/다른 의미의 기간을 가진 화면(하락·신고가·84㎡·갭투자 등의 순위 기간)은 기본 브리핑으로 열되, 그 기간을 라벨로 밝힌다 — 조용한 30일 대체 없음.

## 테스트

`src/lib/report/stats-briefing-entry.test.ts` 4개 — 시·구·동 × 6개 기간 링크와 리포트 범위 일치 · 대응 기간 없는 선택의 기본 라벨 · 쿼리 결합 · 배선. 기존 계약 테스트 2개 갱신(`stats-report-entry §7-5`의 `href={entry.href}` 고정 → 기간 포함 링크, `period-parity 12·13` 결합 함수명).

```
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"      pass 2279 fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"    pass 154  fail 0
npx eslint (변경 파일)                                       exit 0
npx tsc --noEmit                                           src/ 오류 0 · 기존 25건 scripts/tmp → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                              Compiled successfully
```

## Production QA

배포 후 기록.
