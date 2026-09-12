// INDEXNOW_V1 §4 — 사이트맵에서 제출할 URL을 읽어내는 **순수** 파서.
//
// 왜 사이트맵을 원본으로 삼나: 색인 범위를 정하는 정책이 이미 한 곳에 있기 때문이다
// (BUSAN_LAUNCH_SCOPE_SITEMAP_FIX_V1 — 부산 16개 자치구·군만). IndexNow가 자기만의
// 목록을 따로 만들면 두 정책이 조용히 갈라지고, 사이트맵에서 뺀 지역이 IndexNow로는
// 계속 나가는 상황이 생긴다. 사이트맵이 곧 색인 대상이다.

/**
 * `<loc>` 값을 뽑아 XML 엔티티를 디코드한다.
 *
 * 디코드가 필요한 이유: 사이트맵의 지역 URL은 `?sido=...&amp;sigungu=...` 형태다.
 * `&amp;`는 XML에서 `&` 한 글자를 뜻하는 올바른 이스케이프이므로, 그대로 두고 제출하면
 * `amp;sigungu`라는 존재하지 않는 파라미터가 붙은 URL을 통지하게 된다.
 */
export function parseSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const re = /<loc>([\s\S]*?)<\/loc>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const decoded = decodeXmlEntities(match[1].trim());
    if (decoded) urls.push(decoded);
  }
  return urls;
}

/** 사이트맵 `<loc>`에 나타날 수 있는 다섯 가지 사전 정의 엔티티. */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // &amp;를 마지막에 푼다 — 먼저 풀면 `&amp;lt;` 같은 이중 이스케이프가 잘못 디코드된다.
    .replace(/&amp;/g, '&');
}

/** 출시 범위 시도. 사이트맵 정책과 같은 값이다. */
export const LAUNCH_SIDO = '부산광역시';

/**
 * §4 — 출시 범위 밖 지역 URL이 섞여 있는지 확인한다.
 *
 * 사이트맵은 이미 부산만 담고 있으므로 평소에는 빈 배열이 나온다. 이 검사는 나중에
 * 사이트맵 정책이 바뀌었을 때 **IndexNow가 조용히 따라가지 않도록** 막는 안전핀이다:
 * 전국 확장은 해당 지역이 데이터 신뢰 기준을 통과하고 사이트맵에 들어간 **뒤에**
 * 의도적으로 열어야 한다.
 */
export function findOutOfScopeRegionUrls(urls: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const url of urls) {
    let sido: string | null = null;
    try {
      sido = new URL(url).searchParams.get('sido');
    } catch {
      continue;
    }
    if (sido && sido !== LAUNCH_SIDO) offenders.push(url);
  }
  return offenders;
}
