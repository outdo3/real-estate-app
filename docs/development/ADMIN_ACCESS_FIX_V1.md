# ADMIN ACCESS FIX V1 — Owner Admin Access + Admin UX

Status: **Code complete and deployed; one operator action remains (`ADMIN_EMAIL` env value).**
Cross-links: [Admin Ops V1.2](./ADMIN_OPS_V1_2_EVIDENCE_CORRECTION.md),
[Data Freshness Automation V1 Phase 2](./DATA_FRESHNESS_AUTOMATION_V1_PHASE2.md).

## 1. Symptom

Every `/admin/*` route redirected to the home page. The operator had never seen an admin screen.

## 2. Root cause (two independent faults)

**Fault A — nobody is an admin.** `src/proxy.ts` (Next.js 16 middleware, matcher
`/admin/:path*`) admits a request only if `role === 'ADMIN'` **or** the login email equals
`process.env.ADMIN_EMAIL`. Measured on production:

```
total users : 5     roles: USER 5,  ADMIN 0     users with email: 2
ADMIN_EMAIL : NOT SET in Vercel Production (17 env vars, none named ADMIN_*)
```

Both branches were therefore false for every user, so everyone was redirected to `/`. This is a
bootstrap deadlock, not a bug in the guard: the deployment never had a first admin.

**Fault B — the page gate disagreed with the API gate.** Even once Fault A is fixed, the admin
pages would still have appeared empty. Three places judged "is this an admin", and one differed:

| Location | Rule |
|---|---|
| `requireAdmin()` (API) | `role === 'ADMIN' \|\| email === ADMIN_EMAIL` |
| `src/proxy.ts` (route gate) | same rule, **duplicated** |
| `src/app/admin/*/page.tsx` | `role === 'ADMIN'` **only** ← inconsistent |

An operator bootstrapped via `ADMIN_EMAIL` would pass the proxy and the API but the page component
would judge itself non-admin, so its SWR key stayed `null`, no request was ever made, and the
screen rendered "관리자만 접근할 수 있는 페이지입니다."

## 3. Chosen approach

Priority **A** from the task: reuse the existing `ADMIN_EMAIL` allowlist. No schema change, no DB
write, no new mechanism. The email is never hardcoded and stays server-only.

The judgement now lives in exactly one place, `src/lib/admin-access.ts`
(`isAdminSessionUser` / `isAdminByEnvEmail`), imported by the proxy, `auth-helpers`, and the
session callback. It imports nothing, which both avoids a circular import
(`auth.ts` ↔ `auth-helpers.ts`) and keeps it safe for the proxy runtime.

`auth.ts`'s session callback computes the result server-side and exposes **one boolean**,
`session.user.isAdmin`. The admin email list itself never reaches the client bundle. Because the
session callback re-derives it from the token on every request, setting `ADMIN_EMAIL` takes effect
**without requiring the operator to log out and back in** — unlike the JWT-baked `role`.

Admin pages now read `session.user.isAdmin`. This is for UI only; the proxy and `requireAdmin()`
still enforce access server-side, so a tampered client gains nothing.

## 4. Access UX

Previously every failure redirected to `/`, so the operator could not tell "not logged in" from
"no permission". Now:

| Case | Behavior |
|---|---|
| Unauthenticated | redirect to `/my`, which is already wrapped in `AuthGate` and auto-opens the login modal |
| Authenticated, non-admin | redirect to `/` — **unchanged**, so the existence of admin routes is still not disclosed |
| Admin | the admin page renders |

The non-disclosure property is preserved: an unauthenticated visitor only learns their own auth
state, which they already know. No new UI was built — the existing login path is reused.

## 5. Admin navigation

An admin menu already existed in `/my` but was gated on the broken check and split across two
sections (3 links in one, 회원 관리 in another). Rather than duplicating it, it was consolidated
into a single **관리자** entry → `/admin/dashboard`, which is now the admin home and carries a nav
to 운영 현황 (`/admin/ops`), 사용자 행동 (`/admin/behavior`), 사용자 관리 (`/admin/users`).
Decorative emoji were replaced with `lucide-react` icons per the project UI rules, and the nav is
mobile-first (wraps at 360px, 44px touch targets, design tokens rather than hardcoded colors).

Ordinary users render none of this.

## 6. /admin/ops truthfulness

`/admin/ops` showed sale sync state from the git-tracked file manifest only — a stale CLI QA record
(3 cells, 132 rows) that the Cron path never writes. After the Phase 2 sale apply (377 rows) the
screen would still have implied nothing had happened. Both sale and rent sections now additionally
render **live DB coverage** from `sync_coverage_cells`, with the file-based numbers explicitly
labeled as a past CLI record. Verified in a browser against real data:

- SALE — scheduler `OFF`; 동기화 coverage(DB) **48 cells, COMPLETE 48**, last verified 2026-09-03;
  Busan rows 855,424; latest deal 2026-09-02; aptSeq-missing 0.
- RENT — scheduler `OFF`; 동기화 coverage(DB) **0 cells** with an honest note; verified range
  **202408–202608**; legacy bootstrap shown; the "no cancellation field in source" warning intact.

No new schema was added.

## 7. Verification

Unit tests (`src/lib/admin-access.test.mjs`, 9/9): role path, env-email path, case/whitespace
insensitivity, and fail-closed boundaries — unset `ADMIN_EMAIL`, **empty-string** `ADMIN_EMAIL`
(must not make everyone admin), null/missing email, and null session.

Behavioral tests against a local dev server, using minted NextAuth JWTs:

| Case | `/admin/*` result |
|---|---|
| Unauthenticated | 307 → `/my` (all four routes + an unknown `/admin/*` path) |
| `role=USER`, unrelated email | 307 → `/` |
| `role=USER`, email matches `ADMIN_EMAIL` | **200**, and the denial message is absent |
| `role=ADMIN` | **200** on all four routes |
| `role=USER`, owner email, but `ADMIN_EMAIL` unset | 307 → `/` (fail-closed) |

`/api/auth/session` returns `isAdmin: true` for both admin paths and `false` for an ordinary user.
Browser QA confirmed the 관리자 menu appears for an env-bootstrapped admin (whose role badge still
honestly reads 일반회원), is absent for ordinary users, and that dashboard/ops render real data.

Full sweep: **368/371** logic tests pass; the 3 failures are pre-existing and unrelated
(extensionless-import constraint in `master-coverage-sync-logic`,
`repair-recent-missing-masters-logic`, `trade-history-read`). `npx tsc --noEmit`: **0 errors in
`src/`** (24 total = 20 pre-existing + 4 in the user's untracked `tmp/` scripts).
`npm run build`: exit 0. `eslint` on changed paths: 0 errors (1 pre-existing warning in `auth.ts`
unrelated to this change).

## 8. Remaining operator action

Set `ADMIN_EMAIL` in Vercel **Production** to the operator's actual login email, then open
`/my` → 관리자. No redeploy or re-login is required for the value to take effect.

Caveat worth knowing: only **2 of 5** production users have an email at all — some social logins
do not return one. If the operator's account has no email, the env path cannot match and the
fallback is to promote that user's `role` to `ADMIN` in the database (a data update, which needs
its own approval).
