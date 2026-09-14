// COMMUNITY_EDITOR_V2 — 블록 편집기 상태의 **순수 함수**(React·DOM 없음).
//
// 편집기 컴포넌트는 이 함수들로만 블록 배열을 바꾼다. 순서 변경·삭제·삽입·타이핑은 전부 로컬 상태이고 서버 요청이 없다.
// 저장 직전 검증은 서버와 같은 normalizeBlocks()를 써서 클라이언트·서버 규칙이 갈라지지 않게 한다.
import { MAX_IMAGES_PER_POST } from './image-rules';
import type { PreparedImage } from './image-compress';
import { normalizeBlocks, type BlockNormalizeResult, type ContentBlockView } from './content-blocks';

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

/** 편집 중인지(이탈 경고용) 판단하기 위한 비교 스냅샷. 미리보기 URL 같은 휘발성 값은 빼고 내용만 본다. */
export function editorSnapshot(title: string, blocks: EditorBlock[]): string {
  return JSON.stringify({
    title,
    blocks: blocks.map((b) =>
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
