# STEP 55 — Production DB Pooling Fix

상태: **해결 완료 — Transaction Pooler + 실제 비밀번호 적용 후 production
정상 확인, 코드/schema/migration 무변경**

## 최종 결과 (2026-08-18, 비밀번호 교체 + redeploy 이후 재검증)

1차 Transaction Pooler 전환(포트만 6543으로 변경) 직후 재검증에서는
여전히 500이 재현됐다(아래 "적용 후 검증 결과(1차)" 섹션 참고). 원인은
**Transaction Pooler connection string 안에 Supabase가 기본으로 채워주는
`[YOUR-PASSWORD]` placeholder가 실제 DB 비밀번호로 교체되지 않은 것**
이었다 — 즉 첫 시도는 pooler 종류(구조)는 맞게 바꿨지만 값 자체가
아직 유효한 자격증명이 아니었다. 사용자가 이 placeholder를 실제
비밀번호로 교체하고 다시 redeploy한 뒤 재검증한 결과는 **전부 정상**
이다:

| 확인 항목 | 결과 |
|---|---|
| `GET /api/presales?page=1` × 5회(간격 3초) | **5/5 = HTTP 200**, 응답 3.1~3.3s로 안정적(이전 정상 구간 0.75~1.1s보다는 느리지만 — 뒤 "성능" 절 참고 — `connection_limit=1`의 예상된 트레이드오프로 판단, timeout/오류 아님), `success:true` + 실제 데이터(검색 결과 1,046건) 확인 |
| `GET /api/community/recent-activity` × 3회 | **3/3 = HTTP 200**, `success:true` |
| `GET /api/apt/[name]?...`(대신푸르지오1차아파트, 기존 정상 API) | HTTP 200, 실거래 데이터 정상 |
| `GET /api/presales/2`(추가 선정 Prisma API, presale 상세) | HTTP 200, `success:true` |
| production UI(정확한 사용자 flow: 홈→재개발·분양→"분양·청약" 탭→"분양정보 전체 보기"→`/presales`) | 오류 메시지 없음, 카드 20건 정상 렌더, pagination "1/53" 정상 표시, `청약홈에서 공고 보기` 외부링크도 정상 |
| 브라우저 콘솔 신규 오류 | 없음 — 기존 `[next-auth][error][CLIENT_FETCH_ERROR]`만 그대로(범위 밖, 무변경) |
| `ErrorLog`(`/api/presales`, `/api/community/recent-activity`) 신규 항목 | **없음** — 가장 최근 기록이 이전 실패 라운드보다도 이전인 `2026-08-14T06:45:38Z`(id=9)이고, 그 이후 신규 행 0건. `EMAXCONNSESSION`/`prepared statement`/password 인증 오류 전부 신규 발생 없음 |

**최종 판단**: Transaction Pooler(6543) + `pgbouncer=true` +
`connection_limit=1` + 실제 DB 비밀번호 조합이 production에서 정상
작동함을 확인했다. STEP 54의 root cause(Session Pooler 세션 한도
초과)는 이 전환으로 해결됐다.

## 적용 후 검증 결과(1차, placeholder 미교체 상태 — 실패했던 시도)

아래 "배경"~"남은 위험"까지는 **변경 전** 조사·설계 기록이다(당시
BLOCKER 2로 직접 적용은 못 했음). 이후 사용자가 Vercel 대시보드에서
직접 `DATABASE_URL`을 Transaction Pooler(6543)로 바꾸고 redeploy를
완료했다는 전제로, 코드/설정을 전혀 건드리지 않고 **검증만** 다시
수행했다. 결과는 **기대(200 정상)와 다르다**:

| 확인 항목 | 결과 |
|---|---|
| `GET /api/presales?page=1` × 5회(간격 3초) | **5/5 = HTTP 500**, 응답시간 5.17s(1회 측정) |
| `GET /api/community/recent-activity` | 여전히 HTTP 500, 응답시간 0.38s |
| `GET /api/apt/[name]?...`(다른 Prisma API, 대신푸르지오1차아파트) | HTTP 200 정상(이전과 동일하게 계속 정상) |
| `/presales` UI(브라우저) | "⚠️ 분양정보를 불러오지 못했습니다." 그대로 표시 |
| 콘솔 신규 오류 | 기존 `[next-auth][error][CLIENT_FETCH_ERROR]` 외 신규 client 오류 없음(범위 밖, 미수정) |

**실제 예외 확인 실패**: 이번에도 `ErrorLog` 테이블을 읽기 전용으로
조회해 실제 원인(여전히 `EMAXCONNSESSION`인지, 아니면 `prepared
statement` 계열의 새 오류인지)을 확인하려 했으나, **로컬 진단
스크립트 자체가 3회(약 30~40초에 걸쳐 재시도) 모두 동일하게**

```text
FATAL: (EMAXCONNSESSION) max clients reached in session mode
max clients are limited to pool_size: 15
```

**로 거부되어 조회하지 못했다.** 이 스크립트는 로컬 `.env`의
`DATABASE_URL`(변경 대상이 아니었던 Session Pooler, 5432)을 그대로
쓴다 — 즉 **Session Pooler 쪽 pool이 지금도 계속 가득 차 있다는 뜻**이다.

이것이 의미할 수 있는 것(확정 불가, 가설 두 가지만 기록):

1. Vercel Production의 `DATABASE_URL`이 실제로는 아직 Session
   Pooler를 가리키고 있을 가능성(값 저장이 잘못됐거나, redeploy가
   새 환경변수를 반영하지 못했거나, 변경이 다른 환경(Preview 등)에만
   적용됐을 가능성)
2. Vercel은 이미 Transaction Pooler로 전환됐지만, 이전에 Session
   Pooler에 물려 있던 커넥션들이 아직 정리되지 않았고 그 사이에 다른
   무언가가 계속 Session Pooler를 점유하고 있을 가능성

**어느 쪽인지 이번 STEP에서 확정하지 못했다** — 확정하려면 Vercel
환경변수 화면에서 실제 저장된 값을 직접 확인하거나(이 세션은 여전히
Vercel 접근 권한이 없음), Supabase 대시보드에서 현재 활성 connection의
출처를 봐야 한다. 둘 다 이 세션에서 할 수 없다.

**수정 시도하지 않음**: 티켓 지시대로 문제를 발견한 상태에서 스스로
고치려 하지 않았다(env 재변경/schema 변경/코드 변경 전부 없음).

## 배경

[STEP 54](./54-presales-production-500.md)에서 production `/api/presales`
500의 root cause를 확정했다: Supabase Session Pooler(`pool_size: 15`)
동시 세션 한도 초과. 이번 STEP은 그 해결책(connection 방식 전환)을
실행하는 것이 목표였으나, **실제 변경에 필요한 Vercel 접근 권한이 이
세션에 없어 설계까지만 완료하고 STOP한다.**

## STEP 54 root cause (재확인)

```text
PrismaClientUnknownRequestError
FATAL: (EMAXCONNSESSION)
max clients reached in session mode
max clients are limited to pool_size: 15
```

이번 STEP 착수 시점에 baseline을 다시 측정한 결과, **이 문제가 presales
하나만의 문제가 아님**을 추가로 확인했다(아래 "변경 전 baseline" 참고) —
동일 시각에 `/api/community/recent-activity`(별도 Prisma 쿼리, presales와
무관한 코드)도 500을 반환했다. 두 API 모두 같은 패턴(`{"success":false,"error":"..."}`
+ 500)이며, 이는 presales route의 코드 문제가 아니라 **DB connection
pool 자체가 시스템 전역적으로 압박받고 있다**는 STEP 54 결론을 다시
뒷받침한다.

## 기존 connection 방식

값은 출력하지 않고 구조만 기록(STEP 20/54와 동일, 변경 없음):

```text
Host type: Supabase Pooler (Supavisor)
Port: 5432 (Session Pooler)
pgbouncer parameter: 없음
connection_limit parameter: 없음
DIRECT_URL: 없음
```

## 변경 connection 방식 (목표, 미적용)

```text
Host type: Supabase Pooler (Supavisor) — 기존과 동일 호스트
Port: 6543 (Transaction Pooler)
pgbouncer parameter: pgbouncer=true (추가 필요)
connection_limit parameter: connection_limit=1 (추가 필요)
```

Supabase Supavisor는 Session/Transaction Pooler가 **동일 호스트, 포트만
다름**(5432 vs 6543)이라는 것이 공식 문서 기준 표준 구조다(STEP 20에서
이미 조사·기록됨). 즉 실제로 필요한 변경은 기존 `DATABASE_URL`에서
**포트 번호 하나와 쿼리 파라미터 두 개**뿐이며, host/user/password/db
이름 등 나머지는 전부 기존 값을 그대로 쓴다 — 새로운 값을 조회하거나
추측할 필요가 없다. (다만 최종 값은 이 세션에서 직접 만들거나
적용하지 않았다 — 아래 BLOCKER 참고.)

## Transaction Pooler

STEP 20/54의 조사 결과를 그대로 적용: Supabase가 서버리스/엣지 함수에
공식적으로 권장하는 연결 방식. 다수의 짧은 연결을 다수 클라이언트가
공유하도록 설계되어 있어, Vercel처럼 함수 인스턴스가 동시에 여러 개
뜨는 환경에 적합하다(Session Pooler는 "persistent backend" 용도로
명시되어 있고 서버리스 대상이 아님).

## port

**5432 → 6543.**

## pgbouncer

**추가 필요.** Transaction 모드는 prepared statement를 지원하지 않아
`pgbouncer=true`가 Prisma 쪽에서 이를 인지하고 대응하게 하는 필수
파라미터다(STEP 20에서 이미 확인).

## connection_limit

**`connection_limit=1`로 시작.** 티켓 6번 원칙과 동일 — Vercel
서버리스는 함수 인스턴스마다 별도 PrismaClient가 생기므로, 인스턴스당
connection을 최소로 제한해 전체 DB connection 수의 급격한 증가를
막는다. 성능 문제가 실측되기 전까지 임의로 올리지 않는다.

## DIRECT_URL 판단

**불필요, 추가하지 않는다.** 코드 조사 결과:

- `package.json`의 `postinstall`은 `prisma generate`뿐이다(schema
  읽기만 하는 명령 — DB 연결이 필요 없다).
- `build`/`start` 스크립트 어디에도 `prisma migrate deploy`(또는 다른
  migration/introspection 명령)가 없다.
- `vercel.json`도 없어 별도 build/deploy 훅에 migration이 숨어 있지도
  않다.
- 즉 이 프로젝트는 **migration을 Vercel이 아니라 로컬에서 수동
  실행하는 구조**다 — production 런타임에 Direct connection이 필요한
  경우(migration/CLI)가 애초에 Vercel 배포 과정에 없다.

티켓 7번 원칙("runtime 500 해결만을 위해 directUrl이 반드시 필요한
것은 아니다")대로, `DATABASE_URL`을 Transaction Pooler로 바꾸는 것만으로
목표를 달성할 수 있어 `prisma/schema.prisma`는 건드리지 않는 방향을
확정했다.

## 코드 변경 여부

**없음(계획도 실행도).** 조사 결과 다음 파일 전부 무수정으로 충분함을
확인했다:

- `prisma/schema.prisma` — `directUrl` 불필요(위 판단 근거).
- `src/lib/prisma.ts` — 표준 singleton 패턴이 이미 적용되어 있고,
  STEP 20에서 이미 "이 코드 자체는 불필요 수정 대상이 아니다"로
  결론남. 이번 조사에서도 다른 문제(예: `new PrismaClient()` 중복
  생성 등)를 발견하지 못했다.
- `src/app/api/presales/route.ts` — 쿼리 로직 자체는 정상(스키마 일치,
  로컬 정상 동작).

## schema 변경 여부

없음(위와 동일한 이유).

## migration 여부

없음. 실행하지 않았고 필요하지도 않다.

## Vercel env 변경

**미실행.** 아래 BLOCKER 참고.

## Supabase 설정 변경 여부

없음(이번 STEP 원칙대로 pool_size 등 Supabase 측 설정은 손대지
않는다 — 애초에 대상이 아니었다).

## production redeploy

미실행(환경변수 변경 자체가 없었으므로 redeploy 대상이 없음).

## presales API 검증 / 다른 Prisma API 검증 / prepared statement 검증 / ErrorLog 검증 / 성능 확인

**해당 없음 — 변경을 적용하지 못했으므로 "전환 후" 검증 자체를
수행할 수 없었다.** 대신 "변경 전" baseline만 기록했다(아래).

## 변경 전 baseline (2026-08-18, 이번 STEP 착수 시점)

| API | 상태 |
|---|---|
| `GET /api/presales?page=1` | 500 (`{"success":false,"error":"분양정보를 불러오지 못했습니다."}`) |
| `GET /api/apt/[name]?type=apt&period=12&...`(대신푸르지오1차아파트, Prisma 사용) | 200 정상 |
| `GET /api/community/recent-activity`(Prisma 사용, presales와 무관한 코드) | **500** (`{"success":false,"error":"최신 글 정보를 불러오지 못했습니다."}`) |

presales와 community/recent-activity가 **동시에** 500인 것은, 이 문제가
presales route 고유의 결함이 아니라 DB connection pool 전역 압박이
실시간으로 진행 중임을 보여주는 추가 증거다. 이는 STEP 54의 결론을
강화하며, 이번 수정의 시급성도 함께 뒷받침한다.

## BLOCKER

**BLOCKER 2 — DATABASE_URL 변경 권한/접근 불가.**

이 세션(코딩 환경)에는 다음이 전혀 없음을 직접 확인했다:

- Vercel CLI 미설치(`command -v vercel` 실패)
- 이 프로젝트에 연결된 `.vercel` 디렉터리 없음(`vercel link`된 적
  없음)
- `VERCEL_TOKEN` 등 인증 토큰 환경변수 없음
- Supabase 대시보드/Management API 접근 권한 없음(`.env`의
  `SUPABASE_KEY`는 REST/Auth용 anon·service key로, 프로젝트의 pooler
  연결 문자열 자체를 조회하는 대시보드/Management API 권한과는
  별개다)

즉 이 세션에서 직접 Vercel production의 `DATABASE_URL` 값을 읽거나
쓸 방법이 없다. 값을 임의로 지어내 적용하는 것은 티켓 4번 원칙
("실제 프로젝트 값을 추측해서 만들지 않는다")에 정면으로 위배되므로
시도하지 않았다.

**보안 원칙상 이 문제를 우회하지 않는다**: 설령 사용자가 Vercel
API 토큰을 채팅으로 전달하더라도, 이 세션은 그런 인증 토큰/자격증명을
입력받아 대신 사용하는 것이 금지되어 있다 — 이는 Vercel 자체 UI에서
직접 값을 넣는 것과 다르지 않은 행위이기 때문이다.

## 남은 위험

- **근본 원인(STEP 54)이 그대로 남아 있다.** 이번 STEP 착수 시점에도
  이미 presales·community 두 API가 동시에 500이었다 — 지금 이 순간도
  재발 가능성이 아니라 **재발 중일 수 있다.**
- 사용자가 Vercel 대시보드에서 직접 아래 값을 적용하면 즉시 해결
  가능하다(코드 변경 불필요):
  1. Vercel 프로젝트 → Settings → Environment Variables → `DATABASE_URL`
     (Production 환경) 값에서 포트를 `5432` → `6543`으로 바꾸고,
     쿼리 파라미터에 `pgbouncer=true`와 `connection_limit=1`을
     추가(기존 파라미터가 있다면 유지한 채 병합, `?`/`&` 구분자만
     주의).
  2. 저장 후 재배포(Vercel이 자동으로 새 배포를 트리거하지 않는
     설정이면 Redeploy 버튼 클릭).
  3. 배포 후 `/api/presales?page=1` 및 `/api/community/recent-activity`가
     200으로 돌아오는지, "prepared statement" 관련 새 오류가 없는지
     확인.
- 또는 사용자가 이 세션에 Vercel CLI 로그인/프로젝트 연결
  (`vercel link`)을 직접 해 주면, 이후 세션에서 코드 변경 없이 같은
  절차를 대신 진행할 수 있다.

## 재검증 후 남은 위험 / 다음 확인 필요 사항 (1차 시도 — 이제는 해결됨)

**아래는 1차 Transaction Pooler 전환(placeholder 미교체 상태) 직후의
기록이다 — 그 원인은 위 "최종 결과"에서 확정됐고(비밀번호 placeholder
미교체), 2차 시도(비밀번호 교체) 재검증으로 해결이 확인됐다. 이 절은
당시 판단 과정의 기록으로 남겨둔다.**

위 "적용 후 검증 결과(1차)"대로, 당시엔 사용자의 조치 이후에도 문제가
해결되지 않았다. 코드/스키마 관점에서는 이미 확인이 끝났으므로(양쪽
다 무변경으로 충분), 다음 확인은 전부 Vercel/Supabase 대시보드에서만
가능했다(이 세션은 접근 불가):

1. Vercel 프로젝트 → Settings → Environment Variables에서
   `DATABASE_URL`(Production 환경)에 실제로 저장된 값이 포트
   `6543`/`pgbouncer=true`/`connection_limit=1`을 포함하는지 확인.
2. 최근 Deployments 목록에서 redeploy가 실제로 새 환경변수를 반영한
   빌드인지 확인.
3. Supabase 대시보드 → Database → Connection Pooling에서 연결 출처
   확인.
4. Vercel Function Logs에서 실제 예외 확인.

**실제 원인**은 이 중 어느 것도 아니었고, connection string 자체에
Supabase가 기본 제공하는 `[YOUR-PASSWORD]` placeholder가 실제
비밀번호로 교체되지 않아 인증 단계에서 계속 실패(재시도 로직 없이
매 요청 timeout에 가깝게 느리게 실패)하고 있었던 것으로 판단된다 —
사용자가 이를 교체한 뒤 위 "최종 결과"의 전 항목이 정상으로
돌아왔다.

## 최종 정리

```text
기존 구조 문제:
Session Pooler(5432) → EMAXCONNSESSION(세션 15개 한도 초과) — STEP 54 확정

1차 Transaction Pooler 적용 실패:
포트는 6543으로 바뀌었으나 connection string의
[YOUR-PASSWORD] placeholder가 실제 비밀번호로 교체되지 않음

최종(해결):
Transaction Pooler(6543) + pgbouncer=true + connection_limit=1
+ 실제 DB 비밀번호
→ production /api/presales, /api/community/recent-activity 등
  Prisma 기반 API 전부 정상, 신규 EMAXCONNSESSION/prepared statement/
  password 인증 오류 없음(ErrorLog 확인)
```

코드/schema/migration/production 데이터는 이 STEP 전 과정에서 한 번도
변경하지 않았다. 변경된 것은 Vercel Production 환경변수
`DATABASE_URL` 값 하나뿐이다(이 세션이 아니라 사용자가 직접 적용).
