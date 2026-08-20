/**
 * APT DETAIL QA/IA v1 — 면적 단위 변환, 평형칩 완전성, 주차 중복 제거, 교통/편의 IA
 * 분리, score identity 광역 매칭을 검증한다(§26). 기존 관례(assert 기반, 테스트
 * 러너 없음)를 따른다. DB/네트워크 없이 순수 로직만 검증하는 부분과, 소스 파일
 * 내용을 정적으로 확인하는 부분(중복 제거/IA 이동이 실제로 반영됐는지)으로 나뉜다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/verify-apt-detail-ia.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import {
  formatPyeong,
  getUniqueAreaLabels,
  getUniquePyeongLabels,
  getAreaLabelsForUnit,
  resolveAreaLabel,
} from '@/lib/area-utils';

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

// ---- 1. 평 변환 공식(§7) ----
console.log('--- pyeong conversion formula ---');
check('1평 = 3.305785㎡ 공식 그대로 사용(84㎡ → 25.4평)', () => {
  assert.strictEqual(formatPyeong(84), '약 25.4평');
});
check('59.99㎡ → 18.1평(반올림 방향 확인)', () => {
  assert.strictEqual(formatPyeong(59.99), '약 18.1평');
});

// ---- 2. 면적 normalization — 임의 round로 다른 평형을 합치지 않음(§5) ----
console.log('--- area normalization (no false merging) ---');
check('84.9404㎡와 84.9600㎡는 2자리에서 겹치면 자동으로 정밀도를 올려 구분', () => {
  const labels = getUniqueAreaLabels([84.9404, 84.96]);
  assert.notStrictEqual(labels.get(84.9404), labels.get(84.96));
});
check('평 단위도 동일 원칙 — 1자리에서 겹치는 서로 다른 ㎡는 정밀도를 올려 구분', () => {
  // 84.84㎡ ≈25.667평, 84.99㎡ ≈25.712평 — 둘 다 1자리로는 "25.7평"에서 충돌
  const labels = getUniquePyeongLabels([84.84, 84.99]);
  assert.notStrictEqual(labels.get(84.84), labels.get(84.99));
});
check('명백히 다른 면적(59㎡ vs 84㎡)은 기본 정밀도에서 이미 구분됨', () => {
  const labels = getUniqueAreaLabels([59.99, 84.96]);
  assert.strictEqual(labels.get(59.99), '59.99㎡');
  assert.strictEqual(labels.get(84.96), '84.96㎡');
});

// ---- 3. unit toggle 일관성(§9) — chip/거래표가 공유하는 단일 진입점 ----
console.log('--- unit toggle single entry point ---');
check('getAreaLabelsForUnit("㎡")는 getUniqueAreaLabels와 동일 결과', () => {
  const areas = [59.99, 84.96, 84.9404];
  const a = getAreaLabelsForUnit(areas, '㎡');
  const b = getUniqueAreaLabels(areas);
  assert.deepStrictEqual([...a.entries()], [...b.entries()]);
});
check('getAreaLabelsForUnit("평")는 getUniquePyeongLabels와 동일 결과', () => {
  const areas = [59.99, 84.96];
  const a = getAreaLabelsForUnit(areas, '평');
  const b = getUniquePyeongLabels(areas);
  assert.deepStrictEqual([...a.entries()], [...b.entries()]);
});
check('resolveAreaLabel은 전달된 단위 맵을 그대로 조회(호출부가 단위 분기를 갖지 않음)', () => {
  const pyeongLabels = getUniquePyeongLabels([84.96]);
  assert.strictEqual(resolveAreaLabel(84.96, pyeongLabels), pyeongLabels.get(84.96));
  assert.ok(resolveAreaLabel(84.96, pyeongLabels)!.endsWith('평'));
});

// ---- 4. 평형칩 완전성(§3/§4) — AreaSelector가 더 이상 상한을 두지 않음(정적 확인) ----
console.log('--- area chip completeness (static check) ---');
check('AreaSelector.tsx에 더 이상 MAX_CHIPS 상한이 없음', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/components/AreaSelector.tsx'), 'utf-8');
  assert.ok(!src.includes('MAX_CHIPS'), 'MAX_CHIPS 상수가 남아있으면 안 됨(칩이 다시 잘릴 위험)');
  assert.ok(src.includes('const chipAreas = allAreas'), 'chipAreas가 allAreas 전체를 그대로 써야 함');
});

// ---- 5. 주차 중복 제거(§11/§12, 정적 확인) ----
console.log('--- parking duplication removed (static check) ---');
check('LivingEnvironmentPanel에 ParkingGauge(주차 게이지)가 더 이상 없음', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/components/LivingEnvironmentPanel.tsx'), 'utf-8');
  assert.ok(!src.includes('ParkingGauge'), '주차 게이지가 남아있으면 AptSpecGrid(상단)와 중복');
  assert.ok(!src.includes('parseParkingRatio'));
});
check('AptSpecGrid(상단 스펙)에는 주차대수가 그대로 유지됨', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/components/AptSpecGrid.tsx'), 'utf-8');
  assert.ok(src.includes('주차대수'), '상단 핵심 스펙에서 주차 정보 자체가 사라지면 안 됨(중복 "제거"이지 정보 "삭제" 아님)');
});

// ---- 6. 교통/편의 IA 분리(§13, 정적 확인) ----
console.log('--- transport/living IA split (static check) ---');
check('NeighborhoodInfoPanel(교통)에는 더 이상 마트/편의점/약국/어린이집/병원/공원이 없음', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/components/NeighborhoodInfoPanel.tsx'), 'utf-8');
  for (const moved of ['MT1', 'CS2', 'PM9', 'PS3', "keywords={['공원']}", 'HP8']) {
    assert.ok(!src.includes(moved), `교통 탭에 아직 남아있으면 안 되는 코드: ${moved}`);
  }
  assert.ok(src.includes('SW8'), '지하철(대중교통)은 교통 탭에 남아있어야 함');
  assert.ok(src.includes('KTX'), '광역교통은 교통 탭에 남아있어야 함');
});
check('LivingEnvironmentPanel(주거환경)에 마트/편의점/약국/어린이집/병원/공원이 전부 있음', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/components/LivingEnvironmentPanel.tsx'), 'utf-8');
  for (const added of ['MT1', 'CS2', 'PM9', 'PS3', "keywords={['공원']}", 'HP8']) {
    assert.ok(src.includes(added), `주거환경 탭으로 옮겨졌어야 하는 코드가 없음: ${added}`);
  }
});

console.log(`\n${passed} checks passed.`);
if (process.exitCode) {
  console.error('SOME CHECKS FAILED');
} else {
  console.log('ALL CHECKS PASSED');
}
