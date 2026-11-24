import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  evaluateDbEnvironment,
  RENT_SCHEMA_INVARIANTS,
} from './seoul-rent-isolated-db-check';
import {
  planRentCellWrites,
  RentComparableRow,
} from '../rent-trade-history/rent-group-guard-logic';

describe('Seoul Rent Isolated DB & Guard Parity Tests (V3.3)', () => {
  describe('evaluateDbEnvironment Safety Guards', () => {
    it('strictly blocks operational Supabase database URLs', () => {
      const prodUrl = 'postgresql://postgres.xxx:yyy@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';
      const result = evaluateDbEnvironment(prodUrl);

      assert.equal(result.hasIsolatedDb, false);
      assert.equal(result.isOperationalHost, true);
      assert.equal(result.canExecuteWrite, false);
      assert.equal(result.status, 'BLOCKED_OPERATIONAL_DB');
      assert.match(result.reason, /Detected production Supabase host/);
    });

    it('allows verified local PostgreSQL instances', () => {
      const localUrl = 'postgresql://test_user:test_pass@localhost:5432/test_real_estate';
      const result = evaluateDbEnvironment(localUrl);

      assert.equal(result.hasIsolatedDb, true);
      assert.equal(result.isOperationalHost, false);
      assert.equal(result.canExecuteWrite, true);
      assert.equal(result.status, 'READY');
    });

    it('blocks undefined or missing database URLs', () => {
      const result = evaluateDbEnvironment(undefined);
      assert.equal(result.hasIsolatedDb, false);
      assert.equal(result.canExecuteWrite, false);
      assert.equal(result.status, 'BLOCKED_NO_ISOLATED_DB');
    });
  });

  describe('ApartmentRentHistory Schema Invariants', () => {
    it('verifies exact natural key fields and table invariants', () => {
      assert.equal(RENT_SCHEMA_INVARIANTS.modelName, 'ApartmentRentHistory');
      assert.equal(RENT_SCHEMA_INVARIANTS.naturalKeyConstraintName, 'rent_natural_key');
      assert.deepEqual(RENT_SCHEMA_INVARIANTS.naturalKeyFields, [
        'groupKeyStr',
        'deposit',
        'monthlyRent',
        'dealDate',
        'floor',
        'occurrenceIndex',
      ]);
    });
  });

  describe('Option E Group Guard & Occurrence Parity on 140-item Dataset', () => {
    // 종로구 140건 특성(전세 55건, 월세 85건, 6건 동일 조건 복수 거래)을 정확히 모사한 140건 데이터셋 생성
    function generateJongno140Dataset(): RentComparableRow[] {
      const rows: RentComparableRow[] = [];

      // 1. 전세 55건 생성
      for (let i = 1; i <= 55; i++) {
        // 55건 중 2건은 동일 조건 복수 세대 (동일 단지, 동일 날짜, 동일 보증금, 동일 층)
        const isDuplicateSibling = i === 2;
        const aptSeq = isDuplicateSibling ? '11110-1' : `11110-${i}`;
        const floor = isDuplicateSibling ? 5 : (i % 15) + 1;
        const occurrenceIndex = isDuplicateSibling ? 1 : 0;

        rows.push({
          groupKeyStr: `id:${aptSeq}::84.5::jeonse`,
          deposit: 60000,
          monthlyRent: 0,
          dealDate: '2026-10-15',
          floor,
          occurrenceIndex,
          aptName: `단지${aptSeq}`,
          dong: '청운동',
          jibun: '100',
          buildYear: 2018,
          contractType: '신규',
          contractTerm: '26.10~28.10',
          preDeposit: null,
          preMonthlyRent: null,
          useRenewalRight: null,
        });
      }

      // 2. 월세 85건 생성
      for (let j = 1; j <= 85; j++) {
        // 85건 중 4건은 동일 조건 복수 세대
        const isDuplicateSibling = j === 2 || j === 3;
        const aptSeq = isDuplicateSibling ? '11110-100' : `11110-w-${j}`;
        const floor = isDuplicateSibling ? 8 : (j % 18) + 1;
        const occurrenceIndex = j === 2 ? 1 : j === 3 ? 2 : 0;

        rows.push({
          groupKeyStr: `id:${aptSeq}::59.9::wolse`,
          deposit: 30000,
          monthlyRent: 120,
          dealDate: '2026-10-20',
          floor,
          occurrenceIndex,
          aptName: `단지${aptSeq}`,
          dong: '효자동',
          jibun: '200',
          buildYear: 2020,
          contractType: '신규',
          contractTerm: '26.10~28.10',
          preDeposit: null,
          preMonthlyRent: null,
          useRenewalRight: null,
        });
      }

      return rows;
    }

    it('plans exactly 140 inserts on clean empty database', () => {
      const sourceRows = generateJongno140Dataset();
      assert.equal(sourceRows.length, 140);

      const existingRows: RentComparableRow[] = [];
      const plan = planRentCellWrites(sourceRows, existingRows);

      assert.equal(plan.inserts.length, 140);
      assert.equal(plan.skippedInserts.length, 0);
      assert.equal(plan.guardedGroups.length, 0);
      assert.equal(plan.unchanged, 0);
      assert.equal(plan.reviewDiffs.length, 0);
    });

    it('prevents any duplicates when re-running with identical 140 rows', () => {
      const sourceRows = generateJongno140Dataset();
      const existingRows = [...sourceRows]; // DB에 이미 140건이 정확히 적재되어 있는 상태

      const plan = planRentCellWrites(sourceRows, existingRows);

      // 재실행 시 신규 INSERT 0건, 완전 일치 140건 확인 (중복 증가 0건)
      assert.equal(plan.inserts.length, 0);
      assert.equal(plan.skippedInserts.length, 0);
      assert.equal(plan.unchanged, 140);
      assert.equal(plan.reviewDiffs.length, 0);
    });

    it('safely guards group and skips duplicate insert when a field differs (Option E Guard)', () => {
      const sourceRows = generateJongno140Dataset();
      // DB의 1개 행(첫 번째 행)의 contractTerm이 다르게 저장되어 있는 불일치 상황 가정
      const existingRows = sourceRows.map((r, idx) => {
        if (idx === 0) {
          return {
            ...r,
            contractTerm: '26.10~27.10', // 원천은 '26.10~28.10'
          };
        }
        return { ...r };
      });

      const plan = planRentCellWrites(sourceRows, existingRows);

      // 1건 diff 발생
      assert.equal(plan.reviewDiffs.length, 1);
      assert.equal(plan.reviewCandidateFieldCount, 1);
      // 해당 그룹 전체가 guarded 처리됨
      assert.equal(plan.guardedGroups.length, 1);
      // 나머지 139건은 정상 unchanged
      assert.equal(plan.unchanged, 139);
      // 신규 INSERT 0건 (오염된 데이터 복제 방지)
      assert.equal(plan.inserts.length, 0);
    });
  });
});
