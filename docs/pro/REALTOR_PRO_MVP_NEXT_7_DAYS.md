# REALTOR PRO MVP — 다음 7일 (Phase 21)

기준: 브랜치 `realtor-pro-mvp-overnight-v1`(로컬, push 안 함). 설계: `REALTOR_PRO_V1_MVP_PLAN.md`.

## DONE TONIGHT (2026-09-30 밤, 로컬 커밋)

| 영역 | 상태 |
|---|---|
| 스키마·migration | 10개 테이블 Prisma 모델 + migration(DO 블록 · CHECK · REVOKE · RLS · 소유자 정책 30). **적용 안 함**. 메모리 PGlite에서 적용·RLS 동작 검증 |
| 보안 기반 | 앱 레이어 소유권(모든 쿼리 realtorId), mass assignment 차단, 비밀번호 필드 없음 + 자유 텍스트 경고, 감사로그(allowlist) |
| 암호화 | AES-256-GCM(버전·키 id·AAD, 회전), HMAC 조회 해시, env 이름만(`REALTOR_PRO_PII_KEY`, `REALTOR_PRO_LOOKUP_PEPPER`) |
| 플랜 | Free/Pro 한도 단일 표(`plan-limits.ts`), 서버 판정 |
| 기능(서버) | 프로필 신청·관리자 수동 심사·베타 Pro 부여 / 매물 노트 / 고객 CRM·조건 세트 / 팔로업 / 결정적 매칭 엔진 v1 / 브리핑(토큰·스냅샷·공개 뷰) / 대시보드 |
| API | `/api/pro/*` 22개 + `/api/admin/pro/*` 2개 — 기능 스위치 기본 OFF |
| UI | `/pro/*`, `/b/[token]`, `/admin/pro` (로컬) — DEMO 모드 375/390 iframe 측정: 26개 화면 가로 넘침 0, 하단 탭 가림 0 |
| 테스트 | Pro 58개(보안·소유권·CSRF·로그 요약·스냅샷 누출 포함) |
| 보안 리뷰 반영 | 브리핑 스냅샷 값 없는 고정 문구(MEDIUM) · CSRF Sec-Fetch-Site + JSON 강제 · 오류 로그 이름/코드만 · 연락처 조회 속도 제한 · 소유자 이름도 조회 전용 · 봇/미리보기 열람 제외 |

## NEEDS USER APPROVAL (차단 요소)

1. **PRODUCTION_MIGRATION_APPROVAL** — `REALTOR_PRO_MIGRATION_APPLY_PLAN.md` 절차(Preview/Production DB). 스키마 변경이므로 필수.
2. **ENCRYPTION_SECRET_CONFIGURATION_APPROVAL** — Preview·Production용 `REALTOR_PRO_PII_KEY`(32바이트)·`REALTOR_PRO_LOOKUP_PEPPER` 생성·Vercel 등록(서버 전용, sensitive). 키 보관·회전 책임자 지정.
3. **TEST_REALTOR_ACCOUNT / SEED_APPROVAL** — 테스트 중개사 계정(실제 OAuth 사용자) 신청 → 관리자 승인 → 베타 Pro 부여. 실제 고객 개인정보 입력 금지(합성 데이터만) 원칙 확인.
4. **PREVIEW_DEPLOY_APPROVAL** — 브랜치 push + Preview에 `REALTOR_PRO_ENABLED=true`(Preview 전용).
5. **Header 하단 탭 교체(A3)** — 현재는 기존 하단 탭 유지 + Pro 상단 탭. 교체 여부 결정.
6. **법률 검토(A5)** — 약관·처리위탁·동의 문구·브리핑 고지 문구. 외부 중개사 사용 전 필수.
7. **User.banned × Pro(A7)**, **break-glass 정책(A4)** — 미구현(관리자는 신청 정보만 봄).
8. **PAYMENT_PROVIDER_DECISION** — Phase 3, MVP 차단 요소 아님.
9. ~~**`/b/*` 광고 스크립트 제외(베타 전 필수)**~~ — **해결(BRIEFING ADS ISOLATION V1, `REALTOR_PRO_V1_SECURITY.md` §1)**.

## NEXT IMPLEMENTATION (승인 후)

| 순서 | 작업 | 추정 |
|---|---|---|
| 1 | Preview DB에 migration 적용 → Preview 스모크(신청→승인→매물→고객→매칭→브리핑→회수) | 0.5일 |
| 2 | UI 실사용 다듬기: 폼 오류 표시·빈 상태·모바일 360/375/390 실기기 확인, 단지 검색 UX | 1일 |
| 3 | `/my` 진입 카드(중개사 Pro) + Header 탭 결정 반영 | 0.5일 |
| 4 | 내보내기(CSV, 감사로그) · 보존 배치(soft delete 30일 → hard, 브리핑 스냅샷 만료+90일 null) | 1일 |
| 5 | Pro 자동 재계산(매물·조건 변경 시) + 대시보드 "매칭된 매물" 알림(표시만) | 1일 |
| 6 | 공개 브리핑 rate limit(인스턴스 로컬) | 0.5일 |
| 7 | 학교·통근 데이터 연결(부산 학교 feature 재사용 범위 확인) | 1일 |

## BETA TEST PREP

- 초대 중개사 5~10명, 동의서 기반, 합성 데이터로 첫 30분 온보딩(`REALTOR_PRO_MVP_MORNING_WALKTHROUGH.md` 흐름).
- 성공 기준(가설): 7일 안에 과반이 매물 5+ · 고객 3+ 입력, 브리핑 1+ 공유.
- 수집 지표(개인정보 없음): 매물/고객 수, 매칭 실행 수, 브리핑 생성·열람 수.
- 사고 대응: 기능 스위치 OFF(즉시), 브리핑 일괄 회수, 감사로그 확인.

## 남은 공수 추정

| 구간 | 개발일 |
|---|---|
| MVP 완성(승인 후 Preview 통합·UI 다듬기·/my 진입·내보내기·보존) | **약 3~4일** |
| Full V1(자동 매칭·브리핑 이미지·반복 알림·결제 제외) | 추가 약 8~10일 |
| 결제(PG·웹훅·청약철회) | 추가 약 4일 |
