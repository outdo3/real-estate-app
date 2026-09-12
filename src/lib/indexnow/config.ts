// INDEXNOW_V1 §2/§3 — IndexNow 설정의 **단일 출처**.
//
// ── 키는 비밀이 아니다 ──────────────────────────────────────────────────────
// IndexNow의 소유 확인 방식 자체가 "이 키를 사이트 루트에 공개 텍스트 파일로 올려라"다.
// 즉 키는 누구나 읽을 수 있어야 정상 동작한다. 그래서 NEXTAUTH_SECRET이나 OAuth
// client secret 같은 진짜 비밀과 **같은 취급을 하지 않는다**(§7).
//
// 그렇다고 로그에 굳이 찍지도 않는다 — 공개값이라는 게 "아무 데나 뿌려도 된다"는 뜻은
// 아니고, 키가 바뀌었을 때 옛 값이 로그에 남아 혼란을 주기 때문이다.
//
// ── 값을 어디서 읽나 ────────────────────────────────────────────────────────
// 환경변수 INDEXNOW_KEY 하나다. 코드에 박지 않는 이유는 비밀이라서가 아니라, 키 파일
// 이름(`<key>.txt`)과 제출 페이로드가 **같은 값**을 써야 하는데 출처가 둘이면 조용히
// 갈라지기 때문이다. 키 파일은 scripts/indexnow/write-key-file.ts가 이 값으로 만든다.

import { siteConfig } from '@/config/site';

/** IndexNow 키. 설정되지 않았으면 빈 문자열이고, 그때는 제출을 시도하지 않는다. */
export function indexNowKey(): string {
  return (process.env.INDEXNOW_KEY ?? '').trim();
}

/**
 * IndexNow 키 형식 검증.
 *
 * 규격: 8~128자, 영숫자와 하이픈만. 형식이 틀린 키로 제출하면 422가 돌아오는데,
 * 그걸 네트워크 왕복 뒤에 알기보다 보내기 전에 거르는 편이 낫다.
 */
export function isValidIndexNowKey(key: string): boolean {
  return /^[A-Za-z0-9-]{8,128}$/.test(key);
}

/**
 * 제출 대상 호스트. siteConfig(= NEXT_PUBLIC_SITE_URL)에서만 나온다 — 호스트를 여기
 * 박지 않는다.
 *
 * **https가 아니면 null이다.** 로컬 개발(localhost)에서 실수로 제출이 나가는 것을
 * 막는다. 검색엔진에 localhost URL을 통지하는 건 의미가 없을 뿐 아니라, 키 파일도
 * 공개되지 않으므로 어차피 거부당한다.
 */
export function indexNowHost(): string | null {
  try {
    const url = new URL(siteConfig.url);
    if (url.protocol !== 'https:') return null;
    return url.hostname;
  } catch {
    return null;
  }
}

/** 키 파일의 공개 주소. IndexNow가 이 URL을 열어 키를 대조한다. */
export function indexNowKeyLocation(key: string = indexNowKey()): string | null {
  const host = indexNowHost();
  if (!host || !isValidIndexNowKey(key)) return null;
  return `https://${host}/${key}.txt`;
}

/** 지금 제출이 가능한 상태인가(키 형식 + https 호스트). */
export function isIndexNowConfigured(): boolean {
  return isValidIndexNowKey(indexNowKey()) && indexNowHost() !== null;
}

/** IndexNow 엔드포인트. Bing·Naver·Yandex 등 참여 엔진이 이 하나를 공유한다. */
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/** 한 요청에 담을 수 있는 URL 수 상한(IndexNow 규격). */
export const INDEXNOW_MAX_URLS_PER_REQUEST = 10_000;

/**
 * 색인 대상이 아닌 경로. robots.txt의 Disallow와 같은 의도이며, 사이트맵에 없어야 할
 * 것들이 혹시 섞여 들어와도 제출되지 않도록 한 겹 더 막는다(§4).
 */
export const INDEXNOW_EXCLUDED_PREFIXES = ['/api/', '/admin', '/my', '/community/write'] as const;
