# MASTER COVERAGE SYNC APPLY + DOMAIN OG FIX V1

작성일: 2026-09-11
선행: `BUSAN_LAUNCH_READINESS_AUDIT_V1` (P1-1, P1-3)
기준 커밋: `c4fa47e` (main)

## 목적

부산 소프트 런칭 전 두 가지를 닫는다.

1. **MASTER COVERAGE** — 거래는 있는데 `ApartmentMaster` 행이 없어 좌표·점수·검색 identity가
   조용히 빠지던 단지들을, 승인 받은 범위에서 **INSERT 1회**로 메운다.
2. **DOMAIN OG** — 런타임 OG 메타데이터에 박혀 있던 Vercel 호스트를 제거해, 도메인 전환이
   환경변수 하나로 끝나게 만든다.

승인 범위는 **`MASTER_COVERAGE_SYNC_V1`의 missing-master INSERT 경로 하나뿐**이다.
DELETE·UPDATE·스키마 변경·마이그레이션·점수 재수집·학교 점수 출처 변경·임계 변경·
정리성 삭제는 어느 것도 하지 않았다. DNS·Vercel 도메인·OAuth·Kakao 콘솔·GA4 스트림·
Search Console도 건드리지 않았다(도메인 커토버 자체는 이 STEP의 범위가 아니다).

## 1. 쓰기 전 검증

`--apply`를 누르기 전에 스크립트가 **정확히 무엇을 쓰는지** 먼저 확인했다.

```
scripts/master-coverage-sync.ts                 prisma.apartmentMaster.create   1곳
scripts/master-coverage-sync-logic.ts           (쓰기 없음)
scripts/repair-recent-missing-masters-logic.ts  (쓰기 없음)
```

전체 체인에서 Prisma 쓰기는 **단 한 줄**이고, 그 앞에 `HIGH_CONFIDENCE`
(`masterCreateReadiness=READY_FOR_MASTER_CREATE`) 필터와 **쓰기 직전 중복 재확인**이 있다.
UPDATE·DELETE 경로는 존재하지 않는다. 외부 HTTP 호출도 0건(DB 전용)이다.

### Dry-run (쓰기 전)

```
TradeHistory distinct aptSeq : 3,410
ApartmentMaster matched      : 3,389
Missing                      : 21
Coverage                     : 99.38%

HIGH_CONFIDENCE  : 20
REVIEW_REQUIRED  : 1   26440-329 에코델타더베르힐(강동동) — F_SOURCE_ALIAS_MISMATCH
INVALID          : 0
```

`REVIEW_REQUIRED` 1건은 같은 주소(dong+jibun)에 다른 `aptSeq`의 기존 Master가 있어
rename/alias 여부가 확정되지 않은 건이다. **자동 생성하지 않는다** — 스크립트 설계상
`HIGH_CONFIDENCE`만 INSERT된다.

### 쓰기 전 스냅샷

```
ApartmentMaster 총계   : 3,418
대상 21건 중 이미 존재 : 0
중복 aptSeq            : 0
```

## 2. 승인된 INSERT 실행

```
npx tsx scripts/master-coverage-sync.ts --apply
→ inserted: 20, failed: 0   (id 5407 ~ 5426)
```

### 쓰기 후 검증

```
ApartmentMaster 총계   : 3,438   (+20, 정확히 일치)
대상 20건 전부 존재    : 20/20
중복 aptSeq            : 0

재실행 audit
  Missing         : 21 → 1
  Coverage        : 99.38% → 99.97%
  HIGH_CONFIDENCE : 0      (재실행 시 0건 삽입 — 멱등)
  REVIEW_REQUIRED : 1      (위 26440-329, 그대로 보류)
```

## 3. 새로 들어온 20건의 실제 상태

| aptSeq | 이름 | 동 | 거래 | 좌표 | LocationFeature |
|---|---|---|---|---|---|
| 26500-177 | 진흥목화 | 광안동 | 47 | 없음 | 0 |
| 26320-1503 | 용진힐타운 | 구포동 | 94 | 없음 | 0 |
| 26350-2611 | 해운대역푸르지오더원 | 우동 | 1 | 없음 | 0 |
| 26350-206 | 회현하이츠빌라 | 반송동 | 15 | 없음 | 0 |
| 26500-1638 | 더썬불루 | 수영동 | 21 | 없음 | 0 |
| 26410-98 | 거성리젠시 | 남산동 | 36 | 없음 | 0 |
| 26230-1810 | 대원 | 부전동 | 18 | 없음 | 0 |
| 26170-644 | 애뜰안 | 초량동 | 46 | 없음 | 0 |
| 26710-39 | 삼보맨션 | 일광읍 이천리 | 42 | 없음 | 0 |
| 26500-1391 | 금오파크빌 | 광안동 | 37 | 없음 | 0 |
| 26290-206 | 동경쉐르빌 | 대연동 | 23 | 없음 | 0 |
| 26140-119 | 대신빌라 | 토성동5가 | 13 | 없음 | 0 |
| 26140-118 | 송암파크빌 | 암남동 | 10 | 없음 | 0 |
| 26350-360 | 그린힐2차 | 중동 | 19 | 없음 | 0 |
| 26710-81 | 상마타운 | 기장읍 대라리 | 14 | 없음 | 0 |
| 26230-373 | 동진 | 부전동 | 17 | 없음 | 0 |
| 26410-237 | 세진 | 남산동 | 20 | 없음 | 0 |
| 26170-68 | 초량위드빌 | 초량동 | 30 | 없음 | 0 |
| 26410-206 | 아름베스트빌1 | 구서동 | 50 | 없음 | 0 |
| 26230-175 | 대우리치빌 | 전포동 | 48 | 없음 | 0 |

**20건 전부 좌표가 없다.** 이는 결함이 아니라 설계다 — sync는 identity(aptSeq/이름/주소/
건축년도)만 넣고 좌표·세대수·주차 같은 2차 메타데이터는 **절대 채우지 않는다**.
좌표를 지어내지 않았고, 지오코딩도 하지 않았다(별도 파이프라인).

## 4. 사용자 화면 실측 (읽기 전용)

로컬 프로덕션 빌드(`next build && next start`) 기준.

| 확인 항목 | 결과 |
|---|---|
| 상세 페이지 | `/apt/송암파크빌?aptSeq=26140-118` → **200** |
| 검색 | `/api/search?q=송암파크빌` → `apartmentId 5419`, `aptSeq "26140-118"`, `lat/lng null` |
| 거래 목록 | `aptSeq` 집합이 `{26140-118}` 하나뿐 — 다른 단지 거래 혼입 0 |
| 건축물대장 info | 세대수 18 · 사용승인 2002 · 주차 세대당 0.78대 · 용적률 209.7% 정상 |
| 좌표 | `NO_COORDINATE / MASTER_WITHOUT_COORDS` (쓰기 전에는 `NO_MASTER`였다) |
| 지도 카드 | 좌표 없음 → "위치 정보를 확인할 수 없습니다." **가짜 지도 없음** |
| 점수 | `INSUFFICIENT_DATA`, `score: null` (쓰기 전에는 `NOT_FOUND`) — **지어낸 점수 없음** |

`AptLocationCard`는 좌표가 없으면 주소 모드로 내려가지 않고 없다고 말한다
(`KakaoMapEmbed`의 좌표 모드는 Geocoder를 만들지도 않는다). 틀린 위치보다 위치 없음이 낫다는
기존 계약이 새 master에도 그대로 적용된다.

## 5. 실측으로 발견한 부작용 1건 — 동명 단지 AMBIGUOUS

`/api/apt/[name]/score`는 단지를 **(sggCd + umdName + 정규화된 이름)**으로 해소하고
`aptSeq`를 받지 않는다. 후보가 2건 이상이면 틀린 점수를 주느니 `AMBIGUOUS`로 응답한다
(라우트 §41/§52의 의도된 설계).

`normalizeAptName`은 "아파트" 접미사를 제거하므로 **`대원아파트` → `대원`**이다.
새로 넣은 `대원`(26230-1810, 부전동)이 기존 `대원아파트`(26230-149, 범천동)와 같은 구에서
같은 정규화 이름을 갖게 됐다.

```
/api/apt/대원아파트/score?lawdCd=26230              → AMBIGUOUS (점수 사라짐)
/api/apt/대원아파트/score?lawdCd=26230&dong=범천동   → OK, 58점 (정상)
```

16개 구의 **모든 master 이름을 대입해** 쓰기 전/후 해소 결과를 시뮬레이션했다
(exact 우선 → `aptNamesMatch` 느슨 폴백까지 라우트 규칙 그대로 재현).

```
OK → AMBIGUOUS 회귀 : 1건 (26230 대원아파트, dong 없는 경로에서만)
dong이 있는 경우     : 회귀 0건
```

영향 경로는 `dong`을 싣지 않는 진입점뿐이다(`TableList`, `RankCard`, 리포트의
"단지로 돌아가기" 링크 등 — 후자는 `aptSeq`는 싣지만 score 라우트가 `aptSeq`를 읽지 않는다).
지도·검색·통계·AI 검색·즐겨찾기 경로는 모두 `dong`을 싣는다.

**틀린 점수가 아니라 점수 없음**이므로 데이터 진실성 위반은 아니다. 근본 해법은 이름이 아니라
canonical identity(`aptSeq`)로 해소하는 것이지만, score 해소 규칙 변경은 승인 대상이라
이 STEP에서 손대지 않고 로드맵 P1로 기록했다.

## 6. 도메인 OG 하드코딩 제거

### 문제

`metadataBase`·`robots`·`sitemap`·`absoluteUrl`은 `siteConfig`를 거쳐 `NEXT_PUBLIC_SITE_URL`
하나로 따라오는데, `src/app/layout.tsx`의 세 줄만 호스트를 직접 박아두고 있었다.
도메인을 바꿔도 **공유 카드만 옛 주소를 가리키는** 상태였다.

### 변경

```diff
-    url: 'https://real-estate-app-park11.vercel.app',
+    url: siteConfig.url,
-        url: 'https://real-estate-app-park11.vercel.app/brand/og/ejip-og-main-1200x630.jpg',
+        url: absoluteUrl(OG_IMAGE_PATH),
-    images: ['https://real-estate-app-park11.vercel.app/brand/og/ejip-og-main-1200x630.jpg'],
+    images: [absoluteUrl(OG_IMAGE_PATH)],
```

오리진을 정하는 곳은 이제 `src/config/site.ts`의 `getBaseUrl()` **하나뿐**이다
(`NEXT_PUBLIC_SITE_URL` → 프로덕션 고정 도메인 → 프리뷰 호스트 → localhost).
`CANONICAL_PRODUCTION_URL` 상수는 그대로 둔다 — 환경변수를 아직 넣지 않은 **현재 Vercel
배포의 공유 카드를 계속 살려두는 폴백**이며, 지우면 지금 배포가 깨진다.

### 런타임 실측

`NEXT_PUBLIC_SITE_URL=https://e-jip.com`으로 기동:

```
동적 /apt/...      og:url   https://e-jip.com
                   og:image https://e-jip.com/brand/og/ejip-og-main-1200x630.jpg
동적 /sitemap.xml  <loc>https://e-jip.com/</loc>
정적 /             og:url   http://localhost:3000   ← 빌드 시점 값
정적 /robots.txt   Sitemap: http://localhost:3000/sitemap.xml
```

이중 슬래시 0건, `undefined` 0건, 동적 경로에 localhost 유출 0건.

**중요(커토버 절차):** 정적 프리렌더 라우트(`/`, `/robots.txt`)는 오리진을 **빌드 시점에
굽는다.** Vercel에서 `NEXT_PUBLIC_SITE_URL`을 설정하는 것만으로는 부족하고 **재배포가
필요하다.** 이는 이번 변경으로 생긴 성질이 아니라 `metadataBase`가 원래 갖고 있던 성질이다.
다만 변경 전에는 재배포를 해도 OG 3줄이 옛 도메인에 남았고, 이제는 재배포하면 따라온다.

### 레거시 호스트 잔존 분류 (§9)

| 위치 | 분류 | 조치 |
|---|---|---|
| `src/config/site.ts:6` | **RUNTIME (의도된 단일 폴백)** | 유지 |
| `src/config/site-metadata.test.ts` | **TEST** | 이 STEP의 계약 테스트 |
| `docs/development/*.md` (30여 곳) | **DOC / HISTORICAL** | 당시 프로덕션 실측 기록 — 고치지 않는다 |
| `scripts/perf-journey-audit.ts:19` | **TOOLING** | `--base=`로 덮어쓰는 기본값. 런타임 아님 |
| `my_prod.html`, `tmp/vercel_measure.sh` | **HISTORICAL (사용자 작업물)** | 건드리지 않음 |

`src/` 런타임 코드에 남은 호스트 문자열은 위 폴백 상수 하나뿐이다.

## 7. 마스터 sync 자동화 감사 (§8) — 판정: **B. NEEDS FOLLOW-UP**

안전한 쪽:

- 외부 HTTP 호출 0건, DB 전용, 실행 2.4초 (Vercel 함수 타임아웃 여유)
- 쓰기 경로 1줄, INSERT 전용, `HIGH_CONFIDENCE`만, 쓰기 직전 중복 재확인
- dry-run 기본값 — `--apply` 없이는 절대 쓰지 않음
- 멱등: 방금 실행 후 재실행 시 삽입 0건

무인 실행 전 선행 필요:

1. **cron 라우트 부재** — `scripts/`는 Next 번들에 포함되지 않는다. 로직을 서버 모듈로 옮기고
   기존 세 cron과 동일한 `CRON_SECRET` fail-closed 게이트를 쓰는
   `/api/cron/master-coverage-sync` 신설이 필요하다.
2. **좌표 없는 master 누적** — 자동화하면 좌표·점수가 빠진 단지가 조용히 늘어난다.
   지오코딩 백필과 짝지어야 한다.
3. **REVIEW_REQUIRED 누적 알림** — 지금은 아무도 보지 않으면 쌓이기만 한다.
4. **§5의 동명 AMBIGUOUS 부작용** — 무인 실행이면 같은 종류의 회귀가 사람 눈 없이 발생한다.

**이 STEP에서는 프로덕션에 쓰는 cron을 추가하지 않았다.** 로드맵
`[출시 직후 / P1 운영] MASTER COVERAGE SYNC AUTOMATION`으로 기록했다.

## 8. 회귀 확인 (§14)

이번 STEP의 `src/` 변경은 `src/app/layout.tsx` 메타데이터 한 파일(+15 −4)과
신규 테스트 파일 하나가 전부다. 아래는 **전혀 건드리지 않았다.**

- 학교 점수 출처 · 임계 · 카테고리 가중치 · percentile 정규화
- `ApartmentLocationFeature` · `ApartmentTradeHistory` · 취소 거래 규칙
- 금융 계산(`lib/finance-tools/*`) · 리포트 계산
- 스키마 · 마이그레이션

## 9. 테스트 / 빌드

```
npx tsx --test "src/**/*.test.ts"   731 / 731 PASS   (신규 site-metadata 7건 포함)
npx tsc --noEmit                    src 오류 0
                                    (scripts/ 20 + tmp/ 4 = 기존 14개 파일,
                                     FAIL_EXISTING_SCRIPT_ERRORS)
npx eslint <변경 파일>              0 problems
npm run lint                        src/ 오류 0
                                    (전체 1,638 errors 중 1,631건이 .worktrees/, 5건이 scripts/)
npm run build                       exit 0
```

## 10. 알려진 문제

- **동명 단지 AMBIGUOUS 1건** — §5. `대원아파트`(26230-149)가 dong 없는 진입 경로에서
  점수를 잃었다. 로드맵 P1.
- **좌표 없는 신규 master 20건** — 지오코딩 백필 전까지 지도·점수가 비어 있다.
  거짓 표시는 없다.
- **`REVIEW_REQUIRED` 1건** — `26440-329 에코델타더베르힐`. alias 확인 전까지 자동 생성 금지.
- **정적 라우트 OG는 재배포 필요** — §6.
- **모바일 렌더 QA 미실시** — 브라우저 도구 미승인. 이 STEP의 변경은 메타데이터라
  시각 회귀 표면이 없다.

## 11. 다음 STEP

1. 도메인 커토버 실행(환경변수 + **재배포** + Kakao JS 키 도메인 등록 + OAuth 리디렉션 URI)
2. `MASTER COVERAGE SYNC AUTOMATION` — cron 라우트 신설 (승인 필요)
3. score 해소를 `aptSeq` 기반으로 (승인 필요)
4. `SCHOOL SCORE MODEL REBASE V1` (기존 P1, 유지)
