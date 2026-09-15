import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { aptDetailHref } from './report-links';

/**
 * BUSAN_LAUNCH_FINAL_RELEASE_GATE_V1 — 리포트 → 단지 상세 링크.
 * Production 재현: `/apt/롯데?aptSeq=26350-9`(우동 롯데 리포트의 "단지로 돌아가기")가 동명 다른 단지를 열었다.
 * 상세는 lawdCd+dong으로 단지를 찾으므로 링크는 검색·지도와 같은 canonical 계약으로만 만든다.
 */

const ROOT = resolve(__dirname, '../../..');

test('canonical 상세 계약: lawdCd + dong + aptSeq를 모두 싣는다', () => {
  const href = aptDetailHref({ name: '롯데', aptSeq: '26350-9', lawdCd: '26350', dong: '우동' })!;
  const url = new URL(href, 'https://e-jip.com');
  assert.equal(decodeURIComponent(url.pathname), '/apt/롯데');
  assert.deepEqual([...url.searchParams.entries()], [['lawdCd', '26350'], ['dong', '우동'], ['aptSeq', '26350-9']]);
});

test('식별이 하나라도 비면 링크를 만들지 않는다(틀린 단지보다 링크 없음)', () => {
  const full = { name: '삼익', aptSeq: '26470-78', lawdCd: '26470', dong: '연산동' };
  assert.ok(aptDetailHref(full));
  assert.equal(aptDetailHref({ ...full, lawdCd: null }), null);
  assert.equal(aptDetailHref({ ...full, lawdCd: '2647' }), null, '5자리 시군구 코드만');
  assert.equal(aptDetailHref({ ...full, dong: '' }), null);
  assert.equal(aptDetailHref({ ...full, aptSeq: undefined }), null);
  assert.equal(aptDetailHref({ ...full, name: ' ' }), null);
});

test('리포트 코드에 이름+aptSeq만 싣는 상세 링크가 남아 있지 않다', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
        if (/\/apt\/\$\{encodeURIComponent\([^)]*\)\}\?aptSeq=/.test(readFileSync(p, 'utf8'))) offenders.push(relative(ROOT, p));
      }
    }
  };
  walk(join(ROOT, 'src'));
  assert.deepEqual(offenders, []);
});
