import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import path from 'path';

// SCHOOL V2-D1 §21/§29 — source-content guard. DOM 렌더링 테스트 프레임워크가 이
// 프로젝트에 없어(node:test 기준, 기존 관례) 소스 문자열 검사로 회귀를 막는다.
const PANEL_SRC = readFileSync(path.resolve(__dirname, 'EducationPanel.tsx'), 'utf-8');
const ROUTE_SRC = readFileSync(path.resolve(__dirname, '../app/api/apt/[name]/education/route.ts'), 'utf-8');

test('client component가 attendance-zone artifact 헬퍼를 직접 import하지 않는다(server route에서만 호출)', () => {
  assert.ok(!PANEL_SRC.includes("from '@/lib/education/attendance-zone'"));
  assert.ok(!PANEL_SRC.includes('readFileSync'));
});

test('client component 소스에 "배정학교" 표현이 없다', () => {
  assert.ok(!PANEL_SRC.includes('배정학교'));
});

test('client component 소스에 "도보" 표현이 없다(직선거리만 사용)', () => {
  assert.ok(!PANEL_SRC.includes('도보'));
});

test('client component 소스에 emoji가 없다(Lucide 아이콘만 사용)', () => {
  const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.ok(!emojiPattern.test(PANEL_SRC));
});

test('client component가 어린이집을 "0곳"/"없음"으로 표시하지 않는다', () => {
  assert.ok(!PANEL_SRC.includes('어린이집 0'));
  assert.ok(!/어린이집[^\n]{0,10}없/.test(PANEL_SRC));
});

test('client component가 학생수/학급수/교사수 등 SchoolInfo 통계를 표시하지 않는다(DB 0 rows)', () => {
  assert.ok(!PANEL_SRC.includes('학생수'));
  assert.ok(!PANEL_SRC.includes('학급수'));
  assert.ok(!PANEL_SRC.includes('교사수'));
});

test('client component가 졸업생 진로 section을 만들지 않는다(데이터 없음, "준비 중" 남발 금지)', () => {
  assert.ok(!PANEL_SRC.includes('졸업생'));
  assert.ok(!PANEL_SRC.includes('진로'));
});

test('education API route가 5.76MB artifact를 읽는 헬퍼(getApartmentEducationZone)를 서버에서만 호출한다', () => {
  assert.ok(ROUTE_SRC.includes('getApartmentEducationZone'));
  assert.ok(!ROUTE_SRC.includes("'use client'"));
});
