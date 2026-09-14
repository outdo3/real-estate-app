/**
 * COMMUNITY_IMAGE_UPLOAD_V1 — `community-images` bucket 생성/검증 (idempotent).
 *
 * 기본은 dry-run(조회만). `--apply`일 때만 없으면 생성한다. 이미 있으면 설정이 기대값과 같은지
 * 비교만 하고 절대 수정하지 않는다(다르면 보고 후 종료 코드 1).
 * Storage policy는 만들지 않는다 — 브라우저는 Storage에 직접 쓰지 않고, 쓰기/삭제는 서버 API가
 * service role로만 한다. 공개 읽기는 public bucket의 /object/public 경로로 policy 없이 동작한다.
 * 키/토큰 값은 출력하지 않는다.
 *
 * 실행:
 *   npx tsx scripts/community/create-community-images-bucket.ts            # dry-run
 *   npx tsx scripts/community/create-community-images-bucket.ts --apply
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { COMMUNITY_IMAGE_BUCKET, COMMUNITY_IMAGE_BUCKET_FILE_SIZE_LIMIT, STORED_IMAGE_MIME_TYPES } from '../../src/lib/community/image-rules';

const APPLY = process.argv.includes('--apply');

async function main() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  // 스크립트 전용 폴백: 로컬 .env에는 아직 옛 이름(SUPABASE_KEY)만 있을 수 있다. 앱 코드는 새 이름만 읽는다.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
  if (!base || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env가 필요하다');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  const expected = {
    public: true,
    file_size_limit: COMMUNITY_IMAGE_BUCKET_FILE_SIZE_LIMIT,
    allowed_mime_types: [...STORED_IMAGE_MIME_TYPES].sort(),
  };

  const get = await fetch(`${base}/storage/v1/bucket/${COMMUNITY_IMAGE_BUCKET}`, { headers });
  if (get.status === 200) {
    const b = await get.json();
    const actual = { public: b.public, file_size_limit: b.file_size_limit, allowed_mime_types: [...(b.allowed_mime_types || [])].sort() };
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`bucket ${COMMUNITY_IMAGE_BUCKET} exists — settings ${same ? 'MATCH' : 'DIFFER'}: ${JSON.stringify(actual)}`);
    if (!same) process.exitCode = 1;
    return;
  }
  console.log(`bucket ${COMMUNITY_IMAGE_BUCKET} not found (HTTP ${get.status}) — would create ${JSON.stringify(expected)}`);
  if (!APPLY) {
    console.log('dry-run: nothing created. Re-run with --apply.');
    return;
  }
  const res = await fetch(`${base}/storage/v1/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: COMMUNITY_IMAGE_BUCKET, name: COMMUNITY_IMAGE_BUCKET, ...expected }),
  });
  console.log(`create HTTP ${res.status}`);
  if (res.status !== 200) {
    process.exitCode = 1;
    return;
  }
  const verify = await fetch(`${base}/storage/v1/bucket/${COMMUNITY_IMAGE_BUCKET}`, { headers });
  const b = await verify.json();
  console.log(`verified: public=${b.public} file_size_limit=${b.file_size_limit} allowed_mime_types=${JSON.stringify(b.allowed_mime_types)}`);
}

main().catch((e) => {
  console.error('failed:', (e as Error).message);
  process.exitCode = 1;
});
