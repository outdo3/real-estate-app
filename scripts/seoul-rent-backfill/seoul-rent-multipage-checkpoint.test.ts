import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  SeoulRentBackfillEngine,
  RentFetcher,
  RentDbStore,
  RentFetcherResult,
} from './seoul-rent-backfill-engine';
import { RawMolitRentItem } from '../rent-trade-history/rent-history-logic';
import { RentComparableRow } from '../rent-trade-history/rent-group-guard-logic';
import { classifyRentCellCompleteness, shouldPersistCellRows } from '../rent-trade-history/rent-completeness-logic';

const TEST_TMP_DIR = path.join(process.cwd(), 'tmp', 'test-multipage-checkpoint');
const TEST_CP_PATH = path.join(TEST_TMP_DIR, 'multipage-checkpoint.json');

function cleanup() {
  if (fs.existsSync(TEST_CP_PATH)) {
    try { fs.unlinkSync(TEST_CP_PATH); } catch {}
  }
  if (fs.existsSync(TEST_TMP_DIR)) {
    try {
      const files = fs.readdirSync(TEST_TMP_DIR);
      for (const f of files) fs.unlinkSync(path.join(TEST_TMP_DIR, f));
      fs.rmdirSync(TEST_TMP_DIR);
    } catch {}
  }
}

describe('Seoul Rent Backfill V3.5 — Multipage & Checkpoint Parity Tests', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  describe('Multipage Ingestion Parity (1,001 & 1,800 items)', () => {
    // 1. 1,001건 다중 페이지 수집 및 합계 검증
    it('accurately collects and verifies 1,001 items across 2 pages (1000 + 1)', async () => {
      const itemsPage1: RawMolitRentItem[] = [];
      for (let i = 1; i <= 1000; i++) {
        itemsPage1.push({
          aptSeq: `11680-${i}`,
          aptNm: `대단지${i}`,
          umdNm: '대치동',
          excluUseAr: '84.9',
          deposit: '100,000',
          monthlyRent: '0',
          dealYear: '2026',
          dealMonth: '10',
          dealDay: '15',
          floor: (i % 20) + 1,
        });
      }

      const itemsPage2: RawMolitRentItem[] = [
        {
          aptSeq: '11680-1001',
          aptNm: '대단지1001',
          umdNm: '대치동',
          excluUseAr: '84.9',
          deposit: '100,000',
          monthlyRent: '0',
          dealYear: '2026',
          dealMonth: '10',
          dealDay: '16',
          floor: 5,
        },
      ];

      const allItems = [...itemsPage1, ...itemsPage2];
      assert.equal(allItems.length, 1001);

      const mockMultipageFetcher: RentFetcher = {
        async fetchCell(lawdCd, dealYmd): Promise<RentFetcherResult> {
          return {
            items: allItems,
            totalCount: 1001,
            firstPageFailed: false,
            anyLaterPageFailed: false,
          };
        },
      };

      const engine = new SeoulRentBackfillEngine(
        {
          scope: ['11680'], // 강남구
          fromYmd: '202610',
          toYmd: '202610',
          dryRun: true,
          checkpointPath: TEST_CP_PATH,
          delayMs: 0,
        },
        mockMultipageFetcher
      );

      const summary = await engine.run();
      assert.equal(summary.totalCells, 1);
      assert.equal(summary.completedCells, 1);
      assert.equal(summary.totalCollectedRows, 1001);
      assert.equal(summary.totalPlannedInserts, 1001);
    });

    // 2. 1,800건 다중 페이지 수집 및 송파 대규모 단지 시뮬레이션
    it('accurately collects and verifies 1,800 items across 2 pages (1000 + 800)', async () => {
      const allItems: RawMolitRentItem[] = [];
      for (let i = 1; i <= 1800; i++) {
        allItems.push({
          aptSeq: `11710-${(i % 100) + 1}`,
          aptNm: `송파대단지${(i % 100) + 1}`,
          umdNm: '잠실동',
          excluUseAr: '84.5',
          deposit: '120,000',
          monthlyRent: i % 2 === 0 ? '0' : '100',
          dealYear: '2026',
          dealMonth: '10',
          dealDay: String((i % 28) + 1).padStart(2, '0'),
          floor: (i % 30) + 1,
        });
      }
      assert.equal(allItems.length, 1800);

      const mockFetcher: RentFetcher = {
        async fetchCell(): Promise<RentFetcherResult> {
          return {
            items: allItems,
            totalCount: 1800,
            firstPageFailed: false,
            anyLaterPageFailed: false,
          };
        },
      };

      const engine = new SeoulRentBackfillEngine(
        {
          scope: ['11710'], // 송파구
          fromYmd: '202610',
          toYmd: '202610',
          dryRun: true,
          checkpointPath: TEST_CP_PATH,
          delayMs: 0,
        },
        mockFetcher
      );

      const summary = await engine.run();
      assert.equal(summary.completedCells, 1);
      assert.equal(summary.totalCollectedRows, 1800);
      assert.equal(summary.totalPlannedInserts, 1800);
    });

    // 3. 중간 페이지(2페이지) 실패 시 전체 셀 PARTIAL 격리 및 DB 쓰기 차단 검증
    it('safely isolates cell as PARTIAL and blocks DB write when 2nd page fails', async () => {
      const itemsPage1: RawMolitRentItem[] = [];
      for (let i = 1; i <= 1000; i++) {
        itemsPage1.push({
          aptSeq: `11710-${i}`,
          aptNm: `단지${i}`,
          deposit: '50,000',
          dealYear: '2026',
          dealMonth: '10',
          dealDay: '01',
        });
      }

      // 2페이지 수집 실패: totalCount는 1,500인데 1,000건만 수집되고 anyLaterPageFailed = true
      const partialStatus = classifyRentCellCompleteness({
        firstPageFailed: false,
        totalCount: 1500,
        collectedCount: 1000,
        anyLaterPageFailed: true,
      });

      assert.equal(partialStatus, 'PARTIAL');
      assert.equal(shouldPersistCellRows(partialStatus), false); // DB 쓰기 차단

      let dbWriteCalls = 0;
      const mockDbStore: RentDbStore = {
        async findExistingRows() { return []; },
        async persistCellRows() {
          dbWriteCalls++;
          return 0;
        },
      };

      const mockFailingSecondPageFetcher: RentFetcher = {
        async fetchCell(): Promise<RentFetcherResult> {
          return {
            items: itemsPage1,
            totalCount: 1500,
            firstPageFailed: false,
            anyLaterPageFailed: true,
            errorMessage: 'Page 2 timed out after 5 retries',
          };
        },
      };

      const engine = new SeoulRentBackfillEngine(
        {
          scope: ['11710'],
          fromYmd: '202610',
          toYmd: '202610',
          dryRun: false, // Apply 모드
          checkpointPath: TEST_CP_PATH,
          delayMs: 0,
        },
        mockFailingSecondPageFetcher,
        mockDbStore
      );

      const summary = await engine.run();
      assert.equal(summary.partialCells, 1);
      assert.equal(summary.completedCells, 0);
      assert.equal(summary.totalPersistedRows, 0);
      assert.equal(dbWriteCalls, 0); // 쓰기 0건 차단 확인
    });

    // 4. 동일 거래가 페이지 경계에 걸린 경우 occurrenceIndex 정합성 검증
    it('assigns deterministic occurrenceIndex across page boundaries without duplicate natural key', async () => {
      // 1페이지 마지막 아이템과 2페이지 첫 아이템이 동일 조건(단지, 면적, 거래일, 층, 금액)인 경우
      const boundarySibling1: RawMolitRentItem = {
        aptSeq: '11710-9999',
        aptNm: '경계단지',
        umdNm: '잠실동',
        excluUseAr: '84.0',
        deposit: '80,000',
        monthlyRent: '0',
        dealYear: '2026',
        dealMonth: '10',
        dealDay: '10',
        floor: 15,
      };

      const boundarySibling2: RawMolitRentItem = { ...boundarySibling1 };

      const allItems: RawMolitRentItem[] = [
        ...Array.from({ length: 999 }, (_, i) => ({
          aptSeq: `11710-${i + 1}`,
          aptNm: `일반단지${i + 1}`,
          umdNm: '잠실동',
          excluUseAr: '59.0',
          deposit: '50,000',
          monthlyRent: '0',
          dealYear: '2026',
          dealMonth: '10',
          dealDay: '01',
          floor: 5,
        })),
        boundarySibling1, // 1000번째 (1페이지 끝)
        boundarySibling2, // 1001번째 (2페이지 시작)
      ];

      assert.equal(allItems.length, 1001);

      const mockFetcher: RentFetcher = {
        async fetchCell(): Promise<RentFetcherResult> {
          return {
            items: allItems,
            totalCount: 1001,
            firstPageFailed: false,
            anyLaterPageFailed: false,
          };
        },
      };

      let persistedRows: RentComparableRow[] = [];
      const mockDbStore: RentDbStore = {
        async findExistingRows() { return []; },
        async persistCellRows(_, __, rows) {
          persistedRows = rows;
          return rows.length;
        },
      };

      const engine = new SeoulRentBackfillEngine(
        {
          scope: ['11710'],
          fromYmd: '202610',
          toYmd: '202610',
          dryRun: false,
          checkpointPath: TEST_CP_PATH,
          delayMs: 0,
        },
        mockFetcher,
        mockDbStore
      );

      await engine.run();
      assert.equal(persistedRows.length, 1001);

      // 경계에 걸린 동일 조건 2건의 occurrenceIndex 확인
      const siblings = persistedRows.filter((r) => r.groupKeyStr === 'id:11710-9999::84::jeonse');
      assert.equal(siblings.length, 2);
      assert.equal(siblings[0].occurrenceIndex, 0);
      assert.equal(siblings[1].occurrenceIndex, 1); // 고유 번호 부여 성공
    });
  });

  describe('Checkpoint Transition & Resilience Tests', () => {
    // 5. Dry-run 완료 후 Apply 실행 시 해당 셀이 스킵되지 않고 실제 DB에 적재되는지 검증
    it('does NOT skip cell when transitioning from Dry-run to Apply mode', async () => {
      const items: RawMolitRentItem[] = [
        {
          aptSeq: '11110-1',
          aptNm: '테스트단지',
          umdNm: '청운동',
          excluUseAr: '84.0',
          deposit: '60,000',
          monthlyRent: '0',
          dealYear: '2026',
          dealMonth: '10',
          dealDay: '10',
          floor: 3,
        },
      ];

      const mockFetcher: RentFetcher = {
        async fetchCell(): Promise<RentFetcherResult> {
          return { items, totalCount: 1, firstPageFailed: false, anyLaterPageFailed: false };
        },
      };

      let dbInsertCalls = 0;
      const mockDbStore: RentDbStore = {
        async findExistingRows() { return []; },
        async persistCellRows() {
          dbInsertCalls++;
          return 1;
        },
      };

      // 1단계: Dry-run 실행
      const dryEngine = new SeoulRentBackfillEngine(
        {
          scope: ['11110'],
          fromYmd: '202610',
          toYmd: '202610',
          dryRun: true,
          checkpointPath: TEST_CP_PATH,
          delayMs: 0,
        },
        mockFetcher,
        mockDbStore
      );

      const drySummary = await dryEngine.run();
      assert.equal(drySummary.completedCells, 1);
      assert.equal(drySummary.totalPersistedRows, 0);
      assert.equal(dbInsertCalls, 0); // Dry-run이므로 DB 쓰기 0건

      // 2단계: 동일 Checkpoint를 로드하여 Apply 모드(!dryRun)로 실행
      const applyEngine = new SeoulRentBackfillEngine(
        {
          scope: ['11110'],
          fromYmd: '202610',
          toYmd: '202610',
          dryRun: false, // Apply 모드 전환!
          checkpointPath: TEST_CP_PATH,
          delayMs: 0,
        },
        mockFetcher,
        mockDbStore
      );

      const applySummary = await applyEngine.run();

      // 핵심 결함 해결 검증: Dry-run 체크포인트가 있다고 해서 Apply에서 스킵되면 안 됨!
      assert.equal(applySummary.skippedByCheckpoint, 0); // 스킵되지 않고 실행됨!
      assert.equal(applySummary.totalPersistedRows, 1);
      assert.equal(dbInsertCalls, 1); // 실제로 DB 적재 완료!

      // 3단계: 이미 APPLIED된 상태에서 다시 Apply 모드 재실행 시에는 스킵되어야 함!
      const reapplyEngine = new SeoulRentBackfillEngine(
        {
          scope: ['11110'],
          fromYmd: '202610',
          toYmd: '202610',
          dryRun: false,
          checkpointPath: TEST_CP_PATH,
          delayMs: 0,
        },
        mockFetcher,
        mockDbStore
      );

      const reapplySummary = await reapplyEngine.run();
      assert.equal(reapplySummary.skippedByCheckpoint, 1); // 이제는 정상 스킵!
      assert.equal(dbInsertCalls, 1); // 추가 쓰기 없음
    });

    // 6. 손상된 체크포인트 파일(corrupt JSON) 감지 및 안전 백업·초기화 검증
    it('safely backs up corrupt checkpoint file and initializes fresh state', async () => {
      if (!fs.existsSync(TEST_TMP_DIR)) fs.mkdirSync(TEST_TMP_DIR, { recursive: true });
      // 불완전한 깨진 JSON 기록
      fs.writeFileSync(TEST_CP_PATH, '{"version": 1, "cells": { broken json...', 'utf-8');

      const mockFetcher: RentFetcher = {
        async fetchCell(): Promise<RentFetcherResult> {
          return { items: [], totalCount: 0, firstPageFailed: false, anyLaterPageFailed: false };
        },
      };

      const engine = new SeoulRentBackfillEngine(
        {
          scope: ['11110'],
          fromYmd: '202610',
          toYmd: '202610',
          dryRun: true,
          checkpointPath: TEST_CP_PATH,
          delayMs: 0,
        },
        mockFetcher
      );

      const summary = await engine.run();
      assert.equal(summary.emptyValidCells, 1);

      // 손상 파일 백업 확인
      const files = fs.readdirSync(TEST_TMP_DIR);
      const hasCorruptBackup = files.some((f) => f.includes('corrupt'));
      assert.equal(hasCorruptBackup, true);
    });
  });
});
