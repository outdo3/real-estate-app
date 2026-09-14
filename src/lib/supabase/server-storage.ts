// COMMUNITY_IMAGE_UPLOAD_V1 — 서버 전용 Supabase Storage 접근.
//
// `server-only`: 이 모듈이 Client Component 그래프에 들어가면 빌드가 실패한다(키 번들 유출 방지).
// 읽는 env는 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 두 개뿐이다. NEXT_PUBLIC_ 접두사를 쓰지 않으며,
// 옛 이름(SUPABASE_KEY)으로 폴백하지 않는다. 값은 어떤 로그에도 남기지 않는다(이름만).
import 'server-only';
import { createCommunityImageStorage, type CommunityImageStorage } from '@/lib/community/image-storage-core';
import { deriveUploadTokenKey } from '@/lib/community/image-upload-token';

let cached: CommunityImageStorage | null | undefined;
let warned = false;

export function getCommunityImageStorage(): CommunityImageStorage | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    if (!warned) {
      console.error('[community-images] missing env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      warned = true;
    }
    cached = null;
    return cached;
  }
  cached = createCommunityImageStorage({ url, serviceRoleKey }, (input, init) => fetch(input, { ...init, cache: 'no-store' }));
  return cached;
}

let tokenKey: Buffer | null = null;

/** 업로드 영수증 서명키 — 기존 NEXTAUTH_SECRET에서 용도 전용으로 파생(새 secret 없음). */
export function getUploadTokenKey(): Buffer | null {
  if (tokenKey) return tokenKey;
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  tokenKey = deriveUploadTokenKey(secret);
  return tokenKey;
}
