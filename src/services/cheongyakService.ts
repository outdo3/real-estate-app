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
import { PresaleHouseType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

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

// 분양 주소 문자열 → 좌표. 새 지도 API를 추가하지 않고, 이 프로젝트가 이미 여러 곳에서
// 쓰는 Kakao Local 주소 검색 API를 동일한 인증 방식(KA/Origin 헤더 우회, 실측으로 검증된
// 방식 — src/app/api/school/stats/route.ts의 구 중심좌표 조회, src/lib/geocode-apt.ts 등과
// 동일한 패턴)으로 재사용한다. "일원"/택지지구/블록 표기가 섞인 분양 주소는 실패할 수
// 있음을 P2-A에서 확인했다 — 실패 시 null을 반환하고, 호출부는 임의 좌표를 채우지 않는다.
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  if (!kakaoKey || !address) return null;

  try {
    const headers = {
      Authorization: `KakaoAK ${kakaoKey}`,
      KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
      Origin: 'http://localhost:3000',
    };
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`, {
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
    return { lat, lng };
  } catch (e) {
    console.warn('분양 주소 지오코딩 실패', e);
    return null;
  }
}

export interface CheongyakSyncResult {
  fetched: number;
  upserted: number;
  skipped: number;
  houseTypeDetailsUpserted: number;
  geocoded: number;
  geocodeFailed: number;
  error?: string;
}

// 최신 공고 페이지를 조회해 Presale + PresaleHouseTypeDetail에 upsert한다.
// houseManageNo(주택관리번호)를 안정적인 키로 쓴다 — 청약홈이 같은 공고를 여러 번
// 내려줘도(재조회) 중복 생성되지 않는다.
export async function syncApplyhomeListings(page = 1, perPage = 50): Promise<CheongyakSyncResult> {
  const empty: CheongyakSyncResult = { fetched: 0, upserted: 0, skipped: 0, houseTypeDetailsUpserted: 0, geocoded: 0, geocodeFailed: 0 };

  const apiKey = getApiKey();
  if (!apiKey) {
    return { ...empty, error: 'DATA_GO_KR_API_KEY가 설정되지 않았습니다.' };
  }

  try {
    const cleanKey = encodeURIComponent(decodeURIComponent(apiKey.trim().replace(/['"]/g, '')));
    const url = `${APPLYHOME_DETAIL_ENDPOINT}?serviceKey=${cleanKey}&page=${page}&perPage=${perPage}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      return { ...empty, error: `청약홈 API 응답 오류 (${res.status})` };
    }
    const json = await res.json();
    const items: ApplyhomeDetailItem[] = Array.isArray(json?.data) ? json.data : [];

    let upserted = 0;
    let skipped = 0;
    let houseTypeDetailsUpserted = 0;
    let geocoded = 0;
    let geocodeFailed = 0;

    for (const item of items) {
      if (!item.HOUSE_NM || !item.HOUSE_MANAGE_NO) {
        // 관리번호가 없으면 안정적인 upsert 키가 없다 — 지어낸 키로 매칭하지 않고 skip.
        skipped += 1;
        continue;
      }

      // 기존 좌표(enrichment)는 이번 지오코딩이 실패했다고 임의로 null로 덮어쓰지 않는다
      // — upsert 전에 기존 값을 먼저 조회해 기본값으로 삼는다.
      const existing = await prisma.presale.findUnique({
        where: { houseManageNo: item.HOUSE_MANAGE_NO },
        select: { latitude: true, longitude: true },
      });

      let latitude: number | null = existing?.latitude ?? null;
      let longitude: number | null = existing?.longitude ?? null;
      if (item.HSSPLY_ADRES) {
        const geo = await geocodeAddress(item.HSSPLY_ADRES);
        if (geo) {
          latitude = geo.lat;
          longitude = geo.lng;
          geocoded += 1;
        } else {
          geocodeFailed += 1;
          // latitude/longitude는 위에서 이미 기존값(or null)으로 초기화돼 있어 그대로 유지됨.
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
        where: { houseManageNo: item.HOUSE_MANAGE_NO },
        create: { houseManageNo: item.HOUSE_MANAGE_NO, ...data },
        update: data,
      });
      upserted += 1;

      // 주택형별(Mdl) 데이터 연동 + minPrice/maxPrice 집계.
      const mdl = await syncHouseTypeDetails(presale.id, item.HOUSE_MANAGE_NO, cleanKey);
      houseTypeDetailsUpserted += mdl.upserted;

      if (mdl.prices.length > 0) {
        await prisma.presale.update({
          where: { id: presale.id },
          data: { minPrice: Math.min(...mdl.prices), maxPrice: Math.max(...mdl.prices) },
        });
      }
      // 가격 정보가 하나도 없으면 minPrice/maxPrice는 손대지 않는다(0으로 임의 변환 금지,
      // 기존 값이 있었다면 유지, 신규 레코드면 컬럼 기본값인 null 그대로).
    }

    return { fetched: items.length, upserted, skipped, houseTypeDetailsUpserted, geocoded, geocodeFailed };
  } catch (e: any) {
    console.error('청약홈 데이터 수집 실패', e);
    return { ...empty, error: e?.message || '알 수 없는 오류' };
  }
}

// 한 공고(houseManageNo)의 주택형별 데이터를 조회해 PresaleHouseTypeDetail에 upsert한다.
async function syncHouseTypeDetails(
  presaleId: number,
  houseManageNo: string,
  cleanKey: string
): Promise<{ upserted: number; prices: number[] }> {
  try {
    const url = `${APPLYHOME_MDL_ENDPOINT}?serviceKey=${cleanKey}&page=1&perPage=20&cond%5BHOUSE_MANAGE_NO%3A%3AEQ%5D=${encodeURIComponent(houseManageNo)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { upserted: 0, prices: [] };
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
      // 원본에 없는 값을 추측한 게 아니라 저장된 두 숫자의 산술 합에 불과함을 분명히 한다.
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

    return { upserted, prices };
  } catch (e) {
    console.warn('청약홈 주택형별 데이터 수집 실패', e);
    return { upserted: 0, prices: [] };
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
