# 이집 개발 변경 기록

## 2026-08-12

### STEP 0 — 개발 기록 체계 구축

작업:

- docs/development 구조 생성
- 프로젝트 로드맵 생성
- 주요 의사결정 기록 체계 생성
- 개발 변경 기록 체계 생성
- Claude Code 프로젝트 작업 원칙 정리

서비스 기능 변경:

없음

DB 변경:

없음

API 변경:

없음

상태:

완료


## 2026-08-12

### STEP 1 — 현재 시스템 정밀 진단

작업:

- docs/development/01-current-system-audit.md 생성
- 기술스택/프로젝트구조/DB구조/아파트데이터/실거래·전월세/지도/통계/Gemini의존성/재개발/분양/관리자/사용자행동데이터/성능·비용·리스크/추천전환준비도/보호기능/README 전 영역 정밀 조사
- 00-PROJECT-ROADMAP.md STEP 1 상태 갱신

서비스 코드 변경:

없음

DB 변경:

없음

패키지 변경:

없음

상태:

완료


## 2026-08-12

### STEP 1.5-A — 학군 데이터 신뢰성 긴급 정비

핵심:

실제 근거가 없는 특목고 진학률 및
그에 따른 평가 문구를 사용자 화면에서 제거.

작업 중 동일한 방식(학교명 해시)으로 생성되던
학교 랭킹 목록 전체(학생수/학업성취도/통학시간 등)의
가짜 수치도 추가로 발견되어 함께 제거함.

서비스 코드 변경:

있음 (src/app/api/school/route.ts, src/app/api/school/stats/route.ts,
src/app/school/school-client.tsx, src/app/school/school.module.css,
src/components/SchoolDistrictPanel.tsx)

DB 변경:

없음

패키지 변경:

없음

상태:

완료


## 2026-08-12

### STEP 1.5-B — 관리자 API 상태 표시 신뢰성 정비

핵심:

관리자 대시보드가 청약홈/건축물대장 상태를
API 키 존재 여부만으로 "정상"/"오류"로 표시하던 문제를
"미연동"/"설정됨" 등 실제 근거에 맞는 표현으로 수정.
상태 문구가 "정상"이 아니면 무조건 빨간색(오류)으로
표시되던 UI 색상 분기도 중립 상태를 구분하도록 확장.

서비스 코드 변경:

있음 (src/app/api/admin/dashboard/route.ts,
src/app/admin/dashboard/page.tsx, page.module.css)

검수 후 반영:
건축물대장 화면 문구를 "설정됨(실사용 확인, 상태 점검 미구현)"에서
"설정됨"으로 단순화(로직/분류 기준은 변경 없음, 상세 근거는
docs/development/01-5B-admin-api-status-integrity.md에 기록).

DB 변경:

없음

패키지 변경:

없음

상태:

완료


## 2026-08-12

### STEP 1.5-C — AI 검색 실패 안전장치

목적:

Gemini 의도분류(classifyQuery) 실패 시
검색 전체가 중단되지 않도록 최소 fallback 추가.

핵심:

기존 지역명 인식 로직(detectLeadingRegionKeyword)을 재사용해
Gemini 실패 시에도 지역명이 인식되면 조건 없는 기본 단지
목록으로 검색을 이어가고, 지역명도 인식 불가능하면
기술적 오류 대신 "조금 더 구체적으로 입력해주세요" 안내로
안전하게 종료(HTTP 200 유지). 가격/신축/주차 등 조건은
안전하게 추출할 기존 파서가 없어 임의로 채우지 않음.

서비스 코드 변경:

있음 (src/app/api/ai-search/route.ts)

검수 후 반영:
사용자 안내 문구를 "지역과 가격 조건을 조금 더 구체적으로
입력해주세요."에서 "찾으시는 지역이나 조건을 조금 더
구체적으로 입력해주세요."로 수정(특정 검색 유형에 종속되지
않는 표현으로 변경, 로직 변경 없음). fallback 로그는
console.warn 수준 유지(ErrorLog DB 저장은 이번 STEP에서
하지 않음), apt-building-info.ts의 빈 배열 reduce() 문제는
기존 기술부채로 기록만 유지하고 수정하지 않음. 상세 근거는
docs/development/01-5C-ai-search-fallback.md에 기록.

DB 변경:

없음

패키지 변경:

없음

상태:

완료


## 2026-08-12

### PRESALE P1 — 청약홈 분양 API 분석 및 실제 호출 검증

목적:

Presale schema, 기존 청약홈 연동 코드(cheongyakService.ts),
공식 청약홈 API의 실제 응답 구조를 조사하고,
Presale 필드와 API 응답을 정확히 매핑할 수 있는지 검증.

핵심:

getAPTLttotPblancDetail/getAPTLttotPblancMdl 실제 호출로
정상 응답(HTTP 200) 확인. 기존 syncApplyhomeListings()의
receiptStartDate/receiptEndDate/pblancUrl이 존재하지 않는
필드명을 참조하고 있어 항상 null로 저장되는 버그를 확인.
houseType 매핑 로직도 실제 값과 불일치. minPrice/maxPrice는
Detail API에는 없고 Mdl API에서만 확인 가능함을 실측으로 확인.

서비스 코드 변경:

없음 (조사만 수행, 코드 미수정)

검수 후 반영:
docs/development/02-presale-api-analysis.md에 "P1 최종 검수 결정"
섹션 추가 — Presale Model 구조 유지, 확인된 필드 매핑 문제 4건은
P2 수정 대상으로 확정(P1에서는 미수정), 분양가 단위는 P2-A에서
검증 전까지 저장하지 않음, 좌표는 기존 Kakao 지오코딩 재사용
검토, 분양/임대 데이터는 임의 제외하지 않고 P2-A에서 표본 조사.

DB 변경:

없음

패키지 변경:

없음

상태:

완료


## 2026-08-12

### PRESALE P2-A — 청약홈 실제 데이터 표본검증 및 저장정책 설계

목적:

Detail 50건 + Mdl 4건(27개 주택형) 실제 표본으로
고유식별자/주택유형/분양임대구분/접수기간/URL/분양가단위/
주소품질/입주예정월/계약기간/공급지역/null정책을 검증하고,
Presale schema의 최종 Gap과 P2-B 구현계획을 확정.

핵심:

receiptStartDate/receiptEndDate는 RCEPT_BGNDE/RCEPT_ENDDE로
교체하면 그대로 사용 가능함을 50건 전수 확인(9종 세분화 필드의
min/max와 완전히 일치). 분양가 단위(LTTOT_TOP_AMOUNT)는
숫자 크기 추측이 아니라 실제 언론보도 3건과 교차검증해
"만원 단위, 최고가 의미"로 확정(그중 1건은 소수점까지 정확히
일치). houseType은 이번 API(APT 전용 endpoint)만으로는
오피스텔/도시형 값이 원천적으로 나올 수 없음을 구조적으로 확인.
PresaleHouseTypeDetail(가칭) 하위 모델 설계안 제시.

서비스 코드 변경:

없음 (조사만 수행, 코드 미수정)

검수 후 반영:
docs/development/03-presale-data-policy.md에 "P2-A 최종 검수
결정" 섹션 추가 — HOUSE_MANAGE_NO/PBLANC_NO 모두 원본 보존,
receiptStartDate/receiptEndDate는 RCEPT_BGNDE/RCEPT_ENDDE로
확정, PBLANC_URL 확정, 분양가는 만원 단위 최고가로 확정(0 임의
변환 금지), 입주예정월은 YYYYMM 문자열 원본 보존, 주택유형/
분양임대 구분 모두 API 원본값 별도 저장(enum 억지 확장 금지),
PresaleHouseTypeDetail은 Prisma relation FK +
@@unique([houseManageNo, modelNo])로 P2-B 기본안 확정,
좌표는 기존 Kakao 지오코딩 재사용 + null 허용(임의 좌표 생성 금지).

DB 변경:

없음

패키지 변경:

없음

상태:

완료


## 2026-08-12

### PRESALE P2-B — 청약홈 분양정보 실제 DB 연동

목적:

P1/P2-A에서 검증한 저장정책을 실제 schema/코드로 구현하고,
실제 청약홈 API로 소량(8건) 데이터를 DB에 적재해 검증.

핵심:

Prisma Migrate 이력이 없던 DB를 베이스라인(0_baseline, SQL
미실행/북키핑만)한 뒤 presale_p2b_schema 마이그레이션(전부
ADD COLUMN/CREATE TABLE, DROP 없음)을 적용. Presale에 10개
필드 추가, PresaleHouseTypeDetail 신규 모델(1:N, Cascade,
@@unique([houseManageNo, modelNo])) 추가. syncApplyhomeListings()
의 확인된 필드명 버그(receiptStartDate/receiptEndDate/pblancUrl)
수정 + Mdl 연동 + 기존 Kakao 지오코딩 재사용 추가. 실제 8건
적재 후 2회 연속 sync로 idempotent함을 확인(Presale 8행/
PresaleHouseTypeDetail 47행, 중복 0). 지오코딩은 5/8 성공,
실패 3건 전부 P2-A가 예측한 "일원"/택지지구 주소 패턴과 일치.

서비스 코드 변경:

있음 (prisma/schema.prisma, src/services/cheongyakService.ts,
scripts/sync_presales_test.ts 신규, scripts/_register-paths.js 신규)

DB 변경:

있음 (migration 2건 적용: 0_baseline, presale_p2b_schema.
Presale 10개 컬럼 추가 + PresaleHouseTypeDetail 테이블 신규
생성. 기존 테이블/컬럼/데이터 삭제 없음. 실 데이터 8건 +
주택형 47건 적재)

검수 후 반영:
GNRL_HSHLDCO 필드가 실제 API에 없음을 라이브 재확인해
generalSupply/specialSupply/totalSupply 매핑 유지 확정.
Presale.totalSupplyHouseholds(Detail 총세대)와
PresaleHouseTypeDetail 합계(Mdl 주택형 공급합계)는 서로 다른
의미로 보고 강제 일치시키지 않기로 확정 — 성남복정2(594 vs
166), 시흥거모(290 vs 284) 불일치 사례를 원인 미확정 상태로
문서에 기록. Prisma baseline/Cascade/_register-paths.js/
테스트 데이터 8건+47건/지오코딩 null 유지 등 기존 결정 모두
최종 유지. 상세는 docs/development/04-presale-db-integration.md
§P~Q 참고.

패키지 변경:

없음

상태:

완료


## 2026-08-12

### PRESALE P2-C — 분양 데이터 운영·동기화 체계 구축

목적:

P2-B의 저장 구조를 실제 운영 가능한 동기화 체계로 확장.
초기/증분 동기화 정책 확정, 지오코딩 fallback 보완, 관리자
수동 동기화 기능 구현.

핵심:

RCRIT_PBLANC_DE 기준 서버사이드 날짜 필터(cond[FIELD::GTE/LTE])
지원을 라이브로 발견해 초기(기본 최근 3년)/증분(기본 최근
90일) 동기화를 이 필터로 구현. 아이템 단위 try/catch로 한 건
실패가 배치 전체를 막지 않도록 개선. 관리자 대시보드에 분양정보
수동 동기화 카드 추가(POST /api/admin/presales/sync,
requireAdmin 보호, MAX_SYNC_LIMIT=200 서버 강제 클램프,
dryRun 지원). cron/자동 스케줄러는 구현하지 않음.

검수 후 반영(지오코딩 정확도 강화):
4단계 fallback 중 4차(시/도+시/군/구+읍/면/동)는 번지를 버린
행정구역 대표 좌표일 뿐 실제 사업지 좌표가 아니라는 지적에 따라
exact/normalized(번지 유지, 저장함)와 area_only(4차, 저장 안 함)
를 구분하도록 재설계. 시/도만 비교하던 검증을 원본 주소 기준
시/도+시/군/구 비교로 강화. 기존 25건을 재검증해 6건(전부 4차로만
성공했던 건)의 좌표를 null로 정정(다른 필드는 미변경) — 최종
19건(76%)만 신뢰 가능한 좌표 보유. 상세는
docs/development/05-presale-sync-operations.md §N~O 참고.

서비스 코드 변경:

있음 (src/services/cheongyakService.ts 전면 재작성,
src/app/api/admin/presales/sync/route.ts 신규,
src/app/admin/dashboard/page.tsx, page.module.css,
scripts/sync_presales_test.ts 갱신,
scripts/reverify_presale_geocode.ts 신규)

DB 변경:

없음 (schema 변경 없음. 실 데이터 동기화로 Presale 8→25건,
PresaleHouseTypeDetail 47→142건으로 증가, 이후 좌표 재검증으로
6건의 latitude/longitude만 null로 정정 — 여전히 최근 90일 표본,
전체 동기화 아님)

패키지 변경:

없음

상태:

완료


## 2026-08-12

### STEP 2 — PRESALE P2-C2: 최근 3년 초기 백필

작업:

기존 P2-C sync 파이프라인(syncApplyhomeListings)을 코드 변경 없이
그대로 사용해 최근 3년(2023-08-13~2026-08-12) 분양 데이터를
6개 batch(matchCount 188/176/156/161/171/194, 각 MAX_SYNC_LIMIT=200
이하)로 나눠 실제 적재. dryRun으로 전체 matchCount(1,046건, 사전
예상과 정확히 일치) 먼저 확인 후 batch 1만 실행→DB 검증→문제 없어
batch 2~6 순차 실행. 전 batch failed:0, mdlFailed:0. 마지막
batch에서 기존 25건이 정확히 update(중복 생성 없음)로 처리됨을
확인. 백필 후 Presale/PresaleHouseTypeDetail 전수 무결성 검증
(중복/orphan/날짜역전/가격역전 전부 0건, 가격 100% 확보, 좌표
728/1046(69.6%) 신뢰 가능·나머지는 null 유지) + 소규모 재동기화로
idempotency 재확인(중복 0, 정상 update). 상세는
docs/development/06-presale-initial-backfill.md 참고.

서비스 코드 변경:

없음 (cheongyakService.ts, presales/sync/route.ts 등 기존 sync
로직 무결함 확인, 미수정. 신규 파일은 백필 실행/검증 전용
일회성 스크립트뿐: scripts/presale_backfill_probe.ts,
scripts/presale_backfill_batch.ts — 기존 syncApplyhomeListings()를
호출만 함)

DB 변경:

없음 (schema 변경 없음. 실 데이터 백필로 Presale 25→1,046건,
PresaleHouseTypeDetail 142→5,395건으로 증가)

패키지 변경:

없음

상태:

완료(2026-08-12 최종 검수 승인. P2-D 미착수)


## 2026-08-12

### STEP 3 — PRESALE P2-D1: 분양 서비스 UI/UX 구조 조사 및 설계

작업:

분양 관련 코드 전체(목록/상세/API/관리자/검색/AI검색/지도/공유/SEO/
empty state) 조사 — 사용자 화면은 현재 전무함(목록/상세 라우트
없음, /redevelopment "분양·청약" 탭은 100% 정적 준비중 카드)을
확인. 반면 Presale 필드 대부분(houseName/지역/가격/일정/입주예정/
청약홈URL 등) 100% 완결성 확보돼 있어 UI만 붙이면 되는 상태임을
데이터로 재확인(상태 분포: 접수마감 1,039/접수예정 7/접수중 0 —
99.3%가 이미 과거 공고). 좌표 69.6%(728/1,046)만 신뢰 가능,
"주변 아파트" 좌표 반경 비교는 마스터 DB 부재로 현재 불가함을
명확히 기록(억지 매칭 안 함). 목록/필터/상태정책/상세/주택형UX/
가격표시/지도/커뮤니티확장/SEO/애드센스 후보 위치/모바일UX/CTA를
설계하고, P2-D2~D5 4단계 구현 분리안을 현재 코드 기준으로 평가해
적절함을 확인. 상세는 docs/development/07-presale-ui-ux-design.md
참고.

서비스 코드 변경:

없음 (조사·설계 전용, UI/API/DB 어느 것도 변경하지 않음)

DB 변경:

없음

패키지 변경:

없음

상태:

완료(2026-08-12 최종 검수 승인 — URL /presales/[id] 확정,
/redevelopment 분양 탭은 삭제하지 않고 향후 /presales 진입점으로
전환, 상태 4분류 유지, "주변 아파트"는 MASTER DB 이전까지 사용
금지 표현으로 확정, P2-D2~D5 순서 최종 확정. P2-D2 미착수)


## 2026-08-13

### PRESALE P2-D2 — 분양 목록 + 기본 필터 + 상태 UI

목적:

/presales 사용자 목록 페이지를 실제로 구현. P2-D1에서 확정한
설계(URL, 상태 4분류, 카드 구조, 필터 우선순위)를 그대로 따름.

핵심:

GET /api/presales를 최소 확장(재작성 아님) — page/region/priceMax
파라미터, regions facet(DB groupBy 실측, 하드코딩 없음) 추가.
응답을 { items, total, page, pageSize, totalPages, regions } 구조로
변경(기존에 이 API를 호출하는 프론트가 코드상 없었음을 사전 확인해
안전하게 확장). 정렬은 상태우선순위(접수중→접수예정→접수마감→
무순위) 후 receiptStartDate desc로 확정 — 실측 접수예정 7건이
항상 목록 최상단에 노출됨. 가격 필터 구간(3/5/7/10억)을 실 데이터
분포(총 1,046건: ~3억 45/~5억 174/~7억 306/~10억 233/10억초과 288)로
재검증 후 그대로 채택. /presales/page.tsx(서버, generateMetadata)+
presales-client.tsx(클라이언트, useSWR) 구조는 기존 apt/[name]
패턴을 재사용. 카드 클릭은 상세페이지 부재로 비활성화하고 청약홈
원문 링크(pblancUrl)만 CTA로 제공(P2-D3에서 상세 라우트로 교체
예정). /redevelopment "분양·청약" 탭에 /presales로 가는 링크 1줄만
추가(기존 탭 구조 변경 없음).

서비스 코드 변경:

있음 (src/app/api/presales/route.ts 확장, src/app/presales/page.tsx
신규, src/app/presales/presales-client.tsx 신규,
src/app/presales/page.module.css 신규,
src/app/redevelopment/redevelopment-client.tsx,
src/app/redevelopment/redevelopment.module.css)

DB 변경:

없음

패키지 변경:

없음

테스트 결과:

API curl 테스트(pagination/지역/상태/가격/복합필터/빈결과/잘못된
파라미터/범위밖 page) 전부 실 DB 데이터 기준으로 기대값과 일치.
브라우저(Chrome, localhost)로 필터 상호작용·페이지네이션·
/redevelopment 링크 동작 확인. tsc/lint/build 전부 통과(lint 경고
5건은 이번 변경과 무관한 기존 파일). 모바일(360~390px) 실기기
스크린샷은 구현 당시 브라우저 자동화 도구의 뷰포트 리사이즈 제약으로
확보하지 못해 CSS 코드 리뷰로만 검증했으나, 이후 실제 배포
환경(https://real-estate-app-park11.vercel.app)에서 모바일 실기기로
재검증해 지역/상태/가격/복합 필터·1,046건 로딩·카드 레이아웃 전부
정상 확인(상세는 docs/development/08-presale-list-ui.md "최종 검수
결과" 참고). 배포 직후 1회 보고된 API 오류는 이후 재현되지 않았고
production API 반복 호출(6/6) 전부 정상 응답해 일시적 현상으로
판단(근본 코드 결함 없음).

상태:

완료(2026-08-13 최종 검수 승인 — 모바일 실기기 검증 통과. P2-D3
착수)


## 2026-08-13

### PRESALE P2-D3 — 분양 상세 + 일정 + 주택형 + 가격

목적:

/presales/[id] 상세페이지를 실제로 구현. P2-D1에서 확정한 URL
정책(Presale.id 기반)과 P2-D2의 상태 라벨·가격 표시 규칙을 그대로
따름.

핵심:

GET /api/presales/[id] 신규 추가 — Presale 전체 필드 +
houseTypeDetails relation + computePresaleStatus 결과 반환,
id 형식 오류 400/존재하지 않음 404/서버오류 500을
/api/community/posts/[id] 기존 패턴으로 구현. 상세 화면은
apt/[name] 서버 컴포넌트 metadata 패턴을 재사용(prisma 직접 조회로
실제 houseName/가격/일정 기반 title·description 생성). 주택형은
<details>/<summary> 네이티브 아코디언으로 구현, HOUSE_TY 표시는
houseTy 문자열을 파싱하지 않고 이미 ㎡ 단위인 supplyArea 컬럼을
그대로 쓰고 타입 접미사(A/B 등)만 정규식으로 추출(원본 코드는
아코디언 내부에 그대로 병기). 위치정보는 MapViewer(Kakao SDK)가
/map 페이지에서만 스크립트 로드되는 것을 확인해, 이번 STEP은
인터랙티브 지도 대신 주소+카카오맵 링크 카드로 최소 구현(실제 지도
임베드는 P2-D4로 이관). 목록 카드 클릭을 /presales/[id]로 연결하고
"청약홈에서 공고 보기" 링크는 stopPropagation으로 이벤트 충돌 방지.

서비스 코드 변경:

있음 (src/app/api/presales/[id]/route.ts 신규,
src/app/presales/[id]/page.tsx 신규,
src/app/presales/[id]/presale-detail-client.tsx 신규,
src/app/presales/[id]/page.module.css 신규,
src/app/presales/presales-client.tsx 카드 클릭 연결,
src/app/presales/page.module.css cursor 추가)

DB 변경:

없음

패키지 변경:

없음

테스트 결과:

로컬 API로 일반 APT/신혼희망타운/가격 단일·범위/좌표 유무/
constructCompany null/주택형 20개 공고/존재하지 않는 id/잘못된
id 형식 8개 시나리오 전부 기대값과 일치. 브라우저로 아코디언
펼침(0과 null 구분 확인)·카카오맵 링크 조건부 노출·404·400
상태·목록→상세→뒤로가기·청약홈 새 탭 이동(이벤트 충돌 없음) 전부
확인. lint에서 <a href>를 next/link Link로 교체하는 오류 1건
발견·수정 후 tsc/lint/build 전부 통과. 모바일 실기기 검수 후
주택형 요약 표시를 가독성 문제로 1회 수정 — DB supplyArea 원본은
그대로 두고 표시만 소수점 최대 2자리로 반올림, trailing zero
제거, 제목(면적+타입)과 공급·가격 정보를 두 줄로 시각 분리(상세는
docs/development/09-presale-detail-ui.md §22 참고).

상태:

완료(2026-08-13 최종 검수 승인 — 모바일 실기기 검증 통과, 주택형
표시 가독성 수정 반영. P2-D4 미착수)


## 2026-08-13

### PRESALE P2-D4-A — 위치·주변 아파트·실거래 연결 가능성 조사

목적:

"분양 위치 → 주변 아파트 → 주변 아파트 실거래 → 분양가 비교" 흐름이
이집의 현재 데이터/API 구조로 얼마나 정확하게 구현 가능한지, 추측이
아니라 실제 코드·실제 API 응답·실제 DB 데이터로 검증. 조사·설계
전용(코드/DB/schema/package 변경 없음).

핵심:

Apartment 모델은 좌표 필드 자체가 없고 실제 20건뿐(전국 마스터 아님),
Property 모델은 좌표 필드는 있으나 0건으로 완전히 비어 있어 이 앱에는
좌표 기반 아파트 마스터가 없음을 재확인. 대신 Kakao Local API 반경검색
(radius+sort=distance)이 이미 이 프로젝트의 검증된 기존 패턴(학교/학원
검색 등)임을 확인하고, Presale 5건(서울/경기/부산 남구/부산 서구/좌표
null 각 1건)의 실제 좌표로 직접 호출해 검증. 부산 서구 표본(id=479,
DB 내 유일)에서 Kakao 반경 1km 결과와 MOLIT 12개월 실거래(918건)를
직접 대조해 이름 정규화("아파트" 접미사 제거)만으로 약 79%(14건 중
11건) 매칭됨을 실측 확인. 500m→1km→2km로 반경을 넓혀도 Kakao API
자체의 pageable_count 상한 때문에 후보 수가 늘지 않는 지역이 있음을
발견(서울/부산 남구는 1km에서 이미 상한 도달). MOLIT 원본 XML에
aptSeq(단지 고유번호)라는, 이 프로젝트가 현재 활용하지 않는 안정적
연결키 후보가 있음을 발견. PresaleHouseTypeDetail 15건 실측 대조로
houseTy 앞자리 숫자(예: "059.9973A"→59.9973)가 전용면적, supplyArea가
공급면적을 의미할 가능성이 높음을 확인(공식 API 문서 재대조는 못해
"확인 필요"로 남김) — supplyArea와 MOLIT excluUseAr(전용면적)를 직접
비교하면 안 된다는 것을 실측으로 확정.

서비스 코드 변경:

없음 (조사 전용. 조사용 임시 스크립트 6개 생성 후 결과 확인 즉시 삭제
— production 코드/scripts 디렉터리에 남긴 변경 없음)

DB 변경:

없음 (조회만 수행, Presale 좌표 728/1,046(69.6%)·Apartment 20건·
Property 0건·RedevelopmentProject 0건 전부 재확인만 함)

패키지 변경:

없음

최종 판단:

B(부분적으로 가능하지만 추가 데이터/마스터 구축 필요). 좌표 있는
728건에 한해 LEVEL 1~2(지역/주변 실거래 참고) 수준은 지금 바로 시작
가능하나, 상시 신뢰 가능한 기능으로 만들려면 DB 캐시와 향후 아파트
마스터 확장이 필요함. 상세는
docs/development/10-presale-location-market-analysis.md 참고.

검수 후 반영:
최종 판단 B 그대로 확정. Apartment(좌표 없음, 20건)/Property(0건)
둘 다 전국 아파트 마스터 역할 불가함을 재확인. Kakao 반경검색은
후보 탐색용으로만 쓰고 마스터로 쓰지 않는다는 원칙 명시. 부산 서구
실측 매칭률 약 79%(21% 미매칭)는 전국 서비스의 최종 연결 방식으로
채택하지 않는다는 점을 명확히 함. MOLIT aptSeq(단지 고유번호)는
중요 발견사항으로 기록하되, 안정성/지역간 유일성/거래월별 유지
여부/동명 충돌 해소/타 데이터소스 연결 가능성을 향후 Apartment
Master 설계 STEP(MASTER M1)에서 검증하기 전까지 PK로 확정하지
않음. supplyArea≠houseTy 앞자리 숫자이며 MOLIT excluUseAr(전용
면적)와 supplyArea를 직접 비교하지 않는다는 정책 확정, houseTy
앞자리=전용면적 여부는 공식 API 문서 재확인 전까지 미확정 상태
유지. P2-D4 진행 순서를 "P2-D4-A 완료 → Apartment Master 조사/
설계 → Apartment Master 구축 → P2-D4 복귀 → 위치/주변아파트/
실거래 비교 구현"으로 변경(분양 기능 포기가 아니라 순서 조정).
상세는 docs/development/10-presale-location-market-analysis.md
"최종 검수 결정" 참고.

상태:

완료(2026-08-13 최종 검수 승인 — 최종 판단 B 확정. P2-D4-B 이하
구현은 Apartment Master 구축 이후로 순서 조정, 당장 착수하지 않음)


## 2026-08-13

### MASTER M1 — Apartment Master DB 정밀 조사 및 설계

목적:

이집 전체 부동산 데이터의 중심이 될 "Apartment Master" 구조를
설계하기 위한 근거를 실제 코드·실제 API 응답·실제 DB 데이터로
확보. 조사·검증·설계 전용(schema/migration/대량 저장/코드 수정
없음).

핵심:

기존 Apartment(20건, 좌표 필드 없음)/Property(0건) 둘 다 마스터
역할 불가함을 재확인. 코드 전체에서 이름 문자열 매칭 사용처
6곳을 찾았고, 정확히 같은 정규화 함수가 5개 파일에 중복 구현돼
있음을 확인. MOLIT aptSeq를 서울/경기/부산/대구 4개 지역·18개월·
16,579건 실측 수집해 null 0%, 지역간 중복 0건, 월별 불안정 0건을
확인했고, 서울 강남구에서 실제로 "금호어울림" 등 10건의 동일명-
다른단지 충돌 사례를 찾아 aptSeq가 정확히 구분해냄을 실측으로
증명(2026-08-11 세션의 금호어울림 Naver 스크래핑 버그와 같은
종류의 위험이 MOLIT 레벨에도 존재함을 재확인). MOLIT 원본에
umdCd(법정동코드)가 이미 포함돼 있어, 건축물대장 조회 시
REGCODE_PROXY(제3자 Cloud Run) 없이도 조회 가능한 경로를 실측
발견 — 01 문서가 지적한 단일장애점 리스크를 상당 부분 우회
가능. 건축물대장 총괄표제부 API에서 mainBldCnt(동수)/mgmBldrgstPk
(건축물대장 관리번호, 새로운 외부식별자 후보) 등 필드를 확인.
인천 서구(28260) 18개월 실거래가 0건으로 지속되는 반면
REGCODE_PROXY는 옛 코드만 갖고 있어, 행정구역 개편 문제로
Kakao/REGCODE_PROXY/MOLIT 3개 소스의 지역 기준 시점이 서로
어긋난 실사례를 확인. 부산 서구 156개 고유단지 규모로 전수
검증이 현실적임을 확인, 6개 심층표본 중 aptSeq/Kakao 연결
6/6, 건축물대장 연결 실측 성공 사례 확보. 기존 코드 결함
발견(school/apartments/route.ts가 폐기된 건축물대장 API 호출)
및 P2-D4-A 문서의 "Haversine 없음" 서술이 부정확함을 정정
(@turf/turf의 distance()가 이미 사용 중) — 전부 기록만 하고
수정하지 않음.

서비스 코드 변경:

없음 (조사 전용. 조사용 임시 스크립트 다수 생성 후 결과 확인
즉시 삭제 — production 코드/scripts 디렉터리에 남긴 변경 없음)

DB 변경:

없음 (조회만 수행)

패키지 변경:

없음

최종 판단:

B(새 ApartmentMaster 모델을 만들고 기존 Apartment를 점진적으로
이관). aptSeq 최종 판단도 B(유용하지만 복합키/추가 검증 필요) —
18개월 관측 근거는 강하나 장기 안정성(재건축 등) 미검증, MOLIT가
aptSeq 직접조회를 지원하지 않는 구조적 제약, 무거래 단지에는
aptSeq 자체가 없다는 한계로 내부 PK+nullable unique 구조를 권장.
상세는 docs/development/11-apartment-master-analysis.md 참고.

검수 후 반영:
최종 완료로 승인(2026-08-13). 핵심 결론 확정 — 기존 Apartment/
Property는 전국 Master로 부적합, 이름 기반 단지 연결 금지,
aptSeq는 핵심 외부 식별자 후보(단독 절대신뢰 아님, M2에서 추가
검증), 새 ApartmentMaster 신규 생성 후 기존 Apartment 점진
이관, REGCODE_PROXY 의존성 축소 필요, school/apartments/route.ts
폐기 API 문제는 별도 기술부채로 유지(수정하지 않음). MASTER M2로
진행.

상태:

완료(2026-08-13 최종 검수 승인)


## 2026-08-13

### MASTER M2 — Apartment Master 데이터 모델·식별자·수집정책 설계

목적:

MASTER M1 조사 결과를 기반으로 실제 구축 전에 데이터 모델·
식별자·수집정책·갱신정책·지역확장 방식을 확정. 조사·설계
전용(schema/migration/DB변경/코드수정 없음).

핵심:

aptSeq를 M1(4개 지역)보다 넓은 6개 신규 지역(서울 마포/부산
해운대/경기 수원영통/인천 연수/전북 전주덕진/경남 창원성산)
18개월씩 추가 실측 — M1과 합쳐 10개 지역·64,705건에서 aptSeq
null 0%, 지역간 중복 0, 월별 불안정 0을 재확인. 동일명-다른단지
충돌 사례를 총 44건(M1 10건+M2 34건) 확인해 이름매칭 위험이
전국 어디서나 반복됨을 재확인. 서울 마포구 "공덕SK리더스뷰"가
동일 이름·동일 지번인데 aptSeq가 둘로 나뉜 사례를 원본 거래
데이터로 직접 분석해 데이터 결함이 아니라 동군(101-103동 vs
201동) 분리 등록임을 규명 — 이를 근거로 ApartmentMaster 한 행을
"aptSeq 1개" 단위로 정의. 건축물대장 총괄표제부/표제부 두
엔드포인트를 교차조회해 mgmBldrgstPk가 단지(총괄표제부) 단위
식별자로 보임을 확인. 이번 STEP 최대 발견: 전북 전주/군산 등
지역 전체의 MOLIT LAWD_CD 접두어가 이미 "45"에서 "52"로 이관
완료된 상태(estateAgentSggNm 필드로 실측 확인)인데, 이 프로젝트가
의존하는 REGCODE_PROXY는 "52" 접두어를 전혀 인지하지 못함을
발견 — M1의 인천 서구 사례(구 단위)보다 훨씬 큰 도 단위 이관
사례. 이를 근거로 lawdCd에 신선도 관리 + MOLIT 응답 자체를
지역코드 유효성 보조신호로 쓰는 정책을 설계. ApartmentMaster
후보 schema(21개 필드, 출처/nullable/unique/index 표) 작성,
기존 Apartment 이관은 B안(신규모델+점진이관) 재확인, @turf/turf
distance() 재사용 가능함을 재확인.

서비스 코드 변경:

없음 (조사 전용. 조사용 임시 스크립트 다수 생성 후 결과 확인
즉시 삭제)

DB 변경:

없음 (조회만 수행)

패키지 변경:

없음

최종 판단:

A(설계가 충분히 확정되어 MASTER M3 소량 구축 검증으로 진행
가능). M3 진입에 필요한 9개 핵심 항목 중 7개 확정, 나머지
2개도 M3에서 실측하며 다듬으면 되는 수준. 상세는
docs/development/12-apartment-master-design.md 참고.

검수 후 반영:
최종 완료로 승인(2026-08-13). ApartmentMaster 1행=aptSeq 1개로
확정하되 내부 PK는 aptSeq 자체를 쓰지 않고 자체 id를 사용(aptSeq는
nullable unique 외부 식별자)하는 구조로 최종 확정. REGCODE_PROXY는
지역코드의 authoritative source로 사용하지 않고 가능하면 MOLIT
원본 sggCd/umdCd를 우선 활용하기로 확정(제거 여부는 M3에서 기존
의존 코드 재조사 후 결정, 이번 STEP은 코드 미수정). mgmBldrgstPk는
유용한 외부 식별자로 기록하되 aptSeq와 동일 의미로 간주하지 않고
별도 연결 구조(건물정보 enrichment용)로 설계하기로 확정, 실제
relation/mapping 방식은 M3 소량 검증 후 결정. MASTER M3는 "소량
실제 구축 검증" 단계로 정의(전국/부산전체 구축 금지) — 부산
서구(Alpha Master, 소규모 수동검수용) + 부산 해운대구(Stress
Test, 더 다양한 환경) 두 지역 비교로 확정, 대량 적재는 하지 않음.
Master 구축 테스트(엔지니어링)와 향후 사용자 Alpha/Beta 테스트
(서구 Alpha→해운대 Challenge→부산 Beta→전국표본 Beta→전국)는
별개 트랙임을 개념으로만 기록. MASTER M3로 진행(이번 STEP에서
M3 착수하지 않음).

상태:

완료(2026-08-13 최종 검수 승인)


## 2026-08-13

### MASTER M3 — Apartment Master 부산 서구 + 해운대 소량 구축 검증

목적:

MASTER M1/M2 설계를 실제 DB에 처음 구현·적재하는 소량 실제 구축
검증. 부산 서구 + 부산 해운대구로 한정(부산 전체/전국 적재 금지).

핵심:

Prisma에 ApartmentMaster 모델(22개 필드, 내부 id PK + aptSeq
nullable unique) 신규 추가, migration(CREATE TABLE + index 4개,
DROP/ALTER 없음) 생성·적용. scripts/apartment_master_seed.ts를
작성해 MOLIT(aptSeq/주소) → 건축물대장(REGCODE_PROXY 미사용,
sggCd+MOLIT umdCd+jibun 직접 조회) → Kakao(좌표, exact/normalized/
failed) 순으로 enrichment하는 파이프라인 구현. 부산 서구 15건,
해운대구 18건 총 33건 적재. aptSeq unique 충돌 0건, idempotency
확인(재실행 후 행수 33 유지, 신규행 0). 해운대 Stress Test 중
Kakao 키워드검색 응답에 지역 검증용 중첩 필드가 애초에 없어(주소
검색 API와 다른 스키마) 지역 불일치 검증이 사실상 항상 통과되던
실제 버그를 발견 — 에이스빌라/스카이맨션/대림맨션 3건이 경기도
부천시 동명 장소로 잘못 지오코딩된 것을 확인·정정(좌표 null 처리).
mgmBldrgstPk가 JS Number 안전정수 범위를 넘을 때 res.json()의
표준 파싱이 값을 조용히 훼손하는 것(예: 22자리 정수가
"1.0000000000000042e+21"로 깨짐)도 실제로 발견해 원본 텍스트
정규식 추출로 수정, 3건 정정. 서구 건축물대장 성공률 40%,
해운대 56% — 실패 원인을 진단해 오래되거나(1970년대) 소규모인
건물은 총괄표제부 자체가 미등록(표제부에는 존재)임을 확인,
정책대로 동 단위 값을 단지 전체로 저장하지 않고 null 유지.
좌표 성공률 서구 100%/해운대 77.8%. 사용승인일만 유독 결측이
많은(서구 40%/해운대 22%) 현상도 발견해 기록. Presale-
ApartmentMaster 거리를 @turf/turf distance()로 읽기전용 계산
성공(DB 저장 없음). 기존 Apartment(20건)/Property(0건)/
Presale(1046건) 전혀 영향 없음, build 성공(29개 라우트 정상).

서비스 코드 변경:

있음 (prisma/schema.prisma — ApartmentMaster 모델 추가만, 기존
모델 변경 없음). 신규 scripts/apartment_master_seed.ts(재사용
가능한 seed 파이프라인으로 보존, 조사용 임시 스크립트 아님).
기존 production 코드(API 라우트/컴포넌트 등)는 전혀 수정하지
않음 — 새 Master는 병행 상태로만 존재, 기존 코드가 이를
사용하도록 전환하지 않음.

DB 변경:

있음 (migration 1건: 20260813033432_apartment_master_m3, 신규
테이블 apartment_masters 생성 + index 4개, 기존 테이블/컬럼
변경·삭제 없음. 실 데이터 33건 적재 — 부산 서구 15건, 해운대
18건)

패키지 변경:

없음

테스트 결과:

prisma validate 통과, migrate status "up to date", tsc --noEmit
오류 0, lint 오류 0(경고 5건 전부 기존 파일), build 성공(29개
라우트 정상 생성). aptSeq unique 충돌 0건, 중복 0건, idempotency
통과, 기존 Apartment/Property/Presale 레코드 수 불변 확인.

최종 판단:

A(현재 ApartmentMaster 구조로 M4 확장 가능). aptSeq unique
정책이 33건 실제 적재+재실행에서 충돌 0건으로 실증, schema가
지역 규모 차이(1.9배)에도 변경 없이 적용됨, 기존 기능 전혀
영향 없음, 발견된 2개 버그는 schema 결함이 아니라 스크립트
로직 결함으로 확인 즉시 수정 완료. 상세는
docs/development/13-apartment-master-m3-pilot.md 참고.

검수 후 반영:
최종 판단 A 승인. 정책 확정 — (1) ApartmentMaster.id 내부 PK +
aptSeq nullable unique 구조 유지, (2) aptSeq/mgmBldrgstPk 등
외부 식별자는 문자열로만 취급하고 산술/Number 변환 금지(정밀도
손실 사고가 직접 근거), (3) Kakao geocoding은 성공률보다 정확도
우선 — 지역검증 불가/동명장소 가능성 있으면 임의 fallback 없이
null 유지, (4) 건축물대장 enrichment 실패는 Master 생성 실패로
취급하지 않음(identity와 enrichment 분리), (5) 현재 건축물대장
성공률(서구 40%/해운대 56%)은 blocker 아닌 M4 이후 개선과제로
기록, (6) scripts/apartment_master_seed.ts는 재사용 seed
pipeline으로 유지. MASTER M4로 진행.

상태:

완료(2026-08-13 최종 검수 승인)


## 2026-08-13

### MASTER M4-A — 부산 전체 ApartmentMaster 확장 전 조사

목적:

MASTER M3(부산 서구+해운대 33건 파일럿) 승인을 전제로, 부산 16개
구·군 전체 확장 전 규모·정책·리스크를 실제 API 호출로 조사.
조사·정책확정 전용(schema/migration/DB write/코드수정 없음).

핵심:

부산 16개 구·군 전체를 MOLIT 실거래 API로 실측 조사(최근 12개월,
대표 5개 지역은 36개월) — distinct aptSeq 합계 2,906개(12개월
기준), aptSeq null 비율 전 구·군 0% 재확인. 서구/해운대/부산진구/
수영구/기장군 5개 지역에서 12/24/36개월 시점별 coverage 비교 —
12→24개월 구간 평균 +18.9%, 24→36개월 구간 평균 +8.6%로 증가세
둔화 확인, 24개월을 M4-B 기본 조회기간으로 권장. 부산진구에서
건축년도별 건축물대장 성공률을 추가 실측한 결과 pre-1990 건물이
오히려 100% 성공(M3의 "오래될수록 실패" 가설과 반대) — 성공률의
진짜 결정 요인이 건축년도가 아니라 "건물 형태(대단지 여부)"임을
재규명, 부산진구 평균 성공률(~89%)이 M3의 서구 40%/해운대 56%
보다 훨씬 높아 성공률이 지역마다 크게 다름을 확인. 프로젝트
전체 REGCODE_PROXY 사용처 8개 파일을 A(Master 구축 직접영향)/
B(기존 UI 사용) 분류 — Master seed는 이미 우회 경로를 쓰고 있어
M4-B가 REGCODE_PROXY와 무관함을 재확인, region-utils.ts와
molit-stats-helpers.ts에 동일 로직이 중복 구현된 것도 추가 발견.
부산 전체 seed 예상 API 호출량(MOLIT 약 384회 + 건축물대장 약
3,400회 + Kakao 약 7,100회, 합계 약 10,900회)과 처리시간(순차
3~6시간, 제한병렬 40분~2시간)을 추정치로 계산(정확한 일일 호출
한도는 미확인으로 기록). 신규 aptSeq 자동발견은 관리자 수동
배치(기존 청약홈 sync 패턴 재사용) 권장, 실시간 사용자 요청
경로에서의 Master 생성은 비권장으로 결론. mgmBldrgstPk는
complex-level 식별자로 재확인하되 단일 컬럼·unique 없음 정책
유지. Seed source 전략은 "MOLIT 거래 기반 우선 + 무거래단지
보강(M4-C로 분리)"로 확정.

서비스 코드 변경:

없음 (조사 전용. 조사용 임시 스크립트 생성 후 결과 확인 즉시
삭제)

DB 변경:

없음 (read-only 조회만 수행, 기존 33건 변경 없음 재확인)

패키지 변경:

없음

최종 판단:

A(현재 구조와 정책으로 MASTER M4-B 부산 전체 구축 진행 가능).
M4-B 권장 Scope 확정 — 반드시 할 것(16개 구·군 24개월 거래단지
Master 확보, 건축물대장/Kakao enrichment, 구·군별 batch+검증),
하지 말아야 할 것(무거래단지 보강/실거래DB캐시는 M4-C로 분리,
legacy Apartment 이관/Region Master/REGCODE_PROXY 제거/
P2-D4-B/재개발/커뮤니티는 전부 범위 밖). 상세는
docs/development/14-apartment-master-m4-expansion-analysis.md
참고.

검수 후 반영:
최종 판단 A 승인(단 M4-B는 별도 STEP으로 착수, 이번 승인에
불포함). M4-B 기본 discovery 기간 24개월로 확정 — 단 100%
coverage 의미 아님, 무거래/장기무거래 단지는 M4-C로 명시 분리.
건축물대장 실패원인은 "오래된/소규모일수록 실패"로 일반화하지
않기로 최종 확정 — 건물형태/총괄표제부존재/원천데이터구조/
지역별품질 영향으로 보되 확정 안 된 원인을 코드에 하드코딩하지
않음. REGCODE_PROXY는 M4-B에서 손대지 않음(Master 구축은 이미
우회 중, 기존 UI 사용처는 기술부채로 유지, region-utils.ts/
molit-stats-helpers.ts 중복도 정리 후보로만 기록). M4-B 기본
Scope 최종 확정 — 16개 구·군/24개월/aptSeq upsert(기존 33건
삭제 없이 upsert)/건축물대장+Kakao enrichment/구·군별 batch+
검증/idempotency/품질리포트는 필수, 무거래단지보강·실거래
DB캐시·legacy이관·RegionMaster·REGCODE_PROXY제거·P2-D4-B·
재개발·커뮤니티·전국확장은 범위 밖. API 호출량(~10,900회)은
추정치로만 기록, 정확한 일일한도는 추측하지 않음. M4-B 실행
안전원칙 확정 — 구·군별 순차 실행+batch마다 검증, unique충돌/
잘못된지역좌표/DB또는API오류반복/비정상적enrichment실패율/
무결성문제 발생 시 즉시 다음 batch 중단, 의심데이터 억지저장
금지.

상태:

완료(2026-08-13 최종 검수 승인 — M4-B는 별도 STEP으로 착수)


## 2026-08-13

### MASTER M4-B — 부산 전체 ApartmentMaster 구축(1차, 7/16 구·군 부분 완료 — 이후 같은 날 continuation에서 16/16 완료, 아래 항목 참고)

목적:

MASTER M4-A 조사·정책을 바탕으로 부산 16개 구·군을 실제
ApartmentMaster에 적재. 사전점검→dryRun→pilot→검증→나머지
batch 순서로 안전하게 진행(무검증 일괄 실행 금지).

핵심:

16개 구·군 24개월(202409~202608) dryRun 완료 — distinct aptSeq
합계 3,403개(M4-A 12개월치 2,906 대비 +17.1%, 추정범위 부합),
null aptSeq 전 구·군 0, 기존 33건 discovery 누락 0으로 sanity
check 통과. 부산진구(404유닛)를 pilot으로 선정해 실제 적재 중
심각한 STOP 조건 발생 — 건축물대장(BldRgstHubService) API의
초당 요청제한(429)으로 404건 중 310건(76.7%) 실패, Kakao는
동일조건에서 전혀 영향 없음을 별도 실측으로 확인. 원인분석 후
건축물대장 호출만 전역 직렬화(최소 1.5초 간격)+제한적 재시도
(429/503만, 최대 2회)로 구조적 해결, 재실행 결과 api_error 0
확인. 검증 중 서로 다른 aptSeq가 동일 좌표를 공유하는 새로운
문제도 발견(Kakao 키워드검색이 유사 단지를 하나의 POI로만 색인,
부산진구 9건 + 이후 구·군 경계를 넘는 사례 1건 추가) — "성공률
보다 정확도" 원칙에 따라 exact 우선/모호하면 전체 null 처리하는
좌표중복정정 로직을 추가해 파이프라인에 정식 반영, 이후 batch
부터 자동 실행. Pilot 통과 후 강서구/중구/동구/영도구/사상구/
기장군 순서로 batch 진행해 7개 구·군(부산진구 포함, 1,042유닛)
24개월 전량 완료. 건축물대장 성공률이 지역별로 12%~80%까지
크게 다름을 재확인(원인을 건축년도로 하드코딩하지 않음). 최종
1,075건(기존 33건 + 신규 1,042건) — aptSeq 중복 0, 부산 외
좌표 0, 좌표중복 0(정정후), mgmBldrgstPk 정밀도손실 0, 기존
Apartment/Property/Presale/PresaleHouseTypeDetail 전부 불변
확인. 강서구 대표 재실행으로 idempotency 통과(신규 0, 갱신
44). 시간 제약상 나머지 9개 구·군(서구/해운대구 전량 완료 +
동래구/남구/북구/사하구/금정구/연제구/수영구, distinct aptSeq
합계 1,884개 미착수)은 후속 세션으로 이관 — 무리하게 강행하지
않음.

서비스 코드 변경:

없음(production 코드 미수정). scripts/apartment_master_seed.ts
확장(throttle/재시도/좌표중복정정/dryRun/24개월 파라미터화,
재사용 가능한 seed pipeline으로 계속 보존), .gitignore에 구·군별
batch 결과 JSON 디렉터리 제외 추가.

DB 변경:

있음(schema/migration 변경 없음 — M4-A 판단대로 스키마 변경
불필요). ApartmentMaster 실 데이터 33→1,075건(신규 1,042건
적재). 기존 Apartment(20)/Property(0)/Presale(1,046)/
PresaleHouseTypeDetail(5,395)은 전부 불변.

패키지 변경:

없음

테스트 결과:

prisma validate 통과, migrate status "up to date"(신규 migration
0건), tsc --noEmit 오류 0, lint 오류 0(경고 5건 기존파일),
build 성공. aptSeq 중복 0, idempotency 통과, 기존 데이터 4개
테이블 전부 불변 확인.

최종 판단:

판단1(M4-B) = B(부분 성공 — 보완 필요). 완료된 7개 구·군의
데이터 품질은 안전(중복/오염/정밀도손실 전부 0)하나 "부산 전체
구축"이라는 핵심 목표는 미달성(coverage 약 31.6%, distinct
aptSeq 1,075/3,403) — 남은 작업은 동일 파이프라인 반복 실행일
뿐 추가 구조변경 불필요. 판단2(다음단계)는 M4-B 완료를 전제로
한 선택지라 강제 적용 불가, 현재 상태 기준으로는 "사용자
테스트와 병행하며 결정 가능"에 가장 근접 — 서구/해운대구
전량완료를 최우선 후속 batch로 권장. 상세는
docs/development/15-apartment-master-m4-busan-build.md 참고.

상태:

완료(7/16 구·군 시점의 중간 기록 — 아래 continuation 항목에서 16/16 전체 완료로 이어짐)

### MASTER M4-B (continuation) — 부산 16개 구·군 전체 완료

목적:

위 항목에서 부분 완료(7/16) 상태로 남겨둔 나머지 9개 구·군(서구/
해운대구 전량 확장 + 동래/남/북/사하/금정/연제/수영 신규)을 같은
날 이어지는 세션에서 완료. 기존 완료 7개 구·군은 재처리하지 않고
그대로 보존.

핵심:

서구·해운대구(M3 표본 15/18건)를 먼저 24개월 전량으로 안전하게
확장(upsert, 삭제·재생성 없음, 100% 보존 확인) 후 북구/남구/
연제구/수영구/금정구/동래구/사하구 순으로 순차 batch 진행.
9개 구·군 전체에서 §F-1(429 rate limit)·§F-4(좌표중복정정)
안전장치가 안정적으로 작동, 구조적 STOP 조건 재발 없음(api_error
16개 구·군 합계 31/3,403=0.9%). 최종 ApartmentMaster 3,402건
(discovery distinct aptSeq 합계 3,403 대비 1건 차이는 동래구/
연제구 경계의 교차-LAWD_CD aptSeq 1건이 upsert로 정상 병합된
결과, 신규 조사 후 STOP 대상 아님으로 판단). coverage 4개 지표를
분리 계산: 구·군 처리율 16/16=100%, 24개월 discovery 처리율
3,403/3,403=100%, 좌표 확보율 3,067/3,402=90.2%, 건축물대장
enrichment 3,402건 중 1,389건=40.8%. 서구/해운대구/부산진구/
연제구 4개 구·군 대표 idempotency 재검증 전부 통과(created=0).
재검증 과정에서 자체 실수(검증용 라벨 문자열이 sigungu 필드에
그대로 흡수)로 4개 구·군 1,127건의 sigungu가 일시 오염된 것을
발견 — 즉시 정확히 원상복구(임의값 생성 아님, 원래 문자열만
복원), 잔여 오염 0건 재확인. 기존 Apartment(20)/Property(0)/
Presale(1,046)/PresaleHouseTypeDetail(5,395) 전부 불변 재확인.

서비스 코드 변경:

없음(production 코드 미수정, 이전 세션에서 완성한
scripts/apartment_master_seed.ts를 재사용만 함 — 이번
continuation에서 추가 스크립트 수정 없음).

DB 변경:

있음(schema/migration 변경 없음). ApartmentMaster 실 데이터
1,075→3,402건(신규 2,918건 + 갱신 485건, 16개 구·군 배치 합계
기준). 기존 Apartment/Property/Presale/PresaleHouseTypeDetail은
전부 불변.

패키지 변경:

없음

테스트 결과:

prisma validate 통과, migrate status "up to date"(신규 migration
0건), tsc --noEmit 오류 0, lint 오류 0(경고 5건 기존파일), build
성공. aptSeq 중복 0/null 0, 부산 외 좌표 0, 좌표중복 0(정정후),
mgmBldrgstPk 정밀도손실 0, 4개 구·군 대표 idempotency 전부 통과,
기존 데이터 4개 테이블 전부 불변 확인.

최종 판단:

판단1(M4-B) = A(부산 전체 구축 성공). 16개 구·군 전체 24개월
거래단지 discovery+enrichment 완료, M4-A §Z coverage 기준
3개(coverage/좌표/duplicate) 전부 충족. 판단2(다음단계) = C(사용자
테스트와 병행하며 결정 가능) — 단 M4-C/P2-D4-B 등 실제 착수는
이번 STEP에서 진행하지 않고 검수 후 사용자 결정을 기다림. 상세는
docs/development/15-apartment-master-m4-busan-build.md §AA~AB 참고.

상태:

완료. 사용자가 §AB 판단1(A. 부산 전체 구축 성공)을 최종 승인했다.
승인 조건이었던 sigungu 복구 상태 read-only 전수 재검증(4개
구·군 1,127건 대상)을 수행해 잔존 오염 0건을 재확인했고, 부산
16개 구·군 분포·동래구↔연제구 교차 aptSeq 1건·핵심 품질 지표를
모두 재확인했다(전부 정상, DB 추가 수정 없음). 건축물대장
enrichment 40.8%는 Master identity 실패가 아닌 optional
enrichment 한계로 기록하며 M4-B 완료의 blocker로 취급하지
않는다. 장기 무거래 단지 보강/실거래 DB cache/건축물대장
enrichment 개선은 M4-C 후속 과제로 유지하고 이번 STEP에서
착수하지 않는다. 상세는
docs/development/15-apartment-master-m4-busan-build.md §AC~AD 참고.
