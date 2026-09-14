# COMMUNITY EDITOR V2.1A — PHOTO REPLACE INSERTION FIX

- 기준 HEAD: `7cfe5ca` (main)
- 범위: **작성기 UI 상태만**. DB schema·migration·API·`PostContentBlock`/`PostImage`·Storage·auth·영수증/보안 변경 없음. 사진 조작 UI 스타일 변경 없음.

## 1. 문제

V2.1 Production QA에서 발견(`COMMUNITY_EDITOR_V2_1_SIMPLE_INLINE_COMPOSER.md` §11).

```
TEXT A
IMAGE      ← 탭 → 삭제
TEXT B
```

삭제하면 A와 B가 한 글로 합쳐진다. 이때 글을 다시 누르지 않고 바로 [사진 추가]를 누르면 새 사진이 **본문 끝**에 들어갈 수 있었다.

## 2. 원인(코드 기준)

1. 작성기는 마지막 커서를 `cursorRef = { key, selectionStart, selectionEnd }`로 기억한다. 값은 입력칸의 select/keyup/click/focus/blur/change와,
   사진 삽입 직후 "사진 아래 입력칸 맨 앞으로 커서 이동" 효과에서 갱신된다.
2. 사진을 탭하면 입력칸이 blur되며 그 순간의 커서가 저장된다. 사진을 넣은 직후라면 커서는 **사진 아래 글(B) 입력칸**을 가리킨다.
3. 삭제(`removeComposerImage` → `normalizeComposerBlocks`)는 인접 글을 합치며 **앞 글(A)의 key를 남기고 B의 key를 없앤다**.
4. [사진 추가] → `handleFiles`에서 `textareasRef.get(B)`도, `insertImagesAtCursor`의 `findIndex(B)`도 실패한다. 커서가 가리키는 블록이 없으면 끝에 넣는 규칙대로 **본문 끝**에 들어간다.
5. 커서가 A를 가리키고 있었더라도 문제는 남는다. `handleFiles`가 선택창 복귀 후 "입력칸의 현재 선택 위치"를 다시 읽는데,
   합쳐진 A 입력칸은 React가 값을 바꾸면서 DOM 커서가 **글 끝**으로 가 있어 경계 위치가 사라진다.

## 3. 설계 — 삭제 anchor

### 3.1 `removeComposerImageWithAnchor(blocks, key, newKey) → { blocks, anchor }` (순수 함수)

삭제 결과와 함께 **삭제 자리**를 커서(`ComposerCursor`)로 돌려준다. 이 anchor에 기존 `insertImagesAtCursor`를 그대로 적용하면
새 사진이 지운 자리로 들어가고, 앞뒤 글은 삭제 전과 **글자 단위로 같게** 다시 나뉜다.

| 삭제 전(작성기 모양) | 삭제 후 | anchor |
|---|---|---|
| `A · 사진 · B` (둘 다 내용 있음) | `A\nB` (A key) | A key, **A 길이 + 1** (B가 시작하는 위치) |
| `A · 사진 · (빈 칸)` = TEXT–IMAGE | `A` | A key, A 길이(글 끝) |
| `(빈 칸) · 사진 · B` | `B` (빈 칸 key) | 0 |
| `사진 · B` = IMAGE–TEXT | `B` | B key, 0(맨 앞) |
| `사진 · (빈 칸)` = IMAGE only | `(빈 칸)` | 0 → 다음 사진은 맨 앞 |
| `A · 사진 · 사진2` | `A · 사진2` | A key, A 길이 |
| `사진1 · 사진 · 사진2` / `사진 · 사진2`(맨 앞) | 그 자리에 빈 입력칸 | 빈 입력칸 key, 0 |

**경계 위치를 "A 길이"가 아니라 "A 길이 + 1"로 둔 이유**: 합치기는 `A + "\n" + B`이고, 삽입 규칙은 나누는 자리의 줄바꿈 1개를 사진이 대신한다
(앞이 줄바꿈으로 끝나면 그것을, 아니면 뒤의 첫 줄바꿈을). "A 길이 + 1"에서 나누면 앞은 `A + "\n"`이 되고, 끝의 연결 줄바꿈 하나만 제거되어
**A와 B가 항상 원래대로** 돌아온다. A가 `"A\n"`, B가 `"\nB"`여도 마찬가지다. "A 길이"에서 나누면 A가 줄바꿈으로 끝날 때 A의 줄바꿈이 대신 없어진다.
사용자에게는 두 위치 모두 A와 B 사이 경계다.

합치기 결과는 기존 `removeComposerImage`와 같다. 예외는 양옆에 글이 없는 경우로, 이때만 삽입 위치를 표시할 빈 입력칸을 둔다(빈 칸은 저장 시 버려짐).
기존 `removeComposerImage`는 사진 처리 실패 시 자리표시자 제거에 그대로 쓴다.

### 3.2 커서 기억: `ComposerCursorMemory = { cursor, source: 'user' | 'delete-anchor' }`

- 입력칸 이벤트와 삽입 후 포커스 이동 → `source: 'user'`.
- 사진 삭제 → `source: 'delete-anchor'`.
- **passive 이벤트(select·blur)는 anchor를 덮지 않는다.** 합쳐진 입력칸에 포커스가 남아 있으면 React가 값을 바꿀 때 DOM 커서가 글 끝으로 가며
  select가 나고, 그 뒤 버튼을 누르면 blur가 난다. 둘 다 사용자가 고른 위치가 아니다.
  사용자 조작(focus·click·keyup·입력 change)은 바로 덮는다. anchor가 없을 때는 V2.1 그대로 select·blur도 커서를 기억한다(모바일 blur 경로).

### 3.3 `pickComposerInsertCursor(memory, activeCursor, selectedImageKey) → { cursor, rereadLive }`

[사진 추가]를 누르는 순간 삽입 기준을 정한다. 우선순위는 다음과 같다(선택한 사진 기준 삽입은 V2.1 그대로).

1. 선택한 사진이 있으면 그 뒤
2. **삭제 anchor**
3. 포커스가 있는 입력칸의 실제 커서
4. 기억한 사용자 커서

anchor가 포커스 입력칸보다 앞서는 이유: 첫 배포(`93a552a`)에서는 포커스 입력칸이 먼저였다. Production QA에서 삭제 전에 포커스가 있던
빈 이어 쓰기 칸이 사진·삭제 버튼을 누른 뒤에도 `document.activeElement`로 남아 새 사진이 끝에 들어갔다.
자동화의 `.click()`은 포커스를 옮기지 않기 때문이지만, 버튼 클릭이 포커스를 가져가지 않는 브라우저에서도 같은 일이 생길 수 있다.
사용자가 삭제 뒤 글을 실제로 누르거나 입력하면 기억이 `'user'`가 되므로 anchor 우선이 manual cursor 우선을 깨지 않는다.

- **manual cursor > delete anchor**: 삭제 뒤 사용자가 글을 누르거나 입력하면 기억이 `'user'`로 덮이므로 그 위치가 이긴다.
- `rereadLive`: 선택창 복귀 후 입력칸의 현재 선택 위치를 다시 읽을지. 사용자 커서는 다시 읽고(V2.1 그대로), **anchor는 읽지 않는다**(원인 5).

## 4. 동작

- **바로 교체**: 사진 탭 → 삭제 → (글을 누르지 않고) [사진 추가] → 갤러리 → 복귀 → 지운 자리에 삽입.
- **여러 장**: 지운 자리에 선택 순서대로 `사진 · 사진 · …`, 뒤 글은 원래 위치. 5장 상한 그대로.
- **포커스**: 삭제 후 DOM 포커스·선택 범위를 옮기지 않는다. 모바일에서 키보드가 불필요하게 뜨지 않도록 논리 위치만 기억한다.
- **글쓰기·수정 동일**: 두 화면 모두 `SimpleInlineComposer`를 쓴다. 수정 화면에서 기존 사진을 지우고 바로 추가해도 같은 자리에 들어간다.
  기존 사진의 Storage 삭제는 V2 규칙대로 저장 성공 후에만 일어난다.

## 5. 한글 IME

- 사진 삭제는 사진을 탭한 뒤에만 가능하다. 탭하면 입력칸이 blur되어 조합이 확정되므로, 조합 중 삭제는 일반적인 흐름에서 생기지 않는다.
- 조합 중 구조 변경 금지, 조합 중 선택이 끝나면 compositionend 후 삽입, 타이핑은 값만 갱신 — V2.1 정책 무변경(테스트 유지).
- anchor 도입은 새 구조 변경을 추가하지 않는다(삭제 시점에 이미 하던 합치기와 같은 계산).

## 6. 보안·저장

변경 없음: 서명 영수증, 본인 영수증, 같은 글 사진, 최대 5장, 409 동시 수정, 작성자/관리자, 평문 렌더, 저장 직렬화(`buildBlocksPayload`), API, schema, Storage.

## 7. 파일

| 파일 | 변경 |
|---|---|
| `src/lib/community/block-editor-state.ts` | `removeComposerImageWithAnchor`, `ComposerCursorMemory`, `pickComposerInsertCursor` 추가 |
| `src/components/community/SimpleInlineComposer.tsx` | 커서 기억에 source 추가, 삭제 시 anchor 기억, select·blur는 passive(anchor를 덮지 않음), [사진 추가] 기준 결정·anchor 재읽기 제외 |
| `src/lib/community/community-editor-v2-1a.test.ts` | 신규 13 tests(요청 16항목 매핑) |
| `src/lib/community/community-editor-v2-1.test.ts` | 작성기 배선 테스트 12·15의 코드 패턴만 새 배선으로 갱신 |

## 8. 검증

| 항목 | 결과 |
|---|---|
| V2.1A + V2.1 테스트 | 35/35 |
| src 전체 | **1878/1878** |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS — 25건 전부 기존 `scripts/`·`tmp/`, src 0 |
| eslint(변경 파일) | exit 0 |
| `npm run build` | exit 0 |

## 9. Production / 기기 QA

로그인한 데스크톱 Chrome에서 실제 `/community/write`·`/community/{id}/edit`로 확인했다. 사진은 페이지 안에서 만든 JPEG(모서리 색 표식)을
파일 입력에 넣었고, OS 파일 선택창은 띄우지 않았다. 순서는 미리보기·저장 사진의 색 표식으로 읽었다.

### 9.1 1차 배포 `93a552a` — FAIL(보강함)

`[보라, A, 빨강, B, 초록, 빈 칸]`에서 빨강 삭제 → 바로 추가 → 파랑이 **끝**에 들어갔다.
그 시점 `document.activeElement`는 삽입 직후 포커스를 받은 빈 이어 쓰기 칸이었다. 자동화의 `.click()`은 포커스를 옮기지 않아 남아 있었고,
`pickComposerInsertCursor`가 포커스 입력칸을 anchor보다 먼저 봤다. → §3.2·§3.3 보강(`494661d`). 이 초안은 등록하지 않고 버렸다(서버·Storage 영향 없음).

### 9.2 보강 배포 `494661d` — PASS

같은 조건(빈 이어 쓰기 칸에 포커스가 남은 채)으로 반복했다.

| # | 시나리오 | 결과 |
|---|---|---|
| A | `보라 · A · 빨강 · B · 초록 · 빈 칸`, B에 커서 → 빨강 탭·삭제 → 바로 추가(파랑) | 삭제 후 `A\nB` 합쳐짐 → `보라 · A · 파랑 · B · 초록` |
| B | IMAGE–TEXT: 보라 삭제 → 바로 추가(주황) | `주황 · A · …` (맨 앞) |
| C | TEXT–IMAGE: 초록(뒤는 빈 칸) 삭제 → 바로 추가(노랑) | `… · B · 노랑 · 빈 칸` (맨 뒤) |
| 우선 | 파랑 삭제 후 사용자가 합쳐진 글 맨 앞을 탭(포커스+click) → 추가(분홍) | anchor(A/B 사이)가 아니라 **탭한 위치**: `주황 · 분홍 · A\nB …` |
| 여러 장 | 노랑 삭제 → 2장(청록, 자홍) 한 번에 | 지운 자리에 선택 순서대로 `… · A\nB · 청록 · 자홍 · …` |
| 등록 | 글 경계에 빨강을 다시 넣어 `주황 · 분홍 · A · 빨강 · B · 청록 · 자홍 · C`(5장) 등록 | 익명 API 순서 일치 |
| D1 | 수정 화면: B 입력칸에 포커스·커서 → 기존 빨강 삭제 → 바로 추가(파랑) | `A · 파랑 · B` |
| D2 | 수정 화면: 맨 앞 기존 주황(뒤가 사진) 삭제 → 바로 추가(초록) | 맨 앞 `초록 · (빈 칸) · 분홍 · …` |
| 저장 전 | DB·Storage 조회 | 편집기에서 지운 빨강·주황 사진 행·객체 **그대로**(저장 전 서버 호출 없음) |
| 저장 | 저장하기 → 상세 | 상세·익명 API·DB 블록: `초록 · 분홍 · A · 파랑 · B · 청록 · 자홍 · C`. 빨강·주황 Storage 객체 삭제, 미참조 0·누락 0 |
| 정리 | QA 글 DELETE 200 → 404 | DB: 사진 있는 글 1·사진 행 2·블록 0. Storage 객체 2, 미참조 0·누락 0 |
| 보호 | "광복 롯데 애슐리" 글 | updatedAt·본문 길이 24·사진 2장(바이트 동일)·블록 0 그대로 |
| Data API | `scripts/audit-supabase-data-api-exposure.ts` | data-api 503, 노출 경로 0 (OFF 유지) |

자동화 메모
- 탭이 백그라운드라 `focus()/blur()`가 이벤트를 내지 않는다. 입력칸 blur는 `focusin`/`focusout`, 탭은 `focus()`+`click`을 보내 재현했다.
- "우선" 첫 시도에서 `click`만 보냈을 때는 포커스가 이전 빈 칸에 남아 그 칸이 이겼다. 사용자 커서끼리는 포커스 입력칸이 먼저인 V2.1 규칙이다.
  실제 탭은 포커스를 옮기므로 `focus()`를 함께 보내 확인했다.
- 360·375·390px은 Chrome 최소 창 폭 때문에 이 자동화로 확인할 수 없다.

**DEVICE QA REQUIRED** — 실제 Android(삼성·구글 키보드)·iOS Safari에서 사진 탭 → 삭제 → 바로 [사진 추가] → 갤러리 → 복귀 시 지운 자리 삽입,
삭제 뒤 글을 탭하면 탭한 위치 우선, 키보드 표시 여부.

## 10. 알려진 한계

- 사진 **이동**(위/아래) 직후 [사진 추가]는 이번 범위가 아니다. 이동으로 커서가 가리키던 입력칸이 합쳐져 사라지면 본문 끝에 들어갈 수 있다. → **V2.2에서 수정**(`COMMUNITY_EDITOR_V2_2_MOBILE_IMAGE_UX_FIX.md` §3).
- 사진 사이의 사진을 지우면 그 자리에 빈 입력칸이 보인다(삽입 위치 표시용, 저장되지 않음).
- 글 끝(뒤가 빈 칸)에서 교체할 때, A가 줄바꿈으로 끝났다면 그 끝 줄바꿈 1개는 사진이 대신한다(V2.1 삽입 규칙과 같음, 저장 시 앞뒤 공백 정리도 V2와 같음).
- 실제 Android·iOS 기기(갤러리 복귀·키보드)는 기기 QA가 필요하다.
