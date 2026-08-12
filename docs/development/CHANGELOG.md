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
