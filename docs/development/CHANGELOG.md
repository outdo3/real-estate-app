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

### PRESALE P2-D4-B — 주변 아파트·실거래 비교 기능 조사/설계

목적:

MASTER M4-B로 구축된 부산 ApartmentMaster(3,402건)를 실제로
활용해, 분양 상세페이지에 "주변 아파트 + 최근 실거래 + 분양가
비교" 기능을 만들 수 있는지 조사·설계했다. 조사/설계 전용
STEP으로 코드/schema/migration 변경, 실제 UI 구현은 하지 않았다.

핵심:

부산 Presale 85건(좌표 있음 66/77.6%) 재확인. aptSeq 직접 연결을
실제 MOLIT API 호출로 검증 — MOLIT은 aptSeq 단건조회를 지원하지
않아 "lawdCd+월 조회 후 응답 내 aptSeq로 필터링" 구조가 필수이며,
서구 이름충돌 사례("문화" 3개 단지)로 실측 검증했다. 8개 구·군에
분산된 테스트 Presale 10건을 선정해 @turf/turf(기존 설치 패키지)
반경검색을 실측 — 동래구 등 밀집지역은 1km에 60~94개, 강서구
저밀도 지역은 2km까지도 3개뿐인 등 지역별 편차가 커 고정 반경이
아닌 adaptive radius(1km→2km→3km, 후보 5개 미만 시 확장)를
권장. houseTy 앞자리=전용면적 가설을 55개 주택형 표본으로
재검증(문서10 §14의 15개 표본에서 확장) — 일관된 패턴 재확인했으나
공식 문서 미대조로 "확인 필요" 상태 유지, "같은 평형" 대신 "비슷한
전용면적(OO~OO㎡)" 표현 권장. 실거래 면적 허용범위는 남구/
부산진구 실측(고유 excluUseAr 75종/175종 분포)으로 ±1㎡ 권장.
거래기간은 6개월→12개월→24개월 fallback 권장(3개월 단독은
후보의 40~50%가 거래 없음을 실측 확인). API 호출량은 반경 내
후보 수와 무관하게 lawdCd당 월 수(24개월=24회)로 고정됨을
발견 — 기존 getOrSetCache(lawdCd+월 키)와 병렬 chunk 패턴을
재사용하면 신규 인프라 없이 충분, M4-C(실거래 DB cache)는
blocker 아님으로 판단.

서비스 코드 변경:

없음(조사 전용). 조사용 임시 스크립트(scripts/_p2d4b_*.ts, 7개)는
결과 확인 후 전부 삭제.

DB 변경:

없음(schema/데이터 전부 조회만 수행).

패키지 변경:

없음(@turf/turf 기존 설치분 재사용, 신규 설치 없음).

테스트 결과:

해당 없음(조사/설계 STEP, 코드 테스트 대상 없음). DB read-only
쿼리와 실제 MOLIT API 호출로 모든 수치를 실측했다.

최종 판단:

B(기능 구현은 가능하지만 간단한 추가 기반작업이 먼저 필요).
Apartment Master 부재(문서10 P2-D4-A의 B판정 근거)는 M4-B로
해소됐으나, aptSeq를 활용하는 신규 API route·기존 캐시/병렬
패턴 재사용이라는 최소 기반작업이 필요. 상세는
docs/development/16-presale-nearby-market-design.md 참고.

상태:

완료. 사용자가 B판정(B1~B4 분리안 채택)을 최종 승인했다.
실제 구현은 B1부터 순차 진행한다(아래 PRESALE P2-D4-B1 항목).

### PRESALE P2-D4-B1 — 주변 ApartmentMaster 검색 API

목적:

P2-D4-B 조사/설계(B1~B4 분리안)에 따라, 이번 STEP은 "분양공고
좌표 기준 주변 ApartmentMaster 검색 API"만 구현한다. 실거래
연결(B2)/가격비교/면적비교/UI/지도는 이번 STEP 범위 밖.

핵심:

신규 GET /api/presales/[id]/nearby-apartments 구현(기존
[id]/comments류 중첩 라우트 컨벤션 재사용). Presale 좌표 →
bounding box(최대반경 3km 위경도 환산) prefilter → @turf/turf
distance()(기존 설치 패키지, school/apartments/route.ts와 동일
import 재사용)로 정밀 거리 계산 → adaptive radius(1km→1.5km→
2km→3km, 5개 미만이면 확장, 3km에서는 있는 만큼만) → 거리순
정렬 후 최대 5개 반환. ApartmentMaster만 검색 대상(legacy
Apartment/Property 미사용), 좌표 없는 row는 bounding box 쿼리
자체에서 자연히 제외. sigungu/sggCd 필터를 전혀 쓰지 않아
행정구역을 넘는 실제 인접 단지도 후보가 됨 — 남구 분양(id=801)
반경 1km 결과 5개 중 2개가 실제로 수영구 소속임을 실측으로
확인(핵심 요구사항 실증). MOLIT 호출 없음, 응답시간 평균
90.8ms(10개 표본, 2라운드). 좌표없는 Presale 2건 전부 HTTP 200
+ locationAvailable:false로 정상 처리, duplicate 0건, 기존
Apartment/Property/Presale/PresaleHouseTypeDetail/ApartmentMaster
행 수 전부 불변 확인.

서비스 코드 변경:

있음. 신규 파일
src/app/api/presales/[id]/nearby-apartments/route.ts 1개 추가.
기존 파일 수정 없음.

DB 변경:

없음(read-only API, schema/migration 변경 없음).

패키지 변경:

없음(@turf/turf 기존 설치분 재사용).

테스트 결과:

prisma validate 통과, migrate status "up to date", tsc --noEmit
오류 0, lint 오류 0(경고 5건 기존파일), build 성공(신규 라우트
정상 포함). 10개 Presale 실제 API 호출 테스트 전부 통과(정상 8건
+ 좌표없음 2건), 지역경계 실제 사례 확인, duplicate/거리<=반경/
부산외데이터 위반 0건. 기존 /api/presales, /api/presales/[id]
정상 동작 확인.

최종 판단:

A(B1 완료 — B2 진행 가능). 상세는
docs/development/17-presale-nearby-apartment-api.md 참고.

상태:

완료. 사용자가 최종 승인했다. 다음 정책을 확정 유지한다:
주변 ApartmentMaster 검색은 행정구역 필터가 아니라 실제 좌표
거리 기준(1km→1.5km→2km→3km adaptive, 최대 5개 반환, 거리ASC+
deterministic 보조정렬)으로 처리하며, 지역경계 단지도 정상
후보로 포함한다(남구→수영구 실제 사례 문서 유지). roadAddress/
jibunAddress 둘 다 API에서 유지하고 대표 주소 선택은 B3에서
결정한다. 3km 확장 후 5개 미만 경로는 코드상 지원되나 이번
10건 실측에서 관측되지 않았음을 명시하며 B1 완료 blocker로
취급하지 않는다. B1은 MOLIT 호출 없이 ApartmentMaster 주변검색만
담당하는 책임분리를 유지하고, B2는 fetchMolitData의 aptSeq 미추출
문제를 반드시 해결 대상으로 다루며 단지명 문자열 매칭을 기본
연결방식으로 쓰지 않는다.

### PRESALE P2-D4-B2 — 주변 아파트 실거래 연결 API(면적비교 BLOCKED)

목적:

Presale → 주변 ApartmentMaster(B1) → aptSeq → MOLIT 실거래 →
Presale 주택형 전용면적 → 유사면적 실거래 → 가격차이 계산까지
서버에서 구현하는 것이 목표였다. 가격비교 착수 전 houseTy 공식
의미를 반드시 확인하는 BLOCKER 체크를 먼저 수행했다.

핵심:

data.go.kr 공식 API 페이지→한국부동산원(REB) 기술문서 링크를
따라가 실제 "[기술문서] 청약홈 분양정보 조회 서비스" 공식
문서(.docx, 58페이지)를 찾아 26페이지 응답 메시지 명세 표에서
house_ty 행을 직접 확인했다 — 항목설명이 "주택형"(국문 필드명
반복)뿐이며 전용면적이라는 의미를 명시한 공식 정의가 없음을
확인(다른 필드 행에서도 항목설명=국문명 반복 패턴 재확인).
data.go.kr 메타데이터도 house_ty를 "내용" 유형(면적 유형 아님)
으로 분류. 요청안의 명시적 BLOCKER 지침("공식 확인 실패 시
가격차이 계산 중단, 추측으로 진행 금지")에 따라 유사면적
비교·median·differenceAmount 계산은 구현하지 않았다. BLOCKER와
무관한 부분은 정상 구현: fetchMolitData에 aptSeq/excluUseArea/
dealDate/floorRaw optional 필드 추가(기존 필드 불변, 기존
consumer 영향 없음 재확인), aptSeq 기준 실거래 연결(단지명
매칭 미사용), 반경 내 후보의 distinct sggCd 배치 조회(아파트
개수 아닌 sggCd 수에 비례 — 실측 평균 22.5회/최소6/최대48,
"5개×24개월=120콜" 우려 해소), 6→12→24개월 fallback(신규 월만
추가 조회), 기존 getOrSetCache(lawdCd+월 키, /api/apt/[name]과
동일 키로 공유) 재사용. 10개 Presale 실측: 8건 전부 5/5 아파트
거래 확보, 지역경계(남구→수영구) 정상 배치조회 재확인, 429
0건, 거래 duplicate 0건, cold 1.2~8.3초/warm 83~106ms.

서비스 코드 변경:

있음. src/lib/api-molit.ts(optional 필드 4종 추가), 신규
src/lib/nearby-apartments.ts(B1 로직 공통 helper 추출, B1 동작
불변 재검증), 신규
src/app/api/presales/[id]/nearby-market/route.ts.

DB 변경:

없음(read-only API, schema/migration 변경 없음).

패키지 변경:

없음.

테스트 결과:

prisma validate 통과, migrate status "up to date", tsc --noEmit
오류 0, lint 오류 0(경고 5건 기존파일), build 성공(신규 라우트
포함). 기존 /api/presales, /api/presales/[id],
/api/presales/[id]/nearby-apartments(B1) 전부 정상 동작 재확인.
ApartmentMaster/Apartment/Property/Presale/
PresaleHouseTypeDetail 행 수 전부 불변.

최종 판단:

D(비교 방식 재검토 필요). 핵심 목표(유사면적 비교·가격차이
계산)는 공식 근거 확인 실패로 BLOCKED, 그 외 aptSeq 실거래
연결 인프라는 정상 구현·검증 완료. B3 UI 구현으로 진행하지
않는다. 상세는
docs/development/18-presale-nearby-market-api.md 참고.

상태:

완료(1차 기록). 이 항목 작성 시점에는 가격비교 부분이 BLOCKED
상태였다 — 이후 P2-D4-B2-FIX(법령 근거 확보)→P2-D4-B2-CONTINUE
(가격비교 구현 완성)를 거쳐 사용자가 최종 완료 승인했다. 이
BLOCKED 기록은 히스토리 보존을 위해 삭제하지 않는다. 최종 상태는
아래 P2-D4-B2-CONTINUE 항목 참고.

### PRESALE P2-D4-B2-FIX — houseTy 전용면적 의미 확정 전용 조사

목적:

P2-D4-B2의 BLOCKER(houseTy 공식 의미 미확인)를 해소할 추가 공식
근거만 조사했다. 구현은 하지 않았다.

핵심:

법제처 국가법령정보센터에서 「주택공급에 관한 규칙」 제21조를
직접 열람해 원문을 확인했다 — 제21조제5항(현행, 시행
2026.6.15.): "제3항제8호에 따라 공동주택의 공급면적을 세대별로
표시하는 경우에는 주거의 용도로만 쓰이는 면적(이하
"주거전용면적"이라 한다)으로 표시하여야 한다. 다만, 주거전용면적
외에 다음 각 호의 공용면적을 별도로 표시할 수 있다." 이는 청약홈
API 기술문서에는 없던 내용으로, API가 서비스하는 원본
데이터(입주자모집공고)를 규율하는 상위 법령이 "세대별 주택형
표시=전용면적 기준"임을 직접 확인한 것이다. 독립된 3개 소스가
동일 결론(주택형 표기방식이 2009.4.1.부터 전용면적 단독 표시로
변경)을 일관되게 뒷받침했다. 다만 요청된 실제 공고 30개 표본
직접 숫자대조는 PDF 텍스트 추출 실패(폰트 인코딩 문제,
pdftotext 한글 미추출)와 Chrome PDF 뷰어 자동화 제약으로
완료하지 못했다 — 이는 요청안 §10이 우려한 "공고 원문 파싱의
안정성 문제"가 실제로 재현된 사례로 기록.

서비스 코드 변경:

없음(조사 전용).

DB 변경:

없음.

패키지 변경:

없음.

테스트 결과:

해당 없음(조사 전용, 구현 없음).

최종 판단:

B(직접 정의 문장은 없지만 공식 법령 근거+다수 독립 소스 교차
확인으로 실무상 사용 가능한 수준). A로 승격하지 않은 이유는
30개 표본 직접 대조를 기술적 제약으로 완료하지 못했기 때문.
B2 가격비교는 조건부 재개 가능(법령 근거를 UI/API에 명시하는
조건)으로 판단하나 이번 STEP에서 재개하지 않았다. 상세는
docs/development/18-presale-nearby-market-api.md
"houseTy 추가 검증" 섹션 참고.

상태:

완료(조사 기록). 이 조사에서 확보한 법령 근거(주택공급에 관한
규칙 제21조제5항)가 P2-D4-B2-CONTINUE의 가격비교 구현 재개 및
사용자 최종 승인의 근거가 됐다. BLOCKED 기록은 히스토리 보존을
위해 삭제하지 않는다.

### PRESALE P2-D4-B2-CONTINUE — houseTy 정책 확정 + 가격비교 구현 완성

목적:

사용자가 P2-D4-B2-FIX의 판단 B(법령 근거+다수 소스 교차확인으로
조건부 사용 가능)를 승인해, 중단됐던 유사 전용면적 비교·가격차이
계산을 완성했다.

핵심:

src/lib/presale-house-type.ts(신규) — parsePresaleHouseType,
isSimilarExclusiveArea(±1㎡ inclusive), medianPrice 3개 helper를
런타임 전용으로 구현(DB houseTy/supplyArea 원본 불변, 신규 컬럼
없음). PresaleHouseTypeDetail 5,395건 전수 파싱 — 성공
5,395/5,395(100%), 실패 0건, exclusiveArea<supplyArea
5,395/5,395(100%, 법령 제21조제5항과 정합). GET
/api/presales/[id]/nearby-market을 houseTypes[] 중심 구조로
완성 — 각 주택형별 주변 아파트 중 ±1㎡ 이내 최근 거래 최대
3건+중앙값(recentMedianPrice)+가격차이(differenceAmount, 만원,
부호있는 객관적 숫자만)를 제공, 가치판단 필드 없음. 6→12→24개월
fallback 기준을 "아파트에 거래 존재"에서 "이 Presale 주택형 중
하나와라도 ±1㎡ 이내 비교가능 거래 존재"로 강화 — 강서구(847)
표본에서 종료시점이 6개월→24개월로 실제로 늘어남을 확인(요청
우려사항이 실제로 재현되고 강화 로직이 올바르게 대응). MOLIT
호출은 여전히 sggCd×월 단위(주택형 수 무관), 429 0건. 10개
Presale 실측 + 56개 comparison 자동 재계산 대조(median/
differenceAmount 오차 0, ±1㎡ 위반 0, 거래중복 0) + 10건 수동
검산 전부 일치. 같은 주택형이라도 노후단지(1992/2002년 준공)와
신축 분양 간 차액이 29,045만~72,000만원까지 벌어지는 사례를
실측해 "가치판단 금지" 원칙의 실증 근거로 문서화.

서비스 코드 변경:

있음. 신규 src/lib/presale-house-type.ts. 수정
src/app/api/presales/[id]/nearby-market/route.ts(houseTypes[]
구조로 재작성, 이전 STEP의 apartments[] 구조 대체).

DB 변경:

없음(read-only API, schema/migration 변경 없음). 행 수 전부
불변 재확인.

패키지 변경:

없음.

테스트 결과:

prisma validate 통과, migrate status "up to date", tsc --noEmit
오류 0, lint 오류 0(경고 5건 기존파일), build 성공. 기존
/api/presales, /api/presales/[id], nearby-apartments(B1) 전부
정상. 경계값(±1㎡ 정확히 포함) 단위테스트 통과.

최종 판단:

사용자가 아래 최종 승인 정책 17개 항목 전부를 승인했다. 상세는
docs/development/18-presale-nearby-market-api.md
"P2-D4-B2-CONTINUE" 및 "최종 승인 정책" 섹션 참고.

최종 승인 정책(2026-08-13, 요약 — 전문은 문서18 참고):
houseTy 숫자부=비교용 전용면적 정책 승인(법령 제21조제5항+실측+
5,395건 전수 정합성 근거, API 직접정의 없다는 한계는 문서에 유지),
supplyArea는 면적비교에 미사용, ±1㎡ 유지, aptSeq 정확 일치만
사용(단지명 매칭 금지), 6→12→24개월 fallback을 "±1㎡ 비교가능
거래 존재" 기준으로 유지, 최근 3건+중앙값+differenceAmount(만원,
가치판단 문구 없음) 유지, differenceRate 계속 제외, 대형평형 낮은
coverage와 공고 PDF 30개 직접대조 미완료는 데이터 한계로 문서
유지, topAmount null/parser 실패 경로는 코드 검토 결과로 승인.

상태:

완료(사용자 최종 승인, 2026-08-13). P2-D4-B2(조사→BLOCKER→
P2-D4-B2-FIX→P2-D4-B2-CONTINUE) 전체가 이 시점부로 완료 처리된다.

## 2026-08-14

### PRESALE P2-D4-B3 — 주변 아파트 실거래 비교 UI

목적:

B1(주변 ApartmentMaster 검색)·B2(실거래 연결·가격비교) API가
이미 완료해둔 데이터를 분양 상세페이지(`/presales/[id]`)에
실제로 노출하는 UI 구현 STEP. B1/B2의 API 응답 구조·계산 정책은
전혀 변경하지 않았다(읽기 전용 소비).

핵심:

신규 `src/app/presales/[id]/nearby-market-section.tsx` — 위치정보
섹션과 청약홈 CTA 사이에 삽입. 주택형을 exclusiveArea 오름차순
chip(한 줄 고정, 가로 스크롤)으로 노출하고 비교 가능한 실거래가
있는 첫 주택형을 자동 선택. 선택된 주택형의 최고 분양가와
"비슷한 전용면적 X~Y㎡" 범위를 표시. 주변단지는 거리순/신축순
토글(클라이언트 전용 재정렬, API 재호출 없음)로 정렬하고 3개
기본노출+더보기(실제 남은 개수 동적 표시)로 노출. 각 카드는 최근
거래 1건 기본노출 + "최근 N건 보기" 확장(카드 내부, 페이지 이동
없음), 최근 거래 중앙값에 `monthsSearched`(API가 이미 제공하는
6/12/24 실측값)를 그대로 표시, `differenceAmount`(B2 계산값)를
부호 있는 숫자로만(+3억900만원/-4,500만원) 표시하고 색상·화살표·
가치판단 문구는 전혀 사용하지 않음(양수/음수 모두 기본 텍스트
색상 고정). 선택 상태는 기존 `--primary-color`(#03c75a) 그린을
재사용(신규 색상 도입 없음, `src/components/AreaSelector.tsx`의
기존 chip 배색 규칙과 동일). info(ⓘ) 버튼으로 안내문구 토글.
좌표 없는 Presale은 chip/카드 없이 "정확한 위치정보가 없어 주변
단지를 비교할 수 없습니다."만 표시. API 오류 시 재시도 버튼(SWR
`mutate()`). 전부 `<button>` + `aria-pressed`/`aria-expanded`/
`aria-label` 사용.

10개 Presale 실측(문서17/18과 동일 표본, 좌표 있음 8·없음 2) —
84m² A 주택형의 differenceAmount 4건이 문서18 "수동 검산" 표와
정확히 일치 확인(+3억900만원 등), 지역경계 사례(id=801)의 음수
차액(-2억3,100만원)이 색상 없이 정상 표시, adaptive radius 확장
사례(id=847)·6개월 종료 사례(id=755, monthsSearched:6 실측)·
comparisons 0건 사례(id=630) 전부 확인. chip/정렬 전환 시 네트워크
요청 0건(Chrome DevTools로 확인) — API 재호출 없음 요구사항 충족.

서비스 코드 변경:

있음. 신규 `src/app/presales/[id]/nearby-market-section.tsx`.
수정 `src/app/presales/[id]/presale-detail-client.tsx`(import
1줄+섹션 삽입 1곳), `src/app/presales/[id]/page.module.css`(B3
전용 클래스 추가, 기존 클래스 변경 없음). B1/B2 API 코드
(`nearby-apartments`, `nearby-market` route, `nearby-apartments.ts`,
`presale-house-type.ts`) 전혀 수정하지 않음.

DB 변경:

없음(read-only 소비, schema/migration 변경 없음).

패키지 변경:

없음.

테스트 결과:

prisma validate 통과, migrate status "up to date", tsc --noEmit
오류 0, lint 오류 0(경고 5건 전부 이번 변경과 무관한 기존 파일),
build 성공. 기존 `/api/presales`, `/api/presales/[id]`,
nearby-apartments(B1), nearby-market(B2), `/presales`(목록) 전부
정상(회귀 없음). 모바일 뷰포트(360/375/390px)는 브라우저 자동화
도구의 창 크기 조절 기능이 이 환경에서 동작하지 않아(재현 확인)
실제 컨테이너 폭을 375/360px로 강제한 근사 검증으로 대체했다 —
완전한 뷰포트 에뮬레이션은 도구 제약으로 미확인. API 오류 상태와
`presaleTopAmount` null 경로는 실데이터에 사례가 없어(DB 전수
확인) 코드 검토로만 확인했다. 상세는
docs/development/19-presale-nearby-market-ui.md 참고.

최종 판단:

구현 완료, 모바일 실기기 검수중. commit/push 하지 않았다.
B4(지도)·M4-C·재개발·커뮤니티·전국 확장·SEO로 진행하지 않았다.

상태:

완료 / 사용자 최종 승인(2026-08-14). B3-FIX(문서22, commit `398d33a`)
반영 후 사용자 모바일 최종 검수 완료. 상세는
docs/development/19-presale-nearby-market-ui.md §0 참고.


## 2026-08-14

### INFRA I1 — Vercel + Supabase + Prisma Production DB 연결 안정성 조사

작업:

B3(a2272d0) 모바일 검수 중 production `/presales`에서 1회 관측된
"분양정보를 불러오지 못했습니다." 오류에 대한 조사 전용 STEP. 코드/설정/
schema/env/DB 변경 없이, 기술스택·환경변수 구조(host/port/parameter만,
비밀값 제외)·Supabase/Prisma 공식 문서·Vercel function region·API별 DB
접근 패턴·B3 diff 재검토·production 반복 측정(19회, 실패 0)·오류 코드
경로·observability·connection pool 위험도를 조사했다.

주요 발견:

DATABASE_URL이 Supavisor **Session Pooler**(`aws-0-ap-northeast-2.pooler.supabase.com:5432`)를
사용 중이며, `DIRECT_URL` 분리·`pgbouncer=true`·`connection_limit`·
`pool_timeout` 전부 미설정. Supabase/Prisma 공식 문서는 서버리스(Vercel)
환경에는 **Transaction Pooler(6543)** + `directUrl` 분리를 명시적으로
권장 — 현재 구조와 공식 권장 구조 사이에 확인된 편차. 또한 Vercel function
region(iad1, 미국 동부)과 Supabase DB region(ap-northeast-2, 서울)이
cross-region임을 실측 확인(19회 요청 전부 `X-Vercel-Id`에 `iad1` 고정).
presales 4개 API 모두 기존 `logServerError`/`ErrorLog` 헬퍼에 연결되어
있지 않아, 이번 오류가 DB(admin 대시보드)에도 기록되지 않았음을 확인.
B3(a2272d0)는 `/presales` 목록 API를 전혀 건드리지 않았으므로 이번 목록
오류와 직접적 인과관계는 낮다고 판단(단, 상세페이지 connection pressure를
소폭 늘렸을 가능성은 있음). production 반복 측정(GET ×19)은 전부 200
성공 — 오류 재현 실패.

서비스 코드 변경:

없음(조사 전용, 지시에 따라 일절 금지).

DB 변경:

없음.

환경변수/설정 변경:

없음.

테스트 결과:

production GET 반복 측정 — `/api/presales` 8회, `/api/presales/479` 6회,
`/api/presales/479/nearby-apartments` 4회, `/api/presales/479/nearby-market`
1회, 총 19회 전부 HTTP 200 · `success:true` 정상 JSON. 실패 0건, 오류
재현 안 됨.

최종 판단:

B(구조적 위험은 확인되었으나 로그 없이 실제 오류 원인을 확정할 수 없어
안전한 최소 개선 + 관찰이 적절함). 상세는
docs/development/20-infra-db-connection-analysis.md 참고. commit/push
하지 않았다. INFRA I2·B3 수정·B4·M4-C·재개발·커뮤니티·전국 확장·SEO로
진행하지 않았다.

상태:

조사 완료 / 최종 승인(2026-08-14). 사용자 검수 결과 최종 판단(B) 그대로
승인됨 — DB 연결 구조는 지금 변경하지 않고 INFRA I2-A(관측성 보강)를
먼저 진행.


## 2026-08-14

### INFRA I2-A — Production DB 오류 관측성(logging) 최소 보강

작업:

INFRA I1 최종 판단(B) 승인에 따라, DB 연결 구조(DATABASE_URL/DIRECT_URL/
Supabase Pooler/Vercel region 등)는 전혀 변경하지 않고 "다음에 같은
오류가 나면 원인을 확인할 수 있도록" 최소 서버 오류 logging만 보강했다.
기존 `src/lib/log-server-error.ts`의 `logServerError` 헬퍼와 `ErrorLog`
Prisma model을 그대로 재사용(새 logging framework 도입 없음). 여기에
Prisma 오류를 connection 오류(`PrismaClientInitializationError`)와 query
오류(`PrismaClientKnownRequestError`, code 포함)로 최소 분류하는
`buildErrorLogMessage()` 헬퍼만 추가했다. `/api/presales`,
`/api/presales/[id]`, `/api/presales/[id]/nearby-apartments`,
`/api/presales/[id]/nearby-market` 4개 catch 블록에 기존 3곳(`ai-search`,
`apt/[name]`, `cheongyakService`)과 동일한 호출 패턴(`await` 없는
fire-and-forget + `.catch(() => {})`)으로 연결했다. nearby-market은 MOLIT
외부 API 개별 호출이 이미 각각 `.catch(() => [])`로 흡수되어 outer
catch까지 올라오지 않음을 코드로 확인한 뒤 적용해, DB 오류와 외부 API
오류가 섞이지 않는다. client 응답 계약(`success:false` + 500, 동일 메시지
문자열)은 전혀 변경하지 않았다.

민감정보 보호:

DATABASE_URL/비밀번호/API key/Authorization/Cookie/개인정보/request
body는 애초에 참조하지 않으며, Prisma init 오류 메시지에 connection
string이 우연히 섞이는 경우를 대비해 `postgres(ql)://...` 패턴을
`[redacted-connection-string]`로 마스킹하는 방어 로직을 추가했다(synthetic
테스트로 마스킹 동작 확인).

서비스 코드 변경:

있음(logging 전용, 최소). 수정 `src/lib/log-server-error.ts`(분류/메시지
헬퍼 추가, 기존 `logServerError` signature/동작 변경 없음),
`src/app/api/presales/route.ts`,
`src/app/api/presales/[id]/route.ts`,
`src/app/api/presales/[id]/nearby-apartments/route.ts`,
`src/app/api/presales/[id]/nearby-market/route.ts`(각 catch 블록에
logging 호출 1~2줄 추가). DB 연결 구조·schema·migration·Vercel/Supabase
설정·package는 전혀 건드리지 않았다.

DB 변경:

없음. `error_logs` row 수 0건으로 작업 전후 동일(`prisma.errorLog.count()`
로 확인).

테스트 결과:

로컬 dev 서버에서 4개 API 정상 경로 전부 기존과 동일한 200/`success:true`
응답 확인. 오류 경로는 unit test 인프라가 없어 synthetic
`PrismaClientKnownRequestError`(P2024)/`PrismaClientInitializationError`
(P1001, connection string 포함 메시지)/일반 `TypeError`/non-Error throw
4가지 케이스로 `buildErrorLogMessage()` 로직을 직접 검증(코드 로직은
실제 프로젝트 코드와 동일, 검증 스크립트는 실행 후 삭제해 레포에 흔적
없음) — Prisma code 추출과 connection string 마스킹 정상 확인. 실제
DB 연결 장애 상황의 live 검증은 하지 않았다(금지 사항이라 의도적으로
생략, 문서에 한계로 명시). `prisma validate` 통과, `migrate status`
"up to date", `tsc --noEmit` 오류 0, lint 오류 0, `npm run build` 성공
(전체 라우트 목록에 presales 4개 API 정상 포함, 회귀 없음). production
`GET /api/presales` 3회 재확인 — 전부 200(코드는 로컬에만 존재, production
은 여전히 a2272d0 상태이므로 이번 변경과 무관하게 현재 정상 상태만 재확인).

최종 판단:

A(관측성 보강 완료, 기존 기능 무손상, 검수 후 commit/push 가능). 상세는
docs/development/21-infra-error-observability.md 참고. INFRA I2-B
(region/pooler 변경)·B3 추가 수정·B4·M4-C·재개발·커뮤니티·전국 확장·
SEO로 진행하지 않았다.

상태:

구현 완료 / 최종 승인(2026-08-14). 사용자 검수 결과 최종 판단(A) 승인,
commit/push 진행. 실제 과거 production 장애 원인은 여전히 미확정 —
이번 STEP은 오류 해결이 아니라 관측성 보강이며, 재발 시 이번에 추가한
logging을 먼저 확인한 뒤 INFRA I2-B 필요 여부를 판단한다.


## 2026-08-14

### PRESALE P2-D4-B3-FIX — 주변 아파트 비교 주택형 표시 일관성 수정

작업:

모바일 실기기 검수에서 B3("주변 아파트 실거래 비교") chip이 기존
"주택형·분양가" 섹션과 다른 숫자를 보여주는 문제가 발견됐다(예:
"e편한세상 송도 더퍼스트비치" 79.48㎡ B ↔ B3 chip 60㎡ B). 코드 확인
결과 원인은 두 표시가 애초에 다른 필드였다 — 기존 UI는
`supplyArea`(공급면적) 기반, B3 chip은 `exclusiveArea`(houseTy 숫자부,
P2-D4-B2에서 실거래 비교 계산 전용으로 승인된 파생값) 기반이었다.
`nearby-market` API가 `supplyArea`를 아예 조회하지 않고 있던 게 근본
원인 — additive로 `supplyArea` 필드를 추가하고, chip/선택 제목 표시를
기존 상세 UI와 동일한 알고리즘(같은 반올림·같은 suffix 정규식)으로
전환했다. `exclusiveArea`는 "비교 전용면적 약 OO㎡" 보조 문구로만
남겼다. 연결은 기존과 동일하게 `houseTypeDetailId`(PresaleHouseTypeDetail
실제 PK)로 이뤄지며 배열 index 매칭은 어디에도 없다.

주요 발견:

id=479(e편한세상 송도 더퍼스트비치)의 실제 12개 주택형 전부와, 추가로
7개 공고(주택형 많은 공고·suffix 없는 공고·유사면적 여러 suffix·
comparisons 없는 타입·6개월/24개월 사례 포함, 총 88개 주택형)를
`houseTypeDetailId` 기준 교차검증해 오연결 0건을 확인했다. FIX 전/후
`nearby-market` 응답을 `supplyArea` 필드만 제외하고 비교한 결과
byte-identical — B2의 houseTy parser/±1㎡/aptSeq/6→12→24개월 fallback/
median/differenceAmount 계산이 전혀 변경되지 않았음을 실측으로 증명했다.
브라우저로 직접 확인한 결과 목표 UI 예시("79.48㎡ B" / "비교 전용면적
약 59.63㎡" / "비슷한 전용면적 58.63㎡ ~ 60.63㎡")와 실제 결과가 정확히
일치했다.

서비스 코드 변경:

있음(표시 전용, 최소). 수정
`src/app/api/presales/[id]/nearby-market/route.ts`(select에 `supplyArea`
추가, `buildHouseTypes()` 반환값에 `supplyArea` additive 필드 추가 — 기존
필드 breaking change 없음),
`src/app/presales/[id]/nearby-market-section.tsx`(chip/제목 라벨을
`supplyArea` 기반으로 전환, "비교 전용면적" 보조 문구 추가, 미사용
`formatAreaWhole` 제거). `presale-detail-client.tsx`(기존 주택형·분양가
UI)와 `page.module.css`(chip CSS)는 한 줄도 수정하지 않았다. B1 API,
B2 계산 정책(`presale-house-type.ts`) 전혀 수정하지 않았다.

같은 미커밋 작업 위에서 추가로, "최근 거래 중앙값"이라는 통계 용어를
일반 사용자가 이해하기 쉽도록 표시 문구만 수정했다 — 카드 라벨을
"최근 거래 대표가격"으로, 보조 문구를 "최근 N개월 · 최대 3건 기준"으로
바꾸고, ⓘ 안내문에 3건/2건/1건일 때의 계산 방식 설명을 추가했다.
`recentMedianPrice` 필드명·median 계산 로직·API는 전혀 변경하지 않았다.

DB 변경:

없음(schema/migration 변경 없음, 전부 read-only 조회로 검증).

테스트 결과:

`prisma validate` 통과, `migrate status` up to date, `tsc --noEmit`
오류 0, lint 오류 0, `npm run build` 성공. 로컬 dev 서버에서 4개 API
전부 200 확인. 브라우저 자동화 도구의 실제 리사이즈 제약(문서 19번과
동일 — 이 환경에서 360/375/390px 강제 리사이즈가 동작하지 않음)으로
정확한 모바일 뷰포트 스크린샷은 확보하지 못했으나, chip CSS(`nowrap`+
`overflow-x: auto`)를 전혀 수정하지 않았고 데스크톱 폭 스크린샷에서
길어진 라벨도 줄바꿈 없이 정상 렌더링됨을 확인했다. 상세는
docs/development/22-presale-nearby-market-ui-fix.md 참고.

최종 판단:

A(주택형 표시 일관성 FIX 완료, B3 계산/기능 무손상, 모바일 재검수
가능). commit/push 하지 않았다. 사용자 모바일 재검수 전까지 B3를 최종
완료 처리하지 않는다. B4·INFRA I2-B·M4-C·재개발·커뮤니티·전국 확장·
SEO로 진행하지 않았다.

상태:

완료 / 사용자 최종 승인(2026-08-14). production 배포(commit `398d33a`)
후 `supplyArea` 필드 실측 확인, 사용자 모바일 최종 검수 완료로 P2-D4-B3
및 B3-FIX 모두 최종 승인 확정.


## 2026-08-14

### PRESALE P2-D4-B4-A — 분양 상세 지도 기능 조사/설계

작업:

`/presales/[id]`에 "분양단지 1개+주변 비교 아파트 최대 5개" 지도를
넣을 가치가 있는지 조사/설계 전용으로 검토했다(코드/DB/schema/package
변경 없음, commit/push 없음). 기존 지도 코드 3개(`/map/page.tsx`,
`MapViewer.tsx`, `KakaoMapEmbed.tsx`)를 전수 확인하고,
`nearby-market`/`nearby-apartments` production API를 실제로 curl
호출해 지도에 필요한 데이터가 이미 있는지, 부족하면 무엇이 필요한지
실측했다.

주요 발견:

`MapViewer.tsx`는 어디서도 import되지 않는 미사용 코드이며, 설령
가져다 써도 Kakao SDK 스크립트를 자체 로드하지 않아(`/presales/[id]`엔
스크립트 로더가 아예 없음) 그대로는 동작하지 않음을 코드로 확인했다.
`/map/page.tsx`는 풀스크린+6개 레이어+자체 클러스터링까지 결합된 대형
페이지라 그대로 재사용하기엔 과하고, `KakaoMapEmbed.tsx`는 주소
지오코딩 방식이라 이미 확보된 좌표를 바로 쓰는 용도와 맞지 않는다.
다만 `react-kakao-maps-sdk`(이미 설치됨)의 `Map`+`CustomOverlayMap`
조합과 `kakao-map-script-main` 공유 스크립트 로딩 관례(2곳에서 이미
검증됨), `--primary-color` 강조/neutral 색상 조합은 재사용 가능한
core로 확인됐다 — 최종 판단 B(재사용 가능한 core + 최소 신규 wrapper
필요). 데이터 측면에서는 `nearby-market`(B2)의 `comparisons[]`가
"비교 가능한 거래가 있는 아파트만" 포함해(id=801/847 실측: B1 기준
후보 5개 중 실제로는 1개만 노출) 지도 마커 용도로는 부족하고,
`nearby-apartments`(B1)는 5개 후보 전부의 좌표를 안정적으로 반환함을
실측으로 확인했다 — "위치는 B1, 가격은 B2"로 소스를 분리하거나,
`nearby-market`에 좌표 배열을 additive로 노출하는 두 가지 신규-API-
없는 경로를 후보로 제시했다.

서비스 코드 변경:

없음(조사/설계 전용). production UI 구현, API 변경, DB 변경 전혀 없음.

DB 변경:

없음(read-only 조회만 수행 — production API curl + 부산 Presale/
ApartmentMaster 반경 분포 read-only 쿼리, 임시 스크립트는 실행 후
삭제).

테스트 결과:

요청된 5개 표본(479/755/801/847/630) 전부 production API로 실측
확인(밀집지역·3km 확장 사례·지역경계 사례 포함), 추가로 좌표 없는
Presale(173/164, `locationAvailable:false` 확인)과 "주변단지 1~2개"
대체 표본으로 후보 0개 사례(47/732)를 read-only 쿼리로 새로 찾아
확인했다. 부산 ApartmentMaster 3km 반경 분포가 "0개 아니면 13개 이상"
으로 이분화돼 있어 정확한 1~2개 사례는 찾지 못했음을 한계로 기록했다.

최종 판단:

B(지도 기능 가치 있음. 기존 MapViewer 재사용보다 최소 신규 wrapper
필요). 상세는 docs/development/23-presale-map-design.md 참고.
commit/push 하지 않았다. B4 구현·INFRA I2-B·M4-C·재개발·커뮤니티·
전국 확장·SEO로 진행하지 않았다.

상태:

조사/설계 완료(2026-08-14). 사용자 승인 후 P2-D4-B4로 실제 구현
착수(같은 날, 문서24 참고).


## 2026-08-14

### PRESALE P2-D4-B4 — 분양 상세 "위치와 주변 단지" 지도 UI 구현

작업:

승인된 B4-A V1 최소 범위(문서23 §23)를 그대로 구현했다. 분양단지
1개+주변 아파트 최대 5개 marker, bounds fit, marker 클릭 시 최소
정보(단지명/거리/준공연도, 있으면 대표가격), 카카오맵 크게 보기,
모바일 260px 고정 높이, IntersectionObserver 기반 lazy load, 섹션
단위 실패 fallback을 구현했다. 신규 API 호출 없이 B3가 이미 호출
중인 `nearby-market` 응답 1회를 그대로 공유한다 — fetch를
`presale-detail-client.tsx`(부모)로 끌어올려 B3/B4가 props로 데이터를
나눠 받도록 구조를 바꿨다(계산 로직은 무변경).

주요 발견 및 수정:

`nearby-market`의 `houseTypes[].comparisons`는 "선택 주택형과 실거래
비교 가능한 아파트만" 담아 지도 marker 용도로는 부족함을 실측으로
재확인(id=801/847: B1 기준 5개 후보인데 comparisons엔 각 1개만
노출) — `findNearbyApartments()`가 이미 계산한 값을 그대로 노출하는
`nearbyApartments` additive 필드를 API 응답에 추가해 해결(새 검색
로직 없음). 구현 중 실제 브라우저 클릭 테스트로 버그 2건을 발견해
수정했다: (1) marker 클릭 시 지도의 빈 곳 클릭 핸들러가 함께 발동해
선택이 즉시 풀리는 문제(`stopPropagation()`으로 해결), (2) popup이
Kakao 지도 내부 레이어에 가려 안 보이는 문제(`z-index: 30` 명시로
해결) — 둘 다 코드 검토만으로는 발견되지 않았을 문제로, 실제 클릭
후 재현·수정·재확인했다.

서비스 코드 변경:

있음. 신규 `src/app/presales/[id]/presale-nearby-map.tsx`(B4 지도
컴포넌트). 수정
`src/app/api/presales/[id]/nearby-market/route.ts`(additive
`nearbyApartments` 필드),
`src/app/presales/[id]/nearby-market-section.tsx`(B3, 자체 useSWR/
selectedId state를 props로 전환 — 계산/표시 로직 자체는 무변경),
`src/app/presales/[id]/presale-detail-client.tsx`(nearby-market fetch
+ selectedHouseTypeId를 부모로 이동, 지도 섹션 삽입),
`src/app/presales/[id]/page.module.css`(지도 전용 클래스 추가, 기존
클래스 변경 없음). `src/components/MapViewer.tsx`는 미사용 상태로
그대로 두었다(수정도 삭제도 하지 않음). B1 API, B2 계산 정책
(`presale-house-type.ts`, `nearby-apartments.ts`) 전혀 수정하지
않았다.

DB 변경:

없음. read-only row count 재확인: ApartmentMaster 3,402 / Apartment
20 / Property 0 / Presale 1,046 / PresaleHouseTypeDetail 5,395 —
전부 기존과 일치.

테스트 결과:

로컬 dev 서버 + 실제 브라우저(Chrome DevTools Network 탭 포함)로
검증. `nearby-market` 네트워크 요청이 실측으로 정확히 1건임을
확인(추측 아님). lazy load 실측: 스크롤 전 Kakao SDK 요청 0건, 지도
섹션 접근 후 1건. 실데이터 6개 표본(id=479 밀집·755 6개월·**801
지역경계(5marker 전부 표시 핵심 검증)**·847 3km 확장·173 좌표없음·47
주변단지 0개) 전부 브라우저로 직접 확인. 주택형 chip 전환 시 지도
marker 목록이 불변임을(가격만 갱신) DOM 직접 비교로 확인. `prisma
validate` 통과, `migrate status` up to date, `tsc --noEmit` 오류 0,
lint 오류 0(기존 무관 경고 5건), `npm run build` 성공. API 회귀:
`/api/presales`/`/api/presales/[id]`/B1/B2 전부 200, B2 기존 필드
전부 유지 + `nearbyApartments`만 추가, `recentMedianPrice`/
`differenceAmount` 값 기존과 동일. 상세는
docs/development/24-presale-nearby-map-ui.md 참고.

최종 판단:

A(구현 완료, 기존 기능 무손상, 모바일 검수 가능). 360/375/390px 정확한
뷰포트 검증과 지도 drag/페이지 스크롤 제스처 충돌 여부는 도구 제약으로
확인하지 못해 사용자 실기기 검수가 필요하다. commit/push 하지 않았다.
INFRA I2-B·M4-C·재개발·커뮤니티·전국 확장·SEO·B4 후속 고도화(marker↔
카드 연동 등)로 진행하지 않았다.

상태:

구현 완료 / 모바일 검수중(2026-08-14). B3 카드 세로밀도 개선 후
사용자 최종 승인(같은 날, 아래 항목 참고).


## 2026-08-14

### PRESALE P2-D4-B4 FINAL — B3 카드 세로밀도 개선 + B4 최종 승인

작업:

사용자가 production(commit `d362a10`)에서 B4를 모바일로 검수했다.
지도(위치/260px/marker/흐름/외부 링크)는 그대로 승인했고, B3 카드의
최근 거래→최근 거래 대표가격→분양 최고가와 차이 사이 수직 여백이
누적돼 카드가 필요 이상으로 길다는 피드백만 받아, 정보/기능/계산
삭제 없이 `page.module.css`의 spacing 값만 최소 조정했다(JSX 무변경).
`.aptCard` padding(좌우 유지, 상하만 축소)·margin-bottom, `.aptName`/
`.aptMeta`/`.cardStatBlock` margin-bottom, `.expandBtn` padding,
`.txList` margin/gap/padding, `.moreBtn` margin/padding을 조정했다.

주요 발견:

id=479 첫 comparison 카드를 브라우저에서 실측(`getBoundingClientRect`,
임시 style override로 전/후 동일 페이지에서 직접 비교) — collapsed
304.17px→276.00px(약 9.3%↓), expanded 391.46px→352.10px(약 10.1%↓).
검증 도중 `nearby-market` network request가 2~4건으로 잘못 측정되는
사건이 있었으나, 원인을 끝까지 추적한 결과 실제 코드 회귀가 아니라
브라우저 자동화 절차에서 같은 URL로 `navigate`를 연속 2회 호출한
측정 실수였음을 규명했다(production 빌드(`npm run start`) + 새 탭 +
`navigate` 정확히 1회 절차로 재검증해 정확히 1건 재확인) — 추측으로
덮지 않고 원인을 규명한 뒤 기록했다.

서비스 코드 변경:

있음(spacing만). 수정 `src/app/presales/[id]/page.module.css`. API,
`nearby-market-section.tsx`(JSX), 지도 컴포넌트(`presale-nearby-map.tsx`),
B1/B2 계산 로직은 전혀 수정하지 않았다.

DB 변경:

없음(read-only row count 재확인: ApartmentMaster 3,402 / Apartment 20
/ Property 0 / Presale 1,046 / PresaleHouseTypeDetail 5,395 — 기존과
일치).

테스트 결과:

`prisma validate` 통과, `migrate status` up to date, `tsc --noEmit`
오류 0, lint 오류 0(기존 무관 경고 5건), `npm run build` 성공. 정보
삭제 없음/문구 무변경/font-size 무변경(가격 숫자 포함)을 스크린샷으로
확인. id=479(chip·지도·카드·collapsed/expanded·거리순/신축순)·
id=801(지역경계 지도·B3·differenceAmount 음수 정상)·id=847(3km bounds
fit·B3) 재검증 전부 정상. `nearby-market` 네트워크 요청 정확히
1건(production 모드 재검증), `nearby-apartments` 추가 호출 0건. 상세는
docs/development/24-presale-nearby-map-ui.md 참고.

최종 판단:

P2-D4-B4-A = 완료, P2-D4-B4 = 완료 / 사용자 최종 승인. B1/B2/B3/
B3-FIX/B4 전체 정책·기능 유지, DB/schema/migration 변경 없음.
INFRA I2-B·M4-C·재개발·커뮤니티·전국 확장·SEO·B4 후속 고도화로
진행하지 않았다.

상태:

P2-D4-B4-A 완료 / P2-D4-B4 완료·사용자 최종 승인(2026-08-14).


## 2026-08-14

### PROJECT ROADMAP R1 — 현재 구현 상태 전수점검

작업:

문서/코드 조사 전용(변경 없음, commit/push 없음). docs/development
전체 29개 파일, src/app 전체 route/page(33 API+20 page), Prisma 20개
model 사용 현황, 외부 데이터소스(MOLIT/Kakao/청약홈/Gemini), 아파트/
재개발/커뮤니티/MY/SEO 5개 영역을 병렬 조사 에이전트+직접 grep
교차검증으로 전수 확인했다. 상세는
docs/development/25-project-roadmap-audit.md 참고.

주요 발견:

`00-PROJECT-ROADMAP.md`(최초 로드맵)가 "STEP 2~15 = 대기"로 남아
있으나, 실제로는 M1~M4-B(아파트 마스터)·P1~P2-D4(분양)·INFRA I1/I2-A가
그 STEP 2 범위를 이미 상당 부분 진행했음에도 로드맵 문서가 갱신되지
않아 stale 상태임을 확인했다. Prisma model 20개 중 `Property`/
`RedevelopmentProject`/`Report`/`Transaction`/`TradeHistory`가
사실상 미사용(orphan)임을 grep으로 재확인. ErrorLog 연결이 분양
도메인에만 국한돼 학교/통계/커뮤니티/관리자 등 나머지 API는 여전히
console 의존임을 재확인. `/apt/[name]`·`/presales/[id]`가 sitemap에
누락된 SEO 공백을 발견. MY 페이지에 관심단지/찜 기능이 DB 필드 자체가
없어 완전 미착수임을 확인.

서비스 코드 변경:

없음(조사 전용).

DB 변경:

없음.

최종 판단:

다음 STEP 후보 3개(아파트 상세 재검토/커뮤니티 신고+수정 UI/ErrorLog
관측성 확장) 중 아파트 상세 재검토를 1순위로 추천. 사용자 승인 후
진행 여부 결정. commit/push 하지 않았다.

상태:

조사 완료 / 다음 STEP 결정 대기(2026-08-14).


## 2026-08-14

### APT DETAIL UI-A — 아파트 상세 현황 해부 / UI 재설계안 수립

작업:

조사·설계 전용(코드/CSS/API/DB/schema 변경 없음, commit/push 없음).
apt-client.tsx(820줄)·detail.module.css·연결 컴포넌트 13개·API
route 3개를 전량 직접 읽고, 프로덕션에서 실제 단지 3곳(거래 많음/
거래 적음·특수/정보량 많음, 부산)을 브라우저로 직접 클릭 검증했다.
상세는 docs/development/26-apartment-detail-ui-audit.md 참고.

주요 발견:

Header의 모바일 하단 탭바를 숨기는 hideMobileNav prop을
apt-client.tsx가 전달하지 않아, 페이지 자체 StickyPriceBar(z-index
500)와 Header 전역 하단바(z-index 1000)가 모바일에서 동시에
position:fixed; bottom:0으로 겹쳐 렌더됨을 코드 대조로 확인(이번
조사에서 가장 영향도 높은 발견). 그 외 실측으로 평형 칩 라벨 중복
(AreaSelector), 교통 탭 KTX 키워드 오탐(KakaoPlaces), 소규모
단지 브리핑 "거래 활발" 오판(buildAptBrief 임계값), 커뮤니티 시설
정보 사실상 전무(Apartment 캐시 20건 중 0건) 등 4건을 추가로
발견했다. B3-FIX 압축 spacing이 이 페이지에는 전혀 적용되지 않아
`.panel` 2rem 등 이전 세대 여백을 그대로 쓰고 있음을 확인.

서비스 코드 변경:

없음(조사·설계 전용).

DB 변경:

없음.

최종 판단:

상단 섹션 재설계안 3개(히어로 압축형/탭 전환형/가로 캐러셀형) 중
히어로 압축형을 권고. 후속 STEP을 APT-UI-B0(하단바 중복 해소,
최우선)~B4로 분할 제안. 사용자 확인 후 진행 여부 결정. commit/push
하지 않았다.

상태:

조사·설계 완료 / 사용자 확인 대기(2026-08-14).


## 2026-08-14

### APT DETAIL B0 — 모바일 하단 고정 UI 충돌 최소 수정

작업:

문서26(§4-B-7/§9)에서 발견된 Header 전역 하단탭바(z-index 1000,
bottom:0)와 StickyPriceBar(z-index 500, bottom:0)의 모바일 동시
겹침 문제를 최소 수정했다. 해결안 A(hideMobileNav 전달)/B(StickyPriceBar
offset)/C(StickyPriceBar fixed 해제) 3가지를 비교해 B를 선택했다 —
이 앱은 /map이 Header 없이도 동일한 5탭 하단바를 직접 재구현할 만큼
"전역 하단 내비게이션은 항상 노출"이 기존 원칙이라, 그 원칙을 유지하며
StickyPriceBar 기능도 그대로 보존하는 B가 A/C보다 서비스 UX상
자연스럽다고 판단했다. 상세는
docs/development/27-apartment-detail-b0-mobile-fixed-ui.md 참고.

수정 파일:

src/app/apt/[name]/detail.module.css 1개 파일만 수정(다른 production
파일 변경 없음). `.stickyBar`의 `bottom: 0`을 `bottom: 60px`(Header
하단탭바 높이와 동일)로 변경하고, 겹침 해소 과정에서 실측으로 추가
발견한 문제(`.main`의 기존 padding-bottom:80px이 새 결합 높이
128px보다 작아 4구역 콘텐츠가 가려짐)를 막기 위해 같은
`@media(max-width:768px)` 블록 안에 `.main { padding-bottom:
calc(60px + 5rem) }`를 추가했다. 두 변경 모두 기존 미디어쿼리 블록
범위 안에서만 이뤄져 데스크톱에는 영향이 없다.

검증:

브라우저 자동화 창이 1536px 고정이라 실제 360/375/390px 스크린샷은
얻지 못해(문서26과 동일한 환경 제약), 로컬 프로덕션 빌드에서 실제
컴파일된 CSS 클래스에 @media(max-width:768px) 블록의 실제 속성값을
그대로 주입해 getBoundingClientRect()로 기하학 검증했다. 겹침 해소
(gap≈0px)·글쓰기 버튼 클릭 히트 영역 정상·4구역 콘텐츠 가림 해소
(여유 12.8px)·데스크톱 영향 없음(수정 전후 계산값 동일)을 확인.
tsc/lint/build 전부 통과, prisma validate/migrate status로 DB/schema
변경 없음 재확인. detail.module.css는 apt-client.tsx/StickyPriceBar.tsx
외 어디서도 import되지 않아(grep 재확인) 다른 화면 회귀 가능성이
구조적으로 없다고 판단했다.

서비스 코드 변경:

CSS 1개 파일, 2개 규칙(속성값 1개 변경 + 규칙 1개 추가), 기존
@media(max-width:768px) 블록 범위 내.

DB 변경:

없음.

최종 판단:

B0 구현 완료. 문서26 §13이 전제한 "StickyPriceBar 현행 유지"를 그대로
보존해 B1(상단 Hero 재설계) 진행에 필요한 전제를 바꾸지 않는다. A안
(hideMobileNav)이 장기적으로 나을 가능성은 남겨두되 이번엔 최소
수정만 했다. commit/push 하지 않았다. 사용자 검수 후 B1 진행 여부
결정.

상태:

APT DETAIL B0 구현 완료 / 검수중(2026-08-14).


## 2026-08-14

### APT DETAIL B0.5 — "건축물대장" 기능 정밀검수 (조사 전용, STOP 발동)

작업:

B1(상단 Hero 리뉴얼)에서 건축물대장 퀵버튼을 유지할지 결정하기 전에,
코드 전수 검색 + 실데이터 5표본(부산, 대단지/소규모/오래된단지/
신축단지/특수케이스) + 실API 호출(curl 4건 + 브라우저 실클릭 1건)로
기능을 정밀검수했다. 상세는
docs/development/28-apartment-building-ledger-audit.md 참고.

주요 발견(STOP 조건 발동):

이 기능이 호출하는 외부 API(data.go.kr BldRgstHubService)가
mgmBldrgstPk(건축물 고유번호)를 22자리 따옴표 없는 JSON 숫자로
내려주는데, 이를 표준 JSON.parse로 받는 순간 IEEE754 double
정밀도 한계(2^53)를 넘어 값이 손상됨을 실제 프로덕션에서 재현
확인했다. 대신해모로센트럴(2022년 준공) 등 신축 단지에서 실제로
받는 값은 `1.0000000000000028e+21` — 그 단지 16개 동 전부가
서로 다른 실제 값을 갖고 있음에도 JSON.parse 이후 전부 동일한
손상값으로 뭉개진다. 다운로드되는 문서(실제 서류처럼 보이는 HTML)의
"고유번호" 필드가 명백히 틀린 값을 인쇄한다. 오래된 단지(2001년
등)는 PK 자릿수가 짧아 이 문제가 없음을 확인 — 신축 단지일수록
영향받는 패턴임을 확인했다. 그 외 jibun 미확보 시 단지 간 오매칭
가능성(재현 완료), 존재하지 않는 동 입력 시 조용한 동 대체(재현
완료), 외부 API 호출 timeout 부재, ErrorLog 미연결, AptSpecGrid와
필드 중복도 함께 발견했다.

지침에 따라 이 BLOCKER를 수정하지 않고 그대로 보고만 했다.

서비스 코드 변경:

없음(조사·검증 전용, STOP 조건에 따라 수정 금지).

DB 변경:

없음.

최종 판단:

건축물대장 기능의 사용자 가치를 D(오매칭/기능오류로 현재 노출
부적절)로 평가. B1(상단 Hero 리뉴얼)에서는 이 버튼을 제외하고,
별도 버그수정 STEP(정밀도 손상·오매칭·timeout·ErrorLog 연결)을
먼저 거친 뒤 재노출 여부를 검토할 것을 추천한다. commit/push
하지 않았다. 최종 유지/수정 여부는 사용자 검수 후 B1 구현 전에
결정한다.

상태:

APT DETAIL B0.5 건축물대장 기능 검수 완료 / 검수중(2026-08-14).


## 2026-08-14

### APT DETAIL B1 — 상단 Hero UI 리뉴얼 구현

작업:

문서26 §14에서 사용자가 승인한 A안(히어로 압축형)을 실제 구현했다.
`/apt/[name]` 상단 1구역을 "Hero(단지명·지역·준공/세대수 요약+공유)
→ 가격 핵심(매매/전세 토글+가격+메타+최고최저) → 평형 선택 →
시세 추이 차트 → 핵심 가격 지표 → 단지 스펙 그리드" 순으로
재배치했다. 상세는 docs/development/29-apartment-detail-b1-hero-ui.md
참고.

수정 파일 3개:

- src/app/apt/[name]/apt-client.tsx — Header 호출에서 hideLogo/
  pageTitle 제거(로고+로그인 유지, 단지명은 Hero로 이동), Hero/가격
  블록 신설, AreaSelector를 실거래 타임라인 상단에서 가격 블록
  직후로 재배치, AptSpecGrid를 삭제 없이 핵심 가격 지표 다음으로
  이동(address는 Hero와 중복 방지 위해 빈 값 전달), 건축물대장
  퀵버튼만 제거(API/모달 case/state는 보존), 공유 버튼을 Hero로
  이동. 매매/전세 토글 로직은 무변경, 시각만 AreaSelector와 동일한
  초록 선택 언어로 통일.
- src/components/KakaoShareButton.tsx — 선택적 compact prop 추가
  (공유 로직 handleShare는 완전히 동일, Hero에 어울리는 작은
  중립색 버튼 표현만 추가). 이 컴포넌트는 apt-client.tsx에서만
  쓰여 다른 화면에 영향 없음을 grep으로 재확인.
- src/app/apt/[name]/detail.module.css — Hero용 클래스(.heroTop/
  .heroTitle/.heroAddress/.heroMeta/.priceBlock) 추가. B0에서 수정한
  .stickyBar(bottom:60px)/.main(padding-bottom 보정)은 그대로 유지.

검증:

로컬 프로덕션 빌드에서 부산 3개 표본(대단지·신축/소규모·거래적음/
정보량 많음)으로 실클릭 검증 — 단지명/지역/준공·세대수(동수는
데이터 없어 생략, 가짜값 미생성)/가격/평형칩/차트/최고최저/공유
전부 정상. 매매/전세 토글 실클릭 시 가격·라벨·최고최저 정상 전환
확인. StickyPriceBar+Header 하단탭바 겹침 여부를 B0와 동일 기법
(실제 CSS 속성값 주입 후 getBoundingClientRect)으로 재검증해 여전히
겹치지 않음을 확인(B1이 B0 수정을 되돌리지 않음). 지도 모달은
로컬(비등록 도메인)에서 카카오 스크립트 로드 실패가 떴으나, 이
코드는 이번 STEP에서 건드리지 않았고 동일 단지를 실제 프로덕션
도메인에서 열어 정상 렌더됨을 대조 확인해 로컬 환경 한계로
판단했다. tsc/lint/build 전부 통과, prisma validate/migrate status로
DB/schema 무변경 재확인.

서비스 코드 변경:

3개 프론트엔드 파일(JSX 재배치+CSS 추가+공유버튼 선택적 prop).
API/DB/schema 변경 없음. 건축물대장 관련 코드(/api/ledger, modal
case, state)는 삭제하지 않고 그대로 보존.

DB 변경:

없음.

최종 판단:

B1 Hero 구현 완료, 기존 기능 무손상, STOP 조건 미발생. 사용자
실기기 모바일 검수 가능한 상태. commit/push 하지 않았다. 검수 통과
후 별도 승인을 받아 commit/push 진행.

상태:

APT DETAIL B1 구현 완료 / 검수중(2026-08-14).


## 2026-08-14

### STEP 30 — APT DETAIL B1-FIX: 면적 표기 체계 정리 + Hero 세로밀도 개선

작업:

STEP 29 실기기 검수 피드백(가격 영역 간격, `84(26평)`류 중복·모호 표기) 반영.
부산 5개 단지 실측(대신푸르지오1차/2차·대신롯데캐슬·대연힐스테이트푸르지오·
명륜아이파크1단지)에서 서로 다른 실제 전용면적(예: 84.36/84.38/84.69/84.92㎡)이
기존 절사+반올림 포맷 때문에 전부 `84(26평)`으로 겹쳐 보이는 문제를 확인. 상세는
docs/development/30-apartment-detail-b1-area-format-fix.md 참고.

수정 파일 6개:

- src/lib/area-utils.ts — 전면 교체. `getAreaInfo`/`getCompactAreaLabel`(절사+반올림,
  "공급 약 XX평형" 근사치 포함) 삭제, `formatExclusiveArea`(소수 2자리+trailing
  zero 제거)/`formatPyeong`(㎡/3.305785, 소수 1자리)/`getAreaDetailLabel` 신설.
  "공급 약 XX평형"은 실제 공급면적 데이터가 없는 임의 추정치였음을 확인해 완전히
  제거(분양 도메인의 진짜 supplyArea는 별개 테이블, 무관·무수정).
- src/components/AreaSelector.tsx / TradeTimelineList.tsx / FloorPlanPanel.tsx —
  새 함수로 import 교체만, 선택/필터 key(원본 area 문자열)는 무변경.
- src/lib/ai-search.ts — 동일 공유 함수를 쓰던 AI 검색 비교 카드 라벨도 같이
  교체(그룹핑/정렬 로직은 무변경).
- src/app/apt/[name]/apt-client.tsx — Hero 가격 영역을 "가격+면적" 한 줄 /
  "층·거래일" 한 줄의 2줄 구조로 재구성(사용자 요청), 거래타임라인 헤더 라벨
  교체, 가격 블록 내부 여백 축소(폰트 크기 무변경).
- src/app/apt/[name]/detail.module.css — `.priceBlock` margin/padding-top
  1.1rem → 0.95rem.

검증:

prisma validate/migrate status(schema 무변경 재확인)·tsc --noEmit·eslint(수정
파일 한정, 기존 경고 1건 외 에러 0)·next build 전부 통과. 로컬 프로덕션 dev
서버 + 실브라우저로 대신푸르지오1차(230건) 실클릭 검증 — 칩 4종이 이제 각각
정확한 소수점 ㎡로 구분 표시되고 "전체 평형" 드롭다운에서도 전부 구분됨을
확인, 칩 클릭 시 가격/타임라인/헤더 카운트 갱신과 면적 일치 재확인. 390px
근사 검증(창 리사이즈가 이 환경에서 미적용돼 iframe 임베드로 대체)에서 칩
한 줄 유지+가로 스크롤, Hero 2줄 구조 확인. 차트/투자지표는 area 표시 함수를
쓰지 않고 원본 문자열로만 그룹핑함을 코드로 재확인, 영향 없음.

발견한 기존 버그(이번 STEP에서 미수정, 문서 §9):

Hero의 층/거래일이 평형 필터와 무관하게 항상 전체 최신 거래 기준이라, 가격만
필터된 평형 기준이고 층/날짜는 다른 평형 값이 붙어나오는 불일치가 있음. STEP 29
이전부터 있던 기존 로직이라 "기존 필터 로직 보존" 지시에 따라 고치지 않고
문서에만 기록.

서비스 코드 변경:

6개 프론트엔드/유틸 파일. API/DB/schema 변경 없음.

DB 변경:

없음.

최종 판단:

면적 표기 통일 + Hero 밀도 개선 완료, 기존 평형 선택/필터/차트 연결 무손상,
STOP 조건 미발생. 사용자 모바일 검수 가능한 상태. commit/push 하지 않았다.
검수 통과 후 별도 승인을 받아 commit/push 진행.

상태:

APT DETAIL B1-FIX 구현 완료 / 검수중(2026-08-14).


## 2026-08-15

### STEP 31 — APT DETAIL B1-FIX2: 면적 라벨 충돌 + Hero 거래 일관성 최소 수정

작업:

STEP 30(B1-FIX)에서 발견된 후속 문제 2건만 최소 수정. (1) 기본 2자리 반올림 정책이
59.8826㎡/59.8839㎡처럼 서로 다른 값을 둘 다 "59.88㎡"로 겹치게 만드는 사례(대신
롯데캐슬 실측), (2) Hero의 층/거래일이 평형 필터와 무관하게 항상 전체 최신 거래를
참조해 가격(필터된 평형 기준)과 다른 거래의 값이 한 Hero 안에 섞이던 기존 버그.
상세는 docs/development/31-apartment-detail-b1-area-consistency-fix.md 참고.

수정 파일 6개:

- src/lib/area-utils.ts — `getUniqueAreaLabels()`(같은 목록 안에서 라벨이 겹치는
  값만 필요한 만큼 2→3→4자리로 정밀도를 올려 고유 라벨을 만듦, 상한 4자리는 부산
  5개 단지 1,800건+ 실측 기준) / `resolveAreaLabel()` 신설. `formatExclusiveArea`
  (단일값 2자리)와 목록 충돌 해소 책임을 분리. `getAreaDetailLabel()`은 라벨 맵을
  선택적으로 받도록 확장(하위 호환).
- src/app/apt/[name]/apt-client.tsx — `heroTrade`(= `latestPrice`가 이미 쓰던
  필터링 우선순위와 동일한 단일 거래 객체) 신설, Hero 면적/층/거래일을 전부 여기서만
  가져오도록 변경. `areaLabels` 맵을 이 단지의 전체 거래 기준으로 한 번 계산해
  AreaSelector/TradeTimelineList/FloorPlanPanel/Hero/거래타임라인 헤더 전부에 동일하게
  전달(페이지 전체가 같은 원본 면적에 항상 같은 라벨을 쓰도록).
- src/components/AreaSelector.tsx / TradeTimelineList.tsx / FloorPlanPanel.tsx —
  `areaLabels?` prop 추가, 자체 계산 대신 부모가 만든 맵을 조회만 하도록 변경(평형이
  이미 선택된 상태의 TradeTimelineList는 자기 prop만으론 충돌 판단 근거가 없어져
  칩과 다른 라벨을 낼 수 있었음 — 계산 지점을 부모로 통일해 해결).
- src/lib/ai-search.ts — 비교 카드의 `areaOptions`도 동일 성격의 "목록 안 라벨"이라
  같은 `getUniqueAreaLabels()`를 적용(그룹핑/정렬 로직은 무변경).

검증:

Node 스크립트로 알고리즘을 실측 원본값에 직접 실행 — 대신롯데캐슬 59.8826/59.8839
→ 59.883㎡/59.884㎡(스펙 예시와 정확히 일치), 대신푸르지오1차 84㎡대 4종은 2자리
그대로 유지(불필요한 확장 없음), 명륜아이파크1단지 84.9194/84.919는 3자리에서도
겹쳐 상한 4자리까지 확장. 명륜아이파크1단지 실브라우저(5년 필터)로 "84.919㎡(1건)"/
"84.9194㎡(32건)" 별도 표시, "84.99㎡"/"85㎡" 2자리 유지 재확인. Hero 일관성은
before/after 대조로 확인 — 대신푸르지오1차 "84.65㎡" 칩 선택 시 수정 전엔 가격만
84.65㎡ 기준이고 면적/층/날짜는 84.94㎡ 거래가 섞여 나왔으나, 수정 후 가격·면적·층·
날짜 전부 같은 거래(2026-07-22, 4층, 6억 3,200만)로 일치. 명륜아이파크1단지에서
데이터 1건뿐인 평형(84.919㎡), 매매/전월세 토글(62.64㎡) 각각 Hero↔타임라인 일치를
재확인. tsc/eslint(기존 무관 경고 1건 외 0)/prisma validate/migrate status/build
전부 통과.

발견한 한계(이번 STEP에서 미해결, 문서 기록):

선택한 평형에 현재 매매/전월세 타입 거래가 아예 없을 때 Hero가 전체 최신 거래로
fallback하며(기존 latestPrice의 fallback을 그대로 따름), 이 경우 화면상 선택 칩과
Hero 표시 면적이 달라 보일 수 있다. 이번 STEP이 요청받은 범위(한 Hero 안의 가격·
면적·층·날짜가 서로 같은 거래를 가리킬 것)는 충족하며, 이 fallback UX 자체의 개선
여부는 범위 밖으로 남겨둔다. 대신롯데캐슬은 재검증 시점에 API가 캐시된 빈 응답을
반환해 실브라우저 재확인은 하지 못했다(알고리즘 단위검증 + 동일 성격의 다른 단지
실측으로 대체).

서비스 코드 변경:

6개 프론트엔드/유틸 파일. API/DB/schema 변경 없음.

DB 변경:

없음.

최종 판단:

면적 라벨 충돌 해소 + Hero 거래 일관성 확보 완료, 기존 평형 선택/필터/차트 연결
무손상, STOP 조건 미발생. 사용자 모바일 검수 가능한 상태. commit/push 하지 않았다.
검수 통과 후 별도 승인을 받아 commit/push 진행.

상태:

APT DETAIL B1-FIX2 구현 완료 / 검수중(2026-08-15).


## 2026-08-15

### STEP 32 — APT DETAIL B1-FIX3: 선택 평형 거래 없음 cross-area fallback 제거

작업:

STEP 31이 도입한 `heroTrade`에 마지막으로 남아 있던 fallback 경로 제거. 선택한
평형+현재 매매/전월세 조합에 거래가 하나도 없으면 `heroTrade`가 `trades[0]`(다른
평형일 수 있는 전체 최신 거래)으로 넘어가던 것을, 그 경우 다른 평형으로 절대
넘어가지 않고 Hero에 "해당 평형의 최근 거래가 없습니다." empty state를 보여주도록
바꿨다. 상세는 docs/development/32-apartment-detail-b1-no-cross-area-fallback.md 참고.

수정 파일 1개:

- src/app/apt/[name]/apt-client.tsx — `heroTrade`의 `?? trades[0]` fallback을
  제거(`selectedArea === '전체'`일 때는 area 필터가 no-op이라 별도 분기 없이 기존
  동작 그대로 유지됨을 코드로 확인). `latestPrice`/`latestPriceNum`도 자기만의
  독립적인 fallback 대신 `heroTrade`에서 파생하도록 통일(같은 버그가 가격 문자열에도
  있었음). Hero 가격 영역을 `heroTrade` 유무로 분기해 특정 평형 empty state 문구를
  추가(StickyPriceBar/대출한도 모달처럼 공간이 좁은 곳은 "거래 없음"이라는 짧은
  문자열로, Hero 본문은 스펙이 제시한 전체 문장으로).

검증:

코드 추적 결과 최고가/최저가 블록·TradeTimelineList·InvestmentMetrics·
PriceTrendChart는 전부 이미 올바르거나(다른 평형 fallback 없음)애초에
selectedArea에 종속되지 않는 자기완결형 설계임을 확인해 손대지 않았다. curl로
동일 단지의 매매/전세 area 집합을 비교해 실제 asymmetric 사례 2건을 찾음(명륜
아이파크1단지 84.919㎡: 매매 있음/전세 없음, 대연힐스테이트푸르지오 163.69㎡: 전세
있음/매매 없음). 두 사례 모두 실브라우저에서 정상 쪽은 가격·면적·층·날짜가 전부
표시되고, 빈 쪽은 "해당 평형의 최근 거래가 없습니다." + "최고 - / 최저 -"만
나타나며 선택 칩 상태는 그대로 유지됨을 확인. 반대 방향 토글(다시 데이터 있는
쪽으로) 시 정상 복귀도 재확인. "전체" 선택 상태에서 매매/전세 각각 회귀 없음도
재확인. tsc/eslint(기존 무관 경고 1건 외 0)/prisma validate/migrate status/build
전부 통과.

서비스 코드 변경:

1개 프론트엔드 파일. API/DB/schema 변경 없음.

DB 변경:

없음.

최종 판단:

선택 평형 cross-area fallback 제거 완료, STEP 30(면적 표기)·STEP 31(Hero 소스
일관성) 정책은 그대로 유지, 기존 필터/차트/지표 연결 무손상, STOP 조건 미발생.
사용자 모바일 검수 가능한 상태. commit/push 하지 않았다. 검수 통과 후 별도 승인을
받아 commit/push 진행.

상태:

APT DETAIL B1-FIX3 구현 완료 / 검수중(2026-08-15).


## 2026-08-15

### STEP 33 — APT DETAIL B2-A: 단지 스펙 데이터 + 시세차트 구조 조사/설계

작업:

사용자 모바일 검수에서 나온 3가지 증상(용적률/건폐율/주차대수 "정보 준비중", 매매/
전세 시세차트 색상 유사, 선택 평형이 차트/지표에 반영 안 됨)의 코드 근거를
조사·설계만 했다(production 코드/DB/schema 변경 없음). 상세는
docs/development/33-apartment-detail-b2-spec-chart-audit.md 참고.

핵심 발견:

- 용적률/건폐율/주차대수는 legacy `Apartment` 테이블(건축물대장 총괄표제부 캐시)
  기준으로 캐시된 15건(부산)은 coverage 100%이나, 캐시 자체가 극소량이라 대부분의
  단지가 첫 방문 시 "정보 준비중"으로 보인다 — 데이터 정확도 문제가 아니라 캐시
  coverage 문제로 확정.
- `ApartmentMaster`(M3) 모델은 AptSpecGrid와 무관하며 `far`/`bcr` 필드 자체가
  스키마에 없어 그대로는 대체 불가.
- 문서28(B0.5) `mgmBldrgstPk` BLOCKER는 건축물대장 다운로드 버튼(`/api/ledger`)
  전용 문제로, AptSpecGrid가 쓰는 총괄표제부 조회(`apt-building-info.ts`)와는
  완전히 별개 코드 경로임을 재확인.
- PriceTrendChart의 매매(`var(--primary-color)` #03c75a)/전세(`#10b981`) 색상이
  둘 다 초록 계열이라 구분이 어려움 — 기존 `--down-color`(#3152d6, 파란 계열) 팔레트
  재사용을 제안.
- PriceTrendChart/InvestmentMetrics는 `selectedArea`를 prop으로 받지 않는 의도된
  자기완결형 설계(문서32에서도 이미 확인된 내용 재확인) — Hero와 기준이 달라지는
  혼란 위험 존재.
- 차트는 개별 거래를 집계 없이 그대로 연결해 평형 혼합으로 요동침 — 월별 중앙값
  aggregation을 제안.
- MOLIT 실데이터(read-only, DB 미기록)로 부산 5개 대표 단지(거래 많음/적음/평형
  다양/대형 평형/전세 많음)를 표본 조사, 최근 12개월 평형별 거래 희소성(3건 미만
  6.4%)을 근거로 selectedArea 자동 반영 + 데이터 부족 시 전체 평형 자동 폴백 정책을
  추천.

검증:

read-only DB count/groupBy 쿼리(legacy Apartment/ApartmentMaster 테이블, 부산
lawdCd 기준)와 read-only MOLIT 공공데이터 API 직접 호출(5개 대표 단지, 18개월치)로
실측. 조사에 쓴 임시 스크립트는 실행 직후 전부 삭제, git status clean 유지 확인.

서비스 코드 변경:

없음. 조사/설계 문서만 생성.

DB 변경:

없음(read-only 쿼리만 실행, write 0건).

최종 판단:

3가지 신고 증상 모두 코드 근거로 원인 확정. B2 구현은 B2-1(스펙 표시 UX)/
B2-2(차트 색상)/B2-3(selectedArea 연동+월별 중앙값 aggregation) 3단계 분리를
제안하며, 리스크가 가장 낮은 B2-2(차트 색상)부터 시작할 것을 추천. commit/push
하지 않았다. 다음 구현은 사용자 승인 후 진행.

상태:

APT DETAIL B2-A 조사·설계 완료 / 구현 승인 대기(2026-08-15).


## 2026-08-15

### STEP 34 — MAP INITIAL LOAD AUDIT: 시골 지역 최초 진입 시 구형 지도 UI 노출 조사

작업:

사용자가 시골 지역에서 모바일로 앱을 최초 실행했을 때 과거(2026-08-10~08-11에만
실제 배포됐던) 구형 지도 UI가 보였다가, 홈→지도 재진입 시 최신 UI로 정상 표시된
현상을 조사만 했다(production 코드/DB/schema 변경 없음). 상세는
docs/development/34-map-initial-load-legacy-ui-audit.md 참고.

핵심 발견:

- 스크린샷의 "← 메인으로 / 단지 / 학교 / 재개발 / 경매" 가로 pill 탭 + "이 지역에서
  재검색" UI는 현재 production 소스 어디에도 렌더링 코드가 없다 — `src/app/map/page.tsx`
  주석에만 과거형으로 언급됨.
- git 히스토리 확인 결과 해당 UI는 커밋 `e142456`(2026-08-10 13:06)에 도입되고
  커밋 `f87d69e`(2026-08-11 17:23, "지도 UI 개편")에서 완전히 제거됨 — 약 28시간만
  실제 production에 존재했던 진짜 과거 버전.
- `/map`으로 가는 모든 진입 경로(A~F)가 동일한 단일 컴포넌트로 귀결되며, 지역/좌표/
  geolocation 성공·실패에 따라 다른 UI "버전"을 그리는 분기는 코드에 없음(데이터
  유무는 마커 표시에만 영향, UI 셸은 항상 동일).
- 이 앱에는 Service Worker/PWA/manifest/localStorage 기반 지도 상태 캐시가 전혀
  없음 — 저장소 전수 검색 결과 매치 없음.
- `next build` 확인 결과 `/map`은 정적 프리렌더(`○`)이며, production 실측
  응답 헤더는 `Cache-Control: public, max-age=0, must-revalidate` + Vercel
  Edge 캐시 `HIT`(최신 빌드 반영, 구버전 아님).
- 종합: 현재 코드 자체의 버그는 아니며, 가장 유력한 설명은 "한때 실제로 배포됐던
  구버전 응답이 사용자 기기/네트워크 경로의 HTTP 캐시에 남아있다가, 신호가 약한
  지역에서의 완전 문서 네비게이션(직접 진입/새로고침) 때 재검증 없이 재노출되고,
  이후 클라이언트 사이드 전환(홈→지도)은 이미 로드된 최신 런타임을 써서 정상
  표시됐다"는 것 — 단, 사용자 기기의 실제 캐시 상태를 직접 확인한 것은 아니라 완전
  확정(A)이 아닌 "가능성 높음"(B/C)으로 판정.

검증:

전체 저장소 문자열/코드 전수 검색(구형 UI 텍스트, PWA/SW/캐시 관련 키워드,
localStorage/sessionStorage, 지역 기반 UI 분기), `git log --follow -p`로 해당
UI의 도입/제거 커밋 확정, `next build`로 정적/동적 렌더링 여부 확인, production
도메인에 대한 읽기 전용 `curl` 요청으로 실제 응답 헤더 실측. 코드/DB/schema
변경 없음, 임시 스크립트 없음.

서비스 코드 변경:

없음. 조사 문서만 생성.

DB 변경:

없음.

최종 판단:

현재 코드에는 legacy UI 렌더 경로/지역별 UI 분기/잘못된 fallback이 존재하지
않아 고칠 production 코드가 없었다. B2 작업(문서33)을 막는 BLOCKER 아님. 재현
불가·1회성 관찰이라 지금 수정 우선순위는 낮음 — 원한다면 `/map` 응답에 더 강한
캐시 무효화 헤더를 추가하는 예방 조치를 별도 STEP으로 검토 가능(사용자 승인
필요). commit/push 하지 않았다.

상태:

MAP INITIAL LOAD AUDIT 조사 완료 / 수정 없음(2026-08-15).


## 2026-08-15

### STEP 35 — APT DETAIL B2-2: 시세차트 매매/전세 색상 분리

작업:

사용자 모바일 피드백(매매/전세 선이 둘 다 초록 계열이라 겹칠 때 구분 어려움)에
따라 `src/components/PriceTrendChart.tsx`의 전세 시리즈 색상만 파랑 계열로
분리했다. 데이터/집계/selectedArea/API/DB는 변경하지 않았다. 상세는
docs/development/35-apartment-detail-b2-chart-colors.md 참고.

핵심 변경:

- 전세 line/tooltip 색상을 `#10b981`(초록)에서 `#3152d6`으로 변경. 매매(
  `var(--primary-color)`)는 그대로 유지.
- `globals.css`의 `--down-color`(#3152d6)와 같은 hex 값이지만, 그 변수 자체가
  `ai-search-client.tsx`에서 실제 "가격 하락" 의미로 쓰이고 있어(문서33에서도
  이미 지적된 위험) 변수명 대신 같은 hex를 직접 하드코딩해 의미 결합을 피했다.
  차트에는 항상 "매매"/"전세" 텍스트 라벨이 함께 있어 등락 오인 가능성은 낮다고
  판단해 STOP하지 않고 진행.
- legend 스와치와 hover 시 active dot 색은 recharts가 `<Line stroke>` 값을
  그대로 따르는 기본 동작이라, 코드 수정 없이도 자동으로 새 색상을 반영함을
  코드 확인 및 로컬 검수로 확인.
- grid/axis/tick/font/spacing/chart height/dot 표시 여부는 손대지 않음.

검증:

`npx tsc --noEmit`/`eslint`/`npm run build` 통과, `prisma validate`/`migrate
status`로 DB/schema 무변경 재확인. 로컬 `next dev`로 거래량 많은 실제 단지(
대신푸르지오1차, 부산 서구 lawdCd 26140)의 1년/3년/5년 차트에서 매매·전세
선이 교차하는 구간까지 포함해 색상 구분 확인, InvestmentMetrics/AptSpecGrid/
실거래타임라인/Hero/AreaSelector에 회귀 없음을 확인. 다만 자동화 브라우저
환경의 제약으로 실제 좁은(모바일) 뷰포트 스크린샷은 얻지 못했다 — 이번 변경이
반응형 분기 없는 고정 색상값 교체라 뷰포트와 무관함은 코드로 확인했으나, 실기기
최종 확인은 사용자 검수로 대체.

서비스 코드 변경:

`src/components/PriceTrendChart.tsx` (전세 시리즈 색상 2곳).

DB 변경:

없음.

최종 판단:

시각(색상) 변경만으로 매매/전세 구분성 문제를 해결. 새 color token 생성 없이
기존 `--down-color` 팔레트의 hex 값을 재사용했고, 의미 충돌 소지는 있으나
STOP 조건(요청서 §21)에 해당하지 않는다고 판단해 진행했다 — 이 판단 근거를
문서35 §4에 기록. selectedArea 연동/aggregation 변경(B2-3)은 이번 STEP에
포함하지 않았다. commit/push 하지 않았다. 사용자 모바일 검수 후 완료 여부
결정.

상태:

APT DETAIL B2-2 구현 완료 / 모바일 검수중(2026-08-15).


## 2026-08-16

### STEP 36 — APT DETAIL B2-3: 선택 평형 ↔ 시세차트/투자지표 데이터 일관성

작업:

AreaSelector에서 특정 전용면적을 선택해도 PriceTrendChart/InvestmentMetrics는
항상 전체 평형 기준이던 불일치를 해소했다(Hero/실거래 타임라인은 기존부터
selectedArea 반영). 데이터 집계 방식·API·DB/schema는 변경하지 않았다. 상세는
docs/development/36-apartment-detail-b2-selected-area-consistency.md 참고.

핵심 변경:

- `PriceTrendChart`/`InvestmentMetrics`에 `selectedArea` prop 추가, 이미 받아온
  매매/전세 배열을 `trade.area === selectedArea`로 클라이언트에서 필터링(추가
  API 호출 0건 — fetch effect 의존성 배열에 selectedArea를 넣지 않음).
- 데이터가 부족해도 다른 평형(전체) 데이터를 대신 보여주는 silent fallback은
  금지 — 대신 선택 평형으로만 필터링한 뒤, 매매/전세 각각 독립적으로 부족
  여부를 판단해 짧게 안내한다. 문서33이 제안했던 "전체 평형 자동 폴백"(D안)은
  이번 STEP의 목적(Hero/차트/지표 기준 일치)과 상충한다고 판단해 채택하지
  않고, A안(미표시+안내)으로 결정.
- 차트의 "데이터 부족" 임계값은 문서33의 "3건" 기준(다른 목적의 통계)을
  그대로 쓰지 않고, 현재 구현이 월별 집계 없이 개별 거래를 그대로 점으로
  찍는다는 점(거래 건수 = 차트 점 개수)과 recharts Line이 선을 그리려면 점이
  최소 2개 필요하다는 렌더링 제약을 근거로 "2건 미만"으로 새로 정함.
- InvestmentMetrics의 기존 "매매와 다른 평형 전세로 폴백" 로직은 코드를 다시
  쓰지 않고, 입력 배열을 먼저 선택 평형으로 좁히는 것만으로 선택 평형 모드에서
  자연히 다른 평형이 섞이지 않게 만듦.

검증:

`tsc`/`eslint`/`build`/`prisma validate`/`migrate status` 전부 통과. 로컬
`next dev`로 문서33 표본 단지들(대신푸르지오1차/레이카운티/엘지메트로시티3/
명륜아이파크1단지)에서 거래 충분·부족 양쪽 사례, 84.919㎡/84.9194㎡ collision
케이스, '전체' 선택 회귀를 전부 실측 확인 — 특히 엘지메트로시티3 243.35㎡(매매
1건/전세 충분)에서 매매 선만 안내와 함께 숨고 전세 선은 정상 표시되는 것,
명륜아이파크1단지 84.919㎡(5년 기준 매매 1건/전세 0건)에서 "매매·전세 모두
적어" 안내가 뜨고 84.9194㎡(32건)의 데이터와 전혀 섞이지 않는 것을 확인. 모바일
좁은 뷰포트는 도구 제약으로 스크린샷을 얻지 못해 코드 근거로만 뷰포트 무관성을
판단(문서35와 동일한 한계).

서비스 코드 변경:

`src/app/apt/[name]/apt-client.tsx`(selectedArea prop 전달 2곳),
`src/components/PriceTrendChart.tsx`(B2-2 색상 유지 + selectedArea 필터링/안내
문구 추가), `src/components/InvestmentMetrics.tsx`(selectedArea 필터링 추가).

DB 변경:

없음.

최종 판단:

핵심 목표(평형 기준 일치, silent fallback 금지, 매매/전세 독립 판단, 추가 API
호출 0건, B2-2 색상 유지) 전부 실측으로 확인. aggregation 변경(월별 중앙값)과
Metrics의 6개월 고정 창 재검토는 범위 밖으로 남겨 별도 STEP 후보로 기록.
commit/push 하지 않았다. 사용자 모바일 검수 후 B2-2와 함께 완료 여부 결정.

상태:

APT DETAIL B2-3 구현 완료 / 모바일 검수중(2026-08-16).


## 2026-08-16

### STEP 37 — APT DETAIL B2-3 FIX: 평형 선택 순서 정렬

작업:

B2-2/B2-3 production 배포(commit 1ebd840) 후 사용자 모바일 검수에서 "평형
선택 칩 순서가 무작위처럼 보인다"는 문제가 확인되어, 표시 순서만 수정했다.
상세는 docs/development/37-apartment-detail-area-order-fix.md 참고.

핵심 변경:

- 원인: `AreaSelector.tsx`의 모달용 목록(`allAreas`)은 이미 `parseFloat`
  오름차순 정렬이었으나, 상단 가로 칩용 목록(`topAreas`→`chipAreas`)은
  "거래량 많은 상위 4개만 칩으로 노출"하기 위해 거래 건수(count) 내림차순
  정렬만 되어 있어 화면상 면적 크기와 무관한 순서로 보였다.
- 수정: 상위 4개(+현재 선택된 평형 강제 포함) 선정 로직은 그대로 두고,
  최종 `chipAreas`를 렌더 직전 `parseFloat` 기준 전용면적 오름차순으로
  재정렬. `allAreas`(모달)는 이미 정답이라 손대지 않음 — 두 목록이 동일
  규칙을 쓰므로 상단 칩과 모달 순서가 항상 일치한다.
- raw `trade.area` internal key, collision 해소 알고리즘(area-utils.ts),
  '전체' sentinel 처리는 전혀 변경하지 않았다 — 정렬은 배열 순서만 바꾸는
  문제라 이 정책들과 상호작용하지 않는다.

검증:

`tsc`/`eslint`/`build` 전부 통과. `git status --short` → `AreaSelector.tsx`
1개 파일만 변경(DB/schema/migration 없음). 로컬 `next dev`로 명륜아이파크1
단지(collision 84.92/84.99 독립 유지 확인), 엘지메트로시티3(243.35㎡ 거래
부족 정책 회귀 없음 재확인), 대신푸르지오1차(회귀 없음) 실측 확인 — 세 단지
모두 상단 칩·모달이 "전체 → 작은 면적 → 큰 면적" 순서로 일치.

서비스 코드 변경:

`src/components/AreaSelector.tsx` (`chipAreas` 정렬 추가, 1개 파일).

DB 변경:

없음.

최종 판단:

핵심 목표(전체→오름차순 정렬, 상단 칩/모달 순서 일치, raw key·collision
정책·거래 부족 정책 무손상) 전부 실측으로 확인. commit/push 하지 않았다.
사용자 모바일 검수 후 별도 지시를 기다린다.

상태:

APT DETAIL B2-3 FIX 구현 완료 / 모바일 검수중(2026-08-16).


## 2026-08-16

### STEP 38 — APT DETAIL B2-1: 단지 스펙(용적률·건폐율·주차대수) 데이터 안정화

작업:

용적률/건폐율/주차대수가 일부 단지에서 "정보 준비중"으로 나오는 문제를
데이터 신뢰성 우선/추정값 금지 원칙 하에 조사·최소 개선했다. 상세는
docs/development/38-apartment-detail-b2-spec-data-stability.md 참고.

핵심 발견:

- 문서33(B2-A) 조사 이후 legacy Apartment 캐시가 15건→18건(부산)으로 자연
  증가 — apt-client.tsx가 이미 갖고 있던 "cache-miss 시 실거래 지번으로
  건축물대장 라이브 조회 + DB 캐싱" 경로가 실제로 작동 중임을 확인.
- cache-miss 6개 표본(구덕금호 등)을 read-only로 직접 조회한 결과 전부
  건축물대장 총괄표제부 자체가 없음(totalCount 0) — "아직 확인 전"이
  아니라 이 API로는 구조적으로 채울 수 없는 값(총괄표제부는 다수동
  공동주택 대상 개념, 소규모/단독동 건물은 애초에 미등록).
- 반면 "엘지메트로시티1/2/4/5"처럼 이미 캐시된 건물(엘지메트로시티3)과
  물리적으로 동일한 지번인데 이름이 달라 캐시가 재사용되지 못하는 사례를
  다수 확인 — 부산 캐시 18건 중 이미 3건이 이런 이름 변형 중복(값은 완전
  동일, 오매칭 아님).
- 사용자가 모바일에서 실제로 본 정상 사례(용적률 361.5%/건폐율 53.5%/주차
  461대/564세대)를 DB에서 역추적해 "남성한빛가든"(서대신동3가) 캐시 행임을
  확인 — 계산값이 아니라 건축물대장 원본을 그대로 캐시한 값.

핵심 변경:

- `src/app/api/apt/[name]/info/route.ts`: `fetchCachedRegistry()`에 지번
  기반 보조 조회 추가. 이름 exact match가 실패해도 같은 dong+jibun(지번
  정확히 일치, 유사매칭 아님)이 이미 캐시돼 있으면 그 값을 재사용 —
  건축물대장 조회 자체가 이름이 아니라 지번으로만 대상을 특정하므로 안전.
  신규 DB write는 추가하지 않음(중복 행 증가 방지).
- `src/components/AptSpecGrid.tsx`: 값 없음 문구를 "정보 준비중" →
  "정보 없음"으로 변경. 그리드 구조/CSS/제보링크는 그대로 유지 — 문서33이
  제안한 "건축물대장 정보" 그룹 UI(C안)는 레이아웃 변경이 필요해 이번
  STEP에서는 구현하지 않고 별도 승인 필요 사안으로 남김.

검증:

`tsc`/`eslint`/`build`/`prisma validate`/`migrate status` 전부 통과. curl로
엘지메트로시티1(캐시 없는 이름)이 엘지메트로시티3 값을 즉시 반환하는 것,
같은 동 안의 임의 지번(999)은 절대 재사용되지 않는 것, 수정 전후
`prisma.apartment.count()`가 27건으로 동일(신규 write 없음)한 것을 확인.
브라우저로 남성한빛가든(cache-hit, 사용자 실제 사례 재현)과 구덕금호
(cache-miss, "정보 없음" 정상 표시, 세대수/준공년월 회귀 없음) 실측.

서비스 코드 변경:

`src/app/api/apt/[name]/info/route.ts`, `src/components/AptSpecGrid.tsx`.

DB 변경:

없음. schema/migration 변경 없음.

최종 판단:

없는 데이터를 추정해 만들지 않았고, 안전하게 확인된 지번 일치 재사용만
최소 범위로 구현했다. batch enrichment·ApartmentMaster 스키마 확장(far/bcr
필드 없음)·"건축물대장 정보" 그룹 UI는 별도 승인이 필요해 진행하지 않고
기록만 남겼다. commit/push 하지 않았다. 사용자 검수 후 별도 지시를
기다린다.

상태:

APT DETAIL B2-1 구현 완료 / 검수 대기(2026-08-16).


## 2026-08-16

### STEP 39 — APT DETAIL UI-C: 상세페이지 잔여 섹션 전수점검

작업:

아파트 상세페이지의 남은 12개 영역(단지 브리핑/교통/생활편의/학군/
커뮤니티/퀵버튼/FloorPlanPanel/공유/StickyPriceBar/CommunityPreview/
AdContainer/검색 진입점 부재)을 유지/개선/삭제/후속 STEP으로 분류하는
조사·설계만 수행했다(코드 변경 없음). 상세는
docs/development/39-apartment-detail-remaining-ui-audit.md 참고.

핵심 발견:

- 단지 브리핑(`buildAptBrief`)의 이전 통계 버그("소규모 단지 절대건수
  오판", "단일 이상치 비교로 과장된 %")는 이미 수정돼 있음을 코드와
  실측(부산 10개 단지, read-only)으로 재확인. 세대수 대비 거래 비율
  기반 분류가 정확히 동작(예: 엘지메트로시티3 6건=한산 vs 레이카운티
  62건=활발, 세대수 반영 없이는 반대로 보일 수 있는 케이스). 다만 거래
  1건뿐인 소규모 단지에서 "활발한 편" 단정 표현이 나오는 잔여 개선
  여지 발견.
- 생활편의가 "공원/병원 위주"로 보이는 이유를 코드로 확정 —
  `NeighborhoodInfoPanel.tsx`에 카테고리 2개(SW8/HP8)+키워드(KTX/공원)만
  하드코딩. `KakaoPlaces.tsx`에 대형마트(MT1) 타입이 이미 정의돼 있으나
  어디서도 호출되지 않는 미사용 상태 발견 — 저비용 확장 가능.
- 버스 정보는 현재 코드에 전혀 없음(재확인). 카카오 로컬 키워드 검색
  방식(기존 KTX/공원과 동일 패턴)으로 정류장 개수+최근접 거리 정도가
  최소비용 구현 후보.
- 상세페이지에 다른 단지 검색 진입점이 없는 문제 — `Header.tsx`가 이미
  `searchSlot` prop을 지원하도록 설계돼 있으나(CSS 클래스까지 존재)
  어느 페이지도 아직 사용하지 않음, `ApartmentAutocomplete`가 이미
  `/map`·`/stats/[type]`·`RegionSelectModal`에서 재사용 중인 기존
  컴포넌트임을 확인 — 신규 컴포넌트 없이 기존 두 자산을 연결하기만
  하면 되는 낮은 리스크 구조.
- 커뮤니티시설 퀵버튼: `communityFacilities` coverage가 여전히
  27건 중 0건(0%, read-only 재확인) — 이전 audit과 동일.
- "단지정보" 퀵버튼 모달과 AptSpecGrid 간 세대수/사용승인일/총주차대수
  완전 중복, "글쓰기" CTA가 페이지 내 3곳(1구역 카드/CommunityPreview/
  StickyPriceBar)에 중복 존재하는 것을 확인.

검증:

Hero/AreaSelector/Chart/Metrics/AptSpecGrid는 이미 B1~B2-1에서 검증됐으므로
회귀 확인 수준으로만 재확인(이상 없음). 단지 브리핑은 production API를
read-only로 직접 호출해 부산 10개 단지(88~7,374세대)로 실측. DB는
`prisma.apartment.count()`(communityFacilities coverage) read-only
조회만 수행, write 없음.

서비스 코드 변경:

없음.

DB 변경:

없음. schema/migration 변경 없음.

최종 판단:

유지/개선/삭제 매트릭스와 다음 구현 STEP 후보 3개(UI-C2 생활편의 확장 →
UI-C1 검색 진입점 → UI-C3 버스, 추천 순서)를 정리했다. production
code/API/DB/schema는 변경하지 않았고 commit/push 하지 않았다. 실제
구현은 사용자 승인 후 별도 STEP으로 진행한다.

상태:

APT DETAIL UI-C 조사·설계 완료 / 구현 승인 대기(2026-08-16).


## 2026-08-16

### STEP 40 — APT DETAIL UI-C2: 생활편의 카테고리 확장

작업:

아파트 상세 "교통·편의시설" 탭의 생활편의를 병원·공원 2종에서 대형마트/
편의점/약국/어린이집·유치원을 더한 6종으로 확장했다. 상세는
docs/development/40-apartment-detail-living-convenience.md 참고.

핵심 변경:

- `src/components/KakaoPlaces.tsx`: `KakaoCategoryCode` 유니온에 `CS2`/
  `PM9`/`PS3` 추가, 아이콘 매핑 추가. 4개 신규 카카오 카테고리 코드는
  Kakao Local REST API로 직접 재검증(임의 코드 사용 없음) — `PS3`는
  공식 `category_group_name`이 이미 "어린이집,유치원"임을 확인해 UI
  라벨을 "어린이집·유치원"으로 확정.
- `src/components/NeighborhoodInfoPanel.tsx`: 기존 교통·병원·공원 카드는
  전혀 건드리지 않고(diff에 미등장, 회귀 없음) 같은 카드 패턴으로
  카드 4개(대형마트/편의점/약국/어린이집·유치원)만 추가. 새 tab/공통
  컴포넌트 없이 기존 "교통·편의시설" tab의 그리드를 그대로 확장.
- `KakaoPlaces.tsx`의 결과 0건 문구를 "주변에 해당 인프라가 없습니다."
  → "검색 반경 내 정보가 없습니다."로 개선(6개 카테고리 전체 공통 적용,
  "정보 준비중" 사용 안 함).
- `MT1`(대형마트) 타입은 이미 코드에 정의만 돼 있고 미사용 상태였던 것을
  이번 STEP에서 실제로 연결.

검증:

`tsc`/`eslint`/`build`/`prisma validate`/`migrate status` 전부 통과.
부산 5개 단지(도심/주거지역/대형마트 인접/소규모/외곽)를 Kakao Local
REST API로 read-only 실측해 6개 카테고리 전부 반경 내 결과 존재, 오탐
없음 확인. `apt-client.tsx`의 `infraTab` 기본값이 '환경'이라 이 섹션
자체가 이미 tab-click 기반 lazy load였음을 재확인 — 페이지 최초 로딩에
영향 없음. 카드 기준 API 호출 3배(콜 기준 약 1.8배) 증가는 탭을 실제로
연 사용자에게만 발생.

한계: 로컬 dev 서버(카카오 콘솔 미등록 도메인)에서 Kakao Maps JS SDK
로드 자체가 차단돼(기존 병원·공원 카드도 동일 증상) 실제 데이터가 채워진
화면·모바일 좁은 뷰포트는 이번 세션에서 확인하지 못했다 — production
배포 후 재확인 필요. 결과 0건/API 실패 구분은 6개 호출부 전체에 영향을
주는 변경이라 이번 STEP에서는 보류.

서비스 코드 변경:

`src/components/KakaoPlaces.tsx`, `src/components/NeighborhoodInfoPanel.tsx`.

DB 변경:

없음. schema/migration 변경 없음. 새 API/package 추가 없음.

최종 판단:

기존 Kakao Local 카테고리 검색 구조를 그대로 재사용해 최소 변경으로
6종 확장을 구현했다. 데이터 정확도는 REST API로 검증했으나 실제 화면
렌더링은 로컬 환경 제약으로 미확인 — commit/push 하지 않았고, 사용자
모바일 검수 후 별도 지시를 기다린다.

상태:

APT DETAIL UI-C2 구현 완료 / 모바일 검수중(2026-08-16).


## 2026-08-16

### STEP 41 — APT DETAIL UI-C2-FIX: 교통 오탐/폐역 노출 최소 수정

작업:

UI-C2 모바일 검수 중 발견된 교통 카드 문제 2건만 최소 수정했다. 상세는
docs/development/41-apartment-detail-transport-filter-fix.md 참고.

핵심 발견 및 변경:

- Kakao Local REST API 실측(read-only) 결과, "KTX특송퀵서비스"/"KTX렌트카"/
  "KTX부동산" 등 오탐은 `category_name`이 "운송>퀵서비스"/"렌터카"/
  "부동산중개업" 등으로 실제 역과 완전히 다른 반면, 진짜 역은 항상
  "기차,철도 > 기차역" 경로를 가짐을 확인 — 특정 상호를 하드코딩하지 않고
  이 공식 분류 경로 포함 여부로 일반 필터(`isRailwayStation`)를 추가했다.
- 신선대역/우암역 같은 폐역은 `category_name` 마지막 세그먼트에 카카오가
  명시적으로 "폐역"을 표기함을 확인 — 이 명시적 상태값만 근거로 필터
  (`isClosedStation`)를 추가했다(운행 중인 역을 이름으로 추정 제거하지 않음).
- `src/components/KakaoPlaces.tsx` 필터 체인에 두 줄만 추가. 새 필터는
  `__keyword`가 'KTX'/'기차역'인 결과에만 적용돼 SW8 지하철 카테고리
  결과와 생활편의 5종(병원/대형마트/편의점/약국/어린이집·유치원/공원)은
  전혀 영향받지 않음.

검증:

`tsc`/`eslint`/`build`/`prisma validate`/`migrate status` 전부 통과.
부산 5개 단지(대신푸르지오1차/남성한빛가든/엘지메트로시티3/명륜아이파크1
단지/대가하이츠)에서 KakaoPlaces.tsx의 실제 필터 체인을 그대로 재현해
REST API로 검증 — KTX특송퀵서비스·신선대역·우암역 전부 제거, 정상
지하철역(동대신역/서대신역 등) 및 정상 KTX/기차역(부산역, 부산진화물역)은
누락 없이 유지됨을 확인.

서비스 코드 변경:

`src/components/KakaoPlaces.tsx`.

DB 변경:

없음. schema/migration 변경 없음. 카드 디자인/radius/정렬/호출 수/신규
카테고리/버스는 변경하지 않았다.

최종 판단:

두 문제 모두 Kakao 공식 분류값(category_name)만으로 특정 상호 하드코딩
없이 일반적으로 해결했다. commit/push 하지 않았다. 사용자 검수 후 별도
지시를 기다린다.

상태:

APT DETAIL UI-C2-FIX 구현 완료 / 검수 대기(2026-08-16).


## 2026-08-16

### STEP 42 — APT DETAIL UI-C1: 상세페이지 빠른 단지검색 + 최근 본 단지

작업:

상세페이지에서 다른 아파트로 즉시 이동할 수 있는 "빠른 검색" 기능을
구현했다. 상세는 docs/development/42-apartment-detail-quick-search.md
참고.

핵심 변경:

- `Header.tsx`에 이미 있었지만 어느 페이지도 쓰지 않던 `searchSlot`
  prop에 검색 아이콘(🔍, aria-label="다른 아파트 검색")을 연결 —
  Header.tsx/CSS는 전혀 수정하지 않았다.
- 검색 자체는 `/map`·`/stats`·`RegionSelectModal`에서 이미 쓰는
  `ApartmentAutocomplete`를 그대로 재사용, 선택적 콜백 prop
  `onQueryStateChange` 1개만 추가(기존 호출부 영향 없음).
- `apt-client.tsx`의 기존 모달 시스템(activeModal/openModal/closeModal)에
  `'빠른 검색'` case 하나만 추가 — 새 overlay 시스템을 만들지 않았다.
- 검색 결과 선택 시 `ApartmentAutocomplete` 자신의 enrichTopResults()가
  쓰는 것과 동일한 좌표→법정동 역지오코딩으로 lawdCd/dong을 얻어
  기존 canonical URL(`/apt/[name]?lawdCd=..&dong=..`, /map "상세보기"
  버튼과 동일 형태)로 직접 이동 — 홈/AI검색/지도를 거치지 않는다.
- "최근 본 단지"는 신규 client-side localStorage(`ejip:recentApartments`,
  최대 8개, name+dong 중복 갱신, 손상 방어)만 사용 — DB/로그인 연동 없음.
  기록은 새 effect가 아니라 기존 조회 로그 effect(pageReady 확정 시점)를
  확장해 모든 진입 경로를 자동으로 커버한다.
- Android/브라우저 뒤로가기로 검색만 닫히고 상세페이지는 이탈하지
  않도록 history.pushState+popstate를 이 컴포넌트에만 추가했다.

검증:

`tsc`/`eslint`/`build`/`prisma validate`/`migrate status` 전부 통과.
로컬 next dev(포트 3000, Kakao 앱키 등록 도메인)에서 CASE A~G 실측 —
검색→선택→즉시이동, 최근 본 단지 표시/현재 단지 제외, 취소, 결과없음
empty state, 손상된 localStorage 방어(크래시 없음), history.back()
시뮬레이션으로 popstate 동작까지 확인. CASE B에서 카카오 POI 검색명과
MOLIT 등록명 불일치(ApartmentAutocomplete의 기존 한계, 이번 STEP 문제
아님)를 발견해 정직하게 기록. 모바일 360/375/390px 자동 뷰포트는 도구
제약으로 실측하지 못해 CSS 구조 근거로만 판단, 실기기 검수 필요.

서비스 코드 변경:

신규 `src/lib/recent-apartments.ts`, `src/components/ApartmentQuickSearch.tsx`.
수정 `src/components/ApartmentAutocomplete.tsx`,
`src/app/apt/[name]/apt-client.tsx`.

DB 변경:

없음. schema/migration 변경 없음. 새 외부 API 없음.

최종 판단:

기존 Header searchSlot·ApartmentAutocomplete·모달 시스템·canonical
routing 4가지를 전부 재사용해 새 검색 시스템 없이 최소 코드로 구현했다.
commit/push 하지 않았다. 사용자 검수 후 별도 지시를 기다린다.

상태:

APT DETAIL UI-C1 구현 완료 / 검수 대기(2026-08-16).


## 2026-08-17

### STEP 43 — APT DETAIL UI-C1-FIX: 빠른 단지검색 매칭 안정화

작업:

STEP 42의 "빠른 검색"에서 UI-C1-PRECHECK가 발견한 카카오 POI명 ↔
MOLIT 등록명 표기 차이(검색 실패)와 동명 단지 오매칭(전국 검색) 위험을
줄였다. 상세는
docs/development/43-apartment-quick-search-matching-fix.md 참고.

핵심 변경:

- 신규 `src/lib/apt-name-match.ts` — 기존 route.ts의 정규화(공백 제거,
  끝 "아파트" 제거)를 유지하면서 건물번호 접미사 제거, 차수(1차/2차)
  위치 무관 토큰 비교, `LG↔엘지` 소수 brand alias만 안전하게 추가.
  문자 유사도(Levenshtein 등)는 쓰지 않는다. 차수가 서로 다르면 즉시
  불일치 처리하는 안전장치 포함.
- `/api/apt/[name]/route.ts`의 이름 비교를 `aptNamesMatch()` 호출로
  교체 — 기존 `dong` 필터는 완전히 그대로 유지, 매칭 범위만 상위집합
  으로 확장(회귀 없음).
- `ApartmentAutocomplete.tsx`에 선택적 `biasLocation` prop 추가 — 카카오
  `keywordSearch`에 `location`만 소프트 tiebreaker로 전달(`sort:
  DISTANCE` 강제는 실측 중 정확 매칭 회귀가 발견돼 제거). 기존
  `/map`·`/stats`·`RegionSelectModal` 호출부는 prop을 넘기지 않아
  기존 동작 그대로.
- `ApartmentQuickSearch.tsx` — 현재 단지 주소로 bias 좌표 지오코딩,
  검색 결과 선택 시 이동 전 `/api/apt/[name]`으로 실거래 존재를 먼저
  확인하고, 없으면 다른 단지로 대체하지 않고 실패 안내 후 재검색을
  유도(fail-safe). `recent-apartments.ts` 정책은 변경 없음.
- `apt-client.tsx` — `ApartmentQuickSearch`에 `currentApt.address` 한
  줄만 추가 전달(기존 `primaryAddress` 재사용).
- 뒤로가기(history.pushState/popstate) 블록은 이번 STEP에서 수정하지
  않았다 — history 이중 소비 이슈는 후속 STEP으로 유지.

검증:

`tsc`/`eslint`(무관한 기존 warning 1건 제외 0 error)/`next build`/
`prisma validate`/`migrate status` 전부 통과. 로컬 next dev(포트 3000)
라이브 브라우저로 대표 실패 사례 4건 재검증 — A(엘지메트로시티3)·
B(대신푸르지오2차)는 실거래 데이터로 성공 이동, D(협성르네상스)는
bias로 목표 지역이 상위권 진입해 성공 이동, C(금호어울림)는 브랜드명
자체의 구조적 모호함으로 미해결(오매칭 재현 방지 위해 클릭하지 않고
검색 결과만으로 판정, 문서에 한계로 기록). 정상 사례 5종(대신푸르지오
1차/명륜아이파크1단지/동래래미안아이파크/레이카운티/화명롯데캐슬카이저)
전부 API 직접 호출로 회귀 없음 확인(오류 0건). `/map`·`/stats`·
`RegionSelectModal`은 `biasLocation` 미사용 확인(grep)으로 영향 없음.
30개 이상 표본 종합 오매칭 0건(성공 기준 충족) — 상세 표는 문서 43
참고.

서비스 코드 변경:

신규 `src/lib/apt-name-match.ts`. 수정 `src/app/api/apt/[name]/route.ts`,
`src/components/ApartmentAutocomplete.tsx`,
`src/components/ApartmentQuickSearch.tsx`,
`src/app/apt/[name]/apt-client.tsx`.

DB 변경:

없음. schema/migration 변경 없음. 새 외부 API 없음. fuzzy matching
패키지 추가 없음.

최종 판단:

이름 매칭은 규칙 기반 정규화만으로, 검색 순위는 소프트 위치 bias만으로,
최종 안전장치는 이동 전 실거래 확인(fail-safe)으로 처리해 "오매칭
금지"를 구조적으로 지켰다. 브랜드명만으로는 원천적으로 모호한 검색어
(C 사례)는 완전히 해결하지 못했음을 정직하게 남겼다. AI 검색/홈 검색/
지도 검색 UX/뒤로가기 수정/즐겨찾기/비교/버스/점수체계/이집 브리핑/
평면도 등 다른 STEP은 시작하지 않았다. commit/push 하지 않았다.
사용자 검수 후 별도 지시를 기다린다.

상태:

APT DETAIL UI-C1-FIX 구현 완료 / 검수 대기(2026-08-17).

### STEP 44 — APT DETAIL UI-C3: 버스 접근성 데이터 조사(구현 STOP)

작업:

"실거주 환경 & 학군 인프라 > 교통·편의시설"에 버스 접근성 카드를
추가하기 위해 Kakao Local API로 시내버스 정류장을 신뢰성 있게 검색할
수 있는지 실측 조사했다. 상세는
docs/development/44-apartment-detail-bus-access.md 참고.

핵심 결론:

- Kakao 공식 `category_group_code`(19종)에는 버스정류장 전용 코드가
  없음(임의 코드 프로브 시 400).
- `keywordSearch`(`버스정류장`/`정류장`/`정류소`/`버스`/`시내버스`
  등)로 6개 표본단지(대신푸르지오1차/명륜아이파크1단지/엘지메트로
  시티3/남성한빛가든/해운대 표본/기장군 고원3단지) + 서면역(부산 최대
  환승거점) 추가 검증을 실측한 결과, **4개 단지는 반경 2km 내 raw
  결과 0건**, 나머지 2곳과 서면역에서 나온 결과도 전부 일반 시내버스
  정류장이 아니라 "고속,시외버스정류장/터미널"로 분류된 무관한 결과였다.
- "오탐을 일반 규칙으로 걸러내는" 문제가 아니라 "검색 대상 자체가
  Kakao Local 인덱스에 없는" 문제로 판단 — §17 STOP 조건 충족.
- **UI 구현을 진행하지 않았다.** `KakaoPlaces.tsx`/
  `NeighborhoodInfoPanel.tsx` 등 프로덕션 코드 변경 없음, DB/schema/
  migration 변경 없음, API 호출량 변화 없음(0회).
- 공공데이터포털에서 노선번호까지 포함하는 대안 2종을 조사·보고:
  ① 부산광역시_부산버스정보시스템(부산 전용, 정류소+노선번호+도착정보
  전부 제공, 무료, 서비스키 필요) ② 국토교통부_(TAGO)_버스정류소정보
  (전국 대상이나 부산 지원 여부 미확인, 좌표기반 반경 500m 검색 지원,
  노선번호 오퍼레이션 상세는 미확인). 두 후보 모두 신규 서비스키 발급이
  필요해 사용자 승인 전까지 가입/키 발급을 진행하지 않았다.

서비스 코드 변경:

없음.

DB 변경:

없음. schema/migration 변경 없음. 새 외부 API key 발급/연동 없음.

최종 판단:

"버스 카드가 화면에 생겼다"가 아니라 "신뢰할 수 있는 기초 데이터를
확보했는가"를 성공 기준으로 삼아, Kakao만으로는 이 기준을 충족할 수
없음을 실측으로 확인하고 화면을 억지로 만들지 않았다. 노선번호까지
포함하는 공공 API 후보 조사까지 완료해 보고했고, 다음 단계(API
활용신청 여부/후보 선택)는 사용자 승인을 기다린다. commit/push 하지
않았다.

상태:

APT DETAIL UI-C3 조사 완료 / 구현 STOP / 사용자 승인 대기(2026-08-18).

### STEP 45 — APT DETAIL UI-C3-2: TAGO 버스정류소 연동

작업:

국토교통부_(TAGO)_버스정류소정보 API 활용신청 승인 완료 후, 아파트
상세페이지 🚌 버스 카드(가장 가까운 정류장/거리/도보시간/300·500m
정류장 수)를 실제로 구현했다. 상세는
docs/development/45-apartment-detail-tago-bus-stop.md 참고.

핵심 결과:

- 새 서버 라우트 `GET /api/transit/bus-stops?lat=..&lng=..` — 기존
  `DATA_GO_KR_API_KEY`(새 환경변수 추가 없음, client 비노출)로 TAGO
  `getCrdntPrxmtSttnList`(좌표기반근접정류소 목록조회) 호출, `@turf/turf`
  로 직선거리 계산, `getOrSetCache`로 6시간 서버 캐싱(DB 저장 없음).
- 도시코드 조회로 부산광역시(citycode=21) 지원 확인 후 진행.
- 실측 중 짧은 간격 연속 호출 시 일부 요청이 timeout/비정상 응답으로
  실패하는 현상을 발견해, 고정 1회·400ms 지연의 재시도를 추가— 재현
  시나리오(6개 좌표 무지연 연속 호출)에서 실패 0건으로 개선 확인.
- `KakaoPlaces.tsx`의 기존 `formatEta`(거리→도보시간) 함수를 새로
  만들지 않고 `export` 1개 키워드만 추가해 그대로 재사용.
- `NeighborhoodInfoPanel.tsx`에 기존 `cardStyle`을 재사용한 버스 카드
  1개만 추가(순서: 교통→버스→병원·공원→...).
- 실제 배포 라우트로 6개 표본단지(대신푸르지오1차/명륜아이파크1단지/
  엘지메트로시티3/남성한빛가든/해운대 표본/기장군 고원3단지) 전부
  실데이터 확인 — 오류 0건, 정류장명이 실제 위치와 논리적으로 일치,
  타 도시(서울/대구 등) 정류장 혼입 없음.
- 행정구역 경계 인근 3개 단지(대신푸르지오1차/명륜아이파크1단지/
  고원3단지)에서 동일 물리 정류장이 인접 지자체 시스템에 별도
  citycode/nodeid로 중복 등록된 경우를 발견 — §10 정책(ID 다르면 별도
  취급, 이름/좌표 기준 임의 병합 금지)에 따라 그대로 두고 300m/500m
  카운트가 다소 과대집계될 수 있음을 한계로 기록(BLOCKER인 "다른 도시
  정류장 혼입"과는 다른 현상 — 물리 위치는 정확함).
- Kakao Places 검색 호출 9회(기존과 동일, 버스 카드는 관여 없음),
  Geocoder addressSearch 6→7회(신규 카드 1개분), TAGO 호출은 탭 진입당
  1회(N+1 없음), 페이지 최초 로딩 시 0회 — 브라우저 네트워크 로그로
  확인.
- 포트 3000이 사용자의 다른 프로젝트(D:\anti2\sangjo)로 점유돼 있어
  Kakao JS 키의 도메인 제한(localhost:3000만 허용) 때문에 처음엔
  브라우저 검증이 막혔다 — 사용자가 해당 프로세스를 직접 종료해 재검증.

서비스 코드 변경:

신규 `src/app/api/transit/bus-stops/route.ts`,
`src/components/BusAccessCard.tsx`. 수정 `src/components/KakaoPlaces.tsx`
(export 1줄), `src/components/NeighborhoodInfoPanel.tsx`(카드 1개 추가).
`apt-client.tsx` 등 다른 파일은 전혀 건드리지 않았다.

DB 변경:

없음. schema/migration 변경 없음. 새 환경변수 추가 없음(기존
DATA_GO_KR_API_KEY 재사용).

최종 판단:

TAGO 버스정류소정보로 신뢰 가능한 버스 접근성 기초 데이터(가장 가까운
정류장/거리/도보시간/300·500m 정류장 수)를 확보해 화면에 반영했다.
행정구역 경계에서의 중복 등록 한계는 정직하게 문서화했고, 노선번호/
도착정보/점수체계/이집 브리핑 연동은 후속 STEP으로 남겼다. commit/push
하지 않았다. 사용자 모바일 검수 후 별도 지시를 기다린다.

상태:

APT DETAIL UI-C3-2 구현 완료 / 검수 대기(2026-08-18).

## 2026-08-18

### STEP 47 — APT DETAIL UI-C3-3: 대중교통 통합 + 버스 노선정보 연결

작업:

UI-C3-2를 폐기하지 않고, IA를 대중교통(지하철·버스)/광역교통(KTX·기차)
으로 재구성하고 "정류장 개수" 대신 "운행 노선번호"를 보여주도록 버스
카드를 개선했다. 상세는
docs/development/47-apartment-detail-public-transit-integration.md 참고.

핵심 결과:

- TAGO 같은 서비스(`BusSttnInfoInqireService`) 내 `getSttnThrghRouteList`
  (정류소별경유노선 목록조회) 오퍼레이션을 조사·검증해 구현. 별도
  활용신청/환경변수 없이 기존 `DATA_GO_KR_API_KEY`로 호출 가능함을
  확인.
- **파라미터명 함정 발견**: 요청 파라미터가 camelCase `nodeId`가 아니라
  소문자 `nodeid`여야 한다 — 틀린 이름으로 보내면 에러 없이(resultCode
  "00") 해당 도시 전체 노선(부산 302개)을 돌려줘 "다른 정류장의 노선을
  대신 표시"하는 사고로 이어질 뻔했다. 서로 다른 정류장에 각각 호출해
  실제로 다른 결과가 나오는 것을 확인해 검증했다.
  `src/app/api/transit/bus-stops/route.ts` 수정.
- 버스 카드(`BusAccessCard.tsx`)에서 "500m 이내 N곳" 문구를 화면에서
  제거하고 "운행 노선"(숫자 우선 정렬, 최대 4개 + "외 N개") 표시로
  교체. `busStopCountWithin300m/500m` API 필드 자체는 삭제하지 않고
  향후 점수체계용으로 유지.
- **캐시 버그 발견·수정**: 노선 조회 실패를 정류소 위치 캐시(6시간)와
  같은 캐시 값에 묶었더니, 일시적 레이트리밋 실패가 6시간 동안
  영구화되는 문제를 실측으로 재현 — `bus-routes:{cityCode}:{stopId}`
  별도 캐시 키로 분리해, 실패는 캐시되지 않고 다음 요청에서 자연
  재시도되도록 수정.
- `NeighborhoodInfoPanel.tsx`의 "🚇 교통(지하철·KTX)" 카드를 "🚇
  대중교통"(지하철+버스, 하위 섹션 2개)과 "🚄 광역교통"(KTX/기차)으로
  분리 — `KakaoPlaces`/`BusAccessCard` 컴포넌트 자체는 무수정, 상위
  배치만 재구성(옵션 A, 회귀 위험 최소화).
- 부산진화물역 등 비여객역이 광역교통에 계속 노출되는 현상을 조사 —
  Kakao category_name이 화물역/여객역에 완전히 동일해 안전한 일반
  필터 규칙이 없음을 확인, 이름 하드코딩 없이 조사 결과만 기록(필터
  추가 안 함).
- 6개 표본단지(STEP45와 동일) 실 데이터로 노선번호 검증 — 대신푸르지오
  (서구3·서구3-1), 엘지메트로시티3(20·22·24·27·39·131), 해운대
  표본(14개 노선) 등. 명륜아이파크1단지는 TAGO 원본 자체가 경유 노선
  0건(정류장은 실재, 오류 아님).
- claude-in-chrome으로 localhost 실측(대중교통/광역교통 카드 정상,
  초역세권 배지 정상, Hero/AreaSelector/차트 회귀 없음). 모바일
  뷰포트(360/375/390px)는 브라우저 도구의 resize_window가 이 환경에서
  실제 반영되지 않아 실측하지 못함 — 사용자 모바일 실기기 검수 필요.

서비스 코드 변경:

수정 `src/app/api/transit/bus-stops/route.ts`(노선 조회 추가, 캐시
분리), `src/components/BusAccessCard.tsx`(UI 개선), 
`src/components/NeighborhoodInfoPanel.tsx`(IA 재구성). 신규 파일 없음.
`KakaoPlaces.tsx`/`apt-client.tsx` 등은 건드리지 않았다.

DB 변경:

없음. schema/migration 변경 없음. 새 환경변수 추가 없음.

최종 판단:

노선번호 연결 조건(§7)을 모두 충족해 최소 구현했다. 정류장 개수 대신
운행 노선을 보여주는 것으로 화면 정보의 가치를 높였고, 대중교통/
광역교통 IA 분리로 의미를 명확히 했다. 부산진화물역 노출은 안전한
일반 규칙이 없어 의도적으로 손대지 않고 한계로 기록했다. commit/push
하지 않았다. 사용자 승인 후 별도 STEP에서 진행한다.

상태:

APT DETAIL UI-C3-3 구현 완료 / 사용자 승인 대기(2026-08-18).

## 2026-08-18

### STEP 48 — 단지 주변 생활정보 탭 UI 개선

작업:

기능/API 변경 없이 상세페이지 3구역(실거주 환경·교통·학군) 탭의
시각적 존재감과 선택 상태 가독성만 개선했다. 상세는
docs/development/48-apartment-detail-living-info-tab-ui.md 참고.

핵심 결과:

- 섹션 제목 "실거주 환경 & 학군 인프라" → "단지 주변 생활정보"로 변경
  — 해당 문자열이 `apt-client.tsx` 한 곳에서만 쓰이는 순수 표시
  텍스트임을 조사로 확인 후 진행.
- 탭을 텍스트+밑줄에서 아이콘(위)+라벨(아래) 3열 카드형 그리드로
  교체. 라벨: 실거주 환경→주거환경, 교통·편의시설→교통·편의, 학군
  유지. `grid-template-columns: repeat(3, minmax(0, 1fr))` +
  버튼 `min-width: 0`으로 좁은 화면에서도 줄바꿈/overflow 없이 3등분
  유지.
- 선택 상태를 연한 그린 배경(`#e6f9ee`)+그린 테두리(`--primary-color`)
  +라벨 `font-weight: 700`으로 강화(기존 초록 텍스트+밑줄 대비 시인성
  대폭 개선).
- `infraTab` state, 탭 전환 로직, 각 탭이 렌더링하는 컴포넌트
  (`LivingEnvironmentPanel`/`NeighborhoodInfoPanel`/
  `SchoolDistrictPanel`)는 전혀 건드리지 않음 — 순수 마크업/스타일
  변경.
- 모바일 360/375/390px 검증: 이 환경의 claude-in-chrome
  `resize_window`가 실제 뷰포트를 바꾸지 못하는 한계(STEP47에서 이미
  확인)를 우회해, 동일 CSS/마크업을 담은 독립 iframe(자체 뷰포트를
  가져 `@media` 쿼리가 정확히 평가됨)을 세 폭으로 생성해 실측 — 3개
  폭 전부 3개 버튼 한 줄 유지, 라벨 잘림 없음, horizontal overflow
  없음 확인. 단, 이는 실제 브라우저 창 리사이즈를 통한 검증이 아니라
  사용자 실기기 검수를 대체하지 않는다.
- production 배포 후 실측(6개 표본 중 대표 단지)으로 제목/카드형
  탭/선택 상태/3개 탭 전환/기존 콘텐츠(대중교통·광역교통·생활편의·
  학군)가 정상임을 확인.
- 별도로 발견된 `/map` PC hover 상세보기 사라짐 문제는 이번 STEP과
  무관해 코드를 건드리지 않고 문서의 "다음 STEP 후보"로만 기록
  (MAP-FIX).

서비스 코드 변경:

수정 `src/app/apt/[name]/apt-client.tsx`(제목/탭 마크업),
`src/app/apt/[name]/detail.module.css`(탭 스타일 재정의). 신규 파일
없음. API route/컴포넌트 로직/DB/schema/migration 변경 없음.

DB 변경:

없음.

최종 판단:

기능 변경 없이 탭의 시각적 존재감과 선택 상태만 개선했다. 정적
검증(tsc/eslint/build) 전부 통과, 회귀 없음을 코드 근거와 브라우저
실측으로 확인했다. 모바일 실측은 iframe 격리 테스트로 대체했으며
실기기 검수를 완전히 대체하지 않는다는 점을 명시했다.

상태:

APT DETAIL STEP 48 구현 완료 / commit·push 완료 / production 반영
확인(2026-08-18).

## 2026-08-18

### MAP-FIX STEP 49 — 지도 마커/바텀시트 상세보기 hover 해제 버그 수정

작업:

`/map`(PC)에서 아파트 마커에 마우스를 올리면 하단에 바텀시트가
나타나지만, "상세보기"를 누르려고 마우스를 그쪽으로 옮기면 hover가
풀리며 시트가 사라지는 버그를 수정했다. STEP48에서 발견되어 별도
이슈로만 기록해 뒀던 것을 이번 STEP에서 조사·수정했다. 상세는
docs/development/49-map-marker-detail-hover-fix.md 참고.

핵심 결과:

- 원인: `selectedMarkerId` 하나를 hover(`onMouseEnter`/`onMouseLeave`)
  와 click이 공유 — hover가 이미 값을 세팅해 시트가 뜨고, 마우스가
  마커(바텀시트와 DOM상 분리된 `position: fixed` 영역)를 벗어나는
  순간 곧바로 지워졌다. 부가적으로 hover 때문에 "첫 클릭은 카드 표시,
  재클릭 시 이동"이라는 기존 설계 의도도 실제로는 작동하지 않고
  있었다.
- 수정: `hoveredMarkerId`(hover 전용) state를 신설하고
  `selectedMarkerId`는 click 전용으로 좁혔다. 파생값
  `activeMarkerId = selectedMarkerId ?? hoveredMarkerId`를 바텀시트
  내용/마커 강조 표시에 공통으로 사용해, 클릭으로 고정된 선택은 hover
  변화와 무관하게 유지된다.
- `onMouseEnter`/`onMouseLeave`는 `hoveredMarkerId`만, `onClick`은
  `selectedMarkerId`만 건드리도록 분리 — 상세 URL 생성 로직, 바텀시트
  UI, 지도 검색, 하단 nav는 전혀 건드리지 않았다.
- PC 7개 시나리오(hover 표시/click 고정/마우스 이동 유지/상세보기
  이동/X 닫기/다른 마커 교체/빈 곳 클릭 해제) 전부 localhost
  브라우저로 실측 통과 — 특히 "마우스를 마커에서 상세보기 버튼까지
  이동해도 시트 유지"를 스크린샷으로 직접 확인.
- 모바일은 `onMouseEnter`/`onMouseLeave`가 터치에서 발생하지 않고
  `onClick` 로직을 한 글자도 수정하지 않아 코드 근거로 회귀 없음을
  확인(직접 탭 재현은 하지 않음).

서비스 코드 변경:

수정 `src/app/map/page.tsx` 1개 파일만. 다른 컴포넌트/API
route/ApartmentAutocomplete/Header/MapBottomNav는 무수정.

DB 변경:

없음.

최종 판단:

hover(미리보기)와 click(고정) 상태를 분리해 PC에서 "상세보기"를
안정적으로 클릭할 수 있게 했다. 상세 URL/검색/바텀시트 UI/하단
nav는 전혀 건드리지 않았고, 정적 검증(tsc/eslint/build) 전부
통과했다. commit/push는 하지 않았다. 사용자 검수 후 진행한다.

상태:

MAP-FIX STEP 49 구현 완료 / 사용자 검수 대기(2026-08-18).

## 2026-08-18

### STEP 50 — 아파트 상세페이지 V1 CLEANUP

작업:

기능 추가가 아니라 상세페이지를 V1 출시 가능한 상태로 정리했다.
production 코드를 처음부터 끝까지 다시 읽어 항상 비어 있는
placeholder와 완전 중복 UI만 최소 범위로 숨겼다. 상세는
docs/development/50-apartment-detail-v1-cleanup.md 참고.

핵심 결과:

- **평면도(FloorPlanPanel)**: 데이터 소스 자체가 없어 항상 "준비 중"만
  노출 — 호출 제거(컴포넌트 파일은 보존).
- **'단지정보' 퀵버튼**: `/api/apt/[name]/info` 코드를 읽어 aptInfo가
  가질 수 있는 키가 세대수/총주차대수/용적률/건폐율 4개뿐임을 확인,
  이미 상시 노출 중인 AptSpecGrid와 100% 중복임을 검증 후 버튼만 제거.
- **'커뮤니티 시설' 퀵버튼**: DB 직접 조회로 communityFacilities
  coverage 0/31 재확인, 버튼만 제거.
- **1구역 커뮤니티 배너**("실거주민 이야기가 궁금하다면?"): 4구역
  CommunityPreview 헤더와 완전 동일한 글쓰기/더보기 CTA 중복 — 실제
  글 목록까지 보여주는 CommunityPreview 쪽만 남기고 제거.
- **학군 "학년별 학생수 추이"/"특목고 진학률" placeholder 2개**,
  **주거환경 "계절별 평균 관리비" placeholder**(추가 발견, 학군
  placeholder와 동일 성격): 전부 데이터 소스 자체가 없어 항상 "준비
  중"만 노출 — 카드 제거.
- 단지 브리핑(`apt-brief.ts`)은 코드로 재검토 후 **유지, 수정 없음** —
  규칙 기반(LLM 아님), 소표본 왜곡 방지 로직 이미 적용, Chart/Metrics
  원시 수치와 다른 합성 해석 문장을 제공함을 확인.
- STEP49 최종 채팅 보고서의 `activeMarkerId` 중복 표기는 실제 코드/
  문서 어디에도 없는 채팅 메시지 단순 오타로 확인, 코드 수정 없음.
- 4개 대표 단지(대신푸르지오1차/명륜아이파크1단지/엘지메트로시티3/
  거래 0건인 고원3단지아파트)로 회귀 검증 — Hero/Chart/Metrics/빠른
  검색/생활정보 3탭/모달 전부 정상. 고원3단지아파트에서 이번 STEP과
  무관한 기존 동작(거래 0건 시 Hero 가격이 "조회 중..."에 멈춤)을
  발견했으나 범위 밖이라 손대지 않고 기록만 함.

서비스 코드 변경:

수정 `src/app/apt/[name]/apt-client.tsx`,
`src/components/SchoolDistrictPanel.tsx`,
`src/components/LivingEnvironmentPanel.tsx` (3개 파일). 컴포넌트 파일
자체(FloorPlanPanel.tsx 등)와 API route/schema/migration은 무수정.

DB 변경:

없음.

최종 판단:

조사 결과 항상 비어 있던 6개 UI 요소만 정리했고 나머지는 이미 실제
데이터 또는 정직한 empty state로 잘 처리되고 있어 상세페이지는 V1
LOCK이 가능하다고 판단했다.

commit/push:

commit `fec4e3a`("feat: finalize apartment detail v1"), push 완료.
production 4개 표본단지(대신푸르지오1차/명륜아이파크1단지/
엘지메트로시티3/고원3단지아파트)에서 평면도·단지정보·커뮤니티시설·
커뮤니티 배너·학군 placeholder·관리비 placeholder가 전부 미노출됨을
재확인했다.

**APT DETAIL V1 = LOCKED.** 상세는
docs/development/50-apartment-detail-v1-cleanup.md의 LOCK 섹션 참고.
다음 큰 개발 단계는 MAIN UI / HOME UX.

상태:

APT DETAIL STEP 50 구현 완료 / commit·push 완료 / production 반영
확인 / **V1 LOCKED**(2026-08-18).

## 2026-08-18

### MAIN UI-A / STEP 51 — 홈(HOME) UX 전수점검 및 V1 설계

작업:

APT DETAIL V1 LOCK 이후 다음 개발 영역인 홈(HOME) UX를 조사·설계만
했다(구현 없음). production code 미수정, commit/push 없음. 상세는
docs/development/51-main-home-ui-audit.md 참고.

핵심 결과:

- 현재 홈(`home-client.tsx`)은 검색창이 하나뿐이며 무조건 AI 검색
  (`/ai-search`)으로만 연결된다 — 정확한 아파트명을 아는 사용자도
  LLM 해석 단계를 강제로 거쳐야 한다는 것이 가장 큰 문제로 확인됨.
  "최근 본 단지"/"재개발·분양" 진입점도 홈 본문에 없음.
- **핵심 발견**: 상세페이지 UI-C1의 `ApartmentQuickSearch.tsx`가
  이름 검색+최근 본 단지+오매칭 방지 검증까지 이미 전부 구현해
  둔 상태라, 홈에 재배치하는 데 **신규 API/DB/매칭 로직이 전혀
  필요 없음**을 코드 확인으로 검증.
- AI 검색(`ai-search-client.tsx`, Gemini 3-intent)은 삭제하지 않고
  "조건으로 집 찾기" Secondary CTA로 역할만 재배치하는 방향으로
  설계 — 로직 무수정.
- 하단 nav(`Header.tsx`) 아이콘은 전부 이모지이며 SVG 아이콘
  라이브러리가 프로젝트에 전혀 설치돼 있지 않음(확인 완료) —
  `lucide-react` 도입을 후보로 제시하되 이번 STEP에서 설치하지 않음.
  "재개발·분양" 라벨은 iframe 격리 테스트(360/375/390px)로 실측한
  결과 overflow/줄바꿈은 없었으나 다른 라벨 대비 2.4~5배 넓어 시각
  불균형이 있음을 확인, 라벨 축약을 후속 STEP 후보로 기록.
- 광고 슬롯 2곳은 `NEXT_PUBLIC_ADS_ENABLED=false`라 현재 완전
  비활성(빈 placeholder조차 없음)임을 코드로 확인 — 문제 없음.
- 구현을 MAIN UI-B1(검색 Hero 재구성)/MAIN UI-B2(탐색 섹션+하단nav
  정리) 2개 STEP으로 분리 제안. 둘 다 신규 API/DB/schema 불필요.

서비스 코드 변경:

없음. 문서만 작성(`docs/development/51-main-home-ui-audit.md` 신규,
이 CHANGELOG 항목).

DB 변경:

없음.

최종 판단:

홈 개편은 새 기능을 만드는 게 아니라 이미 존재하는 자산
(ApartmentQuickSearch/AI검색/지도)의 역할과 배치만 재정리하면 되는
것으로 확인됐다. BLOCKER 없음. commit/push는 사용자 승인 후 별도
STEP에서 진행한다.

상태:

MAIN UI-A / STEP 51 조사·설계 완료 / 사용자 승인 대기(2026-08-18).


## 2026-08-18

### MAIN UI-B1 / STEP 52 — 홈 Search Hero + 빠른 탐색 + 최근 본 단지

작업:

STEP 51 설계대로 홈의 Primary를 AI 검색에서 일반 아파트 이름 검색으로
재구성했다. 상세는 docs/development/52-main-home-search-hero.md 참고.

핵심 결과:

- 신규 `src/components/HomeApartmentSearch.tsx`: `ApartmentAutocomplete`를
  그대로 재사용하고, 선택 시 상세 이동 전 실거래 검증은
  `ApartmentQuickSearch.tsx`의 `handleSelect`와 동일한 방식을 홈 전용으로
  새로 작성. `ApartmentQuickSearch` 자체는 상세페이지 모달 전제
  (popstate="닫기" 흉내) 컴포넌트라 홈에 그대로 붙이면 사용자가 누르지
  않은 뒤로가기를 소모하는 회귀가 생겨 재사용하지 않음 — 상세페이지
  LOCK 대상 파일은 전혀 수정하지 않았다.
- 검색 선택 즉시 상세 이동 확인(`대신푸르지오1차` 등, 브라우저 실측).
- AI 검색(`ai-search-client.tsx`)은 로직 무수정, "조건으로 집 찾기"
  버튼이 기존 `/ai-search` 페이지(자체 검색창+추천 프롬프트 3개 보유)로
  연결되도록 역할만 Secondary로 재배치.
- "지도에서 찾기" CTA 추가, 기존 핵심 Quick 메뉴의 "지도 검색" 큰
  카드는 중복이라 제거(`bigCards` grid를 auto-fit으로 변경해 카드 1개일
  때도 자연스럽게 채워지도록 함).
- "최근 본 단지" 섹션 신규: 기존 `recent-apartments.ts`
  (`ejip:recentApartments`, 최대 8개 저장)를 그대로 재사용, 홈에는
  최근 5개만 가로 스크롤 카드로 노출. 가격 등 추가 API 호출 없음.
  없으면 섹션 자체를 렌더하지 않음(빈 상태 확인 완료).
- 신규 API/DB/schema 없음.
- 정적 검증(tsc/eslint/next build) 전부 통과. 브라우저로 CASE A~G
  전부 확인(모바일 360/375/390은 `resize_window` 도구가 이 환경에서
  실제 창 크기를 바꾸지 못해 iframe 격리 기법으로 우회 검증) — overflow,
  긴 단지명 잘림, 하단 nav 겹침 전부 없음.

서비스 코드 변경:

- 수정: `src/app/home-client.tsx`, `src/app/home-client.module.css`
- 신규: `src/components/HomeApartmentSearch.tsx`

DB 변경:

없음.

최종 판단:

홈 Primary를 검색으로 재구성하는 목표를 기존 자산(ApartmentAutocomplete/
recent-apartments/AI검색/지도) 재사용만으로 달성했다. 상세페이지 V1
LOCK을 건드리지 않았고 회귀 위험이 있던 지점(ApartmentQuickSearch의
popstate 로직)은 재사용하지 않고 별도 구현으로 피했다. BLOCKER 없음.

상태:

MAIN UI-B1 / STEP 52 구현 완료 / 사용자 모바일 검수 대기 / commit·push
하지 않음(2026-08-18).


## 2026-08-18

### MAIN UI-B2 / STEP 53 — Home Explore Section + Header + Bottom Navigation UI 정리

작업:

B1(STEP 52) Search Hero 기능은 전혀 건드리지 않고, 그 아래 홈 탐색
영역과 Header/Bottom Navigation의 이모지 중심 UI를 동일한 SVG line
icon system으로 정리했다. 상세는
docs/development/53-main-home-b2-navigation.md 참고.

핵심 결과:

- `lucide-react` 신규 설치(런타임 의존성 없는 무료 오픈소스 아이콘
  라이브러리, React 19 공식 지원 확인 후 설치 — CLAUDE.md의 "유료
  API/생성형 AI 의존성 확대 금지" 원칙과는 무관). 하단 nav 5개 +
  Explore bigCard 2개 + iconGrid 6개 + B1 hero 2개 + 검색 아이콘 1개,
  총 14곳의 이모지를 전부 교체.
- Header: 홈(`pathname === '/'`)일 때만 뒤로가기 버튼을 숨기도록
  수정(다른 모든 페이지는 조건에 안 걸려 기존 동작 100% 유지, 상세
  페이지로 실측 확인). active 메뉴 색상을 이집 그린으로 통일
  (데스크톱은 기존에 active 스타일 자체가 없던 버그였음).
- 신규 `src/lib/bottom-nav-items.tsx`: 하단 nav 5개 항목(아이콘 +
  active 판정)을 한 곳에 모았다. `Header.tsx`와
  `src/app/map/page.tsx`의 `MapBottomNav`(지도 페이지는 Header를
  렌더링하지 않아 별도로 존재하던 컴포넌트, 코드 확인으로 발견)가
  이 설정을 공유 — "재개발·분양" 탭 active 판정을 `/presales`까지
  포함하도록 넓혀 두 곳 모두에 동일하게 반영했다.
- 홈 "핵심 Quick 메뉴" → "시장 둘러보기"로 개명(실제 항목 구성이
  전부 시장/통계 성격이라는 판단), 큰 카드에 "재개발·분양"을 신규
  추가(B1에서 B2로 명시적으로 이관해 둔 항목).
- B1 기능(일반검색/지도 CTA/AI CTA/최근 본 단지) 전부 재검증 통과.
  APT DETAIL V1 관련 파일 무수정. NextAuth 기존 오류는 이번 STEP
  범위에서 완전히 제외.
- 정적 검증(tsc/eslint/next build) 전부 통과. 모바일
  360/375/390/430px + PC 전부 확인, overflow/라벨 잘림/safe-area
  문제 없음.

서비스 코드 변경:

- 수정: `package.json`, `package-lock.json`, `src/app/home-client.tsx`,
  `src/app/home-client.module.css`, `src/components/Header.tsx`,
  `src/components/Header.module.css`,
  `src/components/HomeApartmentSearch.tsx`, `src/app/map/page.tsx`
- 신규: `src/lib/bottom-nav-items.tsx`

DB 변경:

없음.

최종 판단:

B1 Search Hero 기능을 유지하면서 홈 탐색 영역과 전역 Bottom
Navigation의 시각적 일관성을 확보했다. 이모지→SVG 전환은 새 패키지
1개(런타임 비용 없음) 추가로 해결했고, 큰 리팩터 없이 5줄 안팎의
공용 설정 파일 하나로 Header/`/map` 중복을 통합했다. BLOCKER 없음.

상태:

MAIN UI-B2 / STEP 53 구현 완료 / 사용자 및 ChatGPT 검수 대기 /
commit·push 하지 않음(2026-08-18).


## 2026-08-18

### STEP 54 — Presales Production 500 원인 조사

작업:

STEP 53 배포 검수 중 재발견된 production `/api/presales` 500의 원인을
조사만 했다(코드 변경 없음). 상세는
docs/development/54-presales-production-500.md 참고.

핵심 결과:

- **root cause 확정**: Supabase Session Pooler(`pool_size: 15`) 동시
  세션 한도 초과(`FATAL: (EMAXCONNSESSION)`). 이미 존재하는 관측 기능
  (STEP 21에서 추가한 `ErrorLog` 테이블)을 읽기 전용으로 조회해 실제
  예외 스택트레이스 5건을 확보했고, 진단 스크립트 자체도 같은 오류로
  1회 거부되는 것을 라이브로 재현했다.
- [STEP 20(INFRA I1)](./20-infra-db-connection-analysis.md)이
  "구조적 위험(MEDIUM), 로그 없어 확정 불가"로 남겨둔 바로 그 후보가
  이번에 확정 원인으로 격상됨 — DATABASE_URL이 서버리스 비권장 방식인
  Session Pooler(포트 5432)를 사용하고 `connection_limit`/`DIRECT_URL`이
  미설정인 구조는 STEP 20 이후 변경된 적 없음을 재확인.
- STEP 53의 `lucide-react` 설치/package-lock 정규화와는 무관함을
  확인(Prisma 버전 불변, lucide-react 런타임 의존성 0개, 오류 최초
  관측 시각이 STEP 53 코드 배포보다 앞섬).
- schema mismatch 아님(쿼리에 쓰이는 필드 전부 schema와 일치),
  코드 버그 아님(로컬에서 항상 정상), 데이터 문제 아님 — 순수
  connection 용량 문제.
- 부하가 낮아진 시점(로컬 dev 서버 종료 후) 재확인한 production은
  200으로 정상 회복 — "지금 안 터진다"이지 "고쳐졌다"가 아님. 근본
  원인이 남아있는 한 동시 접속이 늘면 재발한다.
- 해결에는 `DATABASE_URL`(Vercel 환경변수) 및/또는
  `prisma/schema.prisma`(`directUrl`) 변경이 필요 — STEP 54 승인
  범위(코드 전용 수정) 밖이라 실행하지 않고 STOP, 사용자 승인 대기.

서비스 코드 변경:

없음. 문서만 작성(`docs/development/54-presales-production-500.md`
신규, 이 CHANGELOG 항목). 진단용 임시 스크립트는 조사 직후 삭제(git
추적 대상 아니었음).

DB 변경:

없음(읽기 전용 조회만 수행).

최종 판단:

Production `/api/presales` 500의 root cause를 확정했다. 해결에는
DB 연결 구조(Supabase Pooler 종류/`connection_limit`/`DIRECT_URL`)
변경이 필요하며, 이는 STEP 20에서도 이미 "별도 승인 필요"로 분류해
둔 항목이다. 사용자 승인 없이 변경하지 않았다. BLOCKER로 유지.

상태:

STEP 54 원인 조사 완료 / 코드 미수정 / 구조 변경 사용자 승인
대기(2026-08-18). commit `8d9f388`로 push 완료.


## 2026-08-18

### STEP 55 — Production DB Pooling Fix (조사·설계만, 변경 미실행)

작업:

STEP 54 root cause(Supabase Session Pooler 세션 한도 초과)의 해결책을
실행하려 했으나, 실제 적용에 필요한 Vercel 접근 권한이 이 세션에 없어
**목표 설정까지만 완료하고 코드/환경변수 변경 없이 STOP**했다. 상세는
docs/development/55-production-db-pooling-fix.md 참고.

핵심 결과:

- 목표 구조 확정: `DATABASE_URL`을 기존과 동일 호스트에서 포트만
  `5432`(Session Pooler) → `6543`(Transaction Pooler)로 바꾸고
  `pgbouncer=true`, `connection_limit=1` 파라미터를 추가. 이 변경만으로
  충분함을 코드 조사로 확인 — `DIRECT_URL`/`prisma/schema.prisma`
  변경은 불필요(이 프로젝트는 migration을 Vercel 빌드가 아니라 로컬에서
  수동 실행하는 구조라 production 런타임에 Direct connection이 필요한
  경로가 없음).
- **BLOCKER 2로 STOP**: 이 세션에는 Vercel CLI/링크/토큰이 전혀 없어
  production 환경변수를 직접 읽거나 쓸 방법이 없다. 값을 추측해
  적용하지 않았고, 사용자가 토큰을 전달해도 대신 입력하지 않는다(자격
  증명 처리 금지 원칙).
- 착수 시점 baseline 측정 중 **presales 외에 `/api/community/recent-activity`
  (무관한 별도 Prisma 쿼리)도 동시에 500**임을 추가로 확인 — DB
  connection pool 압박이 presales 국소 문제가 아니라 시스템 전역
  진행 중임을 뒷받침, 시급성이 이전 판단보다 높음.
- 코드/schema/migration/Supabase 설정 전부 무변경.

서비스 코드 변경:

없음. 문서만 작성(`docs/development/55-production-db-pooling-fix.md`
신규, 이 CHANGELOG 항목). connection string 값은 어디에도 기록하지
않음.

DB 변경:

없음.

최종 판단:

해결책 자체는 저위험·저범위(환경변수 1개, 코드 무변경)로 설계
완료했으나, 실행 권한이 없어 적용하지 못했다. 사용자가 Vercel
대시보드에서 직접 값을 바꾸거나, 이 세션에 Vercel 접근을 연결해주면
즉시 진행 가능한 상태다. BLOCKER로 유지.

상태:

STEP 55 설계 완료 / 변경 미실행 / commit·push 하지 않음(문서만,
환경변수 변경 자체가 없어 이번 STEP은 커밋 대상 아님)(2026-08-18).


## 2026-08-18

### STEP 55 (재검증) — Transaction Pooler 적용 후 Production 검증 → 실패

작업:

사용자가 Vercel Production `DATABASE_URL`을 Transaction Pooler(6543)로
직접 변경하고 redeploy를 완료했다고 알려와, 코드/설정을 전혀 건드리지
않고 production을 재검증만 했다. 상세는
docs/development/55-production-db-pooling-fix.md의 "적용 후 검증 결과"
참고.

핵심 결과 — **검증 실패**:

- `GET /api/presales?page=1` 5회(3초 간격) 전부 500(기대: 5/5 200).
  응답시간 5.17s로 이전 관측(0.75~1.1s 정상 구간)보다 크게 느림.
- `/api/community/recent-activity`도 여전히 500.
- `/api/apt/[name]`(다른 Prisma API)은 계속 200 정상 — 전면 장애는
  아님.
- production `/presales` UI도 "분양정보를 불러오지 못했습니다." 그대로.
- **실제 예외 확인 실패**: `ErrorLog` 재조회를 시도했으나 로컬
  진단 스크립트 자체가 3회(약 30~40초) 모두
  `FATAL: (EMAXCONNSESSION) ... pool_size: 15`로 거부됨 — 로컬은
  변경 대상이 아니었던 Session Pooler를 그대로 쓰므로, 이는 **Session
  Pooler pool이 지금도 계속 가득 차 있다는 뜻**. Vercel이 실제로
  Transaction Pooler를 쓰고 있는지, redeploy가 새 값을 반영했는지는
  이 세션에서 확인할 방법이 없어(Vercel/Supabase 대시보드 접근 없음)
  확정하지 못했다.
- 문제를 발견한 상태에서 스스로 고치려 하지 않았다 — env 재변경/코드
  변경 전부 없음. NextAuth 기존 오류는 범위 밖으로 유지, 변경 없음
  확인.

서비스 코드 변경:

없음. `docs/development/55-production-db-pooling-fix.md`에 검증 결과
섹션만 추가, 이 CHANGELOG 항목 추가.

DB 변경:

없음(읽기 전용 조회 시도만, 그마저도 pool 포화로 실패).

최종 판단:

Transaction Pooler 전환이 production에서 아직 효과를 보이지 않고
있다. 코드/스키마 쪽 원인은 이미 배제됐으므로, 다음 확인은 전부
Vercel(환경변수 실제 저장값·redeploy 반영 여부·Function Logs)과
Supabase(Connection Pooling 대시보드) 쪽에서만 가능하다 — 둘 다 이
세션 접근 밖이다. BLOCKER로 유지.

상태:

STEP 55 재검증 완료 / 여전히 실패 / 원인 미확정 / 사용자 확인
필요(Vercel·Supabase 대시보드) / commit·push 하지 않음(2026-08-18).


## 2026-08-18

### STEP 55 (최종) — DB Connection Pooling Fix 해결 확인

작업:

사용자가 Transaction Pooler connection string에 남아있던
`[YOUR-PASSWORD]` placeholder를 실제 DB 비밀번호로 교체하고 다시
redeploy했다. 코드/설정을 전혀 건드리지 않고 production을 재검증했다.
상세는 docs/development/55-production-db-pooling-fix.md의 "최종 결과"
참고.

핵심 결과 — **해결 확인**:

- `GET /api/presales?page=1` 5회(3초 간격) **전부 200**, `success:true` +
  실제 데이터(1,046건). 응답 3.1~3.3s로 안정적(이전 정상 구간
  0.75~1.1s보다는 느리나 `connection_limit=1`의 예상된 트레이드오프,
  timeout/오류 아님).
- `/api/community/recent-activity` 3회 전부 200.
- 기존 정상 API(`/api/apt/[name]` 실거래)와 추가로 선정한 Prisma API
  (`/api/presales/[id]` 상세) 모두 200 정상 — 다른 기능 회귀 없음.
- production UI를 실제 사용자 flow(홈→재개발·분양→"분양·청약" 탭→
  "분양정보 전체 보기")로 확인, 카드 20건 정상 렌더 + pagination
  "1/53" 정상.
- `ErrorLog`(`/api/presales`, `/api/community/recent-activity`) 재조회
  결과 신규 항목 0건 — 이전 실패 라운드(06:45:38, id=9)보다도 이전
  기록이 마지막이며, `EMAXCONNSESSION`/prepared statement/password
  인증 오류 전부 신규 발생 없음. 브라우저 콘솔도 기존 NextAuth 오류
  외 신규 오류 없음.
- **1차 시도(포트만 6543으로 전환) 때 여전히 500이었던 이유가 이번에
  확정됨**: pooler 종류 전환 자체는 맞았으나, connection string의
  `[YOUR-PASSWORD]` placeholder가 실제 비밀번호로 교체되지 않아 인증
  단계에서 계속 실패하고 있었다. STEP 54의 원래 root cause(Session
  Pooler 세션 한도 초과)도 실재했던 문제로 문서에 그대로 보존한다 —
  이번 확인으로 대체되는 것이 아니라, "구조 문제 → 1차 전환 실패
  원인 → 최종 해결"의 3단계 모두 실제로 있었던 사실이다.

서비스 코드 변경:

없음. `docs/development/55-production-db-pooling-fix.md`에 "최종
결과"/"최종 정리" 섹션 추가, 이 CHANGELOG 항목 추가. connection
string/password는 어디에도 기록하지 않았다.

DB 변경:

없음(읽기 전용 조회만 수행).

최종 판단:

STEP 54에서 확정한 root cause(Session Pooler 세션 한도 초과)가
Transaction Pooler + `pgbouncer=true` + `connection_limit=1` + 정상
자격증명 조합으로 해결됐음을 production에서 직접 검증했다.
코드/schema/migration/데이터는 전 과정에서 무변경. BLOCKER 해제.

상태:

STEP 55 완료 / production 정상 확인 / commit·push 하지
않음(2026-08-18).


## 2026-08-18

### BRAND STEP 56-A — D안 기준 브랜드 시스템 적용 설계

작업:

D안(메인 `이집`/보조 `e-jip`/슬로건 "복잡한 부동산, 이집으로 쉽게"/
이집 Green/캐릭터 `이집이`) 확정에 따라, 실제 코드베이스 전수조사를
바탕으로 브랜드 적용 위치·역할 분리·로딩/empty/error 노출 전략을
설계했다. 이미지 자산 제작·코드 적용은 없음(STEP 56-B/57로 분리).
상세는 docs/development/56-brand-system-application-plan.md 참고.

핵심 결과:

- **`FullPageLoader` 컴포넌트가 이미 브랜드 로딩 UI로 존재**함을
  확인(`🏢 이집` pulse 텍스트 + spinner, `ai-search`/상세/지도 3곳
  재사용 중) — 신규 컴포넌트를 만들지 않고 이를 확장하는 방향으로
  설계.
- 약 20개 파일에 걸친 기존 empty/error 문구를 전수조사한 결과, 이미
  하나의 톤(정직·담백·과장 없음, CLAUDE.md 4/13번 원칙과 일치)으로
  수렴돼 있음을 확인 — 새 톤을 만드는 게 아니라 이 톤 위에 이집이
  캐릭터를 "상태 기반으로만" 얹는 방향으로 설계.
- 로고(정체성)/심볼(compact branding)/이집이(서비스 안내자, 상태
  기반 등장) 3단 역할 분리 정의. "화면마다 캐릭터를 다 띄우지 않기"
  원칙을 이 구조로 구현.
- **Brand Voice / '이집 언어 시스템' 정의** — 브랜드명 '이집'과 일상어
  '이 집'의 중의성을 UX copy에 선택적으로 활용. 정보형/브랜드형/
  캐릭터형 3단계 copy 체계를 정의하고, 커뮤니티·검색/추천·loading/
  empty 상태별 적용 후보 문구를 정리. 실거래·대출·정책 등 신뢰 중심
  영역에서는 언어유희를 절제하는 원칙을 확정(기존 error 문구 담백
  톤 유지 결론과 일치).
- AI 검색 분석 대기(`ai-search-client.tsx`)를 이집이 최우선 적용
  지점으로 확정(이미 `FullPageLoader` 사용 중이라 문구/아이콘 교체만
  필요).
- 스켈레톤 로딩(상세/통계)과 error/retry는 브랜드 캐릭터를 넣지 않고
  현재의 무채색·신뢰감 우선 톤을 유지하기로 설계(10번 디자인 원칙:
  신뢰감 > 귀여움).
- STEP 57 적용을 A(최우선: Header 로고, FullPageLoader 정식화, AI
  분석 대기, 공통 empty 1종)/B(상세 LOCK 준수 하 적용, 분양/재개발/
  통계)/C(추후 기능 연계) 3단계로 분리.
- APT DETAIL V1 관련 파일은 조사만 하고 전혀 수정하지 않음.

서비스 코드 변경:

없음. 문서만 작성(`docs/development/56-brand-system-application-plan.md`
신규, 이 CHANGELOG 항목). 이미지 자산/파비콘/metadata 무변경.

DB 변경:

없음.

최종 판단:

D안 브랜드를 로고(정적 정체성)와 이집이(상태 기반 안내자)로 역할을
분리해, 기존에 이미 잘 작동하던 로딩/empty/error 구조(FullPageLoader,
일관된 문구 톤) 위에 최소 침습으로 얹는 설계를 확정했다. 새로 만들어야
할 것은 이미지 자산과 일부 문구 교체뿐이다. BLOCKER 없음.

상태:

BRAND STEP 56-A 설계 완료 / production code 무수정 / 사용자 검수
대기 / commit·push 하지 않음(2026-08-18).


## 2026-08-18

### BRAND STEP 56-B2 — D안 개발용 브랜드 자산 패키지화

작업:

D안 브랜드를 실제 Next.js 코드에서 재사용 가능한 구조로 패키지화했다.
Home/Header/상세 등 실제 화면은 변경하지 않았다. 상세는
docs/development/56-brand-assets.md 참고.

핵심 결과:

- 신규 `src/components/brand/BrandLogo.tsx`/`BrandSymbol.tsx`(+
  각 `.module.css`) — `variant`/`tone`/`size`/`ariaLabel` 최소 API.
  실제 로고·심볼 벡터 자산이 없어 텍스트 워드마크/이니셜 모노그램으로
  렌더링(이것이 "임시"가 아니라 자산 도착 전까지의 실제 운영 상태임을
  문서에 명시).
- `src/app/globals.css`에 D안 컬러 토큰(`--ejip-green` 등 6개)을
  **추가 전용**으로 삽입 — 기존 `--primary-color`(#03c75a, 원본
  코드 주석에 "네이버 그린"이라고 명시돼 있음을 확인) 값은 바꾸지
  않음. 전역 변수 값 교체는 즉시 전체 화면에 영향을 주는 "실제 UI
  적용"이라 이번 STEP 범위 밖으로 판단, `--primary-color` 유지 vs
  `--ejip-green` 전환은 시각 검수 후 STEP 57-A 이후 결정 사항으로
  남김.
- `public/brand/mascot/README.md` 신규 — 이집이 7개 포즈 파일명 규칙/
  포맷(WebP, 투명배경, 1024px 원본, 200KB 상한)/우선순위 정의. 실제
  이미지 파일은 생성하지 않음(AI 시각화 보드 시안을 그대로 crop해
  쓰지 않는다는 원칙 준수).
- Typography 조사 결과 Pretendard가 이미 `globals.css` 1번째 줄
  CDN import로 로드 중임을 확인 — 신규 폰트 설치 없음.
- favicon(`src/app/favicon.ico`) 유효성만 확인(정상 ICO 바이너리),
  변경하지 않음 — 심볼 아트웍이 placeholder뿐이라 지금 바꾸면 엉성한
  아이콘을 확정하는 셈이라 판단.
- Brand Voice 코드화(`brandCopy.*`)와 `EjipyPose` 타입 정의는 YAGNI
  판단으로 미생성 — 소비할 컴포넌트(FullPageLoader 확장 등)가 아직
  코드에 없어, 실제 소비처가 생기는 STEP 57-A에서 함께 정의하기로
  함.
- **BLOCKER로 보고**: 로고 벡터 워드마크, 심볼 벡터 마크, 이집이
  마스코트 일러스트(7개 포즈) 전부 미제작. 컴포넌트 인프라는 지금
  바로 쓸 수 있지만 "완성된 그래픽 자산이 들어간 최종 로고/심볼/
  캐릭터"는 이 자산들이 나올 때까지 STEP 57-A에서도 적용 불가.

서비스 코드 변경:

- 수정: `src/app/globals.css`(컬러 토큰 추가만, 기존 값 무변경)
- 신규: `src/components/brand/BrandLogo.tsx`,
  `src/components/brand/BrandLogo.module.css`,
  `src/components/brand/BrandSymbol.tsx`,
  `src/components/brand/BrandSymbol.module.css`,
  `public/brand/mascot/README.md`,
  `docs/development/56-brand-assets.md`(이 문서)
- Header/Home/상세/지도/AI검색 UI: 무변경(신규 컴포넌트를 아직 어느
  화면에도 연결하지 않음)

DB 변경:

없음.

정적 검증:

`npx tsc --noEmit` 통과, `npx eslint src/components/brand/*.tsx`
통과(0 errors), `npx next build` 통과(기존 30개 라우트 그대로,
회귀 없음). `package.json`/`package-lock.json` 무변경(신규 의존성
없음).

최종 판단:

D안 브랜드를 코드에서 즉시 재사용 가능한 컴포넌트/토큰 구조로
준비했다. 실제 시각 자산(벡터 로고/심볼/마스코트 일러스트)은 디자인
작업이 필요해 이번 STEP 범위 밖이며, 사용자 승인 없는 자산을
production에 확정하지 않는다는 원칙에 따라 BLOCKER로 남긴다.

상태:

BRAND STEP 56-B2 완료 / 컴포넌트·토큰 준비 완료 / 그래픽 자산
BLOCKER / 실제 화면 미적용 / commit·push 하지 않음(2026-08-18).


## 2026-08-19

### STEP 56-B3 FINAL — Brand Asset Validation

작업:

- 사용자가 제작한 브랜드 원본 자산 24종(logo 6 / icon 7 / mascot 7 /
  illustration 3 / og 1) 검수. 실제 원본 위치는 작업지시서가 가정한
  `C:\Users\123\Downloads\`가 아니라 `D:\다운로드\이집 로고
  아이콘\`(+ 하위 `ejip_icon_sizes\`)이었음을 확인.
- `brand-source/{logo,icon,mascot,illustration,og}/`에 24종 전부
  올바르게 분류돼 있었고, md5 비교로 원본과 100% 일치함을 검증.
- 원본 폴더에서 24종 외 이상 파일 3종 발견: `ejip-asspp-icon-512.png`
  (symbol.png의 오타 중복본, md5 동일), 최상위
  `ejip-app-icon-512.png`(알파 없는 잘못된 버전, `ejip_icon_sizes/`
  안의 올바른 버전과 이름만 같고 실제로는 다른 파일), ChatGPT 원시
  생성 이미지 3개 — 전부 brand-source에 반입하지 않음(정상 처리
  확인).
- Pillow로 24종 전체 이미지 metadata(해상도/mode/alpha) 검사, icon
  7종 사이즈 정확성 확인(512/192/180/96/48/32/16 전부 일치).
- 투명배경 검수: alpha extrema로 "진짜 투명" 여부 확인 — 필수
  16종 중 15종 PASS, `ejip-logo-mono-white.png` 1종만 alpha
  채널이 노이즈로 손상(픽셀 34.6%가 중간값 alpha, 흰 로고를 흰
  배경에서 배경제거하다 실패한 전형적 패턴)되어 REWORK 판정.
- 로고 6종/심볼/앱아이콘/파비콘/마스코트 7종/일러스트 3종/OG를
  전부 직접 렌더링해 시각 검수 — horizontal/mono-green/mono-dark는
  플랫 스타일로 일관되나 vertical만 3D 글로시 스타일이라 불일치
  기록. 마스코트 7종은 캐릭터 요소(지붕/창문/눈/볼/목도리/배지/
  장화) 전부 일관됨을 확인, guide 포즈만 캔버스 크기가 다르고
  empty와 표정·자세가 유사해 구분이 약함을 기록.
- 파일 용량 검수: logo 중 vertical/mono-green, mascot 중 loading이
  권장 상한 초과 — SOURCE_ONLY로 분류(WebP 변환 후 반입 권장).
  OG 이미지는 표준 1.91:1과 비율이 달라 1200x630 파생 필요로 기록.
- `docs/development/56-brand-assets-validation.md` 신규 작성(40개
  항목 상세 검수 리포트).

production code 변경:

없음. `brand-source/` 외 어떤 파일도 수정하지 않음.

DB 변경:

없음.

알려진 문제 / BLOCKER:

- BLOCKER 없음. mono-white 1종만 REWORK 필요(전체 진행을 막지
  않음).
- STEP 57-A 실제 UI 적용 전 mono-white 재작업 여부와 vertical
  로고의 3D 스타일 처리 방향을 사용자 확인 필요.

상태:

BRAND STEP 56-B3 FINAL 완료 / 24종 중 23종 APPROVED·SOURCE_ONLY,
1종 REWORK / production 미적용 / commit·push 하지 않음(2026-08-19).


## 2026-08-19

### STEP 57-A — 브랜드 실제 UI 1차 적용

작업:

- B3에서 APPROVED된 자산 중 mono-white(alpha 손상)와 vertical(3D
  글로시, horizontal/mono 계열과 스타일 불일치)을 제외하고 사용자
  결정대로 logo 4종(horizontal/symbol/mono-green/mono-dark) +
  icon 7종 + mascot 7종만 production으로 편입.
- `public/brand/{logo,icon,mascot}/` 생성. logo/mascot는
  `brand-source/`의 1254px/2172px 원본을 Pillow로 리사이즈
  (logo 900px 폭, symbol 512px, mascot 800px 장변) 후 WebP
  quality 88로 재인코딩(24~81KB/파일, 기존 mascot README가 정한
  200KB 상한 이내). icon 7종은 이미 정확한 타깃 사이즈라 PNG
  그대로 복사.
- 이 프로젝트가 `next/image`를 쓰지 않고 `<img>` 태그를 그대로
  쓰는 기존 패턴이라(전체 코드베이스 확인), 새 브랜드 이미지도
  동일하게 `<img>`로 적용 — 새 의존성/패턴 추가 없음.
- `src/components/Header.tsx`: 텍스트 워드마크(`{siteConfig.name}`)
  대신 `ejip-logo-horizontal.webp` 적용. `aria-label`/`alt`로
  접근성 유지, 데스크톱 30px/모바일 24px 높이로 반응형 처리.
  `hideLogo`가 없는 모든 페이지(apt 상세 포함)에 일관 적용됨 —
  상세페이지는 자체 구조를 건드리지 않고 공통 컴포넌트 변경으로
  간접 반영된 것이라 V1 LOCK 위반 아님.
- `src/app/layout.tsx`: `metadata.icons`에 favicon 16/32/48 +
  app-icon 96/192/512(icon) + app-icon 180(apple) 연결.
  `src/app/favicon.ico`는 `ejip-favicon-48.png` 기반으로
  16/32/48 멀티 사이즈 ICO로 재생성(기존 플레이스홀더 심볼 대체) —
  파일 자체를 삭제하지 않고 Next.js favicon 파일 컨벤션 경로를
  그대로 유지하며 내용만 교체.
- `src/components/FullPageLoader.tsx`: 펄싱하던 "🏢 이집" 텍스트를
  `ejipy-loading.webp`(부드러운 float 애니메이션, CSS만)로 교체.
  스피너/메시지 prop은 그대로 유지. 이 컴포넌트를 쓰는 3곳
  (ai-search, apt 상세, map) 전부에 공통 반영됨 — apt 상세의 기본
  메시지("스마트한 아파트 분석을 준비 중입니다...")는 실거래 도메인
  문구라 판단해 텍스트는 바꾸지 않고 비주얼만 교체(V1 LOCK 준수).
- `src/app/ai-search/ai-search-client.tsx`: 로딩 메시지를 "이집이가
  조건에 맞는 이집을 찾고 있어요."로, 결과 없음 문구를
  `ejipy-empty` 이미지 + "찾는 이집이 아직 없어요. 검색 조건을
  조금 바꿔보세요."로 교체(둘 다 이 파일 자체의 문구라 Brand
  Voice 적용 허용 범위).
- `src/app/home-client.tsx`: hero 영역에 `ejipy-default`(56px)
  인사 캐릭터 추가(태그라인 "복잡한 부동산, 이집으로 쉽게"는
  기존 그대로 유지). "최근 본 단지" 섹션을 `recent.length === 0`일
  때 완전히 숨기던 것에서, `ejipy-empty` + "아직 본 이집이 없어요.
  관심 가는 단지를 둘러보세요." empty state로 항상 노출되도록 변경.
- "검색 결과 없음"(스코프 판단): `ApartmentAutocomplete.tsx`는
  /map·/stats·apt 상세에서도 재사용되는 공유 컴포넌트라 이번
  STEP에서 손대지 않음(V1 LOCK 인접 리스크 회피) — Home 자체
  검색의 "정확히 연결하지 못했습니다" 문구도 좁은 예외 케이스라
  기존 텍스트 유지. "검색 결과 없음"은 AI 검색 결과 없음(위)으로
  충족.
- OG 이미지(`ejip-og-main.png`)는 지시대로 이번 STEP에서
  metadata에 연결하지 않음(1200x630 파생 필요, 별도 STEP).
  illustration 3종도 아직 소비하는 화면이 없어 production에
  넣지 않음(불필요한 미사용 자산 방지).
- `BrandLogo`/`BrandSymbol`(STEP 56-B2 placeholder 컴포넌트)은
  아무 곳에서도 import되지 않은 상태를 확인 — Header는 이 추상화를
  거치지 않고 직접 `<img>`를 썼다(기존 코드베이스 패턴과의 일관성
  우선). 두 컴포넌트는 여전히 텍스트 placeholder로 남아있음, 이후
  재사용처가 생기면 그때 실물 자산으로 교체 검토.
- `.gitignore`에 `brand-source/` 추가(14MB 원본은 로컬 보관,
  production 자산인 `public/brand/`만 추적).
- `public/brand/mascot/README.md` 갱신 — 실제 파일 도착 및 적용
  현황 반영.

시각 검수(로컬 dev, `localhost:3000`):

- 데스크톱 `/`: 로고/hero 캐릭터/최근 본 단지 정상 렌더링,
  console 에러 없음.
- 모바일 375px(iframe 격리 기법 — 이 환경은 `resize_window`가
  실제 뷰포트를 바꾸지 못함, 기존에 기록된 이슈): 로고 24px에서도
  선명, 잘림/겹침 없음, 검색바·퀵액션 버튼 정상.
- `/ai-search` 결과 없음 검색어 실행: `FullPageLoader`
  (ejipy-loading + 신규 메시지) → `ejipy-empty` 결과없음 카드까지
  전체 흐름 확인.
- `localStorage`의 `ejip:recentApartments` 임시 삭제 후 Home
  재방문: "최근 본 단지" empty state(ejipy-empty + 카피) 정상
  노출 확인.
- apt 상세페이지(`/apt/대신롯데캐슬`) 진입: `FullPageLoader`
  비주얼만 바뀌고 레이아웃/차트/탭 등 기존 구조 100% 그대로,
  Header도 back 버튼+새 로고+검색 아이콘이 모바일 폭에서 겹침
  없이 정상 표시.
- `/map` 정상, Header 미노출 페이지라 영향 없음.

production code 변경:

- 수정: `src/app/layout.tsx`, `src/components/Header.tsx`,
  `src/components/Header.module.css`,
  `src/components/FullPageLoader.tsx`,
  `src/components/FullPageLoader.module.css`,
  `src/app/home-client.tsx`, `src/app/home-client.module.css`,
  `src/app/ai-search/ai-search-client.tsx`,
  `src/app/ai-search/ai-search-client.module.css`,
  `src/app/favicon.ico`(바이너리 재생성), `.gitignore`
- 신규: `public/brand/logo/*.webp`(4), `public/brand/icon/*.png`
  (7), `public/brand/mascot/*.webp`(7)
- Map/AI 검색 로직, apt 상세 구조, DB 접근 코드는 무변경.

DB/schema/migration 변경:

없음.

정적 검증:

`npx tsc --noEmit` 통과(0 errors). `npx eslint` 대상 5개 변경
파일 통과(0 errors — ai-search-client.tsx에 무관한 기존
warning 1건 있으나 이번 변경과 무관, react-hooks/exhaustive-deps
가 전역 off라 예전 disable 주석이 unused로 잡히는 것). `npx next
build` 통과, 기존 30개 라우트 그대로 회귀 없음.

알려진 문제:

- illustration 3종, mascot 3종(search/analyze/guide), OG는
  자산만 배치/보류 상태이고 아직 어떤 화면도 소비하지 않음 —
  다음 STEP에서 연결 필요.
- favicon 16px 식별성은 B3에서 "조건부 PASS"로 남겨둔 상태 그대로
  (이번 STEP은 simplified variant를 새로 만들지 않음, 지시사항
  범위 밖).
- 모바일 실기기 확인은 아직 못함(iframe 격리로 대체 확인).

상태:

BRAND STEP 57-A 완료 / logo 4·icon 7·mascot 3포즈(default·loading·
empty) 실제 화면 적용 / mascot 4(search·analyze·guide·error)·
illustration·OG는 자산만 배치 / DB·APT DETAIL V1 구조 무변경 /
commit·push 하지 않음(2026-08-19).
