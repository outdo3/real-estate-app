# APT DETAIL REPORT CTA FLOW V1 — 지도 → 상세 → 한장 리포트

- 기준 HEAD: `765d6ee` (main)
- 범위: UI·내비게이션만. 리포트 엔진·route·PNG/PDF/공유·API·DB·지도 마커 로직·단지 식별 무변경.

## 1. 기존 퍼널(코드 기준)

| 위치 | 리포트 진입 | 연결 | 기록 |
|---|---|---|---|
| 지도 단지 선택 하단 카드(`src/app/map/page.tsx`) | `[상세보기]` + `[한장 리포트]`(aptSeq 있을 때, 흰 바탕 green 테두리) | `router.push('/report/apt/{aptSeq}')` | **없음**(클릭 이벤트 미전송) |
| 상세페이지 상단 `NextActionSection`(점수·브리핑 직후) | primary `이 단지 한장 리포트` + secondary 지도/비교/자금 | `aptReportHref(canonicalAptSeq)` | `next_action_click` / actionType `REPORT` |
| 상세 `StickyActionBar` | 없음(공유·글쓰기) | — | — |

지도에서 곧바로 리포트로 갈 수 있고, 상세에 들어와도 페이지 **약 33%** 지점(브리핑 직후)에서 리포트 버튼을 먼저 만났다.

## 2. 변경 퍼널

```
지도 단지 선택 → [상세보기] → 상세(가격·점수·브리핑·시세 추이·투자지표·위치) → 리포트 카드 → /report/apt/{aptSeq}
```

- 지도 카드: `[상세보기]` 단일 primary. 폭 100%, `minHeight: 48`, 글자 1rem, green 유지. 리포트 버튼과 그 사이 여백(0.5rem + 버튼) 제거 → 카드 높이 감소.
  단지명·동·가격/평형·전용㎡·닫기·광고 슬롯·오피스텔 카드는 그대로. 상세보기 이동 URL(이름+lawdCd+dong+aptSeq) 그대로.
- 상세 상단 `NextActionSection`: REPORT 항목 제거 → 지도 보기가 primary로 복귀(primary 1개 규칙 유지), 비교·자금 그대로.
- 상세 중후반: `AptReportEntryCard` 1개 추가(아래). 페이지 안 리포트 CTA는 이것 하나.
- 리포트 route(`aptReportHref`, `/report/apt/[aptSeq]`)와 리포트 화면·생성·PNG·PDF·공유·카카오 흐름은 코드 변경 없음.

## 3. 상세페이지 실제 구역 순서와 삽입 위치

`src/app/apt/[name]/apt-client.tsx` 렌더 순서:

1. Hero(단지명·관심·공유) + 평형 선택 + 최근 실거래가
2. 이집 점수 + 단지 브리핑
3. 다음 행동(지도/비교/자금)
4. 2구역: 시세 추이 차트 · 투자 지표 · "이 집 사려면 얼마 필요할까?" · 위치 지도 카드
5. **← 한장 리포트 카드(신규)**
6. 3구역: 실거래 타임라인 + 단지 상세 제원
7. 단지 주변 생활정보(학교·교통 등 탭)
8. 스폰서 영역 → 단지 커뮤니티 → 중개사/법무사 카드 → StickyActionBar

**선택 근거**
- 사용자가 결론 판단에 쓰는 정보(현재가·점수·브리핑·가격 흐름·투자 지표·위치)를 모두 지난 뒤다.
- 실거래 타임라인·제원·생활정보는 "근거 데이터" 구역이라, 그 앞에서 요약본(리포트)을 제안하는 것이 자연스럽다. 리포트가 학군·교통을 함께 담으므로 생활정보를 다 보기 전에 보여줘도 설명이 성립한다.
- 생활정보 뒤(실측 약 72~73%)는 목표 구간보다 늦고, 이후는 광고·커뮤니티·상담 카드라 리포트 제안이 묻힌다.
- 구역 사이 경계라 기존 카드 내부 레이아웃을 건드리지 않는다.

**실측 위치**(로컬 production 빌드, 대표 단지 해운대구 우동 롯데 `26350-9`, 문서 높이 대비 카드 상단)

| 폭 | 카드 | 브리핑 | 실거래 타임라인 | 생활정보 |
|---|---|---|---|---|
| 360 | **54%** | 21% | 57% | 72% |
| 375 | **54%** | 21% | 57% | 72% |
| 390 | **54%** | 22% | 58% | 73% |
| 1280 | **61%** | — | — | — |

모바일은 목표(55~65%)의 하단 경계 바로 아래다. 단지별 거래·정보량에 따라 달라지며, 구역 경계 기준으로 고정했다(스크롤 비율 계산 없음).

## 4. 리포트 카드

`src/components/report/AptReportEntryCard.tsx` + `.module.css`

- 제목 `이 단지, 한 장으로 정리해 볼까요?` / 설명 `가격·거래·학군·교통·단지 정보를 한눈에 확인해 보세요.` / 버튼 `이집 한장 리포트 보기`("다운로드" 표현 없음 — 보기 → 저장/공유).
- 흰 카드 + 얇은 테두리 + 기존 `--radius-lg`·`--shadow-sm`(상세 panel과 같은 언어), lucide `FileText` 아이콘 칩(green 10%), primary `Button`.
- 그라데이션·애니메이션·전환 효과 없음. 고정/sticky/플로팅/스크롤 감지/모달 없음.
- 640px 이하: 세로 배치, 버튼 전체 폭 48px. 그 이상: 문구 왼쪽·버튼 오른쪽 한 줄(데스크톱 카드 높이 90px, 다른 panel과 같은 폭).
- canonical aptSeq가 없으면(`aptReportHref` null) 카드를 렌더하지 않는다 — 이전 REPORT 버튼과 같은 조건.

## 5. Analytics

- 상세 카드 클릭: 이전 상세 REPORT 버튼과 **같은** `next_action_click` + actionType `REPORT` + aptName. 기존 집계 의미 유지.
- 지도 리포트 버튼은 원래 클릭 이벤트가 없어 사라지는 이벤트 없음. 리포트 도착은 기존 `report_view`(리포트 페이지 마운트)로 계속 집계된다.
- `source = apt_detail` 차원은 추가하지 않았다: 1st-party 이벤트 URL 규칙(`/__event__/<name>?action=`)이 actionType만 받으므로 추가하려면 analytics 규칙 변경이 필요하다(범위 밖, 보고만).
  REPORT 진입점이 이제 상세 한 곳뿐이라 `next_action_click`·REPORT는 곧 "상세 → 리포트" 클릭이다.

## 6. 테스트·검증

| 명령 | 결과 |
|---|---|
| `npx tsx --test src/lib/report/apt-report-cta-flow.test.ts` | 12/12 pass |
| `npx tsx --test $(find src -name "*.test.ts" -o -name "*.test.mjs")` | 1962/1962 pass |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS(기존 scripts/tmp 25건, src 0) |
| `npx eslint` 변경 파일 | exit 0 (경고 2건은 기존 `apt-client.tsx` eslint-disable 주석, HEAD에도 있음) |
| `npm run build` | exit 0 |

기존 테스트 1건 갱신: `stats-report-entry.test.ts` §7-8이 "지도에 `report/apt/`가 있다"를 고정하고 있어, 이번 의도적 변경에 맞춰 "지도에 없다"로 바꿨다.

로컬 production 빌드 360/375/390/1280px: 가로 넘침 없음, 버튼 48px, 제목 1줄, 페이지 내 `/report/apt/` 링크 1개, 다음 행동 3개(지도·비교·자금).
로컬에서는 카카오 지도가 도메인 제한으로 뜨지 않아 지도 카드는 Production에서 확인(§7).

## 7. Production QA

아래 절 참고(배포 후 기록).

## 8. 알려진 한계

- 모바일 실측 위치 54%는 목표 구간 하단 경계 바로 아래(단지마다 다름).
- 위치별 클릭 구분(source)은 analytics 규칙 변경 전까지 불가.
- 브라우저 창 최소 폭 제약으로 360~390px은 같은 출처 iframe으로 측정했다(실기기 확인 필요).
