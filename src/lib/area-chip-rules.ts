// [AREA MODEL V1 §16/§19] AreaChip의 "평형 표기는 검증된 공급면적이 있을 때만"
// 규칙을 순수 로직으로 분리했다 — AreaChip.tsx(CSS 모듈을 import하는 컴포넌트)와
// 달리 이 파일은 어떤 CSS/DOM 의존성도 없어 ts-node 스크립트에서 그대로 import해
// 단위 테스트할 수 있다.
export interface AreaChipLabelInput {
  supplyAreaM2: number | null;
  pyeongLabel: string | null;
}

export function shouldShowPyeongLabel(data: AreaChipLabelInput): boolean {
  return data.supplyAreaM2 !== null && !!data.pyeongLabel;
}
