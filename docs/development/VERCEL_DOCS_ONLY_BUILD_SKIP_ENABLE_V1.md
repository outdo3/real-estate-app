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

**문서 전용 배포**: 이 문단을 추가한 커밋이 그 시험이다 — 결과는 아래에 이어서 적는다.
