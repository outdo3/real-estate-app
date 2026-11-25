import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDbOnlyLawdCd,
  SEOUL_BETA_LAWDCDS,
  SEOUL_17_BETA_LAWDCDS,
  GYEONGGI_BETA_LAWDCDS,
} from './enablement';
import {
  isStatsFeedSupported,
  isStatsRankingSupported,
  isSeoulSaleStatsEligible,
} from './stats-gate';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';

const S8 = SEOUL_BETA_LAWDCDS as readonly string[];
const S17 = SEOUL_17_BETA_LAWDCDS as readonly string[];
const GG8 = GYEONGGI_BETA_LAWDCDS as readonly string[];
const BUSAN = BUSAN_LAWDCD_16 as readonly string[];

test('서울 초기 8개 구 전월세 조회 보호 — 서울 25구 전체가 DB-only 관문으로 보호된다', () => {
  // 서울 초기 8구: 이제 과다한 live MOLIT 호출 없이 DB 전용으로 처리
  for (const c of S8) {
    assert.equal(isDbOnlyLawdCd(c), true, `서울 8구 ${c}가 DB-only로 보호되지 않는다`);
  }
  // 서울 신규 17구: 기존과 동일하게 DB-only 유지
  for (const c of S17) {
    assert.equal(isDbOnlyLawdCd(c), true, `서울 17구 ${c}가 DB-only가 아니다`);
  }
  // 경기 8구: 기존과 동일하게 DB-only 유지
  for (const c of GG8) {
    assert.equal(isDbOnlyLawdCd(c), true, `경기 8구 ${c}가 DB-only가 아니다`);
  }
  // 부산 16구: DB-only가 아님 (검증된 DB-first + 잔여 실시간 유지)
  for (const c of BUSAN) {
    assert.equal(isDbOnlyLawdCd(c), false, `부산 ${c}가 DB-only로 잘못 지정되었다`);
  }
  // 미지원 지역(분당 41135, 대구 등): DB-only가 아님
  for (const c of ['41135', '27110', '99999']) {
    assert.equal(isDbOnlyLawdCd(c), false, `미지원 ${c}가 DB-only로 잘못 지정되었다`);
  }
});

test('서울 실거래 피드 개방 게이트 — V4.1 전월세 적재 완료로 매매, 전세, 월세 모두 지원된다', () => {
  // 서울 25개 구 매매, 전세, 월세 필터 모두 허용
  for (const c of [...S8, ...S17]) {
    const saleResult = isStatsFeedSupported({ lawdCd: c, sidoCode: null, sidoName: null, dealType: 'sale' });
    assert.equal(saleResult.allowed, true, `서울 ${c} 매매 피드가 차단되었다`);

    const allResult = isStatsFeedSupported({ lawdCd: c, sidoCode: null, sidoName: null, dealType: null });
    assert.equal(allResult.allowed, true, `서울 ${c} 전체 피드가 차단되었다`);

    const jeonseResult = isStatsFeedSupported({ lawdCd: c, sidoCode: null, sidoName: null, dealType: 'jeonse' });
    assert.equal(jeonseResult.allowed, true, `서울 ${c} 전세 피드가 허용되지 않았다`);

    const wolseResult = isStatsFeedSupported({ lawdCd: c, sidoCode: null, sidoName: null, dealType: 'wolse' });
    assert.equal(wolseResult.allowed, true, `서울 ${c} 월세 피드가 허용되지 않았다`);
  }

  // 서울 전체 (sidoCode: '11')
  const seoulSidoSale = isStatsFeedSupported({ lawdCd: null, sidoCode: '11', sidoName: null, dealType: 'sale' });
  assert.equal(seoulSidoSale.allowed, true);

  const seoulSidoJeonse = isStatsFeedSupported({ lawdCd: null, sidoCode: '11', sidoName: null, dealType: 'jeonse' });
  assert.equal(seoulSidoJeonse.allowed, true);

  // 부산 16개 구 무회귀: 매매, 전세, 월세 전부 통과
  for (const c of BUSAN) {
    assert.equal(isStatsFeedSupported({ lawdCd: c, sidoCode: null, sidoName: null, dealType: 'sale' }).allowed, true);
    assert.equal(isStatsFeedSupported({ lawdCd: c, sidoCode: null, sidoName: null, dealType: 'jeonse' }).allowed, true);
    assert.equal(isStatsFeedSupported({ lawdCd: c, sidoCode: null, sidoName: null, dealType: 'wolse' }).allowed, true);
  }

  // 경기 및 미지원 지역: 차단 유지 (UNSUPPORTED_REGION)
  for (const c of [...GG8, '41135', '27110']) {
    const res = isStatsFeedSupported({ lawdCd: c, sidoCode: null, sidoName: null });
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'UNSUPPORTED_REGION');
  }
});

test('서울 84㎡ 가격 순위 개방 게이트 — V4.1 전월세 적재 완료로 area84 및 전세가율 순위(jeonse-risk) 모두 지원된다', () => {
  for (const c of [...S8, ...S17]) {
    // 84㎡ 국민평형 순위: 서울 25개 구 모두 허용
    const area84Res = isStatsRankingSupported({ lawdCd: c, sidoCode: null, sidoName: null, mode: 'area84' });
    assert.equal(area84Res.allowed, true, `서울 ${c} 84㎡ 순위가 차단되었다`);

    // 전세가율 위험 순위: 서울 25개 구 모두 허용
    const jeonseRiskRes = isStatsRankingSupported({ lawdCd: c, sidoCode: null, sidoName: null, mode: 'jeonse-risk' });
    assert.equal(jeonseRiskRes.allowed, true, `서울 ${c} 전세가율 순위가 허용되지 않았다`);
  }

  // 서울 전체 (sidoCode: '11')
  assert.equal(isStatsRankingSupported({ lawdCd: null, sidoCode: '11', sidoName: null, mode: 'area84' }).allowed, true);
  assert.equal(isStatsRankingSupported({ lawdCd: null, sidoCode: '11', sidoName: null, mode: 'jeonse-risk' }).allowed, true);

  // 부산 16개 구 무회귀: area84, jeonse-risk 전부 허용
  for (const c of BUSAN) {
    assert.equal(isStatsRankingSupported({ lawdCd: c, sidoCode: null, sidoName: null, mode: 'area84' }).allowed, true);
    assert.equal(isStatsRankingSupported({ lawdCd: c, sidoCode: null, sidoName: null, mode: 'jeonse-risk' }).allowed, true);
  }

  // 경기 및 미지원 지역: 차단 유지
  for (const c of [...GG8, '41135', '27110']) {
    assert.equal(isStatsRankingSupported({ lawdCd: c, sidoCode: null, sidoName: null, mode: 'area84' }).allowed, false);
  }
});

test('피드 무보증 월세 보존 — 보증금이 0원이라도 월세가 양수이면 월세 피드 거래로 온전히 보존된다', async () => {
  const { toFeedTrade } = await import('../regional-feed');
  const mockWolseZeroDeposit = {
    id: 'test-wolse-01',
    aptSeq: '11110-101',
    name: '테스트단지',
    dong: '사직동',
    dealAmount: 0,
    monthlyRent: 80,
    excluUseArea: 59.9,
    floorRaw: 5,
    dealDate: '2026-05-15',
    dealCanceled: false,
    typeLabel: '전월세',
  };

  const trade = toFeedTrade(mockWolseZeroDeposit, 'wolse', '11110');
  assert.notEqual(trade, null, '무보증 월세가 null로 버려졌다');
  assert.equal(trade?.dealType, 'wolse');
  assert.equal(trade?.dealAmount, 0);
  assert.equal(trade?.monthlyRent, 80);

  // 전세는 보증금이 0 이하이면 무효
  const mockJeonseZero = { ...mockWolseZeroDeposit, monthlyRent: 0 };
  assert.equal(toFeedTrade(mockJeonseZero, 'jeonse', '11110'), null, '보증금 0원 전세는 제외되어야 한다');
});
