import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COMMUNITY_LIST_PATH,
  __resetDeletedPostsForTest,
  communityPostDetailKey,
  isCommunityListKey,
  isMissingPostStatus,
  isPostDeleted,
  markPostDeleted,
  removePostFromListData,
} from './deleted-post-navigation';

/**
 * COMMUNITY_DELETE_NAVIGATION_CLEANUP_V1 — 삭제된(또는 없는) 게시글의 사용자 화면은 커뮤니티 목록 하나다.
 * 삭제 → 목록. 삭제된 상세·수정 주소에 다시 닿아도(뒤로·앞으로·직접 입력) 중간 안내/오류 화면 없이 목록으로.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const DETAIL = 'src/app/community/[id]/post-client.tsx';
const EDIT = 'src/app/community/[id]/edit/page.tsx';
const LAYOUT = 'src/app/community/[id]/layout.tsx';
const LIST = 'src/app/community/page.tsx';

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

beforeEach(() => __resetDeletedPostsForTest());

const listPayload = () => ({ success: true, data: { posts: [{ id: 'a', title: 'A' }, { id: 'gone', title: 'G' }, { id: 'b', title: 'B' }], total: 3, pageSize: 20 } });

test('1. 삭제 성공은 replace로 목록 이동(삭제한 상세가 기록에 남지 않게), push 없음', () => {
  const detail = codeOf(read(DETAIL));
  const onSuccess = detail.slice(detail.indexOf('if (json.success) {', detail.indexOf('handleDeletePost')), detail.indexOf("setActionError(json.error || '삭제하지 못했습니다.');"));
  assert.ok(/router\.replace\(COMMUNITY_LIST_PATH\);/.test(onSuccess));
  assert.ok(!/router\.push\('\/community'\)/.test(detail));
  assert.ok(/markPostDeleted\(postId\);/.test(onSuccess));
  assert.equal(COMMUNITY_LIST_PATH, '/community');
});

test('2·3·4. 캐시: 상세 키 비움, 수정 화면은 캐시 없음(no-store), 목록 캐시에서 삭제 글 제거 후 재검증', () => {
  const detail = codeOf(read(DETAIL));
  assert.ok(/void mutateCache\(detailKey, undefined, \{ revalidate: false \}\);/.test(detail));
  assert.ok(/void mutateCache\(isCommunityListKey, \(current: unknown\) => removePostFromListData\(current, postId\), \{ revalidate: false \}\);/.test(detail));
  // 키는 실제 화면이 쓰는 값 그대로
  assert.equal(communityPostDetailKey('p1'), '/api/community/posts/p1');
  assert.ok(/const queryKey = `\/api\/community\/posts\?page=\$\{page\}/.test(read(LIST)), '목록 SWR 키 형식');
  assert.ok(/useSWR\(queryKey, fetcher\)/.test(read(LIST)));
  assert.equal(isCommunityListKey('/api/community/posts?page=1'), true);
  assert.equal(isCommunityListKey('/api/community/posts?page=2&aptName=%EB%9E%98'), true);
  assert.equal(isCommunityListKey('/api/community/posts/p1'), false, '상세 키와 겹치지 않음');
  assert.equal(isCommunityListKey(['/api/community/posts?page=1']), false);
  // 목록 데이터에서 글 제거·total 감소, 모양이 다르면 그대로
  const out = removePostFromListData(listPayload(), 'gone');
  assert.deepEqual(out.data.posts.map((p) => p.id), ['a', 'b']);
  assert.equal(out.data.total, 2);
  assert.equal(out.data.pageSize, 20);
  const same = listPayload();
  assert.equal(removePostFromListData(same, 'nope'), same);
  assert.equal(removePostFromListData(undefined, 'gone'), undefined);
  const failed = { success: false, error: 'x' };
  assert.equal(removePostFromListData(failed, 'gone'), failed);
  // 목록은 다시 열릴 때 SWR 기본값(revalidateIfStale)으로 재검증된다 — 옵션으로 끄지 않았다
  assert.ok(!/revalidateIfStale:\s*false|revalidateOnMount:\s*false/.test(read(LIST)));
  // 수정 화면은 SWR 캐시를 쓰지 않는다
  const edit = codeOf(read(EDIT));
  assert.ok(!/useSWR\(/.test(edit) && /cache: 'no-store'/.test(edit));
});

test('5·7·8·9. 없는 상세: 404면 목록으로 replace, "찾을 수 없습니다"/돌아가기/다시 시도 중간 화면 없음', () => {
  const detail = codeOf(read(DETAIL));
  assert.ok(/if \(isMissingPostStatus\(res\.status\)\) return \{ success: false, httpStatus: res\.status \};/.test(detail));
  assert.ok(/const missing = knownDeleted \|\| isMissingPostStatus\(data\?\.httpStatus\);/.test(detail));
  assert.ok(/if \(!missing \|\| leavingRef\.current\) return;\s*leavingRef\.current = true;\s*markPostDeleted\(postId\);\s*router\.replace\(COMMUNITY_LIST_PATH\);/.test(detail));
  assert.ok(/if \(missing\) return null;/.test(detail));
  assert.ok(/const fetchError = missing \? null :/.test(detail), '없는 글은 오류 카드(다시 시도)로 가지 않는다');
  assert.ok(!/게시글을 찾을 수 없습니다|커뮤니티로 돌아가기|삭제된 게시글|존재하지 않는 게시글/.test(detail), "렌더되는 코드에 중간 화면 문구 없음");
  // 통신 실패·500은 "없는 글"이 아니다 — 기존 오류·다시 시도 유지(데이터 진실성)
  assert.ok(/swrError \? '게시글을 불러오지 못했습니다\.'/.test(detail) && /다시 시도/.test(read(DETAIL)));
  assert.equal(isMissingPostStatus(404), true);
  for (const s of [200, 401, 403, 500, 503, undefined]) assert.equal(isMissingPostStatus(s), false, String(s));
});

test('6·7·8. 없는 수정 주소: 404면 "글 수정"·오류 카드·다시 시도·로그인 창 없이 목록으로', () => {
  const edit = codeOf(read(EDIT));
  assert.ok(/if \(isMissingPostStatus\(res\.status\)\) return \{ success: false, missing: true \};/.test(edit));
  assert.ok(/if \(json\?\.missing\) \{\s*setNotFound\(true\);\s*return;\s*\}/.test(edit));
  assert.ok(/if \(!missing\) return;\s*markPostDeleted\(postId\);\s*router\.replace\(COMMUNITY_LIST_PATH\);/.test(edit));
  // 헤더("글 수정")·AuthGate보다 먼저 빈 화면 반환
  const ret = edit.indexOf('if (missing) return null;');
  assert.ok(ret > 0 && ret < edit.indexOf('<AuthGate>') && ret < edit.indexOf('<Header pageTitle="글 수정" />'));
  assert.ok(/if \(knownDeleted\) return;/.test(edit), '이미 삭제 확인된 글은 요청하지 않음');
  assert.ok(!/삭제된 게시글|존재하지 않는 게시글/.test(read(EDIT)));
});

test('10·11. 삭제된/잘못된 id 주소를 직접 열면 서버에서 화면을 그리기 전에 목록으로(조회 성공 + 없음일 때만)', () => {
  const layout = codeOf(read(LAYOUT));
  assert.ok(/import \{ redirect \} from 'next\/navigation';/.test(layout));
  assert.ok(/prisma\.post\.findUnique\(\{ where: \{ id \}, select: \{ id: true \} \}\)/.test(layout), '존재 여부만 조회');
  assert.ok(/missing = post === null;/.test(layout));
  // redirect는 try 밖, DB 오류는 redirect하지 않음
  const tryEnd = layout.indexOf('} catch');
  const redirectAt = layout.indexOf('if (missing) redirect(COMMUNITY_LIST_PATH);');
  assert.ok(redirectAt > tryEnd && tryEnd > 0);
  assert.ok(/return children;/.test(layout));
  // 레이아웃은 상세·수정 둘 다 감싼다([id] 폴더)
  const files = readdirSync(resolve(ROOT, 'src/app/community/[id]'));
  assert.ok(files.includes('layout.tsx') && files.includes('page.tsx') && files.includes('edit'));
  // 권한·인증 판정은 하지 않는다
  assert.ok(!/getServerSession|requireUser|auth\(|isAdmin/.test(layout));
});

test('12·13. 뒤로·앞으로 가기: 이 탭에서 삭제(404) 확인한 글은 요청 없이 즉시 목록, BFCache 복원도 다시 확인', () => {
  const storage = new MemoryStorage();
  assert.equal(isPostDeleted('p1', storage), false);
  markPostDeleted('p1', storage);
  assert.equal(isPostDeleted('p1', storage), true);
  // 문서가 다시 열려 모듈 기억이 사라져도 sessionStorage로 기억
  __resetDeletedPostsForTest();
  assert.equal(isPostDeleted('p1', storage), true);
  assert.equal(isPostDeleted('p2', storage), false);
  // 저장소가 없거나 깨져도 동작
  __resetDeletedPostsForTest();
  markPostDeleted('p3', null);
  assert.equal(isPostDeleted('p3', null), true);
  const broken = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
  markPostDeleted('p4', broken);
  assert.equal(isPostDeleted('p4', broken), true);
  // 오래된 항목은 잘라 저장(최대 50)
  const big = new MemoryStorage();
  for (let i = 0; i < 60; i++) markPostDeleted(`x${i}`, big);
  const stored = JSON.parse(big.getItem('ejip:community:deleted-posts')!);
  assert.equal(stored.length, 50);
  assert.equal(stored.at(-1), 'x59');

  for (const f of [DETAIL, EDIT]) {
    const code = codeOf(read(f));
    assert.ok(/const knownDeleted = useSyncExternalStore\(noSubscribe, \(\) => isPostDeleted\(postId\), \(\) => false\);/.test(code), `${f}: 서버 스냅샷 false(수화 불일치 없음)`);
    assert.ok(/window\.addEventListener\('pageshow', onPageShow\)/.test(code) && /if \(!event\.persisted\) return;/.test(code), `${f}: BFCache 복원 때만 확인`);
    assert.ok(/window\.removeEventListener\('pageshow', onPageShow\)/.test(code));
  }
  assert.ok(/useSWR\(knownDeleted \? null : detailKey, fetcher\)/.test(codeOf(read(DETAIL))));
  // 전역 BFCache 비활성화(unload 등록·no-store 헤더) 없음
  for (const f of [DETAIL, EDIT, LAYOUT]) assert.ok(!/addEventListener\('unload'|Cache-Control/.test(read(f)), f);
  // 추가 알림 없음
  for (const f of [DETAIL, EDIT, LAYOUT]) assert.ok(!/삭제된 게시글이라|이동했습니다/.test(read(f)), f);
});

test('14·15. 정상 상세·수정은 그대로: 본문·수정/삭제 버튼·저장 경로·오류 재시도 유지', () => {
  const detail = codeOf(read(DETAIL));
  assert.ok(/<CommunityPostContent blocks=/.test(detail));
  assert.ok(/\(isOwner \|\| isAdmin\) && \(\s*<Link href=\{`\/community\/\$\{postId\}\/edit`\}/.test(detail));
  assert.ok(/onClick=\{handleDeletePost\}/.test(detail));
  const edit = codeOf(read(EDIT));
  assert.ok(/<SimpleInlineComposer blocks=\{blocks\} onBlocksChange=\{setBlocks\}/.test(edit));
  assert.ok(/router\.replace\(`\/community\/\$\{post\.id\}`\);/.test(edit), '수정 저장 후 상세로');
  assert.ok(/다시 시도/.test(read(EDIT)), '통신 실패 재시도는 유지');
  assert.ok(/수정 권한이 없습니다\./.test(read(EDIT)));
});

test('16·17. 권한·인증·이미지/Storage 정리 불변: API 라우트와 삭제 처리 모듈은 이번 변경 대상이 아니다', () => {
  const route = read('src/app/api/community/posts/[id]/route.ts');
  assert.ok(/삭제 권한이 없습니다\./.test(route) && /\{ status: 403 \}/.test(route));
  assert.ok(/게시글을 찾을 수 없습니다\./.test(route) && /\{ status: 404 \}/.test(route), 'API의 404 의미는 유지');
  for (const f of [DETAIL, EDIT, LAYOUT, 'src/lib/community/deleted-post-navigation.ts']) {
    const code = codeOf(read(f));
    assert.ok(!/supabase\/server-storage|post-write-db|removeImages|storage\.remove/.test(code), f);
  }
  const nav = codeOf(read('src/lib/community/deleted-post-navigation.ts'));
  assert.ok(!/@\/lib\/prisma|next-auth|fetch\(/.test(nav), '순수 모듈');
  const schema = read('prisma/schema.prisma');
  assert.ok(/model Post \{/.test(schema) && /model PostImage \{/.test(schema) && /model PostContentBlock \{/.test(schema));
});
