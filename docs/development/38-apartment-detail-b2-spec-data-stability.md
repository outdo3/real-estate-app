# STEP 38 — APT DETAIL B2-1: 단지 스펙(용적률·건폐율·주차대수) 데이터 안정화

상태: 조사 + 최소 구현 완료 / 사용자 검수 대기(commit/push 없음)

성격: 데이터 신뢰성 우선, 추정값 생성 금지. DB/schema/migration 변경 없음, 신규
DB write 경로 추가 없음. 기준 commit `0a4736f3ca04d9ccb72986710d4eb8e5bb7a5417`
(origin/main과 동일, working tree clean — §0 확인).

---

## 0. 작업 시작 전 확인

```
git branch --show-current        → main
git status --short                → (empty, clean)
git rev-parse HEAD                → 0a4736f3ca04d9ccb72986710d4eb8e5bb7a5417
git fetch origin                  → (no new refs)
git rev-parse origin/main         → 0a4736f3ca04d9ccb72986710d4eb8e5bb7a5417
git rev-list --left-right --count origin/main...HEAD → 0  0
```

예상과 정확히 일치, STOP 조건 미발생 — 조사 진행.

## 1. B2-A(문서33) 재검증 결과

문서33 작성 시점(2026-08-15) 대비 **coverage가 15건 → 18건(부산)으로 자연 증가**한
것 외에는 문서33의 핵심 결론이 현재 코드와 정확히 일치함을 재확인했다:

- `AptSpecGrid.tsx`(§4), `info/route.ts`(§5), `apt-building-info.ts`(§7)의 구조는
  문서33 작성 이후 변경되지 않음(코드 line-by-line 대조 완료).
- `ApartmentMaster`에는 여전히 `far`/`bcr` 필드가 없음(schema 재확인) — 이 모델로의
  전환은 이번에도 선택지가 아니다.
- 문서33이 다루지 않은 것(이번 STEP에서 새로 확인): **`apt-client.tsx`가 이미
  cache-miss 시 자동으로 외부 API를 호출하고 DB에 캐싱하는 runtime enrichment
  경로를 갖고 있다**(§5, §9)는 사실 — 문서33은 이 경로의 존재는 언급했지만
  end-to-end로 "실제로 작동해서 coverage가 느는지"까지는 실측하지 않았다. 이번
  STEP에서 read-only로 재확인한 결과 실제로 작동 중임을 확인(§1, coverage 자연
  증가가 그 증거).

## 2. AptSpecGrid 현재 구조

파일: `src/components/AptSpecGrid.tsx`. Props: `aptName`, `address`,
`aptInfo: Record<string,string>|null`, `buildYear: string|null`. 표시 순서/항목은
문서33과 동일(세대수 → 준공년월 → 용적률 → 건폐율 → 주차대수), 5칸 균등 grid.
값이 없으면 각 셀 독립적으로 안내 문구 + [제보/수정] 링크(항목 전체를 숨기는
로직 없음 — 문서33 §2와 동일).

## 3. 각 항목 source(재확인)

| 항목 | source | 단위 |
|---|---|---|
| 세대수 | 건축물대장 총괄표제부 `hhldCnt`(1순위) → 네이버 스크래핑(폴백) | 단지 전체 |
| 준공년월 | 실거래 데이터 `건축년도`(1순위, `apt-client.tsx`) / API 응답 자체는 총괄표제부 `useAprDay`(1순위) → 네이버(폴백) | — |
| 용적률 | 건축물대장 총괄표제부 `vlRat`(원본 그대로, 계산 없음) | 단지 전체 집계 |
| 건폐율 | 동일 응답 `bcRat` | 단지 전체 집계 |
| 총주차대수 | 동일 응답 `totPkngCnt`, `formatParking()`으로 "세대당 N.NN대 (총 N,NNN대)" 가공(나눗셈만, 추정 없음) | 단지 전체 집계 |

`getBrRecapTitleInfo`(총괄표제부)는 "여러 동으로 이뤄진 아파트 단지 전체 집계"
개념이라 특정 동/건물 값이 아니다(§11 재확인, 오매칭 아님).

## 4. legacy `Apartment` cache 구조(schema 재확인)

`prisma/schema.prisma` line 148-183. 필드: `name`, `dong`, `lawdCd`,
`communityFacilities`, `parkingCount`, `far`, `bcr`, `totalHouseholds`,
`approvalDate`, `jibun`, `updatedAt`. `@@unique([name, dong])`. 스키마 주석이
이제 "건축물대장 캐시 20건"으로 갱신돼 있어(§8 실측 18건 부산 기준과 정합),
코드 작성자도 최근 coverage 증가를 이미 인지하고 있었음을 보여준다.

`ApartmentMaster`(line 192-234)는 `far`/`bcr` 필드 자체가 없어 여전히 대체
불가(문서33 §8과 동일 결론).

## 5. 데이터 흐름 전체 추적

```
/apt/[name] → apt-client.tsx
  ├─ (URL에 lawdCd+dong 있으면) fetchAptInfo('', dong, lawdCd) 즉시 병렬 호출
  │    → /api/apt/[name]/info?jibun=&dong=..&lawdCd=..
  │    → jibun이 없으므로 fetchBuildingRegistryInfo는 라이브 조회를 시도조차
  │      하지 않는다(§9) — 이 첫 호출은 DB 캐시(이름 exact match)만 조회
  └─ fetchTrades() 완료 후, trades[0].jibun이 있으면
       → /api/apt/[name]/info?jibun=<실거래 지번>&dong=..&lawdCd=..
       → 이 두 번째 호출에서 캐시 미스면 fetchBuildingRegistryInfo 라이브 호출
         + 성공 시 legacy Apartment 테이블에 upsert(기존 코드, §9)
       → setAptInfo로 화면 갱신(초기 렌더 이후 값이 나중에 채워질 수 있음)
```

cache hit 조건(기존): `name`+`dong` 정확 일치 AND `parkingCount`/`far`/`bcr`/
`approvalDate` 4개 전부 not-null. cache miss 시 라이브 조회 → 성공하면
upsert(기존에도 있던 write 경로, 이번 STEP에서 새로 추가하지 않음).

## 6. 사용자가 실제로 본 정상 사례 — 역추적 완료

값(용적률 361.5%, 건폐율 53.5%, 세대당 0.82대·총 461대, 세대수 564세대)으로
`prisma.apartment.findMany({ where: { far, bcr, parkingCount 근사 } })`
read-only 조회 결과 정확히 일치하는 행을 특정했다:

```
남성한빛가든 / 서대신동3가 / lawdCd 26140 / jibun 161-13
far: 361.54, bcr: 53.46, parkingCount: 461, totalHouseholds: 564
updatedAt: 2026-08-15T06:46:36Z
```

세 값 모두 **DB cache(legacy Apartment 테이블) 기원**이며, 그 값 자체는
건축물대장 총괄표제부 API 원본을 그대로 저장한 것(계산값 아님, §3). 계산이
들어간 부분은 세대당 주차(`parkingCount / totalHouseholds`)뿐이고 이는 이미
UI에도 "세대당 0.82대"로 명시돼 있어 원본과 계산값이 혼동되지 않는다.

## 7. cache coverage 재실측(read-only, DB write 없음)

```
전체 Apartment cache row 수: 27
부산(lawdCd 26*) row 수: 18
  far not null: 18/18 (100%)
  bcr not null: 18/18 (100%)
  parkingCount not null: 18/18 (100%)
  totalHouseholds not null: 17/18
  approvalDate not null: 10/18
  far+bcr+parkingCount 모두 있음: 18/18 (100%)
```

문서33(15건) 대비 3건 증가 — §1에서 확인한 runtime enrichment가 실제로
작동하며 organically coverage를 늘리고 있다는 직접 증거.

## 8. cache-hit 값 정확도 cross-check(18건 전수 조회)

18건 전체를 조회해 이상치·중복을 확인했다. **값이 서로 다른 단지에 잘못
연결된 오매칭 사례는 0건.** 다만 흥미로운 패턴을 발견:

**같은 물리적 건물이 다른 이름으로 중복 캐시된 사례 3건** — `@@unique([name,
dong])`가 이름 문자열 기준이라, MOLIT 실거래 데이터에 등장하는 표기가 조금만
달라도(부속 명칭/접미사 차이) 별도 행으로 캐시된다:

| dong+jibun | 중복 이름 | far/bcr/parkingCount |
|---|---|---|
| 서대신동3가·769 | 대신더샵 / 대신더샵아파트 | 279.87 / 21.33 / 477 (완전 동일) |
| 서대신동2가·576 | 대신해모로센트럴 / 대신해모로센트럴아파트 | 258.71 / 17.19 / 800 (완전 동일) |
| 우동·1544 | 해운대동백두산위브더제니스 / …아파트 | 1105.37 / 62.28 / 446 (완전 동일) |

두 이름의 값이 **완전히 동일**하다는 것 자체가 오매칭이 아니라 "같은
건물, 다른 이름 표기"임을 뒷받침한다(잘못된 건물이 섞였다면 값이 달랐을
것). `해운대동백두산위브더제니스`의 용적률 1105.37%는 통계적으로 이례적으로
높지만, 초고층 주상복합형 타워로 실제 공공데이터 원본값 그대로이며(계산/추정
없음) 사용자에게 그대로 보여주는 것이 올바르다 — 임의로 수정하지 않았다.

## 9. cache-miss 원인 실측 — 두 가지 구분되는 유형 확인

### 9-1. 유형 A: 총괄표제부 자체에 데이터가 없음(6/6 표본)

부산 ApartmentMaster에서 캐시에 없는 소규모 단지 6곳(구덕금호/문화(2곳)/
충무제1/협성루에나센텀/스카이맨션/일광 — 전부 지번 확보됨)을 `apt-building-
info.ts`와 동일한 방식으로 read-only 라이브 조회(DB write 없이 직접
호출)했다. **6곳 전부 `totalCount: 0`**(해당 지번에 등록된 총괄표제부
자체가 없음). `getBrRecapTitleInfo`(총괄표제부)는 "여러 동으로 구성된
공동주택 단지" 개념 대상 오퍼레이션이라, 소규모/단독동 건물은 애초에 이
분류로 등록되지 않았을 가능성이 높다(추정이 아니라 API 응답 자체가
"결과 0건"으로 확정 응답). 이런 단지는 **runtime이든 batch든 이 API로는
영구히 채울 수 없는 구조적 한계**다.

### 9-2. 유형 B: 이미 다른 이름으로 캐시돼 있는데 재사용되지 못함

ApartmentMaster에서 대형 단지 위주로 확인한 결과, "엘지메트로시티1/2/4-1/
4-2/5"(전부 jibun 176-30, 용호동) 처럼 **이미 캐시된 "엘지메트로시티3"와
물리적으로 동일한 지번**인데 이름이 달라 캐시가 재사용되지 못하는 사례를
다수 확인(§8의 중복 3건과 근본 원인 동일, "레이카운티(2단지)"/"화명롯데
캐슬카이저" 등도 같은 유형으로 추정). 이 유형은 **이미 정확한 데이터가
DB에 있는데 조회 로직이 이름 exact match만 하기 때문에 놓치는 연결 버그**
— §21(허용 범위)의 "이미 존재하는 정확한 cache 데이터 연결 버그 수정"에
정확히 해당해 이번 STEP에서 수정했다(§12).

## 10. 외부 API 재확인

`BldRgstHubService/getBrRecapTitleInfo`(총괄표제부, 단지 전체). 입력:
`sigunguCd`(lawdCd) + `bjdongCd`(법정동코드, regcode 프록시로 조회) + `bun`/
`ji`(지번 분해). 건축물대장 다운로드 버튼(`/api/ledger`)이 쓰는
`getBrTitleInfo`(표제부, 동 단위)/`getBrExposInfo`(전유부, 호실 단위)와는
**완전히 다른 오퍼레이션**이며 `mgmBldrgstPk` 필드를 다루지 않는다 — 문서28의
B0.5 BLOCKER와 무관함을 코드로 재확인(문서33 §13과 동일 결론).

## 11. 데이터 단위 — 단지 전체 확정

§3, §10에서 재확인한 대로 세 값 모두 "총괄표제부"(여러 동으로 이뤄진 단지
전체 집계) 기준이며, 특정 동이나 건물 단위 값이 아니다. 특정 동 값을 단지
전체처럼 보여주는 구조가 아님을 확인 — BLOCKER 아님.

## 12. 구현 — jibun 기반 cache 재사용(최소 위험 수정)

`src/app/api/apt/[name]/info/route.ts`의 `fetchCachedRegistry()`에 보조
조회를 추가했다:

```ts
// 이름(aptName)이 MOLIT 실거래 원본 표기라 같은 건물이 여러 이름으로 등장할 수
// 있음(§9-2). 건축물대장 조회 자체가 이름이 아니라 지번으로만 대상을 특정하므로,
// 같은 dong+jibun이면 물리적으로 같은 건물이라고 봐도 안전하다 — 이름 유사매칭이
// 아니라 지번 정확히 일치일 때만 재사용한다.
if (jibun) {
  const byJibun = await prisma.apartment.findFirst({ where: { dong: dongKey, jibun } });
  if (byJibun && byJibun.parkingCount && byJibun.far && byJibun.bcr && byJibun.approvalDate) {
    return { ...byJibun 값... };
  }
}
```

**중요**: 이것은 "단지명 유사매칭"이 아니다 — `apt-building-info.ts`의 외부
API 호출 자체가 애초에 이름을 전혀 쓰지 않고 지번만으로 대상을 특정한다
(§10). 즉 "같은 지번 = 외부 API가 반환했을 값과 100% 동일"이 코드 구조상
보장된다. 문자열 부분일치·유사도 매칭과는 완전히 다른, 정확한 키 매칭이다.

**신규 DB write는 추가하지 않았다** — jibun으로 찾은 값을 그 응답에만
사용하고, 새 이름으로 별도 upsert하지 않는다(중복 행을 더 늘리지 않기
위한 보수적 선택). 다음 방문에도 같은 jibun 조회를 다시 하면 되므로(단일
인덱스 없는 27행짜리 테이블, 성능 문제 없음) 추가 write 없이도 매 요청에서
안전하게 재사용된다.

### 검증(read-only, DB write 없음)

- `curl .../엘지메트로시티1/info?jibun=176-30&dong=용호동&lawdCd=26290` →
  캐시에 없는 이름인데도 엘지메트로시티3의 값(용적률 300.8%, 건폐율 18.7%,
  세대당 1.71대·총 12,627대)을 즉시 반환. 라이브 외부 호출 없이 순수 DB
  조회로 해결됨(응답 즉시).
- `curl .../대신푸르지오1차/info?jibun=283&...` → 기존 이름 exact match
  경로 그대로 동작(회귀 없음, 기존 캐시값과 정확히 일치).
- `curl .../테스트단지/info?jibun=999&dong=서대신동3가&...` (같은 동 안에
  존재하지 않는 임의 지번) → `info: null`. 같은 동 안의 다른 건물 값으로
  잘못 채워지지 않음(정확한 지번 일치만 재사용됨을 확인).
- 수정 전/후 `prisma.apartment.count()` = 27건으로 동일 — 신규 write
  발생하지 않음을 확인.

## 13. UX 문구 개선 — "정보 준비중" → "정보 없음"

`src/components/AptSpecGrid.tsx`의 값 없음 상태 문구를 변경했다. §9-1에서
확인했듯 cache-miss의 상당수가 "아직 확인 전"이 아니라 "이 API로는 앞으로도
채워지지 않는 구조적 부재"다. "준비중"은 자동으로 곧 채워질 것 같은 인상을
주는데, 유형 A 단지는 [제보/수정](사용자 제보)를 통하지 않는 한 영구히
비어 있는다 — 거짓 기대를 주지 않기 위해 "정보 없음"으로 교체했다.

5칸 그리드 구조·CSS·[제보/수정] 링크·세대수/준공년월 표시 로직은 전혀
건드리지 않았다(문구 1줄만 변경, 레이아웃 변경 없음).

**C안(3개 항목을 "건축물대장 정보" 하나로 묶는 UI, 문서33 §17-18 제안)은
이번 STEP에서 구현하지 않았다** — 그리드 구조 변경이 필요해 "최소 수정"
범위를 넘고, 사용자 승인이 필요한 디자인 결정이라 다음 STEP 후보로
유보한다(문서33도 이미 같은 판단이었음).

## 14. 진입경로별 일관성

이번 수정은 `/api/apt/[name]/info` 라우트 자체(모든 진입 경로가 공유하는
단일 서버 엔드포인트)에서 이뤄져, 지도/AI검색/직접 URL 등 어느 경로로
들어와도 결과가 달라지지 않는다 — API가 경로에 무관하게 aptName+dong+jibun
파라미터만으로 응답을 결정하는 구조이기 때문에 구조적으로 보장된다(§12의
curl 테스트가 곧 모든 진입 경로가 호출하는 것과 동일한 엔드포인트 테스트).

## 15. 브라우저 실측

- **cache-hit(남성한빛가든)**: 사용자가 실제로 본 값(564세대, 1996년·30년차,
  용적률 361.5%, 건폐율 53.5%, 세대당 0.82대·총 461대) 그대로 재현. 회귀 없음.
- **cache-miss(구덕금호)**: 세대수/준공년월은 정상 표시(112세대, 2001년·
  25년차), 용적률/건폐율/주차대수 3칸은 "정보 없음"+[제보/수정]로 정상
  표시. 그리드 5칸 균등, 빈 칸/깨짐 없음.
- 모바일 뷰포트(390×844) 스크린샷은 이번에도 도구 제약으로 실제 좁은
  뷰포트 렌더링을 캡처하지 못했다(문서35/36과 동일한 한계, `resize_window`
  호출 후에도 캡처 해상도가 데스크톱 폭으로 반환됨). 다만 이번 STEP은
  CSS/grid 구조를 전혀 수정하지 않았으므로(문구 1줄 + 서버 로직만 변경)
  모바일 레이아웃에 미치는 영향은 구조상 없다고 판단한다.

## 16. 최종 데이터 전략 — 기존 A안(runtime enrichment)의 최소 확장

문서33이 제안한 4가지 선택지(A/B/C/D) 중, **A안(runtime enrichment)은 이미
구현돼 실제로 작동 중**임을 이번 STEP에서 확인했다(§1, §7의 15→18 자연
증가가 증거). 이번 STEP은 새 전략을 도입하지 않고, 이 A안의 사각지대
(§9-2, 이름 변형으로 인한 캐시 재사용 실패)만 좁게 고쳤다. B안(별도 batch
enrichment)·C안(ApartmentMaster 이전)은 이번 STEP 범위 밖으로 유보한다:

- B안(batch enrichment)은 §9-1에서 확인한 "유형 A"(총괄표제부 자체 없음)
  단지에는 애초에 효과가 없다 — 무엇을 batch로 돌려도 채워지지 않는 값을
  채우려는 시도가 되어 버린다. 효과가 있는 것은 "유형 B"(이름 변형)
  뿐인데, 이번 STEP의 코드 수정으로 이미 커버된다.
- C안(ApartmentMaster 이전)은 §4에서 재확인한 대로 `far`/`bcr` 필드 자체가
  스키마에 없어 여전히 불가능 — 스키마 변경이 필요한 사안으로, 이번
  STEP의 "schema 변경 금지" 원칙에 따라 진행하지 않는다.

## 17. 알려진 한계 / 후속 과제(구현하지 않음, 기록만)

1. **유형 A(총괄표제부 없는 소규모/구형 단지)는 이 API로 근본적으로
   채울 수 없다.** 다른 공공데이터(예: 개별 표제부 `getBrTitleInfo`, 단
   B0.5 BLOCKER 대상이라 별도 검토 필요) 또는 사용자 제보에 의존할 수밖에
   없다 — 별도 STEP/승인 필요.
2. C안(ApartmentMaster로 far/bcr 이전)은 스키마에 필드 추가가 필요해
   별도 설계·승인 필요.
3. "건축물대장 정보" 그룹 UI(문서33 §17-18의 C안)는 그리드 레이아웃
   변경이 필요해 별도 디자인 승인 필요.
4. 이번 STEP에서 고친 "이름 변형 재사용"은 jibun이 확보된 이후(2번째
   `/info` 호출)에만 동작한다 — 거래가 아예 없어 jibun을 못 얻는 단지는
   여전히 첫 방문 시 "정보 없음"으로 남는다(구조적 한계, 문서33 §12와
   동일).

## production code 변경 여부

**있음(최소).** `src/app/api/apt/[name]/info/route.ts`(jibun 보조 조회
추가, 21줄), `src/components/AptSpecGrid.tsx`(문구 변경 + 주석, 14줄).
DB/schema/migration 변경 없음, 신규 DB write 경로 추가 없음(§12).

## 생성/수정 문서

- 신규: `docs/development/38-apartment-detail-b2-spec-data-stability.md`(이 문서)
- 수정: `docs/development/CHANGELOG.md`(STEP 38 항목 추가, 기존 기록 유지)

## 최종 판단

APT DETAIL B2-1은 용적률/건폐율/주차대수의 실제 데이터 source(건축물대장
총괄표제부, 단지 전체 집계, 계산·추정 없음)와 cache coverage 문제를
코드·DB 실측(read-only)으로 재조사했다. 사용자가 실제로 본 정상 사례를
DB에서 역추적해 source가 정확히 캐시된 원본값임을 확인했다. cache-miss의
원인을 두 유형(총괄표제부 자체 없음/이름 변형으로 인한 재사용 실패)으로
구분하고, 안전하게 고칠 수 있는 후자만 최소 범위로 수정했다(지번 정확히
일치 시에만 재사용, 이름 유사매칭 아님, 신규 write 없음). 없는 데이터를
추정해 만들지 않았고, "정보 준비중"의 오해 소지 문구만 "정보 없음"으로
정정했다(레이아웃 변경 없음).

DB/schema/migration은 변경하지 않았고 commit/push 하지 않았다.

건축물대장 다운로드 BLOCKER, 차트, 교통/버스, 생활편의, 점수체계, 평면도,
홈/지도 UI 등 다른 STEP은 건드리지 않았다.

추가 batch enrichment·ApartmentMaster 스키마 확장·"건축물대장 정보" 그룹
UI는 별도 승인 필요 사안으로 기록만 하고 진행하지 않았다.
