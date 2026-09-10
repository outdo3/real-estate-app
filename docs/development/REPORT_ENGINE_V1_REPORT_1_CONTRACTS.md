# E-JIP REPORT ENGINE — REPORT-1 계약 (ReportEnvelope + 지역 read layer)

> 선행: `REPORT_ENGINE_V1_ARCHITECTURE.md`, `REPORT_ENGINE_PRECHECK_V1.md`.
> **Production write 없음 / schema 변경 없음 / migration 없음.** UI는 만들지 않았다(§15).

## 1. 파일 구성

| 파일 | 역할 | Prisma |
|---|---|---|
| `src/lib/report/types.ts` | `ReportEnvelope`, trust 타입, `summarizeTrust()` | X |
| `src/lib/report/region-scope.ts` | 부산 현행 16코드 **단일 지점** | X |
| `src/lib/report/region-aggregate.ts` | 집계 순수 로직(취소 제외/정렬/보강/표본) | X |
| `src/lib/report/region-report.ts` | 행 → envelope 조립(순수) | X |
| `src/lib/report/region-read.ts` | **유일한 DB 접근 지점**(SELECT 전용) | O |

원칙: **템플릿/컴포넌트는 raw 테이블을 직접 조회하지 않는다.** envelope만 읽는다.

## 2. ReportEnvelope

```ts
ReportEnvelope<T> {
  reportType     // REGION_CITY | REGION_DISTRICT | REGION_DONG
                 // | APARTMENT_DETAIL | APARTMENT_COMPARE | DAILY_NEW_TRADES
  reportVersion  // 'report-1.0.0'
  scope          // { level, lawdCd, dong, aptSeqs, displayName }  ← identity는 코드 기준
  period         // { start, end, label }
  generatedAt / dataAsOf
  trust          // { completeness, canceledExcluded, scopeLawdCds, metricTrustCounts, notes[] }
  title / subtitle
  metrics[]      // ReportMetric: value/displayValue/unit/trust/reason/sampleSize/source
  sections[]     // ROWS | DISTRIBUTION, 각 섹션도 trust를 갖는다
  highlights[]   // 기간 문구(contextLabel) 필수
  interpretation // { source: MEASURED_DELTA | EJIP_SCORE_BRIEFING | NONE, text, ruleId }
  sourceNotes[] / navigationTargets[] / data
}
```

`any`를 신뢰 관련 필드에 쓰지 않았다. `data`만 제네릭 `T`다.

## 3. Trust 모델

지표 단위 `MetricTrust = SAFE | LIMITED | UNSAFE | MISSING`
(Compare V2의 어휘를 **의도적으로 동일하게** 씀 — 같은 값이 화면마다 다르게 읽히지 않도록).

리포트 단위 `completeness = COMPLETE | PARTIAL | UNVERIFIED`는 지표 trust를
**요약할 뿐 덮어쓰지 않는다**:

- `UNSAFE`가 하나라도 → `UNVERIFIED`
- `LIMITED`/`MISSING`이 있으면 → `PARTIAL` (**LIMITED를 SAFE로 승격하지 않는다**)
- 전부 `SAFE` → `COMPLETE`
- 추가로, **커버리지가 미검증이면 지표가 전부 SAFE여도 `UNVERIFIED`로 내린다.**

`MISSING`이면 `value=null`, `displayValue='정보 없음'`이다. 0으로 채우지 않는다.

## 4. 지역 스코프

`BUSAN_CURRENT_LAWD_CODES` — 검증된 **명시 allowlist 16개**:

```
26110 중구      26140 서구      26170 동구      26200 영도구
26230 부산진구  26260 동래구    26290 남구      26320 북구
26350 해운대구  26380 사하구    26410 금정구    26440 강서구
26470 연제구    26500 수영구    26530 사상구    26710 기장군
```

이름은 Production `apartment_masters.sgg_cd/sigungu` 실측값이다(추정 아님).

**`LIKE '26%'`를 쓰지 않는다** — 지금은 우연히 맞지만 전국 확장이 들어오면 조용히 깨진다.
`27110`(대구 중구)/`11680`(서울 강남구)은 구조적으로 배제되며, `readRegionReport()`는
스코프 밖 코드를 **조용히 걸러내지 않고 `REPORT_SCOPE_INVALID`로 거부한다**
(조용히 거르면 분모가 말없이 달라진다).

## 5. LEFT JOIN 규칙 (§8, 필수)

집계의 출발점은 **항상 거래 행**이다. `apartment_masters`는 별도 조회 후 `aptSeq`로 붙이는
**보강 전용**이며, 없으면 `enriched=false`로 표시할 뿐 행을 버리지 않는다.

근거: PRECHECK 실측에서 부산 거래 **40,292건(4.7%)** 이 master에 매칭되지 않는다.
INNER JOIN을 쓰면 그만큼이 조용히 사라진다.

보강이 없을 때는 거래 원본 `aptName`을 그대로 쓰고, 세대수/준공연도는 `null`로 둔다.

## 6. 표본 게이트 (§9)

`MIN_SAMPLE_FOR_INTERPRETATION = 10` (최근 1년 기준).
PRECHECK에서 "최근 1년 10건 미만"인 동이 **52개**였고 그 아래에서는 중앙값·전월대비가
한두 건에 좌우된다 — 임의의 숫자가 아니라 그 실측에서 나온 경계다.

- **건수는 표본이 얇아도 `SAFE`** — 사실 그대로이므로 보여준다.
- 중앙값/증감률 등 비교성 지표는 `LIMITED`로 내린다.
- 표본이 불충분하면 `interpretation.source = 'NONE'` — **해석 문장을 만들지 않는다.**

## 7. 집계 규칙

- **취소 제외**(§7): 쿼리(`dealCanceled: false`)와 순수 레이어 양쪽에서 이중으로 건다.
  건수/중앙값/대표거래/2년 최고가 어디에도 취소건이 들어가지 않는다.
- **평 라벨 금지**: `ApartmentUnitType` 커버리지 2.9%. `exclusiveAreaM2`만 싣는다.
- **결정론적 정렬**: 최근 거래는 계약일 desc → 금액 desc → aptSeq asc → 이름 asc.
  고가 거래는 금액 desc → 계약일 desc → aptSeq asc. 분포는 건수 desc → key asc.
  입력 순서가 달라도 결과가 같다(테스트로 고정).
- **대표 단지 identity**: `aptSeq` 우선, 없으면 `이름|동`으로만 묶고 다른 단지와 합치지 않는다.
- **㎡당 가격**: `dealAmount(만원) / exclusiveArea(㎡)` — 둘 다 raw라 파생 위험이 없다.
- **2년 최고가**: `최근 2년 최고 거래가` + `contextLabel='최근 2년 · 취소 거래 제외'`.
  **"역대 신고가" 표현은 쓰지 않는다.**
- **예측 금지**(§10): `interpretation`은 실측 차이값만 말한다(`ruleId='REGION_COUNT_DELTA_V1'`).
  직전 기간이 0건이면 비율을 만들지 않고 `MISSING`으로 둔다.

## 8. dataAsOf / 완전성 (§12)

`sync_coverage_cells`는 `(dataset, lawdCd, dealYmd)` **upsert**라 "그날 검증됐는가"를
사후 재구성할 수 없다. 그래서 **"지금 이 스코프가 검증된 상태인가"**만 본다:
기간에 걸친 모든 (구 × 월) 셀이 존재하고 전부 `COMPLETE`/`EMPTY_VALID`여야 완전하다고 본다.
`dataAsOf`는 그 셀들의 최대 `verifiedAt`이며, 셀이 없으면 `null`(모른다고 말한다).

## 9. 검증 결과

### 순수 단위 테스트 — 25/25 PASS
`npx tsx --test src/lib/report/region-report.test.ts`

16코드 allowlist / 27110·11680 거부 / 스코프 밖 행 제거 / 취소 제외 /
LEFT JOIN 행수 불변(matched·unmatched·mixed) / 미보강 행 보존 / 평 필드 부재 /
표본 게이트 경계 / 결정론적 정렬 / trust 요약(LIMITED 승격 금지) / 0건 MISSING 처리 /
envelope 결정론.

> 실행 러너: **tsx**. 이 모듈들은 서로를 확장자 없이 import하는데(앱 코드 정상 관례,
> `moduleResolution: bundler` 전제) node 네이티브 ESM 로더는 그걸 해석하지 못한다.
> 프로덕션 코드를 테스트 때문에 비틀지 않기 위해 러너를 tsx로 택했다.

### 읽기 전용 통합 확인 — 5/5 PASS (Production, 2026-08-01~08-31)
`npx tsx --test src/lib/report/region-read.integration.test.ts`

| 스코프 | 결과 |
|---|---|
| 부산 전체 | 거래 **2,049건**, 구 16개, `completeness=COMPLETE`, `dataAsOf=2026-09-09T20:00:17.040Z` |
| 취소 검증 | 전체 2,113 − 취소 64 = **2,049** (정확히 일치) |
| 해운대구 | 거래 **248건**, 최근 8행(미보강 0), `COMPLETE` |
| 우동 | 거래 **52건**, 중앙가 **7억 4,500만원**(`SAFE`), 해석 `MEASURED_DELTA` |
| 스코프 밖 | `27110`/`11680` 모두 `REPORT_SCOPE_INVALID`로 **거부** |

건수는 리포트 경로를 쓰지 않는 **독립 원시 쿼리**와 대조해 일치를 확인했다.

## 10. 구현한 지표 / 의도적으로 뺀 것

**구현**: 거래건수, 중앙 거래가, ㎡당 중앙가, 최근 계약일, 직전 동일기간 대비 거래량,
구별 분포(시), 동별 분포(구), 거래가 많은 단지, 최근 실거래, 최근 2년 최고 거래가.

**뺀 것과 이유**:
- 평/평형 라벨 — Unit Master 커버리지 2.9% (BLOCKED)
- "역대 신고가" — 과거 전 구간 취소 검증 불가
- 시장 방향/전망 — 예측 금지(§10). 실측 증감률만 제공.
- 매매↔전월세 관계 — 매칭 계약 미검증(LIMITED)
- 오피스텔 혼합 — canonical source id 부재로 아파트와 같은 신뢰도로 섞지 않는다
- E-JIP Score — 지역 리포트 범위 밖(REPORT-3에서 단지 리포트에 사용)

## 11. 알려진 한계

1. `region-read.ts`는 기간 내 거래를 메모리로 읽어 집계한다. 부산 한 달 기준 2,049행이라
   현재는 문제없지만, **연 단위 스코프에서는 SQL 집계로 옮겨야 한다**(REPORT-2에서 측정 후 판단).
2. `dataAsOf`는 SALE 커버리지만 본다. 전월세를 쓰는 리포트가 생기면 RENT도 함께 봐야 한다.
3. 당월(202609) 커버리지 셀이 없어 당월을 포함한 기간은 `UNVERIFIED`가 된다 — 정상 동작이며
   화면에서 그대로 알려야 한다.
4. 통합 테스트는 `DATABASE_URL`이 없으면 스킵된다(오프라인/CI에서 실패로 잡히지 않게).
