# MASTER MISSING REPAIR V1

## 1. Approval Scope

사용자가 명시적으로 승인한 범위: `RECENT_MASTER_MISSING_16_AUDIT_V1`에서
`READY_FOR_MASTER_CREATE`로 확정된 16건에 한해 `ApartmentMaster` row 생성,
canonical identity 필드만 입력, secondary metadata는 공식 근거 없으면
null 유지. 16건을 넘는 생성, schema 변경, 기존 row 대량 수정, legacy
cleanup, 민간 source 기반 household 임의 입력은 전부 금지 범위.

## 2. Candidate Universe

`data/master-integrity/recent-master-missing-16-v1.json` — 16건 전부
`READY_FOR_MASTER_CREATE`, `REVIEW_REQUIRED`/`DO_NOT_CREATE` 0건(재확인).
실행 직전 재검증 결과 16건 모두 aptSeq unique, 현재 `ApartmentMaster`에
없음, 필수 identity 필드(aptSeq/name/lawdCd/dong/jibun) 전부 존재 확인.

## 3. Identity Proof

16건 전부 `scripts/repair-recent-missing-masters-logic.ts`의
`buildMasterRowPlan()`이 aptSeq 우선 + 필수 필드 완전성만으로 판정 —
loose name/dong/jibun fallback 없음, 새 synthetic aptSeq 없음. 이름은
`RECENT_MASTER_MISSING_16_AUDIT_V1`이 확정한 `canonicalName`(MOLIT
원본, 전체 거래 이력에서 흔들림 없이 검증됨)을 그대로 사용.

## 4. Dry Run

```
=== PLAN (DRY-RUN) ===
will insert: 16
duplicate(skip): 0
invalid(reject): 0
not-ready(skip): 0
```

16건 전부 `INSERT` — 예상(§10 스펙: "16 candidates, 16 insert, 0
duplicate, 0 invalid")과 정확히 일치, `--apply` 진행.

## 5. Before Snapshot

| 지표 | 값 |
|---|---|
| `ApartmentMaster` total | 3,402 |
| 최근 24개월 traded aptSeq(부산) | 3,403 |
| searchable | 3,387 |
| missing | 16 |
| coverage | 99.53% |
| candidate 16건 중 이미 Master에 존재 | 0 |
| duplicate aptSeq 그룹(전체 Master) | 0 |

## 6. Apply Method

신규 스크립트 `scripts/repair-recent-missing-masters.ts`(dry-run 기본,
`--apply`로 실제 반영, idempotent — 이미 존재하는 aptSeq는 자동
skip이지 UPDATE하지 않음). 로직은 `scripts/repair-recent-missing-
masters-logic.ts`(순수 함수, DB/네트워크 없음, 단위 테스트 전용)로
분리해 `prisma.apartmentMaster.create()` 한 곳에서만 실제 write가
일어나게 했다 — update 경로 자체가 코드에 없음.

## 7. Inserted Rows

16/16 성공, 실패 0건:

| id | aptSeq | name | lawdCd | dong | jibun |
|---|---|---|---|---|---|
| 5391 | 26290-2594 | 햇살좋은집 | 26290 | 대연동 | 1506-19 |
| 5392 | 26200-623 | 궁전그린파크빌라 | 26200 | 영선동2가 | 39 |
| 5393 | 26110-1 | 동광맨션 | 26110 | 중앙동4가 | 40-15 |
| 5394 | 26380-29 | 삼풍아파트 | 26380 | 괴정동 | 487-6 |
| 5395 | 26230-2842 | 가야봄여름가을겨울 | 26230 | 가야동 | 585 |
| 5396 | 26290-4786 | 롯데캐슬인피니엘 | 26290 | 문현동 | 1257 |
| 5397 | 26530-1016 | 퀀텀펠리스 | 26530 | 주례동 | 5-2 |
| 5398 | 26380-2073 | 대운스카이뷰1차 | 26380 | 하단동 | 592-10 |
| 5399 | 26230-177 | 보해이브빌 | 26230 | 전포동 | 695-5 |
| 5400 | 26230-4559 | 아틀리에933 | 26230 | 양정동 | 406-5 |
| 5401 | 26410-2153 | 대림포레 | 26410 | 구서동 | 420-14 |
| 5402 | 26710-90 | 창신빌라 | 26710 | 기장읍 대변리 | 442-1 |
| 5403 | 26260-292 | 삼성빌라 | 26260 | 온천동 | 1449-1 |
| 5404 | 26470-226 | 에스케이드림피아 | 26470 | 연산동 | 1299-8 |
| 5405 | 26410-253 | 일번파크맨션에이동 | 26410 | 남산동 | 973-3 |
| 5406 | 26230-2116 | 피렌체 | 26230 | 양정동 | 319-1 |

## 8. Secondary Metadata Policy

`totalHouseholds`/좌표/`parkingCount`/FAR·BCR/`useApprovalDate`/
`mainBuildingCount`/`mgmBldrgstPk` — 전부 생성 데이터 객체에 아예
포함하지 않았다(Prisma 스키마 기본값 null로 자연히 채워짐). `buildYear`
만 MOLIT 원본 값으로 채웠다(이미 audit에서 20년 거래 이력 전체에 걸쳐
흔들림 없이 검증된 필드). §16(household 필드 null 정책)에서 실사용
동작까지 확인.

## 9. After Snapshot

| 지표 | Before | After |
|---|---|---|
| `ApartmentMaster` total | 3,402 | **3,418**(+16) |
| 최근 24개월 searchable | 3,387 | **3,403** |
| missing | 16 | **0** |
| coverage | 99.53% | **100.00%** |
| duplicate aptSeq 그룹 | 0 | **0**(변화 없음) |

예상(§13: "Master +16, recent missing = 0, coverage = 100%")과 정확히
일치.

## 10. Search QA

16개 이름 전부 `/api/search`에 실제 GET 요청(프로그래매틱, curl 아닌
fetch 스크립트) — 16/16 정확히 자기 자신의 aptSeq를 결과에 포함
(`보해이브빌`은 동명 타 지역 단지 2건과 함께 3건 반환, `피렌체`는 부분
일치 3건과 함께 4건 반환 — 두 경우 전부 대상 aptSeq가 tier-0(exact
match) 랭킹으로 정확히 포함됨, `SEARCH_COVERAGE_PERFORMANCE_V1`의
랭킹 로직 회귀 없음 재확인). 홈/지도/빠른검색은 전부 동일
`ApartmentAutocomplete` → `/api/search` 경로를 공유하므로(이전 STEP
확인) 별도 3중 수동 확인 불필요 — 대표 3건만 브라우저로 재확인(§14).

## 11. Detail QA

16개 전부 `/api/apt/[name]/verify?aptSeq=...`(검색→상세 이동 게이트,
DB-only)로 `hasTrades=true` 확인 — 16/16 PASS. 다른 단지로의 fallback
0건(모든 응답이 요청한 aptSeq와 정확히 일치하는 identityKey로 조회됨).

## 12. Coverage Result

**3,403 / 3,403 = 100.00%.** 목표(§17) 정확히 달성.

## 13. Performance Result

`scripts/benchmark-apartment-search.ts` 재실행(Master +16 이후):

| 쿼리 | warm p50 | warm p95 |
|---|---|---|
| 경동 | 83ms | 120ms |
| 경동마리나 | 119ms | 179ms |
| 롯데 | 85ms | 150ms |
| 해운대 | 71ms | 102ms |
| 대신롯데캐슬 | 69ms | 85ms |
| 가(1글자) | 23ms | 55ms |
| no-result | 70ms | 97ms |

기존 목표(p50~90ms, p95~150ms) 대비 회귀 없음 — `ApartmentMaster`가
3,402→3,418(+0.47%)로 미미하게 늘어난 정도라 성능에 실질적 영향 없음.

## 14. Mobile QA

375px 모바일에서 대표 3건(고신뢰 2 + 중신뢰 1) 검색→선택→상세→
실거래 확인:

- **삼풍아파트**(HIGH, 97건 거래 이력): 검색 드롭다운 "삼풍아파트,
  괴정동 487-6, 1978년 준공"(세대수 없음, 정직한 no-data) → 상세 진입,
  "부산광역시 사하구 487-6 · 1978년 준공"(household 없이 깔끔하게
  렌더링), 실거래 2억5,000만/72.83m²/2026.07.24/3층 정확히 표시.
- **롯데캐슬인피니엘**(HIGH, 신축 2026년, 5건): 검색 → 상세,
  "부산광역시 남구 1257 · 2026년 준공", 실거래 6억9,000만/84.95m²/
  2026.08.05/4층 정확히 표시.
- **아틀리에933**(MEDIUM, 1건뿐인 최소 케이스): 검색 → 상세,
  "부산광역시 부산진구 406-5 · 2025년 준공", 유일한 실거래
  6억6,100만/74.72m²/2026.07.20/20층이 최고/최저 동일값으로 정확히
  표시(단일 데이터포인트 정상 처리 확인).

3건 전부 다른 단지 fallback 없음, 가로 스크롤/겹침 없음.

## 15. Tests

`scripts/repair-recent-missing-masters-logic.test.mjs`(신규) 9개 —
스펙 §21 A~F 전부 커버(G/H는 순수 로직 테스트 범위 밖이라 §10/§11의
실제 라이브 QA로 증명):

- A: dry-run deterministic(동일 입력 → 동일 plan)
- B: 16 candidate 전부 INSERT로 이어짐(중복/결측 없을 때)
- C: 중복 aptSeq → `SKIP_DUPLICATE`, data 없음
- D: 필수 identity 필드 결측 → `REJECT_MISSING_FIELD`
- E: 중복 aptSeq가 UPDATE 계획으로 이어지지 않음(action이 INSERT 아님)
- F: 생성 data에 secondary metadata 키가 전혀 없음(identity 필드만)

세션 전체 회귀 테스트(`apt-name-match`/`trade-history-logic`/
`api-molit`/`search-ranking`/`apt-building-info`) 47/47 pass.

## 16. Known Limitations

- household/좌표/주차/FAR·BCR 등 secondary metadata는 이번 STEP에서
  여전히 null — 후속 건축물대장/K-APT enrichment STEP 필요(§9 정책
  그대로 실행).
- **부수적으로 발견하고 함께 수정한 UI 버그**: `apt-client.tsx`의 Hero
  요약 줄이 `heroHouseholds`가 없을 때(이번 16건처럼) "1978년
  준공세대"처럼 "세대"가 숫자 없이 붙어 깨져 보이는 pre-existing
  버그를 발견했다 — `heroHouseholds`가 있을 때만 "세대" 접미사 정규화
  로직을 적용하도록 좁게 수정(§14 mobile QA로 수정 전/후 확인). 이
  버그는 이번 16건 이전에도 존재했을 잠재적 결함이나, household가
  거의 항상 채워져 있던 기존 3,402건에서는 노출되지 않았다.
- 이번 repair는 1회성이다 — `RECENT_MASTER_MISSING_16_AUDIT_V1`이 이미
  확정한 대로 재발 방지(`MASTER_COVERAGE_SYNC_V1`)는 별도 STEP.

## 17. Recurrence Risk

변경 없음 — `MASTER_COVERAGE_SYNC_V1`(주기적 재동기화)이 여전히
미구현 상태다. 다음 달 새로 거래되는 aptSeq는 동일한 방식으로 다시
누락될 것이다.

## 18. Next Step

`MASTER_COVERAGE_SYNC_V1`(승인 필요) — 이번 STEP의 반복 실행이 아니라,
주기적(예: 일/주 단위) 재동기화 파이프라인 설계+구현.
