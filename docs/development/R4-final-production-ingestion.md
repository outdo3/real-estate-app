# STEP R4 FINAL — Production Migration + 전국/부산 재개발 실데이터 적재

상태: **완료 — migration 적용됨, production ingestion 완료, 실물 검증 완료**

## migration result

`20260819110211_redevelopment_master_schema_r4`를 `npx prisma migrate deploy`로
production(Supabase, session pooler 5432)에 적용했다. `npx prisma migrate
status`로 재확인 — "Database schema is up to date!". Destructive SQL은
DROP COLUMN 4개 + enum 값 교체뿐(DROP TABLE/TRUNCATE/DELETE 없음, R4/R4.1에서
이미 검토 완료), 기존 `RedevelopmentProject`는 0행이라 데이터 손실 없음.
다른 테이블(Apartment 32, Presale 1046 등)은 migration 전후 read-only count로
재확인 — 영향 없음.

## production counts

```text
RedevelopmentProject:      1,798
RedevelopmentSourceRecord: 1,907
```

파일럿(R4.1 InMemoryStore) 결과와 **정확히 일치**.

## quality report(production, read-only)

```text
molitOnly:  1,456
busanOnly:    234
merged:       108
needsReview:   13
```

location classification: PROJECT_SITE 73 / OFFICE 140 / APPROXIMATE 7 /
UNKNOWN 1,578. **좌표(lat/lng)가 채워진 project 0건** — 전체 지오코딩을
하지 않았다는 R4.1 설계가 production에서도 정확히 지켜짐(geocodeStatus
전부 `NOT_ATTEMPTED`, 1,798건).

전국 시도 coverage: 17개 전부. 서울 644 / 경기 241 / 부산 461(MOLIT+BUSAN
합산) / 대구 110 / 인천 67.

`source+sourceRecordId` unique 제약 위반: **0건**.

## idempotency(production, 실제 2회 재실행)

MOLIT + BUSAN importer를 production DB에 대해 **두 번 연속 실행**했다.

```text
1차 실행 후: Project 1,798 / SourceRecord 1,907
2차 실행 후: Project 1,798 / SourceRecord 1,907  (완전 동일)
```

2차 실행에서 BUSAN 343건 전부 `matchedExisting`(자신이 이미 속한 project로
재매칭), `createdProject: 0` — row 폭증 없음 확인.

### 신규 발견 — matchConfidence 재계산 시 self-match로 덮어써짐

2회차 실행 후 전체 SourceRecord의 `matchConfidence`가 **전부 EXACT**로
바뀌어 있는 것을 발견했다. 원인은 버그가 아니라 설계상 당연한 결과다 —
재실행 시 각 레코드는 "자신이 이미 만들어둔 canonical project"를 후보로
다시 조회하게 되고, 그 project의 businessType/normalizedName은 애초에 그
레코드 자신의 값으로 계산된 것이라 트리비얼하게 EXACT가 나온다. **Project/
SourceRecord 행 수·연결 관계·canonical 필드는 전혀 영향받지 않는다**(핵심
idempotency 요구사항은 그대로 충족) — 다만 "최초 ingest 시점에 실제로 몇
%가 EXACT/MEDIUM/LOW였는가"라는 **감사(audit) 목적의 이력 정보**는 재동기화
때마다 사라진다. R5/R6에서 주기적 재동기화(sync) 파이프라인을 만들 때는
이 점을 인지해야 한다 — 필요하면 최초 ingest 시점의 confidence를 별도
보존하는 방식(예: 이미 `mergeStatus`가 `AUTO_MATCHED`/`MANUAL_MATCHED`로
확정된 레코드는 재조회 없이 스킵)을 검토할 수 있으나, 이번 STEP 범위 밖이라
실제 코드는 바꾸지 않았다.

## matching 결과(production, 최초 ingest 시점 — 재실행 전 기록)

```text
MOLIT 최초 ingest: reviewRequired 38 / unmatched 1,526
BUSAN 최초 ingest: autoMatched 109(EXACT/HIGH) / reviewRequired 5 / unmatched 229
```

MEDIUM(REVIEW_REQUIRED)은 자동 병합하지 않고 별도 Project + `needsReview`
플래그로 남기는 정책이 production에서도 그대로 유지됨을 확인했다(총
`needsReview=true` project 13건, 파일럿과 정확히 일치).

## 부산 sigungu(production)

Busan importer 최종 요약: `sigunguResolved: 280 / sigunguUnresolved: 63`
(안전하게 매칭에 쓴 건 280/343 = 81.6%), 소스별 EXPLICIT 148 / DONG_NAME 73 /
ROAD_ADDRESS 36 / PROJECT_NAME 49 / UNRESOLVED 37 — R4.1 파일럿과 완전히
동일. drift 없음.

## Location classification(production)

```text
PROJECT_SITE:  73
OFFICE:       140
APPROXIMATE:    7
UNKNOWN:    1,578
```

`OFFICE`로 분류된 140건 중 `lat`/`lng`가 채워진 건 **0건** — office 의심
좌표가 PROJECT_SITE로 저장되는 사고는 발생하지 않았다(설계대로).

## 부산 서구 검증(production)

**canonical project 24건**(R4.1 파일럿과 동일). 실제 API로도 재확인
(`/api/properties?category=REDEVELOPMENT&sido=...&sigungu=서구`) — 서대신4~7
등 정상 조회됨.

## 서대신4(production)

```json
{"id":648,"stage":"CONSTRUCTION","householdCount":542,"sources":["MOLIT","BUSAN_CITY"]}
```

**canonical project 1개로 병합 성공.** R3A 예측(착공/542세대)과 정확히
일치.

## 아미1 / 아미3(production)

```json
아미1: {"id":649,"businessType":"RESIDENTIAL_ENVIRONMENT","stage":"ZONE_DESIGNATED","sources":["MOLIT"]}
아미3: {"id":650,"businessType":"RESIDENTIAL_ENVIRONMENT","stage":"ZONE_DESIGNATED","sources":["MOLIT"]}
```

**변경 없음, MOLIT-only 그대로 유지.** 좌표 없다고 삭제하지 않음.

## 전국 시도 coverage(production)

17개 시도 전부 확인. 서울 644 / 경기 241 / 부산 461(MOLIT+BUSAN 병합
포함) / 대구 110 / 인천 67 — MOLIT source가 부산 전용으로 잘못
필터링되지 않고 그대로 유지됨을 재확인.

## conflicting MOLIT duplicate(대구 남구 봉덕1동)

Production에서 재확인: SourceRecord **1건만 존재**(fingerprint가 stage/
세대수를 안 봐서 같은 fingerprint의 CSV 두 행이 upsert로 흡수됨,
`rawHouseholdCount="621"` — 나중 CSV 행 값), 삭제나 임의 "최신값 선택"
로직 없음. R3B/R4/R4.1 정책 그대로.

## 기존 서비스 smoke test(production, 실제 배포 URL)

`https://real-estate-app-park11.vercel.app`에 대해 실제 HTTP 요청:

```text
GET /                                              200
GET /apt/대신롯데캐슬?lawdCd=26140&dong=서대신동3가  200
GET /map                                           200
GET /presales                                      200
GET /community                                     200
GET /api/properties?category=REDEVELOPMENT         200 (실 데이터 반환 확인)
```

500 없음. Migration/ingestion 과정에서 `EMAXCONNSESSION`/`too many
clients`/prepared statement 관련 에러는 **발생하지 않았다**(두 importer
모두 예외 없이 정상 종료, 배치 없이 순차 upsert로 진행해 커넥션 풀 압박
없음).

## typecheck / lint / build / tests

Production 적용 전 최종 재실행 — 전부 통과(0 errors, 68/68 tests, 회귀
없음). R4/R4.1에서 이미 검증한 내용을 이 STEP에서 다시 한번 확인만 했다.

## DB reset 여부

**없음.** `migrate reset`/`db push --force-reset` 등 어떤 파괴적 명령도
실행하지 않았다.

## 생성/수정 문서

`docs/development/R4-final-production-ingestion.md`(이 문서),
`docs/development/CHANGELOG.md` R4 FINAL 섹션.

## remaining review items

- MEDIUM(REVIEW_REQUIRED) SourceRecord — 최초 ingest 기준 43건(MOLIT 38
  + BUSAN 5) — R6 관리자 UI에서 사람이 검토해야 할 대상으로 남아있음(자동
  승인 안 됨, 설계대로).
- UNRESOLVED/unsafe-for-matching 63건은 BUSAN-only project로 보수적으로
  남아 있음 — 실제로는 병합 가능했을 수 있는 트레이드오프(R4.1에서 이미
  기록).
- matchConfidence의 재동기화 시 self-match 덮어쓰기(위 "신규 발견") —
  R5/R6 주기적 sync 설계 시 고려 필요.
- office 좌표 실제 지오코딩 파일럿, conflicting duplicate 정책 재검토,
  similarity 임계치 검증 — R4/R4.1의 기존 unresolved 항목 그대로 유지.

## R5 readiness

```text
migration applied:            Yes
ingestion success:             Yes
idempotent:                    Yes(2회 연속 실물 확인)
nationwide coverage:           Yes(17개 시도)
Seo-gu present:                Yes(24건)
Seodaesin4 merged correctly:   Yes
Ami1/Ami3 preserved:           Yes
destructive regression:        없음
DB connection blocker:         없음
```

**R5_GO.**
