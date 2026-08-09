# 시장통계 탭 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/app/stats/stats-client.tsx` / `src/app/stats/page.module.css`의 시장통계 탭에서
4가지를 고친다: 모바일 "거래량 추이" 헤더 한 줄 레이아웃, 뷰 전환 버튼 텍스트 줄바꿈, 탭
기본값을 '표로 보기'로 전환, 단지 랭킹 정렬 기준 UI 명시.

**Architecture:** 모두 `stats-client.tsx`(JSX 텍스트/기본값)와 `page.module.css`(모바일 미디어
쿼리) 두 파일 내의 국소적인 수정이며, 새 컴포넌트나 API 변경은 없다. CSS만으로 데스크톱/모바일
분기를 처리해 별도의 JS 반응형 로직을 추가하지 않는다(버튼 텍스트에 실제 줄바꿈 문자를 넣고,
`white-space` 속성을 데스크톱은 기본값(`normal`, 줄바꿈 무시)·모바일은 `pre-line`(줄바꿈 적용)
으로 다르게 줘서 동일한 JSX 문자열이 화면 폭에 따라 다르게 렌더링되게 한다).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules. 테스트 프레임워크
없음 — `npm run build` + 로컬 브라우저(데스크톱/모바일 폭) 수동 확인이 검증 기준.

## Global Constraints

- 새 API 호출이나 데이터 로직 변경은 없다 — 이번 작업은 순수 UI 문구/레이아웃/기본값 변경이다.
- `chartView` 기본값을 `'table'`로 바꾸는 것 외에, 연도별 통계 데이터 로딩 방식(SWR 조건부
  키, 스켈레톤 UI) 자체는 건드리지 않는다 — 이미 안전하다고 확인됨.
- 모바일 전용 CSS는 기존에 이미 쓰이고 있는 `@media (max-width: 768px)` 브레이크포인트를
  그대로 사용한다(새 브레이크포인트를 도입하지 않는다).
- `npm run build` 클린 통과가 각 태스크의 필수 검증 기준이다.
- 별도 브랜치/워크트리 없이 `main`에서 바로 작업한다. 각 태스크 완료 시 로컬 커밋만 하고
  push는 하지 않는다.

---

## Task 1: 탭 진입 기본값을 '표로 보기'로 변경

**Files:**
- Modify: `src/app/stats/stats-client.tsx`

- [ ] **Step 1: `chartView` 초기값 변경**

현재(70번째 줄 부근):
```tsx
  const [chartView, setChartView] = useState<'graph' | 'table'>('graph');
```

다음으로 교체:
```tsx
  const [chartView, setChartView] = useState<'graph' | 'table'>('table');
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 3: 수동 스모크 테스트**

Run: `npm run dev` → `/stats` 접속 → "📊 거래량 분석" 탭이 기본으로 열려 있을 때 "📋 표로
보기"가 활성 상태로 보이는지 확인(연도별 통계표가 스켈레톤 → 실데이터로 전환되는지도 확인).
"📊 그래프 보기" 버튼을 눌러 정상적으로 그래프로 전환되는지도 확인. dev 서버 종료.

- [ ] **Step 4: Commit**

```bash
git add src/app/stats/stats-client.tsx
git commit -m "feat: 시장통계 거래량 분석 탭 진입 시 기본값을 표로 보기로 변경"
```

---

## Task 2: 단지 랭킹 정렬 기준 UI 명시

**Files:**
- Modify: `src/app/stats/stats-client.tsx`

- [ ] **Step 1: 핫이슈 거래 패널 부제 변경**

현재:
```tsx
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>🔥 최근 핫이슈 거래</h2>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>최근 3개월 최고가 TOP 5</span>
                </div>
```

다음으로 교체:
```tsx
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>🔥 최근 핫이슈 거래</h2>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>정렬 기준: 거래가 높은순 (최근 3개월)</span>
                </div>
```

- [ ] **Step 2: 평당가 랭킹 패널 부제 변경**

현재:
```tsx
                  <div className={styles.panelHeader}>
                    <h2 className={styles.panelTitle}>🏆 {region.sigungu} 평당가 랭킹</h2>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>최근 1년 평균</span>
                  </div>
```

다음으로 교체:
```tsx
                  <div className={styles.panelHeader}>
                    <h2 className={styles.panelTitle}>🏆 {region.sigungu} 평당가 랭킹</h2>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>정렬 기준: 평당가 높은순 (최근 1년 평균)</span>
                  </div>
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 4: 수동 스모크 테스트**

Run: `npm run dev` → `/stats` 접속 → "🏆 단지 랭킹" 탭 클릭 → 두 패널(핫이슈 거래/평당가
랭킹) 부제가 각각 "정렬 기준: 거래가 높은순 (최근 3개월)" / "정렬 기준: 평당가 높은순 (최근
1년 평균)"으로 보이는지 확인. dev 서버 종료.

- [ ] **Step 5: Commit**

```bash
git add src/app/stats/stats-client.tsx
git commit -m "feat: 단지 랭킹 패널에 정렬 기준 문구 명시"
```

---

## Task 3: 모바일 헤더 한 줄 레이아웃 + 뷰 전환 버튼 텍스트 줄바꿈

**Files:**
- Modify: `src/app/stats/page.module.css`
- Modify: `src/app/stats/stats-client.tsx`

- [ ] **Step 1: 모바일 미디어 쿼리 규칙 추가**

`page.module.css`에서 현재(`.viewToggleActive` 규칙 바로 다음, `/* 연도별 통계표 */` 주석
바로 앞):
```css
.viewToggleActive {
  background: var(--primary-color);
  color: white;
}

/* 연도별 통계표 */
```

다음으로 교체:
```css
.viewToggleActive {
  background: var(--primary-color);
  color: white;
}

/* 모바일에서 패널 헤더(제목+뷰 토글)가 한 줄을 벗어나지 않도록: 제목은 말줄임표로
   줄어들고, 토글 버튼 그룹은 줄어들지 않는다. 버튼 텍스트 자체에 실제 줄바꿈 문자가
   들어있는 경우(stats-client.tsx) white-space:pre-line으로 그 줄바꿈을 살려 버튼 폭을
   줄인다 — 데스크톱은 기본 white-space(줄바꿈 무시)라 영향받지 않는다. */
@media (max-width: 768px) {
  .panelHeader {
    gap: 0.5rem;
  }

  .panelTitle {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1rem;
  }

  .viewToggle {
    flex-shrink: 0;
  }

  .viewToggleBtn {
    padding: 0.4rem 0.6rem;
    font-size: 0.72rem;
    white-space: pre-line;
    line-height: 1.25;
    text-align: center;
  }
}

/* 연도별 통계표 */
```

- [ ] **Step 2: 뷰 전환 버튼 텍스트에 줄바꿈 추가**

`stats-client.tsx`에서 현재:
```tsx
                    <button
                      className={`${styles.viewToggleBtn} ${chartView === 'graph' ? styles.viewToggleActive : ''}`}
                      onClick={() => setChartView('graph')}
                    >
                      📊 그래프 보기
                    </button>
                    <button
                      className={`${styles.viewToggleBtn} ${chartView === 'table' ? styles.viewToggleActive : ''}`}
                      onClick={() => setChartView('table')}
                    >
                      📋 표로 보기
                    </button>
```

다음으로 교체:
```tsx
                    <button
                      className={`${styles.viewToggleBtn} ${chartView === 'graph' ? styles.viewToggleActive : ''}`}
                      onClick={() => setChartView('graph')}
                    >
                      {'📊 그래프\n보기'}
                    </button>
                    <button
                      className={`${styles.viewToggleBtn} ${chartView === 'table' ? styles.viewToggleActive : ''}`}
                      onClick={() => setChartView('table')}
                    >
                      {'📋 표로\n보기'}
                    </button>
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 4: 수동 스모크 테스트**

Run: `npm run dev` →
1. 브라우저 창을 768px 이하 폭으로 좁혀(또는 개발자도구 모바일 에뮬레이션) `/stats` 접속 →
   "📊 거래량 분석" 탭의 헤더(제목 + 그래프 보기/표로 보기 버튼)가 한 줄에 다 들어가는지,
   버튼 안의 텍스트가 "그래프"/"보기" 2줄로 나뉘어 보이는지 확인.
2. 창을 768px 초과 폭(데스크톱)으로 넓혀 같은 페이지를 다시 확인 → 버튼 텍스트가 기존처럼
   "그래프 보기"/"표로 보기" 한 줄로 보이는지(줄바꿈이 공백으로 합쳐짐, 회귀 없음) 확인.
dev 서버 종료.

- [ ] **Step 5: Commit**

```bash
git add src/app/stats/page.module.css src/app/stats/stats-client.tsx
git commit -m "fix: 모바일에서 거래량 분석 탭 헤더 한 줄 레이아웃 + 뷰 전환 버튼 텍스트 줄바꿈"
```

---

## Task 4: 최종 클린 빌드 및 통합 확인

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 클린 빌드**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: 통합 수동 확인**

Run: `npm run dev` → `/stats` 접속 → 4개 항목을 한 번에 순서대로 확인:
1. 페이지 진입 시 "거래량 분석" 탭이 "표로 보기" 기본값으로 뜨는지
2. 모바일 폭에서 헤더가 한 줄에 들어가고 버튼 텍스트가 2줄로 보이는지, 데스크톱 폭에서는
   기존처럼 한 줄로 보이는지
3. "단지 랭킹" 탭의 두 패널에 "정렬 기준: ..." 문구가 보이는지
4. 다른 탭(갭투자 분석/입주·전세가율)과 다른 지역 선택으로도 회귀가 없는지 가볍게 확인

- [ ] **Step 4: git 상태 확인**

Run: `git status`
Expected: 커밋되지 않은 변경 없음.

(이번 작업은 아직 push하지 않는다 — 남은 하위 프로젝트와 함께 사용자가 지정하는 시점에
push한다.)
