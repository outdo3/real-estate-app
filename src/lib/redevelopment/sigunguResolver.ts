import { extractSigunguFromLocation } from './parse';
import { classifyLocationText } from './officeDetector';

// STEP R4.1 — 부산 343건 sigungu 해석 보정.
//
// R4는 location 텍스트에서 "OO구"/"OO군" 리터럴 문자열만 찾았다(148/343, 43%). 이번
// STEP은 이 프로젝트에 이미 존재하는 REGCODE_PROXY(src/lib/region-utils.ts가 이미
// 쓰는 공식 법정동코드 조회 서비스)를 재사용해 법정동명 기반으로 해석률을 높인다 —
// 새 외부 API를 추가하지 않는다(섹션 7 확인 결과).
const REGCODE_PROXY = 'https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes';

export interface DongEntry {
  code: string;
  sido: string;
  sigungu: string;
  dongName: string;
}

export type SigunguResolutionSource = 'EXPLICIT' | 'DONG_NAME' | 'ROAD_ADDRESS' | 'PROJECT_NAME' | 'UNRESOLVED';

export interface SigunguResolution {
  sigungu: string | null;
  source: SigunguResolutionSource;
  // ROAD_ADDRESS는 지오코딩된 주소가 조합사무실일 위험이 있어(R3A: 82%) 자동 matching
  // key로 바로 쓰기에 안전한지 별도로 표시한다(섹션 13) — office 의심 패턴이 함께
  // 감지되면 false.
  safeForMatching: boolean;
  detail?: string;
}

let dongRegistryCache: DongEntry[] | null = null;

// 부산광역시 전체 법정동을 한 번의 호출로 가져온다(구별로 나눠 부르지 않음 — quota
// 걱정 없는 단일 조회, region-utils.ts가 이미 이 프록시를 쓰는 것과 동일한 방식).
export async function fetchBusanDongRegistry(): Promise<DongEntry[]> {
  if (dongRegistryCache) return dongRegistryCache;

  const res = await fetch(`${REGCODE_PROXY}?regcode_pattern=26*&is_ignore_zero=true`);
  const data = await res.json();
  const entries: DongEntry[] = [];

  for (const r of (data.regcodes ?? []) as Array<{ code: string; name: string }>) {
    const parts = r.name.trim().split(/\s+/);
    if (parts.length < 3) continue; // "부산광역시 XX구"(구 레벨)는 제외, 동 레벨만 사용
    const [sido, sigungu, ...dongParts] = parts;
    entries.push({ code: r.code, sido, sigungu, dongName: dongParts.join(' ') });
  }

  dongRegistryCache = entries;
  return entries;
}

export function buildDongNameIndex(entries: DongEntry[]): { dongToSigungu: Map<string, Set<string>>; sortedDongNames: string[] } {
  const dongToSigungu = new Map<string, Set<string>>();
  for (const e of entries) {
    if (!dongToSigungu.has(e.dongName)) dongToSigungu.set(e.dongName, new Set());
    dongToSigungu.get(e.dongName)!.add(e.sigungu);
  }
  // 긴 이름부터 매칭해야 "남부민동"이 "부민동"의 부분집합으로 잘못 흡수되지 않는다.
  const sortedDongNames = [...dongToSigungu.keys()].sort((a, b) => b.length - a.length);
  return { dongToSigungu, sortedDongNames };
}

// location 텍스트 안에서 공식 법정동명을 찾아 sigungu를 판정한다. 서로 다른 구에
//속한 동 이름이 동시에 매칭되면(진짜 동명이인) 추측하지 않고 UNRESOLVED로 남긴다.
export function resolveByDongName(
  text: string,
  index: { dongToSigungu: Map<string, Set<string>>; sortedDongNames: string[] }
): SigunguResolution {
  const matchedSigungus = new Set<string>();
  const matchedDongs: string[] = [];

  for (const dongName of index.sortedDongNames) {
    if (text.includes(dongName)) {
      // 이미 더 긴(더 구체적인) 매칭에 포함된 부분 문자열이면 건너뛴다(남부민동 매칭 후 부민동 재매칭 방지).
      if (matchedDongs.some((m) => m.includes(dongName))) continue;
      matchedDongs.push(dongName);
      for (const sg of index.dongToSigungu.get(dongName)!) matchedSigungus.add(sg);
    }
  }

  if (matchedSigungus.size === 1) {
    return { sigungu: [...matchedSigungus][0], source: 'DONG_NAME', safeForMatching: true, detail: matchedDongs.join(',') };
  }
  if (matchedSigungus.size > 1) {
    return { sigungu: null, source: 'UNRESOLVED', safeForMatching: false, detail: `ambiguous: ${[...matchedSigungus].join('/')}` };
  }
  return { sigungu: null, source: 'UNRESOLVED', safeForMatching: false };
}

// areaName(사업명)에서 안전하게 지역을 추론한다 — "당리1", "덕천동 347-3번지 일원
// 가로주택정비" 같은 값에서 숫자/구역번호/괄호/유형접미사를 제거한 뒤, 결과가 실제
// 공식 법정동명과 "정확히" 일치할 때만 채택한다(fuzzy 매칭 금지 — "명서1"처럼 실제
// 법정동(명장동)과 글자 자체가 다른 경우는 의도적으로 UNRESOLVED로 남는다).
export function resolveByProjectName(
  areaName: string,
  index: { dongToSigungu: Map<string, Set<string>>; sortedDongNames: string[] }
): SigunguResolution {
  // 이미 "OO동"이 명시된 경우(예: "덕천동 347-3번지 일원 가로주택정비")는 dong-name
  // 매칭으로 커버되므로 여기서는 접미사가 없는 축약형만 다룬다.
  let candidate = areaName.trim();
  candidate = candidate.replace(/\([^)]*\)/g, ''); // 괄호 설명 제거
  candidate = candidate.replace(
    /(가로주택정비사업|소규모재건축사업|재건축정비사업|재개발정비사업|소규모재건축|가로주택정비|재건축사업|재개발사업|정비사업|재건축|재개발)\s*$/,
    ''
  );
  candidate = candidate.trim();
  // 끝의 구역번호(숫자, 숫자-숫자) 제거 — "당리1" -> "당리", "금곡2-1" -> "금곡"
  candidate = candidate.replace(/\d+(-\d+)?\s*$/, '').trim();
  if (!candidate) return { sigungu: null, source: 'UNRESOLVED', safeForMatching: false };

  for (const suffix of ['동', '가', '리']) {
    const full = `${candidate}${suffix}`;
    if (index.dongToSigungu.has(full)) {
      const sigungus = index.dongToSigungu.get(full)!;
      if (sigungus.size === 1) {
        return { sigungu: [...sigungus][0], source: 'PROJECT_NAME', safeForMatching: true, detail: full };
      }
    }
  }
  return { sigungu: null, source: 'UNRESOLVED', safeForMatching: false };
}

// 도로명 전용 주소(예: "구서중앙로 20")를 Kakao 주소 검색으로 지오코딩해 sigungu만
// 뽑는다(좌표/PROJECT_SITE 확정 목적이 아니다 — 섹션 9). 결과의 safeForMatching은
// location 텍스트가 office 의심 패턴(층/호/상가 등)과 함께 나타나면 false로 낮춘다 —
// 조합사무실이 사업구역과 다른 구에 있을 위험을 자동 matching에 흘려보내지 않기 위함.
export async function resolveByRoadAddress(locationText: string): Promise<SigunguResolution> {
  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  if (!kakaoKey || !locationText.trim()) return { sigungu: null, source: 'UNRESOLVED', safeForMatching: false };

  const query = `부산광역시 ${locationText}`;
  try {
    const headers = {
      Authorization: `KakaoAK ${kakaoKey}`,
      KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
      Origin: 'http://localhost:3000',
    };
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { sigungu: null, source: 'UNRESOLVED', safeForMatching: false, detail: `HTTP ${res.status}` };
    const data = await res.json();
    const doc = data.documents?.[0];
    const sigungu: string | undefined = doc?.address?.region_2depth_name || doc?.road_address?.region_2depth_name;
    if (!sigungu) return { sigungu: null, source: 'UNRESOLVED', safeForMatching: false };

    const officeCheck = classifyLocationText(locationText);
    const safeForMatching = officeCheck.locationType !== 'OFFICE';

    return { sigungu, source: 'ROAD_ADDRESS', safeForMatching, detail: safeForMatching ? undefined : 'office 의심 패턴과 동시 검출' };
  } catch (e) {
    return { sigungu: null, source: 'UNRESOLVED', safeForMatching: false, detail: String(e) };
  }
}

// 전체 우선순위(섹션 8): EXPLICIT -> DONG_NAME -> ROAD_ADDRESS -> PROJECT_NAME -> UNRESOLVED.
// ROAD_ADDRESS는 네트워크 호출이 필요해 비동기이고, 나머지는 동기라 먼저 시도해
// 불필요한 API 호출을 최소화한다.
export async function resolveBusanSigungu(
  areaName: string,
  locationText: string | null,
  index: { dongToSigungu: Map<string, Set<string>>; sortedDongNames: string[] }
): Promise<SigunguResolution> {
  if (locationText && locationText.trim()) {
    const explicit = extractSigunguFromLocation(locationText);
    if (explicit) return { sigungu: explicit, source: 'EXPLICIT', safeForMatching: true };

    const byDong = resolveByDongName(locationText, index);
    if (byDong.sigungu) return byDong;

    const byRoad = await resolveByRoadAddress(locationText);
    if (byRoad.sigungu) return byRoad;
  }

  const byProjectName = resolveByProjectName(areaName, index);
  if (byProjectName.sigungu) return byProjectName;

  return { sigungu: null, source: 'UNRESOLVED', safeForMatching: false };
}
