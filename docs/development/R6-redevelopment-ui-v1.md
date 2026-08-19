# STEP R6 — Redevelopment UI V1

상태: **완료 — DB/schema/migration 무변경, ingestion 재실행 없음, R5 API 계약
그대로 재사용**

## overview

`/redevelopment` 페이지의 "재개발" 탭(기존 "준비 중" placeholder)을 R5 API
기반 실데이터 목록/검색/필터/상세 화면으로 교체했다. "분양·청약" 탭은
이번 STEP과 무관해 완전히 그대로 뒀다(코드 diff 확인: 해당 탭의 JSX/문구
1바이트도 바뀌지 않음).

## routes

```text
/redevelopment           기존 페이지 그대로, "재개발" 탭만 실데이터로 교체
/redevelopment/[id]      신규 — 상세 페이지(SEO metadata 포함)
```

## list UX

검색창 → 필터(시도/시군구/사업유형/진행단계) → 지도 안내 문구 → 결과
건수 → 카드 그리드 → 페이지네이션 순으로 배치(섹션 4 우선순위: 지역·검색
·목록·필터·지도).

## filters

- 시도: `SIDO_LIST`(`src/lib/regions.ts`, 기존 데이터 재사용, 새 지역
  시스템 없음) 17개 전체 선택 가능 — **부산 전용 화면으로 하드코딩하지
  않음**(섹션 32). 기본값만 `부산광역시`(섹션 5, 이집 초기 검증 지역).
- 시군구: 선택된 시도에 대응하는 `REGION_DATA[sido]` 목록에서 동적으로
  채움.
- 사업유형/진행단계: R5 `BUSINESS_TYPE_VALUES`/`STAGE_VALUES`(→
  `labels.ts`로 이동, 클라이언트 번들에 Prisma 타입이 섞이지 않게 분리)
  기반 select. `UNKNOWN`은 필터 옵션에서 제외(사용자가 고를 이유가
  없는 내부 상태).

## search

`q` 파라미터, 입력 300ms debounce 후 요청(섹션 38 — 매 타이핑마다 API
호출 안 함). "서대신4"/"아미1"/"아미3" 전부 실제 검색 성공.

## cards

```text
사업명 / 사업유형·진행단계 배지 / 지역(시도 축약+시군구) / 세대수 /
데이터 출처(한글)·데이터 갱신(YYYY.MM)
```

세대수 `null`이면 "세대수 정보 없음"(0 표시 안 함, 섹션 11). 진행단계
배지는 stage를 4개 시각 그룹(active/done/stopped/unknown)으로 나눠
색상만 다르게 하고 이모지는 쓰지 않았다(섹션 10/35).

## detail

```text
히어로: 사업명 + 유형/단계 배지 + 지역 + 상태(진행 중/완료/취소/확인 중,
  `PROJECT_STATUS_LABELS` — projectStatus는 stage에서 자동 파생되는
  값이라 새 enum 없이 라벨만 추가, 섹션 24 "상태" 요구사항 반영)
정보 3칸: 세대수 / 진행단계 / 사업유형(각각 field provenance 텍스트 포함,
  R5의 describeFieldProvenance() 그대로 사용)
지도 안내 박스(아래 참고)
데이터 출처 섹션: source별 카드(원본 사업명/원본 진행단계/원본 세대수/
  수집 시점) — matchConfidence/mergeStatus는 화면에 렌더링하지 않음
  (섹션 25, API 응답에는 있지만 UI 코드가 참조하지 않음)
하단: 데이터 갱신 날짜
```

`needsReview`(dataQuality=REVIEW_REQUIRED)인 사업은 경고 배너 대신
"일부 정보 확인 중입니다. 확정되는 대로 갱신됩니다." 한 줄만 표시한다
(섹션 27 — 오류처럼 보이지 않게).

## map safety

R5의 `hasSafeMapLocation` 계약을 그대로 신뢰한다 — 이번 STEP에서 지도
안전 로직을 다시 만들지 않았다. 실제 지도 위젯(Kakao map)은 V1에서
구현하지 않기로 결정했다(아래 known limitations 참고) — 대신:

- 목록 상단에 상시 안내: "정확한 사업 위치가 확인된 구역부터 지도에
  표시됩니다. 목록에서는 모든 사업을 확인할 수 있습니다."
- 상세에서 `hasSafeMapLocation===false`일 때: "정확한 사업 위치가 아직
  확인되지 않았습니다. 위치 정보가 확인되면 지도에 표시됩니다."
- `hasSafeMapLocation===true`일 때만 지도 표시 자리(현재 production
  기준 0건이라 실제로 렌더된 적은 없음, 로직은 준비됨).

**OFFICE/APPROXIMATE/UNKNOWN을 사업현장 marker로 표시하는 코드는 어디에도
없다** — API가 이미 이 필드들을 걸러서 `hasSafeMapLocation`을 계산해
주므로 UI는 그 값만 신뢰하면 된다(섹션 19 금지 목록 위반 없음, 실제
Kakao 지도 컴포넌트 자체를 아직 붙이지 않아 지도 렌더링 코드 표면적이
0이라는 사실도 안전성을 구조적으로 보장한다).

## source display

`sourceLabel()`(`labels.ts`)로 `MOLIT`→"국토교통부",
`BUSAN_CITY`→"부산광역시" 변환 — raw enum이 화면 어디에도 노출되지
않음(스크린샷으로 직접 확인).

## Seo-gu / 대표 사업 검증(local dev, production DATABASE_URL 대상,
실제 브라우저)

- `/redevelopment` → 재개발 탭 → 부산광역시(기본값) → 검색 결과 461건
  (전국 부산 전체, R4 FINAL과 일치) 확인. 서구로 필터링하면(시군구
  선택) 24건(R4 FINAL과 일치, 스크린샷 확인 안 했으나 API로 R5에서
  이미 검증됨 — UI는 같은 API를 그대로 호출).
- `q=서대신4` → 1건, 재개발/착공/542세대 카드 → 클릭 → 상세 페이지
  정상 진입, `국토교통부`+`부산광역시` 두 출처 카드 모두 표시, 각각
  원본 사업명/진행단계/세대수/수집 시점 정상.
- `/redevelopment/649`(아미1) → MOLIT-only, "세대수 정보 없음"(0 아님),
  국토교통부 카드 1개만 표시, 지도 안내문 정상.
- 존재하지 않는 id(999999999) → 404에 준하는 인라인 안내("해당
  재개발 사업을 찾을 수 없습니다") + 에러 마스코트, 500 아님.
- console 에러 없음(페이지 로드 시점부터 재확인).

## mobile / desktop

iframe 격리 기법(375px/390px/430px 동시 렌더)으로 실제 스크린샷 확인 —
검색창·필터 4개(2×2 줄바꿈)·지도 안내·카드·하단 네비 전부 정상, 잘림/
overflow 없음. 데스크톱(1568px)에서는 카드 3열 그리드로 자동 전환
(768px/1024px 브레이크포인트, presales 페이지와 동일한 반응형 규칙
재사용).

## SEO

`generateMetadata()`가 presales 상세 페이지와 동일한 패턴으로 canonical
데이터 기반 title/description을 생성한다 — 예:
`"서대신4 재개발 진행단계·세대수 | 이집"`(실제 브라우저 탭 제목으로
확인). 존재하지 않는 id는 `"재개발 정보를 찾을 수 없습니다 - 이집"`.
새 SEO 인프라를 만들지 않고 기존 `buildOpenGraph`/`siteConfig` 재사용.

## accessibility

검색 input에 `aria-label`, select 4개에 각각 `aria-label`, 결과 건수에
`aria-live="polite"`(로딩 상태 변화가 스크린리더에 전달됨), 카드는
`role="button"` + `tabIndex={0}` + Enter 키 핸들러로 키보드 접근 가능.

## API request 최적화

SWR의 기존 요청 dedup/캐시 메커니즘을 그대로 사용 — 필터가 바뀔 때마다
쿼리 키가 바뀌므로 SWR이 자연스럽게 이전 요청을 관리한다. 별도
AbortController 구현은 추가하지 않았다(섹션 38 — 기존 presales-client.tsx
가 이미 이 방식만 쓰고 있어 동일 관례 유지).

## URL state

이번 V1에서는 필터를 URL query에 반영하지 않았다(섹션 39 — "구현 복잡도가
크면 V1 필수 아님"). `presales-client.tsx`도 동일하게 URL sync가 없어
기존 sibling 페이지 관례와 일치한다.

## tests

신규 `labels.test.ts`(9건, 라벨 완전성/변환/축약/상태 테스트) — 전체
**97/97 pass**(R5까지의 88 + 신규 9, projectStatusLabel 포함). UI
컴포넌트 자체의 렌더 테스트는
이번 STEP에서 추가하지 않았다(이 프로젝트에 React 컴포넌트 테스트
러너/라이브러리가 설치돼 있지 않고, 새로 추가하는 것은 STEP 범위를
벗어난다고 판단 — 대신 실제 브라우저로 목록/필터/검색/empty/detail/
source labels/stage label을 전부 수동 검증했다, 위 "Seo-gu 검증" 참고).

## typecheck / lint / build

전부 통과(0 errors). 기존 라우트 회귀 없음.

## DB / schema / migration / production ingestion

**전부 무변경/미실행.** UI + 클라이언트 컴포넌트만 추가했고, R5가 만든
API 계약을 그대로 재사용했다. production에 대한 유일한 상호작용은
브라우저로 실제 API를 read-only 호출한 것뿐이다.

## known limitations(V1)

- polygon 없음(R3B부터 V2로 이관된 결정, 이번 STEP에서 다시 논의하지
  않음).
- production 기준 안전 좌표(lat/lng + PROJECT_SITE) 0건 — 지도에 실제
  마커가 뜨는 사업이 아직 없다. UI는 이 상태를 정직하게 안내하고
  목록/검색/상세 기능은 좌표와 무관하게 전부 정상 동작한다.
- **실제 Kakao 지도 위젯(핀 렌더링)은 이번 STEP에서 만들지 않았다** —
  안전 좌표가 0건인 상태에서 지도 컴포넌트를 붙여도 검증할 마커가
  없어(개발자가 빈 지도만 보게 됨), 좌표가 실제로 채워지기 시작하는
  시점(R4/R4.1 unresolved: office 좌표 지오코딩 파일럿)에 지도 위젯을
  붙이는 게 더 안전하다고 판단했다. `hasSafeMapLocation` 계약과 안내
  UX는 이미 준비돼 있어 지도 위젯만 나중에 끼워 넣으면 된다.
- 일부 BUSAN-only 사업은 실제로는 MOLIT과 병합 가능했을 수 있다(R4.1
  unresolved: sigungu UNRESOLVED/unsafe 63건) — 목록에서는 별개
  사업처럼 보일 수 있음, 데이터 파이프라인 개선 시 자동으로 합쳐짐.
- MEDIUM(REVIEW_REQUIRED) 43건은 화면에서 "일부 정보 확인 중"으로만
  안내되고 자동 숨김되지 않는다(섹션 16 지시대로).
- 필터 상태 URL 미반영(위 참고), 컴포넌트 단위 자동 테스트 없음(수동
  브라우저 검증으로 대체).

## R6 완료 기준 체크

```text
/redevelopment placeholder 제거(재개발 탭만): Yes
실데이터 목록: Yes
지역 필터(시도+시군구): Yes
사업유형 필터: Yes
stage 필터: Yes
검색: Yes
pagination: Yes(R5 계약 재사용)
상세: Yes
source 정보: Yes(rawPayload/matchConfidence 비노출)
부산 서구 24건: Yes(R5에서 API로 검증된 값과 동일 API, UI는 그대로 재사용)
서대신4 단일 상세: Yes
아미1/아미3: Yes
모바일 375/390/430: Yes
desktop: Yes
typecheck/lint/build/tests: 전부 통과
```
