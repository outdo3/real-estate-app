import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPORT_SIDO_CODE, resolveStatsReportEntry, type StatsRegionLike } from './stats-report-entry';
import { REPORT_LABELS } from './report-links';

/**
 * STATS_REPORT_ENTRY_V1 — 통계 → 리포트 진입 계약.
 *
 * 고친 문제: 통계에는 리포트 진입점이 **구/군·동에만** 연결돼 있었다. RegionContext의
 * 기본값은 `lawdCd: null` / `sidoCode: '26'` / "부산광역시 전체"라서, 처음 들어온
 * 사용자는 어떤 통계 화면에서도 CTA를 볼 수 없었다. 통계 메인(`/stats`)에는 진입점이
 * 애초에 없었고, 시 리포트(`/report/city/busan`)는 route가 살아 있는데 통계에서 한 번도
 * 연결된 적이 없다. 삭제된 게 아니라 **미연결**이었다.
 *
 * 이 테스트가 막는 방향:
 *   1) 다시 한 스코프(구/군)만 연결하고 나머지를 빠뜨리는 것
 *   2) 지역 identity가 불충분할 때 **다른 지역 리포트로 보내는** fallback
 *   3) Report Engine(내보내기/공유/route)을 이 STEP에서 건드리는 것
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 코드를 인용한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const STATS_MAIN = read('src/app/stats/stats-client.tsx');
const STATS_TYPE = read('src/app/stats/[type]/type-client.tsx');
const STATS_CSS = read('src/app/stats/page.module.css');
const LINKS = read('src/lib/report/report-links.ts');

const busanAll: StatsRegionLike = { lawdCd: null, sidoCode: '26', dong: 'all', sigungu: '' };
const seoguDistrict: StatsRegionLike = { lawdCd: '26140', sidoCode: '26', dong: 'all', sigungu: '서구' };
const amnamDong: StatsRegionLike = { lawdCd: '26140', sidoCode: '26', dong: '암남동', sigungu: '서구' };

// ── 1~3. 스코프별 route mapping ───────────────────────────────────────────────

test('§7-1 부산 전체 선택 → 시 리포트', () => {
  const entry = resolveStatsReportEntry(busanAll);
  assert.ok(entry, '부산 전체에서 진입점이 없다(고친 증상 그대로 재발)');
  assert.equal(entry!.href, '/report/city/busan');
  assert.equal(entry!.scope, 'city');
  assert.equal(entry!.label, REPORT_LABELS.city);
});

test('§7-2 구/군 선택 → 구 리포트', () => {
  const entry = resolveStatsReportEntry(seoguDistrict);
  assert.ok(entry);
  assert.equal(entry!.href, '/report/district/26140');
  assert.equal(entry!.scope, 'district');
  assert.equal(entry!.label, REPORT_LABELS.district('서구'));
});

test('§7-3 동 선택 → 동 리포트', () => {
  const entry = resolveStatsReportEntry(amnamDong);
  assert.ok(entry);
  assert.equal(entry!.href, `/report/dong/26140/${encodeURIComponent('암남동')}`);
  assert.equal(entry!.scope, 'dong');
  assert.equal(entry!.label, REPORT_LABELS.dong('암남동'));
});

test('§4 세 스코프가 서로 다른 경로로 간다 — 하나로 뭉개지 않는다', () => {
  const hrefs = [busanAll, seoguDistrict, amnamDong].map((r) => resolveStatsReportEntry(r)!.href);
  assert.equal(new Set(hrefs).size, 3, '두 스코프가 같은 리포트로 간다');
  assert.ok(hrefs[0].startsWith('/report/city/'));
  assert.ok(hrefs[1].startsWith('/report/district/'));
  assert.ok(hrefs[2].startsWith('/report/dong/'));
});

test('§4 16개 구/군 전부가 자기 구 리포트로 간다', () => {
  const codes = ['26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
    '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710'];
  for (const lawdCd of codes) {
    const entry = resolveStatsReportEntry({ lawdCd, sidoCode: '26', dong: 'all', sigungu: '테스트구' });
    assert.ok(entry, `${lawdCd}에서 진입점이 없다`);
    assert.equal(entry!.href, `/report/district/${lawdCd}`);
  }
});

// ── 4. 잘못된 fallback 금지 ───────────────────────────────────────────────────

test('§4 부산이 아닌 시도 전체는 진입점이 없다 — 부산 리포트로 보내지 않는다', () => {
  for (const sidoCode of ['11', '27', '41', '48']) {
    const entry = resolveStatsReportEntry({ lawdCd: null, sidoCode, dong: 'all', sigungu: '' });
    assert.equal(entry, null, `sidoCode ${sidoCode}가 부산 리포트로 간다`);
  }
});

test('§4 현행 16개가 아닌 lawdCd는 시 리포트로 떨어지지 않는다', () => {
  // 27110(울산 중구)·11680(서울 강남구)은 테이블에 실제로 섞여 들어온 코드다
  // (APARTMENT_TRADE_SYNC_COVERAGE_AUDIT_V1 §8). 26으로 시작하지만 현행 16개가 아닌
  // 코드도 같은 취급이다 — 사용자가 고른 지역이 아니므로 "부산 전체"로 바꿔 보내지 않는다.
  for (const lawdCd of ['27110', '11680', '26999', '26000']) {
    const entry = resolveStatsReportEntry({ lawdCd, sidoCode: '26', dong: 'all', sigungu: '알수없음' });
    assert.equal(entry, null, `${lawdCd}가 엉뚱한 리포트로 간다`);
  }
});

test('§4 동만 있고 lawdCd가 없으면 진입점이 없다 — 동 이름으로 경로를 지어내지 않는다', () => {
  const entry = resolveStatsReportEntry({ lawdCd: null, sidoCode: '26', dong: '암남동', sigungu: '서구' });
  // lawdCd가 없으면 동 경로를 만들 수 없다. 시 리포트로 내려가는 것은 허용된다
  // (선택 상태 자체가 "부산 전체"이므로) — 다만 **동 리포트로는 절대 가지 않는다**.
  assert.ok(!entry || !entry.href.startsWith('/report/dong/'), '동 경로를 지어냈다');
});

test('§4 빈 문자열·공백 lawdCd는 값이 있는 것처럼 취급하지 않는다', () => {
  const blank = resolveStatsReportEntry({ lawdCd: '   ', sidoCode: '26', dong: 'all', sigungu: '' });
  assert.equal(blank?.scope, 'city', '공백 lawdCd가 구 경로를 만들었다');
  const emptyDong = resolveStatsReportEntry({ lawdCd: '26140', sidoCode: '26', dong: '  ', sigungu: '서구' });
  assert.equal(emptyDong?.scope, 'district', '공백 dong이 동 경로를 만들었다');
});

test('region이 없으면 null이다', () => {
  assert.equal(resolveStatsReportEntry(null), null);
  assert.equal(resolveStatsReportEntry(undefined), null);
});

test('구 이름을 모르면 지역명을 추측하지 않는다', () => {
  const entry = resolveStatsReportEntry({ lawdCd: '26140', sidoCode: '26', dong: 'all', sigungu: '' });
  assert.ok(entry);
  assert.equal(entry!.href, '/report/district/26140', '경로는 lawdCd로 정상 생성된다');
  assert.equal(entry!.label, REPORT_LABELS.regionShort, '없는 지역명을 문구에 끼워 넣었다');
});

// ── 5. 통계 화면의 CTA 존재 ───────────────────────────────────────────────────

test('§7-5 통계 메인에 진입점이 있다', () => {
  const code = codeOf(STATS_MAIN);
  assert.ok(/const reportEntry = resolveStatsReportEntry\(region\)/.test(code), '메인이 진입점을 계산하지 않는다');
  assert.ok(/\{reportEntry && \(/.test(code), '진입점이 조건부로 렌더되지 않는다');
  assert.ok(/href=\{reportEntry\.href\}/.test(code), '링크가 계산 결과를 쓰지 않는다');
  assert.ok(/\{reportEntry\.shortLabel\}/.test(code), '짧은 문구를 쓰지 않는다');
  // 지역 선택 트리거와 같은 줄(headerTop)에 있다.
  const headerAt = code.indexOf('styles.headerTop');
  const ctaAt = code.indexOf('styles.reportCtaInline');
  assert.ok(headerAt > -1 && ctaAt > headerAt, '진입점이 헤더 영역에 없다');
});

test('§7-5 통계 상세도 같은 함수로 진입점을 만든다 — 판정이 두 벌이 아니다', () => {
  const code = codeOf(STATS_TYPE);
  assert.ok(/const entry = resolveStatsReportEntry\(region\);/.test(code), '상세가 같은 함수를 쓰지 않는다');
  assert.ok(/href=\{entry\.href\}/.test(code));
  assert.ok(/\{entry\.label\}/.test(code), '상세는 지역명이 들어간 전체 문구를 쓴다');
  // 예전의 부분 게이트가 남아 있지 않다(구/군만 통과시키던 조건).
  assert.ok(!/isBusanCurrentLawdCd/.test(code), '옛 부분 게이트가 남아 있다');
  assert.ok(!/dongReportHref|districtReportHref/.test(code), '상세가 경로를 직접 조립한다');
});

test('§3 진입점은 보조 액션 수준이다 — 강한 primary가 아니다', () => {
  const inline = STATS_CSS.slice(STATS_CSS.indexOf('.reportCtaInline {'), STATS_CSS.indexOf('.reportCtaInline:active'));
  // 배경은 흰색이고 브랜드색은 테두리·글자에만 쓴다(채워진 primary 버튼이 아니다).
  assert.ok(/background:\s*#fff/.test(inline), '채워진 primary 버튼이다');
  assert.ok(/border: 1px solid var\(--primary-color/.test(inline));
  assert.ok(/color: var\(--primary-color/.test(inline));
  // 새 카드/섹션을 만들지 않았다 — 기존 헤더 줄에 들어간다.
  const code = codeOf(STATS_MAIN);
  assert.ok(!/categorySection/.test(code.slice(code.indexOf('styles.reportCtaInline') - 400, code.indexOf('styles.reportCtaInline'))),
    '새 섹션을 만들어 넣었다');
});

// ── 6. 모바일 구조 ───────────────────────────────────────────────────────────

test('§6 좁은 화면에서 잘리지 않는다 — 버튼은 줄지 않고 지역명이 말줄임된다', () => {
  const inline = STATS_CSS.slice(STATS_CSS.indexOf('.reportCtaInline {'), STATS_CSS.indexOf('.reportCtaInline:active'));
  assert.ok(/white-space:\s*nowrap/.test(inline), '문구가 줄바꿈된다');
  assert.ok(/min-height:\s*44px/.test(inline), '터치 타겟이 44px 미만이다');
  // 헤더의 기존 축소 규칙이 그대로다: 지역 트리거만 줄어들고 나머지는 고정.
  assert.ok(/\.headerTop > \.regionTrigger \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;/.test(STATS_CSS),
    '지역 트리거의 축소 규칙이 사라졌다');
  assert.ok(/\.headerTop > \*:not\(\.regionTrigger\) \{[^}]*flex: 0 0 auto;/.test(STATS_CSS),
    '헤더 버튼이 깎이지 않는 규칙이 사라졌다');
  // 지역명 말줄임은 라벨 자식이 담당한다(기존 구조 유지).
  assert.ok(/\.regionTriggerLabel \{[^}]*text-overflow: ellipsis;/.test(STATS_CSS), '지역명 말줄임이 사라졌다');
  // 360px 대응이 문구 숨김이 아니라 여백 축소다.
  const narrow = STATS_CSS.slice(STATS_CSS.indexOf('@media (max-width: 380px)'));
  assert.ok(/\.reportCtaInline \{ padding: 0 0\.65rem; gap: 4px; \}/.test(narrow), '좁은 화면 대응이 없다');
  assert.ok(!/\.reportCtaInline \{[^}]*display:\s*none/.test(narrow), '좁은 화면에서 진입점을 숨긴다');
});

// ── 7. Report Engine 무변경 ──────────────────────────────────────────────────

test('§5 route 정의를 건드리지 않았다 — 문구만 하나 추가했다', () => {
  const code = codeOf(LINKS);
  assert.ok(/return '\/report\/city\/busan';/.test(code), '시 리포트 경로가 바뀌었다');
  assert.ok(/`\/report\/district\/\$\{encodeURIComponent\(v\)\}`/.test(code), '구 리포트 경로가 바뀌었다');
  assert.ok(/`\/report\/dong\/\$\{encodeURIComponent\(l\)\}\/\$\{encodeURIComponent\(d\)\}`/.test(code), '동 리포트 경로가 바뀌었다');
  assert.ok(/`\/report\/apt\/\$\{encodeURIComponent\(v\)\}`/.test(code), '단지 리포트 경로가 바뀌었다');
  assert.ok(/\/report\/compare\?a=/.test(code), '비교 리포트 경로가 바뀌었다');
  // 추가된 것은 좁은 자리용 문구 하나뿐이다.
  assert.equal(REPORT_LABELS.regionShort, '한장 브리핑');
  assert.equal(REPORT_LABELS.city, '부산 한장 브리핑');
  assert.equal(REPORT_LABELS.aptShort, '한장 리포트');
});

test('§5 내보내기·공유 엔진에 손대지 않았다', () => {
  // 이 STEP은 진입 복구다. export/share 쪽 파일은 변경 대상이 아니다.
  const actions = read('src/components/report/ReportActions.tsx');
  assert.ok(/captureReportExport/.test(actions), 'PNG 내보내기가 사라졌다');
  assert.ok(/dom-to-png/.test(actions), 'export 구현 연결이 바뀌었다');
  const sheet = read('src/components/report/RegionReportSheet.tsx');
  assert.ok(/data-export-root=""/.test(sheet), 'export 루트 표시가 사라졌다');
  assert.ok(/<ReportActions title=\{title\} envelope=\{envelope\} \/>/.test(sheet), '리포트 액션 바가 사라졌다');
});

test('진입점 판정은 순수하다 — 경로를 직접 조립하지 않고 단일 정의를 호출한다', () => {
  const code = codeOf(read('src/lib/report/stats-report-entry.ts'));
  assert.ok(!/prisma|fetch|window|document/.test(code), '판정이 데이터/DOM에 닿는다');
  // 경로 문자열 리터럴을 이 파일에서 만들지 않는다.
  assert.ok(!/'\/report\//.test(code) && !/`\/report\//.test(code), '경로를 직접 조립한다');
  assert.ok(/from '\.\/report-links'/.test(code), '단일 정의를 쓰지 않는다');
});

// ── 8. 다른 통계 액션 회귀 없음 ──────────────────────────────────────────────

test('§7-8 통계의 기존 액션이 그대로다', () => {
  const main = codeOf(STATS_MAIN);
  // 메인: 지역 선택 트리거, 16개 메뉴, 학군/도구 진입.
  assert.ok(/onClick=\{openRegionModal\}/.test(main), '지역 선택이 사라졌다');
  assert.ok(/STATS_CATEGORIES\.map/.test(main) && /STATS_MENU\.filter/.test(main), '통계 메뉴가 바뀌었다');
  assert.ok(/href="\/school"/.test(main) && /href="\/tools"/.test(main), '기타 진입점이 사라졌다');
  assert.ok(/<RegionSelectModal \/>/.test(main), '지역 선택 모달이 사라졌다');

  const type = codeOf(STATS_TYPE);
  // 상세: 공유 액션, 지역 트리거, change-map 예외, 각 뷰 분기.
  assert.ok(/<ShareAction shareType="stats"/.test(type), '공유 액션이 사라졌다');
  assert.ok(/slug !== 'change-map' && item\.status === 'live'/.test(type), 'CTA 노출 조건이 바뀌었다');
  assert.ok(/<TransactionFeedView/.test(type) && /<SupplyView \/>/.test(type) && /<RegionChangeMapView \/>/.test(type),
    '통계 뷰 분기가 바뀌었다');
  assert.ok(/<ComingSoonCard/.test(type), '준비중 처리가 사라졌다');
});

test('§7-8 다른 화면의 리포트 진입점은 건드리지 않았다', () => {
  // 단지 상세 / 지도 / 비교 / 도구는 기존 진입점을 그대로 쓴다.
  assert.ok(/aptReportHref/.test(read('src/app/apt/[name]/apt-client.tsx')));
  assert.ok(/report\/apt\//.test(read('src/app/map/page.tsx')));
  assert.ok(/compareReportHref/.test(read('src/components/compare/CompareV2.tsx')));
  assert.ok(/cityReportHref/.test(read('src/app/tools/page.tsx')));
});

test('REPORT_SIDO_CODE는 부산이다 — 리포트 범위와 같다', () => {
  assert.equal(REPORT_SIDO_CODE, '26');
});
