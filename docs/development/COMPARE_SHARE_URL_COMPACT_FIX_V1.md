# COMPARE SHARE URL COMPACT FIX V1

작성일: 2026-09-11
선행: `SCORE_CANONICAL_APTSEQ_RESOLUTION_FIX_V1`
기준 커밋: `0d14a69` (main)

## 목적

단지 비교 공유 링크를 **canonical aptSeq 둘만 담은 짧은 URL**로 바꾼다.

DB 쓰기·스키마·마이그레이션 없음. 점수 산식 무변경.

## 1. 무엇이 문제였나

사용자가 모바일에서 재현한 현상: 카카오톡으로 비교를 공유하면 OG 카드 위에
`%EB%...` 덩어리가 그대로 말풍선으로 보인다.

원인은 URL의 **내용**이다. `buildCompareUrl`이 단지명·법정동·구코드를 전부 쿼리에
실었고, 한글은 퍼센트 인코딩되므로 한 글자가 9자로 부푼다.

실측(부산 실제 단지, 현재 배포 오리진 기준):

| 조합 | 이전 |
|---|---|
| 진흥목화 vs 송암파크빌 (같은 구) | **292자** |
| 해운대경동제이드 vs 대원아파트 (다른 구) | **303자** |
| 해운대역푸르지오더원 vs 해운대경동제이드 (긴 이름) | **340자** |

```
https://real-estate-app-park11.vercel.app/stats/compare?aptSeq=26350-2611%2C26350-2206
&aName=%ED%95%B4%EC%9A%B4%EB%8C%80%EC%97%AD%ED%91%B8%EB%A5%B4%EC%A7%80%EC%98%A4%EB%8D%94%EC%9B%90
&aLawdCd=26350&aDong=%EC%9A%B0%EB%8F%99
&bName=%ED%95%B4%EC%9A%B4%EB%8C%80%EA%B2%BD%EB%8F%99%EC%A0%9C%EC%9D%B4%EB%93%9C
&bLawdCd=26350&bDong=%EC%9A%B0%EB%8F%99
```

### 왜 그런 파라미터가 있었나

`compare-v2/url.ts`의 원래 주석이 이유를 적어 두고 있었다: 복원할 때 부르는 API가
전부 **이름 기반**이라 aptSeq만으로는 단지를 되살릴 수 없었고, aptSeq 조회 경로를
새로 만드는 것은 그 단계(COMPARE_V2_PHASE2)의 범위 밖이었다. 그래서 aptSeq를 싣되
이름·동·구코드를 **동반 파라미터**로 함께 실었다.

즉 중복 맥락이 아니라 그때는 **실제로 필요했던 값**이다. 이번에 서버가 aptSeq로
단지를 복원하게 되면서 비로소 뗄 수 있게 됐다.

### `text`에 URL이 중복되고 있었나 — 아니다

§6이 의심한 "URL이 `text`에도 들어가 이중으로 보이는" 문제는 **없었다.**

```
nativeShare({ title, text, url })          // 세 필드가 분리돼 있다
sendKakaoShare({ title, description: text || title, url, imageUrl })
```

`text`는 `"이집에서 두 단지를 비교해보세요"`였고 URL을 포함하지 않았다. 말풍선의
덩어리는 **URL 그 자체**였다. 그래도 §6이 지정한 문구로 맞췄고, 중복이 되살아나지
않도록 테스트로 고정했다.

## 2. 새 계약

```
/stats/compare?a=<aptSeqA>&b=<aptSeqB>
```

| 조합 | 이전 | 이후(현재 배포) | 이후(e-jip.com) | 감소 |
|---|---|---|---|---|
| 진흥목화 vs 송암파크빌 | 292자 | **77자** | 53자 | −74% |
| 해운대경동제이드 vs 대원아파트 | 303자 | **80자** | 56자 | −74% |
| 해운대역푸르지오더원 vs 해운대경동제이드 | 340자 | **81자** | **57자** | **−76%** |

```
https://e-jip.com/stats/compare?a=26350-2611&b=26350-2206
```

퍼센트 인코딩된 문자 **0개**. 쿼리 키는 `a`, `b` 둘뿐이다.

공유 URL에 넣지 않는 것: 단지명 · 법정동 · 구코드 · 인코딩된 한글 · 가격 ·
사용자 입력(§2/§11).

## 3. 수신 측 복원 구조

새 라우트 `src/app/stats/compare/page.tsx`(서버 컴포넌트). 정적 세그먼트가 동적
세그먼트보다 우선하므로 이 파일이 `/stats/[type]`에서 그 경로를 가져간다.

```
/stats/compare?a=26140-2&b=26140-118
  └ resolveCompareSeeds(prisma, { a, b })
      └ ApartmentMaster.findUnique({ aptSeq })     ← unique 키, 0건 아니면 1건
          └ { name, lawdCd, dong, aptSeq }
              └ <CompareV2 initialSeeds unresolvedAptSeqs />
```

- **이름으로 되짚지 않는다.** aptSeq는 unique 키이므로 되짚을 이유가 없다.
- 형태부터 aptSeq가 아닌 값은 DB에 묻지 않는다 —
  `isWellFormedAptSeq`(score identity 모듈)를 그대로 재사용한다.
- 해석되지 않으면 **비슷한 단지를 대신 보여주지 않는다.** 그 자리를 비우고
  "공유 링크의 단지 N곳을 찾지 못했습니다"라고 말한다(§3).
- 두 자리는 독립이다 — 한쪽이 실패해도 다른 쪽은 정상 표시된다.
- 주소·구코드가 비어 있는 master(예: `26440-329`)는 비교 조회를 구성할 수 없으므로
  억지로 채우지 않고 미해결로 둔다.

## 4. legacy 호환 (§5)

이미 뿌려진 긴 링크는 계속 열린다. `parseCompareUrl`이 `aName/aLawdCd/aDong/...`을
그대로 읽는다. 실측: legacy URL → **200**, 두 단지 정상 시드, 잘못된 "찾지 못했습니다"
안내 없음.

다만 **새로 만들지는 않는다.** 링크를 열면 내부 상태가 canonical로 정규화되고,
`router.replace`가 주소창을 짧은 형태로 바꾸며, 이후 공유는 짧은 링크가 나간다.

예외는 하나다: 검색 결과에 aptSeq가 없어 canonical identity를 얻지 못한 슬롯. 그
슬롯만 동반 파라미터를 유지한다 — 짧게 만들자고 **열리지 않는 링크**를 만들 수는 없다.

긴 URL을 만들던 다른 두 곳도 같은 빌더로 모았다.

| 위치 | 이전 | 이후 |
|---|---|---|
| `ai-search-client.tsx` (AI 검색 비교 진입) | 쿼리스트링 직접 조립 | `buildCompareUrl` |
| `decision-journey/registry.ts` (상세 → 비교) | `?aName=..&aLawdCd=..&aDong=..&aptSeq=..` | `?a=26140-1234` |

## 5. 공유 payload (§6)

| | 이전 | 이후 |
|---|---|---|
| title | `A vs B 비교` | `A vs B 비교 \| 이집` |
| text | `이집에서 두 단지를 비교해보세요` | `2개 단지 시세와 데이터를 비교해보세요.` |
| url | 주소창 URL 복사 + 파라미터 덧씌움 | **canonical 짧은 URL** |

`useSharePage`에 선택적 `url`을 더했다. 기본 동작(`params`)은 **현재 주소창을 그대로
복사**해 값을 덧씌우는 방식이라, 주소창에 복원용 파라미터가 붙는 화면에서는 그 쓰레기가
공유 링크에 딸려 간다. 자기만의 canonical 링크를 아는 화면은 그걸 그대로 준다.
다른 공유 호출부(통계 17종·지도·커뮤니티·AI 검색 등)는 `url`을 넘기지 않으므로
동작이 전혀 바뀌지 않는다.

## 6. OG 메타데이터 (§9)

`/stats/compare`의 `generateMetadata`가 `a`/`b`를 풀어 실제 단지명으로 만든다.
실측(로컬 프로덕션 빌드):

```
<title>해운대역푸르지오더원 vs 해운대경동제이드 | 이집</title>
og:title       해운대역푸르지오더원 vs 해운대경동제이드 | 이집
og:description 진흥목화와(과) 송암파크빌의 실거래가·이집점수·입지 데이터를 나란히 비교합니다.
og:url         .../stats/compare?a=26350-2611&b=26350-2206
og:image       기존 이집 공용 OG 이미지(buildOpenGraph 재사용, 새 아키텍처 없음)
alternates.canonical = 짧은 공유 URL
```

두 단지가 **모두** 확정됐을 때만 단지명을 제목에 쓴다. 한쪽만 알면 `단지 비교 | 이집`
— "OO vs (알 수 없음)" 같은 제목을 만들지 않는다(없는 aptSeq 실측으로 확인).

## 7. e-jip.com 준비 (§8)

공유 URL의 오리진은 `window.location`이 아니라 `siteConfig`(`absoluteUrl`)에서 나온다.
`SCORE`/`DOMAIN OG` STEP에서 만든 단일 출처를 그대로 쓴다.

```
현재 배포(환경변수 없음)     81자  https://real-estate-app-park11.vercel.app/stats/compare?a=..&b=..
NEXT_PUBLIC_SITE_URL 설정 후  57자  https://e-jip.com/stats/compare?a=..&b=..
```

컴포넌트에 호스트를 박지 않았고(테스트가 고정), 커토버 후 **재배포**하면 같은 코드가
e-jip.com 링크를 만든다.

## 8. 분석/프라이버시 (§11)

- 공유 URL에 자유 입력이 들어갈 자리가 없다 — 인자가 aptSeq 둘뿐이다.
- GA4 허용 파라미터는 `utm_*` 5개 그대로다. `a`/`b`는 GA4로 나가지 않는다
  (`sanitizeAnalyticsUrl`이 허용 목록 밖 쿼리를 전부 버린다). **분석 스키마 무변경.**
- 기존 공유 이벤트(`share_success` / `share_attempt`) 그대로.

## 9. 테스트 (§12)

`src/lib/compare-v2/url.test.ts` 21건.

| 항목 | 내용 |
|---|---|
| A | 유효한 aptSeq 둘 → 짧은 경로 / 하나라도 없으면 경로를 만들지 않음 |
| B·C | 쿼리 키가 `a`,`b`뿐 — 이름·동·구코드·legacy `aptSeq` 전부 없음 |
| D | 퍼센트 인코딩 문자 0개 |
| E | aptSeq → 이름·구·동 복원, a/b 순서 보존 |
| F | legacy 긴 URL 파싱 유지 / 짧은 URL에는 legacy 파서가 관여하지 않음 |
| G | `text`에 URL 없음, payload는 title/text/url 세 필드 |
| H | 오리진이 siteConfig에서 나옴(호스트 하드코딩 금지) |
| I | 없는 aptSeq·잘못된 형태 → 미해결(정직한 상태) |
| J | 주소 없는 master를 억지로 채우지 않음 |
| §10 | 길이가 이전의 4분의 1 미만 |

`registry.test.ts` 2건은 계약이 바뀐 만큼 새 계약으로 갱신했다(옛 형태를 고정하던
단언이라 그대로 두면 옛 URL을 되살리는 압력이 된다).

```
전체 src 테스트 : 769 / 769 PASS
```

## 10. 실측 QA (§13, 로컬 프로덕션 빌드)

| 케이스 | URL | 결과 |
|---|---|---|
| 같은 구 | `?a=26140-2&b=26140-118` | 200 · `진흥목화 vs 송암파크빌 \| 이집` |
| 다른 구 | `?a=26350-2206&b=26230-149` | 200 · `해운대경동제이드 vs 대원아파트 \| 이집` |
| 긴 한글 이름 | `?a=26350-2611&b=26350-2206` | 200 · `해운대역푸르지오더원 vs 해운대경동제이드 \| 이집` |
| 없는 aptSeq | `?a=26140-2&b=26140-99999` | 200 · 일반 제목 · "찾지 못했습니다" 안내 |
| legacy 긴 URL | `?aptSeq=..&aName=..&...` | 200 · 두 단지 정상 · 오탐 안내 없음 |

## 11. 알려진 한계

- **카카오톡 실기기 확인 미실시.** 브라우저/디바이스 도구가 승인돼 있지 않아 실제
  카카오톡 말풍선 렌더를 보지 못했다. 확인한 것은 **공유되는 URL 자체가 짧고
  인코딩된 한글이 0개이며, `text`에 URL이 섞이지 않는다**는 사실까지다.
  "카카오톡에서 이렇게 보인다"고 주장하지 않는다.
- **모바일 렌더 QA 미실시** — 같은 이유. 추가한 UI는 안내 문구 한 줄이다.
- aptSeq가 없는 슬롯이 섞이면 그 슬롯만 동반 파라미터가 남는다(§4). 부산 master는
  전부 aptSeq를 갖고 있어 실제로는 드물다.

## 12. 품질 (§14)

```
npx tsx --test "src/**/*.test.ts"   769 / 769 PASS
npx tsc --noEmit                    src 오류 0
                                    (scripts/ + tmp/ 14개 파일은 기존,
                                     FAIL_EXISTING_SCRIPT_ERRORS)
npx eslint <변경 파일>              오류 0
                                    (ai-search-client.tsx:183 경고 1건은 기존)
npm run build                       exit 0 · /stats/compare 라우트 등록 확인
```

## 13. 다음 STEP

1. 도메인 커토버(환경변수 + 재배포 + Kakao JS 키 도메인 등록 + OAuth 리디렉션 URI)
2. 실기기 카카오톡 공유 확인
3. `MASTER COVERAGE SYNC AUTOMATION` (승인 필요)
4. `SCHOOL SCORE MODEL REBASE V1` (기존 P1, 유지)
