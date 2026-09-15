# E-JIP SEOUL / GYEONGGI EXPANSION DATA AUDIT V1

서울특별시 + 경기도 확장 전 데이터·구조 준비도 전수 감사. **READ-ONLY.**

- 날짜: 2026-09-16 (KST)
- 기준 커밋: `53594e7` (origin/main `15979d7` + 로컬 docs 1건)
- 방법
  - Production DB: `scripts/audit-seoul-gyeonggi-expansion.ts` — `SET TRANSACTION READ ONLY` + `statement_timeout 120s`, 서버측 집계만(행 materialization 없음), write 0, 외부 API 0. 39개 쿼리 총 49.7s
  - 지역 코드: 앱이 이미 쓰는 법정동코드 프록시(`REGCODE_PROXY`)로 서울/경기/부산 시군구·읍면동 목록 조회(메타데이터, 부동산 데이터 수집 아님)
  - 코드: 영역별 정적 분석(파일:라인 근거)
- 하지 않은 것: INSERT/UPDATE/DELETE, migration, schema, bulk sync, MOLIT·Kakao·TAGO 호출, geocode, region enable, sitemap/색인 변경

---

## 0. 결론 요약

**판정: ARCHITECTURE_WORK_REQUIRED** (+ 대규모 DATA WORK)

1. **Production DB에 서울/경기 아파트 데이터가 사실상 없다.** 단지 마스터 서울 0 · 경기 0, 매매 서울 46행(강남구 11680, 2026-08-01~24 QA 파일럿, 부분 월) · 경기 0, 전월세 0, 오피스텔 0, 학교 0, 위치 피처 0. 부산은 마스터 3,438 · 매매 864,879 · 전월세 125,875.
   → "커버리지 %"를 계산할 대상 자체가 없다. 서울/경기의 모든 데이터 도메인은 **DATA_GAP(0%)**이며, 행 수 규모는 DB로 산출할 수 없다(§21·§22는 구조적 배수와 공식 코드 목록으로만 추정).
2. **지역 구조가 부산 전용으로 굳어 있다.** 리포트 스코프 allowlist, `/report/city/busan` 고정 경로, `'26'` prefix DB-first 분기 ≥7곳, 부산 16개 코드 사본 3곳, cron 기본 lawdCd, 점수 peer pool(`sido:'부산'`), 학교 교육청 코드(C10)·배정구역 artifact, 오피스텔 스크립트·좌표 backfill 모두 부산 고정.
3. **경기도 2단계(시+일반구)는 일부만 표현 가능하다.** SEO 이름 빌더와 법정동코드 프록시는 `경기도 성남시 분당구(41135)`를 표현하지만, `REGION_DATA`·통계/학군 메타 검증·AI검색·분양 지역 파서·리포트 스코프 타입은 시(`성남시`)까지만 안다. 경기 시군구 코드는 48개 중 **부모 시 코드 6개(41110 수원시 등)**가 섞여 있어 MOLIT lawdCd로는 **42개 leaf**만 써야 한다.
4. **점수는 서울에서 왜곡된다.** 교통 곡선·학교 곡선·단지 주차 fallback이 부산 실측으로 보정됐고, 1km 컷오프·Kakao 15건 페이지 한계는 고밀도 서울에서 더 자주 걸린다. peer context는 서울 단지를 부산 풀과 비교한다.
5. **동기화 파이프라인은 확장 규모에서 안전하지 않다.** cron 3종이 부산 16개 기본값이고, sale/rent sync는 고정 순서 + 50s 예산이라 뒤쪽 구가 영영 처리되지 않는 구조. MOLIT 일일 한도는 코드·문서 어디에서도 확정되지 않았다(과거 부산 backfill이 1,620/3,968에서 quota로 중단).
6. **바로 쓸 수 있는 것**: 분양(서울 96·경기 365행, 좌표 84%·62%), 재개발 목록(서울 644·경기 241, MOLIT 소스, **좌표 0%**), SEO 이름/설명 템플릿, 오피스텔·지도 read path의 lawdCd 중립성, 법정동코드 프록시.

---

## 1. 현재 지역 아키텍처

분류: **A** 전국 대응 · **B** 부산 설정값만 · **C** 부산 로직 하드코딩 · **D** 데이터 한계 · **E** 구조 한계

| 영역 | 위치 | 내용 | 분류 |
|---|---|---|---|
| 시도/시군구 목록 | `src/lib/regions.ts:1-21` REGION_DATA | 서울 25구 있음. 경기는 **시/군 단위만**(`성남시`, 일반구·lawdCd 없음) | E |
| 법정동코드 | `src/lib/region-utils.ts:1,29,62,79,100` REGCODE_PROXY | 전국 동적 조회. `resolveRegionNameByLawdCd`는 `성남시 분당구`를 sigungu로 반환 | A |
| 표시명 | `src/lib/region-display-name.ts:46` | 순수 템플릿(`성남시 분당구` 테스트 있음) | A |
| 지역 상태 | `src/contexts/RegionContext.tsx:7-26,43-50` | `{lawdCd, sidoCode, sido, sigungu, dong}` — 시/구 분리 필드 없음. 기본값 부산 | E(약) · B |
| 지역 선택 | `src/components/RegionSelectModal.tsx:52,75,107,126` | 프록시 3단계(시도→시군구→동). "성남시 전체" 같은 중간 단위 선택 불가 | A · E |
| 리포트 스코프 | `src/lib/report/region-scope.ts:23-40,47,70` | BUSAN_DISTRICTS 16 allowlist, `kind: GU/GUN`, 부모 시 필드 없음 | B · C · E |
| 리포트 경로 | `src/app/report/city/busan`, `report-links.ts:32-34` | 시 리포트가 부산 고정 경로, 인자 없음 | C · E |
| 리포트 조립 | `region-report.ts:91-98,271`, `region-read.ts:94,131,188`, `daily-read.ts:86,101,135` | displayName `부산 …` 고정, CITY = 부산 16 | C |
| 통계 진입 | `stats-report-entry.ts:27,69,90` | `REPORT_SIDO_CODE='26'` | B · C |
| 지도 | `busan-bounds.ts:15`, `OutOfBusanNotice`, `map/page.tsx:484,526,726`, `map-marker-share.ts:22` | 부산 bbox·기본 lawdCd 26140 | B · C |
| 지도 좌표→지역 | `map/page.tsx:727-748` | Kakao 역지오코딩 코드 앞 5자리 → 일반구 코드 획득 가능(확인 필요) | A |
| 실거래 API | `api/transactions/route.ts:56,111` | `startsWith('26')`이면 DB-first, 아니면 MOLIT live | C |
| 마커/매물 | `api/properties/route.ts:33-37` | lawdCd·sido 텍스트 필터, 지역 중립 | A |
| 검색 | `api/search/route.ts:58-106` | 코드 중립, 마스터 테이블이 부산 전용 | D |
| AI 검색 | `lib/ai-search.ts:90,149`, `api/ai-search/route.ts:20` | REGION_DATA 순회 → `분당구` 인식 불가, 기본 26140 | E · B |
| 통계 시도 목록 | dashboard:221, feed:105, rankings:80, price-rankings:301, gap-invest:65, concentration:81, region-change:167 | `getSigunguListForSido` | A |
| 통계 DB-first | dashboard:48-52, price-rankings:81-85, region-change:31-35, yearly:23,54, `stats/feed-db-source.ts:34` | `'26'` 고정, 그 외 MOLIT live | B · C |
| 통계 기본 시도 | dashboard:152 외 6곳 | `sido \|\| '부산광역시'` | B |
| 대단지 | `api/stats/large-complex/route.ts:13,36-46` | 부산 아니면 거절 | C · D |
| 통계/학군 메타 | `app/stats/page.tsx:13`, `app/school/page.tsx:13` | `REGION_DATA[sido].includes(sigungu)` → `성남시 분당구` 무효 처리 | E |
| 점수 peer | `apartment-score/peer-context.ts:38,55`, `peer-context-pure.ts:23,70-75` | `sido:'부산'` 풀, `BUSAN_ALL` 레벨, sigungu 이름만으로 매칭(서울 중구 ↔ 부산 중구 충돌 위험) | C |
| 코드 사본 | `rent-verified-range.ts:27-30`, `api/admin/ops/route.ts:27-29`, `region-scope.ts` | 부산 16 코드 3벌 | B |
| cron | `sync/sale-sync-core.ts:63`, `rent-sync-core.ts:86`, `sale-recheck-core.ts:109` | `opts.lawdCds ?? BUSAN_LAWDCD_16`, 라우트가 옵션 미전달 | B |
| 전국 CLI | `scripts/incremental-sync-nationwide.ts:77-113` | 프록시로 전국 열거, `--sido/--lawdCd` | A |
| 학교 | `education/attendance-zone.ts:78`, `schoolinfo-stat-validate.ts:41`, `ingest-schools-neis.ts:33` | 부산 배정구역 artifact, 부산 bbox, 교육청 C10 기본 | C · D |
| 재개발 | `redevelopment/parse.ts:79`, `sigunguResolver.ts:35,132` | 부산시 소스 전용 구 정규식(MOLIT 소스는 전국) | C(부산 소스) |
| 분양 지역 | `presale-region.ts:44` | 두 번째 토큰을 REGION_DATA와 대조 → 경기 `성남시`까지만 | E(약) |
| 사이트맵/SEO | `sitemap-scope.ts:21,57`, `seo/region-seo-read.ts:15,31`, `indexnow/sitemap-urls.ts:41,69`, `seo/report-region-seo.ts:23,113` | 부산 범위·안전핀 | B · C |
| SEO 이름 | `seo/region-seo.ts` | `{sido, city, district, dong}` 2단계 지원, 테스트로 분당구·영통구·일산서구 확인 | **A** |
| 서울 강남구 기본값 | `apt-client.tsx:116,204,317`, `api/apt/[name]/route.ts:91`, `info/route.ts:17`, `TableList.tsx:24`, `RankCard.tsx:41` | lawdCd 누락 시 `11680` 기본값 — 확장 시 서울 강남구로 잘못 붙을 위험 | B(버그 소지) |
| 학교 API | `api/school/route.ts:7,48`, `school/stats/route.ts:18` | 기본 `부산광역시 서구`, 서구 특수 처리 | C |

---

## 2. 대상 지역 정의

법정동코드 프록시 실측(2026-09-16):

| 시도 | 시군구 코드 | 부모 시 코드 | MOLIT lawdCd(leaf) | 읍면동 | 리 |
|---|---|---|---|---|---|
| 서울특별시 | 25 | 0 | **25** | 467 | 0 |
| 경기도 | 48 | **6** (41110 수원시 · 41130 성남시 · 41170 안양시 · 41270 안산시 · 41280 고양시 · 41460 용인시) | **42** | 746 | 1,415 |
| 부산광역시(기준) | 16 | 0 | 16 | 192 | 62 |

경기 leaf 42: 수원시 장안·권선·팔달·영통(41111/13/15/17) · 성남시 수정·중원·분당(41131/33/35) · 의정부 41150 · 안양시 만안·동안(41171/73) · 부천 41190 · 광명 41210 · 평택 41220 · 동두천 41250 · 안산시 상록·단원(41271/73) · 고양시 덕양·일산동·일산서(41281/85/87) · 과천 41290 · 구리 41310 · 남양주 41360 · 오산 41370 · 시흥 41390 · 군포 41410 · 의왕 41430 · 하남 41450 · 용인시 처인·기흥·수지(41461/63/65) · 파주 41480 · 이천 41500 · 안성 41550 · 김포 41570 · 화성 41590 · 광주 41610 · 양주 41630 · 포천 41650 · 여주 41670 · 연천 41800 · 가평 41820 · 양평 41830.

현재 모델로 표현 가능한가:

| 지역 | 이름(SEO) | lawdCd | 계층 | 막히는 곳 |
|---|---|---|---|---|
| 서울 강남구 / 송파구 | 가능 | 11680 / 11710 | 시도+구 | 리포트 allowlist, DB-first `'26'`, cron |
| 경기 성남시 분당구 · 수원시 영통구 · 고양시 일산서구 | 가능(`region-seo`) | 41135 · 41117 · 41287 | **시도+시+구** | REGION_DATA(시까지만), stats/school 메타 검증, AI검색, 분양 파서, 리포트 스코프 타입(부모 시 없음), 지역 선택 모달 "시 전체" 불가 |
| 경기 김포시 · 하남시 · 양평군 | 가능 | 41570 · 41450 · 41830 | 시도+시/군 | 리포트 allowlist, DB-first, cron |

**경고**: 프록시 `41*00000` 목록을 그대로 lawdCd로 쓰면 부모 시 코드 6개가 섞인다. 부모 코드로 MOLIT를 부르면 결과가 비거나(확인 필요) 시 전체 집계에서 이중 계산 위험이 있다. 현재 통계 시도 전체 조회(`getSigunguListForSido`)가 이 필터를 하지 않는다(`${sido}000`만 제외).

---

## 3. 단지 마스터 (Production, SELECT)

| 지표 | 부산 | 서울 | 경기 |
|---|---|---|---|
| master rows | 3,438 | **0** | **0** |
| aptSeq non-null / distinct | 3,438 / 3,438 (100%) | — | — |
| aptSeq 형식 오류 | 0 | — | — |
| aptSeq 앞 5자리 ≠ sgg_cd | 1 | — | — |
| 이름 | 100% | — | — |
| sgg_cd 종류 | 16 | — | — |
| umd_name / umd_cd | 100% / 3,402 (99.0%) | — | — |
| jibun | 100% | — | — |
| road_address | 2,624 (76.3%) | — | — |
| build_year | 100% | — | — |
| households | 3,181 (92.5%) | — | — |
| parking | 2,417 (70.3%) | — | — |
| 좌표 non-null | 3,401 (98.9%) | — | — |
| 좌표 0,0 / bbox 밖 | 0 / 0 | — | — |
| geocode exact | 2,833 (82.4%) · normalized 568 · null 36 · failed 1 | — | — |
| 건축물대장 스펙 소스 | TITLE 1,720 · GENERAL_TITLE 994 · UNKNOWN 724 | — | — |
| 같은 좌표 공유 | 10지점 · 28단지(최대 7) | — | — |

sgg_cd NULL 마스터 0, 부산 외 prefix 마스터 0. **서울/경기 마스터는 한 행도 없다** → 커버리지 0%, DATA_GAP.

---

## 4. canonical identity

| 지표 | 부산 | 서울 | 경기 |
|---|---|---|---|
| 같은 시군구·같은 정규화 이름에 aptSeq 2개 이상 | 54그룹 · 116 aptSeq | — | — |
| 같은 법정동+지번에 aptSeq 2개 이상 | 32그룹 · 73 aptSeq | — | — |
| 여러 시군구에 걸친 같은 이름 | 전체 201개 이름(부산 내부) | — | — |
| 매매 aptSeq NULL | 0 | 0 | — |
| 매매 aptSeq 중 마스터에 없음 | **1,469 / 4,907 aptSeq · 39,692행(4.6%)** | 39 / 39 (100%) · 46행 | — |

- 부산도 매매에 등장하는 aptSeq의 30%(행 기준 4.6%)가 마스터에 없다 — 리포트는 master를 **보강 전용**으로 쓰기 때문에 거래는 유지된다(REPORT-1 §8). 서울/경기는 이 비율이 출발점에서 100%다.
- 서울 파일럿 46행은 마스터가 없어 상세·점수·좌표 어디에도 연결되지 않는다.
- 원칙 유지: `aptSeq > exact canonical proof > NO DATA`. 이름·좌표 기반 연결 금지. 서울 고밀도 동명 단지(현대·삼성 등)는 이미 M1/M2에서 10건 충돌 관측(`14-apartment-master-m4-expansion-analysis.md:418`).

---

## 5. 매매 실거래

| 지표 | 부산 | 서울 | 경기 | 기타(27110 대구 중구) |
|---|---|---|---|---|
| rows | 864,879 | 46 | 0 | 86 |
| 기간 | 2006-01-01 ~ 2026-09-14 | 2026-08-01 ~ 2026-08-24 | — | 2026-08-01 ~ 08-25 |
| lawdCd | 16 | 1 (11680) | 0 | 1 |
| distinct aptSeq | 4,907 | 39 | — | 31 |
| canceled / active | 16,296 / 848,583 | 1 / 45 | — | 2 / 84 |
| 형식 오류(금액·면적 ≤0) | 0 | 0 | — | 0 |
| 취소인데 cancel_date 없음 | 0 | 0 | — | 0 |
| 최근 12개월 / 3년 / 5년 | 37,031 / 95,922 / 141,609 | 46 / 46 / 46 | — | 86 |
| source | MOLIT_APT_TRADE | 동일 | — | 동일 |
| sync_coverage_cells SALE | 208셀(16×13, 202508~202608) 전부 검증 | **0** | **0** | 0 |

서울 46행은 REPORT_ENGINE_PRECHECK_V1에 기록된 1회성 파일럿(부분 월)이다 — 커버리지 셀이 없어 **완전성 검증 불가**, 서울 데이터로 쓰면 안 된다.

---

## 6. 취소 신뢰

APARTMENT_TRADE_SYNC_COVERAGE_AUDIT_V1 §7.2 결함 A(취소 플래그 래칫)와 같은 지표를 지역별로 산출:

| 지표 | 부산 | 서울 | 경기 |
|---|---|---|---|
| 다형제 그룹(group_key+금액+계약일+층) | 13,038 | 0 | 0 |
| 형제 전원 취소 그룹 | 263 | 0 | 0 |
| 과다 취소 의심 행(상한) | **324** (9-12 기준 315 → 증가) | 0 | 0 |
| 같은 단지·계약일·층·면적에 취소+유효 공존 | 8,528 | 0 | 0 |

- 서울/경기 0은 **데이터가 없어서 0**이다. 결함은 코드(`write-policy-logic.classifyRow`의 false→true 단방향 + occurrence 순서 불안정)에 있어 **지역 무관**하게 재발한다. 서울은 같은 날·같은 층·같은 금액 거래가 더 흔할 가능성이 커 형제 그룹 비율이 높아질 수 있다(정량화 불가).
- **확장 전 선결 조건**: 결함 A 수정(순서 무관 형제 대조) 없이 서울/경기 매매를 적재하면 같은 오류를 새 지역에 복제한다. repair는 이번 STEP 범위 밖.

---

## 7. 전월세

| 지표 | 부산 | 서울 | 경기 |
|---|---|---|---|
| rows | 125,875 | 0 | 0 |
| 기간 | 2024-08-01 ~ 2026-08-31 | — | — |
| aptSeq 보유 | 100% | — | — |
| 전세 / 월세 | 66,307 / 59,568 | — | — |
| 최근 12개월 | 55,554 | — | — |
| RENT 커버리지 셀 | 32(16×2, 202607~202608) | 0 | 0 |

- 부산 알려진 한계: DB는 2024-08 이후만(약 25개월), 검증 셀은 최근 2개월. 그 이전은 live MOLIT fallback에 의존.
- 서울/경기는 DB 0 → 현재 단지 상세 전월세는 **전량 live MOLIT**. `getRentVerifiedRange`가 부산 하드코딩(`sync-coverage.ts:76`)이라 검증 범위 표시도 불가.

---

## 8. 좌표

서울/경기 마스터 0 → 좌표 커버리지 산출 불가(0%). 부산 기준선: non-null 98.9%, 0,0 0, bbox 밖 0, exact 82.4%, 공유 좌표 28단지.

좌표 파이프라인 구조(`scripts/apartment_master_seed.ts:290-304,476`)는 lawdCd 인자를 받고 Kakao 결과 region1이 라벨 시도와 다르면 거절하는 가드가 있다(지역 중립). 반면 오피스텔 좌표 backfill(`step5b-coordinate-backfill.ts:11,117`)과 마스터 기본정보 backfill(`backfill-apartment-master-basic-data.ts:7,360`)은 부산 고정. **이번 STEP에서 geocode 실행 없음.**

---

## 9. 학교

| 지표 | 부산 | 서울 | 경기 |
|---|---|---|---|
| NEIS schools | 664 (초 305 · 중 171 · 고 142 · 특수 16 …) | **0** | **0** |
| 초등 좌표 | 305/305 | — | — |
| 배정구역 artifact | `busan-attendance-zone-20260320.json` | 없음 | 없음 |
| 교육청 코드 | C10 (ingest 기본값) | B10 (코드표만 있음) | J10 (코드표만 있음) |

점수 경로(V2 education, 가중치 25):
- 원천은 **Kakao SC4 반경 1,000m · 한 페이지 15건** 결과에서 "초등학교" 이름 필터(`location.ts:78,104,122`, `kakao.ts:94,147-149`). NEIS·배정구역은 evidence only.
- 곡선 logistic mid=420, scale=180 — **부산 실측 median 341m**로 보정(`curves.ts:234,248`).
- 알려진 문제 **SCHOOL SCORE MODEL REBASE V1**(`00-PROJECT-ROADMAP.md:174-229`, `SCHOOL_SCORE_IMPACT_SIMULATION_V1.md`): SC4 15건 절단으로 가장 가까운 초등학교가 잘림 → 부산 3,401 중 41단지(21 거리 과대, 최악 376m 저장 vs 59m 실제 · 20 null), 표시 점수 48건 변동. NEIS 기반 재구성 계획, 미착수(P1).

**서울/경기에 그대로 적용 시 왜곡**:
1. 학교·학원 밀도가 높은 서울은 1km 안 SC4 결과 15건이 초·중·고·학원으로 더 빨리 차서 **초등학교 절단 빈도가 부산보다 높아진다**(정량화 불가, 방향만 확실) → 거리 과대(점수 하락) 또는 null(가중치 재분배로 교육 영역 소실).
2. mid=420은 부산 분포 기준 — 서울 분포에서 다른 변별력.
3. NEIS 학교 테이블·배정구역이 없어 REBASE 해법(NEIS 기반)을 서울/경기에 바로 적용 불가.
→ **학교 점수는 REBASE V1을 전국 공통 모델로 먼저 끝낸 뒤 확장해야 한다.** 현 모델 전국 적용은 권장하지 않음.

---

## 10. 교통

- 지하철: Kakao SW8 반경 1,000m 최근접 1건(`location.ts:48,111`), **역 테이블 없음**. 곡선 0m→92 … 1000m→20(`curves.ts:92-95`, 부산 p10=164m·p90=758m 보정). **1km 밖은 CONFIRMED_ABSENT → 5점 절벽**(`curves.ts:108,121`).
- 지하철 개수(`subway_count_1000m`)는 V2에 **사용 안 함** → 서울 고밀도가 상한을 "넘기는" 포화는 없다. 대신 **압축**: 150m 이내 87~92점이라 환승 거점과 단일 노선 역이 구분되지 않는다. 서울 역세권 단지 다수가 상단에 몰릴 가능성.
- 경기 외곽(양평·가평·연천·포천·안성 등)은 1km 절벽으로 5점에 몰린다.
- 버스: TAGO 인접 정류장 API(`tago.ts:10,37`) — 부산(citycode 21) 지원만 문서화. **서울/경기 TAGO 지원 여부 미확인**. 코드 00 + 결과 없음이면 `bus_stop_count_300m=0` → 교통 = 0.7 × 지하철로 하락, 오류면 partial. TAGO 한도 10,000/일(`44-apartment-detail-bus-access.md:145`).
- 실제 서울/경기 점수 분포: **위치 피처 0행이라 read-only 재계산 불가.**

---

## 11. 공통 점수(Score V2)

- 저장 안 함, 요청 시 계산(`calculate.ts:22,129-137`). 입력 테이블 `apartment_location_features`는 배치로만 채움(`collect-location-features.ts:32-41,59`, `expand-busan-location-features.ts:31-44` — 부산 고정).
- 게이트: `location != null && sggCd != null && geocodeQuality === 'exact'`(`adapter.ts:25-26`).

| 지표 | 부산 | 서울 | 경기 |
|---|---|---|---|
| location features | 3,134 | 0 | 0 |
| market features | 2,937 | 0 | 0 |
| SCORE_AVAILABLE | 2,833 (82.4%, `PERSONALIZED_SCORE_V1_PHASE1_AUDIT.md:36-45`) | **0** | **0** |
| NOT_ENOUGH_DATA | 605 | 전량 | 전량 |
| 교통 도메인 | 2,782/2,833 (98.2%) | — | — |
| 생활 / 교육 | 100% / 99.4% | — | — |

추가 왜곡 요인:
- 생활: Kakao `pageable_count` 45 상한, 병원은 부산에서 이미 72.5% 상한(`STEP3_FULL_SHADOW_VALIDATION.md:139`) → 서울은 거의 전 단지 상한, 변별력 소실.
- 단지: 주차 미상 시 연식대 고정값 65/68/53/22(부산 DB 실측, `types.ts:69-74`) — 서울/경기에 부산 평균 적용.
- peer context: 서울 단지를 `sido:'부산'` 풀과 비교(`peer-context.ts:38,55,105-108`), 구 이름만 매칭 → **C, 확장 시 필수 수정**.

---

## 12. 개인화 점수

5축 전부 V2 결과에서 파생(`personalized-score.ts:23-29,101-116`): transport·living = 도메인 점수, newness = 연식 점수, parking = `parkingRawStatus=KNOWN`일 때만, elementarySchoolAccess = 교육 도메인. V2가 NOT_ENOUGH_DATA면 `NO_COMMON_SCORE`.

- 서울/경기: V2 0 → **개인화 0% (전량 NO_COMMON_SCORE)**.
- 부산 기준선: 2,833 × 4 프로필 불일치 0, 주차 fallback 808단지(`PERSONALIZED_SCORE_V1.md:208`), 주차 KNOWN 71.5%.
- 스키마 변경 불필요. 입력 데이터와 §9~11 보정이 선결.

---

## 13~16. 검색 · 지도 · 통계 · 리포트

### 13. 검색

| 항목 | 현재 | 서울/경기 영향 |
|---|---|---|
| 지역 검색 | `api/search/route.ts:58-67` 마스터 `umdName contains` → `sggCd` 직접 반환(이름→코드 변환 없음), `take:5`·**orderBy 없음** | 동명 동("중앙동" 등) 결과 5개가 임의 선택 |
| 단지 검색 | `:68-92` name/normalizedName `contains` OR, **take 없음**, trigram 인덱스 없음(btree만) → 전체 스캔 + 전 행 Node 전송, 상위 15 정렬 | 마스터가 수만 행이 되면 키 입력마다 풀스캔(부산 3,400행 전제로 take 제거한 주석 `:75-78`) |
| 동명 단지 표시 | 자동완성 부제 동+지번만, 시군구 없음(`ApartmentAutocomplete.tsx:420`) | "현대"·"삼성" 서울/경기 반복 이름 구분 불가 |
| 통계 이름 해석 | `molit-stats-helpers.ts:10-39` "시도 시군구" 정확 일치(안전), 누락 시 부산 서구 기본 | 기본값 B |
| fuzzy ↔ detail 분리 | 결과는 aptSeq 보유, `resolveDetailAptSeq`는 sggCd+dong 안 단일 일치만 | 유지됨. 단 누수 3곳: alias fallback 첫 Kakao POI, 상세 이름-only Kakao geocode(`apt/[name]/route.ts:85`), `'11680'` 기본값(`:91`, `apt-client.tsx:317`) |
| 스키마 식별 위험 | `Apartment @@unique([name, dong])` lawdCd 없음(schema:246), `identityKey 'nd:{name}\|{dong}'`(aptSeq 없을 때) lawdCd 없음(schema:1326), 평형 해석 `(name, dong) IN (...)`(`statistics-pyeong-resolver.ts:159-166`) | 다른 구의 같은 이름·같은 동 단지가 **충돌**. 매매 자연키 group_key가 identityKey를 포함하므로 aptSeq 없는 행끼리는 지역 간 충돌 가능(부산은 aptSeq 100%라 미발현) |
| 법정동/행정동 | 법정동 일관(프록시·Kakao region_type B·MOLIT umdNm) | 경기 읍면+리 표기 확인 필요 |
| 동 이름 지역 간 중복 | 거래 데이터 기준 0(서울/경기 데이터 거의 없음) | 산출 불가 |

### 14. 지도

- **bounds 쿼리 없음.** 지도 중심을 역지오코딩한 **lawdCd 1개** 단위로 마커를 읽는다(`map/page.tsx:726-748,776`). 기본·폴백 lawdCd `26140`(`:484,726`, `map-marker-share.ts:22`), OutOfBusanNotice(`:2150`).
- 서버: 해당 구 마스터 전량 LIMIT 없이 반환(`master-coords-cache.ts:35-39`), 오피스텔 전량(`officetel/map-marker-read.ts:22`), `/api/properties` `take:200`.
- 클라이언트: 픽셀 클러스터링, 뷰포트 컬링 160px(`page.tsx:185`), 줌 게이트(`map-property-focus.ts:75,84,106`).
- 규모 추정: **서울/경기 마스터 0 → 마커 수 실측 불가.** 부산 기준 단지 마스터 3,438(구 평균 215), 최근 12개월 거래 단지 2,929. 구 단위 로딩이라 "서울 전체" 뷰가 폭발하지는 않지만 **도(道) 전체 뷰는 구조상 불가**, 구 없는 대형 시(화성·남양주·김포·파주·평택 등)는 한 번에 큰 payload.
- 부산 외 구로 이동할 때마다 실거래가 DB-first가 아니라 **interactive MOLIT 12회**(`transactions/route.ts:56,111,140`) — 상세 화면과 같은 레인에서 경합.
- `apartment_masters` 좌표 인덱스 없음(EXPLAIN: Seq Scan) — 현재는 bounds 쿼리를 쓰지 않으므로 즉시 문제 아님.
- 판정: ARCHITECTURE_GAP(DB-first 분기·기본 lawdCd·안내) + DATA_GAP.

### 15. 통계

N = 구 수(서울 25, 경기 42 leaf). M = 요청당 MOLIT 호출. 공유 rate guard 4동시·250ms ≈ **초당 4회**.

| 페이지 → API | 서울/경기 | 시·일반구 | 부산 전용 코드 | 부산 외 MOLIT fan-out | DB-first |
|---|---|---|---|---|---|
| 거래량 → `stats/dashboard`, `yearly`, `concentration` | live MOLIT | 5자리 코드 동작 | dashboard:48-53,223,290 · yearly:23,54 | dashboard 구 24M · 시도 N×24M / yearly 구당 **306M** | 부산 매매 + 검증 전월세. KST 기간 모듈 사용(`resolveVolumePeriod`) |
| 2년최고가·상승·하락·84㎡ → `price-rankings` | live | 동작 | price-rankings:81-86,307-341,371-390 | 구 24M · 시도 N×24M | 부산만(SQL pushdown) |
| 전세위험 → `price-rankings`(rent) | live | 동작 | 없음(부산도 항상 MOLIT) | 구 24M · 시도 N×24M(부산 384M) | 없음 |
| 실거래 피드 → `stats/feed` | live | 동작 | `feed-db-source.ts:34-38` | 구는 부산도 항상 MOLIT ≈ 26~50M · 시도 months×N×2 | 부산 시도만. KST 모듈 |
| 거래집중 → `concentration` | live | 동작 | concentration:77 | (전·현 월)×N | 부산 구·시도 |
| 갭투자 | live | 동작 | `isFeedDbBackedSido`(:69) | 구 24M(부산도) · 시도 N×24M | 부산 시도만 |
| 변동지도 → `region-change` | live | 동작 | region-change:31-36,185,243,324 | 시군구 N×(2×기간+1), 12개월 ≈ 25M×N | 부산 |
| 분위지도 → `/api/transactions` | live | 구만 | transactions:56,111 | 구 12M(interactive) | 부산 |
| 대단지 | **미지원** | 불가 | large-complex:36,46 (`sido:'부산'`) | — | — |
| 공급(분양) | DB, 전국 | **일반구 불가**(`presale-region.ts:43-46`) | 없음 | 0 | 있음 |
| rankings | UI 호출처 없음(확인 필요) | — | — | 24M / N×24M | 없음 |

- 서울 시도 전체 요청 ≈ 600회 → 약 150s, 경기 ≈ 1,100회 → 약 275s. **통계 라우트에 maxDuration 없음**(cron만 60s), 클라이언트는 `sidoCode=11/41`을 그대로 보냄(`VolumeChartCard.tsx:86`, `PriceRankingView.tsx:162`).
- **정확성 결함(확정)**: live MOLIT 경로가 `numOfRows=1000` 고정에 **pageNo·totalCount 처리 없음**(`src/lib/api-molit.ts:27,126`) → 한 구·한 달 1,000건 초과분이 **조용히 잘린다**. 서울 전월세·경기 대형 구 매매에서 발생 가능성 높음. sync 경로(`scripts/sale-molit-fetch.ts`)는 totalCount 페이징을 한다. 부산에서도 월 1,000건 초과 구가 있으면 이미 발생 중일 수 있음(확인 필요 — 부산 매매는 DB-first라 통계는 영향 적음, 전월세·피드 구 단위는 영향 가능).
- 시도 목록 부모 시 코드 혼입(§2): 경기 시도 전체 조회에 41110 등 6개가 섞여 헛호출·"0건" 표시 가능.
- 프록시 실패 시 시군구 목록 `[]` → 시도 결과가 조용히 빈 값(FAILED가 ZERO로 접히는 계열).

### 16. 리포트 엔진

| 리포트 | 서울/경기 | 막히는 곳 |
|---|---|---|
| city | 불가 | `/report/city/busan` 정적 slug, `RegionLevel` CITY = 광역시 전체 |
| district | 불가 | `/report/district/[lawdCd]` allowlist 거절(`page.tsx:42`), displayName `부산 …` |
| dong | 불가 | 동일 |
| apt | 조회는 aptSeq 기반이라 가능성 있음, 마스터 0 → 이름·보강 없음. `apt-read.ts:220` 요청마다 **전체 활성 초등학교 로드**(부산 305 전제) | 데이터·성능 |
| compare | aptSeq 기반 — 마스터 0 | 데이터 |
| daily | 불가 | `daily-read.ts:86` 부산 스코프, 제목 부산(`daily/[date]/page.tsx:15`), created_at 전체 스캔(`:104-110`) — backfill 중 무거워짐 |

**3단계 충돌: 있음.** `RegionLevel = CITY | DISTRICT | DONG`에서 CITY는 광역시 전체다. 경기(도→시→구→동)에서 부모 시 코드(41110)는 자체 거래가 없는 5자리 "district"라 자식 집계가 필요하고, "city"라는 이름이 경기의 시 레벨과 의미가 충돌한다. SEO 레이어는 이미 sido/city/district를 모델링하지만 **read·route 레이어는 아니다.** 새 route는 만들지 않음 — 설계 갭으로만 기록.

---

## 17. 오피스텔

| 지표 | 부산 | 서울 | 경기 |
|---|---|---|---|
| masters | 5,056 (좌표 5,048) | 0 | 0 |
| trades | 88,674 (master 연결 86,306 = 97.3%, 2006-01 ~ 2026-09-02) | 0 | 0 |
| rents | 226,291 | 0 | 0 |

- canonical key `OFFI:{sggCd}:{법정동}:{본번-부번}:{동|_}`(`officetel/identity.ts:102`) — 지역 중립. 마커 read path도 lawdCd 중립(`map-marker-contract.ts:12-16`).
- 데이터 스크립트는 전부 부산 16 고정(`source-universe.ts:26`, `step3a-row-sweep.ts:35`, `source-driven-expand.ts:34`, `enrich-resume.ts:33`), 좌표 backfill region1 `부산`만 허용. **오피스텔 sync cron 없음**(적재 시점 고정).
- 부산 STEP3A dry-run 규모: 7,008셀 · MOLIT GET 7,304회 · DB +128~146MB. 서울/경기는 lawdCd 67개로 셀 수 약 4.2배(행 수는 미상).
- 판정: 구조 A(키·read path) / 파이프라인 C / 데이터 DATA_GAP.

---

## 18. 분양

| 지역 | rows | 좌표 | 접수중·예정 | 기간 | 마지막 갱신 |
|---|---|---|---|---|---|
| 경기 | 365 | 225 (61.6%) | 0 | 2023-08-17 ~ 2026-08-10 | 2026-08-12 |
| 서울 | 96 | 81 (84.4%) | 0 | 2023-08-16 ~ 2026-08-07 | 2026-08-12 |
| 부산 | 85 | 66 (77.6%) | 0 | 2023-09-08 ~ 2026-07-30 | 2026-08-12 |

- 소스: 청약홈(odcloud `ApplyhomeInfoDetailSvc`), 전국 17개 시도. 관리자 수동 POST 동기화만(`MAX_SYNC_LIMIT=200`), cron 없음 → **마지막 갱신 2026-08-12, 접수중·예정 0건은 신선도 문제일 수 있음(확인 필요)**.
- 목록은 부산 필터 없음. 지역 파서(`presale-region.ts:44`)는 경기 `시`까지만.
- 상세의 주변 단지·주변 시세는 ApartmentMaster bbox 기반(`nearby-apartments.ts:44`) → 서울/경기에서 **빈 섹션**(마스터 0).
- 판정: READY_WITH_LIMITATIONS(목록·상세 기본) / 주변 시세 DATA_GAP.

---

## 19. 재개발·재건축

| 시도 | projects | 좌표 | 소스 | 수집 |
|---|---|---|---|---|
| 서울특별시 | 644 | **0** | MOLIT | 2026-08-19 |
| 경기도 | 241 | **0** | MOLIT | 2026-08-19 |
| 부산광역시 | 461 | **0** | BUSAN_CITY + MOLIT | 2026-08-19 |

- MOLIT 전국 통합 CSV(data.go.kr 15160169): 주소·좌표 없음, 연 단위 갱신(`R1` 문서). 부산만 부산시 API로 단계·세대 보강.
- **서울 전용 소스(정비몽땅 등) 코드·문서 어디에도 없음.** 서울은 사업 수가 가장 많고 사용자 중요도가 높지만 현재는 MOLIT 기본 필드만.
- 단계 매핑: MOLIT 코드 2~7·17, 모르는 값 UNKNOWN, DISSOLVED는 projectStatus UNKNOWN 유지(추정 금지 원칙 준수). 라벨 "국토부 기준".
- 좌표 0% → 지도 레이어 불가(전 지역 동일).
- 판정: 목록 READY_WITH_LIMITATIONS / 지도·서울 상세 단계 NOT_READY.

---

## 20. SEO 확장 준비도

- 이름 템플릿(`region-seo.ts`): 서울 시도+구, 경기 시도+시+구, 구 없는 시 모두 표현(테스트 있음). 설명은 envelope 가용성 기반(DATA-AWARE PATCH V1) → 지역 중립. **A**
- 막히는 곳: `report-region-seo.ts`(부산 어댑터, `city` 미전달·`CITY_CRUMB '부산'`), `region-seo-read.ts`(부산 16 groupBy), `sitemap-scope.ts`(부산 17경로), IndexNow 안전핀(부산 외 차단 — **의도된 안전장치, 유지**), 리포트 route 구조.
- 경기 3단계 구조: `/report/district/[lawdCd]`는 lawdCd 1개 = 페이지 1개라 일반구(41135)는 그대로 표현되지만, **"성남시 전체"(41131+41133+41135) 허브를 표현할 route·스코프 타입이 없다.** 새 route는 이번 STEP에서 만들지 않음 — 구조 갭으로만 기록.

**색인 최소 조건 제안**(데이터보다 SEO를 먼저 열지 않는다):
1. canonical region: 공식 leaf lawdCd(부모 시 코드 제외) + 법정동코드 프록시와 이름 일치
2. valid report: 해당 lawdCd의 SALE 커버리지 셀이 최근 12개월 전부 COMPLETE/EMPTY_VALID(부산과 동일 기준 208셀 → 서울 300셀·경기 504셀)
3. minimum transactions: 동은 최근 1년 ≥10건(부산과 동일, `DONG_INDEX_MIN_TRADES_1Y`)
4. meaningful content: 기본 기간 envelope이 RICH 또는 HISTORICAL(SPARSE는 색인 제외 권장)
5. master linkage: 거래 aptSeq의 마스터 연결률이 부산 기준선 이상(행 기준 ≥95.4%)
6. sitemap inclusion: 1~5 통과 lawdCd만, IndexNow 안전핀 확장은 같은 커밋에서 의도적으로

---

## 21. 사이트맵 규모

**DB 기준 산출 불가** — 서울/경기 1년 거래가 있는 동: 서울 12(파일럿 1개 구, 10건 이상 0) · 경기 0.

공식 코드 목록 기반 **상한**:

| 항목 | 현재 | 서울 추가(상한) | 경기 추가(상한) |
|---|---|---|---|
| 시/도 허브 | 1 | 1 | 1 |
| 구·시·군 | 16 | 25 | 42 (+부모 시 허브 6은 route 없음) |
| 동 | 116 | ≤ 467 | ≤ 2,161 (읍면동 746 + 리 1,415) |
| 합계 | 139 | ≤ 493 | ≤ 2,204 |

- 부산 참고 비율: 색인 동 116 / 법정 단위 254(읍면동 192 + 리 62) = 45.7%. 같은 비율을 쓰면 서울 약 213 · 경기 약 988이지만 **서울·경기 거래 밀도는 부산과 달라 신뢰할 수 없는 추정**이다(참고용).
- 최대 시나리오 합계 ≈ 2,836 URL → sitemap 50,000 한도의 5.7%. **분할 불필요.** 단지 상세까지 넣으면 별도 계산 필요(마스터 0이라 산출 불가).

---

## 22~23. 성능 · DB 규모

### 22. 성능 규모 모델

서울/경기 행이 없어 **행 수 배수는 산출 불가**. 확정 가능한 구조적 배수만:

| 항목 | 부산 | +서울+경기 | 배수 |
|---|---|---|---|
| MOLIT leaf lawdCd | 16 | 83 | **5.19×** (추가분 4.19×) |
| cron 셀/일(sale+rent) | 96 | 498 | 5.19× |
| recheck 밴드 | 160 | 830 | 5.19× |
| 법정 읍면동 | 192 | 1,405 | 7.3× |
| 법정 읍면동+리 | 254 | 2,882 | 11.3× |
| 행 수(마스터·매매·전월세·오피스텔) | 실측 | **미상** | STEP B probe 필요 |

**병목 Top 10**(확장 시 가능성 순, 파일:라인):
1. 시도 전체 통계 MOLIT fan-out ≈ 초당 4회 한도 — dashboard:236-249, price-rankings:346-358, feed:123-133, concentration:120-124, region-change:199. in-flight dedupe는 인스턴스 단위.
2. **무제한 인메모리 캐시**(`server-cache.ts:1`, eviction 없음)에 시도 전체 raw MOLIT 결과 적재 — price-rankings:347-358, feed:114-171 → OOM 위험.
3. **live MOLIT 1,000건 절단**(`api-molit.ts:126`) — 정확성 + 재시도 비용.
4. 상세 라우트 MOLIT-first: 조회당 12~120회(`apt/[name]/route.ts:114-137`), DB 결과로 덮어쓰기 전에 항상 호출.
5. 연도별 표: 부산 외 구당 306회(`yearly/route.ts:68-76`).
6. 하락/상승/2년최고가/84㎡ 윈도 함수 SQL — 24개월 범위 self-join(`trade-history-read.ts:632-694`), 과거 부산 전체 42.5s 기록.
7. 대시보드 12개월 매매 행 전량 Node 적재(`trade-history-read.ts:381-392`, 부산 약 32k) + 평형 해석 튜플 `IN`(dashboard:479-484) — 서울 시도 규모에서 Postgres bind 파라미터 32,767 한도 근접 가능(확인 필요). 전월세 DB 쿼리 5회 순차(:393-404).
8. 검색 무제한 `contains` 스캔 + 전 행 전송(`search/route.ts:68-92`).
9. 리포트: CITY 기간 행 전량 materialize(`region-read.ts:153`), daily created_at 스캔(backfill 중 급증), apt 리포트 초등학교 전량 로드(`apt-read.ts:220`).
10. 지도: 구 이동마다 구 전체 마스터 로드 + 부산 외 interactive MOLIT 12회(`transactions/route.ts:140`, `master-coords-cache.ts:35`), cron 60s에 83 lawdCd 불가.

### 23. DB 규모 · 인덱스

현재(Production 실측): DB **711 MB**, max_connections 60(측정 시 7 사용).

| 테이블 | 추정 행 | 크기 |
|---|---|---|
| apartment_trade_histories | 864,628 | 478 MB |
| officetel_rent_histories | 225,201 | 104 MB |
| apartment_rent_histories | 114,551 | 63 MB |
| officetel_trade_histories | 84,009 | 38 MB |
| officetel_masters | 5,056 | 4.2 MB |
| apartment_masters | 3,402 | 1.9 MB |
| apartment_location_features | 3,134 | 0.9 MB |

- 매매 테이블이 DB의 67%. 매매 행 1개 ≈ 553 bytes(인덱스 포함, 478MB ÷ 864,628). 서울/경기 매매 행 수를 모르므로 용량은 **`추가 행 수 × 553B`** 공식으로만 제시하고, 추가 행 수는 STEP B probe로 산출한다. 저장 한도는 오피스텔 STEP3A 문서가 인용한 8GB가 유일한 기록이며 현재 요금제 한도는 확인 필요.
- 인덱스(매매): `(apt_seq, exclusive_area, deal_date)`, `(lawd_cd, deal_date)`, `(lawd_cd, exclusive_area, deal_date)`, `(identity_key, deal_date)`, `(deal_date)`, `(created_at)`, 자연키 unique. 동(dong) 컬럼 인덱스 없음.
- EXPLAIN(read-only, 서울 데이터 없는 통계 기준 — 적재 후 재측정 필요):
  - 동 리포트 창(`lawd_cd='11680' AND dong=… AND deal_date` 30일): `lawd_cd_exclusive_area_deal_date_idx` Index Scan + dong Filter
  - 단지 12개월 이력: `apt_seq_exclusive_area_deal_date_idx` Index Scan
  - 동별 1년 groupBy(3개 구): Index Scan + HashAggregate
  - 마스터 좌표 범위: **Seq Scan**(좌표 인덱스 없음)
- 인덱스 후보(**제안만, CREATE 금지**): `apartment_trade_histories (lawd_cd, dong, deal_date)`(동 리포트·동 SEO groupBy — 서울 구당 행이 부산보다 많을 때), `apartment_masters` trigram(`normalized_name`) 또는 검색 take 복원, 좌표 bounds 쿼리 도입 시 `(latitude, longitude)`. 쓰기 증가분·용량 평가 후 migration 승인 절차로.
- 연결 압박: max_connections 60, cron·backfill·live가 같은 풀 — backfill 병렬도는 1~2로 제한 권장.
- Supabase egress: 스크립트 대량 read가 과거 egress 주원인(SUPABASE_EGRESS_P0_FIX_V1) — 확장 audit/backfill 스크립트는 서버측 집계·guard 필수.

---

## 24. 동기화 파이프라인

| 파이프라인 | 지역 | 분류 | 현재 셀(부산 16) | 부산+서울+경기(총 83 lawdCd) |
|---|---|---|---|---|
| sale-sync cron (19:00 UTC, maxDuration 60, 예산 50s) | `BUSAN_LAWDCD_16` 기본 | region list configurable(미사용) → 사실상 hardcoded | 16×4 = 64 | +268 → 332셀 ≈ 180~260s → **한 번에 불가** |
| rent-sync cron | 동일 | 동일 | 16×2 = 32 | +134 → 166셀 |
| sale-recheck cron | 동일, staleness 순 | 동일 | 밴드 16×10 = 160 | 830셀, 하루 ~50셀 → **한 바퀴 약 17일**(현재 3.2일) |
| incremental-sync-nationwide CLI | 프록시 전국 | nationwide | 수동 | 부모 시 코드 필터 확인 필요 |
| backfill-trade-history CLI | `--sido` 기본 26 | configurable | 수동 | — |
| rent incremental CLI | 부산 하드코딩 | hardcoded | 수동 | — |
| 마스터 seed / 기본정보 backfill | seed는 lawdCd 인자 / backfill `startsWith('26')` | configurable / hardcoded | 수동 | — |
| 오피스텔 스크립트 | 부산 16 | hardcoded | 수동, cron 없음 | — |
| 위치 피처 수집 | 부산 모드·카나리 | hardcoded(모드) | 수동 | Kakao 호출 = 마스터 × 카테고리 |

**unsafe at expanded scale**:
- sale/rent sync가 매 실행 offset 0부터 고정 순서로 돌고 예산에서 멈춤 → 뒤쪽 lawdCd 영구 미처리(recheck만 staleness 회전).
- 동기화 fetcher는 `molit-rate-guard`(live 경로 전용, 4 동시·250ms, 키 22~33rps 초과 시 ~60s 잠금)를 거치지 않아 live 트래픽과 조율 없음.
- **일일 한도 카운터 없음**, MOLIT 일일 한도 문서상 미확인. 과거 부산 backfill이 data.go.kr quota로 1,620/3,968에서 중단(`CHANGELOG.md:14126`).

MOLIT 호출 추정(최소, 페이지·재시도 제외): 일일 cron ≈ 332 + 166 + 50 = **약 550회**(현재 약 150). 초기 backfill은 lawdCd × 개월 × 데이터셋 × 페이지: 매매 5년(60개월)만 67 × 60 = 4,020셀 + 페이지 수(서울 월 1,000건 초과 구 존재 가능, 확인 필요). 전월세 2년 67 × 24 = 1,608셀 + 페이지. → **한도 확인 없이 backfill 착수 금지.**

---

## 25. 관리자·운영 관측

| 필요 항목 | 현재 | 판정 |
|---|---|---|
| 지역별 sync 신선도 | `/api/admin/ops` 부산 16 하드코딩(`:27,109-120`), 커버리지는 데이터셋별 상태 요약만(`sync-coverage.ts:188-200`) — lawdCd×월 격자 없음 | 부족 |
| 마스터 누락(거래 aptSeq ∉ master) | 없음 | 없음 |
| 좌표 커버리지 | 없음 | 없음 |
| 거래 커버리지 | 부산 행 수·최신일·취소·aptSeq null | 부산만 |
| API 오류·MOLIT partial | `/admin/system` ErrorLog `[MOLIT_PARTIAL]` 파싱(lawdCd 라벨, 지역 중립) | 있음 |
| cron sync 실패 | ErrorLog에 기록 안 됨(Vercel 로그·커버리지 상태로만) | 부족 |
| 오피스텔/분양/재개발 | 없음 | 없음 |
| 전국 manifest·취소 스냅샷 | 배포 시점 JSON(비실시간) | 제한 |

---

## 26. 데이터 신뢰 게이트 (부산 기준선 이상)

부산 현재값을 하한으로 둔다. 잘못된 데이터보다 NO DATA.

| 게이트 | 부산 기준선(실측) | 서울/경기 공개 최소 기준 제안 |
|---|---|---|
| G1 마스터 aptSeq 보유·형식 | 100% · 형식 오류 0 | 100% · 0 |
| G2 aptSeq↔sgg_cd 일치 | 3,437/3,438 | 불일치 0 또는 사유 기록 |
| G3 거래 aptSeq NULL | 0 | 0 |
| G4 거래 행의 마스터 연결률 | 95.4% | ≥ 95.4% (lawdCd별) |
| G5 좌표 non-null · bbox 밖 | 98.9% · 0 | ≥ 98.9% · 0 |
| G6 geocode exact | 82.4% | ≥ 82.4% (점수 게이트와 동일) |
| G7 SALE 커버리지 셀 | 최근 13개월 208/208 검증 | lawdCd별 최근 13개월 100% 검증 |
| G8 취소 래칫 | 결함 A 미수정, 의심 324행 | **결함 A 수정 후 적재** · 의심 행 lawdCd별 공개 |
| G9 점수 SCORE_AVAILABLE | 82.4% | ≥ 82.4% **그리고** 학교 REBASE·peer 전국화 완료 전 점수 비공개 |
| G10 households / parking | 92.5% / 70.3% | ≥ 92.5% / ≥ 70.3% (미달 시 주차 축 LIMITED 명시) |
| G11 전월세 | aptSeq 100%, 25개월 | aptSeq 100%, 검증 셀 존재 기간만 DB 표기 |
| G12 SEO 색인 | §20 조건 | §20 조건 전부 |

---

## 27. 지역별 준비도

| 지역 | 판정 | 근거 |
|---|---|---|
| 서울(전체) | **NOT_READY** | 마스터·매매·전월세·학교·위치·점수 0, 리포트/통계/cron 부산 고정. 분양·재개발 목록만 있음 |
| 경기(전체) | **NOT_READY** | 서울과 동일 + 부모 시 코드 6개·시+구 계층 구조 갭 |
| 서울 강남구(11680) | **DATA_GAP** | 파일럿 매매 46행(부분 월, 커버리지 셀 0, 마스터 연결 0%). lawdCd·이름 표현은 가능 |
| 서울 송파구(11710) | **DATA_GAP** | 데이터 0. 표현 가능 |
| 서울 마포구(11440) | **DATA_GAP** | 데이터 0. 표현 가능 |
| 경기 성남시 분당구(41135) | **ARCHITECTURE_GAP** + DATA_GAP | 데이터 0, 시+구 계층이 REGION_DATA·통계 메타·지역 모달·리포트 스코프에서 불완전 |
| 경기 수원시 영통구(41117) | **ARCHITECTURE_GAP** + DATA_GAP | 동일 |
| 경기 고양시 일산서구(41287) | **ARCHITECTURE_GAP** + DATA_GAP | 동일 |
| 경기 김포시(41570) | **DATA_GAP** | 데이터 0, 단일 시라 계층 문제 없음(allowlist·cron만) |

READY / READY_WITH_LIMITATIONS 지역: 없음(분양 목록 기능 단위로만 READY_WITH_LIMITATIONS).

---

## 28. 확장 구현 계획

순서는 신뢰 게이트 의존성 기준. 시간은 부산 실제 소요와 문서 기록에 기반한 **대략치**(MOLIT 한도 확인 전이라 backfill 벽시계 시간은 범위로만).

| STEP | 내용 | Production write | schema | blocker | 사용자에게 보이는 것 | 예상 |
|---|---|---|---|---|---|---|
| **0. 선결 수정** | 취소 래칫 결함 A 수정(순서 무관 형제 대조) · 학교 SCHOOL SCORE REBASE V1(NEIS 공통 모델) · peer context 시도 파라미터화 · 서울 강남구 기본값 제거 | 부산 repair는 별도 승인 | 없음(예상) | — | 부산 정확도 개선 | 1~2주 |
| **A. 지역 레지스트리** | leaf lawdCd 목록(부모 시 제외)·시도/시/구 계층을 한 곳에서, 부산 코드 사본 3벌 통합, REGION_DATA 일반구 지원 | 없음 | 코드 테이블이면 없음 / DB Region Master면 **있음** | 설계 결정 | 없음 | 3~5일 |
| **B. MOLIT 한도·규모 실측** | data.go.kr 계정 한도 확인(사용자) + 67 lawdCd × 1개월 totalCount read-only probe → 행 수·페이지 수 산출 | 없음 | 없음 | 한도 정보 | 없음 | 1일 |
| **C. 마스터** | 서울→경기 순 seed(aptSeq from MOLIT, 건축물대장, Kakao geocode + region1 가드) | **있음(bulk)** | 없음 | B, 한도 | 없음(비공개) | 1~2주 |
| **D. 매매 backfill** | 5년 + 커버리지 셀, 결함 A 수정 코드로 | **있음(bulk)** | 없음 | 0, B | 없음 | 1~3주(한도 의존) |
| **E. 전월세 backfill** | 2년, 부산과 같은 범위 | **있음(bulk)** | 없음 | B | 없음 | 1~2주 |
| **F. cron 확장** | lawdCd 회전(offset 영속화/staleness)·rate guard 통합·일일 한도 카운터·실패 ErrorLog | 없음(코드) / 실행 시 write | 없음(상태 저장을 DB에 두면 있음) | D | 신선도 | 3~5일 |
| **G. 좌표·위치 피처·점수** | exact geocode, 위치 피처 수집(Kakao·TAGO 서울/경기 확인), 곡선 재보정 검토(교통 압축·생활 상한) | **있음** | 없음 | 0(REBASE), TAGO 확인 | 없음(점수 비공개 유지) | 1~2주 |
| **H. 검색·상세** | 마스터 기반 검색, 동명 단지 표시(구·동), 강남구 기본값 제거 확인 | 없음 | 없음 | C | 서울/경기 단지 검색·상세 | 3~5일 |
| **I. 지도** | 마커 규모 대응(§14), 부산 bbox 안내 일반화 | 없음 | 인덱스 추가 시 **승인 필요** | C | 서울/경기 지도 | 3~5일 |
| **J. 통계** | `'26'` DB-first 분기 일반화, 기본 시도, 대단지·학군 메타 | 없음 | 없음 | D | 통계 | 1주 |
| **K. 리포트** | 스코프 타입(시도·부모 시), 시/도 허브 route 설계(`/report/city/busan` 일반화) | 없음 | 없음 | A, D | 한장 브리핑 | 1주 |
| **L. SEO** | 어댑터 일반화, §20 게이트 통과 lawdCd만 sitemap, IndexNow 안전핀 의도적 확장 | 없음 | 없음 | K, 게이트 | 검색 노출 | 2~3일 |
| **M. 오피스텔·재개발** | 오피스텔 스크립트 지역 인자화 + cron, 서울 재개발 소스 조사(정비몽땅 등, 약관 검토) | **있음** | 없음 | 소스 약관 | 서울 오피스텔·재개발 | 2~3주 |
| **N. 운영 관측** | 지역별 신선도 격자·마스터 누락·좌표 커버리지 대시보드 | 없음 | 없음 | F | 관리자 | 3~5일 |
| **O. 릴리스 게이트** | §26 G1~G12 실측 → 지역별 공개 | 없음 | 없음 | 전부 | 공개 | 2~3일 |

**총 예상: 약 10~16주**(서울 우선 공개는 0→A→B→C→D→F→H→I→J→K→L→O 경로로 약 7~10주, 경기는 계층 구조 작업 포함 +3~6주). MOLIT 일일 한도에 따라 D·E가 가장 크게 흔들린다.

---

## 29. Production write 게이트

이번 STEP write 0. 다음 단계 bulk write(C·D·E·G·M)는 각각 승인 전에 다음을 제시한다:
- exact row estimate(STEP B probe로 산출)
- source(API명·데이터셋 ID·약관)
- dedup rule(자연키: 매매 `group_key+금액+계약일+층+occurrence`, 전월세 동일 계열)
- identity rule(aptSeq 우선, exact proof만, fuzzy 금지)
- rollback/repair(source/run_id·created_at 범위 삭제 가능 여부, 커버리지 셀 재검증)
- batch size·rate limit(키 22~33rps 잠금 기준, 일일 한도)

---

## 30. 검증

```
scripts/audit-seoul-gyeonggi-expansion.ts   ALLOW_PROD_DB_READ=1, READ ONLY 트랜잭션, exit 0, 49.7s
npx eslint scripts/audit-seoul-gyeonggi-expansion.ts   exit 0
mutation grep(INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/upsert)   0건 (executeRaw는 SET TRANSACTION READ ONLY · SET LOCAL statement_timeout 2건뿐)
npx tsc --noEmit                                   이 스크립트 오류 0 (기존 scripts/tmp 오류는 FAIL_EXISTING_SCRIPT_ERRORS)
앱 코드 변경 없음 → build 생략
```

## 31. 알려진 한계

- 서울/경기 행 수·마커 수·쿼리 비용은 **데이터가 없어 실측 불가** — 구조적 배수(lawdCd 67/16 = 4.19배)와 코드 목록 상한만 제시.
- EXPLAIN은 서울 데이터가 없는 통계 위에서의 계획이다(행 추정 1). 적재 후 재측정 필요.
- TAGO 서울/경기 지원, MOLIT 일일 한도, 경기 부모 시 코드로 MOLIT 호출 시 동작, 분양 신선도는 확인 필요.
- 좌표 bbox는 대략 경계(정밀 행정경계 아님).
