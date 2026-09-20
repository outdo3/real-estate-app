// MAP_SURROUNDING_MARKER_PERFORMANCE_V1 — src/app/api/transactions/route.ts가 MOLIT 실거래
// 항목(dong+name 텍스트)을 ApartmentMaster canonical identity(aptSeq)와 그 저장 좌표에
// 연결하는 순수 판정 로직만 분리했다(DB/외부 API 부작용 없음 — scripts/busan-qa-logic.ts와
// 동일 관례). 이전에는 이 연결에 Kakao 키워드 지오코딩(N+1 외부 API)을 썼으나, 이제는
// ApartmentMaster가 이미 가진 좌표(Busan coverage 100%)를 직접 사용한다.
//
// 이 파일은 `node --experimental-strip-types --test`로 직접 실행되는 .test.mjs가 import하므로
// (다른 pure-logic 파일들과 동일 관례, apt-building-info.ts/gap-invest-calc.ts 참고) 로컬
// 모듈을 import하지 않는다 — 확장자 없는 상대경로 import는 tsc/Next.js 번들러에서는 통과하지만
// node의 네이티브 ESM 로더에서는 해석되지 않는다. 이름 매칭 함수(aptNamesMatch)는 호출부
// (route.ts)가 주입한다.

export interface MasterCoordRow {
  name: string;
  umdName: string | null;
  aptSeq: string | null;
  buildYear: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface MasterCoordIndex {
  exact: Map<string, MasterCoordRow>;
}

export interface ResolvedApartmentCoords {
  aptSeq: string | null;
  completionYear: number | null;
  lat: number | null;
  lng: number | null;
}

export function buildMasterCoordIndex(masters: MasterCoordRow[]): MasterCoordIndex {
  const exact = new Map<string, MasterCoordRow>();
  for (const m of masters) {
    const key = `${m.umdName}|${m.name}`;
    if (!exact.has(key)) exact.set(key, m);
  }
  return { exact };
}

// MAP_TIER2_FALLBACK_REMOVAL_V1 — **dong+name 완전일치만** canonical identity로 인정한다.
//
// 예전에는 완전일치가 실패하면 같은 법정동 안에서 aptNamesMatch(양방향 부분포함)로 한 번 더
// 찾았다. 그 규칙은 표기 차이를 흡수하려던 것이었지만, 이름 포함 관계는 identity가 아니다 —
// MAP_IDENTITY_FALLBACK_IMPACT_AUDIT_V1이 운영 데이터로 실측한 결과, 현재 지도 창(12개월)에서
// 2순위가 실제로 쓰인 marker는 부산 2,886개 중 **단 1개**였고 그 1개가 **오귀속**이었다:
// `주례일산맨션`(26530-69)이 정규화 후 `주례` ⊂ `주례일산맨션` 때문에 `주례`(26530-72)의
// aptSeq와 좌표를 물려받았다. 정당한 표기차로 살아 있던 marker는 부산·서울 모두 **0개**였다.
// 상세 경로는 이미 같은 원칙(resolveStrongIdentityAptSeqs, SEARCH_DETAIL_IDENTITY_HOTFIX_V2)으로
// 막혀 있었고, 지도만 열려 있어 일관성이 없었다.
//
// 완전일치에 실패하면 aptSeq/좌표 모두 null이다 — 다른 단지의 좌표를 빌려오지 않고, marker를
// 만들지 않는다(추정 좌표 생성 금지, name-only identity 금지). "틀린 위치에 찍힌 marker"보다
// "marker 없음"이 정직한 실패다.
export function resolveApartmentCoords(
  index: MasterCoordIndex,
  dong: string,
  name: string
): ResolvedApartmentCoords {
  const master = index.exact.get(`${dong}|${name}`) ?? null;

  const hasCoords = !!master && Number.isFinite(master.latitude) && Number.isFinite(master.longitude);
  return {
    aptSeq: master ? master.aptSeq : null,
    completionYear: master ? master.buildYear : null,
    lat: hasCoords ? master!.latitude : null,
    lng: hasCoords ? master!.longitude : null,
  };
}
