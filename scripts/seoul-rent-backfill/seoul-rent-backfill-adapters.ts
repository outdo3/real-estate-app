/**
 * E-JIP 서울 25개 구 전월세 백필 실제 어댑터 및 안전 가드
 *
 * 실제 외부 MOLIT API 호출(`fetchRentRegionMonth`)과 실제 Prisma DB 접근을
 * 백필 엔진 인터페이스(RentFetcher, RentDbStore)에 연결합니다.
 *
 * 안전 핵심 불변식:
 * 1. LIVE_NETWORK_BLOCKED — 명시적 승인(allowLiveNetwork: true) 없이는 실제 MOLIT 호출 원천 차단
 * 2. DB_WRITE_BLOCKED — 명시적 승인(allowLiveDbWrite: true 및 dryRun: false) 없이는 실제 DB 쓰기 원천 차단
 * 3. READ-ONLY DB ACCESS — 기존 데이터 조사는 승인 하에 가능하나 쓰기는 이중 잠금
 */

import { RentFetcher, RentFetcherResult, RentDbStore } from './seoul-rent-backfill-engine';
import { fetchRentRegionMonth } from '../rent-trade-history/rent-molit-fetch';
import { RentComparableRow } from '../rent-trade-history/rent-group-guard-logic';

export interface RealMolitRentFetcherOptions {
  allowLiveNetwork?: boolean;
}

/**
 * 실제 국토교통부(MOLIT) RTMSDataSvcAptRent API 어댑터
 */
export class RealMolitRentFetcher implements RentFetcher {
  private allowLiveNetwork: boolean;

  constructor(options: RealMolitRentFetcherOptions = {}) {
    this.allowLiveNetwork = options.allowLiveNetwork ?? false;
  }

  public async fetchCell(lawdCd: string, dealYmd: string): Promise<RentFetcherResult> {
    if (!this.allowLiveNetwork) {
      throw new Error(
        `[LIVE_NETWORK_BLOCKED] Real MOLIT API call blocked for cell ${lawdCd}:${dealYmd}. ` +
          `Explicit user approval required (allowLiveNetwork: true).`
      );
    }

    try {
      const res = await fetchRentRegionMonth(lawdCd, dealYmd);
      return {
        items: res.items,
        totalCount: res.totalCount,
        firstPageFailed: res.status === 'INVALID' && res.totalCount === null,
        anyLaterPageFailed: res.status === 'PARTIAL',
      };
    } catch (err: any) {
      return {
        items: [],
        totalCount: null,
        firstPageFailed: true,
        anyLaterPageFailed: false,
        errorMessage: err?.message || String(err),
      };
    }
  }
}

export interface PrismaRentDbStoreOptions {
  allowLiveDbWrite?: boolean;
  dryRun?: boolean;
}

/**
 * 실제 Prisma ORM 연동 전월세 DB 스토어 어댑터
 */
export class PrismaRentDbStore implements RentDbStore {
  private prisma: any;
  private allowLiveDbWrite: boolean;
  private dryRun: boolean;

  constructor(prismaClient: any, options: PrismaRentDbStoreOptions = {}) {
    this.prisma = prismaClient;
    this.allowLiveDbWrite = options.allowLiveDbWrite ?? false;
    this.dryRun = options.dryRun ?? true;
  }

  /**
   * 해당 셀(lawdCd + dealYmd)의 기존 전월세 레코드 조회 (안전한 읽기 경로)
   */
  public async findExistingRows(lawdCd: string, dealYmd: string): Promise<RentComparableRow[]> {
    if (!this.prisma?.apartmentRentHistory) {
      return [];
    }

    const rows = await this.prisma.apartmentRentHistory.findMany({
      where: {
        lawdCd,
        dealYmd,
      },
      select: {
        groupKeyStr: true,
        deposit: true,
        monthlyRent: true,
        dealDate: true,
        floor: true,
        occurrenceIndex: true,
        aptName: true,
        dong: true,
        jibun: true,
        buildYear: true,
        contractType: true,
        contractTerm: true,
        preDeposit: true,
        preMonthlyRent: true,
        useRenewalRight: true,
      },
    });

    return rows.map((r: any) => ({
      groupKeyStr: r.groupKeyStr,
      deposit: r.deposit,
      monthlyRent: r.monthlyRent,
      dealDate: typeof r.dealDate === 'string' ? r.dealDate : r.dealDate.toISOString().slice(0, 10),
      floor: r.floor,
      occurrenceIndex: r.occurrenceIndex,
      aptName: r.aptName,
      dong: r.dong,
      jibun: r.jibun,
      buildYear: r.buildYear,
      contractType: r.contractType,
      contractTerm: r.contractTerm,
      preDeposit: r.preDeposit,
      preMonthlyRent: r.preMonthlyRent,
      useRenewalRight: r.useRenewalRight,
    }));
  }

  /**
   * 신규 전월세 행 일괄 삽입 (엄격한 이중 잠금 가드)
   */
  public async persistCellRows(
    lawdCd: string,
    dealYmd: string,
    rows: RentComparableRow[]
  ): Promise<number> {
    if (this.dryRun) {
      return 0;
    }

    if (!this.allowLiveDbWrite) {
      throw new Error(
        `[DB_WRITE_BLOCKED] Real DB write blocked for cell ${lawdCd}:${dealYmd} (${rows.length} rows). ` +
          `Explicit user approval required (allowLiveDbWrite: true).`
      );
    }

    if (!this.prisma?.apartmentRentHistory || rows.length === 0) {
      return 0;
    }

    const res = await this.prisma.apartmentRentHistory.createMany({
      data: rows.map((r) => ({
        ...r,
        lawdCd,
        dealYmd,
      })),
      skipDuplicates: true,
    });

    return res.count;
  }
}

/**
 * 서울 종로구(11110) 1개월 시험 실행 계획 명세
 */
export interface JongnoSingleMonthTestPlan {
  lawdCd: '11110';
  districtName: '종로구';
  targetDealYmd: string; // '202610' (최근 완료 월)
  expectedNormalCalls: number; // 1회 (종로구 평균 80~150건 < 1000건)
  upperBoundCalls: number; // 6회 (1회 + 최대 재시도 5회)
  circuitBreakerConditions: {
    maxConsecutiveFailures: number; // 3회 실패 시 즉시 중단
    maxUnexpectedItems: number; // 1,000건 초과 시 중단 (종로구 이상 징후 감지)
    dryRunForced: boolean; // 시험 전 기본 true 강제
  };
}

/**
 * 2026년 11월 기준 최근 완료 월(202610)에 대한 종로구 시험 계획 생성기
 */
export function createJongnoTestPlan(targetDealYmd = '202610'): JongnoSingleMonthTestPlan {
  return {
    lawdCd: '11110',
    districtName: '종로구',
    targetDealYmd,
    expectedNormalCalls: 1,
    upperBoundCalls: 6,
    circuitBreakerConditions: {
      maxConsecutiveFailures: 3,
      maxUnexpectedItems: 1000,
      dryRunForced: true,
    },
  };
}
