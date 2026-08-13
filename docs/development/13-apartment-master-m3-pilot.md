# 이집 Apartment Master 소량 구축 검증 — MASTER M3

작성일: 2026-08-13
성격: MASTER M1/M2에서 확정한 설계를 실제 DB에 처음으로 구현·적재하는 "소량 실제 구축 검증" STEP. 대상은 부산 서구 + 부산 해운대구로 한정했고, 부산 전체·전국 적재는 하지 않았다. **commit/push는 수행하지 않았다** — schema/migration/seed 결과는 사용자 검수 후 결정한다.

---

## 0. 사전 상태 확인

| 항목 | 결과 |
|---|---|
| git status(작업 시작 전) | clean |
| branch | main, origin/main과 동일(`b7d0b97`) |
| MASTER M1/M2 상태 | `CHANGELOG.md` 기준 둘 다 "완료" 확인 |

`docs/development/11-apartment-master-analysis.md`, `12-apartment-master-design.md`, `10-presale-location-market-analysis.md`, `DECISIONS.md`, `CHANGELOG.md`를 재확인했다.

---

## A. M3 목표

M1/M2에서 설계만 했던 `ApartmentMaster`를 실제로 만들어보고, (1) schema가 실제 데이터에 맞는지, (2) `aptSeq` unique 정책이 안전한지, (3) MOLIT→건축물대장→Kakao 연결이 실제로 되는지, (4) 좌표 품질 정책이 안전한지, (5) 기존 `Apartment` 기능을 깨지 않는지, (6) 향후 부산/전국 확장이 가능한 구조인지를 **부산 서구 + 부산 해운대구 소량 데이터로 검증**한다.

---

## B. Schema

M2 §J의 후보 schema를 기준으로 `prisma/schema.prisma`에 `ApartmentMaster` 모델을 신규 추가했다(기존 `Apartment` 모델 뒤, `AiSearchCache` 앞). 실제 필드 22개(내부 PK/timestamps 포함):

```prisma
model ApartmentMaster {
  id                Int      @id @default(autoincrement())
  aptSeq            String?  @unique @map("apt_seq")
  mgmBldrgstPk      String?  @map("mgm_bldrgst_pk")
  name              String
  normalizedName    String   @map("normalized_name")
  sido              String?
  sigungu           String?
  sggCd             String?  @map("sgg_cd")
  umdName           String?  @map("umd_name")
  umdCd             String?  @map("umd_cd")
  jibun             String?
  roadAddress       String?  @map("road_address")
  jibunAddress      String?  @map("jibun_address")
  latitude          Float?
  longitude         Float?
  geocodeQuality    String?  @map("geocode_quality")
  buildYear         Int?     @map("build_year")
  useApprovalDate   String?  @map("use_approval_date")
  mainBuildingCount Int?     @map("main_building_count")
  totalHouseholds   Int?     @map("total_households")
  parkingCount      Int?     @map("parking_count")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @default(now()) @updatedAt @map("updated_at")

  @@index([sggCd])
  @@index([normalizedName])
  @@index([umdCd, jibun])
  @@map("apartment_masters")
}
```

M2 후보와의 차이: `rawAddress`(중복 정보라 제외), `dongCount`(→ `mainBuildingCount`로 명명 통일), `buildingRegisterId`(→ M3 §E에서 결정한 대로 `mgmBldrgstPk` 단일 컬럼으로 대체, 별도 mapping table은 만들지 않음) — 요청안의 "불필요한 필드는 추가하지 않는다" 원칙에 따라 실제 확보 가능성이 확인된 필드만 반영했다.

---

## C. Migration

`npx prisma migrate dev --name apartment_master_m3 --create-only`로 SQL만 먼저 생성해 파괴적 변경 여부를 검토한 뒤 적용했다.

**생성된 SQL 요약**: `CREATE TABLE "apartment_masters"`(1건) + `CREATE UNIQUE INDEX`(`apt_seq`, 1건) + `CREATE INDEX`(`sgg_cd`/`normalized_name`/`umd_cd,jibun`, 3건). **DROP/ALTER/기존 테이블 변경 전혀 없음** — 순수 추가만 확인한 뒤 `prisma migrate deploy`로 적용했다.

| 확인 | 결과 |
|---|---|
| `prisma validate`(적용 전/후) | 통과 |
| `prisma migrate status`(적용 후) | "Database schema is up to date!" |
| 기존 테이블 영향 | 없음(§N에서 재확인) |

---

## D. aptSeq 정책

M2가 확정한 대로 **내부 PK(`id`)와 분리된 nullable unique**를 그대로 적용했다. 실제 33건 적재 과정에서 **unique 충돌은 0건**이었다(작업 중단 사유 없음). 서구 재실행(idempotency, §M)에서도 동일 `aptSeq` 15건이 전부 기존 행으로 정확히 upsert됐다.

---

## E. 서구 seed

`scripts/apartment_master_seed.ts <lawdCd> <label> <limit>`를 작성해 실행했다 — MOLIT 18개월 수집 → 다양성 기준 표본 선정(거래多/少, 신축/구축, 흔한 이름) → 건축물대장 enrichment(REGCODE_PROXY 미사용, `sggCd`+MOLIT `umdCd`+`jibun` 직접 사용) → Kakao geocoding(도로명주소 우선) → `aptSeq` 기준 upsert.

- 서구(`lawdCd=26140`) 고유 `aptSeq` 후보 156개 중 **15개** 선정.
- 선정 기준: 거래 많은 단지 4(최대 147건), 거래 적은 단지 3(1건), 신축 3(2022~2024), 구축 3(1971~1975), 흔한 이름 후보 3("문화"×3 포함) — 나머지는 거래량 순으로 채움.

---

## F. 서구 검증

| 항목 | 결과 |
|---|---|
| 생성 행 수 | 15 |
| `aptSeq` 중복 | 0 |
| 이름 충돌(정규화 이름 기준 여러 행) | 1건 — "문화"(3개 행, 서로 다른 `aptSeq`/동/지번, §K에서 상술) |
| 건축물대장 성공 | 6/15(40%) |
| 좌표 성공(exact+normalized) | 15/15(100%, exact 6 + normalized 9) |
| unique violation / FK 문제 | 없음 |

치명적 문제가 없어 해운대 seed로 진행했다(§G).

---

## G. 해운대 seed

같은 스크립트로 `lawdCd=26350`(고유 `aptSeq` 후보 294개, 서구의 약 1.9배) 기준 **18개** 선정 — 대단지(더샵센텀파크1차 등), 거래량 많은 단지(190건), 신축(2023~2024), 구축(1975~1976), 흔한 브랜드성 이름을 의도적으로 포함했다.

---

## H. 해운대 Stress Test

| 항목 | 서구에서 관측 안 됨 → 해운대에서 발견? |
|---|---|
| `aptSeq` collision | 발견 안 됨(0건) |
| 동일명 단지 | 해운대에서도 발생하지 않음(이번 표본에서는 우연히 없었음 — M1/M2의 전국 실측(44건)과 비교하면 표본 크기가 작아 관측되지 않았을 뿐, "해운대에는 없다"는 뜻은 아님) |
| 대단지 건축물대장 복수결과 | 발견 안 됨(0건, §K) — 더샵센텀파크1차(2,752세대)처럼 큰 단지도 총괄표제부 레코드는 1건이었음 |
| 좌표 정확도 | **문제 발견**(§I) — 3건이 완전히 다른 지역(경기 부천시)으로 잘못 지오코딩됨, 스크립트 버그로 확인·수정 |
| 세대수/주차 집계 문제 | 발견 안 됨(모두 총괄표제부 확정값만 저장, 동 단위 값 없음) |
| 이름 정규화 충돌 | 해운대 자체에서는 발견 안 됨 |
| API 호출량 | 서구(156개 후보 스캔 대상 API 호출) 대비 해운대(294개)가 약 1.9배 — 정밀한 초 단위 시간 측정은 하지 않았다(확인 필요 사항으로 남김) |

**서구에서는 드러나지 않았던 문제(좌표 지역 오매칭)가 해운대 표본에서 실제로 발견됐다** — 이는 표본 다양성 확보(흔한 이름 포함)가 실제로 효과가 있었다는 것을 보여준다(§I).

---

## I. 발견 및 수정 — Kakao 키워드검색 지역 검증 버그 (M3에서 발견)

### I-1. 문제

seed 스크립트의 `geocode()`는 키워드검색(`{동} {단지명}`) 결과가 예상 시/도와 일치하는지 검증하도록 설계했으나, 검증 함수가 Kakao 키워드검색 응답의 `doc.address.region_1depth_name`을 읽도록 작성돼 있었다. **실측 확인 결과 Kakao 키워드검색(`/v2/local/search/keyword.json`) 응답에는 이 중첩 필드 자체가 없다**(주소검색 API와 다른 응답 스키마 — `address_name`/`road_address_name` 평문 문자열만 존재). 그 결과 `region1`이 항상 빈 문자열이 됐고, `!''.includes(expected) && !expected.includes('')`가 **`false`**(빈 문자열은 모든 문자열의 부분문자열이므로 `expected.includes('')`가 항상 `true`)가 되어 **지역 검증이 사실상 항상 통과되는 실제 버그**였다.

이로 인해 "에이스빌라"(중동 1497-1), "스카이맨션"(중동 1516-2), "대림맨션"(중동 1405-10) 3건이 **경기도 부천시의 동명 장소**로 잘못 지오코딩돼 저장됐다.

### I-2. 수정

1. `region1`을 중첩 객체가 아니라 `road_address_name`/`address_name` 평문 문자열의 첫 토큰으로 파싱하도록 수정.
2. `region1`이 빈 문자열이면(파싱 실패 등) 검증을 통과시키지 않고 거부하도록 방어 로직 추가(빈 문자열의 `.includes()` 항등원 문제 재발 방지).
3. 이미 저장된 33건 전체를 수정된 로직으로 재검증 — 위 3건을 `latitude`/`longitude`를 `null`, `geocodeQuality`를 `'failed'`로 정정했다(임의 좌표 유지 금지 원칙).
4. 재검증 1차 시도에서 도로명주소 기반 "exact" 매칭 7건이 일시적 API 응답 실패(추정: 짧은 시간 내 다회 호출로 인한 rate limit)로 잘못 "지역불일치"로 오판돼 함께 null 처리되는 2차 사고가 있었으나, 원본 seed 로그의 검증된 값으로 즉시 복원하고 각 행을 500ms 간격으로 재조회해 실제로는 문제가 없음을 재확인했다.

### I-3. 최종 상태

수정 후 전체 33건을 재검증한 결과, 좌표가 있는 29건 중 지역 불일치는 0건이다(§Q 최종 수치 반영).

---

## J. 건축물대장 enrichment

`sggCd`+MOLIT `umdCd`+`jibun`으로 REGCODE_PROXY 없이 직접 조회했다(M1/M2에서 확인한 경로 재사용, 이번 STEP에서 새로 도입한 API 없음).

| 지역 | 성공 | 실패 |
|---|---|---|
| 서구 | 6/15(40%) | 9/15 |
| 해운대 | 10/18(56%) | 8/18 |

**실패 원인 진단(서구 표본 5건 직접 재조회)**: 실패한 모든 사례(구덕금호/일광/문화×3)에서 **총괄표제부(`getBrRecapTitleInfo`)는 0건이지만 표제부(`getBrTitleInfo`, 개별 동)는 1~4건 존재**함을 확인했다 — 즉 API 실패가 아니라, **오래되거나(1971~2001년) 소규모인 건물은 애초에 "총괄표제부"(여러 동을 묶는 단지 집계 레코드) 자체가 등록돼 있지 않은 경우가 실제로 있다**는 것을 실측으로 확인했다. 이 스크립트는 M2 정책(총괄표제부만 사용, 동 단위 값을 단지 전체처럼 저장 금지)을 그대로 지켜 이 경우 값을 채우지 않고 `null`로 뒀다 — 억지로 표제부(개별 동) 값을 단지 전체 값처럼 채우지 않았다.

**복수 총괄표제부 레코드 사례**: 33건 전부 `recordCount=1`이었다 — 이번 표본 규모(33건)에서는 "한 단지에 여러 총괄표제부"(M1/M2가 우려한 사례) 자체가 관측되지 않았다. **이는 이 문제가 없다는 뜻이 아니라, 33건 규모에서는 우연히 마주치지 않았다는 뜻**이다(§K에서 재확인).

---

## K. 세대수/주차 정책

M2 정책 그대로: **총괄표제부에서 확정 가능한 값만 저장, 동 단위 값을 단지 전체로 저장하지 않음.** 복수 레코드가 나오면 세대수가 가장 큰 레코드를 대표로 쓰는 기존 `apt-building-info.ts` 정책을 그대로 재사용했으나(§J), 이번 33건에서는 이 분기 자체가 실행되지 않았다(recordCount 전부 1).

**`mgmBldrgstPk` 처리 방식 최종 확인**: 이번 33건 전부 단일 값이었다 — **"별도 external mapping이 필요한 복수 사례"는 이번 M3 규모에서 관측되지 않았다.** M2가 미리 설계한 "단일 컬럼(ApartmentMaster 직접 unique 아님, 검증 없는 nullable String)" 구조로 충분했다. 단, 이는 33건이라는 소량 표본의 결과이며, 향후 M4~M6에서 규모가 커지면 재현될 가능성을 배제하지 않는다(M1/M2가 이미 "드문 사례"로 문서화한 바 있음).

**추가 발견 — `mgmBldrgstPk` 정밀도 문제 실사고**: 33건 중 3건(`1000000000000004180361`형 22자리 정수)에서 표준 `JSON.parse`(`res.json()`)가 이 값을 IEEE754 double로 반올림해 `"1.0000000000000042e+21"`로 **조용히 훼손**하는 것을 실제로 겪었다(M1/M2가 우려했던 위험이 현실화된 사례). 원본 응답 텍스트를 정규식으로 먼저 추출해 정수 문자열을 보존하도록 스크립트를 즉시 수정하고, 이미 저장된 3건을 정정했다 — 최종 33건 전부 과학적 표기 잔존 없음을 확인했다.

---

## L. 데이터 provenance

M2 정책(전용 컬럼 신설 없이 문서로 관리) 그대로 유지했다.

| 필드 | 출처 |
|---|---|
| `aptSeq`/`name`(우선)/`buildYear`/`umdName`/`umdCd`/`jibun`/`sggCd` | MOLIT |
| `mgmBldrgstPk`/`useApprovalDate`/`mainBuildingCount`/`totalHouseholds`/`parkingCount`/`roadAddress`/`jibunAddress` | 건축물대장(`BldRgstHubService/getBrRecapTitleInfo`) |
| `latitude`/`longitude`/`geocodeQuality` | Kakao(도로명주소 우선, 실패 시 지번주소, 실패 시 키워드검색) |
| `sido`/`sigungu` | seed 실행 시 지정한 지역 라벨(예: "부산 서구") — MOLIT 응답 자체에는 시/도 텍스트 필드가 없어(§F, M2 §H) 이번 STEP에서는 호출부 라벨을 그대로 사용, REGCODE_PROXY는 사용하지 않음 |

---

## M. Idempotency

서구 15건 seed를 **동일 조건으로 한 번 더 실행**했다.

| 항목 | 결과 |
|---|---|
| 재실행 전 총 행 수 | 33 |
| 재실행 후 총 행 수 | **33(증가 없음)** |
| 재실행 후 최대 `id` | **33(신규 행 생성 안 됨 확인)** |
| 서구 `aptSeq` 중복 | 0 |
| 재실행 시 매칭된 행 | 기존 id=1~15 그대로(신규 id 발급 없이 update 경로로 처리됨) |

**idempotent함을 확인했다.**

---

## N. 기존 기능 영향

| 확인 | 결과 |
|---|---|
| 기존 `Apartment` 레코드 수 | **20건(변화 없음)** |
| 기존 `Property` 레코드 수 | **0건(변화 없음)** |
| 기존 `Presale` 레코드 수 | **1,046건(변화 없음)** |
| `prisma.apartment`/`prisma.property`/`prisma.presale` 의존 코드 | 이번 STEP에서 **전혀 수정하지 않음**(M2 §L-1에서 재확인한 3개 파일 그대로) |
| `npm run build` | **성공**(29개 라우트 전부 정상 생성, `/map`/`/apt/[name]`/`/api/apt/[name]`/`/school`/`/api/school/apartments`/`/ai-search`/`/api/ai-search` 전부 포함) |

새 `ApartmentMaster`는 **병행 상태로만 존재**한다 — 이번 STEP에서 기존 코드가 이 모델을 사용하도록 전환하지 않았다(요청 원칙 그대로).

---

## O. 무거래 단지 한계

이번 seed는 전량 **MOLIT 실거래 기반**(고유 `aptSeq` 후보 목록 자체가 18개월 내 거래가 있는 단지에서만 나옴)이므로, **거래가 없는 단지는 이번 33건에 단 하나도 포함되지 않았다.** M1/M2가 이미 예상한 대로다.

**M3 성공 ≠ 전국 완전 Master 완성이다.** 향후 거래 없는 단지까지 포함하려면 Kakao 반경검색(P2-D4-A/M1에서 이미 확인한 패턴) 또는 건축물대장 동 단위 전수조회 같은 별도 seed source가 필요하며, 이를 M4/M5의 범위로 명시적으로 남긴다.

---

## P. 신규 aptSeq 정책(초안 평가)

M2 §P가 제안한 흐름(신규 `aptSeq` 발견 → Master 조회 → 없으면 최소 정보로 후보 생성 → 주소/건축물대장/Kakao enrichment)은 **이번 M3의 seed 스크립트가 사실상 그 흐름 자체를 이미 구현한 것과 같다** — `collectCandidates()`(신규 발견) → `prisma.apartmentMaster.upsert({ where: { aptSeq } })`(없으면 생성, 있으면 갱신) → `fetchRegistry()`/`geocode()`(enrichment) 순서가 정확히 일치한다. **이 흐름은 타당하다고 실제로 확인됐다** — 다만 이번 STEP은 수동 실행이며, 운영 자동화(월별 배치 트리거)는 구현하지 않았다(요청 범위 밖).

---

## Q. 서구 vs 해운대 비교

| 항목 | 부산 서구 | 부산 해운대구 |
|---|---|---|
| 고유 `aptSeq` 후보(18개월 전체) | 156개 | 294개(서구의 약 1.9배) |
| seed 건수 | 15 | 18 |
| `aptSeq` 안정성(unique violation) | 0 | 0 |
| 건축물대장 성공률 | 40%(6/15) | 56%(10/18) |
| 좌표 성공률(exact+normalized) | **100%**(15/15) | **77.8%**(14/18, 4건 failed) |
| 세대수/주차/동수 null 비율 | 60%(9/15) | 44%(8/18) |
| **사용승인일 null 비율** | 40%(6/15 확보) | **78%(4/18만 확보)** — 세대수는 있는데 사용승인일만 빠진 사례가 다수(§J) |
| 복수 건축물대장 레코드 비율 | 0% | 0% |
| 동일명/브랜드명 충돌 | 1건("문화" 3개 행) | 0건(표본 크기 한계, §H) |
| 데이터 처리 시간 | 정밀 측정 안 함 | 정밀 측정 안 함(서구 대비 후보 스캔량 약 1.9배로 체감상 더 오래 걸림) |

**평가**: 지역 규모(고유 단지 수 약 1.9배)가 달라도 **같은 Master 구조(schema/식별자 정책)가 그대로 유지됐다** — schema 변경이나 예외 처리가 지역별로 필요하지 않았다. 다만 **좌표 성공률(100% vs 77.8%)과 사용승인일 확보율(40% vs 22%)에서 지역 간 편차가 실측으로 확인**됐다 — 해운대의 좌표 실패 4건은 전부 §I의 버그로 인한 오매칭이 정정된 결과이며(즉 "실패"가 "안전하게 null 처리됨"을 의미), 사용승인일 편차는 §J에서 확인한 대로 오래된 건물의 총괄표제부 레코드에 이 필드가 원천적으로 비어있는 경우가 있어 발생한 것으로, 두 편차 모두 지역 자체의 근본적 차이라기보다 **각각 다른 원인(스크립트 버그/원본 데이터 결측)이 우연히 지역별로 다르게 분포한 결과**로 해석하는 것이 정확하다.

---

## R. 발견된 문제

1. **(수정 완료)** Kakao 키워드검색 응답에 중첩 `address.region_1depth_name` 필드가 없어 지역 검증이 사실상 항상 통과되던 실제 버그 — 3건이 경기도로 잘못 매칭됐다가 정정됨(§I).
2. **(수정 완료)** `mgmBldrgstPk`가 안전정수 범위를 넘는 경우 `res.json()`의 표준 파싱이 값을 조용히 훼손 — 3건 발견·정정(§K).
3. **(문서화, 미수정)** 오래되거나(1970년대) 소규모인 건물은 총괄표제부 자체가 등록돼 있지 않은 경우가 있음(표제부에는 존재) — 이번 M3의 정책(총괄표제부만 신뢰)상 이런 건물은 건물정보가 계속 null로 남는다(§J). M4에서 표제부 폴백 도입 여부를 검토 과제로 남긴다.
4. **(문서화, 미수정)** `useApprovalDate`가 세대수/주차 등 다른 필드는 있는데 단독으로 비어있는 총괄표제부 레코드가 다수 존재(특히 오래된 단지, §Q) — 원본 공공데이터 자체의 결측으로 판단되며 이번 STEP에서 보정하지 않았다.
5. **(기존 기술부채, 이번 STEP에서 재확인만 함)** `school/apartments/route.ts`의 폐기된 건축물대장 API 호출 문제는 이번 STEP에서도 수정하지 않았다(요청 원칙).

---

## S. M4 권고

1. **표제부(개별 동) 폴백 도입 검토** — 총괄표제부가 없는 오래된/소규모 건물의 건물정보 확보율을 높이는 방향(§J §R-3).
2. **Kakao API 호출 안정성 강화** — 이번 M3에서 겪은 rate limit 추정 현상(§I-2)에 대비해 호출 간 지연/재시도 로직을 seed 스크립트에 정식으로 도입.
3. **대규모(부산 전체) 적재 전 복수 총괄표제부 레코드 사례를 다시 찾아본다** — 33건 규모에서는 관측되지 않았지만 M1/M2가 우려한 사례라 표본이 커지면 재현될 가능성이 있음(§K).
4. **무거래 단지 seed source 추가**(§O) — Kakao 반경검색 기반 보완을 M4/M5 범위로 명시.
5. **`sido`/`sigungu` 확보 방식 재검토** — 이번 STEP은 seed 실행 시 지정한 라벨을 그대로 썼다(§L) — 전국 확장 시 이 방식이 유지 가능한지 재평가 필요.

---

## 최종 보고

1. **ApartmentMaster schema**: 22개 필드(§B), Prisma model 신규 추가.
2. **생성 migration**: `20260813033432_apartment_master_m3`.
3. **migration SQL 요약**: `CREATE TABLE`(1) + `CREATE UNIQUE INDEX`(1) + `CREATE INDEX`(3), DROP/ALTER 없음(§C).
4. **migration 적용 결과**: 성공(`prisma migrate deploy`), `migrate status` "up to date".
5. **aptSeq unique 정책**: nullable unique, 내부 PK(`id`)와 분리(§D).
6. **geocodeQuality 구조**: `String?` 컬럼으로 실제 채택(`'exact'`/`'normalized'`/`'failed'`), Presale의 "사후 구분 불가" 한계를 반복하지 않음(§B, M2 §I-3 그대로 실행).
7. **서구 seed 대상 수**: 15(156개 후보 중 선정).
8. **서구 실제 생성 수**: 15.
9. **해운대 seed 대상 수**: 18(294개 후보 중 선정).
10. **해운대 실제 생성 수**: 18.
11. **최종 ApartmentMaster 총 건수**: **33**.
12. **aptSeq duplicate 건수**: **0**.
13. **서구 건축물대장 성공/실패**: 6/15 성공, 9/15 실패(§J, 원인 진단 완료 — 총괄표제부 미등록).
14. **해운대 건축물대장 성공/실패**: 10/18 성공, 8/18 실패.
15. **복수 건축물대장 사례 수**: **0건**(33건 전부 recordCount=1) — 단, §K에서 표본 한계로 해석.
16. **좌표 exact**: 16건(서구 6 + 해운대 10).
17. **좌표 normalized**: 13건(서구 9 + 해운대 4).
18. **좌표 failed**: 4건(전부 해운대, §I 버그 정정 결과).
19. **서구 좌표 성공률**: 100%(15/15).
20. **해운대 좌표 성공률**: 77.8%(14/18).
21. **세대수 확보 건수**: 16/33.
22. **주차 확보 건수**: 16/33(세대수와 동일 — 같은 레코드에서 함께 확보됨).
23. **동수 확보 건수**: 16/33(동일 이유).
24. **사용승인일 확보 건수**: 10/33(세대수 확보 16건 중 6건은 useAprDay 자체가 결측, §J §R-4).
25. **mgmBldrgstPk 처리 방식**: 단일 `String?` 컬럼, DB unique 제약 없음(문서 정책 그대로) — 이번 33건에서 복수 필요 사례 없음(§K).
26. **서구 수동 검증 5건 결과**: 전부 aptSeq/법정동/지번/좌표/건축년도/사용승인일/세대수/주차/동수 항목이 "단지 전체 의미로 타당함"을 확인(§F, id=1/2/5/6/10).
27. **해운대 stress test 결과**: aptSeq collision·복수 건축물대장 레코드·이름 정규화 충돌은 이번 표본에서 미발견, **좌표 지역 오매칭은 실제 발견**(§H, §I).
28. **동일명/브랜드 충돌 사례**: 1건("문화" 3개 행, 서구, 전부 정상적으로 별도 유지됨).
29. **region mismatch 사례**: 3건 발견·정정(§I).
30. **idempotency 결과**: 통과(재실행 후 행 수 33 유지, 신규 행 0, §M).
31. **기존 Apartment 영향**: 없음(20건 그대로, §N).
32. **기존 UI/API 영향**: 없음(build 성공, 관련 라우트 전부 정상 생성, §N).
33. **Presale 거리 read-only 테스트 결과**: 부산 서구 1건 + 해운대 5건의 Presale 좌표로 `@turf/turf` `distance()`를 재사용해 최근접 `ApartmentMaster` 3개씩 계산 성공(DB 저장/FK 생성 없음, 읽기 전용 확인).
34. **무거래 단지 한계**: 이번 33건 전부 거래 있는 단지만 포함, 무거래 단지는 0건 포함(§O, 명시적 한계로 기록).
35. **신규 aptSeq 운영정책**: M2 §P 흐름이 seed 스크립트 구조와 실제로 일치함을 확인, 자동화(배치)는 미구현(§P).
36. **prisma validate**: 통과.
37. **migrate status**: "Database schema is up to date!".
38. **TypeScript**: `npx tsc --noEmit` 오류 0.
39. **lint**: 오류 0, 경고 5건(전부 이번 변경과 무관한 기존 파일).
40. **build**: 성공, 29개 라우트 전부 정상 생성.
41. **수정/생성 파일**: `prisma/schema.prisma`(모델 추가), `prisma/migrations/20260813033432_apartment_master_m3/migration.sql`(신규), `scripts/apartment_master_seed.ts`(신규, 재사용 가능한 seed 파이프라인으로 보존 — 조사용 임시 스크립트가 아니라 M4 이후에도 재사용할 운영 도구로 판단해 삭제하지 않음).
42. **생성/수정 문서**: 신규 `docs/development/13-apartment-master-m3-pilot.md`(본 문서), `docs/development/CHANGELOG.md` 갱신 예정.
43. **git diff --stat**: 아래 참고.
44. **git status --short**: 아래 참고.
45. **발견된 문제**: §R의 5개 항목(2개 수정완료 + 2개 문서화 + 1개 기존 기술부채 재확인).
46. **검수가 필요한 사항**: (a) 표제부 폴백 도입 여부(§S-1), (b) `sido`/`sigungu` 확보 방식이 라벨 기반이라 전국 확장 시 재검토 필요(§L, §S-5), (c) 복수 총괄표제부 레코드 사례가 33건 규모에서 우연히 관측되지 않았을 뿐이라는 해석이 맞는지(§K, §S-3), (d) Kakao rate limit 추정 현상의 정확한 원인(§I-2, §S-2).

### git diff --stat / git status --short

이번 STEP은 schema 변경(신규 테이블 추가)과 실제 DB 데이터 적재(33건)를 포함한다. **production 코드 파일은 변경하지 않았다** — 변경분은 schema/migration/신규 seed 스크립트/문서뿐이다.

```
$ git status --short
 M prisma/schema.prisma
?? prisma/migrations/20260813033432_apartment_master_m3/
?? scripts/apartment_master_seed.ts
?? docs/development/13-apartment-master-m3-pilot.md
```

(`CHANGELOG.md` 갱신은 본 문서 저장 직후 별도로 반영한다. DB 자체의 변경(신규 테이블 + 33행)은 git diff에 나타나지 않는다 — Supabase 원격 DB에 이미 적용된 상태다.)

---

## 최종 판단

### **A. 현재 ApartmentMaster 구조로 M4 확장 가능**

**근거(5개 이내)**:

1. `aptSeq` unique 정책이 33건 실제 적재(서구+해운대, 재실행 포함 총 48회 upsert 시도)에서 **unique 충돌 0건**으로 실증됐고, idempotency도 확인됐다(§D, §M) — M2가 설계만 했던 정책이 실제로 안전하게 동작함을 확인했다.
2. schema가 지역 규모 차이(156 vs 294개 고유 단지, 약 1.9배)에도 **변경 없이 그대로 적용**됐다(§Q) — 부산 전체/전국 확장 시에도 구조 자체를 바꿔야 할 근거가 나오지 않았다.
3. 기존 `Apartment`/`Property`/`Presale`과 기존 UI/API가 **전혀 영향받지 않았다**(§N, build 성공 포함) — 새 Master가 병행 구조로 안전하게 공존한다는 M1/M2의 설계 의도가 실제로 검증됐다.
4. 이번 STEP에서 발견된 2개의 실제 버그(Kakao 지역검증 우회, `mgmBldrgstPk` 정밀도 손실)는 **schema 결함이 아니라 seed 스크립트의 파싱/검증 로직 결함**이었고, 둘 다 발견 즉시 수정하고 재검증까지 완료했다(§I, §K) — 남은 것은 schema를 다시 설계해야 하는 문제가 아니라 스크립트를 다듬으면 되는 수준이다.
5. 유일하게 아직 확실히 검증되지 않은 것은 "복수 총괄표제부 레코드"(§K)와 "무거래 단지"(§O) 두 가지인데, 둘 다 **schema가 이미 이를 수용할 수 있는 구조**(nullable `mgmBldrgstPk`, `aptSeq` nullable)이며 seed 전략(§S)만 보완하면 되는 문제라 M4 진행을 막을 근거가 아니다.

commit 하지 않는다. push 하지 않는다. MASTER M4로 넘어가지 않는다. P2-D4-B로 넘어가지 않는다. 재개발/커뮤니티 작업을 시작하지 않는다.

검수를 기다립니다.

---

## 최종 검수 결정 (2026-08-13)

MASTER M3(Apartment Master 부산 서구 + 해운대 소량 구축 검증)를 **최종 승인/완료**로 확정한다. 최종 판단 **A(현재 ApartmentMaster 구조로 M4 확장 가능)**를 그대로 승인한다.

### 최종 정책 반영

1. **내부 PK/외부 식별자 구조 유지**: `ApartmentMaster.id`(내부 PK) + `aptSeq`(nullable unique 외부 식별자) 구조를 그대로 확정한다(§D, §B).
2. **외부 식별자는 문자열로만 취급**: `aptSeq`/`mgmBldrgstPk`는 식별 문자열이며 산술/`Number` 변환을 금지한다. §K에서 실제로 겪은 `mgmBldrgstPk` 정밀도 손실 사고(22자리 정수가 `Number` 변환 과정에서 조용히 훼손됨)가 이 원칙의 직접적 근거다 — 이미 스키마(`String?`)와 seed 스크립트(원본 텍스트 정규식 추출)에 반영돼 있으며, 이번 검수로 이를 정책으로 재확인한다.
3. **Kakao geocoding은 정확도 우선, 성공률을 임의로 높이지 않음**: 지역 검증이 불가능하거나(예: 파싱 실패로 지역명을 얻지 못함) 동명 장소일 가능성이 있으면 좌표를 저장하지 않고 `null`(`geocodeQuality='failed'`)로 유지한다. §I에서 실제로 3건(에이스빌라/스카이맨션/대림맨션)을 이 원칙에 따라 null 처리했다 — 임의 fallback으로 좌표를 채우지 않는다.
4. **Master identity와 enrichment 분리**: 건축물대장 enrichment 실패(§J, 서구 40%·해운대 56%)는 `ApartmentMaster` 행 생성 자체를 막지 않는다 — `aptSeq`만 확보되면 행은 생성되고, 건물정보 필드는 `null`로 남는다. 이 분리는 이미 seed 스크립트 구조에 반영돼 있다(§E~G).
5. **현재 건축물대장 성공률은 M4 이후 개선 과제로 기록**: 부산 서구 40%, 부산 해운대구 56%는 이번 M3 완료를 막는 blocker로 취급하지 않는다 — §S-1(표제부 폴백 도입 검토)로 이미 M4 권고에 포함돼 있다.
6. **`scripts/apartment_master_seed.ts` 유지**: 조사용 임시 스크립트가 아니라 향후(M4 이후) 재사용 가능한 seed pipeline으로 확정 보존한다(§41에서 이미 이 판단을 내린 바 있음, 재확인).

MASTER M4로 진행한다(단, 이번 커밋에서는 M4를 시작하지 않는다).
