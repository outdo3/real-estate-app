# E-JIP TEST LOG CLEANUP + TEST DATABASE SAFETY GUARD V1

테스트가 운영 `error_logs`에 남긴 가짜 로그 4행을 제거하고,
**테스트가 Production DB에 쓰지 못하도록** 가드를 넣는다.

- 실행·배포: 2026-09-21 13:50~14:20 KST · 커밋 **`6b80adb`** (기준 `9513e80`)
- **schema 변경 0 · migration 0 · env 변경 0 · MOLIT 호출 0**
- Production write 허용 범위: **`error_logs` DELETE 4행만**

## 판정

**PASS** — 정확히 4행 삭제, business data 불변, 사고 경로가 실제로 차단됨(실측), 운영 런타임 영향 0.

---

## 1. 삭제 precheck

대상 id를 **하드코딩**하고(범위/조건 삭제 없음), 각 행이 `ADMIN_ERROR_LOGGING_P1_V1` §14가 기록한
값과 **정확히 일치**하는지 확인한 뒤에만 진행하도록 했다. 하나라도 다르면 쓰지 않고 중단한다 —
그 사이 같은 id에 진짜 오류가 들어왔을 수 있기 때문이다.

```
mode: DRY_RUN · totalBefore: 127 · found: 4 · expected: 4 · mismatches: []
```

| id | source | message | url | created_at |
|---|---|---|---|---|
| 125 | server | `[ADMIN_OPS_FAILURE][Error] db down` | `/api/admin/ops` | 2026-09-21T04:37:26Z |
| 126 | server | `[ADMIN_DASHBOARD_FAILURE][Error] x` | `/api/admin/dashboard` | 2026-09-21T04:37:26Z |
| 127 | server | `[ADMIN_OPS_FAILURE][Error] db down` | `/api/admin/ops` | 2026-09-21T04:37:42Z |
| 128 | server | `[ADMIN_DASHBOARD_FAILURE][Error] x` | `/api/admin/dashboard` | 2026-09-21T04:37:42Z |

**문서화된 테스트 메시지와 정확히 일치.**

## 2~3. 삭제와 검증

```bash
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 APPROVE_TEST_LOG_CLEANUP=1 \
npx tsx scripts/cleanup-test-error-logs.ts --apply
```

단일 트랜잭션 · affected rows가 4가 아니면 롤백 · 삭제 전 스냅샷 파일 저장.

```
deleted: 4 · totalBefore: 127 · totalAfter: 123 · delta: -4 · remainingTargets: 0
```

| 확인 | 결과 |
|---|---|
| id 125~128 | **0 rows** |
| `error_logs` 총계 | 127 → **123 (−4)** |
| 전체 거래 행 | **866,366 불변** |
| 서울 989 · 중구 943(888/55) · 강남 46 | **불변** |
| 부산 865,291 · 대구 86 | **불변** |
| all-canceled 245 · suspect 304 · known28 restored 28 | **불변** |
| 삭제 이후 거래 행 생성/갱신 | **0 / 0** |

롤백 자료: `tmp/test-error-log-cleanup/deleted-2026-09-21T04-53-38-991Z.json`

## 4. 근본 원인 — 코드로 재확인

가정이 실제와 맞는지 확인했다. **맞다.**

1. 로컬 테스트 프로세스가 `.env`의 **Production `DATABASE_URL`** 을 그대로 쓴다.
2. `logAdminFailure`의 기본 writer가 `logServerError` → `prisma.errorLog.create`였다.
3. `scripts/_prod-db-guard.ts`는 **스크립트가 스스로 `assertProductionDbAccessAllowed`를 부를 때만** 동작한다.
   `grep -rn "assertProductionDbAccessAllowed" src/` → **0건**. 테스트 러너는 그 경로를 **전혀 거치지 않는다.**
4. `src/lib/prisma.ts`는 아무 검사 없이 `new PrismaClient()`를 만들었다.

## 5~6. Production DB 판별

`src/lib/test-db-guard.ts` — **호스트 allowlist 계약**(substring 추측 금지):

```ts
export const NON_PRODUCTION_DB_HOSTS = ['localhost','127.0.0.1','::1','host.docker.internal','0.0.0.0'];
```

여기 없으면 **Production으로 간주**한다(fail-closed). 파싱 불가한 URL도 Production 취급.
`scripts/_prod-db-guard.ts`와 같은 표를 쓰며, **두 구현이 갈라지지 않도록 테스트로 고정**했다.

> **부수 발견(고침)**: `URL.hostname`은 IPv6를 **대괄호째**(`[::1]`) 돌려준다. 그래서 allowlist의
> `'::1'`은 **영원히 매칭되지 않았다** — 기존 `scripts/_prod-db-guard.ts`도 같은 맹점이 있다.
> 안전한 쪽 오류(로컬 IPv6를 Production 취급)라 사고를 만들지는 않았지만 틀린 동작이라,
> 이번 모듈에서는 대괄호를 벗겨 비교하도록 고쳤다. scripts 쪽은 이번 범위 밖이라 그대로 뒀다(§22).

## 7. 테스트 러너 감지

| 신호 | 비고 |
|---|---|
| **`NODE_TEST_CONTEXT`** | **node:test가 자동 설정** — 실측 `"child-v8"`. `npx tsx --test`를 직접 실행해도 잡힌다 |
| `VITEST` / `JEST_WORKER_ID` | 다른 러너 대비 |
| `NODE_ENV === 'test'` | 관례 |
| `execArgv`의 `--test*` | 보조 |

**package.json script를 우회해도 작동한다** — 가드가 명령이 아니라 **코드에 붙어 있기** 때문이다(§10).
이 저장소에는 애초에 `test` script가 없고 `npx tsx --test`를 직접 쓴다.

## 8. 무엇을 막는가 — **쓰기만** 막는다

| 대상 | 동작 |
|---|---|
| 쓰기(`create`·`update`·`upsert`·`delete`·`*Many`·`executeRaw`·모르는 operation) | **차단** |
| 읽기(`findMany`·`findFirst`·`count`·`aggregate`·`groupBy`·`queryRaw` 등) | **통과** |

**읽기를 막지 않은 이유**: `src/lib/report/region-read.integration.test.ts`가 파일 주석에
*"Production 읽기 전용 통합 확인. **SELECT만 한다.** 쓰기/스키마 변경 없음"* 이라고 명시하고
**의도적으로** 운영 DB를 읽는다. 이번 사고는 INSERT였고, §5의 목표도 *"어떤 **write**도 일어나기 전에 FAIL"* 이다.
그 계약을 깨지 않으면서 사고 유형만 차단했다. **읽기 목록에 없는 operation은 전부 쓰기로 본다(fail-closed).**

## 9. 2중 보호 (defense in depth)

**A. Prisma 싱글턴 미들웨어** — `src/lib/prisma.ts`

```ts
if (policy.testSignal) {
  client.$use(async (params, next) => {
    assertTestWriteAllowed(params.action, params.model);
    return next(params);
  });
}
```

**테스트 러너일 때만** 붙는다. 운영 런타임에는 미들웨어가 **아예 달리지 않아** 오버헤드도 동작 변화도 없다.

**B. 쓰기 헬퍼** — `src/lib/log-server-error.ts`가 `prisma.errorLog.create` **직전**에 같은 가드를 부른다.
이 헬퍼가 사고의 실제 경로였으므로 미들웨어와 별개로 한 번 더 막는다.

## 10. TEST_DATABASE_URL

테스트 모드에서 `TEST_DATABASE_URL`이 있으면 **그것을 datasource로 쓰고**, 그 URL 자체도 검사한다
(`TEST_` 접두사만 믿고 통과시키지 않는다 — 테스트로 고정).

**현재 상태: `NO_TEST_DATABASE_CONFIGURED`.** 전용 테스트 DB는 없다.
§20 "test DB 새로 생성 금지"에 따라 **만들지 않았고**, 가드만 먼저 넣었다.
지금은 "쓰기 시도 = 즉시 실패"이며, 쓰기가 필요한 테스트는 **writer를 주입**해야 한다.

## 11~12. 사고 경로 재현 — **핵심 acceptance test**

사고 당시와 **똑같이** 주입 없이 호출하는 임시 테스트를 만들어 운영 DB를 가리킨 채 실행했다.
(임시 파일은 확인 후 삭제)

```
logServerError failed Error: Refusing to run tests against Production database.
  blocked: ErrorLog.create
  detected test runner via: NODE_TEST_CONTEXT
```

두 경로 모두 차단됐다 — ① `logAdminFailure`(주입 없음) → 기본 writer → `logServerError`,
② `logServerError` 직접 호출.

**DB 확인 결과:**

```json
{ "total": 123, "targets125to128": 0, "guardAcceptanceTestRows": 0, "newest": { "id": 124, ... } }
```

**재현 시도가 만든 행: 0.** `logServerError`의 기존 `try/catch`가 가드 예외를 삼켜
`console.warn`으로만 남기므로, **운영 코드 경로를 새로 깨뜨리지도 않는다.**

## 13. 비밀값 노출 금지

차단 메시지에 **DATABASE_URL·호스트·자격증명이 들어가지 않는다**(테스트로 고정):

```
Refusing to run tests against Production database.
  blocked: ErrorLog.create
  detected test runner via: NODE_TEST_CONTEXT
  DATABASE_URL points at a non-local host, and TEST_DATABASE_URL is not set.
  Fix: inject a fake writer in the test, or set TEST_DATABASE_URL to a disposable database.
```

## 14. admin error logging 회귀

| 항목 | 상태 |
|---|---|
| writer injection seam | **유지** (`write: AdminFailureWriter = defaultWriter`) |
| 단위 테스트가 기본 writer 호출 | **없음** — 전부 주입 |
| 단위 테스트가 Prisma 로드 | **없음** — 기본 writer를 **지연 import**로 바꿔, 주입하면 클라이언트가 만들어지지 않는다 |
| 실제 admin 오류 시 `error_logs` INSERT | **계약 유지**(운영 런타임은 가드 대상 아님) |
| `log-admin-failure.test.ts` | **pass** |

부수 정리: 마스킹·예외 분류 순수 함수를 **`src/lib/log-redaction.ts`** 로 분리했다.
예전에는 그 함수 하나를 쓰려 해도 `log-server-error.ts` → `@/lib/prisma`가 함께 로드됐다.
`log-server-error.ts`가 **그대로 re-export**하므로 기존 import 경로(라우트 8곳)는 **한 줄도 바뀌지 않았다.**

## 15. 테스트

| 대상 | 결과 |
|---|---|
| `test-db-guard.test.ts` (신규 20건) | **20 pass** — A(운영 DB+테스트→차단) · B(TEST_DATABASE_URL→허용) · B2(TEST_URL이 운영이면 거부) · C(로컬→허용) · D(운영 런타임→정상) · E(mock/주입→정상) · F(비밀값 미노출) · 사고 재현 · 2중 보호 확인 |
| `log-admin-failure.test.ts` | **pass** |
| `region-read.integration.test.ts` (운영 읽기 전용) | **5 pass / skipped 0** — 읽기가 막히지 않음 확인 |
| **src 전체** | **1,863 pass / 0 fail** |
| **scripts 전체** | **375 pass / 0 fail** |

## 16. Build / Lint / Typecheck

| 검사 | 결과 |
|---|---|
| `npx tsc --noEmit` | **`src/` 오류 0** |
| `npx eslint <변경 8파일>` | **exit 0** |
| `npm run build` | **`✓ Compiled successfully`** |

## 17. Production regression

| 경로 | 상태 |
|---|---|
| `/` · `/stats` · `/school` · `/report/city/busan` · `/community` · `/map` | **전부 200** |
| `/api/admin/dashboard` · `/api/admin/ops` | **401**(게이팅 불변) |

운영 런타임은 `policy.testSignal === null`이라 **미들웨어가 붙지 않는다** — 동작·성능 영향 0.

## 18~19. 쓰기 / 스키마

| 항목 | 값 |
|---|---|
| `error_logs` DELETE | **4** (승인 범위) |
| 그 외 DELETE · INSERT · UPDATE | **0 / 0 / 0** |
| business table write | **0** |
| 서울 · 부산 데이터 | **0 · 0** |
| schema · migration · env | **0 · 0 · 0** |

## 20~21. Commit / Deploy

커밋 **`6b80adb`** (8파일: 신규 4 · 수정 4). push·배포 완료.

## 22. 남은 한계

1. **전용 테스트 DB가 없다**(`NO_TEST_DATABASE_CONFIGURED`). 지금은 "쓰기가 필요한 테스트는
   writer를 주입한다"가 유일한 방법이다. 진짜 DB 쓰기를 검증해야 하는 통합 테스트는 아직 못 쓴다.
2. **`$use` 미들웨어는 raw 쓰기를 전부 잡지 못할 수 있다.** `$executeRaw`는 action 이름으로 들어오면
   차단되지만, Prisma 버전에 따라 미들웨어를 우회하는 경로가 있을 수 있다. 그래서 **Layer B**(쓰기 헬퍼 가드)를
   함께 뒀고, 사고의 실제 경로는 그쪽에서도 막힌다. 앱 전역의 모든 raw 쓰기까지 가드를 거치게 하려면
   더 큰 리팩터링이 필요해 이번 범위 밖이다.
3. **`scripts/_prod-db-guard.ts`의 IPv6 맹점은 고치지 않았다**(§6). 안전한 쪽 오류라 급하지 않고,
   운영 스크립트 가드를 이번 STEP에서 건드리지 않기로 했다.
4. **가드는 `@/lib/prisma`를 쓰는 코드에만 적용된다.** 테스트가 `new PrismaClient()`를 직접 만들면
   Layer A를 우회한다. 현재 `src/` 테스트 중 그런 것은 없다(확인).

## 23. 다음 권고

1. **일회용 테스트 DB를 하나 붙이는 것을 권한다.** 그때 `TEST_DATABASE_URL`만 설정하면 가드가 바로
   허용으로 바뀐다(코드 변경 불필요). 그러면 진짜 쓰기 통합 테스트도 안전하게 쓸 수 있다.
2. **`scripts/_prod-db-guard.ts`의 IPv6 비교를 같은 방식으로 맞춘다.** 작은 변경이고 두 가드의
   판정이 갈라지지 않게 한다.
3. **새 테스트를 쓸 때 규칙 하나만 지키면 된다** — DB에 쓰는 모듈은 **writer를 주입**하거나
   순수 함수만 검증한다. 어기면 이제 **조용히 운영에 쓰이는 대신 즉시 실패**한다.
