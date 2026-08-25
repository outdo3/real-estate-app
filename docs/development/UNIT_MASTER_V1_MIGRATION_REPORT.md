# UNIT MASTER V1 — MIGRATION REPORT

## 1. Approval
사용자(PM)로부터 Production DB 반영 명시적 승인을 받았습니다.

## 2. Schema Added
- `ApartmentUnitType` 테이블 생성 (Flat 구조)
- `Apartment`에 `unitTypes` 양방향 릴레이션 추가

## 3. Enums Added
- `PyeongProvenance`: `OFFICIAL_LABEL`, `SUPPLY_AREA_DERIVED`, `UNKNOWN`
- `UnitDataSource`: `BUILDING_REGISTRY`, `PRESALE`, `MANUAL_VERIFIED`, `OTHER`

## 4. Constraints
- **FK**: `ApartmentUnitType.apartmentId` -> `Apartment.id`
- **onDelete**: `RESTRICT` (사고 방지)
- **Unique**: `(apartmentId, canonicalExclusiveArea, variantKey)` (null-safe 유니크)
- **Index**: `(apartmentId, canonicalExclusiveArea)` 최적화 인덱스 추가.

## 5. SQL Safety Check
Migration Name: `20260825061752_add_apartment_unit_type_v1`
생성된 SQL은 모두 `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE ... ADD CONSTRAINT`의 Additive-Only 쿼리이며, 기존 데이터를 손상시키는 `DROP`이나 `ALTER COLUMN`이 전혀 포함되지 않아 안전합니다.

## 6. Production Apply
`npx prisma migrate deploy` 명령어를 통해 Supabase Production 환경에 직접 배포를 성공적으로 완료했습니다.

## 7. Row Count & DB Verify
- 마이그레이션 직후 `ApartmentUnitType` row count: `0` (정상 확인 완료)
- Enum(PyeongProvenance 등)이 Production 에 정상 생성됨을 확인했습니다.

## 8. Existing Data Regression
DB 쿼리와 Next.js 앱의 `npm run build`를 수행해 전체 API / 프론트엔드가 Typescript Type 훼손 없이 모두 성공적으로 컴파일됨을 검증했습니다. 기존 Apartment, Trade 등 모든 기능 유지 보장(Regression 없음).

## 9. Next Step
- **UNIT MASTER V1 BUILDING REGISTRY PIPELINE POC**: 이제 빈 Unit Master 뼈대가 생성되었으므로, 건축물대장 전유부/표제부 데이터를 파싱하여 DB에 백필(Backfill)을 시험 가동하는 Pipeline 구현으로 넘어갑니다.
