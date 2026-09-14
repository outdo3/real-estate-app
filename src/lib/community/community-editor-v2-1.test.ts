import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildBlocksPayload,
  composerAtBlockLimit,
  composerImageMoveState,
  editorBlocksFromViews,
  editorSnapshot,
  insertImagesAtCursor,
  moveComposerImage,
  normalizeComposerBlocks,
  precheckBlocks,
  removeComposerImage,
  resolveImageBlock,
  updateTextBlock,
  type ComposerCursor,
  type EditorBlock,
} from './block-editor-state';
import { BLOCK_ERROR_MESSAGES, MAX_CONTENT_BLOCKS, toContentBlockViews } from './content-blocks';

/**
 * COMMUNITY_EDITOR_V2.1 — 단순 인라인 작성기 계약.
 * 저장 형식·서버·DB는 V2 그대로다(기존 테스트가 계속 지킨다). 여기서는 커서 위치 삽입·글 나누기/합치기·사진 조작과
 * 화면 구조(블록 조립 UI 제거)를 고정한다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const COMPOSER = 'src/components/community/SimpleInlineComposer.tsx';

let seq = 0;
const newKey = () => `k${++seq}`;
const text = (key: string, t: string): EditorBlock => ({ key, kind: 'text', text: t });
const processing = (key: string): EditorBlock => ({ key, kind: 'image', image: { status: 'processing' } });
const existing = (key: string, imageId = key): EditorBlock => ({ key, kind: 'image', image: { status: 'ready', source: 'existing', imageId, url: `u/${imageId}`, width: 10, height: 10 } });
const cursorAt = (key: string, pos: number, end = pos): ComposerCursor => ({ key, selectionStart: pos, selectionEnd: end });
const shape = (blocks: EditorBlock[]) => blocks.map((b) => (b.kind === 'text' ? `T:${b.text}` : `I:${b.key}`));
/** 새 사진이 업로드를 마친 상태로 바꾼다(저장 직렬화 확인용). */
const ready = (blocks: EditorBlock[]) =>
  blocks.map((b) => (b.kind === 'image' && b.image.status === 'processing' ? resolveImageBlock([b], b.key, { status: 'ready', source: 'new', previewUrl: `blob:${b.key}`, prepared: { blob: new Blob(), width: 1, height: 1, mimeType: 'image/webp', bytes: 1, sourceBytes: 1 } })[0] : b));

// ── 1–8. 작성·삽입 ────────────────────────────────────────────────────────────

test('1. 글만 입력: 타이핑은 블록 구조를 바꾸지 않고 한 입력칸의 값만 바꾼다', () => {
  let b = normalizeComposerBlocks([text('t', '')], newKey);
  b = updateTextBlock(b, 't', '오늘 광복동에 다녀왔어요.\n사람이 생각보다 많았습니다.');
  assert.deepEqual(shape(b), ['T:오늘 광복동에 다녀왔어요.\n사람이 생각보다 많았습니다.']);
  assert.deepEqual(buildBlocksPayload(b, new Map()), [{ type: 'text', text: '오늘 광복동에 다녀왔어요.\n사람이 생각보다 많았습니다.' }]);
});

test('2·6. 사진 먼저: 빈 본문에 사진 추가 → [사진, 이어 쓰기 칸], 커서는 사진 아래', () => {
  const r = insertImagesAtCursor([text('t', '')], cursorAt('t', 0), ['i1'], newKey);
  assert.deepEqual(r.blocks.map((x) => x.kind), ['image', 'text']);
  assert.equal((r.blocks[1] as { text: string }).text, '');
  assert.deepEqual(r.focus, { key: r.blocks[1].key, position: 0 });
  // 커서 정보가 없어도 사진부터 시작할 수 있다
  const noCursor = insertImagesAtCursor([text('t', '')], null, ['i1'], newKey);
  assert.deepEqual(noCursor.blocks.map((x) => x.kind), ['image', 'text']);
});

test('3. 글 중간 커서: 그 위치에서 나눠 [글, 사진, 글], 뒤 글로 커서 이동', () => {
  const t = '오늘 광복동에 갔어요.\n여기부터 사진 넣고 싶어요.\n그리고 다음 설명입니다.';
  const pos = '오늘 광복동에 갔어요.\n여기부터 사진 넣고 싶어요.'.length; // 두 번째 줄 끝
  const r = insertImagesAtCursor([text('t', t)], cursorAt('t', pos), ['i1'], newKey);
  assert.deepEqual(shape(r.blocks), ['T:오늘 광복동에 갔어요.\n여기부터 사진 넣고 싶어요.', 'I:i1', 'T:그리고 다음 설명입니다.']);
  assert.equal(r.blocks[0].key, 't', '앞 글은 원래 입력칸을 그대로 쓴다');
  assert.deepEqual(r.focus, { key: r.blocks[2].key, position: 0 });
  // 줄 가운데(단어 사이)에서도 나눈다
  const mid = insertImagesAtCursor([text('t', '광복동 애슐리')], cursorAt('t', 3), ['i1'], newKey);
  assert.deepEqual(shape(mid.blocks), ['T:광복동', 'I:i1', 'T: 애슐리']);
});

test('4. 커서가 맨 앞: 사진이 글 앞으로, 글은 사진 아래 그대로', () => {
  const r = insertImagesAtCursor([text('t', '여기는 입구입니다.')], cursorAt('t', 0), ['i1'], newKey);
  assert.deepEqual(shape(r.blocks), ['I:i1', 'T:여기는 입구입니다.']);
  // 두 번째 줄 맨 앞(앞 글이 줄바꿈으로 끝남) → 그 줄바꿈 하나만 사진이 대신한다
  const r2 = insertImagesAtCursor([text('t', '첫 줄\n둘째 줄')], cursorAt('t', '첫 줄\n'.length), ['i1'], newKey);
  assert.deepEqual(shape(r2.blocks), ['T:첫 줄', 'I:i1', 'T:둘째 줄']);
});

test('5. 커서가 맨 끝: [글, 사진, 이어 쓰기 칸]', () => {
  const r = insertImagesAtCursor([text('t', '첫 번째 문단입니다.')], cursorAt('t', '첫 번째 문단입니다.'.length), ['i1'], newKey);
  assert.deepEqual(shape(r.blocks), ['T:첫 번째 문단입니다.', 'I:i1', 'T:']);
  assert.equal(r.focus!.key, r.blocks[2].key);
});

test('6·7·8. Case A 흐름: 글→사진→글→사진→글, 사진→글, 사진→사진→글', () => {
  // 글 입력 → 끝에서 사진 → 사진 아래 입력 → 끝에서 사진 → 입력
  let b = [text('t', '첫 번째 문단입니다.')];
  let r = insertImagesAtCursor(b, cursorAt('t', 11), ['i1'], newKey);
  b = updateTextBlock(r.blocks, r.focus!.key, '두 번째 문단입니다.');
  r = insertImagesAtCursor(b, cursorAt(r.focus!.key, '두 번째 문단입니다.'.length), ['i2'], newKey);
  b = updateTextBlock(r.blocks, r.focus!.key, '마지막 문단입니다.');
  assert.deepEqual(shape(b), ['T:첫 번째 문단입니다.', 'I:i1', 'T:두 번째 문단입니다.', 'I:i2', 'T:마지막 문단입니다.']);

  // 사진 → 글
  let c = insertImagesAtCursor([text('t', '')], cursorAt('t', 0), ['i1'], newKey);
  const c2 = updateTextBlock(c.blocks, c.focus!.key, '여기는 입구입니다.');
  assert.deepEqual(shape(c2).map((s) => s[0]), ['I', 'T']);

  // 사진 → 사진 → 글 (사진 아래 커서에서 다시 사진)
  c = insertImagesAtCursor([text('t', '')], cursorAt('t', 0), ['i1'], newKey);
  const c3 = insertImagesAtCursor(c.blocks, cursorAt(c.focus!.key, 0), ['i2'], newKey);
  const c4 = updateTextBlock(c3.blocks, c3.focus!.key, '안쪽은 이런 분위기예요.');
  assert.deepEqual(shape(c4), ['I:i1', 'I:i2', 'T:안쪽은 이런 분위기예요.']);
});

test('9·10. 여러 장 선택: 커서 위치에 선택 순서대로 연속 삽입, 그 뒤 입력칸 유지', () => {
  const r = insertImagesAtCursor([text('t', '앞 글\n뒤 글')], cursorAt('t', 3), ['a', 'b', 'c'], newKey);
  assert.deepEqual(shape(r.blocks), ['T:앞 글', 'I:a', 'I:b', 'I:c', 'T:뒤 글']);
  assert.deepEqual(r.focus, { key: r.blocks[4].key, position: 0 });
});

test('11. 사진 최대 5장: 넘는 사진은 넣지 않고 알려준다', () => {
  const four = normalizeComposerBlocks([existing('e1'), existing('e2'), existing('e3'), existing('e4'), text('t', '글')], newKey);
  const r = insertImagesAtCursor(four, cursorAt('t', 1), ['n1', 'n2', 'n3'], newKey);
  assert.deepEqual([r.accepted, r.rejected], [['n1'], 2]);
  assert.equal(r.blocks.filter((b) => b.kind === 'image').length, 5);
  const full = insertImagesAtCursor(r.blocks, null, ['n9'], newKey);
  assert.equal(full.accepted.length, 0);
  assert.equal(full.blocks, r.blocks);
});

test('12. 사진 선택창에서 돌아와도 버튼 누르기 전 커서에 삽입(작성기 배선)', () => {
  const src = codeOf(read(COMPOSER));
  // 버튼 누르는 순간 커서 확정 → 선택창 → 돌아와 그 입력칸의 현재 선택 위치로 삽입
  assert.ok(/pendingCursorRef\.current = cursor;\s*fileRef\.current\?\.click\(\);/.test(src));
  assert.ok(/let cursor = pendingCursorRef\.current;/.test(src));
  assert.ok(/insertImagesAtCursor\(prev, cursor, acceptedKeys, keySource\(pool\)\)/.test(src));
  // 모바일: 버튼 탭으로 입력칸이 blur돼도 마지막 커서를 기억한다
  assert.ok(/onBlur=\{track\}/.test(src) && /onSelect=\{track\}/.test(src) && /onKeyUp=\{track\}/.test(src) && /onClick=\{track\}/.test(src));
  // 데스크톱: 버튼 mousedown이 입력칸 포커스를 뺏지 않는다
  assert.ok(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/.test(src));
});

test('13·16(선택). 텍스트를 선택한 채 사진 추가: 선택 글자는 지우지 않고 selectionEnd 뒤에 삽입', () => {
  const t = '앞부분 선택된글자 뒷부분';
  const start = '앞부분 '.length;
  const end = '앞부분 선택된글자'.length;
  const r = insertImagesAtCursor([text('t', t)], cursorAt('t', start, end), ['i1'], newKey);
  assert.deepEqual(shape(r.blocks), ['T:앞부분 선택된글자', 'I:i1', 'T: 뒷부분']);
  const all = r.blocks.filter((b) => b.kind === 'text').map((b) => (b as { text: string }).text).join('');
  assert.ok(all.includes('선택된글자'));
});

test('14·17. 줄바꿈·빈 줄·한글 보존: 경계 줄바꿈 1개만 사진이 대신하고, 삭제하면 원래 글로 돌아온다', () => {
  const original = '첫 문단\n\n둘째 문단 첫 줄\n둘째 문단 둘째 줄\n\n\n셋째';
  const pos = '첫 문단\n\n둘째 문단 첫 줄'.length;
  const r = insertImagesAtCursor([text('t', original)], cursorAt('t', pos), ['i1'], newKey);
  assert.deepEqual(shape(r.blocks), ['T:첫 문단\n\n둘째 문단 첫 줄', 'I:i1', 'T:둘째 문단 둘째 줄\n\n\n셋째']);
  const back = removeComposerImage(r.blocks, 'i1', newKey);
  assert.deepEqual(shape(back), [`T:${original}`], '사진을 지우면 줄바꿈까지 원래대로 합쳐진다');

  // 빈 줄 한가운데(앞이 줄바꿈으로 끝나고 뒤도 줄바꿈으로 시작)
  const blank = '위\n\n아래';
  const r2 = insertImagesAtCursor([text('t', blank)], cursorAt('t', 2), ['i1'], newKey);
  assert.deepEqual(shape(r2.blocks), ['T:위', 'I:i1', 'T:\n아래']);
  assert.deepEqual(shape(removeComposerImage(r2.blocks, 'i1', newKey)), [`T:${blank}`]);
});

test('15. 한글 IME 안전 계약: 조합 중에는 나누지 않고 조합이 끝난 뒤 삽입, 타이핑은 값만 갱신', () => {
  const src = codeOf(read(COMPOSER));
  assert.ok(/onCompositionStart=\{\(\) => \{\s*composingRef\.current = true;\s*\}\}/.test(src));
  assert.ok(/composingRef\.current = false;\s*const deferred = deferredInsertRef\.current;\s*deferredInsertRef\.current = null;\s*if \(deferred\) deferred\(\);/.test(src));
  assert.ok(/if \(composingRef\.current\) deferredInsertRef\.current = run;\s*else run\(\);/.test(src));
  // 입력 onChange는 updateTextBlock(값 교체)만 — 구조 변경 함수 호출 없음
  const onChange = src.slice(src.indexOf('onChange={(value) =>'), src.indexOf('onCursor={(el) =>'));
  assert.ok(/updateTextBlock\(prev, block\.key, value\)/.test(onChange));
  assert.ok(!/insertImagesAtCursor|normalizeComposerBlocks|removeComposerImage|moveComposerImage/.test(onChange));
  // 한글 자모·조합 결과 문자열이 나누기에서 깨지지 않는다(UTF-16 코드 단위 기준 위치)
  const r = insertImagesAtCursor([text('t', '한글입력테스트')], cursorAt('t', 2), ['i1'], newKey);
  assert.deepEqual(shape(r.blocks), ['T:한글', 'I:i1', 'T:입력테스트']);
});

// ── 16–19. 사진 조작 ──────────────────────────────────────────────────────────

test('16·17. 사진 삭제 → 앞뒤 글 자동 합치기(인접 글 블록이 쌓이지 않음)', () => {
  const b = [text('a', '앞 글'), existing('i1'), text('b', '뒤 글')];
  const out = removeComposerImage(b, 'i1', newKey);
  assert.deepEqual(shape(out), ['T:앞 글\n뒤 글']);
  assert.equal(out[0].key, 'a');
  // 뒤가 빈 이어 쓰기 칸이면 앞 글만 남는다
  assert.deepEqual(shape(removeComposerImage([text('a', '앞'), existing('i1'), text('b', '')], 'i1', newKey)), ['T:앞']);
  // 사진만 있던 글에서 삭제 → 빈 입력칸 하나
  assert.deepEqual(shape(removeComposerImage([existing('i1'), text('b', '')], 'i1', newKey)), ['T:']);
});

test('18·19. 사진 위/아래 이동: 기존 순서 변경 로직 재사용 + 인접 글 합치기, 끝에서는 비활성', () => {
  const b = normalizeComposerBlocks([text('a', 'A'), existing('i1'), text('b', 'B'), existing('i2'), text('c', 'C')], newKey);
  const up = moveComposerImage(b, 'i2', -1, newKey);
  assert.deepEqual(shape(up), ['T:A', 'I:i1', 'I:i2', 'T:B\nC']);
  const down = moveComposerImage(b, 'i1', 1, newKey);
  assert.deepEqual(shape(down), ['T:A\nB', 'I:i1', 'I:i2', 'T:C']);
  assert.deepEqual(composerImageMoveState([existing('i1'), text('t', '')], 'i1'), { canUp: false, canDown: false });
  assert.deepEqual(composerImageMoveState(b, 'i1'), { canUp: true, canDown: true });
  assert.equal(moveComposerImage(b, 'a', 1, newKey), b, '글 블록은 이동 대상이 아니다');
  const src = codeOf(read('src/lib/community/block-editor-state.ts'));
  assert.ok(/const moved = moveBlock\(blocks, key, direction\);/.test(src), '기존 moveBlock 재사용');
});

// ── 20–26. 저장·수정 호환 ──────────────────────────────────────────────────────

test('20. 저장 직렬화는 V2와 동일: 빈 이어 쓰기 칸은 버리고 글/사진 순서 그대로', () => {
  const r = insertImagesAtCursor([text('t', '첫 번째 문단입니다.')], cursorAt('t', 11), ['i1'], newKey);
  const blocks = ready(r.blocks);
  const payload = buildBlocksPayload(blocks, new Map([['i1', 'token-1']]));
  assert.deepEqual(payload, [
    { type: 'text', text: '첫 번째 문단입니다.' },
    { type: 'image', uploadToken: 'token-1' },
  ]);
  assert.ok(precheckBlocks(blocks).ok);
  const submit = codeOf(read('src/lib/community/submit-block-post.ts'));
  assert.ok(/const blocks = buildBlocksPayload\(input\.blocks, tokensByKey\);/.test(submit), '저장 경로 불변');
});

test('21·25. 수정 preload(V2·legacy): 저장 순서 그대로 + 작성기 모양, 스냅샷은 빈 칸 때문에 dirty가 되지 않는다', () => {
  const views = toContentBlockViews(
    { content: '기존 글', images: [{ id: 'img1', path: 'p1', width: 1, height: 1, sortOrder: 0 }, { id: 'img2', path: 'p2', width: 1, height: 1, sortOrder: 1 }], blocks: [] },
    (p) => `u/${p}`
  );
  const loaded = normalizeComposerBlocks(editorBlocksFromViews(views, newKey), newKey);
  assert.deepEqual(loaded.map((b) => b.kind), ['text', 'image', 'image', 'text']);
  assert.equal((loaded[3] as { text: string }).text, '', '마지막 사진 뒤 이어 쓰기 칸');
  assert.equal(editorSnapshot('제목', loaded), editorSnapshot('제목', editorBlocksFromViews(views, newKey)));
  assert.deepEqual(buildBlocksPayload(loaded, new Map()), [
    { type: 'text', text: '기존 글' },
    { type: 'image', existingImageId: 'img1' },
    { type: 'image', existingImageId: 'img2' },
  ]);
  const edit = codeOf(read('src/app/community/[id]/edit/page.tsx'));
  assert.ok(/normalizeComposerBlocks\(editorBlocksFromViews\(data\.blocks \?\? \[\], newBlockKey\), newBlockKey\)/.test(edit));
  assert.ok(/setInitialSnapshot\(editorSnapshot\(data\.title, initialBlocks\)\)/.test(edit));
});

test('22·23·24. 수정 저장·409·기존 사진 수명주기는 V2 경로 그대로(작성기 변경이 저장 요청을 바꾸지 않음)', () => {
  const edit = codeOf(read('src/app/community/[id]/edit/page.tsx'));
  assert.ok(/submitBlockPost\(\{ mode: 'edit', postId: post\.id, title, expectedUpdatedAt: post\.updatedAt, blocks, onStatus: setStatus \}\)/.test(edit));
  const handlers = codeOf(read('src/lib/community/post-write-handlers.ts'));
  assert.ok(/if \(expected\.getTime\(\) !== post\.updatedAt\.getTime\(\)\) return fail\(409, EDIT_ERROR_MESSAGES\.STALE\);/.test(handlers));
  assert.ok(/await deps\.persistEdit\(post\.id, expected, plan\);[\s\S]*removeWithRetry\(deps\.storage, paths\)/.test(handlers), '제거 사진 Storage 삭제는 커밋 후');
  // 작성기에서 기존 사진을 지워도 저장 전에는 서버·Storage 호출이 없다
  const src = codeOf(read(COMPOSER));
  assert.ok(!/fetch\(|\/api\//.test(src));
  const removeFn = src.slice(src.indexOf('const removeImage ='), src.indexOf('const firstTextKey'));
  assert.ok(/source === 'new'/.test(removeFn) && /URL\.revokeObjectURL/.test(removeFn), '새 사진만 로컬 미리보기 해제');
});

test('26. 블록 25개 상한은 내부에서 계속 강제(작성기 사전 차단 + 서버 동일 규칙)', () => {
  const many: EditorBlock[] = [];
  for (let i = 0; i < 12; i++) many.push(text(`t${i}`, `글 ${i}`), existing(`e${i}`));
  many.push(text('last', '끝'));
  assert.equal(many.length, 25);
  assert.equal(composerAtBlockLimit(many, 1), true);
  assert.equal(composerAtBlockLimit(many.slice(0, 20), 3), false);
  const src = codeOf(read(COMPOSER));
  assert.ok(/if \(composerAtBlockLimit\(blocks, accepted\.length \+ 2\)\) \{\s*onError\(BLOCK_LIMIT_MESSAGE\);/.test(src));
  assert.equal(MAX_CONTENT_BLOCKS, 25);
  assert.ok(BLOCK_ERROR_MESSAGES.TOO_MANY_BLOCKS.length > 0);
});

// ── 27–30. 화면 구조 ──────────────────────────────────────────────────────────

test('27·28·29. 블록 수 표시·"+ 내용 추가"·상시 ↑↓ 없음, 사진 조작은 사진을 선택했을 때만', () => {
  const src = read(COMPOSER);
  const code = codeOf(src);
  assert.ok(!/내용 추가/.test(code), '"+ 내용 추가" UI가 남아 있다');
  assert.ok(!/블록 \{|블록 \$\{|\/\{MAX_CONTENT_BLOCKS\}/.test(code), '블록 n/25 표시가 남아 있다');
  assert.ok(!/글 추가/.test(code));
  assert.ok(/\{selected && image\.status === 'ready' && \(/.test(code), '사진 조작은 선택 시에만 렌더');
  for (const label of ['이미지 위로 이동', '이미지 아래로 이동', '이미지 삭제']) assert.ok(code.includes(`aria-label="${label}"`), label);
  assert.ok(/\{blockLimitReached && \(/.test(code) && /BLOCK_LIMIT_MESSAGE = '내용을 더 추가할 수 없어요\.'/.test(code), '상한 안내는 닿았을 때만');
  for (const page of ['src/app/community/write/page.tsx', 'src/app/community/[id]/edit/page.tsx']) {
    const p = codeOf(read(page));
    assert.ok(/<SimpleInlineComposer blocks=\{blocks\} onBlocksChange=\{setBlocks\} onError=\{setError\} disabled=\{submitting\} \/>/.test(p), page);
    assert.ok(!/CommunityBlockEditor/.test(p), page);
  }
  assert.ok(!readdirSync(resolve(ROOT, 'src/components/community')).includes('CommunityBlockEditor.tsx'), '옛 블록 편집기 파일이 남아 있다');
});

test('30. 모바일 툴바: 본문 위 "사진 추가 n/5" 버튼 하나(44px, aria-label), 글 입력칸은 테두리 없이 한 본문처럼', () => {
  const code = codeOf(read(COMPOSER));
  assert.ok(/aria-label=\{`사진 추가, 현재 \$\{imageCount\}장, 최대 \$\{MAX_IMAGES_PER_POST\}장`\}/.test(code));
  assert.equal((code.match(/<button/g) || []).length, 5, '툴바 1 + 사진 선택 1 + 사진 조작 3 외 버튼이 없어야 한다');
  const css = read('src/components/community/SimpleInlineComposer.module.css');
  const rule = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
  assert.ok(/min-height: 44px/.test(rule('.photoButton')));
  assert.ok(/border: none/.test(rule('.textarea')) && /background: transparent/.test(rule('.textarea')) && /font-size: 16px/.test(rule('.textarea')));
  assert.ok(/border: 1px solid/.test(rule('.body')), '본문 전체가 하나의 입력 상자');
  assert.ok(/width: 44px/.test(rule('.control')) && /height: 44px/.test(rule('.control')));
});

// ── 31–32. 범위 ────────────────────────────────────────────────────────────────

test('31. 작성기는 화면 계층만 바꾼다: 작성기·상태 모듈은 DB·서버·API 모듈을 import하지 않는다(저장 형식은 V2 경로)', () => {
  for (const f of [COMPOSER, 'src/lib/community/block-editor-state.ts']) {
    const code = codeOf(read(f));
    assert.ok(!/@prisma\/client|@\/lib\/prisma|server-only|supabase\/server-storage|post-write-db|from '@\/app\/api/.test(code), f);
  }
  const schema = read('prisma/schema.prisma');
  assert.ok(/model PostContentBlock \{/.test(schema) && /model PostImage \{/.test(schema), 'V2 저장 모델 유지');
});

test('32. 보안 경로 불변: 영수증·소유권·같은 글 사진·5장·평문 렌더(기존 테스트 파일 존재 + 핵심 배선)', () => {
  for (const f of ['community-images.test.ts', 'community-editor-v2.test.ts', 'community-launch.test.ts', 'anonymous-browsing.test.ts']) {
    assert.ok(readdirSync(resolve(ROOT, 'src/lib/community')).includes(f), f);
  }
  const handlers = codeOf(read('src/lib/community/post-write-handlers.ts'));
  assert.ok(/!ownImageIds\.has\(b\.existingImageId\)/.test(handlers));
  assert.ok(/verifyUploadReceipts\(\{ userId, tokens \}, deps\)/.test(handlers));
  const renderer = codeOf(read('src/components/community/CommunityPostContent.tsx'));
  assert.ok(!/dangerouslySetInnerHTML/.test(renderer));
  assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(codeOf(read(COMPOSER))));
});
