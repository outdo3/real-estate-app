# E-JIP SCORE V2 STEP 4B.1 — ELIGIBILITY PROVENANCE FIX

## 1. Blocker Root Cause
STEP 4B 벤치마크 단계에서 구덕금호(`26140-11`) 단지가 `SCORE_AVAILABLE`을 반환하는 중대한 Regression이 발생했습니다. 
원인은 V2 어댑터(`adapter.ts`)가 V1 DB 데이터를 읽을 때, 단순하게 `location != null`이라는 사실 하나만으로 `identityEligible = true`로 판정했기 때문입니다.
과거 STEP 0.5~0.6 검증 기록에 따르면, 카카오 POI 지오코딩 실패로 인해 동/건물명 키워드로 억지 검색된 좌표(`geocodeQuality = 'normalized'`, 일명 `COORD_LOW`)는 아파트 단지의 실제 좌표로 신뢰할 수 없는 오염된 데이터로 확정되었고, 이로 인해 구덕금호는 기존부터 점수 산정 불가(NOT_ENOUGH_DATA / DISPLAY_ONLY) 대상이었습니다.

## 2. 구덕금호 Provenance & 정상 벤치마크 비교
| 단지명 | `geocodeQuality` | `location != null` | Canonical Eligibility | V2 결과 |
|--------|------------------|---------------------|-----------------------|---------|
| 대신해모센트럴 | `exact` | Yes | `COORD_HIGH` | **66.61 (SCORE_AVAILABLE)** |
| 협성르네상스 | `exact` | Yes | `COORD_HIGH` | **65.08 (SCORE_AVAILABLE)** |
| **구덕금호** | `'normalized'` | Yes | `COORD_LOW` | **NOT_ENOUGH_DATA** |

## 3. Canonical Eligibility Rule (V2 Adapter)
과거의 룰(`peer-quality.ts` 등 참조)을 그대로 V2 입력 어댑터로 승계하여 정규화했습니다:
```typescript
const isCoordHigh = master.geocodeQuality === 'exact';
const identityEligible = location != null && master.sggCd != null && isCoordHigh;
```
위 규칙을 통해 카카오 지오코딩이 'exact'로 일치한 좌표만을 Core Score 계산에 사용하도록 강제합니다.

## 4. 부산 전체 Universe Before / After 분석
DB 쿼리를 통한 전수 조사 결과:
- **BEFORE (단순 location 존재 기준)**: `SCORE_AVAILABLE` 3,401건 / `NOT_ENOUGH_DATA` 1건
- **AFTER (Provenance 규칙 적용 기준)**: `SCORE_AVAILABLE` 2,833건 / `NOT_ENOUGH_DATA` 569건

이는 과거 STEP 3.x 시절의 Frozen benchmark 기대치(약 2,833 / 569)와 **완벽하게 일치**합니다. 
특정 단지만을 하드코딩한 것이 아니라, 데이터 모델의 원론적 규칙을 복원함으로써 정상 단지의 대량 탈락 없이 시스템 전체 Coverage를 원래 설계 의도대로 복원해 냈습니다.

## 5. Benchmark Regression & Test
수정 이후 구덕금호는 정상적으로 `NOT_ENOUGH_DATA`로 떨어졌으며, 나머지 10개 PAIR 벤치마크 단지의 점수 변동은 전혀 발생하지 않고 Frozen Candidate V2 점수를 동일하게 반환함이 자동화 테스트를 통해 검증되었습니다.
관련 테스트, TSC, Lint, Build 모두 오류 없이 PASS 되었습니다.

## 6. 결론
- **ELIGIBILITY_ROOT_CAUSE_CONFIRMED**: YES
- **GUDEOK_GEUMHO**: NOT_ENOUGH_DATA
- **BUSAN_COVERAGE_REGRESSION**: NONE (Frozen state 100% matched)
- **STEP_4B_STATUS**: PASS
- **SCORE_V2_SHADOW_READY**: YES
- **STEP_5_UI_READY**: YES
