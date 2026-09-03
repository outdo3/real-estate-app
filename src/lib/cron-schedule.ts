// DATA_FRESHNESS_AUTOMATION_V1 CRON ACTIVATION — /admin/ops의 scheduler 표시가
// **실제 등록 상태**를 근거로 하도록 한다.
//
// 이전에는 scheduler 값이 코드에 'OFF'로 하드코딩돼 있었다(그때는 사실이었다). cron을
// 등록한 뒤에도 그 문자열이 남아 있으면 화면이 거짓말을 하고, 반대로 'ACTIVE'를 하드코딩하면
// 나중에 cron을 제거해도 계속 ACTIVE라고 말한다. 그래서 배포된 vercel.json을 실제로 읽어
// 판정한다 — data/rent-trade-history/coverage-manifest.json을 읽는 것과 같은 패턴이며,
// 그 파일이 함수 번들에 포함된다는 것은 이미 .nft.json으로 실측 확인했다.
//
// 표시 의미(§8):
//   OFF       = 스케줄 등록 없음
//   SCHEDULED = 스케줄 등록됨 (실제 무인 실행 성공을 뜻하지 않는다)
// 마지막 실행 결과는 별도로 coverage 테이블에서 가져와 보여준다 — 등록됐다는 사실을
// 성공적으로 돌았다는 뜻으로 포장하지 않기 위함이다.
import * as fs from 'fs';
import * as path from 'path';

export type SchedulerState = 'OFF' | 'SCHEDULED' | 'UNKNOWN';

export interface CronRegistration {
  state: SchedulerState;
  /** vercel.json에 적힌 UTC cron 표현식 그대로. */
  scheduleUtc: string | null;
  /** 사람이 읽는 KST 라벨(예: "매일 04:00 KST"). 해석 불가한 표현식이면 null. */
  scheduleKst: string | null;
}

/**
 * `m h * * *` 형태의 **매일 1회** UTC cron을 KST 라벨로 바꾼다.
 *
 * 한국은 DST가 없어 연중 고정 UTC+9이므로 단순 덧셈으로 정확하다(다른 타임존이라면
 * 이렇게 하면 안 된다). 매일 형태가 아니면 null을 반환한다 — 억지로 해석해서 틀린 시각을
 * 보여주느니 표현식 원문만 보여주는 편이 낫다.
 */
export function describeDailyUtcCronInKst(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;
  if (dom !== '*' || mon !== '*' || dow !== '*') return null;
  if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(h)) return null;
  const minute = Number(m);
  const hour = Number(h);
  if (minute > 59 || hour > 23) return null;
  const kstHour = (hour + 9) % 24;
  return `매일 ${String(kstHour).padStart(2, '0')}:${String(minute).padStart(2, '0')} KST`;
}

/** vercel.json의 crons 배열에서 이 route에 해당하는 등록을 찾는다(순수 함수). */
export function findCronForRoute(
  crons: { path?: string; schedule?: string }[] | undefined,
  routePath: string
): CronRegistration {
  if (!Array.isArray(crons)) return { state: 'OFF', scheduleUtc: null, scheduleKst: null };
  // vercel.json의 path에는 쿼리스트링이 붙을 수 있다(예: "/api/cron/sale-sync?mode=apply").
  const hit = crons.find((c) => typeof c.path === 'string' && c.path.split('?')[0] === routePath);
  if (!hit || typeof hit.schedule !== 'string') return { state: 'OFF', scheduleUtc: null, scheduleKst: null };
  return { state: 'SCHEDULED', scheduleUtc: hit.schedule, scheduleKst: describeDailyUtcCronInKst(hit.schedule) };
}

const VERCEL_JSON_PATH = path.join(process.cwd(), 'vercel.json');

/** 배포된 vercel.json을 읽어 해당 route의 cron 등록 상태를 판정한다. */
export function readCronRegistration(routePath: string): CronRegistration {
  try {
    const parsed = JSON.parse(fs.readFileSync(VERCEL_JSON_PATH, 'utf-8'));
    return findCronForRoute(parsed?.crons, routePath);
  } catch {
    // 파일을 읽을 수 없으면 등록 여부를 **모른다**. OFF(등록 없음)로도, SCHEDULED로도
    // 단정하지 않는다 — 확인 불가를 정상처럼 표시하지 않는다는 ADMIN_OPS 원칙 그대로.
    return { state: 'UNKNOWN', scheduleUtc: null, scheduleKst: null };
  }
}
