import type { CanonicalStage } from './types';

// 국토부 CSV "현 사업추진단계" — 실측된 코드만(1과 8~16은 R2 전체 CSV 기준으로도
// 전혀 등장하지 않음, 추정하지 않고 관측된 값만 매핑한다).
const MOLIT_STAGE_MAP: Record<string, CanonicalStage> = {
  '2': 'ZONE_DESIGNATED', // 2)정비구역지정
  '3': 'PROMOTION_COMMITTEE', // 3)추진위구성
  '4': 'ASSOCIATION_APPROVED', // 4)조합설립인가
  '5': 'PROJECT_IMPLEMENTATION_APPROVED', // 5)사업시행인가
  '6': 'MANAGEMENT_DISPOSITION_APPROVED', // 6)관리처분인가
  '7': 'CONSTRUCTION', // 7)착공
  '17': 'PUBLIC_OPERATOR_DESIGNATED', // 17)사업시행자지정 — 공공시행 트랙, 번호 체계 불연속
};

export function parseMolitStageCode(raw: string): string | null {
  const m = raw.trim().match(/^(\d+)\)/);
  return m ? m[1] : null;
}

export function mapMolitStage(raw: string): CanonicalStage {
  const code = parseMolitStageCode(raw);
  if (!code) return 'UNKNOWN';
  return MOLIT_STAGE_MAP[code] ?? 'UNKNOWN';
}

// 부산 API "step" — 12종 전수 실측(R1/R2). 매핑 안 되는 새 값이 나오면 추정하지 않고
// UNKNOWN + rawStage 보존으로 떨어진다(아래 mapBusanStage 참고).
const BUSAN_STAGE_MAP: Record<string, CanonicalStage> = {
  예정구역지정: 'PLANNED',
  '정비계획 수립 및 정비구역 지정': 'ZONE_DESIGNATED',
  '추진위원회 구성': 'PROMOTION_COMMITTEE',
  조합설립인가: 'ASSOCIATION_APPROVED',
  '건축심의 및 통합심의': 'ARCHITECTURAL_REVIEW',
  사업시행계획인가: 'PROJECT_IMPLEMENTATION_APPROVED',
  관리처분계획: 'MANAGEMENT_DISPOSITION_APPROVED',
  착공: 'CONSTRUCTION',
  준공: 'COMPLETED',
  이전고시: 'TRANSFER_REGISTERED',
  조합해산: 'DISSOLVED',
  해제: 'CANCELLED',
};

export function mapBusanStage(raw: string): CanonicalStage {
  const n = raw.trim();
  return BUSAN_STAGE_MAP[n] ?? 'UNKNOWN';
}

// projectStatus는 사람이 입력하지 않는다 — stage로부터 코드가 계산한다(R3B 설계 그대로).
// DISSOLVED는 "완료 후 해산"과 "중도 좌초"를 원본 데이터만으로 구분할 수 없어(R3A
// 대연2 재개발 사례 — 조합해산 + 세대수 3,149) 의도적으로 UNKNOWN에 둔다.
export function deriveProjectStatus(stage: CanonicalStage): 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'UNKNOWN' {
  if (stage === 'COMPLETED' || stage === 'TRANSFER_REGISTERED') return 'COMPLETED';
  if (stage === 'CANCELLED') return 'CANCELLED';
  if (stage === 'DISSOLVED' || stage === 'UNKNOWN') return 'UNKNOWN';
  return 'ACTIVE';
}
