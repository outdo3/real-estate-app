# AUTH/MY V1 — MY-4: PREFERENCES + MY HOME

## 1. Baseline
- **Branch**: `feature/auth-my-v1`
- **HEAD**: `2fa3680 feat(auth): sync recent apartments to user account`

## 2. Current MY Audit
- **로그인 상태**: 프로필 → 관심단지 → 최근 본 단지 → 바로가기 → 로그아웃
- **비로그인 상태**: AuthGate가 로그인 안내
- **기존 바로가기**: 커뮤니티, 새 글, 관리자 관리(ADMIN 한정)
- **모바일 BottomNav**: MY 탭 연동됨

## 3. Preferences API
- `GET /api/my/preferences`: 현재 purposes 배열 반환 (row 없으면 빈 배열)
- `PUT /api/my/preferences`: Body `{ purposes: string[] }` → upsert

## 4. Canonical Purpose Values / Labels
| DB Value | UI Label |
|---|---|
| BUY | 매수 |
| SELL | 매도 |
| JEONSE | 전세 |
| MONTHLY_RENT | 월세 |
| LEASE_OUT | 임대 |
| INVEST | 투자 |
| REDEVELOPMENT | 재개발·재건축 |
| BROWSE | 둘러보기 |

## 5. Validation (`src/lib/preferences.ts`)
- `ALLOWED_PURPOSES` 허용 목록에 없는 값 → 400 reject
- 중복 값 자동 제거
- 빈 배열 허용 (미설정 상태)
- max 8개 (전체 선택 가능)

## 6. Storage / Upsert
- `user_preferences`: userId PK, 1 row per user
- PUT → `prisma.userPreference.upsert()`

## 7. Preference UX
- "어떤 집을 찾고 계세요?" 섹션 제목
- chip grid — `aria-pressed`, `✓` 체크 아이콘, 선택 시 배경/테두리 변경
- 최소 touch target 44px
- 즉시 저장 + 500ms debounce (연속 클릭 API 폭증 방지)

## 8. Save State
- `idle → saving → saved → idle` (3초 후 idle)
- `idle → saving → error → idle`
- `aria-live="polite"` 적용

## 9. MY IA V1
```
MY
├── 프로필 카드
├── [ADMIN] 관리자 대시보드
├── 관심단지
├── 최근 본 단지
├── 어떤 집을 찾고 계세요? (관심 목적)
├── 바로가기
└── 약관 및 정책 (비로그인에도 노출)
```

## 10. Favorites / Recent 관계
- 역할 분리: Favorites=의도적 저장, Recent=탐색 기록
- 동일 단지 양쪽 표시 허용 (중복 dedup X)

## 11. Empty States
- 관심단지 없음: "단지 둘러보기" CTA
- 최근 본 없음: "지도에서 찾아보기" CTA
- 관심 목적 미설정: "관심 목적을 선택하면 나중에 더 맞는 정보를 보여드릴 수 있어요."

## 12. Personalization Readiness
- purposes JSON 컬럼은 향후 commute/education/parking 등 preference 추가 준비됨
- purposes와 personalized score weights는 분리된 개념 (이번 V1에서 혼용 안 함)

## 13. Security
- `requireUser()` 사용
- client userId 미신뢰
- `validatePurposes()` — 허용 enum만, arbitrary string 거부

## 14. Analytics Readiness
- `user_preferences`는 현재 상태값 (analytics history 아님)
- 향후 `my_view`, `preference_select`, `preference_save` 이벤트 boundary 준비

## 15. Production Data Safety
- Production DB 테스트 write 없음
- 실사용 E2E는 MY-5 Final QA에서 진행

## 16. Changed Files
- `src/lib/preferences.ts` [NEW]
- `src/app/api/my/preferences/route.ts` [NEW]
- `src/app/my/page.tsx` [MODIFY] — preferences 섹션, IA 정리
- `src/app/my/page.module.css` [MODIFY] — chip 스타일, 빈 상태 스타일

## 17. DB/Schema Changes
- NONE (기존 `user_preferences` 테이블 그대로 사용)
