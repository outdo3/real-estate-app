# RECORD HIGH TRUST V2 — CAPPED CELL RECOVERY APPLY

- 상태: **APPLY 완료 / 검증 통과**
- 실행일: 2026-09-03
- 승인 범위: `apartment_trade_histories` INSERT 최대 8,446행, 검증된 23개 셀 한정
- 실제 결과: **INSERT 8,446 / UPDATE 0 / DELETE 0**
- 실행 환경: controlled local CLI (Vercel Lambda 미사용)
- 스크립트: `scripts/record-high-trust/capped-cell-recovery-apply.ts`

---

## 1. 안전 게이트

write 직전에 source를 다시 읽어 DRY-RUN과 동일한 검증을 전부 수행하고, 하나라도
어긋나면 **아무것도 쓰지 않고 종료**하도록 설계했다(전부-또는-전무).

| 게이트 | 기대 | 실측 | 판정 |
| --- | ---: | ---: | --- |
| 23셀 DB rows | 23,000 | 23,000 | PASS |
| 23셀 source rows | 31,446 | 31,446 | PASS |
| insert candidates | 8,446 | 8,446 | PASS |
| canceled-at-source | 629 | 629 | PASS |
| problems (conflict/ambiguous/dupe/identity) | 0 | 0 | PASS |
| 승인 상한 초과 | 없음 | 없음 | PASS |

`APPROVED_MAX_INSERTS = 8446` 하드코딩 상한을 코드에 두어 초과 시 `exit(2)`로 STOP한다.

## 2. APPLY 결과

`createMany({ skipDuplicates: true })`, 500행 청크. **UPDATE/DELETE 호출은 스크립트에 존재하지 않는다.**

셀별 `inserted == candidates` 23/23 일치. 총 **8,446행 INSERT**.

## 3. POST-APPLY 전수 검증

23/23 셀에서 `DB row count == source totalCount` **PASS**.

| 검증 항목 | 결과 |
| --- | --- |
| 23셀 DB rows | 23,000 → **31,446** |
| 테이블 전체 rows | 855,556 → **864,002** |
| **attributable delta** | **정확히 +8,446** |
| 정확히 1000행인 셀 (23셀 내) | **0** |
| 정확히 1000행인 셀 (테이블 전체) | **0** — cap 문제 완전 해소 |
| natural-key duplicate group | **0** |
| occurrenceIndex 불연속 bucket | **0** |

## 4. INSERT QUALITY

| 항목 | 결과 |
| --- | ---: |
| inserted rows | 8,446 |
| aptSeq NULL | **0** |
| name-only fallback (`identity_key NOT LIKE 'id:%'`) | **0** |
| lawdCd / dealYmd 불일치 | **0** |
| dealType != sale | **0** |
| source != MOLIT_APT_TRADE | **0** |
| canceled-at-source | **629** (DRY-RUN 예상과 정확히 일치) |
| dealDate 범위 | 2006-11-01 ~ 2020-11-23 |

### 전 필드 원천 대조 (count가 아니라 값 자체)

대표 3개 셀(26350/202010, 26320/200611, 26230/202011)에 대해 **모든 행을 전 필드
대조**했다. `aptName / dong / jibun / exclusiveArea / buildYear / aptSeq` 불일치 **0건**.

## 5. 멱등성

동일 복구를 다시 DRY-RUN으로 실행:

| 항목 | 결과 |
| --- | ---: |
| DB rows in 23 cells | 31,446 |
| source rows | 31,446 |
| **would insert** | **0** |
| **would update** | **0** |
| conflict | 0 |
| ambiguous | 0 |
| duplicate candidate | 0 |
| exact natural-key match | **31,446 (전량)** |

두 번째 write run은 불필요하므로 실행하지 않았다.

## 6. 발견 — 기존 행 981건의 stale cancellation (이번 승인 범위 밖)

전 필드 대조 과정에서 **이번 INSERT와 무관한 기존 문제**를 발견해 정확히 측정했다.

23셀 전체를 원천과 대조한 결과:

| 항목 | 건수 |
| --- | ---: |
| **기존 행** 중 DB=false / source=true (stale) | **981** |
| **신규 삽입 행** 중 stale | **0** |
| DB=true / source=false (역방향) | **0** |
| name/dong/area 등 기타 필드 불일치 | **0** |

구간별로 A구간 12셀은 전부 0건이고, **981건은 전량 B구간 11셀(2020-06~11)**에 있다.
이는 V1 감사의 결론과 정확히 일치한다 — 2020-02 이후만 원천이 취소를 제공하고,
이 셀들은 2024-09~2026-08 범위였던 24개월 취소 resync 대상이 아니었다.

**중요한 구분:**
- 이 981건은 **이번 apply가 만든 문제가 아니다.** apply 이전부터 존재했고, apply는
  이를 악화시키지 않았다(신규 행 stale 0건).
- 오히려 이번 apply는 같은 셀에 **취소 상태가 정확한 행 629건**을 새로 넣었다.
- 다만 그 결과 같은 셀 안에서 신규 행은 취소가 정확하고 기존 행은 낡은 상태가 되는
  **혼재 상태**가 되었다. 이는 승인 범위상 의도된 것이며(§0에서 cancellation resync는
  명시적으로 승인되지 않음), 다음 STEP에서 해소해야 한다.

참고로 이 11셀의 실측 취소율은 (981 + 629) / 16,598 ≈ **9.7%**로, V1이 추정에 쓴
4.26~6.95%보다 높다. 다만 이 셀들은 2020년 급등기의 최대 셀이라 취소율이 높은 쪽으로
편향된 표본이므로, B구간 880셀 전체 추정치를 이 값으로 바꾸는 것은 근거가 약하다.
**옵션 D의 예상 flip 규모는 기존 7,000~12,000보다 클 수 있다** 정도로만 갱신한다.

## 7. LIVE REGRESSION (Production 실측)

`https://real-estate-app-phi-taupe.vercel.app` (icn1)

| 경로 | 결과 |
| --- | --- |
| `/` | HTTP 200 |
| `/ai-search` | HTTP 200 |
| `/map` | HTTP 200 |
| `/apt/해운대힐스테이트위브` | HTTP 200 |
| `/stats` | HTTP 200 |
| `/stats/record-high` | HTTP 200 |
| `/stats/compare` | HTTP 200 |
| `/api/transactions?type=apt&lawdCd=26350&months=12` | HTTP 200 (1.95MB) |
| `/api/stats/dashboard?lawdCd=26350` | HTTP 200, `success:true` |
| `/api/stats/price-rankings` record-high / decline / rising / area84 | HTTP 200, `status:OK` |
| `/api/search?q=해운대` | HTTP 200, 실데이터 반환 |

## 8. ROLLING 24-MONTH RECORD-HIGH 회귀 — 불변 확인

두 층위로 확인했다.

1. **구조적 증거**: 신규 8,446행 중 `deal_date >= CURRENT_DATE - 24 months`인 행 **0건**.
   record-high SQL은 `deal_date >= candidateFromDate()`로 창을 자르므로 이번 INSERT는
   계산에 애초에 진입할 수 없다.
2. **응답 실측**: `mode=record-high&lawdCd=26350` 응답에서
   - `lookbackMonths: 24`, `historicalHighCoverageLabel: "2년"`, rows 19건
   - `priorHighDate` 범위 **2024-10-02 ~ 2026-08-04**
   - **2024-09-03 이전을 참조하는 priorHigh: 0건**

즉 rolling 창은 복구된 과거 데이터를 전혀 참조하지 않는다.

## 9. DB SIZE

| | before | after | delta |
| --- | --- | --- | ---: |
| `apartment_trade_histories` rows | 855,556 | 864,002 | +8,446 |
| table total | 464 MB | **468 MB** | +3.9 MB |
| ├ data | 218 MB | 220 MB | +2 MB |
| └ index | 246 MB | 248 MB | +2 MB |
| DB total | 549 MB | **553 MB** | +3.9 MB |

예상 +4.8MB보다 작은 +3.9MB. 용량 때문에 데이터 삭제나 인덱스 변경은 하지 않았다.
Supabase Pro 전환은 기존 계획대로 9월 말.

## 10. TRUST STATE (apply 후에도 유지)

| 판정 | 대상 |
| --- | --- |
| **READY** | current rolling 24-month 최고가 |
| **LIMITED** | 2020-02~2024-08 cancellation completeness (별도 resync 전) — 이번에 23셀에서 **981건 실측 확인** |
| **BLOCKED** | 2006~현재 절대적 의미의 "역대 최고가 100% 취소검증" 주장 |

**A구간 historical trade completeness는 개선됐고, cancellation trust는 개선되지 않았다.**
A구간 신규 2,848행의 `dealCanceled=false`는 schema 표현일 뿐 "취소 아님이 검증됨"이 아니다.

## 11. 남은 historical gap

1. **B구간 취소 미검증**: 2020-02~2024-08의 880셀. 이번 23셀에서 981건이 실측 확인됐고,
   나머지 869셀은 미측정.
2. **A구간 취소 영구 불가**: 2006-01~2020-01은 원천에 데이터 자체가 없다.
3. **진행형 lag 누락**: 일일 cron overlap 3개월 대비 취소의 10.5%가 3개월 이후 발생
   (V1 §6) — 연 ~250건 누적.
4. **전수 cap 확인 미완**: 표본 200셀은 깨끗했으나 부산 3,973셀 전수 대조는 미실행.

## 12. 다음 단계 제안

1. **RECORD HIGH TRUST V3 — B구간 cancellation resync** (승인 필요).
   이번에 발견한 981건을 포함해 880셀 `false→true` flip. 기존 단방향 write 정책
   (`updateFalseToTrue`만 허용)을 그대로 재사용하면 안전하다.
2. **옵션 C — 취소 lag 커버리지 확대**(3→12개월). 유일하게 진행 중인 신뢰 저하.
3. **FULL CAP SWEEP** — 부산 3,973셀 전수 `totalCount` 대조(read only, 약 20분).
