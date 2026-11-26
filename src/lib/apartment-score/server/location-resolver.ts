import seoulLocationFeaturesRaw from '../data/seoul-location-features.json';
import type { RawLocationFeature } from './types';
import { collectLocationFeature } from '../collectors/location';

const seoulLocationCache: Record<string, any> = seoulLocationFeaturesRaw || {};
const inMemoryCache = new Map<string, RawLocationFeature>();
const inFlightMap = new Map<string, Promise<RawLocationFeature | null>>();

const FALLBACK_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout of ${timeoutMs}ms exceeded`)), timeoutMs)
    ),
  ]);
}

export async function resolveLocationFeature(
  aptSeq: string,
  coords?: { latitude: number | null; longitude: number | null } | null
): Promise<RawLocationFeature | null> {
  // 1. Check bundled Seoul location cache
  if (seoulLocationCache[aptSeq]) {
    return seoulLocationCache[aptSeq] as RawLocationFeature;
  }

  // 2. Check in-memory cache
  if (inMemoryCache.has(aptSeq)) {
    return inMemoryCache.get(aptSeq)!;
  }

  // 3. Deduplicate concurrent in-flight requests
  if (inFlightMap.has(aptSeq)) {
    return inFlightMap.get(aptSeq)!;
  }

  // 4. If coordinates are provided, collect on-demand with timeout and safeguards
  if (coords && coords.latitude && coords.longitude) {
    const fetchPromise = (async () => {
      try {
        const loc = await withTimeout(
          collectLocationFeature({
            aptSeq,
            latitude: coords.latitude!,
            longitude: coords.longitude!,
          }),
          FALLBACK_TIMEOUT_MS
        );
        const feature: RawLocationFeature = {
          aptSeq: loc.aptSeq,
          nearestSubwayDistanceM: loc.nearestSubwayDistanceM,
          subwayCount1000m: loc.subwayCount1000m,
          nearestBusStopDistanceM: loc.nearestBusStopDistanceM,
          busStopCount300m: loc.busStopCount300m,
          martCount1000m: loc.martCount1000m,
          convenienceCount500m: loc.convenienceCount500m,
          pharmacyCount500m: loc.pharmacyCount500m,
          hospitalCount1000m: loc.hospitalCount1000m,
          parkCount1000m: loc.parkCount1000m,
          daycareKindergartenCount500m: loc.daycareKindergartenCount500m,
          nearestElementaryDistanceM: loc.nearestElementaryDistanceM,
          elementaryCount1000m: loc.elementaryCount1000m,
          beachDistanceM: loc.beachDistanceM,
          qualityFlag: loc.qualityFlag,
          nearestSubwayName: loc.nearestSubwayName,
        };
        inMemoryCache.set(aptSeq, feature);
        return feature;
      } catch (err) {
        console.warn(`[resolveLocationFeature] Live Kakao POI collection failed for ${aptSeq}:`, (err as Error)?.message || err);
        return null;
      } finally {
        inFlightMap.delete(aptSeq);
      }
    })();

    inFlightMap.set(aptSeq, fetchPromise);
    return fetchPromise;
  }

  return null;
}
