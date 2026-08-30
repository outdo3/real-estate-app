# TRADE CANCELLATION AUDIT V1 — 실거래 취소·해제 검증

## 1. Goal

`TRADE_HISTORY_DATA_V1`(부산 855,045 rows backfill)에서 취소/해제 거래가 0건으로 관측됐다. 이 결과를 그대로 신뢰하지 않고, MOLIT 원문 → parser → normalize → write → DB의 전체 경로를 실측으로 추적해 0건의 원인을 증명하고, 향후 모든 통계가 따를 valid trade contract를 확정한다.

## 2. Why Cancellation Matters

신고가/역대 최고가/하락률/거래량/84㎡ 순위/지역 변동지도 등은 모두 "실제 성사된 거래"를 전제로 계산된다. 계약이 해제된 거래가 통계에 계속 포함되면, 이미 취소된 10억 거래가 신고가로 계속 남는 식의 왜곡이 생긴다.

## 3. Current 855,045-row Observation

- DB(`apartment_trade_histories`) 실측: `dealCanceled = true` 행 **0건 / 855,045건**.
- backfill 당시 생성된 manifest(`data/trade-history/busan-manifest.json`, 3,968 region-month 항목) 자체도 매 fetch 시점에 계산한 `canceled` 필드 합계가 **0**이었다 — 즉 DB write 이후가 아니라 **parse 시점부터** 이미 0이었다.
- `cancelDate`가 채워져 있는데 `dealCanceled=false`인 mismatch 행도 0건 — 하나의 동일한 원인으로 두 필드 모두 항상 비어 있었다는 뜻(부분 실패가 아님).

## 4. Source Endpoint

- `RTMSDataSvcAptTradeDev`(국토교통부 아파트 매매 실거래 상세) — `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev`
- params: `serviceKey`, `LAWD_CD`(5자리), `DEAL_YMD`(YYYYMM), `numOfRows=1000`
- `src/lib/api-molit.ts`의 `fetchMolitData()`가 유일한 호출 지점(backfill/sync 모두 이 함수를 통해서만 조회).

## 5. Raw Cancellation Fields (실측)

기존 코드/문서(`TRADE_HISTORY_DATA_V1.md` §4)는 한글 필드명을 가정했다:

| 가정했던 필드 | 실제 live 응답 필드 | 확인 방법 |
|---|---|---|
| `해제여부` | **`cdealType`** | XML 원문 직접 파싱, 필드명 나열로 확인 |
| `해제사유발생일` | **`cdealDay`** | 동일 |
| `등기일자` | **`rgstDate`** | 동일 |

2026-08-30 실측 — 부산 3개구(해운대구/부산진구/동래구) × 최근 12개월, 13,716건 raw item 스캔 결과 전체 필드명:

```
aptDong, aptNm, aptSeq, bonbun, bubun, buildYear, buyerGbn, cdealDay, cdealType,
dealAmount, dealDay, dealMonth, dealYear, dealingGbn, estateAgentSggNm, excluUseAr,
floor, jibun, landCd, landLeaseholdGbn, rgstDate, roadNm, roadNmBonbun, roadNmBubun,
roadNmCd, roadNmSeq, roadNmSggCd, roadNmbCd, sggCd, slerGbn, umdCd, umdNm
```

`해제여부`/`해제사유발생일`/`등기일자`(한글 키)는 **응답에 존재하지 않는다**. `item.해제여부`는 항상 `undefined` → `''` → `dealCanceled = ('' === 'O') = false`가 모든 row에서 반복됐다.

## 6. Cancellation Semantics (실측, §8 구조 확정)

- `cdealType`: 값 분포 = `{ "(empty)": 12930, "O": 786 }` — 이진 flag, 취소 시 정확히 `'O'`.
- `cdealDay`: 취소 발생일. 관측 포맷은 **`YY.MM.DD`**(예: `"26.08.04"`) — 기존 모델 주석이 가정한 `YYYYMMDD`와 다르다. DB는 이 값을 파싱 없이 원본 그대로 문자열 저장하므로 저장 자체에는 영향 없지만, 향후 이 값을 소비하는 코드는 포맷을 가정하면 안 된다(주석 정정 완료, `src/lib/api-molit.ts`).
- **구조 확정**: MOLIT는 원 거래의 자연키(단지+금액+일자+층+면적)를 그대로 유지한 채 `cdealType`/`cdealDay`만 채워 재제공한다(§8 구조 A/C에 해당) — 그러나 실측 결과 **완전히 동일한 자연키를 가진 두 row(취소 전 원본 + 취소 후 사본)가 같은 fetch 응답 안에 동시에 존재하는 경우도 다수 관측됐다**(§8 구조 D, 아래 §9 참고). 별도 "취소 전용 endpoint"나 별도 스키마 구조는 없다 — 같은 매매 상세 조회 응답 안에 포함된다.

## 7. Real Samples

부산 3개구 × 최근 12개월 스캔에서 취소 샘플 **786건** 확보(요구 최소 3건 초과 충족). 대표 샘플(개인정보 없음 — 단지명/동/지번/면적/가격/층/취소일만 기록, 매수·매도자는 "개인"/"법인" 구분값만 존재하고 실명은 API에 없음):

| 지역 | 단지 | 동 | 지번 | 전용면적 | 원거래일 | 금액(만원) | 층 | cdealType | cdealDay |
|---|---|---|---|---|---|---|---|---|---|
| 해운대구(26350) | 센텀KCC스위첸(26350-2580) | 반여동 | 1691 | 84.61 | 2026-07-13 | 65,000 | 13 | O | 26.08.04 |
| 해운대구(26350) | 삼정코아(26350-190) | 좌동 | 1315 | 59.9389 | 2026-07-31 | 28,500 | 3 | O | 26.08.20 |
| 해운대구(26350) | 동신(26350-119) | 좌동 | 1302 | 101.73 | 2026-07-23 | 61,000 | 16 | O | 26.08.04 |

전체 요약은 `data/trade-history/cancellation-audit-live-samples.json`에 저장(대표 15건 + 월별 분포 + 전체 786건 집계, 레포 용량을 위해 전량은 보존하지 않음 — 재현 가능한 조회 파라미터는 본 문서에 기록됨).

## 8. Parser Trace

`src/lib/api-molit.ts` — `fetchMolitData()` 내부 `.map()`:

```
Before: const dealCanceled = (item.해제여부 || '').toString().trim() === 'O';   // 항상 undefined → false
        const cancelDate   = (item.해제사유발생일 || '').toString().trim();     // 항상 undefined → ''
After:  parseCancellationFields(item) — 한글 필드명 + 실제 영문 필드명(cdealType/cdealDay/rgstDate) 둘 다 매칭
```

**여기가 유일한 원인 지점이다.** raw XML에는 취소 정보가 정확히 존재하지만(§5/§7), 이 한 줄의 필드명 불일치 때문에 이후 모든 단계(normalize/write/DB)에 도달하기 전에 이미 소실됐다.

## 9. Write Trace

`scripts/trade-history-logic.ts`의 `normalizeMolitItemsToTradeRows()`는 `item.dealCanceled`/`item.cancelDate`를 가공 없이 그대로 `TradeRowInput.dealCanceled`/`cancelDate`에 전달한다 — 이 단계는 정상(버그 없음). `scripts/backfill-trade-history.ts`의 `upsertRows()`도 `row.dealCanceled`/`row.cancelDate`를 Prisma `create`/`update` 양쪽에 1:1로 매핑한다 — 이 단계도 정상. **즉 parser가 올바른 값을 넘겨줬다면 write까지는 아무 문제 없이 도달했을 것.**

## 10. Dedup/Upsert Trace

자연키(`groupKeyStr + dealAmount + dealDate + floor + occurrenceIndex`)에 취소 여부는 포함되지 않는다(설계상 의도적, §45 기존 테스트로 이미 검증됨) — 취소 전/후가 같은 canonical row를 가리켜야 한다는 원칙은 올바르다.

**실측으로 새로 발견한 사실(§6 후반부)**: 같은 fetch 배치 안에 완전히 동일한 자연키(단지+금액+일자+층+면적)를 가진 두 row(취소 전 원본 cdealType='', 취소 후 사본 cdealType='O')가 **함께** 존재하는 경우가 다수 관측됐다(예: 해운대구 202607 — 9건의 취소 중 8건이 이 패턴, 부산진구 202608 — 3건 중 0건, 동래구 202509 — 26건 중 19건. 비율은 지역/월마다 다름, 원인은 MOLIT 측 내부 갱신 타이밍으로 추정되나 외부에서 완전히 증명 불가능).

`normalizeMolitItemsToTradeRows()`의 `occurrenceIndex`는 배열 등장 순서로 부여되므로, 이 두 row는 **서로 다른 occurrenceIndex(0, 1)를 받아 별개의 DB row로 upsert된다** — 병합되지 않는다. 이것이 문제가 되는지 확인한 결과: **문제가 되지 않는다.** `src/lib/trade-history-read.ts`의 모든 valid-trade 조회 함수(`getTradeHistory`/`getAllTimeHigh`/`getPreviousTrade`)가 이미 `dealCanceled: false`를 조회 조건에 포함하고 있어(§16 참고), 취소된 사본 row는 자동으로 제외되고 원본(active) row만 유효 거래 1건으로 집계된다. 별도 병합 로직은 불필요 — 오히려 두 row가 서로 다른 실제 거래일 가능성(같은 단지에 동일 스펙 매물이 우연히 같은 날 같은 가격에 거래)을 배제할 수 없으므로, 임의로 병합하는 것이 더 위험하다.

## 11. Root Cause

**A. PARSER_BUG — 확정.** `src/lib/api-molit.ts`가 raw MOLIT 응답의 실제 필드명(`cdealType`/`cdealDay`/`rgstDate`)이 아니라 문서상 가정이었던 한글 필드명(`해제여부`/`해제사유발생일`/`등기일자`)만 확인했다. 해당 한글 필드는 이 endpoint의 실제 응답에 존재하지 않아 항상 매칭 실패 → `dealCanceled`가 100% `false`로 고정됐다.

Write/Dedup 단계는 모두 정상(§9/§10) — parser 한 곳의 단일 원인이다.

## 12. Existing DB Impact

- **영향받음, 확정.** 855,045 rows 전체가 parser bug 기간 동안 backfill되어 `dealCanceled`가 항상 `false`로 저장됐다. 실제 취소 여부를 신뢰할 수 없다.
- **일반화 금지**: 실측 취소 비율(786/13,716 = 5.73%)은 최근 12개월·거래량 많은 3개구 샘플이며, 취소는 원 거래 이후 시간이 지날수록 누적 관측되는 경향이 뚜렷하다(§15 참고) — 이 비율을 20년 전체/부산 전역에 그대로 곱해 "약 49,000건"식으로 추정하는 것은 금지 지침 위반이다. 실제 영향 규모는 재동기화 후에만 확정 가능하다.
- Production write는 이번 STEP에서 수행하지 않았다(§13 STOP 조건에 해당, 아래 §14 참고).

## 13. Valid Trade Contract

```
valid trade =
  dealType = 'sale'
  AND dealCanceled = false
```

- 이미 `src/lib/trade-history-read.ts`의 `getTradeHistory()` / `getAllTimeHigh()` / `getPreviousTrade()`가 이 규칙을 구현하고 있다(코드 변경 없음, 기존 설계가 처음부터 올바랐다 — parser bug 때문에 실제로 걸러낼 데이터가 없었을 뿐).
- `getRegionalTrades()`는 의도적으로 취소 포함 전체를 반환한다(기존 주석: "취소 포함 — 호출부가 필요시 필터링") — 호출부가 아직 없으므로(§DB-FIRST READ PATH 전환 전) 이번 STEP에서 바꾸지 않는다.
- 새 abstraction(`validTradeWhere()`/`isValidTrade()`)은 만들지 않는다 — 기존 3개 함수의 `dealCanceled: false` 인라인 조건으로 이미 목적을 달성하고 있고, 이걸 넘어서는 소비처가 아직 없다(§11 지침: 과한 abstraction 금지, 문서 contract만 확정).
- future/malformed price/malformed identity 등 다른 무효 사유는 이미 `classifyInvalid()`(backfill 단계)에서 걸러지고 있다(`MISSING_AMOUNT`/`MISSING_AREA`/`MISSING_DATE`/`MISSING_IDENTITY`/`MISSING_FLOOR`) — 이번 STEP에서 추가 변경 없음.

## 14. Record-High Implication

`getAllTimeHigh()`는 이미 `dealCanceled: false` 필터가 있으므로 로직 자체는 안전하다. 그러나 §12의 이유로 **기존 DB 데이터의 취소 마킹을 신뢰할 수 없는 상태**이므로, 재동기화 전까지는 "역대 신고가"/"역대 최고가" 자동 전환을 하지 않는다(기존 24개월 lookback 안전장치 유지, `HISTORICAL_LOOKBACK_MONTHS`는 이번 STEP에서 건드리지 않음).

## 15. Resync Policy (설계만, 배포는 범위 밖)

- **최근월 우선 정책**: §7 월별 취소 분포(아래 §17 참고)를 보면 원 거래월로부터 시간이 지날수록 취소 누적 건수가 늘어나는 경향이 뚜렷하다(예: 12개월 전 월 100건 vs 1개월 전 월 21건) — 즉 취소는 계약 후 수개월에 걸쳐 서서히 반영된다.
- 제안 기본 정책: **현재월 + 직전 12개월**을 매 sync 주기마다 재조회(원 사용자 제안의 "현재월+3개월"보다 넓게 — 실측 데이터가 3개월 이후에도 취소가 계속 누적됨을 보여주므로).
- 그 이전(12개월 초과) 과거 데이터는 parser bug로 인해 취소 마킹이 전부 유실됐을 가능성이 있으나, 원 계약 이후 충분한 시간이 지나 취소 반영이 대부분 안정화됐을 것으로 추정된다(증명은 못함 — MOLIT 공식 문서에 취소 반영 시차의 상한이 명시돼 있지 않음).
- 배포(cron 등)는 이번 STEP 범위 밖. 실행 방식만 제안: 기존 `backfill-trade-history.ts`를 `--lawdCd`(부산 16개구) + `--from=<현재월-12>` + `--to=<현재월>` + `--apply`로 재실행하면 기존 upsert 로직이 그대로 재사용된다(자연키 매치 시 update 경로로 `dealCanceled`/`cancelDate`/`registryDate`만 갱신).

## 16. Tests

`src/lib/api-molit.test.mjs`(신규, 6 tests) — `parseCancellationFields()` 단위 테스트:
1. live 영문 필드명(`cdealType=O`) 인식
2. `cdealType` 빈 문자열 → 정상
3. `cdealType` 필드 자체 없음 → 정상
4. 한글 필드명(`해제여부`) 하위 호환 인식
5. `cdealType`이 `'O'` 아닌 다른 값 → 취소 아님
6. 공백 오염된 값 trim 처리

`scripts/trade-history-logic.test.mjs`(기존 15 + 신규 1 = 16 tests) — 신규: 같은 배치에 취소 전/후 중복 row가 와도 서로 다른 occurrenceIndex로 둘 다 보존되고, valid trade 필터 적용 시 정확히 1건만 남는지 검증.

전체 21/21 pass.

## 17. Live QA

3건 이상 실측 확인(§7 표):

| RAW_CANCELLED | NORMALIZED_CANCELLED | PERSISTENCE_CONTRACT | VALID_TRADE |
|---|---|---|---|
| YES(cdealType='O') | YES(parser 수정 후, 실측 확인) | CORRECT(write/upsert 로직 자체는 원래 정상이었음) | FALSE(정상 제외 확인) |

기존 DB row(855,045건 중 이 786건 스캔 표본에 대응하는 원본 데이터)는 이미 `dealCanceled=false`로 잘못 저장돼 있는 상태를 그대로 재확인만 하고, **임의로 수정하지 않았다**(§13 지침 준수).

## 18. Quota Usage

- 목록 조회(REGCODE): 1회(캐시됨, sido=26)
- 실측 스캔: 해운대구/부산진구/동래구 × 최근 12개월 = 36회(field name 발견용) + 36회(cdealType 기준 재확인 + fixture 저장용) + 3회(중복 row 패턴 확인) + 1회(단건 재검증) = **총 76회**
- 20년 전체 재조회 없음, 반복 QA는 저장된 fixture(`data/trade-history/cancellation-audit-live-samples.json`) 활용.
- quota warning 없이 완료.

## 19. Known Limitations

- 취소 반영 시차의 공식 상한을 MOLIT 문서에서 확인하지 못했다 — §15 리싱크 정책의 "12개월"은 실측 분포 기반 추정치이지 공식 보장값이 아니다.
- 같은 자연키를 가진 취소 전/후 중복 row가 왜 어떤 경우엔 나타나고 어떤 경우엔 안 나타나는지(지역/월마다 0%~89% 편차)는 MOLIT 내부 동작이라 외부에서 완전히 규명 불가능 — 다만 §10에서 설명했듯 valid trade contract 하에서는 결과에 영향 없음.
- `cdealDay` 포맷(`YY.MM.DD`)이 향후 다른 값 형태(`YYYY.MM.DD` 등)로 바뀔 가능성은 배제할 수 없음 — 현재 코드는 파싱 없이 원본 그대로 저장하므로 포맷 변경에 영향받지 않는다.
- 기존 855,045 rows의 실제 취소 건수는 재동기화 전까지 알 수 없음(§12 일반화 금지 원칙).

## 20. Next Step

`RESYNC_REQUIRED` — §15 정책에 따라 부산 16개구 × 최근 12개월 재동기화(`--apply`) 실행 승인 필요. Production write이므로 이번 세션에서 실행하지 않고 승인 대기.
