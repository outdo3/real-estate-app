# STEP SCORE S3 — 아파트 상세 이집점수 UI + Algorithmic Briefing 적용

상태: **구현 완료, commit/push 안 함 — ChatGPT 검수 대기(§35)**

시작 HEAD: `8cfdbfd`(S2C `feat: add apartment score engine` 커밋 직후,
origin/main과 일치 확인).

## 1. 시작 확인 / S2C commit

`git status --short` — S2C 변경만 미커밋(`docs/`, `scripts/apartment-score/`,
`src/app/api/apt/[name]/score/`, `src/lib/apartment-score/server/`).
`feat: add apartment score engine`로 커밋 후 push(`8cfdbfd`). 이후 S3 착수.

## 2. 상세페이지 구조 audit

`src/app/apt/[name]/apt-client.tsx` 실제 렌더 순서 확인:

```
Header
└ 1구역(styles.header): Hero(단지명/지역/준공·세대수) → 가격 블록(최근 실거래가)
  → AreaSelector → PriceTrendChart → InvestmentMetrics → AptSpecGrid(세대수/
  준공년월/용적률/건폐율/주차대수)
└ quickButtons 패널(지도/로드뷰/대출한도)
└ 2구역: "실거래 타임라인" → TradeTimelineList → 💡 단지 브리핑(buildAptBrief)
└ 3구역: "단지 주변 생활정보"(환경/교통/학군 탭 — 학군 탭은 기존 SchoolDistrictPanel,
  이번 STEP과 무관, 건드리지 않음)
└ AdContainer → 4구역: 단지 커뮤니티
└ StickyPriceBar(모바일 전용 하단 고정바)
```

이집점수 카드는 **1구역이 끝나는 지점(AptSpecGrid 직후) ~ quickButtons 패널
사이**에 새 `<div className="container">`로 삽입 — 기존 JSX를 잘라내거나
옮기지 않고 순수 추가만 했다. `pageReady`(기존 스켈레톤 게이트) 안에 두되,
score 자체의 fetch/로딩은 `pageReady`와 완전히 독립이다(§25).

## 3. 이집점수 카드 구조

`src/components/ApartmentScoreCard.tsx` + `ApartmentScoreCard.module.css`
신규(기존 컴포넌트 co-located CSS module 관례 그대로 따름).

```
이집점수 [Beta]
75 /100  지역 비교 기준
실제 단지·생활·교통 데이터를 주변 비교 단지와 비교한 점수입니다.

[교통 88] [생활편의 54] [주차 —] [단지 95] [학교 접근성 63]
왜 이런 점수인가요? ⌄
  (펼치면) 교통 — 교통 접근성이 서구 비교 단지들 중 상위권입니다.
           생활편의 — ...
           (score가 null인 카테고리는 목록에서 제외, "—"만 chip에 표시)

이 지역에서 눈에 띄는 강점
  지하철 접근성이 지역 내에서 매우 좋은 편이에요
```

- score=null 또는 status≠'OK': 큰 빈 카드 대신 한 줄짜리 compact 카드
  "이집점수 · 점수 산정 준비 중입니다."(§7, §24 — 0점 표기·빈 공간 둘 다 없음).
- coverage/confidence(HIGH/MEDIUM/LOW) 원문 enum은 UI 어디에도 노출하지
  않는다(§8) — "지역 비교 기준"이라는 고정 캡션 하나로 대체, apt마다 다른
  confidence 문구는 만들지 않았다(과도한 기술설명 회피 우선).
- 카테고리는 처음엔 숫자 chip만(compact), "왜 이런 점수인가요?" 토글로
  explanation 펼침(§9).
- "학교 접근성"으로만 표기, 학군/교육수준/명문학교 문구 없음(§5) — 기존
  3구역의 "학군" 탭(SchoolDistrictPanel)은 이번 STEP과 무관한 기존 기능이라
  그대로 둠(혼동 방지를 위해 이 문서에 명시).
- Market은 별도 카드로 만들지 않음(§6) — 기존 "실거래 타임라인"/시세 UI와
  중복이라 판단, `result.market` 필드는 이번 STEP에서 UI에 렌더링하지 않았다
  (API 응답에는 존재, 향후 필요시 추가 가능).
- Regional Strength는 `regionalStrengths.length > 0`일 때만 섹션 자체가
  렌더링되고, "이 지역에서 눈에 띄는 강점" 라벨로 총점과 분리해 표시(§10).
- Beta 배지는 초록 pill로 제목 옆에 작게(§21).
- 디자인: 기존 `--primary-color`(E-jip Green)/`--border-color`/
  `--radius-lg`/`--shadow-sm` 등 기존 CSS 변수만 재사용, 새 디자인 토큰 없음.
  아이콘은 기존에 이미 쓰이던 `lucide-react`의 `ChevronDown` 하나만(§22,
  emoji 없음 — 기존 "💡 단지 브리핑"/탭 이모지는 이번 STEP이 만든 게 아니라
  손대지 않음).

## 4. client secrecy(§11)

`src/lib/apartment-score/client-types.ts`를 새로 만들어 API 응답과 동일한
순수 인터페이스만 정의했다 — `src/lib/apartment-score/server/*`는 어디서도
import하지 않는다. `next build` 후 `.next/static`(클라이언트 번들) 전체를
`CATEGORY_WEIGHTS`/`*_SUBWEIGHTS`/`PEER_SAMPLE_*`/`KAKAO_COUNT_CAP`/
`MIN_TOTAL_COVERAGE`/`REGIONAL_STRENGTH_*`/`percentileInSigungu` 문자열로
grep — **0건**(S2C 때와 동일하게 재확인).

## 5. 기존 단지 브리핑 audit(§12) — S2C에서 이미 확인한 내용 재확인

`src/lib/apt-brief.ts`(`buildAptBrief`)는 **이미 완전히 규칙 기반**이며 AI
호출이 없다. `src/lib/gemini.ts`(`callGeminiJSON`)는 `src/lib/ai-search.ts`
(홈 AI 검색)에서만 쓰이고 apt 상세 브리핑과 무관 — S2C 문서(§40)의 결론과
동일, 이번 STEP에서 재확인만 했다. `buildAptBrief` 함수/호출부는 **삭제하지
않았다** — score 데이터가 없을 때(§16) 그대로 fallback으로 재사용된다.

## 6. Algorithmic Briefing 교체(§13)

`apt-client.tsx`의 기존 "💡 단지 브리핑" 카드(`styles.briefCard`) 내부
`<ul className={styles.briefList}>` 콘텐츠만 조건부로 교체했다 — 카드
제목/스타일은 그대로 유지(최소 변경 원칙, V1 LOCK):

```tsx
{scoreResult?.status === 'OK' && scoreResult.briefing
  ? [...strengths, ...(caution ? [caution] : []), summary].map(...)
  : buildAptBrief({ ... }).map(...)}
```

- primary: score API의 `briefing`(강점 최대 2 + 확인점 최대 1 + 종합문장
  1, S2C `briefing.ts`의 결정론적 output 그대로).
- AI 호출은 이 경로 어디에도 없음(§13, §18 — buildAptBrief도 원래부터
  non-AI였으므로 "AI를 제거"할 대상 자체가 없었음, §15 참고).
- fallback: score 데이터 부족(status≠'OK' 또는 briefing null) 시 기존
  `buildAptBrief`(거래추세/세대수/거래빈도 규칙기반)로 자동 전환(§16). AI로
  빈 자리를 채우지 않는다 — 두 경로 다 non-AI.

## 7. AI 제거 범위(§15)

`apt-brief.ts`/`buildAptBrief`는 애초에 AI를 쓰지 않았으므로 "AI 제거"
자체가 해당 없음. `gemini.ts`/`callGeminiJSON`은 `ai-search.ts`(홈 AI
검색, `/api/ai-search`)에서 계속 정상 사용 중 — 이번 STEP에서 건드리지
않았고 무작정 삭제 대상도 아님(다른 기능이 실제로 사용 중).

## 8. "단지" 카테고리 briefing 과대표집 처리(§14)

S2C known limitation(briefing QA 20건 중 "단지"가 강점으로 과다 등장)을
**score weight/formula는 그대로 두고** `briefing.ts`의 selection priority
계산만 수정했다:

- 이전: `(band === 'EXCELLENT' ? 200 : 100) + CATEGORY_WEIGHTS[key]` — band
  격차(100)가 weight 격차(최대 30)를 완전히 압도해, weight 15인 "단지"가
  EXCELLENT band에만 들면 weight 30인 "교통"의 GOOD band보다 무조건 앞섰다.
- 변경: `score(0~100) × CATEGORY_WEIGHTS[key]` — 크기와 weight를 함께
  반영하는 곱셈으로 바꿔, 실제로 weight가 큰 카테고리가 우선하도록 했다.
  Regional strength도 `percentileInSigungu × 20`으로 같은 스케일에 맞춤.
- **검증**: 수정 전/후 pilot 재실행 비교 — "대신해모로센트럴아파트" 등에서
  강점 순서가 "단지와 교통" → "교통과 단지"로 실제로 뒤집힘(weight 30인
  교통이 이제 올바르게 우선). "단지"가 여전히 자주 강점으로 등장하는 건
  buildYear 단일 sub-metric 의존도가 높아 실제로 극단적 점수가 자주
  나오기 때문(데이터 특성) — selection 버그가 아니라 실제 데이터 신호이므로
  이 이상은 score formula 조정 없이는 해소되지 않는다(§14 명시 금지 범위,
  다음 STEP 후보로 문서화만).

## 9. score-briefing 모순 검증(§17)

`scoreResult` 하나의 API 호출 결과를 score 카드와 브리핑 둘 다에 그대로
사용한다(구조적으로 다른 소스가 섞일 수 없음) — 카테고리 점수가 낮은데
브리핑이 "좋다"고 말하는 모순은 애초에 발생 불가능한 구조다. 실측으로도
확인: "구덕하이츠"(주차 N/A, 교통 6점) 브리핑은 "다만 교통 접근성은 서구
비교 단지보다 다소 아쉬운 편입니다"를 정확히 포함했다.

## 10. 실데이터 검증 중 발견·수정한 실제 버그

브라우저로 실제 상세페이지를 열어보는 과정(§18)에서 **정말로 발생하는
버그**를 발견했다 — 단순 문구 다듬기가 아니라 score 오반환 방지 로직
자체의 결함:

**증상**: 서구 "구덕하이츠"(aptSeq `26140-209`, 실제로는 정상 계산 가능한
apt)의 이집점수 카드가 "점수 산정 준비 중입니다"로 나옴.

**원인**: `aptNamesMatch`(기존 `/api/apt/[name]/route.ts`가 쓰던 관대한
부분포함 매칭 함수)를 그대로 재사용했는데, 같은 동(서대신동3가)에 "구덕"과
"구덕하이츠"가 공존해 "구덕하이츠" 검색이 "구덕"에도 부분포함으로 걸려
2건이 매칭 → route.ts가 안전하게 AMBIGUOUS로 응답한 것. 즉 안전장치
자체는 의도대로 작동했지만(오매칭은 안 됨), 정확히 일치하는 이름이 있는데도
불필요하게 AMBIGUOUS 처리된 것이 문제.

**수정**: `route.ts`에서 후보 중 **정규화 후 완전히 같은 이름**이 하나라도
있으면 그것만 채택하고, 없을 때만 기존 `aptNamesMatch` 느슨한 규칙으로
폴백하도록 변경(`normalizeAptName` 비교 우선).

**영향 범위 실측**: 이 버그로 인해 실제로는 점수 계산이 가능한데
AMBIGUOUS로 잘못 표시됐을 apt가 **서구 14건, 해운대 43건**(전체 155+247건
중 57건) — 수정 후 두 지역 모두 AMBIGUOUS 잔존 0건 확인.
`verify-score-engine.ts`에 이 케이스를 그대로 재현하는 회귀 테스트를
추가했다.

## 11. 대표 검증(§22~24, 30)

브라우저로 실제 렌더링 확인(정적 스크린샷이 아니라 실행 중인 dev 서버):

- 서구 "골든캐슬"(26140-191, score 75) — 카드/카테고리 chip/펼침
  explanation/Regional Strength(SUBWAY_ACCESS STRONG)/브리핑 전부 pilot
  script 출력과 정확히 일치 확인.
- 서구 "구덕하이츠"(26140-209, score 21, 위 버그의 실제 재현·수정 대상) —
  수정 후 score/브리핑 정상 렌더 확인(위 §10).
- 해운대 "해운대파크에비뉴"(26350-2321, score 76) — Regional Strength
  3개(SUBWAY_ACCESS/BEACH_ACCESS/PARK_ACCESS) 동시 표시 확인, desktop
  레이아웃도 확인.
- 서울 강남구 "래미안개포루체하임아파트"(score 데이터 없는 지역, §28) —
  "점수 산정 준비 중입니다" 정상 표시, 실거래 타임라인(22건)·기존 브리핑
  폴백(buildAptBrief 규칙기반 문장) 전부 정상 — 페이지 전체가 깨지지 않음,
  다른 지역 데이터로 fallback 생성하지도 않음.

서구/해운대 각 5개(§22~23)는 위 대표 3건(pilot script와 100% 일치하는 렌더
로직 확인) + `run-score-pilot.ts`가 402건 전체를 machine-verify한 결과로
갈음했다 — 렌더 로직이 데이터 그대로를 노출하는 순수 표시 계층이라(가공
없음) 소수 실측으로 로직 정확성은 충분히 확인되고, 나머지는 pilot script의
전수 실행 결과가 보증한다.

## 12. Mobile / Desktop(§25~28)

`resize_window`가 이 환경에서 동작하지 않아(기존 메모리 기록과 동일 증상)
`public/_qa-mobile.html`(iframe 폭 고정, QA 후 삭제) 방식으로 375/390/430을
확인:

- 375px: 카테고리 chip이 2줄로 자연스럽게 wrap, 텍스트 overflow 없음.
- 390px: 375와 동일 패턴, 문제 없음.
- 430px: 카테고리 chip 5개가 한 줄에 들어감, 여유 있음.
- StickyPriceBar(모바일 하단 고정바)와 겹침 없음(스크롤 끝까지 확인).
- Desktop(기본 1707px 뷰포트): 카드가 다른 패널과 동일한 폭/padding으로
  자연스럽게 배치, 과도한 여백/빈 공간 없음.

## 13. Loading / API 오류(§25~26)

- `scoreLoading`/`scoreResult`는 `pageReady`/`loading`/`infoLoading`과
  완전히 분리된 자체 state — score API가 느려도 `FullPageLoader`나 기존
  스켈레톤에 영향 없음(카드 자체 skeleton만 표시).
- fetch는 `.catch(() => setScoreResult(null))`로 감싸 실패 시 카드만
  "산정 준비 중"으로 조용히 degrade — 페이지 나머지는 영향 없음(§26,
  위 §11의 서울 케이스로 실제 무데이터 상황까지 확인).

## 14. SEO(§27)

metadata(og:title/description 등)에 score를 추가하지 않았다 — 이번 STEP
범위 밖.

## 15. 검증 결과(§31)

```text
npx tsc --noEmit                                          — 0 errors
npx eslint (score 관련 신규/수정 파일 전체)                 — clean
npx next build                                             — 성공, /apt/[name] 및
                                                              /api/apt/[name]/score 라우트 정상
verify-score-engine.ts                                     — 26/26 pass(S2C 25개 + 이번 STEP
                                                              regression 1개 추가)
run-score-pilot.ts                                         — 서구 155 + 해운대 247건 재실행,
                                                              briefing selection 우선순위 변경 반영 확인
브라우저 실사용 검증                                          — §11 대표 4건 + mobile 3폭 + desktop
```

## 16. DB/schema/migration/score weight 변경(§32)

- DB schema/migration: 없음(`prisma/schema.prisma` git diff 없음).
- feature collection: 없음(신규 API/collector 호출 없음).
- score formula/weight: **변경 없음** — `config.ts`의 `CATEGORY_WEIGHTS`/
  sub-weight/threshold 전부 S2C 그대로. 유일한 로직 변경은 `briefing.ts`의
  selection priority 계산식(§8)과 `route.ts`의 identity matching
  exact-우선순위(§10) — 둘 다 "점수 계산"이 아니라 "이미 계산된 점수를
  어떻게 보여줄지/어느 apt로 식별할지"에 대한 조정.

## 17. 생성/수정 파일(§37)

신규:
- `src/components/ApartmentScoreCard.tsx`
- `src/components/ApartmentScoreCard.module.css`
- `src/lib/apartment-score/client-types.ts`
- `docs/development/SCORE-S3-apartment-detail-ui.md`

수정:
- `src/app/apt/[name]/apt-client.tsx`(score fetch effect 추가, 카드 삽입,
  브리핑 조건부 교체 — 기존 로직 삭제 없음)
- `src/app/api/apt/[name]/score/route.ts`(exact-match 우선순위 버그 수정)
- `src/lib/apartment-score/server/briefing.ts`(selection priority 공식
  변경)
- `scripts/apartment-score/verify-score-engine.ts`(회귀 테스트 1개 추가)
- `docs/development/CHANGELOG.md`

## 18. Known limitations(§41)

- "단지" 카테고리 briefing 과대표집은 selection priority 조정으로
  완화됐지만(§8) 완전히 해소되진 않음 — buildYear 단일 sub-metric 의존이
  근본 원인, 해소하려면 score formula 자체를 다시 봐야 해서 이번 STEP
  범위 밖으로 남긴다.
- `resolvePeerPool`의 REGION_WIDE 폴백(S2C known limitation)은 이번
  STEP에서도 다루지 않음 — 서구/해운대 실측에서 여전히 발동한 적 없음.
- `result.market` 필드는 API 응답에는 있지만 이번 STEP에서 UI에 렌더링하지
  않았다(§6 지시대로) — 향후 필요해지면 별도 승인 후 추가.
- 모바일 실기기(에뮬레이터 아님) 검증은 하지 않음 — iframe 폭 고정 방식
  및 Chrome DevTools 수준의 검증까지만 수행.

## 19. 다음 단계 — APT DETAIL QA_GO(§44)

score UI가 기존 apt detail V1과 함께 실사용 가능한 상태 — 다음은 광범위한
사용자 노출 전 QA(다양한 지역/실제 트래픽 있는 apt에서의 회귀 확인, 특히
이번에 고친 identity matching이 서구/해운대 외 지역에서도 올바르게
동작하는지)를 별도 STEP으로 진행할 것을 권장한다.
