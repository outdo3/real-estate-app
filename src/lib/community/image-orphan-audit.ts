// COMMUNITY_IMAGE_ORPHAN_CLEANUP_V1 — Storage에는 있지만 PostImage에 연결되지 않은 사진(orphan) 감사.
//
// 이 파일은 env를 읽지 않고 DB/Storage 클라이언트를 만들지 않는다. 판정은 순수 함수, I/O는 전부 주입이다.
// Source of truth: PostImage.path(DB). Storage 경로는 오직 Storage list 결과에서만 얻는다(클라이언트 입력 없음).
//
// 안전 불변식(왜 "오래됐고 미참조"면 영구 orphan인가):
//   PostImage 행이 새 경로를 얻는 유일한 길은 업로드 영수증(HMAC, UPLOAD_TOKEN_TTL_MS=6h) 검증이다
//   (V1 글 생성·V2 블록 생성·V2 수정의 새 사진). 영수증 exp는 업로드 직후 발급 시각 + 6h이므로,
//   객체 생성 후 6h가 지나면 그 경로를 새로 참조할 방법이 없다. 기본 창 24h(하한 12h)는 그 위의 여유다.
//
// PHASE 1: dry-run 감사만 실행한다. 아래 apply 함수는 PHASE 2 설계를 테스트로 고정하기 위한 것이며,
// 어떤 라우트·cron·스크립트도 실제 삭제 모드로 연결하지 않는다.
import { COMMUNITY_IMAGE_BUCKET, COMMUNITY_IMAGE_BUCKET_FILE_SIZE_LIMIT, parseImagePath } from './image-rules';
import { UPLOAD_TOKEN_TTL_MS } from './image-upload-token';
import type { FetchLike, StorageConfig } from './image-storage-core';

const HOUR_MS = 60 * 60 * 1000;

export const ORPHAN_DEFAULT_MIN_AGE_HOURS = 24;
/** 영수증 TTL(6h) + 여유 6h. 이보다 짧은 창은 거부한다. */
export const ORPHAN_MIN_AGE_HOURS_FLOOR = UPLOAD_TOKEN_TTL_MS / HOUR_MS + 6;

/** PHASE 2 삭제 한도(한 번 실행에 지우는 최대 객체 수). */
export const APPLY_MAX_DELETE_PER_RUN = 100;
/** 후보가 이만큼 발견되면 자동 삭제하지 않고 멈춘다(사람이 원인부터 확인). */
export const APPLY_STOP_OBJECT_COUNT = 500;
export const APPLY_STOP_BYTES = 500 * 1024 * 1024;
/** Storage remove 한 요청에 담는 경로 수. */
export const APPLY_REMOVE_CHUNK = 20;
export const APPLY_REMOVE_ATTEMPTS = 2;

/** 감사 스캔 폭주 방지(현재 규모 대비 충분히 큼). 넘으면 부분 결과로 판정하지 않고 실패 처리. */
export const SCAN_MAX_OBJECTS = 50_000;
const SCAN_MAX_DEPTH = 6;
const SCAN_PAGE_SIZE = 1000;

export const STORED_IMAGE_EXT_MIME: Record<'webp' | 'jpg', string> = { webp: 'image/webp', jpg: 'image/jpeg' };

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface StorageObjectEntry {
  path: string;
  createdAt: string | null;
  updatedAt: string | null;
  size: number | null;
  mimeType: string | null;
}

export type ObjectClass = 'REFERENCED' | 'RECENT_UNREFERENCED' | 'SAFE_ORPHAN_CANDIDATE' | 'REVIEW_REQUIRED';

export type ReviewReason =
  | 'WRONG_PREFIX' // posts/ 밖(legacy·수동 업로드·placeholder 등)
  | 'MALFORMED_PATH' // posts/ 아래지만 posts/{userId}/{uuid}/{uuid}.{webp|jpg}가 아님
  | 'MISSING_CREATED_AT'
  | 'INVALID_CREATED_AT'
  | 'MISSING_SIZE'
  | 'MIME_EXT_MISMATCH'
  | 'OVERSIZED'
  | 'UNKNOWN_OWNER'; // 경로의 userId가 User 테이블에 없음(QA 잔여물 등)

export interface ClassifiedObject extends StorageObjectEntry {
  class: ObjectClass;
  ageHours: number | null;
  reviewReason?: ReviewReason;
}

export interface OrphanAuditReport {
  minAgeHours: number;
  nowIso: string;
  storageObjects: number;
  storageBytes: number;
  dbRefs: number;
  counts: Record<ObjectClass, number> & { DB_MISSING_STORAGE: number; DB_INVALID_PATH: number };
  referenced: ClassifiedObject[];
  recentUnreferenced: ClassifiedObject[];
  candidates: ClassifiedObject[];
  review: ClassifiedObject[];
  /** PostImage는 있는데 Storage에 없는 경로(orphan 정리 대상 아님 — 무결성 문제). */
  dbMissingStorage: string[];
  /** 규칙에 맞지 않는 PostImage.path(무결성 확인 필요). */
  dbInvalidPaths: string[];
  candidateBytes: number;
  oldestCandidateAgeHours: number | null;
  newestCandidateAgeHours: number | null;
}

// ── 판정 ─────────────────────────────────────────────────────────────────────

export function assertMinAgeHours(minAgeHours: number): void {
  if (!Number.isFinite(minAgeHours) || minAgeHours < ORPHAN_MIN_AGE_HOURS_FLOOR) {
    throw new Error(`minAgeHours must be >= ${ORPHAN_MIN_AGE_HOURS_FLOOR} (upload receipt TTL + margin)`);
  }
}

function parseTimestamp(value: string | null): number | null | 'invalid' {
  if (value == null || value === '') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? 'invalid' : t;
}

/**
 * Storage 목록과 DB 참조를 비교해 분류한다(순수 함수).
 * 우선순위: 참조됨 → 경로 규칙 → 메타데이터 → 소유자 → 나이. 참조된 객체는 어떤 이유로도 후보가 되지 않는다.
 * age == minAgeHours 경계는 후보(>=)다.
 */
export function classifyCommunityImageObjects(input: {
  objects: StorageObjectEntry[];
  dbPaths: string[];
  knownUserIds: ReadonlySet<string>;
  nowMs: number;
  minAgeHours: number;
}): OrphanAuditReport {
  assertMinAgeHours(input.minAgeHours);
  const { objects, nowMs, minAgeHours } = input;
  const dbSet = new Set(input.dbPaths);
  const storageSet = new Set(objects.map((o) => o.path));

  const referenced: ClassifiedObject[] = [];
  const recentUnreferenced: ClassifiedObject[] = [];
  const candidates: ClassifiedObject[] = [];
  const review: ClassifiedObject[] = [];

  const toReview = (o: StorageObjectEntry, reason: ReviewReason, ageHours: number | null = null) =>
    review.push({ ...o, class: 'REVIEW_REQUIRED', ageHours, reviewReason: reason });

  for (const o of objects) {
    const created = parseTimestamp(o.createdAt);
    const ageHours = typeof created === 'number' ? (nowMs - created) / HOUR_MS : null;

    if (dbSet.has(o.path)) {
      referenced.push({ ...o, class: 'REFERENCED', ageHours });
      continue;
    }
    if (!o.path.startsWith('posts/')) {
      toReview(o, 'WRONG_PREFIX', ageHours);
      continue;
    }
    const parsed = parseImagePath(o.path);
    if (!parsed) {
      toReview(o, 'MALFORMED_PATH', ageHours);
      continue;
    }
    if (created === null) {
      toReview(o, 'MISSING_CREATED_AT');
      continue;
    }
    if (created === 'invalid') {
      toReview(o, 'INVALID_CREATED_AT');
      continue;
    }
    if (o.size == null || !Number.isFinite(o.size) || o.size < 0) {
      toReview(o, 'MISSING_SIZE', ageHours);
      continue;
    }
    if (o.mimeType !== STORED_IMAGE_EXT_MIME[parsed.ext]) {
      toReview(o, 'MIME_EXT_MISMATCH', ageHours);
      continue;
    }
    if (o.size > COMMUNITY_IMAGE_BUCKET_FILE_SIZE_LIMIT) {
      toReview(o, 'OVERSIZED', ageHours);
      continue;
    }
    if (!input.knownUserIds.has(parsed.userId)) {
      toReview(o, 'UNKNOWN_OWNER', ageHours);
      continue;
    }
    // 미래 시각(시계 차이)은 나이가 음수 → 최근으로 보호된다.
    if ((ageHours as number) >= minAgeHours) candidates.push({ ...o, class: 'SAFE_ORPHAN_CANDIDATE', ageHours });
    else recentUnreferenced.push({ ...o, class: 'RECENT_UNREFERENCED', ageHours });
  }

  const dbMissingStorage: string[] = [];
  const dbInvalidPaths: string[] = [];
  for (const p of dbSet) {
    if (!parseImagePath(p)) dbInvalidPaths.push(p);
    if (!storageSet.has(p)) dbMissingStorage.push(p);
  }

  candidates.sort((a, b) => (b.ageHours as number) - (a.ageHours as number));
  const ages = candidates.map((c) => c.ageHours as number);

  return {
    minAgeHours,
    nowIso: new Date(nowMs).toISOString(),
    storageObjects: objects.length,
    storageBytes: objects.reduce((s, o) => s + (o.size ?? 0), 0),
    dbRefs: dbSet.size,
    counts: {
      REFERENCED: referenced.length,
      RECENT_UNREFERENCED: recentUnreferenced.length,
      SAFE_ORPHAN_CANDIDATE: candidates.length,
      REVIEW_REQUIRED: review.length,
      DB_MISSING_STORAGE: dbMissingStorage.length,
      DB_INVALID_PATH: dbInvalidPaths.length,
    },
    referenced,
    recentUnreferenced,
    candidates,
    review,
    dbMissingStorage,
    dbInvalidPaths,
    candidateBytes: candidates.reduce((s, c) => s + (c.size ?? 0), 0),
    oldestCandidateAgeHours: ages.length ? Math.max(...ages) : null,
    newestCandidateAgeHours: ages.length ? Math.min(...ages) : null,
  };
}

// ── 오케스트레이션 ───────────────────────────────────────────────────────────

export interface OrphanFindDeps {
  /** bucket 전체 목록(읽기 전용). */
  listStorageObjects: () => Promise<StorageObjectEntry[]>;
  /** PostImage.path 전체(읽기 전용). Storage 목록 **이후에** 새로 조회한다. */
  listReferencedPaths: () => Promise<string[]>;
  /** 주어진 userId 중 User 테이블에 실제 있는 것. */
  existingUserIds: (ids: string[]) => Promise<Set<string>>;
  /** DB_MISSING_STORAGE 재확인(목록 페이지 누락·스캔 이후 생성 오판 방지). true = 객체 있음. */
  objectExists: (path: string) => Promise<boolean>;
  now: () => number;
}

export type OrphanFindResult =
  | { ok: true; report: OrphanAuditReport }
  | { ok: false; stage: 'STORAGE' | 'DB' | 'CONFIRM'; error: string };

/**
 * 순서: Storage list → DB 참조 fresh 조회 → 소유자 확인 → 분류 → DB_MISSING_STORAGE 개별 재확인.
 * 어느 단계든 실패하면 후보를 하나도 돌려주지 않는다(부분 목록으로 판정하지 않는다).
 */
export async function findCommunityImageOrphans(options: { minAgeHours?: number }, deps: OrphanFindDeps): Promise<OrphanFindResult> {
  const minAgeHours = options.minAgeHours ?? ORPHAN_DEFAULT_MIN_AGE_HOURS;
  assertMinAgeHours(minAgeHours);

  let objects: StorageObjectEntry[];
  try {
    objects = await deps.listStorageObjects();
  } catch (e) {
    return { ok: false, stage: 'STORAGE', error: errorLabel(e) };
  }

  let dbPaths: string[];
  let knownUserIds: Set<string>;
  try {
    dbPaths = await deps.listReferencedPaths();
    const owners = [...new Set(objects.map((o) => parseImagePath(o.path)?.userId).filter((v): v is string => !!v))];
    knownUserIds = owners.length ? await deps.existingUserIds(owners) : new Set();
  } catch (e) {
    return { ok: false, stage: 'DB', error: errorLabel(e) };
  }

  const report = classifyCommunityImageObjects({ objects, dbPaths, knownUserIds, nowMs: deps.now(), minAgeHours });

  // 스캔 뒤에 생성된 글의 사진은 목록에 없지만 실제로는 있다 → 개별 확인 후 진짜 없는 것만 남긴다.
  try {
    const confirmed: string[] = [];
    for (const p of report.dbMissingStorage) {
      if (!(await deps.objectExists(p))) confirmed.push(p);
    }
    report.dbMissingStorage = confirmed;
    report.counts.DB_MISSING_STORAGE = confirmed.length;
  } catch (e) {
    return { ok: false, stage: 'CONFIRM', error: errorLabel(e) };
  }
  return { ok: true, report };
}

function errorLabel(e: unknown): string {
  const err = e as { name?: string; status?: number; message?: string };
  // 메시지에 키·헤더가 실리지 않도록 이름과 status만 남긴다.
  return `${err?.name ?? 'Error'}${err?.status != null ? ` (HTTP ${err.status})` : ''}`;
}

// ── Storage 읽기 전용 스캔 ─────────────────────────────────────────────────────

export class OrphanScanError extends Error {
  constructor(
    readonly reason: 'HTTP' | 'SHAPE' | 'LIMIT' | 'DEPTH',
    readonly status?: number
  ) {
    super(`storage scan failed: ${reason}${status != null ? ` (HTTP ${status})` : ''}`);
    this.name = 'OrphanScanError';
  }
}

interface ListRow {
  name?: string;
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: { size?: number; mimetype?: string } | null;
}

/**
 * community-images bucket만 **목록 조회**하는 읽기 전용 프로브. 삭제/업로드 메서드가 없다.
 * bucket 이름은 상수로 고정 — 호출부가 다른 bucket을 지정할 수 없다.
 */
export function createReadOnlyImageStorageProbe(config: StorageConfig, fetchImpl: FetchLike) {
  const base = config.url.replace(/\/$/, '');
  const auth = { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` };
  const bucket = COMMUNITY_IMAGE_BUCKET;

  async function listPage(prefix: string, offset: number): Promise<ListRow[]> {
    const res = await fetchImpl(`${base}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: SCAN_PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new OrphanScanError('HTTP', res.status);
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) throw new OrphanScanError('SHAPE');
    return rows as ListRow[];
  }

  return {
    async listAllObjects(maxObjects: number = SCAN_MAX_OBJECTS): Promise<StorageObjectEntry[]> {
      const out: StorageObjectEntry[] = [];
      const queue: { prefix: string; depth: number }[] = [{ prefix: '', depth: 0 }];
      while (queue.length) {
        const { prefix, depth } = queue.shift()!;
        if (depth > SCAN_MAX_DEPTH) throw new OrphanScanError('DEPTH');
        for (let offset = 0; ; offset += SCAN_PAGE_SIZE) {
          const rows = await listPage(prefix, offset);
          for (const r of rows) {
            if (!r.name) throw new OrphanScanError('SHAPE');
            const full = prefix ? `${prefix}/${r.name}` : r.name;
            if (r.id == null) {
              queue.push({ prefix: full, depth: depth + 1 });
              continue;
            }
            out.push({
              path: full,
              createdAt: r.created_at ?? null,
              updatedAt: r.updated_at ?? null,
              size: typeof r.metadata?.size === 'number' ? r.metadata.size : null,
              mimeType: typeof r.metadata?.mimetype === 'string' ? r.metadata.mimetype : null,
            });
            if (out.length > maxObjects) throw new OrphanScanError('LIMIT');
          }
          if (rows.length < SCAN_PAGE_SIZE) break;
        }
      }
      return out;
    },

    async exists(path: string): Promise<boolean> {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const res = await fetchImpl(`${base}/storage/v1/object/info/${bucket}/${encoded}`, { method: 'GET', headers: auth });
      if (res.status === 200) return true;
      if (res.status === 404 || res.status === 400) return false;
      throw new OrphanScanError('HTTP', res.status);
    },
  };
}

// ── 표시(PII 최소화) ─────────────────────────────────────────────────────────

/** posts/u:ab12…/s:1f3e…/f:9c0d….webp — userId·UUID는 앞 4자만. 규칙 밖 경로는 첫 segment 일부와 길이만. */
export function redactImagePath(path: string): string {
  const p = parseImagePath(path);
  if (p) return `posts/u:${p.userId.slice(0, 4)}…/s:${p.uploadSession.slice(0, 4)}…/f:${p.fileUuid.slice(0, 4)}….${p.ext}`;
  const first = path.split('/')[0] ?? '';
  return `<unrecognized first=${JSON.stringify(first.slice(0, 8))} len=${path.length}>`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(3)} GB`;
}

/** Supabase 키 종류만 판별(값은 절대 반환하지 않는다). */
export function describeSupabaseKeyRole(key: string | undefined): 'service_role' | 'secret' | 'anon' | 'publishable' | 'other' | 'missing' {
  if (!key) return 'missing';
  if (key.startsWith('sb_secret_')) return 'secret';
  if (key.startsWith('sb_publishable_')) return 'publishable';
  const parts = key.split('.');
  if (parts.length !== 3) return 'other';
  try {
    const role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.role;
    return role === 'service_role' ? 'service_role' : role === 'anon' ? 'anon' : 'other';
  } catch {
    return 'other';
  }
}

// ── CLI 인자 ─────────────────────────────────────────────────────────────────

export interface OrphanCliArgs {
  mode: 'dry-run' | 'apply';
  minAgeHours: number;
  verbose: boolean;
}

/** 기본은 dry-run. `--apply`가 **명시적으로** 있어야만 apply 모드가 된다. 모르는 인자는 거부. */
export function parseOrphanCliArgs(argv: string[]): { ok: true; args: OrphanCliArgs } | { ok: false; error: string } {
  const args: OrphanCliArgs = { mode: 'dry-run', minAgeHours: ORPHAN_DEFAULT_MIN_AGE_HOURS, verbose: false };
  for (const a of argv) {
    if (a === '--apply') args.mode = 'apply';
    else if (a === '--dry-run') continue;
    else if (a === '--verbose') args.verbose = true;
    else if (a.startsWith('--min-age-hours=')) {
      const n = Number(a.slice('--min-age-hours='.length));
      if (!Number.isFinite(n) || n < ORPHAN_MIN_AGE_HOURS_FLOOR) return { ok: false, error: `--min-age-hours must be a number >= ${ORPHAN_MIN_AGE_HOURS_FLOOR}` };
      args.minAgeHours = n;
    } else return { ok: false, error: `unknown argument: ${a}` };
  }
  return { ok: true, args };
}

// ── PHASE 2 설계: 계획 + 적용(주입된 의존성으로만, 이번 PHASE에서 실행 경로 없음) ─────────────────

export type CleanupPlan =
  | { status: 'NOTHING' }
  | { status: 'STOP'; reason: 'TOO_MANY_OBJECTS' | 'TOO_MANY_BYTES'; count: number; bytes: number }
  | { status: 'READY'; batch: ClassifiedObject[]; deferred: number };

/** 대량 발견 시 멈추고, 아니면 가장 오래된 것부터 maxPerRun개만 고른다. */
export function planOrphanCleanup(
  report: Pick<OrphanAuditReport, 'candidates' | 'candidateBytes'>,
  limits: { maxPerRun?: number; stopCount?: number; stopBytes?: number } = {}
): CleanupPlan {
  const maxPerRun = limits.maxPerRun ?? APPLY_MAX_DELETE_PER_RUN;
  const stopCount = limits.stopCount ?? APPLY_STOP_OBJECT_COUNT;
  const stopBytes = limits.stopBytes ?? APPLY_STOP_BYTES;
  const count = report.candidates.length;
  if (count === 0) return { status: 'NOTHING' };
  if (count > stopCount) return { status: 'STOP', reason: 'TOO_MANY_OBJECTS', count, bytes: report.candidateBytes };
  if (report.candidateBytes > stopBytes) return { status: 'STOP', reason: 'TOO_MANY_BYTES', count, bytes: report.candidateBytes };
  const sorted = [...report.candidates].sort((a, b) => (b.ageHours as number) - (a.ageHours as number));
  const batch = sorted.slice(0, Math.max(0, maxPerRun));
  return { status: 'READY', batch, deferred: count - batch.length };
}

export interface ApplyDeps {
  /** 삭제 직전 fresh 조회: 이 경로들 중 PostImage에 참조된 것. */
  referencedPaths: (paths: string[]) => Promise<Set<string>>;
  remove: (paths: string[]) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  now: () => number;
}

export interface ApplyResult {
  mode: 'dry-run' | 'apply';
  planned: number;
  skippedReferenced: number;
  skippedIneligible: number;
  deleted: string[];
  failed: string[];
  unverified: string[];
  partial: boolean;
  aborted: null | 'DB_RECHECK_FAILED';
}

/**
 * PHASE 2 삭제 알고리즘. mode !== 'apply'면 remove를 **호출하지 않는다**.
 * 1) 배치 각 항목의 경로 규칙·나이 재검증 2) 삭제 직전 DB 참조 재조회(실패 시 전부 중단)
 * 3) 미참조만 청크 단위 remove(청크당 bounded retry) 4) exists()로 결과 검증 → deleted/failed/unverified.
 */
export async function applyOrphanCleanup(
  input: { mode: 'dry-run' | 'apply'; batch: ClassifiedObject[]; minAgeHours: number },
  deps: ApplyDeps
): Promise<ApplyResult> {
  assertMinAgeHours(input.minAgeHours);
  const result: ApplyResult = { mode: input.mode, planned: input.batch.length, skippedReferenced: 0, skippedIneligible: 0, deleted: [], failed: [], unverified: [], partial: false, aborted: null };
  if (input.batch.length > APPLY_MAX_DELETE_PER_RUN) throw new Error(`batch exceeds ${APPLY_MAX_DELETE_PER_RUN}`);

  const nowMs = deps.now();
  const eligible = input.batch.filter((c) => {
    const created = parseTimestamp(c.createdAt);
    const ok = c.class === 'SAFE_ORPHAN_CANDIDATE' && !!parseImagePath(c.path) && typeof created === 'number' && (nowMs - created) / HOUR_MS >= input.minAgeHours;
    if (!ok) result.skippedIneligible++;
    return ok;
  });

  let referenced: Set<string>;
  try {
    referenced = await deps.referencedPaths(eligible.map((c) => c.path));
  } catch {
    result.aborted = 'DB_RECHECK_FAILED';
    return result;
  }
  const targets = eligible.map((c) => c.path).filter((p) => !referenced.has(p));
  result.skippedReferenced = eligible.length - targets.length;

  if (input.mode !== 'apply') return result;

  for (let i = 0; i < targets.length; i += APPLY_REMOVE_CHUNK) {
    const chunk = targets.slice(i, i + APPLY_REMOVE_CHUNK);
    for (let attempt = 0; attempt < APPLY_REMOVE_ATTEMPTS; attempt++) {
      try {
        await deps.remove(chunk);
        break;
      } catch {
        // bounded retry — 성공 여부는 아래 exists()로 판정한다.
      }
    }
    for (const p of chunk) {
      try {
        if (await deps.exists(p)) result.failed.push(p);
        else result.deleted.push(p);
      } catch {
        result.unverified.push(p);
      }
    }
  }
  result.partial = result.deleted.length > 0 && (result.failed.length > 0 || result.unverified.length > 0);
  return result;
}
