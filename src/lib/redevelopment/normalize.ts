// R3B 확정 normalizedName 규칙 — R3A 파일럿에서 실제로 검증된 규칙 그대로.
//
// R3A는 처음에 "재개발/재건축/정비사업/구역/지구" 등 유형 접미사까지 제거하는
// normalize()를 썼는데, 그 규칙이 실제 오매칭을 만드는 것을 실증했다 — "거제2 재개발"과
// "거제2 재건축"은 서로 다른 사업인데 접미사를 지우면 둘 다 "거제2"로 뭉쳐버린다(부산
// API 내부 충돌 20건 전부 이 패턴). 그래서 R3B는 정규화 범위를 공백/"제" 제거로만
// 좁히고, 유형 구분은 별도 businessType 필드 비교로 대체했다(정규화 안에 넣지 않음).
export function normalizeName(rawName: string): string {
  let n = rawName.trim();
  n = n.replace(/\s+/g, '');
  n = n.split('제').join('');
  return n;
}

// R3A 원래 파일럿이 쓰던 접미사 목록(정규화에는 포함하지 않지만, 매칭 "비교" 단계에서는
// 여전히 필요하다 — 아래 stripTypeSuffixForComparison 참고).
const TYPE_SUFFIXES = [
  '재개발정비사업',
  '재건축정비사업',
  '주택재개발정비사업',
  '주택재건축정비사업',
  '가로주택정비사업',
  '소규모재건축사업',
  '소규모재건축',
  '재개발사업',
  '재건축사업',
  '정비사업',
  '정비구역',
  '재개발',
  '재건축',
  '구역',
  '지구',
  '사업',
];

// normalizedName은 저장/인덱스 목적으로는 유형 접미사를 지우지 않는다(위 normalizeName
// 설명 참고) — 하지만 실물 데이터 확인 결과 부산 API의 areaName은 유형 접미사를
// 포함하기도(예: "서대신4 재개발") 안 하기도(R3A 문서의 "서대신4" 예시) 해서, 매칭
// "비교" 단계에서 두 소스의 이름을 그대로 비교하면 같은 사업인데도 문자열이 달라져버린다.
// 그래서 matching.ts는 이 함수로 얻은 접미사-제거 버전만 유사도 비교에 쓰고, DB에
// 저장되는 normalizedName 자체는 절대 이 함수를 거치지 않는다. 오매칭 방지는 별도
// businessType 필드 비교가 계속 담당한다(거제2 재개발 vs 재건축처럼 접미사를 지워
// 이름이 같아져도 businessType이 다르면 여전히 LOW로 강등됨 — matching.ts 참고).
export function stripTypeSuffixForComparison(normalizedName: string): string {
  let n = normalizedName;
  for (const suf of TYPE_SUFFIXES) {
    if (n.endsWith(suf)) {
      n = n.slice(0, -suf.length);
      break;
    }
  }
  return n;
}
