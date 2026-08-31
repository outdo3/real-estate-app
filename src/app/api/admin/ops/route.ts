import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-helpers';
import { getOrSetCache } from '@/lib/server-cache';
import { getSidoList, getSigunguListForSido } from '@/lib/region-utils';
import { HISTORICAL_LOOKBACK_MONTHS, historicalCoverageLabel } from '@/lib/price-ranking';

export const dynamic = 'force-dynamic';

// ADMIN_OPS_V1 §11/§28 — "지금 데이터가 정상인가"를 30초 안에 판단하게 하는 것이
// 목적이다(§48). 무거운 unscoped COUNT(*)는 실측 5~9초(부산 스코프는 158ms~2s대) —
// 매 페이지 로드마다 재계산하면 안 되므로(§28 성능 요구) 전체 응답을 5분 캐시한다
// (기존 admin/dashboard/route.ts의 pipeline health 캐시와 동일 패턴 재사용).
const CACHE_TTL_MS = 5 * 60 * 1000;

const BUSAN_16 = [
  '26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
  '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710',
];

const NATIONWIDE_MANIFEST_PATH = path.join(process.cwd(), 'data/trade-history/nationwide-sync-manifest.json');
const RESYNC_V2_MANIFEST_PATH = path.join(process.cwd(), 'data/trade-history/cancellation-resync-v2-manifest.json');

interface CellEntry {
  status: 'COMPLETE' | 'EMPTY_VALID' | 'FAILED' | 'INVALID';
  fetched: number;
  invalidRows: number;
  insertCount: number;
  updateFalseToTrue: number;
  updateTrueToFalseSkipped: number;
  conflicts: number;
  reviewRequired?: number; // STEP F-2 이전 manifest entry는 이 필드가 없을 수 있음 — 방어적으로 처리
  at: string;
}
type Manifest = Record<string, CellEntry>;

function readManifest(filePath: string): Manifest {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(`[admin/ops] manifest 읽기 실패: ${filePath}`, e);
    return {};
  }
}

function summarizeManifest(manifest: Manifest) {
  const entries = Object.values(manifest);
  let complete = 0, emptyValid = 0, failed = 0, invalid = 0;
  let rowsInserted = 0, cancellationsUpdated = 0, reviewRequired = 0;
  let lastSyncAt: string | null = null;
  for (const e of entries) {
    if (e.status === 'COMPLETE') complete++;
    else if (e.status === 'EMPTY_VALID') emptyValid++;
    else if (e.status === 'FAILED') failed++;
    else if (e.status === 'INVALID') invalid++;
    rowsInserted += e.insertCount || 0;
    cancellationsUpdated += e.updateFalseToTrue || 0;
    reviewRequired += e.reviewRequired || 0;
    if (!lastSyncAt || e.at > lastSyncAt) lastSyncAt = e.at;
  }
  return { cells: entries.length, complete, emptyValid, failed, invalid, rowsInserted, cancellationsUpdated, reviewRequired, lastSyncAt };
}

// ADMIN_OPS_V1 §13 — 하드코딩된 숫자만 표시하지 않는다. getSidoList()/
// getSigunguListForSido()는 이미 STEP F/F-2가 검증한 런타임 조회 함수를 그대로
// 재사용한다(§7 새 auth/region 체계를 만들지 않음과 동일 원칙 — sync 엔진과
// 동일한 함수). 외부 REGCODE_PROXY 호출이라 5분 캐시 안에서만 재계산한다.
async function buildNationwideRegionModel() {
  const sidoList = await getSidoList();
  let syncTargets = 0;
  for (const sido of sidoList) {
    const list = await getSigunguListForSido(sido.code);
    syncTargets += list.length;
  }
  const sejong = sidoList.some((s) => s.code === '36');
  return { sidoCount: sidoList.length, syncTargets, sejongInRegionModel: sejong };
}

async function buildSummary() {
  const now = new Date();

  // §11 TradeHistory — 부산 스코프 count는 158ms~2s대(실측)로 캐시 없이도 감당
  // 가능하지만, 전체 응답을 5분 캐시하므로 여기서도 안전하게 병렬 실행한다.
  // duplicate는 DB 레벨 unique constraint(`trade_natural_key`, prisma/schema.prisma)로
  // 구조적으로 0이 보장된다 — 매번 무거운 COUNT DISTINCT 재계산 없이 "0(스키마
  // 제약으로 보장)"으로 정직하게 표시한다(§12 — 실시간 계산이 비효율적이면 최근
  // 검증 결과로 표시, 숫자를 추정하지 않는다. 이 경우는 추정이 아니라 스키마
  // 자체가 보장하는 사실이라는 점을 doc에 근거로 남긴다).
  const [busanTotal, busanCanceled, aptSeqMissing, latestDealAgg] = await Promise.all([
    prisma.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 } } }),
    prisma.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 }, dealCanceled: true } }),
    prisma.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 }, aptSeq: null } }),
    prisma.apartmentTradeHistory.aggregate({ where: { lawdCd: { in: BUSAN_16 } }, _max: { dealDate: true } }),
  ]);

  const nationwideManifest = readManifest(NATIONWIDE_MANIFEST_PATH);
  const nationwideSummary = summarizeManifest(nationwideManifest);
  const resyncV2Manifest = readManifest(RESYNC_V2_MANIFEST_PATH);
  const resyncV2Summary = summarizeManifest(resyncV2Manifest);

  const regionModel = await buildNationwideRegionModel();

  // §18/§19 — 24개월 cancellation completeness는 TRADE_CANCELLATION_RESYNC_V2가
  // 이미 실측/문서화한 결론이다(older 11개월 write manifest는 여기서 라이브로
  // 재확인 가능하지만, "전체 24개월 read-only 재검증" 384-cell dry-run 결과는
  // 파일로 영속화되지 않아 — dry-run은 manifest를 저장하지 않음 — 라이브로 다시
  // 계산할 수 없다). older window write manifest(FAILED/INVALID=0 여부)는 실제로
  // 재확인하고, 전체 24개월 SAFE 판정 자체는 문서 근거(TRADE_CANCELLATION_RESYNC_
  // V2_24M.md)를 명시해 "코드 실행 시점이 아니라 문서 기준"임을 숨기지 않는다.
  const olderWindowIntact = resyncV2Summary.failed === 0 && resyncV2Summary.invalid === 0;

  const overallWarnings: string[] = [];
  if (aptSeqMissing > 0) overallWarnings.push(`부산 aptSeq 없는 row ${aptSeqMissing}건 발견`);
  if (nationwideSummary.failed > 0) overallWarnings.push(`전국 sync FAILED cell ${nationwideSummary.failed}건`);
  if (nationwideSummary.invalid > 0) overallWarnings.push(`전국 sync INVALID cell ${nationwideSummary.invalid}건`);
  if (nationwideSummary.reviewRequired > 0) overallWarnings.push(`REVIEW_REQUIRED 거래 ${nationwideSummary.reviewRequired}건(aptSeq 없어 미반영)`);
  if (!olderWindowIntact) overallWarnings.push('24개월 취소검증(older window) manifest에 FAILED/INVALID 존재');
  if (!regionModel.sejongInRegionModel) overallWarnings.push('세종특별자치시가 region model에서 조회되지 않음');

  const overallStatus: '정상' | '확인 필요' = overallWarnings.length === 0 ? '정상' : '확인 필요';

  return {
    overall: {
      status: overallStatus,
      warningsCount: overallWarnings.length,
      lastCheckedAt: now.toISOString(),
    },
    tradeHistory: {
      busanTotal,
      busanActive: busanTotal - busanCanceled,
      busanCanceled,
      latestDealDate: latestDealAgg._max.dealDate ? latestDealAgg._max.dealDate.toISOString().slice(0, 10) : null,
      aptSeqMissing,
      // §12 — DB unique constraint(trade_natural_key)가 자연키 중복을 구조적으로
      // 차단하므로, 무거운 COUNT DISTINCT 재계산 없이도 항상 참인 사실이다.
      naturalKeyDuplicates: { value: 0, source: 'schema_constraint' as const },
      reviewRequired: nationwideSummary.reviewRequired,
    },
    coverage: {
      busan: { covered: 16, total: 16 },
      nationwide: { sido: regionModel.sidoCount, syncTargets: regionModel.syncTargets },
      sejong: {
        regionModel: regionModel.sejongInRegionModel ? '정상' : '확인 필요',
        tradeDbCoverage: '미수집', // STEP F-2 §12 — dry-run만 검증됨, 실제 write 없음(문서 근거)
      },
      // §22 — 전국 sync engine이 있다고 전국 DB coverage가 끝났다고 과장하지 않는다.
      nationwideDbCoverageNote: '전국 sync engine 준비 완료(엔진), 전국 DB 실데이터 적재는 부산 외 극히 일부 QA 샘플만 존재',
    },
    incrementalSync: {
      lastSyncAt: nationwideSummary.lastSyncAt,
      cells: nationwideSummary.cells,
      complete: nationwideSummary.complete,
      emptyValid: nationwideSummary.emptyValid,
      failed: nationwideSummary.failed,
      invalid: nationwideSummary.invalid,
      rowsInserted: nationwideSummary.rowsInserted,
      cancellationsUpdated: nationwideSummary.cancellationsUpdated,
      scheduler: 'OFF' as const, // §16 — 사실. vercel.json/cron 없음(STEP F 감사 결과), 의도된 상태.
      nextScheduledSync: null, // §17 — 스케줄러가 없으므로 임의로 만들지 않음.
    },
    cancellation: {
      lookbackMonths: HISTORICAL_LOOKBACK_MONTHS,
      coverageLabel: historicalCoverageLabel(),
      window24m: {
        verdict: 'SAFE' as const,
        source: 'TRADE_CANCELLATION_RESYNC_V2_24M.md(문서 기준, 코드 실행 시점 재계산 아님)',
        olderWindowManifestIntact: olderWindowIntact,
        olderWindowFailed: resyncV2Summary.failed,
        olderWindowInvalid: resyncV2Summary.invalid,
      },
      allTime: {
        verdict: 'NOT_VERIFIED' as const,
        note: '역대(2006년~) 전체 이력 취소 완전성은 검증되지 않음 — "역대" 표현 계속 금지',
      },
    },
    features: [
      { name: '84㎡ 국민평형', source: 'TradeHistory DB', busan: 'DB-FIRST', trust: '정상' },
      { name: '거래량(매매)', source: 'TradeHistory DB', busan: 'DB-FIRST', trust: '정상' },
      { name: '최근 상승', source: 'TradeHistory DB', busan: 'DB-FIRST', trust: '정상' },
      { name: '최근 하락', source: 'TradeHistory DB', busan: 'DB-FIRST', trust: '정상' },
      { name: '지역 변동지도', source: 'TradeHistory DB', busan: 'DB-FIRST', trust: '정상' },
      { name: '2년최고가', source: 'TradeHistory DB', busan: 'DB-FIRST', trust: '24개월 SAFE' },
    ],
    warnings: overallWarnings,
  };
}

export async function GET() {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const data = await getOrSetCache('admin-ops:summary', CACHE_TTL_MS, buildSummary);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Failed to build admin ops summary:', error);
    return NextResponse.json({ success: false, error: '운영 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
