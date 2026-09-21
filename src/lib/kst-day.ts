// ADMIN_DASHBOARD_TRUST_FIX_V1 §1 — "오늘"은 항상 **한국시간(KST)** 기준이다.
//
// 배경(ADMIN_DASHBOARD_DATA_TRUST_AUDIT_V1 §4/§5에서 실측): 관리자 대시보드는
// `new Date(); d.setHours(0,0,0,0)`으로 오늘의 시작을 구했다. `setHours`는 **실행 환경의
// 로컬 시간**을 쓰는데 Vercel Function은 TZ=UTC로 돈다. 그래서 대시보드의 "오늘"이
// 한국시간 09:00에 시작했고, 매일 그 시각에 오늘 지표가 0으로 리셋됐다
// (직전 UTC일 151건 → 현재 UTC일 60건으로 재현). 개발 머신은 TZ가 KST라 로컬에서는
// 재현되지 않았다 — 그래서 QA를 통과했다.
//
// 그 재발을 막기 위해 이 모듈은 **런타임 TZ에도, 브라우저 TZ에도 의존하지 않는다.**
// 한국은 서머타임이 없어 UTC+9 고정 오프셋이 항상 정확하다(1988년 이후 시행 없음).
// 따라서 오프셋 산술만으로 정확한 KST 자정을 구할 수 있고, Intl/TZ 데이터가 필요 없다.

/** 한국 표준시 오프셋. 서머타임이 없어 연중 고정이다. */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 주어진 시각이 속한 **KST 날짜의 00:00**을 UTC 순간으로 돌려준다.
 *
 * 반환값은 평소대로 UTC 기준 `Date`이므로 Prisma/SQL 비교에 그대로 쓸 수 있다
 * (예: `createdAt: { gte: startOfKstDay() }`). 실행 환경의 TZ가 무엇이든 결과는 같다.
 */
export function startOfKstDay(now: Date = new Date()): Date {
  // UTC 시각을 KST 벽시계로 옮긴 뒤, 그 날짜의 자정을 잡고, 다시 UTC로 되돌린다.
  const asKstWallClock = new Date(now.getTime() + KST_OFFSET_MS);
  const kstMidnightAsIfUtc = Date.UTC(
    asKstWallClock.getUTCFullYear(),
    asKstWallClock.getUTCMonth(),
    asKstWallClock.getUTCDate()
  );
  return new Date(kstMidnightAsIfUtc - KST_OFFSET_MS);
}

/** `HH:MM` (KST). 관리자 화면의 "마지막 갱신" 표시에 쓴다. */
export function formatKstTime(at: Date = new Date()): string {
  const k = new Date(at.getTime() + KST_OFFSET_MS);
  return `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
}
