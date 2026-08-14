# 이집 분양 상세 — 주변 아파트 실거래 비교 UI — PRESALE P2-D4-B3

작성일: 2026-08-14
성격: P2-D4-B1(주변 ApartmentMaster 검색 API, 문서17)·B2(실거래 연결·가격비교 API, 문서18)가 이미 확정한 데이터/계산 정책을 그대로 사용하는 **UI 구현 전용** STEP. B1/B2의 API 응답 구조·계산 로직·정책은 이번 STEP에서 전혀 변경하지 않았다. Prisma schema/migration 변경 없음, 신규 package 설치 없음.

**상태: 구현 완료 / 사용자 최종 승인 (2026-08-14).**

## 0. 최종 승인 기록 (2026-08-14)

PRESALE P2-D4-B3는 사용자 모바일 최종 검수 결과 **완료 / 사용자 최종
승인**으로 확정됐다. 이 승인은 B3 최초 구현(이 문서) 단독이 아니라,
아래 전체 이력을 포함한다 — 과거 문제를 없었던 것처럼 정리하지 않고
그대로 보존한다.

- P2-D4-B1(문서17) — 주변 ApartmentMaster 반경 검색 API 구현
- P2-D4-B2(문서18) — houseTy BLOCKER 발견 → B2-FIX(비교용 exclusiveArea
  정책 확정, 「주택공급에 관한 규칙」 제21조제5항 근거) → B2-CONTINUE
  (±1㎡ 유사면적 기준 강화) → 실거래 연결/가격비교 API 확정
- P2-D4-B3(이 문서) — 주변 아파트 실거래 비교 UI 최초 구현, 모바일
  실기기 검수 착수
- **모바일 실기기 검수에서 발견**: 같은 페이지 안에 기존 "주택형·분양가"
  섹션의 `supplyArea` 기반 표시(예: "79.48㎡ B")와 B3 chip의
  `exclusiveArea` 기반 표시(예: "60㎡ B")가 동시에 존재해 사용자가 서로
  다른 주택형으로 오인할 수 있는 문제 발견
- P2-D4-B3-FIX(문서22) — 두 개념을 UI에서 명확히 분리(대표 표시는
  `supplyArea`, 비교용은 "비교 전용면적" 보조 문구), 같은 미커밋
  작업 위에서 "최근 거래 중앙값" → "최근 거래 대표가격" 문구 개선
  (계산 로직 무변경) 추가
- INFRA I1/I2-A — B3와 별개로 병행 진행된 production DB 연결 안정성
  조사 및 관측성(logging) 보강(문서20/21) — B3 코드와 직접적 인과관계는
  낮다고 판단됨(문서20 §11 참고)
- commit `0d00047`(INFRA I1/I2-A) → commit `398d33a`(B3-FIX, "fix: align
  presale market comparison labels") → production 배포 확인 →
  사용자 모바일 최종 검수 → **최종 승인**

**최종 승인 근거**:
- B3 구현 완료(이 문서 §1~21)
- B3-FIX 완료(문서22, 표시 일관성 문제 해결)
- production 배포 확인(commit `398d33a`, `supplyArea` 필드 응답에서
  실측 확인)
- 사용자 모바일 최종 검수 완료(이상 없음)
- 주택형 표시 혼란 해결(공급면적 기반으로 기존 상세 UI와 통일)
- "최근 거래 대표가격" 용어 개선 완료
- 기존 B2 계산 정책(houseTy parser/±1㎡/aptSeq/6→12→24개월 fallback/
  median/differenceAmount) 전혀 무손상
- B1/B2 API 기능 무손상(breaking change 없음, `supplyArea` additive
  필드만 추가)
- DB/schema/migration 변경 없음

---

## 1. 목적

`/presales/[id]` 상세페이지에 "주변 아파트 실거래 비교" 섹션을 추가해, 사용자가 다음 3가지 질문에 즉시 답할 수 있게 한다.

1. 내가 관심 있는 분양 주택형은 얼마인가?
2. 주변 비슷한 전용면적 아파트는 실제 얼마에 거래됐는가?
3. 두 가격은 객관적으로 얼마 차이 나는가?

## 2. 범위

- UI 구현만 한다. B1(`/api/presales/[id]/nearby-apartments`)·B2(`/api/presales/[id]/nearby-market`) API는 코드 변경 없음(읽기만 함).
- B4(지도), M4-C, 재개발, 커뮤니티, 전국 확장, SEO, 새로운 추천 알고리즘, AI 가격평가, 평당가, 투자점수, 호재/악재 판정은 이번 STEP에서 다루지 않는다.

## 3. 사전 확인

- git branch: main, working tree clean, origin/main과 동일 커밋(`5e3397f`)에서 시작.
- 필수 문서(16/17/18/09번, CHANGELOG.md, DECISIONS.md) 전부 확인 후 구현했다.
- 실제 `/api/presales/479/nearby-market` 등 응답을 로컬 dev 서버로 직접 호출해(문서만 보고 추정하지 않고) 실제 필드명·타입(특히 `floor`가 문자열이 아니라 숫자로 오는 경우가 있음, `dealDate`가 `"YYYY-MM-DD"` 형식)을 확인한 뒤 타입을 작성했다.

## 4. UI 삽입 위치

기존 섹션 순서(A~F)를 변경하지 않고, **E(위치정보)와 F(청약홈 CTA) 사이**에 새 섹션 하나만 끼워 넣었다.

- 수정 파일: `src/app/presales/[id]/presale-detail-client.tsx`(import + 섹션 삽입 2곳만 변경, 기존 6개 섹션 코드는 건드리지 않음)
- 신규 파일: `src/app/presales/[id]/nearby-market-section.tsx`

## 5. 데이터 소스

컴포넌트는 `useSWR('/api/presales/{id}/nearby-market', fetcher)` 단 한 번만 호출한다. B2 응답의 `houseTypes[]`가 이미 `houseTypeDetailId`/`houseTy`/`exclusiveArea`/`presaleTopAmount`/`comparisonAvailable`/`comparisons[]`(주변 단지 + 실거래 + median + differenceAmount)와 `monthsSearched`(6/12/24 실제 조회 기간)를 전부 포함하고 있어, **API 변경이나 별도 필드 추가 없이** 요구사항(§11의 "실제 조회기간 표시" 포함)을 전부 충족했다 — 문서 요구사항이 예상했던 "하위호환 additive 변경"조차 필요하지 않았다.

주택형 chip 전환·정렬(거리순/신축순) 전환은 이미 받아온 응답을 클라이언트에서 가공만 한다 — 재호출 없음을 Chrome DevTools 네트워크 탭(`read_network_requests`)으로 직접 확인했다(chip 전환 전/후 `nearby-market` 요청 0건 추가).

## 6. 주택형 chip

- 한 줄 고정, `overflow-x: auto` + `flex-wrap: nowrap`(여러 줄 wrap 없음). 별도 "전체보기" bottom sheet는 만들지 않음(요청 범위와 동일).
- 정렬: `exclusiveArea` 오름차순 → 동일하면 `typeSuffix`(A/B/C...) 문자열 비교.
- 선택 색상: 기존 `--primary-color`(`#03c75a`, 네이버 그린 — `globals.css`에서 확인한 값 그대로 재사용)를 배경으로, 흰 글자. 미선택은 흰 배경 + `--border-color` 테두리. 새로운 파란색을 도입하지 않았다 — `src/components/AreaSelector.tsx`(단지 상세페이지의 기존 평형 chip)가 이미 쓰고 있는 동일한 배색 규칙을 그대로 따랐다.
- 라벨: `{반올림된 정수}㎡ {suffix}`(예: "84㎡ A"). `exclusiveArea`는 B2가 이미 계산해 제공하는 값을 표시 직전에만 반올림하고, DB 원본(`houseTy`/`supplyArea`)은 이 컴포넌트 어디서도 쓰거나 변경하지 않는다.
- 기본 선택: `comparisonAvailable && comparisons.length > 0`인 첫 번째(정렬 후) 주택형. 전부 없으면 정렬된 첫 번째 주택형.

## 7. 선택 주택형 요약

최고 분양가(`presaleTopAmount`, null이면 "분양가 미공개") + "비슷한 전용면적 {area-1}㎡ ~ {area+1}㎡의 주변 아파트 실거래와 비교합니다."(±1㎡는 B2가 이미 확정한 허용범위를 그대로 표시만 함).

## 8. 주변단지 정렬(거리순/신축순)

- 거리순(기본): `distanceKm` ASC(B2 응답이 이미 이 순서로 정렬해 옴, 클라이언트에서 재확인 정렬).
- 신축순: `buildYear` DESC, null은 뒤로, 동률은 `distanceKm` ASC.
- 둘 다 **API 재호출 없이** 이미 받은 `comparisons` 배열(최대 5개)만 클라이언트에서 재정렬한다.

## 9. 주변단지 카드 — 기본 노출/더보기

- 처음 3개 기본 노출, 나머지(최대 2개)는 "주변 단지 N곳 더보기 ↓"(N은 실제 남은 개수로 동적 표시) → 펼치면 "접기 ↑".
- 카드 내용: 단지명, 거리(1km 미만 m 단위/이상 km 단위)+준공연도("준공연도 정보 없음" fallback), 최근 거래 1건(금액/면적/층/연월), 최근 거래 중앙값 + "최근 N개월 거래 기준"(N은 `monthsSearched` 실측값 — 6/12/24 중 실제 값을 그대로 표시, 고정 문자열 아님), 분양 최고가와 차이.
- 모든 표시 필드는 B2 응답 필드를 그대로 사용했다 — 필드명을 추정하지 않았다.

## 10. 최근 거래 펼치기

기본은 최근 거래 1건만 노출. `recentTransactions.length > 1`일 때만 "최근 N건 보기 ▼" 버튼을 노출하고(1건뿐이면 펼쳐도 같은 내용이라 버튼 자체를 렌더하지 않음), 클릭 시 카드 내부에서 전체(최대 3건, 실제 개수만큼)를 "YYYY.MM · 면적㎡ · 층 — 금액" 형식으로 펼친다. 페이지 이동 없음, `<details>` 대신 버튼+로컬 state(카드별 독립, `Set<아파트id>`)로 구현 — 새 accordion 라이브러리 추가 없음.

## 11. 가격 차이 표시 — 가치판단 배제

`differenceAmount`(B2가 이미 계산한 부호 있는 숫자, 만원)를 `+3억 900만원` / `-4,500만원` 형식으로만 표시한다.

- 색상: `--text-primary`(기본 텍스트, 검정 계열) 고정. 양수/음수에 따른 빨강/파랑 색상 분기 없음.
- 문구: "비싸다/싸다/고평가/저평가/투자 추천" 등 가치판단 단어·화살표 아이콘 전혀 사용하지 않음.
- 초록(`--primary-color`)은 선택된 chip·정렬 토글의 active 상태 등 상호작용 표시에만 사용했다.
- `presaleTopAmount`가 null인 경우(현재 실데이터에는 없음, §16 참고) "분양가가 공개되지 않아 가격 차이를 계산할 수 없습니다."를 표시하고 실거래 카드 자체는 그대로 유지한다(섹션을 숨기지 않음).

## 12. info 안내 UI

섹션 제목 옆 `ⓘ` 버튼(`aria-expanded`, `aria-label="주변 아파트 비교 안내"`). 클릭 시 요청 문서가 지정한 안내 문구(반경 3km/6~24개월/±1㎡/참고정보 문구)를 그대로 섹션 내부에 펼친다. 별도 모달 라이브러리 없이 로컬 state + 인라인 패널로 구현했다.

## 13. 예외 상태

| 상태 | 조건(API 필드) | 처리 |
|---|---|---|
| 좌표 없음 | `locationAvailable === false` | chip/카드 전부 숨기고 "정확한 위치정보가 없어 주변 단지를 비교할 수 없습니다."만 표시(E섹션의 "정확한 위치정보 준비 중"과 톤 일치) |
| 비교 가능 거래 없음 | 선택 주택형의 `comparisons.length === 0` | `monthsSearched === 24`일 때만 "최근 24개월까지 확인했지만 전용 X~Y㎡ 범위의 비교 가능한 거래를 찾지 못했습니다.", 그 외에는 "비슷한 전용면적의 최근 실거래가 없습니다." |
| 분양가 미공개 | `presaleTopAmount == null` | §11 참고 |
| 준공연도 없음 | `apartment.buildYear == null` | "준공연도 정보 없음", 신축순 정렬 시 항상 뒤로 |
| API 오류 | SWR `error` 또는 `data.success === false` | "주변 실거래 정보를 불러오지 못했습니다. 잠시 후 다시 확인해주세요." + "다시 시도" 버튼(SWR `mutate()`로 동일 API 재호출) |
| 주변단지 1~2개뿐 | `comparisons.length < 3` | 있는 만큼만 표시, 더보기 버튼 미노출 |

## 14. 로딩 / 성능

- 로딩 문구: "주변 실거래 정보를 불러오는 중입니다..."(B2 cold response가 최대 8초까지 걸릴 수 있다는 문서18 §15 실측을 반영).
- chip 전환·정렬 전환·거래 펼치기·더보기 전부 API 재호출 없음(§5).

## 15. 접근성

chip/정렬 토글/info 버튼/더보기/거래 펼치기 전부 `<button>` 사용. `aria-pressed`(chip, 정렬 토글), `aria-expanded`(info, 더보기, 거래 펼치기), `aria-label`(info 버튼)을 적용했다. 클릭 가능한 `div` 없음.

## 16. 실제 데이터 테스트

문서17/18과 동일한 10개 Presale 표본(서구/해운대구/부산진구/동래구/연제구/남구/강서구/기장군, 좌표 있음 8·없음 2)으로 실제 로컬 DB/API를 대상으로 검증했다.

| id | 지역 | 시나리오 | 결과 |
|---|---|---|---|
| 479 | 서구 | 주택형 12개, 거리순 기본, "84m² A" 선택 시 4개 단지(3개 기본+더보기 1개) | 브라우저로 직접 확인. `differenceAmount` 값(+3억900만원, +2억9,045만원, +7억2,000만원, +6억5,000만원)이 문서18 "수동 검산" 표와 **정확히 일치** |
| 630 | 해운대구 | 11개 주택형 중 1개만 비교 가능, "105m² C" 선택 시 comparisons 0건 | "최근 24개월까지 확인했지만 전용 103.7~105.7㎡ 범위의 비교 가능한 거래를 찾지 못했습니다." 정상 표시(`monthsSearched: 24` 실측값 기준) |
| 706 | 부산진구 | 3개 주택형, 24개월 fallback | API 200, `monthsSearched: 24` 확인(curl) |
| 737 | 동래구 | 3개 주택형, 밀집지역 | API 200, `monthsSearched: 24` 확인(curl) |
| 755 | 연제구 | 6개월로 충분히 종료된 사례 | API 200, `monthsSearched: 6` 확인(curl) — "최근 6개월 거래 기준" 문구가 실제로 표시되는 유일한 실측 경로 |
| 801 | 남구 | 지역경계(수영구 단지 포함), 주택형 1개, comparison 1건, **음수 차액** | 브라우저 확인 — "더비치푸르지오써밋"(수영구 아님, 남구 최근접) 카드에 "-2억 3,100만원"이 검정 텍스트로(빨강/파랑 없이) 정상 표시 |
| 847 | 강서구 | adaptive radius가 1km→3km까지 확장, 6개월→24개월 fallback으로 확장된 사례 | 브라우저 확인 — 카드 정상 렌더, 작은 차액(+355만원)도 정상 포맷 |
| 1040 | 기장군 | 2개 주택형 | API 200, `monthsSearched: 24` 확인(curl) |
| 173 | 연제구(좌표없음) | `locationAvailable: false` | 브라우저 확인 — chip/카드 없이 "정확한 위치정보가 없어 주변 단지를 비교할 수 없습니다."만 표시 |
| 164 | 해운대구(좌표없음) | `locationAvailable: false` | curl로 구조 확인(`locationAvailable:false`, `houseTypes[].comparisons`는 전부 빈 배열) |

추가로 chip 전환 시 네트워크 요청 0건(§5), 사이트 전역 그린 색상(`#03c75a`) 재사용, `<button>` 기반 접근성 요소를 전부 실제 렌더 결과로 확인했다.

### 실데이터로 확인하지 못한 경로(코드 검토로만 확인)

- **API 오류(§13 "API 오류")**: `nearby-market` route.ts는 모든 예외를 이미 try/catch로 감싸 항상 `success:true` 또는 명확한 `success:false` JSON을 반환한다. 상위 페이지가 이미 presale 404/400을 별도로 gating하므로, 이 섹션이 실제로 오류 상태에 도달하려면 DB 연결 장애 등 실제 인프라 장애가 필요해 로컬 환경에서 인위적으로 재현하지 않았다. 컴포넌트 코드(`error || apiErrorMessage` 분기 + `mutate()` retry)를 직접 검토해 로직이 올바름을 확인했다.
- **`presaleTopAmount === null`**: `PresaleHouseTypeDetail.topAmount` 컬럼은 현재 DB 5,395건 전부가 not null(직접 쿼리로 재확인, §16 표 하단). 코드 경로(§11)는 존재하지만 실데이터로 트리거되지 않았다.
- **houseTy parse 실패(`comparisonAvailable: false`)**: 문서18이 이미 5,395/5,395 파싱 성공을 실측했으므로 동일하게 실데이터로 트리거되지 않았다. 코드 경로(chip 라벨 fallback, 요약 fallback)는 존재.
- **모바일 실기기(360/375/390px)**: 이번 환경의 브라우저 자동화 도구(`resize_window`)가 실제 브라우저 창 크기를 바꾸지 못하는 제약이 있어(재현: `resize_window`로 375×812 요청 후 `window.innerWidth`를 확인해도 데스크톱 폭(1536~1707px)이 그대로 유지됨, 새 탭에서도 동일 — 도구 자체의 한계로 판단), 진짜 브라우저 뷰포트 배율로는 확인하지 못했다. 대신 페이지의 실제 콘텐츠 컨테이너(`.container`)에 `width:375px`/`360px`를 직접 적용해(이 섹션의 CSS는 뷰포트 단위(`vw`)나 반응형 미디어쿼리를 전혀 쓰지 않고 항상 동일한 `overflow-x:auto` 규칙이 적용되므로 이 방식이 실제 좁은 뷰포트와 동일한 렌더 결과를 만든다) chip 한 줄 유지+가로 스크롤, 카드 레이아웃, 텍스트 줄바꿈을 시각적으로 확인했다. **완전한 브라우저 뷰포트 에뮬레이션은 도구 제약으로 미확인**임을 정확히 밝힌다.

## 17. 회귀 테스트

| 대상 | 결과 |
|---|---|
| `GET /api/presales` | 200 |
| `GET /api/presales/479` | 200 |
| `GET /api/presales/479/nearby-apartments` | 200(B1 코드 무변경) |
| `GET /api/presales/479/nearby-market` | 200(B2 코드 무변경) |
| `/presales`(목록) | 정상 렌더, 1,046건, 필터 UI 정상 |
| `/presales/479`(상세) | A~F 기존 6개 섹션 전부 정상, B3만 추가됨 |

## 18. 품질 검증

- `npx prisma validate`: 통과
- `npx prisma migrate status`: up to date
- `npx tsc --noEmit`: 오류 0
- `npm run lint`: 오류 0, 경고 5건(전부 이번 변경과 무관한 기존 파일 — `prisma/seed.js`, `scripts/fetchData.js`, `ai-search-client.tsx`, `apt-client.tsx`, `ViewTracker.tsx`)
- `npm run build`: 성공, `/presales/[id]` 동적 라우트 정상 포함

## 19. 알려진 문제

없음(이번 STEP에서 새로 발견한 버그 없음).

## 20. 후속 B4와의 경계

이번 STEP은 텍스트+카드 UI만 구현했다. 지도 시각화(분양 마커 + 주변단지 마커)는 B4에서 별도로 진행한다(문서16 §27이 이미 독립 구현 가능하다고 판단한 그대로).

## 21. 수정/생성 파일

- 신규: `src/app/presales/[id]/nearby-market-section.tsx`
- 수정: `src/app/presales/[id]/presale-detail-client.tsx`(import 1줄 + 섹션 삽입 1곳)
- 수정: `src/app/presales/[id]/page.module.css`(B3 전용 클래스 추가, 기존 클래스 변경 없음)
- 신규 문서: 이 파일
- 수정 문서: `docs/development/CHANGELOG.md`

commit/push 하지 않았습니다. B4, M4-C, 재개발, 커뮤니티, 전국 확장, SEO 작업으로 진행하지 않았습니다. 검수를 기다립니다.

*(이 문단은 B3 최초 구현 시점(2026-08-14, 검수 착수 시)의 기록이다. 이후 B3-FIX(문서22)와 사용자 모바일 최종 검수를 거쳐 §0에 기록된 대로 최종 승인·commit·push되었다 — 아래 §0이 최신 상태다.)*
