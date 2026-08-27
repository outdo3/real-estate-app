# APT DETAIL MOBILE UX REGRESSION HOTFIX

작성일: 2026-08-27
성격: 아파트 상세페이지에서 최근 작업(`6d6dbcb fix(ui): repair apartment detail mobile
regressions`, `f253d31 fix(detail): resolve production chart QA issues`) 중 의도 설명
없이 사라지거나 약해진 핵심 UX 3가지를 복구한다. 새 대형 기능 개발이 아니라 회귀 복구 +
하단 행동 구조 정리다. DB/schema/migration/거래 계산/price chart 로직/Score/School
데이터 산식/Statistics/Auth 변경 없음.

---

## 1. Regression Summary

| 항목 | 상태 | 근거 |
|---|---|---|
| ㎡ ↔ 평 토글 | **회귀 아님(이미 정상 동작)** | 코드/git blame/라이브 클릭 테스트로 확인 |
| 하단 "최근 매매가" sticky + 글쓰기 | **실제 회귀** | `6d6dbcb`에서 글쓰기 버튼이 설명 없이 삭제됨(git diff로 확인) |
| 학군 섹션 학교명 클릭 | **실제 회귀** | SCHOOL V2-D1(`EducationPanel`)이 좌표를 이미 받아놓고도 응답에서 버려 렌더 단계에서 클릭 불가 |

---

## 2. Area Toggle Regression — 조사 결과(코드 변경 없음)

`git log -p`로 `AreaSelector.tsx`/`apt-client.tsx`의 토글 관련 커밋 전체
(`67425ac` → `608638a`(최초 토글) → `78fe3eb`(AREA_SELECTOR_V2_1 hotfix) →
`ee7fa69`(trade/unit area state 분리) → `f253d31`)를 추적했다. 토글 렌더 조건
(`Array.isArray(unitMaster) && unitMaster.some(u => u.representativePyeong != null)`)
은 `78fe3eb` 이후 한 번도 바뀌지 않았다.

라이브로 직접 재현·확인(claude-in-chrome, desktop 852px + mobile 375px/360px 둘 다):

- **대신롯데캐슬**(Unit Master 보유, `representativePyeong` 채워짐): 토글이 정상
  노출되고, 클릭 시 칩이 즉시 "14평/25평/25평/34평/34평/40평/50평"으로 전환됨(§7 충돌
  케이스 포함, §6 참고).
- **연산동한솔솔파크**(Unit Master 없음 — Busan 전체 3,402건 중 11건만 보유, §5 근거):
  토글이 의도대로 숨겨지고 raw ㎡ 칩만 표시됨(84.99/84.996/84.998/84.999㎡, 정밀도
  충돌 해소 정상).

**결론**: 코드 자체는 AREA_SELECTOR_V2_1 원칙(§3~5)을 정확히 지키고 있다. "버튼이
사라졌다"는 체감은 Unit Master 데이터가 Busan 3,402건 중 11건에만 있다는 **데이터
커버리지 한계**에서 온 것이지 UI 회귀가 아니다 — 임의로 exclusiveArea/3.3058 fallback을
추가하는 것은 이번 STEP의 명시적 금지사항이라 시도하지 않았다(§4).

---

## 3. Unit Master Rules(유지, 변경 없음)

- 평형 표시는 오직 `ApartmentUnitType.representativePyeong`(source: `SUPPLY_AREA_DERIVED`/
  `OFFICIAL_LABEL`)에서만 온다. `exclusiveArea / 3.3058` 단순 계산 fallback은 코드
  어디에도 없다(`area-utils.ts`의 `getUniquePyeongLabels`은 있지만 AreaSelector
  토글에서는 더 이상 호출되지 않는다 — `ee7fa69`에서 이미 제거됨, 확인만 함).
- `canonicalExclusiveArea`는 항상 identity로 유지되고, `representativePyeong`이 같은
  두 타입(예: 대신롯데캐슬 84.7855/84.9950, 둘 다 34평)은 평 모드에서도 서브 라벨
  (`전용 84.79㎡`/`전용 84.99㎡`)로 구분된다(라이브 확인, §7).

---

## 4. Trade Area Separation(유지, 변경 없음)

`selectedTradeArea`(raw trade.area identity)와 `selectedUnitMasterArea`(Unit Master
canonicalExclusiveArea identity)는 `DETAIL_TRADE_AREA_STATE_SPLIT_V1`(직전 STEP)에서
이미 분리되어 있다. 이번 STEP은 `areaUnit`(㎡/평 표시 단위) state만 다루고 이 두 identity
state를 전혀 건드리지 않았다 — `handleAreaSelectorChange`/`AreaSelector`의 `onSelect`
경로 코드 변경 없음.

---

## 5. Bottom Recent Price Decision

`src/components/StickyPriceBar.tsx`(모바일 전용, 768px 이하) 히스토리:

```
14c3244(신설, 가격+글쓰기) → 608638a(유지) → 6d6dbcb(글쓰기 버튼 삭제, 이유 미기재)
  → f253d31(가격 라벨만 개선)
```

`6d6dbcb`의 커밋 메시지는 "repair apartment detail mobile regressions"였지만 diff에는
글쓰기 버튼 삭제에 대한 설명이 전혀 없다 — 실제 회귀로 확인. 현재 상단에서 이미 가격을
충분히 보여주므로(Hero 가격 + 실거래 타임라인), 하단에서 가격을 반복하는 실익이 낮다는
이번 STEP 지시에 따라 **`StickyPriceBar`를 완전히 제거하고 `StickyActionBar`(관심단지/
공유/글쓰기)로 교체**했다.

---

## 6. Bottom 3 Actions

`src/components/StickyActionBar.tsx`(신규) — 기존 `.stickyBar` 위치/safe-area/z-index
CSS(`detail.module.css`, 변경 없음)를 그대로 재사용하고 내부만 3-column
(`관심단지 저장 | 공유하기 | 글쓰기`)으로 교체했다. 새 CSS는 `.stickyActionRow`/
`.stickyActionItem`/`.stickyWriteBtn`만 추가(orphan이 된 `.stickyBarWriteBtn`/
`.stickyBarPrice`는 제거). 라이브 확인(375px iframe): 3개 버튼이 균등 폭으로 중앙
정렬되고 하단 앱 네비게이션과 겹치지 않음(bottom:60px, 기존 값 그대로).

---

## 7. Favorite Reuse

새 favorite API/판정 로직을 만들지 않았다. `FavoriteButton`(기존 컴포넌트)을 상단
(compact)과 하단(non-compact, 라벨 노출) 두 곳에 재사용했다. 다만 두 인스턴스가 완전히
독립된 `useState`라 한쪽에서 토글해도 다른 쪽이 갱신되지 않는 문제가 있어, `FavoriteButton.tsx`
에 **같은 탭 안에서만 동작하는 최소한의 `CustomEvent` 브로드캐스트**
(`ejip:favorite-changed`)를 추가했다 — 서버 API 호출/판정 조건은 전혀 바뀌지 않고,
"방금 이 식별자(lawdCd+dong+name)의 상태가 바뀌었다"는 사실만 같은 탭의 다른 인스턴스에
전파한다. 비로그인 시 LoginModal이 뜨는 기존 동작, 로그인 후 자동완성 동작 모두 변경
없음.

---

## 8. Share Reuse

새 share 로직을 만들지 않았다. `KakaoShareButton`(기존 컴포넌트, `compact` variant)을
그대로 재사용했다 — Web Share → Kakao SDK → 클립보드 fallback 체인 변경 없음.

---

## 9. Write Context

`/community/write?aptName=<aptName>`(기존 `community/write/page.tsx`가 이미 받는 유일한
파라미터, `CommunityPreview.tsx`/구 `StickyPriceBar.tsx`와 동일 계약)를 그대로 재사용
했다. 새 community 시스템/파라미터를 추가하지 않았다.

---

## 10. Community Section 유지

"OO아파트, 이집 어때요?" 미리보기(`CommunityPreview.tsx`)와 그 안의 글쓰기/더보기
링크는 손대지 않았다(파일 자체를 수정하지 않음). BOTTOM 3 ACTIONS(페이지를 다 본 뒤
최종 행동)와 COMMUNITY SECTION(콘텐츠 발견/참여)의 역할 분리가 그대로 유지된다.

---

## 11. Floating Write Button 없음

새 `StickyActionBar`는 기존 `.stickyBar`(페이지 하단에 고정된 가로 바) 자리를 그대로
차지할 뿐, 화면을 가리는 독립 floating circle/button을 만들지 않았다.

---

## 12. Bottom Nav 겹침

기존 `.stickyBar`의 `bottom: 60px`(하단 앱 네비게이션 높이만큼 띄움) CSS를 변경하지
않았다 — 375px/360px iframe 라이브 확인 결과 겹침/잘림 없음.

---

## 13. School Click Regression — Root Cause

`src/app/api/apt/[name]/education/route.ts`의 `fetchNearbySchoolsByKeyword()`가 Kakao
키워드 검색 응답(`x`/`y`/`id` 포함)에서 **좌표와 id를 버리고** `{ name, distanceM,
establishmentType }`만 클라이언트에 반환하고 있었다 — `EducationPanel.tsx`(SCHOOL
V2-D1, 이전 `SchoolDistrictPanel`을 대체)는 애초에 학교명을 `<b>{s.name}</b>`로만
렌더해 클릭 자체가 불가능했다. 좌표가 없으니 클릭 가능하게 만들 수도 없었던
"이미 갖고 있던 데이터를 응답 직전에 버리는" 패턴 — `MAP_SURROUNDING_MARKER_PERFORMANCE_V1`
에서 발견한 Kakao 좌표 폐기 패턴과 근본적으로 동일한 종류의 문제였다.

---

## 14. School Identity — 복구 방식

**변경**: `NearbyKakaoSchool`에 `kakaoId`/`lat`/`lng`를 추가해 이미 받은 Kakao 응답
값을 그대로 통과시켰다(새 지오코딩 없음, 외부 API 호출 횟수 변화 없음). `src/lib/
school-link.ts`(신규, 순수 함수, 단위 테스트 있음)의 `buildSchoolHref()`가 좌표가
있을 때만 링크를 만든다 — 좌표가 없으면(과거 캐시, establishmentType 매칭 실패 등)
**null을 반환해 클릭 불가로 정직하게 남긴다**(학교명 재검색으로 다른 학교에 연결하는
name-only fallback 없음, 동명이교 오선택 없음).

`elementaryAttendanceZone.schools`/`middleSchoolGroup.schools`(NEIS 공식
통학구역/학교군, `schoolId`/`neisSchoolCode` 보유하지만 좌표 없음)는 **의도적으로
클릭 가능하게 만들지 않았다** — 기존 `/school/[id]` route가 좌표 기반 계약(§15)이라
좌표 없는 이 데이터를 억지로 연결하면 이름만으로 재검색하는 위험한 fallback이 되기
때문이다(§21 scope 제한과도 일치 — 학교 상세페이지 자체를 NEIS 코드 기반으로 재설계하는
것은 SCHOOLINFO/SCHOOL V2 몫).

---

## 15. School Route — 기존 계약 확인 후 재사용

`src/app/school/[id]/page.tsx`/`school-detail-client.tsx`를 실제로 읽어 확인한 결과,
**`[id]` 동적 세그먼트는 페이지 코드에서 전혀 읽지 않는다** — 실제 데이터 조회는 쿼리
스트링 `name`/`lat`/`lng`/`lawdCd`만으로 이뤄진다(`KakaoPlaces.tsx`/`map/page.tsx`의
학교 마커도 이미 동일 계약 사용). 이번 STEP은 이 기존 계약을 그대로 재사용했다 —
route 구조를 바꾸지 않았고, `[id]` 세그먼트에는 Kakao POI id(없으면 학교명)를 그대로
써서 URL 구조 관례를 유지했다.

---

## 16. Mobile QA

360px/375px(iframe-isolation 기법, `resize_window` 이 환경에서 불안정함이 이전
STEP들에서 재확인된 사실이라 우회)와 desktop(852px) 라이브 확인:

- AREA SECTION: 토글(있는 경우) + 칩 가로 스크롤 정상, 레이아웃 붕괴 없음.
- SCHOOL SECTION: "가까운 초등학교"/"고등학교" 항목에 화살표(`ChevronRight`)와 함께
  row 전체가 클릭 가능, "공식 통학구역"(좌표 없음)은 기존과 동일하게 텍스트만.
- BOTTOM: 관심단지/공유/글쓰기 3-action row가 하단 네비게이션과 겹치지 않고 균등 폭으로
  표시.

---

## 17. Desktop QA

852px에서 대신롯데캐슬 대상으로 확인: area toggle 클릭 정상(§2), school 클릭 정상(§18
아래), favorite/share 버튼(Hero 상단) 정상. 하단 3-action row는 기존 `.stickyBar`와
동일하게 **768px 초과에서는 노출되지 않는다**(기존 `display:none` 미디어쿼리 그대로 —
이 자체는 이전 `StickyPriceBar`도 동일했던 pre-existing 정책이라 회귀 아님, Hero 상단의
FavoriteButton/KakaoShareButton이 desktop에서 이미 같은 기능을 제공).

---

## 18. Regression Tests(신규)

- `src/lib/school-link.test.mjs`(6개): 좌표 있으면 canonical id/name/lat/lng/lawdCd
  링크 생성, 좌표 없으면 null(name-only fallback 부재 검증), lat/lng 각각 없거나
  NaN이면 null, kakaoId 없을 때 name을 안전하게 인코딩(이 테스트가 실제로 이중
  인코딩 버그를 잡아 수정했다 — 아래 §19 참고), lawdCd 없어도 나머지 파라미터 유지.
- `FavoriteButton.tsx`의 이벤트 브로드캐스트는 DOM/React state에 결합돼 있어 이
  프로젝트의 기존 `node --test` 순수 로직 테스트 관례로는 커버되지 않는다 — 새 E2E
  프레임워크는 도입하지 않는다는 제약(§29) 때문에 이 부분은 라이브 브라우저 확인으로만
  검증했다(§16/§17, 정직하게 명시).

기존 89개 포함 총 95/95 PASS(회귀 없음).

---

## 19. 실측 중 발견/수정한 이중 인코딩 버그(정직하게 기록)

`school-link.ts` 최초 구현에서 `kakaoId`가 없을 때 `encodeURIComponent(school.name)`을
먼저 만든 뒤 최종 URL에서 다시 `encodeURIComponent()`로 감싸 **이중 인코딩**되고
있었다. 새로 작성한 단위 테스트가 이를 즉시 잡아내 수정했다(id 세그먼트를 인코딩하지
않은 raw 값으로 두고 최종 조합에서 한 번만 인코딩). `[id]` 세그먼트 자체는 페이지가
쓰지 않아(§15) 실제 화면 동작에는 영향이 없었지만, 정확성을 위해 수정했다.

---

## 20. Remaining SCHOOL V2 Work

- 공식 통학구역/학교군(NEIS `schoolId`/`neisSchoolCode`, 좌표 없음)을 클릭 가능하게
  만들려면 `/school/[id]` route 자체를 좌표 기반에서 canonical school id 기반으로
  재설계해야 한다 — 이번 STEP 범위 밖(SCHOOLINFO/SCHOOL V2 후보).
- 어린이집 데이터(C3A ingestion 대기), 학년별 학생수 추이/특목고 진학률 등은 기존
  "데이터 준비 중" 상태 그대로(변경 없음, 이번 STEP 범위 밖).

---

## How To Run

```bash
npm run dev

node --experimental-strip-types --test src/lib/school-link.test.mjs
node --experimental-strip-types --test $(find src scripts -name "*.test.mjs")
```

---

## 관련 문서

- `docs/development/AREA_SELECTOR_V2_1_TOGGLE_HOTFIX.md` — ㎡/평 토글 원칙의 최초 근거.
- `docs/development/DETAIL_TRADE_AREA_STATE_SPLIT_V1.md` — trade/unit area identity 분리 근거.
- `docs/development/MAP_SURROUNDING_MARKER_PERFORMANCE_V1.md` — "이미 받은 좌표를 응답 직전에 버리는" 동일 패턴을 다룬 직전 STEP.
- `docs/development/CHANGELOG.md` — 이번 STEP 항목 추가.
