// COMMUNITY_EDITOR_V2 — 블록 게시글 생성·수정의 Prisma 트랜잭션(서버 전용).
// 판정은 post-write-handlers.ts가 하고, 이 파일은 계획(WritePlan)을 한 트랜잭션으로 반영만 한다.
import 'server-only';
import { prisma } from '@/lib/prisma';
import { StaleEditError, type PlannedBlock, type WritePlan } from './post-write-handlers';

/** 순번 unique 충돌을 피하기 위한 임시 오프셋(사진 최대 5장이라 겹칠 수 없다). */
const SORT_ORDER_SHIFT = 1000;

function blockRows(postId: string, blocks: PlannedBlock[], imageIdByPath: Map<string, string>) {
  return blocks.map((b) =>
    b.type === 'TEXT'
      ? { postId, sortOrder: b.sortOrder, type: 'TEXT' as const, text: b.text, postImageId: null }
      : {
          postId,
          sortOrder: b.sortOrder,
          type: 'IMAGE' as const,
          text: null,
          postImageId: b.image.kind === 'existing' ? b.image.id : imageIdByPath.get(b.image.path)!,
        }
  );
}

export async function persistCreateBlockPost(input: { authorId: string; aptName: string | null }, plan: WritePlan): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const post = await tx.post.create({
      data: {
        title: plan.title,
        content: plan.content,
        aptName: input.aptName,
        authorId: input.authorId,
        ...(plan.newImages.length > 0 && {
          images: { create: plan.newImages.map(({ path, sortOrder, width, height, bytes, mimeType }) => ({ path, sortOrder, width, height, bytes, mimeType })) },
        }),
      },
      select: { id: true, images: { select: { id: true, path: true } } },
    });
    const imageIdByPath = new Map(post.images.map((img) => [img.path, img.id]));
    await tx.postContentBlock.createMany({ data: blockRows(post.id, plan.blocks, imageIdByPath) });
    return { id: post.id };
  });
}

/**
 * 수정 트랜잭션. 순서:
 *   조건부 글 갱신(updatedAt 일치, 아니면 StaleEditError) → 블록 전부 삭제 → 제거 사진 행 삭제
 *   → 유지 사진 순번 2단계 갱신 → 새 사진 행 생성 → 블록 생성.
 * 블록을 먼저 지우므로 사진 행 삭제가 복합 FK(NO ACTION)에 걸리지 않는다. 어떤 단계든 실패하면 전부 롤백된다.
 * Storage는 여기서 만지지 않는다(커밋 후 핸들러가 제거 사진만 지운다).
 */
export async function persistEditBlockPost(postId: string, expectedUpdatedAt: Date, plan: WritePlan): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.post.updateMany({ where: { id: postId, updatedAt: expectedUpdatedAt }, data: { title: plan.title, content: plan.content } });
    if (updated.count !== 1) throw new StaleEditError();

    await tx.postContentBlock.deleteMany({ where: { postId } });
    if (plan.removedImages.length > 0) {
      await tx.postImage.deleteMany({ where: { postId, id: { in: plan.removedImages.map((img) => img.id) } } });
    }
    for (const img of plan.retainedImages) {
      await tx.postImage.update({ where: { id: img.id, postId }, data: { sortOrder: img.sortOrder + SORT_ORDER_SHIFT } });
    }
    for (const img of plan.retainedImages) {
      await tx.postImage.update({ where: { id: img.id, postId }, data: { sortOrder: img.sortOrder } });
    }
    const imageIdByPath = new Map<string, string>();
    for (const img of plan.newImages) {
      const row = await tx.postImage.create({
        data: { postId, path: img.path, sortOrder: img.sortOrder, width: img.width, height: img.height, bytes: img.bytes, mimeType: img.mimeType },
        select: { id: true, path: true },
      });
      imageIdByPath.set(row.path, row.id);
    }
    await tx.postContentBlock.createMany({ data: blockRows(postId, plan.blocks, imageIdByPath) });
  });
}
