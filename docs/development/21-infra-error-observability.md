# STEP 21 — INFRA I2-A: Production DB 오류 관측성(logging) 최소 보강

상태: 구현 완료 / 최종 승인 (2026-08-14)

## 최종 승인 기록 (2026-08-14)

사용자 검수 결과, 최종 판단 A(관측성 보강 완료, 기존 기능 무손상)가 그대로
승인되어 commit/push되었다. 이 승인은 아래를 재확인한 상태에서 이루어졌다:

- 이번 STEP은 **오류를 해결한 것이 아니라 관측성을 보강한 것**이다 —
  실제 과거 production 장애(사용자가 실기기에서 목격한 1회 오류)의 원인은
  여전히 미확정이다.
- INFRA I2-B(Vercel region 조정, Transaction Pooler 전환, `directUrl`
  도입, `connection_limit` 조정 등 구조 변경)는 이번 승인에 포함되지
  않으며 아직 착수하지 않는다.
- 향후 동일 오류가 재발하면, 이번에 추가한 logging(admin 대시보드
  ErrorLog 20건 조회 + Prisma 오류 코드 분류)을 먼저 확인하고, 그 결과를
  근거로 INFRA I2-B 필요 여부를 판단한다.

## 배경

[INFRA I1](./20-infra-db-connection-analysis.md)에서 B3(a2272d0) 모바일
검수 중 production `/presales`에서 1회 관측된 "분양정보를 불러오지
못했습니다." 오류를 조사했다. 결론(최종 승인 B): 구조적 위험(Session
Pooler, cross-region 등)은 확인되었으나, 로그가 없어 실제 오류 원인은
확정할 수 없었다.

## 왜 구조 변경보다 logging을 먼저 했는가

INFRA I1에서 발견된 구조적 편차(Session Pooler, `directUrl` 미분리,
cross-region)를 지금 바로 고치면, 그 변경이 실제로 도움이 됐는지 판단할
근거가 여전히 없다 — 다음에 오류가 또 나도 "고쳤는데 왜 또 나지"인지
"고친 게 원인이 아니었다"인지 구분할 수 없다. 반대로 지금은 로그 자체가
없어 재현되지 않는 오류의 원인을 사후에 알아낼 방법이 없다. 따라서
가장 위험이 낮고 되돌리기 쉬운 조치(관측성 확보)를 먼저 하고, 실제
데이터가 쌓인 뒤에 구조 변경 여부를 판단하는 것이 합리적이다. DB 연결
구조(`DATABASE_URL`/`DIRECT_URL`/Supabase Pooler/Vercel region)는 이번
STEP에서 전혀 변경하지 않았다.

## 기존 logging 구조 조사 결과

프로젝트 전체를 검색한 결과:

- `src/lib/log-server-error.ts`에 `logServerError(message, url?, stack?)`
  헬퍼가 이미 존재. `prisma.errorLog.create()`로 DB에 저장하며, 저장
  자체가 실패해도 내부 `try/catch`가 잡아 `console.warn`만 하고 예외를
  밖으로 던지지 않는다 — 즉 이 헬퍼는 이미 "로깅 실패가 원래 요청을
  방해하지 않는" 안전한 구조였다.
- `ErrorLog` Prisma model(`error_logs` 테이블)이 이미 존재
  (`source`/`message`/`stack`/`url`/`createdAt`, `message`는 저장 시 2000자,
  `stack`은 5000자로 잘림)
- 기존에 이미 이 헬퍼를 쓰고 있던 곳: `src/services/cheongyakService.ts`
  (presale sync 배치), `src/app/api/ai-search/route.ts`,
  `src/app/api/apt/[name]/route.ts` — 전부 동일한 호출 관례를 따른다:

  ```ts
  console.error('...', error);
  logServerError((error as Error)?.message || '기본 메시지', '/api/경로', (error as Error)?.stack).catch(() => {});
  ```

  `await` 없이 fire-and-forget으로 호출하고 `.catch(() => {})`로 호출부
  Promise도 한 번 더 방어한다 — 응답 반환을 로깅 완료까지 기다리게 하지
  않는다.
- `src/app/api/admin/dashboard/route.ts`가 `errorLog.findMany({ take: 20 })`로
  최근 20건을 admin 대시보드에 노출 — 이미 소비처가 있는 살아있는 시스템.
- `src/app/api/log/error/route.ts`(POST)는 클라이언트 ErrorBoundary용 별도
  수집 엔드포인트로, 이번 STEP과 무관(서버 API route catch와는 다른
  경로).

**결론**: 새 logging 프레임워크가 필요하지 않았다. 기존 `logServerError` +
`ErrorLog`를 그대로 재사용했고, presales 4개 API에 기존 3곳과 동일한
호출 패턴을 적용했다.

## 이번에 실제로 정의한 최소 정보

다음에 같은 오류가 나면 최소한 아래를 구분할 수 있어야 한다는 요구사항에
따라, `src/lib/log-server-error.ts`에 두 개의 작은 함수를 추가했다
(`logServerError` 자체의 signature/동작은 변경하지 않음):

```ts
function classifyError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `PrismaClientKnownRequestError:${error.code}`;      // 예: P2024(timeout), P2002 등 — query 오류
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return `PrismaClientInitializationError${error.errorCode ? `:${error.errorCode}` : ''}`; // 예: P1001/P1002 — connection 오류
  }
  if (error instanceof Prisma.PrismaClientRustPanicError) return 'PrismaClientRustPanicError';
  if (error instanceof Prisma.PrismaClientUnknownRequestError) return 'PrismaClientUnknownRequestError';
  if (error instanceof Error) return error.name || 'Error';
  return 'UnknownError';
}

export function buildErrorLogMessage(method: string, error: unknown): string {
  const kind = classifyError(error);
  const rawMessage = error instanceof Error ? error.message : String(error);
  return redactConnectionStrings(`[${method}][${kind}] ${rawMessage}`);
}
```

- `PrismaClientKnownRequestError`(query 오류, `.code` 존재 — 예: `P2024`
  timeout)와 `PrismaClientInitializationError`(connection 오류, `.errorCode`
  존재 가능 — 예: `P1001` 서버 도달 불가)를 구분한다. 이 둘의 구분이
  INFRA I1에서 제기된 "connection 문제였는지 query/timeout 문제였는지"
  질문에 직접 답한다.
- Prisma가 아닌 일반 런타임 오류는 JS `Error.name`만 기록한다(과도한
  분류 프레임워크를 만들지 않음 — 요청 범위 그대로).
- 특정 Prisma code가 실제로 발생한다고 가정하지 않았다 — `instanceof`
  검사만으로 우연히 있으면 잡고 없으면 일반 `Error` 경로로 빠지도록
  했다.

## 기록하지 않는 정보 (민감정보)

- `DATABASE_URL`, DB 비밀번호, Supabase secret, API key, Authorization
  header, Cookie, 사용자 개인정보, request body 전체는 애초에 어디에도
  참조하지 않는다 — logging 코드가 이런 값에 접근하는 지점 자체가 없다.
- 방어적으로, Prisma init 오류 메시지에 connection string이 우연히
  포함되는 경우(Prisma가 종종 `Can't reach database server at
  postgresql://...` 형태로 메시지를 낼 수 있음)를 대비해
  `redactConnectionStrings()`로 `postgres(ql)://...` 패턴을
  `[redacted-connection-string]`로 치환한 뒤에만 저장한다. synthetic
  테스트로 실제 마스킹 동작을 확인했다(아래 테스트 결과 참고).
- 기존 `logServerError`가 이미 `message`(2000자)/`stack`(5000자) 길이를
  제한한다 — 이번 STEP에서 그대로 재사용, 별도 길이 제한 로직을 새로
  만들지 않았다.

## logging 실패 방어

기존 `logServerError` 내부 `try/catch`가 이미 DB 저장 실패를 흡수한다.
이번 STEP에서 추가한 4개 API 호출부도 기존 3곳과 동일하게
`.catch(() => {})`를 덧붙여 이중으로 방어했고, `await` 없이 호출해
API 응답이 로깅 완료를 기다리지 않도록 했다(원래 오류 응답이 로깅
때문에 지연되거나 실패하지 않음). 새로운 방어 로직을 설계하지 않고
기존 구조를 그대로 재사용했다.

## 적용 endpoint

| endpoint | 적용 여부 | 비고 |
|---|---|---|
| `GET /api/presales` | 적용 | 이번 STEP의 핵심 대상(실제 오류 관측 지점) |
| `GET /api/presales/[id]` | 적용 | 동일한 단일 try/catch 구조, 몇 줄 수준으로 안전하게 적용 가능(기준 A) |
| `GET /api/presales/[id]/nearby-apartments` | 적용 | Prisma 쿼리(`findUnique`+반경검색)만 있고 외부 API 호출 없음 — 동일 패턴 적용 가능 |
| `GET /api/presales/[id]/nearby-market` | 적용 | catch 직전에 있는 MOLIT 외부 API 호출들은 이미 각각 `.catch(() => [])`로 개별 흡수되어 outer catch까지 올라오지 않는다 — 즉 outer catch는 이미 "DB/코드 오류 전용"이라 같은 패턴을 그대로 적용해도 외부 API 오류와 섞이지 않는다(코드 확인 후 판단) |

4개 전부 (a) 단일 try/catch 구조, (b) catch 안에서 이미 `console.error`만
하던 동일한 모양, (c) 몇 줄 추가로 끝나는 안전한 패턴이라 기준 A(안전한
동일 패턴 적용 가능)에 해당한다고 판단해 4개 전부 적용했다. 범위를
`/api/presales` 하나로 좁혀야 할 만큼(기준 B) 구조가 다른 API는 없었다.

## 기록하는 error 정보 요약

- Prisma error code: 존재하면 기록(`PrismaClientKnownRequestError:P2024`
  형태), 없으면 미기록
- endpoint/source: 기존 `url` 인자로 기록(`/api/presales` 등)
- HTTP method: `buildErrorLogMessage`의 `method` 인자로 메시지 안에 포함
  (`GET /api/presales`) — 이 4개 route가 전부 GET 전용이라 문자열
  상수로 넘김(`request.method`를 다시 파싱하지 않음)
- error name/message: Prisma가 아니면 `Error.name` + `message`
- 민감정보: 기록하지 않음(위 항목 참고)

## client 응답 계약 변경 여부

변경 없음. 4개 API 전부 기존과 동일하게 `{ success: false, error:
'...' }` + HTTP 500을 그대로 반환한다. 새 에러 화면, retry UI, toast,
에러코드 노출, 로딩 UI 변경, B3 UI 변경 전혀 없음.

## 테스트 결과

### 정상 경로 (로컬 dev 서버, `npm run dev`)

| endpoint | status | body |
|---|---|---|
| `GET /api/presales` | 200 | `success:true`, 기존과 동일 구조 |
| `GET /api/presales/479` | 200 | `success:true`, 기존과 동일 구조 |
| `GET /api/presales/479/nearby-apartments` | 200 | `success:true`, 기존과 동일 구조 |
| `GET /api/presales/479/nearby-market` | 200 | `success:true`, 기존과 동일 구조 |

### 오류 경로 검증 방법

이 프로젝트에는 기존 unit test/mocking 구조가 없다(package.json에 테스트
프레임워크 미설치, 요청 범위상 새로 설치하지 않음). 다음 순서로 안전하게
검증했다:

1. **synthetic Error 객체 검증** — `Prisma.PrismaClientKnownRequestError`
   (code `P2024`), `Prisma.PrismaClientInitializationError`(errorCode
   `P1001`, connection string이 포함된 메시지), 일반 `TypeError`, 그리고
   `Error`가 아닌 raw string throw까지 4가지 케이스를 만들어
   `buildErrorLogMessage()`(실제 프로젝트 코드와 동일한 로직)에 통과시켜
   결과 문자열을 확인했다. 이 스크립트는 프로젝트 루트에 임시로 만들어
   실행 직후 삭제했다(레포에 흔적 없음, DB 접근 없음).

   ```
   1) [GET /api/presales][PrismaClientKnownRequestError:P2024] Operation timed out
   2) [GET /api/presales/[id]][PrismaClientInitializationError:P1001] Can't reach database server at `[redacted-connection-string]
   3) [GET /api/presales/[id]/nearby-apartments][TypeError] Cannot read properties of undefined
   4) [GET /api/presales/[id]/nearby-market][UnknownError] raw string throw
   ```

   결과: Prisma code 추출 정상(P2024, P1001), connection string 마스킹
   정상(2번 케이스에서 `postgresql://user:secretpass@...`가
   `[redacted-connection-string]`로 치환됨), 비-Prisma 오류/비-Error 값도
   깨지지 않고 안전하게 처리됨을 확인했다.

2. **코드 정적 검토** — 4개 API의 catch 블록에 `logServerError(...)
   .catch(() => {})`가 `return NextResponse.json(...)`보다 먼저(하지만
   `await` 없이) 호출되어, 로깅이 응답을 막지 않는 구조임을 코드로 확인.

3. **실제 DB 연결 장애 재현**: 하지 않았다. Production/로컬 환경변수를
   바꾸거나 DB를 실제로 끊는 것은 이번 STEP에서 명시적으로 금지되어
   있다. **따라서 "실제 Prisma connection 오류가 발생했을 때 ErrorLog에
   정확히 기록되는지"는 이번 STEP에서 live로 검증하지 못했다** — synthetic
   객체 기반 검증과 코드 정적 검토로만 확인했다. 이는 한계로 명시한다.

### ErrorLog DB 영향

`prisma.errorLog.count()`로 확인한 `error_logs` 테이블 row 수: **0건**
(이번 STEP 작업 전후 동일). 정상 경로 테스트만 수행했으므로 애초에 catch
블록에 진입하지 않았고, synthetic 테스트도 DB를 전혀 호출하지 않는 순수
함수 검증이라 ErrorLog row가 생성되지 않았다.

## 회귀 검증

- `npx prisma validate` — 통과 (스키마 변경 없음, 이번 STEP에서
  `schema.prisma`를 건드리지 않았으므로 당연한 결과)
- `npx prisma migrate status` — "Database schema is up to date!"
- `npx tsc --noEmit` — 오류 0
- `npx eslint` (변경 파일 한정) — 오류/경고 0
- `npm run build` — 성공. `/api/presales`, `/api/presales/[id]`,
  `/api/presales/[id]/nearby-apartments`, `/api/presales/[id]/nearby-market`
  전부 기존과 동일하게 라우트 목록에 나타남(회귀 없음)

## Production 재확인

코드 변경은 로컬에만 존재하며 commit/push하지 않았으므로 production은
여전히 a2272d0 상태다. `GET /api/presales` 3회 요청 — 전부 HTTP 200,
0.79s~3.95s(현재 오류 재발 없음을 재확인하는 목적, 부하 테스트 아님).

## 한계

- 실제 DB 장애 상황에서의 logging 동작은 live로 검증하지 못했다(synthetic
  검증 + 코드 정적 검토로만 확인).
- Prisma 오류 메시지에 connection string이 포함되지 않는 경우가
  일반적이지만(Prisma가 기본적으로 credential을 메시지에 노출하지
  않음), 이번 STEP의 redaction은 그런 경우에도 대비하는 방어적 조치이지
  "Prisma가 실제로 그렇게 한다"고 확인된 것은 아니다.
- 여전히 구조화된 로깅(structured logging, request-scoped context 등)은
  아니다 — 메시지 문자열 하나에 필요한 정보를 압축해 넣은 최소 수준.
  Vercel Function Logs / Supabase Logs와 함께 봐야 완전한 그림이 된다
  (INFRA I1 문서의 "재발 시 원인 확보 방법" 참고).

## DB 영향

- `error_logs` 테이블 row 수 변화 없음(0건 유지)
- schema 변경 없음, migration 없음
- 기존 ErrorLog row 삭제/수정 없음

## 후속 계획 (승인 필요, 이번 STEP에서 진행하지 않음)

INFRA I1 문서의 "후속 INFRA I2 제안" 순서를 그대로 따른다 — 이번 I2-A는
그 중 1번(logging 연결)만 수행했다. 남은 항목(I2-B 이후, region 조정 /
`DIRECT_URL` + Transaction Pooler 전환 / `connection_limit` 조정)은
이번 관측성 보강으로 실제 오류 데이터가 쌓인 뒤, 별도 승인을 받아
진행한다.
