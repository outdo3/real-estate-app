// COMMUNITY_IMAGE_UPLOAD_RATE_LIMIT_V1 — 사용자별 최근 업로드 수(서버 전용, 읽기 전용 쿼리 1건).
//
// storage.objects는 Supabase Storage가 객체마다 남기는 행이다(앱은 쓰지 않는다). 모든 인스턴스가 같은 DB를 보므로
// 인스턴스 로컬 메모리와 달리 공유 한도가 된다. 시각은 DB now() 기준(서버 시계 차이 무관).
// 경로 범위는 name COLLATE "C" 구간(posts/{userId}/ 이상, posts/{userId}0 미만 — '0'은 '/' 다음 문자)으로 잡아
// (bucket_id, name COLLATE "C") 인덱스를 쓰게 하고, LIKE 와일드카드(userId의 '_')를 피한다.
import 'server-only';
import { prisma } from '@/lib/prisma';
import { COMMUNITY_IMAGE_BUCKET, isSafeUserId } from './image-rules';
import { STORED_IMAGE_LIMITS, type StoredUploadUsage } from './image-upload-rate-limit';

export function userPathRange(userId: string): { from: string; to: string } {
  if (!isSafeUserId(userId)) throw new Error('unsafe user id');
  return { from: `posts/${userId}/`, to: `posts/${userId}0` };
}

export async function queryStoredUploadUsage(userId: string): Promise<StoredUploadUsage> {
  const { from, to } = userPathRange(userId);
  const shortSec = STORED_IMAGE_LIMITS.shortWindowMs / 1000;
  const daySec = STORED_IMAGE_LIMITS.dayWindowMs / 1000;
  const rows = await prisma.$queryRaw<{ short_count: number; day_count: number; short_expires: number | null; day_expires: number | null }[]>`
    SELECT
      count(*) FILTER (WHERE created_at > now() - make_interval(secs => ${shortSec}))::int AS short_count,
      count(*)::int AS day_count,
      extract(epoch FROM (min(created_at) FILTER (WHERE created_at > now() - make_interval(secs => ${shortSec})) + make_interval(secs => ${shortSec}) - now()))::float8 AS short_expires,
      extract(epoch FROM (min(created_at) + make_interval(secs => ${daySec}) - now()))::float8 AS day_expires
    FROM storage.objects
    WHERE bucket_id = ${COMMUNITY_IMAGE_BUCKET}
      AND name COLLATE "C" >= ${from}
      AND name COLLATE "C" < ${to}
      AND created_at > now() - make_interval(secs => ${daySec})`;
  const r = rows[0];
  return {
    shortCount: Number(r?.short_count ?? 0),
    dayCount: Number(r?.day_count ?? 0),
    shortOldestExpiresInSec: r?.short_expires == null ? null : Number(r.short_expires),
    dayOldestExpiresInSec: r?.day_expires == null ? null : Number(r.day_expires),
  };
}
