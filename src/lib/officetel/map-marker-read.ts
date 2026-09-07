// OFFICETEL_MAP_LAYER_V1 §4 — 오피스텔 지도 마커 READ 계층(읽기 전용).
//
// 시군구(lawdCd = sggCd) 하나 분량만 조회한다 — 아파트 레이어가 이미 lawdCd 단위로
// 마커를 받는 것과 **같은 뷰포트 모델**이라 새 아키텍처를 만들지 않는다(§5).
// 부산 최대 구는 부산진구 845건(실측)이라 한 번의 응답이 그보다 커지지 않는다.
//
// master 테이블만 읽는다. 거래 이력은 조인하지 않는다(§4) — 마커에 가격을 싣지 않기 때문.
import { prisma } from '../prisma';
import { officetelFallbackDisplayName } from './detail-contract';
import { buildOfficetelMapMarker, type OfficetelMapMarker } from './map-marker-contract';

export interface OfficetelMarkerPayload {
  lawdCd: string;
  markers: OfficetelMapMarker[];
  /** 이 구의 master 총 수. 아래 excludedNoCoordinate와 합쳐 "왜 개수가 다른가"를 설명한다. */
  masterCount: number;
  /** 저장 좌표가 없어 지도에 올릴 수 없는 master 수(§11). 런타임 지오코딩은 하지 않는다. */
  excludedNoCoordinate: number;
}

export async function getOfficetelMarkersByLawdCd(lawdCd: string): Promise<OfficetelMarkerPayload> {
  const rows = await prisma.officetelMaster.findMany({
    where: { sggCd: lawdCd },
    select: {
      id: true,
      canonicalKey: true,
      officetelName: true,
      umdNm: true,
      jibun: true,
      buildingDong: true,
      roadAddress: true,
      hoCnt: true,
      latitude: true,
      longitude: true,
    },
    // sggCd는 @@index([sggCd, normalizedUmdNm, normalizedJibun])의 prefix로 커버된다.
  });

  const markers: OfficetelMapMarker[] = [];
  for (const row of rows) {
    const marker = buildOfficetelMapMarker(
      row,
      officetelFallbackDisplayName({ officetelName: row.officetelName, umdNm: row.umdNm, jibun: row.jibun })
    );
    if (marker) markers.push(marker);
  }

  return {
    lawdCd,
    markers,
    masterCount: rows.length,
    excludedNoCoordinate: rows.length - markers.length,
  };
}
