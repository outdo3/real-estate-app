import * as turf from '@turf/turf';
import { loadAllZones, filterBusan, ZoneRecord } from './lib/attendance-zone-source';

const BASE = 'D:/anti2/aaa/schoolzone-data/extracted';

// 부산 bounds(대략, 실측 좌표 확인용 — 엄격한 행정경계 아님, sanity check 목적)
const BUSAN_BOUNDS = { minLng: 128.65, maxLng: 129.35, minLat: 34.85, maxLat: 35.45 };

function toFeature(z: ZoneRecord) {
  return z.geometry.type === 'Polygon' ? turf.polygon(z.geometry.coordinates) : turf.multiPolygon(z.geometry.coordinates);
}

function audit(label: string, zones: ZoneRecord[], opts: { skipExpensive?: boolean } = {}) {
  let valid = 0,
    invalid = 0,
    empty = 0,
    hasHoles = 0,
    multiPoly = 0,
    selfIntersect = 0,
    outsideBusanBounds = 0;
  const zoneIdCounts = new Map<string, number>();
  const invalidSamples: string[] = [];
  const outsideSamples: string[] = [];

  for (const z of zones) {
    zoneIdCounts.set(z.zoneId, (zoneIdCounts.get(z.zoneId) || 0) + 1);

    const coordsFlat =
      z.geometry.type === 'Polygon' ? z.geometry.coordinates : z.geometry.coordinates.flat();
    if (coordsFlat.length === 0 || coordsFlat.every((ring: any) => ring.length === 0)) {
      empty++;
      continue;
    }

    if (z.geometry.type === 'MultiPolygon') multiPoly++;
    if (z.geometry.type === 'Polygon' && z.geometry.coordinates.length > 1) hasHoles++;
    if (z.geometry.type === 'MultiPolygon' && z.geometry.coordinates.some((p) => p.length > 1)) hasHoles++;

    let feature;
    try {
      feature = toFeature(z);
    } catch (e) {
      invalid++;
      if (invalidSamples.length < 10) invalidSamples.push(`${z.zoneId} ${z.zoneName}: construct error ${e}`);
      continue;
    }

    if (!opts.skipExpensive) {
      let isValid = false;
      try {
        isValid = turf.booleanValid(feature);
      } catch (e) {
        isValid = false;
      }
      if (isValid) valid++;
      else {
        invalid++;
        if (invalidSamples.length < 10) invalidSamples.push(`${z.zoneId} ${z.zoneName}`);
      }

      try {
        const k = turf.kinks(feature as any);
        if (k.features.length > 0) selfIntersect++;
      } catch {
        /* kinks는 Polygon만 지원 — MultiPolygon은 스킵(별도 표기) */
      }
    }

    const bbox = turf.bbox(feature);
    if (
      bbox[0] < BUSAN_BOUNDS.minLng ||
      bbox[2] > BUSAN_BOUNDS.maxLng ||
      bbox[1] < BUSAN_BOUNDS.minLat ||
      bbox[3] > BUSAN_BOUNDS.maxLat
    ) {
      outsideBusanBounds++;
      if (outsideSamples.length < 10) outsideSamples.push(`${z.zoneId} ${z.zoneName} bbox=${JSON.stringify(bbox)}`);
    }
  }

  const duplicateZoneIds = [...zoneIdCounts.entries()].filter(([, c]) => c > 1);

  console.log(`\n=== ${label} (n=${zones.length}) ${opts.skipExpensive ? '[valid/kinks 생략 — 전국 스케일 비용 문제, 부산 subset에서 전량 실행]' : ''} ===`);
  if (!opts.skipExpensive) {
    console.log('valid:', valid, 'invalid:', invalid, 'empty:', empty);
    console.log('self-intersection(kinks, Polygon만):', selfIntersect);
    if (invalidSamples.length) console.log('invalid samples:', invalidSamples);
  } else {
    console.log('empty:', empty, '(valid/invalid/kinks는 부산 subset 결과 참고)');
  }
  console.log('multiPolygon:', multiPoly, 'hasHoles(2+ring/part):', hasHoles);
  console.log('부산 bounds 밖(sanity, 행정경계 아닌 근사치):', outsideBusanBounds);
  console.log('중복 zoneId(같은 학구가 여러 polygon part로 분리된 경우 포함, 정상일 수 있음):', duplicateZoneIds.length);
  if (outsideSamples.length) console.log('outside-bounds samples:', outsideSamples);
}

async function main() {
  const elemAll = await loadAllZones(`${BASE}/elementary/초등학교통학구역.shp`, `${BASE}/elementary/초등학교통학구역.dbf`);
  const elemBusan = filterBusan(elemAll);
  audit('전국 초등학교통학구역(경량 스캔)', elemAll, { skipExpensive: true });
  audit('부산 초등학교통학구역(전량 정밀 검사)', elemBusan);

  const midAll = await loadAllZones(`${BASE}/middle/중학교학교군.shp`, `${BASE}/middle/중학교학교군.dbf`);
  const midBusan = filterBusan(midAll);
  audit('전국 중학교학교군(경량 스캔)', midAll, { skipExpensive: true });
  audit('부산 중학교학교군(전량 정밀 검사)', midBusan);
}
main().catch(console.error);
