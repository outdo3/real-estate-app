// OFFICETEL_INCREMENTAL_SYNC_V1 — 1회성 catch-up(202609 ~ 현재월) CLI의 인자 검증과 apply 안전장치. 순수 함수.
//
// 설계 원칙: 실수로 Production에 쓰는 길을 막는다.
//   - 기본은 dry-run(MOLIT를 읽고 DB를 읽기만 한다).
//   - apply는 `--apply`만으로는 안 된다: 확인 토큰 + 범위 명시(특정 구 또는 --all-districts)가 모두 필요하다.
//   - 그래서 "대표 1개 구 apply -> 검증 -> 16구 apply" 순서를 인자 수준에서 강제할 수 있다.
import { OFFICETEL_BUSAN_LAWD_CDS, kstYearMonth, monthRange, subtractMonths } from './months';

export const APPLY_CONFIRM_TOKEN = 'WRITE_PRODUCTION_OFFICETEL_HISTORY';
/** 이 STEP의 catch-up 시작월: 최초 backfill(STEP 3A/3B, 2026-09-04 스윕)이 진행 중이던 달. */
export const CATCHUP_DEFAULT_FROM = '202609';
export const CATCHUP_MAX_MONTHS = 12;

export type CatchupDataset = 'SALE' | 'RENT' | 'ALL';

export interface CatchupArgs {
  apply: boolean;
  dataset: CatchupDataset;
  from: string;
  to: string;
  months: string[];
  lawdCds: string[];
  allDistricts: boolean;
}

export type CatchupParse = { ok: true; args: CatchupArgs } | { ok: false; error: string };

const valueOf = (argv: string[], name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const isYm = (s: string): boolean => /^\d{6}$/.test(s) && Number(s.slice(4, 6)) >= 1 && Number(s.slice(4, 6)) <= 12;

export function parseCatchupArgs(argv: string[], now: Date): CatchupParse {
  const apply = argv.includes('--apply');
  const dsRaw = (valueOf(argv, 'dataset') ?? 'ALL').toUpperCase();
  if (dsRaw !== 'SALE' && dsRaw !== 'RENT' && dsRaw !== 'ALL') return { ok: false, error: 'invalid --dataset (SALE|RENT|ALL)' };

  const currentMonth = kstYearMonth(now);
  const from = valueOf(argv, 'from') ?? CATCHUP_DEFAULT_FROM;
  const to = valueOf(argv, 'to') ?? currentMonth;
  if (!isYm(from) || !isYm(to)) return { ok: false, error: 'invalid --from/--to (YYYYMM)' };
  if (from > to) return { ok: false, error: '--from must not be after --to' };
  if (to > currentMonth) return { ok: false, error: '--to must not be in the future' };
  const months = monthRange(from, to);
  if (months.length > CATCHUP_MAX_MONTHS) return { ok: false, error: `range too long (max ${CATCHUP_MAX_MONTHS} months)` };
  // 아주 오래된 달을 실수로 받지 않는다: 현재월 기준 24개월 이내.
  if (from < subtractMonths(currentMonth, 24)) return { ok: false, error: '--from too old' };

  const allDistricts = argv.includes('--all-districts');
  const lawdRaw = valueOf(argv, 'lawd');
  if (allDistricts && lawdRaw) return { ok: false, error: 'use either --lawd or --all-districts' };
  let lawdCds: string[] = [];
  if (lawdRaw) {
    lawdCds = lawdRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (lawdCds.length === 0 || lawdCds.some((c) => !OFFICETEL_BUSAN_LAWD_CDS.includes(c))) return { ok: false, error: 'invalid --lawd' };
  } else if (allDistricts) {
    lawdCds = [...OFFICETEL_BUSAN_LAWD_CDS];
  } else {
    // dry-run은 범위 생략 시 전체를 읽기만 한다. apply는 아래 가드가 막는다.
    lawdCds = [...OFFICETEL_BUSAN_LAWD_CDS];
  }
  return { ok: true, args: { apply, dataset: dsRaw, from, to, months, lawdCds, allDistricts } };
}

/**
 * apply 가드. 통과하면 null, 막히면 사유.
 * `confirm`은 --confirm=... 값, `lawdExplicit`은 사용자가 구를 직접 지정했는지(생략 기본값이 아닌지).
 */
export function checkApplyGuard(args: CatchupArgs, confirm: string | null, lawdExplicit: boolean): string | null {
  if (!args.apply) return null;
  if (confirm !== APPLY_CONFIRM_TOKEN) return `apply requires --confirm=${APPLY_CONFIRM_TOKEN}`;
  if (!lawdExplicit && !args.allDistricts) return 'apply requires an explicit scope: --lawd=<code[,code]> (recommended first: one district) or --all-districts';
  return null;
}

export function catchupConfirmOf(argv: string[]): string | null {
  return valueOf(argv, 'confirm');
}
export function catchupLawdExplicit(argv: string[]): boolean {
  return valueOf(argv, 'lawd') !== null;
}
