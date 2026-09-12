import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { allPartners, getBrokerForLocation, getPartnerForPlacement, telHref } from './config';
import { PARTNER_TYPES } from './types';
import { sanitizeGaParams } from '../analytics/ga';
import {
  TRADE_ROWS_COLLAPSED,
  TRADE_ROWS_STEP,
  canCollapseTrades,
  canExpandTrades,
  nextVisibleCount,
  visibleTrades,
} from '../apt-detail/trade-rows';

/**
 * APT_DETAIL_PARTNER_TRADE_DENSITY_V1 §26 — 중개사 파일럿 + 실거래 밀도 계약.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 설계를 설명하느라 금지 토큰을 언급한다 — 화면 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const LEGAL_CARD = read('src/components/partner/PartnerCtaCard.tsx');
const BROKER_CARD = read('src/components/partner/BrokerCtaCard.tsx');
const APT_CLIENT = read('src/app/apt/[name]/apt-client.tsx');
const TIMELINE = read('src/components/TradeTimelineList.tsx');

// ── A. 사용자에게 보이는 문구(§2) ──────────────────────────────────────────

test('§2 "광고·제휴"가 더 이상 화면에 렌더되지 않는다', () => {
  for (const [name, src] of [['법무사 카드', LEGAL_CARD], ['중개사 카드', BROKER_CARD]] as const) {
    const code = codeOf(src);
    for (const word of ['광고·제휴', '광고', 'Sponsored', 'AD']) {
      assert.ok(!code.includes(`>${word}<`), `${name}에 "${word}"가 렌더된다`);
    }
    assert.ok(!/광고·제휴/.test(code), `${name}에 광고·제휴 배지가 남아 있다`);
  }
});

test('§2 파트너 식별/추적 의미는 그대로다 — 표시만 바뀌었다', () => {
  const p = getPartnerForPlacement('apt_detail');
  assert.ok(p);
  assert.equal(p.id, 'hwangbo-jaeho-legal');
  assert.equal(p.type, 'legal_office');
  assert.ok(PARTNER_TYPES.includes('legal_office'));
  assert.ok(PARTNER_TYPES.includes('brokerage'));
});

test('§3 법무사 카드의 섹션 제목과 본문이 지정된 축약본이다', () => {
  assert.ok(LEGAL_CARD.includes('부동산 등기 상담'));
  assert.ok(LEGAL_CARD.includes('매매 이후 등기 절차가 필요할 때 상담할 수 있습니다.'));
  // 예전 긴 제목/본문은 사라졌다.
  assert.ok(!LEGAL_CARD.includes('부동산 등기 상담이 필요하신가요?'));
  assert.ok(!LEGAL_CARD.includes('매매 이후 등기 절차와 관련해 상담이 필요할 경우'));
});

// ── B. 전화번호 비노출(§4/§9/§25) ──────────────────────────────────────────

test('§4 법무사 전화번호가 화면·aria 어디에도 쓰이지 않는다', () => {
  const code = codeOf(LEGAL_CARD);
  assert.ok(!code.includes('010-8026-4778'), '번호가 하드코딩돼 있다');
  assert.ok(!code.includes('displayPhone'), '표시용 번호를 렌더한다');
  assert.ok(!code.includes('phoneNumber'), '번호 전용 노드가 남아 있다');
  // aria-label에도 번호가 없다.
  const arias = code.match(/aria-label=\{?[^}\n]*/g) ?? [];
  for (const a of arias) assert.ok(!/\d{3}-?\d{4}/.test(a), `aria에 번호가 있다: ${a}`);
});

test('§9 중개사 전화번호가 화면·aria 어디에도 쓰이지 않는다', () => {
  const code = codeOf(BROKER_CARD);
  assert.ok(!code.includes('051-714-2225'));
  assert.ok(!code.includes('displayPhone'));
  const arias = code.match(/aria-label=\{?[^}\n]*/g) ?? [];
  for (const a of arias) assert.ok(!/\d{3}-?\d{4}/.test(a), `aria에 번호가 있다: ${a}`);
});

test('§4/§9 tel: 링크는 그대로 동작한다 — 기능이 아니라 표시만 감췄다', () => {
  const legal = getPartnerForPlacement('apt_detail')!;
  assert.equal(telHref(legal), 'tel:01080264778');
  const broker = getBrokerForLocation({ lawdCd: '26140', dong: '서대신동3가' })!;
  assert.equal(telHref(broker), 'tel:0517142225');
  assert.ok(!telHref(broker).includes('-'));
});

test('§5 법무사 카카오 CTA는 그대로 살아 있고 원문 URL을 노출하지 않는다', () => {
  const legal = getPartnerForPlacement('apt_detail')!;
  assert.equal(legal.kakaoUrl, 'https://open.kakao.com/o/s7paR4Mi');
  assert.ok(LEGAL_CARD.includes('카카오 상담'));
  assert.ok(!codeOf(LEGAL_CARD).includes('open.kakao.com'), 'URL 원문이 화면 코드에 박혀 있다');
});

// ── C. 중개사 설정(§6) ─────────────────────────────────────────────────────

test('§6 중개사 파일럿 설정이 확인된 값 그대로다', () => {
  const b = getBrokerForLocation({ lawdCd: '26140', dong: '부용동1가' });
  assert.ok(b, '영업 구역 안인데 중개사가 없다');
  assert.equal(b.id, 'lotte-real-estate-seogu');
  assert.equal(b.type, 'brokerage');
  assert.equal(b.displayName, '롯데부동산중개사무소');
  assert.equal(b.representative, '심은희');
  assert.equal(b.displayPhone, '051-714-2225');
  assert.equal(b.registrationNumber, '제26140-2024-00019호');
  assert.equal(b.address, '부산 서구 대티로 161, 301동 201호');
  assert.equal(b.description, '서대신동·동대신동·부민동·부용동 아파트 매매·전세 상담');
});

test('§6 없는 채널을 지어내지 않는다', () => {
  const b = getBrokerForLocation({ lawdCd: '26140', dong: '부용동1가' })!;
  assert.equal(b.kakaoUrl, undefined, '중개사에 카카오 채널은 없다');
  const dump = JSON.stringify(b);
  for (const invented of ['http', 'www.', '@', 'logo', 'image', 'photo']) {
    assert.ok(!dump.includes(invented), `지어낸 값이 있다: ${invented}`);
  }
});

test('§6 설정에 확인되지 않은 홍보 문구가 없다', () => {
  const dump = JSON.stringify(allPartners());
  for (const claim of ['무료', '전문', '최고', '1위', '당일', '주말', '최저', '보장', '경력', '친절']) {
    assert.ok(!dump.includes(claim), `확인되지 않은 문구: ${claim}`);
  }
});

// ── D. 영업 구역 자격(§7/§21) — 이 STEP에서 가장 중요한 계약 ───────────────

/** Production ApartmentMaster(sgg_cd='26140') umd_name 실측값. */
const ELIGIBLE_DONGS = [
  '서대신동1가', '서대신동2가', '서대신동3가',
  '동대신동1가', '동대신동2가', '동대신동3가',
  '부민동1가', '부민동3가',
  '부용동1가',
];

test('§7 검증된 법정동에서는 중개사 카드가 나온다', () => {
  for (const dong of ELIGIBLE_DONGS) {
    assert.ok(getBrokerForLocation({ lawdCd: '26140', dong }), `${dong}에서 중개사가 없다`);
  }
});

test('§7 같은 서구라도 영업 구역 밖 법정동에서는 나오지 않는다', () => {
  // 서구의 나머지 실측 법정동 — 영업 구역이 아니다.
  const outside = [
    '암남동', '아미동2가', '충무동1가', '충무동2가', '충무동3가',
    '토성동1가', '토성동2가', '토성동3가', '토성동5가',
  ];
  for (const dong of outside) {
    assert.equal(getBrokerForLocation({ lawdCd: '26140', dong }), null, `${dong}에 중개사가 붙었다`);
  }
});

test('§7 남부민동은 잡히지 않는다 — 부분 문자열 매칭 금지의 실제 사례', () => {
  // '부민동'으로 contains 매칭하면 남부민동(단지 10곳)까지 잡힌다. 정확히 일치해야 한다.
  assert.equal(getBrokerForLocation({ lawdCd: '26140', dong: '남부민동' }), null);
  // 접두/접미가 붙은 변형도 전부 거부한다. 부용동2가·부민동2가는 파트너가 말한 구역에
  // 들어 있지만 ApartmentMaster에 단지가 하나도 없어 목록에 넣지 않았다(§7).
  for (const near of ['서대신동', '서대신동4가', '동대신동10가', '부용동2가', '부민동2가']) {
    assert.equal(getBrokerForLocation({ lawdCd: '26140', dong: near }), null, `${near}가 잡혔다`);
  }
  // 앞뒤 공백은 정규화되므로 유효한 동으로 인정된다.
  assert.ok(getBrokerForLocation({ lawdCd: '26140', dong: ' 서대신동3가 ' }));
});

test('§7 부산 서구가 아니면 나오지 않는다 — 이름이 아니라 lawdCd로 구를 확정한다', () => {
  // 같은 법정동 이름을 다른 구 코드로 물어도 거부한다.
  for (const lawdCd of ['26110', '26350', '11680', '27110', '28140', '29140', '30170']) {
    assert.equal(
      getBrokerForLocation({ lawdCd, dong: '서대신동3가' }),
      null,
      `lawdCd=${lawdCd}에서 중개사가 붙었다`
    );
  }
});

test('§7/§21 위치를 모르면 자격 없음이다 — 모르는 상태를 통과시키지 않는다', () => {
  assert.equal(getBrokerForLocation({ lawdCd: '26140', dong: '' }), null);
  assert.equal(getBrokerForLocation({ lawdCd: '', dong: '서대신동3가' }), null);
  assert.equal(getBrokerForLocation({ lawdCd: null, dong: null }), null);
  assert.equal(getBrokerForLocation({}), null);
});

test('§7 자격 판정에 단지명이 끼어들 자리가 없다', () => {
  // 인자는 lawdCd/dong뿐이다 — 이름을 넘길 방법 자체가 없다.
  const code = codeOf(read('src/lib/partners/config.ts'));
  const fn = code.slice(code.indexOf('export function getBrokerForLocation'), code.indexOf('export function getPartnerForPlacement'));
  assert.ok(!/displayName|name|normalizedName/.test(fn), '이름 매칭이 들어 있다');
  assert.ok(/serviceArea\.dongs\.includes\(dong\)/.test(fn), '정확 일치 매칭이 아니다');
  assert.ok(!/includes\(.*contains|startsWith|indexOf/.test(fn), '부분 문자열 매칭이 있다');
});

test('§23 중개사는 자금 계획(finance)에 올라가지 않는다', () => {
  assert.equal(getBrokerForLocation({ lawdCd: '26140', dong: '서대신동3가' }, 'finance'), null);
  const b = allPartners().find((p) => p.type === 'brokerage')!;
  assert.deepEqual([...b.placements], ['apt_detail']);
  const FINANCE = read('src/app/finance-fit/finance-fit-client.tsx');
  assert.ok(!/BrokerCtaCard/.test(FINANCE), '자금 계획에 중개사 카드가 들어갔다');
});

// ── E. 카드 UI 계약(§8/§10) ────────────────────────────────────────────────

test('§8 중개사 카드 문구가 지정된 대로다', () => {
  assert.ok(BROKER_CARD.includes('이 단지 상담 가능한 중개사'));
  assert.ok(BROKER_CARD.includes('공인중개사'));
  assert.ok(BROKER_CARD.includes('중개사무소 등록번호'));
  assert.ok(BROKER_CARD.includes('전화 문의'));
});

test('§8 아직 없는 흐름의 CTA를 넣지 않았다', () => {
  const code = codeOf(BROKER_CARD);
  for (const notYet of ['카카오 문의', '집 보러가기', '매물 보기', '상담 예약']) {
    assert.ok(!code.includes(notYet), `아직 없는 흐름의 CTA가 있다: ${notYet}`);
  }
});

test('§10 사진/로고 대신 기존 아이콘 라이브러리를 쓴다', () => {
  assert.ok(/from 'lucide-react'/.test(BROKER_CARD));
  assert.ok(/<Store\s*\/?>/.test(BROKER_CARD), '중립 아이콘이 없다');
  const code = codeOf(BROKER_CARD);
  assert.ok(!/<img|Image from 'next\/image'|backgroundImage/.test(code), '이미지 자산을 쓰고 있다');
});

test('§12 두 카드가 같은 스타일시트를 쓴다 — 시각 언어가 갈라지지 않는다', () => {
  assert.ok(/PartnerCtaCard\.module\.css/.test(LEGAL_CARD));
  assert.ok(/PartnerCtaCard\.module\.css/.test(BROKER_CARD));
});

test('§19/§11 중개사 카드는 단지 상세에만, 데이터 구역을 지난 뒤에 온다', () => {
  assert.ok(/<BrokerCtaCard lawdCd=\{lawdCdState\} dong=\{urlDong\} \/>/.test(APT_CLIENT));
  const brokerAt = APT_CLIENT.indexOf('<BrokerCtaCard');
  const timelineAt = APT_CLIENT.indexOf('<TradeTimelineList');
  assert.ok(timelineAt > -1 && brokerAt > timelineAt, '상담 카드가 데이터보다 앞에 있다');
});

// ── F. 분석(§20~§22) ───────────────────────────────────────────────────────

test('§20 두 카드가 같은 집계 훅을 쓴다', () => {
  for (const src of [LEGAL_CARD, BROKER_CARD]) {
    assert.ok(/usePartnerCta/.test(src));
  }
  const HOOK = read('src/components/partner/usePartnerCta.ts');
  assert.ok(/partner_cta_impression/.test(HOOK));
  assert.ok(/partner_cta_click/.test(HOOK));
  for (const param of ['partner_type', 'partner_id', 'placement', 'channel']) {
    assert.ok(HOOK.includes(param), `${param} 파라미터가 없다`);
  }
});

test('§22 클릭을 lead/conversion으로 부르지 않는다', () => {
  const HOOK = read('src/components/partner/usePartnerCta.ts');
  const code = codeOf(HOOK);
  for (const bad of ['lead', 'conversion', 'consultation_complete', 'contract']) {
    assert.ok(!new RegExp(`'[^']*${bad}[^']*'`).test(code), `성과처럼 읽히는 이름: ${bad}`);
  }
});

test('§20 분석 페이로드에 전화번호/상호가 새지 않는다', () => {
  const b = getBrokerForLocation({ lawdCd: '26140', dong: '서대신동3가' })!;
  const out = sanitizeGaParams({
    partner_type: b.type,
    partner_id: b.id,
    placement: 'apt_detail',
    channel: 'phone',
  });
  const dump = JSON.stringify(out);
  for (const leak of [b.phone, b.displayPhone, b.displayName, b.representative!, b.address!]) {
    assert.ok(!dump.includes(leak), `분석에 ${leak}가 샌다`);
  }
  assert.equal(out.partner_id, 'lotte-real-estate-seogu');
});

test('§21 자격이 없으면 노출 집계 자체가 일어나지 않는다', () => {
  const HOOK = codeOf(read('src/components/partner/usePartnerCta.ts'));
  // partner가 null이면 effect가 곧바로 빠져나간다 → impression 없음.
  assert.ok(/if \(!partner\) return;/.test(HOOK));
  // 카드도 null을 반환해 렌더 자체가 없다.
  assert.ok(/if \(!broker\) return null;/.test(codeOf(BROKER_CARD)));
});

// ── G. 실거래 밀도(§13~§17) ────────────────────────────────────────────────

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, order: i }));

test('§13 기본은 5행이다', () => {
  assert.equal(TRADE_ROWS_COLLAPSED, 5);
  assert.equal(visibleTrades(rows(30), TRADE_ROWS_COLLAPSED).length, 5);
});

test('§13/§15 기본 5행은 같은 신뢰 목록의 정확히 앞 5건이다', () => {
  const all = rows(30);
  const shown = visibleTrades(all, TRADE_ROWS_COLLAPSED);
  assert.deepEqual(shown, all.slice(0, 5));
  // 순서가 그대로다 — 재정렬하지 않는다.
  assert.deepEqual(shown.map((r) => r.order), [0, 1, 2, 3, 4]);
});

test('§13 5건 이하이면 더보기가 없다', () => {
  for (const n of [0, 1, 4, 5]) {
    assert.equal(canExpandTrades(n, TRADE_ROWS_COLLAPSED), false, `${n}건인데 더보기가 뜬다`);
  }
  assert.equal(canExpandTrades(6, TRADE_ROWS_COLLAPSED), true);
});

test('§14 더보기는 예전 기본값(15)까지 펼친다', () => {
  assert.equal(TRADE_ROWS_STEP, 15);
  assert.equal(nextVisibleCount(TRADE_ROWS_COLLAPSED), 15);
  const all = rows(15);
  assert.equal(visibleTrades(all, nextVisibleCount(5)).length, 15);
});

test('§14 15건보다 많아도 예전처럼 계속 더 볼 수 있다 — 행이 잠기지 않는다', () => {
  assert.equal(nextVisibleCount(15), 30);
  assert.equal(nextVisibleCount(30), 45);
  const all = rows(50);
  assert.deepEqual(visibleTrades(all, 30), all.slice(0, 30));
});

test('§14 접기는 5로 돌아가고, 펼쳐진 상태에서만 보인다', () => {
  assert.equal(canCollapseTrades(TRADE_ROWS_COLLAPSED), false, '접힌 상태에 접기가 뜬다');
  assert.equal(canCollapseTrades(15), true);
  assert.equal(canCollapseTrades(30), true);
});

test('§14 펼쳤다 접으면 처음과 똑같은 5건이다', () => {
  const all = rows(40);
  const before = visibleTrades(all, TRADE_ROWS_COLLAPSED);
  const expanded = visibleTrades(all, nextVisibleCount(TRADE_ROWS_COLLAPSED));
  const after = visibleTrades(all, TRADE_ROWS_COLLAPSED);
  assert.equal(expanded.length, 15);
  assert.deepEqual(after, before);
});

test('§16 평형/기간/거래유형이 바뀌면 접힌 상태로 돌아간다', () => {
  const reset = APT_CLIENT.slice(APT_CLIENT.indexOf('setVisibleCount(TRADE_ROWS_COLLAPSED);'));
  assert.ok(
    /setVisibleCount\(TRADE_ROWS_COLLAPSED\);\s*\}, \[selectedTradeArea, tradeTypeFilter, periodFilter, saleFilter\]\)/.test(reset),
    '필터 변경 시 리셋이 5로 돌아가지 않는다'
  );
});

test('§17 펼치기/접기에 조회가 끼지 않는다 — 거짓 "데이터 없음"이 생길 수 없다', () => {
  const code = codeOf(TIMELINE);
  // 이 컴포넌트는 이미 받은 목록을 자를 뿐이고 fetch를 하지 않는다.
  assert.ok(!/fetch\(|useSWR|useEffect/.test(code), '목록 컴포넌트가 조회를 한다');
  assert.ok(/visibleTrades\(trades, visibleCount\)/.test(code));
});

test('§15/§27 거래 데이터 경로는 건드리지 않았다', () => {
  const code = codeOf(read('src/lib/apt-detail/trade-rows.ts'));
  // 개수만 다루는 모듈이다 — 정렬/필터/취소/가격/식별자 판단이 없다.
  for (const forbidden of ['aptSeq', 'cancel', '취소', 'sort', 'price', 'area', 'queryTrades']) {
    assert.ok(!code.includes(forbidden), `개수 모듈에 데이터 판단이 섞였다: ${forbidden}`);
  }
  // 잘라내기는 앞에서부터만 — 중간을 건너뛰지 않는다.
  assert.ok(/trades\.slice\(0, Math\.max\(0, visibleCount\)\)/.test(code));
});

test('§25 더보기/접기에 의미 있는 aria 라벨이 있다', () => {
  assert.ok(TIMELINE.includes('aria-label="최근 실거래 더보기"'));
  assert.ok(TIMELINE.includes('aria-label="최근 실거래 접기"'));
});

test('§18 더보기/접기 터치 타깃이 44px 이상이다', () => {
  const buttons = TIMELINE.match(/minHeight: 44/g) ?? [];
  assert.ok(buttons.length >= 2, '두 버튼 모두 44px 타깃이 아니다');
});
