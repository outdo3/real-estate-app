// COMMUNITY_EDITOR_V2 — 게시글 본문 공용 렌더러. V2 블록과 V1(legacy) 글이 같은 입력(블록 뷰)으로 들어온다.
// 텍스트는 React 텍스트 노드로만 렌더한다(HTML 해석 없음). 사진은 원본 비율·저장 크기·lazy 로딩.
import type { ContentBlockView } from '@/lib/community/content-blocks';
import styles from './CommunityPostContent.module.css';

export default function CommunityPostContent({ blocks }: { blocks: ContentBlockView[] }) {
  // 사진 번호(alt)는 표시되는 사진 기준으로 미리 매긴다(렌더 중 변수 변경 없음).
  const imageNumbers = new Map<number, number>();
  blocks.forEach((b, i) => {
    if (b.type === 'image' && b.url) imageNumbers.set(i, imageNumbers.size + 1);
  });
  return (
    <div className={styles.content}>
      {blocks.map((block, index) => {
        if (block.type === 'text') {
          return (
            <p key={`t-${index}`} className={styles.text}>
              {block.text}
            </p>
          );
        }
        if (!block.url) return null;
        return (
          <figure key={`i-${block.imageId}`} className={styles.figure}>
            {/* Supabase 공개 URL을 그대로 쓴다(Vercel 이미지 최적화·remotePatterns 불필요) */}
            <img
              src={block.url}
              alt={`게시글 이미지 ${imageNumbers.get(index)}`}
              width={block.width}
              height={block.height}
              loading="lazy"
              decoding="async"
              className={styles.image}
            />
          </figure>
        );
      })}
    </div>
  );
}
