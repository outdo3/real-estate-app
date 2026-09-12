import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LAUNCH_SIDO, buildLaunchRegionRoutes, regionQuery } from './sitemap-scope';
import { BUSAN_DISTRICTS } from './report/region-scope';
import { isInsideBusanBounds, BUSAN_BBOX } from './busan-bounds';

/**
 * BUSAN_LAUNCH_SCOPE_SITEMAP_FIX_V1 §10 — 출시 범위 색인 계약.
 *
 * 배포된 sitemap.xml에 서울 강남구 통계/학군 URL이 실려 있었다(실측 462개 URL 중
 * 지역 URL 약 460개가 전국 17개 시도에서 생성됨). 이집의 데이터는 부산이므로,
 * 검색엔진에 전국 서비스처럼 보이면서 사용자에게는 빈 화면을 주는 상태였다.
 */

const BUSAN = '부산광역시';
const SEOUL = '서울특별시';

// ── A. 부산은 들어가고, 그 외는 빠진다 ─────────────────────────────────────

test('§2 출시 범위 16개 자치구·군이 통계/학군 경로로 모두 들어간다', () => {
  const routes = buildLaunchRegionRoutes();
  assert.equal(BUSAN_DISTRICTS.length, 16, '부산 현행 자치구·군은 16개다');
  assert.equal(routes.length, 16 * 2, 'stats + school 두 경로가 구마다 하나씩');

  for (const d of BUSAN_DISTRICTS) {
    const encoded = encodeURIComponent(d.name);
    assert.ok(
      routes.some((r) => r.path.startsWith('/stats?') && r.path.includes(`sigungu=${encoded}`)),
      `${d.name} 통계 경로가 없다`
    );
    assert.ok(
      routes.some((r) => r.path.startsWith('/school?') && r.path.includes(`sigungu=${encoded}`)),
      `${d.name} 학군 경로가 없다`
    );
  }
});

test('§8 서울이 사이트맵에서 빠진다 — 이 STEP의 핵심 증거', () => {
  const paths = buildLaunchRegionRoutes().map((r) => r.path);
  const seoulEncoded = encodeURIComponent(SEOUL);
  for (const p of paths) {
    assert.ok(!p.includes(seoulEncoded), `서울 URL이 남아 있다: ${p}`);
    assert.ok(!p.includes(SEOUL), `서울 URL이 남아 있다(raw): ${p}`);
  }
  // 강남구는 부산에 없는 이름이므로 단독으로도 검증 가능하다.
  assert.ok(!paths.some((p) => p.includes(encodeURIComponent('강남구'))));
});

test('§7 부산 외 시도는 하나도 들어가지 않는다', () => {
  const paths = buildLaunchRegionRoutes().map((r) => r.path);
  const others = [
    '서울특별시', '경기도', '인천광역시', '대구광역시', '대전광역시', '광주광역시',
    '울산광역시', '세종특별자치시', '강원특별자치도', '충청북도', '충청남도',
    '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도',
  ];
  for (const sido of others) {
    const enc = encodeURIComponent(sido);
    assert.ok(!paths.some((p) => p.includes(enc)), `${sido}가 사이트맵에 남아 있다`);
  }
  // 모든 경로의 sido는 부산 하나뿐이다.
  const busanEnc = encodeURIComponent(BUSAN);
  for (const p of paths) assert.ok(p.includes(`sido=${busanEnc}`), `부산이 아닌 경로: ${p}`);
  assert.equal(LAUNCH_SIDO, BUSAN);
});

// ── B. 쿼리 이스케이프(회귀 방지) ──────────────────────────────────────────

test('§7 쿼리 구분자는 XML 이스케이프된 &amp;다 — "고치면" 사이트맵이 깨진다', () => {
  const q = regionQuery(BUSAN, '해운대구');
  assert.ok(q.includes('&amp;sigungu='), `구분자가 바뀌었다: ${q}`);
  // XML 파서가 디코드하면 평범한 &가 되어 크롤러는 올바른 URL을 받는다.
  const decoded = q.replace(/&amp;/g, '&');
  assert.equal(decoded, `sido=${encodeURIComponent(BUSAN)}&sigungu=${encodeURIComponent('해운대구')}`);
  // 이중 이스케이프(&amp;amp;)는 실제 배포 XML에서 관측되지 않았다 — 생기면 회귀다.
  assert.ok(!q.includes('&amp;amp;'));
});

test('§2 한글은 퍼센트 인코딩된다 — 날것의 한글이 URL에 들어가지 않는다', () => {
  for (const r of buildLaunchRegionRoutes()) {
    assert.ok(!/[가-힣]/.test(r.path), `인코딩되지 않은 한글: ${r.path}`);
  }
});

// ── C. 배선: sitemap.ts가 실제로 이 범위를 쓰는가 ───────────────────────────

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 이름을 언급한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SITEMAP = read('src/app/sitemap.ts');
const ROBOTS = read('src/app/robots.ts');

test('§1 sitemap.ts가 더 이상 전국 REGION_DATA를 돌지 않는다', () => {
  assert.ok(!/REGION_DATA/.test(codeOf(SITEMAP)), 'sitemap이 아직 전국 지역 목록을 쓴다');
  assert.ok(/buildLaunchRegionRoutes/.test(SITEMAP), 'sitemap이 출시 범위 빌더를 쓰지 않는다');
});

test('§9 사이트맵 URL 오리진은 siteConfig에서 나온다 — 호스트를 박지 않는다', () => {
  assert.ok(/absoluteUrl\(/.test(SITEMAP));
  const code = SITEMAP.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/vercel\.app|e-jip\.com|localhost/.test(code), 'sitemap에 호스트가 박혀 있다');
});

test('§8 robots는 그대로다 — 사이트맵 정리를 Disallow로 대체하지 않았다', () => {
  assert.ok(/allow: '\/'/.test(ROBOTS));
  assert.ok(/sitemap: `\$\{siteConfig\.url\}\/sitemap\.xml`/.test(ROBOTS));
  for (const d of ['/api/', '/admin', '/my', '/community/write']) {
    assert.ok(ROBOTS.includes(`'${d}'`), `${d} disallow가 사라졌다`);
  }
  // 부산 외 지역을 robots로 막지 않는다(§8) — 접근은 계속 열려 있어야 한다.
  assert.ok(!/서울|sido=/.test(ROBOTS), 'robots가 지역을 막고 있다');
  const code = ROBOTS.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/disallow: '\/'/i.test(code), '전체 Disallow가 들어갔다');
});

// ── D. 부산 경계 판정(§4/§11) ──────────────────────────────────────────────

test('§4 부산 좌표는 안내를 띄우지 않는다', () => {
  const inside: Array<[string, number, number]> = [
    ['부산 시청', 35.1798, 129.0750],
    ['해운대', 35.1587, 129.1604],
    ['서구 암남동', 35.0776, 129.0153],
    ['기장군', 35.2444, 129.2222],
    ['가덕도 방면(강서구)', 35.0200, 128.8300],
  ];
  for (const [name, lat, lng] of inside) {
    assert.ok(isInsideBusanBounds(lat, lng), `${name}가 부산 밖으로 판정됐다`);
  }
});

test('§4 부산 밖 좌표는 안내 대상이다', () => {
  const outside: Array<[string, number, number]> = [
    ['진주', 35.1800, 128.1076],
    ['남해', 34.8376, 127.8925],
    ['서울', 37.5665, 126.9780],
    ['대구', 35.8714, 128.6014],
    ['제주', 33.4996, 126.5312],
  ];
  for (const [name, lat, lng] of outside) {
    assert.ok(!isInsideBusanBounds(lat, lng), `${name}가 부산으로 판정됐다`);
  }
});

test('§11 판정은 순수 좌표 계산이다 — 네트워크 호출이 없다', () => {
  const SRC = read('src/lib/busan-bounds.ts');
  assert.ok(!/fetch\(|dapi\.kakao|http/.test(SRC.replace(/^\s*\/\/.*$/gm, '')), '경계 판정에 네트워크가 끼어 있다');
  assert.deepEqual(BUSAN_BBOX, { minLat: 34.9, maxLat: 35.45, minLng: 128.6, maxLng: 129.35 });
});

test('§11 잘못된 좌표는 부산으로 보지 않는다', () => {
  assert.ok(!isInsideBusanBounds(NaN, 129));
  assert.ok(!isInsideBusanBounds(35.1, NaN));
  assert.ok(!isInsideBusanBounds(Infinity, Infinity));
});

test('§11 학교 좌표 검증이 같은 박스를 계속 쓴다 — 사본이 갈라지지 않았다', () => {
  const EDU = read('src/lib/education/schoolinfo-stat-validate.ts');
  assert.ok(/isInsideBusanBounds/.test(EDU), '학교 검증이 공용 경계를 쓰지 않는다');
  assert.ok(!/minLat: 34\.9/.test(EDU), '경계 상수 사본이 남아 있다');
});

// ── E. 지도 안내 동작 계약(§4) ─────────────────────────────────────────────

const NOTICE = read('src/components/map/OutOfBusanNotice.tsx');
const NOTICE_CSS = read('src/components/map/OutOfBusanNotice.module.css');
const MAP = read('src/app/map/page.tsx');

test('§4 안내 문구는 지정된 카피 그대로다', () => {
  assert.ok(NOTICE.includes('현재 위치는 부산 외 지역입니다.'));
  assert.ok(NOTICE.includes('이집은 현재 부산 지역 데이터를 우선 제공하고 있습니다.'));
});

test('§4 세션당 한 번 — pan/zoom마다 다시 뜨지 않는다', () => {
  assert.ok(/sessionStorage/.test(NOTICE), '세션 기억이 없다');
  assert.ok(/setDismissed\(true\)/.test(NOTICE), '닫기 동작이 없다');
  // 로그인/서버 상태에 기대지 않는다.
  assert.ok(!/useSession|fetch\(/.test(NOTICE), '안내가 로그인/네트워크에 의존한다');
});

test('§4 안내가 지도 조작을 막지 않는다', () => {
  // 하단 상태 스택(pointer-events: none) 안에 있고, 카드만 auto로 되돌린다.
  assert.ok(/pointer-events: auto/.test(NOTICE_CSS));
  assert.ok(!/position: fixed/.test(NOTICE_CSS), '화면 전체를 덮는 배치다');
  assert.ok(!/inset: 0|width: 100vw|height: 100vh/.test(NOTICE_CSS));
  // 오류처럼 보이지 않는다 — 경고/에러 색을 쓰지 않는다.
  assert.ok(!/#b91c1c|rgba\(185, ?28, ?28/.test(NOTICE_CSS), '오류색을 쓰고 있다');
});

test('§4/§6 지도는 현재 위치 동작을 유지한다 — 부산으로 강제 이동시키지 않는다', () => {
  assert.ok(/<OutOfBusanNotice lat=\{center\.lat\} lng=\{center\.lng\} \/>/.test(MAP));
  // 안내를 넣으면서 center를 부산으로 되돌리는 코드를 끼워넣지 않았다.
  assert.ok(!/setCenter\(BUSAN|forceBusan|resetToBusan/.test(MAP));
});

// ── F. 통계 기본 지역(§5) ──────────────────────────────────────────────────

const REGION_CTX = read('src/contexts/RegionContext.tsx');

test('§5 GPS 실패 시 기본 지역은 부산광역시 전체다', () => {
  const fallback = REGION_CTX.slice(
    REGION_CTX.indexOf('const FALLBACK_REGION'),
    REGION_CTX.indexOf('// 카카오 역지오코딩이')
  );
  assert.ok(/lawdCd: null/.test(fallback), '특정 구에 묶여 있다');
  assert.ok(/sigungu: ''/.test(fallback), '특정 구에 묶여 있다');
  assert.ok(/sido: '부산광역시'/.test(fallback));
  assert.ok(!/'26140'|'서구'/.test(fallback), '서구 기본값이 남아 있다');
});

test('§6 GPS가 통계 지역을 정하는 기존 동작은 그대로다', () => {
  // 이 동작은 원래 의도된 것이라 이 STEP에서 바꾸지 않는다(§6).
  assert.ok(/getCurrentPosition/.test(REGION_CTX));
  assert.ok(/userSelectedRef/.test(REGION_CTX), '사용자 선택 우선 보호가 사라졌다');
});
