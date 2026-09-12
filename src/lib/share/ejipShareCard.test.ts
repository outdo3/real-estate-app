import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { nativeShare } from './shareUtils';
import {
  EJIP_SHARE_CTA,
  EjipShareCardError,
  REPORT_SHARE_DESCRIPTION,
  STATS_SHARE_DESCRIPTION,
  apartmentShareCopy,
  buildEjipKakaoShare,
  compareShareCopy,
  isAbsoluteHttpUrl,
  reportShareCopy,
  statsShareCopy,
  stripUrls,
  withEjipSuffix,
} from './ejipShareCard';

/**
 * SHARE_CARD_UNIFICATION_V1 §20 — 브랜드 카카오 공유 카드 계약.
 *
 * 배경: 같은 "공유" 버튼인데 아파트 상세만 브랜드 카드가 뜨고 비교/통계/리포트는
 * 일반 OG 미리보기가 떴다. 카드 능력의 차이가 아니라 **호출 순서**의 차이였다
 * (useSharePage가 navigator.share를 먼저 호출 → 모바일에는 navigator.share가 항상
 * 있으므로 카카오 분기에 영영 도달하지 못함). 이 테스트는 통일된 카드 모양과 그
 * 순서를 함께 고정한다.
 */

const ORIGIN = 'https://e-jip.com';
const IMAGE = `${ORIGIN}/brand/share/ejip-kakao-share-1200x630.jpg`;

const base = {
  imageUrl: IMAGE,
  canonicalUrl: `${ORIGIN}/stats/compare?a=26140-1356&b=26140-2000`,
};

// ── A. 빌더 기본 모양 ───────────────────────────────────────────────────────

test('§3 빌더는 카카오 feed 템플릿을 만든다 — 이미지·제목·설명·CTA 버튼', () => {
  const card = buildEjipKakaoShare({
    ...base,
    type: 'apartment',
    title: '대신해모로',
    description: '대신해모로의 실거래, 가격, 입지 정보를 확인해보세요.',
  });
  assert.equal(card.objectType, 'feed');
  assert.equal(card.content.imageUrl, IMAGE);
  assert.equal(card.content.title, '대신해모로 | 이집');
  assert.equal(card.content.description, '대신해모로의 실거래, 가격, 입지 정보를 확인해보세요.');
  assert.equal(card.buttons.length, 1, 'CTA 버튼은 정확히 하나다');
  assert.equal(card.buttons[0].title, '이집에서 자세히 보기');
});

test('§3 카드 링크와 CTA 링크는 같은 canonical URL을 가리킨다', () => {
  const card = buildEjipKakaoShare({ ...base, type: 'compare', title: 'A vs B', description: '설명' });
  assert.equal(card.content.link.webUrl, base.canonicalUrl);
  assert.equal(card.content.link.mobileWebUrl, base.canonicalUrl);
  assert.equal(card.buttons[0].link.webUrl, base.canonicalUrl);
  assert.equal(card.buttons[0].link.mobileWebUrl, base.canonicalUrl);
});

// ── B. CTA 라벨(§9) ────────────────────────────────────────────────────────

test('§9 type마다 전용 CTA 라벨을 쓴다 — 일반 문구("웹으로 보기")가 없다', () => {
  assert.equal(EJIP_SHARE_CTA.apartment, '이집에서 자세히 보기');
  assert.equal(EJIP_SHARE_CTA.stats, '이집에서 통계 보기');
  assert.equal(EJIP_SHARE_CTA.compare, '이집에서 비교 보기');
  assert.equal(EJIP_SHARE_CTA.report, '이집에서 리포트 보기');
  for (const label of Object.values(EJIP_SHARE_CTA)) {
    assert.ok(label.startsWith('이집에서'), `CTA에 브랜드가 빠졌다: ${label}`);
    assert.ok(!/웹으로 보기/.test(label));
  }
});

test('§9 각 type의 카드가 자기 CTA를 달고 나온다', () => {
  for (const type of ['apartment', 'stats', 'compare', 'report', 'generic'] as const) {
    const card = buildEjipKakaoShare({ ...base, type, title: '제목', description: '설명' });
    assert.equal(card.buttons[0].title, EJIP_SHARE_CTA[type]);
  }
});

// ── C. 절대 URL(§10) ───────────────────────────────────────────────────────

test('§10 canonical URL이 절대 URL이 아니면 던진다 — 깨진 카드를 보내지 않는다', () => {
  assert.throws(
    () =>
      buildEjipKakaoShare({
        ...base,
        canonicalUrl: '/stats/compare?a=1&b=2',
        type: 'compare',
        title: 'T',
        description: 'D',
      }),
    EjipShareCardError
  );
});

test('§10 이미지 URL이 절대 URL이 아니면 던진다', () => {
  assert.throws(
    () =>
      buildEjipKakaoShare({
        ...base,
        imageUrl: '/brand/share/ejip-kakao-share-1200x630.jpg',
        type: 'stats',
        title: 'T',
        description: 'D',
      }),
    EjipShareCardError
  );
});

test('§10 절대 URL 판정', () => {
  assert.ok(isAbsoluteHttpUrl('https://e-jip.com/apt/x'));
  assert.ok(isAbsoluteHttpUrl('http://localhost:3000/apt/x'));
  assert.ok(!isAbsoluteHttpUrl('/apt/x'));
  assert.ok(!isAbsoluteHttpUrl('e-jip.com/apt/x'));
  assert.ok(!isAbsoluteHttpUrl(''));
});

// ── D. 문구 위생(§14/§22) ──────────────────────────────────────────────────

test('§14 설명에 URL을 심지 않는다 — 링크는 link 필드에만 있다', () => {
  const card = buildEjipKakaoShare({
    ...base,
    type: 'report',
    title: '리포트',
    description: `핵심 데이터를 한 장으로 확인해보세요. ${ORIGIN}/report/apt/26140-1356`,
  });
  assert.ok(!/https?:/.test(card.content.description), `설명에 URL이 남았다: ${card.content.description}`);
  assert.equal(card.content.description, '핵심 데이터를 한 장으로 확인해보세요.');
});

test('§14 stripUrls는 URL만 지우고 나머지 문장은 그대로 둔다', () => {
  assert.equal(stripUrls('두 단지를 비교해보세요. https://e-jip.com/stats/compare?a=1&b=2'), '두 단지를 비교해보세요.');
  assert.equal(stripUrls('두 단지를 비교해보세요.'), '두 단지를 비교해보세요.');
});

test('§22 브랜드 접미사는 정확히 한 번만 붙는다 — 중복 브랜드가 생기지 않는다', () => {
  assert.equal(withEjipSuffix('대신해모로'), '대신해모로 | 이집');
  assert.equal(withEjipSuffix('대신해모로 | 이집'), '대신해모로 | 이집');
  assert.equal(withEjipSuffix('대신해모로 | 이집 | 이집'), '대신해모로 | 이집');
  // 기존 호출부에 섞여 있던 '- 이집' 형태도 하나로 정규화된다.
  assert.equal(withEjipSuffix('개금초등학교 - 이집'), '개금초등학교 | 이집');
  assert.equal(withEjipSuffix('부산 서구 한장 브리핑 | 이집'), '부산 서구 한장 브리핑 | 이집');
});

test('§22 문구 헬퍼는 사람이 읽는 이름만 받는다 — 기술 식별자가 낄 자리가 없다', () => {
  assert.equal(apartmentShareCopy.length, 1);
  assert.equal(compareShareCopy.length, 2);
});

// ── E. 표면별 문구(§5~§8) ──────────────────────────────────────────────────

test('§5 아파트 상세 문구', () => {
  const copy = apartmentShareCopy('대신해모로');
  assert.equal(copy.title, '대신해모로 | 이집');
  assert.equal(copy.description, '대신해모로의 실거래, 가격, 입지 정보를 확인해보세요.');
});

test('§6 비교 문구', () => {
  const copy = compareShareCopy('대신해모로', '대신더샵');
  assert.equal(copy.title, '대신해모로 vs 대신더샵 비교 | 이집');
  assert.equal(copy.description, '두 단지의 실거래·가격·입지 데이터를 비교해보세요.');
  assert.ok(!/https?:|aptSeq|26140/.test(copy.title + copy.description));
});

test('§7 통계 문구 — subtitle이 있으면 그게 더 정확하므로 우선한다', () => {
  assert.equal(statsShareCopy('부산 서구 실거래 흐름', '최근 실거래를 한눈에').description, '최근 실거래를 한눈에');
  assert.equal(statsShareCopy('부산 서구 실거래 흐름').description, STATS_SHARE_DESCRIPTION);
  assert.equal(statsShareCopy('부산 서구 실거래 흐름 | 이집').title, '부산 서구 실거래 흐름 | 이집');
});

test('§8 리포트 문구', () => {
  assert.equal(reportShareCopy('대신해모로 단지 리포트').title, '대신해모로 단지 리포트 | 이집');
  assert.equal(reportShareCopy('대신해모로 단지 리포트').description, REPORT_SHARE_DESCRIPTION);
  assert.equal(REPORT_SHARE_DESCRIPTION, '핵심 데이터를 한 장으로 확인해보세요.');
});

// ── F. 배선 계약 — 코드가 실제로 이 빌더를 통과하는가 ───────────────────────

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 설계를 설명하느라 금지 토큰을 언급할 수 있다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const UTILS = read('src/lib/share/shareUtils.ts');
const HOOK = read('src/hooks/useSharePage.ts');
const KAKAO_BTN = read('src/components/KakaoShareButton.tsx');
const REPORT = read('src/components/report/ReportActions.tsx');
const COMPARE = read('src/components/compare/CompareV2.tsx');

test('§3 카카오 카드를 조립하는 곳은 빌더 하나뿐이다 — 화면마다 복붙하지 않는다', () => {
  const callers = [
    ['useSharePage', HOOK],
    ['KakaoShareButton', KAKAO_BTN],
    ['ReportActions', REPORT],
    ['CompareV2', COMPARE],
  ] as const;
  for (const [name, src] of callers) {
    assert.ok(!/sendDefault|objectType/.test(codeOf(src)), `${name}이 카카오 템플릿을 직접 만든다`);
  }
  assert.ok(/buildEjipKakaoShare\(/.test(UTILS), 'shareUtils가 공통 빌더를 쓰지 않는다');
  assert.ok(/window\.Kakao\.Share\.sendDefault\(payload\)/.test(UTILS));
});

test('§2-A 카카오 브랜드 카드가 네이티브 공유보다 먼저 시도된다 — 두 화면이 갈렸던 원인', () => {
  const surfaces = [
    ['useSharePage', HOOK],
    ['KakaoShareButton', KAKAO_BTN],
    ['ReportActions', REPORT],
  ] as const;
  for (const [name, src] of surfaces) {
    const kakaoAt = src.indexOf('sendKakaoShare(');
    const nativeAt = Math.max(src.indexOf('nativeShare('), src.indexOf('navigator.share('));
    assert.ok(kakaoAt > -1, `${name}에 카카오 경로가 없다`);
    assert.ok(nativeAt > -1, `${name}에 네이티브 공유 폴백이 없다`);
    assert.ok(kakaoAt < nativeAt, `${name}에서 네이티브 공유가 카카오 카드보다 먼저다`);
  }
});

test('§16 카카오 실패가 죽은 버튼이 되지 않는다 — 네이티브 공유/링크 복사로 이어진다', () => {
  assert.ok(/nativeShare\(\{ title, text, url \}\)/.test(HOOK));
  assert.ok(/copyToClipboard\(url\)/.test(HOOK));
  assert.ok(/copyToClipboard\(url\)/.test(KAKAO_BTN));
  assert.ok(/clipboard\.writeText\(url\)/.test(REPORT));
});

test('§15 분석 이벤트가 그대로 남아 있다', () => {
  assert.ok(/trackEvent\('share_attempt'\)/.test(HOOK));
  assert.ok(/trackEvent\('share_success'\)/.test(HOOK));
  assert.ok(/trackEvent\('report_share'/.test(REPORT));
  // 카카오는 전송 완료 콜백이 없으므로 success로 기록하지 않는다.
  const hookCode = codeOf(HOOK);
  const kakaoBlock = hookCode.slice(hookCode.indexOf('sendKakaoShare('), hookCode.indexOf('nativeShare('));
  assert.ok(!/share_success/.test(kakaoBlock), '확인할 수 없는 성공을 기록한다');
});

test('§15 카카오 경로 분석에 PII가 실리지 않는다', () => {
  const kakaoAnalytics = REPORT.slice(REPORT.indexOf("type: 'report'"), REPORT.indexOf("method: 'kakao_card'") + 60);
  assert.ok(!/apt_name|aptSeq|displayName|email|phone/.test(kakaoAnalytics));
});

test('§10/§11 공유 오리진은 siteConfig에서 나온다 — 호스트를 코드에 박지 않는다', () => {
  assert.ok(/siteConfig\.url/.test(UTILS), 'shareUtils가 siteConfig를 쓰지 않는다');
  const code = UTILS.replace(/^\s*(\/\/.*|\*.*|\/\*.*)$/gm, '');
  assert.ok(!/vercel\.app|e-jip\.com/.test(code), 'shareUtils에 호스트가 박혀 있다');
  // 이미지 경로는 이미 브랜드 카드로 검증된 그 자산 하나다(§4 — 두 번째 브랜드 이미지 금지).
  assert.ok(/KAKAO_SHARE_IMAGE_PATH = '\/brand\/share\/ejip-kakao-share-1200x630\.jpg'/.test(UTILS));
  assert.ok(/absoluteShareUrl\(KAKAO_SHARE_IMAGE_PATH\)/.test(UTILS));
});

test('§10 NEXT_PUBLIC_SITE_URL이 없는 클라이언트 번들에서 localhost가 새어나가지 않는다', () => {
  const fn = UTILS.slice(UTILS.indexOf('export function resolveShareOrigin'), UTILS.indexOf('/** resolveShareOrigin() 기준'));
  assert.ok(/\^https:/.test(fn), 'https 오리진 우선 규칙이 없다');
  assert.ok(/window\.location\.origin/.test(fn), 'localhost 폴백 보호가 없다');
});

test('§12 Open Graph 폴백을 지운 게 아니다 — 메신저/검색엔진용 메타데이터는 그대로다', () => {
  const LAYOUT = read('src/app/layout.tsx');
  assert.ok(/openGraph/.test(LAYOUT));
  assert.ok(/brand\/og\/ejip-og-main-1200x630\.jpg/.test(LAYOUT));
});

test('§19 비교 공유 URL은 여전히 aptSeq 둘뿐이다 — 긴 한글 쿼리가 돌아오지 않았다', () => {
  const shareLine = COMPARE.slice(COMPARE.indexOf('const sharePath = both'), COMPARE.indexOf('const shareUrl ='));
  for (const forbidden of ['aName', 'aLawdCd', 'aDong', 'bName', 'bLawdCd', 'bDong', 'displayName']) {
    assert.ok(!shareLine.includes(forbidden), `공유 경로에 ${forbidden}가 다시 들어갔다`);
  }
  assert.ok(/buildCompareSharePath\(/.test(shareLine));
  assert.ok(/absoluteShareUrl\(sharePath\)/.test(COMPARE));
});

// ── H. 공유 시트 취소(COMPARE_SHARE_URL_COMPACT_FIX_V1 §4) ─────────────────

/**
 * 사용자가 OS 공유 시트를 닫는 것은 **실패가 아니다.** 이 구분이 없으면 그냥 마음을
 * 바꿔 닫은 사람에게 "공유 실패" 토스트가 뜬다.
 *
 * 동작은 처음부터 옳았지만 고정된 테스트가 없었다 — 여기서 묶는다.
 */
async function withNavigatorShare<T>(
  impl: () => Promise<void>,
  run: () => Promise<T>
): Promise<T> {
  const nav = globalThis.navigator as unknown as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(nav, 'share');
  const prev = nav.share;
  Object.defineProperty(nav, 'share', { value: impl, configurable: true, writable: true });
  try {
    return await run();
  } finally {
    if (had) Object.defineProperty(nav, 'share', { value: prev, configurable: true, writable: true });
    else delete nav.share;
  }
}

test('§4 공유 시트를 닫으면(AbortError) 실패가 아니라 정상 취소다', async () => {
  const result = await withNavigatorShare(
    async () => {
      const e = new Error('user cancelled');
      e.name = 'AbortError';
      throw e;
    },
    () => nativeShare({ title: 'T', text: 'D', url: 'https://e-jip.com/stats/compare?a=1-1&b=1-2' })
  );
  assert.equal(result, 'aborted', '취소를 실패로 분류한다');
});

test('§4 진짜 실패는 failed로 구분된다', async () => {
  const result = await withNavigatorShare(
    async () => {
      throw new Error('NotAllowedError');
    },
    () => nativeShare({ title: 'T', text: 'D', url: 'https://e-jip.com/' })
  );
  assert.equal(result, 'failed', '실패를 취소로 뭉갠다');
});

test('§4 공유가 성공하면 shared다', async () => {
  const result = await withNavigatorShare(
    async () => {},
    () => nativeShare({ title: 'T', text: 'D', url: 'https://e-jip.com/' })
  );
  assert.equal(result, 'shared');
});

test('§4 취소는 오류 상태로 넘어가지 않고, 집계도 남기지 않는다', () => {
  const code = codeOf(HOOK);
  const at = code.indexOf("nativeResult === 'aborted'");
  assert.ok(at > -1, '취소 분기가 없다');
  // 취소 분기는 곧바로 return한다 — 아래의 clipboard/error 경로로 내려가지 않는다.
  const block = code.slice(at, at + 120);
  assert.ok(/return;/.test(block), '취소가 폴백 경로로 흘러간다');
  assert.ok(!/setStatus\('error'\)|trackEvent/.test(block), '취소를 실패로 기록한다');
});
