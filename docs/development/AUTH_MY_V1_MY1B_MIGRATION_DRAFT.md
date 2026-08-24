# AUTH/MY V1 — MY-1B: MIGRATION DRAFT & STATIC SAFETY VALIDATION

## 1. Baseline
- **Branch**: `feature/auth-my-v1`
- **HEAD**: `c000d5c docs(auth): finalize apartment identity and analytics compatibility`

## 2. Prisma Schema Changes
The following models were added, and relations were appended to the `User` model:

### A. Favorites
```prisma
model Favorite {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  lawdCd    String   @map("lawd_cd")
  dong      String
  name      String
  aptSeq    String?  @map("apt_seq")
  address   String?
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, lawdCd, dong, name])
  @@index([userId, createdAt(desc)])
  @@map("favorites")
}
```

### B. Recent Views
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

### C. User Preferences
```prisma
model UserPreference {
  userId    String   @id @map("user_id")
  purposes  Json     @default("[]")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_preferences")
}
```

### D. User Relation Update
```prisma
model User {
  // ... existing fields ...
  favorites      Favorite[]
  recentViews    RecentView[]
  userPreference UserPreference?
  // ...
}
```

## 3. Address and aptSeq Policy
- **Address Decision**: Retained as a nullable field (`String?`). It acts as a UI display snapshot to render favorite/recent lists without requiring external geocoding or complex joins.
- **aptSeq Policy**: Retained as a nullable field (`String?`). The application layer will attempt an exact resolution during sync. No fuzzy matches will be stored in this column.

## 4. Generated Migration SQL Summary
Generated offline via `prisma migrate diff`:
- **CREATE TABLE**: `favorites`, `recent_views`, `user_preferences`
- **CREATE INDEX**: 4 indexes created on `createdAt`, `viewedAt`, and `UNIQUE` on `(userId, lawdCd, dong, name)`.
- **ALTER TABLE**: 3 `ADD CONSTRAINT` for `FOREIGN KEY` (Cascade deletes on `userId`).
- **DROP / DELETE / UPDATE**: **NONE**. No destructive operations.
- **EXISTING TABLE PHYSICAL IMPACT**: **NONE**. Existing tables (`users`, `accounts`, etc.) are unaffected at the DB schema level.

## 5. Validation Results
- `npx prisma validate`: **PASS** (`The schema at prisma\schema.prisma is valid`)
- `npx prisma generate`: **PASS** (Client types updated successfully)
- `npx tsc --noEmit`: **PASS**
- `npm run lint`: **PASS**
- **Production DB Access**: **NONE** (Zero production reads or writes).

## 6. Security
- No PII columns added (phone, birth, etc. excluded).
- No hardcoded secrets or tokens in migration files.
- `ON DELETE CASCADE` is set on the new tables, meaning user deletion seamlessly cleans up their preferences/favorites without leaving orphans.

## 7. Rollback Policy
- **PRE-USE ROLLBACK**: If deployed but not yet used by users, rolling back requires a simple SQL script: `DROP TABLE "favorites", "recent_views", "user_preferences";`.
- **POST-USE ROLLBACK**: Once users populate data, dropping tables directly is forbidden. The feature should be disabled via UI/Feature Flag, and data should be backed up before any schema teardown is executed.

## 8. Production Apply Plan (Draft)
Do not execute until approved.
```bash
# 1. Execute migration against production
npx prisma db push --accept-data-loss
# OR via migrate deploy (if using Prisma Migrate folder structure)
npx prisma migrate deploy
```
*(Note: Since this is an additive change, `db push` or standard deployment pipelines will not risk existing data.)*

## 9. Verification Plan (Post-Deploy)
After applying to the production database:
1. Ensure the 3 new tables exist.
2. Confirm row counts for the new tables equal `0`.
3. Check `User` records are completely intact.
4. Verify the application build and deployments run successfully.

---

### DB APPROVAL REQUEST
A complete, safe, and additive schema draft has been validated. 
**Requesting PM approval to proceed to MY-1C (Apply & Verify).**
