import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  classifyMolitSeverity,
  classifyNonMolitSeverity,
  isHealthWindow,
  parseErrorLogEntry,
  parseMolitPartial,
  redactForAdminDisplay,
  summarizeSystemHealth,
  windowStart,
  LIKELY_INCOMPLETE_RATIO,
  SEVERITY_LABELS,
  type RawErrorLogRow,
} from './system-health';

/**
 * ADMIN_SYSTEM_HEALTH_V1 §15 — 관리자 운영 상태 요약의 계약.
 *
 * 고친 문제: failed=1과 failed=45가 관리자 화면에서 똑같은 "SERVER" 한 줄로 보였다.
 * ErrorLog에는 severity도 type도 없으므로 판정은 전부 read-time 파싱이다 —
 * 아래 테스트가 그 파싱과 등급이 흔들리지 않게 고정한다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 설계를 설명하느라 금지 토큰을 언급한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const at = (iso: string) => new Date(iso);

/** 실제 production 로그와 같은 모양을 만든다. */
function molitLine(opts: {
  type?: string; lawdCd?: string; dong?: string; period?: number;
  months: number; ok: number; failed: number; failedMonths?: string; reason?: string;
}): string {
  const { type = 'apt', lawdCd = '26140', dong = '-', period = 60, months, ok, failed } = opts;
  const failedMonths = opts.failedMonths ?? '202401,202402';
  const reason = opts.reason ?? 'OpenAPI Error: 초당 서비스 요청제한 횟수 초과 에러';
  return `[MOLIT_PARTIAL] source=MOLIT type=${type} lawdCd=${lawdCd} dong=${dong} period=${period} `
    + `months=${months} ok=${ok} failed=${failed} failedMonths=${failedMonths} reason=${reason}`;
}

function row(id: number, message: string, extra: Partial<RawErrorLogRow> = {}): RawErrorLogRow {
  return {
    id,
    source: 'server',
    message,
    url: '/api/apt/[name]',
    createdAt: at('2026-09-13T03:02:00.000Z'),
    ...extra,
  };
}

// ── A. MOLIT_PARTIAL 파싱 (§15-3, §15-7) ───────────────────────────────────

test('§3 MOLIT_PARTIAL의 모든 필드를 구조화한다', () => {
  const f = parseMolitPartial(molitLine({ dong: '서대신동', months: 60, ok: 58, failed: 2 }));
  assert.ok(f);
  assert.equal(f.type, 'apt');
  assert.equal(f.lawdCd, '26140');
  assert.equal(f.dong, '서대신동');
  assert.equal(f.period, 60);
  assert.equal(f.monthsRequested, 60);
  assert.equal(f.monthsSucceeded, 58);
  assert.equal(f.failedCount, 2);
  assert.deepEqual(f.failedMonths, ['202401', '202402']);
  assert.equal(f.reason, 'OpenAPI Error: 초당 서비스 요청제한 횟수 초과 에러');
});

test('§3 reason은 공백과 콜론을 포함한 채 끝까지 읽는다', () => {
  // reason이 마지막 필드다. 다른 필드처럼 공백에서 자르면 "OpenAPI"만 남는다.
  const f = parseMolitPartial(molitLine({ months: 12, ok: 11, failed: 1 }));
  assert.ok(f?.reason?.includes('초당 서비스 요청제한'), 'reason이 잘렸다');
});

test('§3 dong=-는 동 이름이 아니라 "없음"이다', () => {
  const f = parseMolitPartial(molitLine({ dong: '-', months: 12, ok: 11, failed: 1 }));
  assert.equal(f?.dong, null, '"-"를 동 이름으로 표시하면 안 된다');
});

test('§15-7 failedMonths의 +N 꼬리표는 "더 있다"로 읽는다', () => {
  const f = parseMolitPartial(molitLine({
    months: 60, ok: 15, failed: 45,
    failedMonths: '202401,202402,202403+42',
  }));
  assert.deepEqual(f?.failedMonths, ['202401', '202402', '202403']);
  assert.equal(f?.failedMonthsTruncated, 42, '잘린 개월 수를 잃어버렸다');
});

test('§3 MOLIT_PARTIAL이 아닌 문자열은 파싱하지 않는다', () => {
  assert.equal(parseMolitPartial('[GET /api/presales][Error] boom'), null);
});

test('§3 필드가 깨져 있으면 지어내지 않고 null로 둔다', () => {
  const f = parseMolitPartial('[MOLIT_PARTIAL] source=MOLIT type=apt');
  assert.ok(f);
  assert.equal(f.monthsRequested, null);
  assert.equal(f.failedCount, null);
  assert.deepEqual(f.failedMonths, []);
});

// ── B. severity 분류 (§15-4, §15-5, §15-6) ─────────────────────────────────

test('§15-4 58 성공 / 2 실패 → MEDIUM', () => {
  const f = parseMolitPartial(molitLine({ months: 60, ok: 58, failed: 2 }))!;
  const { severity, ratio } = classifyMolitSeverity(f);
  assert.equal(severity, 'MEDIUM');
  assert.ok(ratio !== null && ratio < 0.2);
});

test('§15-5 33 성공 / 27 실패 → HIGH', () => {
  const f = parseMolitPartial(molitLine({ months: 60, ok: 33, failed: 27 }))!;
  const { severity } = classifyMolitSeverity(f);
  assert.equal(severity, 'HIGH', '45% 실패가 CRITICAL도 MEDIUM도 아닌 HIGH여야 한다');
});

test('§15-6 15 성공 / 45 실패 → CRITICAL', () => {
  const f = parseMolitPartial(molitLine({ months: 60, ok: 15, failed: 45 }))!;
  const { severity } = classifyMolitSeverity(f);
  assert.equal(severity, 'CRITICAL');
});

test('§4 경계값 — 정확히 20%는 HIGH, 정확히 50%는 CRITICAL', () => {
  const high = parseMolitPartial(molitLine({ months: 10, ok: 8, failed: 2 }))!;
  assert.equal(classifyMolitSeverity(high).severity, 'HIGH');
  const critical = parseMolitPartial(molitLine({ months: 10, ok: 5, failed: 5 }))!;
  assert.equal(classifyMolitSeverity(critical).severity, 'CRITICAL');
});

test('§4 failed=0은 부분 실패가 아니다 → LOW', () => {
  const f = parseMolitPartial(molitLine({ months: 60, ok: 60, failed: 0, failedMonths: '' }))!;
  assert.equal(classifyMolitSeverity(f).severity, 'LOW');
});

test('§4 절대 건수가 아니라 비율로 판정한다', () => {
  // 같은 2개월 실패라도 분모가 다르면 다른 사건이다.
  const wide = parseMolitPartial(molitLine({ months: 120, ok: 118, failed: 2 }))!;
  const narrow = parseMolitPartial(molitLine({ months: 3, ok: 1, failed: 2 }))!;
  assert.equal(classifyMolitSeverity(wide).severity, 'MEDIUM');
  assert.equal(classifyMolitSeverity(narrow).severity, 'CRITICAL');
});

test('§4 분모를 모르면 LOW로 접지 않는다', () => {
  const f = parseMolitPartial('[MOLIT_PARTIAL] source=MOLIT type=apt failed=3')!;
  const { severity, ratio } = classifyMolitSeverity(f);
  assert.equal(severity, 'MEDIUM', '"모른다"를 "괜찮다"로 표시하면 안 된다');
  assert.equal(ratio, null, '비율을 지어내면 안 된다');
});

test('§4 DB 연결 실패는 CRITICAL, 일반 라우트 예외는 HIGH, 클라이언트는 MEDIUM', () => {
  assert.equal(
    classifyNonMolitSeverity('SERVER', '[GET /api/presales][PrismaClientInitializationError:P1001] ...'),
    'CRITICAL'
  );
  assert.equal(
    classifyNonMolitSeverity('SERVER', '[GET /api/presales][PrismaClientKnownRequestError:P2024] ...'),
    'HIGH'
  );
  assert.equal(classifyNonMolitSeverity('CLIENT', 'TypeError: x is not a function'), 'MEDIUM');
});

// ── C. 한 줄 요약 (§3) ──────────────────────────────────────────────────────

test('§3 목록 요약은 사람이 읽는 문장이다 — 원시 key=value가 아니다', () => {
  const e = parseErrorLogEntry(row(1, molitLine({ dong: '서대신동', months: 60, ok: 58, failed: 2 })));
  assert.equal(e.kind, 'MOLIT');
  assert.ok(e.summary.includes('60개월 중 58개월 성공 / 2개월 실패'), `요약이 읽기 어렵다: ${e.summary}`);
  assert.ok(e.summary.includes('아파트 매매'), '유형이 한국어로 표시되지 않는다');
  assert.ok(!e.summary.includes('lawdCd='), '원시 필드가 요약에 남아 있다');
});

test('§3 개월 수를 읽지 못하면 있는 척하지 않는다', () => {
  const e = parseErrorLogEntry(row(1, '[MOLIT_PARTIAL] source=MOLIT type=apt lawdCd=26140'));
  assert.ok(e.summary.includes('읽지 못함'), '알 수 없는 값을 숫자처럼 표시하고 있다');
});

test('§15-11 원문은 상세에서 항상 확인 가능하다', () => {
  const raw = molitLine({ months: 60, ok: 58, failed: 2 });
  const e = parseErrorLogEntry(row(1, raw));
  assert.ok(e.rawMessage.includes('[MOLIT_PARTIAL]'), '원문이 사라졌다');
  assert.ok(e.rawMessage.includes('failedMonths='), '원문이 요약으로 대체됐다');
});

test('§3 서버 라우트 오류는 route와 본문을 분리한다', () => {
  const e = parseErrorLogEntry(row(2, '[GET /api/presales][PrismaClientKnownRequestError:P2024] Timed out', { url: '/api/presales' }));
  assert.equal(e.kind, 'SERVER');
  assert.equal(e.route, 'GET /api/presales');
  assert.equal(e.summary, 'Timed out');
  assert.equal(e.severity, 'HIGH');
});

test('§3 client source는 CLIENT로 분류된다', () => {
  const e = parseErrorLogEntry(row(3, 'TypeError: undefined', { source: 'client' }));
  assert.equal(e.kind, 'CLIENT');
});

// ── D. 비밀값 노출 금지 (§15-8, §11) ───────────────────────────────────────

test('§11 serviceKey / 토큰 / 비밀번호가 표시 문자열에 남지 않는다', () => {
  const dirty = [
    'serviceKey=AbCdEf123SECRET',
    'access_token=ya29.REALTOKEN',
    'refresh_token: 1//abcdefgh',
    'client_secret=shhh-very-secret',
    'password=hunter2',
    'apiKey=KEY123456',
  ].join(' & ');
  const clean = redactForAdminDisplay(dirty);
  for (const leak of ['AbCdEf123SECRET', 'ya29.REALTOKEN', '1//abcdefgh', 'shhh-very-secret', 'hunter2', 'KEY123456']) {
    assert.ok(!clean.includes(leak), `비밀값이 노출된다: ${leak}`);
  }
});

test('§11 Authorization 헤더와 Bearer 토큰을 지운다', () => {
  const clean = redactForAdminDisplay('authorization: Bearer abc.def.ghi123 failed');
  assert.ok(!clean.includes('abc.def.ghi123'), 'Bearer 토큰이 남았다');
});

test('§11 쿠키 전체를 지운다', () => {
  const clean = redactForAdminDisplay('cookie: __Secure-next-auth.session-token=SESSIONVALUE; other=1');
  assert.ok(!clean.includes('SESSIONVALUE'), '세션 쿠키가 남았다');
});

test('§11 JWT 모양 문자열을 지운다', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4';
  const clean = redactForAdminDisplay(`token was ${jwt} here`);
  assert.ok(!clean.includes(jwt), 'JWT가 그대로 남았다');
  assert.ok(clean.includes('[redacted-jwt]'));
});

test('§11 connection string과 이메일·전화번호를 지운다', () => {
  const clean = redactForAdminDisplay('postgresql://u:p@host/db failed for a@b.com 010-1234-5678');
  assert.ok(!clean.includes('u:p@host'), 'connection string이 남았다');
  assert.ok(!clean.includes('a@b.com'), '이메일이 남았다');
  assert.ok(!clean.includes('010-1234-5678'), '전화번호가 남았다');
});

test('§11 redaction은 파싱 이전에 걸려 상세 화면에도 비밀값이 없다', () => {
  const e = parseErrorLogEntry(row(1,
    `[MOLIT_PARTIAL] source=MOLIT type=apt lawdCd=26140 dong=- period=60 months=60 ok=58 failed=2 `
    + `failedMonths=202401,202402 reason=Error calling serviceKey=TOPSECRETKEY endpoint`));
  assert.ok(!e.rawMessage.includes('TOPSECRETKEY'), '상세 원문에 비밀값이 남았다');
  assert.ok(!JSON.stringify(e).includes('TOPSECRETKEY'), '어떤 필드로든 비밀값이 새어나간다');
});

test('§11 redaction이 정상 진단 정보까지 지우지는 않는다', () => {
  const e = parseErrorLogEntry(row(1, molitLine({ months: 60, ok: 58, failed: 2 })));
  assert.equal(e.molit?.lawdCd, '26140', '지역 코드가 지워지면 운영에 못 쓴다');
  assert.ok(e.molit?.reason?.includes('요청제한'), '원인이 지워졌다');
});

// ── E. 반복 오류 집계 (§15-9, §7) ──────────────────────────────────────────

test('§7 같은 유형·지역·원인은 한 건으로 묶고 기록 횟수를 센다', () => {
  const rows = [
    row(1, molitLine({ months: 60, ok: 58, failed: 2 }), { createdAt: at('2026-09-13T01:00:00Z') }),
    row(2, molitLine({ months: 60, ok: 50, failed: 10 }), { createdAt: at('2026-09-13T02:00:00Z') }),
    row(3, molitLine({ months: 60, ok: 15, failed: 45 }), { createdAt: at('2026-09-13T03:00:00Z') }),
  ];
  const s = summarizeSystemHealth(rows);
  assert.equal(s.repeated.length, 1, '같은 장애가 3건으로 흩어졌다');
  const r = s.repeated[0];
  assert.equal(r.loggedCount, 3);
  assert.equal(r.latestAt, at('2026-09-13T03:00:00Z').toISOString());
  assert.equal(r.worstSeverity, 'CRITICAL', '가장 나쁜 등급을 물고 올라가야 한다');
  assert.ok(r.worstFailureRatio !== null && r.worstFailureRatio > 0.7);
});

test('§7 지역이 다르면 다른 묶음이다', () => {
  const s = summarizeSystemHealth([
    row(1, molitLine({ lawdCd: '26140', months: 60, ok: 58, failed: 2 })),
    row(2, molitLine({ lawdCd: '11680', months: 60, ok: 58, failed: 2 })),
  ]);
  assert.equal(s.repeated.length, 0, '서로 다른 지역을 한 건으로 합치면 안 된다');
});

test('§7 1회뿐인 오류는 "반복"이 아니다', () => {
  const s = summarizeSystemHealth([row(1, molitLine({ months: 60, ok: 58, failed: 2 }))]);
  assert.equal(s.repeated.length, 0);
  assert.equal(s.entries.length, 1, '목록에서는 여전히 보여야 한다');
});

// ── F. 요약 카드 + 불완전 경고 (§2, §8) ────────────────────────────────────

test('§2 카드 4개가 실제 값을 센다', () => {
  const s = summarizeSystemHealth([
    row(1, molitLine({ months: 60, ok: 58, failed: 2 }), { createdAt: at('2026-09-13T01:00:00Z') }),
    row(2, molitLine({ lawdCd: '11680', months: 60, ok: 15, failed: 45 }), { createdAt: at('2026-09-13T04:42:00Z') }),
    row(3, '[GET /api/presales][Error] boom', { createdAt: at('2026-09-13T02:00:00Z') }),
  ]);
  assert.equal(s.cards.totalInWindow, 3);
  assert.equal(s.cards.molitPartial, 2);
  assert.equal(s.cards.highRisk, 2, 'CRITICAL(45/60) + HIGH(라우트 예외)');
  assert.equal(s.cards.latestAt, at('2026-09-13T04:42:00Z').toISOString());
});

test('§8 failed>0이면 부분 데이터 가능성을 알린다', () => {
  const s = summarizeSystemHealth([row(1, molitLine({ months: 60, ok: 59, failed: 1 }))]);
  assert.equal(s.incompleteness.anyFailure, true);
  assert.equal(s.incompleteness.likelyIncomplete, false, '1.7% 실패를 "높음"으로 과장하면 안 된다');
});

test('§8 비율 20% 이상이면 불완전 가능성 높음', () => {
  const s = summarizeSystemHealth([row(1, molitLine({ months: 60, ok: 40, failed: 20 }))]);
  assert.ok(20 / 60 >= LIKELY_INCOMPLETE_RATIO);
  assert.equal(s.incompleteness.likelyIncomplete, true);
});

test('§13 오류가 없으면 빈 요약 — 만들어낸 값이 없다', () => {
  const s = summarizeSystemHealth([]);
  assert.equal(s.cards.totalInWindow, 0);
  assert.equal(s.cards.latestAt, null, '기록이 없는데 시각을 지어내면 안 된다');
  assert.equal(s.incompleteness.anyFailure, false);
  assert.equal(s.incompleteness.worstRatio, null);
  assert.deepEqual(s.repeated, []);
});

// ── G. 조회 창 (§6, §14) ────────────────────────────────────────────────────

test('§6 조회 창은 1h/24h/7d만 받는다', () => {
  assert.ok(isHealthWindow('1h') && isHealthWindow('24h') && isHealthWindow('7d'));
  assert.ok(!isHealthWindow('30d'));
  assert.ok(!isHealthWindow(null));
});

test('§6 창 시작 시각이 정확하다', () => {
  const now = at('2026-09-13T12:00:00Z');
  assert.equal(windowStart('1h', now).toISOString(), at('2026-09-13T11:00:00Z').toISOString());
  assert.equal(windowStart('24h', now).toISOString(), at('2026-09-12T12:00:00Z').toISOString());
  assert.equal(windowStart('7d', now).toISOString(), at('2026-09-06T12:00:00Z').toISOString());
});

// ── H. 배선 가드 (§12, §14, §17) ───────────────────────────────────────────

const API = read('src/app/api/admin/system-health/route.ts');
const PAGE = read('src/app/admin/system/page.tsx');

test('§15-1/§12 API는 기존 admin guard를 재사용한다', () => {
  const code = codeOf(API);
  assert.ok(/requireAdmin\(\)/.test(code), '기존 admin guard를 쓰지 않는다');
  assert.ok(/auth\.error/.test(code) && /status: auth\.status/.test(code), '거부 응답이 guard의 판정을 따르지 않는다');
});

test('§15-2/§12 새 권한 체계를 만들지 않는다', () => {
  const code = codeOf(API);
  assert.ok(!/ADMIN_EMAIL/.test(code), '허용 목록을 이 라우트가 직접 다룬다');
  assert.ok(!/role\s*===\s*['"]ADMIN/.test(code), 'guard를 우회하는 자체 role 검사가 있다');
});

test('§14 조회는 읽기 전용이고 상한이 걸려 있다', () => {
  const code = codeOf(API);
  assert.ok(/prisma\.errorLog\.findMany/.test(code), 'ErrorLog를 읽지 않는다');
  assert.ok(/take:\s*MAX_ROWS \+ 1/.test(code), '건수 상한이 없다 — 무제한 조회 금지');
  assert.ok(/createdAt:\s*\{\s*gte:\s*since\s*\}/.test(code), '조회 창 필터가 없다');
  for (const forbidden of ['prisma.errorLog.create', 'prisma.errorLog.delete', 'prisma.errorLog.update', 'deleteMany', 'updateMany']) {
    assert.ok(!code.includes(forbidden), `관리자 조회 경로가 쓰기를 한다: ${forbidden}`);
  }
});

test('§14/§17 관리자 화면이 MOLIT을 다시 호출하지 않는다', () => {
  const code = codeOf(API);
  assert.ok(!/fetchMolitData|fetchMonths/.test(code), '대시보드 진입이 외부 API 쿼터를 쓴다');
});

test('§13 조회 실패를 "오류 없음"으로 표시하지 않는다', () => {
  const code = codeOf(API);
  assert.ok(/success:\s*false/.test(code) && /status:\s*500/.test(code), '실패가 성공 응답으로 접힌다');
  const page = codeOf(PAGE);
  assert.ok(/fetchError\s*\?/.test(page), '화면이 error 상태를 분리하지 않는다');
  assert.ok(/isLoading\s*\?/.test(page), '화면이 loading 상태를 분리하지 않는다');
  assert.ok(/role="alert"/.test(page), '오류 상태가 스크린리더에 알려지지 않는다');
});

test('§12 화면도 비관리자에게 데이터를 요청하지 않는다', () => {
  const code = codeOf(PAGE);
  assert.ok(
    /isAdmin \? `\/api\/admin\/system-health\?window=\$\{window\}` : null/.test(code),
    '비관리자일 때 SWR 키가 null로 막히지 않는다'
  );
  assert.ok(/관리자만 접근할 수 있는 페이지입니다/.test(code), '비관리자 안내가 없다');
});

test('§7 반복 건수를 "발생"이 아니라 "기록"으로 표기한다', () => {
  // 부분 실패는 (type, lawdCd)당 5분에 한 번만 기록된다 — 기록 횟수는 발생 횟수의 하한이다.
  assert.ok(/기록된 횟수/.test(PAGE), '스로틀 때문에 실제 발생보다 적다는 사실을 숨기고 있다');
  assert.ok(/5분에 한 번만 기록/.test(PAGE), '스로틀 설명이 없다');
});

test('§10 수집하지 않는 오류 종류를 "0건"으로 보이게 하지 않는다', () => {
  // AUTH / CRON 필터를 만들면 "AUTH 0건"이 "인증 정상"으로 읽힌다.
  const code = codeOf(PAGE);
  assert.ok(!/value="AUTH"/.test(code), '수집하지 않는 AUTH 필터가 있다');
  assert.ok(!/value="CRON"/.test(code), '수집하지 않는 CRON 필터가 있다');
  assert.ok(/OAuth 콜백 실패와 cron/.test(PAGE), 'source의 한계를 밝히지 않았다');
});

test('§17 기존 관리자 대시보드의 원시 로그 카드를 제거하지 않았다', () => {
  const dash = read('src/app/admin/dashboard/page.tsx');
  assert.ok(dash.includes('시스템 에러 로그 (최근 20건)'), '기존 카드가 사라졌다(regression)');
  assert.ok(dash.includes('/admin/system'), '새 화면으로 가는 길이 없다');
});

test('severity 라벨은 4단계가 모두 구분된다', () => {
  const labels = Object.values(SEVERITY_LABELS);
  assert.equal(new Set(labels).size, 4, '두 등급이 같은 라벨을 쓰면 구분이 안 된다');
});
