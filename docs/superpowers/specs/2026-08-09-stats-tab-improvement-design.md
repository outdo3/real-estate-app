# 시장통계 탭 개선 — 설계 문서

날짜: 2026-08-09

## 배경

"프로젝트 명칭 변경 및 UX/성능 최적화 종합 작업" 요청의 4번째 하위 프로젝트. 대상 파일은
`src/app/stats/stats-client.tsx` / `src/app/stats/page.module.css`. 요구사항 4가지:

1. 모바일에서 "거래량 추이"(거래량 분석 탭) 헤더가 한 줄 레이아웃으로 보이도록
2. 뷰 전환 버튼 텍스트를 "그래프\n보기"/"표로\n보기"(줄바꿈)로 변경
3. 탭 진입 시 기본값을 '표로 보기'로 변경 (현재 `chartView` 기본값은 `'graph'`)
4. 단지 랭킹 정렬 기준을 UI에 명시

## 진단

- **모바일 헤더**: `.panelHeader`(제목 + 뷰 토글을 담는 flex row)에 모바일 전용 스타일이 전혀
  없다. 좁은 화면에서 "📊 거래량·시세 추이" 제목과 "📊 그래프 보기"/"📋 표로 보기" 버튼 2개가
  한 줄에 들어가기엔 텍스트가 길어 눌리거나 버튼 안에서 텍스트가 어색하게 깨진다.
- **탭 기본값**: `stats-client.tsx:70`의 `useState<'graph'|'table'>('graph')`. 기본값을
  `'table'`로 바꾸면, 이전엔 "표로 보기" 클릭 시에만 나가던 `/api/stats/yearly` 요청이
  페이지 진입 즉시 나간다. 2번 하위 프로젝트(초기 로딩 성능 최적화)에서 이 엔드포인트에
  캐시(TTL)와 공유 동시성 제한을 이미 적용해뒀고, 로딩 중에는 기존 스켈레톤 UI가 그대로
  뜨므로 안전하다는 점을 사용자에게 확인받았다.
- **정렬 기준 미명시**: "🏆 {지역} 평당가 랭킹" 패널의 부제가 "최근 1년 평균"뿐이라 정렬
  기준(평당가 높은순)이 명시적이지 않다. "🔥 최근 핫이슈 거래" 패널은 "최근 3개월 최고가
  TOP 5"로 이미 기준이 드러나 있지만, 사용자가 두 패널 모두 "정렬 기준: ..." 형태로 통일하는
  쪽을 선택했다.

## 결정 사항 (사용자 확인 완료)

1. `chartView` 기본값을 `'table'`로 바로 변경 — 별도의 지연 로딩/단계적 전환 없이 요청대로
   진행(로딩 중 스켈레톤 UI로 충분히 커버됨).
2. 정렬 기준 표기는 기존 부제 문구를 "정렬 기준: ..." 형태로 명확화하는 방식, 핫이슈/평당가
   랭킹 패널 둘 다 적용.

## 설계

### A. 탭 기본값 변경 — `stats-client.tsx`

`const [chartView, setChartView] = useState<'graph' | 'table'>('graph');`
→ `useState<'graph' | 'table'>('table')`로 한 줄 변경.

### B. 모바일 헤더 한 줄 레이아웃 + 버튼 텍스트 줄바꿈

`page.module.css`에 기존 `@media (max-width: 768px)` 블록(55~191행 부근)에 다음 규칙 추가:

```css
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
```

- `.panelHeader`는 이미 `display:flex; justify-content:space-between;`이고 기본
  `flex-wrap:nowrap`이므로, 제목이 `overflow:hidden`+`ellipsis`로 줄어들 수 있게 하고 토글
  그룹은 `flex-shrink:0`으로 고정하면 한 줄을 벗어나지 않는다.
- 이 규칙은 `.panelHeader`/`.panelTitle`을 공유하는 다른 탭(갭투자/단지랭킹/입주)에도
  똑같이 적용되지만, 그 패널들은 부제 span이 `.viewToggle`처럼 폭이 크지 않고
  `.rankingGrid`가 모바일에서 이미 1열로 전환되어 패널이 화면 전체 폭을 쓰므로 실질적인
  영향(제목이 눌려서 잘리는 정도)은 미미하다.

`stats-client.tsx`의 버튼 텍스트를 실제 줄바꿈 문자를 포함한 문자열로 변경:

```tsx
📊 그래프 보기   →   {'📊 그래프\n보기'}
📋 표로 보기    →   {'📋 표로\n보기'}
```

데스크톱(기본 `white-space: normal`)에서는 `\n`이 공백으로 합쳐져 기존과 동일하게 한 줄로
보이고, 모바일(`white-space: pre-line`)에서만 실제 줄바꿈으로 렌더링되어 버튼 폭이 줄어드는
방식 — 별도의 JS 반응형 분기 없이 CSS만으로 두 화면 모두 처리한다.

### C. 단지 랭킹 정렬 기준 명시 — `stats-client.tsx`

- 평당가 랭킹 패널 부제: `최근 1년 평균` → `정렬 기준: 평당가 높은순 (최근 1년 평균)`
- 핫이슈 거래 패널 부제: `최근 3개월 최고가 TOP 5` → `정렬 기준: 거래가 높은순 (최근 3개월)`

## 검증 계획

- `npm run build` 클린 빌드
- 모바일 폭(768px 이하)에서 거래량 분석 탭 헤더(제목+토글)가 한 줄에 들어가는지, 버튼
  텍스트가 2줄로 나뉘어 보이는지 확인
- 데스크톱 폭에서 버튼 텍스트가 기존처럼 한 줄로 보이는지(회귀 없음) 확인
- `/stats` 첫 진입 시 "표로 보기"가 기본으로 뜨고, 연도별 표 스켈레톤 → 실데이터 전환이
  정상 동작하는지 확인 ("그래프 보기"로 수동 전환도 여전히 되는지 함께 확인)
- 단지 랭킹 탭의 두 패널 부제가 "정렬 기준: ..."으로 바뀌었는지 확인
