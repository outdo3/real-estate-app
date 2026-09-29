// REALTOR_PRO_MVP_V1 — Pro 화면 표시 포맷(순수). 평형 환산(㎡ / 3.3058)은 하지 않는다 — 전용㎡ 원값만 표시.

import { DEAL_TYPE_LABELS, FLOOR_BAND_LABELS, type DealType, type FloorBand } from '@/lib/pro/rules';

/** 만원 정수 → "8억 9,000만" / "4,500만" / "12억". */
export function formatManwon(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-';
  const eok = Math.floor(v / 10000);
  const rest = v % 10000;
  if (eok > 0 && rest > 0) return `${eok.toLocaleString('ko-KR')}억 ${rest.toLocaleString('ko-KR')}만`;
  if (eok > 0) return `${eok.toLocaleString('ko-KR')}억`;
  return `${rest.toLocaleString('ko-KR')}만`;
}

export function formatDealPrice(l: { dealType: DealType | string; askingPriceManwon: number | null; depositManwon: number | null; monthlyRentManwon: number | null }): string {
  const label = DEAL_TYPE_LABELS[l.dealType as DealType] ?? l.dealType;
  if (l.dealType === 'SALE') return `${label} ${formatManwon(l.askingPriceManwon)}`;
  if (l.dealType === 'JEONSE') return `${label} ${formatManwon(l.depositManwon)}`;
  return `${label} ${formatManwon(l.depositManwon)} / ${formatManwon(l.monthlyRentManwon)}`;
}

/** 전용면적 정확값 표시("84.97㎡"). 반올림으로 다른 면적과 섞이지 않도록 소수 둘째 자리까지. */
export function formatM2(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-';
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${s}㎡`;
}

export function floorBandLabel(b: FloorBand | string | null | undefined): string | null {
  if (!b) return null;
  return FLOOR_BAND_LABELS[b as FloorBand] ?? null;
}

/** 저장된 층·구간으로 표시 문자열("12층" / "고층"). 없으면 null. */
export function floorText(floor: number | null, band: FloorBand | string | null): string | null {
  if (floor != null) return `${floor}층`;
  return floorBandLabel(band);
}

const KST = 'Asia/Seoul';

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '-';
  return d.toLocaleDateString('ko-KR', { timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatDateTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '-';
  return d.toLocaleString('ko-KR', { timeZone: KST, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** ISO → <input type="date"> 값(KST 기준 YYYY-MM-DD). */
export function toDateInput(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '';
  const kst = new Date(d.getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 10);
}

/** <input type="date"> 값 → ISO(KST 자정). 빈 값이면 null. */
export function dateInputToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 날짜+시각 입력 → ISO(KST). */
export function dateTimeInputToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = /^\d{2}:\d{2}$/.test(time) ? time : '09:00';
  const d = new Date(`${date}T${t}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 문자열 입력 → 숫자. 빈 값 null. 숫자가 아니면 원문 문자열을 그대로 보내 서버 검증(INVALID)에 맡긴다. */
export function parseIntInput(v: string): number | string | null {
  const t = v.replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

export function parseNumInput(v: string): number | string | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}
