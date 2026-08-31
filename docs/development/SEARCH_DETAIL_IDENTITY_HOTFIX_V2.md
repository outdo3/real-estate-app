# SEARCH → DETAIL IDENTITY HOTFIX V2

## 1. Incident

P0 신뢰도 버그: 검색에서 "해운대경동제이드"(우동 763, 2012년 준공,
278세대)를 선택했는데, 상세페이지가 완전히 다른 실존 단지 "경동"(우동
974, 1995년 준공, 72세대)의 이름/준공연도/세대수를 표시했다. 다른
아파트 fallback은 이집의 절대 원칙 위반(AGENTS.md "아파트 canonical
identity") — 이번 HOTFIX는 이 특정 단지 하드코딩이 아니라 검색→상세
identity chain 구조 전체를 재감사해 근본 원인을 수정한다.

## 2. User-visible symptom

- 검색 결과: 해운대경동제이드 · 우동 763 · 278세대 · 2012년 준공
- 상세페이지: 경동 · 1995년 · 72세대 (전혀 다른 단지)

## 3. Reproduction

`docs`가 아닌 실제 프로덕션 DB(`ApartmentTradeHistory`, Busan 전역
backfill 완료분, `TRADE_HISTORY_DATA_V1` 참고)로 직접 재현·검증했다
(추측 없이 실측만 사용, §4 참고).

```
해운대경동제이드: lawdCd 26350, dong 우동, jibun 763, aptSeq 26350-2206, buildYear 2012
경동:             lawdCd 26350, dong 우동, jibun 974, aptSeq 26350-2,    buildYear 1995
```

두 단지는 **같은 법정동(우동)**에 있는 **완전히 다른 두 건물**이다.
"경동"의 최근 거래(2026-08-22)가 "해운대경동제이드"의 최근 거래
(2026-06-25)보다 최신이라, 날짜 내림차순 정렬 결과의 0번째 항목이
"경동"이 되는 실제 데이터 조건이 확인됐다.

## 4. Root cause

**4-1. 실거래 조회(`/api/apt/[name]/route.ts`)** — 같은 법정동 안의
MOLIT 실거래를 `dong` 일치 + `aptNamesMatch()`(양방향 부분포함, 예:
"명륜아이파크" ⊂ "명륜아이파크1단지" 같은 정당한 표기차를 흡수하려고
만든 규칙)로 필터링한다. 그런데 "경동"은 "해운대경동제이드"의 완전한
부분 문자열이라 `aptNamesMatch('경동', '해운대경동제이드') === true`가
되어, 서로 다른 aptSeq(26350-2 vs 26350-2206)를 가진 별개의 실존
단지가 같은 결과 집합에 섞였다. "경동"의 최근 거래가 더 최신이라
정렬 후 0번째로 올라왔다.

**4-2. 클라이언트(`apt-client.tsx`)** — `fetchedTrades[0]`(위에서 오염된
배열의 0번째)를 검증 없이 `displayName`(헤더 표기)과 `heroBuildYearRaw`
(준공연도)의 근거로, `fetchedTrades[0].jibun`을 다음 `/info` 호출의
identity로 그대로 사용한다. 즉 트레이드 라우트가 잘못 섞이면 헤더·
준공연도·다음 단계 identity가 통째로 오염된다.

**4-3. `/api/apt/[name]/info/route.ts`의 오염된 캐시** — 4-2에서 잘못
전달된 지번(974)으로 과거에 이미 한 번 `/info`가 호출된 적이 있어,
legacy `Apartment` 캐시 테이블에 `name='해운대경동제이드', dong='우동'`
row(id 399)가 **"경동"의 지번(974)·세대수(72)·준공일(1995년)**으로
upsert되어 남아있었다(실측 확인). 이 캐시는 `name+dong` exact match만
확인하고 저장된 jibun이 실제로 맞는지는 검증하지 않아 "가장 강한
identity"로 오인되어 매 요청마다 반환됐다 — **4-1을 고쳐도 이 오염된
캐시 row가 남아있는 한 증상이 재발**하는 별도의 cascading 버그였다.

## 5. Identity chain — before

```
검색(aptSeq/jibun 보유) → onSelect → navigateToApt(name, lawdCd, dong만 전달, jibun 유실)
  → /apt/[name]?lawdCd&dong
  → GET /api/apt/[name]  (dong + aptNamesMatch 느슨한 부분포함 — 다른 단지 섞임 가능)
  → fetchedTrades[0] 그대로 신뢰 → displayName, buildYear, 다음 jibun 확정
  → GET /api/apt/[name]/info?jibun=(오염 가능)  (name+dong 캐시도 jibun 검증 없음)
  → 헤더/hero/즐겨찾기/공유/최근본단지 전부 오염된 displayName 사용
```

## 6. Identity chain — after

```
GET /api/apt/[name]:
  dong 안에 요청 이름과 "정규화 후 완전히 일치"하는 exact match가 있으면
  → 그 aptSeq(들)만 인정(STRONG_RESULT_PROTECTION), 부분포함 매칭 전부 배제
  → exact match가 dong 안에 전혀 없을 때만 기존 aptNamesMatch 폴백(회귀 없음)

GET /api/apt/[name]/info:
  jibun이 없는 "빠른 진입" 첫 호출도 ApartmentMaster(Busan 전역 backfill,
  이름+동 정규화 exact) 교차검증으로 지번을 먼저 확보(effectiveJibun)
  → name+dong 캐시 row에 저장된 jibun이 effectiveJibun과 다르면
    "오염된 캐시"로 간주해 신뢰하지 않고 live/master 흐름으로 재확인
  → 다음 upsert가 jibun/registry 필드를 올바른 값으로 self-heal
```

## 7. Canonical ID priority (이번 라우트가 실제로 쓰는 것)

1. dong 안에서 정규화 후 완전히 일치하는 실거래의 aptSeq (가장 강함)
2. ApartmentMaster의 sggCd+umdName+normalizedName exact → 그 jibun
3. 위 둘 다 없으면: 기존 dong + aptNamesMatch 느슨한 폴백(legacy 호환)
4. 그래도 없으면: 실거래 없음(NO DATA) — 다른 단지로 대체하지 않음

검색 결과 자체는 이미 `aptSeq`/`jibun`을 갖고 있으나(`/api/search`),
`ApartmentQuickSearch`/`HomeApartmentSearch`의 `navigateToApt()`는
`lawdCd`+`dong`만 URL에 실어 보낸다 — 이번 HOTFIX는 §21(전체 UI
대수술 금지) 원칙에 따라 15개 이상의 진입 경로(지도/통계/AI검색/
학교/홈/커뮤니티 등)에 `jibun`/`aptSeq` 쿼리 파라미터를 새로 추가하는
대신, 모든 진입 경로가 공유하는 단일 병목 지점인 `/api/apt/[name]`
라우트와 `/api/apt/[name]/info` 라우트 자체를 구조적으로 강화했다
(§19 참고 — 향후 라우팅 계약 확장 권고).

## 8. Fallback rules

- `aptNamesMatch()` 함수 자체는 수정하지 않았다(기존 계약·다른
  소비처 보존). 대신 exact match가 확보된 경우에만 그 결과를 우선하고,
  부분포함 매칭은 exact match가 dong 안에 전혀 없을 때만 동작하도록
  상위 게이트를 추가했다 — 집합을 줄이기만 하므로 회귀 불가능.
- 이름만 있고 dong도 없는 완전 레거시 URL은 기존과 동일하게 동작한다
  (변경 전보다 나빠지지 않음 — exact match 우선 규칙이 dong 없이도
  적용되어 오히려 더 안전해졌다).

## 9. Strong result protection

- 실거래 라우트: exact-identity aptSeq 집합이 한 번 확보되면 이후
  부분포함 매칭 결과로 대체되지 않는다.
- info 라우트: "빠른 진입" 첫 호출(jibun 없음)에서도 ApartmentMaster
  교차검증으로 다른 정체성의 캐시를 신뢰하지 않는다 — 화면에 잘못된
  값이 잠깐이라도 노출되는 flash 없이 곧바로 정답(278세대/2012년)이
  뜬다(§15 QA에서 실측 확인).

## 10. Regression cases (실측, 부산 실제 데이터)

| 검색어 | dong | 기대 aptSeq | 실측 결과 |
|---|---|---|---|
| 해운대경동제이드 | 우동 | 26350-2206 | PASS — 4건, 전부 해운대경동제이드, jibun 763, buildYear 2012 |
| 경동 | 우동 | 26350-2 | PASS — 45건, 전부 경동, jibun 974, buildYear 1995 |
| 센텀경동리인 | 우동 | 26350-2334 | PASS — 43건, 전부 센텀경동리인, jibun 1543, buildYear 2018 |
| 해운대경동리인뷰2차 | 우동 | 26350-2610 | PASS — 9건, 전부 해운대경동리인뷰2차, jibun 1565, buildYear 2024 |
| 금호어울림(exact) | 서대신동3가 | 26140-133 | PASS — exact match, 정상 동작 |

같은 법정동에 "경동"을 공유하는 4개 실존 단지 전부가 서로 섞이지
않고 각자 자신의 identity만 반환했다(§14 요구 케이스 충족).

레거시 alias 폴백(예: 짧은 검색어가 실제 등록명의 부분 문자열인
정당한 표기차 케이스)은 `matchesTradeIdentity()` 단위테스트로
합성 fixture 검증(exact match가 dong 안에 없으면 기존 느슨한 규칙
그대로 동작 — `src/lib/apt-name-match.test.ts`).

## 11. Haeundae Gyeongdong Jade proof (§15 필수 assertion)

브라우저로 `/apt/해운대경동제이드?lawdCd=26350&dong=우동` 방문, 실제
화면 캡처로 확인:

```
DETAIL NAME     = 해운대경동제이드
DONG/JIBUN      = 부산광역시 해운대구 763 (우동)
HOUSEHOLDS      = 278세대
BUILD YEAR      = 2012년 준공
최근 실거래     = 27억 5,000만 · 2026.06.25 · 163.27㎡
단지 상세 제원  = 세대수 278세대 · 준공년월 2012년·14년차 ·
                  용적률 1053.8% · 건폐율 56.4% · 주차대수 세대당 3.19대(총 888대)
이집점수 "단지" 항목 = "2012년 준공 · 278세대" (헤더와 완전 일치)
탭 타이틀       = "해운대경동제이드 실거래가·시세 - 이집"
```

"경동/1995/72세대"는 어디에도 나타나지 않았다(헤더/hero/spec grid/
score 카드 전부 교차 검증, §31 DATA_CONSISTENCY 충족).

## 12. Other similar-name QA

§10 표 참고 — 경동/센텀경동리인/해운대경동리인뷰2차 3개 실존 유사명
단지 전부 자기 자신의 identity만 반환(교차오염 0건).

## 13. Mobile QA

390px 뷰포트에서 상세페이지 확인: 헤더/hero/AreaSelector/실거래가/
하단 sticky 액션바(관심단지·공유·글쓰기) 정상 렌더, 가로 스크롤·
겹침·잘림 없음, identity는 데스크톱과 동일(해운대경동제이드).
빠른 검색 모달에서 "해운대경동제이드" 검색 → 결과 카드(우동 763 ·
278세대 · 2012년 준공) → 선택 → 동일 상세페이지 확인(정상, 오매칭
없음). 실제 모바일 단말 실기기 테스트는 이번 세션에서 수행하지
않았다(§16 known limitations).

## 14. Desktop QA

기본 브라우저 폭에서 위 §11 캡처와 동일한 흐름/결과 확인(정상).

## 15. No-data behavior

exact identity(aptSeq/jibun)가 dong 안에서 전혀 확보되지 않고 기존
`aptNamesMatch` 폴백으로도 매칭이 없으면 `trades: []`를 반환한다 —
클라이언트는 기존과 동일하게 "거래 없음"/"조회 중" 상태를 보여주며,
다른 단지 데이터로 대체하지 않는다(변경 없음, 기존 계약 유지).

## 16. Known limitations

- **레거시 no-jibun 진입 경로의 잔여 위험**: 지도 마커, 커뮤니티
  글 링크, 통계 랭킹 카드 등 15개 이상 진입 경로는 여전히 URL에
  `jibun`/`aptSeq`를 싣지 않는다(§7). 이번 HOTFIX는 이 경로들이
  공통으로 거치는 `/api/apt/[name]`·`/api/apt/[name]/info` 두
  라우트 자체를 강화해 대부분의 실질적 위험을 제거했지만(exact match
  우선 규칙은 dong+aptNamesMatch 상황 전체에 적용됨), URL 자체에
  강한 identity를 싣는 것(§7 라우팅 계약 확장)만큼 근본적이지는
  않다. 다음 STEP 후보로 남긴다(§19).
- **오염된 legacy `Apartment` 캐시 row 잔존**: `해운대경동제이드`
  캐시 row(id 399, jibun=974)는 이번 HOTFIX가 코드 레벨에서
  "신뢰하지 않도록" 만들었을 뿐, 실제로 UPDATE/DELETE하지는
  않았다(AGENTS.md DB 안전 원칙 — 승인 없는 production 데이터 수정
  금지, §24). 코드가 매 요청마다 mismatch를 정확히 감지해 우회하므로
  사용자 화면에는 아무 영향이 없으나, DB 안에는 여전히 남아있다.
  원한다면 별도 승인 하에 정리(clean-up) 가능 — 이번 STEP 범위 밖.
- 실제 모바일 단말 실기기 테스트 미실시(§13).
- ApartmentMaster의 `far`(용적률) 값이 일부 단지에서 비정상적으로
  커 보이는 사례(해운대경동제이드 1053.8%)를 관찰했으나, 이는 기존
  master 데이터 자체의 값이며 이번 identity 버그와 무관한 별개의
  데이터 품질 이슈로 판단해 손대지 않았다(§13/§14 원칙 — 미확인
  사항을 오류로 단정하지 않되, 별도 확인 필요 항목으로 기록).

## 17. Files changed

- `src/lib/apt-name-match.ts` — `resolveStrongIdentityAptSeqs()`,
  `matchesTradeIdentity()` 순수 함수 추가(기존 `aptNamesMatch`,
  `shouldAdoptFallbackUnitTypes`는 무변경).
- `src/lib/apt-name-match.test.ts` — 신규, 8개 단위테스트.
- `src/app/api/apt/[name]/route.ts` — 실거래 필터링에 strong-identity
  게이트 적용.
- `src/app/api/apt/[name]/info/route.ts` — `effectiveJibun`
  도입(ApartmentMaster exact 교차검증), 오염 캐시 mismatch 가드 추가.

## 18. No DB change proof

`git diff`에 `prisma/schema.prisma`, `prisma/migrations/**` 변경
없음. 이번 HOTFIX는 조회/필터링 로직만 수정했고, 어떤 마이그레이션도
생성·적용하지 않았다. 오염된 legacy 캐시 row(§16)는 의도적으로
손대지 않고 코드 레벨 우회만 적용했다(승인 없는 production 데이터
수정 금지 원칙 준수).

## 19. Next recommendation

1. (선택, 낮은 우선순위) `ApartmentSearchResult`에 이미 있는
   `jibun` 정보를 실제로 `navigateToApt()`까지 전달하도록
   확장하면(§7), 레거시 폴백 의존도를 더 낮출 수 있다 — 다만
   이번 HOTFIX만으로 실제 보고된 사고와 동종의 모든 사례(§10)가
   이미 해소되어 시급성은 낮다.
2. (선택) §16의 오염된 legacy `Apartment` row 정리 — 별도 승인 하에
   진행 권장(수동 UPDATE 또는 캐시 무효화 스크립트).
