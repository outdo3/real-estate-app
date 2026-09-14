# COMMUNITY EDITOR V2.2 — MOBILE IMAGE UX FIX

- 기준 HEAD: `183ccb9` (main)
- 범위: **작성기 UI/UX만**. DB schema·migration·API·`PostContentBlock`/`PostImage`·Storage·auth·영수증/보안 변경 없음. 게시글 상세 화면 변경 없음.

실제 Android 기기에서 확인된 두 문제만 고친다.

## 1. A — 사진을 누르면 브라우저 이미지 메뉴가 뜸

### 증상
편집기에서 사진을 눌러 이동·삭제하려 하면 "이미지 복사 / 이미지 다운로드 / 이미지 공유" 메뉴가 떠서 편집기 조작 버튼을 쓸 수 없었다.

### 원인(코드 기준, V2.1 `SimpleInlineComposer`)
- 사진은 `<button class=imageButton>` 안의 일반 `<img>`였다. `onClick`으로 선택을 토글할 뿐, 다음이 모두 없었다.
  - `contextmenu`·`dragstart` 처리
  - `draggable={false}`
  - `-webkit-touch-callout`·`user-select`·`-webkit-user-drag` 스타일
- Android Chrome은 `<img>`를 **길게 누르면(약 0.5초)** 이미지 컨텍스트 메뉴를 띄우고 그 터치의 click을 취소한다.
  사진을 "잡아서 옮기려는" 동작은 대개 조금 오래 누르게 되므로 메뉴가 뜨고 선택은 일어나지 않았다.

### 수정 — 편집기 사진에만 적용
| 대상 | 적용 |
|---|---|
| `figure[data-composer-image]` | `onContextMenu` → `preventDefault()` + **그 사진 선택**(길게 눌러도 메뉴 대신 조작 버튼). `onDragStart` → `preventDefault()` |
| `<img>` | `draggable={false}` |
| `.imageCard` CSS | `-webkit-touch-callout: none`(iOS 길게 누름 callout), `user-select: none` |
| `.image` CSS | `-webkit-user-drag: none`, `pointer-events: none` — 탭·길게 누름의 대상이 `<img>`가 아니라 선택 버튼이 된다 |
| `.imageButton`, `.control` CSS | `touch-action: manipulation` — 두 번 탭 확대 대기 없이 바로 탭. 스크롤·핀치 확대는 그대로 |

- 탭 = 선택 토글(V2.1 그대로). 조작 버튼(이미지 위로 이동 / 아래로 이동 / 삭제, 44px)은 선택한 사진에서만 보이고, 사진 밖을 누르면 닫힌다(V2.1 pointerdown 해제 그대로).
- **스크롤과 탭 구분**: 터치 핸들러를 새로 넣지 않았다. 모바일 브라우저는 스크롤 제스처 뒤 click을 만들지 않으므로 click 기반으로 충분하다.
- **게시글 상세**(`CommunityPostContent`)는 다른 컴포넌트다. 복사·다운로드·공유가 그대로 되며, 테스트로 고정했다.

## 2. B — 긴 글에서 [사진 추가]가 화면 밖으로 사라짐

### 결정
- 버튼은 **하나**다. 복제하지 않으므로 삽입 핸들러가 하나뿐이다.
  - 데스크톱: 본문 위 그대로.
  - 모바일: CSS로 **본문 아래로 옮겨 화면 하단(탭바 바로 위)에 sticky**로 붙인다.
- 기준 폭은 `max-width: 900px`다. Header 내장 하단 탭바(`.menuList`)와 공용 `BottomNav`가 보이는 폭과 같아, 탭바 높이를 더하는 계산이 정확히 그 구간에서만 쓰인다.
- sticky이므로 **작성기가 화면에 있는 동안만** 하단에 붙는다. 본문을 지나 등록 버튼 쪽으로 내려가면 본문 끝 제자리에 멈추고, 제목 영역에서는 작성기 상자 위로 올라오지 않는다.

### 위치
```css
@media (max-width: 900px) {
  .composer { --composer-bottom-nav-height: 60px; }   /* Header .menuList / BottomNav .nav 높이 */
  .body     { order: 1; }
  .toolbar  { order: 2; position: sticky;
              bottom: calc(var(--composer-bottom-nav-height) + env(safe-area-inset-bottom, 0px) + 8px);
              z-index: 5; justify-content: flex-end; pointer-events: none; }
  .toolbar .photoButton { pointer-events: auto; box-shadow: …; }
}
```
- 탭바 높이 토큰이 없어(두 CSS 모듈에 60px로 적혀 있음) 작성기 CSS 변수 하나로 두고 출처를 주석에 적었다. 테스트가 두 탭바의 60px + safe-area와 맞는지 확인한다.
- 오른쪽 정렬 알약 버튼이다. 행의 빈 부분은 `pointer-events: none`이라 버튼 옆 글을 누를 수 있다. z-index 5로 탭바(1000) 아래 층이다.
- 레이아웃 뷰포트(`viewportFit: cover`)에서 `env(safe-area-inset-bottom)`이 실제 값을 갖는다.

### 키보드
- Android Chrome(기본 `interactive-widget=resizes-visual`)과 iOS Safari는 키보드가 떠도 **레이아웃 뷰포트를 줄이지 않는다**. 그래서 sticky·fixed 하단 요소는 키보드 뒤로 간다. 하단 탭바도 마찬가지다.
- 전역 viewport 설정(`interactive-widget=resizes-content`)은 모든 페이지의 하단 탭바를 키보드 위로 올리므로 쓰지 않았다.
- 대신 작성기가 `visualViewport`의 resize·scroll과 window scroll(rAF 1회로 묶음)에서 다음을 한다.
  1. 버튼의 원래 아래 끝(`getBoundingClientRect().bottom` − 현재 이동량)이 **보이는 영역 아래 끝**(`vv.offsetTop + vv.height − 8px`)보다 아래면, 그만큼만 `translateY`로 올린다.
  2. sticky처럼 **작성기 상자 위로는 올리지 않는다**. 제목 입력 중 작성기가 화면 아래에 있으면 버튼도 따라오지 않는다.
  3. 900px 초과에서는 이동하지 않는다(`matchMedia`).
- `innerHeight`로 레이아웃 뷰포트 높이를 추정하지 않는다. 주소창 표시·숨김에 따라 값이 어긋나기 때문이다.
- 버튼의 `mousedown` 기본 동작 차단(입력칸 포커스·커서 유지)은 V2.1 그대로다.

## 3. 커서 삽입 — 변경 없음 + 이동 뒤 보강(P2)

- [사진 추가]는 같은 `openPicker` → `pickComposerInsertCursor` → `insertImagesAtCursor`를 쓴다. 커서 위치, 삭제 anchor, 사용자 커서 우선, 여러 장, 사진부터 시작, 5장 상한이 모두 그대로다.
- **사진 이동 직후 [사진 추가]가 끝에 들어갈 수 있던 한계**(V2.1A §10)를 같이 고쳤다.
  - `normalizeComposerBlocksWithCursor` / `moveComposerImageWithCursor`: 이동 후 합치기로 사라지는 글 칸을 가리키던 커서(사용자 커서·삭제 anchor 모두)를 합쳐진 글의 같은 글자 위치로 옮긴다.
    - 앞이 빈 칸: 같은 위치
    - 뒤가 빈 칸: 앞 글 끝
    - 둘 다 내용: 앞 글 길이 + 1 + 위치
  - 기존 `normalizeComposerBlocks`·`moveComposerImage` 결과는 같다(래퍼).
  - 옮긴 커서는 `'move-anchor'`로 기억한다. 삭제 anchor와 같이 다룬다: 선택창 복귀 후 다시 읽지 않고, select·blur로 덮이지 않으며, 사용자가 글을 누르거나 입력하면 덮인다.
    - 이유: 첫 배포(`1fbd79a`) Production QA에서 이동 뒤 추가한 사진이 합쳐진 글의 **끝**에 들어갔다.
    - 옮긴 위치 계산은 맞았지만 `'user'` 커서라 복귀 후 입력칸의 DOM 커서를 다시 읽었고, 합쳐진 입력칸은 값이 바뀌어 DOM 커서가 글 끝에 가 있었다(V2.1A 원인 5와 같은 함정).
- 옮긴 사진이 화면 밖으로 사라지지 않게 `scrollIntoView({ block: 'nearest' })`를 한다.

## 4. 글쓰기·수정

두 화면 모두 같은 `SimpleInlineComposer`이고 둘 다 하단 탭바를 숨기지 않는다(오프셋 전제, 테스트로 고정).

## 5. 파일

| 파일 | 변경 |
|---|---|
| `src/components/community/SimpleInlineComposer.tsx` | 편집기 사진 contextmenu/drag 차단·길게 누름 선택, 이동 시 커서 보정·스크롤, 키보드 위로 버튼 올리기 |
| `src/components/community/SimpleInlineComposer.module.css` | 편집기 사진 callout·선택·끌기 차단, 모바일 하단 고정 툴바 |
| `src/lib/community/block-editor-state.ts` | `normalizeComposerBlocksWithCursor`, `moveComposerImageWithCursor` |
| `src/lib/community/community-editor-v2-2.test.ts` | 신규 13 tests(요청 20항목 매핑) |

## 6. 검증

| 항목 | 결과 |
|---|---|
| 작성기 테스트(V2·V2.1·V2.1A·V2.2) | 79/79 |
| src 전체 | **1891/1891** |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS — 25건 전부 기존 `scripts/`·`tmp/`, src 0 |
| eslint(변경 파일) | exit 0 |
| `npm run build` | exit 0 |

## 7. Production / 기기 QA

로그인한 Chrome 창을 800px로 줄여(뷰포트 784px — 900px 이하 모바일 레이아웃, Chrome 최소 창 폭 때문에 360~390px 불가) 실제 `/community/write`·`/community/{id}/edit`에서 확인했다.
사진은 페이지 안에서 만든 JPEG(모서리 색 표식)을 파일 입력에 넣었고 OS 선택창은 띄우지 않았다. 길게 누름은 손가락 아래 요소(`elementFromPoint`)에 `contextmenu` 이벤트를 보내 재현했다.

### 7.1 1차 배포 `1fbd79a`
- 사진 탭·길게 누름·끌기·하단 고정·커서 삽입: PASS.
- **이동 뒤 [사진 추가]: FAIL** — 합쳐진 글의 끝에 들어갔다. → `'move-anchor'` 보강(`9c23b58`, §3). 이 초안은 등록하지 않고 버렸다(서버·Storage 영향 없음).

### 7.2 보강 배포 `9c23b58` — PASS

| # | 시나리오 | 결과 |
|---|---|---|
| B1 | 25줄+사진+25줄+사진+25줄(본문 약 3,000px) 작성 후 가운데로 스크롤 | [사진 추가]가 화면 안 하단에 고정. 버튼 아래 끝 647 / 탭바 위 끝 655 → **간격 8px**, 버튼 가운데 hit test = 버튼, 버튼 옆 빈 곳 hit test = 아래 글 입력칸 |
| B2 | 스크롤한 채 "중간" 글 12번째 줄 끝에 커서 → 하단 버튼으로 사진(초록) | 위로 스크롤하지 않고 `중간 1~12줄 · 초록 · 중간 13~25줄` |
| A1 | 초록 사진 길게 누름(contextmenu) | 대상 = 선택 버튼(`<img>` 아님), `defaultPrevented = true`, 조작 버튼 표시. `dragstart`도 막힘 |
| A2 | 탭 / 사진 밖 탭 | 선택 ↔ 해제. 조작 버튼 3개 각 44×44px, 각 버튼 가운데 hit test 통과 |
| A3 | 위로 → 아래로 | `빨강 · 초록 · 중간(25줄 합쳐짐)` → `빨강 · 중간 · 초록 · 파랑`. 옮긴 사진은 화면 안 |
| A4 | 이동 뒤 선택 해제(글 탭 없음) → 하단 버튼으로 사진(노랑) | **기억한 자리** `중간 1~12줄 · 노랑 · 중간 13~25줄` |
| 등록 | 등록 → 상세 | 상세 사진: `contextmenu`·`dragstart` **막지 않음**, `pointer-events: auto`, `user-select: auto`, `draggable = true`(복사·다운로드·공유 그대로) |
| C1 | 수정 화면을 긴 글 아래로 스크롤 | 하단 고정(sticky), 탭바와 8px, hit test 통과. 저장 순서 그대로 불러옴 |
| C2 | 기존 사진(파랑) 길게 누름 → 아래로 | 메뉴 막힘·선택, `… · 뒷부분 · 파랑` |
| C3 | 기존 노랑 삭제 → 바로 하단 버튼으로 보라 | 같은 자리 `중간 1~12줄 · 보라 · 중간 13~25줄` |
| C4 | "뒷부분" 5번째 줄 끝 커서 → 하단 버튼으로 주황 | `뒷부분 1~5줄 · 주황 · 뒷부분 6~25줄` |
| 저장 | 저장하기 → 익명 API | `앞부분 · 빨강 · 중간 1~12 · 보라 · 중간 13~25 · 초록 · 뒷부분 1~5 · 주황 · 뒷부분 6~25 · 파랑` (편집기와 동일) |
| 정리 | QA 글 DELETE 200 → 404 | DB: QA 글·사진·블록 0, 사진 있는 글 1·사진 행 2·블록 0. Storage 객체 2, 미참조 0·누락 0 |
| 보호 | "광복 롯데 애슐리" 글 | updatedAt·본문 길이 24·사진 2장(바이트 동일)·블록 0 그대로 |
| Data API | `scripts/audit-supabase-data-api-exposure.ts` | 503, 노출 경로 0 (OFF 유지) |

자동화로 확인할 수 없는 것
- 실제 터치 길게 누름 메뉴(데스크톱 Chrome은 `-webkit-touch-callout` 미지원이라 계산값이 비어 있음 — iOS 전용 속성).
- 가상 키보드와 `visualViewport` 변화, 360/375/390px 폭, 갤러리 복귀.

**DEVICE QA REQUIRED** — 실제 Android 폰:
1. 사진 탭 / 길게 누름 — 편집기에서 "이미지 복사·다운로드·공유" 메뉴가 뜨지 않는지
2. 위로/아래로 이동
3. 긴 글 스크롤 중 하단 [사진 추가] 표시
4. 키보드를 연 상태에서 버튼이 키보드 위에 보이고 눌리는지
5. 현재 커서 위치 삽입
6. 갤러리 복귀
7. 수정 화면

iOS Safari: 길게 누름 callout, 키보드 위치.

## 8. 알려진 한계

- 하단에 붙은 버튼은 오른쪽 아래 글 한두 줄 일부를 가릴 수 있다(버튼 옆 빈 곳은 통과). 브라우저의 "입력 중 커서를 화면 안으로" 스크롤은 이 버튼을 고려하지 않는다.
- 키보드 위치 계산은 `getBoundingClientRect`와 `visualViewport`가 같은 좌표계(레이아웃 뷰포트 기준)라는 전제다. Chrome은 그렇고, iOS Safari는 기기 확인이 필요하다.
- 사진 사이의 빈 입력칸 등 V2.1A 한계는 그대로다.
- 실제 Android·iOS의 길게 누름 메뉴, 키보드, 갤러리 복귀는 기기 QA가 필요하다.
