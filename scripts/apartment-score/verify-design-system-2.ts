/**
 * DESIGN SYSTEM 2 — Foundation Tokens + Typography + Semantic Color + Core
 * Components 검증. 기존 관례(assert 기반, 테스트 러너 없음)를 따른다.
 * DB/네트워크 없이 순수 로직 검증(AreaChip 평형 표기 규칙)과 소스 파일
 * 정적 검사(토큰/접근성 규칙이 실제로 반영됐는지)로 나뉜다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/verify-design-system-2.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import { shouldShowPyeongLabel, AreaChipLabelInput } from '@/lib/area-chip-rules';

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

const baseChip: AreaChipLabelInput = {
  supplyAreaM2: null,
  pyeongLabel: null,
};

// ---- 1. AreaChip "평형 없는 상태에서 평형 표기 금지"(AREA MODEL V1 §16) ----
console.log('--- AreaChip pyeong-label gating (AREA MODEL V1 §16) ---');
check('supplyAreaM2=null, pyeongLabel=null → 평형 표기 안 함(오늘 사실상 전체 케이스)', () => {
  assert.strictEqual(shouldShowPyeongLabel(baseChip), false);
});
check('supplyAreaM2=null인데 pyeongLabel이 채워져 있어도(계약 위반 상태) 표기하지 않음', () => {
  assert.strictEqual(shouldShowPyeongLabel({ ...baseChip, pyeongLabel: '34평형' }), false);
});
check('supplyAreaM2가 검증되고 pyeongLabel도 있으면 표기함(향후 데이터 확보 시)', () => {
  assert.strictEqual(shouldShowPyeongLabel({ ...baseChip, supplyAreaM2: 112.4, pyeongLabel: '34평형' }), true);
});
check('supplyAreaM2가 검증됐어도 pyeongLabel이 없으면 표기하지 않음', () => {
  assert.strictEqual(shouldShowPyeongLabel({ ...baseChip, supplyAreaM2: 112.4, pyeongLabel: null }), false);
});

// ---- 2. AreaSelector가 실제로 AreaChip을 쓰고, supplyAreaM2/pyeongLabel을 항상 null로 넘김(정적 확인) ----
console.log('--- AreaSelector wiring (static check) ---');
check('AreaSelector.tsx가 AreaChip 컴포넌트를 사용함', () => {
  const src = readSrc('src/components/AreaSelector.tsx');
  assert.ok(src.includes("from '@/components/ui/AreaChip'"), 'AreaChip import가 있어야 함');
  assert.ok(src.includes('<AreaChip'), 'AreaChip 렌더링이 있어야 함');
});
check('AreaSelector.tsx는 오늘 데이터 기준 supplyAreaM2/pyeongLabel을 항상 null로 넘김', () => {
  const src = readSrc('src/components/AreaSelector.tsx');
  assert.ok(/supplyAreaM2:\s*null/.test(src), 'supplyAreaM2: null이어야 함(공급면적 데이터 없음, AREA MODEL V1 §8)');
  assert.ok(/pyeongLabel:\s*null/.test(src), 'pyeongLabel: null이어야 함');
});
check('AreaSelector.tsx에 여전히 MAX_CHIPS 상한이 없음(APT DETAIL QA/IA v1 회귀 방지)', () => {
  const src = readSrc('src/components/AreaSelector.tsx');
  assert.ok(!src.includes('MAX_CHIPS'));
  assert.ok(src.includes('const chipAreas = allAreas'));
});

// ---- 3. globals.css 토큰 foundation(정적 확인) ----
console.log('--- globals.css token foundation (static check) ---');
const globalsCss = readSrc('src/app/globals.css');
check('모바일 14px root font-size override가 제거됨(DS-2 §7)', () => {
  assert.ok(!/@media[^}]*max-width:\s*768px[^}]*\{[^}]*html\s*\{\s*font-size:\s*14px/.test(globalsCss),
    'html { font-size: 14px } 모바일 override가 남아있으면 안 됨');
});
check('typography scale 토큰(display/page-title/section-title/card-title/body/body-sm/caption)이 전부 정의됨', () => {
  for (const token of ['--font-size-display', '--font-size-page-title', '--font-size-section-title', '--font-size-card-title', '--font-size-body', '--font-size-body-sm', '--font-size-caption']) {
    assert.ok(globalsCss.includes(token), `${token} 토큰이 없음`);
  }
});
check('caption 토큰(최소 UI text)이 12px이고, 그보다 작은 typography 토큰이 없음(DS-2 §8 11px 하한 원칙)', () => {
  assert.ok(globalsCss.includes('--font-size-caption: 0.75rem'), 'caption은 0.75rem(12px)이어야 함');
});
check('--primary-color가 --ejip-green(#13A367) alias로 정의됨(DS-2 §4)', () => {
  assert.ok(/--primary-color:\s*var\(--ejip-green\)/.test(globalsCss));
  assert.ok(globalsCss.includes('--ejip-green: #13A367'));
});
check('legacy 네이버 그린(#03c75a)은 삭제되지 않고 --legacy-naver-green으로 보존됨(점진 migration)', () => {
  assert.ok(/--legacy-naver-green:\s*#03c75a/i.test(globalsCss));
});
check('--text-muted 대비 개선(#8f8f8f → #6b7280, WCAG AA, DS-2 §6)', () => {
  assert.ok(globalsCss.includes('--text-muted: #6b7280'));
});
check('semantic color(warning/info/error)가 up-color/down-color와 분리되어 정의됨(DS-2 §5)', () => {
  for (const token of ['--warning-color', '--info-color', '--error-color']) {
    assert.ok(globalsCss.includes(token), `${token} 토큰이 없음`);
  }
});
check('control-height 토큰(sm/md/lg)이 정의되고 md가 44px(터치 타깃, DS-2 §13)', () => {
  assert.ok(globalsCss.includes('--control-height-md: 44px'));
});
check('undefined 토큰(--background-color/--bg-light)이 --bg-color alias로 해소됨(DS-2 §28)', () => {
  assert.ok(/--background-color:\s*var\(--bg-color\)/.test(globalsCss));
  assert.ok(/--bg-light:\s*var\(--bg-color\)/.test(globalsCss));
});

// ---- 4. 하드코딩 그린 literal 제거(DS-2 §29, 정적 확인) ----
console.log('--- hardcoded green literal cleanup (static check) ---');
check('stats/page.module.css의 하드코딩 #03C75A가 --primary-color로 교체됨', () => {
  const src = readSrc('src/app/stats/page.module.css');
  assert.ok(!/#03[cC]75[aA]/.test(src), '#03c75a 하드코딩이 남아있으면 안 됨');
});
check('page.module.css의 하드코딩 #03C75A가 --primary-color로 교체됨', () => {
  const src = readSrc('src/app/page.module.css');
  assert.ok(!/#03[cC]75[aA]/.test(src), '#03c75a 하드코딩이 남아있으면 안 됨');
});

// ---- 5. 접근성 — 44px 터치 타깃 + focus-visible(DS-2 §27, 정적 확인) ----
console.log('--- accessibility foundation (static check) ---');
check('Chip.module.css가 44px 터치 타깃(--control-height-md)을 사용함', () => {
  const src = readSrc('src/components/ui/Chip.module.css');
  assert.ok(src.includes('min-height: var(--control-height-md)'));
});
check('Chip.module.css에 focus-visible 스타일이 있음', () => {
  const src = readSrc('src/components/ui/Chip.module.css');
  assert.ok(src.includes(':focus-visible'));
});
check('SectionHeader의 action 버튼/링크에도 focus-visible 스타일이 있음', () => {
  const src = readSrc('src/components/ui/SectionHeader.module.css');
  assert.ok(src.includes(':focus-visible'));
});

// ---- 6. TradeTimelineList 375px 회귀 수정(DS-2 §33, 정적 확인) ----
console.log('--- TradeTimelineList 375px regression fix (static check) ---');
check('연도 표기가 2자리로 축소됨(계약월 컬럼 폭 절약)', () => {
  const src = readSrc('src/components/TradeTimelineList.tsx');
  assert.ok(src.includes('tradeDate.slice(2, 7)'), '2자리 연도 슬라이스가 있어야 함(375px 폭 확보)');
});

console.log(`\n${passed} checks passed.`);
if (process.exitCode) {
  console.error('SOME CHECKS FAILED');
} else {
  console.log('ALL CHECKS PASSED');
}
