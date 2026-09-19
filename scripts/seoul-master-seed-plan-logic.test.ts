import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateCandidates,
  auditDuplicates,
  classifyCoordinate,
  classifyIdentity,
  quotaWindows,
  reconcilePilotRow,
  roadAddressFromMolit,
  resolveCrossDistrict,
  buildDongCodeMap,
  resolveUmdCd,
  type RawTradeItem,
} from './seoul-master-seed-plan-logic';

// SEOUL_MASTER_SEED_PLAN_V1 — aptSeq = canonical identity. 이름·지번·좌표로 합치지 않고, 추정 aptSeq를 만들지 않는다.

const row = (o: Partial<RawTradeItem> = {}): RawTradeItem => ({
  aptSeq: '11680-218', aptNm: '은마', umdNm: '대치동', umdCd: '10600', jibun: '316', sggCd: '11680', buildYear: '1979',
  roadNm: '삼성로', roadNmBonbun: '00212', roadNmBubun: '00000', dealYear: '2026', dealMonth: '8', dealDay: '1', ...o,
});
const agg = (items: RawTradeItem[], source: 'SALE' | 'RENT' = 'SALE') => aggregateCandidates('11680', items.map((item) => ({ item, source })));

test('aptSeq 단위 집계 — 최신 계약일 표기가 대표값, 관측된 표기는 모두 보존', () => {
  const { candidates, stats } = agg([row({ aptNm: '은마아파트', dealMonth: '1' }), row({ aptNm: '은마', dealMonth: '8' }), row({ aptSeq: '11680-331', aptNm: '삼성래미안' })]);
  assert.equal(candidates.length, 2);
  const eunma = candidates.find((c) => c.aptSeq === '11680-218')!;
  assert.equal(eunma.name, '은마');
  assert.equal(eunma.tradeCount, 2);
  assert.deepEqual(eunma.names.sort(), ['은마', '은마아파트']);
  assert.equal(stats.rows, 3);
});

test('aptSeq 없는 행은 후보를 만들지 않고 센다(추정 aptSeq 금지)', () => {
  const { candidates, stats } = agg([row({ aptSeq: '' }), row({ aptSeq: undefined }), row()]);
  assert.equal(candidates.length, 1);
  assert.equal(stats.nullAptSeq, 2);
});

test('다른 구 sggCd 행은 오염으로 세고, 그 aptSeq는 REVIEW_REQUIRED', () => {
  const { candidates, stats } = agg([row({ sggCd: '41135' })]);
  assert.equal(stats.foreignSggRows, 1);
  assert.deepEqual(classifyIdentity(candidates[0]).reasons, ['SGG_CONFLICT']);
});

test('식별 필수 필드 · 형식 · 구 불일치 · 위치 충돌은 REVIEW_REQUIRED', () => {
  const v = (o: Partial<RawTradeItem>) => classifyIdentity(agg([row(o)]).candidates[0]);
  assert.equal(classifyIdentity(agg([row()]).candidates[0]).verdict, 'SEED_READY');
  assert.deepEqual(v({ aptSeq: 'ABC' }).reasons, ['APTSEQ_MALFORMED']);
  assert.deepEqual(v({ aptSeq: '26350-2' }).reasons, ['APTSEQ_DISTRICT_MISMATCH']);
  assert.deepEqual(v({ jibun: '' }).reasons, ['MISSING_JIBUN']);
  assert.deepEqual(v({ umdCd: '' }).reasons, ['MISSING_UMD']);
  const conflict = classifyIdentity(agg([row({ jibun: '316' }), row({ jibun: '317' })]).candidates[0]);
  assert.deepEqual(conflict.reasons, ['CONFLICTING_JIBUN']);
});

test('이름 alias는 identity를 흔들지 않는다(표시만), 전월세에만 있는 단지는 RENT_ONLY 표시', () => {
  const alias = classifyIdentity(agg([row({ aptNm: '은마' }), row({ aptNm: '대치은마' })]).candidates[0]);
  assert.equal(alias.verdict, 'SEED_READY');
  assert.ok(alias.flags.includes('NAME_ALIAS'));
  const suffixOnly = classifyIdentity(agg([row({ aptNm: '은마' }), row({ aptNm: '은마아파트' })]).candidates[0]);
  assert.ok(!suffixOnly.flags.includes('NAME_ALIAS'), '"아파트" 접미사 차이는 alias가 아니다');
  assert.ok(classifyIdentity(agg([row()], 'RENT').candidates[0]).flags.includes('RENT_ONLY'));
});

test('중복 감사 — 같은 이름·같은 지번·같은 도로명의 다른 aptSeq는 그룹으로 보고만 한다(merge 없음)', () => {
  const { candidates } = agg([
    row({ aptSeq: '11680-1', aptNm: '현대', jibun: '10' }),
    row({ aptSeq: '11680-2', aptNm: '현대아파트', jibun: '10' }),
    row({ aptSeq: '11680-3', aptNm: '삼성', jibun: '11', roadNm: '다른로' }),
  ]);
  const d = auditDuplicates(candidates);
  assert.equal(d.sameNameDifferentAptSeq.length, 1);
  assert.deepEqual(d.sameNameDifferentAptSeq[0].aptSeqs, ['11680-1', '11680-2']);
  assert.equal(d.sameJibunDifferentAptSeq.length, 1);
  assert.equal(d.sameRoadDifferentAptSeq.length, 1);
  assert.equal(candidates.length, 3, '후보 수는 그대로');
});

test('원천 도로명 표기 — 건물번호 없으면 만들지 않는다', () => {
  assert.equal(roadAddressFromMolit('삼성로', '00212', '00000'), '삼성로 212');
  assert.equal(roadAddressFromMolit('삼성로', '00212', '00003'), '삼성로 212-3');
  assert.equal(roadAddressFromMolit('삼성로', '', ''), null);
  assert.equal(roadAddressFromMolit('', '212', ''), null);
});

test('기존 파일럿 대조 — MASTER → 거래 방향, EXACT / REVIEW_REQUIRED / UNMATCHED', () => {
  const { candidates } = agg([row()]);
  const bySeq = new Map(candidates.map((c) => [c.aptSeq, c]));
  const base = { aptSeq: '11680-218', lawdCd: '11680', aptName: '은마아파트', dong: '대치동', jibun: '316' };
  assert.equal(reconcilePilotRow(base, bySeq).match, 'EXACT');
  assert.deepEqual(reconcilePilotRow({ ...base, jibun: '999' }, bySeq), { match: 'REVIEW_REQUIRED', diffs: ['JIBUN'] });
  assert.equal(reconcilePilotRow({ ...base, aptSeq: '11680-9999' }, bySeq).match, 'UNMATCHED');
  assert.equal(reconcilePilotRow({ ...base, aptSeq: null }, bySeq).match, 'UNMATCHED');
});

test('좌표 — 주소 검색 + 같은 시도·구만 ACCEPT_EXACT, 키워드 첫 결과는 WEAK, 다른 구는 거부', () => {
  const base = { expectedSidoShort: '서울', expectedSigungu: '강남구' };
  assert.equal(classifyCoordinate({ ...base, queryKind: 'ADDRESS', resultAddr: '서울 강남구 삼성로 212' }), 'ACCEPT_EXACT');
  assert.equal(classifyCoordinate({ ...base, queryKind: 'KEYWORD', resultAddr: '서울 강남구 삼성로 212' }), 'WEAK_KEYWORD');
  assert.equal(classifyCoordinate({ ...base, queryKind: 'ADDRESS', resultAddr: '서울 서초구 반포대로 1' }), 'REJECT_REGION');
  assert.equal(classifyCoordinate({ ...base, queryKind: 'ADDRESS', resultAddr: '부산 해운대구 우동 1' }), 'REJECT_REGION');
  assert.equal(classifyCoordinate({ ...base, queryKind: null, resultAddr: null }), 'NO_RESULT');
});

test('quota 창 계산', () => {
  assert.equal(quotaWindows(0), 0);
  assert.equal(quotaWindows(9999), 1);
  assert.equal(quotaWindows(10001), 2);
});

test('여러 구 응답에 나온 같은 aptSeq — 표기가 모두 같으면 앞 5자리 구가 canonical, 다르면 CONFLICT', () => {
  const home = aggregateCandidates('11140', [{ item: row({ aptSeq: '11140-1012', aptNm: '한진해모로', umdNm: '신당동', umdCd: '16200', jibun: '845', sggCd: '11140' }), source: 'SALE' }]).candidates[0];
  const away = aggregateCandidates('11200', [{ item: row({ aptSeq: '11140-1012', aptNm: '한진해모로', umdNm: '신당동', umdCd: '16200', jibun: '845', sggCd: '11200' }), source: 'SALE' }]).candidates[0];
  assert.deepEqual(resolveCrossDistrict([away, home]), { canonical: home, kind: 'MISFILED_REPORT' });
  const other = { ...away, jibun: '999' };
  assert.equal(resolveCrossDistrict([home, other]).kind, 'CONFLICT');
  assert.equal(resolveCrossDistrict([home]).kind, 'SINGLE');
});

test('전월세 전용 단지의 umdCd — 같은 구 매매 원천의 법정동명 대응이 하나일 때만', () => {
  const sale = agg([row({ aptSeq: '11680-1', umdNm: '논현동', umdCd: '10800' })]).candidates;
  const map = buildDongCodeMap(sale);
  const rentOnly = agg([row({ aptSeq: '11680-5303', umdNm: '논현동', umdCd: '' })], 'RENT').candidates[0];
  assert.equal(resolveUmdCd(rentOnly, map), '10800');
  const unknownDong = agg([row({ aptSeq: '11680-9', umdNm: '없는동', umdCd: '' })], 'RENT').candidates[0];
  assert.equal(resolveUmdCd(unknownDong, map), null);
  const ambiguous = buildDongCodeMap([...sale, ...agg([row({ aptSeq: '11680-2', umdNm: '논현동', umdCd: '10900' })]).candidates]);
  assert.equal(resolveUmdCd(rentOnly, ambiguous), null, '대응이 둘이면 고르지 않는다');
});
