import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  ADSENSE_CLIENT_ID, ADSENSE_PUBLISHER_ID, ADSENSE_SCRIPT_SRC, ADSENSE_ADS_TXT_LINE,
} from './adsense.ts';

// 형식이 두 가지라는 것이 이 파일의 유일한 함정이다 — 스크립트는 ca-pub-, ads.txt는 pub-.

test('스크립트 client ID는 ca-pub- 형식이다', () => {
  assert.equal(ADSENSE_CLIENT_ID, 'ca-pub-3291272948162277');
  assert.match(ADSENSE_CLIENT_ID, /^ca-pub-\d+$/);
});

test('ads.txt publisher ID는 ca- 접두사가 없다', () => {
  assert.equal(ADSENSE_PUBLISHER_ID, 'pub-3291272948162277');
  assert.ok(!ADSENSE_PUBLISHER_ID.startsWith('ca-'), 'ads.txt에 ca- 를 쓰면 무효가 된다');
});

test('두 ID는 같은 숫자를 가리킨다 — 한 곳에서 파생되므로 어긋날 수 없다', () => {
  assert.equal(ADSENSE_CLIENT_ID.replace(/^ca-/, ''), ADSENSE_PUBLISHER_ID);
});

test('로더 URL은 공식 형식이고 client 파라미터에 ca-pub-를 쓴다', () => {
  assert.equal(
    ADSENSE_SCRIPT_SRC,
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3291272948162277',
  );
});

test('ads.txt 한 줄은 google.com, pub-…, DIRECT, f08c47fec0942fa0 형식이다', () => {
  assert.equal(ADSENSE_ADS_TXT_LINE, 'google.com, pub-3291272948162277, DIRECT, f08c47fec0942fa0');
});

test('실제 public/ads.txt 파일이 그 한 줄과 정확히 같다', () => {
  const onDisk = fs.readFileSync(new URL('../../public/ads.txt', import.meta.url), 'utf8').trim();
  assert.equal(onDisk, ADSENSE_ADS_TXT_LINE, 'public/ads.txt와 상수가 어긋났다');
});

test('루트 레이아웃이 로더를 상수로 심는다 — ID를 직접 적지 않는다', () => {
  const layout = fs.readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /src=\{ADSENSE_SCRIPT_SRC\}/, '레이아웃이 상수를 써야 한다');
  assert.match(layout, /strategy="afterInteractive"/);
  assert.match(layout, /crossOrigin="anonymous"/);
  assert.ok(!/ca-pub-\d/.test(layout), '레이아웃에 ID를 하드코딩하지 않는다');
});

// 이번 단계는 사이트 확인만 — 광고는 아직 내보내지 않는다.
test('광고 슬롯도 Auto Ads도 아직 없다', () => {
  const layout = fs.readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.ok(!/adsbygoogle/.test(layout.replace(/ADSENSE_SCRIPT_SRC/g, '')), '슬롯 push 코드가 없어야 한다');
  assert.ok(!/enable_page_level_ads|data-ad-slot/.test(layout), 'Auto Ads/슬롯 속성이 없어야 한다');
});
