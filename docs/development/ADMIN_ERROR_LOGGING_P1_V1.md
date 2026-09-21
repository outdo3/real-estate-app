# E-JIP ADMIN ERROR LOGGING P1 V1

관리자 화면이 실패할 때 `console.error`만 남던 구조를 보완해, **기존 `error_logs`에 추적 가능한 최소 증거**를 남긴다.

- 구현·배포: 2026-09-21 13:30~13:50 KST · 커밋 **`5a0edd9`** (기준 `089fc23`)
- **schema 변경 0 · migration 0 · env 변경 0 · MOLIT 호출 0**
- 서울 데이터 · SEO · sitemap **변경 0**

## 판정

**PASS** — 대상 경로 계측, category 구분, 민감정보 마스킹, best-effort, 중복 억제, 테스트, 배포까지 완료.

**다만 작업 중 실수가 하나 있었다. §16에 숨기지 않고 적는다 — 테스트가 운영 `error_logs`에 4행을 썼다.**

---

## 1. 기존 `error_logs` 계약

실측 스키마(`information_schema`):

| 컬럼 | 타입 | NULL |
|---|---|---|
| `id` | integer | NO |
| `source` | text | NO |
| `message` | text | NO |
| `stack` | text | YES |
| `url` | text | YES |
| `created_at` | timestamp | NO |

**`category`·`metadata`·`severity` 컬럼이 없다.** 스키마를 바꾸지 않기로 했으므로
category는 **기존 관례대로 `message` 접두사**에 싣는다 — `buildErrorLogMessage`가 이미
`[method][kind] message` 형태를 쓰고 있어 그 자리에 category를 넣으면 규칙이 하나로 유지된다.

기존 writer: `prisma.errorLog.create` 직접 호출은 `/api/log/error`(클라이언트 수집)와
`src/lib/log-server-error.ts` 두 곳뿐. **후자를 그대로 재사용했다**(새 테이블·새 헬퍼 계층 없음).

## 2. 재사용한 헬퍼 / 새로 만든 것

| | 역할 |
|---|---|
| **재사용** `logServerError(message, url, stack)` | 실제 쓰기 + **내부 try/catch(best-effort)** |
| **재사용** `buildErrorLogMessage(method, error)` | Prisma 예외 분류(`P2024` 등) + 마스킹 |
| **확장** `redactSensitive()` | 기존 connection string 마스킹에 **키/토큰/헤더** 추가(§6) |
| **신규** `src/lib/admin/log-admin-failure.ts` | category 상수 · 중복 억제 · 주입 seam |

신규 모듈은 얇다 — 쓰기·마스킹은 전부 기존 헬퍼에 위임한다.

## 3. 계측한 엔드포인트

| 엔드포인트 | category | 시점 |
|---|---|---|
| `/api/admin/dashboard` | `ADMIN_DASHBOARD_FAILURE` | catch(전체 실패) |
| `/api/admin/ops` | `ADMIN_OPS_FAILURE` | catch(전체 실패) |
| `/api/admin/ops` | **`ADMIN_OPS_REGION_MODEL_FAILURE`** | **부분 실패**(외부 프록시 조각) |
| `/api/admin/behavior` | `ADMIN_BEHAVIOR_FAILURE` | catch |

**`/api/admin/system-health`는 의도적으로 제외했다** — §9 참조.

§2의 "모든 admin endpoint에 무작정 추가하지 않는다"에 따라, 운영자가 실제로 실패를 겪은
**핵심 경로 3개**만 계측했다. `users`·`feedback`·`presales/sync`는 이번 범위 밖이다.

## 4. 기록되는 것 / 안 되는 것

기록 예(실제 형태):

```
source  : server
url     : /api/admin/ops
message : [ADMIN_OPS_FAILURE][PrismaClientKnownRequestError:P2024] Timed out fetching a new connection (latencyMs=9873)
stack   : (Error.stack, 마스킹 후 5000자 제한)
created_at : now()
```

| 항목 | 어디에 |
|---|---|
| category | `message` 접두사 |
| endpoint | `url` |
| error name / Prisma code | `message`의 `[kind]` |
| message | `message` (마스킹 후 2000자 제한) |
| **latency** | `message` 끝 `(latencyMs=…)` — **타임아웃/콜드스타트 판별용** |
| timestamp | `created_at` |
| subsystem | category로 구분(`…_REGION_MODEL_FAILURE`) |

**request correlation id는 남기지 않았다** — 이 앱에 요청 id를 발급하는 체계가 없고,
만들려면 미들웨어·전파 경로가 따라온다(§14 "과도한 복잡도 없이" 위반). 남은 gap으로 기록한다(§17).

### 민감정보 제외 (§3)

`redactSensitive()`가 저장 직전에 건다. 기존에는 connection string만 가렸는데,
이 앱은 **MOLIT `serviceKey`를 쿼리스트링에 싣고** fetch 실패 메시지에는 URL이 통째로 들어온다.

| 패턴 | 처리 |
|---|---|
| `postgres(ql)://…` | `[redacted-connection-string]` |
| `serviceKey` · `api_key` · `access_token` · `refresh_token` · `id_token` · `token` · `secret` · `password` · `client_secret` | **값 전체 제거** → `키=[redacted]` |
| `Authorization:` · `Cookie:` · `Set-Cookie:` | `키: [redacted]` |
| `Bearer xxx` | `Bearer [redacted]` |

**저장하지 않는 것**: 요청 헤더 원문 · 쿠키 · 세션/OAuth 토큰 · IP · 개인정보 · DB 자격증명 · env 값.
ErrorLog에 애초에 그런 컬럼이 없고, 코드도 스키마 밖 필드를 쓰지 않는다(테스트로 고정).

진단에 필요한 값은 남긴다 — 예: `lawdCd=26140`은 지우지 않는다(테스트로 고정).

## 5. Best-effort — 로깅이 관리자 응답을 망가뜨리지 않는다

```ts
export function logAdminFailure(input, write = logServerError): void {
  try {
    …
    void Promise.resolve(write(withLatency, input.endpoint, stack)).catch(() => {});
  } catch (e) {
    console.warn('[admin] logAdminFailure failed', e);
  }
}
```

- **`void` 반환** — 호출부가 실수로 `await`할 수 없다(테스트로 고정).
- **라우트가 `await`하지 않는다** — 실패 응답이 로깅 때문에 늦어지지 않는다(테스트로 고정).
- **동기 throw와 rejected promise 양쪽**을 삼킨다 — INSERT 실패가 **새 500을 만들지 않는다**.
- 기존 응답/상태 코드/문구는 **그대로**다.

## 6. False success 없음

로그를 남겼다고 실패가 성공이 되지 않는다. UI 표시는 이전 STEP 그대로다:

| 상황 | 화면 |
|---|---|
| 전체 실패 | `⚠️ 운영 데이터를 불러오지 못했습니다.` (숫자 카드 미렌더) |
| 부분 실패 | 배너 + 해당 항목 **`확인 불가`** |
| 정상 | 정상 |

## 7. 중복 억제 (flood control)

기존 dedupe/rate-limit 헬퍼가 **없어서** 최소 보호만 넣었다(스키마 변경 없이).

| 항목 | 값 |
|---|---|
| 키 | `endpoint | message 앞 200자` |
| 창 | **5분** (`DEDUPE_WINDOW_MS`) |
| 창 경과 후 | **다시 기록** — 장애가 계속된다는 사실을 잃지 않는다 |
| 상태 | 프로세스 메모리 `Map`, 같은 호출에서 만료 항목 정리(무한 증가 방지) |

필요한 이유: 대시보드는 **20초마다 자동 갱신**(SWR)이다. 10분 장애면 한 화면만으로 수십 행이 쌓인다.

한계(정직하게): 인스턴스 단위라 Vercel 인스턴스가 여러 개면 **인스턴스마다 한 번씩** 남는다.
스키마 없이 더 줄이려면 분산 상태가 필요해 이번 범위 밖이다.

## 8. 테스트 — 19건 통과

| # | 내용 | 결과 |
|---|---|---|
| A | 3개 핵심 경로가 실제로 기록을 호출 | pass |
| B | 부분 실패가 전체 실패와 **다른 category** | pass |
| C | INSERT 실패(동기 throw·reject) 시 **throw하지 않음** | pass |
| C | category/endpoint/latency가 실제로 전달됨(DB 없이) | pass |
| C | `void` 반환 · 라우트가 `await`하지 않음 | pass |
| D | connection string · serviceKey · 토큰 · 비밀번호 · Authorization · Cookie 마스킹 | pass |
| D | 비밀 아닌 값(`lawdCd`)은 보존 | pass |
| D | 스키마 밖 필드(ip/userAgent/headers/cookies) 미사용 | pass |
| E | 로깅이 **catch 안에서만** 호출됨(정상 경로 로그 0) | pass |
| E | 테스트가 prisma를 직접 import하지 않음 · 주입 seam 존재 | pass |
| — | 중복 억제 4건(창 내 억제 · 창 경과 후 재기록 · 서로 다른 장애 비억제 · 만료 정리) | pass |
| — | **system-health는 read-only 계약 유지** | pass |

회귀 포함 `admin/*` · `kst-day` · `region-utils.failure` 등 **107 pass / 0 fail**.

## 9. system-health를 제외한 이유

`src/lib/admin/system-health.test.ts` §14가 이미 이렇게 고정하고 있다:

```ts
for (const forbidden of ['prisma.errorLog.create', 'prisma.errorLog.delete', …]) {
  assert.ok(!code.includes(forbidden), `관리자 조회 경로가 쓰기를 한다: ${forbidden}`);
}
```

이 라우트는 **`error_logs`를 읽어서 보여주는 화면**이다. 읽는 화면이 같은 테이블에 쓰면
"오류를 보는 화면이 오류를 만든다"가 되고, 기존에 의도적으로 세운 read-only 계약이 깨진다.
실제로 그 라우트는 `console.warn`조차 `error.name`만 찍는다(원문에 connection string이 섞일 수 있어서).

`logAdminFailure`를 쓰면 문자열 검사는 통과하겠지만 **규칙의 취지를 우회하는 것**이라 하지 않았다.
대신 그 제외를 **테스트로 고정**했다(§8 마지막 줄) — 나중에 누가 무심코 추가하면 실패한다.
필요하다면 별도 승인 STEP으로 다루는 편이 맞다.

## 10. Build / Lint / Typecheck

| 검사 | 결과 |
|---|---|
| `npx tsc --noEmit` | **`src/` 오류 0** (전체 25건은 기존 무관 스크립트) |
| `npx eslint <변경 6파일>` | **exit 0, 지적 0건** |
| `npm run build` | **`✓ Compiled successfully`** |

## 11. Production regression

고의 장애 주입 **없음**(§9 준수). 정상 엔드포인트만 확인:

| 경로 | 상태 |
|---|---|
| `/` · `/stats` · `/school` · `/report/city/busan` · `/community` | **전부 200** |
| `/api/admin/dashboard` · `/ops` · `/behavior` · `/system-health` | **전부 401**(정상 게이팅) |

이전 STEP 산출물도 그대로다: `startOfKstDay` 사용 유지 · `todayVisitSessions`/`오늘 방문 세션` 라벨 유지 ·
`degradedSources` 부분 실패 격리 유지(grep 확인).

## 12~13. 쓰기 범위

| 항목 | 값 |
|---|---|
| business table INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| schema · migration | **0 · 0** |
| `page_views` 컬럼 · user_agent · IP · bot filtering · `active_sessions` cleanup | **0**(§12 금지 준수) |
| `error_logs` — 배포 자체가 만든 행 | **0** (배포 후 신규 행 없음, 실측) |
| `error_logs` — 앞으로 | **실제 오류 발생 시에만 INSERT**(§13 허용 범위) |

## 14~16. 작업 중 발생한 실수 — 테스트가 운영 `error_logs`에 4행을 썼다

**무슨 일이 있었나.** 초안 테스트가 `logAdminFailure()`를 주입 없이 호출했고,
기본 writer가 `logServerError` → **진짜 `prisma.errorLog.create`** 였다. 로컬 `.env`가 운영
DATABASE_URL을 가리키므로 테스트 실행이 **운영 DB에 그대로 기록**됐다.

읽기 검증 중 `last_24h`가 0에서 4로 바뀐 것을 보고 발견했다.

| id | message | url | created_at |
|---|---|---|---|
| 125 | `[ADMIN_OPS_FAILURE][Error] db down` | `/api/admin/ops` | 2026-09-21T04:37:26Z |
| 126 | `[ADMIN_DASHBOARD_FAILURE][Error] x` | `/api/admin/dashboard` | 2026-09-21T04:37:26Z |
| 127 | `[ADMIN_OPS_FAILURE][Error] db down` | `/api/admin/ops` | 2026-09-21T04:37:42Z |
| 128 | `[ADMIN_DASHBOARD_FAILURE][Error] x` | `/api/admin/dashboard` | 2026-09-21T04:37:42Z |

**범위**: `error_logs` 4행뿐. business table 변경 **0**. 민감정보 **없음**(메시지가 `x`/`db down`).
숫자 지표·서울 데이터·스키마 영향 **없음**.

**어떻게 막았나**: `logAdminFailure(input, write = logServerError)`로 **쓰기 주입 seam**을 넣고,
모든 테스트가 writer를 주입하도록 고쳤다. 추가로 **"이 테스트 파일은 prisma를 직접 import하지
않는다 + 주입 seam이 존재한다"** 를 테스트로 고정해 재발을 막았다.

**남은 4행은 지우지 않았다.** 삭제도 운영 쓰기이고 이번 승인 범위(§13: 실제 오류 시 INSERT만)에
없기 때문이다. 관리자 오류 패널에 가짜 항목 4개로 보이므로, **원하시면 승인 후 제거**하겠다.

## 17. 남은 P1 / P2

**P1**

1. **`system-health` 계측** — read-only 계약과 충돌해 보류(§9). 열려면 그 계약을 바꿀지 결정이 필요하다.
2. **request correlation id** — 지금은 없어서 같은 요청의 여러 로그를 묶을 수 없다. 미들웨어 도입 필요.
3. **`page_views.user_agent`** — 여전히 금지 범위(V2). 봇 판별 불가 상태 그대로.

**P2**

4. 인스턴스 간 dedupe(현재는 인스턴스 단위).
5. `error_logs` 보존 정책 — 지금은 무한히 쌓인다(현재 127행이라 급하지 않다).
6. 테스트용 DATABASE_URL 분리 — 이번 사고의 근본 원인은 **로컬 테스트가 운영 DB를 본다**는 구조다.
   주입 seam으로 이 모듈은 막았지만, **다른 테스트가 같은 실수를 할 여지는 남아 있다.**

## 18. 다음 권고

1. **운영 `error_logs` 125~128 제거 여부를 정해 주십시오.** 지우면 관리자 오류 패널이 깨끗해진다.
2. **P2-6(테스트 DB 분리)을 권한다.** 이번 사고의 진짜 원인이고, 같은 실수가 다른 테스트에서
   반복될 수 있다. `_prod-db-guard`가 스크립트는 막지만 **`npx tsx --test`는 거치지 않는다.**
3. **며칠 관찰 후 실제 실패가 잡히는지 확인**한다. 운영자가 "운영 데이터를 불러오지 못했습니다"를
   다시 보면, 이제 `error_logs`에 `[ADMIN_OPS_FAILURE]`와 latency가 남아 원인(타임아웃/연결/프록시)을
   구분할 수 있다. 그 근거가 쌓이면 P1-3(ops DB 쿼리 개별 격리) 판단도 사실 기반으로 할 수 있다.
