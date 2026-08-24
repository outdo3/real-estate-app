# SCHOOL V2-C5 — 학교 거리/접근성 정확도 감사 (AUDIT + DESIGN)

- **STEP**: SCHOOL V2-C5
- **성격**: AUDIT + DESIGN ONLY — 실제 대량 API 호출/DB migration/production write 없음
- **Branch**: `school-v2-c5-distance-audit` (worktree `D:/anti2/aaa/e-jip-school-c5`, base `da17c0a` = `school-v2-c2a`)
- **관련 문서**: [SCHOOL-V2-B-official-source-verification.md](./SCHOOL-V2-B-official-source-verification.md) (school/kindergarten/childcare 공식 source 라이선스·필드 감사), [SCHOOL-V2-C-education-data-architecture.md](./SCHOOL-V2-C-education-data-architecture.md), [SCORE-V1-1-school-calibration-and-busan-coverage.md](./SCORE-V1-1-school-calibration-and-busan-coverage.md)

---

## 0. 목적

SCHOOL V2 부모 중심 교육정보 UI를 만들기 전에, 현재 이집이 "학교까지 거리/도보시간"을
어떻게 계산하고 표시하는지 코드 기준으로 전수 감사하고 안전한 데이터 모델·UI 표시
원칙을 설계한다. 구현은 하지 않는다.

---

## 1. 현재 거리 계산 파이프라인 — 3갈래 독립 구조 확인

같은 "학교까지 거리"라는 개념이 코드베이스 안에 **서로 다른 좌표 소스·계산식·용도를
가진 3개의 독립 파이프라인**으로 존재한다. 서로 참조하지 않고, 서로 다른 숫자를
낼 수 있다.

### 파이프라인 A — 이집점수(Score) `schoolAccess` 카테고리

| 항목 | 내용 |
|---|---|
| 파일 | `src/lib/apartment-score/collectors/location.ts` → `src/lib/apartment-score/server/school-distance-band.ts` → `school-access-sentence.ts` → `explain.ts` |
| 입력 좌표 | `ApartmentMaster.latitude/longitude` (아파트 대표 좌표) |
| 학교 좌표 소스 | Kakao Local **카테고리 검색**(`SC4`, 반경 1000m, `sort=distance`) — 요청 시점에 실시간 조회, DB의 `School.latitude/longitude`는 **사용하지 않음** |
| 계산식 | Kakao가 응답에 포함하는 `distance` 필드(Kakao 자체 계산, 알고리즘 비공개 — 직선거리로 간주) |
| Output | `nearestElementaryDistanceM`(정수, m) — `ApartmentLocationFeature`에 raw feature로 캐시 |
| 밴드/문구 | `absoluteSchoolDistanceBand()`가 실측 percentile 기준 임계값(VERY_CLOSE≤200m, CLOSE≤400m, NORMAL≤650m, FAR≤933m)으로 밴드화 → `buildSchoolAccessSentence()`가 **"도보 N분" 같은 시간 표현 없이** "매우 가까운 편", "다닐 만한 무난한 거리" 같은 정성적 문구만 생성 |
| 특이사항 | `school-access-sentence.ts` 상단에 §35 금지어휘 명시("좋은 학군", "명문" 등 절대 사용 금지) — 거리≠학군 원칙이 코드 수준에서 이미 강제됨 |

**평가**: 이 파이프라인은 현재 가장 안전하다. 절대 임계값이 하드코딩이 아니라 실측
402건 분포(percentile)에 앵커링돼 있고(주석에 근거 명시), 시간 단위로 변환하지
않아 "실제로 몇 분 걸린다"는 오해를 만들지 않는다.

### 파이프라인 B — `/school/[id]` 페이지 "인근 아파트" 목록

| 항목 | 내용 |
|---|---|
| 파일 | `src/app/api/school/apartments/route.ts` |
| 학교 좌표 소스 | ① URL의 `lat`/`lng` 쿼리파라미터(있으면 우선) → ② 없으면 Kakao **키워드 검색**(`query=학교명`, **지역/반경 제한 없음**) → ③ 그래도 실패하면 하드코딩된 부산 서구 좌표(§2 참고) |
| 아파트 좌표 소스 | `ApartmentMaster` **아님** — 학교 좌표 기준 반경 1500m 이내 Kakao 키워드 검색("아파트")으로 매번 실시간 재검색. 즉 이 목록의 "아파트"는 DB의 정제된 단지 데이터가 아니라 Kakao POI 원본이다 |
| 계산식 | `@turf/turf`의 `distance(schoolPoint, aptPoint, { units: 'kilometers' })` — Haversine 기반 대권거리(great-circle), 직선거리 |
| 도보시간 변환 | `realDistance = dist_km * 1.45` (도로거리 보정 계수) → `walkMin = round(realDistance * 15)` (분당 도보속도 역산) → `dist>0.1km`면 `+4분`, `dist>0.5km`면 `+3분` 추가 → 최소 3분 |
| UI 라벨 | `"도보 약 ${walkMin}분"` — **직선거리 기반 추정치를 실제 도보시간처럼 그대로 노출** |

과거에는 학교명에 "송도"가 포함되면 `walkMin+5`를 추가로 더했다(코드 주석에 "특정
지형(송도) 언덕 페널티 보정"이라고 남아있음). 이 보정은 **이미 제거됐다** — 학교
이름 문자열 매칭으로 그 학교 인근 모든 아파트에 획일 적용되고, 실측 경사 데이터가
아닌 임의 추정치였다는 이유. 다른 숫자로 대체하지도 않았다. (§2 확인 사항)

### 파이프라인 C — AI 검색 조건검색("초등학교 가까운 단지")

| 항목 | 내용 |
|---|---|
| 파일 | `src/lib/ai-search.ts` `findNearestElementarySchool()` |
| 입력 좌표 | `Transaction.lat/lng` (실거래 매물 좌표) |
| 학교 좌표 소스 | Kakao Local 카테고리 검색(`SC4`, 반경 **500m**, `sort=distance`) |
| 계산식 | Kakao `distance` 필드 그대로(직선거리) |
| 도보시간 변환 | `walkMinutes = Math.max(1, Math.ceil(distanceM / 80))` — 분당 80m 가정, 보정계수 없음 |

### A/B/C 비교 — 같은 거리, 다른 "도보 N분"

파이프라인 B와 C는 **둘 다 Kakao 직선거리를 원천으로 쓰면서도 서로 다른 도보시간
공식**을 쓴다. 실제 DB 좌표로 확인한 표본(§7)의 직선거리를 두 공식에 그대로
대입하면:

| 직선거리 | B 공식(`도보 약 N분`, `/school/[id]`) | C 공식(`ai-search.ts`) |
|---|---|---|
| 210m | 9분 | 3분 |
| 372m | 12분 | 5분 |
| 498m | 15분 | 7분 |
| 602m | 20분 | 8분 |
| 700m | 22분 | 9분 |

같은 700m 직선거리를 놓고 어느 화면에서 보느냐에 따라 "도보 9분"과 "도보 22분"이라는
2배 이상 차이 나는 숫자가 나온다. 두 공식 모두 실측 보행경로가 아닌 **자체 추정 공식**이고,
서로 캘리브레이션 근거를 공유하지 않는다. B 공식의 700m→22분은 환산 시속 약 1.9km/h로
비현실적으로 느리고, C 공식의 700m→9분은 환산 시속 약 4.7km/h로 성인 빠른 걸음
수준이다. 어느 쪽도 "이집이 실제로 측정한 도보시간"이 아니다.

---

## 2. Seo-gu(서구) 하드코딩 폴백 — 재검증 결과: **아직 존재함**

**파일**: `src/app/api/school/apartments/route.ts:102, 129-137`

```ts
let schoolCoords: [number, number] = [129.0225, 35.0772]; // Default (송도)
...
if (schoolCoords[0] === 129.0225) {
  if (schoolName includes 대신/경남/부경/중앙/구덕/동신/화랑) → [129.015, 35.115]  // 대신동 일대
  else if (schoolName includes 송도/천마/알로이시오)        → [129.022, 35.075]  // 송도동 일대
  else if (schoolName includes 초장/남부/아미/토성)          → [129.010, 35.100]  // 충무동 일대
}
```

- **조건**: URL에 `lat`/`lng`가 없고(=`/school` 목록 페이지에서 진입할 때 실제로 항상
  이 조건이다, §1-B 참고), Kakao 키워드 검색이 실패(0건/네트워크 오류/키 없음)했을 때.
- **영향범위**: `schoolName`에 특정 문자열이 없으면 **부산 서구 송도동 좌표
  [129.0225, 35.0772]가 전국 어느 학교든 그대로 사용된다.** 다른 지역(예: 해운대구,
  기장군) 학교인데 Kakao 검색이 실패하면 서구 좌표로 "인근 아파트" 검색이 수행돼
  완전히 엉뚱한 아파트 목록이 나올 수 있다.
- **KAKAO_MAP_API_KEY 환경변수 자체가 없는 경우**는 `else if (kakaoKey)` 분기를
  전혀 타지 않아 동 단위 보정조차 없이 원본 송도 좌표 그대로 쓰인다.
- **왜 존재하는지**: 이 라우트의 최초 개발·검증 표본이 부산 서구 지역이었던 것으로
  보이며(주석의 "기존 유지" 표현), 이후 다른 지역으로 확장하면서 폴백 좌표를
  전국 단위로 일반화하지 않은 채 남았다.
- **분류**: **BLOCKER 후보** — Kakao API 실패라는 흔한 상황에서 사용자에게 잘못된
  지역의 아파트 목록을 보여줄 수 있다. 단, 이번 STEP에서 제거하지 않는다(지시사항).

### 추가 확인 — 별도 하드코딩 스크립트 (repo root, `fix_coords.ts` / `fix_songdo_coords.ts`)

이 두 스크립트는 서구/송도 하드코딩과는 성격이 다른, **더 심각한 별도 문제**다.

```ts
// fix_coords.ts
'대신롯데캐슬': [129.0115, 35.1165],   // 중앙여중 바로 코앞으로 조정 (도보 3분 거리 셋팅)
'대신푸르지오': [129.0145, 35.1165],   // 대신롯데캐슬 그 다음 거리
'대신해모로센트럴': [129.0170, 35.1150], // 동대신역비스타동원보다 더 가깝게 세팅
'동대신역비스타동원': [129.0200, 35.1140], // 더 멀게 세팅
```
```ts
// fix_songdo_coords.ts
'송도자이르네디오션': [129.0229, 35.0828], // 송도중학교 기준 가장 가깝게 배치 (도보 3분)
'송도탑스빌': [129.0224, 35.0810],
'힐스테이트이진베이시티': [129.0224, 35.0790],
```

- 두 스크립트 모두 `prisma.transaction.update()`로 **실거래(`Transaction`) 테이블의
  `lat`/`lng`를 직접 덮어쓴다.**
- 주석이 "도보 3분 거리 셋팅", "더 멀게 세팅"이라고 명시한다 — 좌표 오류를 바로잡는
  게 아니라 **특정 학교 대비 특정 아파트 7곳의 상대적 거리 순위를 손으로 지어낸
  것**이다. 실측 지오코딩 결과가 아니다.
- repo 루트에 있고(정식 `scripts/` 폴더 밖) 1회성 실행 스크립트로 보인다 — 이미
  프로덕션 DB에 이 값이 반영됐는지는 이번 감사에서 DB write 없이는 확인 불가
  (해당 7개 단지의 현재 `Transaction.lat/lng` 값을 조회하면 판별 가능하나, 이번
  STEP은 감사 목적의 read조차 §19 범위를 넘길 수 있어 보류).
- **분류**: **BLOCKER** — "학교거리 임의 보정 금지" 원칙(CLAUDE.md 원칙4 "데이터가
  없으면 임의의 값을 생성하지 않는다"와 정면 충돌)을 위반한 이력이 코드로 남아있다.
  프로덕션에 반영됐는지 별도로 확인하고, 반영됐다면 해당 7개 단지 좌표를 정식
  지오코딩으로 재확보해야 한다. 이번 STEP에서는 제거/수정하지 않는다.

---

## 3. 아파트 좌표 provenance

`ApartmentMaster.latitude/longitude/geocodeQuality`:

```prisma
// 좌표 — Kakao geocoding만 원천(M2 §I). area_only(행정구역 대표좌표)는 저장하지 않는다.
latitude       Float?
longitude      Float?
geocodeQuality String? @map("geocode_quality") // 'exact' | 'normalized' | 'failed'
```

- **출처**: Kakao 주소 geocoding 단일 원천. `geocodeQuality`는 지오코딩 신뢰도 등급이지
  좌표가 가리키는 지점의 종류(건물 중심/출입구/대표점)를 말하는 게 아니다.
- **의미(semantics) 판정**: **주소 대표점(대략 건물 중심)** — Kakao 주소 검색 API가
  반환하는 지번/도로명 주소의 대표좌표다. **아파트 출입구 좌표가 아니다.** 대단지는
  출입구가 여러 개이고 실제 도보 시작점이 대표주소점과 수십~수백m 떨어질 수 있다.
- `score-geocode-recovery` 브랜치에서 복구한 좌표도 동일하게 Kakao 주소 지오코딩
  결과이며, "출입구 좌표"로 재해석하면 안 된다는 원칙은 그대로 유지된다.
- 파이프라인 A(Score)는 이 좌표를 그대로 Kakao 카테고리 검색의 중심점으로 쓴다.
  파이프라인 B는 애초에 `ApartmentMaster`를 쓰지 않는다(§1 참고).

---

## 4. 학교 좌표 provenance

`School.latitude/longitude/coordinateSource/coordinateType`(`CoordinateType` enum:
`OFFICIAL_POINT | ADDRESS_GEOCODE | ENTRANCE | CENTER | UNKNOWN`, 기본값 `UNKNOWN`)이
스키마에 이미 존재한다. **그러나 NEIS 학교 마스터 적재 스크립트
(`scripts/education/ingest-schools-neis.ts`)는 좌표/coordinateSource/coordinateType
관련 필드를 전혀 다루지 않는다** — grep으로 위도·경도·좌표 관련 키워드가 0건 확인됨.
같은 이유로 `register-neis-school-source.ts`, `verify-school-normalization.ts`에도
좌표 처리 로직이 없다.

**결론**: 현재 `School` 테이블의 `latitude/longitude`는 (적재됐다면) 값이 없거나
`coordinateType`이 기본값 `UNKNOWN`으로 사실상 미사용 상태다. **학교 상세페이지가
실제로 쓰는 학교 좌표는 DB가 아니라 매 요청마다 실시간 Kakao Local 키워드 검색
결과다**(§1-B). 이 키워드 검색은 지역(lawdCd)으로 스코핑되지 않는다 — 동명 학교가
전국에 여러 곳 있으면(예: "중앙초등학교") 엉뚱한 지역의 학교가 매칭될 위험이
구조적으로 존재한다(과거 아파트명 충돌·Naver 스크래핑 지역 불일치 버그와 동일한
패턴).

**기존 감사와의 교차검증**: `SCHOOL-V2-B-official-source-verification.md`의 학교알리미(NEIS)
필드 표(462행)에는 좌표 컬럼 자체가 없다 — 즉 **학교(초중고) 공식 API가 좌표를
제공하는지 여부조차 그 감사에서 확인되지 않았다.** (참고로 같은 문서에서 어린이집
전국 API(`15101155`)는 좌표 필드가 명시적으로 **확인됨**, 유치원은 **UNKNOWN**으로
남아있다 — §13 참고.)

- **판정**: 학교 좌표는 (a) 공식 학교 DB 필드가 아니라 (b) Kakao POI 키워드/카테고리
  검색 결과 — 즉 **Kakao 자체의 대표점(주소 또는 POI 등록 지점)**이다. 정문 좌표가
  아니다. "학교 정문 기준"이라는 표현은 현재 근거가 없어 사용할 수 없다.

---

## 5. 계산 수학적 정의

| 파이프라인 | 함수 | 종류 | 단위 |
|---|---|---|---|
| A (Score) | Kakao Local API 응답의 `distance` 필드 | STRAIGHT_LINE_DISTANCE(Kakao 내부 알고리즘, 비공개 — 직선거리로 취급) | m |
| B (`/school/[id]`) | `@turf/turf` `distance()` | STRAIGHT_LINE_DISTANCE(Haversine 대권거리) | km→m 환산 |
| C (AI 검색) | Kakao Local API 응답의 `distance` 필드 | STRAIGHT_LINE_DISTANCE(A와 동일 방식) | m |

**세 파이프라인 모두 `ROAD_DISTANCE`나 `WALKING_ROUTE_DISTANCE`를 계산하지 않는다.**
B는 `ESTIMATED_WALKING_DISTANCE`(1.45배 보정)를 파생시키지만, 이 보정계수 1.45가
어디서 왔는지 코드/커밋/문서 어디에도 근거가 없다(임의 상수로 판단).

**현재 이집이 실제로 제공 가능한 단계**: `STRAIGHT_LINE_DISTANCE`뿐이다.
`WALKING_ROUTE_DISTANCE`를 표시할 근거는 어디에도 없다.

---

## 6. 도보시간 계산 감사

| 공식 | 위치 | 산식 | 보정계수 근거 |
|---|---|---|---|
| B | `api/school/apartments/route.ts` | `round(dist_km*1.45*15) + (dist>0.1km?4:0) + (dist>0.5km?3:0)`, 최소 3분 | **없음** — 1.45, 15, +4, +3, 최소3 모두 코드/커밋에 근거 설명 없는 매직넘버 |
| C | `ai-search.ts` | `ceil(dist_m/80)`, 최소 1분 | 분속 80m(시속 4.8km) 가정 — 근거 문서화 없음, 다만 B보다는 단순하고 계산이 일관됨 |

**과도 여부 판단**: 두 공식 다 과도하다. 실제 보행경로가 아닌 직선거리에 임의
보정을 얹어 "도보 약 N분"이라는 **확정적 시간 표현**으로 내보내는 것은, 부모가
"우리 아이가 실제 몇 분 걸어간다"고 오인할 근거를 제공한다. 특히 B는 언덕/철도/
하천 같은 장애물이 있는 케이스에서 실제보다 짧게도, 길게도 틀릴 수 있는데 사용자는
그 불확실성을 알 방법이 없다.

**대안(권고, 이번 STEP에서 미적용)**:
- LEVEL B 데이터(직선거리만 확보)에서는 "도보 N분" 대신 "직선거리 약 620m" 또는
  "거리 약 620m(직선 기준, 실제 이동 경로는 다를 수 있음)"로 표기.
- §11에서 레벨별 표기 원칙을 구체화한다.

---

## 7. 실제 사례 비교 — 10개 표본 (실측 DB 좌표 기반, 직선거리만)

`ApartmentMaster`에서 지역별로 `geocodeQuality='exact'`인 실제 단지를 뽑아, 프로덕션
파이프라인 A와 동일한 방식(Kakao `SC4` 카테고리 검색, 반경 1000m)으로 가장 가까운
초등학교와의 **Kakao 직선거리**를 실시간 조회했다(아파트당 1회 호출, 총 10회 —
read-only, "대량 호출" 아님). 스크립트: `scripts/education/c5-sample-distance-audit.ts`.
**보행 분(walking minutes)은 추측하지 않았다** — route API를 쓰지 않았기 때문이다.

| 지역 | 아파트(동) | 좌표 | 최인접 초등학교 | 직선거리 | 왜곡 위험(지리적 판단, 실측 아님) |
|---|---|---|---|---|---|
| 서구-1 | 대진골든빌리지(서대신동2가) | 35.1112, 129.0135 | 동신초등학교 | 498m | 서대신동 일대는 경사지 — 직선거리보다 실제 도보 경사/거리 증가 가능성 |
| 서구-2 | 서대신부백더자연애아파트(서대신동1가) | 35.1093, 129.0167 | 부민초등학교 | 372m | 구덕로 등 간선도로 횡단 필요 가능성 |
| 해운대구-1 | 스카이맨션(중동) | 35.1612, 129.1723 | 해운대초등학교 | 700m | 해안 지역, 관광지 도로 구조로 우회 가능성 |
| 해운대구-2 | 에이스빌라(중동) | 35.1595, 129.1775 | 해송초등학교 | 602m | 좌동 신시가지와 구시가지 경계 — 도로 구조 상이 |
| 부산진구-1 | 현대2차(양정동) | 35.1720, 129.0655 | 양성초등학교 | 210m | 근접, 왜곡 위험 낮음 |
| 동래구-1 | 신화타워(온천동) | 35.2139, 129.0795 | 온천초등학교 | 554m | 온천천 인접 — 하천 도하 지점 제한 가능성 |
| 사하구-1 | 스마트더블유(장림동) | 35.0801, 128.9764 | 장림초등학교 | 206m | 근접, 왜곡 위험 낮음 |
| 강서구-1 | 극동스타클래스(명지동) | 35.0830, 128.9012 | 명호초등학교 | 242m | 명지신도시 격자형 도로 — 직선≈도로 근사 양호 추정 |
| 기장군-1 | 부강빌라가동(기장읍 대라리) | 35.2362, 129.2122 | 대청초등학교 | 226m | 읍 지역 저밀도, 도로 구조 확인 필요 |
| 수영구-1(기타) | 부산더샵센텀포레(민락동) | 35.1651, 129.1241 | 민안초등학교 | 340m | 근접, 왜곡 위험 낮음 |

"왜곡 위험" 열은 동/지형 이름 기반의 **정성적 판단**이며, 실제 도로 네트워크로
검증한 값이 아니다 — route API 없이 실제 왜곡 폭을 수치화하는 것은 지시사항(§7 마지막
줄 "실제 보행분을 추측해서 기록하지 말 것")에 위배되므로 하지 않았다.

**같은 표본에 현재 프로덕션 공식(B, C)을 적용하면** — 다시 확인되는 A/B/C 불일치
(700m 사례: B=22분, C=9분)는 §1 표와 동일하다.

---

## 8. 도보/경로 provider 조사 (공식 문서 기준, 미확인 항목은 명시)

| Provider | 도보경로 지원 | 확인 사항 | 미확인/추가 확인 필요 |
|---|---|---|---|
| **Kakao Mobility 도보 길찾기**(`developers.kakaomobility.com/affiliate/walking/directions`) | 있음(제품 페이지 존재) | **"해당 API는 제휴 파트너 전용 API입니다. 사용을 위해서는 사전 제휴 계약이 필요합니다"** — 공식 페이지 원문 확인. 경유지 최대 5개, REST API 키 필요 | 가격/quota/캐싱·저장 허용 여부는 페이지에 없음 — "제휴 문의" 별도 절차. **EXTERNAL_VERIFICATION_REQUIRED**(파트너 계약 후에만 확인 가능) |
| **NAVER Cloud Platform Maps Directions 5**(`apidocs.ncloud.com`) | 있음(제품 설명상 자동차/도보 등 경로 유형 포함) | 1차 문서 페이지가 JS 렌더링이라 이번 조사에서 직접 fetch 실패(`ECONNREFUSED`) — **웹검색 스니펫 근거로 "건당 약 5원" 언급을 확인했으나 1차 문서로 재확인 못함** | 정확한 가격/무료 quota/도보 옵션 유무/caching 정책은 **EXTERNAL_VERIFICATION_REQUIRED** — 콘솔 로그인 후 재확인 필요 |
| **TMAP Open API 보행자 경로**(`tmapapi.tmapmobility.com`, SK Open API) | 있음(제품 페이지에 "보행자 경로 안내" 메뉴 명시 확인) | 상업 이용 상품 존재(웹검색 스니펫: 정액제 월 220만원 또는 종량제) | 페이지가 JS 렌더링이라 caching/저장 허용, rate limit, server-side 호출 가능 여부는 1차 문서에서 확인 못함 — **EXTERNAL_VERIFICATION_REQUIRED** |
| **공공데이터포털(data.go.kr) 보행자 경로** | **확인 안 됨** | data.go.kr에서 국토교통부/지자체가 제공하는 독립적인 "보행자 길찾기" 오픈API를 이번 조사에서 특정하지 못함. 검색된 "보행자 길찾기 API"는 `data.nsdi.go.kr`(국가공간정보포털 오픈마켓, 준상업 성격)의 것으로 data.go.kr 표준 무료 오픈API가 아님 | 존재 여부 자체가 **EXTERNAL_VERIFICATION_REQUIRED** |
| **학구도안내서비스**(`schoolzone.emac.kr`) | 경로 API 아님 — 학교 위치 점 좌표 + 통학구역 폴리곤(SHP/CSV) 제공 | `SCHOOL-V2-B-official-source-verification.md` §4-1에서 이미 확인: "학교 위치, 통학구역, 학구·학군, 학교군... 공공데이터 개방" | 도보경로 provider는 아니지만 §12(학교 좌표 정확도 개선)의 유력 후보 |

**추측 금지 원칙에 따라**: 실제 가격/quota/caching 조건이 1차 문서로 확인되지 않은
항목은 표에 **EXTERNAL_VERIFICATION_REQUIRED**로 명시했다(이 표기는
`school-distance-band.ts` 주석에서 이미 쓰인 이 프로젝트의 기존 관례를 그대로
따른 것). 현재로선 **Kakao Mobility 도보 길찾기가 사전 제휴 계약 필요라는 점만
확정 사실**이고, 나머지 provider는 담당자 문의/콘솔 로그인 후 가격표를 봐야
확정할 수 있다.

---

## 9. "통학 접근성" 개념 정의 — NEARBY_SCHOOL vs ATTENDANCE_ZONE_SCHOOL

현재 코드(3개 파이프라인 전부)는 **전부 `NEARBY_SCHOOL`만 계산한다** —
"이 아파트에서 가장 가까운 학교"이지 "이 아파트가 실제로 배정되는 학교"가 아니다.
배정 학교(학구) 정보는 현재 코드베이스 어디에도 없다.

`SCHOOL-V2-B-official-source-verification.md` §4-1에서 이미 확인된 공식
source(`schoolzone.emac.kr`, 학구도안내서비스)가 `ATTENDANCE_ZONE_SCHOOL` 구현의
후보가 될 수 있다 — 초/중/고 학구·학군 데이터를 SHP(폴리곤)로 제공. 이번 STEP은
이 source를 실제로 연동하지 않는다(§6 C6 후속 제안 참고).

**원칙**: SCHOOL V2 UI에서 "가까운 학교"와 "배정 가능한 학교"는 **반드시 다른
레이블/문구를 쓴다.** 현재처럼 "인근 아파트"·"가장 가까운 초등학교"라는 표현만
쓰는 것은 NEARBY 개념으로는 정확하지만, 부모가 이를 배정 학교로 오인할 위험이
있으므로 향후 UI에서는 "가까운 학교(배정 여부 별도 확인 필요)" 같은 명시적 caveat이
필요하다.

Score의 `school-access-sentence.ts`는 이미 "학교 접근성"(거리)과 "학군/학업성취도"를
분리하는 원칙(§35 금지어휘)을 지키고 있다 — 이 원칙에 "배정 여부"까지 추가하면 된다.

---

## 10. SCHOOL V2 거리 데이터 모델 제안 (스키마 마이그레이션 없음)

```ts
interface SchoolDistanceInfo {
  distanceMeters: number | null;
  distanceType: 'STRAIGHT_LINE' | 'WALKING_ROUTE' | 'ROAD_ROUTE';

  durationMinutes: number | null;
  durationType: 'ESTIMATED_FROM_STRAIGHT_LINE' | 'ROUTE_CALCULATED' | null;

  apartmentCoordinateType: 'ADDRESS_GEOCODE' | 'ENTRANCE' | 'CENTER' | 'UNKNOWN';
  schoolCoordinateType: 'OFFICIAL_POINT' | 'ADDRESS_GEOCODE' | 'ENTRANCE' | 'CENTER' | 'UNKNOWN';

  routeProvider: string | null; // null = 직선거리만 사용, provider 있으면 provider명
  calculatedAt: string; // ISO timestamp — 캐시된 값의 신선도 판단용
}
```

**현재 구조로 이미 표현 가능한 부분**:
- `apartmentCoordinateType`은 사실상 항상 `ADDRESS_GEOCODE`(§3)로 고정 가능 — 마이그레이션
  불필요, 상수로 채워도 됨.
- `schoolCoordinateType`은 **`School.coordinateType` 컬럼이 스키마에 이미 존재한다**
  (`CoordinateType` enum, §4) — 마이그레이션 불필요. 다만 현재 어떤 ingestion
  스크립트도 이 값을 채우지 않아 항상 기본값 `UNKNOWN`이다. **채우는 로직 추가는
  스키마 변경이 아니라 코드 변경**이라 이번 STEP 범위 밖(후속 C5-B).
- `distanceType`/`durationType`/`routeProvider`/`calculatedAt`은 현재 API 응답
  구조체에 없는 필드 — DB 컬럼이 아니라 **API 응답 타입에 추가하는 것**이므로
  마이그레이션 없이 가능(파이프라인 B/C의 리턴 객체 확장).

**future extension(이번 STEP 미적용)**: route provider 연동 시 `ROUTE_CALCULATED`
결과를 캐싱하려면 `ApartmentLocationFeature`류의 raw-feature 캐시 테이블에 준하는
별도 캐시 테이블(예: `SchoolRouteCache`)이 필요할 수 있다 — 스키마 설계는
C5-C(§17)에서 다룬다.

---

## 11. UI 표시 원칙 제안 (레벨 A/B/C)

| 레벨 | 데이터 상태 | 표시 예시 |
|---|---|---|
| **LEVEL A** | 실제 route API로 계산된 도보 경로 확보 | `"도보 8분 · 620m"` (provider 표기 가능하면 attribution 포함) |
| **LEVEL B** | 직선거리만 확보(현재 이집의 실제 상태 — A/B/C 3파이프라인 전부 여기 해당) | `"직선거리 약 620m"` 또는 `"거리 약 620m (직선 기준)"` + "실제 통학 경로는 다를 수 있습니다" 캡션. **"도보 N분"이라는 확정적 시간 표현 사용 금지** |
| **LEVEL C** | 좌표 품질 낮음(예: 서구 하드코딩 폴백이 적용된 경우, `School.coordinateType='UNKNOWN'`) | 거리 자체를 숨기거나 `"거리 확인 중"` — 잘못된 좌표로 계산된 그럴듯한 숫자를 보여주는 것보다 안전 |

**핵심 원칙**: 부모가 "우리 아이가 실제 8분 걸어간다"고 오해하지 않도록, **route
API 없이 계산한 값에는 절대 "도보 N분" 표현을 쓰지 않는다.** 현재 파이프라인 B/C가
이 원칙을 위반하고 있다(§1, §6) — 이번 STEP은 이 사실을 기록만 하고 UI를 바꾸지
않는다(지시사항).

---

## 12. 학교 정문 / 아파트 출입구 좌표 개선 가능성

| 우선순위 | 후보 | 상태 |
|---|---|---|
| 1. 공식 source | 학구도안내서비스(`schoolzone.emac.kr`)의 "학교 위치" 포인트 — SHP/CSV로 학구 폴리곤과 연계된 공식 좌표. 학교 **대표 위치**로 보이며 정문 좌표라는 명시적 확인은 없음(§9 재인용) | 검토 가치 있음, 좌표가 정문인지 대표점인지는 **별도 확인 필요** |
| 2. 지도 provider POI | Kakao/Naver 지도의 "학교 정문" 라벨이 붙은 POI가 있는지는 이번 감사에서 검증하지 않음 | UNKNOWN |
| 3. 검증 가능한 entrance point | 없음 — 현재 아무 source도 "이것이 출입구다"라고 검증 가능한 형태로 제공하지 않음 | 없음 |
| 4. 대표 address point | 현재 실제로 쓰이는 방식(Kakao 주소/POI 대표점) | 이미 사용 중, §3·§4 |

**수동 추정(사람이 지도를 보고 좌표를 손으로 찍는 것)은 하지 않는다** — §2의
`fix_coords.ts`/`fix_songdo_coords.ts`가 정확히 이 방식으로 문제를 만든 전례가 있다.
실제 구현은 후속 단계(C5-D)로 미룬다.

---

## 13. 어린이집/유치원 거리 — 공통 모델 재사용 가능성

**이미 재사용 가능한 상태다.** `Kindergarten`과 `Childcare` 모델은 `School`과
**동일한 좌표 provenance 필드 구조**를 스키마에 이미 갖고 있다:

```prisma
model Kindergarten {
  latitude         Float?
  longitude        Float?
  coordinateSource String?
  coordinateType   CoordinateType @default(UNKNOWN)
  ...
}
model Childcare {
  latitude         Float?
  longitude        Float?
  coordinateSource String?
  coordinateType   CoordinateType @default(UNKNOWN)
  ...
}
```

`School`/`Kindergarten`/`Childcare` 세 모델이 `latitude/longitude/coordinateSource/
coordinateType(CoordinateType enum)`을 동일한 shape로 이미 공유하고 있으므로,
§10에서 제안한 `SchoolDistanceInfo`(API 응답 레벨 타입)는 **`EducationFacilityDistanceInfo`로
이름만 일반화하면 그대로 세 기관에 재사용 가능**하다 — 스키마 변경도, 테이블 통합도
필요 없다(기관 identity/table은 요청대로 분리 유지). `SCHOOL-V2-B-official-source-verification.md`
§3-2 확인에 따르면 Childcare는 전국 API에 좌표 필드가 있는 것으로 이미 확인됐고
(§4 재인용), Kindergarten은 UNKNOWN으로 남아있다 — 즉 기관별로 "실제 공식 좌표를
채울 수 있는지"는 다르지만, **채워 넣을 그릇(스키마)은 이미 통일돼 있다.**

---

## 14. Score와의 관계 — SCORE_CURRENT_INPUT vs SCHOOL_UI_DISTANCE

- **SCORE_CURRENT_INPUT**: `ApartmentLocationFeature.nearestElementaryDistanceM`
  (파이프라인 A, §1) — Score V1의 `schoolAccess` 카테고리가 소비하는 유일한 거리 값.
- **SCHOOL_UI_DISTANCE**: 파이프라인 B(`/school/[id]` "인근 아파트" 목록)와 C(AI 검색
  조건검색)가 계산하는 값 — Score와 **완전히 독립**돼 있고 Score에 어떤 영향도
  주지 않는다.
- 이 세 파이프라인은 코드 레벨에서 이미 분리돼 있어 **SCHOOL V2에서 B/C를 route
  기반으로 바꾸더라도 Score V1 계산에는 구조적으로 영향이 없다.** 다만 "같은 화면에
  Score의 정성적 문구와 SCHOOL V2의 정량적 거리가 동시에 노출될 경우" 두 표현이
  모순돼 보이지 않도록(예: Score는 "가까운 편"인데 SCHOOL V2 카드는 다른 학교
  기준으로 "거리 확인 중"이라 나오는 등) UI 설계 시 조율이 필요하다 — 이는 이번
  STEP 범위 밖이며, **Score formula 자체는 변경하지 않는다**(지시사항).

---

## 15. 남은 하드코딩 감사 목록

| # | 내용 | 위치 | 분류 |
|---|---|---|---|
| 1 | 서구 송도 기본 좌표 `[129.0225, 35.0772]` + 대신동/송도동/충무동 동 단위 폴백 | `src/app/api/school/apartments/route.ts:102,129-137` | **BLOCKER**(§2) |
| 2 | 학교별 정확 좌표를 손으로 지정해 특정 아파트 4곳의 상대 거리 순위를 조작 | `fix_coords.ts`(repo root) | **BLOCKER**(§2, 프로덕션 반영 여부 미확인) |
| 3 | 학교별 정확 좌표를 손으로 지정해 특정 아파트 3곳의 상대 거리 순위를 조작 | `fix_songdo_coords.ts`(repo root) | **BLOCKER**(§2, 프로덕션 반영 여부 미확인) |
| 4 | 도보시간 보정계수 1.45 / 분당 15분 / +4분 / +3분 / 최소3분 | `api/school/apartments/route.ts:260-271` | **REMOVE_LATER**(§6, 근거 없는 매직넘버지만 즉시 장애를 일으키진 않음) |
| 5 | 분당 80m 도보속도 가정 | `ai-search.ts:214` | **REMOVE_LATER**(§6, 4번과 별개 공식이라 일관성 문제) |
| 6 | "송도 +5분" 언덕 보정 | 이미 제거됨(코드에 남은 건 제거 사유 주석뿐) | **SAFE**(재발 방지 기록으로 남겨둠) |

---

## 16. Correctness 기준 (문서화)

1. **Provenance 있어야 함** — 모든 거리 값은 좌표 출처(§3, §4)를 추적 가능해야 한다. 현재 위반: 없음(추적은 가능하나 문서화가 안 돼 있었을 뿐 — 이번 문서로 해결).
2. **직선/도보 구분** — §5. 현재 위반: 파이프라인 B가 직선거리 기반 추정을 "도보 N분"으로 라벨링(§1, §6).
3. **Estimated를 actual처럼 표시 금지** — 현재 위반: 파이프라인 B/C(§6).
4. **좌표 없으면 다른 단지/학교로 fallback 금지** — 현재 위반: 서구 하드코딩(§2)이 정확히 이 금지를 어긴다 — 학교 좌표를 못 찾으면 엉뚱한 지역(서구) 좌표로 대체한다.
5. **Ambiguous coordinate 자동 확정 금지** — 현재 위반 위험: 파이프라인 B의 지역 미스코핑 Kakao 키워드 검색(§4)이 동명 학교를 자동 확정할 수 있다.
6. **Nearby ≠ Attendance-zone** — §9. 현재 상태: 셋 다 NEARBY만 계산 — 원칙 위반은 아니지만(둘을 혼동해서 부르지 않음) attendance-zone 자체가 없다.
7. **Route 없으면 정직하게 표현** — 현재 위반: §6 전체.

---

## 17. 후속 구현 단계 제안

- **C5-A** — 필요: `/school/[id]` "도보 약 N분" → "직선거리 약 Nm" 문구 교정(§11 LEVEL B). AI 검색(파이프라인 C)의 `walkMinutes`도 동일 원칙 적용 검토.
- **C5-B** — 필요: `School`(및 `Kindergarten`/`Childcare`) `coordinateType`/`coordinateSource`를 실제로 채우는 ingestion 로직 추가(스키마는 이미 있음, §10/§13). 서구 하드코딩 폴백(§2) 제거를 이 STEP에 묶는 것을 권고 — 좌표를 신뢰 가능한 source로 먼저 확보해야 폴백을 안전하게 없앨 수 있다.
- **C5-C** — 조건부: 실제 walking route provider 파일럿. §8에서 Kakao Mobility는 제휴 계약이 전제라 즉시 착수 불가 — Naver/TMAP 가격 확인(EXTERNAL_VERIFICATION_REQUIRED 해소)이 선행돼야 한다.
- **C5-D** — 낮은 우선순위: 출입구/정문 좌표 정밀화(§12) — 공식 source 자체가 불확실해 C5-B 이후 재검토.
- **C6** — 학구(attendance zone) 연동 — `schoolzone.emac.kr` 실사용 가능성 검증(라이선스/갱신주기/좌표타입 포함, `SCHOOL-V2-B` 수준의 정식 source audit 필요) 후 착수.

---

## 18. 참고: `fix_coords.ts` / `fix_songdo_coords.ts` 조치 필요성

`git log`로 확인한 사실: 두 스크립트 모두 **2026-08-07 커밋 `cb5d606`**
("feat: complete apartment searcher features including stats dashboard")에서
처음이자 마지막으로 추가됐고, 이후 수정·삭제 커밋이 없다 — 전용 "좌표 수정" 커밋이
아니라 더 큰 기능 커밋에 딸려 들어간 것으로 보인다.

이번 STEP에서 제거하지 않았지만, 별도 확인이 필요한 사항으로 명시적으로 남긴다:
이 스크립트가 실제로 실행돼 프로덕션 `Transaction` 테이블에 그 결과가 반영돼
있는지는 git 이력만으로는 알 수 없고 DB 조회가 필요하다 — 이번 감사 범위(§19 명시:
production DB write 금지, 대량 호출 금지) 밖으로 판단해 보류했다. **다음 STEP에서
최우선으로 확인 권고.**
