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


## 2026-08-19

### STEP 57-B — 이집이 기능별 역할 연결 + Brand Voice 2차 적용

작업:

- 실제 사용처를 `rg`로 전수 조사(추측 없이 진행) 후, 남아있던
  mascot 4종(search/analyze/guide/error)을 아래처럼 실제 상태와
  연결:
  - `ejipy-search` → AI 검색 페이지의 "질문 대기"(idle) 상태 —
    기존에도 존재하던 `!loading && !error && !result` 분기를
    그대로 재사용, 새 상태/로직 추가 없음. 검색결과-없음 상태
    (`ejipy-empty`, STEP 57-A)와 시각적으로 구분됨.
  - `ejipy-analyze` → AI 브리핑 라벨의 🤖 이모지를 대체(18px
    인라인 아이콘). 라벨 텍스트("AI 브리핑")는 구조적 레이블이라
    바꾸지 않음 — 없는 분석을 과장하는 문장을 새로 만들지 않음.
  - `ejipy-guide` → `/redevelopment`의 "준비 중" 카드 이모지
    (🏢/🏗️) 대체, `/community/write` 상단에 안내 문구
    ("이집에서 살아본 이야기를 들려주세요.") + 아이콘 신규 추가.
  - `ejipy-error` → `/map`의 지도 로드 실패 전체화면 에러(제목
    위에 아이콘만 추가, 원인 문구·재시도 버튼은 그대로),
    `/presales` API 실패 상태(아이콘 추가, 에러 메시지 그대로
    주정보 유지).
  - `ejipy-empty` → `/community`(전체 글목록) 빈 목록,
    `/presales` 조건에 맞는 분양정보 없음 — 2곳 신규 추가.
- Brand Voice(커뮤니티): `CommunityPreview.tsx`(APT DETAIL
  V1 페이지에 내장되지만 지시서가 "CommunityPreview 문구"만
  명시적으로 허용) 제목을 단지명 12자 이하일 때만
  `"{단지명}, 이집 어때요?"`로, 빈 목록 문구를
  `"이집에 대해 궁금한 점을 남겨보세요. 첫 글을 기다리고
  있어요!"`로 교체. **이미지(마스코트)는 추가하지 않음** —
  V1 LOCK이 "새로운 mascot 영역 추가"를 명시적으로 금지해서,
  이 컴포넌트에는 문구만 바꾸고 아이콘은 넣지 않았다(1차 구현
  때 실수로 넣었다가 지시서 재확인 후 되돌림).
- Map의 레이어별 "준비 중" 토스트(`COMING_SOON_MESSAGE`,
  지도 위에 떠 있는 작은 pill 배너)는 **마스코트를 넣지 않기로
  판단**했다 — 캐릭터를 넣기엔 배너가 너무 작고, 지도 콘텐츠
  위에 뜨는 요소라 "map viewport를 가리지 않아야 한다"는
  지시와 상충할 위험이 있어 텍스트만 유지.
- illustration 3종(search/analyze/cheer)은 **이번 STEP에서도
  사용하지 않음** — mascot 아이콘으로 이미 채워진 자리(AI 검색
  idle/브리핑)에 "mascot와 illustration을 동시에 넣지 않는다"는
  원칙에 따라 중복 배치하지 않았고, 그 외에 카드/온보딩 등
  illustration이 자연스럽게 들어갈 명확한 신규 지점을 찾지
  못해 "억지로 모두 사용하지 않는다"는 지시대로 보류.
- Brand Voice 노출량 점검: 화면마다 동시에 보이는 "이집" 계열
  텍스트가 최대 1~2개를 넘지 않는지 확인(예: apt 상세
  커뮤니티 구역은 제목+빈상태 문구 합쳐 최대 2개, 둘은 동시에
  보이지 않는 경우가 대부분).
- `--primary-color`(#03c75a) 무변경, 전체 green 일괄 전환 없음.
- OG metadata 연결/favicon simplified variant 제작 없음(지시대로
  보류).

production code 변경:

- 수정: `src/app/ai-search/ai-search-client.tsx`,
  `src/app/ai-search/ai-search-client.module.css`,
  `src/components/CommunityPreview.tsx`,
  `src/app/community/page.tsx`,
  `src/app/community/page.module.css`,
  `src/app/community/write/page.tsx`,
  `src/app/community/write/page.module.css`,
  `src/app/map/page.tsx`,
  `src/app/presales/presales-client.tsx`,
  `src/app/presales/page.module.css`,
  `src/app/redevelopment/redevelopment-client.tsx`,
  `src/app/redevelopment/redevelopment.module.css`
- 신규 파일 없음(STEP 57-A에서 이미 배치한 mascot 자산만
  재사용).
- API 구조, 검색 알고리즘, 지도 로직, 실거래 로직, DB/schema/
  migration은 무변경.

APT DETAIL V1:

- `CommunityPreview.tsx` 문구만 변경(카드 구조/데이터/순서
  무변경, 새 mascot 영역 추가 없음). 공통 컴포넌트
  (`FullPageLoader`)는 STEP 57-A와 동일하게 간접 반영.

정적 검증:

`npx tsc --noEmit` 통과(0 errors). 변경 파일 전체 `npx eslint`
통과(0 errors — ai-search-client.tsx의 기존 무관 warning 1건
동일하게 존재). `npx next build` 통과, 기존 30개 라우트 회귀
없음.

로컬 시각 검수(`localhost:3000`, PC + 375px 모바일 iframe 격리):

- AI 검색: idle(`ejipy-search`) → 실제 검색 실행 →
  브리핑(`ejipy-analyze` 아이콘) → 카드 결과, 흐름 전체 확인.
- `/community`: AuthGate 로그인 모달 닫은 후 빈 목록
  (`ejipy-empty`) 확인.
- `/community/write`: 안내 문구+아이콘 정상 노출.
- apt 상세(`/apt/대신롯데캐슬`): "대신롯데캐슬, 이집 어때요?"
  제목 + 빈 목록 문구(아이콘 없음) 확인, 카드 구조/차트 등
  기존 그대로.
- `/redevelopment`: `ejipy-guide` 아이콘으로 두 탭(분양·청약/
  재개발) 모두 정상 렌더링.
- `/presales`: 실데이터 1,046건 정상 표시(회귀 없음). empty/
  error 브랜치는 코드 리뷰 + 동일 패턴(다른 페이지에서 이미
  검증됨)으로 확인, 실제 0건/에러 조건 재현은 하지 않음.
- console 에러 없음 확인.

알려진 문제:

- presales의 empty/error 상태는 실제 데이터로 재현해 시각
  확인하지 못함(코드 검토로만 확인) — 향후 재현 가능하면
  확인 권장.
- map "준비 중" 토스트, illustration 3종은 이번 STEP에서
  의도적으로 미적용(위 사유 참고) — 필요 시 별도 STEP에서
  재검토.
- OG 1200x630 파생, favicon simplified variant는 계속 backlog.

상태:

BRAND STEP 57-B 완료 / mascot 7종 전체 실제 화면 연결 완료
(search·analyze·guide·error 신규) / illustration 3종·OG는
계속 보류 / APT DETAIL V1·DB/schema/migration 무변경 /
commit·push 하지 않음(2026-08-19).


## 2026-08-19

### STEP 57-C — 브랜드 마무리(OG/Metadata/자산 정리/BRAND CLOSE)

작업:

- OG 이미지 1200x630 production 자산 생성: 원본
  `brand-source/og/ejip-og-main.png`(1672x941, B3 APPROVED)을
  Pillow로 결정론적 가공(새 이미지 생성 AI 호출 없음) — 폭
  1200px로 비율 유지 리사이즈 후 675→630px 상하 center-crop
  (각 22~23px, 원본에서 콘텐츠 없는 여백 부분만 해당함을 육안
  확인). JPEG quality 88, 108.4KB(<500KB 권장 통과).
  `public/brand/og/ejip-og-main-1200x630.jpg`로 저장.
- Open Graph/Twitter metadata 연결: `src/app/layout.tsx`의
  root `openGraph.images`를 새 파일로 교체 + 신규
  `metadata.twitter`(`summary_large_image`, 같은 이미지 재사용)
  추가. `src/config/site.ts`의 `buildOpenGraph()`(14개 페이지가
  공유하는 헬퍼)도 동일 경로로 교체해 홈/AI검색/통계/분양/
  재개발/학교/커뮤니티/약관 등 전 페이지에 일괄 반영.
  `src/components/KakaoShareButton.tsx`의 카카오톡 공유 이미지
  URL도 동일 경로로 교체(기존 `window.location.origin` 기반
  클라이언트 안전 패턴은 그대로 유지, 경로 문자열만 변경).
  title/description은 변경하지 않음(SEO 전체 개편 아님).
- 기존 `public/og-image.png`(2026-08-10 생성, "이집(e-zip)"
  오탈자 + 파란 배경의 구브랜드 placeholder였음을 확인) — 이제
  어디서도 참조하지 않지만 임의 삭제 금지 원칙에 따라 파일
  자체는 삭제하지 않고 보존.
- favicon 16px 최종 판정: **KEEP**. 16x16 원본을 nearest-neighbor
  로 확대해 픽셀 단위로 직접 검사 — 노란 창문 등 세부 디테일은
  뭉개지지만 초록 배경+흰 실루엣의 색상·형태 대비는 유지돼
  브라우저 탭 구분이라는 실용적 목적은 충족한다고 판단, 새
  simplified variant를 제작하지 않음.
- illustration 3종(search/analyze/cheer): 자연스러운 사용처를
  계속 찾지 못해 **RESERVED**로 최종 기록(`public/`에 반입하지
  않고 `brand-source/`에만 유지). mono-white/vertical logo는
  각각 원인 분석 완료 상태로 **DEFER** 확정(재작업하지 않음,
  실제 소비처가 생기면 그때 결정론적 방식으로 재생성 권장).
- `docs/development/57-brand-rollout-final.md` 신규 작성 —
  STEP 56~57 전체를 아우르는 BRAND CLOSE 문서(ACTIVE/RESERVED/
  DEFER 자산 목록, Brand Voice 실사례, APT DETAIL V1/DB 영향
  요약, 향후 확장 원칙 6가지).

production code 변경:

- 수정: `src/app/layout.tsx`(openGraph.images 경로 교체 +
  twitter 필드 신규), `src/config/site.ts`(buildOpenGraph
  images 경로 교체), `src/components/KakaoShareButton.tsx`
  (공유 이미지 경로 교체)
- 신규: `public/brand/og/ejip-og-main-1200x630.jpg`,
  `docs/development/57-brand-rollout-final.md`
- Home/AI Search/Community/Map/Presales/Redevelopment/Apt
  Detail UI, 검색 알고리즘, API, primary-color: 전부 무변경
  (이번 STEP은 metadata + asset finalization + 문서화만).

APT DETAIL V1 / DB:

무변경(이번 STEP은 코드 3개 파일 전부 metadata/공유 URL
문자열 교체뿐, 상세페이지 자체는 건드리지 않음). DB/schema/
migration 무변경.

정적 검증:

`npx tsc --noEmit` 통과(0 errors). 변경 파일(`layout.tsx`,
`site.ts`, `KakaoShareButton.tsx`) `npx eslint` 통과(0 errors).
`npx next build` 통과, 기존 30개 라우트 회귀 없음.

알려진 문제:

- `public/og-image.png`(구버전, 미참조)는 정리하지 않고 보존
  — 필요 시 사용자 확인 후 별도로 삭제 검토.
- favicon simplified variant, mono-white/vertical logo 재작업은
  전부 DEFER 상태로 backlog에 남아있으나 현재 BLOCKER 아님.

상태:

BRAND STEP 57-C 완료 / OG 1200x630 production 자산 생성 및
Open Graph·Twitter·Kakao 공유 metadata 전체 연결 / favicon
16px KEEP 판정 / illustration RESERVED, mono-white·vertical
DEFER로 최종 정리 / BRAND CLOSE 문서 작성 / APT DETAIL V1·
DB/schema/migration 무변경 / commit·push 하지 않음(2026-08-19).

**BRAND ROLLOUT (STEP 56~57) CLOSE.** 다음부터는 이집 핵심
기능 개발로 복귀.


## 2026-08-19

### STEP R1 — 재개발 데이터 소스 검증

작업:

- `/redevelopment` 및 관련 Prisma 스키마(`RedevelopmentProject`,
  `RedevelopmentStage`) 현재 상태 재확인 — 실데이터 연동 없는
  정직한 placeholder임을 확인, 기존 코드 주석("전국 통합 공공데이터
  없음")을 실제 데이터로 재검증.
- 후보 A(국토부_전국 도시정비사업 통합 데이터, data.go.kr ID
  15160169): 파일 데이터(CSV) 1,566건, 7개 컬럼(주소/좌표 없음,
  진행단계·유형·시행자는 숫자 코드형), 갱신주기 연간. 브라우저로
  미리보기 6건 실제 확인(강원 속초시/원주시). 부산 포함 여부는
  전체 파일 미다운로드로 미확정.
- 후보 B(전국재개발재건축정비사업표준데이터, ID 15155703,
  `tn_pubr_public_redevelopment_reconstruction_project_api`):
  기존 `DATA_GO_KR_API_KEY`로 실제 호출 시도 → HTTP 403
  `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`(이 API 별도 활용신청
  미승인). 페이지 명세로 제공기관 9개(안산/진주/인천/군포/부산
  3개구/대구서구/충주)만 확인 — "전국" 표방과 달리 실제 커버리지
  매우 좁음, 사용자가 사전에 우려한 "제공기관 수 8~9건" 실측
  확인됨.
- 후보 C(부산광역시 정비사업 정보 API,
  `MaintenanceBusinessStatus1/getMaintenanceBusiness1`): 동일 키로
  실제 호출 성공(HTTP 200, totalCount 343, 343건 전수 수신).
  23개 필드 전수 확인, 진행단계(`step`) distinct 12종 실측 확보
  (기존 Prisma enum 6단계보다 세분화됨), 사업유형은 공식 필드
  없이 areaName 접미사로만 추정(재개발171/재건축67/가로주택정비56/
  소규모재건축49). 좌표 필드 없음, location 필드 78%만 채워지고
  현장주소/조합사무실주소가 섞여 형식 불일치.
- **중요 발견**: 부산 API(343건) 전체를 raw grep했으나 "서구"
  문자열이 단 한 건도 없음 — 그런데 외부 검색(서구청 게시판,
  부동산 정보 사이트)으로 아미동·서대신4구역 등 서구의 실제
  재개발 사업 존재를 확인함. 이집 초기 타깃 지역인 서구가 부산
  API에서 통째로 누락된 데이터 품질 문제로 판단, 원인은 미확정
  (R2에서 재확인 필요).
- 3개 후보 비교표(전국 커버리지/업데이트 주기/재개발재건축 구분/
  주소/좌표/진행단계/세대수/시공사/조합/구역면적/용적률/건폐율/
  이미지/관리기관/데이터기준일/API 제공 여부) 작성.
- Master 후보 판단: **후보 A = 전국 존재-확인용 Master 후보**
  (유일한 진짜 전국 데이터, 다만 얕음), **후보 C = 부산 상세
  보강 후보**(필드 풍부, 다만 서구 누락 이슈 재확인 필요), 후보
  B는 커버리지 부족 + API 미승인으로 후순위.
- `docs/development/R1-redevelopment-data-source-audit.md` 신규
  작성.

DB/schema/migration 변경:

없음(Prisma schema, migration 전혀 건드리지 않음).

UI 변경:

없음(`/redevelopment` 화면, 카드, 필터 무변경).

API Key:

`DATA_GO_KR_API_KEY`(.env.local) 존재 확인 — 값은 어디에도
노출하지 않음. 후보 C에서 정상 동작, 후보 B에서는 별도 활용신청
필요 상태(403)로 구분 기록. Busan/Redevelopment 전용 별도 키
없음(data.go.kr 공용 키 구조).

알려진 문제 / BLOCKER:

하드 BLOCKER 없음. 소프트 제약 3가지: (1) 후보 B API 미승인,
(2) 후보 A의 부산 포함 여부 미확정(전체 CSV 다운로드 필요),
(3) 부산 API 서구 데이터 누락(원인 미상) — 전부 R2 권장사항으로
문서에 기록.

상태:

STEP R1 완료 / 재개발 데이터 소스 3종 실측 비교 완료 / Master
후보(국토부 전국 통합) + 부산 상세보강 후보(부산시 API) 판단 /
DB/schema/migration·UI 무변경 / commit·push 하지 않음(2026-08-19).


## 2026-08-19

### STEP SHARE-1 — Kakao Share UX(R1과 무관한 독립 STEP)

작업:

- `KakaoShareButton.tsx` 조사 결과: `Kakao.Share.sendDefault()`
  Feed 템플릿(content.title/description/imageUrl + content.link +
  buttons[].link) 자체는 이미 URL을 텍스트에 직접 넣지 않는
  구조였음을 확인. 실제 원인은 `handleShare()`가
  `navigator.share()`를 최우선으로 시도하던 것 — 모바일에서 OS
  공유 시트가 뜨고 사용자가 거기서 카카오톡을 선택하면, OS가
  title+text+url을 이어붙인 일반 텍스트로 카카오톡에 넘겨 채팅창에
  긴 URL이 그대로 보이는 구조였다(코드 리뷰로 확인, 브라우저
  자동화 환경 특성상 실제 카카오톡 수신 화면은 확인 못함).
- `handleShare()` 우선순위 재정렬: **카카오 SDK(Feed 템플릿) →
  navigator.share() → 클립보드 복사** 순으로 변경. SDK는 마운트
  시점에 이미 로드/초기화돼 있어(`sdkReadyRef`) 클릭 시 await 없이
  동기 호출 — 기존에 이미 해결해둔 "팝업 차단" 문제를 재발시키지
  않음. 마운트 직후 클릭처럼 SDK가 아직 준비 안 된 극히 드문
  경우에만 navigator.share()로 폴백(기존에 있던 "SDK를 await로
  재시도" 경로는 그 자체가 팝업 차단 위험을 안고 있어, 이미 더
  안전한 대안(navigator.share)이 있으므로 제거 — 실제 폴백 기능은
  그대로 유지, 위험한 재시도 경로만 뺌).
- 공유 CTA 버튼 텍스트를 "이집에서 단지정보 보기" →
  "이집에서 자세히 보기"로 통일.
- Apt Detail의 공유 title/description을 `page.tsx`의
  `generateMetadata`(SEO/OG)와 동일한 문자열 공식으로 통일
  (`${aptName} 실거래가·시세 - ${siteConfig.name}` /
  `${aptName}의 실거래가, 시세 변동 추이, 평형별 거래 내역을
  확인하세요.`) — 기존에 별도로 작성돼 있던 문구를 대체.
  `imageUrl`은 이미 STEP 57-C의 `/brand/og/ejip-og-main-1200x630.jpg`
  를 쓰고 있어 변경 없음.
- 공유 버튼(compact variant, Apt Detail Hero 우측 — 실제로
  production에서 렌더되는 유일한 variant) 가시성 강화:
  `KakaoShareButton.module.css` 신규 생성, 흰 배경+얇은 테두리의
  작은 pill → `var(--ejip-green)` 배경 + 흰 텍스트 + `lucide-react`
  `Share2` 아이콘(신규 의존성 설치 없이 기존 패키지 사용) + "공유하기"
  텍스트로 교체. hover(`--ejip-green-deep`)/active(살짝 축소)/
  focus-visible(아웃라인) 상태 추가, `min-height: 44px`로 모바일
  터치영역 확보. 아파트명(1.35rem, 800)·가격(더 큼)보다는 작게
  유지해 과하게 튀지 않도록 함.
  아이콘엔 `aria-hidden="true"`, 텍스트가 항상 보이므로 별도
  aria-label은 추가하지 않음(중복 방지).
  전체(non-compact, 카카오 옐로) variant는 현재 어디서도 렌더되지
  않는 코드라 로직만 우선순위 변경 영향을 받고, 시각 디자인은
  카카오 브랜드 옐로를 유지(별도 CSS 클래스로만 정리).
- 영향 범위 확인: `KakaoShareButton`을 사용하는 곳은
  `apt-client.tsx` 한 곳뿐(다른 페이지 없음) — 컴포넌트 변경이
  다른 화면에 영향을 주지 않음.

APT DETAIL V1:

Hero 영역의 `KakaoShareButton` 렌더 결과(모양)만 바뀌고, 레이아웃
(`.heroTop` 등 `detail.module.css`)·카드 구조·데이터·탭·순서는
전혀 건드리지 않음. `apt-client.tsx`에서 변경한 것은 import 1줄
추가(`siteConfig`)와 `KakaoShareButton`에 넘기는 title/description
문자열 2줄뿐.

R1 문서 보호:

`docs/development/R1-redevelopment-data-source-audit.md`는 이번
STEP에서 전혀 수정하지 않음(내용 확인만).

정적 검증:

`npx tsc --noEmit` 통과(0 errors). 변경 파일
(`KakaoShareButton.tsx`, `apt-client.tsx`) `npx eslint` 통과
(0 errors — apt-client.tsx에 무관한 기존 warning 1건, 이 STEP과
무관한 위치·원인 확인). `npx next build` 통과, 기존 30개 라우트
회귀 없음.

로컬 검증(`localhost:3000/apt/대신롯데캐슬`):

- `window.Kakao.Share.sendDefault`를 몽키패치해 실제 클릭 시
  전달되는 payload를 캡처 — title/description이 SEO 문구와
  정확히 일치, imageUrl이 OG 이미지 경로, `content.link`/
  `buttons[0].link` 모두 현재 페이지 URL(lawdCd/dong 쿼리스트링
  포함)과 정확히 일치, 버튼 타이틀 "이집에서 자세히 보기" 확인 —
  URL 문자열이 title/description 어디에도 섞여 있지 않음을
  직접 확인.
- PC + 375px + 430px(iframe 격리) 전부 확인 — 버튼 줄바꿈/잘림/
  overflow 없음, 아파트명·가격과 시각적 충돌 없음.
- console 에러 없음.
- Kakao JS SDK 키(`NEXT_PUBLIC_KAKAO_MAP_API_KEY`) 존재 확인,
  실제 SDK 로드·초기화(`Kakao.isInitialized() === true`)까지
  확인 — BLOCKER 아님.

알려진 문제:

- 실제 카카오톡 앱에서의 최종 수신 화면은 이번 STEP(브라우저
  자동화 환경)에서 확인하지 못함 — payload 캡처로 데이터 정확성은
  검증했으나, 사용자가 실기기로 한 번 확인하는 것을 권장.

상태:

STEP SHARE-1 완료 / Kakao 공유 우선순위 재정렬로 긴 URL 노출
경로 제거 / 공유 버튼 E-jip Green + Share2 아이콘으로 가시성
강화 / SEO 문구 재사용으로 title·description 통일 / APT DETAIL
V1 구조·데이터, R1 문서, DB/schema/migration 무변경 / commit·push
하지 않음(2026-08-19).


## 2026-08-19

### STEP R2 — 재개발 데이터 실물 검증

작업:

- 국토부_전국 도시정비사업 통합 데이터(data.go.kr ID 15160169)
  실제 CSV를 공식 다운로드 흐름을 그대로 재현해(URL 추측 없이
  `selectFileDataDownload.do` → `check-limit.json`(캡차 필요
  여부 확인, 실제로는 불필요) → `fileDownload.do`) 확보. CP949
  인코딩, 1,566행·7컬럼(R1과 정확히 일치, 숨은 컬럼 없음 확정).
  프로젝트 밖 임시 디렉터리에만 저장, 저장소에 commit하지 않음.
- 전국 17개 시도 전부 포함 확인(서울 41%·경기 15%·부산 14.5%
  순), 부산 227건·서구 20건 확정 — R1의 "부산 포함 여부 미확정"
  항목 해결.
- 부산 서구 목록 20건 전수 확보, 그중 "서대신4"가 이미 착공
  단계임을 확인 — R1이 외부 검색으로 확인했던 실존 사례와 일치.
- 부산광역시 정비사업 API를 동일 키로 재호출(read-only,
  totalCount 343으로 R1과 동일, 변경 없음).
- **R1 결론 정정**: R1은 부산 API 원문에 "서구" 문자열이 0건이라
  "부산 API가 서구를 누락한다"(판정 C)고 결론지었으나, R2에서
  국토부 확정 서구 20건 이름을 정규화해 부산 API와 대조하자
  7건이 실제로 일치했다(동대신1/2, 부민2/3, 서대신4/5/6). 원인은
  부산 API가 구(區) 단위 지명을 전혀 쓰지 않고 법정동 단위
  지명만 쓰기 때문(판정 B로 정정) — 데이터 누락이 아니라 R1의
  검증 방법(구 이름 문자열 검색)의 한계였음을 실측으로 확인.
- 국토부-부산 전체 이름 정규화 매칭: 정확 일치 129건, 국토부만
  80건, 부산API만 194건. 대표 14건 수동 검증에서 국토부가
  "5)주거환경개선/2)정비구역지정/세대수0"으로 기록한 4건이
  부산 API에서는 훨씬 진행된 단계·다른 유형·실제 세대수로
  나타나는 반복 패턴을 발견 — 국토부 데이터(연간 갱신)가 실제
  진행 상황보다 뒤처져 있을 가능성을 실증으로 뒷받침(원인은
  확정하지 못함).
- 국토부 사업유형 코드(1~5) 확인, 부산 API의 "가로주택정비"·
  "소규모재건축"(343건 중 31%)에 대응하는 국토부 코드가 아예
  없음을 확인 — 국토부 데이터가 "도시정비법" 사업만 다루고
  "소규모주택정비법" 사업은 정의상 범위 밖이기 때문으로 판단.
  국토부를 Master로 쓰면 이 카테고리가 구조적으로 빠짐.
- 국토부 진행단계 코드(2,3,4,5,6,7,17 — 1과 8~16은 현재 데이터에
  없음)와 부산 12종 실측값을 현재 Prisma `RedevelopmentStage`
  (6단계)와 대조 — 추진위원회구성 등 실사용 빈도 높은 단계 누락,
  준공/해제/조합해산 등 종료 상태 표현 불가, RELOCATION_DEMOLITION
  은 실데이터 어디에도 없는 값임을 확인 → **SCHEMA_REVIEW_REQUIRED**
  로 기록(스키마는 변경하지 않음).
- 기존 Kakao 지오코딩 재사용 가능성 확인: 클라이언트
  (`Geocoder().addressSearch()`, 4곳 기존 사용)와 서버(REST
  `search/address.json`, 2곳 기존 사용, `geocode-apt.ts`에 KA/
  Origin 헤더 우회 패턴 이미 문서화)를 그대로 재사용 가능 —
  새 지오코딩 서비스 연동 불필요.
- polygon 후보(VWorld 등) 가볍게 조사, 전국 통합 Master 존재
  여부는 확정하지 못함(R3 이후 과제로 기록).
- `docs/development/R2-redevelopment-data-validation.md` 신규
  작성.

DB/schema/migration 변경:

없음(Prisma schema, migration 전혀 건드리지 않음).

UI 변경:

없음.

API Key:

기존 `DATA_GO_KR_API_KEY`로 부산 API read-only 재호출만 수행,
값은 노출하지 않음. 국토부 CSV는 로그인/키 불필요(공식 페이지
안내 확인).

알려진 문제 / BLOCKER:

하드 BLOCKER 없음. unresolved 5건(주거환경개선 패턴 원인, 서구
13건 미매칭 원인, VWorld polygon 레이어 확정, Kakao 호출량 한도
정량평가, 이름매칭 오탐률)을 문서에 기록, 전부 R3 권장사항으로
정리.

상태:

STEP R2 완료 / 국토부 CSV 1,566건 전수 검증 / 부산 227건·서구
20건 확정 / 부산 API 서구 누락 원인 재확인 및 R1 결론 정정(판정
C→B) / 국토부↔부산 overlap 분석 및 수동 검증으로 국토부 데이터
최신성 의심 사례 발견 / 사업유형·진행단계 표준화 설계 및
SCHEMA_REVIEW_REQUIRED 기록 / 지오코딩 전략 설계(기존 Kakao
재사용) / DB/schema/migration·UI 무변경 / commit·push 하지
않음(2026-08-19).


## 2026-08-19

### STEP R3A — 재개발 위치·이름매칭·Polygon 파일럿

작업:

- 부산 정비사업 22건(서구 8·타구 12·유형다양성 2, 서대신4/아미1/
  아미3 필수 포함) 파일럿 선정, 국토부/부산API raw field 나란히
  정리.
- 기존 Kakao Local 주소검색 REST(`search/address.json`, `geocode-apt.ts`
  등에 이미 있는 KA/Origin 헤더 패턴 재사용, 새 아키텍처 없음)로
  22건 read-only geocoding 실행: SUCCESS_EXACT 11(50%)/AMBIGUOUS
  1(4.5%)/FAILED 10(45.5%, 전부 location 필드 자체가 없는 케이스).
- **핵심 발견**: 지오코딩 성공 11건 중 9건(82%)의 원본 주소
  텍스트에 "3층"·"호"·상가명 등 사무실 특유의 표시가 있어, 이
  location들이 정비구역 현장이 아니라 조합·추진위 사무실 주소를
  가리킬 가능성이 높음을 실증(R1/R2의 정성적 우려를 구체 비율로
  확인). 반대로 지오코딩 실패한(vicinity 표현 "OO번지 일원")
  케이스들이 오히려 진짜 현장 주소로 추정됨 — 지오코딩 성공률과
  위치 정확도가 반비례하는 역설을 발견.
- 이름 정규화 규칙("재개발/재건축" 접미사 제거 포함) 문서화 후,
  **이 규칙 자체가 오매칭을 만든다는 것을 실증**: 부산API 내부
  충돌 20건 전부가 "거제2 재개발" vs "거제2 재건축"처럼 유형
  접미사 제거로 서로 다른 두 사업이 뭉친 사례.
- 국토부 부산 227건 내부 충돌 16건 발견 — 13/16이 "주거환경개선/
  정비구역지정/세대수0" 스냅샷 행과 "재개발·재건축/진행단계/실제
  세대수" 행이 같은 구역명으로 공존하는 반복 패턴(R2에서 발견한
  "국토부 데이터 최신성 의심"이 국토부 CSV 내부에도 있음을 확인).
  "촉진5"는 금정구·영도구 두 개 다른 구에 동명 존재 — 시군구
  없이 이름만 매칭하면 안 된다는 실제 증거.
- Cross-source 카디널리티(공유 키 129개): 1:1=107(83%)/1:N=7/
  N:1=12/N:N=3 — 17%가 단순 1:1이 아니라 자동 병합 위험.
- match confidence 5단계(EXACT/HIGH/MEDIUM/LOW/UNMATCHED) 설계,
  자동 merge는 EXACT/HIGH만, LOW는 금지로 기준 수립(코드 구현
  안 함).
- 서대신4 재검증(완전 일치: 착공/542세대 양쪽 동일), 아미1/아미3은
  공식 소스(data.go.kr 서구 전용 데이터셋 없음, 부산API 이름
  매칭 없음, location 없음) 기준 좌표 확보 불가로 확정.
- polygon 재조사(VWorld 도시계획정보 카테고리 확인, "정비구역"
  명시적 레이어는 여전히 미확정) — 전국 통합 polygon Master는
  이번에도 발견 못함, POINT_FIRST_OK로 V1/V2 분리 권장.
- `docs/development/R3A-redevelopment-location-matching-pilot.md`
  신규 작성.

DB/schema/migration 변경:

없음.

UI 변경:

없음.

알려진 문제 / BLOCKER:

하드 BLOCKER 없음. unresolved 5건(국토부 내부 중복행의 정확한
원인, 아미1/아미3 좌표 소스 부재, VWorld polygon 레이어 미확정,
Kakao 호출량 한도 미평가, 조합사무실 자동판별 방법 미검증) 기록.

상태:

STEP R3A 완료 / 지오코딩 파일럿 22건 실행 및 "location 성공=
사무실 주소일 위험 82%" 실증 발견 / 이름매칭 위험 규칙(유형
접미사 제거) 실증 확인 및 match confidence 5단계 설계 / 국토부
내부 중복행 패턴 발견 / polygon 미확정이나 POINT_FIRST_OK 판단 /
DB/schema/migration·UI 무변경 / commit·push 하지 않음(2026-08-19).

**R3B_GO** — Master DB Schema 설계 착수 가능 판단.


## 2026-08-19

### STEP R3B — Redevelopment Master DB Schema 설계

작업:

- 기존 `RedevelopmentProject`(단일 테이블, `zoneName` 단일 필드로
  존재 판단)/`RedevelopmentStage`(6단계) 구조와 `upsertRedevelopmentProject()`
  저장 함수(시군구 없이 이름만 봐서 `촉진5`(금정구/영도구 동명
  이인) 같은 사례를 오판할 수 있는 실제 결함 재확인), 호출부
  없음을 코드로 확인.
- **production `RedevelopmentProject` 실제 row 수를 read-only
  count 쿼리로 직접 확인 — 0건.** MIGRATION_RISK 없음으로 결론.
- 설계 원칙 확정: (A) canonical/raw 값 분리, (B) Project와
  SourceRecord를 별도 엔티티로 분리(1:N) — 안 A(2테이블) vs
  안 B(단일테이블 덮어쓰기) 비교 후 안 A 채택(R1~R3A가 반복
  발견한 "두 source 값 불일치"가 안 B를 배제하는 결정적 근거).
- `RedevelopmentBusinessType`(7종: REDEVELOPMENT/RECONSTRUCTION/
  RESIDENTIAL_ENVIRONMENT/SMALL_RECONSTRUCTION/BLOCK_HOUSING/
  OTHER/UNKNOWN), `RedevelopmentStage`(기존 6종 → 14종 재설계,
  국토부·부산 실측 코드 전부 매핑표 작성), `RedevelopmentProjectStatus`
  (ACTIVE/COMPLETED/CANCELLED/UNKNOWN, stage와 분리) 확정.
  `RELOCATION_DEMOLITION`은 실사용 관측값 없음을 재확인하되
  향후 대비 유지, `DISSOLVED`(조합해산)는 완료/좌초 구분 불가
  (대연2 사례: 3,149세대+조합해산 = 완료 후 해산으로 추정되나
  확정 못함)를 이유로 projectStatus=UNKNOWN으로 정직하게 남김.
- identity: Project에 공격적 composite unique를 걸지 않고
  (sido+sigungu+normalizedName) index만 두어 매칭 후보 조회용으로
  쓰고, 실제 병합 판단은 R4 애플리케이션 로직(matchConfidence)의
  책임으로 분리. normalizedName은 안전한 정규화만(유형 접미사
  유지 — R3A 오매칭 실증 반영), matchName 별도 필드는 만들지
  않음(필드 최소화).
- sourceRecordId를 국토부처럼 native id가 없는 source를 위해
  결정론적 fingerprint(source+sido+sigungu+rawName+rawBusinessType,
  stage/세대수 제외)로 설계 — R2에서 발견한 유일한 완전중복 행도
  이 방식으로 안전하게 흡수됨.
- location 안전장치를 스키마 레벨로 명시: `locationType`
  (PROJECT_SITE/OFFICE/APPROXIMATE/UNKNOWN), `locationConfidence`,
  `geocodeStatus` — R3A의 "지오코딩 성공 82%가 사무실 주소 위험"
  발견을 직접 반영, 향후 R4/R6이 이 필드로 위험을 관리하도록
  설계.
- `source`/`geocodeSource` 필드는 enum이 아닌 String으로 설계
  (지역 확장 시마다 migration이 필요한 enum의 확장성 문제 회피,
  트레이드오프를 문서에 명시).
- rawPayload(Json) 보존 결정 — 개인정보 아님(법인/공공정보)·
  용량 문제 없음 확인, 라이선스 상세 재확인은 R4로 이관.
- StageHistory/Review 전용 테이블은 YAGNI로 미생성(현재 source가
  이력을 제공하지 않고, boolean 플래그로 V1 충분).
- polygon은 `polygonSource`/`polygonRef` nullable placeholder
  2필드만 추가, 실제 geometry 컬럼은 만들지 않음(POINT_FIRST_OK).
- `docs/development/R3B-redevelopment-master-schema-design.md`
  신규 작성(전체 proposal Prisma 코드블록 포함).

DB/schema/migration 변경:

없음(`prisma/schema.prisma` 전혀 건드리지 않음, 문서 안에
proposal 코드블록으로만 작성).

UI 변경:

없음.

production 데이터 접근:

`RedevelopmentProject` row count 확인을 위해 read-only COUNT
쿼리 1회 실행(0건 확인), 그 외 어떤 쓰기/삭제도 하지 않음.

알려진 문제 / BLOCKER:

하드 BLOCKER 없음. Risks 3건 문서에 기록(office 좌표 오노출
위험은 스키마가 아니라 R4/R6 로직 구현이 지켜야 함, 국토부
내부 중복행은 구조적으로 보존되지만 자동 해소 안 됨, DISSOLVED
모호성은 스키마로 완전히 해결 불가).

상태:

STEP R3B 완료 / Redevelopment Master DB Schema 설계안 확정
(RedevelopmentProject + RedevelopmentSourceRecord 2-엔티티,
7종 BusinessType·14종 Stage·location 안전장치 포함) / 기존
production 데이터 0건 확인(MIGRATION_RISK 없음) / 실제
schema.prisma·migration·DB·UI 무변경 / commit·push 하지
않음(2026-08-19).

**R4_GO** — Schema 적용 + ingestion 구현 착수 가능 판단.

## 2026-08-19

### STEP SHARE-1.1 — 카카오톡 공유 카드 실기기 보정

작업:

- 실기기(사용자 리포트) 확인 사항 3건: (1) 긴 URL 노출 —
  SHARE-1에서 이미 해결 확인, 이번 STEP 변경 없음. (2) 카카오톡
  공유 시 앱 이름 표기 — 사용자가 카카오 디벨로퍼스 콘솔에서 직접
  수정 완료, 코드 변경 불필요 확인. (3) 공유 카드 이미지 — 실기기
  Kakao Feed 카드가 1200x630 원본을 정사각형에 가깝게 center-crop해
  좌우 각 약 23.75%(285px)가 잘려나가는 것으로 진단 — 기존
  `og-main` 이미지(좌측 로고 + 우측 캐릭터 + 하단 서비스 메뉴
  배너 레이아웃)를 그대로 쓰면 왼쪽 로고가 crop으로 잘리고 하단
  메뉴 UI까지 카드에 노출돼 산만해 보이는 원인으로 확인.
- 카카오 공유 전용 신규 이미지
  `public/brand/share/ejip-kakao-share-1200x630.jpg` 생성(Pillow,
  결정론적 생성 — AI 이미지 재생성 없음). 기존 승인된 브랜드 자산만
  재사용: `ejipy-default.webp`(마스코트, 260x260) + 상단 중앙,
  `ejip-logo-horizontal.webp`(로고, 400px 폭) + 마스코트 하단 중앙,
  슬로건 "복잡한 부동산, 이집으로 쉽게"(Malgun Gothic Bold 40px,
  `--ejip-charcoal`) + 로고 하단 중앙. 배경 `--ejip-mint` 단색.
  하단 서비스 메뉴 UI는 포함하지 않음(단순화). 모든 요소의 bounding
  box(캐릭터 470~730px, 로고 400~800px, 텍스트 334~866px)가
  1:1 center-crop 생존 영역(x=285~915px)에 완전히 포함되는지
  디버그 오버레이로 검증 후 오버레이본은 삭제, 최종 JPEG만 보존.
  1200x630, quality=90, 35,464 bytes(35.4KB).
- `KakaoShareButton.tsx`의 `buildImageUrl()` 반환값만
  `/brand/og/ejip-og-main-1200x630.jpg` → 새 카카오 전용 이미지
  경로로 변경. 그 외 로직(SDK 우선순위, navigator.share/클립보드
  폴백, title/description/buttons/link 조합, 긴 URL 해결책)은
  바이트 단위로 동일 — diff는 이미지 경로 한 줄 + 진단 주석뿐.

SEO/Twitter OG 무변경:

`src/app/layout.tsx`, `src/config/site.ts`의 OG/Twitter 이미지
경로(`/brand/og/ejip-og-main-1200x630.jpg`)는 전혀 건드리지 않음
— 카카오 공유와 완전히 분리된 별도 이미지 파일로 대응.

APT DETAIL V1 / DB / schema / migration:

전부 무변경. `KakaoShareButton.tsx` 1개 파일의 이미지 경로 1줄
수정 + 신규 이미지 파일 1개 추가가 diff 전부.

정적 검증:

`npx tsc --noEmit` 통과(0 errors). `npx eslint
src/components/KakaoShareButton.tsx` 통과(0 errors). `npx next
build` 통과("✓ Compiled successfully"), 기존 30개 라우트 회귀
없음.

로컬 검증(`localhost:3000/apt/대신롯데캐슬`):

- 신규 이미지가 dev 서버에서 정상 서빙되는 것을 `curl`로 확인
  (200, 35464 bytes).
- `window.Kakao.Share.sendDefault` 몽키패치로 실제 payload 캡처 —
  `imageUrl`이 새 경로(`/brand/share/ejip-kakao-share-1200x630.jpg`)
  로 정확히 바뀐 것, `title`/`description`/`buttons[0].title`("이집
  에서 자세히 보기")/`link`(lawdCd·dong 쿼리스트링 포함)는 SHARE-1
  대비 전부 동일하게 유지된 것을 확인 — CTA 버튼이 payload에 정상
  포함됨을 재확인.
- PC + 375px + 430px(iframe 격리) 전부 확인 — 헤더/가격 카드/공유
  버튼/하단 네비게이션 렌더 정상, 줄바꿈·잘림·overflow 없음.
- console 에러 없음.

알려진 문제 / DEVICE_TEST_REQUIRED:

- 실제 KakaoTalk 앱에서의 최종 카드 렌더(crop 위치, 이미지 선명도)
  는 이번 STEP(브라우저 자동화 환경)에서 물리적으로 확인 불가 —
  crop 비율(23.75%/side)은 사용자 리포트를 근거로 한 진단이며,
  안전 여백을 넉넉히 둬 다소 다른 실제 crop 비율에서도 견고하도록
  설계했으나 실기기 최종 확인은 사용자 몫으로 남음. 하드 BLOCKER는
  아님(기존 og-main보다 명백히 개선된 상태).

상태:

STEP SHARE-1.1 완료 / 카카오 공유 전용 이미지 신규 분리로 실기기
crop 문제(로고 잘림 + 하단 메뉴 UI 노출) 해결 / SEO/Twitter OG
이미지·SHARE-1의 URL 우선순위 해결책·APT DETAIL V1·DB/schema/
migration 전부 무변경 / commit·push 하지 않음(2026-08-19).

## 2026-08-19

### STEP R4 — Redevelopment Master DB Schema 적용 + Ingestion/Sync 구현

작업:

- R3B 확정 schema(`RedevelopmentProject` + `RedevelopmentSourceRecord`
  2-엔티티, 7종 BusinessType·15종 Stage·location 안전장치 포함)를
  재설계 없이 그대로 `prisma/schema.prisma`에 적용. `npx prisma
  migrate diff`로 destructive SQL(DROP COLUMN 4개, enum 값 교체)만
  포함하고 다른 모델은 전혀 건드리지 않는 것을 확인한 뒤
  `prisma/migrations/20260819110211_redevelopment_master_schema_r4/`
  로 저장 — **production에는 미적용**(`migrate status`로 재확인,
  `not yet been applied`).
- 국토부 CSV importer(`scripts/redevelopment/import_molit.ts`):
  R2가 문서화한 3-step 다운로드 흐름(selectFileDataDownload.do →
  check-limit.json → fileDownload.do)을 코드로 재구현, 실제로 다시
  다운로드해 123,933 bytes(R2 기록과 정확히 일치) 확인. CP949는
  Node 표준 `TextDecoder('euc-kr')`로 디코딩(신규 의존성 없음).
- 부산 API importer(`scripts/redevelopment/import_busan.ts`):
  기존 `api-molit.ts`의 `fast-xml-parser` 패턴 재사용(type=json
  파라미터에도 XML로 응답하는 것 재확인).
- 정규화/매핑/매칭/병합 로직을 `src/lib/redevelopment/`에 순수
  함수로 구현(normalize/businessType/stage/fingerprint/
  officeDetector/matching/merge/parse/ingest) — R2/R3A/R3B가 실측·
  설계한 코드/규칙을 그대로 코드화(임의 매핑 추가 없음, unknown은
  UNKNOWN으로 정직하게 유지).
- `ingest.ts`의 `ingestRecord()`가 match-or-create-Project → upsert
  SourceRecord → canonical 필드 재계산까지 레코드 1건 파이프라인을
  전담. Prisma에 구조적 타입으로만 의존해 `InMemoryRedevelopmentStore`
  로 실제 DB 없이도 동일 코드 경로를 테스트/파일럿에 재사용 가능.
- node:test 기반 단위/통합 테스트 53건 신규 작성(신규 npm
  패키지 설치 없음, Node 내장 test runner + 기존 ts-node 사용) —
  전부 pass. "거제2 재개발/재건축"·"촉진5(금정구/영도구)" 오매칭
  방지, idempotency(반복 ingest해도 project/sourceRecord 수 불변),
  needsReview 판정 2종을 회귀 테스트로 고정.
- `scripts/redevelopment/quality_report.ts`로 MOLIT 1,566행 + 부산
  343건 **실물 데이터**를 인메모리 스토어에 대해 실제로 ingest해
  집계(DB 쓰기 없음): canonical project 1,904 / source record
  1,907 / merged(양쪽 연결) 2 / matchConfidence EXACT 3·HIGH 0·
  MEDIUM 67·LOW 455·UNMATCHED 1,382.
- API route(`src/app/api/properties/route.ts`)의 REDEVELOPMENT
  분기를 새 schema(lawdCd 대신 sido/sigungu 필터)에 맞게 최소
  수정 — 이 분기를 실제로 호출하는 프론트엔드가 없음을 재확인
  (`/map`의 재개발 레이어는 이미 "준비 중" 안내만 표시, 회귀 영향
  없음). `publicDataService.ts`의 옛 `upsertRedevelopmentProject()`
  (호출부 없음, 새 schema와 근본적으로 안 맞음, R3B TODO)는 제거.

신규 발견(이번 STEP에서 실물 데이터로 처음 확인):

- 국토부 conflicting duplicate 1건 신규 발견(대구 남구 봉덕1동,
  세대수만 1091/621로 다름) — R2가 찾은 완전중복 1건과는 별개
  사례. fingerprint가 stage/세대수를 안 보므로 CSV 나중 행 값이
  최종적으로 남는다는 사실을 정직하게 로그/문서화.
- **부산 sigungu 텍스트 해석률(148/343, 43%)이 cross-source 매칭의
  실질적 병목**임을 실물 파일럿으로 확인 — "서대신4"(R3A가 "가장
  깨끗한 EXACT 사례"로 꼽은 건)조차 부산 쪽 location 텍스트에
  "서구"라는 문자열 자체가 없어("대영로45번길20, 3층(서대신동2가)")
  자동 병합에 실패하고 MOLIT-only/BUSAN-only 두 프로젝트로
  분리됐다 — 매칭 confidence 로직(51개 테스트로 검증됨) 문제가
  아니라 sigungu 해석 단계의 근본 한계. 아미1/아미3(MOLIT-only,
  주거환경개선/정비구역지정)는 R3A 예측과 정확히 일치.
- 부산 서구 canonical project 20건 — R2의 "부산 서구 20건" CSV
  집계와 정확히 일치(서구가 통째로 빠지는 일 없음 재확인).

정적 검증:

`npx tsc --noEmit` 통과(0 errors, 프로젝트 전체). 변경/신규 파일
전체 `npx eslint` 통과(0 errors). `npx next build` 통과, 기존
라우트 전부 회귀 없음.

Production migration/ingestion:

**둘 다 미실행**(섹션 47/48 지시). `prisma migrate deploy` 호출
안 함, production `RedevelopmentProject`/`RedevelopmentSourceRecord`
insert 0건. `import_molit.ts`/`import_busan.ts`는 `--dry-run`으로만
실행, 실제 DB 쓰기 경로(`ingestRecord`)는 인메모리 스토어
대상으로만 실행.

기존 서비스 보호:

`git diff --stat` 기준 `prisma/schema.prisma`(redevelopment 블록만),
`api/properties/route.ts`, `publicDataService.ts` 3개 파일 외
전부 신규 파일 — APT Detail/Map/AI Search/Presales/Community/
Share/Auth 등 기존 기능 관련 파일은 전혀 건드리지 않음.

알려진 문제 / unresolved:

1. 부산 sigungu 해석률 43%가 매칭 병목(위 "신규 발견" 참고) —
   R5/R6에서 해결 필요, 임의 매핑 생성 없이 Kakao 역지오코딩 또는
   공식 행정동-자치구 매핑 데이터 결합 등 후보만 기록.
2. 국토부 conflicting duplicate "마지막 행이 이긴다" 동작이 실제
   원하는 정책인지 product 판단 필요.
3. office 좌표 실제 지오코딩 파일럿은 R5/R6로 이관(로직 자체는
   구현·테스트 완료).
4. matching 유사도 임계치(0.7)는 R3A 문서에 숫자로 명시되지 않아
   이번 STEP에서 정한 값 — MEDIUM 판정 샘플(67건) 사람 검수 권장.

상태:

STEP R4 완료 / Redevelopment Master DB Schema `prisma/schema.prisma`
적용 + migration 생성(production 미적용) / 국토부·부산 importer
+ 정규화·매칭·병합 파이프라인 구현, 53개 테스트 전부 pass, 실물
데이터 인메모리 파일럿 검증 완료 / production migration·ingestion
전부 미실행(검수 대기) / commit·push 하지 않음(2026-08-19).

**R5_조건부_GO** — schema/importer/matching 코드는 R5 진행 가능,
단 실제 데이터 투입 전 부산 sigungu 해석 문제 해결 또는 현재
동작(sigungu 미상 레코드는 자동 매칭 제외) 명시적 승인 필요.

## 2026-08-19

### STEP R4.1 — 부산 시군구 해석 보정 + Redevelopment 실제 병합 품질 확정

작업:

- R4가 남긴 핵심 병목(부산 343건 sigungu 해석률 43%, "OO구" 리터럴
  텍스트 매칭만 사용) 해결. 새 외부 API 추가 없이 이 프로젝트가
  이미 쓰는 `REGCODE_PROXY`(`src/lib/region-utils.ts`)를 재사용해
  법정동명 기반 해석을 추가(`src/lib/redevelopment/
  sigunguResolver.ts`) — EXPLICIT/DONG_NAME/ROAD_ADDRESS/
  PROJECT_NAME 4단계 우선순위, 각 단계 해석 결과를 정직하게 구분.
- 도로명-only 레코드(343건 중 47건)만 Kakao 주소 검색으로 sigungu
  복원(좌표 저장 안 함, 기존 `cheongyakService.ts` 패턴 재사용) —
  이 중 26건(55%)이 office 의심 패턴과 동시 검출돼 자동 매칭에서
  제외(조합사무실이 사업구역과 다른 구에 있을 위험 차단).
- areaName(사업명) 기반 동명 추론은 공식 법정동명과 **정확히**
  일치할 때만 채택(fuzzy 매칭 금지) — "명서1"(R3A 기록 사례,
  실제로는 "명장동")처럼 글자가 다른 경우는 의도적으로
  UNRESOLVED 유지, 잘못된 구로 배정하지 않음.
- sigungu를 고쳐도 "서대신4"가 여전히 병합 안 되는 것을 실제로
  발견 — 원인은 부산 실측 API의 `areaName`이 "서대신4 재개발"
  (유형 접미사 포함)이라 저장용 `normalizedName`(접미사 보존)과
  국토부의 "서대신4"(접미사 없음)가 문자열로 달랐기 때문. DB
  저장 형식은 그대로 두고 `matching.ts`의 confidence 계산에서만
  쓰는 비교 전용 `stripTypeSuffixForComparison()`을 추가(R3A
  원래 파일럿 접미사 목록 재사용) — 오매칭 방지는 여전히 별도
  `businessType` 비교가 담당(거제2 재개발/재건축 회귀 테스트
  유지, 실물 데이터에서도 "대연3"이 RECONSTRUCTION/REDEVELOPMENT
  두 프로젝트로 정확히 분리 유지되는 것으로 재확인).
- R4 unresolved #5(`classifyLocationText()` 미배선)를 이번
  STEP에서 연결 — `ingestRecord()`가 Project에 연결된
  SourceRecord들의 rawLocation을 분류해 `locationType`/
  `locationConfidence`를 채운다. 좌표(lat/lng)는 여전히 채우지
  않고 `geocodeStatus`는 항상 `NOT_ATTEMPTED`(343건 전체 지오코딩
  여전히 금지, office 의심 좌표를 PROJECT_SITE로 저장하지 않음).
- `api/properties/route.ts`의 R4 변경분(`lawdCd`→`sido`/`sigungu`)
  이유를 diff로 재확인 — schema에서 lawdCd 필드 자체가 제거돼
  필수였던 변경으로 판정, 그대로 유지.

실물 데이터 재검증 결과(DB 쓰기 없음, InMemoryStore 2회 연속 실행
후 완전 동일 확인):

```text
부산 sigungu 해석률: 43.1%(148/343) -> 89.2%(306/343),
  매칭에 안전하게 쓸 수 있는 건 81.6%(280/343)
merged(양쪽 소스 연결) project: 2 -> 108 (54배)
canonical projects: 1,904 -> 1,798
EXACT match: 3 -> 109
needsReview: 0 -> 13(더 많이 매칭되며 R3A가 예측한 businessType
  충돌·세대수 30%+ 불일치 패턴이 정상적으로 표면화된 것)
```

- 서대신4: **canonical project 1개로 병합 성공**(MOLIT+BUSAN_CITY
  양쪽 SourceRecord 연결), 착공/542세대 — R3A 예측과 정확히 일치.
- 아미1/아미3: 변경 없음, MOLIT-only 그대로 유지(억지 매칭 없음).
- 부산 서구 canonical project 20 -> 24건(R2의 MOLIT 20건 기준
  BUSAN 매칭 8건 확인, R3A의 "최소 7건"보다 개선).
- 수동 검증: merged 108건 중 25건을 14개 서로 다른 구/군에 걸쳐
  표본 추출해 사업명/구군/유형/세대수/stage 전수 확인 — 오병합
  0건. collision 검사: "대연3"이 재건축/재개발 두 프로젝트로
  정확히 분리 유지되는 것으로 businessType 안전장치 재확인.

테스트:

신규 21건(`sigunguResolver.test.ts` 11건, `matching.test.ts`/
`ingest.test.ts` 각 2건 등) 추가, 기존 45건과 합쳐 **전체 68개
pass**. 실제 법정동명(서대신동2가/부민동2가/아미동1가/동대신동3가
→ 서구) 개별 확인, 실제 동명이인(송정동: 해운대구/강서구) 안전
판별(UNRESOLVED) 회귀 테스트로 고정.

정적 검증:

`npx tsc --noEmit` 통과(0 errors, 프로젝트 전체). 변경 파일 전체
`npx eslint` 통과(0 errors). `npx next build` 통과, 기존 라우트
회귀 없음.

Schema/migration:

**무변경.** `git diff --stat prisma/`가 R4와 완전히 동일 —
R4.1에서 추가된 줄 없음. `npx prisma migrate status` 재확인,
`20260819110211_redevelopment_master_schema_r4` 여전히 미적용.

Production migration/ingestion:

**둘 다 미실행.** 모든 검증은 `InMemoryRedevelopmentStore` 또는
`--dry-run`으로만 수행.

알려진 문제 / unresolved:

1. UNRESOLVED 37건은 억지로 채우지 않고 그대로 유지(주로 location
   자체가 빈 문자열).
2. ROAD_ADDRESS로 sigungu를 알아낸 26건은 office 의심 때문에
   보수적으로 매칭에서 제외 — 실제로는 병합 가능했을 수 있는
   트레이드오프(의도된 설계, 오매칭보다 안전).
3. R4의 기존 unresolved(conflicting duplicate 정책, office 좌표
   실제 지오코딩 파일럿, similarity 임계치 0.7)는 이번 STEP
   범위 밖으로 그대로 유지.

상태:

STEP R4.1 완료 / 부산 sigungu 해석률 43%->89% 개선(기존 공식
REGCODE_PROXY 재사용, 새 API 추가 없음) / 매칭 접미사 비교 버그
수정(서대신4 등 실제 병합 복구) / classifyLocationText 배선 완료
(좌표/전체 지오코딩은 여전히 안 함) / merged project 2->108건,
수동 검증 25건 오병합 0건 / schema/migration 무변경, production
migration·ingestion 전부 미실행 / commit·push 하지 않음
(2026-08-19).

**PRODUCTION_INGEST 조건부 GO / R5_GO** — sigungu 해석 문제
해결로 R4가 걸었던 조건 충족. MEDIUM 43건은 여전히 사람 검토
필요(REVIEW_REQUIRED로 정상 유입), UNRESOLVED/unsafe 63건은
보수적으로 BUSAN-only 유지.

## 2026-08-19

### STEP R4 FINAL — Production Migration + 전국/부산 재개발 실데이터 적재

작업:

- R4/R4.1 최종 diff 재검수(redevelopment 관련 변경만, 다른 서비스
  로직 무영향, debug 코드/secret/임시 파일 없음) 후 2개 commit으로
  분리해 push: `feat: implement redevelopment master ingestion`
  (schema/migration/importer/45 tests), `fix: improve
  redevelopment regional matching`(sigungu resolver/접미사 비교
  수정/location classification 배선/신규 21 tests).
- `npx prisma migrate deploy`로 `20260819110211_redevelopment
  _master_schema_r4`를 production(Supabase session pooler
  5432)에 적용 — destructive SQL은 이미 R4/R4.1에서 재검토된
  DROP COLUMN 4개+enum 교체뿐(DROP TABLE/TRUNCATE/DELETE 없음),
  기존 RedevelopmentProject 0행이라 데이터 손실 없음. `migrate
  status`로 "Database schema is up to date!" 확인.
- MOLIT(1,566행) + BUSAN(343건) importer를 production DB에 실제
  실행 — `RedevelopmentProject` 1,798건, `RedevelopmentSourceRecord`
  1,907건 적재, R4.1 인메모리 파일럿과 정확히 일치.
- **production에서 실제로 2회 연속 재실행해 idempotency 확인** —
  1차/2차 모두 Project 1,798 / SourceRecord 1,907로 완전 동일,
  BUSAN 2차 실행은 `createdProject: 0`(전부 자기 자신과
  재매칭)로 row 폭증 없음 확인.

신규 발견(production 재실행 중):

- 2회차 실행 후 SourceRecord의 `matchConfidence`가 전부 EXACT로
  덮어써지는 것을 발견 — 재실행 시 각 레코드가 자신이 이미
  만든 canonical project를 후보로 재조회해 트리비얼하게
  EXACT가 나오는 설계상 결과(버그 아님, Project/SourceRecord
  행 수·연결 관계는 무영향). 다만 "최초 ingest 시점의 실제
  매칭confidence 분포"라는 감사 이력 정보는 재동기화 때마다
  사라진다는 한계를 문서에 기록 — R5/R6 주기적 sync 설계 시
  고려 필요, 이번 STEP에서 코드는 바꾸지 않음.

production 검증 결과:

```text
molitOnly 1,456 / busanOnly 234 / merged 108 / needsReview 13
(R4.1 파일럿과 정확히 일치)
location: PROJECT_SITE 73 / OFFICE 140 / APPROXIMATE 7 / UNKNOWN 1,578
좌표(lat/lng) 채워진 project: 0건(전체 지오코딩 안 함, 설계대로)
전국 17개 시도 전부 확인
source+sourceRecordId unique 위반: 0건
```

- 서대신4: **canonical project 1개로 병합 성공**(MOLIT+BUSAN_CITY),
  착공/542세대 — R3A 예측과 정확히 일치.
- 아미1/아미3: 변경 없음, MOLIT-only 그대로.
- 부산 서구 canonical project 24건, 실제 API
  (`/api/properties?category=REDEVELOPMENT`)로도 재확인.
- 대구 남구 봉덕1동 conflicting duplicate: production에서도
  SourceRecord 1건만 존재(fingerprint 흡수, 삭제/임의 최신값
  선택 없음, 정책 그대로).

기존 서비스 smoke test(실제 배포 URL
`real-estate-app-park11.vercel.app`):

`/`, `/apt/대신롯데캐슬`, `/map`, `/presales`, `/community`,
`/api/properties?category=REDEVELOPMENT` 전부 200, 500 없음.
Migration/ingestion 과정에서 EMAXCONNSESSION/too many
clients/prepared statement 에러 발생하지 않음(순차 upsert,
배치 없음).

정적 검증:

Production 적용 전 `npx tsc --noEmit`/`eslint`/`next build`/
전체 68개 테스트 재실행 — 전부 통과(R4/R4.1 검증 재확인).

DB reset 여부:

**없음.**

상태:

STEP R4 FINAL 완료 / migration production 적용 완료 / MOLIT+BUSAN
실데이터 production 적재 완료(Project 1,798 / SourceRecord 1,907)
/ production 2회 연속 재실행으로 idempotency 실증 확인(matchConfidence
재계산 관련 감사 이력 한계는 문서화) / 서대신4 병합 성공, 아미1/
아미3 유지, 부산 서구 24건, 전국 17개 시도 확인 / 기존 서비스
smoke test 전부 200, DB connection 문제 없음 / commit 2개 push
완료(2026-08-19).

**R5_GO** — migration 적용/ingestion 성공/idempotent/전국
coverage/서구·서대신4·아미1·아미3 검증/파괴적 회귀 없음/DB
connection blocker 없음 전부 충족.

## 2026-08-19

### STEP R5 — Redevelopment API / Service Layer

작업:

- `src/lib/redevelopment/service.ts` 신규 — API route가 Prisma
  쿼리를 직접 쓰지 않고 이 파일의 함수만 호출한다.
  `listRedevelopmentProjects()`(필터+검색+페이지네이션),
  `getRedevelopmentProjectById()`(상세+source summary+data
  quality+field provenance), `getRedevelopmentMapProjects()`(지도
  전용, 안전 좌표만).
- `GET /api/redevelopment`(목록: sido/sigungu/businessType/stage/
  q/page/pageSize) + `GET /api/redevelopment/[id]`(상세) 신규 —
  기존 `api/properties/route.ts`의 `{success,data}` 봉투 관례를
  그대로 따름. pageSize 기본 20/최대 100(clamp), 잘못된 page/
  pageSize는 500 대신 기본값으로, 잘못된 enum은 400.
- sido 축약형("부산"→"부산광역시")을 `src/lib/regions.ts`의
  `SIDO_LIST` 기준으로 정규화(매칭 안 되면 원본 유지, 추측 안 함).
- 상세 API의 `sources[]`는 rawPayload를 제외한 요약만 노출
  (source/rawName/rawBusinessType/rawStage/rawHouseholdCount/
  sourceUpdatedAt/collectedAt/matchConfidence/mergeStatus) —
  단위 테스트로 rawPayload가 응답 어디에도 없음을 확인.
- `fieldProvenance`(예: "진행단계: 부산시 기준") — 새
  provenance 테이블 없이 sources[]의 source 존재 여부 +
  R2/R3B 고정 우선순위 규칙만으로 텍스트 서술.
- `hasSafeMapLocation`(lat/lng 있고 locationType=PROJECT_SITE일
  때만 true) — production에 좌표 0건이라 현재는 전부 false, 지어낸
  좌표 없음(OFFICE를 지도 위치로 반환하지 않음, UNKNOWN에 임의
  좌표 생성하지 않음).

matchConfidence 재동기화 덮어쓰기 버그 수정(R4 FINAL에서 발견):

- 원인 확인 — `ingestRecord()`가 이미 존재하는 SourceRecord를
  재동기화할 때도 항상 후보 매칭을 다시 계산해, 자신이 이미 만든
  project와 트리비얼하게 self-EXACT 매칭되어 원래 matchConfidence를
  덮어썼음.
- 수정 — `ingestRecord()` 시작 지점에서 기존 SourceRecord 존재
  여부를 먼저 확인, 존재하면 매칭을 재계산하지 않고 raw 필드만
  갱신, matchConfidence/mergeStatus/projectId는 보존.
  `RedevelopmentPrismaClient`에 `update` 메서드 추가,
  `IngestOutcome.action`에 `'resynced'` 추가. **schema 변경 없이
  해결**(STOP 불필요).
- 신규 회귀 테스트 3건(ingest.test.ts): MEDIUM 재ingest 후에도
  MEDIUM 유지, EXACT 재ingest 후에도 EXACT 유지, 재동기화 시
  raw 필드(stage 등)는 계속 최신화되지만 matchConfidence만 보존.
- **production에는 이 fix를 재적재하지 않았다** — 코드 수정 +
  인메모리 테스트 검증까지만, 기존 production SourceRecord의
  matchConfidence(R4 FINAL 2차 재실행 때 덮어써진 값)는 소급
  복구하지 않음(문서에 명시).

Seo-gu/대표 사업 검증(local dev 서버가 production DATABASE_URL로
연결, read-only):

```text
sido=부산&sigungu=서구  → total 24  (R4 FINAL과 일치)
q=서대신4                → 1건, CONSTRUCTION/542세대,
                            sources=[MOLIT,BUSAN_CITY], stage 부산시 기준
q=아미1 / q=아미3        → 각 1건, MOLIT-only, RESIDENTIAL_ENVIRONMENT/
                            ZONE_DESIGNATED, stage 국토부 기준
sido=서울/경기/부산      → 644 / 241 / 461 (전부 R4 FINAL과 일치)
```

정적 검증:

`npx tsc --noEmit`/`eslint`/`next build` 전부 통과. 전체 88개
테스트 pass(기존 65 + service.test.ts 20건 + 재동기화 회귀 3건).
기존 라우트(`/api/properties`, `/api/presales`, `/api/apt/[name]`,
`/api/school/stats`) 로컬 smoke 회귀 없음.

DB/schema/migration/production ingestion:

**전부 무변경/미실행.** API/service 코드만 추가, production은
read-only 조회만 수행.

상태:

STEP R5 완료 / Redevelopment API·Service Layer 구현(목록/검색/
필터/페이지네이션/상세/지도 안전 좌표) / matchConfidence 재동기화
덮어쓰기 버그 code-level 수정+테스트 검증(production 소급 복구는
아님, 문서화) / 부산 서구 24건·서대신4·아미1·아미3·전국 필터
API로 재확인 / DB/schema/migration/production ingestion 전부
무변경 / commit·push 하지 않음(2026-08-19).

**R6_GO** — list/detail/filter/search/pagination/서구 24건/
서대신4/아미1·아미3/safe map semantics/matchConfidence fix/
typecheck·lint·build·tests 전부 충족.

## 2026-08-19

### STEP R6 — Redevelopment UI V1

작업:

- `/redevelopment` 페이지의 "재개발" 탭(기존 "준비 중" placeholder)을
  R5 API 기반 실데이터 목록/검색/필터/상세 화면으로 교체.
  "분양·청약" 탭은 완전히 무변경(코드 diff로 확인).
- `src/lib/redevelopment/labels.ts` 신규 — 사업유형/진행단계 한글
  라벨, stage 시각 그룹(active/done/stopped/unknown), source 한글
  변환(MOLIT→국토교통부, BUSAN_CITY→부산광역시), 시도 축약 표기
  (부산광역시→부산), 날짜 포맷(YYYY.MM). Prisma를 import하지 않는
  순수 모듈이라 클라이언트 번들에 안전 — `service.ts`도 이 파일을
  재사용하도록 리팩터(라벨 상수 중복 제거).
- `RedevelopmentListSection.tsx`(재개발 탭 목록) — 검색(300ms
  debounce) → 시도(기본 부산광역시)/시군구(`REGION_DATA` 재사용, 새
  지역 시스템 없음)/사업유형/진행단계 필터 → 지도 안내 문구 → 결과
  건수 → 카드 그리드(사업명/배지/지역/세대수/출처+갱신일) →
  페이지네이션. 세대수 null은 "세대수 정보 없음"(0 표시 안 함).
- `/redevelopment/[id]` 신규 — 상세 페이지(`generateMetadata`로
  canonical 데이터 기반 SEO title/description, presales 상세 패턴
  재사용). 히어로+배지+상태(진행 중/완료/취소/확인 중), 세대수/
  진행단계/사업유형 각각 field
  provenance 텍스트, 지도 안내 박스, source별 카드(원본 사업명/
  진행단계/세대수/수집 시점 — matchConfidence/mergeStatus는 UI에
  렌더링하지 않음), needsReview는 "일부 정보 확인 중"으로만 안내.
- 지도 안전성: 실제 Kakao 지도 위젯은 이번 STEP에서 붙이지 않음
  (production 안전 좌표 0건이라 검증할 마커가 없음 — R5의
  `hasSafeMapLocation` 계약과 안내 UX만 준비, 좌표가 채워지기
  시작하면 위젯만 나중에 끼우면 됨). OFFICE/APPROXIMATE/UNKNOWN을
  사업현장 marker로 표시하는 코드 자체가 없음.

브라우저 실검증(local dev, production DATABASE_URL 대상):

```text
재개발 탭 기본값 부산광역시 → 검색 결과 461건
q=서대신4 → 1건(재개발/착공/542세대) → 상세 진입 →
  국토교통부+부산광역시 두 출처 카드 정상 표시
/redevelopment/649(아미1) → MOLIT-only, "세대수 정보 없음"
/redevelopment/999999999 → 인라인 404 안내, 500 아님
모바일 375/390/430(iframe 격리) → 필터 줄바꿈/카드/하단네비 전부 정상
데스크톱 → 카드 3열 그리드
console 에러 없음
```

정적 검증:

`npx tsc --noEmit`/`eslint`/`next build` 전부 통과. 신규
`labels.test.ts` 9건(projectStatusLabel 포함) 포함 전체 97개 테스트
pass. 기존 라우트 회귀 없음.

DB/schema/migration/production ingestion:

**전부 무변경/미실행.** UI 코드만 추가, R5 API 계약 그대로 재사용,
production에는 read-only 호출만.

상태:

STEP R6 완료 / 재개발 탭 placeholder 제거, production 실데이터
목록/검색/필터/상세 UI 구현 / 분양·청약 탭 무변경 / 부산 서구·
서대신4·아미1·아미3 브라우저 실검증 / 지도는 안전 계약만 준비(실제
위젯은 좌표 확보 후 R7+에서) / 모바일 375·390·430/데스크톱 확인 /
DB/schema/migration/ingestion 전부 무변경 / commit·push 하지
않음(2026-08-19).

## 2026-08-19

### STEP SHARE-1.2 — KakaoTalk 공유 카드/CTA 클릭 → 상세페이지 이동 문제 조사

작업:

- `KakaoShareButton.tsx`를 처음부터 재확인 — SHARE-1/1.1 이후 재작성
  없음, `content.link`/`buttons[0].link` 구조 정상.
- 실제 production(`real-estate-app-park11.vercel.app`)에서 `Kakao.Share.
  sendDefault`를 몽키패치해 아파트 2곳(대신롯데캐슬, 대신푸르지오1차)의
  **실제 클릭 이벤트가 만드는 payload를 직접 캡처**(텍스트 추출 도구가
  쿼리스트링 포함 값을 자동 차단해 캡처값을 화면에 렌더링 후 스크린샷으로
  판독, 저장소에는 아무 흔적도 남기지 않음) — `content.link.mobileWebUrl`
  == `webUrl` == `buttons[0].link.mobileWebUrl` == `webUrl` 전부 동일,
  `lawdCd`/`dong` 정확히 보존, 아파트명 이중 인코딩 없음(단일
  percent-encoding으로 정확히 디코딩됨), production 실제 도메인만 사용
  (localhost/preview 유입 없음) — **payload/코드 레벨 버그 없음**.
- 추가 code-level 가능성도 점검: iOS/Android 앱링크 하이재킹 파일
  (`apple-app-site-association`, `assetlinks.json`) 전부 404(없음), 응답
  헤더에 인앱 브라우저를 막을 만한 `X-Frame-Options`/`CSP`/예상치 못한
  리다이렉트 없음, navigator.share fallback 우선순위 회귀 없음, CTA 문구·
  카카오 전용 공유 이미지 전부 무변경 유지.
- 판정: 카테고리 B(payload는 정확하지만 클릭이 안 됨) — 코드를 추측으로
  고치지 않고, 사용자가 Kakao Developers 콘솔(앱 ID 1534780 "이집")에서
  확인해야 할 항목만 문서화: 앱 설정 → 플랫폼(Platform) → Web 사이트
  도메인이 정확히 `https://real-estate-app-park11.vercel.app`로
  등록되어 있는지, 제품 설정 → 카카오톡 공유가 활성화 상태인지.

정적 검증:

이번 STEP은 코드 변경이 없음(버그를 찾지 못함) — `npx tsc --noEmit`/
`eslint`/`next build` 재확인, 전부 기존과 동일하게 통과.

DB/schema/migration/UI:

**전부 무변경.**

알려진 문제 / unresolved:

**실제 물리기기 KakaoTalk 클릭 테스트는 이번 STEP에서 수행하지
못했다**(이 환경에 KakaoTalk이 설치된 물리 기기 없음) — 사용자가 위
Kakao Developers 설정을 확인/수정한 뒤 직접 실기기에서 카드 클릭과
CTA 클릭을 각각 테스트해야 완료 판정 가능(payload 검증만으로 완료
처리하지 않는다는 이번 STEP 자체의 기준을 그대로 지킴).

상태:

STEP SHARE-1.2 완료(코드 조사) / payload 실물 검증으로 코드 버그
없음 확인(아파트 2곳) / Kakao Developers 콘솔 확인 항목 문서화 /
실제 물리기기 클릭 검증은 사용자 액션 대기 / commit·push 하지
않음(2026-08-19).

## 2026-08-19

### STEP SCORE S1 — 아파트 이집점수 데이터 감사 + 설계

작업:

- 점수 계산 코드/schema/migration/UI를 전혀 만들지 않고, production
  DB에 read-only 쿼리로 실제 아파트 데이터 coverage를 감사.
- `Apartment`(상세페이지가 실제로 쓰는 건축물대장 캐시): 32건, 전국
  산발적 — parking/far/bcr/households 93.8%지만 표본이 너무 작고
  비대표적. `communityFacilities` 0/32(STEP50에서 이미 0/31로 확인된
  죽은 필드, 이번에 재확인해도 여전히 0).
- `ApartmentMaster`(M3 pilot): 3,402건인데 **sido 전부 "부산"** —
  전국 데이터가 아님을 이번 감사로 명확히 확인. buildYear 100%,
  aptSeq(MOLIT 조인키) 100%, latLng 90.2%, totalHouseholds 38.5%,
  parkingCount 25.8%. 부산 서구만 171건.
- `TradeHistory` 0건(스키마 주석 자체가 "라이브 앱 미사용" — 오프라인
  시드 전용), 실거래는 MOLIT API 라이브 호출만(개별 조회는 정확하나
  배치 캐시 없음).
- 8종 Kakao Places(지하철/버스 TAGO/KTX/병원·공원/마트/편의점/약국/
  어린이집)와 NEIS 학교 데이터 전부 라이브 API 호출, DB 미저장 확인.
  NEIS는 학교 실명/위치만 있고 진학률/학업성취도 데이터 소스 자체가
  없음(STEP1.5-A/50에서 이미 확인된 사실 재확인) — **학군 카테고리는
  V1/V2 어디에도 넣지 않고 NOT AVAILABLE로 결론**.
- 부산 서구 `ApartmentMaster` 171건으로 read-only pilot 시뮬레이션
  (DB 미저장) — 세대당 주차대수 계산 가능 26건(15.2%)뿐, 신축(2015+)
  coverage 27.7% vs 구축 10.5%로 **결측이 준공연도와 상관관계 있음을
  실측 확인**(결측=0점 금지 원칙의 실제 근거). Percentile 10개 표본
  시뮬레이션에서 대단지/신축 편향 없음 확인, 이상치 1건(삼경빌라맨션,
  0.29대/세대) 발견 — 데이터 품질 검수 절차 필요로 기록.
- 6개 후보 카테고리(교통/생활편의/주차/학군/단지규모/가격) 전부
  **PARTIAL 또는 NOT AVAILABLE — V1 INCLUDED가 하나도 없다는 것이
  핵심 결론**(라이브 API는 벌크 계산 인프라 없음, DB 데이터는 부산
  전용+coverage 부족).
- Peer group은 기존 `findNearbyApartments()`(adaptive radius,
  1→1.5→2→3km, 최소 5건) 재사용 제안 — 새 로직 불필요.
- "전국 공통 Core Score"라는 원래 전제 자체가 현재 데이터로는
  성립하지 않음(비교 가능한 지역이 부산 하나뿐)을 문서에 명시,
  "부산(서구) pilot Core"로 범위를 좁히는 제품 결정 필요를 제안.

DB/schema/migration/UI/production ingestion:

**전부 무변경.** 조사에 쓴 임시 스크립트(`scripts/_score_s1_audit*.ts`,
`_score_s1_pilot.ts`)는 문서 작성 후 삭제, 저장소에 남기지 않음.

상태:

STEP SCORE S1 완료(설계 문서만) / 실제 데이터 coverage 전수 감사 /
6개 후보 카테고리 전부 PARTIAL/NOT AVAILABLE로 판정(V1 즉시 포함
가능 카테고리 없음) / 결측 bias 실측 확인(신축 27.7% vs 구축 10.5%)
/ 부산 서구 pilot 이상치 1건 발견 / peer group은 기존 함수 재사용
제안 / "전국 Core"는 현재 데이터로 불가, 범위 축소 필요 / 점수
계산 코드/schema/migration/UI 전부 무변경 / commit·push 하지
않음(2026-08-19).

**S2_조건부_GO** — 카테고리/가중치/지역보정을 지금 확정할 데이터가
없음. 배치 캐시 스키마 별도 승인 또는 "부산 서구 한정 V0.5" 범위
축소 결정 필요.

## 2026-08-19

### STEP SCORE S1.1 — Score Data Foundation + Regional Location Premium 설계

작업:

- S1의 결론(V1 INCLUDED 카테고리 없음, 전국 Core 전제 성립 안 함)은
  뒤집지 않고, `ApartmentMaster` 전체 필드/coverage를 처음부터
  재조사.
- **핵심 재발견: `ApartmentMaster` 3,402건이 이미 부산 16개 구·군
  전역을 커버**(S1은 서구만 pilot했지만 실제 데이터는 부산 전체) —
  좌표(lat+lng) coverage 90.2%, 구별로도 서구 90.6%/해운대 80.2%/
  수영구 90.0%/남구 87.0% 고르게 확보. 출처는 이미 실행된 MASTER
  M4-B(`14-apartment-master-m4-expansion-analysis.md`)의 산출물임을
  재확인(추정 아님).
- `area`(면적) 필드가 schema에 없음을 확인(원 지시 후보였으나
  실제로는 없음, 정직하게 보고). `useApprovalDate` 18.2%,
  `mainBuildingCount` 40.1%, `roadAddress`/`jibunAddress` 40.8%도
  실측.
- **MOLIT 가격 API 재발견**: `fetchMolitData()`는 구/군+월 단위로 그
  지역 전체 거래를 한 번에 반환 — 호출 비용이 아파트 수(3,402)가
  아니라 (구·군×개월) 수에 비례. 16구×12개월=192회로 부산 전체 최근
  1년 가격 raw feature 확보 가능(24개월 기준이면 384회로 M4 문서의
  기존 추정과 정확히 교차검증됨).
- **해변 접근성(BEACH_ACCESS) 계산 가능성을 실제 API 호출로 실증**
  (해운대 좌표 기준 "해수욕장" 키워드 검색 → Kakao 공식
  category_name "관광,명소 > 해수욕장,해변" 경로로 안전하게 필터
  가능, 새 외부 API 불필요) — **오션뷰(OCEAN_VIEW)는 동/층/방향
  데이터 자체가 없어 명확히 NOT_AVAILABLE로 분리 유지**.
- `KakaoPlaces.tsx`는 브라우저 JS SDK 기반이라 서버 배치가 재사용
  불가함을 확인 — REST API(기존 `cheongyakService.ts`/
  `geocode-apt.ts` 패턴) 전환 필요를 설계에 명시.
- API 예산 추정: Kakao 약 24,536회(3,067개 좌표단지×8종) + TAGO 약
  3,067회 + MOLIT 192~384회 ≈ 28,000회. **TAGO는 10,000건/일로 이미
  문서 확인됨**(STEP44), Kakao/MOLIT 일일 한도는
  EXTERNAL_VERIFICATION_REQUIRED로 명시(M4 문서와 동일하게 추측
  기록 안 함) — 다회차 batch 실행 전제로 설계.
- Regional Location Premium을 Core/Regional 비중 분리(A안) 대신
  **Core 자체를 지역 percentile로 정규화하고 Premium은 총점에
  안 섞고 별도 배지로 분리(B안)**로 채택 — "85점의 의미가 지역마다
  달라지는 문제"를 구조적으로 방지.
- Peer group을 카테고리별로 재설계 제안(교통=기존
  `findNearbyApartments()` 재사용, 주차/단지=같은 sigungu+연식 유사,
  가격=같은 sigungu+세대수 규모 근사).
- Cache schema 2개 제안(`ApartmentLocationFeature`/
  `ApartmentMarketFeature`, 위치/시장 계열 갱신주기가 달라 분리) —
  raw feature+source+fetchedAt+qualityFlag만 저장, score/weight
  필드 없음(server-only 계산 원칙).
- **Canonical identity를 `ApartmentMaster.aptSeq`로 결론** — 단
  현재 상세페이지가 쓰는 `Apartment`(32건)와 아직 연결이 없어 S2
  전 별도 backfill(스키마 변경) 필요를 명시(BLOCKER는 아니나 선행
  과제).
- 초기 출시 범위 A(서구 V0.5)/B(부산 전체 Beta)/C(전국 대기) 비교 —
  **B(부산 전체 Beta) 추천**: 데이터가 이미 부산 전역을 커버하고,
  "다른 플랫폼" 목표(지역 특성 비교, 예: 서구=생활인프라 vs
  해운대=해변접근성)는 최소 2개 지역이 있어야 가능해 A로는 애초에
  보여줄 수 없음.
- S2를 S2A(Cache Schema)/S2B(Feature Collection)/S2C(Score Engine)
  3단계로 재정의 제안 — 배치 인프라 없이 점수부터 만드는 순서를
  방지.

DB/schema/migration/UI/production write:

**전부 무변경.** 실제 실행한 것은 read-only 쿼리(ApartmentMaster
coverage 재확인)와 Kakao 키워드 검색 1회(해변 접근성 실증)뿐 — 대량
API 호출(약 24,536회 견적)은 이번 STEP에서 실행하지 않음("임의로
확장하여 수정하지 않는다" 원칙, 정식 배치 인프라 없이 실행하지
않기로 판단). 조사용 임시 스크립트는 삭제.

상태:

STEP SCORE S1.1 완료(설계 문서만) / ApartmentMaster가 부산 전역
커버함을 재확인(서구 pilot 한계 극복) / MOLIT 가격 API가 구·군+월
단위 배치라 저비용 확인 / 해변 접근성 계산 가능성 실증, 오션뷰는
NOT_AVAILABLE 유지 / Regional Premium B안(지역 percentile 정규화)
채택 / cache schema 2종 제안 / identity를 ApartmentMaster.aptSeq로
결론 / 부산 전체 Beta 출시 범위 추천 / S2를 3단계로 재정의 제안 /
DB/schema/migration/UI 전부 무변경 / commit·push 하지 않음
(2026-08-19).

**S2_조건부_GO** — 구조 설계는 완결. S2 착수 전 (1) Apartment↔
ApartmentMaster 연결 스키마 변경 승인, (2) cache schema 승인, (3)
Kakao/MOLIT 일일 한도 사용자 확인 3가지 필요.

## 2026-08-19

### STEP SCORE S2A — Apartment Score Feature Cache Schema + Canonical Identity

작업:

- S1.1에서 사용자가 승인한 5가지(Apartment↔ApartmentMaster 연결
  설계 / 2-테이블 cache 구조 / 부산 전체 Beta / Regional Premium
  총점 미포함 유지 / 서버 전용 계산)를 실제 Prisma 스키마로 확정.
- `ApartmentMaster.aptSeq`를 점수 시스템 canonical identity로 확정
  (기존 `@unique`, MOLIT 원본 문자열 식별자).
- **Apartment 32건 매칭 감사를 실제 DB 조회로 재검증**(이름만으로
  join 금지 원칙) — region(`lawdCd`+`dong`) 후보군 내에서 jibun을
  이름보다 먼저 비교하도록 설계(1차 이름-우선 스크립트가 jibun
  완전 일치 2건을 놓치는 것을 수동 검토로 발견해 재설계). 최종
  결과: **MATCHED_EXACT 20 / AMBIGUOUS_SHARED_JIBUN 2("레이카운티"
  1~5단지, "엘지메트로시티" 1~5단지 — 같은 지번을 여러 동이 공유,
  강제 연결 안 함) / UNMATCHED_NO_REGION_CANDIDATE 10(전부 서울·
  경남 진주 — ApartmentMaster가 부산만 커버해 범위 밖, 버그 아님)**.
- MATCHED_EXACT 20건을 실측 재조회한 결과 **같은 aptSeq를 가리키는
  Apartment row 중복 6쌍 발견**(예: "대신더샵"/"대신더샵아파트") —
  `Apartment.@@unique([name, dong])`가 표기 차이를 못 막아 생긴
  기존 중복. 이 발견이 `Apartment.aptSeq`를 **unique로 걸지 않는**
  설계 근거가 됨(unique면 backfill 두 번째 row가 실패).
- `Apartment.aptSeq String?` nullable 필드 추가(index만, unique/FK
  관계 없음 — RedevelopmentSourceRecord.source를 String으로 남긴
  기존 결정과 같은 이유: ApartmentMaster는 배치가 재구축하는
  테이블이라 값 기반 느슨한 연결 채택).
- `ApartmentLocationFeature`/`ApartmentMarketFeature` 2개 신규
  테이블 필드 확정 — S1.1 제안에서 "실제 필요한 것만" 원칙으로
  트리밍(중복 반경 필드 제거), 학군/오션뷰 등 데이터 없는 항목은
  컬럼 자체를 만들지 않음, `daycareCount`는 Kakao PS3가 어린이집·
  유치원을 공식적으로 묶어 분류한다는 사실을 필드명에 반영
  (`daycareKindergartenCount500m`), `pricePerM2` 필드는 만들되 실제
  MOLIT 응답의 면적 결측률은 `EXTERNAL_VERIFICATION_REQUIRED`로
  명시(S2B 시작 시 최우선 확인).
- 점수/가중치 컬럼(`totalScore`/`transportScore`/`regionalScore` 등)
  전무 확인 — raw feature만 저장.
- `prisma migrate dev --create-only`로 migration 초안 생성(적용
  안 함, `prisma migrate status`로 미적용 재확인) — 생성된 SQL은
  `Apartment.aptSeq` nullable 컬럼 추가 + 신규 테이블 2개 + index
  1개뿐, DROP/TRUNCATE/DELETE 등 파괴적 문장 전혀 없음.
- Backfill 계획만 설계(MATCHED_EXACT 20건 대상, AMBIGUOUS/UNMATCHED
  12건 제외) — 실행은 다음 STEP.
- 서버 전용 계산 구조(`src/lib/apartment-score/server/`) 설계만
  기술, 코드 파일은 만들지 않음(다음 STEP).

DB/schema/migration 적용/production write/UI/점수 계산:

**production 변경 전부 무변경.** schema.prisma는 수정했고
migration 파일도 생성했지만 `prisma migrate deploy`는 실행하지
않음(`migrate status`로 "not yet been applied" 재확인). 매칭 감사용
임시 스크립트 2개(이름-우선 버전, 중복 검증 버전) 모두 실행 후
삭제 — 저장소에 남기지 않음.

typecheck: `npx prisma format`/`validate`/`generate` 전부 성공,
`npx tsc --noEmit` 0 errors(기존 코드가 신규 모델을 참조하지 않아
회귀 없음).

상태:

STEP SCORE S2A 완료(스키마 설계 + migration 초안) / 32건 매칭 감사
실측 완료(20 EXACT / 2 AMBIGUOUS / 10 범위밖) / aptSeq 중복 6쌍
발견으로 unique 미적용 결정 / cache 테이블 2종 필드 확정 / migration
생성만 하고 미적용 확인 / backfill·서버 계산 구조는 설계만 /
commit·push 하지 않음(2026-08-19).

**S2B_GO** — 스키마 기반 확정, 다음 STEP(실제 feature 수집 + backfill
실행)으로 진행 가능. 조건: MOLIT 면적 필드 결측률 실측이 S2B
착수 시 최우선.

## 2026-08-20

### STEP SCORE S2B — Feature Cache Production 적용 + 부산 서구·해운대 Raw Feature Collection Pilot

작업:

- S1/S1.1/S2A를 2개 논리적 commit(`4f75f50` docs, `0da7368` feat)으로
  분리해 push. production `prisma migrate deploy` 실행 성공
  (`20260819145602_score_s2a_feature_cache_schema`) — 적용 전후
  Apartment/ApartmentMaster/RedevelopmentProject/Presale row count
  전부 불변 확인.
- S2A의 jibun-우선 매칭 로직을 재구현해 dry-run한 결과가 S2A 감사
  (MATCHED_EXACT 20/AMBIGUOUS 2/UNMATCHED 10)와 정확히 일치함을
  확인한 뒤 20건만 `Apartment.aptSeq`에 backfill — 동일 backfill 2회
  실행으로 idempotency 확인.
- `KakaoPlaces.tsx`(브라우저 전용) 대신 `ai-search.ts`/
  `bus-stops/route.ts`가 이미 production에서 검증한 서버 REST 패턴을
  재사용해 `src/lib/apartment-score/collectors/{kakao,tago,location,
  market}.ts` 신규 작성 — 새 API 키 추가 없음(기존
  `NEXT_PUBLIC_KAKAO_MAP_API_KEY` 서버 재사용 관례 그대로).
- **서구 5 + 해운대 5 canary batch 실행 중 실제 버그 발견·수정**:
  Kakao "해수욕장" 키워드 검색이 상호명에 "해수욕장"이 붙은 주변
  업체(안경점/PC방/화장실 등)로 상위 15건이 채워져 진짜 해변이
  누락되는 사례를 반여동(`26350-156`) 단지에서 실측으로 발견 —
  공식 category_name 일치가 나올 때까지 최대 3페이지 조기종료
  방식(`keywordSearchNearestMatch`)으로 수정, 이후 정상 수집(5,079m)
  확인. canary idempotency(fresh-skip 0호출 + force 재실행 값 동일)
  검증 완료, 429/실패 0건.
- Canary 통과 후 사용자 사전 승인에 따라 별도 확인 없이 서구
  eligible 150건(canary 5건 제외) + 해운대 eligible 242건(canary
  5건 제외) 전체 수집 — **양쪽 다 429 rate-limit 0건, 실패 0건**.
  `ApartmentLocationFeature` 최종 402 rows.
- MOLIT 시세는 아파트별 호출 없이 서구/해운대 최근 12개월(24회
  호출)로 배치 수집 — 5,980건 원본 거래에서 **excluUseArea/
  dealAmount/aptSeq 전부 100% non-null 확인**(S2A의
  EXTERNAL_VERIFICATION_REQUIRED 우려가 기우였음을 실측으로 확정).
  이름 fuzzy matching 없이 MOLIT 원본 aptSeq로 직접 매핑. `priceChange12m`은
  24개월 기준선이 없어 계산하지 않고 null 유지(무리한 통계 금지
  원칙). `ApartmentMarketFeature` 최종 417 rows, 2회 실행 idempotency
  확인.
- Feature coverage 실측: 지하철 접근성 79~80%(실제 지하철 사각지대
  반영, 이상치 아님), 생활 POI 100%, 학교 접근성 98.4~100%(S2A가
  DEFER 검토 대상으로 남겼던 것과 달리 안정적으로 연결됨을 확인해
  DEFER 취소), 해변 접근성 100%(버그 수정 후).
- **Kakao `pageable_count` 45건 상한을 실측으로 확인**:
  `hospitalCount1000m`이 정확히 45로 찍힌 단지가 서구 74.8%, 해운대
  71.3% — 이 필드는 "정확한 개수"가 아니라 "45개 이상"으로 해석해야
  함을 S2C에 명시.
- 이상치: 음수/불가능값 0건. 기존 `ApartmentMaster` 주차대수/세대수로
  계산한 세대당 주차 비율에서 서구 2건(0.20~0.29대), 해운대 5건
  (3.19~4.84대) 극단값 발견 — raw 그대로 두고 quality 검수 후보로만
  기록. `transactionCount12m == 1`인 aptSeq가 서구 33.8%, 해운대
  17.6% — S2C 점수 엔진에서 최소 표본 조건을 별도로 걸어야 함을 명시.
- `scripts/apartment-score/verify-collectors.ts`(이 프로젝트에 별도
  테스트 러너가 없어 기존 assert 기반 관례 재사용) 작성 중 실제 버그
  발견: `median()`이 표본 1건일 때 반올림을 누락해 `Int` 컬럼에 소수를
  insert하려던 문제 — 모든 분기에 `Math.round` 적용해 수정.

DB/schema/UI/score/public API:

**migration은 production에 실제 적용했다**(§승인 범위 내). 새 점수/가중치
컬럼 없음, 새 public API route 없음(`next build` 라우트 목록 확인), UI
변경 없음, 학군 점수/오션뷰 추정 없음. `ApartmentLocationFeature` 402
rows, `ApartmentMarketFeature` 417 rows, `Apartment.aptSeq` 20 rows
backfilled — 전부 raw feature/backfill이며 점수 계산은 없음.

typecheck: `npx prisma validate`/`generate` 성공, `npx tsc --noEmit` 0
errors, `npx eslint src/lib/apartment-score scripts/apartment-score`
clean, `npx next build` 성공(신규 라우트 없음), 신규 unit 검증
10/10 pass.

상태:

STEP SCORE S2B 완료(migration 적용 + 실제 raw feature 수집) / backfill
20건 idempotent / canary에서 실제 버그 1건(해변 검색 크라우딩아웃)과
unit test에서 실제 버그 1건(median 반올림 누락) 발견·수정 / 서구
150 + 해운대 242 전체 eligible 수집, 429/실패 0건 / MOLIT 면적·가격
결측률 우려 해소(100% coverage 실측) / 지하철 접근성 결측은 실제
사각지대 반영(이상치 아님) / 학교 접근성 DEFER 취소 / Kakao 45-cap
한계 문서화 / 주차·거래표본 이상치 기록(자동수정 안 함) / 점수·가중치·
UI·public API 전부 무변경 / **commit·push 하지 않음**(사용자 지시,
ChatGPT 검수 후 처리, 2026-08-20).

**S2C_GO** — 조건: `priceChange12m`/36개월 feature(S2C에서
EXTERNAL_VERIFICATION_REQUIRED로 재확인), Kakao 45-cap 필드는 "≥45"로
해석, `transactionCount12m` 최소 표본 조건을 점수 엔진 설계에
명시적으로 반영할 것.

## 2026-08-20 (2)

### STEP SCORE S2C — Score Engine + Explanation Engine + Algorithmic Briefing Engine

작업:

- S2B를 `feat: collect apartment score raw features`(`b115202`)로 커밋·푸시.
  score 컬럼 없음/하드코딩 secret 없음/신규 public route 없음 재검수 통과.
- 구현 전 `scripts/apartment-score/analyze-score-pilot.ts`(read-only)로
  서구·해운대 raw feature 실측 분석(coverage, dong별 peer 표본 크기,
  거래표본 분포, beach/subway-price Spearman 상관)을 먼저 수행하고 그
  결과를 사용자에게 제시해 Market 총점 제외 여부와 hospitalCount1000m
  45-cap 처리 방식을 명시적으로 승인받은 뒤 구현 착수(CLAUDE.md
  분석→설계→승인→구현 원칙).
- `src/lib/apartment-score/server/`에 서버 전용 Score Engine 구현: types/
  config(scoreVersion=`EJIP_SCORE_V1_BETA`)/percentile(tie-aware, §8 null
  의미 분리)/peer-groups(LOCAL→SIGUNGU→REGION_WIDE 3단계 폴백)/
  category-helper(sub-metric 결측 비례 재분배)/categories(transport·
  living·parking·complex·schoolAccess 5개 + market은 informational-only
  별도)/regional-premium(하드코딩 없는 지역 내 percentile 기반 판정)/
  explain(결정론적 문장)/briefing(Algorithmic Briefing Engine, AI 호출
  없음)/calculate(오케스트레이터, DB read-only, score 미저장).
- `GET /api/apt/[name]/score` 신규 route 추가 — 기존 `/api/apt/[name]/
  route.ts`와 동일한 lawdCd/dong identity 관례 재사용,
  `ApartmentMaster.aptSeq`를 `sggCd`+`umdName`+`aptNamesMatch`로 확정,
  매칭 0건/2건 이상은 각각 NOT_FOUND/AMBIGUOUS로 안전 응답(다른 단지
  score 오반환 방지). weight/raw percentile/peer 규칙/정규화 공식은
  응답에 없음.
- `src/app/apt/[name]/apt-client.tsx`의 기존 "단지 브리핑"
  (`src/lib/apt-brief.ts`)을 감사한 결과 **이미 완전히 규칙 기반이라
  AI 호출이 전혀 없음**을 확인(`callGeminiJSON`은 홈 AI 검색 기능에서만
  쓰임) — 스펙이 가정한 "AI briefing" 전제와 실제 상태가 다름을 문서에
  정정 기록, 이번 STEP에서 제거/교체하지 않음.
- `scripts/apartment-score/verify-score-engine.ts`(25개 assert, DB
  미사용) + `scripts/apartment-score/run-score-pilot.ts`(DB read-only,
  서구 155건 + 해운대 247건 실제 score 산출) 작성·실행.
- **QA 중 실제 문제 발견·수정**: briefing 종합 문장에서 "단지" 카테고리가
  유일 강점일 때 "단지는 ... 눈여겨볼 만한 단지입니다"처럼 주어가
  반복되는 부자연스러운 문장을 20건 QA에서 발견 — 종결부를 "곳입니다"로
  바꿔 모든 카테고리 라벨과 겹치지 않도록 수정, 재검수로 확인.
- bias test(신축/대단지/가격/지역/missing) 전부 심각한 편향 없음을 확인.
  가격(medianPricePerM2)과 score의 중간 정도 상관(rho 0.30~0.34)은
  Market weight=0인데도 나타나는 실세계 상관관계(측정하는 입지·인프라가
  실제 가격과도 연관됨)로 판단, 회로가 가격을 직접 참조하지 않음을
  재확인. sensitivity test(카테고리 1개씩 제외)에서 서구 top10 구성이
  10/10 그대로 유지되어 특정 카테고리 독점 없음을 확인.
- 지역 간 비교: 해운대 median(50)이 서구 median(53)보다 오히려 낮아
  "해운대가 무조건 서구보다 고득점" 편향이 없음을 실측으로 확인.
- 보안: `next build` 클라이언트 번들(`.next/static`) 전체를 weight/
  threshold 관련 식별자로 grep — 0건. API secrecy는
  verify-score-engine.ts 정적 검사로 커버.

DB/schema/UI/score 저장:

**DB schema/migration 변경 없음**(`prisma/schema.prisma` git diff 없음).
score를 어떤 테이블에도 저장하지 않음(`calculate.ts`는 순수 조회+계산).
UI/페이지/컴포넌트 변경 없음(API route 신규 추가만, 아직 어디서도 호출
안 됨 — S3 연결 전).

typecheck: `npx tsc --noEmit` 0 errors, `npx eslint src/lib/apartment-score
"src/app/api/apt/[name]/score" scripts/apartment-score` clean, `npx next
build` 성공(`/api/apt/[name]/score` 라우트 등록 확인), 신규 unit
25/25 pass, pilot script 실행 완료(서구 155 + 해운대 247건).

known limitation(다음 STEP 대상): `resolvePeerPool`의 REGION_WIDE
폴백에서 타 지역 조회는 아직 구현하지 않음(현재 sigungu 표본이 항상
충분해 발동한 적 없음). "단지" 카테고리가 briefing 강점으로 과대표집되는
경향(buildYear 단일 sub-metric 의존도가 높음) — weight 재검토는 별도
승인 필요, 이번 STEP에서 임의 조정하지 않음.

상태:

STEP SCORE S2C 구현 완료 / Score Engine·Explanation Engine·Algorithmic
Briefing Engine 전부 구현 / API route 신규 추가(UI 미연결) / 서구·해운대
실데이터 pilot 완료(402건 raw feature 전부 활용, OK 402건 중 155+247)
/ bias/sensitivity 이상 없음 / briefing QA로 실제 문장 버그 1건
발견·수정 / DB/UI 무변경, score 미저장 / **commit·push 하지
않음**(사용자 지시, ChatGPT 검수 후 처리, 2026-08-20).

**S3_GO** — 조건: known limitation 2건(REGION_WIDE 폴백 미구현, "단지"
카테고리 과대표집 경향)을 S3 UI 연결 설계 시 인지하고 진행할 것.

## 2026-08-20 (3)

### STEP SCORE S3 — 아파트 상세 이집점수 UI + Algorithmic Briefing 적용

작업:

- S2C를 `feat: add apartment score engine`(`8cfdbfd`)로 커밋·푸시.
- `src/components/ApartmentScoreCard.tsx` 신규 — 이집점수 카드를 Hero
  직후·실거래 타임라인 직전에 배치(§3 권장 배치, 기존 JSX 삭제/이동 없이
  순수 추가). 총점+Beta 배지, 카테고리 compact chip(펼치면 explanation),
  Regional Strength(있을 때만), "지역 비교 기준" 캡션(80점 이상만 좋다는
  오해 방지, §19) 구성 — "학군" 표현 없이 "학교 접근성"만 사용, coverage/
  confidence 원문 enum 미노출, Market 별도 카드 없음(기존 시세 UI와 중복
  판단), 새 디자인 토큰 없이 기존 CSS 변수만 재사용.
- `src/lib/apartment-score/client-types.ts` 신규 — client에는 API 응답과
  동일한 순수 타입만 두고 `server/` 디렉토리는 어디서도 import하지 않음.
  `next build` 후 클라이언트 번들에 weight/threshold 관련 식별자 0건 재확인.
- `apt-client.tsx`에 독립적인 score fetch `useEffect` 추가(`pageReady`와
  무관, 실패해도 catch로 조용히 degrade) + 기존 "💡 단지 브리핑" 카드의
  리스트 콘텐츠만 조건부 교체 — score API의 Algorithmic Briefing(강점
  최대2/확인점 최대1/종합문장, AI 미사용)을 1순위로, score 데이터 부족 시
  기존 `apt-brief.ts`(원래부터 non-AI 규칙기반이었음, 이번에 재확인)로
  자동 폴백. `gemini.ts`/`callGeminiJSON`은 `ai-search.ts`(홈 AI 검색)
  에서만 계속 쓰이므로 삭제하지 않음.
- S2C known limitation("단지" 카테고리 briefing 과대표집)을 score
  formula/weight 변경 없이 `briefing.ts`의 selection priority 계산만
  수정(`score × weight` 곱셈으로 변경, 이전엔 band 격차가 weight 격차를
  완전히 압도) — pilot 재실행으로 강점 순서가 실제로 개선됨을 확인
  (weight 30인 "교통"이 weight 15인 "단지"보다 이제 올바르게 우선).
- **브라우저 실사용 검증 중 실제 identity matching 버그 발견·수정**: 서구
  "구덕하이츠"가 같은 동의 "구덕"과 부분포함 매칭돼(기존
  `aptNamesMatch` 관대한 규칙) 2건 매칭 → AMBIGUOUS로 잘못 표시됨을 발견.
  `route.ts`에 "정규화 후 완전 일치하는 이름이 있으면 그것만 채택, 없을
  때만 느슨한 규칙 폴백" 로직 추가 — 실측 결과 이 버그로 실제로는 계산
  가능한데 AMBIGUOUS로 잘못 표시됐을 apt가 **서구 14건 + 해운대 43건(총
  57건)**, 수정 후 두 지역 모두 AMBIGUOUS 0건. `verify-score-engine.ts`에
  회귀 테스트 추가(25→26개).
- 대표 apt 실브라우저 검증(서구 골든캐슬/구덕하이츠, 해운대
  해운대파크에비뉴, 서울 강남 래미안개포루체하임아파트=score 없는 지역)
  + mobile 375/390/430(iframe 폭 고정 방식, `resize_window` 미동작 확인된
  환경 특성 재확인) + desktop 전부 정상 렌더 확인. score-briefing 모순은
  동일 API 응답을 그대로 재사용하는 구조라 애초에 발생 불가능함을 실측
  으로도 재확인(구덕하이츠: 교통 6점 ↔ 브리핑 "교통 접근성은 다소 아쉬운
  편" 일치).

DB/schema/UI/score weight:

DB schema/migration 변경 없음. 신규 feature collection 없음. **score
formula/weight 변경 없음**(`CATEGORY_WEIGHTS` 등 `config.ts` 전부 S2C
그대로) — 이번 STEP에서 바뀐 로직은 briefing 노출 우선순위와 apt identity
매칭 두 가지뿐, 점수 계산 자체는 무변경. 기존 apt detail 기능(거래/시세/
대출/지도) 전부 회귀 없음(실측 확인).

typecheck: `npx tsc --noEmit` 0 errors, eslint clean, `npx next build`
성공, `verify-score-engine.ts` 26/26 pass, `run-score-pilot.ts` 재실행
정상(서구 155 + 해운대 247건).

상태:

STEP SCORE S3 구현 완료 / 이집점수 카드+Algorithmic Briefing 상세페이지
적용 / QA 중 identity matching 실버그(57건 영향) 발견·수정 / briefing
selection priority 개선 / mobile 3폭+desktop 검증 / DB/score weight
무변경 / **commit·push 하지 않음**(사용자 지시, ChatGPT 검수 후 처리,
2026-08-20).

**S3_CLOSE 가능** — BLOCKER 없음. **APT_DETAIL_QA_GO** — 조건: 이번에
고친 identity matching이 서구/해운대 외 지역에서도 정상 동작하는지 더
넓은 QA 필요.

## 2026-08-20 (4)

### APT DETAIL QA/IA v1 — 상세페이지 데이터 일관성 + 정보구조 정리

작업:

- S3를 `feat: add apartment score ui and briefing`(`c7cc192`)로 커밋·푸시.
- **평형칩 누락 실측 audit**: 서구/해운대 활성 거래 단지 20곳을 살아있는
  API로 직접 조회해 원인을 확정 — `AreaSelector.tsx`의 `MAX_CHIPS=4`(거래량
  상위 4개만 기본 노출) 상한이 원인이었고 데이터 손실은 아니었다(85%
  단지가 실제 5종 이상, 최대 39종까지 있어 기본 화면에서 다수 평형이
  안 보였음). 사용자 승인에 따라 상한을 제거하고 전체를 가로 스크롤 칩으로
  노출(컨테이너는 이미 overflowX:auto).
- **㎡↔평 토글 신규 구현**: `area-utils.ts`에 `getUniquePyeongLabels`(㎡
  버전과 동일한 "임의 반올림으로 다른 평형을 합치지 않는" 충돌 해소
  알고리즘을 평 단위에 적용, 공식은 정확히 `1평=3.305785㎡`)와
  `getAreaLabelsForUnit` 단일 진입점 추가. `apt-client.tsx`에 기본값 ㎡인
  토글 state(localStorage로 가볍게 기억) 추가, AreaSelector 칩·거래표
  "타입" 컬럼에 일관되게 적용. Hero의 "전용 X㎡ · 약 Y평" 이중표기는
  토글과 무관하게 유지(평 모드로 바꾸면 "약 25.4평 · 약 25.4평"처럼
  중복되는 새 버그를 피하기 위한 의도적 결정). 실거래 데이터에서
  18.009평/18.014평처럼 정밀도 escalation이 실제로 발동하는 사례를
  브라우저로 직접 확인.
- **주차정보 중복 제거**: 상단 `AptSpecGrid`와 주거환경 탭
  `LivingEnvironmentPanel`이 동일한 `총주차대수` 값을 반복 표시하던
  `ParkingGauge`를 주거환경에서 제거(상단 핵심 스펙은 유지).
- **교통/편의 IA 분리**: "교통" 탭에 섞여있던 대형마트/편의점/약국/
  어린이집·유치원/공원/병원(기존엔 "병원·공원" 한 카드) 6개 생활편의
  카드를 "주거환경" 탭으로 이동, 교통 탭은 대중교통(지하철·버스)/
  광역교통(KTX)만 남김. 컴포넌트(KakaoPlaces) 자체는 재사용, 렌더 위치만
  변경, 신규 API/카테고리 없음.
- **점수-상세 중복 검토**: 점수카드/상단 spec/주거환경/브리핑 간 실제
  3중 반복은 점수카드가 원본 숫자를 전혀 반복하지 않는 기존 설계
  덕분에 애초에 존재하지 않았음을 코드+실측으로 확인(추가 수정 없음).
- **score identity matching 광역 QA**: 수영구/남구/동래구/연제구/
  부산진구 각 10곳(총 50곳)을 살아있는 score API로 직접 호출 —
  NOT_FOUND/AMBIGUOUS/잘못된 지역 fallback 전부 0건, 전부 정상적으로
  INSUFFICIENT_DATA. 부산 전체 3,402개 apt를 대상으로 이름 충돌
  전수 스캔 — S3에서 발견된 fuzzy 매칭 충돌 461건 중 453건이 S3의
  exact-match-우선 수정으로 이미 해소됐고, 나머지 4쌍(8건)은 같은 동에
  실제로 완전히 동일한 이름의 apt가 2건씩 존재하는 경우라 AMBIGUOUS로
  안전하게 처리되는 것이 맞음(DATA_REVIEW_CANDIDATE로 분류, 임의 병합
  안 함).
- `scripts/apartment-score/verify-apt-detail-ia.ts` 신규(13개 assert) —
  평 변환 공식/면적 무병합/toggle 단일 진입점/칩 상한 제거/주차 중복
  제거/교통·주거환경 IA 이동을 정적+로직 검증.

DB/schema/UI:

DB schema/migration 변경 없음. 신규 feature collection 없음. UI는
`AreaSelector`/`apt-client.tsx`/`LivingEnvironmentPanel`/
`NeighborhoodInfoPanel` 4개 파일만 수정 — section 전체 재배치는 사용자
결정에 따라 이번 STEP에서 하지 않음(다음 STEP 후보로 남김).

typecheck: `npx tsc --noEmit` 0 errors, eslint clean, `npx next build`
성공, 기존 `verify-score-engine.ts` 26/26 pass(회귀 없음) + 신규
`verify-apt-detail-ia.ts` 13/13 pass.

상태:

APT DETAIL QA/IA v1 구현 완료 / 평형칩 누락 근본원인 확정 및 수정
(UI_DESIGN_LIMITATION, 데이터 문제 아님) / ㎡↔평 토글 신규 구현 / 주차
중복 제거 / 교통·편의 IA 분리 / score identity matching 부산 전역
검증(50곳 실호출 + 3,402개 전수 스캔, wrong score fallback 0건) /
DB/score weight 무변경 / **commit·push 하지 않음**(사용자 지시, ChatGPT
검수 후 처리, 2026-08-20).

**APT_DETAIL_QA_CLOSE** — BLOCKER 없음. unresolved 3건(진짜 동일이름
4쌍 데이터 검토, section 전체 재배치, Hero 이중표기-토글 통합 여부)은
전부 다음 STEP 후보로 문서화.

## 2026-08-20 (5)

### APT DETAIL QA/IA v1 FINAL — typography / 버스 로딩 / 검색 UI 추가 QA

작업:

- **Typography audit**: 상세페이지 전체 font-size를 grep 전수 확인, 11
  ~12px 미만 텍스트 7곳 발견해 상향(AptSpecGrid 라벨 0.68rem→0.78rem,
  "정보 없음" 0.72rem→0.8rem, "제보/수정" **0.62rem(9.9px)→0.75rem
  (12px)**, StickyPriceBar 라벨/거래표 헤더 0.7rem→0.78rem, 거래표
  증감 배지 0.65rem→0.72rem, 이집점수 Beta 배지 0.7rem→0.75rem).
  AptSpecGrid `.cell` min-height도 68px→76px로 소폭 조정. 브랜드 전체
  typography 체계는 새로 만들지 않고 상세페이지 범위 개별 값만 수정,
  이미 12px 이상인 텍스트는 그대로 둠.
- **버스 로딩 지연 원인 추적**: `/api/transit/bus-stops` 실측 결과 최초
  (캐시 미스) 호출 **3.4초**, 캐시 hit 시 **0.02~0.03초** — 서버는 이미
  `getOrSetCache`로 6시간 캐싱 중이었고, 지연의 실체는 **TAGO(국토교통부
  공공데이터) 외부 API 자체의 콜드 스타트 응답 시간**임을 확정(정류소
  조회 후 노선 조회가 구조상 순차적이라 지연이 누적됨) — 프론트엔드
  워터폴 문제가 아님. 실제 개선: (1) `apt-client.tsx`의 환경/교통/학군
  탭이 조건부 렌더로 매번 unmount/remount되며 재방문마다 재호출하던
  문제를 `visitedInfraTabs` state로 고쳐 한 번 연 탭은 계속 마운트해두고
  `display:none`만 토글(첫 방문 전에는 마운트 안 해 호출 증가 없음,
  브라우저로 재방문 시 `bus-stops` 요청 0건 확인) — API 호출 수 증가
  없이 재방문 재호출 제거. (2) `BusAccessCard`/`KakaoPlaces`의 밋밋한
  "검색 중입니다..." 텍스트를 최종 콘텐츠 모양의 skeleton으로 교체(외부
  API 지연 자체는 줄이지 않되 체감 개선). geocoding 공유 구조 변경은
  검토했으나 지연의 실질 원인이 TAGO 자체라 효과 대비 위험이 커 보류.
- **상세 상단 검색 UI**: `ApartmentSearchTrigger.tsx` 신규 — 기존 38×38
  원형 이모지(🔍) 아이콘 버튼(Header가 이미 잡아둔 flex:1/max-width:320px
  검색창 자리에 어중간하게 떠 있던 것)을 Lucide `Search` 아이콘 + "아파트명,
  지역명 검색" placeholder가 보이는 완성된 검색창 모양으로 교체 — height
  44px(터치 영역), hover/focus-visible 상태 추가, 클릭 시 여는 기존
  `ApartmentQuickSearch` 모달/라우팅은 완전히 그대로.

DB/schema/UI:

DB schema/migration 변경 없음. UI는 typography 값/버스 skeleton/검색
버튼/탭 캐싱 로직만 수정 — 새 라우트·새 API 없음.

typecheck: `npx tsc --noEmit` 0 errors, eslint clean, `npx next build`
성공, 기존 unit 26/26 + 13/13 pass(회귀 없음), 브라우저 실측(375/430+
desktop, console error 0건, 탭 재방문 시 bus-stops 재호출 0건).

상태:

APT DETAIL QA/IA v1(1차 + 추가 UX QA) 전체 완료 — 평형칩/주차중복/교통
편의 IA/score identity 광역 QA(1차) + typography/버스로딩/검색UI(추가)
전부 tsc/eslint/build/unit test/실브라우저 검증 통과.
**commit·push 진행**(사용자 지시, 2026-08-20).

**APT_DETAIL_QA_CLOSE(FINAL)** — BLOCKER 없음.

## 2026-08-20 (6)

### DESIGN SYSTEM 1 — 전체 UI/UX 아이덴티티 감사 + 디자인 시스템 설계

작업(전부 audit/문서, **페이지 코드 변경 없음**):

- 4개 병렬 조사로 Home/Map/AI검색, Statistics(16개 메뉴 전체),
  Presale/Redevelopment/School/Community/Auth/My, design tokens+
  component inventory를 실제 코드 읽기 기반으로 전수 조사.
- **핵심 발견 1**: `globals.css`가 모바일(≤768px)에서 root font-size를
  16px→14px로 전역 12.5% 축소(`:98-101`, 주석에 의도적으로 명시) —
  직전 STEP(APT DETAIL QA/IA)에서 "12px 이상"으로 상향한 값들도 모바일
  에서는 그보다 12.5% 작게 렌더링됨을 확인. "글자가 너무 작다" 반복
  피드백의 구조적 원인 후보로 문서화, 제거는 제안만(승인 필요).
- **핵심 발견 2**: 브랜드 그린이 두 값(`--primary-color:#03c75a` 기존
  vs `--ejip-green:#13A367` 신규, BRAND STEP 56-B2) 공존 중이며 결정이
  계속 보류돼 있음 — 신규 토큰은 Redevelopment 일부 배지 + KakaoShareButton
  + Brand 컴포넌트 6개 파일 19곳에서만 부분 사용돼 그 자체로 새 불일치를
  만들고 있음을 확인.
- **Statistics 전수 감사**(가장 중요 지시대로): 16개 메뉴(10 live+6
  soon) 중 라이브 10개가 **6개의 서로 다른 컴포넌트 구현**으로 나뉘어
  있고, 공유 filter 컴포넌트가 하나도 없으며, `#ef4444` 빨강이 4가지
  무관한 의미(상승률/갭투자 절대값/5분위 최고구간/랭킹 1등)로 재사용되고,
  서로 무관한 두 개의 5색 팔레트가 존재하며, Lucide 아이콘 0개(16개
  메뉴 전부 emoji), 진짜 skeleton 로딩은 1곳뿐(나머지는 평문 "분석
  중입니다..."), "미구현" 상태와 "0건" empty 상태가 시각적으로 구분
  불가함을 실측 확인.
- 정의되지 않은 CSS 변수(`--background-color`, `--bg-light`)가
  Community/My/School/Stats/Admin/Home에서 실제로 참조되고 있음(dangling
  reference), `--primary-color`를 우회한 하드코딩 리터럴 3곳(`stats/
  page.module.css:627`, `map/page.tsx:698,725`) 발견.
- radius 14종 리터럴 분산(pill만 4가지 값: `999px`/`99px`/`9999px`/
  토큰), 하드코딩 hex 260개(83 tsx + 177 css, apartment-score 모듈
  제외), 인라인 fontSize 135곳(26개 파일) — 전부 `globals.css`의
  `.text-h1~.text-xs` 유틸리티(정의만 있고 실사용 0건, 죽은 코드)를
  우회.
- 컴포넌트 인벤토리: `src/components/` 38개 중 7개(18%, `KakaoScriptLoader`
  /`SearchFilter`/`Hero`/`MarketInsights`/`TableList`/`CardList`/
  `SearchFilterBar`)가 어디서도 import되지 않는 죽은 컴포넌트로 확인.
  School/Neighborhood/LivingEnvironment 3개 패널이 동일한 `cardStyle`
  객체를 복사-붙여넣기 중인 것도 확인.
- 클러스터별 baseline(Apartment Detail 토큰 준수) 대비 정렬도: Presale
  최고 정렬 → Redevelopment(카드는 정렬, 탭 라벨에 emoji 직접 포함이
  흠) → Home/AI-search(자체적으로 일관됨, Map만 예외) → School/
  Community/My(토큰 거의 미사용, 하드코딩 radius/shadow/border, 최다
  emoji) 순으로 실측 정리.
- 24개 섹션(typography/color/spacing/radius/shadow/button/search/
  filter/chip/badge/card/header/nav/loading/empty/error/mascot/table/
  responsive/a11y/archetype/statistics/inventory/token/roadmap)에 걸쳐
  구체적 제안값을 문서화 — typography scale(Display~Caption 7단계,
  12px 하한 명문화), color semantic 테이블(신규 `--warning-color`/
  `--error-color`/`--info-color` 제안, `--up-color`를 에러 텍스트와
  분리), spacing/radius/z-index 토큰 제안, Statistics V2 선행조건
  8개 항목 확정.

DB/schema/UI 변경: **없음.** 이번 STEP은 원칙대로 감사+설계 문서만
생성했다 — 페이지/컴포넌트 코드를 전혀 수정하지 않았다. 토큰 추가,
모바일 전역 폰트 축소 제거, 브랜드 그린 통일, `--text-muted` contrast
조정 등 시각적 영향이 있는 foundation 변경은 전부 **제안만 하고 구현
전 승인 요청**으로 문서에 명시(DS-2 단계).

상태:

DESIGN SYSTEM 1(감사+설계) 완료 — 8개 페이지 클러스터 + 16개 Statistics
메뉴 + design tokens + 38개 컴포넌트 전수 조사, 가장 심한 불일치 10개
확정, migration roadmap(DS-2~DS-6) 및 Statistics V2 선행조건 8개 문서화.
**commit·push 하지 않음**(사용자 지시, ChatGPT 검수 후 처리, 2026-08-20).

**DESIGN_SYSTEM_2_GO** — 조건: 그린 색상 결정(§2-2)과 모바일 전역
폰트 축소 제거 여부(§3.3)를 DS-2 착수 전 먼저 승인할 것 — 이후 단계의
색/타이포 작업이 전부 이 두 결정에 의존한다.

## 2026-08-20 (7)

### AREA MODEL V1 — 아파트 면적/평형 정보모델 감사 + 사용자 표기 기준 확정

작업(전부 audit/read-only 조사, **코드 변경 없음**):

- 면적 관련 실제 source 전수 조사: MOLIT 실거래 API(전용면적, 필드명
  자체가 `전용면적`/`excluUseAr`으로 확인), `ApartmentMaster`(3,402건,
  면적 필드 0개), `Apartment`(32건, 면적 필드 0개), `PresaleHouseTypeDetail`
  (5,395건, `supplyArea`+`houseTy` 실존 — 단 청약홈 분양공고 도메인
  전용). 건축물대장 수집기(`apt-building-info.ts`)도 재확인했으나
  단지 전체 합산값만 제공해 타입별 면적 분해가 원천적으로 불가능함을
  확인.
- **공급면적 coverage 실측**: 서구+해운대 `ApartmentMaster`(479건)와
  부산 `Presale`(85건)을 `aptNamesMatch`로 전수 대조 — fuzzy 매칭
  37건 발생했으나 대부분 "롯데"/"경남" 등 짧은 이름의 명백한 오탐,
  실제 동일 단지 가능성이 있는 건 1건("e편한세상송도더퍼스트비치")뿐
  — **공급면적 coverage는 사실상 0%**, `SUPPLY_AREA_NOT_AVAILABLE`로
  명확히 선언.
- **near-duplicate 실측 감사**: 서구 3곳/해운대 3곳/부산진구 2곳/
  동래구 2곳(10개 단지, 5,240건 거래) 살아있는 API로 전수 조회 — diff
  <0.05㎡ 근접쌍(동일 타입일 가능성 높음)과 0.15~0.47㎡ 근접쌍(다른
  타입일 가능성 높음)이 뚜렷이 두 그룹으로 나뉨을 확인. 특히 "경동"
  단지에서 서로 무관한 3개 면적대(220/221/222㎡대)가 전부 정확히
  동일한 0.0045㎡ 차이를 보여 시스템적 정밀도 변환 흔적으로 추정.
  단, 타입코드 부재로 개별 사례를 최종 확정(B/C)하지 못하고 대부분
  "E. 판단 불가"로 정직하게 분류.
- **grouping 정책 확정**: type code(§13 우선순위 1)/supply+exclusive
  (2)/verified mapping(3)이 전부 오늘 사용 불가함을 확인 → 유일하게
  안전한 4번(정확한 전용면적, 병합 없음)을 유지하는 것이 결론 —
  diff<0.05㎡의 통계적 경향이 있어도 자동 병합 기능을 새로 제안하지
  않음(직전 STEP에서 칩 상한을 이미 제거해 "칩이 너무 많다"는 문제
  자체가 해소돼 있어 병합의 실익보다 위험이 크다고 판단).
- "평형" 사용 조건 확정: 검증된 공급면적이 있을 때만 사용, 전용면적만
  있으면 "약 N평"(평형 아님)으로만 표시 — 기존 `formatPyeong()`이
  이미 이 원칙을 지키고 있음을 확인, 단 칩 레벨 평 라벨("N평")과
  Hero 표기("약 N평")의 "약" 접두어 불일치를 발견(경미한 unresolved).
- `AreaChip` contract 제안(§19) — `supplyAreaM2: number | null` 필드
  하나로 오늘(전용만)과 향후(공급 확보 시) 두 상태를 자동 분기하도록
  최소 설계, `exclusiveAreaVariants` 같은 병합 배열은 포함하지 않음
  (병합 자체를 채택하지 않았으므로).
- 부산 pilot(서구 3+해운대 3+부산진구 2+동래구 2 = 10개 단지) 표
  작성 — 전부 공급면적 미존재, 전부 현재 정책이 최선의 안전한 선택
  임을 확인.

DB/schema/UI 변경: **없음.** 이번 STEP은 결론 자체가 "현재 정책이
이미 안전한 최선이라 코드를 바꿀 필요가 없다"였다 — 임시 조사
스크립트는 실행 후 전부 삭제.

상태:

AREA MODEL V1(감사+설계) 완료 — 전용/공급/계약면적 의미 분리, 공급면적
coverage 0% 실측 확정, near-duplicate 10개 단지 5,240건 전수 분석,
grouping 정책(병합 없음 유지) 확정, AreaChip contract를 DESIGN SYSTEM 2에
전달. **commit·push 하지 않음**(사용자 지시, ChatGPT 검수 후 처리,
2026-08-20).

**AREA_MODEL_V1_CLOSE** — BLOCKER 없음. unresolved 3건(약 접두어
통일, e편한세상송도더퍼스트비치 1건 매칭 검증, 공급면적 외부 수집은
별도 승인 STEP)은 전부 다음 STEP 후보로 문서화.

**DESIGN_SYSTEM_2_GO** — AREA MODEL V1의 AreaChip contract(§32)가
DS-2의 chip/typography/touch-target 규칙에 이미 반영 가능한 형태로
준비됨.

## 2026-08-20 (8)

### DESIGN SYSTEM 2 — Foundation Tokens + Typography + Semantic Color + Core Components

작업:

- `globals.css` 토큰 foundation 전면 재작성: 브랜드 그린 `#13A367`을
  `--primary-color`/`--rank-1` alias로 확정(`#03c75a`는
  `--legacy-naver-green`으로 보존, 즉시 삭제 안 함), semantic color
  (`--warning/--info/--error-color`)를 `--up/--down-color`와 분리,
  `--text-muted` WCAG AA 대비 조정(`#8f8f8f`→`#6b7280`), typography
  scale 7단계(`--font-size-display`~`--font-size-caption`, 12px 하한),
  spacing 9단계/radius 6단계/control-height 3단계(md=44px 터치 타깃)
  토큰화, undefined 토큰(`--background-color`/`--bg-light`) 해소.
- 모바일(≤768px) root font-size 14px 전역 축소 규칙 제거 — 16px로
  통일(DS-1에서 지목된 "글자가 너무 작다" 구조적 원인 제거).
- 하드코딩된 `#03c75a` 3곳(`stats/page.module.css`, `page.module.css`
  2곳)을 `--primary-color`로 교체.
- 신규 foundation 컴포넌트 4개 추가: `Chip`/`Badge`/`SectionHeader`/
  `AreaChip`(`src/components/ui/`) — `AreaChip`은 AREA MODEL V1 §19
  contract를 그대로 구현하고, "`supplyAreaM2`가 null이면 `pyeongLabel`이
  있어도 평형 표기 금지" 규칙을 `src/lib/area-chip-rules.ts`의 순수
  함수로 분리해 구조적으로 강제(개발 모드 계약 위반 시 `console.warn`).
- `AreaSelector.tsx`의 인라인 칩 마크업을 위 `Chip`/`AreaChip`으로
  교체 — 라벨/active 스타일/전체 가로 스크롤/모달 동작을 브라우저
  실측으로 100% 동일 확인(시각적 변경 없음, 리팩터링만).
- **회귀 발견 및 수정**: root font-size 16px 복구 후 375px 폭에서
  `TradeTimelineList`(아파트 상세 실거래 테이블)의 가격 셀이 말줄임
  (`...`)되는 걸 실측 발견 — 14px로 되돌리는 우회 대신 각 셀의 실제
  렌더링 폭을 측정해 `colgroup` 비율 재배분(22/14/36/28%→17/14/44/25%)
  + 계약월 연도 표기 4자리→2자리 축소로 원인 자체를 수정. 375/390/
  430px + 데스크톱에서 로드된 60개 행(최고 33억) 전부 overflow 없음
  확인.
- `scripts/apartment-score/verify-design-system-2.ts` 신규(22개 assert:
  AreaChip 평형 게이팅, AreaSelector wiring, 토큰 foundation, 하드코딩
  제거, 접근성, 375px 회귀 수정 정적 검증) — 기존
  `verify-apt-detail-ia.ts`(13개)도 재실행해 회귀 없음 재확인.

미구현(문서만, DS-3 대상으로 명시 — `DESIGN-SYSTEM-2-foundation.md` §10):

Search 변형(HeaderSearchTrigger/HeroSearch), Button 변형, Card
foundation(BasicCard/ListRow/StatusCard), Filter foundation, BottomNav/
Header 컴포넌트 추출, Loading/Empty/Error 3-tier 공통 컴포넌트 — 전부
코드로 구현하지 않고 다음 STEP 대상으로만 문서화했다.

DB 변경:

없음(`prisma/schema.prisma` 미변경)

API/비즈니스 로직 변경:

없음

검증:

`npx tsc --noEmit` 0 errors / `npx eslint src` 0 errors(무관 기존
warning 3건만) / `npx next build` 성공 / 신규 22개 + 기존 13개 assert
전부 PASS / 브라우저 실측(Home/Statistics/Map/Redevelopment/Presales/
Apt-Detail, 375·390·430px+데스크톱).

상태:

DESIGN SYSTEM 2(foundation 구현) 완료. **commit·push 하지 않음**
(사용자 지시, ChatGPT 검수 후 처리, 2026-08-20).

## 2026-08-20 (9)

### DESIGN SYSTEM 2 — commit + push

DS-2 ChatGPT 검수 승인 반영: 실제 변경 파일(6개 수정 + 11개 신규,
DS-2 보고의 "신규 5개"는 정정)을 `feat: establish ejip design system
foundation`(`88d074d`)로 커밋하고 origin/main에 push했다. Push 후
`git status` clean, `HEAD == origin/main == 88d074d` 확인.

### DESIGN SYSTEM 3 — Common Components + Header / Bottom Navigation Integration

작업:

- 공용 foundation 컴포넌트 8개 신규(`src/components/ui/`): `Button`
  (primary/secondary/tertiary/destructive/icon × sm/md/lg), `FilterBar`/
  `FilterChip`/`SelectFilter`, `Card`(basic/interactive/status 1개
  컴포넌트로 통합), `Empty`(noData/noResult/notReady), `ErrorState`
  (inline/section/page, **마스코트 미사용** — 기존 mascot README 정책
  준수), `BottomNav`(map 페이지의 인라인 MapBottomNav 대체),
  `SectionSkeleton`/`InlineLoading`(컴포넌트만, 실사용처는 다음 STEP).
- Search는 재구현 없이 기존 `HomeApartmentSearch`(HeroSearch 역할)/
  `ApartmentSearchTrigger`(HeaderSearchTrigger 역할)를 그대로 확정.
  Header.tsx도 재작성 없이 감사만(이미 prop 기반 variant 구조로 DS1의
  "4 variant" 요건을 충족하고 있었음) — 활성 탭 `aria-current`,
  모바일 하단탭바 `safe-area-inset-bottom`만 보강.
- **BottomNav 5개 메뉴 감사 완료**: 홈/지도/통계/재개발·분양/MY 각각
  역할·중복 없음 확인, 5개 유지 결정. 6개 시뮬레이션(개발용 임시
  실험, 제품 미반영) 결과 항목당 폭이 75px→62.5px(-17%)로 줄어
  향후 여유가 사라지는 것을 실측 확인 — 5개 유지를 뒷받침.
- **AREA MODEL V1 §24/§33 unresolved 해소**: Hero의 "약 N평"과 칩/
  거래표의 "N평" 불일치를 `area-utils.ts`의 `pyeongLabelAtPrecision()`에
  "약 " 접두어를 추가해 통일(값/정밀도 로직은 미변경, 문자열만).
  이로 인해 `TradeTimelineList`가 375px에서 재발한 overflow(60건 중
  21건)를 재실측으로 잡아 colgroup 비율을 ㎡/평 두 단위 모두 0건이
  되도록 재조정(16/13/43/28%, padding 0.15rem).
- **wiring 중 발견+수정한 실제 버그**: presales/redevelopment 에러
  상태가 기존에 확정된 mascot 정책("에러 상태는 신뢰감을 캐릭터보다
  우선")을 위반해 `ejipy-error.webp`(+presales는 `⚠️` emoji까지)를
  쓰고 있었다 — `ErrorState` 컴포넌트로 교체하며 정책 위반을 함께
  해소했다.
- presales-client.tsx/RedevelopmentListSection.tsx에 FilterBar+
  SelectFilter+Card+Empty+ErrorState+Button 전부 wiring(두 파일이
  거의 동일한 filterBar/stateBox/card/pageBtn 패턴을 반복하고 있어
  동시 적용), 각 CSS 모듈에서 대체된 중복 스타일 제거(30~60줄씩).
  redevelopment-client.tsx 탭 emoji(🏢/🏗️)를 Lucide로 교체.
  Home 퀵액션 2개, apt 상세 quick buttons 3개(LOCKED 구조의 명시적
  승인 예외), `/stats/[type]` 갭투자 패널 1곳(SectionHeader+ErrorState)
  에도 최소 wiring.

미구현/다음 STEP 대상(`DESIGN-SYSTEM-3-common-components-and-navigation.md`
§23-24):

Statistics 16개 메뉴 + 다른 통계 패널들의 emoji 대량 잔존(Statistics
전체 개편 금지 원칙과 충돌 방지 위해 이번 STEP에서 건드리지 않음),
SectionSkeleton/InlineLoading/FilterChip 실사용처 미연결.

DB 변경:

없음(`prisma/schema.prisma` 미변경)

API/비즈니스 로직 변경:

없음(통계 계산·순위·필터 state 로직 미변경, UI wrapper만 교체)

검증:

`npx tsc --noEmit` 0 errors / `npx eslint src` 0 errors(무관 기존
warning 3건만) / `npx next build` 성공(동일 30 route) / 신규
`verify-design-system-3.ts` 18개 + 기존 22개(DS-2) + 13개(APT DETAIL
QA/IA) = 53개 전부 PASS / 375·390·430·1024·1280px 가로 overflow 0건 /
브라우저 실측(Home/Map/Apartment Detail/Statistics/Presales/
Redevelopment/School/Community).

상태:

DESIGN SYSTEM 3(공용 컴포넌트 + 내비게이션 통합) 완료. **commit·push
하지 않음**(사용자 지시, ChatGPT 검수 후 처리, 2026-08-20).

**STATISTICS_V2_GO** — Filter/Card/SectionHeader가 실제 페이지에서
wiring+검증된 상태로 확보됨(단, 16개 메뉴 emoji 정리를 V2 착수 시
함께 처리 권장).

## 2026-08-20 (10)

### DESIGN SYSTEM 3 — commit + push

DS-3 ChatGPT 검수 승인 반영: 37개 파일(수정 15 + 신규 22)을
`feat: unify ejip common components and navigation`(`a7f786e`)로
커밋하고 origin/main에 push했다. Push 후 `git status` clean,
`HEAD == origin/main == a7f786e` 확인.

### STATISTICS V2 — 전체 통계 UX/정보구조 재설계 + 이집형 판단형 통계 플랫폼

작업:

- **데이터 로직 감사(계산 변경 없음)**: `/api/stats/rankings`(추세
  N건 평균 비교, rent 오염 필터링)와 `/api/stats/dashboard`(gapInvest,
  전세가율)를 전수 감사 — 기존 로직이 대부분 이미 건전함을 확인했고,
  **gapInvest가 매매/전세 비교 시 같은 면적인지 검증하지 않는 ISSUE를
  발견**했다(BLOCKER 아님, 계산은 그대로 두고 화면에 disclaimer만
  추가).
- 공용 helper 신규 2개: `src/lib/stats-format.ts`(퍼센트/거래건수/
  방향색/저표본 판정), `src/lib/stats-insight.ts`(deterministic
  1줄 판단 요약 — AI 생성 없음, "매수 추천"류 표현 없음, 표본 3건
  미만은 항상 "적어 참고용" 명시).
- `src/components/ui/RankingRow.tsx`(+`RankingList`) 신규 — 기존
  `compactItem` 순위 리스트 마크업을 그대로 공용 컴포넌트로 승격,
  decline/record-high/rising/top-traded/jeonse-risk/gap-invest
  6개 화면이 공유.
- `/stats/[type]` 5개 뷰(RankingListView/VolumeView/GapInvestView/
  CompareView/PriceMapView) 전부에 SectionHeader/Empty/ErrorState/
  InlineLoading/FilterChip(매매·전세·월세 토글, DS-3에서 미사용이던
  컴포넌트 첫 실사용) wiring, "데이터 → 해석 → 판단" 구조로 통계
  헤더 최상단에 deterministic insight 문장을 노출.
- 순위 색상을 하드코딩 근사값('#ef4444'/'#3b82f6')에서 DS-2 시맨틱
  토큰(`--up-color`/`--down-color`)으로 통일.
- **emoji 전수 제거**(이번 STEP이 직접 손댄 파일만): 16개 메뉴
  아이콘 + 지역선택 📍 + 분석팁 💡 + 그래프/표 토글 + 준비중 카드
  📦 + 학군/도구 바로가기, 전부 Lucide로 교체. `STATS_MENU`에
  `category`(5개: 가격/거래/수요·공급/지역/비교·분석)/`Icon` 필드
  추가.
- `/stats` landing을 5개 카테고리 그리드로 재설계(라우트/메뉴 구성은
  그대로, grouping과 아이콘만 교체).
- 12px 미만 typography(`0.65rem`/`0.6rem`/`0.72rem`, 순위 리스트·
  뱃지·토글 버튼) 전부 `--font-size-caption`(12px)로 상향.
- 이제 미사용이 된 `compactList`/`compactItem`/`emptyState`류 CSS를
  `stats/page.module.css`에서 제거.

미구현/다음 STEP 대상(`STATISTICS-V2-design-and-judgment-system.md`
§41):

gapInvest 면적 매칭 정확도 개선(계산 로직 변경 필요, 별도 승인),
이집점수 배치 조회 API 부재로 랭킹 화면 점수 통합 보류, 필터 state
(기간/거래유형)의 URL 미보존, 공유 버튼 실제 구현(SHARE-2),
`SectionSkeleton` 실사용처 없음.

DB 변경:

없음(`prisma/schema.prisma` 미변경)

API/비즈니스 로직 변경:

없음(`/api/stats/*` 라우트 코드 미변경 — 감사만 수행, UI/설정
파일만 수정)

검증:

`npx tsc --noEmit` 0 errors / `npx eslint src` 0 errors(무관 기존
warning 3건만) / `npx next build` 성공(동일 30 route) / 신규
`verify-statistics-v2.ts` 20개 + 기존 53개(DS-2/DS-3/APT-IA) = 73개
전부 PASS / 375·390·430·1024·1280px, live 10개+soon 3개+landing = 13
route 가로 overflow 0건, console 에러 0건.

상태:

STATISTICS V2 완료. **commit·push 하지 않음**(사용자 지시, ChatGPT
검수 후 처리, 2026-08-20).

**STATISTICS_V2_CLOSE** — BLOCKER 없음. **SCORE_V1_1_GO** 조건부 —
이집점수 배치 조회 API가 먼저 필요.

## 2026-08-20 (11)

### STATISTICS V2 — commit + push

STATISTICS V2 ChatGPT 검수 승인 반영: 11개 파일(수정 5 + 신규 6)을
`feat: redesign ejip statistics experience`(`dcc5168`)로 커밋하고
origin/main에 push했다. Push 후 `git status` clean, `HEAD ==
origin/main == dcc5168` 확인.

### STATISTICS V2.1 — Gap Investment Data Correctness Hotfix

작업:

- **실측으로 버그 규모 확인**: 부산 서구(lawdCd 26350) 최근 3개월
  실거래로 기존 gapInvest 로직을 재현 — 갭 후보 133건 중 **68건(51%)
  이 서로 다른 전용면적의 매매/전세를 뺀 값**이었다(예: "엘지"
  49.83㎡ 매매 vs 134.94㎡ 전세). "가끔 발생하는 예외"가 아니라
  단지명만으로 묶고 배열 순서를 신뢰하던 구조적 결함이었음을 확인.
- `src/lib/gap-invest-calc.ts` 신규 — pairing 로직을 API 라우트에서
  순수 함수(`buildGapCandidates`)로 분리해 단위 테스트 가능하게 함.
  pair key를 `(정규화된 단지명, 정확한 raw 전용면적)`으로 변경(AREA
  MODEL V1 원칙 그대로 — 84.99와 84.996은 병합하지 않음), "최근"
  거래는 `dealDate` 기준 명시 정렬로 선택(API 응답 순서를 신뢰하지
  않음), 취소(해제)된 매매 거래 제외.
- **트레이스 중 추가 발견**: gapInvest가 전세+월세를 필터링 없이 섞어
  쓰고 있었다(같은 파일의 전세가율 계산은 이미 순수 전세만 사용 —
  gapInvest만 빠져 있었음). 표본에서 46%(637/1,373건)가 월세였다 —
  함께 수정(순수 전세만 사용).
- `/api/stats/dashboard/route.ts`의 gapInvest 블록을 이 함수 호출로
  교체(순수 리팩터, 전세가율(§6) 계산은 기존 단지명 단위 그대로 유지
  — 이번 STEP 감사 대상 아님).
- 갭투자 화면 disclaimer 문구를 계산과 정확히 일치하도록 수정 —
  "면적이 다를 수 있음"(이제 항상 동일 면적이라 부정확한 문구, 제거)
  → "동일 전용면적의 최근 매매·전세 거래 기준, 계약 시점은 다를 수
  있음"(실측 결과 시간차 0~72일·평균 21일로 여전히 남아있는 실제
  한계라 유지).
- `scripts/apartment-score/verify-statistics-v2-1-gap-invest.ts`
  신규 — 사용자 지정 테스트 케이스 A~H(동일면적 pair/다른면적 no-pair/
  다중매매·전세 최신선택/입력순서 무관/매매or전세 결측시 no-gap/근접
  정밀도 강제병합 없음) 전부 + 추가 3건, 총 15개 assert.

DB 변경:

없음(`prisma/schema.prisma` 미변경)

API/비즈니스 로직 변경:

**있음, 의도된 것** — `/api/stats/dashboard/route.ts`의 gapInvest
계산 로직을 수정했다(이번 STEP의 목적 자체가 이 계산의 correctness
hotfix). 다른 모든 계산(전세가율/거래량/hotIssues/topPrices 등)과
Statistics UI는 변경하지 않았다.

검증:

`npx tsc --noEmit` 0 errors / `npx eslint src` 0 errors(무관 기존
warning 3건만) / `npx next build` 성공(동일 30 route) / 기존 73개 +
신규 15개 = **88개 전부 PASS** / `/stats/gap-invest` 375·390·430·
1024·1280px 가로 overflow 0건.

상태:

STATISTICS V2.1 완료. **commit·push 하지 않음**(사용자 지시, ChatGPT
검수 후 처리, 2026-08-20).

**STATISTICS_V2_1_CLOSE** — BLOCKER 없음.

## 2026-08-20 (12)

### STATISTICS V2.1 — FINAL IDENTITY CHECK

gapInvest pair identity를 부산 4개구(해운대/부산진/동래/서구, 5,695건,
835개 정규화 단지명) 실측으로 최종 검증했다.

- **정정**: 직전 STEP 문서가 lawdCd 26350을 "부산 서구"로 잘못 표기한
  것을 발견 — 실제로는 해운대구였다(공공 법정동코드 API로 직접 확인
  후 정정, 우동/좌동/재송동 등 동 이름이 근거).
- **aptSeq 필드가 4개구 전체에서 100% 존재**(2,134/2,068/1,113/380건)
  하고, 매매 API·전세 API 간 교차 일치율 99.5%(404/406)임을 확인.
  불일치 2건을 직접 조사해 **데이터 결함이 아니라 실제로 이름·동까지
  같은 서로 다른 단지**였음을 확인(부산진구 "수목하우스" 양정동 —
  지번 343-3 vs 141-10, aptSeq 26230-2325 vs 26230-2485). **동(dong)
  단위 폴백만으로는 이 충돌을 잡지 못한다**는 걸 실측으로 증명.
- 같은 정규화 이름이 2개 이상 동에 분산된 사례 11/835(1.3%, 예: "삼익"
  이 부산진구·동래구 각각에서 서로 다른 동에 2곳씩 존재) — 오늘 표본
  에서는 동일 면적 충돌이 0건이었지만 구조적으로 배제되지 않는 위험.
- `src/lib/gap-invest-calc.ts`의 pair key를 **aptSeq 우선(없을 때만
  (dong, 정규화 이름) 폴백) + exact exclusiveArea**로 승격 — 오늘의
  사고를 되돌린 게 아니라 향후 발생할 수 있었던 동명이인 오염을
  선제적으로 막는 하드닝.
- `dashboard/route.ts`가 요청당 정확히 하나의 `lawdCd`만 해석하고
  캐시 키까지 그 값에 고정됨을 코드로 확인 — 다른 지역 동명이인 혼입은
  구조적으로 불가능함을 문서화(추정이 아닌 코드 인용).
- `verify-statistics-v2-1-gap-invest.ts`에 6개 신규 assert 추가(총
  21개, "수목하우스" 실측 사례를 축소한 회귀 테스트 포함) — 전부 PASS.

DB 변경: 없음. API 변경: `gap-invest-calc.ts`의 identity key만 강화
(계산 공식 자체는 직전 STEP과 동일, 폴백 시 결과 동일 보장).

검증: `npx tsc --noEmit` 0 / `npx eslint src` 0 errors / `npx next
build` 성공(동일 30 route) / 기존 88개 + 신규 6개(21개 파일 합계) =
**94개 전부 PASS**.

상태: STATISTICS V2.1 FINAL 완료, 검수 승인 후 commit(`fix: ensure
accurate gap investment matching`) + push 진행.

**STATISTICS_V2_1_FINAL_CLOSE** — BLOCKER 없음.

## 2026-08-20 (13)

### SCORE V1.1 — 학교 접근성 설명 보정 + 부산 16개 구·군 Coverage Audit

실제 Apartment Detail(구덕금호, 서구 동대신동3가, aptSeq 26140-11)에서
초등학교가 201m(도보 약 3분)인데도 이집점수 briefing이 "서구 비교
단지보다 다소 아쉬운 편입니다"라고 말하는 모순 사례를 실측으로 재현하고
근본 원인을 고쳤다. 이어서 부산 16개 구·군 전체의 점수 coverage를
실측 감사했다.

- **근본 원인(§4 분류: D — percentile interpretation 문제)**:
  `explain.ts`/`briefing.ts`가 학교 접근성 문장을 오직 상대 percentile
  점수(`bandOf`)로만 생성하고, 수집된 원본 `nearestElementaryDistanceM`
  (실제 생활 체감 거리)을 전혀 참조하지 않았다. 거리 수집 자체
  (`collectors/location.ts`, Kakao SC4 카테고리 검색 → 최근접 초등학교
  직선거리)와 percentile 계산(`percentile.ts`, `category-helper.ts`)은
  검증 결과 모두 정상 — identity/거리소스/초중고 혼입 문제(A/B/C)는
  전부 배제됐다. **score 산출 공식은 변경하지 않았다** — 설명 생성
  로직만 고쳤다(§13 지시대로).
- **절대(실제 거리) vs 상대(지역 내 순위) 분리**: 부산 실측 분포(location
  feature 402건 중 non-null 398건 — min=45, p10=138, p25=214,
  median=329, p75=472, p90=647, max=933m)에 앵커링해 절대 거리 band
  (VERY_CLOSE≤200 / CLOSE≤400 / NORMAL≤650 / FAR≤933 / VERY_FAR>933 /
  UNKNOWN=null)를 `school-distance-band.ts`에 새로 정의했다. 임의
  하드코딩이 아니라 실측 percentile 근처의 값을 채택했다는 근거를
  파일 주석에 남겼다.
- **모순 방지 규칙**(`school-access-sentence.ts`): 문장은 항상 절대
  거리를 먼저 말하고, 상대 percentile은 모순되지 않는 보조 caveat로만
  붙인다. 절대=CLOSE 이하 + 상대=BELOW_AVERAGE는 단독 "아쉽다"가 아니라
  "가까운 편입니다. 다만 서구 내에서는 더 가까운 단지도 있습니다"
  형태로 강제한다(구덕금호 실제 재현 케이스로 확인). 절대=FAR + 상대=
  GOOD/EXCELLENT는 반대로 "매우 좋다"고 단독 과장하지 않고 거리 caveat를
  남긴다(해운대구 에이스스카이뷰, aptSeq 26350-2374 실측 확인). 거리
  UNKNOWN(반경 1000m 내 학교 미확인)이면 품질/거리 추정을 하지 않고
  briefing caution 후보에서도 제외한다.
- `calculate.ts`가 대상 단지의 원본 `nearestElementaryDistanceM`을 읽어
  `explainAllCategories`/`buildBriefing`에 넘기도록 수정(다른 4개
  카테고리 설명 로직·score 계산 자체는 무변경).
- `KakaoPlaces.tsx`의 초품아 배지 문구에서 "교육 환경이 매우 우수합니다"
  (§35 금지 어휘 "교육 수준" 계열과 사실상 동일)를 제거하고 "도보 통학이
  가능한 거리입니다"로 순수 근접성 문구로 교체했다.
- **부산 16개 구·군 coverage 실측 감사** (`busan-coverage-audit.ts`):
  `ApartmentMaster` 3,402건 중 location/market feature가 존재하는 곳은
  **서구·해운대구 2개 구뿐**(location 402건=11.8%) — 나머지 14개 구·군은
  전부 0%. 이 2개 구 내 402건 전체는 `calculateApartmentScore()`
  100% OK(coverage 0.85~1.00, score 16~78, 극단값·이상 클러스터링 없음).
  parking만 75.4%(303/402) 미채점 — 기존에 알려진 실제 결측(§17 "missing
  ≠0점" 원칙대로 집계). 비-pilot 14개 구 샘플 실측 결과 coverage가
  0.15~0.30에 그쳐 `MIN_TOTAL_COVERAGE=0.6`에 항상 못 미쳐 정확히
  INSUFFICIENT_DATA로 처리됨을 확인 — **threshold 자체는 변경하지
  않음**(변경 근거 없음, 오히려 의도대로 동작 확인).
- **준비중 원인 진단 taxonomy**(`preparing-reason.ts`, 내부/운영자
  전용 — `FinalScoreResult.preparingReason`, 공개 API route는 이 필드를
  절대 응답에 포함하지 않음): `FEATURE_CACHE_MISSING`(위치 feature
  자체 없음 — 14/16 구·군의 실제 지배적 원인) / `MISSING_TRANSPORT`
  /`MISSING_LIVING`/`MISSING_PARKING`/`MISSING_COMPLEX`/`MISSING_SCHOOL`
  (단일 카테고리 결측) / `INSUFFICIENT_TOTAL_COVERAGE`(복합 결측) /
  `OTHER`. 사용자 노출 문구는 원인과 무관하게 항상 "이집점수 준비 중 —
  일부 단지 정보가 아직 충분하지 않습니다"로 고정(내부 구조 추측 방지).
- peer-level fallback 실측(§25): LOCAL 94.3%/SIGUNGU 5.7%/REGION_WIDE
  0%(pilot 402건) — REGION_WIDE 폴백은 실제로 발생하지 않음. Regional
  Premium 실측(§26): 402건 중 65.7%가 strength 1개 이상, 특정 타입
  과다 발동 이상 없음(각 8~15% 수준 고르게 분포).
- 발견했으나 이번 STEP 범위 밖으로 판단해 수정하지 않은 항목(SCHOOL V2
  후보로 handoff): (1) `explain.ts`/`briefing.ts`의 `regionLabel`이
  실제 peer level(LOCAL/SIGUNGU/REGION_WIDE)과 무관하게 항상 sigungu
  이름을 쓴다 — 5개 카테고리 전체에 영향을 주는 구조적 변경이라
  schoolAccess 단독 calibration 범위를 넘어선다고 판단해 이번엔 보류.
  (2) `/api/school/apartments/route.ts`의 도보시간 계산에 문서화되지
  않은 `schoolName.includes('송도') → +5분` 단일 지역 하드코딩이 존재 —
  Score Engine이 아닌 별개 기능(학교 상세페이지)이라 이번 STEP에서
  손대지 않고 그대로 보고만 한다.

DB 변경: 없음(`prisma/schema.prisma` 미변경). API 변경: `/api/apt/
[name]/score` 응답 스키마는 기존과 동일(설명 문구 내용만 달라짐,
`preparingReason`은 내부용이라 route.ts가 응답에 넣지 않음 — 기존
whitelist 방식 재확인).

검증: `npx tsc --noEmit` 0 errors / `npx eslint` 0 errors(대상 파일) /
`npx next build` 성공(동일 라우트 구성) / `verify-score-engine.ts`
기존 26개 + 신규 12개(schoolAccess 절대/상대 시나리오 A~F, band
경계값, preparing-reason taxonomy) = **38개 전부 PASS** / 실제 DB
데이터(구덕금호 26140-11, 해오름 26140-917, 봄여름가을겨울 26140-212,
e편한세상송도더퍼스트비치 26140-1361, 석포로얄캐슬3차 26140-154,
대신푸르지오2차 26140-1290, 에이스스카이뷰 26350-2374, 해운대경보
이리스힐 26350-2335)로 수정 전/후 문장 직접 비교 + 브라우저로 구덕금호
Apartment Detail 실제 렌더링 확인(score 카드/단지 브리핑/학군 탭
세 곳 모두 "가까운 편입니다. 다만 서구 내에서는 더 가까운 단지도
있습니다"로 일관, 학군 탭 "동신초등학교 201m 도보 약 3분"과 모순 없음).

상태: SCORE V1.1 완료. 문서 `docs/development/SCORE-V1-1-school-
calibration-and-busan-coverage.md` 작성. **commit·push 하지 않음**
(사용자 지시, ChatGPT 검수 후 처리).

**SCORE_V1_1_CLOSE** — BLOCKER 없음. 부산 16개 구·군 중 서구·해운대구
2곳만 READY, 나머지 14곳은 LIMITED(=사실상 BLOCKED, 위치 feature
수집 자체가 안 됨 — score 엔진 결함이 아니라 데이터 수집 범위 문제).
**부산 전체 지원 완료라고 말할 수 없음**(§40 no-fake-completeness).

## 2026-08-20 (14)

### BUSAN SCORE DATA V1 — 부산 16개 구·군 Feature 확대 + 학교거리 Correctness Preflight

SCORE V1.1을 커밋·푸시(`1da0c0a fix: calibrate school accessibility
score explanations`, HEAD==origin/main 확인)한 뒤, SCORE V1.1에서
발견만 하고 미수정했던 두 항목을 실제로 고치고, 서구·해운대 전용이던
feature 수집 파이프라인을 부산 16개 구·군 전체로 확장했다.

- **"송도 +5분" 하드코딩 제거**: `api/school/apartments/route.ts`에서
  학교 이름에 "송도"가 포함되면 인근 아파트 도보시간에 +5분을 일괄
  가산하던 코드를 찾아 git history로 근거를 추적했다 — 과거
  "특정 지형(송도) 언덕 페널티 보정" 코멘트가 있었으나 리팩터 중
  유실됐고, "+5"는 실측 경사 데이터가 아닌 임의값이었다. 다른 숫자로
  대체하지 않고 제거했다(실측: e편한세상송도더퍼스트비치 도보 14분→
  9분, 통제군인 비-송도 학교는 무변화 확인).
- **walking time wording**: 같은 라우트의 "도보 N분"에 "약"이 빠져
  있던 것을 발견해 "도보 약 N분"으로 수정(KakaoPlaces.tsx는 이미 "약"
  표기 중이었음, 실제로는 직선거리÷속도 근사이지 실제 보행경로 API가
  아니므로).
- **regionLabel 정확도 수정**: `calculate.ts`가 카테고리별 실제
  peerLevel(LOCAL/SIGUNGU/REGION_WIDE)과 무관하게 항상 sigungu 이름을
  써서, 실측상 92.9%가 실제로는 동(LOCAL) 단위 비교인데도 "서구 비교
  단지보다"로 표현되던 문제를 고쳤다. 신규 `region-label.ts`가
  `CategoryResult.peerLevel`을 보고 LOCAL→동 이름/주차 LOCAL→"{구}
  유사 연식"/SIGUNGU→구 이름/REGION_WIDE→"부산 전체"를 고른다.
  **score 값 자체는 무변경**(구덕금호 26140-11 실측: 수정 전후 54점
  동일, 텍스트만 "서구"→"동대신동3가"로 정확해짐).
- **부산 16개 구·군 feature 확대**: `collect-location-features.ts`에
  임의 `--sggCd=` 모드 추가(기존 canary/seogu/haeundae 유지),
  `collect-market-features.ts`의 REGIONS를 2개→16개 구·군 전체로
  확장(MOLIT은 저비용이라 즉시 전체 실행, 2,937건 upsert). 신규
  `expand-busan-location-features.ts`가 사용자 지정 순서(부산진구→
  기장군)로 나머지 13개 구·군을 순차 수집 — 기존 idempotent upsert +
  freshness-skip 로직을 그대로 재사용해 새 상태 관리 없이 재실행만으로
  이어서 진행 가능(429 연속 5회 시 안전 중단).
- 검증 배치로 중구(55건) 전체 수집 성공(429 0건), 재실행 시 55건 전부
  freshness-skip되는 것으로 idempotency/resume을 실측 확인. 이 STEP
  작성 시점까지 부산진구(378건 중 121건+, 진행 중) 수집이 백그라운드로
  계속 진행 중 — **나머지 12개 구·군은 순서상 아직 미도달**(완료를
  사실과 다르게 주장하지 않음, §40 원칙 유지).
- `busan-coverage-audit.ts`에 구별 score distribution, wrong-score
  prevention(coverage<0.6인데 OK/교차 구·군 오염/중복 aptSeq), READY/
  LIMITED/BLOCKED 초안 분류를 추가 — 전부 이상 0건으로 통과.

DB 변경: 없음(`prisma/schema.prisma` 미변경, `git diff --stat`으로
확인). API 응답 스키마 변경 없음(텍스트 내용만 정확해짐).

검증: `npx tsc --noEmit` 0 / `npx eslint` 0 errors(기존 무관 warning
3건만) / `npx next build` 성공(동일 30 route) / `verify-score-engine.ts`
기존 38개 + 신규 9개(regionLabel 정확도 7개 + 확장 배치 리스트 불변식
2개) = **47개 전부 PASS**.

상태: 코드/파이프라인/테스트/빌드 전부 완료. 데이터 수집 자체는 진행
중(서구/해운대/중구 READY, 부산진구 진행 중, 나머지 12개 구·군 대기) —
**commit·push 하지 않음**(사용자 지시, ChatGPT 검수 후 처리).

**BUSAN_SCORE_DATA_V1** — 코드 완료, 데이터 수집 NOT_CLOSE(진행 중).
BLOCKER 없음.

## 2026-08-21 (15)

### BUSAN SCORE DATA V1 — 데이터 수집 완료(부산 16개 구·군 전체)

(14)에서 진행 중이던 13개 구·군 location feature 수집을 완료했다.
백그라운드 실행이 외부 요인으로 한 번 중단됐으나(부산진구 100%,
동래구 100%, 연제구 146/222 시점) `expand-busan-location-features.ts`를
그대로 재실행하는 것만으로 이어서 완료됐다 — freshness-skip이 이미
끝난 816건을 자동으로 건너뛰고 나머지부터 재개함을 실측으로 증명했다
(§19 resume, 상태 파일 없이도 재개 가능함을 실제로 확인).

- **최종 결과**: 부산 16개 구·군 **전체**가 location feature를 확보
  (80.2~95.5% coverage, 합계 `ApartmentLocationFeature` 3,067건).
  `calculateApartmentScore()` 전수 실행 결과 3,059/3,067건(99.7%) OK,
  score 분포 정상(min14~max81, ≤10/≥90점 0건, 16개 구 median이 모두
  47~53 좁은 범위), wrong-score prevention 전부 통과(coverage<0.6인데
  OK 0건, 중복 aptSeq 0건). 429(rate limit) 전 과정 0건.
- **서구/해운대/중구 regression 확인**: 재수집되지 않고 원본 그대로
  보존됨(구덕금호 26140-11의 `fetchedAt`이 이 STEP 이전 시각 그대로).
- **school anomaly 직접 조사**: 0m 거리 1건(수영구 "광남" — 반경 내
  학교 2곳 존재, 단지가 학교와 붙어있는 실제 초품아 케이스로 확인),
  null-but-complete 16건(전부 기장군 일광·기장읍 해안 저밀도 지역과
  해운대 송정 서핑마을 — 실제로 반경 1000m 내 초등학교가 없는 지역이
  맞음을 지리적으로 확인) — 둘 다 데이터 결함이 아니라 실제 상태.
- **cross-district 오염 검사 정교화**: 최초 점검에서 aptSeq 접두어
  기준 불일치 1건(래미안포레스티지1단지, aptSeq `26260-3648`, 현재
  sigungu=금정구인데 접두어는 옛 동래구 코드)이 나왔으나, score
  engine이 실제로 쓰는 cohort key는 aptSeq 접두어가 아니라 `sggCd`
  필드임을 코드로 재확인하고, "sggCd가 2개 이상 sigungu에 걸쳐
  쓰이는가"로 검사를 다시 짰다 — 결과 0건. 원래 발견은 1988년 금정구가
  동래구에서 분리된 행정구역 변천사로 MOLIT aptSeq 접두어가 옛 코드를
  유지하고 있는 것으로 확인했다(score에는 무해, SCHOOL V2/향후 참고용
  으로만 기록).

DB 변경: 없음. API 변경: 없음(이미 (14)에서 완료).

검증: 위 실행은 전부 기존 `calculateApartmentScore()`/`busan-coverage-
audit.ts`(§25 검사 정교화만 반영) 재실행 — 코드 변경은 감사 스크립트의
cross-district 검사 로직 개선 1건뿐, `npx tsc --noEmit` 0 / `npx eslint`
0 errors 재확인.

상태: 코드/파이프라인/데이터 수집 전부 완료. **commit·push 하지
않음**(사용자 지시, ChatGPT 검수 후 처리).

**BUSAN_SCORE_DATA_V1_CLOSE** — BLOCKER 없음. 부산 16개 구·군 전체
READY. parking coverage(74.2% 결측)는 기존부터 있던 별개 한계로
이번 STEP 범위 밖.

## 2026-08-21 (16)

### BUSAN SCORE DATA V1 — 최종 8건 재조사 + PEER FALLBACK HOTFIX

(15)에서 "정상 준비중"으로 결론 냈던 non-OK 8건을 commit 전 최종 점검
차원에서 `calculateApartmentScore()`/`resolvePeerPool()`/
`computeCategoryFromSubMetrics()`를 직접 재현해 개별 조사한 결과,
기존 결론이 부정확했음을 발견했다.

**발견한 문제**: 8건 전부(중구 대청동4가 4건, 기장군 일광읍 이천리
4건) raw location feature 값 자체는 정상 존재했다. 실제 원인은
`resolvePeerPool()`이 LOCAL(동) 후보를 "존재 개수"만으로 선택하고, 그
후보들이 실제로 해당 sub-metric 값을 갖고 있는지는 보지 않는 구조적
엣지케이스였다 — 두 동 모두 LOCAL 후보 수가 정확히 `PEER_SAMPLE_MEDIUM`
(5)이라 SIGUNGU(중구 55건/기장군 136건의 훨씬 안정적인 표본)로
폴백하지 않았고, 그 5명 중 일부가 특정 feature를 결측하면
`includedCount<5`로 sub-metric이 전부 제외되며 카테고리 전체가
NOT_SCORED로 빠졌다. `FEATURE_CACHE_MISSING`(§18 taxonomy)으로 분류된
게 실제로는 부정확한 라벨이었다(수집은 이미 됐고 peer-pool 경계조건
문제였다).

**PEER FALLBACK HOTFIX(승인된 설계, Option C)**:

- `src/lib/apartment-score/server/peer-groups.ts` — `resolvePeerPoolLevels()`
  신규 추가(LOCAL→SIGUNGU→REGION_WIDE 시도 순서 배열 반환). 기존
  `resolvePeerPool()`은 `resolvePeerPoolLevels()[0]`에 위임하도록만
  변경 — 반환값/동작 100% 동일 유지(신규 테스트로 동등성 assert).
- `src/lib/apartment-score/server/calculate.ts` — `computeCategoryWithFallback()`
  신규 추가. 카테고리 단위로 LOCAL→SIGUNGU→REGION_WIDE를 순서대로
  시도하다 `status!=='NOT_SCORED'`가 나오면 즉시 채택한다. 기존
  3,059건은 1차(LOCAL) 시도에서 바로 성공해 동작·성능 영향 없음.
- `src/lib/apartment-score/server/types.ts` — `PeerLevel` 타입 주석에
  REGION_WIDE가 현재 구현상(`cohortOtherRegions` 미지정 시) SIGUNGU와
  동일한 후보 집합이라는 사실을 명시(이름과 실제 동작 불일치 문서화).
- **변경하지 않은 것**(승인된 범위 그대로): `category-helper.ts`,
  `percentile.ts`, `config.ts`(weight/threshold/`PEER_SAMPLE_MEDIUM`
  전부 무변경), 5개 category 파일, DB/schema.

**Target 8 결과**: 8건 전부 preparing → OK로 회복(새들맨션 51점,
경우빌라 42점, 동호이루마시티 59점, 동림 46점, 동부산쏠마레 34점,
일광신도시비스타동원2차 63점, 가화일광타워 32점, 부전비치 44점).

**부산 3,067건 전체 regression**: OK 3,059→**3,067건**(+8),
preparing 8→**0건**(우연히 8건 전부 SIGUNGU에서 해결 가능한 동일
패턴이었을 뿐, 억지로 100%를 만들지 않았다 — REGION_WIDE까지 실패하는
케이스는 여전히 정직하게 preparing으로 남도록 테스트로 고정돼 있음).

**기존 3,059건 score drift**: 30건(0.981%) 변경, 평균 |변화| 5.13점,
최대 -9점. **transport/living/complex/schoolAccess는 0건(0.000%)
변경**으로 완전히 안정적이었고, **parking만 33건(1.079%) 변경** —
parking의 sigungu+buildYear decade-band LOCAL도 §18-A와 동일한
구조적 버그를 갖고 있어서, 이전엔 숨겨져 있던(NOT_SCORED로 제외되고
가중치가 재분배되던) 낮은 주차 점수가 이번 수정으로 정직하게
드러났다(예: 26710-35 현대, coverage 0.85→1.0, 총점 69→60). weight/
formula 변경이 아니라 이미 있던 데이터를 이제는 빼지 않고 반영한
결과다. 서구(155건 중 4건)/해운대구(247건 중 1건) 모두 동일 패턴.

DB 변경: 없음. score weight/threshold/percentile 공식: 무변경.
지역별 하드코딩: 없음. 0-대체: 없음(테스트로 고정).

검증: `verify-score-engine.ts` 56개 assert 전부 PASS(신규 12개 —
resolvePeerPool/Levels 동등성 2개, A~F/H 엣지케이스 6개, 결정론 1개
등). `npx tsc --noEmit` 0 errors. `npx eslint .` 0 errors(기존 무관
warning 5건만). `npx next build` 성공.

상태: 완료. `docs/development/BUSAN-SCORE-DATA-V1-expansion-and-
readiness.md` §18-A(원인 재조사)/§18-B(hotfix 결과)로 기록.

**BUSAN_SCORE_DATA_V1_CLOSE = YES.** BUSAN_SCORE_READINESS = READY
(3,067/3,067 OK). SCHOOL_V2_GO = YES(다음 STEP 진행 가능).

## 2026-08-21 (17)

### SCHOOL DATA/API AUDIT V1 — 학교·학군·유치원·어린이집 기존 연동 전수 감사

AUDIT ONLY. 코드/DB/UI 변경 없음, 신규 API 신청/연동 없음, backfill
없음, commit/push 없음. `docs/development/SCHOOL-DATA-API-AUDIT-V1.md`
신규 작성.

핵심 발견:

- **School 관련 DB model이 전혀 없다**(`prisma/schema.prisma` 23개
  model 전수 확인, School/SchoolFeature/ApartmentSchool 등 0건). 모든
  학교 데이터는 매 요청마다 NEIS/Kakao를 실시간 호출해서만 존재하고
  DB에 저장되지 않는다.
- 학교 관련 API route 3개(`/api/school`, `/api/school/stats`,
  `/api/school/apartments`) 전부 실제 작동 중 — NEIS 연동은 1회 검증
  호출로 활성 확인(부산 667개교, `INFO-000 정상 처리`). NEIS가 실제
  제공하는 20개 필드 중 4개만 사용 중이고 16개(설립구분/남녀공학/
  홈페이지/주소 등)는 이미 응답에 있는데 파싱하지 않고 버려짐.
- 학생수/학급수/학급당 학생수/학년별 학생수/교원현황/진학률/늘봄·
  돌봄/방과후/급식/통학구역은 NEIS `schoolInfo`에 애초에 없는
  값이라 UI에 아예 없거나(대부분) "데이터 준비 중" placeholder만
  존재(`/school` 목록·상세 각 2~4개 카드). 학교알리미 연동은 프로젝트
  전체에 0건 — 이 항목들을 채울 유일한 현실적 후보이나 미조사 상태.
- 유치원/어린이집은 전용 API/DB/route/component가 전부 0건. 유일한
  흔적은 Kakao PS3 카테고리(유치원+어린이집을 Kakao가 자체적으로
  묶어 분류, 개수만) — Score Engine feature와 아파트 상세 카드 2곳
  에서만 사용, 개별 시설 상세는 전혀 없음.
- 과거 존재했던 가짜 진학률/학생수 수치(커밋 `94c2aa0`, `86a2258`로
  제거됨)가 재발했는지 재확인 — **0건, 전부 정직하게 placeholder로
  유지되고 있음**을 확인.
- "근처 초등학교 찾기" 로직이 Kakao SC4를 각자 호출하는 4개 독립
  구현으로 중복 존재(Score Engine 수집기/AI검색/아파트 상세 패널/
  지도 마커) — 당장 통합 필수는 아니나 SCHOOL V2-A 후보로 기록.
  `/api/school/apartments`에는 서구 특정 동 이름 기준 좌표 하드코딩
  폴백이 여전히 남아있음(§12).

SCHOOL V2 후속 STEP 5개 제안(A~E, 문서 §24) — 특히 B(학교알리미 등
공식 source 실존 여부 조사)가 §19 매트릭스의 NOT_CONNECTED 대부분을
푸는 진짜 병목으로 식별됨.

DB 변경: 없음. 코드 변경: 없음(문서 1건만 신규 생성). 외부 API 호출:
NEIS 1회(검증용, 실서비스 로직과 무관한 audit 전용 호출).

상태: 완료. **commit·push 하지 않음**(사용자 지시, ChatGPT 검수 후
처리).

**SCHOOL_API_AUDIT_CLOSE** — BLOCKER 없음(audit 자체는 완결). SCHOOL
V2 착수 여부는 §21/§24에서 식별된 학교알리미 source 조사(SCHOOL
V2-B) 결과에 따라 재판단 필요.

## 2026-08-21 (18)

### SCHOOL V2-B — 공식 학교알리미/유치원알리미/어린이집 source 실존 조사

SOURCE VERIFICATION ONLY. production 코드/DB/UI 변경 0건, 신규 API
연동 0건, 인증키 신청 0건, commit/push 없음.
`docs/development/SCHOOL-V2-B-official-source-verification.md` 신규
작성.

핵심 발견:

- **학교알리미(schoolinfo.go.kr) OpenAPI 실존 확인** — SNS 로그인 후
  인증키 신청 필요(개발단계 자동승인/운영단계 심의승인). 단
  **같은 기관(KERIS) 데이터인데 API 경로는 KOGL 제3유형(변경금지),
  파일 경로는 제1유형(자유)으로 라이선스가 갈리는 것을 확인** —
  LEGAL_REVIEW_REQUIRED로 기록.
- 학교알리미 제공 카테고리(학생현황/교원현황/시설/급식/학업성취 등)는
  공식 설명으로 확인됐으나, **진학률/학업성취도가 실제 API 필드로
  기계 파싱 가능한지는 확정하지 못함**(웹페이지가 JS 동적 렌더링 +
  개발자가이드가 이미지 전용 PDF라 OCR 불가) — NOT_CONFIRMED로 명시,
  "웹에 보이니 API에도 있다"는 가정을 하지 않음(사용자 원칙 준수).
- **유치원알리미도 API별로 상업적 이용 가능/불가가 갈리는 것을 확인**
  (이용안내 페이지에 "상업적 이용이 불가능한 API" 문구 명시) —
  마찬가지로 LEGAL_REVIEW_REQUIRED. 반면 유치원 통합현황 파일데이터
  (`data.go.kr 15037485`, 학급수/원아수/교직원현황 포함)는 **이용허락
  범위 제한 없음**으로 확인돼 가장 마찰이 적은 경로로 식별됨.
- **어린이집은 전국 통합 API**(한국사회보장정보원,
  `data.go.kr 15101155`)가 확인됨 — 부산 16개 구·군별 API 조사가
  불필요해짐. 좌표(위도/경도)·유형(국공립/민간 등)·정원/현원·CCTV·
  통학차량·고유 시설코드까지 필드로 확인됐고 **이용허락범위 제한
  없음**(비용무료) — TIER 1 최우선 후보로 식별.
- **통학구역/배정권역 공식 GIS source 존재 확인**(`schoolzone.emac.kr`
  학구도안내서비스, 초/중/고 학구·학군·학교군 SHP 파일 제공 +
  `data.go.kr 15021149` 전국초등학교통학구역표준데이터, 부산 데이터
  포함 확인) — 예상보다 잘 갖춰진 source라 별도 STEP(SCHOOL V2-E)으로
  승격 제안.
- 학원(전국학원및교습소표준데이터)·도서관(전국도서관표준데이터,
  도서관정보나루) 공식 source도 존재만 확인, TIER 3로 분류.

DB 변경: 없음. 코드 변경: 없음(문서 1건만 신규 생성). 외부 API 호출:
0건(전부 읽기 전용 웹 조사, 인증키 발급/API 호출 없음).

상태: 완료. **commit·push 하지 않음**(사용자 지시, ChatGPT 검수 후
처리).

**SCHOOL_V2_B_CLOSE** — BLOCKER 없음(조사 자체는 완결). 다만 §11
LEGAL_REVIEW_REQUIRED 2건(학교알리미 API 경로, 유치원알리미 API별
라이선스)은 실제 연동 착수 전 반드시 재확인 필요. SCHOOL_V2
IMPLEMENTATION GO 여부는 사용자/ChatGPT 검토 후 결정.

## 2026-08-21 (19)

### SCHOOL V2-C — Education Data Architecture & Ingestion Design

DESIGN ONLY. `schema.prisma` 실제 수정 0건, migration 생성/실행 0건,
DB write 0건, production API/ingestion 구현 0건, UI 변경 0건, 신규
API key 신청 0건, commit/push 없음.
`docs/development/SCHOOL-V2-C-education-data-architecture.md` 신규
작성.

핵심 설계 결정(전부 승인 대기, 미구현):

- **entity model**: School/Kindergarten/Childcare를 단일 폴리모픽
  테이블로 통합하지 않고 **분리 유지(Option B)** — 기존
  `ApartmentMaster`/`RedevelopmentProject` 컨벤션(단일 concrete
  타입 + companion 테이블, 값 기반 느슨한 연결, formal FK 미사용)과
  일치시킴. 신규 테이블 후보 13개를 row-level provenance 컨벤션
  재사용으로 10개로 축소(SchoolFacility/EducationSourceSnapshot/
  EducationInstitutionAlias 병합).
- **canonical identity**: 학교=NEIS `SD_SCHUL_CODE` 우선, 학교알리미
  identifier와의 매핑은 여전히 미확정이라 추정 규칙을 만들지 않고
  `EducationIdentityMapping`(review queue, `RedevelopmentSourceRecord`의
  matchConfidence/mergeStatus 패턴 재사용)으로 unresolved 상태를
  명시 보존. 유치원 고유코드 존재 자체가 미확인이라 복합키 fallback +
  `identityConfidence: LOW` 명시. 어린이집은 시설코드가 확인돼
  canonical key로 채택.
- **13-다 졸업생 진로 현황**: `SchoolStat`과 완전히 분리된
  `GraduateOutcomeSnapshot` 테이블로 격리(법적 게이트/스키마 미확정
  상태가 다른 학교 통계 ingestion에 영향 주지 않도록) — 일반고/
  자사고/특성화고 등 세부 진학유형 컬럼은 전혀 만들지 않고
  `rawPayload Json` + `schemaVersion="unconfirmed-v0"`만 확정, 실제
  키 발급 후 필드 확인 시에만 별도 migration으로 컬럼 확정.
- **법적 게이트**: `EducationSource.legalReviewStatus` 필드로
  ingestion pipeline이 실행 전 반드시 확인하도록 설계 — 학교알리미
  API 경로/유치원알리미 API/13-다는 `CLEARED`가 되기 전까지
  ingestion 자체가 실행되지 않는 구조.
- **derived metrics**: Score Engine의 기존 "RAW≠SCORE" 원칙을 그대로
  적용 — 학급당 학생수 등 파생값은 원칙적으로 DB에 저장하지 않고
  런타임 계산, source가 이미 계산해서 제공하는 것으로 확인된 값만
  `SOURCE_PROVIDED`로 구분 저장.
- **거리 모델**: 현재 1.45배 근사 도보시간을 `walkingDurationSec`에
  저장하지 않도록 명시 — `estimatedWalkMinutes`(근사)와
  `walkingDurationSec`(실제 route API 도입 후 전용) 필드를 분리.
- **통학구역**: PostGIS 등 신규 공간 인프라 도입 없이 이번 phase는
  외부 SHP/GeoJSON(학구도안내서비스) 유지, DB 테이블 생성 보류
  (FUTURE).

Implementation phases 재제안: V2-C1(schema만) → V2-C2(NEIS+학교알리미)
/V2-C3(유치원+어린이집, 라이선스 마찰 적어 C2보다 먼저 실행 가능) →
V2-C4(identity reconciliation) → V2-C5(ApartmentEducationLink) →
V2-C6(통학구역) → V2-C7(13-다, 별도 법적 게이트 해제 후) → V2-D(UX).

기존 테이블(`ApartmentMaster`, `ApartmentLocationFeature` 등) 변경
필요 없음(값 기반 연결 컨벤션 유지) — migration impact는 전부
additive로 설계.

DB 변경: 없음. 코드 변경: 없음(문서 1건 신규 작성). 외부 API 호출:
0건.

상태: 완료. **commit·push 하지 않음**(사용자 지시, ChatGPT/사용자
설계 승인 후 처리).

**SCHOOL_V2_C_DESIGN_CLOSE** — BLOCKER 없음(설계 자체는 완결).
`DB_SCHEMA_CHANGE_REQUIRED = YES`(승인 시). `IMPLEMENTATION_GO`는
§27의 8개 결정사항에 대한 사용자 승인 이후로 보류.

## 2026-08-21 (20)

### SCHOOL V2-C1 — 교육 데이터 적재를 위한 core schema 추가

`prisma/schema.prisma`에 학교/유치원/어린이집 canonical entity +
temporal 통계를 위한 최소 core schema 7개 모델(`EducationSource`,
`School`, `SchoolStat`, `Kindergarten`, `KindergartenStat`,
`Childcare`, `ChildcareStat`)과 enum 5개를 신규 추가하고, migration
(`20260821021307_education_v2c1_core_schema`)을 생성·적용했다.

**아직 실제 학교/유치원/어린이집 데이터 ingestion은 미실행이다** —
7개 테이블 전부 배포 직후 row 0건이며(스모크 테스트로 확인), seed
데이터도 만들지 않았다. 기존 `/api/school`, `/api/school/stats`,
`/api/school/apartments` route는 코드 변경이 전혀 없어 지금 이
스키마를 읽지 않는다(다음 ingestion STEP 이후에만 연결).

SCHOOL V2-C 설계문서(10개 proposed table)에서 이번 C1은 즉시
필요한 7개만 실제 생성하고, cross-source identity 매핑
(`EducationIdentityMapping`)·아파트-교육기관 거리 materialization
(`ApartmentEducationLink`)·13-다 졸업생 진로 현황
(`GraduateOutcomeSnapshot`) 3개는 각각 실제로 필요해지는 후속
STEP(C4/C5/C7)까지 스키마 생성을 미뤘다(설계 자체는 문서에 유지).

기존 테이블(`ApartmentMaster`, `RedevelopmentProject` 등)은 1바이트도
변경하지 않았다 — migration은 `CREATE TYPE`/`CREATE TABLE`/
`CREATE INDEX`/신규 FK만 포함하는 순수 추가형이다(`DROP`/`TRUNCATE`/
기존 컬럼 변경 0건, 적용 전 SQL 직접 검토 완료).

DB 변경: 신규 테이블 7개, 신규 enum 5개(전부 additive). 코드 변경:
schema.prisma만(애플리케이션 코드 변경 0건). 외부 API 호출: 0건.

검증: `tsc --noEmit` 0 errors, `eslint` 0 errors(무관한 기존 warning
5건만), `next build` 성공(school 관련 라우트 출력 기존과 동일),
`information_schema`/`pg_enum` 직접 조회로 PK/FK/unique/index/enum
값 전수 확인.

상태: 완료. **commit·push 하지 않음**(사용자 지시, ChatGPT 검수 후
처리).

**SCHOOL_V2_C1_CLOSE** — BLOCKER 없음. `DB_SCHEMA_READY = YES`(7개
core 테이블 기준). 다음 ingestion STEP(SCHOOL V2-C3A 어린이집 등)은
자동 진행하지 않고 대기.
