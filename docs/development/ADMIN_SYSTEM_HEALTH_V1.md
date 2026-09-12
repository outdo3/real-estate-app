# ADMIN SYSTEM HEALTH V1

**상태: 구현 완료 / schema·migration 0건 / 신규 monitoring 인프라 0건 / production write 0건 / STRUCTURAL PASS · ADMIN QA REQUIRED**

작성일 2026-09-13 · branch `main` · 기준 HEAD `3d35a90`

---

## 1. 목적

운영자 관찰: 서버 오류와 부분 실패가 실제로 발생하고 있는데, 관리자 화면에서
**failed 1건과 failed 45건이 똑같은 `SERVER` 한 줄로 보인다.** 원시 로그는 있지만
사람이 일일이 읽어야 하고, 데이터 불완전 가능성을 빠르게 판단할 수 없다.

이번 STEP: 관리자 화면에 **최소한의 "운영 상태 요약"** 을 제공한다.
새 수집 인프라는 만들지 않는다.

---

## 2. 시작 상태 (safe mode)

```
branch            main
HEAD              3d35a90  docs(release): freeze e867a40 as the Busan release candidate
tracked dirty     package.json, package-lock.json      (사용자 작업물 — 미변경)
untracked         .claude/settings.local.json, ApartmentAutocomplete.tsx.bak, my_prod.html,
                  prisma/schema_old.prisma, tmp/, scripts/audit-apt-trade-*.ts,
                  scripts/officetel/step3a-*.ts, docs/development/{APARTMENT_TRADE_SYNC_
                  COVERAGE_AUDIT_V1, OFFICETEL_V1_STEP3A_BACKFILL_DRYRUN,
                  PERCEIVED_PERFORMANCE_AUDIT_V1}.md   (사용자 작업물 — 미변경)
```

`git stash` / `git clean` / `git reset` / `git checkout .` 미사용.

---

## 3. 감사 — 기존 로그 아키텍처

| 확인 항목 | 결과 |
|---|---|
| 관리자 route | `/admin/dashboard`, `/admin/ops`, `/admin/behavior`, `/admin/users` (4개) |
| 관리자 API | `/api/admin/{dashboard,ops,behavior,users,users/[id]/ban,presales/sync}` |
| 에러 로그 화면 | `/admin/dashboard`의 "🚨 시스템 에러 로그 (최근 20건)" 카드 **하나뿐** |
| 그 화면의 표시 | `SERVER` / 원문 message / url · 시각 — **요약·분류 없음** |
| 데이터 source | **DB table `error_logs`** (Prisma model `ErrorLog`) |
| 저장 위치 | DB. memory/file/external 아님 |
| 컬럼 | `id`, `source`('client'\|'server'), `message`(Text), `stack`, `url`, `createdAt` |
| 인덱스 | `@@index([createdAt])` — 기간 조회가 full scan이 되지 않는다 |
| **severity 필드** | **없음** |
| **type 필드** | **없음** |
| pagination/filter | 없음 (`take: 20` 고정) |
| 기존 severity 정책 | `admin-ops-evidence.ts`의 `OverallStatusCode` = HEALTHY/WARNING/CRITICAL/UNKNOWN |

### MOLIT_PARTIAL이 기록되는 경로

`src/app/api/apt/[name]/route.ts:253` → `logServerError(...)` → `error_logs` (source='server').

```
[MOLIT_PARTIAL] source=MOLIT type=apt lawdCd=26140 dong=서대신동 period=60
months=60 ok=58 failed=2 failedMonths=202401,202402
reason=OpenAPI Error: 초당 서비스 요청제한 횟수 초과 에러
```

**스로틀 있음**: 같은 `(type, lawdCd)`는 **5분에 한 번만** 기록된다
(`PARTIAL_LOG_THROTTLE_MS`, in-memory Map). 즉 기록 횟수는 실제 발생 횟수의
**하한**이다 — 화면이 이 사실을 반드시 밝혀야 한다.

### 같은 source에 들어오는 다른 오류

| 종류 | `error_logs`에 저장되는가 | 판정 |
|---|---|---|
| MOLIT 부분 실패 | **예** — `/api/apt/[name]` 1곳 | 표시함 |
| 라우트 예외(DB/외부 API) | **예** — presales 4곳 + officetel 3곳 (`buildErrorLogMessage`) | 표시함 |
| 클라이언트 오류 | 경로는 있음(`/api/log/error`) — **현재 호출자 0곳** | 파서는 지원, 실제 유입 없음 |
| **OAuth 콜백 실패** | **아니오** — NextAuth가 콘솔에만 출력 | **표시 안 함** |
| **cron/sync 실패** | **아니오** — 각 cron route의 `console.error`만 | **표시 안 함** |
| master sync REVIEW_REQUIRED | 아니오 — 이미 `/admin/ops`가 manifest로 표시 중 | 중복 구현 안 함 |

### 결론

**기존 데이터만으로 구현 가능하다.** `severity`·`type`·지역·개월 수는 전부 `message`
문자열 안에 이미 들어 있으므로 **읽는 시점에 파싱**하면 된다.
schema 변경도, 새 table도, 새 인프라도 필요 없다 → STOP 사유 없음.

**read-time 파싱을 고른 이유**(단순히 승인 회피가 아니다): 새 컬럼을 만들어도
**이미 쌓인 과거 로그는 채울 방법이 없다.** 과거까지 즉시 요약되는 쪽은 파싱이다.

---

## 4. 설계 결정

### 4.1 배치 — 기존 대시보드가 아니라 `/admin/system`

요약 카드 + 필터 + 표 + 상세 펼침 + 반복 집계는 이미 카드 7개가 들어찬
`/admin/dashboard`에 넣기엔 크다("대형 dashboard redesign 금지"). 관리자 route가
이미 4개로 나뉘어 있으므로 `/admin/system`을 추가하는 쪽이 구조에 맞다.

**기존 원시 로그 카드는 그대로 둔다**(regression 0). 그 카드 안에 요약 화면으로 가는
링크 한 줄과, 관리자 nav에 항목 하나만 추가했다.

### 4.2 severity — 기존 어휘를 쓰되 눈금은 4단계

`admin-ops-evidence.ts`에 기존 정책(`OverallStatusCode`)이 있다. 다만 그것은
**"시스템 전체가 지금 어떤 상태인가"** 이고, 여기는 **"이 로그 한 줄이 얼마나 급한가"** 로
개념이 다르다. 그리고 3단계로는 요구된 구분이 무너진다 — 2/60 실패와 27/60 실패가
같은 칸에 들어가면 분류의 의미가 없다.

그래서 **타입은 분리하되 라벨 어휘와 pill 배색은 재사용한다**(운영자가 두 화면을
오갈 때 같은 색이 같은 뜻이어야 한다).

| 코드 | 라벨 | MOLIT 기준 |
|---|---|---|
| `LOW` | 정상 | `failed == 0` |
| `MEDIUM` | 확인 필요 | `failed/months < 0.2` |
| `HIGH` | 위험 | `0.2 <= failed/months < 0.5` |
| `CRITICAL` | 문제 | `failed/months >= 0.5` |

**절대 건수가 아니라 비율**인 이유: 120개월 중 2개월 실패와 3개월 중 2개월 실패는
전혀 다른 사건이다. 분모를 모르면(months 누락) 비율을 지어내지 않고 `MEDIUM`으로
둔다 — **"모른다"를 "괜찮다"로 접지 않는다.**

MOLIT이 아닌 로그는 비율 개념이 없으므로 오류 종류로 가른다:

| 조건 | 등급 | 이유 |
|---|---|---|
| `PrismaClientInitializationError` / `RustPanicError` | `CRITICAL` | 그 라우트가 통째로 죽는다 |
| 그 외 서버 라우트 예외 | `HIGH` | 요청 하나가 5xx로 끝났다 |
| 클라이언트 오류 | `MEDIUM` | |

**이 분류는 관리자 표시 전용이다.** 어떤 사용자 응답에도, 어떤 API semantics에도
흘러가지 않는다.

### 4.3 수집하지 않는 종류에는 필터를 만들지 않는다

요구사항 §6은 AUTH / CRON 필터를 제안했지만, 이 둘은 `error_logs`에 저장되지 않는다.
필터를 만들면 **"AUTH 오류 0건"이 "인증은 멀쩡하다"로 읽히는 false empty**가 된다.

대신 화면 하단에 이 source가 무엇을 담지 **않는지** 명시했다.

---

## 5. 구현

| 파일 | 내용 |
|---|---|
| `src/lib/admin/system-health.ts` (신규) | 순수 로직 — redaction, MOLIT_PARTIAL 파싱, severity, 반복 집계, 조회 창 |
| `src/lib/admin/system-health.test.ts` (신규) | 45개 테스트 |
| `src/app/api/admin/system-health/route.ts` (신규) | `requireAdmin` + read-only 조회 + 상한 |
| `src/app/admin/system/page.tsx` (신규) | 카드 / 경고 / 반복 / 필터 / 표 / 상세 |
| `src/app/admin/system/page.module.css` (신규) | `/admin/ops`와 같은 토큰·배색 |
| `src/app/admin/dashboard/page.tsx` (수정) | nav 항목 1개 + 기존 에러 카드에 링크 1줄 |

`admin-ops-evidence.ts`와 같은 구조를 따랐다 — 판정은 lib에서 순수 함수로 테스트하고,
route는 I/O 조립만 한다.

### 표시 결과 (실제 파서 출력)

```
확인 필요 | MOLIT  | 26140 서대신동 · 아파트 매매 · 60개월 중 58개월 성공 / 2개월 실패
          └ OpenAPI Error: 초당 서비스 요청제한 횟수 초과 에러
문제      | MOLIT  | 11680 · 아파트 매매 · 60개월 중 15개월 성공 / 45개월 실패
          └ OpenAPI Error: 초당 서비스 요청제한 횟수 초과 에러
위험      | SERVER | Timed out fetching a new connection
```

카드: `총 3건 / MOLIT 부분 실패 2건 / 고위험 2건 / 최근 04:42`
경고: `데이터 불완전 가능성 높음 — 최대 실패 비율 75%`

---

## 6. 보안 / redaction

저장 시점에도 일부 마스킹이 있지만(`log-server-error.ts`의 connection string,
`api-molit.ts`의 serviceKey), 그건 **그 경로로 들어온 것**만 막는다. 관리자 화면은
테이블에 이미 쌓인 **모든 과거 로그**를 보여주므로 **표시 직전에 한 번 더** 지운다.

지우는 대상: `serviceKey` / `access_token` / `refresh_token` / `id_token` /
`client_secret` / `api_key` / `password` / `token` 계열 key=value,
`Authorization` 헤더, 맨몸 `Bearer` 토큰, 쿠키 전체, JWT 모양(`eyJ...`),
DB connection string, URL query string, 이메일, 한국 휴대폰 번호.

**테스트가 실제 누출을 잡았다**: `authorization: Bearer <token>`에서 `\S+` 하나만
먹는 첫 구현은 `Bearer`까지만 지우고 **토큰 본체를 그대로 남겼다.** 선택적 스킴
한 낱말까지 함께 먹도록 고쳤고, 회귀 테스트로 고정했다.

redaction이 진단 정보를 망가뜨리지 않는 것도 테스트로 고정했다(지역 코드 `26140`과
실패 사유는 그대로 남는다).

---

## 7. 접근 제어

기존 guard를 그대로 재사용한다. 새 권한 체계 0건.

- API: `requireAdmin()` — 비로그인 401, 비관리자 403. 거부 응답이 guard의 판정을 그대로 따른다.
- 화면: `/admin/ops`와 동일하게 `session.user.isAdmin`으로 판단하고,
  **비관리자면 SWR 키가 `null`이라 요청 자체가 나가지 않는다.**
- 테스트가 `ADMIN_EMAIL` 참조와 자체 role 검사가 이 라우트에 없음을 고정한다.

---

## 8. 성능

| 항목 | 조치 |
|---|---|
| 무제한 조회 | **금지** — 조회 창(1h/24h/7d) + `MAX_ROWS = 500` 이중 상한 |
| 잘림 표시 | `take: MAX_ROWS + 1`로 "더 있는지"를 같은 쿼리에서 판정 → 화면에 명시 |
| N+1 | 없음 — 쿼리 1회 |
| 외부 MOLIT 재호출 | **없음** (테스트로 고정) |
| production core API 영향 | 없음 — 별도 route, read-only, 기존 dashboard 쿼리 미변경 |
| 필터 | client-side — 필터를 바꿔도 서버를 다시 때리지 않는다 |
| 갱신 | 60초 (dashboard의 20초보다 느슨하게) |

---

## 9. 상태 분리 (§13)

| 상태 | 표시 |
|---|---|
| loading | "불러오는 중입니다..." |
| 비관리자 | "관리자만 접근할 수 있는 페이지입니다." |
| error | `role="alert"` 빨간 배너 — **"오류 없음"으로 접지 않는다** |
| empty (진짜 0건) | "최근 24시간 기록된 오류가 없습니다." |
| empty (필터 결과 0건) | "이 필터에 해당하는 오류가 없습니다." — 위와 구분 |

---

## 10. 테스트

`npx tsx --test src/lib/admin/system-health.test.ts` → **45/45 PASS**

요구된 12개 항목 전부 포함:

| § | 항목 | 상태 |
|---|---|---|
| 15-1 | admin only access | 배선 가드 (`requireAdmin`, `auth.status`) |
| 15-2 | normal user blocked | SWR 키 null + 자체 role 검사 부재 |
| 15-3 | MOLIT_PARTIAL parsing | 전 필드 + reason 공백 포함 + `dong=-` |
| 15-4 | 58/2 분류 | `MEDIUM` |
| 15-5 | 33/27 분류 | `HIGH` |
| 15-6 | 15/45 분류 | `CRITICAL` |
| 15-7 | failedMonths parsing | `+42` 꼬리표 보존 |
| 15-8 | no secret exposure | 6종 키 + Bearer + 쿠키 + JWT + DSN + 이메일 + 전화 |
| 15-9 | repeated aggregation | 묶임 / 지역 다르면 분리 / 1회는 제외 |
| 15-10 | loading/empty/error 분리 | 화면·API 양쪽 |
| 15-11 | raw detail available | 원문 보존 |
| 15-12 | dashboard regression 없음 | 기존 카드 존재 확인 |

추가로: 경계값(정확히 20% / 50%), 비율 vs 절대 건수, 분모 불명 시 LOW 금지,
빈 요약이 값을 지어내지 않음, 읽기 전용·상한·MOLIT 재호출 금지, 스로틀 표기,
AUTH/CRON 필터 부재.

---

## 11. 검증 결과

| 명령 | 결과 |
|---|---|
| `npx tsx --test src/lib/admin/system-health.test.ts` | **45/45 pass** |
| `npx tsx --test <src 전체>` | **1715/1715 pass, 0 fail** (기존 1670 + 신규 45) |
| `npx tsc --noEmit` | **`src/` 오류 0건** (잔여는 기존 `scripts/`·`tmp/` — `FAIL_EXISTING_SCRIPT_ERRORS`) |
| `npx eslint <변경 5파일>` | **clean** |
| `npm run build` | **exit 0** — `/admin/system`, `/api/admin/system-health` 정상 컴파일 |

---

## 12. 알려진 한계

1. **OAuth 콜백 실패와 cron/sync 실패는 보이지 않는다.** 현재 콘솔에만 남는다.
   수집 인프라 추가는 이번 범위 밖이며, 화면에 그 사실을 명시했다.
2. **반복 건수는 "기록된 횟수"이지 발생 횟수가 아니다.** 부분 실패는 `(type, lawdCd)`당
   5분에 한 번만 기록된다. 화면이 이 한계를 문장으로 밝힌다.
3. **스로틀 Map은 서버 인스턴스별 in-memory다.** 인스턴스가 여럿이면 같은 사실이
   인스턴스 수만큼 기록될 수 있다.
4. **클라이언트 오류는 실제로 유입되지 않는다.** `/api/log/error`에 호출자가 없다.
   파서는 지원하지만 현재 데이터는 0건이다. (원칙 14에 따라 라우트를 삭제하지 않았다.)
5. **전역 5xx 계측이 아니다.** `logServerError`가 걸린 8개 라우트만 기록된다.
6. 500건 상한을 넘으면 최근 500건만 본다(화면에 명시).

---

## 13. ADMIN QA REQUIRED

실제 브라우저가 없어 렌더는 검증하지 못했다.

- [ ] 관리자 계정으로 `/admin/system` 진입 → 카드 4개 / 표 / 상세 펼침
- [ ] 비관리자 계정 → "관리자만 접근할 수 있는 페이지입니다."
- [ ] 비로그인 → `/api/admin/system-health` 401
- [ ] 기간 탭(1시간/24시간/7일) 전환
- [ ] 유형 필터 + "고위험만" 체크박스
- [ ] 행 펼침 → 원문 / 실패한 월 / 복사 버튼
- [ ] **390px**에서 severity·유형·실패 건수·시각이 읽히는지 (카드 2열 유지)
- [ ] 기존 `/admin/dashboard` 원시 로그 카드가 그대로인지 (regression)

---

## 14. 다음 STEP 후보 (이번 범위 아님)

- cron/sync 실패를 `error_logs`에 남기기 (현재 `console.error`만) — 수집 지점 추가라 별도 승인 필요
- OAuth 콜백 실패 수집 (NextAuth `logger` 옵션) — auth 설정 변경이라 승인 필요
- `error_logs` 보존 기간 정책 (현재 무한 적재)
