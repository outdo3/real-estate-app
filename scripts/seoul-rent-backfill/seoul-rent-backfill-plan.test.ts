import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  calculateBackfillEstimate,
  MOLIT_RENT_PAGE_SIZE,
  MIN_CALLS_PER_CELL,
  AVERAGE_PAGES_PER_CELL_NORMAL,
} from './seoul-rent-backfill-plan';
import {
  RealMolitRentFetcher,
  PrismaRentDbStore,
  createJongnoTestPlan,
} from './seoul-rent-backfill-adapters';

describe('Seoul Rent Backfill Plan & Mathematical Integrity Tests', () => {
  describe('calculateBackfillEstimate Mathematical Parity', () => {
    it('verifies mathematical parity with PAGE_SIZE = 1000 for Seoul 25 districts 1 year (300 cells)', () => {
      const estimate = calculateBackfillEstimate({
        scope: 'seoul-all',
        fromYmd: '202501',
        toYmd: '202512',
      });

      assert.ok(estimate !== null);
      assert.equal(estimate.districtCount, 25);
      assert.equal(estimate.monthCount, 12);
      assert.equal(estimate.totalCells, 300);
      assert.equal(estimate.pageSize, 1000); // 국토부 실제 numOfRows 규격
      assert.equal(estimate.estimatedRowsCount, 195000); // 300셀 * 650건

      // 1. 최소 호출 수: 각 셀당 최소 1회이므로 300회 이상이어야 함
      assert.ok(estimate.normalMolitCalls >= 300);

      // 2. 수학적 정합성 검증:
      // 만약 pageSize가 100이었다면 195,000 / 100 = 1,950회가 필요했을 것임.
      // 그러나 실제 pageSize=1000이므로 195,000건 분할 시 순수 데이터 페이지만은 195페이지이고,
      // 300개 셀의 기본 1회 호출(최소 300회)과 대단지 구 2페이지(약 84회)를 더해 384회가 정상 산출됨.
      assert.equal(estimate.normalCallsPerCell, AVERAGE_PAGES_PER_CELL_NORMAL); // 1.28
      assert.equal(estimate.normalMolitCalls, 384); // ceil(300 * 1.28)
      assert.equal(estimate.upperBoundMolitCalls, 442); // 15% 재시도 버퍼 포함

      // 3. 소요 시간 구분 검증:
      // API 네트워크+페이싱: 384 * 0.5s = 192s
      // CPU 처리: 300 * 0.01s = 3s
      // DB I/O: 300 * 0.04s = 12s
      // 총 시간: (192 + 3 + 12) / 60 ≈ 3.5분
      assert.equal(estimate.breakdownRuntime.apiNetworkSeconds, 192);
      assert.equal(estimate.breakdownRuntime.cpuProcessingSeconds, 3);
      assert.equal(estimate.breakdownRuntime.dbIoSeconds, 12);
      assert.equal(estimate.breakdownRuntime.totalMinutes, 3.5);

      // 4. DB 용량 추정 (행당 400B): 195,000 * 400B / (1024*1024) ≈ 74.4 MB
      assert.equal(estimate.estimatedDbSizeMb, 74.4);
      assert.equal(estimate.isEstimateValidated, true);
    });

    it('calculates shard-level estimates accurately for seoul-a (8 districts)', () => {
      const estimateA = calculateBackfillEstimate({
        scope: 'seoul-a',
        fromYmd: '202501',
        toYmd: '202512',
      });

      assert.ok(estimateA !== null);
      assert.equal(estimateA.districtCount, 8);
      assert.equal(estimateA.totalCells, 96); // 8 * 12
      assert.equal(estimateA.normalMolitCalls, 123); // ceil(96 * 1.28)
      assert.equal(estimateA.upperBoundMolitCalls, 142);
      assert.equal(estimateA.breakdownRuntime.totalMinutes, 1.1);
      assert.equal(estimateA.estimatedDbSizeMb, 23.8); // 96 * 650 * 400B
    });
  });

  describe('Real Adapter Safety Guards', () => {
    it('blocks RealMolitRentFetcher when allowLiveNetwork is not explicitly true', async () => {
      const blockedFetcher = new RealMolitRentFetcher({ allowLiveNetwork: false });
      await assert.rejects(
        async () => {
          await blockedFetcher.fetchCell('11110', '202610');
        },
        /\[LIVE_NETWORK_BLOCKED\]/
      );
    });

    it('blocks PrismaRentDbStore writes in dryRun mode or without allowLiveDbWrite', async () => {
      const mockPrisma = {
        apartmentRentHistory: {
          createMany: async () => {
            throw new Error('Should not be called');
          },
        },
      };

      // 1. dryRun: true인 경우 0건 반환하고 DB 쓰기 원천 차단
      const dryStore = new PrismaRentDbStore(mockPrisma, { dryRun: true });
      const persisted = await dryStore.persistCellRows('11110', '202610', [
        {
          groupKeyStr: 'id:1::84::jeonse',
          deposit: 50000,
          monthlyRent: 0,
          dealDate: '2026-10-15',
          floor: 5,
          occurrenceIndex: 0,
        },
      ]);
      assert.equal(persisted, 0);

      // 2. dryRun: false이지만 allowLiveDbWrite가 false인 경우 에러 던짐
      const blockedStore = new PrismaRentDbStore(mockPrisma, { dryRun: false, allowLiveDbWrite: false });
      await assert.rejects(
        async () => {
          await blockedStore.persistCellRows('11110', '202610', [
            {
              groupKeyStr: 'id:1::84::jeonse',
              deposit: 50000,
              monthlyRent: 0,
              dealDate: '2026-10-15',
              floor: 5,
              occurrenceIndex: 0,
            },
          ]);
        },
        /\[DB_WRITE_BLOCKED\]/
      );
    });
  });

  describe('Jongno-gu 1-Month Test Plan', () => {
    it('creates valid plan for Jongno 202610 with circuit breakers and upper bounds', () => {
      const plan = createJongnoTestPlan('202610');
      assert.equal(plan.lawdCd, '11110');
      assert.equal(plan.districtName, '종로구');
      assert.equal(plan.targetDealYmd, '202610');
      assert.equal(plan.expectedNormalCalls, 1); // 종로구는 1페이지로 수집 가능
      assert.equal(plan.upperBoundCalls, 6); // 재시도 최대 5회 포함
      assert.equal(plan.circuitBreakerConditions.maxConsecutiveFailures, 3);
      assert.equal(plan.circuitBreakerConditions.maxUnexpectedItems, 1000);
      assert.equal(plan.circuitBreakerConditions.dryRunForced, true);
    });
  });
});
