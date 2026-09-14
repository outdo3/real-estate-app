'use client';

// COMMUNITY_IMAGE_UPLOAD_V1 — 글쓰기 사진 선택/미리보기.
// 선택한 파일은 한 장씩 순차로 전처리한다(모바일 메모리 보호). 미리보기는 **압축 결과**의 object URL이며,
// 삭제·언마운트 시 반드시 해제한다. 업로드는 여기서 하지 않는다 — 등록 버튼에서 부모가 한다.
import React, { useEffect, useRef } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { IMAGE_ERROR_MESSAGES, IMAGE_INPUT_ACCEPT, MAX_IMAGES_PER_POST } from '@/lib/community/image-rules';
import { PrepareImageError, createBrowserImageCodec, prepareImage, type PreparedImage } from '@/lib/community/image-compress';
import styles from './CommunityImagePicker.module.css';

export interface PickedImage {
  id: string;
  status: 'processing' | 'ready';
  previewUrl?: string;
  prepared?: PreparedImage;
}

interface Props {
  images: PickedImage[];
  onImagesChange: React.Dispatch<React.SetStateAction<PickedImage[]>>;
  onError: (message: string | null) => void;
  disabled?: boolean;
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function CommunityImagePicker({ images, onImagesChange, onError, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const liveIdsRef = useRef<Set<string>>(new Set());
  const urlsRef = useRef<Set<string>>(new Set());
  const codecRef = useRef<ReturnType<typeof createBrowserImageCodec> | null>(null);

  useEffect(() => {
    liveIdsRef.current = new Set(images.map((i) => i.id));
  }, [images]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  const revoke = (url?: string) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    urlsRef.current.delete(url);
  };

  const processOne = async (id: string, file: File) => {
    codecRef.current ??= createBrowserImageCodec();
    try {
      const prepared = await prepareImage(file, codecRef.current);
      if (!liveIdsRef.current.has(id)) return; // 처리 중에 사용자가 지운 항목
      const previewUrl = URL.createObjectURL(prepared.blob);
      urlsRef.current.add(previewUrl);
      onImagesChange((prev) => prev.map((img) => (img.id === id ? { id, status: 'ready', previewUrl, prepared } : img)));
    } catch (error) {
      onImagesChange((prev) => prev.filter((img) => img.id !== id));
      const code = error instanceof PrepareImageError ? error.code : 'UNSUPPORTED';
      onError(code === 'TOO_LARGE' ? IMAGE_ERROR_MESSAGES.TOO_LARGE : IMAGE_ERROR_MESSAGES.UNSUPPORTED);
    }
  };

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ''; // 같은 파일을 다시 고를 수 있게
    if (files.length === 0) return;
    const remaining = MAX_IMAGES_PER_POST - images.length;
    if (remaining <= 0) {
      onError(IMAGE_ERROR_MESSAGES.TOO_MANY);
      return;
    }
    onError(files.length > remaining ? IMAGE_ERROR_MESSAGES.TOO_MANY : null);
    const accepted = files.slice(0, remaining).map((file) => ({ id: newId(), file }));
    for (const a of accepted) liveIdsRef.current.add(a.id);
    onImagesChange((prev) => [...prev, ...accepted.map(({ id }) => ({ id, status: 'processing' as const }))]);
    for (const a of accepted) {
      queueRef.current = queueRef.current.then(() => processOne(a.id, a.file));
    }
  };

  const remove = (id: string) => {
    liveIdsRef.current.delete(id);
    revoke(images.find((img) => img.id === id)?.previewUrl);
    onImagesChange((prev) => prev.filter((img) => img.id !== id));
    onError(null);
  };

  const full = images.length >= MAX_IMAGES_PER_POST;

  return (
    <div className={styles.picker}>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_INPUT_ACCEPT}
        multiple
        className={styles.hiddenInput}
        onChange={handleFiles}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button type="button" className={styles.addButton} onClick={() => inputRef.current?.click()} disabled={disabled || full}>
        <ImagePlus size={18} aria-hidden="true" />
        <span>사진 추가</span>
        <span className={styles.count} aria-label={`${images.length}장 선택됨, 최대 ${MAX_IMAGES_PER_POST}장`}>
          {images.length}/{MAX_IMAGES_PER_POST}
        </span>
      </button>

      {images.length > 0 && (
        <ul className={styles.previewList}>
          {images.map((img, index) => (
            <li key={img.id} className={styles.previewItem}>
              {img.status === 'ready' && img.previewUrl ? (
                // blob: 미리보기는 next/image 최적화 대상이 아니다
                <img src={img.previewUrl} alt={`선택한 사진 ${index + 1}`} className={styles.previewImage} />
              ) : (
                <div className={styles.processing} role="status">
                  <Loader2 size={18} className={styles.spin} aria-hidden="true" />
                  <span>준비 중</span>
                </div>
              )}
              <span className={styles.order}>
                {index + 1}/{MAX_IMAGES_PER_POST}
              </span>
              <button type="button" className={styles.removeButton} onClick={() => remove(img.id)} disabled={disabled} aria-label={`사진 ${index + 1} 삭제`}>
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
