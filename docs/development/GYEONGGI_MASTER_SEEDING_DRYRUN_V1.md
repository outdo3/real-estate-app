# E-JIP GYEONGGI MASTER SEEDING DRY-RUN V1

경기 첫 배치 8구 `ApartmentMaster` 전체 계획 + 좌표 dry-run. **Production write 0 · master INSERT 0 · MOLIT 0.**

- 날짜: 2026-09-25 (KST) · 기준 `7b67a05`
- 실행기: `scripts/national-backfill/gyeonggi-master-seed.ts`(dry-run 전용 — DB 쓰기 경로 없음, `--apply`는 예외)
- 판정: `scripts/national-backfill/gyeonggi-master-seed-logic.ts`(정책 `gg-master-seed/v1`)
- 산출물(로컬, 커밋 안 함): `tmp/gyeonggi-master-seed/` — `plan.json` · `summary.json` · `districts/<구>/{checkpoint,records}.json` · `logs/`

## 1. 판정

**PASS.** 1,193 후보 중 좌표 검증 1,174(98.41%), 좌표 없음 19, REVIEW 0, UNRESOLVED 0. 식별 불일치·중복·기존 master 0.
파일럿 apply는 **사용자 승인 대기**(권장 41115 수원 팔달구 116행).

## 2. 선행 확인

- `computePublicExposureGuarded` = `{ guarded: true, openAxes: [] }`, 경기 선택기 숨김 true — 실행기가 계획 전에 확인하고 아니면 HOLD로 멈춘다.
- 원천 aptSeq 1,324 = DB aptSeq 1,324(차이 0). 경기 master 0(두 실행 모두).

## 3. 방법

- 원천: 매매 전체 이력 raw 캐시(8구) → aptSeq 후보 → `classifyGgCandidates`(이웃 구 오기재·prefix·필수 필드·충돌 판정). 이름으로 식별하지 않는다.
- 창: 202410~202609(as-of 202609, 서울과 같은 24개월). 창 밖 131 = `EXCLUDED_HISTORY_ONLY`.
- 좌표: 서울 seed의 Kakao 클라이언트 재사용(`realSearchAddress`/`realReverseGeocode` — KA·Origin 헤더, 120ms 간격, 429 재시도 2회 후 RATE_LIMITED 중단). 검색어 `경기 {시군구} {법정동} {지번}` → REGION_ADDR 필지 단일 일치 → 역지오코딩 필지 일치일 때만 좌표.
- 상태(정확히 하나): READY · GEOCODE_MISSING · REVIEW · UNRESOLVED · SKIP_EXISTING · EXCLUDED_HISTORY_ONLY. 좌표 모호(AMBIGUOUS)·다른 시군구 결과(CROSS_REGION)는 REVIEW.
- master 필드: aptSeq · name · normalizedName · sido `경기` · sigungu `수원시 장안구` 형태 · sggCd · umdName · umdCd · jibun · buildYear · latitude/longitude(VERIFIED만) · geocodeQuality(`exact`/`failed`). 세대수·동수 등은 넣지 않는다.

## 4. 구별 결과

| 구 | lawdCd | 거래행 | aptSeq | 후보 | READY | 좌표 없음 | REVIEW | 과거 제외 | 좌표율 | 같은 필지 | Kakao |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 수원 장안구 | 41111 | 68,862 | 170 | 155 | 155 | 0 | 0 | 15 | 100% | 1그룹/4 | 310 |
| 수원 권선구 | 41113 | 79,047 | 220 | 196 | 192 | 4 | 0 | 24 | 97.96% | 2/4 | 392 |
| 수원 팔달구 | 41115 | 38,932 | 134 | 116 | 116 | 0 | 0 | 18 | 100% | 2/4 | 232 |
| 수원 영통구 | 41117 | 111,466 | 149 | 148 | 148 | 0 | 0 | 1 | 100% | 11/25 | 296 |
| 성남 수정구 | 41131 | 19,268 | 108 | 92 | 90 | 2 | 0 | 16 | 97.83% | 0 | 184 |
| 성남 중원구 | 41133 | 28,900 | 109 | 93 | 91 | 2 | 0 | 16 | 97.85% | 1/2 | 186 |
| 의정부시 | 41150 | 115,675 | 313 | 289 | 282 | 7 | 0 | 24 | 97.58% | 7/15 | 578 |
| 광명시 | 41210 | 77,293 | 121 | 104 | 100 | 4 | 0 | 17 | 96.15% | 2/4 | 208 |
| **합계** | | **539,443** | **1,324** | **1,193** | **1,174** | **19** | **0** | **131** | **98.41%** | **26/58** | **2,386** |

UNRESOLVED 0 · SKIP_EXISTING 0 · RATE_LIMITED 0. Kakao 2,386 = 41131 단독 실행 184 + 전체 실행 2,202(41131은 checkpoint 재사용).

## 5. 좌표 없음 19건 — 전부 REVERSE_MISMATCH

정방향은 목표 필지 단일 일치였지만 그 좌표의 역지오코딩 필지가 달랐다(인접 필지 대표점). 좌표를 버리고 null로 둔다.
41113-19 태산 · 41113-437 문영 · 41113-438 전원 · 41113-81 웅비 · 41131-1236 삼부르네상스파크2 · 41131-1277 셀레스빌 · 41133-2659 현성라비도르 · 41133-62 가나2차1 · 41150-124 녹양2차동원아파트(역조회 녹양동 — 다른 법정동) · 41150-145 · 41150-162 · 41150-1739 · 41150-2265 E.Q.빌 · 41150-2440 이든타워 · 41150-47 신곡우성 · 41210-3244 · 41210-34 · 41210-3576 트리우스광명(2단지) · 41210-63. 상세는 `summary.json.nonReadyRecords`.

## 6. 같은 필지

26그룹 · 58 aptSeq(한일타운 대림/쌍용/우성/태영 조원동 881, 화서주공 4/5단지 화서동 650 등 — 대단지 한 필지 여러 aptSeq). aptSeq는 합치지 않고 행을 따로 둔다. 같은 필지 행은 같은 좌표를 공유하며, **서로 다른 필지가 같은 좌표인 경우 0**.

## 7. Plan hash · 재개

- `PLAN_HASH = f31af588398c20048e0130c17989257c12d7d5577bffddca3b679da0602df291`(정책·창·구·aptSeq별 상태·사유·create 필드)
- insert 집합: 좌표 있는 것만 1,174 `e280ed79…1d16` · null 좌표 포함 1,193 `a24522e3…cfdb`
- `--resume` 재실행: Kakao 0회, PLAN_HASH·insert 해시·구별 결과 전부 동일(결정적).

## 8. null 좌표 정책 (결정 필요)

| 선택 | 행 | 비고 |
|---|---|---|
| READY_WITH_COORDS | 1,174 | 좌표 검증된 것만 |
| READY_WITH_NULL_COORDS | 1,193 | + 19건 lat/lng null · geocodeQuality `failed` |

권장: **null 좌표 포함(1,193)**. 서울 seed가 같은 규칙으로 null 좌표 master를 넣었고(서울 master 6,843 중 좌표 6,726), 좌표가 없어도 aptSeq identity로 상세·검색 식별이 가능하다. 지도 마커는 좌표가 없으면 생기지 않을 뿐 다른 단지 좌표를 빌리지 않는다. 결정은 사용자 몫이다 — 파일럿 권장 구(41115)는 두 선택의 결과가 같다.

## 9. 파일럿 권장

**41115 수원 팔달구 — 116행.** 좌표 100%(null 정책 결정과 무관: 두 해시가 같다) · REVIEW 0 · 같은 필지 2그룹/4(화서주공 4/5, 우만주공 1/2) · 적당한 규모.
41131(92행)은 좌표 없음 2건이 있어 null 정책을 먼저 정해야 하고, 41111(155행, 100%)은 규모가 더 크고 같은 필지 4단지 1그룹이 있다.

```
PILOT_DISTRICT       41115
PILOT_EXPECT_INSERTS 116
PILOT_PLAN_HASH      96c97397b1d879c3a3126833b27e6f4262fd2acc5b0546038922776acb075feb
```

apply 경로는 아직 없다. 다음 STEP(승인 후)에서 create-only apply + rollback artifact + 게이트(`--expect-inserts`, `--expect-plan-hash`, `publicExposureGuarded`)를 구현·실행한다.

## 10. 안전 확인

- schema: 모든 create 필드가 기존 컬럼 — NO_SCHEMA_CHANGE_REQUIRED(테스트 12).
- 중복 aptSeq 0 · 구 교차 중복 0 · 기존 master 0 · canonical 충돌 0.
- 공개(운영, dry-run 후): 검색 한일타운·화서주공 0, 41111/41115 마커 `regionUnsupported`, sitemap 경기 0, 가드 true.

## 11. 테스트 / 빌드

```
npx tsx --test scripts/national-backfill/gyeonggi-master-seed-logic.test.ts   pass 20
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs" "scripts/**/*.test.ts"   pass 592 fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs" "src/**/*.test.tsx"      pass 2633 fail 0
npx eslint (신규·변경 3파일)                                                    exit 0
npx tsc --noEmit                                                               exit 2 — 27건 전부 기존 scripts/·tmp/, 신규 0 → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                                                  exit 0
```
