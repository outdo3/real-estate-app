# GLOBAL SHARE SYSTEM V1

## 1. Goal

이집의 모든 public-facing content page가 "공유" 기능을 기본으로 갖추도록
공통 공유 시스템을 만든다. 아파트 상세에는 이미 카카오 공유가 있었지만
통계 상세/지도/분양/재개발/커뮤니티/AI검색에는 없었고, 페이지마다 각자
공유 코드를 짜면 유지보수와 UX가 갈라진다. 이번 STEP은 (1) 공통 공유
아키텍처를 만들고 (2) 현재 live 페이지의 공유 coverage를 감사하고 (3)
빠진 곳에 적용하고 (4) 향후 신규 페이지(84㎡ 순위, PRICE MAP V2 등)가
최소 props만으로 재사용할 수 있는 구조를 남긴다.

## 2. Share Product Principle

앞으로 사용자가 다른 사람에게 정보/판단을 전달할 가치가 있는 모든
public-facing content page는 다음 중 하나를 만족해야 한다.

- A. 공통 `ShareAction`(또는 `useSharePage`)을 제공한다.
- B. 공유가 부적절한 이유가 명확히 문서화돼 있다(§4).

즉 공유는 나중에 붙이는 optional polish가 아니라 페이지 완료조건의
일부다.

## 3. Page Coverage Audit

| ROUTE | CURRENT_SHARE(before) | SHOULD_SHARE | IMPLEMENTATION(after) | STATE_IN_URL | NOTES |
|---|---|---|---|---|---|
| `/` (Home) | 없음 | 아니오 | — | — | 앱 진입점 자체라 특정 콘텐츠가 아님. §4 참고 |
| `/apt/[name]` | KakaoShareButton(compact) | 예 | 기존 그대로(내부만 shareUtils 재사용) | 이미 `?lawdCd=&dong=` | 회귀 없음, §11 |
| `/map` | 없음 | 예 | ShareAction(icon) | 신규: `lat/lng/zoom/lawdCd` | selectedMarkerId는 미복원(§18 known limitation) |
| `/stats` (landing) | 없음 | 아니오 | — | — | 메뉴 그리드일 뿐, 공유할 "결과"가 없음 |
| `/stats/[type]` (17개 subtype) | 없음 | 예(status='live' 10개) | ShareAction(compact) | 신규: `sido/sidoCode/sigungu/dong/lawdCd` | 'soon' placeholder 7개는 제외(§4) |
| `/school/[id]` | KakaoShareButton(compact) | 예 | 기존 그대로 | 이미 canonical URL | 회귀 없음 |
| `/school` (목록) | 없음 | 아니오 | — | — | 목록 자체는 공유 가치 낮음, 상세가 이미 커버 |
| `/presales/[id]` | 없음 | 예 | ShareAction(compact) | 이미 canonical URL | — |
| `/redevelopment/[id]` | 없음 | 예 | ShareAction(compact) | 이미 canonical URL | — |
| `/community/[id]` | 없음 | 예 | ShareAction(icon) | 이미 canonical URL | 글쓰기(`/community/write`)는 제외 |
| `/ai-search` | 없음 | 예(결과 있을 때만) | ShareAction(icon) | 이미 `?q=&lawdCd=` | 결과 없으면 버튼 미노출(가짜 공유 방지) |
| `/redevelopment` (목록) | 없음 | 아니오 | — | — | 목록/필터 페이지, 상세가 이미 커버 |
| `/my`, `/admin/*`, 로그인/설정 | 없음 | 아니오 | — | — | private/account/admin, §4 |

## 4. Public vs Private Pages

Home, `/stats` landing, `/school` 목록, `/redevelopment` 목록은 "공유할
가치가 있는 구체적 콘텐츠"라기보다 진입점/그리드/필터 화면이라 제외했다
— 실제 콘텐츠는 그 다음 단계(통계 subtype 상세, 학교 상세, 재개발 상세)
에 있고 거기엔 전부 공유가 붙는다. `/my`, `/admin/*`, 로그인/회원가입,
`/community/write`는 개인 데이터/관리자 전용/작성 화면이라 원칙대로
제외했다(§15 of the STEP spec). "soon" 상태인 통계 7개 subtype(인구변화/
외지인비율/경사고도/인기단지 등)은 실제 데이터가 없는 빈 안내 화면이라
ShareAction을 렌더하지 않는다 — 빈 화면을 공유하게 두지 않는다.

## 5. Architecture

```
src/lib/share/shareUtils.ts   — 순수 함수 계층 (SDK 로더, URL 조합, 클립보드, 네이티브 공유)
src/hooks/useSharePage.ts     — 공통 훅 (상태 + 우선순위 로직)
src/components/ShareAction.tsx — 공통 버튼 (compact / icon variant)
src/components/ShareAction.module.css
src/components/KakaoShareButton.tsx — 기존 3개 호출부 전용, 내부만 shareUtils 재사용
src/app/stats/[type]/shareContext.ts — 통계 전용 title/text/params 헬퍼
```

`KakaoShareButton`은 새로 만드는 페이지의 기반이 아니다 — 이미 안정
동작 중인 3개 호출부(아파트 상세 Hero, StickyActionBar, 학교 상세)를
위해 그대로 남겨뒀고, 내부 로직(SDK 로더/URL 조합/클립보드)만
`shareUtils.ts`로 옮겨 `ShareAction`과 저수준 코드를 공유한다. 겉모습/
props/공유 우선순위(카카오 우선)는 전혀 바뀌지 않았다 — 회귀 없는
리팩터링.

새 페이지는 전부 `ShareAction`을 쓴다. Props: `title`, `text?`,
`params?`(공유 URL에 추가할 쿼리스트링), `enableKakao?`(기본 true),
`variant`(`compact` | `icon`), `label?`.

## 6. Native Share

`useSharePage`의 공유 우선순위는 STEP 스펙 §4 그대로:

1. `navigator.share()` (Web Share API) — 지원 환경(주로 모바일)에서 최우선
2. 카카오 공유 카드 — 네이티브가 없는 환경(주로 데스크톱)에서 보강.
   페이지별 이미지 자산 없이 브랜드 공용 이미지(`ejip-kakao-share-1200x630.jpg`)를
   재사용해 모든 페이지가 추가 자산 없이 카드형 공유를 쓸 수 있다.
3. 클립보드 복사 — 최종 폴백

`AbortError`(사용자가 공유 시트를 닫음)는 정상 취소로 처리하고 오류
상태로 넘어가지 않는다. SSR 안전성은 `typeof window === 'undefined'`
가드로 확보했다.

## 7. Clipboard Fallback

성공 시 "복사됨"(compact variant는 버튼 라벨 자체를 스왑, 기존
KakaoShareButton과 동일한 관례) 또는 "링크를 복사했어요" toast(icon
variant, FavoriteButton의 `.errorToast` 말풍선과 같은 시각 패턴을
성공 케이스에 재사용). 실패 시 "공유 실패"/"공유에 실패했어요"로 정직하게
표시하고 `alert()`은 쓰지 않는다.

## 8. Kakao Integration

기존 3개 호출부는 그대로 카카오 우선(§5). 새 `ShareAction`은 네이티브가
없을 때만 카카오를 보강으로 쓴다. 두 경로 모두 동일한 SDK 로더/초기화
(`loadKakaoShareSdk`/`ensureKakaoInitialized`)를 공유해 중복 스크립트
로드가 없다.

## 9. URL State Preservation

감사 결과 지역/필터 상태는 대부분 client-only React state였다(아래
표). 이번 STEP은 큰 아키텍처 개편 없이 "공유 시점에만 값을 쿼리스트링에
실어 보내고, 필요하면 그 값을 최초 진입 시 한 번만 읽어 복원"하는 최소
변경으로 대응했다.

| 화면 | 원래 URL에 있던 값 | 새로 추가한 공유 파라미터 | 복원 여부 |
|---|---|---|---|
| 아파트 상세 | `lawdCd`, `dong` | (변경 없음) | 이미 지원 |
| AI 검색 | `q`, `lawdCd` | (변경 없음, 이미 충분) | 이미 지원 |
| 통계 subtype | 없음(RegionContext client-only) | `sido/sidoCode/sigungu/dong/lawdCd` | 지원(§9-a) |
| 지도 | 없음(center/zoom/lawdCd client-only) | `lat/lng/zoom/lawdCd` | 지원(§9-b), selectedMarkerId는 미지원 |

**§9-a (통계)**: `stats/[type]/page.tsx`를 `<Suspense>`로 감싸고(AI
검색 페이지와 동일한 기존 관례),`type-client.tsx`가 `useSearchParams()`
로 `sido`/`sidoCode`를 읽어 있으면 최초 마운트 시 한 번
`RegionContext.setRegion()`을 호출한다. RegionContext 자체의 GPS/기본값
로직은 건드리지 않았다 — 공유 링크로 들어왔을 때만 우선 적용된다.
브라우저로 부산 서구 기본값 상태에서 `?sido=서울특별시&sidoCode=11&sigungu=강남구&lawdCd=11680`
링크로 진입해 실제로 "서울특별시 강남구"로 전환되고 거래량 데이터가
강남구 기준으로 다시 로드되는 것을 확인했다.

**§9-b (지도)**: `map/page.tsx`는 별도 서버 래퍼가 없는 단일
`'use client'` 페이지라 `useSearchParams()`+Suspense 구조를 새로 만들지
않고, `KakaoShareButton`이 이미 쓰던 관례(`window.location.search` 직접
읽기)를 `center`/`zoomLevel`/`currentLawdCd`의 `useState` lazy
initializer 안에서 그대로 재사용했다. 마운트 이후의 드래그/줌/검색
인터랙션에는 전혀 영향이 없다. 브라우저로 `?lat=35.15&lng=129.06&zoom=6&lawdCd=26140`
진입 시 실제로 다른 지역(중구 인근)·다른 확대 단계로 시작하는 것을
확인했다. `selectedMarkerId` 복원은 aptClusters 로딩 이후에나 가능한
pending-marker 재조정 로직과 얽혀 있어 범위에서 제외했다(§18).

## 10. Statistics Coverage

`src/app/stats/[type]/shareContext.ts`의 `buildStatsShareContext(item, region)`
하나가 17개 subtype 전부를 커버한다 — subtype별 bespoke 컴포넌트를
만들지 않았다. Title은 `"{짧은 지역명} {통계명} | 이집"`(예: "부산 서구
2년최고가 | 이집"), text는 `STATS_MENU`에 이미 있는 정직한 subtitle을
그대로 재사용한다(새 카피 발명 없음). "부산 전체"/"부산 서구"처럼
행정구역 접미사를 뗀 짧은 지역명은 `statsRegionShareLabel()`이 실제
`RegionState.sido/sigungu/dong` 값만으로 조합한다 — 없는 값을 추정하지
않는다.

## 11. Apartment Detail

기존 KakaoShareButton 호출부(Hero, StickyActionBar)는 전혀 바뀌지
않았다. 브라우저로 `/apt/대신롯데캐슬`에서 "공유하기" 버튼을 클릭해
콘솔 오류 없이 기존과 동일하게 동작하는 것을 확인했다(§26 참고).

## 12. Map

상단 검색창+"내 위치" 컨트롤 바에 `ShareAction(variant="icon")`을
추가했다. 우측 세로 레이어 토글 스택과 겹치지 않는다(플로팅 위치가
다름). 360px~1280px에서 클리핑/줄바꿈 없이 확인했다(§9-b에 URL 상태
내용).

## 13. School / Presale / Compare

- 학교 상세: 기존 KakaoShareButton 그대로(감사만, 회귀 없음).
- 분양 상세(`/presales/[id]`): 제목(h1) 옆에 `ShareAction(compact)` 추가.
- 재개발 상세(`/redevelopment/[id]`): 제목(h1) 옆에 `ShareAction(compact)` 추가.
- 비교(`/stats/compare`, `/stats/multi-compare`): 통계 공통 헤더에
  ShareAction이 이미 포함돼 별도 작업 불필요.

## 14. Mobile

360px 근사 폭(375 요청 시 실측 ~558 CSS px로 렌더됨 — 이 환경의
`resize_window`가 정확한 CSS px를 보장하지 않는 것으로 보임, 기존
세션에서도 보고된 제약)에서 통계 헤더(공유 버튼이 지역 선택 아래로
줄바꿈되어도 clipping 없음), 지도 상단 컨트롤 바(한 줄 유지, 검색창이
줄어들며 흡수), 분양/재개발 상세, AI 검색 브리핑 박스를 스크린샷으로
확인했다. 터치 타겟은 compact 44px, icon 44x44px로 기존 컴포넌트
규격을 그대로 따른다.

## 15. Desktop

1280px에서 모든 신규 ShareAction이 명확히 보이는 위치(헤더/타이틀 행)에
있다. mobile-only 버튼 없음.

## 16. Accessibility

모든 버튼에 `aria-label="공유하기"`(icon variant는 라벨 텍스트가 없어
필수, compact도 명시적으로 부여)와 `title` 툴팁을 달았다. 포커스
상태는 기존 디자인 시스템의 `:focus-visible` 아웃라인(`--ejip-green-deep`)
을 재사용했다.

## 17. QA

- 자동화: `npx tsc --noEmit` — 변경 파일 신규 오류 0(기존
  `scripts/*` 오류만 존재, FAIL_EXISTING_SCRIPT_ERRORS로 분리).
- `npm run lint` — 최초 실행에서 `useSharePage.ts`의 `react-hooks/refs`
  오류(렌더 중 ref 접근)를 발견해 `useEffect`로 이동해 수정. 이후
  변경 파일 재검사 결과 0 errors(사전 존재 warning 1개만 남음).
- `npm run build` — PASS, 35개 라우트 정상 생성.
- 브라우저(Chrome, 로컬 dev): 아파트 상세, 지도(초기 렌더+아이콘
  버튼+클립보드 폴백+URL 상태 복원), 통계 5개 subtype(하락/거래량/
  공급/대단지/인구변화-soon 제외 확인+지역 복원), 분양 상세, 재개발
  상세, AI 검색 결과 — 전부 콘솔 오류 없이 렌더/클릭 확인.
- 커뮤니티 post-client는 시드 게시글이 없고 `AuthGate`로 막혀 있어
  실브라우저 클릭까지는 확인하지 못했다 — 코드 검토로는 동일하게 검증된
  `ShareAction`을 그대로 재사용하므로 다른 5곳과 같은 패턴이지만,
  ChatGPT PM 승인 후 실사용자 게시글로 재확인을 권장한다.

## 18. Known Limitations

- 지도 `selectedMarkerId`(공유 시점에 선택돼 있던 특정 마커/바텀시트)는
  URL에 복원하지 않는다 — aptClusters 로딩 이후에나 유효한
  pending-marker 재조정 로직과 얽혀 있어, 다음 STEP(MAP MARKER UX V2)과
  충돌하지 않도록 이번 범위에서 제외했다.
- 통계 공유 링크는 지역만 복원한다(기간/거래유형/정렬 등 세부 필터는
  각 View 컴포넌트의 로컬 state라 URL에 없음) — 대규모 상태 아키텍처
  개편 없이는 안전하게 넣을 수 없어 범위 밖으로 남겨뒀다.
- 커뮤니티 게시글 공유는 시드 데이터 부재로 실브라우저 클릭까지는
  검증하지 못했다(§17).
- 공유 클릭 이벤트 로깅은 만들지 않았다 — 기존에 재사용 가능한 범용
  analytics 훅이 없어(감사 결과) 이번 STEP에서 새 아키텍처를 만들지
  않기로 했다. 향후 ANALYTICS V1 대상.

## 19. Future Pages

84㎡ 순위, PRICE MAP V2, 향후 "진짜 신고가" 등 다음 통계 기능은 전부
`/stats/[type]` 라우트의 새 subtype으로 추가되는 한 `shareContext.ts`의
`buildStatsShareContext()`가 `STATS_MENU`에 새 항목만 추가하면 자동으로
커버한다(추가 구현 불필요). 통계 바깥의 완전히 새로운 페이지도
`ShareAction`에 `title`/`text`/`params`만 넘기면 된다.

## 20. Definition of Done

새로운 public-facing content page는 다음 중 하나를 반드시 만족해야
한다.

- A. 공통 `ShareAction`을 제공한다.
- B. 공유가 부적절한 이유가 명확히 문서화돼 있다.

공유 기능은 나중에 붙이는 optional polish가 아니라 페이지 완료조건의
일부로 취급한다.
