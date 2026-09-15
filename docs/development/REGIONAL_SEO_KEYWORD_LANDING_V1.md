# E-JIP REGIONAL SEO KEYWORD & LANDING ARCHITECTURE V1

지역 × 검색의도 × 실제 데이터 기반 자연검색 구조. 부산 우선, 서울·경기 재사용.

- 날짜: 2026-09-16
- 기준 커밋: `b9daa17` (origin/main `05583bc` + 로컬 docs 1건)
- 범위: 메타데이터·H1·canonical·robots·sitemap·구조화 데이터·지역 내부 링크
- 하지 않은 것: DB/schema 변경, 아파트 식별 변경, 통계 계산 변경, 지도 코어·인증 변경, 새 route, 키워드별 thin 페이지 생성, Production push

---

## 1. 목적

메인 한 장만 검색되는 사이트에서, 실제 데이터를 서버에서 렌더하는 **지역 허브**(부산 → 구 → 동 → 단지)가 검색엔진에 발견되고
색인되도록 한다. 광고 없이 네이버·구글 자연검색 유입의 기반을 만든다.

## 2. 현재 상태 감사 (Production `e-jip.com`, 2026-09-16 실측)

### 2.1 페이지별 SEO 상태 (변경 전)

`curl`로 받은 서버 HTML 기준. H1/본문은 서버 HTML에 실제로 있는 것만 적었다.

| route | title | description | canonical | robots | H1 (서버 HTML) | 서버 콘텐츠 깊이 | sitemap |
|---|---|---|---|---|---|---|---|
| `/` | 이집 - AI 부동산 검색 | 언제 어디서나 쉽게 부산 아파트 실거래가와 현장 팁… | 없음 | 기본 | 없음 | 얇음(메뉴·링크, 본문 ~150자) | O |
| `/stats` | 전국 시장 통계·분석 - 이집 | 전국 아파트 거래량, 갭투자… | 없음 | 기본 | 시장 통계·분석 | 메뉴 목록(클라이언트 화면) | O |
| `/stats?sido=부산광역시&sigungu=서구` | 부산광역시 서구 시장 통계·분석 - 이집 | 부산광역시 서구 아파트 거래량… | 없음 | 기본 | 시장 통계·분석 | **지역 무관 동일 HTML**("부산광역시 전체") | O (16개) |
| `/school?sido=…&sigungu=…` | 부산광역시 ○구 학군정보 | … | 없음 | 기본 | 학군 정보 | "총 0개교"(클라이언트 로딩 전) | O (16개) |
| `/stats/[type]` | 📊 거래량 - 이집 등 | 메뉴 부제 | 없음 | 기본 | 메뉴명 | 클라이언트 화면 | X |
| `/report` | 한장 리포트 - 이집 | 부산 부동산을 한 장으로… | 없음 | 기본 | 한장 리포트 | 허브(16개 구 링크) | X |
| `/report/city/busan` | 부산광역시 부동산 한장 브리핑 - 이집 | …구별 분포… | 없음 | 기본 | 부산광역시 부동산 한장 브리핑 | **실데이터 SSR**(KPI·거래 많은 단지·최근 실거래·구별 분포·2년 최고가·해석) | X |
| `/report/district/[lawdCd]` | 부산 서구 부동산 한장 브리핑 - 이집 | …동별 분포… | 없음 | 기본 | 부산 서구 부동산 한장 브리핑 | **실데이터 SSR** | X |
| `/report/dong/[lawdCd]/[dong]` | 부산 서구 암남동 부동산 한장 브리핑 - 이집 | … | 없음 | 기본 | 부산 서구 암남동 부동산 한장 브리핑 | **실데이터 SSR** | X |
| `/apt/[name]?lawdCd&dong&aptSeq` | {단지} 실거래가·시세 - 이집 | … | 없음 | 기본 | 단지명(클라이언트) | 클라이언트 화면 | X |
| `/report/apt/[aptSeq]` | {단지} 단지 리포트 - 이집 | … | 없음 | 기본 | 리포트 제목 | 실데이터 SSR | X |
| `/community` | **이집** (루트 기본값) | 루트 기본값 | 없음 | 기본 | 커뮤니티 | "불러오는 중" | O |
| `/community/[id]` | {글} - 이집 커뮤니티 | 본문 파생 | self | 기본 | 글 제목 | SSR | O |
| `/map` | **이집** (루트 기본값) | 루트 기본값 | 없음 | 기본 | 없음 | 지도 앱 | X |
| `/stats/compare` | 단지 비교 \| 이집 | … | 공유 경로 | 기본 | 단지 비교 | 클라이언트 | X |
| `/report/compare` | 단지 비교 한장 리포트 - 이집 | … | 없음 | 기본 | — | 조합별 | X |
| `/my` | **이집** | 루트 기본값 | 없음 | 기본(robots.txt Disallow) | MY | 사용자별 | X |
| `/feedback` | 의견 보내기 | 루트 기본값 | 없음 | noindex,nofollow | — | 폼 | X |
| `/admin/*` | 루트 기본값 | — | 없음 | 기본(robots.txt Disallow) | — | 관리자 | X |

공통 결함:

1. **canonical이 거의 없다.** 커뮤니티 글·비교 공유 외 전부 없음. `?period=`, `?sido=&sigungu=` 변형이 각자 별개 URL로 남는다.
2. **og:url이 모든 페이지에서 사이트 루트**(`buildOpenGraph`가 `siteConfig.url` 고정). 공유 카드·크롤러가 페이지를 구분할 신호가 약하다.
3. **사이트맵이 실제 지역 콘텐츠를 싣지 않는다.** 37개 중 32개가 지역 쿼리 변형(`/stats?…`, `/school?…`)인데 서버 HTML은 지역과 무관하고,
   정작 실거래 데이터를 SSR하는 지역 한장 브리핑(`/report/city|district|dong`)은 하나도 없다.
4. 구조화 데이터(JSON-LD) 0건.
5. `/map`, `/community`, `/my`가 홈과 같은 제목("이집")을 쓴다.
6. 기본 제목의 "전국"(`/stats`, `/school`)은 데이터 범위(부산 우선)와 맞지 않는다.

메타데이터 스트리밍: Next 16은 JS 실행 봇에는 메타데이터를 body로 스트리밍할 수 있지만, 네이버 **Yeti**는 Next의
HTML-limited bot 목록(`node_modules/next/dist/shared/lib/router/utils/html-bots.js`)에 포함돼 `<head>`에 그대로 받는다.
QA에서 Yeti UA·Chrome UA 모두 `<head>` 안 태그를 확인했다(§11).

### 2.2 "e-jip.com · e-jip.com" 중복 표시 감사

네이버 검색결과에 사이트 이름 자리와 URL 자리가 모두 도메인으로 나오는 현상. **추측으로 고치지 않고** 소스 기준으로 분류한다.

| 신호 | 변경 전 소스 | 판단 |
|---|---|---|
| WebSite 구조화 데이터 | **없음** | 가능성 높음(코드). Google 문서는 "WebSite 구조화 데이터의 `name`이 사이트 이름에 가장 중요하고 홈페이지에 있어야 한다"고 명시. 네이버의 결정 방식은 공개 문서로 확인하지 못함(searchadvisor 문서 접근 불가) |
| Organization 구조화 데이터 | 없음 | 보조 신호 |
| `og:site_name` | `이집` (정상) | 원인 아님 |
| `application-name` | 없음 | 약한 보조 신호 |
| 홈 `<title>` | `이집 - AI 부동산 검색` | 브랜드 포함, 원인 가능성 낮음 |
| 홈 canonical | 없음 | 약한 보조 신호 |
| 홈 H1 | 없음(서버 HTML) | 보조 신호 — 이번 범위에서 변경하지 않음(§14) |
| 신규 도메인 색인·브랜드 학습 | — | **시간 문제 가능성**. 코드로 해결되지 않음 |

조치: 홈에 `WebSite`(name `이집`, alternateName `E-JIP`, `이집(E-JIP)`)·`Organization` JSON-LD, `application-name`, 홈 self canonical 추가.
**반영 여부는 네이버 재수집 후에만 확인할 수 있다** — 코드 변경만으로 해결됐다고 판단하지 않는다. 서치어드바이저의 사이트 설정(사이트 이름)도
함께 확인하는 것을 권장한다(외부 콘솔 작업, 사용자 몫).

## 3. 메인 메타데이터 (사용자 확정값)

단일 출처: `src/lib/seo/site-seo.ts`

- title: `이집(E-JIP) - 아파트 실거래가·거래량·학군·부동산 데이터`
- description: `복잡한 부동산, 이집으로 쉽게. 아파트 실거래가부터 거래량, 학군, 교통, 단지 비교까지 한눈에 확인하세요.`
- og:title / og:description / twitter:title / twitter:description: 위와 동일, og:url = 홈
- og:site_name · application-name · WebSite.name · Organization.name: `이집`
- `siteConfig.description`도 같은 값(루트 기본 description, `/ai-search` 기본값이 따라감)

twitter 제목은 루트 layout에 두지 않고 홈이 명시한다 — 루트에 두면 자기 twitter를 선언하지 않는 모든 화면이 메인 제목을 싣는다
(QA에서 실제로 확인 후 수정). 루트 twitter에는 card·이미지만 남아 다른 화면은 자기 og:title로 떨어진다.

## 4. 검색 의도 모델과 데이터 가용성

검색량 수치는 **없다.** 월간 검색량은 Naver 검색광고 키워드 도구 / 서치어드바이저 데이터가 필요하다(외부 데이터 필요 항목). 아래는
"많이 검색된다"는 판단이 아니라 **데이터·route 가용성** 판단이다.

| # | intent | 이집 실제 데이터 | 충족 route | 서버 렌더 | 지원 단위 | 별도 landing |
|---|---|---|---|---|---|---|
| 1 | 아파트 시세 | 실거래 중앙 거래가·㎡당 중앙가 | `/report/*` 지역 브리핑 | O | 부산·구·동 | 불필요 — 지역 허브에서 충족 |
| 2 | 아파트 실거래가 | 최근 실거래 목록(MOLIT, 취소 제외) | `/report/*`, `/apt/*`, `/stats/feed` | 리포트 O | 부산·구·동·단지 | 불필요 |
| 3 | 아파트 매매 | 매매 실거래 | `/report/*` | O | 부산·구·동 | 불필요(시세·실거래가와 같은 데이터) |
| 4 | 아파트 전세 | 단지 상세 전월세, `/stats/volume` 전월세 거래량, `/stats/jeonse-risk` | 클라이언트 화면 | X | 단지/지역(클라이언트) | 현 시점 불가 — 지역 리포트에 전세 섹션 없음. 제목/설명에 넣지 않음 |
| 5 | 아파트 월세 | 동일 | 동일 | X | 동일 | 동일 |
| 6 | 아파트 거래량 | 기간 거래건수·직전 동일기간 대비 | `/report/city`, `/report/district` | O | 부산·구 (동은 건수만) | 불필요 |
| 7 | 최근 실거래가 | 최근 실거래 | `/report/*` | O | 부산·구·동 | 불필요 |
| 8 | 평당가 | **㎡당 중앙가만 있음** | `/report/*` | O | — | 불가 — `exclusiveArea / 3.3058` 평 환산은 금지 규칙. "평당가" 문구 사용 안 함 |
| 9 | 전세가율 | `/stats` 설명에 언급, 지역 SSR 없음 | 클라이언트 | X | 확인 필요 | 보류 |
| 10 | 갭 / 갭투자 | `/stats/gap-invest` | 클라이언트 | X | 부산 전체·구 | 보류(클라이언트 화면) |
| 11 | 신고가 | "최근 2년 최고 거래가" 하이라이트, `/stats/record-high` | 리포트 O / 통계 X | 부분 | 부산·구·동 | 불가 — "역대 신고가" 표현 금지 규칙. 제목에 넣지 않음 |
| 12 | 상승 | `/stats/rising` | 클라이언트 | X | — | 보류 |
| 13 | 하락 | `/stats/decline` | 클라이언트 | X | — | 보류 |
| 14 | 84㎡ | `/stats/area84` | 클라이언트 | X | — | 보류 |
| 15 | 학군 | `/school`, 단지 상세 학군 | 클라이언트 | X | — | 보류 |
| 16 | 신축 | 지도 NEW_BUILD 마커 | 지도 | X | — | 불가(랜딩 데이터 없음) |
| 17 | 대단지 | `/stats/large-complex`(부산) | 클라이언트 | X | 부산 | 보류 |
| 18 | 분양 | `/presales`, `/redevelopment` | SSR 일부 | 부분 | 전국 분양 | 이번 범위 밖 |

"보류" = 데이터는 있지만 서버 HTML에 지역 내용이 없어 지금 지역 랜딩으로 내놓으면 thin page가 된다. 서버 렌더 지역 섹션이 생긴 뒤 재평가.

## 5. 핵심 규칙 — 키워드마다 페이지를 만들지 않는다

"부산 서구 아파트 시세 / 실거래가 / 매매 / 거래량"은 **같은 데이터**(서구 매매 실거래 집계)다. 한 개의 지역 허브
`/report/district/26140`이 함께 충족한다. 새 route는 만들지 않았다(§10 설계 결정).

## 6. 지역 허브 아키텍처

```
/                          (WebSite·Organization)
└─ /report                 리포트 허브 (16개 구 링크)
   └─ /report/city/busan   부산 아파트 시세·실거래가·거래량      ── 16개 구 링크 + 구별 분포 행 링크
      └─ /report/district/{lawdCd}  부산 {구} 아파트 시세·실거래가·거래량 ── 색인 대상 동 링크 + 동별 분포 행 링크
         └─ /report/dong/{lawdCd}/{dong}  부산 {구} {동} 아파트 시세·실거래가
            └─ /apt/{name}?lawdCd&dong&aptSeq  (거래 많은 단지·최근 실거래 행, canonical 식별 링크 — 기존)
```

모든 지역 페이지 상단에 `이집 › 부산 › 서구 › 암남동` 경로(`nav`, 링크 36px)와 `BreadcrumbList` JSON-LD.
경로·하위 지역 링크는 **공유 이미지/PDF 루트(`data-export-root`) 바깥**이고 인쇄에서 숨긴다.

## 7. 메타데이터 템플릿

코드: `src/lib/seo/region-seo.ts`(범용, 부산 없음) + `src/lib/seo/report-region-seo.ts`(부산 리포트 어댑터)

```ts
buildRegionSeoMetadata({ level, region: { sido, city?, district?, dong? }, availableData })
  → { name, title, description, heading } | null
```

### 7.1 이름
- 시도는 표(`SIDO_SHORT_LABELS`, 17개)로만 줄인다: 부산광역시→부산, 서울특별시→서울, 경기도→경기 …
- 모르는 시도·빈 조각·마크업 문자·20자 초과 → `null` (이름을 지어내지 않음)
- 광역시: `시도 + 구`, 경기: `시도 + 시 + 구`, 구 없는 시: `시도 + 시`

### 7.2 title
| level | 후보(긴 것 → 짧은 것) | 상한 |
|---|---|---|
| CITY / DISTRICT | `{name} 아파트 시세·실거래가·거래량 \| 이집` → `{name} 아파트 시세·실거래가 \| 이집` | 32자 |
| DONG | `{name} 아파트 시세·실거래가 \| 이집` | 32자 |

상한을 넘으면 보조 키워드(거래량)부터 뺀다. 32자는 공식 수치가 아니라 보수적 기준(네이버·구글 모두 글자 수 미공개).
사용자 예시의 "매매·전세"는 **지역 리포트에 전세 데이터가 없어** 제목에서 뺐다. "매매"는 설명에 들어간다.

### 7.3 description — 실제 섹션에서만 생성
`{name} 아파트 매매 시세를 국토교통부 실거래가로 확인하세요. {섹션 목록}를 한 장에 정리했습니다.`

| 섹션 플래그 | 문구 | CITY | DISTRICT | DONG |
|---|---|---|---|---|
| recentTrades | 최근 실거래 | O | O | O |
| medianPrice | 중앙 거래가·㎡당 가격 | O | O | O |
| tradeCountDelta / tradeCount | 거래량 변화 / 거래건수 | 변화 | 변화 | 건수(동 KPI에 증감률 카드 없음) |
| topComplexes | 거래가 많은 단지 | O | O | O |
| subRegionDistribution | 구·군별 / 동별 거래 분포 | 구·군별 | 동별 | — |
| twoYearHigh | 최근 2년 최고 거래가 | O | O | O |

전세·월세·학군·분양·갭·신고가는 넣지 않는다(테스트로 고정).

### 7.4 H1
`{name} 아파트 시세·실거래가` — 페이지당 하나(`ReportHeader`). 공유/카카오 카드 제목은 기존 `{지역} 부동산 한장 브리핑` 유지.
H1이 바뀌어도 진입 CTA와 같은 제품 이름이 보이도록 태그 첫 칸을 `한장 브리핑`으로 표시.

## 8. 부산 예시 (로컬 프로덕션 빌드 실측)

| URL | title | H1 | robots |
|---|---|---|---|
| `/report/city/busan` | 부산 아파트 시세·실거래가·거래량 \| 이집 | 부산 아파트 시세·실거래가 | index |
| `/report/district/26140` | 부산 서구 아파트 시세·실거래가·거래량 \| 이집 | 부산 서구 아파트 시세·실거래가 | index |
| `/report/district/26380` | 부산 사하구 아파트 시세·실거래가·거래량 \| 이집 | 부산 사하구 아파트 시세·실거래가 | index |
| `/report/district/26350` | 부산 해운대구 아파트 시세·실거래가·거래량 \| 이집 | 부산 해운대구 아파트 시세·실거래가 | index |
| `/report/dong/26140/암남동` | 부산 서구 암남동 아파트 시세·실거래가 \| 이집 | 부산 서구 암남동 아파트 시세·실거래가 | index |
| `/report/dong/26380/괴정동` | 부산 사하구 괴정동 아파트 시세·실거래가 \| 이집 | 동일 패턴 | index |
| `/report/dong/26350/우동` | 부산 해운대구 우동 아파트 시세·실거래가 \| 이집 | 동일 패턴 | index |
| `/report/dong/26710/기장읍 교리` | 부산 기장군 기장읍 교리 아파트 시세·실거래가 \| 이집 | 동일 패턴 | index |
| `/report/dong/26140/아미동2가` (1년 6건) | 부산 서구 아미동2가 아파트 시세·실거래가 \| 이집 | 동일 패턴 | **noindex, follow** |
| `/report/dong/26140/가짜동` | 지역 리포트 \| 이집 | (기존 시트 제목) | **noindex, follow**, canonical 없음 |
| `/report/district/11680` | 지역 리포트 \| 이집 | InvalidScope | **noindex, follow**, canonical 없음 |

서구 description 예:
`부산 서구 아파트 매매 시세를 국토교통부 실거래가로 확인하세요. 최근 실거래, 중앙 거래가·㎡당 가격, 거래량 변화, 거래가 많은 단지, 동별 거래 분포, 최근 2년 최고 거래가를 한 장에 정리했습니다.`

## 9. 동 SEO

- 동 이름은 `apartment_trade_histories`의 **실제 dong 값**(부산 16개 lawdCd, 취소 제외, 최근 1년)에서 확인될 때만 제목에 쓴다.
- 색인 기준: 최근 1년 거래 ≥ 10건 = 리포트 표본 게이트 `MIN_SAMPLE_FOR_INTERPRETATION`(같은 값을 재사용, 테스트로 고정).
- 조회: `src/lib/seo/region-seo-read.ts` — `groupBy(lawdCd, dong)` 1회, 인스턴스 메모리 6시간 캐시. **실패는 캐시하지 않고 null**
  → 동 페이지는 일반 제목+noindex, 사이트맵은 동만 빠짐, 구 페이지는 동 링크 목록만 빠짐(리포트 본문은 그대로).
- 사이트맵·동 페이지 robots·구 페이지 동 링크가 **같은 판정 함수**(`indexableDongs`)를 쓴다.

읽기 전용 DB 실측(2026-09-16, 부산 16개 lawdCd): 전체 기간 동 158개 · 최근 1년 거래 있음 148 · **1년 10건 이상 116** · 5건 이상 133 · 최근 30일 113.

## 10. 설계 결정

1. **새 route를 만들지 않는다.** 지역 한장 브리핑이 이미 실데이터를 SSR한다. 부족한 것은 메타데이터·canonical·사이트맵·링크였다.
2. **지역 검색 랜딩은 `/report/*`**, `/stats?sido=`·`/school?sido=`는 공유용 상태 복원 쿼리로 보고 canonical을 `/stats`·`/school`로 모은다.
3. **사이트맵에서 쿼리 변형 32개 제거.** canonical이 아닌 URL을 사이트맵에 두면 신호가 충돌한다. BUSAN_LAUNCH_SCOPE_SITEMAP_FIX_V1의
   "부산 범위만" 원칙은 유지(범위 판정 단일 출처 `BUSAN_DISTRICTS`), 경로 종류만 바꾼다.
4. 동 색인 기준은 새로 만들지 않고 리포트 표본 게이트를 재사용.
5. 구조화 데이터는 WebSite·Organization(홈), BreadcrumbList(지역)만. 가격·평점·Offer 등은 넣지 않는다.
6. 공유/내보내기 제목·이미지 구성은 바꾸지 않는다(경로·하위 링크는 export root 밖).

## 11. canonical 규칙

| 페이지 | canonical |
|---|---|
| `/` | `/` |
| 지역 브리핑 | `/report/city/busan`, `/report/district/{lawdCd}`, `/report/dong/{lawdCd}/{encodeURIComponent(dong)}` — `?period=` 무시 |
| 잘못된 지역/미확인 동 | 없음(+noindex) |
| `/report` | `/report` |
| `/stats`(모든 `?sido=&sigungu=`) | `/stats` |
| `/stats/[type]` | `/stats/{type}` |
| `/school`(모든 지역 쿼리) | `/school` |
| `/map`(모든 위치·단지 쿼리) | `/map` |
| `/community` | `/community` (글쓰기·수정은 `canonical: null`로 상속 차단) |
| `/community/[id]` | 기존 self canonical 유지 |
| `/apt/[name]` | lawdCd+dong+aptSeq가 **모두 있을 때만** `aptDetailHref()` 정규화 경로(부가 쿼리 제거). 이름만 있는 주소는 canonical 없음(기존 동작) |
| `/report/apt/[aptSeq]` | 단지 마스터에서 확인되면 `/report/apt/{aptSeq}`, 아니면 없음(+noindex) |
| `/stats/compare` | 기존 공유 canonical 유지 |

og:url은 `buildOpenGraph({ path })`로 canonical과 같게 맞췄다(경로를 넘기지 않는 화면은 기존처럼 루트).

## 12. index / noindex 규칙

| 대상 | 결정 | 변경 |
|---|---|---|
| 메인, 부산 전체·16개 구 브리핑 | index | canonical 추가 |
| 동 브리핑(1년 ≥10건) | index | 신규 판정 |
| 동 브리핑(1~9건) | noindex, follow | 신규 |
| 미확인 동 / 부산 밖 lawdCd | noindex, follow | 신규 |
| `/report/apt/[aptSeq]` 마스터 미확인 | noindex, follow | 신규 |
| `/stats/[type]` 준비 중(`status: 'soon'`) | noindex, follow | 신규 |
| `/stats/compare` 두 단지 담긴 상태 | noindex, follow | 신규(빈 도구 화면은 index 유지) |
| `/report/compare` | noindex, follow | 신규 |
| `/ai-search` | noindex, follow | 신규(진입점 닫힌 기능 + `?q=` 결과) |
| `/my`, `/admin/*`, `/community/write`, `/community/[id]/edit` | noindex, nofollow | 신규(메타데이터 전용 layout) |
| `/feedback` | noindex, nofollow | 기존 유지 |
| robots.txt | 변경 없음 | — |

## 13. 사이트맵 전략

| 구분 | 변경 전 | 변경 후 |
|---|---|---|
| 정적 | `/`, `/stats`, `/school`, `/community` (4) | + `/report` (5) |
| 지역 쿼리 변형 | `/stats?sido&sigungu` 16 + `/school?…` 16 = **32** | **0** |
| 부산 전체 브리핑 | 0 | 1 |
| 구 브리핑 | 0 | 16 |
| 동 브리핑 | 0 | 116 (DB 실측, 1년 ≥10건) |
| 커뮤니티 글 | 1 | 1 |
| **합계** | **37** (Production 실측) | **139** (로컬 빌드 실측, 중복 0, 쿼리 URL 0) |

- 사이트맵 지역 URL = 각 페이지 canonical (표본 10개 실측 일치 + 테스트).
- IndexNow 안전핀(`findOutOfScopeRegionUrls`)이 `/report/district|dong/{lawdCd}`의 부산 밖 코드도 잡도록 확장.
- 동 수는 데이터에 따라 달라진다(거래가 늘거나 줄면 동이 들어오거나 빠짐). 1년 창이라 일별 변동은 작다.

## 14. 내부 링크

- 부산 전체 → 16개 구(하위 지역 칩) + 구·군별 분포 행 이름 링크
- 구 → 색인 대상 동(칩) + 동별 분포 행 이름 링크(분포 상위 8곳; 표본 미달 동도 실제 거래가 있어 링크하되 robots가 색인을 정함)
- 동 → 경로(`이집 › 부산 › 구`)
- 구·동 → 단지: 기존 canonical 식별 링크(`aptDetailHref`) 그대로
- 리포트 허브 → 16개 구(기존)

## 15. 구조화 데이터

- 홈: `WebSite`(name/alternateName/url/inLanguage), `Organization`(name/alternateName/url/logo)
- 지역 브리핑: `BreadcrumbList`
- 직렬화: Next 16 JSON-LD 가이드대로 `<` → `<` 이스케이프

## 16. 네이버 준비 상태

| 항목 | 상태 |
|---|---|
| 페이지별 고유 title | 지역·지도·커뮤니티 목록 분리 완료. 통계 메뉴는 기존 제목(이모지 포함) 유지 — 권장 사항 §19 |
| 의미 있는 description | 지역 페이지는 실제 섹션에서 생성 |
| 사이트 이름 일관성 | og:site_name·application-name·WebSite·Organization = 이집 |
| canonical | §11 |
| 서버 렌더 콘텐츠 | 지역 브리핑 SSR, Yeti UA로 head 메타·H1·본문·링크 확인 |
| sitemap / robots | §13, robots 변경 없음 |
| 소유확인 | 기존 유지(네이버·Yandex) |

코드 문제와 시간 문제의 분리: 브랜드 검색("이집") 약세와 사이트 이름 표시는 재수집·브랜드 학습 시간이 필요하다. 배포 후 서치어드바이저에서
사이트맵 재제출·수집 요청·사이트 이름 설정을 확인한다(외부 콘솔, 사용자 몫).

## 17. 키워드 매핑 (template + intent matrix)

구마다 제목을 적지 않는다. `{R}` = 템플릿이 만든 지역 이름(예: `부산 서구`).

| 키워드 군 | 예 | 사용자 의도 | route | 실제 데이터 | 색인 결정 |
|---|---|---|---|---|---|
| Primary | {R} 아파트 시세 · {R} 아파트 실거래가 | 지역 가격 수준·최근 거래 확인 | `/report/district/{lawdCd}` | 중앙 거래가·㎡당 가격·최근 실거래 | index(title·H1에 포함) |
| Supporting | {R} 아파트 매매 | 매매 거래 확인 | 같은 페이지 | 매매 실거래 | 같은 페이지(description) |
| Supporting | {R} 아파트 거래량 | 거래 활발도 | 같은 페이지 | 기간 건수·직전 대비 | 같은 페이지(title) |
| Supporting | {R} 아파트 전세 / 월세 | 전월세 가격 | 없음(지역 SSR 없음) | 단지 상세·통계 클라이언트 | 랜딩 없음 — 데이터 섹션 추가 후 재평가 |
| Specialized | {R} 아파트 신고가 | 최고가 경신 | 같은 페이지 하이라이트 / `/stats/record-high` | "최근 2년 최고 거래가"만 | 제목 사용 안 함("역대 신고가" 금지) |
| Specialized | {R} 아파트 갭 | 갭투자 | `/stats/gap-invest`(클라이언트) | 있음(클라이언트) | 지역 랜딩 없음 |
| Specialized | {R} 84㎡ 아파트 시세 | 국민평형 가격 | `/stats/area84`(클라이언트) | 있음(클라이언트) | 지역 랜딩 없음 |
| Dong | {R} {동} 아파트 시세 · 실거래가 | 동네 가격 | `/report/dong/{lawdCd}/{dong}` | 동 실거래 | 1년 ≥10건만 index |
| Complex | {단지} 실거래가·시세 | 단지 가격 | `/apt/{name}?lawdCd&dong&aptSeq` | 단지 실거래 | 식별 완전 시 canonical(사이트맵 미포함 — 권장 §19) |

부산 16개 구 적용: `BUSAN_DISTRICTS`(중구·서구·동구·영도구·부산진구·동래구·남구·북구·해운대구·사하구·금정구·강서구·연제구·수영구·사상구·기장군)
전부 같은 템플릿으로 생성·색인. 구별 색인 동 수: 중구 5 · 서구 14 · 동구 4 · 영도구 9 · 부산진구 11 · 동래구 9 · 남구 6 · 북구 5 ·
해운대구 7 · 사하구 8 · 금정구 7 · 강서구 3 · 연제구 2 · 수영구 5 · 사상구 7 · 기장군 14 (= 116, 2026-09-16).

## 18. 서울·경기 확장 규칙

템플릿은 이미 처리한다(테스트 14·15):

| 입력 | name | title |
|---|---|---|
| `{ sido: '서울특별시', district: '강남구' }` | 서울 강남구 | 서울 강남구 아파트 시세·실거래가·거래량 \| 이집 |
| `{ sido: '서울특별시', district: '송파구' }` | 서울 송파구 | … |
| `{ sido: '서울특별시', district: '마포구' }` | 서울 마포구 | … |
| `{ sido: '경기도', city: '성남시', district: '분당구' }` | 경기 성남시 분당구 | 경기 성남시 분당구 아파트 시세·실거래가·거래량 \| 이집 |
| `{ sido: '경기도', city: '수원시', district: '영통구' }` | 경기 수원시 영통구 | … |
| `{ sido: '경기도', city: '고양시', district: '일산서구' }` | 경기 고양시 일산서구 | 경기 고양시 일산서구 아파트 시세·실거래가·거래량 \| 이집 (32자) |
| `{ sido: '경상남도', city: '창원시', district: '마산합포구' }` | 경남 창원시 마산합포구 | 경남 창원시 마산합포구 아파트 시세·실거래가 \| 이집 (상한 초과 → 축약) |

확장 시 필요한 것(이번 STEP에서 하지 않음):
1. 해당 지역 **데이터 신뢰 기준 통과**(실거래 수집·커버리지). 데이터 없이 사이트맵부터 열지 않는다.
2. 지역 리포트 스코프 확장 — 현재 `region-scope`는 의도적으로 부산 전용 allowlist다. 시도별 검증 목록과 경로 체계(예: 시도 세그먼트) 설계는 별도 승인 STEP.
3. `report-region-seo.ts`와 같은 어댑터를 시도별로(또는 시도 인자로) 추가하고 `buildRegionSeoMetadata`에 이름만 넘긴다.
4. IndexNow 안전핀·사이트맵 범위를 의도적으로 연다.

## 19. 알려진 한계 / 권장 후속

- **미확인 동의 본문 H1**: `/report/dong/26140/가짜동`은 메타데이터가 일반 제목+noindex지만, 본문 시트는 기존대로 URL의 동 이름으로
  "부산 서구 가짜동 부동산 한장 브리핑"(0건)을 렌더한다. 라우팅 동작 변경(InvalidScope 전환)은 범위 밖이라 두었다 — 후속 권장.
- 홈 서버 HTML에 H1 없음 — 홈 UI 변경이라 이번에 하지 않음. 권장.
- `/stats/[type]` 제목의 이모지(`📊 거래량 - 이집`) — SERP 표시 품질상 제거 권장.
- 전세·월세 지역 데이터: 지역 리포트에 전월세 섹션이 생기면 제목/설명 템플릿의 availableData에 플래그만 추가.
- 단지 상세(`/apt/*`)는 사이트맵에 없다 — 식별 완전 URL만 싣는 단지 사이트맵은 후속(수만 URL, 분할 사이트맵 필요).
- `/report/daily/[date]` 색인 정책 미결정(변경 없음).
- 분포 행 이름 링크는 행 높이 그대로라 터치 영역이 작다(칩 링크 36px로 보완). 필요 시 후속.
- 동 판정 캐시는 인스턴스 메모리(6시간). 인스턴스마다 첫 요청에 groupBy 1회(로컬 실측 ~0.5s 사이트맵 전체 응답).
- 사이트 이름 중복 표시 해소는 재수집 후에만 확인 가능.
- 검색량 데이터 없음 — 우선순위 판단에는 Naver 키워드 도구 필요.

## 20. 테스트 결과 (실행한 명령과 실제 결과)

```
npx tsx --test src/lib/seo/regional-seo.test.ts                      22/22 pass
npx tsx --test src/lib/sitemap-scope.test.ts src/lib/indexnow/indexnow.test.ts   49/49 pass
npx tsx --test <src 전체 153 파일>                                    2141/2141 pass (기준선 2115/2115)
npx tsc --noEmit                                                     FAIL_EXISTING_SCRIPT_ERRORS — scripts/ 21·tmp/ 4, src 0
npx eslint <변경 src 파일 34개>                                        exit 0
npm run lint                                                         exit 1 — 기존 .worktrees/(gitignore)·scripts·prisma 및 변경하지 않은 src 5파일 경고, 변경 파일 0
npm run build                                                        exit 0
```

신규/변경 테스트: `regional-seo.test.ts`(요구 1~18 전부 + 구조화 데이터 이스케이프·순수 모듈 검사), `sitemap-scope.test.ts`(지역 경로 종류 변경 반영),
`indexnow.test.ts`(17개 + 리포트 경로 안전핀), `map-entry-context.test.ts`(지도 layout의 `/map` 문자열을 "진입점 아님: SEO canonical"로 분류).

### 로컬 프로덕션 빌드 QA (`next start -p 3100`)

- Yeti UA / Chrome UA 모두: 메인 title·description·og·twitter, WebSite/Organization JSON-LD / 구 3곳·동 4곳 title·canonical·robots·og:url·H1·BreadcrumbList·경로·하위 링크 / `?period=90` canonical = 깨끗한 경로 / 미확인 동·부산 밖 코드 noindex·canonical 없음 / `/stats?sido&sigungu` canonical `/stats` / `/map`·`/community`·`/report`·`/school` self canonical / `/my`·`/community/write`·`/feedback` noindex,nofollow / `/report/compare`·`/ai-search?q=` noindex,follow (`/admin/dashboard`는 기존 307 리다이렉트)
- `/stats/population`(준비 중) noindex,follow + canonical, `/stats/volume` canonical·index 유지
- `sitemap.xml` 200(0.5s) 139 URL, 중복 0, 쿼리 URL 0, 표본 10개 URL 200·index·canonical 일치
- `robots.txt` 변경 없음
- 모바일 360/375/390px(같은 출처 iframe 실측): 부산·서구·암남동·기장읍 교리 — 가로 넘침 0, 경로 링크 36px, 동 칩 36px,
  하단 액션바가 동 링크 목록을 가리지 않음(목록 하단 669px < 액션바 728px), 동 H1 2줄. 375px 스크린샷 확인.
- 로컬 오리진은 `http://localhost:3000`(NEXT_PUBLIC_SITE_URL 미설정) — Production은 siteConfig 규칙대로 `https://e-jip.com`.

## 21. 영향 받는 기존 기능

- 지역 브리핑 **공유 이미지/PDF의 헤더 H1 문구**가 `부산 서구 부동산 한장 브리핑` → `부산 서구 아파트 시세·실거래가`로 바뀐다(태그 `한장 브리핑`).
  카카오/네이티브 공유 제목은 그대로.
- 사이트맵에서 `/stats?…`·`/school?…` 32개가 빠진다(접근은 그대로). 이미 색인된 쿼리 URL은 canonical로 `/stats`·`/school`에 모인다.
- `/stats`, `/school` 기본 제목에서 "전국" 제거.
- 매니페스트 description은 변경 없음(`manifest.ts` 고정 문구).

## 22. 롤아웃 계획

1. (이번) 로컬 구현·검증 → 로컬 commit → **READY_FOR_PRODUCTION_APPROVAL**. push 하지 않음.
2. 승인 후 push(= Vercel Production 배포). 배포 후 Production 실측: 메인·구 3·동 3 view-source, sitemap 개수, robots.
3. 네이버 서치어드바이저: 사이트맵 재제출, 주요 지역 URL 수집 요청, 사이트 이름 설정 확인. Google Search Console 동일.
4. IndexNow 제출(`npm run indexnow:submit-sitemap`) — 안전핀이 부산 밖 URL을 차단.
5. 2~4주 후 색인 수·검색 노출(서치어드바이저/Search Console) 확인 → 전세·월세 지역 섹션, 단지 사이트맵 우선순위 재평가.

## 23. 다음 STEP 제안

- REGIONAL_SEO V1 Production 적용·색인 모니터링
- 미확인 동 리포트 본문 처리(InvalidScope) — 라우팅 변경이라 승인 필요
- 지역 리포트 전월세 섹션(데이터 신뢰 기준 확인 후) → 전세/월세 의도 충족
- 단지 상세 사이트맵(식별 완전 URL, 분할)

---

## 24. Production 적용 (2026-09-16 KST)

판정: **PASS** — 중단 규칙(지역 식별 오류·가짜 지역 색인·canonical 오류 확산·sitemap 파손·5xx·리포트 식별 회귀) 해당 없음.
새 SEO 기능·라우팅 변경 없음. 아래 §24.9에 P2 후속 1건.

### 24.1 배포

```
push 전 검증   SEO 관련 테스트 80/80, src 2141/2141, 변경 파일 eslint exit 0, tsc src 0(scripts 21·tmp 4 기존), build exit 0
push          05583bc..9299b36 main (b9daa17 docs 포함) 1회
배포          dpl_HBpLdPfEdJQWDeA43u87Wn3qRpQH, 02:08:34 KST 생성 → Ready, alias e-jip.com / www.e-jip.com
```

### 24.2 메인 (Yeti·Chrome UA 동일)

title·description 각 1개가 확정값과 **정확히 일치**, og:title/og:description·twitter:title/description 일치, twitter:card summary_large_image,
application-name·og:site_name `이집`, canonical `https://e-jip.com`, JSON-LD `WebSite`(name 이집, alternateName E-JIP/이집(E-JIP), url https://e-jip.com/)
· `Organization`(logo https://e-jip.com/brand/icon/ejip-app-icon-512.png).

### 24.3 지역 페이지

| URL | title | robots | canonical | H1 | BreadcrumbList | 데이터 |
|---|---|---|---|---|---|---|
| /report/city/busan | 부산 아파트 시세·실거래가·거래량 \| 이집 | index | self | 1개 | 이집>부산 | KPI O |
| /report/district/26140 | 부산 서구 … | index | self | 1개 | 이집>부산>서구 | KPI O |
| /report/district/26380 | 부산 사하구 … | index | self | 1개 | 이집>부산>사하구 | KPI O |
| /report/district/26350 | 부산 해운대구 … | index | self | 1개 | 이집>부산>해운대구 | KPI O |
| /report/dong/26140/암남동 | 부산 서구 암남동 아파트 시세·실거래가 \| 이집 | index | self | 1개 | …>서구>암남동 | KPI O |
| /report/dong/26380/괴정동 | 부산 사하구 괴정동 … | index | self | 1개 | …>사하구>괴정동 | KPI O |
| /report/dong/26350/우동 | 부산 해운대구 우동 … | index | self | 1개 | …>해운대구>우동 | KPI O |
| /report/dong/26710/기장읍 교리 | 부산 기장군 기장읍 교리 … | index | self | 1개 | …>기장군>기장읍 교리 | KPI O |
| /report/dong/26140/아미동2가 (1년 6건) | 부산 서구 아미동2가 … | noindex,follow | self | 1개 | O | — |
| /report/dong/26140/가짜동 | 지역 리포트 \| 이집 | noindex,follow | 없음 | (기존 시트 제목) | 없음 | 0건 |
| /report/district/11680 | 지역 리포트 \| 이집 | noindex,follow | 없음 | InvalidScope | 없음 | — |

색인 지역 페이지 title·description 모두 고유, BreadcrumbList 마지막 item = canonical. 단지 링크는 전부 aptSeq+lawdCd+dong을 갖고
해당 구·동과 일치. 지역·단지 링크 68개 모두 200(깨진 링크 0).

### 24.4 canonical / robots

- `?period=90`, `?period=365` → 깨끗한 지역 경로
- `/stats?sido&sigungu` → /stats, `/school?sido&sigungu` → /school, `/map?lat&lng&lawdCd` → /map, /community self, /report self, /stats/volume self
- `/apt/{name}?lawdCd&dong&aptSeq` 및 순서가 다르고 `area=84`가 붙은 URL → 같은 정규화 canonical, 이름만 있는 `/apt/{name}` → canonical 없음
- `/report/apt/26140-1361` self, `/community/{id}` self(기존)
- noindex,nofollow: /my, /community/write, /community/{id}/edit, /feedback · noindex,follow: /stats/compare?a&b, /report/compare, /ai-search?q, /stats/population
- /admin/dashboard: 비로그인 307 → /my(기존 보호 동작, robots.txt Disallow 유지)
- 공개 핵심 페이지(/ /stats /school /map /community /report 지역 브리핑) robots 제한 없음

### 24.5 sitemap

`sitemap.xml` 200 application/xml, **139 URL**(정적 5 · 부산 1 · 구 16 · 동 116 · 커뮤니티 글 1), 중복 0, 쿼리 URL 0, `/stats?`·`/school?` 0,
오리진 전부 https://e-jip.com. **전 URL 139개 요청**: 전부 200, 138개 canonical = loc(나머지 1개는 홈 `https://e-jip.com/` ↔ canonical
`https://e-jip.com` 루트 슬래시 표기 차이), 지역 URL 전부 index, title 139개 고유. robots.txt 변경 없음.

### 24.6 크롤러 렌더링

Yeti UA와 Chrome UA로 37개 경로를 요청 — title/canonical/robots 동일, 메타는 `<head>`, 지역 H1·KPI·링크가 서버 HTML에 있음.
크롤러 전용 분기 없음(같은 응답).

### 24.7 리포트 회귀 · 모바일

- 부산 사하구(브라우저): H1 "부산 사하구 아파트 시세·실거래가", 태그 "한장 브리핑"
- 이미지: 실제 버튼으로 캡처 파이프라인 실행, 다운로드 클릭만 가로채 파일 저장 없이 확인 — `e-jip-district-26380-2026-09-14.png` 1080×1528,
  448,805 bytes. 새 헤더 문구, 경로 표시·하위 링크 없음, 레이아웃 정상(육안)
- PDF: 버튼이 `window.print()`를 호출함까지 확인(대화상자 차단용으로 가로챔). **인쇄 미리보기 결과물은 이 환경에서 보지 못했다** — 인쇄 CSS는 경로·하위 링크를 숨김
- 카카오/공유 제목: 페이지 payload에 기존 "부산 사하구 부동산 한장 브리핑" 유지
- 360/390px(부산·사하구·괴정동·기장읍 교리): 가로 넘침 0, 경로 링크 36px(12.8px 글자), 동 칩 36px, 콘텐츠 하단 632px < 액션바 691px

### 24.8 로그 · IndexNow

- Vercel 로그(해당 배포, 배포 후 1시간): 5xx 0, level error 0, warning 0. 샘플 100건 중 416 2건은 `GET /` 정적 캐시 HIT(Range 요청), 오류 아님
- `error_logs`(읽기 전용): 배포 후 0, 최근 24시간 0
- IndexNow: 기존 `scripts/indexnow/submit-sitemap.ts`(2026-09-12와 같은 방식, 공개 키 파일 값 전달). 키 파일 200·내용 일치 확인 →
  dry-run 139/거부 0/범위 밖 0 → 제출 **139 URL, HTTP 200**. 색인됐다는 뜻이 아니다

### 24.9 발견 사항 (P2, 미수정 — 새 SEO 기능 금지 범위)

색인 대상 동 116개 중 **11개**는 기본 기간(최근 30일) 거래가 0건이라 화면에 거래건수 0건·중앙 거래가 "정보 없음"·최근 실거래/거래 많은 단지
섹션 없음, 최근 2년 최고가만 있다. 그런데 description은 "최근 실거래, 중앙 거래가·㎡당 가격, 거래건수, 거래가 많은 단지…를 한 장에
정리했습니다"로 **화면에 없는 섹션을 약속한다**(§7.3 원칙 위반, 표시 데이터 자체는 정직).
대상: 중구 대청동1가·보수동2가, 서구 남부민동·동대신동2가·동대신동3가·충무동1가·토성동1가, 영도구 봉래동1가·2가·3가, 금정구 금사동.
원인: 색인 기준은 최근 1년 표본인데 페이지 기본 기간은 30일. 선택지(결정 필요): (a) 설명 문구를 기간 데이터 유무에 맞게 조건화,
(b) 30일 0건이면 noindex, (c) 동 기본 기간 조정(리포트 동작 변경).

### 24.10 네이버 수동 작업 (사용자)

1. 서치어드바이저 → 요청 → 사이트맵 제출: `https://e-jip.com/sitemap.xml` 상태 확인, 필요 시 재제출
2. 요청 → 웹 페이지 수집: `https://e-jip.com/`
3. 같은 메뉴: `https://e-jip.com/report/district/26140`, `/report/district/26380`, `/report/district/26350`
4. 같은 메뉴: `https://e-jip.com/report/dong/26140/%EC%95%94%EB%82%A8%EB%8F%99`(암남동), `/report/dong/26380/%EA%B4%B4%EC%A0%95%EB%8F%99`(괴정동),
   `/report/dong/26350/%EC%9A%B0%EB%8F%99`(우동)
5. (선택) 설정 → 사이트 이름 확인. Google Search Console sitemap 재제출·URL 검사 동일

139개 전부 수동 요청하지 않는다.

### 24.11 모니터링 항목 (지금 판단하지 않음)

- 네이버 사이트 이름 표시("e-jip.com · e-jip.com") 변화 — 재수집 후
- 서치어드바이저/Search Console 색인 페이지 수(지역 브리핑 134개 중 몇 개가 색인되는지)
- 지역 키워드 노출·클릭(서치어드바이저 검색 반영, Search Console 실적)
- 기존 `/stats?sido=`·`/school?sido=` 색인 URL이 canonical로 정리되는지
- 순위 변화 주장 금지 — 2~4주 관찰 후 판단

### 24.12 재확인 (02:36~02:39 KST, 재승인 요청 시)

- `9299b36`·`b9daa17`은 이미 origin/main에 있어 **다시 push하지 않았다**(로컬은 docs `d86aef7`만 앞섬, src 변경 없음). 배포 kodp0a3i0 Ready 유지
- www.e-jip.com → 308 `https://e-jip.com{경로+쿼리}`, 레거시 vercel 호스트 → 308 e-jip.com
- 연제구 연산동(서로 다른 구 3번째 동): index·self canonical·H1·거래건수 77건·단지 링크 10개 전부 lawdCd 26470+dong 연산동·경로 이집>부산>연제구.
  연제구 페이지 동 링크 2개(연산동·거제동) 모두 26470
- 홈 실제 JSON-LD script 태그 2개(WebSite·Organization) — 원문에 문자열이 4번 보이는 것은 RSC payload 직렬화이며 중복 태그 아님
- sitemap 139(중복·쿼리 0, 구 16·동 116), Vercel 로그 5xx/error/fatal/warning 0, error_logs 배포 후 0
- 테스트 재실행: SEO 관련 80/80, src 2141/2141. IndexNow는 02:1x 제출(139, HTTP 200) 이후 재제출하지 않음

---

## 25. DATA-AWARE DESCRIPTION PATCH V1 (2026-09-16)

§24.9 P2 수정. 설명(description)만 바뀐다 — route·title·H1·canonical·robots·색인 기준(1년 10건)·사이트맵·리포트 계산·기본 기간 변경 없음.

### 25.1 원인

설명 입력(`REPORT_AVAILABLE_DATA`)이 **구조상 섹션 목록**(상수)이었다. 페이지가 이번 기간에 값을 갖는지는 보지 않았다.
색인 기준은 최근 1년인데 페이지 기본 기간은 30일이라, 1년 표본은 있고 30일은 0건인 동에서 설명이 빈 섹션을 약속했다.

### 25.2 설계

- `regionAvailableDataFromEnvelope(level, envelope)` = 구조상 상한 ∩ envelope 실제 값(새 DB 조회 없음, 시트 렌더 조건과 동일)
  - recentTrades: 최근 실거래 행 ≥1 · medianPrice: 중앙 거래가 값 있음 · tradeCount: 기간 건수 ≥1
  - tradeCountDelta: 증감률 값 있음(비교 불가 제외, 동은 상한 false) · topComplexes: 거래 많은 단지 행 ≥1
  - subRegionDistribution: 분포 행 ≥1 · twoYearHigh: 하이라이트 존재
- 설명 종류(`regionDescriptionKind`, 지역 문자열 없음 — 서울·경기 동일 적용)

| 종류 | 조건 | 문구 |
|---|---|---|
| RICH | 중앙 거래가 있음 | `{지역} 아파트 매매 시세를 국토교통부 실거래가로 확인하세요. {값 있는 섹션}을/를 한 장에 정리했습니다.` (기존과 동일) |
| HISTORICAL | 가격은 없고 과거 기록(예: 최근 2년 최고 거래가) 있음 | `{지역} 아파트 매매 실거래 기록을 국토교통부 실거래가로 확인하세요. {값 있는 섹션}을/를 한 장에 정리했습니다.` |
| SPARSE | 보여줄 거래 값 없음 / 조회 실패 | `{지역} 아파트 매매 실거래 정보를 이집에서 확인하세요.` |

- 설명은 **canonical 페이지(기본 30일)** 기준 — `?period=`와 무관(canonical과 같은 원칙)
- `src/lib/report/region-read-cached.ts`: React `cache`로 generateMetadata와 page가 같은 요청에서 envelope을 한 번만 읽는다
  (Next 16 문서 Metadata §Memoizing data requests). `?period=90` 요청은 메타(30일)·본문(90일) 두 번 읽는다
- 메타데이터 조회 실패는 `.catch(() => null)` → SPARSE 설명(과장하지 않음). 본문 실패 동작은 기존과 같다
- 목적격 조사는 마지막 항목 받침으로 을/를 결정

### 25.3 로컬 결과 (next start, Yeti UA)

- 11개 zero-30d 동: 전부 index·self canonical 유지, 설명 = HISTORICAL(`… 최근 2년 최고 거래가를 한 장에 정리했습니다.`), 화면에 없는 섹션 약속 0
- 암남동(25건)·괴정동(17건)·연산동(77건)·부산·서구·사하구·해운대구: 기존 rich 설명 그대로, 약속 섹션 전부 화면에 존재
- 가짜동: noindex·canonical 없음·일반 설명 유지

### 25.4 테스트

```
npx tsx --test src/lib/seo/region-description.test.ts   14/14 pass (신규: rich/zero-30d/sparse/11개 동/색인·canonical·사이트맵 불변/가짜 최근 약속 없음/배선/서울/경기/조사)
SEO·리포트 관련 8파일                                    163/163 pass
src 전체 154파일                                         2155/2155 pass
eslint 변경 파일                                          exit 0
tsc                                                     FAIL_EXISTING_SCRIPT_ERRORS (src 0, scripts 21, tmp 4)
npm run build                                           exit 0
```


### 25.5 Production (2026-09-16 02:52 KST 배포)

```
push          9299b36..15979d7 main (docs d86aef7·44feef8 포함) 1회
배포          dpl_DakbBy48cfdMif6WbDT4xftQKXS7 Ready, alias e-jip.com / www.e-jip.com
11개 zero-30d 동  전부 200·index·self canonical, 설명 HISTORICAL, 화면에 없는 섹션 약속 0
정상 동 3·구 3·부산  rich 설명 유지(약속 섹션 전부 화면에 존재), ?period=90도 같은 설명·canonical
가짜동        noindex·canonical 없음·일반 설명
사이트맵      139, 중복·쿼리 0, URL 집합 패치 전과 동일
지역 URL 133개 전수  설명 약속 섹션 미표시 0, RICH 122 · HISTORICAL 11 · SPARSE 0, 전부 index, canonical = loc
로그          Vercel 5xx/error/fatal/warning 0(배포 후 1시간), error_logs 0
```
