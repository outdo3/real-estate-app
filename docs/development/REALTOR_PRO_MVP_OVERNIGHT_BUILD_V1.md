# REALTOR PRO MVP — OVERNIGHT BUILD V1 (2026-09-30)

## 목적

설계(`docs/pro/REALTOR_PRO_V1_*`, 554651b)를 바탕으로 중개사 Pro MVP를 **로컬에서만** 구현한다. Production DB·env·배포·MOLIT·cron에는 손대지 않는다.

## 현재 상태

- 브랜치 `realtor-pro-mvp-overnight-v1` (worktree `.worktrees/realtor-pro-mvp`), 기반 `554651b`(설계) ← `377acf7`(main). push·배포 안 함.
- 기능 스위치 `REALTOR_PRO_ENABLED` 기본 OFF → 병합돼도 `/pro`는 "준비 중", `/api/pro/*`는 404.
- migration 파일은 있으나 **어떤 DB에도 적용하지 않음**(PGlite 메모리 DB에서만 검증).

## 설계 결정

| 결정 | 이유 |
|---|---|
| 인증 재사용(NextAuth `user.id`) + `RealtorProfile(userId unique)` | 두 번째 계정 체계 금지 |
| 저장소 인터페이스(`ProRepo`)의 모든 비공개 메서드가 `realtorId`를 받음 | IDOR를 타입 수준에서 막음. 메모리 구현으로 DB 없이 테스트 |
| 앱 계층 소유권 + DB RLS(`app.realtor_id`) 이중화 | Prisma 소유자 롤은 RLS를 우회 → 앱 계층이 1차, RLS는 비소유자 롤 대비 |
| PII는 AES-256-GCM + HMAC 조회 해시, 키 id·회전 | 평문 PII 저장 0 |
| 브리핑 토큰은 SHA-256만 저장, 스냅샷은 값 없는 고정 문구 | 링크가 전달돼도 고객 조건 값·소유자 정보 비노출 |
| 매칭은 결정적 가중치 + 사유 + 신뢰도, UNKNOWN은 분모 제외 | 설명 가능한 추천(CLAUDE.md 10), E-JIP Score와 분리 |
| 공공 데이터는 aptSeq로만 연결, 공개 지역 게이트 유지 | 이름 재식별 금지 · Pro는 게이트 예외가 아님 |

## 구현 내용 (커밋)

| 커밋 | 내용 |
|---|---|
| 5cb0cd2 | 스키마 10모델 + migration SQL, 암호화, 규칙·플랜 한도, 저장소 |
| db93510 | 프로필·신청·관리자 심사, 비공개 매물 |
| be043e3 | 고객 CRM, 조건 세트, 팔로업 |
| cba548b | 매칭 엔진, 브리핑, 대시보드 |
| 4cb8d49 | 보안·소유권 테스트 |
| 1211243 | 보안 리뷰 반영(스냅샷 누출 MEDIUM, CSRF, 로그, 연락처 조회 제한, aptSeq 디코드) |
| 3a1b530 | 소유자 이름 응답 제외, 고객 이니셜 정리 |
| a3e0736 | 로컬 UI(`/pro/**`, `/b/[token]`, `/admin/pro`) |

## 테스트 결과 (실행한 명령만)

| 명령 | 결과 |
|---|---|
| `npx tsx --test src/lib/pro/*.test.ts` | 58/58 pass |
| `npx tsx --test <src 148 files>` | 2200 중 2193 pass · fail 2 · skip 5 — 실패 2건은 기존 worktree CRLF 문제(`community-launch` §15, `recent-auth-parity` §5), Pro 무관 |
| `npx tsx --test <scripts 29 files>` | 433 중 431 pass · fail 1(BENCHMARK REGRESSION, DATABASE_URL 필요 — 기존) · skip 1 |
| `npx tsc --noEmit -p .` | exit 2 · 21 errors 전부 `scripts/` (FAIL_EXISTING_SCRIPT_ERRORS), `src/` 0 |
| `npm run lint` | exit 1 · 5 errors 전부 기존 `scripts/education/*` `@ts-nocheck` · Pro 경로 eslint exit 0 |
| `npm run build` | exit 0 (Pro 라우트 전부 매니페스트 포함) |
| PGlite migration 검증 | 10 테이블 RLS · 정책 30 · CHECK 26 · FK 13 · 재실행 차단 · 비소유자 롤 격리 |
| 로컬 DEMO API 프로브 | Origin 없음 403 · 교차 Origin 403 · text/plain 415 · 잘못된 aptSeq 400 · 목록에 ownerName 없음 |
| 로컬 DEMO 브리핑 흐름 | 생성 → 공개 뷰(noindex·no-referrer·PII 0) → 카카오 스크랩 미집계 → 회수 후 차단 → 없는 토큰 404 |
| 375/390 iframe 측정(13화면 × 2) | 가로 넘침 0 · 오류 0 · 하단 탭 가림 0 · 행 링크 40px |

## 알려진 문제

- `/b/*`에 루트 layout의 AdSense 로더가 실림 → 외부 공유 전 제외 필요(별도 승인).
- 한도 경쟁 조건(동시 요청 시 1개 초과 가능), 복합 FK 보류, 속도 제한 인스턴스 로컬.
- 통근·학교 입력 UI 없음(지오코딩 없음) → '확인 필요'.
- 실제 360px·실기기 확인 안 함(브라우저 창 최소 폭 때문에 iframe 측정).

## 다음 STEP

`docs/pro/REALTOR_PRO_MVP_NEXT_7_DAYS.md` — migration·암호화 키·테스트 계정·Preview 승인 후 Preview 스모크.
