// REALTOR_PRO_MVP_V1 — Pro 화면 공용 fetch 래퍼(클라이언트). 서버 응답 계약: { success, data } | { success:false, code, error, fields?, sensitiveFields? }.
// 이 파일은 서버 전용 모듈(crypto·runtime·repo·*-service)을 런타임에 import하지 않는다 — 타입만.

/** JSON으로 건너오면서 Date → string이 되는 모양. */
export type Wire<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends readonly (infer U)[]
      ? readonly Wire<U>[]
      : T extends object
        ? { [K in keyof T]: Wire<T[K]> }
        : T;

export interface ApiFailure {
  ok: false;
  status: number;
  code: string;
  error: string;
  fields?: { field: string; code: string }[];
  sensitiveFields?: string[];
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

export async function proFetch<T>(url: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<ApiResult<Wire<T>>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: init?.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { ok: false, status: 0, code: 'ABORTED', error: '' };
    return { ok: false, status: 0, code: 'NETWORK', error: '네트워크 연결을 확인해 주세요.' };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  if (res.ok && j.success === true) return { ok: true, data: j.data as Wire<T> };
  return {
    ok: false,
    status: res.status,
    code: typeof j.code === 'string' ? j.code : res.status === 401 ? 'LOGIN_REQUIRED' : 'SERVER_ERROR',
    error: typeof j.error === 'string' && j.error ? j.error : '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    fields: Array.isArray(j.fields) ? (j.fields as ApiFailure['fields']) : undefined,
    sensitiveFields: Array.isArray(j.sensitiveFields) ? (j.sensitiveFields as string[]) : undefined,
  };
}

const FIELD_LABELS: Record<string, string> = {
  displayName: '표시 이름',
  officeName: '사무소 이름',
  officePhone: '사무소 전화',
  officeAddress: '사무소 주소',
  licenseNumber: '자격번호',
  officeRegNo: '등록번호',
  businessRegNo: '사업자등록번호',
  agreeTerms: '약관 동의',
  aptNameSnapshot: '단지명',
  aptSeq: '단지',
  exclusiveAreaM2: '전용면적',
  dealType: '거래유형',
  askingPriceManwon: '매매가',
  depositManwon: '보증금',
  monthlyRentManwon: '월세',
  floor: '층',
  ownerPhone: '소유자 연락처',
  ownerName: '소유자 이름',
  memo: '메모',
  viewingNote: '방문 안내 메모',
  repairNote: '수리 메모',
  parkingNote: '주차 메모',
  tags: '태그',
  name: '이름',
  phone: '전화번호',
  email: '이메일',
  priority: '우선순위',
  dealTypes: '거래유형',
  budgetMinManwon: '최소 예산',
  budgetMaxManwon: '최대 예산',
  budgetTolerancePct: '예산 허용 폭',
  areaMinM2: '최소 면적',
  areaMaxM2: '최대 면적',
  commuteLat: '통근지 좌표',
  lawdCds: '지역 코드',
  aptSeqs: '단지',
  dueAt: '일정',
  customerId: '고객',
  listingId: '매물',
  expiresInDays: '유효기간',
  body: '노트',
  reason: '사유',
  status: '상태',
};

const CODE_LABELS: Record<string, string> = {
  REQUIRED: '필수 입력입니다',
  INVALID: '형식이 올바르지 않습니다',
  TOO_LONG: '너무 깁니다',
  TOO_MANY: '항목이 너무 많습니다',
  RANGE: '최솟값이 최댓값보다 큽니다',
  PAIR: '위도·경도를 함께 입력해야 합니다',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function describeFieldErrors(fields: ApiFailure['fields']): string[] {
  return (fields ?? []).map((f) => `${fieldLabel(f.field)}: ${CODE_LABELS[f.code] ?? f.code}`);
}
