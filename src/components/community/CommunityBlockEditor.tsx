'use client';

// COMMUNITY_EDITOR_V2 — 글쓰기·수정 공용 "미니 블록 편집기"(텍스트/사진 두 종류).
// 블록 배열 변경은 src/lib/community/block-editor-state.ts의 순수 함수로만 한다. 사진 전처리는 V1 파이프라인
// (prepareImage + 브라우저 codec) 그대로이며 한 장씩 순차 처리한다. 미리보기 object URL은 삭제·언마운트 시 해제한다.
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ImagePlus, Loader2, Plus, Trash2, Type, X } from 'lucide-react';
import { IMAGE_ERROR_MESSAGES, IMAGE_INPUT_ACCEPT, MAX_IMAGES_PER_POST } from '@/lib/community/image-rules';
import { PrepareImageError, createBrowserImageCodec, prepareImage } from '@/lib/community/image-compress';
import { MAX_CONTENT_BLOCKS, MAX_TEXT_BLOCK_CHARS } from '@/lib/community/content-blocks';
import {
  countImages,
  insertImagePlaceholders,
  insertTextBlock,
  moveBlock,
  removeBlock,
  resolveImageBlock,
  updateTextBlock,
  type EditorBlock,
} from '@/lib/community/block-editor-state';
import styles from './CommunityBlockEditor.module.css';

interface Props {
  blocks: EditorBlock[];
  onBlocksChange: React.Dispatch<React.SetStateAction<EditorBlock[]>>;
  onError: (message: string | null) => void;
  disabled?: boolean;
}

export const newBlockKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function AutoTextarea({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled?: boolean; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className={styles.textarea}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={MAX_TEXT_BLOCK_CHARS}
      rows={3}
      placeholder="내용을 입력해주세요"
      aria-label={label}
      disabled={disabled}
    />
  );
}

export default function CommunityBlockEditor({ blocks, onBlocksChange, onError, disabled }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const insertAtRef = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const liveKeysRef = useRef<Set<string>>(new Set());
  const urlsRef = useRef<Set<string>>(new Set());
  const codecRef = useRef<ReturnType<typeof createBrowserImageCodec> | null>(null);
  const [menuAt, setMenuAt] = useState<number | null>(null);

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

  const imageCount = countImages(blocks);
  const blocksFull = blocks.length >= MAX_CONTENT_BLOCKS;
  const imagesFull = imageCount >= MAX_IMAGES_PER_POST;

  const processImage = async (key: string, file: File) => {
    codecRef.current ??= createBrowserImageCodec();
    try {
      const prepared = await prepareImage(file, codecRef.current);
      if (!liveKeysRef.current.has(key)) return; // 처리 중에 삭제된 블록
      const previewUrl = URL.createObjectURL(prepared.blob);
      urlsRef.current.add(previewUrl);
      onBlocksChange((prev) => resolveImageBlock(prev, key, { status: 'ready', source: 'new', previewUrl, prepared }));
    } catch (error) {
      onBlocksChange((prev) => removeBlock(prev, key));
      const code = error instanceof PrepareImageError ? error.code : 'UNSUPPORTED';
      onError(code === 'TOO_LARGE' ? IMAGE_ERROR_MESSAGES.TOO_LARGE : IMAGE_ERROR_MESSAGES.UNSUPPORTED);
    }
  };

  const openImagePicker = (index: number) => {
    setMenuAt(null);
    if (imagesFull) {
      onError(IMAGE_ERROR_MESSAGES.TOO_MANY);
      return;
    }
    insertAtRef.current = index;
    fileRef.current?.click();
  };

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    const withKeys = files.map((file) => ({ key: newBlockKey(), file }));
    const roomForBlocks = MAX_CONTENT_BLOCKS - blocks.length;
    const limited = withKeys.slice(0, Math.max(0, roomForBlocks));
    const result = insertImagePlaceholders(blocks, insertAtRef.current, limited.map((w) => w.key));
    if (result.accepted.length === 0) {
      onError(roomForBlocks <= 0 ? `내용 블록은 최대 ${MAX_CONTENT_BLOCKS}개까지 추가할 수 있어요.` : IMAGE_ERROR_MESSAGES.TOO_MANY);
      return;
    }
    onError(result.rejected > 0 || limited.length < withKeys.length ? IMAGE_ERROR_MESSAGES.TOO_MANY : null);
    for (const k of result.accepted) liveKeysRef.current.add(k);
    const insertAt = insertAtRef.current;
    onBlocksChange((prev) => insertImagePlaceholders(prev, insertAt, result.accepted).blocks);
    for (const { key, file } of withKeys.filter((w) => result.accepted.includes(w.key))) {
      queueRef.current = queueRef.current.then(() => processImage(key, file));
    }
  };

  const addText = (index: number) => {
    setMenuAt(null);
    if (blocksFull) {
      onError(`내용 블록은 최대 ${MAX_CONTENT_BLOCKS}개까지 추가할 수 있어요.`);
      return;
    }
    onBlocksChange((prev) => insertTextBlock(prev, index, newBlockKey()));
  };

  const remove = (block: EditorBlock) => {
    liveKeysRef.current.delete(block.key);
    if (block.kind === 'image' && block.image.status === 'ready' && block.image.source === 'new') {
      URL.revokeObjectURL(block.image.previewUrl);
      urlsRef.current.delete(block.image.previewUrl);
    }
    onBlocksChange((prev) => removeBlock(prev, block.key));
    onError(null);
  };

  const renderInsertRow = (index: number) =>
    menuAt === index ? (
      <div key={`menu-${index}`} className={styles.insertMenu} role="group" aria-label="추가할 내용 선택">
        <button type="button" className={styles.insertChoice} onClick={() => addText(index)} disabled={disabled || blocksFull}>
          <Type size={16} aria-hidden="true" />글 추가
        </button>
        <button type="button" className={styles.insertChoice} onClick={() => openImagePicker(index)} disabled={disabled || imagesFull || blocksFull}>
          <ImagePlus size={16} aria-hidden="true" />사진 추가
        </button>
        <button type="button" className={styles.insertClose} onClick={() => setMenuAt(null)} aria-label="추가 메뉴 닫기">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    ) : (
      <div key={`row-${index}`} className={styles.insertRow}>
        <button type="button" className={styles.insertButton} onClick={() => setMenuAt(index)} disabled={disabled || blocksFull}>
          <Plus size={15} aria-hidden="true" />내용 추가
        </button>
      </div>
    );

  // 블록 라벨(글 n / 사진 n)을 렌더 전에 계산한다.
  const labels: string[] = [];
  {
    let texts = 0;
    let images = 0;
    for (const b of blocks) labels.push(b.kind === 'text' ? `글 ${++texts}` : `사진 ${++images}`);
  }

  return (
    <div className={styles.editor}>
      <input ref={fileRef} type="file" accept={IMAGE_INPUT_ACCEPT} multiple className={styles.hiddenInput} onChange={handleFiles} tabIndex={-1} aria-hidden="true" />
      <div className={styles.meta}>
        <span>
          사진 <strong>{imageCount}</strong>/{MAX_IMAGES_PER_POST}
        </span>
        <span>
          블록 {blocks.length}/{MAX_CONTENT_BLOCKS}
        </span>
      </div>

      {renderInsertRow(0)}
      {blocks.map((block, index) => {
        const label = labels[index];
        return (
          <React.Fragment key={block.key}>
            <section className={styles.block} aria-label={label}>
              <div className={styles.blockHeader}>
                <span className={styles.blockLabel}>
                  {block.kind === 'text' ? <Type size={14} aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}
                  {label}
                </span>
                <div className={styles.controls}>
                  <button type="button" className={styles.control} onClick={() => onBlocksChange((prev) => moveBlock(prev, block.key, -1))} disabled={disabled || index === 0} aria-label={`${label} 위로 이동`}>
                    <ChevronUp size={18} aria-hidden="true" />
                  </button>
                  <button type="button" className={styles.control} onClick={() => onBlocksChange((prev) => moveBlock(prev, block.key, 1))} disabled={disabled || index === blocks.length - 1} aria-label={`${label} 아래로 이동`}>
                    <ChevronDown size={18} aria-hidden="true" />
                  </button>
                  <button type="button" className={`${styles.control} ${styles.controlDanger}`} onClick={() => remove(block)} disabled={disabled} aria-label={`${label} 삭제`}>
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {block.kind === 'text' ? (
                <AutoTextarea value={block.text} onChange={(v) => onBlocksChange((prev) => updateTextBlock(prev, block.key, v))} disabled={disabled} label={`${label} 내용`} />
              ) : block.image.status === 'processing' ? (
                <div className={styles.processing} role="status">
                  <Loader2 size={20} className={styles.spin} aria-hidden="true" />
                  <span>사진을 준비하고 있어요</span>
                </div>
              ) : (
                // 미리보기는 저장될(압축된) 사진 또는 이미 저장된 사진이다. 원본 비율 유지, 자르지 않는다.
                <img
                  className={styles.preview}
                  src={block.image.source === 'new' ? block.image.previewUrl : block.image.url ?? ''}
                  width={block.image.source === 'new' ? block.image.prepared.width : block.image.width}
                  height={block.image.source === 'new' ? block.image.prepared.height : block.image.height}
                  alt={`${label} 미리보기`}
                />
              )}
            </section>
            {renderInsertRow(index + 1)}
          </React.Fragment>
        );
      })}
    </div>
  );
}
