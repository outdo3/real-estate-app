# MAP UI POLISH V1

## 1. Goal

`/map`의 공유 버튼을 사용자가 확정한 최종 시각 방향(검색바와 분리된 독립
이집 Green 원형 버튼 + 흰 Share 아이콘, 텍스트 없음)으로 확정하고, 그 버튼과
우측 세로 레이어 토글 아래로 단지 마커가 시각적으로 겹쳐 보이던 문제를
해결한다. MAP MARKER UX V2(가격+면적, compact price, trusted pyeong,
selected green fill/halo/keyboard focus, share selected restore)는 절대
회귀시키지 않는다 — 이번 STEP은 순수 레이아웃/시각 polish다.

## 2. Final Share Button Direction

사용자가 확정한 계약:

- 검색바 오른쪽에 완전히 독립된 원형 버튼(검색바 내부 아님)
- 배경: 기존 `--ejip-green` 토큰(새 색상 토큰 없음)
- 아이콘: 흰색 `Share2`(lucide-react), 텍스트 없음
- 지름 44px(권장 40~44px 범위 안), 아이콘 18px(권장 18~20px 범위 안)
- `aria-label="공유"`, 키보드 focus 가능, tap target 44px

`src/components/ShareAction.tsx`에 `tone?: 'neutral' | 'brand'` prop을
추가했다(`variant="icon"` 전용). 기본값 `'neutral'`은 기존
`.iconBtn`(흰 배경 + 회색 아이콘 — 커뮤니티 게시글/AI검색 결과가 이미
쓰던 스타일)을 그대로 유지해 **다른 페이지는 전혀 바뀌지 않는다**.
`tone="brand"`일 때만 새 `.iconBtnBrand`(이집 Green 배경 + 흰 아이콘)가
적용되고, 지도에서만 `<ShareAction variant="icon" tone="brand" ... />`로
명시적으로 켰다. `useSharePage` 훅(네이티브 공유 → 카카오 카드 → 클립보드
우선순위, URL 파라미터 구성)은 전혀 건드리지 않아 공유 동작 자체는
100% 동일하다.

## 3. Search Row Layout

기존에는 검색창(`ApartmentAutocomplete`) + "내 위치" 버튼 + 공유 버튼이
모두 같은 흰 알약(pill) 컨테이너 안의 flex 자식이었다. 이번 STEP에서
바깥 row를 두 단으로 나눴다:

```
[ 바깥 row(투명, flex, gap 0.5rem) ]
  ├─ [ 흰 알약(검색 input flex:1 + "내 위치" 버튼) ]
  └─ [ 공유 원형 버튼(독립, flex-shrink:0) ]
```

검색 input의 실제 가용 폭은 수학적으로 이전과 완전히 동일하다 — 이전에는
공유 버튼이 알약 "안"에서 폭(44px)+gap(8px)을 가져갔고, 지금은 알약
"밖"의 바깥 row에서 같은 폭+gap을 가져간다. 순서/제약이 바뀌었을 뿐
검색 input이 실제로 쓸 수 있는 픽셀 수는 그대로다(§6 회귀 없음, 아래
실측 참고). 검색 결과 드롭다운(`ApartmentAutocomplete` 내부 컴포넌트)은
같은 알약 안의 상대 위치에서 그대로 렌더되므로 검색어/clear 버튼을
가리는 절대 오버레이는 추가하지 않았다.

## 4. Control Safe Zone

**전략 선택**: STEP이 제시한 우선순위(A. 클러스터링/뷰포트 계산에 컨트롤
패딩 반영, B. fitBounds 패딩, C. hide/offset, D. CSS 마스크) 중 A를
택했다 — 마커 데이터는 그대로 두고, 클러스터링 반경/그룹핑 로직은 전혀
바꾸지 않은 채(§17), 이미 계산돼 있는 화면 픽셀 좌표
(`projection.containerPointFromCoords`)를 기준으로 컨트롤 rect와
겹치는 칩만 최소한으로 화면상에서 밀어내는 순수 함수 하나를 추가했다.

`src/lib/map-control-safe-zone.ts`(신규):
- `computeSafeZoneNudge(point, halfW, halfH, topZone, rightZone, buffer)`
  — 칩이 top zone과 겹치면 아래로, right zone과 겹치면 왼쪽으로만
  민다(단일 방향, 예측 가능). 두 zone과 동시에 겹치면(우상단 모서리)
  두 보정이 함께 적용된다.
- `computeNudgedCenterPoint(centerPoint, nudge)` — §12(검색 선택 오프셋)
  전용, 지도 중심을 얼마나 옮겨야 원하는 화면 위치에 오는지 순수하게
  계산(아래 §5).

**Safe zone 측정**(§10, 하드코딩 최소화): `map/page.tsx`에 세 개의
ref(`mapViewportRef`, `topControlRowRef`, `rightControlRef`)를 달고,
mount + `window resize` 시에만 `getBoundingClientRect()`로 실제 DOM
rect를 측정한다(§30 — scroll/mousemove마다 재는 것 아님). CSS 변수
대신 React state(`safeZoneRects`)로 보관 — 이 페이지는 이미 인라인
style 전용이라 기존 관례(CSS 변수 없음)를 그대로 따랐다.

**적용**: `recomputeClusters()`가 클러스터별 평균 픽셀 위치(이미
클러스터링을 위해 계산해둔 값 재사용)로 nudge를 계산해
`clusterNudges: Map<clusterId, {dx,dy}>`에 저장한다. 렌더링 시 기존
grid-offset(`left/top`)과 single-marker transform(`translateY(-10px)`)
에 이 nudge를 더하기만 한다 — marker의 실제 `lat/lng`, 클릭 핸들러,
identity는 전혀 바뀌지 않는다(§9 — 데이터를 지우지 않음, pan/zoom 후
자연스럽게 다시 정상 위치 근처로 돌아옴).

## 5. Selected Marker Offset

검색으로 단지를 선택하면 기존처럼 `panTo(anchor)` + `setLevel(3)`로
정중앙에 놓는다. 이번 STEP에서 추가한 것: pan 애니메이션이 끝난 뒤(350ms
지연, 딱 한 번만) 실제 투영 좌표를 확인해 그 지점이 safe-zone과 겹치면
`computeNudgedCenterPoint`로 center를 최소한만 보정한다. `panBy`의 부호
규칙을 추측하지 않고 `coordsFromContainerPoint`↔`containerPointFromCoords`
가 서로 정확한 역변환이라는 성질만 이용해 계산했다 — 겹치지 않으면
아무 보정도 하지 않는다("과도한 이동 금지").

## 6. Z-index

기존 계층을 그대로 유지했다: 상단/우측 컨트롤 `zIndex: 10`, 일반 마커
`zIndex: 1`, 선택된 마커/클러스터 `zIndex: 9999`. 공유 버튼을 알약 밖으로
꺼냈지만 같은 `zIndex:10` 부모 row 안에 있어 마커보다는 항상 위, 하지만
검색 자동완성 드롭다운(알약 내부의 자연스러운 DOM 순서로 그 위에 뜸)이나
다른 모달보다 무조건 높게 두지 않았다(§13).

## 7. Pointer Events

공유 버튼은 평범한 `<button>`이라 기본적으로 포인터 이벤트를 정상
가로챈다 — 아래 마커로의 click-through는 발생하지 않는다(§14, 실측
확인: 버튼 클릭 시 항상 공유 동작만 실행되고 마커 선택으로 새지 않음).
safe-zone nudge는 시각적 위치만 옮길 뿐 별도 pointer-events 처리를
추가하지 않았다 — 마커 클릭 대상 자체가 이동하므로 클릭도 이동된
위치를 따라간다(자연스러움).

## 8. Mobile

이 세션 환경의 `resize_window`가 요청한 CSS px(375 등)를 정확히
반영하지 않아(이전 STEP들에서도 동일하게 보고된 도구 제약), 실제 DOM
측정으로 보완했다: "내 위치" 버튼 실측 폭 93px(고정, `flexShrink:0`이라
뷰포트 폭과 무관), 공유 원형 44×44px. 360px 뷰포트 기준 계산:
`360 - 32(좌우 마진) - 8(gap) - 44(공유 원형) = 276px`(흰 알약 폭) →
`276 - 16(알약 패딩) - 93(내 위치) - 8(gap) = 159px`(검색 input 가용
폭) — 이 값은 **이전 구조(공유 버튼이 알약 안에 있던 상태)와 수학적으로
완전히 동일**하다(§3 참고, §6 회귀 없음). `hasHorizontalOverflow: false`
를 실제 렌더링된 좁은 폭에서 확인했고, 스크린샷상 공유 원형 클리핑/우측
컨트롤 충돌/하단 네비게이션 충돌은 없었다.

## 9. Desktop

1280px에서 공유 원형이 과도하게 크지 않고(44px, 기존 "내 위치"/레이어
토글 버튼과 같은 높이 리듬), 검색바와 자연스럽게 정렬된다.

## 10. Accessibility

`aria-label="공유"`(brand tone 전용, 다른 페이지의 기존 `aria-label="공유하기"`
는 그대로 유지해 회귀 없음), 네이티브 `<button>`이라 키보드 Enter/Space가
기본 동작한다. `:focus-visible`에서 흰 아웃라인(2px) + 진한 그린
box-shadow ring을 함께 써서 초록 배경 위에서도 포커스가 명확히
보이게 했다(초록 배경 + 초록 아웃라인은 대비가 낮아 부적절 — §21의
"E-JIP Green 계열 또는 existing accessible focus style" 중 실제 대비를
보장하는 쪽을 택함).

## 11. QA

- `npx tsc --noEmit`: 변경 파일 신규 오류 0(기존 `scripts/*` 34건만
  존재, 분리 보고).
- `npm run lint`(변경 파일): 0 errors, 0 warnings(1차 실행에서
  `react-hooks/refs` 오류 발견 — `pendingSelectedApt`의 nudge를 렌더
  중 `mapRef.current`를 직접 읽어 계산하던 것을 `useCallback` +
  `useEffect` + state(`pendingNudge`)로 옮겨 수정, MAP MARKER UX V2에서
  겪은 것과 같은 유형의 실수를 재발견/재수정).
- `npm run build`: PASS, 35개 라우트 정상 생성.
- 순수 함수 단위 검증(임시 스크립트로 직접 실행 후 삭제 — 저장소에
  남기지 않음): `computeSafeZoneNudge`의 top-only/right-only/corner(둘
  다)/겹침 없음/zone 없음 5개 케이스와 `computeNudgedCenterPoint`의
  역변환 공식을 전부 수치로 확인, 기대값과 정확히 일치.
- 브라우저(Chrome, 로컬 dev) 실측:
  - **Safe-zone before/after 증거**: zoom=6(고밀도) 뷰포트에서 렌더된
    36개 칩 중 2개("60㎡ 1.89억", "85㎡ 2.45억")가 실제로 top
    safe-zone과 겹쳐 각각 63.6px, 38.6px 아래로 밀려난 것을 DOM
    transform 값으로 직접 측정 — 이 두 마커는 nudge가 없었다면 상단
    검색바 아래로 가려졌을 것들이다. 나머지 34개는 겹치지 않아
    nudge=0(불필요한 이동 없음, 최소 개입 확인).
  - 부산 서구/연제구(대신롯데캐슬/연산동한솔솔파크 검색 선택) 확인:
    선택 즉시 정중앙 배치, 초록 fill(검정 강조 없음), safe-zone과
    겹치지 않음, 바텀시트 정상(면적+가격, raw ㎡ 폴백 포함).
  - 공유 URL: Kakao/네이티브 공유를 임시 비활성화해 클립보드 경로로
    강제한 뒤 복사된 URL의 `aptSeq`가 실제 선택된 마커와 일치함을
    확인(§15 URL contract 불변).
  - 공유 링크 복원: 복사한 URL로 새로 진입 → center/zoom/region/선택
    마커(초록 스타일 + 바텀시트)까지 전부 복원, 마커가 safe-zone
    밖에서 보임을 확인.
  - 상세 이동: 마커 클릭/바텀시트 "상세보기" 모두 정상 이동 확인.
  - 레이어 토글("오피스텔" on/off): 기존 "준비 중" 안내 정상 표시,
    콘솔 오류 없음.
  - 키보드: 공유 버튼 `aria-label="공유"`, `tabIndex=0` 확인.

## 12. Regression

지도 로드, 지역(lawdCd) 전환, 검색, 마커 클릭, 상세 이동, pan/zoom,
공유, 공유 복원, selected marker(초록 fill/halo/scale/keyboard focus),
하단 네비게이션 — 전부 기존과 동일하게 동작하는 것을 확인했다. 콘솔
오류 없음.

## 13. Known Limitations

- 이 세션의 `resize_window` 도구가 정확한 360/375/390 CSS px 뷰포트를
  재현하지 않아, 정밀 모바일 QA는 실제 DOM rect 측정(§8)으로
  보완했다 — 완전히 독립적인 시각 재현으로 보장하지는 못했다.
- Safe-zone nudge는 화면 픽셀 단위의 시각적 보정이라, 매우 빠른 연속
  pan/zoom 중에는 잠깐(다음 idle 이벤트까지) 오래된 nudge 값이 보일 수
  있다 — 마커가 사라지거나 클릭 불가능해지지는 않고, 다음 'idle'에서
  항상 다시 정확해진다(§9 요구사항 충족, 시각적 완벽한 프레임 동기화는
  범위 밖).
- 검색-선택 offset(§5)은 350ms 지연 이후 한 번만 확인한다 — 그 사이
  사용자가 다시 지도를 조작하면(드문 케이스) 보정이 스킵될 수 있다.

## 14. Next Step

ChatGPT PM 지시 대기 — 후보: `84SQM_RANKING` 또는 `FIX_MAP_UI_POLISH`
(이번 STEP의 known limitation 후속 보완).
