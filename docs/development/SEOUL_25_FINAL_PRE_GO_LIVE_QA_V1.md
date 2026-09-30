# SEOUL25 FINAL PRE-GO-LIVE QA V1 (2026-09-30)

## 목적

서울 신규 17구 Production 공개 승인 전 마지막 검증. **Production 스위치는 OFF 그대로**(`SEOUL_17_PUBLIC_ENABLED = false`).

## 현재 상태

| 항목 | 값 |
|---|---|
| Production main | `377acf7`(17구 cron) — 변경 없음, Production 배포 없음 |
| go-live 브랜치 | `seoul-25-go-live-prep-v1` = main + `103f6fd` + `cf44df6` + `0a1a088` + 이 문서 커밋(로컬, push 안 함) |
| QA Preview | 브랜치 `seoul-25-public-beta-prep-v2`에 go-live 트리를 **그대로 복사한 커밋**(`80fcd12`, 트리 = `0a1a088`)을 fast-forward push → `dpl_DCnc6MmGfSzHYHTQw2h2kMhfcvmo`, alias `real-estate-app-git-seoul-25-public-beta-prep-v2-park11.vercel.app` |
| Preview 설정 | 기존 검증된 것 재사용: 읽기 전용 Preview DB 역할(`PREVIEW_DATABASE_URL`, 이 브랜치 한정), Preview 전용 플래그로 17구 시뮬레이션 ON, Kakao 등록 도메인 — env 변경 0 |
| cron 최종 | PASS(2026-09-30 02:16Z 읽기 전용 검증: sale 51셀 +61, 현재월 202609 +449(설계상 coverage 미기록), recheck 170셀 +4/수정 1, 행 증가 514 정확, 미검증 셀 0, 중복 0, review 32/32) |

## 결과

| 항목 | 결과 | 근거 |
|---|---|---|
| 셀렉터 | PASS | 서울 25구 정확히 25개·중복 0·누락 0, "서울특별시 전체" 없음, 경기 시도 숨김 |
| 검색 | PASS | 왕십리(11200)·상계주공(11350)·우장산(11500)·반포자이(11650)·은마(11680)·헬리오시티(11710) — 결과 전부 해당 구, aptSeq↔lawdCd 불일치 0, aptSeq 없음 0 |
| 지도 | PASS | 6개 구 마커 144/274/433/408/375/328개, 다른 구 aptSeq 0, aptSeq 없음 0(좌표·aptSeq null 5행은 계속 제외), 좌표 없음 0, Kakao 타일·가격·신축 배지·선택 시트·상세보기(aptSeq 포함 링크) 정상 |
| 상세 | PASS | 은마(11680-218, 1979, 2026-09-28 30.5억)·헬리오시티(11710-8865, 2018, 2026-08-30 20.3억)·반포자이(11650-3500, 2009, 2026-09-08 50.5억)·상계주공1(11350-29, 1988, 2026-09-11 6.8억) — 전부 `tradeDataSource=DB`, 단일 aptSeq, 다른 단지 섞임 0, `noindex, nofollow`, canonical 없음 |
| 전월세(17구) | PASS(수정 후) | 서버는 DB 전용 관문에서 네트워크 없이 닫음(`monthsSucceeded 0/12`). 화면: Hero "준비 중", 안내 "이 지역의 이 거래 유형은 아직 제공 준비 중입니다", 타임라인 "전체 평형 · 준비 중", "요청 실패"·"조회 중"·"총 0건" 없음 |
| 닫힌 면 | PASS | 17구 통계 "이 지역 통계는 현재 준비 중입니다"(랭킹 API `UNSUPPORTED_REGION`), region-change 400, 리포트 CTA 없음·리포트 페이지 noindex, 공급 API는 구를 떨어뜨리고 행 0(노출 없음), Production sitemap 139개 중 17구 0, sitemap scope 테스트 22/22 |
| 안내 문구 | PASS | 부산(26350)·서울 8구(11110)·17구(11680) 지도에 없음, 경기(41135)에만 정확한 문구로 표시(마커 0) |
| 회귀 | PASS | 서울 8구 매매 상세 DB 23건, 경기 검색·상세 차단(`regionUnsupported`), 부산 지도 정상 |
| 모바일 375/390 | PASS | 홈·통계·지도(선택 시트)·상세 2곳·전월세 준비 중: 문서 가로 넘침 0, 오류 0, 작은 터치 목표 0, 오래된 부산 전용 문구 0 |

## 이번에 찾아 고친 것

| 문제 | 영향 | 수정 커밋 |
|---|---|---|
| 17구 전월세 탭이 "조회 중…"에서 멈추고, 안내가 "실거래가 API 요청에 실패했습니다" | 준비 중인데 오류·로딩처럼 보임 | `cf44df6` — 공유 상수 `TRADE_PREPARING_MESSAGE`, `resolveTradeReadState.preparing`, Hero "준비 중" |
| 은마 전월세 탭에서 "2034년 준공" | 건축물대장 총괄표제부가 미래 사용승인일(재건축 계획값으로 보임)을 돌려주고, 거래가 없는 탭에서 그 값이 준공연도로 표시됨 | `cf44df6` — info API가 미래·1900년 이전·형식 불명 사용승인일을 어느 출처든 표시하지 않음 |
| 전월세 준비 중인데 타임라인 요약 "총 0건" | 검증된 0건으로 읽힘 | `0a1a088` — 준비 중 상태에서만 "준비 중" |

## MOLIT·외부 호출 (정직 보고)

- 17구 사용자 경로(검색·지도·상세 매매·전월세): live MOLIT 0 — 매매는 DB, 전월세는 DB 전용 관문에서 네트워크 없이 닫힘(응답 `monthsSucceeded 0/12`).
- **내 실수로 발생한 MOLIT 호출**: 부산 회귀 확인 중 존재하지 않는 단지명(`해운대아이파크`, 26350)으로 상세 API를 두 번(매매·전월세) 호출 → DB에 없는 부산 단지는 기존 설계대로 live MOLIT로 넘어감(`tradeDataSource=MOLIT`, 0건). 최대 약 24회(12개월 × 2유형, 월 1페이지 가정)로 추정, 정확한 건수는 로그에 남지 않음. 같은 키를 Production과 공유한다. 이후 그런 호출은 하지 않았다.
- 상세의 단지 기본정보(`/api/apt/[name]/info`)는 기존 설계대로 건축물대장(data.go.kr) live 조회를 한다(전 지역 공통, 17구 전용 동작 아님) — QA 중 약 10회.

## GO-LIVE 스위치 검토

- 변경: `src/lib/region/enablement.ts` — `export const SEOUL_17_PUBLIC_ENABLED = false;` → `true;` **한 줄**
- 여는 축(`SEOUL_17_ENABLEMENT`): app·search·map·detail·cronSync(DB-first 읽기). 닫힌 채: report·stats·supply·sitemap·seoIndex. 17구는 DB 전용(live MOLIT 관문 닫힘). "서울특별시 전체" 계속 숨김.
- GO_LIVE_SWITCH_SAFE = YES (`seoul-25-go-live-switch.test.ts`, `seoul-25-preview-on.test.ts`, `seoul-25-beta-prep.test.ts` 포함 지역 테스트 통과)

## 롤백

같은 줄을 `false`로 되돌려 배포. 데이터 삭제 없음 · cron(seoul-b/seoul-c) 계속 · 서울 8구·부산·경기 불변 · DB 롤백 없음. ROLLBACK_READY = YES

## 테스트 (실행한 명령)

| 명령 | 결과 |
|---|---|
| 지역·Seoul25·sitemap·리포트 대상 테스트 | 174/174 → 수정 후 관련 188/188, `seoul-25-final-qa.test.ts` 6/6 |
| 전체 src 테스트 | 2745 중 2738 pass · fail 2(기존 worktree CRLF: community-launch §15, recent-auth-parity §5) · skip 5 |
| `npx tsc --noEmit` | 21 errors 전부 `scripts/`(FAIL_EXISTING_SCRIPT_ERRORS), src 0 |
| eslint(변경 파일) | error 0, 기존 warning 2(apt-client 사용 안 하는 disable 주석) |
| `npm run build` | PASS(`cf44df6` 기준 로컬) · 최종 `0a1a088` 트리는 Vercel Preview 빌드 Ready |

## 알려진 한계 / 다음

- Preview의 `/sitemap.xml`은 500(읽기 전용 Preview DB 역할 권한 범위 문제로 보임, go-live 코드와 무관) — Production sitemap은 200·17구 0건
- 17구 이집점수는 "데이터 부족"(Score 피처 미산정) — Score는 이번 범위 밖, 변경 없음
- 17구 공급(청약홈) 공개는 별도 결정
- 다음: **PRODUCTION_SEOUL25_PUBLIC_ENABLE_APPROVAL** — 승인 시 go-live 브랜치를 main에 합치고 스위치 한 줄을 true로 바꿔 배포
