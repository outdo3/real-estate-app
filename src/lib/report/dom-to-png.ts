// REPORT-6 — 리포트 시트를 PNG로 굽는다. **의존성 없음.**
//
// ── 왜 라이브러리를 안 쓰나 ────────────────────────────────────────────────
// html2canvas/dom-to-image 류는 이 저장소에 설치돼 있지 않고, 추가하려면
// package.json/package-lock을 건드려야 한다 — 둘 다 사용자의 작업 중 파일이라
// 이 STEP이 손댈 수 없다(AGENTS.md worktree 보존). STEP §4도 "무거운 의존성을
// 가볍게 추가하지 말 것 / 가능하면 브라우저 네이티브"를 우선하라고 지시한다.
//
// 다행히 리포트 시트는 캡처하기에 이상적인 모양이다(실측 확인):
//   - <img>/background url() 없음 → 외부 리소스 인라인 단계가 통째로 불필요
//   - @font-face 없음 → Pretendard는 "이름만" 지정돼 있고 실제로는 시스템 폰트로
//     렌더된다. 그래서 foreignObject 래스터화도 **같은 시스템 폰트**를 쓴다
//     (한글 글리프가 깨지거나 대체되지 않는다).
//   - ::before/::after content 없음 → 캡처가 놓치는 시각 요소가 없다
//
// ── 방식 ──────────────────────────────────────────────────────────────────
// DOM 복제 → computed style을 인라인으로 고정 → SVG <foreignObject>에 담아
// 이미지로 로드 → canvas에 그려 PNG blob.
//
// 주의점 두 가지를 명시적으로 처리한다:
//   1) btoa()는 한글에서 던진다. 반드시 encodeURIComponent 기반 data URI를 쓴다.
//   2) 캡처에서 빼야 하는 요소는 셀렉터를 템플릿마다 복제하지 않고
//      data-export-exclude 속성 하나로만 표시한다(§12).

export const EXPORT_ROOT_ATTR = 'data-export-root';
export const EXPORT_EXCLUDE_ATTR = 'data-export-exclude';

/** 공유에 적당한 가로 해상도(§5). 시트 실제 폭에서 배율을 유도한다. */
export const TARGET_WIDTH_PX = 1080;
/** 저해상도 스크린샷을 억지로 늘리지 않기 위한 상한. */
const MAX_SCALE = 3;
/** 지나치게 큰 파일 방지(§5) — 세로가 아주 긴 리포트에서 배율을 낮춘다. */
const MAX_PIXELS = 16_000_000;

/** 인라인으로 고정할 CSS 속성. 전부 복사하면 문자열이 폭발하므로 실제로 쓰는 것만. */
const COPIED_PROPS = [
  'box-sizing', 'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'justify-content', 'align-items', 'align-self', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  // width/height는 **복사하지 않는다**. computed 값을 그대로 박으면 캡처 안에서
  // 텍스트가 한 줄 더 접힐 때 박스가 커지지 못해 글자가 헤더 밖으로 삐져나가고
  // 푸터가 겹친다(실측: 부제 "취소 거래 제외"의 "외"가 잘림). 자연 높이로 둔다.
  // min-height는 유지한다 — 박스를 키우기만 하므로 글자를 자르지 않는다.
  // (제외했더니 daily 시트가 792px→512px로 줄어 푸터 출처 문구가 잘렸다.)
  'min-width', 'max-width', 'min-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'white-space',
  'word-break', 'overflow-wrap', 'vertical-align', 'opacity', 'visibility', 'overflow',
  'list-style', 'table-layout', 'border-collapse', 'border-spacing', 'transform',
] as const;

function inlineStyles(source: Element, target: Element) {
  const computed = window.getComputedStyle(source);
  const decls: string[] = [];
  for (const prop of COPIED_PROPS) {
    const value = computed.getPropertyValue(prop);
    if (value) decls.push(`${prop}:${value}`);
  }
  // overflow:hidden이 남아 있으면 캡처본에서 내용이 잘린다(§3 "no clipped footer").
  // 원본 인라인 스타일은 **맨 뒤에** 붙여 우선권을 준다 — 분포 막대의 width:%처럼
  // 컴포넌트가 직접 지정한 값이 computed 복사본에 덮이면 안 된다.
  const own = source.getAttribute('style') || '';
  target.setAttribute('style', `${decls.join(';')};overflow:visible;${own}`);
}

function cloneWithStyles(source: Element): Element | null {
  if (source.hasAttribute(EXPORT_EXCLUDE_ATTR)) return null;
  const tag = source.tagName.toLowerCase();
  // script/style은 캡처본에 들어갈 이유가 없고 SVG 파싱만 어렵게 만든다.
  if (tag === 'script' || tag === 'style' || tag === 'noscript') return null;

  const clone = source.cloneNode(false) as Element;
  inlineStyles(source, clone);

  const sourceChildren = Array.from(source.childNodes);
  for (const child of sourceChildren) {
    if (child.nodeType === Node.TEXT_NODE) {
      clone.appendChild(child.cloneNode(true));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childClone = cloneWithStyles(child as Element);
      if (childClone) clone.appendChild(childClone);
    }
  }
  return clone;
}

export interface CaptureResult {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * 리포트 시트 노드를 PNG blob으로 만든다.
 * 실패하면 **던진다** — 호출부가 "저장됨"이라고 거짓말하지 않도록.
 */
export async function captureElementToPng(node: HTMLElement): Promise<CaptureResult> {
  const rect = node.getBoundingClientRect();
  const cssWidth = Math.ceil(rect.width);
  const cssHeight = Math.ceil(rect.height);
  if (cssWidth === 0 || cssHeight === 0) throw new Error('EXPORT_EMPTY_NODE');

  const clone = cloneWithStyles(node);
  if (!clone) throw new Error('EXPORT_CLONE_FAILED');
  // 캡처본은 화면 폭과 무관하게 자기 크기를 갖는다.
  (clone as HTMLElement).style.width = `${cssWidth}px`;
  (clone as HTMLElement).style.maxWidth = 'none';
  (clone as HTMLElement).style.margin = '0';

  // 높이는 **넉넉하게 잡고 나중에 잘라낸다.**
  //
  // 왜 측정만으로 안 되나: DOM 안의 복제본은 body의 상속 스타일 위에서 렌더되지만
  // foreignObject 안은 그렇지 않아, 같은 인라인 스타일이라도 줄바꿈이 미세하게 달라진다
  // (실측: daily 시트에서 푸터 출처 문구 한 줄이 잘렸다). 그래서 측정값을 그대로 믿지 않고
  // 여유 있게 그린 뒤, **실제로 그려진 영역**만 알파 채널로 찾아 잘라낸다.
  // foreignObject는 내용이 없는 곳을 투명하게 남기므로 이 경계가 정확하다.
  const measured = measureCloneHeight(clone, cssWidth) || cssHeight;
  const drawHeight = Math.min(Math.ceil(measured * 1.6) + 200, 30000);

  const serialized = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cssWidth}" height="${drawHeight}" viewBox="0 0 ${cssWidth} ${drawHeight}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${cssWidth}px">${serialized}</div>` +
    `</foreignObject></svg>`;

  // 한글이 들어가므로 btoa()를 쓰면 InvalidCharacterError가 난다.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = await loadImage(url);

  let scale = Math.min(TARGET_WIDTH_PX / cssWidth, MAX_SCALE);
  if (scale < 1) scale = 1; // 저해상도로 줄이지 않는다
  if (cssWidth * scale * drawHeight * scale > MAX_PIXELS) {
    scale = Math.sqrt(MAX_PIXELS / (cssWidth * drawHeight));
  }

  const raw = document.createElement('canvas');
  raw.width = Math.round(cssWidth * scale);
  raw.height = Math.round(drawHeight * scale);
  const rawCtx = raw.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('EXPORT_NO_CANVAS_CONTEXT');
  // 흰 배경을 아직 깔지 않는다 — 알파로 내용 경계를 찾아야 하기 때문.
  rawCtx.drawImage(image, 0, 0, raw.width, raw.height);

  const contentBottom = findContentBottom(rawCtx, raw.width, raw.height);
  if (contentBottom <= 0) throw new Error('EXPORT_EMPTY_RENDER');

  const canvas = document.createElement('canvas');
  canvas.width = raw.width;
  canvas.height = contentBottom;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('EXPORT_NO_CANVAS_CONTEXT');
  // 카카오톡에서 투명 배경이 검게 보이지 않도록 흰 바탕을 깐 뒤 합성한다.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(raw, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('EXPORT_TOBLOB_FAILED');
  return { blob, width: canvas.width, height: canvas.height };
}

/**
 * 알파 채널을 아래에서 위로 훑어 **실제로 그려진 마지막 행**을 찾는다.
 * foreignObject가 내용 없는 영역을 투명하게 남기는 성질을 이용한다.
 */
function findContentBottom(ctx: CanvasRenderingContext2D, width: number, height: number): number {
  const step = 1;
  for (let y = height - 1; y >= 0; y -= step) {
    const row = ctx.getImageData(0, y, width, 1).data;
    for (let x = 3; x < row.length; x += 4) {
      if (row[x] !== 0) return Math.min(height, y + 1);
    }
  }
  return 0;
}

/**
 * 복제본을 화면 밖에 잠깐 붙여 실제 렌더 높이를 잰다.
 * 화면에 보이지 않도록 좌측 밖으로 밀어두고, 측정이 끝나면 반드시 제거한다.
 */
function measureCloneHeight(clone: Element, width: number): number {
  const holder = document.createElement('div');
  holder.setAttribute(
    'style',
    // contain을 쓰지 않는다 — 측정에서 마지막 줄이 빠지는 원인이었다(실측: 푸터
    // 출처 문구 한 줄이 잘림). 화면 밖으로 밀어두는 것만으로 충분하다.
    `position:fixed;left:-100000px;top:0;width:${width}px;pointer-events:none;`
  );
  const probe = clone.cloneNode(true) as HTMLElement;
  holder.appendChild(probe);
  document.body.appendChild(holder);
  try {
    // 넘치는 자식이 있어도 놓치지 않도록 둘 중 큰 값을 쓴다.
    const h = Math.ceil(Math.max(probe.getBoundingClientRect().height, probe.scrollHeight));
    return h > 0 ? h : 0;
  } finally {
    holder.remove();
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('EXPORT_SVG_RASTERIZE_FAILED'));
    img.src = url;
  });
}

/** 현재 화면에서 캡처 대상(시트) 노드를 찾는다. 없으면 null. */
export function findExportRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${EXPORT_ROOT_ATTR}]`);
}
