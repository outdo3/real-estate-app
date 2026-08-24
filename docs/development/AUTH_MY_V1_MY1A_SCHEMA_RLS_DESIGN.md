# AUTH/MY V1 — MY-1A: ACCOUNT DATA SCHEMA & RLS DESIGN

## 1. Baseline
- **Branch**: `feature/auth-my-v1`
- **HEAD**: `476eaed docs(auth): audit current auth and my architecture`

## 2. DB/ORM Architecture & Current User Model
- **ORM**: Prisma (`schema.prisma`) connected to a Supabase PostgreSQL instance.
- **Auth Provider**: NextAuth (No Supabase Auth).
- **Existing User Model**:
  - `id String @id @default(cuid())`
  - `email String? @unique`
  - `name String @map("nickname")`
  - `image String? @map("avatar_url")`
  - `role Role @default(USER)`
  - `banned Boolean @default(false)`
- **RLS Status**: Because the application uses NextAuth and Prisma server-side, Supabase RLS `auth.uid()` is NOT natively populated in the DB connection. All authorization must be handled at the **application level (Server Actions / API Routes)** using the existing `requireUser()` helper from `src/lib/auth-helpers.ts`.

## 3. Canonical Apartment Identity
- **Investigation Result**: The current local storage (`recent-apartments.ts`) and UI routing (`/apt/[name]?lawdCd=..&dong=..`) use a combination of `name`, `lawdCd`, and `dong` to identify an apartment. 
- **Decision**: Do NOT use a strict Foreign Key to `Apartment` or `ApartmentMaster`. Instead, use `(lawdCd, dong, name)` as loose canonical string identifiers. This ensures favorites and recent views do not break if background apartment metadata is deleted or rebuilt.

## 4. Proposed Schemas

### A. Favorites (`favorites`)
Allows users to save their interested apartments.
```prisma
model Favorite {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  lawdCd    String   @map("lawd_cd")
  dong      String
  name      String
  address   String?  // UI 표시용 캐시 (JOIN 방지)
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, lawdCd, dong, name])
  @@index([userId, createdAt(desc)])
  @@map("favorites")
}
```

### B. Recent Views (`recent_views`)
Stores the user's recently viewed apartments across devices.
```prisma
model RecentView {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  lawdCd    String   @map("lawd_cd")
  dong      String
  name      String
  address   String?  // UI 표시용 캐시
  viewedAt  DateTime @default(now()) @map("viewed_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, lawdCd, dong, name])
  @@index([userId, viewedAt(desc)])
  @@map("recent_views")
}
```

### C. User Preferences (`user_preferences`)
Stores the user's explicit goals and future personalization settings.
```prisma
model UserPreference {
  userId    String   @id @map("user_id") // 1:1 관계
  purposes  Json     @default("[]")      // 예: ["BUY", "JEONSE"]
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_preferences")
}
```
**Decision**: A single JSON column for `purposes` is chosen over junction tables or boolean columns. It is highly scalable for V1, easy to query and mutate via Prisma, and prevents schema bloat.

## 5. Profile Table Decision
- **Decision**: **NOT NEEDED**. The existing `users` table already stores `nickname`, `email`, and `avatar_url`. No additional PII (Phone, Address, etc.) is required for V1. We will NOT create a separate `profiles` table.

## 6. Compare List Schema Decision
- **Decision**: **DEFER (YAGNI)**. The current compare feature (`CompareView`) is ephemeral UI state. Adding a schema for saving compare lists introduces unnecessary complexity for MY V1. We will evaluate this after V1 is stabilized.

## 7. RLS / Server Authorization Contract
Since Prisma connects via a single service role/connection pool and NextAuth handles sessions:
- Client MUST NOT send `userId` in API bodies.
- Server APIs MUST use `const { user, status, error } = await requireUser();` to resolve the actor.
- Prisma queries MUST strictly filter by `where: { userId: user.id }`.

## 8. Local → Account Merge Policy (Recent Views)
- **Trigger**: Called via POST `/api/my/recent/sync` upon initial app load if the user is authenticated, or right after login.
- **Rule**:
  - The client sends its `localStorage` array of recent items.
  - The server performs an **upsert** (by `userId, lawdCd, dong, name`), updating `viewedAt` if the local `visitedAt` is newer than the DB `viewedAt`.
  - The server deletes rows for the user beyond a **retention limit (20 items)** to prevent infinite growth.
  - The server returns the merged list back to the client. The client overwrites `localStorage` with the server's truth.

## 9. Favorite Login Transition UX
- Handled at the application level using `AuthGate` / `LoginModal`.
- Clicking "Save Favorite" while logged out triggers the modal with `callbackUrl` set to the current apartment detail page. After successful OAuth, the user is redirected back, maintaining their context to complete the action.

## 10. API Contracts Draft

### Favorites
- **GET** `/api/my/favorites`: Returns `{ success: true, data: Favorite[] }`
- **POST** `/api/my/favorites`: Body `{ lawdCd, dong, name, address }`. Toggles favorite (creates if not exists, deletes if exists).

### Recent Views
- **GET** `/api/my/recent`: Returns `{ success: true, data: RecentView[] }`
- **POST** `/api/my/recent/sync`: Body `{ localItems: RecentApartment[] }`. Upserts items and returns merged Top 20 list.

### Preferences
- **GET** `/api/my/preferences`: Returns `{ success: true, data: { purposes: string[] } }`
- **PUT** `/api/my/preferences`: Body `{ purposes: string[] }`. Updates preferences.

## 11. Security Checklist
- [x] Session Server-side Verification (`requireUser`)
- [x] Client `userId` trust explicitly forbidden.
- [x] PII Minimization (No extra phone/address collected).
- [x] Prisma handles SQL Injection automatically.
- [x] Data retention limits applied on sync (Max 20 recent views).

## 12. Migration Risk & Type
- **Migration Type**: **ADDITIVE ONLY**.
- **Existing Table Alter**: NO existing tables (e.g., `users`, `accounts`) are modified except for Prisma model relation references (which don't alter the actual SQL table structure).
- **Production Data Write**: NO backfill required.
- **Rollback**: Simply drop the three new tables.
- **DB Risk**: **LOW**.

## 13. Implementation Roadmap Update
- **MY-1B (Next)**: Execute Prisma schema update & DB Migration.
- **MY-2**: Implement Favorites API and UI.
- **MY-3**: Implement Recent Views Local/Account Sync API and UI.
- **MY-4**: Implement Preferences API and MY Shell UI.
- **MY-5**: Final QA and deployment.

---

### APPROVAL POINTS (For PM)
A. **New Tables**: 3 (`favorites`, `recent_views`, `user_preferences`)
B. **Existing Table Alter**: NO
C. **Migration Type**: ADDITIVE
D. **Production Data Write**: NO
E. **Rollback Method**: Safe drop of the 3 new tables.
F. **Expected Risk**: LOW
