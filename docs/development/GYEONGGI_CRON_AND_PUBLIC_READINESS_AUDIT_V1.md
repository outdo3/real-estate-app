# E-JIP GYEONGGI CRON AND PUBLIC READINESS AUDIT V1

경기 첫 배치 8구(41111·41113·41115·41117·41131·41133·41150·41210)의 **cron 확장 준비도**와 **공개 모바일 beta 준비도** 감사.
cron 변경 0 · 경기 공개 0 · SEO/sitemap 변경 0 · Production DB write 0. 학교/위치 안전장치 결함은 코드+테스트로 보강(Step 9 지시).

- 날짜: 2026-09-25 (KST) · 기준 `7f5cf04`
- 판정: **CRON = READY_FOR_USER_APPROVAL · PUBLIC_BETA = HOLD**(선행: cron → cronSync, 공개 전 UX 수정 4건, 모바일 실측)

## 1. 현재 cron (vercel.json, Hobby — 1시간 창 안에서 실행)

| cron | KST | 범위 | 셀 | 호출/일(실측) |
|---|---|---|---|---|
| sale-sync | 04:00 | 부산 16 | 16×4개월 = 64 | ≈ 64 |
| sale-recheck | 08:00 | 부산 16 | 160 밴드 중 예산만큼(≈121/일, 42s/45s) | ≈ 120–160 |
| sale-sync scope=seoul | 04:15 | 서울 8 | 32 | 32 (11.6s) |
| sale-recheck scope=seoul | 08:15 | 서울 8 | 80(전체 sweep) | 80 (28.9s) |
| rent-sync | 06:00 | 부산 전월세 | — | 별도 |

- sale: 최근완료월−2 ~ 이번 달(4개월), 이번 달은 coverage 미기록. recheck: 완료월−12 ~ −3(10개월) 밴드를 `verifiedAt` 오래된 순으로 예산 내 순환(체크포인트 대신 staleness).
- 페이지: 1,000행/쪽, totalCount 검증(COMPLETE/PARTIAL/INVALID/EMPTY_VALID), PARTIAL·INVALID는 쓰지 않음.
- 예산: maxDuration 60s, sale 50s/recheck 45s(셀당 2.5s 여유), 순차·요청 간 350ms, 재시도 최대 6회.
- **cron에는 quota reserve 정지가 없다**(x-ratelimit-remaining 관측만). reserve 2,000 규칙은 backfill CLI 전용.
- scope는 하드코딩 allowlist(`resolveSaleSyncScope`: 없음=부산 · `seoul`), enablement를 읽지 않는다(테스트 §H).

## 2. 경기 8구 cron 비용 (월별 밀도 실측: 운영 DB 202509~202609)

경기 8구 월 최대 784행(41117) — **모든 셀 1쪽**(< 1,000). 서울 8구 월 최대 551행.

| 항목 | 호출/일 |
|---|---|
| GYEONGGI_SALE_CALLS_PER_DAY | **32**(8구 × 4개월) |
| GYEONGGI_RECHECK_CALLS_PER_DAY | **≤ 80**(8구 × 10개월, 예산 안에서) |
| GYEONGGI_TOTAL_CALLS_PER_DAY | **≤ 112**(+ 재시도분) |
| BUSAN_CURRENT | ≈ 185–224 |
| SEOUL_CURRENT | 112 |
| GYEONGGI_PROPOSED | ≤ 112 |
| TOTAL_DAILY_CRON | **≈ 410–450**(매매 cron만) — MOLIT 10,000의 약 4.5%, reserve 2,000을 빼도 여유 약 7,550 |

## 3. cron 실행 시간

| 항목 | 추정 | 근거 |
|---|---|---|
| EXPECTED_SALE_RUNTIME | 약 12–20s / 47.5s | 서울 32셀 11.6s, 경기 셀당 행 수가 약 2–3배 |
| EXPECTED_RECHECK_RUNTIME | 약 29–40s / 42.5s | 서울 80셀 28.9s(13,552행), 경기 밴드 약 27,000행 |
| TIMEOUT_RISK | **LOW–MEDIUM** | recheck가 예산을 넘으면 셀 경계에서 멈추고 다음 날 staleness 순으로 이어간다(실패 아님). 별도 호출(scope=gyeonggi)이어야 한다 — 부산 recheck가 이미 42/45s |

## 4. cron 데이터 안전 — CRON_DATA_GATE = PASS

aptSeq 없는 신규 행 insert 안 함 · 취소는 그룹 단위 reconcile(Defect-A 근절 경로, 불일치 시 SKIP) · 자연키에 lawdCd 없음 → 이웃 구 중복은 skipDuplicates(백필에서 경기 expected skip 0) · 41135는 목록에 없음 · 8구 코드 전 기간 연속(원천=DB parity) · 부분 적재 구 없음(8구 전체 이력 COMPLETE).

## 5. master/거래 연결 (운영 READ ONLY, 지도 라우트와 같은 함수)

master 1,193 · 좌표 1,174 · null 19 · 0,0 없음 · (sgg, 법정동, 이름) 중복 0.
최근 12개월 거래 단지 1,114곳을 `buildMasterCoordIndex`/`resolveApartmentCoords`로 연결: **정답 aptSeq 1,114 · 오연결 0 · master 없음 0** · 마커 가능 **1,098** · 좌표 없이 연결 16(19 중 최근 거래 있는 것 — 마커 없음, 이름 fallback 없음).

## 6. 검색·지도·상세 준비도

| 구 | SEARCH_READY | 지도 마커(12개월) | 좌표 없음 |
|---|---|---|---|
| 41111 | YES | 140/140 | 0 |
| 41113 | YES | 173/177 | 4 |
| 41115 | YES | 107/107 | 0 |
| 41117 | YES | 143/143 | 0 |
| 41131 | YES | 81/83 | 2 |
| 41133 | YES | 86/88 | 2 |
| 41150 | YES | 271/276 | 5 |
| 41210 | YES | 97/100 | 3 |

MAP_READY_COUNT 1,174(master) / 1,098(12개월 마커) · MAP_NO_COORD_COUNT 19 · MAP_LEAKS 0.
DETAIL_READY = YES(aptSeq canonical 좌표, null이면 NO_COORDINATE·이름 검색 없음, 위치 카드 "위치 정보를 확인할 수 없습니다", 시군구 "수원시 장안구" 형태). 단 공개 시 cronSync가 false면 상세·지도가 live MOLIT로 읽는다(상세 36개월·지도 12개월 호출) → **cron 먼저, 검증 후 cronSync와 함께 공개** 권장(서울 beta와 같은 순서).

## 7. 학교·위치 안전 — 결함 발견·수정

| 등급 | 결함 | 수정 |
|---|---|---|
| **BLOCKER** | 학교 상세(`/api/school/[id]`)가 NEIS 코드 없는 학교를 부산 전용 통학구역 artifact에서 **이름**으로 찾음 → 의정부 "신곡초등학교" 페이지에 부산 신곡초 통학구역 단지가 "공식 통학구역"으로 표시될 수 있었다(부산 동명: 신곡초 7·동신초 43·대평초 29) | `shouldUseAttendanceZoneArtifact` — NEIS 코드가 있거나 요청 지역이 부산일 때만 artifact 사용 |
| 데이터 무결성 | 상세 정보(`info`) legacy 캐시가 name+dong만으로 조회/upsert — 부산·경기 동명 법정동(금곡동 실측 충돌, 중동·중앙동)에서 **다른 지역 단지의 세대수·주차·용적률 표시 + 부산 행 덮어쓰기** 가능 | 조회에 `lawdCd` 추가(캐시 행 전부 lawd_cd 보유 — 부산 불변), 다른 지역 소유 행이면 쓰지 않음 |
| 데이터 무결성 | 시설(`facilities`) 조회도 name+dong만 | `lawdCd` 전달·조회 조건·공개 게이트 |
| 오식별 | 건축물대장 법정동코드 `name.includes(dong)` — 팔달구 교동 ⊂ 매교동 | `findDongRegcode`: 마지막 토큰 정확 일치, 모호하면 null |
| 표시 정확성 | 유치원 데이터는 부산만(367행 전부 lat 35.x) — 경기에서 "2km 이내 없음"(확인된 부재처럼) · 좌표 없는 경기 단지도 "없음" | 응답 `kindergartenCoverage`·`coordinateMissing` → "준비 중"/"확인 불가" |

확인만(문제 없음): 공식 학교 매칭은 시군구코드로 좁힘(5자리 = 시도 포함), 거리 상한 유치원 2km · 학교 3km · 점수 초등 1km · AI 검색 500m, 부산 학교/좌표 fallback 없음.
범위 밖(낮음, 기록): `/api/school`·`/api/school/stats`의 시군구 파싱(`수원시`까지만 → 수원 4구 합산), 좌표 없는 학교의 이름-only Kakao 검색.

## 8. 점수 · 리포트 · 통계 · SEO

- 점수: 8구 전부 **INSUFFICIENT_DATA** — 경기 입지 피처 0행 → V1 coverage 0.30 < 0.6, V2 `identityEligible=false` → 점수 null, 카드 "점수 산정에 필요한 데이터가 부족합니다". 지어내지 않는다. (JSON 설명에 '부산 전체' 라벨이 남을 수 있는 경로 — UI 미노출, 낮음)
- REPORT_READY = **NO**(리포트/SEO 범위가 `BUSAN_DISTRICTS` 기반) · STATS_READY = **NO**(전월세·입지 피처 부산 전용).
- SEO: 경기 beta 후보는 `seoIndex`·`sitemap` false — 켜도 상세는 NOINDEX, 리포트 BLOCKED, sitemap 경기 0(테스트 13–16).

## 9. 선택기 · 모바일

- 켜면 선택기에 "경기도"가 나오고 그 안에 **8구만**(부모 수원시 41110·성남시 41130은 걸러지고 구 항목은 남음, 라벨 "수원시 장안구"), 41135 없음, "경기도 전체"는 `isSidoPartiallyPublic('41')=true`로 숨김.
- **모바일 360/375/390px 실측은 하지 않았다** — 경기가 닫혀 있어 운영에서 볼 수 없고, 로컬에서 스위치를 켜 띄우면 Production DB를 쓰는 상세 캐시 upsert가 있어 금지. 공개 STEP에서 Preview 배포로 실측해야 한다.

## 10. 공개 전 수정 필요(beta STEP에서)

1. 지도: 닫힌 구(특히 인접한 41135 분당)에서 `regionUnsupported`를 읽지 않고 "표시할 아파트가 없습니다" — "준비 중"으로 구분
2. 지도 `OutOfBusanNotice`: 경기에서 "부산 외 지역… 부산 데이터를 우선 제공" — 마커가 뜨는 지역에서 오해
3. 상세의 "한장 리포트" 링크가 `report` 축을 보지 않음(서울 8구도 동일) — 닫힌 리포트로 연결
4. `/school` 페이지 시군구 파싱(위 §7 범위 밖 항목)
5. 테스트 고정값 갱신(검색 allowlist 24→32 등 약 10곳) · seed 도구 가드(이번에 대상 구 단위로 변경 완료)

## 11. 공개 노출 진리표 (제안 — 적용 안 함)

| 지역 | app | search | map | detail | report | stats | seoIndex | sitemap | cronSync |
|---|---|---|---|---|---|---|---|---|---|
| 부산 16 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 서울 승인 8 | ✓ | ✓ | ✓ | ✓ | – | – | – | – | ✓ |
| **경기 승인 8(제안)** | ✓ | ✓ | ✓ | ✓ | – | – | – | – | 별도 승인(cron 검증 후) |
| 차단 서울 17 | – | – | – | – | – | – | – | – | – |
| 기타 경기(41135 포함) | – | – | – | – | – | – | – | – | – |
| 기타 전국 | – | – | – | – | – | – | – | – | – |

## 12. 코드 변경 (이번 STEP)

- `enablement.ts`: `GYEONGGI_BETA_LAWDCDS`(8) · `GYEONGGI_BETA_ENABLED = false` · `GYEONGGI_BETA_ENABLEMENT` · `buildLawdCdEnablementMap` · `simulateRegionEnablement` — **스위치 OFF라 런타임 변화 0**(테스트 0: 전 노드 시뮬레이션=런타임).
- §7 수정 5건(학교 artifact 지역 규칙 · info/facilities lawdCd · 법정동 정확 일치 · 유치원/좌표 표시).
- seed 도구 가드: 첫 배치 전체 + "경기 선택기 숨김" → **실행 대상 구**의 전 공개 축(경기 beta 후에도 아직 닫힌 구 seed가 막히지 않게).
- 테스트: `src/lib/region/gyeonggi-readiness.test.ts` 16개(§20 항목 1–20 포함), 기존 2곳 갱신.

## 13. 계획 (적용 안 함)

**cron 확장**(별도 승인): CURRENT_CRON_DISTRICTS 부산 16 + 서울 8 = 24 · PROPOSED_ADD 경기 8 · PROPOSED_TOTAL 32.
`resolveSaleSyncScope`에 `gyeonggi`(8구 상수) · vercel.json에 `sale-sync?scope=gyeonggi`(04:30 KST)·`sale-recheck?scope=gyeonggi`(08:30 KST) 추가(서울 뒤, `findCronForRoute` 순서 유지) · cron 집합/시간 고정 테스트 갱신 · 예산 테스트(32셀·80셀). 예상 +112호출/일, sale 12–20s, recheck 29–40s.

**공개 beta**(별도 승인, cron 첫 실행 검증 뒤): `GYEONGGI_BETA_ENABLED = true`(+ 필요 시 cronSync true) · §10 수정 · 고정 테스트 갱신 · Preview 배포에서 360/375/390px 실측 · 운영 GET 누출/회귀 검증.

## 14. 테스트 / 빌드

```
npx tsx --test src/lib/region/gyeonggi-readiness.test.ts                          pass 16
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs" "src/**/*.test.tsx"      pass 2649 fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs" "scripts/**/*.test.ts"   pass 603 fail 0
npx eslint (변경 13파일)                                                          0 errors (apt-client 기존 warning 2)
npx tsc --noEmit                                                                 27건 전부 기존 scripts/·tmp/ → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                                                    exit 0
```
