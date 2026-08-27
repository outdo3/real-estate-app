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

export type NameMatcher = (nameA: string, nameB: string) => boolean;

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
  byDong: Map<string, MasterCoordRow[]>;
}

export interface ResolvedApartmentCoords {
  aptSeq: string | null;
  completionYear: number | null;
  lat: number | null;
  lng: number | null;
}

export function buildMasterCoordIndex(masters: MasterCoordRow[]): MasterCoordIndex {
  const exact = new Map<string, MasterCoordRow>();
  const byDong = new Map<string, MasterCoordRow[]>();
  for (const m of masters) {
    const key = `${m.umdName}|${m.name}`;
    if (!exact.has(key)) exact.set(key, m);
    const dongKey = m.umdName || '';
    if (!byDong.has(dongKey)) byDong.set(dongKey, []);
    byDong.get(dongKey)!.push(m);
  }
  return { exact, byDong };
}

// 1순위: dong+name 완전일치. 2순위: 같은 법정동(umdName) 안에서만 aptNamesMatch(차수/브랜드
// alias 등 실측으로 검증된 안전한 표기 차이만 흡수)로 보강한다 — 다른 dong으로는 절대
// 확장하지 않아 "다른 단지 fallback 금지" 원칙을 유지한다. 매칭 실패 시 aptSeq/좌표 모두
// null(추정 좌표 생성 금지, name-only identity 없이 좌표만 붙이지 않음).
export function resolveApartmentCoords(
  index: MasterCoordIndex,
  dong: string,
  name: string,
  matchName: NameMatcher,
  fuzzyCache?: Map<string, MasterCoordRow | null>
): ResolvedApartmentCoords {
  const key = `${dong}|${name}`;
  let master = index.exact.get(key) ?? null;

  if (!master) {
    if (fuzzyCache?.has(key)) {
      master = fuzzyCache.get(key) ?? null;
    } else {
      master = (index.byDong.get(dong) || []).find((c) => matchName(c.name, name)) || null;
      fuzzyCache?.set(key, master);
    }
  }

  const hasCoords = !!master && Number.isFinite(master.latitude) && Number.isFinite(master.longitude);
  return {
    aptSeq: master ? master.aptSeq : null,
    completionYear: master ? master.buildYear : null,
    lat: hasCoords ? master!.latitude : null,
    lng: hasCoords ? master!.longitude : null,
  };
}
