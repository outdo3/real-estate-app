# E-JIP TOP COMPLEX AGGREGATION FIX V1

통계 화면의 "거래 많은 단지"가 금액·계약일·층·면적이 같은 **서로 다른 실제 거래**를 1건으로 접던 문제를 고친다. 화면을 한장 브리핑과 같은 규칙(원천 유효 기록 하나 = 한 건)으로 맞춘다.

- 날짜: 2026-09-19 (KST)
- 기준 커밋: `5550d91` (감사: `TOP_COMPLEX_AGGREGATION_TRUST_AUDIT_V1`)
- 범위: 집계 규칙만. **DB write 0 · schema 0 · 취소 repair 0 · 결함 B 처리 0 · 기간 의미 변경 0.**

---

## 1. 이전 의미 (화면)

```
DB 행(계약일, id 순) → dedupeTrades: (단지·면적·유형 + 금액·계약일·층)이 같으면 첫 행만 → 취소 제외 → 단지별 개수
```

- 원천에 실재하는 같은 조건의 다른 세대 거래를 지웠다 — 대운스카이뷰1차 30일: 원천 46 · DB 46 · 브리핑 46 · **화면 16**.
- 합칠 때 취소 여부를 보지 않아, 남은 첫 행이 취소면 유효 거래까지 0이 됐다(30일 1그룹, 3개월 8그룹).

## 2. 원천 진실과 새 규칙

감사: 30일·3개월 부산 전 셀을 원천과 대조 — DB 행 ↔ 원천 기록 1:1(ingest 중복 0), 4필드는 거래 identity가 아님.

**새 규칙 = 유효(취소 아님) DB 행 하나 = 한 건.** 취소를 **먼저** 빼고 단지(aptSeq, 없으면 이름+동)별로 센다. 금액·날짜·층·면적·같은 날·같은 가격 어떤 기준으로도 접지 않는다.

## 3. 공용 helper

`src/lib/stats/complex-trade-count.ts` — 순수 함수(DB 접근 없음)

| 함수 | 쓰는 곳 |
|---|---|
| `groupValidTradesByComplex(rows, complexKeyOf, isCanceled)` | 화면 `buildConcentrationRanking`(현재 기간) · 브리핑 `representativeComplexes` |
| `countValidTradesByComplex(...)` | 화면 직전 기간 개수 |

정렬·동률 규칙은 각 경로 기존 그대로(화면: 건수 → 입력 순서 / 브리핑: 건수 → 최근 계약일 → 이름).

## 4. 경로별 변경

| 경로 | 변경 |
|---|---|
| `/api/stats/concentration` (거래 많은 단지 · 거래량 카드 상위 5) | `dedupeTrades` → **`dedupeByRecord`**(같은 원천 기록=같은 `uid`만 하나로). DB 캐시 키 `v1 → v2` |
| `buildConcentrationRanking` | 공용 helper로 취소 먼저 제외 후 집계 |
| 브리핑 `representativeComplexes` | 공용 helper 사용. **결과 동일**(키·첫 행·최근일·순서 같음) |
| `/api/stats/feed` (실거래 피드) | `dedupeTrades` → `dedupeByRecord`. 시도 캐시 키 `v2 → v3` |
| 전월세 DB 읽기 | `occurrence_index`를 함께 읽어 uid에 포함 — 같은 조건 다른 전월세 기록이 같은 uid가 되지 않게(자연키와 같은 구분) |
| `dedupeTrades` | 유지. 가격 순위(price-rankings)의 기존 호출은 범위 밖이라 그대로 |

### 실거래 피드 감사 (§7)

피드의 내용 dedupe 주석 근거는 "달 겹침으로 같은 거래를 두 번 받는 경우"였다. 현재 모든 경로에서 **월 목록은 요청당 중복이 없고**, DB 행은 id가 고유, MOLIT 행은 응답 내 순번 uid라 그 상황이 생기지 않는다 — 실제로 한 일은 원천 기록을 지우는 것뿐이었다(대운 30건, 취소+재신고의 유효 행). 그래서 피드도 기록 단위로 바꿨다. 같은 원천 기록이 두 번 들어오는 경우(같은 uid)는 계속 하나로 남긴다. 취소 기록은 예전처럼 "취소" 배지로 보이고, 같은 조건으로 재신고된 유효 기록도 이제 함께 보인다(원천에 둘 다 있다).

## 5. 테스트

`src/lib/stats/complex-trade-count.test.ts` 9개 — 화면 DB 경로와 같은 변환(`storedSaleToFeedRaw → toFeedTrade → dedupeByRecord → buildConcentrationRanking`)으로 검증하고, **수정 전 파이프라인(`dedupeTrades`)이 16과 0을 내는 것도 함께 재현**한다.

| # | 확인 |
|---|---|
| 1 | 대운 구성(2층 1 + 3~17층 층당 3) → 화면 46 · 브리핑 46 · 수정 전 화면 16 |
| 2 | 같은 조건 유효 3건 → 3 |
| 3·4·5 | 유효+취소 → 1(취소가 먼저여도, 수정 전 0) · 유효+유효 → 2 · 순서 무관 |
| 6~9 | 7/15/30일·3개월 모두 "기간 안 유효 기록 수", 라우트에 기간별 분기 없음 |
| 10 | 무작위 400행 — 화면 개수 = 브리핑 개수(단지별 완전 일치), 두 경로가 공용 함수 사용 |
| 11·12 | 정렬·동률 규칙 각 경로 기존 그대로 |
| 13 | 단지 합계 = 요약 거래건수 기준(유효 행 수) |
| 14·15 | 취소로 저장된 행(false-cancel 포함)은 여전히 0 · 집계 모듈은 DB 접근 없음 |
| 16 | 피드 기록 단위 · 취소+유효 형제 둘 다 · 같은 uid만 접힘 · 전월세 순번 uid |

기존 계약 테스트 3개 갱신: `feed-db-source`(DB 행이 내용으로 접히던 의미를 기록 단위로, 캐시 v3), `complex-row-labels`(키·정렬·개수 의미는 그대로, 공용 함수 호출로 표현), `period-parity`(concentration 캐시 v2).

```
npx tsx --test src/lib/stats/complex-trade-count.test.ts   pass 9    fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"      pass 2275 fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"    pass 154  fail 0
npx eslint (변경 13개 파일)                                  exit 0
npx tsc --noEmit                                           src/ 오류 0 · 기존 25건 scripts/ 21 + tmp/ 4 → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                              Compiled successfully
```

## 6. 알려진 데이터 결함 (이번 STEP에서 손대지 않음)

- **false-cancel 28행**: 원천 1/2 ↔ DB 2/2 취소. 화면·브리핑 모두 해당 거래를 0으로 센다(30일 12건, 3개월 21건). 집계 회귀가 아니다 — 승인 대기 중인 repair로 해소.
- **결함 B**: 원천이 회수한 행이 DB에 남아 두 경로 모두 과대(30일 3건, 3개월 5건).

## 7. Production QA

배포 후 기록.
