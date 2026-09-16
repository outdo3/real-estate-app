# E-JIP STATS REGION ENABLEMENT MIGRATION V1

stats 코드에 흩어진 `BUSAN_SIDO_CODE` / `'26'` / `FEED_DB_SIDO_CODE` 하드코딩을 canonical region registry + enablement로 정리한다. **서울·경기 통계를 공개하지 않고, 부산 동작도 바꾸지 않는다.**

- 날짜: 2026-09-16 (KST)
- 기준 커밋: `508173e`
- 범위: 지역 판정의 출처만 변경. **DB write 0, schema 0, region enable 0, sitemap/SEO 0, stats formula 0, route 재설계 0.**
- 선행: `REGION_REGISTRY_V1` (STEP A)

---

## 0. 결론 요약

**판정: PASS**

1. **`BUSAN_SIDO_CODE` 6개 선언과 `FEED_DB_SIDO_CODE` 리터럴을 전부 제거**하고 registry/enablement 파생으로 바꿨다. stats 런타임에 `'26'` 매직 스트링은 남아 있지 않다.
2. **그 판정의 의미를 정확히 보존했다.** 그 코드는 "이 지역이 출시됐는가"가 아니라 **"실거래를 DB에 유지하고 있어서 DB-first 경로를 타도 되는가"**였다. 그래서 `stats` 축이 아니라 별도의 `isTradeDbFirst*`로 옮겼다.
3. **비부산 요청 동작을 바꾸지 않았다** — 중요한 발견이라 §3에 따로 적었다. 서울 stats는 **지금 live MOLIT로 정상 동작 중**이며(Production 실측 200 OK), 이를 `UNSUPPORTED`로 바꾸는 것은 전국 사용자 기능을 제거하는 제품 변경이라 이번 STEP에서 하지 않았다.
4. **large-complex만 진짜 enablement 게이트**다(DB 전용 기능). 기존 `UNSUPPORTED` 계약 그대로 유지하되 지원 시도를 enablement에서 읽는다.
5. **부산 parity 18/18 동일**, sitemap 139 불변, 서울·경기 stats 공개 0.

---

## 1. 이전 하드코딩

| 위치 | 코드 | 분류 | 조치 |
|---|---|---|---|
| `stats/dashboard/route.ts:48` | `BUSAN_SIDO_CODE` + `startsWith('26')` | C 쿼리 라우팅 | **enablement 파생** |
| `stats/price-rankings/route.ts:81` | 동일 | C | **enablement 파생** |
| `stats/region-change/route.ts:31` | 동일(2인자) | C | **enablement 파생** |
| `stats/yearly/route.ts:23` | `isBusan = startsWith('26')` | C | **enablement 파생** |
| `transactions/route.ts:56` | `isDbFirstEligible` | C | **enablement 파생** |
| `stats/large-complex/route.ts:13` | 지원 시도 게이트 + 기본값 + `sido:'부산'` | **B 출시 게이트** | **enablement + registry 파생** |
| `lib/stats/feed-db-source.ts:34` | `FEED_DB_SIDO_CODE = '26'` | C | **enablement 파생** |
| stats 7개 라우트 | `searchParams.get('sido') \|\| '부산광역시'` | **D 제품 기본값** | 유지(§5) |

---

## 2. 영향 consumer

`BUSAN_SIDO_CODE` 판정에 실제로 의존하던 call chain:

| 기능 | 라우트 | 판정 용도 |
|---|---|---|
| 거래량·차트·갭투자·전세가율 | `stats/dashboard` | DB-first vs MOLIT-live |
| 신고가 / 상승 / 하락 / 84㎡ | `stats/price-rankings` | DB-first vs MOLIT-live |
| 지역 변동지도 | `stats/region-change` | DB-first vs MOLIT-live |
| 연도별 매매 | `stats/yearly` | sale만 DB-first (전월세는 DB에 없음) |
| 지도 마커 | `transactions` (`fields=marker`) | DB-first vs MOLIT-live |
| 지역 피드 | `lib/stats/feed-db-source` | 시도 전체 피드 DB 처리 가능 여부 |
| 대단지 순위 | `stats/large-complex` | **기능 지원 여부**(ApartmentMaster 전용) |

---

## 3. 발견 — 이 판정은 "출시"가 아니라 "DB 보유"였다

라우트 주석이 명시하고 있다:

> "이집 TradeHistory DB는 부산 16/16 구·군만 구축돼 있고 다른 시/도는 데이터가 아예 없다 — 애초에 데이터가 존재하는 지역(부산)만 DB 경로를 타도록 하는 **고정된 지역 라우팅**이다. **非부산 사용자 동작은 이번 STEP으로 전혀 바뀌지 않는다**."

그리고 Production 실측이 이를 확인한다(마이그레이션 **전**, 2026-09-16):

| 요청 | 결과 |
|---|---|
| `/api/stats/yearly?lawdCd=11680` (서울 강남) | **200 success** (live MOLIT, 84s) |
| `/api/stats/price-rankings?lawdCd=11680&mode=record-high` | **200 OK** |
| `/api/stats/dashboard?lawdCd=11680` | **200 success** |
| `/api/stats/region-change?level=sigungu&sidoCode=11` | **200 OK** |
| `/api/stats/large-complex?sidoCode=11` | **UNSUPPORTED** (DB 전용 기능이라 정당) |

즉 **서울/경기 stats는 이미 live 경로로 서비스되고 있다.** 이것을 `UNSUPPORTED`로 바꾸면 서울뿐 아니라 대구·인천 등 **모든 비부산 지역의 기존 기능을 제거**하는 제품 변경이 된다 — "stats 동작 변경 최소화 / 부산 parity 우선 / route 재설계 시 STOP" 지시와 정면으로 어긋난다.

**그래서 §7·§8의 UNSUPPORTED 전환은 이번 STEP에서 수행하지 않았다.** 대신 판정의 *출처*만 옮겨 동작을 100% 보존했다. 이 결정은 승인 대상이며 §10에 남은 선택지를 적었다.

---

## 4. 새 구조

```
지역 정체성   → region/registry.ts      (lawdCd → 시도/시/일반구)
DB 보유 여부  → enablement.cronSync     → isTradeDbFirstSido / isTradeDbFirstLawdCd
기능 지원 여부 → enablement.stats        → isStatsEnabledSido / getStatsEnabledSidoCodes
```

`cronSync` 축에서 파생하는 이유: **정기 수집을 하는 지역만 DB가 최신**이고, 그 지역이 곧 DB-first가 안전한 지역이다. 정책을 두 벌로 만들지 않기 위해 새 축을 만들지 않았다(§4 "중복 policy 생성 금지").

이전 코드와의 동치성:

| 이전 | 이후 | 차이 |
|---|---|---|
| `sidoCodeParam === '26'` | `isTradeDbFirstSido(sidoCodeParam)` | 없음 |
| `lawdCd.startsWith('26')` | `isTradeDbFirstLawdCd(lawdCd)` | **registry에 없는 26xxx 코드는 이제 false** |

마지막 차이는 **개선**이다. 이전에는 `'26999'` 같은 존재하지 않는 코드도 DB 경로를 타서 빈 결과가 "0건"처럼 보일 수 있었다. 이제는 접두사로 추측하지 않는다. Production `apartment_trade_histories`의 `lawd_cd`는 18종(부산 16 + 27110 + 11680)이고 미등록 26xxx는 **0건**이라, 부산 동작에는 영향이 없다.

---

## 5. large-complex (§9)

유일하게 진짜 enablement 게이트다 — `ApartmentMaster`만 쓰므로 데이터가 없는 시도에서는 의미가 없고, 예전부터 `UNSUPPORTED`를 정직하게 돌려주고 있었다.

```
이전: sidoCodeParam !== '26'        → UNSUPPORTED, supportedSidoName: '부산광역시'
이후: !isStatsEnabledSido(param)    → UNSUPPORTED, supportedSidoName: registry의 시도명
      where: { sido: '부산' }        → where: { sido: getSido(param)?.shortName }
```

응답 계약(`status`/`message`/`supportedSidoCode`/`supportedSidoName`/`scope`)은 그대로다. route 재설계는 필요하지 않았다.

---

## 6. 유지한 것 (§5 제품 기본값)

stats 7개 라우트의 `searchParams.get('sido') || '부산광역시'` (+ `gungu || '서구'`)는 **그대로 뒀다**.

이 값들은 `lawdCd`가 없을 때 `resolveLawdCd(sido, gungu)`의 입력으로만 쓰이는 **랜딩 기본 지역**이고, 실제 DB-first 판정은 이제 해석된 `lawdCd`를 registry로 확인한다. 즉 UI default와 data identity가 분리됐다 — §5가 요구한 형태다. 바꾸면 부산 기본 화면이 달라져 §24 STOP 조건에 걸린다. FOLLOW_UP으로 남긴다.

---

## 7. 테스트

`src/lib/region/stats-enablement.test.ts` — 15개 전부 통과.

| # | 확인 |
|---|---|
| 1~3 | 부산 시도/16구/대표 3구 전부 DB-first 적격 |
| 4~7 | 서울 강남·송파, 경기 분당·김포는 DB-first 아님 |
| 8 | 미등록 코드(27110·99999·26999·null)는 DB-first 아님 — 접두사 추측 금지 |
| 9 | 비부산이 부산으로 fallback되지 않음(6축 전부 false) |
| 10 | feed가 enablement에서 시도 컨텍스트를 가져오고 `'26'` 리터럴 0 |
| 11·11b | 7개 파일에 `BUSAN_SIDO_CODE`·`startsWith('26')`·`=== '26'` 0, 각 라우트가 실제로 helper 호출 |
| 14 | large-complex는 지원 시도만 통과 + `UNSUPPORTED` 계약 유지 + `sido:'부산'` 제거 |
| 15 | 출시(stats)와 DB 보유(cronSync)가 서로 다른 축으로 분리 |
| 16 | stats 영역에서 시도 코드 자체 상수 재선언 0 |

```
npx tsx --test src/lib/region/stats-enablement.test.ts   pass 15   fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"    pass 2233 fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"  pass 135  fail 0
npx eslint (변경 9개 파일)                                 exit 0
npx tsc --noEmit                                         src/ 오류 0
                                                         기존 25건은 scripts/·tmp/ → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                            Compiled successfully in 1.7s
```

KST period 모듈(`Statistics Period & Trade UX V1`)은 지역 판정과 무관하고, 전체 suite에 포함된 기존 period 테스트가 전부 통과한다(§15).

---

## 8. Production QA (배포 후, §19·§21)

커밋 `1214f98` push → Vercel Production 배포 완료.

### 부산 parity — 18/18 완전 동일

배포 전에 기록한 signature(응답 status·scope·region·period·mode·rows/items 길이와 head·data 키 구성·연도별 표 전체 등)를 배포 후와 비교했다.

| 요청 | http | 결과 |
|---|---|---|
| dashboard 부산전체 / 서구 / 해운대 / 연제 | 200 | **IDENTICAL** ×4 |
| price-rankings record-high 서구 | 200 | **IDENTICAL** |
| price-rankings rising / decline 해운대 | 200 | **IDENTICAL** ×2 |
| price-rankings area84 연제 | 200 | **IDENTICAL** |
| region-change sigungu 부산 / dong 해운대 | 200 | **IDENTICAL** ×2 |
| region-change (param 누락 케이스) | 400 | **IDENTICAL** |
| yearly 서구 / 해운대 | 200 | **IDENTICAL** ×2 |
| large-complex 부산 / 서구 | 200 | **IDENTICAL** ×2 |
| transactions marker 해운대 (DB-first 지도) | 200 | **IDENTICAL** |
| large-complex 서울 | 200 `UNSUPPORTED` | **IDENTICAL** |
| region-change sigungu 서울 (live 경로) | 200 `OK` | **IDENTICAL** |

**PARITY: PASS** — 부산 결과도, 비부산 live 동작도 바뀌지 않았다.

### 안전 확인

| 확인 | 결과 |
|---|---|
| sitemap `<loc>` | **139** (불변) |
| sitemap 내 서울/경기 URL | **0** |
| `/` · `/stats` · `/map` | 200 |
| 5xx | **0** |
| `error_logs` 최근 2시간 / 24시간 | **0 / 0** (최신 2026-09-11, 배포 5일 전) |
| 서울/경기 stats 공개 | 변화 없음(§3·§10대로 live 경로 유지, 신규 노출 0) |

---

## 9. 하드코딩 재스캔 (§20)

| 분류 | 위치 | 비고 |
|---|---|---|
| **BLOCKER** | — | **0** |
| CANONICAL_REGISTRY | `region/registry.ts`, `region/enablement.ts` | 유일한 정본 |
| EXPECTED_PRODUCT_DEFAULT | stats 7개 라우트의 `sido \|\| '부산광역시'`, `gungu \|\| '서구'` | 랜딩 기본 지역(§5·§6) |
| TEST_ONLY | `stats-enablement.test.ts`, `feed-db-source.test.ts` 등 | 계약 고정 |
| FOLLOW_UP | 위 제품 기본값을 enablement 기반으로 | 부산 UX 변경이라 별도 승인 |
| FOLLOW_UP | 서울/경기 stats의 live 경로 정책(§10) | 승인 필요 |

`BUSAN_SIDO_CODE`는 런타임 코드에서 **완전히 사라졌고**, 남은 것은 주석 1개와 테스트 단언 1개다.

---

## 10. 남은 결정 — 서울/경기 stats 정책

현재 상태를 있는 그대로 적는다:

- **서울·경기 stats는 live MOLIT로 응답한다.** 데이터는 진짜지만 느리고(강남 yearly 84초), DB-first의 신뢰 장치(coverage cell·취소 반영)를 거치지 않는다.
- registry/enablement상 서울·경기는 `stats: false`지만, **DB-first 라우팅만 그 축과 무관하게 동작**한다(의도적 분리).

선택지:

| 안 | 내용 | 영향 |
|---|---|---|
| A (현행 유지) | 비부산은 계속 live | 기능 유지, 느림, 신뢰 장치 없음 |
| B | `stats: false` 시도를 `UNSUPPORTED`로 | **전국 비부산 stats 기능 제거** — 제품 결정 필요 |
| C | 서울/경기 데이터 적재 후 `stats: true` | 확장 로드맵대로, 시간 소요 |

이번 STEP은 **A를 유지**했다. B는 사용자에게 보이는 기능을 없애는 변경이라 승인 없이 할 수 없다.

---

## 11. 하지 않은 것

- DB INSERT/UPDATE/DELETE 0, migration 0, schema 0.
- 서울/경기 stats enable 0. sitemap 0. SEO index 0. MOLIT backfill 0.
- stats 집계 공식·기간 옵션·신고가 정의 변경 0.
- report route 변경 0. route 재설계 0.
- 캐시 키 변경 0 — 기존 키가 이미 `lawdCd`/`sidoCode`를 포함해 region-aware다(`stats-yearly:${lawdCd}:${db|live}` 등). 실제 collision 위험이 없어 손대지 않았다(§16).
- 제품 기본 지역(`'부산광역시'`/`'서구'`) 변경 0.

---

## 13. 남은 아키텍처 갭

- stats 7개 라우트의 랜딩 기본 지역이 문자열 리터럴이다(데이터 경로와는 분리됨).
- `/report/city/busan` 고정 route와 리포트 스코프 타입은 여전히 시도 파라미터가 없다.
- `REGION_DATA`가 UI 시군구 소스라 경기 일반구를 다루려면 registry 기반 전환이 필요하다.
- Score 곡선 부산 보정, 학교 C10, 오피스텔 스크립트는 그대로.
- 서울/경기 stats의 live 경로는 coverage/취소 신뢰 장치를 거치지 않는다(§10).
