import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { complexCountLabel, complexRowLabels } from './complex-row-labels';

/**
 * REPORT_TOP_COMPLEX_ROW_UI_TUNE_V1 — 한장 리포트 "거래가 많은 단지" 행 계약.
 *
 * 고친 문제: 단지명 아래 작은 글씨로 `동 · N건 거래`가 다시 나왔다. 이 섹션에는 가격이
 * 없어 오른쪽(가격 자리)은 비어 있었고, 같은 건수 정보가 두 줄로 흩어져 한장 리포트의
 * 세로 예산만 먹었다. 이제 한 줄 `[단지명] [N건]`이다.
 *
 * UI 표현만 바꿨다 — 건수 계산·단지 ranking·정렬·기간·집계·canonical identity·report
 * API는 건드리지 않았다. 아래 테스트가 그 경계도 함께 고정한다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 코드를 인용한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SHEET = read('src/components/report/RegionReportSheet.tsx');
const CSS = read('src/components/report/ReportSheet.module.css');
const AGGREGATE = read('src/lib/report/region-aggregate.ts');
const REGION_REPORT = read('src/lib/report/region-report.ts');

// ── 1~3. 이름과 건수 표기 ─────────────────────────────────────────────────────

test('§9-1 단지명이 그대로 렌더된다 — 평상시에는 덧붙이는 것이 없다', () => {
  const labels = complexRowLabels(
    [
      { aptName: '대신해모로센트럴아파트', dong: '대신동' },
      { aptName: '래미안장전', dong: '장전동' },
      { aptName: '삼익비치', dong: '남천동' },
    ],
    true
  );
  assert.deepEqual(labels, ['대신해모로센트럴아파트', '래미안장전', '삼익비치']);
});

test('§9-2 건수는 "5건"으로 쓴다', () => {
  assert.equal(complexCountLabel(5), '5건');
  assert.equal(complexCountLabel(16), '16건');
  assert.equal(complexCountLabel(3), '3건');
  assert.equal(complexCountLabel(123), '123건');
});

test('§9-3 "5건 거래" 표기를 쓰지 않는다', () => {
  assert.ok(!/거래$/.test(complexCountLabel(5)), '건수 라벨에 "거래"가 붙었다');
  // 리포트 시트 코드 어디에도 그 형태가 남아 있지 않다.
  assert.ok(!/건 거래/.test(codeOf(SHEET)), '시트에 "N건 거래" 표기가 남아 있다');
});

test('값이 없거나 숫자가 아니면 0건으로 떨어진다 — 라벨이 깨지지 않는다', () => {
  assert.equal(complexCountLabel(null), '0건');
  assert.equal(complexCountLabel(undefined), '0건');
  assert.equal(complexCountLabel('7'), '7건');
  assert.equal(complexCountLabel('abc'), '0건');
});

// ── 4. 지역 부줄 제거 + 동일 이름 예외 감사 ──────────────────────────────────

test('§3 같은 목록에 같은 이름이 없으면 지역을 붙이지 않는다', () => {
  const labels = complexRowLabels([{ aptName: '유림노르웨이숲', dong: '구포동' }], true);
  assert.deepEqual(labels, ['유림노르웨이숲']);
});

test('§3 같은 이름이 둘 이상이고 동이 다르면 그 행들만 동을 덧붙인다', () => {
  // Production 실측: 부산진구 `유림노르웨이숲`이 구포동 50건 / 만덕동 13건으로 따로 있다.
  const labels = complexRowLabels(
    [
      { aptName: '유림노르웨이숲', dong: '구포동' },
      { aptName: '래미안장전', dong: '장전동' },
      { aptName: '유림노르웨이숲', dong: '만덕동' },
    ],
    true
  );
  assert.deepEqual(labels, ['유림노르웨이숲 (구포동)', '래미안장전', '유림노르웨이숲 (만덕동)']);
});

test('§3 동까지 같으면 덧붙이지 않는다 — 붙여도 구분이 안 된다', () => {
  // 실측: 43개 동명이인 그룹 중 1건은 법정동까지 같다(부곡늘푸른아파트, 부곡동 2건).
  const labels = complexRowLabels(
    [
      { aptName: '부곡늘푸른아파트', dong: '부곡동' },
      { aptName: '부곡늘푸른아파트', dong: '부곡동' },
    ],
    true
  );
  assert.deepEqual(labels, ['부곡늘푸른아파트', '부곡늘푸른아파트']);
});

test('§3 동 단위 리포트에서는 절대 덧붙이지 않는다 — 이미 한 동 안이다', () => {
  const labels = complexRowLabels(
    [
      { aptName: '같은이름', dong: '가동' },
      { aptName: '같은이름', dong: '나동' },
    ],
    false
  );
  assert.deepEqual(labels, ['같은이름', '같은이름']);
});

test('§3 동을 모르는 행은 없는 지역명을 만들어 붙이지 않는다', () => {
  const labels = complexRowLabels(
    [
      { aptName: '같은이름', dong: null },
      { aptName: '같은이름', dong: '가동' },
    ],
    true
  );
  // 동이 하나뿐(=구분할 다른 값이 없음)이라 어느 쪽에도 붙이지 않는다.
  assert.deepEqual(labels, ['같은이름', '같은이름']);
});

test('반환 배열은 입력과 같은 길이·같은 순위 순서다 — 행이 늘거나 섞이지 않는다', () => {
  const rows = [
    { aptName: 'A', dong: '가동' },
    { aptName: 'B', dong: '나동' },
    { aptName: 'A', dong: '다동' },
    { aptName: 'C', dong: null },
    { aptName: 'D', dong: '라동' },
  ];
  const labels = complexRowLabels(rows, true);
  assert.equal(labels.length, rows.length);
  assert.ok(labels[0].startsWith('A'));
  assert.ok(labels[1].startsWith('B'));
  assert.ok(labels[3].startsWith('C'));
});

test('§4 지역 부줄(작은 글씨 지역 + 건수)이 이 섹션에서 사라졌다', () => {
  const code = codeOf(SHEET);
  const at = code.indexOf('function ComplexCountSection');
  assert.ok(at > -1, 'ComplexCountSection이 없다');
  const body = code.slice(at, code.indexOf('function TradeSection'));
  // 부줄용 클래스를 쓰지 않는다.
  assert.ok(!/styles\.tradeDate/.test(body), '작은 글씨 부줄이 남아 있다');
  assert.ok(!/styles\.tradeMeta/.test(body), '2줄 구조가 남아 있다');
  // 행에 들어가는 span은 이름과 건수 둘뿐이다.
  assert.ok(/styles\.complexName/.test(body));
  assert.ok(/styles\.complexCount/.test(body));
  assert.equal((body.match(/<span className=\{styles\./g) ?? []).length, 2, '행에 span이 2개가 아니다');
});

// ── 5~6. 긴 이름 / 건수 잘림 방지 ─────────────────────────────────────────────

test('§5 긴 이름이 건수를 밀어내지 않는다 — 이름만 줄고 말줄임된다', () => {
  const row = CSS.slice(CSS.indexOf('.complexRow {'), CSS.indexOf('.complexCount {') + 400);
  // 왼쪽: 줄어들 수 있고 말줄임한다.
  const name = CSS.slice(CSS.indexOf('.complexName {'), CSS.indexOf('.complexCount {'));
  assert.ok(/flex:\s*1/.test(name), '이름이 남은 폭을 채우지 않는다');
  assert.ok(/min-width:\s*0/.test(name), 'min-width: 0이 없어 flex 축소가 막힌다');
  assert.ok(/overflow:\s*hidden/.test(name));
  assert.ok(/text-overflow:\s*ellipsis/.test(name), '긴 이름이 말줄임되지 않는다');
  assert.ok(/white-space:\s*nowrap/.test(name), '이름이 두 줄로 늘어난다');
  // 오른쪽: 줄어들지 않고 줄바꿈하지 않는다.
  const count = CSS.slice(CSS.indexOf('.complexCount {'), CSS.indexOf('.complexCount {') + 300);
  assert.ok(/flex-shrink:\s*0/.test(count), '건수가 밀려 잘릴 수 있다');
  assert.ok(/white-space:\s*nowrap/.test(count), '건수가 줄바꿈된다');
  // 행 자체는 한 줄 flex다.
  assert.ok(/display:\s*flex/.test(row));
  assert.ok(/justify-content:\s*space-between/.test(row));
  assert.ok(/align-items:\s*center/.test(row));
});

test('§4 건수를 과하게 강조하지 않았다 — 이름보다 크거나 굵지 않다', () => {
  const name = CSS.slice(CSS.indexOf('.complexName {'), CSS.indexOf('.complexCount {'));
  const count = CSS.slice(CSS.indexOf('.complexCount {'), CSS.indexOf('.complexCount {') + 300);
  const size = (block: string) => Number(block.match(/font-size: calc\(([\d.]+)rem/)?.[1] ?? 0);
  const weight = (block: string) => Number(block.match(/font-weight:\s*(\d+)/)?.[1] ?? 0);
  assert.ok(size(count) > 0 && size(name) > 0, 'font-size를 읽지 못했다');
  assert.ok(size(count) <= size(name), '건수가 이름보다 크다');
  assert.ok(weight(count) <= weight(name), '건수가 이름보다 굵다');
  assert.ok(weight(count) >= 700, '건수가 한눈에 보이지 않는다');
  // 2·3자리가 섞여도 오른쪽 끝이 흔들리지 않는다.
  assert.ok(/font-variant-numeric:\s*tabular-nums/.test(count), '숫자 폭이 고정되지 않았다');
});

test('§6 세로 밀도는 기존 토큰을 공유한다 — A4/print 모드가 그대로 적용된다', () => {
  const row = CSS.slice(CSS.indexOf('.complexRow {'), CSS.indexOf('.complexRow:last-child'));
  assert.ok(/padding: var\(--r-trade-pad\) 0/.test(row), '밀도 토큰을 쓰지 않아 export 모드에서 따로 낡는다');
  // 토큰이 export 모드에서 실제로 덮어써진다(회귀 방지).
  assert.ok(/--r-trade-pad: 5px;/.test(CSS), 'A4 밀도 값이 사라졌다');
  assert.ok(/--r-trade-pad: 3px;/.test(CSS), 'print 밀도 값이 사라졌다');
});

// ── 7. 데이터 로직 무변경 ────────────────────────────────────────────────────

test('§7 건수·순위·정렬·집계 로직을 건드리지 않았다', () => {
  const code = codeOf(AGGREGATE);
  // 그룹 키는 여전히 aptSeq 우선이고, 정렬은 건수 → 최신 거래일 → 이름 순이다.
  assert.ok(/const key = r\.aptSeq \? `id:\$\{r\.aptSeq\}` : `nd:\$\{r\.aptName\}\|\$\{normalizeDong\(r\.dong\) \?\? ''\}`/.test(code),
    'identity 그룹 키가 바뀌었다');
  assert.ok(/\.sort\(\(a, b\) => \(b\.count - a\.count\) \|\| b\.latestDealDate\.localeCompare\(a\.latestDealDate\) \|\| a\.aptName\.localeCompare\(b\.aptName\)\)/.test(code),
    'ranking 정렬이 바뀌었다');
  assert.ok(/cur\.count \+= 1;/.test(code), '건수 계산이 바뀌었다');
});

test('§7 섹션 정의(제목·행 수·trust·cells)가 그대로다', () => {
  const code = codeOf(REGION_REPORT);
  assert.ok(/const complexes = representativeComplexes\(rows, 5\);/.test(code), '상위 개수가 바뀌었다');
  assert.ok(/title: '거래가 많은 단지'/.test(code), '섹션 제목이 바뀌었다');
  assert.ok(/cells: \{ aptSeq: c\.aptSeq, aptName: c\.aptName, dong: c\.dong, count: c\.count, latestDealDate: c\.latestDealDate \}/.test(code),
    '섹션이 내려주는 cells가 바뀌었다(UI 변경이 데이터 계약을 건드렸다)');
  assert.ok(/trust: complexes\.length > 0 \? \(gate\.sampleSufficient \? 'SAFE' : 'LIMITED'\) : 'MISSING'/.test(code),
    'trust 판정이 바뀌었다');
});

test('§7 identity는 여전히 aptSeq다 — 이름으로 상세를 링크하지 않는다', () => {
  const code = codeOf(SHEET);
  assert.ok(/if \(!aptSeq \|\| typeof name !== 'string'\) return null;/.test(code), 'aptSeq 없이 링크를 만든다');
  assert.ok(/aptSeq=\$\{encodeURIComponent\(String\(aptSeq\)\)\}/.test(code), '링크가 aptSeq를 싣지 않는다');
  // 새 섹션도 같은 함수를 쓴다(별도 링크 규칙을 만들지 않았다).
  const at = code.indexOf('function ComplexCountSection');
  const body = code.slice(at, code.indexOf('function TradeSection'));
  assert.ok(/const href = aptHref\(r\.cells\);/.test(body), '새 섹션이 링크 규칙을 따로 만들었다');
});

test('§9-7 표시 이름 로직은 순수하다 — 데이터/네트워크에 닿지 않는다', () => {
  const code = codeOf(read('src/lib/report/complex-row-labels.ts'));
  assert.ok(!/prisma|fetch|import /.test(code), '표시 로직이 데이터 계층에 닿는다');
});

// ── 8. 다른 섹션 무영향 ──────────────────────────────────────────────────────

test('§8 최근 실거래 행은 그대로다 — 2줄 구조와 가격을 유지한다', () => {
  const code = codeOf(SHEET);
  const at = code.indexOf('function TradeSection');
  const body = code.slice(at, code.indexOf('function formatManwon'));
  assert.ok(/styles\.tradeRow/.test(body), '최근 실거래 행 클래스가 바뀌었다');
  assert.ok(/styles\.tradeMeta/.test(body), '최근 실거래의 2줄 구조가 사라졌다');
  assert.ok(/styles\.tradeDate/.test(body), '최근 실거래의 부줄이 사라졌다');
  assert.ok(/styles\.tradePrice/.test(body), '최근 실거래의 가격이 사라졌다');
  assert.ok(/전용 \$\{area\}㎡/.test(body), '전용면적 표기가 바뀌었다');
  assert.ok(/\{recent && recent\.rows\.length > 0 && <TradeSection section=\{recent\} showDong=\{showDong\} \/>\}/.test(code),
    '최근 실거래가 다른 컴포넌트로 바뀌었다');
});

test('§8 분포·하이라이트·KPI·해석·footer 섹션이 그대로다', () => {
  const code = codeOf(SHEET);
  assert.ok(/styles\.barRow/.test(code) && /styles\.barValue/.test(code), '분포 섹션이 바뀌었다');
  assert.ok(/\{count\}건 · \{String\(r\.cells\.share \?\? 0\)\}%/.test(code), '분포 섹션의 표기가 바뀌었다');
  assert.ok(/styles\.highlightContext/.test(code), '하이라이트의 기간 문구가 사라졌다');
  assert.ok(/KpiCard/.test(code) && /TrustFooter/.test(code), 'KPI/footer가 바뀌었다');
  assert.ok(/envelope\.interpretation\.text/.test(code), '해석 섹션이 사라졌다');
});

test('§8 기존 CSS 클래스를 덮어쓰지 않았다 — 새 클래스만 추가했다', () => {
  // .tradeRow / .tradeMeta / .tradeDate / .tradePrice 정의가 각각 하나뿐이다.
  for (const cls of ['.tradeRow {', '.tradeMeta {', '.tradeDate {', '.tradePrice {', '.barRow {', '.barValue {']) {
    const count = CSS.split(cls).length - 1;
    assert.equal(count, 1, `${cls} 정의가 ${count}개다(중복 선언으로 기존 섹션이 바뀔 수 있다)`);
  }
  // 새 클래스는 세 개다.
  for (const cls of ['.complexRow {', '.complexName {', '.complexCount {']) {
    assert.equal(CSS.split(cls).length - 1, 1, `${cls} 정의가 하나가 아니다`);
  }
});

test('§8 다른 리포트 시트는 이 섹션을 쓰지 않는다 — 영향 범위가 지역 리포트뿐이다', () => {
  for (const p of [
    'src/components/report/DailyReportSheet.tsx',
    'src/components/report/ApartmentReportSheet.tsx',
    'src/components/report/CompareReportSheet.tsx',
  ]) {
    const code = codeOf(read(p));
    // `complexRows`(단지 스펙 목록) 같은 무관한 지역 변수와 겹치지 않게 정확히 본다.
    assert.ok(!/representativeComplexes|ComplexCountSection|styles\.complexRow|styles\.complexCount/.test(code),
      `${p}가 영향을 받는다`);
  }
});

// ── 9. export 회귀 ───────────────────────────────────────────────────────────

test('§6 export 고정 크기·행 수 제한 장치를 건드리지 않았다', () => {
  const code = codeOf(SHEET);
  // 분포 막대의 고정 크기 표시는 그대로.
  assert.equal((code.match(/data-export-fixed-size=""/g) ?? []).length, 2, 'export 고정 크기 표시가 바뀌었다');
  // 새 행에는 고정 크기 요소가 없다(막대가 없으므로 필요 없다).
  const at = code.indexOf('function ComplexCountSection');
  const body = code.slice(at, code.indexOf('function TradeSection'));
  assert.ok(!/data-export-fixed-size/.test(body));
  // export 루트 표시는 유지.
  assert.ok(/data-export-root=""/.test(code), 'export 루트 표시가 사라졌다');
});
