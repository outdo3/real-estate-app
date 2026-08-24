# AUTH/MY V1 — MY-1A.1: CANONICAL APARTMENT IDENTITY & ANALYTICS COMPATIBILITY GATE

## 1. Baseline
- **Branch**: `feature/auth-my-v1`
- **HEAD**: `8a52a85 docs(auth): design my v1 account data schema`

## 2. Canonical Apartment Identity Assessment

### 2.1 Master Identity Candidates
- **`Apartment.id` (Auto-increment)**: Legacy caching table, covers ~20 apartments. Not a master list. **(REJECTED)**
- **`ApartmentMaster.id` (Auto-increment)**: Rebuilt periodically via batch jobs. Internal PK is unstable. **(REJECTED)**
- **`aptSeq` (MOLIT {lawdCd}-{seq})**: Stable external government identifier. However, it is `nullable` (some properties lack MOLIT history) and is not fully integrated into the live app routing (`/api/apt/[name]`). **(PARTIALLY ACCEPTED)**
- **`(lawdCd, dong, name)`**: The current composite string identity used by local storage and URL routing. Susceptible to rename/spacing collisions ("대신 더샵" vs "대신더샵"), but accurately reflects the current application fallback logic. **(REQUIRED)**

### 2.2 FK Decision
**Strict database Foreign Keys to `Apartment` or `ApartmentMaster` are REJECTED.**
- `Apartment` is incomplete.
- `ApartmentMaster` gets rebuilt (IDs change) and `aptSeq` is nullable. Enforcing an FK would block users from interacting with valid apartments that are not yet successfully matched in the master table.

### 2.3 Final Identity Strategy
Use the composite string `(lawdCd, dong, name)` as the primary relationship key to match current routing, but add `aptSeq` as a nullable field for future-proofing and analytics bridging.

## 3. Final Schema Proposal

### A. Favorites (`favorites`)
```prisma
model Favorite {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  lawdCd    String   @map("lawd_cd")
  dong      String
  name      String
  aptSeq    String?  @map("apt_seq") // Resolution for future analytics/master integration
  address   String?  // UI Display Cache
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, lawdCd, dong, name])
  @@index([userId, createdAt(desc)])
  @@map("favorites")
}
```

### B. Recent Views (`recent_views`)
```prisma
model RecentView {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  lawdCd    String   @map("lawd_cd")
  dong      String
  name      String
  aptSeq    String?  @map("apt_seq")
  address   String?
  viewedAt  DateTime @default(now()) @map("viewed_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, lawdCd, dong, name])
  @@index([userId, viewedAt(desc)])
  @@map("recent_views")
}
```

### C. User Preferences (`user_preferences`)
```prisma
model UserPreference {
  userId    String   @id @map("user_id")
  purposes  Json     @default("[]")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_preferences")
}
```

## 4. LocalStorage Sync & Identity Resolution
When merging `ejip:recentApartments` (which only contains `name, address, lawdCd, dong, visitedAt`) to the server:
- The server will accept the payload.
- The server will perform a strict point-in-time lookup against `ApartmentMaster` using the provided keys to attempt `aptSeq` resolution.
- If an exact match is found, `aptSeq` is saved. If not, `aptSeq` is left `null` but the row is still saved. **No fuzzy matching is allowed to prevent redirecting users to the wrong apartment.**

## 5. Analytics Compatibility Gate

### 5.1 Separation of Concerns
- `recent_views` and `favorites` represent the **current state** of the user's account (e.g., max 20 recent items). They are **NOT** analytics logs.
- Future analytics will use an isolated `analytics_events` table designed as an append-only time-series ledger.

### 5.2 Identity Stitching Strategy
- **`anonymousId`**: Persistent device-level UUID (stored via cookie/localStorage).
- **`sessionId`**: Ephemeral UUID.
- **`userId`**: Authenticated account ID.
- **Journey Connection**: When an anonymous user logs in, the `analytics_events` table (or resolution layer) will map their `anonymousId` to their `userId`. This satisfies the requirement to track a journey like: `anonymous visit -> search -> favorite click -> login -> favorite success`.

### 5.3 Privacy & Security constraints for Analytics
- PII, passwords, OAuth tokens, and sensitive headers MUST NOT be stored in event payloads.
- Free-text search queries will require sanitization guidelines before storage to prevent accidental PII leaks.

## 6. Migration Risk Assessment
- **Migration Type**: ADDITIVE (Only creating 3 new tables).
- **Existing Table Alterations**: NONE.
- **Data Backfill**: NONE.
- **Production Write Risk**: NONE (Current step is design only).
- **Rollback**: Drop `favorites`, `recent_views`, `user_preferences`.
- **Overall DB Risk**: **LOW**.

---
### FINAL REPORT SUMMARY
- **CANONICAL_APARTMENT_ID**: `(lawdCd, dong, name)` + optional `aptSeq`.
- **COMPOSITE_NAME_IDENTITY**: REQUIRED (Due to current routing architecture).
- **ANALYTICS_COMPATIBLE**: YES
- **USER_JOURNEY_TRACKING_READY**: YES
- **NEW_TABLES**: 3
- **EXISTING_TABLE_ALTER**: NO
- **MIGRATION_TYPE**: ADDITIVE
- **DB_RISK**: LOW
- **MY1A1_STATUS**: PASS
- **DB_APPROVAL_READY**: YES
