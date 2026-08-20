/**
 * DESIGN SYSTEM 3 — Common Components + Header/BottomNav Integration 검증.
 * 기존 관례(assert 기반, 테스트 러너 없음)를 따른다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/verify-design-system-3.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import { formatPyeong, getUniquePyeongLabels } from '@/lib/area-utils';
import { BOTTOM_NAV_ITEMS } from '@/lib/bottom-nav-items';

let passed = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (e: any) {
    console.error(`  FAIL  ${label}: ${e.message}`);
    process.exitCode = 1;
  }
}

function readSrc(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');
}

// ---- 1. "약 N평" 접두어 통일(DS-3 §15, AREA MODEL V1 §24/§33 unresolved 해소) ----
console.log('--- pyeong "약" prefix unification (§15) ---');
check('Hero(formatPyeong)는 원래부터 "약 N평" 형식', () => {
  assert.strictEqual(formatPyeong(84), '약 25.4평');
});
check('칩/거래표(getUniquePyeongLabels)도 이제 "약 N평" 형식(이전엔 "N평"만)', () => {
  const labels = getUniquePyeongLabels([84]);
  assert.strictEqual(labels.get(84), '약 25.4평');
});
check('"평형" 단어는 여전히 사용하지 않음(공급면적 미검증 상태)', () => {
  const labels = getUniquePyeongLabels([84, 59.99]);
  for (const v of labels.values()) {
    assert.ok(!v.includes('평형'), `"평형" 표기가 있으면 안 됨: ${v}`);
  }
});
check('"약"이 중복되지 않음(약 약 N평 방지)', () => {
  const labels = getUniquePyeongLabels([84]);
  const v = labels.get(84)!;
  assert.strictEqual((v.match(/약/g) || []).length, 1);
});

// ---- 2. BottomNav 5개 메뉴 active 로직(정적+런타임) ----
console.log('--- BottomNav 5-item active logic ---');
check('BOTTOM_NAV_ITEMS는 정확히 5개(6개로 늘리지 않음, §8 결정)', () => {
  assert.strictEqual(BOTTOM_NAV_ITEMS.length, 5);
});
check('각 항목의 isActive가 자신의 href에서는 true, 다른 항목의 href에서는 false', () => {
  for (const item of BOTTOM_NAV_ITEMS) {
    assert.ok(item.isActive(item.href), `${item.label}의 isActive(${item.href})는 true여야 함`);
    for (const other of BOTTOM_NAV_ITEMS) {
      if (other.href === item.href) continue;
      // 재개발·분양 탭은 /presales 경로도 의도적으로 함께 active 처리하므로 예외
      if (item.href === '/redevelopment' && other.href.startsWith('/presales')) continue;
      assert.ok(!item.isActive(other.href), `${item.label}의 isActive(${other.href})는 false여야 함`);
    }
  }
});

// ---- 3. BottomNav 공용 컴포넌트가 실제로 Header와 동일 설정 공유(정적 확인) ----
console.log('--- BottomNav shared component wiring (static check) ---');
check('src/components/ui/BottomNav.tsx가 BOTTOM_NAV_ITEMS를 공유해서 씀', () => {
  const src = readSrc('src/components/ui/BottomNav.tsx');
  assert.ok(src.includes("from '@/lib/bottom-nav-items'"));
});
check('map/page.tsx가 인라인 MapBottomNav 대신 공용 BottomNav를 사용함', () => {
  const src = readSrc('src/app/map/page.tsx');
  assert.ok(!src.includes('function MapBottomNav'), '인라인 MapBottomNav가 남아있으면 안 됨');
  assert.ok(src.includes("from '@/components/ui/BottomNav'"));
  assert.ok(src.includes('<BottomNav'));
});
check('Header.tsx/BottomNav.tsx 모두 활성 탭에 aria-current를 설정함', () => {
  const header = readSrc('src/components/Header.tsx');
  const bottomNav = readSrc('src/components/ui/BottomNav.tsx');
  assert.ok(header.includes('aria-current'));
  assert.ok(bottomNav.includes('aria-current'));
});

// ---- 4. Error에는 마스코트를 쓰지 않음(mascot README 기존 결정 준수) ----
console.log('--- Error mascot policy (public/brand/mascot/README.md 기존 결정) ---');
check('ErrorState.tsx는 mascot <img>을 렌더링하지 않음', () => {
  const src = readSrc('src/components/ui/ErrorState.tsx');
  assert.ok(!/<img[^>]*mascot/.test(src), 'Error 상태에 마스코트 <img>를 쓰면 안 됨(신뢰감 우선 원칙)');
});
check('presales-client.tsx의 에러 상태에서 ejipy-error 마스코트가 제거됨', () => {
  const src = readSrc('src/app/presales/presales-client.tsx');
  assert.ok(!src.includes('ejipy-error'), '에러 상태에 마스코트가 남아있으면 안 됨');
});
check('RedevelopmentListSection.tsx의 에러 상태에서 ejipy-error 마스코트가 제거됨', () => {
  const src = readSrc('src/app/redevelopment/RedevelopmentListSection.tsx');
  assert.ok(!src.includes('ejipy-error'));
});

// ---- 5. Empty variant → mascot 매핑(정적 확인, §12) ----
console.log('--- Empty variant mascot mapping (static check) ---');
check('Empty.tsx: notReady는 ejipy-guide, noData/noResult는 ejipy-empty', () => {
  const src = readSrc('src/components/ui/Empty.tsx');
  assert.ok(/notReady:\s*'\/brand\/mascot\/ejipy-guide\.webp'/.test(src));
  assert.ok(/noData:\s*'\/brand\/mascot\/ejipy-empty\.webp'/.test(src));
  const mascotBlock = src.slice(src.indexOf('const DEFAULT_MASCOT'), src.indexOf('const DEFAULT_TITLE'));
  const mascotValuesOnly = mascotBlock.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!mascotValuesOnly.includes('ejipy-error'), 'Empty의 DEFAULT_MASCOT 매핑에 error 마스코트를 쓰면 안 됨');
});

// ---- 6. Redevelopment 탭 emoji → Lucide 교체(§22, 이 STEP에서 손댄 영역만) ----
console.log('--- Redevelopment tab emoji removal (touched-area only, §22) ---');
check('redevelopment-client.tsx 탭에 🏢/🏗️ emoji가 더 이상 없음', () => {
  const src = readSrc('src/app/redevelopment/redevelopment-client.tsx');
  assert.ok(!src.includes('🏢') && !src.includes('🏗️'));
  assert.ok(src.includes("from 'lucide-react'"), 'Lucide import가 있어야 함');
});

// ---- 7. TradeTimelineList colgroup 폭 합이 100%(375px 회귀 방지, §15 재실측) ----
console.log('--- TradeTimelineList colgroup integrity ---');
check('colgroup 4개 col의 width%가 정확히 100으로 합산됨', () => {
  const src = readSrc('src/components/TradeTimelineList.tsx');
  const widths = [...src.matchAll(/<col style=\{\{ width: '(\d+)%' \}\} \/>/g)].map((m) => parseInt(m[1], 10));
  assert.strictEqual(widths.length, 4, `col 4개를 찾아야 하는데 ${widths.length}개 찾음`);
  assert.strictEqual(widths.reduce((a, b) => a + b, 0), 100);
});

// ---- 8. 공용 Button/Card/Filter 컴포넌트가 실제로 wiring됨(정적 확인) ----
console.log('--- Foundation component adoption (static check) ---');
check('presales-client.tsx가 FilterBar/SelectFilter/Card/Empty/ErrorState/Button을 모두 사용함', () => {
  const src = readSrc('src/app/presales/presales-client.tsx');
  for (const name of ['FilterBar', 'SelectFilter', 'Card', 'Empty', 'ErrorState', 'Button']) {
    assert.ok(src.includes(`from '@/components/ui/${name}'`), `${name} import가 없음`);
  }
});
check('home-client.tsx가 공용 Button을 사용함(quickActionsRow)', () => {
  const src = readSrc('src/app/home-client.tsx');
  assert.ok(src.includes("from '@/components/ui/Button'"));
});
check('apt-client.tsx가 공용 Button을 사용함(지도/로드뷰/대출한도 quick buttons)', () => {
  const src = readSrc('src/app/apt/[name]/apt-client.tsx');
  assert.ok(src.includes("from '@/components/ui/Button'"));
});

console.log(`\n${passed} checks passed.`);
if (process.exitCode) {
  console.error('SOME CHECKS FAILED');
} else {
  console.log('ALL CHECKS PASSED');
}
