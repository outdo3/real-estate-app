# STEP SCORE S2A — Apartment Score Feature Cache Schema + Canonical Identity

상태: **스키마 설계 완료, migration 초안 생성(적용 안 함), production 변경 없음**

이번 STEP의 목적은 점수를 계산하거나 collection을 실행하는 것이 아니라, S1/S1.1에서
승인된 방향(2-테이블 캐시 구조, `ApartmentMaster.aptSeq` 정식 identity, 부산 전체
Beta, Regional Premium 분리 유지, 서버 전용 계산)을 실제 Prisma 스키마로 확정하고
migration 초안만 생성하는 것이다. **production migration 실행 금지 / production
feature collection 금지 / 점수 계산 금지 / UI 변경 금지 — 전부 지켰다.**

## 1. 기존 모델 재확인 (변경 없음, 확인만)

`prisma/schema.prisma`를 처음부터 다시 읽어 두 모델의 실제 필드를 재확인했다
(추측/기억에 의존하지 않음):

- **`Apartment`**(148-191행, 이번 STEP에서 `aptSeq` 필드만 추가) — PK `id`(Int
  autoincrement), `name`/`dong`/`lawdCd`/`jibun` 있음, **좌표 필드 없음**,
  **주소 필드 없음**, unique는 `[name, dong]`뿐.
- **`ApartmentMaster`**(변경 없음) — PK `id`(Int), `aptSeq String? @unique`,
  `sggCd`/`umdName`/`jibun`/`latitude`/`longitude` 있음, `sggCd`에 index,
  `normalizedName`에 index, `[umdCd, jibun]` 복합 index.

## 2. `ApartmentMaster.aptSeq`를 정식 identity로 확정

`aptSeq`는 이미 `@unique`이고 MOLIT 원본 식별자(`{lawdCd}-{일련번호}`)라 문자열
표기(이름 띄어쓰기, "아파트" 접미사 유무)에 흔들리지 않는다. 아래 §3의 매칭 감사
결과가 이 판단을 실측으로 뒷받침한다 — jibun을 우선 기준으로 쓰면 이름 표기가
크게 달라도(예: "협성르네상스" vs "서대신협성르네상스타운아파트") 같은 실물
단지임을 정확히 식별할 수 있었다. **확정: 점수 시스템의 canonical identity는
`ApartmentMaster.aptSeq`.**

## 3. Apartment 32건 ↔ ApartmentMaster 매칭 감사 (실제 DB 조회, 이름만으로 join 안 함)

region(`lawdCd`=`sggCd`, `dong`=`umdName`) 후보군 안에서 **jibun을 먼저**
비교하고, jibun이 없거나 후보가 0건일 때만 이름 정규화로 폴백하는 방식으로
분류했다. 이름 우선 방식을 먼저 시도했다가(1차 스크립트) jibun이 정확히 일치
하는데도 이름 표기 차이로 놓치는 실제 사례 2건을 발견해(§9 참고), jibun 우선
방식으로 다시 설계해 재검증했다.

```
분류 결과 (32건 전체)
  MATCHED_EXACT            20건 — region+dong 내 jibun이 정확히 1개 후보와만 일치
  AMBIGUOUS_SHARED_JIBUN     2건 — 같은 jibun을 여러 ApartmentMaster 후보가 공유
  UNMATCHED_NO_REGION_CANDIDATE 10건 — ApartmentMaster에 해당 지역 후보 자체가 없음
  MATCHED_HIGH               0건
```

**AMBIGUOUS_SHARED_JIBUN 2건 (강제 연결하지 않음)**:

- `#60 "레이카운티"` (lawdCd=26470/거제동, jibun=1536) — ApartmentMaster에
  "레이카운티(1단지)"~"(5단지)" 5개 행이 전부 jibun=1536을 공유. 한 필지에 여러
  동으로 나뉜 대단지가 MOLIT/건축물대장에 단지별로 별도 등록된 실제 사례 —
  버그가 아니라 데이터 구조상 진짜 모호함.
- `#61 "엘지메트로시티3"` (lawdCd=26290/용호동, jibun=176-30) — "엘지메트로시티
  1/2/3/4-1/4-2/5" 6~7개 행이 전부 jibun=176-30 공유. 위와 동일한 성격.

**UNMATCHED_NO_REGION_CANDIDATE 10건 (버그 아님, 범위 밖)**: 전부 부산이 아닌
지역 — 서울 강남구(lawdCd 11680) 5건, 서울 영등포구(lawdCd 11560) 3건, 경남
진주(lawdCd 48170) 2건. `ApartmentMaster`는 현재 부산 16개 구·군만 커버(M4-B
결과, S1.1에서 이미 확인한 사실)하므로 이 10건은 애초에 매칭 대상이 아니다.

**MATCHED_EXACT 20건 중 실제로 발견된 중복(같은 aptSeq를 가리키는 서로 다른
Apartment row) 6쌍 — 실측, 추측 아님**:

| aptSeq | Apartment row 1 | Apartment row 2 |
|---|---|---|
| 26140-1290 | #13 대신푸르지오2차 | #77 대신2차푸르지오아파트 |
| 26140-1245 | #15 대신더샵 | #39 대신더샵아파트 |
| 26140-1164 | #95 대신롯데캐슬아파트 | #11 대신롯데캐슬 |
| 26350-2360 | #36 해운대동백두산위브더제니스 | #8 해운대동백두산위브더제니스아파트 |
| 26140-1356 | #37 대신해모로센트럴아파트 | #41 대신해모로센트럴 |
| 26140-51 | #16 협성르네상스 | #78 서대신협성르네상스타운아파트 |

20건 중 12건이 이 6쌍(같은 실물 단지를 이름 표기만 다르게 캐싱한 기존
`Apartment` row), 나머지 8건은 단일 매칭. **고유 aptSeq는 14개뿐** —
`Apartment.@@unique([name, dong])`가 이름 문자열 차이를 막지 못해 생긴 기존
중복이다. 이번 STEP에서 이 중복 자체를 정리(병합/삭제)하지는 않는다 — 범위 밖이고,
기존 `Apartment` 테이블은 건축물대장 캐시 용도로 계속 정상 동작 중이라 임의로
건드리면 기존 기능에 영향을 줄 수 있다. **이 사실이 §4의 unique 여부 결정에 직접
영향을 준다.**

## 4. `Apartment.aptSeq` 필드 설계

```prisma
aptSeq String? @map("apt_seq")
// unique를 걸지 않음: 위 §3에서 같은 aptSeq를 가리키는 Apartment row가 실제로
// 6쌍 확인됨. unique 제약을 걸면 backfill 시 두 번째 row의 UPDATE가 그대로
// 실패한다.
```

- **nullable**: AMBIGUOUS/UNMATCHED 12건은 값을 채우지 않으므로 필수.
- **unique 아님**: §3의 실측 결과, 강제하면 backfill이 깨진다.
- **plain field, `@relation` 아님**: `ApartmentMaster`는 M-시리즈 배치가 주기적
  으로 재구축하는 테이블이라 내부 PK가 재생성될 수 있다. 값(aptSeq) 기반의 느슨한
  연결이 이 프로젝트의 기존 관례(`RedevelopmentSourceRecord.source`를 enum이
  아닌 String으로 남긴 R3B 결정)와 일치한다.
- index만 추가(`@@index([aptSeq])`) — 조회는 항상 `ApartmentMaster` 쪽에서
  region으로 먼저 필터링한 뒤 join하는 방향(§8)이라, `Apartment.aptSeq`
  단독 조회 성능은 부차적이지만 있으면 손해 없다.

## 5. `ApartmentLocationFeature` (신규 테이블)

원재료(raw feature)만 저장한다 — 점수/등급 컬럼 없음. PK는 `aptSeq` 자체(자연키,
이 프로젝트에 이미 `ActiveSession.sessionId` 선례 있음).

| 필드 | 설명 | 출처(이미 production에서 검증된 방식) |
|---|---|---|
| `aptSeq` (PK) | `ApartmentMaster.aptSeq`와 동일 값 | — |
| `latitude`/`longitude` | 좌표 | `ApartmentMaster` |
| `nearestSubwayDistanceM`/`Name`, `subwayCount1000m` | 지하철 | Kakao SW8 |
| `nearestBusStopDistanceM`, `busStopCount300m` | 버스 | TAGO(`/api/transit/bus-stops` 재사용) |
| `martCount1000m` | 대형마트 | Kakao MT1 |
| `convenienceCount500m` | 편의점 | Kakao CS2 |
| `pharmacyCount500m` | 약국 | Kakao PM9 |
| `hospitalCount1000m` | 병원 | Kakao HP8 |
| `parkCount1000m` | 공원 | Kakao 키워드+category_name 필터 |
| `daycareKindergartenCount500m` | 어린이집·유치원 | Kakao PS3(공식 분류상 분리 불가 — 필드명이 그 사실을 정확히 반영) |
| `nearestElementaryDistanceM`, `elementaryCount1000m` | 초등학교 **접근성만** | Kakao SC4 (학군/학업성취도 아님 — STEP1.5-A/50에서 이미 확정된 "데이터 없음" 사실 재확인, 새로 만들지 않음) |
| `beachDistanceM` | 해변 **접근성만** | Kakao 키워드("해수욕장")+category_name (S1.1 검증) — "오션뷰"는 층/향/차폐 데이터가 없어 컬럼 자체를 만들지 않음 |
| `source`/`sourceVersion`/`fetchedAt`/`validUntil`/`qualityFlag` | provenance | — |

S1.1이 제안했던 후보 목록에서 `busStopCount500m`(300m와 중복)을 뺐다 — "실제
필요한 것만 남길 것"이라는 이번 STEP 지시에 따라 반경 하나로 좁혔다. raw API
전체 payload는 저장하지 않는다(요청 지시 없음, 저장 이유 없음).

**freshness**: 카테고리별로 `staticFetchedAt`/`poiFetchedAt`처럼 타임스탬프를
쪼개지 않고 **행 전체에 `fetchedAt` + `validUntil` 하나만** 둔다 — S2B 수집
스크립트가 한 아파트에 대해 Kakao/TAGO 호출을 한 배치로 묶어 처리할 것이므로,
컬럼을 쪼개는 이득보다 테이블 파편화 비용(이 프로젝트가 반복적으로 피해온
패턴)이 크다고 판단했다. 카테고리별로 다른 갱신 주기가 실제로 필요해지면 V2에서
재검토할 문제.

## 6. `ApartmentMarketFeature` (신규 테이블)

| 필드 | 설명 |
|---|---|
| `aptSeq` (PK) | 동일 |
| `latestTradePrice`/`latestTradeDate` | 최근 매칭 거래 |
| `medianPricePerM2_12m`/`_36m` | 기간 내 매칭 거래들의 중위 ㎡당가 |
| `transactionCount12m`/`_36m` | 기간 내 매칭 거래 건수 |
| `priceChange12m` | 12개월 전 대비 median 증감률(%) — 원본 두 숫자의 산술 비교일 뿐 "투자가치 점수"가 아님 |
| `source`/`sourceVersion`/`fetchedAt`/`validUntil`/`qualityFlag` | provenance |

**`pricePerM2` 확정 판단**: S1.1에서 우려했던 것은 "`ApartmentMaster`에 단지
전체 면적 필드가 없다"는 것이었는데, 이 값은 거래 1건 단위(MOLIT 원본에 거래별
전용면적이 실제로 존재 — 기존 `TradeHistory.area`, `Transaction.info`의
"73.27m²" 표기가 이미 이 값이 앱 다른 곳에서 쓰이고 있다는 증거)로 계산하는
것이라 별개 문제다. 다만 **S2B 수집 스크립트가 실제로 이 필드를 채울 때, 매칭된
거래들의 면적 필드 결측률을 다시 확인해야 한다** — 이번 STEP은 스키마 설계만
하고 실제 MOLIT 응답을 호출해 검증하지 않았으므로 `EXTERNAL_VERIFICATION_REQUIRED`로
표시한다(S1.1과 동일한 표기 원칙). 스키마 필드 자체는 만들어 두되, 실제 수집
가능 여부는 다음 단계에서 확정.

`buildYear`/`totalHouseholds`/`mainBuildingCount`/`parkingCount`는 이미
`ApartmentMaster`에 있어 중복 저장하지 않는다 — 점수 엔진이 그쪽을 직접 읽는다.

## 7. 절대 만들지 않은 컬럼 (재확인)

`totalScore`, `transportScore`, `livingScore`, `parkingScore`,
`regionalScore`, `beachPremiumScore` — 이런 이름의 컬럼은 이 스키마 어디에도
없다. §5/§6의 모든 필드는 raw 거리·개수·가격이지 점수가 아니다.

## 8. 인덱스

- `apartment_location_features`/`apartment_market_features`: PK(`aptSeq`)가
  이미 unique index라 별도 index 불필요.
- `apartments`: `@@index([aptSeq])` 추가(§4).
- 지역 단위 조회(예: "부산 서구 전체 아파트 점수")는 항상 `ApartmentMaster`를
  `sggCd`로 먼저 필터링한 뒤 그 결과의 `aptSeq` 목록으로 feature 테이블을
  `IN` 조회하는 방향으로 설계한다 — feature 테이블에서 역방향으로(예:
  거리순 전체 스캔) 조회하지 않는다.

## 9. 매칭 스크립트 설계 수정 (자체 발견, 사용자 피드백 아님)

1차 스크립트는 이름 정규화를 먼저 시도하고 jibun은 동점 처리에만 썼다. 그
결과의 "매칭 실패" 3건을 수동으로 확인하던 중 2건이 실제로는 jibun이 정확히
일치했다(`#77 "대신2차푸르지오아파트"` ↔ jibun=570, `#78
"서대신협성르네상스타운아파트"` ↔ jibun=694-1) — 이름 표기 순서/접미사가
달라 이름-우선 로직이 놓친 것이었다. jibun을 먼저 비교하도록 다시 설계해
재검증했고, 그 결과가 §3에 실린 최종 수치다.

## 10. migration 초안 (생성만 함, 적용 안 함)

`prisma migrate dev --create-only --name score_s2a_feature_cache_schema`로
생성 — 이 옵션은 shadow DB로 diff만 계산하고 대상 DB(production)에는 아무것도
적용하지 않는다(R4에서 이미 검증된 동일한 방식). 생성 직후
`prisma migrate status`로 재확인:

```
Following migration have not yet been applied:
20260819145602_score_s2a_feature_cache_schema
```

**생성된 SQL 전문 — 파괴적 문장 없음(DROP/TRUNCATE/DELETE 전혀 없음), 기존
컬럼 NOT NULL 강제 없음**:

```sql
-- AlterTable
ALTER TABLE "apartments" ADD COLUMN     "apt_seq" TEXT;

-- CreateTable
CREATE TABLE "apartment_location_features" ( ... 20개 컬럼 ... PRIMARY KEY ("apt_seq") );

-- CreateTable
CREATE TABLE "apartment_market_features" ( ... 12개 컬럼 ... PRIMARY KEY ("apt_seq") );

-- CreateIndex
CREATE INDEX "apartments_apt_seq_idx" ON "apartments"("apt_seq");
```

diff 범위는 예상과 정확히 일치: `Apartment.aptSeq` nullable 컬럼 추가 + 신규
테이블 2개 + index 1개. 다른 모델/컬럼은 전혀 건드리지 않는다.

## 11. Backfill 계획 (설계만, 실행 안 함)

- **자동 backfill 후보**: MATCHED_EXACT 20건(§3) → `Apartment.aptSeq`에
  해당 aptSeq 값을 UPDATE. §3의 6쌍 중복 때문에 **고유 aptSeq는 14개**지만,
  `Apartment.aptSeq`가 unique가 아니므로(§4) 20건 전부 안전하게 채울 수 있다.
- **제외**: AMBIGUOUS_SHARED_JIBUN 2건, UNMATCHED_NO_REGION_CANDIDATE 10건
  — 강제 연결하지 않는다. 두 AMBIGUOUS 건은 사람이 직접 어느 단지(1단지~5단지 등)
  인지 확인해야 하는 사례라, 향후 스텝에서 별도 판단이 필요하면 그때 다룬다.
- **실행 시점**: 다음 STEP(S2B 이후) 승인 시 별도로 실행 — 이번 STEP은 계획만
  남긴다.

## 12. 서버 전용 보안 구조 (설계만)

가중치/정규화/peer-group/지역 프리미엄 공식은 클라이언트 번들에 절대 포함하지
않는다. `src/lib/apartment-score/server/`(신규 예정 디렉토리, 이번 STEP에서
파일을 만들지는 않음 — 코드 구현은 다음 STEP)에서만 import하도록 설계한다.
API는 `finalScore`/`categoryScores`/`explanations`/`coverage`만 응답하고,
`ApartmentLocationFeature`/`ApartmentMarketFeature`의 raw row나 가중치 설정을
그대로 노출하지 않는다 — 기존 `redevelopment/service.ts`가 `rawPayload`를
API 응답에서 걸러내는 것과 같은 패턴을 재사용한다.

## 13. typecheck / validate 결과

```text
npx prisma format    — 성공(자동 포맷 적용, 스키마 로직 변경 없음)
npx prisma validate  — "schema is valid"
npx prisma generate  — 성공, Prisma Client 재생성
npx tsc --noEmit     — 0 errors (앱 코드가 새 모델을 아직 참조하지 않아 회귀 없음)
```

production DB 쓰기는 전혀 수행하지 않았다 — `prisma migrate status`가 여전히
"not yet been applied"임을 재확인(§10).

## 14. S2B(다음 STEP)에 넘기는 것

- `ApartmentLocationFeature`/`ApartmentMarketFeature` 실제 수집 스크립트
  (Kakao Local API REST 버전 신규 작성 필요 — `KakaoPlaces.tsx`는 브라우저
  전용 SDK라 재사용 불가, S1.1에서 이미 확인된 사실).
- MOLIT 응답의 면적 필드 결측률 실측(§6의 `EXTERNAL_VERIFICATION_REQUIRED`).
- MATCHED_EXACT 20건 backfill 실행(§11 계획 실행).
- 점수 계산 엔진(`src/lib/apartment-score/server/`) 구현.

## 15. 결론

- `Apartment.aptSeq` nullable 필드 + `ApartmentLocationFeature` +
  `ApartmentMarketFeature` 스키마 확정, migration 초안 생성(미적용).
- 32건 매칭 감사 완료 — 20 MATCHED_EXACT(중복 aptSeq 6쌍 포함, 고유 14개),
  2 AMBIGUOUS_SHARED_JIBUN(강제 연결 안 함), 10 UNMATCHED(범위 밖, 정상).
- 점수 컬럼/가중치/공식 없음, production 변경 없음, typecheck 0 errors.

**S2B_GO** — 스키마 기반은 안전하게 확정됐고, 다음 STEP(실제 feature 수집
스크립트 + backfill 실행)으로 진행 가능. 유일한 조건: §6의 MOLIT 면적 필드
결측률은 S2B 시작 시 가장 먼저 실측 확인.
