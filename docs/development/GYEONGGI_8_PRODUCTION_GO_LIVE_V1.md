# GYEONGGI8 PRODUCTION PUBLIC ENABLE + FINAL SMOKE V1 (2026-09-30)

## 결론

**PASS — 경기 8구 공개 beta LIVE.** 사용자 승인으로 `GYEONGGI_BETA_ENABLED` 한 줄을 true로 바꿔 Production에 배포했고,
즉시 smoke QA 전 항목이 통과했다. 롤백 불필요.

## 배포

| 항목 | 값 |
|---|---|
| 스위치 | `src/lib/region/enablement.ts` `GYEONGGI_BETA_ENABLED = false` → `true` (사용자가 직접 수정) |
| 통합 | `gyeonggi8-final-prep-v2`를 origin/main `4be3c02`에 fast-forward (`c6a1f15` 준비 · `d03bbe3`·`56db36d` 문서 · `a3f8267` 공개) — force push·history rewrite 없음 |
| 공개 커밋 | `a3f8267` feat(gyeonggi8): enable public Gyeonggi 8 beta |
| Production 배포 | `dpl_8UHcVcGiZZhEBCRvQjJFCDDBUswR` READY (2026-09-30 07:37Z 생성) · SHA `a3f8267` |
| Production env | 변경 없음 |
| 사용자 로컬 main 체크아웃 | 건드리지 않음(작업 파일 42개, 84e1c61) |

## 공개 범위

- 열림(8구 41111·41113·41115·41117·41131·41133·41150·41210): app·선택기·search·map·detail·DB 읽기(cronSync)
- DB 전용: 8구 live MOLIT는 api-molit 관문에서 네트워크 없이 닫힘 → 전월세 "준비 중"
- 닫힘: report·stats·supply·sitemap·seoIndex · 41135 · 나머지 경기 전 구 · "경기도 전체"(시도 층 41 없음)
- 이집점수: 산정·가공 없음 — `INSUFFICIENT_DATA`, score null, 화면 "점수 산정에 필요한 데이터가 부족합니다."

## 테스트 (공개 커밋 트리)

| 명령 | 결과 |
|---|---|
| 전체 src 테스트 | 2766 중 2759 pass · fail 2(기존 worktree CRLF: community-launch §15, recent-auth-parity §5) · skip 5 — 공개 전 기준선과 같음 |
| scripts 테스트 | 344 중 342 pass · fail 1(BENCHMARK, DATABASE_URL 필요 — 기존) · skip 1 |
| `npx tsc --noEmit` | 21 errors 전부 `scripts/`(기존), src 0 |
| eslint(변경 파일) | 0 |
| `npm run build` | PASS |

공개 전 "경기 닫힘"을 고정하던 테스트 14개 파일을 공개 상태로 옮겼다(축 개수 41→49, 경기 8구 상세 SEO BLOCKED→NOINDEX,
DB 전용 = 서울 17 + 경기 8, 선택기 경기 표시). 41135·나머지 경기·report·stats·supply·sitemap·seoIndex 닫힘은 계속 단언한다.
경기 master seed의 노출 가드는 이제 8구 × 4축을 열린 것으로 계산하므로 seed apply는 `PUBLIC_EXPOSURE_NOT_GUARDED`로 거부된다
(보수적 방향 — master 1,193은 이미 적재됨).

## Production smoke (e-jip.com, 검증된 aptSeq·DB 대상만)

| 항목 | 결과 | 근거 |
|---|---|---|
| 선택기 | PASS | 데스크톱·375·390: 서울·부산·경기도 → 경기도 = 정확히 8구, 분당·"경기도 전체" 없음, 잘림 0, 버튼 48px |
| 검색 | PASS 8/8 | 8개 대상 정확한 aptSeq·구·동, aptSeq↔구 불일치 0, aptSeq 없음 0, 41135·다른 경기 0 · "분당구"·"동안구" 지역 결과 0 |
| 지도 API | PASS | 41111:139 · 41113:173 · 41115:107 · 41117:143 · 41131:82 · 41133:86 · 41150:270 · 41210:97 = 1,097 (Preview와 정확히 같음), 다른 구 0, null/0,0 좌표 0 |
| 지도 화면 | PASS | 8구 전부 Kakao SDK·가격 라벨·선택 시트 이름·상세보기·URL aptSeq 유지, 안내 문구·로드 실패 없음 |
| null 좌표 19개 | PASS | 마커 0/19 · 딥링크(41150-47) 375/390: 시트 없음, aptSeq 제거, 오류 없음 |
| 마커 → 시트 → 상세 | PASS | 41117(데스크톱)·41131(375)·41150(390)·41210(375): 같은 구 aptSeq → 같은 aptSeq·lawdCd 상세, 구 이름 표시 |
| 상세 | PASS 8/8 | `tradeDataSource=DB`, 단일 aptSeq, MOLIT 월 0, 거래 236–755건(2023-10~2026-09) · 화면 5곳 `noindex, nofollow`, canonical 없음, 리포트 링크 없음 |
| 전월세 | PASS 8/8 | 0행 · MOLIT 월 0 · "이 지역의 이 거래 유형은 아직 제공 준비 중입니다" · 화면 375/390 "준비 중", "총 0건"·실패 문구 없음, 매매 탭 정상 |
| 이집점수 | PASS | API `INSUFFICIENT_DATA`·score null · 화면 "점수 산정에 필요한 데이터가 부족합니다." |
| 닫힌 면 | PASS | 공급 `UNSUPPORTED`(8구·분당·경기 전체) · 리포트(단지·구) noindex + 차단 문구 · 통계 `UNSUPPORTED_REGION` · sitemap 139 URL 중 경기 0 |
| 미지원 경기 | PASS | 41135·41173: 지도 마커 0 + `regionUnsupported` + 상단 안내 + "아직 지원하지 않는 지역…", 가짜 0건 문구 없음 · 상세 API `UNSUPPORTED_REGION` 0행 · 선택기·검색 없음 |
| 안내 문구 | PASS | 경기 8구·강남·해운대 안내 없음, "부산 외 지역" 문구 0 |
| 모바일 375/390 | PASS | 선택기·지도·마커 시트(하단 탭 위)·상세·전월세: 가로 넘침 0 |
| 학교(NEIS) | PASS | 수원 4구·성남 2구 초중고 각각 분리(47/58/36/64/34/34), 구 간 중복 0, 주소 불일치 0 |

## 회귀

- 서울25: 은마 `11680-218` 검색·상세(DB, 161건, 최근 2026-09-28) 정상 · 강남 지도 마커 375 그대로
- 부산: 해운대 지도 마커 275 그대로 · `26350-2328` 검색·상세(DB) 정상

## 안전

- 경기 8구 live MOLIT: 0 — DB 전용 관문, 전 요청 `monthsSucceeded 0`, 모르는 단지명 탐침 0
- Production DB(읽기 전용 샘플 164회, 07:36–07:50Z, max_connections 60): 최대 15, active 최대 2, 대기 0, 연결·timeout 오류 0
- DB 쓰기 0 · 스키마 변경 0 · 권한 변경 0 · 매매 이력 539,661 그대로
- cron: `vercel.json` 변경 0, 수동 실행 0, 최근 자연 실행(`sale-2026-09-29T20-02` 24셀, `sale-recheck-2026-09-30T00-11` 80셀, 202508–202608 104/104) 정상

## 롤백 (필요 없음)

`GYEONGGI_BETA_ENABLED`를 false로 되돌린 한 줄 커밋 → main push → Production 배포 → 경기 차단·서울·부산·cron 확인. 데이터 롤백 없음.

## 남은 것 (공개 범위 밖)

- 경기 전월세 데이터
- 경기 리포트·통계
- 경기 공급(청약홈)
- 경기 SEO·sitemap
- 경기 이집점수 산정
- 41135 분당(REVIEW 4행)·나머지 경기
- `enablement.ts` 스위치 위 주석이 아직 "false = 경기 전 축 닫힘(현재)" — 다음 코드 변경 때 정리
