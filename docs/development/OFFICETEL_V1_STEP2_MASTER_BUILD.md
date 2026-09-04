# OFFICETEL V1 STEP 2 — master build from building registry

- 상태: **master 적재 완료 · linkage 준비도는 LIMITED (원인 규명 완료)**
- Production write: `officetel_masters` **INSERT 1,450건** (UPDATE 0 / DELETE 0)
- schema 변경 **0** / apartment·Property 계열 변경 **0** / SALE·RENT 적재 **0** / cron·UI **0**

## 1. 의미 한정 (선행 STEP 표현 정정)

이 STEP이 판정하는 것은 **"건축물대장상 오피스텔 용도"** 까지다. 다음은 추론하지 않았고
필드명·문서 어디에도 넣지 않았다: 실제 주거용 사용 여부 · 세법상 주거용 · 주택수 포함 여부 ·
주택법상 주택 여부 · LTV/DSR 적용 여부 · 취득세 유형.

**STEP 1 주장 정정 — `hhldCnt`는 항상 0이 아니다.** STEP 1에서 3건 표본으로
*"오피스텔은 hhldCnt(세대수)가 항상 0"* 이라고 적었으나, 1,456건 전수에서는
**874건(61.1%)이 `hhldCnt > 0`** 이다. 오피스텔+도시형생활주택/공동주택 복합 건물이 많기
때문이다. 규모 표시를 `hoCnt`로 하는 원칙은 유지하되(§6), "항상 0"이라는 서술은 철회한다.
`hhldCnt` 저장 여부는 schema 변경이라 이번 범위 밖 — §10 권고 참고.

## 2. 원천 스윕 — 완전성 게이트

건축물대장 표제부(`getBrTitleInfo`)는 `sigunguCd + bjdongCd`만으로 **법정동 전수 열거가
가능**하다(실호출 확인). 부산 254개 법정동을 전수 훑었다.

| 시도 | 결과 |
| --- | --- |
| 1차 (간격 330ms, 재시도 없음) | 법정동 254 중 **176개 불완전**, 79,224건만 스캔, 후보 337건. **2개 구(사하·수영)가 통째로 누락**. → APPLY 금지 |
| 2차 (간격 500ms, 4회 지수 백오프) | 347,873건 스캔, API 3,604회, 40.8분. **불완전 7개** 잔존 → APPLY 금지 |
| 3차 (7개 표적 재수집, 간격 1.1s, 8회 재시도) | **7/7 COMPLETE**, 신규 25건 병합 → **불완전 0** ✅ 게이트 통과 |

1차 실패의 원인은 원천의 **간헐 EMPTY_BODY**이고, 실패한 법정동을 개별 재조회하면 정상
응답이 온다(재현 확인). 재시도가 없던 스크립트가 한 페이지 실패로 법정동 전체를 버려
**후보 집합이 조용히 불완전해졌다.** `got < total` short-read 검사와 `incomplete-dongs.json`
원장을 추가해 이 실패가 다시 조용히 지나가지 못하게 했다.

## 3. §1 SOURCE AUDIT (전수, 254/254 법정동)

| 항목 | 값 |
| --- | ---: |
| 오피스텔 후보 | **1,456** |
| unique sggCd+umd+jibun | 1,382 |
| buildingDong 있음 / 없음 | 589 / 867 (40.5%) |
| 동일 지번 다동 건물 | 33 지번 (2.39%) |
| └ 전부 동명 / 전부 없음 / **혼합** | 31 / 2 / **0** |
| malformed jibun | **0** |
| 산 지번(platGbCd=1) | **0** |
| unresolved(키 생성 실패) | **0** |
| hoCnt 있음 | 1,366 (95.5%) |
| **hhldCnt > 0** | **874 (61.1%)** ← STEP 1 주장 정정 근거 |
| useApprovalDate | 1,429 (99.9%) |
| roadAddress | 1,426 (99.7%) |
| 건물명 비어있음 | 129 |
| **좌표** | **0 — 이 API는 좌표를 제공하지 않는다.** 추정 금지 → `latitude/longitude` NULL |
| 동일 지번 etcPurps 혼합 | 18 지번 |

## 4. §2 BUILDINGDONG CONTRACT (확정)

| 상황 | 처리 |
| --- | --- |
| 동일 지번 1동만 존재 | building-level 키 `...:_` (dongNm 없으면) 또는 동 단위 키 |
| 동일 지번 여러 동, **전부 동명 있음** | 각각 동 단위 키. **절대 병합하지 않는다** |
| 동일 지번 여러 동, **전부 동명 없음** | 전부 building-level 키가 되어 충돌 → `AMBIGUOUS`로 **적재 제외** |
| **일부만 동명 있음(MIXED_DONG)** | 동 있는 행은 동 단위, 없는 행은 building-level — **building-level로 병합하지 않는다**. 부산 실측 **0건** |
| 건물명 동일 / 다름 | identity에 영향 없음(이름은 키에 없음). 충돌 판정의 보조 신호로만 사용 |
| etcPurps 혼합 | identity에 영향 없음. 충돌 판정 신호로 사용 |

추측으로 buildingDong을 보완하는 경로는 코드에 존재하지 않는다.

## 5. §4 IDENTITY COLLISION (전수)

| 항목 | 값 |
| --- | ---: |
| distinct canonicalKey | 1,451 |
| collision 키 | **3** (행 7) |
| └ 완전 동일 중복(안전 collapse) | 1 |
| └ **AMBIGUOUS(적재 제외)** | **2** |

AMBIGUOUS 2건 — 둘 다 "같은 지번 · 여러 건물 · dongNm 없음":

```
OFFI:26290:문현동:202-71:_
   name=""            useApr=20111212 hoCnt=null etc="오피스텔(기계식주차장)"
   name="우노빌"       useApr=20041124 hoCnt=26   etc="업무시설(오피스텔) 외1"
OFFI:26410:부곡동:331-26:_
   name="우진더클래식110" useApr=20151016 hoCnt=4 etc="공동주택(다세대주택), 업무시설(오피스텔)"
   name="우진더클래식108" useApr=20151016 hoCnt=8
   name="우진더클래식107" useApr=20151016 hoCnt=2
```

**적재하지 않았다.** 어느 쪽이 어느 건물인지 원천이 구분해 주지 않으므로, 잘못된 master를
만드는 것보다 없는 편이 안전하다.

## 6. §5/§6/§7 DRY-RUN → APPLY

```
DRY-RUN   후보 1,456 / resolved 1,456 / unresolved 0 / collapse 1 / AMBIGUOUS 2
          지번 그룹: SINGLE 1,370 · MULTI_ALL_NAMED 33 · MULTI_ALL_UNNAMED 2 · MIXED_DONG 0
          ==> INSERT 대상 1,450

SMALL     --districts=26350 (해운대) → INSERT 140, row 0 -> 140, delta 일치 OK
FULL      --all → 기존 140 skip, INSERT 1,310, row 140 -> 1,450, delta 일치 OK
```

INSERT only. UPDATE·DELETE·merge 경로가 코드에 없다. 이미 존재하는 canonicalKey는 skip.

## 7. §8 POST-APPLY VERIFY

| 항목 | 값 |
| --- | ---: |
| total master | **1,450** |
| **duplicate canonicalKey** | **0** |
| same-jibun multi-dong | 32 지번 / 79행 (분리 저장됨) |
| buildingDong NULL | 850 (58.6%) |
| hoCnt | 1,384 (95.4%) |
| useApprovalDate | 1,448 (99.9%) |
| roadAddress | 1,444 (99.6%) |
| 건폐율/용적률 | 1,450 / 1,450 (100%) |
| **latitude/longitude** | **0 (전부 NULL — 추정 좌표 없음)** |
| 이름 비어있음 | 130 |
| 부산 전체 동명 건물(이름 충돌) | 52 그룹 ← 이름 단독 identity가 왜 금지인지 재확인 |

다동 분리 실증(해운대 중동):

```
1754-3 이안해운대       103동 hoCnt=93 / 104동 hoCnt=72 / 105동 hoCnt=90
1757   하모니타워마브러스 101동 hoCnt=362 / 102동 hoCnt=254
```

기존 테이블 불변: apartments 71 · apartment_trade_histories 864,100 ·
apartment_rent_histories 125,469 · **properties 0** · officetel trade/rent **0 / 0**.

## 8. §9 LINKAGE READINESS — **LIMITED (STEP 3 진행 전 해결 필요)**

부산 16구 × 3개월 거래 원천을 master와 대조:

| | SALE (724행) | RENT (7,591행) |
| --- | ---: | ---: |
| canonicalKey 생성 가능 | 724 (100%) | 7,591 (100%) |
| **master EXACT match** | 157 (21.7%) | 1,324 (17.4%) |
| 주소(동 무시) 그룹 HIT | 297 (41.0%) | 2,919 (38.5%) |
| └ master 1건(명확) | 279 (38.5%) | 2,757 (36.3%) |
| └ master 다건(다동 모호) | 18 (2.5%) | 162 (2.1%) |
| **주소 MISS(master 없음)** | **427 (59.0%)** | **4,672 (61.6%)** |

### 8.1 원인 규명 — `etcPurps` 필터가 구조적으로 좁다

MISS 주소 14건을 건축물대장에 **직접 조회**한 결과 **14/14 전부 표제부가 존재**했다.
표제부가 없는 게 아니라, 용도 표기에 "오피스텔"이라는 단어가 없었다:

```
좌동 1473-6  거래명="경동윈츠타워오피스텔"  main="업무시설" etc="업무시설,제1,2종근린생활시설"
좌동 1475-2  거래명="투모로우 오피스텔"     main="업무시설" etc="업무시설, 제2종근린생활시설"
좌동 1476-4  거래명="파크브라이언오피스텔"  main="업무시설" etc="업무시설, 제1,2종근린생활시설"
좌동 1432-4  거래명="르네상스 오피스텔"     main="교육연구시설" etc="업무시설,연구소"
우동 1435-3  거래명="한일오르듀"            main="업무시설" etc="업무시설(제1,2종근린생활시설,위락시설)"
```

집계: `표제부 0건 0 / 표제부 있으나 용도에 오피스텔 없음 14 / 오피스텔 있음 0`.

**즉 건축물대장은 오피스텔을 대개 "업무시설"로만 적는다.** 이름에 "오피스텔"이 들어간
건물조차 그렇다. `etcPurps LIKE '%오피스텔%'`은 **오피스텔 판별 기준으로 부적합**하다.

### 8.2 두 번째 구조적 쟁점 — 거래 원천에 동(棟) 필드가 없다

거래 원천은 `sggCd/umdNm/jibun/offiNm`만 준다. 동 필드가 없으므로 거래 행이 만들 수 있는
키는 **언제나 building-level(`...:_`)** 이다. 반면 master는 dongNm이 있으면 동 단위 키를
갖는다. 그래서 EXACT match(17~22%)가 주소 HIT(38~41%)보다 낮다 — **다동 건물은 구조적으로
exact match가 되지 않는다.** 표시명으로 동을 특정할 수 있었던 비율도 SALE 0/18, RENT 8/162로
사실상 불가능하다.

## 9. 남은 blocker

1. **master 커버리지 부족(59~62% MISS)** — 원인은 §8.1. 이 상태로 STEP 3 linkage를 하면
   거래의 60%가 master 없이 남는다.
2. **다동 건물 linkage 불가** — 원인은 §8.2. 거래 원천에 동이 없어 동 단위 master와
   연결할 수단이 현재 없다(SALE 18건 / RENT 162건 규모, 전체의 2%대).
3. AMBIGUOUS 2건(문현동 202-71, 부곡동 331-26)은 영구 미적재 — 원천이 구분 정보를 주지 않는다.

## 10. 다음 STEP 권고

**STEP 2.1 — 거래 원천 기반 master 확장(승인 필요).** 판별 기준을 뒤집는다:
"건축물대장이 오피스텔이라고 적은 건물"이 아니라 **"MOLIT 오피스텔 실거래 원천에 나타나는
주소"** 를 후보로 삼고, 건축물대장 표제부는 **판별이 아니라 보강(hoCnt·승인일·주차·용적률)**
용도로만 쓴다. MOLIT의 오피스텔 전용 API에 나타난다는 사실 자체가 그 건물이 오피스텔로
거래된다는 가장 직접적인 공식 신호다. 이 방식은 §8.1 커버리지 문제를 구조적으로 해소한다.

**STEP 2.2 — 다동 연결 규칙(설계 필요).** 거래 원천에 동이 없으므로 (a) 주소 그룹에 master가
1건이면 연결, (b) 여러 건이면 **UNRESOLVED로 보존**(추측 연결 금지)을 기본 계약으로 제안한다.

**보류 권고 — `hhldCnt` 저장.** 61.1%가 0이 아니므로 복합 건물 판단에 유용하나
additive schema 변경이라 별도 승인 대상이다.

`officetel_trade_histories` / `officetel_rent_histories` 적재는 위 2건이 정리된 뒤 STEP 3에서
진행한다. Record High / Score / Finance는 V1 범위 밖 유지.
