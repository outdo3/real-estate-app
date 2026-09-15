// REGIONAL_SEO_KEYWORD_LANDING_V1 §8/§15 — 동 색인 판정용 **읽기 전용** 조회.
//
// 사이트맵·동 페이지 robots·구 페이지 동 링크가 **같은 결과**를 쓰도록 한 번에 묶어 읽고
// 인스턴스 메모리에 캐시한다. SELECT(groupBy)만 한다. 스코프/취소 규칙은 리포트와 같다
// (부산 현행 16개 lawdCd, dealCanceled=false).
//
// 조회 실패는 "거래 없음"이 아니다 — 캐시에 남기지 않고 null로 돌려준다. 호출부는
// null이면 동 이름을 제목에 쓰지 않고 색인도 하지 않는다.

import { prisma } from '@/lib/prisma';
import { getOrSetCache } from '@/lib/server-cache';
import { BUSAN_CURRENT_LAWD_CODES } from '@/lib/report/region-scope';
import type { DongTradeCount } from './report-region-seo';

const CACHE_KEY = 'seo:busan-dong-trade-counts:1y';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function ymdUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 최근 1년(어제까지 365일, 리포트 기본 기간과 같은 "어제" 기준) 동별 거래 수. */
async function fetchBusanDongTradeCounts(now: Date): Promise<DongTradeCount[]> {
  const end = ymdUtc(now);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  const grouped = await prisma.apartmentTradeHistory.groupBy({
    by: ['lawdCd', 'dong'],
    where: {
      lawdCd: { in: [...BUSAN_CURRENT_LAWD_CODES] },
      dealCanceled: false,
      dealDate: { gte: start, lte: end },
    },
    _count: { _all: true },
  });
  return grouped.map((g) => ({ lawdCd: g.lawdCd, dong: g.dong, count: g._count._all }));
}

/** 실패하면 null. 성공한 결과만 캐시된다(getOrSetCache는 throw를 저장하지 않는다). */
export async function readBusanDongTradeCounts(): Promise<DongTradeCount[] | null> {
  try {
    return await getOrSetCache(CACHE_KEY, CACHE_TTL_MS, () => fetchBusanDongTradeCounts(new Date()));
  } catch (e) {
    console.error('[seo] 부산 동별 거래 수 조회 실패', e);
    return null;
  }
}

/** 한 동의 최근 1년 거래 수. 목록 조회가 실패하면 null(=미확인), 목록에 없으면 0. */
export async function readDongTrailingYearTrades(lawdCd: string, dong: string): Promise<number | null> {
  const rows = await readBusanDongTradeCounts();
  if (!rows) return null;
  return rows.find((r) => r.lawdCd === lawdCd && r.dong === dong)?.count ?? 0;
}
