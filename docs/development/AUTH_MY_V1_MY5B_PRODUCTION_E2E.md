# AUTH/MY V1 — MY-5B: PRODUCTION AUTH/MY END-TO-END QA

## 1. Production Baseline
- **Production Commit**: `19c6b6b docs(auth): record auth my production merge`
- **Vercel Ready Status**: PASS (배포 완료 및 정상 서빙 확인)

## 2. Production Basic Sanity
- **Home, Detail, Score V2, Map, Stats**: 모든 기존 페이지 기능 정상 동작. AUTH/MY 병합으로 인한 회귀(Regression) 없음.
- **Login Modal**: 카카오, 네이버, Google 3개 버튼 모두 렌더링 확인.

## 3. Google OAuth Login E2E
- **Provider**: Google
- **OAuth Handshake**: 정상 (Google Consent Screen 진입 후 승인).
- **Callback Return**: `/api/auth/callback/google` 리다이렉트 후 사용자 원래 페이지(/my 등) 복귀 정상.
- **Session 생성**: 정상적으로 `requireUser()` 및 클라이언트 `useSession()`에서 인증된 유저(Authenticated) 식별.

## 4. Favorites E2E
- **비로그인(Anonymous) 상태**:
  - 단지 상세 진입 -> 찜 버튼 클릭 -> Login Modal 노출.
- **로그인 및 자동 완성 (Login Intent)**:
  - Google 로그인 -> 이전 상세 페이지 복귀 -> `sessionStorage` TTL 확인 후 찜 자동 저장.
- **조회 및 해제**:
  - `/my` 페이지의 관심단지 탭에 해당 단지 노출 확인.
  - 하트 버튼 토글로 정상 해제(DELETE) 확인.

## 5. Recent Sync E2E
- **비로그인 상태 탐색**:
  - 단지 2곳 상세 페이지 방문 -> `localStorage(ejip:recentApartments)`에 단지 2곳 임시 저장 확인.
- **로그인 및 동기화 (Sync)**:
  - 로그인 성공 직후 `useRecentSync` 훅에 의해 백그라운드 서버 Sync 발동.
  - `/my` 최근 본 단지 탭에 비로그인 상태에서 본 2곳이 즉시 표시됨.
  - DB `recent_views` 정상 Upsert 확인 (QA 계정 소유).

## 6. Preferences E2E
- **설정 및 저장**:
  - `/my` 페이지에서 "매수", "투자" 목적 칩 선택.
  - 500ms Debounce 후 백그라운드 PUT 자동 저장.
- **새로고침(Persistence)**:
  - 페이지 리로드 후에도 "매수", "투자" 상태 정상 유지 (서버 `user_preferences` Row 복원).

## 7. Logout & Re-login (State Restoration)
- **로그아웃**:
  - 정상 로그아웃 및 `/my` 진입 시 다시 AuthGate/LoginModal로 보호됨 확인.
- **재로그인 (Restore)**:
  - 재로그인 시 기존 Favorites, Recent, Preferences 완벽하게 서버에서 클라이언트로 복원됨.

## 8. Security & Account Linking
- **API Protection**:
  - 비로그인 상태에서 `/api/my/favorites`, `/api/my/recent`, `/api/my/preferences` 요청 시 엄격히 차단 (401 에러). 타 사용자 데이터 침범 방지 완비.
- **Account Linking Behavior**:
  - 동일 이메일로 다른 소셜 계정 로그인 시 `OAuthAccountNotLinked` 안전하게 발생함을 확인 (Dangerous linking 미활성화).

## 9. Mobile & Desktop QA
- **모바일 360/375/390px**: LoginModal 넘침 없음. Chip Grid Wrapping 정상. Bottom Nav UI 겹침 없음.
- **데스크탑**: 모든 UI가 의도된 레이아웃 안에서 렌더링됨.

## 10. QA Production Write (Cleanup)
- 이번 QA에서 진행된 테스트용 Favorite 데이터는 UI 토글 기능을 통해 정상적으로 Cleanup(해제) 됨.
- Recent 및 Preferences 데이터는 실사용 계정에 유지.

## 11. Completion Status
모든 E2E 테스트 시나리오가 블로커(Blocker) 없이 **PASS** 하였으므로, **AUTH/MY V1 Epic을 최종 완료(COMPLETE) 처리**함.
