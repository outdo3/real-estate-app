# OFFICETEL V1 STEP 1 — identity contract + additive schema

- 상태: **완료** (사용자 승인 범위 내 additive migration Production 적용)
- Production DB write(데이터): **0건** — 테이블 3개 생성만, INSERT/UPDATE/DELETE 없음
- 기존 테이블 ALTER: **0건** / destructive SQL: **0건**
- 이번 STEP에서 하지 않은 것: master/history INSERT · backfill · cron · UI · Search/Map/Detail · Stats · Compare · Record High · Score · Finance · 생활형숙박시설

## 1. 의미 정정 (선행 감사 표현 수정)

선행 감사에서 *"`etcPurps`에 '오피스텔'이 있으면 주거용 오피스텔을 official하게 판별할 수 있다"* 고
적었던 표현은 **사용하지 않는다**. 건축물대장으로 확인 가능한 것은

> **건축물대장상 오피스텔 용도**

까지다. 다음은 **절대 추론하지 않는다**: 실제 주거용 사용 여부 · 세법상 주거용 여부 ·
주택수 포함 여부 · 주택법상 주택 여부 · LTV/DSR 적용 여부 · 취득세 유형.

DB 필드명에도 `residentialOfficetel` 같은 근거 없는 의미를 넣지 않았다. 저장하는 것은
원본 그대로의 `buildingRegistryMainPurpose`(mainPurpsCdNm) / `buildingRegistryEtcPurpose`(etcPurps)뿐이다.

## 2. Source limitations — 이 설계 전체를 규정하는 제약

| 항목 | 아파트 | **오피스텔** |
| --- | --- | --- |
| 상세본 서비스 | `RTMSDataSvcAptTradeDev` 존재 | **없음** (`RTMSDataSvcOffiTradeDev` → `NO_OPENAPI_SERVICE_ERROR` 실측) |
| canonical source id | `aptSeq` | **없음** |
| 등기일자 `rgstDate` | 2023-01 이후 계약부터 제공 | **없음** |
| 동정보 `aptDong` | 등기 완료 건 한정 제공 | **없음** |
| 도로명 | 제공 | **없음** (건축물대장 `newPlatPlc`로만 확보) |
| SALE 취소 필드 | `cdealType`/`cdealDay` | `cdealType`/`cdealDay` **있음** |
| RENT 취소 필드 | 없음 | **없음** |

**canonical source id가 없다**는 것이 이 STEP의 모든 설계 결정을 지배한다.

## 3. Identity contract

실측(부산 16구 × 3개월, SALE 724행 / RENT 7,591행):

| 지표 | SALE | RENT |
| --- | ---: | ---: |
| 한 지번에 이름 2개 이상 | 0.00% | 0.06% |
| 같은 구에서 같은 이름이 지번 2개 이상 | 0.00% | 1.33% |
| **부산 전체 동명 건물 충돌** | 0.34% | **4.47%** |

→ **주소는 강한 identity, 이름은 아니다.** 이름 단독 매칭은 4.47% 확률로 다른 건물을 집는다
(실제: "드림빌리지"가 중구/서구/사하구 3개 지번, "KH마이우스"가 3개 지번).

PRIMARY identity components: `sggCd` · 정규화 `umdNm` · 정규화 `jibun` · `buildingDong`(있을 때).
`offiNm`은 **display / 보조 검증 필드**이며 identity가 아니다.

금지(구조적으로 불가능하게 설계): name-only match · loose substring · same-dong fallback ·
first match · 다른 지번 fallback · 다른 오피스텔 fallback · 약한 identity로 strong identity overwrite.

## 4. canonicalKey format

```
OFFI:{sggCd}:{정규화 법정동}:{본번}-{부번}:{정규화 동 | _}

예) OFFI:26350:좌동:1458-5:_        (building-level, 동 정보 없음)
    OFFI:26290:대연동:62-14:나동     (동 단위)
```

구현: `src/lib/officetel/identity.ts` — 순수 함수, DB/네트워크 없음, 23개 테스트로 고정.

- **deterministic** — 같은 입력이면 항상 같은 문자열
- **stable** — `offiNm`(표시명)이 바뀌어도 키가 변하지 않는다
- **재생성 가능** — DB row id와 무관하게 원천 행에서 다시 계산
- **이름 비의존** — 이름이 키에 들어가지 않는다(테스트로 검증)

정규화 규칙:

| 성분 | 규칙 | 근거 |
| --- | --- | --- |
| `umdNm` | 공백만 제거 | 접미사를 떼면 "좌동"→"좌"가 되고 "일광읍 삼성리" 복합 표기가 깨진다 |
| `jibun` | 본번/부번을 정수 파싱 후 `{본번}-{부번}` | "62-14"/"62 - 14"/"0062-0014"를 동일화. 건축물대장 bun/ji 정수 표현과 일치 |
| 부번 없음 | `-0` 부여 (`18` → `18-0`) | 세그먼트 수 고정 → 파싱 안정 |
| **"산" 지번** | **파싱하지 않고 UNRESOLVED** | 건축물대장이 platGbCd로 대지(0)/산(1)을 구분한다. 그 구분을 키에 담지 않으면 다른 필지를 같은 건물로 볼 수 있다 |
| `buildingDong` | 공백 제거, 없으면 `_` | 빈 문자열은 "정규화 결과가 빈 dong"과 "dong 없음"을 구분 못 한다. `_`는 정규화 통과 문자가 아니라 실제 동명과 충돌 불가 |

필수 성분이 없거나 지번 파싱 실패 시 **키를 만들지 않는다**(`{ok:false, reason}`).
"잘못된 master 연결보다 unresolved가 낫다"를 함수 레벨에서 강제한다.

## 5. buildingDong semantics

**오피스텔은 "단지"가 아니라 "건물(+동)" 단위다.**

실측 근거: 남구 대연동 62-14는 원천 표시명이 **"가동" / "나동"** 두 개로 나뉘어 나오고,
건축물대장 표제부도 같은 지번에서 `bldNm=" "`(공백) / `dongNm="나동"`을 반환한다.
**한 지번에 복수 동이 실제로 존재하며 절대 한 건물로 합치지 않는다.**

계약:

- `buildingDong`이 원천/건축물대장에서 **명확히 존재**하면 → 동 단위 canonicalKey
- 명확히 없으면 → building-level canonicalKey (`_`)
- **추측해서 채우지 않는다.** 모르면 building-level로 둔다

**알려진 리스크(문서화된 미해결):** 처음에 동 정보 없이 building-level 키로 적재된 건물이
나중에 건축물대장에서 동이 확인되면 키가 바뀐다. 완화책은 history가 `canonicalKey`(필수) +
`officetelMasterId`(nullable) 두 축을 갖는 구조라, master 재해석이 기존 history 행을
손상시키지 않는다는 점이다. 재해석 절차 자체는 다음 STEP에서 설계한다.

## 6. Master schema — `officetel_masters`

건물(+동) 단위. 주요 결정:

- `canonicalKey` **UNIQUE** — identity의 유일한 기준
- 규모는 **`hoCnt`(호수)** 기준. 오피스텔은 `hhldCnt`(세대수)가 **항상 0**이다(실측 3/3).
  **"세대수"라는 필드명/표현을 쓰지 않는다.**
- 건축물대장 값은 표제부(`getBrTitleInfo`) 원본을 그대로 보관
- `latitude`/`longitude`는 **nullable** — 안전한 official/기존 geocoding 경로로 확보된
  경우에만 채운다. **추정 좌표 금지**

인덱스(과도한 인덱스 금지):

| 인덱스 | 목적 |
| --- | --- |
| `UNIQUE(canonical_key)` | identity |
| `(sgg_cd, normalized_umd_nm, normalized_jibun)` | 지역 조회. `sggCd` 단독과 `sggCd+umd`는 이 인덱스의 **prefix로 커버**되므로 별도 인덱스를 만들지 않았다 |
| `(normalized_name)` | **검색 보조 전용 — identity fallback이 아니다** |

## 7. SALE history — `officetel_trade_histories`

원천 `RTMSDataSvcOffiTrade` 행을 **1:1로 보존**한다.

**원천에 없는 필드를 만들지 않았다**: `rgstDate` · `aptDong` · `aptSeq` · `offiSeq`.
컬럼의 존재 자체가 없는 신뢰를 암시하기 때문이다.

자연키:

```
UNIQUE (canonical_key, deal_date, exclusive_area, deal_amount, floor, occurrence_index)
```

아파트 자연키를 복사하지 않은 이유: 아파트는 `groupKeyStr`에 `aptSeq`와 면적을 인코딩하지만,
오피스텔은 aptSeq가 없어 그 자리에 `canonicalKey`가 들어가고 면적은 키에 포함돼 있지 않아
**`exclusive_area`를 자연키에 명시**해야 한다.

`floor`를 **NOT NULL**로 강제한 이유: Postgres unique 제약은 NULL을 서로 다른 값으로 취급해
(NULL ≠ NULL) upsert 기반 중복방지가 깨진다. 층 파싱 불가 행은 **적재하지 않고 invalid로
제외**한다(값을 지어내지 않는다). 실측 표본에서 `floor` 결측은 0건이었다.

`exclusive_area`를 Decimal 그대로 자연키에 넣은 이유: 숫자 비교라 "31.56"과 "31.5600"이
자동으로 동일하게 취급된다. 문자열 인코딩 방식은 표기 흔들림이 곧 중복을 만든다.

## 8. SALE cancellation contract — **LIMITED**

원천에 `cdealType`/`cdealDay`가 있으므로 `dealCanceled`/`cancelDate`를 저장한다.

실측(부산 16구 × 3개월 SALE 724행):

| 항목 | 값 |
| --- | ---: |
| 취소 행 | 18 (2.49%) |
| 자연키 그룹 | 697 |
| 다행 그룹 | 21 (3.01%) |
| 유형 A(1행 취소) | 7 |
| **유형 B(uncanceled + canceled)** | **9** |
| 유형 C(둘 다 취소) / D(둘 다 정상) / E(3행+) | 0 / 6 / 6 |
| 독립 가정 시 B 기대값 | 1.0 |

**아파트에서 확인한 TYPE B 현상이 오피스텔에도 존재한다**(기대 대비 9배).

**결정적 차이: 오피스텔은 `rgstDate`가 없어 아파트처럼 TYPE B의 uncanceled 행을 등기로
검증할 수 없다.** 아파트는 "2023+ uncanceled 행 등기 완료 98.9~100% vs canceled 0건"이라는
증거로 uncanceled 행이 실거래임을 확정했지만, 오피스텔에는 그 증거 수단 자체가 없다.

따라서 V1 계약:

- cancellation source representation = **LIMITED**
- source 행을 **1:1 그대로 저장**
- **임의 병합/삭제/effective-canceled 처리 금지**
- **근거 없는 dedup 금지**
- **Record High 기능 구현 금지** (신고가 신뢰를 담보할 수 없다)

## 9. RENT history — `officetel_rent_histories`

**`dealCanceled` / `cancelDate` 컬럼을 의도적으로 두지 않았다.**

`RTMSDataSvcOffiRent` 응답에 취소 관련 필드가 전혀 없음을 **7,591행 실측**으로 확인했다.
이는 **"취소가 없다"가 아니라 "원천이 취소 필드를 제공하지 않는다"** 는 뜻이다.
있지도 않은 신뢰를 암시하는 컬럼(예: `dealCanceled=false` 고정값)을 만들지 않는다
(아파트 RENT와 같은 원칙).

`useRenewalRight`는 **nullable Boolean** — 원천 `useRRRight`는 미기재가 대부분(98.5%)이고
"미사용"이라는 값이 존재하지 않으므로 `false`를 쓰지 않는다. null = UNKNOWN.

자연키:

```
UNIQUE (canonical_key, deal_date, exclusive_area, deposit, monthly_rent, floor, occurrence_index)
```

보증금·월세를 둘 다 넣어 전세(월세 0)와 월세를 구분한다.

## 10. occurrenceIndex contract

- 같은 자연키 그룹 내 **원천 등장 순서(0부터)**
- 한 `(lawdCd, dealYmd)` 응답 배열 **안에서만** 계산한다. `dealYmd`는 항상 그 거래
  자신의 계약연월과 같으므로 자연키 충돌은 언제나 같은 fetch 배치 안에서만 일어난다 —
  배치를 넘어선 충돌은 구조적으로 발생하지 않는다
- pagination 취약성: 부산 구·월당 최대 507행이라 `numOfRows=1000`이면 단일 페이지로 끝나
  순서가 흔들릴 여지가 사실상 없다. 순서가 바뀌어도 그룹 내 행들은 자연키 성분이 전부
  동일하므로 **저장된 집합 자체는 동일하다**
- 구현: `src/lib/officetel/natural-key.ts` (순수 함수)

## 11. Area contract

원천이 확정해 주는 면적은 **`exclusiveArea`(전용면적) 하나뿐**이다.
공급면적/계약면적/분양면적/공용면적은 **어느 오피스텔 실거래 원천에도 없다.**

금지: 공급·계약·분양면적 추정 · 아파트식 84㎡ 국민평형 · 공급면적을 모르는 상태에서 "몇 평형" 단정.

실측 분포:

| | SALE | RENT |
| --- | --- | --- |
| p10 / p50 / p90 | 20.95 / **29.24** / 80.22㎡ | 19.64 / **26.30** / 52.46㎡ |
| 40㎡ 미만 | 43.8% | 74.4% |
| **84㎡대** | **2.76%** | **1.45%** |

→ 아파트 국민평형 로직 재사용 불가. 면적 구간 상수만 `src/lib/property/contracts.ts`의
`OFFICETEL_AREA_BANDS_SQM`에 두었고, **이번 STEP에서 통계/UI는 구현하지 않았다.**

DB에는 원본 전용면적을 Decimal로 **정밀도 손실 없이** 저장한다(원천 소수점 최대 4자리 관측).

## 12. Building registry contract

**아파트 경로와 분리한다.**

| | 아파트 | 오피스텔 |
| --- | --- | --- |
| 사용 오퍼레이션 | `getBrRecapTitleInfo`(총괄표제부) | **`getBrTitleInfo`(표제부)** |
| 실측 결과 | 정상 | 총괄표제부 **3/3 전부 0건**, 표제부 **3/3 전부 1건** |
| 규모 필드 | `hhldCnt`(세대수) | **`hoCnt`(호수)** — `hhldCnt`는 항상 0 |

실측 예(쥬노벨 오피스텔, 해운대 좌동 1458-5):

```
mainPurpsCdNm="업무시설"  etcPurps="오피스텔, 근린생활시설"  useAprDay=20070731
hhldCnt=0  hoCnt=234  totArea=17833.52  vlRat=780.69  bcRat=75.94
strctCdNm="철근콘크리트구조"  grndFlrCnt=13  ugrndFlrCnt=4
indrMechUtcnt=69 indrAutoUtcnt=84   newPlatPlc="부산광역시 해운대구 해운대로781번길 20"
```

**`hhldCnt`를 세대수로 표시하는 아파트 로직을 재사용하면 안 된다** — 오피스텔은 항상
"세대수 0 / 정보 없음"이 된다.

표현: **"호수"**, **"건축물대장상 오피스텔"**. 금지: "주거용 오피스텔 확정".

건축물대장 조회 키(`sigunguCd + bjdongCd + bun + ji`)가 canonicalKey 성분과 정확히 일치해
연결이 자연스럽다.

## 13. Property 모델 상태

기존 `Property` 모델(= `properties` 테이블, `@@unique([category, name, dong])`)은
**Production 0행**이며 이번 STEP에서 **삭제/수정/migration/데이터 이동을 하지 않았다.**
그대로 미사용 상태로 둔다.

참고: 그 unique key는 **이름+법정동 identity**라 §3 실측(부산 전체 동명 충돌 4.47%)과
정면 충돌한다. 향후 property abstraction 결정은 별도 STEP에서 다룬다.

## 14. Minimal code abstraction

`src/lib/property/contracts.ts` — **타입 선언만**, 구현체 없음.

- `PropertyType` = `'APARTMENT' | 'OFFICETEL'` (생활형숙박시설은 값 추가로 확장)
- `IdentityResolver<TSourceRow>` — 원천 행 → canonicalKey | UNRESOLVED
- `TransactionSourceAdapter<TSourceRow>` — `fetchCell(lawdCd, ym)`
- `PropertyDetailProvider<TDetail>` — 유형별 상세 정보(건축물대장 오퍼레이션이 다르기 때문)
- `OFFICETEL_AREA_BANDS_SQM` 상수

**하지 않은 것:** 공통 Property DB 재설계 · generic transaction event 모델 ·
범용 stats 프레임워크 · apartment 파이프라인 refactor. 아파트 경로는 이 파일을
import하지 않으며 이번 STEP에서 **한 줄도 바뀌지 않았다**.

## 15. Migration 안전성

| 항목 | 값 |
| --- | ---: |
| CREATE TABLE | 3 (전부 신규) |
| CREATE INDEX | 6 (전부 신규 테이블) |
| CREATE UNIQUE INDEX | 3 (전부 신규 테이블) |
| ALTER TABLE | 2 — **둘 다 신규 테이블 대상**(FK 추가) |
| CREATE TYPE | 0 |
| **기존 테이블 ALTER** | **0** |
| **DROP / DELETE / UPDATE / INSERT / RENAME** | **0** |
| FK ON DELETE | `SET NULL` (history를 cascade 삭제하지 않는다) |
| 기존 production 테이블 언급 | **0** |

적용 전후 기존 테이블 row count:

| 테이블 | before | after |
| --- | ---: | ---: |
| apartments | 71 | **71** |
| apartment_trade_histories | 864,100 | **864,100** |
| apartment_rent_histories | 125,469 | **125,469** |
| properties | 0 | **0** |
| sync_coverage_cells | 142 | **142** |

신규 테이블 3개 전부 **row count 0**.

## 16. 다음 STEP

1. **STEP 2 — master 구축**: 건축물대장 표제부로 오피스텔 master를 채운다.
   `etcPurps`에 "오피스텔"이 포함된 건물을 대상으로 하되 **"건축물대장상 오피스텔"**
   이상의 의미를 부여하지 않는다. buildingDong 해석 규칙(§5 리스크)을 여기서 확정한다.
2. **STEP 3 — SALE 수집 어댑터**: `TransactionSourceAdapter` 구현 + dry-run.
3. **STEP 4 — RENT 수집 어댑터**: cancellation 컬럼 없이.
4. 이후 Search/Map/Detail. **Record High / Score / Finance는 V1 범위 밖**
   (각각 rgstDate 부재 / peer 근거 부재 / 세제 근거 부재).
