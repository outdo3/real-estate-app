# Analytics V1: Event Tracking Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic, allow-listed client event tracker (`favorite_add`, `favorite_remove`, `share_success`, `share_attempt`) that stores events in the existing `PageView` table under a reserved URL namespace, with zero DB schema changes and zero corruption of existing admin-dashboard metrics.

**Architecture:** Events are `PageView` rows with `url = "/__event__/<eventName>"`. A shared allow-list (`src/lib/analytics/events.ts`) is the single source of truth for valid event names, consumed by both the client tracker and the API route (unknown names are silently no-op'd, never written). Three existing admin-dashboard PageView aggregations gain a `NOT LIKE '/__event__/%'` exclusion; a new 7-day event-count aggregation is added alongside them. Two existing components (`FavoriteButton.tsx`, `useSharePage.ts`) get single-line `trackEvent(...)` calls added at their real success/attempt points — no existing UX/logic changes.

**Tech Stack:** Next.js 16 App Router API routes, Prisma (existing `PageView` model, no migration), TypeScript. No new dependencies. No test framework exists in this repo (no `jest`/`vitest`, no `test` script in `package.json`) — verification is `tsc --noEmit` + `eslint` + `next build` + manual browser/network-tab QA, matching this project's existing convention (see `docs/development/*` STEP docs).

## Global Constraints

- No Prisma schema/migration changes, no new DB tables/columns (event storage reuses `PageView` as-is).
- No new npm dependencies.
- Reserved prefix `/__event__/` must never collide with a real navigable URL (Next.js App Router has no route under this path, so it can never appear as a genuine `PageView.url` from `ViewTracker`/`apt-client.tsx`).
- `eventName` values are a fixed allow-list only — anything else is dropped (200 no-op response, never written to DB).
- No PII/free-text (e.g. search query text) may ever be placed in the event `url`, `complexId`, or `aptName` fields.
- No arbitrary props/metadata storage — only the existing `complexId`/`aptName` fields, used with their original meaning.
- Fire-and-forget everywhere: tracking failures must never throw, block, or surface to the user.
- Do not modify `FavoriteButton.tsx`'s or `useSharePage.ts`'s existing behavior/UX — only add tracking calls at points that already exist.
- Existing admin-dashboard queries (`todayPageViews`, `todayUniqueSessions`, `popularAptGroups`) must be audited and proven (by reading the query + manual QA) to exclude `/__event__/*` rows.
- Work stays on `feature/analytics-v1`; no `main` checkout/merge/push.
- `favorite_add`/`favorite_remove` fire only at the confirmed server-success point (after `json.success` check), not optimistically.
- `share_success` is used only where the browser/API genuinely confirms completion (Web Share API `'shared'` result, or `copyToClipboard()` returning `true`). `share_attempt` is used for the Kakao SDK path, which cannot be confirmed (fire-and-forget `sendDefault`, no completion callback) — never label it `share_success`.

---

### Task 1: Shared event allow-list module

**Files:**
- Create: `src/lib/analytics/events.ts`

**Interfaces:**
- Produces: `ANALYTICS_EVENT_NAMES` (readonly tuple), `AnalyticsEventName` (union type), `isAnalyticsEventName(value: string): value is AnalyticsEventName`, `ANALYTICS_EVENT_URL_PREFIX = '/__event__/'`, `eventUrl(name: AnalyticsEventName): string`.
- Consumed by: Task 2 (`trackEvent.ts`), Task 3 (`/api/log/event/route.ts`), Task 6 (admin dashboard aggregation).

- [ ] **Step 1: Write the module**

```typescript
// src/lib/analytics/events.ts

// ANALYTICS V1 — 범용 이벤트 트래킹의 고정 taxonomy. 이 배열에 없는 이벤트명은
// /api/log/event가 조용히 무시하고(200 no-op) DB에 절대 쓰지 않는다 — 임의
// 이벤트명/자유 형식 props가 이 테이블에 쌓이는 것을 코드 레벨에서 원천 차단한다.
//
// 저장 위치는 전용 Event 테이블이 아니라 기존 PageView 테이블이다(V1은 스키마
// 변경 없이 진행하기로 한 임시 저장 전략). 예약된 URL 네임스페이스
// `/__event__/<eventName>` 로 구분되며, 이 접두사는 admin dashboard의 기존
// PV/방문자/인기단지 집계 쿼리에서 명시적으로 제외된다(src/app/api/admin/dashboard/route.ts).
// Analytics V2에서 전용 Event 저장소로 옮길 때는 이 파일과 src/lib/analytics/trackEvent.ts,
// src/app/api/log/event/route.ts 세 곳의 저장 백엔드만 교체하면 되고, 호출부
// (FavoriteButton.tsx, useSharePage.ts 등)는 바뀌지 않는다.
export const ANALYTICS_EVENT_NAMES = [
  'favorite_add',
  'favorite_remove',
  'share_success',
  'share_attempt',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export function isAnalyticsEventName(value: string): value is AnalyticsEventName {
  return (ANALYTICS_EVENT_NAMES as readonly string[]).includes(value);
}

export const ANALYTICS_EVENT_URL_PREFIX = '/__event__/';

export function eventUrl(name: AnalyticsEventName): string {
  return `${ANALYTICS_EVENT_URL_PREFIX}${name}`;
}
```

- [ ] **Step 2: Verify with typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `src/lib/analytics/events.ts`.

---

### Task 2: Client-side `trackEvent` utility

**Files:**
- Create: `src/lib/analytics/trackEvent.ts`

**Interfaces:**
- Consumes: `AnalyticsEventName` (Task 1), `getClientSessionId` from `@/lib/live-presence` (existing).
- Produces: `trackEvent(name: AnalyticsEventName, context?: { complexId?: string | null; aptName?: string | null }): void`.
- Consumed by: Task 4 (`FavoriteButton.tsx`), Task 5 (`useSharePage.ts`).

- [ ] **Step 1: Write the module**

```typescript
// src/lib/analytics/trackEvent.ts
'use client';

import { getClientSessionId } from '@/lib/live-presence';
import type { AnalyticsEventName } from './events';

export interface TrackEventContext {
  complexId?: string | null;
  aptName?: string | null;
}

// 클라이언트 범용 이벤트 트래커. ViewTracker.tsx의 fetch 관례(keepalive, 실패 무시)를
// 그대로 따른다 — 트래킹 실패가 실제 기능(찜/공유)을 절대 막으면 안 된다.
export function trackEvent(name: AnalyticsEventName, context: TrackEventContext = {}): void {
  const sessionId = getClientSessionId();
  if (!sessionId) return;

  fetch('/api/log/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      sessionId,
      complexId: context.complexId ?? null,
      aptName: context.aptName ?? null,
    }),
    keepalive: true,
  }).catch(() => {});
}
```

- [ ] **Step 2: Verify with typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `src/lib/analytics/trackEvent.ts`.

---

### Task 3: `/api/log/event` API route

**Files:**
- Create: `src/app/api/log/event/route.ts`
- Reference (do not modify): `src/app/api/log/view/route.ts` (pattern source)

**Interfaces:**
- Consumes: `isAnalyticsEventName`, `eventUrl` (Task 1), `prisma` from `@/lib/prisma`, `getCurrentUser` from `@/lib/auth-helpers` (all existing).
- Produces: `POST /api/log/event` accepting `{ name: string; sessionId: string; complexId?: string | null; aptName?: string | null }`, always responding 2xx.

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/log/event/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth-helpers';
import { isAnalyticsEventName, eventUrl } from '@/lib/analytics/events';

export const dynamic = 'force-dynamic';

// 범용 커스텀 이벤트 로그. /api/log/view와 동일한 관례(입력 검증/truncate/
// getCurrentUser/무조건 2xx 응답)를 그대로 재사용한다. eventName이 고정
// allow-list(src/lib/analytics/events.ts)에 없으면 DB에 아무것도 쓰지 않고
// 조용히 무시한다 — 임의 이벤트명/URL이 PageView 테이블에 쌓이는 것을 막는
// 유일한 게이트가 이 라우트다.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name: string = (body.name || '').toString();
    const sessionId: string = (body.sessionId || '').toString().slice(0, 100);

    if (!isAnalyticsEventName(name) || !sessionId) {
      return NextResponse.json({ success: true, ignored: true });
    }

    const complexId: string | null = body.complexId ? String(body.complexId).slice(0, 200) : null;
    const aptName: string | null = body.aptName ? String(body.aptName).slice(0, 200) : null;

    const user = await getCurrentUser().catch(() => null);

    await prisma.pageView.create({
      data: { url: eventUrl(name), complexId, aptName, sessionId, userId: user?.id ?? null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // 트래킹 실패가 실제 기능을 막으면 안 되므로 항상 200 계열로 조용히 무시한다.
    console.warn('event log failed', error);
    return NextResponse.json({ success: false });
  }
}
```

- [ ] **Step 2: Verify with typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `src/app/api/log/event/route.ts`.

- [ ] **Step 3: Manual smoke test (dev server)**

Run: `npm run dev` (if not already running), then in a second shell:

```bash
curl -s -X POST http://localhost:3000/api/log/event \
  -H "Content-Type: application/json" \
  -d '{"name":"favorite_add","sessionId":"plan-smoke-test","complexId":"TEST|TEST|테스트단지"}'
```

Expected: `{"success":true}` — and a matching row should exist via `npx prisma studio` (or a one-off `node -e` Prisma query) with `url = "/__event__/favorite_add"`.

Then test the allow-list rejection:

```bash
curl -s -X POST http://localhost:3000/api/log/event \
  -H "Content-Type: application/json" \
  -d '{"name":"totally_made_up","sessionId":"plan-smoke-test"}'
```

Expected: `{"success":true,"ignored":true}` and **no new row** written for this call.

- [ ] **Step 4: Commit**

```bash
git add src/lib/analytics/events.ts src/lib/analytics/trackEvent.ts src/app/api/log/event/route.ts
git commit -m "feat(analytics): add allow-listed event tracker foundation (PageView reuse, no schema change)"
```

---

### Task 4: Instrument `FavoriteButton.tsx`

**Files:**
- Modify: `src/components/FavoriteButton.tsx`

**Interfaces:**
- Consumes: `trackEvent` (Task 2).

- [ ] **Step 1: Add the import**

In `src/components/FavoriteButton.tsx`, after the existing `@/lib/favorites` import block (around line 13), add:

```typescript
import { trackEvent } from '@/lib/analytics/trackEvent';
```

- [ ] **Step 2: Fire the event at the confirmed success point only**

In `handleClick` (current lines 141–153), the `try` block currently reads:

```typescript
    try {
      const res = wasFavorited
        ? await fetch(
            `/api/my/favorites?lawdCd=${encodeURIComponent(lawdCd)}&dong=${encodeURIComponent(dong)}&name=${encodeURIComponent(name)}`,
            { method: 'DELETE' }
          )
        : await fetch('/api/my/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(identity),
          });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'failed');
    } catch {
```

Change it to (only addition is the `trackEvent(...)` line right after the success check — no other logic changes):

```typescript
    try {
      const res = wasFavorited
        ? await fetch(
            `/api/my/favorites?lawdCd=${encodeURIComponent(lawdCd)}&dong=${encodeURIComponent(dong)}&name=${encodeURIComponent(name)}`,
            { method: 'DELETE' }
          )
        : await fetch('/api/my/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(identity),
          });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'failed');
      // ANALYTICS V1 — 서버가 성공을 확인해준 시점에만 기록한다(낙관적 업데이트 시점이 아님).
      trackEvent(wasFavorited ? 'favorite_remove' : 'favorite_add', {
        complexId: `${lawdCd}|${dong}|${name}`,
        aptName: name,
      });
    } catch {
```

This fires exactly once per confirmed server success. The existing `if (pending) return;` guard at the top of `handleClick` (line 128) already prevents double-clicks/duplicate fires — no additional dedup logic is needed.

- [ ] **Step 3: Verify with typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors/warnings for this file.

- [ ] **Step 4: Manual browser QA**

Start `npm run dev`, open an apartment detail page, open the Network tab, filter on `log/event`.
1. Click the favorite button while logged out → login modal opens, **no** `log/event` request (correct — no favorite happened yet).
2. Log in, click favorite (add) → one `POST /api/log/event` with `name: "favorite_add"`, response `{"success":true}`.
3. Click again (remove) → one `POST /api/log/event` with `name: "favorite_remove"`.
4. Double-click rapidly → confirm only one request per actual state change (button is `disabled` while `pending`, so rapid clicks should not produce duplicate requests).

- [ ] **Step 5: Commit**

```bash
git add src/components/FavoriteButton.tsx
git commit -m "feat(analytics): track favorite_add/favorite_remove at confirmed success point"
```

---

### Task 5: Instrument `useSharePage.ts`

**Files:**
- Modify: `src/hooks/useSharePage.ts`

**Interfaces:**
- Consumes: `trackEvent` (Task 2).

- [ ] **Step 1: Add the import**

In `src/hooks/useSharePage.ts`, after the `@/lib/share/shareUtils` import block (line 13), add:

```typescript
import { trackEvent } from '@/lib/analytics/trackEvent';
```

- [ ] **Step 2: Fire events only at genuinely-confirmed points**

The current `share` callback (lines 51–79):

```typescript
  const share = useCallback(async () => {
    const url = buildShareUrl(params);
    if (!url) return;

    const nativeResult = await nativeShare({ title, text, url });
    if (nativeResult === 'shared') {
      setStatus('shared');
      resetSoon();
      return;
    }
    if (nativeResult === 'aborted') {
      // 사용자가 공유 시트를 닫은 정상 취소 — 오류로 처리하지 않는다.
      return;
    }

    if (enableKakao && isKakaoShareReady()) {
      try {
        sendKakaoShare({ title, description: text || title, url, imageUrl: buildKakaoShareImageUrl() });
        setStatus('idle');
        return;
      } catch {
        // 카카오 콘솔에서 "카카오톡 공유" 제품이 비활성화된 경우 등 — 아래 클립보드로 폴백.
      }
    }

    const copied = await copyToClipboard(url);
    setStatus(copied ? 'copied' : 'error');
    resetSoon();
  }, [title, text, params, enableKakao, resetSoon]);
```

Change to (three single-line additions, each right after a point that already genuinely confirms what it claims — no branching logic changes, no UX changes):

```typescript
  const share = useCallback(async () => {
    const url = buildShareUrl(params);
    if (!url) return;

    const nativeResult = await nativeShare({ title, text, url });
    if (nativeResult === 'shared') {
      // ANALYTICS V1 — Web Share API의 promise가 resolve된 시점 = 브라우저가 공유 완료를
      // 확인해준 시점이므로 share_success로 기록한다(과장 아님, 실제 확인 가능).
      trackEvent('share_success');
      setStatus('shared');
      resetSoon();
      return;
    }
    if (nativeResult === 'aborted') {
      // 사용자가 공유 시트를 닫은 정상 취소 — 오류로 처리하지 않는다. 이벤트도 기록하지 않는다.
      return;
    }

    if (enableKakao && isKakaoShareReady()) {
      try {
        sendKakaoShare({ title, description: text || title, url, imageUrl: buildKakaoShareImageUrl() });
        // ANALYTICS V1 — 카카오 SDK는 실제 전송 완료를 알려주는 콜백이 없다(fire-and-forget
        // 팝업 트리거일 뿐). 성공 여부를 신뢰성 있게 판별할 수 없으므로 share_success가
        // 아닌 share_attempt로 기록한다.
        trackEvent('share_attempt');
        setStatus('idle');
        return;
      } catch {
        // 카카오 콘솔에서 "카카오톡 공유" 제품이 비활성화된 경우 등 — 아래 클립보드로 폴백.
      }
    }

    const copied = await copyToClipboard(url);
    if (copied) {
      // ANALYTICS V1 — navigator.clipboard.writeText가 실제로 resolve된 시점(진짜 완료 확인).
      trackEvent('share_success');
    }
    setStatus(copied ? 'copied' : 'error');
    resetSoon();
  }, [title, text, params, enableKakao, resetSoon]);
```

Note: `complexId`/`aptName` are intentionally omitted here — `useSharePage` is a page-agnostic hook shared by apt detail, stats, school, and map pages, and has no apartment-identity concept in its options. Passing `undefined` context is correct; do not add new parameters to `UseSharePageOptions` for this (out of scope, would touch every call site).

- [ ] **Step 3: Verify with typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors/warnings for this file.

- [ ] **Step 4: Manual browser QA**

On a mobile-width viewport (or a device where `navigator.share` exists) open an apt detail page, trigger share, complete it → confirm one `POST /api/log/event` with `name: "share_success"`. On a desktop browser without native share, trigger share via the Kakao path → confirm one request with `name: "share_attempt"`. If Kakao is unavailable, confirm clicking share falls to clipboard copy and fires `share_success` only when `copied === true`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSharePage.ts
git commit -m "feat(analytics): track share_success/share_attempt at genuinely-confirmed points"
```

---

### Task 6: Exclude event rows from admin dashboard aggregations + add event summary

**Files:**
- Modify: `src/app/api/admin/dashboard/route.ts`

**Interfaces:**
- Consumes: `ANALYTICS_EVENT_URL_PREFIX` (Task 1).
- Produces: `data.events` field in the `/api/admin/dashboard` JSON response: `{ name: string; count: number }[]` for the last 7 days.

- [ ] **Step 1: Add the import**

At the top of `src/app/api/admin/dashboard/route.ts`, after the existing imports (line 7), add:

```typescript
import { ANALYTICS_EVENT_URL_PREFIX } from '@/lib/analytics/events';
```

- [ ] **Step 2: Exclude event rows from the three existing PageView aggregations**

Current (lines 100–117):

```typescript
      prisma.pageView.count({ where: { createdAt: { gte: today } } }),
      prisma.pageView.findMany({ where: { createdAt: { gte: today } }, select: { sessionId: true }, distinct: ['sessionId'] }),
      prisma.activeSession.findMany({ where: { lastSeenAt: { gte: onlineThreshold } } }),
      prisma.activeSession.groupBy({
        by: ['currentAptName'],
        where: { lastSeenAt: { gte: onlineThreshold }, currentAptName: { not: null } },
        _count: { currentAptName: true },
        orderBy: { _count: { currentAptName: 'desc' } },
        take: 10,
      }),
      prisma.pageView.groupBy({
        by: ['aptName'],
        where: { createdAt: { gte: thirtyDaysAgo }, aptName: { not: null } },
        _count: { aptName: true },
        orderBy: { _count: { aptName: 'desc' } },
        take: 10,
      }),
```

Change the two `prisma.pageView` calls that read "real" traffic (count + unique sessions) and the `popularAptGroups` groupBy to exclude the reserved event namespace:

```typescript
      prisma.pageView.count({
        where: { createdAt: { gte: today }, url: { not: { startsWith: ANALYTICS_EVENT_URL_PREFIX } } },
      }),
      prisma.pageView.findMany({
        where: { createdAt: { gte: today }, url: { not: { startsWith: ANALYTICS_EVENT_URL_PREFIX } } },
        select: { sessionId: true },
        distinct: ['sessionId'],
      }),
      prisma.activeSession.findMany({ where: { lastSeenAt: { gte: onlineThreshold } } }),
      prisma.activeSession.groupBy({
        by: ['currentAptName'],
        where: { lastSeenAt: { gte: onlineThreshold }, currentAptName: { not: null } },
        _count: { currentAptName: true },
        orderBy: { _count: { currentAptName: 'desc' } },
        take: 10,
      }),
      prisma.pageView.groupBy({
        by: ['aptName'],
        where: {
          createdAt: { gte: thirtyDaysAgo },
          aptName: { not: null },
          url: { not: { startsWith: ANALYTICS_EVENT_URL_PREFIX } },
        },
        _count: { aptName: true },
        orderBy: { _count: { aptName: 'desc' } },
        take: 10,
      }),
```

(`activeSession` queries are untouched — presence/heartbeat data never goes through `trackEvent`, so no exclusion is needed there.)

- [ ] **Step 3: Add the new 7-day event aggregation to the `Promise.all` array**

In the same `Promise.all([...])` (starts at line 100), add one more query. After the `checkPipelineHealth()` entry (line 132) in the destructured array (line 85–99), add `eventCounts` to both the destructuring list and the array of promises:

Destructuring (lines 85–99) — add `eventCounts` after `recentErrors`:

```typescript
    const [
      todayPageViews,
      todayUniqueSessions,
      onlineSessions,
      onlineAptGroups,
      popularAptGroups,
      todayNewUsers,
      totalUsers,
      recentSearches,
      todayNewPosts,
      todayNewComments,
      recentPosts,
      unresolvedReports,
      recentErrors,
      eventCounts,
      pipelineHealth,
    ] = await Promise.all([
```

Promise array — add this entry right before `checkPipelineHealth()`:

```typescript
      prisma.pageView.groupBy({
        by: ['url'],
        where: { createdAt: { gte: sevenDaysAgo }, url: { startsWith: ANALYTICS_EVENT_URL_PREFIX } },
        _count: { url: true },
        orderBy: { _count: { url: 'desc' } },
      }),
      checkPipelineHealth(),
```

- [ ] **Step 4: Map `eventCounts` into the response payload**

In the `NextResponse.json({...})` body (lines 151–178), add an `events` field. Change:

```typescript
        pipeline: pipelineHealth,
        errors: recentErrors,
      },
    });
```

to:

```typescript
        pipeline: pipelineHealth,
        errors: recentErrors,
        events: eventCounts.map((e) => ({
          name: e.url.slice(ANALYTICS_EVENT_URL_PREFIX.length),
          count: e._count.url,
        })),
      },
    });
```

- [ ] **Step 5: Verify with typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors/warnings for this file.

- [ ] **Step 6: Regression QA — prove event rows are excluded from existing metrics**

With the dev server running and at least one `favorite_add`/`share_success` event already fired (from Tasks 4/5 QA):
1. Note the admin dashboard's `traffic.todayPageViews` and `traffic.todayUniqueVisitors` values (call `GET /api/admin/dashboard` as an admin session, or view `/admin/dashboard`).
2. Trigger 3 more favorite/share events.
3. Re-check `traffic.todayPageViews` / `traffic.todayUniqueVisitors` — **must be unchanged** by the 3 new events (only a real page navigation should move these numbers).
4. Confirm `apartments.popular30d` does not contain any entry whose `aptName` only ever appeared via a `favorite_add` event on an apartment you did not actually navigate to.
5. Confirm the new `data.events` array now shows the incremented counts for `favorite_add`/`favorite_remove`/`share_success`/`share_attempt`.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/dashboard/route.ts
git commit -m "feat(analytics): exclude event rows from PV/visitor/popular-apt metrics, add 7-day event summary"
```

---

### Task 7: STEP documentation + CHANGELOG

**Files:**
- Create: `docs/development/ANALYTICS_V1_EVENT_TRACKING_FOUNDATION.md`
- Modify: `docs/development/CHANGELOG.md` (append entry; do not rewrite existing entries)

**Interfaces:** None (documentation only).

- [ ] **Step 1: Write the STEP doc**

Follow this project's established STEP doc structure (목적/현재상태/분석/설계결정/구현내용/테스트결과/알려진문제/다음STEP). Content to include (fill in real values — file paths, actual QA results from Tasks 3–6 — no placeholders):

- **목적:** Analytics V1 — 범용 커스텀 이벤트(클릭/필터/즐겨찾기/공유 등)를 DB schema 변경 없이 기록할 수 있는 기반을 만든다.
- **현재상태(작업 전):** `PageView`/`SearchLog`/`ActiveSession`은 이미 존재하지만 페이지뷰/세션 전용이며, 범용 커스텀 이벤트를 위한 필드/테이블은 없었다.
- **분석:** 기존 4개 트래킹 테이블 모두 admin dashboard의 특정 지표에 1:1로 연결돼 있어, 새 컬럼 없이 재사용하면 기존 지표(오늘 PV, 검색어 TOP10, 에러/신고 건수)가 오염될 위험이 있었다 — `PageView.url`을 예약된 네임스페이스(`/__event__/`)로 분리하고 집계 쿼리에서 명시적으로 제외하는 방식으로 해결.
- **설계 결정:** (이 설계는 사용자 승인 완료 — 대화 로그의 승인 시점 명시) PageView 재활용 + 예약 URL prefix, 고정 eventName allow-list, `favorite_add`/`favorite_remove`는 서버 확인 성공 시점에만 기록, share는 `share_success`(Web Share API/클립보드 confirm) vs `share_attempt`(카카오 SDK, 확인 불가)로 분리, V1은 임시 저장 전략이며 V2에서 전용 Event 테이블로 이전 가능하도록 저장 백엔드를 3개 파일(`events.ts`/`trackEvent.ts`/`api/log/event/route.ts`)에만 격리.
- **구현내용:** Task 1–6에서 만든/수정한 정확한 파일 목록과 각각의 책임.
- **테스트 결과:** Task 3/4/5/6에서 실행한 실제 명령과 실제 결과(값은 실행 후 채울 것 — 절대 "PASS 예상" 같은 표현 금지, 실제 실행 결과만).
- **알려진 문제:** (a) `KakaoShareButton.tsx`의 3개 별도 호출부(아파트 상세/StickyActionBar/학교 상세)는 `useSharePage`를 쓰지 않아 이번 V1 계측 범위에 포함되지 않음 — 필요시 V1.1에서 별도 계측. (b) 이벤트당 props 확장이 필요해지면 스키마 변경(승인 필요)이 불가피함. (c) 이 저장소에는 자동화 테스트 러너가 없어 검증은 타입체크/린트/빌드/수동 QA로 대체함(기존 프로젝트 관행과 동일).
- **다음 STEP:** 검색결과 클릭/지도 마커/비교/필터/통계→상세 등으로 계측 확장, 필요 시 Analytics V2에서 전용 Event 테이블로 마이그레이션.

- [ ] **Step 2: Append CHANGELOG entry**

Add one entry to `docs/development/CHANGELOG.md` (matching its existing entry format/style — read the last few entries first to match style exactly) describing this change in 1–3 lines, dated 2026-08-29, branch `feature/analytics-v1`.

- [ ] **Step 3: Commit**

```bash
git add docs/development/ANALYTICS_V1_EVENT_TRACKING_FOUNDATION.md docs/development/CHANGELOG.md
git commit -m "docs(analytics): record Analytics V1 event tracking foundation STEP"
```

---

### Task 8: Final full verification + push

**Files:** None (verification only).

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors (or only pre-existing unrelated errors — if any appear, confirm via `git stash` + re-run that they predate this branch's changes before proceeding, per this project's `FAIL_EXISTING_SCRIPT_ERRORS` convention).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 errors on changed files.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Re-confirm branch safety**

Run: `git branch --show-current`
Expected: `feature/analytics-v1` (never proceed to push if this shows `main`).

- [ ] **Step 5: Push**

```bash
git push origin feature/analytics-v1
```

Do **not** push, merge, or checkout `main`. Do not touch `D:\anti2\aaa\real-estate-app` or `D:\anti2\aaa\real-estate-app-work2`.

- [ ] **Step 6: Final report**

Summarize: files changed, exact verification commands run with their real exit results, the regression-QA outcome from Task 6 Step 6 (proof that `todayPageViews`/`todayUniqueVisitors`/`popular30d` are unaffected by events), known limitations (Task 7's 알려진 문제 section), and the commit hashes pushed.
