import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * COMMUNITY_ANONYMOUS_BROWSING_UX_V1 §9 — 읽기는 공개, 쓰기는 인증.
 *
 * 고친 문제: 목록과 상세가 AuthGate로 감싸여 있어 비로그인 방문자가 **들어오는 순간**
 * 로그인 모달이 자동으로 떴다. 닫으면 볼 수 있었지만 커뮤니티는 sitemap에 들어가는
 * 공개 화면이라, 검색이나 공유 링크로 들어온 첫 방문자가 본문 대신 모달을 먼저 만났다.
 *
 * 로그인을 없애는 작업이 아니다 — 인증을 **쓰기 액션 시점으로** 옮겼을 뿐이다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 구조를 언급한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const LIST = read('src/app/community/page.tsx');
const DETAIL = read('src/app/community/[id]/post-client.tsx');
const WRITE = read('src/app/community/write/page.tsx');
const MY = read('src/app/my/page.tsx');
const AUTH_GATE = read('src/components/AuthGate.tsx');
const POSTS_API = read('src/app/api/community/posts/route.ts');
const POST_API = read('src/app/api/community/posts/[id]/route.ts');
const COMMENTS_API = read('src/app/api/community/posts/[id]/comments/route.ts');
const COMMENT_API = read('src/app/api/community/comments/[id]/route.ts');

// ── A. 공개 읽기 화면에서 AuthGate 제거(§2/§3/§7) ──────────────────────────

test('§2 목록 진입만으로 로그인 모달이 열리지 않는다', () => {
  const code = codeOf(LIST);
  assert.ok(!/AuthGate/.test(code), '목록이 아직 AuthGate로 감싸여 있다');
  // 목록은 자체적으로 로그인 모달을 들지도 않는다 — 글쓰기 경로가 처리한다.
  assert.ok(!/LoginModal/.test(code), '목록이 직접 로그인 모달을 띄운다');
});

test('§3 상세 진입만으로 로그인 모달이 열리지 않는다', () => {
  const code = codeOf(DETAIL);
  assert.ok(!/AuthGate/.test(code), '상세가 아직 AuthGate로 감싸여 있다');
  // 모달은 있지만 **액션으로만** 열린다(아래 §4에서 확인).
  assert.ok(/LoginModal/.test(code), '액션용 로그인 모달이 없다');
  assert.ok(/useState\(false\)/.test(code.slice(code.indexOf('loginOpen'))) || /const \[loginOpen, setLoginOpen\] = useState\(false\)/.test(code),
    '모달이 기본 열림 상태다');
});

test('§8 세션 확인 중에 모달이 자동으로 열리지 않는다', () => {
  const code = codeOf(DETAIL);
  // 'loading'은 모르는 상태다 — 그걸 비로그인으로 단정해 모달을 띄우지 않는다.
  assert.ok(/sessionStatus === 'unauthenticated'/.test(code), '세션 확정 여부를 보지 않는다');
  assert.ok(!/sessionStatus !== 'authenticated'/.test(code), 'loading을 비로그인으로 단정한다');
  // 진입 시 모달을 여는 effect가 없다.
  assert.ok(!/useEffect\(\(\) => \{\s*setLoginOpen\(true\)/.test(code.replace(/\s+/g, ' ')), '진입 시 모달을 연다');
});

test('§7 AuthGate 컴포넌트 자체는 남아 있고 비공개 화면은 그대로다', () => {
  assert.ok(/export default function AuthGate/.test(AUTH_GATE), 'AuthGate가 삭제됐다');
  // 글쓰기·MY는 계속 보호된다.
  assert.ok(/<AuthGate>/.test(WRITE), '글쓰기 보호가 사라졌다');
  assert.ok(/<AuthGate>/.test(MY), 'MY 보호가 사라졌다');
  // 관리자 화면도 그대로.
  for (const p of ['src/app/admin/dashboard/page.tsx', 'src/app/admin/users/page.tsx', 'src/app/admin/behavior/page.tsx']) {
    assert.ok(/<AuthGate>/.test(read(p)), `${p}의 보호가 사라졌다`);
  }
});

// ── B. 쓰기 액션에서만 인증(§4) ────────────────────────────────────────────

test('§4 비로그인 댓글 작성 시도는 로그인을 요구한다 — 조용히 실패하지 않는다', () => {
  const code = codeOf(DETAIL);
  const at = code.indexOf('const handleSubmitComment');
  assert.ok(at > -1, '댓글 핸들러를 찾지 못했다');
  const head = code.slice(at, at + 400);
  assert.ok(/setLoginOpen\(true\);/.test(head), '댓글 시도 시 로그인을 요구하지 않는다');
  assert.ok(/return;/.test(head), '로그인을 요구하면서 요청도 보낸다');
  // 인증 확인이 요청 전에 온다.
  assert.ok(head.indexOf('setLoginOpen(true)') < head.indexOf('fetch('), '요청이 인증 확인보다 먼저다');
});

test('§4 로그인 후 원래 글로 돌아온다', () => {
  assert.ok(/callbackUrl=\{`\/community\/\$\{postId\}`\}/.test(DETAIL), '로그인 후 복귀 경로가 없다');
});

test('§4 글쓰기 버튼은 인증이 걸린 페이지로 보낸다', () => {
  // 목록의 글쓰기는 /community/write로 이동하고, 그 페이지의 AuthGate가 요구한다.
  assert.ok(/href=\{writeHref\}/.test(LIST), '글쓰기 진입이 사라졌다');
  assert.ok(/const writeHref = `\/community\/write/.test(LIST), '글쓰기 경로가 바뀌었다');
  assert.ok(/<AuthGate>/.test(WRITE), '글쓰기 페이지 보호가 사라졌다');
});

test('§4 비로그인에게는 댓글 입력 전에 알려준다', () => {
  assert.ok(/로그인 후 댓글을 쓸 수 있어요/.test(DETAIL), '입력 전 안내가 없다');
  // 댓글 목록 열람은 계속 허용된다(입력만 인증이 필요하다).
  assert.ok(/post\.comments\.map/.test(DETAIL), '댓글 목록 렌더가 사라졌다');
});

// ── C. 서버 계약 무변경(§5/§9/§11) ─────────────────────────────────────────

test('§9 공개 조회 API는 그대로 인증을 요구하지 않는다', () => {
  const listGet = codeOf(POSTS_API);
  const get = listGet.slice(listGet.indexOf('export async function GET'), listGet.indexOf('export async function POST'));
  assert.ok(!/requireUser|getCurrentUser/.test(get), '목록 조회가 로그인을 요구한다');

  const detailCode = codeOf(POST_API);
  const detailGet = detailCode.slice(detailCode.indexOf('export async function GET'), detailCode.indexOf('export async function PATCH'));
  assert.ok(!/requireUser|getCurrentUser/.test(detailGet), '상세 조회가 로그인을 요구한다');
});

test('§4 쓰기 API는 계속 서버에서 인증을 요구한다 — 클라이언트 모달에 의존하지 않는다', () => {
  assert.ok(/requireUser\(\)/.test(codeOf(POSTS_API)), '글 작성 인증이 사라졌다');
  assert.ok(/requireUser\(\)/.test(codeOf(COMMENTS_API)), '댓글 작성 인증이 사라졌다');
});

test('§5/§9 소유권 로직은 그대로다', () => {
  for (const [name, src] of [['post', POST_API], ['comment', COMMENT_API]] as const) {
    const code = codeOf(src);
    assert.ok(/existing\.authorId === user/.test(code), `${name} 소유자 검사가 사라졌다`);
    assert.ok(/isAdminSessionUser\(/.test(code), `${name} 관리자 판정이 바뀌었다`);
    assert.ok(/status: 403/.test(code), `${name} 권한 거부가 사라졌다`);
  }
  // 차단 계정의 수정 차단(직전 STEP)도 유지.
  const patch = codeOf(POST_API);
  assert.ok(/requireUser\(\)/.test(patch.slice(patch.indexOf('export async function PATCH'), patch.indexOf('export async function DELETE'))),
    '차단 계정 수정 차단이 사라졌다');
});

// ── D. 검색 진입(§6) ───────────────────────────────────────────────────────

test('§6 검색/공유로 들어온 본문이 모달에 가리지 않는다', () => {
  const code = codeOf(DETAIL);
  // 본문 렌더가 인증 상태에 묶여 있지 않다.
  assert.ok(/styles\.postContent/.test(code), '본문 렌더가 사라졌다');
  const contentAt = code.indexOf('styles.postContent');
  const gate = code.slice(0, contentAt);
  assert.ok(!/AuthGate/.test(gate), '본문이 인증 래퍼 안에 있다');
});

test('§6 metadata/canonical은 직전 STEP 상태를 유지한다', () => {
  const page = codeOf(read('src/app/community/[id]/page.tsx'));
  assert.ok(/alternates: \{ canonical \}/.test(page), 'canonical이 사라졌다');
  assert.ok(/url: canonical/.test(page), 'og:url이 사라졌다');
  assert.ok(/generateMetadata/.test(page), '메타데이터 생성이 사라졌다');
});

// ── E. 로딩/빈 상태 회귀 방지(직전 STEP) ───────────────────────────────────

test('직전 STEP의 loading/error 분리가 유지된다', () => {
  for (const [name, src] of [['list', LIST], ['detail', DETAIL]] as const) {
    const code = codeOf(src);
    assert.ok(/error: swrError/.test(code), `${name}의 오류 분기가 사라졌다`);
    assert.ok(/다시 시도/.test(src), `${name}의 재시도가 사라졌다`);
  }
});
