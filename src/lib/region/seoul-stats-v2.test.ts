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

test('서울 매매 실거래 피드 개방 게이트 — 매매는 열리고, 전월세는 0건 위장 없이 준비 중으로 차단된다', () => {
  // 서울 25개 구 매매 필터 (dealType: 'sale' or null)
  for (const c of [...S8, ...S17]) {
    const saleResult = isStatsFeedSupported({ lawdCd: c, sidoCode: null, sidoName: null, dealType: 'sale' });
    assert.equal(saleResult.allowed, true, `서울 ${c} 매매 피드가 차단되었다`);

    const allResult = isStatsFeedSupported({ lawdCd: c, sidoCode: null, sidoName: null, dealType: null });
    assert.equal(allResult.allowed, true, `서울 ${c} 전체 피드가 차단되었다`);

    // 서울 전월세 필터 (dealType: 'jeonse' or 'wolse') -> RENT_PREPARING으로 정직하게 안내
    const jeonseResult = isStatsFeedSupported({ lawdCd: c, sidoCode: null, sidoName: null, dealType: 'jeonse' });
    assert.equal(jeonseResult.allowed, false);
    assert.equal(jeonseResult.reason, 'RENT_PREPARING');
    assert.ok(jeonseResult.message?.includes('준비 중'));

    const wolseResult = isStatsFeedSupported({ lawdCd: c, sidoCode: null, sidoName: null, dealType: 'wolse' });
    assert.equal(wolseResult.allowed, false);
    assert.equal(wolseResult.reason, 'RENT_PREPARING');
  }

  // 서울 전체 (sidoCode: '11')
  const seoulSidoSale = isStatsFeedSupported({ lawdCd: null, sidoCode: '11', sidoName: null, dealType: 'sale' });
  assert.equal(seoulSidoSale.allowed, true);

  const seoulSidoJeonse = isStatsFeedSupported({ lawdCd: null, sidoCode: '11', sidoName: null, dealType: 'jeonse' });
  assert.equal(seoulSidoJeonse.allowed, false);
  assert.equal(seoulSidoJeonse.reason, 'RENT_PREPARING');

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

test('서울 84㎡ 가격 순위 개방 게이트 — area84는 열리고, 전세가율 순위(jeonse-risk)는 차단된다', () => {
  for (const c of [...S8, ...S17]) {
    // 84㎡ 국민평형 순위: 서울 25개 구 모두 허용
    const area84Res = isStatsRankingSupported({ lawdCd: c, sidoCode: null, sidoName: null, mode: 'area84' });
    assert.equal(area84Res.allowed, true, `서울 ${c} 84㎡ 순위가 차단되었다`);

    // 전세가율 위험 순위: 전세 미적재 상태이므로 RENT_PREPARING 차단
    const jeonseRiskRes = isStatsRankingSupported({ lawdCd: c, sidoCode: null, sidoName: null, mode: 'jeonse-risk' });
    assert.equal(jeonseRiskRes.allowed, false);
    assert.equal(jeonseRiskRes.reason, 'RENT_PREPARING');
  }

  // 서울 전체 (sidoCode: '11')
  assert.equal(isStatsRankingSupported({ lawdCd: null, sidoCode: '11', sidoName: null, mode: 'area84' }).allowed, true);
  assert.equal(isStatsRankingSupported({ lawdCd: null, sidoCode: '11', sidoName: null, mode: 'jeonse-risk' }).allowed, false);

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
