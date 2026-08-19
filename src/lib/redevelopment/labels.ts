import type { CanonicalBusinessType, CanonicalStage } from './types';

// R6 — UI(클라이언트 컴포넌트)와 service.ts(서버) 양쪽이 공유하는 순수 라벨 매핑.
// Prisma나 다른 서버 전용 모듈을 import하지 않는다 — 클라이언트 번들에 안전하게
// 포함될 수 있어야 한다.

export const BUSINESS_TYPE_VALUES: CanonicalBusinessType[] = [
  'REDEVELOPMENT',
  'RECONSTRUCTION',
  'RESIDENTIAL_ENVIRONMENT',
  'SMALL_RECONSTRUCTION',
  'BLOCK_HOUSING',
  'OTHER',
  'UNKNOWN',
];

export const STAGE_VALUES: CanonicalStage[] = [
  'PLANNED',
  'ZONE_DESIGNATED',
  'PROMOTION_COMMITTEE',
  'ASSOCIATION_APPROVED',
  'ARCHITECTURAL_REVIEW',
  'PUBLIC_OPERATOR_DESIGNATED',
  'PROJECT_IMPLEMENTATION_APPROVED',
  'MANAGEMENT_DISPOSITION_APPROVED',
  'RELOCATION_DEMOLITION',
  'CONSTRUCTION',
  'COMPLETED',
  'TRANSFER_REGISTERED',
  'DISSOLVED',
  'CANCELLED',
  'UNKNOWN',
];

// R3B enum 정의 그대로 한글 라벨만 붙인다(새 분류 만들지 않음).
export const STAGE_LABELS: Record<CanonicalStage, string> = {
  PLANNED: '예정구역지정',
  ZONE_DESIGNATED: '정비구역지정',
  PROMOTION_COMMITTEE: '추진위원회구성',
  ASSOCIATION_APPROVED: '조합설립인가',
  ARCHITECTURAL_REVIEW: '건축심의',
  PUBLIC_OPERATOR_DESIGNATED: '사업시행자지정',
  PROJECT_IMPLEMENTATION_APPROVED: '사업시행인가',
  MANAGEMENT_DISPOSITION_APPROVED: '관리처분인가',
  RELOCATION_DEMOLITION: '이주철거',
  CONSTRUCTION: '착공',
  COMPLETED: '준공',
  TRANSFER_REGISTERED: '이전고시',
  DISSOLVED: '조합해산',
  CANCELLED: '해제',
  UNKNOWN: '확인 중',
};

export const BUSINESS_TYPE_LABELS: Record<CanonicalBusinessType, string> = {
  REDEVELOPMENT: '재개발',
  RECONSTRUCTION: '재건축',
  RESIDENTIAL_ENVIRONMENT: '주거환경개선',
  SMALL_RECONSTRUCTION: '소규모재건축',
  BLOCK_HOUSING: '가로주택정비',
  OTHER: '기타',
  UNKNOWN: '확인 중',
};

// projectStatus(RedevelopmentProjectStatus)는 stage로부터 자동 파생되는 값이라
// (src/lib/redevelopment/stage.ts의 deriveProjectStatus 참고) 별도 enum을 새로
// 만들지 않고 라벨만 추가한다 — 상세 페이지의 "상태" 표시용(섹션 24).
export const PROJECT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '진행 중',
  COMPLETED: '완료',
  CANCELLED: '취소',
  UNKNOWN: '확인 중',
};

export function projectStatusLabel(status: string): string {
  return PROJECT_STATUS_LABELS[status] ?? status;
}

// 진행이 멈춘/끝난 상태를 다른 색으로 구분하기 위한 최소 stage 그룹(뱃지 색상용,
// 새 enum이 아니라 UI 표시 목적의 그룹핑일 뿐).
export function stageGroup(stage: CanonicalStage): 'active' | 'done' | 'stopped' | 'unknown' {
  if (stage === 'COMPLETED' || stage === 'TRANSFER_REGISTERED') return 'done';
  if (stage === 'CANCELLED' || stage === 'DISSOLVED') return 'stopped';
  if (stage === 'UNKNOWN') return 'unknown';
  return 'active';
}

export const SOURCE_LABELS: Record<string, string> = {
  MOLIT: '국토교통부',
  BUSAN_CITY: '부산광역시',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

// 카드/상세에서 "부산광역시" 대신 "부산"처럼 짧게 보여주기 위한 표시 전용 매핑.
// REGION_DATA(src/lib/regions.ts)의 17개 시도 전체를 대상으로 명시적으로 나열한다
// (접미사 문자열 자르기 방식은 "강원특별자치도"→"강원" 같은 경우 규칙이 일정하지
// 않아 위험 — 추측하지 않고 표로 고정).
export const SIDO_SHORT_LABELS: Record<string, string> = {
  서울특별시: '서울',
  부산광역시: '부산',
  대구광역시: '대구',
  인천광역시: '인천',
  광주광역시: '광주',
  대전광역시: '대전',
  울산광역시: '울산',
  세종특별자치시: '세종',
  경기도: '경기',
  강원특별자치도: '강원',
  충청북도: '충북',
  충청남도: '충남',
  전북특별자치도: '전북',
  전라남도: '전남',
  경상북도: '경북',
  경상남도: '경남',
  제주특별자치도: '제주',
};

export function sidoShortLabel(sido: string): string {
  return SIDO_SHORT_LABELS[sido] ?? sido;
}

// dataUpdatedAt(ISO)을 "2026.08"처럼 표시한다 — 이 값은 원본 소스의 공식 "기준일"이
// 아니라 이집이 마지막으로 이 사업 정보를 갱신한 시점이라, 라벨도 "데이터 갱신"으로
// 정직하게 표기한다("기준"이라는 단어는 출처의 공식 기준일처럼 오인될 수 있어 피함).
export function formatDataUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
