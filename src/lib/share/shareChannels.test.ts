import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isEphemeralShareHost,
  joinShareUrl,
  resolveCanonicalShareOrigin,
  resolveShareChannels,
  withCanonicalOrigin,
} from './shareChannels';
import { CANONICAL_ORIGIN } from '@/config/canonical-host';

// SHARE_UX_V2 — 공유 시트 계약. 순수 로직은 실행해서, 배선은 소스로 고정한다.

// ── A. 복사/공유 URL은 항상 프로덕션 정규 오리진 ─────────────────────────────

test('§A localhost / preview / vercel 호스트는 공유 링크에 실리지 않는다', () => {
  for (const host of ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']) {
    assert.ok(isEphemeralShareHost(host), `${host}를 공유 가능한 호스트로 본다`);
  }
  for (const host of [
    'real-estate-app-park11.vercel.app',
    'real-estate-app-git-feature-park11.vercel.app',
    'real-estate-app-abc123-park11.vercel.app',
    'vercel.app',
  ]) {
    assert.ok(isEphemeralShareHost(host), `${host}를 공유 가능한 호스트로 본다`);
  }
  assert.ok(!isEphemeralShareHost('e-jip.com'), '정규 호스트를 일시적 호스트로 본다');
  assert.ok(!isEphemeralShareHost('www.e-jip.com'));
});

test('§A "vercel.app"이 이름에 들어간 정상 도메인까지 막지 않는다', () => {
  // 접미사 경계로만 판정한다 — notvercel.app / vercel.app.co.kr 은 대상이 아니다.
  assert.ok(!isEphemeralShareHost('notvercel.app'));
  assert.ok(!isEphemeralShareHost('vercel.app.co.kr'));
});

test('§A 오리진 해석 — https 정상 도메인만 그대로 쓰고 나머지는 정규 오리진', () => {
  assert.equal(resolveCanonicalShareOrigin('https://e-jip.com'), 'https://e-jip.com');
  assert.equal(resolveCanonicalShareOrigin('https://e-jip.com/'), 'https://e-jip.com');
  // 환경변수가 없거나(로컬), http이거나, 프리뷰 호스트면 정규 오리진으로 내려간다.
  assert.equal(resolveCanonicalShareOrigin(''), CANONICAL_ORIGIN);
  assert.equal(resolveCanonicalShareOrigin(null), CANONICAL_ORIGIN);
  assert.equal(resolveCanonicalShareOrigin('http://localhost:3000'), CANONICAL_ORIGIN);
  assert.equal(resolveCanonicalShareOrigin('https://real-estate-app-park11.vercel.app'), CANONICAL_ORIGIN);
  assert.equal(resolveCanonicalShareOrigin('not a url'), CANONICAL_ORIGIN);
});

test('§A 경로와 쿼리(=화면 상태)는 그대로 보존된다', () => {
  assert.equal(
    joinShareUrl('https://e-jip.com', '/stats/volume', '?sido=부산광역시&period=12m'),
    'https://e-jip.com/stats/volume?sido=부산광역시&period=12m'
  );
  assert.equal(joinShareUrl('https://e-jip.com/', 'school', ''), 'https://e-jip.com/school');
  assert.equal(joinShareUrl('https://e-jip.com', '/', '?'), 'https://e-jip.com/');
});

test('§A 호출부가 만든 URL도 오리진만 갈아끼운다 — 경로/쿼리/해시는 손대지 않는다', () => {
  assert.equal(
    withCanonicalOrigin('http://localhost:3000/compare?a=1-1&b=1-2#top', 'https://e-jip.com'),
    'https://e-jip.com/compare?a=1-1&b=1-2#top'
  );
  assert.equal(
    withCanonicalOrigin('https://real-estate-app-park11.vercel.app/report/city/busan', 'https://e-jip.com'),
    'https://e-jip.com/report/city/busan'
  );
  // 절대 URL이 아니면 경로로 본다.
  assert.equal(withCanonicalOrigin('/school', 'https://e-jip.com'), 'https://e-jip.com/school');
  assert.equal(withCanonicalOrigin('', 'https://e-jip.com'), '');
});

// ── B. 채널 가용성 ───────────────────────────────────────────────────────────

test('§B 링크 복사는 어떤 환경에서도 사라지지 않는다', () => {
  const none = resolveShareChannels({ kakaoReady: false, hasNativeShare: false });
  assert.deepEqual(none, { kakao: false, native: false, copy: true });
});

test('§B PC(navigator.share 없음)에서는 공유하기 행을 그리지 않는다 — dead button 금지', () => {
  const pc = resolveShareChannels({ kakaoReady: true, hasNativeShare: false });
  assert.equal(pc.native, false);
  assert.equal(pc.kakao, true, 'PC에서 카카오까지 사라지면 남는 게 복사뿐이다');
});

test('§B 모바일에서는 세 채널이 모두 선택지로 남는다 — 코드가 하나를 고르지 않는다', () => {
  const mobile = resolveShareChannels({ kakaoReady: true, hasNativeShare: true });
  assert.deepEqual(mobile, { kakao: true, native: true, copy: true });
});

test('§B 카카오 SDK가 준비되지 않았으면 카카오 행을 약속하지 않는다', () => {
  assert.equal(resolveShareChannels({ kakaoReady: false, hasNativeShare: true }).kakao, false);
});

// ── C~H. 배선 계약 ───────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const HOOK = read('src/hooks/useShareSheet.ts');
const SHEET = read('src/components/share/ShareSheet.tsx');
const SHARE_ACTION = read('src/components/ShareAction.tsx');
const KAKAO_BTN = read('src/components/KakaoShareButton.tsx');
const REPORT = read('src/components/report/ReportActions.tsx');
const UTILS = read('src/lib/share/shareUtils.ts');

test('§C 모든 공유 표면이 같은 시트를 연다 — 캐스케이드 중복 구현이 남아 있지 않다', () => {
  for (const [name, src] of [
    ['ShareAction', SHARE_ACTION],
    ['KakaoShareButton', KAKAO_BTN],
    ['ReportActions', REPORT],
  ] as const) {
    assert.ok(/useShareSheet\(/.test(src), `${name}이 공통 훅을 쓰지 않는다`);
    assert.ok(/<ShareSheet/.test(src), `${name}이 공통 시트를 렌더하지 않는다`);
    // 표면이 자기만의 카카오→네이티브→복사 사슬을 다시 만들지 않는다.
    assert.ok(!/isKakaoShareReady\(\)/.test(stripComments(src)), `${name}에 캐스케이드 분기가 남아 있다`);
  }
});

test('§D 시트의 세 액션은 고정 순서다 — 화면마다 순서가 달라지지 않는다', () => {
  const kakao = SHEET.indexOf('data-share-action="kakao"');
  const native = SHEET.indexOf('data-share-action="native"');
  const copy = SHEET.indexOf('data-share-action="copy"');
  assert.ok(kakao > -1 && native > -1 && copy > -1, '세 액션 중 빠진 것이 있다');
  assert.ok(kakao < native && native < copy, '카카오 → 공유하기 → 링크 복사 순서가 아니다');
});

test('§E 특정 카카오톡 인스턴스를 코드가 고르지 않는다', () => {
  // 두 번째 카카오톡을 지목하는 건 OS/카카오 앱의 권한이다. 패키지명/인텐트/딥링크로
  // 특정 인스턴스를 강제하는 코드가 들어오면 여기서 막는다.
  const all = [HOOK, SHEET, SHARE_ACTION, KAKAO_BTN, UTILS].map(stripComments).join('\n');
  for (const forbidden of [
    'com.kakao.talk',
    'intent://',
    'kakaolink://',
    'kakaotalk://',
    'dualmessenger',
    'android_app://',
  ]) {
    assert.ok(!all.toLowerCase().includes(forbidden.toLowerCase()), `특정 카카오톡 인스턴스를 지목한다: ${forbidden}`);
  }
});

test('§F 공유 UI는 리포트 캡처에 포함되지 않는다', () => {
  assert.ok(/data-export-exclude=""/.test(SHEET), '시트에 캡처 제외 표시가 없다');
});

test('§G 사용자가 공유창을 닫으면(AbortError) 오류로 처리하지 않는다', () => {
  const code = stripComments(HOOK);
  const line = code.split(/\r?\n/).find((l) => l.includes("result === 'aborted'"));
  assert.ok(line, '취소 분기가 없다');
  // 분기 한 줄이 그자리에서 return한다 — 아래 실패 경로로 흘러가지 않는다.
  assert.ok(/\) return;\s*$/.test(line!), `취소가 그자리에서 끝나지 않는다: ${line}`);
  assert.ok(!/setStatus|trackEvent/.test(line!), '취소를 실패/성공으로 기록한다');
  // 네이티브 실패(취소 아님)은 별도로 구분된다.
  assert.ok(/nativeShare\(payload\)|'failed'/.test(code) || /setStatus\('copy_failed'\)/.test(code));
});

test('§H 복사가 막힌 환경에서도 막다른 골목이 아니다 — URL을 보여준다', () => {
  assert.ok(/status === 'copy_failed'/.test(SHEET), '복사 실패 상태를 다루지 않는다');
  assert.ok(/readOnly value={url}/.test(SHEET), '복사 실패 시 URL을 보여주지 않는다');
});

test('§H 시트를 여는 순간 URL이 고정된다 — 정규 오리진 빌더를 통과한다', () => {
  assert.ok(/setUrl\(buildCanonicalShareUrl\(params, explicitUrl\)\);/.test(HOOK));
  assert.ok(/export function buildCanonicalShareUrl\(/.test(UTILS));
  assert.ok(/resolveCanonicalShareOrigin\(siteConfig\.url\)/.test(UTILS), '오리진이 siteConfig를 거치지 않는다');
  // 호스트를 코드에 박지 않는다 — 정규 오리진은 canonical-host 한 곳에서만 온다.
  assert.ok(!/e-jip\.com/.test(stripComments(UTILS)), 'shareUtils에 호스트가 박혀 있다');
  assert.ok(!/e-jip\.com/.test(stripComments(HOOK)), 'useShareSheet에 호스트가 박혀 있다');
});

test('§B 가용성은 렌더 시점이 아니라 시트를 여는 순간에 잰다', () => {
  // 렌더 시점에 한 번 재고 말면 SSR/hydration 순간의 값이 굳어, 실제로는 없는
  // navigator.share에 "공유하기" 행을 그리는 dead button이 생긴다(로컬 실측으로 확인).
  assert.ok(/setNativeReady\(typeof navigator !== 'undefined' && typeof navigator\.share === 'function'\);/.test(HOOK));
  assert.ok(/setKakaoReady\(isKakaoShareReady\(\)\);/.test(HOOK));
  const open = HOOK.slice(HOOK.indexOf('const openSheet'), HOOK.indexOf('const closeSheet'));
  assert.ok(/setNativeReady\(/.test(open), '네이티브 가용성을 시트 열 때 재지 않는다');
  assert.ok(/setKakaoReady\(/.test(open), '카카오 가용성을 시트 열 때 재지 않는다');
});
