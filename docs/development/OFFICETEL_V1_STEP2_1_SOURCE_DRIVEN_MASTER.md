# OFFICETEL V1 STEP 2.1 — source-driven master expansion

- 상태: **완료 — linkage readiness READY**
- Production write: `officetel_masters` **INSERT 3,606건** (1,450 → **5,056**). UPDATE 0 / DELETE 0
- schema/migration **0** · apartment·Property 변경 **0** · SALE/RENT history 적재 **0** · cron·UI **0**
- **전체 재실행 없이 체크포인트에서 이어받아 완료**(§13)

## 1. 판별 기준 전환 — 왜 뒤집었나

STEP 2는 `건축물대장 etcPurps LIKE '%오피스텔%'`로 master를 만들었고, 그 결과 거래 원천 대비
주소 MISS가 **SALE 76.1% / RENT 75.0%** 였다.

원인은 STEP 2에서 실증했다: MISS 표본 14건을 건축물대장에 직접 조회하니 **14/14 전부 표제부가
존재**했고, 다만 용도 표기에 "오피스텔"이라는 단어가 없었다. `경동윈츠타워오피스텔`,
`투모로우 오피스텔`, `파크브라이언오피스텔`조차 `etcPurps="업무시설,근린생활시설"`이다.

**건축물대장은 오피스텔을 대개 "업무시설"로만 적는다.** 따라서 그 문자열은 오피스텔 판별
게이트로 부적합하다.

전환한 기준:

| | 역할 |
| --- | --- |
| **PRIMARY OFFICETEL SIGNAL** | **MOLIT 오피스텔 전용 SALE/RENT API에 실제 등장한 주소.** 그 API에 나타난다는 사실 자체가 그 건물이 오피스텔로 거래된다는 가장 직접적인 공식 신호다 |
| **BUILDING REGISTRY** | 판별이 **아니라** metadata 보강 — hoCnt / useApprovalDate / 주차 / 층수 / 용적률·건폐율 / roadAddress |

`etcPurps`는 이제 inclusion gate로 쓰지 않는다. 다만 저장은 그대로 하며, 그 값의 의미는
**"건축물대장상 용도 표기"** 까지다(실제 주거용 사용·세법상 주거용·주택수 포함 여부는 추론 금지).

## 2. §1 SOURCE ADDRESS UNIVERSE

확보 가능한 **전 기간** 전수: SALE 2006-01~2026-09(249개월), RENT 2011-01~2026-09(189개월)
× 부산 16구 = **7,008셀**.

| 항목 | 값 |
| --- | ---: |
| 스윕 셀 / 거래행 / 소요 | 7,008 / **314,965** / 49.7분 |
| **불완전 셀** | **0** (전수 완전 — 게이트 통과) |
| **union unique address groups** | **4,831** |
| SALE unique address groups | 3,598 |
| RENT unique address groups | 4,427 |
| SALE only / RENT only / both | 404 / 1,233 / 3,194 |
| 한 주소에 표시명 2개 이상 | 4 (0.08%) |

구별: 26230:837 · 26500:561 · 26260:490 · 26470:438 · 26410:366 · 26380:352 · 26290:345 ·
26140:278 · 26350:243 · 26530:240 · 26170:164 · 26320:155 · 26110:138 · 26710:109 · 26200:89 · 26440:26

## 3. §2 기존 master 커버리지 (전 기간 기준)

| | 주소그룹 연결가능 | └ exact | 다동 UNRESOLVED | **MISS** |
| --- | ---: | ---: | ---: | ---: |
| SALE | 837 / 3,598 (23.3%) | 510 | 24 (0.7%) | **2,737 (76.1%)** |
| RENT | 1,080 / 4,427 (24.4%) | 645 | 27 (0.6%) | **3,320 (75.0%)** |
| UNION | 1,156 / 4,831 (23.9%) | 692 | 29 (0.6%) | **3,646 (75.5%)** |

거래행 기준: SALE 연결가능 29.0% / RENT 33.5% / UNION 32.2%.

STEP 2가 3개월 표본으로 잰 값(주소 HIT 41.0% / 38.5%)보다 낮다 — 전 기간으로 넓히면 과거에만
거래된 건물이 포함돼 결손이 더 크게 드러난다. 방향은 같고 규모만 더 크다.

## 4. §3 신규 후보 + 건축물대장 보강

신규 후보(= master 없는 주소 그룹) **3,646건**. 전수 보강 결과:

| 분류 | 건수 |
| --- | ---: |
| **A_SINGLE** (표제부 정확 1건) | **3,606** |
| C_NO_TITLE (표제부 없음) | 40 |
| B_MULTI_DONG (동일 지번 다동) | **0** |
| D_UNRESOLVED (malformed/identity 불가) | **0** |
| E_CONFLICT (source conflict) | **0** |

**registry 조회 불완전 0건.**

신규 후보 3,646개 주소는 전부 표제부가 단일 canonicalKey만 반환했다 — 다동 문제는
STEP 2가 만든 기존 master 쪽에만 존재한다(§5).

## 5. §4 MASTER identity vs TRADE linkage identity (계약 확정)

두 identity를 **분리**한다.

**MASTER identity** — 건축물대장 `dongNm`이 명확하면 **동별 master**를 유지한다.
building-level master로 강제 병합하지 않는다. 실제로 이안해운대 103/104/105동(hoCnt 93/72/90),
하모니타워마브러스 101/102동(362/254)이 별도 행으로 살아 있다.

**TRADE linkage identity** — 거래 원천에는 동 필드가 **없다**. 따라서 거래 행이 만들 수 있는
키는 언제나 building-level(`...:_`)이다. 연결 규칙:

1. 주소 그룹에 master가 **정확히 1개** → 연결 가능(그 master의 키가 dong-level이어도 무방)
2. 주소 그룹에 master가 **2개 이상** → **UNRESOLVED로 유지.** 특정 동에 추측 연결 금지
3. master 없음 → MISS

이 분리가 수치로 드러난다: 최종 SALE에서 **연결가능 3,539 > exact 2,532**. 차이 1,007건은
master가 dong-level이라 문자열 exact match는 안 되지만 주소 그룹에 master가 하나뿐이라
규칙 1로 안전하게 연결되는 경우다.

## 6. §5 EXISTING MASTER RECONCILIATION

기존 1,450 master는 **그대로 유지**했다. 이번 확장 대상은 **master가 없는 주소 그룹만**이므로
기존 행을 UPDATE/분할하는 경로가 코드에 존재하지 않는다. 검증:

- `updated_at > created_at + 2s` 인 행 **0건** (INSERT-only 증명)
- 2시간 이전 생성된 master **1,450건 잔존** (STEP 2 원본 그대로)
- canonicalKey 중복 **0**

## 7. §6 DRY-RUN → §8 SMALL → §9 FULL

```
DRY-RUN   INSERT 대상 3,606
          예상 coverage  SALE 주소 98.4% / RENT 98.6%

SMALL     --districts=26230 (부산진) → INSERT 701, master 1,450 -> 2,151, delta 일치 OK
          post-apply 실측이 예상치와 정확히 일치(SALE 37.7% / RENT 39.5%)
          duplicate 0 / mutated 0 / 기존 1,450 잔존 확인

FULL      --all → INSERT 2,905, master 2,151 -> 5,056, delta 일치 OK
```

## 8. §10 POST-APPLY LINKAGE READINESS — **READY**

| | 주소그룹 연결가능 | └ exact | 다동 UNRESOLVED | MISS |
| --- | ---: | ---: | ---: | ---: |
| **SALE** | **3,539 / 3,598 (98.4%)** | 2,532 | 24 (0.7%) | 35 (1.0%) |
| **RENT** | **4,363 / 4,427 (98.6%)** | 3,097 | 27 (0.6%) | 37 (0.8%) |

거래행 기준:

| | 연결가능 | UNRESOLVED | MISS |
| --- | ---: | ---: | ---: |
| SALE (88,674행) | **86,306 (97.3%)** | 1,779 (2.0%) | 589 (0.7%) |
| RENT (226,291행) | **221,279 (97.8%)** | 4,616 (2.0%) | 396 (0.2%) |

개선폭: 주소그룹 **23.3% → 98.4%**(SALE), **24.4% → 98.6%**(RENT).
거래행 **29.0% → 97.3%**, **33.5% → 97.8%**.

**다동 UNRESOLVED 비율은 거래행 기준 SALE 2.0% / RENT 2.0%** — 이는 원천에 동 필드가 없어
구조적으로 남는 몫이며, 추측 연결을 금지한 계약의 대가다.

## 9. 최종 master 상태

| 항목 | 값 |
| --- | ---: |
| total master | **5,056** |
| duplicate canonicalKey | **0** |
| mutated rows | **0** |
| buildingDong 보유 | 1,506 (29.8%) |
| hoCnt | 4,821 (95.4%) |
| useApprovalDate | 5,046 (99.8%) |
| roadAddress | 5,038 (99.6%) |
| **latitude/longitude** | **0 (전부 NULL — 추정 좌표 없음)** |
| 이름 비어있음 | 390 |
| same-jibun multi-dong | 32 지번 / 79행 |

타 테이블 불변: apartments 71 · apartment_trade_histories 864,100 ·
apartment_rent_histories 125,469 · properties 0 · officetel trade/rent **0 / 0**.

## 10. §11 hhldCnt 정정 (기록)

STEP 1의 *"오피스텔은 hhldCnt(세대수)가 항상 0"* 주장은 **철회한다**. 3건 표본에서 나온
결론이었고, STEP 2의 전수 후보 1,456건에서는 **874건(61.1%)이 hhldCnt > 0** 이다.

- 오피스텔 + 도시형생활주택/공동주택 **복합 건물(mixed-use)** 가능성이 높다
- 오피스텔 규모 표시는 **`hoCnt`(호수) 기준을 유지**한다
- **`hhldCnt`를 "오피스텔 세대수"로 해석하지 않는다**

이번 STEP에서는 schema 변경 없이 **정정 기록만** 남긴다. `hhldCnt` 컬럼 추가는 additive
schema 변경이라 별도 승인 대상이다.

## 11. 남은 항목

- **다동 UNRESOLVED 2.0%** — 거래 원천에 동 필드가 없어 구조적으로 해소 불가. 추측 연결
  금지 계약을 유지한다(STEP 3에서 이 행들은 masterId NULL + canonicalKey 보존으로 적재).
- **MISS 0.2~1.0%** — C_NO_TITLE 40건(표제부 자체가 없는 주소) 등. 원천이 주지 않는 것이다.
- AMBIGUOUS 2건(문현동 202-71, 부곡동 331-26)은 STEP 2에서 미적재 상태 유지.

## 12. STEP 3 readiness — **READY**

거래행의 97.3~97.8%가 master에 안전하게 연결 가능하다. `officetel_trade_histories` /
`officetel_rent_histories` 적재를 진행할 수 있다. 설계 계약:

- `canonicalKey`는 항상 채운다(거래 원천에서 결정적으로 생성 가능 — 실측 100%)
- `officetelMasterId`는 주소 그룹에 master가 정확히 1건일 때만 연결, 아니면 **NULL(UNRESOLVED)**
- Record High / Score / Finance는 V1 범위 밖 유지

## 13. Resume 기록 (전체 재실행 없음)

이전 실행이 외부에서 중지된 뒤 **체크포인트에서 이어받았다**.

| 항목 | 값 |
| --- | ---: |
| resume 시작 시 cached enrichment | **3,200건** |
| remaining candidate | **446건** |
| **resumed API calls** | **481회** |
| **resume runtime** | **8.4분** |
| **source universe 재수집** | **0회** (파일 재사용) |
| **기존 enriched candidate 재호출** | **0회** (3,200건 skip) |
| final completeness | expected 3,646 == enriched 3,646 · duplicate 0 · incomplete 0 → **GATE PASS** |

무결성 사전 검증도 통과했다: universe 4,831건 / `universe-incomplete.json == []` /
addrKey 중복 0 / universe에 없는 enriched 0 / 이미 master 있는 enriched 0.
신규 후보 집합(3,646)은 universe와 기존 master로부터 **API 0회로 결정적 재계산**했다.
