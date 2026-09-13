import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  SIGN_IN_PENDING_LABEL,
  createSignInAttemptGuard,
  releaseSignInAttemptOnPageShow,
  startProviderSignIn,
  type SocialProviderId,
} from './login-attempt';

// E-JIP FINAL DEVICE UX FIX V1 — 로그인 중복 탭 방지와 인증 설정 무변경 검증.

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
/** 주석은 옛 코드와 사유를 인용하므로 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

function recorder() {
  const changes: Array<SocialProviderId | null> = [];
  return { changes, onChange: (p: SocialProviderId | null) => changes.push(p) };
}

// LOGIN 5
test('일반 로그인 진입(모달)에는 지난 실패 배너가 없다 — 모달은 error 상태나 파라미터를 읽지 않는다', () => {
  const modal = codeOf(read('src/components/LoginModal.tsx'));
  assert.doesNotMatch(modal, /useSearchParams|searchParams|[?&]error=|\berror\b/, '모달이 에러 상태를 들고 있다');
  assert.doesNotMatch(modal, /different account/i);
});

// LOGIN 6
test('실제 인증 오류는 계속 보인다 — NextAuth 오류 페이지를 가리거나 error 파라미터를 지우지 않는다', () => {
  const auth = codeOf(read('src/lib/auth.ts'));
  const pages = /pages:\s*\{([\s\S]*?)\}/.exec(auth)?.[1] ?? '';
  assert.equal(pages.trim(), '', 'pages 설정이 바뀌었다(오류 페이지 라우팅 변경은 이번 STEP 범위 밖)');
  for (const f of ['src/components/LoginModal.tsx', 'src/lib/login-attempt.ts', 'src/proxy.ts']) {
    assert.doesNotMatch(codeOf(read(f)), /searchParams\.delete\(['"]error|replaceState[\s\S]{0,80}error/, `${f}가 error 파라미터를 지운다`);
  }
});

// LOGIN 7
test('시작이 실패하면 잠금을 풀어 다시 누를 수 있고, bfcache 복원 시에도 풀린다', async () => {
  const guard = createSignInAttemptGuard();
  const r = recorder();
  const failed = await startProviderSignIn(guard, 'kakao', async () => { throw new Error('network'); }, r.onChange);
  assert.equal(failed, 'failed');
  assert.equal(guard.pending, null);
  assert.deepEqual(r.changes, ['kakao', null]);

  let calls = 0;
  const retried = await startProviderSignIn(guard, 'kakao', async () => { calls++; }, r.onChange);
  assert.equal(retried, 'started');
  assert.equal(calls, 1);

  // 프로바이더 화면에서 뒤로가기(bfcache 복원)
  assert.equal(releaseSignInAttemptOnPageShow(guard, { persisted: false }, r.onChange), false, '일반 로드는 건드리지 않는다');
  assert.equal(guard.pending, 'kakao');
  assert.equal(releaseSignInAttemptOnPageShow(guard, { persisted: true }, r.onChange), true);
  assert.equal(guard.pending, null);
  assert.equal(await startProviderSignIn(guard, 'kakao', async () => {}, r.onChange), 'started');
});

// LOGIN 8
test('Kakao 첫 클릭은 그대로 한 번 signIn을 시작하고, 이동 중 두 번째 탭은 새 OAuth 흐름(state 쿠키)을 만들지 않는다', async () => {
  const guard = createSignInAttemptGuard();
  const r = recorder();
  let posts = 0;
  let finish!: () => void;
  const inFlight = new Promise<void>((res) => { finish = res; });
  const run = async () => { posts++; await inFlight; };

  const first = startProviderSignIn(guard, 'kakao', run, r.onChange);
  const second = await startProviderSignIn(guard, 'kakao', run, r.onChange);
  const otherProvider = await startProviderSignIn(guard, 'naver', run, r.onChange);
  assert.equal(second, 'ignored');
  assert.equal(otherProvider, 'ignored', '다른 버튼도 같은 흐름을 덮지 못한다');
  assert.equal(posts, 1);
  finish();
  assert.equal(await first, 'started');
  assert.equal(guard.pending, 'kakao', '정상 이동 중에는 잠금을 유지한다(페이지가 떠난다)');
  assert.equal(SIGN_IN_PENDING_LABEL.kakao, '카카오로 이동 중…');

  const modal = codeOf(read('src/components/LoginModal.tsx'));
  assert.match(modal, /\(\) => signIn\(provider, \{ callbackUrl: resolvedCallbackUrl \}\)/, 'signIn 호출 형태(provider, callbackUrl)가 바뀌었다');
  assert.match(modal, /onClick=\{\(\) => startSignIn\('kakao'\)\}\s*disabled=\{isPending\}/);
});

// LOGIN 9
test('Google 흐름도 같은 signIn 호출 그대로다', () => {
  const modal = codeOf(read('src/components/LoginModal.tsx'));
  assert.match(modal, /onClick=\{\(\) => startSignIn\('google'\)\}\s*disabled=\{isPending\}/);
  const auth = codeOf(read('src/lib/auth.ts'));
  assert.match(auth, /GoogleProvider\(\{\s*clientId: process\.env\.GOOGLE_CLIENT_ID \|\| '',\s*clientSecret: process\.env\.GOOGLE_CLIENT_SECRET \|\| '',\s*\}\)/);
});

// LOGIN 10
test('Naver 설정과 인증 보안 설정은 건드리지 않았다(state 쿠키 / SameSite / checks / 세션 전략)', () => {
  const auth = codeOf(read('src/lib/auth.ts'));
  assert.match(auth, /checks: \['state'\],/, 'Naver checks가 바뀌었다');
  assert.match(auth, /url: 'https:\/\/nid\.naver\.com\/oauth2\.0\/authorize'/);
  assert.doesNotMatch(auth, /\bcookies\s*:|sameSite|useSecureCookies/i, '쿠키 설정이 추가됐다');
  assert.match(auth, /strategy: 'jwt'/);
  // Kakao도 기본 checks(['state'])를 그대로 쓴다 — override 없음.
  const kakao = /KakaoProvider\(\{([\s\S]*?)\}\),\s*NaverProvider/.exec(auth)?.[1] ?? '';
  assert.doesNotMatch(kakao, /checks/);
  // Naver 버튼은 모달의 공통 중복 탭 잠금만 공유한다(프로바이더 동작은 그대로).
  const modal = codeOf(read('src/components/LoginModal.tsx'));
  assert.match(modal, /onClick=\{\(\) => startSignIn\('naver'\)\}\s*disabled=\{isPending\}/);
});
