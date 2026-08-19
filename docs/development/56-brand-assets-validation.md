# BRAND STEP 56-B3 FINAL — Asset Validation

상태: **검수 완료 / production code·public 폴더 미적용 / commit·push
하지 않음(2026-08-19)**

## 기준점

- 시작 HEAD: `70d463a474ab93eccd60d055940319c8464d9474`
- HEAD == origin/main, 새 커밋 없음
- 시작 시 `git status --short`: `?? brand-source/`(추적되지 않은
  상태로 이미 24개 파일이 채워져 있었음 — 이번 STEP 이전에 별도로
  복사된 것으로 보이며, 아래 검증에서 전부 올바른 원본과 md5 일치
  확인함)

## 사용자 자산 위치

**중요 정정**: 작업지시서가 가정한 `C:\Users\123\Downloads\`
(Windows 기본 다운로드 폴더)에는 브랜드 파일이 없었다. 실제 원본은
아래 경로에 있었다:

```text
D:\다운로드\이집 로고 아이콘\               (logo, mascot, illustration, og)
D:\다운로드\이집 로고 아이콘\ejip_icon_sizes\ (icon 7종 전체)
```

Windows 사용자 프로필 기본 다운로드 폴더가 아니라 D 드라이브에 별도
"다운로드" 폴더를 만들어 쓰고 있는 환경으로 확인됨. 이 경로들의
원본 파일은 이번 STEP에서 rename/overwrite/delete 하지 않았다(읽기만
함).

## 발견된 자산 목록

- 예상 파일 수: 24
- 발견한 정상 파일 수: 24 (logo 6 + icon 7 + mascot 7 + illustration
  3 + og 1)
- 누락 파일: 없음
- 중복/잘못된 파일명: 아래 "소스 폴더 이상 파일" 참고 — 정식 24종
  자체에는 중복/오타 없음

## brand-source 생성 여부

이미 생성되어 있었고(`brand-source/logo`, `icon`, `mascot`,
`illustration`, `og`), 24개 파일 전부 올바른 분류 폴더에 위치.
**md5 비교 결과 24개 전부 올바른 원본 파일과 100% 일치**(icon
7종은 `ejip_icon_sizes/` 하위 파일과 일치 — 아래 "icon-512 중복"
참고, 최상위의 잘못된 버전이 아니라 올바른 버전이 복사돼 있었음).

## 소스 폴더 이상 파일 (24종 외 발견물)

정식 24종에는 포함되지 않지만 원본 폴더에 존재하며, `brand-source/`
로 복사하지 않은 파일들:

1. **`ejip-asspp-icon-512.png`**(오타 파일명, 최상위) — md5가
   `ejip-symbol.png`와 완전히 동일(바이트 단위 중복). 실수로
   복제/오타 저장된 파일로 판단, 무시 권장.
2. **`ejip-app-icon-512.png`**(최상위, `ejip_icon_sizes/` 밖) —
   `ejip_icon_sizes/ejip-app-icon-512.png`(512x512, RGBA, 222KB)와
   **이름은 같지만 실제로는 다른 파일**(1254x1254, RGB — 알파 없음,
   1030KB). 마스코트/일러스트와 같은 마스터 캔버스 크기(1254x1254)로
   보아 512 리사이즈 이전의 원본/실패작으로 추정. **brand-source에는
   복사하지 않았음**(올바른 `ejip_icon_sizes/` 버전만 사용) —
   맞는 판단이었음을 확인.
3. **`ChatGPT Image 2026년 8월 19일 오전 12_08_37 (1/2/3).png`**
   (최상위, 3개, 각 1536x1024 RGBA, 1.9~2MB) — 생성형 AI 원시 출력물
   추정, 24종 파일명 체계 밖. 브랜드 자산 대상 아님, 무시.

이 3종의 이상 파일은 원본 폴더 안에서만 존재하며 production
편입 대상이 아니다. 삭제/정리는 사용자 소유 폴더이므로 이번
STEP에서 수행하지 않았다(원본 수정 금지 원칙).

## 이미지 metadata

| 파일 | 크기 | 해상도 | mode | alpha 사용 |
|---|---|---|---|---|
| ejip-logo-horizontal.png | 494.5K | 2172x724 | RGBA | 실사용(0~255) |
| ejip-logo-vertical.png | 645.7K | 1122x1402 | RGBA | 실사용(0~255) |
| ejip-symbol.png | 433.4K | 1254x1254 | RGBA | 실사용(0~255) |
| ejip-logo-mono-green.png | 539.4K | 2172x724 | RGBA | 실사용(0~255) |
| ejip-logo-mono-white.png | 449.2K | 2172x724 | RGBA | **손상**(아래 참고) |
| ejip-logo-mono-dark.png | 473.9K | 2172x724 | RGBA | 실사용(0~255) |
| ejip-app-icon-512.png | 222.3K | 512x512 | RGBA | 불투명 고정(255) |
| ejip-app-icon-192.png | 33.2K | 192x192 | RGBA | 불투명 고정(255) |
| ejip-app-icon-180.png | 29.6K | 180x180 | RGBA | 불투명 고정(255) |
| ejip-app-icon-96.png | 10.5K | 96x96 | RGBA | 불투명 고정(255) |
| ejip-favicon-48.png | 3.8K | 48x48 | RGBA | 불투명 고정(255) |
| ejip-favicon-32.png | 2.1K | 32x32 | RGBA | 불투명 고정(255) |
| ejip-favicon-16.png | 0.8K | 16x16 | RGBA | 불투명 고정(255) |
| ejipy-default.png | 702.3K | 1254x1254 | RGBA | 실사용(0~255) |
| ejipy-search.png | 830.2K | 1254x1254 | RGBA | 실사용(0~255) |
| ejipy-analyze.png | 871.4K | 1254x1254 | RGBA | 실사용(0~255) |
| ejipy-loading.png | 1022.4K | 1254x1254 | RGBA | 실사용(0~255) |
| ejipy-empty.png | 801.7K | 1254x1254 | RGBA | 실사용(0~255) |
| ejipy-guide.png | 918.7K | **1169x1346**(다른 캔버스) | RGBA | 실사용(0~255) |
| ejipy-error.png | 779.8K | 1254x1254 | RGBA | 실사용(0~255) |
| ejip-illustration-search.png | 881.5K | 1254x1254 | RGBA | 실사용(0~255) |
| ejip-illustration-analyze.png | 1026.4K | 1254x1254 | RGBA | 실사용(0~255) |
| ejip-illustration-cheer.png | 939.7K | 1254x1254 | RGBA | 실사용(0~255) |
| ejip-og-main.png | 1336.3K | 1672x941 | RGB | 해당 없음(불필요) |

## transparency 검수

- 투명배경 필수 16종(logo 6 + mascot 7 + illustration 3): **15종
  PASS**(실제 alpha 0~255 범위 사용 확인, 단순 RGBA 모드가 아니라
  진짜 투명 영역 존재), **1종 FAIL** — `ejip-logo-mono-white.png`.
  - 육안 확인 시 로고 전체에 검은 반점형 노이즈가 덮여 있음.
  - 원인 분석(alpha 채널 픽셀 통계): 보이는 영역의 RGB는 전부
    거의 순백(R/G/B 평균 253)인데, 전체 픽셀의 34.6%가 완전
    투명(0)도 완전 불투명(255)도 아닌 중간값 alpha를 가짐(alpha
    고유값 256개 전부 사용 = 사실상 랜덤 분포). **흰색 로고를
    흰색 배경 위에서 크로마키/배경제거 처리하다가 전경과 배경을
    구분하지 못해 alpha 마스크가 노이즈로 망가진 전형적인 패턴**으로
    판단됨. 재사용 불가 — REWORK 필요.
- 투명배경 불필요 8종(icon 7 + og 1): PASS. icon 7종은 RGBA이지만
  alpha가 항상 255로 고정(불투명 배경, 의도된 정상 동작). og는
  RGB(alpha 채널 없음), 정상.

## size 검수 (icon/favicon)

전부 정확히 일치, FAIL 없음:

```text
512x512 / 192x192 / 180x180 / 96x96 / 48x48 / 32x32 / 16x16
```

## logo 일관성

- horizontal / mono-green / mono-dark: 캔버스 2172x724로 동일,
  하우스+e 심볼 형태, "이집"/"e-jip" 글자 형태·spacing이 서로
  거의 동일 — **PASS**. 셋 다 플랫(2D, 무광) 스타일로 통일됨.
- **mono-white: 위 transparency 문제로 시각적으로 사용 불가 —
  FAIL**. 글자 형태 자체(윤곽)는 다른 두 mono 버전과 동일해 보이나,
  노이즈 때문에 production에 바로 쓸 수 없음.
- vertical: 심볼과 "이집 / e-jip / 슬로건" 글자 형태는 horizontal과
  동일 계열이나, **렌더링 스타일이 다르다** — horizontal의 심볼/
  글자는 플랫(무광) 처리인데 vertical은 심볼과 글자 모두 글로시한
  3D 하이라이트/베벨 음영이 들어가 있음. 같은 브랜드의 두 로고
  배리에이션이 서로 다른 "질감"(플랫 vs 3D 글로시)을 쓰고 있어
  나란히 노출되면 다른 브랜드처럼 보일 위험이 있음 — **기록,
  FAIL까지는 아니나 STEP 57-A 적용 전 확인 필요**.

**결론(작업지시서 11번 원칙에 따라)**: 단색 로고 3종을 그대로 다
쓰지 않는다. mono-green/mono-dark 2종은 서로 일관되어 바로 쓸 수
있으나, mono-white는 알파 노이즈로 즉시 사용 불가하다. mono-white는
원본을 재생성하거나, mono-green/mono-dark처럼 깨끗한 파생본을
기준 자산(예: symbol.png 또는 horizontal.png)에서 단색 치환 방식
(색상만 흰색으로 교체, 배경제거 재시도 없이)으로 다시 만드는 것을
권장.

## symbol 일관성

`ejip-symbol.png`(1254x1254): 하우스 지붕 + "e"형 곡선 + 노란
4칸 창문 구조, horizontal/mono 계열 심볼과 형태 일치. 앱아이콘
512(흰 심볼 on 초록 배경)과도 실루엣이 동일 — 색 반전만 있을 뿐
구조 자체는 같음. **PASS**.

## app icon 검수

512 → 192 → 180 → 96 전부 같은 심볼, 같은 초록 배경, 같은 라운드
사각 프레임, clipping 없음, 작은 사이즈에서도 형태 유지. **PASS**.

## favicon 검수

48 / 32는 육안으로 초록 사각형 + 흰 심볼 형태가 식별 가능.
16x16은 세부(노란 창문 등)는 뭉개지지만 초록 바탕 + 흰 형태
실루엣 자체는 남아있어 완전 식별불가는 아님 — **조건부 PASS**.
다만 매우 작은 브라우저 탭 환경(실제 배율 100%)에서는 여유가
크지 않으므로, favicon 전용 simplified variant(디테일을 줄인
심볼)를 향후 검토 권장. 이번 STEP에서 새로 만들지 않음.

## mascot 캐릭터 일관성

7종(default/search/analyze/loading/empty/guide/error) 전부 육안
확인: 초록 지붕 형태, 굴뚝 돌기 위치, 얼굴형(삼각 지붕+둥근 몸),
검은 눈(하이라이트 점 포함), 볼 홍조, 빨간 입, 노란 4칸 창문
2곳(이마+배), 초록 목도리+흰 "e" 배지, 초록 장화, 전체 3D
글로시 캐릭터 스타일, 몸 비율 — **전부 동일 캐릭터로 일관됨,
PASS**.

캔버스 크기: default/search/analyze/loading/empty/error는
1254x1254로 동일, **guide만 1169x1346**(세로로 더 긴 캔버스) —
캐릭터 자체 비율은 동일해 보이나 캔버스 크기가 달라 production에서
동일 크기 그리드에 배치 시 스케일 보정이 필요함(기록만, 캐릭터
자체는 FAIL 아님).

## mascot pose 역할 검수

| pose | 기대 역할 | 실제 표현 | 판정 |
|---|---|---|---|
| default | 기본/인사 | 손 흔들며 웃는 얼굴 | 일치 |
| search | 돋보기/검색 | 돋보기를 들고 걷는 포즈 | 일치 |
| analyze | 데이터/차트/노트북 | 노트북 + 상승 그래프 카드 | 일치 |
| loading | 바쁘게 정보 수집 | 서류/폴더/박스에 둘러싸여 이동 | 일치 |
| empty | 비어있음 안내 | 양팔을 벌리고 걱정스러운 표정 | 대체로 일치 |
| guide | 방향/설명 안내 | 자기 목도리 배지를 가리키는 손 + 반대손은 옆으로 벌림, 걱정스러운 표정 | **약함(아래 참고)** |
| error | 오류/주의 | 빨간 느낌표 + 걱정스러운 표정 + 검지 세움 | 일치 |

**주의사항**: `empty`와 `guide`는 얼굴 표정(걱정스러운 눈썹)과
전체 포즈(양팔을 벌린 자세)가 매우 비슷해서 나란히 놓고 봐야
구분이 될 정도로 유사함. `guide`가 가리키는 대상이 화면 밖의
"방향"이 아니라 캐릭터 자신의 배지(자기소개에 가까움)라서, 원래
기대한 "방향/설명을 안내하는 느낌"과는 다소 거리가 있음. FAIL로
단정하지는 않으나, 실제 UI(예: 온보딩 가이드 툴팁)에 쓸 때
`empty`와 혼동되지 않도록 문맥(텍스트/배치)으로 보완할 필요가
있음을 기록.

## illustration 검수

3종 모두 의미가 명확하고 마스코트 기본 스타일과 일치:

- search: 돋보기 + 지도 + 위치 핀 → 탐색/검색 의미 명확
- analyze: 노트북 + 그래프/파이차트 + 건물 인포그래픽 카드 →
  분석/브리핑 의미 명확
- cheer: 추천 표지판(하우스+e 심볼) + 하트 + 반짝임 + 엄지 →
  추천/응원 의미 명확

투명배경 정상, UI 카드에 바로 사용 가능한 수준. **PASS**.

## OG 검수

`ejip-og-main.png`(1672x941, RGB, 1336KB):

- 브랜드명("이집 e-jip") 좌상단에 크고 명확하게 노출
- 슬로건("복잡한 부동산, 이집으로 쉽게") 상단·하단 배너 2곳에
  반복 노출되어 식별 용이
- 이집이 캐릭터가 화면 우측에 크게 있으나 텍스트를 가리지 않음,
  과도하지 않은 비중
- 폰 목업 UI로 실제 제품 화면 미리보기까지 포함 — 정보 밀도 높음
- 글자 잘림 없음
- **비율 이슈**: 표준 OG 권장 비율은 1200x630(≈1.91:1)인데, 현재
  파일은 1672x941(≈1.777:1)로 약간 더 정사각형에 가까움. 소셜
  플랫폼이 1.91:1로 크롭할 경우 상하가 일부 잘릴 수 있음 —
  **1200x630 파생본 제작 필요라고 기록**(이번 STEP에서 임의 crop
  하지 않음).
- 파일 크기 1.3MB는 OG 이미지치고 큰 편 — production 적용 전
  압축/WebP 변환 권장.

## file size 결과

- logo(<500KB 권장): horizontal 494.5K(경계 통과), symbol
  433.4K, mono-dark 473.9K → PASS. **vertical 645.7K, mono-green
  539.4K → 초과(FAIL 기준)**. mono-white 449.2K는 크기는 기준
  이내이나 내용 손상으로 별도 REWORK 대상.
- mascot(<1MB 권장): default/search/analyze/empty/error/guide는
  1MB 미만. **loading 1022.4K → 근소하게 초과**.
- icon: 전부 PNG 그대로 문제 없음(최대 222.3K).
- og: 1336.3K, "몇 MB 수준" 기준의 하단부 — production 적용 전
  최적화 권장.

용량 초과 파일들은 원본(source) 보관은 그대로 하고, production
반입 시 WebP 변환 + 리사이즈로 처리 예정(SOURCE_ONLY 분류, 아래
참고).

## brand-source 총 용량

```text
전체: 14M
  icon:         320K
  illustration: 2.8M
  logo:         3.0M
  mascot:       5.9M
  og:           1.4M
```

14MB는 저장소에 그대로 커밋해도 부담이 크지 않은 크기다. 다만
STEP 57-A에서 WebP 변환/리사이즈를 거친 production 최적화본만
`public/brand/`에 추가하고, `brand-source/`(원본 PNG)는 git
추적 여부를 사용자가 선택하도록 권장한다(예: 로컬 보관 + gitignore,
또는 그대로 추적). 이번 STEP에서 `.gitignore`에 임의로 추가하지
않음.

## APPROVED (production 편입 후보, 파생 처리만 거치면 즉시 사용 가능)

- `ejip-logo-horizontal.png`
- `ejip-logo-mono-green.png`(용량만 최적화)
- `ejip-logo-mono-dark.png`
- `ejip-symbol.png`
- `ejip-app-icon-512.png` / 192 / 180 / 96
- `ejip-favicon-48.png` / 32 / 16
- `ejipy-default.png` / search / analyze / loading / empty / error
- `ejip-illustration-search.png` / analyze / cheer

## SOURCE_ONLY (원본 보관, production 반입 전 WebP 변환·리사이즈·용량
최적화 필요)

- `ejip-logo-vertical.png`(용량 초과 + 3D 글로시 스타일 재검토
  후 반입)
- `ejipy-loading.png`(용량 근소 초과)
- `ejip-og-main.png`(1200x630 파생 + 압축 필요)
- `ejipy-guide.png`(캔버스 크기 정규화 필요, 1254x1254로 통일
  권장)
- 용량 기준을 넘는 나머지 mascot/illustration 파일들도 WebP
  변환 시 자연히 용량이 줄 것으로 예상되나, 변환 전까지는
  SOURCE_ONLY로 분류

## REWORK

- **`ejip-logo-mono-white.png`** — alpha 채널 노이즈 손상으로
  즉시 사용 불가. 흰색 로고를 흰 배경에서 배경제거하며 생긴
  문제로 추정. mono-green/mono-dark처럼 다시 만들거나, 기준
  자산(symbol/horizontal)에서 색상 치환 방식으로 재생성 권장.

## production 편입 계획 (STEP 57-A 예정, 이번 STEP에서 실행하지 않음)

```text
public/brand/
  logo/         ← APPROVED 로고(WebP 변환 후)
  icon/         ← icon 7종(그대로 또는 WebP)
  mascot/       ← APPROVED 마스코트 6종 우선, loading은 최적화 후 추가
  illustration/ ← illustration 3종(WebP 변환 후)
  og/           ← 1200x630 파생본 제작 후 추가(원본은 참고용 보관)
```

## STEP 57-A readiness

**조건부 가능**. BLOCKER는 아니지만(핵심 24종 중 23종이 정상), 아래
2가지를 먼저 처리하거나 최소한 사용자에게 확인받고 진행하는 것을
권장:

1. `ejip-logo-mono-white.png` REWORK(또는 STEP 57-A에서 mono-white
   사용을 제외하고 mono-green/mono-dark만 우선 적용)
2. `ejip-logo-vertical.png`의 3D 글로시 스타일이 horizontal과 다른
   점에 대해 — 그대로 병행 사용할지, 재작업할지 사용자 확인

나머지(용량 초과, 캔버스 크기 차이, OG 비율, favicon 16px 여백)는
STEP 57-A 진행 중 WebP 변환/리사이즈 파이프라인에서 자연스럽게
같이 처리 가능한 수준이라 진행을 막을 이유는 아니다.

## BLOCKER

없음(FAIL 1건 — mono-white — 은 있으나, 나머지 23종으로도
STEP 57-A 부분 진행이 가능하므로 전체를 막는 BLOCKER는 아님).

## 발견된 문제 요약

1. mono-white 로고 alpha 손상(REWORK)
2. vertical 로고 스타일(3D 글로시)이 horizontal/mono 계열(플랫)과
   불일치(확인 필요)
3. 원본 폴더에 `ejip-asspp-icon-512.png`(symbol의 오타 중복본),
   최상위 `ejip-app-icon-512.png`(잘못된 512 버전, 알파 없음) 존재
   — brand-source에는 반입하지 않음(정상 처리 확인)
4. 원본 폴더에 24종과 무관한 ChatGPT 생성 원본 3개 존재(무시)
5. logo 2종(vertical, mono-green) + mascot 1종(loading) 용량
   가이드라인 초과
6. mascot guide/empty 포즈 표정·자세 유사로 구분 약함
7. mascot guide 캔버스 크기만 다름(1169x1346)
8. OG 이미지 비율이 표준 1.91:1과 다름 + 용량 최적화 필요
9. Downloads 실제 경로가 작업지시서 가정과 다름(`D:\다운로드\이집
   로고 아이콘\`) — 향후 유사 작업 시 참고

## STEP 57-A 진행 가능 여부

조건부 가능 (위 "STEP 57-A readiness" 참고)

## production code 변경 여부

없음. `brand-source/` 외 어떤 파일도 수정하지 않았다.

## DB/schema/migration 변경 여부

없음.

## 생성/수정 문서

- 신규: `docs/development/56-brand-assets-validation.md`(이 문서)
- 수정 예정(사용자 확인 후): `docs/development/CHANGELOG.md`

## commit/push 여부

수행하지 않음. 사용자/ChatGPT 확인 전까지 `git add`/`commit`/
`push` 하지 않는다는 원칙 준수.
