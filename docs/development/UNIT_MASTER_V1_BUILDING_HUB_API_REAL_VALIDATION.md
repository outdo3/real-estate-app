# UNIT MASTER V1 — BUILDING HUB OPEN API REAL VALIDATION

## 1. API Approval & Key
- **API Key Discovered**: `FOUND` (`DATA_GO_KR_API_KEY` 환경변수 존재)
- **Approval Status**: 2026-08-06 승인됨 (사용자 명시)

## 2. Endpoint Discovery & Live Call
- **Attempted Endpoints**: 
  - `http://apis.data.go.kr/1613000/BldRgstService_20/getBrTitleInfo`
  - `http://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo`
  - 기타 여러 버전(`_01`, `_03`, 등) 
- **Live Call Result**: `FAIL`
- **Error Description**: 
  `NO_OPENAPI_SERVICE_ERROR` (해당 오픈API 서비스가 없거나 폐기됨, Return Reason Code: 12)
- **Cause**: "국토교통부_건축HUB_건축물대장정보" 서비스의 실제 신규 Endpoint URL이 기존 `BldRgstService` 계열과 다르게 변경되었으나, 정확한 URL 문서(가이드)가 환경 내에 제공되지 않아 호출이 차단되었습니다.

## 3. Real Data Check Status
실제 API의 통신 실패(Endpoint 불일치 또는 권한 미부여 오류)로 인해 다음 항목들의 검증이 불가합니다:
- Actual Response Format: `NOT_VALIDATED`
- Exclusive Register / Common Area: `NOT_AVAILABLE`
- Join Keys / Supply Calculation: `INVALID`
- exact match rate: 0%
- Missing Large Unit Recovery: `NOT_TESTED`

## 4. Secret Safety
- API Key는 `.env`에 보존되었으며 로그, 소스코드, 리포트에 일절 출력되지 않았습니다.

## 5. Production DB Guard
- **ApartmentUnitType count before**: 0
- **ApartmentUnitType count after**: 0
- **DB Writes**: 0건 (안전)

## 6. Next Recommendation
- **ENV KEY SETUP / DOCUMENTATION**: 사용자가 공공데이터포털(data.go.kr)에서 제공하는 "건축HUB_건축물대장정보"의 공식 **API 활용 가이드 PDF** 또는 정확한 **Endpoint URL (Base URL 및 Operation명)**을 확보하여 알려주어야 합니다.
