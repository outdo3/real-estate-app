# E-JIP SCORE V2 PRODUCTION RELEASE

## 1. Merged Branches & HEADs
- **Source Branch**: `score-v2-step35-expert-calibration`
- **SOURCE_SCORE_V2_HEAD**: `443912b`
- **Pre-Merge Main HEAD (Local)**: `ec23919` (Preserved hygiene commit)
- **Pre-Merge Main HEAD (Origin)**: `82f4914`
- **Post-Merge Main HEAD**: `f7f7658` (Merge commit)

## 2. Merge Details
- **Preservation Reference**: Dirty working tree files on `main` (for pending SCHOOL V2-C3A work) were preserved in branch `preserve/school-v2-main-worktree-20260824` at commit `3186501`.
- **Merge Method**: Standard merge commit (`git merge --no-ff score-v2-step35-expert-calibration`).
- **Conflict Status**: No conflicts.

## 3. Validation Results
- **Regression Tests**: PASS (45/45 tests).
- **TypeScript**: `tsc --noEmit` PASS.
- **Lint**: PASS.
- **Build**: `next build` PASS.

## 4. Production Deployment & QA
- **Push**: `origin main` updated to `f7f7658`.
- **Vercel Deployment**: Triggered by push to main branch.
- **Production URL**: `https://real-estate-app-park11.vercel.app`
- **대신해모센트럴 QA**: 
  - 상태: SCORE_AVAILABLE.
  - V2 이집점수 표출, 4개 도메인 상세, 객관적 단지 브리핑 정상 확인.
- **협성르네상스 QA**:
  - 상태: SCORE_AVAILABLE.
  - V2 이집점수 표출, 점수차 납득 가능(연식 30년 등 객관적 팩트).
- **구덕금호 QA**:
  - 상태: NOT_ENOUGH_DATA.
  - V1 점수 미노출, `데이터 부족으로 점수를 산정할 수 없습니다` 문구 노출 및 Location-derived 오류 증거 미노출 확인.

## 5. Mobile User Verification Guide
사용자가 실제 스마트폰(모바일)에서 V2 릴리스를 확인할 수 있는 가이드라인:
- **대신해모센트럴/협성르네상스**: 상세 페이지 중간에 '이집점수' 타이틀과 함께 베타 뱃지, 교통/생활/교육/단지 4개 도메인의 상세 점수와 '왜 이런 점수인가요?' 영역, '단지 브리핑' 섹션이 렌더링되면 V2입니다.
- **구덕금호**: '이집점수' 타이틀 아래에 총점 대신 "점수 산정 데이터가 충분하지 않아 단지브리핑도 확인 가능한 정보만 제한적으로 제공합니다."라는 안내 문구가 나오면 정상적인 V2 처리입니다.

## 6. Cache Notes
- Vercel 배포 직후 CDN 또는 브라우저 캐시에 의해 기존 UI(V1)가 보일 수 있으므로 1~2분 대기 후 시크릿 창이나 강력 새로고침을 통해 확인하십시오.

## 7. Rollback Reference
- 문제 발생 시 되돌아갈 가장 안전한 pre-merge `main` HEAD는 `ec23919` 입니다.
- `git reset` 롤백은 히스토리를 오염시키므로 가급적 `git revert -m 1 f7f7658` (Merge commit revert) 방식을 권장합니다.

## 8. Release Verdict
E-JIP SCORE V2 통합, 배포, QA를 모두 완벽히 통과했습니다. **Release Complete**.
