import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  nicknameLength,
  validateNickname,
} from './nickname';

/**
 * USER_NICKNAME_EDIT_V1 §9 — 닉네임 수정 계약.
 */

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 설계를 설명하느라 금지 토큰을 언급한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROUTE = read('src/app/api/my/profile/route.ts');
const AUTH = read('src/lib/auth.ts');
const MY_PAGE = read('src/app/my/page.tsx');
const SCHEMA = read('prisma/schema.prisma');

const ok = (body: unknown) => {
  const r = validateNickname(body);
  assert.ok(r.valid, `거부됐다: ${r.valid ? '' : r.error}`);
  return r.valid ? r.nickname : '';
};
const rejected = (body: unknown) => {
  const r = validateNickname(body);
  assert.ok(!r.valid, '통과하면 안 되는 값이 통과했다');
  return r.valid ? '' : r.error;
};

// ── A. 검증 규칙(§3) ───────────────────────────────────────────────────────

test('§3 정상 닉네임을 통과시킨다', () => {
  assert.equal(ok({ nickname: '이집유저' }), '이집유저');
  assert.equal(ok({ nickname: 'ejip_user' }), 'ejip_user');
  assert.equal(ok({ nickname: '부산 사는 사람' }), '부산 사는 사람');
});

test('§3 앞뒤 공백을 잘라낸다', () => {
  assert.equal(ok({ nickname: '  이집유저  ' }), '이집유저');
  assert.equal(ok({ nickname: '\t이집유저 ' }), '이집유저');
});

test('§3 빈 값과 공백만 있는 값을 거부한다', () => {
  rejected({ nickname: '' });
  rejected({ nickname: '   ' });
  rejected({ nickname: '\t\t' });
});

test('§3 길이 경계 — 2~20자', () => {
  assert.equal(NICKNAME_MIN_LENGTH, 2);
  assert.equal(NICKNAME_MAX_LENGTH, 20);
  rejected({ nickname: '가' });
  ok({ nickname: '가나' });
  ok({ nickname: '가'.repeat(20) });
  rejected({ nickname: '가'.repeat(21) });
});

test('§3 길이는 코드 포인트로 센다 — 이모지가 두 글자로 계산되지 않는다', () => {
  assert.equal(nicknameLength('집🏠'), 2);
  assert.equal('집🏠'.length, 3, 'surrogate pair 전제가 깨졌다');
  ok({ nickname: '집🏠' });
});

test('§3 제어문자를 거부한다', () => {
  // 소스에 제어문자를 리터럴로 적지 않는다 — 에디터/도구마다 다르게 보이고 diff가 깨진다.
  const ctrl = (code: number) => `이집${String.fromCharCode(code)}유저`;
  for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x7f, 0x9f]) {
    rejected({ nickname: ctrl(code) });
  }
  // 일반 공백과 이모지는 제어문자가 아니다.
  ok({ nickname: '이집 유저' });
  ok({ nickname: '집🏠' });
});

test('§3 잘못된 요청 형태를 안전하게 거부한다', () => {
  rejected(null);
  rejected(undefined);
  rejected('이집유저');
  rejected({});
  rejected({ nickname: 123 });
  rejected({ nickname: null });
});

test('§3 과도한 금칙어 필터를 만들지 않았다', () => {
  const code = codeOf(read('src/lib/nickname.ts'));
  for (const bad of ['banned', 'forbidden', 'blacklist', '금칙']) {
    assert.ok(!code.includes(bad), `금칙어 시스템이 생겼다: ${bad}`);
  }
  // 중복 검사(DB 조회)도 하지 않는다 — 순수 함수다.
  assert.ok(!/prisma|findUnique|await/.test(code), '검증에 DB 조회가 섞였다');
});

// ── B. 스키마 무변경(§1/§10) ───────────────────────────────────────────────

test('§1 스키마를 바꾸지 않았다 — name은 여전히 non-unique다', () => {
  const userModel = SCHEMA.slice(SCHEMA.indexOf('model User {'), SCHEMA.indexOf('model Account {'));
  assert.ok(/name\s+String\s+@map\("nickname"\)/.test(userModel), 'User.name 정의가 바뀌었다');
  // 임의로 unique를 붙이지 않았다(기존 사용자 저장 실패를 만들지 않는다).
  assert.ok(!/name\s+String\s+@unique/.test(userModel), 'name에 unique가 추가됐다');
  // 이메일의 기존 unique는 그대로.
  assert.ok(/email\s+String\?\s+@unique/.test(userModel));
});

test('§6 커뮤니티는 작성자명을 snapshot하지 않는다 — 변경이 기존 글에도 반영된다', () => {
  const post = SCHEMA.slice(SCHEMA.indexOf('model Post {'), SCHEMA.indexOf('model Comment {'));
  assert.ok(/authorId\s+String/.test(post), 'Post가 authorId를 안 쓴다');
  assert.ok(!/authorName|author_name/.test(SCHEMA), '작성자명이 비정규화 컬럼으로 저장된다');
  // 조회는 User를 join해 name을 가져온다.
  const posts = read('src/app/api/community/posts/route.ts');
  assert.ok(/author: \{ select: \{[^}]*name: true/.test(posts), '작성자명을 live join하지 않는다');
});

// ── C. 소유권 강제(§4) ─────────────────────────────────────────────────────

test('§4 세션 사용자만 수정한다 — body의 userId를 신뢰하지 않는다', () => {
  const code = codeOf(ROUTE);
  assert.ok(/requireUser\(\)/.test(code), '인증 헬퍼를 쓰지 않는다');
  assert.ok(/where: \{ id: user!\.id \}/.test(code), 'DB 갱신 대상이 세션 사용자가 아니다');
  // 본문에서 userId/id를 읽는 경로가 아예 없다.
  assert.ok(!/body\.userId|body\.id|\.userId\b/.test(code), 'body의 사용자 식별자를 읽는다');
});

test('§4 미인증 요청은 거부된다', () => {
  const code = codeOf(ROUTE);
  // requireUser가 error를 주면 즉시 반환한다(401/403).
  assert.ok(/if \(error\) return NextResponse\.json\(\{ success: false, error \}, \{ status \}\)/.test(code));
  // 인증 확인이 본문 파싱보다 **먼저** 온다.
  assert.ok(code.indexOf('requireUser()') < code.indexOf('request.json()'));
});

test('§2/§10 이 API는 닉네임만 바꾼다 — 이메일/사진을 건드리지 않는다', () => {
  const code = codeOf(ROUTE);
  assert.ok(/data: \{ name: validated\.nickname \}/.test(code));
  assert.ok(!/email|image|avatar/.test(code), '범위 밖 필드를 수정한다');
});

test('§4 실패 로그에 사용자 입력값을 남기지 않는다', () => {
  const code = codeOf(ROUTE);
  const logs = code.match(/console\.(?:error|log|warn)\([^)]*\)/g) ?? [];
  assert.ok(logs.length > 0, '로그가 아예 없다(검사 대상이 사라졌다)');
  for (const l of logs) {
    // 인자가 정적 문자열 하나여야 한다 — 변수도 템플릿 보간도 없어야 값이 새지 않는다.
    assert.ok(!l.includes('${'), `로그에 보간이 있다: ${l}`);
    assert.ok(/^console\.\w+\('[^']*'\)$/.test(l), `로그에 값이 실릴 수 있다: ${l}`);
  }
});

// ── D. 세션 갱신(§5) ───────────────────────────────────────────────────────

test('§5 update 트리거에서만 이름을 다시 읽는다 — 매 요청 조회가 아니다', () => {
  const code = codeOf(AUTH);
  assert.ok(/trigger === 'update'/.test(code), 'update 트리거 처리가 없다');
  const block = code.slice(code.indexOf("trigger === 'update'"), code.indexOf('async session'));
  assert.ok(/prisma\.user\.findUnique/.test(block), 'DB에서 다시 읽지 않는다');
  assert.ok(/select: \{ name: true \}/.test(block), '필요 없는 컬럼까지 읽는다');
});

test('§5 클라이언트가 넘긴 값을 토큰에 그대로 넣지 않는다 — 표시명 위조 방지', () => {
  const code = codeOf(AUTH);
  const block = code.slice(code.indexOf("trigger === 'update'"), code.indexOf('async session'));
  // session 인자(클라이언트 제어)를 읽어 token.name에 대입하는 경로가 없어야 한다.
  assert.ok(!/token\.name = session/.test(block), '클라이언트 값을 그대로 신뢰한다');
  assert.ok(/token\.name = fresh\.name/.test(block), 'DB 값을 쓰지 않는다');
});

test('§5 DB 조회 실패가 로그인 상태를 깨뜨리지 않는다', () => {
  const code = codeOf(AUTH);
  const block = code.slice(code.indexOf("trigger === 'update'"), code.indexOf('async session'));
  assert.ok(/try \{/.test(block) && /\} catch \{/.test(block), '조회 실패가 토큰 발급을 막는다');
});

test('§5 저장 후 세션을 갱신해 새로고침 없이 반영한다', () => {
  assert.ok(/update: updateSession/.test(MY_PAGE), 'useSession의 update를 쓰지 않는다');
  assert.ok(/await updateSession\(\)/.test(MY_PAGE), '저장 후 세션 갱신이 없다');
  // jwt 콜백이 DB에서 읽으므로 인자를 넘길 필요가 없다.
  assert.ok(!/updateSession\(\{/.test(MY_PAGE), '클라이언트 값을 세션에 밀어넣는다');
});

// ── E. provider 재로그인 보호(§7) ──────────────────────────────────────────

test('§7 재로그인이 User.name을 덮어쓰지 않는다 — v4는 기존 사용자를 그대로 반환한다', () => {
  const handler = read('node_modules/next-auth/core/lib/callback-handler.js');
  // 연결된 계정으로 다시 로그인하면 userByAccount를 그대로 돌려준다(프로필 갱신 없음).
  assert.ok(/user: userByAccount/.test(handler), 'v4 동작 전제가 바뀌었다');
  // 우리 코드도 로그인 시 name을 건드리지 않는다.
  const code = codeOf(AUTH);
  assert.ok(!/token\.name = user\.name|name: user\.name/.test(code), '로그인마다 이름을 덮어쓴다');
  // 어댑터에 updateUser 커스터마이즈를 추가하지 않았다.
  assert.ok(!/updateUser:/.test(code), '어댑터가 사용자 정보를 갱신한다');
});

test('§7/§10 provider/링크 로직을 건드리지 않았다', () => {
  const code = codeOf(AUTH);
  assert.ok(/linkAccount: async \(account: any\)/.test(code), 'linkAccount 래퍼가 바뀌었다');
  assert.ok(/strategy: 'jwt'/.test(code), '세션 전략이 바뀌었다');
  assert.ok(/checks: \['state'\]/.test(code), 'Naver checks가 바뀌었다');
  for (const p of ['KakaoProvider', 'GoogleProvider', 'NaverProvider']) {
    assert.ok(code.includes(p), `${p}가 사라졌다`);
  }
});

// ── F. UI 계약(§2/§8) ──────────────────────────────────────────────────────

test('§2 프로필 카드에서 인라인 편집한다 — 이메일은 읽기 전용', () => {
  assert.ok(/닉네임 변경/.test(MY_PAGE), '변경 버튼이 없다');
  assert.ok(/저장/.test(MY_PAGE) && /취소/.test(MY_PAGE));
  const code = codeOf(MY_PAGE);
  // 이메일은 표시만 한다 — 입력 필드가 없다.
  assert.ok(!/name="email"|type="email"/.test(code), '이메일 수정 입력이 생겼다');
  assert.ok(!/프로필 사진 변경|이미지 변경/.test(code), '사진 수정 기능이 생겼다');
});

test('§8 저장 중 비활성화와 피드백이 있다', () => {
  assert.ok(/disabled=\{nicknameSaving\}/.test(MY_PAGE), '저장 중 비활성화가 없다');
  assert.ok(/저장 중\.\.\./.test(MY_PAGE), '진행 표시가 없다');
  assert.ok(/role="alert"/.test(MY_PAGE), '오류 안내가 없다');
  assert.ok(/닉네임을 변경했습니다/.test(MY_PAGE), '성공 피드백이 없다');
});

test('§8 모바일에서 입력 확대(zoom)를 유발하지 않는다', () => {
  const css = read('src/app/my/page.module.css');
  const rule = css.slice(css.indexOf('.nicknameInput {'), css.indexOf('.nicknameInput:focus'));
  assert.ok(/font-size: 16px/.test(rule), '16px 미만이면 iOS/안드로이드가 자동 확대한다');
});

test('§3 클라이언트가 규칙을 다시 쓰지 않는다 — 서버 문구를 그대로 보여준다', () => {
  assert.ok(/json\.error/.test(MY_PAGE), '서버 오류 문구를 쓰지 않는다');
  // 길이 상수는 공용 모듈에서 가져온다(두 곳에 적으면 갈라진다).
  assert.ok(/from '@\/lib\/nickname'/.test(MY_PAGE));
});
