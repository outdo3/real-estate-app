// OFFICETEL_INCREMENTAL_SYNC_V1 — sync core의 DB 포트를 Prisma로 구현한다.
//
// PrismaClient를 인자로 받는다(전역 싱글턴 import 금지): route는 '@/lib/prisma'를, CLI는 자기 클라이언트를 넘기고,
// 테스트는 이 파일을 아예 쓰지 않고 메모리 fake를 쓴다. 그래서 이 파일을 import해도 DB 접속이 일어나지 않는다.
import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  ExistingRentRow,
  ExistingSaleRow,
  MasterRef,
  OfficetelCellRecord,
  OfficetelCellState,
  OfficetelSyncDataset,
  OfficetelSyncDb,
  PreparedRent,
  PreparedSale,
  SaleCancelUpdate,
} from './types';

/** 한 번에 넣는 행 수(STEP 3B와 같은 값). 한 트랜잭션에 대량 행을 넣지 않는다. */
export const OFFICETEL_INSERT_CHUNK = 500;

function monthBounds(dealYmd: string): { gte: Date; lt: Date } {
  const y = Number(dealYmd.slice(0, 4));
  const m = Number(dealYmd.slice(4, 6));
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

function toCreateData<T extends PreparedSale | PreparedRent>(r: T): Omit<T, 'exclusiveArea' | 'dealDate'> & { exclusiveArea: Prisma.Decimal; dealDate: Date } {
  return { ...r, exclusiveArea: new Prisma.Decimal(r.exclusiveArea), dealDate: new Date(`${r.dealDate}T00:00:00.000Z`) };
}

export function createPrismaOfficetelDb(prisma: PrismaClient): OfficetelSyncDb {
  return {
    async loadMasters(lawdCd: string): Promise<MasterRef[]> {
      return prisma.officetelMaster.findMany({
        where: { sggCd: lawdCd },
        select: { id: true, sggCd: true, normalizedUmdNm: true, normalizedJibun: true },
      });
    },

    async loadExistingSale(lawdCd: string, dealYmd: string): Promise<ExistingSaleRow[]> {
      const rows = await prisma.officetelTradeHistory.findMany({
        where: { lawdCd, dealDate: monthBounds(dealYmd) },
        select: { id: true, canonicalKey: true, dealDate: true, exclusiveArea: true, dealAmount: true, floor: true, occurrenceIndex: true, dealCanceled: true },
      });
      return rows.map((r) => ({ ...r, exclusiveArea: r.exclusiveArea.toString() }));
    },

    async loadExistingRent(lawdCd: string, dealYmd: string): Promise<ExistingRentRow[]> {
      const rows = await prisma.officetelRentHistory.findMany({
        where: { lawdCd, dealDate: monthBounds(dealYmd) },
        select: { canonicalKey: true, dealDate: true, exclusiveArea: true, deposit: true, monthlyRent: true, floor: true, occurrenceIndex: true },
      });
      return rows.map((r) => ({ ...r, exclusiveArea: r.exclusiveArea.toString() }));
    },

    async insertSale(rows: PreparedSale[]): Promise<number> {
      let n = 0;
      for (let i = 0; i < rows.length; i += OFFICETEL_INSERT_CHUNK) {
        const res = await prisma.officetelTradeHistory.createMany({
          data: rows.slice(i, i + OFFICETEL_INSERT_CHUNK).map(toCreateData),
          skipDuplicates: true,
        });
        n += res.count;
      }
      return n;
    },

    async insertRent(rows: PreparedRent[]): Promise<number> {
      let n = 0;
      for (let i = 0; i < rows.length; i += OFFICETEL_INSERT_CHUNK) {
        const res = await prisma.officetelRentHistory.createMany({
          data: rows.slice(i, i + OFFICETEL_INSERT_CHUNK).map(toCreateData),
          skipDuplicates: true,
        });
        n += res.count;
      }
      return n;
    },

    async cancelSale(updates: SaleCancelUpdate[]): Promise<number> {
      let n = 0;
      for (const u of updates) {
        // dealCanceled=false 조건: 이미 취소된 행을 다시 쓰지 않는다(동시 실행에도 한 번만 반영).
        const res = await prisma.officetelTradeHistory.updateMany({
          where: { id: u.id, dealCanceled: false },
          data: { dealCanceled: true, cancelDate: u.cancelDate, sourceFetchedAt: u.sourceFetchedAt },
        });
        n += res.count;
      }
      return n;
    },

    async loadCellStates(dataset: OfficetelSyncDataset, dealYmds: string[]): Promise<OfficetelCellState[]> {
      return prisma.officetelSyncCell.findMany({
        where: { dataset, dealYmd: { in: dealYmds } },
        select: { lawdCd: true, dealYmd: true, verifiedAt: true },
      });
    },

    async recordCell(rec: OfficetelCellRecord): Promise<void> {
      const common = {
        status: rec.status,
        failureReason: rec.failureReason,
        sourceTotalCount: rec.sourceTotalCount,
        fetchedCount: rec.fetchedCount,
        insertedCount: rec.insertedCount,
        updatedCount: rec.updatedCount,
        duplicateCount: rec.duplicateCount,
        unresolvedCount: rec.unresolvedCount,
        invalidRowCount: rec.invalidRowCount,
        runId: rec.runId,
        attemptedAt: rec.attemptedAt,
      };
      await prisma.officetelSyncCell.upsert({
        where: { officetel_sync_cell_key: { dataset: rec.dataset, lawdCd: rec.lawdCd, dealYmd: rec.dealYmd } },
        create: { dataset: rec.dataset, lawdCd: rec.lawdCd, dealYmd: rec.dealYmd, ...common, verifiedAt: rec.verifiedAt },
        // 실패한 시도가 이전의 검증 시각을 지우지 않도록, COMPLETE일 때만 verifiedAt을 바꾼다.
        update: { ...common, ...(rec.verifiedAt ? { verifiedAt: rec.verifiedAt } : {}) },
      });
    },
  };
}
