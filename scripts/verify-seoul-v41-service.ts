import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import assert from 'node:assert/strict';
import { GET as getAptDetail } from '../src/app/api/apt/[name]/route';
import { GET as getFeed } from '../src/app/api/stats/feed/route';
import { GET as getDashboard } from '../src/app/api/stats/dashboard/route';
import { GET as getPriceRankings } from '../src/app/api/stats/price-rankings/route';
import { resolveRentSyncScope } from '../src/lib/sync/rent-sync-scope';
import { prisma } from '../src/lib/prisma';

async function main() {
  console.log('=== E-JIP 서울 V4.1 종합 서비스 검증 시작 ===\n');

  // 1. 서울 대표 5개 단지 상세 조회 (매매 및 전월세)
  console.log('--- 1. 서울 대표 단지 상세 조회 (매매 / 전월세) ---');
  const targetApts = [
    { name: '경희궁자이(2단지)', lawdCd: '11110', aptSeq: '11110-2445', district: '종로구' },
    { name: '마포래미안푸르지오1단지', lawdCd: '11440', aptSeq: '11440-5407', district: '마포구' },
    { name: '반포자이', lawdCd: '11650', aptSeq: '11650-3500', district: '서초구' },
    { name: '은마', lawdCd: '11680', aptSeq: '11680-218', district: '강남구' },
    { name: '헬리오시티', lawdCd: '11710', aptSeq: '11710-8865', district: '송파구' },
  ];

  for (const apt of targetApts) {
    // 1-1. 매매 조회
    const saleReq = new Request(`http://localhost:3000/api/apt/${encodeURIComponent(apt.name)}?lawdCd=${apt.lawdCd}&aptSeq=${apt.aptSeq}&type=apt&period=12m`);
    const saleRes = await getAptDetail(saleReq, { params: Promise.resolve({ name: apt.name }) });
    const saleJson = await saleRes.json();
    assert.ok(!saleJson.apiError, `${apt.name} 매매 API 오류: ${saleJson.apiError}`);
    console.log(`[${apt.district}] ${apt.name} 매매: 건수=${saleJson.trades?.length ?? 0}, 소스=${saleJson.tradeDataSource || 'MOLIT'}`);

    // 1-2. 전월세 조회
    const rentReq = new Request(`http://localhost:3000/api/apt/${encodeURIComponent(apt.name)}?lawdCd=${apt.lawdCd}&aptSeq=${apt.aptSeq}&type=rent&period=12m`);
    const rentRes = await getAptDetail(rentReq, { params: Promise.resolve({ name: apt.name }) });
    const rentJson = await rentRes.json();
    assert.ok(!rentJson.apiError, `${apt.name} 전월세 API 오류: ${rentJson.apiError}`);
    const rentCount = rentJson.trades?.length ?? 0;
    assert.ok(rentCount > 0, `${apt.name} 전월세 거래 건수가 0건입니다`);
    assert.equal(rentJson.tradeDataSource, 'DB', `${apt.name} 전월세 소스가 DB가 아닙니다`);
    console.log(`[${apt.district}] ${apt.name} 전월세: 건수=${rentCount}, 소스=${rentJson.tradeDataSource}, 최근거래=${rentJson.trades[0]?.tradeDate} (${rentJson.trades[0]?.tradeType} ${rentJson.trades[0]?.priceStr})`);
  }
  console.log('✔ 서울 대표 5개 단지 상세 매매/전월세 DB 연동 검증 통과!\n');

  // 2. 실거래 피드 API (/api/stats/feed) 검증
  console.log('--- 2. 서울 실거래 피드 API 검증 ---');
  for (const dealType of ['sale', 'jeonse', 'wolse'] as const) {
    // 2-1. 구 단위 피드 (마포구 11440)
    const mapoReq = new Request(`http://localhost:3000/api/stats/feed?lawdCd=11440&dealType=${dealType}&period=12m&limit=20`);
    const mapoRes = await getFeed(mapoReq);
    const mapoJson = await mapoRes.json();
    assert.equal(mapoJson.status, 'OK', `마포구 ${dealType} 피드 실패: ${mapoJson.message}`);
    assert.ok(mapoJson.pagination?.total > 0, `마포구 ${dealType} 피드 건수가 0입니다`);
    console.log(`[마포구] feed (${dealType}): 총=${mapoJson.pagination?.total}, groups=${mapoJson.groups?.length}, partial=${mapoJson.partial ?? false}`);

    // 2-2. 서울시 전체 피드 (sidoCode=11)
    const seoulReq = new Request(`http://localhost:3000/api/stats/feed?sidoCode=11&dealType=${dealType}&period=12m&limit=20`);
    const seoulRes = await getFeed(seoulReq);
    const seoulJson = await seoulRes.json();
    assert.equal(seoulJson.status, 'OK', `서울시 전체 ${dealType} 피드 실패: ${seoulJson.message}`);
    assert.ok(seoulJson.pagination?.total > 0, `서울시 전체 ${dealType} 피드 건수가 0입니다`);
    console.log(`[서울시 전체] feed (${dealType}): 총=${seoulJson.pagination?.total}, groups=${seoulJson.groups?.length}`);
  }
  console.log('✔ 서울 실거래 피드 (매매/전세/월세, 구단위/서울전체) 검증 통과!\n');

  // 3. 통계 대시보드 API (/api/stats/dashboard) 검증
  console.log('--- 3. 서울 통계 대시보드 API 검증 ---');
  for (const lawdCd of ['11110', '11440', '11680', '11710']) {
    const dashReq = new Request(`http://localhost:3000/api/stats/dashboard?lawdCd=${lawdCd}`);
    const dashRes = await getDashboard(dashReq);
    const dashJson = await dashRes.json();
    assert.equal(dashJson.success, true, `대시보드 (${lawdCd}) 실패: ${dashJson.error}`);
    assert.ok(dashJson.data?.volumeSummaryByPeriod, `대시보드 (${lawdCd}) volumeSummaryByPeriod 누락`);
    console.log(`[lawdCd ${lawdCd}] 대시보드: volumeSummaryByPeriod=OK, jeonseRate=${dashJson.data?.jeonseRate}%`);
  }
  console.log('✔ 서울 통계 대시보드 검증 통과!\n');

  // 4. 가격 순위 API (/api/stats/price-rankings) 검증
  console.log('--- 4. 가격 순위 API 검증 ---');
  // 4-1. 84㎡ 순위
  const area84Req = new Request('http://localhost:3000/api/stats/price-rankings?lawdCd=11680&mode=area84&period=12m');
  const area84Res = await getPriceRankings(area84Req);
  const area84Json = await area84Res.json();
  assert.equal(area84Json.status, 'OK', '강남구 area84 순위 실패');
  assert.ok(area84Json.rows?.length > 0, '강남구 area84 랭킹 rows가 0입니다');
  console.log(`[강남구] area84 순위: 랭킹 수=${area84Json.rows?.length}, 1위=${area84Json.rows[0]?.name} (${area84Json.rows[0]?.priceLabel})`);

  // 4-2. 전세가율 위험 순위 (jeonse-risk)
  const jeonseRiskReq = new Request('http://localhost:3000/api/stats/price-rankings?lawdCd=11440&mode=jeonse-risk&period=12m');
  const jeonseRiskRes = await getPriceRankings(jeonseRiskReq);
  const jeonseRiskJson = await jeonseRiskRes.json();
  assert.equal(jeonseRiskJson.status, 'OK', '마포구 jeonse-risk 순위 실패');
  assert.ok(jeonseRiskJson.rows?.length > 0, '마포구 jeonse-risk 랭킹 rows가 0입니다');
  console.log(`[마포구] jeonse-risk 순위: 랭킹 수=${jeonseRiskJson.rows?.length}, 1위=${jeonseRiskJson.rows[0]?.name} (전세가율 ${jeonseRiskJson.rows[0]?.jeonseRate}%)`);

  // 4-3. 서울 전체 84㎡ 순위
  const seoul84Req = new Request('http://localhost:3000/api/stats/price-rankings?sidoCode=11&mode=area84&period=12m');
  const seoul84Res = await getPriceRankings(seoul84Req);
  const seoul84Json = await seoul84Res.json();
  assert.equal(seoul84Json.status, 'OK', '서울 전체 area84 순위 실패');
  assert.ok(seoul84Json.rows?.length > 0, '서울 전체 area84 랭킹 rows가 0입니다');
  console.log(`[서울 전체] area84 순위: 랭킹 수=${seoul84Json.rows?.length}, 1위=${seoul84Json.rows[0]?.name} (${seoul84Json.rows[0]?.priceLabel})`);
  console.log('✔ 서울 가격 순위 (area84, jeonse-risk) 검증 통과!\n');

  // 5. 부산 기존 서비스 회귀 검증
  console.log('--- 5. 부산 기존 서비스 0회귀 검증 ---');
  const busanDashReq = new Request('http://localhost:3000/api/stats/dashboard?lawdCd=26350');
  const busanDashRes = await getDashboard(busanDashReq);
  const busanDashJson = await busanDashRes.json();
  assert.equal(busanDashJson.success, true, '부산 해운대구 대시보드 실패');

  const busanFeedReq = new Request('http://localhost:3000/api/stats/feed?lawdCd=26350&dealType=jeonse&period=12m');
  const busanFeedRes = await getFeed(busanFeedReq);
  const busanFeedJson = await busanFeedRes.json();
  assert.equal(busanFeedJson.status, 'OK', '부산 해운대구 전세 피드 실패');
  console.log(`[부산 해운대구] 정상 동작 확인: 대시보드 success=${busanDashJson.success}, feed jeonse count=${busanFeedJson.pagination?.total}`);
  console.log('✔ 부산 기존 서비스 100% 정상 보존 확인!\n');

  // 6. Cron Scope 검증
  console.log('--- 6. Cron Scope 검증 ---');
  const defaultScope = resolveRentSyncScope(null);
  assert.equal(defaultScope.ok, true);
  assert.equal(defaultScope.scope, 'busan', '기본 스코프가 busan이 아닙니다');
  assert.equal(defaultScope.lawdCds, undefined, '기본 스코프는 lawdCds가 undefined여야 합니다(부산 16구 코어로 위임)');

  const seoulAllScope = resolveRentSyncScope('seoul-all');
  assert.equal(seoulAllScope.ok, true);
  assert.equal(seoulAllScope.scope, 'seoul-all', 'seoul-all 스코프 해석 실패');
  assert.equal(seoulAllScope.lawdCds?.length, 25, '서울 전체 구 개수가 25가 아닙니다');
  console.log(`Cron Scope: default(busan)=코어위임, seoul-all=${seoulAllScope.lawdCds?.length}구`);
  console.log('✔ Cron Scope 분기 검증 통과!\n');

  await prisma.$disconnect();
  console.log('🎉 모든 E-JIP 서울 V4.1 서비스 검증을 성공적으로 마쳤습니다!');
}

main().catch((err) => {
  console.error('검증 중 오류 발생:', err);
  process.exit(1);
});
