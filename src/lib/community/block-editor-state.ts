// COMMUNITY_EDITOR_V2 — 블록 편집기 상태의 **순수 함수**(React·DOM 없음).
//
// 편집기 컴포넌트는 이 함수들로만 블록 배열을 바꾼다. 순서 변경·삭제·삽입·타이핑은 전부 로컬 상태이고 서버 요청이 없다.
// 저장 직전 검증은 서버와 같은 normalizeBlocks()를 써서 클라이언트·서버 규칙이 갈라지지 않게 한다.
import { MAX_IMAGES_PER_POST } from './image-rules';
import type { PreparedImage } from './image-compress';
import { MAX_CONTENT_BLOCKS, normalizeBlocks, type BlockNormalizeResult, type ContentBlockView } from './content-blocks';

export type EditorImage =
  | { status: 'processing' }
  | { status: 'ready'; source: 'existing'; imageId: string; url: string | null; width: number; height: number }
  | { status: 'ready'; source: 'new'; previewUrl: string; prepared: PreparedImage };

export type EditorBlock = { key: string; kind: 'text'; text: string } | { key: string; kind: 'image'; image: EditorImage };

export const countImages = (blocks: EditorBlock[]) => blocks.filter((b) => b.kind === 'image').length;
export const remainingImageSlots = (blocks: EditorBlock[]) => Math.max(0, MAX_IMAGES_PER_POST - countImages(blocks));
export const hasProcessingImages = (blocks: EditorBlock[]) => blocks.some((b) => b.kind === 'image' && b.image.status === 'processing');

const clampIndex = (blocks: EditorBlock[], index: number) => Math.max(0, Math.min(index, blocks.length));

export function insertTextBlock(blocks: EditorBlock[], index: number, key: string): EditorBlock[] {
  const i = clampIndex(blocks, index);
  return [...blocks.slice(0, i), { key, kind: 'text', text: '' }, ...blocks.slice(i)];
}

/** 선택한 사진 수만큼 처리 중 사진 블록을 index 위치에 **선택 순서대로** 넣는다. 남은 장수를 넘는 key는 버리고 알려준다. */
export function insertImagePlaceholders(blocks: EditorBlock[], index: number, keys: string[]): { blocks: EditorBlock[]; accepted: string[]; rejected: number } {
  const accepted = keys.slice(0, remainingImageSlots(blocks));
  const i = clampIndex(blocks, index);
  const inserted: EditorBlock[] = accepted.map((key) => ({ key, kind: 'image', image: { status: 'processing' } }));
  return { blocks: [...blocks.slice(0, i), ...inserted, ...blocks.slice(i)], accepted, rejected: keys.length - accepted.length };
}

export function resolveImageBlock(blocks: EditorBlock[], key: string, image: EditorImage): EditorBlock[] {
  return blocks.map((b) => (b.key === key && b.kind === 'image' ? { ...b, image } : b));
}

export function updateTextBlock(blocks: EditorBlock[], key: string, text: string): EditorBlock[] {
  return blocks.map((b) => (b.key === key && b.kind === 'text' ? { ...b, text } : b));
}

export function removeBlock(blocks: EditorBlock[], key: string): EditorBlock[] {
  return blocks.filter((b) => b.key !== key);
}

/** 한 칸 위(-1)/아래(+1)로. 끝에서는 그대로. 텍스트·사진 구분 없이 같은 규칙. */
export function moveBlock(blocks: EditorBlock[], key: string, direction: -1 | 1): EditorBlock[] {
  const i = blocks.findIndex((b) => b.key === key);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= blocks.length) return blocks;
  const next = [...blocks];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** 저장된 글(블록 뷰) → 편집기 블록. V1 글은 서버 adapter가 이미 `[TEXT, 사진…]`로 만들어 준다. */
export function editorBlocksFromViews(views: ContentBlockView[], newKey: () => string): EditorBlock[] {
  return views.map((v) =>
    v.type === 'text'
      ? { key: newKey(), kind: 'text' as const, text: v.text }
      : { key: newKey(), kind: 'image' as const, image: { status: 'ready' as const, source: 'existing' as const, imageId: v.imageId, url: v.url, width: v.width, height: v.height } }
  );
}

/**
 * 편집 중인지(이탈 경고용) 판단하기 위한 비교 스냅샷. 미리보기 URL 같은 휘발성 값은 빼고 내용만 본다.
 * COMMUNITY_EDITOR_V2.1 — 빈 글 영역은 비교에서 뺀다: 작성기가 사진 뒤에 자동으로 두는 빈 입력칸은 저장되지 않으므로
 * 그것만으로 "수정됨"이 되면 안 된다.
 */
export function editorSnapshot(title: string, blocks: EditorBlock[]): string {
  return JSON.stringify({
    title,
    blocks: blocks
      .filter((b) => b.kind !== 'text' || b.text.trim().length > 0)
      .map((b) =>
        b.kind === 'text' ? ['t', b.text] : b.image.status === 'ready' && b.image.source === 'existing' ? ['e', b.image.imageId] : ['n', b.key]
      ),
  });
}

export type BlockPayload = { type: 'text'; text: string } | { type: 'image'; existingImageId: string } | { type: 'image'; uploadToken: string };

/** 저장 요청 blocks. 새 사진은 업로드가 끝난 뒤 받은 영수증(tokensByKey)으로 채운다. 빈 텍스트는 서버·클라 모두 제거한다. */
export function buildBlocksPayload(blocks: EditorBlock[], tokensByKey: Map<string, string>): BlockPayload[] {
  const payload: BlockPayload[] = [];
  for (const b of blocks) {
    if (b.kind === 'text') {
      if (b.text.trim().length > 0) payload.push({ type: 'text', text: b.text });
    } else if (b.image.status === 'ready' && b.image.source === 'existing') {
      payload.push({ type: 'image', existingImageId: b.image.imageId });
    } else if (b.image.status === 'ready' && b.image.source === 'new') {
      const token = tokensByKey.get(b.key);
      if (token) payload.push({ type: 'image', uploadToken: token });
    }
  }
  return payload;
}

/** 업로드 전에 서버와 같은 규칙으로 미리 검사(새 사진 자리는 key를 임시 토큰으로 사용). */
export function precheckBlocks(blocks: EditorBlock[]): BlockNormalizeResult {
  const provisional = new Map(blocks.filter((b) => b.kind === 'image').map((b) => [b.key, `pending-${b.key}`]));
  return normalizeBlocks(buildBlocksPayload(blocks, provisional));
}

// ══════════════════════════════════════════════════════════════════════════
// COMMUNITY_EDITOR_V2.1 — 단순 인라인 작성기(커서 위치 사진 삽입)용 순수 함수.
//
// 사용자에게는 "한 개의 긴 글 + 중간 사진"으로 보이고, 내부 상태는 기존 EditorBlock 배열(=저장 형식) 그대로다.
// 작성기 모양 불변식(normalizeComposerBlocks):
//   1) 인접한 글 블록은 하나로 합친다(가운데 사진이 사라지면 원래 한 문단처럼 다시 붙는다).
//   2) 마지막이 사진이면(또는 아무것도 없으면) 이어서 쓸 빈 글 입력칸을 하나 둔다.
// 빈 글 블록은 저장 시 buildBlocksPayload/서버가 버리므로 불변식이 저장 결과를 바꾸지 않는다.
// ══════════════════════════════════════════════════════════════════════════

/** 사진 추가 버튼을 누르기 직전의 커서. selectionStart/End는 textarea 기준 문자 위치. */
export interface ComposerCursor {
  key: string;
  selectionStart: number;
  selectionEnd: number;
}

/** 합칠 때 두 글 사이에 넣는 구분자. 삽입 때 제거한 경계 줄바꿈 1개와 짝을 이룬다. */
const TEXT_JOIN = '\n';

export function normalizeComposerBlocks(blocks: EditorBlock[], newKey: () => string): EditorBlock[] {
  const merged: EditorBlock[] = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    if (b.kind === 'text' && prev && prev.kind === 'text') {
      const text = prev.text.length === 0 ? b.text : b.text.length === 0 ? prev.text : `${prev.text}${TEXT_JOIN}${b.text}`;
      merged[merged.length - 1] = { ...prev, text };
    } else {
      merged.push(b);
    }
  }
  const last = merged[merged.length - 1];
  if (!last || last.kind === 'image') merged.push({ key: newKey(), kind: 'text', text: '' });
  return merged;
}

export interface CursorInsertResult {
  blocks: EditorBlock[];
  accepted: string[];
  rejected: number;
  /** 삽입 후 이어서 쓸 위치(사진 바로 아래 글 입력칸의 맨 앞). */
  focus: { key: string; position: number } | null;
}

/**
 * 커서 위치에 사진(처리 중 자리표시자) 여러 장을 선택 순서대로 넣는다.
 *
 * 규칙
 *  - 삽입 기준은 **selectionEnd**다. 선택한 글자는 지우지 않는다(선택 영역 뒤에 사진이 들어간다).
 *  - 커서가 글 블록 안이면 그 위치에서 글을 둘로 나눈다. 나누는 자리의 줄바꿈 **1개만** 사진이 대신한다
 *    (줄 끝이면 뒤쪽 첫 줄바꿈, 줄 맨 앞이면 앞쪽 끝 줄바꿈). 그 외 줄바꿈·빈 줄·공백은 그대로 둔다.
 *  - 앞 글이 비면(공백만 포함) 그 글 블록은 없애 사진이 먼저 온다. 뒤 글이 비면 사진 아래에 빈 입력칸을 둔다.
 *  - 커서 정보가 없거나 가리키는 블록이 없으면 본문 끝에 넣는다.
 *  - 남은 사진 장수를 넘는 key는 넣지 않고 rejected로 알려준다.
 */
export function insertImagesAtCursor(blocks: EditorBlock[], cursor: ComposerCursor | null, keys: string[], newKey: () => string): CursorInsertResult {
  const accepted = keys.slice(0, remainingImageSlots(blocks));
  const rejected = keys.length - accepted.length;
  if (accepted.length === 0) return { blocks, accepted, rejected, focus: null };
  const images: EditorBlock[] = accepted.map((key) => ({ key, kind: 'image', image: { status: 'processing' } }));

  const index = cursor ? blocks.findIndex((b) => b.key === cursor.key) : -1;
  const target = index >= 0 ? blocks[index] : null;

  let next: EditorBlock[];
  let afterKey: string;

  if (target && target.kind === 'text') {
    const pos = Math.max(0, Math.min(cursor!.selectionEnd, target.text.length));
    let before = target.text.slice(0, pos);
    let after = target.text.slice(pos);
    if (before.endsWith('\n')) before = before.slice(0, -1);
    else if (after.startsWith('\n')) after = after.slice(1);

    const head: EditorBlock[] = before.trim().length > 0 ? [{ ...target, text: before }] : [];
    afterKey = newKey();
    const tail: EditorBlock[] = [{ key: afterKey, kind: 'text', text: after.trim().length > 0 ? after : '' }];
    next = [...blocks.slice(0, index), ...head, ...images, ...tail, ...blocks.slice(index + 1)];
  } else if (target && target.kind === 'image') {
    // 선택된 사진이 기준이면 그 사진 바로 뒤에 넣는다.
    afterKey = newKey();
    next = [...blocks.slice(0, index + 1), ...images, { key: afterKey, kind: 'text', text: '' }, ...blocks.slice(index + 1)];
  } else {
    afterKey = newKey();
    const trimmedEnd = blocks.length > 0 && blocks[blocks.length - 1].kind === 'text' && (blocks[blocks.length - 1] as { text: string }).text.trim() === '' ? blocks.slice(0, -1) : blocks;
    next = [...trimmedEnd, ...images, { key: afterKey, kind: 'text', text: '' }];
  }

  const normalized = normalizeComposerBlocks(next, newKey);
  // 합치기로 afterKey 블록이 앞 글에 흡수됐으면 그 글의 이어 쓰기 위치를 찾는다.
  const lastImageIndex = normalized.findIndex((b) => b.key === accepted[accepted.length - 1]);
  const focusBlock = normalized[lastImageIndex + 1];
  return { blocks: normalized, accepted, rejected, focus: focusBlock && focusBlock.kind === 'text' ? { key: focusBlock.key, position: 0 } : null };
}

/** 작성기에서 사진 삭제: 블록 제거 후 앞뒤 글을 다시 한 문단으로 합친다. */
export function removeComposerImage(blocks: EditorBlock[], key: string, newKey: () => string): EditorBlock[] {
  return normalizeComposerBlocks(removeBlock(blocks, key), newKey);
}

/**
 * COMMUNITY_EDITOR_V2.1A — 사진 삭제 + 삭제 자리를 다음 삽입 위치(anchor)로 돌려준다("사진 교체" 흐름).
 *
 * 삭제로 뒤 글이 앞 글에 합쳐지면 뒤 글 입력칸(key)이 사라져, 그 칸을 가리키던 커서로는 삽입 위치를 찾을 수 없다.
 * 그래서 삭제 결과 블록에서 **삭제 자리**를 직접 계산해 준다. anchor에 바로 insertImagesAtCursor를 적용하면
 * 사진이 지웠던 자리로 들어가고 앞뒤 글은 삭제 전과 같게 나뉜다.
 *
 *  - 앞 글 + 뒤 글이 합쳐짐: 합쳐진 글에서 **뒤 글이 시작하는 위치**(앞 글 길이 + 연결 줄바꿈 1). 삽입 규칙이 경계 줄바꿈 1개를
 *    사진으로 대신하므로, 앞·뒤 글의 줄바꿈·공백이 그대로 원래 두 글로 돌아간다.
 *  - 한쪽이 빈 칸이라 그대로 합쳐짐: 앞 글 끝(뒤가 빈 칸) / 0(앞이 빈 칸).
 *  - 앞이 글, 뒤가 사진: 앞 글 끝.
 *  - 앞이 사진·없음, 뒤가 글: 뒤 글 맨 앞(0).
 *  - 양옆에 글이 없음(사진 사이·맨 앞 사진 앞): 그 자리에 빈 입력칸을 두고 거기를 가리킨다.
 */
export function removeComposerImageWithAnchor(blocks: EditorBlock[], key: string, newKey: () => string): { blocks: EditorBlock[]; anchor: ComposerCursor | null } {
  const index = blocks.findIndex((b) => b.key === key);
  if (index < 0 || blocks[index].kind !== 'image') return { blocks, anchor: null };
  const prev = index > 0 ? blocks[index - 1] : null;
  const next = index + 1 < blocks.length ? blocks[index + 1] : null;
  const at = (k: string, position: number): ComposerCursor => ({ key: k, selectionStart: position, selectionEnd: position });

  if (prev?.kind === 'text') {
    let position = prev.text.length;
    if (next?.kind === 'text' && prev.text.length === 0) position = 0;
    else if (next?.kind === 'text' && next.text.length > 0) position = prev.text.length + TEXT_JOIN.length;
    return { blocks: normalizeComposerBlocks(removeBlock(blocks, key), newKey), anchor: at(prev.key, position) };
  }
  if (next?.kind === 'text') {
    return { blocks: normalizeComposerBlocks(removeBlock(blocks, key), newKey), anchor: at(next.key, 0) };
  }
  const placeholderKey = newKey();
  const withPlaceholder: EditorBlock[] = [...blocks.slice(0, index), { key: placeholderKey, kind: 'text', text: '' }, ...blocks.slice(index + 1)];
  return { blocks: normalizeComposerBlocks(withPlaceholder, newKey), anchor: at(placeholderKey, 0) };
}

/** 작성기가 기억하는 마지막 삽입 위치. 사용자가 직접 둔 커서인지, 사진 삭제가 남긴 anchor인지 구분한다. */
export type ComposerCursorMemory = { cursor: ComposerCursor; source: 'user' | 'delete-anchor' } | null;

/**
 * [사진 추가]를 누른 순간 삽입 기준 결정. 우선순위: 선택한 사진 > 포커스가 있는 입력칸의 실제 커서 > 기억한 위치.
 * 사용자가 삭제 뒤 글을 누르면 기억한 위치 자체가 'user'로 바뀌므로 manual cursor > delete anchor가 된다.
 * rereadLive: 선택창에서 돌아왔을 때 입력칸의 현재 선택 위치를 다시 읽을지. anchor는 읽지 않는다 —
 * 합쳐진 입력칸의 DOM 커서는 값이 바뀌며 글 끝으로 가 있어 삭제 자리를 덮어쓰기 때문이다.
 */
export function pickComposerInsertCursor(
  memory: ComposerCursorMemory,
  activeCursor: ComposerCursor | null,
  selectedImageKey: string | null
): { cursor: ComposerCursor | null; rereadLive: boolean } {
  if (selectedImageKey) return { cursor: { key: selectedImageKey, selectionStart: 0, selectionEnd: 0 }, rereadLive: false };
  if (activeCursor) return { cursor: activeCursor, rereadLive: true };
  if (!memory) return { cursor: null, rereadLive: false };
  return { cursor: memory.cursor, rereadLive: memory.source === 'user' };
}

/** 작성기에서 사진 이동: 앞/뒤 블록과 자리를 바꾸고 인접 글을 합친다(글 블록 단위로 한 칸). */
export function moveComposerImage(blocks: EditorBlock[], key: string, direction: -1 | 1, newKey: () => string): EditorBlock[] {
  const target = blocks.find((b) => b.key === key);
  if (!target || target.kind !== 'image') return blocks;
  const moved = moveBlock(blocks, key, direction);
  return moved === blocks ? blocks : normalizeComposerBlocks(moved, newKey);
}

/** 사진을 위/아래로 옮길 수 있는가(첫/마지막 위치 판단). 이어 쓰기용 빈 입력칸은 경계로 치지 않는다. */
export function composerImageMoveState(blocks: EditorBlock[], key: string): { canUp: boolean; canDown: boolean } {
  const i = blocks.findIndex((b) => b.key === key);
  if (i < 0) return { canUp: false, canDown: false };
  const contentAfter = blocks.slice(i + 1).some((b) => b.kind === 'image' || b.text.trim().length > 0);
  return { canUp: i > 0, canDown: contentAfter };
}

/** 저장 형식 검사와 별개로, 작성 중 블록 수가 상한에 닿았는가(화면에는 이때만 안내한다). */
export const composerAtBlockLimit = (blocks: EditorBlock[], adding = 0) => blocks.length + adding > MAX_CONTENT_BLOCKS;
