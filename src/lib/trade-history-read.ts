// TRADE_HISTORY_DATA_V1 — §33/§34 COMMON READ HELPER. ApartmentTradeHistory(영구 저장
// 이력)를 읽는 최소 proof/query 수준의 순수 헬퍼. 이번 STEP에서는 어떤 live API
// route에서도 import하지 않는다(§33 DB-FIRST READ PATH — DO NOT FLIP YET) — 다음
// STEP(TRADE_HISTORY_READ_MIGRATION_V1)에서 기존 라이브 통계 API가 이 헬퍼로 전환할
// 때 재사용한다. identity 정의는 regional-feed.ts와 동일하게 aptSeq 우선/name+dong
// 폴백을 그대로 쓴다(새로 발명하지 않음).
import { PrismaClient } from '@prisma/client';
import { identityKey } from './regional-feed';

const prisma = new PrismaClient();

export interface TradeIdentity {
  aptSeq: string | null;
  name: string;
  dong: string;
}

function resolveIdentityKey(identity: TradeIdentity): string {
  return identityKey(identity);
}

export interface StoredTrade {
  id: number;
  lawdCd: string;
  aptSeq: string | null;
  aptName: string;
  dong: string;
  exclusiveArea: string; // Prisma.Decimal -> string(정밀도 보존, 호출부가 필요시 Number() 변환)
  dealAmount: number;
  dealDate: Date;
  floor: number | null; // DB 컬럼 자체는 nullable(스키마 참고) — 정상 backfill row는 항상 값이 있음
  dealCanceled: boolean;
}

function toStoredTrade<
  T extends {
    id: number;
    lawdCd: string;
    aptSeq: string | null;
    aptName: string;
    dong: string;
    exclusiveArea: { toString(): string };
    dealAmount: number;
    dealDate: Date;
    floor: number | null;
    dealCanceled: boolean;
  },
>(row: T): StoredTrade {
  const { id, lawdCd, aptSeq, aptName, dong, dealAmount, dealDate, floor, dealCanceled } = row;
  return { id, lawdCd, aptSeq, aptName, dong, dealAmount, dealDate, floor, dealCanceled, exclusiveArea: row.exclusiveArea.toString() };
}

/** 취소 제외, 같은 identity+exact area(dealType='sale')의 전체 저장 이력(시간순). */
export async function getTradeHistory(identity: TradeIdentity, exclusiveArea: number): Promise<StoredTrade[]> {
  const idKey = resolveIdentityKey(identity);
  const rows = await prisma.apartmentTradeHistory.findMany({
    // §QA-FIX — Prisma가 Decimal 컬럼을 JS number(float64)로 필터링할 때 일부 값
    // (실측: 84.8773, 84.6389 등)에서 내부 직렬화 반올림 차이로 조용히 0건을 반환하는
    // 현상을 backfill 완료 후 QA에서 발견했다(같은 값을 string으로 넘기면 정상 매칭).
    // 문자열로 넘겨 Decimal 파싱 경로를 타게 해 무손실 비교를 보장한다.
    where: { identityKey: idKey, exclusiveArea: String(exclusiveArea), dealType: 'sale', dealCanceled: false },
    orderBy: { dealDate: 'asc' },
  });
  return rows.map((r) => toStoredTrade(r));
}

/** §29/§30 TRUE RECORD HIGH — DB에 저장된 전체 이력 기준 최고가(취소 제외). backfill
 * completeness가 검증되지 않은 기간/지역에서는 "역대"라는 표현을 UI에 쓰면 안 된다
 * (§30 ALL-TIME CLAIM SAFETY — 이 함수 자체는 그 검증을 하지 않는다, 호출부 책임). */
export async function getAllTimeHigh(identity: TradeIdentity, exclusiveArea: number): Promise<{ amount: number; date: Date } | null> {
  const idKey = resolveIdentityKey(identity);
  const top = await prisma.apartmentTradeHistory.findFirst({
    // §QA-FIX — getTradeHistory와 동일 이유(문자열로 넘겨 Decimal float 직렬화 오매칭 방지).
    where: { identityKey: idKey, exclusiveArea: String(exclusiveArea), dealType: 'sale', dealCanceled: false },
    orderBy: [{ dealAmount: 'desc' }, { dealDate: 'asc' }],
  });
  if (!top) return null;
  return { amount: top.dealAmount, date: top.dealDate };
}

/** §50 — 주어진 날짜 이전(strictly earlier), 같은 identity+exact area의 가장 최근
 * 검증된(비취소) 거래. */
export async function getPreviousTrade(identity: TradeIdentity, exclusiveArea: number, beforeDate: Date): Promise<{ amount: number; date: Date } | null> {
  const idKey = resolveIdentityKey(identity);
  const prev = await prisma.apartmentTradeHistory.findFirst({
    where: {
      identityKey: idKey,
      // §QA-FIX — getTradeHistory와 동일 이유(문자열로 넘겨 Decimal float 직렬화 오매칭 방지).
      exclusiveArea: String(exclusiveArea),
      dealType: 'sale',
      dealCanceled: false,
      dealDate: { lt: beforeDate },
    },
    orderBy: { dealDate: 'desc' },
  });
  if (!prev) return null;
  return { amount: prev.dealAmount, date: prev.dealDate };
}

/** 지역+기간 내 전체 거래(취소 포함 — 호출부가 필요시 필터링). */
export async function getRegionalTrades(lawdCd: string, from: Date, to: Date): Promise<StoredTrade[]> {
  const rows = await prisma.apartmentTradeHistory.findMany({
    where: { lawdCd, dealDate: { gte: from, lte: to } },
    orderBy: { dealDate: 'desc' },
  });
  return rows.map((r) => toStoredTrade(r));
}
