import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  SeoulRentBackfillEngine,
  generateMonthList,
  normalizeRawMolitRentItems,
  RentFetcher,
  RentDbStore,
  RentFetcherResult,
  SEOUL_DISTRICT_NAMES,
} from './seoul-rent-backfill-engine';
import { RawMolitRentItem } from '../rent-trade-history/rent-history-logic';
import { RentComparableRow } from '../rent-trade-history/rent-group-guard-logic';

const TEST_TMP_DIR = path.join(process.cwd(), 'tmp', 'test-rent-backfill');
const TEST_CP_PATH = path.join(TEST_TMP_DIR, 'test-checkpoint.json');

function cleanupTestDir() {
  if (fs.existsSync(TEST_CP_PATH)) {
    try {
      fs.unlinkSync(TEST_CP_PATH);
    } catch {}
  }
  if (fs.existsSync(TEST_TMP_DIR)) {
    try {
      fs.rmdirSync(TEST_TMP_DIR);
    } catch {}
  }
}

describe('SeoulRentBackfillEngine Unit & Isolation Tests', () => {
  beforeEach(() => {
    cleanupTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  describe('generateMonthList', () => {
    it('generates correct monthly sequences including year rollover', () => {
      const list = generateMonthList('202411', '202502');
      assert.deepEqual(list, ['202411', '202412', '202501', '202502']);
    });

    it('generates single month when from == to', () => {
      const list = generateMonthList('202505', '202505');
      assert.deepEqual(list, ['202505']);
    });
  });

  describe('Shard & District Resolution', () => {
    it('resolves correct district counts for seoul-a, seoul-b, seoul-c, and seoul-all', () => {
      const dummyFetcher: RentFetcher = {
        fetchCell: async () => ({
          firstPageFailed: false,
          anyLaterPageFailed: false,
          totalCount: 0,
          items: [],
        }),
      };

      const engineA = new SeoulRentBackfillEngine({ scope: 'seoul-a', fromYmd: '202501', toYmd: '202501' }, dummyFetcher);
      assert.equal(engineA.resolveTargetLawdCodes().length, 8); // 종로, 중구, 용산, 광진, 동대문, 서대문, 마포, 금천

      const engineB = new SeoulRentBackfillEngine({ scope: 'seoul-b', fromYmd: '202501', toYmd: '202501' }, dummyFetcher);
      assert.equal(engineB.resolveTargetLawdCodes().length, 9); // 성동, 중랑, 성북, 강북, 도봉, 노원, 은평, 양천, 강서

      const engineC = new SeoulRentBackfillEngine({ scope: 'seoul-c', fromYmd: '202501', toYmd: '202501' }, dummyFetcher);
      assert.equal(engineC.resolveTargetLawdCodes().length, 8); // 구로, 영등포, 동작, 관악, 서초, 강남, 송파, 강동

      const engineAll = new SeoulRentBackfillEngine({ scope: 'seoul-all', fromYmd: '202501', toYmd: '202501' }, dummyFetcher);
      assert.equal(engineAll.resolveTargetLawdCodes().length, 25);
    });
  });

  describe('normalizeRawMolitRentItems', () => {
    it('normalizes raw MOLIT XML items and assigns deterministic occurrence indexes', () => {
      const rawItems: RawMolitRentItem[] = [
        {
          aptSeq: '11110-101',
          aptNm: '종로아파트',
          umdNm: '청운동',
          jibun: '10',
          excluUseAr: '84.95',
          floor: '5',
          buildYear: '2015',
          dealYear: '2025',
          dealMonth: '1',
          dealDay: '15',
          deposit: '60,000',
          monthlyRent: '0', // 전세
        },
        {
          aptSeq: '11110-101',
          aptNm: '종로아파트',
          umdNm: '청운동',
          jibun: '10',
          excluUseAr: '84.95',
          floor: '5',
          buildYear: '2015',
          dealYear: '2025',
          dealMonth: '1',
          dealDay: '15',
          deposit: '60,000',
          monthlyRent: '0', // 동일 조건 2번째 전세 -> occurrenceIndex 1
        },
        {
          // aptSeq 누락 아이템 (MISSING_APTSEQ) -> 제외되어야 함
          aptNm: '무명아파트',
          umdNm: '청운동',
          deposit: '50,000',
        },
      ];

      const normalized = normalizeRawMolitRentItems(rawItems, '11110', '202501');
      // aptSeq 없는 아이템 1건 제외되어 2건만 남아야 함
      assert.equal(normalized.length, 2);

      // 동일 조건 2건에 대해 occurrenceIndex가 0과 1로 결정론적 부여
      assert.equal(normalized[0].occurrenceIndex, 0);
      assert.equal(normalized[1].occurrenceIndex, 1);
      assert.equal(normalized[0].deposit, 60000);
      assert.equal(normalized[0].monthlyRent, 0);
      assert.equal(normalized[0].dealDate, '2025-01-15');
    });
  });

  describe('Engine Execution with Mock Fetcher & Store', () => {
    it('executes dry-run without writing to DB and generates accurate plan', async () => {
      let dbPersistCallCount = 0;

      const mockFetcher: RentFetcher = {
        async fetchCell(lawdCd: string, dealYmd: string): Promise<RentFetcherResult> {
          return {
            firstPageFailed: false,
            anyLaterPageFailed: false,
            totalCount: 2,
            items: [
              {
                aptSeq: `${lawdCd}-1`,
                aptNm: '테스트단지',
                umdNm: '테스트동',
                excluUseAr: '84.5',
                floor: '3',
                dealYear: dealYmd.slice(0, 4),
                dealMonth: dealYmd.slice(4, 6),
                dealDay: '10',
                deposit: '50,000',
                monthlyRent: '0',
              },
              {
                aptSeq: `${lawdCd}-1`,
                aptNm: '테스트단지',
                umdNm: '테스트동',
                excluUseAr: '84.5',
                floor: '4',
                dealYear: dealYmd.slice(0, 4),
                dealMonth: dealYmd.slice(4, 6),
                dealDay: '12',
                deposit: '30,000',
                monthlyRent: '100', // 월세
              },
            ],
          };
        },
      };

      const mockDbStore: RentDbStore = {
        async findExistingRows() {
          return []; // 기존 데이터 없음
        },
        async persistCellRows() {
          dbPersistCallCount++;
          return 2;
        },
      };

      const engine = new SeoulRentBackfillEngine(
        {
          scope: ['11110'], // 종로구 1개 구만 테스트
          fromYmd: '202501',
          toYmd: '202501',
          dryRun: true, // DB 쓰기 차단
          checkpointPath: TEST_CP_PATH,
          delayMs: 0,
        },
        mockFetcher,
        mockDbStore
      );

      const summary = await engine.run();

      assert.equal(summary.totalCells, 1);
      assert.equal(summary.executedCells, 1);
      assert.equal(summary.completedCells, 1);
      assert.equal(summary.totalCollectedRows, 2);
      assert.equal(summary.totalPlannedInserts, 2);
      // dryRun이므로 실제 DB 저장은 0건이어야 함
      assert.equal(summary.totalPersistedRows, 0);
      assert.equal(dbPersistCallCount, 0);
      assert.equal(summary.dryRun, true);
    });

    it('resumes from checkpoint skipping already completed cells', async () => {
      let fetchCallCount = 0;

      const mockFetcher: RentFetcher = {
        async fetchCell(lawdCd: string, dealYmd: string): Promise<RentFetcherResult> {
          fetchCallCount++;
          return {
            firstPageFailed: false,
            anyLaterPageFailed: false,
            totalCount: 1,
            items: [
              {
                aptSeq: `${lawdCd}-1`,
                aptNm: '체크포인트단지',
                umdNm: '동',
                excluUseAr: '59.9',
                floor: '2',
                dealYear: dealYmd.slice(0, 4),
                dealMonth: dealYmd.slice(4, 6),
                dealDay: '05',
                deposit: '40,000',
                monthlyRent: '0',
              },
            ],
          };
        },
      };

      const options = {
        scope: ['11110'],
        fromYmd: '202501',
        toYmd: '202501',
        dryRun: true,
        checkpointPath: TEST_CP_PATH,
        delayMs: 0,
      };

      // 1회차 실행: API 1회 호출 후 체크포인트 저장
      const engine1 = new SeoulRentBackfillEngine(options, mockFetcher);
      const summary1 = await engine1.run();
      assert.equal(summary1.executedCells, 1);
      assert.equal(summary1.skippedByCheckpoint, 0);
      assert.equal(fetchCallCount, 1);

      // 2회차 실행: 동일 옵션으로 재실행 시 checkpoint에 의해 건너뛰어야 함
      const engine2 = new SeoulRentBackfillEngine(options, mockFetcher);
      const summary2 = await engine2.run();
      assert.equal(summary2.skippedByCheckpoint, 1);
      assert.equal(summary2.executedCells, 0);
      assert.equal(fetchCallCount, 1); // 추가 호출 없음!
    });

    it('safely isolates incomplete/failed cells and never persists them', async () => {
      const mockFailingFetcher: RentFetcher = {
        async fetchCell(): Promise<RentFetcherResult> {
          return {
            firstPageFailed: true, // 첫 페이지 실패
            anyLaterPageFailed: false,
            totalCount: null,
            items: [],
            errorMessage: 'MOLIT Gateway Timeout 504',
          };
        },
      };

      let persistCalls = 0;
      const mockDbStore: RentDbStore = {
        async findExistingRows() {
          return [];
        },
        async persistCellRows() {
          persistCalls++;
          return 0;
        },
      };

      const engine = new SeoulRentBackfillEngine(
        {
          scope: ['11110'],
          fromYmd: '202501',
          toYmd: '202501',
          dryRun: false, // apply 모드여도
          checkpointPath: TEST_CP_PATH,
          delayMs: 0,
        },
        mockFailingFetcher,
        mockDbStore
      );

      const summary = await engine.run();
      assert.equal(summary.invalidCells, 1);
      assert.equal(summary.completedCells, 0);
      assert.equal(summary.totalPersistedRows, 0);
      assert.equal(persistCalls, 0); // 실패한 셀은 절대 DB 쓰기 시도 안 함
    });

    it('prevents duplicates when matching rows exist in DB', async () => {
      const mockFetcher: RentFetcher = {
        async fetchCell(lawdCd: string, dealYmd: string): Promise<RentFetcherResult> {
          return {
            firstPageFailed: false,
            anyLaterPageFailed: false,
            totalCount: 1,
            items: [
              {
                aptSeq: '11110-dup',
                aptNm: '중복단지',
                umdNm: '동',
                excluUseAr: '84.0',
                floor: '10',
                dealYear: dealYmd.slice(0, 4),
                dealMonth: dealYmd.slice(4, 6),
                dealDay: '01',
                deposit: '70,000',
                monthlyRent: '0',
              },
            ],
          };
        },
      };

      // 정규화된 키와 정확히 일치하는 기존 행을 mock DB에 설정
      const mockDbStore: RentDbStore = {
        async findExistingRows() {
          return [
            {
              groupKeyStr: 'id:11110-dup::84::jeonse',
              deposit: 70000,
              monthlyRent: 0,
              dealDate: '2025-01-01',
              floor: 10,
              occurrenceIndex: 0,
              aptName: '중복단지',
              dong: '동',
              jibun: null,
              buildYear: null,
              contractType: null,
              contractTerm: null,
              preDeposit: null,
              preMonthlyRent: null,
              useRenewalRight: null,
            },
          ];
        },
        async persistCellRows() {
          return 0;
        },
      };

      const engine = new SeoulRentBackfillEngine(
        {
          scope: ['11110'],
          fromYmd: '202501',
          toYmd: '202501',
          dryRun: true,
          checkpointPath: TEST_CP_PATH,
          delayMs: 0,
        },
        mockFetcher,
        mockDbStore
      );

      const summary = await engine.run();
      assert.equal(summary.completedCells, 1);
      assert.equal(summary.totalCollectedRows, 1);
      assert.equal(summary.totalUnchangedRows, 1); // 1건 완전 일치
      assert.equal(summary.totalPlannedInserts, 0); // 신규 INSERT 0건 (중복 방지 성공)
    });
  });
});
