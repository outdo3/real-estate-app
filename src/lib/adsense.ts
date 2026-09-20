// ADSENSE_CONNECTION_V1 — AdSense 사이트 소유권 확인용 상수.
//
// publisher ID는 비밀값이 아니다. 최종적으로 페이지 소스와 /ads.txt에 공개되는 값이므로
// 환경변수로 감추지 않고 코드에 둔다 — 감추면 오히려 두 곳(스크립트·ads.txt)이 어긋날 때
// 알아채기 어렵다.
//
// 형식이 두 가지라는 점이 함정이다:
//   - 스크립트 client 파라미터: `ca-pub-…`
//   - ads.txt 한 줄:            `pub-…`   ← ca- 접두사가 **없다**
// 그래서 한 곳에서 파생시킨다.

/** AdSense 스크립트의 client 파라미터에 쓰는 형식. */
export const ADSENSE_CLIENT_ID = 'ca-pub-3291272948162277';

/** ads.txt에 쓰는 형식 — `ca-` 접두사를 뗀 값. */
export const ADSENSE_PUBLISHER_ID = ADSENSE_CLIENT_ID.replace(/^ca-/, '');

/** 공식 로더 URL. */
export const ADSENSE_SCRIPT_SRC =
  `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`;

/** ads.txt 정식 한 줄(공급자, publisher, 관계, 인증기관 ID). */
export const ADSENSE_ADS_TXT_LINE =
  `google.com, ${ADSENSE_PUBLISHER_ID}, DIRECT, f08c47fec0942fa0`;
