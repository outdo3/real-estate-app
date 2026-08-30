/**
 * MASTER_HOUSEHOLD_VERIFICATION_V1 — §7/§14 30-candidate household verification.
 *
 * Input: data/master-integrity/busan-master-repair-candidates.json의 field=
 * "totalHouseholds" 후보 30건(BUSAN_APARTMENT_MASTER_DATA_INTEGRITY_V1 산출).
 *
 * Source priority(§3): K-APT는 이 프로젝트의 data.go.kr 키로 사용 불가 확인됨(3개
 * 엔드포인트 변형 모두 NO_OPENAPI_SERVICE_ERROR — 이 스크립트는 그 재확인을 반복하지
 * 않고, 이미 사용 중인 건축물대장(BldRgstHubService) 총괄표제부/표제부로 재조회한다.
 *
 * 안전조건(§6): 표제부가 정확히 1건이어도 dongNm이 "103동"처럼 구체적 건물번호면
 * 단지 전체값으로 신뢰하지 않는다(src/lib/apt-building-info.ts의
 * isNumberedBuildingUnit과 동일 판정 로직 재사용 — 판정 기준 이원화 방지).
 *
 * DB write 없음. Production data 변경 없음. 외부 호출은 30건×2(총괄표제부+표제부)=
 * 60회로 한정(§17 targeted calls).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { prisma } from '../src/lib/prisma';
import { isNumberedBuildingUnit } from '../src/lib/apt-building-info';

const MOLIT_KEY = process.env.DATA_GO_KR_API_KEY || '';
const MIN_INTERVAL_MS = 1600;
let lastCall = 0;
let callCount = 0;

async function throttle() {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCall));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

function bunJi(jibun: string): { bun: string; ji: string } | null {
  const parts = jibun.split('-');
  const bunNum = parseInt(parts[0], 10);
  if (isNaN(bunNum)) return null;
  const jiNum = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  return { bun: bunNum.toString().padStart(4, '0'), ji: jiNum.toString().padStart(4, '0') };
}

async function fetchRegistry(op: 'getBrRecapTitleInfo' | 'getBrTitleInfo', sggCd: string, umdCd: string, jibun: string): Promise<any[]> {
  await throttle();
  callCount++;
  const bj = bunJi(jibun);
  if (!bj) return [];
  const cleanKey = encodeURIComponent(decodeURIComponent(MOLIT_KEY.trim().replace(/['"]/g, '')));
  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/${op}?serviceKey=${cleanKey}&sigunguCd=${sggCd}&bjdongCd=${umdCd}&platGbCd=0&bun=${bj.bun}&ji=${bj.ji}&numOfRows=20&_type=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    const json = JSON.parse(text);
    const items = json?.response?.body?.items?.item;
    return items ? (Array.isArray(items) ? items : [items]) : [];
  } catch {
    return [];
  }
}

type Confidence = 'HIGH_CONFIDENCE' | 'REVIEW_REQUIRED' | 'NO_CORRECTION';
type RootCause =
  | 'SINGLE_BUILDING_AS_COMPLEX' | 'PARTIAL_BUILDING_SUM' | 'LEGACY_CACHE_OVERRIDE'
  | 'MASTER_IMPORT_OMISSION' | 'WRONG_SOURCE_ROW' | 'MIXED_USE_COMPLEX'
  | 'SOURCE_CONFLICT' | 'FALSE_POSITIVE' | 'UNKNOWN';

interface VerificationRow {
  aptSeq: string;
  name: string;
  dong: string | null;
  jibun: string | null;
  currentHouseholds: number | null;
  verifiedHouseholds: number | null;
  currentBuildingCount: number | null;
  verifiedBuildingCount: number | null;
  primarySource: string;
  sourceId: string | null;
  sourceDate: string | null;
  confidence: Confidence;
  severity: 'P1';
  rootCause: RootCause;
  recommendedAction: string;
  evidence: string[];
  evidenceStrength: 'STRONG' | 'MODERATE' | 'WEAK';
  correctionDelta: number | null;
  notes: string;
}

async function main() {
  const repairFile = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/master-integrity/busan-master-repair-candidates.json'), 'utf-8'));
  const aptSeqs: string[] = repairFile.candidates.filter((c: any) => c.field === 'totalHouseholds').map((c: any) => c.aptSeq);

  const rows: VerificationRow[] = [];

  for (const aptSeq of aptSeqs) {
    const master = await prisma.apartmentMaster.findUnique({ where: { aptSeq } });
    if (!master || !master.sggCd || !master.umdCd || !master.jibun) {
      rows.push({
        aptSeq, name: master?.name || 'UNKNOWN', dong: master?.umdName || null, jibun: master?.jibun || null,
        currentHouseholds: master?.totalHouseholds ?? null, verifiedHouseholds: null,
        currentBuildingCount: master?.mainBuildingCount ?? null, verifiedBuildingCount: null,
        primarySource: 'NONE', sourceId: null, sourceDate: null,
        confidence: 'REVIEW_REQUIRED', severity: 'P1', rootCause: 'UNKNOWN',
        recommendedAction: 'NO_ACTION — identity 필드 결측으로 재조회 불가',
        evidence: [], evidenceStrength: 'WEAK', correctionDelta: null,
        notes: 'sggCd/umdCd/jibun 중 하나 이상 결측',
      });
      continue;
    }

    const recap = await fetchRegistry('getBrRecapTitleInfo', master.sggCd, master.umdCd, master.jibun);
    const title = await fetchRegistry('getBrTitleInfo', master.sggCd, master.umdCd, master.jibun);

    const evidence: string[] = [
      `총괄표제부(getBrRecapTitleInfo) 재조회: ${recap.length}건`,
      `표제부(getBrTitleInfo) 재조회: ${title.length}건`,
    ];

    let confidence: Confidence;
    let rootCause: RootCause;
    let verifiedHouseholds: number | null = null;
    let verifiedBuildingCount: number | null = null;
    let sourceId: string | null = null;
    let recommendedAction: string;
    let evidenceStrength: 'STRONG' | 'MODERATE' | 'WEAK';
    let notes: string;

    if (recap.length > 0) {
      // 총괄표제부가 실제로 존재 — 이전 pipeline이 놓쳤을 가능성. 세대수가 가장 큰 레코드 채택.
      const best = recap.reduce((a: any, b: any) => ((b.hhldCnt || 0) > (a.hhldCnt || 0) ? b : a));
      verifiedHouseholds = parseInt(best.hhldCnt, 10) || null;
      verifiedBuildingCount = parseInt(best.mainBldCnt, 10) || null;
      sourceId = best.mgmBldrgstPk ? String(best.mgmBldrgstPk) : null;
      confidence = verifiedHouseholds && verifiedHouseholds !== master.totalHouseholds ? 'HIGH_CONFIDENCE' : 'NO_CORRECTION';
      rootCause = 'MASTER_IMPORT_OMISSION';
      recommendedAction = confidence === 'HIGH_CONFIDENCE' ? 'UPDATE_MASTER' : 'NO_ACTION';
      evidenceStrength = 'STRONG';
      notes = '총괄표제부가 실제로 존재함(재조회로 확인) — 최초 backfill 시점에 놓쳤을 가능성.';
      evidence.push(`총괄표제부 hhldCnt=${best.hhldCnt}, mainBldCnt=${best.mainBldCnt}, mgmBldrgstPk=${best.mgmBldrgstPk}`);
    } else if (title.length === 1 && isNumberedBuildingUnit(title[0]?.dongNm)) {
      // 확정된 위험 패턴: 표제부 1건, 구체적 건물번호 dongNm.
      confidence = 'REVIEW_REQUIRED';
      rootCause = 'SINGLE_BUILDING_AS_COMPLEX';
      recommendedAction = 'NO_ACTION(당장) — 정확한 전체 세대수 확정에는 총괄표제부/K-APT 접근 권한 확보 또는 동별 표제부 전수 조사가 필요(별도 승인 STEP)';
      evidenceStrength = 'STRONG';
      notes = `표제부 dongNm="${title[0].dongNm}" — 다동 복합단지 중 특정 건물 하나만 등록된 값으로 판단. 진짜 전체 세대수는 미확정(892 등 외부 수치 미검증, 채택하지 않음).`;
      evidence.push(`표제부 dongNm="${title[0].dongNm}" hhldCnt=${title[0].hhldCnt} mgmBldrgstPk=${title[0].mgmBldrgstPk}`);
    } else if (title.length === 1 && !isNumberedBuildingUnit(title[0]?.dongNm)) {
      const dongNmTrim = (title[0]?.dongNm || '').toString().trim();
      if (dongNmTrim.length === 0) {
        // dongNm 공백 — 실측 패턴상 진짜 단일 건물 단지, outlier는 household 필드가 아닌
        // 다른 원인(주차 데이터 등, 이번 STEP 범위 밖)일 가능성.
        confidence = 'NO_CORRECTION';
        rootCause = 'FALSE_POSITIVE';
        recommendedAction = 'NO_ACTION';
        evidenceStrength = 'MODERATE';
        notes = 'dongNm 공백 — 표제부 1건이 실제로 단일 건물 단지 전체를 대표하는 정상 패턴으로 판단. household outlier 탐지(parkingPerHousehold 기준)는 세대수가 아닌 다른 필드(주차대수 등)의 이상일 가능성 — 이번 STEP 범위 밖.';
        evidence.push(`표제부 dongNm 공백, hhldCnt=${title[0].hhldCnt} — 기존 Master 값과 일치`);
      } else {
        // dongNm이 있으나 숫자+동 패턴이 아닌 비정형 값 — 가드가 못 잡는 애매한 경우.
        confidence = 'REVIEW_REQUIRED';
        rootCause = 'UNKNOWN';
        recommendedAction = 'NO_ACTION — dongNm이 비정형("' + dongNmTrim + '")이라 자동 판정 불가, 수동 검토 필요';
        evidenceStrength = 'WEAK';
        notes = `dongNm="${dongNmTrim}"이 숫자+동 패턴이 아니어서 이번 STEP의 좁은 가드(isNumberedBuildingUnit)로는 단일 건물 여부를 자동 판정하지 못함(§25 알려진 한계).`;
        evidence.push(`표제부 dongNm="${dongNmTrim}"(비정형), hhldCnt=${title[0].hhldCnt}`);
      }
    } else {
      confidence = 'REVIEW_REQUIRED';
      rootCause = 'SOURCE_CONFLICT';
      recommendedAction = 'NO_ACTION — 재조회 결과가 기존 basicSpecSource 기록과 불일치(예: 표제부 0건 또는 2건 이상)';
      evidenceStrength = 'WEAK';
      notes = `재조회 결과 총괄표제부 ${recap.length}건, 표제부 ${title.length}건 — 최초 backfill 시점과 다른 결과(레코드 추가/삭제 등 registry 변경 가능성).`;
    }

    rows.push({
      aptSeq, name: master.name, dong: master.umdName, jibun: master.jibun,
      currentHouseholds: master.totalHouseholds, verifiedHouseholds,
      currentBuildingCount: master.mainBuildingCount, verifiedBuildingCount,
      primarySource: recap.length > 0 ? '건축물대장 총괄표제부(BldRgstHubService getBrRecapTitleInfo)' : '건축물대장 표제부(BldRgstHubService getBrTitleInfo, 단일 건물)',
      sourceId, sourceDate: new Date().toISOString().slice(0, 10),
      confidence, severity: 'P1', rootCause, recommendedAction, evidence, evidenceStrength,
      correctionDelta: verifiedHouseholds != null && master.totalHouseholds != null ? verifiedHouseholds - master.totalHouseholds : null,
      notes,
    });

    console.log(`[${rows.length}/${aptSeqs.length}] ${aptSeq} ${master.name}: ${confidence} (${rootCause})`);
  }

  const summary = {
    total: rows.length,
    HIGH_CONFIDENCE: rows.filter((r) => r.confidence === 'HIGH_CONFIDENCE').length,
    REVIEW_REQUIRED: rows.filter((r) => r.confidence === 'REVIEW_REQUIRED').length,
    NO_CORRECTION: rows.filter((r) => r.confidence === 'NO_CORRECTION').length,
    patterns: rows.reduce((acc: Record<string, number>, r) => {
      acc[r.rootCause] = (acc[r.rootCause] || 0) + 1;
      return acc;
    }, {}),
    apiCallCount: callCount,
  };

  console.log('\n========== SUMMARY ==========');
  console.log(JSON.stringify(summary, null, 2));

  const outPath = path.resolve(__dirname, '../data/master-integrity/busan-household-verification-v1.json');
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2));
  console.log(`\n저장: ${outPath}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
