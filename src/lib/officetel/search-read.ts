// OFFICETEL_V1 STEP 4B §2 — 오피스텔 검색 READ 계층(읽기 전용).
//
// 기존 아파트 검색을 대체하지 않는다. `/api/search`의 기존 Promise.all에 쿼리 하나를
// 더할 뿐이며, 아파트 결과 계산에는 손대지 않는다. `officetel_masters`는 5,056행이라
// 이 쿼리가 기존 검색 지연에 사실상 영향을 주지 않는다.
//
// §2 계약: 텍스트 매칭은 퍼지해도 되지만 **UI로 내려가는 identity는 언제나 정확하다** —
// 각 결과가 자기 `officetelId`와 `canonicalKey`를 들고 간다. 이름만으로 이동하지 않는다.
import { prisma } from '../prisma';
import { officetelFallbackDisplayName } from './detail-contract';
import { normalizeOfficetelSearchKeyword, normalizeOfficetelSearchName, rankOfficetelMatches } from './search-contract';

export interface OfficetelSearchResult {
  type: 'OFFICETEL';
  /** 정확한 identity — 이동은 반드시 이 값으로 한다. */
  officetelId: number;
  canonicalKey: string;
  /** 표시 전용 라벨. 이름이 비어 있으면 "법정동 지번 오피스텔"로 대체한다(DB 미저장). */
  displayName: string;
  /** 원본 표시명. 비어 있으면 null — 이름이 없다는 사실을 감추지 않는다. */
  rawName: string | null;
  sggCd: string;
  dong: string;
  jibun: string;
  buildingDong: string | null;
  roadAddress: string | null;
  hoCnt: number | null;
  buildYear: number | null;
  useApprovalDate: string | null;
}

const SEARCH_LIMIT = 8;

/**
 * 실제 저장된 master 값만으로 검색한다: 표시명 / 법정동 / 지번 / 도로명주소.
 * 좌표·거래 데이터는 검색에 쓰지 않는다(§2 — 추측 매칭 금지).
 */
export async function searchOfficetels(keyword: string): Promise<OfficetelSearchResult[]> {
  const kw = normalizeOfficetelSearchKeyword(keyword);
  if (kw.length < 2) return [];
  const kwName = normalizeOfficetelSearchName(keyword);
  const raw = keyword.trim();

  // "온천동 153" 처럼 주소를 여러 토큰으로 치는 실제 검색 습관을 지원한다.
  // 토큰 전부가 어딘가에는 걸려야 한다(AND of ORs) — 한 토큰만 맞는 넓은 결과를 막는다.
  const tokens = keyword.trim().split(/\s+/).filter((t) => t !== '');
  const tokenClauses =
    tokens.length > 1
      ? [{
          AND: tokens.map((t) => ({
            OR: [
              { normalizedUmdNm: { contains: t } },
              { normalizedJibun: { contains: t } },
              { jibun: { contains: t } },
              { officetelName: { contains: t } },
              { roadAddress: { contains: t } },
            ],
          })),
        }]
      : [];

  const rows = await prisma.officetelMaster.findMany({
    where: {
      OR: [
        { normalizedName: { contains: kwName } },
        { normalizedName: { contains: kw } },
        { officetelName: { contains: raw } },
        { normalizedUmdNm: { contains: raw } },
        { normalizedJibun: { contains: raw } },
        { jibun: { contains: raw } },
        { roadAddress: { contains: raw } },
        ...tokenClauses,
      ],
    },
    select: {
      id: true, canonicalKey: true, officetelName: true, normalizedName: true,
      sggCd: true, umdNm: true, normalizedUmdNm: true, jibun: true, normalizedJibun: true,
      buildingDong: true, roadAddress: true, hoCnt: true, buildYear: true, useApprovalDate: true,
    },
    // 5,056행 전체 테이블이라 take 없이 받아 티어 랭킹 후 상위 N만 응답한다
    // (아파트 검색이 take:50에서 exact match가 잘려나가던 문제를 이미 겪었다).
  });

  return rankOfficetelMatches(rows, keyword, SEARCH_LIMIT).map((m) => ({
    type: 'OFFICETEL' as const,
    officetelId: m.id,
    canonicalKey: m.canonicalKey,
    displayName: officetelFallbackDisplayName({ officetelName: m.officetelName, umdNm: m.umdNm, jibun: m.jibun }),
    rawName: m.officetelName.trim() === '' ? null : m.officetelName,
    sggCd: m.sggCd,
    dong: m.umdNm,
    jibun: m.jibun,
    buildingDong: m.buildingDong,
    roadAddress: m.roadAddress,
    hoCnt: m.hoCnt,
    buildYear: m.buildYear,
    useApprovalDate: m.useApprovalDate,
  }));
}
