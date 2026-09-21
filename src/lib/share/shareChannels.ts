// SHARE_UX_V2 §5/§6 — 공유 링크의 **오리진 규칙**. 순수 함수만 둔다(DOM 없음 → 테스트 가능).
//
// 왜 필요한가: 기존 buildShareUrl()은 `window.location.href`를 그대로 복사했다. 주소창이
// 곧 공유 링크였으므로 프리뷰 배포(`…-park11.vercel.app`)나 로컬(localhost:3000)에서 누른
// 공유는 **수신자가 열 수 없는 주소**를 보냈다. 카카오 카드도 같은 URL을 실어 보내므로
// 크롤링 이력이 없는 호스트의 OG를 긁어 카드가 깨졌다.
//
// 규칙은 하나다: 공유 링크의 오리진은 언제나 **프로덕션 정규 오리진**이다. 경로와
// 쿼리스트링(지역/기간/필터 등 화면 상태)은 지금 보고 있는 화면 그대로 보존한다.

import { CANONICAL_ORIGIN } from '@/config/canonical-host';

/** 배포마다 바뀌거나 외부에서 열 수 없는 호스트 — 공유 링크에 실어서는 안 된다. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function isEphemeralShareHost(host: string): boolean {
  // URL.hostname은 IPv6를 `[::1]`처럼 대괄호째 준다 — 벗겨내고 비교한다.
  const bare = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (!bare) return true;
  if (LOCAL_HOSTS.has(bare)) return true;
  // 프로덕션 기본 호스트와 프리뷰/배포별 호스트가 전부 여기에 해당한다.
  return /(^|\.)vercel\.app$/.test(bare);
}

/**
 * 공유 링크에 쓸 오리진. `configured`는 보통 siteConfig.url(=NEXT_PUBLIC_SITE_URL).
 *
 * https이고 일시적 호스트가 아니면 그 값을 쓴다(환경변수 하나로 도메인을 옮길 수 있게).
 * 그 밖의 모든 경우 — 값이 없거나, http이거나, vercel.app이거나, localhost이거나 —
 * 에는 정규 오리진으로 내려간다. **현재 주소창을 절대 폴백으로 쓰지 않는다**:
 * 그 폴백이 바로 프리뷰/로컬 주소가 새어나가던 경로였다.
 */
export function resolveCanonicalShareOrigin(configured: string | null | undefined): string {
  const trimmed = (configured || '').trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(trimmed)) {
    try {
      if (!isEphemeralShareHost(new URL(trimmed).hostname)) return trimmed;
    } catch {
      // 파싱 불가 → 정규 오리진
    }
  }
  return CANONICAL_ORIGIN;
}

/** 오리진 + 경로 + 쿼리를 합친다. 경로/쿼리는 호출부가 준 것을 그대로 보존한다. */
export function joinShareUrl(origin: string, pathname: string, search = ''): string {
  const base = origin.replace(/\/+$/, '');
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const query = !search || search === '?' ? '' : search.startsWith('?') ? search : `?${search}`;
  return `${base}${path}${query}`;
}

/**
 * 호출부가 직접 만든 URL(비교 화면의 canonical 링크 등)의 **오리진만** 정규 오리진으로
 * 바꾼다. 경로·쿼리·해시는 건드리지 않는다. 절대 URL이 아니면 경로로 보고 이어붙인다.
 */
export function withCanonicalOrigin(rawUrl: string, origin: string): string {
  const url = (rawUrl || '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${origin.replace(/\/+$/, '')}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return joinShareUrl(origin, url);
  }
}

/**
 * §4 — 이 환경에서 실제로 쓸 수 있는 공유 채널.
 *
 * "쓸 수 없는 채널은 아예 보여주지 않는다"가 원칙이다. 눌러도 아무 일이 없는 버튼
 * (PC Firefox의 navigator.share 등)은 링크 복사보다 나쁘다.
 */
export interface ShareChannelAvailability {
  kakao: boolean;
  native: boolean;
  copy: boolean;
}

export function resolveShareChannels(input: {
  kakaoReady: boolean;
  hasNativeShare: boolean;
}): ShareChannelAvailability {
  return {
    kakao: input.kakaoReady,
    native: input.hasNativeShare,
    // 링크 복사는 **언제나** 남긴다. 클립보드 API가 없거나 거부돼도 URL을 그대로
    // 보여줘 사용자가 손으로 복사할 수 있게 한다(§7) — 막다른 골목을 만들지 않는다.
    copy: true,
  };
}
