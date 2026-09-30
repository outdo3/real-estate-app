// GYEONGGI8_FINAL_PREVIEW_PREP_V1 — 경기 8구 공개 beta 준비(현재 main 4be3c02 기준 재구성) 회귀 테스트.
// Production 스위치(GYEONGGI_BETA_ENABLED)는 false, Preview 전용 스위치는 env 두 개가 모두 맞을 때만 열린다.
// "켜면"은 simulateRegionEnablement로 본다(런타임 설정은 바꾸지 않는다).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GYEONGGI_8_BETA_PREVIEW_ENABLED,
  GYEONGGI_8_OPEN,
  GYEONGGI_BETA_ENABLED,
  GYEONGGI_BETA_ENABLEMENT,
  GYEONGGI_BETA_LAWDCDS,
  SEOUL_17_BETA_LAWDCDS,
  SEOUL_BETA_LAWDCDS,
  getRegionEnablement,
  isDbOnlyLawdCd,
  isPublicRegionAllowed,
  isSidoPubliclyHidden,
  isSidoWholeQuerySupported,
  publicAllowedLawdCds,
  resolveDbOnly,
  resolveGyeonggi8Open,
  resolveGyeonggi8PreviewFlag,
  resolveGyeonggiDbOnly,
  simulateRegionEnablement,
  type RegionEnablement,
} from './enablement';
import { REGION_NODES } from './registry';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { decideSupplyRegion, supplyCheckFrom } from '../stats/supply-region-gate';
import { isReportRegionOpen } from '../report/report-links';
import { decidePublicSeo } from '../seo/seoul-blocked-seo';
import { buildLaunchRegionRoutes } from '../sitemap-scope';

const ROOT = resolve(__dirname, '../../..');
const code = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const GG8 = GYEONGGI_BETA_LAWDCDS as readonly string[];
const GG_ALL = REGION_NODES.filter((n) => n.sidoCode === '41').map((n) => n.lawdCd);
const GG_OTHER = GG_ALL.filter((c) => !GG8.includes(c));
const S8 = SEOUL_BETA_LAWDCDS as readonly string[];
const S17 = SEOUL_17_BETA_LAWDCDS as readonly string[];
const BUSAN = BUSAN_LAWDCD_16 as readonly string[];
const AXES: (keyof RegionEnablement)[] = ['app', 'search', 'map', 'detail', 'report', 'stats', 'supply', 'sitemap', 'seoIndex', 'cronSync'];
const OPEN_AXES = ['app', 'search', 'map', 'detail', 'cronSync'] as const;
const CLOSED_AXES = ['report', 'stats', 'supply', 'sitemap', 'seoIndex'] as const;

// 현재 Production = 서울 25구 공개(2026-09-30) + 경기 닫힘. ON = 여기에 경기 8구만 더한 상태.
const NOW = { seoulBeta: true, gyeonggiBeta: false, seoul17Open: true } as const;
const ON = { seoulBeta: true, gyeonggiBeta: true, seoul17Open: true } as const;
const sim = (c: string, flags: typeof NOW | typeof ON = ON) => simulateRegionEnablement(c, flags);

test('1 · 경기 8구 목록은 정확히 이 8개(중복·누락·추가 없음), 41135(분당) 제외', () => {
  const expected = ['41111', '41113', '41115', '41117', '41131', '41133', '41150', '41210'];
  assert.deepEqual([...GG8], expected);
  assert.equal(new Set(GG8).size, 8);
  assert.ok(!GG8.includes('41135'));
  for (const c of GG8) assert.ok(REGION_NODES.some((n) => n.lawdCd === c && n.sidoCode === '41' && n.isMolitLeaf), `${c}는 경기 MOLIT leaf가 아니다`);
});

test('2 · Preview 스위치 진리표 — Vercel Preview + 명시 플래그 둘 다일 때만, Production 오설정은 닫힘', () => {
  assert.equal(resolveGyeonggi8PreviewFlag('preview', 'true'), true);
  for (const [env, flag] of [
    ['production', 'true'], ['development', 'true'], [undefined, 'true'], ['preview', undefined], ['preview', 'TRUE'],
    ['preview', ' true'], ['preview', '1'], ['Preview', 'true'], [undefined, undefined],
  ] as const) assert.equal(resolveGyeonggi8PreviewFlag(env, flag), false, `${env}/${flag}`);
  assert.equal(resolveGyeonggi8Open(false, false), false);
  assert.equal(resolveGyeonggi8Open(true, false), true);
  assert.equal(resolveGyeonggi8Open(false, true), true);
});

test('3 · 스위치는 env 두 개를 리터럴로 읽는다(빌드 인라인) · Production 스위치 false · 런타임 맵은 GYEONGGI_8_OPEN을 따른다', () => {
  const en = code('src/lib/region/enablement.ts');
  assert.match(en, /resolveGyeonggi8PreviewFlag\(\s*process\.env\.NEXT_PUBLIC_VERCEL_ENV,\s*process\.env\.NEXT_PUBLIC_GYEONGGI_8_BETA_PREVIEW\s*\)/);
  assert.match(en, /export const GYEONGGI_BETA_ENABLED = false;/);
  assert.match(en, /gyeonggiBeta: GYEONGGI_8_OPEN,/);
  assert.ok(!/'41'\s*:/.test(en), '시도 층에 경기(41)가 들어가면 48개 노드가 전부 열린다');
});

test('4 · 현재 빌드(테스트 env = Production과 같음): 경기 전 축 닫힘 · DB 전용 아님 · 선택기에 경기 없음', () => {
  assert.equal(GYEONGGI_BETA_ENABLED, false);
  assert.equal(GYEONGGI_8_BETA_PREVIEW_ENABLED, false);
  assert.equal(GYEONGGI_8_OPEN, false);
  for (const c of GG_ALL) {
    for (const axis of AXES) assert.equal(isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
    assert.equal(isDbOnlyLawdCd(c), false, c);
  }
  assert.equal(isSidoPubliclyHidden('41'), true, '선택기에 경기가 나온다');
  for (const axis of ['search', 'map'] as const) assert.ok(!publicAllowedLawdCds(axis).some((c) => c.startsWith('41')), axis);
});

test('5 · 켜면(Preview 또는 승인 뒤 Production): 8구만 app·search·map·detail·DB 읽기, 나머지 축 닫힘', () => {
  assert.deepEqual(GYEONGGI_BETA_ENABLEMENT, { app: true, search: true, map: true, detail: true, report: false, stats: false, supply: false, sitemap: false, seoIndex: false, cronSync: true });
  for (const c of GG8) {
    for (const axis of OPEN_AXES) assert.equal(sim(c)[axis], true, `${c} ${axis}`);
    for (const axis of CLOSED_AXES) assert.equal(sim(c)[axis], false, `${c} ${axis}`);
  }
  // 41135·나머지 경기(부모 시 포함)는 켜도 전 축 닫힘
  for (const c of [...GG_OTHER, '41135', '41110', '41130']) for (const axis of AXES) assert.equal(sim(c)[axis], false, `${c} ${axis}`);
  // 검색·지도 allowlist = 부산 16 + 서울 25 + 경기 8
  for (const axis of ['search', 'map'] as const) {
    const open = REGION_NODES.filter((n) => sim(n.lawdCd)[axis]).map((n) => n.lawdCd);
    assert.equal(open.length, 16 + 25 + 8, axis);
    assert.deepEqual(open.filter((c) => c.startsWith('41')).sort(), [...GG8].sort(), axis);
  }
});

test('6 · 켜면 경기 8구는 DB 전용(live MOLIT 관문 닫힘) — 서울 8구·부산·나머지 경기는 영향 없음', () => {
  for (const c of GG8) {
    assert.equal(resolveGyeonggiDbOnly(true, c), true, c);
    assert.equal(resolveGyeonggiDbOnly(false, c), false, c);
  }
  for (const c of [...GG_OTHER, '41135', ...S8, ...BUSAN, '', null, undefined]) assert.equal(resolveGyeonggiDbOnly(true, c as string), false, String(c));
  // 서울 17구 판정은 그대로(경기 스위치와 독립)
  for (const c of S17) assert.equal(resolveDbOnly(true, c), true, c);
  const molit = code('src/lib/api-molit.ts');
  assert.match(molit, /if \(isDbOnlyLawdCd\(params\.lawdCd\)\) return molitFailurePlaceholder\(params, DB_ONLY_MOLIT_MESSAGE\);/);
  // 상세·지도는 cronSync(=DB-first) 축으로 DB를 읽는다 — 켜면 경기 8구도 같은 경로
  assert.ok(/if \(aptSeq && isTradeDbFirstLawdCd\(aptSeq\.slice\(0, 5\)\)\)/.test(code('src/app/api/apt/[name]/route.ts')));
  assert.ok(/const isDbFirstEligible = isMapMarkerShape && isTradeDbFirstLawdCd\(lawdCd\);/.test(code('src/app/api/transactions/route.ts')));
});

test('7 · 선택기: 켜면 경기 시도가 나타나되 "경기도 전체"는 없다 · 선택기 목록은 app 축(8구만)', () => {
  assert.equal(isSidoWholeQuerySupported('41'), false);
  const modal = code('src/components/RegionSelectModal.tsx');
  assert.ok(/isPublicRegionAllowed\(item\.code\.substring\(0, 5\), 'app'\)/.test(modal), '선택기가 app 축 allowlist를 쓰지 않는다');
  assert.ok(/if \(!isSidoWholeQuerySupported\(sidoCode\)\) return;/.test(modal), '"시도 전체" 핸들러 가드가 없다');
  const appOpen = GG_ALL.filter((c) => sim(c).app);
  assert.deepEqual(appOpen.sort(), [...GG8].sort());
});

test('8 · 공급(청약홈) 누수 회귀 없음 — 경기는 지금도 켜도 닫힘, 서울 8구·부산 그대로, 서울 17구 닫힘', () => {
  const onCheck = supplyCheckFrom((c) => sim(c, ON), () => ({ ...GYEONGGI_BETA_ENABLEMENT, supply: false }));
  for (const gu of ['수원시 장안구', '수원시 권선구', '수원시 팔달구', '수원시 영통구', '성남시 수정구', '성남시 중원구', '의정부시', '광명시', '성남시 분당구']) {
    assert.equal(decideSupplyRegion('경기도', gu).allowed, false, `현재 ${gu}`);
    assert.equal(decideSupplyRegion('경기도', gu, onCheck).allowed, false, `켜면 ${gu}`);
  }
  assert.equal(decideSupplyRegion('경기도', null).allowed, false);
  for (const c of GG8) assert.equal(getRegionEnablement(c).supply, false, c);
  // 기존 동작 그대로
  assert.equal(decideSupplyRegion('서울특별시', '마포구').allowed, true);
  assert.equal(decideSupplyRegion('서울특별시', '강남구').allowed, false);
  assert.equal(decideSupplyRegion('부산광역시', '해운대구').allowed, true);
});

test('9 · 리포트·통계 닫힘: 경기 aptSeq는 리포트 CTA가 없고, 켜도 report·stats 축 닫힘', () => {
  for (const c of GG8) {
    assert.equal(isReportRegionOpen(`${c}-1`), false, c);
    assert.equal(sim(c).report, false, c);
    assert.equal(sim(c).stats, false, c);
  }
  assert.equal(isReportRegionOpen('26350-164'), true, '부산 리포트 CTA가 사라졌다');
});

test('10 · SEO: 경기 상세는 지금 BLOCKED, 켜도 NOINDEX(색인 금지) · sitemap에 경기 없음 · 리포트 BLOCKED', () => {
  const blockedOn = (c: string, f: keyof RegionEnablement) => !sim(c, ON)[f];
  for (const c of GG8) {
    assert.equal(decidePublicSeo([c], 'detail'), 'BLOCKED', c);
    assert.equal(decidePublicSeo([c], 'detail', blockedOn), 'NOINDEX', c);
    assert.equal(decidePublicSeo([c], 'report', blockedOn), 'BLOCKED', c);
  }
  // 섞인 식별자는 덜 열린 쪽(41135 aptSeq면 막힘)
  assert.equal(decidePublicSeo(['41111', '41135'], 'detail', blockedOn), 'BLOCKED');
  const paths = buildLaunchRegionRoutes().map((r) => decodeURIComponent(r.path));
  assert.ok(!paths.some((p) => /\/41\d{3}/.test(p) || p.includes('경기')), '사이트맵에 경기가 있다');
});

test('11 · 서울 25구·부산 회귀 없음 — 경기를 켜도 서울·부산의 enablement는 지금과 같다', () => {
  for (const c of [...BUSAN, ...S8, ...S17]) assert.deepEqual(sim(c, ON), sim(c, NOW), c);
  for (const c of [...BUSAN, ...S8, ...S17]) assert.deepEqual(sim(c, NOW), getRegionEnablement(c), `${c} 런타임 ≠ 시뮬레이션 NOW`);
  for (const c of S17) assert.equal(isDbOnlyLawdCd(c), true, c);
  for (const c of [...S8, ...BUSAN]) assert.equal(isDbOnlyLawdCd(c), false, c);
});
