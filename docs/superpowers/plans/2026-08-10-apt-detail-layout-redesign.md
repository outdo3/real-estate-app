# 단지 상세페이지 레이아웃 개편 (A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/app/apt/[name]/apt-client.tsx`를 3구역 레이아웃(상단: 스펙+차트+투자지표,
중단: 평형선택+실거래내역+브리핑, 하단: 입지정보+커뮤니티+공유)으로 재구성하고, 평형 선택을
칩+드롭다운으로 압축하고, 핵심 투자지표(전세가율/갭)·단지 브리핑·카카오톡 공유를 새로
추가한다.

**Architecture:** 4개의 독립적인 신규 컴포넌트/유틸(`AreaSelector`, `InvestmentMetrics`,
`KakaoShareButton`, `apt-brief.ts`)을 각각 자기완결적으로 만든 뒤, `apt-client.tsx`에서
조립한다. `AreaSelector`는 순수 프레젠테이션 컴포넌트(부모의 `selectedArea` state를 그대로
사용)이고, `InvestmentMetrics`는 `KakaoPlaces`와 같은 패턴으로 자체적으로
`/api/apt/[name]`을 호출하는 자기완결형 컴포넌트다(기존 필터 토글과 무관하게 최근 6개월
매매+전월세를 고정 조회). `KakaoShareButton`은 기존 카카오 지도 SDK와는 별개인 카카오
JavaScript SDK(공유하기)를 자체 로드한다. 기존 "최근 실거래 타임라인"과 "전체 실거래
내역"(두 개의 중복 표시)은 하나의 카드리스트로 통합한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules(기존
`detail.module.css` 그대로, Tailwind 미도입). 테스트 프레임워크 없음 — `npm run build` +
로컬 브라우저 수동 확인이 검증 기준.

## Global Constraints

- Tailwind CSS를 새로 설치하지 않는다 — 기존 CSS Modules + 인라인 style 컨벤션을 그대로
  따른다.
- 공시가/보유세 관련 UI·데이터·API 연동을 일절 추가하지 않는다. 1구역 핵심 투자 지표는
  전세가율·갭 금액 2개만(둘 다 실거래가 기반).
- 단지 브리핑은 실제 LLM 호출이 아니라 이미 보유한 데이터를 조합한 규칙 기반 텍스트다.
- 커뮤니티 연동은 이번 범위에서 `/community?aptName=...` 링크만 배치한다 — 실제 단지별
  필터링(DB 마이그레이션)은 별도 작업(B)에서 진행하므로 이번에 `Post` 모델이나 커뮤니티
  페이지 자체는 건드리지 않는다.
- 카카오톡 공유는 카카오 디벨로퍼스 콘솔의 "카카오톡 공유" 제품 활성화 여부에 코드가 좌우될
  수 있다 — 실패 시 URL 클립보드 복사로 폴백해서 완전히 막히지 않게 한다.
- `npm run build` 클린 통과가 각 태스크의 필수 검증 기준이다.
- 별도 브랜치/워크트리 없이 `main`에서 바로 작업한다. 각 태스크 완료 시 로컬 커밋만 하고
  push는 하지 않는다.

---

## Task 1: 단지 브리핑 텍스트 생성 유틸

**Files:**
- Create: `src/lib/apt-brief.ts`

**Interfaces:**
- Produces: `buildAptBrief(input: AptBriefInput): string[]` — Task 5에서 사용.
  `AptBriefInput = { trades: Array<{tradeDate:string; price:number; tradeType:string}>; tradeTypeFilter: '매매'|'전월세'; totalHouseholds: string|null; buildYear: number|null; }`

- [ ] **Step 1: 작성**

```ts
export interface AptBriefTrade {
  tradeDate: string;
  price: number;
  tradeType: string;
}

export interface AptBriefInput {
  // 현재 화면에 적용된 평형/기간/유형 필터가 반영된 거래 목록 (최신순 정렬, apt-client.tsx의
  // filteredTrades를 그대로 넘긴다 — 사용자가 보고 있는 조건 기준으로 브리핑이 생성된다).
  trades: AptBriefTrade[];
  tradeTypeFilter: '매매' | '전월세';
  totalHouseholds: string | null; // aptInfo['세대수'] 원본 문자열 (예: "1,302세대")
  buildYear: number | null;
}

const parseHouseholdCount = (raw: string | null): number | null => {
  if (!raw) return null;
  const num = parseInt(raw.replace(/[^0-9]/g, ''), 10);
  return isNaN(num) ? null : num;
};

// 이미 보유한 데이터(시세 추이, 세대수, 준공연도, 최근 거래 빈도)를 조합해 2~4개의
// 규칙 기반 브리핑 문장을 만든다. 실제 LLM 호출이 아니다 — 데이터가 부족한 항목은
// 해당 문장을 건너뛰고, 아무 것도 만들 수 없으면 안내 문구 하나로 폴백한다.
export function buildAptBrief(input: AptBriefInput): string[] {
  const { trades, tradeTypeFilter, totalHouseholds, buildYear } = input;
  const sentences: string[] = [];

  // 1. 최근 시세 추이 (매매 기준, 거래 2건 이상일 때만 — trades는 최신순이므로
  // trades[0]이 최신, trades[trades.length-1]이 가장 오래된 거래)
  if (tradeTypeFilter === '매매' && trades.length >= 2) {
    const latest = trades[0].price;
    const oldest = trades[trades.length - 1].price;
    if (oldest > 0) {
      const pctChange = ((latest - oldest) / oldest) * 100;
      if (pctChange >= 3) {
        sentences.push(`최근 시세는 약 ${pctChange.toFixed(1)}% 상승 추세입니다.`);
      } else if (pctChange <= -3) {
        sentences.push(`최근 시세는 약 ${Math.abs(pctChange).toFixed(1)}% 하락 추세입니다.`);
      } else {
        sentences.push('최근 시세는 큰 변동 없이 보합세를 보이고 있습니다.');
      }
    }
  }

  // 2. 단지 규모/연식
  const households = parseHouseholdCount(totalHouseholds);
  const age = buildYear ? new Date().getFullYear() - buildYear : null;
  const ageLabel = age === null ? null : age <= 5 ? '신축' : age <= 15 ? '준신축' : '구축';
  if (households && ageLabel) {
    sentences.push(`총 ${households.toLocaleString('ko-KR')}세대 규모의 ${ageLabel} 단지입니다.`);
  } else if (households) {
    sentences.push(`총 ${households.toLocaleString('ko-KR')}세대 규모의 단지입니다.`);
  } else if (ageLabel) {
    sentences.push(`${ageLabel} 단지입니다.`);
  }

  // 3. 최근 거래 활발도 (최근 3개월)
  if (trades.length > 0) {
    const now = new Date();
    const recentCount = trades.filter((t) => {
      const diffDays = (now.getTime() - new Date(t.tradeDate).getTime()) / (1000 * 60 * 60 * 24);
      return diffDays <= 90;
    }).length;
    sentences.push(
      recentCount >= 3
        ? `최근 3개월간 ${recentCount}건 거래되어 거래가 활발한 편입니다.`
        : `최근 3개월간 ${recentCount}건 거래되어 거래가 다소 드문 편입니다.`
    );
  }

  if (sentences.length === 0) {
    sentences.push('최근 실거래 데이터가 충분하지 않아 상세한 브리핑을 제공하기 어렵습니다.');
  }

  return sentences;
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/lib/apt-brief.ts
git commit -m "feat: 데이터 기반 단지 브리핑 텍스트 생성 유틸 추가"
```

---

## Task 2: 평형 선택 칩+드롭다운 컴포넌트

**Files:**
- Create: `src/components/AreaSelector.tsx`

**Interfaces:**
- Produces: `<AreaSelector trades={Array<{area:string}>} selectedArea={string} onSelect={(area:string)=>void} />` — Task 5에서 사용.

- [ ] **Step 1: 작성**

```tsx
'use client';

import React, { useState } from 'react';
import { getAreaInfo } from '@/lib/area-utils';

interface AreaSelectorProps {
  trades: Array<{ area: string }>;
  selectedArea: string;
  onSelect: (area: string) => void;
}

const MAX_CHIPS = 4;

// 거래량이 많은 상위 평형만 칩으로 노출하고, 나머지는 드롭다운(레이어)에서 선택한다.
// 현재 선택된 평형이 상위권 밖이어도 칩에 항상 보이도록 강제 포함한다.
export default function AreaSelector({ trades, selectedArea, onSelect }: AreaSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const countByArea = new Map<string, number>();
  trades.forEach((t) => {
    countByArea.set(t.area, (countByArea.get(t.area) || 0) + 1);
  });

  const allAreas = Array.from(countByArea.keys()).sort((a, b) => parseFloat(a) - parseFloat(b));

  const topAreas = Array.from(countByArea.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CHIPS)
    .map(([area]) => area);

  const chipAreas = selectedArea !== '전체' && !topAreas.includes(selectedArea)
    ? [...topAreas, selectedArea]
    : topAreas;

  const renderAreaLabel = (area: string) => {
    const { supplyPyung } = getAreaInfo(parseFloat(area));
    return `${area} (공급 약 ${supplyPyung}평)`;
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.5rem 1rem',
    borderRadius: '999px',
    fontWeight: 600,
    border: '1px solid',
    cursor: 'pointer',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    backgroundColor: active ? 'var(--primary-color)' : 'white',
    color: active ? 'white' : 'var(--text-secondary)',
    borderColor: active ? 'var(--primary-color)' : 'var(--border-color)',
  });

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '0.25rem' }}>
        <button onClick={() => onSelect('전체')} style={chipStyle(selectedArea === '전체')}>
          전체
        </button>
        {chipAreas.map((area) => (
          <button key={area} onClick={() => onSelect(area)} style={chipStyle(selectedArea === area)}>
            {renderAreaLabel(area)}
          </button>
        ))}
        {allAreas.length > 0 && (
          <button
            onClick={() => setIsOpen(true)}
            style={{
              padding: '0.5rem 1rem', borderRadius: '999px', fontWeight: 600, border: '1px dashed var(--border-color)', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
              backgroundColor: 'white', color: 'var(--text-secondary)',
            }}
          >
            ▼ 전체 평형
          </button>
        )}
      </div>

      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', width: '90%', maxWidth: '360px', maxHeight: '70vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>전체 평형 선택</h3>
              <button onClick={() => setIsOpen(false)} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>&times;</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                onClick={() => { onSelect('전체'); setIsOpen(false); }}
                style={{
                  padding: '0.75rem 1rem', borderRadius: '8px', textAlign: 'left', border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600,
                  backgroundColor: selectedArea === '전체' ? 'var(--primary-color)' : 'white',
                  color: selectedArea === '전체' ? 'white' : 'var(--text-primary)',
                }}
              >
                전체
              </button>
              {allAreas.map((area) => (
                <button
                  key={area}
                  onClick={() => { onSelect(area); setIsOpen(false); }}
                  style={{
                    padding: '0.75rem 1rem', borderRadius: '8px', textAlign: 'left', border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600,
                    backgroundColor: selectedArea === area ? 'var(--primary-color)' : 'white',
                    color: selectedArea === area ? 'white' : 'var(--text-primary)',
                  }}
                >
                  {renderAreaLabel(area)} <span style={{ fontWeight: 400, opacity: 0.7 }}>({countByArea.get(area)}건)</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음(아직 apt-client.tsx에서 사용하지 않으므로 이 파일 자체의 타입 오류만
없으면 됨)

- [ ] **Step 3: Commit**

```bash
git add src/components/AreaSelector.tsx
git commit -m "feat: 평형 선택 칩+드롭다운 AreaSelector 컴포넌트 추가"
```

---

## Task 3: 핵심 투자 지표(전세가율/갭 금액) 컴포넌트

**Files:**
- Create: `src/components/InvestmentMetrics.tsx`

**Interfaces:**
- Consumes: `GET /api/apt/[name]?lawdCd=...&type=apt|rent&period=6` (기존 라우트, 이미 존재 — 신규 API 없음)
- Produces: `<InvestmentMetrics aptName={string} lawdCd={string} />` — Task 5에서 사용.

- [ ] **Step 1: 작성**

```tsx
'use client';

import React, { useEffect, useState } from 'react';

interface InvestmentMetricsProps {
  aptName: string;
  lawdCd: string;
}

interface SimpleTrade {
  price: number;
  priceStr: string;
  area: string;
  tradeDate: string;
  tradeType: string;
}

// 기존 필터 토글(매매/전월세, 기간)과 무관하게 최근 6개월 매매+전월세를 병렬로 고정
// 조회해서 갭 금액/전세가율을 계산한다. KakaoPlaces와 같은 패턴으로 자기완결형이다.
export default function InvestmentMetrics({ aptName, lawdCd }: InvestmentMetricsProps) {
  const [saleTrades, setSaleTrades] = useState<SimpleTrade[] | null>(null);
  const [rentTrades, setRentTrades] = useState<SimpleTrade[] | null>(null);

  useEffect(() => {
    if (!aptName || !lawdCd) return;
    let cancelled = false;
    setSaleTrades(null);
    setRentTrades(null);

    const fetchType = async (type: 'apt' | 'rent'): Promise<SimpleTrade[]> => {
      try {
        const res = await fetch(`/api/apt/${encodeURIComponent(aptName)}?lawdCd=${lawdCd}&type=${type}&period=6`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.trades || [];
      } catch (e) {
        return [];
      }
    };

    Promise.all([fetchType('apt'), fetchType('rent')]).then(([sale, rent]) => {
      if (cancelled) return;
      setSaleTrades(sale);
      setRentTrades(rent);
    });

    return () => {
      cancelled = true;
    };
  }, [aptName, lawdCd]);

  const loading = saleTrades === null || rentTrades === null;

  const latestSale = saleTrades && saleTrades.length > 0
    ? [...saleTrades].sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime())[0]
    : null;

  const sortedRent = rentTrades ? [...rentTrades].sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime()) : [];
  const matchedRent = latestSale
    ? sortedRent.find((r) => r.area === latestSale.area) || (sortedRent.length > 0 ? sortedRent[0] : null)
    : null;

  const isSameArea = !!(latestSale && matchedRent && matchedRent.area === latestSale.area);
  const gap = latestSale && matchedRent ? latestSale.price - matchedRent.price : null;
  const jeonseRate = latestSale && matchedRent && latestSale.price > 0 ? (matchedRent.price / latestSale.price) * 100 : null;

  const cardStyle: React.CSSProperties = {
    flex: '1 1 160px',
    padding: '1rem',
    borderRadius: '12px',
    backgroundColor: '#f8fafc',
    border: '1px solid var(--border-color)',
  };

  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
      <div style={cardStyle}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>전세가율</div>
        {loading ? (
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-muted)' }}>조회 중...</div>
        ) : jeonseRate !== null ? (
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--primary-color)' }}>{jeonseRate.toFixed(1)}%</div>
        ) : (
          <div style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>최근 6개월 데이터 부족</div>
        )}
        {!loading && jeonseRate !== null && !isSameArea && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>* 동일 평형 매물이 없어 근접 평형 기준으로 계산</div>
        )}
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>갭 금액 (매매-전세)</div>
        {loading ? (
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-muted)' }}>조회 중...</div>
        ) : gap !== null ? (
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>{gap.toFixed(1)}억</div>
        ) : (
          <div style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>최근 6개월 데이터 부족</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/components/InvestmentMetrics.tsx
git commit -m "feat: 전세가율/갭 금액 핵심 투자지표 컴포넌트 추가"
```

---

## Task 4: 카카오톡 공유 버튼 컴포넌트

**Files:**
- Create: `src/components/KakaoShareButton.tsx`

**Interfaces:**
- Consumes: `absoluteUrl` from `@/config/site`
- Produces: `<KakaoShareButton title={string} description={string} />` — Task 5에서 사용.

- [ ] **Step 1: 작성**

```tsx
'use client';

import React, { useState } from 'react';
import { absoluteUrl } from '@/config/site';

interface KakaoShareButtonProps {
  title: string;
  description: string;
}

declare global {
  interface Window {
    Kakao: any;
  }
}

let kakaoShareSdkPromise: Promise<void> | null = null;

// 지도(Maps) SDK와는 별개인 카카오 JavaScript SDK(공유하기)를 필요할 때 한 번만 로드한다.
function loadKakaoShareSdk(): Promise<void> {
  if (kakaoShareSdkPromise) return kakaoShareSdkPromise;

  kakaoShareSdkPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('no window'));
      return;
    }
    if (window.Kakao) {
      resolve();
      return;
    }
    const scriptId = 'kakao-share-sdk-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://developers.kakao.com/sdk/js/kakao.js';
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('카카오 SDK 로드 실패')));
  });

  return kakaoShareSdkPromise;
}

// 카카오 디벨로퍼스 콘솔에서 "카카오톡 공유" 제품이 활성화돼 있지 않으면 Kakao.Share 호출이
// 실패할 수 있다 — 이 경우 URL을 클립보드에 복사하는 것으로 폴백해 완전히 막히지 않게 한다.
export default function KakaoShareButton({ title, description }: KakaoShareButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleShare = async () => {
    const url = window.location.href;
    const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

    try {
      if (!appKey) throw new Error('카카오 키 없음');
      await loadKakaoShareSdk();
      if (!window.Kakao.isInitialized()) {
        window.Kakao.init(appKey);
      }
      window.Kakao.Share.sendDefault({
        objectType: 'feed',
        content: {
          title,
          description,
          imageUrl: absoluteUrl('/og-image.png'),
          link: { mobileWebUrl: url, webUrl: url },
        },
        buttons: [
          { title: '자세히 보기', link: { mobileWebUrl: url, webUrl: url } },
        ],
      });
      setStatus('idle');
    } catch (e) {
      try {
        await navigator.clipboard.writeText(url);
        setStatus('copied');
        setTimeout(() => setStatus('idle'), 2000);
      } catch {
        setStatus('error');
        setTimeout(() => setStatus('idle'), 2000);
      }
    }
  };

  return (
    <button
      onClick={handleShare}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem',
        backgroundColor: '#FEE500', color: '#191919', border: 'none', borderRadius: '8px',
        fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer',
      }}
    >
      💬 {status === 'copied' ? '링크가 복사되었습니다' : status === 'error' ? '공유에 실패했습니다' : '카카오톡으로 공유하기'}
    </button>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/components/KakaoShareButton.tsx
git commit -m "feat: 카카오톡 공유 버튼 컴포넌트 추가 (클립보드 폴백 포함)"
```

---

## Task 5: apt-client.tsx 3구역 레이아웃으로 통합

**Files:**
- Modify: `src/app/apt/[name]/apt-client.tsx`
- Modify: `src/app/apt/[name]/detail.module.css`

**Interfaces:**
- Consumes: `buildAptBrief`(Task 1), `AreaSelector`(Task 2), `InvestmentMetrics`(Task 3), `KakaoShareButton`(Task 4)

- [ ] **Step 1: `detail.module.css`에 신규 클래스 추가**

파일 맨 끝에 추가:

```css
/* 3구역 레이아웃 개편: 섹션 간격, 브리핑 카드, 커뮤니티 CTA, 공유 버튼 줄 */
.sectionBlock {
  margin-top: 2rem;
}

.briefCard {
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
  margin-top: 1.5rem;
}

.briefTitle {
  font-weight: 700;
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.briefList {
  margin: 0;
  padding-left: 1.2rem;
  line-height: 1.8;
  color: var(--text-secondary);
}

.communityCard {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1.5rem;
  margin-top: 1.5rem;
}

.shareRow {
  display: flex;
  justify-content: center;
  margin-top: 1.5rem;
}

@media (max-width: 900px) {
  .sectionBlock {
    margin-top: 1.25rem;
  }
  .briefCard,
  .communityCard {
    padding: 1rem;
  }
  .communityCard {
    flex-direction: column;
    align-items: flex-start;
  }
}
```

- [ ] **Step 2: import 추가**

현재(9~11번째 줄):
```tsx
import KakaoMapEmbed from '@/components/KakaoMapEmbed';
import KakaoPlaces from '@/components/KakaoPlaces';
import { getAreaInfo } from '@/lib/area-utils';
```

다음으로 교체:
```tsx
import KakaoMapEmbed from '@/components/KakaoMapEmbed';
import KakaoPlaces from '@/components/KakaoPlaces';
import AreaSelector from '@/components/AreaSelector';
import InvestmentMetrics from '@/components/InvestmentMetrics';
import KakaoShareButton from '@/components/KakaoShareButton';
import { getAreaInfo } from '@/lib/area-utils';
import { buildAptBrief } from '@/lib/apt-brief';
```

- [ ] **Step 3: `return` 문 전체를 3구역 레이아웃으로 교체**

`renderModalContent` 함수 다음의 `return (` 부터 파일 끝(`);` + `}`)까지, 현재 전체
내용(약 330줄, 모달 오버레이 + 헤더 + `contentGrid`(차트 패널+타임라인 패널) + "단지 입지
분석" 4패널 + "전체 실거래 내역" 카드리스트)을 다음으로 전부 교체한다. 모달 렌더링
(`{activeModal && (...)}`)과 브레드크럼/제목/태그/차트 내부 로직(`AreaChart` 부분)은
기존과 동일하게 유지하고, ①평형 선택 버튼 목록을 제거해 `AreaSelector`로 이동, ②우측
"최근 실거래 타임라인" 패널을 제거하고 그 내용(가격 변동 배지, 신고가 배지)을 하단
카드리스트에 통합, ③핵심 투자지표·단지 브리핑·커뮤니티 카드·공유 버튼을 신규 추가,
④퀵버튼에서 학군/교통 제거(3구역 4패널과 중복)한다:

```tsx
  return (
    <div className={styles.main}>
      <Header />
      
      {/* 팝업(모달) */}
      {activeModal && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div 
            className={styles.modalContent} 
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: (activeModal === '지도' || activeModal === '로드뷰') ? '800px' : '500px' }}
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{activeModal}</h2>
              <button className={styles.closeButton} onClick={closeModal}>&times;</button>
            </div>
            <div className={styles.modalBody}>
              {renderModalContent()}
            </div>
          </div>
        </div>
      )}
      
      {/* ── 1구역: 단지 기본 스펙 + 시세 차트 + 핵심 투자 지표 ── */}
      <div className={styles.header}>
        <div className="container">
          <div className={styles.breadcrumb}>아파트실거래 &gt; {regionName ? regionName.split(' ').join(' > ') : ''} {(urlDong || (trades.length > 0 && trades[0].dong)) ? `> ${urlDong || trades[0].dong}` : ''} &gt; {aptName}</div>
          
          <div style={{ paddingBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
            <h1 className={styles.title} style={{ marginBottom: '0.75rem' }}>{aptName}</h1>
            <div className={styles.tags} style={{ marginBottom: 0 }}>
              <span className={styles.tag}>{aptInfo?.['세대수'] ? (aptInfo['세대수'].includes('세대') ? aptInfo['세대수'] : `${aptInfo['세대수']}세대`) : '세대수 정보 없음'}</span>
              <span className={styles.tag}>{(trades.length > 0 && trades[0].buildYear) ? `${trades[0].buildYear}년 준공` : (aptInfo?.['사용승인일'] ? `${aptInfo['사용승인일']} 준공` : '준공연도 모름')}</span>
              {aptInfo?.['총주차대수'] && (
                <span className={styles.tag}>{`총 주차 ${aptInfo['총주차대수']}`}</span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>최근 실거래가</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span className={styles.price}>{latestPrice}</span>
                {trades.length > 0 && (
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    ({getAreaInfo(parseFloat(trades[0].area)).label} • {trades[0].floor}층 • {trades[0].tradeDate})
                  </span>
                )}
              </div>
            </div>
            <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '2rem' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                {tradeTypeFilter === '전월세' ? '최고 보증금 / 최저 보증금' : '최고가 / 최저가'}
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                최고 {filteredTrades.length > 0 ? formatKoreanPrice((Math.max(...filteredTrades.map(t => t.price)) * 10000).toString()) : '-'} / 최저 {filteredTrades.length > 0 ? formatKoreanPrice((Math.min(...filteredTrades.map(t => t.price)) * 10000).toString()) : '-'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container">
        <div className={styles.panel}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
            <h2 className={styles.panelTitle} style={{ borderBottom: 'none', margin: 0, padding: 0, whiteSpace: 'nowrap' }}>실거래가 시세 차트</h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', background: 'var(--bg-color)', borderRadius: '4px', padding: '0.25rem' }}>
                <button onClick={() => setTradeTypeFilter('매매')} style={{ padding: '0.25rem 0.5rem', border: 'none', background: tradeTypeFilter === '매매' ? 'white' : 'transparent', fontWeight: tradeTypeFilter === '매매' ? 'bold' : 'normal', borderRadius: '4px', cursor: 'pointer', boxShadow: tradeTypeFilter === '매매' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>매매</button>
                <button onClick={() => setTradeTypeFilter('전월세')} style={{ padding: '0.25rem 0.5rem', border: 'none', background: tradeTypeFilter === '전월세' ? 'white' : 'transparent', fontWeight: tradeTypeFilter === '전월세' ? 'bold' : 'normal', borderRadius: '4px', cursor: 'pointer', boxShadow: tradeTypeFilter === '전월세' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>전월세</button>
              </div>
              <div style={{ display: 'flex', background: 'var(--bg-color)', borderRadius: '4px', padding: '0.25rem' }}>
                {['1년', '3년', '5년', '전체'].map(p => (
                  <button key={p} onClick={() => setPeriodFilter(p as any)} style={{ padding: '0.25rem 0.5rem', border: 'none', background: periodFilter === p ? 'white' : 'transparent', fontWeight: periodFilter === p ? 'bold' : 'normal', borderRadius: '4px', cursor: 'pointer', boxShadow: periodFilter === p ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>{p}</button>
                ))}
              </div>
            </div>
          </div>
          
          {loading ? (
            <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>데이터를 불러오는 중입니다...</div>
          ) : filteredTrades.length === 0 ? (
            <div style={{ height: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{apiError ? '⚠️' : '😢'}</div>
              <h3 style={{ fontSize: '1.2rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                {apiError ? '실거래가 데이터를 불러오지 못했습니다.' : '해당 기간/조건에 대한 거래 내역이 없습니다.'}
              </h3>
              {apiError && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{apiError}</p>}
            </div>
          ) : (
            <div style={{ width: '100%', height: 400 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary-color)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--primary-color)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                  <XAxis 
                    dataKey="id" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: 'var(--text-secondary)'}}
                    tickFormatter={(id) => chartData[id]?.date.substring(2, 7) || ''}
                  />
                  <YAxis 
                    domain={['dataMin - (dataMin * 0.1)', 'dataMax + (dataMax * 0.1)']} 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: 'var(--text-secondary)'}} 
                    tickFormatter={(val) => val >= 1 ? `${val}억` : `${Math.round(val * 10000)}만`} 
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: 'var(--shadow-md)', padding: '12px' }}
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div style={{ backgroundColor: 'white', padding: '12px', border: '1px solid #eee', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                            <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: '#666' }}>{data.date.replace(/-/g, '.')} / {data.floor}층</p>
                            <p style={{ margin: 0, fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--primary-color)' }}>{data.priceStr} <span style={{fontSize: '0.8rem', color: '#ef4444'}}>{data.tradeType === '신고가' ? '(신고가)' : ''}</span></p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="price" 
                    name="거래가"
                    stroke="var(--primary-color)" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorPrice)" 
                    activeDot={{ r: 8, fill: 'var(--primary-color)', stroke: 'white', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <InvestmentMetrics aptName={aptName} lawdCd={lawdCdState} />

          <div className={styles.quickButtons} style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)', justifyContent: 'center' }}>
            <button className={styles.quickBtn} onClick={() => openModal('지도')}>지도</button>
            <button className={styles.quickBtn} onClick={() => openModal('로드뷰')}>로드뷰</button>
            <button className={styles.quickBtn} onClick={() => openModal('단지정보')}>단지정보</button>
            <button className={styles.quickBtn} onClick={() => openModal('대출한도')}>대출한도</button>
            <button 
              className={styles.quickBtn} 
              style={{ backgroundColor: '#3b82f6', color: 'white', border: 'none', fontWeight: 'bold' }}
              onClick={() => openModal('건축물대장')}
            >
              📑 건축물대장 다운로드
            </button>
          </div>
        </div>
      </div>

      {/* ── 2구역: 평형 선택 + 평형별 실거래 내역 + 단지 브리핑 ── */}
      <div className={`container ${styles.sectionBlock}`}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>평형별 실거래 내역</h2>
        <div className={styles.panel}>
          <AreaSelector trades={trades} selectedArea={selectedArea} onSelect={setSelectedArea} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1.5rem 0 1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{selectedArea === '전체' ? '전체 평형' : getAreaInfo(parseFloat(selectedArea)).label} · 총 {filteredTrades.length}건</span>
            <select 
              value={onlySales ? 'sales' : 'all'} 
              onChange={(e) => setOnlySales(e.target.value === 'sales')}
              style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}
            >
              <option value="all">전체 보기</option>
              <option value="sales" disabled={tradeTypeFilter === '전월세'}>{tradeTypeFilter === '전월세' ? '전월세만 보기' : '매매만 보기'}</option>
            </select>
          </div>

          {filteredTrades.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              {apiError ? `실거래가 데이터를 불러오지 못했습니다. (${apiError})` : '거래 내역이 없습니다.'}
            </div>
          ) : (
            <>
              {filteredTrades.slice(0, visibleCount).map((t, index) => {
                const areaInfo = getAreaInfo(parseFloat(t.area));
                const isSale = t.tradeType.includes('매매') || t.tradeType === '실거래';
                const prevTrade = filteredTrades[index + 1];
                let diffBadge = null;
                if (prevTrade && t.tradeType.includes('매매')) {
                  const diff = t.price - prevTrade.price;
                  if (diff > 0) diffBadge = <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '12px', background: '#fee2e2', color: '#ef4444', fontWeight: 'bold' }}>▲ {diff}억</span>;
                  else if (diff < 0) diffBadge = <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '12px', background: '#e0e7ff', color: '#3b82f6', fontWeight: 'bold' }}>▼ {Math.abs(diff)}억</span>;
                }
                if (t.tradeType === '신고가') diffBadge = <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '12px', background: '#fee2e2', color: '#ef4444', fontWeight: 'bold' }}>신고가</span>;

                return (
                  <div key={`card-${t.id}`} style={{ padding: '1rem', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                      <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem', backgroundColor: isSale ? '#e0e7ff' : '#dcfce3', color: isSale ? '#3b82f6' : '#10b981' }}>
                        {t.tradeType.replace('아파트 ', '')}
                      </span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t.tradeDate}</span>
                      {diffBadge}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      {areaInfo.label} · <b>{t.priceStr}</b> · {t.floor}층
                    </div>
                  </div>
                );
              })}
              {filteredTrades.length > visibleCount && (
                <div style={{ padding: '1rem', textAlign: 'center' }}>
                  <button
                    onClick={() => setVisibleCount((v) => v + 15)}
                    style={{ padding: '0.6rem 1.5rem', borderRadius: '999px', border: '1px solid var(--border-color)', background: 'white', fontWeight: 600, cursor: 'pointer' }}
                  >
                    더보기 ({filteredTrades.length - visibleCount}건 더 있음)
                  </button>
                </div>
              )}
            </>
          )}

          <div className={styles.briefCard}>
            <div className={styles.briefTitle}>💡 단지 브리핑</div>
            <ul className={styles.briefList}>
              {buildAptBrief({
                trades: filteredTrades,
                tradeTypeFilter,
                totalHouseholds: aptInfo?.['세대수'] ?? null,
                buildYear: trades.length > 0 && trades[0].buildYear ? parseInt(trades[0].buildYear, 10) : null,
              }).map((sentence, i) => (
                <li key={i}>{sentence}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ── 3구역: 학군/입지 정보 + 커뮤니티 + 공유 ── */}
      <div className={`container ${styles.sectionBlock}`}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>단지 입지 분석</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          <div className={styles.panel} style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🎓 학군 정보</h3>
            {!loading && primaryAddress ? (
              <KakaoPlaces address={primaryAddress} categories={['SC4']} limit={2} />
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>단지 위치 확인 후 표시됩니다.</p>
            )}
          </div>
          <div className={styles.panel} style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🚇 교통 정보</h3>
            {!loading && primaryAddress ? (
              <KakaoPlaces address={primaryAddress} categories={['SW8']} limit={2} />
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>단지 위치 확인 후 표시됩니다.</p>
            )}
          </div>
          <div className={styles.panel} style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🏥 편의 시설</h3>
            {!loading && primaryAddress ? (
              <KakaoPlaces address={primaryAddress} categories={['HP8', 'MT1']} limit={3} />
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>단지 위치 확인 후 표시됩니다.</p>
            )}
          </div>
          <div className={styles.panel} style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🏢 단지 상세</h3>
            {(aptInfo?.['용적률'] || aptInfo?.['건폐율']) ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                • 용적률: {aptInfo?.['용적률'] || '정보 없음'} / 건폐율: {aptInfo?.['건폐율'] || '정보 없음'}
              </p>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>용적률/건폐율 정보 없음</p>
            )}
            {aptInfo?.['주용도'] && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>• 주용도: {aptInfo['주용도']}</p>
            )}
          </div>
        </div>

        <div className={styles.communityCard}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>💬 {aptName} 실거주민 이야기가 궁금하다면?</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>커뮤니티에서 이 단지에 대한 이야기를 나눠보세요.</div>
          </div>
          <Link href={`/community?aptName=${encodeURIComponent(aptName)}`} className={styles.quickBtn} style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
            커뮤니티 가기 &gt;
          </Link>
        </div>

        <div className={styles.shareRow}>
          <KakaoShareButton
            title={`${aptName} 실거래가`}
            description={`최근 실거래가 ${latestPrice} · ${(regionName || '').trim()} ${aptName}`.trim()}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 5: 수동 스모크 테스트**

Run: `npm run dev` → 실거래가 풍부한 단지의 상세페이지 접속 →
1. 1구역: 태그/최근실거래가/차트/투자지표(전세가율·갭)/퀵버튼(학군·교통 없음, 5개만)이
   순서대로 보이는지
2. 2구역: 평형 칩 3~4개 + "▼ 전체 평형" 버튼, 클릭 시 레이어로 전체 평형 선택 가능한지,
   평형 선택 시 1구역 차트와 2구역 목록이 함께 바뀌는지, 목록에 가격변동/신고가 배지가
   보이는지, 더보기 동작, 단지 브리핑 문장이 자연스럽게 나오는지
3. 3구역: 4패널 학군/교통/편의시설/단지상세, 커뮤니티 카드+버튼, 카카오톡 공유 버튼(클릭
   시 카카오 공유창 또는 "링크가 복사되었습니다" 폴백 중 하나가 동작하는지)
거래가 거의 없는 단지로도 접속해 투자지표/브리핑이 "데이터 부족" 문구로 안전하게
표시되는지 확인. dev 서버 종료.

- [ ] **Step 6: Commit**

```bash
git add "src/app/apt/[name]/apt-client.tsx" "src/app/apt/[name]/detail.module.css"
git commit -m "feat: 단지 상세페이지를 3구역 레이아웃으로 재구성, 실거래 내역 중복 패널 통합"
```

---

## Task 6: 모바일 반응형 검증 및 조정

**Files:**
- Modify (필요 시): `src/app/apt/[name]/detail.module.css`

- [ ] **Step 1: 라이브 브라우저로 모바일 폭(375~430px) 확인**

Run: `npm run dev` → 브라우저 개발자도구 모바일 에뮬레이션(또는 실제 창 크기 조절 —
이전 세션에서 `resize_window` 툴이 이 환경에서 뷰포트를 실제로 좁히지 못하는 한계가
있었으므로, 개발자도구 자체 기기 툴바를 사용하거나 실제 모바일 기기/에뮬레이터로 확인)으로
375px~430px 폭에서 단지 상세페이지 전체를 스크롤하며 확인:
- 평형 칩이 가로 스크롤로 잘리지 않고 자연스럽게 넘어가는지
- 투자지표 카드 2개가 좁은 화면에서 세로로 쌓이는지(현재 `flexWrap:'wrap'`로 이미
  대응됨 — 실제로 깨지지 않는지만 확인)
- 단지 브리핑/커뮤니티 카드의 패딩이 과도하지 않은지, 텍스트가 화면 밖으로 넘치지 않고
  깔끔하게 줄바꿈되는지
- 커뮤니티 카드가 모바일에서 세로 스택(위 문구, 아래 버튼)으로 보이는지(Step 1에서 이미
  미디어쿼리로 처리됨)
- 카카오톡 공유 버튼이 잘리지 않는지

- [ ] **Step 2: 문제 발견 시 `detail.module.css`의 `@media (max-width: 900px)` 블록(Task
  5에서 추가한 `.sectionBlock`/`.briefCard`/`.communityCard` 규칙)에 필요한 값만 조정**

발견된 구체적 문제에 따라 패딩/폰트 크기/gap 값을 조정한다(문제가 없다면 이 스텝은
건너뛴다).

- [ ] **Step 3: 빌드 확인 (CSS를 수정했다면)**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 4: Commit (수정 사항이 있는 경우에만)**

```bash
git add "src/app/apt/[name]/detail.module.css"
git commit -m "fix: 단지 상세페이지 모바일 반응형 미세 조정"
```

(수정할 내용이 없었다면 커밋 없이 다음 태스크로 진행한다.)

---

## Task 7: 최종 클린 빌드 및 통합 확인

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 클린 빌드**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: 통합 수동 확인**

Run: `npm run dev` → 서로 다른 단지 2~3곳(거래 활발/거래 드묾/신축/구축 섞어서)으로 전체
플로우를 한 번씩 확인: 평형 선택 → 차트/목록 연동 → 투자지표 → 브리핑 → 커뮤니티 링크 →
카카오톡 공유. 기존 기능(지도/로드뷰/단지정보/대출한도/건축물대장 모달)도 회귀 없이
동작하는지 확인.

- [ ] **Step 4: git 상태 확인**

Run: `git status`
Expected: 커밋되지 않은 변경 없음.

(이번 작업은 아직 push하지 않는다. 이어서 진행할 B(커뮤니티 단지 태그 연동)까지 마친 뒤
사용자가 지정하는 시점에 push한다.)
