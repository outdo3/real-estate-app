// SCHOOL DATA BACKFILL V1 — 학교알리미(schoolinfo.go.kr) OpenAPI 얇은 fetch wrapper.
// scripts/education/c2b-verify-schoolinfo-api.ts가 이미 실측 확인한 것과 동일한
// endpoint/파라미터 구조를 재사용한다(새 integration을 중복 구현하지 않음, §4 지시).
// 서버 전용(SCHOOLINFO_API_KEY가 필요) — client bundle에 포함되면 안 된다.

if (typeof window !== 'undefined') {
  throw new Error('schoolinfo-client.ts는 서버 전용입니다 — client component에서 import하지 마세요.');
}

const BASE_URL = 'http://www.schoolinfo.go.kr/openApi.do';

// apiType=0(학교기본정보, 좌표/주소/폐교여부 포함), apiType=09(학년별·학급별
// 학생수 — TEACH_CNT/TEACH_CAL도 함께 포함돼 있어 교원현황을 별도 apiType으로
// 다시 조회할 필요가 없다, §6 실측 확인).
export type SchoolInfoApiType = '0' | '09';

// NEIS School.schoolLevel(원문 그대로 저장된 한글 값) → schoolinfo schulKndCode.
// 이 4개 외 학교급(평생학교/각종학교/방송통신/외국인학교/공동실습소 등)은
// schoolinfo가 별도 코드로 다루지 않는 것으로 실측 확인됐다(§6 지시,
// 존재하지 않는 코드로 억지로 조회 금지) — NO_SOURCE로 정직하게 남긴다.
export const SCHUL_KND_SC_CODE_BY_LEVEL: Record<string, string> = {
  초등학교: '02',
  중학교: '03',
  고등학교: '04',
  특수학교: '05',
};

export interface SchoolInfoBasicRecord {
  SCHUL_NM: string;
  SCHUL_CODE: string; // schoolinfo 자체 식별자 — NEIS SD_SCHUL_CODE와 다르다(crosswalk 불가, 실측 확인)
  SCHUL_KND_SC_CODE: string;
  ADRCD_CD: string; // 앞 5자리가 법정동 시군구코드(School.sigunguCode와 동일 체계)
  ADRCD_NM: string;
  ADRES_BRKDN?: string; // 전체 주소(동명이교 disambiguation용) — 일부 레코드(구 이전/개편 이력)에는 필드 자체가 없을 수 있음(실측 확인)
  LTTUD: number | null;
  LGTUD: number | null;
  CLOSE_YN: string; // 'Y' | 'N'
  // 이전/개편으로 대체된 과거 레코드 여부. 'Y'면 같은 이름의 구 레코드(historical)라
  // 현재 유효한 학교로 취급하지 않는다(실측: 강서구 송정초등학교/대저중앙초등학교/
  // 경일중학교가 전부 ABSCH_YN='Y' 구 레코드 + 'N' 현재 레코드 쌍으로 존재).
  ABSCH_YN?: string;
  FOND_SC_CODE: string | null;
  ATPT_OFCDC_ORG_CODE: string;
}

export interface SchoolInfoStatRecord {
  SCHUL_NM: string;
  SCHUL_CODE: string;
  SCHUL_KND_SC_CODE: string;
  ADRCD_NM: string;
  PBAN_EXCP_YN: string; // 'Y'면 공시 예외(비공개) — 통계 없음으로 처리
  COL_S_SUM: number | null; // 학생수 합계
  COL_C_SUM: number | null; // 학급수 합계
  TEACH_CNT: number | null; // 교원수
  COL_S1: number | null;
  COL_S2: number | null;
  COL_S3: number | null;
  COL_S4: number | null;
  COL_S5: number | null;
  COL_S6: number | null;
  COL_S7: number | null;
  COL_S8: number | null;
  COL_C1: number | null;
  COL_C2: number | null;
  COL_C3: number | null;
  COL_C4: number | null;
  COL_C5: number | null;
  COL_C6: number | null;
  COL_C7: number | null;
  COL_C8: number | null;
}

interface SchoolInfoResponse<T> {
  resultCode: string; // 'success' | 'fail'
  resultMsg: string;
  list?: T[];
}

export class SchoolInfoApiError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
  }
}

async function callSchoolInfoApi<T>(
  apiKey: string,
  apiType: SchoolInfoApiType,
  pbanYr: string,
  schulKndCode: string,
  sggCode: string
): Promise<{ ok: true; list: T[] } | { ok: false; noSource: boolean; message: string }> {
  const url = `${BASE_URL}?apiKey=${apiKey}&apiType=${apiType}&pbanYr=${pbanYr}&schulKndCode=${schulKndCode}&sidoCode=26&sggCode=${sggCode}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new SchoolInfoApiError(`network error: ${(e as Error).message}`, true);
  }
  if (!res.ok) {
    throw new SchoolInfoApiError(`HTTP ${res.status}`, true);
  }
  let json: SchoolInfoResponse<T>;
  try {
    json = await res.json();
  } catch (e) {
    throw new SchoolInfoApiError(`invalid JSON response: ${(e as Error).message}`, true);
  }
  if (json.resultCode !== 'success') {
    // "해당 시도 및 시군구에 데이터가 존재하지 않습니다" 류는 network 실패가 아니라
    // 정상 응답 + 데이터 없음(NO_SOURCE) — §20 지시대로 FAILED_RETRYABLE과 구분한다.
    return { ok: false, noSource: true, message: json.resultMsg };
  }
  return { ok: true, list: json.list || [] };
}

export function fetchSchoolInfoBasic(apiKey: string, pbanYr: string, schulKndCode: string, sggCode: string) {
  return callSchoolInfoApi<SchoolInfoBasicRecord>(apiKey, '0', pbanYr, schulKndCode, sggCode);
}

export function fetchSchoolInfoStat(apiKey: string, pbanYr: string, schulKndCode: string, sggCode: string) {
  return callSchoolInfoApi<SchoolInfoStatRecord>(apiKey, '09', pbanYr, schulKndCode, sggCode);
}
