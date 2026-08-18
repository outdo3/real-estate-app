# STEP 54 — Presales Production 500

상태: **원인 확정 / 코드 미수정 / 사용자 승인 대기(구조 변경 필요)**

## 발견 경위

MAIN UI-B2 / STEP 53 production 배포 검수 중, `/redevelopment` →
"분양·청약" 탭 → "분양정보 전체 보기"(`/presales`)로 이동 시
"⚠️ 분양정보를 불러오지 못했습니다."가 표시됨을 발견. STEP 53 diff에는
presales 관련 파일이 전혀 포함되지 않았고, 로컬 dev는 정상이라 STEP 54로
분리해 원인만 조사했다.

이 오류는 이번이 처음이 아니다 — [STEP 20(INFRA
I1)](./20-infra-db-connection-analysis.md)에서 2026-08-14 B3 모바일 검수 중
동일 오류가 1회 관측되었으나, 당시엔 로그가 없어("재현 안 되는 문제를
사후에 규명할 수 있는 유일한 실질적 경로가 사실상 없었다") 원인을 확정하지
못했다. [STEP 21(INFRA I2-A)](./21-infra-error-observability.md)에서
`logServerError`를 presales 4개 API에 연결해 관측성만 보강해 두었고,
"재발 시 로그를 먼저 확인하고 구조 변경(INFRA I2-B) 여부를 판단한다"고
명시적으로 미뤄둔 상태였다. 이번이 그 "재발" 케이스다.

## Production 증상

```
GET https://real-estate-app-park11.vercel.app/api/presales?page=1
→ 500 {"success":false,"error":"분양정보를 불러오지 못했습니다."}
```

재현 시각(UTC, ErrorLog 기준): 2026-08-14 02:32:52, 06:44:44, 06:44:58,
06:45:30, 06:45:38 — 총 5회 확인. 이후(연결 압력이 줄어든 뒤) 재확인한
결과 200으로 회복됨(아래 "실제 root cause" 참고 — 이 회복 자체가 원인
판단의 핵심 근거).

## Local 증상

동일 코드(`git status` clean, HEAD와 100% 동일한 워킹트리) 기준
`http://localhost:3000/api/presales?page=1` → 200, 항상 정상.

## 관련 route

`src/app/api/presales/route.ts` — `export const dynamic = 'force-dynamic'`,
외부 API 호출 없음. `Promise.all`로 두 Prisma 호출을 병렬 실행:
`prisma.presale.findMany({ where, orderBy })` +
`prisma.presale.groupBy({ by: ['subscriptionAreaName'], ... })`. catch
블록에서 `logServerError(buildErrorLogMessage('GET /api/presales', error), '/api/presales', ...)`
호출(STEP 21에서 추가됨) 후 500 반환.

## 관련 service/helper

- `src/lib/prisma.ts` — 표준 singleton 패턴(`globalForPrisma.prisma ?? new PrismaClient()`).
  전체 코드베이스에서 `new PrismaClient()`는 이 한 곳뿐임을 재확인
  (`rg "new PrismaClient"` — 다른 곳에서 별도 client를 만들어 connection을
  누수시키는 코드는 없음).
- `src/lib/log-server-error.ts` — `logServerError`/`buildErrorLogMessage`.
  이번 조사에서 이 helper가 실제로 정상 작동함을 확인했다(아래 ErrorLog
  조회 결과가 그 증거).

## Prisma model

`Presale`(`prisma/schema.prisma` 326행~) — nullable 필드 다수, enum
`PresaleHouseType`. `route.ts`의 `where`/`orderBy`(`subscriptionAreaName`,
`maxPrice`, `receiptStartDate`)에 쓰이는 필드 전부 schema에 정확히
존재함을 확인했다. **schema mismatch 아님**(아래 "실제 root cause" 참고 —
쿼리 자체는 로컬/프로덕션 어디서든 유효한 쿼리이고, DB 스키마 문제가
아니라 연결 자체가 거부된 것).

## Production/Local 차이

| 항목 | Local | Production |
|---|---|---|
| DATABASE_URL | 동일 값(`.env`, 프로젝트 단일 DB — 별도 dev/prod DB 분리 없음) | 동일 값으로 추정(코드/설정에 별도 production 전용 override 없음) |
| 실행 모델 | 단일 장기 실행 Node 프로세스(`next dev`), PrismaClient singleton 재사용 | Vercel 서버리스 — 함수 인스턴스마다 별도 프로세스/별도 PrismaClient(STEP 20에서 이미 확정된 구조) |
| DB 연결 방식 | 동일(Supabase Session Pooler, `aws-0-ap-northeast-2.pooler.supabase.com:5432`) | 동일 |
| 관측된 상태 | 항상 200 | 부하에 따라 500 ↔ 200 (아래 참고) |

즉 코드/쿼리/스키마는 완전히 동일하고, 차이는 **동시에 열리는 DB
connection 수**뿐이다 — local은 항상 프로세스 1개(=connection 1세트)만
쓰지만, production은 서버리스 인스턴스 수만큼 동시에 늘어날 수 있다.

## 실제 production exception

`ErrorLog`(`error_logs` 테이블)에서 `url = '/api/presales'`로 최근 5건을
직접 조회했다(read-only, 기존에 이미 존재하는 관측 기능을 조회한 것 —
새 로깅을 추가하지 않았다). 5건 전부 동일한 예외:

```
[GET /api/presales][PrismaClientUnknownRequestError]
Invalid `prisma.presale.findMany()` invocation:
Error in connector: Error querying the database: FATAL: (EMAXCONNSESSION)
max clients reached in session mode - max clients are limited to pool_size: 15
```

(`groupBy()` 호출에서도 동일 메시지로 3건 관측 — `Promise.all`의 두 쿼리
중 어느 쪽이 세션을 못 얻었는지에 따라 갈림.)

이 진단 과정에서 로컬 스크립트로 동일 DB에 읽기 전용 조회
(`prisma.errorLog.findMany`)를 1회 시도했을 때도 **같은 `EMAXCONNSESSION`
오류로 즉시 거부됨**을 직접 재현했다 — 즉 이 진단 자체가 "지금 이 순간
pool이 실제로 가득 차 있다"는 것을 라이브로 재확인한 셈이다. 이후
로컬 dev 서버를 종료해 connection 하나를 반납한 뒤 재시도하니 정상
조회됨.

## root cause

**확정.** Supabase **Session Pooler**(`pool_size: 15`)의 동시 세션 한도
초과(`EMAXCONNSESSION`) — 새 연결 요청이 물리적으로 거부됨.
[STEP 20](./20-infra-db-connection-analysis.md)이 "구조적 위험(MEDIUM),
로그 없어 확정 불가"로 남겨둔 정확히 그 후보가, 이번에 실제 예외
스택트레이스로 100% 확정되었다.

Session Pooler는 클라이언트 1개당 세션을 "독점 배정"하는 방식이라(공식
문서, STEP 20에서 이미 확인) 동시 연결 수가 15개를 넘는 순간부터 그
이상의 신규 연결은 즉시 거부된다 — DB 서버 부하나 데이터 문제가 아니라
**연결 자체가 pool 입구에서 거절**되는 것이다. 이 구조에서는:
- 서버리스 인스턴스가 동시에 여러 개 뜨는 순간(예: 실사용자 여러 명이
  동시에 여러 페이지에 접근, 또는 이번처럼 짧은 시간에 반복 요청)
  pool이 소진되기 쉽다.
- pool이 소진되지 않은 시점에는 정상 200이 나온다 — 실제로 이번 조사
  마지막에 부하가 줄어든 뒤(로컬 dev 서버 종료 + 요청 간격을 둠) 재확인한
  production `/api/presales`는 **200 정상**으로 돌아왔다. 이 회복
  자체가 "코드/스키마 결함"이 아니라 "연결 용량 문제"라는 결론을
  뒷받침하는 직접 증거다.

## Vercel log

Vercel Function Logs(대시보드)는 이 세션에서 접근 권한/CLI 연동이 없어
직접 확인하지 못했다. 대신 이미 이 프로젝트에 구현돼 있는 대체 관측
경로(`ErrorLog` 테이블, STEP 21에서 마련됨)로 필요한 정보를 전부 얻었다
— 실제 예외 클래스(`PrismaClientUnknownRequestError`)와 원본 DB 오류
메시지까지 확보했으므로 Vercel 로그 없이도 root cause는 확정적이다.

## DB 영향

없음. 조회만 했다(`errorLog.findMany`, 읽기 전용). `Presale`/
`PresaleHouseTypeDetail` 등 어떤 테이블에도 쓰기 작업을 하지 않았다.
schema 변경/migration 없음.

## env 영향

값은 출력하지 않고 존재/사용 여부만 확인(STEP 20 대비 변경 없음을
재확인):

| 변수 | 상태 |
|---|---|
| `DATABASE_URL` | 설정됨. host=`aws-0-ap-northeast-2.pooler.supabase.com`, port=`5432`(Session Pooler) |
| `DIRECT_URL` | 미설정(STEP 20과 동일) |
| `pgbouncer=true` 파라미터 | 없음 |
| `connection_limit` 파라미터 | 없음 |

## package 영향

**무관함을 확인.** STEP 53의 `npm install lucide-react`가 이번 오류와
관련 있는지 명시적으로 확인했다:
- `@prisma/client`/`prisma` CLI 버전 둘 다 `5.22.0`으로 STEP 53 전후
  변경 없음(`npm ls @prisma/client prisma`로 확인).
- STEP 53의 `package-lock.json` diff(12줄 추가/1줄 삭제, 이미 STEP 53
  문서에 기록됨)는 `@prisma/client`가 lockfile 루트 메타데이터에서
  `devDependencies`→`dependencies`로 재분류된 것(package.json 원본은
  처음부터 `dependencies`였음 — 실제 분류 변경 아니라 npm의 정규화)과
  `lucide-react` 엔트리 추가뿐이다.
- `lucide-react`는 런타임 의존성이 0개(순수 아이콘 컴포넌트)라 Prisma/DB
  연결 경로와 코드상 접점이 전혀 없다.
- ErrorLog의 가장 오래된 관측(2026-08-14 02:32:52)은 STEP 53의 첫 코드
  변경 시점보다 앞선다(같은 세션 내에서 STEP 52 검수 이후, STEP 53
  구현을 시작하기 전 구간) — 즉 STEP 53 코드가 배포되기 전에도 이미
  같은 오류가 발생했다.

**결론: package-lock 변화와 무관.**

## 수정 내용

**없음.** 코드/설정을 전혀 변경하지 않았다.

## schema/migration 필요 여부

**불필요.** Prisma schema는 현재 쿼리와 완전히 호환된다(필드 존재 확인
완료). 문제는 스키마가 아니라 connection 방식이다.

## production DB write 필요 여부

없음(구조 변경은 `DATABASE_URL` 값 자체를 바꾸는 것이지 DB 내부의
데이터/테이블을 바꾸는 것이 아니다).

## 검증

코드를 수정하지 않았으므로 `tsc`/`eslint`/`build`/local API 재검증은
해당 없음(변경 파일 0개).

## 남은 위험

- **지금 당장은 재현되지 않지만, 동시 접속/요청이 늘어나면 언제든 다시
  500이 발생한다.** 근본 원인(Session Pooler 세션 한도)이 그대로이기
  때문 — 이번에 "고쳐진" 것이 아니라 "지금 순간 부하가 낮아서 안 걸리는"
  상태다.
- 사용자가 여러 명 동시에 `/presales` 목록 또는 다른 DB 사용 API에
  접근하면 재발 가능성이 높다.

## 배포 가능 여부

해당 없음(코드 변경이 없어 배포할 것이 없음). **구조적 해결이 필요하며,
그 조치는 이번 STEP의 승인 범위를 벗어난다.**

## STEP 20이 이미 제시해 둔 해결 후보 (재확인, 이번 STEP에서 실행하지 않음)

이번 조사로 STEP 20의 "후보 C/D/E"가 가설에서 확정 원인의 직접적
해결책으로 격상되었다. 우선순위(위험 낮은 순, STEP 20 원문 그대로):

1. **connection_limit 조정** — `DATABASE_URL`에
   `connection_limit=N`(N은 신중히 선택, 너무 낮으면 이 route처럼 병렬
   쿼리가 있는 API에서 오히려 순차 대기 증가) 추가.
2. **Transaction Pooler(6543)로 전환** — Supabase가 서버리스 전용으로
   명시 권장하는 방식. `pgbouncer=true` 파라미터 필수 동반.
3. **DIRECT_URL 도입** — `prisma/schema.prisma`에 `directUrl` 필드 추가,
   migration은 Direct connection으로, 런타임은 Pooler로 분리.

전부 `DATABASE_URL`(Vercel 환경변수) 및/또는 `prisma/schema.prisma`
변경이 필요하다 — STEP 54의 승인 범위(코드 전용 수정) 밖이라 이번에는
실행하지 않았다.
