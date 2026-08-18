# MAIN UI-B1 / STEP 52 — 홈 Search Hero + 빠른 탐색 + 최근 본 단지

상태: **구현 완료 / production build 통과 / commit·push 하지 않음**

STEP 51(조사·설계)에서 확정한 방향대로, 홈의 Primary를 AI 검색에서 일반
아파트 이름 검색으로 재구성했다. Bottom Nav 디자인 개편은 하지 않았다
(MAIN UI-B2 예정).

---

## 1. Before

```
Header
─────────────────────────────
[AI 검색 Hero]
  h1: "니가 찾는 아파트가 뭐야?"
  검색창 1개 → 무조건 /ai-search로 이동
  추천 프롬프트 칩 4개
─────────────────────────────
AdContainer(banner)
─────────────────────────────
[핵심 Quick 메뉴]
  큰 카드 2개: 🗺️ 지도 검색 / 📊 시장통계(인기)
  아이콘 그리드 6개
─────────────────────────────
AdContainer(banner)
```

- 일반 아파트 이름 검색창이 없음(전부 AI 해석을 거침)
- "최근 본 단지" 섹션이 홈에 없음(상세페이지에만 존재)

## 2. After

```
Header (미변경)
─────────────────────────────
[검색 Hero]
  태그라인: "복잡한 부동산, 이집으로 쉽게"
  일반 아파트 이름 검색창 (Primary) — 선택 즉시 상세 이동
  빠른 액션 2개: 🗺️ 지도에서 찾기 / ✨ 조건으로 집 찾기
─────────────────────────────
[최근 본 단지] (있을 때만 렌더, 최대 5개, 가로 스크롤)
─────────────────────────────
AdContainer(banner)
─────────────────────────────
[핵심 Quick 메뉴]
  큰 카드 1개: 📊 시장통계(인기)  ← 지도 카드는 Hero의 CTA와 중복이라 제거
  아이콘 그리드 6개 (미변경)
─────────────────────────────
AdContainer(banner)
```

## 3. 일반검색 — 데이터 소스와 이동 방식

신규 컴포넌트 `src/components/HomeApartmentSearch.tsx`를 만들었다.

- 검색 입력/드롭다운 자체는 `ApartmentAutocomplete`(카카오 키워드 검색,
  `/map`·`/stats`·상세페이지에서 이미 쓰는 컴포넌트)를 그대로 재사용.
  수정하지 않았다.
- 선택 시 상세 이동 전 검증(좌표→법정동 역지오코딩 후 기존
  `/api/apt/[name]?period=12&lawdCd=..&dong=..`로 실거래 존재 여부 확인)은
  상세페이지 `ApartmentQuickSearch.tsx`의 `handleSelect`와 **동일한 방식**을
  홈 전용으로 새로 작성했다.

**`ApartmentQuickSearch` 자체를 재사용하지 않은 이유**: 그 컴포넌트는
상세페이지 모달로 열렸다가 닫히는 것을 전제로 `popstate` 리스너를 등록해
"뒤로가기 = 닫기"를 흉내낸다(`window.history.pushState` 포함). 홈에서는
이 검색창이 페이지와 함께 상시 마운트돼 있어, 그대로 재사용하면 사용자가
누르지도 않은 뒤로가기 한 번을 조용히 소모하는 회귀가 생긴다. 그래서
검증+이동 로직만 새로 작성했고, 상세페이지 LOCK 대상 파일
(`ApartmentQuickSearch.tsx`, `ApartmentAutocomplete.tsx`, `apt-client.tsx`)은
전혀 건드리지 않았다.

결과 표시는 지시대로 단지명+지역만 (기존 `ApartmentAutocomplete` 자체 UI
그대로).

## 4. AI 검색 — 역할 변경 (로직 무수정)

- `ai-search-client.tsx`, `/api/ai-search` 등 AI 검색 로직/코드는 **한 줄도
  수정하지 않았다.**
- 홈의 "✨ 조건으로 집 찾기" 버튼은 `/ai-search`로 이동하는 `Link`다(쿼리
  없음). `/ai-search` 페이지는 이미 자체 검색창 + 추천 프롬프트 3개
  (`FOLLOWUP_SUGGESTIONS`) + empty state를 갖춘 완결된 화면이라, 홈에
  AI UI를 다시 만들 필요가 없었다.
- **판단**: STEP 52 지시문 8항의 "추천 prompt 4개... '조건으로 집 찾기'
  영역을 열었을 때 재사용"은, 홈 안에 인라인으로 AI 패널을 다시 그리는
  대신 이미 그 역할을 하는 `/ai-search` 페이지로 연결하는 것으로 해석해
  구현했다. 홈의 옛 `SUGGESTIONS`(4개)는 `/ai-search`의 기존
  `FOLLOWUP_SUGGESTIONS`(3개, 내용 거의 동일)와 중복이라 홈에 남겨두지
  않았다 — 삭제된 것이 아니라 이미 `/ai-search`에 존재하는 동일 자산으로
  통합된 것이다. 인라인 확장이 필요하면 B2 이후 재논의 필요.

## 5. 지도 CTA

"🗺️ 지도에서 찾기" → `/map` (신규 `Link`, 로직 없음).

기존 핵심 Quick 메뉴의 "🗺️ 지도 검색" 큰 카드는 이 CTA와 완전히
중복되어 제거했다(9항 "중복 CTA 금지" 반영). 남은 큰 카드 1개가 어색하게
반쪽만 채워지지 않도록 `.bigCards` grid를 `1fr 1fr` 고정에서
`repeat(auto-fit, minmax(140px, 1fr))`로 바꿔, 카드 1개일 때 전체 폭을
자연스럽게 채우도록 했다(카드 개수와 무관하게 동작하는 일반적 수정).

## 6. 최근 본 단지

- `src/lib/recent-apartments.ts`의 `getRecentApartments()`를 그대로
  재사용(수정 없음). `localStorage` 키 `ejip:recentApartments`,
  최대 저장 개수 8개 정책도 그대로다.
- 홈에서는 앞 5개만 표시(`HOME_RECENT_LIMIT = 5`, 지시문 6항 "3~5개
  우선 노출" 반영).
- 가격 등 추가 API 호출 없음. 표시 항목은 단지명 + 지역(`address`)뿐.
- 항목이 0개면 섹션 자체를 렌더하지 않는다(`recent.length > 0`
  조건부 렌더) — 빈 상태 placeholder도 만들지 않았다(지시문 6항의
  두 옵션 중 "섹션 자체를 숨김"을 택함).
- 모바일에서는 가로 스크롤 compact 카드(`overflow-x:auto`,
  `min-width:150px / max-width:190px`, 이름/주소 각각 1줄
  ellipsis) — 긴 단지명·긴 주소도 카드 밖으로 넘치지 않는다.
- 카드 클릭 시 이동은 검증 없이 바로
  `/apt/[name]?lawdCd=..&dong=..`(이미 방문 이력이 있는 항목이라
  `ApartmentQuickSearch`의 "최근 본 단지" 목록과 동일한 방식).

## 7. 신규 API / DB / schema

없음. 전부 기존 자산(`ApartmentAutocomplete`, `/api/apt/[name]`,
`recent-apartments.ts`, `/map`, `/ai-search`) 재사용.

## 8. 네트워크 호출

- 페이지 로드 시: 없음(최근 본 단지는 `localStorage`에서만 읽음).
- 검색 입력 중: 기존 `ApartmentAutocomplete`의 카카오 키워드 검색
  디바운스(300ms) + 상위 3개 결과 보강 조회(`/api/apt/[name]/info`) —
  기존 컴포넌트 동작 그대로, 신규 호출 아님.
- 결과 선택 시: 좌표→법정동 역지오코딩(카카오) 1회 + 실거래 검증
  (`/api/apt/[name]?period=12`) 1회 — 상세페이지 빠른검색과 동일한
  패턴.

## 9. 검증

### 정적 검증

- `npx tsc --noEmit` — 통과(에러 없음)
- `npx eslint src/app/home-client.tsx src/components/HomeApartmentSearch.tsx` — 통과(에러 없음)
- `npx next build` — 통과, 30개 라우트 정상 생성, `/`는 여전히 `○ (Static)`
- DB/schema/migration: 무변경(prisma 명령 실행 안 함, 변경 파일 없음)

### 브라우저 검증 (Chrome, localhost:3000, dev 서버)

| 케이스 | 결과 |
|---|---|
| A. 홈 → "대신푸르지오1차" 검색 → 선택 → 상세 즉시 이동 | 통과 — `/apt/대신푸르지오1차아파트?lawdCd=26140&dong=서대신동1가`로 정확히 이동(스크린샷 확인) |
| B. 다른 단지 검색 → 정확한 상세 | A와 동일 컴포넌트/로직이라 별도 케이스 추가 확인 생략(중복 검증) |
| C. 홈 → 지도에서 찾기 → /map | 통과 |
| D. 홈 → 조건으로 집 찾기 → 기존 AI 검색 정상 | 통과 — `/ai-search` 페이지 정상 렌더, 검색창/추천 프롬프트 3개 그대로 |
| E. 홈 → 최근 본 단지 → 상세 | 통과 — "고원3단지아파트" 카드 클릭 → 정확한 lawdCd/dong으로 상세 이동 |
| F. 최근 본 단지 없음 → 깨짐 없음 | 통과 — `localStorage` 비운 뒤 섹션 자체가 사라짐, 레이아웃 깨짐 없음 |
| G. 모바일 360/375/390 → overflow 없음 | 통과 — iframe 격리 기법으로 3폭 동시 확인(`resize_window` 도구가 이 환경에서 실제 창 크기를 바꾸지 못하는 문제가 있어 우회). 검색창/버튼/최근 본 단지(긴 이름 포함 테스트)/하단 nav 모두 겹침·잘림 없음 |

PC(1568px 기준 확인): 검색창이 `max-width:640px`로 과도하게 넓어지지
않음, 여백 정상.

## 10. 상세 V1 변경 여부

**없음.** `src/app/apt/[name]/` 하위 파일, `ApartmentQuickSearch.tsx`,
`ApartmentAutocomplete.tsx`, `recent-apartments.ts`를 전혀 수정하지
않았다(전부 읽기만 하고 재사용). APT DETAIL V1 LOCK 유지.

## 11. 기존 home 기능 회귀

- AI 검색: 로직 무수정, 진입 경로만 Primary→Secondary로 변경.
- 핵심 Quick 메뉴 아이콘 그리드 6개: 미변경.
- 광고 슬롯 2곳(`home-search-bottom`, `home-quick-menu-bottom`): 위치
  유지, 코드 미변경(`NEXT_PUBLIC_ADS_ENABLED=false`라 여전히 비활성).
- Bottom Nav(`Header.tsx`): 미변경.

## 12. 수정/생성 파일

수정:
- `src/app/home-client.tsx`
- `src/app/home-client.module.css`

신규:
- `src/components/HomeApartmentSearch.tsx`
- `docs/development/52-main-home-search-hero.md`(이 문서)

## 13. B2 후속 후보

- Bottom Nav 이모지→아이콘 시스템, 라벨, active/inactive, safe-area
  (STEP 51에서 이미 식별).
- "조건으로 집 찾기"를 홈 인라인 확장형으로 바꿀지(현재는 `/ai-search`
  이동) — 사용자 피드백 이후 재논의.
- 재개발·분양 진입점을 홈 본문에 노출할지(현재는 상단/하단 nav에만
  존재, STEP 51에서 식별된 갭이며 이번 STEP에서는 의도적으로 다루지
  않음 — 지시문 9항이 재개발·분양 정리를 B2로 명시).

## 14. 알려진 문제

없음(BLOCKER 없음).

## 15. 다음 STEP

사용자 모바일 실기기 검수 → 승인 후 commit/push → MAIN UI-B2
(탐색 섹션 정리 + Bottom Nav 개편) 진행.
