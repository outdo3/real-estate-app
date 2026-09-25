# E-JIP GYEONGGI MASTER PILOT APPLY PREP V1

경기 master seed의 apply·rollback·verify 경로 구현 + 41115 수원 팔달구 파일럿(116행)을 **쓰기 직전**까지 준비.
**Production write 0 · master INSERT 0 · Kakao 0 · MOLIT 0.**

- 날짜: 2026-09-25 (KST) · 기준 `252cadb`
- 실행기: `scripts/national-backfill/gyeonggi-master-seed.ts` — 모드 dry-run(기본) · `--preflight` · `--apply` · `--verify` · `--rollback`
- 판정: `scripts/national-backfill/gyeonggi-master-seed-logic.ts`

## 1. 구조

| 모드 | DB | 외부 | 하는 일 |
|---|---|---|---|
| dry-run(기본, 기존) | READ ONLY | Kakao(checkpoint 재개) | 계획·좌표·해시 — 동작 불변 |
| `--preflight` | READ ONLY | 없음 | apply와 **같은** 재계획·게이트를 돌리고 쓰기 직전에 멈춘다(쓰기 승인 불필요) |
| `--apply` | create-only 단일 트랜잭션 | 없음 | 게이트 통과 시 계획 행만 `tx.apartmentMaster.create` |
| `--verify=<applied.json> [--live]` | READ ONLY | 선택: 운영 GET | 사후 검증 |
| `--rollback=<applied.json>` | id 목록 3중 조건 DELETE | 없음 | 파일럿 되돌리기(실행하지 않음) |

apply·preflight는 Kakao를 부르지 않는다 — dry-run checkpoint의 **종결** 좌표만 쓴다(없으면 UNRESOLVED → 게이트 거부). `--apply`와 `--resume`은 함께 쓸 수 없다.

## 2. apply 게이트 (전부 필요)

`--apply` · `ALLOW_PROD_DB_READ=1` · `ALLOW_PROD_DB_WRITE=1`(prod-db-guard BACKFILL, 계획 전에 확인) · `--district` 정확히 1개이며 **`GG_APPLY_ALLOWED_DISTRICTS = ['41115']`**(파일럿 잠금 — 다른 구를 열려면 코드 변경) · 41135 거부 · `--expect-inserts` = 재계획 insert 수 · `--expect-plan-hash` = 재계획 insert 집합 해시 · `computePublicExposureGuarded` true + 경기 선택기 숨김 · 대상 구 REVIEW 0 · UNRESOLVED 0 · 출처 불명 기존 경기 master 0(로컬 applied 기록에 없는 경기 master가 있으면 HOLD).

insert 집합 = 대상 구의 READY만. null 좌표(GEOCODE_MISSING)는 `--allow-null-coords`를 명시할 때만(기본 제외, 정책 미정 — 파일럿은 해당 없음).

## 3. create-only 쓰기

- 트랜잭션 하나(timeout 120s): ① 계획 aptSeq가 이미 있으면 `EXISTING_BEFORE_INSERT`로 중단 ② 행마다 구 가드(`sggCd = 구`, aptSeq 접두) ③ `tx.apartmentMaster.create`(id·aptSeq·sggCd·createdAt·updatedAt 반환).
- 한 행이라도 실패하면 **전체 롤백**(삽입 0) + 실패 aptSeq·오류 코드를 `applied/<runId>.failed.json`에 남긴다. 다음 행으로 넘어가지 않는다.
- update/upsert/createMany/delete 경로 없음(테스트가 소스로 고정). 쓰기 직전 `applied/<runId>.intent.json`(계획 aptSeq·해시·시도별 master 수) 기록.
- 적용 기록 `applied/<runId>.json`(schema `gg-master-seed-applied/v1`): runId · 구 · planHash · 삽입 행 `{aptSeq, id, sggCd, createdAt, updatedAt}` · DB created_at 최소/최대 · 적용 전 시도별 master 수 · rollback 템플릿.

## 4. rollback (실행하지 않음)

```
DELETE FROM apartment_masters WHERE id = ANY($1::int[]) AND sgg_cd = $2 AND created_at BETWEEN $3::timestamp AND $4::timestamp
```

조건: `--rollback=<applied.json>` · `ALLOW_PROD_DB_WRITE=1` · `--run-id` = 기록의 runId · `--expect-deletes` = 기록의 삽입 수 · 구가 apply 범위 안 · id로 다시 읽은 행이 **전부** 기록과 같은 aptSeq·구·created_at 창이고 updated_at이 insert 때 값과 같다(그 뒤 수정 없음). 삭제 수가 기록과 다르면 트랜잭션을 되돌린다. 구만으로 지우는 문장은 없다.

## 5. 사후 검증 (`--verify`, apply 직후 자동 실행)

적용 수 = 기대 수, 실패 0 · 시도별 master 수 변화가 경기 +116, 부산·서울 0 · 41115 master 정확히 116행(계획 aptSeq만) · aptSeq 중복 0 · 구 전부 41115 · 좌표 116/116 · 거래 연결(aptSeq로 41115 매매 존재) 116/116 · 공개 가드 true · `--live`: 검색 경기 결과 0 · 지도 `regionUnsupported` · 상세 `regionUnsupported` · sitemap 경기 0.

## 6. 파일럿 재계획 (preflight, 운영 READ ONLY)

| 항목 | 기대 | 실제 |
|---|---|---|
| 후보 | 116 | 116 |
| READY / GEOCODE_MISSING / REVIEW / UNRESOLVED / SKIP_EXISTING | 116 / 0 / 0 / 0 / 0 | 116 / 0 / 0 / 0 / 0 |
| 과거 제외 | 18 | 18 |
| insert | 116 | 116 |
| 좌표 non-null | 116 | 116 |
| plan hash | `96c97397…075feb` | `96c97397b1d879c3a3126833b27e6f4262fd2acc5b0546038922776acb075feb` |
| 기존 경기 master | 0 | 0 |
| 게이트 | 통과 | allowed, reasons [] |
| Kakao / write | 0 / 0 | 0 / 0 |

거부 확인(preflight, write 0): 41135 → `DISTRICT_41135_EXCLUDED` · 해시 틀림 → `PLAN_HASH_MISMATCH` · 115 → `EXPECT_INSERTS_MISMATCH:115!=116` · 41131 → `DISTRICT_41131_NOT_IN_APPLY_SCOPE` · 41115,41111 → `EXACTLY_ONE_DISTRICT_REQUIRED` 외. `ALLOW_PROD_DB_WRITE` 없이 `--apply` → prod-db-guard BLOCKED(exit 1, 계획 전).

## 7. 파일럿 apply 명령 — **NOT EXECUTED**

```
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/national-backfill/gyeonggi-master-seed.ts --apply --district=41115 --expect-inserts=116 --expect-plan-hash=96c97397b1d879c3a3126833b27e6f4262fd2acc5b0546038922776acb075feb --live
```

(`--live`: apply 직후 자동 verify에 운영 GET 확인 포함.) 사전 조건: 같은 PC의 `tmp/gyeonggi-master-seed/districts/41115/checkpoint.json`(dry-run 산출물)과 `tmp/national-backfill/districts/*/raw`가 있어야 한다.

## 8. 테스트 / 빌드

```
npx tsx --test scripts/national-backfill/gyeonggi-master-seed-logic.test.ts          pass 31 (apply 18항목 포함)
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs" "scripts/**/*.test.ts"       pass 603 fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs" "src/**/*.test.tsx"          pass 2633 fail 0
npx eslint (변경 4파일)                                                              exit 0
npx tsc --noEmit                                                                     27건 전부 기존 scripts/·tmp/, 변경 파일 0 → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                                                        exit 0
```

17·18번(116행·좌표 116/116·해시)은 로컬 `tmp/gyeonggi-master-seed/plan.json`이 있을 때만 돈다(없으면 skip) — 이번 실행에서는 실행·통과.

## 9. 알려진 한계

- 좌표 checkpoint·raw 캐시는 로컬 `tmp/`(커밋 안 함)다. 다른 PC에서는 dry-run부터 다시 돌려야 하고, Kakao 결과가 달라지면 해시가 바뀌어 apply가 거부된다(의도된 동작).
- 출처 판정은 로컬 applied 기록 기준이다 — 기록이 없는 경기 master가 생기면 apply는 HOLD한다.
- 일일 리포트 backfill 감지(detectBackfill)는 거래 신규 행을 센다 — master 적재가 영향을 주는지는 이번 STEP에서 확인하지 않았다(적용 후 확인 항목).
