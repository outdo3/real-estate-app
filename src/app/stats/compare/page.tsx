import type { Metadata } from 'next';
import { Suspense } from 'react';
import { prisma } from '@/lib/prisma';
import { siteConfig, buildOpenGraph, absoluteUrl } from '@/config/site';
import { buildCompareSharePath, parseCompareAptSeqs } from '@/lib/compare-v2/url';
import { resolveCompareSeeds, EMPTY_COMPARE_SEEDS } from '@/lib/compare-v2/resolve-seeds';
import CompareV2 from '@/components/compare/CompareV2';
import { decideSeoulSeo, SEOUL_NOINDEX_ROBOTS } from '@/lib/seo/seoul-blocked-seo';

// COMPARE_SHARE_URL_COMPACT_FIX_V1 — /stats/compare 전용 라우트.
//
// 예전에는 /stats/[type]이 slug === 'compare'일 때 CompareV2를 렌더했다. 그 자리에서는
// 공유 링크의 aptSeq를 서버에서 풀 수 없었고(그래서 URL이 이름·동·구코드를 전부 이고
// 다녔다), 비교 화면만의 OG 제목도 만들 수 없었다.
// 정적 세그먼트가 동적 세그먼트보다 우선하므로 이 파일이 그 경로를 가져간다.

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/** searchParams 값은 string | string[] | undefined다. 배열이면 첫 값만 쓴다. */
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function readSeeds(searchParams: Props['searchParams']) {
  const sp = await searchParams;
  const { a, b } = parseCompareAptSeqs({ a: one(sp.a), b: one(sp.b) });
  if (!a && !b) return EMPTY_COMPARE_SEEDS;
  try {
    return await resolveCompareSeeds(prisma, { a, b });
  } catch {
    // DB를 못 읽은 것을 "그런 단지 없음"으로 위장하지 않는다 — 빈 화면으로 두고
    // 사용자가 직접 고르게 한다(legacy 파라미터가 있으면 클라이언트가 그걸 쓴다).
    return EMPTY_COMPARE_SEEDS;
  }
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { seeds } = await readSeeds(searchParams);
  const [a, b] = seeds;

  // SEOUL_BETA_PRELAUNCH_SEO_SAFETY_FIX_V1 — 공개 차단 서울 단지가 한쪽이라도 끼면 단지명을 제목/OG에 싣지 않고,
  // 그 조합을 canonical로 삼지 않는다. 판정은 master의 canonical 구 코드(sggCd)로만 한다.
  if (decideSeoulSeo([a?.lawdCd, b?.lawdCd], 'app') !== 'NONE') {
    const blockedTitle = `단지 비교 | ${siteConfig.name}`;
    const blockedDescription = '두 단지의 실거래가·이집점수·입지 데이터를 나란히 비교합니다.';
    const blockedCanonical = absoluteUrl('/stats/compare');
    return {
      title: blockedTitle,
      description: blockedDescription,
      alternates: { canonical: blockedCanonical },
      robots: SEOUL_NOINDEX_ROBOTS,
      openGraph: { ...buildOpenGraph({ title: blockedTitle, description: blockedDescription }), url: blockedCanonical },
    };
  }

  // 두 단지가 모두 확정됐을 때만 단지명을 제목에 쓴다. 한쪽만 알면 일반 제목이다 —
  // "OO vs (알 수 없음)" 같은 제목을 만들지 않는다.
  const title = a && b ? `${a.name} vs ${b.name} | ${siteConfig.name}` : `단지 비교 | ${siteConfig.name}`;
  const description =
    a && b
      ? `${a.name}와(과) ${b.name}의 실거래가·이집점수·입지 데이터를 나란히 비교합니다.`
      : '두 단지의 실거래가·이집점수·입지 데이터를 나란히 비교합니다.';

  const sharePath = a && b ? buildCompareSharePath(a.aptSeq, b.aptSeq) : null;
  const canonical = sharePath ? absoluteUrl(sharePath) : absoluteUrl('/stats/compare');

  return {
    title,
    description,
    alternates: { canonical },
    // REGIONAL_SEO_KEYWORD_LANDING_V1 §14 — 두 단지가 담긴 비교 상태는 조합마다 생기는 임시 화면이라
    // 색인하지 않는다(링크는 따라간다). 빈 비교 도구 화면은 그대로 색인 대상이다. 공유 카드는 영향 없다.
    ...(a && b ? { robots: { index: false, follow: true } } : {}),
    // 오리진은 siteConfig 한 곳에서만 나온다(§8) — buildOpenGraph가 그 계약을 쓴다.
    openGraph: { ...buildOpenGraph({ title, description }), url: canonical },
  };
}

export default async function CompareSharePage({ searchParams }: Props) {
  const { seeds, unresolved } = await readSeeds(searchParams);
  return (
    // CompareV2는 useSearchParams()로 legacy 파라미터를 읽으므로 Suspense 경계가 필요하다
    // (없으면 페이지 전체가 CSR로 강제 전환된다 — /stats/[type]과 동일한 이유).
    <Suspense fallback={null}>
      <CompareV2 initialSeeds={seeds} unresolvedAptSeqs={unresolved} />
    </Suspense>
  );
}
