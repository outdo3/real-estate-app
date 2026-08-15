# STEP 35 — APT DETAIL B2-2: 시세차트 매매/전세 색상 분리

상태: 구현 완료 / 모바일 검수중(commit/push 없음)

성격: 시각(색상) 변경 전용. 데이터/집계/API/DB/schema 변경 없음. 기준 commit
`c9919f36ec1cd02b0c4b1e450868144daf9fe6d4`(origin/main과 동일 — §0 확인).

---

## 0. 작업 시작 전 확인

```
git status --short        → M docs/development/CHANGELOG.md (기존, 문서33 관련)
                             ?? docs/development/33-...md (기존)
                             ?? docs/development/34-...md (기존)
git rev-parse HEAD         → c9919f36ec1cd02b0c4b1e450868144daf9fe6d4
git fetch origin           → (no new refs)
git rev-parse origin/main  → c9919f36ec1cd02b0c4b1e450868144daf9fe6d4
git rev-list --left-right --count origin/main...HEAD → 0  0
```

예상대로 문서33/34 관련 미커밋 변경만 존재, 그 외 production 변경 없음 확인 —
STOP 조건 미발생, 진행.

## 1. 문제

사용자 모바일 피드백: 시세차트에서 매매/전세 선이 둘 다 초록 계열이라 겹칠 때
구분이 어려움.

## 2. PriceTrendChart 코드 재확인 (`src/components/PriceTrendChart.tsx`, 변경 전)

| 항목 | 값 | 비고 |
|---|---|---|
| 매매 line color | `stroke="var(--primary-color)"` (151행) | CSS 변수 사용 |
| 전세 line color | `stroke="#10b981"` (152행) | **하드코딩 hex**, 매매와 같은 초록 계열 |
| legend marker color | 별도 지정 없음 — `<Legend formatter={...} />`(150행)만 존재, custom payload 없음 | recharts 기본 동작상 각 `<Line>`의 `stroke`를 그대로 범례 스와치 색으로 사용 |
| tooltip color | custom `content` 함수(137-149행) 안에서 매매는 `'var(--primary-color)'`(144행), 전세는 `'#10b981'`(145행) **직접 지정** | tooltip은 recharts 기본 tooltip이 아니라 직접 그리는 커스텀 컴포넌트 |
| active dot | 별도 `activeDot` prop 없음 | recharts 기본값 사용 → 해당 `<Line>`의 `stroke`를 그대로 따름 |
| stroke width | 둘 다 `strokeWidth={2.5}` | 변경 없음(유지) |
| fill | 사용 안 함(LineChart, AreaChart 아님) | 해당 없음 |
| hover state | 별도 hover 스타일 없음, recharts 기본 active dot에 의존 | 위 active dot과 동일 결론 |
| dot(정적) | 둘 다 `dot={false}` | 평소엔 점 없음, hover 시에만 active dot |

**추측 없이 확인한 결론**: 색상을 결정하는 지점은 코드상 정확히 2곳뿐 —
① `<Line stroke=...>` (line/legend/active-dot/hover가 모두 이 값 하나에서 파생),
② tooltip 커스텀 `content` 안의 `color` 인라인 스타일. 이 2곳만 바꾸면 요청된
"line/dot/legend/tooltip 전체 일관성"이 자동으로 달성되는 구조임을 코드로 확인.

## 3. 최종 색상 정책

| 시리즈 | 이전 | 최종 | 방식 |
|---|---|---|---|
| 매매 | `var(--primary-color)`(#03c75a) | **변경 없음** | CSS 변수 유지 |
| 전세 | `#10b981`(하드코딩) | **`#3152d6`**(하드코딩 hex) | §4 사유로 `var(--down-color)` 대신 같은 hex 값을 직접 사용 |

새 color token은 만들지 않았다. `globals.css`에 새 변수 추가 없음.

## 4. 의미 혼동 검토 — `--down-color` 재사용 여부

`src/app/globals.css` 19행: `--down-color: #3152d6; /* 파란색 (하락색) */` — 변수
이름과 주석 모두 "하락"이라는 명시적 의미를 담고 있다. 실사용처 확인:

```
src/app/ai-search/ai-search-client.tsx:299
  style={{ color: stats.volumeChange >= 0 ? 'var(--up-color)' : 'var(--down-color)' }}
```

이 앱 안에 이미 "파랑 = 하락(거래량 감소 등)"이라는 실제 등락 의미로 `--down-color`
변수가 쓰이는 화면이 존재한다. 다만:

- 사용 위치가 `/ai-search`(AI 검색 결과 통계 카드)로, 이번에 바꾸는 `/apt/[name]`
  상세페이지 차트와는 **다른 화면·다른 문맥**이다.
- 차트에는 매매(초록)/전세(파랑) 선 옆에 legend·tooltip 텍스트가 항상 "매매"/"전세"로
  명시되어 있어, 이 파랑을 "가격 하락"으로 오인할 여지가 사실상 없다(등락 방향을
  나타내는 화살표/기호가 전혀 없음).
- 따라서 "단순히 기존 파란 팔레트로 쓰이는 정도"(요청서 STOP 조건의 예외 조항)에
  해당한다고 판단 — **STOP하지 않고 진행**. 다만 변수 이름 자체가 다른 화면에서
  진짜 등락 의미로 쓰이고 있으므로, `var(--down-color)`를 그대로 끌어다 쓰면 향후
  "왜 상세페이지 파랑이 --down-color를 쓰지?"라는 오해나, `--down-color`의 값이
  나중에 바뀔 때 의도치 않게 차트 색까지 같이 바뀌는 결합을 만들 수 있어 **CSS 변수
  대신 같은 hex 값을 직접 하드코딩**했다(요청서 §4의 "차트 라이브러리가 inline hex만
  허용한다면" 조항과는 다른 이유지만 같은 결과 — 이 조건은 라이브러리 제약이
  아니라 **의미 결합을 피하기 위한 선택**임을 명확히 기록).

## 5. 변경 내역 (`src/components/PriceTrendChart.tsx`)

```diff
-                      {data.rentStr && <p style={{ margin: 0, fontWeight: 700, color: '#10b981' }}>전세 {data.rentStr}</p>}
+                      {/* #3152d6은 globals.css의 --down-color와 같은 파랑이지만, 그 변수 자체는
+                          "가격 하락"(등락) 의미로 다른 화면(ai-search 통계)에서 쓰이고 있어 여기서는
+                          변수명 대신 같은 hex를 직접 써서 "전세 시리즈 색" 의미로만 한정한다. */}
+                      {data.rentStr && <p style={{ margin: 0, fontWeight: 700, color: '#3152d6' }}>전세 {data.rentStr}</p>}
```

```diff
               <Line type="monotone" dataKey="salePrice" name="salePrice" stroke="var(--primary-color)" strokeWidth={2.5} dot={false} connectNulls />
-              <Line type="monotone" dataKey="rentPrice" name="rentPrice" stroke="#10b981" strokeWidth={2.5} dot={false} connectNulls />
+              {/* 매매(초록)와 구분되도록 --down-color와 동일한 파랑 계열 사용(위 tooltip 주석 참고) */}
+              <Line type="monotone" dataKey="rentPrice" name="rentPrice" stroke="#3152d6" strokeWidth={2.5} dot={false} connectNulls />
```

grid(`CartesianGrid`)·axis(`XAxis`/`YAxis`)·tick·font·spacing·chart height(320)는
전혀 건드리지 않았다. `dot={false}`도 그대로 유지 — 정적 점 표시 여부 자체를
바꾸지 않았고, hover 시 나타나는 active dot 색만 위 `stroke` 변경에 따라 자동으로
파랑으로 바뀐다.

## 6. Legend/tooltip 결과

- **legend**: `<Legend formatter={(value) => (value === 'salePrice' ? '매매' : '전세')} />` —
  텍스트 포맷터만 있고 커스텀 아이콘/payload 없음. recharts가 각 `<Line>`의
  `stroke`를 그대로 스와치 색으로 사용하는 기본 동작이라, 코드 수정 없이 스와치가
  자동으로 파랑/초록으로 갈렸다(§10에서 스크린샷으로 확인). 순서("전세 매매")는
  변경하지 않음 — DOM 순서(salePrice Line이 먼저 선언됨에도 실제 렌더된 legend는
  "전세 매매" 순서로, 이는 기존 그대로이며 이번 STEP에서 손대지 않았다).
- **tooltip**: 텍스트 라벨("매매"/"전세") 옆 숫자 색만 원래도 있었고, 이번에
  전세 쪽 색만 파랑으로 바뀜. tooltip 배경/테두리/그림자/구조는 변경 없음.

## 7. 정적 검증

```
npx tsc --noEmit        → 통과(출력 없음, 에러 0)
npx eslint src/components/PriceTrendChart.tsx  → 통과(출력 없음, 에러 0)
npm run build            → 성공, /apt/[name] 등 기존 라우트 구성 동일하게 출력
npx prisma validate      → "The schema at prisma\schema.prisma is valid 🚀"
npx prisma migrate status → "Database schema is up to date!" (3 migrations, 변경 없음)
```

## 8. DB/API 무손상 확인

- `src/components/PriceTrendChart.tsx` 외 파일 변경 없음(`git diff --stat`으로 확인,
  §11).
- `/api/apt/[name]` 등 API 라우트 파일 미수정.
- `prisma/schema.prisma`, `prisma/migrations/` 미수정 — `prisma validate`/
  `migrate status` 결과로 재확인(§7). DB write 0건(이번 STEP은 로컬 dev 서버로
  화면만 확인, 실거래 조회는 기존과 동일한 read-only GET 호출).

## 9. 회귀 확인

로컬 `next dev`(포트 3001, Turbopack)로 `대신푸르지오1차`(부산 서구, lawdCd
`26140`, 959세대 · 최근 12개월 다수 거래) 상세페이지를 직접 확인.

- **1년/3년/5년 전환**: 3개 기간 모두 매매(초록)/전세(파랑) 선이 명확히
  구분됨. 특히 3년 뷰 24-06~25-09 구간, 5년 뷰 23-10~24-06 구간처럼 두 선이
  반복적으로 교차하는 구간에서도 색만으로 즉시 구분 가능함을 스크린샷으로 확인.
- **tooltip**: 그래프 위 호버 시 "2026.03.27 매매 6억 300만"(초록 텍스트),
  "2026.03.18 매매 6억 8,500만"(초록 텍스트) 등 정상 표시. 매매 단독 포인트에서
  텍스트 색이 올바르게 초록으로 나오는 것을 확인(전세 단독 포인트에서 파랑으로
  나오는 것은 tooltip content 코드상 매매와 완전히 대칭 구조라 별도 hover 없이도
  코드 근거로 보장됨).
- **legend**: 화면 하단 "🔵 전세 🟢 매매" 스와치가 정확히 새 색상을 반영.
- **InvestmentMetrics**(매매가/전세가/전세가율/필요 갭 금액), **AptSpecGrid**
  (세대수/준공년월/용적률/건폐율/주차대수), **실거래 타임라인** 섹션 헤더까지
  스크롤하여 확인 — 레이아웃/색상/동작 모두 기존과 동일, 이번 변경의 영향 없음.
- **Hero/AreaSelector**: 상단 최근 실거래가 카드, 평형 선택 칩(`전체 / 84.65m² /
  84.94m² / 102.79m² / 74.61m²`) 모두 기존과 동일하게 렌더 — 이번 STEP에서
  수정하지 않았고 시각적으로도 변화 없음.
- **PC(1568px 창)**: 위 모든 확인을 1568px 폭 브라우저 창에서 수행 — 정상.
- **모바일 뷰포트**: 이번 조사 환경(claude-in-chrome 자동화)에서 `resize_window`로
  390×844(모바일 크기)를 요청했으나 실제 캡처된 스크린샷 해상도가 그대로
  1568×652로 유지되어(도구 환경 제약으로 추정) **실기기/좁은 뷰포트 렌더링을
  직접 캡처하지는 못했다**. 다만 이번 변경은 미디어쿼리나 반응형 분기 없이
  고정 hex/CSS 변수 문자열 하나를 바꾼 것이라, 뷰포트 폭과 무관하게 항상 동일한
  색상이 적용된다(코드상 breakpoint 의존성 없음을 §5 diff로 확인) — 색상
  구분 자체는 화면 크기와 무관하게 보장되지만, 실제 모바일 기기에서 최종 확인은
  사용자 검수로 대체한다.

## 10. 한계

- 위 §9에서 밝힌 대로 이번 조사 환경에서 실제 좁은 뷰포트(모바일) 스크린샷은
  얻지 못했다 — 코드 근거(반응형 분기 없음)로 뷰포트 무관성을 판단했을 뿐,
  실기기 캡처로 재확인한 것은 아니다.
- 색약(적록색약 등) 접근성까지는 이번 요청 범위(단순 시각 구분성 개선) 밖이라
  검토하지 않았다.

## 11. B2-3 후속

selectedArea 연동, 차트 aggregation(월별 중앙값), InvestmentMetrics 수정은
이번 STEP에서 의도적으로 손대지 않았다(요청서 §1/§15/§16 준수) — 문서33(B2-A)
설계안대로 별도 STEP(B2-3)에서 사용자 승인 후 진행.

## 12. git 변경 요약

```
git diff --stat
 docs/development/CHANGELOG.md      | 124 +++++++++++++++++++++++++++++++
 src/components/PriceTrendChart.tsx |   8 ++-
```

`src/components/PriceTrendChart.tsx` 외 production 파일 변경 없음. commit/push
하지 않았다.
