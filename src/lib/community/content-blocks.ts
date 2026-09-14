// COMMUNITY_EDITOR_V2 — 게시글 본문 블록(텍스트/사진)의 **순수 규칙** (클라이언트·서버 공용).
//
// 네트워크·DB·브라우저 API를 만지지 않는다. 한도, 요청 블록 정규화(빈 텍스트 제거 포함), 파생 평문(Post.content),
// legacy(V1: content + images) → 블록 변환, 렌더 모델 생성이 모두 여기 있다. DB 제약(migration)과 같은 규칙을
// 앱에서 먼저 적용해 사용자에게 읽을 수 있는 오류를 준다.
import { IMAGE_ERROR_MESSAGES, MAX_IMAGES_PER_POST } from './image-rules';

export const MAX_CONTENT_BLOCKS = 25;
export const MAX_TEXT_BLOCK_CHARS = 10_000;
export const MAX_TEXT_TOTAL_CHARS = 20_000;
/** 정규화 전 원시 배열 상한(빈 블록이 섞여 와도 무한히 받지 않는다). */
const MAX_RAW_BLOCKS = MAX_CONTENT_BLOCKS * 4;

export const BLOCK_ERROR_MESSAGES = {
  EMPTY: '내용을 입력하거나 사진을 추가해주세요.',
  TOO_MANY_BLOCKS: `내용 블록은 최대 ${MAX_CONTENT_BLOCKS}개까지 추가할 수 있어요.`,
  TEXT_BLOCK_TOO_LONG: '글 블록 하나에는 10,000자까지 입력할 수 있어요.',
  TEXT_TOTAL_TOO_LONG: '본문 글은 모두 합쳐 20,000자까지 입력할 수 있어요.',
  TOO_MANY_IMAGES: IMAGE_ERROR_MESSAGES.TOO_MANY,
  INVALID: '게시글 내용을 저장하지 못했습니다. 다시 시도해주세요.',
} as const;

/** 요청으로 들어오는 블록(정규화 후). 사진은 "이 글의 기존 사진" 또는 "새 업로드 영수증" 둘 중 하나다. */
export type NormalizedBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; existingImageId: string }
  | { type: 'image'; uploadToken: string };

export type BlockNormalizeResult = { ok: true; blocks: NormalizedBlock[] } | { ok: false; status: number; error: string };

const IMAGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 저장용 텍스트 정리: 줄바꿈 통일 + 앞뒤 공백 제거(가운데 줄바꿈은 그대로). */
export function cleanBlockText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/**
 * 클라이언트가 보낸 blocks를 검증·정규화한다.
 * - 빈(공백만) 텍스트 블록은 제거한다(오류 아님).
 * - 제거 후 블록 0개면 거부. 25블록, 블록당 10,000자, 합계 20,000자, 사진 5장.
 * - 같은 기존 사진·같은 영수증을 두 번 쓰면 거부.
 * 사진 참조의 **소유·존재 검증은 여기서 하지 않는다** — 서버 핸들러가 DB/서명으로 한다.
 */
export function normalizeBlocks(raw: unknown): BlockNormalizeResult {
  const invalid = { ok: false as const, status: 400, error: BLOCK_ERROR_MESSAGES.INVALID };
  if (!Array.isArray(raw) || raw.length > MAX_RAW_BLOCKS) return invalid;

  const blocks: NormalizedBlock[] = [];
  const seenExisting = new Set<string>();
  const seenTokens = new Set<string>();
  let images = 0;
  let totalText = 0;

  for (const item of raw) {
    if (!item || typeof item !== 'object') return invalid;
    const b = item as Record<string, unknown>;
    if (b.type === 'text') {
      if (typeof b.text !== 'string') return invalid;
      const text = cleanBlockText(b.text);
      if (text.length === 0) continue; // 빈 텍스트 블록은 저장하지 않는다
      if (text.length > MAX_TEXT_BLOCK_CHARS) return { ok: false, status: 400, error: BLOCK_ERROR_MESSAGES.TEXT_BLOCK_TOO_LONG };
      totalText += text.length;
      blocks.push({ type: 'text', text });
    } else if (b.type === 'image') {
      const hasExisting = typeof b.existingImageId === 'string';
      const hasToken = typeof b.uploadToken === 'string';
      if (hasExisting === hasToken) return invalid; // 둘 다 있거나 둘 다 없음
      images++;
      if (hasExisting) {
        const id = b.existingImageId as string;
        if (!IMAGE_ID_RE.test(id) || seenExisting.has(id)) return invalid;
        seenExisting.add(id);
        blocks.push({ type: 'image', existingImageId: id });
      } else {
        const token = b.uploadToken as string;
        if (token.length === 0 || token.length > 2000 || seenTokens.has(token)) return invalid;
        seenTokens.add(token);
        blocks.push({ type: 'image', uploadToken: token });
      }
    } else {
      return invalid;
    }
  }

  if (blocks.length === 0) return { ok: false, status: 400, error: BLOCK_ERROR_MESSAGES.EMPTY };
  if (blocks.length > MAX_CONTENT_BLOCKS) return { ok: false, status: 400, error: BLOCK_ERROR_MESSAGES.TOO_MANY_BLOCKS };
  if (totalText > MAX_TEXT_TOTAL_CHARS) return { ok: false, status: 400, error: BLOCK_ERROR_MESSAGES.TEXT_TOTAL_TOO_LONG };
  if (images > MAX_IMAGES_PER_POST) return { ok: false, status: 400, error: BLOCK_ERROR_MESSAGES.TOO_MANY_IMAGES };
  return { ok: true, blocks };
}

/** Post.content에 저장하는 파생 평문: 텍스트 블록을 순서대로 빈 줄로 잇는다(사진만 있으면 빈 문자열). */
export function deriveContentText(blocks: { type: string; text?: string | null }[]): string {
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string' && b.text.length > 0)
    .map((b) => b.text as string)
    .join('\n\n');
}

/** SEO description: 파생 평문에서 만들고, 사진만 있는 글은 제목으로 대체한다. */
export function buildPostDescription(content: string, title: string): string {
  const text = content.replace(/\s+/g, ' ').trim();
  return (text || title).slice(0, 120);
}

// ── 읽기 모델 ────────────────────────────────────────────────────────────────

export interface StoredImageRef {
  id: string;
  path: string;
  width: number;
  height: number;
  sortOrder: number;
}

export interface StoredBlockRef {
  type: 'TEXT' | 'IMAGE';
  text: string | null;
  postImageId: string | null;
  sortOrder: number;
}

/** 렌더·수정 화면이 공통으로 쓰는 블록. imageId는 수정 시 "기존 사진 유지"에 쓰인다. */
export type ContentBlockView =
  | { type: 'text'; text: string }
  | { type: 'image'; imageId: string; url: string | null; width: number; height: number };

/**
 * 저장된 글 → 블록 뷰. 블록이 있으면(V2) 그 순서, 없으면(V1 legacy) `[TEXT(content), 사진…(sortOrder)]`.
 * 표시 로직을 하나로 유지하기 위한 adapter다(legacy 전용 렌더러를 따로 두지 않는다).
 */
export function toContentBlockViews(
  post: { content: string; images: StoredImageRef[]; blocks: StoredBlockRef[] },
  publicUrl: (path: string) => string | null
): ContentBlockView[] {
  const byId = new Map(post.images.map((img) => [img.id, img]));
  const imageView = (img: StoredImageRef): ContentBlockView => ({ type: 'image', imageId: img.id, url: publicUrl(img.path), width: img.width, height: img.height });

  if (post.blocks.length > 0) {
    const views: ContentBlockView[] = [];
    for (const b of [...post.blocks].sort((a, z) => a.sortOrder - z.sortOrder)) {
      if (b.type === 'TEXT' && b.text) views.push({ type: 'text', text: b.text });
      else if (b.type === 'IMAGE' && b.postImageId) {
        const img = byId.get(b.postImageId);
        if (img) views.push(imageView(img));
      }
    }
    return views;
  }

  const legacy: ContentBlockView[] = [];
  if (post.content.trim().length > 0) legacy.push({ type: 'text', text: post.content });
  for (const img of [...post.images].sort((a, z) => a.sortOrder - z.sortOrder)) legacy.push(imageView(img));
  return legacy;
}
