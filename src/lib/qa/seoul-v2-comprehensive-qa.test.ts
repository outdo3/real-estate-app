import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isStatsFeedSupported,
  isStatsRankingSupported,
  isSeoulSaleStatsEligible,
} from '../region/stats-gate';
import {
  isDbOnlyLawdCd,
  SEOUL_BETA_LAWDCDS,
  SEOUL_17_BETA_LAWDCDS,
  GYEONGGI_BETA_LAWDCDS,
} from '../region/enablement';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { REGION_NODES } from '../region/registry';

const S8 = SEOUL_BETA_LAWDCDS as readonly string[];
const S17 = SEOUL_17_BETA_LAWDCDS as readonly string[];
const SEOUL_ALL_25 = [...S8, ...S17];
const GG8 = GYEONGGI_BETA_LAWDCDS as readonly string[];
const BUSAN = BUSAN_LAWDCD_16 as readonly string[];

test('QA 1 & 2: 서울 25개 구별 매매 실거래 피드 계약 — 25개 구 모두 매매 피드가 허용된다', () => {
  assert.equal(SEOUL_ALL_25.length, 25);
  for (const lawdCd of SEOUL_ALL_25) {
    const saleCheck = isStatsFeedSupported({ lawdCd, sidoCode: null, sidoName: null, dealType: 'sale' });
    assert.equal(saleCheck.allowed, true, `서울 ${lawdCd} 매매 피드 차단됨`);

    const allCheck = isStatsFeedSupported({ lawdCd, sidoCode: null, sidoName: null, dealType: null });
    assert.equal(allCheck.allowed, true, `서울 ${lawdCd} 전체 피드 차단됨`);

    assert.equal(isSeoulSaleStatsEligible({ lawdCd, sidoCode: null, sidoName: null }), true, `서울 ${lawdCd} 적격성 실패`);
  }
});

test('QA 3 & 4: 전체 필터 안내 및 전월세 필터 준비 중 안내 — 0건으로 오도하지 않고 정직하게 차단/안내한다', () => {
  for (const lawdCd of SEOUL_ALL_25) {
    // 전세 필터: RENT_PREPARING
    const jeonseCheck = isStatsFeedSupported({ lawdCd, sidoCode: null, sidoName: null, dealType: 'jeonse' });
    assert.equal(jeonseCheck.allowed, false);
    assert.equal(jeonseCheck.reason, 'RENT_PREPARING');
    assert.ok(jeonseCheck.message?.includes('준비 중'));

    // 월세 필터: RENT_PREPARING
    const wolseCheck = isStatsFeedSupported({ lawdCd, sidoCode: null, sidoName: null, dealType: 'wolse' });
    assert.equal(wolseCheck.allowed, false);
    assert.equal(wolseCheck.reason, 'RENT_PREPARING');
  }

  // 서울 시도 레벨 (sidoCode: '11')
  const sidoJeonse = isStatsFeedSupported({ lawdCd: null, sidoCode: '11', sidoName: null, dealType: 'jeonse' });
  assert.equal(sidoJeonse.allowed, false);
  assert.equal(sidoJeonse.reason, 'RENT_PREPARING');
});

test('QA 5: 서울 84㎡ 가격 순위 계약 — 서울 25개 구 모두 area84 허용, jeonse-risk는 준비 중 차단', () => {
  for (const lawdCd of SEOUL_ALL_25) {
    const area84Check = isStatsRankingSupported({ lawdCd, sidoCode: null, sidoName: null, mode: 'area84' });
    assert.equal(area84Check.allowed, true, `서울 ${lawdCd} 84㎡ 순위 차단됨`);

    const jeonseRiskCheck = isStatsRankingSupported({ lawdCd, sidoCode: null, sidoName: null, mode: 'jeonse-risk' });
    assert.equal(jeonseRiskCheck.allowed, false);
    assert.equal(jeonseRiskCheck.reason, 'RENT_PREPARING');
    assert.ok(jeonseRiskCheck.message?.includes('준비 중'));
  }
});

test('QA 6: 기간 변경 및 서울 전체(sidoCode: 11) 조회 계약 검증', () => {
  // 서울 전체 시도 피드
  const sidoFeedSale = isStatsFeedSupported({ lawdCd: null, sidoCode: '11', sidoName: null, dealType: 'sale' });
  assert.equal(sidoFeedSale.allowed, true);

  // 서울 전체 시도 84㎡ 순위
  const sidoArea84 = isStatsRankingSupported({ lawdCd: null, sidoCode: '11', sidoName: null, mode: 'area84' });
  assert.equal(sidoArea84.allowed, true);

  // 서울 전체 시도 전세가율 순위 차단
  const sidoJeonseRisk = isStatsRankingSupported({ lawdCd: null, sidoCode: '11', sidoName: null, mode: 'jeonse-risk' });
  assert.equal(sidoJeonseRisk.allowed, false);
  assert.equal(sidoJeonseRisk.reason, 'RENT_PREPARING');
});

test('QA 7: 부산 기존 기능 무회귀 — 16개 구 전체 및 시도 전체가 모든 필터/모드에서 정상 통과', () => {
  for (const lawdCd of BUSAN) {
    assert.equal(isStatsFeedSupported({ lawdCd, sidoCode: null, sidoName: null, dealType: 'sale' }).allowed, true);
    assert.equal(isStatsFeedSupported({ lawdCd, sidoCode: null, sidoName: null, dealType: 'jeonse' }).allowed, true);
    assert.equal(isStatsFeedSupported({ lawdCd, sidoCode: null, sidoName: null, dealType: 'wolse' }).allowed, true);
    assert.equal(isStatsRankingSupported({ lawdCd, sidoCode: null, sidoName: null, mode: 'area84' }).allowed, true);
    assert.equal(isStatsRankingSupported({ lawdCd, sidoCode: null, sidoName: null, mode: 'jeonse-risk' }).allowed, true);
  }

  // 부산 전체
  assert.equal(isStatsFeedSupported({ lawdCd: null, sidoCode: '26', sidoName: null }).allowed, true);
  assert.equal(isStatsRankingSupported({ lawdCd: null, sidoCode: '26', sidoName: null, mode: 'area84' }).allowed, true);
  assert.equal(isStatsRankingSupported({ lawdCd: null, sidoCode: '26', sidoName: null, mode: 'jeonse-risk' }).allowed, true);
});

test('QA 8: 경기도 및 미공개 지역 게이트 유지 — UNSUPPORTED_REGION 차단 유지', () => {
  for (const lawdCd of [...GG8, '41135', '27110', '99999']) {
    const feed = isStatsFeedSupported({ lawdCd, sidoCode: null, sidoName: null });
    assert.equal(feed.allowed, false);
    assert.equal(feed.reason, 'UNSUPPORTED_REGION');

    const ranking = isStatsRankingSupported({ lawdCd, sidoCode: null, sidoName: null, mode: 'area84' });
    assert.equal(ranking.allowed, false);
    assert.equal(ranking.reason, 'UNSUPPORTED_REGION');
  }
});

test('QA 9: 초기 8개 구 전월세 조회 보호 — 서울 25개 구 전체가 DB-only 관문으로 과다 MOLIT 호출 차단', () => {
  for (const lawdCd of SEOUL_ALL_25) {
    assert.equal(isDbOnlyLawdCd(lawdCd), true, `서울 ${lawdCd}가 DB-only 보호를 받지 못함`);
  }
  for (const lawdCd of BUSAN) {
    assert.equal(isDbOnlyLawdCd(lawdCd), false, `부산 ${lawdCd}가 DB-only로 잘못 지정됨`);
  }
});
