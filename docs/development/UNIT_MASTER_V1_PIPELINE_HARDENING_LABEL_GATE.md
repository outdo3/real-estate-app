# UNIT MASTER V1 — PIPELINE HARDENING & OFFICIAL LABEL GATE

## 1. Residential Filter
- **RESIDENTIAL_INCLUDE**: `아파트`, `다세대주택`, `연립주택`, `공동주택` (전유부 용도명 기준)
- **RESIDENTIAL_EXCLUDE**: `기타제2종근린생활시설`, `상가`, `오피스텔`, `주차장` 등

## 2. Address Match & Unit Master Coverage
- **Target Apartments**: 16 (Busan Seo-gu `lawdCd: 26140`)
- **Address Exact Matched**: 11 (68.8%)
- **Unit Master Generated**: 11 (68.8%)
- **Missing Apartment Analysis**: 매칭 실패한 5개 아파트(`대신해모로센트럴`, `대신푸르지오2차`, `대신더샵`, `대신롯데캐슬아파트`, `서대신협성르네상스타운아파트`)는 모두 동일 단지의 DB 내 중복(Dirty Data)임이 확인됨. 실제 물리적 아파트 단지에 대한 커버리지는 100%.

## 3. Household Validation
- DB의 `totalHouseholds`와 건축물대장 기반 집계 세대수가 완벽하게 일치함.
- 대신롯데캐슬: 753세대 (정확히 일치)
- e편한세상송도더퍼스트비치: 1302세대 (정확히 일치)

## 4. Daesin Regression & Large Unit Recovery
- **84.7855㎡**: 112.3554㎡ (34평), 197 세대 (DISTINCT, 유지됨)
- **84.9950㎡**: 113.4469㎡ (34평), 191 세대 (DISTINCT, 유지됨)
- **129.7178㎡ (대형 평형)**: 164.9499㎡ (50평), 79 세대 (RECOVERED, 유지됨)

## 5. Official Label Strategy & Display Policy
- **Official Label Sources**: `PresaleHouseTypeDetail`는 최신 분양 단지만 커버하므로 과거 구축(대신롯데캐슬 등)에는 적용 불가. 민간 포털 스크래핑은 지양.
- **Derived Label Policy**: 
  - 기본적으로 `SUPPLY_AREA_DERIVED` (공급면적 / 3.3058) 평형을 사용.
- **Collision UX**: 대신롯데캐슬처럼 derived 34평이 중복 발생할 경우, UI에서 `34평 · 전용 84.79㎡`, `34평 · 전용 85.00㎡`와 같이 전용면적을 병기하여 사용자 혼란을 방지.
- **MANUAL_VERIFIED**: 입주자모집공고 등 신뢰할 수 있는 소스가 수동 확보된 단지에 한해 `33평`, `34평` 등 공식 평형을 수동 부여(Enrichment).

## 6. Backfill Candidate Set & Safety Threshold
- **READY**: 11개 단지 (세대수 검증 완벽 일치 또는 오차 범위 내)
- **REVIEW**: 5개 단지 (이름/주소 중복으로 매칭 실패)
- **EXCLUDE**: 0개 단지
- **Safety Threshold**: Commercial contamination 0, Shadow duplicates 0 확인 완료. Backfill 안전 기준 충족.

## 7. Next Step
- SEO-GU UNIT MASTER BACKFILL GATE 
