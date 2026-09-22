# E-JIP VERCEL RESOURCE PRESSURE AUDIT V1

READ ONLY — Vercel 대시보드 열람 + GitHub 공개 deployments API. 요금제·설정·배포 삭제·코드 변경 0.
(대시보드 "Run"·"Upgrade"·삭제 버튼은 누르지 않았다.)

## 판정: **PLAN_REVIEW_NEEDED**

초과된 것은 **Functions Storage 하나**이고 원인은 구조적이다 — `main`에 push할 때마다 전체 Production 배포가 생기고,
각 배포가 함수 번들 사본을 갖는다. 오늘(경고가 떠 있는 상태)에도 배포·함수·cron은 정상 동작했다. 대시보드는 초과의 결과(중지·차단)를 **명시하지 않는다**.

## 1. 현재 값 (team `park11`, **Hobby**, "Last 30 Days" = 2026-08-23 17:00 ~ 09-22)

| 항목 | 팀 전체 | E-JIP(`real-estate-app`) | 한도(Hobby) |
|---|---|---|---|
| **Functions Storage** | **18.71 GB** | **16.72 GB (89%)** | **10 GB — 초과(187%)** |
| Fluid Active CPU | 3h 8m | 2h 42m (86%) | 4h (78% 사용) |
| Deployment Storage | 2.11 GB | 1.99 GB | 10 GB |
| Function Invocations | 86K | 62K | 1M |
| Fluid Provisioned Memory | 26.1 GB-Hrs | 18.5 GB-Hrs | 360 GB-Hrs |
| Edge Requests | 143K | 126K | 1M |
| Fast Origin Transfer | 756 MB | 328 MB | 10 GB |
| Fast Data Transfer | 1.5 GB | — | 100 GB |
| Cron Job Invocations | 57 | 57 | — |
| Build CPU Minutes | 30h 42m | 24h 40m | 표시 한도 없음 |

"Exceeded free resources"는 대시보드 사용량 카드의 **Functions Storage** 때문이다(유일하게 한도를 넘은 항목). 팀에는 E-JIP 외 프로젝트도 있다(`master`·`integration/funnel-preview…` 브랜치의 미리보기).
화면의 기간은 **최근 30일 롤링**이며, 대시보드에서 청구/초기화 날짜는 확인하지 못했다(Hobby는 청구 주기가 표시되지 않음) → **reset 시점 UNKNOWN**.

## 2~3. Functions Storage 원인 · 배포 수

Vercel 설명: *"The amount of storage used by Vercel Functions of your deployments."* — 배포마다 함수 번들이 저장된다.

GitHub deployments 기록(Vercel이 Git push마다 남김):

| 기간 | 배포 수 |
|---|---|
| 전체(2026-08-07 ~ 09-22, 46일) | **670** (Production 612 · Preview 58) |
| 최근 30일 | 460 (Production 419 · Preview 41) |
| 최근 7일 | **132** (전부 Production) |
| 오늘(KST) | **17** |

E-JIP 16.72 GB ÷ 670 ≈ **배포당 ~25 MB**(추정 — 배포별 함수 크기는 대시보드에서 텍스트로 읽지 못했다). 이번 주 배포의 상당수는 문서만 바꾼 커밋이었다.
**보존 정책은 이미 동작 중**이다: Security 설정의 "Recently Deleted Deployments"에 *"deleted based on your defined retention policy"* 로 어제 커밋들의 Production 배포 30개가 보이고, 각각 "29 days left"(복구 가능) 상태다.
정책 값 자체는 텍스트로 노출되지 않아 읽지 못했다. 삭제 후 복구 대기(30일) 배포가 저장량에 계속 잡히는지는 대시보드가 말하지 않는다 → UNKNOWN.

## 4. 함수 크기

배포별·함수별 번들 크기는 이번에 확인하지 못했다(UNKNOWN). 확인 방법: 최신 Production 배포 → Functions 탭.

## 5. Fluid Active CPU 주요 원인 (Observability — Hobby는 최근 약 12시간만 보인다)

| 경로 | 호출(12h) | Active CPU |
|---|---|---|
| `/apt/[name]` | 403 | **23s** |
| `/api/cron/sale-recheck` (부산 08:00 1회) | 1 | 6s |
| `/api/admin/dashboard` | 28 | 5s |
| `/api/log/heartbeat` | 98 | 4.58s |
| `/api/auth/[...nextauth]` | 82 | 3.85s |
| `/stats/[type]` | 119 | 3.39s |
| `/api/cron/sale-sync` (부산 04:00 1회) | 1 | 3.32s |
| `/api/log/view` | 71 | 3.16s |
| `/api/cron/rent-sync` | 1 | 2.5s |

P75 Active CPU 225ms · 평균 메모리 231 MB · cold start 11.5% · 오류 0%. **사용자 SSR 경로(상세·통계)가 가장 크고**, 관리자·하트비트·인증이 뒤따른다. 부산 cron 3개 합계 ≈ 12초/일.
30일 2h 42m ≈ 하루 ~5.4분. 2026-09-21 크롤러(319 세션·187 URL, ANALYTICS_SESSION_ID_INTEGRITY_AUDIT_V1)도 그 기간 CPU에 들어 있다(12시간 창 밖이라 비중은 미확인).

## 6. 서울 cron 영향

부산 실측 비율(매매 64셀 3.3s · recheck 122셀 6s)로 환산: 서울 매매 12셀 ≈ **0.6s**, recheck 30셀 ≈ **1.5s** → 하루 **~2초**, 30일 **~1분** = CPU 한도 4h의 **~0.4%**. 의미 있는 비중이 아니다.
저장량에는 영향이 없다(cron은 배포를 만들지 않는다).

## 7. Production 위험 (대시보드 문구 기준)

- 대시보드 문구: **"Exceeded free resources" + "Upgrade"** 뿐. 중지·차단·제한 문구 **없음**. 알림(19개 미확인)은 텍스트로 읽지 못했다.
- 관측: 경고 상태에서 오늘 **배포 2건 성공**(`6568f2c`, `9b00a44`), 함수 응답 200(관리자 API 확인), cron 3개 오늘 실행(Observability에 각 1회), Cron Jobs 설정 "Enabled".
- A(새 배포 차단): **관측상 아님** · B(함수 실행 제한): **관측상 아님** · C(cron 영향): **관측상 아님** · D(초과 표시만): **현재 관측과 일치** · E(초기화까지 사용): 초기화 시점 UNKNOWN.
- 대시보드가 말하지 않는 향후 조치(Hobby 초과 시 일시 중지 여부 등)는 여기서 단정하지 않는다.

## 8. 정리 옵션 (실행하지 않음)

| 옵션 | 효과 | 위험 | Production 영향 |
|---|---|---|---|
| **배포 빈도 줄이기**(문서만 바뀐 push 모으기) | 새 저장량 증가를 직접 줄인다 — 이번 주 하루 ~19배포 | 없음(작업 방식) | 없음 |
| 문서 전용 변경은 빌드 생략(Vercel "Ignored Build Step") | 위와 같은 효과를 자동으로 | 설정 변경 → 승인 필요, 잘못 쓰면 코드 배포도 건너뜀 | 설정 오류 시 배포 누락 |
| 보존 정책 단축 | 오래된 배포 정리 가속 | 되돌리기(rollback) 대상 감소 | 롤백 가능 범위 축소 |
| 옛 Preview/실패 배포 수동 삭제 | Preview 58개 — 전체의 9%라 효과 작음 | 삭제는 되돌리기 제한 | 없음(현재 Production 제외 시) |
| 함수 번들 축소 | 배포당 크기 감소 | 코드/의존성 작업 필요, 크기 측정 선행 | 회귀 위험 |
| Pro 업그레이드 | 한도 확대(대시보드 Pro 열: CPU 16h 등) | 비용 | 없음 |
| 초기화 대기 | 30일 롤링이면 오래된 배포가 빠지며 감소 | 초기화 시점 불명 | 없음 |

**삭제의 효용**: 보존 정책이 이미 오래된 배포를 지우고 있고, 수동 삭제분도 30일 복구 대기로 남는다 — 저장량에서 즉시 빠지는지 대시보드가 말하지 않는다. 삭제는 1순위가 아니다.

## 9. 권고

1. **즉시(승인 불요)**: 문서만 바뀌는 커밋은 모아서 코드 변경과 함께 push한다 — 이번 audit 문서도 로컬 커밋만 하고 push하지 않았다.
2. **결정 필요(사용자)**: Pro 업그레이드 검토 또는 Ignored Build Step(문서 전용 변경 빌드 생략) 설정. 둘 다 계정/프로젝트 설정 변경이라 승인 대상이다.
3. **확인 필요**: 대시보드 알림 19건 중 사용량 관련 문구, 최신 배포의 함수 크기, 보존 정책 값.
