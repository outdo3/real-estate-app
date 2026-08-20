// 면적 표시 전용 helper. 아래 함수들은 오직 "화면에 어떻게 보여줄지"만 다루고,
// 평형 선택/필터링/차트 그룹핑에 쓰이는 내부 key(원본 area 문자열, 예: "84.9404m²")는
// 절대 건드리지 않는다 — 표시 문자열을 데이터 identity로 재사용하지 않는다.
//
// [B1-FIX 배경] 기존 getAreaInfo()는 전용면적을 정수로 절사하고 평형도 반올림해
// "84(26평)"처럼 표기했는데, 실제 MOLIT 실거래 데이터는 같은 단지 안에서도
// 84.36/84.38/84.69/84.92㎡처럼 서로 다른 전용면적이 흔하고, 이 값들이 전부
// "84(26평)"으로 뭉개져 실제로는 다른 타입인데 같은 칩처럼 보이는 문제가 있었다
// (부산 5개 단지 실측에서 확인). 이제는 소수점까지 살린 정확한 ㎡ 표기를 기본으로 쓴다.
//
// "공급 약 XX평형" 문구는 이번 STEP에서 제거했다 — MOLIT 실거래 API는 전용면적만
// 제공하고, 기존 supplyPyung은 "국민평형" 매핑표 + 평균 전용률(77%) 근사치일 뿐 실제
// 공급면적 데이터가 아니었다(분양 정보 도메인의 진짜 supplyArea(청약홈 SUPLY_AR)는
// presales 테이블에만 존재하고 이 실거래 화면과는 무관). 근거가 약한 임의 추정치를
// 계속 노출하는 대신 삭제했다.

// [B1-FIX2 배경] 기본 2자리 정책은 84㎡대는 잘 구분했지만, 59.8826㎡과 59.8839㎡처럼
// 2자리로 반올림하면 "59.88㎡"로 똑같아지는 실사례(대신롯데캐슬 실측)가 나왔다.
// 그렇다고 모든 면적을 무조건 3~4자리로 늘리면 이미 2자리에서 구분되는 값들까지
// 불필요하게 길어진다. 그래서 "단일 값 포맷터"(formatExclusiveArea)와 "같은 목록
// 안에서 라벨이 겹치는 값만 골라 필요한 만큼만 정밀도를 올리는 책임"
// (getUniqueAreaLabels)을 분리했다. 정밀도 상한(MAX_AREA_PRECISION)은 부산 5개
// 단지 1,800건+ 실측에서 관찰된 MOLIT 원본 최대 소수 자릿수(4자리)를 근거로
// 정했다 — 추측치가 아니다. 그 이상 늘려도 라벨이 여전히 같다면 사실상 동일한
// 면적으로 보고 더 늘리지 않는다.
const M2_PER_PYEONG = 3.305785;
const MAX_AREA_PRECISION = 4;

function roundToPrecision(m2: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(m2 * factor) / factor;
}

// 소수점 trailing zero 제거: 84 -> "84", 84.8 -> "84.8", 84.84 -> "84.84"
function trimTrailingZeros(rounded: number, precision: number): string {
  return parseFloat(rounded.toFixed(precision)).toString();
}

function labelAtPrecision(m2: number, precision: number): string {
  return `${trimTrailingZeros(roundToPrecision(m2, precision), precision)}㎡`;
}

// APT DETAIL QA/IA v1 — ㎡↔평 토글(§6~8). "표시 문자열이 서로 다른 두 원본 면적을
// 같은 값으로 뭉개지 않는다"는 getUniqueAreaLabels의 원칙을 평 단위에도 그대로
// 적용한다 — 84.84㎡와 84.99㎡는 1자리 평(둘 다 25.7평)에서 겹치므로, 겹치는 것만
// 겹치지 않을 때까지(최대 MAX_PYEONG_PRECISION) 정밀도를 올린다. ㎡ 버전과 알고리즘은
// 동일하고 "무엇으로 변환해서 비교하느냐"만 다르다.
const MAX_PYEONG_PRECISION = 3;

function toPyeong(m2: number): number {
  return m2 / M2_PER_PYEONG;
}

function pyeongLabelAtPrecision(m2: number, precision: number): string {
  return `${trimTrailingZeros(roundToPrecision(toPyeong(m2), precision), precision)}평`;
}

// getUniqueAreaLabels/getUniquePyeongLabels가 공유하는 충돌 해소 알고리즘.
// labelFn만 단위별로 다르게 주입한다(㎡ 표시값 자체를 변환하지 않음 — 내부 key는
// 항상 원본 ㎡ 숫자 그대로).
function buildUniqueLabels(
  rawAreasM2: number[],
  labelFn: (m2: number, precision: number) => string,
  minPrecision: number,
  maxPrecision: number
): Map<number, string> {
  const labels = new Map<number, string>();
  let remaining = new Set(rawAreasM2.filter((v) => !Number.isNaN(v)));

  for (let precision = minPrecision; precision <= maxPrecision && remaining.size > 0; precision++) {
    const byLabel = new Map<string, number[]>();
    remaining.forEach((v) => {
      const label = labelFn(v, precision);
      const bucket = byLabel.get(label);
      if (bucket) bucket.push(v);
      else byLabel.set(label, [v]);
    });

    const stillColliding = new Set<number>();
    byLabel.forEach((values, label) => {
      const resolved = values.length === 1 || precision === maxPrecision;
      if (resolved) {
        values.forEach((v) => labels.set(v, label));
      } else {
        values.forEach((v) => stillColliding.add(v));
      }
    });
    remaining = stillColliding;
  }

  return labels;
}

// 평 단위 표시용 충돌 해소 라벨 맵(㎡ 버전과 동일 원칙, §5 "임의 round로 다른 평형을
// 합치지 않는다"). 기본 1자리에서 시작 — 평은 관행적으로 소수 1자리까지만 봐도 대부분
// 구분되고(3.3㎡ 차이가 1평), 필요할 때만 최대 3자리까지 올린다.
export function getUniquePyeongLabels(rawAreasM2: number[]): Map<number, string> {
  return buildUniqueLabels(rawAreasM2, pyeongLabelAtPrecision, 1, MAX_PYEONG_PRECISION);
}

// 칩/거래목록처럼 좁은 공간에서 쓰는 정확한 전용면적 표기(기본 2자리). 예: "84.84㎡"
// 주의: 이 함수는 단일 값만 보고 판단한다 — 같은 목록 안의 다른 값과 라벨이 겹칠
// 수 있는 곳(AreaSelector 칩, 거래목록처럼 여러 값이 나란히 보이는 UI)에서는 이
// 함수를 직접 쓰지 말고 getUniqueAreaLabels()로 만든 라벨 맵을 통해 조회할 것.
export function formatExclusiveArea(rawExclusiveM2: number): string {
  if (Number.isNaN(rawExclusiveM2)) return '면적 정보 없음';
  return labelAtPrecision(rawExclusiveM2, 2);
}

// 평 환산(㎡ / 3.305785, 소수점 1자리) — 표시 전용. DB/raw 데이터에 저장하지 않는다.
export function formatPyeong(rawExclusiveM2: number): string {
  if (Number.isNaN(rawExclusiveM2)) return '';
  const pyeong = Math.round((rawExclusiveM2 / M2_PER_PYEONG) * 10) / 10;
  return `약 ${pyeong}평`;
}

// "같은 목록에 함께 나오는 면적들" 전체를 받아, 기본 2자리 라벨이 서로 겹치는
// 값들만 겹치지 않을 때까지(최대 MAX_AREA_PRECISION자리) 정밀도를 올려 고유한
// 라벨을 만든다. 이미 2자리에서 구분되는 값은 그대로 2자리를 유지한다 —
// 목록 안 일부의 충돌 때문에 전체 목록의 정밀도를 함께 늘리지 않는다.
// internal key(원본 area 문자열/숫자)는 만들지도, 바꾸지도 않는다 — 반환값은
// 오직 "원본 숫자 -> 표시 문자열" 조회용 Map이다.
export function getUniqueAreaLabels(rawAreasM2: number[]): Map<number, string> {
  return buildUniqueLabels(rawAreasM2, labelAtPrecision, 2, MAX_AREA_PRECISION);
}

export type AreaUnit = '㎡' | '평';

// APT DETAIL QA/IA v1 §9 — chip/거래표/토글이 전부 같은 이 함수 하나만 거쳐가게 해서
// "한 곳만 바뀌고 다른 곳은 ㎡로 남는" 불일치를 구조적으로 막는다(호출부는 단위 분기
// 로직을 갖지 않고 이 함수가 돌려준 라벨 맵만 그대로 쓴다).
export function getAreaLabelsForUnit(rawAreasM2: number[], unit: AreaUnit): Map<number, string> {
  return unit === '평' ? getUniquePyeongLabels(rawAreasM2) : getUniqueAreaLabels(rawAreasM2);
}

// getUniqueAreaLabels()가 만든 맵에서 조회하고, 맵에 없는 값(예: 맵 생성 이후
// 새로 등장한 값)은 기본 2자리 단일 포맷으로 안전하게 fallback한다.
export function resolveAreaLabel(rawExclusiveM2: number, labels?: Map<number, string>): string {
  if (Number.isNaN(rawExclusiveM2)) return '면적 정보 없음';
  return labels?.get(rawExclusiveM2) ?? formatExclusiveArea(rawExclusiveM2);
}

// Hero/거래타임라인 헤더에서 쓰는 "전용 84.84㎡ · 약 25.7평" 형태. labels를 넘기면
// 같은 페이지의 chip/거래목록과 동일한(충돌 해소된) 전용면적 라벨을 그대로 쓰고,
// 넘기지 않으면 기본 2자리로 표시한다.
export function getAreaDetailLabel(rawExclusiveM2: number, labels?: Map<number, string>): string {
  if (Number.isNaN(rawExclusiveM2)) return '면적 정보 없음';
  return `전용 ${resolveAreaLabel(rawExclusiveM2, labels)} · ${formatPyeong(rawExclusiveM2)}`;
}
