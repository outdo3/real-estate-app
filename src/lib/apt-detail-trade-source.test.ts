// APT DETAIL — DB-FIRST / CANCELLATION TRUST V1 회귀 테스트.
//
// fixture는 대신롯데캐슬(aptSeq 26140-1164)의 실제 Production 값이지만,
// 검증하는 규칙은 전부 일반 규칙이다(단지 특화 분기 없음).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  excludeCanceled,
  resolveDetailAptSeq,
  toDetailTrade,
  type DetailTrade,
} from './apt-detail-trade-source';
import type { StoredTrade } from './trade-history-read';
import { areaMatchesSelection, selectTradesForArea } from './unit-area-match';

function stored(over: Partial<StoredTrade> = {}): StoredTrade {
  return {
    id: 1,
    lawdCd: '26140',
    aptSeq: '26140-1164',
    aptName: '대신롯데캐슬',
    dong: '서대신동3가',
    exclusiveArea: '129.7178',
    dealAmount: 66500,
    dealDate: new Date('2026-09-05T00:00:00.000Z'),
    floor: 12,
    dealCanceled: false,
    buildYear: 2008,
    jibun: '762',
    ...over,
  };
}

test('문제의 거래가 상세 응답 모양으로 정확히 변환된다(6.65억 fixture)', () => {
  const t = toDetailTrade(stored());
  assert.equal(t.tradeDate, '2026-09-05');
  assert.equal(t.priceStr, '6억 6,500만');
  assert.equal(t.price, 6.65);
  assert.equal(t.area, '129.7178m²');
  assert.equal(t.floor, 12);
  assert.equal(t.aptSeq, '26140-1164');
  assert.equal(t.dealCanceled, false);
});

test('dealAmount → 억 단위 변환이 MOLIT 경로와 같은 규칙이다', () => {
  assert.equal(toDetailTrade(stored({ dealAmount: 38700 })).price, 3.87);
  assert.equal(toDetailTrade(stored({ dealAmount: 38700 })).priceStr, '3억 8,700만');
  assert.equal(toDetailTrade(stored({ dealAmount: 10000 })).priceStr, '1억');
  assert.equal(toDetailTrade(stored({ dealAmount: 9500 })).priceStr, '9,500만');
});

test('tradeType 라벨이 클라이언트 매매 필터를 통과한다', () => {
  const t = toDetailTrade(stored());
  // apt-client.tsx: tradeType !== '아파트 매매' && tradeType !== '실거래' 이면 제외.
  assert.ok(t.tradeType === '아파트 매매' || t.tradeType === '실거래');
});

test('없는 값을 지어내지 않는다(floor/buildYear/jibun/registryDate)', () => {
  const t = toDetailTrade(stored({ floor: null, buildYear: null, jibun: null }));
  assert.equal(t.floor, 0);
  assert.equal(t.buildYear, '');
  assert.equal(t.jibun, '');
  assert.equal(t.registryDate, '');
});

test('취소 거래는 활성 집합에서 제외된다', () => {
  const rows = [
    { tradeDate: '2026-09-20', dealCanceled: true },
    { tradeDate: '2026-09-05', dealCanceled: false },
    { tradeDate: '2026-08-21', dealCanceled: false },
  ];
  const active = excludeCanceled(rows);
  assert.equal(active.length, 2);
  assert.equal(active.some((r) => r.dealCanceled), false);
});

test('최신 거래가 "더 최근의 취소 거래"에 오염되지 않는다', () => {
  // 정렬은 최신순이므로 취소 건이 남아 있으면 [0]이 취소 건이 된다.
  const rows = [
    { tradeDate: '2026-09-20', dealCanceled: true, priceStr: '9억' },
    { tradeDate: '2026-09-05', dealCanceled: false, priceStr: '6억 6,500만' },
  ];
  const latest = excludeCanceled(rows)[0];
  assert.equal(latest.tradeDate, '2026-09-05');
  assert.equal(latest.priceStr, '6억 6,500만');
});

test('dealCanceled가 없는 행(전월세 등)은 활성으로 본다', () => {
  const rows = [{ tradeDate: '2026-09-05' }, { tradeDate: '2026-08-01', dealCanceled: false }];
  assert.equal(excludeCanceled(rows).length, 2);
});

test('취소 제외 후에도 평형 필터가 그대로 동작한다(UNIT FILTER V1 회귀)', () => {
  const trades: DetailTrade[] = [
    toDetailTrade(stored({ id: 1 })),
    toDetailTrade(stored({ id: 2, exclusiveArea: '84.7855', dealAmount: 38700, dealDate: new Date('2026-08-21T00:00:00.000Z') })),
  ];
  const fifty = selectTradesForArea(trades, '129.7178');
  assert.equal(fifty.length, 1);
  assert.equal(fifty[0].priceStr, '6억 6,500만');
  assert.equal(fifty[0].tradeDate, '2026-09-05');
  // Unit Master canonical(bare)과 DB가 만든 area("129.7178m²")가 매칭된다.
  assert.equal(areaMatchesSelection(trades[0].area, '129.7178'), true);
  // 거래가 없는 평형은 빈 결과 — 다른 평형으로 대체하지 않는다.
  assert.equal(selectTradesForArea(trades, '33.2024').length, 0);
});

// ── resolveDetailAptSeq: 이름만으로 재식별하지 않는다 ──────────────────────
function fakePrisma(rows: { aptSeq: string | null; name: string }[]) {
  return {
    apartmentMaster: {
      findMany: async () => rows,
    },
  } as never;
}

test('URL이 준 aptSeq가 있으면 그대로 canonical로 쓴다', async () => {
  const seq = await resolveDetailAptSeq(fakePrisma([]), {
    aptSeqParam: '26140-1164',
    aptName: '대신롯데캐슬',
    lawdCd: '26140',
    dong: '서대신동3가',
  });
  assert.equal(seq, '26140-1164');
});

test('lawdCd+dong 안에서 정규화 이름이 유일하게 일치하면 채택한다', async () => {
  const seq = await resolveDetailAptSeq(
    fakePrisma([
      { aptSeq: '26140-1164', name: '대신롯데캐슬' },
      { aptSeq: '26140-1243', name: '대신푸르지오1차' },
    ]),
    { aptName: '대신롯데캐슬', lawdCd: '26140', dong: '서대신동3가' }
  );
  assert.equal(seq, '26140-1164');
});

test('후보가 2건 이상이면 포기한다(다른 단지로 대체 금지)', async () => {
  const seq = await resolveDetailAptSeq(
    fakePrisma([
      { aptSeq: '26140-1164', name: '대신롯데캐슬' },
      { aptSeq: '26140-9999', name: '대신롯데캐슬' },
    ]),
    { aptName: '대신롯데캐슬', lawdCd: '26140', dong: '서대신동3가' }
  );
  assert.equal(seq, null);
});

test('일치하는 단지가 없으면 null (추측하지 않는다)', async () => {
  const seq = await resolveDetailAptSeq(fakePrisma([{ aptSeq: '26140-1243', name: '대신푸르지오1차' }]), {
    aptName: '대신롯데캐슬',
    lawdCd: '26140',
    dong: '서대신동3가',
  });
  assert.equal(seq, null);
});

test('lawdCd가 없으면 DB 경로를 시도하지 않는다(지역 미확정 상태에서 이름 조회 금지)', async () => {
  const seq = await resolveDetailAptSeq(fakePrisma([{ aptSeq: '26140-1164', name: '대신롯데캐슬' }]), {
    aptName: '대신롯데캐슬',
    lawdCd: '',
    dong: '서대신동3가',
  });
  assert.equal(seq, null);
});
