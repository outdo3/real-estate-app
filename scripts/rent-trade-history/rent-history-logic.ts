// RENT_TRADE_HISTORY_V1 PHASE B — 순수 함수만 모아둔 정규화 로직(DB/네트워크 호출
// 없음, 전부 테스트 가능). scripts/rent-trade-history/rent-molit-fetch.ts가 raw XML을
// 파싱해 넘긴 원본 item(영문 필드명 그대로 — PHASE A phase-a-source-audit.ts로 실측
// 확인된 RTMSDataSvcAptRent 응답 스키마)을 ApartmentRentHistory row 입력 형태로
// 변환한다.
//
// identityKey/areaKey/groupKey는 scripts/trade-history-logic.ts(sale)와 동일한
// 정의이지만 dealType 값 집합만 다르다('jeonse'|'wolse'). 여기서도 import하지 않고
// 문자 그대로 복제한다 — 동일한 도구 제약(scripts/*.ts의 확장자 없는 상호 import를
// Node 네이티브 ESM 테스트 러너가 해석하지 못함) 때문이며, rent-history-logic.test.mjs가
// trade-history-logic.ts와 나란히 비교해 정의가 어긋나지 않는지 검증한다.
//
// § PHASE A §14 DIVERGENCE — sale의 identityKey()는 aptSeq가 없으면 "nd:{name}|{dong}"
// 폴백을 쓴다(이름 기반이지만 다른 아파트로 오인 연결하는 매칭이 아니라 그 row 자신만의
// no-aptSeq 식별 버킷). 하지만 이번 PHASE 작업 지시(§14)는 전월세에 한해 aptSeq 없는
// row를 폴백 없이 "blocked"로 명시 요구했고, PHASE A §10 실측(5개구 100% aptSeq 존재)도
// 이 정책의 실질 비용이 0에 가까움을 뒷받침한다 — 그래서 classifyInvalid()가 aptSeq
// 누락을 MISSING_APTSEQ invalid로 걸러내며, 이 필터를 통과한 row는 항상 aptSeq가 있으므로
// identityKey()의 nd: 분기는 rent 정규화 경로에서 실제로는 절대 타지 않는다(sale과의
// 정의 동일성 자체는 유지하되, 호출 전 단계에서 이미 차단).
export interface RentFeedIdentityShape {
  aptSeq: string | null;
  name: string;
  dong: string;
  excluUseArea: number | null;
  dealType: 'jeonse' | 'wolse';
}

export function identityKey(t: Pick<RentFeedIdentityShape, 'aptSeq' | 'name' | 'dong'>): string {
  return t.aptSeq ? `id:${t.aptSeq}` : `nd:${t.name}|${t.dong}`;
}

export function areaKey(t: Pick<RentFeedIdentityShape, 'excluUseArea'>): string {
  return t.excluUseArea != null ? t.excluUseArea.toString() : 'unknown';
}

export function groupKey(t: Pick<RentFeedIdentityShape, 'aptSeq' | 'name' | 'dong' | 'excluUseArea' | 'dealType'>): string {
  return `${identityKey(t)}::${areaKey(t)}::${t.dealType}`;
}

// PHASE A §4 — 검증된 분류 규칙(2,543건 실측: 0건의 모순 사례). 재계산 없이 ingestion
// 시점에 1회만 결정한다(모델 주석과 동일 원칙).
export function classifyRentType(monthlyRent: number): 'jeonse' | 'wolse' {
  return monthlyRent > 0 ? 'wolse' : 'jeonse';
}

// RTMSDataSvcAptRent raw 응답 item(파싱 전 XML→JSON 변환 직후, 필드 가공 없음).
// 필드명은 phase-a-source-audit.ts(§ PHASE A)로 실측된 실제 영문 키 그대로다.
export interface RawMolitRentItem {
  aptSeq?: string | number | null;
  aptNm?: string;
  umdNm?: string;
  jibun?: string | number;
  excluUseAr?: string | number;
  floor?: string | number;
  buildYear?: string | number;
  dealYear?: string | number;
  dealMonth?: string | number;
  dealDay?: string | number;
  deposit?: string | number;
  monthlyRent?: string | number;
  contractType?: string;
  contractTerm?: string;
  preDeposit?: string | number;
  preMonthlyRent?: string | number;
  useRRRight?: string;
}

export interface RentRowInput {
  lawdCd: string;
  dealYmd: string;
  aptSeq: string; // classifyInvalid가 이미 누락을 걸러냄(MISSING_APTSEQ) — 항상 존재
  identityKey: string;
  dealType: 'jeonse' | 'wolse';
  groupKeyStr: string;
  aptName: string;
  dong: string;
  jibun: string | null;
  exclusiveArea: number;
  deposit: number;
  monthlyRent: number;
  dealYear: number;
  dealMonth: number;
  dealDay: number;
  dealDate: string; // "YYYY-MM-DD"
  floor: number;
  buildYear: number | null;
  contractType: string | null;
  contractTerm: string | null;
  preDeposit: number | null;
  preMonthlyRent: number | null;
  useRenewalRight: boolean | null; // null=미기재(UNKNOWN), true=사용 확인. false는 절대 만들지 않음(PHASE A §12)
  occurrenceIndex: number;
}

export type InvalidReason =
  | 'MISSING_APTSEQ' // §14 — name fallback 금지, blocked
  | 'MISSING_MONEY' // deposit 또는 monthlyRent를 파싱할 수 없음(둘 다 필수 컬럼, NOT NULL)
  | 'MISSING_AREA'
  | 'MISSING_DATE'
  | 'MISSING_FLOOR'; // 자연키 구성요소라 null 저장 금지(sale과 동일 원칙, trade-history-logic.ts 참고)

export interface NormalizeResult {
  rows: RentRowInput[];
  invalid: { reason: InvalidReason; item: RawMolitRentItem }[];
}

// 만원 단위 원본 문자열/숫자를 정수로. 콤마 구분자 제거(PHASE A §5 — deposit은 콤마
// 포맷 관측, monthlyRent는 관측 안 됐지만 동일하게 방어적으로 처리). 값 자체가
// 없거나(undefined/null/빈문자열) 숫자로 해석 불가능하면 null(0으로 임의 대체 금지 —
// "0만원"과 "값 없음"은 다르다, §9).
function parseMoneyField(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const cleaned = String(raw).replace(/[\s,]/g, '');
  if (cleaned === '') return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloorToInt(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

function parseBuildYearToInt(raw: string | number | undefined | null): number | null {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonEmptyString(raw: string | undefined | null): string | null {
  const s = (raw ?? '').toString().trim();
  return s === '' ? null : s;
}

// PHASE A §12 — useRRRight는 '사용'일 때만 실제로 채워지고, 그 외(빈 문자열/미기재)는
// "미사용이 확인됨"이 아니라 "기록되지 않음"이다. false를 만들지 않는다.
function parseUseRenewalRight(raw: string | undefined): boolean | null {
  return (raw ?? '').toString().trim() === '사용' ? true : null;
}

function classifyInvalid(item: RawMolitRentItem): InvalidReason | null {
  const aptSeq = item.aptSeq != null ? String(item.aptSeq).trim() : '';
  if (!aptSeq) return 'MISSING_APTSEQ';

  const deposit = parseMoneyField(item.deposit);
  const monthlyRent = parseMoneyField(item.monthlyRent);
  if (deposit === null || monthlyRent === null) return 'MISSING_MONEY';

  const excluUseArea = item.excluUseAr !== undefined && item.excluUseAr !== '' ? parseFloat(String(item.excluUseAr)) : null;
  if (excluUseArea == null || !Number.isFinite(excluUseArea)) return 'MISSING_AREA';

  const y = parseInt(String(item.dealYear ?? ''), 10);
  const m = parseInt(String(item.dealMonth ?? ''), 10);
  const d = parseInt(String(item.dealDay ?? ''), 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) {
    return 'MISSING_DATE';
  }

  if (parseFloorToInt(item.floor) == null) return 'MISSING_FLOOR';

  return null;
}

/**
 * PHASE A §11 — 자연키(groupKey+deposit+monthlyRent+dealDate+floor) 안에서 실제로
 * 중복 존재하는 케이스가 153건 확인되어(MOLIT가 호실 번호를 공개하지 않음) 병합하지
 * 않고 MOLIT 응답 원본 등장 순서(0부터)를 최후 discriminator로 부여한다. sale과 동일한
 * 원칙(같은 lawdCd+dealYmd 응답 배열 안에서만 계산 — 배치를 넘어선 충돌 없음).
 */
export function normalizeMolitRentItemsToRentRows(items: RawMolitRentItem[], lawdCd: string, dealYmd: string): NormalizeResult {
  const invalid: NormalizeResult['invalid'] = [];
  const pending: Omit<RentRowInput, 'occurrenceIndex'>[] = [];

  for (const item of items) {
    const reason = classifyInvalid(item);
    if (reason) {
      invalid.push({ reason, item });
      continue;
    }

    const aptSeq = String(item.aptSeq).trim();
    const name = nonEmptyString(item.aptNm) ?? '';
    const dong = nonEmptyString(item.umdNm) ?? '';
    const excluUseArea = parseFloat(String(item.excluUseAr));
    const deposit = parseMoneyField(item.deposit) as number; // classifyInvalid가 이미 null 배제
    const monthlyRent = parseMoneyField(item.monthlyRent) as number;
    const dealType = classifyRentType(monthlyRent);
    const floor = parseFloorToInt(item.floor) as number; // classifyInvalid가 이미 null 배제

    const feedTrade: Pick<RentFeedIdentityShape, 'aptSeq' | 'name' | 'dong' | 'excluUseArea' | 'dealType'> = {
      aptSeq,
      name,
      dong,
      excluUseArea,
      dealType,
    };
    const idKey = identityKey(feedTrade);
    const grpKey = groupKey(feedTrade);

    const y = parseInt(String(item.dealYear), 10);
    const m = parseInt(String(item.dealMonth), 10);
    const d = parseInt(String(item.dealDay), 10);
    const dealDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    pending.push({
      lawdCd,
      dealYmd,
      aptSeq,
      identityKey: idKey,
      dealType,
      groupKeyStr: grpKey,
      aptName: name,
      dong,
      jibun: nonEmptyString(item.jibun != null ? String(item.jibun) : null),
      exclusiveArea: excluUseArea,
      deposit,
      monthlyRent,
      dealYear: y,
      dealMonth: m,
      dealDay: d,
      dealDate,
      floor,
      buildYear: parseBuildYearToInt(item.buildYear),
      contractType: nonEmptyString(item.contractType ?? null),
      contractTerm: nonEmptyString(item.contractTerm ?? null),
      preDeposit: parseMoneyField(item.preDeposit),
      preMonthlyRent: parseMoneyField(item.preMonthlyRent),
      useRenewalRight: parseUseRenewalRight(item.useRRRight),
    });
  }

  // § OCCURRENCE DETERMINISM — occurrenceIndex를 배열 등장 순서가 아니라 row 전체
  // 내용의 결정적 정렬 순서로 부여한다. API가 같은 데이터를 다른 순서로 돌려줘도
  // (원본/역순/셔플) 동일한 natural key(occurrenceIndex 포함) 집합이 나와야 재동기화
  // upsert가 안정적이다 — occurrenceGroupKey(자연키 전체) 밖의 필드까지 포함한 전체
  // 직렬화 문자열로 정렬하므로, 두 row가 진짜로 모든 필드가 동일한 경우(구분 불가능한
  // 완전 중복)를 제외하면 항상 같은 순서가 재현된다.
  const sorted = [...pending].sort((a, b) => {
    const ka = JSON.stringify(a);
    const kb = JSON.stringify(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const occurrenceCounters = new Map<string, number>();
  const rows: RentRowInput[] = sorted.map((row) => {
    const occurrenceGroupKey = `${row.groupKeyStr}|${row.deposit}|${row.monthlyRent}|${row.dealDate}|${row.floor}`;
    const occurrenceIndex = occurrenceCounters.get(occurrenceGroupKey) ?? 0;
    occurrenceCounters.set(occurrenceGroupKey, occurrenceIndex + 1);
    return { ...row, occurrenceIndex };
  });

  return { rows, invalid };
}
