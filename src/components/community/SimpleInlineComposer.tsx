'use client';

// COMMUNITY_EDITOR_V2.1 — 단순 인라인 작성기.
//
// 사용자에게는 일반 게시판 글쓰기처럼 "하나의 본문 + 커서 위치 사진"으로 보인다. 내부 상태와 저장 형식은 V2 블록
// (EditorBlock → PostContentBlock) 그대로이며, 모양 변경은 src/lib/community/block-editor-state.ts의 순수 함수로만 한다.
//
//  - 사진 추가: 버튼을 누르기 직전 커서(마지막으로 쓰던 글 입력칸 + selectionEnd)를 기억해, 사진 선택창에서 돌아오면
//    그 위치에서 글을 나눠 사진을 넣는다. 선택한 글자는 지우지 않는다(selectionEnd 뒤에 삽입).
//  - 한글 IME: 조합(composition) 중에는 글을 나누지 않는다 — 조합이 끝난 뒤 삽입한다. 타이핑 중에는 블록 구조를 바꾸지 않는다.
//  - 사진 조작(위/아래/삭제)은 사진을 탭했을 때만 보인다. 블록 수·"+ 내용 추가" 같은 구조 UI는 없다.
//  - 사진 전처리는 V1 파이프라인(prepareImage + 브라우저 codec) 그대로, 한 장씩 순차. 미리보기 object URL은 삭제·언마운트 시 해제.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { IMAGE_ERROR_MESSAGES, IMAGE_INPUT_ACCEPT, MAX_IMAGES_PER_POST } from '@/lib/community/image-rules';
import { PrepareImageError, createBrowserImageCodec, prepareImage } from '@/lib/community/image-compress';
import { MAX_TEXT_BLOCK_CHARS } from '@/lib/community/content-blocks';
import {
  composerAtBlockLimit,
  composerImageMoveState,
  countImages,
  insertImagesAtCursor,
  moveComposerImageWithCursor,
  pickComposerInsertCursor,
  remainingImageSlots,
  removeComposerImage,
  removeComposerImageWithAnchor,
  resolveImageBlock,
  updateTextBlock,
  type ComposerCursor,
  type ComposerCursorMemory,
  type EditorBlock,
} from '@/lib/community/block-editor-state';
import styles from './SimpleInlineComposer.module.css';

export const BLOCK_LIMIT_MESSAGE = '내용을 더 추가할 수 없어요.';

/** V2.2 — 하단 고정 [사진 추가]가 켜지는 폭. 하단 탭바(Header .menuList·BottomNav)가 보이는 폭과 같다. CSS 모듈의 미디어 쿼리와 맞춘다. */
export const STICKY_TOOLBAR_QUERY = '(max-width: 900px)';
/** 키보드 위로 올릴 때 버튼과 키보드 사이 간격. */
const KEYBOARD_GAP_PX = 8;

export const newBlockKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** 같은 삽입을 상태 갱신 함수 안에서 다시 계산해도 같은 key가 나오도록 미리 만든 key 목록에서 꺼낸다. */
function keySource(pool: string[]) {
  let i = 0;
  return () => pool[i++] ?? newBlockKey();
}

interface Props {
  blocks: EditorBlock[];
  onBlocksChange: React.Dispatch<React.SetStateAction<EditorBlock[]>>;
  onError: (message: string | null) => void;
  disabled?: boolean;
}

export default function SimpleInlineComposer({ blocks, onBlocksChange, onError, disabled }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const textareasRef = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  // 마지막 삽입 위치: 사용자가 둔 커서('user') 또는 사진 삭제가 남긴 삭제 자리('delete-anchor'). 사용자가 글을 누르면 'user'로 덮인다.
  const cursorRef = useRef<ComposerCursorMemory>(null);
  const pendingCursorRef = useRef<{ cursor: ComposerCursor | null; rereadLive: boolean } | null>(null);
  const composingRef = useRef(false);
  const deferredInsertRef = useRef<(() => void) | null>(null);
  const focusRef = useRef<{ key: string; position: number } | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const liveKeysRef = useRef<Set<string>>(new Set());
  const urlsRef = useRef<Set<string>>(new Set());
  const codecRef = useRef<ReturnType<typeof createBrowserImageCodec> | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const revealImageRef = useRef<string | null>(null);

  useEffect(() => {
    liveKeysRef.current = new Set(blocks.map((b) => b.key));
  }, [blocks]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  // 삽입 직후 사진 아래 글 입력칸으로 커서를 옮겨 바로 이어 쓸 수 있게 한다.
  useEffect(() => {
    const target = focusRef.current;
    if (!target) return;
    const el = textareasRef.current.get(target.key);
    if (!el) return;
    focusRef.current = null;
    el.focus({ preventScroll: false });
    el.setSelectionRange(target.position, target.position);
    cursorRef.current = { cursor: { key: target.key, selectionStart: target.position, selectionEnd: target.position }, source: 'user' };
  }, [blocks]);

  // V2.2 — 사진을 옮기면 옮겨진 사진이 화면 밖으로 사라지지 않게 가까운 방향으로만 스크롤한다.
  useEffect(() => {
    const key = revealImageRef.current;
    if (!key) return;
    revealImageRef.current = null;
    const card = Array.from(document.querySelectorAll<HTMLElement>('[data-composer-image]')).find((el) => el.dataset.composerImage === key);
    card?.scrollIntoView({ block: 'nearest' });
  }, [blocks]);

  // V2.2 — 모바일 하단 고정 [사진 추가]가 키보드에 가리지 않게 한다.
  // 모바일 브라우저는 키보드가 떠도 레이아웃 뷰포트를 줄이지 않아(visual viewport만 줄어듦) sticky 버튼이 키보드 뒤로 간다.
  // 버튼 아래 끝이 보이는 영역(visual viewport) 아래로 내려가 있을 때만 그만큼 위로 올린다. 하단 고정은 모바일 CSS에서만 켜진다.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const el = toolbarRef.current;
    if (!vv || !el) return;
    const mobile = window.matchMedia(STICKY_TOOLBAR_QUERY);
    let frame = 0;
    const update = () => {
      frame = 0;
      const current = Number(el.dataset.keyboardShift || 0);
      if (!mobile.matches) {
        if (current !== 0) {
          el.style.transform = '';
          el.dataset.keyboardShift = '0';
        }
        return;
      }
      const rect = el.getBoundingClientRect();
      const naturalBottom = rect.bottom - current;
      const visibleBottom = vv.offsetTop + vv.height - KEYBOARD_GAP_PX;
      // sticky처럼 작성기 상자 밖(위)으로는 올리지 않는다 — 제목 입력 중 작성기가 화면 아래에 있으면 버튼도 따라오지 않는다.
      const composerTop = el.parentElement?.getBoundingClientRect().top ?? -Infinity;
      const limit = Math.min(0, composerTop - (rect.top - current));
      const shift = Math.round(Math.max(limit, Math.min(0, visibleBottom - naturalBottom)));
      if (shift === current) return;
      el.style.transform = shift === 0 ? '' : `translateY(${shift}px)`;
      el.dataset.keyboardShift = String(shift);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    mobile.addEventListener('change', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', schedule);
      mobile.removeEventListener('change', schedule);
    };
  }, []);

  // 사진 선택 해제: 사진 카드 밖을 누르면 조작 버튼을 숨긴다.
  useEffect(() => {
    if (!selectedImage) return;
    const onPointerDown = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest?.('[data-composer-image]');
      if (!card || card.getAttribute('data-composer-image') !== selectedImage) setSelectedImage(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [selectedImage]);

  const rememberCursor = (key: string, el: HTMLTextAreaElement, passive: boolean) => {
    // V2.1A — 삭제 anchor가 있는 동안 select·blur만으로는 덮지 않는다. 합쳐진 입력칸에 포커스가 남아 있으면 React가 값을 바꾸며
    // DOM 커서를 글 끝으로 옮겨 select가 나고, 그 뒤 버튼을 누를 때 blur가 난다 — 둘 다 사용자가 고른 위치가 아니다.
    // 사용자의 탭·키 이동·입력(focus/click/keyup/change)은 바로 덮는다(manual cursor > delete anchor).
    if (passive && cursorRef.current?.source === 'delete-anchor') return;
    cursorRef.current = { cursor: { key, selectionStart: el.selectionStart ?? el.value.length, selectionEnd: el.selectionEnd ?? el.value.length }, source: 'user' };
  };

  const imageCount = countImages(blocks);
  const imagesFull = imageCount >= MAX_IMAGES_PER_POST;
  const blockLimitReached = composerAtBlockLimit(blocks, 1);

  const processImage = useCallback(
    async (key: string, file: File) => {
      codecRef.current ??= createBrowserImageCodec();
      try {
        const prepared = await prepareImage(file, codecRef.current);
        if (!liveKeysRef.current.has(key)) return; // 처리 중에 삭제된 사진
        const previewUrl = URL.createObjectURL(prepared.blob);
        urlsRef.current.add(previewUrl);
        onBlocksChange((prev) => resolveImageBlock(prev, key, { status: 'ready', source: 'new', previewUrl, prepared }));
      } catch (error) {
        onBlocksChange((prev) => removeComposerImage(prev, key, newBlockKey));
        const code = error instanceof PrepareImageError ? error.code : 'UNSUPPORTED';
        onError(code === 'TOO_LARGE' ? IMAGE_ERROR_MESSAGES.TOO_LARGE : IMAGE_ERROR_MESSAGES.UNSUPPORTED);
      }
    },
    [onBlocksChange, onError]
  );

  const openPicker = () => {
    if (imagesFull) {
      onError(IMAGE_ERROR_MESSAGES.TOO_MANY);
      return;
    }
    if (blockLimitReached) {
      onError(BLOCK_LIMIT_MESSAGE);
      return;
    }
    // 버튼을 누르는 순간의 커서를 확정한다. 입력칸에 포커스가 남아 있으면 그 입력칸의 실제 선택 위치가 가장 정확하다.
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    let activeCursor: ComposerCursor | null = null;
    for (const [key, el] of textareasRef.current) {
      if (el === active) activeCursor = { key, selectionStart: el.selectionStart, selectionEnd: el.selectionEnd };
    }
    pendingCursorRef.current = pickComposerInsertCursor(cursorRef.current, activeCursor, selectedImage);
    fileRef.current?.click();
  };

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    const run = () => {
      const withKeys = files.map((file) => ({ key: newBlockKey(), file }));
      const slots = remainingImageSlots(blocks);
      if (slots <= 0) {
        onError(IMAGE_ERROR_MESSAGES.TOO_MANY);
        return;
      }
      const accepted = withKeys.slice(0, slots);
      // 나누기·빈 입력칸으로 늘어날 수 있는 블록까지 고려해 상한을 넘으면 넣지 않는다.
      if (composerAtBlockLimit(blocks, accepted.length + 2)) {
        onError(BLOCK_LIMIT_MESSAGE);
        return;
      }
      // 사진 선택창에서 돌아온 시점에 입력칸이 그대로 있으면 그 입력칸의 현재 선택 위치를 다시 읽는다.
      // 사진 삭제 자리(anchor)는 다시 읽지 않는다 — 합쳐진 입력칸의 DOM 커서는 글 끝에 가 있다.
      const pending = pendingCursorRef.current;
      let cursor = pending?.cursor ?? null;
      const el = cursor && pending?.rereadLive ? textareasRef.current.get(cursor.key) : undefined;
      if (cursor && el) cursor = { key: cursor.key, selectionStart: el.selectionStart, selectionEnd: el.selectionEnd };
      pendingCursorRef.current = null;

      const pool = [newBlockKey(), newBlockKey(), newBlockKey()];
      const acceptedKeys = accepted.map((a) => a.key);
      const preview = insertImagesAtCursor(blocks, cursor, acceptedKeys, keySource(pool));
      onError(withKeys.length > accepted.length ? IMAGE_ERROR_MESSAGES.TOO_MANY : null);
      for (const k of preview.accepted) liveKeysRef.current.add(k);
      focusRef.current = preview.focus;
      setSelectedImage(null);
      onBlocksChange((prev) => insertImagesAtCursor(prev, cursor, acceptedKeys, keySource(pool)).blocks);
      for (const { key, file } of accepted) {
        queueRef.current = queueRef.current.then(() => processImage(key, file));
      }
    };

    // 한글 조합 중에는 글을 나누지 않는다. 조합이 끝나면 삽입한다.
    if (composingRef.current) deferredInsertRef.current = run;
    else run();
  };

  const removeImage = (block: Extract<EditorBlock, { kind: 'image' }>) => {
    liveKeysRef.current.delete(block.key);
    if (block.image.status === 'ready' && block.image.source === 'new') {
      URL.revokeObjectURL(block.image.previewUrl);
      urlsRef.current.delete(block.image.previewUrl);
    }
    setSelectedImage(null);
    // V2.1A — 지운 자리를 다음 [사진 추가] 위치로 기억한다(사진 교체). DOM 포커스는 옮기지 않는다(모바일 키보드가 뜨지 않게).
    const pool = [newBlockKey(), newBlockKey()];
    const { anchor } = removeComposerImageWithAnchor(blocks, block.key, keySource(pool));
    cursorRef.current = anchor ? { cursor: anchor, source: 'delete-anchor' } : null;
    onBlocksChange((prev) => removeComposerImageWithAnchor(prev, block.key, keySource(pool)).blocks);
    onError(null);
  };

  // V2.2 — 사진 이동. 기억한 커서(사용자 커서·삭제 anchor)가 합쳐져 사라지는 글 칸을 가리키면 합쳐진 글의 같은 위치로 옮긴다.
  const moveImage = (key: string, direction: -1 | 1) => {
    const pool = [newBlockKey(), newBlockKey()];
    const memory = cursorRef.current;
    if (memory) {
      const { cursor } = moveComposerImageWithCursor(blocks, key, direction, keySource(pool), memory.cursor);
      cursorRef.current = cursor ? { cursor, source: memory.source } : null;
    }
    revealImageRef.current = key;
    onBlocksChange((prev) => moveComposerImageWithCursor(prev, key, direction, keySource(pool), null).blocks);
  };

  const firstTextKey = blocks.find((b) => b.kind === 'text')?.key;

  return (
    <div className={styles.composer}>
      {/* V2.2 — 같은 버튼 하나. 데스크톱은 본문 위, 모바일(하단 탭바가 있는 폭)은 CSS로 본문 아래 하단 고정(탭바 위). */}
      <div ref={toolbarRef} className={styles.toolbar}>
        <button
          type="button"
          className={styles.photoButton}
          // 데스크톱에서 버튼을 눌러도 입력칸 포커스·커서를 잃지 않게 한다(모바일은 onBlur에서 기억한 커서를 쓴다).
          onMouseDown={(e) => e.preventDefault()}
          onClick={openPicker}
          disabled={disabled || imagesFull}
          aria-label={`사진 추가, 현재 ${imageCount}장, 최대 ${MAX_IMAGES_PER_POST}장`}
        >
          <ImagePlus size={18} aria-hidden="true" />
          <span>사진 추가</span>
          <span className={styles.count}>
            {imageCount}/{MAX_IMAGES_PER_POST}
          </span>
        </button>
      </div>
      <input ref={fileRef} type="file" accept={IMAGE_INPUT_ACCEPT} multiple className={styles.hiddenInput} onChange={handleFiles} tabIndex={-1} aria-hidden="true" />

      <div className={styles.body}>
        {blocks.map((block, index) => {
          if (block.kind === 'text') {
            const afterImage = index > 0 && blocks[index - 1].kind === 'image';
            const placeholder = block.key === firstTextKey && index === 0 ? '내용을 입력해주세요' : afterImage ? '이어서 작성해주세요' : undefined;
            return (
              <ComposerTextarea
                key={block.key}
                value={block.text}
                placeholder={placeholder}
                disabled={disabled}
                label={index === 0 ? '본문' : '본문 이어 쓰기'}
                register={(el) => {
                  if (el) textareasRef.current.set(block.key, el);
                  else textareasRef.current.delete(block.key);
                }}
                onChange={(value) => onBlocksChange((prev) => updateTextBlock(prev, block.key, value))}
                onCursor={(el, passive) => rememberCursor(block.key, el, passive)}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                  const deferred = deferredInsertRef.current;
                  deferredInsertRef.current = null;
                  if (deferred) deferred();
                }}
              />
            );
          }

          const selected = selectedImage === block.key;
          const move = composerImageMoveState(blocks, block.key);
          const image = block.image;
          return (
            <figure
              key={block.key}
              className={`${styles.imageCard} ${selected ? styles.imageSelected : ''}`}
              data-composer-image={block.key}
              // V2.2 — 편집기 사진에서만 브라우저 기본 이미지 메뉴(복사·다운로드·공유)와 끌기를 막는다.
              // 길게 누르면 메뉴 대신 사진을 선택한다. 게시글 상세의 사진은 이 컴포넌트가 아니라 영향이 없다.
              onContextMenu={(e) => {
                e.preventDefault();
                if (image.status === 'ready' && !disabled) setSelectedImage(block.key);
              }}
              onDragStart={(e) => e.preventDefault()}
            >
              {image.status === 'processing' ? (
                <div className={styles.processing} role="status">
                  <Loader2 size={20} className={styles.spin} aria-hidden="true" />
                  <span>사진을 준비하고 있어요</span>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.imageButton}
                  onClick={() => setSelectedImage(selected ? null : block.key)}
                  aria-pressed={selected}
                  aria-label={selected ? '사진 선택 해제' : '사진 선택(이동·삭제)'}
                  disabled={disabled}
                >
                  <img
                    className={styles.image}
                    src={image.source === 'new' ? image.previewUrl : image.url ?? ''}
                    width={image.source === 'new' ? image.prepared.width : image.width}
                    height={image.source === 'new' ? image.prepared.height : image.height}
                    alt="본문 사진"
                    draggable={false}
                  />
                </button>
              )}
              {selected && image.status === 'ready' && (
                <div className={styles.imageControls} role="group" aria-label="사진 조작">
                  <button type="button" className={styles.control} onClick={() => moveImage(block.key, -1)} disabled={disabled || !move.canUp} aria-label="이미지 위로 이동">
                    <ArrowUp size={18} aria-hidden="true" />
                  </button>
                  <button type="button" className={styles.control} onClick={() => moveImage(block.key, 1)} disabled={disabled || !move.canDown} aria-label="이미지 아래로 이동">
                    <ArrowDown size={18} aria-hidden="true" />
                  </button>
                  <button type="button" className={`${styles.control} ${styles.controlDanger}`} onClick={() => removeImage(block)} disabled={disabled} aria-label="이미지 삭제">
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </div>
              )}
            </figure>
          );
        })}
      </div>
      {blockLimitReached && (
        <p className={styles.limit} role="status">
          {BLOCK_LIMIT_MESSAGE}
        </p>
      )}
    </div>
  );
}

interface TextareaProps {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  label: string;
  register: (el: HTMLTextAreaElement | null) => void;
  onChange: (value: string) => void;
  /** passive: select·blur처럼 사용자가 커서를 직접 옮기지 않아도 나는 이벤트. */
  onCursor: (el: HTMLTextAreaElement, passive: boolean) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
}

function ComposerTextarea({ value, placeholder, disabled, label, register, onChange, onCursor, onCompositionStart, onCompositionEnd }: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const track = (e: React.SyntheticEvent<HTMLTextAreaElement>) => onCursor(e.currentTarget, false);
  const trackPassive = (e: React.SyntheticEvent<HTMLTextAreaElement>) => onCursor(e.currentTarget, true);
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        register(el);
      }}
      className={styles.textarea}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      maxLength={MAX_TEXT_BLOCK_CHARS}
      rows={value.length === 0 ? 2 : 1}
      disabled={disabled}
      onChange={(e) => {
        onChange(e.target.value);
        onCursor(e.target, false);
      }}
      onSelect={trackPassive}
      onKeyUp={track}
      onClick={track}
      onFocus={track}
      onBlur={trackPassive}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
    />
  );
}
