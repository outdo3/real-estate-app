// COMMUNITY_EDITOR_V2 — 글쓰기·수정 공용 저장 흐름(브라우저).
//
// 1) 서버와 같은 규칙으로 사전 검사 2) **새 사진만** 기존 업로드 API로 순차 업로드(기존 사진은 재업로드하지 않음)
// 3) 블록 요청(POST 생성 / PATCH 수정) 4) 어느 단계든 실패하면 이번 세션 업로드를 정리한다(서버도 정리함 — 중복 호출은 무해).
import { IMAGE_ERROR_MESSAGES } from './image-rules';
import { buildBlocksPayload, hasProcessingImages, precheckBlocks, type EditorBlock } from './block-editor-state';

export type SubmitResult = { ok: true; id: string } | { ok: false; error: string; status?: number };

export interface SubmitInput {
  mode: 'create' | 'edit';
  postId?: string;
  title: string;
  aptName?: string | null;
  expectedUpdatedAt?: string;
  blocks: EditorBlock[];
  onStatus: (message: string | null) => void;
  fetchImpl?: typeof fetch;
  newSessionId?: () => string;
}

export async function cleanupUploadSession(sessionId: string | null, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!sessionId) return;
  try {
    await fetchImpl(`/api/community/images?session=${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  } catch {
    // 서버가 이미 정리했거나 네트워크 오류 — 서버 orphan 로그로 추적된다.
  }
}

export async function submitBlockPost(input: SubmitInput): Promise<SubmitResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (!input.title.trim()) return { ok: false, error: '제목을 입력해주세요.' };
  if (hasProcessingImages(input.blocks)) return { ok: false, error: '사진을 준비하고 있어요. 잠시 후 다시 눌러주세요.' };
  const pre = precheckBlocks(input.blocks);
  if (!pre.ok) return { ok: false, error: pre.error };

  const newImages = input.blocks.flatMap((b) => (b.kind === 'image' && b.image.status === 'ready' && b.image.source === 'new' ? [{ key: b.key, prepared: b.image.prepared }] : []));
  const sessionId = newImages.length > 0 ? (input.newSessionId ?? (() => crypto.randomUUID()))() : null;
  const tokensByKey = new Map<string, string>();

  try {
    for (let i = 0; i < newImages.length; i++) {
      input.onStatus(`사진을 업로드하고 있어요 (${i + 1}/${newImages.length})`);
      const { prepared } = newImages[i];
      const res = await fetchImpl(`/api/community/images?session=${encodeURIComponent(sessionId!)}`, {
        method: 'POST',
        headers: { 'Content-Type': prepared.mimeType },
        body: prepared.blob,
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) {
        await cleanupUploadSession(sessionId, fetchImpl);
        return { ok: false, error: json?.error || IMAGE_ERROR_MESSAGES.UPLOAD_FAILED, status: res.status };
      }
      tokensByKey.set(newImages[i].key, json.data.token);
    }

    input.onStatus(input.mode === 'edit' ? '수정한 내용을 저장하고 있어요' : '게시글을 등록하고 있어요');
    const blocks = buildBlocksPayload(input.blocks, tokensByKey);
    const res =
      input.mode === 'edit'
        ? await fetchImpl(`/api/community/posts/${encodeURIComponent(input.postId!)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: input.title, blocks, expectedUpdatedAt: input.expectedUpdatedAt }),
          })
        : await fetchImpl('/api/community/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: input.title, blocks, aptName: input.aptName || undefined }),
          });
    const json = await res.json().catch(() => null);
    if (!json?.success) {
      await cleanupUploadSession(sessionId, fetchImpl);
      return { ok: false, error: json?.error || (input.mode === 'edit' ? '게시글을 저장하지 못했습니다.' : '게시글을 작성하지 못했습니다.'), status: res.status };
    }
    return { ok: true, id: json.data.id };
  } catch {
    await cleanupUploadSession(sessionId, fetchImpl);
    return { ok: false, error: sessionId ? IMAGE_ERROR_MESSAGES.UPLOAD_FAILED : '게시글을 저장하지 못했습니다.' };
  } finally {
    input.onStatus(null);
  }
}
