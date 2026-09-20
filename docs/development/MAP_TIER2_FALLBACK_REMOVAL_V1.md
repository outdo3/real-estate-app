# E-JIP MAP TIER-2 FALLBACK REMOVAL V1

`MAP_IDENTITY_FALLBACK_IMPACT_AUDIT_V1`의 실측에 따라, 지도 좌표 결합에서 **2순위 이름 부분포함 fallback을 제거**한다. 이제 `dong+name` 완전일치만 canonical identity로 인정한다.

- 날짜: 2026-09-20 (KST) · 기준 커밋 `de1e4de`
- **Production INSERT/UPDATE/DELETE 0** · schema 0 · master 0 · Seoul sale apply 0 · cancellation repair 0 · deploy 0 · push 0
- HTTP API 응답 계약(필드·형태) 변경 없음

## 판정

**PASS — 부산 marker 2,886 → 2,885(−1, 0.03%), 서울 5,819 → 5,819(변화 없음). 사라진 1개가 확정 오귀속이다.**

STOP 조건 전부 미해당: 사라진 부산 marker가 1개를 넘지 않았고, 서울은 불변이며, tier-1은 회귀 없고, schema 변경도 예상 밖 회귀도 없다.

---

## 1. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/map-marker-coords.ts` | 2순위 제거. `resolveApartmentCoords`가 `(index, dong, name)`만 받는다. `NameMatcher` 타입·`MasterCoordIndex.byDong`·fuzzy 캐시 삭제 |
| `src/app/api/transactions/route.ts` | 호출부 3인자로 축소, `fuzzyCache` 제거, 쓰이지 않게 된 `aptNamesMatch` import 제거 |
| `src/lib/map-marker-coords.test.mjs` | 2순위 테스트를 새 정책으로 반전 + 회귀 3개 추가 (7 → 10) |
| `scripts/audit-map-identity-fallback-impact.ts` | before/after 동시 측정. 제거된 규칙을 `legacyResolveAptSeq()`로 감사용 재현 |
| `scripts/audit-seoul-master-missing-misattribution.ts` | 같은 legacy 재현을 쓰도록 수정(과거 측정 재현 가능하게 유지) |

`aptNamesMatch` 자체는 **건드리지 않았다** — 상세(`/api/apt/[name]`)·교육·Score identity가 각자의 안전장치와 함께 계속 쓴다. 이번 변경은 **지도 좌표 결합 한 곳**뿐이다.

## 2. 무엇을 없앴나

```
전:  tier-1  dong|name 완전일치
     tier-2  같은 법정동 안에서 aptNamesMatch(양방향 부분포함 + 차수 가드)   ← 제거
후:  tier-1  dong|name 완전일치만
```

완전일치에 실패하면 `aptSeq`·좌표 모두 `null`이다 — 다른 단지의 좌표를 빌려오지 않고 marker를 만들지 않는다. **"틀린 위치의 marker"보다 "marker 없음"이 정직한 실패다.**

부수 효과로 `byDong` 색인과 fuzzy 캐시가 필요 없어져 요청마다 하던 배열 생성이 사라졌다.

## 3·5. before / after marker 수 (실측)

운영 파이프라인을 그대로 재현한 감사 스크립트로 같은 12개월 창을 두 규칙으로 돌렸다.

| | BEFORE | AFTER | 제거 | 제거율 |
|---|---|---|---|---|
| **부산**(Production DB) | **2,886** | **2,885** | **1** | **0.03%** |
| **서울**(캐시 원천 시뮬) | **5,819** | **5,819** | **0** | **0.00%** |

before 기준 tier-2 marker: 부산 1(전부 WRONG) · 서울 0. 정당한 표기차(SELF)와 증명 불가(UNKNOWN)는 **양쪽 모두 0**이라, 잃을 정당한 marker가 애초에 없었다.

### 구별 — 딱 한 구만 변했다

| 구 | before → after |
|---|---|
| 부산진구 351 → 351 · 사하구 288 → 288 · 동래구 275 → 275 · 해운대구 272 → 272 · 금정구 233 → 233 | 변화 없음 |
| 수영구 214 → 214 · 남구 213 → 213 · 연제구 206 → 206 · 북구 157 → 157 | 변화 없음 |
| **사상구 141 → 140** | **−1** |
| 서구 137 → 137 · 기장군 119 → 119 · 영도구 113 → 113 · 동구 75 → 75 · 중구 50 → 50 · 강서구 42 → 42 | 변화 없음 |
| **합계 2,886 → 2,885** | **−1** |

서울 25개 구: **변한 구 0개.**

## 4. 사라진 marker의 identity

| 항목 | 값 |
|---|---|
| source | `26530-69` **주례일산맨션** (부산 사상구 주례동) |
| 예전 결과 | `26530-72` **주례**의 aptSeq와 좌표를 물려받음 |
| 매칭 이유 | 정규화 후 **`주례` ⊂ `주례일산맨션`** 양방향 부분포함 |
| 왜 틀렸나 | 둘 다 MOLIT canonical aptSeq를 가진 **서로 다른 단지** |
| 현재 결과 | **NO MATCH — aptSeq `null`, 좌표 `null`, marker 없음** |

사라진 marker는 이 1건뿐이다.

## 6. 회귀 테스트

`src/lib/map-marker-coords.test.mjs` 7 → **10개** (요청된 A·B·C·D 전부 포함):

| 요구 | 테스트 | 결과 |
|---|---|---|
| **A** 주례일산맨션 vs 주례 → no match | `주례일산맨션은 주례로 매칭되지 않는다(확정 오귀속 제거)` — aptSeq·lat·lng 모두 null 검증 | pass |
| **B** 대림타운1 vs 대림타운 → no match | `대림타운1은 대림타운으로 매칭되지 않는다` (부산 북구 화명동 실제 사례 fixture) | pass |
| **C** 완전일치는 유지 | `완전일치하는 주례/대림타운 자신은 정상 매칭된다` + 기존 완전일치·차수·좌표없음·dong불일치 테스트 유지 | pass |
| **D** 전체 marker 수 불변 | 서울 fixture 대신 **실데이터 전수 측정**으로 대체(§3) — 서울 5,819 불변, 부산은 1개만 감소 | pass |
| 2순위 제거 자체 | `완전일치가 아니면 같은 dong이라도 보강하지 않는다` (예전 `...101동` 보강 테스트를 반전) | pass |

```
npx tsx --test src/lib/map-marker-coords.test.mjs           pass 10   fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"       pass 2342 fail 0   (이전 2,339 + 신규 3)
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"     pass 249  fail 0
npx eslint (변경 4개 파일)                                    exit 0
npx tsc --noEmit                                            src/ 0 · 기존 scripts 21 + tmp 4 = FAIL_EXISTING_SCRIPT_ERRORS (건수 불변)
npm run build                                               exit 0
```

### 로컬 end-to-end QA (실제 라우트, Production DB 읽기)

`npm start`로 빌드본을 띄워 운영과 같은 요청을 보냈다:

| 요청 | marker | 결과 |
|---|---|---|
| `lawdCd=26530` (사상구, 영향 구) | **140** | `주례일산맨션 aptSeq=null lat=null lng=null` — 오귀속 사라짐. `주례 aptSeq=26530-72`는 자기 좌표 유지 |
| `lawdCd=26230` (부산진구) | **351** | 예측치와 일치 |
| `lawdCd=26350` (해운대구) | **272** | 예측치와 일치 |
| `lawdCd=26140` (서구) | **137** | 예측치와 일치 |

같은 동의 다른 주례* 단지(주례1차동일 `26530-73` · 주례청구 `26530-76` · 주례맨션 `26530-75` · 주례한효 `26530-79` · 주례제일타워맨션 `26530-70` · 주례경동리인 `26530-994` · 주례롯데캐슬골드스마트 `26530-1137` · 주례센텀 `26530-930` · 주례벽산 `26530-61` · 주례2차동일 `26530-74`)는 전부 **자기 aptSeq와 자기 좌표를 그대로** 유지했다.

## 7. 성능

부산 master 3,438개 · 12개월 거래 34,829행. 8회 warmup 후 중앙값(색인 30회 · 해석 15회):

| 구간 | before | after | 차이 |
|---|---|---|---|
| 색인 생성(16개 구 전체) | 0.570ms | **0.489ms** | **−0.081ms** |
| 34,829행 전체 좌표 해석 | 7.526ms | **7.263ms** | **−0.263ms** |

**악화 없음 — 근소하게 빨라졌다.** `byDong` 배열 생성과 선형 탐색, fuzzy 캐시 조회가 모두 사라졌기 때문이다.

## 8. No-write assertion

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| schema / migration | 0 / 0 |
| master 생성·수정 | **0** |
| Seoul sale apply | **0** |
| cancellation repair | **0** |
| deploy / push | **0 / 0** |
| HTTP API 응답 계약 | **변경 없음**(`{...item, aptSeq, completionYear, lat, lng}` 그대로 — 값만 정직해졌다) |
| 로컬 QA | GET `/api/transactions` 4회(읽기 전용) |

## 9. 남은 것 · 다음

1. **배포 안 함** — 이번 STEP은 local commit까지다. 배포하면 부산 지도에서 주례일산맨션 marker 1개가 사라진다(의도된 결과).
2. **더 큰 marker 공백은 좌표다**(이전 audit §11): master는 있는데 좌표가 없어 marker가 안 생기는 단지가 **서울 93곳(812행) · 부산 37곳(115행)**. fallback(1건)보다 두 자릿수 크다 — 별도 STEP 권고.
3. 서울 sale backfill은 이 변경과 무관하게 계속 `DEFECT_A_GATE_PASS` 미설정으로 BLOCKED이며, 지도 노출을 늘리지 않는다(이전 audit §10).
