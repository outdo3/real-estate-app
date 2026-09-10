// PWA_INSTALL_UX_V1 — 설치 상태 판정 / 노출 정책 테스트.
// 브라우저를 모킹하지 않는다 — 판정 로직이 전부 순수 함수라서 그럴 필요가 없다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canOfferInstall,
  DISMISS_COOLDOWN_MS,
  installGuideFor,
  isIosSafari,
  isKakaoInApp,
  isMobileEnv,
  isStandalone,
  resolveInstallCapability,
  shouldShowBanner,
  type InstallEnv,
} from './install-state';

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  kakaoIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5',
  kakaoAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 KAKAOTALK',
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const env = (over: Partial<InstallEnv> = {}): InstallEnv => ({
  userAgent: UA.androidChrome,
  displayStandalone: false,
  navigatorStandalone: false,
  hasPrompt: false,
  isNarrow: true,
  ...over,
});

test('이미 설치되어 실행 중이면 다른 무엇보다 INSTALLED다', () => {
  assert.equal(resolveInstallCapability(env({ displayStandalone: true, hasPrompt: true })), 'INSTALLED');
  // iOS는 navigator.standalone으로 판단한다.
  assert.equal(
    resolveInstallCapability(env({ userAgent: UA.iosSafari, navigatorStandalone: true })),
    'INSTALLED'
  );
  assert.equal(isStandalone({ displayStandalone: false, navigatorStandalone: true }), true);
  assert.equal(isStandalone({ displayStandalone: false, navigatorStandalone: false }), false);
});

test('beforeinstallprompt를 받았으면 네이티브 설치가 가능하다', () => {
  assert.equal(resolveInstallCapability(env({ hasPrompt: true })), 'PROMPTABLE');
});

test('카카오 인앱은 iOS/안드로이드 모두 KAKAO_INAPP이다', () => {
  assert.equal(resolveInstallCapability(env({ userAgent: UA.kakaoIos })), 'KAKAO_INAPP');
  assert.equal(resolveInstallCapability(env({ userAgent: UA.kakaoAndroid })), 'KAKAO_INAPP');
  assert.equal(isKakaoInApp(UA.kakaoIos), true);
  assert.equal(isKakaoInApp(UA.iosSafari), false);
});

test('카카오 인앱은 iOS Safari로 오인되지 않는다(§8 — 공유 시트 안내를 하면 안 된다)', () => {
  // UA에 Safari 토큰이 들어 있어도 카카오면 Safari가 아니다.
  assert.equal(isIosSafari(UA.kakaoIos), false);
  assert.notEqual(resolveInstallCapability(env({ userAgent: UA.kakaoIos })), 'IOS_SAFARI');
});

test('iOS Safari만 공유 시트 안내를 받는다', () => {
  assert.equal(resolveInstallCapability(env({ userAgent: UA.iosSafari })), 'IOS_SAFARI');
  // iOS Chrome은 홈 화면 추가를 제공하지 않으므로 Safari 안내를 하면 거짓말이 된다.
  assert.equal(isIosSafari(UA.iosChrome), false);
  assert.notEqual(resolveInstallCapability(env({ userAgent: UA.iosChrome })), 'IOS_SAFARI');
});

test('데스크톱은 설치 UI 대상이 아니다', () => {
  const cap = resolveInstallCapability(env({ userAgent: UA.desktopChrome, isNarrow: false }));
  assert.equal(cap, 'UNSUPPORTED');
  assert.equal(canOfferInstall(cap), false);
  assert.equal(isMobileEnv({ userAgent: UA.desktopChrome, isNarrow: false }), false);
});

test('설치됨/미지원 상태에서는 배너를 제안하지 않는다', () => {
  assert.equal(canOfferInstall('INSTALLED'), false);
  assert.equal(canOfferInstall('UNSUPPORTED'), false);
  assert.equal(canOfferInstall('PROMPTABLE'), true);
  assert.equal(canOfferInstall('IOS_SAFARI'), true);
  assert.equal(canOfferInstall('KAKAO_INAPP'), true);
});

// ── 노출/거절 정책 (§10) ───────────────────────────────────────────────────
test('닫은 적이 없으면 보여준다', () => {
  assert.equal(shouldShowBanner(null, Date.now()), true);
});

test('닫은 직후에는 다시 띄우지 않는다', () => {
  const now = Date.now();
  assert.equal(shouldShowBanner(String(now), now), false);
  assert.equal(shouldShowBanner(String(now - 1000), now), false);
  assert.equal(shouldShowBanner(String(now - DISMISS_COOLDOWN_MS + 1000), now), false);
});

test('쿨다운이 지나면 다시 보여준다(영구 억제 아님)', () => {
  const now = Date.now();
  assert.equal(shouldShowBanner(String(now - DISMISS_COOLDOWN_MS), now), true);
  assert.equal(shouldShowBanner(String(now - DISMISS_COOLDOWN_MS - 1), now), true);
});

test('쿨다운은 14일이다', () => {
  assert.equal(DISMISS_COOLDOWN_MS, 14 * 24 * 60 * 60 * 1000);
});

test('저장값이 깨져 있으면 기능을 잃지 않고 보여준다', () => {
  const now = Date.now();
  assert.equal(shouldShowBanner('abc', now), true);
  assert.equal(shouldShowBanner('', now), true);
  assert.equal(shouldShowBanner('0', now), true);
  assert.equal(shouldShowBanner('-5', now), true);
  // 시계가 뒤로 간 경우(미래 타임스탬프)도 막히지 않는다.
  assert.equal(shouldShowBanner(String(now + 999999), now), true);
});

// ── 안내 문구 (§7/§8) ──────────────────────────────────────────────────────
test('iOS 안내는 공유 시트 경로를 알려준다', () => {
  const g = installGuideFor('IOS_SAFARI')!;
  assert.ok(g.title.includes('홈 화면에 추가'));
  assert.equal(g.steps.length, 3);
  assert.ok(g.steps[0].includes('공유'));
});

test('카카오 안내는 외부 브라우저로 유도하고 원탭 설치를 주장하지 않는다', () => {
  const g = installGuideFor('KAKAO_INAPP')!;
  assert.ok(/Safari|Chrome/.test(g.title));
  assert.equal(/설치하기|바로 설치/.test(g.title), false);
});

test('설치됨/미지원에는 안내 문구가 없다', () => {
  assert.equal(installGuideFor('INSTALLED'), null);
  assert.equal(installGuideFor('PROMPTABLE'), null);
  assert.equal(installGuideFor('UNSUPPORTED'), null);
});
