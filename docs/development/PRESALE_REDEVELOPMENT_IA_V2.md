# 분양·청약 페이지 정리 V1 (PRESALE / REDEVELOPMENT IA V2)

브랜치: `feature/parallel-work` (baseline `e8ac96b`, `origin/main`과 동일)
병렬 안전: main 미접촉, DB/schema/migration 미접촉, "전체 실거래 이력 구축 V1" 관련 파일 미접촉.

## 1. Goal

하단 탭 `재개발·분양` 진입 시 사용자가 "준비 중" placeholder를 먼저 보는 문제를
제거한다. `분양·청약` 실 데이터는 이미 `/presales`, `/api/presales`,
`/presales/[id]` 로 완성돼 있었으므로, 이번 STEP의 목표는 "새 기능 개발"이
아니라 "이미 있는 실 데이터를 허브 첫 화면에 직접 연결"이었다.

## 2. Previous Problem

`/redevelopment` 허브(`src/app/redevelopment/redevelopment-client.tsx`)의
`분양·청약` 탭은 `<Empty variant="notReady" .../>` 로 다음을 렌더링하고 있었다:

- 제목: "분양·청약 정보 연동 준비 중입니다."
- 설명: "청약홈 등 공공데이터 연동이 완료되는 대로 지역별 분양 일정과
  경쟁률을 제공할 예정입니다." — 이미 사실이 아님(Presale 데이터 1,046건
  가량 이미 존재, `/api/presales` 이미 live).
- CTA: "분양정보 전체 보기" → `/presales` (실제로는 이미 완성된 목록 페이지).

즉 사용자는 하단 탭 → placeholder → 링크 클릭 → 실제 목록, 총 1번의
불필요한 중간 클릭을 거쳐야 했다.

## 3. Final IA

```
하단 [재개발·분양] 클릭
  → /redevelopment 즉시 진입
  → 상단 [분양·청약] [재개발] pill 탭 (기본: 분양·청약)
  → 지역/상태/가격 필터 + 실제 분양 카드 목록 (placeholder 없음)
```

새 라우트/새 API를 만들지 않았다. `/redevelopment`, `/presales`,
`/presales/[id]`, `/api/presales*` 는 그대로 유지된다.

## 4. Presale vs Supply Role

- **통계 > 공급** (`/stats`, `/api/stats/supply`): 지역 단위 공급 "분석"
  (입주지도, 공급추이, 지역별 공급량 등). 이번 STEP에서 변경하지 않음.
- **재개발·분양 > 분양·청약** (`/redevelopment`, `/api/presales`): 개별
  분양 "프로젝트 탐색" (단지명/청약일정/세대수/입주예정/모집공고 등).

두 화면은 이미 서로 다른 API/데이터 소스(공급 통계 vs `Presale` 테이블)를
쓰고 있었으므로 역할 중복은 없다. 이번 STEP은 이 경계를 바꾸지 않고
문서화만 했다.

## 5. Data Source

`prisma/schema.prisma`의 기존 `Presale` / `PresaleHouseTypeDetail` 모델을
그대로 사용. 스키마 변경 없음. `status`는 DB 컬럼이 아니라
`src/services/cheongyakService.ts`의 `computePresaleStatus()`가
`houseType`/`receiptStartDate`/`receiptEndDate`로 요청마다 계산
(`upcoming`/`ongoing`/`closed`/`unsold`) — 기존 로직 그대로 재사용, 변경 없음.

## 6. Default Tab

`TABS[0].id === 'sale'` (분양·청약)이 이미 기본값이었다 — 새로 만들 필요
없었음. `useState(TABS[0].id)`로 로컬 state 유지(탭 선택의 URL 영속화는
이번 STEP 범위 밖 — §38/§39 참고).

## 7. Filters

기존 `/presales` 목록의 필터를 그대로 재사용: 지역(`subscriptionAreaName`
기반, API의 `regions` groupBy 결과로 동적 생성) + 상태(접수중/접수예정/
접수마감/무순위) + 가격(만원 구간). 새 필터 추가 없음.

## 8. Sorting

기존 `/api/presales` 정렬 로직(진행중 → 접수예정 → 접수마감 → 무순위
순서, 동순위 내 `receiptStartDate desc`) 그대로 재사용 — 변경하지 않음.
종료된 과거 프로젝트가 먼저 보이지 않도록 이미 설계돼 있었다.

## 9. Project Card

기존 `/presales` 카드(사업명/상태 배지/지역/가격/세대수/입주예정/청약홈
외부 링크) 그대로 재사용. 새 카드 디자인을 만들지 않았다.

## 10. Detail

기존 `/presales/[id]` 상세 페이지(요약+`ShareAction`, 일정, 주택형·분양가,
사업정보, 위치정보+지도, 인근 시세 비교, 청약홈 원문 CTA) 완전히 그대로
유지. 새 detail을 만들지 않았다.

## 11. Redevelopment

`RedevelopmentListSection`(및 `/redevelopment/[id]` 상세)은 손대지 않았다.
같은 상위 tab 구조 안에서 그대로 노출된다.

## 12. Placeholder Removal

- `redevelopment-client.tsx`에서 `Empty variant="notReady"` placeholder
  블록 전체 제거, `<PresaleListSection />` 로 교체.
- "분양·청약 정보 연동 준비 중입니다" / "청약홈 등 공공데이터 연동이
  완료되는 대로..." 문구는 저장소 전체에서 grep으로 재확인 — 0건.

## 13. Empty / Error

컴포넌트를 새로 만들지 않고 기존 `/presales` 로직을 그대로 재사용했으므로
기존 규칙이 그대로 적용된다:

- 실제 0건: `<Empty variant="noResult" title="조건에 맞는 분양정보가
  없습니다." />` ("준비중" 문구 아님)
- API 오류: `<ErrorState variant="section" message={...} />`
  ("분양정보를 불러오지 못했습니다" — 실제 QA에서 이 상태를 라이브로
  확인함, §18 참고)

## 14. Source / Freshness

이번 STEP에서 카드/상세의 출처 표기(청약홈 모집공고 기준, 입주예정일은
예정 정보)는 기존 것을 변경하지 않았다. 데이터 기준일 표시(신선도 배지)는
기존에 없었고, 이번 STEP 범위(IA 재배치)를 벗어나므로 추가하지 않음 —
Known Limitations에 기록.

## 15. Mobile

360/375/390 iframe 격리 QA(이 프로젝트에서 `resize_window`가 신뢰할 수
없어 기존에 쓰던 iframe 기법 재사용) — 3개 폭 모두
`scrollWidth === clientWidth` (가로 스크롤 없음) 확인. 필터가 2+1 컬럼으로
자연스럽게 줄바꿈되고, 헤더/설명/탭/필터/목록 영역이 첫 화면(뷰포트) 안에
placeholder 없이 즉시 보임.

## 16. Desktop

1280px 폭에서 `/presales`(공유 섹션 검증용) 확인 — `container` 클래스로
중앙 정렬, 모바일 확대판처럼 좁아지지 않음. `/redevelopment`는 동일한
`container` 레이아웃을 그대로 상속하므로 별도 회귀 없음.

## 17. Performance

새 API 호출을 추가하지 않았다. 탭 전환은 `PresaleListSection`/
`RedevelopmentListSection`을 언마운트/마운트하는 방식(기존 구조 그대로)이라
각 탭 진입 시 1회 SWR fetch — N+1 없음. 새 caching 아키텍처를 만들지
않았다.

## 18. QA (실행 결과)

- `npx tsc --noEmit`: 변경 파일(`presales-client.tsx`,
  `redevelopment-client.tsx`) 신규 에러 0. 저장소 전체에는 기존
  스크립트(`scripts/education/*`, `scripts/*.ts` 등) 관련 pre-existing
  에러 다수 존재 — baseline(`e8ac96b`)에서도 동일하게 존재함을
  `git stash`로 대조 확인. → `FAIL_EXISTING_SCRIPT_ERRORS`.
- `npm run lint`: 변경 파일 0 error/warning. 저장소 전체에는 pre-existing
  error 7건/warning 6건(전부 무관한 파일) — 동일하게 baseline에도 존재.
- `npm run build` (Next.js 16.3, Turbopack): **PASS**, 전체 페이지 정상
  생성 (`/presales`, `/presales/[id]`, `/redevelopment`,
  `/redevelopment/[id]` 등 포함).
- `scripts/apartment-score/verify-design-system-3.ts` (기존 정적 회귀
  가드 스크립트): 16개 체크 pass. 2개 FAIL은 `formatPyeong`
  export/`TradeTimelineList` colgroup 관련 — 이 STEP이 만지지 않은
  파일이며, `git stash`로 baseline에서도 동일하게 FAIL함을 확인 →
  pre-existing, 이번 변경과 무관.
- 브라우저 라이브 QA (Chrome, `localhost:3000`, `npm run dev`):
  - `/redevelopment` 진입 → placeholder 없이 필터+목록 영역 즉시 렌더 확인.
  - 분양·청약 ↔ 재개발 탭 전환 정상 동작 확인 (각자 필터 세트 전환).
  - 하단 `재개발·분양` 활성 상태가 `/redevelopment`, `/presales/1`
    양쪽에서 모두 켜짐(기존 `isActive` 규칙 라이브 검증).
  - React 크래시/콘솔 에러 없음(`read_console_messages` onlyErrors 확인).
  - 360/375/390 가로 스크롤 없음(§15).
  - **DB 연결 불가로 실 데이터 카드/상세 검증은 못함 — §20 Known
    Limitations 참고.**

## 19. 사용자 결정 여정 (연결 후보만 기록, 미구현)

향후: 분양 프로젝트 상세 → 주변 아파트 가격 비교(이미 `nearby-market`
API로 일부 존재) → 지역 공급 추이(`/stats` supply 연결, §26 CTA 후보) →
학교/교통 → 관심 저장. 이번 STEP에서는 구현하지 않았다.

## 20. Known Limitations

- **이 작업 폴더(`real-estate-app-work2`)에 `DATABASE_URL`이 설정돼
  있지 않음** (`.env`/`.env.local` 파일 자체가 없고 shell env에도 없음).
  이는 이번 STEP에서 만든 문제가 아니라 이 병렬 worktree의 사전 환경
  상태다. 그 결과 `/api/presales`, `/api/redevelopment` 모두 500을
  반환했고, 카드 목록·상세·"실제 0건 empty" 같은 **실 데이터 기반
  QA(부산/서울/미래·과거 프로젝트 등, 스펙 §47)는 이번 세션에서 수행하지
  못했다.** 대신 (a) API 500이 "준비중"으로 위장되지 않고 정확히
  `ErrorState`로 표시되는지, (b) placeholder 제거, (c) 탭 전환/레이아웃/
  overflow가 정상인지는 라이브로 확인했다. `DATABASE_URL`은 시크릿이라
  이 세션에서 직접 채워 넣지 않았다(원칙 #5/AGENTS.md 시크릿 금지).
  main worktree의 DB 설정을 그대로 가져오면 되는지 여부는 사용자 확인
  필요.
- 데이터 기준일(freshness) 표시는 기존에도 없었고 이번 STEP 범위 밖.
- 탭 선택은 URL에 영속화되지 않는다(§38 참고, 기존에도 없던 관례라
  대규모 routing 변경 회피를 위해 이번 STEP에서 추가하지 않음).

## 21. Main Merge Notes

- 변경 파일은 `src/app/presales/presales-client.tsx`,
  `src/app/redevelopment/redevelopment-client.tsx` 2개뿐. Prisma
  schema/migration 미접촉.
- "전체 실거래 이력 구축 V1" 관련 파일과 겹치지 않음(별도 감사로 확인).
- main 병합 시 위 두 파일에서 conflict 가능성은 낮음(둘 다 실거래 이력
  작업과 무관한 영역).
- GLOBAL SHARE SYSTEM(commit `63a7a59`)은 이 baseline에 이미 포함돼
  있었고, 이번 STEP은 그 파일들을 건드리지 않았다 — cherry-pick 불필요.

## 22. Next Step

`WAIT_FOR_MAIN_AND_MERGE` — 전체 실거래 이력 구축 V1 완료 및 ChatGPT PM
검수 후 병합. 병합 전 별도 세션에서 실제 DB 연결 하에 §47 실데이터 QA
(부산/타 시도/미래·과거 프로젝트/detail 카드 클릭 흐름)를 재확인할 것을
권고.
