# UNIT MASTER V1 — BUILDING REGISTRY REAL DATA VALIDATION

## 1. Source Acquisition Status
- **Status**: `BLOCKED` (DATA_SOURCE_BLOCKED)
- **Reason**: 현재 작업 환경(AI Agent Environment) 내에 실제 공공기관(국토교통부)에서 제공하는 건축물대장 원본 대용량 벌크 데이터 파일이 존재하지 않으며, 해당 데이터를 호출할 수 있는 공공데이터포털(data.go.kr) API Key(인증키) 또한 환경 변수에 등록되어 있지 않습니다.
- **Action Required**: 임의의 가짜 데이터(Fixture)나 수작업 샘플(Sample)로 테스트를 통과(PASS)한 것으로 위장하는 것은 "가짜 fixture 금지" 원칙에 위배되므로 작업을 중단하고 사용자에게 실제 데이터 확보를 요청합니다.

## 2. Required Real Data Files
파이프라인 실전 검증을 위해 사용자가 직접 다운로드하여 작업 디렉토리(예: `scripts/data/raw/`)에 비치해야 할 파일 목록입니다.

### A. 국토교통부 건축물대장 원본 (월간 벌크 데이터)
- **제공기관**: 국토교통부 (또는 건축데이터 민간개방 시스템 `open.eais.go.kr`)
- **데이터셋명**: 
  1. **건축물대장 전유부** (각 세대별 전용/공용면적 추출용)
  2. **건축물대장 표제부** (아파트 동 정보 및 단지명 매칭용)
- **형식**: 주로 `.txt` (구분자 `|` 등) 또는 `.csv` 형태의 대용량 텍스트 파일
- **필수 포함 정보**: 시군구코드, 법정동코드, 지번, 건물명, 호명칭, 전용면적, 주거공용면적, 주/부속구분, 용도코드 등.

### B. 확보 후 진행 방법
1. 데이터를 다운로드 압축 해제 후 `scripts/data/raw/` 폴더 등에 위치시킵니다.
2. 용량이 기가바이트(GB) 단위일 수 있으므로, 부산광역시(법정동코드 26***) 데이터만 파싱할 수 있도록 파일 경로를 알려주시면 해당 파일에 맞춘 Real Data Pipeline Adapter 코드를 작성해 실전 검증을 수행하겠습니다.

## 3. Production DB Guard
- **ApartmentUnitType count before**: 0
- **ApartmentUnitType count after**: 0
- **DB Writes**: 수행되지 않음. (설계 원칙 준수)

## 4. Next Recommendation
- **SOURCE ACQUISITION**: 사용자가 실제 건축물대장 원본 데이터를 확보하여 파일 시스템에 적재한 후, 다시 해당 명령을 실행해 주시거나 파일 경로를 제공해 주십시오.
