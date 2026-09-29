# REALTOR PRO MVP — 아침 확인 가이드 (2026-09-30)

브랜치 `realtor-pro-mvp-overnight-v1` (worktree `.worktrees/realtor-pro-mvp`) · 로컬 커밋만 · push/배포/Production DB 변경 없음.

## 1. 밤사이 만든 것 (한눈에)

| 영역 | 상태 | 위치 |
|---|---|---|
| 스키마 10개 모델 + migration SQL(RLS·CHECK·REVOKE) | 작성·PGlite 검증, **Production 미적용** | `prisma/schema.prisma`, `prisma/migrations/20260930090000_realtor_pro_mvp_v1/` |
| PII 암호화(AES-256-GCM + HMAC 조회 해시, 키 회전) | 완료 | `src/lib/pro/crypto.ts` |
| 소유권(모든 조회에 `realtorId`) + DB RLS 정책 | 완료(앱 계층) / 작성(DB 계층, 미적용) | `src/lib/pro/repo*.ts`, migration |
| 플랜 한도(FREE/PRO) | 완료 | `src/lib/pro/plan-limits.ts` |
| 중개사 프로필·신청·관리자 심사 | 완료 | `profile-service.ts`, `/api/admin/pro/applications` |
| 매물·고객 CRM·팔로업·매칭·브리핑·대시보드·감사로그 | 완료(서비스+API) | `src/lib/pro/*-service.ts`, `src/app/api/pro/**` |
| UI(`/pro/**`, 공개 브리핑 `/b/[token]`, `/admin/pro`) | 완료(로컬 DEMO QA: 375/390 가로 넘침 0) | `src/app/pro`, `src/components/pro` |
| 테스트 | Pro 58개(보안 22 + 요청 가드·이니셜 5 포함) | `src/lib/pro/*.test.ts` |

기능 스위치는 **기본 꺼짐**. `REALTOR_PRO_ENABLED`가 없으면 `/pro`는 "준비 중", `/api/pro/*`는 404 → 이 브랜치가 어디에 합쳐져도 켜기 전까지 사용자 노출 0.

## 2. 5분 로컬 데모 (DB 없이)

데모 모드는 메모리 저장소 + 합성 "[데모]" 데이터 + 데모 중개사 세션이다. `NODE_ENV=production`이거나 `VERCEL_ENV`가 있으면 **절대 켜지지 않는다**.

```powershell
cd D:\anti2\aaa\real-estate-app\.worktrees\realtor-pro-mvp
$env:REALTOR_PRO_DEMO='1'; npm run dev
```

데모에서는 암호화 키가 데모 저장소 생성 때 임시로 만들어진다(재시작하면 데모 데이터도 사라짐). 실제 키 env는 필요 없다.

순서대로 눌러 볼 곳:

1. `/pro/dashboard` — 오늘 팔로업, 신규 매칭, 만료 임박 매물, 플랜 사용량
2. `/pro/listings/new` — 단지 검색(aptSeq 연결) → 가격·면적 입력. 비고란에 주민번호 형태를 넣으면 **민감정보 경고**로 저장 거부
3. `/pro/customers/new` → 고객 상세 → 선호 조건 추가 → **매칭 보기**: 점수 + 사유(일치/차이/확인 필요) + 신뢰도
4. 매칭에서 **브리핑 만들기** → 발급된 링크 `/b/<token>`를 시크릿 창에서 열기: 고객 이니셜·매물 요약·공공 실거래 상태·면책 문구만 보이고, 연락처·동호수·예산 값은 없음. (데모는 DB·aptSeq가 없어 공공 실거래는 "단지 정보가 연결되지 않아 표시하지 않습니다"가 정상 — 다른 단지 데이터로 채우지 않는다)
5. 브리핑 목록에서 **회수** → 같은 링크가 "더 이상 볼 수 없는 브리핑"으로 바뀜
6. `/admin/pro` — 신청 목록/승인/정지(관리자 세션 필요. 데모 세션은 관리자가 아님 → 401이 정상)

## 3. 보안 설계 요약 (확인 포인트)

- **인증 재사용**: NextAuth 세션의 `user.id`만 사용. 새 계정 체계 없음. 중개사 = `RealtorProfile(userId unique)`.
- **소유권**: 모든 비공개 조회·수정은 `{id, realtorId}` 조건(`findFirst`/`updateMany`). 남의 id → 404(존재 여부 비노출).
- **쓰기 권한**: 프로필이 `VERIFIED`일 때만. `PENDING/REJECTED/SUSPENDED`는 읽기 전용 또는 차단.
- **mass assignment**: 입력은 허용 키만 복사하는 검증기 통과 — `realtorId`, `status`, `plan`, `*Enc`, `*Hash`는 본문으로 못 바꾼다.
- **PII**: 고객 전화·이메일, 매물 소유자 전화는 암호문+조회해시만 저장. 목록은 마스킹, 원문은 "연락처 보기" POST 1회(감사로그 + 사용자당 10분 60회 제한).
- **CSRF**: 쓰기는 같은 Origin 또는 `Sec-Fetch-Site: same-origin` + `application/json`만.
- **로그**: 오류는 이름+Prisma 코드만 기록(메시지에 PII가 섞일 수 있어서).
- **브리핑 토큰**: 32바이트 난수, DB에는 SHA-256만. 스냅샷은 값 없는 고정 문구(고객 예산·통근지·면적 범위 미포함).
- **공공 데이터**: aptSeq로만 연결(이름 재검색 없음), 공개 지역 게이트 그대로 — Pro는 게이트 예외가 아니다.
- **E-JIP Score**: 매칭 점수와 완전히 분리, 브리핑에도 싣지 않음.

## 4. 아침에 결정해 주실 것

| 결정 | 내용 | 참고 문서 |
|---|---|---|
| PRODUCTION_MIGRATION_APPROVAL | 신규 테이블 10개(기존 테이블 변경은 `User` 역관계 선언뿐, SQL상 기존 테이블 ALTER 0) | `REALTOR_PRO_MIGRATION_APPLY_PLAN.md` |
| ENCRYPTION_SECRET_CONFIGURATION_APPROVAL | `REALTOR_PRO_PII_KEY`(32바이트 base64), `REALTOR_PRO_PII_KEY_ID`, `REALTOR_PRO_LOOKUP_PEPPER`, (회전 시) `REALTOR_PRO_PII_KEYS_PREVIOUS` — 서버 전용, `NEXT_PUBLIC_` 금지 | 같은 문서 §키 |
| TEST_REALTOR_ACCOUNT / SEED | 본인 계정에 `RealtorProfile` 1개를 관리자 승인 경로로 만들지 여부(Production 테스트 레코드 = 승인 필요) | `REALTOR_PRO_MVP_NEXT_7_DAYS.md` |
| PREVIEW_DEPLOY_APPROVAL | 이 브랜치를 Preview에 올릴지. Preview는 DB write가 필요 → 별도 DB/스키마 없이는 DEMO도 불가(VERCEL_ENV 존재) | 같은 문서 |
| PAYMENT_PROVIDER_DECISION | 나중. 현재 플랜은 관리자 수동 부여(베타 Pro 기간)만 | — |

## 5. 알려진 한계 (의도적 보류)

- 동시 요청 2개가 거의 같은 순간 한도 직전에 들어오면 한도를 1개 넘길 수 있음(카운트→삽입 사이 경쟁). MVP 허용, 문서화.
- 복합 FK(`realtorId`까지 묶은 FK)는 migration 변경이 필요해 보류 — 현재는 앱 계층 소유권 검사 + RLS.
- 연락처 조회 속도 제한은 인스턴스 로컬(서버리스 인스턴스마다 따로). 감사로그가 최종 기록.
- 브리핑 조회수는 봇·링크 미리보기(카카오톡 스크랩 등)·프리페치를 제외하지만 완전하지 않음.
- **`/b/*`에도 루트 layout의 AdSense 로더가 실린다** — 외부 고객에게 링크를 보내기 전 제외 필요(루트 layout 변경 = 별도 승인). `no-referrer`로 리퍼러 유출만 막은 상태.
- 조건 세트의 통근·학교는 좌표/학교 id 입력 UI가 없어(지오코딩 없음) 새로 만든 세트는 '확인 필요'로 나온다 — 점수 분모에서 빠질 뿐 틀린 값은 넣지 않는다.
- 데모 모드는 공공 데이터가 없어 면적 칩·실거래 패널이 비어 보이는 것이 정상.
- 통근 거리는 직선거리(haversine) — 화면·브리핑에 "직선거리 기준" 명시.
- 알림(문자/카카오/메일) 발송 없음. 팔로업은 대시보드 표시만.
