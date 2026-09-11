'use client';

import { isQaSuppressed } from '@/lib/analytics/qa-suppression';

/**
 * GA4_INTEGRATION_V1 — GA4(마케팅/유입 분석) 클라이언트.
 *
 * 이 파일은 기존 1st-party 분석(trackEvent → /api/log/event)을 **대체하지 않는다**.
 * 두 시스템은 의도적으로 분리돼 있다:
 *
 *   1st-party : 제품 분석(관리자 대시보드, 단지별 조회, 실시간 접속자)
 *   GA4       : 마케팅/유입/캠페인 분석(utm, referrer, 획득 채널)
 *
 * 그래서 GA4는 **절대 제품 기능의 선행 조건이 아니다**. Measurement ID가 없거나,
 * gtag.js가 광고 차단기에 막히거나, 네트워크가 실패해도 이 모듈의 모든 함수는
 * 조용히 no-op이 되고 예외를 던지지 않는다(§17).
 */

// Next가 빌드 시점에 인라인한다. 값이 없으면 GA4는 통째로 꺼진다.
const RAW_MEASUREMENT_ID = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? '').trim();
// 저장소의 기존 관례를 따른다(NEXT_PUBLIC_ADS_ENABLED / NEXT_PUBLIC_EJIP_PERF_DEBUG).
const GA_DEBUG = process.env.NEXT_PUBLIC_GA_DEBUG === 'true';

/** GA4 Measurement ID 형식. Universal Analytics(UA-)나 GTM(GTM-) 컨테이너는 받지 않는다. */
const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,24}$/;

export const GA_MEASUREMENT_ID = RAW_MEASUREMENT_ID;
export const GA_DEBUG_MODE = GA_DEBUG;

/** QA suppression 트리거가 주소창에서 지워지기 전에 스냅샷에 섞여 들어갈 수 있는 내부 파라미터. */
const INTERNAL_QUERY_PARAMS = ['__ejip_qa'] as const;

/**
 * GA4 이벤트 파라미터로 **보낼 수 있는 키의 전체 목록**(§10).
 *
 * denylist가 아니라 allowlist인 이유: denylist는 새 호출부가 생길 때마다 빠뜨릴 수
 * 있지만, allowlist는 "적지 않은 것은 나가지 않는다"가 기본값이다. 이름/이메일/전화/
 * 자유 텍스트는 이 목록에 없으므로 구조적으로 전송이 불가능하다.
 */
export const GA_PARAM_ALLOWLIST = [
  // pageview
  'page_path',
  'page_location',
  'page_title',
  // 제품 문맥(전부 고정 enum 또는 공개 행정코드 — 자유 텍스트 아님)
  'page_type',
  'report_type',
  'scope_type',
  'placement',
  'partner_type',
  'lawd_cd',
  'device_class',
  'source_surface',
  'method',
  'compare_count',
  // GA4 DebugView
  'debug_mode',
] as const;

export type GaParamKey = (typeof GA_PARAM_ALLOWLIST)[number];
export type GaParamValue = string | number | boolean;
export type GaEventParams = Partial<Record<GaParamKey, GaParamValue>>;

const ALLOWED_PARAM_KEYS = new Set<string>(GA_PARAM_ALLOWLIST);

/**
 * allowlist를 통과했더라도 **값 자체가** PII로 보이면 버린다(심층 방어).
 * search-redaction.ts와 같은 패턴 계열을 쓰되, 여기서는 마스킹이 아니라 드롭이다 —
 * GA4에는 애초에 보낼 이유가 없는 값이기 때문이다.
 */
const EMAIL_LIKE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_LIKE = /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/;

/** GA4 문자열 파라미터 값 상한(100자). 넘으면 GA4가 잘라내므로 우리가 먼저 자른다. */
const GA_PARAM_MAX_LENGTH = 100;

/** Measurement ID가 GA4 형식으로 설정돼 있는가. */
export function isGaConfigured(id: string = GA_MEASUREMENT_ID): boolean {
  return GA_MEASUREMENT_ID_PATTERN.test(id);
}

/**
 * 환경 기준으로 GA4를 켤지 판단한다(§18).
 *
 *  - Measurement ID가 없거나 형식이 틀리면       → 항상 OFF
 *  - production 빌드(Vercel production/preview) → ON
 *  - 로컬 `next dev`                             → OFF (NEXT_PUBLIC_GA_DEBUG=true로만 ON)
 *
 * 호스트명을 가정하지 않는다 — Vercel preview는 NODE_ENV가 production이라 그대로 켜지고,
 * 이는 배포 전 검증에 실제로 유용하다(§18).
 */
export function isGaEnvEnabled(
  id: string = GA_MEASUREMENT_ID,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  debug: boolean = GA_DEBUG
): boolean {
  if (!isGaConfigured(id)) return false;
  return nodeEnv === 'production' || debug;
}

/**
 * 실제 런타임 게이트. 환경 조건에 더해 **QA suppression 세션도 제외**한다 —
 * 1st-party 로그에서 빼는 운영자/QA 트래픽을 GA4에만 남기면 두 지표가 어긋난다.
 */
export function gaRuntimeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (!isGaEnvEnabled()) return false;
  return !isQaSuppressed();
}

/** 내부 전용 쿼리 파라미터만 제거한다. **utm_* 는 절대 건드리지 않는다**(§6/§21). */
export function stripInternalQueryParams(href: string): string {
  try {
    const url = new URL(href);
    let changed = false;
    for (const key of INTERNAL_QUERY_PARAMS) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (!changed) return href;
    const search = url.searchParams.toString();
    return `${url.origin}${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
  } catch {
    return href;
  }
}

/**
 * 유입 시점의 URL 스냅샷(§6).
 *
 * 왜 필요한가: `/map`은 지도가 준비된 뒤 400ms 디바운스로 `history.replaceState`를 써
 * 쿼리를 **지도 파라미터만으로 다시 만든다**(src/app/map/page.tsx). 즉 `?utm_source=...`로
 * 들어온 `/map` 랜딩은 잠시 뒤 주소창에서 utm이 사라진다. gtag.js는 afterInteractive로
 * 느리게 붙기 때문에, 그때 `window.location.href`를 읽으면 이미 utm이 지워진 뒤일 수
 * 있다. 그래서 **클라이언트 모듈이 평가되는 가장 이른 시점**에 원본 URL을 붙잡아 두고,
 * 첫 page_view는 이 스냅샷으로 보낸다.
 *
 * 지도의 URL 동기화 동작 자체는 바꾸지 않는다(이 STEP의 범위가 아니며, 뒤로가기 복원
 * 계약이 그 동작에 의존한다).
 */
const INITIAL_LOCATION_HREF: string | null =
  typeof window !== 'undefined' ? stripInternalQueryParams(window.location.href) : null;

export function getInitialLocationHref(): string | null {
  return INITIAL_LOCATION_HREF;
}

/**
 * GA4로 나가는 파라미터를 정제한다.
 *  - allowlist에 없는 키는 버린다
 *  - string/number/boolean이 아닌 값은 버린다
 *  - 빈 문자열은 버린다
 *  - 이메일/전화번호처럼 보이는 값은 버린다
 *  - 문자열은 100자로 자른다
 */
export function sanitizeGaParams(params: Record<string, unknown> | null | undefined): GaEventParams {
  if (!params) return {};
  const out: Record<string, GaParamValue> = {};
  for (const [key, raw] of Object.entries(params)) {
    if (!ALLOWED_PARAM_KEYS.has(key)) continue;
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) continue;
      out[key] = raw;
      continue;
    }
    if (typeof raw === 'boolean') {
      out[key] = raw;
      continue;
    }
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;
    if (EMAIL_LIKE.test(value) || PHONE_LIKE.test(value)) continue;
    out[key] = value.slice(0, GA_PARAM_MAX_LENGTH);
  }
  return out as GaEventParams;
}

/** page_view 페이로드(§5). 안전한 페이지 정보만 담는다. */
export function buildPageViewParams(href: string, title?: string | null): GaEventParams {
  const clean = stripInternalQueryParams(href);
  let pagePath = clean;
  try {
    const url = new URL(clean);
    pagePath = `${url.pathname}${url.search}`;
  } catch {
    // 절대 URL이 아니면 받은 값을 그대로 경로로 쓴다.
  }
  return sanitizeGaParams({
    page_path: pagePath,
    page_location: clean,
    page_title: title ?? undefined,
  });
}

/**
 * page_view 중복 방지기(§4).
 *
 * App Router에서 같은 경로로 effect가 두 번 도는 경우가 있다(개발 모드 StrictMode의
 * 이중 실행, 동일 경로 재렌더 등). 같은 page_path를 연속으로 보내면 GA4의 세션/이탈률이
 * 조용히 왜곡되므로 **직전에 보낸 경로와 같으면 보내지 않는다**.
 * 순수 팩토리로 두어 테스트에서 모듈 전역 상태 없이 검증할 수 있게 한다.
 */
export function createPageViewDeduper() {
  let last: string | null = null;
  return {
    shouldSend(pagePath: string): boolean {
      if (!pagePath || pagePath === last) return false;
      last = pagePath;
      return true;
    },
  };
}

const pageViewDeduper = createPageViewDeduper();

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * gtag 스텁을 보장한다.
 *
 * gtag.js(next/script, afterInteractive)는 비동기로 붙는다. 그 전에 발생한 이벤트를
 * 잃지 않도록, 공식 스니펫과 동일하게 dataLayer 큐와 gtag 함수를 먼저 만들어 둔다.
 * 라이브러리가 나중에 붙으면 큐에 쌓인 호출이 그대로 처리된다. 멱등하다.
 */
function ensureGtag(): ((...args: unknown[]) => void) | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!window.dataLayer) window.dataLayer = [];
    if (!window.gtag) {
      window.gtag = function gtagStub(...args: unknown[]) {
        window.dataLayer!.push(args);
      };
    }
    return window.gtag;
  } catch {
    return null;
  }
}

/**
 * 인라인 부트스트랩 스니펫(§3/§4).
 *
 * send_page_view:false — 자동 page_view를 끄고 수동으로만 보낸다. 자동/수동이 함께
 * 켜지면 최초 로드가 두 번 집계된다.
 */
export function gaInitScriptBody(id: string, debug: boolean): string {
  const config = debug ? `{ send_page_view: false, debug_mode: true }` : `{ send_page_view: false }`;
  return [
    'window.dataLayer = window.dataLayer || [];',
    'function gtag(){window.dataLayer.push(arguments);}',
    "gtag('js', new Date());",
    `gtag('config', '${id}', ${config});`,
  ].join('\n');
}

/** GA4 이벤트 1건. 실패해도 절대 throw하지 않는다(§17). */
export function gaEvent(name: string, params?: Record<string, unknown> | null): void {
  try {
    if (!name) return;
    if (!gaRuntimeEnabled()) return;
    const gtag = ensureGtag();
    if (!gtag) return;
    const safe = sanitizeGaParams(params);
    if (GA_DEBUG) safe.debug_mode = true;
    gtag('event', name, safe);
  } catch {
    // 분석이 제품을 막지 않는다.
  }
}

/**
 * page_view 1건. href를 명시하지 않으면 현재 주소를 쓴다.
 * 첫 page_view는 호출부가 유입 스냅샷(getInitialLocationHref)을 넘긴다.
 */
export function gaPageView(href?: string | null): void {
  try {
    if (!gaRuntimeEnabled()) return;
    const target = href ?? (typeof window !== 'undefined' ? window.location.href : null);
    if (!target) return;
    const params = buildPageViewParams(target, typeof document !== 'undefined' ? document.title : null);
    const pagePath = typeof params.page_path === 'string' ? params.page_path : '';
    if (!pageViewDeduper.shouldSend(pagePath)) return;
    const gtag = ensureGtag();
    if (!gtag) return;
    if (GA_DEBUG) params.debug_mode = true;
    gtag('event', 'page_view', params);
  } catch {
    // 분석이 제품을 막지 않는다.
  }
}
