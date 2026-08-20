/**
 * STATISTICS V2 — 전체 통계 UX/정보구조 재설계 검증. 기존 관례(assert 기반,
 * 테스트 러너 없음)를 따른다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/verify-statistics-v2.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import { directionColor, formatPercentChange, formatTradeCount, isLowSample } from '@/lib/stats-format';
import { buildRankingInsight } from '@/lib/stats-insight';
import { STATS_MENU, STATS_CATEGORIES } from '@/app/stats/statsMenu';

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

// ---- 1. 숫자/방향색 helper ----
console.log('--- number/direction helpers (§10/§11) ---');
check('directionColor: 양수는 up-color, 음수는 down-color, 0/null은 중립', () => {
  assert.strictEqual(directionColor(5), 'var(--up-color)');
  assert.strictEqual(directionColor(-5), 'var(--down-color)');
  assert.strictEqual(directionColor(0), 'var(--text-secondary)');
  assert.strictEqual(directionColor(null), 'var(--text-secondary)');
  assert.strictEqual(directionColor(undefined), 'var(--text-secondary)');
});
check('formatPercentChange: 양수는 +, 음수는 원부호 그대로, null은 -', () => {
  assert.strictEqual(formatPercentChange(3.5), '+3.5%');
  assert.strictEqual(formatPercentChange(-3.5), '-3.5%');
  assert.strictEqual(formatPercentChange(null), '-');
});
check('formatTradeCount / isLowSample', () => {
  assert.strictEqual(formatTradeCount(1234), '1,234건');
  assert.strictEqual(isLowSample(1), true);
  assert.strictEqual(isLowSample(2), true);
  assert.strictEqual(isLowSample(3), false);
  assert.strictEqual(isLowSample(0), false);
});

// ---- 2. deterministic insight builder(§5/§27/§45 — AI 생성/투자 추천 표현 금지) ----
console.log('--- deterministic ranking insight (§5/§27/§45) ---');
check('결과 0건이면 null(억지로 문장을 만들지 않음)', () => {
  assert.strictEqual(buildRankingInsight({ regionLabel: '부산 서구', items: [], criterionPhrase: '하락폭이 큰' }), null);
});
check('1위 이름/값/전체 건수를 실제 데이터 그대로 조립', () => {
  const insight = buildRankingInsight({
    regionLabel: '부산 서구',
    criterionPhrase: '하락폭이 큰',
    items: [{ name: '테스트단지', valueLabel: '-10%', tradeCount: 5 }, { name: '단지2', valueLabel: '-8%', tradeCount: 4 }],
  });
  assert.ok(insight!.includes('부산 서구'));
  assert.ok(insight!.includes('하락폭이 큰'));
  assert.ok(insight!.includes('테스트단지'));
  assert.ok(insight!.includes('-10%'));
  assert.ok(insight!.includes('2곳'));
});
check('표본이 적으면(<3건) "적어 참고용" 문구가 붙음', () => {
  const insight = buildRankingInsight({ regionLabel: '부산 서구', criterionPhrase: '상승폭이 큰', items: [{ name: 'A', valueLabel: '+5%', tradeCount: 1 }] });
  assert.ok(insight!.includes('적어'));
});
check('금지 표현("매수 추천"/"투자 적기"/"확정") 자체를 포함하지 않음', () => {
  const insight = buildRankingInsight({ regionLabel: '부산 서구', criterionPhrase: '하락폭이 큰', items: [{ name: 'A', valueLabel: '-5%', tradeCount: 5 }] });
  for (const banned of ['매수 추천', '투자 적기', '저평가 확정', '오를 가능성']) {
    assert.ok(!insight!.includes(banned), `금지 표현 포함됨: ${banned}`);
  }
});
check('같은 입력이면 항상 같은 문자열(호출마다 값이 바뀌지 않음 — AI 생성이 아님을 실측 확인)', () => {
  const params = { regionLabel: '부산 서구', criterionPhrase: '최근 거래가 많은', items: [{ name: 'A', valueLabel: '10건', tradeCount: 10 }] };
  assert.strictEqual(buildRankingInsight(params), buildRankingInsight(params));
});

// ---- 3. STATS_MENU 무결성(§2 route inventory) ----
console.log('--- STATS_MENU inventory integrity (§2) ---');
check('16개 메뉴 전부 존재(9 live + ... 실제 개수 그대로, 누락 없음)', () => {
  assert.strictEqual(STATS_MENU.length, 16);
});
check('모든 메뉴가 category(5개 중 하나)를 가짐', () => {
  STATS_MENU.forEach((m) => {
    assert.ok(STATS_CATEGORIES.includes(m.category), `${m.slug}의 category(${m.category})가 STATS_CATEGORIES에 없음`);
  });
});
check('모든 메뉴가 Icon(Lucide 컴포넌트)을 가짐 — emoji만 있는 항목 없음', () => {
  STATS_MENU.forEach((m) => {
    assert.ok(typeof m.Icon === 'function' || typeof m.Icon === 'object', `${m.slug}에 Icon이 없음`);
  });
});
check('soon 메뉴는 전부 soonReason이 있음(임의 추정치 대신 이유 명시)', () => {
  STATS_MENU.filter((m) => m.status === 'soon').forEach((m) => {
    assert.ok(m.soonReason && m.soonReason.length > 0, `${m.slug}(soon)에 soonReason이 없음`);
  });
});

// ---- 4. RankingRow/공용 컴포넌트 wiring(정적 확인, §8) ----
console.log('--- RankingRow/foundation wiring (static check, §8) ---');
check('type-client.tsx가 RankingRow/RankingList/Empty/ErrorState/SectionHeader/FilterChip/InlineLoading을 모두 사용함', () => {
  const src = readSrc('src/app/stats/[type]/type-client.tsx');
  for (const name of ['RankingRow', 'RankingList', 'Empty', 'ErrorState', 'SectionHeader', 'FilterChip', 'InlineLoading']) {
    assert.ok(src.includes(name), `${name}를 찾을 수 없음`);
  }
});
check('RANKING_CONFIGS 5개 전부 criterionPhrase(§27/§44 판단 근거)를 가짐', () => {
  const src = readSrc('src/app/stats/[type]/type-client.tsx');
  const matches = [...src.matchAll(/criterionPhrase:\s*'[^']+'/g)];
  assert.strictEqual(matches.length, 5, `criterionPhrase 5개를 찾아야 하는데 ${matches.length}개 찾음`);
});

// ---- 5. emoji 제거(§12, 이번 STEP에서 손댄 영역만) ----
console.log('--- emoji removal in touched Statistics files (§12) ---');
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
check('type-client.tsx에 더 이상 emoji가 없음', () => {
  const src = readSrc('src/app/stats/[type]/type-client.tsx');
  const codeOnly = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  assert.ok(!EMOJI_PATTERN.test(codeOnly), 'emoji 문자가 코드에 남아있음');
});
check('stats-client.tsx(landing)에 더 이상 emoji가 없음', () => {
  const src = readSrc('src/app/stats/stats-client.tsx');
  const codeOnly = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  assert.ok(!EMOJI_PATTERN.test(codeOnly), 'emoji 문자가 코드에 남아있음');
});

// ---- 6. gapInvest 데이터 정확성 disclaimer(§3/§17 audit finding) ----
console.log('--- gapInvest disclaimer (data-audit finding, §17) ---');
check('갭투자 화면에 면적/시점 불일치 가능성 disclaimer가 있음(계산 로직은 미변경)', () => {
  const src = readSrc('src/app/stats/[type]/type-client.tsx');
  assert.ok(src.includes('면적') && src.includes('시점'), 'gapInvest disclaimer 문구가 없음');
});
check('gapInvest API 계산 로직(dashboard/route.ts)은 이번 STEP에서 변경하지 않음', () => {
  const src = readSrc('src/app/api/stats/dashboard/route.ts');
  assert.ok(src.includes('gap = latestApt.dealAmount - latestRent.dealAmount'), '기존 계산식이 그대로 남아있어야 함(UI만 개선, 계산 임의 변경 금지 원칙)');
});

// ---- 7. 12px 이하 typography 금지(§38) ----
console.log('--- 12px floor (§38) ---');
check('stats/page.module.css에 0.6rem/0.65rem/0.72rem font-size가 더 이상 없음', () => {
  const src = readSrc('src/app/stats/page.module.css');
  const violations = [...src.matchAll(/font-size:\s*0\.(?:[1-5]\d?|6|65|7|72)rem/g)];
  assert.strictEqual(violations.length, 0, `12px 미만 font-size ${violations.length}건 발견`);
});
check('RankingRow.module.css에 12px 미만 font-size가 없음', () => {
  const src = readSrc('src/components/ui/RankingRow.module.css');
  const violations = [...src.matchAll(/font-size:\s*0\.(?:[1-5]\d?|6|65|7|72)rem/g)];
  assert.strictEqual(violations.length, 0, `12px 미만 font-size ${violations.length}건 발견`);
});

console.log(`\n${passed} checks passed.`);
if (process.exitCode) {
  console.error('SOME CHECKS FAILED');
} else {
  console.log('ALL CHECKS PASSED');
}
