# DATA COVERAGE FIX V1 — ApartmentMaster Basic Specs Schema + Busan Backfill

작성일: 2026-08-26
성격: `APARTMENT_BASIC_DATA_COVERAGE_AUDIT_V1`의 후속 STEP. 사용자가 명시적으로 승인한 고위험 작업(ApartmentMaster 스키마 변경, migration, 부산 3,402건 Production backfill)을 SCHEMA DESIGN → MIGRATION → DRY-RUN → SAMPLE WRITE → SAMPLE VALIDATION → FULL BUSAN BACKFILL → COVERAGE RE-AUDIT → REGRESSION 순서로 진행한다.

---

## 1. Approved Scope

사용자 승인 범위:
1. `ApartmentMaster` schema 변경
2. migration 실행
3. 부산 `ApartmentMaster` 최대 3,402건 대상 Production backfill

승인 밖(이번 STEP에서 실행하지 않음): 부산 외 지역 write, 기존 non-null 값 overwrite, 데이터 삭제, destructive migration, canonical identity 변경.

---

## 2. Schema Before

`ApartmentMaster`(`apartment_masters`) 기존 컬럼(§2 요구 EXISTING/MISSING 판정):

| 필드 | 상태 |
|---|---|
| householdCount | EXISTING(`totalHouseholds Int?`) |
| buildYear | EXISTING(`buildYear Int?`, MOLIT 참고용) |
| useApprovalDate | EXISTING(`useApprovalDate String?`, 건축물대장 `useAprDay` 원본) |
| mainBuildingCount | EXISTING(`mainBuildingCount Int?`) |
| parkingCount | EXISTING(`parkingCount Int?`) |
| parkingPerHousehold | **MISSING** |
| floorAreaRatio(용적률) | **MISSING** |
| buildingCoverageRatio(건폐율) | **MISSING** |
| mgmBldrgstPk | EXISTING(`mgmBldrgstPk String?`) |
| dataSource/provenance | **MISSING** |
| updatedAt | EXISTING(`@updatedAt`) |

중복 생성 없음 — 위 EXISTING 필드는 그대로 재사용했다.

---

## 3. Schema After

추가된 컬럼(전부 nullable, 기존 컬럼 drop/rename 없음):

```prisma
floorAreaRatio        Float? @map("floor_area_ratio")        // 용적률(%)
buildingCoverageRatio Float? @map("building_coverage_ratio") // 건폐율(%)
parkingPerHousehold   Float? @map("parking_per_household")
basicSpecSource BasicSpecSource @default(UNKNOWN) @map("basic_spec_source")

enum BasicSpecSource {
  BUILDINGHUB_GENERAL_TITLE // 총괄표제부
  BUILDINGHUB_TITLE         // 표제부 fallback(지번 내 건물 정확히 1건일 때만)
  UNKNOWN                   // 아직 backfill 안 됨
}
```

**타입 선택 근거**: `Apartment.far`/`Apartment.bcr`가 이미 `Float`를 쓰고 있고(535.3/59.82 같은 소수 1~2자리 percent 값에 정밀도 손실 없음이 이미 프로덕션에서 실증됨), 이 프로젝트의 `Decimal` 사용처(`ApartmentUnitType.canonicalExclusiveArea` 등)는 "정확한 식별자로 쓰이는 면적값"에 한정된다 — 용적률/건폐율/세대당주차는 식별자가 아니라 표시용 계산값이라 기존 `Apartment` 모델과 동일한 convention(`Float`)을 재사용했다.

**Provenance 설계**: 필드별이 아니라 레코드 단위 enum 1개로 최소화했다 — 이 값들은 항상 같은 API 응답 1건(총괄표제부 또는 표제부)에서 함께 나오므로 필드마다 다른 source를 가질 수 없다.

---

## 4. Migration

`prisma/migrations/20260826091211_data_coverage_fix_v1_basic_specs/migration.sql` — `CREATE TYPE` + `ALTER TABLE ... ADD COLUMN` 4개뿐, `DROP`/`RENAME` 없음. `basic_spec_source`만 `NOT NULL DEFAULT 'UNKNOWN'`(기존 3,402건에 안전한 기본값 자동 적용), 나머지 3개는 전부 nullable.

적용 전 검토: destructive statement 없음 확인, existing data 영향 없음 확인(순수 추가) — 검토 후 `prisma migrate deploy`로 Production(Supabase)에 적용했다. `prisma generate`로 클라이언트 재생성.

---

## 5. Source Contract

`ApartmentMaster.sggCd`(=lawdCd)와 `ApartmentMaster.umdCd`(MOLIT 법정동코드)를 그대로 사용해 REGCODE_PROXY 없이 직접 건축물대장을 조회한다(M3/M4-B가 이미 검증한 우회 경로, `apartment_master_seed.ts`와 동일 패턴 재사용). mgmBldrgstPk는 이 API의 조회 파라미터로 쓸 수 있는 확인된 operation이 없어(M4-A §O에서 "확인 필요"로 남겨진 사항) 조회 키로 쓰지 않고, 응답 결과의 mgmBldrgstPk가 기존 저장값과 일치하는지 교차검증하는 용도로만 활용한다.

---

## 6. General Title(총괄표제부) Path

`getBrRecapTitleInfo(sggCd, umdCd, jibun)` → 성공 시 hhldCnt/mainBldCnt/totPkngCnt/useAprDay/mgmBldrgstPk/**vlRat/bcRat**(이번 STEP에서 신규로 캡처 — 기존 `apartment_master_seed.ts`는 스키마에 컬럼이 없어 이 두 값을 아예 버리고 있었다) 추출.

---

## 7. Title Fallback(표제부) Path

총괄표제부 레코드가 없을 때만 `getBrTitleInfo` 시도. `src/lib/apt-building-info.ts`의 `parseBrTitleInfoRecord`(이미 감사 STEP에서 단위 테스트됨)를 그대로 import해 재사용 — 파싱 로직을 세 번째로 중복 구현하지 않았다.

---

## 8. Collision Protection

- 표제부 레코드가 2건 이상이면 자동 대표값 선택 없이 `REVIEW`로 분류(동-단지 혼동 위험, M4-A §K).
- identity(sggCd/umdCd/jibun) 결측 행은 `REVIEW`로 분류하고 건너뜀.
- 이름 매칭은 어디에도 쓰지 않는다 — 전부 aptSeq(행 선택) + sggCd/umdCd/jibun(외부 조회 키) 기반.

---

## 9. Parking

표제부 fallback일 때 옥내/옥외×자주식/기계식 4필드 합산(`parseBrTitleInfoRecord`가 이미 처리, 감사 STEP에서 검증됨). `parkingPerHousehold`는 `calcParkingPerHousehold(parkingCount, totalHouseholds)` — household ≤ 0이거나 parking 없으면 계산하지 않음(0으로 나누기 금지, 추정치 아님).

---

## 10. FAR/BCR

원본 값을 그대로 보존, 0 이하/무효값/결측은 null. 외부 경쟁 서비스 값 사용 없음 — 전부 정부 공식 소스(BldRgstHubService) 직접 재조회.

---

## 11. Dry Run

부산 ApartmentMaster 3,402건 전체를 대상으로 한 read-only dry-run을 시도했으나, 이 환경의 백그라운드 프로세스 수명 제한으로 완주하지 못하고 1,275/3,402(37.5%)에서 중단됐다(§13 요청안의 "부산 전체 dry-run **또는** 가능한 최대 read-only scan" 조항에 따라 부분 스캔을 최대치로 채택). 25행마다 기록한 51개 샘플 기준: READY 42/51(82%), UNCHANGED 8/51, FAILED(retryable) 1/51 — 그중 표제부 fallback이 필요했던 비율이 총괄표제부 직접 성공보다 오히려 높았다(27 vs 23), 이는 이후 전체 apply 결과(§17)로 정식 확정됐다.

## 12. Sample Apply

§14 요구대로 최소 20건 이상(정상 총괄표제부/표제부 fallback/기존 값 많음/적음/STEP 필수 지정 4곳 포함, 총 23건 시도) 대표 샘플에 실제 적용했다. **첫 시도에서 실수를 발견**: 초안 샘플 목록에 존재 여부를 확인하지 않고 추측으로 넣은 가짜 aptSeq가 다수 섞여 있어 20건 중 16건이 조용히 스킵됐다 — DB에서 실제 존재하는 aptSeq를 다시 조회해 목록을 전부 실제 값으로 교체한 뒤 재실행했다(스크립트 주석에 재발 방지 기록). 최종 결과: PROCESSED 23, READY 20, UNCHANGED 3(이전 시도에서 이미 채워짐), REVIEW/NO_SOURCE/FAILED/CONFLICT 전부 0.

**샘플 적용 중 발견하고 즉시 수정한 데이터 신뢰 버그**: 표제부 fallback 경로가 `useApprovalDate`를 채울 때 알고 있는 정보(연도)보다 더 정밀한 값("YYYY0101", 즉 1월 1일)을 지어내고 있었다 — 표제부(`parseBrTitleInfoRecord`)는 연도만 알 뿐 월/일은 모르는데, `ApartmentMaster.useApprovalDate`는 총괄표제부의 원본 "YYYYMMDD"(일 단위까지 정확)를 저장하는 필드라 의미가 다르다. 스크립트를 즉시 수정해(표제부 경로는 이 필드를 null로 유지) 재발을 막고, 이미 이 세션에서 잘못 쓰여진 10건(`basicSpecSource=BUILDINGHUB_TITLE`이고 `useApprovalDate`가 "0101"로 끝나는 행 — 이 값 자체가 이번 STEP 이전에는 존재할 수 없는 조합이라 사전 데이터 오염 위험 없이 정확히 식별 가능했다)을 null로 정정했다.

## 13. Sample Validation

DB/API/UI 세 계층 전부 확인했다.

- **DB**: 연산동한솔솔파크(aptSeq 26470-1040) — `floorAreaRatio=535.3, buildingCoverageRatio=59.82, parkingCount=204, parkingPerHousehold≈1.236, basicSpecSource=BUILDINGHUB_TITLE`. `mgmBldrgstPk="10401100171804"`가 감사 STEP에서 라이브로 재조회했던 표제부 응답의 값과 정확히 일치(교차검증).
- **API**: `/api/apt/[name]/info`를 연산동한솔솔파크/연산동일동미라주더스타/대신해모로센트럴아파트에 대해 실제 호출 — 전부 DB 저장값과 정확히 일치하는 용적률/건폐율/주차대수를 반환.
- **UI**: 연산동한솔솔파크 실제 상세페이지를 라이브 dev 서버에서 렌더링해 "세대수 165세대 · 준공년월 2007년·19년차 · 용적률 535.3% · 건폐율 59.8% · 주차대수 세대당 1.24대(총 204대)"가 화면에 정확히 표시됨을 확인. 대신롯데캐슬(레거시 Apartment 캐시 tier1 경로)도 재확인해 249.5%/18.4%/888대 정상 표시(§18에서 상세 서술).

## 14. Full Apply

부산 ApartmentMaster 3,402건 전체에 `--apply --resume`로 적용했다. 이 환경이 장시간 백그라운드 프로세스를 주기적으로 종료시켜(정확한 원인 불명 — 고정된 시간 제한이라기보다 세션/리소스 관련으로 추정) 총 8회의 실행으로 나눠 완료했다 — 매 실행이 checkpoint(`scripts/_data_coverage_fix_v1_results/checkpoint.json`, 커밋 대상 아님)에 처리된 aptSeq를 기록해 `--resume`이 정확히 이어서 처리했다. 도중 한 번, 반복된 종료로 orphan node 프로세스 19개가 누적돼 Supabase 커넥션 풀을 소진하는 것으로 추정되는 증상(재시작 직후 즉시 종료)을 발견해 전부 정리한 뒤 재개했다 — 이후 마지막 실행이 남은 1,777건을 한 번에 완주했다. **최종: PROCESSED 3,402/3,402(100%).**

## 15. Idempotency

체크포인트를 무시하고(`--resume` 없이) 처음 200건을 dry-run으로 재스캔했다 — **200/200 전부 UNCHANGED, 8개 필드 전부 fillable=0**. 두 번째 실행이 아무것도 다시 바꾸려 하지 않음을 확인했다(§18 요구사항 충족). **IDEMPOTENT = YES.**

## 16. Coverage Before → After (Busan-wide, ApartmentMaster 3,402건)

| 필드 | Before(APARTMENT_BASIC_DATA_COVERAGE_AUDIT_V1) | After(이번 STEP) | 증가 |
|---|---|---|---|
| 세대수(totalHouseholds) | 74.8%(2,544) | **93.5%(3,181)** | +18.7pp |
| 주차대수(parkingCount) | 25.7%(876) | **71.0%(2,417)** | +45.3pp |
| 용적률(floorAreaRatio) | N/A(컬럼 없음) | **73.9%(2,514)** | 신규 |
| 건폐율(buildingCoverageRatio) | N/A(컬럼 없음) | **74.1%(2,521)** | 신규 |
| 세대당주차(parkingPerHousehold) | N/A(필드 없음) | **69.3%(2,357)** | 신규 |
| 동수(mainBuildingCount) | 40.1%(1,365) | 40.5%(1,379) | +0.4pp(표제부는 동수 미제공 — 설계상 정상) |
| mgmBldrgstPk | 77.1%(2,624) | 77.2%(2,626) | +0.1pp |

`basicSpecSource` 분포: `BUILDINGHUB_GENERAL_TITLE` 994건(29.2%), `BUILDINGHUB_TITLE` 1,720건(50.6%), `UNKNOWN`(양쪽 다 실패) 688건(20.2%). **표제부 fallback이 총괄표제부 직접 성공보다 더 많은 단지를 구제했다** — 이번 STEP의 근본원인 진단(WRONG_SOURCE_SELECTION)이 연산동한솔솔파크 한 곳의 특이 사례가 아니라 부산 전체 규모의 구조적 문제였음을 정량적으로 확정한다.

## 17. 실패/검토 상세(§20)

- **NO_SOURCE 19건**(총괄표제부·표제부 모두 레코드 없음, 정직하게 결측 유지): 26230-125/143/123/2822/353, 26440-150/316/147, 26110-11, 26200-783, 26710-381/10, 26320-2228, 26410-33, 26260-220/2444/155, 26380-2113/1649.
- **CONFLICT 5건**(기존 non-null 값과 새로 조회한 값이 달라 전부 보류, 아무 필드도 덮어쓰지 않음): 26290-2777(오션파라곤아파트), 26290-1885(경동메르빌), 26290-53(우암자유4), 26290-52(우암자유3), 26290-3234(국제금융센터퀸즈W). **알려진 보수적 동작**: 한 필드라도 충돌하면 그 행의 다른 비충돌 필드(예: 이미 확정 가능했던 용적률)까지 함께 보류된다 — 행 단위로 한 번에 사람이 검토할 수 있게 하려는 의도적 설계이지만, 부분 적용을 원한다면 필드 단위 conflict 처리로 개선할 여지가 있다(§21 향후 과제).
- **REVIEW 0건**(표제부 2건 이상/identity 불완전 케이스가 부산 3,402건 중 한 번도 발생하지 않음).
- **FAILED(재시도 후 최종 실패) 0건**(최종 apply 기준 — 중간 실행에서의 일시 실패는 재시도/재개로 전부 해소됨).

## 18. Legacy Apartment vs ApartmentMaster + Detail Read Path

`/api/apt/[name]/info`에 3단계 read path를 추가했다: **(1) legacy `Apartment` 캐시(name+dong, 기존 유지) → (2) `ApartmentMaster`(lawdCd+dong+jibun로만 조회, 이름 매칭 없음, 이번 STEP 신규) → (3) 라이브 BuildingHUB 호출(기존 유지, 최후 수단)**. 필드별로 병합하며 앞 단계가 채운 값은 뒤 단계가 덮지 않는다. tier(1)/(2) 모두 완전히 채워지면 tier(3)의 외부 API 호출 자체를 건너뛴다(§23 목표 달성).

라이브로 재확인: 연산동한솔솔파크(레거시 캐시에 행 없음 → tier2 ApartmentMaster로 즉시 해결, 외부 호출 없음), 대신롯데캐슬(레거시 캐시 tier1이 이미 충분해 tier2/3 모두 스킵, 회귀 없음 확인). 대신해모로센트럴아파트(레거시 캐시에 unitTypes까지 있는 복합 케이스)도 정상.

**주의(디버깅 중 확인, 실제 버그 아님)**: 상세페이지의 두 번째 `/info` 호출(실거래 응답에서 얻은 정확한 지번으로 재조회)은 실거래 API 자체의 지연(수 초)만큼 늦게 도착한다 — 페이지 진입 직후 5~6초 이내에는 일시적으로 "정보 없음"이 보일 수 있으나 최종적으로는 정상 표시된다. 이번 STEP에서 새로 만든 동작이 아니라(git diff 확인 결과 `apt-client.tsx`는 이번 STEP에서 전혀 수정하지 않음) 기존에도 있던 페이지 로딩 순서이며, 이번 검증 과정에서 대기 시간이 부족해 일시적으로 잘못된 결론(회귀로 오인)을 낼 뻔했다가 재확인으로 바로잡았다.

## 19. 연산동한솔솔파크 최종 확인

DB: `floorAreaRatio=535.3, buildingCoverageRatio=59.82, parkingCount=204(≈세대당 1.24대), totalHouseholds=165, basicSpecSource=BUILDINGHUB_TITLE`. API: 동일 값 반환. UI: 상세페이지에 정확히 표시(§13). 전부 BuildingHUB(정부 공식) 소스 기준이며 경쟁 서비스 값을 참조/복사한 적 없음.

## 20. Tests

신규 유닛 테스트 7개(`scripts/backfill-basic-data-logic.test.mjs`, 순수 함수 `planField`/`calcParkingPerHousehold`만 테스트 — CLI 스크립트 본체는 `require.main===module` 가드로 분리해 import 시 실제 backfill이 실행되는 사고를 방지): FILL_NULL 분류, CONFLICT_REVIEW 분류(overwrite 금지 근거), 부동소수 오차 허용 MATCH_EXISTING, UNCHANGED(기존 값 보존), 세대당주차 정상 계산, 0/null 나눗셈 방지 2건. 기존 45개(38+7, STEP 5까지) 포함 총 45/45 PASS — CLI 실행/DB apply/idempotency/scope 준수(§I/§J/§K)는 유닛 테스트가 아니라 실제 라이브 실행(§11-18)으로 직접 검증했다(이 프로젝트의 기존 관례 — `apartment_master_seed.ts` 등 배치 스크립트도 별도 목킹 테스트 없이 라이브 실행으로 검증해 왔다).

## 21. Rollback Considerations

스키마: 4개 컬럼 전부 additive/nullable(`basicSpecSource`만 안전한 기본값)이라 롤백이 필요하면 단순 `DROP COLUMN` 마이그레이션으로 되돌릴 수 있다(기존 컬럼에 영향 없음). 데이터: 이번 STEP이 쓴 필드는 전부 새로 추가된 컬럼뿐이라, 문제가 생기면 `basicSpecSource != 'UNKNOWN'`인 행만 골라 새 필드 4개를 null로 되돌리는 것으로 완전히 원상복구 가능(기존 필드는 §7 정책상 애초에 덮어쓴 적이 없음). 이번 STEP에서 실제 롤백은 필요하지 않았다.

## 22. Remaining Gaps

- CONFLICT 5건은 사람 검토 후 개별 처리 필요(§17).
- NO_SOURCE 19건은 정부 소스 자체에 레코드가 없어 이번 STEP 범위 안에서는 해결 불가.
- ApartmentMaster의 `useApprovalDate`는 총괄표제부 경로(일 단위 정확)와 표제부 fallback 경로(현재 null 유지)가 정밀도가 다르다 — 표제부도 일 단위 정확도를 확보하려면 이 필드와 별개로 "연도만 확실" 필드를 추가하는 스키마 논의가 필요(이번 STEP에서 결정하지 않음).
- CONFLICT 처리가 행 단위 all-or-nothing이라 일부 유효 데이터가 보류된다(§17).
- 부산 외 지역은 이번 STEP 범위 밖(ApartmentMaster 자체가 부산 전용 데이터셋).

## 23. K-apt Future

이전 감사 STEP에서 이미 MISSING_SOURCE로 분류됨 — 이번 STEP에서도 신규 연동을 구현하지 않았다. NO_SOURCE 19건(§17)처럼 BuildingHUB 두 operation 모두 레코드가 없는 경우의 보강 후보로 남긴다(향후 별도 STEP 검토 필요, 승인 필요).
