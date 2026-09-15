import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { aptReportHref } from './report-links';
import { NEXT_ACTION_TYPES } from '../decision-journey/types';
import { ANALYTICS_EVENT_NAMES } from '../analytics/events';

/**
 * APT_DETAIL_REPORT_CTA_FLOW_V1 — 지도 → 상세 → 한장 리포트 흐름 계약.
 * 페이지·컴포넌트는 소스 검사로 고정한다(렌더 없이 JSX 구조·순서·문구를 확인).
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// 주석을 걷어낸 코드(주석 안의 설명 문구가 검사에 걸리지 않게).
const codeOf = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MAP = codeOf(read('src/app/map/page.tsx'));
const DETAIL = codeOf(read('src/app/apt/[name]/apt-client.tsx'));
const CARD = read('src/components/report/AptReportEntryCard.tsx');
const CARD_CODE = codeOf(CARD);
const CARD_CSS = read('src/components/report/AptReportEntryCard.module.css');
const STICKY = codeOf(read('src/components/StickyActionBar.tsx'));

/** 선택된 아파트 카드 JSX 구간(오피스텔 카드와 구분). */
function mapAptCard(): string {
  const start = MAP.indexOf('!officetelGroupList && !selectedOfficetel && selectedMarker && (');
  const end = MAP.indexOf('<BottomNav />', start);
  assert.ok(start > 0 && end > start, '지도 단지 선택 카드 구간을 찾지 못했다');
  return MAP.slice(start, end);
}

test('1. 지도 단지 선택 카드에 상세보기 CTA가 있고 단일 primary(폭 100%, 48px, green)다', () => {
  const card = mapAptCard();
  assert.equal((card.match(/>\s*상세보기\s*</g) ?? []).length, 1);
  assert.match(card, /width: '100%', minHeight: 48, padding: '0\.7rem', background: 'var\(--primary-color\)'/);
  assert.equal((card.match(/<button\b/g) ?? []).length, 2, '닫기 + 상세보기 두 개만');
});

test('2. 지도 카드에서 한장 리포트 바로가기가 사라졌다(route·라벨·import 없음)', () => {
  const card = mapAptCard();
  assert.ok(!/report\/apt/.test(card));
  assert.ok(!/한장 리포트|REPORT_LABELS/.test(card));
  assert.ok(!/report-links/.test(MAP), '지도 페이지가 리포트 링크 모듈을 더 이상 쓰지 않는다');
  assert.ok(!/\/report\/apt\//.test(MAP));
});

test('3. 상세보기 이동 경로는 그대로(이름+lawdCd+dong+canonical aptSeq)', () => {
  const card = mapAptCard();
  assert.ok(card.includes("const aptSeqParam = selectedMarker.aptSeq ? `&aptSeq=${encodeURIComponent(selectedMarker.aptSeq)}` : '';"));
  assert.ok(card.includes('router.push(`/apt/${encodeURIComponent(selectedMarker.name)}?lawdCd=${currentLawdCd}&dong=${encodeURIComponent(selectedMarker.dong)}${aptSeqParam}`);'));
});

test('4. 상세페이지가 리포트 카드를 canonical aptSeq 기반 기존 route로 렌더한다', () => {
  assert.match(DETAIL, /const reportHref = aptReportHref\(canonicalAptSeq\);/);
  assert.match(DETAIL, /\{addressReady && reportHref && \(\s*<div className=\{`container \$\{styles\.sectionBlock\}`\}>\s*<AptReportEntryCard href=\{reportHref\} aptName=\{displayName \|\| aptName\} \/>/);
  assert.match(CARD_CODE, /href=\{href\}/);
  assert.ok(!/report\/apt/.test(CARD_CODE), '카드가 route를 따로 조립하지 않는다');
});

test('5. 카드 위치: 가격·점수·브리핑·시세추이·투자지표·위치 뒤, 실거래 타임라인·생활정보·커뮤니티 앞', () => {
  const at = DETAIL.indexOf('<AptReportEntryCard');
  const before = ['<ApartmentScoreCard', '<NextActionSection', '<PriceTrendChart', '<InvestmentMetrics', '<AptLocationCard'];
  const after = ['실거래 타임라인', '<TradeTimelineList', '<AptSpecGrid', '<InfraTabSection', '<CommunityPreview', '<BrokerCtaCard', '<StickyActionBar'];
  for (const m of before) assert.ok(DETAIL.indexOf(m) > 0 && DETAIL.indexOf(m) < at, `${m}이 카드보다 앞이어야 한다`);
  for (const m of after) assert.ok(DETAIL.indexOf(m) > at, `${m}이 카드보다 뒤여야 한다`);
});

test('6. 고정·스크롤 팝업·모달 없음(본문 카드만)', () => {
  assert.ok(!/position:\s*(fixed|sticky)/.test(CARD_CSS));
  assert.ok(!/animation|@keyframes|transition|gradient/.test(CARD_CSS));
  assert.ok(!/addEventListener|IntersectionObserver|useEffect|scroll|modal|Modal/i.test(CARD_CODE));
  assert.ok(!/AptReportEntryCard|report/i.test(STICKY), 'StickyActionBar에 리포트 버튼 없음');
});

test('7. 리포트 CTA 중복 없음: 카드 1회, 상단 다음 행동에서 REPORT 제거, 지도는 primary 복귀', () => {
  assert.equal((DETAIL.match(/<AptReportEntryCard\b/g) ?? []).length, 1);
  assert.ok(!/type: 'REPORT'/.test(DETAIL));
  assert.ok(!/REPORT_LABELS/.test(DETAIL));
  const map = DETAIL.slice(DETAIL.indexOf("type: 'MAP'"), DETAIL.indexOf("type: 'COMPARE'"));
  assert.match(map, /priority: 'primary'/);
  assert.equal((DETAIL.slice(DETAIL.indexOf('const nextActions'), DETAIL.indexOf('const heroRegionLabel')).match(/priority: 'primary'/g) ?? []).length, 1, 'primary 1개 규칙');
});

test('8. 기존 리포트 route·생성 페이지 그대로', () => {
  assert.equal(aptReportHref('26350-9'), '/report/apt/26350-9');
  assert.equal(aptReportHref(null), null);
  assert.ok(existsSync(resolve(ROOT, 'src/app/report/apt/[aptSeq]')));
  assert.ok(existsSync(resolve(ROOT, 'src/components/report/ApartmentReportSheet.tsx')));
  assert.ok(existsSync(resolve(ROOT, 'src/components/report/ReportActions.tsx')));
});

test('9. 모바일: 좁은 화면에서 세로 배치·버튼 전체 폭·48px, 문구 줄바꿈 허용(잘림 없음)', () => {
  const mobile = CARD_CSS.slice(CARD_CSS.indexOf('@media (max-width: 640px)'));
  assert.match(mobile, /flex-direction: column/);
  assert.match(mobile, /width: 100%/);
  assert.match(CARD_CSS, /\.button \{[^}]*min-height: 48px/);
  assert.ok(!/nowrap|text-overflow|overflow: hidden/.test(CARD_CSS));
  assert.match(CARD_CSS, /\.text \{\s*min-width: 0;/);
  assert.match(CARD_CSS, /word-break: keep-all/);
});

test('10. analytics: 이전 상세 리포트 버튼과 같은 이벤트·actionType(스키마 변경 없음)', () => {
  assert.match(CARD_CODE, /trackEvent\('next_action_click', \{ aptName: aptName \?\? undefined, actionType: 'REPORT' \}\)/);
  assert.ok((NEXT_ACTION_TYPES as readonly string[]).includes('REPORT'));
  assert.ok((ANALYTICS_EVENT_NAMES as readonly string[]).includes('next_action_click'));
  assert.ok(!/source/.test(CARD_CODE), 'analytics에 없는 source 필드를 보내지 않는다');
});

test('11. 지도 선택·닫기·오피스텔 카드·광고 슬롯 로직 유지', () => {
  const card = mapAptCard();
  assert.ok(card.includes('setSelectedMarkerId(null);'));
  assert.ok(card.includes('setPendingSelectedApt(null);'));
  assert.ok(card.includes('setPendingRestoreIdentity(null);'));
  assert.ok(card.includes('<AdContainer variant="agent" slot="map-marker-summary-agent" label="추천 지역 중개사" />'));
  assert.ok(MAP.includes('router.push(`/officetel/${selectedOfficetel.officetelId}`)'));
});

test('카피: 보기 중심(다운로드 표현 없음)', () => {
  assert.match(CARD, /title: '이 단지, 한 장으로 정리해 볼까요\?'/);
  assert.match(CARD, /description: '가격·거래·학군·교통·단지 정보를 한눈에 확인해 보세요\.'/);
  assert.match(CARD, /button: '이집 한장 리포트 보기'/);
  assert.ok(!/다운로드/.test(CARD_CODE));
  assert.ok(/from 'lucide-react'/.test(CARD) && !/[\u{1F300}-\u{1FAFF}]/u.test(CARD), 'lucide 아이콘, 이모지 없음');
});
