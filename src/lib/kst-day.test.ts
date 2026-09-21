import assert from 'node:assert/strict';
import test from 'node:test';
import { KST_OFFSET_MS, formatKstTime, startOfKstDay } from './kst-day';

// ADMIN_DASHBOARD_TRUST_FIX_V1 §5 — 감사에서 확정된 경계 케이스를 그대로 고정한다.
// 핵심은 "실행 환경 TZ가 무엇이든 같은 답이 나온다"는 것이다. 이 테스트는 순수 함수만
// 다루므로 프로세스 TZ를 바꾸지 않아도 UTC 런타임을 그대로 재현한다 — 입력이 UTC 순간이고
// 계산이 오프셋 산술뿐이라, Node를 TZ=UTC로 띄우든 KST로 띄우든 결과가 동일하다.

const kstMidnightOf = (isoDate: string) => new Date(`${isoDate}T00:00:00+09:00`);

test('KST 08:59 — 아직 어제 UTC일이지만 오늘(KST)은 이미 시작했다', () => {
  // 2026-09-21 08:59 KST = 2026-09-20T23:59Z. 옛 구현(UTC 자정)이라면 "오늘"이 09-20이 된다.
  const now = new Date('2026-09-20T23:59:00.000Z');
  assert.equal(startOfKstDay(now).toISOString(), kstMidnightOf('2026-09-21').toISOString());
  assert.equal(startOfKstDay(now).toISOString(), '2026-09-20T15:00:00.000Z');
});

test('KST 09:00 — UTC 날짜가 바뀌는 순간에도 오늘(KST)은 그대로다 (리셋 없음)', () => {
  // 감사에서 관측된 바로 그 순간: 2026-09-21T00:00Z = 2026-09-21 09:00 KST.
  const justBefore = new Date('2026-09-20T23:59:59.999Z'); // 08:59:59.999 KST
  const justAfter = new Date('2026-09-21T00:00:00.000Z'); // 09:00:00.000 KST
  assert.equal(
    startOfKstDay(justBefore).getTime(),
    startOfKstDay(justAfter).getTime(),
    'UTC 자정을 넘어도 KST 기준 "오늘"의 시작은 변하지 않아야 한다'
  );
});

test('KST 23:59 → 00:00 — 진짜 날짜 경계에서만 넘어간다', () => {
  const lastMinute = new Date('2026-09-21T14:59:00.000Z'); // 2026-09-21 23:59 KST
  const firstMinute = new Date('2026-09-21T15:00:00.000Z'); // 2026-09-22 00:00 KST
  assert.equal(startOfKstDay(lastMinute).toISOString(), kstMidnightOf('2026-09-21').toISOString());
  assert.equal(startOfKstDay(firstMinute).toISOString(), kstMidnightOf('2026-09-22').toISOString());
  assert.notEqual(startOfKstDay(lastMinute).getTime(), startOfKstDay(firstMinute).getTime());
});

test('KST 자정 정각은 그 날에 속한다(경계 포함)', () => {
  const midnight = new Date('2026-09-20T15:00:00.000Z'); // 2026-09-21 00:00:00 KST
  assert.equal(startOfKstDay(midnight).getTime(), midnight.getTime());
});

test('하루 안의 어느 시각을 넣어도 같은 시작점을 돌려준다', () => {
  const day = ['15:00', '18:30', '23:59', '03:00', '08:59', '09:00', '14:59'].map(
    (hhmm) => new Date(`2026-09-20T${hhmm}:00.000Z`)
  );
  // 2026-09-20T15:00Z ~ 2026-09-21T14:59Z 가 모두 KST 2026-09-21 이다.
  const starts = new Set(
    day
      .filter((d) => d.getTime() >= Date.parse('2026-09-20T15:00:00.000Z'))
      .map((d) => startOfKstDay(d).toISOString())
  );
  assert.equal(starts.size, 1);
  assert.equal([...starts][0], '2026-09-20T15:00:00.000Z');
});

test('결과는 항상 KST 자정 — UTC 오프셋이 정확히 9시간 반영된다', () => {
  for (const iso of ['2026-01-01T00:00:00Z', '2026-06-15T12:34:56Z', '2026-12-31T23:59:59Z']) {
    const start = startOfKstDay(new Date(iso));
    // 자정을 KST 벽시계로 보면 00:00:00.000 이어야 한다.
    const wall = new Date(start.getTime() + KST_OFFSET_MS);
    assert.equal(wall.getUTCHours(), 0);
    assert.equal(wall.getUTCMinutes(), 0);
    assert.equal(wall.getUTCSeconds(), 0);
    assert.equal(wall.getUTCMilliseconds(), 0);
  }
});

test('옛 UTC 구현과 달라지는 구간이 매일 09시간이다(회귀 방지)', () => {
  const startOfUtcDay = (n: Date) =>
    new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  // 00:00~08:59 KST 구간에서는 두 구현이 서로 다른 날을 가리킨다.
  const inMorning = new Date('2026-09-20T20:00:00.000Z'); // 2026-09-21 05:00 KST
  assert.notEqual(startOfKstDay(inMorning).getTime(), startOfUtcDay(inMorning).getTime());
  // 09:00 KST 이후에는 UTC 자정이 같은 날 안에 있어 "시작점"만 9시간 늦다.
  const afterNine = new Date('2026-09-21T03:00:00.000Z'); // 2026-09-21 12:00 KST
  assert.equal(
    startOfUtcDay(afterNine).getTime() - startOfKstDay(afterNine).getTime(),
    KST_OFFSET_MS
  );
});

test('formatKstTime — UTC 순간을 KST 시:분으로 보여준다', () => {
  assert.equal(formatKstTime(new Date('2026-09-21T00:00:00.000Z')), '09:00');
  assert.equal(formatKstTime(new Date('2026-09-20T15:00:00.000Z')), '00:00');
  assert.equal(formatKstTime(new Date('2026-09-21T03:14:00.000Z')), '12:14');
});
