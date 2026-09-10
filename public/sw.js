// PWA_INSTALL_UX_V1 — 설치 가능 요건을 충족하기 위한 **최소** 서비스 워커.
//
// 의도적으로 아무것도 캐시하지 않는다.
//
// 왜: 브라우저는 설치 가능 판정에 fetch 핸들러를 가진 서비스 워커를 요구한다.
// 하지만 캐싱을 시작하면 실거래 데이터/리포트가 낡은 채로 굳을 수 있고, 이 앱은
// "낡은 데이터를 보여주지 않는다"가 제품 원칙이다(AGENTS.md 데이터 진실성).
// 그래서 fetch는 네트워크로 그대로 통과시킨다 — 오프라인 지원은 이 STEP의 범위가
// 아니며, 필요해지면 별도 STEP에서 캐시 전략을 설계해야 한다.
//
// skipWaiting/clients.claim으로 새 워커가 즉시 활성화되게 해, 배포 후 낡은 워커가
// 남아 도는 상황을 만들지 않는다.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // 통과. respondWith를 부르지 않으면 브라우저 기본 동작이 그대로 쓰인다.
  // 핸들러의 존재 자체가 설치 요건을 충족시킨다.
  void event;
});
