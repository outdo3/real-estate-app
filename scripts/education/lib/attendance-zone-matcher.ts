// SCHOOL V2-C6-A — point-in-polygon 매칭 및 아파트 상태 분류 순수 함수.
// c6a-10-busan-full-pipeline.ts에서 재사용. turf.js 기반, DB/네트워크 접근 없음
// (fixture로 바로 테스트 가능).
import * as turf from '@turf/turf';

export type ApartmentZoneStatus =
  | 'MATCHED_SINGLE'
  | 'MATCHED_SHARED'
  | 'OVERLAP'
  | 'NO_MATCH'
  | 'COORDINATE_MISSING'
  | 'IDENTITY_UNRESOLVED';

export type ZoneFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

export interface MatchableZoneGroup {
  zoneId: string;
  isShared: boolean;
  bbox: [number, number, number, number];
  parts: ZoneFeature[];
}

// bbox 사전 필터(정확도 손실 없음) 후 실제 polygon 판정. turf.booleanPointInPolygon
// 기본 동작대로 경계선 위 점은 "내부"로 취급한다(ignoreBoundary 미지정 — 명시적 정책).
export function matchPointToZones(lng: number, lat: number, zoneGroups: MatchableZoneGroup[]): string[] {
  const pt = turf.point([lng, lat]);
  const matched: string[] = [];
  for (const zg of zoneGroups) {
    if (lng < zg.bbox[0] || lng > zg.bbox[2] || lat < zg.bbox[1] || lat > zg.bbox[3]) continue;
    const inside = zg.parts.some((part) => turf.booleanPointInPolygon(pt, part as any));
    if (inside) matched.push(zg.zoneId);
  }
  return matched;
}

export interface ZoneIdentitySummary {
  isShared: boolean;
  allSchoolsHighConfidence: boolean; // 해당 zone에 연결된 모든 학교가 HIGH일 때만 true
}

// 여러 zone이 매칭됐다면(OVERLAP)이 최우선 — identity 상태와 무관하게 지오메트리
// 자체의 이상 신호이므로 가장 먼저 보고돼야 한다.
export function classifyApartmentZoneStatus(matchedZoneIds: string[], zoneSummaries: Map<string, ZoneIdentitySummary>): ApartmentZoneStatus {
  if (matchedZoneIds.length === 0) return 'NO_MATCH';
  if (matchedZoneIds.length > 1) return 'OVERLAP';

  const summary = zoneSummaries.get(matchedZoneIds[0]);
  if (!summary) return 'IDENTITY_UNRESOLVED';
  if (!summary.allSchoolsHighConfidence) return 'IDENTITY_UNRESOLVED';
  return summary.isShared ? 'MATCHED_SHARED' : 'MATCHED_SINGLE';
}
