// COMMUNITY_IMAGE_UPLOAD_V1 — Supabase Storage REST 호출(순수 어댑터, 의존성 주입).
//
// `@supabase/supabase-js`를 추가하지 않고 필요한 엔드포인트 4개만 fetch로 부른다.
// 이 파일은 env를 읽지 않는다 — 키는 서버 전용 모듈(src/lib/supabase/server-storage.ts)이 넣어준다.
// 오류에는 HTTP status만 담는다. 요청 헤더(Authorization/apikey)는 절대 메시지·로그로 흘리지 않는다.
import { COMMUNITY_IMAGE_BUCKET } from './image-rules';

export interface StorageConfig {
  url: string; // https://<ref>.supabase.co
  serviceRoleKey: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class StorageRequestError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number
  ) {
    super(`storage ${operation} failed (HTTP ${status})`);
    this.name = 'StorageRequestError';
  }
}

/** 공개 URL 캐시 시간. 삭제 후에도 CDN이 이 시간만큼 옛 객체를 줄 수 있어 영구 캐시로 두지 않는다. */
export const IMAGE_CACHE_CONTROL_SECONDS = 3600;

export interface CommunityImageStorage {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  remove(paths: string[]): Promise<void>;
  publicUrl(path: string): string;
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export function createCommunityImageStorage(config: StorageConfig, fetchImpl: FetchLike): CommunityImageStorage {
  const base = config.url.replace(/\/$/, '');
  const auth = { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` };
  const bucket = COMMUNITY_IMAGE_BUCKET;

  return {
    async upload(path, bytes, contentType) {
      const res = await fetchImpl(`${base}/storage/v1/object/${bucket}/${encodePath(path)}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': contentType, 'cache-control': `max-age=${IMAGE_CACHE_CONTROL_SECONDS}`, 'x-upsert': 'false' },
        body: bytes as unknown as BodyInit,
      });
      if (!res.ok) throw new StorageRequestError('upload', res.status);
    },

    async exists(path) {
      const res = await fetchImpl(`${base}/storage/v1/object/info/${bucket}/${encodePath(path)}`, { method: 'GET', headers: auth });
      if (res.status === 200) return true;
      if (res.status === 404 || res.status === 400) return false;
      throw new StorageRequestError('exists', res.status);
    },

    async list(prefix) {
      // prefix는 "posts/{userId}/{session}/" 형태. Storage list API는 폴더(prefix)와 이름을 나눠 받는다.
      const folder = prefix.replace(/\/$/, '');
      const res = await fetchImpl(`${base}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: folder, limit: 100, offset: 0 }),
      });
      if (!res.ok) throw new StorageRequestError('list', res.status);
      const rows = (await res.json()) as { name?: string; id?: string | null }[];
      // id가 null인 항목은 하위 폴더 표식이다.
      return rows.filter((r) => r.name && r.id).map((r) => `${folder}/${r.name}`);
    },

    async remove(paths) {
      if (paths.length === 0) return;
      const res = await fetchImpl(`${base}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!res.ok) throw new StorageRequestError('remove', res.status);
    },

    publicUrl(path) {
      return `${base}/storage/v1/object/public/${bucket}/${encodePath(path)}`;
    },
  };
}

/** 한 번 재시도 후에도 실패하면 false. 호출부가 orphan 로그를 남긴다(조용히 무시하지 않는다). */
export async function removeWithRetry(storage: CommunityImageStorage, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await storage.remove(paths);
      return true;
    } catch {
      // 다음 시도
    }
  }
  return false;
}
