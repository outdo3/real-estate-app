# STEP 42 — APT DETAIL UI-C1: 상세페이지 빠른 단지검색 + 최근 본 단지

상태: 구현 완료 / 사용자 검수 대기(commit/push 없음)

성격: 상세페이지 집중도를 유지하면서 다른 단지로 빠르게 이동하는 기능만
추가. 기존 컴포넌트(Header searchSlot, ApartmentAutocomplete, apt-client.tsx
모달 시스템)를 최대한 재사용. 새 검색 시스템/외부 API/DB/schema 없음. 기준
commit `3ec80b6c25f3bf9e9d24132e4676c3f9197eeffe`(origin/main과 동일, working
tree clean — §0 확인).

---

## 0. 작업 시작 전 확인

```
git status --short         → (empty, clean)
git rev-parse HEAD          → 3ec80b6c25f3bf9e9d24132e4676c3f9197eeffe
git fetch origin             → (no new refs)
git rev-list --left-right --count origin/main...HEAD → 0  0
```

예상 외 production 변경 없음 — STOP 조건 미발생, 진행.

## 1. 기존 Header 구조 조사

`src/components/Header.tsx`. Props: `searchSlot?: ReactNode`,
`pageTitle?`, `hideMobileNav?`, `hideLogo?`, `pageTitleLarge?`,
`pageTitleAlign?`. **`searchSlot`이 이미 존재하지만, 이번 STEP 전까지
프로젝트 전체에서 이 prop을 실제로 넘기는 페이지가 0곳**이었다(grep
재확인) — 배관만 있고 비어 있는 상태. `apt-client.tsx`의 기존 `<Header
/>` 호출도 props 없이 bare였다. `.searchSlot`(Header.module.css)은
`flex:1, max-width:320px, margin:0 1rem`으로 로고와 (모바일에서는
`position:fixed`로 빠지는) 메뉴/로그인 버튼 사이에 렌더된다 — 모바일
헤더 행에는 이 자리가 비어 있어 아이콘 하나를 추가해도 로그인/공유/
뒤로가기와 겹치지 않는다(CSS 구조상 확정, §11에서 실측으로도 재확인).

## 2. 기존 검색 컴포넌트 조사

`ApartmentAutocomplete.tsx`(카카오 키워드 검색, `onSelect({name,
address, lat, lng})`)가 이미 `/map`, `/stats/[type]`,
`RegionSelectModal`에서 재사용되고 있음을 확인. 세 호출부 모두 검색
결과를 "다른 단지 상세페이지로 이동"에는 쓰지 않는다(지도 이동, 비교
목록 추가, 지역 선택 등 다른 용도) — 그래서 "선택 → 상세 즉시 이동"
로직 자체는 기존에 없어 이번 STEP에서 새로 연결했다. 드롭다운은
`position:fixed`(입력창 기준 절대좌표, 카카오맵 SDK 레이어 위에 항상
뜨도록 설계됨 — 코드 주석에 이유 명시)라 **모달 안에 그대로 넣어도
스태킹 컨텍스트 문제가 없다**는 것도 코드로 확인했다.

## 3. 상세 URL 생성 방식 조사

기존 canonical 패턴 재확인: `/map`의 마커 "상세보기" 버튼이
`/apt/${encodeURIComponent(name)}?lawdCd=${lawdCd}&dong=${encodeURIComponent(dong)}`
형태로 이동함을 확인(기존 코드, 변경 없음). `community/post-client.tsx`
처럼 `lawdCd`/`dong` 없이 이름만으로도 유효하게 라우팅되는 폴백 경로도
존재함을 확인(apt-client.tsx가 자체적으로 처리). 새 URL 규칙을 만들지
않고 **이 두 형태를 그대로 재사용**했다.

`ApartmentAutocomplete`의 onSelect는 `{name, address, lat, lng}`만
주고 lawdCd/dong은 주지 않는다 — 이 컴포넌트 자신의 `enrichTopResults()`
가 세대수/준공연도 보강을 위해 쓰는 것과 **동일한 좌표→법정동
역지오코딩**(`kakao.maps.services.Geocoder().coord2RegionCode()`)을
새 검색 화면(`ApartmentQuickSearch`)에서도 그대로 재사용해 lawdCd/dong을
얻는다 — 새 방식을 만들지 않았다.

## 4. 검색 UI 방식 — 기존 모달 재사용

`apt-client.tsx`는 이미 `activeModal`/`openModal`/`closeModal`
상태 + `.modalOverlay`/`.modalContent`(detail.module.css, `width:90%,
max-width:500px`, 배경 클릭·X버튼으로 닫힘)로 지도/로드뷰/단지정보/
대출한도/커뮤니티시설 5개 모달을 이미 구현해뒀다. **이 화면 안에서
유일하게 이미 존재하는 overlay 패턴**이라 새 modal/bottom-sheet
시스템을 만들지 않고 `activeModal === '빠른 검색'` 케이스 하나만
추가했다 — 배경 클릭·X 닫힘·타이틀 표시가 전부 공짜로 재사용된다.

## 5. 자동완성 — ApartmentAutocomplete 재사용 + 최소 확장

새 컴포넌트를 만들지 않고 그대로 마운트한다. 다만 부모가 "검색어가
비었는지/결과가 있는지"를 알아야 "최근 본 단지"와 "결과 없음" 문구를
구분해 보여줄 수 있는데, 기존 컴포넌트는 이 상태를 밖으로 노출하지
않았다 — **선택적 콜백 prop `onQueryStateChange?: (state) => void`
하나만 추가**했다(기존 3개 호출부는 이 prop을 넘기지 않으므로 동작
변화 없음, `ApartmentAutocomplete.tsx` diff 8줄).

## 6. 검색 결과 선택 → 상세 이동

`ApartmentQuickSearch.tsx`(신규)의 `handleSelect`가 §3의 역지오코딩으로
lawdCd/dong을 얻은 뒤 `router.push('/apt/[name]?lawdCd=..&dong=..')`로
**직접** 이동한다. 홈/AI검색/지도/별도 검색결과 페이지를 전혀 거치지
않는다(§13 CASE A/B 실측으로 확인).

## 7. 최근 본 단지 — 기존 기능 없음, 신규 localStorage

기존 기능/storage 조사 결과 이 프로젝트에 "최근 본 단지" 관련 코드가
전혀 없음을 확인(grep 전체 재확인). 지시대로 **client-side localStorage만
새로 사용**했다(`src/lib/recent-apartments.ts`, DB 저장 없음, 로그인
연동 없음).

- **기록 시점**: 새 effect를 추가하지 않고, `apt-client.tsx`에 이미
  있던 "상세페이지 조회 로그"(`/api/log/view`) effect를 그대로
  확장했다 — `pageReady`가 처음 true가 되는(단지명·지역이 확정된) 그
  시점에 딱 한 번, 이미 계산돼 있던 `resolvedName`/`lawdCdState`/
  `urlDong`/`heroRegionLabel`을 그대로 재사용해 기록한다. 이 지점은
  **모든 진입 경로**(지도/커뮤니티/직접 URL/이번 빠른검색 등)를 자동으로
  커버한다 — 빠른검색에서만 기록하는 것보다 "최근 본" 의미에 더
  정확하다.
- **저장 항목**: `name`, `address`(표시용, 구+동), `lawdCd`, `dong`,
  `visitedAt`. `jibun`은 routing에 쓰이지 않아 저장하지 않았다(최소
  정보 원칙).
- **localStorage key**: `ejip:recentApartments`
- **최대 개수**: 8개(5~10 범위 내에서 선택, 좁은 모달 안에서도 스크롤
  없이 한눈에 훑을 수 있는 개수로 판단)
- **중복 처리**: `name+dong`을 동일 단지 식별 키로 써서(이 앱 전역의
  collision 방지 방식과 동일) 기존 항목을 지우고 맨 앞으로 갱신 —
  같은 단지를 반복 방문해도 목록에 여러 번 쌓이지 않는다.
- **현재 단지 처리**: "현재 단지도 history에는 저장하되(§7 두 안 중
  선택), 검색 overlay에서는 현재 단지를 이름+dong 기준으로 필터링해
  숨긴다." **더 단순한 쪽을 선택**했다 — "현재 보고 있는 단지" 뱃지
  UI를 별도로 만드는 것보다, 애초에 안 보여주는 편이 코드도 적고
  사용자도 "이미 여기 있는데 왜 목록에 나와" 하는 혼란이 없다.
- **손상 방어**: `getRecentApartments()`가 `JSON.parse` 실패/배열이
  아님/필드 타입 불일치를 전부 try-catch + 검증 함수로 걸러 빈 배열로
  폴백한다. `recordApartmentVisit()`도 저장 실패(쿼터 초과 등)를
  조용히 무시한다 — 최근 본 단지 기능만 비활성화될 뿐 상세페이지
  자체는 영향받지 않는다. **SSR 하이드레이션 문제 없음**: localStorage
  읽기는 `ApartmentQuickSearch`가 모달이 열릴 때만 마운트되는
  `useEffect` 안에서 일어나므로, 최초 페이지 렌더(SSR)에는 전혀
  관여하지 않는다.

## 8. 검색 아이콘 접근성

`aria-label="다른 아파트 검색"` + `title="다른 아파트 검색"`(브라우저
자동화 도구의 `find`로 실측 확인 — 정확히 이 라벨로 조회됨). 터치
타겟 38×38px(원형 버튼) — 기존 뒤로가기 버튼(36px)과 비슷한 크기.

## 9. 검색 overlay 종료 — 4가지 경로 확인

- **X 버튼**: 기존 모달 `closeButton` 그대로(§13 CASE E로 실측).
- **배경 클릭**: 기존 `.modalOverlay onClick={closeModal}` 그대로.
- **브라우저/Android 뒤로가기**: `ApartmentQuickSearch`가 마운트될 때
  `history.pushState()`로 더미 history entry를 하나 쌓고 `popstate`를
  구독해 뒤로가기 시 `onClose()`만 호출한다 — 상세페이지 자체는 이탈하지
  않는다(§13에서 `history.back()` 시뮬레이션으로 실측 확인). 트레이드
  오프: X/배경 클릭으로 수동 닫을 때는 이 더미 entry를 소비하지 않는다
  (단순 구현 우선 — pop 이중 처리로 인한 미묘한 버그를 피하기 위한
  의도적 선택). 즉 수동으로 닫은 뒤 뒤로가기를 누르면 "아무 일도
  없는" 첫 뒤로가기가 한 번 더 필요할 수 있다 — 알려진 한계로 기록.
- **검색 결과 선택**: `handleSelect`가 `onClose()` 호출 후 `router.push`
  — 페이지 자체가 바뀌므로 모달은 자연히 사라진다.

## 10. 모바일/PC Header 확인

기존 헤더 CSS(§1)를 근거로: `.searchSlot`은 로고~로그인 버튼 사이의
비어 있던 공간에 들어가 제목 잘림/로그인·공유·뒤로가기 충돌이 구조적으로
없다. **실측(localhost:3000, 데스크톱 폭)으로도 확인** — 검색 아이콘이
로고 바로 옆에 자연스럽게 배치되고 다른 요소와 겹치지 않음(§13 스크린샷).

## 11. 하지 않은 것(요구사항 그대로 준수)

홈 AI 검색/지도 검색/지도 바텀시트/버스/점수체계/이집 브리핑/생활편의
확장/평면도/건축물대장/DB·schema·migration/로그인 기반 최근 본 단지/
즐겨찾기/아파트 비교/새 외부 API — 전부 손대지 않았다(git diff로 재확인,
apt-client.tsx의 기존 모달 5개·AreaSelector·Chart·Metrics 등은 diff에
등장하지 않음).

## production code 변경 여부

**있음(최소).** 신규: `src/lib/recent-apartments.ts`,
`src/components/ApartmentQuickSearch.tsx`. 수정:
`src/components/ApartmentAutocomplete.tsx`(선택적 prop 1개, 8줄),
`src/app/apt/[name]/apt-client.tsx`(import 2개 + Header searchSlot +
모달 case 1개 + 기존 로그 effect 확장, 45줄).

## DB/schema/migration 변경 여부

**없음.** localStorage만 사용(§7).

## 생성/수정 문서

- 신규: `docs/development/42-apartment-detail-quick-search.md`(이 문서)
- 수정: `docs/development/CHANGELOG.md`(STEP 42 항목 추가)

## 검증 결과(로컬 next dev, localhost:3000 — 이 포트가 Kakao 앱키
등록 도메인으로 확인됨, §12 참고)

- **CASE A**(대신푸르지오1차 → 🔍 → "명륜" → 선택 → 즉시 이동): 성공.
  검색 결과 드롭다운에 세대수/준공연도 enrichment까지 정상 표시,
  선택한 단지(힐스테이트명륜트라디움) 상세로 `?lawdCd=26260&dong=명륜동`
  붙어 즉시 이동, Hero/Chart(매매green/전세blue)/AreaSelector(오름차순)
  전부 정상.
- **CASE B**(명륜아이파크1단지 → 🔍 → "메트로시티" → 선택 → 즉시 이동):
  라우팅 메커니즘 성공(`?lawdCd=26290&dong=용호동` 정확). 다만 선택한
  카카오 POI 결과명("LG메트로시티1차아파트")이 이 앱 MOLIT 실거래
  데이터의 등록명과 정확히 일치하지 않아 도착한 상세페이지 자체는
  거래 내역이 비어 있었다 — **이건 이번 STEP이 만든 문제가 아니라
  `ApartmentAutocomplete`(기존 컴포넌트, /map 등에서도 동일)가 원래
  갖고 있던 한계**(카카오 POI 명칭 ≠ MOLIT 실거래 등록명, UI-C2-FIX에서도
  같은 종류의 이름 표기 차이를 이미 확인한 바 있음)이다. 페이지는
  크래시 없이 기존 정직한 빈 상태("해당 기간의 매매/전세 거래 내역이
  없습니다")를 그대로 보여줬다.
- **CASE C**(검색 열기, 미입력 → 최근 본 단지): 성공. "대신푸르지오1차 /
  부산광역시 서구 서대신동1가" 정상 표시, 현재 페이지는 제외됨.
- **CASE D**(최근 본 단지 클릭 → 이동): 성공, `?lawdCd=26140&dong=서대신동1가`
  정확히 유지.
- **CASE E**(X 클릭 → 취소): 성공, 모달만 닫히고 URL/페이지 그대로.
- **CASE F**(결과 없음 → empty state): 성공, "검색 결과가 없습니다."
  정상 표시(다른 데이터로 대체 없음).
- **CASE G**(손상된 localStorage → crash 없음): 성공.
  `localStorage.setItem('ejip:recentApartments','{not valid json!!!')`
  주입 후에도 모달이 "최근 본 단지가 없습니다"로 안전하게 폴백,
  콘솔에 이 코드 관련 에러 없음(확인된 에러는 브라우저 확장 프로그램의
  무관한 메시지-채널 노이즈뿐).
- **뒤로가기(popstate)**: `history.back()`으로 시뮬레이션 — 모달만
  닫히고 페이지 URL/내용 그대로 유지됨을 확인(§9).

## 모바일 검증 — 도구 제약 명시

360/375/390px 자동 뷰포트 검증은 이번에도 `resize_window` 호출 후
스크린샷 캡처 해상도가 바뀌지 않는 기존 세션들과 동일한 도구 제약으로
**실측하지 못했다**(정직하게 기록, 지어내지 않음). 대신 §1/§4의 CSS
구조 근거로 판단: `.modalContent`가 768px 이하에서 `width:95%,
padding:1rem`으로 축소되고, 검색 input과 결과 리스트는 세로로 자연스럽게
쌓이는 flex 레이아웃이라 가로 오버플로 위험이 구조적으로 낮다. **실기기
검수가 필요**하다.

## 알려진 문제 / 후속 개선 후보

1. §6 CASE B에서 확인된 "카카오 POI 검색명 ≠ MOLIT 등록명" 불일치는
   이번 STEP 범위 밖(ApartmentAutocomplete 자체의 기존 한계) — 별도
   STEP 후보로만 기록.
2. §9에서 기록한 "수동 닫기 후 첫 뒤로가기가 한 번 무효로 소비되는"
   트레이드오프 — 실사용에 문제가 되면 후속 STEP에서 재검토.
3. 모바일 실기기 검증 필요(§ 위).

## 최종 판단

상세페이지에서 다른 단지로 즉시 이동하는 기능을, 이미 존재하던
`Header.searchSlot`/`ApartmentAutocomplete`/apt-client.tsx의 모달
시스템/canonical routing 4가지를 전부 그대로 재사용해 최소 코드로
구현했다. 새 검색 시스템·외부 API·DB/schema는 만들지 않았다. CASE A~G
전부(B는 부분적으로, 이유는 기존 컴포넌트 한계) 로컬 실측으로 확인했다.

commit/push 하지 않았다. 사용자 검수 후 별도 지시를 기다린다. 다른
STEP(홈 검색/지도/버스/점수체계/이집 브리핑 등)으로 자동 진행하지 않는다.
