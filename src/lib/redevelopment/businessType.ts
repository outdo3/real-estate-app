import type { CanonicalBusinessType } from './types';

// 국토부 CSV "사업유형" 컬럼 — 5개 코드 전부 R2에서 전체 CSV 기준 실측 확인
// (docs/development/R2-redevelopment-data-validation.md "국토부 사업유형 distinct").
const MOLIT_BUSINESS_TYPE_MAP: Record<string, CanonicalBusinessType> = {
  '1': 'REDEVELOPMENT', // 1)재개발(주택정비)
  '2': 'REDEVELOPMENT', // 2)재개발(도시정비)
  '3': 'RECONSTRUCTION', // 3)재건축(공동주택)
  '4': 'RECONSTRUCTION', // 4)재건축(단독주택)
  '5': 'RESIDENTIAL_ENVIRONMENT', // 5)주거환경개선
};

// "N)라벨" 형식에서 코드만 뽑는다. 라벨 자체는 rawBusinessType에 원문 그대로 보존하고,
// 이 함수는 코드 파싱만 담당한다(R3B: "코드/라벨을 분리 저장할 실익이 낮다"는 결론에
// 따라 rawBusinessTypeCode는 optional로 앞자리 숫자만 뽑아 채운다).
export function parseMolitBusinessTypeCode(raw: string): string | null {
  const m = raw.trim().match(/^(\d+)\)/);
  return m ? m[1] : null;
}

export function mapMolitBusinessType(raw: string): CanonicalBusinessType {
  const code = parseMolitBusinessTypeCode(raw);
  if (!code) return 'UNKNOWN';
  return MOLIT_BUSINESS_TYPE_MAP[code] ?? 'OTHER';
}

// 부산 API는 사업유형 전용 필드가 없다(R1/R2 실측 확인) — areaName 접미사로만 추정
// 가능하다(공식 분류 아님, 참고용 — R2 "부산 사업유형 canonical 설계" 그대로).
// 접미사가 겹치는 값(가로주택정비사업 vs 가로주택정비)이 있을 수 있어 긴 접미사부터
// 먼저 검사한다.
const BUSAN_AREA_NAME_SUFFIX_MAP: Array<[string, CanonicalBusinessType]> = [
  ['가로주택정비사업', 'BLOCK_HOUSING'],
  ['가로주택정비', 'BLOCK_HOUSING'],
  ['소규모재건축사업', 'SMALL_RECONSTRUCTION'],
  ['소규모재건축', 'SMALL_RECONSTRUCTION'],
  ['재건축정비사업', 'RECONSTRUCTION'],
  ['재건축사업', 'RECONSTRUCTION'],
  ['재건축', 'RECONSTRUCTION'],
  ['재개발정비사업', 'REDEVELOPMENT'],
  ['재개발사업', 'REDEVELOPMENT'],
  ['재개발', 'REDEVELOPMENT'],
];

export function mapBusanBusinessType(areaName: string): CanonicalBusinessType {
  const n = areaName.trim();
  for (const [suffix, type] of BUSAN_AREA_NAME_SUFFIX_MAP) {
    if (n.endsWith(suffix)) return type;
  }
  return 'UNKNOWN';
}
