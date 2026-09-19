// SEOUL_BUILDING_LEDGER_ENRICHMENT_PLAN_V1 — 건축물대장 응답 판정(순수 함수) + 스크립트 소스 계약.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  regionConfig,
  ledgerNumOfRows,
  LENIENT_POLICY,
  STRICT_POLICY,
  recordMatchesLot,
  decideGeneralTitle,
  extractGeneralFields,
  decideTitleFallback,
  crossCheckGeneralVsTitle,
  pickSeoulSample,
  SEOUL_SAMPLE_DISTRICTS,
  ledgerPageParams,
  countMainBuildings,
} from './backfill-basic-data-logic.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = fs.readFileSync(path.join(here, 'backfill-apartment-master-basic-data.ts'), 'utf-8');
const LOGIC = fs.readFileSync(path.join(here, 'backfill-basic-data-logic.ts'), 'utf-8');

const Q = { sggCd: '11680', umdCd: '10600', bun: '0316', ji: '0000' }; // 대치동 316
const rec = (over = {}) => ({ sigunguCd: '11680', bjdongCd: '10600', platGbCd: '0', bun: '0316', ji: '0000', hhldCnt: 4424, bldNm: '은마', ...over });
const numbered = (d) => /^\d+동$/.test(String(d ?? '').trim());

// 기존 부산 코드(수정 전 fetchGeneralTitleOnce 본문)를 그대로 옮긴 기준 구현 — LENIENT가 이것과 같아야 한다.
function oldBusanGeneral(arr, rawPk) {
  if (arr.length === 0) return { status: 'not_found' };
  const target = arr.reduce((best, cur) => ((cur.hhldCnt || 0) > (best.hhldCnt || 0) ? cur : best));
  return { status: 'success', record: target, mgmBldrgstPk: arr.length === 1 && rawPk ? rawPk : (target.mgmBldrgstPk != null ? String(target.mgmBldrgstPk) : null) };
}
function oldBusanTitle(arr) {
  if (arr.length === 0) return 'not_found';
  if (arr.length > 1) return 'multiple_review';
  if (numbered(arr[0]?.dongNm)) return 'building_unit_review';
  return 'success';
}

// 1
test('1. --region=11은 서울 prefix와 STRICT 정책, 등록되지 않은 지역은 거부', () => {
  assert.deepEqual(regionConfig('11'), { sggPrefix: '11', policy: STRICT_POLICY });
  assert.equal(regionConfig('41'), null);
  assert.equal(regionConfig(''), null);
  assert.equal(ledgerNumOfRows(STRICT_POLICY), 100);
  assert.match(SCRIPT, /region: get\('--region'\) \?\? '26'/);
  assert.match(SCRIPT, /regionConfig\(opts\.region\)/);
  assert.equal(SEOUL_SAMPLE_DISTRICTS.length, 6);
  assert.ok(SEOUL_SAMPLE_DISTRICTS.every((d) => d.startsWith('11')));
  // --district는 서울 구 코드만, 구 단위 산출물 폴더(재개 단위)
  assert.match(SCRIPT, /if \(opts\.district && !\/\^11\\d\{3\}\$\/\.test\(opts\.district\)\)/);
  assert.match(SCRIPT, /sggCd: opts\.district \? opts\.district : \{ startsWith: '11' \}/);
});

// 2
test('2. 부산(기본 26) 동작 불변 — LENIENT 판정이 기존 코드와 같다', () => {
  assert.deepEqual(regionConfig('26'), { sggPrefix: '26', policy: LENIENT_POLICY });
  assert.equal(ledgerNumOfRows(LENIENT_POLICY), 5);
  const bq = { sggCd: '26470', umdCd: '10200', bun: '0001', ji: '0000' };
  const fixtures = [
    [],
    [rec({ sigunguCd: '26470', mgmBldrgstPk: 11 })],
    [rec({ hhldCnt: 10, mgmBldrgstPk: 1 }), rec({ hhldCnt: 300, mgmBldrgstPk: 2 }), rec({ hhldCnt: 50, mgmBldrgstPk: 3 })],
    [rec({ bjdongCd: '99999', mgmBldrgstPk: 7 })], // 필지 불일치도 부산은 기존대로 통과
  ];
  for (const arr of fixtures) {
    for (const rawPk of [null, '1234-5']) {
      const now = decideGeneralTitle(arr, 999, rawPk, bq, LENIENT_POLICY); // totalCount도 부산은 보지 않는다
      const old = oldBusanGeneral(arr, rawPk);
      assert.equal(now.status, old.status);
      if (old.status === 'success') { assert.equal(now.record, old.record); assert.equal(now.mgmBldrgstPk, old.mgmBldrgstPk); }
    }
  }
  for (const arr of [[], [rec()], [rec(), rec()], [rec({ dongNm: '103동' })], [rec({ bun: '9999' })]]) {
    assert.equal(decideTitleFallback(arr, 999, bq, LENIENT_POLICY, numbered), oldBusanTitle(arr));
  }
  // 부산 결과 폴더·주소 계획 미포함·표제부 다건 REVIEW 유지
  assert.match(SCRIPT, /REGION_ARG === '26'\s*\n\s*\? path\.resolve\(__dirname, '_data_coverage_fix_v1_results'\)/);
  assert.match(SCRIPT, /if \(policy\.strict\) \{\s*\n\s*plans\.push\(planField\('roadAddress'/);
  assert.match(SCRIPT, /outcome: policy\.strict \? 'MULTIPLE' : 'REVIEW'/);
});

// 3
test('3. EXACT_LOT — 시군구·법정동·대지구분·본번·부번이 모두 같을 때만 success', () => {
  assert.equal(recordMatchesLot(rec(), Q), true);
  assert.equal(recordMatchesLot(rec({ bun: '316', ji: '0' }), Q), true); // 자릿수 차이는 같은 필지
  const d = decideGeneralTitle([rec({ mgmBldrgstPk: 777 })], 1, null, Q, STRICT_POLICY);
  assert.equal(d.status, 'success');
  assert.equal(d.mgmBldrgstPk, '777');
});

// 4
test('4. 여러 건이면 대표값을 고르지 않고 보류(MULTIPLE)', () => {
  const arr = [rec({ hhldCnt: 10 }), rec({ hhldCnt: 4000 })];
  assert.equal(decideGeneralTitle(arr, 2, null, Q, STRICT_POLICY).status, 'multiple');
  assert.equal(decideTitleFallback(arr, 2, Q, STRICT_POLICY, numbered), 'multiple_review');
  assert.match(SCRIPT, /general\.status === 'multiple'\) return \{ outcome: 'MULTIPLE'/);
});

// 5
test('5. 유사·근접·부분 일치 금지 — 필지가 하나라도 다르면 lot_mismatch, 이름은 판정에 쓰지 않는다', () => {
  for (const over of [{ ji: '0001' }, { bun: '0317' }, { bjdongCd: '10500' }, { sigunguCd: '11650' }, { platGbCd: '1' }]) {
    assert.equal(decideGeneralTitle([rec(over)], 1, null, Q, STRICT_POLICY).status, 'lot_mismatch', JSON.stringify(over));
    assert.equal(decideTitleFallback([rec(over)], 1, Q, STRICT_POLICY, numbered), 'lot_mismatch', JSON.stringify(over));
  }
  assert.equal(recordMatchesLot(rec({ bldNm: '전혀 다른 이름' }), Q), true);
  assert.equal(recordMatchesLot(rec({ bldNm: '은마', ji: '0002' }), Q), false);
  assert.doesNotMatch(LOGIC, /bldNm/);
  assert.doesNotMatch(LOGIC + SCRIPT, /levenshtein|similarity|fuzzy\(|\.startsWith\(row\.name|\.includes\(row\.name/i);
});

// 6
test('6. 총괄표제부 — 필드 파싱(0 이하·형식 오류는 null) + 주소 원문', () => {
  const f = extractGeneralFields({ hhldCnt: '4424', totPkngCnt: '0', mainBldCnt: '28', vlRat: '204.1', bcRat: 'x', useAprDay: '19791206', newPlatPlc: ' 서울특별시 강남구 삼성로 212 ', platPlc: '서울특별시 강남구 대치동 316번지' }, 'PK');
  assert.deepEqual(f, {
    totalHouseholds: 4424, mainBuildingCount: 28, parkingCount: null, useApprovalDate: '19791206', mgmBldrgstPk: 'PK',
    floorAreaRatio: 204.1, buildingCoverageRatio: null, roadAddress: '서울특별시 강남구 삼성로 212', jibunAddress: '서울특별시 강남구 대치동 316번지',
  });
  assert.equal(extractGeneralFields({ useAprDay: '1979' }, null).useApprovalDate, null);
});

// 7
test('7. 표제부 fallback — 정확히 1건·필지 일치·동번호 단위 아님일 때만 success', () => {
  assert.equal(decideTitleFallback([rec({ dongNm: '' })], 1, Q, STRICT_POLICY, numbered), 'success');
  assert.equal(decideTitleFallback([rec({ dongNm: '103동' })], 1, Q, STRICT_POLICY, numbered), 'building_unit_review');
  assert.equal(decideTitleFallback([rec()], 3, Q, STRICT_POLICY, numbered), 'incomplete');
  assert.equal(decideTitleFallback([], 0, Q, STRICT_POLICY, numbered), 'not_found');
  assert.equal(decideGeneralTitle([rec()], 5, null, Q, STRICT_POLICY).status, 'incomplete');
});

// 8
test('8. 총괄표제부 vs 단일 표제부 세대수가 다르면 CONFLICT(병합 금지)', () => {
  assert.equal(crossCheckGeneralVsTitle(4424, [rec({ hhldCnt: '4424' })]), 'NO_CONFLICT');
  assert.equal(crossCheckGeneralVsTitle(4424, [rec({ hhldCnt: '4400' })]), 'CONFLICT');
  assert.equal(crossCheckGeneralVsTitle(4424, [rec(), rec()]), 'NOT_COMPARABLE');
  assert.equal(crossCheckGeneralVsTitle(null, [rec()]), 'NOT_COMPARABLE');
  assert.equal(crossCheckGeneralVsTitle(4424, [rec({ hhldCnt: '0' })]), 'NOT_COMPARABLE');
  assert.match(SCRIPT, /=== 'CONFLICT'\) \{\s*\n\s*return \{ outcome: 'CONFLICT', source: null, plans: \[\]/);
});

// 9
test('9. 서울 dry-run은 DB에 쓰지 않는다 — apply 차단 + 서울 경로에 write 호출 없음', () => {
  const seoulBody = SCRIPT.slice(SCRIPT.indexOf('async function runSeoulDryRun'), SCRIPT.indexOf('// CLI로 직접 실행됐을 때만'));
  assert.ok(seoulBody.length > 500);
  assert.doesNotMatch(seoulBody, /\.(update|updateMany|create|createMany|upsert|delete|deleteMany)\s*\(|\$executeRaw|saveCheckpoint/);
  assert.match(seoulBody, /writes: \{ insert: 0, update: 0, delete: 0 \}/);
  const gate = SCRIPT.slice(SCRIPT.indexOf('const isSeoul'), SCRIPT.indexOf('const where: any'));
  assert.match(gate, /if \(opts\.apply\) \{[\s\S]*BLOCKED[\s\S]*return;/);
  assert.ok(gate.indexOf('opts.apply') < gate.indexOf('runSeoulDryRun'));
  assert.match(gate, /assertProductionDbAccessAllowed\('DIAGNOSTIC'/);
});

// 10
test('10. 매매 sync·취소 코드를 import하거나 건드리지 않는다', () => {
  for (const src of [SCRIPT, LOGIC]) {
    assert.doesNotMatch(src, /sale-sync-core|backfill-seoul-sale|sale-molit-fetch|reconcileGroupCancellation|cancellation/);
  }
});

test('서울 표본 — 구마다 구축/신축 반씩, aptSeq 순 결정적', () => {
  const rows = [];
  for (const d of ['11680', '11140', '11110']) for (let i = 0; i < 40; i++) rows.push({ aptSeq: `${d}-${1000 + i}`, sggCd: d, buildYear: i % 2 ? 1990 : 2015 });
  const a = pickSeoulSample(rows, ['11680', '11140'], 10);
  const b = pickSeoulSample([...rows].reverse(), ['11680', '11140'], 10);
  assert.deepEqual(a.map((r) => r.aptSeq), b.map((r) => r.aptSeq));
  assert.equal(a.length, 20);
  assert.ok(a.every((r) => r.sggCd !== '11110'));
  assert.equal(a.filter((r) => r.buildYear < 2005).length, 10);
});

test('페이지 파라미터 — STRICT는 pageNo=1(없으면 API가 1건만 준다), 부산 URL은 그대로', () => {
  assert.equal(ledgerPageParams(STRICT_POLICY), 'numOfRows=100&pageNo=1');
  assert.equal(ledgerPageParams(LENIENT_POLICY), 'numOfRows=5');
  assert.equal((SCRIPT.match(/&\$\{ledgerPageParams\(policy\)\}&_type=json/g) || []).length, 2);
  // 교차 확인은 완전한 단일 레코드 목록일 때만
  assert.match(SCRIPT, /const comparable = title\.status === 'success' \|\| title\.status === 'building_unit_review';/);
});

test('주건축물 수(보고용) — 부속건축물은 세지 않는다', () => {
  assert.equal(countMainBuildings([{ mainAtchGbCd: '0' }, { mainAtchGbCd: '1', mainAtchGbCdNm: '부속건축물' }]), 1);
  assert.equal(countMainBuildings([{ mainAtchGbCdNm: '주건축물' }, { mainAtchGbCd: '0' }]), 2);
  assert.equal(countMainBuildings([]), 0);
});
