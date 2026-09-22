# E-JIP VERCEL DOCS-ONLY BUILD SKIP ENABLE V1

사용자 승인("Vercel docs-only build skip 적용 승인")에 따라 `VERCEL_DOCS_ONLY_BUILD_SKIP_SAFETY_AUDIT_V1`에서 검증한 규칙을 적용했다.
다른 Vercel 설정·요금제·보존 정책·배포 삭제·cron·env·schema·DB 변경 0.

## 변경

- `scripts/vercel-ignore-build.sh` — audit에서 검증한 스크립트 그대로(머리 주석 한 줄만 "적용됨"으로 수정).
- `vercel.json` — `"ignoreCommand": "bash scripts/vercel-ignore-build.sh"` 한 줄. cron 5개(부산 3 · 서울 2) 그대로.

규칙: `VERCEL_GIT_PREVIOUS_SHA`(직전 **성공** 배포)..`HEAD`의 변경 경로가 **전부** `docs/*` 또는 루트 `CHANGELOG.md`이면 exit 0(= 빌드 취소, 배포 `CANCELED`), 그 밖은 exit 1(= 빌드).
판단 불가(이전 SHA 없음·16진수 아님·clone에 없고 fetch 실패·현재 커밋 없음·diff 실패·빈 diff)는 전부 BUILD. 이름 변경은 옛/새 경로 모두 검사.

## 적용 전 검증

- 편집 전후 스크립트 차이: 머리 주석 1줄뿐 · `bash -n` 통과 · 커밋되는 blob은 LF(Vercel bash용)
- edge case 13개(`scripts/` 경로 그대로 실행) 전부 일치, 거짓 SKIP 0
- 실제 Production 배포 쌍 611개 재현: SKIP 126 · BUILD 485 · 거짓 SKIP 0 · 거짓 BUILD 0
- `vercel.json` 파싱·cron 5개 동일 · vercel.json을 읽는 테스트 47/47 · `npx tsc --noEmit` src/ 0 · build exit 0
- 이 커밋 자체의 판정(로컬, 직전 성공 배포 `9b00a44` 기준): 아래 §Production 확인에 기록

## Production 확인

**첫 배포(`4f3687e`, vercel.json·스크립트 변경)**: 로컬 판정 BUILD(직전 성공 배포 `9b00a44` 대비 `scripts/vercel-ignore-build.sh` 변경) → Vercel Production 배포 완료(2026-09-22 08:13:57 UTC 생성, "Deployment has completed").
배포 후 live: HTTP 200 · 정적 청크 15개(fingerprint `afeb1bf9d4e9`) · sitemap 138 URL · 서울 0.

**스크립트 실행 증거(첫 배포 빌드 로그, KST)**: `17:13:11.719 Running "bash scripts/vercel-ignore-build.sh"` →
`17:13:11.811 [ignore-build] BUILD — non-docs path changed: scripts/vercel-ignore-build.sh` → `17:13:12.467 Running "vercel build"`. Vercel이 스크립트를 실제로 실행하고, 코드 push를 BUILD로 판정했다.

**문서 전용 시험(`e77392f`, docs/ 한 파일)**: 로컬 판정 SKIP(직전 성공 배포 `4f3687e` 대비 문서 1개).
push 후 8분 이상 — Vercel 배포 목록(상태 필터 Canceled·Error 포함)·프로젝트 Activity·GitHub 상태/check-run **어디에도 기록 없음**.
live는 그대로(HTTP 200 · 정적 청크 fingerprint `afeb1bf9d4e9` 동일 · sitemap 서울 0) · Production은 계속 `4f3687e`(Current).
**판정: 미확정.** 문서상 무시된 빌드는 `CANCELED` 배포로 남아야 하는데 그런 기록이 없다. 같은 날 `9ba50e4` push도 Vercel에 아무 기록을 남기지 않은 적이 있어,
"우리 규칙이 건너뜀"과 "Vercel이 push를 받지 못함"을 이 증거로는 구분할 수 없다. 결과(새 빌드 없음·live 불변)는 의도대로다.
