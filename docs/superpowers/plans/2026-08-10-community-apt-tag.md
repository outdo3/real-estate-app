# 커뮤니티 단지 태그 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 커뮤니티 게시글에 아파트 단지명을 태그할 수 있게 하고, 단지 상세페이지 → 커뮤니티 진입 시 해당 단지 글만 필터링해서 보여준다.

**Architecture:** `Post` 모델에 nullable `aptName` 문자열 필드를 추가한다(별도 `Apartment` 테이블 없이 자유 텍스트 — 이 앱 전역에서 아파트명은 이미 문자열 식별자로 다뤄짐). 글쓰기 폼에서 태그를 입력받고, 목록/상세 API가 이 필드로 정확 일치 필터링을 지원하며, 커뮤니티 목록/상세 페이지와 단지 상세페이지 UI가 이 필드를 읽고 쓴다.

**Tech Stack:** Next.js (App Router, 이 저장소 전용 커스텀 빌드 — `node_modules/next/dist/docs/` 확인 필수), Prisma + PostgreSQL(Supabase), SWR, CSS Modules.

## Global Constraints

- **테스트 프레임워크 없음** — 이 저장소에는 jest/vitest 등 어떤 테스트 러너도 설치되어 있지 않다(`package.json` 확인 완료). 기존 관례를 따라 각 태스크는 `npx tsc --noEmit`로 타입 검증하고, 최종적으로 `npm run build`로 검증한다. superpowers:test-driven-development의 "실패하는 테스트 먼저" 절차는 이 저장소에 적용할 test runner가 없으므로 각 태스크의 "테스트" 단계를 tsc 컴파일 검증으로 대체한다.
- **DB 연결 불가 (이번 세션 한정)** — `.env`의 `DATABASE_URL`이 채워지지 않은 Supabase 템플릿 값이라 `npx prisma db push`를 실행해도 실제 DB에 반영되지 않는다. 사용자가 "지금은 DB 없이 스키마/코드만 진행해달라"고 명시적으로 요청함. 따라서:
  - `npx prisma generate`는 DB 연결 없이 스키마 파일만으로 동작하므로 실행 가능 — Prisma Client 타입에 `aptName` 필드를 반영하기 위해 반드시 실행한다.
  - `npx prisma db push`는 이 계획에 태스크로 포함하지 않는다. 마지막에 "배포 전 필수 조치"로 별도 명시하고 사용자가 `DATABASE_URL`을 채운 뒤 직접(또는 다음 세션에서) 실행해야 한다.
  - DB에 실제로 글을 쓰고 필터링을 확인하는 브라우저 라이브 테스트도 이번 세션에서는 수행할 수 없다 — `npm run build`/`tsc` 통과와 코드 리뷰로 대체하고, 계획 마지막에 "DB 연결 후 수행할 라이브 검증 체크리스트"를 남긴다.
- **기존 관례 준수**: 쿼리파라미터를 읽을 때 `next/navigation`의 `useSearchParams` 훅(Suspense 경계 필요) 대신, 이 저장소 전역에서 이미 쓰고 있는 `useEffect` + `new URLSearchParams(window.location.search)` 패턴을 그대로 따른다 (`src/app/apt/[name]/apt-client.tsx:51-55` 참고).
- **CSS**: Tailwind 미설치, CSS Modules + 인라인 style 혼용 관례 유지 (Tailwind 도입 금지 — Sub-project A에서 사용자가 명시적으로 거부).
- **커밋**: `main` 브랜치에서 직접 작업, 태스크마다 커밋. `origin`으로의 push는 사용자가 명시적으로 요청할 때만.

---

### Task 1: Prisma 스키마에 `aptName` 필드 추가

**Files:**
- Modify: `prisma/schema.prisma` (82-97행, `Post` 모델)

**Interfaces:**
- Produces: `Post.aptName: string | null` — 이후 모든 태스크(API, UI)가 이 필드를 참조한다.

- [ ] **Step 1: 스키마 수정**

`prisma/schema.prisma`의 `Post` 모델을 다음과 같이 수정한다 (기존 82-97행 전체 교체):

```prisma
model Post {
  id        String   @id @default(cuid())
  title     String
  content   String   @db.Text
  // 관리자 권한으로 게시글을 목록 상단에 고정
  pinned    Boolean  @default(false)
  // 단지 상세페이지에서 연동되는 커뮤니티 글 태그 — 자유 텍스트, 정확 일치로만 필터링
  aptName   String?  @map("apt_name")
  authorId  String   @map("author_id")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  author   User      @relation(fields: [authorId], references: [id])
  comments Comment[]

  @@index([pinned, createdAt])
  @@index([aptName, createdAt])
  @@map("posts")
}
```

- [ ] **Step 2: Prisma Client 재생성 (DB 연결 불필요)**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` 성공 메시지, 에러 없음.

- [ ] **Step 3: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 기존과 동일하게 0 에러 (아직 아무 코드도 `aptName`을 참조하지 않으므로 스키마만 바뀐 상태로도 통과해야 함).

- [ ] **Step 4: 커밋**

```bash
git add prisma/schema.prisma
git commit -m "feat: Post 모델에 aptName 필드 추가 (커뮤니티 단지 태그)"
```

---

### Task 2: 게시글 작성/조회 API에 `aptName` 반영

**Files:**
- Modify: `src/app/api/community/posts/route.ts`

**Interfaces:**
- Consumes: `Post.aptName: string | null` (Task 1)
- Produces:
  - `POST /api/community/posts` — body에 선택적 `aptName?: string` 허용.
  - `GET /api/community/posts?aptName=...` — 있으면 정확 일치 필터링, 응답 `data.total`도 필터 반영.

- [ ] **Step 1: GET 핸들러에 필터 추가**

`src/app/api/community/posts/route.ts`의 `GET` 함수를 다음과 같이 수정한다:

```typescript
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const aptName = searchParams.get('aptName')?.trim() || undefined;
    const where = aptName ? { aptName } : undefined;

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          author: { select: { id: true, name: true, image: true, role: true } },
          _count: { select: { comments: true } },
        },
      }),
      prisma.post.count({ where }),
    ]);

    return NextResponse.json({ success: true, data: { posts, total, page, pageSize: PAGE_SIZE } });
  } catch (error) {
    console.error('Failed to list posts:', error);
    return NextResponse.json({ success: false, error: '게시글 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: POST 핸들러에 aptName 저장 추가**

같은 파일의 `POST` 함수에서 `body` 파싱 직후와 `prisma.post.create` 호출을 다음과 같이 수정한다:

```typescript
export async function POST(request: Request) {
  const { error, status, user } = await requireUser();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const body = await request.json();
    const title = (body.title || '').trim();
    const content = (body.content || '').trim();
    const aptName = (body.aptName || '').trim() || null;

    if (!title || !content) {
      return NextResponse.json({ success: false, error: '제목과 내용을 모두 입력해주세요.' }, { status: 400 });
    }
    if (title.length > 200) {
      return NextResponse.json({ success: false, error: '제목은 200자 이내로 입력해주세요.' }, { status: 400 });
    }

    const post = await prisma.post.create({
      data: { title, content, aptName, authorId: user!.id },
      include: { author: { select: { id: true, name: true, image: true, role: true } } },
    });

    return NextResponse.json({ success: true, data: post });
  } catch (error) {
    console.error('Failed to create post:', error);
    return NextResponse.json({ success: false, error: '게시글을 작성하지 못했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 3: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 0 에러.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/community/posts/route.ts
git commit -m "feat: 게시글 목록/작성 API에 aptName 필터링·저장 반영"
```

---

### Task 3: 글쓰기 페이지 — 단지명 입력 + URL 자동채움

**Files:**
- Modify: `src/app/community/write/page.tsx`
- Modify: `src/app/community/write/page.module.css`

**Interfaces:**
- Consumes: `POST /api/community/posts` body에 `aptName?: string` 허용 (Task 2)

- [ ] **Step 1: CSS에 단지명 입력칸 스타일 추가**

`src/app/community/write/page.module.css`에 다음을 추가한다 (`.titleInput` 규칙 뒤, 18-29행 다음):

```css
.aptNameInput {
  padding: 0.6rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  font-size: 0.85rem;
  outline: none;
  color: var(--text-secondary);
}

.aptNameInput:focus {
  border-color: var(--primary-color);
}
```

- [ ] **Step 2: 페이지에 단지명 입력칸 + 자동채움 추가**

`src/app/community/write/page.tsx` 전체를 다음으로 교체한다:

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import styles from './page.module.css';

export default function WritePostPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [aptName, setAptName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const queryAptName = searchParams.get('aptName');
    if (queryAptName) setAptName(queryAptName);
  }, []);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
      setError('제목과 내용을 모두 입력해주세요.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, aptName: aptName.trim() || undefined }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || '게시글을 작성하지 못했습니다.');
        return;
      }
      router.push(`/community/${json.data.id}`);
    } catch (e) {
      console.error(e);
      setError('게시글을 작성하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="글쓰기" />
        <div className="container">
          <div className={styles.form}>
            <input
              className={styles.aptNameInput}
              placeholder="단지명 (선택, 예: 래미안 강남포레스트)"
              value={aptName}
              onChange={(e) => setAptName(e.target.value)}
              maxLength={100}
            />
            <input
              className={styles.titleInput}
              placeholder="제목을 입력해주세요"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
            <textarea
              className={styles.contentInput}
              placeholder="내용을 입력해주세요"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            {error && <div className={styles.errorText}>⚠️ {error}</div>}
            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={() => router.back()}>
                취소
              </button>
              <button className={styles.submitBtn} onClick={handleSubmit} disabled={submitting}>
                {submitting ? '등록 중...' : '등록하기'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
```

- [ ] **Step 3: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 0 에러.

- [ ] **Step 4: 커밋**

```bash
git add src/app/community/write/page.tsx src/app/community/write/page.module.css
git commit -m "feat: 글쓰기 페이지에 단지명 태그 입력 + URL 자동채움 추가"
```

---

### Task 4: 커뮤니티 목록 페이지 — 단지 필터링 + 배지

**Files:**
- Modify: `src/app/community/page.tsx`
- Modify: `src/app/community/page.module.css`

**Interfaces:**
- Consumes: `GET /api/community/posts?aptName=...` (Task 2), `post.aptName: string | null` (Task 1)
- Produces: "글쓰기" 버튼 href에 `aptName` 쿼리파라미터 전달 (Task 3의 자동채움이 소비)

- [ ] **Step 1: CSS 추가**

`src/app/community/page.module.css`에 다음을 추가한다 (`.row:hover` 규칙, 49-51행 다음):

```css
.row {
  cursor: pointer;
}

.filterBanner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  background: #eff6ff;
  border: 1px solid #dbeafe;
  border-radius: 12px;
  padding: 0.85rem 1.1rem;
  margin-bottom: 1rem;
  font-size: 0.88rem;
  color: var(--text-primary);
}

.clearFilterBtn {
  flex-shrink: 0;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--primary-color);
  background: none;
  border: none;
  cursor: pointer;
  white-space: nowrap;
}

.aptBadge {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--primary-color);
  background: #eff6ff;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  text-decoration: none;
}

.aptBadge:hover {
  background: #dbeafe;
}
```

(`.row` 규칙에 이미 `cursor` 선언이 없었으므로, 기존 `.row { display: flex; align-items: center; gap: 0.75rem; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-color); text-decoration: none; color: inherit; }` 블록 안에 `cursor: pointer;` 한 줄을 추가하는 형태로 병합해도 무방하다 — 별도 블록으로 추가해도 CSS Modules는 동일 클래스에 대해 마지막 선언이 병합 적용되므로 결과는 같다.)

- [ ] **Step 2: 페이지 로직/마크업 교체**

`src/app/community/page.tsx` 전체를 다음으로 교체한다:

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import styles from './page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function CommunityPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [aptName, setAptName] = useState('');

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    setAptName(searchParams.get('aptName') || '');
  }, []);

  const queryKey = `/api/community/posts?page=${page}${aptName ? `&aptName=${encodeURIComponent(aptName)}` : ''}`;
  const { data, isLoading } = useSWR(queryKey, fetcher);

  const posts = data?.success ? data.data.posts : [];
  const total = data?.success ? data.data.total : 0;
  const pageSize = data?.success ? data.data.pageSize : 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const fetchError = data && !data.success ? data.error : null;

  const writeHref = `/community/write${aptName ? `?aptName=${encodeURIComponent(aptName)}` : ''}`;

  const handleClearFilter = () => {
    setAptName('');
    setPage(1);
    router.push('/community');
  };

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="커뮤니티" />
        <div className="container">
          {aptName && (
            <div className={styles.filterBanner}>
              <span>📍 <b>{aptName}</b> 관련글 · {total}건</span>
              <button className={styles.clearFilterBtn} onClick={handleClearFilter}>
                전체보기
              </button>
            </div>
          )}

          <div className={styles.headerTop}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>전체 {total}건</span>
            <Link href={writeHref} className={styles.writeBtn}>
              ✏️ 글쓰기
            </Link>
          </div>

          {isLoading ? (
            <div className={styles.emptyState}>불러오는 중입니다...</div>
          ) : fetchError ? (
            <div className={styles.emptyState}>⚠️ {fetchError}</div>
          ) : posts.length === 0 ? (
            <div className={styles.emptyState}>
              {aptName ? '아직 이 단지 관련 글이 없습니다. 첫 글을 남겨보세요!' : '아직 작성된 글이 없습니다. 첫 글을 남겨보세요!'}
            </div>
          ) : (
            <div className={styles.list}>
              {posts.map((post: any) => (
                <div
                  key={post.id}
                  className={styles.row}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/community/${post.id}`)}
                >
                  {post.pinned && <span className={styles.pinBadge}>고정</span>}
                  <span className={styles.rowTitle}>
                    {post.title} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>[{post._count.comments}]</span>
                  </span>
                  {post.aptName && (
                    <Link
                      href={`/apt/${encodeURIComponent(post.aptName)}`}
                      className={styles.aptBadge}
                      onClick={(e) => e.stopPropagation()}
                    >
                      🏢 {post.aptName}
                    </Link>
                  )}
                  <span className={styles.rowMeta}>
                    {post.author.role === 'ADMIN' && <span className={styles.adminBadge}>관리자</span>}
                    <span>{post.author.name}</span>
                    <span>{new Date(post.createdAt).toLocaleDateString('ko-KR')}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                이전
              </button>
              <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {page} / {totalPages}
              </span>
              <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                다음
              </button>
            </div>
          )}
        </div>
      </div>
    </AuthGate>
  );
}
```

주의: 행이 기존 `<Link href=...>`에서 `onClick` 핸들러가 있는 `<div>`로 바뀌었다 — 행 안에 `aptBadge`용 실제 `<Link>`를 중첩시키기 위해서다(앵커 안에 앵커를 넣는 건 유효하지 않은 HTML). "전체보기"도 `<Link>`가 아니라 `onClick`에서 `setAptName('')` 후 `router.push`를 호출하는 버튼이다 — 같은 라우트(`/community`)로 쿼리파라미터만 바뀌는 클라이언트 전환은 컴포넌트가 리마운트되지 않아 `useEffect(() => {...}, [])`가 다시 실행되지 않으므로, `Link`만으로는 화면의 `aptName` state가 갱신되지 않는다. 상태를 직접 초기화하는 이 방식으로 그 문제를 피한다.

- [ ] **Step 3: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 0 에러.

- [ ] **Step 4: 커밋**

```bash
git add src/app/community/page.tsx src/app/community/page.module.css
git commit -m "feat: 커뮤니티 목록에 단지 필터링/배지, 글쓰기 링크 aptName 전달 추가"
```

---

### Task 5: 게시글 상세페이지 — 단지 배지 표시

**Files:**
- Modify: `src/app/community/[id]/post-client.tsx`
- Modify: `src/app/community/[id]/page.module.css`

**Interfaces:**
- Consumes: `post.aptName: string | null` (`GET /api/community/posts/[id]`가 Task 1의 스칼라 필드를 자동으로 포함해서 반환 — 라우트 코드 수정 불필요)

- [ ] **Step 1: CSS 추가**

`src/app/community/[id]/page.module.css`에 다음을 추가한다 (`.adminBadge` 규칙, 40-47행 다음):

```css
.aptBadge {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--primary-color);
  background: #eff6ff;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  text-decoration: none;
}

.aptBadge:hover {
  background: #dbeafe;
}
```

- [ ] **Step 2: 배지 렌더링 추가**

`src/app/community/[id]/post-client.tsx`에서 `import` 목록에 `Link`를 추가하고, `postMeta` 렌더링 부분(101-106행)을 수정한다.

`import` 블록(1-9행)을 다음으로 교체:

```tsx
'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import useSWR from 'swr';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import styles from './page.module.css';
```

`postMeta` 블록(101-106행)을 다음으로 교체:

```tsx
                    <div className={styles.postMeta}>
                      {post.author.role === 'ADMIN' && <span className={styles.adminBadge}>관리자</span>}
                      <span>{post.author.name}</span>
                      <span>·</span>
                      <span>{new Date(post.createdAt).toLocaleString('ko-KR')}</span>
                      {post.aptName && (
                        <Link href={`/apt/${encodeURIComponent(post.aptName)}`} className={styles.aptBadge}>
                          🏢 {post.aptName}
                        </Link>
                      )}
                    </div>
```

- [ ] **Step 3: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 0 에러.

- [ ] **Step 4: 커밋**

```bash
git add src/app/community/[id]/post-client.tsx src/app/community/[id]/page.module.css
git commit -m "feat: 게시글 상세페이지에 단지 배지 표시"
```

---

### Task 6: 단지 상세페이지 — "이 단지로 글쓰기" 버튼 추가

**Files:**
- Modify: `src/app/apt/[name]/apt-client.tsx` (726-734행, 커뮤니티 카드)

**Interfaces:**
- Consumes: `/community/write?aptName=...` (Task 3의 자동채움이 이 링크를 소비)

- [ ] **Step 1: 커뮤니티 카드에 버튼 추가**

`src/app/apt/[name]/apt-client.tsx`의 726-734행을 다음으로 교체한다:

```tsx
        <div className={styles.communityCard}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>💬 {aptName} 실거주민 이야기가 궁금하다면?</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>커뮤니티에서 이 단지에 대한 이야기를 나눠보세요.</div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <Link href={`/community/write?aptName=${encodeURIComponent(aptName)}`} className={styles.quickBtn} style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
              이 단지로 글쓰기
            </Link>
            <Link href={`/community?aptName=${encodeURIComponent(aptName)}`} className={styles.quickBtn} style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
              커뮤니티 가기 &gt;
            </Link>
          </div>
        </div>
```

- [ ] **Step 2: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 0 에러.

- [ ] **Step 3: 커밋**

```bash
git add src/app/apt/[name]/apt-client.tsx
git commit -m "feat: 단지 상세페이지에 '이 단지로 글쓰기' 바로가기 버튼 추가"
```

---

### Task 7: 최종 빌드 검증 + 배포 전 필수 조치 정리

**Files:** 없음 (검증 전용 태스크)

- [ ] **Step 1: 전체 빌드**

Run: `npm run build`
Expected: 0 에러로 빌드 성공 (Task 1-6의 모든 변경이 함께 컴파일되는지 최종 확인).

- [ ] **Step 2: 변경된 파일 전체 목록 확인**

Run: `git log --oneline -7` 그리고 `git status`
Expected: Task 1-6에서 만든 6개 커밋(스키마 1 + API 1 + write 1 + list 1 + detail 1 + apt-client 1)이 최근 로그에 순서대로 보이고, `git status`는 클린(커밋 누락 없음).

- [ ] **Step 3: 사용자에게 "DB 연결 후 수행할 라이브 검증 체크리스트" 안내**

이 태스크는 코드 실행이 아니라, 사용자에게 다음 내용을 전달하는 것으로 완료한다 (커밋 없음):

> `DATABASE_URL`을 채운 뒤 아래 순서로 진행해주세요:
> 1. `npx prisma db push` 실행 — `posts` 테이블에 `apt_name` 컬럼이 실제로 추가됩니다.
> 2. 실제 데이터가 있는 단지 상세페이지 → "이 단지로 글쓰기" 클릭 → 단지명 자동채움 확인 → 글 작성.
> 3. 같은 단지 상세페이지 → "커뮤니티 가기" → 방금 쓴 글만 필터링되어 보이는지, 배너 문구/건수가 맞는지 확인.
> 4. "전체보기" 클릭 → 필터 해제되고 태그 없는 기존 글도 함께 보이는지 확인.
> 5. 목록/상세에서 🏢 배지 클릭 → 단지 상세페이지로 이동하는지, 배지 이외 영역 클릭은 여전히 글 상세로 이동하는지(행을 div+onClick으로 바꾼 리팩터링의 회귀 여부) 확인.

---

## 배포 전 필수 조치 (계획 밖, 수동)

- `DATABASE_URL`을 실제 Supabase 접속 정보로 채운 뒤 `npx prisma db push` 실행 — 이 계획의 어떤 태스크도 이 명령을 자동 실행하지 않는다(이번 세션은 DB 연결 정보가 없어 사용자가 명시적으로 스키마/코드만 진행하도록 요청함).
- 위 명령 실행 후 Task 7 Step 3의 라이브 검증 체크리스트를 수행한다.
