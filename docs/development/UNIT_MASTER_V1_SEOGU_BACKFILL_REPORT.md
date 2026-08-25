# UNIT MASTER V1 — SEO-GU BACKFILL FINAL REPORT

## 1. Scope
- **Target**: 서구 READY 11개 아파트 단지
- **Source**: 2026-07 건축물대장 전유공용면적 실데이터
- **Production Table**: `ApartmentUnitType`

## 2. REVIEW Set Guard
- `REVIEW`로 판별된 5개 단지 (DB내 중복 생성 데이터)는 명시적으로 Backfill 대상에서 제외.
- 해당 단지들에 생성된 Unit row 카운트: 0

## 3. Production Execute
- **Dry Run**: 99 row 대상 확인
- **Apply 1st Run**: 99 row Insert 성공
- **Apply 2nd Run**: 0 row Insert, 99 row Update (Idempotency 완벽 동작)
- **Production Rows After**: 99 (Before: 0)

## 4. Constraint Validation
- Unique 제약조건 `[apartmentId, canonicalExclusiveArea, variantKey]` 충돌 없음.
- 주거 이외 상가(기타제2종근린생활시설 등) 상호 오염(Commercial Contamination) 0 확인.

## 5. Daesin Regression
- **84.7855㎡**: 112.3554㎡ (196세대) 및 112.3632㎡ (1세대)로 미세 단차까지 정확히 분리 생성.
- **84.9950㎡**: 113.4469㎡ (191세대)로 정확히 분리 생성.
- **129.7178㎡**: 164.9499㎡ (79세대) 과거 거래 누락 대형 타입 성공적 복구.

## 6. Representative Pyeong Policy
- 84.79 / 84.99 모두 평수 산식(공급면적 / 3.3058)에 따라 `34`평으로 자동 지정.
- Source는 `SUPPLY_AREA_DERIVED`로 저장됨.

## 7. Next Step
- AREA SELECTOR V2 구현 시작 가능.
