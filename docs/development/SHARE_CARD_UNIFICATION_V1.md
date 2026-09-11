# SHARE CARD UNIFICATION V1

브랜치: `main` / 기준 커밋: `edfdf7e`
선행 STEP: `COMPARE_SHARE_URL_COMPACT_FIX_V1`

## 1. 목적

같은 "공유" 버튼인데 화면마다 카카오톡 결과가 달랐다.

- 아파트 상세에서 공유하면 **이집 브랜드 카드**(브랜드 이미지 + 제목 + 설명 + CTA 버튼)가 갔다.
- 비교/통계/리포트에서 공유하면 **일반 URL 미리보기**(카카오톡이 링크를 크롤링해 만든 OG 카드 + 주소 말풍선)가 갔다.

이 STEP은 그 차이를 없애고, 모든 주요 공유 표면이 하나의 브랜드 카드 규칙을 쓰게 한다.
**URL 계약은 건드리지 않는다** — 선행 STEP이 만든 짧은 비교 링크는 그대로다.

## 2. 현재 상태 분석 — 왜 갈렸는가

원인은 카드 능력의 차이가 아니라 **호출 순서**였다.

| 표면 | 경로 | 순서 | 결과 |
|---|---|---|---|
| 아파트 상세 Hero / StickyActionBar / 학교 상세 | `KakaoShareButton` → `sendKakaoShare()` | **카카오 먼저** → 네이티브 → 클립보드 | 브랜드 카드 |
| 통계 / 비교 / 지도 / 분양 / 재개발 / 커뮤니티 / AI검색 | `ShareAction` → `useSharePage` | **네이티브 먼저** → 카카오 → 클립보드 | 일반 OG 미리보기 |
| 리포트 | `ReportActions.share()` (자체 구현) | 네이티브(+파일) → 클립보드 | 카카오 경로 자체가 없었음 |

`useSharePage`는 "네이티브 공유가 없는 환경(주로 데스크톱)에서만 카카오로 보강"하도록 설계돼
있었는데, **모바일에는 `navigator.share`가 항상 존재한다.** 그래서 실제 사용자(안드로이드
카카오톡)는 카카오 분기에 영영 도달하지 못했고, OS가 `title + text + url`을 이어붙인 평문을
카카오톡에 넘겨 일반 미리보기가 떴다. 브랜드 카드 코드와 브랜드 이미지 자산은 이미 있었지만
**도달 불가능**했다.

## 3. 설계 결정

### 3.1 카드 조립은 한 곳에서만

`src/lib/share/ejipShareCard.ts` — 순수 모듈(DOM/브라우저 API 없음).

```
buildEjipKakaoShare({ type, title, description, imageUrl, canonicalUrl, buttonLabel })
  → KakaoFeedPayload
```

지원 type: `apartment` | `stats` | `compare` | `report` | `generic`.

이 모듈이 강제하는 규칙:

- **절대 URL 검증** — canonical/이미지 URL이 절대 URL이 아니면 던진다. 깨진 카드를 보내느니
  호출부가 네이티브 공유/링크 복사로 내려가는 편이 낫다.
- **설명문 URL 제거**(§14) — 링크는 `link` 필드에만 있다. 설명에 URL이 섞이면 카드 안에
  주소가 두 번 보이고, 네이티브 폴백에서는 OS가 text와 url을 이어붙여 중복 말풍선이 된다.
- **브랜드 접미사 정규화**(§22) — `… | 이집`이 정확히 한 번. `이집 | 이집` / `- 이집` 혼용을
  하나로 모은다.

`sendKakaoShare()`(shareUtils)만이 `Kakao.Share.sendDefault()`를 호출한다. 화면 어디에도
카카오 템플릿 리터럴이 없다(테스트로 고정).

### 3.2 순서 통일 — 브랜드 카드 우선

`useSharePage`와 `ReportActions`의 공유 순서를, 실전에서 검증된 아파트 상세 쪽으로 맞춘다.

```
A. 카카오 SDK 준비됨 → 이집 브랜드 카드          (await 이전, 동기 호출)
B. 그 외 → navigator.share(title, text, url)     (리포트는 기존 파일 첨부 경로 유지)
C. 그 외 → 링크 복사
```

**A가 반드시 `await` 앞에 와야 한다.** `await`를 한 번이라도 거치면 브라우저가 사용자 제스처
흐름이 끊긴 것으로 보고 `sendDefault` 내부의 `window.open()`을 차단하고, 반환값 `null`에
`.focus()`를 호출하다 조용히 죽는다(기존 코드 주석에 실측 기록됨).

SDK 선로드(팝업 차단 회피 + idle 지연) 규칙은 `useKakaoSharePreload()` 훅 하나로 모아
`useSharePage`와 `ReportActions`가 공유한다.

### 3.3 브랜드 이미지

`public/brand/share/ejip-kakao-share-1200x630.jpg` — **이미 첫 스크린샷의 브랜드 카드가
쓰던 바로 그 자산**이다. 두 번째 브랜드 이미지를 새로 만들지 않았다(§4).

OG용 `ejip-og-main-1200x630.jpg`와 구분되는 이유는 기존 주석에 남아 있다: OG 이미지는
좌측 로고 + 우측 캐릭터 + 하단 배너 레이아웃이라 카카오톡이 정사각형에 가깝게 crop하면
로고가 잘린다. 카카오 카드용은 중앙 정렬 + 여백을 둔 별도 자산이다.

공유 시점에 스크린샷을 새로 굽지 않는다(§23) — 정적 자산 한 장을 재사용한다.

### 3.4 오리진 — 도메인 커토버 대비

`resolveShareOrigin()` (shareUtils):

1. `siteConfig.url`(= `NEXT_PUBLIC_SITE_URL`)이 https면 그대로 쓴다.
2. 아니면 지금 실제로 열려 있는 `window.location.origin`.

2번 폴백이 필요한 이유: `siteConfig`의 폴백 계산에는 **서버 전용** 환경변수(`VERCEL_ENV`)에
기대는 가지가 있어, `NEXT_PUBLIC_SITE_URL`을 넣지 않은 배포의 **클라이언트 번들**에서는
`http://localhost:3000`으로 내려앉는다. 그 값으로 만든 이미지 URL은 카카오 서버가 가져올 수
없고, 링크는 수신자 기기에서 열리지 않는다.

컴포넌트 어디에도 `e-jip.com` / `*.vercel.app`을 박지 않는다. `NEXT_PUBLIC_SITE_URL=https://e-jip.com`
으로 바꿔 재배포하면 canonical URL · 카드 이미지 · CTA 링크가 **한꺼번에** 따라온다.

## 4. 구현 내용

### 신규

- `src/lib/share/ejipShareCard.ts` — 공통 카드 빌더 + type별 CTA + 표면별 문구 헬퍼
- `src/lib/share/ejipShareCard.test.ts` — 24 테스트
- `src/hooks/useKakaoSharePreload.ts` — SDK 선로드 규칙 공용화

### 수정

- `src/lib/share/shareUtils.ts` — `resolveShareOrigin()` / `absoluteShareUrl()` 추가,
  `sendKakaoShare()`가 공통 빌더에 위임, 이미지 URL이 siteConfig 기준으로
- `src/hooks/useSharePage.ts` — 카카오 브랜드 카드 우선, `shareType` 추가, 선로드 훅 사용
- `src/components/KakaoShareButton.tsx` — `shareType` 추가(기본 `apartment`)
- `src/components/report/ReportActions.tsx` — 카카오 브랜드 카드 경로 추가, canonical
  오리진을 siteConfig 기준으로
- `src/components/compare/CompareV2.tsx` — 공통 문구 헬퍼 + `shareType="compare"` +
  `absoluteShareUrl`
- `src/app/apt/[name]/apt-client.tsx` — Hero/StickyActionBar 문구를 공통 헬퍼로
- `src/app/stats/[type]/shareContext.ts` — 브랜드 접미사/설명 폴백을 공통 헬퍼로
- `src/app/stats/[type]/type-client.tsx`, `src/components/stats/RegionChangeMapView.tsx`,
  `src/app/map/page.tsx`, `src/app/presales/[id]/…`, `src/app/redevelopment/[id]/…` — `shareType` 배선
- `src/lib/compare-v2/url.test.ts` — 바뀐 코드 모양에 맞춰 핀 갱신(계약 의미는 동일)

## 5. 카드 문구 / CTA 계약

| type | 제목 | 설명 | CTA |
|---|---|---|---|
| apartment | `<아파트명> \| 이집` | `<아파트명>의 실거래, 가격, 입지 정보를 확인해보세요.` | 이집에서 자세히 보기 |
| compare | `<A> vs <B> 비교 \| 이집` | `두 단지의 실거래·가격·입지 데이터를 비교해보세요.` | 이집에서 비교 보기 |
| stats | `<지역> <메뉴> \| 이집` | 메뉴 subtitle (없으면 `지역 실거래와 가격 흐름을 이집에서 확인해보세요.`) | 이집에서 통계 보기 |
| report | `<리포트 제목> \| 이집` | `핵심 데이터를 한 장으로 확인해보세요.` | 이집에서 리포트 보기 |

통계 설명에 메뉴 subtitle을 우선한 것은 의도적 선택이다 — 17개 통계 subtype마다 그 화면이
실제로 보여주는 것을 더 정확히 말해주기 때문이다. subtitle이 없을 때만 공통 문장으로 내려간다.

## 6. URL 계약 (§19 — 회귀 금지)

비교 공유 URL은 여전히:

```
/stats/compare?a=<aptSeqA>&b=<aptSeqB>
```

`aName` / `aLawdCd` / `aDong` / `bName` / `bLawdCd` / `bDong` / 인코딩된 한글은 들어가지
않는다. 테스트로 고정돼 있다(`ejipShareCard.test.ts §19`, `compare-v2/url.test.ts §A~§H`).

## 7. Open Graph 폴백

OG/Twitter 메타데이터는 **그대로 둔다**. 카카오 SDK 카드를 쓰지 않는 경로(외부 메신저,
브라우저 미리보기, 검색엔진, 링크 복사 후 붙여넣기)가 여전히 OG를 필요로 한다.
카카오 "공유" 액션만 브랜드 카드를 우선한다.

## 8. 분석(Analytics)

기존 이벤트를 그대로 유지한다.

- `useSharePage`: 카카오 경로 = `share_attempt`(SDK에 전송 완료 콜백이 없어 성공을 확인할
  수 없음), 네이티브 성공/클립보드 성공 = `share_success`
- `ReportActions`: `report_share` + `method` — 기존 `web_share_file` / `web_share` /
  `copy_link`에 `kakao_card` 추가

GA에 나가는 값은 여전히 고정 enum + 공개 행정코드뿐이다. 단지명/aptSeq/자유 입력은 싣지 않는다.
분석 스키마 변경 없음.

## 9. 공유 표면 인벤토리

| 표면 | 컴포넌트 | 상태 |
|---|---|---|
| 아파트 상세 Hero | KakaoShareButton | READY_BRANDED (apartment) |
| 아파트 상세 StickyActionBar | KakaoShareButton | READY_BRANDED (apartment) |
| 학교 상세 | KakaoShareButton | READY_BRANDED (apartment) |
| 단지 비교 | ShareAction | READY_BRANDED (compare) |
| 통계 상세(17 subtype) | ShareAction | READY_BRANDED (stats) |
| 지역 변동지도 | ShareAction | READY_BRANDED (stats) |
| 리포트 4종(단지/지역/비교/일별) | ReportActions | READY_BRANDED (report) |
| 지도 | ShareAction | READY_BRANDED (apartment) |
| 분양 상세 | ShareAction | READY_BRANDED (apartment) |
| 재개발 상세 | ShareAction | READY_BRANDED (apartment) |
| 커뮤니티 글 | ShareAction | READY_BRANDED (generic) |
| AI 검색 결과 | ShareAction | READY_BRANDED (generic) |
| 홈 / 오피스텔 / 금융도구 / MY | — | NOT_APPLICABLE (공유 버튼 없음, 제품 요구 없음 — 추가하지 않음) |

`GENERIC_FALLBACK`으로 남은 공개 표면은 없다.

## 10. 테스트 결과

- `npx tsx --test src/lib/share/ejipShareCard.test.ts` — 24/24 PASS
- `npx tsx --test "src/**/*.test.ts"` — 793/793 PASS
- `npx tsc --noEmit` — `src/` 오류 0건. 저장소 전체로는 사전 존재하던 `scripts/` 오류가
  남아 있다(`FAIL_EXISTING_SCRIPT_ERRORS`, 이번 변경과 무관)

## 11. 기기 QA 체크리스트 (DEVICE QA REQUIRED)

에이전트 환경에 실제 기기/브라우저가 없어 **카카오톡 시각 결과를 검증하지 못했다.**
아래는 배포 후 안드로이드 카카오톡에서 직접 확인해야 한다.

- [ ] 아파트 상세 → 카카오톡: 브랜드 이미지 / `<단지명> | 이집` / 설명 / "이집에서 자세히 보기"
- [ ] 단지 비교 → 카카오톡: `<A> vs <B> 비교 | 이집` / "이집에서 비교 보기" / 링크가
      `/stats/compare?a=…&b=…` 형태
- [ ] 통계 → 카카오톡: "이집에서 통계 보기"
- [ ] 리포트 → 카카오톡: "이집에서 리포트 보기" + 이미지/PDF 저장 버튼 정상
- [ ] 카드 외에 원시 URL 말풍선이 추가로 붙지 않는지
- [ ] iOS Safari / 안드로이드 Chrome / 데스크톱에서 공유 버튼이 죽지 않는지
- [ ] 360 / 375 / 390px에서 공유 버튼 터치 타깃·레이아웃 이상 없음

## 12. 알려진 제한

- 카카오 SDK는 전송 완료 콜백이 없다. `share_attempt`는 "카카오 공유창을 띄웠다"는 뜻이며
  전송 완료율로 읽으면 안 된다.
- 카카오 카드 이미지는 카카오 서버가 크롤링한다. 도메인 커토버 직후 첫 공유는 이미지 캐시가
  없어 늦게 뜰 수 있다.
- 로컬 개발(localhost)에서는 카카오가 이미지를 가져올 수 없다 — 카드 시각 확인은 배포 환경에서.
- 리포트 공유는 카카오가 가능한 환경에서 **브랜드 카드 우선**으로 바뀌었다. 캡처 PNG를 첨부하던
  `navigator.share({files})` 경로는 카카오를 쓸 수 없을 때의 폴백으로 남는다. 액션바의
  [이미지] / [PDF] 저장 버튼과 인쇄 파이프라인은 전혀 바뀌지 않았다.

## 13. 다음 STEP

`E-JIP DOMAIN CUTOVER V1` — `NEXT_PUBLIC_SITE_URL=https://e-jip.com` 설정 후
재배포 → 카카오 개발자 콘솔 플랫폼 도메인에 `e-jip.com` 등록 → 위 §11 기기 QA 재실행.
