// [STATISTICS V2 §10/§11] Statistics 랭킹류 화면이 공유하는 숫자 표시 helper.
// 억/만원 변환 자체는 이미 `formatKoreanPrice`(api-molit.ts)가 전 API에서
// 일관되게 쓰이고 있어 중복 구현하지 않고 그대로 재사용한다. 여기서는
// 그 위에서 반복되던 %/방향색 표기만 공용화한다.
export { formatKoreanPrice } from './api-molit';

// [§11] 한국 부동산 관행(상승=빨강/하락=파랑)을 그대로 따른다 — DS-2에서 이미
// --up-color(#f4361e)/--down-color(#3152d6) 토큰으로 고정된 값. RANKING_CONFIGS가
// 그동안 써 오던 '#ef4444'/'#3b82f6' 하드코딩(토큰과 미세하게 다른 근사 색)을
// 대체한다 — 계산 로직이 아니라 표시 색상만 토큰화하는 것이라 비즈니스 로직
// 변경이 아니다. error/warning과는 분리된 값이다(--up/--down-color는 가격 방향
// 전용, --error-color/--warning-color를 여기서 쓰지 않는다).
export function directionColor(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'var(--text-secondary)';
  return value > 0 ? 'var(--up-color)' : 'var(--down-color)';
}

// 퍼센트 변화율 표시 — 양수는 "+", 음수는 원래 부호(-) 그대로, 0/null은 안전 처리.
export function formatPercentChange(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return value > 0 ? `+${value}%` : `${value}%`;
}

// 거래건수 — "건" 단위. 표본 부족 여부를 호출부가 판단할 수 있도록 raw count도 그대로 둔다.
export function formatTradeCount(count: number): string {
  return `${count.toLocaleString('ko-KR')}건`;
}

// [§15] 표본 1~2건은 통계적으로 과대해석 위험이 크다 — RankingRow가 이 값을
// 보고 "표본 적음" 배지를 붙일지 판단하는 데 쓴다(값 자체를 감추거나 계산을
// 바꾸지 않는다, 표시에만 씀).
export const LOW_SAMPLE_THRESHOLD = 3;
export function isLowSample(count: number): boolean {
  return count > 0 && count < LOW_SAMPLE_THRESHOLD;
}
