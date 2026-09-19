# E-JIP STATS PERIOD & IMAGE PARITY V2

통계 화면에서 고른 기간 하나가 **화면 → API → 한장 브리핑(요약·거래 많은 단지·분포·최근 실거래) → 이미지(PNG) → PDF → 공유 링크**까지 같은 날짜 범위로 가게 한다. 15일 기간을 추가한다.

- 날짜: 2026-09-19 (KST)
- 기준 커밋: `7bc057c`
- 범위: 기간 전달·해석만. **DB write 0 · schema 0 · stats 집계 공식 0 · SEO(canonical/메타 설명) 0 · 취소 코드 0.**

---

## 1. 근본 원인 — 30일 fallback은 세 군데였다

| # | 위치 | 동작 |
|---|---|---|
| 1 | `volume-period.ts` `briefingPeriodFor()` | 거래량 카드의 브리핑 링크가 오늘·어제·7일·30일을 **전부 30일**, 3개월을 90일 리포트로 열었다("리포트 엔진은 어제까지 30/90/365일만 지원"). 화면에는 "선택 기간과 기준이 달라요"만 표시 |
| 2 | 리포트 페이지 `parsePeriodParam()` | `?period=`를 30/90/365만 받고 **그 외는 조용히 30**으로 바꿨다. Production 실측: `/report/city/busan?period=7d`가 "최근 30일" 1,998건을 렌더 |
| 3 | 공유(`ReportActions`) | 공유 링크가 canonical 경로(`?period=` 없음)라 90일·365일 브리핑을 보내도 **받는 사람은 기본 30일**을 봤다. PNG 파일명에도 기간이 없어 같은 날 저장한 파일이 겹쳤다 |

PNG는 화면의 시트(`data-export-root`)를 DOM 캡처하고, PDF는 같은 페이지를 `window.print()`한다 — 둘 다 **페이지가 렌더한 기간**을 따른다. 그래서 #1·#2를 고치면 이미지/PDF가 따라오고, #3은 공유 경로를 따로 고친다.

리포트 읽기 계층(`readRegionReport`)은 이미 임의의 `start/end`를 받고 직전 동일 기간도 그 범위에서 계산하므로 **엔진 재설계는 필요 없었다**.

## 2. 기간 정의 (단일 계산기)

통계 화면과 리포트가 모두 `resolveVolumePeriod()`(KST 계약일, 오늘 포함)를 쓴다.

| 키 | 라벨 | 범위 (2026-09-19 KST 기준) | 직전 동일 기간 | 비교 표시 |
|---|---|---|---|---|
| `today` | 오늘 | 09-19 | — | 없음(하루 단위, 기존 정책) |
| `yesterday` | 어제 | 09-18 | — | 없음 |
| `7d` | 최근 7일 | 09-13 ~ 09-19 | 09-06 ~ 09-12 | 있음 |
| **`15d`** | **최근 15일** | **09-05 ~ 09-19** | **08-21 ~ 09-04** | 있음 |
| `30d` | 최근 30일 | 08-21 ~ 09-19 | 07-22 ~ 08-20 | 있음 |
| `3m` | 최근 3개월 | 06-19 ~ 09-19 (달력 3개월, 기존 정의) | 같은 일수 직전 | 있음 |

- 직전 기간: 같은 일수, 시작 전날에 끝남. 리포트(`reportPreviousRange`)와 화면(`previousPeriodRange`)이 같은 결과임을 테스트로 고정.
- 하루 단위 비교 정책(신고 시차 때문에 전일 대비 미표시)은 리포트에도 똑같이 적용 — 오늘/어제 브리핑에는 "직전 동일기간 대비" KPI와 증감 해석문이 없다.
- 15일은 신고 시차 안내 대상(7일과 같이, 30일 신고 기한보다 짧음).

### 리포트 기간 키

| `?period=` | 의미 |
|---|---|
| 없음 / `30` | **기존 기본값 그대로** — 어제까지 30일 (SEO 설명·canonical 페이지가 쓰는 값, 변경 없음) |
| `90` · `365` | 기존 그대로 |
| `today` `yesterday` `7d` `15d` `30d` `3m` | 통계 화면과 같은 범위 |
| 그 외 | 기본값(`30`) |

`30d`(오늘까지 30일)와 `30`(어제까지 30일)은 다른 기간이다. 통계에서 온 링크는 항상 통계 키(`30d`)를 쓰므로 화면 값과 브리핑 값이 같은 범위다.

## 3. 변경

| 영역 | 변경 |
|---|---|
| `lib/stats/volume-period.ts` | `15d` 추가 · `briefingPeriodFor()`가 선택 키를 그대로 반환(`periodKey`) + "최근 7일 · 2026.09.13 ~ 2026.09.19 기준" · `volumePeriodRangeText()` |
| `VolumeChartCard` | 브리핑 링크 `?period=<선택 키>` · "선택 기간과 기준이 달라요" 제거 |
| `lib/report/report-period.ts` | `parseReportPeriodKey` · `resolveReportPeriod` · `reportPreviousRange` (기존 `resolvePeriod`/`parsePeriodParam` 유지) |
| `region-read-cached` · 리포트 3페이지 | 일수 대신 기간 키. 메타데이터는 계속 기본 기간(`?period=` 무시) |
| `region-read` / `types` | envelope.period에 `key`·`singleDay`·`isDefault` |
| `region-report` | 하루 단위면 직전 대비 KPI·해석 생략 · 라벨 `매매 중앙가격` / `㎡당 매매 중앙가격`(계산 불변) |
| `RegionReportSheet` | 헤더에 기간 라벨 + 날짜 범위 태그(이미지·PDF 안에 남음) · 중앙값 카드 설명 "가격순 가운데 값 · 평균과 다름" |
| `export-identity` / `ReportActions` | 공유 링크에 기본이 아닌 기간 `?period=` · 파일명에 기간 키(`e-jip-busan-7d-2026-09-19.png`). 기본 기간은 예전 그대로 |
| API | dashboard 요약에 `15d`(캐시 키 v4) · concentration/feed가 `15d` 허용(예전이면 30d/7d로 바뀜) |
| 화면 칩 | 거래 많은 단지·실거래 피드에 `최근 15일` |

툴팁 대신 카드 안 한 줄 설명을 택했다 — 툴팁은 PNG/PDF에 남지 않는다. SEO 메타 설명의 "중앙 거래가" 문구는 SEO 범위 변경 금지라 그대로 두었다(FOLLOW_UP).

## 4. 캐시

- dashboard: KST 날짜 키에 **모든 기간 요약을 한 번에** 계산 — 응답 모양이 바뀌어 `v3 → v4`.
- concentration: 캐시 키에 조회 범위(from/to)가 이미 들어 있다 — 7d/15d/30d 분리.
- feed: 월 단위 원천 캐시 후 **기간으로 다시 거른다** — 공유해도 결과가 섞이지 않는다.
- 리포트: 요청 단위 React `cache`(인자 = 기간 키). 교차 요청 캐시 없음.

## 5. 테스트

`src/lib/report/period-parity.test.ts` 13개 + 기존 `volume-period.test.ts` 갱신.

| 요구 | 확인 |
|---|---|
| 1~6 | 6개 기간 모두 리포트 범위 = 화면 범위(날짜 고정값 포함) |
| 7~9 | 7·15·30일 직전 기간(15일: 09-05~19 ↔ 08-21~09-04), 6개 기간 전부 화면 정의와 동일, 읽기 계층이 그 함수를 씀 |
| 10 | KST 00:30(UTC 전날)에도 오늘·7일·15일 밀림 없음 |
| 11·21 | `15d` 그대로, 30/90/365 그대로, 모르는 값만 기본 · 기본 기간은 기존 `resolvePeriod(30)`과 완전히 동일 |
| 12·13 | 카드 링크가 선택 키를 싣고 `periodDays` 치환 없음 · 3페이지가 키 파서 사용 |
| 14~16 | 파일명 기간 키 · 공유 URL `?period=15d` · 기본 기간 URL/파일명 불변 · PDF는 같은 페이지 인쇄 |
| 17~19 | 한 기간의 행이 요약·단지·분포·최근 실거래를 만든다(분포 합 = 거래건수, 최근 실거래 전부 기간 안) · 하루 단위 비교 없음 |
| 20 | 캐시 키 분리 |
| 22 | 6개 칩, 가로 스크롤 한 줄 |

기존 계약 테스트 2개는 이름이 바뀐 식별자만 갱신(`DEFAULT_REPORT_PERIOD_KEY`, feed 기간 목록에 `15d`) — 보호하던 의미(메타데이터는 기본 기간, 기존 옵션 유지)는 그대로.

```
npx tsx --test src/lib/report/period-parity.test.ts          pass 13  fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"       pass 2266 fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"     pass 154  fail 0
npx eslint (변경·신규 23개 파일)                               exit 0
npx tsc --noEmit                                            src/ 오류 0 · 기존 25건 scripts/ 21 + tmp/ 4 → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                               Compiled successfully
```

## 6. 알려진 제한

- 기본 리포트(`?period` 없음/`30`)의 "어제까지"는 기존 코드대로 UTC 날짜로 계산된다 — 한국 00:00~08:59에는 이틀 전까지가 된다. 30일 기본 동작 보존 지시에 따라 바꾸지 않았다(FOLLOW_UP).
- 오늘/당월이 포함된 기간은 당월 수집 셀이 아직 검증 전이라 브리핑 완전성이 "검증 중"으로 표시된다(숨기지 않음, 기존 규칙).
- SEO 메타 설명 문구 "중앙 거래가"는 그대로(SEO 범위 밖).
- 실거래 피드에는 3개월 기간이 없어(기존) 3개월 선택 시 "목록 보기" 링크를 만들지 않는다.

## 7. Production QA

배포 후 기록.
