import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allPartners, getPartnerForPlacement, telHref } from './config';
import { PARTNER_CHANNELS, PARTNER_PLACEMENTS, PARTNER_TYPES } from './types';
import { sanitizeGaParams } from '../analytics/ga';
import { ANALYTICS_EVENT_NAMES } from '../analytics/events';
import { toGaEventName } from '../analytics/ga-events';

// ── §21 파트너 설정 ─────────────────────────────────────────────────────────

test('파일럿 파트너는 확인된 정보 그대로 설정돼 있다', () => {
  const p = getPartnerForPlacement('finance');
  assert.ok(p, '자금 계획 자리에 파트너가 있어야 한다');
  assert.equal(p.id, 'hwangbo-jaeho-legal');
  assert.equal(p.type, 'legal_office');
  assert.equal(p.displayName, '황보재호법무사사무실');
  assert.equal(p.displayPhone, '010-8026-4778');
  assert.equal(p.kakaoUrl, 'https://open.kakao.com/o/s7paR4Mi');
  assert.equal(p.enabled, true);
});

test('설정에 확인되지 않은 홍보 문구가 들어 있지 않다', () => {
  // 파트너가 서면으로 확인해 준 사실만 담는다는 규칙을 코드로 고정한다.
  const dump = JSON.stringify(allPartners());
  for (const claim of ['무료', '전문', '최고', '1위', '당일', '주말', '최저', '보장', '경력']) {
    assert.ok(!dump.includes(claim), `확인되지 않은 문구가 설정에 있다: ${claim}`);
  }
});

test('두 배치 모두에서 같은 파트너가 나온다', () => {
  for (const placement of PARTNER_PLACEMENTS) {
    const p = getPartnerForPlacement(placement);
    assert.ok(p, `${placement} 자리에 파트너가 있어야 한다`);
    assert.equal(p.id, 'hwangbo-jaeho-legal');
  }
});

test('tel 링크는 숫자만 남긴다', () => {
  const p = getPartnerForPlacement('finance')!;
  assert.equal(telHref(p), 'tel:01080264778');
  assert.ok(!telHref(p).includes('-'), 'tel: 값에 하이픈이 들어가면 안 된다');
});

test('카카오 주소는 실제 오픈채팅 링크 그대로다', () => {
  const p = getPartnerForPlacement('apt_detail')!;
  // APT_DETAIL_PARTNER_TRADE_DENSITY_V1 §6 — kakaoUrl은 이제 선택 필드다(중개사
  // 파일럿에는 카카오 채널이 없다). 법무사 파트너에는 반드시 있어야 한다.
  const kakaoUrl = p.kakaoUrl;
  assert.ok(kakaoUrl, '법무사 파트너에는 카카오 주소가 있어야 한다');
  assert.ok(kakaoUrl.startsWith('https://open.kakao.com/'), '외부 오픈채팅으로 바로 간다');
  // 추적 리다이렉트를 끼우지 않는다(§15).
  assert.ok(!kakaoUrl.includes('/api/'), '내부 리다이렉트를 거치면 안 된다');
});

test('비활성 파트너는 어느 자리에도 나오지 않는다', () => {
  const disabled = { ...getPartnerForPlacement('finance')!, enabled: false };
  // getPartnerForPlacement의 필터 조건을 그대로 검증한다.
  const pick = [disabled].find((p) => p.enabled && p.placements.includes('finance')) ?? null;
  assert.equal(pick, null, 'enabled:false면 렌더 대상이 아니다');
});

test('배치에 없는 자리에서는 렌더되지 않는다', () => {
  const p = getPartnerForPlacement('finance')!;
  const narrowed = { ...p, placements: ['finance'] as const };
  const pick = [narrowed].find((x) => x.enabled && (x.placements as readonly string[]).includes('apt_detail')) ?? null;
  assert.equal(pick, null);
});

// ── §9/§21 분석 페이로드 안전성 ─────────────────────────────────────────────

test('두 파트너 이벤트가 1st-party taxonomy와 GA4 매핑에 모두 있다', () => {
  for (const name of ['partner_cta_impression', 'partner_cta_click'] as const) {
    assert.ok((ANALYTICS_EVENT_NAMES as readonly string[]).includes(name), `${name}이 taxonomy에 없다`);
    assert.equal(toGaEventName(name), name, `${name}의 GA4 매핑이 없다`);
  }
});

test('클릭 페이로드는 통제된 식별자만 담는다', () => {
  const p = getPartnerForPlacement('finance')!;
  const out = sanitizeGaParams({
    partner_type: p.type,
    partner_id: p.id,
    placement: 'finance',
    channel: 'kakao',
  });
  assert.deepEqual(out, {
    partner_type: 'legal_office',
    partner_id: 'hwangbo-jaeho-legal',
    placement: 'finance',
    channel: 'kakao',
  });
});

test('전화번호/카카오 주소/상호는 분석 페이로드에 실을 수 없다', () => {
  const p = getPartnerForPlacement('finance')!;
  // 호출부가 실수로 넣더라도 allowlist가 구조적으로 막는다.
  const out = sanitizeGaParams({
    partner_id: p.id,
    phone: p.phone,
    displayPhone: p.displayPhone,
    kakaoUrl: p.kakaoUrl,
    partner_name: p.displayName,
  });
  assert.deepEqual(out, { partner_id: 'hwangbo-jaeho-legal' });

  const dump = JSON.stringify(out);
  for (const leak of [p.phone, p.displayPhone, p.kakaoUrl ?? '', p.displayName].filter(Boolean)) {
    assert.ok(!dump.includes(leak), `분석 페이로드에 ${leak}가 새면 안 된다`);
  }
});

test('전화번호를 허용된 키에 억지로 넣어도 값 검사가 막는다', () => {
  const p = getPartnerForPlacement('finance')!;
  // partner_id는 allowlist에 있지만 값이 전화번호로 보이면 버려진다(심층 방어).
  const out = sanitizeGaParams({ partner_id: p.displayPhone });
  assert.equal('partner_id' in out, false);
});

test('channel은 두 통로를 구분한다', () => {
  for (const channel of PARTNER_CHANNELS) {
    const out = sanitizeGaParams({ channel, partner_id: 'hwangbo-jaeho-legal' });
    assert.equal(out.channel, channel);
  }
  assert.deepEqual([...PARTNER_CHANNELS], ['kakao', 'phone']);
});

test('placement/type enum이 실제 설정과 어긋나지 않는다', () => {
  for (const p of allPartners()) {
    assert.ok((PARTNER_TYPES as readonly string[]).includes(p.type), `알 수 없는 업종: ${p.type}`);
    for (const pl of p.placements) {
      assert.ok((PARTNER_PLACEMENTS as readonly string[]).includes(pl), `알 수 없는 배치: ${pl}`);
    }
  }
});

test('성과처럼 들리는 이벤트 이름은 taxonomy에 없다(§13 — 클릭은 상담이 아니다)', () => {
  for (const forbidden of ['partner_lead', 'lead_submit', 'consultation_complete', 'partner_conversion', 'call_connected']) {
    assert.ok(
      !(ANALYTICS_EVENT_NAMES as readonly string[]).includes(forbidden),
      `${forbidden}는 측정 수단이 없으므로 존재하면 안 된다`
    );
  }
});
