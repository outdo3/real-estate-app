# GYEONGGI8 PREVIEW DEPLOY + FULL QA V1 (2026-09-30)

## 결론

**부분 완료 — Kakao 도메인 등록 대기.** 경기 8구 Preview가 배포됐고 지도 외 전 항목(셀렉터·검색·상세·전월세·닫힌 면·점수 표시·학교·모바일 비지도 화면·Production 회귀·cron·DB 안전)이 통과했다.
지도는 Kakao JS SDK가 이 Preview 도메인을 거부해 로드되지 않는다(서울25 Preview 때와 같은 증상) → 사용자 Kakao Developers 등록 필요. 지도·마커 시트·지도 안내 문구·지도 모바일 QA는 등록 뒤 진행.

## 배포

| 항목 | 값 |
|---|---|
| Preview 브랜치 | `gyeonggi-8-public-beta-preview-v1` — `567cd19` → `b057386`(fast-forward, force push 없음). 트리 = `gyeonggi8-final-prep-v2` `c6a1f15`(origin/main `4be3c02` + 경기 8구 Preview 준비) |
| 배포 | `dpl_BuNKKyjULXcQ7Z9p92FsohbwRxWm` Ready · alias `https://real-estate-app-git-gyeonggi-8-public-beta-preview-v1-park11.vercel.app` |
| Preview 플래그 | `NEXT_PUBLIC_GYEONGGI_8_BETA_PREVIEW` — Preview, 이 브랜치 한정(기존) |
| Preview DB | `PREVIEW_DATABASE_URL`(sensitive, 기존 `ejip_preview_ro` 연결)의 **적용 브랜치를 `seoul-25-public-beta-prep-v2` → 이 브랜치로 옮김**(Vercel API PATCH gitBranch). 값은 읽거나 복사하지 않았다(sensitive라 읽을 수 없음). 서울25 Preview는 공개 완료로 역할이 끝났고, 이미 만들어진 서울 Preview 배포는 배포 시점 env를 그대로 쓴다 |
| Production env | 변경 없음(`DATABASE_URL`은 Production 전용 그대로) |
| DB 역할 | `ejip_preview_ro`: SELECT 전용 22개 테이블(비 SELECT 권한 0), `default_transaction_read_only=on`, 연결 한도 15, RLS 우회 없음 — 권한 변경 0 |

## Kakao

- 증상: SDK 스크립트(`dapi.kakao.com/v2/maps/sdk.js`)는 요청되지만 `window.kakao`가 정의되지 않고 화면은 "지도를 불러오지 못했습니다".
- **등록할 도메인(사용자 작업)**: `https://real-estate-app-git-gyeonggi-8-public-beta-preview-v1-park11.vercel.app` (Kakao Developers → 앱 → 플랫폼 → Web 사이트 도메인). Production 설정은 건드리지 않음.

## QA 결과 (Preview, 합성 없음·검증된 DB 대상만)

| 항목 | 결과 | 근거 |
|---|---|---|
| 셀렉터 | PASS | 시도: 서울·부산·경기도 · 경기도 → 정확히 8개(수원시 장안·권선·팔달·영통, 성남시 수정·중원, 의정부시, 광명시), 분당 없음, "경기도 전체" 없음 · 375/390: 8개, 잘림 0, 버튼 높이 47px |
| 검색 | PASS 8/8 | 8개 대상 전부 정확한 aptSeq·구로 적중, aptSeq↔구 불일치 0, aptSeq 없음 0, 41135 0("주공1"은 공개된 서울·부산 동명 단지도 함께 — 정상 이름 검색) |
| 상세 | PASS 8/8 | 전부 `tradeDataSource=DB`·단일 aptSeq·다른 단지 섞임 0 · 최근 거래 2026-09-12~09-23 · 준공연도 정상 · 화면: `noindex, nofollow`, canonical 없음, 리포트 CTA 없음, 미지원 안내 없음 |
| 전월세 | PASS | 8/8 서버: DB 전용 관문에서 네트워크 없이 닫힘(`monthsSucceeded 0`, "이 지역의 이 거래 유형은 아직 제공 준비 중입니다") · 화면: Hero "준비 중", 안내 문구, "전체 평형 · 준비 중"("총 0건"·"요청 실패"·"조회 중" 없음) · 매매 탭 정상 |
| 닫힌 면 | PASS | 통계 랭킹 closed · 리포트(단지·구) "만들 수 없는" + noindex · 공급 `UNSUPPORTED` 0행 · Preview sitemap은 500(읽기 전용 역할 권한 범위, 서울25 Preview와 같음) — Production sitemap 경기 0 |
| 이집점수 | PASS(안전) | "점수 산정에 필요한 데이터가 부족합니다." + 단지브리핑 제한 안내 — 숫자·기본값·다른 지역 점수 없음. 경기 Score 산정 여부는 제품 결정 필요 |
| 학교 일반구 | PASS | 수원 4구·성남 2구 학교 목록 51/59/39/65/37/34, 구 간 중복 0(예전 버그는 수원 4구가 한 목록) |
| 모바일 375/390 (지도 제외) | PASS | 홈·셀렉터(경기 8구)·상세 2곳·전월세: 가로 넘침 0, 오류 0, 작은 터치 목표 0 |
| 지도·마커·null 좌표 런타임·지도 안내 문구 | **BLOCKED(Kakao)** | 등록 뒤 진행. 서버 쪽 지도 데이터는 준비됨(런타임 전 단계에서 null 좌표 제외는 테스트로 고정) |

## Production 회귀 (e-jip.com)

- 경기 8구 계속 차단: 검색 0(매교역·화서역), 지도 API `regionUnsupported`, 공급 `UNSUPPORTED`, sitemap 경기 0
- 서울25: 강남 지도 마커 375, 은마 검색 정상 · 부산: 해운대 지도 마커 275

## 안전

- 경기 8구 live MOLIT: 0 — 검색·상세·전월세 모두 검증된 aptSeq로만 호출, 전월세는 관문에서 네트워크 없이 닫힘. 학교 목록은 기존 교육 데이터 경로(MOLIT 아님).
- DB 쓰기 0(매매 이력 539,661 그대로) · 스키마 변경 0 · 권한 변경 0 · cron 수동 실행 0
- cron 자연 실행 재확인: 매매 `sale-2026-09-29T20-02` 24셀 +8/수정 1, recheck `sale-recheck-2026-09-30T00-11` 80셀, 202508–202608 104/104 COMPLETE → PASS
- Preview DB 연결: 최종 보고 참조(QA 동안 `ejip_preview_ro` 세션 샘플링)

## 테스트

코드 수정 없음(배포 트리 = `c6a1f15`). 준비 단계에서 같은 트리로 실행한 결과: 전체 src 2766 중 2759 pass(fail 2 = 기존 worktree CRLF) · 경기·지역 대상 전부 통과 · tsc src 0 · build PASS. Vercel Preview 빌드 Ready.

## Production 공개 준비 (실행 안 함)

- 변경: `src/lib/region/enablement.ts` — `export const GYEONGGI_BETA_ENABLED = false;` → `true;` **한 줄**
- 열리는 것: 경기 8구 app·search·map·detail·cronSync(DB 읽기) · 셀렉터 경기도(8구만)
- 닫힌 채: report·stats·supply·sitemap·seoIndex · 41135·나머지 경기 · "경기도 전체" · 전월세 준비 중 · live MOLIT 차단(DB 전용 관문)
- 테스트 `gyeonggi-8-final-prep.test.ts` 5·6·7·8·9·10이 켰을 때 범위를 고정 → PRODUCTION_SWITCH_SAFE = YES
- 공개 전 필요: Kakao 등록 → 지도 Preview QA 통과, 이집점수 표시 정책 결정, Production 공개 승인

## 남은 것

1. Kakao Developers에 Preview 도메인 등록(사용자) → 지도·마커 시트·null 좌표 런타임·지도 안내·지도 모바일 QA
2. 경기 이집점수 정책(현재 "데이터 부족" — 안전)
3. Production 공개 승인
