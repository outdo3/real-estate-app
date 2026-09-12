// INDEXNOW_V1 §3/§6 — IndexNow 제출 클라이언트.
//
// ── 이 함수가 뜻하는 것 / 뜻하지 않는 것(§6) ────────────────────────────────
// 성공 응답(200/202)은 **"검색엔진에 URL이 바뀌었다고 통지했다"**는 뜻이다.
// 색인됐다는 뜻이 **아니다.** 크롤링 여부, 색인 여부, 순위는 전부 검색엔진의 별도
// 판단이고 IndexNow는 거기에 관여하지 않는다. 그래서 반환 타입의 이름도 `SUBMITTED`
// (제출함)이지 `INDEXED`(색인됨)가 아니다.
//
// ── 절대 던지지 않는다(§3) ──────────────────────────────────────────────────
// 이 함수는 커뮤니티 글 발행 같은 사용자 요청 흐름에 붙을 수 있다. 검색엔진 통지가
// 실패했다고 해서 글 발행이 실패하면 안 된다. 그래서 모든 실패를 값으로 돌려준다.

import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_EXCLUDED_PREFIXES,
  INDEXNOW_MAX_URLS_PER_REQUEST,
  indexNowHost,
  indexNowKey,
  indexNowKeyLocation,
  isValidIndexNowKey,
} from './config';

export type IndexNowResult =
  /** 키가 없거나 형식이 틀렸거나, 오리진이 https가 아니다(로컬 개발 등). 요청을 보내지 않았다. */
  | { status: 'NOT_CONFIGURED'; reason: string }
  /** 제출할 수 있는 URL이 하나도 남지 않았다(전부 걸러짐). 요청을 보내지 않았다. */
  | { status: 'NO_URLS'; rejected: string[] }
  /** 통지를 보냈다. **색인됐다는 뜻이 아니다**(§6). */
  | { status: 'SUBMITTED'; submitted: number; batches: number; httpStatuses: number[]; rejected: string[] }
  /** 네트워크/엔드포인트 실패. 호출부의 동작을 막지 않는다. */
  | { status: 'FAILED'; reason: string; httpStatuses: number[]; rejected: string[] };

/**
 * 제출 가능한 URL만 남긴다.
 *
 *  - 우리 호스트(siteConfig 오리진)의 URL만 허용한다. localhost·*.vercel.app·외부
 *    도메인은 전부 거부한다 — 남의 사이트 URL을 제출하면 키 소유 검증에서 막히고,
 *    애초에 우리가 통지할 자격이 없다.
 *  - http는 거부한다(우리 사이트는 https다).
 *  - 색인 대상이 아닌 경로(/api/, /admin, /my, /community/write)를 거른다.
 *  - 중복을 제거한다. 순서는 처음 등장 순서를 유지한다(결정론적 출력).
 */
export function filterSubmittableUrls(
  urls: readonly string[],
  host: string | null = indexNowHost()
): { accepted: string[]; rejected: string[] } {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    const value = (raw ?? '').trim();
    if (!value) continue;

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      rejected.push(value);
      continue;
    }

    if (!host || parsed.protocol !== 'https:' || parsed.hostname !== host) {
      rejected.push(value);
      continue;
    }
    if (INDEXNOW_EXCLUDED_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) {
      rejected.push(value);
      continue;
    }
    // 정규화한 형태로 중복을 본다 — 같은 URL이 두 번 들어가면 제출 수만 부풀고
    // 검색엔진 입장에서도 같은 통지다.
    const normalized = parsed.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    accepted.push(normalized);
  }

  return { accepted, rejected };
}

/** 규격 상한(10,000)에 맞춰 나눈다. */
export function batchUrls(urls: readonly string[], size: number = INDEXNOW_MAX_URLS_PER_REQUEST): string[][] {
  if (urls.length === 0) return [];
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += size) batches.push(urls.slice(i, i + size));
  return batches;
}

/**
 * IndexNow에 URL 변경을 통지한다.
 *
 * 반환값은 **통지 결과**이지 색인 결과가 아니다(§6).
 */
export async function submitIndexNow(
  urls: readonly string[],
  options: { fetchImpl?: typeof fetch } = {}
): Promise<IndexNowResult> {
  const key = indexNowKey();
  const host = indexNowHost();
  const keyLocation = indexNowKeyLocation(key);

  if (!isValidIndexNowKey(key)) {
    // 키 값 자체는 남기지 않는다(§7) — 설정 여부만 말한다.
    return { status: 'NOT_CONFIGURED', reason: 'INDEXNOW_KEY가 없거나 형식이 올바르지 않습니다.' };
  }
  if (!host || !keyLocation) {
    return {
      status: 'NOT_CONFIGURED',
      reason: '공개 https 오리진이 설정되지 않았습니다(NEXT_PUBLIC_SITE_URL 확인).',
    };
  }

  const { accepted, rejected } = filterSubmittableUrls(urls, host);
  if (accepted.length === 0) return { status: 'NO_URLS', rejected };

  const doFetch = options.fetchImpl ?? fetch;
  const batches = batchUrls(accepted);
  const httpStatuses: number[] = [];

  for (const batch of batches) {
    try {
      const res = await doFetch(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key, keyLocation, urlList: batch }),
      });
      httpStatuses.push(res.status);
      if (res.status >= 400) {
        // 본문에 키가 그대로 되돌아오는 경우가 있어 응답 본문을 로그/반환값에 싣지 않는다(§7).
        return {
          status: 'FAILED',
          reason: `IndexNow가 HTTP ${res.status}를 반환했습니다.`,
          httpStatuses,
          rejected,
        };
      }
    } catch (e) {
      return {
        status: 'FAILED',
        reason: e instanceof Error ? e.message : '네트워크 오류',
        httpStatuses,
        rejected,
      };
    }
  }

  return { status: 'SUBMITTED', submitted: accepted.length, batches: batches.length, httpStatuses, rejected };
}

/**
 * §5 — 앞으로 여기에 붙일 수 있는 지점(커뮤니티 글 발행/수정/삭제, 리포트 발행,
 * 향후 매물 등록 등). **지금은 붙이지 않는다** — 존재하지 않는 워크플로우에 가짜
 * 훅을 만들지 않는다. 그 흐름이 생기면 이 함수를 호출하면 되고, 실패해도 값으로
 * 돌아오므로 호출부를 깨뜨리지 않는다.
 *
 * 반복 제출 cron은 만들지 않는다(§5) — IndexNow는 "바뀐 것"을 알리는 통지이지
 * 전체 목록을 주기적으로 재전송하는 채널이 아니다.
 */
