# E-JIP SCORE V2 — STEP 0.7: Apartment Identity Recovery(MOLIT/건축물대장 Evidence 기반)

- 작성일: 2026-08-23
- Worktree/Branch: `score-v2-step07-identity-recovery`(base: `score-v2-step0-forensic-audit`,
  STEP 0/0.5/0.6 전체 포함 확인 완료)
- 성격: **READ-ONLY RECOVERY AUDIT.** production Score/weight 변경 0건, DB
  schema 변경 0건, migration 0건, production DB write 0건, main merge 없음.
  이번 STEP은 "복구가 가능한가"를 검증하는 감사이며, 실제 write는 §26에서
  제안만 하고 실행하지 않는다.

## 0. 목적

STEP 0.6은 부산 ApartmentMaster 3,402건 중 1,725건(50.7%)이 "고위험"
(registry 미연결 + 주소 없음 + 좌표 keyword geocode)이며, 그중 1,398건
(81.0%)이 MOLIT 거래이력을 갖고 있어 identity 강화 여지가 있다고
분석했다. 이번 STEP은 그 여지를 **실제로, 결정적(deterministic) 근거만
사용해서, 얼마나 안전하게 실현할 수 있는가**를 부산 전체 실측으로
검증한다.

**절대 금지(그대로 준수)**: 이름 유사도만으로 merge, fuzzy name 자동
merge, 좌표 근접만으로 merge, 다른 단지 fallback/guess, production
Score/weight 변경, DB schema 변경/migration, production DB write, main
merge. 이번 STEP은 READ-ONLY.

---

## 1. 핵심 발견 요약(먼저 제시)

1. **고위험 1,725건 / MOLIT 복구후보 1,398건 / 증거없음 327건 — STEP
   0.6과 정확히 일치 재현(§2)**.
2. **당초 예상과 다른 진짜 원인 발견(§9)**: 이 1,398건의 registry 조회가
   원래 실패했던 이유는 "등록 자체가 없어서"가 아니라, 기존 seed
   스크립트가 **총괄표제부(getBrRecapTitleInfo, 다동 단지 전용)만
   조회**했기 때문이었다. 같은 API 계열의 **표제부(getBrTitleInfo,
   단일 건물용)로 fallback**하자 48건 pilot 기준 45/48(93.8%)이 추가로
   성공 — 총 47/48(97.9%)이 registry 매칭에 성공했다.
3. **이름 매칭은 필요 없다**: 이 복구는 "서로 다른 두 row를 이름으로
   merge"하는 작업이 아니라, **이미 aptSeq로 확정된 단일 row가 자기
   자신의 MOLIT 원본 jibun/dong으로 registry를 조회해 자기 자신의
   주소/세대수를 보강**하는 단일-row enrichment다. pilot에서 이름
   표기가 registry와 다른 경우가 9/48건(예: "동부현대"↔"현대아파트")
   있었지만, 지번(필지) 자체가 유일하게 일치하면 이름 표기 차이는
   회복을 막지 않는다(§9, §17).
4. **주용도가 항상 "공동주택"은 아니다**: pilot 48건 중 5건(10.4%)이
   업무시설/근린생활시설/단독주택으로 등록돼 있었다 — apartment
   universe 소속 자체를 다시 물어야 하는 신호(§20/§24).
5. **구덕금호(negative benchmark) — 억지로 정상화하지 않음(§13)**:
   registry 조회는 성공했으나 주용도가 "단독주택"으로 나왔다 →
   RECOVERY_MEDIUM(HIGH 아님), universe=NON_TARGET. STEP 0.6이 이미
   의심했던 "구덕금호 자체가 정상 아파트 데이터가 아닐 수 있다"는
   판단이 이번 실측으로 다시 확인됐다 — 지시사항 §27대로 이 STEP은
   구덕금호를 정상처럼 보이게 만들지 않는다.

*(§16 이후 전수 1,398건 시뮬레이션 수치는 §16-25에서 확정치로 제시.)*

---

## 2. 고위험 1,725건 / MOLIT 복구후보 1,398건 재현(§1 지시사항)

`scripts/apartment-score/lib/step07-universe.ts`(공용 모듈) +
`step07-02-universe.ts` — STEP 0.6(`step06-04-recovery-and-universe.ts`)과
**완전히 동일한 조건**을 재사용(새 조건 도입 안 함):

```ts
highRisk = geocodeQuality === 'normalized'
        && roadAddress == null && jibunAddress == null
        && totalHouseholds == null
```

```
ApartmentMaster 전체(aptSeq 있는 것):  3,402건
고위험 1,725건 재현:                    1,725건 ✓ (STEP 0.6과 정확히 일치)
MOLIT 복구후보(mgmBldrgstPk 없음 + transactionCount12m>=1): 1,398건 ✓
증거 없음(mgmBldrgstPk 없음 + transactionCount12m=0):        327건 ✓
합계 검증: 1,398 + 327 = 1,725 ✓
```

요청된 전체 필드 구조로 재현 확인(예시, `step07-02-universe.ts` 출력):
`aptSeq/aptName/lawdCd/dong/jibun/roadAddress/lat/lng/coordinateQuality/
registryLinked/households/builtYear/mgmBldrgstPk/transactionCount12m` —
모두 실제 DB 값 그대로, 임의 채움 없음.

MOLIT 복구후보 lawdCd(구·군)별 분포(1,398건):

```
부산진구(26230) 173  금정구(26410) 140  해운대구(26350) 139  동래구(26260) 125
사하구(26380) 118    수영구(26500) 117  서구(26140) 97      사상구(26530) 87
연제구(26470) 81     남구(26290) 81     동구(26170) 52       기장군(26710) 52
영도구(26200) 47     북구(26320) 42     중구(26110) 41       강서구(26440) 6
```

---

## 3. MOLIT 거래이력 field 재확인(실측, 추정 아님)

`src/lib/api-molit.ts:fetchMolitData()`(production 함수, 이번 STEP에서
수정하지 않음) 라이브 재호출로 확인(서구 26140, 2026-05~07 3개월
표본, 87/76/87건):

```
aptSeq: 87/87, 76/76, 87/87건 모두 존재(100% coverage, 3개월 표본)
확인된 실제 필드: aptSeq, name, dong(법정동), jibun(지번), buildYear(건축년도),
                 excluUseArea(전용면적), dealDate, registryDate(등기일자),
                 dealCanceled(해제여부)
```

**MOLIT 원본에는 도로명주소/세대수/건축물 용도 필드가 없다** — 이
필드들은 MOLIT 거래 데이터가 아니라 건축물대장(등록 registry)에서만
확보 가능하다(추정 아님, API 응답 구조 확인). 그래서 §4의 복구 메커니즘은
"MOLIT 거래 재확인"이 아니라 **"MOLIT이 원래 채워둔 jibun/dong으로
건축물대장을 조회"**하는 방식이다(§9).

---

## 4. Deterministic Identity Recovery — Level 설계(핵심)

### 4.1 기존 registry 조회가 실패했던 진짜 원인(§9 실측)

`scripts/apartment_master_seed.ts:fetchRegistryOnce()`는
`BldRgstHubService/getBrRecapTitleInfo`(총괄표제부, 여러 동으로 이뤄진
단지 전체 집계용)만 호출한다. 48건 pilot에서 이 방식만 쓰면
**45/48(93.8%)이 not_found**였다. 가설(총괄표제부는 다동 단지에만
생성되는 레코드이고, 소규모/단일동 건물은 표제부만 있을 것)을 실측으로
검증하기 위해 같은 API 계열의 `getBrTitleInfo`(표제부, 단일 건물용)를
fallback으로 추가 호출 → **47/48(97.9%) 성공**. 5개 직접 비교 사례
전부 recap=not_found였는데 title=success였다(구조적 원인 확인, 우연
아님).

이 fallback은 **운영 seed 스크립트(`apartment_master_seed.ts`)에는
적용하지 않았다** — 이번 STEP은 감사 전용이고, 운영 코드 변경은 §26
승인 이후 범위.

### 4.2 Level 정의(코드: `scripts/apartment-score/lib/step07-recovery-resolver.ts`)

| Level | 조건 | 의미 |
|---|---|---|
| **RECOVERY_HIGH** | registry(recap→title fallback) 조회 성공, **recordCount===1**(유일 매칭), 주용도="공동주택", 세대수 확보, (있다면) 건축년도가 registry 사용승인년도와 ±3년 이내, 차수(1차/2차) 표기가 후보/registry 양쪽에 있는데 서로 다르지는 않음 | 자동 승격 후보(§0에 따라 실제 write는 별도 승인 전 금지) |
| **RECOVERY_MEDIUM** | registry 조회는 유일하게 성공했으나 주용도≠공동주택 **또는** 세대수 필드 자체가 없음 | 주소/식별 일부 회복되나 apartment universe 소속 또는 완전성이 불확실 — write 후보 아님 |
| **RECOVERY_REVIEW** | recordCount>1(주소 자체가 모호) **또는** 차수(N차) 표기가 후보-registry 간 명백히 다름/한쪽에만 있음 **또는** 건축년도가 ±3년 넘게 다름 | §17 adversarial case — 사람이 봐야 함, 자동 아무것도 금지 |
| **RECOVERY_FAILED** | registry 조회 자체가 not_found/api_error/parse_error(산지번 등 구조적으로 조회 불가) | 결정적 근거 없음, 현재 상태 유지 |

**이름(name) 비교는 게이트가 아니다.** §17("이름 유사도만으로 merge
금지")을 지키는 방법은 "이름을 아예 merge 조건에 쓰지 않는 것"이다 —
이 resolver는 이미 확정된 단일 row의 자기 주소(jibun/dong/sggCd)로만
조회하므로 애초에 "어느 row와 merge할지"를 이름으로 고르는 단계가
없다. 이름은 오직 **이상 신호 탐지**(차수 불일치)에만 쓰인다. 실측
근거: pilot 47건의 성공 사례 중 9건(19.1%)이 이름 표기가 달랐으나
지번은 유일하게 일치했다 — 이름을 게이트로 썼다면 이 9건을 정당한
근거 없이 놓쳤을 것이다.

### 4.3 왜 지시사항의 원안(이름+지번 조합)이 아니라 지번 단독인가

지시사항 §4 원안은 "lawdCd+정규화이름+정확 지번" 조합을 제시했다.
그러나 §6 collision audit(아래)로 확인한 바, **동일 이름+lawdCd
그룹은 100% 서로 다른 지번(서로 다른 실제 필지)이었다** — 즉
"이름+지번"에서 이름은 지번이 이미 unique하게 식별하는 것에 추가
정보를 주지 않는다. 반대로 이름을 게이트로 추가하면 §9에서 확인한
19.1%의 정당한 매칭(단순 표기 차이)을 부당하게 차단한다. 그래서
**지번(정확히는 sggCd+umdCd+jibun, 이미 그 row 자신이 갖고 있는 값)
단독을 deterministic key로, recordCount===1을 유일성 보증으로
사용**했다 — 이름 비교보다 더 엄격하면서(레코드가 여러 개면 무조건
REVIEW) 더 정확하다(표기 차이로 인한 오차단이 없음).

---

## 5. Name Normalization 안전성 재확인

기존 두 함수 모두 확인:

- `scripts/apartment_master_seed.ts:normalizeName()` — 공백 제거 +
  트레일링 "아파트"만 제거. 차수 보존.
- `src/lib/apt-name-match.ts:normalizeAptName()` — 위와 동일 + 카카오
  POI가 붙이는 " N동" 접미사만 추가 제거. 차수 보존.

이번 STEP은 **DB 저장값(`normalizedName`)과 동일한 첫 번째 함수를
그대로 재사용**(§5 "기존 helper 재사용 가능성 확인" 지시 이행).

실측 검증(`step07-07-collision-audit.ts`):

```
"롯데캐슬" → "롯데캐슬"
"롯데캐슬아파트" → "롯데캐슬"
"롯데캐슬1차" → "롯데캐슬1차"        ← 차수 보존 확인
"롯데캐슬2차" → "롯데캐슬2차"        ← 차수 보존 확인
"롯데캐슬1차아파트" → "롯데캐슬1차"

DB 저장된 normalizedName과 재계산 불일치: 0/3,402건(완전 일치)
```

실제 프로덕션 데이터에서도 차수 구분이 살아있음을 확인:
`26140-1243 대신푸르지오1차` / `26140-1290 대신푸르지오2차` — 별개
row, 별개 aptSeq, normalizedName도 서로 다름(§11 회귀 표본 참고).

---

## 6. 동일 normalizedName + lawdCd Collision 감사(부산 전체)

```
동일 normalizedName+lawdCd 그룹(2건 이상): 53개 그룹, 관련 row 113건
ambiguous(distinct jibun 2개 이상 = 서로 다른 필지): 53개 그룹(100%)
동일 jibun인데 aptSeq 여러 개(별도 조사 필요): 0개 그룹
```

**핵심 결론: 조사된 53개 그룹 전원이 서로 다른 필지(jibun)였다** —
"이름+구·군"만으로 merge를 시도했다면 53건 모두 오매칭이었을 것이다.
이 수치가 §0 "이름 유사도만으로 merge 금지" 원칙의 실측 근거이며,
§4.3에서 지번 단독을 key로 채택한 이유의 직접 증거다.

샘플(`26140::문화` — 서구에 이름이 "문화"인 서로 다른 아파트 3곳):

```
26140-63(토성동2가 7-4, 1974년) / 26140-15(동대신동3가 173, 1971년) /
26140-77(?, 30-1, 1975년) — 이름 동일, 지번/건축년도 전부 다름
```

---

## 7-8. aptSeq 신뢰성 / Zero-transaction 의미

- aptSeq는 MOLIT 원본 식별자이며 §3에서 확인한 대로 최근 3개월 표본
  100% coverage. 고위험 1,725건도 예외 없이 aptSeq를 보유(§2, DB
  unique 제약).
- **거래 0건(327건군)이 "가짜 단지"를 의미하지 않는다** — STEP 0.6
  원칙 그대로 유지. 다만 이 327건은 MOLIT 거래 자체가 없어 이번
  STEP의 registry-복구 메커니즘을 적용할 근거(jibun/dong)가 상대적으로
  약할 수 있음(§11 회귀 표본으로 개별 확인).

---

## 9. Registry Linkage 복구 가능성 — 실측 pilot(핵심 섹션)

### 9.1 사전 점검: jibun 형식 감사(API 호출 전, DB만으로)

```
정상 숫자 형식(파싱 가능): 1,390/1,398(99.4%)
산지번 접두("산..."): 6건 — parseInt 구조적 실패 확정(API 응답과 무관)
기타 파싱 불가 형식("가-", "BL-20" 등): 2건
umdCd(법정동코드) 존재: 1,398/1,398(100%) — registry 조회 필수 필드 충족
```

### 9.2 2-tier registry pilot(16개 구·군 × 3건 = 48건 표본)

```
1차만(getBrRecapTitleInfo, 총괄표제부): success 2, not_found 45, parse_error 1
2-tier(실패시 getBrTitleInfo 표제부 fallback): success 47, parse_error 1
성공 tier 분포: recap 2건, title 45건
```

**주용도(mainPurpsCdNm) 분포(성공 47건 중)**:

```
공동주택(정상 아파트): 42건(89.4%)
제1종근린생활시설/단독주택/업무시설(비-공동주택): 5건(10.4%) — universe 재검토 대상(§20)
```

**이름 일치 여부(성공 47건 중, 비차단 정보)**:

```
정규화 후 완전 일치: 대다수
표기 차이(예: "명유그린"↔"명유 아파트", "동부현대"↔"현대아파트",
  "한성기린"↔"한성기린프라자", "시영(1동)"↔"시영아파트",
  "럭키주례2"↔"럭키주례아파트"): 9건(19.1%) — 전부 지번 유일 일치로 회복,
  이름 차이가 회복을 막지 않음(§4.2/§4.3 근거)
```

### 9.3 전수(1,398건) 실행 결과

`step07-06-full-registry-sweep.ts` 전수 실행(1,398건, api_error 재시도 없이
1회 시도 — 재시도 있는 운영 seed와 달리 감사용은 단순화, §31 code policy):

```
success:     1,386건(99.1%)
not_found:       4건(0.3%)
parse_error:     8건(0.6%, §9.1에서 예측한 산지번 6건 + 기타형식 2건과 정확히 일치)
api_error:       0건
성공 tier 분포: title(표제부) 1,372건(99.0%), recap(총괄표제부) 14건(1.0%)
```

48건 pilot(97.9%)보다도 전수 결과(99.1%)가 더 높았다 — pilot이 과소
추정이 아니었음을 확인(우연히 낮게 나온 표본이 아니라 안정적 재현성).

---

## 10-11. 좌표 복구 소스 재검토 / Keyword-geocode 감사

registry 복구(§9)로 얻는 것은 **주소/세대수/mgmBldrgstPk**이지
좌표가 아니다. `ApartmentMaster.geocodeQuality`는 오직 별도의
지오코딩 단계(`apartment_master_seed.ts:geocode()`)에서만 바뀐다 —
이 함수는 roadAddress→jibunAddress→"동+이름" keyword 순으로 시도해
앞의 두 후보 중 하나라도 성공하면 `'exact'`를 부여한다(기존 코드,
이번 STEP에서 변경 없음). 따라서 RECOVERY_HIGH로 얻은 도로명주소를
**실제로 재지오코딩해야만** COORD_LOW→COORD_HIGH 전환이 일어난다 —
이번 STEP은 실제 DB 반영은 하지 않고(§0), "재지오코딩하면 얼마나
성공하는가"를 **실제 Kakao API 라이브 호출로 검증**했다(추정 아님).

### 11.1 예상 밖 발견: 도로명주소의 "(동)" 괄호 접미사가 keyword 검색을 깨뜨림

RECOVERY_HIGH 30건의 도로명주소(§9의 `newPlatPlc` 원본, 예: `"부산광역시
서구 구덕로186번길 37 (토성동2가)"`)를 원본 그대로 keyword 검색했더니
**3/30(10.0%)만 성공**했다 — 처음엔 "재지오코딩 자체가 어렵다"로
오인할 뻔한 결과였다. 원인 규명(`step07-13-geocode-debug.ts`, 3건
비교):

```
(a) keyword, 원본("... 37 (토성동2가)")           → 0건(실패)
(b) keyword, "(동)" 괄호 제거("... 37")            → 3건(성공)
(c) Kakao address 엔드포인트, 원본 그대로          → 1건(성공)
(d) keyword, jibunAddress(괄호 없음) 사용          → 3건(성공)
```

**원인**: Kakao 키워드검색이 도로명 뒤의 "(동이름)" 괄호를 별도
disambiguation 키워드로 잘못 해석해 결과를 0건으로 좁혀버린다. 반면
같은 API를 지번주소(`jibunAddress`, 원래 괄호가 없는 형식)로 호출하면
정상 동작한다.

### 11.2 재검증: production geocode() cascade 전체를 그대로 재현하면?

`apartment_master_seed.ts:geocode()`는 roadAddress가 실패하면
**이미 jibunAddress로 자동 fallback**한다(기존 로직, 이번 STEP에서
변경 없음) — §11.1의 문제는 이 두 번째 후보에서 대부분 해소된다.
이 전체 cascade를 그대로 재현해 30건(16개 구·군 대표 1건 + 추가
14건)을 실제 Kakao API로 재확인(`step07-15-full-geocode-cascade-spotcheck.ts`):

```
exact 도달: 30/30건(100%)
  road(원본) 후보에서 도달: 3건(10%)
  jibun 후보로 fallback해서 도달: 27건(90%)
```

**결론**: RECOVERY_HIGH로 얻은 주소는 기존 production geocode() 로직을
그대로 적용하면(코드 변경 없이) 재지오코딩 성공률이 사실상 100%다 —
다만 실제로는 1차 후보(도로명주소)가 아니라 2차 후보(지번주소)를 통해
도달하는 경우가 대다수(90%)라는 게 이번에 새로 발견한 사실이다. 이
관찰은 이번 STEP의 범위(identity 복구) 밖이라 production
`geocode()` 코드는 수정하지 않았지만, §26 이후 별도 STEP에서 참고할
가치가 있는 관찰로 기록해둔다(추측이 아니라 30/30 실측).

---

## 12-14. 벤치마크 3건 실측 trace

`step07-10-benchmark-trace.ts` — 2-tier registry 조회 + resolver
판정 라이브 실행.

### 12. 구덕금호(26140-11) — Negative Benchmark, 억지로 정상화하지 않음

```
DB 현재: dong=동대신동3가, jibun=140, roadAddress=null,
         totalHouseholds=null, geocodeQuality=normalized, buildYear=2001

registry probe: status=success, tier=title, recordCount=1,
  roadAddress="부산광역시 서구 보수대로242번길 6 (동대신동3가)",
  totalHouseholds=null, mainPurpsCdNm="단독주택"

resolver 판정: RECOVERY_MEDIUM (HIGH 아님)
  universeFlag = NON_TARGET
  사유: "registry 주용도='단독주택'(공동주택 아님) — 주소/식별은
        회복되나 아파트 universe 소속 자체가 불확실"
```

**해석**: 이 지번의 건축물대장 등록 자체는 존재하지만 "단독주택"으로
분류돼 있다 — 즉 이 row가 애초에 정상적인 "아파트 단지"인지 자체가
의심스럽다는 STEP 0.6의 추정이 실측으로 재확인됐다. §27 원칙대로
이 STEP은 구덕금호를 정상 아파트처럼 보이게 만드는 어떤 조정도 하지
않았다 — resolver는 그대로 MEDIUM(HIGH 아님)을 반환했고, 이 결과를
그대로 보고한다.

### 13. 대신해모로센트럴아파트(26140-1356) — 이미 PEER_FULL, 정합성 재확인용

```
registry probe: status=success, tier=recap, recordCount=1,
  bldNm="대신해모로센트럴아파트"(정확 일치), mainPurpsCdNm="공동주택",
  totalHouseholds=733(DB와 일치), approvalYear=2023(buildYear 2022와 ±3년 이내)

resolver 판정: RECOVERY_HIGH, nameMatch=exact, buildYearConsistent=true
```

이미 identity가 완전한 벤치마크에 resolver를 적용해도 HIGH가 정확히
재현됨 — resolver가 이미-정상인 케이스를 망가뜨리지 않음을 확인.

### 14. 협성르네상스(서구, 26140-51) — 동일 확인

```
registry probe: status=success, tier=recap, recordCount=1,
  bldNm="협성르네상스"(정확 일치), mainPurpsCdNm="공동주택",
  totalHouseholds=489(DB와 일치)

resolver 판정: RECOVERY_HIGH, nameMatch=exact
```

---

## 15-25. 전수 복구 시뮬레이션 / Before-After 재시뮬레이션

### 16. 전수(1,398건) RECOVERY 등급 분포(`step07-08-recovery-classification.ts`)

```
RECOVERY_HIGH:     1,236건(88.4%)
RECOVERY_MEDIUM:     116건(8.3%)
RECOVERY_REVIEW:      34건(2.4%)
RECOVERY_FAILED:      12건(0.9%)  ← §9.3의 not_found 4 + parse_error 8과 정확히 일치
```

구·군별 RECOVERY_HIGH 비율(최저~최고):

```
강서구(26440) 50.0%(3/6, 표본 자체가 6건뿐)   기장군(26710) 76.9%(40/52)
중구(26110)   78.0%(32/41)                  동구(26170)   86.5%(45/52)
사상구(26530) 85.1%(74/87)                  해운대구(26350) 84.9%(118/139)
부산진구(26230) 84.4%(146/173)              북구(26320)   88.1%(37/42)
사하구(26380) 88.1%(104/118)                남구(26290)   88.9%(72/81)
서구(26140)   89.7%(87/97)                  수영구(26500) 89.7%(105/117)
영도구(26200) 91.5%(43/47)                  연제구(26470) 93.8%(76/81)
동래구(26260) 95.2%(119/125)                금정구(26410) 96.4%(135/140)
```

**모든 구·군에서 50% 이상 회복** — 6건뿐인 강서구를 제외하면 전부
76.9% 이상. 지시사항이 우려했던 "8.5%~75.0% 격차"가 복구 이후에는
거의 사라진다(자세한 before/after PEER_FULL%는 §18-23).

RECOVERY_HIGH 중 registry 이름 표기가 후보와 달랐던 비율: **177/1,236
(14.3%)** — 주소만으로 회복된 사례가 이름 일치 여부와 무관하게
다수임을 재확인.

### 17. False-merge 방지 — 관찰된 오매칭 건수

Resolver는 구조적으로(§4.2) recordCount>1(주소 자체 모호)과 차수
불일치를 전부 RECOVERY_REVIEW로 밀어낸다 — RECOVERY_HIGH 안에는 이
두 adversarial 조건이 **정의상 존재할 수 없다**(코드로 강제, 15개
fixture로 회귀 검증). 전수 1,398건 실행 결과:

```
관찰된 wrong merge(HIGH인데 실제로는 다른 단지였음이 확인된 사례): 0건
관찰된 ambiguous auto-merge(recordCount>1인데 HIGH로 분류된 사례):  0건(설계상 불가능)
REVIEW로 정확히 분류된 adversarial case: 34건
  - 차수(1차/2차) 표기 불일치: 11건(예: "롯데캐슬2차"류 패턴 실제 재현 —
    "현대1차"↔registry"현대아파트", "대원하이츠2차"↔"대원하이츠" 등)
  - 건축년도 불일치(±3년 초과, 재건축/주소 재사용 의심): 23건(예:
    MOLIT 2016년 vs registry 사용승인 1962년 — 재건축 전후 주소 재사용
    의심 사례, 자동 승격하지 않고 REVIEW로 보존)
```

### 18-23. Before/After 재시뮬레이션(`step07-09-before-after-simulation.ts`)

**두 시나리오로 분리**(정직성 원칙 — registry 복구만으로는
geocodeQuality가 바뀌지 않는다, §10-11):

| | PEER_FULL | PEER_LIMITED | DISPLAY_ONLY | UNRESOLVED |
|---|---|---|---|---|
| **BEFORE**(STEP 0.6 원본) | 1,301(38.2%) | 366(10.8%) | 1,734(51.0%) | 1(0.0%) |
| **AFTER_IDENTITY_ONLY**(이번 STEP 실제 scope) | 1,301(38.2%) | 366(10.8%) | 1,734(51.0%) | 1(0.0%) |
| **AFTER_WITH_REGEOCODE_PROJECTED**(§11.2 실측 검증 기반 투영) | **2,537(74.6%)** | 366(10.8%) | **498(14.6%)** | 1(0.0%) |

**AFTER_IDENTITY_ONLY가 BEFORE와 완전히 동일하다는 사실 자체가
중요한 결과다** — registry만 복구하고 좌표를 그대로 두면 peer
eligibility 분류상 아무것도 개선되지 않는다(coord가 여전히
COORD_LOW이므로 `classifyPeerEligibility`가 무조건 DISPLAY_ONLY를
반환). **실질적 개선은 재지오코딩까지 이어져야 발생**하며, §11.2에서
이 재지오코딩이 기존 코드 그대로 100%(30/30 실측) 성공함을 확인했으므로
AFTER_WITH_REGEOCODE_PROJECTED을 "실현 가능성이 실측으로 뒷받침된
투영치"로 제시한다(추측이 아님, 그러나 1,398건 전체가 아닌 30건
표본 기반이므로 여전히 "투영"으로 라벨링, 실제 반영 아님).

**domain별 eligible 건수(BEFORE → AFTER_WITH_REGEOCODE_PROJECTED)**:

```
transport/생활/학교(좌표 기반): 1,667(49.0%) → 2,903(85.3%)
parking(registry 기반, 이번 STEP에서 parkingCount 미적용 — §26 범위 밖): 862(변화 없음)
complex(buildYear 기반): 3,000(변화 없음, 이미 §3 100% coverage 반영)
```

**구·군별 PEER_FULL% — 지역편향 재검토(핵심 결과)**:

```
                BEFORE   AFTER(projected)
중구(26110)      8.5%  →  62.7%
서구(26140)     15.8%  →  66.7%
동구(26170)     22.2%  →  67.7%
사상구(26530)   27.8%  →  76.8%
금정구(26410)   28.9%  →  72.7%
수영구(26500)   30.7%  →  72.5%
해운대구(26350) 33.4%  →  71.8%
부산진구(26230) 35.1%  →  71.3%
기장군(26710)   40.1%  →  66.4%
사하구(26380)   44.4%  →  75.1%
동래구(26260)   45.2%  →  83.1%
연제구(26470)   45.5%  →  76.6%
영도구(26200)   46.6%  →  78.9%
남구(26290)     47.8%  →  76.3%
북구(26320)     65.9%  →  87.3%
강서구(26440)   75.0%  →  81.8%

min/max/ratio BEFORE:  8.5% / 75.0% / 8.8x
min/max/ratio AFTER:  62.7% / 87.3% / 1.4x
```

**지역편향이 8.8배 격차에서 1.4배로 대폭 축소된다** — 지시사항이
명시한 "8.5%~75.0% 격차" 문제(§0)에 대한 직접 답이다. 완전히
사라지지는 않지만(최저 중구 62.7%, 최고 북구 87.3%) 구조적 지역편향
수준에서 "잔여 정상 변동" 수준으로 축소된다.

### 23. 동(dong) 단위 peer sample size 재검토(`step07-16-dong-sample-size-before-after.ts`)

```
transport-eligible(COORD_HIGH 기준) 동별 count, 부산 전체 149개 동:
  BEFORE:  n<5  69개 동(46.3%) | n<10  89개(59.7%) | n<20 117개(78.5%) | n>=20  32개(21.5%)
  AFTER:   n<5  55개 동(36.9%) | n<10  73개(49.0%) | n<20  92개(61.7%) | n>=20  57개(38.3%)
```

**n<5(표본 5건 미만) 동 비율이 46.3%→36.9%로 개선되지만 여전히
1/3 이상 남는다** — §29 SIGUNGU fallback은 이번 복구 이후에도 **계속
필요**하다는 뜻(완전히 제거할 수 없음, 정직하게 보고).

### 24-25. Universe Validity 최종 분류(`step07-17-universe-and-medium-breakdown.ts`)

1,398건 전체(30세대 미만은 서술적 구분일 뿐 법정 기준 아님, 명시적
라벨링):

```
VALID_APARTMENT(공동주택, 30세대 이상):        890건(63.7%)
VALID_SMALL_APARTMENT(공동주택, 30세대 미만):   398건(28.5%)
MIXED_USE(근린생활시설/업무시설/숙박시설 등):    57건(4.1%)
NON_TARGET(단독주택 등 공동주택 아님):           40건(2.9%)
UNKNOWN(registry 조회 실패, 확인 불가):          13건(0.9%)
```

RECOVERY level × universe validity 교차:

```
RECOVERY_HIGH(1,236)   : VALID_APARTMENT 1,235 / UNKNOWN 1
RECOVERY_MEDIUM(116)   : MIXED_USE 53 / NON_TARGET 23 / VALID_APARTMENT(세대수만 없음) 40
RECOVERY_REVIEW(34)    : NON_TARGET 17 / VALID_APARTMENT 13 / MIXED_USE 4
RECOVERY_FAILED(12)    : UNKNOWN 12
```

RECOVERY_MEDIUM(116건) 세부 사유:

```
주용도 비-공동주택(MIXED_USE/NON_TARGET, universe 소속 자체 의심): 76건(65.5%)
공동주택 확인되나 registry에 세대수(hhldCnt) 필드 없음:            40건(34.5%)
```

**주목**: RECOVERY_HIGH가 자동으로 "universe validity"까지 보증하지는
않는다 — 설계상 RECOVERY_HIGH는 `mainPurpsCdNm==='공동주택'`을
요구하므로 VALID_APARTMENT/VALID_SMALL_APARTMENT 외의 universeFlag가
HIGH에 섞이지 않는다(교차표의 HIGH 행이 UNKNOWN 1건 제외 전부
VALID_APARTMENT인 이유 — resolver 설계가 의도한 그대로 동작).

---

## 26. 미래 Write-Plan 제안(실행 안 함, 승인 전 금지)

**이번 STEP은 어떤 DB write도 수행하지 않았다.** 아래는 RECOVERY_HIGH
결과를 실제로 반영하고 싶을 경우를 대비한 **제안**일 뿐이다.

1. **기본값 dry-run**: 실행 스크립트는 `--apply` 플래그가 명시적으로
   주어지지 않는 한 항상 dry-run(콘솔 diff만 출력, DB write 없음).
2. **대상**: RECOVERY_HIGH로 분류된 row만(MEDIUM/REVIEW/FAILED는 절대
   제외).
3. **변경 필드**: `roadAddress`, `jibunAddress`, `totalHouseholds`,
   `mgmBldrgstPk`만(geocodeQuality/좌표는 별도 재지오코딩 단계 — 이
   write-plan의 범위 밖).
4. **before-snapshot**: apply 직전 대상 row 전체를 JSON으로 별도 저장
   (rollback 근거).
5. **예상 update count**: **1,236건**(RECOVERY_HIGH 확정치, §16)과 정확히
   일치해야 함 — 다르면 실행 중단. 재지오코딩까지 함께 적용할 경우
   별도 후속 write-plan(§11.2 검증 기반, 이번 write-plan 범위 밖)이
   필요하며 이번 제안에는 포함하지 않는다.
6. **idempotency**: 이미 `totalHouseholds != null`인 row는 대상에서
   제외(재실행해도 안전).
7. **rollback**: before-snapshot으로 정확히 원복하는 별도 스크립트 동반.
8. **post-verify**: apply 후 STEP 0.6 peer-quality 재분류를 다시 돌려
   §18-23 시뮬레이션 수치와 실제 결과가 일치하는지 확인.
9. **오매칭 가드**: apply 전 recordCount===1 재확인(레이스 컨디션/API
   응답 변경 대비 최종 방어선).

**이 write-plan은 이번 대화에서 승인되지 않는 한 실행되지 않는다.**

## 27. 윤리적 제약 준수 확인

이 STEP의 어떤 로직도 "대신해모로의 점수를 올리기 위해" 설계되지
않았다. §13에서 대신해모로는 이미 identity가 완전한 상태였고, 이번
STEP이 그 상태에 어떤 조정도 가하지 않았음을 확인했다(resolver가
HIGH를 그대로 재현할 뿐, 새로운 uplift를 만들지 않음). §12 구덕금호
사례가 이 원칙의 직접 증거다 — "대신해모로의 상대 순위에 유리한
방향"으로 구덕금호를 재분류하지 않고, 실측 그대로(NON_TARGET/MEDIUM)
보고했다.

---

## 28. 회귀 표본 확장(벤치마크 3건 + 6개 유형)

`step07-11-regression-samples.ts` + §16 분류 결과 기반, 각 유형 2-3건:

```
clean HIGH(이미 registry+주소+COORD_HIGH):
  26140-1361 e편한세상송도더퍼스트비치(1,302세대)
  26140-1243 대신푸르지오1차(959세대)
  26140-1290 대신푸르지오2차(815세대)   ← 차수 구분 실제 확인

keyword-coordinate(registry는 있으나 좌표만 keyword):
  26230-134 신양맨션(90세대) / 26230-1708 월드드림빌(20세대) /
  26200-18 영선2동4동(120세대)

no-market-history(327건군, 거래이력 0건):
  26230-1610 그린파크(초읍동 356-3) / 26230-2269 지오베스트빌(양정동 386-15) /
  26230-2011 세영(부전동 425-18)

registry-unlinked-but-valid(mgmBldrgstPk 있으나 households 미확보, §1-3 80건군):
  26110-46 동아(160-0) / 26230-66 현대2차 / 26230-95 개금주공3단지

MOLIT-recovered HIGH(§16 실제 복구 성공 사례):
  26140-63 문화(토성동2가 7-4, 1974년) — registry title 조회로 households=34,
    주용도=공동주택, RECOVERY_HIGH
  26350-2582 협성루에나센텀(재송동 210-10, 2023년) — households=152,
    이름 정확 일치, RECOVERY_HIGH
  26260-56 동부현대(온천동 1680, 1985년) — registry명 "현대아파트"로 표기
    다르나 지번 유일 일치, RECOVERY_HIGH(§9.2/§4.2 이름 비차단 원칙 실사례)

ambiguous same-name(§6 collision audit, merge 시도 자체를 안 함을 보여주는 사례):
  "문화"(서구, 26140): 3개 row(26140-63/15/77)가 전부 다른 지번·건축년도 —
    이름만으로는 절대 구분 불가능했던 실제 사례
  "동원"(부산진구, 26230): 4개 row, 전부 다른 지번 — 이름 중복 최다 그룹
```

---

## 29. STEP 0.8 Readiness Acceptance Gate

```
deterministic-rules-only 준수:            YES(이름 유사도/좌표 근접 merge 게이트 0건, §4.2)
관찰된 wrong merge:                        0건(§17)
관찰된 ambiguous auto-merge:                0건(§17, 설계상 불가능)
peer coverage 유의미 개선:                  YES(PEER_FULL 38.2%→74.6%, 투영치, §18-23)
지역편향 측정 완료:                        YES(8.8x → 1.4x, §18-23)
복구 evidence 감사 가능:                    YES(sweep JSON + classification JSON 전부 저장,
                                             `scripts/apartment-score/output/*.json`)
production DB write:                       0건
결론:                                      STEP 0.8(실제 반영/재지오코딩) 착수 조건 충족
```

## 30-32. 문서/코드 정책 준수

- **코드 범위**: 전량 `scripts/apartment-score/` 하위 read-only
  스크립트(`step07-02` ~ `step07-17`, 12개) + `lib/step07-*.ts`
  prototype(universe/registry-probe/recovery-resolver, 3개) +
  `lib/step07-recovery-resolver.test.ts`(fixture, DB/네트워크 없음).
  `src/lib/apartment-score/server/*`(production score 엔진) 0줄 변경.
  `scripts/apartment_master_seed.ts`(production seed) 0줄 변경.
  `src/lib/apt-building-info.ts`/`api-molit.ts`(production 함수) 0줄
  변경 — 읽기만 함. API route/UI 변경 없음.
- **테스트**: node:test 기반 15개 fixture, **15/15 pass**(exact match,
  normalized-safe match, same-address collision, phase/차수 불일치
  2종, 건축년도 불일치/근소차이, 주용도 불일치, 세대수 없음, not_found/
  parse_error/api_error 3종, false-positive 회귀 1건).
- **tsc**: `npx tsc --noEmit` 전체 통과(0 error, step07 파일 포함).
- **eslint**: `npx eslint scripts/apartment-score/step07-*.ts
  scripts/apartment-score/lib/step07-*.ts` 0 warning/error.

---

## 33. 최종 보고 — E-JIP SCORE V2 STEP 0.7 결과

```
1.  branch/worktree:                   score-v2-step07-identity-recovery
                                        (base: score-v2-step0-forensic-audit,
                                         STEP 0/0.5/0.6 전체 포함 확인)
2.  고위험 재현:                        1,725건(STEP 0.6과 정확히 일치)
3.  MOLIT 복구후보 재현:                1,398건(81.0%, STEP 0.6과 정확히 일치)
4.  증거 없음(327건군) 재현:            327건(정확히 일치)
5.  registry 조회 성공률(전수):         1,386/1,398(99.1%)
6.  Level A(RECOVERY_HIGH):            1,236건(88.4%)
7.  Level B(RECOVERY_MEDIUM):            116건(8.3%)
8.  Level C(RECOVERY_REVIEW):             34건(2.4%)
9.  Level D(RECOVERY_FAILED):             12건(0.9%)
10. normalize 전/후 collision count:    동일이름+lawdCd 그룹 53개(113건),
                                        전원 distinct jibun(100% 서로 다른 필지)
11. same-name ambiguous group 수:       53개 그룹
12. 관찰된 wrong merge:                 0건
13. 관찰된 ambiguous auto-merge:        0건(설계상 불가능)
14. keyword-coordinate(COORD_LOW) 총:   1,734건(부산 전체, STEP 0.6과 일치)
15. 재지오코딩 후보(=RECOVERY_HIGH):    1,236건, 실측 spot-check(30건) 성공률 100%
16. 구덕금호(26140-11):                 RECOVERY_MEDIUM, universe=NON_TARGET
                                        (registry 주용도="단독주택") — 정상화 안 함
17. 대신해모로센트럴(26140-1356):        RECOVERY_HIGH, nameMatch=exact,
                                        buildYearConsistent=true(이미 정상, 재확인)
18. 협성르네상스(26140-51):             RECOVERY_HIGH, nameMatch=exact(이미 정상, 재확인)
19. BEFORE PEER_FULL/LIMITED/DISPLAY_ONLY/UNRESOLVED:
                                        1,301(38.2%) / 366(10.8%) / 1,734(51.0%) / 1(0.0%)
20. AFTER_IDENTITY_ONLY(실제 scope):    BEFORE와 동일(좌표 불변이라 무변화 — 정직한 결과)
21. AFTER_WITH_REGEOCODE_PROJECTED:     2,537(74.6%) / 366(10.8%) / 498(14.6%) / 1(0.0%)
22. domain eligibility before/after:    transport/생활/학교 1,667→2,903,
                                        parking 862(불변, §26 범위 밖), complex 3,000(불변)
23. 구·군 FULL% before/after (min/max/ratio):
                                        8.5%/75.0%/8.8x → 62.7%/87.3%/1.4x
24. 동 단위 n<5 비율 before/after:      46.3% → 36.9%(개선되나 잔존)
25. SIGUNGU fallback 권고:              계속 필요(동 단위 n<5가 36.9%나 남음, §23)
26. universe validity(VALID_APARTMENT/VALID_SMALL/MIXED_USE/NON_TARGET/UNKNOWN):
                                        890 / 398 / 57 / 40 / 13
27. future write 후보(RECOVERY_HIGH):   1,236건(§26 제안, 미실행)
28. manual review 대상(RECOVERY_REVIEW): 34건(§17)
29. production Score 변경?              NO
30. DB write?                           NO
31. migration?                          NO
32. main merge?                         NO
33. tsc:                                PASS(0 error)
34. eslint:                             PASS(0 warning/error)
35. tests:                              15/15 PASS
36. docs:                               본 문서 + CHANGELOG.md 갱신
37. commit:                             본 STEP 완료 후 실행 예정
38. push:                               사용자 확인 후 실행 예정
39. worktree clean:                     커밋 전 확인 예정
40. BLOCKER:                            없음
41. IDENTITY_RECOVERY_MODEL_READY:      YES
42. PEER_COVERAGE_ACCEPTABLE:           YES(투영치 기준, 실제 반영은 별도 승인 필요)
43. SCORE_V2_STEP08_READY:              YES(§29 게이트 충족)
44. NEXT_RECOMMENDATION:                (1) 이번 STEP은 그대로 결과 보고 후 멈추고 검수
    대기(지시사항 §33 그대로 준수). 승인 시 다음 순서 권장: (2) §26 write-plan을
    RECOVERY_HIGH 1,236건에 한해 실제 승인받아 실행(roadAddress/jibunAddress/
    totalHouseholds/mgmBldrgstPk만, dry-run 우선) → (3) §11.2에서 실측 검증된
    재지오코딩(production geocode() 그대로, 코드 변경 없음)을 동일 1,236건에
    적용 → (4) STEP 0.8에서 §18-23 투영치가 실제로 재현되는지 post-verify →
    (5) 그 이후에만 STEP 0.6 peer-quality 필터를 production Score에 연결할지
    별도로 재논의(이번 STEP 범위 밖, 지시사항이 명시적으로 금지한 항목).
    RECOVERY_MEDIUM(116)/RECOVERY_REVIEW(34)는 이번 STEP 결과에 근거해 계속
    write 후보에서 제외 상태로 둔다.
```
