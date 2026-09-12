import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * COMMUNITY_LAUNCH_READINESS_V1 §19 — 출시 전 커뮤니티 계약.
 *
 * 커뮤니티 로직은 대부분 API 라우트 + 화면에 있어 DB 없이 단위 실행할 수 없다.
 * 그래서 이 프로젝트의 기존 관례대로 **배선 계약**을 고정한다 — 권한 검사가 서버에
 * 있는지, false empty가 돌아오지 않는지, 닉네임을 snapshot하지 않는지처럼 회귀하면
 * 출시 품질이 무너지는 지점들이다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 코드를 언급한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const POSTS = read('src/app/api/community/posts/route.ts');
const POST_ID = read('src/app/api/community/posts/[id]/route.ts');
const COMMENTS = read('src/app/api/community/posts/[id]/comments/route.ts');
const COMMENT_ID = read('src/app/api/community/comments/[id]/route.ts');
const PIN = read('src/app/api/community/posts/[id]/pin/route.ts');
const LIST = read('src/app/community/page.tsx');
const DETAIL = read('src/app/community/[id]/post-client.tsx');
const DETAIL_PAGE = read('src/app/community/[id]/page.tsx');
const WRITE = read('src/app/community/write/page.tsx');
const SCHEMA = read('prisma/schema.prisma');
const ROBOTS = read('src/app/robots.ts');

// ── A. 읽기는 공개, 쓰기는 인증(§19) ───────────────────────────────────────

test('§19 글 목록 GET은 로그인을 요구하지 않는다 — 비로그인도 읽을 수 있다', () => {
  const code = codeOf(POSTS);
  // import 줄이 아니라 **GET 함수 본문만** 본다.
  const get = code.slice(code.indexOf('export async function GET'), code.indexOf('export async function POST'));
  assert.ok(!/requireUser|getCurrentUser/.test(get), '목록 조회가 로그인을 요구한다');
});

test('§19 글 상세 GET도 공개다', () => {
  const code = codeOf(POST_ID);
  const get = code.slice(code.indexOf('export async function GET'), code.indexOf('export async function PATCH'));
  assert.ok(!/requireUser|getCurrentUser/.test(get), '상세 조회가 로그인을 요구한다');
});

test('§19 비로그인 작성은 서버에서 거부된다', () => {
  const code = codeOf(POSTS);
  const post = code.slice(code.indexOf('export async function POST'));
  assert.ok(/requireUser\(\)/.test(post), '글 작성이 인증을 확인하지 않는다');
  // 인증 확인이 본문 파싱보다 먼저다.
  assert.ok(post.indexOf('requireUser()') < post.indexOf('request.json()'));
});

test('§19 댓글 작성도 서버에서 인증을 요구한다', () => {
  const code = codeOf(COMMENTS);
  assert.ok(/requireUser\(\)/.test(code));
  assert.ok(code.indexOf('requireUser()') < code.indexOf('request.json()'));
});

test('§19 작성자 id는 세션에서만 온다 — 클라이언트 body를 믿지 않는다', () => {
  for (const [name, src] of [['posts', POSTS], ['comments', COMMENTS]] as const) {
    const code = codeOf(src);
    assert.ok(/authorId: user!\.id/.test(code), `${name}가 세션 사용자로 작성자를 정하지 않는다`);
    assert.ok(!/authorId: body|body\.authorId|body\.userId/.test(code), `${name}가 body의 작성자를 쓴다`);
  }
});

// ── B. 소유권(§7/§19) ──────────────────────────────────────────────────────

test('§7 글 수정/삭제는 작성자 또는 관리자만 — 서버에서 검사한다', () => {
  const code = codeOf(POST_ID);
  for (const fn of ['PATCH', 'DELETE']) {
    const start = code.indexOf(`export async function ${fn}`);
    const block = code.slice(start, start + 1400);
    assert.ok(/existing\.authorId === user/.test(block), `${fn}가 소유자 검사를 하지 않는다`);
    assert.ok(/isAdminSessionUser\(/.test(block), `${fn}의 관리자 판정이 단일 기준이 아니다`);
    assert.ok(/status: 403/.test(block), `${fn}가 권한 없음을 403으로 막지 않는다`);
  }
});

test('§7 댓글 삭제도 작성자 또는 관리자만', () => {
  const code = codeOf(COMMENT_ID);
  assert.ok(/existing\.authorId === user\.id/.test(code));
  assert.ok(/isAdminSessionUser\(/.test(code));
  assert.ok(/status: 403/.test(code));
});

test('§7 관리자 판정 기준이 커뮤니티 전체에서 하나다', () => {
  // 예전에는 수정/삭제만 role === 'ADMIN'을 직접 봐서, pin(requireAdmin)은 되는데
  // 삭제는 안 되는 관리자가 생길 수 있었다.
  for (const [name, src] of [['post', POST_ID], ['comment', COMMENT_ID]] as const) {
    assert.ok(!/user\.role === 'ADMIN'/.test(codeOf(src)), `${name}이 role만 보고 관리자를 판정한다`);
  }
  assert.ok(/requireAdmin\(\)/.test(codeOf(PIN)), 'pin이 관리자 헬퍼를 쓰지 않는다');
});

test('§7 차단된 계정은 기존 글을 수정하지 못한다', () => {
  const code = codeOf(POST_ID);
  const patch = code.slice(code.indexOf('export async function PATCH'), code.indexOf('export async function DELETE'));
  // requireUser는 banned를 403으로 막는다(getCurrentUser는 막지 않는다).
  assert.ok(/requireUser\(\)/.test(patch), '수정이 차단 계정을 걸러내지 않는다');
  // 삭제는 그대로 허용한다 — 자기 글을 지우는 것까지 막을 이유가 없다.
  const del = code.slice(code.indexOf('export async function DELETE'));
  assert.ok(/getCurrentUser\(\)/.test(del), '삭제 정책이 의도치 않게 바뀌었다');
});

// ── C. 닉네임 연계(§9) ─────────────────────────────────────────────────────

test('§9 작성자명을 snapshot하지 않는다 — 닉네임을 바꾸면 기존 글/댓글도 따라온다', () => {
  assert.ok(!/authorName|author_name|nickname\s+String/.test(SCHEMA.replace('@map("nickname")', '')),
    '작성자명이 비정규화 컬럼으로 저장된다');
  // 조회는 매번 User를 join해 현재 name을 가져온다.
  for (const [name, src] of [['list', POSTS], ['detail', POST_ID], ['comment', COMMENTS]] as const) {
    assert.ok(/author: \{ select: \{[^}]*name: true/.test(codeOf(src)), `${name}이 작성자명을 live join하지 않는다`);
  }
});

test('§13 공개 응답에 내부 user id를 싣지 않는다', () => {
  for (const [name, src] of [['list', POSTS], ['detail', POST_ID], ['comment', COMMENTS]] as const) {
    assert.ok(!/author: \{ select: \{ id: true/.test(codeOf(src)), `${name}이 author.id를 노출한다`);
  }
});

test('§13 공개 응답에 이메일이 실리지 않는다', () => {
  // 권한 헬퍼의 타입 캐스트에도 email이 등장하므로, 응답에 실리는 prisma select만 본다.
  for (const [name, src] of [['list', POSTS], ['detail', POST_ID], ['comment', COMMENTS]] as const) {
    const selects = codeOf(src).match(/select: \{[^}]*\}/g) ?? [];
    assert.ok(selects.length > 0, `${name}에 select가 없다(검사 대상이 사라졌다)`);
    for (const sel of selects) {
      assert.ok(!/email/.test(sel), `${name} 응답 select에 이메일이 섞였다: ${sel}`);
    }
  }
});

// ── D. loading / empty / error 분리(§3/§16) ────────────────────────────────

test('§3 통신 실패를 "글이 없음"으로 말하지 않는다 — false empty 금지', () => {
  for (const [name, src] of [['list', LIST], ['detail', DETAIL]] as const) {
    const code = codeOf(src);
    // SWR의 error를 반드시 함께 본다(예전에는 data.success만 봤다).
    assert.ok(/error: swrError/.test(code), `${name}이 SWR 오류를 보지 않는다`);
    assert.ok(/swrError \?/.test(code), `${name}이 SWR 오류를 상태에 반영하지 않는다`);
    // 오류 분기가 빈 상태 분기보다 먼저 평가된다.
    assert.ok(code.indexOf('fetchError ?') < code.indexOf('length === 0') || !code.includes('length === 0'),
      `${name}에서 빈 상태가 오류보다 먼저 판정된다`);
  }
});

test('§16 오류 상태에 재시도 수단이 있다 — 조용히 실패하지 않는다', () => {
  for (const [name, src] of [['list', LIST], ['detail', DETAIL]] as const) {
    assert.ok(/다시 시도/.test(src), `${name}에 재시도가 없다`);
    assert.ok(/onClick=\{\(\) => mutate\(\)\}/.test(src), `${name}의 재시도가 동작하지 않는다`);
    assert.ok(/role="alert"/.test(src), `${name}의 오류가 보조기술에 전달되지 않는다`);
  }
});

test('§16 로딩 상태가 따로 있다', () => {
  for (const [name, src] of [['list', LIST], ['detail', DETAIL]] as const) {
    assert.ok(/isLoading \?/.test(src), `${name}에 로딩 분기가 없다`);
    assert.ok(/role="status"/.test(src), `${name}의 로딩이 보조기술에 전달되지 않는다`);
  }
});

test('§4 빈 상태가 "없습니다"로 끝나지 않고 첫 글을 유도한다', () => {
  assert.ok(/첫 글 남기기/.test(LIST), '빈 상태에 작성 유도가 없다');
  assert.ok(!/아직 작성된 글이 없습니다\./.test(LIST), '예전의 마른 문구가 남아 있다');
  // 과한 마케팅 문구를 쓰지 않는다.
  for (const hype of ['최고', '지금 바로', '놓치지 마세요', '무료']) {
    assert.ok(!LIST.includes(hype), `과장 문구가 있다: ${hype}`);
  }
});

// ── E. 중복 제출 / 진행 상태(§6/§7/§8) ─────────────────────────────────────

test('§8 댓글 Enter 연타로 중복 등록되지 않는다', () => {
  assert.ok(/if \(submitting \|\| !comment\.trim\(\)\) return;/.test(DETAIL), 'Enter 경로에 가드가 없다');
  assert.ok(/disabled=\{submitting \|\| !comment\.trim\(\)\}/.test(DETAIL), '등록 버튼 상태가 불완전하다');
});

test('§7 삭제가 진행 중에는 다시 실행되지 않는다', () => {
  assert.ok(/if \(deletingPost\) return;/.test(DETAIL), '글 삭제에 in-flight 가드가 없다');
  assert.ok(/if \(deletingCommentId\) return;/.test(DETAIL), '댓글 삭제에 in-flight 가드가 없다');
  assert.ok(/disabled=\{deletingPost\}/.test(DETAIL), '글 삭제 버튼이 비활성화되지 않는다');
  assert.ok(/confirm\(/.test(DETAIL), '삭제 확인이 없다');
});

test('§6 글 작성 중복 제출 가드', () => {
  assert.ok(/if \(submitting\) return;/.test(WRITE));
  assert.ok(/disabled=\{submitting\}/.test(WRITE));
  assert.ok(/등록 중\.\.\./.test(WRITE), '진행 표시가 없다');
});

test('§6 작성 실패 시 입력 내용을 지우지 않는다', () => {
  const code = codeOf(WRITE);
  const fail = code.slice(code.indexOf('if (!json.success)'), code.indexOf('router.push'));
  assert.ok(!/setTitle\(''\)|setContent\(''\)/.test(fail), '실패 시 작성 내용을 날린다');
});

// ── F. 화면 계약(§5/§15) ───────────────────────────────────────────────────

test('§5 상세에서 목록으로 돌아갈 수 있다', () => {
  assert.ok(/href="\/community"/.test(DETAIL), '목록으로 돌아가는 링크가 없다');
  assert.ok(/커뮤니티 목록/.test(DETAIL));
});

test('§15 20자 닉네임이 레이아웃을 밀어내지 않는다', () => {
  const listCss = read('src/app/community/page.module.css');
  const detailCss = read('src/app/community/[id]/page.module.css');
  for (const [name, css, cls] of [['list', listCss, '.authorName'], ['detail', detailCss, '.commentAuthor']] as const) {
    const rule = css.slice(css.indexOf(`${cls} {`), css.indexOf(`${cls} {`) + 240);
    assert.ok(/max-width/.test(rule) && /text-overflow: ellipsis/.test(rule), `${name}의 닉네임 폭 제한이 없다`);
  }
});

test('§15/브랜드 규칙 — 제품 UI에 장식용 이모지를 쓰지 않는다', () => {
  for (const [name, src] of [['list', LIST], ['detail', DETAIL], ['write', WRITE]] as const) {
    for (const emoji of ['📌', '🏢', '✏️', '📍', '⚠️']) {
      assert.ok(!src.includes(emoji), `${name}에 장식 이모지가 남아 있다: ${emoji}`);
    }
    assert.ok(/from 'lucide-react'/.test(src), `${name}이 프로젝트 아이콘 시스템을 쓰지 않는다`);
  }
});

// ── G. SEO / metadata(§12) ─────────────────────────────────────────────────

test('§12 글마다 canonical과 og:url이 그 글을 가리킨다', () => {
  const code = codeOf(DETAIL_PAGE);
  assert.ok(/const canonical = absoluteUrl\(`\/community\/\$\{id\}`\)/.test(code), 'canonical이 글 단위가 아니다');
  assert.ok(/alternates: \{ canonical \}/.test(code), 'canonical 링크가 없다');
  assert.ok(/url: canonical/.test(code), 'og:url이 사이트 루트를 가리킨다');
  // 오리진은 siteConfig에서만 나온다.
  assert.ok(!/vercel\.app|e-jip\.com/.test(code), '호스트가 박혀 있다');
});

test('§12 metadata에 개인정보가 들어가지 않는다', () => {
  const code = codeOf(DETAIL_PAGE);
  assert.ok(/select: \{ title: true, content: true \}/.test(code), 'metadata가 필요 이상으로 읽는다');
  assert.ok(!/email|author/.test(code), 'metadata에 작성자 정보가 섞였다');
});

test('§12 글쓰기 페이지는 색인 대상이 아니다', () => {
  assert.ok(ROBOTS.includes("'/community/write'"), '작성 페이지가 색인에서 제외되지 않았다');
});
