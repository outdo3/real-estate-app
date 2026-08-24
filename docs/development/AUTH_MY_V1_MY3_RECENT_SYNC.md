# AUTH/MY V1 — MY-3: RECENT VIEWS LOCAL ↔ ACCOUNT SYNC

## 1. Baseline
- **Branch**: `feature/auth-my-v1`
- **HEAD**: `f50258e feat(auth): add apartment favorites`

## 2. Previous Local Recent Structure
- **Key**: `ejip:recentApartments`
- **Max**: 8 items
- **Fields**: `name`, `address`, `lawdCd`, `dong`, `visitedAt` (epoch ms)
- **Dedup**: by `name|dong` composite key
- **Usage**: `recordApartmentVisit` in `apt-client.tsx`, read by `home-client.tsx` and `ApartmentQuickSearch.tsx`

## 3. Recent API
- `GET /api/my/recent` — 로그인 사용자의 최근 본 단지 (viewedAt DESC, max 20)
- `POST /api/my/recent/sync` — Body: `{ items: [...] }` — upsert + prune to 20

## 4. Authentication
- `requireUser()` 사용. 401 if unauthenticated.
- `userId`는 `session.user.id`에서만 획득. Client body userId 신뢰 금지.

## 5. Input Validation
- `validateRecentInput()`: lawdCd/dong/name 필수, aptSeq/address optional, viewedAt optional ms number
- `validateSyncPayload()`: items 배열 최대 20개, malformed 항목 skip

## 6. Single View Upsert (apt-client.tsx)
- `pageReady` 확정 시점에 `recordApartmentVisit()`(localStorage) + `POST /api/my/recent/sync`(서버) 동시 호출
- 서버 호출 실패해도 상세페이지 crash 없음 (`.catch(() => {})`)

## 7. Merge Algorithm
- `mergeRecentLists(local, server, limit)` in `src/lib/recent-views.ts`
- Key: `(lawdCd, dong, name)` composite
- Rule: 더 최신 `viewedAt` 우선, dedup, viewedAt DESC 정렬, max `limit` 적용

## 8. Timestamp Policy
- Local: `visitedAt` (epoch ms, `Date.now()` at visit time)
- Server: `viewedAt` (PostgreSQL TIMESTAMP, ms로 변환해 비교)
- Timestamp 없는 local 항목: skip (임의 과거 시각 추정 금지)

## 9. Local Max / Server Max
- Local: 기존 8개 유지 (UX unchanged)
- Server: 최대 20개 (application layer policy, DB constraint 아님)
- MY 페이지: 서버 20개 표시

## 10. Sync Timing
- `useRecentSync` hook: `status === 'authenticated'` 전환 시 1회
- sessionStorage flag `ejip:recentSyncedThisSession` 로 중복 방지
- 실패 시 재시도 없음 (단지 상세 진입 시 자동 upsert로 자연스럽게 보완됨)

## 11. Account → Local Restore
- sync 성공 응답(server top 20)에서 최신 8개를 local에 mirror
- 새 기기/브라우저에서도 최근 본 단지 복원 가능

## 12. Logout Behavior
- local recent 삭제 안 함 (기존 behavior 유지)
- sessionStorage sync flag만 session 종료 시 자동 소멸

## 13. MY Integration
- `/my` 페이지에 "최근 본 단지" 섹션 추가 (관심단지 아래)
- 로그인 상태: account recent 최대 20개 표시
- 미로그인: AuthGate에 의해 로그인 안내

## 14. Home/QuickSearch Integration
- 기존 behavior 유지: local recent 읽기 그대로
- 서버 sync 성공 후 local mirror가 자연스럽게 반영됨

## 15. Error Behavior
- API 실패: local recent 유지, MY 페이지 empty state 표시
- apt-client sync 실패: 상세페이지 정상 동작, local 기록은 유지

## 16. Analytics Separation
- `recent_views`: 현재 상태(max 20). 동일 단지 재방문 시 `viewedAt` 갱신만.
- Analytics `apartment_view` event와 물리적으로 분리. Analytics 구현 금지 (ANALYTICS V1에서 별도 설계)

## 17. Security
- `requireUser()` 서버 검증
- client userId 미신뢰
- `deleteMany` 시 `userId` 조건 포함 (타 사용자 row 접근 불가)
- bulk payload 20개 제한
- malformed input skip (fuzzy 수정 금지)

## 18. Changed Files
- `src/lib/recent-views.ts` [NEW] — validation, merge algorithm
- `src/app/api/my/recent/route.ts` [NEW] — GET
- `src/app/api/my/recent/sync/route.ts` [NEW] — POST sync
- `src/hooks/useRecentSync.ts` [NEW] — login-triggered sync hook
- `src/app/apt/[name]/apt-client.tsx` [MODIFY] — server upsert on visit
- `src/app/my/page.tsx` [MODIFY] — recentViews state, section UI

## 19. DB/Schema Changes
- NONE. 기존 `recent_views` 테이블 그대로 사용.

## 20. Production Test Data
- NONE. 실사용 테스트는 AUTH/MY final QA에서 진행.
