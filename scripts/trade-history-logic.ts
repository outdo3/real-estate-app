// TRADE_HISTORY_DATA_V1 — 순수 함수만 모아둔 정규화 로직(DB/네트워크 호출 없음, 전부
// 테스트 가능). fetchMolitData()가 이미 파싱한 item을 ApartmentTradeHistory row 입력
// 형태로 변환한다.
//
// identityKey/areaKey/groupKey는 src/lib/regional-feed.ts가 이미 확립한 정의를 그대로
// 옮겨온 것이다(import하지 않고 문자 그대로 복제 — tsc의 allowImportingTsExtensions
// 미설정 상태에서 scripts/*.ts가 서로를 확장자 없이 import하면 Node 네이티브 ESM
// 테스트 러너(--experimental-strip-types)가 해석하지 못하는 도구 제약 때문). 정의가
// 어긋나지 않도록 trade-history-logic.test.mjs가 두 정의를 나란히 import해 동일 입력에
// 대해 동일 출력을 내는지 매 테스트 실행마다 검증한다(§ PARITY TEST) — 라이브 통계
// 화면과 DB 저장 값이 항상 같은 identity 정의를 쓴다는 보장은 이 parity 테스트가
// 대신한다.
export interface FeedTradeIdentityShape {
  aptSeq: string | null;
  name: string;
  dong: string;
  excluUseArea: number | null;
  dealType: 'sale' | 'jeonse' | 'wolse';
}

export function identityKey(t: Pick<FeedTradeIdentityShape, 'aptSeq' | 'name' | 'dong'>): string {
  return t.aptSeq ? `id:${t.aptSeq}` : `nd:${t.name}|${t.dong}`;
}

export function areaKey(t: Pick<FeedTradeIdentityShape, 'excluUseArea'>): string {
  return t.excluUseArea != null ? t.excluUseArea.toString() : 'unknown';
}

export function groupKey(t: Pick<FeedTradeIdentityShape, 'aptSeq' | 'name' | 'dong' | 'excluUseArea' | 'dealType'>): string {
  return `${identityKey(t)}::${areaKey(t)}::${t.dealType}`;
}

type FeedTrade = FeedTradeIdentityShape;

export interface RawMolitAptItem {
  aptSeq: string | null;
  name: string;
  dong: string;
  jibun: string;
  excluUseArea: number | null;
  dealAmount: number;
  dealDate: string; // "YYYY-MM-DD"
  floorRaw: string | number | null;
  buildYear: string;
  dealCanceled: boolean;
  cancelDate: string;
  registryDate: string;
  id: string;
  typeLabel: string;
}

export interface TradeRowInput {
  lawdCd: string;
  dealYmd: string;
  aptSeq: string | null;
  identityKey: string;
  dealType: 'sale';
  groupKeyStr: string;
  aptName: string;
  dong: string;
  jibun: string | null;
  exclusiveArea: number;
  dealAmount: number;
  dealYear: number;
  dealMonth: number;
  dealDay: number;
  dealDate: string;
  floor: number;
  buildYear: number | null;
  dealCanceled: boolean;
  cancelDate: string | null;
  registryDate: string | null;
  occurrenceIndex: number;
  rawUid: string | null;
}

export type InvalidReason =
  | 'API_ERROR_PLACEHOLDER'
  | 'MISSING_AMOUNT'
  | 'MISSING_AREA'
  | 'MISSING_DATE'
  | 'MISSING_IDENTITY'
  | 'MISSING_FLOOR';

export interface NormalizeResult {
  rows: TradeRowInput[];
  invalid: { reason: InvalidReason; item: RawMolitAptItem }[];
}

const DEAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseFloorToInt(floorRaw: string | number | null): number | null {
  if (floorRaw === null || floorRaw === undefined || floorRaw === '') return null;
  const n = typeof floorRaw === 'number' ? floorRaw : parseInt(String(floorRaw), 10);
  return Number.isFinite(n) ? n : null;
}

function parseBuildYearToInt(buildYear: string): number | null {
  const n = parseInt(String(buildYear ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function classifyInvalid(item: RawMolitAptItem): InvalidReason | null {
  if (item.typeLabel === '에러') return 'API_ERROR_PLACEHOLDER';
  if (!(item.dealAmount > 0)) return 'MISSING_AMOUNT';
  if (item.excluUseArea == null || !Number.isFinite(item.excluUseArea)) return 'MISSING_AREA';
  if (!item.dealDate || !DEAL_DATE_RE.test(item.dealDate)) return 'MISSING_DATE';
  if (!item.aptSeq && !item.name) return 'MISSING_IDENTITY';
  // floor는 자연키(unique) 구성 요소라 null을 허용하면 Postgres가 동일 거래를 서로
  // 다른 행으로 취급(NULL != NULL)해 upsert 중복방지가 깨진다 — 실측(부산 서구 3개월
  // 250건)상 아파트 매매 실거래는 항상 층 값을 포함하므로, 파싱 불가 케이스는 존재해도
  // 극히 드물 것으로 보고 invalid로 분류해 스킵한다(값을 임의로 만들어 채우지 않음).
  if (parseFloorToInt(item.floorRaw) == null) return 'MISSING_FLOOR';
  return null;
}

/**
 * §6/§7 IDENTITY — 자연키(groupKey+금액+날짜+층) 안에서 실제로 중복 존재하는 케이스가
 * 있어(실측: 부산 서구 3개월 샘플, 243그룹 중 7개가 2건씩) 병합하지 않고 MOLIT 응답
 * 원본 등장 순서(0부터)를 최후 discriminator로 부여한다. 같은 lawdCd+dealYmd 응답
 * 배열 안에서만 계산한다(dealYmd는 항상 거래 자신의 연/월과 같으므로 자연키 충돌은
 * 항상 같은 fetch 배치 안에서만 일어난다 — 배치를 넘어선 occurrenceIndex 충돌 없음).
 */
export function normalizeMolitItemsToTradeRows(items: RawMolitAptItem[], lawdCd: string, dealYmd: string): NormalizeResult {
  const rows: TradeRowInput[] = [];
  const invalid: NormalizeResult['invalid'] = [];
  const occurrenceCounters = new Map<string, number>();

  for (const item of items) {
    const reason = classifyInvalid(item);
    if (reason) {
      invalid.push({ reason, item });
      continue;
    }

    const feedTrade: Pick<FeedTrade, 'aptSeq' | 'name' | 'dong' | 'excluUseArea' | 'dealType'> = {
      aptSeq: item.aptSeq,
      name: item.name,
      dong: item.dong || '',
      excluUseArea: item.excluUseArea,
      dealType: 'sale',
    };
    const idKey = identityKey(feedTrade);
    const grpKey = groupKey(feedTrade);

    const [yStr, mStr, dStr] = item.dealDate.split('-');
    const floor = parseFloorToInt(item.floorRaw) as number; // classifyInvalid가 이미 null을 걸러냄

    const occurrenceGroupKey = `${grpKey}|${item.dealAmount}|${item.dealDate}|${floor}`;
    const occurrenceIndex = occurrenceCounters.get(occurrenceGroupKey) ?? 0;
    occurrenceCounters.set(occurrenceGroupKey, occurrenceIndex + 1);

    rows.push({
      lawdCd,
      dealYmd,
      aptSeq: item.aptSeq,
      identityKey: idKey,
      dealType: 'sale',
      groupKeyStr: grpKey,
      aptName: item.name,
      dong: item.dong || '',
      jibun: item.jibun || null,
      exclusiveArea: item.excluUseArea as number,
      dealAmount: item.dealAmount,
      dealYear: parseInt(yStr, 10),
      dealMonth: parseInt(mStr, 10),
      dealDay: parseInt(dStr, 10),
      dealDate: item.dealDate,
      floor,
      buildYear: parseBuildYearToInt(item.buildYear),
      dealCanceled: !!item.dealCanceled,
      cancelDate: item.cancelDate || null,
      registryDate: item.registryDate || null,
      occurrenceIndex,
      rawUid: item.id || null,
    });
  }

  return { rows, invalid };
}

export function areaKeyOf(exclusiveArea: number): string {
  return areaKey({ excluUseArea: exclusiveArea });
}
