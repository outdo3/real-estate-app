/**
 * COMMUNITY_EDITOR_V2 — post_content_blocks DB 제약 실동작 검증.
 *
 * 모든 케이스는 **트랜잭션 안에서 실행 후 반드시 롤백**한다(끝에 sentinel 오류를 던진다). 영구 쓰기 0.
 * 임시 글의 작성자로 기존 사용자 id 하나를 쓰지만 출력하지 않는다. Storage는 만지지 않는다.
 *
 * 실행: ALLOW_PROD_DB_READ=1 npx tsx scripts/community/verify-content-block-constraints.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { randomUUID } from 'crypto';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient, Prisma } from '@prisma/client';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';

const prisma = new PrismaClient();
const ROLLBACK = 'ROLLBACK_SENTINEL';

type Tx = Prisma.TransactionClient;

/** fn을 트랜잭션에서 실행하고 항상 롤백. fn이 던진 DB 오류의 SQLSTATE를 돌려준다(없으면 null). */
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<{ sqlState: string | null; message: string | null }> {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      throw new Error(ROLLBACK);
    });
  } catch (e) {
    const err = e as { message?: string; meta?: { code?: string } };
    if (err.message === ROLLBACK) return { sqlState: null, message: null };
    const m = /Code: `(\w+)`|code: "?(\w{5})"?|SqlState\(E?(\w{5})\)|(\b2[0-9]{4}\b)/.exec(err.message || '');
    return { sqlState: err.meta?.code ?? (m ? m[1] || m[2] || m[3] || m[4] : 'unknown'), message: (err.message || '').split('\n').slice(-1)[0].slice(0, 160) };
  }
  return { sqlState: null, message: null };
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'verify-content-block-constraints');
  const author = await prisma.user.findFirst({ select: { id: true } });
  if (!author) throw new Error('no user to author temporary rows');
  const before = { posts: await prisma.post.count(), images: await prisma.postImage.count(), blocks: await prisma.postContentBlock.count() };

  const id = () => `qa${randomUUID().replace(/-/g, '').slice(0, 22)}`;
  const mkPost = async (tx: Tx, pid: string) => tx.$executeRaw`INSERT INTO posts (id, title, content, author_id, updated_at) VALUES (${pid}, '[qa] constraint', '', ${author.id}, now())`;
  const mkImage = async (tx: Tx, iid: string, pid: string, sort: number) =>
    tx.$executeRaw`INSERT INTO post_images (id, post_id, path, sort_order, width, height, bytes, mime_type) VALUES (${iid}, ${pid}, ${`posts/qa/${iid}.webp`}, ${sort}, 10, 10, 10, 'image/webp')`;
  const mkBlock = async (tx: Tx, pid: string, sort: number, type: 'TEXT' | 'IMAGE', text: string | null, imageId: string | null) =>
    tx.$executeRaw`INSERT INTO post_content_blocks (id, post_id, sort_order, type, text, post_image_id) VALUES (${id()}, ${pid}, ${sort}, ${type}::"PostContentBlockType", ${text}, ${imageId})`;

  const results: [string, boolean, string][] = [];
  const expect = (name: string, pass: boolean, detail: string) => {
    results.push([name, pass, detail]);
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  };

  // 1. 정상: TEXT, IMAGE(같은 글 사진) 삽입
  let r = await inRolledBackTx(async (tx) => {
    const p1 = id(); const i1 = id();
    await mkPost(tx, p1); await mkImage(tx, i1, p1, 0);
    await mkBlock(tx, p1, 0, 'TEXT', '첫 문단', null);
    await mkBlock(tx, p1, 1, 'IMAGE', null, i1);
  });
  expect('valid TEXT + same-post IMAGE blocks insert', r.sqlState === null, JSON.stringify(r));

  // 2. 다른 글의 사진 참조 → FK 위반(23503)
  r = await inRolledBackTx(async (tx) => {
    const p1 = id(); const p2 = id(); const i2 = id();
    await mkPost(tx, p1); await mkPost(tx, p2); await mkImage(tx, i2, p2, 0);
    await mkBlock(tx, p1, 0, 'IMAGE', null, i2);
  });
  expect('IMAGE block referencing another post image rejected (23503)', r.sqlState === '23503', JSON.stringify(r));

  // 3. 같은 사진을 두 블록에서 사용 → unique 위반(23505)
  r = await inRolledBackTx(async (tx) => {
    const p1 = id(); const i1 = id();
    await mkPost(tx, p1); await mkImage(tx, i1, p1, 0);
    await mkBlock(tx, p1, 0, 'IMAGE', null, i1);
    await mkBlock(tx, p1, 1, 'IMAGE', null, i1);
  });
  expect('same image in two blocks rejected (23505)', r.sqlState === '23505', JSON.stringify(r));

  // 4. 순번 중복 → 23505
  r = await inRolledBackTx(async (tx) => {
    const p1 = id();
    await mkPost(tx, p1);
    await mkBlock(tx, p1, 0, 'TEXT', 'a', null);
    await mkBlock(tx, p1, 0, 'TEXT', 'b', null);
  });
  expect('duplicate sort_order rejected (23505)', r.sqlState === '23505', JSON.stringify(r));

  // 5. 공백만 있는 TEXT → CHECK(23514)
  r = await inRolledBackTx(async (tx) => {
    const p1 = id();
    await mkPost(tx, p1);
    await mkBlock(tx, p1, 0, 'TEXT', '  \n\t ', null);
  });
  expect('whitespace-only TEXT rejected (23514)', r.sqlState === '23514', JSON.stringify(r));

  // 6. TEXT인데 사진 id, IMAGE인데 text → CHECK
  r = await inRolledBackTx(async (tx) => {
    const p1 = id(); const i1 = id();
    await mkPost(tx, p1); await mkImage(tx, i1, p1, 0);
    await mkBlock(tx, p1, 0, 'IMAGE', 'caption', i1);
  });
  expect('IMAGE block with text rejected (23514)', r.sqlState === '23514', JSON.stringify(r));
  r = await inRolledBackTx(async (tx) => {
    const p1 = id();
    await mkPost(tx, p1);
    await mkBlock(tx, p1, 0, 'IMAGE', null, null);
  });
  expect('IMAGE block without image rejected (23514)', r.sqlState === '23514', JSON.stringify(r));

  // 7. 음수 순번 → CHECK
  r = await inRolledBackTx(async (tx) => {
    const p1 = id();
    await mkPost(tx, p1);
    await mkBlock(tx, p1, -1, 'TEXT', 'x', null);
  });
  expect('negative sort_order rejected (23514)', r.sqlState === '23514', JSON.stringify(r));

  // 8. 블록이 쓰는 사진만 따로 삭제 → NO ACTION으로 거부(23503)
  r = await inRolledBackTx(async (tx) => {
    const p1 = id(); const i1 = id();
    await mkPost(tx, p1); await mkImage(tx, i1, p1, 0);
    await mkBlock(tx, p1, 0, 'IMAGE', null, i1);
    await tx.$executeRaw`DELETE FROM post_images WHERE id = ${i1}`;
  });
  expect('deleting an image still used by a block rejected (23503)', r.sqlState === '23503', JSON.stringify(r));

  // 9. 글 삭제 → 사진·블록 cascade 성공
  let cascadeCounts = '';
  r = await inRolledBackTx(async (tx) => {
    const p1 = id(); const i1 = id(); const i2 = id();
    await mkPost(tx, p1); await mkImage(tx, i1, p1, 0); await mkImage(tx, i2, p1, 1);
    await mkBlock(tx, p1, 0, 'IMAGE', null, i1);
    await mkBlock(tx, p1, 1, 'TEXT', '가운데 글', null);
    await mkBlock(tx, p1, 2, 'IMAGE', null, i2);
    await tx.$executeRaw`DELETE FROM posts WHERE id = ${p1}`;
    const left = await tx.$queryRaw<{ imgs: bigint; blocks: bigint }[]>`SELECT (SELECT COUNT(*) FROM post_images WHERE post_id = ${p1}) imgs, (SELECT COUNT(*) FROM post_content_blocks WHERE post_id = ${p1}) blocks`;
    cascadeCounts = `images=${Number(left[0].imgs)} blocks=${Number(left[0].blocks)}`;
    if (Number(left[0].imgs) !== 0 || Number(left[0].blocks) !== 0) throw new Error('cascade left rows');
  });
  expect('post delete cascades images + blocks (NO ACTION checked at statement end)', r.sqlState === null, `${JSON.stringify(r)} ${cascadeCounts}`);

  // 10. 블록 먼저 지우고 사진 삭제 → 허용(편집 트랜잭션 순서)
  r = await inRolledBackTx(async (tx) => {
    const p1 = id(); const i1 = id();
    await mkPost(tx, p1); await mkImage(tx, i1, p1, 0);
    await mkBlock(tx, p1, 0, 'IMAGE', null, i1);
    await tx.$executeRaw`DELETE FROM post_content_blocks WHERE post_id = ${p1}`;
    await tx.$executeRaw`DELETE FROM post_images WHERE id = ${i1}`;
  });
  expect('edit order (delete blocks → delete image) allowed', r.sqlState === null, JSON.stringify(r));

  const after = { posts: await prisma.post.count(), images: await prisma.postImage.count(), blocks: await prisma.postContentBlock.count() };
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  expect('all rolled back — production counts unchanged', unchanged, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

  const failed = results.filter((x) => !x[1]).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('failed:', (e as Error).message.split('\n').slice(-1)[0]);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
