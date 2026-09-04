// OFFICETEL_V1 STEP 1 §22 — identity / natural key / occurrence 계약 테스트.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOfficetelCanonicalKey,
  normalizeBuildingDong,
  normalizeJibun,
  normalizeOfficetelName,
  normalizeUmd,
  NO_BUILDING_DONG,
} from './identity.ts';
import {
  assignOccurrenceIndexes,
  normalizeAreaToken,
  officetelRentGroupKey,
  officetelSaleGroupKey,
} from './natural-key.ts';

const key = (o) => {
  const r = buildOfficetelCanonicalKey(o);
  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  return r.key;
};

// ── identity: 같은 건물 ─────────────────────────────────────────────
test('같은 주소 = 같은 canonicalKey (표시명이 달라도)', () => {
  const a = key({ sggCd: '26350', umdNm: '좌동', jibun: '1458-5', buildingDong: null });
  const b = key({ sggCd: '26350', umdNm: '좌동', jibun: '1458-5', buildingDong: '' });
  assert.equal(a, b);
  assert.equal(a, 'OFFI:26350:좌동:1458-5:_');
});

test('표기 흔들림(공백/0-padding)을 흡수한다', () => {
  const a = key({ sggCd: '26350', umdNm: '좌동', jibun: '1458-5' });
  assert.equal(key({ sggCd: '26350', umdNm: ' 좌동 ', jibun: ' 1458 - 5 ' }), a);
  assert.equal(key({ sggCd: '26350', umdNm: '좌동', jibun: '01458-005' }), a);
});

test('부번 없는 지번은 -0으로 고정된다', () => {
  assert.equal(key({ sggCd: '26110', umdNm: '중앙동5가', jibun: '18' }), 'OFFI:26110:중앙동5가:18-0:_');
});

// ── identity: 다른 건물 ─────────────────────────────────────────────
test('같은 이름 다른 주소 → 다른 canonicalKey (부산 전체 동명 4.47% 실측 대응)', () => {
  // "드림빌리지"가 실제로 존재하는 3개 지번
  const a = key({ sggCd: '26110', umdNm: '부평동2가', jibun: '20-7' });
  const b = key({ sggCd: '26140', umdNm: '토성동2가', jibun: '9-22' });
  const c = key({ sggCd: '26380', umdNm: '괴정동', jibun: '395-2' });
  assert.equal(new Set([a, b, c]).size, 3);
});

test('같은 지번 다른 buildingDong → 다른 canonicalKey (대연동 62-14 가동/나동 실측)', () => {
  const base = { sggCd: '26290', umdNm: '대연동', jibun: '62-14' };
  const ga = key({ ...base, buildingDong: '가동' });
  const na = key({ ...base, buildingDong: '나동' });
  const none = key({ ...base });
  assert.equal(ga, 'OFFI:26290:대연동:62-14:가동');
  assert.equal(na, 'OFFI:26290:대연동:62-14:나동');
  assert.equal(new Set([ga, na, none]).size, 3, '두 동과 building-level 키가 모두 달라야 한다');
});

test('법정동이 다르면 지번이 같아도 다른 키', () => {
  assert.notEqual(
    key({ sggCd: '26350', umdNm: '좌동', jibun: '100-1' }),
    key({ sggCd: '26350', umdNm: '우동', jibun: '100-1' })
  );
});

test('시군구가 다르면 다른 키', () => {
  assert.notEqual(
    key({ sggCd: '26230', umdNm: '전포동', jibun: '375-6' }),
    key({ sggCd: '26500', umdNm: '전포동', jibun: '375-6' })
  );
});

// ── identity: unresolved (추측 금지) ────────────────────────────────
test('필수 성분이 없으면 키를 만들지 않는다 — UNRESOLVED가 잘못된 연결보다 낫다', () => {
  assert.deepEqual(buildOfficetelCanonicalKey({ sggCd: '', umdNm: '좌동', jibun: '1-1' }), { ok: false, reason: 'MISSING_SGG_CD' });
  assert.deepEqual(buildOfficetelCanonicalKey({ sggCd: '26350', umdNm: '', jibun: '1-1' }), { ok: false, reason: 'MISSING_UMD' });
  assert.deepEqual(buildOfficetelCanonicalKey({ sggCd: '26350', umdNm: '좌동', jibun: '' }), { ok: false, reason: 'MISSING_JIBUN' });
});

test('산 지번 등 파싱 불가 지번은 UNPARSEABLE_JIBUN (대지/산 구분을 추측하지 않는다)', () => {
  for (const j of ['산12-3', '12가-3', '1458-5-2', 'abc']) {
    assert.deepEqual(
      buildOfficetelCanonicalKey({ sggCd: '26350', umdNm: '좌동', jibun: j }),
      { ok: false, reason: 'UNPARSEABLE_JIBUN' },
      `jibun=${j}`
    );
  }
});

test('canonicalKey는 이름을 포함하지 않는다 (name-only 금지의 구조적 보장)', () => {
  const k = key({ sggCd: '26350', umdNm: '좌동', jibun: '1458-5' });
  assert.ok(!k.includes('쥬노벨'));
});

// ── normalization 안정성 ───────────────────────────────────────────
test('normalization은 멱등이다', () => {
  assert.equal(normalizeUmd(normalizeUmd(' 일광읍 삼성리 ')), normalizeUmd(' 일광읍 삼성리 '));
  assert.equal(normalizeJibun(normalizeJibun('0062-0014')), '62-14');
  assert.equal(normalizeBuildingDong(normalizeBuildingDong(' 나동 ')), '나동');
});

test('법정동 접미사를 떼지 않는다 (좌동 → 좌 금지, 읍+리 복합 표기 보존)', () => {
  assert.equal(normalizeUmd('좌동'), '좌동');
  assert.equal(normalizeUmd('일광읍 삼성리'), '일광읍삼성리');
});

test('buildingDong 없음은 항상 같은 자리표시자로 표현된다', () => {
  for (const v of [null, undefined, '', '   ']) assert.equal(normalizeBuildingDong(v), NO_BUILDING_DONG);
});

test('표시명 정규화는 검색 보조 전용 — 식별에 쓰지 않는다', () => {
  assert.equal(normalizeOfficetelName('쥬노벨 오피스텔'), '쥬노벨');
  assert.equal(normalizeOfficetelName('쥬노벨오피스텔'), '쥬노벨');
  // 같은 정규화 이름이어도 주소가 다르면 키는 달라야 한다
  assert.notEqual(
    key({ sggCd: '26110', umdNm: '중앙동5가', jibun: '18' }),
    key({ sggCd: '26710', umdNm: '일광읍 삼성리', jibun: '890' })
  );
});

// ── SALE natural key / occurrence ──────────────────────────────────
const SALE = { canonicalKey: 'OFFI:26350:좌동:1458-5:_', dealDate: '2026-08-31', exclusiveArea: '31.56', dealAmount: 6800, floor: 8 };

test('SALE: 완전히 같은 원천 행은 같은 그룹 → occurrence 0,1로 보존(병합 금지)', () => {
  const keys = [officetelSaleGroupKey(SALE), officetelSaleGroupKey(SALE)];
  assert.deepEqual(assignOccurrenceIndexes(keys), [0, 1]);
});

test('SALE: TYPE B(uncanceled+canceled)는 취소 여부가 자연키 밖이라 같은 그룹의 별도 occurrence', () => {
  // 취소 여부는 그룹키에 들어가지 않는다 — 두 행이 같은 그룹으로 묶여 0,1을 받는다.
  const uncanceled = officetelSaleGroupKey(SALE);
  const canceled = officetelSaleGroupKey(SALE);
  assert.equal(uncanceled, canceled);
  assert.deepEqual(assignOccurrenceIndexes([uncanceled, canceled]), [0, 1]);
});

test('SALE: 층이 다르면 다른 그룹', () => {
  assert.notEqual(officetelSaleGroupKey(SALE), officetelSaleGroupKey({ ...SALE, floor: 9 }));
});

test('SALE: 건물/일자/면적/금액 중 하나만 달라도 다른 그룹', () => {
  assert.notEqual(officetelSaleGroupKey(SALE), officetelSaleGroupKey({ ...SALE, canonicalKey: 'OFFI:26350:좌동:1458-6:_' }));
  assert.notEqual(officetelSaleGroupKey(SALE), officetelSaleGroupKey({ ...SALE, dealDate: '2026-08-30' }));
  assert.notEqual(officetelSaleGroupKey(SALE), officetelSaleGroupKey({ ...SALE, exclusiveArea: '31.57' }));
  assert.notEqual(officetelSaleGroupKey(SALE), officetelSaleGroupKey({ ...SALE, dealAmount: 6900 }));
});

test('SALE: 면적 표기 자릿수 차이는 같은 그룹(값 반올림은 하지 않음)', () => {
  assert.equal(officetelSaleGroupKey(SALE), officetelSaleGroupKey({ ...SALE, exclusiveArea: '31.5600' }));
  assert.equal(normalizeAreaToken('31.5600'), '31.56');
  assert.equal(normalizeAreaToken('84'), '84');
  assert.equal(normalizeAreaToken('227.4300'), '227.43');
});

// ── RENT natural key / occurrence ──────────────────────────────────
const RENT = { canonicalKey: 'OFFI:26350:좌동:1473-6:_', dealDate: '2026-08-08', exclusiveArea: '27.58', deposit: 300, monthlyRent: 30, floor: 6 };

test('RENT: 보증금/월세 차이를 보존한다', () => {
  assert.notEqual(officetelRentGroupKey(RENT), officetelRentGroupKey({ ...RENT, deposit: 500 }));
  assert.notEqual(officetelRentGroupKey(RENT), officetelRentGroupKey({ ...RENT, monthlyRent: 0 }));
});

test('RENT: 전세(월세 0)와 월세는 다른 그룹', () => {
  const jeonse = officetelRentGroupKey({ ...RENT, deposit: 10000, monthlyRent: 0 });
  const wolse = officetelRentGroupKey({ ...RENT, deposit: 10000, monthlyRent: 50 });
  assert.notEqual(jeonse, wolse);
});

test('RENT: 동일 조건 다행은 occurrence로 보존(첫 match overwrite 금지)', () => {
  const k = officetelRentGroupKey(RENT);
  assert.deepEqual(assignOccurrenceIndexes([k, k, k]), [0, 1, 2]);
});

test('occurrence는 그룹별로 독립 계산된다', () => {
  const a = officetelSaleGroupKey(SALE);
  const b = officetelSaleGroupKey({ ...SALE, floor: 9 });
  assert.deepEqual(assignOccurrenceIndexes([a, b, a, b, a]), [0, 0, 1, 1, 2]);
});
