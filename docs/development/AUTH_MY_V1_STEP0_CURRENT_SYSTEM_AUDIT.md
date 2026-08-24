# AUTH/MY V1 STEP 0: CURRENT SYSTEM AUDIT

## 1. Baseline
- **Branch**: `main` (feature branch `feature/auth-my-v1` created from `main`)
- **HEAD**: `2adebb7 docs(score-v2): add production release documentation`
- **Status**: Clean working tree.

## 2. Existing Auth Status
- **NextAuth** is being used (`@next-auth/prisma-adapter`).
- Providers implemented: **Kakao OAuth**, **Naver OAuth** (Custom provider).
- Authentication files are located at `src/lib/auth.ts`, `src/lib/auth-helpers.ts`, and `src/app/api/auth/[...nextauth]/route.ts`.
- `AuthGate.tsx` and `LoginModal.tsx` components are used for seamless popup login.

## 3. Supabase Auth Status
- **NONE**. Supabase Auth is not being used. The project uses NextAuth for authentication and Supabase is only used as a PostgreSQL database provider.

## 4. Existing User/Profile Tables
Found in `prisma/schema.prisma`:
- `users`: Contains `id`, `email`, `email_verified`, `nickname`, `avatar_url`, `role` (GUEST, USER, VERIFIED, ADMIN), `banned`, `created_at`.
- `accounts`: Standard NextAuth OAuth accounts table.
- `sessions`: Standard NextAuth sessions table.
- **NONE**: No `profiles`, `user_profiles`, `favorites`, `bookmarks`, `recent_views`, `comparisons`, `saved_searches`, `preferences`, `purposes` tables exist.

## 5. Current MY Route/UI
- **Route**: `/my` exists and displays profile information (`nickname`, `email`, `role`, `avatar_url`).
- **UI Elements**: Links to Community, New Post, Admin Dashboard (conditionally), Terms, Privacy, and a Logout button.
- **Navigation**: "MY" is in the `BottomNav.tsx` (using `Lucide User` icon).

## 6. Local Storage
- `ejip:recentApartments`: Stores up to 8 recently viewed apartments. Information saved includes `name`, `address`, `lawdCd`, `dong`, `visitedAt`.
- **Favorites/Compare**: No local storage implementation found for favorites or persistent compare lists. The existing compare feature in `/stats/compare` is an ephemeral React state.

## 7. Product Principles
- **Non-login users** must be able to explore the home, search, map, apartment details, real transaction prices, scores, schools, statistics, and basic comparison without forced login.
- **Login-value actions** (e.g., saving favorites, syncing recent views, saving compare lists, personalized purposes/regions) will trigger the login flow.

## 8. Minimum Profile Fields
Based on privacy minimization:
- **Required**: Name/Nickname (already collected via OAuth as `nickname`), Email (if provided by OAuth).
- **Not Required Initially**: Phone, Birth Year, Gender, Address.

## 9. Login Method Recommendation
- **Kakao & Naver OAuth** (Already implemented and functional).
- These are highly suitable for Korean real estate apps and have low friction. Expanding to other methods (e.g., Email/Password) is unnecessary for V1.

## 10. Login Transition UX
- If a user attempts a login-required action (e.g., clicking 'Save Favorite'), the existing `LoginModal` (via `AuthGate`) should pop up.
- After login, the user should remain on the same page and the originally intended action should be resumed if possible (using `callbackUrl`).

## 11. MY IA
Proposed Information Architecture for MY V1:
- **Top**: Profile summary (Nickname, Role, Avatar) and Login/Logout.
- **Sections**:
  - Favorites (관심단지)
  - Recent Views (최근 본 단지)
  - Compare List (비교 중인 단지)
  - Preferences (관심 목적/지역)

## 12. Local → Account Merge Policy
- **Recent Views**: On login, merge `ejip:recentApartments` from `localStorage` with the account's DB recent views. Deduplicate by `name+dong`, keeping the most recent `visitedAt`.
- **Favorites/Compare**: Since there is no local storage for these yet, no merge policy is required.

## 13. Security Findings
- NextAuth is safely implemented with server-side checks (`getCurrentUser`, `requireUser`, `requireAdmin` in `auth-helpers.ts`).
- No Service Role Key exposed to the client. Session strategy uses JWT.
- `AuthGate` handles client-side protection effectively without exposing sensitive data.

## 14. DB/Schema Changes Required
- **REQUIRED**: `favorites` or `bookmarks` table to store user-liked apartments.
- **REQUIRED**: `recent_views` table to sync cross-device recently viewed apartments.
- **REQUIRED**: `user_preferences` or `user_purposes` for storing interest purposes.
- **OPTIONAL**: `compare_sets` for saving compare lists.

## 15. P0/P1/P2 Scope
- **P0**: DB schema for Favorites and Recent Views, UI for Favorites button, MY shell update.
- **P1**: Local Storage to DB merge for Recent Views, Preferences (Purpose/Region) schema and UI.
- **P2**: Persistent Compare List save functionality, Personalized Score extensions.

## 16. Implementation Steps
- **MY-1 (Schema & DB)**: Create `favorites`, `recent_views`, and `user_preferences` Prisma schemas. No destructive migrations.
- **MY-2 (Favorites Core)**: Implement Server Actions/API for toggling favorites and UI integration in Apartment Detail.
- **MY-3 (Recent Sync)**: Implement LocalStorage-to-DB sync for Recent Views upon login.
- **MY-4 (MY Shell Expansion)**: Update `/my` to list Favorites and Recent Views from DB.

## 17. Regression Risks
- Existing `/my` page and community integrations rely on `NextAuth` session structure. Modifying `User` schema directly could impact `auth-helpers.ts` or Community Posts/Comments.
- Extending `Apartment` identifiers (`lawdCd`, `dong`, `name`) correctly in `favorites` and `recent_views` is crucial to avoid breaking apartment detail routing.

## 18. Blockers
- **None**. The auth foundation (NextAuth, Kakao, Naver) is already stable and active.

## 19. Final Recommendation
Proceed with **MY-1** (Schema definition for Favorites and Recent Views) as the next step, leveraging the existing robust NextAuth implementation.
