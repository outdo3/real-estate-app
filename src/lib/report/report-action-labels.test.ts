import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * REPORT_BOTTOM_ACTION_BAR_COMPACT_FIX_V1 §13.
 *
 * 이 STEP의 핵심 계약은 **줄바꿈 지점**이다. "단지로 돌아가기"가 좁은 폭에서
 * "단지로돌아 / 가기"처럼 깨지면 안 되고, 그걸 CSS 한 줄 바뀌었다고 조용히
 * 되돌아가게 두면 안 된다.
 *
 * 컴포넌트를 렌더할 수 있는 테스트 환경(jsdom/RTL)이 이 저장소에 없으므로,
 * **소스와 CSS를 직접 읽어 구조적 보장을 검사한다.** 렌더 결과가 아니라
 * "그 보장을 만드는 코드가 실재하는가"를 고정하는 것이다.
 */

const ROOT = resolve(__dirname, '../../..');
const ACTIONS = readFileSync(resolve(ROOT, 'src/components/report/ReportActions.tsx'), 'utf8');
const CSS = readFileSync(resolve(ROOT, 'src/components/report/RegionReportSheet.module.css'), 'utf8');
const APT_REPORT = readFileSync(resolve(ROOT, 'src/lib/report/apt-report.ts'), 'utf8');

// ── §1 확정 라벨 ────────────────────────────────────────────────────────────

test('§1 네 개의 라벨이 정확히 지정된 문자열이다', () => {
  assert.ok(ACTIONS.includes("'공유하기'"), '공유하기');
  assert.ok(ACTIONS.includes("'이미지'"), '이미지');
  assert.ok(ACTIONS.includes('"PDF"'), 'PDF');
  assert.ok(APT_REPORT.includes("label: '단지로 돌아가기'"), '단지로 돌아가기');
});

test('§1 예전의 긴 라벨이 되살아나지 않는다', () => {
  for (const old of ['이미지 저장', 'PDF 저장', '이집에서 단지 자세히 보기']) {
    assert.ok(!ACTIONS.includes(`'${old}'`), `ReportActions에 옛 라벨이 남아 있다: ${old}`);
    assert.ok(!APT_REPORT.includes(`'${old}'`), `apt-report에 옛 라벨이 남아 있다: ${old}`);
  }
});

// ── §2/§7 줄바꿈 구조 — 이 STEP의 핵심 ──────────────────────────────────────

test('§2 라벨이 어절 단위 span으로 쪼개진다(문자열 그대로 넣지 않는다)', () => {
  // 어절 분해 + nowrap span 렌더가 실제로 존재해야 한다.
  assert.ok(/text\.split\(' '\)/.test(ACTIONS), '공백 기준 어절 분해가 없다');
  assert.ok(/actionWord/.test(ACTIONS), 'actionWord span이 없다');
  assert.ok(/function ActionLabel/.test(ACTIONS), 'ActionLabel 헬퍼가 없다');
});

test('§7 어절 내부는 절대 끊기지 않는다 — .actionWord에 nowrap이 걸려 있다', () => {
  // 이것이 "단지로돌아 / 가기"를 구조적으로 불가능하게 만드는 단 하나의 장치다.
  const rule = CSS.match(/\.actionWord\s*\{[^}]*\}/);
  assert.ok(rule, '.actionWord 규칙이 없다');
  assert.ok(/white-space:\s*nowrap/.test(rule![0]), '.actionWord에 white-space: nowrap이 없다');
});

test('§7 어절 사이에만 줄바꿈 기회가 있다', () => {
  // 어절 사이 공백을 CSS가 만들고, 그 공백만 normal(=줄바꿈 가능)이다.
  const between = CSS.match(/\.actionWord \+ \.actionWord::before\s*\{[^}]*\}/);
  assert.ok(between, '어절 사이 공백 규칙이 없다');
  assert.ok(/white-space:\s*normal/.test(between![0]), '어절 사이가 줄바꿈 가능해야 한다');
});

test('§7 컨테이너에 keep-all 보조가 걸려 있다', () => {
  const label = CSS.match(/\.actionLabel\s*\{[^}]*\}/);
  assert.ok(label, '.actionLabel 규칙이 없다');
  assert.ok(/word-break:\s*keep-all/.test(label![0]), 'CJK 기본 음절 분해 방어가 없다');
});

test('§7 "단지로 돌아가기"는 정확히 두 어절이다 → 가능한 2줄 분할이 하나뿐이다', () => {
  const words = '단지로 돌아가기'.split(' ');
  assert.deepEqual(words, ['단지로', '돌아가기']);
  // 어절이 2개이고 각 어절이 nowrap이면, 2줄 분할은 "단지로 / 돌아가기" 하나뿐이다.
  assert.equal(words.length, 2);
});

// ── §3/§4 동일 폭 · 동일 높이 ───────────────────────────────────────────────

test('§3 네 칸이 강제로 균등 분할된다(grid minmax(0,1fr))', () => {
  const inner = CSS.match(/\.actionInner\s*\{[^}]*\}/);
  assert.ok(inner, '.actionInner 규칙이 없다');
  assert.ok(/display:\s*grid/.test(inner![0]), 'grid가 아니다');
  assert.ok(/repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(inner![0]), '4칸 균등 분할이 아니다');
  // 예전 flex-wrap 2줄 레이아웃이 되살아나면 안 된다.
  assert.ok(!/flex-wrap/.test(inner![0]), 'flex-wrap이 남아 있으면 두 줄로 접힌다');
});

test('§4 네 버튼의 바깥 높이가 같고 2줄을 담을 수 있다', () => {
  const inner = CSS.match(/\.actionInner\s*\{[^}]*\}/)![0];
  assert.ok(/align-items:\s*stretch/.test(inner), 'stretch가 없으면 높이가 어긋난다');
  const btn = CSS.match(/\.actionBtn\s*\{[^}]*\}/)![0];
  const m = btn.match(/min-height:\s*(\d+)px/);
  assert.ok(m, 'min-height가 없다');
  assert.ok(Number(m![1]) >= 44, `터치 타깃 44px 미만: ${m![1]}px`);
});

// ── §5 아이콘 ───────────────────────────────────────────────────────────────

/** lucide import 목록 — 주석에 적힌 이름이 아니라 **실제로 불러오는 것**만 본다. */
const ICON_IMPORTS = (ACTIONS.match(/import \{([^}]*)\} from 'lucide-react'/)?.[1] ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

test('§5 이미지와 PDF가 같은 다운로드 아이콘을 쓴다', () => {
  assert.ok(ICON_IMPORTS.includes('Download'), 'Download를 불러오지 않는다');
  // FileText(문서)는 저장 동작을 가리키지 않아 제거됐다.
  assert.ok(!ICON_IMPORTS.includes('FileText'), 'FileText를 아직 불러온다');
  assert.ok(!/<FileText/.test(ACTIONS), 'FileText가 아직 렌더된다');
  // 두 저장 버튼이 같은 아이콘을 쓴다 — Download가 최소 2번 렌더된다
  // (이미지 버튼의 idle 상태 + PDF 버튼).
  assert.ok((ACTIONS.match(/<Download /g) ?? []).length >= 2, '두 저장 버튼이 같은 아이콘을 쓰지 않는다');
});

test('§5 돌아가기는 바깥 링크 아이콘이 아니라 되돌아가는 아이콘을 쓴다', () => {
  assert.ok(ICON_IMPORTS.includes('ArrowLeft'), 'ArrowLeft를 불러오지 않는다');
  assert.ok(!ICON_IMPORTS.includes('ExternalLink'), 'ExternalLink를 아직 불러온다');
  assert.ok(!/<ExternalLink/.test(ACTIONS), 'ExternalLink가 아직 렌더된다');
  assert.ok(/<ArrowLeft /.test(ACTIONS), 'ArrowLeft가 렌더되지 않는다');
});

test('§5 공유 버튼의 기존 아이콘은 그대로 보존된다', () => {
  assert.ok(ICON_IMPORTS.includes('Share2'), 'Share2가 사라졌다');
  assert.ok(ICON_IMPORTS.includes('Check'), '복사 완료 Check가 사라졌다');
});

test('§11 이미지/PDF는 아이콘 전용 버튼이 아니다 — 보이는 글자가 남아 있다', () => {
  assert.ok(ACTIONS.includes("text={busy === 'image' ? '이미지 만드는 중...' : '이미지'}"));
  assert.ok(ACTIONS.includes('text="PDF"'));
  // 스크린리더용 aria-label도 유지된다.
  assert.ok(ACTIONS.includes('aria-label="리포트 이미지 저장"'));
  assert.ok(ACTIONS.includes('aria-label="리포트 PDF 저장"'));
});

// ── §9/§10 동작 보존 ────────────────────────────────────────────────────────

test('§9 돌아갈 경로가 그대로다 — aptSeq를 들고 단지 상세로 간다', () => {
  assert.ok(
    /href: `\/apt\/\$\{encodeURIComponent\(m\.name\)\}\?aptSeq=\$\{encodeURIComponent\(m\.aptSeq\)\}`/.test(APT_REPORT),
    '돌아갈 경로가 바뀌었다'
  );
});

test('§10 액션 바는 내보내기에서 제외된 채로 남아 있다', () => {
  assert.ok(/data-export-exclude=""/.test(ACTIONS), 'PNG 캡처 제외 표시가 사라졌다');
  assert.ok(/data-bottom-bar=""/.test(ACTIONS), '하단바 표시가 사라졌다');
});

test('§8/§18 동작과 분석이 그대로다', () => {
  for (const fn of ['saveImage', 'savePdf', 'share']) {
    assert.ok(ACTIONS.includes(`onClick={${fn}}`), `${fn} 연결이 끊겼다`);
  }
  for (const ev of ['report_share', 'report_image_save', 'report_pdf_save']) {
    assert.ok(ACTIONS.includes(ev), `분석 이벤트가 사라졌다: ${ev}`);
  }
});
