// 한국부동산원 청약홈(Applyhome) 분양정보 공공데이터 수집 파이프라인.
//
// P2-B(2026-08-12) 개정: P1/P2-A에서 실측 검증된 필드명·단위·정책을 반영해 재작성했다.
// - receiptStartDate/receiptEndDate ← RCEPT_BGNDE/RCEPT_ENDDE (구 SUBSCRPT_RCEPT_* 필드명은
//   실제로 존재하지 않는 필드였다 — P2-A에서 50건 표본으로 이 두 필드가 특별공급/1·2순위·
//   지역별 세분화 접수기간 9종의 min/max와 정확히 일치함을 확인했다)
// - pblancUrl ← PBLANC_URL (구 LTTOT_PBLANC_URL도 존재하지 않는 필드였다)
// - houseSecd/houseSecdName, rentSecd/rentSecdName, subscriptionAreaCode/Name,
//   businessEntityName, moveInExpectedYm, contractStartDate/EndDate — API 원본값을
//   훼손 없이 별도 컬럼에 보존(P2-A 정책)
// - getAPTLttotPblancMdl(주택형별 상세) 연동 추가 — LTTOT_TOP_AMOUNT는 만원 단위의 해당
//   주택형 최고 분양가임을 실제 공고 3건을 언론 보도와 교차검증해 확정했다(P2-A §G)
// - generalSupply/specialSupply ← SUPLY_HSHLDCO/SPSPLY_HSHLDCO. GNRL_HSHLDCO 필드는 실제
//   API에 존재하지 않음을 라이브 재확인했다(P2-B 검수 보완). totalSupply는 API 원본이
//   아니라 두 값의 산술 합이며, Presale.totalSupplyHouseholds(Detail의 TOT_SUPLY_HSHLDCO)와
//   강제로 일치시키지 않는다(서로 다른 의미일 수 있음 — 신혼희망타운 2건에서 실측 확인).
//
// P2-C(2026-08-12) 개정: 운영 가능한 동기화 체계로 확장했다.
// - RCRIT_PBLANC_DE(모집공고일) 기준 서버사이드 날짜 필터(cond[FIELD::GTE/LTE])를 라이브로
//   검증해(예: GTE 2026-08-01 → matchCount 7, LTE 2020-12-31 → matchCount 644) 초기/증분
//   동기화 모두 이 필터로 구현했다 — 클라이언트에서 전체를 받아 걸러내지 않는다.
// - 한 건 처리 실패가 전체 배치를 중단시키지 않도록 아이템 단위 try/catch를 추가했다.
// - 지오코딩 실패 주소("일원"/택지지구/블록 표기)에 대한 단계적 fallback + 시/도 일치 검증을
//   추가했다(§ 아래 geocodeAddress 참고, P2-A/P2-B에서 실패했던 3개 주소로 실측 검증).
import { PresaleHouseType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logServerError } from '@/lib/log-server-error';

// 모듈 로드 시점이 아니라 호출 시점에 읽는다 — src/lib/apt-building-info.ts와 동일한
// 이유: 이 값을 모듈 최상단 const로 캐싱하면, dotenv로 환경변수를 로드하는 일회성
// 스크립트(scripts/sync_presales_test.ts 등)에서 import 호이스팅 때문에 dotenv.config()가
// 실행되기 전에 이 값이 먼저(빈 값으로) 확정돼버리는 문제가 있다(실제로 겪음).
function getApiKey(): string {
  return process.env.DATA_GO_KR_API_KEY || '';
}

// 한국부동산원 청약홈 "APT 분양정보 상세"/"APT 주택형별 상세" 서비스 — P1/P2-A에서 실제
// 라이브 호출로 정상 응답(HTTP 200, 실 데이터)을 확인했다.
const APPLYHOME_DETAIL_ENDPOINT = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail';
const APPLYHOME_MDL_ENDPOINT = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl';

// 관리자 수동 동기화 한 번 호출로 2,843건 전체 + Mdl 수천 건을 무제한 호출하는 구조를
// 만들지 않기 위한 하드 캡 — 요청한 limit이 이보다 크면 이 값으로 강제로 잘린다.
const MAX_SYNC_LIMIT = 200;
const DEFAULT_SYNC_LIMIT = 30;
const DEFAULT_INCREMENTAL_DAYS = 90;
const DEFAULT_INITIAL_YEARS = 3;

interface ApplyhomeDetailItem {
  HOUSE_MANAGE_NO?: string;
  PBLANC_NO?: string;
  HOUSE_NM?: string;
  HOUSE_SECD?: string;
  HOUSE_SECD_NM?: string; // 실측: "APT" | "신혼희망타운" 등 — "오피스텔"/"도시형" 한글 풀네임은 이 endpoint에서 관측되지 않음(P2-A)
  RENT_SECD?: string;
  RENT_SECD_NM?: string; // 실측: "분양주택" | "분양전환 가능임대" 등
  HSSPLY_ADRES?: string;
  SUBSCRPT_AREA_CODE?: string;
  SUBSCRPT_AREA_CODE_NM?: string;
  TOT_SUPLY_HSHLDCO?: string | number;
  CNSTRCT_ENTRPS_NM?: string; // 시공사
  BSNS_MBY_NM?: string; // 사업주체(시행사) — 시공사와 별개
  RCRIT_PBLANC_DE?: string; // 모집공고일
  RCEPT_BGNDE?: string; // 청약접수 시작일(전체 대표값, P2-A 확인)
  RCEPT_ENDDE?: string; // 청약접수 종료일(전체 대표값)
  PRZWNER_PRESNATN_DE?: string; // 당첨자발표일
  CNTRCT_CNCLS_BGNDE?: string; // 계약체결 시작일
  CNTRCT_CNCLS_ENDDE?: string; // 계약체결 종료일
  MVN_PREARNGE_YM?: string; // 입주예정월, "YYYYMM"
  PBLANC_URL?: string;
}

interface ApplyhomeMdlItem {
  HOUSE_MANAGE_NO?: string;
  PBLANC_NO?: string;
  MODEL_NO?: string;
  HOUSE_TY?: string;
  SUPLY_AR?: string | number;
  SUPLY_HSHLDCO?: number; // 일반공급 세대수
  SPSPLY_HSHLDCO?: number; // 특별공급 세대수
  LTTOT_TOP_AMOUNT?: string | number; // 만원 단위, 해당 주택형 분양 최고가(P2-A 실측 검증)
}

function mapHouseType(secdNm?: string): PresaleHouseType {
  // 호환성 유지용 최소 매핑이다 — 신뢰할 수 있는 원본 분류는 houseSecd/houseSecdName을
  // 사용할 것. P2-A에서 이 API(APT 전용 endpoint)는 "APT"/"신혼희망타운" 값만 관측됐고
  // "오피스텔"/"도시형생활주택" 값은 원천적으로 나오지 않는 것으로 확인됐다(별도 API 계열
  // 필요, 이번 STEP 범위 밖). 아래 문자열 검사는 향후 다른 값이 관측될 가능성에 대비한
  // 방어적 처리일 뿐, 현재 표본 근거로 신뢰할 수 있는 분류 로직은 아니다.
  if (!secdNm) return PresaleHouseType.APT;
  if (secdNm.includes('오피스텔')) return PresaleHouseType.OFFICETEL;
  if (secdNm.includes('도시형')) return PresaleHouseType.URBAN;
  if (secdNm.includes('잔여') || secdNm.includes('무순위')) return PresaleHouseType.REMAIN;
  return PresaleHouseType.APT;
}

function parseDate(raw?: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function parseIntSafe(raw?: string | number | null): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace(/,/g, ''), 10);
  return isNaN(n) ? null : n;
}

function parseFloatSafe(raw?: string | number | null): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return isNaN(n) ? null : n;
}

// "YYYY-MM-DD" 형식으로 오늘로부터 offsetDays일 전 날짜를 반환한다(음수면 미래).
function isoDateOffset(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

// ── 지오코딩 ──────────────────────────────────────────────────────────────
//
// P2-C 검수 보완(2026-08-12): "좌표 없음보다 잘못된 좌표가 더 위험하다"는 원칙에 따라
// 정확도 기준을 강화했다. 4단계 fallback 중 1~3차(원본/괄호제거/일원제거)는 번지(지번)를
// 그대로 유지한 채 문자열만 정리하는 것이라 Kakao가 매칭에 성공하면 여전히 "그 필지"의
// 정확한 좌표다 — 이 결과는 저장한다('exact'/'normalized'). 반면 4차(시/도+시/군/구+
// 읍/면/동까지만)는 번지를 완전히 버리므로, Kakao가 반환하는 좌표는 사업지 자체가 아니라
// 그 동/읍/면의 대표(중심) 좌표다 — 행정구역이 맞다고 해서 "그 사업지의 좌표"라고 볼 수
// 없다. 그래서 4차 결과는 지역 검증을 통과해도 latitude/longitude에 저장하지 않는다
// ('area_only'로만 분류해 통계에는 남기되 좌표는 null 유지) — 100% 성공률을 목표로 하지
// 않는다.

export type GeocodeCategory = 'exact' | 'normalized' | 'area_only';

export interface GeocodeResult {
  lat: number;
  lng: number;
  category: GeocodeCategory;
}

// 원본 주소에서 "시/도 + 시/군/구"까지만 추출한다(읍/면/동 이전에서 멈춤) — Kakao 응답
// 검증의 기준값으로 쓴다. 시/도만으로는 검증이 느슨하다는 지적(P2-C 검수)에 따라, 원본
// 주소에 시/군/구 정보가 있으면 그것까지 기준에 포함시킨다.
function extractExpectedSidoSigungu(addr: string): { sido: string | null; sigungu: string | null } {
  const tokens = addr.split(/\s+/).map((t) => t.replace(/[,()（）]/g, ''));
  let sido: string | null = null;
  const sigunguParts: string[] = [];
  for (const t of tokens) {
    if (!t) continue;
    if (/(읍|면|동)$/.test(t)) break; // 읍/면/동에 도달하면 시군구 추출은 끝(그 이전 토큰들만 시군구).
    if (/(시|도|군|구)$/.test(t)) {
      if (!sido) sido = t;
      else sigunguParts.push(t);
      continue;
    }
    break;
  }
  return { sido, sigungu: sigunguParts.length > 0 ? sigunguParts.join(' ') : null };
}

// Kakao 응답의 행정구역을 원본 주소에서 뽑은 기준값과 비교한다. 시/도만 비교하던 것에서
// "원본에 시/군/구 정보가 있으면 시/군/구까지 일치해야 한다"로 강화했다(P2-C 검수) —
// 시/도만 같고 시/군/구가 다르면(예: 같은 "경기도"의 다른 시) 더 이상 성공으로 보지 않는다.
function validateRegion(
  kakaoRegion1: string | undefined,
  kakaoRegion2: string | undefined,
  expected: { sido: string | null; sigungu: string | null }
): boolean {
  if (!expected.sido) return true; // 비교 기준 자체가 없으면 검증을 건너뛴다(실패로 간주하지 않음).
  if (!kakaoRegion1) return false;
  const sidoOk = kakaoRegion1.includes(expected.sido) || expected.sido.includes(kakaoRegion1);
  if (!sidoOk) return false;
  if (!expected.sigungu) return true; // 원본에 시/군/구 정보가 없으면(드묾) 시/도 일치로 충분.
  if (!kakaoRegion2) return false;
  return kakaoRegion2.includes(expected.sigungu) || expected.sigungu.includes(kakaoRegion2) || expected.sigungu.split(' ').every((p) => kakaoRegion2.includes(p));
}

async function kakaoAddressSearch(query: string): Promise<{ lat: number; lng: number; region1: string | undefined; region2: string | undefined } | null> {
  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  if (!kakaoKey || !query.trim()) return null;
  try {
    const headers = {
      Authorization: `KakaoAK ${kakaoKey}`,
      KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
      Origin: 'http://localhost:3000',
    };
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const doc = data.documents?.[0];
    if (!doc) return null;
    const lat = parseFloat(doc.y);
    const lng = parseFloat(doc.x);
    if (isNaN(lat) || isNaN(lng)) return null;
    const region1: string | undefined = doc.address?.region_1depth_name || doc.road_address?.region_1depth_name;
    const region2: string | undefined = doc.address?.region_2depth_name || doc.road_address?.region_2depth_name;
    return { lat, lng, region1, region2 };
  } catch (e) {
    console.warn('Kakao 주소 검색 실패', e);
    return null;
  }
}

// 괄호(및 안의 설명) 제거 — 예: "...5204-1번지 일원(행정중심복합도시 5-2생활권 S1BL)" → "...5204-1번지 일원"
function stripParenthetical(addr: string): string {
  return addr.replace(/[\(（][^)）]*[\)）]/g, '').trim();
}

// "일원" 토큰 제거 — 예: "...번지 일원 시흥거모 공공주택지구..." → "...번지 시흥거모 공공주택지구..."
function stripIlwon(addr: string): string {
  return addr.replace(/\s*일원\s*/g, ' ').trim();
}

// 시/도 + 시/군/구 + 읍/면/동까지만 추출한다(번지·지구·블록명은 버림) — 가장 거친 fallback.
// 토큰을 앞에서부터 훑어 "시/도/군/구" 접미사인 동안 계속 포함시키고, "읍/면/동" 접미사를
// 만나면 그것까지 포함한 뒤 멈춘다(그 이후 토큰은 지구명/블록명 등 비주소 텍스트로 간주).
// 읍/면/동에 끝내 도달하지 못하면(=시/도 또는 시/군/구 수준까지만 남는 경우) null을 반환한다
// — "세종특별자치시"나 "용인시 처인구"처럼 사업 위치를 전혀 특정할 수 없는 수준의 질의는
// 아예 시도하지 않는다(P2-C 검수: 광범위 fallback 금지).
function extractCoarseAddress(addr: string): string | null {
  const tokens = addr.split(/\s+/).map((t) => t.replace(/[,()（）]/g, ''));
  const result: string[] = [];
  for (const t of tokens) {
    if (!t) continue;
    if (/(읍|면|동)$/.test(t)) {
      result.push(t);
      return result.join(' '); // 읍/면/동까지 도달해야만 유효한 fallback 후보로 인정.
    }
    if (/(시|도|군|구)$/.test(t)) {
      result.push(t);
      continue;
    }
    break; // 접미사가 맞지 않는 토큰(번지, 지구명 등)을 만나면 중단.
  }
  return null; // 읍/면/동에 도달하지 못함 — 너무 광범위해 사용하지 않는다.
}

// 분양 주소 문자열 → 좌표. 새 지도 API를 추가하지 않고, 이 프로젝트가 이미 여러 곳에서
// 쓰는 Kakao Local 주소 검색 API를 동일한 인증 방식(KA/Origin 헤더 우회, 실측으로 검증된
// 방식 — src/app/api/school/stats/route.ts의 구 중심좌표 조회, src/lib/geocode-apt.ts 등과
// 동일한 패턴)으로 재사용한다.
//
// 4단계 fallback(P2-C에서 실제 실패 3건으로 검증됨):
//   1차: 원본 HSSPLY_ADRES 그대로               → 성공 시 category 'exact'
//   2차: 괄호(부연설명) 제거                     → 성공 시 category 'normalized'
//   3차: "일원" 제거                             → 성공 시 category 'normalized'
//   4차: 시/도+시/군+구+읍/면/동까지만(번지·지구·블록명 버림) → 성공해도 category
//        'area_only'일 뿐, 호출부는 이 결과를 latitude/longitude에 저장하지 않는다
//        (행정구역 중심 좌표는 "그 사업지의 좌표"가 아니기 때문).
// 각 단계에서 결과를 얻으면 원본 주소 기준 시/도(+시/군/구, 있으면 필수)와 일치하는지
// 검증하고(불일치 시 버리고 다음 단계), 전부 실패/불일치하면 null을 반환한다.
export async function geocodeAddress(address: string, expectedSido: string | null): Promise<GeocodeResult | null> {
  if (!address) return null;

  const expected = extractExpectedSidoSigungu(address);
  // Detail API가 제공하는 SUBSCRPT_AREA_CODE_NM(시/도)이 있으면 우선하고, 없으면 주소
  // 문자열 자체에서 뽑은 시/도로 대체한다.
  const expectedForValidation = { sido: expectedSido || expected.sido, sigungu: expected.sigungu };

  const withoutParen = stripParenthetical(address);
  const withoutIlwon = stripIlwon(withoutParen);
  const coarse = extractCoarseAddress(withoutIlwon);

  const candidates: { query: string; category: GeocodeCategory }[] = [{ query: address, category: 'exact' }];
  if (withoutParen !== address) candidates.push({ query: withoutParen, category: 'normalized' });
  if (withoutIlwon !== withoutParen) candidates.push({ query: withoutIlwon, category: 'normalized' });
  if (coarse) candidates.push({ query: coarse, category: 'area_only' });

  for (const { query, category } of candidates) {
    const result = await kakaoAddressSearch(query);
    if (!result) continue;
    if (!validateRegion(result.region1, result.region2, expectedForValidation)) {
      console.warn(`분양 주소 지오코딩: 지역 불일치로 거부 (query="${query}", kakao="${result.region1} ${result.region2}", expected="${expectedForValidation.sido} ${expectedForValidation.sigungu}")`);
      continue;
    }
    return { lat: result.lat, lng: result.lng, category };
  }
  return null;
}

// ── 동기화 옵션/결과 타입 ────────────────────────────────────────────────

export interface SyncOptions {
  mode?: 'incremental' | 'initial';
  fromDate?: string; // "YYYY-MM-DD", RCRIT_PBLANC_DE 기준
  toDate?: string;
  limit?: number; // 처리할 최대 공고 수(안전장치, MAX_SYNC_LIMIT으로 강제 클램프)
  dryRun?: boolean; // true면 DB에 쓰지 않고 무엇이 생성/갱신될지만 미리 계산
}

// 'exact'/'normalized'만 실제로 latitude/longitude에 저장된다. 'area_only'는 지역은
// 맞지만 행정구역 중심 좌표라 저장하지 않은 경우, 'preserved_existing'은 이번엔 실패했지만
// 기존에 저장돼 있던 값을 그대로 둔 경우, 'failed'는 아무 결과도 얻지 못한 경우다.
export interface SyncItemResult {
  houseManageNo: string;
  houseName: string;
  status: 'created' | 'updated' | 'failed' | 'skipped' | 'would_create' | 'would_update';
  error?: string;
  mdlUpserted?: number;
  mdlFailed?: boolean;
  geocode?: 'exact' | 'normalized' | 'area_only' | 'preserved_existing' | 'failed' | 'no_address';
}

export interface CheongyakSyncResult {
  startedAt: string;
  finishedAt: string;
  mode: 'incremental' | 'initial';
  dryRun: boolean;
  fromDate: string | null;
  toDate: string | null;
  matchCount: number; // 이 조건에 해당하는 전체 공고 수(API totalCount/matchCount)
  fetched: number; // 실제로 조회해 처리를 시도한 건수(limit로 제한됨)
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  houseTypeDetailsUpserted: number;
  mdlFailedCount: number;
  geocodeExact: number; // 원본 주소 그대로 성공(번지 단위 정확도)
  geocodeNormalized: number; // 괄호/"일원" 제거 후 성공(번지는 유지 — 여전히 필지 단위 정확도)
  geocodeAreaOnly: number; // 시/도+시/군/구+읍/면/동까지만 성공 — 정확도 부족으로 저장하지 않음
  geocodeFailed: number; // 어떤 단계에서도 신뢰 가능한 결과를 얻지 못함
  items: SyncItemResult[];
  error?: string; // fatal(전체 중단) 오류만 — 개별 아이템 실패는 items[].error에 기록
}

function emptyResult(startedAt: string, options: Required<Pick<SyncOptions, 'mode' | 'dryRun'>> & SyncOptions): CheongyakSyncResult {
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    mode: options.mode,
    dryRun: options.dryRun,
    fromDate: options.fromDate ?? null,
    toDate: options.toDate ?? null,
    matchCount: 0,
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    houseTypeDetailsUpserted: 0,
    mdlFailedCount: 0,
    geocodeExact: 0,
    geocodeNormalized: 0,
    geocodeAreaOnly: 0,
    geocodeFailed: 0,
    items: [],
  };
}

// 청약홈 공고를 조회해 Presale + PresaleHouseTypeDetail에 upsert한다.
// houseManageNo(주택관리번호)를 안정적인 키로 쓴다 — 같은 공고를 여러 번 조회해도(재실행,
// 증분 동기화의 겹치는 기간 등) 중복 생성되지 않는다.
//
// mode:
//   'initial'     — 초기 적재. fromDate/toDate를 명시하지 않으면 기본값(최근 3년,
//                    DEFAULT_INITIAL_YEARS)을 사용한다.
//   'incremental' — 운영 중 증분 갱신. fromDate를 명시하지 않으면 기본값(최근 90일,
//                    DEFAULT_INCREMENTAL_DAYS)을 사용한다. 청약홈 API에는 수정일/변경일
//                    필드가 없어(P2-C에서 확인) "최근 모집공고일 재조회" 방식을 쓴다 — 진행
//                    중인 공고는 모집공고일이 이 기간 안에 있는 한 계속 최신 상태로 갱신된다.
//
// limit은 항상 MAX_SYNC_LIMIT(200)로 클램프된다 — 관리자가 큰 값을 요청해도 한 번의 호출로
// 무제한 수집되지 않는다. 전체 범위를 채우려면 이 함수를 여러 번(페이지를 옮겨가며) 호출해야
// 한다 — 이번 STEP에서는 그런 반복 호출 자동화(cron 등)를 구현하지 않는다.
export async function syncApplyhomeListings(options: SyncOptions = {}): Promise<CheongyakSyncResult> {
  const startedAt = new Date().toISOString();
  const mode = options.mode ?? 'incremental';
  const dryRun = options.dryRun ?? false;
  const limit = Math.min(options.limit ?? DEFAULT_SYNC_LIMIT, MAX_SYNC_LIMIT);

  const fromDate = options.fromDate ?? (mode === 'incremental' ? isoDateOffset(DEFAULT_INCREMENTAL_DAYS) : isoDateOffset(DEFAULT_INITIAL_YEARS * 365));
  const toDate = options.toDate ?? null;

  const resolvedOptions = { mode, dryRun, fromDate, toDate: toDate ?? undefined, limit };
  const empty = emptyResult(startedAt, resolvedOptions);

  const apiKey = getApiKey();
  if (!apiKey) {
    return { ...empty, finishedAt: new Date().toISOString(), error: 'DATA_GO_KR_API_KEY가 설정되지 않았습니다.' };
  }

  try {
    const cleanKey = encodeURIComponent(decodeURIComponent(apiKey.trim().replace(/['"]/g, '')));

    // limit을 넘지 않는 선에서 필요한 만큼만 페이지네이션한다(perPage 50 고정, 최대 4페이지
    // = 200건 = MAX_SYNC_LIMIT). 날짜 필터는 API 서버사이드에 적용한다(cond[FIELD::OP]) —
    // 클라이언트에서 전체를 받아 거르지 않는다(P2-C에서 실제 라이브 호출로 필터 동작 검증됨).
    const perPage = 50;
    const allItems: ApplyhomeDetailItem[] = [];
    let matchCount = 0;
    let page = 1;

    while (allItems.length < limit) {
      let url = `${APPLYHOME_DETAIL_ENDPOINT}?serviceKey=${cleanKey}&page=${page}&perPage=${perPage}`;
      url += `&cond%5BRCRIT_PBLANC_DE%3A%3AGTE%5D=${fromDate}`;
      if (toDate) url += `&cond%5BRCRIT_PBLANC_DE%3A%3ALTE%5D=${toDate}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        return { ...empty, finishedAt: new Date().toISOString(), error: `청약홈 API 응답 오류 (${res.status})` };
      }
      const json = await res.json();
      matchCount = typeof json?.matchCount === 'number' ? json.matchCount : matchCount;
      const pageItems: ApplyhomeDetailItem[] = Array.isArray(json?.data) ? json.data : [];
      if (pageItems.length === 0) break;

      allItems.push(...pageItems);
      if (pageItems.length < perPage) break; // 마지막 페이지
      page += 1;
    }

    const items = allItems.slice(0, limit);

    const result: CheongyakSyncResult = { ...empty, matchCount, fetched: items.length };

    for (const item of items) {
      if (!item.HOUSE_NM || !item.HOUSE_MANAGE_NO) {
        // 관리번호가 없으면 안정적인 upsert 키가 없다 — 지어낸 키로 매칭하지 않고 skip.
        result.skipped += 1;
        result.items.push({ houseManageNo: item.HOUSE_MANAGE_NO || '(없음)', houseName: item.HOUSE_NM || '(이름 없음)', status: 'skipped' });
        continue;
      }

      // 아이템 하나의 처리 실패가 나머지 배치를 중단시키지 않도록 개별적으로 감싼다.
      // DB 연결 자체가 끊기는 등 계속 진행이 위험한 오류는 바깥의 fatal try/catch가 잡는다
      // (Prisma 클라이언트가 연결 실패 시 매 호출마다 예외를 던지므로, 개별 catch에 걸려도
      // 같은 오류가 반복되며 failed 카운트만 계속 늘 뿐 서비스가 멈추지는 않는다 — 이번
      // STEP에서는 "연속 실패 N회 시 중단" 같은 별도 회로차단기까지는 구현하지 않았다).
      try {
        const houseManageNo = item.HOUSE_MANAGE_NO;
        const existing = await prisma.presale.findUnique({
          where: { houseManageNo },
          select: { id: true, latitude: true, longitude: true },
        });
        const isNew = !existing;

        if (dryRun) {
          result.items.push({ houseManageNo, houseName: item.HOUSE_NM, status: isNew ? 'would_create' : 'would_update' });
          if (isNew) result.created += 1;
          else result.updated += 1;
          continue;
        }

        // 기존 좌표(enrichment)는 이번 지오코딩이 실패했다고(또는 area_only로만 나왔다고)
        // 임의로 null로 덮어쓰지 않는다 — 기존 값을 기본값으로 삼고, 'exact'/'normalized'
        // (필지 단위 정확도로 검증된 경우)만 교체한다.
        let latitude: number | null = existing?.latitude ?? null;
        let longitude: number | null = existing?.longitude ?? null;
        let geocodeStatus: SyncItemResult['geocode'] = 'no_address';

        if (item.HSSPLY_ADRES) {
          const geo = await geocodeAddress(item.HSSPLY_ADRES, item.SUBSCRPT_AREA_CODE_NM ?? null);
          if (geo && geo.category !== 'area_only') {
            // exact/normalized — 번지 단위 정확도가 유지된 결과만 실제로 저장한다.
            latitude = geo.lat;
            longitude = geo.lng;
            geocodeStatus = geo.category;
            if (geo.category === 'exact') result.geocodeExact += 1;
            else result.geocodeNormalized += 1;
          } else if (geo && geo.category === 'area_only') {
            // 지역은 맞지만 행정구역 중심 좌표라 "그 사업지의 좌표"로 볼 수 없다 — 저장하지
            // 않는다(정확도 우선 원칙). 기존 좌표가 있었다면 그대로 유지, 없었다면 null 유지.
            geocodeStatus = 'area_only';
            result.geocodeAreaOnly += 1;
          } else if (existing?.latitude != null) {
            geocodeStatus = 'preserved_existing';
            result.geocodeFailed += 1;
          } else {
            geocodeStatus = 'failed';
            result.geocodeFailed += 1;
          }
        }

        const data = {
          pblancNo: item.PBLANC_NO ?? null,
          houseName: item.HOUSE_NM,
          houseType: mapHouseType(item.HOUSE_SECD_NM),
          houseSecd: item.HOUSE_SECD ?? null,
          houseSecdName: item.HOUSE_SECD_NM ?? null,
          rentSecd: item.RENT_SECD ?? null,
          rentSecdName: item.RENT_SECD_NM ?? null,
          locationAddress: item.HSSPLY_ADRES ?? null,
          subscriptionAreaCode: item.SUBSCRPT_AREA_CODE ?? null,
          subscriptionAreaName: item.SUBSCRPT_AREA_CODE_NM ?? null,
          latitude,
          longitude,
          totalSupplyHouseholds: parseIntSafe(item.TOT_SUPLY_HSHLDCO),
          constructCompany: item.CNSTRCT_ENTRPS_NM ?? null,
          businessEntityName: item.BSNS_MBY_NM ?? null,
          announcementDate: parseDate(item.RCRIT_PBLANC_DE),
          receiptStartDate: parseDate(item.RCEPT_BGNDE),
          receiptEndDate: parseDate(item.RCEPT_ENDDE),
          winnerDate: parseDate(item.PRZWNER_PRESNATN_DE),
          contractStartDate: parseDate(item.CNTRCT_CNCLS_BGNDE),
          contractEndDate: parseDate(item.CNTRCT_CNCLS_ENDDE),
          moveInExpectedYm: item.MVN_PREARNGE_YM ?? null,
          pblancUrl: item.PBLANC_URL ?? null,
        };

        const presale = await prisma.presale.upsert({
          where: { houseManageNo },
          create: { houseManageNo, ...data },
          update: data,
        });
        if (isNew) result.created += 1;
        else result.updated += 1;

        // 주택형별(Mdl) 데이터 연동 + minPrice/maxPrice 집계. Mdl 실패는 Presale 저장과
        // 완전히 분리돼 있다 — 아래 syncHouseTypeDetails는 실패해도 예외를 던지지 않고
        // failed 플래그만 반환하므로, 이미 upsert된 Presale 행은 그대로 유지된다.
        const mdl = await syncHouseTypeDetails(presale.id, houseManageNo, cleanKey);
        result.houseTypeDetailsUpserted += mdl.upserted;
        if (mdl.failed) result.mdlFailedCount += 1;

        if (mdl.prices.length > 0) {
          await prisma.presale.update({
            where: { id: presale.id },
            data: { minPrice: Math.min(...mdl.prices), maxPrice: Math.max(...mdl.prices) },
          });
        }
        // 가격 정보가 하나도 없으면 minPrice/maxPrice는 손대지 않는다(0으로 임의 변환 금지).

        result.items.push({
          houseManageNo,
          houseName: item.HOUSE_NM,
          status: isNew ? 'created' : 'updated',
          mdlUpserted: mdl.upserted,
          mdlFailed: mdl.failed,
          geocode: geocodeStatus,
        });
      } catch (e: any) {
        result.failed += 1;
        const message = e?.message || '알 수 없는 오류';
        result.items.push({ houseManageNo: item.HOUSE_MANAGE_NO!, houseName: item.HOUSE_NM!, status: 'failed', error: message });
        logServerError(`Presale sync 항목 실패: ${item.HOUSE_MANAGE_NO} ${item.HOUSE_NM} — ${message}`, '/api/admin/presales/sync').catch(() => {});
      }
    }

    result.finishedAt = new Date().toISOString();
    return result;
  } catch (e: any) {
    console.error('청약홈 데이터 수집 실패', e);
    return { ...empty, finishedAt: new Date().toISOString(), error: e?.message || '알 수 없는 오류' };
  }
}

// 한 공고(houseManageNo)의 주택형별 데이터를 조회해 PresaleHouseTypeDetail에 upsert한다.
// 실패해도 예외를 던지지 않는다 — 호출부(syncApplyhomeListings)가 이미 Presale을 upsert한
// 뒤이므로, 여기서 예외가 전파되면 방금 저장한 부모 공고까지 no-op 취급될 위험이 있다.
async function syncHouseTypeDetails(
  presaleId: number,
  houseManageNo: string,
  cleanKey: string
): Promise<{ upserted: number; prices: number[]; failed: boolean }> {
  try {
    const url = `${APPLYHOME_MDL_ENDPOINT}?serviceKey=${cleanKey}&page=1&perPage=20&cond%5BHOUSE_MANAGE_NO%3A%3AEQ%5D=${encodeURIComponent(houseManageNo)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { upserted: 0, prices: [], failed: true };
    const json = await res.json();
    const items: ApplyhomeMdlItem[] = Array.isArray(json?.data) ? json.data : [];

    let upserted = 0;
    const prices: number[] = [];

    for (const item of items) {
      if (!item.MODEL_NO) {
        // MODEL_NO 없는 비정상 레코드 — 임의 ID를 만들지 않고 skip.
        console.warn(`Presale Mdl: MODEL_NO 없는 레코드 skip (houseManageNo=${houseManageNo})`);
        continue;
      }

      const supplyArea = parseFloatSafe(item.SUPLY_AR);
      const generalSupply = typeof item.SUPLY_HSHLDCO === 'number' ? item.SUPLY_HSHLDCO : parseIntSafe(item.SUPLY_HSHLDCO as any);
      const specialSupply = typeof item.SPSPLY_HSHLDCO === 'number' ? item.SPSPLY_HSHLDCO : parseIntSafe(item.SPSPLY_HSHLDCO as any);
      // totalSupply는 API 원본 필드가 아니라 두 값의 단순 합산이다(둘 다 있을 때만 계산) —
      // Presale.totalSupplyHouseholds(Detail의 TOT_SUPLY_HSHLDCO)와는 강제로 일치시키지
      // 않는다. 신혼희망타운 등에서 실제로 다를 수 있음을 P2-B 검수에서 실측 확인했다.
      const totalSupply = generalSupply != null && specialSupply != null ? generalSupply + specialSupply : null;
      const topAmount = parseIntSafe(item.LTTOT_TOP_AMOUNT);

      await prisma.presaleHouseTypeDetail.upsert({
        where: { houseManageNo_modelNo: { houseManageNo, modelNo: item.MODEL_NO } },
        create: {
          presaleId,
          houseManageNo,
          modelNo: item.MODEL_NO,
          houseTy: item.HOUSE_TY ?? null,
          supplyArea,
          generalSupply,
          specialSupply,
          totalSupply,
          topAmount,
        },
        update: {
          houseTy: item.HOUSE_TY ?? null,
          supplyArea,
          generalSupply,
          specialSupply,
          totalSupply,
          topAmount,
        },
      });
      upserted += 1;
      if (topAmount != null) prices.push(topAmount);
    }

    return { upserted, prices, failed: false };
  } catch (e) {
    console.warn('청약홈 주택형별 데이터 수집 실패', e);
    return { upserted: 0, prices: [], failed: true };
  }
}

export type PresaleStatus = 'upcoming' | 'ongoing' | 'closed' | 'unsold';

// receiptStartDate/receiptEndDate 기준으로 현재 진행 상태를 계산한다(별도 status 컬럼을
// 안 두는 이유: 날짜만 있으면 항상 파생 가능한 값이라 컬럼으로 따로 저장하면 매일 배치로
// 갱신해줘야 하는 불일치 위험이 생긴다).
export function computePresaleStatus(p: { houseType: PresaleHouseType; receiptStartDate: Date | null; receiptEndDate: Date | null }): PresaleStatus {
  if (p.houseType === PresaleHouseType.REMAIN) return 'unsold';
  const now = new Date();
  if (p.receiptStartDate && now < p.receiptStartDate) return 'upcoming';
  if (p.receiptStartDate && p.receiptEndDate && now >= p.receiptStartDate && now <= p.receiptEndDate) return 'ongoing';
  if (p.receiptEndDate && now > p.receiptEndDate) return 'closed';
  return 'upcoming';
}
