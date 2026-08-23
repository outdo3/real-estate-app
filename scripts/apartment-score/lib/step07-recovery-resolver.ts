// E-JIP SCORE V2 STEP 0.7 §4/§17 — Apartment Identity Recovery Resolver(prototype).
//
// 설계 원칙(지시사항 §0 그대로):
// - 이름 유사도만으로 merge하지 않는다. 이름 비교는 여기서 "다른 row와의 merge 여부"를
//   결정하지 않는다 — 애초에 이 resolver는 서로 다른 두 ApartmentMaster row를 merge하는
//   기능이 아니다. 입력은 항상 "이미 aptSeq로 확정된 단일 row"이며, 그 row 자신이 이미
//   갖고 있는 jibun/dong/sggCd(MOLIT 원본, apartment_master_seed.ts가 이미 저장한 값)로
//   건축물대장을 조회해 그 row의 주소/세대수/mgmBldrgstPk를 "보강"할 뿐이다 — 이름 매칭이
//   전혀 필요 없는 단일 row enrichment(§9). 이름 비교는 이상 신호 탐지(§17 adversarial
//   case, 특히 차수 불일치)에만 쓰고 절대 merge 게이트로 쓰지 않는다.
// - 좌표 근접만으로 merge하지 않는다: 이 resolver는 좌표를 아예 입력받지 않는다.
// - 다른 단지 fallback/guess하지 않는다: registry 조회는 sigunguCd+bjdongCd+bun+ji로
//   완전히 결정되는 조회이며(도로명/지번 exact-address 조회), 결과가 없으면(not_found)
//   무조건 RECOVERY_FAILED다 — "가장 비슷한 것"을 대신 채택하는 로직 자체가 없다.
// - recordCount(같은 지번에 registry 레코드가 몇 건 잡혔는지)가 1건이 아니면 절대 HIGH를
//   주지 않는다(§17 "비슷한 이름 건물이 같은 지번을 공유"류 케이스에 대한 구조적 방어).
//
// §9 실측(2025-08-23 라이브 pilot, 48건 표본): 총괄표제부(recap)만 쓰면 45/48 not_found,
// 표제부(title) fallback을 더하면 47/48 success(97.9%) — 대다수 고위험 후보가 "다동 단지용
// 총괄표제부가 없는 소규모/단일동 건물"이었을 뿐, registry 자체에 등록이 없는 게 아니었다.
import type { RegistryProbeResult } from './step07-registry-probe';

export type RecoveryLevel = 'RECOVERY_HIGH' | 'RECOVERY_MEDIUM' | 'RECOVERY_REVIEW' | 'RECOVERY_FAILED';
export type UniverseFlag = 'VALID_APARTMENT' | 'MIXED_USE' | 'NON_TARGET' | 'UNKNOWN';
export type NameMatch = 'exact' | 'superset' | 'mismatch' | 'chasu_mismatch' | 'unknown';

export interface RecoveryInput {
  aptSeq: string;
  aptName: string;
  buildYear: number | null;
  probe: RegistryProbeResult;
}

export interface RecoveryResult {
  level: RecoveryLevel;
  universeFlag: UniverseFlag;
  nameMatch: NameMatch;
  buildYearConsistent: boolean | null; // null = 비교 불가(registry에 approvalYear 없음)
  reasons: string[]; // explainability(지시사항 원칙 10) — 왜 이 등급인지 사람이 읽을 수 있는 근거
}

const CHASU_PATTERN = /\d+차/;
const BUILD_YEAR_TOLERANCE = 3; // 건축년도(MOLIT)와 사용승인년도(registry)는 보통 0~2년 차이 — 실측 벤치마크로 검증된 여유치(§4)

function normalizeForCompare(s: string): string {
  return (s || '').replace(/\s+/g, '').replace(/아파트$/, '');
}
function extractChasu(s: string): string | null {
  const m = normalizeForCompare(s).match(CHASU_PATTERN);
  return m ? m[0] : null;
}

function classifyUniverse(probe: RegistryProbeResult): UniverseFlag {
  if (probe.status !== 'success' || !probe.mainPurpsCdNm) return 'UNKNOWN';
  if (probe.mainPurpsCdNm === '공동주택') return 'VALID_APARTMENT';
  if (probe.mainPurpsCdNm.includes('근린생활') || probe.mainPurpsCdNm.includes('업무') || probe.mainPurpsCdNm.includes('숙박')) return 'MIXED_USE';
  return 'NON_TARGET'; // 단독주택 등 — 공동주택(아파트) universe 자체가 아닐 가능성
}

function classifyNameMatch(aptName: string, probe: RegistryProbeResult): NameMatch {
  if (probe.status !== 'success' || !probe.bldNm) return 'unknown';
  const a = normalizeForCompare(aptName);
  const b = normalizeForCompare(probe.bldNm);
  if (a === b) return 'exact';
  const chasuA = extractChasu(aptName);
  const chasuB = extractChasu(probe.bldNm);
  if (chasuA && chasuB && chasuA !== chasuB) return 'chasu_mismatch';
  if (chasuA && !chasuB) return 'chasu_mismatch'; // 후보 이름엔 차수가 명시돼 있는데 registry엔 없음 — 다른 동일 가능성, 보수적으로 review
  if (a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a))) return 'superset';
  return 'mismatch';
}

export function classifyRecovery(input: RecoveryInput): RecoveryResult {
  const { probe } = input;
  const universeFlag = classifyUniverse(probe);
  const nameMatch = classifyNameMatch(input.aptName, probe);
  const reasons: string[] = [];

  let buildYearConsistent: boolean | null = null;
  if (probe.status === 'success' && probe.approvalYear != null && input.buildYear != null) {
    buildYearConsistent = Math.abs(probe.approvalYear - input.buildYear) <= BUILD_YEAR_TOLERANCE;
  }

  if (probe.status !== 'success') {
    reasons.push(`registry 조회 실패(${probe.status}) — 결정적 evidence 없음, 추정 금지`);
    return { level: 'RECOVERY_FAILED', universeFlag, nameMatch, buildYearConsistent, reasons };
  }

  if (probe.recordCount > 1) {
    reasons.push(`동일 지번에 registry 레코드 ${probe.recordCount}건 — 주소 자체가 유일하지 않음(§17), 자동 승격 금지`);
    return { level: 'RECOVERY_REVIEW', universeFlag, nameMatch, buildYearConsistent, reasons };
  }

  if (nameMatch === 'chasu_mismatch') {
    reasons.push(`차수(1차/2차 등) 표기 불일치(후보="${input.aptName}", registry="${probe.bldNm}") — §17 adversarial case, 수동 검토`);
    return { level: 'RECOVERY_REVIEW', universeFlag, nameMatch, buildYearConsistent, reasons };
  }

  if (buildYearConsistent === false) {
    reasons.push(`건축년도 불일치(MOLIT=${input.buildYear}, registry 사용승인=${probe.approvalYear}, 허용치 ${BUILD_YEAR_TOLERANCE}년 초과) — 동일 건물인지 의심, 수동 검토`);
    return { level: 'RECOVERY_REVIEW', universeFlag, nameMatch, buildYearConsistent, reasons };
  }

  if (universeFlag === 'MIXED_USE' || universeFlag === 'NON_TARGET') {
    reasons.push(`registry 주용도="${probe.mainPurpsCdNm}"(공동주택 아님) — 주소/식별은 회복되나 아파트 universe 소속 자체가 불확실`);
    return { level: 'RECOVERY_MEDIUM', universeFlag, nameMatch, buildYearConsistent, reasons };
  }

  if (probe.totalHouseholds == null) {
    reasons.push('주소 식별(고유 매칭)은 성공했으나 registry에 세대수(hhldCnt) 값이 없음 — 부분 evidence');
    return { level: 'RECOVERY_MEDIUM', universeFlag, nameMatch, buildYearConsistent, reasons };
  }

  reasons.push(`고유(recordCount=1) 지번 주소 매칭 성공(tier=${probe.tier}), 주용도=공동주택, 세대수 확보, 건축년도 정합${buildYearConsistent == null ? '(비교불가)' : ''}`);
  if (nameMatch === 'mismatch') {
    reasons.push(`이름 표기는 다르나(후보="${input.aptName}", registry="${probe.bldNm}") 지번 주소가 유일하게 일치 — MOLIT 거래명과 등록 공식명 표기 차이는 흔한 현상(비차단 신호, §9 실측 확인: 표본 9/48건)`);
  }
  return { level: 'RECOVERY_HIGH', universeFlag, nameMatch, buildYearConsistent, reasons };
}
