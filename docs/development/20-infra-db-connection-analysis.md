# STEP 20 — INFRA I1: Vercel + Supabase + Prisma Production DB 연결 안정성 조사

상태: 조사 완료 / 최종 승인 (2026-08-14)

## 최종 승인 기록 (2026-08-14)

사용자 검수 결과, 아래 최종 판단(B)이 그대로 최종 승인되었다.

> B — 구조적 위험은 확인되었으나, 로그 없이 실제 오류 원인을 확정할 수
> 없어 안전한 최소 개선 + 관찰이 적절함.

승인에 따라 지금 DB 연결 구조(Session Pooler/DIRECT_URL/Vercel region 등)는
변경하지 않으며, 관측성 보강을 먼저 진행한다 — 후속 STEP은
[docs/development/21-infra-error-observability.md](./21-infra-error-observability.md)(INFRA
I2-A) 참고.

이 승인은 아래 "확정 사실"과 "미확정" 구분을 그대로 유지한 채 이루어졌다 —
조사 당시 가설이었던 항목을 사후에 "확정 원인"으로 격상하지 않는다.

**확정 사실**:
- DATABASE_URL이 Supabase Session Pooler(포트 5432)를 사용
- Vercel function region은 iad1로 관측(19/19 요청 고정)
- Supabase DB region은 ap-northeast-2(서울) — cross-region 구조 존재
- 이번 조사 시점 production 반복 측정(19회)에서 오류 재현 실패
- B3(a2272d0)는 `/presales` 목록 API를 직접 건드리지 않음

**미확정 (여전히 미확정)**:
- 사용자가 실기기에서 목격한 실제 1회 오류가 connection exhaustion 때문
  이었는지
- Session Pooler 사용이 그 오류의 직접 원인이었는지
- DB timeout이 관련되어 있었는지

## 목적

B3(commit a2272d0) 모바일 실기기 검수 중 production `/presales`에서
"⚠️ 분양정보를 불러오지 못했습니다." 오류가 1회 관측되었다. 이후 재현되지
않았고 production API는 정상 200을 반환한다. 이번 STEP은 **조사 전용**이며
코드/설정/schema/env/DB를 일절 변경하지 않는다. 목표는 "무엇을 고칠지"가
아니라 "다음 수정이 정말 필요한지, 필요하다면 무엇을 최소로 바꿔야 하는지"를
판단하는 것이다.

## 현재 상태 (조사 시점 2026-08-14)

- HEAD = `a2272d0`, working tree clean, local `main` == `origin/main` (0/0)
- production `/api/presales`, `/api/presales/479`,
  `/api/presales/479/nearby-apartments`, `/api/presales/479/nearby-market` —
  전부 정상 200
- 동일 오류 재현 실패

## 실제 관측 증상

사용자가 모바일 실기기에서 1회 목격. 이후 조사(이전 세션 + 이번 세션)에서는
production/localhost 모두 정상. 로그가 남아있지 않아 정확한 예외 원인은
확정할 수 없다.

## 현재 Architecture

### 기술 스택 (package.json / node --version 실측)

| 항목 | 값 |
|---|---|
| Next.js | 16.3.0 (App Router) |
| React / React DOM | 19.2.8 |
| Prisma | ^5.22.0 |
| @prisma/client | ^5.22.0 |
| Node.js (로컬 실측) | v22.13.1 |
| Node.js 버전 고정 (`engines`) | package.json에 없음 — Vercel 실제 실행 버전은 코드만으로 확정 불가, dashboard 확인 필요 |
| vercel.json | 없음 (git 이력에도 커밋된 적 없음) |
| next.config.ts | `typescript.ignoreBuildErrors: true`, `allowedDevOrigins`만 존재. region/runtime 관련 설정 없음 |

### Prisma datasource (prisma/schema.prisma)

```
generator client {
  provider = "prisma-client-js"
}
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

- `directUrl` 없음
- `relationMode` 등 추가 설정 없음
- DATABASE_URL 단일 변수로 런타임과(과거 마이그레이션까지) 전부 처리

### Prisma singleton (src/lib/prisma.ts)

```ts
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

표준 Prisma 권장 패턴(개발 hot-reload 다중 인스턴스 방지)은 정확히 구현되어
있다. 다만 이 패턴은 **개발 환경의 단일 Node 프로세스** 문제를 해결하는
것이지, production Vercel 서버리스의 "함수 인스턴스마다 별도 프로세스 →
`globalThis`가 인스턴스마다 별개 → 인스턴스마다 독립된 PrismaClient/connection
pool이 생긴다"는 특성 자체를 바꾸지 못한다. 이는 **singleton 코드가 잘못된
것이 아니라, 서버리스 환경의 구조적 특성**이다 (Prisma 공식 문서도 동일하게
설명).

## 환경변수 구조 (host/port/파라미터만, 비밀값 제외)

`.env`에 존재:

| 변수 | 존재 | 비고 |
|---|---|---|
| `DATABASE_URL` | 있음 | 아래 상세 |
| `DIRECT_URL` | **없음** | migration용 non-pooled URL 분리 안 됨 |
| `POSTGRES_URL` / `POSTGRES_PRISMA_URL` / `SUPABASE_DB_URL` | 없음 | |
| `SUPABASE_URL` | 있음 | REST API용 (`https://ztlnagzmwksgjkappfyh.supabase.co`) |
| `SUPABASE_KEY` | 있음 | 값 미출력 |

`DATABASE_URL` 파싱 결과:

- hostname: `aws-0-ap-northeast-2.pooler.supabase.com`
- port: `5432`
- database: `postgres`
- query parameter: **없음** (`pgbouncer=true`, `connection_limit`, `pool_timeout` 전부 미설정)

**분류**: hostname이 `*.pooler.supabase.com` (Supavisor) 이면서 포트가
`5432` → **Session Pooler**. (Transaction Pooler였다면 포트 `6543`)

## Supabase 공식 문서 조사 결과 (supabase.com/docs/guides/database/connecting-to-postgres)

| 연결 방식 | 포트 | IPv4/IPv6 | 공식 권장 용도 |
|---|---|---|---|
| Direct connection | 5432 | IPv6 (또는 IPv4 addon) | Migrations, pg_dump, long-lived backend |
| Session pooler (Supavisor) | 5432 | IPv4 only | **Persistent backend on IPv4-only networks** |
| Transaction pooler (Supavisor) | 6543 | IPv4 only | **Serverless and edge functions** |

- Transaction pooler는 다수의 짧은 연결을 다수 클라이언트가 공유하도록
  설계되어 "많은 일시적 연결"에 적합 — 서버리스/엣지 함수(Vercel 포함) 명시
  대상.
- Session pooler는 클라이언트 1개당 direct connection을 세션 동안 독점
  배정 — "persistent backend" 대상이며 서버리스 대상으로 명시되어 있지
  않다.
- Transaction 모드는 **prepared statement 미지원** (연결 라이브러리에서
  꺼야 함). Session 모드는 이 제약이 없다.
- Migration/pg_dump는 Direct connection 권장.

**질문 응답 — "Vercel Serverless + Prisma + Supabase에서 runtime과
migration/direct 연결을 분리하는 것이 현재 공식 권장 구조인가?"**

→ **YES**. Prisma 공식 문서(prisma.io/docs)도 "`DIRECT_URL`과 함께 Supavisor
커넥션 풀링 사용을 강력히 권장"한다고 명시하며, Supabase 공식 문서도
연결 방식별 용도를 명확히 분리한다(migration=Direct, runtime=Transaction
Pooler).

## Prisma 공식 문서 조사 결과

- 현재 프로젝트: Prisma 5.22.0 (v5 세대. v6/v7의 `prisma.config.ts` 기반
  CLI 설정 방식은 해당 없음 — v5는 `schema.prisma`의 `directUrl` 필드로
  처리)
- `connection_limit`: 서버리스에서는 `connection_limit=1`로 시작해 신중히
  올릴 것을 권장(공식 문서 톤 기준) — 현재 미설정 → 함수 인스턴스마다
  Prisma 기본 pool size(코어 수 기반 계산값, 통상 num_cpus*2+1)만큼 연결을
  열 수 있음
- `pgbouncer=true`: Transaction 모드(prepared statement 미지원 모드)에서
  필요한 옵션. **현재 연결은 Session Pooler**이므로 이 옵션의 원래 목적
  (prepared statement 비활성화)과는 직접 관련이 낮다. 다만 이는 "필요
  없다"는 뜻이 아니라 "현재 pooler 종류 기준으로는 우선순위가 다르다"는
  뜻 — Transaction Pooler로 전환할 경우에는 반드시 필요해진다.
- "예전에 많이 썼다"는 이유만으로 `pgbouncer=true`를 넣어야 한다고
  판단하지 않았다 — 현재 연결이 애초에 Session Pooler라 이 파라미터의
  적용 여부보다 **pooler 종류 자체가 서버리스 권장 구조와 다르다**는 점이
  더 상위 이슈.

## Prisma singleton 평가 (6개 질문)

1. 개발 hot-reload 다중 생성 방지 — 되어 있음 (표준 패턴)
2. production 서버리스 인스턴스 간 연결 공유 — **불가능한 구조**. 인스턴스별
   `globalThis`가 별개이므로 인스턴스 수만큼 독립 PrismaClient/pool 생성
3. singleton 패턴 자체가 잘못됐는가 — 아니다. Prisma 공식 예제와 동일한
   정석 패턴.
4. singleton은 정상이나 서버리스 특성상 인스턴스별 pool이 생기는가 —
   **그렇다**. 이건 코드 결함이 아니라 서버리스 실행 모델의 근본 특성.
5. 코드 수정이 실제로 필요한가 — 이 코드 자체는 불필요. 문제가 있다면
   connection string(pooler 종류/파라미터) 쪽.
6. 환경변수/connection string 조정만으로 충분할 가능성 — **높다**. singleton
   코드 변경보다 pooler 종류·`directUrl` 분리·`connection_limit` 조정이
   우선 후보.

## Vercel Function Region 실측

production에 안전한 GET 8+6+4+1=19회 요청, 매 응답의 `X-Vercel-Id` 헤더
확인.

```
X-Vercel-Id: kix1::iad1::sdzqf-...
X-Vercel-Id: kix1::iad1::rkz7m-...
X-Vercel-Id: kix1::iad1::twvrs-...
X-Vercel-Id: kix1::iad1::kvlp4-...
X-Vercel-Id: kix1::iad1::n7fbc-...
X-Vercel-Id: kix1::iad1::jh5fm-...
(총 19회 전부 동일 패턴)
```

- `kix1`은 요청을 받은 Vercel Edge PoP, **`iad1`이 실제 함수 실행
  region** (Washington D.C., 미국 동부)
- 19회 전부 `iad1`로 고정 — 요청별 차이 없음
- Vercel 공식 문서: 신규 프로젝트 기본 함수 region은 **iad1**이며, 이번
  프로젝트는 region을 별도로 지정한 적이 없으므로(vercel.json 없음,
  `preferredRegion` export 없음) 기본값을 그대로 쓰고 있다 — 이전 조사
  관측(`iad1`)과 일치.

## DB Region

`aws-0-ap-northeast-2.pooler.supabase.com` — hostname에 리전 코드가
명시되어 있다. `ap-northeast-2` = AWS 서울 리전. (이전 관측과 일치, hostname
문자열 기준 확정 — 별도 대시보드 조회 없이도 이 부분은 확정적이다.)

**cross-region 여부: 확정 YES.** 함수 실행(iad1, 미국 동부 버지니아)과
DB(ap-northeast-2, 서울)가 물리적으로 지구 반대편 수준으로 떨어져 있다.
이는 매 요청마다 최소 왕복 1회의 태평양 횡단 네트워크 latency(통상
150~250ms급, 다중 쿼리/커넥션 핸드셰이크 시 누적)를 강제한다. 실측
`/api/presales` 첫 요청(cold) 4.2s, 이후 warm 0.75~0.9s — warm 상태에서도
편도 왕복이 여러 차례 필요한 쿼리(목록 API는 findMany+groupBy 2개 병렬
쿼리)라 순수 로컬 DB 대비 확연히 느리다.

## API별 DB 접근 패턴

### GET /api/presales (목록)

- Prisma 호출 2회, `Promise.all`로 병렬: `presale.findMany({ where })` +
  `presale.groupBy(...)`
- 외부 MOLIT 호출 없음
- 캐시 없음 (`export const dynamic = 'force-dynamic'`)
- status 필터/정렬은 DB가 아니라 JS 메모리에서 계산 — 즉 **매 요청마다
  조건에 맞는 행 전체를 읽어와야** 함 (현재 규모 1,046건 기준으로는
  문제되는 크기는 아님)
- 사용자가 `/presales` 목록에 진입하면 이 API 1개만 호출됨

### GET /api/presales/[id] (상세)

- Prisma 호출 1회: `presale.findUnique({ include: houseTypeDetails })`
- 외부 호출 없음, 캐시 없음

### GET /api/presales/[id]/nearby-apartments (B1)

- Prisma 호출 1회(`presale.findUnique`) + `findNearbyApartments()` 내부에서
  추가 DB 조회(ApartmentMaster 반경 검색) — 코드상 확인된 추가 Prisma 호출
  존재
- 외부 호출 없음

### GET /api/presales/[id]/nearby-market (B2, B3가 UI로 노출)

- Prisma 호출: `presale.findUnique` + `findNearbyApartments()` 내부 쿼리
- **외부 MOLIT API 호출 있음** — `fetchMolitData()`를 지역(sggCd) ×
  월(6→12→24개월 단계적 fallback) 조합만큼 병렬 호출, 1시간 캐시
  (`getOrSetCache`)로 재호출은 줄이지만 캐시 미스 시 다건 외부 API 호출
  발생 가능. 실측 단일 호출 4.9s(외부 API 미스 상태 추정)

**한 사용자가 상세페이지에 진입했을 때 호출 가능한 API 수**: `/presales/[id]`
진입 시 상세(1) + B1(1) + B3가 렌더하는 B2(nearby-market, 1) = 최대 3개
API가 거의 동시에 클라이언트에서 호출될 수 있다(코드상 각각 독립
`fetch`/SWR로 보임 — 정확한 동시성은 클라이언트 컴포넌트 로직에 달려있고
이번 STEP에서 클라이언트 코드 전체를 재확인하지는 않았다. 참고 수준).

## B3가 DB 부하를 증가시켰는가 (a2272d0 diff 재확인)

```
docs/development/19-presale-nearby-market-ui.md | 164 ++
docs/development/CHANGELOG.md                    |  81 +
src/app/presales/[id]/nearby-market-section.tsx  | 388 ++ (신규)
src/app/presales/[id]/page.module.css            | 258 ++ (신규 CSS)
src/app/presales/[id]/presale-detail-client.tsx  |   4 +  (import 1 + 섹션 삽입 1)
```

- **`/presales` 목록의 DB 호출 수를 증가시켰는가**: 아니다. B3는 목록
  API(`/api/presales`)를 전혀 건드리지 않았고, 목록 페이지 코드에도
  포함되지 않는다.
- **`/presales/[id]` 상세 진입 시 API 호출을 추가했는가**: 아니다 — B3
  커밋 자체는 UI(섹션 렌더링)만 추가했다. 실제 `/api/presales/[id]/nearby-market`
  API(B2)는 이전 커밋(18번 문서, B3 이전)에 이미 구현되어 있었다. B3는
  "이미 존재하던 B2 API를 상세페이지 UI에 연결"한 것 — 그 결과 **B2가
  이전에는 (UI 미연결로) 호출되지 않다가, B3 이후로는 상세페이지 진입마다
  실제로 호출되게 되었다.** 이 의미에서 "새 API를 추가"한 것은 아니지만
  "새로 트리거되게 만든" 것은 맞다.
- **nearby-market API가 DB connection을 얼마나 사용하는가**: Prisma 쿼리
  자체는 가볍다(findUnique 1 + 반경검색 1). 다만 MOLIT 외부 API 대기 시간
  동안 서버리스 함수 인스턴스가 살아있는 시간이 늘어나고(요청당 최대
  4.9s+ 관측), 그 인스턴스가 열고 있는 DB connection도 그만큼 오래
  점유된다. Session Pooler는 connection을 세션 동안 독점 배정하는 방식이라,
  **쿼리 자체보다 "connection을 오래 붙잡고 있는 시간"이 pool 압박에 더
  영향을 준다.**
- **B3 때문에 동시에 여러 serverless function이 실행될 가능성이
  증가했는가**: 그렇다. B3 이전에는 상세페이지 진입 시 상세(1)+B1(1) 2개
  함수였다면, B3 이후로는 B2(nearby-market)까지 사실상 3개 함수가 거의
  동시에 실행된다. nearby-market은 외부 API 대기로 실행 시간이 가장 길다.
- **그렇더라도 이번 `/presales` 목록 오류와 직접적인 인과관계가 있는가**:
  **없다고 판단한다.** 오류는 `/presales` **목록** 페이지에서 발생했고,
  목록 페이지는 nearby-market을 호출하지 않는다. B3는 상세페이지에서만
  작동한다.
- 다만 "무관함"과 "전체 서비스의 connection pressure를 소폭 증가시킬
  가능성"은 구분해야 한다 — B3로 인해 상세페이지 진입당 서버리스
  함수/DB connection 점유가 늘어난 것은 사실이며, 이것이 **같은 시점에
  다른 사용자가 목록을 보고 있었다면 pool 전체의 여유를 줄이는 방향으로
  아주 소폭 기여할 수는 있다** (직접 원인은 아니지만 완전히 무관하다고
  단정할 근거도 없다 — 로그가 없어 확정 불가).

## Production 반복 측정 결과

안전한 GET만 사용, 각 API 10회 이하로 제한. nearby-market은 외부 API
비용 때문에 1회만 실행.

| API | 요청 수 | 성공 | 실패 | 응답시간 범위 |
|---|---|---|---|---|
| GET /api/presales | 8 | 8 | 0 | 0.75s ~ 4.2s(첫 요청 cold) |
| GET /api/presales/479 | 6 | 6 | 0 | 0.70s ~ 1.12s |
| GET /api/presales/479/nearby-apartments | 4 | 4 | 0 | 0.88s ~ 1.51s |
| GET /api/presales/479/nearby-market | 1 | 1 | 0 | 4.93s |

전 요청 HTTP 200, body 전부 `"success":true`이며 정상 구조의 JSON. 실패
0건 — **동일 오류 재현 실패** (이전 조사와 동일한 결론).

## 오류 코드 경로

`/api/presales`의 오류는 단일 try/catch 구조:

```ts
try {
  ...
} catch (error) {
  console.error('Failed to fetch presales:', error);
  return NextResponse.json({ success: false, error: '분양정보를 불러오지 못했습니다.' }, { status: 500 });
}
```

catch 블록에 진입할 수 있는 가능한 원인(가능성 수준 — 확정 아님):

- Prisma connection error (pool 고갈, connection reset, 서버 측 timeout)
- Query timeout (cross-region latency 누적 + Supabase 측 statement/idle
  timeout)
- DB 일시적 unavailable (Supabase 측 순간 장애/유지보수)
- Session Pooler pool exhaustion (동시 다발 요청 시 세션이 반환되지 않고
  쌓이는 경우)
- Cold start와 겹친 초기화 지연이 임계치를 넘는 경우
- 코드 runtime error (가능성 낮음 — 로직 자체는 단순하고 반복 측정에서
  항상 정상 작동)

로그가 없어 위 중 어느 것이었는지는 **확정할 수 없다**. "아마 이것"을
"원인이다"로 격상시키지 않는다.

## Observability 평가

- `console.error`만 사용, 구조화된 로깅 없음
- **`src/lib/log-server-error.ts` (`logServerError`)와 `ErrorLog` 모델이
  이미 존재**하고 admin 대시보드가 이를 조회하지만, presales 4개 API
  (`route.ts`, `[id]/route.ts`, `nearby-apartments/route.ts`,
  `nearby-market/route.ts`) 어디에도 이 헬퍼가 연결되어 있지 않다. 즉 이번
  오류는 admin 대시보드의 ErrorLog에도 남지 않았다 — 재현 안 되는 문제를
  사후에 규명할 수 있는 유일한 실질적 경로가 사실상 없었다.
- client에는 항상 동일한 일반 메시지(`분양정보를 불러오지 못했습니다.`)만
  반환 — request context, error code 구분 없음
- status code는 500 고정

**재발 시 원인 확보 방법 제안 (이번 STEP에서 구현하지 않음)**:

1. Vercel Function Logs(대시보드 → Logs, 실시간/최근 보존 기간 내) 확인 —
   가장 즉각적인 방법
2. Supabase 대시보드 → Database → Logs / Reports에서 동일 시각대
   connection 관련 이벤트 확인
3. `logServerError`를 presales 4개 API의 catch 블록에 연결해 향후
   ErrorLog에 실제 예외 message/stack이 남도록 함 (이번 STEP에서는 코드
   변경 금지 원칙에 따라 미실행 — I2 후보)

## 위험도 평가

| 위험 | 평가 | 근거 |
|---|---|---|
| Connection exhaustion | MEDIUM | Session Pooler(서버리스 비권장 모드) + `connection_limit` 미설정 + `directUrl` 미분리가 겹쳐 구조적 위험은 있으나, 반복 측정 19/19 성공이라 상시 발생은 아님 |
| Cross-region latency | HIGH (확정된 사실 기준) | iad1↔ap-northeast-2 cross-region은 실측으로 확정. 매 요청 latency 하한을 구조적으로 높임. 다만 이것만으로 500 에러가 나는지는 별개(timeout 임계치에 달렸음) |
| DB timeout | UNKNOWN | 로그 없어 실제 timeout 발생 여부 확정 불가 |
| Cold start | LOW~MEDIUM | 실측 cold 4.2s 확인(첫 요청). 사용자가 본 것이 500 에러가 아니라 단순 로딩 지연이었을 가능성도 배제 못하나, 사용자는 명시적으로 에러 메시지를 봤다고 함 |
| Supabase pooler mode 부적합 | MEDIUM~HIGH | 공식 문서 기준 명백한 불일치(서버리스에 Session Pooler는 비권장) — 구조적 사실이나, 이것이 실제 1회 오류의 원인이라는 증거는 없음 |
| Prisma connection pool configuration | MEDIUM | `connection_limit` 미설정 → 인스턴스별 기본 pool size가 Session Pooler의 제한된 pool과 함께 압박을 만들 수 있음(가설) |
| External MOLIT latency | LOW (목록 오류와 무관) | nearby-market만 해당, 목록 API는 MOLIT 미호출 |
| B3 자체 코드 문제 | LOW | B3는 목록 API를 건드리지 않음. 상세페이지 connection pressure는 소폭 늘렸을 수 있으나 목록 오류의 직접 원인 가능성은 낮음 |

## 해결 후보 (최소 변경 → 큰 변경 순)

### 후보 A — 관찰만 하고 재발 시 로그 확보

- 기대 효과: 재발 시 실제 원인 확정 가능
- 위험: 없음 (변경 없음)
- 변경 파일/설정: 없음
- DB 데이터 영향: 없음
- migration 필요: 아니오
- rollback 난이도: 해당 없음

### 후보 B — Vercel function region을 Seoul(icn1)로 조정

- 기대 효과: cross-region latency 원천 제거, timeout 여유 확보
- 위험: 낮음~중간 (region 재배포, plan 제약 가능성 — dashboard 확인
  필요). Hobby 플랜도 단일 대체 region 선택은 가능하다는 Vercel changelog
  존재하나, 이 프로젝트의 실제 plan은 코드로 확정 불가
- 변경 파일/설정: `vercel.json`(`regions`) 또는 route별
  `export const preferredRegion` — App Router route handler에서 적용
  가능(Vercel 공식 문서 기준)
- DB 데이터 영향: 없음
- migration 필요: 아니오
- rollback 난이도: 낮음 (설정값 되돌리면 즉시 원복)

### 후보 C — runtime DATABASE_URL을 Transaction Pooler(6543)로 전환

- 기대 효과: 서버리스 다중 인스턴스 상황에서 connection 멀티플렉싱 →
  공식 권장 구조에 부합, pool 고갈 위험 감소
- 위험: 중간. Transaction 모드는 prepared statement 미지원 —
  `pgbouncer=true` 파라미터 필수 동반. 미적용 시 오히려 새로운 오류 유발
  가능
- 변경 파일/설정: `.env`/Vercel 환경변수 `DATABASE_URL`만
- DB 데이터 영향: 없음
- migration 필요: 아니오 (단, migration은 이 URL로 실행하면 안 됨 —
  후보 D와 반드시 함께 검토)
- rollback 난이도: 낮음 (URL 원복)

### 후보 D — runtime/migration DB URL 분리 (`DIRECT_URL` 도입)

- 기대 효과: Prisma 공식 권장 구조 완성 — migration은 Direct connection,
  런타임은 Pooler로 명확히 분리
- 위험: 중간. `schema.prisma`에 `directUrl` 필드 추가 필요(스키마 파일
  변경) + 신규 환경변수 추가
- 변경 파일/설정: `prisma/schema.prisma`, `.env`, Vercel 환경변수
- DB 데이터 영향: 없음
- migration 필요: 아니오(schema 재적용 불필요, `prisma generate`만 필요할
  수 있음)
- rollback 난이도: 낮음~중간

### 후보 E — Prisma connection parameter 조정 (`connection_limit`, `pool_timeout`)

- 기대 효과: 인스턴스당 과도한 connection 생성 억제
- 위험: 낮음. 다만 값을 너무 낮추면(`connection_limit=1`) 동시 쿼리가
  많은 API(목록의 `findMany`+`groupBy` 병렬 실행 등)에서 되려 순차
  대기가 늘어 latency 악화 가능 — 신중한 값 선택 필요
- 변경 파일/설정: `.env`의 `DATABASE_URL` query parameter
- DB 데이터 영향: 없음
- migration 필요: 아니오
- rollback 난이도: 낮음

### 후보 F — Prisma architecture 변경 (예: Prisma Accelerate, edge-compatible 드라이버 등)

- 기대 효과: 근본적인 서버리스-DB 연결 관리 위임
- 위험: 높음. 신규 유료 의존성 가능성 있음 — CLAUDE.md 원칙(9번: 새 유료
  API 임의 추가 금지)에 저촉되므로 사용자 명시적 승인 없이는 후보에서
  제외
- 변경 파일/설정: 광범위
- DB 데이터 영향: 없음(구조적으로는 크지만 데이터 자체는 무관)
- migration 필요: 아니오
- rollback 난이도: 높음

## 최종 판단

**B — 구조적 위험은 확인되었으나, 로그 없이 실제 오류 원인을 확정할 수
없어 안전한 최소 개선 + 관찰이 적절함.**

근거:
- 확정 사실: cross-region(iad1↔ap-northeast-2), Session Pooler 사용(서버리스
  비권장), `directUrl`/`connection_limit` 미설정 — 전부 공식 문서 기준
  "서버리스 권장 구조와 다르다"는 구조적 사실이다.
- 강한 정황: 이 구조가 순간적 connection pressure에 상대적으로 더 취약할
  개연성은 있다.
- 확정 불가: 실제 사용자가 본 1회 오류가 위 구조적 요인 때문이었는지,
  아니면 Supabase/Vercel 측의 일시적 장애였는지는 로그가 없어 판단할
  근거가 없다. 19/19 반복 측정에서 재현되지 않았다.
- 따라서 "구조를 지금 당장 바꿔야 한다"는 A(명확한 잘못 확정)로 격상할
  근거는 부족하고, 반대로 "전부 정상이니 관찰만 하면 된다"는 C로
  낮추기에는 공식 문서 대비 구조적 편차(Session Pooler + no directUrl +
  no connection_limit + cross-region)가 명백하다.

## 수정하지 않은 항목

- `.env` / `DATABASE_URL` / `DIRECT_URL`
- Vercel 환경변수, region 설정
- Supabase pooler 설정
- `prisma/schema.prisma`
- `src/lib/prisma.ts`
- API route 코드 (presales 4종 포함)
- `next.config.ts`
- migration (신규 생성/실행 없음)
- DB 데이터
- package 설치/업데이트

## 후속 INFRA I2 제안 (승인 필요, 이번 STEP에서 실행하지 않음)

우선순위 낮은 순 → 높은 순이 아니라, **위험 낮은 순**으로 제안:

1. `logServerError`를 presales 4개 API의 catch 블록에 연결 (관측성 확보,
   위험 최소)
2. Vercel function region을 Seoul 계열로 조정 검토 (plan 제약 dashboard
   확인 선행)
3. `DIRECT_URL` 도입 + runtime `DATABASE_URL`을 Transaction Pooler(6543,
   `pgbouncer=true`)로 전환 — 공식 권장 구조로 정합화
4. `connection_limit` 값 실측 기반으로 신중히 설정

각 항목은 별도 승인 후 별도 STEP에서 최소 단위로 진행할 것을 제안한다.

## 검수 필요 사항

- 이 문서의 최종 판단(B)에 동의하는지
- INFRA I2 진행 여부/순서
- B3 모바일 검수를 지금 재개해도 되는지 (아래 최종 보고 62번 참고)
- Vercel 프로젝트의 실제 plan(Hobby/Pro)을 dashboard에서 확인해줄 수 있는지
  (region 변경 가능성 판단에 필요)
