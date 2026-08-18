# MAP-FIX STEP 49 — 지도 마커/바텀시트 상세보기 hover 해제 버그 수정

상태: **구현 완료 / commit·push 하지 않음(사용자 검수 대기)**

성격: `/map`(PC) 화면에서 아파트 마커에 마우스를 올리면 하단에 상세
정보/"상세보기"가 나타나지만, 마우스를 그 영역으로 이동하려는 순간
hover가 풀려 바텀시트가 사라지는 기존 버그를 수정. STEP48에서 발견되어
별도 이슈로만 기록해 두었던 것을 이번 STEP에서 실제로 조사·수정했다.

## 기존 현상

PC `/map`에서:
1. 아파트 가격/단지 마커에 마우스를 올리면 하단에 단지 정보와
   "상세보기"가 나타난다.
2. "상세보기"를 클릭하려고 마우스를 마커에서 하단 바텀시트로
   이동하면, 그 순간 hover가 풀리며 바텀시트가 사라진다.
3. 결과: 마우스로 "상세보기"를 클릭하기 어렵거나 사실상 불가능하다.

## 원인 (실제 코드로 확정)

`src/app/map/page.tsx`에서 마커 hover와 클릭 선택이 **하나의 state**
(`selectedMarkerId`)를 공유하고 있었다:

```ts
const handleSelect = () => setSelectedMarkerId(marker.id);
const handleDeselect = () => setSelectedMarkerId((cur) => (cur === marker.id ? null : cur));
// ...
onMouseEnter={handleSelect}
onMouseLeave={handleDeselect}
```

`onMouseEnter`가 이미 `selectedMarkerId`를 세팅해버려서 바텀시트가 뜨고,
마우스가 마커를 벗어나는 순간 `onMouseLeave`가 즉시 그 값을 지워
바텀시트가 사라졌다. 바텀시트 자체는 `position: fixed`로 마커와 물리적
DOM 위치가 분리돼 있어(화면 하단 고정), 마우스가 마커에서 바텀시트로
이동하는 경로 어디에서든 마커 영역을 벗어나는 순간 `onMouseLeave`가
발생한다 — 그 사이 빈 공간이 마커 hover 영역이 아니기 때문에 100%
재현되는 구조적 문제였다.

부가적으로, `handleClick`의 "이미 선택된 마커를 다시 클릭하면
상세페이지로 이동" 분기도 `selectedMarkerId`가 hover만으로 이미
채워져 있어 사실상 **첫 클릭에 곧바로 상세페이지로 이동**해버리는
의도치 않은 부작용이 있었다(주석에 쓰인 "첫 클릭은 카드를 띄우고..."
라는 설계 의도가 hover 때문에 실제로는 작동하지 않고 있었다).

## 기존 hover state / selected state

- **기존**: `selectedMarkerId` 하나 — hover(`onMouseEnter`/
  `onMouseLeave`)와 click(`onClick`)이 전부 이 값 하나를 읽고 쓴다.
- **바텀시트 표시 조건**: `{selectedMarker && (...)}`,
  `selectedMarker`는 `selectedMarkerId`로 `aptClusters`에서 찾은 마커.

## 최종 state 구조

`hoveredMarkerId`(hover 전용)를 새로 추가하고, `selectedMarkerId`는
click 전용으로 의미를 명확히 좁혔다. 표시/렌더용 파생값
`activeMarkerId = selectedMarkerId ?? hoveredMarkerId`(§5 지시의
"selectedApartment ?? hoveredApartment" 우선순위를 그대로 반영)를
바텀시트 내용과 마커 칩의 시각적 강조(ring/scale/zIndex)에 공통으로
사용한다.

```ts
const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
const activeMarkerId = selectedMarkerId ?? hoveredMarkerId;
```

`selectedMarker`(바텀시트 데이터)는 이제 `activeMarkerId` 기준으로
찾는다. 마커 칩의 `selected` 여부, 클러스터 zIndex 계산도 모두
`activeMarkerId` 기준으로 바꿨다 — 락(click)이 있는 동안에는
`selectedMarkerId`가 우선이라 다른 마커를 hover해도 바텀시트/강조가
바뀌지 않는다.

## hover 동작

```ts
const handleHoverEnter = () => setHoveredMarkerId(marker.id);
const handleHoverLeave = () => setHoveredMarkerId((cur) => (cur === marker.id ? null : cur));
```

`onMouseEnter`/`onMouseLeave`가 이제 `hoveredMarkerId`만 건드린다 —
click으로 고정된 `selectedMarkerId`에는 전혀 영향을 주지 않는다. 마커를
그냥 hover만 하고 클릭하지 않은 채 마우스를 떼면(다른 곳으로 이동해도)
미리보기이므로 사라지는 것이 자연스럽고 의도된 동작이다(진짜 버그는
"클릭해서 고정한 뒤에도 사라진다"는 것이었고, 이는 아래에서 해결됨).

## click 동작

`handleClick`(마커 자체의 onClick)은 수정하지 않았다 — 여전히
"이미 `selectedMarkerId`가 이 마커면 상세페이지로 이동, 아니면
`selectedMarkerId`를 이 마커로 세팅"이다. 다만 이제 hover가
`selectedMarkerId`를 더 이상 건드리지 않으므로, **원래 의도대로**
"첫 클릭 = 고정(바텀시트 표시), 이미 고정된 마커를 다시 클릭 = 상세
이동" 흐름이 실제로 작동하게 됐다(기존에는 hover 때문에 첫 클릭이
곧바로 이동해버리는 부작용이 있었던 것이 부수적으로 함께 고쳐졌다).

## 바텀시트 유지 여부

**핵심 수정 결과**: 마커를 클릭해 고정한 뒤 마우스를 마커 밖(바텀시트
쪽 포함 임의의 경로)으로 이동해도 `selectedMarkerId`는 지워지지
않으므로(`hoveredMarkerId`만 변하고, `activeMarkerId`는 여전히
`selectedMarkerId`를 우선 사용) 바텀시트가 계속 표시된다. 실제
localhost 브라우저로 재현해 확인했다(아래 §PC 검증 참고).

## 상세보기 URL 로직

변경하지 않았다. 기존 그대로:
`router.push(`/apt/${encodeURIComponent(marker.name)}?lawdCd=${currentLawdCd}&dong=${encodeURIComponent(marker.dong)}`)`.
새 routing 규칙을 만들지 않았고, `lawdCd`/`dong` 파라미터도 그대로
재사용했다.

## 지도 검색 / ApartmentAutocomplete

건드리지 않았다. `src/components/ApartmentAutocomplete.tsx`는 이번
STEP에서 전혀 수정하지 않았고, `page.tsx` 안의 검색창 관련 로직도
무수정이다.

## 바텀시트 UI

내용/디자인 변경 없음 — 단지명, 지역, 가격, 상세보기 버튼, X 전부
기존 마크업/스타일 그대로. `selectedMarker`가 가리키는 값의 계산
소스만(`selectedMarkerId` → `activeMarkerId`) 바뀌었다.

## 하단 nav

`MapBottomNav` 컴포넌트/스타일 전혀 수정하지 않았다.

## PC 검증 (localhost, 실제 브라우저로 7개 시나리오 확인)

| 케이스 | 결과 |
|---|---|
| 1. 마커 hover → 바텀시트 표시 | 통과 |
| 2. 마커 click → 바텀시트 고정 | 통과 |
| 3. 마우스를 marker→바텀시트로 이동 → 바텀시트 유지 | **통과(핵심 버그 수정 확인)** — 마커에서 "상세보기" 버튼까지 마우스를 이동시켜도 시트가 사라지지 않음을 스크린샷으로 확인 |
| 4. "상세보기" 클릭 → 정확한 상세페이지 진입 | 통과 — `/apt/대신롯데캐슬?lawdCd=26140&dong=서대신동3가`로 정상 이동 |
| 5. X 클릭 → 바텀시트 닫힘 | 통과 |
| 6. 다른 marker click → 새 단지로 교체 | 통과 — 대신롯데캐슬 선택 중 송천 클릭 시 송천으로 즉시 교체 |
| 7. 지도 빈 곳 click → 선택 해제 | 통과(기존에 이미 구현돼 있던 `onClick={() => setSelectedMarkerId(null)}`, 무수정으로 재확인) |

## 모바일 영향

`onMouseEnter`/`onMouseLeave`는 터치 디바이스에서 발생하지 않는
이벤트라 모바일 동작에는 관여하지 않는다. 모바일이 쓰는 `onClick`
(`handleClick`)은 이번 STEP에서 **한 글자도 수정하지 않았다** —
`grep`으로 `onTouch`/`onPointerDown` 등 별도 터치 핸들러가 없음을
확인했고, React의 표준 합성 클릭 이벤트만 사용 중이므로 모바일
탭 동작은 코드 근거로 회귀 없음을 확신할 수 있다. 실기기 재현
테스트는 이번 STEP에서 하지 않았다(PC 버그 수정이 목적이었고, 코드
경로 자체를 건드리지 않았기 때문).

## 수정 파일

`src/app/map/page.tsx` 1개만 수정했다. 다른 파일(컴포넌트, API route,
`ApartmentAutocomplete.tsx`, `Header`/`MapBottomNav` 등)은 전혀
건드리지 않았다.

## 회귀

- 지도 검색: 무수정
- 하단 nav: 무수정
- 바텀시트 UI(내용/디자인): 무수정
- 상세 URL 로직: 무수정
- 학교 마커(`schoolMarkers`) 클릭 로직: 무수정(hover 관련 코드 없음,
  원래부터 클릭 즉시 이동)
- 클러스터 그룹(여러 마커 겹침) zIndex 로직: `selectedMarkerId` →
  `activeMarkerId`로 참조만 바꿨고 계산 로직 자체는 무수정

## DB/schema/migration

변경 없음.

## 정적 검증

```
npx tsc --noEmit     → 0 errors
npx eslint src/app/map/page.tsx → 0 errors/warnings
npx next build        → 컴파일 성공, /map 라우트 정상 등록
```

## 알려진 한계

1. 순수 hover(클릭하지 않은 상태)에서 마우스를 마커 밖으로 이동하면
   바텀시트가 사라지는 것은 **의도된 동작**(미리보기)으로 유지했다 —
   실제 버그였던 "클릭 후 고정된 상태에서도 사라지는" 문제만
   수정했다. 사용자가 "상세보기"를 누르려면 먼저 마커를 한 번
   클릭해야 한다.
2. 모바일 실기기 회귀 테스트는 코드 경로 무수정에 근거한 판단이며,
   직접 탭 재현은 하지 않았다.
3. 클릭으로 한 마커가 고정된 동안 다른 마커를 hover해도 시각적
   강조(ring)나 바텀시트가 바뀌지 않는다(우선순위상 의도된 설계) —
   "고정 중에는 hover가 무시된다"는 동작 자체를 별도로 사용자에게
   시각적으로 안내하지는 않는다.

## 다음 STEP 후보

- (기존 대기열) 노선 실시간 도착정보, 교통점수 체계, 이집 브리핑 연동
- 모바일 실기기에서 이번 수정의 영향 없음을 직접 재현 확인(선택)
