import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildBlocksPayload,
  editorBlocksFromViews,
  insertImagesAtCursor,
  normalizeComposerBlocks,
  pickComposerInsertCursor,
  removeComposerImage,
  removeComposerImageWithAnchor,
  resolveImageBlock,
  type ComposerCursor,
  type ComposerCursorMemory,
  type EditorBlock,
} from './block-editor-state';

/**
 * COMMUNITY_EDITOR_V2.1A — 사진 교체 흐름: 사진을 지운 직후 글을 누르지 않고 [사진 추가]를 눌러도 지운 자리에 들어간다.
 * 저장 형식·서버·DB·Storage는 V2/V2.1 그대로(기존 테스트가 계속 지킨다).
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const COMPOSER = 'src/components/community/SimpleInlineComposer.tsx';

let seq = 0;
const newKey = () => `k${++seq}`;
const text = (key: string, t: string): EditorBlock => ({ key, kind: 'text', text: t });
const existing = (key: string, imageId = key): EditorBlock => ({ key, kind: 'image', image: { status: 'ready', source: 'existing', imageId, url: `u/${imageId}`, width: 10, height: 10 } });
const cursorAt = (key: string, pos: number): ComposerCursor => ({ key, selectionStart: pos, selectionEnd: pos });
const shape = (blocks: EditorBlock[]) => blocks.map((b) => (b.kind === 'text' ? `T:${b.text}` : `I:${b.key}`));
const ready = (blocks: EditorBlock[]) =>
  blocks.map((b) => (b.kind === 'image' && b.image.status === 'processing' ? resolveImageBlock([b], b.key, { status: 'ready', source: 'new', previewUrl: `blob:${b.key}`, prepared: { blob: new Blob(), width: 1, height: 1, mimeType: 'image/webp', bytes: 1, sourceBytes: 1 } })[0] : b));

/** 작성기 흐름 흉내: 삭제 → 기억(anchor) → [사진 추가] 순간 기준 결정 → 삽입. */
function deleteThenAdd(blocks: EditorBlock[], imageKey: string, newKeys: string[], userCursor?: (after: EditorBlock[]) => ComposerCursor) {
  const removed = removeComposerImageWithAnchor(blocks, imageKey, newKey);
  let memory: ComposerCursorMemory = removed.anchor ? { cursor: removed.anchor, source: 'delete-anchor' } : null;
  if (userCursor) memory = { cursor: userCursor(removed.blocks), source: 'user' };
  const picked = pickComposerInsertCursor(memory, null, null);
  const inserted = insertImagesAtCursor(removed.blocks, picked.cursor, newKeys, newKey);
  return { removed, picked, inserted };
}

test('1. TEXT-IMAGE-TEXT 삭제 → 합쳐진 글의 A/B 경계 anchor', () => {
  const { blocks, anchor } = removeComposerImageWithAnchor([text('a', '앞 글 A'), existing('i1'), text('b', '뒤 글 B')], 'i1', newKey);
  assert.deepEqual(shape(blocks), ['T:앞 글 A\n뒤 글 B']);
  assert.equal(blocks[0].key, 'a');
  assert.deepEqual(anchor, cursorAt('a', '앞 글 A\n'.length), 'B가 시작하는 위치(A 길이 + 연결 줄바꿈)');
  // 합치기 결과는 기존 removeComposerImage와 같다
  assert.deepEqual(shape(blocks), shape(removeComposerImage([text('a', '앞 글 A'), existing('i1'), text('b', '뒤 글 B')], 'i1', newKey)));
});

test('2·5. 삭제 직후 바로 사진 추가 → 지운 자리(A와 B 사이)에 들어가고 앞뒤 글은 삭제 전과 같다', () => {
  const before = [text('a', 'TEXT A'), existing('old'), text('b', 'TEXT B')];
  const { picked, inserted } = deleteThenAdd(before, 'old', ['new']);
  assert.equal(picked.rereadLive, false, 'anchor는 합쳐진 입력칸의 DOM 커서로 덮어쓰지 않는다');
  assert.deepEqual(shape(inserted.blocks), ['T:TEXT A', 'I:new', 'T:TEXT B']);
  assert.equal(inserted.blocks[0].key, 'a');
});

test('3. IMAGE-TEXT 삭제 → 맨 앞(0) → 새 사진이 맨 앞', () => {
  const { removed, inserted } = deleteThenAdd([existing('old'), text('b', 'TEXT')], 'old', ['new']);
  assert.deepEqual(shape(removed.blocks), ['T:TEXT']);
  assert.deepEqual(removed.anchor, cursorAt('b', 0));
  assert.deepEqual(shape(inserted.blocks), ['I:new', 'T:TEXT']);
});

test('4. TEXT-IMAGE 삭제(뒤는 빈 이어 쓰기 칸) → 글 끝 → 새 사진이 맨 뒤', () => {
  const composer = normalizeComposerBlocks([text('a', 'TEXT'), existing('old')], newKey);
  assert.deepEqual(shape(composer), ['T:TEXT', 'I:old', 'T:']);
  const { removed, inserted } = deleteThenAdd(composer, 'old', ['new']);
  assert.deepEqual(shape(removed.blocks), ['T:TEXT']);
  assert.deepEqual(removed.anchor, cursorAt('a', 4));
  assert.deepEqual(shape(inserted.blocks), ['T:TEXT', 'I:new', 'T:']);
  // 정규화 전 모양(마지막이 사진)이어도 같은 결과
  const raw = removeComposerImageWithAnchor([text('a', 'TEXT'), existing('old')], 'old', newKey);
  assert.deepEqual(raw.anchor, cursorAt('a', 4));
});

test('5. IMAGE만 있던 글 삭제 → 빈 본문, 다음 사진은 맨 앞', () => {
  const composer = normalizeComposerBlocks([existing('old')], newKey);
  const { removed, inserted } = deleteThenAdd(composer, 'old', ['new']);
  assert.deepEqual(shape(removed.blocks), ['T:']);
  assert.equal(removed.anchor?.selectionEnd, 0);
  assert.deepEqual(shape(inserted.blocks), ['I:new', 'T:']);
});

test('6. 붙어 있는 사진: 하나를 지워도 다른 사진은 남고 지운 자리에 들어간다', () => {
  // TEXT, IMAGE1, IMAGE2, TEXT — 첫 사진 삭제
  const a = deleteThenAdd([text('t', 'TEXT'), existing('i1'), existing('i2'), text('u', 'END')], 'i1', ['new']);
  assert.deepEqual(shape(a.removed.blocks), ['T:TEXT', 'I:i2', 'T:END']);
  assert.deepEqual(a.inserted.blocks.filter((b) => b.kind === 'image').map((b) => b.key), ['new', 'i2']);
  assert.deepEqual(shape(ready(a.inserted.blocks)).filter((s) => s !== 'T:'), ['T:TEXT', 'I:new', 'I:i2', 'T:END']);
  // 사진 사이 사진 삭제(양옆에 글 없음) → 그 자리에 빈 입력칸을 두고 거기를 가리킨다
  const b = deleteThenAdd([text('t', 'TEXT'), existing('i1'), existing('i2'), existing('i3'), text('u', '')], 'i2', ['new']);
  assert.deepEqual(shape(b.removed.blocks), ['T:TEXT', 'I:i1', 'T:', 'I:i3', 'T:']);
  assert.deepEqual(b.inserted.blocks.filter((x) => x.kind === 'image').map((x) => x.key), ['i1', 'new', 'i3']);
  // 맨 앞 사진 뒤에 사진이 붙어 있음 → 맨 앞에 들어간다
  const c = deleteThenAdd([existing('i1'), existing('i2'), text('u', 'END')], 'i1', ['new']);
  assert.deepEqual(c.inserted.blocks.filter((x) => x.kind === 'image').map((x) => x.key), ['new', 'i2']);
  assert.equal(c.inserted.blocks[0].key, 'new');
  // 빈 입력칸은 저장 직렬화에서 버려진다(저장 모양은 사진 순서만)
  const payload = buildBlocksPayload(ready(b.inserted.blocks), new Map([['new', 'r']]));
  assert.deepEqual(payload.map((p) => p.type), ['text', 'image', 'image', 'image']);
});

test('7. 삭제 후 사용자가 다른 글을 누르면 그 커서가 우선한다(manual cursor > delete anchor)', () => {
  const before = [text('a', 'AAAA'), existing('i1'), text('b', 'BBBB'), existing('old'), text('c', 'CCCC')];
  const { picked, inserted } = deleteThenAdd(before, 'old', ['new'], () => cursorAt('a', 2));
  assert.equal(picked.rereadLive, true, '사용자 커서는 선택창에서 돌아온 뒤 실제 선택 위치를 다시 읽는다');
  assert.deepEqual(shape(inserted.blocks), ['T:AA', 'I:new', 'T:AA', 'I:i1', 'T:BBBB\nCCCC']);
  // 포커스가 있는 입력칸·선택한 사진은 기억한 anchor보다 우선
  const memory: ComposerCursorMemory = { cursor: cursorAt('b', 3), source: 'delete-anchor' };
  assert.deepEqual(pickComposerInsertCursor(memory, cursorAt('a', 1), null), { cursor: cursorAt('a', 1), rereadLive: true });
  assert.deepEqual(pickComposerInsertCursor(memory, cursorAt('a', 1), 'i1'), { cursor: cursorAt('i1', 0), rereadLive: false });
  assert.deepEqual(pickComposerInsertCursor(memory, null, null), { cursor: cursorAt('b', 3), rereadLive: false });
  assert.deepEqual(pickComposerInsertCursor(null, null, null), { cursor: null, rereadLive: false });
  // 작성기 배선: 글 입력칸 이벤트는 'user'로 덮고, 사진 삭제는 'delete-anchor'를 남긴다
  const src = codeOf(read(COMPOSER));
  assert.ok(/const rememberCursor = [\s\S]*?source: 'user' \};/.test(src));
  assert.ok(/cursorRef\.current = anchor \? \{ cursor: anchor, source: 'delete-anchor' \} : null;/.test(src));
  assert.ok(/const el = cursor && pending\?\.rereadLive \? textareasRef\.current\.get\(cursor\.key\) : undefined;/.test(src));
});

test('8. 삭제 자리에 여러 장: 선택 순서대로 연속, 뒤 글은 원래 위치', () => {
  const { inserted } = deleteThenAdd([text('a', '앞'), existing('old'), text('b', '뒤')], 'old', ['n1', 'n2', 'n3']);
  assert.deepEqual(shape(inserted.blocks), ['T:앞', 'I:n1', 'I:n2', 'I:n3', 'T:뒤']);
  // 5장 상한은 그대로
  const four = [text('a', '앞'), existing('x1'), existing('x2'), existing('x3'), existing('old'), existing('x4'), text('b', '뒤')];
  const r = deleteThenAdd(four, 'old', ['n1', 'n2', 'n3']);
  assert.deepEqual([r.inserted.accepted, r.inserted.rejected], [['n1'], 2]);
  assert.deepEqual(r.inserted.blocks.filter((b) => b.kind === 'image').map((b) => b.key), ['x1', 'x2', 'x3', 'n1', 'x4']);
});

test('9. 줄바꿈·공백 보존: 합치기·교체 후 앞뒤 글이 삭제 전과 글자 단위로 같다(임의 trim 없음)', () => {
  const cases: [string, string][] = [
    ['A\n', '\nB'],
    ['첫 줄\n\n둘째 줄', '\n\n셋째 줄\n'],
    ['  들여쓴 앞', '뒤 공백  '],
    ['A', '\nB'],
    ['A\n', 'B'],
  ];
  for (const [a, b] of cases) {
    const { removed, inserted } = deleteThenAdd([text('a', a), existing('old'), text('b', b)], 'old', ['new']);
    assert.deepEqual(shape(removed.blocks), [`T:${a}\n${b}`], `merge ${JSON.stringify([a, b])}`);
    assert.deepEqual(shape(inserted.blocks), [`T:${a}`, 'I:new', `T:${b}`], `replace ${JSON.stringify([a, b])}`);
  }
});

test('10. 한글 보존: 한글 글·조합 결과 문자열이 합치기·교체에서 깨지지 않는다', () => {
  const a = '오늘 광복동에 다녀왔어요.\n사람이 생각보다 많았습니다.';
  const b = '애슐리 내부는 이런 분위기였어요. ㅎㅎ';
  const { removed, inserted } = deleteThenAdd([text('a', a), existing('old'), text('b', b)], 'old', ['new']);
  assert.equal(removed.anchor?.selectionEnd, a.length + 1);
  assert.deepEqual(shape(inserted.blocks), [`T:${a}`, 'I:new', `T:${b}`]);
});

test('11·12. 글쓰기·수정 동일: 두 화면 모두 같은 작성기, 수정 화면의 기존 사진 삭제 → 바로 추가도 같은 자리', () => {
  for (const page of ['src/app/community/write/page.tsx', 'src/app/community/[id]/edit/page.tsx']) {
    assert.ok(/<SimpleInlineComposer blocks=\{blocks\} onBlocksChange=\{setBlocks\}/.test(read(page)), page);
  }
  // 수정 화면 preload(V2 저장 블록) → 기존 사진 삭제 → 바로 새 사진
  const loaded = normalizeComposerBlocks(
    editorBlocksFromViews(
      [
        { type: 'text', text: '첫 문단' },
        { type: 'image', imageId: 'img-1', url: 'u/1', width: 10, height: 10 },
        { type: 'text', text: '둘째 문단' },
        { type: 'image', imageId: 'img-2', url: 'u/2', width: 10, height: 10 },
      ],
      newKey
    ),
    newKey
  );
  const oldKey = loaded[1].key;
  const { inserted } = deleteThenAdd(loaded, oldKey, ['new']);
  const payload = buildBlocksPayload(ready(inserted.blocks), new Map([['new', 'r']]));
  assert.deepEqual(
    payload.map((p) => (p.type === 'text' ? `T:${p.text}` : 'existingImageId' in p ? `E:${p.existingImageId}` : 'N')),
    ['T:첫 문단', 'N', 'T:둘째 문단', 'E:img-2']
  );
});

test('13·14. 기존 커서 삽입·IME 계약 유지: 삽입 함수 규칙 불변, 조합 중 삽입 지연·타이핑은 값만 갱신', () => {
  assert.deepEqual(shape(insertImagesAtCursor([text('t', '한글입력테스트')], cursorAt('t', 2), ['i1'], newKey).blocks), ['T:한글', 'I:i1', 'T:입력테스트']);
  assert.deepEqual(shape(insertImagesAtCursor([text('t', '위\n\n아래')], cursorAt('t', 2), ['i1'], newKey).blocks), ['T:위', 'I:i1', 'T:\n아래']);
  const src = codeOf(read(COMPOSER));
  assert.ok(/if \(composingRef\.current\) deferredInsertRef\.current = run;\s*else run\(\);/.test(src));
  const onChange = src.slice(src.indexOf('onChange={(value) =>'), src.indexOf('onCursor={(el) =>'));
  assert.ok(/updateTextBlock\(prev, block\.key, value\)/.test(onChange));
  assert.ok(!/removeComposerImageWithAnchor|insertImagesAtCursor|normalizeComposerBlocks/.test(onChange));
  // 삭제는 DOM 포커스를 옮기지 않는다(모바일 키보드) — removeImage 안에 focus 호출 없음
  const removeImage = src.slice(src.indexOf('const removeImage ='), src.indexOf('const firstTextKey'));
  assert.ok(/removeComposerImageWithAnchor\(prev, block\.key, keySource\(pool\)\)\.blocks/.test(removeImage));
  assert.ok(!/\.focus\(|setSelectionRange/.test(removeImage));
});

test('15·16. 저장 직렬화·서버·스키마 불변: 작성기·상태 모듈은 서버/DB/API 모듈을 import하지 않는다', () => {
  const b = ready(deleteThenAdd([text('a', 'A'), existing('old', 'img-old'), text('b', 'B')], 'old', ['new']).inserted.blocks);
  assert.deepEqual(buildBlocksPayload(b, new Map([['new', 'r']])).map((p) => p.type), ['text', 'image', 'text']);
  for (const f of [COMPOSER, 'src/lib/community/block-editor-state.ts']) {
    assert.ok(!/@prisma\/client|@\/lib\/prisma|server-only|supabase\/server-storage|post-write-db|from '@\/app\/api/.test(codeOf(read(f))), f);
  }
  const schema = read('prisma/schema.prisma');
  assert.ok(/model PostContentBlock \{/.test(schema) && /model PostImage \{/.test(schema));
});
