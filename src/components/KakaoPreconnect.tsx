'use client';

import ReactDOM from 'react-dom';

/**
 * PERCEIVED_PERFORMANCE_V2 §4 — 카카오 지도 SDK 호스트에 대한 연결을 미리 연다.
 *
 * 왜 필요한가(감사 V1 실측): 상세페이지에서 Kakao SDK 스크립트 요청이 9,684ms에야
 * 시작되고, 그 시점에 비로소 DNS → TCP → TLS 핸드셰이크가 일어난다. 그 연결 비용이
 * 지오코딩·버스 조회 전체를 뒤로 민다. `preconnect`는 요청을 미리 보내는 것이 아니라
 * **소켓만 미리 준비**하므로 데이터 전송량이 늘지 않고, 응답 내용도 바뀌지 않는다.
 *
 * 왜 root layout이 아니라 컴포넌트인가: 홈/커뮤니티처럼 카카오를 전혀 쓰지 않는
 * 화면에서까지 연결을 여는 것은 "추측성 서드파티 연결"이라 §4 지시에 어긋난다.
 * 실제로 SDK를 쓰는 화면(아파트 상세, 지도)에서만 렌더한다.
 *
 * 호스트 두 개의 역할이 다르다:
 *   dapi.kakao.com   — SDK 스크립트 + Local(지오코딩/장소검색) REST. 두 화면 모두 사용.
 *   mts.daumcdn.net  — 지도 타일 이미지. 지도를 실제로 그리는 화면에서만 사용.
 * 그래서 타일 호스트는 `withTiles`로 옵트인한다(상세페이지는 지도 모달을 열기 전까지
 * 타일을 받지 않으므로 기본값은 끈다 — 열지 않는 사용자에게는 불필요한 연결이다).
 *
 * Next.js 16.3 App Router에서 resource hint를 넣는 공식 방법은 ReactDOM 메서드다
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md
 *  "Resource hints" 참고 — Metadata API는 preconnect를 직접 지원하지 않는다).
 */
export default function KakaoPreconnect({ withTiles = false }: { withTiles?: boolean }) {
  // SDK 스크립트와 Local REST 응답 모두 crossOrigin 없이 요청되므로, 핸드셰이크가
  // 재사용되도록 익명 연결이 아닌 기본(same-mode) preconnect를 연다.
  ReactDOM.preconnect('https://dapi.kakao.com');
  if (withTiles) ReactDOM.preconnect('https://mts.daumcdn.net');
  return null;
}
