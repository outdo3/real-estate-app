# E-JIP ADMIN DASHBOARD TRUST FIX V1

`ADMIN_DASHBOARD_DATA_TRUST_AUDIT_V1`이 확정한 신뢰성 결함 3건을 최소 변경으로 수정한다.

- 구현·배포: 2026-09-21 13:00~13:12 KST · 커밋 **`85a9cbf`** (기준 `7100f75`)
- **DB INSERT/UPDATE/DELETE 0 · schema 0 · migration 0 · env 0 · MOLIT 호출 0**
- SEO · 서울 데이터 · sitemap **변경 0**

## 판정

**PASS** — P0-1(KST 경계) · P0-2(UV 라벨) · P1-1(운영 센터 부분 실패 격리) 전부 수정, 테스트·빌드 통과, 배포 확인.

다만 **관리자 로그인 세션이 없어 대시보드 화면을 눈으로 확인하지는 못했다.** 기대값은 §7에 숫자로 남긴다.

---

## 1~3. Today 경계 — UTC → KST

**Before** (`src/app/api/admin/dashboard/route.ts`)

```ts
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);   // 실행 환경 로컬 자정 = Vercel에서는 UTC 자정
  return d;
}
```

**After**

```ts
import { startOfKstDay } from '@/lib/kst-day';
const startOfToday = startOfKstDay;
```

**KST helper** — `src/lib/kst-day.ts` (신규)

```ts
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function startOfKstDay(now: Date = new Date()): Date {
  const asKstWallClock = new Date(now.getTime() + KST_OFFSET_MS);
  const kstMidnightAsIfUtc = Date.UTC(
    asKstWallClock.getUTCFullYear(), asKstWallClock.getUTCMonth(), asKstWallClock.getUTCDate()
  );
  return new Date(kstMidnightAsIfUtc - KST_OFFSET_MS);
}
```

- **런타임 TZ에도 브라우저 TZ에도 의존하지 않는다.** 오프셋 산술만 쓴다.
- 한국은 **서머타임이 없어**(1988년 이후 미시행) UTC+9 고정 오프셋이 연중 정확하다. `Intl`/TZ 데이터 불필요.
- 반환값은 평소대로 UTC `Date`라 Prisma 비교(`gte`)에 그대로 들어간다 — **호출부 변경 0**.
- 과도한 추상화를 피해 **함수 2개짜리 모듈** 하나로 끝냈다(`startOfKstDay`, `formatKstTime`).

## 4. 영향받는 오늘 지표 — 전부 KST로 전환됨

`startOfToday()` **하나를 공유**하므로 한 곳 수정으로 전부 바뀐다(감사에서 `setHours(0` 사용처가 이 파일뿐임을 확인):

| 지표 | 쿼리 | 상태 |
|---|---|---|
| 오늘 페이지뷰(PV) | `pageView.count({ createdAt: { gte: today } })` | **KST** |
| 오늘 방문 세션 | `COUNT(DISTINCT session_id) … created_at >= today` | **KST** |
| 오늘 신규가입 | `user.count({ createdAt: { gte: today } })` | **KST** |
| 오늘 신규 게시글 | `post.count({ createdAt: { gte: today } })` | **KST** |
| 오늘 신규 댓글 | `comment.count({ createdAt: { gte: today } })` | **KST** |

`grep -rn "setHours(0" src/app/api/admin/ src/app/admin/` → **코드 상 사용처 0건**(주석만 남음).

## 5~6. UV 라벨

| | Before | After |
|---|---|---|
| **화면 라벨** | `오늘 방문자(UV)` | **`오늘 방문 세션`** |
| 보조 설명 | 없음 | **`브라우저 세션 기준 중복 제거`** |
| API 필드명 | `todayUniqueVisitors` | **`todayVisitSessions`** |
| 정의 | `COUNT(DISTINCT session_id)` | **변경 없음**(정의는 그대로, 이름만 사실에 맞춤) |

**사람 수/사용자 수라는 표현은 쓰지 않았다.** `session_id`는 `sessionStorage` 기반이라
한 사람이 탭 두 개를 열면 2로 세는 값이고, 이제 라벨이 그 사실과 일치한다.

**PV는 `오늘 페이지뷰(PV)` 유지** — 원래부터 `COUNT(*)`였고 정확하다.
두 지표가 **서로 다른 쿼리**라는 점은 코드 주석으로 명시했다(감사 §14에서 혼동 소지로 지목된 부분).

### §9 fetched_at — 함께 넣었다

트래픽 카드 머리에 한 줄:

> `오늘 = 한국시간 00:00 기준 · 마지막 갱신 13:11`

API도 `todayStartsAt`(KST 자정, ISO)과 `fetchedAt`을 함께 내려준다.
**이제 오전 9시 직후의 낮은 값이 "리셋"인지 "감소"인지 화면만 보고 구분할 수 있다.**

## 7. KST parity — 기대값

배포 직후(2026-09-21 **13:11 KST**) 원천 직접 계산:

| 기준 | 방문 세션 | 페이지뷰 |
|---|---|---|
| **KST 일 (= 이제 대시보드가 보여줄 값)** | **240** | **240** |
| UTC 일 (= 수정 전이면 보였을 값) | 89 | 89 |

경계: KST 일 시작 `2026-09-20T15:00:00Z`(= 09-21 00:00 KST) · UTC 일 시작 `2026-09-21T00:00:00Z`(= 09-21 **09:00** KST).

**운영자 확인 방법**: 관리자 대시보드에서 `오늘 방문 세션`이 **89가 아니라 240 근처**로 보이면 정상이다
(측정 이후에도 계속 쌓이므로 240 이상).

> UV와 PV가 같은 240인 것은 정상이다 — 감사 §14에서 확인했듯 **오늘 트래픽이 전부 1페이지짜리 세션**이라 그렇다.
> 쿼리를 잘못 공유해서가 아니다.

## 8. UTC 런타임 테스트

`src/lib/kst-day.test.ts` — 감사가 지목한 경계를 그대로 고정했다.

| 테스트 | 의미 |
|---|---|
| **KST 08:59** | 아직 UTC 어제지만 오늘(KST)은 이미 시작 |
| **KST 09:00** | UTC 날짜가 바뀌는 순간에도 **"오늘"의 시작이 변하지 않는다**(리셋 없음) |
| **KST 23:59 → 00:00** | 진짜 날짜 경계에서만 넘어간다 |
| KST 자정 정각 | 경계 포함 |
| 하루 안 임의 시각 | 전부 같은 시작점 |
| 옛 UTC 구현과의 차이 | 매일 09시간 구간에서 다른 날을 가리킴(회귀 방지) |
| `formatKstTime` | UTC 순간 → KST 시:분 |

```
npx tsx --test src/lib/kst-day.test.ts        → 8 pass / 0 fail
TZ=UTC npx tsx --test src/lib/kst-day.test.ts → 8 pass / 0 fail
```

**TZ=UTC에서도 동일 통과**가 핵심이다 — 옛 버그가 로컬에서 안 잡힌 이유가 개발 머신 TZ가 KST였기 때문이다.

## 9~10. 운영 센터 부분 실패 격리

### 무엇이 문제였나

`buildSummary()`가 던지면 GET의 단일 `catch`가 **화면 전체**를 "운영 데이터를 불러오지 못했습니다"로 만들었다.
그 안에서 유일하게 **외부 서비스**에 의존하는 조각이 `buildNationwideRegionModel()`이었고,
timeout 없이 제3자 프록시를 **18회 순차** 호출했다.

### 무엇을 바꿨나

| 항목 | Before | After |
|---|---|---|
| 프록시 호출 | **18회 순차** `await` | **한 번에**(`Promise.all`) — 호출 수는 동일 |
| 프록시 timeout | **없음**(무한 대기 가능) | **3초** (`AbortSignal.timeout`) |
| region model 실패 시 | **화면 전체 실패** | 그 조각만 **`확인 불가`** |
| 실패 고지 | 없음 | `degradedSources` + 배너 |
| 목록을 못 받았을 때 | "시도 0개"를 사실처럼 표시 | **`null`** → `확인 불가` |

배너 문구:

> **일부 항목을 불러오지 못했습니다 — 나머지 지표는 정상입니다.**
> 전국 region model(법정동코드 프록시)

→ **DB·cron·manifest 섹션이 멀쩡하면 그대로 보인다.** 감사 §10이 지적한 "부분 실패의 전체 실패 확대"가 해소됐다.

### 부수 수정 — 없는 경고를 만들지 않도록

`computeOverallHealth`의 `sejongInRegionModel`을 `boolean` → **`boolean | null`** 로 바꿨다.
예전에는 조회 실패 시 `false`가 들어가 **"세종이 region model에 없음"이라는 없는 문제**를 경고로 만들었다.
이제 `null` = 확인 불가 → **UNKNOWN**(경고 아님). 모듈 자신의 §2 원칙과 일치한다.

## 11. False zero 재확인 — 없음

| 경로 | 실패 시 표시 |
|---|---|
| 대시보드 전체 실패 | `⚠️ {오류 문구}` — **숫자 카드 자체가 렌더되지 않는다** |
| region model 실패 | **`확인 불가`** (0 아님) |
| 세종 region model | **`확인 불가`** (`정상`/`확인 필요` 아님) |
| 전체 health | **UNKNOWN** (`정상` 아님) |

`grep -nE "traffic\.[a-zA-Z]+ *(\?\?|\|\|) *0"` → **0건**. 조회 실패가 0으로 둔갑하는 경로는 없다.

## 12. 테스트

| 대상 | 결과 |
|---|---|
| `kst-day.test.ts` (신규, 8건) | **8 pass** — TZ=KST · TZ=UTC 양쪽 |
| `region-utils.failure.test.ts` (신규, 4건) | **4 pass** — 프록시 거부/5xx/timeout(abort) 시 **throw 없이 빈 목록**, `AbortSignal`이 실제로 실려 나가는지 확인 |
| `admin-ops-evidence.test.ts` (2건 추가) | **31 pass** — region model 실패 → UNKNOWN이며 **없는 경고를 만들지 않음**, 진짜 CRITICAL을 가리지도 않음 |
| 회귀(`system-health` · `analytics/events` · `region-registry` 포함) | **114 pass / 0 fail** |

`region-utils.failure.test.ts`가 §10의 "one source failure does not kill whole page"를 **계약으로 고정**한다 —
외부 프록시가 죽어도 `getSidoList()`가 빈 목록을 돌려주므로 요약은 throw하지 않고 부분 성공으로 끝난다.

## 13. Lint / Typecheck / Build

| 검사 | 결과 |
|---|---|
| `npx eslint <변경 파일 12개>` | **통과(exit 0, 지적 0건)** |
| `npx tsc --noEmit` | **`src/` 오류 0** · 전체 25건은 전부 기존 무관 스크립트(`FAIL_EXISTING_SCRIPT_ERRORS`) |
| `npm run build` | **`✓ Compiled successfully`** |

## 14. Production QA

| 경로 | 상태 |
|---|---|
| `/` | **200** (0.09s) |
| `/admin/dashboard` · `/admin/ops` | **307**(비로그인 → 로그인, 정상) |
| `/api/admin/dashboard` · `/api/admin/ops` | **401**(정상 게이팅) |

**한계를 정확히 적는다**: 관리자 세션이 없어 **로그인 상태의 화면과 숫자를 직접 확인하지 못했다.**
또한 §11이 요구한 "하위 source를 강제로 실패시켜 전체 페이지가 죽지 않는지"를 **Production에서는 재현하지 않았다**
(운영 중 고의 장애 주입은 하지 않음). 대신 그 계약을 **단위 테스트로 고정**했다(§12).

## 15~16. No-write / No-schema assertion

| 항목 | 값 |
|---|---|
| Production DB INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| schema 변경 · migration | **0 · 0** |
| env 변경 | **0** |
| MOLIT 호출 | **0** |
| `page_views` 컬럼 추가 · user_agent · IP 저장 | **0**(§12 금지 준수 — V2) |
| bot logic 확장 · `active_sessions` 정리 · hourly history | **0**(§12 금지 준수 — V2) |
| 서울 데이터 · SEO · sitemap | **0 · 0 · 0** |

## 17~18. Commit / Deploy

- 커밋 **`85a9cbf`** — 12파일(신규 3 · 수정 9). `prisma`/`schema`/`sitemap`/`layout`/`site-seo` **미포함** 확인
- push 완료 · Vercel 배포 확인(엔드포인트 401 응답 정상)

## 19. 남은 P1 / P2

**P1 (이번에 하지 않음)**

1. **admin API 실패를 `error_logs`에 기록** — 지금도 ops/dashboard의 `catch`는 `console.error`만 한다.
   운영자가 실패 화면을 봐도 시스템 상태 화면에 흔적이 없다(감사 §11: 24시간 오류 로그 0건).
2. **`page_views.user_agent` 저장 + `Yeti` 등 UA 패턴 보강** — §12에서 명시적으로 금지된 범위(V2).
   이것이 없으면 **"오늘 방문 세션 240이 사람 몇 명인지"는 여전히 답할 수 없다.**
3. **DB 쿼리 그룹까지 부분 격리** — 이번에는 **외부 의존 조각(region model)만** 격리했다.
   9개 DB 쿼리는 여전히 `Promise.all`이다. 다만 같은 Prisma 연결을 쓰므로 실패하면 대체로 함께 실패하고,
   그 경우는 "정말로 전체 실패"라 현재 동작이 틀리지 않다. 개별 격리는 UI 전반을 nullable로 바꿔야 해서
   §7 "큰 구조 리팩터링 금지"에 걸린다 — 별도 STEP.

**P2**

4. `active_sessions` 오래된 행 정리(현재 **635행**, 최고령 2026-08-11).
5. 시간별 추이 저장(지금은 "오늘 아침엔 얼마였나"를 사후에 답할 수 없다).
6. 이상 감지 알림(전일 동시간 대비 급변).

## 20. 다음 권고

1. **관리자로 로그인해 `오늘 방문 세션`이 89가 아니라 240 이상인지 확인해 주십시오.** 그것이 이번 수정의 최종 검증이다.
2. **P1-1(실패 로깅)을 다음으로 권한다.** 지금은 ops가 실패해도 근거가 남지 않아, 다음에 같은 문제가 생기면
   이번처럼 원인을 추적하기 어렵다. 변경 범위도 작다.
3. **P1-2(user_agent)는 제품 판단이 필요하다** — 개인정보 관점에서 UA 저장 여부를 정해야 한다.
   저장하지 않기로 하면 "방문 세션 수는 봇 포함 값"이라는 점을 화면에 명시하는 편이 정직하다.
4. **하루 지켜본 뒤 09:00 KST 전후를 다시 확인**하면 리셋이 사라졌음을 눈으로 확인할 수 있다.
