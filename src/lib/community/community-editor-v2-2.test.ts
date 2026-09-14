import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildBlocksPayload,
  composerImageMoveState,
  insertImagesAtCursor,
  moveComposerImage,
  moveComposerImageWithCursor,
  normalizeComposerBlocks,
  normalizeComposerBlocksWithCursor,
  pickComposerInsertCursor,
  removeComposerImageWithAnchor,
  type ComposerCursor,
  type EditorBlock,
} from './block-editor-state';
import { MAX_IMAGES_PER_POST } from './image-rules';

/**
 * COMMUNITY_EDITOR_V2.2 — 모바일 사진 UX.
 *  A. 편집기 사진을 누르면 브라우저 이미지 메뉴(복사·다운로드·공유)가 떠 이동 UI를 못 쓰던 문제 → 편집기 사진에서만 막고 탭/길게 누름 = 선택.
 *  B. 긴 글에서 [사진 추가]가 화면 밖으로 사라지던 문제 → 모바일에서 같은 버튼을 하단 탭바 위에 고정.
 * 저장 형식·서버·DB·Storage는 그대로(기존 테스트가 계속 지킨다).
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const COMPOSER = 'src/components/community/SimpleInlineComposer.tsx';
const COMPOSER_CSS = 'src/components/community/SimpleInlineComposer.module.css';
const src = () => codeOf(read(COMPOSER));
const css = () => read(COMPOSER_CSS).replace(/\/\*[\s\S]*?\*\//g, '');
/** 선택자의 모든 규칙 본문을 이어 붙인다(같은 선택자가 여러 번 나올 수 있음). */
const rules = (sheet: string, sel: string) => {
  const out: string[] = [];
  const re = new RegExp(`(^|[\\s,}])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'g');
  for (const m of sheet.matchAll(re)) out.push(m[3]);
  return out.join('\n');
};
const mobileBlock = () => {
  const sheet = css();
  const start = sheet.indexOf('@media (max-width: 900px)');
  assert.ok(start >= 0, '모바일 미디어 쿼리');
  let depth = 0;
  for (let i = sheet.indexOf('{', start); i < sheet.length; i++) {
    if (sheet[i] === '{') depth++;
    if (sheet[i] === '}' && --depth === 0) return sheet.slice(start, i + 1);
  }
  throw new Error('unclosed media block');
};
const figureJsx = () => {
  const s = src();
  return s.slice(s.indexOf('<figure'), s.indexOf('</figure>'));
};

let seq = 0;
const newKey = () => `k${++seq}`;
const text = (key: string, t: string): EditorBlock => ({ key, kind: 'text', text: t });
const existing = (key: string): EditorBlock => ({ key, kind: 'image', image: { status: 'ready', source: 'existing', imageId: key, url: `u/${key}`, width: 10, height: 10 } });
const cursorAt = (key: string, pos: number): ComposerCursor => ({ key, selectionStart: pos, selectionEnd: pos });
const shape = (blocks: EditorBlock[]) => blocks.map((b) => (b.kind === 'text' ? `T:${b.text}` : `I:${b.key}`));

// ── A. 편집기 사진: 브라우저 이미지 메뉴 대신 편집기 선택 ─────────────────────────

test('1. 편집기 사진 contextmenu(길게 누름)는 기본 동작을 막고 사진을 선택한다', () => {
  const fig = figureJsx();
  assert.ok(/onContextMenu=\{\(e\) => \{\s*e\.preventDefault\(\);\s*if \(image\.status === 'ready' && !disabled\) setSelectedImage\(block\.key\);\s*\}\}/.test(fig));
  // iOS callout·텍스트 선택도 편집기 사진 카드에서만 끈다
  const card = rules(css(), '.imageCard');
  assert.ok(/-webkit-touch-callout: none/.test(card) && /user-select: none/.test(card));
  // 길게 누름·탭의 대상이 <img>가 아니라 선택 버튼이 되게 한다
  assert.ok(/pointer-events: none/.test(rules(css(), '.image')));
});

test('2. 게시글 상세 사진은 그대로: 복사·다운로드·공유를 막지 않는다(편집기 전용 적용)', () => {
  const detail = read('src/components/community/CommunityPostContent.tsx');
  const detailCss = read('src/components/community/CommunityPostContent.module.css');
  assert.ok(!/onContextMenu|onDragStart|draggable=\{false\}/.test(detail));
  assert.ok(!/touch-callout|user-drag|user-select:\s*none|pointer-events:\s*none/.test(detailCss));
  // 막는 코드는 작성기 모듈에만 있다
  for (const dir of ['src/app/community', 'src/components/community']) {
    for (const f of readdirSync(resolve(ROOT, dir), { recursive: true }) as string[]) {
      if (!/\.(tsx|css)$/.test(f) || /SimpleInlineComposer/.test(f)) continue;
      assert.ok(!/touch-callout|onContextMenu/.test(read(`${dir}/${f.replace(/\\/g, '/')}`)), `${dir}/${f}`);
    }
  }
});

test('3. 편집기 사진 끌기 금지: dragstart 막음 + draggable=false + -webkit-user-drag: none', () => {
  const fig = figureJsx();
  assert.ok(/onDragStart=\{\(e\) => e\.preventDefault\(\)\}/.test(fig));
  assert.ok(/<img[\s\S]*?draggable=\{false\}/.test(fig));
  assert.ok(/-webkit-user-drag: none/.test(rules(css(), '.image')));
});

test('4·5·6. 탭 = 선택(토글), 조작 버튼은 선택된 사진에서만, 사진 밖 탭 = 선택 해제', () => {
  const s = src();
  const fig = figureJsx();
  assert.ok(/onClick=\{\(\) => setSelectedImage\(selected \? null : block\.key\)\}/.test(fig));
  assert.ok(/aria-pressed=\{selected\}/.test(fig), '선택 상태를 보조기기에 알림');
  assert.ok(/\{selected && image\.status === 'ready' && \(\s*<div className=\{styles\.imageControls\}/.test(fig));
  assert.ok(/document\.addEventListener\('pointerdown', onPointerDown\)/.test(s));
  assert.ok(/if \(!card \|\| card\.getAttribute\('data-composer-image'\) !== selectedImage\) setSelectedImage\(null\);/.test(s));
  // 스크롤과 구분: 새 터치 핸들러 없이 click 기반(스크롤 제스처는 click을 만들지 않음), 두 번 탭 확대 대기 제거
  assert.ok(!/onTouchStart|onTouchEnd|onTouchMove|touchstart/.test(s), '과도한 터치 핸들러 없음');
  assert.ok(/touch-action: manipulation/.test(rules(css(), '.imageButton')) && /touch-action: manipulation/.test(rules(css(), '.control')));
});

test('7·8. 위로/아래로 이동: 순서 변경 + 인접 글 합치기는 V2.1 그대로, 조작 버튼 44px·aria-label 유지', () => {
  const b = normalizeComposerBlocks([text('a', 'A'), existing('i1'), text('b', 'B'), existing('i2'), text('c', 'C')], newKey);
  assert.deepEqual(shape(moveComposerImageWithCursor(b, 'i2', -1, newKey, null).blocks), ['T:A', 'I:i1', 'I:i2', 'T:B\nC']);
  assert.deepEqual(shape(moveComposerImageWithCursor(b, 'i1', 1, newKey, null).blocks), ['T:A\nB', 'I:i1', 'I:i2', 'T:C']);
  assert.deepEqual(shape(moveComposerImage(b, 'i1', 1, newKey)), ['T:A\nB', 'I:i1', 'I:i2', 'T:C'], '기존 함수 결과와 같다');
  assert.deepEqual(composerImageMoveState([existing('i1'), text('t', '')], 'i1'), { canUp: false, canDown: false });
  const fig = figureJsx();
  assert.ok(/onClick=\{\(\) => moveImage\(block\.key, -1\)\}[^>]*aria-label="이미지 위로 이동"/.test(fig));
  assert.ok(/onClick=\{\(\) => moveImage\(block\.key, 1\)\}[^>]*aria-label="이미지 아래로 이동"/.test(fig));
  assert.ok(/width: 44px/.test(rules(css(), '.control')) && /height: 44px/.test(rules(css(), '.control')));
  // 옮긴 사진이 화면 밖으로 사라지지 않게 가까운 방향으로만 스크롤
  assert.ok(/revealImageRef\.current = key;/.test(src()) && /scrollIntoView\(\{ block: 'nearest' \}\)/.test(src()));
});

test('12(P2). 사진 이동 뒤 [사진 추가]: 합쳐져 사라지는 글 칸을 가리키던 커서를 합쳐진 글의 같은 위치로 옮긴다', () => {
  // A · 사진1 · B(커서 2) · 사진2 · C → 사진1 아래로: A와 B가 합쳐짐 → 커서는 "A\n" 뒤 2
  const b = [text('a', 'AAAA'), existing('i1'), text('b', 'BBBB'), existing('i2'), text('c', 'CCCC')];
  const moved = moveComposerImageWithCursor(b, 'i1', 1, newKey, cursorAt('b', 2));
  assert.deepEqual(shape(moved.blocks), ['T:AAAA\nBBBB', 'I:i1', 'I:i2', 'T:CCCC']);
  assert.deepEqual(moved.cursor, cursorAt('a', 'AAAA\n'.length + 2));
  const inserted = insertImagesAtCursor(moved.blocks, moved.cursor, ['new'], newKey);
  assert.deepEqual(shape(inserted.blocks), ['T:AAAA\nBB', 'I:new', 'T:BB', 'I:i1', 'I:i2', 'T:CCCC'], '끝이 아니라 커서가 있던 글자 위치');
  // 합쳐지지 않는 칸의 커서는 그대로
  assert.deepEqual(moveComposerImageWithCursor(b, 'i1', 1, newKey, cursorAt('c', 1)).cursor, cursorAt('c', 1));
  // 앞이 빈 칸 / 뒤가 빈 칸
  assert.deepEqual(normalizeComposerBlocksWithCursor([text('e', ''), text('x', 'XY')], newKey, cursorAt('x', 1)).cursor, cursorAt('e', 1));
  assert.deepEqual(normalizeComposerBlocksWithCursor([text('p', 'PQ'), text('x', '')], newKey, cursorAt('x', 0)).cursor, cursorAt('p', 2));
  // 삭제 anchor도 이동 뒤 유효
  const removed = removeComposerImageWithAnchor([text('a', 'A'), existing('old'), text('b', 'B'), existing('i2'), text('c', 'C')], 'old', newKey);
  const afterMove = moveComposerImageWithCursor(removed.blocks, 'i2', -1, newKey, removed.anchor);
  assert.deepEqual(shape(insertImagesAtCursor(afterMove.blocks, afterMove.cursor, ['new'], newKey).blocks), ['I:i2', 'T:A', 'I:new', 'T:B\nC'], '사진이 맨 앞으로 가도 지운 자리(A와 B 사이)는 유지');
  // 작성기 배선: 이동 시 기억한 커서를 source 그대로 옮긴다
  assert.ok(/const \{ cursor \} = moveComposerImageWithCursor\(blocks, key, direction, keySource\(pool\), memory\.cursor\);\s*cursorRef\.current = cursor \? \{ cursor, source: memory\.source \} : null;/.test(src()));
  assert.ok(/onBlocksChange\(\(prev\) => moveComposerImageWithCursor\(prev, key, direction, keySource\(pool\), null\)\.blocks\);/.test(src()));
});

// ── B. 하단 고정 [사진 추가] ─────────────────────────────────────────────────────

test('10·18. 모바일: 같은 [사진 추가]를 본문 아래·하단 탭바(60px + safe-area) 위에 sticky로 고정, 옆 빈 영역은 글 탭을 막지 않음', () => {
  const m = mobileBlock();
  const toolbar = rules(m, '.toolbar');
  assert.ok(/position: sticky/.test(toolbar));
  assert.ok(/bottom: calc\(var\(--composer-bottom-nav-height\) \+ env\(safe-area-inset-bottom, 0px\) \+ 8px\)/.test(toolbar));
  assert.ok(/order: 2/.test(toolbar) && /order: 1/.test(rules(m, '.body')), '모바일에서는 본문 아래');
  assert.ok(/pointer-events: none/.test(toolbar) && /pointer-events: auto/.test(rules(m, '.toolbar .photoButton')));
  assert.ok(/--composer-bottom-nav-height: 60px/.test(m));
  // 하단 탭바 실제 값과 일치(Header 내장 탭바·공용 BottomNav)
  const header = read('src/components/Header.module.css');
  const nav = read('src/components/ui/BottomNav.module.css');
  assert.ok(/@media \(max-width: 900px\)[\s\S]*\.menuList \{[^}]*height: calc\(60px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(header));
  assert.ok(/height: calc\(60px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(nav));
  // 탭바(z-index 1000)보다 아래 층 — 탭바를 덮지 않는다
  assert.ok(/z-index: 5/.test(toolbar));
  // 글쓰기·수정 화면은 하단 탭바를 숨기지 않는다(오프셋 전제)
  for (const page of ['src/app/community/write/page.tsx', 'src/app/community/[id]/edit/page.tsx']) {
    assert.ok(/<Header pageTitle="[^"]+" \/>/.test(read(page)) && !/hideMobileNav/.test(read(page)), page);
  }
});

test('11. 데스크톱: 하단 고정 없음, 버튼은 본문 위 그대로(미디어 쿼리 밖 .toolbar는 일반 흐름)', () => {
  const sheet = css();
  const outside = sheet.replace(mobileBlock(), '');
  assert.ok(!/position: sticky/.test(rules(outside, '.toolbar')));
  assert.ok(!/order:/.test(rules(outside, '.toolbar')));
  assert.equal((sheet.match(/@media \(max-width: 900px\)/g) || []).length, 1);
  assert.ok(/export const STICKY_TOOLBAR_QUERY = '\(max-width: 900px\)';/.test(read(COMPOSER)), 'JS 판정 폭 = CSS 폭');
  // DOM에서 툴바는 본문보다 앞(데스크톱 순서·기존 V2.1 구조)
  const s = src();
  assert.ok(s.indexOf('className={styles.toolbar}') < s.indexOf('className={styles.body}'));
});

test('7(키보드). 키보드가 뜨면 visual viewport 아래로 내려간 만큼만 버튼을 올리고, 작성기 상자 위로는 올리지 않는다', () => {
  const s = src();
  assert.ok(/const vv = typeof window !== 'undefined' \? window\.visualViewport : null;/.test(s));
  assert.ok(/const visibleBottom = vv\.offsetTop \+ vv\.height - KEYBOARD_GAP_PX;/.test(s));
  assert.ok(/const limit = Math\.min\(0, composerTop - \(rect\.top - current\)\);/.test(s));
  assert.ok(/const shift = Math\.round\(Math\.max\(limit, Math\.min\(0, visibleBottom - naturalBottom\)\)\);/.test(s));
  assert.ok(/if \(!mobile\.matches\)/.test(s), '데스크톱에서는 옮기지 않음');
  for (const ev of [/vv\.addEventListener\('resize', schedule\)/, /vv\.addEventListener\('scroll', schedule\)/, /window\.addEventListener\('scroll', schedule, \{ passive: true \}\)/]) assert.ok(ev.test(s));
  for (const ev of [/vv\.removeEventListener\('resize', schedule\)/, /vv\.removeEventListener\('scroll', schedule\)/, /window\.removeEventListener\('scroll', schedule\)/]) assert.ok(ev.test(s), '정리');
  // 레이아웃 뷰포트 높이 추정(innerHeight) 없이 실제 위치로 계산
  assert.ok(!/innerHeight/.test(s));
});

test('12·13·14·15·16. 버튼 하나·같은 삽입 핸들러: 커서 삽입·삭제 anchor·여러 장·5장 상한이 그대로', () => {
  const s = src();
  assert.equal((s.match(/onClick=\{openPicker\}/g) || []).length, 1, '[사진 추가] 버튼은 하나(모바일은 CSS로 위치만 바꿈)');
  assert.equal((s.match(/const openPicker = /g) || []).length, 1);
  assert.equal((s.match(/type="file"/g) || []).length, 1);
  assert.ok(/pendingCursorRef\.current = pickComposerInsertCursor\(cursorRef\.current, activeCursor, selectedImage\);/.test(s));
  assert.ok(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/.test(s), '버튼을 눌러도 입력칸 커서 유지');
  // 13. 커서 삽입
  assert.deepEqual(shape(insertImagesAtCursor([text('t', '앞 글\n뒤 글')], cursorAt('t', 3), ['i1'], newKey).blocks), ['T:앞 글', 'I:i1', 'T:뒤 글']);
  // 14. 삭제 anchor
  const removed = removeComposerImageWithAnchor([text('a', 'A'), existing('old'), text('b', 'B')], 'old', newKey);
  const picked = pickComposerInsertCursor({ cursor: removed.anchor!, source: 'delete-anchor' }, cursorAt('a', 0), null);
  assert.deepEqual(shape(insertImagesAtCursor(removed.blocks, picked.cursor, ['new'], newKey).blocks), ['T:A', 'I:new', 'T:B']);
  // 15. 여러 장 선택 순서
  assert.deepEqual(shape(insertImagesAtCursor([text('t', '')], null, ['a', 'b', 'c'], newKey).blocks), ['I:a', 'I:b', 'I:c', 'T:']);
  // 16. 5장 상한
  const four = normalizeComposerBlocks([existing('e1'), existing('e2'), existing('e3'), existing('e4'), text('t', '글')], newKey);
  const r = insertImagesAtCursor(four, cursorAt('t', 1), ['n1', 'n2'], newKey);
  assert.equal(MAX_IMAGES_PER_POST, 5);
  assert.deepEqual([r.accepted, r.rejected], [['n1'], 1]);
  assert.ok(/disabled=\{disabled \|\| imagesFull\}/.test(s));
});

test('13(접근성). 버튼 이름은 "사진 추가"로 시작, 조작 버튼 aria-label 유지', () => {
  const s = src();
  assert.ok(/aria-label=\{`사진 추가, 현재 \$\{imageCount\}장, 최대 \$\{MAX_IMAGES_PER_POST\}장`\}/.test(s));
  for (const label of ['이미지 위로 이동', '이미지 아래로 이동', '이미지 삭제']) assert.ok(s.includes(`aria-label="${label}"`), label);
  assert.ok(/min-height: 44px/.test(rules(css(), '.photoButton')));
});

test('17. 글쓰기·수정 동일: 두 화면 모두 같은 작성기', () => {
  for (const page of ['src/app/community/write/page.tsx', 'src/app/community/[id]/edit/page.tsx']) {
    assert.ok(/<SimpleInlineComposer blocks=\{blocks\} onBlocksChange=\{setBlocks\}/.test(read(page)), page);
  }
});

test('19·20. 스키마·API·저장 형식 불변, 기존 보안 테스트 유지', () => {
  const b = moveComposerImageWithCursor([text('a', 'A'), existing('i1'), text('b', 'B')], 'i1', 1, newKey, null).blocks;
  assert.deepEqual(buildBlocksPayload(b, new Map()), [{ type: 'text', text: 'A\nB' }, { type: 'image', existingImageId: 'i1' }]);
  for (const f of [COMPOSER, 'src/lib/community/block-editor-state.ts']) {
    assert.ok(!/@prisma\/client|@\/lib\/prisma|server-only|supabase\/server-storage|post-write-db|from '@\/app\/api/.test(codeOf(read(f))), f);
  }
  const schema = read('prisma/schema.prisma');
  assert.ok(/model PostContentBlock \{/.test(schema) && /model PostImage \{/.test(schema));
  const files = readdirSync(resolve(ROOT, 'src/lib/community'));
  for (const f of ['community-images.test.ts', 'community-editor-v2.test.ts', 'community-editor-v2-1.test.ts', 'community-editor-v2-1a.test.ts', 'community-launch.test.ts', 'anonymous-browsing.test.ts']) {
    assert.ok(files.includes(f), f);
  }
  const handlers = codeOf(read('src/lib/community/post-write-handlers.ts'));
  assert.ok(/!ownImageIds\.has\(b\.existingImageId\)/.test(handlers) && /verifyUploadReceipts\(\{ userId, tokens \}, deps\)/.test(handlers));
  assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(src()));
});
