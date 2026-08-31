# ADMIN OPS V1 — 이집 데이터 운영 관리자 콘솔

## 1. 목적

관리자가 30초 안에 "지금 이집 데이터는 사용자가 믿고 봐도 되는
상태인가?"를 판단할 수 있는 read-only 관찰/진단 화면. 강제 sync,
재수집, DB 수정, row 삭제, cancellation 변경, manual INSERT 버튼은
V1에 없다(§2 명시적 범위 제한) — Production write는 0건.

## 2. Auth(신규 체계 없음, 기존 100% 재사용)

전수 감사 결과, 이 프로젝트는 이미 다음 2단 admin 보호 체계를
갖추고 있었다:

- **UI 레이어**: `src/proxy.ts`(Next.js 16 middleware, matcher
  `/admin/:path*`) — role이 `ADMIN`이 아니고 `ADMIN_EMAIL` 환경변수와
  로그인 이메일도 일치하지 않으면 `/`로 redirect. `/admin` 하위
  **모든** 경로(현재+향후)를 한 곳에서 막는다 — 새 admin 페이지를
  추가할 때 페이지마다 개별 role 체크를 반복할 필요가 없다.
- **API 레이어**: `src/lib/auth-helpers.ts`의 `requireAdmin()` — 이미
  `/api/admin/dashboard`, `/api/admin/users`, `/api/admin/users/[id]/ban`,
  `/api/admin/presales/sync` 4개 라우트가 쓰고 있는 서버사이드 세션
  검증. role==='ADMIN' 또는 ADMIN_EMAIL 일치.

이번 STEP은 이 두 체계를 **그대로 재사용**했을 뿐, 새 auth 코드를
한 줄도 추가하지 않았다(§4 "새로운 임의 관리자 인증 체계를 만들지
않는다" 요구사항 충족). `/admin/ops`는 proxy.ts의 기존 matcher에 자동
포함되고, `/api/admin/ops`는 다른 admin 라우트와 동일하게 GET 최상단에
`requireAdmin()`을 호출한다.

## 3. Implementation

- `src/app/api/admin/ops/route.ts` — 단일 GET, `requireAdmin()` 가드,
  5분 캐시(`getOrSetCache`, 기존 `admin/dashboard/route.ts`의 pipeline
  health 캐시와 동일 패턴).
- `src/app/admin/ops/page.tsx` + `page.module.css` — 기존
  `admin/dashboard/page.tsx`와 동일한 패턴(`useSession` client 체크 +
  `useSWR` + `Header`). CSS 커스텀 프로퍼티(`--bg-color`,
  `--card-bg`, `--border-color`, `--radius-*`, `--shadow-card`,
  `--text-primary`, `--text-muted`)도 기존 admin dashboard가 쓰는
  디자인 토큰을 그대로 재사용 — 새 디자인 시스템 없음.
- `src/app/my/page.tsx` — 기존 "관리자 대시보드" 링크 카드 옆에
  "데이터 운영 센터" 링크 카드 1개 추가(관리자에게만 노출, 기존
  조건부 렌더링 패턴 재사용).

## 4. 성능 감사 + 캐싱 전략

실측(부산 스코프 vs 무스코프 쿼리):

```
전체 unscoped COUNT(*): 5,079ms
전체 unscoped dealCanceled=false COUNT: 9,311ms
전체 unscoped canceled COUNT: 2,048ms
aptSeq missing COUNT(부산 스코프): 104ms
latestDealDate MAX aggregate(부산 스코프): 516ms
distinct lawdCd groupBy: 856ms
부산 스코프 total COUNT: 158ms
부산 스코프 active/canceled COUNT: 1.6~2.3s(변동)
```

무스코프 COUNT(*)류는 수 초가 걸린다(855,047 rows, Supabase 풀러
특성). 개별 쿼리를 매번 최적화하는 대신, **응답 전체를 5분 캐시**해
문제를 구조적으로 해결했다(§28 "warm ≤500ms" 요구사항을 캐시로
충족 — cache hit은 즉시, cache miss는 5분에 한 번만 느림, admin
전용 화면이라 수용 가능). 표시 지표는 전부 **부산 스코프**로
계산한다(§11 요구사항 그대로) — 무스코프 nationwide count는 262개
sync-target 중 실제 데이터가 있는 곳이 부산+QA 샘플 132건뿐이라
의미가 없고 느리기만 하다.

**자연키 중복(§12)은 라이브 재계산하지 않는다** — `prisma/schema.prisma`의
`@@unique([groupKeyStr, dealAmount, dealDate, floor, occurrenceIndex],
name: "trade_natural_key")` DB unique constraint가 중복을 구조적으로
차단하므로(위반 시 INSERT 자체가 실패), "0"은 추정치가 아니라
스키마가 보장하는 사실이다. 화면에는 `naturalKeyDuplicates.source:
'schema_constraint'`로 근거를 명시해 "매번 검증한 숫자"와 "구조적으로
불가능한 것"을 구분한다(§12 "숫자를 추정하지 않는다" 요구사항 — 이
경우는 추정이 아니라 증명 가능한 사실).

## 5. 데이터 소스별 정직성

| 지표 | 소스 | 갱신 방식 |
|---|---|---|
| TradeHistory 건수/aptSeq/latestDealDate | 부산 스코프 실시간 DB 쿼리(5분 캐시) | 매 5분 |
| 전국 시도/sync-target 수 | `getSidoList()`/`getSigunguListForSido()`(실시간 REGCODE_PROXY 조회, 5분 캐시) | 매 5분, 하드코딩 아님(§13) |
| Incremental sync 상태 | `nationwide-sync-manifest.json` 파일 직접 읽기 | 실제 sync 실행 시점 반영 |
| 24개월 cancellation SAFE | **문서 기준**(`TRADE_CANCELLATION_RESYNC_V2_24M.md`) — older window manifest(FAILED/INVALID)만 라이브 재확인, 전체 384-cell 검증 자체는 dry-run이라 파일로 영속화되지 않아 재계산 불가 | STEP 실행 시 갱신 |
| 역대(all-time) cancellation | 상수(`NOT_VERIFIED`) — 검증한 적이 없다는 사실 자체가 코드 레벨 정직성 요구사항 | STEP으로만 변경 |
| Feature 신뢰 상태 | 상수 배열(6개 기능, STEP B~E 결과 반영) | STEP으로만 변경 |
| 스케줄러 | 상수(`OFF`) — `vercel.json`/cron 부재 실측 확인(STEP F) | 실제 활성화 STEP 전까지 고정 |

§21 "실제 사용자 API를 관리자 page load마다 6개 호출하는 구조는
금지" — feature 배열은 각 기능 API를 호출하지 않고 코드 구성(STEP
B~E가 이미 검증한 사실)에서 직접 파생한다.

## 6. Coverage 의미 구분(§14/§22)

- **부산 16/16**: 실거래 DB에 실제 데이터가 있는 지역 coverage.
- **전국 17/17 시도, 262 sync-target**: **region model**(어떤 지역을
  조회할 수 있는가) coverage — TRADE_DB_FIRST_V1 STEP F/F-2가 만든
  **engine**의 coverage이지 **실거래 DB 데이터**의 coverage가 아니다.
- 화면에 `nationwideDbCoverageNote`로 명시: "전국 sync engine 준비
  완료(엔진), 전국 DB 실데이터 적재는 부산 외 극히 일부 QA 샘플만
  존재" — "전국 sync engine이 있다 = 전국 DB coverage 완료"로
  오해하지 않도록 §22 요구사항대로 분리했다.
- 세종: `regionModel: '정상'`(region model coverage, §4 확인됨) vs
  `tradeDbCoverage: '미수집'`(실제 DB 데이터 없음, STEP F-2에서
  dry-run만 검증) — 두 층위를 명확히 구분(§14 요구사항).

## 7. Production QA(실측)

`requireAdmin()` 우회 없이 라이브 curl로 보안 계층부터 확인:

```
/api/admin/ops (비로그인)          → 401 {"success":false,"error":"로그인이 필요합니다."}
/admin/ops (비로그인, 브라우저)     → 307 redirect to /
/api/admin/dashboard(기존, 비로그인) → 401(회귀 없음)
/api/admin/users(기존, 비로그인)     → 401(회귀 없음)
/ , /stats(일반 페이지)             → 200(회귀 없음)
```

데이터 정확성은 `buildSummary()`를 임시로 export해(auth 코드는
전혀 건드리지 않음, 테스트 직후 원복 확인) 직접 호출한 실제 값을
§38 known facts와 전부 대조했다:

```
Busan region = 16(확인)  |  Nationwide sido = 17(확인)  |  Sync targets = 262(확인)
24M cancellation = SAFE(확인)  |  All-time = NOT VERIFIED(확인)
aptSeq missing = 0(확인)  |  duplicates = 0(확인, 스키마 근거)
Production scheduler = OFF(확인)
Busan 6개 기능 = DB-FIRST(확인)  |  Nationwide DB coverage = NOT COMPLETE(확인, 명시적 문구)
```

모두 일치, 불일치 없음.

## 8. UI QA

`/admin` 매처가 실제 admin 세션 없이는 페이지 접근 자체를 막으므로,
`/admin` 밖의 임시 미리보기 라우트(auth 코드 무변경, 실제 캡처한
데이터를 그대로 하드코딩해 동일 CSS 모듈을 import)를 만들어 시각
QA를 수행한 뒤 즉시 삭제했다. 데스크톱: 상단 상태 배너 + 5개 status
tile + 상세 섹션들 전부 정상 렌더링, 색상+텍스트 라벨 병기(§9 색상만
전달 금지 충족). **iframe 격리 기법**(360/375/390 동시 렌더링, 이
세션에서 `resize_window`가 계속 비정상 동작해 이전 STEP들에서도
쓴 방식)으로 모바일 3개 폭 실측: 2열 status grid로 정상 축소, 가로
overflow 없음. **발견+수정한 실제 버그**: 고정 하단 네비게이션이
콘텐츠를 가리는 현상(§35 "bottom-navigation overlap" 금지 위반) —
원인은 `padding-bottom: 3rem`이 부족했던 것으로, 동일한 하단 네비를
쓰는 형제 페이지 `admin/dashboard/page.module.css`가 이미 검증해
둔 `7rem` 값을 그대로 적용해 해결했다(새 값 추측 아님, 이미 증명된
상수 재사용).

## 9. Regression

이번 STEP이 수정한 파일은 `src/app/admin/ops/*`(신규),
`src/app/api/admin/ops/route.ts`(신규), `src/app/my/page.tsx`(링크 1줄
추가)뿐이다 — `proxy.ts`, `auth-helpers.ts`, 기존 admin
dashboard/users 라우트는 전혀 건드리지 않았다. 라이브 확인: 기존
admin dashboard/users API 401 응답 그대로(회귀 없음), 홈/통계 페이지
200 정상(회귀 없음).

## 10. Test / Build

- `node --experimental-strip-types --test`(scripts 레벨, 32개): 전부
  pass(변경 없음 — 이번 STEP은 scripts/ 파일을 건드리지 않았다).
- `npx tsx --test`(src 전체, 211개): 전부 pass.
- `npx tsc --noEmit`: 20건(기존 무관 오류, 신규 0건).
- `npx eslint`: clean.
- `npm run build`: PASS, `/admin/ops`(정적)와 `/api/admin/ops`(동적)
  둘 다 빌드 결과에 정상 포함 확인.
- **신규 자동화 테스트 미추가**: 이 프로젝트의 `src/app/api/**`
  라우트 파일은 단 하나도 전용 테스트 파일을 갖고 있지 않다(실측
  확인, `find src/app/api -iname "*.test.*"` = 0건) — DB/auth
  의존적인 라우트 레벨 코드는 이 프로젝트 전체에서 일관되게 라이브
  QA로 검증해왔다(§7). 이 STEP도 동일 관례를 따랐다.

## 11. Database

- READ: 예
- INSERT/UPDATE/DELETE: 0
- schema/migration: 변경 없음

## 12. Technical Debt(기록만, 이번 STEP에서 손대지 않음)

- `resolveSidoCode()`(`region-utils.ts`)는 STEP F-2에서 발견된 동일한
  세종 gap을 여전히 갖고 있다 — `src/` 어디서도 호출되지 않는 dead
  code라 이번 STEP도 수정 범위에 넣지 않았다.
- REVIEW_REQUIRED로 분류된 거래를 실제로 검토/승인하는 관리자
  워크플로우는 없다(카운트만 표시). 실측 0%라 당장 급하지 않지만
  향후 STEP 후보.
- 24개월 cancellation SAFE 상태는 "문서 기준" 표시다 — 코드가 매
  page load마다 384-cell 전체 재검증을 하지 않는다(비용/시간상
  불가능). 향후 STEP에서 이 384-cell 결과 자체를 manifest로
  영속화하면(현재는 dry-run이라 저장 안 됨) 완전한 라이브 재계산이
  가능해진다.
