import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSchoolHref } from './school-link.ts';

test('buildSchoolHref: 좌표가 있으면 canonical id/name/lat/lng/lawdCd를 쿼리로 담은 링크를 만든다', () => {
  const href = buildSchoolHref({ name: '구덕초등학교', kakaoId: '8658997', lat: 35.1204, lng: 129.0125 }, '26140');
  assert.equal(href, '/school/8658997?name=%EA%B5%AC%EB%8D%95%EC%B4%88%EB%93%B1%ED%95%99%EA%B5%90&lat=35.1204&lng=129.0125&lawdCd=26140');
});

// 데이터 신뢰 원칙 — 좌표가 없으면(과거 캐시, 매칭 실패 등) 링크를 만들지 않는다.
// 이름만으로 재검색해 다른 학교(동명이교)로 이동시키지 않는다.
test('buildSchoolHref: 좌표가 없으면 null(name-only fallback 없음)', () => {
  assert.equal(buildSchoolHref({ name: '구덕초등학교', kakaoId: '8658997', lat: null, lng: null }, '26140'), null);
});

test('buildSchoolHref: lat만 없어도 null', () => {
  assert.equal(buildSchoolHref({ name: '구덕초등학교', kakaoId: '8658997', lat: null, lng: 129.0125 }, '26140'), null);
});

test('buildSchoolHref: NaN 좌표는 null(추정/오염된 값으로 링크를 만들지 않는다)', () => {
  assert.equal(buildSchoolHref({ name: '구덕초등학교', kakaoId: '8658997', lat: NaN, lng: 129.0125 }, '26140'), null);
});

// kakaoId가 없는 과거 데이터 형태에서도 최소한 name 기반 경로 세그먼트로 동작(하위 호환).
test('buildSchoolHref: kakaoId가 없으면 name을 id 세그먼트로 사용한다', () => {
  const href = buildSchoolHref({ name: '구덕초등학교', kakaoId: null, lat: 35.1204, lng: 129.0125 }, '26140');
  assert.ok(href.startsWith('/school/%EA%B5%AC%EB%8D%95%EC%B4%88%EB%93%B1%ED%95%99%EA%B5%90?'));
});

test('buildSchoolHref: lawdCd가 없어도 name/lat/lng는 그대로 담긴다', () => {
  const href = buildSchoolHref({ name: '구덕초등학교', kakaoId: '8658997', lat: 35.1204, lng: 129.0125 }, '');
  assert.ok(href.includes('lat=35.1204'));
  assert.ok(!href.includes('lawdCd='));
});
