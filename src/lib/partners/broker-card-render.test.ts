import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// E-JIP PARTNER BROKER CARD UI V1 — 실제 컴포넌트를 서버 렌더해 표시 계약을 확인한다.
// CSS 모듈은 Node에서 읽을 수 없으므로 클래스 이름을 그대로 돌려주는 스텁으로 대신한다.
const extensions = (Module as unknown as { _extensions: Record<string, (m: { exports: unknown }) => void> })._extensions;
extensions['.css'] = (m) => {
  // esbuild의 ESM interop은 own property만 복사하므로 default는 실제 키여야 한다.
  const classNames = new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : undefined) });
  m.exports = { __esModule: true, default: classNames };
};

const BrokerCtaCard = require('../../components/partner/BrokerCtaCard').default as (props: { lawdCd?: string | null; dong?: string | null }) => unknown;

const render = (props: { lawdCd?: string | null; dong?: string | null }) =>
  renderToStaticMarkup(createElement(BrokerCtaCard as never, props));

test('영업 구역 안에서 카드가 렌더되고 파트너 정보가 그대로 보인다', () => {
  const html = render({ lawdCd: '26140', dong: '서대신동3가' });
  assert.match(html, /<aside[^>]*class="card brokerCard"/);
  assert.match(html, /aria-label="이 단지 상담 가능한 중개사 안내"/);
  assert.match(html, /data-export-exclude=""/, '리포트/인쇄 제외 표시가 사라졌다');
  assert.match(html, /<p class="brokerBadge">지역 중개 상담<\/p>/);
  assert.match(html, /<h2 class="brokerTitle">이 지역 중개가 필요하신가요\?<\/h2>/);
  assert.match(html, /<p class="partnerName">롯데부동산중개사무소<\/p>/);
  assert.match(html, /<p class="partnerSub">심은희 공인중개사<\/p>/);
  assert.match(html, /<span class="brokerPhoneNumber">051-714-2225<\/span>/);
  assert.match(html, /<p class="brokerArea">서대신동·동대신동·부민동·부용동 아파트 매매·전세 상담<\/p>/);
  assert.match(html, /중개사무소 등록번호 <\/span><span class="metaValue">제26140-2024-00019호<\/span>/);
  assert.match(html, /부산 서구 대티로 161, 301동 201호/);
});

test('전화 상담 버튼: tel 링크 정확, 링크는 하나뿐, 번호는 링크 밖 텍스트', () => {
  const html = render({ lawdCd: '26140', dong: '부민동1가' });
  const links = html.match(/<a [^>]*>/g) ?? [];
  assert.equal(links.length, 1, `링크가 ${links.length}개다`);
  assert.match(links[0], /href="tel:0517142225"/);
  assert.match(links[0], /aria-label="롯데부동산중개사무소에 전화 상담 연결"/);
  assert.match(html, /<a [^>]*>.*전화 상담<\/a>/);
  assert.doesNotMatch(html.match(/<a [\s\S]*?<\/a>/)?.[0] ?? '', /051-714-2225/, '번호가 링크 안에 있다');
  // 문구 위계: 제목 → 상호 → 전화번호 → 버튼 → (구분선) 등록번호.
  const order = ['brokerTitle', 'partnerName', 'brokerPhoneNumber', 'brokerPrimary', 'brokerTrust'].map((c) => html.indexOf(c));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `위계 순서가 어긋났다: ${order}`);
});

test('영업 구역 밖이거나 위치를 모르면 렌더하지 않는다(노출 집계도 없음)', () => {
  assert.equal(render({ lawdCd: '26140', dong: '남부민동' }), '');
  assert.equal(render({ lawdCd: '26140', dong: null }), '');
  assert.equal(render({ lawdCd: null, dong: '서대신동3가' }), '');
});
