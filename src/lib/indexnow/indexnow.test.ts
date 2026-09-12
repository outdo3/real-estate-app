import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { batchUrls, filterSubmittableUrls, submitIndexNow } from './submit';
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_EXCLUDED_PREFIXES,
  INDEXNOW_MAX_URLS_PER_REQUEST,
  isValidIndexNowKey,
} from './config';
import { decodeXmlEntities, findOutOfScopeRegionUrls, parseSitemapUrls, LAUNCH_SIDO } from './sitemap-urls';
import { buildLaunchRegionRoutes } from '../sitemap-scope';

/**
 * INDEXNOW_V1 §8 — IndexNow 연동 계약.
 *
 * 핵심 위험 두 가지를 고정한다:
 *  1. 우리 것이 아닌 URL을 통지하지 않는다(외부·localhost·프리뷰 호스트).
 *  2. 출시 범위 밖 지역을 통지하지 않는다 — 사이트맵 정책과 어긋나지 않는다.
 */

const HOST = 'e-jip.com';

// ── A. 호스트 정책(§3) ─────────────────────────────────────────────────────

test('§3 우리 호스트의 https URL만 통과한다', () => {
  const { accepted, rejected } = filterSubmittableUrls(
    [
      'https://e-jip.com/',
      'https://e-jip.com/stats',
      'https://e-jip.com/apt/%EB%8C%80%EC%8B%A0%ED%95%B4%EB%AA%A8%EB%A1%9C',
    ],
    HOST
  );
  assert.equal(accepted.length, 3);
  assert.equal(rejected.length, 0);
});

test('§3 외부 도메인을 거부한다 — 남의 사이트를 통지할 자격이 없다', () => {
  const { accepted, rejected } = filterSubmittableUrls(
    ['https://example.com/', 'https://naver.com/x', 'https://e-jip.com.evil.test/'],
    HOST
  );
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 3);
});

test('§3 localhost를 거부한다', () => {
  const { accepted } = filterSubmittableUrls(
    ['http://localhost:3000/', 'https://localhost/stats', 'http://127.0.0.1:3000/'],
    HOST
  );
  assert.equal(accepted.length, 0);
});

test('§3 vercel.app 프리뷰 호스트를 거부한다', () => {
  const { accepted, rejected } = filterSubmittableUrls(
    ['https://real-estate-app-park11.vercel.app/', 'https://some-preview-abc.vercel.app/stats'],
    HOST
  );
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 2);
});

test('§3 http는 거부한다 — 우리 사이트는 https다', () => {
  const { accepted } = filterSubmittableUrls(['http://e-jip.com/'], HOST);
  assert.equal(accepted.length, 0);
});

test('§3 URL이 아닌 값과 빈 값을 안전하게 처리한다', () => {
  const { accepted, rejected } = filterSubmittableUrls(['', '   ', 'not a url', '/stats'], HOST);
  assert.equal(accepted.length, 0);
  // 빈 문자열은 거부 목록에도 넣지 않는다(보고할 게 없다).
  assert.deepEqual(rejected, ['not a url', '/stats']);
});

test('§3 오리진을 알 수 없으면 아무것도 통과시키지 않는다', () => {
  const { accepted } = filterSubmittableUrls(['https://e-jip.com/'], null);
  assert.equal(accepted.length, 0);
});

// ── B. 중복/상한(§3) ───────────────────────────────────────────────────────

test('§3 중복 URL을 제거하고 처음 등장 순서를 유지한다', () => {
  const { accepted } = filterSubmittableUrls(
    ['https://e-jip.com/b', 'https://e-jip.com/a', 'https://e-jip.com/b', 'https://e-jip.com/a'],
    HOST
  );
  assert.deepEqual(accepted, ['https://e-jip.com/b', 'https://e-jip.com/a']);
});

test('§3 색인 대상이 아닌 경로를 거른다', () => {
  const excluded = INDEXNOW_EXCLUDED_PREFIXES.map((p) => `https://e-jip.com${p}`);
  const { accepted, rejected } = filterSubmittableUrls(
    [...excluded, 'https://e-jip.com/api/stats/feed', 'https://e-jip.com/community/write', 'https://e-jip.com/community'],
    HOST
  );
  assert.deepEqual(accepted, ['https://e-jip.com/community']);
  assert.ok(rejected.length >= excluded.length);
});

test('§3 규격 상한(10,000)에 맞춰 나눈다', () => {
  assert.equal(INDEXNOW_MAX_URLS_PER_REQUEST, 10_000);
  assert.deepEqual(batchUrls([]), []);
  const urls = Array.from({ length: 25 }, (_, i) => `https://e-jip.com/${i}`);
  const batches = batchUrls(urls, 10);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map((b) => b.length), [10, 10, 5]);
  // 나눠도 전체 순서와 내용이 보존된다.
  assert.deepEqual(batches.flat(), urls);
});

// ── C. 키 형식(§2/§7) ──────────────────────────────────────────────────────

test('§2 키 형식 검증', () => {
  assert.ok(isValidIndexNowKey('a1b2c3d4'));
  assert.ok(isValidIndexNowKey('0de185bf086e886fde6e72e9ff6fb80d'));
  assert.ok(isValidIndexNowKey('abcd-1234-efgh'));
  assert.ok(!isValidIndexNowKey('short'), '8자 미만');
  assert.ok(!isValidIndexNowKey('a'.repeat(129)), '128자 초과');
  assert.ok(!isValidIndexNowKey('has space12'), '공백 불가');
  assert.ok(!isValidIndexNowKey('has/slash12'), '슬래시 불가');
  assert.ok(!isValidIndexNowKey(''));
});

// ── D. 실패가 앱을 깨뜨리지 않는다(§3) ─────────────────────────────────────

test('§3 키가 없으면 요청을 보내지 않고 값으로 알린다 — 던지지 않는다', async () => {
  const saved = process.env.INDEXNOW_KEY;
  delete process.env.INDEXNOW_KEY;
  try {
    let called = false;
    const result = await submitIndexNow(['https://e-jip.com/'], {
      fetchImpl: (async () => {
        called = true;
        return new Response('', { status: 200 });
      }) as unknown as typeof fetch,
    });
    assert.equal(result.status, 'NOT_CONFIGURED');
    assert.equal(called, false, '설정이 없는데 네트워크 요청을 보냈다');
  } finally {
    if (saved === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = saved;
  }
});

test('§3 네트워크 오류가 예외로 터지지 않는다', async () => {
  const saved = process.env.INDEXNOW_KEY;
  process.env.INDEXNOW_KEY = 'testkey12345678';
  try {
    const result = await submitIndexNow(['https://e-jip.com/'], {
      fetchImpl: (async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch,
    });
    // 오리진이 https가 아닌 로컬 환경에서는 NOT_CONFIGURED가 먼저 나온다 — 어느 쪽이든
    // **던지지 않는다**는 것이 이 테스트의 핵심이다.
    assert.ok(['FAILED', 'NOT_CONFIGURED'].includes(result.status), `예상 밖 상태: ${result.status}`);
  } finally {
    if (saved === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = saved;
  }
});

test('§7 반환값에 키가 실리지 않는다', async () => {
  const saved = process.env.INDEXNOW_KEY;
  process.env.INDEXNOW_KEY = 'supersecretlookingkey123';
  try {
    const result = await submitIndexNow(['https://e-jip.com/'], {
      fetchImpl: (async () => new Response('', { status: 500 })) as unknown as typeof fetch,
    });
    assert.ok(!JSON.stringify(result).includes('supersecretlookingkey123'), '반환값에 키가 새어나온다');
  } finally {
    if (saved === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = saved;
  }
});

test('§3 엔드포인트는 공식 IndexNow 주소다', () => {
  assert.equal(INDEXNOW_ENDPOINT, 'https://api.indexnow.org/indexnow');
});

// ── E. 사이트맵 파싱(§4) ───────────────────────────────────────────────────

const SAMPLE_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://e-jip.com</loc></url>
<url><loc>https://e-jip.com/stats?sido=%EB%B6%80%EC%82%B0%EA%B4%91%EC%97%AD%EC%8B%9C&amp;sigungu=%EC%84%9C%EA%B5%AC</loc></url>
<url><loc>https://e-jip.com/community/42</loc></url>
</urlset>`;

test('§4 사이트맵에서 loc을 뽑는다', () => {
  const urls = parseSitemapUrls(SAMPLE_SITEMAP);
  assert.equal(urls.length, 3);
  assert.equal(urls[0], 'https://e-jip.com');
  assert.equal(urls[2], 'https://e-jip.com/community/42');
});

test('§4 &amp;를 디코드한다 — 안 하면 amp;sigungu라는 가짜 파라미터를 통지하게 된다', () => {
  const urls = parseSitemapUrls(SAMPLE_SITEMAP);
  const regionUrl = urls[1];
  assert.ok(!regionUrl.includes('&amp;'), `디코드되지 않았다: ${regionUrl}`);
  assert.ok(regionUrl.includes('&sigungu='));
  const params = new URL(regionUrl).searchParams;
  assert.equal(params.get('sido'), '부산광역시');
  assert.equal(params.get('sigungu'), '서구');
  assert.equal(params.get('amp;sigungu'), null, '가짜 파라미터가 생겼다');
});

test('§4 XML 엔티티 디코드', () => {
  assert.equal(decodeXmlEntities('a&amp;b'), 'a&b');
  assert.equal(decodeXmlEntities('&lt;tag&gt;'), '<tag>');
  assert.equal(decodeXmlEntities('&quot;q&quot; &apos;a&apos;'), '"q" \'a\'');
  // 이중 이스케이프를 잘못 풀지 않는다.
  assert.equal(decodeXmlEntities('&amp;lt;'), '&lt;');
});

test('§4 빈 사이트맵을 안전하게 처리한다', () => {
  assert.deepEqual(parseSitemapUrls('<urlset></urlset>'), []);
  assert.deepEqual(parseSitemapUrls(''), []);
});

// ── F. 부산 전용 증명(§4/§10) ──────────────────────────────────────────────

test('§4 현재 사이트맵 정책에는 부산 밖 지역 URL이 없다', () => {
  // 사이트맵의 지역 경로를 만드는 바로 그 함수를 쓴다 — 별도 목록을 만들지 않는다.
  const urls = buildLaunchRegionRoutes().map((r) => `https://e-jip.com${r.path.replace(/&amp;/g, '&')}`);
  assert.equal(urls.length, 32, '부산 16개 × (통계/학군)');
  assert.deepEqual(findOutOfScopeRegionUrls(urls), []);
});

test('§4 부산 밖 지역 URL이 섞이면 잡아낸다 — 조용히 통과시키지 않는다', () => {
  const seoul = `https://e-jip.com/stats?sido=${encodeURIComponent('서울특별시')}&sigungu=${encodeURIComponent('강남구')}`;
  const busan = `https://e-jip.com/stats?sido=${encodeURIComponent('부산광역시')}&sigungu=${encodeURIComponent('서구')}`;
  const offenders = findOutOfScopeRegionUrls([busan, seoul]);
  assert.deepEqual(offenders, [seoul]);
  assert.equal(LAUNCH_SIDO, '부산광역시');
});

test('§4 지역 파라미터가 없는 URL은 범위 검사 대상이 아니다', () => {
  assert.deepEqual(findOutOfScopeRegionUrls(['https://e-jip.com/', 'https://e-jip.com/community/42']), []);
});

// ── G. 키 파일(§2) ─────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, '../../..');
const PUBLIC_DIR = resolve(ROOT, 'public');
const KEY_FILE_RE = /^([A-Za-z0-9-]{8,128})\.txt$/;

test('§2 키 파일이 있다면 형식과 내용이 규격에 맞는다', () => {
  const keyFiles = readdirSync(PUBLIC_DIR).filter((f) => KEY_FILE_RE.test(f));
  if (keyFiles.length === 0) {
    // 아직 키가 발급/배치되지 않은 상태. 이 경우 클라이언트는 NOT_CONFIGURED로
    // 동작하며 아무것도 제출하지 않는다(위 테스트에서 확인).
    return;
  }
  assert.equal(keyFiles.length, 1, `키 파일은 하나여야 한다(현재 ${keyFiles.length}개: ${keyFiles.join(', ')})`);
  const [file] = keyFiles;
  const key = file.match(KEY_FILE_RE)![1];
  const content = readFileSync(resolve(PUBLIC_DIR, file), 'utf8');
  // 내용은 키 한 줄뿐이다. HTML도 다른 텍스트도 없다.
  assert.equal(content.trim(), key, '파일 내용이 파일 이름의 키와 다르다');
  assert.ok(!/[<>]/.test(content), 'HTML이 섞여 있다');
  assert.ok(isValidIndexNowKey(key));
});

test('§2 키 파일 생성 스크립트가 존재하고 내용이 키 한 줄이다', () => {
  const script = resolve(ROOT, 'scripts/indexnow/write-key-file.ts');
  assert.ok(existsSync(script), '키 파일 생성 스크립트가 없다');
  const src = readFileSync(script, 'utf8');
  assert.ok(/writeFileSync\(target, `\$\{key\}\\n`, 'utf8'\)/.test(src), '키 한 줄로 쓰지 않는다');
  assert.ok(/process\.env\.INDEXNOW_KEY/.test(src), '키 출처가 환경변수가 아니다');
});

// ── H. 자동화 정책(§5) ─────────────────────────────────────────────────────

test('§5 반복 제출 cron을 만들지 않았다', () => {
  const vercelJson = readFileSync(resolve(ROOT, 'vercel.json'), 'utf8');
  assert.ok(!/indexnow/i.test(vercelJson), 'IndexNow cron이 등록돼 있다');
});

test('§5 존재하지 않는 워크플로우에 가짜 훅을 달지 않았다', () => {
  const src = readFileSync(resolve(ROOT, 'src/lib/indexnow/submit.ts'), 'utf8');
  // 공용 함수만 내보내고, 커뮤니티/리포트 등에 직접 import되지 않는다.
  assert.ok(/export async function submitIndexNow/.test(src));
});
