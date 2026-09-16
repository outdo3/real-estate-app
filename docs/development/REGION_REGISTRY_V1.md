# E-JIP REGION REGISTRY V1

시도 / 시군구 / 일반구 계층의 **canonical registry**를 만들고, 흩어져 있던 부산 코드 사본을 통합한다. 서울·경기는 registry에 **존재**하지만 **출시하지 않는다**.

- 날짜: 2026-09-16 (KST)
- 기준 커밋: `e8b0f34`
- 범위: 구조 작업. **DB write 0, schema 0, region enable 0, sitemap 0, SEO index 0, Seoul/Gyeonggi 수집 0.**
- 선행 근거: `SEOUL_GYEONGGI_EXPANSION_DATA_AUDIT_V1` §2·§28 STEP A

---

## 0. 결론 요약

**판정: PASS**

1. **canonical registry를 만들었다** — `src/lib/region/registry.ts`. 부산 16 · 서울 25 · 경기 48 = **89개 노드**. 데이터는 이 프로젝트가 이미 쓰는 법정동코드 프록시에서 실측 조회해 생성했다(코드·이름을 추측하지 않았다).
2. **경기 시 + 일반구 계층을 표현할 수 있게 됐다.** `성남시`(부모, 41130)와 `성남시 분당구`(일반구 leaf, 41135)를 명확히 구분한다 — 확장 blocker였던 구조 갭이다.
3. **MOLIT leaf 의미를 명시했다.** 일반구를 가진 시 6개(수원·성남·안양·안산·고양·용인)의 부모 코드는 `isMolitLeaf: false`다. 이전 audit의 **48 코드 / 42 leaf / 6 부모**를 독립적으로 재도출해 일치를 확인했다.
4. **중복 하드코딩을 0으로 만들었다.** 부산 16개 코드 사본 3곳이 전부 registry 파생으로 바뀌었고, 값은 한 글자도 달라지지 않았다(테스트가 리터럴 그대로 고정).
5. **"존재"와 "출시"를 분리했다** — `enablement.ts`. 서울·경기는 registry에 있지만 app/report/stats/sitemap/seoIndex/cronSync **6개 축 전부 false**다. registry에 지역을 추가하는 것만으로는 아무것도 열리지 않는다(기본값이 닫힘).
6. **부산 동작 무변화.** sitemap 139 유지, 서울·경기 URL 0, Production 회귀 없음.

---

## 1. 이전 중복 소스

| 위치 | 내용 | 분류 | 조치 |
|---|---|---|---|
| `src/lib/report/region-scope.ts` | `BUSAN_DISTRICTS` (코드+이름+구/군) | B 중복 | **registry 파생** |
| `src/lib/rent-verified-range.ts` | `BUSAN_LAWDCD_16` | B 중복 | **registry 파생** |
| `src/app/api/admin/ops/route.ts` | `BUSAN_16` (로컬 const) | B 중복 | **registry 파생** |
| `src/lib/regions.ts` `REGION_DATA` | 전국 시도→시군구 **이름만** | A 후보(부분) | 유지 + 드리프트 방지 테스트 |
| `report/region-scope.ts` allowlist 함수들 | 리포트 스코프 판정 | D 출시 제한 | 유지(§12) |
| `sitemap-scope.ts` `LAUNCH_SIDO` | 사이트맵 범위 | D 출시 제한 | 유지 |
| stats 각 라우트 `BUSAN_SIDO_CODE='26'` | 기능 지원 범위 | C 소비자 설정 | 유지(§16) |
| `RegionContext` 축약명 매핑 등 | 표시 | E | 유지 |

`REGION_DATA`의 한계가 핵심이었다: **lawdCd가 없고**, 경기도는 `성남시`까지만 있고 `분당구`가 없다.

---

## 2. Canonical 모델

```ts
type RegionType = 'METROPOLITAN_DISTRICT' | 'CITY' | 'COUNTY' | 'GENERAL_DISTRICT';

interface RegionSido  { code; name; shortName }              // '26' / '부산광역시' / '부산'
interface RegionNode  { lawdCd; name; fullName; sidoCode;
                        type; parentLawdCd; isMolitLeaf }
```

필드는 이게 전부다 — 행정학적 추상화를 더 얹지 않았다(§4 "과설계 금지"). `shortName`은 `ApartmentMaster.sido`가 쓰는 값과 같아 §4의 peer-context 파라미터화와 바로 맞물린다.

**enablement 필드는 노드에 넣지 않았다**(§13). "존재"와 "출시"를 같은 객체에 두면 둘이 섞이기 때문이다.

---

## 3. 계층

| 시도 | 노드 | 구성 |
|---|---|---|
| 부산광역시 (26) | 16 | 자치구 15 + 군 1(기장군), 전부 leaf |
| 서울특별시 (11) | 25 | 자치구 25, 전부 leaf, 일반구 없음 |
| 경기도 (41) | **48** | 부모 시 **6** + 일반구 **17** + 단일 시·군 **25** |
| **합계** | **89** | MOLIT leaf **83** (16+25+42) |

### 경기 일반구 구조 (실측)

| 부모 시 | 코드 | 일반구 |
|---|---|---|
| 수원시 | 41110 | 장안 41111 · 권선 41113 · 팔달 41115 · 영통 41117 |
| 성남시 | 41130 | 수정 41131 · 중원 41133 · 분당 41135 |
| 안양시 | 41170 | 만안 41171 · 동안 41173 |
| 안산시 | 41270 | 상록 41271 · 단원 41273 |
| 고양시 | 41280 | 덕양 41281 · 일산동 41285 · 일산서 41287 |
| 용인시 | 41460 | 처인 41461 · 기흥 41463 · 수지 41465 |

§11 요구 케이스 검증: `41135 → 경기/성남시/분당구`, `41117 → 경기/수원시/영통구`, `41287 → 경기/고양시/일산서구`, `41570 → 경기/김포시(일반구 없음)`, `41830 → 경기/양평군(COUNTY)`.

---

## 4. MOLIT leaf 의미

```
부산 서구 26140         isMolitLeaf: true
서울 강남구 11680        isMolitLeaf: true
경기 성남시 41130        isMolitLeaf: false   ← 부모 시, 직접 호출 금지
경기 성남시 분당구 41135  isMolitLeaf: true
경기 김포시 41570        isMolitLeaf: true
```

`getMolitLeafRegions(sidoCode?)`가 수집 대상만 돌려준다. 부모 코드로 호출하면 자식 일반구와 중복 수집될 위험이 있어 구조적으로 배제했다 — `MOLIT_QUOTA_SCALE_PROBE_V1` §6의 비용 모델(경기 leaf 42 기준)과 같은 기준이다.

---

## 5. Lookup helpers

| helper | 동작 |
|---|---|
| `getRegionByLawdCd(code)` | 노드 또는 **null** |
| `getSido(code)` / `getSidoRegions(code)` | 시도 / 그 시도의 노드 전체 |
| `getRegionChildren(lawdCd)` | 부모 시의 일반구 목록 |
| `getMolitLeafRegions(sidoCode?)` | 수집 단위(부모 시 제외) |
| `getRegionContext(lawdCd)` | `{ sido, city, district, node }` |

**모르는 코드는 전부 `null`**이다. fuzzy 매칭 없음, 특정 지역 fallback 없음, 이름으로 코드 추론 없음. `27110`(대구 중구)처럼 registry 밖 코드도 `null`이다.

---

## 6. Enablement 분리 (§13)

```ts
interface RegionEnablement { app; report; stats; sitemap; seoIndex; cronSync }
```

| 시도 | app | report | stats | sitemap | seoIndex | cronSync |
|---|---|---|---|---|---|---|
| 부산 (26) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **서울 (11)** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **경기 (41)** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 미등록 코드 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

기본값이 **닫힘**이라, 앞으로 registry에 지역을 추가해도 그것만으로는 절대 공개되지 않는다.

**이 모듈은 아직 아무 기능도 제어하지 않는다** — 각 소비자(리포트 allowlist, sitemap scope, cron 기본값, stats `BUSAN_SIDO_CODE`)는 자기 가드를 그대로 갖고 있다. 정책을 한 곳에서 **읽을 수 있게** 만든 단계이고, 실제 이관은 기능별로 다음 STEP에서 한다(§12가 요구한 보수적 범위).

---

## 7. 이관한 소비자 (§12 safe set)

| 파일 | 변경 | 값 변화 |
|---|---|---|
| `src/lib/rent-verified-range.ts` | `BUSAN_LAWDCD_16` = `getMolitLeafRegions('26').map(...)` | **없음** |
| `src/app/api/admin/ops/route.ts` | `BUSAN_16` 동일 | **없음** |
| `src/lib/report/region-scope.ts` | `BUSAN_DISTRICTS`를 registry에서 파생(`kind`는 `type==='COUNTY' ? 'GUN' : 'GU'`) | **없음** |

세 번째는 리포트 스코프 파일이지만 **스코프 의미를 바꾸지 않았다** — 여전히 명시 allowlist이고, `LIKE '26%'`로 바꾼 게 아니라 "시도 26의 MOLIT leaf"만 가져온다. 27110/11680은 registry에 있든 없든 들어오지 않는다. 기존 리터럴 16줄과 **완전히 동일**함을 테스트가 고정한다.

이관하지 않은 것(§12 지시대로): 리포트 allowlist 판정 함수, cron enabled regions, sitemap enabled regions, stats feature support.

---

## 8. REGION_DATA 호환 (§14)

`REGION_DATA`는 전국 17개 시도의 **이름 목록**이고 UI(통계/학교/재개발 시군구 셀렉트)가 쓴다. registry는 3개 시도만 덮으므로 **대체하지 않았다**.

대신 드리프트 방지 테스트를 넣었다: registry의 "일반구 제외 시군구 이름 집합"이 `REGION_DATA`의 해당 시도 목록과 **정확히 일치**해야 한다.

| 시도 | REGION_DATA | registry(일반구 제외) |
|---|---|---|
| 부산광역시 | 16 | 16 ✅ |
| 서울특별시 | 25 | 25 ✅ |
| 경기도 | 31 | 31 ✅ (부모 시 6 + 단일 25) |

경기도가 31로 맞는 이유가 중요하다 — `REGION_DATA`는 일반구를 담지 않으므로 `성남시`까지만 있고, registry의 부모 시 + 단일 시군과 정확히 대응한다. UI는 전혀 바뀌지 않았다.

---

## 9. 리포트 / 통계 / 검색 준비도

| 영역 | 현재 | registry로 표현 가능한가 |
|---|---|---|
| 리포트 | `/report/city/busan` 고정 경로 + 16코드 allowlist | **가능** — `서울`, `서울 강남구`, `경기`, `경기 성남시 분당구` 모두 `getRegionContext`로 표현된다. 다만 route 형태(`/report/city/{sido}`)와 스코프 타입은 재설계 필요 → 이번 STEP 범위 밖 |
| 통계 | 라우트마다 `BUSAN_SIDO_CODE='26'`, `feed-db-source.ts`의 `FEED_DB_SIDO_CODE='26'` | **가능** — 이 상수들을 enablement + registry로 바꾸면 되지만, 부산 parity 우선이라 이번엔 건드리지 않았다 |
| 검색 / 지역 모달 | `REGION_DATA` 기반 (전국 이름) | **가능** — 경기 일반구까지 필요해지면 registry가 제공한다. 지금은 UI 노출 변화 0 |
| cron | `BUSAN_LAWDCD_16` 기본값(이제 registry 파생) | **가능** — `getMolitLeafRegions()`가 전국 leaf를 줄 수 있으나, cron은 여전히 부산만 돈다(테스트로 고정) |

---

## 10. Sitemap / SEO 안전 (§19)

| 확인 | 결과 |
|---|---|
| Production sitemap `<loc>` 수 | **139** (변화 없음) |
| 서울·경기 URL | **0** |
| `buildLaunchRegionRoutes()` | **17** (부산 전체 1 + 자치구·군 16), 서울/경기 코드 0 |
| sitemap 축이 열린 노드 | 16개, 전부 시도 26 |
| seoIndex 축이 열린 노드 | 16개, 전부 시도 26 |
| cronSync 축이 열린 leaf | 16개 = `BUSAN_LAWDCD_16` |

registry에 89개 노드가 들어갔지만 색인·수집 대상은 하나도 늘지 않았다.

---

## 11. 테스트 · 빌드

```
npx tsx --test src/lib/region/region-registry.test.ts   pass 25   fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"   pass 2218 fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs" pass 135  fail 0
npx eslint (신규/변경 6개 파일)                           exit 0
npx tsc --noEmit                                        src/ 오류 0
                                                        기존 25건은 scripts/·tmp/ → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                           Compiled successfully in 2.3s
```

§20의 20개 요구 케이스를 전부 덮고, 계층 무결성(모든 일반구의 부모 존재·같은 시도·부모는 non-leaf)과 `fullName` 형식까지 고정했다.

---

## 12. 하드코딩 재스캔 (§23)

| 분류 | 위치 | 비고 |
|---|---|---|
| **BLOCKER** | — | **0** |
| CANONICAL_REGISTRY | `src/lib/region/registry.ts` | 유일한 코드 정본(89 노드) |
| TEST_ONLY | `region-registry.test.ts`, `stats-report-entry.test.ts`, `gap-invest-db-source.test.ts` | parity/fixture — 의도적 |
| EXPECTED_SCOPE_POLICY | `sitemap-scope.ts` `LAUNCH_SIDO`, stats 라우트 `BUSAN_SIDO_CODE`, `feed-db-source.ts` | 기능 지원 범위(§12에서 제외) |
| FOLLOW_UP | stats 상수들 → enablement 이관, `/report/city/busan` route 일반화 | 다음 STEP |

**runtime 중복 canonical region data = 0.** 서울·경기 코드는 registry와 그 테스트에만 존재한다.

---

## 13. 하지 않은 것

- DB INSERT/UPDATE/DELETE 0, migration 0, schema 0.
- 서울·경기 bulk fetch 0, region enable 0, sitemap 확장 0, SEO index 0.
- Score 재보정 0, 학교 rebase 0, cancellation repair 0.
- 리포트 route·스코프 판정 변경 0. cron 대상 변경 0. stats 동작 변경 0.
- `REGION_DATA` 대체 0(전국 UI 소스라 그대로 둠).
- 서울·경기 UI 노출 0.

---

## 14. 남은 아키텍처 갭

- **stats 라우트 6곳의 `BUSAN_SIDO_CODE='26'`**과 `FEED_DB_SIDO_CODE`가 아직 registry/enablement를 쓰지 않는다.
- **`/report/city/busan` 고정 route**와 리포트 스코프 타입이 시도 파라미터를 받지 않는다.
- **`REGION_DATA`가 여전히 UI의 시군구 소스**다 — 경기 일반구를 UI에서 다루려면 registry 기반으로 바꿔야 한다.
- **Score 곡선**이 부산 보정이다(pool은 지역별로 맞춰졌지만 곡선은 별도 STEP).
- **학교 교육청 코드 C10 · 오피스텔 스크립트 · 배정구역 artifact**가 부산 고정.
- registry는 3개 시도만 덮는다. 나머지 14개 시도는 필요해질 때 같은 방식(프록시 실측)으로 추가한다.
