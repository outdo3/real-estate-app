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

## 2026-08-21 (24)

### SCHOOL V2-C3B — 유치원알리미 공식 API 검증(결론: 유망한 source 확인, 인증키 BLOCKER)

별도 worktree(`school-v2-c3b` branch, base `82f4914`)에서 진행 —
main의 SCHOOL V2-C3A(어린이집) 미커밋 작업물, `school-v2-c2a`
branch(학교 master) 전부 건드리지 않았다.

기존 V2-B가 유력 후보로 봤던 "교육부_통합제공 유치원 현황"
(`15037485`, 파일데이터)을 재확인한 결과, 실제로는 어린이집 SHEET
건과 동일하게 **시도/공시차수 드롭다운 선택 후 다운로드해야 하는
수동 UI**임을 확인해 primary 후보에서 제외했다. 대신 같은 포털의
**유치원알리미 OpenAPI "일반현황"(`basicInfo2`, REST/JSON)**을
직접 확인했더니, **공식 기관코드(`kinderCode`)와 좌표
(`lttdcdnt`/`lngtcdnt`)까지 포함한 32개 응답 필드**를 가진 진짜
자동화 가능한 API였다 — 파일 경로보다 명백히 우월해 이쪽을
primary로 채택했다.

핵심 발견:

- **공식 유치원 기관코드 존재 확인**(`kinderCode`) — V2-B에서
  UNKNOWN으로 남았던 질문 해소, `Kindergarten.officialCode`를
  `identityConfidence=HIGH`로 채택 가능해짐.
- 라이선스: 어린이집 cpmsapi021과 동일한 명확한 문구("영리목적의
  이용을 포함한 변경 및 자유이용 허락") — `EducationSource
  (code=moe_kindergarten_basicinfo_api)`를 CLEARED로 등록(id=4,
  기존 3건 변경 없음).
- **심의여부: 자동승인**(어린이집은 개발/운영 모두 수동 심의) —
  향후 키 신청 마찰이 더 낮을 것으로 예상.
- 응답에 정원(`prmstfcnt`, 총계)과 연령별 학급수/정원/원아수는
  있으나 **총계 원아수/학급수 필드는 없다** — 임의로 합산해
  만들지 않고 `ageBreakdown`(정규화 JSON)에만 세부를 보존했다.
- 교직원수/통학차량/방과후는 이 오퍼레이션 범위 밖(별도 API
  카테고리) — NOT_AVAILABLE로 정직하게 기록.

**BLOCKER**: 이 API 전용 인증키가 없다 — placeholder 키로 실제
호출한 결과 `{"status":"DENIED","message":"유효하지 않은 키"}` 확인.
신규 키는 사용자 승인 없이 신청하지 않았다.

DB 변경: `EducationSource` 1행 추가(id=4). `Kindergarten`/
`KindergartenStat`은 **0행 그대로**(가짜/추정 데이터 없음). schema
변경 없음(C1 schema로 필수 요건 충족 확인). 코드 변경:
`scripts/education/`에 신규 스크립트 3건.

검증: `verify-kindergarten-normalization.ts` 17개 assertion 전부
PASS(실 API 응답이 아닌 필드명 구조 검증용 fixture임을 스크립트에
명시), `tsc`/`eslint`(0 errors)/`next build` 전부 통과.

상태: coverage 미달성(부산 실 ingestion 0건)으로 §36 commit 조건
미충족 — **commit·push 하지 않음**.

**SCHOOL_V2_C3B_CLOSE = NO(BLOCKER)** — `KINDERGARTEN_DATA_READY =
NO`. `NATIONWIDE_KINDERGARTEN_ARCHITECTURE_READY = YES(조건부)`.

## 2026-08-21 (25)

### SCHOOL V2-C3B RESUME — 부산 유치원 공식 데이터 ingestion 완료

`KINDERGARTEN_API_KEY` 발급 후 유치원알리미 basicInfo2 API로 부산
367개 유치원을 `Kindergarten`/`KindergartenStat`에 실제 ingestion
했다.

**실제 sample 호출로 명세-실물 불일치 2건을 발견·수정**: 문서화된
요청/응답 명세 표는 식별자 필드명을 `kinderCode`(camelCase)로,
응답 배열 위치를 암묵적 최상위로 적었으나, 실제 응답은 각각
`kindercode`(소문자)와 `{ kinderInfo: [...] }` wrapper였다 — 명세만
믿고 그대로 구현했다면 매 실행 0건으로 조용히 실패했을 지점을 sample
호출이 미리 잡아냈다.

결과: officialCode(`kindercode`) coverage 367/367(100%), 중복 0건.
16개 구·군 전부 READY(각 구·군 address/establishment/coordinate/
capacity coverage 100%). 좌표 367건 전부 부산 범위 내, coordinateType은
의미 불명확해 UNKNOWN 유지(ENTRANCE 등 추정 안 함). 동명 유치원 6쌍
발견 — 전부 실제 주소가 다른 별개 기관으로 확인해 자동 merge하지
않았다. 연령별 원아수 합이 인가정원을 1명 초과하는 사례 2건 발견,
오류로 단정하지 않고 사실만 기록.

2차 실행(idempotency 재검증)에서 core/stat 중복 0건 확인 — 단
필드 diff 없이 매번 재기록하는 한계는 학교(C2A)/어린이집(C3A)과
동일하게 남아있다(정직하게 기록, 전국 확장 전 개선 후보).

DB 변경: `Kindergarten` 367행, `KindergartenStat` 367행 신규.
`EducationSource`는 이미 §2에서 CLEARED로 등록된 것을 그대로 사용
(추가 변경 없음). schema 변경 0건. 기존 `/api/school*` production
route, UI 변경 0건.

검증: `verify-kindergarten-normalization.ts`를 실제 API 응답(2개
샘플 row)으로 교체해 20개 assertion 전부 PASS, `tsc`/`eslint`
(0 errors)/`next build` 전부 통과.

상태: BLOCKER 없음, 부산 16개 구·군 coverage 100%, idempotency(중복
방지 기준) 확인 — commit/push 진행.

**SCHOOL_V2_C3B_CLOSE = YES(부산 pilot 기준)** —
`KINDERGARTEN_DATA_READY = YES(부산)`.
`NATIONWIDE_KINDERGARTEN_ARCHITECTURE_READY = YES`.
## 2026-08-21 (23)

### SCHOOL V2-C2A — NEIS 학교기본정보 기반 부산 School canonical master ingestion

별도 worktree(`school-v2-c2a` branch, base `82f4914`)에서 진행 —
main worktree의 SCHOOL V2-C3A(어린이집) 미커밋 작업물은 건드리지
않았다.

NEIS 학교기본정보(`schoolInfo`) API로 부산 664개교를 `School`
테이블에 canonical master로 최초 ingestion했다. `neisSchoolCode`
(NEIS `SD_SCHUL_CODE`)를 canonical identity로 사용했고, 학교명은
canonical key로 쓰지 않았다(실제로 "송정초등학교"가 해운대구/강서구
서로 다른 코드로 2건 존재함을 확인해 이 원칙의 필요성이 실측으로
입증됨).

핵심 발견: NEIS 응답에 **아직 개교하지 않은 예정 학교가
`SD_SCHUL_CODE` 공백 상태로 섞여 있음**을 확인(부산 667건 중 3건,
전부 "(가칭)OOO학교" 표기 + 미래 설립일) — 학교명 기반 임시 코드를
만들지 않고 skip 처리했다. 기존 V1 audit의 "부산 667개교" 총량은
정확히 재확인됐고(변동 없음), 그 667 안에 이런 세부가 있었음을
새로 밝혔다.

Legal gate: NEIS 이용약관 제11조("저작자 및 출처 표시 조건으로
자유이용 허락") + 학교기본정보 데이터셋 페이지("이용 허락 범위
제한없음", 갱신주기 매주) 두 공식 페이지가 상충 없이 일치해
`EducationSource(code=neis_school_info)`를 CLEARED로 등록.

부산 16개 구·군 전부 실데이터 확인(합계 664), 필수 필드
(schoolCode/schoolName) coverage 100%, 선택 필드도 97~99% 수준.
`neisSchoolCode` 중복 0건. 두 번째 실행에서도 중복 생성 0건(핵심
idempotency 확인) — 단 필드 diff 없이 매번 재기록하는 한계는
문서에 정직하게 남김.

`SchoolStat`은 의도적으로 0행 유지(학교알리미 C2B 범위, 이번 STEP
아님). 기존 `/api/school*` production route, UI 변경 0건. 좌표는
전부 null(대량 geocoding 금지 지시 준수).

DB 변경: `School` 664행 신규, `EducationSource` 1행 신규(id=3, 기존
2건 변경 없음). 코드 변경: `scripts/education/`에 신규 스크립트
3건(ingest-schools-neis.ts, register-neis-school-source.ts,
verify-school-normalization.ts). schema 변경 0건(C1 schema로 충분).

검증: `verify-school-normalization.ts` 21개 assertion 전부 PASS,
`tsc`/`eslint`(0 errors)/`next build` 전부 통과.

상태: BLOCKER 없음, 부산 coverage 정상, idempotency(중복방지 기준)
확인 — commit/push 진행.

**SCHOOL_V2_C2A_CLOSE = YES(부산 pilot 기준)** —
`SCHOOL_MASTER_DATA_READY = YES(부산)`. `NATIONWIDE_SCHOOL_
ARCHITECTURE_READY = YES`(office-code 파라미터화, 부산 전용 분기
없음, 전국 실제 실행은 미실시).

## 2026-08-21 (24) — SCHOOL V2-C5 거리/접근성 정확도 감사 (AUDIT ONLY)

별도 worktree(`D:/anti2/aaa/e-jip-school-c5`, branch
`school-v2-c5-distance-audit`, base `da17c0a`=school-v2-c2a)에서 진행.
main dirty worktree, C2A/C2B/C3B/score-geocode-recovery 브랜치 전부
미접촉.

핵심 발견: "학교까지 거리"가 서로 참조하지 않는 **3개 독립
파이프라인**(Score `schoolAccess`/`/school/[id]` 인근 아파트/AI 검색
조건검색)으로 존재하고, 셋 다 STRAIGHT_LINE_DISTANCE(Turf 또는
Kakao 자체 distance 필드)만 계산하면서 그중 둘(`/school/[id]`,
AI 검색)은 서로 다른 임의 보정식으로 "도보 N분"을 만들어낸다 —
같은 700m 직선거리가 화면에 따라 "9분"과 "22분"으로 2배 이상
차이난다.

재검증 결과 부산 서구 송도동 하드코딩 폴백
(`api/school/apartments/route.ts` `[129.0225, 35.0772]` +
대신동/송도동/충무동 동단위 보정)이 **여전히 존재**하며, `/school`
목록→상세 진입 경로는 lat/lng를 넘기지 않아 이 폴백이 실제로
도달 가능한 경로임을 확인. 추가로 repo root의 `fix_coords.ts`/
`fix_songdo_coords.ts`(2026-08-07 커밋 cb5d606)가 특정 아파트
7곳의 좌표를 "도보 3분 거리 셋팅" 등 주석과 함께 손으로 지정해
학교 대비 상대 거리 순위를 조작한 이력을 신규 발견(BLOCKER,
프로덕션 반영 여부는 미확인 — 후속 STEP 확인 필요).

`School`/`Kindergarten`/`Childcare` 세 모델 모두
`latitude/longitude/coordinateSource/coordinateType`(CoordinateType
enum: OFFICIAL_POINT/ADDRESS_GEOCODE/ENTRANCE/CENTER/UNKNOWN)을
이미 동일 shape로 스키마에 보유 — SCHOOL V2 거리 데이터 계약을
세 기관에 공통 재사용하는 데 마이그레이션이 불필요함을 확인. 단
NEIS 적재 스크립트가 이 필드들을 채우지 않아 실제로는 전부
UNKNOWN(C2A CHANGELOG "좌표는 전부 null" 기록과 일치).

10개 표본(서구/해운대구/부산진구/동래구/사하구/강서구/기장군/수영구)은
`ApartmentMaster`의 실제 exact-geocode 좌표로 Kakao SC4 카테고리
검색(read-only, 아파트당 1회, 총 10회)을 실행해 실측 직선거리만
기록 — 보행 분은 route API 없이 추측하지 않음.

Route provider 조사: Kakao Mobility 도보 길찾기는 공식 페이지에서
"사전 제휴 계약 필요"(제휴 전용 API)임을 1차 문서로 확인. Naver
Directions 5/TMAP 보행자 경로는 JS 렌더링 문서라 가격/quota/caching
정책을 1차 문서로 확인하지 못해 EXTERNAL_VERIFICATION_REQUIRED로
명시(추측 기재 없음).

코드/DB 변경 없음(schema, production route, UI 전부 미변경). 신규
read-only 감사 스크립트 1건(`scripts/education/c5-sample-distance-audit.ts`,
tsc/eslint 0 errors) + 신규 문서
`docs/development/SCHOOL-V2-C5-distance-accessibility-audit.md`.

상태: BLOCKER 2건 발견(서구 하드코딩 폴백, fix_coords 계열 좌표
조작) — 이번 STEP에서는 제거하지 않고 목록만 작성(지시사항). Score
V1 formula 변경 없음. main merge 없음.

**SCHOOL_V2_C5_AUDIT_CLOSE = YES** —
`DISTANCE_DATA_SAFE_FOR_PARENT_UX = NO(as-is)` — `/school/[id]`·AI
검색의 "도보 N분" 표현이 직선거리 기반 추정을 실제 도보시간처럼
보여주고 있어 C5-A(문구 교정) 전에는 그대로 노출하면 안 됨.

## 2026-08-21 (25) — SCHOOL V2-C5-A misleading walking label 교정 + fix_coords 영향 확인

별도 worktree(`D:/anti2/aaa/e-jip-school-c5a`, branch
`school-v2-c5a-distance-label`, base `91a1a8d`=school-v2-c5-distance-audit)에서
진행. main/C2A/C2B/C3B/score-geocode-recovery 전부 미접촉.

C5 감사에서 확인된 8곳의 misleading "도보 N분" 노출을 전부 "직선거리
약 Nm"로 교정(계산 로직/데이터 자체는 불변, 표현만 정직해짐):
`/api/school/apartments`(1.45배+분당15분+flat보정 로직 삭제),
`school-detail-client.tsx`, `ai-search.ts`
`findNearestElementarySchool`(distance/80 삭제),
`api/ai-search/route.ts`(Gemini 데이터요약), `ai-search-client.tsx`
(카드 배지), `ai-search.ts`의 Gemini 가드레일 프롬프트,
`KakaoPlaces.tsx`(학교 SC4·어린이집/유치원 PS3 항목만 — 지하철/병원/
마트/약국/공원 등 다른 카테고리는 `/apt/[name]`(V1 잠금) 공용
컴포넌트라 그대로 유지, `isEducationPlace()`로 항목 단위 분기).

`/api/school/apartments` 하위호환: `walkTime` 필드 키는 유지하되
값을 안전한 문구로 교체(@deprecated 표시), 신규 `distanceMeters`/
`distanceLabel` 필드 추가 — 실제 소비자가 이 파일 하나뿐임을 grep으로
확인 후 소비자도 신규 필드로 전환.

AI 검색의 "도보 N분 이내" 자연어 조건 위험을 조사한 결과, 애초에
분(分) 단위를 파싱하는 필드가 스키마에 없어(모든 학교 근접 표현이
`nearElementarySchool` boolean 하나 + 고정 500m 반경으로 뭉개짐)
"허위로 조건 만족을 주장"하는 코드 경로 자체가 없었음을 확인 —
UNSUPPORTED_ROUTE_CONDITION 같은 신규 메커니즘은 조건 파싱 확장이라
범위 밖으로 판단해 만들지 않고, 응답이 항상 실제 직선거리로만
표현되도록 하는 것으로 위험을 낮췄다(한계는 문서에 기록).

fix_coords.ts/fix_songdo_coords.ts 프로덕션 영향 read-only 확인
(`scripts/education/c5a-fix-coords-impact-check.ts`): 두 스크립트가
실제로 write한 `Transaction` 테이블이 **현재 총 0행**이고 `src/`
어디에서도 `prisma.transaction`을 참조하지 않는 완전한 dead
table임을 확인 — 7개 대상 단지 전부 **NO_PRODUCTION_IMPACT**로 확정
(추정이 아니라 직접 조회로 확인). ApartmentMaster(Score가 실제로
쓰는 테이블)엔 7곳 중 2곳만 존재하고 좌표는 하드코딩 값과 다른
정상 지오코딩 값(2026-08-13 갱신, score-geocode-recovery로 추정) —
fix_coords.ts가 건드린 적 없는 테이블이라 예상대로 무관함을 재확인.
Transaction 모델엔 `updatedAt` 컬럼 자체가 없어 "언제 반영됐는지"는
확인 불가(테이블이 비어있어 실익 없음). 로컬 DATABASE_URL이 Vercel
프로덕션과 정확히 같은 인스턴스인지는 대시보드 접근 없이 암호학적
확인은 못해 UNKNOWN으로 남김(정황상 SAME 가능성 높음, 단일
DATABASE_URL만 존재).

UI regression: 서구2/해운대2/동래·사하 각1(총 6개) 실제 API
호출로 거리값 불변·문구만 교정 확인 + 브라우저로 `/school/[id]`,
`/ai-search`(실제 Gemini 질의) 육안 확인 — caveat 문구 정상 노출,
"도보" 텍스트 전무.

신규 회귀 가드 스크립트
`scripts/education/c5a-verify-no-walking-labels.ts`(vitest/jest 없는
이 프로젝트 관례대로 tsx 직접실행 assertion 방식) — PASS. Score
파이프라인(`school-access-sentence.ts`) 불변도 같은 스크립트로 재확인.

서구 하드코딩 폴백(§8 지시)과 fix_coords 스크립트 자체는 이번
STEP에서 제거하지 않고 C5-B로 이월. Score V1 formula/weight/
ApartmentLocationFeature 전부 미변경.

검증: `tsc --noEmit` 0 errors, `eslint`(수정 파일 전체) 0 errors,
`next build` 성공.

상태: BLOCKER 없음. main merge 없음.

**SCHOOL_V2_C5A_CLOSE = YES** —
`PARENT_DISTANCE_LABEL_SAFE = YES` — 학교/유치원/어린이집 거리
UI 전 구간에서 "도보 N분"이 더 이상 노출되지 않으며 실제 직선거리로만
표현된다. `MANUAL_COORDINATE_C5B_PRIORITY = LOW`(fix_coords 관련
production impact가 NO로 확정돼 긴급성 낮음, 그러나 좌표 provenance
정리 자체는 여전히 C5-B에서 필요).

## 2026-08-22 (26) — SCHOOL V2-C5-B 교육시설 좌표 provenance 정리 + 서구 폴백 제거

별도 worktree(`D:/anti2/aaa/e-jip-school-c5b`, branch
`school-v2-c5b-coordinate-provenance`, base `d457100`=school-v2-c5a)에서
진행. main/C2A/C2B/C3B/score-geocode-recovery 전부 미접촉.

**SchoolInfo apiType=0 좌표 실측 확정**: `LTTUD`/`LGTUD` 필드 실존
확인(공식 개발자가이드 필드명), 부산 662건(16개 구군×초/중/고/특수)
기준 coverage 99.7%(660/662), invalid 0건, out-of-Busan 0건. 10개
표본을 Kakao SC4 POI와 대조한 결과 **9/9 성공 케이스가 델타 0.0m로
완전히 동일한 좌표값** — SchoolInfo가 Kakao보다 더 정확하다는 근거는
없으며(사실상 동일 원천으로 추정, 공식 확인은 아님), 이 소스를 쓰는
실용적 이점은 정확도가 아니라 안정성/재사용성/coverage 완전성(부산성우학교
사례처럼 Kakao 커버리지가 성긴 곳도 SchoolInfo는 있음)임을 명확히 기록.

**School.latitude/longitude write는 이번 STEP에서 하지 않음** —
`EducationSource` 테이블을 직접 조회(read-only)한 결과 SchoolInfo/
학교알리미 관련 source가 단 1건도 등록돼 있지 않음을 확인(등록된
4건: childcare_national_api=CLEARED, childcare_national_sheet=
REVIEW_REQUIRED, neis_school_info=CLEARED,
moe_kindergarten_basicinfo_api=CLEARED — SchoolInfo 없음). 이 프로젝트
스스로 설계한 "legalReviewStatus=CLEARED 전엔 ingestion 자체가
실행되지 않는 구조"를 그대로 지켜 write하지 않고 C5-B1으로 이월.
대신 `lookupCanonicalSchoolCoordinate()`(schoolName+sigunguCode 유일
매칭일 때만 사용, 모호하면 null) 함수를 미리 구현해둬 좌표가 채워지면
코드 변경 없이 즉시 활성화되게 함.

**Kindergarten.coordinateType 정리 완료**(실제 반영): 367건 전부
`UNKNOWN`→`OFFICIAL_POINT`. 이미 저장된 좌표(C3B, source=
moe_kindergarten_api)가 EducationSource 조회로 CLEARED임을 확인한
뒤 진행 — 새 데이터 도입이 아니라 이미 승인된 데이터에 정확한 라벨을
붙인 metadata 정리라 School과 달리 write 조건 충족으로 판단.
Childcare는 여전히 0행(C3A 미착수)이라 확인/조치 대상 없음.

**Identity crosswalk 확장**(C2B는 초등만 봤던 것을 전 급으로): 부산
전체 662건 기준 이름 중복 5그룹, 그중 **구·군 내부에서도 중복돼
unsafe한 게 3그룹·7건**(전부 강서구: 송정초등학교/대저중앙초등학교/
가락중학교) — `BNHH_YN`(분교여부)으로도 구분 안 됨(셋 다 N), 동
단위 주소로는 구분 가능해 보이나 이번 STEP에서 구현하지 않음(좌표를
실제로 매핑하지 않기로 했으므로).

**부산 서구 하드코딩 폴백 완전 제거**(`api/school/apartments/route.ts`
`[129.0225, 35.0772]` + 대신동/송도동/충무동 보정 블록 삭제). 새 해석
순서: lat/lng 파라미터 → canonical School 좌표(현재 항상 미확보) →
Kakao 실시간 검색(기존 유지, 폴백 아니라 그 학교 자체를 찾는 시도) →
그래도 없으면 **null**(다른 좌표로 대체하지 않음) → 기존에 이미 있던
"인근 아파트 매물 없음" 안전 경로로 자연 합류. 실측 확인: 존재하지
않는 가짜 학교명으로 호출 시 예전엔 서구 좌표로 계산됐을 것이 이제는
정직하게 빈 결과로 처리됨.

**미해결로 정직하게 기록한 위험**: `lawdCd`가 주어져도 Kakao 키워드
검색이 그 지역으로 스코핑되지 않아, 동명이교(송정초등학교)가 `lat/lng`
없이 조회되면 현재는 우연히 맞는 지역이 나오지만 보장된 동작이 아님 —
regcodes 병렬 fetch 순서 재구성이 필요해 이번 STEP 범위를 넘어선다고
판단해 구현하지 않고 위험만 명시적으로 남김(§11/§12/§19).

`fix_coords.ts`/`fix_songdo_coords.ts` 삭제(git rm — history는 보존).
C5-A에서 이미 NO_PRODUCTION_IMPACT 확정, package.json/다른 스크립트/
문서 어디에서도 미참조 재확인 후 제거.

신규 공용 가드 `scripts/education/lib/coordinate-guard.ts`
(`validateCoordinate`: 범위/0·0/source 필수/manual·hardcode·fix_
패턴 명시적 차단/부산 bounds, `findExcessiveDuplicateCoordinates`:
경고만, 자동 reject 안 함) + 회귀 가드
`c5b-05-verify-provenance-guards.ts`(9개 케이스 전부 PASS, 정적 패턴
검사 1건은 최초 실행 시 내 설명 주석이 오탐돼 대입 코드만 보도록
정규식 교정).

거리 계산 semantics 불변(STRAIGHT_LINE_DISTANCE, "직선거리 약 Nm"),
Score(`ApartmentLocationFeature`/`nearestElementaryDistanceM`/
`school-access-sentence.ts` 등) 전부 미접촉, SchoolStat/대량
SchoolInfo 통계 ingestion 없음.

Regression: 서구2/해운대2/강서2/기타4(총10) 실제 API 호출 전부 정상,
가짜 학교명으로 no-fallback 확인, 브라우저로 `/school/[id]`(lat/lng
없이 진입) 정상 렌더 확인.

검증: `tsc --noEmit` 0 errors, `eslint`(수정/신규 파일 전체) 0
errors, `next build` 성공.

상태: BLOCKER 없음. main merge 없음.

**SCHOOL_V2_C5B_CLOSE = YES** —
`DISTANCE_DATA_SAFE_FOR_PARENT_UX = YES`(C5-A 유지 + 서구 폴백까지
제거돼 지역 오매칭 위험도 낮아짐, 단 동명이교 스코핑 미해결 위험은
남음). `OFFICIAL_SCHOOL_COORDINATE_READY = NO`(SchoolInfo 소스가
EducationSource CLEARED 전까지는 School 좌표를 canonical로 쓸 수
없음 — C5-B1 필요). `C5C_ROUTE_PILOT_READY = NO`(§18 준비자료만 갱신,
provider 계약/가격 미해결 그대로).
## 2026-08-21 (24) — SCHOOL V2-C2B RESUME: 학교알리미(SchoolInfo) OpenAPI 실제 인증/응답 검증

사용자가 발급받은 `SCHOOLINFO_API_KEY`를 `.env.local`에 저장 후 재개.
DB write/대량 ingestion/schema migration 없음, read-only 검증만
진행(`scripts/education/c2b-verify-schoolinfo-api.ts`). apiKey 값은
로그/문서/커밋 어디에도 남기지 않음.

인증 성공, `apiType=09`(공식 개발자 가이드 `OpenAPI_Output.xlsx` 기준
"학년별·학급별 학생수") 실호출로 wrapper(`{resultCode,resultMsg,list}`,
NEIS와 다른 평평한 구조)와 필드(`SCHUL_NM`/`SCHUL_CODE`/학년별
`COL_C{n}`·`COL_S{n}`·`COL_{n}`(학급수/학생수/학급당학생수, 후자는
API가 이미 계산해 반환)/`TEACH_CNT`/`TEACH_CAL`)를 확인. 참고: 사이트
자체 검색 UI의 내부 드롭다운 코드(`m_gongsi`)는 공식 가이드의 apiType
번호 체계와 서로 다르다(둘 다 "09"라는 우연의 일치 없음 — UI 쪽 09는
"자격종별 교원현황", 공식 API 쪽 09는 "학년별·학급별 학생수") —
"실제 응답이 문서와 다르면 실제 응답 우선" 원칙에 따라 공식 가이드+실
호출 결과를 채택.

`sidoCode`/`sggCode` 실제 형식을 실측으로 확정: NEIS 3자리 교육청코드
(`C10`)도, 사이트 내부 AJAX의 10자리 법정동코드(`2600000000`)도 아닌,
이 프로젝트가 MOLIT 조회에 이미 쓰는 **5자리 lawdCd 그대로**
(`sidoCode=26`, `sggCode=26140`)였다 — 새 코드표 불필요.

`SCHUL_CODE`(학교알리미 자체 식별자, 예 `"S020001449"`)는 NEIS
`SD_SCHUL_CODE`와 형식·값 모두 다름을 확인 — **코드 기반 직접 매핑
불가**로 확정(이전 UNKNOWN 판정 정정). 안전한 crosswalk 키는
(학교명, 시군구) 조합이며, 부산 16개 구·군 NEIS 적재 초등학교 305건
전부가 이 키로 학교알리미 2025년 자료와 일치(100%), 학교알리미 쪽에
12건 추가 존재(가덕도 등 소규모/분교 추정, 원인 미확정). 단
(학교명,시군구) 조합조차 완전한 유일키가 아님을 실측으로 발견 —
강서구 안에서 "송정초등학교"·"대저중앙초등학교"가 각각 서로 다른
`SCHUL_CODE`로 2건씩 존재(분교/이력 중복 추정). 별도로 부산 664개
NEIS 적재 학교 전체를 대상으로 동명이교 전수 조사(구·군 간)한 결과는
"송정초등학교"(해운대구/강서구) 1건만 확인됨.

공시년도(`pbanYr`) 유효범위 실측: 2026/2025/2024 성공, 2023은
"최근 3년만 제공"으로 거부 — 롤링 3년 윈도우가 실제로 동작함을
확인(기존 문서상 법령 근거와 일치). 응답에는 연도/공시차수/기준일을
echo하는 필드가 없음 — 공식 가이드 34개 오퍼레이션 전체를 훑어
확인(요청 시 넘긴 `pbanYr`을 저장측이 별도로 기록해야 함, 응답만으로는
복원 불가).

참고 보너스 발견(이번 STEP 범위 밖, ingestion 안 함): `apiType=0`
(학교기본정보) 응답에 `LTTUD`/`LGTUD`(위도/경도)가 실제로 채워져 있음
확인 — SCHOOL V2-C5 거리 감사에서 "School 자체 공식 좌표 소스 없음
(UNKNOWN)"으로 남긴 항목의 유력 후보. C5-B에서 재검토 권고.

`SchoolStat` 스키마(school-v2-c2a 시점부터 이미 존재:
`studentCount`/`classCount`/`teacherCount`/`gradeBreakdown Json`/
`sourceRecordId`) 재판정 결과 **수정 없이 이번에 확인한 실제 필드를
그대로 담을 수 있음** — `sourceRecordId`에 `SCHUL_CODE` 저장,
`gradeBreakdown`에 학년별 `COL_*` 전체 저장 가능. 마이그레이션 불필요.

라이선스(§1-2, 제3유형: 출처표시+변경금지)는 이번 STEP에서 재확인하지
않음 — SCHOOL-V2-B 기존 판정 유지.

문서: `SCHOOL-V2-B-official-source-verification.md` §1-3/§1-6/§1-7
갱신 + 신규 §1-8("실제 호출 방식") 추가(기존 조사 내용 삭제 없이
"2026-08-21 SCHOOL V2-C2B RESUME 실측" 표기로 덧붙임). 신규 스크립트
`scripts/education/c2b-verify-schoolinfo-api.ts`(read-only, tsc/eslint
0 errors).

상태: BLOCKER 없음. 13-다 졸업생 진로현황은 여전히 별도 LATER 유지
(이번 STEP에서 호출하지 않음, §1-4 판정 변경 없음).

**SCHOOL_V2_C2B_CLOSE = YES(apiType=09 한정 실측 기준)** —
`SCHOOLINFO_DATA_INGESTION_READY = CONDITIONAL`: 필드 스키마·
crosswalk 키·좌표질/schulKndCode 전체 코드표 등은 확인됐으나, (a)
동명이교조차 완전히 해소 못하는 (학교명,시군구) 키의 잔여 모호성
처리 로직, (b) apiType=08/22(직위별 교원현황) 등 나머지 오퍼레이션
실측, (c) 라이선스(제3유형 변경금지가 "학급당학생수 같은 파생값
계산·표시"에 저촉되는지) 최종 법무 판단이 남아 있어 전면 ingestion
전 추가 확인 필요.

## 2026-08-22 (27) — SCHOOL V2-LEGAL-1 SchoolInfo 라이선스/이용 게이트 확정 (AUDIT ONLY)

별도 worktree(`D:/anti2/aaa/e-jip-school-legal1`, branch
`school-v2-legal1-schoolinfo-gate`, base `e9062a9`=school-v2-c2b)에서
진행. DB write/migration/School coordinate write/SchoolStat
ingestion/main merge 전부 없음.

**핵심 신규 발견**: 기존 V2-B/C2B 감사는 data.go.kr 카탈로그 등록
(`15098092`, "공공누리 제3유형: 출처표시+변경금지")만 근거로 삼았는데,
이번에 schoolinfo.go.kr 자신의 "API 제공목록" 안 **오퍼레이션별
메타정보 페이지**(각 공시항목 클릭 시 나오는 "이용허락조건" 섹션)를
처음으로 직접 확인했다. 3개 오퍼레이션(학교기본정보=apiType0,
학년별·학급별학생수=apiType09, 직위별교원현황=apiType22)에서
**동일한 문구**를 확인: "출처표시하면 영리 목적의 이용이나 변경 및
2차적저작물의 작성을 포함한 자유 이용을 할 수 있습니다" — data.go.kr의
"변경금지"보다 명백히 관대하다. 두 공식 출처가 서로 다른 조건을
제시한다는 사실 자체를 그대로 기록했고, 어느 쪽이 우선인지 판단할
근거는 찾지 못해 단일 KOGL 유형으로 확정하지 않고 `UNKNOWN`으로 남김.

schoolinfo.go.kr의 "공공데이터 이용정책"(OpenAPI 하위 메뉴, 공공데이터법
§1/§3 근거)도 별도 확인 — "영리 목적의 이용을 포함한 자유로운 활용이
보장됩니다"로 상업적 이용은 재확인. 다만 "API 이용안내" 페이지가
"상업적 이용이 불가능한 API를 상업적으로 활용하는 경우"를 금지행위로
명시해, API별로 조건이 갈릴 수 있음을 공식적으로 인정 — 확인한 3개
오퍼레이션 밖으로는 일반화하지 않음.

§4에서 "원본값 그대로 표시"(A~D, 학생수/학급수/교사수/API제공
파생값)는 SAFE로 판정(두 출처 어느 쪽 기준으로도 안전). 반면
차트/시계열(E,F), 증감률 계산(G), **이집 자체 점수 생성(H)**은
REVIEW_REQUIRED로 유지 — data.go.kr 제3유형과의 불일치가 해소되지
않은 게 유일한 걸림돌이며, 특히 H(여러 원본값을 조합한 자체 점수)는
가장 신중해야 할 영역으로 별도 강조. 좌표(I,J)도 같은 이유로
REVIEW_REQUIRED이나, 원본 그대로 저장·표시·정렬(sort)까지는 상대적으로
안전한 영역으로 구분.

출처표시 의무는 모든 유형에서 예외 없이 필수임을 저작권정책 페이지
공식 예시 문구로 재확인(기관명/작성연도/공공누리유형/저작물명/
작성자/URL). 이집 UI 초안 문구를 제안했으나 화면 내 짧은 표기만으로는
공식 예시의 전 요소를 충족 못해 별도 출처 상세페이지 병행을 권고.

최근 3년 제한(교육관련기관 정보공개 특례법 시행령 제3조3항)은 API
접근 가능 기간에 대한 규정으로 읽히지 취득 후 보관기간을 규율하는
근거는 찾지 못함 — 그래도 `HISTORICAL_RETENTION = REVIEW_REQUIRED`로
유지(지시사항 기본값).

EducationSource 등록안(제안값만, write 없음) 및 후속 확인 권고
(학교알리미 고객센터 서면 문의, 로그인 후 약관 원문 확인) 문서화.

문서: `docs/development/SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md`
신규(기존 V2-B/C2B/C5B 감사 결과 보존, 덮어쓰지 않음).

상태: BLOCKER 없음(단, 아래 두 게이트 모두 CONDITIONAL — CLEARED
아님).

**SCHOOL_V2_LEGAL1_CLOSE = YES** —
`SCHOOLINFO_COORDINATE_USE_GATE = CONDITIONAL`(원본 저장·가공없는
표시·정렬은 안전 범위, 직선거리 계산·순위화는 REVIEW_REQUIRED).
`SCHOOLINFO_STATISTICS_USE_GATE = CONDITIONAL`(원본값 그대로 표시만
안전, 차트/증감률/자체 점수화는 REVIEW_REQUIRED — 특히 자체 점수화는
서면 확인 전 착수 금지 권고). 두 게이트 모두 CLEARED가 아니므로
C5-B1(School 좌표 ingestion)과 SchoolStat ingestion 모두 "무조건
진행 가능"은 아니고, CONDITIONAL 허용 범위 내에서만 사용자/ChatGPT
승인 후 제한적 착수를 검토할 것.

## 2026-08-22 (28) — SCHOOL V2-C2B-A SchoolInfo↔NEIS identity resolver 확정 (AUDIT+DESIGN)

별도 worktree(`D:/anti2/aaa/e-jip-school-c2ba`, branch
`school-v2-c2ba-identity`, base `e9062a9`=school-v2-c2b)에서 진행.
DB write/SchoolStat ingestion/SchoolInfo coordinate write/migration/
main merge 전부 없음. 다른 병렬 브랜치(C2A/LEGAL-1/C3B/C5B/score) 전부
미접촉.

부산 canonical School 664건 × SchoolInfo 부산 전체 671건(16개 구군×
schulKndCode 02~07 전수 fetch, apiType=0만)에 순수함수 resolver를
실제로 돌렸다. 이름+시군구만으로는 638 DIRECT_UNIQUE/4 AMBIGUOUS/22
NO_MATCH였으나, **학교급(4+1 버킷 정규화) + canonical School.dongName
기반 2차 disambiguation**을 추가하자 강서구 동명이교 4그룹(송정초x2,
대저중앙초, 가락중학교 — 신규로 경일중학교도 발견) 중 **3그룹 전부
HIGH로 안전하게 해소**됐다(NEIS dongName과 SchoolInfo 주소가 서로
독립적으로 일치 — 예: 강서구 송정초등학교의 NEIS dongName이 "신호동"
이라는 사실이 SchoolInfo 주소와 정확히 맞아떨어짐). 남은 1건
(경일중학교)은 NEIS dongName 필드 자체가 "명지동, 경일중학교"로
오염돼 있어(기존 NEIS ingestion 데이터 품질 이슈, 이번 STEP 범위
밖) 자동 확정하지 않고 LOW로 정직하게 남김 — 무결성 체크(서로 다른
canonical School이 같은 SCHUL_CODE에 HIGH 매칭된 사례) 전수 조사
결과 WRONG_MERGE = 0건 확정.

최종 TRUE_IDENTITY_COVERAGE = HIGH 633/664 = **95.3%**(학교급별:
초등 100%, 중 96.6%, 고 89.2%, 특수 100%, 기타 11.1% — 방송통신고/
평생학교/외국인학교 등 비표준 유형은 낮게 유지, 억지로 끌어올리지
않음).

부수 발견: SchoolInfo-only 25건(C5-B가 "분교 추정"으로 근거 없이
남겨뒀던 것) 전수 확인 결과 **전부 `ABSCH_YN='Y'`(폐교)** — 분교가
아니라 폐교였음을 확정. NEIS 기반 canonical School은 폐교 학교를
애초에 활성 목록에 포함하지 않는 것으로 추정.

BNHH_YN(분교여부)은 이번 8개 중복 사례 전부 'N'이라 disambiguation에
실질적 도움은 안 됐으나(전부 동일값), resolver는 향후 실제 분교
사례를 대비해 BNHH_YN='Y'인 유일 후보를 MEDIUM으로 처리하도록 이미
설계함. 좌표는 canonical School이 여전히 0% 보유(C5-B의 write 보류
결정 유지)라 보조 증거로 사용하지 못함(설계상 준비는 돼 있음).

신규 재사용 가능 모듈 `scripts/education/lib/schoolinfo-identity-resolver.ts`
(순수 함수) + fixture 테스트
`schoolinfo-identity-resolver.test.ts`(이 프로젝트 기존 관례인
`node:test`+`npx tsx --test` 그대로 따름, DB/네트워크 미접근,
12/12 PASS) + `EducationIdentityMapping` future crosswalk 테이블
설계 제안(migration 없음, 문서화만).

LEGAL-1 게이트는 이번 STEP에서 변경하지 않음 —
`SCHOOLINFO_COORDINATE_USE_GATE`/`SCHOOLINFO_STATISTICS_USE_GATE`
둘 다 CONDITIONAL 그대로 유지(문서에도 CLEARED로 잘못 쓰지 않음).

검증: `tsc --noEmit` 0 errors, `eslint`(신규 파일 전체) 0 errors,
resolver fixture test 12/12 PASS.

문서: `docs/development/SCHOOL-V2-C2BA-identity-disambiguation.md`
신규(기존 C2B/C5B/LEGAL-1 문서 보존).

상태: BLOCKER 없음. main merge 없음.

**SCHOOL_V2_C2BA_CLOSE = YES** —
`IDENTITY_READY_FOR_INGESTION = CONDITIONAL`(HIGH 633건만 자동
ingestion 후보, MEDIUM/LOW/NO_MATCH는 reconciliation queue로 분리
권장 — identity 게이트는 CONDITIONAL이지만 legal 게이트
(SCHOOLINFO_COORDINATE_USE_GATE/SCHOOLINFO_STATISTICS_USE_GATE)가
여전히 CONDITIONAL이라 실제 ingestion은 두 게이트 모두 해소돼야
착수 가능).

## 2026-08-22 (29) — SCHOOL V2-C2B-B school bucket 정정 + 중/고/특수 live 검증 (AUDIT ONLY)

별도 worktree(`D:/anti2/aaa/e-jip-school-c2bb`, branch
`school-v2-c2bb-type-verification`, base `b94bfe0`=school-v2-c2ba)에서
진행. DB ingestion/SchoolStat write/coordinate write/migration/main
merge 전부 없음. 다른 병렬 브랜치 전부 미접촉.

**C2A(elementary305/middle172/high145/special16/other26)와
C2B-A(305/176/158/16/9) 버킷 총합 불일치의 근본 원인을 두 함수를
그대로 복사해 664건에 재실행해 정확히 재현했다**: 둘 다 substring
매칭에 의존하는데 "각종학교(중)"/"평생학교(중)-2년6학기"류는
문자열 안에 "중학교"가 연속으로 등장하지 않아(괄호가 끼어있음) C2A가
전부 놓쳐 OTHER로 떨어뜨렸고(주석은 잡힌다고 적혀있었지만 실제
코드는 그렇게 동작하지 않음 — 주석·코드 불일치 확인), C2B-A는
`.includes('(중)')`/`.includes('(고)')`로 이 문제는 고쳤지만 대신
괄호가 없는 "고등기술학교"(1개교, 부산국제영화고등학교)를 놓쳐
OTHER로 떨어뜨렸다. 19개교 전수 diff를 School.id 단위로 확정.

**최종 canonical taxonomy 확정**: 부산 664건에 실존하는 14개 원문
schoolLevel 값을 전부 exact-value로 명시 매핑(같은 종류의
substring-누락 버그 재발 방지, 신규 모듈
`scripts/education/lib/school-type-taxonomy.ts`) — ELEMENTARY 305 /
MIDDLE 176 / HIGH **159**(C2B-A의 158에서 고등기술학교 보정 +1) /
SPECIAL 16 / OTHER **8**(9에서 -1). 합계 664 확인, 이 숫자를 이후
SCHOOL V2 canonical denominator 단일 기준으로 채택.

**identity 매칭 로직은 전혀 바꾸지 않고**(지시사항) 리포트 그룹핑만
새 taxonomy로 교체해 재집계 — 전체 결과 완전히 동일(HIGH 633/LOW
1/NO_MATCH 30, 95.3%, WRONG_MERGE 0). 학교급별: 초등 100%/중
96.6%/고 89.3%/특수 100%/기타 0.0%.

부산 중학교 5개(지역분산)·고등학교 5개(과학고 대체로 외고/공고/
사립/공립 분산)·특수학교 2개 apiType=09 실측 — 전부 success, 초등
표본과 동일 필드 구조(COL_S{n}/COL_C{n}/COL_SUM/TEACH_CNT) 확인.
고등학교 apiType=0 응답에서 `HS_KND_SC_NM`(고교유형명, 예
"특성화고등학교") 필드 신규 확인. 방송통신고/고등기술학교류 3건은
표준 schulKndCode(02~07) 전부로 재시도해도 apiType=09 목록에 아예
없음을 확인 — **SOURCE_NOT_APPLICABLE**로 확정(요청 파라미터 실수
아님, 이 오퍼레이션이 다루지 않는 학교 유형). apiType=22(직위별
교원현황) 2건 실측 결과 직위 15단계로 과도하게 세분화돼 있어 부모
UX엔 불필요 판단, SchoolStat 최소 구조에서 제외.

부모 UX 최소 SchoolStat 구조 확정(설계만): 전체학생수/학급수/
교사수(총원)/학년별학생수/학급당학생수(API 제공값 그대로) — 기존
C1 스키마(`studentCount`/`classCount`/`teacherCount`/
`gradeBreakdown`/`sourceRecordId`)에 이미 정확히 맞음, 스키마 변경
불필요.

NEIS-only 30건 전수 분류 완료: **IDENTITY_UNRESOLVED 7건**
(canonical School.sigunguCode 자체가 null — SchoolInfo 문제 아니라
우리쪽 NEIS ingestion 주소 데이터 갭, 한국과학영재학교 등) +
**SOURCE_NOT_APPLICABLE 23건**(방송통신/평생학교/외국인학교/
공동실습소/각종학교 계열, §7 실측 패턴과 일치) — "원인불명" 0건.

**coverage denominator 이원화 신규 확정**:
`CANONICAL_SCHOOL_IDENTITY_COVERAGE`(HIGH/664=95.3%, identity 그
자체) vs `SCHOOLINFO_ELIGIBLE_STAT_COVERAGE`(HIGH matched 중
SchoolInfo 공시 대상인 canonical 664-7-23=634건 분모 기준
**633/634=99.8%**) — 664 대비 100% 미달의 대부분이 SchoolInfo
데이터 오류가 아니라 우리쪽 갭(7)과 공시 비대상(23)임을 명확히
구분, "데이터 오류"로 표현하지 않음.

3년 이력 재검증(초/중/고/특수 각 1건, 2026/2025/2024 성공·2023
거부) — 학교급 무관 일관 확인.

Legal gate 변경 없음 —
`SCHOOLINFO_COORDINATE_USE_GATE`/`SCHOOLINFO_STATISTICS_USE_GATE`
둘 다 CONDITIONAL 유지. ingestion plan은 설계만(HIGH∩공시대상 633건
자동 후보, LOW/NO_MATCH는 reconciliation queue, idempotency는 값
변경시만 update, 연도별 history row 보존) — 실행하지 않음.

신규 테스트 `school-type-taxonomy.test.ts`(10케이스) +
기존 `schoolinfo-identity-resolver.test.ts`(12케이스, 재사용) =
22/22 PASS.

검증: `tsc --noEmit` 0 errors, `eslint`(신규/수정 파일 전체) 0
errors. UI/route 변경 없어(scripts/ 한정) `next build` 미실행.

문서: `docs/development/SCHOOL-V2-C2BB-type-and-operation-verification.md`
신규(기존 문서 전부 보존).

상태: BLOCKER 없음. main merge 없음.

**SCHOOL_V2_C2BB_CLOSE = YES** —
`STAT_PIPELINE_TECHNICALLY_READY = YES`(필드/구조/coverage/no-op
설계까지 전부 확인 및 설계 완료, 기술적으로는 바로 구현 가능한
상태) — 단 `SCHOOLINFO_STATISTICS_USE_GATE`/`SCHOOLINFO_COORDINATE_
USE_GATE`가 여전히 CONDITIONAL이라 실제 ingestion 착수는 LEGAL-1의
공식 회신을 기다려야 함.

## 2026-08-22 (30) — SCHOOL V2-C6 공식 학구도(통학구역) 연동 감사 + 부산 파일럿

별도 worktree(`D:/anti2/aaa/e-jip-school-c6`, branch
`school-v2-c6-attendance-zone`, base `9ac7320`=school-v2-c2bb)에서
진행. SchoolInfo 통계 트랙(C2B) 재개 없음, SchoolInfo legal gate
변경 없음, migration/production write/main merge 전부 없음.
SchoolInfo와 완전히 별개인 새 공식 source(학구도)를 다룸.

**공식 source 확정**: 한국교육시설안전원(2026-01-01부로 재단법인
한국지방교육행정연구재단에서 업무 이관, 학구도안내서비스
schoolzone.emac.kr 운영), 초등학교통학구역(SHP)·학교학구도연계정보
(CSV) 등 "학구도 공공데이터 7종"을 매년 3월·9월 배포. data.go.kr
라이선스 섹션에서 **"이용허락범위 제한 없음"** 원문을 직접 확인 —
SchoolInfo의 KOGL 제3유형(변경금지)과 달리 상업적 이용·가공 전부
자유로운 조건. `ATTENDANCE_ZONE_LEGAL_GATE = CLEARED`(원본 파일
기준)로 판정 — LEGAL-1의 SchoolInfo CONDITIONAL 게이트와는 완전히
별개.

**데이터 종류 실측 구분**: "학구도" 안에 최소 3가지 다른 구조가 섞여
있음을 실제 조회로 확인 — (1) 초등학교 순수 1:1 통학구역, (2)
초등학교 **공동통학구역**(대칭/비대칭 "일방" 두 유형 다 실측 확인,
후자는 "큰/작은" 우선순위 필드까지 존재하나 정확한 행정적 의미는
미확인), (3) 중/고등학교 **학교군**(여러 학교 pool, 1:1 배정 아님 —
초중등교육법 시행령 제68조 근거).

School identifier 검증: CSV의 "학교ID"는 `"B000005015"` 형식(B+9자리
숫자)으로 NEIS `SD_SCHUL_CODE`와도 SchoolInfo `SCHUL_CODE`와도 다른
제3의 코드 체계 — **OFFICIAL_OTHER_CODE**로 분류, 학교명 단독
자동조인 금지, C2B-A에서 이미 검증된 identity resolver와 동일
방법론(이름+시군구+학교급+동)을 재사용하는 것이 유일한 실용적
경로임을 확정(코드로 구현하지는 않음, 원본 대량 데이터 미확보).

**부산 파일럿(목표 10건 → 실제 7건, 원본 SHP를 프로그래밍적으로
받지 못해 공식 라이브 조회 UI로 건별 확인, 축소 사유 정직하게
기록)**: 서구/해운대구/강서구×2/동래구/부산진구/사하구 실제
ApartmentMaster 7개 단지를 공식 UI로 직접 조회 — **7건 중 2건(29%)이
이미 단일 학교가 아닌 공동학구/공동통학구역**이었다(향원에이스타운:
동신초/대신초 2개교 선택형, 신화타워: 온천초(큰)/금성초·공덕초
(작은) 3개교). 나머지 5건은 단일 학구였고, 그중 3건은 C5 audit의
직선거리 최근접 결과와 동일 학교로 일치(오차 수 m 수준, 소스 차이).
임의로 가장 가까운 학교를 배정학교로 채운 사례는 0건.

공식 사이트 자체의 고지사항 원문을 그대로 확보: "단순 열람용으로
참조하시기 바라며, '재산권 등의 법적효력'이 없음... 학교 배정 등
학구(통학구역)에 대한 정확한 사항은 관할 교육청(교육지원청)에 반드시
확인" — 이집 UI도 이 이상으로 확정적으로 표현할 근거가 없음을
확인, "배정학교" 대신 "공식 통학구역 기준 학교" 표현을 채택, 중/고는
"OO학교군(N개교 중 배정)" 형태로만.

데이터 모델(`AttendanceZone`/`AttendanceZoneSchool`, N:M 관계 —
공동학구/학교군을 자연스럽게 표현), 저장 방식(원본 파일 보존 +
offline point-in-polygon(`@turf/turf` 재사용) + 사전계산 결과 저장,
PostGIS 도입 없음), 갱신 파이프라인(3월/9월 배포 감지→다운로드→
validate→diff→rematch), coverage 지표 이원화
(`BUSAN_APARTMENT_ATTENDANCE_ZONE_COVERAGE` vs
`ELEMENTARY_ZONE_SOURCE_COVERAGE`), SCHOOL V2-D용 data contract
(`nearbySchools`/`attendanceZone` 분리, zoneType이 GROUP/JOINT면
schools 배열 2개 이상 필수)까지 설계만 완료 — 전부 미구현.

**한계로 정직하게 기록**: data.go.kr의 세션 기반 다운로드(POST+쿠키)
를 이번 STEP에서 자동화하지 못해 원본 SHP/geometry(CRS, polygon
유효성, overlap 등)를 직접 검증하지 못함 — §4/§13 상당 부분 미확인
상태로 남김, 후속 STEP 과제로 명시.

코드 변경 없음(문서만) — tsc/lint/build 실행 대상 없음.

문서: `docs/development/SCHOOL-V2-C6-attendance-zone-audit.md`
신규(기존 문서 전부 보존, 겹치는 내용 없음).

상태: BLOCKER 없음. main merge 없음.

**SCHOOL_V2_C6_AUDIT_CLOSE = YES** —
`ATTENDANCE_ZONE_DATA_READY = CONDITIONAL`(라이선스는 CLEARED,
identity 조인 방법론도 확정됐으나 원본 geometry 파일 미확보로 실제
구현 착수 전 조달 방법 확정 필요). `SCHOOL_V2_D_READY_AFTER_C6 =
CONDITIONAL`(data contract·UI 원칙은 준비됐으나 원본 데이터 확보가
선행 조건).


## 2026-08-22 (31) — SCHOOL V2-C6-A 부산 통학구역 실데이터 빌드(SHP/CSV 실제 파싱)

별도 worktree(`D:/anti2/aaa/e-jip-school-c6a`, branch
`school-v2-c6a-busan-zone-build`, base `dfadbf0`=school-v2-c6)에서
진행. C6에서 SHP 다운로드를 자동화하지 못해 미검증으로 남겼던
geometry/좌표계/부산 전수 coverage를, 사용자가 직접 다운로드한 공식
원본 3개 파일(초등학교통학구역.zip, 중학교학교군.zip,
학교학구도연계정보.csv, `D:\anti2\aaa\schoolzone-data\`)로 실제
빌드했다. DB/schema 변경, production write, main merge, Score 변경
전부 없음.

**CRS 실측 확정**: `.prj` WKT가 `Korea_2000_Korea_Central_Belt_2010`
(EPSG:5186)임을 확인, proj4 파라미터를 PRJ 원문 그대로 옮겨 WGS84로
변환 — 변환 결과가 실제 부산 좌표 범위와 일치함을 확인(추정 아님).

**부수 발견**: SHP 속성의 `SD_CD`+`SGG_CD`가 이 프로젝트의
`School.sigunguCode`(=MOLIT lawdCd)와 완전히 동일한 5자리 포맷임을
부산 16개 구·군 전부(16/16) 대조로 확인 — 별도 crosswalk 테이블 없이
지역 조인 가능.

**geometry quality audit**: 전국 규모(7,140+1,684건) 정밀 검사는 CPU
비용 문제로 중단하고 부산 subset(308+24건)만 전량 실행 — 부산 초등
305/308 valid(invalid 3건: 장림초/개포초/신덕초통학구역, 자체교차,
repair 안 함, 매칭 아파트 25건 플래그만 남김), 부산 중학교군 24/24
valid.

**identity resolver 2단계로 확장**: C2B-A 방법론(이름+지역+학교급
정확 매칭, fuzzy 금지)을 재사용하되, 1차(같은 lawdCd)에서 실패한
19건 중 18건이 **공동(일방)통학구역의 opt-in 학교가 zone 관할
구·군과 다른 구·군에 실제로 위치**하는 구조적 사실임을 실측 확인
(예: 금성초·공덕초는 canonical sigunguCode=26410(금정구)이지만
26260/26320/26470 소속 zone에서 opt-in 대상으로 연결됨) — 부산
전역 재검색 2차 tier(MEDIUM)를 추가해 이름+학교급 유일 매칭만
채택(fuzzy 아님, 지역 범위만 확장). 최종: HIGH 319, MEDIUM 18,
LOW 0, NO_MATCH 1(신연초등학교(휴교) — 명칭 불일치, 임의 판단 안
함).

**부산 3,402개 아파트 전체 point-in-polygon 실행**: MATCHED_SINGLE
3,191 / MATCHED_SHARED 76 / IDENTITY_UNRESOLVED 130(대부분
MEDIUM으로 실사용 가능, 진짜 미해결 1건) / OVERLAP 0 / NO_MATCH
4(REVIEW_REQUIRED로 남김, 임의 배정 없음) / COORDINATE_MISSING 1.
`ZONE_GEOMETRY_MATCH_COVERAGE` 99.85%, `USABLE_SCHOOL_IDENTITY_
COVERAGE`(HIGH+MEDIUM) 99.82%, `HIGH_CONFIDENCE_ONLY_COVERAGE`
96.03% — 세 단계로 정직하게 분리(착시 방지).

**C6 라이브 파일럿과 교차검증**: 향원에이스타운(79)→대신초/동신초,
신화타워→온천초(큰)/공덕초·금성초(작은) 결과가 이번 STEP의 대량
파일 기반 파이프라인 결과와 **완전히 일치** — 두 독립된 방법(라이브
GIS UI vs 원본 파일 대량 처리)이 서로를 뒷받침.

**nearest vs 공식 통학구역 비교**(School 좌표 0%라 부산 초등 305개교
Kakao 키워드 검색으로 읽기전용 geocoding 후 비교, DB 저장 안 함):
SAME 72.2%(2,452건), DIFFERENT 22.0%(749건), MULTIPLE_ZONE_OPTIONS
5.8%(196건) — "가장 가까운 학교=배정학교" 가정이 5건 중 1건 이상
틀린다는 것을 실측으로 확인.

**중학교 학교군 실측**: 부산 24개 zone, 소속 학교 수 1~18개로 편차
큼(1개교뿐인 zone 7개는 사실상 단일 배정과 동일). 10개 구·군
아파트 샘플 lookup 전부 실행.

라이브러리 3개 신설(`attendance-zone-source.ts`,
`zone-school-identity-resolver.ts`, `attendance-zone-matcher.ts`) +
node:test 기준 29개 신규 테스트 전부 통과(기존 119개 포함 148/148
회귀 없음). tsc/eslint/build 전부 clean.

문서: `docs/development/SCHOOL-V2-C6A-busan-attendance-zone-build.md`
신규(기존 문서 전부 보존).

상태: BLOCKER 없음. main merge 없음.

**SCHOOL_V2_C6A_CLOSE = YES** — `ATTENDANCE_ZONE_DATA_READY =
CONDITIONAL`(파이프라인·coverage·identity 전부 실증됐으나 NO_MATCH
4건 + 신연초 1건 REVIEW_REQUIRED, School 좌표 미확보가 남은 조건).
`SCHOOL_V2_D_READY = CONDITIONAL`(§17 data contract 확정, 실제 연동은
후속 STEP).


## 2026-08-22

### STEP — SCHOOL V2-C6-B: 통학구역 예외 해소 + V2 persistence 준비

C6-A(브랜치 `school-v2-c6a-busan-zone-build`)를 base로 새 워크트리에서 작업(main
체크아웃의 무관한 C3A 미커밋 변경과 격리). C6-A의 4가지 미해결 항목을 실측으로
정리했다.

**NO_MATCH 4건**: 전부 zone 경계 17~84m 이내, 1983~2004년 준공(신규 개발 아님).
3건은 `geocodeQuality='normalized'`(좌표 오차 가능성), 1건(글로벌빌라트)은
`'exact'`인데도 zone 밖(polygon gap 쪽 근거 강함) — A/B 원인을 단정하지 않고
`REVIEW_REQUIRED`로 통일.

**invalid geometry 25건**: 기존 `classifyApartmentZoneStatus()`(C6-A, 수정 안 함)가
`geometryInvalid` 플래그를 최종 status에 전혀 반영하지 않아 25건 전부
`MATCHED_SINGLE`(확정처럼 노출)로 나오고 있었음을 실측 확인 — 새 status 레이어에서
`REVIEW_REQUIRED`(`INVALID_ZONE_GEOMETRY`)로 분리.

**신연초등학교**: 지시문이 전제한 "canonical School 664"는 실제로 조회하니
효림초등학교였다(전제 오류 정정). 신연초 후보(`School.id=454`, 남구, lawdCd 일치,
유일 후보)는 실제로 있었으나 "(휴교)" 표기의 실제 의미를 이 STEP만으로 확정할
근거가 없어 identity는 NO_MATCH 유지(억지 연결 금지). 좁은 접미사 인식 규칙을
설계 제안만 남김(미적용).

**MEDIUM 18건(129개 아파트)**: resolver 코드 자체가 "이름+학교급 부산 전역 유일
매칭"일 때만 MEDIUM을 주도록 설계돼 있어, 이는 identity 불확실이 아니라
"학교는 확정, 행정구역만 교차"임을 확인 — `REGION_CROSSING_BUT_IDENTITY_CONFIRMED`로
판정, REVIEW_REQUIRED로 내려보내지 않음. 이 과정에서 **공동학구가 아닌 일반 단일
zone에도 같은 행정구역 교차 패턴이 있다**는 C6-A에 없던 사실을 추가로 발견
(금성초통학구역/양동초통학구역, 2개 zone).

**최종 status 모델**: 기존 C6-A 코드(geometry matcher, identity resolver)는
전혀 수정하지 않고, 그 출력을 입력받는 새 순수 함수
`scripts/education/lib/attendance-zone-status.ts::resolveFinalAttendanceStatus()`를
추가해 내부 기술상태와 사용자 표시상태(`AVAILABLE`/`SHARED`/`REVIEW_REQUIRED`/
`NOT_AVAILABLE`)를 분리. "배정학교"/"오류" 표현 없음, 최근접 학교 fallback 없음.

**최종 coverage**: 초등 AVAILABLE 3,175 / SHARED 196 / REVIEW_REQUIRED 30 /
NOT_AVAILABLE 1(합계 3,402) — AVAILABLE+SHARED = 99.09%. 중학교 AVAILABLE 3,400 /
REVIEW_REQUIRED 1 / NOT_AVAILABLE 1.

**precomputed artifact**: `data/education/attendance-zone/busan-attendance-zone-
20260320.json`(부산 3,402건 전체, geometry 미포함, 약 5.8MB, 결정론적 checksum
포함) 신규 생성. `scripts/education/c6b-04-final-pipeline.ts`로 재생성 가능.

**read-only API 헬퍼**: `src/lib/education/attendance-zone.ts::
getApartmentEducationZone(aptSeq)` 신규(DB 접근 없음, 아직 어떤 route에서도
import 안 됨 — SCHOOL V2-D 범위).

**regression**: 향원에이스타운(대신초+동신초 SHARED), 신화타워(온천초 HIGH +
공덕초·금성초 MEDIUM, SHARED — REVIEW_REQUIRED 아님), NO_MATCH 4건, invalid
geometry 샘플, 중학교 학교군 샘플 전부 기대대로 통과.

라이브러리 2개 신설(`attendance-zone-status.ts`, `src/lib/education/
attendance-zone.ts`) + node:test 기준 신규 19개 테스트 전부 통과(기존 148개 포함
167/167 회귀 없음). tsc/eslint/build 전부 clean. DB write/migration/Score
변경/main merge 없음.

문서: `docs/development/SCHOOL_V2_C6B_ATTENDANCE_ZONE_EXCEPTIONS.md` 신규(기존
문서 전부 보존).

상태: BLOCKER 없음. main merge 없음.

**SCHOOL_V2_C6B_CLOSE = YES** — `ATTENDANCE_ZONE_PRODUCT_READY = YES`(status
모델·artifact·API contract 전부 확정). `SCHOOL_V2_D_READY = YES`(read-only 헬퍼
구현 완료, 실제 route 연동만 남음).


## 2026-08-22

### STEP — SCHOOL V2-INTEGRATION-1: 승인된 SCHOOL V2 branch 통합

여러 격리 worktree에 흩어져 있던 SCHOOL V2 작업(C2A/C2B/C2B-A/C2B-B/LEGAL-1/
C3B/C5/C5-A/C5-B/C6/C6-A/C6-B)을 SCHOOL V2-D 구현 전에 하나의 clean branch로
통합했다. 새 기능/UI 구현/migration/production write/main merge 없음.

main의 `.gitignore` 전용 커밋(`ec23919`)을 `git show --name-status`로 재확인해
C3A 파일 혼입 0건을 재검증(push는 하지 않음), C3A 미커밋 작업은 파일시스템
조회로만 확인하고 손대지 않았다.

**ancestry 실측 재검증** 결과 보고서 전제와 다른 사실을 확인: C3B는 C2A조차
포함하지 않고 C1에서 직접 분기했고, LEGAL-1은 C2B-A/C2B-B를 포함하지 않는
형제 branch이며, C5 계열은 C2B 계열과 완전히 독립이었다. 실제 공통 조상
82f4914(C1)에서 새 worktree/branch(`school-v2-integration`)를 만들고 4회
`git merge --no-ff`로 통합(C6-B chain → LEGAL-1 → C5 chain → C3B).

conflict는 3회 모두 `docs/development/CHANGELOG.md` 1개 파일에서만 발생(같은
날짜 병렬 작업으로 인한 append 충돌), product code/schema 파일 conflict는
0건 — 최신 우선이 아니라 실제 branch 분기 시점(ancestry)에 맞춰 항목을
재배치해 해결했다. LEGAL-1과 C2B-A가 4050166에서 독립적으로 만든
near-duplicate 파일(`c2b-verify-schoolinfo-api.ts`,
`SCHOOL-V2-B-official-source-verification.md`)은 git이 동일 content로 인식해
conflict 없이 자동 병합됨을 확인.

과거 "clean 아니오(검토용 보존)" 기록이 있던 C3B worktree를 재확인한 결과
**실제로는 clean**이었다 — 최초 확인 시 `--git-dir`를 main으로 강제 지정해
main HEAD와 비교하는 바람에 전체 파일이 오탐으로 modified 표시된 내 실수였다.
`git -C`(자동 감지)로 재확인해 정정.

**통합에서만 드러난 실제 correctness 문제 1건 발견 및 수정**: C2A의
`verify-school-normalization.ts`와 C3B의 `verify-kindergarten-normalization.ts`는
각 branch 단독으로는 문제없었지만, 둘 다 top-level import/export가 없어
TypeScript가 전역 스크립트로 취급 — 두 branch가 처음 한 프로젝트에 공존하자
`tsc --noEmit`에서 변수 재선언 충돌 10건이 새로 발생했다. 각 파일에
`export {};` 한 줄을 추가해 모듈 스코프로 격리(로직 변경 없음).

읽기 전용 검증: School canonical taxonomy(초등305/중176/고159/특수16/기타8,
합계664) 재확인, Kindergarten 부산 367건(officialCode 중복 0, OFFICIAL_POINT
provenance, capacity/enrollment/classCount/ageBreakdown 전부 유지) 확인 —
실제 ingestion 재실행 없음. attendance-zone artifact(3,402건, geometry 미포함,
checksum 존재) 무결성 확인, `getApartmentEducationZone()` 회귀(향원에이스타운/
신화타워/invalid geometry/NO_MATCH/COORDINATE_MISSING) 전부 기대대로 통과.
distance wording/hardcoded fallback 전수검사 — `WRONG_REGION_FALLBACK_COUNT =
0`, "도보 N분" 오표기 0건(유일한 매치는 지하철 역세권 표현으로 무관 확인).

artifact(5.76MB)는 현재 어떤 route에서도 import되지 않아 client bundle 위험
0건이나, SCHOOL V2-D 연동 시 서버 전용 호출을 강제할 것을 권고(코드는
추가하지 않음). SCHOOL V2-D dependency map(`/apt/[name]` →
`SchoolDistrictPanel` → 신규 카드 필요 지점) 조사만 완료, 코드 변경 없음.

신규 테스트 없음(기존 코드 재사용/재배치만), 기존 167개 전부 통과(lib 61 +
redevelopment 97 + education helper 9 — redevelopment "97"은 과거 문서의
"119" 표기가 부정확했던 것으로 확인, 통합 과정에서 누락된 테스트 없음).
tsc(수정 후 0 errors)/eslint(0 errors)/build(성공, 기존 라우트 그대로) 전부
clean.

문서: `docs/development/SCHOOL_V2_INTEGRATION1.md` 신규(기존 문서 전부 보존).

상태: BLOCKER 없음. main merge 없음. 병렬 branch(C2A/C2B/C2B-A/C2B-B/C3B/C5/
C5-A/C5-B/C6/C6-A/LEGAL-1/SCORE 전부) 커밋 해시 불변 확인 — 미접촉.

**SCHOOL_V2_INTEGRATION1_CLOSE = YES** — `SCHOOL_V2_INTEGRATION_READY = YES`
(product code + tooling + docs 전부 한 branch에 통합, test/tsc/lint/build
전부 clean). `SCHOOL_V2_D_READY = YES`(§13 dependency map 확정, 실제 UI/route
연동만 남음).


## 2026-08-22

### STEP — SCHOOL V2-D1: 부모 의사결정형 교육환경 UX 구현

`school-v2-integration`을 base로 `school-v2-d1-parent-education-ui` 브랜치에서
단지 상세(`/apt/[name]`)의 "학군" 탭을 실제 부모용 UI로 구현했다. 기존
`SchoolDistrictPanel`(카카오 POI 나열)을 신규 `EducationPanel`로 대체(중복
section 없음).

신규 `GET /api/apt/[name]/education` route(기존 `/info`/`/score`/`/facilities`
형제 route)를 만들었다 — `getApartmentEducationZone()`이 5.76MB artifact를
읽는 무거운 호출이라 기존 route에 얹지 않기로 결정, aptSeq 해석은 `/score`
route와 동일한 안전 매칭 원칙만 재사용(코드 공유 아님, `/score` 자체는
미변경). Kindergarten(367건, turf 거리)과 고등학교(Kakao 키워드검색 +
이름+lawdCd+HIGH 완전일치일 때만 canonical 설립유형 부착)를 서버에서
직접 조회하는 신규 lib(`nearby-education.ts`)도 추가했다.

초등학교는 "공식 통학구역"과 "가까운 초등학교"를 절대 합치지 않고 분리했고,
"가까운 학교와 통학구역 학교는 다를 수 있어요" 짧은 안내를 덧붙였다(부산
22.0% nearest≠zone 통계 자체는 UI에 노출하지 않음). 중학교는 학교군
accordion, 어린이집은 "0곳" 대신 "준비 중" 고정 문구, 졸업생 진로/SchoolInfo
통계는 데이터가 없어 section 자체를 만들지 않았다(§14/§15 지시대로 "준비 중"
남발 금지).

**브라우저 QA 중 발견한 문제 1건**: 아파트 좌표 자체가 없는 경우
(COORDINATE_MISSING)에도 유치원/고등학교 요약이 "2km 이내 없음"으로 나와
"검색했는데 없었다"처럼 읽혔다 — "확인된 부재"와 "확인 불가"를 구분하지
않은 것. `reasonCode` 신호로 분리해 "확인 불가"/"단지 위치를 확인할 수
없어..." 문구로 수정.

`server-only` npm 패키지는 이 프로젝트의 실제 test 실행 방식(tsx --test,
plain Node)과 충돌해(무조건 throw) 기존 테스트를 깨뜨림을 확인하고 채택하지
않았다 — 대신 `typeof window !== 'undefined'` 최소 runtime guard를 직접
추가. 빌드 후 `.next/static`에 artifact 문자열 0건, `.next/server`에는 정상
포함됨을 grep으로 실측 확인(client bundle 위험 없음).

향원에이스타운(SHARED)/신화타워(SHARED, MEDIUM 포함)/한진(REVIEW_REQUIRED)/
에코델타호반써밋스마트시티(NOT_AVAILABLE)/비스타동원더비치테라스(AVAILABLE
단일) 5개 샘플 + 중학교군/유치원/고등학교 실제 데이터 전부 브라우저(390px)·
API로 QA 완료 — school name 정확, wrong-region 0건, 최근접 fallback을
통학구역 대신 쓴 사례 0건, "배정학교"/허위 도보/가짜 SchoolInfo 통계/어린이집
"0곳" 전부 0건.

신규 테스트 18개(라벨/분기 로직 10 + source-content guard 8, DOM 렌더링
프레임워크가 없어 순수 함수+소스 검사로 대체) + 기존 167개 포함 185/185
통과. tsc/eslint 0 errors, build 성공(신규 route 정상 컴파일, 기존 라우트
회귀 없음). 360/375/430/desktop 개별 뷰포트 스크린샷은 브라우저 자동화 도구
불안정으로 미완료(정직하게 기록).

문서: `docs/development/SCHOOL_V2_D1_PARENT_EDUCATION_UX.md` 신규(기존 문서
전부 보존).

상태: BLOCKER 없음. main merge 없음.

**SCHOOL_V2_D1_CLOSE = YES** — `PARENT_EDUCATION_UX_READY = YES`(초등/중학교/
유치원/고등학교/어린이집 전부 실제 데이터 또는 정직한 준비-중 상태로 구현).
`SCHOOL_V2_D2_READY = YES`(SchoolInfo/13-다/Childcare 데이터 확보 시 확장할
자리와 원칙 확정).


## 2026-08-22

### STEP — SCHOOL V2-D1-QA: 부모 교육 UX 반응형 시각 검수

D1에서 미완료로 남았던 360/375/430/desktop 개별 뷰포트 실측을 마무리했다.
새 기능 개발 없음, `school-v2-d1-parent-education-ui` 브랜치 그대로 사용.

5개 뷰포트(360×800/375×812/390×844/430×932/1440×900) × 5개 status 샘플
(신화타워=SHARED+MEDIUM, 비스타동원더비치테라스=AVAILABLE, 한진=
REVIEW_REQUIRED, 향원에이스타운=SHARED 대칭, 에코델타호반써밋스마트시티=
NOT_AVAILABLE)을 브라우저로 실제 렌더링해 확인, 스크린샷 5장 저장해
사용자에게 전달했다.

**실제 버그 1건 발견 및 수정**: 360px에서 유치원 카드의 "직선거리 약 418m"와
"더보기" 버튼이 줄바꿈 없이 붙어 보이는 문제 — `.expandToggle`이
`display: inline-flex`라 앞선 인라인 텍스트와 한 줄에 머물 수 있었던 것이
원인. `display: flex`로 변경해 항상 새 줄에서 시작하도록 수정. 그 외 발견된
문제는 없음(overflow/clipping/bottom-nav 충돌/touch-target 전부 정상).

CSS 1개 파일만 수정해 tests(185/185, 변동 없음)/tsc/eslint/build 재실행,
전부 clean. `SCHOOL_V2_D1_PARENT_EDUCATION_UX.md`에 §26으로 결과를
append(기존 기록 삭제 없음).

상태: BLOCKER 없음. main merge 없음.

**SCHOOL_V2_D1_VISUAL_QA_CLOSE = YES** — **SCHOOL_V2_D1_FINAL_CLOSE = YES**
(기능 구현+반응형 시각 검수 전부 완료).

## 2026-08-23

### STEP — SCHOOL V2-C2C: 13-다(졸업생의 진로 현황) 공식 데이터 확보 경로 감사 (AUDIT ONLY)

`school-v2-c2c-graduate-outcome-audit` 브랜치(base: `school-v2-d1-parent-education-ui`).
13-다가 OpenAPI 35개 카테고리에 없다는 기존 SCHOOL V2-C2B(§10) 판단을 실 API
제공목록 화면(학사/학생·재정/시설/설비·보건/복지 3개 탭, 총 34개 오퍼레이션)
직접 순회로 재확인하고, 대신 사용자가 실제로 확인한 웹 공시 페이지 경로를
처음부터 실측했다.

**핵심 발견**: `Pneiss_b01_s0.do?SHL_IDF_CD={school-uuid}&GS_HANGMOK_CD=06`
(로그인/세션/CSRF 불필요, 완전 공개)로 13-다 데이터에 직접 접근 가능함을
경남고등학교(일반고)·부산외국어고등학교(특목고) 실 데이터로 확인, 부산컴퓨터
과학고등학교(특성화고)는 "입력된 데이터가 없습니다"로 정상적인 NO_DATA 케이스도
확보. 공식 "엑셀다운로드" 버튼(`POST /cm/include/ExcelPrint.do`)은 존재하나
조사 시점 5회 연속 HTTP 503(학교·항목 무관, fetch 재현으로도 동일) — 서버측
SERVICE_ERROR로 판단, 자동화 난이도 문제로 오판하지 않음.

school identifier `SHL_IDF_CD`(schoolinfo 내부 UUID)가 기존 `School.neisSchoolCode`/
C2B-A 리졸버 어느 것과도 연결되지 않는 새로운 identity 갭으로 확인됨 —
자동 ingestion 전 별도 crosswalk 설계 필요.

라이선스: 13-다는 OpenAPI 오퍼레이션 자체가 없어 LEGAL-1이 확인한 "오퍼레이션별
관대한 이용조건"의 적용 대상이 아니며, 사이트 공통 저작권정책만 적용됨을 확인 →
`GRADUATE_OUTCOME_LEGAL_GATE = REVIEW_REQUIRED`로 판정(CLEARED 아님).

`scripts/education/lib/graduate-outcome-parser.ts`(타입+산술검증 함수) +
`.test.ts`(8케이스: 정상/취업0/해외0/해외분해/NO_DATA/비율포맷/정합성위반/
연도별중복) 신규 — 전부 실측값 기반, 가상 데이터 없음. 8/8 PASS, tsc/eslint
신규 파일 0 errors. DB write/migration/production ingestion/UI 변경 전부 없음.

`SCHOOL-V2-B-official-source-verification.md` §1-4 뒤에 이번 재조사 결과를
append(기존 "AVAILABLE_API" 오판 기록은 삭제하지 않고 보존).

상태: BLOCKER 3건(Excel 서비스 503 / identity crosswalk 부재 / 라이선스
REVIEW_REQUIRED) — 전부 해소 전까지 production 착수 안 함. main merge 없음.

**SCHOOL_V2_C2C_CLOSE = YES** — **GRADUATE_OUTCOME_DATA_READY = NO**,
**SCHOOL_V2_D2_GRADUATE_READY = NO**(3건 블로커 해소 후 재검토).

## 2026-08-23 (2)

### STEP — SCHOOL V2 FINAL QA / CLOSE: 부산 전역 부모용 교육정보 출시 승인 심사

`school-v2-final-qa` 브랜치(base: `school-v2-c2c-graduate-outcome-audit`,
D1 반응형 QA 커밋 `c3e7401` 포함 확인됨). "현재 확보한 실제 데이터만으로
SCHOOL V2를 부산 사용자에게 공개해도 안전한가?"를 최종 판정하는 RELEASE
ACCEPTANCE QA — 새 기능 개발 없음.

**핵심 결과: SCHOOL_V2_RELEASE_READY = YES, BLOCKER 0건.** canonical 부산
데이터(School 664/Kindergarten 367/Apartment 3,402/attendance artifact
3,402건)를 DB·artifact 실측으로 재확인, 전부 지시사항 기대치와 정확히
일치(invalid geometry 25 / boundary-gap 4 / coordinate-missing 1 / SHARED 196
등). 부산 16개 구·군 대표 단지 전수 + 서구 5건 심층(SHARED/REVIEW_REQUIRED
포함) + 해운대 API 실측으로 wrong-region 0건 확인, 브라우저 실측으로 "공식
통학구역"과 "가까운 학교" 카드가 명확히 분리 렌더링됨을 눈으로 확인(중학교
학교군은 8개교 전체 나열, 임의 대표 선택 없음). 동명이교(송정초/대저중앙초/
가락중/경일중) 회귀 0건, 신연초(휴교) NO_MATCH 안전 처리 확인 — 다만
`School.isActive`가 664건 전부 true이고 canonical School 쿼리 경로 일부가
isActive 필터를 아직 걸지 않는 구조적 한계(NEIS에 폐교 판정 필드 자체가
없어 발생, 현재 실피해 0건)를 신규로 문서화해 V2.1 backlog에 추가했다.

**실제로 발견해 수정한 버그는 2건**(카테고리 D, 오해 소지 있는 UX): `/school`,
`/school/[id]` 페이지의 SEO `<meta description>`이 항상 "데이터 준비 중"으로만
표시되는 특목고 진학률/학년별 학생수를 마치 확인 가능한 것처럼 광고하고
있었다 — 해당 문구를 제거(1줄씩 2개 파일). SchoolInfo 통계(0건)/Childcare(0건)/
13-다 진로(코드 자체에 부재)는 전부 정직하게 숨김/"준비 중" 처리돼 있어
가짜 데이터 노출 0건, "도보 N분" 표현도 education 범위에서 0건(C5-A에서
이미 해결된 것을 재확인) — 별도 수정 불필요.

worktree에 자체 `node_modules`가 없어 최초 `next dev`/`next build`가
Turbopack workspace-root 오류로 실패 — `npm ci`로 로컬 설치 후 정상 빌드
확인, 프로덕션 `.next/static`을 실제로 grep해 5.76MB attendance-zone
artifact가 클라이언트 번들에 전혀 포함되지 않음을 실측 확인(이전엔 파일
부재로 확인 불가였던 것을 이번에 최초로 실측 검증). `npm ci` 이후 전체
테스트 193/193 PASS, tsc/eslint 신규 오류 0건(설치 전 관찰된 shapefile류
7건은 코드 결함이 아니라 worktree에 `node_modules`가 없던 환경 문제였음을
확인).

`docs/development/SCHOOL_V2_FINAL_QA_AND_CLOSE.md` 신규(62개 항목 최종
보고 포함). DB write/migration/SchoolInfo ingestion/Childcare ingestion/
13-다 scraping/Score 변경 전부 없음. main C3A 및 병렬 worktree 전부 미접촉.
main merge 없음.

**SCHOOL_V2_RELEASE_READY = YES** — **SCHOOL_V2_FINAL_CLOSE = YES**.

## 2026-08-21 (26)

### BUSAN SCORE DATA V1.1 — Geocoding Recovery + Missing Feature Backfill

SCORE DISPLAY BUG AUDIT(해운대동백두산위브더제니스 "점수 산정 준비
중" 이슈)에서 확정된 원인 — 부산 ApartmentMaster 3,402건 중 335건이
`geocodeQuality='failed'`라 `ApartmentLocationFeature` 수집 대상에서
원천 제외돼 있었던 것 — 을 실제로 해소했다.

335건의 실제 주소 데이터를 분석한 결과 44건은 완전한 도로명/지번
주소를 이미 갖고 있었음에도 실패해 있었고(원인: 기존 지오코딩
스크립트가 Kakao 전용 주소 geocoder `search/address.json` 대신
POI 키워드 검색 `search/keyword.json`만 썼고, 처음 배치 시점에
일시적으로 실패했던 것으로 추정), 나머지는 저장된 주소 문자열이
없어 이름 단독 키워드 검색에 의존했을 것으로 추정된다(실측: 아파트
이름만으로 검색하면 완전히 다른 지역의 동명 건물이 잡히는 사례
확인). 신규 복구 스크립트(`recover-missing-geocodes.ts`)는
`address.json`을 최우선으로 쓰고, 시도+시군구 일치 검증과 좌표
충돌 검사를 통과한 경우에만 write하도록 설계했다.

335건 중 **334건(99.7%) 복구 성공**, 1건(에코델타호반써밋스마트시티,
강서구)은 MOLIT 원본 지번 필드 자체가 `"가-"`로 불완전해(2024년
준공 신축 택지지구) unresolved로 남겼다 — 임의 좌표를 만들지
않았다. 복구된 334건에 대해 기존 `collect-location-features.ts`를
코드 변경 없이 재실행해 `ApartmentLocationFeature`를 채웠고,
`calculateApartmentScore()`(수정 없는 production 함수)로 재계산한
결과 334건 전부 OK, score 분포도 기존 3,059건과 사실상 동일했다.

대상 단지(`26350-2360`)는 이제 `status=OK, score=57, coverage=1,
confidence=HIGH`로 정상 표시된다. 기존 정상 6개 단지(해운대/서구/
부산진구 샘플) regression 확인 결과 전부 변화 없음 — score
formula/weight/threshold는 이번 STEP에서 전혀 수정하지 않았다.

**Readiness 정의를 두 지표로 분리**: (A) feature 보유 단지 중 OK
비율 = 100%, (B) 부산 전체 ApartmentMaster 중 OK 비율(진짜 커버리지)
= 3,401/3,402 = 99.97%. 기존 BUSAN SCORE DATA V1 문서(§9, §15-17)의
"3,067/3,067 OK"는 사실 (A) 기준이었음을 신규 문서(V1.1)에서 명시했다
— 원본 V1 문서는 당시 기록 그대로 보존하고 수정하지 않았다.

DB 변경: `ApartmentMaster` 334행 update(latitude/longitude/
geocodeQuality만, schema 변경 없음), `ApartmentLocationFeature` 334행
신규(기존 collector 그대로). 코드 변경: `scripts/apartment-score/`에
신규 스크립트 3건(recover-missing-geocodes.ts,
verify-recovery-scores.ts, audit-score-status.ts) — production
score 로직/route/UI 변경 0건.

검증: `tsc`/`eslint`(0 errors)/`next build` 전부 통과, regression
샘플 6건 전부 무변화 확인.

상태: BLOCKER 없음(1건 unresolved는 별도 후속 STEP 대상으로 분류,
전체 작업의 BLOCKER 아님), coverage 99.97% 달성 — commit/push 진행.

**BUSAN_SCORE_DATA_V1_1_CLOSE = YES** —
`TRUE_BUSAN_SCORE_COVERAGE_READY = YES(99.97%, 1건 unresolved)`.

## 2026-08-23

### STEP — E-JIP SCORE V2 STEP 0: 현재 Score 법의학적 감사 (AUDIT ONLY)

`score-v2-step0-forensic-audit` 브랜치(base: `score-geocode-recovery`,
main보다 실제 score 데이터가 더 완전해 이쪽을 base로 채택 — main은 이
branch가 가진 좌표 복구 커밋을 아직 병합받지 못한 상태였음을 git diff로
확인). "대신해모로센트럴(신축·대단지·초역세권 체감)이 협성르네상스(구축)보다
종합점수가 낮다"는 사용자 위화감의 실제 원인을 코드+실 데이터로 완전히
해부했다 — weight/formula 변경 없음, DB write 없음.

**핵심 결론**: 계산 공식 자체는 정확하다(가중합 재현 100% 일치, Seo-gu
171건 전수 검사에서 명백한 monotonicity 위반 없음). "이상해 보이는" 결과의
진짜 원인은 **모든 카테고리가 순수 peer-relative percentile만 쓰고 절대
품질 개념이 전혀 없다**는 구조적 특성이었다 — 대신해모로의 지하철 140m(객관적으로
매우 가까움)가 percentile 61%에 그친 건 같은 동(서대신동2가)에 8곳이나
더 가까운 단지가 있기 때문이고, 주차 1.09대→18점 vs 1.58대→95점은 준공연대별
peer 표본이 5~8건으로 극소해 작은 절대 차이가 순위 뒤집힘으로 증폭된
것이었다(실측 percentile 14.3%/100% → score 정확히 18/95 재현). 부산 3,401건
전체 계산으로 이 패턴이 개별 사례가 아니라 구조적임을 정량 확인: parking만
유일하게 저-coverage(25.3%)+극단분포(≤10점 10.4%, ≥90점 8.5%)를 보였다.

"단지" 카테고리는 buildYear가 50% sub-weight인데 households/mainBuildingCount
coverage가 15~34%뿐이라 실무적으로 거의 buildYear 단독 도메인이다
(buildYear↔complexScore 상관계수 0.825로 재확인) — FAR/BCR/브랜드/커뮤니티는
전혀 반영되지 않아 "단지"라는 이름과 실제 의미가 크게 어긋난다. 학교
접근성도 "거리"만이고 SCHOOL V2의 공식 통학구역/학교군/유치원 데이터와는
완전히 분리 운영 중임을 재확인(코드 레벨, import 0건).

좋은 소식도 확인: market(가격) weight는 이미 0으로 분리돼 "가격=좋음" 편향을
막고 있고, `school-access-sentence.ts`가 이미 "절대 사실 → 상대 비교" 순서로
모순 방지 문장을 만드는 패턴을 구현해 뒀다 — V2의 explainability 설계는
이 기존 패턴을 4개 도메인으로 일반화하는 것으로 시작하면 된다.

`scripts/apartment-score/step0-01~05*.ts` 5개 read-only 분석 스크립트 신규
(production 코드 0줄 수정). 대신해모로/협성르네상스/구덕금호 3단지 full
trace, Seo-gu 171건 전수 ranking, 부산 3,401건 전체 분포, 28건 benchmark
set을 실측으로 확보. tsc/eslint 신규 파일 0 errors.

`docs/development/EJIP_SCORE_V2_STEP0_FORENSIC_AUDIT.md` 신규(23개 섹션,
64개 항목 최종 보고 포함). trust decision = KEEP_BETA_WITH_WARNING,
redesign = 부분적 필요(explainability 우선, weight 재산정은 그 다음).

상태: BLOCKER 없음. Score code/DB/migration/UI 변경 전부 없음. main 및
병렬 worktree 전부 미접촉.

**SCORE_V2_STEP0_CLOSE = YES**.

## 2026-08-23 (2)

### STEP — E-JIP SCORE V2 STEP 0.5: Transport Data Truth Audit (AUDIT ONLY)

STEP 0이 "대신해모로보다 지하철이 가까운 peer 8곳"이라 보고한 것을 raw
데이터 레벨까지 완전히 재검증. 결과: 정확히는 7곳(경미한 카운트 오차
정정)이며, **거리 계산 로직 자체는 완벽히 정확했다**(Kakao 실시간
재조회 좌표로 Turf Haversine 재계산 시 저장값과 delta -1~+1m, 사실상
100% 일치). 서대신역/동대신역도 실존하는 별개 역으로 확인(654~767m
이격, 좌표 중복이나 오류 아님) — station-center 단위 POI(출입구별
데이터는 Kakao에 없음)라는 것도 실측으로 확정.

**진짜 문제는 계산이 아니라 peer 구성이었다**: "더 가까운 7곳" 전부
건축물대장(총괄표제부) 연결이 없고(`totalHouseholds`/`roadAddress`/
`jibunAddress` 전부 null), TradeHistory 이름 매칭 거래도 0건이며, 그중
5곳은 실제 주소가 아니라 "동+건물명" Kakao 키워드 검색으로 좌표를 채운
`geocodeQuality='normalized'`다. 대신해모로가 속한 동(서대신동2가) 지하철
거리 TOP 20 중 18곳(90%)이 이런 "registry 미연결" 항목이고, 진짜
건축물대장 등록 대단지(대신해모로 733세대, 대신푸르지오2차 815세대)는
각각 8위·16위로 밀려나 있었다. 부산 전체로 확대하면 ApartmentMaster
3,401건 중 1,725건(50.7%)이 이 "고위험 조합"에 해당 — 서대신동 국지
사례가 아니라 부산 전역 transport peer pool의 구조적 특성임을 확인했다.

root cause 판정: E(PEER_UNIVERSE_ERROR) 확정(주원인), B(APARTMENT_
COORDINATE_ERROR) 의심·미확정(보조), STEP 0의 A/G(모델 설계) 결론은
유효 — C(역 좌표 오류)/D(역 identity 오류)/F(거리 계산 오류)/H(중복
POI)/I(데이터 노후화)는 전부 이번 STEP 실측으로 배제했다.

`scripts/apartment-score/step05-01~05*.ts` 5개 read-only 스크립트 신규
(production 코드 0줄 수정, DB write 0건). tsc/eslint 신규 파일 0
errors. `docs/development/EJIP_SCORE_V2_STEP05_TRANSPORT_DATA_TRUTH_AUDIT.md`
신규(16개 섹션, 36개 항목 최종 보고).

상태: BLOCKER 없음. **TRANSPORT_DATA_TRUSTED = PARTIAL**(대상 단지
자신의 raw distance는 신뢰 가능, peer 비교 구성은 신뢰 불가).
**SCORE_V2_STEP1_READY = NO** — weight 재설계 전에 peer 품질 필터링을
먼저 권고. main 및 병렬 worktree 전부 미접촉.

**SCORE_V2_STEP05_CLOSE = YES**.

## 2026-08-23 (3)

### STEP — E-JIP SCORE V2 STEP 0.6: Peer Data Quality & Eligibility Model (DESIGN ONLY)

STEP 0.5가 확정한 "부산 50.7%(1,725/3,401)가 registry 미연결+저신뢰
좌표 고위험 조합"이라는 문제에 대한 직접 처방. "어떤 ApartmentMaster
row가 다른 row의 점수 산정 peer가 될 자격이 있는가"를 실제 evidence
(registry 연결/주소 존재/좌표 geocode 방식/MOLIT 거래이력)만으로
분류하는 quality model을 설계했다 — Score formula/weight는 전혀 건드리지
않았다.

**IDENTITY(HIGH/MEDIUM/LOW/UNRESOLVED)**와 **COORDINATE(HIGH/LOW/
UNRESOLVED — 스키마가 실제로 갖고 있는 exact/normalized/failed 3단계만
반영, 근거 없는 중간 등급은 만들지 않음)** 두 축을 조합해
**PEER_FULL/PEER_LIMITED/DISPLAY_ONLY/UNRESOLVED** 4단계 peer
eligibility를 정의하고, transport/life/school(좌표 기반)과 parking/
complex(registry 기반)를 서로 다른 조건으로 나눴다. 부산 전체 실측:
PEER_FULL 38.2%, DISPLAY_ONLY 51.0%(=STEP 0.5가 확정한 오염원과 정확히
일치), parking처럼 registry 의존 도메인은 eligible이 25.3%까지 떨어진다.

**대신해모로센트럴/협성르네상스로 실제 filtered-peer simulation을
돌려본 결과**(read-only, production 미변경): 대신해모로는 필터링 후
"실제 등록된 대단지(PEER_FULL)" 중에서는 자신의 동에서 지하철
최근접이었고, 협성은 순위가 2/27→1/10로 개선됐다 — quality 필터가
실제로 문제를 해소한다는 것을 확인했다. **세 번째 benchmark인
구덕금호는 신규로 뜻밖의 사실이 드러났다: 이 단지 자기 자신의 좌표가
`normalized`(키워드 geocode) 등급이라, 새 모델 기준으로는 다른 단지의
peer가 될 수 없을 뿐 아니라 자신의 raw 데이터 신뢰도도 낮다** — 숨기지
않고 기록, 3단지 regression sample은 그대로 유지(오히려 유용한
negative-case로 활용 권장).

구·군별로는 PEER_FULL 비율이 중구 8.5%~강서구 75.0%로 8.8배 차이,
동(dong) 단위 LOCAL peer는 필터링 후 46~61%가 표본 5 미만으로
붕괴(SIGUNGU 레벨로 올리면 대부분 안정화되나 parking은 중구 등
소규모 구에서 여전히 위험). 최소 peer 표본은 10을 추천(기존
5에서 상향), parking은 decade-band 완화까지 함께 검토 필요. 고위험
1,725건 중 81%(1,398건)는 MOLIT 거래이력을 활용해 identity를 강화할
여지가 있음을 확인 — 전부 버릴 필요는 없다.

`scripts/apartment-score/lib/peer-quality.ts`(prototype, production
score engine에서 import 안 됨) + fixture test 20개 + read-only 분석
스크립트 4개 신규. 전체 테스트 117/117 PASS, tsc/eslint 0 errors.
`docs/development/EJIP_SCORE_V2_STEP06_PEER_DATA_QUALITY.md` 신규(28개
섹션, 65개 항목 최종 보고).

상태: BLOCKER 없음. **PEER_DATA_MODEL_READY = YES(prototype, production
미연결)**. **TRANSPORT_PEER_TRUSTED = CONDITIONAL**(필터링하면 신뢰
가능, 필터링 전인 현재 production 상태는 여전히 불가). **SCORE_V2_STEP1_READY
= NO**(변경 없음) — quality model을 실제 production peer 조회 경로에
연결하는 것이 다음 단계. DB write/migration/production score 변경
전부 없음. main 및 병렬 worktree 전부 미접촉.

**SCORE_V2_STEP06_CLOSE = YES**.

## 2026-08-23 (4)

### STEP 0.7 — Apartment Identity Recovery: MOLIT/건축물대장 Evidence 기반 (READ-ONLY AUDIT)

STEP 0.6이 발견한 "고위험 1,725건 중 1,398건(81%)이 MOLIT 거래이력으로
identity 강화 여지가 있다"를 실제로 검증했다. 결정적(deterministic)
근거만 사용: 각 row가 이미 갖고 있는 MOLIT 원본 jibun/dong으로
건축물대장을 조회해 그 row 자신의 주소/세대수를 보강하는 단일-row
enrichment(이름/좌표 기반 merge 전혀 없음).

**예상 밖 핵심 발견**: 기존 seed 스크립트는 총괄표제부(다동 단지
전용)만 조회해 대부분 not_found였다. 표제부(단일 건물용) API를
fallback으로 추가하자 전수 1,398건 중 **1,386건(99.1%)이 registry
매칭에 성공**했다 — 등록이 없어서가 아니라 조회 방식이 다동 단지만
가정했던 것이 원인이었다.

Deterministic Level A-D resolver(`step07-recovery-resolver.ts`) 설계:
recordCount(주소 유일성)를 핵심 게이트로 쓰고, 이름 비교는 merge
게이트가 아니라 이상 신호(차수 불일치)로만 사용 — 부산 전체 collision
audit에서 동일이름+구·군 그룹 53개가 **전원 서로 다른 지번**임을
확인해(이름만으로 merge하면 53건 오매칭) 이 설계가 왜 이름 대신
주소를 key로 써야 하는지 실측으로 뒷받침했다.

전수 결과: **RECOVERY_HIGH 1,236건(88.4%) / MEDIUM 116건(8.3%) / REVIEW
34건(2.4%, 차수 불일치·건축년도 불일치 등 adversarial case) / FAILED
12건(0.9%)**. 관찰된 wrong merge/ambiguous auto-merge **0건**(설계상
구조적으로 불가능). 구덕금호(negative benchmark)는 registry 조회
결과 주용도가 "단독주택"으로 확인돼 **정상 아파트처럼 보이게
만들지 않고** RECOVERY_MEDIUM/NON_TARGET으로 정직하게 보고했다.

registry 복구만으로는 좌표(geocodeQuality)가 바뀌지 않아 peer
eligibility에는 무변화라는 사실을 확인한 뒤, 재지오코딩까지
"실제로 성공하는지"를 30건 라이브 spot-check로 검증(100% 성공,
production geocode() 코드 변경 없이 기존 로직 그대로) — 이 투영을
적용하면 부산 PEER_FULL이 38.2%→74.6%, 구·군 격차가 8.8배→1.4배로
좁혀진다(투영치, 실제 DB 반영은 하지 않음).

`scripts/apartment-score/lib/step07-{universe,registry-probe,
recovery-resolver}.ts`(prototype) + fixture test 15개(전부 PASS,
false-positive 0건) + read-only 분석 스크립트 15개 신규. tsc/eslint
0 errors. `docs/development/EJIP_SCORE_V2_STEP07_IDENTITY_RECOVERY.md`
신규(33개 섹션, 44개 항목 최종 보고).

상태: BLOCKER 없음. DB write/migration/production score 변경 전부
없음. main 및 병렬 worktree 전부 미접촉. **IDENTITY_RECOVERY_MODEL_READY
= YES**. **PEER_COVERAGE_ACCEPTABLE = YES(투영치 기준)**. **SCORE_V2_STEP08_READY
= YES** — 다음 단계는 §26 write-plan(1,236건, dry-run 우선) 실제 승인 및
재지오코딩 적용.

**SCORE_V2_STEP07_CLOSE = YES.**

## 2026-08-24

### STEP 0.7-A — Safe Identity Recovery Write (실제 production DB write)

STEP 0.7 §26 write-plan을 실행했다. RECOVERY_HIGH 1,236건 중 dry-run
단계에서 발견한 anomaly 1건(`26380-19` "럭키" — registry 이름/건축년도는
정확히 일치했으나 `mainPurpsCdNm`(주용도) 필드 자체가 결측이라 "공동주택"
양성 확인이 안 됨, resolver의 `classifyUniverse()`가 이 케이스를
`UNKNOWN`으로 반환하는데 `classifyRecovery()`가 MEDIUM으로 걸러내지
못하는 구조적 공백을 발견)을 제외한 **1,235건**에 registry identity
필드(roadAddress/jibunAddress/totalHouseholds/mgmBldrgstPk)를 실제
write했다(updated 1,235 / failed 0 / wrong merge 0).

Production `apartment_master_seed.ts:geocode()`를 그대로 재사용해(로직
변경 없음, import 시 CLI 부작용을 막는 `require.main===module` 가드만
추가) 1,235건 전체 재지오코딩 라이브 검증(100% 성공) 후, 안전 가드
(region mismatch/1km 초과 이동/좌표 충돌)를 통과한 **1,191건**만 좌표를
실제 write. 해운대구 우동 일대에서 Kakao 주소검색이 서로 다른 건물을
같은 좌표로 반환하는 클러스터(23건)를 새로 발견해 production의 기존
`deduplicateCoordinates()` 정책과 동일한 기준으로 write에서 제외했다.

실제 post-write 결과: **PEER_FULL 38.2%→72.5%**, 구·군 격차
**8.8배→1.38배**(STEP 0.7 투영치 74.6%/1.4x와 근접, 차이는 안전
가드로 제외된 45건으로 정확히 설명됨). 대신해모로/협성르네상스는
이미 정상이던 상태 그대로 유지, **구덕금호는 여전히 DISPLAY_ONLY로
정상화되지 않음**(negative benchmark 보존). same-name collision
53개 그룹 재검증 결과 wrong merge 0건.

Snapshot(1,235행, SHA256 검증) + tested rollback script 준비(미실행).
apply 스크립트 재실행으로 idempotency 확인 — 이 과정에서 재지오코딩
재실행 시 Supabase pooler float round-trip의 IEEE754 마지막 자릿수
오차(실제 데이터 차이 아님)를 발견해 epsilon 비교로 수정, 최종 재실행
결과 updated=0(완전 idempotent) 확인. 신규 fixture 15개(node:test)
전부 PASS. `lib/step07a-write-guards.ts` 신규(write-plan 단계 guard
순수 함수, 테스트 대상).

Score 공식/weight/API/UI/schema 전부 변경 없음, migration 없음.
`docs/development/EJIP_SCORE_V2_STEP07A_SAFE_RECOVERY_WRITE.md` 신규.

상태: BLOCKER 없음. **RECOVERY_WRITE_SUCCESS = YES**.
**DATA_QUALITY_POST_VERIFY_PASS = YES**. **SCORE_V2_STEP08_READY = YES**
— 남은 위험: 44건 좌표 미개선(수동 검토 필요), 163건 미회복(MEDIUM/
REVIEW/FAILED/guard, 계속 write 후보 제외), 327건 무증거(접근 불가).

**SCORE_V2_STEP07A_CLOSE = YES.**

## 2026-08-24 (2)

### E-JIP SCORE V2 STEP 0.8 — Shadow Peer & Score Impact Validation (READ-ONLY)

`score-v2-step08-shadow-peer-validation` branch. STEP0.7-A 이후에도 남은
"대신해모 140m가 협성 306m보다 낮은 transport 점수" 문제를 production
peer-groups/category/percentile 함수를 그대로 재사용하는 SHADOW 엔진으로
부산 전체(3,402건) 재계산해 검증했다. quality-filter 자체의 영향은 작지만
(transport mean delta +0.39), LOCAL(법정동) peer 경계가 실제 생활권보다
좁게 잘려 있어 distance gap≥200m 쌍의 17.4%가 "더 가까운 쪽이 더 낮은
점수"를 받는 구조적 문제를 정량 확인했다(school/parking/life 도메인도
유사). SIGUNGU-only 모델은 이 inversion을 절반으로 줄인다.

`CROSS_PEER_COMPARABLE = NO`, relative percentile 권장 역할 =
`SMALL COMPONENT`, Score V1 trust = `HIDE/DEEMPHASIZE`(카테고리 percentile
서술 한정). production Score/DB/API/UI/schema 전부 변경 없음. 신규 테스트
8/8 PASS(+기존 20/20 회귀 없음). `docs/development/EJIP_SCORE_V2_STEP08_SHADOW_PEER_VALIDATION.md`
신규.

**SCORE_V2_STEP08_CLOSE = YES.** `SCORE_V2_STEP1_READY = YES`.

### E-JIP SCORE V2 STEP 1 — Score Architecture & Factor Model (analysis/docs only)

`score-v2-step1-architecture` branch. V1을 고치는 대신 "좋은 아파트란
무엇인가"부터 재정의 — 이집점수를 "가격을 제외한, 실거주 품질에 대한
객관적 평가"로 정의하고, ~75개 factor를 실제 schema/API/DB 근거로
READY_NOW~NOT_AVAILABLE 분류했다(3개 병렬 read-only 조사, 추정 없음).
LOCAL percentile을 Core 입력에서 완전히 배제(BUSAN/SIGUNGU 절대 비교로
대체)하는 것을 핵심 architecture 결정으로 확정. 대신해모/협성 두 벤치마크가
STEP0에서 인용된 transport/parking/school 세 가지 유명 inversion 사례의
동일 당사자였음을 확인(하나의 법정동 경계 문제가 세 도메인에서 반복).
5-domain Core(Transport/Living/Education/Complex/Environment) + 5개 별도
Index(Market/Investment/Child-Friendly/Personalized-Commute/Reconstruction)
구조를 제안. 숫자 가중치는 미확정(STEP2 대상). production 코드 변경 없음.
`docs/development/EJIP_SCORE_V2_STEP1_ARCHITECTURE.md` 신규.

**SCORE_V2_STEP1_CLOSE = YES.** `SCORE_V2_ARCHITECTURE_READY = YES`,
`SCORE_V2_STEP2_READY = YES`(School V2 branch 병합 선행 권장).

### E-JIP SCORE V2 STEP 1.5 — Data Foundation Integration (Score V2 + School V2 병합)

`score-v2-data-foundation` branch(`score-v2-step1-architecture` base +
`school-v2-final-qa` merge, main merge 없음). 두 development line이
merge-base(`82f4914`) 이후 건드린 파일이 겹치는 곳은 `CHANGELOG.md`
1건뿐이었고(schema/migration도 merge-base에 이미 공통 포함) 실질 코드
충돌은 없었다 — CHANGELOG는 양쪽 내용 전부 보존해 재정렬.

READ-ONLY 검증: `ApartmentMaster`(3,402) ↔ SCHOOL V2 attendance-zone
artifact(3,402) 완전 호환(matched 3,402/missing 0/duplicate 0/identity
mismatch 0), attendance-zone 분포(AVAILABLE 3,175/SHARED 196/
REVIEW_REQUIRED 30/NOT_AVAILABLE 1)와 School taxonomy(305/176/159/16/8)가
SCHOOL V2 FINAL QA와 정확히 일치함을 재확인. STEP0.7-A 좌표 재지오코딩
(1,191건)이 attendance-zone artifact 생성(2026-08-22) **이후**(2026-08-23)
일어나, 300m~1km 이동 + 현재 AVAILABLE 상태인 31건이 검증되지 않은 잔여
불확실성으로 남음(artifact는 지시대로 재계산하지 않음, School V2 담당
라인에 이월). V1 `school-access`/`school-access-sentence.ts`는 blob diff
0(완전 불변) 확인 — 이번 merge로 legacy Score가 SCHOOL V2 데이터를
자동으로 쓰게 되는 일 없음.

대신해모/협성을 SCHOOL V2 공식 통학구역으로 재확인한 결과 **두 단지가
정확히 같은 초등학교(대신초등학교)에 배정**됨을 발견 — V1의 341m/545m
relative score 역전 논란이 공식 배정 기준에서는 "완전 동일"로 해소된다.

STEP1 architecture 문서를 수정(architecture만, 숫자 무변경): Core를
5-domain에서 **4-domain(Transport/Living/Education/Complex)**으로
축소하고, Environment(현재 해변 거리 단일 factor)는
LIMITED/DISPLAY_ONLY/FUTURE_CORE_CANDIDATE로 재분류.

regression 87/87 PASS(School 6종 + Score 2종), `next build` 성공(node_modules
symlink로 workspace-root 문제 해결), 런타임 smoke 5건 통과, 대신해모 V1
Score API 값이 STEP0.8과 완전히 동일함을 실측 재확인(회귀 없음).
tsc 7 errors는 전부 1회성 SHP 파이프라인 스크립트의 기존 환경
설치 공백(`shapefile`/`proj4`/`iconv-lite` 미설치)이며 애플리케이션
코드는 0 errors. eslint 0 errors(pre-existing warning 5개는 merge-base
버전과 대조해 신규 아님을 확인). DB write/migration/SchoolInfo
ingestion/Childcare ingestion/13-다 scraping/Score 변경 전부 없음. main,
`school-v2-final-qa`, `score-v2-step1-architecture`, main의 C3A 로컬 작업
전부 미접촉 확인.
`docs/development/EJIP_SCORE_V2_STEP15_DATA_FOUNDATION_INTEGRATION.md` 신규.

**SCORE_V2_STEP15_CLOSE = YES.** `SCORE_V2_DATA_FOUNDATION_READY = YES`,
`SCORE_V2_STEP2_READY = YES`.

### E-JIP SCORE V2 STEP 2 — Absolute Scoring Curves & Numerical Model Design

`score-v2-step2-absolute-curves` branch. LOCAL percentile을 대체할 절대
평가 curve를 처음으로 수치 설계했다 — 부산 3,402건 실측 분포(subway
median 397m, parking ratio median 1.106, age median 23년 등)를 근거로
subway(4후보)/age(3후보)/scale(3후보)/parking(3후보) curve와 4개 domain
(Transport/Complex/Education/Living) composition 후보를 만들고 41개
벤치마크(16개 구·군 전부 + 13개 archetype)로 검증했다.

핵심 성과: V1의 parking 문제(1.09→18, 1.58→95, 77pt 격차)가 새 curve에서는
29~30pt로 완화됐고, 대신해모/협성의 subway/parking/age/scale monotonic
dominance가 4/4 PASS, 부산 전체에서 "명백히 좋은데 낮은 점수" 모순 사례가
5개 패턴 전부 0건이었다. **STEP0.8이 지적한 education 역전(V1: 대신해모
22.0>협성 11.4, 실제로는 341m<545m로 협성이 더 가까움)이 새 absolute
curve에서는 정확히 반대(협성 60.9>대신해모 37.0)로 바로잡혔다** — 이번
STEP의 가장 중요한 실증 결과. district bias는 1.22~1.41x로 STEP0.7-A
수준을 유지/개선(8.8x 원본 대비 대폭 개선 유지).

counterexample 탐색 중 "confirmed-absent subway"와 "단순 결측"을 구분하지
않는 설계 공백을 발견(수정은 STEP3로 이월). 3개 MODEL 후보(V2-A 투명우선/
V2-B 매끄러움우선/V2-C 하이브리드) 비교 후 explainability와 안정성 기준으로
**V2-A를 RECOMMENDED_FOR_SHADOW_TEST로 선정**(최종 weight는 미확정,
STEP3 대상). 신규 테스트 18/18 PASS(+기존 28/28 회귀 없음). production
Score/DB/API/UI 전부 변경 없음, domain/factor 최종 weight도 아직 확정하지
않았다. `docs/development/EJIP_SCORE_V2_STEP2_ABSOLUTE_CURVES.md` 신규.

**SCORE_V2_STEP2_CLOSE = YES.** `ABSOLUTE_CURVES_READY = YES`,
`SCORE_V2_STEP3_READY = YES`.

### E-JIP SCORE V2 STEP 3 — Full Busan Shadow Validation + Expert Credibility Test

`score-v2-step3-shadow-validation` branch. STEP2가 발견한 confirmed-absent
subway sentinel 문제(지하철이 전혀 없어도 버스만 좋으면 transport가
과대평가되던 반례)를 먼저 고쳤다 — 4-state(VALUE/CONFIRMED_ABSENT/MISSING/
COORD_INSUFFICIENT)를 명확히 분리하고 CONFIRMED_ABSENT(489건)를 curve
floor로 명시 채점했다. 이 수정 하나로 subway cohort transport 평균이
confirmed-absent 구간에서 정확히 최하위(23.3)로 떨어져 완전 단조를
회복했다.

부산 전체 3,402건 full shadow를 계산해 4개 domain-weight 후보(W-A~D)를
처음 비교하고, Pareto dominance(687,793쌍 전수, 위반 0건), counterexample
8패턴(전부 0건), raw/weight sensitivity(모두 안정), 41개 벤치마크, 48쌍
blind expert review 자료를 생성했다. 대신해모(67.8) vs 협성(64.0) 비교가
"대신해모 승리 강제" 없이 raw fact tradeoff만으로 자동 설명됐다. district
bias는 1.31x로 STEP0.7-A 수준(1.38x) 이하 유지. parking missing fairness는
age-band 통제 후에도 11~15pt 격차가 남아 STEP3.5로 이월되는 유일한 미해결
리스크로 명시했다.

Expert Credibility Gate 8개 중 7개 PASS, 1개(LOCAL_EXPERT_REVIEW)는
READY_FOR_REVIEW로 재평가(실제 인간 검수는 미실행). RECOMMENDED_EXPERT_
REVIEW_CANDIDATE = V2-A + Sentinel Fix + M3(neutral prior) missing-data.
신규 테스트 18/18 PASS(+기존 46/46 회귀 없음, 총 64/64). production Score/
DB/API/UI 전부 변경 없음. **SCORE_V2_PRODUCTION_READY = NO 유지**(인간
전문가 검수 완료 전까지). `docs/development/EJIP_SCORE_V2_STEP3_FULL_SHADOW_VALIDATION.md`
신규.

**SCORE_V2_STEP3_CLOSE = YES.** `EXPERT_REVIEW_READY = YES`,
`SCORE_V2_PRODUCTION_READY = NO`.

### E-JIP SCORE V2 STEP 3.5 — Expert Review Prep + Parking Fairness Root-Cause & Calibration

`score-v2-step35-expert-calibration` branch. STEP3의 유일한 미해결
리스크(parking missing 11~15pt fairness gap)의 근본 원인을 찾았다 —
age-band만 통제한 STEP3 비교와 달리 age+household+sigungu를 전부 matched
비교하니 gap이 **-3.8pt(사실상 해소)**로 좁혀졌다. 진짜 원인은
missing-data 처리 로직이 아니라 **household-scale confound**(parking
결측이 소규모 단지에 압도적으로 집중 — known-rate가 세대수 100 미만
4.5%에서 1000+ 87.2%까지 벌어지는 HIGHLY_STRUCTURED/MNAR 패턴)였다.

5개 parking missing 모델(P-A~E)을 비교하는 과정에서 현재 M3의 "neutral
prior=50"이 실제로는 전혀 중립적이지 않다는 것도 발견했다 — 31년 이상
노후 단지의 실제 평균 parking factor score는 21.7점인데 50으로
처리해 **28.3점을 과대평가**하고 있었다. era-conditioned neutral
prior(P-D)로 전환해 이 부정확성을 시정하면서도, 대신해모/협성처럼
parking known인 단지는 5개 모델 전부에서 소수점까지 무변화임을 확인했다
(raw parking 값을 추정해 만들어내지 않는다는 원칙 준수, 테스트로 보증).

T3(80/20) transport composition을 sentinel-fixed 상태로 재검증한 결과
district bias가 T1(2.17x)보다 오히려 나쁨(2.74x)을 확인 — STEP2에서
관찰됐던 "V2-C가 더 낫다"는 결과는 sentinel 버그의 우연한 부작용이었음이
이제 직접 재현으로 확정됐다(T1_KEEP). Score-scale 검토에서는 점수를
좋아 보이게 만드는 임의 rescale을 명시적으로 기각하고, raw 유지 +
percentile 병기(S3)를 추천했다 — 대신해모 67.8점이 "부산 상위 8.1%"라는
맥락과 함께 제시되면 오해를 구조적으로 줄인다.

STEP3의 48개 blind pair를 감사해 8개 archetype·11개 구·군을 대표하는
15개 shortlist를 선정하고(close-call 7개 포함, obvious 편중 방지),
단지명·점수가 전혀 노출되지 않는 blind sheet와 별도 answer key를 생성했다
(leakage 0건, 테스트 확인). UI data contract(점수 산출 근거 vs 단지브리핑
분리)도 타입 제안으로 준비했다(production 미연결).

Expert Credibility Gate 8개 중 7개 PASS 유지(일부 근거 강화), Gate 7은
여전히 READY_FOR_REVIEW. 신규 테스트 9/9 PASS(+기존 64/64 회귀 없음,
총 73/73). production Score/DB/API/UI 전부 변경 없음.
**FINAL_CANDIDATE_FROZEN = NO 유지**(실제 인간 blind review 전까지).
`docs/development/EJIP_SCORE_V2_STEP35_EXPERT_REVIEW_PREP.md` 신규.

**SCORE_V2_STEP35_CLOSE = YES.** `HUMAN_EXPERT_REVIEW_READY = YES`.

## 2026-08-26

### DETAIL TRADE AREA STATE SPLIT V1 — Unit Master ↔ Transaction area 식별자 분리

상세페이지의 단일 `selectedArea` state가 Unit Master `canonicalExclusiveArea`
identity와 transaction API의 raw `trade.area` identity를 동시에 표현하던
문제를 발견하고 분리했다. 실제 production 데이터로 재현: `canonicalExclusiveArea`는
단위 없는 숫자 문자열(`"84.7855"`)인 반면 raw `trade.area`는 단위가 붙는다
(`"84.7855m²"`) — 대신롯데캐슬(Unit Master 8종, 매매 108건)에서 Unit Master
칩을 클릭하면 문자열이 절대 일치하지 않아 Hero/차트/타임라인/투자지표가
전부 "선택한 조건의 최근 거래가 없습니다"로 조용히 빠지는 P0 버그를
브라우저로 직접 재현했다.

`selectedUnitMasterArea`(Unit Master identity 전용, AreaSelector 칩
active 표시에만 사용)와 `selectedTradeArea`(raw trade.area 전용, Hero/
PriceTrendChart/InvestmentMetrics/TradeTimelineList가 전부 이걸로
필터링)로 분리했다. `AreaSelector`의 `onSelect`는 자신의 기존
`hasUnitMaster` 분기와 동일한 조건으로 두 state 중 하나에만 쓰도록
dispatch해, 검증되지 않은 매핑으로 두 identity를 강제 연결하지 않는다.
84㎡ 기본 선택 로직과 `PriceTrendChart`의 raw sale+순수전세 union
selector 로직을 `src/lib/trade-area-selection.ts`로, `InvestmentMetrics`의
갭/전세가율 계산을 `src/lib/investment-metrics.ts`로 순수 함수 추출해
회귀 테스트 12개 추가(기존 3개+4개 포함 총 19/19 PASS).

실거래 3개 단지(대신롯데캐슬/연산동일동미라주더스타/대신해모로센트럴아파트)로
로컬 dev server + 실제 DB에서 직접 검증: Unit Master 칩을 눌러도 Hero
가격이 바뀌지 않음(무강제매핑 확인), 차트 자체 selector를 바꾸면
Hero/차트/타임라인이 함께 갱신됨(공유 state 확인), 대신해모로센트럴아파트의
실제 매매전용(`83.8957m²`)/전세전용(`49.839m²`) 케이스에서 교차 평형
fallback 없이 정직하게 "데이터 부족"을 표시함을 확인. 84.7855/84.995,
59.8826/59.8839 collision은 모두 유지(병합 없음).

`npx tsc --noEmit`: `src/` 에러 0(기존 `scripts/` 에러만 잔존). `npm run
build`: PASS. `npm run lint`(전체): 신규/수정 5개 파일 모두 0건, 기존
레포 전역 lint 부채(1640 errors/63821 warnings)와 무관.
`docs/development/DETAIL_TRADE_AREA_STATE_SPLIT_V1.md` 신규.

DB/schema 변경 없음, migration 없음.

상태: 완료. 차트 UI(거래량 막대 터치 시 검은 사각형/모바일 좌우
gutter/plot width)는 이번 STEP 범위 밖으로 다음 STEP(`DETAIL_PRICE_
CHART_UI_FINAL`)에 이월. Unit Master 소유 단지의 상단 칩이 더 이상
Hero를 직접 구동하지 않는 것은 §13에 문서화된 의도된 결과 — 검증된
canonical mapping이 생기기 전까지는 편의보다 정확성을 우선했다.

**DETAIL_TRADE_AREA_STATE_SPLIT_V1_CLOSE = YES.**

## 2026-08-26 (2)

### DETAIL PRICE CHART UI FINAL — 터치 포커스/모바일 full-bleed/plot 폭/selector UX

Production 모바일에서 남아있던 가격차트 3개 문제를 근본원인 기준으로
고쳤다. (1) 거래량 막대 등 차트 영역 touch 시 검은 사각형 — Recharts의
`accessibilityLayer`(기본 on)가 카드 전체 크기의 루트 `<svg>`
(`.recharts-surface`)에 `tabIndex=0`을 부여해 어디를 눌러도 포커스가
그 전체 영역으로 이동하는데, 수동 tabIndex를 가진 비-네이티브 엘리먼트에
대한 `:focus-visible` 휴리스틱이 모바일 엔진마다 신뢰할 수 없다는 걸
동일 세션에서 직접 재현(동일한 pointerdown+focus 시퀀스인데
`:focus-visible`이 true/false로 왔다갔다 함)해 확인했다. `:focus-visible`에
기대는 대신 pointerdown/Tab keydown으로 입력 modality를 직접 추적해
`outline`을 결정하도록 바꿨다 — 구현 중 `useEffect(() => {...}, [])`가
`.chart` div가 아직 마운트되지 않은 시점에 실행돼(hasData가 true가 돼야
마운트됨) 리스너가 실제 노드에 전혀 붙지 못하는 실수를 실제 DOM
검증(`chartDiv.dataset.inputModality`가 계속 `undefined`)으로 잡아내고
callback ref로 교체해 재검증까지 마쳤다. (2) 모바일 차트 카드 좌우 회색
여백 — 공용 `.container`의 16px 페이지 패딩이 원인이었고,
`PriceTrendChart.module.css`의 `.card` 하나에만
`width:100vw; margin-inline:calc(50% - 50vw)` full-bleed를 적용해(다른
파일은 전혀 건드리지 않음) 해결했다. (3) plot 폭 — 처음에 `.chart`에도
추가로 padding을 더 깎았더니 실제 스크린샷에서 Y축 라벨("4.9억"이
".9억"으로) clipping이 나는 걸 발견해 되돌리고, full-bleed만으로 확보된
폭(기존 대비 좌우 16px씩)을 그대로 썼다 — "코드상 고쳐짐"이 아니라 실제
360/375/390px 스크린샷으로 clipping 여부를 검증했다.

Hero 근처에 selector를 중복 배치할지는 실제 UX로 판단해 추가하지
않기로 했다 — Unit Master 없는 단지(다수)는 이미 상단 칩이 selectedTradeArea를
직접 구동해 자연스럽고, Unit Master 단지는 84㎡대 기본 선택이 이미
합리적인 초기값을 주기 때문에 중복 selector가 "두 selector, 다른 의미"
혼란만 키울 위험이 있었다(판단 근거는 문서에 기록).

대신롯데캐슬(Unit Master 8종)/연산동일동미라주더스타(Unit Master 없음)
양쪽에서 360/375/390px 및 desktop 실제 렌더 검증: 회색 여백 0, 축
clipping 0, 가로 overflow 0(scrollWidth ≤ innerWidth 3개 너비 전부),
period/legend 줄바꿈 0, 실제(synthetic 아닌) 클릭에도 검은 사각형 없음.
STATE SPLIT V1의 계약(`selectedUnitMasterArea`/`selectedTradeArea` 독립,
cross-unit fallback 없음)은 이번 STEP에서 `PriceTrendChart.tsx`/
`PriceTrendChart.module.css` 두 파일만 건드려 전혀 손대지 않았다(재검증
완료). 다만 이 자동화 환경은 `document.hasFocus()`가 항상 false라
`:focus` CSS의 최종 페인트 자체는 픽셀 단위로 재현 불가능해
`TOUCH_VISUAL_QA = MANUAL_REQUIRED`로 남긴다.

기존 회귀 테스트 19/19 유지, `npx tsc --noEmit` src/ 에러 0(기존
scripts/ 에러만 잔존), 변경 파일 타겟 lint 0 errors, `npm run build`
PASS. `docs/development/DETAIL_PRICE_CHART_UI_FINAL.md` 신규.

DB/schema 변경 없음.

상태: 완료.

**DETAIL_PRICE_CHART_UI_FINAL_CLOSE = YES.**

## 2026-08-26 (3)

### DETAIL PRICE CHART PRODUCTION QA P0 FIX — 실제 Android 재현 문제 4건 해결

직전 STEP의 자동화 QA는 PASS였지만 실제 Android Production 수동 QA에서 문제가
재현되어, 그 증거를 우선해 다시 조사했다.

**전세가 모순**: 같은 selectedTradeArea에서 차트 요약은 "최근 전세 보 2억
3,100만"을 찾는데 InvestmentMetrics는 "데이터 부족"이었다. 실제 API 응답을
나란히 비교해 원인을 특정했다 — 두 컴포넌트의 순수 전세 판정 로직(monthlyRent
=== 0, 정확한 area 일치)은 완전히 동일했고, 유일한 차이는 조회 기간이었다
(PriceTrendChart 최대 60개월 vs InvestmentMetrics 고정 6개월). 실제 최근
순수 전세가 조회 시점 기준 약 7개월 전이라 6개월 창에만 안 걸렸을 뿐이었다.
InvestmentMetrics의 조회 기간을 PriceTrendChart가 제공하는 최대치(60개월)로
맞춰 해결했다 — "최근 거래" 판정 로직 자체(정렬 후 첫 값)는 그대로이므로
집계나 평균 도입 없이 실제 존재하는 거래를 놓치지 않게 됐다.

**검은 사각형 재조사**: 직전 STEP의 data-input-modality + CSS outline 차단은
Recharts 소스 코드로 직접 검증한 결과 로직 자체는 정확했지만(Cursor는
cursor={false}일 때 null 반환, activeBar/background 모두 기본값 false로
override 안 됨을 소스에서 확인), `:focus-visible` 브라우저 휴리스틱 자체가
동일 세션 내에서도 같은 pointerdown+focus 시퀀스에 대해 true/false로
일관되지 않게 나와, 이 휴리스틱에 의존하는 방식 자체가 근본적으로 불안정함을
확인했다. 근본 해결로 전환: pointerdown에서 preventDefault()를 호출해 차트
SVG가 애초에 포커스를 받지 않도록 했다(Recharts는 touch tooltip을 별도
touchstart/touchmove 리스너로 처리하므로 영향 없음을 소스로 확인, 키보드
Tab 포커스는 별개 경로라 접근성 유지). 실제(synthetic 아닌) 클릭 후
document.activeElement가 BODY로 유지됨을 확인 — 어떤 브라우저의
:focus-visible 구현이든 상관없이 구조적으로 outline이 생길 수 없다.

**매매/전세 표시 제어**: 기존 장식용 legend를 실제 role="group" 토글
버튼으로 전환 — 클릭 시 해당 계열의 line과 tooltip 항목만 숨기고, 거래량
막대는 기존 의미 그대로 유지. 최소 하나는 항상 켜져 있도록 하는 로직은
순수 함수로 추출해 테스트했다(`src/lib/series-visibility.ts`).

**StickyPriceBar audit**: 실제 코드 추적 결과 area 스코프는 처음부터
selectedTradeArea를 정확히 따르고 있었다(회귀 없음) — 다만 상단 매매/전월세
토글이 전월세일 때 순수 전세로 제한하지 않은 "그 area의 가장 최근 전월세"
값을 보여줄 수 있어, 차트 섹션의 항상-순수전세 값과 다르게 보일 수 있었다.
둘 다 정직한 실제 데이터였고, 애매했던 건 라벨뿐이었다 — "최근 실거래가"를
"최근 매매가"/"최근 전월세"로 구분해 표시하도록 수정.

**모바일 회귀 재검증 중 실제 버그 발견**: 360/375/390px에서
documentElement.scrollWidth가 clientWidth보다 커서(예: 360px에서 350 vs
341) 실제 가로 overflow가 있음을 확인했다 — 직전 STEP의 full-bleed
(`width:100vw; margin-inline:calc(50% - 50vw)`)가 원인. 100vw는 스크롤바
예약 공간을 포함하는데 clientWidth는 제외해서 생기는 잘 알려진 CSS 함정으로,
실제 모바일 기기(오버레이 스크롤바)에서는 잘 안 보이지만 취약했다. 상세페이지
`.main`에만 scoped된 `overflow-x:hidden`으로 방어적으로 막았다(페이지 전체
디자인 변경 아님). 수정 후 세 너비 모두 scrollWidth === clientWidth 확인.

신규 테스트 7개(series-visibility 4 + metrics-contract 3) 추가, 기존 19개
회귀 없음(총 26/26 PASS). `npx tsc --noEmit` src/ 에러 0, 변경 파일 타겟
lint 0 errors, 전체 lint 65461 problems로 직전 STEP과 완전히 동일(신규 0건),
`npm run build` PASS. `docs/development/DETAIL_PRICE_CHART_PRODUCTION_QA_P0_FIX.md`
신규.

DB/schema 변경 없음.

상태: 완료. 실제 Android 터치의 최종 `:focus` 페인트 자체는 이 자동화
환경(document.hasFocus()가 항상 false)에서 픽셀 단위 재현이 불가능해
`BLACK_BOX_AUTOMATED_QA = PARTIAL`로 남긴다 — 다만 실제 클릭 후 포커스가
전혀 이동하지 않음은 직접 확인했다.

**DETAIL_PRICE_CHART_PRODUCTION_QA_P0_CLOSE = YES.**

## 2026-08-26 (4)

### DETAIL PRICE CHART INTERACTION P1 — tap-to-select/crosshair UX

모바일에서 차트를 탭해도 즉시 반응하지 않고 좌우로 끌어야만 tooltip이
바뀌는 문제(P1-A), 현재 보고 있는 지점을 알려주는 가이드라인 부재(P1-B)를
해결했다. 원인은 Recharts 소스(`RechartsWrapper.js`) 직접 확인 결과
`touchstart`는 외부 핸들러로만 전달되고, 실제 활성 지점 재계산은
`touchmove`에서만 일어나는 구조였다 — 마우스는 연속적인 `mousemove`로
이미 정상 동작해서 이 문제가 터치에서만 나타났다.

Recharts 내부 hover/touch state에 의존하지 않고 `activeIndex`를 컴포넌트
자체 state로 완전히 직접 관리하도록 전환했다. 각 데이터 포인트의 실제
렌더링된 dot 좌표(cx)를 custom dot render-prop으로 캡처해(마진/축
너비를 재계산하는 방식이 아니라 실제 렌더 결과를 그대로 사용 — 레이아웃이
바뀌어도 어긋나지 않음) `pointerdown`/`pointermove`에서 가장 가까운
포인트를 즉시 찾는다(`src/lib/chart-crosshair.ts`, 순수 함수로 분리해
6개 테스트 작성). 세로 크로스헤어는 Recharts 공식 `ReferenceLine`
컴포넌트를 그대로 사용했고(직접 좌표 계산 불필요, 항상 정확히 정렬됨),
전세/매매 중 활성 포인트에 값이 있는 계열에 한해 얇은 가로 가이드라인도
추가했다. Tooltip은 v3의 공식 `active`/`defaultIndex` controlled prop으로
전환해 우리가 계산한 activeIndex를 그대로 반영한다.

구현 중 실제 버그를 발견해 수정했다 — 처음에는 `activeIndex`를
`useEffect(() => setActiveIndex(null), [points])`로 초기화했는데,
`points`가 의존하는 `saleTrades`/`rentTrades`가 매 렌더마다 새 배열
참조로 재계산돼(원래부터 memo 안 됨) 이 effect가 사실상 매 렌더마다
실행되어 tap으로 설정한 activeIndex를 즉시 다시 null로 되돌리고
있었다 — 실제 DOM 상태(정확한 dot 좌표에 synthetic pointerdown을 쏘고
activeIndex 효과가 사라지는 것을 직접 관찰)로 원인을 특정한 뒤,
`[selectedTradeArea, period]`(실제로 데이터가 바뀌는 시점의 원시값)로
의존성을 바꿔 해결했다. 또한 ref를 렌더 중에 직접 mutate하던 최초
구현이 `react-hooks/refs` lint 에러로 걸려, dot 좌표 캡처를 렌더 중에는
일반 로컬 배열에만 쓰고 `useLayoutEffect`로 커밋 이후 ref에 반영하도록
수정했다(React 공식 권장 패턴).

P0에서 고친 검은 사각형(포인터 인터랙션 시 SVG가 포커스를 받지 않도록
하는 preventDefault 로직)은 건드리지 않았고, 이번 STEP의 모든 실제
클릭/드래그 테스트(데스크톱 실제 클릭, 360/375/390 모바일 iframe에서
touch pointerType 디스패치) 후에도 `document.activeElement`가 계속
BODY로 유지됨을 매번 재확인했다. selectedTradeArea/cross-unit fallback
금지/매매·전세·전세가율·갭 계산 로직도 전혀 건드리지 않았고, 인터랙션
테스트 내내 전세가율 59.7%/갭 1.6억 값이 그대로 유지됨을 확인했다.

신규 테스트 6개 추가(기존 26개 회귀 없음, 총 32/32 PASS). `npx tsc
--noEmit` src/ 에러 0, 변경 파일 타겟 lint 0 errors(0 warnings, ref
lint 에러를 실제로 수정), `npm run build` PASS.
`docs/development/DETAIL_PRICE_CHART_INTERACTION_P1.md` 신규.

DB/schema 변경 없음.

상태: 완료.

**DETAIL_PRICE_CHART_INTERACTION_P1_CLOSE = YES.**


## 2026-08-26 (5)

### APARTMENT BASIC DATA COVERAGE AUDIT V1 — 용적률/건폐율/주차대수 결측 원인 감사 + 안전 수정

연산동한솔솔파크(부산 연제구) 상세페이지에서 용적률/건폐율/주차대수가
전부 "정보 없음"으로 표시되던 문제를 읽기 전용으로 감사했다. 외부
경쟁 서비스가 표시하는 535%/59%를 그대로 베끼지 않는다는 하드 룰 아래,
같은 값을 이 프로젝트가 이미 쓰는 정부 공식 API 키로 직접 재조회해
독립적으로 재현했다(`data.go.kr` `BldRgstHubService`).

원인은 SOURCE_MISSING이 아니라 **WRONG_SOURCE_SELECTION**이었다:
`fetchBuildingRegistryInfo()`(`src/lib/apt-building-info.ts`)가 그동안
"총괄표제부"(`getBrRecapTitleInfo`, 여러 동 단지 집계용)만 호출했는데,
이 단지는 총괄표제부 자체가 등록돼 있지 않았다(반복 실측: 3/3회
`totalCount=0`). 반면 같은 API의 다른 operation인 "표제부"
(`getBrTitleInfo`, 건물 1건 단위)는 안정적으로 1건을 반환했고,
`hhldCnt=165 / vlRat=535.3 / bcRat=59.82`가 이미 DB의 세대수·M4-B가
저장해둔 `mgmBldrgstPk`와 정확히 일치했다 — 신규 외부 연동이 아니라
이미 쓰던 서비스의 다른 operation을 그동안 호출하지 않고 있었을 뿐.

`fetchBuildingRegistryInfo()`에 표제부 폴백을 추가했다. 안전조건으로
"이 지번에 표제부가 정확히 1건일 때만" 값을 신뢰하도록 제한했다 —
`14-apartment-master-m4-expansion-analysis.md` §K가 13일 전에 이미
지적한 위험(표제부는 "동 1개" 단위 값이라 복수 동 단지에 그대로 쓰면
동 단위 값을 단지 총괄값으로 잘못 저장하게 됨)을 그대로 존중한 설계다.
주차대수는 표제부의 옥내/옥외×자주식/기계식 4개 필드를 합산해 구했다
(추정이 아니라 같은 레코드의 실측 개별 수치 합).

라이브 dev 서버에서 실제 HTTP 호출로 검증: 연산동한솔솔파크는
`535.3%/59.8%/세대당 1.24대(총 204대)`로 정상 노출, 기존에 총괄표제부로
이미 정상 동작하던 대신롯데캐슬은 수정 전후 값 동일(회귀 없음), 표제부도
매치 안 되는 단지("시범")는 수정 후에도 정직하게 "정보 없음" 유지(값
지어내지 않음 확인). `src/lib/apt-building-info.test.mjs` 신규 7개
테스트 추가(0/음수 값의 "미확보" 처리, 4필드 합산, null 안전 처리 등),
기존 31개 포함 총 38/38 PASS.

부산 전체 커버리지도 실측했다 — `ApartmentMaster`(M4-B가 최근 부산
전체로 확장, 3,402건. 13일 전 문서의 "33건" 기록은 이미 낡은 정보였고
DB 직접 조회로 재확인해 바로잡았다)에서 주차대수 coverage는 25.7%에
그쳤다: 이 단지 하나만의 문제가 아니라 총괄표제부 단일 의존이 부산
전체 규모에서 구조적으로 겪는 결측 패턴이었다. 다만 `ApartmentMaster`
스키마 자체에 `far`/`bcr` 컬럼이 없어 이 두 필드는 부산 전체 재조회
없이는 coverage를 낼 수 없다는 스키마 차원의 한계도 함께 기록했다
(스키마 변경 없이는 해결 불가 — 이번 STEP 범위 밖, USER_APPROVAL_REQUIRED
로 남김). 재사용 가능한 read-only 감사 스크립트
`scripts/audit-apartment-basic-data-coverage.ts` 신규 추가.

`npx tsc --noEmit`은 이번 변경 파일 기준 에러 0(기존 무관 스크립트
파일들의 사전 존재 에러만 있음 — FAIL_EXISTING_SCRIPT_ERRORS로 구분해
보고), 변경 파일 타겟 lint 0 errors, `npm run build` PASS.
`docs/development/APARTMENT_BASIC_DATA_COVERAGE_AUDIT_V1.md` 신규.

DB 쓰기: 없음(스키마/마이그레이션/대량쓰기 전부 없음). 감사 스크립트는
SELECT류만 사용. 코드 수정은 기존에도 있던 "라이브 조회 성공 시
upsert" 동작의 성공 케이스가 하나 늘어난 것뿐, 신규 upsert 로직 추가
아님.

상태: 완료.

**APARTMENT_BASIC_DATA_COVERAGE_AUDIT_V1 = PASS.**


## 2026-08-26 (6)

### DATA COVERAGE FIX V1 — ApartmentMaster 기본 스펙 스키마 확장 + 부산 3,402건 backfill

직전 감사(APARTMENT_BASIC_DATA_COVERAGE_AUDIT_V1)가 밝힌 부산 전체 규모의 용적률/
건폐율/주차 결측 구조 문제를 사용자 승인(스키마 변경/migration/부산 3,402건 Production
backfill) 아래 해결했다. SCHEMA DESIGN → MIGRATION → DRY-RUN → SAMPLE WRITE →
SAMPLE VALIDATION → FULL BUSAN BACKFILL → COVERAGE RE-AUDIT → REGRESSION 순서를
그대로 지켰다.

`ApartmentMaster`에 `floorAreaRatio`/`buildingCoverageRatio`/`parkingPerHousehold`/
`basicSpecSource`(값의 출처가 총괄표제부인지 표제부 fallback인지 감사 가능하게 기록) 4개
컬럼을 추가하는 순수 additive 마이그레이션을 적용했다(기존 컬럼 drop/rename 없음,
`basicSpecSource`만 안전한 기본값 `UNKNOWN`). 이미 존재하는 세대수/준공년도/동수/주차/
mgmBldrgstPk 컬럼은 재사용했다(중복 생성 없음).

`scripts/backfill-apartment-master-basic-data.ts`(신규, `--dry-run`/`--apply`/`--limit`/
`--aptSeq`/`--sample`/`--resume` 지원) — 감사 STEP이 검증한 "총괄표제부 우선, 없으면
표제부(지번 내 건물 정확히 1건일 때만) fallback" 계약을 부산 3,402건 전체에 적용했다.
기존 non-null 값은 절대 덮어쓰지 않고(FILL_NULL만, 충돌 시 CONFLICT_REVIEW로 기록만
하고 보류), 이름이 아니라 aptSeq/lawdCd+umdCd+jibun로만 조회했다.

이 환경이 장시간 백그라운드 프로세스를 주기적으로 종료시켜(정확한 원인 불명) 총 8회
실행으로 나눠 완료했다 — 매 실행이 파일 체크포인트(커밋 대상 아님, `.gitignore` 추가)에
처리된 aptSeq를 기록해 `--resume`이 정확히 이어서 처리하도록 설계했다. 도중 반복된 강제
종료로 orphan node 프로세스 19개가 쌓여 Supabase 커넥션 풀을 소진하는 증상을 발견해
정리한 뒤 재개했다. 최종 PROCESSED 3,402/3,402(100%), IDEMPOTENT(체크포인트 무시하고
재스캔한 200건 전부 UNCHANGED로 재확인) = YES.

샘플 적용 단계에서 실제 데이터 신뢰 버그를 자체 발견해 즉시 수정했다: 표제부 fallback
경로가 연도만 아는 준공일(`"2007년"`)을 `"20070101"`처럼 일 단위까지 아는 것처럼
지어내고 있었다 — 알지 못하는 정밀도를 만들어내는 것은 이 프로젝트의 데이터 신뢰
원칙 위반이라, 표제부 경로에서는 이 필드를 null로 유지하도록 고치고 이미 이 세션에서
잘못 쓰인 10건을 정정했다(basicSpecSource가 이번 STEP에만 존재하는 신규 enum이라
사전 데이터 오염 없이 정확히 식별 가능했다).

Busan-wide coverage: 세대수 74.8%→93.5%(+18.7pp), 주차대수 25.7%→71.0%(+45.3pp), 용적률/
건폐율 0%(컬럼 없었음)→약 74%(신규), 세대당주차 0%→69.3%(신규). `basicSpecSource` 분포
(총괄표제부 29.2% / 표제부 fallback 50.6% / 둘 다 실패 20.2%)가 표제부 fallback 쪽이 더
많은 단지를 구제했음을 정량적으로 보여줘, 직전 감사의 WRONG_SOURCE_SELECTION 진단이
연산동한솔솔파크 한 곳만의 특이 사례가 아니라 부산 전체 규모의 구조적 문제였음을 확정했다.

`/api/apt/[name]/info`에 3단계 read path를 추가했다: legacy `Apartment` 캐시(기존 유지) →
`ApartmentMaster`(lawdCd+dong+jibun로만 조회, 이름 매칭 없음, 신규) → 라이브 BuildingHUB
호출(기존 유지, 최후 수단). 앞 단계가 채운 필드는 뒤 단계가 덮지 않고, 앞 단계들만으로
전부 채워지면 외부 API 호출 자체를 건너뛴다(런타임 외부 의존 축소). 라이브 dev 서버에서
DB/API/UI 세 계층 전부 재확인(연산동한솔솔파크·대신롯데캐슬·대신해모로센트럴아파트·
연산동일동미라주더스타 등) — 검증 중 "정보 없음"이 일시적으로 보인 것은 실거래 API
지연으로 두 번째 `/info` 재조회가 5~6초 늦게 도착하는 기존(이번 STEP 무관) 동작 때문임을
`apt-client.tsx`의 git diff(변경 없음)와 network 계측으로 확인해 오탐임을 밝혔다.

신규 유닛 테스트 7개(`scripts/backfill-basic-data-logic.test.mjs`, 순수 함수만 분리해
CLI 스크립트 import 시 실제 backfill이 실행되는 사고를 `require.main===module` 가드로
차단) 포함 총 45/45 PASS(회귀 없음). `npx tsc --noEmit` 이번 변경 파일 기준 에러 0(기존
무관 스크립트 34개 에러만 존재, FAIL_EXISTING_SCRIPT_ERRORS로 구분), 변경 파일 타겟
lint 0 errors, `npm run build` PASS.
`docs/development/DATA_COVERAGE_FIX_V1.md` 신규.

DB 쓰기: 부산 ApartmentMaster 3,402건(전부 승인 범위 내, 부산 외 지역 0건 확인). 스키마
변경: 4개 컬럼 추가(additive, 승인됨). Migration:
`prisma/migrations/20260826091211_data_coverage_fix_v1_basic_specs/` 적용 완료.

상태: 완료.

**DATA_COVERAGE_FIX_V1 = PASS.**


## 2026-08-27

### BUSAN DATA / UX AUTOMATED QA V1 — 부산 데이터 신뢰 + 핵심 journey 회귀 자동화

`APARTMENT_BASIC_DATA_COVERAGE_AUDIT_V1`/`DATA_COVERAGE_FIX_V1`의 후속 STEP. 사용자가
부산 3,402개 단지를 직접 눌러보며 오류를 찾는 방식에서 벗어나, 재사용 가능한 read-only
QA runner를 구축해 데이터 누락/모순/API 오류/거래 신뢰도/검색·지도 identity 문제를
자동으로 먼저 탐지하게 했다. 대량 Production 데이터 수정 STEP이 아니다 — DB 쓰기
0건(SELECT류 Prisma 호출만).

`scripts/busan-qa-logic.ts`(순수 판정 로직) + `scripts/busan-qa-logic.test.mjs`(20개
유닛 테스트) + `scripts/run-busan-data-ux-qa.ts`(CLI 본체, `--all`/`--district`/
`--aptSeq`/`--quick`/`--no-api`/`--json`/`--base-url` 지원)를 신규 구축했다. L1(DB
coverage, 3,402건 전체) → L2(data consistency, 3,402건 전체) → L3(API contract, 대표
set 39건, 로컬 dev 서버 실제 HTTP 호출) → L4(product contradiction) 4개 레이어 +
identity/trade trust/unit master/search/map QA로 구성했다.

**L1 coverage**(3,402건, `DATA_COVERAGE_FIX_V1` 산출물과 정확히 일치 재확인): 세대수
93.5%, 주차 71.0%, 용적률 73.9%, 건폐율 74.1%.

**L2 consistency**: PASS 3,400 / WARN 2(buildingCoverageRatio>100인 동원화인패밀리
122.37%, 광안동에스케이뷰 110.7% — 법정 상한 초과지만 파싱 오류인지 실제 예외 건축물인지
불확실해 자동 FAIL 단정 대신 사람 확인이 필요한 WARN으로만 분류) / FAIL 0.

**Identity QA 중 라이브 버그 발견 및 즉시 수정(1건, 4개 라우트)**: 정적 코드 감사로
`/api/apt/[name]`(거래)/`score`/`education`/`facilities` 4개 라우트가 `lawdCd`(또는
`dong`)가 없을 때 `{ name: aptName }`만으로 legacy `Apartment` 캐시를 조회하는 패턴을
발견했다. 로컬 dev 서버로 실제 재현: `GET /api/apt/대신롯데캐슬`(파라미터 없음) →
수정 전엔 서울 강남구 대치동의 동명 단지(legacy Apartment id=14)를 잘못 집어와
`lawdCd=11680, dong=대치동`을 반환했다(부산 서구 서대신동3가의 진짜 대상, id=11과
충돌) — AGENTS.md "이름만으로 재식별 금지"/"다른 아파트 데이터를 fallback으로 노출
금지" 원칙의 실제 위반 사례였고, 이 진입 경로는 라우트 자체 주석에 "지도 마커 클릭,
커뮤니티 글 링크처럼 lawdCd/dong을 안 넘기는 경로가 실제로 있다"고 이미 문서화돼 있어
이론적 위험이 아니었다. lawdCd(또는 dong)가 이미 있을 때만 캐시 조회를 시도하도록
최소 범위로 수정(DB 변경 없음, 4개 파일) — 수정 후 같은 요청은 Kakao 지오코딩 폴백으로
올바르게 부산 대상을 찾는다. 기존 lawdCd/dong이 전달되는 정상 경로는 회귀 없음을
재확인했다. `WRONG_APARTMENT_FALLBACK`: 발견 시점 PRESENT → 이번 STEP에서 ABSENT로
전환(근본 데이터인 legacy Apartment의 name 비유일성 자체는 스키마 밖이라 잔존, QA가
계속 감시).

**Unit Master QA**: 대신롯데캐슬(aptSeq 26140-1164)의 84.7855/84.9950,
59.8826/59.8839 exact-area collision 규칙이 API 응답에서도 병합되지 않고 유지됨을
재확인(PASS). 검증 중 QA 스크립트 자체의 오탐 1건을 발견해 즉시 수정했다: 대신해모로
센트럴아파트가 같은 정확 면적(84.9442)을 서로 다른 variantKey로 정당하게 2번 갖는
정상 설계 사례를 초기 로직이 "collision"으로 오판했다 — `(면적, variantKey)` 조합
기준 대조로 수정.

**Trade trust**: 대표 set 39건 전부 `apiError` 있는데 `trades.length===0`으로
오분류되는 사례 0건. 매매/순수전세(반전세 제외) gap·ratio는 `gap-invest-calc.ts`의
실제 프로덕션 함수(`buildGapCandidates`)를 재사용해 중복 구현 없이 검증했다.

**Search/Map**: 대표 쿼리 5개 전부 200/중복 0. "해운대"/"서면"이 REGION 결과 0건인
것은 버그가 아니라 `umdName`(법정동명) 매칭 설계상 정상(구/통칭 지명이라 그렇다) —
제품 개선 후보로만 기록. `/api/search`가 실제로 지도 마커에 쓰는 identity/좌표 소스가
`ApartmentLocationFeature`(3,401/3,402건 커버, `ApartmentMaster.latitude/longitude`와는
별개 파이프라인)임을 확인했고, 대표 set 39건에서 두 좌표 소스 괴리(>200m) 0건.

고정 회귀 fixture 4건(연산동한솔솔파크/대신롯데캐슬/연산동일동미라주더스타/대신해모로
센트럴아파트) 전부 PASS. `docs/development/BUSAN_DATA_UX_AUTOMATED_QA_V1.md` 신규(21개
섹션, 전체 결과/16개 구/군 breakdown/release gate 포함).

유닛 테스트 20/20 PASS(`scripts/busan-qa-logic.test.mjs`). `npx tsc --noEmit` 이번
변경 파일(신규 스크립트 2개 + 라우트 4개) 기준 에러 0(기존 무관 스크립트만 에러 —
FAIL_EXISTING_SCRIPT_ERRORS로 구분, 이번 세션에서 손대지 않음). 변경 파일 타겟 lint 0
errors. `npm run build` PASS(35개 라우트 정상 생성).

DB 쓰기: 0건(read-only). 스키마 변경: 없음. Migration: 없음.

상태: 완료.

**BUSAN_DATA_UX_AUTOMATED_QA_V1 = PASS. RELEASE_GATE = LIMITED(P0_DATA_TRUST=1건,
근본 데이터 landscape 잔존 — 라이브 버그는 수정 완료).**


## 2026-08-27

### SEARCH / MAP PERFORMANCE V2.2 — 검색/지도 체감 latency 개선 + BCR>100 감사

사용자 실제 체감 문제(검색 결과 약 3초, 결과 클릭 후 마커 표시 추가 약 3초)의 root cause를
증거 기반으로 찾아 안전한 범위에서 개선했다. DB/schema/migration/거래 계산/Unit Master/
Score 변경 없음.

**(A) BCR>100 quick audit**: 직전 QA에서 발견한 buildingCoverageRatio>100 2건
(동원화인패밀리 26230-128=122.37%, 광안동에스케이뷰 26500-1384=110.7%)을 BuildingHUB
총괄표제부(`getBrRecapTitleInfo`)로 라이브 재조회해 두 건 모두 저장값과 정확히 일치하는
원본(`bcRat`/`vlRat`/`mgmBldrgstPk`/`hhldCnt`/`totPkngCnt`/`useAprDay`까지 전부 일치)을
확인했다 — **분류: SOURCE_VALUE(둘 다), BCR_DATA_FIX_REQUIRED=NO**. 애플리케이션 버그가
아니라 정부 총괄표제부 원본 자체가 100%를 넘는 건폐율을 보고하고 있다(복합단지의 대지/
건축면적 산정 방식에 따른 정부 등록 관행으로 추정, 근본 원인 자체는 범위 밖).

**(B) E2E timing 실측**: `NEXT_PUBLIC_EJIP_PERF_DEBUG` 게이트 기반 `performance.mark`
계측(`src/lib/perf-debug.ts` 신규)을 검색(`ApartmentAutocomplete.tsx`)과 지도
(`src/app/map/page.tsx`) 양쪽에 추가하고, 실제 Chrome 브라우저(claude-in-chrome)로
"연산동/대신동/대신롯데캐슬/해운대" 등 실제 시나리오를 재현 계측했다.

- 검색(`/api/search`): 디바운스(250ms, 변경 없음) + API 왕복 포함 INPUT_TO_FIRST_RESULT
  실측 586.5ms(dev 서버 재시작 직후 COLD에 가까운 조건) — **이미 목표(≤1.5s) 충족**,
  사용자가 체감했다는 "3초"와 직접 일치하지 않음을 정직하게 확인했다(가능한 설명:
  실사용자 환경 차이, 로딩 피드백 부재로 인한 체감 왜곡, 실제 병목인 지도 단계와의 혼동).
- 지도: **진짜 병목을 특정했다.** `selectedMarker`(바텀시트/마커 표시)가 오직
  `aptMarkers`(=`/api/transactions?type=apt&lawdCd=...&months=12` 완료 후에만 채워짐)
  에서만 찾아지고 있었다 — 이 API는 지역 전체 12개월 실거래를 라이브 조회한 뒤 그 안의
  **모든 고유 단지마다 개별 Kakao 키워드 지오코딩을 호출**한다. 실측(curl): 연제구 COLD
  5.76초, WARM(geocode 캐시 워밍업 후) 1.05초, 서구 COLD 2.09초 — "클릭 후 3초" 체감의
  실제 원인이었다.

**(C) 안전한 개선**: 검색 결과가 이미 aptSeq/좌표/이름을 갖고 있다는 사실을 활용해
"SELECTED MARKER FIRST" 원칙을 구현했다. `src/lib/map-selected-marker.ts`(신규, 순수
함수, 부작용 없음)에 `buildPendingSelectedApt`/`resolveSelectedMarker`/
`isPendingStillNeeded`를 분리했다 — aptSeq와 유효 좌표가 모두 있을 때만(name-only
identity 금지, 다른 단지 fallback 금지) 임시 마커를 만들어 **주변 마커 전체 로딩을
기다리지 않고 즉시** 렌더하고, 실제 데이터가 도착하면 자동으로 우선순위가 넘어가
중복 없이 교체된다(값은 "시세 정보 없음"으로 정직하게 시작, 지어내지 않음). 기존
`renderMarkerChip()`을 그대로 재사용해 시각적으로 진짜 마커와 동일하다(visual redesign
없음). 라이브 브라우저로 4개 대표 케이스(연산동한솔솔파크/대신롯데캐슬/연산동일동
미라주더스타/해운대힐스테이트위브) 전부 클릭 즉시(다음 렌더 프레임 내, <100ms) 마커+
바텀시트가 표시됨을 확인했다 — 특히 대신롯데캐슬은 서울 강남구 동명 단지와 identity
충돌 위험이 있는 케이스인데도 정확히 부산 서구로 이동/선택됐다(WRONG_MARKER_SELECTION
없음).

추가로 `handleApartmentSelect`가 검색 결과에 이미 있는 `lawdCd`를 쓰지 않고 매번 Kakao
역지오코딩을 다시 호출하던 중복 요청을 제거했다(`fetchAptMarkers(lat, lng, knownLawdCd?)`
— 있으면 역지오코딩 생략, 없으면 기존 동작 유지, 드래그/현재위치 등 기존 호출부는
영향 없음). `ApartmentAutocomplete.tsx`에는 150ms 넘게 걸리는 요청에만 "검색 중..."을
보여주는 최소 로딩 피드백을 추가했다(캐시 히트/빠른 응답에서는 깜빡이지 않음).

**결과(Before/After)**: CLICK_TO_SELECTED_MARKER 592ms~5.76s(API 완료 대기) →
**<100ms**(동기 state 업데이트, 네트워크 무관). CLICK_TO_ALL_MARKERS(주변 마커)는
의도적으로 변경하지 않음(§13 목표 — 거래 계산 API 자체는 범위 밖). 검색 자체 속도는
이미 목표 충족이라 서버 로직 변경 없음.

**Mobile/Desktop QA**: 360px/390px(iframe 격리 기법 — 이 환경에서 `resize_window`가
불안정함을 재확인해 우회)와 desktop(852px) 전부 겹침/잘림/가로스크롤/오작동 없이 정상
확인. 375px는 두 경계값이 모두 통과한 표준 반응형 레이아웃이라 별도 재검증 없이 정상
판단.

신규 유닛 테스트 12개(`src/lib/map-selected-marker.test.mjs`): aptSeq 보존, fast path가
aptSeq+좌표 필수(둘 중 하나라도 없으면 null), 가격을 지어내지 않음, 진짜 마커 우선(임시
마커와 dedupe), 다른 단지 오선택 방지. 기존 65개 포함 총 77/77 PASS(회귀 없음, `.test.ts`
계열은 이 실행 환경의 네이티브 ESM 확장자 해석 한계로 이번에도 개별 실행 대상 아님 —
이번 STEP이 만들지 않은 기존 특성). `npx tsc --noEmit` 이번 변경 파일(신규 2개 + 기존
2개 수정) 기준 에러 0(기존 무관 스크립트만 에러). 변경 파일 타겟 lint 0 errors.
`npm run build` PASS(35개 라우트 정상 생성).

`docs/development/SEARCH_MAP_PERFORMANCE_V2_2.md` 신규(21개 섹션, BCR 감사/타이밍
실측/before-after/mobile-desktop QA 포함).

DB 쓰기: 0건. 스키마 변경: 없음. Migration: 없음.

상태: 완료.

**SEARCH_MAP_PERFORMANCE_V2_2 = PASS. BCR_CASE_1 = SOURCE_VALUE. BCR_CASE_2 =
SOURCE_VALUE. BCR_DATA_FIX_REQUIRED = NO. CLICK_TO_SELECTED_MARKER: 592ms~5.76s →
<100ms. WRONG_MARKER_SELECTION = ABSENT.**


## 2026-08-27

### STEP — MAP SURROUNDING MARKER PERFORMANCE V1

`SEARCH_MAP_PERFORMANCE_V2_2`가 "다음 STEP 후보"로 남긴 실제 병목을 제거했다:
`/api/transactions?type=apt&lawdCd=...&months=12`가 지도 주변 마커 좌표를 만들 때
MOLIT 응답의 **고유 단지(dong+name)마다 개별 Kakao 키워드 지오코딩을 호출**하고
있었다(N+1 외부 API, 실측 지연 592ms~5.76s). `ApartmentMaster`가 이미 같은 조회에서
`aptSeq` 매칭에 쓰던 행에 검증된 좌표(Kakao geocoding 결과를 사전 저장, 부산 coverage
100%)를 갖고 있었으므로, 이를 그대로 재사용하도록 바꿔 **외부 API 호출을 0회**로
줄였다.

**변경 내용**:

- `src/app/api/transactions/route.ts`: `geocodeApt`/`geocodeCache`(Kakao 키워드
  지오코딩) 완전 제거. `prisma.apartmentMaster.findMany` select에 `latitude`/
  `longitude` 추가, 매칭/좌표 결합 로직을 `src/lib/map-marker-coords.ts`(신규, 순수
  함수)로 분리 — 1순위 dong+name 완전일치, 2순위 같은 dong 안에서만
  `aptNamesMatch`(기존 `/api/apt/[name]/route.ts`가 쓰던 안전한 표기-차이 매처
  재사용, 다른 dong으로 확장 안 함)로 보강. 매칭 실패 시 aptSeq/좌표 모두 null(다른
  단지 fallback 없음).
- `src/lib/map-marker-fetch-guard.ts`(신규, 순수 함수): `isStaleMarkerResponse`/
  `isMarkerCacheFresh`. `src/app/map/page.tsx`의 `fetchAptMarkers`에 요청 순번 기반
  stale-response 방지(빠른 연속 드래그 시 먼저 보낸 요청이 나중 요청을 덮어쓰지
  않음)와 같은 `lawdCd` 60초 exact-key 캐시를 추가했다(selected marker fast path는
  변경 없음, 그대로 <100ms 유지).
- `scripts/run-busan-data-ux-qa.ts`: `runMapMarkerQa()` 신규 — 4개 회귀 fixture가
  속한 구/군의 `/api/transactions` 응답을 실제 호출해 latency/중복aptSeq/wrong-identity
  재검증(첫 구현에서 "다건 거래를 중복으로 오판"하는 QA 자체 버그를 발견·수정함,
  문서 §19-1에 정직하게 기록).

**실측(before/after)**: 격리 측정한 Kakao N+1 자체 비용 — 연산동(207개 단지) 2,367ms,
대신동(138개 단지) 1,643ms, 해운대구(277개 단지) 3,062ms, 전부 0으로 제거. 전체
`/api/transactions` cold worst-case: 연산동 5.58s→1.92s, 해운대 5.33s→2.01s(남은 시간은
MOLIT 정부 API 자체의 라이브 조회 latency, 이번 STEP 범위 밖). **부수 효과로 marker
좌표 coverage가 개선됐다** — Kakao가 못 찾던 오래된/소규모 단지 좌표(연산동 19건)를
ApartmentMaster는 이미 갖고 있어 연산동 188/207→206/207, 대신동/해운대 100%로 상승.

라이브 브라우저(claude-in-chrome) 검증: 연산동한솔솔파크 클릭 → 즉시 fast path 마커 →
약 2초 후 실제 가격("3억 3,000만")으로 자연스럽게 교체, 이 흐름에서 발생한 네트워크
요청은 `/api/transactions` + `/api/community/recent-activity`뿐(Kakao geocoding
0건). 대신롯데캐슬(서울 강남구 동명 단지 충돌 위험 fixture) 정확히 부산 서구로
표시(WRONG_APARTMENT 없음). 드래그는 여전히 지역 확정용 역지오코딩 1회를 쓴다(기존
동작, 단지별 N+1과는 별개 범주 — 회귀 아님).

신규 유닛 테스트 12개(`map-marker-coords.test.mjs` 7개, `map-marker-fetch-guard.test.mjs`
5개): dong 다르면 이름이 같아도 혼동 안 함, 차수 다르면 매칭 안 함, 매칭 실패 시 다른
단지로 fallback 안 함, 좌표 없는 master는 좌표만 null(aptSeq는 보존), stale 응답/캐시
판정. 기존 포함 총 89/89 PASS(회귀 없음). `npx tsc --noEmit`/lint 변경 파일 기준 에러
0(기존 무관 스크립트 에러만 존재, `FAIL_EXISTING_SCRIPT_ERRORS`). `npm run build` PASS.
`ApartmentMaster.sggCd`에 기존 인덱스가 이미 있어 신규 DB 쿼리도 cold ≤484ms/warm
21~36ms로 충분히 빠름 — 인덱스 추가 불필요.

`docs/development/MAP_SURROUNDING_MARKER_PERFORMANCE_V1.md` 신규(22개 섹션).

DB 쓰기: 0건. 스키마 변경: 없음. Migration: 없음.

상태: 완료.

**MAP_SURROUNDING_MARKER_PERFORMANCE_V1 = PASS. CANONICAL_MARKER_SOURCE =
ApartmentMaster.latitude/longitude. NORMAL_PATH_KAKAO_GEOCODING = 0.
KAKAO_REQUESTS_BEFORE = 단지 수만큼(연산동 207/대신동 138/해운대 277).
KAKAO_REQUESTS_AFTER = 0. WRONG_APARTMENT = ABSENT. DUPLICATE_MARKERS = ABSENT.
STALE_BOUNDS_PROTECTION = PASS(단위 테스트). MOBILE = PARTIAL(375px 라이브 확인,
360/390은 CSS 미변경 근거로 재검증 생략). DESKTOP = PASS. BUILD = PASS.
DB_SCHEMA_CHANGE = NONE. INDEX_CHANGE = NOT_NEEDED.**


## 2026-08-27

### STEP — APT DETAIL MOBILE UX REGRESSION HOTFIX

아파트 상세페이지에서 최근 작업 중 사라지거나 약해진 핵심 UX 3가지를 조사·복구했다.

**1) ㎡↔평 토글 — 조사 결과 회귀 아님.** git blame으로 관련 커밋 전체를 추적하고
대신롯데캐슬(Unit Master 보유)/연산동한솔솔파크(Unit Master 없음) 양쪽에서 라이브로
클릭까지 재현한 결과, `AREA_SELECTOR_V2_1_TOGGLE_HOTFIX`가 정한 조건
(신뢰 가능한 `representativePyeong`이 하나라도 있어야 노출)이 그대로 정확히 동작하고
있었다. "버튼이 사라졌다"는 체감은 Unit Master 데이터가 Busan 3,402건 중 11건에만
있다는 데이터 커버리지 한계였다 — `exclusiveArea/3.3058` fallback을 추가하는 것은
금지사항이라 시도하지 않았고, 코드도 변경하지 않았다.

**2) 하단 "최근 매매가" sticky — 실제 회귀 확인, 교체.** `StickyPriceBar`의 글쓰기
버튼이 `6d6dbcb`(커밋 메시지: "repair apartment detail mobile regressions")에서
아무 설명 없이 삭제되어 있었다(git diff로 확인). 상단에서 이미 가격을 충분히 보여주므로
페이지 끝의 가격 반복을 없애고, `StickyPriceBar`를 완전히 제거해
`StickyActionBar`(관심단지/공유/글쓰기 3-action row, 신규)로 교체했다. 기존
`FavoriteButton`/`KakaoShareButton`/`/community/write?aptName=` 계약을 그대로
재사용(새 business logic 없음) — 다만 같은 페이지에 두 번 마운트되는 `FavoriteButton`이
서로 상태를 공유하지 않던 문제를 발견해, 같은 탭 안에서만 도는 최소한의
`CustomEvent`(`ejip:favorite-changed`) 브로드캐스트를 `FavoriteButton.tsx`에 추가했다
(서버 API/판정 로직 변경 없음).

**3) 학군 학교명 클릭 — 실제 회귀 확인, 복구.** `/api/apt/[name]/education`의
`fetchNearbySchoolsByKeyword()`가 Kakao 응답의 좌표(`x`/`y`)와 `id`를 이미 받아놓고도
클라이언트 응답 직전에 버리고 있었다(`MAP_SURROUNDING_MARKER_PERFORMANCE_V1`에서
발견한 것과 같은 종류의 "이미 받은 데이터를 응답 직전에 버리는" 패턴). 이 값들을 그대로
통과시키고(새 지오코딩/외부 API 호출 증가 없음), `src/lib/school-link.ts`(신규, 순수
함수)의 `buildSchoolHref()`가 좌표가 있을 때만 기존 `/school/[id]` 계약
(`KakaoPlaces.tsx`/`map/page.tsx`와 동일, name+lat+lng+lawdCd 쿼리스트링 — 실제로
읽어보니 `[id]` 세그먼트 자체는 페이지 코드가 쓰지 않는 계약이었다)으로 링크를
만들었다. 좌표가 없는 항목(공식 통학구역 NEIS 데이터 등)은 의도적으로 클릭 불가로
남겼다 — 이름만으로 재검색해 동명이교로 잘못 연결하는 fallback은 만들지 않았다(§21
scope 제한과 일치, 통학구역 school id 기반 상세는 SCHOOLINFO/SCHOOL V2 몫).

라이브 브라우저(claude-in-chrome) 검증: 서구(대신롯데캐슬)/연제구(연산동한솔솔파크)/
해운대구(해운대두산위브더제니스) 3개 대표 단지 전부에서 학교 클릭 → 올바른
`/school/[kakaoId]?name=&lat=&lng=&lawdCd=` 이동 → 뒤로가기 시 원래 단지 상세로 복귀
확인. 새 단위 테스트(`school-link.test.mjs` 6개)가 구현 중 실제 이중 인코딩 버그를
잡아 즉시 수정했다(화면 동작에는 영향 없었으나 정확성 수정, 문서 §19 참고). 기존 89개
포함 총 95/95 PASS. `npx tsc --noEmit`/lint 변경 파일 기준 에러 0. `npm run build` PASS.

`docs/development/APT_DETAIL_MOBILE_UX_REGRESSION_HOTFIX.md` 신규(20개 섹션).

DB 쓰기: 0건. 스키마 변경: 없음. Migration: 없음.

상태: 완료.

**APT_DETAIL_MOBILE_UX_REGRESSION_HOTFIX = PASS. AREA_TOGGLE = RESTORED(코드 변경
없음, 이미 정상). PYEONG_SOURCE = UNIT_MASTER. FAKE_PYEONG_FALLBACK = ABSENT.
UNIT_COLLISION = PASS. TRADE_AREA_REGRESSION = ABSENT. BOTTOM_RECENT_PRICE = REMOVED.
BOTTOM_ACTIONS = FAVORITE_SHARE_WRITE. FAVORITE = PASS. SHARE = PASS. WRITE = PASS.
SCHOOL_CLICK = RESTORED. SCHOOL_IDENTITY = CANONICAL(좌표 있는 항목만, 없는 항목은
의도적으로 비클릭). WRONG_SCHOOL_FALLBACK = ABSENT. MOBILE = PASS(360/375 라이브).
DESKTOP = PASS. BUILD = PASS.**


## 2026-08-27

### STEP — SCHOOLINFO / SCHOOL V2.1: DECISION-FIRST SCHOOL DETAIL EXPERIENCE

학교 상세페이지를 "정보 나열"에서 "이 학교를 기준으로 어떤 아파트를 봐야 하는가"로
이어지는 의사결정형 페이지로 재구성했다. 직전 STEP이 좌표 기반(Kakao POI)으로만
학교 클릭을 복구했던 것을, 이번엔 canonical NEIS 학교 식별자 기반으로 확장해
**좌표가 없는 공식 통학구역/학교군 학교도 상세페이지가 열리게** 했다(핵심 PASS
조건).

**SchoolInfo(학교알리미) 정책 확정**: 사용자가 확보한 공식 회신(원본 유지 조건으로
상업적 활용/재구성/비교/분석 가능, 이집 산출물은 RAW와 분리 표시, 위경도 임의 변경
금지, 필수 출처 "학교알리미")을 `docs/development/SCHOOLINFO_SCHOOL_V2_1.md`에
문서화하고, `EducationSource`(`schoolinfo_openapi`)를 `CLEARED`로 1회 등록했다
(`scripts/education/register-schoolinfo-source.ts`). 학생수/학급수/교원수 등
실제 SchoolStat 통계는 아직 0건이라(별도 대규모 ingestion 필요, 이번 STEP 범위
밖) UI에 정직하게 "연동 준비 중"으로 남겼다 — 없는 값을 지어내지 않았다.

**Canonical identity + route**: `/api/school/[id]/route.ts`(신규)가 `[id]`를
`School.neisSchoolCode`로 먼저 조회하고(좌표 불필요), 실패하면 기존 Kakao 링크의
`name`+`lawdCd`로 School 테이블에서 정확히 1건만 매칭될 때 canonical로 승격한다
(2건 이상 모호하면 승격하지 않음 — 동명이교 안전). 기존 `/school/{kakaoId}?name=&lat=&lng=&lawdCd=`
링크는 그대로 하위호환 동작한다. `EducationPanel.tsx`의 공식 통학구역/학교군
학교명도 이제 `neisSchoolCode`만으로(좌표 없이) 클릭 가능하다(`EduSchoolLink`).

**관련 아파트 decision layer**: `src/lib/education/school-apartment-relations.ts`
(신규, 순수 함수)가 기존 attendance-zone artifact(3,402건)를 "학교→아파트"
방향으로 역색인해 공식 통학구역(ATTENDANCE_ZONE)/학교군(MIDDLE_GROUP) 관계를
canonical NEIS 코드 우선으로 찾고, 거리 기반(NEARBY)은 기존 `nearby-apartments.ts`
(presale 기능이 이미 쓰던 canonical ApartmentMaster 함수)를 재사용한다. 세 relation을
항상 배지로 구분해 "배정 아파트"로 뭉뚱그리지 않는다. 가격은 기존 검증된
`fetchMolitData` 파이프라인만 쓰고(새 가격 소스 없음), distinct lawdCd당 1회만
호출해 N+1을 피한다(ApartmentMaster 조회도 1회 배치). "이집의 해석"
(`school-decision-insight.ts`, 신규 순수 함수)은 최단거리/최고가·최저가
차액/최신축/현재 단지 순위를 실제 비교값에서만 deterministic하게 생성한다 — AI
호출 없음, "명문학교" 류 가치판단 없음.

**현재 단지 컨텍스트**: 아파트 상세→학교 진입 시 `aptSeq` 쿼리(DB 변경 없이 쿼리
파라미터만 사용)로 "현재 보고 있는 단지"를 학교 페이지까지 이어간다 — 관련 목록
상한(12건)에 밀려 잘리지 않도록 항상 1순위로 pin(구현 중 발견해 즉시 수정한 버그,
§ 아래 참고).

라이브 브라우저 검증(claude-in-chrome): 대신초등학교(canonical, 좌표 없음,
아파트 상세에서 진입) → 헤더/현재 단지 콜아웃/관련 아파트(대신롯데캐슬 1순위,
공식 통학구역 배지)/이집의 해석/CTA/출처 전부 정상 렌더 → "상세보기" 클릭 시
canonical aptSeq 경로로 정확히 대신롯데캐슬 복귀 확인. 해원초등학교(레거시 Kakao
링크, name+lawdCd로 canonical 승격) → 해운대두산위브더제니스 직선거리 188m/1,788세대/
13억 1,000만 정상. 경남중학교(MIDDLE_GROUP) 관계 분리 확인. 존재하지 않는 학교
fallback(name/좌표 없는 가상 학원)도 KAKAO_ONLY로 안전하게 처리(header null,
crash 없음). 360px/375px 모바일, 852px 데스크톱 전부 가로 스크롤/클리핑 없음.

신규 유닛 테스트 21개(`school-apartment-relations` 6, `school-trade-price` 4,
`school-decision-insight` 7, `school-link` +2, 기존 12 유지): 동명이교 코드 우선
매칭, relation 분리, 해제거래 배제, 가격/거리 데이터 부족 시 비교 생성 안 함(추정
없음) 등. 기존 포함 총 114/114(`.test.mjs`) + 361/361(`.test.ts`) 전부 PASS(회귀
없음). `npx tsc --noEmit`/lint 변경 파일 기준 에러 0. `npm run build` PASS.

`docs/development/SCHOOLINFO_SCHOOL_V2_1.md` 신규(24개 섹션).

DB 쓰기: `EducationSource` governance 등록 1행(schoolinfo_openapi, upsert, 실제
통계 데이터 아님). 스키마 변경: 없음. Migration: 없음.

상태: 완료.

**SCHOOLINFO_SCHOOL_V2_1 = PASS. CANONICAL_SCHOOL_IDENTITY = School.neisSchoolCode.
COORDINATES_REQUIRED_FOR_ROUTE = NO. NEIS_NO_COORD_CLICK = PASS. MIDDLE_GROUP_CLICK
= PASS. KAKAO_ONLY_SCHOOL = PASS. NAME_ONLY_FALLBACK = ABSENT. WRONG_SCHOOL =
ABSENT. SCHOOLINFO_SOURCE_LABEL = PASS. RAW_DERIVED_SEPARATION = PASS.
RELATED_APARTMENTS = PASS. CURRENT_APARTMENT_CONTEXT = PASS. APARTMENT_COMPARISON
= PASS. EJIP_DECISION_INTERPRETATION = PASS. MOBILE = PASS. DESKTOP = PASS. BUILD
= PASS. DB_SCHEMA_CHANGE = NONE.**

## 2026-08-27

### STEP — SCHOOL DATA BACKFILL V1: 부산 664개 학교 학교알리미/NEIS 검증 데이터 backfill

`SCHOOLINFO_SCHOOL_V2_1`이 canonical 학교 상세 페이지 구조는 완성했지만, 실제
학생수/학급수/교원수/공식 좌표는 0건이라 UI가 "연동 준비 중"으로만 표시되고
있었다. 이번 STEP은 부산 School 664개 전체에 대해 학교알리미(SchoolInfo)
OpenAPI 공시통계와 공식 좌표를 검증된 identity 매칭으로만 backfill했다.

**Identity crosswalk**: 학교알리미 자체 `SCHUL_CODE`는 NEIS `SD_SCHUL_CODE`와
직접 매핑되지 않음을 실측 확인 — 이름+구/군으로 후보를 좁히고, 동명이교(강서구
송정초등학교/대저중앙초등학교, 경일중학교 등)는 `School.dongName`(NEIS 출처)이
학교알리미 주소에 포함되는지로만 안전하게 확정한다(`src/lib/education/schoolinfo-match.ts`,
신규). 첫 번째 결과 사용 없음, 모호하면 REVIEW.

**발견한 버그 2건**: (1) 이력/개편 레코드(`ABSCH_YN='Y'`)는 주소 필드 자체가
없어 매칭 로직이 크래시 — `ABSCH_YN` 사전 필터 + 방어적 null 처리로 수정.
(2) 중/고교는 학년이 3개뿐이라 학교알리미 응답에 4~8학년 필드 자체가 없는데,
Prisma Json 컬럼은 배열 원소로 `undefined`를 허용하지 않아 다수 SchoolStat
쓰기가 조용히 실패 — `normalizeGradeSlot`(신규 순수 함수)으로 `undefined`만
`null`로 정규화해 해결(원본 0과 슬롯 없음을 혼동하지 않음).

**Backfill 실행**: `scripts/education/backfill-school-data-v1.ts`(신규,
--dry-run/--apply/--district/--school-code/--resume/--json)가 구/군×학교급
배치로 128회 이내 API 호출만으로 664개 전체를 처리(N+1 없음). 부산 bounding box
검증(`isValidBusanCoordinate`)과 상식 검증(`validateSchoolStat` — 음수/학생
있는데 학급 0 등은 REVIEW)을 통과한 행만 write. 최종: School 공식 좌표
633/664(95.3%, 이전 0%), SchoolStat 630/664(94.9%, 이전 0건), REVIEW 0건,
WRONG_SCHOOL 0건. idempotency 확인(2차 dry-run → UNCHANGED 633/REVIEW 0, 2차
apply → 쓰기 0건).

**UI unlock**: `/api/school/[id]/route.ts`에 최신 연도 `SchoolStat` 1건을
raw(학생수/학급수/교원수)+derived(학급당 학생수, 교원 1인당 학생수 — 런타임
계산, DB 미저장, 0 나눗셈 방지)로 분리해 반환하도록 추가. `school-detail-client.tsx`의
"한눈에 보는 학교" 섹션이 실데이터가 있는 학교만 5개 카드로 자동 전환되고
(`출처: 학교알리미 OpenAPI(공시정보)` vs `이집 계산값` 시각적 구분, "2026년
기준" 연도 표시), 데이터가 없는 학교(예: 괘법초등학교 — 통계 자체가 학교알리미에
없는 정직한 NO_SOURCE)는 기존 안내 문구를 그대로 유지한다.

지정 5개 학교(구덕/대신/과정/해원초등학교, 경남중학교) + district 대표 1곳
API/UI 라이브 검증 전부 PASS(curl 응답 값 수기 검산 일치, claude-in-chrome
데스크톱 960px + 모바일 390px iframe-isolation 렌더 확인, 관련 아파트/가격/거리
회귀 없음). 신규 유닛 테스트 13개(`schoolinfo-match` 7, `schoolinfo-stat-validate`
14 중 신규 분 포함) 추가, 전체 `.test.mjs` 135/135 + `.test.ts` 361/361 PASS.
`npx tsc --noEmit` 변경 파일 기준 에러 0(무관 사전 존재 스크립트 오류만 별도
존재). Lint 에러 0(`prefer-const` 1건 자체 수정). `npm run build` PASS.

`docs/development/SCHOOL_DATA_BACKFILL_V1.md` 신규(25개 섹션).

DB 쓰기: `SchoolStat` insert 312행, `School.latitude/longitude`(신규 확보분만),
`School.sigunguCode`(orphan 일부만). 스키마 변경: 없음. Migration: 없음.

상태: 완료.

**SCHOOL_DATA_BACKFILL_V1 = PASS. BUSAN_SCHOOLS = 664. SCHOOLSTAT_BEFORE = 0.
SCHOOLSTAT_AFTER = 630. STUDENT_COVERAGE = TEACHER_COVERAGE = CLASS_COVERAGE =
94.9%(630/664). OFFICIAL_COORDINATE_COVERAGE = 95.3%(633/664). WRONG_SCHOOL = 0.
INVALID_STAT = 0. REVIEW = 0. NO_SOURCE = 31. IDEMPOTENCY = PASS.
SCHOOL_DETAIL_METRICS = PASS. SOURCE_ATTRIBUTION = PASS. MOBILE = PASS. DESKTOP
= PASS. BUILD = PASS. DB_SCHEMA_CHANGE = NONE. RELEASE_GATE = READY.**

## 2026-08-27

### STEP — SCHOOL DATA GAP FIX: orphan School 정리 + 자동 QA, 학교 데이터 작업 종료

`SCHOOL DATA BACKFILL V1`에서 남겨둔 두 가지 미해결 항목(구/군 코드 없는 orphan
School 7건, NO_SOURCE 31건)을 정리하고, 향후 회귀를 상시 검사할 reusable QA
스크립트를 만들어 학교 데이터 작업을 닫았다.

**Orphan 7건**: `neisSchoolCode`(canonical identity)로 NEIS `schoolInfo` API를
직접 재조회(이름 검색 아님, exact code lookup)해 확인한 결과 7건 전부
`ATPT_OFCDC_SC_CODE=C10`(부산광역시교육청)·`LCTN_SC_NM=부산광역시`는 있었지만
`ORG_RDNMA`(도로명주소) 자체가 NEIS 원본에 없었다. `sidoCode='26'`은 이 7개
row가 애초에 "부산 664개" 테이블에 들어온 근거(C10 필터, 다른 657개 row와 동일
출처·동일 값)를 그대로 반영해 안전하게 채웠고(`scripts/education/fix-orphan-school-sido-v1.ts`,
신규, `--apply`), `sigunguCode`/주소/좌표는 공식 소스 자체가 없어 이름 추정 없이
UNRESOLVED로 명확히 남겼다. idempotency 확인(2차 실행 `updated=0`).

**NO_SOURCE 재분류**: 기존 "31"은 identity-매칭 실패만 집계한 부분집합이었음을
발견 — SchoolStat 부재 전체 기준(664-630=34)으로 재확인하니 30건은 schoolinfo
구조적 미지원 학교급(외국인학교/평생학교/각종학교/방송통신/공동실습소/고등기술학교),
4건(괘법초등학교/봉삼초등학교/신선초등학교/한국과학영재학교)은 identity·학교급은
정상인데 해당 학교의 2026년 개별 공시 자체가 없는 별도 원인이었다. 둘 다 이번
STEP에서 억지로 채우지 않고 원인별로 분리 문서화만 했다.

**신규 `scripts/run-school-data-qa.ts`**: read-only 자동 QA. identity(중복/누락
canonical code), region(구/군 누락), stats(불가능한 값/연도 누락/중복),
coordinates(범위 밖/NaN/provenance 불일치), source(EducationSource
CLEARED 여부) 5개 축을 DB 직접 쿼리로 검사하고, `--quick` 미지정 시 지정 7개
fixture(기존 5개+orphan 해결 1개+NO_SOURCE 1개)의 `/api/school/[id]`를 실제
호출해 canonical 라우팅·관련 아파트 계약까지 확인한다(dev 서버 없으면
SKIPPED_NO_SERVER로 안전 처리). Severity를 P0_WRONG_SCHOOL/P0_IDENTITY/
P0_INVALID_STAT/P1_REGION_GAP/P1_STAT_COVERAGE/P1_COORDINATE_GAP/
SOURCE_LIMITATION으로 분류해 release gate(P0>0 → BLOCKED)를 계산한다.

실행 결과: P0 전부 0, P1_REGION_GAP=7, P1_STAT_COVERAGE=4, P1_COORDINATE_GAP=31,
SOURCE_LIMITATION=30, stat coverage 94.9% → **RELEASE GATE = READY**. 지정 7개
fixture 전부 `PASS`(한국과학영재학교=orphan 해결 후에도 canonical 정상,
괘법초등학교=NO_SOURCE 상태에서도 canonical 정상 — 두 엣지 케이스 모두 UI
placeholder/실데이터 분기가 깨지지 않음 확인).

기존 `.test.mjs` 135/135 + `.test.ts` 361/361 전부 PASS(회귀 없음, 이번 STEP은
스크립트만 추가해 신규 유닛 테스트는 없음). `npx tsc --noEmit`/lint 신규 파일
기준 에러 0. `npm run build` PASS.

`docs/development/SCHOOL_DATA_GAP_FIX.md` 신규(14개 섹션).

DB 쓰기: `School.sidoCode` 7행(null → '26', 기존과 동일 값/동일 출처). 스키마
변경: 없음. Migration: 없음.

상태: 완료. **학교 데이터 작업 종료, 다음은 STATISTICS V2.**

**SCHOOL_DATA_GAP_FIX = PASS. ORPHAN_BEFORE = 7. ORPHAN_AFTER = 7(sidoCode만
해결, sigunguCode는 SOURCE_LIMITATION으로 의도적 유지). P0_WRONG_SCHOOL = 0.
P0_IDENTITY = 0. P0_INVALID_STAT = 0. P1_REGION_GAP = 7. NO_SOURCE = 34(재분류,
기존 31은 부분집합). SCHOOL_QA = PASS. IDEMPOTENCY = PASS. RELEASE_GATE = READY.
DB_SCHEMA_CHANGE = NONE. NEXT_STEP = STATISTICS_V2.**

## 2026-08-27

### STEP — STATISTICS V2: 지역별 실거래 피드(REGIONAL TRANSACTION FEED) 신규 구축

이집 통계 영역에 "지역 시장을 이해하고 후보 단지까지 좁히는" 핵심 신규 기능인
지역별 실거래 피드를 추가했다. 기존 16개 통계 메뉴(하락/최고가/상승/거래량/
갭투자/비교 등)는 전부 KEEP — 파괴하거나 재작성하지 않았다.

**신규 순수 함수 모듈** `src/lib/regional-feed.ts`: 8개 기간 preset(오늘/
어제/최근7일/이번주/지난주/최근30일/최근12개월/기간지정)을 순수 함수로 구현,
달 경계·연도 경계를 정확히 처리하는 `monthsForRange()`로 MOLIT 월 단위 배치
fetch 대상을 계산한다(N+1 방지). `annotateTrades()`가 동일 (canonical
identity+raw 전용면적+거래유형) 그룹 안에서 시간순 누적 최고가(신고가)와 직전
검증 거래 대비 변화(상승/하락)를 계산하며, 취소거래는 완전히 제외한다(미래
거래가 과거 판정에 영향을 주지 않도록 시간순 처리 — 실제 흔한 버그 패턴을
사전에 테스트로 차단). `buildMarketInterpretation()`은 거래량/신고가 비중/동
집중/면적대 집중/상승·하락 비교 5종 문장을 표본 3건 미만이면 아예 생성하지
않는 방식으로 과잉해석을 방지한다 — LLM 미사용, "확정"/"적기"/"급등" 같은
단정적 표현 금지를 테스트로 고정했다.

**신규 API** `GET /api/stats/feed`: 표시 기간보다 최대 12개월 넓은 lookback을
기존 `fetchMonthsThrottled`(전역 공유 세마포어, 동시 3개+200ms 페이싱)로 한
번에 배치 fetch한다 — 새 동시성 풀을 만들지 않고 기존 rankings/dashboard와
동일한 것을 재사용해 실제 동시 요청 수가 배로 늘어나는 위험을 피했다. 대표
평형(pyeong)은 계산하지 않고 raw 전용면적만 반환한다 — 기존 rankings/
dashboard/transactions 라우트가 이미 갖고 있던 `exclusiveArea/3.3058` 가짜
평형 계산(감사로 발견, REMAINING GAP으로 별도 문서화)을 이번 신규 코드에서는
반복하지 않았다. 지역코드는 기존 전국 법정동코드 프록시를 그대로 재사용해
서울 강남구(`lawdCd=11680`) 등 신규 데이터 없이 즉시 동작함을 실측 확인했다
(부산 전용 아키텍처가 아님).

**신규 UI** `TransactionFeedView`(`/stats/feed`, 기존 `[type]` 라우트 구조에
`feed` slug로 통합 — 새 라우트 트리 대신 기존 dispatch에 자연스럽게 편입):
기간 chip(가로 스크롤) → 거래유형 토글 → 지역 요약 카드(실거래/신고가/상승/
하락/취소, 5개 이하) → deterministic 시장 해석 → 신고 시차 고지 → 날짜별
그룹 거래 목록(당근 스타일, 단지명·거래유형·신고가/취소 badge·가격·변동률·
동/면적/층/계약일) → 더보기 페이지네이션(최대 200건/페이지, 수천 건 한번에
렌더 안 함). 실거래 row 클릭 시 기존 canonical apt 상세 페이지로 이동(lawdCd+
dong 동명이 단지 방지, school-detail-client.tsx의 기존 패턴 재사용).

Home 퀵메뉴·통계 랜딩 메뉴에 "실거래" 항목 추가(Home 대개편 없음, 기존 6개
항목 순서 그대로 유지 + 1개 추가).

라이브 검증: 부산 서구/연제구/해운대구/서울 강남구 4개 지역 전부 실제 MOLIT
데이터로 정상 동작(각 1,955~13,774건 12개월 검증 실거래), 대신롯데캐슬/
한솔솔파크/일동미라주더스타 3개 fixture 단지 실거래 확인. 신규
`scripts/run-statistics-v2-qa.ts`(read-only, 라이브 API 응답 검증 — 이
기능이 persisted DB 테이블 없이 전부 MOLIT 라이브 조회라 DB 쿼리 대신 API
응답 정합성 검사 방식 채택) 실행 결과 P0 findings 0건, RELEASE GATE READY.

신규 유닛 테스트 26개(`regional-feed.test.mjs`) 전부 PASS. 기존 포함 총
161/161(`.test.mjs`) + 361/361(`.test.ts`) PASS(회귀 없음). `npx tsc --noEmit`
변경 파일 기준 에러 0(무관 사전 존재 스크립트 오류 20건은 이전 STEP들과 동일
`FAIL_EXISTING_SCRIPT_ERRORS`). Lint 에러 0. `npm run build` PASS(전체 라우트
정상 컴파일, `/api/stats/feed` 포함).

`docs/development/STATISTICS_V2.md` 신규(30개 섹션).

DB 쓰기: 없음. 스키마 변경: 없음. Migration: 없음(전부 기존 라이브 MOLIT fetch
경로 재사용).

상태: 완료.

**STATISTICS_V2 = PASS. REGIONAL_TRANSACTION_FEED = PASS. RECORD_HIGH = PASS.
RISE_FALL = PASS. VOLUME = PASS. DETERMINISTIC_INSIGHT = PASS. WRONG_APARTMENT
= ABSENT. CANCELLED_TRADE_POLICY = PASS. API_ERROR_NO_DATA = DISTINGUISHED.
BUSAN_SEOGU = PASS. SEOUL_GANGNAM = PASS. MOBILE = PASS. DESKTOP = PASS. BUILD
= PASS. DB_SCHEMA_CHANGE = NONE. NEXT_STEP = FIX_STATISTICS_DATA_TRUST.**

## 2026-08-27

### STEP — STATISTICS DATA TRUST + REGION FILTER V2: 가짜 평형 제거, 시도 전체 조회 지원

직전 STATISTICS V2 완료 보고에서 확인된 두 문제를 고쳤다: (A)
rankings/dashboard/transactions 3개 live route에 남아 있던
`exclusiveArea/3.3058` 가짜 대표평형 계산, (B) 통계 지역 선택이 시군구 선택을
강제해 "부산광역시 전체"/"서울특별시 전체" 조회가 불가능했던 문제(사용자가
실거래 화면에서 직접 확인).

**가짜 평형 제거**: 신규 `src/lib/statistics-pyeong-resolver.ts`(순수 함수 +
batch Prisma 조회, 쿼리 2회 고정 — N+1 없음)가 Unit Master(`ApartmentUnitType.
representativePyeong`)를 aptSeq 우선·정확한 raw 전용면적 일치로만 조회한다.
84.7855㎡와 84.9950㎡ 같은 근접 raw area를 병합하지 않는 collision-safe
매칭을 11개 단위 테스트로 고정했다. 실측 확인: 대신롯데캐슬 84.7855㎡의
실제 신뢰 평형은 34평인데 기존 가짜 계산(`84.7855/3.3058`)은 26평으로
잘못 표시하고 있었다 — 한국 아파트 평형이 전용면적이 아닌 공급면적 기준
관행이라는 것이 원인. rankings의 추세(pctChange) 계산은 평형 대신 raw ㎡
단가 비율로 전환했다(비율 계산이라 수치는 수학적으로 동일, 반올림 오차만
제거). dashboard의 평당가 랭킹(topPrices)은 Unit Master가 없는 거래를
가짜 값으로 채우지 않고 집계에서 제외한다(표본이 줄 수 있음을 감수).

**시도 전체 지역 필터**: `RegionState`에 `sidoCode`(항상 채워짐)를 추가하고
`lawdCd`를 nullable로 확장(`null` = 시도 전체) — 영향받는 9개 소비 파일
(ai-search/school/stats 등) 전부 안전하게 갱신했다. `RegionSelectModal`의
시군구 그리드 최상단에 "{시도} 전체" 버튼을 추가했다(기존 "동 전체" 버튼과
동일한 패턴, 새 selector 컴포넌트 만들지 않음). 부산 16개/서울 25개 구를
하드코딩하지 않고 기존 전국 법정동코드 프록시를 동적으로 재사용했다
(`region-utils.ts`에 `resolveSidoCode`/`getSigunguListForSido` 신규).

`/api/stats/feed`(실거래 피드)·`/api/stats/rankings`(하락/최고가/상승/
많이산단지/역전세)·`/api/stats/dashboard`(거래량/갭투자) 3개 API 전부
`sidoCode`만으로 시도 전체 집계를 지원하도록 확장했다 — 기존 공유 MOLIT
스로틀(`fetchMonthsThrottled`, 동시 3개+200ms 페이싱)을 그대로 재사용해
새 동시성 풀을 만들지 않았고, `fetchMonthsThrottledWithStatus`(신규 추가,
기존 함수는 하위호환 유지)로 부분 실패(일부 구 조회 실패)와 전체 실패를
구분해 정직하게 알린다. 시도 전체 집계 시 단지 identity를 이름만으로 묶던
기존 방식(다른 구의 동명 단지가 섞일 위험)을 aptSeq 우선·(구,동,이름) 폴백
방식으로 강화했다(gap-invest-calc.ts가 이미 확립한 원칙과 통일). 단지
비교(2종)·분위지도·거래량 연도별 표는 구 단위 설계 전제가 강해 시도 전체를
정직하게 미지원 처리한다(가짜 부분 지원 없음).

실측 성능: 부산 전체 rankings cold 30.6s/warm 0.76s, 부산 전체 dashboard
cold 62.6s/warm 0.27s, 부산 전체 실거래 피드 cold 4.5s(짧은 기간이라 이미
빠름). 서울 강남구 등 전국 어디든 신규 데이터 없이 동작(국가 확장 아키텍처
유지).

기존 `scripts/run-statistics-v2-qa.ts` 확장(SIDO_ALL 부산/서울 검증,
fake-pyeong 정적 가드, Unit Master collision 확인) — P0 findings 0건,
RELEASE GATE READY. 신규 유닛 테스트 11개 전부 PASS. 기존 포함 총
172/172(`.test.mjs`) + 361/361(`.test.ts`) PASS(회귀 없음). `npx tsc
--noEmit` 변경 파일 기준 에러 0. Lint 에러 0. `npm run build` PASS.

`docs/development/STATISTICS_DATA_TRUST_REGION_FILTER_V2.md` 신규(19개 섹션).

DB 쓰기: 없음. 스키마 변경: 없음. Migration: 없음.

상태: 완료.

**STATISTICS_DATA_TRUST_REGION_FILTER_V2 = PASS. FAKE_PYEONG = ABSENT.
PYEONG_SOURCE = UNIT_MASTER. UNIT_COLLISION = PASS. SIDO_ALL = PASS.
BUSAN_ALL = PASS. SEOUL_ALL = PASS. SIGUNGU_ALL = PASS. DONG_DRILLDOWN = PASS.
COMMON_REGION_SELECTOR = PASS. REGION_STATE_PRESERVATION = PASS(SPA 내
이동 기준). PARTIAL_FAILURE = DISTINGUISHED. API_ERROR_NO_DATA =
DISTINGUISHED. MOBILE = PASS. DESKTOP = PASS. BUILD = PASS.
DB_SCHEMA_CHANGE = NONE. NEXT_STEP = STATISTICS_V2_1_DETAIL_METRICS.**

## 2026-08-27

### STEP — STATISTICS_COLOR_SYSTEM_V1: 통계 화면 의미 기반 컬러 시스템

통계 메인 화면과 가격/거래 섹션 카드 7개(하락/최고가/상승/역전세, 실거래/
거래량/인기)에 의미 기반 컬러 시스템을 적용했다 — 상승·신고가=빨강,
하락=파랑, 위험=주황, 일반 거래=초록, 인기=보라. 데이터 로직/API 계약/DB는
전혀 건드리지 않았다(순수 UI 색상 정리).

**토큰**: 기존 DS2 `--up-color`(빨강)/`--down-color`(파랑)/`--warning-color`
(주황) primary 값은 그대로 재사용(다른 화면까지 색이 바뀌는 unrelated
recolor 방지)하고, `--up-soft`/`--up-border`/`--down-soft`/`--down-border`/
`--warn-soft`/`--warn-border`(연한 배경용, 신규)와 `--popular-color`/
`--popular-soft`/`--popular-border`(인기/관심 전용 보라, 신규),
`--brand-soft`/`--brand-border`(신규)를 globals.css에 추가했다.

**카드 UI**: `statsMenu.ts`에 `colorToken` 필드 추가(대상 7개 항목만 지정,
나머지 9개는 기존 브랜드 그린 기본값 유지). `.menuIcon`을 28px 사각형에서
40px 원형(soft 배경 + primary 아이콘 색)으로 교체 — 카드 배경은 흰색,
보더는 기존 연회색 그대로 유지(카드 전체를 진한 색으로 칠하지 않음).

**메뉴명 단축**: 최근하락→하락, 최고상승→상승, 많이산단지→인기(로직
slug는 변경 없음, 라벨 텍스트만 수정). Home 퀵메뉴 라벨도 동일하게 맞췄다.

**리스트 화면**: `RankingRow`에 `valueColor` 오버라이드 prop 추가 —
최고가(신고가, 부호 없는 지표)는 빨강, 인기(거래건수, 부호 없는 지표)는
보라로 고정 표시. 하락/상승/역전세는 기존 부호 기반 색(파랑/빨강)을 그대로
유지(이미 규칙에 부합, 변경 불필요). 역전세 화면에는 "주의·하락 위험 신호"
주황 배지를 추가해 카테고리 의미(위험)와 개별 값의 부호 의미(하락=파랑)를
분리했다. 거래량 차트의 거래량 막대는 중립 회색에서 브랜드 그린으로
변경(가격지수 선 그래프는 기존 계약 유지, 차트 전체 재설계는 범위 밖).

실거래 피드(TransactionFeedView)는 이미 상승=빨강/하락=파랑/신고가=빨강
배지/초록 인사이트 카드로 구현돼 있어 이번 STEP에서 추가 변경이 필요 없었다
(사전 확인 후 무변경).

모바일 360/375/390 + 데스크톱 확인 — 카드/그리드 레이아웃 회귀 없음, 카드
클릭→리스트, 리스트 행 클릭→단지 상세 이동 정상. `npx tsc --noEmit`/lint
에러 0. 기존 테스트 172/172(`.test.mjs`) PASS(회귀 없음, 로직 미변경).
`npm run build` PASS.

DB 쓰기: 없음. 스키마 변경: 없음. 데이터 로직 변경: 없음.

상태: 완료.

**STATISTICS_COLOR_SYSTEM_V1 = PASS. MENU_LABEL_SHORTENING = PASS.
SEMANTIC_COLOR_MAPPING = PASS. CARD_UI_COLOR_SYSTEM = PASS. LIST_COLOR_SYSTEM
= PASS. CHART_COLOR_ALIGNMENT = PARTIAL(거래량 막대만 적용, 가격지수 선
그래프는 기존 계약 유지). MOBILE = PASS. DESKTOP = PASS. BUILD = PASS.**

## 2026-08-27

### STEP — STATISTICS V2.1-1: 하락/신고가/상승 의사결정형 통계로 개편

통계 가격 카테고리 핵심 3개 화면(하락/신고가/상승)을 "단순 숫자 나열"에서
"데이터 → 해석 → 비교 → 탐색 → 행동"으로 이어지는 의사결정형 통계로
개편했다. 아실 UX를 참고했지만 그대로 복제하지 않고, 감사 과정에서 기존
계산 로직의 실제 결함을 발견해 고쳤다.

**감사에서 발견한 문제**: 기존 `/api/stats/rankings`는 하락/상승을 "최근
N건 평균 vs 오래된 N건 평균"(단지 전체, **면적 무관**)으로 계산하고
있었다 — 같은 단지의 서로 다른 전용면적 거래가 섞일 수 있는 데이터 신뢰
결함이었다. 또한 하락과 상승을 같은 계산식으로 다뤄, "역대 최고가 대비
하락"과 "직전 거래 대비 상승"이라는 서로 다른 사용자 질문에 부정확하게
답하고 있었다.

**새 계산 엔진** `src/lib/price-ranking.ts`(신규, 순수 함수): (동일
aptSeq+동일 raw 전용면적) 그룹의 시간순 히스토리를 기준으로 — 하락은 기간
내 최근 정상 거래 vs 그 이전 역대 최고가, 신고가는 각 거래가 그 이전 역대
최고가를 실제로 넘어섰는지(이전 최고가 없는 첫 거래는 신고가 아님), 상승은
기간 내 최근 정상 거래 vs 시간순 바로 직전 거래(역대 최고가 아님) — 세
가지를 명확히 구분했다. 취소거래 완전 제외, 미래 거래가 과거 판정에
영향을 주지 않음, 84.7855㎡/84.9950㎡ 같은 raw area collision 방지를 전부
27개 단위 테스트로 고정했다.

**신규 API** `GET /api/stats/price-rankings`: 트레일링 24개월(historical
high window, §12 문서화)을 기간/정렬/모드 무관하게 한 번만 fetch·캐싱해,
사용자가 기간 필터를 바꿔도 재fetch 없이 재계산만 한다. 기존
`FIX_STATISTICS_DATA_TRUST`의 Unit Master pyeong resolver를 그대로
재사용(가짜 평형 없음), `REGION FILTER V2`의 시도 전체 aggregation/부분
실패 계약을 그대로 재사용(새 인프라 없음). 시도 전체 결과에는 구+동을
함께 표시(`sigunguName`, 동 이름만으로 여러 구에 걸쳐 모호한 문제 해결).

**신규 공용 UI** `PriceRankingView`(하락/신고가/상승 3화면 공유, 중복
구현 없음): 질문형 subtitle, 기간/정렬/면적 필터, summary, row(순위·
단지명·지역+면적+평형·현재가·변동금액/율·비교기준일 evidence·
deterministic 해석) 구조. jeonse-risk/top-traded는 범위 밖이라 기존
경로 그대로 유지(회귀 없음). ▲/▼ 기호+색상+텍스트 병행 표시(색맹 접근성).
LLM 미사용 — "저평가"/"매수기회" 같은 투자 권유형 표현 없음(테스트로 고정).

라이브 검증: 부산 서구/연제구/해운대구, 서울 강남구, 부산 전체(distinct
구 12~14개), 서울 전체(distinct 구 17~20개) 3개 모드 전부 정상. 대신롯데캐슬
raw area 4종(84.7855/84.9950/59.8826/59.8839) 병합 없이 유지 확인. 모바일
360/375/390 + 데스크톱 확인, row 클릭→canonical 단지 상세 이동(lawdCd+dong)
정상. 성능: 부산 전체 cold 58.8초/warm 2.7초 — 직전 STEP의 dashboard
sido-all(62.6초)과 동일 규모, 악화 없음.

신규 `scripts/run-statistics-v2-1-price-ranking-qa.ts`(read-only 라이브
API 검증) 실행 결과 P0 findings 0건, RELEASE GATE READY. 기존
172/172(`.test.mjs`) + 388/388(`.test.ts`, 신규 27개 포함) PASS(회귀 없음).
`npx tsc --noEmit` 변경 파일 기준 에러 0. Lint 에러 0. `npm run build` PASS.

`docs/development/STATISTICS_V2_1_PRICE_RANKINGS.md` 신규(18개 섹션).

DB 쓰기: 없음. 스키마 변경: 없음. Migration: 없음.

상태: 완료.

**STATISTICS_V2_1_PRICE_RANKINGS = PASS. DECLINE = PASS. RECORD_HIGH = PASS.
RISING = PASS. SAME_AREA_IDENTITY = PASS. FAKE_PYEONG = ABSENT. PYEONG_SOURCE
= UNIT_MASTER. REGION_ALL = PASS. FILTERS = PASS. INTERPRETATION =
DETERMINISTIC. PARTIAL_FAILURE = DISTINGUISHED. API_ERROR_NO_DATA =
DISTINGUISHED. MOBILE = PASS. DESKTOP = PASS. BUILD = PASS. DB_SCHEMA_CHANGE
= NONE. NEXT_STEP = STATISTICS_V2_1_TRANSACTION_ACTIVITY.**

## 2026-08-27

### STEP — FIX PRICE RANKINGS V2.1-1A: TRUE RECORD HIGH (historical coverage honesty hotfix)

직전 STEP(STATISTICS V2.1-1)의 PM 검수에서 두 가지 문제가 지적됐다: (1)
신고가 판정의 historical window가 트레일링 24개월로 제한돼 있는데 화면이
이를 무제한 "역대 최고가"처럼 표현해 false-positive 신고가 오해를 유발할
수 있는 DATA TRUST 문제, (2) 메뉴 라벨 "최고가"가 향후 "절대가격 순위"
기능을 위해 예약된 의미(§8)와 혼동되는 문제. 범위를 넓히지 않는 focused
hotfix로 진행했다.

**감사 결과(Option A vs B)**: MOLIT 실거래 API(`RTMSDataSvcAptTradeDev`)는
지역(`LAWD_CD`)+월(`DEAL_YMD`) 단위로만 조회 가능하고 단지/면적 필터가
없다 — "후보 identity만 좁혀 조회"는 지역 단위보다 세밀하게는 불가능하다.
게다가 트레일링 24개월만으로도 이미 시도 전체 대부분의 구가
decline/record-high/rising 후보를 갖고 있어(부산 12~14/16, 서울 17~20/25 —
직전 STEP QA 실측) lookback을 늘리면 fetch 호출 수가 구 개수만큼 그대로
비례해 커진다(이미 부산 전체 24개월 cold 58.8초). 영구 실거래 이력 DB도
없다(`TradeHistory` 모델은 aptSeq/raw area가 없는 미사용 레거시 모델).
결론: 진짜 무제한 전체 역사 판정(Option A)은 스키마 변경(TRUE GATE, 이번
STEP 범위 밖) 없이는 안전하게 구현할 수 없다 — Option B(bounded + 정직한
라벨)를 선택하고 BLOCKER로 보고한다.

**수정**: `HISTORICAL_LOOKBACK_MONTHS = 24`(기존 값 그대로 유지 — fetch
로직/성능 전혀 변경 없음)를 `src/lib/price-ranking.ts`의 단일 source로
승격하고 `historicalCoverageLabel()`("2년")을 만들어 다음 전 지점에
일관되게 반영했다: 메뉴(`statsMenu.ts`) title `최고가`→`2년최고가`,
subtitle 갱신, 홈 quick menu(`home-client.tsx`) 동일 반영; 화면
(`PriceRankingView.tsx`) evidence 줄("최근 2년 최고가 OO 대비"), summary,
empty-state, "신고가" Badge→"2년최고가" Badge, 정렬 옵션 라벨; API
(`/api/stats/price-rankings`) 응답에 `historicalHighCoverageLabel` 필드
추가(rising은 `null`); interpretation(`price-ranking.ts`)의
decline/record-high 문구 전부 "과거 최고가"/"이전 최고가"(무제한 표현)
대신 "최근 2년 최고가" 형태로 범위 명시. decline도 record-high와 동일한
`priorHigh` 메커니즘을 공유하므로 §9 지시대로 동일하게 갱신(계산 로직은
무변경, 문구만 정직해짐).

**검증**: 신규 테스트 3개 추가(`historicalCoverageLabel` 동작, false
record-high 시나리오에서 "역대"/"진짜" 부재 확인, coverageLabel 파라미터
전달) — 기존 27개는 계산 로직 무변경이라 그대로 통과, 합계 30/30 PASS.
전체 회귀 172/172(`.test.mjs`) + 391/391(`.test.ts`, 신규 3개 포함) PASS.
QA 스크립트에 새 체크(E0: coverageLabel 필드 존재 + "역대"/"진짜" 정적
가드 + rising의 null 확인) 추가 후 재실행 — P0/P1 findings 0건, RELEASE
GATE READY(4개 구 × 3모드 + 부산/서울 전체 × 3모드 전부 통과). 브라우저로
`/stats/record-high`·`/stats/decline` 실제 렌더 확인(360/375/390 + 852px
데스크톱) — 헤더 "2년최고가", 배지 "2년최고가", evidence/summary/
interpretation 전부 "최근 2년" 범위 명시, "신고가"/"역대"/"진짜" 잔존
없음. `npx tsc --noEmit` 변경 파일 기준 신규 에러 0(기존 스크립트 20건은
STEP 9 이전부터 존재하던 것과 동일 — FAIL_EXISTING_SCRIPT_ERRORS). Lint
에러 0. `npm run build` PASS(전 라우트 컴파일 성공).

`docs/development/STATISTICS_V2_1_PRICE_RANKINGS.md`에 §19(감사·결정
근거) 신규 추가, §5/§9/§10/§12/§17 갱신.

DB 쓰기: 없음. 스키마 변경: 없음. Migration: 없음.

상태: 완료(단, TRUE_RECORD_HIGH는 BOUNDED_ONLY로 BLOCKER 보고 — 진짜
무제한 신고가는 별도 승인 STEP 필요).

**FIX_PRICE_RANKINGS_V2_1_1A = PASS. TRUE_RECORD_HIGH = BOUNDED_ONLY(BLOCKER).
DECLINE_HISTORICAL_HIGH = BOUNDED_ONLY(BLOCKER, 동일 사유). FALSE_RECORD_HIGH
= POSSIBLE(데이터 자체의 24개월 경계 밖 사례는 여전히 이론상 가능 — 다만
화면이 이를 무제한이라고 더 이상 주장하지 않음). MENU_LABEL = OTHER
(2년최고가 — "신고가"는 무제한을 뜻해 쓰지 않음). HISTORICAL_COVERAGE =
트레일링 24개월(2년). SAME_AREA = PASS. FUTURE_LEAKAGE = ABSENT.
CANCELLED_EXCLUSION = PASS. FAKE_PYEONG = ABSENT. PERFORMANCE = PASS(fetch
로직 무변경 — LOOKBACK_MONTHS 그대로 유지). BUILD = PASS. DB_SCHEMA_CHANGE
= NONE. NEXT_STEP = STATISTICS_V2_1_TRANSACTION_ACTIVITY.**


## 2026-08-28

### STEP — STATISTICS V2.1-2: TRANSACTION ACTIVITY(실거래/거래량/거래집중)

거래 카테고리 핵심 3개 화면을 "지금 어디서 거래가 일어나는가 → 지역
거래가 느는가 → 어떤 단지에 거래가 몰리는가" 흐름으로 개편했다. 상세
근거/QA는 `docs/development/STATISTICS_V2_1_TRANSACTION_ACTIVITY.md` 참고.

**메뉴 감사**: `slug: 'top-traded'`("인기")가 실제로는 `/api/stats/rankings`의
순수 거래건수(tradeCount) 랭킹이었고, 진짜 사용자 행동 기반 인기 기능은
`slug: 'popular'`(아직 soon)로 이미 별도 예약돼 있었다 — "인기"라는 이름이
두 곳에서 다른 뜻으로 쓰이는 overclaim이었다. `top-traded`를 "거래집중"으로
정정(title/subtitle/색상 popular→brand)하고, 전용 `/api/stats/concentration`
+ `ConcentrationView`(신규)로 교체했다 — day-precise 기간(7일/30일/3개월)
+ 직전 동일기간 대비 증감을 aptSeq 기준으로 집계한다(cancelled 제외,
`regional-feed.ts`의 기존 identity/취소 규칙 재사용).

**실거래 feed 버그 수정**: 감사 중 `annotateTrades`가 조회 lookback 안에서
"처음 관측된 거래"(비교할 과거가 없는 거래)까지 무조건 신고가로 표시하던
실제 버그를 발견했다(price-ranking.ts의 "이전 최고가가 실존해야 신고가"
원칙과 불일치했음) — 이전 최고가가 실제로 존재하고 그것을 넘어선 경우만
신고가로 인정하도록 수정. 또한 feed의 실제 lookback 범위(preset/SIDO_ALL
여부에 따라 12~24개월로 가변적)와 무관하게 무제한 "신고가" 단어를 쓰고
있던 것을, 실제 fetch 범위로부터 정직한 라벨을 계산하는
`windowCoverageLabel()`로 교체했다(예: 기본 조회는 "1년최고가", 12개월
preset은 "2년최고가", SIDO_ALL 7일 조회는 "7일최고가" — 하드코딩 없이
항상 실제 범위와 일치).

**신규 기능**: feed row에 세대수/입주연도(기존 `Apartment.totalHouseholds`/
`approvalDate` 컬럼 배치 조회, 새 스키마 없음)와 mini price trend(같은
그룹 최근 최대 5건 sparkline, 표본 3건 미만이면 숨김, annotateTrades의
부산물이라 추가 DB/API 호출 없음) 추가. 거래량(`/api/stats/dashboard`)에
`volumeSummaryByPeriod`(7일/30일/3개월, 매매/전세/월세별 현재기간 vs
직전기간 건수·증감·%) 추가 — 이미 fetch된 12개월 데이터 위의 순수
배열 연산만 추가해 새 MonthTask/DB 호출 0건.

**추가로 발견/수정한 버그**: QA 실측 중 서울 전체(SIDO_ALL) 거래량이
`{success:false}`로 완전히 죽는 것을 발견했다 — `gap-invest-calc.ts`의
`normalizeAptName`이 문자열이 아닌 `name`(서울 규모 데이터에서 드물게
발생) 앞에서 `.replace is not a function`으로 크래시했다(기존 코드,
이번 STEP이 새로 만든 코드 아님, 지역 전체가 죽는 실패 모드). 방어
코드 한 줄로 수정 — 정상 입력 동작은 무변경.

**검증**: `regional-feed.test.mjs` 19→33개(신규 14개: 버그 수정 후
동작, windowCoverageLabel, previousPeriodRange, toFeedTrade,
buildConcentrationRanking, mini trend 표본 규칙), `statistics-pyeong-resolver.test.mjs`
11→13개(신규 `resolveApartmentContextBatch`). 기존 `.test.mjs` 전체
154/154 PASS(회귀 없음). 신규 QA 스크립트
`scripts/run-statistics-v2-1-transaction-activity-qa.ts`(feed/volume/
concentration 산술 정합성, SIDO_ALL, dong 필터, popularity overclaim
정적 가드, fake-pyeong 가드) 작성 후 실행 — findings 0건, RELEASE GATE
READY(부산/서울 전체 포함). `npx tsc --noEmit` 변경 파일 기준 신규 에러
0(기존 scripts/* 에러는 FAIL_EXISTING_SCRIPT_ERRORS). Lint 에러 0.
`npm run build` PASS(`/api/stats/concentration` 신규 라우트 포함).

DB 쓰기: 없음. 스키마 변경: 없음. Migration: 없음.

상태: 완료.

**STATISTICS_V2_1_TRANSACTION_ACTIVITY = PASS. REAL_TRANSACTION_FEED = PASS.
VOLUME = PASS. TRADE_CONCENTRATION = PASS. THIRD_MENU_LABEL = 거래집중.
POPULARITY_CLAIM = HONEST. DATE_GROUPING = PASS. MINI_TREND = PASS.
VOLUME_COMPARISON = PASS(7일/30일/3개월만, 6개월/12개월은 정확성 이유로
미지원). SIDO_ALL = PASS. YEARLY_SIDO_ALL = UNSUPPORTED(구조적, 정직하게
안내 유지). PYEONG = TRUSTED. FAKE_PYEONG = ABSENT. UNSAFE_RECORD_HIGH_CLAIM
= ABSENT(버그 수정 완료). PARTIAL_FAILURE = DISTINGUISHED. API_ERROR_NO_DATA
= DISTINGUISHED. PERFORMANCE = PASS(신규 코드 0 추가 fetch — 거래량
SIDO_ALL cold는 기존부터의 한계로 별도 STEP 대상). MOBILE = PASS. DESKTOP
= PASS. BUILD = PASS. DB_SCHEMA_CHANGE = NONE. NEXT_STEP =
STATISTICS_V2_1_RISK_GAP 또는 STATISTICS_PERFORMANCE(ChatGPT PM 판단).**


## 2026-08-28

### STEP — STATISTICS V2.1-2A: TRANSACTION VOLUME CHART UI POLISH

거래량 화면 차트를 아파트 상세페이지 `PriceTrendChart`가 이미 검증한 UX
(모바일 full-bleed 카드, tap 즉시 선택 + drag-scrub crosshair, 검은 focus
box 버그 없음)에 맞춰 재정비했다. 데이터 계산 로직/API 계약/기간·지역
필터 계약은 전혀 바꾸지 않았다 — 표현(시각/인터랙션)만 개선. 상세 근거는
`docs/development/STATISTICS_V2_1_2A_VOLUME_CHART_UI_POLISH.md` 참고.

**구현**: 신규 `src/components/stats/VolumeChartCard.tsx`(+ 전용 CSS
모듈)로 `type-client.tsx`의 `VolumeView`/`VolumeSummaryStrip`을 대체했다 —
다른 stats 화면 전부가 공유하는 `page.module.css`의 `.panel`/`.panelBody`를
직접 고치면 다른 화면(랭킹/갭투자/비교/분위지도)까지 영향받기 때문에
독립 컴포넌트로 분리. `PriceTrendChart.tsx`가 이미 실측 검증한
interaction 패턴(activeIndex state, pointerdown/pointermove 콜백 ref +
`chart-crosshair.ts`의 `findNearestIndex` 재사용, 커스텀 dot render-prop,
`preventDefault(pointerdown)`로 검은 focus box 방지, 커스텀 tooltip,
`width:100vw; margin-inline:calc(50% - 50vw)` 모바일 full-bleed)를 그대로
이식했다 — 같은 버그를 다시 풀지 않는다는 원칙. "표"(연도별) 뷰는 기존
`.tableWrapper`/`.yearlyTable*` 클래스를 그대로 재사용해 로직/마크업을
전혀 건드리지 않았다. `page.module.css`의 `.main`에 `overflow-x: hidden`을
추가했다(상세페이지 `detail.module.css`와 동일한 이유 — full-bleed 카드의
100vw가 스크롤바 폭까지 포함해 페이지가 미세하게 가로 스크롤되는 것을
막는 이 페이지 전용 scoped 안전장치).

**검증**: 브라우저 실측(부산 서구)으로 매매/전세/월세 전환, 기간 비교
칩(7일/30일/3개월), 그래프/표 토글, 거래집중 cross-link(쿼리스트링 유지
회귀 없음) 전부 정상 확인. Tap 즉시 선택 + drag-scrub이 실제 API 데이터와
정확히 일치하는 tooltip을 보여줬고(예: 26.03=117건/98.8), 검은 focus box
없음. 모바일 360px(iframe으로 실제 viewport 강제)에서 카드가 정확히
viewport 가장자리까지 꽉 차는 full-bleed로 렌더, `scrollWidth ===
clientWidth`(overflow 0) 확인. `npx tsc --noEmit` 변경 파일 기준 신규
에러 0(기존 scripts/* 에러는 FAIL_EXISTING_SCRIPT_ERRORS). Lint 에러 0.
`npm run build` PASS. 기존 `.test.mjs` 154/154 PASS(데이터 로직 무변경이라
테스트 갱신 불필요).

DB 쓰기: 없음. 스키마 변경: 없음. API 응답 shape 변경: 없음.

상태: 완료.

**TRANSACTION_VOLUME_CHART_UI_POLISH = PASS. CHART_UI = PASS. INTERACTION =
PASS. TOOLTIP = PASS. CROSSHAIR = PASS. FULL_WIDTH_MOBILE = PASS.
DETAIL_CHART_ALIGNMENT = PASS. DATA_LOGIC_CHANGE = NONE. API_CONTRACT_CHANGE
= NONE. MOBILE = PASS. DESKTOP = PASS. BUILD = PASS. NEXT_STEP = ChatGPT PM
판단 대기.**

### STEP — STATISTICS PERFORMANCE V1

통계 기능/정의/UI를 전혀 바꾸지 않고 cold 성능만 개선했다(§32 목표: 부산/
서울 거래량·거래집중 cold 단축, feed 회귀 없음, warm ≤2s 유지). 상세 근거는
`docs/development/STATISTICS_PERFORMANCE_V1.md` 참고.

**감사 결과**: 병목은 (1) 모든 stats 라우트가 공유하는 전역 MOLIT 동시성
세마포어(`GLOBAL_MOLIT_CONCURRENCY=3`, molit-stats-helpers.ts), (2)
`getOrSetCache`(server-cache.ts)에 in-flight dedupe가 없어 동시 cold 요청이
겹치면 fetch storm이 배가될 수 있는 구조, (3) `price-rankings` 라우트가
정렬/페이지네이션 전에 **전체 후보**(sido-all에서 수백~천 건)를 Unit Master
batch 조회에 넣고 있던 것(실측: 부산 decline 모드 후보 959건, 응답 노출은
30건뿐) — warm(cache-hit)에서도 2.4~5.9초가 걸린 원인이었다.

**구현**: (a) `getOrSetCache`에 key별 in-flight `Promise` 공유 추가(TTL/키
의미 불변, 성공·실패 모두 `finally`에서 정리 — 메모리 누수 없음). (b)
`GLOBAL_MOLIT_CONCURRENCY`를 3→6으로 상향(권장 범위 4~8 안, 부산/서울
SIDO_ALL cold 반복 실행으로 `partial`/`failedDistricts` 증가 없음을 확인 후
확정). (c) `price-rankings/route.ts`: 정렬(sortFns)과 페이지네이션을 먼저
끝내고 Unit Master batch 조회/interpretation/sigunguName은 페이지에 실제
노출되는 행에만 수행하도록 순서 변경(정렬 키는 pyung과 무관하게 이미 row에
있어 최종 응답 값·순서는 완전히 동일 — §21 Unit Master 원칙 유지, 배치
크기만 축소).

**측정**(dev 서버 프로세스 재시작 + `.next/cache` 삭제로 진짜 cold 확보,
`scripts/run-statistics-performance-qa.ts` 신규 작성):

| 케이스 | cold before | cold after |
|---|---|---|
| 거래량 부산 SIDO_ALL | 47.3s | 30.3s |
| 거래량 서울 SIDO_ALL | 103.1s | 79.5s |
| 거래집중 부산 SIDO_ALL | 4.9s | 3.6s |
| 거래집중 서울 SIDO_ALL | 7.3s | 5.9s |
| price-rankings 부산 SIDO_ALL | 38.4s | 28.6s |
| price-rankings 서울 SIDO_ALL | 72.6s | 53.1s |
| price-rankings 부산 warm | 2.4~2.8s | **1.8~1.9s**(목표 ≤2s 달성) |
| feed(단일 구) 부산/서울 | 회귀 없음(오히려 소폭 개선) |

**검증**: `npx tsc --noEmit` 변경 파일 기준 신규 에러 0(기존 scripts/*
에러는 FAIL_EXISTING_SCRIPT_ERRORS, 무관). Lint 에러 0. `npm run build`
PASS. 브라우저로 `/stats/decline`, `/stats/volume` 390px·1440px 스모크
확인(콘솔 에러 없음, 데이터 정상 렌더, 가로 스크롤/겹침 없음). 모든
before/after 케이스에서 `partial=false`, `failedDistricts=0`(부분 실패
계약 유지). price-rankings 응답을 decline/record-high/rising 3개 모드 +
정렬 옵션 전부 curl로 재확인해 pyung/interpretation/sigunguName 값이
리팩터 전과 동일함을 확인.

**Known Limits**: price-rankings 서울 warm은 여전히 목표(≤2s) 초과(4.1~
4.2s) — bounded 배치 크기 축소 이후에도 남은 원인은 매 요청마다 캐시된
raw 거래 전체(서울 24개월×25구, 수만 건)를 다시 그룹화/정렬하는 순수 JS
비용이다. 계산된 rows 자체를 캐싱하려면 mode/period/sort까지 포함한 별도
캐시 키 체계가 필요해 이번 STEP 범위 밖으로 판단해 보류(다음 STEP 후보).
거래량 부산/서울 cold도 목표(각각 ≤12s/≤8s, ≤20s/≤15s)에는 못 미쳤다 —
남은 시간의 대부분은 MOLIT 외부 API 자체의 네트워크 지연이며, 영구 저장
캐시(DB_CACHE_GATE, TRUE GATE 대상) 없이는 이 아키텍처 안에서 더 줄이기
어렵다.

DB 쓰기: 없음. 스키마 변경: 없음. API 응답 shape 변경: 없음(price-rankings
필드/정렬 순서/값 전부 동일, 구현 순서만 변경).

상태: 완료.

**STATISTICS_PERFORMANCE_V1 = PASS(부분 목표 미달, 정직하게 보고).
VOLUME_BUSAN_COLD = 47.3s -> 30.3s. VOLUME_SEOUL_COLD = 103.1s -> 79.5s.
CONCENTRATION_BUSAN_COLD = 4.9s -> 3.6s. CONCENTRATION_SEOUL_COLD = 7.3s ->
5.9s. FEED_BUSAN = 회귀 없음. FEED_SEOUL = 회귀 없음. PRICE_RANKINGS_BUSAN
= 38.4s -> 28.6s. PRICE_RANKINGS_SEOUL = 72.6s -> 53.1s. INFLIGHT_DEDUPE =
PASS(코드 추가, 순차 실측 시나리오라 직접 재현 측정은 안 함). CONCURRENCY
= PASS(3->6, throttling 없음 확인). DATA_TRUST = PASS. FAKE_PYEONG =
ABSENT. PARTIAL_FAILURE = DISTINGUISHED. MOBILE = PASS. DESKTOP = PASS.
BUILD = PASS. DB_SCHEMA_CHANGE = NONE. NEXT_STEP = DB_CACHE_GATE(영구 캐시
테이블 — TRUE GATE, 승인 필요) 또는 STATISTICS_PERFORMANCE_V2(price-rankings
계산 결과 캐싱).**

### STEP — STATISTICS V2.1-3: GAP INVESTMENT + JEONSE RISK

가격/전세 리스크 영역의 갭투자·전세위험 두 기능을 "지역 랭킹 → 단지 랭킹"
구조의 이집형 의사결정 통계로 개편했다. 아실 "갭 투자 증가지역"을
참고하되 canonical identity(aptSeq+exact area)/claim transparency/
deterministic interpretation을 추가했다. 상세 근거는
`docs/development/STATISTICS_V2_1_RISK_GAP.md` 참고.

**감사 결과**: 기존 "역전세"(`/api/stats/rankings` 기반)는 "최근 3-sample
평균 vs 가장 오래된 3-sample 평균"이라는 장기 추세 비교였고, `isValidTrade`
가 `dealCanceled`를 확인하지 않아 **취소 거래가 집계에 섞이는 실제
버그**가 있었다. 기존 갭투자(dashboard "TOP5" 위젯)는 단지당 대표 1건만
보여줄 뿐 지역 랭킹 개념이 없었고, 매매·전세 계약 시점 간 시차를 검증하지
않아 먼 시점의 전세가를 붙일 위험이 있었다.

**구현**: (1) `gap-invest-calc.ts`에 90일 temporal window 가드(기존
`buildGapCandidates`에 옵션 추가, 기본값 활성 — 21개 기존 테스트 전부
그대로 통과) + 신규 `buildGapTradeEvents`(매매 거래 단위로 근접 전세를
매칭해 지역/단지/월별 집계가 가능한 이벤트 목록 생성). (2) `price-ranking
.ts`에 `buildJeonseRiskRows`(rising과 동일한 "직전 정상 거래 비교" 구조를
재사용, 방향만 하락으로 반전) + `buildJeonseRiskInterpretation`(안전한
wording만). (3) 신규 `/api/stats/gap-invest` 라우트(SIDO_ALL 시군구 랭킹
/ 구 선택 시 동 랭킹 / 단지 랭킹 + 월별 추이 + 이전 기간 비교, dashboard와
동일한 12개월 fetch shape 재사용). (4) `/api/stats/price-rankings`에
`mode=jeonse-risk` 추가(rent 타입 fetch, apiType을 캐시 키에 포함해
apt/rent 캐시 오염 방지). (5) `statsMenu.ts`: "역전세"→"전세위험"(slug는
`jeonse-risk` 유지, URL 하위호환). (6) `type-client.tsx`: 이제 쓰이지
않는 구식 `RankingListView`/`RANKING_CONFIGS`(취소거래 버그를 포함한 옛
역전세 로직) 제거, 신규 `GapInvestView.tsx` 컴포넌트 연결.

**데이터 신뢰**: aptSeq 우선 identity, raw exact area(84.7855㎡ vs
84.9950㎡ 절대 병합 안 함), cancelled 거래 양쪽(매매·전세) 제외, 미래
거래 leakage 없음(buildHistory의 시간순 구조가 구조적으로 보장) 전부
단위 테스트로 확인. "갭투자 거래"가 아니라 "갭투자 형태 거래"(bounded
wording)만 사용 — 실제 계약 당사자·보증금 승계 여부는 확정할 수 없음을
문구로 명시. 전세위험은 "역전세 확정"/"보증금 미반환" 등 금지 문구를
정적 가드로 차단하고, "실제 임대인의 보증금 반환 능력은 이 데이터만으로
판단할 수 없습니다" 고지를 화면에 항상 노출한다.

**성능**: 신규 N+1 없음(row별 fetch/Unit Master 조회 전부 batch, 기존
STATISTICS_PERFORMANCE_V1의 GLOBAL_MOLIT_CONCURRENCY=6+in-flight dedupe
재사용). 실측: 갭투자 부산 전체 cold 44s/서울 전체 132s, 전세위험 부산
전체 cold 53s/서울 전체 cold 150s·warm 16.2s. 서울 케이스가 기존
decline/rising(53s/4.1s)보다 느린 것은 정직하게 보고한다 — 원인은 동일
아키텍처의 알려진 한계(외부 API 지연 + cache-hit에도 남는 CPU 재계산
비용, rent 데이터 밀도가 더 높아 악화)이며 이번 STEP은 correctness가
목적이라 별도 최적화는 시도하지 않았다.

**검증**: `price-ranking.test.ts` 30개 전부 PASS(회귀 없음).
`verify-statistics-v2-1-gap-invest.ts` 21개 전부 PASS(90일 window 추가
후에도 기존 pairing 로직 회귀 없음). 신규
`scripts/run-statistics-v2-1-risk-gap-qa.ts`: 단위 테스트 17개 + 라이브
API 검사(부산/서울 전체, 부산 2개 구) + 회귀 스모크 6종 전부 PASS.
`npx tsc --noEmit`/lint 변경 파일 신규 에러 0. `npm run build` PASS.
모바일 390px(iframe 격리 기법)/데스크톱 스모크 확인 — overflow 0, 콘솔
에러 없음, 경고 아이콘+텍스트 병기(색상 단독 의존 없음).

DB 쓰기: 없음. 스키마 변경: 없음.

상태: 완료.

**STATISTICS_V2_1_RISK_GAP = PASS. GAP = PASS. GAP_CLAIM = HONEST.
SALE_JEONSE_MATCH = PASS. GAP_REGION_DRILLDOWN = PASS(동 단위는 API
레벨만 검증). JEONSE_RISK = PASS. JEONSE_RISK_CLAIM = HONEST.
UNSAFE_REVERSE_JEONSE_CLAIM = ABSENT. SAME_AREA = PASS. CANCELLED_EXCLUSION
= PASS. FAKE_PYEONG = ABSENT. PYEONG = TRUSTED. SIDO_ALL = PASS.
PARTIAL_FAILURE = DISTINGUISHED. API_ERROR_NO_DATA = DISTINGUISHED.
PERFORMANCE = PARTIAL(신규 N+1 없음, SIDO_ALL 서울 cold/warm은 기존 한계
그대로 — 정직하게 보고). MOBILE = PASS. DESKTOP = PASS. BUILD = PASS.
DB_SCHEMA_CHANGE = NONE. NEXT_STEP = ChatGPT PM 판단 대기.**

### STEP — STATISTICS PLACEHOLDER AUDIT V1

"준비중"으로 남은 6개 통계 메뉴(공급물량/인구변화/외지인비율/경사·고도/
대단지/인기단지)를 실제 repo/DB 기준으로 전수 감사한 기획+데이터+코드
감사 STEP이다. 구현이 아니라 우선순위 결정이 목적이며, 실제 코드 변경은
statsMenu.ts의 사소한 라벨/코멘트 정정 2건뿐이다. 상세 근거는
`docs/development/STATISTICS_PLACEHOLDER_AUDIT_V1.md` 참고.

**핵심 발견**: (1) "공급물량"은 이미 청약홈(Applyhome) 공식 API로
`Presale` 테이블에 1,046건이 있고 입주예정월(`moveInExpectedYm`)·
총세대수 커버리지가 100%다 — placeholder라기보다 "UI/집계 route가 아직
없는" 상태에 가깝다(단, 2026-08-12 1회성 backfill 이후 재동기화 안 됨).
(2) "대단지"도 `ApartmentMaster`에 부산 3,402건(세대수 93.5%, 주차/
입주연도 대부분 확보)이 이미 있다 — 단, 서울/전국은 0건이고 "평형 수"는
별개 테이블(`Apartment`, 63건 중 11건만)이라 사실상 채울 수 없다(§32
no fake readiness 원칙상 V1에서 제외 권장). (3) "인기단지"는
`soonReason`이 "아직 집계하고 있지 않습니다"라고 돼 있었지만, 실제로는
`PageView` 테이블에 이미 실시간으로 쌓이고 있었다(1,937건/17일) — 다만
bot/QA 트래픽 필터가 없고 표본이 작아 신뢰 가능한 랭킹으로 쓰기엔 이르다.
(4) "인구변화"/"외지인비율"은 관련 코드가 전혀 없어(grep 0건) 정직하게
NEEDS_EXTERNAL_DATA로 분류했다 — 외지인비율은 개별 거래 단위 매칭이
데이터 구조상 원천적으로 불가능함도 확인했다. (5) "경사/고도"는
코드/코멘트 확인 결과 문자 그대로 지형 고도·경사도를 뜻하며(가격
상승/층수 아님), 가치·데이터 둘 다 최하위라 후순위 보류를 권장한다.

**우선순위 재산정**(5기준 25점 만점 실측): 공급 21점 > 대단지 20점 >
인구·인기단지 12점(동점) > 외지인비율 11점 > 경사/고도 8점. 제시된
가설 순서(대단지>공급>...)와 달리 공급이 근소 우위로 나왔다 —
결과를 강제하지 않고 실제 감사대로 재정렬했다. 권장 Bundle A =
대단지+공급(TRUE GATE 없음, 기존 데이터 재사용, 다음 구현 STEP 후보),
Bundle B = 인구변화+전입전출(TRUE GATE #4 새 외부 API 필요, 이번 STEP
연동 안 함 — 다음 단계는 구현이 아니라 공식 데이터 소스 확정+승인 요청).

**Cleanup**(§34 허용 범위 내 최소 수정): `statsMenu.ts` 코멘트 "16개
메뉴" → "17개"(stale, gap-invest 추가 이후 갱신 안 됐던 것), `popular`
항목 `soonReason`을 실제 DB 상태에 맞게 정정.

DB 쓰기: 없음(read-only 쿼리로 감사, 스키마/데이터 변경 없음). 코드 변경:
statsMenu.ts 코멘트/문구 2곳만.

상태: 완료.

**STATISTICS_PLACEHOLDER_AUDIT_V1 = PASS. SUPPLY = READY_WITH_SMALL_FIX.
POPULATION = NEEDS_EXTERNAL_DATA. LARGE_COMPLEX = READY_NOW(부산 한정).
FOREIGN_BUYER = NEEDS_EXTERNAL_DATA. ELEVATION = KEEP(보류, 후순위).
POPULAR = ANALYTICS_REQUIRED(인프라 존재, 데이터 미성숙). NEXT_IMPLEMENTATION
_BUNDLE = 대단지+공급(Bundle A). NEXT_STEP = ChatGPT PM 판단 대기.**

### STEP — STATISTICS V2.1-4: SUPPLY + LARGE COMPLEX

STATISTICS_PLACEHOLDER_AUDIT_V1이 READY로 판정한 두 기능(공급, 대단지)을
live 통계로 구현했다. 새 DB/스키마/외부 API 없이 기존 데이터(청약홈
Presale, 건축물대장 ApartmentMaster)만 재사용했다. 상세 근거는
`docs/development/STATISTICS_V2_1_SUPPLY_LARGE_COMPLEX.md` 참고.

**공급**: `/api/stats/supply` 신규 — 입주지도(위치 확인된 단지만 지도에,
"N개 중 M개 위치 확인" 정직한 커버리지 고지)와 공급추이(연도별
세대수/단지수 bar chart + deterministic 문구)를 한 fetch로 함께 계산한다.
Presale에는 시군구 필드가 없어 `locationAddress` 문자열에서 **두 번째
토큰만**(REGION_DATA 실제 목록과 대조해) 안전하게 시군구를 추출하는
`src/lib/presale-region.ts`를 새로 만들었다 — 세 번째 토큰부터는 지구명이
섞여 신뢰할 수 없어 동 단위 drilldown은 지원하지 않는다. "전국" 토글은
이 화면 전용 로컬 상태로, 공유 RegionContext는 건드리지 않았다.

**대단지**: `/api/stats/large-complex` 신규(부산 한정, 서울/전국은
`status:'UNSUPPORTED'` + "부산으로 이동" CTA로 정직하게 처리) —
세대수 DESC 랭킹 + 구/동/세대수 필터 + 주차·입주연도·최근 매매가.
**감사 중 데이터 신뢰 이슈를 발견해 수정했다**: 같은 총괄표제부
(mgmBldrgstPk)를 공유하는 여러 row(같은 대단지의 서로 다른 동/구역)가
`totalHouseholds`를 동일하게 중복 저장하고 있어, 세대수로 그대로
정렬하면 상위 10건 중 9건이 실제로는 단 2개 단지("엘지메트로시티"
7건, "레이카운티" 2건)였다. `src/lib/large-complex-dedup.ts`로 대표
1건만 남기도록 고쳤다(이름을 새로 만들지 않고 실제 이름 중 결정론적
규칙으로 선택). 평형 수는 커버리지가 0.3%(63건 중 11건)뿐이라 UI에
표시하지 않는다(§30 지시).

**성능**: 신규 N+1 없음. 공급은 MOLIT 의존이 전혀 없어(Presale 단일
쿼리) cold/warm 모두 1초 미만. 대단지는 페이지에 등장하는 구만 batch
MOLIT 조회 후 구 단위 5분 캐시를 추가해(성능 감사 중 발견해 보강)
부산 전체 기본 랭킹 cold 4.3s → warm 0.27s로 확인했다.

**검증**: 신규 `scripts/run-statistics-v2-1-supply-large-complex-qa.ts`
— 단위 테스트 10개(dedup, region parsing, future-only 필터) + 라이브
API(전국/부산/서울/구/세대수 필터, dedup 회귀 가드, 평형수 비노출
정적 검사) + 기존 8개 live 화면 회귀 스모크 전부 PASS, findings 0건.
`npx tsc --noEmit`/lint 신규 에러 0. `npm run build` PASS. 모바일
390px/데스크톱 스모크 확인(overflow 없음, 콘솔 에러 없음), UNSUPPORTED
→"부산으로 이동" CTA 실제 클릭까지 검증.

DB 쓰기: 없음. 스키마 변경: 없음. 새 외부 API: 없음(기존 Presale/
ApartmentMaster/MOLIT만 재사용).

상태: 완료.

**STATISTICS_V2_1_SUPPLY_LARGE_COMPLEX = PASS. SUPPLY = PASS. SUPPLY_MAP
= PASS. SUPPLY_TREND = PASS. SUPPLY_REGION = PASS(동 단위 미지원, 의도된
제한). COORDINATE_HONESTY = PASS. SUPPLY_SOURCE = TRUSTED. LARGE_COMPLEX
= PASS. LARGE_COMPLEX_SCOPE = BUSAN_ONLY. HOUSEHOLD_DATA = TRUSTED
(dedup 버그 발견 후 수정). PARKING = PASS. RECENT_PRICE = PASS.
UNIT_TYPE_COUNT = HIDDEN. N_PLUS_ONE = ABSENT. MOBILE = PASS. DESKTOP
= PASS. BUILD = PASS. DB_SCHEMA_CHANGE = NONE. NEXT_STEP = ChatGPT PM
판단 대기.**

## 2026-08-28

### STEP — APT DETAIL CONSISTENCY HOTFIX V1

아파트 상세 페이지에서 단지별로 UI 구조 자체가 달라 보이던 불일치를
제거했다. 상세 근거는
`docs/development/APT_DETAIL_CONSISTENCY_HOTFIX_V1.md` 참고.

**토글**: ㎡/평 토글이 `unitMaster.some(representativePyeong != null)`
게이트로 가려져 있어 Unit Master 커버리지가 낮은 단지는 토글 자체가
사라졌다(사용자 보고 픽스처 B). 게이트를 제거해 모든 단지에서 항상
노출하도록 고쳤다 — 데이터 유무는 토글 안쪽 칩 캡션에서만 표현한다.
평 모드에서 trustworthy pyeong이 없는 area는 여전히 `exclusiveArea /
3.3058` 같은 fake 계산을 하지 않고 raw ㎡ + "평형 정보 없음"을
정직하게 보여준다. 칩 결정 로직을 `src/lib/area-utils.ts`의 순수 함수
`resolveAreaChipDisplay()`로 분리해 단위 테스트 가능하게 만들었다.

**Sticky Action Bar**: 찜 버튼 텍스트가 찜 여부에 따라 "관심단지"/
"관심단지 저장"으로 길이가 달라져 모바일 하단 3-action bar가 겹쳐
보였다(사용자 보고 두 픽스처가 실제로는 단지 문제가 아니라 세션별 찜
상태 문제였음을 확인). 가시 텍스트를 "관심단지"로 고정하고 상태는
아이콘 fill로만 표현하도록 바꿨다. `.stickyActionRow`도 `flex`에서
`grid-template-columns: repeat(3, minmax(0, 1fr))`로 바꿔 텍스트 길이와
무관하게 3버튼이 항상 동일 폭을 갖게 구조적으로 강제했다.

**부수 발견/복구**: `AreaChip`의 충돌 해소 보조 라벨(같은 평형으로
수렴하는 서로 다른 전용면적을 구분해 보여주는 캡션)이 `AreaSelector`가
`supplyAreaM2`를 항상 `null`로 고정해서 넘기는 바람에 전 단지에서
구조적으로 죽어 있었다 — 이번 리팩터로 함께 복구했다.

**Unit Master 커버리지 실측(부산)**: `ApartmentMaster`(canonical)
3,402건 대비, legacy Unit Master에서 trustworthy pyeong을 가진 단지는
11건(약 0.32%)뿐이다. 이번 픽스 이후에도 대다수 단지는 평 모드에서
"평형 정보 없음"을 보게 되는데, 이는 버그가 아니라 현재 데이터 상태를
정직하게 반영한 결과다 — 후속 STEP으로 Unit Master 백필을 강하게
권고한다.

**범위 밖 발견(수정하지 않음)**: QA 중 대신롯데캐슬 픽스처가 원래
보고("14평/25평 노출")와 다르게 보이는 것을 추적해, `/api/apt/[name]
/info` 라우트의 `fetchCachedRegistry()`가 `name+dong`으로 정확한 row
(unit type 8건, collision 케이스 포함)를 찾고도, `approvalDate`가
비어 있으면 `name` 없이 `dong+jibun`만으로 재조회해 같은 주소의 이름
변형 중복 row("대신롯데캐슬" vs "대신롯데캐슬아파트")를 잘못 집어
`unitTypes`를 8건→0건으로 덮어쓰는 사전 존재 버그를 발견했다.
`git diff`로 베이스라인에 이미 있던 버그임을 확인했고(이번 커밋에
포함된 파일 아님), AGENTS.md가 이번 STEP에서 금지한 "apartment basic
data" 영역이라 수정하지 않고 문서에만 기록했다. 이번 STEP의
"평형 정보 없음" 폴백은 이 버그가 있는 상태에서도 정직하게 동작한다.

**검증**: 신규 `scripts/run-apt-detail-consistency-qa.ts` — A파트
단위 테스트 7개(resolveAreaChipDisplay CASE A/B/C/D) + 정적 가드 7개
(3.3058 재도입 금지, 토글 항상 노출, "관심단지 저장" 재도입 금지,
3-column grid 유지) 전부 PASS. B파트 라이브 페이지 3픽스처 + 회귀
스모크(/map, /stats, /school) 전부 PASS. 모바일 360/375/390px
iframe-isolation으로 가로 스크롤 없음, sticky 3버튼 완전 동일폭 확인.
`npx tsc --noEmit`/lint 신규 에러 0. `npm run build` PASS.

DB 쓰기: 없음. 스키마 변경: 없음. 새 외부 API: 없음.

상태: 완료.

**APT_DETAIL_CONSISTENCY_HOTFIX_V1 = PASS. PYEONG_TOGGLE_ALL_DETAILS =
PASS. TRUSTED_PYEONG_ONLY = PASS. PYEONG_UNAVAILABLE_UX = PASS.
FAKE_PYEONG = ABSENT. AREA_COLLISION = PASS(복구됨). STICKY_ACTION_LABELS
= PASS. FAVORITE_STATE = ICON_ONLY. AUTH_STATE = PASS(로그인 모달 정상).
TOP_BOTTOM_SYNC = PASS(기존 이벤트 유지, 미변경). MOBILE_360 = PASS.
MOBILE_375 = PASS. MOBILE_390 = PASS. DESKTOP = PASS. OVERFLOW = NONE.
BUILD = PASS. DB_SCHEMA_CHANGE = NONE. UNIT_MASTER_COVERAGE_V2 =
RECOMMENDED. INFO_ROUTE_IDENTITY_BUG = FOUND_NOT_FIXED(out of scope).
NEXT_STEP = ChatGPT PM 판단 대기.**
