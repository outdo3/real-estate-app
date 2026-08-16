# STEP 37 — APT DETAIL B2-3 FIX: 평형 선택 순서 정렬

상태: 구현 완료 / 사용자 검수 대기(commit/push 없음)

성격: 표시 순서(정렬)만 수정. `selectedArea` 데이터 연결, raw area internal
key, collision 해소 알고리즘(area-utils.ts), 거래 부족 정책은 전혀 건드리지
않았다. 기준 commit `1ebd84038ac30bcdbec1355c51a54192dc55034f`(B2-2/B2-3
production 배포분, origin/main과 동일).

---

## 0. 배경

B2-2/B2-3 production 배포 후 사용자 모바일 검수에서 "평형 선택 칩 순서가
무작위처럼 보인다"는 문제가 확인됨. 예:

- 명륜아이파크1단지: 전체 → 84.99㎡ → 62.64㎡ → 85㎡ → 126.99㎡
- 엘지메트로시티3: 전체 → 84.98㎡ → 125.4㎡ → 102.52㎡ → 69.72㎡

기능 자체(색상 분리, selectedArea 연동, collision 방지, silent fallback
제거)는 이미 정상 확인되었으므로 이번 STEP은 표시 순서만 수정한다.

## 1. 조사

`src/components/AreaSelector.tsx`가 평형 목록을 생성하는 유일한 위치다.
`TradeTimelineList.tsx`/`FloorPlanPanel.tsx`는 부모가 만든 `areaLabels` Map을
조회만 할 뿐 별도의 평형 목록/정렬을 갖지 않는다.

이 컴포넌트는 두 개의 목록을 만든다.

```ts
// (변경 전)
const allAreas = Array.from(countByArea.keys())
  .sort((a, b) => parseFloat(a) - parseFloat(b));           // 모달용 — 이미 오름차순

const topAreas = Array.from(countByArea.entries())
  .sort((a, b) => b[1] - a[1])                               // 상단 칩용 — 거래 건수(count) 내림차순
  .slice(0, MAX_CHIPS)
  .map(([area]) => area);

const chipAreas = selectedArea !== '전체' && !topAreas.includes(selectedArea)
  ? [...topAreas, selectedArea]
  : topAreas;
```

원인 확정:

- **모달("전체 평형 선택")** — `allAreas`는 이미 `parseFloat` 기반 오름차순
  정렬이 되어 있었다. 문제 없음.
- **상단 가로 칩** — `topAreas`(→`chipAreas`)는 "거래량이 많은 상위 4개만
  칩으로 노출"하기 위해 거래 **건수** 내림차순으로 정렬되어 있었다. 이 정렬
  결과를 그대로 렌더링해서, 화면상으로는 면적 크기와 무관한 순서로 보였다.
  API 응답순 / 거래 최신순 / Map 삽입순이 원인이 아니라, **의도된 별도
  sort의 정렬 기준(거래량)과 사용자가 기대하는 정렬 기준(면적)이 다른
  것**이 원인이었다.

selectedArea key: `apt-client.tsx`의 `selectedArea` state(원본 `trade.area`
문자열)가 그대로 prop으로 전달되고, `AreaSelector`는 이 값을 가공 없이
`trades[].area`와 비교(`onSelect(area)`)만 한다 — 내부 key 변형 없음.

collision label: `areaLabels` Map은 부모가 이미 계산해서 전달하고,
`AreaSelector`는 `resolveAreaLabel()`로 조회만 한다. 정렬은 이 Map과
독립적인 "배열 순서" 문제이므로, label 계산 이후 렌더 직전에 정렬을
추가해도 collision 알고리즘과 상호작용하지 않는다.

'전체' sentinel: 두 목록(`allAreas`, `chipAreas`) 어디에도 포함되지 않고,
렌더 시 항상 별도 `<button>`으로 하드코딩되어 맨 앞에 위치한다 — 이미
정책과 일치, 변경 불필요.

## 2. 구현

`src/components/AreaSelector.tsx` 한 곳만 수정. `topAreas`(거래량 기준
상위 4개 선정 로직)는 그대로 두고, 최종 `chipAreas`를 렌더링 직전
전용면적 오름차순으로 재정렬했다.

```ts
// (변경 후)
const chipAreas = (selectedArea !== '전체' && !topAreas.includes(selectedArea)
  ? [...topAreas, selectedArea]
  : topAreas
).sort((a, b) => parseFloat(a) - parseFloat(b));
```

- 어떤 평형이 상위 칩으로 뽑히는지(거래량 기준 top 4 + 현재 선택된 평형
  강제 포함)는 그대로 유지 — 이번 STEP은 "정렬만" 추가한다는 지시를 따름.
- `allAreas`(모달)는 이미 정답이라 수정하지 않음 — 두 목록이 동일한
  `parseFloat` 오름차순 규칙을 쓰므로 상단 칩과 모달의 순서가 항상
  일치한다.
- `key={area}`, `onSelect(area)`, `renderAreaLabel(area)` 등 원본 문자열을
  다루는 부분은 전혀 손대지 않음 — internal raw key 불변.

## 3. 테스트 결과

- `npx tsc --noEmit` — 통과
- `npx eslint src/components/AreaSelector.tsx` — 통과
- `npx next build` — 통과
- `git status --short` → `M src/components/AreaSelector.tsx` 1개 파일만 변경
  (DB/schema/migration 무관)

브라우저 실측(localhost:3000, 수정 후 코드 기준):

| 단지 | 수정 전(운영 확인) | 수정 후(로컬 확인) |
|---|---|---|
| 명륜아이파크1단지 | 전체·84.99·62.64·85·126.99 | 전체·62.64·84.99·85·126.99 |
| 엘지메트로시티3 | 전체·84.98·125.4·102.52·69.72 | 전체·69.72·84.98·102.52·125.4 |
| 대신푸르지오1차 | 전체·84.65·84.94·102.79·74.61(모달 순서 기준) | 전체·74.61·84.65·84.94·102.79 |

- 명륜아이파크1단지 모달: `62.64(12건) → 84.92(5건) → 84.99(22건) →
  85(9건) → 109.21(4건) → 110.18(1건) → 110.33(1건) → 126.9(3건)` — collision
  쌍(84.92/84.99)이 서로 독립적으로 유지되며 오름차순 확인.
- 84.92㎡ 선택 → Hero "8억 8,800만 · 전용 84.92㎡" 정확히 반영, chip row에
  선택된 평형이 추가되어도 오름차순 유지(전체·62.64·84.92·84.99·85·126.99).
- 엘지메트로시티3 243.35㎡(거래 부족 사례) 재확인: "선택 평형은 매매
  거래가 적어 추이를 표시하기 어렵습니다" 안내 + 전세만 표시, Metrics
  4개 항목 모두 "데이터 부족" — B2-3 정책 회귀 없음.

## 4. 알려진 문제

없음.

## 5. 다음 STEP

사용자 모바일 검수 대기. 검수 완료 후 별도 지시에 따라 commit/push한다.
이번 STEP에서 B2-1이나 다른 작업으로 자동 진행하지 않는다.
