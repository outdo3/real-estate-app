# SCHOOL V2-C5-A — Misleading Walking Label Correction + Manual Coordinate Production Impact Check

- **STEP**: SCHOOL V2-C5-A
- **Branch**: `school-v2-c5a-distance-label` (worktree `D:/anti2/aaa/e-jip-school-c5a`, base `91a1a8d` = `school-v2-c5-distance-audit`)
- **선행 문서**: [SCHOOL-V2-C5-distance-accessibility-audit.md](./SCHOOL-V2-C5-distance-accessibility-audit.md)(이번 STEP이 바로잡는 문제를 처음 확인한 감사) — 이 문서는 그 감사를 덮어쓰지 않고 후속 조치만 기록한다.

---

## 0. 목적

C5 감사에서 확인된 "직선거리를 도보 N분처럼 표시"하는 misleading UI를 **최소 변경으로** 바로잡는다. 계산 로직(보행경로 provider 도입 등)은 바꾸지 않는다 — 실제로 갖고 있는 값(직선거리)을 그 사실 그대로 보여주는 것까지만 한다. 아울러 C5 감사에서 발견한 `fix_coords.ts`/`fix_songdo_coords.ts` 수동 좌표 조작의 프로덕션 영향을 read-only로 확인한다.

---

## 1. Misleading Walking Location 전수 검색 결과

| # | 파일 | 함수/컴포넌트 | 이전 문구 | 계산 출처 | user-visible |
|---|---|---|---|---|---|
| 1 | `src/app/api/school/apartments/route.ts` | 응답 생성 로직 | `도보 약 ${walkMin}분` (`dist*1.45*15` + 거리별 flat 보정 + 최소 3분) | Turf 직선거리에 임의 보정계수 적용 | YES — `/school/[id]` "인근 아파트" 카드 |
| 2 | `src/app/school/[id]/school-detail-client.tsx` | 카드 렌더 | `{apt.walkTime}` | 위 1번 API 응답 그대로 렌더 | YES |
| 3 | `src/lib/ai-search.ts` `findNearestElementarySchool` | 반환값 생성 | `walkMinutes: Math.ceil(distanceM/80)` | Kakao 직선거리(`distance` 필드) | 간접(아래 4,5로 전파) |
| 4 | `src/app/api/ai-search/route.ts` | Gemini 데이터 요약 문자열 | `까지 도보 약 ${walkMinutes}분(${distanceM}m)` | 위 3번 값 | YES — AI 브리핑 문장에 그대로 반영 |
| 5 | `src/app/ai-search/ai-search-client.tsx` | 조건검색 결과 카드 배지 | `${name} 도보 ${walkMinutes}분` | 위 3번 값 | YES |
| 6 | `src/lib/ai-search.ts` `generateBriefing` 프롬프트 | Gemini 지시문 | "...도보 거리/시간을 함께 언급해라(예: 'OO초등학교까지 도보 약 3분(200m) 거리')" | LLM 지시문 자체가 misleading 표현을 유도 | YES(간접, LLM 출력을 통해) |
| 7 | `src/components/KakaoPlaces.tsx` `formatEta` | 인근 시설 카드(학교·어린이집·유치원 항목) | `도보 약 ${walkMin}분` | Kakao 직선거리 | YES — `/apt/[name]` 학군/주거환경 탭(`SchoolDistrictPanel`, `LivingEnvironmentPanel`) |
| 8 | `src/components/KakaoPlaces.tsx` (학교 전용 안내문) | "초품아" 강조 문구 | "초품아(학세권) 단지로 **도보 통학이 가능한** 거리입니다." | `distance < 300` 임계값 | YES |

**범위 밖으로 확인, 변경하지 않음**:
- `src/lib/apartment-score/server/school-access-sentence.ts`(Score `schoolAccess`) — "도보로 다닐 만한 무난한 거리입니다" 같은 정성적 문구뿐, 분(分) 단위 숫자를 만들지 않음. §7 지시에 따라 미변경.
- `KakaoPlaces.tsx`의 지하철(SW8)/병원/마트/편의점/약국/공원/KTX 항목 — 학교/유치원/어린이집이 아니라 이번 STEP 범위 밖. `formatEta` 자체는 그대로 두고, 항목별로 `category_group_code`가 `SC4`/`PS3`일 때만 다른 문구를 쓰도록 분기했다(§5 참고) — 지하철 "도보 5분 이내의 초역세권" 문구는 그대로 유지.

---

## 2. 수정 원칙 적용

LEVEL B(STRAIGHT_LINE_DISTANCE ONLY) 표시 원칙을 그대로 따랐다:

- `"직선거리 약 {m}m"` 형태로 통일.
- "도보 N분"/"도보 약 N분"/"걸어서 N분" 표현 전부 제거(§1 표의 8곳 전부).
- 과도한 경고문("정확하지 않을 수 있습니다" 류) 없이, 짧은 caveat 한 줄만 사용:
  `/school/[id]` "인근 아파트 단지" 섹션에 "직선거리 기준이며, 실제 통학 경로는 다를 수 있어요."

---

## 3. `/api/school/apartments` 수정

**기존 응답 구조 조사 결과**: 이 API의 유일한 소비자는 `school-detail-client.tsx` 하나뿐임을 grep으로 확인(다른 내부/외부 소비자 없음). 그래도 지시사항대로 breaking change를 최소화하는 방식으로 처리했다.

- `dist * 1.45 * 15` + 거리별 flat 보정(+4/+3분) + 최소 3분 로직 **전체 제거**.
- 신규 필드 추가: `distanceMeters`(number), `distanceLabel`(string, `"직선거리 약 Nm"`).
- 기존 `walkTime` 필드는 **키를 유지**(응답 shape 안 깨짐)하되 값은 `distanceLabel`과 동일한 안전한 문구로 교체, `@deprecated` 주석과 제거 계획을 코드에 남김.
- "인근 아파트 매물 없음" sentinel row(`id:-1`)도 `distanceMeters: null, distanceLabel: '-'`로 동일하게 안전 처리(§6).
- 소비자(`school-detail-client.tsx`)는 `apt.distanceLabel ?? apt.walkTime`로 신규 필드를 우선 사용하도록 전환.

**후속 제거 계획**: 다른 소비자가 없음이 이번 조사로 확인됐으므로, 다음 STEP(C5-B 이후)에서 `walkTime` 필드를 완전히 제거해도 안전하다고 판단되면 제거한다. 이번 STEP에서는 유지.

---

## 4. `ai-search.ts` / AI 검색 파이프라인 수정

- `NearestSchoolInfo.walkMinutes` 필드 제거(캐시 테이블에 저장되지 않는 요청별 계산값임을 확인 — `AiSearchCache`는 이 값을 담지 않아 마이그레이션/캐시 무효화 불필요).
- `findNearestElementarySchool`의 `distanceM/80` 변환 제거.
- Gemini 데이터 요약 문자열(`api/ai-search/route.ts`)과 프롬프트 가드레일(`ai-search.ts`)을 "직선거리 약 Nm"로 수정.
- 조건검색 결과 카드 배지(`ai-search-client.tsx`)를 동일하게 수정.

### 4-1. "도보 N분 이내" 자연어 조건 위험 — 실제 구현 확인 결과

Gemini 분류 스키마(`CLASSIFY_SCHEMA`)에는 **분(分) 단위 숫자를 받는 필드가 없다.** "초품아", "학교 가까운", "도보 10분 이내 학교" 등 어떤 표현이든 전부 `nearElementarySchool: boolean` 하나로만 뭉뚱그려지고, 실제 필터는 항상 고정 `ELEMENTARY_SCHOOL_RADIUS_M = 500m` 반경이다 — 사용자가 말한 구체적 분(分) 숫자를 검증하거나 만족 여부를 응답에서 되짚어 말하는 로직 자체가 없다.

즉 "실제 도보 10분 조건을 만족한다고 판정"하는 코드는 **원래부터 존재하지 않았다** — 정확성 위험은 실재하지만(사용자가 "도보 10분"을 요청했는데 실제로는 고정 500m 직선거리 필터가 적용된다는 점을 사용자가 알 방법이 없었음), 그 위험의 실체는 "허위로 만족을 주장"이 아니라 "사용자의 구체적 요청을 조용히 일반 근접 조건으로 뭉개고, 그 사실을 알리지 않음"이다. 이번 STEP에서 한 일:
- 매칭된 단지를 설명할 때 **항상 실제 직선거리**(`distanceM`)로만 표현하도록 해(§4 위), "N분 조건을 만족했다"는 인상 자체를 제거했다 — 사용자가 "10분"을 요청해도 응답은 "직선거리 약 200m"라고만 말하지, "요청하신 10분 조건을 만족합니다"라고 되짚지 않는다.
- 별도의 `UNSUPPORTED_ROUTE_CONDITION` 같은 명시적 거부/안내 메커니즘은 **적용하지 않았다** — 현재 스키마가 애초에 분(分) 단위 조건을 파싱하지 않아 "지원하지 않는 조건을 지원한다고 잘못 답하는" 경로가 없고, 이런 메커니즘을 새로 만드는 것은 조건 파싱 자체를 확장하는 기능 추가라 이번 "라벨 교정" STEP의 최소 변경 범위를 넘어선다고 판단했다. 코드 코멘트로 이 한계를 명시해뒀다(`ai-search.ts` `nearElementarySchool` 스키마 정의 주변).
- Gemini에게 실제로 전달되는 `description` 문자열(분류 프롬프트)은 **수정하지 않았다** — 코드 주석만 추가했고 모델 분류 동작 자체는 바꾸지 않아, 이번 STEP이 검색 매칭 결과 자체를 바꾸는 일이 없도록 했다.

---

## 5. School Detail / 인근 시설 UI 수정

- `/school/[id]` "인근 아파트 단지" 카드: `직선거리 약 Nm · 가격` + 섹션 상단에 짧은 caveat 한 줄.
- `KakaoPlaces.tsx`: 학교(`SC4`)·어린이집·유치원(`PS3`) 항목만 `(직선거리 약 Nm)`로 표시하도록 개별 아이템 단위로 분기(`isEducationPlace()`). **다른 카테고리(지하철/병원/마트/편의점/약국/공원/KTX)는 완전히 그대로 유지** — 이 컴포넌트가 `/apt/[name]`(APT DETAIL V1, 잠금 상태) 여러 탭에서 공용으로 쓰이기 때문에 학교/유치원/어린이집 항목만 최소로 건드렸다.
- "초품아(학세권) 단지로 도보 통학이 가능한 거리입니다" → "초품아(학세권) — 초등학교와 직선거리 300m 이내인 단지입니다"로 교정("도보 통학 가능"이라는 확정적 주장 제거, "초품아"라는 부동산 용어 자체는 유지 — 이건 근접성을 가리키는 관용 표현이지 검증된 도보시간 주장이 아니다).
- 새 emoji 추가 없음. 기존 디자인 시스템(CSS 모듈, 색상 토큰) 그대로 사용.

---

## 6. 데이터 없는 경우

- `/api/school/apartments`: "인근 아파트 매물 없음" sentinel row는 이미 기존에도 `walkTime:'-', distance:0`으로 처리돼 있었고(0분 표시 없음), 클라이언트가 이 sentinel(`id:-1`)을 필터링해 "반경 1.5km 이내 아파트 정보를 찾지 못했습니다" 빈 상태 메시지로 대체하는 기존 로직을 그대로 유지 — 회귀 없음. `distanceMeters: null, distanceLabel: '-'`를 추가해 일관성만 보강했다.
- AI 검색: `nearestSchool`이 `null`이면(`findNearestElementarySchool`이 500m 이내에서 못 찾으면) 카드에 학교 배지 자체가 렌더되지 않는다(`{c.nearestSchool && (...)}`) — "0m"/"도보 0분" 같은 표시가 애초에 나올 수 없는 구조. 변경 없음, 기존 안전한 패턴 확인만 함.

---

## 7. Score 변경 여부

**변경 없음.** `school-access-sentence.ts`, `school-distance-band.ts`, `explain.ts`, `ApartmentLocationFeature`, `nearestElementaryDistanceM` 전부 미접촉. 회귀 가드 스크립트(§13)가 Score 파이프라인에 도보시간 계산이 유입되지 않았음을 재확인한다.

---

## 8. 서구 하드코딩 폴백

`src/app/api/school/apartments/route.ts:102,129-137`의 `[129.0225, 35.0772]` 기본 좌표 + 대신동/송도동/충무동 동 단위 보정은 **이번 STEP에서 수정하지 않았다.** 위치·영향범위는 C5 감사와 동일함을 재확인(§1 코드가 이번 STEP에서 손대지 않은 채 그대로 남아있음, diff에 포함되지 않음). 좌표 provenance 정리와 함께 C5-B에서 처리한다.

---

## 9. `fix_coords.ts`/`fix_songdo_coords.ts` Production Impact — READ-ONLY 확인 결과

**스크립트**: `scripts/education/c5a-fix-coords-impact-check.ts`(read-only, DB write 없음, 실행 결과는 §16 요약 참고)

7개 대상 단지(`대신롯데캐슬`, `대신푸르지오`, `대신해모로센트럴`, `동대신역비스타동원`, `송도자이르네디오션`, `송도탑스빌`, `힐스테이트이진베이시티`)를 두 테이블에서 확인:

### `Transaction` 테이블 (fix_coords.ts가 실제로 `update()`한 테이블)

- **7개 전부 현재 row가 존재하지 않는다.**
- 더 나아가 확인한 결과 **`Transaction` 테이블 자체가 현재 총 0행**이다(`prisma.transaction.count() === 0`).
- `src/` 전체를 grep한 결과 **`prisma.transaction`을 참조하는 코드가 어디에도 없다** — 이 모델은 현재 어떤 라우트/컴포넌트에서도 쓰이지 않는 완전한 dead table이다.
- 결론: **7건 전부 UNKNOWN이 아니라 확정적으로 "현재 영향 없음"** — 애초에 이 테이블을 읽는 프로덕션 코드 경로가 없고, 테이블 자체가 비어 있다.

### `ApartmentMaster` 테이블(Score/거리 파이프라인이 실제로 쓰는 테이블 — `fix_coords.ts`가 건드린 적 없음)

- 7개 이름 중 2개만 존재: `대신롯데캐슬`(aptSeq `26140-1164`), `송도탑스빌`(aptSeq `26140-106`).
- 둘 다 `geocodeQuality`가 `exact`/`normalized`이고 `updatedAt`이 `2026-08-13`(score-geocode-recovery 작업 시점으로 추정)이며, **좌표 값이 `fix_coords.ts`/`fix_songdo_coords.ts`의 하드코딩 값과 다르다**:
  - 대신롯데캐슬: 하드코딩 (129.0115, 35.1165) vs 현재 ApartmentMaster (129.0098, 35.1155)
  - 송도탑스빌: 하드코딩 (129.0224, 35.0810) vs 현재 ApartmentMaster (129.0186, 35.0781)
- 나머지 5개 이름은 ApartmentMaster에 아예 존재하지 않는다.

### 분류(§9 요청)

| 단지 | Transaction 상태 | ApartmentMaster 상태 | 분류 |
|---|---|---|---|
| 대신롯데캐슬 | 없음(테이블 자체 0행) | 존재, 좌표 다름(exact) | **NO_PRODUCTION_IMPACT** |
| 대신푸르지오 | 없음 | 없음 | **NO_PRODUCTION_IMPACT** |
| 대신해모로센트럴 | 없음 | 없음 | **NO_PRODUCTION_IMPACT** |
| 동대신역비스타동원 | 없음 | 없음 | **NO_PRODUCTION_IMPACT** |
| 송도자이르네디오션 | 없음 | 없음 | **NO_PRODUCTION_IMPACT** |
| 송도탑스빌 | 없음 | 존재, 좌표 다름(normalized) | **NO_PRODUCTION_IMPACT** |
| 힐스테이트이진베이시티 | 없음 | 없음 | **NO_PRODUCTION_IMPACT** |

**MANUAL_COORDINATE_PRESENT: 0건, CURRENT_GEOCODE_DIFFERENT(참고, ApartmentMaster 기준): 2건(위 표), UNKNOWN: 0건.**

### DB 환경 SAME/DIFFERENT 판정

이 저장소의 `.env`에 `DATABASE_URL` 정의가 단 하나뿐이고(`.env.local`엔 별도 override 없음, 값 비교로 확인), 별도의 local/dev 전용 DB 설정이 코드베이스 어디에도 없다 — 이 프로젝트는 로컬 개발과 배포 양쪽에서 동일한 Supabase 인스턴스를 쓰는 구조로 보인다. 다만 **Vercel에 실제로 설정된 `DATABASE_URL` 값 자체를 대시보드에서 직접 대조하지는 못했다**(접근 권한/도구 범위 밖) — 그래서 "이 read-only 쿼리가 실제 Vercel 프로덕션과 100% 동일한 인스턴스를 봤다"는 것은 **UNKNOWN**으로 남긴다(정황상 SAME일 가능성이 높지만 암호학적으로 확인하지 않았다).

### `updatedAt` 확인 가능 여부

`Transaction` 모델에는 `updatedAt` 컬럼이 없다(schema.prisma 확인, `id/rank/name/price/priceChange/changeType/typeLabel/info/lat/lng/createdAt`뿐). §9의 "updatedAt 가능하면"이라는 조건이 이번 케이스에서는 성립하지 않아 확인하지 못했다 — 다만 테이블 자체가 0행이라 실익은 없다.

---

## 10. 수동 좌표 영향 범위 계산

MANUAL_COORDINATE_PRESENT가 0건으로 확인돼(§9), `ApartmentLocationFeature`/`nearestElementaryDistanceM`/Score 순위에 대한 추가 영향 분석은 **불필요**하다고 판단해 진행하지 않았다. "정상 좌표를 추정해서 비교하지 말 것"이라는 지시대로, ApartmentMaster의 현재 좌표를 "정답"으로 가정하지 않고 단지 "하드코딩 값과 다르다"는 사실만 기록했다(§9 표) — 어느 쪽이 더 정확한지는 이번 STEP에서 판단하지 않는다.

---

## 11. UI Regression 확인

로컬 dev 서버(`next dev`, read-only DB 조회만) 기준으로 확인:

| 지역 | 학교 | BEFORE(구코드 기준) | AFTER(실제 응답, 이번 STEP) |
|---|---|---|---|
| 서구 | 구덕초등학교 | `도보 약 N분` | `직선거리 약 72m`(유진대림아파트), `직선거리 약 121m`(화인아파트) 등 |
| 서구 | 대신초등학교 | `도보 약 N분` | `직선거리 약 193m`(대신롯데캐슬아파트) 등 |
| 해운대구 | 해운대초등학교 | `도보 약 N분` | `직선거리 약 101m`(쌍용더플래티넘해운대아파트) 등 |
| 해운대구 | 해송초등학교 | `도보 약 N분` | `직선거리 약 195m`(현대아파트) 등 |
| 동래구(기타) | 온천초등학교 | `도보 약 N분` | `직선거리 약 130m`(온천삼익아파트) 등 |
| 사하구(기타) | 장림초등학교 | `도보 약 N분` | `직선거리 약 174m`(사하장림역스마트W아파트) 등 |

6개 표본 전부 `distance`(km) 값 자체는 변경 전과 동일(같은 Turf 계산 그대로) — **의미(semantics) 표현만 정확해졌고 거리 데이터 자체는 바뀌지 않았다.**

브라우저로도 직접 확인:
- `/school/1?...` 페이지: "📌 인근 아파트 단지" 아래 "직선거리 기준이며, 실제 통학 경로는 다를 수 있어요." caveat + 각 카드 "직선거리 약 1070m · 5억 9,800만" 형태로 정상 렌더.
- `/ai-search`에서 "부산 서구 초품아 아파트 찾아줘" 실제 질의 → AI 브리핑 문장이 "남부민초등학교까지 직선거리 약 160m" 등으로 정확히 생성됨(Gemini가 실제로 수정된 가드레일을 따름, 하드코딩 예시가 아니라 실제 LLM 응답으로 확인) — 카드 배지도 "부민초등학교 직선거리 약 444m" 등으로 정상.

---

## 12. UX 원칙 준수

- 짧고 담백한 caveat 한 줄만 사용, "정확하지 않을 수 있습니다"류 과도한 경고 없음.
- "초품아" 같은 기존 긍정적 표현은 유지하되, 검증되지 않은 "도보 통학 가능" 단정만 제거.
- 새 emoji 추가 없음.

---

## 13. 남은 한계 (C5-B로 이월)

- 서구 하드코딩 폴백 좌표(§8) — 미제거.
- 학교 좌표가 여전히 실시간 Kakao 검색/폴백 기반(공식 provenance 없음) — C5 감사 §4 그대로.
- "도보 N분 이내" 자연어 조건이 여전히 고정 500m로 뭉뚱그려지는 구조적 한계(§4-1) — 이번 STEP은 결과 표현만 정직하게 만들었고, 조건 파싱 자체의 정밀화는 하지 않음.
- `fix_coords.ts`/`fix_songdo_coords.ts` 자체는 여전히 repo root에 남아있음(제거하지 않음, 이번 STEP은 영향 확인만) — 정리는 C5-B 이후 판단.
