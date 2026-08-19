import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestRecord } from './ingest';
import { InMemoryRedevelopmentStore } from './inMemoryStore';
import { SOURCE_BUSAN, SOURCE_MOLIT } from './types';
import type { ParsedSourceRecord } from './types';

function molitRecord(overrides: Partial<ParsedSourceRecord> = {}): ParsedSourceRecord {
  return {
    source: SOURCE_MOLIT,
    sourceRecordId: 'molit-seodaesin4',
    rawName: '서대신4',
    sido: '부산광역시',
    sigungu: '서구',
    rawBusinessType: '1)재개발(주택정비)',
    rawBusinessTypeCode: '1',
    businessType: 'REDEVELOPMENT',
    rawStage: '7)착공',
    rawStageCode: '7',
    stage: 'CONSTRUCTION',
    rawHouseholdCount: '542',
    householdCount: 542,
    rawLocation: null,
    rawPayload: {},
    normalizedName: '서대신4',
    ...overrides,
  };
}

// R3A "서대신4" 사례 그대로(docs/development/R3A-redevelopment-location-matching-pilot.md
// "EXACT" 정의의 실제 예시: "서대신4/서구/재개발/재개발" — 국토부/부산 양쪽의
// normalizedName이 둘 다 "서대신4"로 일치해야 EXACT가 된다. Busan areaName이 항상
// 유형 접미사를 포함하는 건 아니라는 뜻이므로(예: "구서4 재건축"처럼 접미사가 붙는
// 레코드도 실측되지만, 이 사례는 접미사 없는 원본으로 문서에 기록됨) 테스트도 문서에
// 기록된 실제 값을 그대로 따른다.
function busanRecord(overrides: Partial<ParsedSourceRecord> = {}): ParsedSourceRecord {
  return {
    source: SOURCE_BUSAN,
    sourceRecordId: 'BARA_00001',
    rawName: '서대신4',
    sido: '부산광역시',
    sigungu: '서구',
    rawBusinessType: null,
    rawBusinessTypeCode: null,
    businessType: 'REDEVELOPMENT',
    rawStage: '착공',
    rawStageCode: null,
    stage: 'CONSTRUCTION',
    rawHouseholdCount: '542',
    householdCount: 542,
    rawLocation: '대영로45번길20, 3층(서대신동2가)',
    rawPayload: {},
    normalizedName: '서대신4',
    ...overrides,
  };
}

test('ingestRecord — 첫 레코드는 새 Project를 만든다', async () => {
  const store = new InMemoryRedevelopmentStore();
  const outcome = await ingestRecord(store, molitRecord(), new Date());
  assert.equal(outcome.action, 'created_project');
  assert.equal(store.getAllProjects().length, 1);
  assert.equal(store.getAllSourceRecords().length, 1);
});

test('ingestRecord — EXACT 매칭 시 기존 Project에 연결(새 Project 생성 안 함)', async () => {
  const store = new InMemoryRedevelopmentStore();
  await ingestRecord(store, molitRecord(), new Date());
  // 같은 sido+sigungu+normalizedName+businessType — EXACT
  const second = molitRecord({ source: SOURCE_BUSAN, sourceRecordId: 'busan-exact', rawName: '서대신4' });
  const outcome = await ingestRecord(store, second, new Date());
  assert.equal(outcome.action, 'matched_existing');
  assert.equal(outcome.matchConfidence, 'EXACT');
  assert.equal(store.getAllProjects().length, 1);
  assert.equal(store.getAllSourceRecords().length, 2);
});

test('idempotency — 같은 레코드를 두 번 넣어도 project/sourceRecord 수가 늘지 않는다', async () => {
  const store = new InMemoryRedevelopmentStore();
  const rec = molitRecord();
  await ingestRecord(store, rec, new Date());
  const afterFirst = { projects: store.getAllProjects().length, records: store.getAllSourceRecords().length };

  await ingestRecord(store, rec, new Date());
  const afterSecond = { projects: store.getAllProjects().length, records: store.getAllSourceRecords().length };

  assert.deepEqual(afterSecond, afterFirst);
  assert.equal(afterFirst.projects, 1);
  assert.equal(afterFirst.records, 1);
});

test('idempotency — MOLIT+BUSAN 두 소스를 반복 ingest해도 1 project + 2 sourceRecord로 수렴', async () => {
  const store = new InMemoryRedevelopmentStore();
  const molit = molitRecord();
  const busan = busanRecord();

  for (let i = 0; i < 3; i++) {
    await ingestRecord(store, molit, new Date());
    await ingestRecord(store, busan, new Date());
  }

  assert.equal(store.getAllProjects().length, 1);
  assert.equal(store.getAllSourceRecords().length, 2);
});

test('거제2 재개발 vs 거제2 재건축 — 서로 다른 Project로 유지(오매칭 방지 회귀 테스트)', async () => {
  const store = new InMemoryRedevelopmentStore();
  const a = molitRecord({
    sourceRecordId: 'a',
    rawName: '거제2 재개발',
    normalizedName: '거2재개발',
    businessType: 'REDEVELOPMENT',
  });
  const b = molitRecord({
    sourceRecordId: 'b',
    rawName: '거제2 재건축',
    normalizedName: '거2재건축',
    businessType: 'RECONSTRUCTION',
  });
  await ingestRecord(store, a, new Date());
  const outcomeB = await ingestRecord(store, b, new Date());

  assert.equal(outcomeB.action, 'created_project');
  assert.equal(store.getAllProjects().length, 2);
});

test('촉진5(금정구) vs 촉진5(영도구) — 동명이인은 별도 Project로 유지', async () => {
  const store = new InMemoryRedevelopmentStore();
  const a = molitRecord({ sourceRecordId: 'a', sigungu: '금정구', rawName: '촉진5', normalizedName: '촉진5' });
  const b = molitRecord({ sourceRecordId: 'b', sigungu: '영도구', rawName: '촉진5', normalizedName: '촉진5' });
  await ingestRecord(store, a, new Date());
  const outcomeB = await ingestRecord(store, b, new Date());

  assert.equal(outcomeB.action, 'created_project');
  assert.equal(store.getAllProjects().length, 2);
});

test('MEDIUM 매칭 — REVIEW_REQUIRED로 새 Project 생성 + needsReview=true', async () => {
  const store = new InMemoryRedevelopmentStore();
  await ingestRecord(store, molitRecord(), new Date());
  const similar = molitRecord({
    sourceRecordId: 'medium-case',
    source: SOURCE_BUSAN,
    normalizedName: '서대신4가',
    householdCount: 560,
    rawHouseholdCount: '560',
  });
  const outcome = await ingestRecord(store, similar, new Date());
  assert.equal(outcome.mergeStatus, 'REVIEW_REQUIRED');
  assert.equal(outcome.needsReview, true);
  assert.equal(store.getAllProjects().length, 2);
});

test('canonical 재계산 — BUSAN 레코드가 연결되면 Project.stage/householdCount가 BUSAN 값으로 갱신(source priority)', async () => {
  const store = new InMemoryRedevelopmentStore();
  await ingestRecord(
    store,
    molitRecord({ stage: 'ZONE_DESIGNATED', rawStage: '2)정비구역지정', householdCount: null, rawHouseholdCount: '0' }),
    new Date()
  );
  await ingestRecord(store, busanRecord(), new Date());

  const project = store.getAllProjects()[0];
  assert.equal(project.stage, 'CONSTRUCTION'); // BUSAN 우선
  assert.equal(project.householdCount, 542); // BUSAN 우선
  assert.equal(project.primarySource, SOURCE_MOLIT); // 존재/canonicalName은 MOLIT 우선
});

test('R4.1 — classifyLocationText 배선: office 의심 location(3층)이면 Project.locationType=OFFICE', async () => {
  const store = new InMemoryRedevelopmentStore();
  await ingestRecord(store, molitRecord(), new Date());
  await ingestRecord(store, busanRecord(), new Date()); // rawLocation: "...3층(서대신동2가)"

  const project = store.getAllProjects()[0];
  assert.equal(project.locationType, 'OFFICE');
  assert.equal(project.locationConfidence, 'LOW');
  assert.equal(project.geocodeStatus, 'NOT_ATTEMPTED'); // 좌표는 채우지 않는다(섹션 24)
  assert.equal(project.lat, undefined); // 좌표 필드 자체를 건드리지 않음
});

test('R4.1 — classifyLocationText 배선: 명확한 번지/일원 표현이면 PROJECT_SITE', async () => {
  const store = new InMemoryRedevelopmentStore();
  await ingestRecord(store, molitRecord({ sourceRecordId: 'm2', rawName: '당감1', normalizedName: '당감1' }), new Date());
  await ingestRecord(
    store,
    busanRecord({
      sourceRecordId: 'b2',
      rawName: '당감1',
      normalizedName: '당감1',
      rawLocation: '당감동 479-2번지 일원(무궁화)',
    }),
    new Date()
  );

  const project = store.getAllProjects()[0];
  assert.equal(project.locationType, 'PROJECT_SITE');
  assert.equal(project.locationConfidence, 'HIGH');
});
