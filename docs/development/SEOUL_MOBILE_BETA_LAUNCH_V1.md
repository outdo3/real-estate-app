# SEOUL MOBILE BETA LAUNCH V1

- 일시: 2026-09-24 (KST) · 사용자 명시 승인
- 커밋: `cf2293a` feat: launch Seoul 8-district mobile beta (Vercel success 2026-09-24T12:37:41Z)
- 결과: **SEOUL_MOBILE_BETA = LIVE** · 공개 8구 11110 11140 11170 11215 11230 11410 11440 11545
- DB write 0 · migration 0 · cron 수동 실행 0

## 1. 변경

| 파일 | 내용 |
|---|---|
| `src/lib/region/enablement.ts` | `SEOUL_BETA_ENABLED` false → **true** (이외 무변경) |
| `src/app/api/search/route.ts` | 입지 피처가 없는 aptSeq만 같은 aptSeq의 master 좌표로 보충 |
| `src/app/map/page.tsx` | 좌표가 없는 검색 결과로 (0,0) 이동 대신 "위치 정보가 없어…" 안내 |
| 테스트 4개 | beta OFF 고정 assertion 10건을 launch 상태로 갱신(OFF는 시뮬레이션 유지) + 좌표 회귀 3건 |

allowlist · `ENABLEMENT_BY_SIDO`('11' 없음) · report/stats/sitemap/seoIndex 축 · 부산 · cron scope 무변경.

### 추가 보정 2건의 근거(launch 필수)

beta ON 로컬 검증에서 발견: `apartment_location_features`는 부산 전용(서울 0행)이라 서울 검색 결과가 `lat/lng: null`
→ `ApartmentAutocomplete`가 0으로 바꿔 지도가 (0,0)으로 이동. 읽기 전용 측정: beta 8구 master 1,519 중 좌표 보유 1,493.
보충은 피처가 없는 aptSeq에만 적용 — 부산 피처 보유 3,401 불변, 부산 피처 없는 35개는 null → master 좌표(같은 aptSeq, 지도 마커와 동일 좌표).
좌표가 끝내 없는 단지(서울 26 등)는 지도가 이동하지 않고 오피스텔과 같은 안내를 낸다.

## 2. 정책 진리표(런타임)

| 대상 | app | report | stats | sitemap | seoIndex | cronSync(DB-first 읽기) |
|---|---|---|---|---|---|---|
| 부산 16 | O | O | O | O | O | O |
| 서울 승인 8 | **O** | X | X | X | X | O |
| 강남 11680 · 나머지 17 | X | X | X | X | X | X |
| 서울 시도 전체(sidoCode=11) | X | X | X | X | X | X |

## 3. 검증

- 테스트: src 2055/2055 (이전 2052 + 신규 3; OFF 고정 10건은 갱신) · tsc src 0(전체 27건은 전부 기존 scripts/tmp — FAIL_EXISTING_SCRIPT_ERRORS) · eslint 0 · build 0
- Live 검색: 8구 대표 단지 전부 해당 lawdCd로만 반환, 좌표 포함 · 은마/헬리오시티/반포자이/압구정동 0건 · 해운대 부산 15건
- Live 상세 API(aptSeq 포함): 8구 전부 `tradeDataSource=DB`, 거래의 aptSeq·단지명 단일(대체 없음), 부산 동일
- Live 차단: 강남·송파·서초 상세 API `UNSUPPORTED_REGION` · 상세 페이지 일반 제목 + noindex,nofollow
- Live SEO: 승인 구 상세 = 단지 제목 + noindex,nofollow + canonical 없음 · 서울 리포트(아파트/구/동) 차단 + noindex · sitemap 140, 서울 0
- Live 통계: dashboard/feed/gap-invest/concentration/region-change/price-rankings/yearly/large-complex/rankings 서울 = UNSUPPORTED, 부산 = OK · supply 마포 OK / 강남·서울 전체 UNSUPPORTED
- 브라우저(767px — 확장 패널 때문에 더 좁힐 수 없음): 지도 검색 → 마포아이파크포레 선택 마커 21.45억 · 상세 최근 21억 4,500만(2026.09.12), 타임라인, 지도, ㎡ 폴백 · 선택기 서울 8구만, "서울특별시 전체" 없음 · 마포구 선택 후 통계 "준비 중" · 뒤로가기 정상 · 부산 16구 + "부산광역시 전체" · 가로 overflow 0 · 콘솔 오류 0

## 4. 알려진 한계 / 후속

- 참존1차 `11440-3936` master 공백 — 마커를 만들지 않는다(설계대로)
- 서울 전월세·입지 피처·시장 피처·평형(Unit Master) 없음 → 상세에서 "정보 없음"/㎡ 표시, 전월세 탭 비어 있음
- 이집점수: 서울은 `INSUFFICIENT_DATA`(점수 null, 일부 카테고리만) — 공식 변경 없음
- 리포트·통계 미준비(서울 전부 차단). 상세의 "한 장으로 정리" CTA는 서울에서 준비 중 화면으로 간다 — 서울에서 숨길지 후속 검토
- 지도 "현재 위치는 부산 외 지역" 안내, 홈 본문, 통계 기본 '부산 전체' 라벨이 부산 전용 문구 — 후속
- 학교 sidoCode 필터: 서울 입지 피처 backfill 전에 정리 필요
- `/stats/compare` 본문에 차단 서울 단지명이 시드로 렌더되는 UX — 후속
- 상세 3년 창은 서버 시간대 기준 날짜 경계(Vercel UTC)라 경계일 거래 1건 차이가 날 수 있다 — 기존 동작, 부산 동일
- 360/375/390px 실측 불가(Chrome 최소 창 폭) — 767px에서 overflow 0 확인
