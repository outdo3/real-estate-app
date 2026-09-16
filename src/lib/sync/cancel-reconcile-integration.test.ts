import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// CANCELLATION_RATCHET_PREVENTION_FIX_V1 — ingest 통합 계약을 소스 수준에서 고정한다.
// sale-sync-core는 module-level prisma를 쓰므로 여기서는 DB 없이, "어떤 규칙이 코드에
// 실제로 박혀 있는가"를 검증한다(같은 저장소의 molit-rate-guard.test.ts가 쓰는 방식).

/** 주석을 지운 소스 — 계약은 **코드**에 있어야 하고, 주석 문구에 걸려 통과/실패하면 안 된다. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ 	]*\/\/.*$/gm, '');
}

const core = stripComments(readFileSync(path.join(process.cwd(), 'src/lib/sync/sale-sync-core.ts'), 'utf8'));
const policy = stripComments(readFileSync(path.join(process.cwd(), 'scripts/write-policy-logic.ts'), 'utf8'));

test('취소 쓰기는 그룹 reconciliation 결과에서만 나온다 — classifyRow의 취소 분류는 더 이상 쓰기를 만들지 않는다', () => {
  assert.ok(
    !/kind === 'updateFalseToTrue'/.test(core),
    "sale-sync-core가 여전히 classifyRow의 'updateFalseToTrue'로 flip을 만들고 있다"
  );
  assert.match(core, /reconcileGroupCancellation\(/, '그룹 reconciliation을 호출해야 한다');
  assert.match(core, /cancelFlips\.push/, 'toCancel이 쓰기 목록으로 이어져야 한다');
  assert.match(core, /cancelRestores\.push/, 'toRestore가 쓰기 목록으로 이어져야 한다');
});

test('§6 — PARTIAL/INVALID 셀은 여전히 쓰기 전에 조기 반환된다(원천 신뢰 가드 유지)', () => {
  const guard = core.match(/if \(fetchResult\.status === 'INVALID' \|\| fetchResult\.status === 'PARTIAL'\)[\s\S]{0,400}?return base;/);
  assert.ok(guard, 'INVALID/PARTIAL 조기 반환 가드가 있어야 한다');
  // 가드가 reconciliation보다 먼저 와야 한다.
  assert.ok(
    core.indexOf("fetchResult.status === 'INVALID'") < core.indexOf('reconcileGroupCancellation('),
    '완전성 가드가 취소 대조보다 앞에 있어야 한다 — 못 읽은 셀에서 상태를 고쳐 쓰면 안 된다'
  );
});

test('§8 — 취소 쓰기는 deal_canceled와 cancel_date만 건드린다(registryDate 등 다른 필드 금지)', () => {
  const flipWrite = core.match(/data: \{ dealCanceled: true, cancelDate: f\.cancelDate, sourceFetchedAt: new Date\(\) \}/);
  assert.ok(flipWrite, '취소 flip이 dealCanceled/cancelDate만 써야 한다');
  // UPDATE가 실제로 쓰는 필드는 `data: { ... }` 안에만 있다. select 절이 같은 필드명을
  // 나열한다고 해서 쓰기가 되는 것은 아니므로, 검사 범위를 data 블록으로 좁힌다.
  const updateDataBlocks = [...core.matchAll(/\.update\(\{[\s\S]*?data: \{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(updateDataBlocks.length >= 2, 'UPDATE data 블록을 찾지 못했다');
  for (const block of updateDataBlocks) {
    // 핵심 계약: 한 UPDATE가 취소 상태와 등기일자를 **동시에** 쓰지 않는다.
    // (등기일자 보충은 형제 전원 동일할 때만 도는 별도 경로이고, 취소는 그룹 개수로 정해진다.)
    assert.ok(!(/dealCanceled/.test(block) && /registryDate/.test(block)),
      `취소와 registryDate를 같은 UPDATE에서 쓰면 안 된다: ${block.trim()}`);
    assert.ok(!/occurrenceIndex|groupKeyStr|dealAmount|exclusiveArea|aptSeq/.test(block),
      `UPDATE가 자연키/식별 필드를 건드리면 안 된다: ${block.trim()}`);
  }
  const restoreWrite = core.match(/data: \{ dealCanceled: false, cancelDate: null, sourceFetchedAt: new Date\(\) \}/);
  assert.ok(restoreWrite, '치유는 dealCanceled=false, cancelDate=NULL만 써야 한다');
});

test('§15 — 치유(true→false)는 기본 꺼짐이고, 예방은 스위치와 무관하게 동작한다', () => {
  assert.match(core, /SALE_CANCEL_RESTORE_ENABLED === '1'/, '명시적 env로만 치유를 켠다');
  assert.match(core, /restoreEnabled \?\?|if \(!restoreEnabled\)/, '꺼져 있으면 쓰지 않고 대기 건수만 남긴다');
  assert.match(core, /cancelRestorePending/, '대기 건수를 metric으로 남겨야 한다');
  // toCancel(예방 경로)에는 스위치가 걸려 있으면 안 된다.
  const flipLoop = core.match(/for \(let i = 0; i < cancelFlips\.length; i \+= CHUNK_SIZE\)/);
  assert.ok(flipLoop, '취소 반영 루프에는 restore 스위치가 걸리지 않아야 한다');
});

test('§3 — 자연키/occurrenceIndex/schema는 건드리지 않는다', () => {
  assert.match(core, /occurrenceIndex\}`/, 'naturalKeyStr에 occurrenceIndex가 그대로 남아야 한다');
  // occurrenceIndex를 **값으로 쓰는** 곳은 insert(createMany) 하나뿐이어야 한다.
  const writesOccurrence = core.match(/occurrenceIndex: row\.occurrenceIndex/g) ?? [];
  assert.equal(writesOccurrence.length, 1, 'occurrenceIndex를 쓰는 곳은 insert 하나뿐이어야 한다');
  assert.ok(!/prisma\.apartmentTradeHistory\.update\(\{[\s\S]{0,240}?occurrenceIndex/.test(core), 'UPDATE가 occurrenceIndex를 건드리면 안 된다');
});

test('§7 — 형제 수가 다르면 정책이 아무것도 하지 않는다(코드 계약)', () => {
  assert.match(
    policy,
    /if \(sourceRows\.length !== existingRows\.length\)[\s\S]{0,160}SIBLING_COUNT_MISMATCH/,
    '형제 수 불일치는 추측 없이 skip이어야 한다'
  );
});

test('§4 — 형제 선택이 결정적이다(응답 순서에 의존하지 않는다)', () => {
  assert.match(policy, /sort\(\(a, b\) => a\.occurrenceIndex - b\.occurrenceIndex \|\| a\.id - b\.id\)/, '취소 후보는 오름차순');
  assert.match(policy, /sort\(\(a, b\) => b\.occurrenceIndex - a\.occurrenceIndex \|\| b\.id - a\.id\)/, '치유 후보는 내림차순');
  assert.ok(
    !/sourceRows\[\d\]\.dealCanceled/.test(policy),
    '원천 배열의 위치로 판단하면 안 된다 — 개수로만 판단해야 한다'
  );
});

test('§5 — 양방향이 가능하다(단방향 래칫 표현이 정책에서 사라졌다)', () => {
  assert.match(policy, /toRestore/, 'true→false 경로가 있어야 한다');
  assert.match(policy, /toCancel/, 'false→true 경로가 있어야 한다');
  // 기존 classifyRow의 래칫 분류는 남아 있어도 되지만(다른 진단 스크립트가 쓴다),
  // sale-sync-core가 그것으로 쓰기를 만들지 않는 것이 이 STEP의 계약이다.
  assert.ok(!/updateTrueToFalseSkipped/.test(core), 'ingest core 코드는 더 이상 래칫 분류를 참조하지 않는다(주석 제외)');
});
