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

(배포 후 기록)

## 8. 알려진 한계

- 하단에 붙은 버튼은 오른쪽 아래 글 한두 줄 일부를 가릴 수 있다(버튼 옆 빈 곳은 통과). 브라우저의 "입력 중 커서를 화면 안으로" 스크롤은 이 버튼을 고려하지 않는다.
- 키보드 위치 계산은 `getBoundingClientRect`와 `visualViewport`가 같은 좌표계(레이아웃 뷰포트 기준)라는 전제다. Chrome은 그렇고, iOS Safari는 기기 확인이 필요하다.
- 사진 사이의 빈 입력칸 등 V2.1A 한계는 그대로다.
- 실제 Android·iOS의 길게 누름 메뉴, 키보드, 갤러리 복귀는 기기 QA가 필요하다.
