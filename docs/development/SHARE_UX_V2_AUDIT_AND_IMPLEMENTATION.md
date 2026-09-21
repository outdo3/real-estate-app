# E-JIP SHARE UX V2 — AUDIT + IMPLEMENTATION

공유를 **코드가 고르는 캐스케이드**에서 **사용자가 고르는 3-액션 시트**로 바꾼다.

- 구현: 2026-09-21 · 기준 커밋 `43154ed`
- **DB INSERT/UPDATE/DELETE 0 · schema 0 · migration 0 · 외부 자동 발송 0 · 연락처 접근 0**

## 판정

**PASS** — 12개 공유 표면 전부가 하나의 공통 시트를 열고, `[카카오톡] [공유하기] [링크 복사]`
중 사용자가 고른다. 복사/공유 URL은 로컬에서 눌러도 **`https://e-jip.com/...`**(실측).

> **듀얼 카카오톡 가시성: NOT_TESTED.** 카카오톡이 두 개 설치된 기기가 없어 확인하지 못했다.
> 확인한 것은 **OS 공유 시트로 가는 길이 열렸다**는 것뿐이고, 그 시트에 두 번째 카카오톡이
> 뜨는지는 기기에서 확인해야 한다. "가능하다"고 가정해 PASS로 적지 않았다.

---

## 1. 감사 — 현재 공유가 존재하는 화면 전수

검색어: `Kakao.Share` / `sendDefault` / `sendScrap` / `navigator.share` / `clipboard` /
`writeText` / `buildShareUrl` / `공유`.

| # | 화면 | 진입 컴포넌트 | URL 생성 | 카카오 | 네이티브 | 복사 | 기존 동작 |
|---|---|---|---|---|---|---|---|
| 1 | 단지 상세 Hero | `KakaoShareButton` (compact) | `buildShareUrl()` | 1순위 | 2순위 | 3순위 | 캐스케이드 |
| 2 | 단지 상세 `StickyActionBar` | `KakaoShareButton` (compact, `label="공유"`) | 〃 | 〃 | 〃 | 〃 | 캐스케이드 |
| 3 | 학교 상세 | `KakaoShareButton` (compact) | 〃 | 〃 | 〃 | 〃 | 캐스케이드 |
| 4 | 지도 `/map` | `ShareAction` (icon, brand) | `buildShareUrl(params)` | 〃 | 〃 | 〃 | 캐스케이드 |
| 5 | 통계 `/stats/[type]` | `ShareAction` (compact) | 〃 | 〃 | 〃 | 〃 | 캐스케이드 |
| 6 | 지역 변동지도 | `ShareAction` (compact) | 〃 | 〃 | 〃 | 〃 | 캐스케이드 |
| 7 | 단지 비교 `CompareV2` | `ShareAction` (compact) | `url` prop(canonical) | 〃 | 〃 | 〃 | 캐스케이드 |
| 8 | 분양 상세 | `ShareAction` | `buildShareUrl(params)` | 〃 | 〃 | 〃 | 캐스케이드 |
| 9 | 재개발 상세 | `ShareAction` | 〃 | 〃 | 〃 | 〃 | 캐스케이드 |
| 10 | 커뮤니티 글 | `ShareAction` | 〃 | 〃 | 〃 | 〃 | 캐스케이드 |
| 11 | AI 검색 | `ShareAction` | 〃 | 〃 | 〃 | 〃 | 캐스케이드 |
| 12 | 리포트 액션바 | `ReportActions` (자체 구현) | envelope identity | 1순위 | 2순위(+PNG 첨부) | 3순위 | 캐스케이드 |

공유와 무관한 `clipboard.writeText`는 2곳(`/admin/system`, `/tools`)뿐이며 이번 범위 밖이다.

### 핵심 발견 — 버그가 아니라 **설계상 도달 불가**였다

`GLOBAL SHARE SYSTEM V1`은 이미 잘 만들어져 있었다. 문제는 그것이 **순서를 코드가 정하는
캐스케이드**였다는 점이다:

```
카카오 SDK 준비됨?  → 예: 카카오 카드 전송하고 끝    ← 모바일은 항상 여기서 끝난다
                    → 아니오: navigator.share
                              → 없으면: 링크 복사
```

모바일에서는 카카오 SDK가 (의도적으로) 항상 미리 로드돼 있으므로 **첫 분기에서 끝났다.**
즉 **OS 공유 시트가 열릴 일이 구조적으로 없었다.** 카카오톡을 두 개 쓰는 사용자가 "어느
카카오톡으로 보낼지" 고를 수 있는 유일한 장소가 바로 그 OS 시트인데, 그 시트로 가는 길이
막혀 있었던 것이다. 이것이 이번 STEP의 전부다.

> 이전 STEP(`SHARE_CARD_UNIFICATION_V1`)이 카카오를 1순위로 올린 것은 **옳은 수정이었다.**
> 그때의 문제는 "OS가 title+text+url을 이어붙인 평문을 넘겨 카드가 깨진다"였고, 그 해법이
> 카카오 우선이었다. 이번에 바뀌는 것은 그 카드 품질이 아니라 **선택권**이다 — 카카오 카드
> 경로는 조금도 바뀌지 않았고, 그 옆에 다른 두 길을 나란히 놓았을 뿐이다.

## 2~3. 공통 공유 UX

새 파일 3개 + 순수 헬퍼 1개. 화면마다 공유 코드를 복붙하지 않는다.

| 파일 | 역할 |
|---|---|
| `src/lib/share/shareChannels.ts` | 순수 로직 — 오리진 규칙, 채널 가용성. DOM 없음 |
| `src/hooks/useShareSheet.ts` | 상태 + 세 액션 핸들러 |
| `src/components/share/ShareSheet.tsx` | UI (모바일 하단 시트 / 데스크톱 가운데 모달) |
| `src/components/share/ShareSheet.module.css` | 〃 |

```
[카카오톡]   이집 카드로 바로 보내기
[공유하기]   다른 앱 선택 (카카오톡이 여러 개면 여기서 선택)
[링크 복사]  주소를 클립보드에 복사
```

**순서는 고정**이다 — 화면마다 달라지면 손이 기억하지 못한다(테스트로 고정).

### 이집은 어느 카카오톡인지 고르지 않는다

특정 인스턴스를 지목하는 것은 OS/카카오 앱의 권한이다. `com.kakao.talk` / `intent://` /
`kakaolink://` / `kakaotalk://` 같은 토큰이 공유 코드에 들어오면 **테스트가 실패**한다(§E).
우리가 하는 일은 선택 화면으로 가는 길을 막지 않는 것뿐이다.

### 카카오 전송은 여전히 동기다

`shareKakao`는 `async`가 아니고, `sendKakaoShare` 앞에 `await`가 하나도 없다. await가 끼면
브라우저가 사용자 제스처가 끊긴 것으로 보고 `sendDefault` 내부의 `window.open`을 차단하고,
반환값이 null이라 SDK가 `.focus()`에서 조용히 죽는다(과거 실측). 시트의 행 클릭 자체가
제스처이므로 이 성질은 그대로 지켜진다. **테스트 2건으로 고정했다.**

## 4. 쓸 수 없는 채널은 그리지 않는다 — dead button 금지

| 환경 | 보이는 행 |
|---|---|
| 모바일(카카오 O, `navigator.share` O) | 카카오톡 · 공유하기 · 링크 복사 |
| PC(`navigator.share` X, 예: Firefox) | 카카오톡 · 링크 복사 |
| 카카오 키 없음/SDK 실패 | 공유하기 · 링크 복사 |
| 아무것도 없음 | 링크 복사 |

**링크 복사는 어떤 환경에서도 사라지지 않는다.** 가용성은 **시트를 여는 순간** 다시 잰다
(아래 §12 참조 — 렌더 시점에 한 번 재던 첫 구현은 실제로 dead button을 만들었다).

## 5. 복사/공유 URL은 항상 프로덕션 정규 URL

`buildShareUrl()`은 주소창을 그대로 복사했다 — 프리뷰/로컬에서 누르면 **수신자가 열 수 없는
주소**가 나갔고, 카카오는 크롤링 이력이 없는 호스트의 OG를 긁었다.

새 `buildCanonicalShareUrl(params, explicitUrl)`은 **오리진만** 정규 오리진으로 갈아끼우고
경로·쿼리(=화면 상태)는 그대로 둔다. 호스트는 코드에 박지 않고 `siteConfig`(=`NEXT_PUBLIC_SITE_URL`)
→ `CANONICAL_ORIGIN` 순으로 온다. `localhost` / `127.0.0.1` / `::1` / `*.vercel.app`은 전부 거부된다.

**로컬(`http://localhost:3000`) 실측:**

| 화면 | 복사된 URL |
|---|---|
| `/stats/volume` | `https://e-jip.com/stats/volume` |
| `/report/city/busan` | `https://e-jip.com/report/city/busan` |
| `/apt/대신해모로` | `https://e-jip.com/apt/대신해모로` |

> **알려진 부작용(의도됨):** 프리뷰 배포에서 공유해도 링크는 프로덕션을 가리킨다.
> 프리뷰에서 "그 프리뷰의" 링크를 공유할 방법은 이제 없다. 공유 링크가 남에게 가는
> 물건이라는 점에서 이쪽이 맞다고 판단했다.

## 6~7. 상태 처리

| 상황 | 동작 |
|---|---|
| 사용자가 OS 공유창을 닫음(`AbortError`) | **정상 취소.** 에러 토스트 없음, 이벤트 없음, 시트는 열어둠 |
| 네이티브 공유 미지원/실패 | 시트를 닫지 않고 "다른 방법을 선택해 주세요" |
| 카카오 전송 실패 | 시트를 닫지 않고 경고 + 카카오 행을 접음. **자동으로 다른 채널로 넘어가지 않는다** |
| 복사 성공 | "복사 완료" + "링크를 복사했어요"(2.5초) |
| 복사 실패(권한 거부/비보안 컨텍스트) | **URL을 읽기 전용 칸에 그대로 보여준다** — 막다른 골목 없음 |

실측: 로컬에서 클립보드 권한이 거부된 상태로 복사하면 정확히 이 폴백이 떴다.

## 8. 접근성 / 터치

- `role="dialog"` + `aria-modal="true"` + 트리거에 `aria-haspopup="dialog"`
- 열면 첫 액션에 포커스, **ESC/배경 클릭으로 닫히고 포커스가 트리거로 복귀**(실측 확인)
- 액션 높이 **63px**(요구 44px 이상), `min-height: 56px`
- 하단 `env(safe-area-inset-bottom)` 반영 — 홈 인디케이터에 가리지 않음
- `prefers-reduced-motion` 존중

## 9. 레이아웃 (360 / 375 / 390px)

모바일 하단 시트 분기를 강제 적용해 실측:

| 폭 | 패널 폭 | 하단 여백 | 좌/우 넘침 | 문서 가로 스크롤 |
|---|---|---|---|---|
| 360 | 360 | 0 | 0 / 0 | 없음 |
| 375 | 375 | 0 | 0 / 0 | 없음 |
| 390 | 390 | 0 | 0 / 0 | 없음 |

데스크톱(≥768px)은 가운데 380px 카드로 뜬다(스크린샷 확인).
`z-index: 3000` — 저장소 내 최댓값과 동일하고 portal로 body 끝에 붙으므로 하단탭바(1000)·
StickyActionBar보다 항상 위다.

> **정직하게 적습니다.** 확장 프로그램이 브라우저 뷰포트를 958px로 고정해 **진짜 390px
> 기기 렌더는 촬영하지 못했다.** 위 수치는 하단 시트 분기를 강제 적용한 뒤 패널 폭을
> 제약해 측정한 기하값이다.

## 10. 캡처 격리

시트는 `document.body`로 portal되어 리포트 캡처 대상 노드 **밖**에 있고, 루트에
`data-export-exclude=""`도 명시했다. 리포트 화면 실측: `sheetInExportRoot: false`,
`sheetExcluded: true`.

## 11. 중복 구현 제거

세 곳이 각자 돌리던 캐스케이드를 **하나로** 합쳤다.

| 파일 | 변화 |
|---|---|
| `ShareAction.tsx` | props/외형 그대로, 클릭 시 시트를 연다 |
| `KakaoShareButton.tsx` | props/외형 그대로, 자체 캐스케이드 제거 → 같은 시트 |
| `ReportActions.tsx` | 자체 캐스케이드 제거 → 같은 시트. **PNG 첨부 공유는 그대로 살아 있다** (`onNativeShare`로 주입) |
| `useSharePage.ts` | **삭제** — 유일한 호출부(ShareAction)가 시트로 옮겨가 남은 캐스케이드였다. 옵션 타입은 `ShareTargetOptions`로 이동 |

`KakaoShareButton`의 비-compact 변형은 호출부가 없지만 계약을 유지했다. 다만 라벨은
"카카오톡으로 공유하기" → "공유하기"로 바꿨다 — 이제 그 버튼이 여는 것은 채널 선택
시트이므로 예전 라벨은 사실과 다르다(이모지도 `lucide-react` 아이콘으로 교체).

**보존된 것:** 카카오 카드 조립(`buildEjipKakaoShare`) · CTA 라벨 · 브랜드 이미지 ·
SDK 선로드 규칙 · 비교 화면의 canonical URL 계약 · 리포트 identity URL · 리포트 PNG/PDF 저장.

## 12. 구현 중 내가 만든 결함 하나 — 그 자리에서 잡았다

첫 구현은 `navigator.share` 존재 여부를 **렌더 시점**에 `useMemo`로 쟀다. 브라우저 실측에서
`navigator.share`를 지운 뒤 시트를 열었더니 **"공유하기" 행이 그대로 그려졌다** — 정확히
금지된 dead button이다. 원인은 memo 의존성에 그 값이 없어 렌더 시점 값이 굳은 것.
가용성 측정을 `openSheet` 시점으로 옮기고(`setNativeReady`) 테스트로 고정했다.

## 13. 분석 (스키마 변경 없음)

기존 `share_attempt` / `share_success`는 **의미도 발생 시점도 그대로** 두어 시계열을 끊지
않았고, 어느 채널을 골랐는지를 `share_kakao` / `share_native` / `share_copy`로 **추가** 기록한다
(기존 `/__event__/<name>` 네임스페이스 재사용). 한 번의 공유가 2행이 된다.

- `share_kakao`는 "골랐다"까지만 뜻한다 — 카카오 SDK에 전송 완료 콜백이 없다.
- 취소(`AbortError`)는 **아무 이벤트도 남기지 않는다**.
- 리포트는 기존 `report_share` + `method`(`kakao_card`/`web_share`/`copy_link`)를 유지한다.
- 새 이름은 allowlist **끝에** 붙였다 — 중간에 끼우면 앞서 고정해둔 순서 계약이 깨진다.

## 14. 테스트

**새로 추가: 17건** (`src/lib/share/shareChannels.test.ts`)

| 구분 | 내용 |
|---|---|
| A. URL | localhost/`*.vercel.app`/`::1` 거부 · `notvercel.app` 오탐 방지 · 경로·쿼리·해시 보존 · 호출부 URL 오리진 교체 |
| B. 가용성 | 복사는 항상 남음 · PC에 dead button 없음 · 모바일 3채널 · SDK 미준비 시 카카오 숨김 · **가용성은 열 때 잰다** |
| C~H. 배선 | 세 표면이 같은 시트 · 액션 고정 순서 · 특정 카카오톡 인스턴스 지목 금지 · 캡처 제외 · 취소는 오류 아님 · 복사 실패 시 URL 노출 · 정규 오리진 빌더 통과 |

**갱신한 기존 테스트 5개 파일** — 캐스케이드 순서를 고정하던 계약이 의도적으로 폐기됐으므로
새 계약으로 바꿨다(카카오가 네이티브보다 먼저 → 세 채널이 독립 선택지 + 카카오 전송 앞에 await 없음).

`src` 전체 **1,902 pass / 0 fail** · `npx tsc --noEmit` **src 오류 0**(`scripts/`·`tmp/`의
기존 오류는 `FAIL_EXISTING_SCRIPT_ERRORS`로 이번 변경과 무관) · 변경 파일 eslint **exit 0** ·
`npm run build` **성공**.

## 15. 운영 확인 범위

| 표면 | 확인 |
|---|---|
| 통계 `/stats/volume` (`ShareAction`) | 3행 · 정규 URL · ESC/배경 닫기 · 포커스 복귀 · 폭 측정 |
| 리포트 `/report/city/busan` (`ReportActions`) | 3행 · 정규 URL · 캡처 격리 |
| 단지 상세 `/apt/대신해모로` (`KakaoShareButton`) | 3행 · 정규 URL · 복사 피드백 · **카카오 전송 예외 없음** |

나머지 8개 표면(지도/비교/분양/재개발/커뮤니티/AI검색/지역변동지도/StickyActionBar)은
위 두 컴포넌트를 props만 달리해 쓰므로 코드 경로가 동일하다 — **개별 화면 실측은 하지 않았다.**

카카오 행을 실제로 눌렀을 때 예외 없이 시트가 성공 경로로 닫혔다(차단됐다면 예외가 나고
시트가 경고와 함께 남는다). 다만 **카카오 팝업 창 자체는 MCP 탭 그룹 밖에 열려** 내용을
확인하지 못했다 — 테스트 중 데스크톱에 카카오 공유 팝업이 하나 열려 있을 수 있다.

## 16. 하지 않은 것

- 새 DB schema / migration / DB write **0**
- 사용자 연락처 접근 **없음** · 외부 앱 자동 발송 **없음** · 카카오 계정 선택 강제 **없음**
- 공유가 없던 화면에 공유를 새로 추가하지 않았다
- 카카오 카드 템플릿·CTA·브랜드 이미지·title/description 문구 **변경 없음**

## 17. 남은 것 / 권고

1. **듀얼 카카오톡 실기기 확인(P1).** 카카오톡 2개가 설치된 안드로이드에서 [공유하기]를
   눌러 OS 시트에 두 개가 모두 뜨는지 확인해야 최종 결론이 납니다. 코드로는 더 할 수 있는
   일이 없습니다 — 그 선택은 OS가 합니다.
2. **iOS Safari 실기기 확인(P1).** `navigator.share`는 있지만 사용자 제스처 판정이 까다롭고,
   클립보드가 막히는 경우가 있습니다. 두 폴백(경고 + URL 노출)은 준비돼 있습니다.
3. **프리뷰 배포에서 프리뷰 링크를 공유할 방법이 없어졌습니다**(§5). QA에 필요하면
   개발 환경에서만 주소창 오리진을 쓰는 예외를 두는 안을 검토할 수 있습니다.
4. 지난 STEP에서 남은 항목은 그대로입니다: Seoul Phase A apply(QUOTA_BLOCKED) ·
   `planGroupInserts()` sibling 분기 운영 증명 · MOLIT source-withdrawal 4행 정책 ·
   테스트용 DB(`TEST_DATABASE_URL`) · 학교 지역 선택 영속화 · "기타" 라벨 · 학원 "45+".
