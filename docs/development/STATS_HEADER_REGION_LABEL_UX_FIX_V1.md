# STATS HEADER / REGION LABEL UX FIX V1

작성일: 2026-09-11
기준 커밋(작업 시작): `5ca7cfd` (branch `main`)
분류: 사용자 제보 UX 수정

---

## 1. 두 가지 문제

### ISSUE A — 지역 선택과 공유 버튼이 두 줄로 갈라진다

원인은 `src/app/stats/page.module.css`의 모바일 브레이크포인트였다:

```css
@media (max-width: 768px) {
  .headerTop { flex-direction: column; align-items: flex-start; gap: 1rem; }
  .regionTrigger { width: 100%; }
}
```

데스크톱에서는 이미 한 줄이었지만(`display:flex`), **768px 이하에서 세로로 꺾고 둘 다 전체 폭**으로 만들고 있었다. 사용자가 본 화면이 정확히 이 상태다.

### ISSUE B — "부산광역시 서구 동 전체"

"동"은 **행정 단계 이름**이지 선택된 지역이 아니다. 아무 동도 고르지 않았으면 그냥 "서구 전체"다. 하위 단계를 고르지 않았다는 이유로 그 단계 이름을 문구에 끼워 넣으면, 사용자에게는 "동"이라는 지역이 선택된 것처럼 읽힌다.

---

## 2. ISSUE B의 진짜 원인 — 여섯 곳에서 각자 만들고 있었다

라벨이 한 곳에서 만들어지지 않았다. 템플릿 문자열이 **여섯 군데**에 흩어져 있었고, 그중 다섯 곳이 `동 전체`를 붙였다:

| 파일 | 기존 |
|---|---|
| `contexts/RegionContext.tsx:38` | `'부산광역시 서구 동 전체'` (기본값 하드코딩) |
| `contexts/RegionContext.tsx:107` | `` `${sido} ${region_2depth_name} 동 전체` `` (GPS 해석) |
| `app/stats/stats-client.tsx:46` | `` `${sido} ${sigungu} 동 전체` `` |
| `app/school/school-client.tsx:34` | `` `${sido} ${sigungu} 동 전체` `` |
| `app/stats/[type]/type-client.tsx:434` | `` `${sido} ${sigungu} 동 전체` `` (공유 링크 진입) |
| `components/stats/LargeComplexView.tsx:54` | `'부산광역시 서구 동 전체'` (폴백 하드코딩) |

`RegionSelectModal`은 또 다른 규칙을 쓰고 있었다 — 구 전체 선택 시 `부산광역시 서구`(전체 없음). 즉 **같은 상태가 화면마다 다르게 표기**되고 있었다.

한 곳을 고치면 나머지 다섯 곳이 남는다. 그래서 규칙 자체를 한 곳으로 모았다.

---

## 3. 새 라벨 계약

`src/lib/region-display-name.ts` — `buildRegionDisplayName()` 하나가 **단일 출처**다.

| 상태 | 결과 |
|---|---|
| 시도만 | `부산광역시 전체` |
| 시도 + 구, 동 미선택 | `부산광역시 서구 전체` |
| 시도 + 구 + 동 | `부산광역시 서구 동대신동3가` |
| 시도 없음 | `''` (지어내지 않는다) |

규칙:

- `dong`이 `'all'`/빈 값이면 **동 단계를 문구에 넣지 않는다.** `동 전체`, `읍면동 전체` 같은 표현은 구조적으로 생성 불가능하다.
- `dong`이 이미 전체 주소(`부산광역시 서구 동대신동3가` — 지역코드 API가 주는 형태)면 앞을 중복해서 붙이지 않는다.
- 앞뒤 공백은 정리하고, `sigungu`가 공백뿐이면 시도 전체로 본다.

호출부 여섯 곳 + `RegionSelectModal` 세 곳을 전부 이 함수로 바꿨다. **`동 전체`를 만드는 코드는 저장소에 더 이상 없다**(`SearchFilterBar`의 `<option>동 전체</option>`는 "동 전부"를 뜻하는 드롭다운 선택지라 별개 — 지역 라벨이 아니다).

---

## 4. ISSUE A — 항상 한 줄

```
[ 📍 부산광역시 서구 전체            ▾ ] [공유]
```

| | before | after |
|---|---|---|
| ≤768px | `flex-direction: column`, 둘 다 `width:100%` → **두 줄** | 한 줄 유지, `gap` 1rem → 0.5rem |
| 지역 트리거 | 고정 폭(내용만큼) | `flex: 1 1 auto; min-width: 0` |
| 공유 버튼 | 아래로 밀림 | `flex: 0 0 auto` — **절대 줄어들지 않는다** |
| 긴 지역명 | 버튼을 밀어냄 | 트리거 **안에서** 말줄임 |

말줄임에 `min-width: 0`이 필요한 이유: flex 아이템의 기본 `min-width: auto`가 내용 폭 아래로 줄어드는 것을 막아, 그것 때문에 공유 버튼이 밀려난다.

`text-overflow: ellipsis`는 원래 `.regionTrigger`에 걸려 있었지만 **그 요소가 `display:flex`라 효과가 없었다.** 말줄임은 글자를 담은 자식에게 걸어야 한다 — `.regionTriggerLabel`을 새로 두고 `<span>`에 붙였다. 핀/캐럿 아이콘에는 `flex-shrink: 0`을 줘서 지역명이 길어도 찌그러지지 않는다.

모바일에서는 트리거의 안쪽 여백(0.6→0.55rem)과 글자(1rem→0.92rem)만 줄였다. **터치 타깃, 드롭다운 동작, 지역 선택 로직은 건드리지 않았다.**

---

## 5. 검증

### 빌드 산출 CSS 실측

```
.headerTop { align-items:center; gap:.75rem; margin-bottom:2rem; display:flex }
.headerTop > .regionTrigger { flex:auto; min-width:0 }
.headerTop > :not(.regionTrigger) { flex:none }
@media (max-width:768px){ .headerTop{ gap:.5rem; margin-bottom:1.25rem } }
.regionTriggerLabel { text-overflow:ellipsis; white-space:nowrap; min-width:0; overflow:hidden }
```

`flex-direction: column`이 **어디에도 없다.**

### 런타임 실측

공유 링크 진입(`?sido=부산광역시&sidoCode=26&sigungu=서구&dong=all&lawdCd=26140`):

```
렌더된 라벨 : "부산광역시 서구 전체"
"동 전체"   : 0건
공유 버튼   : 렌더됨
```

라우트: `/stats`, `/stats/decline`, `/stats/feed`, `/stats/area84`, `/stats/change-map`, `/school` 전부 200.

### 품질 게이트

| 항목 | 결과 |
|---|---|
| `region-display-name.test.ts` (신규 11건) | 11/11 PASS |
| src 전체 테스트 | **642/642 PASS**, fail 0 |
| 변경 파일 ESLint | exit 0 |
| `npx tsc --noEmit` | src/ 오류 0건(전체 exit 2는 기존 `scripts/`·`tmp/`) |
| `npm run build` | exit 0 |

---

## 6. 모바일 QA — **STRUCTURAL QA ONLY**

**브라우저 렌더링이 아니다.** 이 세션에서 브라우저 확장이 승인되지 않았고 헤드리스 브라우저는 `package.json`을 건드려야 해서 설치하지 않았다. 아래는 빌드된 CSS와 실측 치수에 근거한 계산이다.

360px 기준:

```
container 내부      328px  (뷰포트 360 - 좌우 16px)
- headerTop gap       8px
- 공유 버튼          44px  (.iconBtn 고정 44×44, flex:none)
= 지역 트리거       276px
  - 좌우 패딩      27.2px  (0.85rem × 2)
  - 핀 + 캐럿 + gap  44px
  = 글자 공간      ~205px  @ 0.92rem(14.7px) → 한글 약 13자
```

| 폭 | 결과 |
|---|---|
| 360 | 한 줄. "부산광역시 서구 전체"(11자) 여유, "부산광역시 해운대구 전체"(12자) 들어감 |
| 390 / 430 | 한 줄, 여유 증가 |
| 768 | 한 줄(모바일 규칙 경계) |
| 1280 | 한 줄, 트리거가 남는 폭을 차지 |

- **가로 오버플로 없음**: 고정 폭/`min-width` 없음. 트리거가 `min-width:0`으로 줄어든다.
- **탭 영역**: 공유 버튼 44×44 유지(`flex:none`이라 깎이지 않는다).
- **긴 이름**: 공유 버튼을 밀어내는 대신 트리거 안에서 말줄임.

**권장**: 실제 기기 360px에서 한 번 눈으로 확인.

---

## 7. 회귀 확인

| 항목 | 상태 |
|---|---|
| 공유 기능(Web Share / fallback / analytics) | `ShareAction`을 **이동만** 했고 props·내부 로직 무변경 |
| 지역 선택 모달 | 열림/선택/확정 경로 무변경 — 라벨 문자열만 공통 함수로 |
| 기간 필터(7일~12개월) / 정렬 / 면적 selector | 무변경 |
| 랭킹 리스트·카드 | 무변경 |
| 하단 네비게이션 | 무변경 |
| 데이터 의미 | 무변경 — 표시 문자열과 레이아웃만 |
| `/school` 지역 라벨 | 같은 함수로 교정(레이아웃은 손대지 않음 — 그 화면엔 공유 버튼이 없다) |

---

## 8. 보류 항목 유지 (§10)

`SCHOOL SCORE IMPACT SIMULATION V1`을 `docs/development/00-PROJECT-ROADMAP.md`의 새 **"보류 / P1 데이터 신뢰"** 절에 기록했다. 21건 SC4 잘림 + 20건 1km 밖 null + 직접 영향 41건, 점수 출처는 아직 바꾸지 않았으며 착수 전 영향 시뮬레이션이 필요하다는 조건까지 함께 남겼다.

---

## 9. 알려진 한계

1. 모바일 QA가 렌더링 기반이 아니다(§6).
2. `/school` 헤더 레이아웃은 이 STEP 범위 밖이라 그대로다(자체 `school.module.css`를 쓰고 공유 버튼이 없다). 라벨만 교정됐다.
3. 지역명이 아주 길면 트리거 안에서 잘린다 — 의도한 동작이며, 전체 이름은 선택 모달에서 확인할 수 있다.
4. `community`/`tools`의 `.headerTop`은 다른 CSS 모듈이라 영향받지 않는다.
