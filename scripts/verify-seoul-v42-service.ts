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
import { SEOUL_RENT_ALL_25_LAWDCDS } from '../src/lib/sync/rent-sync-scope';
import { prisma } from '../src/lib/prisma';

async function main() {
  console.log('=== E-JIP 서울 V4.2 정합성 수정 및 종합 서비스 검증 ===\n');

  // 1. P0: 서울 전월세 피드 집계 정합성 전수 검증
  console.log('--- 1. P0: 서울 전월세 피드 집계 정합성 검증 ---');
  // 1-1. Backfill 전수 기간(2025-11-01 ~ 2026-10-31) 피드 질의
  const reqJeonseFull = new Request('http://localhost:3000/api/stats/feed?sidoCode=11&dealType=jeonse&period=custom&from=2025-11-01&to=2026-10-31&limit=1');
  const resJeonseFull = await getFeed(reqJeonseFull);
  const jsonJeonseFull = await resJeonseFull.json();
  assert.equal(jsonJeonseFull.status, 'OK');
  assert.equal(jsonJeonseFull.pagination?.total, 119510, '서울 전세 전수 건수가 DB 119,510건과 불일치합니다');
  console.log(`[전세 전수 검증] 피드 total=${jsonJeonseFull.pagination?.total} / DB count=119,510 (100% 일치)`);

  const reqWolseFull = new Request('http://localhost:3000/api/stats/feed?sidoCode=11&dealType=wolse&period=custom&from=2025-11-01&to=2026-10-31&limit=1');
  const resWolseFull = await getFeed(reqWolseFull);
  const jsonWolseFull = await resWolseFull.json();
  assert.equal(jsonWolseFull.status, 'OK');
  assert.equal(jsonWolseFull.pagination?.total, 121346, '서울 월세 전수 건수가 DB 121,346건과 불일치합니다');
  console.log(`[월세 전수 검증] 피드 total=${jsonWolseFull.pagination?.total} / DB count=121,346 (100% 일치)`);

  const totalRent = (jsonJeonseFull.pagination?.total || 0) + (jsonWolseFull.pagination?.total || 0);
  assert.equal(totalRent, 240856, '전월세 합계가 240,856건과 불일치합니다');
  console.log(`[전월세 합계] ${totalRent}건 / 240,856건 (100.000% 완전 일치 확인)`);

  // 1-2. 12m rolling window (2025-12-01 ~ 2026-11-25) 검증
  const reqWolse12m = new Request('http://localhost:3000/api/stats/feed?sidoCode=11&dealType=wolse&period=12m&limit=1');
  const resWolse12m = await getFeed(reqWolse12m);
  const jsonWolse12m = await resWolse12m.json();
  // 110,745 (V4.1) + 449 (무보증 월세 복구) = 111,194
  assert.equal(jsonWolse12m.pagination?.total, 111194, '무보증 월세 449건 복구 후 111,194건이어야 합니다');
  console.log(`[12m rolling window 월세] total=${jsonWolse12m.pagination?.total} (무보증 월세 449건 온전히 복구 완료)\n`);

  // 2. P0: 강남구 84㎡ 순위 지역 필터 무결성 검증
  console.log('--- 2. P0: 강남구 84㎡ 순위 지역 필터 검증 ---');
  const reqGangnam84 = new Request('http://localhost:3000/api/stats/price-rankings?lawdCd=11680&mode=area84&period=12m');
  const resGangnam84 = await getPriceRankings(reqGangnam84);
  const jsonGangnam84 = await resGangnam84.json();
  assert.equal(jsonGangnam84.status, 'OK');
  assert.ok(jsonGangnam84.rows?.length > 0);

  const nonGangnamRows = jsonGangnam84.rows.filter((r: any) => r.lawdCd !== '11680');
  assert.equal(nonGangnamRows.length, 0, `강남구 순위에 타 구 단지 ${nonGangnamRows.length}개가 유출되었습니다`);
  const seochoInGangnam = jsonGangnam84.rows.filter((r: any) => r.name.includes('반포') || r.name.includes('아크로리버파크'));
  assert.equal(seochoInGangnam.length, 0, '강남구 순위에 서초구 단지가 포함되어 있습니다');
  console.log(`[강남구 84㎡ 순위] 30개 랭킹 중 타 구 단지 0개 (100% 강남구 단지 격리 확인)`);
  console.log(`  1위: ${jsonGangnam84.rows[0].name} (${jsonGangnam84.rows[0].dong}, ${jsonGangnam84.rows[0].priceLabel})`);
  console.log(`  2위: ${jsonGangnam84.rows[1].name} (${jsonGangnam84.rows[1].dong}, ${jsonGangnam84.rows[1].priceLabel})\n`);

  // 3. 서울 대표 5개 단지 상세 조회 검증
  console.log('--- 3. 서울 대표 5개 단지 상세 조회 (매매 / 전월세) ---');
  const targetApts = [
    { name: '경희궁자이(2단지)', lawdCd: '11110', aptSeq: '11110-2445', district: '종로구' },
    { name: '마포래미안푸르지오1단지', lawdCd: '11440', aptSeq: '11440-5407', district: '마포구' },
    { name: '반포자이', lawdCd: '11650', aptSeq: '11650-3500', district: '서초구' },
    { name: '은마', lawdCd: '11680', aptSeq: '11680-218', district: '강남구' },
    { name: '헬리오시티', lawdCd: '11710', aptSeq: '11710-8865', district: '송파구' },
  ];

  for (const apt of targetApts) {
    const rentReq = new Request(`http://localhost:3000/api/apt/${encodeURIComponent(apt.name)}?lawdCd=${apt.lawdCd}&aptSeq=${apt.aptSeq}&type=rent&period=12m`);
    const rentRes = await getAptDetail(rentReq, { params: Promise.resolve({ name: apt.name }) });
    const rentJson = await rentRes.json();
    assert.ok(!rentJson.apiError);
    assert.ok((rentJson.trades?.length || 0) > 0);
    assert.equal(rentJson.tradeDataSource, 'DB');
    console.log(`[${apt.district}] ${apt.name}: 전월세 건수=${rentJson.trades.length}, 소스=DB, 최근거래=${rentJson.trades[0]?.tradeDate} (${rentJson.trades[0]?.priceStr})`);
  }
  console.log('✔ 대표 5개 단지 상세 DB 전월세 조회 통과!\n');

  // 4. 서울 25개 구 전수 대시보드 및 게이트 점검
  console.log('--- 4. 서울 25개 구 통계 대시보드 전수 점검 ---');
  let successDistricts = 0;
  for (const lawdCd of SEOUL_RENT_ALL_25_LAWDCDS) {
    const dashReq = new Request(`http://localhost:3000/api/stats/dashboard?lawdCd=${lawdCd}`);
    const dashRes = await getDashboard(dashReq);
    const dashJson = await dashRes.json();
    assert.equal(dashJson.success, true, `구 ${lawdCd} 대시보드 실패`);
    assert.ok(dashJson.data?.volumeSummaryByPeriod, `구 ${lawdCd} 거래량 요약 누락`);
    successDistricts++;
  }
  console.log(`✔ 서울 25개 구 전수 대시보드 점검 완료 (${successDistricts}/25 통과)\n`);

  // 5. 부산 기존 서비스 0회귀 검증
  console.log('--- 5. 부산 해운대구/수영구 0회귀 검증 ---');
  for (const bLawdCd of ['26350', '26500']) {
    const bDashReq = new Request(`http://localhost:3000/api/stats/dashboard?lawdCd=${bLawdCd}`);
    const bDashRes = await getDashboard(bDashReq);
    const bDashJson = await bDashRes.json();
    assert.equal(bDashJson.success, true);

    const bFeedReq = new Request(`http://localhost:3000/api/stats/feed?lawdCd=${bLawdCd}&dealType=jeonse&period=12m`);
    const bFeedRes = await getFeed(bFeedReq);
    const bFeedJson = await bFeedRes.json();
    assert.equal(bFeedJson.status, 'OK');
  }
  console.log('✔ 부산 기존 서비스 100% 정상 보존 확인!\n');

  await prisma.$disconnect();
  console.log('🎉 모든 E-JIP 서울 V4.2 정합성 및 서비스 검증 완료!');
}

main().catch((err) => {
  console.error('검증 실패:', err);
  process.exit(1);
});
