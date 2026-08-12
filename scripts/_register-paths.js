// ts-node 실행 시 "@/*" alias(src/*)를 해석하기 위한 부트스트랩.
// tsconfig.json에는 baseUrl이 없어(Next.js 번들러 방식이라 불필요) tsconfig-paths가 파일을
// 직접 읽으면 스킵된다 — 그래서 프로그래밍 방식으로 register()를 호출한다. 앱의
// tsconfig.json 자체는 건드리지 않는다. scripts/ 폴더의 일회성 검증 스크립트 실행 전용.
require('tsconfig-paths').register({
  baseUrl: __dirname + '/..',
  paths: { '@/*': ['src/*'] },
});
