# STEP 46 — APT DETAIL UI-C3-2 최종 배포 보고서

상태: **배포 완료(commit/push 확인) / 브라우저 실기기 UI 최종 검수는 미완료 세션에서 이어받음**

성격: STEP 45(TAGO 버스정류소 연동 구현) 종료 후, 이전 세션이
claude-in-chrome을 이용한 production UI 검증 도중 중단되어 강제
종료되었다. 이번 STEP은 **코드 수정 없이** 현재 git/배포 상태만
재확인하고, 이미 확인된 사실만으로 최종 보고서를 작성한 것이다.
claude-in-chrome 재시도 및 다른 STEP 진행은 지시에 따라 하지 않았다.

---

## 1. 이번 세션에서 재확인한 사실 (코드 수정 없음)

```
git status --short                                    → (출력 없음, working tree clean)
git rev-parse HEAD                                     → 960c20351b9dfd4b6be339429bfb0434a88f04bf
git fetch origin                                        → (새 ref 없음)
git rev-parse origin/main                               → 960c20351b9dfd4b6be339429bfb0434a88f04bf
git rev-list --left-right --count origin/main...HEAD    → 0	0
```

HEAD == origin/main == `960c203`, working tree clean, ahead/behind 0/0.
이 STEP에서는 `git add`/`commit`/`push`/파일 수정을 일절 수행하지
않았다.

`git show --stat 960c203` 확인 결과, 이 커밋 하나에 STEP 44/45 산출물이
모두 포함되어 있음을 재확인했다:

```
docs/development/44-apartment-detail-bus-access.md   (신규)
docs/development/45-apartment-detail-tago-bus-stop.md (신규)
docs/development/CHANGELOG.md                          (수정)
src/app/api/transit/bus-stops/route.ts                 (신규)
src/components/BusAccessCard.tsx                       (신규)
src/components/KakaoPlaces.tsx                         (수정, formatEta export 1줄)
src/components/NeighborhoodInfoPanel.tsx                (수정, 🚌 카드 블록 추가)
```

## 2. 이전 세션에서 이미 확인된 사실 (이번 STEP에서 재검증하지 않음, 그대로 인용)

사용자가 이번 요청에서 "이미 확인된 상태"로 제시한 항목이며, 이번
STEP에서 다시 실행/검증하지 않았다:

- commit `960c203`
- `origin/main` push 성공
- Vercel production 배포 확인
- production `/api/transit/bus-stops` 정상 데이터 응답 확인

## 3. 브라우저 UI 검증 상태

이전 세션이 claude-in-chrome으로 production 페이지의 UI를 확인하던
도중 응답 없이 멈춰 강제 종료되었다. 이번 STEP은 사용자 지시에 따라
**claude-in-chrome을 재시도하지 않았다.** 따라서 다음 항목은 이번
세션에서도 브라우저로 확인되지 않은 상태로 남아 있다:

- production 아파트 상세페이지에서 🚌 버스 카드가 실제로 렌더링되는지
  (레이아웃/스타일 붕괴 여부 포함)
- 가까운 정류장/거리/도보시간/500m 내 정류장 수 등 표시값이 화면에서
  올바르게 나타나는지
- 기존 5개 카드(🚇 교통·🏥 병원·공원·🛒 대형마트·🏪 편의점·💊 약국·
  🧸 어린이집·유치원)에 대한 UI 회귀 여부 (STEP 45 문서 §24는 로컬
  개발 서버 기준 확인이며, production 재확인은 아님)
- 모바일 뷰포트에서의 레이아웃/터치 동작

**→ 사용자 모바일 실기기 검수 필요.**

## 4. 알려진 한계 (STEP 45에서 이미 기록, 변경 없음)

1. citycode 중복 등록으로 인한 300m/500m 카운트 과대집계 가능성
   (행정구역 경계 인근 단지, 예: 대신푸르지오1차·고원3단지) — BLOCKER
   아님, 사용자 검수 시 확인 필요.
2. data.go.kr 짧은 간격 연속 호출 시 일시적 실패 경향 — 400ms 고정
   1회 재시도로 완화, 근본 원인(게이트웨이 정책) 자체는 미문서화.
3. 부산 외 지역 TAGO 데이터 정확도는 검증되지 않음(부산 6개 표본만
   확인).
4. 빠른 단지검색/StickyPriceBar/하단 nav 등 일부 회귀 항목은 "코드
   미수정"에 근거한 판단이며, 직접 클릭 재현은 하지 않음.

## 5. 최종 판단

APT DETAIL UI-C3-2(TAGO 버스정류소 연동)는 코드 구현·commit·push·
Vercel production 배포·production API 응답까지 확인된 상태다.
`960c203` == `origin/main` == 로컬 HEAD로 세 지점이 모두 일치하고
working tree는 clean하다. 다만 이전 세션에서 중단된 **production
브라우저 UI 실물 검증(레이아웃·표시값·모바일 뷰)**은 이번 STEP에서도
수행하지 않았으므로 완료로 단정하지 않는다.

**사용자 모바일 실기기 검수 필요**: production 아파트 상세페이지에서
🚌 버스 카드 렌더링, 표시값, 기존 카드 회귀 여부, 모바일 레이아웃.

이번 STEP에서는 코드 수정/commit/push를 하지 않았으며, 다른 STEP으로도
진행하지 않았다.
