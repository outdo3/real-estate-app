# SEOUL25 GO-LIVE CHECKLIST V1 — 서울 25구 Production 공개 준비 · QA · 롤백

작성: 2026-09-30 · 브랜치 `seoul-25-go-live-prep-v1`(main `377acf7` 기준, LOCAL — push·배포 안 함)
상태: **준비 완료, 스위치 꺼짐.** 17구 Production 공개는 사용자 최종 승인 뒤 한 줄 변경으로만 켠다.

## 1. 현재 Production 상태 (main 377acf7) vs go-live 목표

enablement 축(`src/lib/region/enablement.ts`). `cronSync`는 **DB-first 읽기** 스위치이고, 정기 수집(cron) 범위는 `src/lib/sync/sale-sync-scope.ts`가 따로 정한다.

| 축 / 표면 | 부산 16 | 서울 8 | 서울 17 현재 | 서울 17 go-live 목표 | 경기 8 |
|---|---|---|---|---|---|
| app(선택기) | ON | ON | OFF | **ON** | OFF |
| search | ON | ON | OFF | **ON** | OFF |
| map | ON | ON | OFF | **ON** | OFF |
| detail | ON | ON | OFF | **ON** | OFF |
| cronSync(DB 읽기) | ON | ON | OFF | **ON** | OFF |
| live MOLIT | 사용 | 사용 | (닫혀 있어 호출 전 차단) | **차단(DB 전용)** | (닫힘) |
| supply | ON | ON | OFF | OFF | OFF |
| report | ON | OFF | OFF | OFF | OFF |
| stats | ON | OFF | OFF | OFF | OFF |
| sitemap | ON | OFF | OFF | OFF | OFF |
| seoIndex | ON | OFF | OFF | OFF | OFF |
| 정기 수집(cron) | 기본 scope | `seoul` | `seoul-b`·`seoul-c`(377acf7) | 그대로 | `gyeonggi` |
| "서울특별시 전체" | — | 숨김 | 숨김 | **숨김 유지**(`isSidoWholeQuerySupported`) | — |

supply·report·stats·sitemap·seoIndex는 **이 스위치로 열리지 않는다.** 여는 것은 별도 제품 결정이다.

## 2. GO-LIVE 스위치

| 항목 | 값 |
|---|---|
| 위치 | `src/lib/region/enablement.ts` — `export const SEOUL_17_PUBLIC_ENABLED = false;` |
| 현재 | `false` (17구 Production 전 축 닫힘) |
| 목표 | `true` |
| 효과 | `SEOUL_17_OPEN = SEOUL_17_PUBLIC_ENABLED \|\| SEOUL_25_BETA_PREVIEW_ENABLED` → 17구에 `SEOUL_17_ENABLEMENT`(위 표) 적용 + `isDbOnlyLawdCd`로 live MOLIT 차단 |
| 같은 프로필 | Preview(2026-09-29 QA PASS)와 Production 공개가 **같은 `SEOUL_17_ENABLEMENT`**를 쓴다 — Preview에서 검증한 것이 그대로 나간다 |
| 고정 테스트 | `src/lib/region/seoul-25-go-live-switch.test.ts` — 스위치가 리터럴 `false`인 것까지 고정. 켤 때는 이 테스트의 첫 항목(현재 닫힘)을 "열림"으로 함께 바꾼다 |

## 3. 데이터 경로 (A4)

- 검색: `/api/search` — `apartment_masters` DB 조회(공개 allowlist `sggCd IN`). MOLIT 없음.
- 지도: `/api/transactions?months=12`(지도 모양) — `isTradeDbFirstLawdCd` = `cronSync` → DB. 다른 모양(목록 paging)은 MOLIT 경로지만 17구는 관문에서 실패로 닫힌다(“0건” 위장 없음).
- 상세: `/api/apt/[name]` — 월별 MOLIT 루프가 먼저 돌지만 17구는 `fetchMolitData` 관문에서 **네트워크 없이** 실패 플레이스홀더 → DB-first(`cronSync`)가 매매 거래를 채우고, DB를 쓰면 apiError를 올리지 않는다(기존 규칙).
- 관문: `src/lib/api-molit.ts` `fetchMolitData` 맨 앞 `if (isDbOnlyLawdCd(params.lawdCd)) return molitFailurePlaceholder(...)`.
- NEW17_PRODUCTION_DATA_SOURCE = **DATABASE** · NEW17_PRODUCTION_MOLIT_FALLBACK = **BLOCKED**.

## 4. go-live 전 결정 필요(열린 항목)

1. **상세 전월세 탭**: 서울에는 전월세 DB가 없다. DB 전용 정책이면 17구 상세의 전월세 탭은 실패 상태(“이 지역의 이 거래 유형은 아직 제공 준비 중입니다”)로 보인다. 서울 8구는 지금 live MOLIT로 전월세를 보여준다 → 25구 안에서 동작이 갈린다. 선택: (a) 그대로(정직한 준비 중) (b) 17구 전월세만 MOLIT 허용(정책 예외 승인 필요) (c) 서울 전월세 적재 후 공개.
2. **최신 월 catch-up 확인**: 첫 cron 실행(2026-09-29 19:45Z~) 검증 PASS 전에는 켜지 않는다(`s17-cron-verify`).
3. **서울 8구 supply ON vs 17구 supply OFF**: 한 서울 안에서 공급 탭 동작이 갈린다. 의도(데이터 정책) 확인.

## 5. 공개 QA 체크리스트 (재사용)

대표 구: 11200 성동 · 11350 노원 · 11500 강서 · 11650 서초 · 11680 강남 · 11710 송파. Preview(같은 프로필)에서 먼저, 배포 직후 Production에서 다시.

| # | 항목 | 기대 | 방법 |
|---|---|---|---|
| 1 | 선택기 | 서울 25구, 중복 0, "서울특별시 전체" 없음 | /stats 지역 모달 |
| 2 | 검색 | 대표 단지가 자기 구 lawdCd로만 나옴 | `/api/search?q=` 은마·헬리오시티·반포자이·상계주공·우장산·왕십리 |
| 3 | 지도 | 마커 렌더, 12/12개월, failedMonths 0 | `/api/transactions?type=apt&lawdCd=&months=12&fields=marker` + 화면 |
| 4 | 마커 클릭 | URL `aptSeq`가 그 단지 · 시트 이름/동/가격 일치 | 은마 11680-218 등 |
| 5 | 상세 | `tradeDataSource=DB`, trades aptSeq 단일, 최신 거래일 합리적 | `/api/apt/[name]?aptSeq=` |
| 6 | aptSeq 정확성 | 마커→상세 이동에 aptSeq 유지 | 상세보기 |
| 7 | 모바일 375 | 가로 넘침 0, 검색·하단 탭 보임, 시트 버튼 48px·탭 위 | iframe 375 + 실제 탭 |
| 8 | 모바일 390 | 같은 항목 | iframe 390 |
| 9 | 서울 전체 | 선택기·통계·공급 어디에도 없음 | 모달 · `/api/stats/supply?sido=서울특별시` |
| 10 | MOLIT 없음 | 17구 비지도 모양 = failedMonths 전부(네트워크 0) · 상세 apiError null | `/api/transactions?months=3` |
| 11 | 교차 구 누수 | 지도 행 aptSeq 접두사 = 요청 구(없으면 원천 공란 행만) | 지도 API 집계 |
| 12 | 리포트·통계·공급 누수 | report BLOCKED/준비 중 · stats·supply UNSUPPORTED · 상세 리포트 CTA 없음 | `/report/apt/…` · `/api/stats/*` |
| 13 | SEO | 상세 `noindex`, canonical 없음, sitemap에 17구 URL 0 | 페이지 head · `/sitemap.xml` |
| 14 | 미공개 지역 안내 | 서울 25구에서는 안내 없음 · 미공개 지역(예: 경기)에서만 표시 | 지도 |
| 15 | 서울 8구 회귀 | 검색·지도·상세·supply 그대로 | 마포 11440 |
| 16 | 부산 회귀 | 전 축 그대로 | 26350 |
| 17 | 경기 회귀 | 전 축 닫힘 | 41111 |
| 18 | DB 건강 | 대기 0, idle-in-tx 0, 읽기 ~100ms | 건강 스크립트 |

## 6. 롤백

1. `src/lib/region/enablement.ts`의 `SEOUL_17_PUBLIC_ENABLED`를 `false`로 되돌리는 커밋(또는 go-live 커밋 `git revert`) → main push → Production 배포.
2. 효과: 17구 전 축 즉시 닫힘(선택기·검색·지도·상세 → UNSUPPORTED), DB 전용 관문도 꺼짐(17구가 닫혀 호출 자체가 없음).
3. 그대로 두는 것: 적재 데이터(1,180,587행 + cron 증분), cron(`seoul-b`·`seoul-c` — 공개와 무관, 안전하면 계속), 서울 8구·부산·경기, env.
4. DB 롤백 없음 · 데이터 삭제 없음.
5. 확인: 체크리스트 15–17 + 17구 대표 검색·지도·상세가 UNSUPPORTED.
