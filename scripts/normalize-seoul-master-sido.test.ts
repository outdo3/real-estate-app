import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applyGates, assertAffected, checkBaseline, diffSnapshots, FROM_SIDO, TO_SIDO, type Baseline } from './normalize-seoul-master-sido';
import { SEOUL_SIDO_SHORT, toCreateData, type SeedRow } from './seed-seoul-apartment-master-logic';
import { getSido } from '../src/lib/region/registry';

// SEOUL_MASTER_SIDO_NORMALIZATION_V1 — ApartmentMaster.sido = registry 축약 표기(부산·서울·경기).

const src = (p: string) => readFileSync(resolve(__dirname, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const row = (): SeedRow => ({
  aptSeq: '11140-1', district: '11140', districtName: '중구', dong: '신당동', umdCd: '16200', jibun: '844', name: '남산타운', normalizedName: '남산타운',
  buildYear: 2002, tradeCount: 1, sourceCell: '11140:202609', lat: 37.5, lng: 127, coordinateSource: 'KAKAO_ADDRESS_EXACT_LOT_REVERSE_VERIFIED',
  coordinateConfidence: 'EXACT_LOT_BOTH_DIRECTIONS', coordinateStatus: 'VERIFIED', targetLot: '중구 신당동 844', forwardAddress: null, forwardLat: 37.5,
  forwardLng: 127, reverseAddress: null, reverseLot: null, coordinateReason: null, status: 'READY', reasons: [],
});
const base = (o: Partial<Baseline> = {}): Baseline => ({ seoulTotal: 6843, seoulFull: 6843, seoulShort: 0, seoulUniqueAptSeq: 6843, busanTotal: 3438, targetRows: 6843, targetNonSeoul: 0, ...o });

test('1·2 · 서울 seed는 sido=서울, "서울특별시"를 내지 않는다', () => {
  assert.equal(toCreateData(row()).sido, '서울');
  assert.ok(!/서울특별시/.test(src('seed-seoul-apartment-master-logic.ts').replace(/SEOUL_DISTRICTS[\s\S]*?\]\.map/, '')), 'seed 로직에 전체 명칭 literal이 없다');
});

test('3·4 · registry 축약 표기가 canonical — 부산 관행(부산) 그대로, 서울은 registry에서 가져온다', () => {
  assert.equal(getSido('26')!.shortName, '부산');
  assert.equal(getSido('11')!.shortName, '서울');
  assert.equal(getSido('41')!.shortName, '경기');
  assert.equal(SEOUL_SIDO_SHORT, getSido('11')!.shortName);
  assert.match(src('seed-seoul-apartment-master-logic.ts'), /SEOUL_SIDO_SHORT: string = getSido\('11'\)!\.shortName/);
  assert.equal(FROM_SIDO, '서울특별시');
  assert.equal(TO_SIDO, '서울');
});

test('5 · large-complex의 master 조회 값(registry shortName) = 서울 master sido', () => {
  const route = readFileSync(resolve(__dirname, '../src/app/api/stats/large-complex/route.ts'), 'utf8');
  assert.match(route, /sido: getSido\(sidoCodeParam\)\?\.shortName/);
  assert.equal(getSido('11')!.shortName, toCreateData(row()).sido);
});

test('6 · 점수 peer-context는 대상 master의 sido로 같은 sido master를 모은다 — 서울은 모두 "서울"', () => {
  const peer = readFileSync(resolve(__dirname, '../src/lib/apartment-score/peer-context.ts'), 'utf8');
  assert.match(peer, /where: \{ sido, aptSeq: \{ not: null \} \}/);
  const scoreRoute = readFileSync(resolve(__dirname, '../src/app/api/apt/[name]/score/route.ts'), 'utf8');
  assert.match(scoreRoute, /\}, targetMaster\.sido\);/);
});

test('7 · 다른 지역 변경 없음 — 이중 조건 UPDATE, 대상에 서울 밖 행이 있으면 거부', () => {
  const s = src('normalize-seoul-master-sido.ts');
  assert.match(s, /UPDATE apartment_masters SET sido = \$1 WHERE sido = \$2 AND sgg_cd LIKE '11%'/);
  assert.ok(!/\.(update|updateMany|upsert|delete|deleteMany|create)\s*\(/.test(s), 'Prisma 쓰기 메서드 없음(raw UPDATE 1개)');
  assert.deepEqual(checkBaseline(base({ targetNonSeoul: 1 }), 6843, 3438).reasons, ['TARGET_HAS_NON_SEOUL_1']);
  assert.deepEqual(checkBaseline(base({ busanTotal: 3437 }), 6843, 3438).reasons, ['BUSAN_3437_NE_3438']);
});

test('8 · 영향 행 수 가드 · baseline 가드 · apply 게이트', () => {
  assert.doesNotThrow(() => assertAffected(6843, 6843));
  assert.throws(() => assertAffected(6844, 6843), /AFFECTED_ROWS_6844_NE_6843/);
  assert.equal(checkBaseline(base(), 6843, 3438).ok, true);
  assert.ok(checkBaseline(base({ seoulFull: 6800, seoulShort: 43 }), 6843, 3438).reasons.includes('SEOUL_ALREADY_SHORT_43'));
  assert.ok(checkBaseline(base({ seoulTotal: 6844 }), 6843, 3438).reasons.includes('SEOUL_TOTAL_6844_NE_6843'));
  assert.deepEqual(applyGates(['--apply', '--expect=6843'], {}).reasons, ['ALLOW_PROD_DB_WRITE_NOT_1']);
  assert.deepEqual(applyGates(['--apply'], { ALLOW_PROD_DB_WRITE: '1' }).reasons, ['EXPECT_REQUIRED']);
  assert.deepEqual(applyGates([], {}), { apply: false, expected: null, reasons: [] });
});

test('스냅샷 비교 — sido 외 컬럼 변경을 잡는다', () => {
  const before = [{ id: 1, sido: '서울특별시', name: 'a', latitude: 1 }, { id: 2, sido: '서울특별시', name: 'b', latitude: null }];
  assert.deepEqual(diffSnapshots(before, [{ id: 1, sido: '서울', name: 'a', latitude: 1 }, { id: 2, sido: '서울', name: 'b', latitude: null }], ['sido']), { missing: 0, unexpected: [], extra: 0 });
  assert.equal(diffSnapshots(before, [{ id: 1, sido: '서울', name: 'x', latitude: 1 }, { id: 2, sido: '서울', name: 'b', latitude: null }], ['sido']).unexpected.length, 1);
});
