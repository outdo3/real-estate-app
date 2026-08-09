// 전용면적(m²)을 받아 전용 평형과 "공급 평형(근사치)"을 함께 계산한다.
//
// MOLIT 실거래 API는 전용면적만 제공하고 공급면적 데이터는 어디서도 얻을 수 없어서,
// 자주 나오는 전용면적 구간은 업계에 잘 알려진 "국민평형" 매핑표를 우선 사용하고,
// 표에 없는 값은 아파트 평균 전용률(약 77%) 공식으로 근사치를 계산한다.
// 두 경우 모두 정확한 값이 아니므로 표시할 때는 항상 "약"을 붙인다.
const KNOWN_SUPPLY_PYUNG: Array<{ min: number; max: number; supplyPyung: number }> = [
  { min: 36, max: 43, supplyPyung: 15 },
  { min: 45, max: 53, supplyPyung: 19 },
  { min: 55, max: 63, supplyPyung: 24 },
  { min: 69, max: 79, supplyPyung: 29 },
  { min: 80, max: 89, supplyPyung: 34 },
  { min: 97, max: 106, supplyPyung: 40 },
  { min: 109, max: 119, supplyPyung: 45 },
  { min: 129, max: 140, supplyPyung: 51 },
  { min: 142, max: 154, supplyPyung: 59 },
];

const AVERAGE_EXCLUSIVE_RATIO = 0.77;
const M2_PER_PYUNG = 3.3058;

export interface AreaInfo {
  exclusiveM2: number;
  exclusivePyung: number;
  supplyPyung: number;
  label: string;
}

export function getAreaInfo(rawExclusiveM2: number): AreaInfo {
  const exclusiveM2 = Math.round(rawExclusiveM2 * 100) / 100;
  const exclusivePyung = Math.round((exclusiveM2 / M2_PER_PYUNG) * 10) / 10;

  const known = KNOWN_SUPPLY_PYUNG.find((r) => exclusiveM2 >= r.min && exclusiveM2 <= r.max);
  const supplyPyung = known
    ? known.supplyPyung
    : Math.round(exclusiveM2 / AVERAGE_EXCLUSIVE_RATIO / M2_PER_PYUNG);

  return {
    exclusiveM2,
    exclusivePyung,
    supplyPyung,
    label: `전용 ${exclusiveM2}㎡(${exclusivePyung}평) · 공급 약 ${supplyPyung}평형`,
  };
}
