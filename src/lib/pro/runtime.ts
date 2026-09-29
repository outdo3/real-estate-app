// REALTOR_PRO_MVP_V1 — Pro 실행 환경 결정(서버 전용): 기능 스위치 · 로컬 데모 · 의존성 · 로그인 사용자.
//
// 스위치
//   REALTOR_PRO_ENABLED=true   서버 env. **기본 꺼짐** — 꺼져 있으면 /pro 페이지는 "준비 중", /api/pro는 404.
//                              main에 병합·배포돼도 이 값을 켜기 전까지 Pro는 아무에게도 열리지 않는다.
//   REALTOR_PRO_DEMO=1         로컬 개발 데모(메모리 저장소 + 합성 데이터 + 데모 중개사 세션).
//                              NODE_ENV=production 이거나 VERCEL_ENV가 있으면 **절대 켜지지 않는다**(resolveProMode 테스트 고정).
// 암호화 키: REALTOR_PRO_PII_KEY · REALTOR_PRO_LOOKUP_PEPPER(crypto.ts). 없으면 연락처 저장만 막고 나머지는 동작.
// 이 모듈과 하위 서비스는 NEXT_PUBLIC_* 값을 읽지 않는다.

import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-helpers';
import { redactSensitive } from '@/lib/log-redaction';
import { loadPiiKeyring, type PiiKeyring } from './crypto';
import { createMemoryProRepo, emptyMemoryState, type MemoryState } from './repo-memory';
import { ProStoreUnavailableError, type ProRepo } from './repo';
import type { ProActor, ProDeps, ProResult, PublicAptDataSource } from './service-core';
import { seedDemoState, DEMO_USER_ID } from './demo-seed';

import { resolveProMode, type ProMode } from './mode';
export { resolveProMode, type ProMode };

export function getProMode(): ProMode {
  return resolveProMode(process.env as Record<string, string | undefined>);
}

// ── 데모 저장소(프로세스 메모리, 재시작하면 사라짐) ─────────────────────────────
const g = globalThis as unknown as { __ejipProDemo?: { state: MemoryState; ring: PiiKeyring } };

function demoRuntime(): { repo: ProRepo; ring: PiiKeyring } {
  if (!g.__ejipProDemo) {
    // 데모 키는 프로세스마다 새로 만든 임의 키 — env의 실제 키를 쓰지 않는다
    const ring = loadPiiKeyring({ REALTOR_PRO_PII_KEY: randomBytes(32).toString('base64'), REALTOR_PRO_LOOKUP_PEPPER: randomBytes(24).toString('base64'), REALTOR_PRO_PII_KEY_ID: 'demo' });
    const state = emptyMemoryState();
    seedDemoState(state, ring, new Date());
    g.__ejipProDemo = { state, ring };
  }
  return { repo: createMemoryProRepo(g.__ejipProDemo.state), ring: g.__ejipProDemo.ring };
}

const noPublicData: PublicAptDataSource = { lookup: async () => null };

function liveRing(): PiiKeyring | null {
  try {
    return loadPiiKeyring(process.env as Record<string, string | undefined>);
  } catch {
    return null; // 키 미설정·형식 오류: 연락처 저장/조회만 503
  }
}

export async function getProDeps(mode: Exclude<ProMode, 'OFF'>): Promise<ProDeps> {
  if (mode === 'DEMO') {
    const d = demoRuntime();
    return { repo: d.repo, ring: d.ring, now: () => new Date(), publicData: noPublicData };
  }
  // LIVE는 Prisma 모듈을 여기서만 로드한다(데모·테스트가 DB 클라이언트를 끌어오지 않게)
  const [{ prismaProRepo }, { prismaPublicAptData }] = [await import('./repo-prisma'), await import('./public-data-prisma')];
  return { repo: prismaProRepo, ring: liveRing(), now: () => new Date(), publicData: prismaPublicAptData };
}

/** 서버 세션의 사용자만 actor가 된다. 데모 모드에서는 고정 데모 중개사. */
export async function getProActor(mode: Exclude<ProMode, 'OFF'>): Promise<ProActor | null> {
  if (mode === 'DEMO') return { userId: DEMO_USER_ID };
  const user = await getCurrentUser();
  const id = (user as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id ? { userId: id } : null;
}

// ── API 헬퍼 ────────────────────────────────────────────────────────────────

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function jsonResult<T>(r: ProResult<T>, successStatus = 200): NextResponse {
  if (r.ok) return NextResponse.json({ success: true, data: r.data }, { status: successStatus, headers: NO_STORE });
  const { status, code, message, fields, sensitiveFields } = r;
  return NextResponse.json({ success: false, code, error: message, ...(fields ? { fields } : {}), ...(sensitiveFields ? { sensitiveFields } : {}) }, { status, headers: NO_STORE });
}

/**
 * /api/pro/* 공통 래퍼: 스위치 → 로그인 → 서비스 호출 → 오류 분류.
 * 오류 로그에는 요청 본문·개인정보를 남기지 않는다(이름·메시지 종류만, 마스킹).
 */
export async function withPro(handler: (deps: ProDeps, actor: ProActor) => Promise<NextResponse>): Promise<NextResponse> {
  const mode = getProMode();
  if (mode === 'OFF') return NextResponse.json({ success: false, code: 'PRO_DISABLED', error: '준비 중인 기능입니다.' }, { status: 404, headers: NO_STORE });
  try {
    const actor = await getProActor(mode);
    if (!actor) return NextResponse.json({ success: false, code: 'LOGIN_REQUIRED', error: '로그인이 필요합니다.' }, { status: 401, headers: NO_STORE });
    const deps = await getProDeps(mode);
    return await handler(deps, actor);
  } catch (e) {
    if (e instanceof ProStoreUnavailableError) {
      return NextResponse.json({ success: false, code: e.reason === 'NOT_MIGRATED' ? 'PRO_NOT_MIGRATED' : 'PRO_STORE_UNAVAILABLE', error: '중개사 Pro 저장소가 아직 준비되지 않았습니다.' }, { status: 503, headers: NO_STORE });
    }
    console.error('[pro] request failed:', redactSensitive(e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : 'unknown'));
    return NextResponse.json({ success: false, code: 'SERVER_ERROR', error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500, headers: NO_STORE });
  }
}

const BODY_MAX_BYTES = 32 * 1024;

export async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    const raw = await request.text();
    if (raw.length > BODY_MAX_BYTES) return { ok: false, response: NextResponse.json({ success: false, code: 'BODY_TOO_LARGE', error: '요청이 너무 큽니다.' }, { status: 413 }) };
    return { ok: true, body: raw ? JSON.parse(raw) : {} };
  } catch {
    return { ok: false, response: NextResponse.json({ success: false, code: 'INVALID_BODY', error: '요청 형식이 올바르지 않습니다.' }, { status: 400 }) };
  }
}

/** 같은 출처 요청만 쓰기 허용(CSRF 보조 — 세션 쿠키 SameSite=Lax와 함께). Origin이 없으면(서버 간 호출 등) 통과. */
export function sameOriginOrReject(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  try {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    if (host && new URL(origin).host === host) return null;
  } catch {
    /* fallthrough */
  }
  return NextResponse.json({ success: false, code: 'CROSS_ORIGIN', error: '허용되지 않은 요청입니다.' }, { status: 403 });
}
