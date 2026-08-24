# BUSAN SCORE DATA V1.1 — Geocoding Recovery + Missing Feature Backfill

이전 [SCORE DISPLAY BUG AUDIT](../development/SCORE-DISPLAY-BUG-AUDIT.md)
(별도 worktree `score-display-bug-audit`)에서 확정된 원인을 실제로
해소한다. score formula/weight/threshold/peer fallback 변경 없음,
UI fallback 변경 없음, DB schema/migration 없음, 가짜 좌표/hardcode
없음.

작업은 별도 worktree(`D:\anti2\aaa\e-jip-score-geocode-recovery`,
branch `score-geocode-recovery`, base `82f4914`)에서 진행 — main
C3A, `school-v2-c2a`, `school-v2-c3b` 전부 미접촉.

## 결론 요약

**부산 3,402개 ApartmentMaster 중 3,401개(99.97%)가 이제
`ApartmentLocationFeature`를 보유하고 score가 계산된다.** 이전
"3,067/3,067 OK"는 좌표 확보에 성공한 부분집합 기준이었다는 사실이
이번 STEP으로 확정됐고, 이번 recovery로 그 denominator를 실제 부산
전체(3,402)로 넓혔다. 남은 1건(`26440-147`, 에코델타호반써밋스마트
시티, 강서구)은 MOLIT 원본 지번 필드 자체가 `"가-"`로 불완전해
주소를 구성할 수 없는, 2024년 준공 신축 대규모 택지지구(강동동
에코델타시티) 특유의 데이터 결함으로 확인됐다 — 임의 좌표를 넣지
않고 unresolved로 남긴다.

## 1. 부산 Apartment Universe 재확정

```
TOTAL_BUSAN_APARTMENTS: 3,402(변동 없음, ApartmentMaster는 이번 STEP에서 새 row 추가 안 함)

[Before]
coordinates available: 3,067   coordinates missing: 335
geocodeQuality: exact=1,333 normalized=1,734 failed=335
ApartmentLocationFeature 있음: 3,067   없음: 335
score OK(당시): 3,067(V1 최종 close 기준)

[After]
coordinates available: 3,401   coordinates missing: 1
geocodeQuality: exact=1,667(+334) normalized=1,734(변동없음) failed=1
ApartmentLocationFeature 있음: 3,401   없음: 1
score OK(재검증): 3,401   INSUFFICIENT_DATA: 1
```

3,067 + 335 = 3,402 관계가 정확히 맞았고(§감사 문서에서 이미 확인),
이번 recovery로 335 → 334(recoverable) + 1(unresolved)로 갈렸다.

## 2. 335건 Geocoding 실패 원인 분류

기존 `ApartmentMaster.roadAddress`/`jibunAddress` 필드 존재 여부로
1차 분류:

| 그룹 | 건수 | 특징 |
|---|---|---|
| roadAddress+jibunAddress 둘 다 존재 | 44 | 완전한 주소 문자열을 이미 갖고 있었음에도 실패 |
| jibunAddress만 존재 | 3 | |
| 둘 다 없음(`neither`) | 288 | 단, `jibun`(번지)과 `umdName`(동)은 335건 전부 non-null(0건 결측) |

**대상 단지(`26350-2360`) 실측**(§4): `roadAddress`/`jibunAddress`
둘 다 완전하고 정상적인 형태로 존재("부산광역시 해운대구 해운대로
540 (우동)"). 그런데도 실패했었다는 것은 **주소 데이터 자체의
문제가 아니라 조회 단계의 실패**였음을 의미한다.

**실제 원인(기존 `apartment_master_seed.ts:geocode()` 코드 검토 +
실측 재현)**:

- 기존 로직은 road/jibun 주소를 포함한 **모든 후보를 `search/
  keyword.json`(POI 키워드 검색)으로만 조회**한다 — Kakao의 공식
  주소 전용 지오코더(`search/address.json`)를 쓰지 않는다.
- 대상 단지를 정확한 KA/Origin 헤더로 다시 호출한 결과,
  `keyword.json(roadAddress)`도 **지금은 21건 매칭, 정확한 결과를
  반환**했다 — 즉 처음 배치 실행 시점에는 무언가(rate limit/
  timeout/네트워크 등) 일시적으로 실패했을 가능성이 높다(**G.
  API/network/rate-limit transient failure**로 추정, 로그가 남아있지
  않아 100% 확정은 불가).
- **44건(주소 완전 보유)**은 대상 단지와 같은 패턴(주소는 멀쩡한데
  실패)일 가능성이 높다 — G가 유력.
- **288건(주소 문자열 없음, jibun/dong만 존재)**은 원래 로직이
  당시 road/jibunAddress가 비어있어 **3순위 `{dong} {name}` 키워드
  검색**만 시도했을 것으로 추정된다 — 이건 순수 이름 기반 검색이라
  구조적으로 실패/오매칭 위험이 크다(실측: "스카이맨션"을 이름만으로
  검색하면 **경기도 부천시**의 동명 건물이 1위로 잡힘, §3). 이
  그룹은 **E/H(이름 검색 취약성)**에 더 가깝다고 추정하나, 당시 실제
  실패 로그가 없어 단정하지 않는다.
- **1건(`26440-147`)**: `jibun="가-"`(불완전한 지번, MOLIT 원본
  자체 결함), `roadAddress`/`jibunAddress` 둘 다 null, 2024년
  준공(강서구 강동동 에코델타시티 — 대규모 신축 택지지구) — **C.
  missing/malformed address**로 명확히 분류. 임의 주소를 지어내지
  않고 unresolved 유지(§13).

## 3. Geocoding Fallback Strategy(신규 우선순위)

`scripts/apartment-score/recover-missing-geocodes.ts` 신규 작성(기존
`apartment_master_seed.ts`는 수정하지 않음 — 그 파일은 M3 전체
재구축용 별도 스크립트이고 이번 STEP은 "이미 존재하는 실패 335건만"
targeted 복구이므로 별개 스크립트가 적절):

```
1. address.json(roadAddress)                         — 있으면
2. address.json(jibunAddress, "번지" 접미사 제거)      — 있으면
3. address.json(sido+sigungu+dong+jibun 조합 문자열)   — road/jibunAddress 둘 다 없을 때만
4. keyword.json(roadAddress)                          — 1~3 전부 실패 시 폴백
5. keyword.json(jibunAddress)                         — 폴백
6. keyword.json(`${dong} ${name}`)                    — 최후 수단(이름 단독 아님, 동 포함)
```

**검증(모든 후보 공통, §6 안전성 gate)**: 응답의 `region_1depth_name`
(시도)이 "부산"과 일치 **AND** `region_2depth_name`(시군구)이 그
단지의 `sigungu`와 일치해야 ACCEPT — 기존 스크립트는 시도만
검증했으나 이번엔 시군구까지 강화했다(지시 그대로, "가능하면 dong
일치"까지는 미시행 — 시군구 일치만으로 이미 오매칭 0건 확인됨,
§5/§8). 실패하면 다음 후보로 넘어가고, 전부 실패하면 좌표를 만들지
않는다(AMBIGUOUS/NO_RESULT로 분류, 절대 추정 좌표 대입 없음).

## 4. 대상 단지 실측(해운대동백두산위브더제니스, 26350-2360)

```
$ recover-missing-geocodes.ts --dry-run --aptSeq=26350-2360

method: address.json:road
matched address: "부산 해운대구 해운대로 540"
coordinate: (35.1597295871407, 129.150704866293)
quality: exact
```

원본 roadAddress("부산광역시 해운대구 해운대로 540 (우동)")와 정확히
일치 — ACCEPT. 유사명 단지(`26350-2166`, 해운대두산위브더제니스,
"동백" 없음)도 별도로 조회해 **다른 좌표**(35.1572036560166,
129.144817207267, "마린시티2로 33")로 정확히 구분됨을 확인 — 혼동
없음.

## 5. 335건 Dry-run 결과

```
TOTAL_FAILED: 335
RECOVERABLE: 334
AMBIGUOUS: 0
NO_RESULT: 1(26440-147)
INVALID_ADDRESS: (NO_RESULT에 포함— 별도 코드 경로 없음, 주소 자체가 없어 후보 목록에서 자연히 제외되고 나머지 후보도 없어 결과 없음으로 귀결)
API_ERROR: 0
```

## 6. 안전성 Gate 실측 확인

- 부산(시도) 불일치: 실제로 발생(예: 이름 단독 키워드 검색이 타지역을
  반환하는 사례, §2/§3) → 해당 후보는 자동 reject, 다음 후보로 넘어감
- 시군구 불일치: 검증 로직에 포함, 이번 335건 처리에서 실제 reject
  사례는 관측되지 않음(주소 기반 후보가 대부분 1차에서 정확히
  맞았음)
- **좌표 충돌(coordinate collision) 안전 gate**: 복구 좌표가 기존
  3,067건 중 다른 aptSeq의 좌표와 반올림 6자리까지 겹치는지 전수
  검사 — **충돌 0건**

## 7. Geocoding Recovery Write

```
Wrote 334 ApartmentMaster rows.
ApartmentMaster.latitude/longitude/geocodeQuality만 갱신(schema 변경 없음).
```

기존 실패 정보(geocodeQuality='failed')는 write 시점에 성공값으로
교체됐다 — 원 실패 이력을 별도 보존하는 필드가 schema에 없어(이번
STEP에서 schema 변경 금지) 보존하지 않았다. 필요 시 이 문서가 그
기록을 대신한다.

## 8. ApartmentLocationFeature Backfill

기존 `collect-location-features.ts`를 **그대로**(코드 변경 없음)
16개 구·군 각각 `--sggCd=`로 재실행 — freshness-skip(`validUntil`
30일)이 이미 있는 3,067건은 자동으로 건너뛰고, 새로 좌표를 얻은
aptSeq만 자연스럽게 대상이 됨(§ 실측: 해운대구 dry-run에서
"target 308, skipped(fresh) 247, to collect 61" — 정확히 신규
복구분과 일치).

```
16개 구·군 전체 실행 결과: failed=0, rateLimited=0(로그 전수 확인)
최종 ApartmentLocationFeature: 3,401건(3,067 + 334)
```

## 9. Score 재계산(복구 단지만, 334건)

```
OK: 334   INSUFFICIENT_DATA: 0   ERROR: 0
score distribution(복구분만): min=16, p25=42, median=51, p75=57, max=81
(참고: 기존 V1 전체 3,059건 분포 min=14, p25=42, median=51, p75=58, max=81 — 사실상 동일)
```

좌표를 얻었다고 score를 억지로 만든 것이 아니라, **기존 coverage
기준(변경 없음)을 그대로 통과**해 자연스럽게 OK가 된 것 — 334건
전부 실제 feature 계산 결과다.

## 10. 대상 단지 최종 확인

```
aptSeq: 26350-2360
latitude: 35.1597295871407, longitude: 129.150704866293, geocodeQuality: exact
ApartmentLocationFeature: 존재, qualityFlag=complete
calculateApartmentScore:
  status: OK, score: 57, coverage: 1(100%), confidence: HIGH
  transport: 64, living: 61, parking: 51, complex: 65, schoolAccess: 34
  regionalStrengths: 지하철 접근성(NOTABLE), 해변 접근성(NOTABLE)
  preparingReason: null
```

**사용자가 리포트한 "점수 산정 준비 중" 문제가 해소됐다.**

## 11. 부산 전체 Readiness 재계산(16개 구·군)

| 구·군 | total | feature_ready | missing |
|---|---|---|---|
| 강서구 | 44 | 43 | 1 |
| 금정구 | 308 | 308 | 0 |
| 기장군 | 152 | 152 | 0 |
| 남구 | 253 | 253 | 0 |
| 동구 | 99 | 99 | 0 |
| 동래구 | 314 | 314 | 0 |
| 부산진구 | 404 | 404 | 0 |
| 북구 | 173 | 173 | 0 |
| 사상구 | 151 | 151 | 0 |
| 사하구 | 338 | 338 | 0 |
| 서구 | 171 | 171 | 0 |
| 수영구 | 251 | 251 | 0 |
| 연제구 | 244 | 244 | 0 |
| 영도구 | 133 | 133 | 0 |
| 중구 | 59 | 59 | 0 |
| 해운대구 | 308 | 308 | 0 |
| **합계** | **3,402** | **3,401** | **1** |

**15/16개 구·군이 feature 기준 100%.** 강서구만 43/44(97.7%).

## 12. Readiness 정의 수정 — 두 지표 명확히 분리

과거 "3,067/3,067 OK"라는 단일 숫자가 "부산 전체 100% 준비됐다"는
오해를 낳았다(실제로는 사용자가 이걸 근거로 "score formula 문제가
아니다"라고 정확히 판단은 했지만, 문서 자체의 표현은 개선 필요).
앞으로 최소 두 지표를 분리 표기한다:

```
A. ELIGIBLE_SCORE_SUCCESS_RATE
   = feature 보유 단지 중 OK 비율
   = 3,401 / 3,401 = 100%

B. BUSAN_APARTMENT_SCORE_COVERAGE
   = 부산 전체 ApartmentMaster 중 OK 비율
   = 3,401 / 3,402 = 99.97%
```

과거 BUSAN SCORE DATA V1 문서(§9, §15-17)는 사실 A만 100%였고 B는
90.2%(3,067/3,402)였다 — 이 문서가 그 실제 수치를 최초로 명시한다.
과거 문서를 소급 수정하지 않고(원문 그대로 두고), 이 문서에서
사실을 밝히는 방식을 택했다(§16 지시 "과거 결과를 덮어쓰지 않는다").

## 13. Unresolved 목록

| aptSeq | name | sigungu | 실패 사유 |
|---|---|---|---|
| `26440-147` | 에코델타호반써밋스마트시티 | 강서구 | `jibun="가-"`(MOLIT 원본 지번 필드 불완전), roadAddress/jibunAddress 둘 다 없음, 2024년 준공 신축 대규모 택지지구 — 6개 후보 전부 시도했으나 결과 없음(NO_RESULT) |

**향후 처리**: 임의 좌표 생성 금지 원칙 유지, GEOCODING RECOVERY V2
또는 수동 official-source reconciliation(건축물대장 등에서 정확한
지번 확인 후 재시도) 대상으로 남긴다.

## 14. Regression 확인

기존(오늘 재수집되지 않은) 6개 단지 샘플 — 해운대구 2, 서구 2,
부산진구 2 — 전부 `status: OK`, 정상 범위 점수 확인. score 코드
자체를 이번 STEP에서 전혀 수정하지 않았으므로(신규 스크립트만
추가) formula 회귀는 구조적으로 발생할 수 없다.

## 15. Tests / Quality

- `tsc --noEmit`: 0 errors
- `eslint`: 0 errors(무관 warning 5건만, 사전 존재)
- `next build`: 성공, 기존 라우트 전부 정상 출력
- 별도 fixture test는 추가하지 않음(이 스크립트들은 실제 DB/API를
  대상으로 한 1회성 recovery 도구라 unit fixture보다 dry-run 자체가
  검증 수단, 기존 apartment-score verify-*.ts 관례와 동일)

## 16. 문서화 원칙 준수

이 문서 자체가 §12의 정의 수정과 §11의 실측 결과를 담고 있다.
`BUSAN-SCORE-DATA-V1-expansion-and-readiness.md`는 **수정하지
않았다** — 그 문서는 "당시 시점의 정확한 기록"으로 그대로 두고, 이
문서(V1.1)가 후속 사실을 추가한다(§16 지시 "이 사실을 숨기거나
과거 결과를 덮어쓰지 않는다").
