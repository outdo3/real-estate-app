import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decideSupplyRegion, supplyCheckFrom } from './supply-region-gate';
import { GYEONGGI_BETA_LAWDCDS, SEOUL_BETA_LAWDCDS, getSidoEnablement, simulateRegionEnablement } from '../region/enablement';
import { REGION_NODES } from '../region/registry';

// GYEONGGI_8_PREVIEW_FINAL_BLOCKER_V1 — /api/stats/supply 지역 게이트 회귀 테스트(DB·네트워크 0).
// 런타임(= Production 설정) 판정 + 경기 beta 스위치를 켠 시뮬레이션(beta 8구 축) 둘 다 본다.

const ROOT = resolve(__dirname, '../../..');
const nameOf = (lawdCd: string) => REGION_NODES.find((n) => n.lawdCd === lawdCd)!.name;
const GG = '경기도';
const BETA_ON = supplyCheckFrom(
  (c) => simulateRegionEnablement(c, { seoulBeta: true, gyeonggiBeta: true }),
  (c) => getSidoEnablement(c)
);

test('1·2. Production: 41111 장안구·41135 분당구 차단', () => {
  assert.deepEqual(decideSupplyRegion(GG, '장안구'), { allowed: false, reason: 'REGION_NOT_ENABLED' });
  assert.deepEqual(decideSupplyRegion(GG, '분당구'), { allowed: false, reason: 'REGION_NOT_ENABLED' });
  for (const c of GYEONGGI_BETA_LAWDCDS) assert.equal(decideSupplyRegion(GG, nameOf(c)).allowed, false, c);
});

test('3·4. 경기 beta를 켜도(시뮬레이션) 8구·41135 모두 차단 — supply 축 닫힘', () => {
  for (const c of GYEONGGI_BETA_LAWDCDS) {
    assert.equal(simulateRegionEnablement(c, { seoulBeta: true, gyeonggiBeta: true }).app, true, `${c} 시뮬레이션이 켜지지 않았다`);
    assert.deepEqual(decideSupplyRegion(GG, nameOf(c), BETA_ON), { allowed: false, reason: 'REGION_NOT_ENABLED' }, c);
  }
  assert.equal(decideSupplyRegion(GG, '분당구', BETA_ON).allowed, false);
  assert.deepEqual(decideSupplyRegion(GG, null, BETA_ON), { allowed: false, reason: 'SIDO_WHOLE_NOT_SUPPORTED' });
});

test('5. 모르는 경기·경기 전체·registry 밖 시도 차단', () => {
  assert.deepEqual(decideSupplyRegion(GG, '없는구'), { allowed: false, reason: 'UNKNOWN_REGION' });
  assert.deepEqual(decideSupplyRegion(GG, null), { allowed: false, reason: 'SIDO_WHOLE_NOT_SUPPORTED' });
  assert.deepEqual(decideSupplyRegion(GG, ''), { allowed: false, reason: 'SIDO_WHOLE_NOT_SUPPORTED' });
  for (const other of REGION_NODES.filter((n) => n.sidoCode === '41')) {
    assert.equal(decideSupplyRegion(GG, other.name).allowed, false, other.lawdCd);
  }
  for (const sido of ['대구광역시', '인천광역시', '경기', 'Gyeonggi', '']) {
    assert.deepEqual(decideSupplyRegion(sido, null), { allowed: false, reason: 'UNKNOWN_REGION' }, sido);
  }
});

test('6. 부산: 시도 전체와 16구 전부 그대로 허용', () => {
  assert.deepEqual(decideSupplyRegion('부산광역시', null), { allowed: true, sidoCode: '26', lawdCd: null });
  const busan = REGION_NODES.filter((n) => n.sidoCode === '26');
  assert.equal(busan.length, 16);
  for (const n of busan) assert.deepEqual(decideSupplyRegion('부산광역시', n.name), { allowed: true, sidoCode: '26', lawdCd: n.lawdCd }, n.name);
  assert.equal(decideSupplyRegion('부산광역시', '해운대구', BETA_ON).allowed, true, '경기 스위치와 무관');
});

test('7. 서울: beta 8구 허용(기존 정책), "서울 전체"·나머지 17구 차단', () => {
  for (const c of SEOUL_BETA_LAWDCDS) assert.deepEqual(decideSupplyRegion('서울특별시', nameOf(c)), { allowed: true, sidoCode: '11', lawdCd: c }, c);
  const blocked = REGION_NODES.filter((n) => n.sidoCode === '11' && !(SEOUL_BETA_LAWDCDS as readonly string[]).includes(n.lawdCd));
  assert.equal(blocked.length, 17);
  for (const n of blocked) assert.equal(decideSupplyRegion('서울특별시', n.name).allowed, false, n.lawdCd);
  assert.equal(decideSupplyRegion('서울특별시', null).allowed, false);
});

test('8. 부모 시로 넓어지지 않는다 — 수원시·성남시는 자기 노드(닫힘)로 판정', () => {
  assert.deepEqual(decideSupplyRegion(GG, '수원시', BETA_ON), { allowed: false, reason: 'REGION_NOT_ENABLED' });
  assert.deepEqual(decideSupplyRegion(GG, '성남시', BETA_ON), { allowed: false, reason: 'REGION_NOT_ENABLED' });
});

test('9. 이름 우회 없음 — 다른 시도 조합·전체 이름·공백·부분 일치 모두 차단', () => {
  assert.equal(decideSupplyRegion('부산광역시', '장안구').allowed, false, '부산 sido로 경기 구 이름');
  assert.equal(decideSupplyRegion('서울특별시', '분당구').allowed, false);
  // 선택기가 보내는 "수원시 장안구"는 fullName 정확 일치로 41111이 되고, 그 노드의 supply 축(닫힘)으로 판정된다
  assert.deepEqual(decideSupplyRegion(GG, '수원시 장안구', BETA_ON), { allowed: false, reason: 'REGION_NOT_ENABLED' });
  assert.deepEqual(decideSupplyRegion(GG, '수원시 분당구', BETA_ON), { allowed: false, reason: 'UNKNOWN_REGION' }, '존재하지 않는 조합');
  assert.equal(decideSupplyRegion(GG, '성남시 분당구', BETA_ON).allowed, false);
  assert.deepEqual(decideSupplyRegion('부산광역시', '부산광역시 해운대구'), { allowed: false, reason: 'UNKNOWN_REGION' });
  assert.equal(decideSupplyRegion(GG, '경기도 수원시 장안구', BETA_ON).allowed, false);
  assert.equal(decideSupplyRegion(GG, '장안', BETA_ON).allowed, false);
  assert.equal(decideSupplyRegion(GG, ' 장안구 ', BETA_ON).allowed, false);
  assert.equal(decideSupplyRegion('부산광역시', '해운대').allowed, false, '부분 일치 금지');
  // 같은 짧은 이름(중구)은 지정한 시도의 노드로만 해석된다
  assert.deepEqual(decideSupplyRegion('부산광역시', '중구'), { allowed: true, sidoCode: '26', lawdCd: '26110' });
  assert.deepEqual(decideSupplyRegion('서울특별시', '중구'), { allowed: true, sidoCode: '11', lawdCd: '11140' });
});

test('라우트: 지역을 지정한 요청은 Presale 조회 전에 게이트를 거친다 · 서울 deny-list 없음', () => {
  const src = readFileSync(resolve(ROOT, 'src/app/api/stats/supply/route.ts'), 'utf8');
  const gate = src.indexOf('decideSupplyRegion(sidoFull, sigunguShort)');
  const read = src.indexOf('prisma.presale.findMany');
  assert.ok(gate > 0 && read > gate, '게이트가 조회보다 먼저여야 한다');
  assert.ok(/if \(sidoFull\) \{\s*const decision = decideSupplyRegion/.test(src));
  assert.ok(!/isSeoulPublicBlocked|SEOUL_SHORT|startsWith\(/.test(src.replace(/\/\/.*$/gm, '')));
});
