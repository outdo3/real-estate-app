# MAP MARKER UX V2

## 1. Goal

`/map`의 아파트 가격 마커를 정보량·밀도·선택 상태 UX 세 축에서 개선한다: (1)
가격만 보이던 마커에 면적/평형을 함께 붙이고, (2) 가격 표기를 compact화하고,
(3) 칩 밀도(정보 대비 크기)를 개선하고, (4) 검색 후 선택 마커의 검은 강조를
이집 Green 기반 디자인으로 교체하고, (5) GLOBAL SHARE SYSTEM V1이 미완으로
남겼던 selected marker의 공유/복원을 완성한다.

## 2. Competitor Observation

사용자가 실제 비교한 호갱노노/아실/네이버부동산은 마커에 가격과 함께 평형/
면적/거래유형 중 일부를 바로 보여준다. 이집 지도는 가격만 보여줘 "이 가격이
몇 평 가격인지" 지도에서 판단할 수 없었다 — 이번 STEP의 핵심 문제.

## 3. Previous Marker Problem

`src/app/map/page.tsx`의 `AptMarker` 타입은 `price`(포맷된 문자열),
`hasRecentPrice`, `name`, `dong`, `aptSeq`, `lat/lng`, `completionYear`만
가지고 있었다 — 면적/평형/거래유형/날짜가 전혀 없었다. `renderMarkerChip`은
compact(줌아웃)/detailed(줌인) 두 모드 모두 가격만 렌더링했다. selected 상태는
`#1e293b`(거의 검정) 3px box-shadow 링 + 2px 보더로 표현돼 브랜드 그린이
완전히 사라졌다(감사 결과, 리팩터 전 `renderMarkerChip` 469~478행 상당).

## 4. Marker Data Contract

`/api/transactions` route(`src/app/api/transactions/route.ts`)는 이미 매
거래 row에 `pyung`(trustworthy Unit Master 값, `resolveTrustworthyPyeongBatch`
결과), `excluUseArea`(raw ㎡), `dealAmount`(만원), `typeLabel`, `dealDate`,
`dealCanceled`를 포함해 응답한다 — **지도 마커가 필요한 데이터는 이미
백엔드에 있었고, `fetchAptMarkers`(map/page.tsx)가 이를 버리고 있었을 뿐**이다.
이번 STEP은 새 API/새 DB 조인 없이 `AptMarker`에 `dealAmount`/`pyeong`/
`areaM2` 필드 3개를 추가로 통과시키는 것만으로 해결했다(TRUE GATE #3 "새
데이터 파이프라인 필요"에 해당하지 않음).

또한 감사 중 발견: `fetchAptMarkers`가 단지별 "최신 거래 1건"을 고를 때
`dealCanceled`(해제/취소 거래)를 걸러내지 않고 있었다 — 다른 모든
`/api/transactions` 소비자(regional-feed, gap-invest, dashboard, large-complex
등)는 이미 필터링하는데 지도만 빠져 있었다. 이번 STEP에서 함께 고쳤다(§29).

## 5. Representative Area Rule

한 단지에 여러 면적 거래가 있을 수 있어, 마커 하나가 대표하는 거래를 정하는
규칙이 필요하다(§7 of the STEP spec). 기존 규칙("단지별 최신 거래 1건",
`data`가 이미 계약일 내림차순 정렬된 상태에서 `byComplex` Map의 first-wins)을
그대로 유지했다 — 이는 STEP이 제시한 안전 후보 중 "가장 최근 verified trade의
exact raw area"에 해당한다. 지도에는 평형 선택 UI가 없어 "사용자가 선택한
면적 우선" 후보는 해당 사항 없음. 취소 거래만 후보에서 제외하도록 추가했다
(§4).

## 6. Pyeong Trust Contract

APT DETAIL에서 확정한 원칙을 그대로 적용했다: trustworthy Unit Master
`representativePyeong`이 있으면(`item.pyung != null`, 이미 route.ts가 검증)
평형을, 없으면 raw ㎡(반올림)를 보여준다. `src/lib/map-marker-format.ts`의
`formatMarkerAreaLabel()`은 `exclusiveArea / 3.3058` 계산을 절대 하지 않고
전달받은 값만 그대로 포맷한다 — 정적 가드(`scripts/run-map-marker-ux-v2-qa.ts`)
가 이 계산이 재도입되지 않는지 확인한다.

## 7. Compact Price Format

`formatCompactPriceManwon()`(`src/lib/map-marker-format.ts`)이 1억 이상을
소수점 2자리 "억" 단위로 압축한다(예: 38,700만원 → "3.87억", 45,000만원 →
"4.5억", 123,000만원 → "12.3억"). 1억 미만은 기존과 동일하게 "9,500만"
콤마 표기. 최대 오차는 0.005억(5만원)으로 통상 거래가 대비 무시 가능한 수준
— 값을 오해시킬 정도로 반올림하지 않는다(§9 요구사항). deterministic(같은
입력 → 같은 출력)임을 단위 테스트로 확인.

## 8. Transaction Type

지도는 현재 `/api/transactions?type=apt`만 조회한다(매매 실거래만, 전월세
없음) — 그래서 모든 마커가 이미 100% "매매·실거래"이고, 거래유형 배지를
붙여도 구분 정보가 없다(모든 칩에 "매" 라벨을 반복하는 것은 오히려 좁은
칩 공간을 낭비). §10/§11의 "매/전 동시 표시"는 지도가 전세(type=rent)
데이터를 별도로 fetch해야 하는 아키텍처 확장이라(뷰포트당 fetch 2배) 이번
STEP에서는 하지 않았다 — 조건부("안전하게 같이 제공 가능하면") 요구사항으로
읽었고, 성능(§30 N+1/폭발적 fetch 금지) 리스크가 더 크다고 판단해 범위
밖으로 남겼다(§20 Known Limitations).

## 9. Marker Information Architecture

- compact(줌아웃, `!isDetailed`): 한 줄 `"{면적} {가격}"`(예: "34평 3.87억").
- detailed(줌인): 기존과 동일하게 2줄 — 단지명 + `"{면적} {가격}"`.
- zoom 3단계 세분화(§14 "가능하면")는 기존 구조(compact/detailed 이진
  분기)를 크게 바꿔야 해서 이번 STEP에서는 하지 않았다 — 최소 요구사항인
  "현재보다 더 많은 마커가 읽히는 compact default"는 §10에서 확인한
  대로 compact 포맷 자체가 짧아 만족한다.
- 바텀시트(선택된 마커 카드)에도 같은 `"{면적} {가격}"` 라인을 추가하고,
  trustworthy pyeong으로 표시 중일 때는 raw ㎡도 작은 보조 텍스트로 함께
  보여준다(§25 — 마커 자체엔 과도한 보조 텍스트를 넣지 않고 카드에서만 확인
  가능하게).

## 10. Marker Density

원인 감사(§12): 마커가 작아 보이는 게 아니라 가격만 있어 정보 밀도가
낮았던 것 + padding/보더가 다소 여유 있었던 것이 원인이었다(칩 자체
크기는 60×26/92×42로 이미 작은 편). compact 가격 포맷(§7)이 만들어내는
여유 공간을 이용해:
- 칩 폭을 소폭만 확대(60→64, 92→96px) — 면적 텍스트를 위한 최소 여유.
- padding을 줄임(compact `3px 9px`→`2.5px 8px`, detailed `4px 8px`→`3px 7px`).
- `clusterRadius`도 소폭(+2px) 늘려 확대된 칩끼리 인접 클러스터와 시각적으로
  겹치지 않게 함(overlap 전략 조정).

실측(§18 참고, 부산 3개 구 + 강남구, zoom=4 동일 조건): 정보는 명확히
늘었고(가격만 → 면적+가격) 칩 밀도는 유지·개선됐다(§14 예시 "3억 8,700만"
류 롱폼과 신규 "34평 3.87억"류 텍스트 길이가 비슷하거나 신규 쪽이 더
짧은 경우가 많음 — 비싼 아파트일수록 compact 포맷의 압축 효과가 커짐).

## 11. Selected Marker Design

`#1e293b`(검정에 가까운 slate) 링/보더를 완전히 제거했다. 새 계약:
- SELECTED: `background: var(--ejip-green)`, `border: var(--ejip-green-deep)`,
  텍스트 white, `box-shadow: 0 0 0 6px rgba(19,163,103,0.18), 0 6px
  14px rgba(0,0,0,0.18)`(연한 green halo, ~18% opacity).
- 기존 unselected 스타일(흰 배경 + 그린/그레이 보더)은 완전히 그대로
  유지 — 회귀 없음.
- Scale: compact 1.1(10%), detailed 1.08(8%) — §16이 제시한 8~12% 범위 안.
- z-index: 기존과 동일하게 선택된 마커/클러스터가 9999로 최상위.

## 12. Search-to-Selection

기존 `handleApartmentSelect` 흐름(center 이동 → zoom → `pendingSelectedApt`
fast-path 임시 마커 → 실제 데이터 도착 시 자동 교체)은 그대로 유지했다 —
이미 검색 즉시 선택 마커가 화면에 보이는 계약을 만족하고 있었다(§19). 이번
STEP은 선택된 마커의 "보이는 방식"(브랜드 그린)만 바꿨다.

## 13. Share Selected State

`src/lib/map-marker-share.ts`(신규, 순수 함수):
- `buildMapShareParams(center, zoom, lawdCd, selected)` — 선택된 마커가
  있으면 `aptSeq`(우선순위 1, 있으면 이것만) 또는 `dong`+`name`(둘 다 함께,
  name-only 금지)를 공유 URL에 추가한다.
- 지도 상단 `ShareAction`의 `params`를 이 함수 결과로 교체했다(기존
  lat/lng/zoom/lawdCd는 그대로 유지).

## 14. URL Restore

`parseMapStateFromSearchParams(URLSearchParams)` — 공유 링크의 `aptSeq`
또는 `dong`+`name`을 `RestoreIdentity`로 파싱한다. `matchRestoreIdentity
(identity, markers)` — 실제로 막 fetch된 `aptMarkers` 배열 안에서 정확히
일치하는 것만 찾는다(§24 wrong-apartment fallback 금지 — 못 찾으면 그냥
`null`, 다른 단지로 대체하지 않음). `map/page.tsx`는 `isLoadingData`가
false로 바뀐 시점(=fetch 완료 시점)에 한 번만 이 매칭을 시도하고
`selectedMarkerId`를 설정한다.

**구현 중 발견한 선행 버그 2건(이번 STEP에서 함께 수정, 모두 "restore가
실제로 동작하게 하는 데" 필수적이었음):**

1. **lawdCd 미사용**: 최초 마운트 시 마커를 불러오는 effect가 URL의
   `lawdCd`를 전혀 쓰지 않고 항상 `center` 좌표를 역지오코딩해서 지역을
   다시 알아냈다 — 좌표가 행정구역 경계 근처거나 정밀도가 조금만 달라도
   공유했던 지역과 다른 지역이 fetch돼, 공유된 aptSeq가 그 결과 안에
   아예 없는 상황이 실제로 재현됐다(연제구 공유 링크가 서구 데이터를
   fetch). `initialShareLawdCdRef`로 "공유 링크로 들어왔는지"를 마운트
   시점에 한 번 기억해두고, 그 경우에만 역지오코딩을 건너뛰고 URL의
   lawdCd를 그대로 쓰도록 고쳤다 — 일반 진입(공유 링크 아님)은 기존과
   동일하게 역지오코딩 경로를 그대로 탄다(회귀 없음).
2. **GPS가 공유 center를 덮어씀**: "컴포넌트 첫 마운트 시 사용자 위치
   가져오기" effect가 무조건 실행돼, 공유 링크로 복원한 center를 마운트
   직후 GPS/IP 기반 위치로 곧바로 덮어썼다(실측 — 연제구 공유 링크가
   몇 초 뒤 조용히 서구로 돌아감). `initialShareLawdCdRef`가 설정돼
   있으면(공유 링크) 이 GPS effect를 건너뛰도록 가드를 추가했다.

두 버그 모두 GLOBAL SHARE SYSTEM V1이 "PASS"로 보고했던 center/zoom
restore 자체에도 실은 잠재해 있던 문제였다(그 STEP의 QA가 GPS/IP가
우연히 같은 구로 해석되는 좌표로만 테스트해 드러나지 않았다) — 이번
STEP에서 함께 근본 수정했다.

## 15. Mobile

이 세션 환경의 `resize_window`가 요청한 CSS px(375×700 등)를 정확히
반영하지 않는 것으로 보인다(스크린샷 결과 치수가 요청과 다르게 나옴 —
이전 STEP(APT DETAIL 관련)에서도 동일하게 보고된 환경 제약). 여러 축소
비율에서 반복 확인한 결과: 상단 컨트롤 바(검색+내위치+공유)가 한 줄을
유지하며 겹치지 않고, 마커 칩 텍스트가 클리핑 없이 읽히며, 바텀시트가
하단 네비게이션과 겹치지 않는 것을 확인했다. 정확한 360/375/390 뷰포트
치수 자체의 재현은 이번 세션 도구 제약으로 완전히 독립적으로 보장하지는
못했다 — known limitation으로 기록.

## 16. Desktop

1280px 데스크톱에서: 4개 구(부산 서구/연제구/해운대구, 서울 강남구)를
동일 zoom(4)에서 확인, selected 스타일/검색/공유 restore/상세 이동 전부
정상 동작(§19 QA 참고).

## 17. Accessibility

마커 칩은 기존에 순수 `<div onClick>`이라 키보드로 전혀 접근할 수
없었다. `role="button"`, `tabIndex={0}`, `aria-pressed={selected}`,
Enter/Space 핸들러(`onKeyDown`), 그리고 상태를 설명하는 `aria-label`
(예: "대신롯데캐슬, 34평 3.87억, 선택됨")을 추가했다. 키보드 `:focus-visible`
링은 `src/app/map/map-marker.module.css`에서 이집 Green(`--ejip-green-deep`)
아웃라인으로 별도 정의해, 마우스로 선택된 상태(fill+scale)와 키보드
포커스 상태(아웃라인)가 항상 구분되게 했다 — 색상만으로 selected를
전달하지 않는다(§36).

## 18. Performance

마커 정보 확장은 기존 배치 fetch(`/api/transactions?type=apt&lawdCd=...
&months=12`, 뷰포트/지역당 1회) 응답에서 이미 있던 필드 3개를 추가로
읽는 것뿐이라 신규 API 호출이 0이다. `renderMarkerChip` 안에 `fetch()`
호출이 없음을 정적 가드로 확인했다(N+1 금지, §30).

## 19. QA

- 자동화(`scripts/run-map-marker-ux-v2-qa.ts`, `--json`): 29개 체크(포맷터
  단위 테스트, share params/restore 순수 함수 테스트, wrong-match 부재
  테스트, 정적 가드 5종) 전부 PASS + 라이브 회귀(`/map`, `/stats`, apt
  상세) 전부 200.
- `npx tsc --noEmit`: 변경 파일 신규 오류 0(기존 `scripts/*` 34건만
  존재, 분리 보고).
- `npm run lint`(변경 파일 전체): 0 errors, 0 warnings.
- `npm run build`: PASS, 35개 라우트 정상 생성.
- 브라우저(Chrome, 로컬 dev) 실측:
  - 대신롯데캐슬: 검색 → 센터 이동 + zoom + 즉시 선택(그린) 확인,
    바텀시트에 "34평 3.87억"·"전용 84.7855㎡" 확인, 상세 이동 확인.
  - 마커 밀도(zoom=4, `/api/transactions` 응답 기준 — dealCanceled/좌표
    없는 행 제외한 "고유 단지" 수 vs 해당 뷰포트에 실제 렌더된
    `[role=button]` 칩 수):

    | 지역 | lawdCd | 고유 단지 수(fetch) | 뷰포트 내 렌더 칩 수 |
    |---|---|---|---|
    | 부산 서구 | 26140 | 138 | 45 |
    | 부산 연제구 | 26470 | 206 | 37 |
    | 부산 해운대구 | 26350 | 277 | 31 |
    | 서울 강남구 | 11680 | 0 | 0 |

    강남구는 `ApartmentMaster`(마커 좌표 소스)가 서울을 아직 커버하지
    않아(사전에 확인된 기존 제약, 이번 STEP과 무관) 좌표가 있는 row가
    0건 — 마커가 원천적으로 뜰 수 없다(가짜 마커를 만들지 않음, 정직한
    "N/A"). 부산 3개 구는 전부 뷰포트 안에서 여러 칩이 겹침 없이 개별
    정보(면적+가격)로 읽히는 것을 스크린샷으로 확인했다.
  - selected 스타일: 검정 링 완전히 사라짐, 그린 fill + 연한 halo
    확인(zoom 스크린샷).
  - 클립보드 공유 URL: Kakao SDK를 임시 비활성화해 강제로 클립보드
    경로를 타게 한 뒤, 복사된 URL의 `aptSeq` 파라미터가 실제 선택된
    마커의 aptSeq와 일치함을 확인.
  - 공유 링크 복원: 위에서 복사한 URL로 새로 진입 → center/zoom/region/
    선택 마커(그린 스타일+바텀시트)까지 전부 복원되는 것을 확인(§14의
    두 버그 수정 후).
  - wrong-match 부재: 존재하지 않는 aptSeq로 진입 시 선택 없이 정상
    지도만 표시되는 것을 확인(다른 단지로 대체되지 않음).
  - 상세 이동 회귀: 마커 클릭(2회) 및 바텀시트 "상세보기" 모두
    `/apt/{name}?lawdCd=&dong=` 정상 이동 확인.
  - 학교 마커/레이어 토글/드래그/줌 등 손대지 않은 기존 기능은 화면상
    이상 없음을 확인.

## 20. Known Limitations

- 거래유형(매/전) 동시 표시는 하지 않음(§8) — 지도가 현재 매매만
  fetch하기 때문, 전세 fetch 추가는 향후 별도 STEP 검토 대상.
- zoom 3단계 정보 밀도(§9)는 기존 이진 compact/detailed 구조를 유지,
  3번째 tier는 다음 기회로 미룸.
- selected marker의 "1회 pop 애니메이션"(§18 of the STEP spec)은
  구현했지만(260ms 1회성, prefers-reduced-motion 존중), 자동화 브라우저
  환경에서는 애니메이션 자체의 시각적 검증(스크린샷은 정적 프레임만
  캡처)이 제한적이었다 — 코드 로직(상태 전이/타이머 정리)은 단위
  테스트 대상이 아니라 리뷰로만 확인했다.
- Mobile 360/375/390 정확한 뷰포트 재현은 이 세션의 `resize_window` 도구
  제약으로 완전히 독립적으로 보장하지 못했다(§15).
- 서울 강남구 등 `ApartmentMaster` 좌표 미커버 지역은 이번 STEP과 무관한
  기존 데이터 커버리지 제약으로 마커가 뜨지 않는다(§19).

## 21. Next Step

ChatGPT PM 지시 대기 — 후보: `84SQM_RANKING`(요청된 다음 통계 기능) 또는
`FIX_MAP_MARKER_UX`(이번 STEP의 known limitation 후속 보완, 특히 §20의
zoom 3단계/전세 동시 표시).
