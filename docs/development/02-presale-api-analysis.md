# 이집 분양정보 API 연동 분석 — P1

작성일: 2026-08-12
성격: 조사/검증 전용(schema 변경·데이터 저장·UI 개발 없음)

---

## A. 현재 Presale 구조

`prisma/schema.prisma`의 `Presale` 모델(관련 모델·관계 없음 — 다른 모델과의 `@relation` 없음, 독립 테이블).

```prisma
enum PresaleHouseType { APT, OFFICETEL, URBAN, REMAIN }

model Presale {
  id                    Int              @id @default(autoincrement())
  houseManageNo         String?          @unique  // 주택관리번호(청약홈 PK)
  pblancNo              String?                    // 공고번호
  houseName             String
  houseType             PresaleHouseType
  locationAddress       String?
  latitude              Float?
  longitude             Float?
  totalSupplyHouseholds Int?
  constructCompany      String?

  announcementDate      DateTime?
  receiptStartDate      DateTime?
  receiptEndDate        DateTime?
  winnerDate            DateTime?

  minPrice              Int?             // 만원 단위(주석 기준)
  maxPrice              Int?             // 만원 단위(주석 기준)
  pblancUrl             String?

  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @default(now()) @updatedAt

  @@index([receiptStartDate, receiptEndDate])
}
```

| 항목 | 내용 |
|---|---|
| Primary Key | `id`(autoincrement) |
| Unique Key | `houseManageNo`(nullable unique — 값이 없으면 unique 제약에서 사실상 제외됨) |
| Nullable | `houseManageNo`, `pblancNo`, `locationAddress`, `latitude`, `longitude`, `totalSupplyHouseholds`, `constructCompany`, 4개 날짜 필드, `minPrice`, `maxPrice`, `pblancUrl` — 전부 nullable. Non-null은 `houseName`, `houseType`, `createdAt`, `updatedAt`뿐 |
| 날짜 필드 | `announcementDate`(모집공고일), `receiptStartDate`/`receiptEndDate`(청약접수 시작/종료), `winnerDate`(당첨자발표일) — 전부 `DateTime?` |
| 주소 필드 | `locationAddress`(String?, 단일 텍스트 — 시/도/시군구/동 분리 없음) |
| 위치/좌표 필드 | `latitude`, `longitude`(둘 다 `Float?`) |
| 분양가 필드 | `minPrice`, `maxPrice`(둘 다 `Int?`, 만원 단위로 주석에 명시) |
| 공급세대 필드 | `totalSupplyHouseholds`(Int?) — 세부 유형(특별공급/일반공급 등) 분리 없음 |
| 청약 일정 필드 | `receiptStartDate`, `receiptEndDate`, `winnerDate` |
| 외부 공고번호 저장 필드 | `pblancNo`(공고번호), `houseManageNo`(주택관리번호, unique) |
| 상세 URL 필드 | `pblancUrl` |
| createdAt/updatedAt | 둘 다 존재, `updatedAt`은 `@updatedAt` 자동 갱신 |

**관련 모델**: 없음. `RedevelopmentProject`(재개발)나 `Property`(오피스텔/생숙)와도 FK 연결이 없는 완전히 독립적인 테이블이다.

---

## B. 현재 청약홈 관련 코드

| 코드 | 파일 | 역할 | 실제 호출 여부 | 완성/미완성 |
|---|---|---|---|---|
| `syncApplyhomeListings(page, perPage)` | `src/services/cheongyakService.ts:55` | 청약홈 Detail API를 호출해 `Presale`에 upsert | **호출되지 않음** — 전체 코드베이스에서 정의부 외 참조 0건(크론/스크립트/관리자 버튼/API route 어디에도 연결 안 됨). 재확인 완료 | 완성: fetch/에러 처리/upsert 골격. 미완성: 아래 G/J 섹션에서 확인된 필드 매핑 오류 |
| `mapHouseType(secdNm)` | 같은 파일:32 | `HOUSE_SECD_NM` 문자열을 `PresaleHouseType` enum으로 매핑 | 위 함수 내부에서만 사용 | 아래 G/J 섹션에서 실제 값과 불일치 확인 |
| `parseDate(raw)` | 같은 파일:40 | `"YYYY-MM-DD"` 문자열 → `Date`, 실패 시 `null` | 위 함수 내부에서만 사용 | 완성 — 실제 API 날짜 형식과 호환 확인(아래 I섹션) |
| `computePresaleStatus(p)` | 같은 파일:122 | 날짜 기준으로 upcoming/ongoing/closed/unsold 파생 | `/api/presales`에서 실사용 중 | 완성 — Presale 데이터가 없어도 로직 자체는 정상 |
| `GET /api/presales` | `src/app/api/presales/route.ts` | `Presale` 전체 조회 + status 필터 | 실제 라우트는 동작하나, 테이블이 항상 비어 있어 빈 배열만 반환(프론트에서 이 라우트를 호출하는 화면 자체도 없음 — STEP 1 감사에서 확인된 사실 재확인) | 완성(로직) / 미연동(데이터 없음) |
| 관리자 관련 코드 | `src/app/api/admin/dashboard/route.ts:37-50` | 청약홈 상태를 `DATA_GO_KR_API_KEY` 존재 여부만으로 "미연동"으로 표시(STEP 1.5-B에서 정정됨) | 실행됨(관리자 대시보드 카드) | 상태 표시만 — 실제 동기화 버튼/트리거는 없음 |
| 데이터 변환 함수 | `mapHouseType`, `parseDate` (위와 동일) | — | — | — |
| upsert/save 함수 | `syncApplyhomeListings` 내부의 `prisma.presale.upsert(...)` | `houseManageNo` 기준 upsert, 없으면 skip(지어낸 키로 매칭하지 않음 — 원칙 준수) | 미호출 | 로직은 합리적으로 설계됨(아래 H섹션) |

이번 P1에서는 위 코드를 삭제/수정하지 않고 그대로 두었다.

---

## C. 공식 API

기준: 한국부동산원 청약홈 분양정보 조회 서비스(공공데이터포털, `api.odcloud.kr`).

| 항목 | 코드에 있는 값 | 실측 확인 결과 |
|---|---|---|
| Base URL | `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/` | **일치** — 실제 호출 성공 |
| Endpoint(Detail) | `getAPTLttotPblancDetail` | **일치** — HTTP 200, 정상 JSON 응답 확인 |
| Endpoint(Mdl, 주택형별) | 코드에 미구현(문서 조사만 되어 있던 상태) | 이번 P1에서 실제 호출로 확인함(아래 K섹션) — `getAPTLttotPblancMdl` 경로도 실제 존재하고 정상 응답함 |
| Query Parameter | `serviceKey`, `page`, `perPage` | **일치** — 세 파라미터로 정상 호출됨. 이 API는 공공데이터포털의 "표 형태" API(odcloud) 계열이라 `page`/`perPage`가 표준 파라미터임(`RTMSDataSvc` 계열과 다른 스펙임에 유의) |

Detail API 응답 봉투(envelope) 구조: `{ currentCount, data, matchCount, page, perPage, totalCount }` — `data`가 실제 레코드 배열. 현재 코드(`Array.isArray(json?.data) ? json.data : []`)는 이 구조를 정확히 전제하고 있어 이 부분은 **수정 불필요**.

---

## D. 인증/환경변수 구조

| 환경변수 이름 | 존재 여부 | 사용 파일 |
|---|---|---|
| `DATA_GO_KR_API_KEY` | **존재함**(`.env.local`에 설정됨 — 값은 확인만 하고 출력하지 않음) | `src/services/cheongyakService.ts`(청약홈), `src/lib/api-molit.ts`(MOLIT 실거래), `src/lib/apt-building-info.ts`(건축물대장), `src/app/api/school/apartments/route.ts`(건축물대장 재사용), `src/app/api/admin/dashboard/route.ts`(상태 표시), `src/app/api/ledger/route.ts`(이번 조사 범위 밖의 별도 기능) |

청약홈 API 전용 환경변수는 따로 없고, data.go.kr 공공데이터포털 서비스키 하나(`DATA_GO_KR_API_KEY`)를 여러 서비스가 공유한다 — 실측으로 이 키가 청약홈 Detail/Mdl 두 엔드포인트 모두에 유효함을 확인했다.

---

## E. 실제 API 호출 결과

실제 호출 4회 수행(전부 `page=1`, `perPage`는 1~5로 최소화, 대량 페이지네이션 없음). `.env`/`.env.local`은 수정하지 않았고, 응답에 담긴 실제 서비스키 값도 출력하지 않았다.

| # | Endpoint | 파라미터 | HTTP | 형식 | 비고 |
|---|---|---|---|---|---|
| 1 | `getAPTLttotPblancDetail` | `page=1&perPage=1` | **200** | JSON | 최초 확인 |
| 2 | `getAPTLttotPblancDetail` | `page=1&perPage=1` | **200** | JSON | 봉투 구조·필드명 전체 확인용 재호출 |
| 3 | `getAPTLttotPblancDetail` | `page=1&perPage=5` | **200** | JSON | 필드 값 다양성(HOUSE_SECD_NM 등) 확인용 |
| 4 | `getAPTLttotPblancMdl` | `page=1&perPage=3&cond[HOUSE_MANAGE_NO::EQ]=2026820008` | **200** | JSON | 주택형별 API 구조 확인용(#1의 실제 공고번호로 필터) |

응답 봉투: `{"currentCount":1,"data":[{...}],"matchCount":2843,"page":1,"perPage":1,"totalCount":2843}` — `totalCount`는 조회 시점 기준 전체 공고 수(2,843건, 과거~미래 공고 전체 누적으로 추정). **정상 데이터 존재를 실측으로 확인**했다.

---

## F. 실제 응답 필드

### F-1. `getAPTLttotPblancDetail`(1건당 49개 필드)

요청에서 지정한 "예시로 든 성격"별로 실제 필드명을 매핑한다(추측 없이 실측 확인된 필드명만 기재):

| 요청한 성격 | 실제 API 필드명 | 실측 예시값 |
|---|---|---|
| 주택관리번호 | `HOUSE_MANAGE_NO` | `"2026820008"` |
| 공고번호 | `PBLANC_NO` | `"2026820008"`(관찰된 5건 모두 HOUSE_MANAGE_NO와 동일값 — 표본이 적어 항상 그런지는 단정 불가) |
| 주택명 | `HOUSE_NM` | `"성남복정2 A1블록 신혼희망타운(공공분양)(본청약)"` |
| 공급지역 | `SUBSCRPT_AREA_CODE`, `SUBSCRPT_AREA_CODE_NM` | `"410"`, `"경기"` |
| 주소 | `HSSPLY_ADRES` (+ `HSSPLY_ZIP` 우편번호) | `"경기도 성남시 수정구 신흥동 81-8"`, `"13259"` |
| 모집공고일 | `RCRIT_PBLANC_DE` | `"2026-08-10"` |
| 청약접수 시작일 | `RCEPT_BGNDE` (일반적 접수 기준) — **코드가 참조 중인 `SUBSCRPT_RCEPT_BGNDE`는 실제로 존재하지 않는 필드명** | `"2026-08-31"` |
| 청약접수 종료일 | `RCEPT_ENDDE` — **코드의 `SUBSCRPT_RCEPT_ENDDE`도 마찬가지로 존재하지 않음** | `"2026-09-08"` |
| (세분화) 1순위/2순위 × 해당지역/기타지역/기타경기 접수기간 | `GNRL_RNK1_CRSPAREA_RCPTDE/ENDDE`, `GNRL_RNK1_ETC_AREA_RCPTDE/ENDDE`, `GNRL_RNK1_ETC_GG_RCPTDE/ENDDE`, `GNRL_RNK2_*`(동일 패턴), `SPSPLY_RCEPT_BGNDE/ENDDE`(특별공급) | 예: `GNRL_RNK1_CRSPAREA_RCPTDE:"2026-08-31"` |
| 당첨자 발표일 | `PRZWNER_PRESNATN_DE` | `"2026-09-17"` |
| 계약 시작일/종료일 | `CNTRCT_CNCLS_BGNDE` / `CNTRCT_CNCLS_ENDDE` | `"2026-12-07"` / `"2026-12-10"` |
| 입주 예정 | `MVN_PREARNGE_YM`(YYYYMM 6자리 문자열) | `"203005"`(2030년 5월) |
| 공급규모/총 세대수 | `TOT_SUPLY_HSHLDCO`(실측: JSON number 타입) | `594` |
| 건설사 | `CNSTRCT_ENTRPS_NM` | `"(주)케이알산업, 동성건설(주)"` |
| 사업주체(시행사, 시공사와 별개 필드) | `BSNS_MBY_NM` | `"한국토지주택공사 서울지역본부"` |
| 문의 전화 | `MDHS_TELNO` | `"0316992006"` |
| 홈페이지 | `HMPG_ADRES` | `"https://apply.lh.or.kr/"` |
| 공고 상세 URL | `PBLANC_URL` — **코드가 참조 중인 `LTTOT_PBLANC_URL`은 실제로 존재하지 않는 필드명** | `"https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetail.do?..."` |
| 분양구분(분양/임대) | `RENT_SECD`, `RENT_SECD_NM` | `"0"`, `"분양주택"` |
| 공급유형(주택 구분) | `HOUSE_SECD`, `HOUSE_SECD_NM` | `"10"`, `"신혼희망타운"` **(관찰된 값이 "아파트"류 한글 풀네임이 아니라 특수 카테고리명이거나, 다른 표본에서는 `"APT"`라는 영문 코드였음 — 아래 표 참고)** |
| 세부 유형 | `HOUSE_DTL_SECD`, `HOUSE_DTL_SECD_NM` | `"03"`, `"국민"` |

`HOUSE_SECD_NM` 5건 표본 관찰값: `신혼희망타운`(2건), `APT`(3건). `오피스텔`/`도시형생활주택`/`잔여`/`무순위` 같은 코드가 기대하는 한글 풀네임은 이번 표본에서 한 번도 나오지 않았다 — 이 필드의 실제 값 공간이 코드 작성 당시 가정과 다를 수 있다는 뜻이다(아래 J섹션에서 상세 평가).

### F-2. `getAPTLttotPblancMdl`(주택형별, 1건당 16개 필드)

| 필드명 | 의미(문서/실측 기반 추정) | 실측 예시값 |
|---|---|---|
| `HOUSE_MANAGE_NO`, `PBLANC_NO` | Detail과 동일한 조인 키 | `"2026820008"` |
| `MODEL_NO` | 주택형 모델 번호(단지 내 순번) | `"01"` |
| `HOUSE_TY` | 주택형(전용면적 기반 코드) | `"055.9700A"` |
| `SUPLY_AR` | 공급면적(㎡, 문자열) | `"83.6488"` |
| `LTTOT_TOP_AMOUNT` | 분양가 상한액으로 추정(문자열, 단위는 응답에 명시 없음 — 만원 단위로 보이나 공식 문서 확인 전에는 단정하지 않음) | `"79831"` |
| `SUPLY_HSHLDCO` | 일반공급 세대수 | `0`(이 공고는 전량 특별공급) |
| `SPSPLY_HSHLDCO` | 특별공급 세대수 합계 | `145` |
| `NWBB_HSHLDCO`, `NWWDS_HSHLDCO`, `OLD_PARNTS_SUPORT_HSHLDCO`, `LFE_FRST_HSHLDCO`, `MNYCH_HSHLDCO`, `YGMN_HSHLDCO`, `INSTT_RECOMEND_HSHLDCO`, `TRANSR_INSTT_ENFSN_HSHLDCO`, `ETC_HSHLDCO` | 특별공급 세부 유형별 세대수(신혼부부/다자녀/노부모부양/생애최초/기관추천 등으로 추정) | 대부분 `0`, 표본 공고가 신혼희망타운이라 해당 항목만 값이 있음 |

---

## G. Presale ↔ API 매핑표

| Presale 필드 | 공식 API 필드 | 변환 필요 여부 | 현재 저장 가능 여부 | 비고 |
|---|---|---|---|---|
| `houseManageNo` | `HOUSE_MANAGE_NO` | 없음(그대로) | **가능** | 안정적 unique 키로 실측 확인됨 |
| `pblancNo` | `PBLANC_NO` | 없음(그대로) | **가능** | |
| `houseName` | `HOUSE_NM` | 없음(그대로) | **가능** | |
| `houseType` | `HOUSE_SECD_NM` | enum 매핑 필요 | **부분 가능(현재 로직은 부정확)** | `mapHouseType()`이 가정한 한글 풀네임과 실측값("APT" 등 코드성 문자열, "신혼희망타운" 등 특수 카테고리)이 달라 재작성 필요 — 아래 J섹션 |
| `locationAddress` | `HSSPLY_ADRES` | 없음(그대로) | **가능** | |
| `latitude` / `longitude` | **API 응답에 없음** | 지오코딩 필요 | **현재 불가능** | Detail/Mdl 어디에도 좌표 필드 없음 — 주소 텍스트 기반 별도 지오코딩이 있어야 채워짐 |
| `totalSupplyHouseholds` | `TOT_SUPLY_HSHLDCO` | 타입 방어(number/string 모두 안전 처리됨) | **가능** | |
| `constructCompany` | `CNSTRCT_ENTRPS_NM` | 없음(그대로) | **가능** | |
| `announcementDate` | `RCRIT_PBLANC_DE` | `"YYYY-MM-DD"` → `Date` | **가능** | `parseDate()` 기존 로직으로 안전 처리됨 |
| `receiptStartDate` | 실제로는 `RCEPT_BGNDE` (코드는 존재하지 않는 `SUBSCRPT_RCEPT_BGNDE` 참조 중) | `Date` 변환 + **필드명 수정 필요** | **현재 불가능(항상 null 저장됨)** | 확인된 버그. 또한 실제로는 순위/지역별 접수기간이 최대 9쌍 존재해 "대표값" 정책 결정 필요 |
| `receiptEndDate` | 실제로는 `RCEPT_ENDDE` (코드는 `SUBSCRPT_RCEPT_ENDDE` 참조 중) | 동일 | **현재 불가능(항상 null 저장됨)** | 확인된 버그 |
| `winnerDate` | `PRZWNER_PRESNATN_DE` | `Date` 변환 | **가능** | |
| `minPrice` / `maxPrice` | **Detail 응답엔 없음** — `getAPTLttotPblancMdl`의 `LTTOT_TOP_AMOUNT`(주택형별)에서만 확인 가능 | 숫자 변환 + 단위 확인 필요 | **현재 불가능(Detail만 호출하는 지금 구조로는 영구히 null)** | Mdl 엔드포인트 연동이 전제조건 |
| `pblancUrl` | 실제로는 `PBLANC_URL` (코드는 존재하지 않는 `LTTOT_PBLANC_URL` 참조 중) | 없음(그대로) | **현재 불가능(항상 null 저장됨)** | 확인된 버그 |
| `createdAt` / `updatedAt` | 해당 없음(DB 자동 관리) | — | 가능(Prisma 자동) | |

**API에는 있으나 Presale에 없는 필드(추가 후보만 기록, 이번 P1에서 schema 추가하지 않음)**:
- `SUBSCRPT_AREA_CODE_NM`(공급지역 시/도명), `HSSPLY_ZIP`(우편번호)
- `MVN_PREARNGE_YM`(입주예정월, YYYYMM) — 요청에서 언급한 "입주 예정"의 실제 소스
- `CNTRCT_CNCLS_BGNDE` / `CNTRCT_CNCLS_ENDDE`(계약 시작/종료일) — 요청에서 언급한 "계약 시작/종료"의 실제 소스
- `RENT_SECD_NM`(분양주택/임대주택 구분 — "분양구분")
- `HOUSE_DTL_SECD_NM`(국민/민영 등 세부 유형)
- `HMPG_ADRES`(분양 홈페이지), `MDHS_TELNO`(문의전화)
- `BSNS_MBY_NM`(사업주체/시행사 — 시공사 `CNSTRCT_ENTRPS_NM`과는 별개 개념)
- 1순위/2순위/특별공급 세분화 접수기간 9종(`GNRL_RNK1_*`, `GNRL_RNK2_*`, `SPSPLY_RCEPT_*`)
- (Mdl) `HOUSE_TY`(주택형), `SUPLY_AR`(공급면적), `SUPLY_HSHLDCO`/`SPSPLY_HSHLDCO`(일반/특별공급 세대수), 특별공급 유형별 세대수 9종

**DB에는 있으나 API에서 찾지 못한 필드**: 실질적으로 `latitude`/`longitude` — 두 엔드포인트 어디에도 좌표 필드가 없어, API 응답만으로는 채울 수 없다(별도 지오코딩 필요).

---

## H. 고유 식별자 전략

- `HOUSE_MANAGE_NO`(주택관리번호)는 실측 5건 모두 non-null이었고, 값 형식이 일관됨(`"YYYY" + 지역/일련코드` 패턴으로 보이는 숫자 문자열). Detail/Mdl 두 엔드포인트 모두 이 값을 조인 키로 공유한다.
- `PBLANC_NO`(공고번호)는 이번 표본에서 `HOUSE_MANAGE_NO`와 항상 동일했다 — 표본이 5건뿐이라 일반화할 수 없으며, 실제로 다를 수 있는 케이스(예: 동일 관리번호에 재공고 시 공고번호만 갱신)가 있는지는 이번 조사로 확정할 수 없다.
- **판단**: `Presale.houseManageNo`에 이미 걸려 있는 `@unique` 제약은 **Detail 레벨(1개 분양 공고당 1 row)에서는 현재 구조로 충분**하다.
- 다만 **주택형별(Mdl) 데이터를 저장하려면 새로운 식별자 전략이 필요**하다 — 하나의 `houseManageNo`가 여러 `MODEL_NO`/`HOUSE_TY` 조합을 가지므로, 별도 테이블에 `(houseManageNo, modelNo)` 또는 `(houseManageNo, houseTy)` 복합 unique가 필요하다(아래 K섹션). 이번 P1에서는 schema를 만들지 않는다.

---

## I. 날짜/숫자 변환 이슈

| 항목 | 실측 결과 | 현재 파서 처리 가능 여부 |
|---|---|---|
| 날짜 형식 | `"YYYY-MM-DD"`(예: `"2026-08-10"`) | **안전** — `parseDate()`의 `new Date(raw)`가 ISO 유사 형식을 정상 파싱함 |
| `MVN_PREARNGE_YM`(입주예정월) | `"YYYYMM"` 6자리(예: `"203005"`) | 현재 코드에 이 필드를 다루는 로직이 아예 없음 — 추가 시 `new Date(raw)`로는 파싱 안 되므로 별도 파서 필요(연/월만 있고 일자가 없는 값을 임의로 1일로 채울지 여부도 결정 필요) |
| 세대수(`TOT_SUPLY_HSHLDCO`) | JSON **number** 타입으로 옴(`594`) | 안전 — 코드가 `parseInt(String(...))`으로 방어적으로 처리해 문자열/숫자 어느 쪽이 와도 문제없음 |
| 분양가(`LTTOT_TOP_AMOUNT`, Mdl) | JSON **문자열** 타입 숫자(`"79831"`) | 아직 코드에 파싱 로직 없음(Detail만 다루므로) — 단위(만원 추정)를 공식 문서로 재확인 없이 임의로 단정하지 않음 |
| null 처리 | 관측된 다수 필드가 실제 JSON `null`(빈 문자열이 아님, 예: `GNRL_RNK1_ETC_GG_ENDDE: null`) | 안전 — `parseDate(undefined/null)`은 `if (!raw) return null`로 정상 처리됨 |
| 주소 구조 | `HSSPLY_ADRES`는 시/도~지번까지 이어진 단일 텍스트(예: `"경기도 성남시 수정구 신흥동 81-8"`) — 필드가 분리되어 있지 않음 | 현재 코드는 분리하지 않고 그대로 저장(`locationAddress`가 단일 String이라 구조적으로 일치) |
| "값 없음을 임의값(0 등)으로 치환" 여부 | `totalHouseholds`는 파싱 실패 시 `null` 유지(0으로 치환하지 않음 — 안전). 다만 `mapHouseType()`은 값이 없거나 매칭 안 되면 **암묵적으로 `APT`를 기본값으로 채운다** — "모름"과 "실제로 APT임"을 구분하지 못하는 구조라는 점에서 유사한 리스크로 기록해둔다 | 이번 P1에서는 수정하지 않음(요청에 따름) |

---

## J. syncApplyhomeListings 평가

**분류: C. 상당한 수정 필요** (D의 "완전 스텁"은 아님 — 호출 골격과 upsert 전략은 실제로 유효하다)

**맞는 부분(그대로 유지 가능)**:
- Endpoint URL, `serviceKey`/`page`/`perPage` 파라미터 — 실측으로 정확함을 확인.
- 응답 봉투 파싱(`Array.isArray(json?.data) ? json.data : []`) — 정확함.
- `HOUSE_MANAGE_NO` 기준 upsert 전략과 "관리번호 없으면 skip" 로직 — 안전하고 합리적(지어낸 키로 매칭하지 않는다는 원칙을 이미 지키고 있음).
- `parseDate()` — 실제 날짜 형식과 호환됨.
- `houseName`, `locationAddress`, `constructCompany`, `totalSupplyHouseholds`, `pblancNo`, `announcementDate`, `winnerDate` 매핑 — 전부 정확함.

**틀린 부분(수정 필요, 이번 P1에서는 미수정)**:
1. `receiptStartDate`/`receiptEndDate`가 존재하지 않는 필드명(`SUBSCRPT_RCEPT_BGNDE`/`SUBSCRPT_RCEPT_ENDDE`)을 참조하고 있어, 지금 그대로 돌리면 **이 두 컬럼은 항상 `null`로 저장된다.** 실제 필드명은 `RCEPT_BGNDE`/`RCEPT_ENDDE`다.
2. `pblancUrl`도 존재하지 않는 필드명(`LTTOT_PBLANC_URL`)을 참조 중이라 **항상 `null`로 저장된다.** 실제 필드명은 `PBLANC_URL`이다.
3. `mapHouseType()`이 가정한 값(`"오피스텔"`, `"도시형"`, `"잔여"`/`"무순위"` 같은 한글 부분 문자열)이 실측된 `HOUSE_SECD_NM` 값(`"APT"`, `"신혼희망타운"`)과 형태가 달라 신뢰할 수 없다. 지금은 우연히 매칭되는 문자열이 없어 전부 기본값 `APT`로 떨어지는데, 이게 "정말 아파트라서"가 아니라 "매칭 로직이 못 맞춰서" 생기는 결과라는 점이 문제다. 오피스텔/도시형생활주택 공고가 섞여 들어오면 전부 잘못 `APT`로 분류될 위험이 있다.
4. `minPrice`/`maxPrice`를 채우는 로직 자체가 없다 — Detail API에는 가격 필드가 없으므로 구조적으로 당연한 결과이지만, 향후 Mdl 연동 없이는 영구히 채울 수 없다는 점을 명확히 해둔다.

이번 P1에서는 위 문제를 코드로 수정하지 않았다(조사만 수행).

---

## K. 주택형별 API 확장

`getAPTLttotPblancMdl`을 `HOUSE_MANAGE_NO` 필터로 실제 호출해 정상 응답(HTTP 200, 실 데이터)을 확인했다(§E-4, §F-2).

**제공 가능성 확인 결과**:
- 주택형: **가능**(`HOUSE_TY`)
- 전용면적: **가능**(`SUPLY_AR` — 정확히는 "공급면적"으로 보이며, 전용면적과 동일 개념인지는 공식 문서 재확인 필요. `HOUSE_TY` 코드 자체("055.9700A")에도 전용면적으로 보이는 숫자가 포함되어 있어 상호 검증 가능해 보임)
- 공급세대수(일반/특별): **가능**(`SUPLY_HSHLDCO`, `SPSPLY_HSHLDCO`)
- 분양가격: **가능해 보이나 단위 미확인**(`LTTOT_TOP_AMOUNT`) — 공식 문서로 단위(만원/원)를 재확인하기 전에는 임의로 단정하지 않는다
- 특별공급: **가능**(신혼부부/다자녀/노부모부양/생애최초/기관추천 등 유형별 세대수 필드가 세분화되어 있음)
- 일반공급: **가능**(`SUPLY_HSHLDCO`)

**설계 후보(schema 변경 없이 후보만 기록)**:
- `Presale`(1) : `PresaleUnitType` 또는 `PresaleHouseTypeDetail`(N) 형태의 신규 하위 테이블을 두고, `houseManageNo`를 조인 키로 연결하는 것이 자연스러워 보인다(공식 API 자체가 이 키로 두 엔드포인트를 연결하고 있으므로).
- 하위 테이블의 unique 제약 후보: `(houseManageNo, modelNo)` 또는 `(houseManageNo, houseTy)` 복합 unique — Mdl 응답에서 한 공고당 여러 row가 오므로 Detail과 동일하게 `houseManageNo` 단일 unique로는 부족하다.
- `Presale.minPrice`/`maxPrice`는 하위 테이블에 담긴 여러 주택형의 가격 중 최소/최대를 파생시켜 채우는 방식(예: 동기화 시점에 계산해서 상위 테이블에 캐싱)이 현재 스키마 구조(단일 min/max 컬럼)와 가장 잘 맞아 보인다 — 다만 이는 설계 판단이며 이번 P1에서 확정하지 않는다.

---

## L. P2 구현 권고사항

1. `syncApplyhomeListings()`의 확인된 필드명 버그 수정: `RCEPT_BGNDE`/`RCEPT_ENDDE`, `PBLANC_URL`로 교체.
2. `mapHouseType()`을 실제 관측값(`APT` 같은 코드성 문자열, `신혼희망타운` 같은 특수 카테고리) 기준으로 재작성 — 가능하면 더 큰 표본(여러 페이지)으로 `HOUSE_SECD_NM`/`HOUSE_SECD` 값의 전체 집합을 먼저 조사한 뒤 매핑 규칙을 확정할 것을 권고한다.
3. 청약접수 시작/종료일을 "1순위 해당지역 기준"으로 할지, "특별공급 포함 전체 중 최초 시작~최종 종료"로 할지 등 대표값 정책을 결정해야 한다(현재 스키마의 단일 컬럼 구조로는 9종의 세분화된 접수기간을 전부 담을 수 없음).
4. `minPrice`/`maxPrice`를 채우려면 `getAPTLttotPblancMdl` 연동이 반드시 필요하다(Detail만으로는 구조적으로 불가능함을 이번 P1에서 실측 확인).
5. schema 확장 후보(우선순위 판단은 P2 이후): `SUBSCRPT_AREA_CODE_NM`(공급지역), `MVN_PREARNGE_YM`(입주예정월), `CNTRCT_CNCLS_BGNDE`/`ENDDE`(계약기간), `RENT_SECD_NM`(분양/임대 구분), `HMPG_ADRES`, `MDHS_TELNO`, `BSNS_MBY_NM`(사업주체).
6. `latitude`/`longitude`는 API에 없으므로, 채우려면 `HSSPLY_ADRES` 기반의 별도 지오코딩이 필요하다 — 이 프로젝트가 이미 아파트 실거래/학교 검색 등에서 쓰고 있는 Kakao 지오코딩 인프라를 재사용할 수 있는지는 별도 검토가 필요하다(이번 P1 범위 밖).
7. 주택형별(Mdl) 데이터를 담을 신규 하위 테이블 설계 — K섹션의 설계 후보 참고, `(houseManageNo, modelNo 또는 houseTy)` 복합 unique로 검토.
8. 관리자 동기화 트리거(수동 버튼 또는 배치/cron)는 위 필드 매핑 버그가 먼저 고쳐진 뒤에 연결하는 것이 안전하다 — 지금 상태로 트리거만 붙이면 `receiptStartDate`/`receiptEndDate`/`pblancUrl`이 항상 `null`로 채워지고 `houseType`도 신뢰할 수 없는 상태로 데이터가 쌓이게 된다.
9. `RENT_SECD_NM`(분양/임대 구분) 필드를 P2에서 필터링에 쓸지(예: "분양주택"만 수집) 여부를 결정해야 한다 — 현재 `syncApplyhomeListings()`는 이 구분 없이 전부 수집하도록 되어 있어, 연동 시 임대주택 공고까지 "분양정보"로 섞여 들어갈 수 있다.

---

## P1 최종 검수 결정

검수일: 2026-08-12

### 1. 공식 API

한국부동산원 청약홈 분양정보 조회 서비스의

- `getAPTLttotPblancDetail`
- `getAPTLttotPblancMdl`

두 endpoint 모두 실제 호출 성공을 확인했다.

### 2. 기존 Presale Model

현재 `Presale` Model의 기본 구조는 유지한다.

다만 향후 P2에서 실제 API 구조에 맞게 필요한 필드를 보완할 수 있다.

현재 schema를 폐기하거나 전면 재설계하지 않는다.

### 3. 확인된 기존 코드 문제

`syncApplyhomeListings()`에서 확인된 다음 문제는 P2 구현 시 수정 대상으로 확정한다.

- `receiptStartDate` 필드 매핑
- `receiptEndDate` 필드 매핑
- `pblancUrl` 필드 매핑
- `houseType` 매핑

단, P1에서는 수정하지 않는다.

### 4. 분양가격

`LTTOT_TOP_AMOUNT`는 실제 API에서 존재함을 확인했으나 단위를 아직 100% 검증하지 못했다.

따라서 단위를 추측하여 `Presale.minPrice` / `maxPrice`에 저장하지 않는다.

P2-A에서 실제 공고와 API 값을 비교하여 단위를 검증한 뒤 저장 정책을 결정한다.

### 5. 주택형 데이터

`getAPTLttotPblancMdl`을 통해

- 주택형
- 면적
- 공급세대
- 특별공급
- 일반공급
- 분양가격 관련 데이터

확보 가능성을 확인했다.

향후 `Presale`과 1:N 관계의 주택형별 하위 데이터 구조를 우선 검토한다.

아직 schema를 생성하지 않는다.

### 6. 좌표

청약홈 Detail/Mdl API에는 `latitude` / `longitude`가 없음을 확인했다.

향후 주소 기반 지오코딩을 통해 좌표를 확보하는 방향을 검토한다.

현재 프로젝트에 이미 존재하는 Kakao 관련 지오코딩 기능을 우선 재사용 검토한다.

새로운 외부 지도 API를 임의로 추가하지 않는다.

### 7. 분양/임대

`RENT_SECD_NM` 등 실제 API 값을 P2-A에서 표본 조사한다.

현재 단계에서는 임대 데이터를 임의로 삭제하거나 제외하지 않는다.

향후 이집 UI에서

분양 / 임대

등으로 구분할 수 있도록 원본 데이터의 의미를 최대한 보존하는 방향을 검토한다.
