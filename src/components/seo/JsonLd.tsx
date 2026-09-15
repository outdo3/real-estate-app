import { serializeJsonLd, type JsonLd as JsonLdData } from '@/lib/seo/site-seo';

/**
 * REGIONAL_SEO_KEYWORD_LANDING_V1 §16 — 구조화 데이터 `<script>`.
 * Next 16 JSON-LD 가이드: page/layout에서 네이티브 script로 렌더하고 `<`를 이스케이프한다.
 */
export default function JsonLd({ data }: { data: JsonLdData | null }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
