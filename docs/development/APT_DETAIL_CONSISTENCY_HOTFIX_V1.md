# APT DETAIL CONSISTENCY HOTFIX V1

baseline: `2b62be5` (main)
날짜: 2026-08-28

## 1. Goal

아파트 상세 페이지(`/apt/[name]`)에서 단지별로 UI 구조 자체가 달라 보이는
불일치를 제거한다. ㎡/평 토글은 모든 단지에서 항상 같은 자리에 노출되고,
평형 데이터가 없을 때는 숨기거나 임의로 계산하지 않고 정직하게
"평형 정보 없음"을 보여준다. 모바일 하단 Sticky Action Bar는 항상
관심단지/공유/글쓰기 3개 행동으로 고정되고, 찜 상태에 따라 버튼 폭이
달라지지 않는다.

## 2. Regression Fixtures (사용자 제공)

- **A. 대신롯데캐슬** — 최초 보고: 토글 노출, 14평/25평류 pyeong 칩, 하단
  바 겹침 없음(정상 동작으로 보고됨).
- **B. 동대신역비스타동원아파트** — 최초 보고: 토글 자체가 안 보임, 면적
  칩이 raw ㎡만 표시, 하단 바가 "관심단지 저장"/"공유하기"로 겹침.

## 3. Root Cause Analysis

### 3.1 토글이 사라지는 원인 (§B)

`apt-client.tsx`의 toggle 래퍼가
`{Array.isArray(unitMaster) && unitMaster.some(u => u.representativePyeong != null) && (...)}`
로 **Unit Master에 trustworthy pyeong이 하나라도 있을 때만** 렌더링되고
있었다. Unit Master 커버리지가 낮은 단지(§6 참고)는 이 조건이 항상
false가 되어 토글 UI 자체가 통째로 사라졌다 — 데이터가 없는 게 아니라
"토글을 보여줄지 말지"를 잘못된 게이트로 판단한 구조적 버그였다.

### 3.2 Sticky Bar 버튼 폭이 단지마다 달라 보이는 원인

실제로는 단지별 문제가 아니라 **세션/찜 상태 의존 버그**였다.
`FavoriteButton.tsx`가 `{!compact && (isActive ? '관심단지' : '관심단지
저장')}`로 텍스트 길이를 찜 여부에 따라 바꾸고 있었다 — 로그인한 계정에서
이미 찜한 단지는 짧은 문구("관심단지"), 찜하지 않은 단지는 긴
문구("관심단지 저장")가 나와 폭이 달라졌다. 두 픽스처가 다르게 보인 건
단지 자체 속성이 아니라 "그 세션에서 어느 쪽이 찜되어 있었는가"였다.

### 3.3 충돌 해소 보조 라벨이 죽어 있던 이유 (부수 발견)

`AreaChip.tsx`의 `shouldShowPyeongLabel()`은
`data.supplyAreaM2 !== null && !!data.pyeongLabel`을 게이트로 쓰는데,
`AreaSelector.tsx`의 기존 `toAreaChipData`가 `supplyAreaM2: null`을 항상
고정으로 넘기고 있어 이 게이트가 구조적으로 항상 false였다 — 즉 같은
평형으로 수렴하는 서로 다른 전용면적(예: 84.7855㎡·84.995㎡가 둘 다
34평)을 구분해주는 보조 캡션이 **모든 단지에서** 나온 적이 없었다. 이번
토글 로직 재작성의 부수 효과로 함께 복구했다(§7).

## 4. Design Decisions

- 토글 UI는 Unit Master 존재 여부와 완전히 분리해 **항상** 렌더한다.
  데이터 유무는 토글 안쪽(칩 라벨/보조 캡션)에서만 표현한다.
- 평 모드에서 trustworthy `representativePyeong`이 없는 area는 절대
  `exclusiveArea / 3.3058`로 계산하지 않는다. raw ㎡ 표기를 유지하고
  "평형 정보 없음" 캡션만 덧붙인다(§4 데이터 신뢰 원칙).
- 찜 버튼의 가시 텍스트는 상태와 무관하게 "관심단지"로 고정한다. 상태는
  아이콘 fill로만 표현한다. `aria-label`/`title`은 접근성 목적상 상태별
  문구("관심단지 해제"/"관심단지 저장")를 그대로 유지한다 — 이건 화면에
  보이는 텍스트가 아니므로 레이아웃에 영향이 없다.
- chip 라벨 결정 로직을 `AreaSelector.tsx`에서 `src/lib/area-utils.ts`의
  순수 함수 `resolveAreaChipDisplay()`로 분리해, React 렌더링 없이 단위
  테스트 가능하게 만들었다(CASE A/B/C/D, §8).
- Sticky Action Bar는 `flex` 대신 `grid-template-columns: repeat(3,
  minmax(0, 1fr))`로 바꿔 3개 버튼이 항상 동일 폭을 갖도록 구조적으로
  강제했다 — 텍스트 길이가 바뀌어도 폭이 흔들리지 않는다.

## 5. Implementation

### 5.1 `src/app/apt/[name]/apt-client.tsx`

- ㎡/평 토글 래퍼에서 `hasUnitMaster`/`representativePyeong` 조건부
  렌더링 게이트를 제거 — 이제 항상 렌더링된다.
- 평 모드이고 이 단지에 trustworthy pyeong이 하나도 없을 때만 보이는
  짧은 inline 안내문("확인된 평형 정보가 없는 면적은 ㎡로
  표시됩니다.")을 추가했다. 일부만 없는 partial coverage 단지는 칩
  캡션만으로 충분하다고 판단해 이 안내문을 중복 노출하지 않는다.

### 5.2 `src/lib/area-utils.ts`

- `resolveAreaChipDisplay(unit, areaUnit, isCollision, fallbackLabel)`
  신규 순수 함수. CASE A(pyeong 있음)/B(Unit Master 자체 없음)/C(Unit
  Master row는 있으나 이 area만 pyeong 없음)/D(collision) 네 경우 모두
  fake 계산 없이 처리한다.
- `PYEONG_UNAVAILABLE_LABEL = '평형 정보 없음'` 상수화.

### 5.3 `src/components/AreaSelector.tsx`

- `toAreaChipData()`가 `resolveAreaChipDisplay()`에 위임하도록 리팩터링.
- `supplyAreaM2`를 `pyeongLabel != null ? parsedArea : null`로 채워
  `AreaChip.tsx`의 기존 게이트가 실제로 작동하게 복구(§3.3).
- "전체 평형" 모달에도 partial coverage(Unit Master row는 있지만 이
  area만 pyeong 없음) 케이스에 "평형 정보 없음" subLabel을 추가.

### 5.4 `src/components/FavoriteButton.tsx`

- non-compact(Sticky Bar 전용) 렌더 텍스트를 `{!compact && '관심단지'}`로
  고정. `aria-label`/`title`은 상태별 문구 유지(접근성, 비가시 텍스트).

### 5.5 `src/components/KakaoShareButton.tsx`

- `label?: string` prop 추가(기본값 `'공유하기'`). 기존 호출부(Hero,
  학교상세)는 변경 없이 그대로 동작하고, StickyActionBar만 짧은
  `"공유"`를 넘겨 3-action bar 폭을 좁게 유지한다.

### 5.6 `src/components/StickyActionBar.tsx`

- `KakaoShareButton`에 `label="공유"` 전달.

### 5.7 `src/app/apt/[name]/detail.module.css`

- `.stickyActionRow`를 `flex`에서 `display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));`로 변경.
- `.stickyActionItem > *`, `button`, `a`에 `max-width: 100%; overflow:
  hidden; text-overflow: ellipsis;` 추가해 텍스트 오버플로우를 구조적으로
  차단.

## 6. Unit Master Coverage Audit (Busan, read-only)

임시 read-only 스크립트(`tmp/qa-scratch/`, 커밋 대상 아님)로 실측:

| 항목 | 수치 |
|---|---|
| `ApartmentMaster`(부산, canonical) | 3,402건 |
| legacy `Apartment` 테이블 총계 | 63건 |
| `Apartment` 중 `unitTypes` 보유 | 11건 |
| `ApartmentUnitType` row 총계 | 99건 (전부 `SUPPLY_AREA_DERIVED`) |
| trustworthy pyeong 보유 단지 수 | 11건 (`ApartmentMaster` 대비 약 0.32%) |

즉 `representativePyeong`을 가진 legacy Unit Master는 `ApartmentMaster`
(canonical, 부산 3,402건) 전체 대비 극히 일부만 커버한다. 이번 STEP은
이 낮은 커버리지 자체를 넓히는 작업이 아니라, **커버리지가 낮은 상태에서도
UI가 정직하게 동작**하도록 만드는 작업이다(§10 권고 참고).

## 7. Automated QA — `scripts/run-apt-detail-consistency-qa.ts`

A파트(순수 함수, 서버 불필요) + B파트(dev 서버 대상 live 검증) 구조.

### 7.1 A파트 — 단위 테스트 + 정적 가드 (14개, 전부 PASS)

- `resolveAreaChipDisplay` CASE A/B/C/D 각 2개 안팎 케이스(대조군 포함).
- 정적 가드: `area-utils.ts`/`AreaSelector.tsx`/`apt-client.tsx` 코드
  본문(주석 제외)에 `3.3058`/`M2_PER_PYEONG` 나눗셈이 재도입되지 않았는지.
- 정적 가드: 토글이 다시 `hasUnitMaster &&` 게이트로 숨겨지지 않았는지
  (toggle 블록 직전 400자 내 패턴 검사).
- 정적 가드: `StickyActionBar.tsx`에 "관심단지 저장" 하드코딩 텍스트가
  없는지, `FavoriteButton.tsx`의 가시 children이 상태와 무관하게 고정
  문자열인지(주석/aria-label/title 제외하고 실제 렌더 텍스트만 검사).
- 정적 가드: `.stickyActionRow`가 `repeat(3, minmax(0, 1fr))` grid를
  유지하는지.

```
A파트: 14 passed, 0 failed.
```

### 7.2 B파트 — live 검증 (전부 PASS)

- 세 픽스처(대신롯데캐슬/동대신역비스타동원아파트/연산동한솔솔파크)
  페이지 모두 httpStatus=200.
- 회귀 스모크: `/apt/대신롯데캐슬`, `/map`, `/stats`, `/school` 모두
  httpStatus < 500.

실행: `npx tsx -r ./scripts/_register-paths.js
scripts/run-apt-detail-consistency-qa.ts --json` (dev 서버 기동 필요, 생략
시 `--skip-live`).

## 8. Browser QA

### 8.1 픽스처 A — 대신롯데캐슬 (390px, iframe-isolation)

- 토글 항상 노출 확인. 평 모드 전환 시 이 세션에서 실제로 로드된 Unit
  Master 응답이 비어 있어(§9 참고) 모든 칩이 "평형 정보 없음"으로
  정직하게 표시됨 — fake 계산 없음, 원본 문의(A: "14평/25평 노출")와는
  다른 결과지만 이는 §9의 별개 사전 존재 버그 때문이며 이번 STEP의
  퇴행이 아님.
- Sticky Action Bar: 관심단지/공유/글쓰기 3-column, 겹침 없음(zoom
  스크린샷으로 재확인).
- 360/375/390px에서 `document.documentElement.scrollWidth <=
  clientWidth` 전부 통과(가로 스크롤 없음), sticky 아이템 3개 폭이
  각 브레이크포인트에서 서로 완전히 동일(95/95/95, 100/100/100,
  105/105/105px).

### 8.2 픽스처 B — 동대신역비스타동원아파트 (390px)

- 최초 보고된 버그(토글 완전 숨김, 하단 바 겹침) 재현되지 않음 — 토글
  항상 노출, 평 모드에서 "평형 정보 없음" + inline 안내문 정상 표시,
  Sticky Bar 3-action 정렬 정상.

### 8.3 픽스처 C — 연산동한솔솔파크 (데스크톱, Unit Master row는 있으나
unit type 0건)

- 84.99/84.996/84.998/84.999㎡ 4개의 근접 area가 ㎡ 모드에서 서로 다른
  라벨로 정확히 구분됨. 평 모드 전환 시 4개 전부 "평형 정보 없음" +
  raw ㎡ 유지(fake 계산 없음 재확인).
- "전체 평형" 모달: Unit Master 자체가 없는 단지라 기존 거래건수
  subLabel을 그대로 유지(허위 정보 없음 — 사소한 문구 비대칭이지만
  데이터 신뢰 위반은 아님, §10.3 참고).
- area 칩 클릭 시 필터가 정상 반영됨(회귀 없음).

### 8.4 인증 상태

- 비로그인 상태에서 찜 버튼 클릭 시 기존 로그인 모달이 정상 등장,
  레이아웃 깨짐 없음. 클릭 전/후 버튼 폭 완전 동일(100.79px, 불변)
  확인 — §3.2 픽스 검증.

## 9. Out-of-Scope Discovery — `/api/apt/[name]/info` Unit Master 조회 버그

QA 도중 픽스처 A(대신롯데캐슬)가 원래 보고("14평/25평 노출")와 다르게
"평형 정보 없음"만 나오는 것을 발견해 근본 원인을 추적했다.

- DB에는 `Apartment.id=11`("대신롯데캐슬", dong=서대신동3가,
  jibun=762)이 정확히 8개의 `ApartmentUnitType`을 갖고 있고, 그중
  84.7855㎡·84.995㎡가 둘 다 34평으로 수렴하는 collision 케이스도 포함돼
  있다(§7의 CASE D 테스트가 이 실제 사례를 그대로 반영).
- `route.ts`의 `fetchCachedRegistry()`는 먼저 `name+dong`으로 정확히
  이 row(8개 unit type)를 찾지만, 이 row의 `approvalDate`가 null이라
  `isFullyPopulated()`가 false를 반환 → **name 없이 `dong+jibun`만으로**
  두 번째 폴백 조회를 실행한다.
- 같은 주소(dong=서대신동3가, jibun=762)에 `Apartment.id=95`("**대신롯데
  캐슬아파트**", unit type 0건)이라는 이름 변형 중복 row가 이미 존재해,
  이 폴백 조회가 `findFirst`로 id=95를 집어 `unitTypes`를 8개→0개로
  덮어써버린다.
- 이 흐름은 `src/app/api/apt/[name]/info/route.ts`에 있으며, 이번 STEP
  변경분과 무관하게 **베이스라인(`2b62be5`)에 이미 존재하던 버그**임을
  `git diff`로 확인했다(이 파일은 이번 커밋에 포함되지 않음). 진단을 위해
  일시적으로 추가했던 `console.log` 디버그 라인은 재현 확인 직후
  제거했고, 최종 `git diff`에 잔여 흔적이 없음을 재확인했다.
- AGENTS.md가 이번 STEP에서 명시적으로 금지한 "apartment basic data"
  영역(단지 식별/조회 파이프라인)에 해당하므로, 이 STEP에서는 **수정하지
  않고 발견 사실만 기록**한다. 동시에 이 버그는 AGENTS.md의 "Apartment
  canonical identity — 이름만으로 재식별하지 않는다" 원칙이 정확히
  경고하는 유형의 문제이기도 하다(여기서는 반대 방향: dong+jibun만으로
  재식별하며 name을 빠뜨림).
- **이번 STEP의 토글/캡션 로직은 이 버그와 무관하게 정확히 설계대로
  동작했다** — Unit Master 데이터가 (버그로 인해) 클라이언트에 도달하지
  못하면 정직하게 "평형 정보 없음"을 보여주는 것이 올바른 폴백이다. 다만
  사용자가 원래 기대한 "14평/25평 노출"은 이 별도 버그가 고쳐져야 다시
  보인다.

## 10. Recommendations (다음 STEP 후보, 구현하지 않음)

### 10.1 `UNIT_MASTER_COVERAGE_V2` — 강력 권고

legacy Unit Master 커버리지가 `ApartmentMaster` 대비 약 0.32%(§6)에
불과해, 이번 픽스 이후에도 대다수 단지는 평 모드에서 "평형 정보 없음"만
보게 된다. 이는 지금은 정직하지만 장기적으로 제품 가치를 제한한다 —
canonical `ApartmentMaster`(3,402건) 기반으로 Unit Master 커버리지를
넓히는 백필 작업을 별도 STEP으로 제안한다.

### 10.2 `/api/apt/[name]/info` 식별 버그 수정 — 별도 STEP 권고

§9에서 발견한 `dong+jibun`-only 폴백 조회를 `name+dong+jibun`으로
정확히 매칭하도록 고치거나, 애초에 중복된 이름 변형 row(id=11/id=95 같은
사례)를 데이터 정합성 차원에서 정리하는 STEP이 필요하다. 이 버그는
Unit Master 데이터가 존재해도 화면에 반영되지 않게 만들어 §10.1의
백필 효과까지 무력화할 수 있다.

### 10.3 "전체 평형" 모달 캡션 일관성 (경미)

칩 행은 Unit Master가 전혀 없는 단지에서도 "평형 정보 없음"을 보여주는
반면, 모달은 이 경우 기존 거래건수 subLabel만 보여준다(§8.3). 데이터
신뢰 위반은 아니지만, 완전한 시각적 일관성을 원한다면 모달도 같은
캡션을 쓰도록 통일하는 소규모 후속 작업을 고려할 수 있다.

## 11. Known Issues

- §9의 `/api/apt/[name]/info` 식별 버그는 미해결 상태로 남아 있다(이번
  STEP 범위 밖).
- Unit Master 저커버리지(§6)로 인해 픽스 이후에도 대부분 단지는 평
  모드에서 "평형 정보 없음"을 보게 된다 — 이는 버그가 아니라 현재
  데이터 상태를 정직하게 반영한 결과다.
- 모바일 실기기 검증은 수행하지 않았다(iframe-isolation 기반 390/375/
  360px 시뮬레이션만 수행).

## 12. Build & Verification

- `npx tsc --noEmit`: 이번 STEP이 건드린 파일 기준 신규 에러 없음
  (`scripts/apartment-score/*.ts`의 `formatPyeong` 관련 에러 2건은
  베이스라인에서도 동일하게 존재하는 사전 에러로 `git stash` 대조 확인).
- `npx eslint` (변경 파일 전체): 0 errors, 기존에도 있던 1개 warning
  (`apt-client.tsx:498`, unused eslint-disable directive) 외 신규 없음.
- `npm run build`: 성공 (`✓ Compiled successfully in 13.2s`, 35/35
  페이지 생성).
- `scripts/run-apt-detail-consistency-qa.ts`: A파트 14/14 PASS, B파트
  전체 PASS, findings 없음.

## 13. Next Step

ChatGPT PM 검수 대기. 승인 시 §10.1(Unit Master 커버리지 백필) 또는
§10.2(`/info` 식별 버그 수정) 중 우선순위를 정해 별도 STEP으로 진행 권장.
