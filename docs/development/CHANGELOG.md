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
