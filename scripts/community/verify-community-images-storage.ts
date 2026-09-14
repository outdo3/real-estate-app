/**
 * COMMUNITY_IMAGE_UPLOAD_V1 §26 — community-images bucket 동작 검증.
 *
 * `posts/qa-storage-verify/{uuid}/` 아래에 검증용 객체를 올리고 **끝에서 반드시 삭제**한다.
 * DB는 만지지 않는다. 키·토큰 값은 출력하지 않는다(HTTP status와 boolean만).
 *
 * 실행: npx tsx scripts/community/verify-community-images-storage.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { randomUUID } from 'crypto';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { COMMUNITY_IMAGE_BUCKET, buildImagePath, checkStoredImage } from '../../src/lib/community/image-rules';
import { createCommunityImageStorage } from '../../src/lib/community/image-storage-core';

/** 헤더가 유효한 최소 JPEG(SOF0 64×48, EXIF 없음). 렌더용이 아니라 서버 검사·Storage 동작 검증용. */
function tinyJpeg(extraBytes = 0): Uint8Array {
  const soi = [0xff, 0xd8];
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const eoi = [0xff, 0xd9];
  const out = new Uint8Array(soi.length + app0.length + sof0.length + extraBytes + eoi.length);
  out.set([...soi, ...app0, ...sof0]);
  out.set(eoi, out.length - 2);
  return out;
}

async function main() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env가 필요하다');
  const storage = createCommunityImageStorage({ url, serviceRoleKey: key }, fetch);
  const session = randomUUID();
  const userSeg = 'qa-storage-verify';
  const okPath = buildImagePath(userSeg, session, randomUUID(), 'jpg');
  const results: [string, boolean, string][] = [];
  const record = (name: string, pass: boolean, detail: string) => {
    results.push([name, pass, detail]);
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  };
  const created: string[] = [];

  try {
    const jpeg = tinyJpeg();
    const check = checkStoredImage(jpeg);
    record('server check accepts header-valid jpeg', check.ok, JSON.stringify(check));

    await storage.upload(okPath, jpeg, 'image/jpeg');
    created.push(okPath);
    record('service-role upload', true, 'ok');

    record('exists() true after upload', await storage.exists(okPath), '');
    const listed = await storage.list(`posts/${userSeg}/${session}/`);
    record('list(session prefix) returns object', listed.includes(okPath), `count=${listed.length}`);

    const pub = await fetch(storage.publicUrl(okPath));
    const cc = pub.headers.get('cache-control') || '';
    record('anonymous public read', pub.status === 200, `HTTP ${pub.status} content-type=${pub.headers.get('content-type')} cache-control=${cc}`);

    const dup = await fetch(`${url}/storage/v1/object/${COMMUNITY_IMAGE_BUCKET}/${okPath}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
      body: jpeg as unknown as BodyInit,
    });
    record('overwrite without upsert rejected', dup.status >= 400, `HTTP ${dup.status}`);

    const anonPath = buildImagePath(userSeg, session, randomUUID(), 'jpg');
    const noAuth = await fetch(`${url}/storage/v1/object/${COMMUNITY_IMAGE_BUCKET}/${anonPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: jpeg as unknown as BodyInit,
    });
    if (noAuth.ok) created.push(anonPath);
    record('unauthenticated upload denied', !noAuth.ok, `HTTP ${noAuth.status}`);

    const badKey = 'invalid-probe-key';
    const badUp = await fetch(`${url}/storage/v1/object/${COMMUNITY_IMAGE_BUCKET}/${anonPath}`, {
      method: 'POST',
      headers: { apikey: badKey, Authorization: `Bearer ${badKey}`, 'Content-Type': 'image/jpeg' },
      body: jpeg as unknown as BodyInit,
    });
    if (badUp.ok) created.push(anonPath);
    record('invalid-key upload denied', !badUp.ok, `HTTP ${badUp.status}`);

    const noAuthDel = await fetch(`${url}/storage/v1/object/${COMMUNITY_IMAGE_BUCKET}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [okPath] }),
    });
    record('unauthenticated delete denied (object still exists)', !noAuthDel.ok && (await storage.exists(okPath)), `HTTP ${noAuthDel.status}`);

    const pngPath = `posts/${userSeg}/${session}/${randomUUID()}.jpg`;
    try {
      await storage.upload(pngPath, jpeg, 'image/png');
      created.push(pngPath);
      record('bucket rejects disallowed MIME (image/png)', false, 'accepted');
    } catch (e) {
      record('bucket rejects disallowed MIME (image/png)', true, (e as Error).message);
    }

    const svgPath = `posts/${userSeg}/${session}/${randomUUID()}.jpg`;
    try {
      await storage.upload(svgPath, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml');
      created.push(svgPath);
      record('bucket rejects image/svg+xml', false, 'accepted');
    } catch (e) {
      record('bucket rejects image/svg+xml', true, (e as Error).message);
    }

    const bigPath = buildImagePath(userSeg, session, randomUUID(), 'jpg');
    try {
      await storage.upload(bigPath, tinyJpeg(2 * 1024 * 1024 + 10), 'image/jpeg');
      created.push(bigPath);
      record('bucket rejects > 2MB', false, 'accepted');
    } catch (e) {
      record('bucket rejects > 2MB', true, (e as Error).message);
    }

    await storage.remove([okPath]);
    created.splice(created.indexOf(okPath), 1);
    record('exists() false after remove', !(await storage.exists(okPath)), '');
    const after = await fetch(storage.publicUrl(okPath));
    console.log(`INFO  public URL right after delete: HTTP ${after.status} (non-200 → not served; 200 → CDN cache window)`);
  } finally {
    if (created.length) {
      await storage.remove(created).catch(() => undefined);
      console.log(`cleanup removed ${created.length} leftover object(s)`);
    }
    const leftovers = await storage.list(`posts/${userSeg}/${session}/`).catch(() => ['(list failed)']);
    console.log(`leftover objects in verification session: ${leftovers.length}`);
  }

  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('failed:', (e as Error).message);
  process.exitCode = 1;
});
