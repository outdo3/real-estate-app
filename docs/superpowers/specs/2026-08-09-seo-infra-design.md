# 도메인/서비스명 가변형 SEO 인프라 — 설계 문서

날짜: 2026-08-09

## 배경 및 목표

서비스명(현재 "아파트써처")이나 배포 도메인이 향후 바뀌어도 `siteConfig` 하나만 수정하면 전체 SEO/메타 태그가 따라가도록 만든다. 아울러 실거래가/시장통계/학군정보/커뮤니티 게시글/단지 상세 5개 페이지에 페이지별 동적 title/description/OG 태그를 부여하고, `robots.txt`·`sitemap.xml`을 동적으로 생성한다.

## 사전 조사에서 확인한 제약

- 대상 5개 페이지(`/`, `/stats`, `/school`, `/community/[id]`, `/apt/[name]`)는 모두 `'use client'` 컴포넌트다. Next.js는 `metadata`/`generateMetadata`를 서버 컴포넌트에서만 지원하므로 구조 분리가 필요하다.
- 지역 선택 상태(`RegionContext`)는 React Context로만 관리되고 URL에는 반영되지 않는다 (`/stats`, `/school` 모두 쿼리파라미터 없음).
- `/apt/[name]` 상세 데이터는 국토부 실거래가 API를 그때그때 호출해서 만들어지며, DB에 저장된 "단지 목록"이 없다. `TradeHistory` 모델은 스키마에만 존재하고 어떤 코드에서도 write하지 않는 사실상 미사용 테이블이며, `.env`의 `DATABASE_URL`도 플레이스홀더 상태다.
- `public/`에 브랜드 OG 이미지 자산이 없다.

이 문서에 반영된 결정(사용자 확인 완료):
1. `siteConfig` 기본 사이트명은 실제 브랜딩과 일치하는 **"아파트써처"** (요청서의 "이집"은 예시로 간주).
2. `/stats`, `/school`에 지역 쿼리파라미터를 **추가**하여 지역별 URL을 사이트맵/메타데이터에 반영한다.
3. `TradeHistory` 기반 "주요 단지" 사이트맵 항목은 **이번 범위에서 제외**한다 (테이블이 비어 있어 실질적 효과가 없음). 다만 향후 데이터가 채워지면 자연스럽게 포함되도록 소스 함수는 분리해 둔다.

## A. `src/config/site.ts`

```ts
export const siteConfig = {
  name: process.env.NEXT_PUBLIC_SITE_NAME || '아파트써처',
  url: (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  description: '전국 아파트 실거래가, 시세 변동 추이, 시장 분석, 학군 정보를 한눈에 확인하세요.',
};

export function absoluteUrl(path: string): string {
  return `${siteConfig.url}${path.startsWith('/') ? path : `/${path}`}`;
}
```

`app/layout.tsx`의 루트 `metadata`(title/description)와 `metadataBase`를 `siteConfig`를 참조하도록 교체한다. `Header.tsx`의 로고 텍스트는 건드리지 않는다(이미 "아파트써처"로 하드코딩되어 있고 요청 범위 밖).

## B. 페이지 구조 분리 + 메타데이터

각 대상 라우트를 "서버 `page.tsx`(메타데이터 전담) + 클라이언트 `*-client.tsx`(기존 로직 그대로 이동)" 형태로 나눈다. 클라이언트 로직/동작은 변경하지 않고 파일만 이동한다.

| 라우트 | 신규 클라이언트 파일 | 메타데이터 소스 |
|---|---|---|
| `src/app/page.tsx` | `src/app/home-client.tsx` | 정적 `metadata` (사이트 전역 타이틀) |
| `src/app/stats/page.tsx` | `src/app/stats/stats-client.tsx` | `generateMetadata`가 `searchParams.sido`/`sigungu` 읽어 지역명 반영 |
| `src/app/school/page.tsx` | `src/app/school/school-client.tsx` | 동일 패턴 (`sido`/`sigungu`) |
| `src/app/community/[id]/page.tsx` | `src/app/community/[id]/post-client.tsx` | `generateMetadata`에서 `prisma.post.findUnique`로 직접 조회 → title=글 제목, description=본문 앞 120자 요약, `openGraph.type = 'article'` |
| `src/app/apt/[name]/page.tsx` | `src/app/apt/[name]/apt-client.tsx` | `generateMetadata`가 라우트 파라미터 `name`만으로 타이틀 생성 (국토부 API 재호출 없음) |

- `community/[id]`의 `generateMetadata`는 글이 없으면 `notFound()` 대신 기본 타이틀로 폴백한다(현재 클라이언트 로직이 없는 글 ID에 대해 자체적으로 에러 메시지를 렌더링하는 방식을 유지하기 위함 — 동작 변경 없음 원칙).
- `apt/[name]`의 `name`은 URL 인코딩된 단지명이므로 `decodeURIComponent` 후 타이틀에 사용한다.

## C. `/stats`, `/school` 지역 쿼리파라미터

- URL 형태: `/stats?sido=서울특별시&sigungu=강남구`, `/school?sido=...&sigungu=...`
- 클라이언트 컴포넌트(`stats-client.tsx`, `school-client.tsx`)는 마운트 시 `useSearchParams()`로 쿼리를 읽어 값이 있으면 `setRegion(...)`으로 `RegionContext`를 초기화한다(최초 1회만; 이후 사용자가 모달로 지역을 바꾸는 기존 동작은 그대로 유지하고 URL을 되쓰지는 않는다 — 크롤러가 진입 시 올바른 초기 콘텐츠를 보는 것이 목적이므로 매 상호작용마다 URL을 동기화하는 범위는 포함하지 않는다).
- `lawdCd`는 쿼리에 없으므로 `sido`+`sigungu` → `lawdCd` 매핑은 기존 `src/lib/region-utils.ts`의 로직을 재사용한다.

## D. `robots.ts` / `sitemap.ts`

`src/app/robots.ts`:
```ts
import type { MetadataRoute } from 'next';
import { siteConfig } from '@/config/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}
```

`src/app/sitemap.ts` (동적, DB 조회 포함하므로 `force-dynamic`으로 명시해 빌드 시점에 Prisma를 건드리지 않게 한다):
```ts
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = ['/', '/stats', '/school', '/community'];
  const regionRoutes = /* REGION_DATA(src/lib/regions.ts)의 sido×sigungu 조합으로 /stats, /school 각각 생성 */;
  const posts = await prisma.post.findMany({ select: { id: true, updatedAt: true }, orderBy: { createdAt: 'desc' }, take: 500 });
  const postRoutes = posts.map(p => ({ url: absoluteUrl(`/community/${p.id}`), lastModified: p.updatedAt }));
  return [...staticRoutes.map(...), ...regionRoutes, ...postRoutes];
}
```
- `/admin`, `/mypage`는 로그인 전용이므로 사이트맵/robots 허용 범위에 포함하지 않는다 (robots는 전체 `Allow: /`이지만 sitemap 목록에서만 제외 — 요청서의 "Allow: /"는 그대로 지키되 굳이 크롤러를 비공개 페이지로 유도하지 않음).
- 커뮤니티 글은 최대 500개로 제한(사이트맵 URL 5만 개 제한과 무관하게 우선 안전한 상한).
- 단지 상세 URL은 이번엔 생성하지 않되, `TradeHistory` 조회 함수를 별도로 분리해두어 향후 데이터가 채워지면 한 줄 추가로 포함 가능하게 한다.

## E. 빌드 검증 및 배포

1. `npm run build` 클린 빌드(에러/경고 0건, 특히 `sitemap.ts`가 빌드 타임에 DB에 접근하지 않는지 확인).
2. 로컬에서 `DATABASE_URL`이 플레이스홀더라 Prisma 쿼리가 실패할 수 있음 — `force-dynamic`으로 런타임 호출로 미루므로 빌드는 통과해야 하지만, 실제 동작 확인(글 목록이 사이트맵에 뜨는지)은 운영 DB가 연결된 환경에서만 가능하다는 점을 명시한다.
3. 통과 확인 후 `git push origin main`.
