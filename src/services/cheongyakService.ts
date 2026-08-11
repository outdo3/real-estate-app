// 한국부동산원 청약홈(Applyhome) 분양정보 공공데이터 수집 파이프라인.
//
// ⚠️ 주의: 이 파일은 데이터를 파싱해 Presale에 upsert하는 구조를 미리 잡아둔 "스텁"이다.
// 청약홈 공공데이터(data.go.kr "한국부동산원_청약홈 분양정보 조회 서비스")의 실제 엔드포인트
// URL과 응답 필드명은 이 세션에서 라이브 호출로 검증하지 못했다 — 아래 ENDPOINT/필드명은
// 공개 문서 기준으로 작성했지만, 실제 연동 전에 반드시 data.go.kr에서 발급받은 서비스
// 문서로 필드명을 재확인해야 한다(다른 공공데이터 API들도 이 프로젝트에서 실측 없이는
// 필드명이 자주 틀렸던 전례가 있다 — api/apt/[name]/route.ts 등의 주석 참고).
import { PresaleHouseType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const API_KEY = process.env.DATA_GO_KR_API_KEY || '';

// 한국부동산원 청약홈 "APT 분양정보 상세" 서비스 — 공공데이터포털 문서 기준 엔드포인트.
const APPLYHOME_ENDPOINT = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail';

interface ApplyhomeItem {
  HOUSE_MANAGE_NO?: string;
  PBLANC_NO?: string;
  HOUSE_NM?: string;
  HOUSE_SECD_NM?: string; // "아파트" | "오피스텔" | "도시형생활주택" 등
  HSSPLY_ADRES?: string;
  TOT_SUPLY_HSHLDCO?: string | number;
  CNSTRCT_ENTRPS_NM?: string;
  RCRIT_PBLANC_DE?: string; // 모집공고일 YYYY-MM-DD
  SUBSCRPT_RCEPT_BGNDE?: string; // 청약접수 시작일
  SUBSCRPT_RCEPT_ENDDE?: string; // 청약접수 종료일
  PRZWNER_PRESNATN_DE?: string; // 당첨자발표일
  LTTOT_PBLANC_URL?: string;
}

function mapHouseType(secdNm?: string): PresaleHouseType {
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

export interface CheongyakSyncResult {
  fetched: number;
  upserted: number;
  skipped: number;
  error?: string;
}

// 최신 공고 페이지를 조회해 Presale 테이블에 upsert한다. houseManageNo(주택관리번호)를
// 안정적인 키로 쓴다 — 청약홈이 같은 공고를 여러 번 내려줘도(재조회) 중복 생성되지 않는다.
export async function syncApplyhomeListings(page = 1, perPage = 50): Promise<CheongyakSyncResult> {
  if (!API_KEY) {
    return { fetched: 0, upserted: 0, skipped: 0, error: 'DATA_GO_KR_API_KEY가 설정되지 않았습니다.' };
  }

  try {
    const cleanKey = encodeURIComponent(decodeURIComponent(API_KEY.trim().replace(/['"]/g, '')));
    const url = `${APPLYHOME_ENDPOINT}?serviceKey=${cleanKey}&page=${page}&perPage=${perPage}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return { fetched: 0, upserted: 0, skipped: 0, error: `청약홈 API 응답 오류 (${res.status})` };
    }
    const json = await res.json();
    const items: ApplyhomeItem[] = Array.isArray(json?.data) ? json.data : [];

    let upserted = 0;
    let skipped = 0;

    for (const item of items) {
      if (!item.HOUSE_NM) {
        skipped += 1;
        continue;
      }

      const totalHouseholds = item.TOT_SUPLY_HSHLDCO != null ? parseInt(String(item.TOT_SUPLY_HSHLDCO), 10) : null;

      const data = {
        pblancNo: item.PBLANC_NO,
        houseName: item.HOUSE_NM,
        houseType: mapHouseType(item.HOUSE_SECD_NM),
        locationAddress: item.HSSPLY_ADRES,
        totalSupplyHouseholds: totalHouseholds != null && !isNaN(totalHouseholds) ? totalHouseholds : null,
        constructCompany: item.CNSTRCT_ENTRPS_NM,
        announcementDate: parseDate(item.RCRIT_PBLANC_DE),
        receiptStartDate: parseDate(item.SUBSCRPT_RCEPT_BGNDE),
        receiptEndDate: parseDate(item.SUBSCRPT_RCEPT_ENDDE),
        winnerDate: parseDate(item.PRZWNER_PRESNATN_DE),
        pblancUrl: item.LTTOT_PBLANC_URL,
      };

      if (item.HOUSE_MANAGE_NO) {
        await prisma.presale.upsert({
          where: { houseManageNo: item.HOUSE_MANAGE_NO },
          create: { houseManageNo: item.HOUSE_MANAGE_NO, ...data },
          update: data,
        });
      } else {
        // 관리번호가 없으면 안정적인 upsert 키가 없다 — 같은 공고명으로 중복 생성되는
        // 것을 막기 위해 새 행 생성 대신 건너뛴다(지어낸 키로 잘못 매칭하지 않는다).
        skipped += 1;
        continue;
      }
      upserted += 1;
    }

    return { fetched: items.length, upserted, skipped };
  } catch (e: any) {
    console.error('청약홈 데이터 수집 실패', e);
    return { fetched: 0, upserted: 0, skipped: 0, error: e?.message || '알 수 없는 오류' };
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
