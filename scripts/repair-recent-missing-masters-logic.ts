// MASTER_MISSING_REPAIR_V1 — 순수 함수만 모아둔 파일(DB/네트워크 호출 없음, 단위
// 테스트 전용). scripts/repair-recent-missing-masters.ts가 이 로직을 그대로 재사용한다.
import { normalizeSearchKeyword } from '../src/lib/search-ranking';

// 이미 프로젝트 내 여러 스크립트(scripts/apartment-score/lib/shadow-score.ts 등)가
// 쓰는 것과 동일한 부산 16개 구·군 매핑 — 새로 만들지 않고 값만 그대로 재사용.
export const BUSAN_GU_BY_LAWDCD: Record<string, string> = {
  '26110': '중구', '26140': '서구', '26170': '동구', '26200': '영도구',
  '26230': '부산진구', '26260': '동래구', '26290': '남구', '26320': '북구',
  '26350': '해운대구', '26380': '사하구', '26410': '금정구', '26440': '강서구',
  '26470': '연제구', '26500': '수영구', '26530': '사상구', '26710': '기장군',
};

export interface RepairCandidate {
  aptSeq: string;
  canonicalName: string;
  lawdCd: string;
  dong: string;
  jibun: string;
  buildYear: number | null;
  masterCreateReadiness: string;
}

export interface MasterRowData {
  aptSeq: string;
  name: string;
  normalizedName: string;
  sido: string;
  sigungu: string | null;
  sggCd: string;
  umdName: string;
  jibun: string;
  buildYear: number | null;
}

export type PlanAction = 'INSERT' | 'SKIP_DUPLICATE' | 'REJECT_MISSING_FIELD' | 'SKIP_NOT_READY';

export interface RowPlan {
  aptSeq: string;
  action: PlanAction;
  data: MasterRowData | null;
  reason: string;
}

// §4 MINIMUM MASTER CREATION CONTRACT — identity에 필요한 최소 필드만. secondary
// metadata(totalHouseholds/좌표/parking/FAR·BCR/approvalDate 등)는 공식 근거가 없으므로
// 전부 의도적으로 채우지 않는다(Prisma 스키마 기본값 null에 맡김 — 이 함수가 만드는
// data 객체 자체에 그 필드들을 아예 넣지 않는다).
export function buildMasterRowPlan(candidate: RepairCandidate, existingAptSeqs: Set<string>): RowPlan {
  const { aptSeq } = candidate;

  if (candidate.masterCreateReadiness !== 'READY_FOR_MASTER_CREATE') {
    return { aptSeq, action: 'SKIP_NOT_READY', data: null, reason: `masterCreateReadiness=${candidate.masterCreateReadiness}(승인 범위 밖)` };
  }

  // §7 DUPLICATE SAFETY — aptSeq가 이미 Master에 있으면 절대 INSERT하지 않는다
  // (기존 row UPDATE도 하지 않음 — 이 스크립트는 신규 생성 전용).
  if (existingAptSeqs.has(aptSeq)) {
    return { aptSeq, action: 'SKIP_DUPLICATE', data: null, reason: 'aptSeq가 이미 ApartmentMaster에 존재함' };
  }

  if (!aptSeq || !candidate.canonicalName || !candidate.lawdCd || !candidate.dong || !candidate.jibun) {
    return { aptSeq, action: 'REJECT_MISSING_FIELD', data: null, reason: 'aptSeq/canonicalName/lawdCd/dong/jibun 중 필수 identity 필드 결측' };
  }

  const sigungu = BUSAN_GU_BY_LAWDCD[candidate.lawdCd] ?? null;
  const normalizedName = normalizeSearchKeyword(candidate.canonicalName);

  const data: MasterRowData = {
    aptSeq,
    name: candidate.canonicalName,
    normalizedName,
    sido: '부산',
    sigungu,
    sggCd: candidate.lawdCd,
    umdName: candidate.dong,
    jibun: candidate.jibun,
    buildYear: candidate.buildYear,
  };

  return { aptSeq, action: 'INSERT', data, reason: 'identity 검증 완료(RECENT_MASTER_MISSING_16_AUDIT_V1), 중복 없음' };
}

export function buildAllPlans(candidates: RepairCandidate[], existingAptSeqs: Set<string>): RowPlan[] {
  return candidates.map((c) => buildMasterRowPlan(c, existingAptSeqs));
}
