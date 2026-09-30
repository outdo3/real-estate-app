// REALTOR_PRO_PREVIEW_EXTERNAL_GUARD_V1 — Realtor Pro Preview에서만 외부 데이터 API를 막고, Production·로컬·다른 Preview는 그대로.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PREVIEW_BLOCKED_HOSTS,
  PREVIEW_EXTERNAL_BLOCKED_MESSAGE,
  PreviewExternalBlockedError,
  blockedHostFor,
  createGuardedFetch,
  installPreviewExternalGuard,
  isPreviewExternalDataBlocked,
} from './preview-external-guard';
import { fetchMolitData, type MolitRawPage } from './api-molit';
import { resolveRuntimeDatabaseUrl, PREVIEW_DB_NOT_CONFIGURED_URL } from './db-url-policy';

const ROOT = resolve(__dirname, '../..');
const code = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PRO_PREVIEW = { VERCEL_ENV: 'preview', REALTOR_PRO_ENABLED: 'true' };

test('1 · 켜지는 조건은 VERCEL_ENV=preview + REALTOR_PRO_ENABLED=true 둘 다일 때뿐', () => {
  assert.equal(isPreviewExternalDataBlocked(PRO_PREVIEW), true);
  for (const env of [
    { VERCEL_ENV: 'production', REALTOR_PRO_ENABLED: 'true' }, // Production에서 Pro를 켜도 막지 않는다
    { VERCEL_ENV: 'production' },
    { VERCEL_ENV: 'preview' }, // 다른 Preview 브랜치(Pro 스위치 없음)
    { VERCEL_ENV: 'preview', REALTOR_PRO_ENABLED: 'TRUE' },
    { VERCEL_ENV: 'preview', REALTOR_PRO_ENABLED: '1' },
    { VERCEL_ENV: 'Preview', REALTOR_PRO_ENABLED: 'true' },
    { REALTOR_PRO_ENABLED: 'true' }, // 로컬(VERCEL_ENV 없음)
    {},
  ]) assert.equal(isPreviewExternalDataBlocked(env), false, JSON.stringify(env));
});

test('2 · 막는 호스트: 공공데이터·NEIS·학교알리미·Gemini·Resend·IndexNow (정확히 같거나 하위 도메인만)', () => {
  assert.deepEqual([...PREVIEW_BLOCKED_HOSTS].sort(), ['api.indexnow.org', 'api.odcloud.kr', 'api.resend.com', 'apis.data.go.kr', 'generativelanguage.googleapis.com', 'open.neis.go.kr', 'www.schoolinfo.go.kr'].sort());
  assert.equal(blockedHostFor('http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=x'), 'apis.data.go.kr');
  assert.equal(blockedHostFor('https://APIS.DATA.GO.KR/x'), 'apis.data.go.kr');
  assert.equal(blockedHostFor(new URL('https://open.neis.go.kr/hub/schoolInfo')), 'open.neis.go.kr');
  assert.equal(blockedHostFor({ url: 'https://api.resend.com/emails' }), 'api.resend.com');
  assert.equal(blockedHostFor('https://generativelanguage.googleapis.com/v1beta/models'), 'generativelanguage.googleapis.com');
  // 닮은 이름·다른 호스트·상대 경로는 막지 않는다
  for (const u of ['https://apis.data.go.kr.evil.example/x', 'https://evilapis.data.go.kr/x', 'https://dapi.kakao.com/v2/local/search/address.json', 'https://kauth.kakao.com/oauth', 'https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes', '/api/search?q=x', 'not a url', null, undefined, 42]) {
    assert.equal(blockedHostFor(u), null, String(u));
  }
});

test('3 · 감싼 fetch: 막힌 호스트는 네트워크 없이 거부(오류에 URL·서비스키 없음), 나머지는 원래 fetch로', async () => {
  const calls: unknown[] = [];
  const base = async (input: unknown) => { calls.push(input); return { ok: true } as unknown as Response; };
  const f = createGuardedFetch(base);
  await assert.rejects(() => f('http://apis.data.go.kr/x?serviceKey=SECRET123'), (e: unknown) => {
    assert.ok(e instanceof PreviewExternalBlockedError);
    assert.equal((e as PreviewExternalBlockedError).host, 'apis.data.go.kr');
    assert.ok(!/SECRET123|serviceKey/.test(String((e as Error).message)), '오류 메시지에 쿼리(서비스키)가 들어갔다');
    return true;
  });
  assert.equal(calls.length, 0, '막힌 요청이 네트워크로 나갔다');
  await f('https://dapi.kakao.com/v2/local/search/address.json?query=x');
  assert.equal(calls.length, 1);
});

test('4 · 설치: 조건이 맞을 때만, 한 번만 감싼다 — Production·로컬·다른 Preview는 전역 fetch를 건드리지 않는다', async () => {
  for (const env of [{ VERCEL_ENV: 'production', REALTOR_PRO_ENABLED: 'true' }, { VERCEL_ENV: 'preview' }, {}]) {
    const original = async () => ({ ok: true });
    const target = { fetch: original } as { fetch: typeof original } & Record<symbol, unknown>;
    assert.equal(installPreviewExternalGuard(env, target as never), false, JSON.stringify(env));
    assert.equal(target.fetch, original, '조건 밖에서 전역 fetch가 바뀌었다');
  }
  let n = 0;
  const target = { fetch: async () => { n++; return { ok: true }; } } as { fetch: (i: unknown) => Promise<unknown> } & Record<symbol, unknown>;
  assert.equal(installPreviewExternalGuard(PRO_PREVIEW, target as never), true);
  const once = target.fetch;
  assert.equal(installPreviewExternalGuard(PRO_PREVIEW, target as never), true);
  assert.equal(target.fetch, once, '두 번 감쌌다');
  await assert.rejects(() => target.fetch('https://api.indexnow.org/indexnow'));
  await target.fetch('https://e-jip.com/');
  assert.equal(n, 1);
});

test('5 · MOLIT 단일 관문: Pro Preview에서는 페이지 요청 0으로 실패 플레이스홀더("0건"으로 위장하지 않음), 그 밖은 그대로 요청', async () => {
  const saved = { VERCEL_ENV: process.env.VERCEL_ENV, REALTOR_PRO_ENABLED: process.env.REALTOR_PRO_ENABLED };
  let pages = 0;
  const fetchPage = async (): Promise<MolitRawPage> => { pages++; return { rawItems: [], totalCount: 0 }; };
  const instant = async () => {};
  try {
    process.env.VERCEL_ENV = 'preview';
    process.env.REALTOR_PRO_ENABLED = 'true';
    const blocked = await fetchMolitData({ type: 'apt', lawdCd: '26350', dealYmd: '202609' }, { sleep: instant, fetchPage: fetchPage as never });
    assert.equal(pages, 0, 'Pro Preview에서 MOLIT 페이지를 요청했다');
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].typeLabel, '에러');
    assert.ok(String(blocked[0].name).includes(PREVIEW_EXTERNAL_BLOCKED_MESSAGE));

    process.env.VERCEL_ENV = 'production'; // Production에서 Pro를 켜도 MOLIT 경로는 그대로
    const live = await fetchMolitData({ type: 'apt', lawdCd: '26350', dealYmd: '202608' }, { sleep: instant, fetchPage: fetchPage as never });
    assert.equal(pages, 1, 'Production 경로가 막혔다');
    assert.deepEqual(live, []);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('6 · 설치 지점: src/instrumentation.ts의 register가 관문을 설치 · api-molit 관문은 DB 전용 관문 바로 뒤, 네트워크 전', () => {
  const inst = code('src/instrumentation.ts');
  assert.match(inst, /export async function register\(\)/);
  assert.match(inst, /installPreviewExternalGuard\(process\.env/);
  const molit = code('src/lib/api-molit.ts');
  const gate = molit.indexOf('if (isPreviewExternalDataBlocked(process.env');
  assert.ok(gate > molit.indexOf('if (isDbOnlyLawdCd(params.lawdCd))'), 'MOLIT Preview 관문이 없다');
  assert.ok(gate < molit.indexOf('return dedupMolitInFlight('), 'MOLIT Preview 관문이 네트워크 경로보다 뒤');
  // 관문 모듈은 NEXT_PUBLIC_ 값을 읽지 않는다
  assert.ok(!/NEXT_PUBLIC_/.test(code('src/lib/preview-external-guard.ts')));
});

test('7 · Preview DB 연결은 Production DATABASE_URL로 떨어지지 않는다(Pro 브랜치 포함)', () => {
  const prodLike = 'postgresql://prod-user:x@prod.example:5432/postgres';
  const pro = 'postgresql://pro-user:x@pro.example:6543/postgres?pgbouncer=true';
  // Pro Preview: 브랜치 PREVIEW_DATABASE_URL만 쓴다
  assert.deepEqual(resolveRuntimeDatabaseUrl({ VERCEL_ENV: 'preview', REALTOR_PRO_ENABLED: 'true', PREVIEW_DATABASE_URL: pro, DATABASE_URL: prodLike }), { url: pro, source: 'PREVIEW_READ_ONLY' });
  // 값이 없으면 닫힘 — DATABASE_URL이 있어도 쓰지 않는다
  for (const v of [undefined, '', '   ']) {
    const r = resolveRuntimeDatabaseUrl({ VERCEL_ENV: 'preview', REALTOR_PRO_ENABLED: 'true', PREVIEW_DATABASE_URL: v, DATABASE_URL: prodLike });
    assert.equal(r.url, PREVIEW_DB_NOT_CONFIGURED_URL);
    assert.notEqual(r.url, prodLike);
  }
  // Production은 지금과 같다(Prisma 기본 DATABASE_URL)
  assert.deepEqual(resolveRuntimeDatabaseUrl({ VERCEL_ENV: 'production', PREVIEW_DATABASE_URL: pro, DATABASE_URL: prodLike }), { url: null, source: 'DEFAULT' });
  // 런타임 DB 클라이언트는 이 판정 하나만 쓴다(두 번째 클라이언트 없음)
  assert.match(code('src/lib/prisma.ts'), /resolveRuntimeDatabaseUrl\(process\.env/);
});
