# 이집 분양정보 DB 연동 — P2-B

작성일: 2026-08-12
성격: P1/P2-A에서 검증한 정책을 실제로 구현하고, 소량(8건) 실 데이터로 검증한 결과 기록

---

## A. Schema 변경

기존 데이터베이스는 Prisma Migrate 이력 없이 `db push`로만 관리되고 있었다(`prisma migrate status` 확인 결과 "The current database is not managed by Prisma Migrate").이번 STEP에서 처음으로 마이그레이션 이력을 도입해야 했으므로, **파괴적 변경 없이** 다음 순서로 진행했다.

1. **베이스라인 생성**: 기존 스키마 상태를 그대로 나타내는 마이그레이션(`0_baseline`)을 `prisma migrate diff --from-empty --to-schema-datamodel`로 생성한 뒤, 실제 SQL을 실행하지 않고 `prisma migrate resolve --applied 0_baseline`으로 "이미 적용됨"으로만 기록했다(순수 북키핑, DB에 어떤 SQL도 실행되지 않음).
2. `prisma migrate status`로 베이스라인 이후 상태가 "Database schema is up to date!"임을 확인.
3. schema.prisma에 이번 STEP의 실제 변경사항(Presale 필드 추가, PresaleHouseTypeDetail 신규 모델)을 반영.
4. `prisma migrate dev --create-only`로 마이그레이션 SQL만 생성(적용 안 함) → **SQL 내용을 직접 검토**.
5. 생성된 SQL이 `ALTER TABLE ... ADD COLUMN`(전부 nullable) + `CREATE TABLE`(신규 테이블) + `CREATE INDEX` + `ADD CONSTRAINT`(FK)뿐이고, **DROP/DELETE/데이터 손실 가능 구문이 전혀 없음을 확인한 뒤** `prisma migrate deploy`로 적용.

`prisma migrate reset`, DB 초기화, 기존 테이블 DROP, 기존 컬럼 삭제는 어디에도 수행하지 않았다.

---

## B. Presale 변경사항

기존 필드는 **하나도 삭제하지 않았다.** 다음 10개 필드를 P2-A "P2-A 최종 검수 결정" 기준으로 추가했다.

| 신규 필드 | Prisma 타입 | API 원본 | 비고 |
|---|---|---|---|
| `houseSecd` | `String?` | `HOUSE_SECD` | 주택유형 원본 코드 |
| `houseSecdName` | `String?` | `HOUSE_SECD_NM` | 주택유형 원본 명칭("APT", "신혼희망타운" 등) |
| `rentSecd` | `String?` | `RENT_SECD` | 분양/임대 구분 원본 코드 |
| `rentSecdName` | `String?` | `RENT_SECD_NM` | 분양/임대 구분 원본 명칭("분양주택", "분양전환 가능임대" 등) |
| `subscriptionAreaCode` | `String?` | `SUBSCRPT_AREA_CODE` | 공급지역 코드(시/도 단위) |
| `subscriptionAreaName` | `String?` | `SUBSCRPT_AREA_CODE_NM` | 공급지역 명칭 |
| `businessEntityName` | `String?` | `BSNS_MBY_NM` | 사업주체(시행사), `constructCompany`(시공사)와 별개 |
| `contractStartDate` | `DateTime?` | `CNTRCT_CNCLS_BGNDE` | 계약체결 시작일 |
| `contractEndDate` | `DateTime?` | `CNTRCT_CNCLS_ENDDE` | 계약체결 종료일 |
| `moveInExpectedYm` | `String?` | `MVN_PREARNGE_YM` | 입주예정월, `"YYYYMM"` 원본 문자열 그대로(DateTime 변환 안 함) |

기존 필드(`houseManageNo`, `pblancNo`, `houseName`, `houseType`, `locationAddress`, `latitude`, `longitude`, `totalSupplyHouseholds`, `constructCompany`, `announcementDate`, `receiptStartDate`, `receiptEndDate`, `winnerDate`, `pblancUrl`, `minPrice`, `maxPrice`)은 이름·타입·nullable 여부 전부 그대로 유지했다. `houseType`(`PresaleHouseType` enum) 필드도 삭제·확장하지 않고 그대로 두었다(§F 참고).

---

## C. PresaleHouseTypeDetail

P2-A 설계안(§O)을 실제 schema로 구현했다.

```prisma
model PresaleHouseTypeDetail {
  id            Int      @id @default(autoincrement())
  presaleId     Int      @map("presale_id")
  presale       Presale  @relation(fields: [presaleId], references: [id], onDelete: Cascade)

  houseManageNo String   @map("house_manage_no")
  modelNo       String   @map("model_no")
  houseTy       String?  @map("house_ty")
  supplyArea    Float?   @map("supply_area")
  generalSupply Int?     @map("general_supply")
  specialSupply Int?     @map("special_supply")
  totalSupply   Int?     @map("total_supply")
  topAmount     Int?     @map("top_amount")

  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @default(now()) @updatedAt @map("updated_at")

  @@unique([houseManageNo, modelNo])
  @@index([presaleId])
  @@map("presale_house_type_details")
}
```

- `totalSupply`는 API 원본 필드가 아니라 `generalSupply + specialSupply`의 단순 합산이다(둘 다 값이 있을 때만 계산, 하나라도 없으면 `null`) — 지어낸 값이 아니라 실제로 저장된 두 숫자의 산술 합임을 코드 주석에 명시했다.
- `topAmount`는 만원 단위(P2-A 실측 검증)의 해당 주택형 최고 분양가.

---

## D. Relation / Unique 전략

- **관계**: `Presale`(1) : `PresaleHouseTypeDetail`(N), Prisma `@relation`으로 FK 강제(요청대로).
- **복합 unique**: `@@unique([houseManageNo, modelNo])` — P2-A에서 4개 공고 27개 row 전부 이 조합이 유니크함을 실측 확인했고, 이번 P2-B의 8개 공고 47개 row에서도 위반 없이 정상 적용됨을 확인했다(§K).
- **onDelete 정책**: `Cascade`를 채택했다. 임의로 넣은 기본값이 아니라, 기존 스키마의 유사 관계(`Comment.post → onDelete: Cascade`, "부모 없이는 의미 없는 순수 종속 데이터")를 확인한 뒤 같은 성격이라고 판단해 결정했다(`Post.author`처럼 "부모가 사라져도 독립적으로 의미 있는 콘텐츠"인 관계는 이 프로젝트에서도 cascade를 쓰지 않는다 — `PresaleHouseTypeDetail`은 그 경우가 아니다).

---

## E. Detail 매핑

`syncApplyhomeListings()`(`src/services/cheongyakService.ts`)를 P1/P2-A에서 확인된 오류를 반영해 재작성했다.

| 필드 | 수정 전 | 수정 후 |
|---|---|---|
| `receiptStartDate` | `SUBSCRPT_RCEPT_BGNDE`(존재하지 않는 필드 — 항상 `undefined`) | `RCEPT_BGNDE` |
| `receiptEndDate` | `SUBSCRPT_RCEPT_ENDDE`(존재하지 않는 필드) | `RCEPT_ENDDE` |
| `pblancUrl` | `LTTOT_PBLANC_URL`(존재하지 않는 필드) | `PBLANC_URL` |
| `houseType`(enum) | 한글 풀네임 부분일치 매칭(실제로는 매칭 안 됨) | 그대로 유지(호환성 최소 처리), 신뢰 가능한 값은 `houseSecd`/`houseSecdName`으로 별도 저장 |
| (신규) `houseSecd`/`houseSecdName` | 없음 | `HOUSE_SECD`/`HOUSE_SECD_NM` 원본 그대로 |
| (신규) `rentSecd`/`rentSecdName` | 없음 | `RENT_SECD`/`RENT_SECD_NM` 원본 그대로 |
| (신규) `subscriptionAreaCode`/`Name` | 없음 | `SUBSCRPT_AREA_CODE`/`SUBSCRPT_AREA_CODE_NM` |
| (신규) `businessEntityName` | 없음 | `BSNS_MBY_NM` |
| (신규) `contractStartDate`/`EndDate` | 없음 | `CNTRCT_CNCLS_BGNDE`/`CNTRCT_CNCLS_ENDDE` |
| (신규) `moveInExpectedYm` | 없음 | `MVN_PREARNGE_YM`(문자열 그대로) |

`houseManageNo`가 없는 레코드는 여전히 skip(지어낸 키로 매칭하지 않음, 기존 원칙 유지).

---

## F. Mdl 매핑

Detail 레코드 하나를 upsert한 직후, 같은 `houseManageNo`로 `getAPTLttotPblancMdl`을 조회해 `PresaleHouseTypeDetail`에 upsert하는 `syncHouseTypeDetails()` 함수를 새로 추가했다.

- `MODEL_NO`가 없는 레코드는 임의 ID를 만들지 않고 skip + `console.warn` 로그만 남긴다(요청대로).
- `SUPLY_AR`(공급면적), `LTTOT_TOP_AMOUNT`(가격)는 문자열/숫자 어느 형태로 와도 안전하게 파싱하는 `parseFloatSafe`/`parseIntSafe` 헬퍼로 처리(파싱 실패 시 `null`, 0으로 치환하지 않음).
- `SUPLY_HSHLDCO`/`SPSPLY_HSHLDCO`(일반/특별공급 세대수)는 원본이 이미 number 타입인 경우 그대로 쓰고, 방어적으로 문자열 케이스도 처리한다. 0은 "실제로 공급 0건"이라는 유효한 값으로 그대로 저장한다(null과 혼동하지 않음).

**houseType 기존 enum 보호(§ 요청 6)**: `mapHouseType()`은 삭제·확장하지 않고 그대로 두었다. 다만 이 매핑이 신뢰할 수 없다는 사실(P2-A에서 확인: "오피스텔"/"도시형" 값이 이 API 범위에서 관측되지 않음)을 코드 주석에 명시하고, 원본값은 `houseSecd`/`houseSecdName`에 별도로 보존해 향후 오피스텔/도시형 전용 API 연동 시 통합 정책을 결정할 수 있게 해뒀다.

---

## G. 가격 정책

- `PresaleHouseTypeDetail.topAmount`는 만원 단위(P2-A 실측 교차검증으로 확정된 그대로).
- `Presale.minPrice`/`maxPrice`는 해당 공고의 `PresaleHouseTypeDetail` 중 **유효한(파싱 가능한, null이 아닌) `topAmount` 값들의 최소/최대**로, Mdl 동기화 직후 별도 `presale.update()` 호출로 계산·저장한다.
- 가격이 하나도 없으면(모든 주택형의 `topAmount`가 `null`) `minPrice`/`maxPrice`를 건드리지 않는다 — 0으로 저장하지 않는다.
- 실제 8건 적재 결과, 8건 전부 유효한 가격이 1개 이상 있어 `minPrice`/`maxPrice`가 정상 계산됨을 확인했다(§K).

---

## H. 날짜 정책

| API 필드 | 저장 방식 | 검증 결과 |
|---|---|---|
| `RCRIT_PBLANC_DE` | `DateTime?`(`announcementDate`) | 8건 전부 정상 파싱 |
| `RCEPT_BGNDE`/`RCEPT_ENDDE` | `DateTime?`(`receiptStartDate`/`receiptEndDate`) | 8건 전부 정상 파싱 |
| `PRZWNER_PRESNATN_DE` | `DateTime?`(`winnerDate`) | 8건 전부 정상 파싱 |
| `CNTRCT_CNCLS_BGNDE`/`ENDDE` | `DateTime?`(`contractStartDate`/`contractEndDate`) | 8건 전부 정상 파싱 |
| `MVN_PREARNGE_YM` | **`String?` 그대로**(`moveInExpectedYm`) | DateTime으로 강제 변환하지 않음(요청대로) |

`parseDate()`는 빈 문자열/`undefined`를 `null`로, 파싱 불가능한 문자열(`isNaN(d.getTime())`)도 `null`로 처리한다 — 임의의 날짜를 만들어내지 않는다.

---

## I. 지오코딩

`geocodeAddress()` 함수를 `cheongyakService.ts`에 새로 추가했다 — **새 지도 API나 새 패키지는 추가하지 않았고**, 이 프로젝트가 이미 여러 곳(`src/app/api/school/stats/route.ts`의 구 중심좌표 조회, `src/lib/geocode-apt.ts` 등)에서 쓰는 **Kakao Local 주소 검색 API를 동일한 인증 방식(KA/Origin 헤더 우회)으로 재사용**했다.

- 실제 8건 테스트 결과: **5건 성공, 3건 실패**(성남복정2/더샵신길/써밋클라비온/충정로역자이르네/달서자이제니크 성공, 시흥거모/용인반도체클러스터/세종우미린 실패).
- 실패한 3건은 예외 없이 전부 P2-A에서 예측했던 패턴(**"일원" + 택지지구/산업단지 블록 표기**)이었다 — `"경기도 시흥시 거모동, 군자동 일원 시흥거모 공공주택지구 내 A-5블록"`, `"경기도 용인시 처인구 원삼면 용인 반도체 클러스터 일반산업단지 D1-1BL"`, `"세종특별자치시 다솜동 5204-1번지 일원(행정중심복합도시 5-2생활권 S1BL)"`. P2-A의 예측이 실측으로 정확히 재현됐다.
- 실패 시 `latitude`/`longitude`는 `null`로 유지되고 **임의 좌표나 지역 중심 좌표를 채우지 않는다.**
- **기존 좌표 보존 로직**: upsert 전에 해당 `houseManageNo`의 기존 `latitude`/`longitude`를 먼저 조회해 기본값으로 삼고, 새 지오코딩이 성공했을 때만 덮어쓴다 — 실패했다고 기존의 좋은 값을 `null`로 되돌리지 않는다. 이번 8건은 모두 신규 레코드라 "기존 좋은 값을 실패로 덮어쓰는" 시나리오 자체가 발생하지 않았지만(전부 최초 삽입), 코드 로직상 보장됨을 리뷰로 확인했다.

---

## J. Upsert 정책

- **Presale**: `houseManageNo` 기준 upsert(기존과 동일). 최신 API 값으로 갱신하되, `latitude`/`longitude`는 §I의 보존 로직을 통해 계산된 값을 쓴다(무조건 최신 지오코딩 결과로 덮어쓰지 않음).
- **PresaleHouseTypeDetail**: `(houseManageNo, modelNo)` 기준 upsert.
- **idempotency 검증**: 동일 8건에 대해 sync를 2회 연속 실행한 결과, `Presale` 8행 / `PresaleHouseTypeDetail` 47행으로 **행 수 변화 없음**을 확인했다(§L).

---

## K. 소량 적재 결과

`scripts/sync_presales_test.ts`(perPage=8, page=1)로 실제 청약홈 API에서 8개 공고를 가져와 저장했다.

| houseName | houseSecdName | rentSecdName | 지역 | 지오코딩 | houseTypeDetails | minPrice~maxPrice(만원) |
|---|---|---|---|---|---|---|
| 성남복정2 A1블록 신혼희망타운(본청약) | 신혼희망타운 | 분양주택 | 경기 | 성공 | 4 | 79,831~81,214 |
| 시흥거모 A-5블록 신혼희망타운(본청약) | 신혼희망타운 | 분양주택 | 경기 | 실패(null) | 2 | 44,555~44,812 |
| 더샵 신길센트럴시티(조합원 취소분) | APT | 분양주택 | 서울 | 성공 | 13 | 118,000~184,000 |
| 용인반도체클러스터 동일하이빌 파크밸리 | APT | 분양주택 | 경기 | 실패(null) | 6 | 39,700~53,400 |
| 써밋 클라비온 | APT | 분양주택 | 서울 | 성공 | 7 | 130,370~186,630 |
| 충정로역자이르네 | APT | 분양주택 | 서울 | 성공 | 5 | 100,400~245,500 |
| 달서자이 제니크 | APT | 분양주택 | 대구 | 성공 | 2 | 58,660~59,730 |
| 세종 우미 린 센터파크 | APT | 분양주택 | 세종 | 실패(null) | 8 | 29,500~64,560 |

- APT/신혼희망타운 두 유형 모두 포함됨을 확인했다("분양주택" 외 다른 `rentSecdName` 값은 이번 8건 표본에는 없었다 — P2-A에서 확인한 "분양전환 가능임대"는 이번 표본 범위 밖).
- 8건 모두 `houseManageNo` 유일, `PresaleHouseTypeDetail` 총 47건 저장, `(houseManageNo, modelNo)` unique 제약 위반 없음.
- 지역 분포: 경기 2 / 서울 3 / 대구 1 / 세종 1 — 서로 다른 지역 포함.

---

## L. 중복 검증

동일한 `scripts/sync_presales_test.ts 8` 명령을 **2회 연속 실행**했다.

| 항목 | 1회차 결과 | 2회차 결과 | DB 실제 행 수(2회차 후) |
|---|---|---|---|
| `fetched` | 8 | 8 | — |
| `upserted`(Presale) | 8 | 8 | **8**(변화 없음) |
| `houseTypeDetailsUpserted` | 47 | 47 | **47**(변화 없음) |
| `geocoded` | 5 | 5 | — |
| `geocodeFailed` | 3 | 3 | — |

`prisma.presale.count()`/`prisma.presaleHouseTypeDetail.count()`로 직접 조회해 두 값이 1회차·2회차 사이 늘지 않았음을 확인했다 — **sync는 idempotent하다.**

---

## M. 테스트 결과

- **prisma validate**: 통과(`The schema at prisma\schema.prisma is valid`).
- **migration 적용**: 베이스라인 + `presale_p2b_schema` 마이그레이션 모두 정상 적용, `prisma migrate status`가 "Database schema is up to date!" 반환.
- **TypeScript**: `npx tsc --noEmit` — 오류 없음.
- **lint**: `npx eslint`(`cheongyakService.ts`, `api/presales/route.ts`, `scripts/sync_presales_test.ts`) — 오류/경고 없음.
- **build**: `npx next build` — 성공, `/api/presales`, `/redevelopment` 등 기존 라우트 전부 정상 포함.
- **런타임 확인**: 로컬 dev 서버에서 `GET /api/presales`(전체), `GET /api/presales?status=upcoming`(필터) 둘 다 HTTP 200으로 새 필드가 포함된 정상 JSON을 반환함을 확인. `/redevelopment` 페이지(분양·청약 탭이 있는 화면)도 HTTP 200으로 정상 렌더링됨을 확인(이번 STEP에서 이 페이지가 실제로 새 데이터를 가져와 보여주도록 연결하지는 않았다 — UI 미변경 원칙에 따름). `/admin/dashboard`도 기존과 동일하게 인증 리다이렉트(307)로 정상 동작.
- **기존 DB 데이터 보호 확인**: 마이그레이션 적용 전후로 `PageView`(17건) 등 기존 테이블의 데이터가 그대로 유지됨을 확인했다(DROP/RESET 없었음을 재확인).

---

## N. 발견된 문제

- 없음(코드 결함 관점) — 이번 STEP에서 구현한 로직은 P1/P2-A의 실측 검증 결과와 정확히 일치하는 동작을 보였다.
- (정보성) 지오코딩 실패율이 예상대로 상당함(8건 중 3건, 37.5%) — 전부 "일원"/택지지구 표기 주소였다. 전체 2,843건으로 확장하면 이 비율의 레코드가 좌표 없이 저장될 것으로 예상된다. 좌표가 필요한 화면(지도 연동 등)을 만들 때는 이 결측 비율을 감안해야 한다(이번 STEP에서 UI/지도 연동은 하지 않았으므로 실제 영향은 없음).
- (정보성) 8건 표본에는 "분양전환 가능임대"(`rentSecdName`) 유형이 없어, 이 값이 실제로 저장되는 것까지는 이번 P2-B에서 재확인하지 못했다(P2-A에서 50건 표본으로는 확인했으나, 저장 코드 자체는 이번에 처음 실행됨) — 코드 로직상 원본 문자열을 그대로 저장하므로 문제는 없을 것으로 판단되나, 실제 해당 유형 레코드로 재확인된 것은 아니다.

---

## O. 다음 단계

이번 STEP에서 하지 않은 것(향후 별도 STEP에서 결정):

- 전국 2,843건 전체 동기화(이번엔 8건만).
- 관리자 동기화 버튼, cron/스케줄러 연결(수동 스크립트 실행만 검증).
- 오피스텔/도시형생활주택 전용 API 연동(`PresaleHouseType` enum의 나머지 값 채우기).
- 분양 UI(`/redevelopment`의 "분양·청약" 탭 등)를 이번에 저장한 실제 데이터로 채우는 작업 — 현재 이 탭은 여전히 정적 "준비 중" 카드만 보여준다(변경하지 않았음).
- 지도 연동(분양 마커 표시 등).
- 지오코딩 실패율(약 37.5%)을 낮추기 위한 주소 전처리(예: "일원"/블록 표기 정규화) 검토 여부(P2-C 후보).

---

## P. 검수 보완 (2026-08-12)

### P-1. totalSupply 매핑 — 검토 결과, 요청된 매핑을 적용하지 않음

검수 요청은 다음 매핑을 제안했다.

```
totalSupply ← SUPLY_HSHLDCO
generalSupply ← GNRL_HSHLDCO
specialSupply ← SPSPLY_HSHLDCO
```

이를 적용하기 전에 실제 API 응답을 다시 확인한 결과, **`GNRL_HSHLDCO` 필드는 `getAPTLttotPblancMdl` 응답에 존재하지 않는다.** 실제 응답 필드는 다음 16개뿐이다(2026-08-12 재확인, 라이브 호출로 재검증):

```
ETC_HSHLDCO, HOUSE_MANAGE_NO, HOUSE_TY, INSTT_RECOMEND_HSHLDCO, LFE_FRST_HSHLDCO,
LTTOT_TOP_AMOUNT, MNYCH_HSHLDCO, MODEL_NO, NWBB_HSHLDCO, NWWDS_HSHLDCO,
OLD_PARNTS_SUPORT_HSHLDCO, PBLANC_NO, SPSPLY_HSHLDCO, SUPLY_AR, SUPLY_HSHLDCO,
TRANSR_INSTT_ENFSN_HSHLDCO, YGMN_HSHLDCO
```

`GNRL_HSHLDCO`로 존재하지 않는 필드를 매핑하면 `generalSupply`가 항상 `undefined`/`null`이 되어 데이터를 오히려 잃는다 — "공식 원본값과 파생 계산값을 혼동하지 않는다"는 이번 검수의 취지 자체와 어긋나는 결과가 된다. 그래서 이 매핑은 적용하지 않았다.

대신, `SUPLY_HSHLDCO`/`SPSPLY_HSHLDCO`가 실제로 무엇을 의미하는지 **이미 저장된 실 데이터로 교차검증**했다. 각 Presale마다 하위 `PresaleHouseTypeDetail` 전체의 `sum(generalSupply)`(=`SUPLY_HSHLDCO` 합)와 `sum(specialSupply)`(=`SPSPLY_HSHLDCO` 합)를 더한 값을, **완전히 독립된 Detail API 필드**인 `Presale.totalSupplyHouseholds`(`TOT_SUPLY_HSHLDCO`)와 비교했다.

| houseName | Detail.totalSupplyHouseholds | sum(SUPLY_HSHLDCO) | sum(SPSPLY_HSHLDCO) | 합계 | 일치 여부 |
|---|---|---|---|---|---|
| 용인반도체클러스터 동일하이빌 파크밸리 | 589 | 129 | 460 | 589 | 일치 |
| 세종 우미 린 센터파크 | 676 | 240 | 436 | 676 | 일치 |
| 써밋 클라비온 | 176 | 83 | 93 | 176 | 일치 |
| 충정로역자이르네 | 186 | 84 | 102 | 186 | 일치 |
| 더샵 신길센트럴시티(조합원 취소분) | 67 | 31 | 36 | 67 | 일치 |
| 달서자이 제니크 | 360 | 164 | 196 | 360 | 일치 |
| 성남복정2 A1블록 신혼희망타운(본청약) | 594 | 0 | 166 | 166 | **불일치**(§P-2) |
| 시흥거모 A-5블록 신혼희망타운(본청약) | 290 | 0 | 284 | 284 | **불일치**(§P-2) |

8건 중 6건에서 `SUPLY_HSHLDCO + SPSPLY_HSHLDCO`가 완전히 독립된 Detail 필드(`TOT_SUPLY_HSHLDCO`)와 정확히 일치했다 — 이는 `SUPLY_HSHLDCO`가 "일반공급" 세대수이고 `SPSPLY_HSHLDCO`가 "특별공급" 세대수이며, 이번 P2-B 구현이 이미 채택한 매핑(`generalSupply ← SUPLY_HSHLDCO`, `specialSupply ← SPSPLY_HSHLDCO`, `totalSupply = generalSupply + specialSupply`)이 **실측으로 뒷받침되는 올바른 매핑**임을 강하게 뒷받침한다. 따라서 **코드는 변경하지 않았다.**

### P-2. 공급세대 정합성 조사 결과

요청된 비교(`SUPLY_HSHLDCO` vs `GNRL_HSHLDCO + SPSPLY_HSHLDCO`)는 후자의 필드가 존재하지 않아 수행할 수 없었다. 대신 §P-1의 방식(Mdl 합계 vs 독립된 Detail 총계)으로 47개 주택형 표본을 조사했다.

- **불일치 건수: 8개 Presale 중 2건**(주택형 47건 자체의 개별 불일치가 아니라, Presale 단위 합계 비교에서 2건).
- **실제 차이 사례**:
  - 성남복정2 A1블록 신혼희망타운(본청약): Detail 총계 594세대 vs Mdl 합계 166세대(차이 428세대)
  - 시흥거모 A-5블록 신혼희망타운(본청약): Detail 총계 290세대 vs Mdl 합계 284세대(차이 6세대)
- 두 사례 모두 **신혼희망타운(공공분양) 공고**라는 공통점이 있다. 웹 검색으로 확인한 성남복정2의 실제 사업 개요("경기도 성남시 수정구 신흥동 일원 총 892세대 중 금회 594세대가 공급됩니다")에 비춰보면, Detail의 `TOT_SUPLY_HSHLDCO`(594)는 이번 공고 회차의 전체 공급 규모를 가리키는 반면, 이번에 조회한 Mdl 주택형 데이터(166세대)는 그중 일부(예: 이번 회차에서 실제로 청약 접수를 받는 물량)만 반영하고 있을 가능성이 있다 — 신혼희망타운은 일반/특별공급 외에 기관추천 등 다른 트랙으로 공급되는 물량이 있을 수 있어, Detail과 Mdl이 다른 범위를 집계했을 가능성이 있다. **이 원인을 확정하지는 못했다** — 추측성 설명일 뿐 확인된 사실이 아니므로, 코드에서 이 차이를 임의로 보정하지 않았다. 두 값 모두 각자의 API 원본 그대로 저장돼 있다.

### P-3. Cascade 정책 — 의미 명시

`PresaleHouseTypeDetail.presale`는 `onDelete: Cascade`로 유지했다. 의미를 명확히 기록한다:

> **Presale이 실제로 삭제되면, 해당 공고에 속한 모든 PresaleHouseTypeDetail(주택형별 상세) 행도 함께 삭제된다.** 이는 하위 데이터가 상위 공고 없이는 독립적으로 의미를 가지지 않기 때문에 의도된 동작이다.

sync 과정(`syncApplyhomeListings`/`syncHouseTypeDetails`)이 기존 Presale을 삭제 후 재생성하는지 코드를 다시 확인했다 — `prisma.presale.upsert()`/`prisma.presaleHouseTypeDetail.upsert()`만 사용되고, `delete`/`deleteMany` 호출은 이 서비스 파일 어디에도 없음을 grep으로 재확인했다. Cascade가 실제로 발동하는 경로(예: 관리자가 Presale을 직접 삭제하는 기능)는 현재 이 코드베이스에 아예 존재하지 않는다 — 즉 이 제약은 현재는 "발동 조건 자체가 없는 안전장치"다.

### P-4. Prisma baseline 정책 확인

요청한 3가지 구조를 그대로 만족함을 재확인했다.

1. 기존 DB schema를 `0_baseline` 마이그레이션으로 기록함 — `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma`로 "빈 DB → 현재 스키마"에 필요한 SQL 전체를 생성.
2. 그 SQL을 기존 DB에 실행하지 않음 — `prisma migrate resolve --applied 0_baseline`은 `_prisma_migrations` 추적 테이블에 "적용됨"만 기록할 뿐, `migration.sql`을 실제로 실행하지 않는다(Prisma 공식 동작).
3. 이후 마이그레이션(`presale_p2b_schema`)부터 실제로 SQL이 DB에 적용됨 — `prisma migrate deploy`로 적용, 실행 전 SQL을 직접 검토해 `ADD COLUMN`/`CREATE TABLE`만 있음을 확인(§A).

이미 적용된 두 마이그레이션 파일(`0_baseline/migration.sql`, `20260812072003_presale_p2b_schema/migration.sql`)은 이번 보완에서도 수정하지 않았다.

**원칙(향후 적용)**: 앞으로 스키마를 변경할 때는 기존 마이그레이션 파일을 편집하지 않고, 항상 `prisma migrate dev --create-only`로 새 마이그레이션을 생성해 SQL을 검토한 뒤 적용한다. 이미 적용된 마이그레이션은 기록(history)이므로 사후 수정하지 않는다.

### P-5. scripts/\_register-paths.js 유지 결정

기존 `scripts/` 디렉터리의 TypeScript 실행 방식을 조사했다.

- `scripts/backfill_apt_details.ts`는 `../src/lib/apt-building-info`를 **상대경로**로 import한다 — 그런데 `apt-building-info.ts` 자체는 **어떤 것도 import하지 않는 완전히 독립된 모듈**이라, 애초에 `@/` alias를 해석할 필요 자체가 없다(간접 의존성 없음).
- `scripts/fetchData.ts`도 `@prisma/client`를 직접 import할 뿐, `@/lib/prisma` 같은 alias가 걸린 `src/` 모듈을 가져오지 않는다.
- 즉 **이 프로젝트의 기존 스크립트 중 `@/` alias를 해석해야 했던 사례가 지금까지 하나도 없었다** — "기존 표준"이 없는 상황이다.
- 이번 `cheongyakService.ts`는 `@/lib/prisma`를 내부적으로 import하는 일반 `src/` 모듈(앱 전역에서 쓰는 정상적인 관례)이라, 이를 스크립트에서 직접 재사용하려면 alias 해석이 반드시 필요했다.

판단: **`_register-paths.js`를 유지한다.** 새 패키지를 추가하지 않았고(이미 설치된 `tsconfig-paths`의 프로그래밍 API만 사용), 앱의 `tsconfig.json`이나 `cheongyakService.ts`의 import 스타일(전역 관례)을 스크립트 편의를 위해 바꾸지 않았으며, 실제로 2회 이상 정상 동작을 확인했다. 파일 수를 줄이기 위해 억지로 다른 구조로 바꾸지 않았다.

### P-6. 테스트 데이터 유지

DB에 저장된 `Presale` 8건, `PresaleHouseTypeDetail` 47건은 **삭제하지 않았다.** 이 데이터는 실제 공식 청약홈 API에서 가져온 진짜 분양 공고 데이터다(임의로 만든 샘플이 아님). 다만 이는 **전국 2,843건 중 극히 일부만 가져온 표본**이라는 점을 명확히 기록해둔다 — 전체 동기화가 이뤄지기 전까지 `/api/presales`가 반환하는 데이터는 이 8건뿐이며, 실제 서비스 대표성을 갖지 않는다.

### P-7. 지오코딩 실패 — 변경 없음, P2-C 후보로 이관

이번 보완에서 주소 전처리 로직을 추가하지 않았다. 성공 5 / 실패 3 상태 그대로 유지했다(§I). 실패 3건(시흥거모/용인반도체클러스터/세종우미린)의 `latitude`/`longitude`는 여전히 `null`이며, 임의 좌표를 채우지 않았다. "일원"/택지지구 표기 주소의 지오코딩 실패율을 낮추는 주소 전처리(정규화) 작업은 **P2-C 후보**로 남겨둔다.

### P-8. 재동기화 검증 결과

`scripts/sync_presales_test.ts 8`을 다시 실행한 결과:

- `Presale` 행 수: 8 → 8(변화 없음)
- `PresaleHouseTypeDetail` 행 수: 47 → 47(변화 없음)
- 중복 생성: 0건
- (매핑을 변경하지 않았으므로) `generalSupply`/`specialSupply`/`totalSupply` 값도 이전과 동일 — `generalSupply`=`SUPLY_HSHLDCO`, `specialSupply`=`SPSPLY_HSHLDCO` 그대로 유지됨을 재확인했다.

---

## Q. 최종 검수 결정 (2026-08-12)

### Q-1. 공급세대 정책 — 최종 확정

`getAPTLttotPblancMdl` 실제 응답에는 `GNRL_HSHLDCO` 필드가 존재하지 않음을 라이브 호출로 재확인했다(§P-1). 따라서 다음 매핑을 최종 확정한다.

- `PresaleHouseTypeDetail.generalSupply` ← `SUPLY_HSHLDCO`
- `PresaleHouseTypeDetail.specialSupply` ← `SPSPLY_HSHLDCO`
- `PresaleHouseTypeDetail.totalSupply` ← `generalSupply + specialSupply`(두 값 모두 있을 때만 계산, API 원본 필드가 아니라 산술 합)

**`Presale.totalSupplyHouseholds`는 Detail API의 `TOT_SUPLY_HSHLDCO`를 그대로 저장한다 — `PresaleHouseTypeDetail.totalSupply`의 합계와 강제로 일치시키지 않는다.** 두 값은 API상 서로 다른 의미(공고 전체의 공급 규모 vs 이번 청약에서 실제 접수받는 주택형별 공급 합계)를 가질 수 있으므로, 각각의 원본 의미를 그대로 보존한다. 코드에서 어느 한쪽을 다른 쪽에 맞춰 보정하는 로직은 두지 않았다.

### Q-2. 불일치 사례 — 최종 기록

| 공고 | Detail 총세대(`totalSupplyHouseholds`) | Mdl 주택형 공급합계(`sum(totalSupply)`) | 차이 |
|---|---|---|---|
| 성남복정2 A1블록 신혼희망타운(공공분양)(본청약) | 594 | 166 | 428 |
| 시흥거모 A-5블록 신혼희망타운(공공분양)(본청약) | 290 | 284 | 6 |

원인은 현재 단계에서 확정하지 않는다(§P-2에서 신혼희망타운의 공급 트랙 다양성에 따른 가능성만 추정으로 기록했을 뿐, 확인된 사실이 아니다). 두 값 모두 임의로 보정하지 않고 각 API 원본 그대로 저장돼 있다.

**향후 UI 표시 방향(제안, 이번 STEP에서 구현하지 않음)**: 두 수치가 다를 수 있는 공고에서는 "총 공급규모"(`Presale.totalSupplyHouseholds`)와 "이번 청약 주택형 공급합계"(`PresaleHouseTypeDetail` 합계)를 하나의 숫자로 뭉뚱그리지 않고 서로 다른 라벨로 구분 표시하는 것을 검토할 수 있다.

### Q-3. 기존 결정 유지 확인

다음은 변경 없이 그대로 유지됐다: Prisma baseline 방식(§A, §P-4), `PresaleHouseTypeDetail` relation 구조(§D), `onDelete: Cascade`(§P-3), `scripts/_register-paths.js`(§P-5), 테스트 데이터 `Presale` 8건/`PresaleHouseTypeDetail` 47건(§P-6, 삭제하지 않음), 지오코딩 실패 3건의 `latitude`/`longitude` `null` 유지(§P-7, 임의 좌표 미생성).

### Q-4. P2-B 최종 승인

사용자 검수를 통해 P2-B 전체 구현(schema 변경, `syncApplyhomeListings()` 재작성, Mdl 연동, 지오코딩 재사용, 소량 실 데이터 적재·idempotency 검증)이 최종 승인됐다. STEP 상태를 "완료"로 변경한다.
