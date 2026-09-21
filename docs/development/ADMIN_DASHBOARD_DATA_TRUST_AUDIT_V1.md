# E-JIP ADMIN DASHBOARD DATA TRUST AUDIT V1

관리자 대시보드 지표가 실제 Production 원천과 일치하는지, 운영 판단에 써도 되는지 감사한다.

- 측정: 2026-09-21 12:14~12:25 KST · 기준 커밋 `f1366fa`
- **READ ONLY** — DB INSERT/UPDATE/DELETE 0 · env 0 · schema 0 · runtime 0 · **MOLIT 호출 0**
- 수정은 하지 않았다(§20 계획만).

## 판정

**PARTIAL_TRUST**

- **"오늘" 붙은 지표는 지금 믿으면 안 된다.** 날짜 경계가 **UTC**라 한국시간 **매일 09:00에 0으로 리셋**된다.
  사용자가 본 **150 → 0 → 52**는 버그가 아니라 **이 리셋을 그대로 본 것**이며, 원천으로 재현했다(§4·§5).
- **UV와 PV가 같은 값인 것은 쿼리 버그가 아니다.** 두 지표는 서로 다른 쿼리를 쓴다.
  오늘 트래픽이 **전부 1페이지짜리 세션**이라 수학적으로 같아진 것이고, 그 트래픽의 성격 자체가 의심스럽다(§14·§17).
- **운영 데이터 센터가 자주 죽는 이유는 구조다** — 한 곳만 실패해도 화면 전체가 실패한다(§9·§10).
- **실패를 0으로 표시하는 코드는 없었다.** 대시보드는 실패 시 숫자 대신 오류 문구를 렌더한다 — 이 점은 정상이다(§8).

---

## 1. 지표 원천 지도

| 지표 | UI | API | 원천 | 날짜 기준 | 캐시 |
|---|---|---|---|---|---|
| 오늘 방문자(UV) | `admin/dashboard` | `/api/admin/dashboard` | `page_views` `COUNT(DISTINCT session_id)` | **UTC 자정** | 없음(live) |
| 오늘 페이지뷰(PV) | 〃 | 〃 | `page_views` `COUNT(*)` | **UTC 자정** | 없음(live) |
| 실시간 접속자 | 〃 | 〃 | `active_sessions.last_seen_at ≥ now−45초` | 상대시간 | 없음 |
| 오늘 신규가입 | 〃 | 〃 | `users.created_at ≥ today` | **UTC 자정** | 없음 |
| 총회원 | 〃 | 〃 | `users.count()` | 해당 없음 | 없음 |
| 실시간 인기 단지 | 〃 | 〃 | `active_sessions` groupBy `current_apt_name`, 45초 | 상대시간 | 없음 |
| 누적 인기 TOP 10 | 〃 | 〃 | `page_views` groupBy `apt_name`, **최근 30일 rolling** | 상대시간 | 없음 |
| 파이프라인 상태 | 〃 | 〃 | MOLIT 실호출 1건 + API 키 존재 확인 | — | **5분 TTL** |
| 사용자 행동 | `admin/behavior` | `/api/admin/behavior` | `admin-analytics/query`, range 7d/30d rolling | 상대시간 | **5분 TTL** |
| 사용자 관리 | `admin/users` | `/api/admin/users` | `users.findMany/count` | — | 없음 |
| 운영 현황 | `admin/ops` | `/api/admin/ops` | DB 9쿼리 + **외부 regcode 프록시 18회** + 정적 manifest | — | **5분 TTL** |
| 시스템 상태 | `admin/system` | `/api/admin/system-health` | `error_logs.findMany` | — | 없음 |

GA4는 이 화면 어디에도 쓰이지 않는다. **전부 자체(1st-party) 분석**이다.

## 2. UV 정의

```sql
SELECT COUNT(DISTINCT session_id) FROM page_views
WHERE created_at >= <today> AND url NOT LIKE '/__event__/%'
```

`session_id`는 `getClientSessionId()`(`src/lib/live-presence.ts:10`)가 만드는 값이고 **`sessionStorage`에 저장**된다.

→ **UV는 "사람 수"가 아니라 "오늘 활동한 브라우저 탭 세션 수"다.**
같은 사람이 탭 2개를 열면 2로, 탭을 닫았다 새로 열면 또 1로 센다.

**라벨 "오늘 방문자(UV)"와 실제 계산이 일치하지 않는다.** 과다 계상 방향이다.

## 3. PV 정의

```ts
prisma.pageView.count({ where: { createdAt: { gte: today }, url: { not: { startsWith: '/__event__/' } } } })
```

`page_views` 행 수. 분석 이벤트(`/__event__/` 접두사)는 **정상적으로 제외**된다.

**UV와 PV는 서로 다른 쿼리·다른 집계 함수를 쓴다. 소스를 잘못 공유하고 있지 않다**(§14 참조).

## 4. Timezone — **결함 확정**

`src/app/api/admin/dashboard/route.ts:12`

```ts
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);   // ← 서버 로컬 자정
  return d;
}
```

`setHours`는 **실행 환경의 로컬 시간**을 쓴다. Vercel Function은 **TZ=UTC**로 돈다
(코드베이스도 이를 전제한다 — `cron-schedule.ts`가 UTC cron을 KST 라벨로 변환한다).
프로젝트 전체에 `TZ`/`Asia/Seoul` 설정은 **없다**.

| 기준 | 값(측정 시점) |
|---|---|
| 운영에서 실제로 쓰이는 `startOfToday()` (UTC 자정) | `2026-09-21T00:00:00Z` = **2026-09-21 09:00 KST** |
| 운영자가 기대하는 "오늘" (KST 자정) | `2026-09-20T15:00:00Z` = 2026-09-21 00:00 KST |

**→ 대시보드의 "오늘"은 매일 한국시간 09:00에 시작한다.**

`setHours(0,0,0,0)`는 **대시보드 라우트에만** 존재한다(전 admin 경로 grep 확인). 다른 화면은 rolling window를 써서 이 결함이 없다.

> 로컬에서는 재현되지 않는다 — 개발 머신 TZ가 KST(offset −540)라 `startOfToday()`가 KST 자정을 낸다.
> **환경 의존 결함**이라 로컬 QA로는 잡히지 않는다.

## 5~6. 원천 대조 · 150 → 0 → 52 재현 — **CONFIRMED**

측정 시각 **2026-09-21T03:14Z (12:14 KST)**, 대시보드와 같은 정의로 원천 직접 계산:

| 계산 기준 | PV | UV |
|---|---|---|
| **UTC 일 (= 대시보드가 보여주는 값)** | **60** | **60** |
| KST 일 (= 운영자가 기대하는 값) | **211** | **211** |

UTC 자정 전후 누적:

| 구간 | PV | UV |
|---|---|---|
| **직전 UTC 일** (2026-09-20 09:00 ~ 2026-09-21 09:00 KST) | **151** | **151** |
| **현재 UTC 일** (2026-09-21 09:00 KST ~ 지금) | **60** | **60** |

**사용자가 본 숫자와 정확히 일치한다:**

- 아침(09:00 KST 이전)에 본 **"150 이상"** → 직전 UTC 일 누적 **151**
- 09:00 KST 직후 **"0"** → UTC 일이 바뀌며 카운터가 0부터 다시 시작
- 이후 **"52"** → 같은 날 누적이 다시 쌓이는 중(지금은 60)

**추정이 아니라 원천 재현이다.** 후보 A(UTC/KST 경계)가 단독으로 세 숫자를 전부 설명한다.

시간대별(KST, 올바른 `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'` 변환):

```
09-21 00:00 pv=1   01:00 pv=2    02:00 pv=27  03:00 pv=26  04:00 pv=22
      05:00 pv=23  06:00 pv=24   07:00 pv=26  10:00 pv=26  11:00 pv=27  12:00 pv=8
```

## 7. 캐시 감사

`getOrSetCache`(`src/lib/server-cache.ts`)는 **프로세스 메모리 `Map`** + in-flight 공유다.

| 항목 | 결과 |
|---|---|
| UV/PV/실시간/가입 | **캐시 없음** — 매 요청 live 쿼리 |
| 파이프라인 상태·ops·behavior | 5분 TTL |
| 실패 캐싱 | **없음** — throw 시 `store.set`에 도달하지 않고 in-flight도 `finally`로 제거된다 |
| 인스턴스 간 공유 | **없음** — Vercel 인스턴스마다 별도, 콜드 스타트마다 초기화 |

**→ "옛 값 → 0 → 새 값"은 캐시가 만든 현상이 아니다.** UV/PV는 애초에 캐시를 타지 않는다.
후보 B(stale cache)는 **RULED_OUT**.

## 8. 실패 시 무엇을 렌더하는가 — **0으로 위장하지 않는다**

`src/app/admin/dashboard/page.tsx:47-48, 94-96`

```tsx
const d = data?.success ? data.data : null;
const fetchError = data && !data.success ? data.error : swrError ? '대시보드를 불러오지 못했습니다.' : null;
...
) : fetchError ? ( <div>⚠️ {fetchError}</div>
) : d ? ( /* 숫자 렌더 */ )
```

**조회 실패를 "방문자 0명"으로 표시하는 코드는 없다.** 실패하면 숫자 대신 경고 문구가 뜬다.
**"실제 0"과 "조회 실패"는 구분되어 있다** — P0 신뢰성 결함 아님. 후보 C는 **RULED_OUT**.

## 9~10. 운영 데이터 센터 실패 — 구조적 원인

`/api/admin/ops` GET 전체가 이 한 덩어리다:

```ts
try {
  const data = await getOrSetCache('admin-ops:summary-v1_2', 5분, buildSummary);
  return NextResponse.json({ success: true, data });
} catch {
  return NextResponse.json({ success: false, error: '운영 데이터를 불러오지 못했습니다.' }, { status: 500 });
}
```

`buildSummary()`가 하는 일:

1. **`Promise.all`로 DB 9개 쿼리** — 865,000행 `apartment_trade_histories`에 대한
   `count` 4회 + **`groupBy(['lawdCd'])` 2회** + `aggregate(_max)` 2회 + rent 카운트.
2. **`buildNationwideRegionModel()` — 외부 프록시를 순차로 18회 호출:**

```ts
const sidoList = await getSidoList();               // 외부 fetch 1
for (const sido of sidoList) {
  const list = await getSigunguListForSido(sido.code);  // 외부 fetch × 17, 순차 await
}
```

대상은 **제3자 프록시** `https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes`이고
`fetch`에 **timeout이 없다**.

### 왜 "자주" 실패하는가

- **`Promise.all`은 all-or-nothing이다.** 9개 중 하나만 reject해도 전체가 throw → 화면 전체가 실패 문구.
  DB health가 성공하고 cron health가 성공해도 **한 쿼리 실패가 전부를 덮는다** → **부분 실패를 전체 실패로 확대**(P1).
- **캐시는 인스턴스별**이다. Vercel이 새 인스턴스를 띄울 때마다 콜드 → 18회 외부 호출 + 865k행 집계를 **처음부터** 다시 한다.
  "항상"이 아니라 **"자주"** 실패하는 패턴과 정확히 맞는다.
- 외부 프록시가 느려지면 timeout 가드가 없어 **함수 시간 예산을 모두 소진**한다 → 플랫폼 타임아웃 → 500.

측정 시점의 프록시는 건강했다(5회: 0.45 / 0.14 / 0.12 / 0.16 / 0.12초 · 전부 200).
18회 순차면 **약 2.5~3초**로, 그 자체로는 치명적이지 않지만 **DB 집계와 합쳐지면 여유가 없다.**

## 11. Production 로그 증거 — **없다(그리고 그게 문제다)**

최근 24시간 `error_logs` 행 수: **0**.

`/api/admin/ops`와 `/api/admin/dashboard`의 catch는 **`console.error`만** 하고 `error_logs`에 쓰지 않는다.
즉 **운영자가 실패 화면을 봐도 시스템 상태 화면에는 아무 흔적이 남지 않는다.**

**사용자가 본 실패 시각과 대조할 로그가 존재하지 않는다. 없는 근거를 만들지 않는다.**

## 12. 엔드포인트 신뢰성 테스트 — 부분적으로만 가능

| 엔드포인트 | 비인증 결과 |
|---|---|
| `/api/admin/dashboard` | **401** (0.30s) |
| `/api/admin/ops` | **401** (0.13s) |
| `/api/admin/system-health` | **401** (0.20s) |

인증 게이트는 정상 동작한다. **관리자 세션이 없어 인증 상태에서의 반복 호출·간헐 실패·콜드스타트 지연은 측정하지 못했다.**
이 부분은 미측정으로 남긴다(추정하지 않음).

## 13. 150 → 0 → 52 원인 분류

| 후보 | 판정 | 근거 |
|---|---|---|
| **A. UTC/KST 경계** | **CONFIRMED** | §4 코드 + §5 원천 재현. 직전 UTC 일 **151** → 현재 UTC 일 **60**. 세 숫자를 단독으로 설명 |
| B. stale cache | **RULED_OUT** | UV/PV는 캐시를 타지 않음(§7) |
| C. 실패 시 0 fallback | **RULED_OUT** | 실패 시 오류 문구 렌더(§8) |
| D. 분석 수집 지연 | **RULED_OUT** | 자체 DB 동기 기록, 외부 분석 파이프라인 없음 |
| E. 쿼리 필터 버그 | **UNLIKELY** | 필터는 `/__event__/` 제외뿐이며 의도대로 동작 |
| F. visitor identity 버그 | **POSSIBLE(별건)** | UV가 사람이 아니라 탭 세션(§2). 150→0→52와는 무관 |
| G. 잘못된 date key | **RULED_OUT** | 날짜 키 없음. 범위 비교(`gte`)만 사용 |
| H. 집계 재빌드/리셋 | **RULED_OUT** | 집계 테이블 없음. 매번 원본 집계 |
| I. 부분 엔드포인트 실패 | **RULED_OUT (대시보드)** | 실패면 숫자 자체가 안 뜸 |
| J. UI race condition | **UNLIKELY** | SWR 단일 소스, 숫자 조합 없음 |

## 14. UV = PV 원인

**코드 버그가 아니다.** 두 값은 서로 다른 쿼리다(§2·§3). 같은 field·같은 aggregation을 잘못 공유하지 않는다.

**실제 이유: 오늘 트래픽이 전부 1페이지짜리 세션이다.**

오늘(UTC 일) 세션별 페이지뷰 분포: **`1회 → 60세션`이 전부.** 2회 이상인 세션 **0개**.
시간대별로도 **모든 시간에서 pv == uv**였다.

세션 식별 자체는 정상 동작한다 — 최근 30일로 넓히면:

| 세션당 조회수 | 세션 수 |
|---|---|
| **1회** | **511** |
| 2회 | 22 |
| 3회 | 63 |
| 4~21회 | 각 1~17 |
| **30일 합계** | **PV 2,735 / UV 717** |

30일 기준으로는 UV ≠ PV이고 최대 21회 세션도 있다. 즉 `sessionStorage` 기반 세션 추적은 작동한다.
**다만 전체 세션의 71%(511/717)가 1회짜리이고, 오늘은 100%다.**

## 15. 실시간 접속자

정의: `active_sessions.last_seen_at >= now − 45초`(`ONLINE_WINDOW_MS = 45_000`).
클라이언트가 30초마다 핑을 보내고, 경계 깜빡임을 피하려 45초로 둔 **의도된 설계**다.

UV/PV와 **원천이 다르다**(`active_sessions` vs `page_views`). 날짜 경계 결함의 영향을 받지 않는다.

측정 시점: 전체 행 **608** · 최근 5분 **2** · 최근 10분 **5** · 최신 `2026-09-21T03:14Z`.

> 별건 관찰: `active_sessions`에 **608행**이 쌓여 있고 **396행은 하루 이상 오래된 것**,
> 가장 오래된 것은 **2026-08-11**이다. 45초 창을 쓰므로 표시값은 정확하지만 **테이블이 정리되지 않는다**(P2).

## 16. 인기 단지 지표

| 지표 | 창 | 원천 | 비고 |
|---|---|---|---|
| 실시간 인기 단지 | **45초** | `active_sessions.current_apt_name` | 창이 매우 짧아 대부분 비어 보이는 것이 **정상**. 중복 방문자는 `session_id` 유니크로 자연 제거 |
| 누적 인기 TOP 10 | **최근 30일 rolling** | `page_views.apt_name` | 날짜 경계 결함 없음 |

값이 비어 있을 때 "실제 0"과 "조회 실패"는 대시보드 수준에서 구분된다(실패면 카드 자체가 안 뜬다).

## 17. 봇 / 관리자 / 자기 트래픽

**쓰기 시점 필터가 존재한다** — `src/lib/analytics/traffic-classification.ts`,
`/api/log/view`가 `classifyTraffic()`으로 걸러 **행을 아예 만들지 않는다**:

`QA_SUPPRESSED` · `ADMIN_SESSION` · `BOT`(UA 패턴) · `NON_PRODUCTION`(`VERCEL_ENV !== 'production'`)

따라서 **관리자 본인 방문·로컬/Preview·자기 QA 트래픽은 제외된다.** 이 부분은 잘 되어 있다.

**그러나 두 가지 구조적 한계가 있다.**

1. **`page_views`에 `user_agent`·`ip` 컬럼이 없다**(컬럼 전수: `id · url · complex_id · apt_name · session_id · user_id · created_at`).
   → 필터를 통과한 트래픽이 사람인지 봇인지 **사후에 판별할 방법이 없다.**
2. **UA 패턴이 자기 식별 크롤러만 잡는다.** 예: 네이버 **Yeti**(`Yeti/1.0 (+http://naver.me/spd)`)는
   `bot|crawler|spider|...` 어디에도 걸리지 않아 **집계에 포함된다.** 일반 브라우저 UA를 위장한 스크레이퍼도 통과한다.

### 오늘 트래픽이 사람으로 보이지 않는 이유

- **모든 시간대에서 pv == uv**(27/27, 26/26, 22/22 …)
- **새벽 02:00~07:00 KST에도 시간당 22~27건**으로 균일
- 최근 24시간 **로그인 상태 조회 0건** (익명 212 / 로그인 0)
- 오늘 세션의 **100%가 1페이지**

**봇이 오늘 방문자를 부풀리고 있을 가능성이 높다.** 다만 UA가 저장되지 않아 **단정할 수 없다** —
이것이 §20 P1에 UA 기록을 넣은 이유다.

## 18. 지표별 신뢰 등급

| 지표 | 등급 | 이유 |
|---|---|---|
| **오늘 방문자(UV)** | **UNTRUSTED** | UTC 경계로 09:00 KST 리셋 + 사람이 아니라 탭 세션 + 봇 혼입 가능 |
| **오늘 페이지뷰(PV)** | **UNTRUSTED** | UTC 경계로 09:00 KST 리셋 |
| **오늘 신규가입** | **UNTRUSTED** | 같은 UTC 경계 사용 |
| 실시간 접속자 | **TRUSTED** | 45초 상대창, 경계 무관, 정의 명확 |
| 총회원 | **TRUSTED** | 단순 전체 count |
| 사용자 관리 | **TRUSTED** | `users` 직접 조회 |
| 실시간 인기 단지 | **TRUSTED** | 45초 창임을 알고 보면 정확 |
| 누적 인기 TOP 10 | **TRUSTED_WITH_DELAY** | 30일 rolling(경계 무관). 단 봇 혼입 가능성은 공유 |
| 사용자 행동 | **UNKNOWN** | range가 rolling이라 경계 결함은 없으나, 내부 집계는 이번에 감사하지 않았다 |
| 시스템 상태 | **TRUSTED_WITH_DELAY** | `error_logs` 직접 조회. **단, admin API 실패가 여기 기록되지 않는다**(§11) |
| **운영 현황(ops)** | **UNTRUSTED** | 자주 전체 실패. 부분 실패 격리 없음(§9·§10) |

## 19. 총평

**PARTIAL_TRUST.**

**지금 운영 판단에 써도 되는 것**: 총회원 · 사용자 관리 · 실시간 접속자 · 실시간/누적 인기 단지(창 의미를 알고 볼 것).

**지금 써서는 안 되는 것**: **"오늘" 붙은 모든 숫자**(UV·PV·신규가입).
특히 **오전 09:00 KST 직후의 낮은 값은 실제 감소가 아니라 리셋이다.**
이 숫자로 "오늘 트래픽이 줄었다" 같은 판단을 하면 안 된다.

**운영 현황 화면은 표시되지 않을 때가 잦고, 실패해도 로그가 남지 않는다.**

## 20. 수정 계획 (이번 STEP 구현 금지)

### P0

1. **`startOfToday()`를 KST 기준으로 바꾼다.** `/api/admin/dashboard`의 "오늘" 5개 지표
   (PV·UV·신규가입·신규글·신규댓글)가 전부 이 함수 하나를 쓴다 — **한 곳만 고치면 된다.**
   환경 TZ에 의존하지 않도록 KST 오프셋을 명시하거나 `AT TIME ZONE`으로 DB에서 계산한다.
2. **UV 라벨/정의를 일치시킨다.** 현재 값은 "방문 세션 수"다. 라벨을 바꾸거나(`오늘 방문 세션`),
   정의를 사람 기준으로 바꾼다. **둘 중 하나는 해야 한다** — 지금은 라벨이 사실과 다르다.

### P1

3. **ops를 `Promise.allSettled`로 바꿔 부분 실패를 격리한다.** DB가 살아 있으면 DB 카드는 보여야 한다.
   실패한 섹션만 "확인 불가"로 표시한다(이 프로젝트가 이미 쓰는 `evidence`/UNKNOWN 표현과 같은 방식).
4. **외부 regcode 프록시 호출에 timeout과 폴백을 건다.** 18회 **순차**를 병렬로 바꾸거나,
   애초에 `getMolitLeafRegions()`(이미 쓰는 로컬 registry)로 대체해 외부 의존을 없앤다.
5. **admin API 실패를 `error_logs`에 기록한다.** 지금은 운영자가 실패를 봐도 흔적이 없다(§11).
6. **`page_views`에 `user_agent`를 남긴다.** 없으면 봇 혼입 여부를 영원히 사후 판별할 수 없다(§17).
   `Yeti` 등 비자기식별 크롤러를 UA 패턴에 추가하는 것도 함께.
7. **`fetched_at` 표시 + last-known-good**: 숫자 옆에 "언제 기준"인지 보여주면 리셋·지연을 운영자가 스스로 구분할 수 있다.

### P2

8. `active_sessions` 오래된 행 정리(608행 중 396행이 1일 이상, 최고령 2026-08-11).
9. 시간별 추이 저장(현재는 매번 원본 집계라 "오늘 아침엔 얼마였나"를 사후에 답할 수 없다).
10. 이상 감지 알림(오늘 값이 전일 동시간 대비 급변 시).

## 21. No-write assertion

| 항목 | 값 |
|---|---|
| Production DB INSERT / UPDATE / DELETE | **0 / 0 / 0** (`SET TRANSACTION READ ONLY`) |
| env · schema · runtime 변경 | **0 · 0 · 0** |
| **MOLIT 호출** | **0** — admin 엔드포인트는 401에서 끊겨 내부 헬스체크(MOLIT 1회)에 도달하지 않았다 |
| 외부 호출 | regcode 프록시 5회(지연 측정), e-jip.com admin 3회(401 확인) — 둘 다 MOLIT 아님 |

## 22. 다음 권고

1. **P0-1(KST 경계)부터 고친다.** 한 함수 수정이고, 사용자가 실제로 혼란을 겪은 바로 그 결함이며,
   `/api/admin/dashboard` 밖으로 영향이 없다(grep으로 `setHours(0` 사용처가 그 파일뿐임을 확인).
2. **P0-2(UV 라벨)를 같이 정한다.** "방문자"로 둘지 "방문 세션"으로 둘지는 제품 판단이라 승인이 필요하다.
3. **고치기 전까지는 운영자에게 "오전 9시 리셋"을 알려 둔다.** 그 사실만 알아도 오독을 막을 수 있다.
4. **P1-3/4(ops 부분 실패 격리 + 외부 프록시 제거)는 별도 STEP.** 특히 외부 프록시를 이미 있는
   로컬 registry로 대체하면 실패 원인 하나가 통째로 사라진다.
5. **봇 판별은 UA 기록 없이는 불가능하다.** "오늘 방문자 60명"이 사람 몇 명인지는 **지금 답할 수 없다.**

## 산출물

| 파일 | 내용 |
|---|---|
| `scripts/audit-admin-dashboard-trust.ts` | UTC/KST 경계 대조 · 시간별 재구성 · 세션 분포 · 실시간/오류 원천 (읽기 전용) |
