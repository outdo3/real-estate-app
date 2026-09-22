# E-JIP VERCEL DOCS-ONLY BUILD SKIP SAFETY AUDIT V1

READ ONLY / 로컬 테스트만. Vercel 설정 0 · vercel.json 0 · 배포 삭제 0 · 요금제 0 · Production 코드 0 · schema/env 0.

## 판정: **SAFE_TO_ENABLE** (아래 스크립트 그대로, 승인 후)

## 1. Vercel 공식 동작 (2026-09-22 문서 확인)

- Ignored Build Step: **exit 1 → 빌드 진행**, **exit 0 → 빌드 중단(배포 `CANCELED`)**. `vercel.json`의 `ignoreCommand`도 같은 의미이며 **대시보드 설정을 덮어쓴다**.
- `VERCEL_GIT_PREVIOUS_SHA`: *"The git SHA of the last successful deployment for the project and branch."* 브랜치 첫 배포에서는 비어 있고, **Ignored Build Step이 설정됐을 때만 노출**된다.
- 빌드는 **얕은 clone(`git clone --depth=10`)**. 문서 예시의 `HEAD^ HEAD`는 여기서 쓰면 안 된다 — 한 번의 push가 커밋 여러 개를 싣고 마지막이 문서면 앞의 코드 커밋이 가려진다.
- 참고: 취소된 빌드도 배포 수·동시 빌드 슬롯에는 잡힌다(문서). 함수 번들을 만들지 않으므로 Functions Storage는 늘지 않을 것으로 **예상**하지만 문서가 저장량을 명시하지는 않는다.

## 2. docs / CHANGELOG 의존성

- 런타임 파일 읽기는 `data/**` JSON 4개와 `vercel.json`(cron 표시)뿐 — `docs/`·CHANGELOG를 읽는 코드 **0**. MD/MDX import·loader·file tracing **0**.
- 빌드 명령은 `next build`, `postinstall`은 `prisma generate` — 문서를 읽는 훅 **0**.
- `docs/development/*.md`를 읽는 것은 **테스트 3개**뿐(Vercel 빌드에서 돌지 않는다). CSS 한 곳은 주석 속 문서 이름.
- 루트 `CHANGELOG.md`는 **존재하지 않는다** — 변경 기록은 `docs/development/CHANGELOG.md`(docs/ 안). 루트 `CHANGELOG.md`는 규칙에 두되 현재는 해당 없음.

## 3. 규칙

- **SKIP**: `VERCEL_GIT_PREVIOUS_SHA..HEAD`의 변경 경로가 **전부** `docs/*` 또는 정확히 루트 `CHANGELOG.md`.
- **BUILD**: 그 밖의 경로가 하나라도 있으면(`src/` `public/` `prisma/` `scripts/` `data/` `package*.json` `next.config*` `vercel.json` `tsconfig*` 루트 `README.md`·`AGENTS.md`·`CLAUDE.md` 포함),
  그리고 **판단할 수 없을 때 전부**: 이전 SHA 없음·16진수 아님·clone에 없고 fetch 실패·현재 커밋 없음·`git diff` 실패·**빈 diff**(재배포·재트리거용 빈 커밋).
- `--no-renames`: 이름 변경은 옛 경로와 새 경로를 둘 다 보므로 코드를 docs/로 옮겨도 BUILD.

스크립트: `tmp/vercel-ignore-build/vercel-ignore-build.sh`(적용 시 `scripts/vercel-ignore-build.sh`로 옮김).

## 4. edge case (임시 git 저장소, 실제 커밋 쌍)

| 경우 | 기대 | 결과 |
|---|---|---|
| A docs/a.md · B CHANGELOG · C 둘 다 · C2 루트 CHANGELOG.md | SKIP | SKIP ×4 |
| D src · E docs+src · F vercel.json · G schema.prisma · H migration SQL · I package-lock · J public 이미지 · K src 삭제 · L src→docs 이름 변경 | BUILD | BUILD ×9 |
| P 한 push에 코드 커밋 + 마지막 문서 커밋 | BUILD | BUILD(`HEAD^`였다면 SKIP — 거짓 SKIP) |
| M 코드 브랜치 merge · M2 문서 브랜치 merge | BUILD · SKIP | BUILD · SKIP |
| 빈 커밋 · 루트 README.md | BUILD | BUILD ×2 |
| N1 얕은 clone, 이전 SHA fetch 가능 · N2 얕은 clone, 이전 SHA 없음·fetch 불가(실제 diff는 문서뿐) · N3 현재 커밋 없음 | 정확 판정 · BUILD · BUILD | 정확 판정 · **BUILD** · BUILD |
| O1 모르는 SHA · O2 16진수 아님 · O3 빈 값 | BUILD | BUILD ×3 |

## 5. 역사 재현 (실제 Production 배포 순서, GitHub deployments API → 연속 배포 쌍)

| 항목 | 값 |
|---|---|
| 배포 쌍 | **611** (2026-08-07 ~ 09-22) |
| 규칙 결과 | SKIP 126 · BUILD 485 |
| **거짓 SKIP** (SKIP인데 docs/ 밖 경로가 바뀜 — 독립 검사) | **0** |
| 거짓 BUILD | 0 |
| BUILD 사유 | docs/ 밖 경로 481 · 빈 diff 4 |

코드 배포는 전부 BUILD였다(예: `96f5c90` 홈, `f1c94dd`·`b042f8a` 행동 분석, `fa693e2` 서울 scope, `6568f2c` vercel.json).
`effe597`(빈 커밋)도 BUILD — 직전 성공 배포 대비 diff에 배포되지 않았던 `9ba50e4`의 코드가 들어 있기 때문이다(이전 SHA 기준이 맞다는 증거).

최근 50커밋 분류: 문서 전용 12 · 문서+CHANGELOG 13 · CHANGELOG 전용 1 · docs 밖 변경 포함 23 · 빈 커밋 1.

## 6. 저장량 효과 (추정)

| 기간 | 배포 | 건너뛸 수 있었던 배포 |
|---|---|---|
| 최근 7일 | 132 | **53 (40%)** |
| 최근 30일 | 419 | 108 (26%) |
| 오늘(KST) | 17 | 11 |

배포당 함수 저장량이 비슷하다면 **새로 쌓이는 Functions Storage를 대략 26~40% 줄였을 것**이다. 이미 쌓인 16.72 GB는 줄지 않는다(보존 정책·기간 경과로만 줄어든다).
커밋 습관(문서 커밋 모아 push)과 겹치는 효과이므로 두 방법을 합쳐도 단순 합산되지 않는다.

## 7. 적용 방법 비교 (실행하지 않음)

| | A. 대시보드 Ignored Build Step("Run my Bash script") | B. `vercel.json` `ignoreCommand` + repo 스크립트 |
|---|---|---|
| 버전 관리 | 스크립트만 | 규칙 전체(연결 포함) |
| 변경 절차 | 대시보드 설정 변경 | 코드 변경(이 push 자체는 vercel.json이 바뀌므로 BUILD) |
| 되돌리기 | 대시보드에서 Automatic으로 | `ignoreCommand` 제거 커밋(역시 BUILD) 또는 revert |
| 비상 우회 | Redeploy 시 "Use project's Ignore Build Step" 해제 | 동일 |

**권장: B.** 스크립트 1개(`scripts/vercel-ignore-build.sh`) + `vercel.json`에 `"ignoreCommand": "bash scripts/vercel-ignore-build.sh"` 한 줄.
주의: `vercel.json`은 런타임에도 읽힌다(`/admin/ops` cron 표시) — 키 하나 추가는 JSON 파싱·cron 목록에 영향이 없다. 적용 후에는 문서 전용 push의 GitHub 상태가 `success`가 아니라 **취소(canceled)** 로 보인다 — 배포 확인 절차에서 정상으로 취급해야 한다.
