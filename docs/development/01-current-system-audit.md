# 이집 현재 시스템 정밀 진단서

작성일: 2026-08-12
작성 기준: 코드/스키마 정적 분석 (읽기 전용, 소스코드 미수정, 라이브 DB row 수 등은 별도 조회하지 않음)

---

## A. Executive Summary

이집은 Next.js 16 / React 19 / TypeScript / Prisma(PostgreSQL, Supabase) 기반의 부동산 정보 서비스로, 지도·실거래·통계·학군·커뮤니티·AI 자연어 검색은 실제로 동작하는 수준까지 구현되어 있다. 그러나 "나에게 맞는 집을 골라주는" 추천 플랫폼으로 발전시키기 위한 핵심 전제 조건인 **"아파트 MASTER DB"는 사실상 존재하지 않는다** — `Apartment` 모델은 좌표·고유ID·전체주소조차 없는 건축물대장 캐시일 뿐이며, 모든 화면이 국토교통부(MOLIT) 실거래 API를 매 요청 라이브 호출해 이름+동 문자열 매칭으로 단지를 식별한다. 이 때문에 최근 12개월간 거래가 없는 단지는 지도/목록 어디에도 나타나지 않는 구조적 한계가 있다.

재개발·분양(청약) 기능은 DB 스키마와 일부 백엔드 스텁만 존재하고 사용자에게 노출되는 화면은 "준비 중" 카드 하나뿐이라 구현률은 15% 내외로 추정된다. 개인화 추천에 필요한 찜/선호/비교이력/알림 등의 데이터 모델은 전무하나, 로그인 사용자의 페이지뷰·검색 로그는 이미 개인 단위로 쌓이고 있어 콜드스타트용 암묵 신호로 즉시 활용 가능하다.

가장 시급히 인지해야 할 사항은 `/school` 페이지의 "평균 특목고 진학률" 수치가 **학교명 문자열 해시로 만들어진 가짜 데이터**이며 "(시 평균 상회)"라는 문구와 함께 실사용자에게 노출되고 있다는 점이다 — 이는 이 프로젝트가 스스로 표방하는 "데이터 없으면 임의의 값을 생성하지 않는다"는 원칙과 정면으로 배치되는, 이미 배포된 버그다.

Gemini는 AI 자연어 검색 의도 분류에서 대체가 어려운 지점(그룹 C) 1곳을 제외하면 대부분 폴백이 마련되어 있어 완전 의존은 아니다.

---

## B. 기술 스택

**프레임워크/언어**
- Next.js 16.3.0 (App Router, `src/app/`), React 19.2.8, TypeScript 5.9.3
- `next.config.ts`: `typescript.ignoreBuildErrors: true`(타입 에러 있어도 빌드 통과), `allowedDevOrigins`
- Next 16에서 `middleware.ts` 컨벤션이 `proxy.ts`로 개명됨(AGENTS.md가 명시한 "표준 Next.js와 다름"의 실제 사례) — `src/proxy.ts`가 `/admin/:path*` 가드
- ESLint 9 + `eslint-config-next` 16.3.0

**DB / ORM**
- Prisma 5.22.0, `provider = "postgresql"`, 실제 DB는 Supabase(PostgreSQL). Supabase JS SDK는 미사용(순수 Postgres 연결). 단, `scripts/crawl_facilities.py`는 Prisma를 거치지 않고 Supabase REST API로 직접 INSERT.

**인증**
- NextAuth(Auth.js) v4 + `@next-auth/prisma-adapter`, Kakao(내장) + Naver(커스텀 OAuth2 프로바이더)
- 세션 전략은 JWT(DB 세션 미사용). 관리자 가드는 `src/proxy.ts`(라우트) + `requireAdmin()`(서버 API) 이중 구조

**UI**: CSS Modules 전면 사용, Tailwind 없음
**지도**: `react-kakao-maps-sdk`(Kakao Maps), `@turf/turf`(지리 연산)
**차트**: `recharts`
**데이터 페칭/캐싱**: 클라이언트 `swr`, 서버는 Next `fetch` + 자체 인메모리 캐시(`src/lib/server-cache.ts`)
**외부 API 연동 방식**: MOLIT/K-APT/NEIS/Naver/Gemini 전부 SDK 없이 순수 `fetch` 직접 호출이 관례
**Gemini/AI**: 전용 SDK 미사용, `src/lib/gemini.ts`가 REST 직접 호출, 모델 `gemini-flash-lite-latest`, env `GEMINI_API_KEY`
**기타**: `fast-xml-parser`/`xml2js`(공공데이터 XML 파싱), `axios`(devDependency, 스크립트용)

---

## C. 프로젝트 구조

```
src/
├── app/            # 라우트 (페이지 + API)
├── components/     # 공용 UI 컴포넌트
├── lib/            # 서버 유틸/외부 API 연동
├── services/       # 공공데이터 서비스 레이어(분양/재개발)
├── contexts/       # React Context (지역 선택 등)
├── config/         # 사이트 설정
├── types/          # NextAuth 타입 확장
└── proxy.ts        # 관리자 라우트 가드(구 middleware)
```

| 영역 | 주요 파일 | 비고 |
|---|---|---|
| 지도 | `app/map/page.tsx`, `components/MapViewer.tsx`, `KakaoMapEmbed.tsx`, `KakaoPlaces.tsx` | 마커/가격표시 로직 집중 |
| 통계 | `app/stats/{page,statsMenu,stats-client}.tsx`, `api/stats/{dashboard,rankings,yearly}` | 16개 메뉴 그리드 |
| 단지상세 | `app/apt/[name]/{page,apt-client}.tsx` + 4존 구조 하위 컴포넌트들 | `api/apt/[name]/{route,info,facilities}` |
| 비교 | `/stats/[type]`의 `compare`, `multi-compare` 슬러그 | 별도 라우트 아님 |
| 학군 | `app/school/{page,school-client}.tsx`, `app/school/[id]` | `api/school/{route,apartments,stats}`, NEIS 라이브 조회 |
| 재개발 | `app/redevelopment/{page,redevelopment-client}.tsx` | `services/publicDataService.ts` |
| 분양 | (전용 페이지 없음, redevelopment 탭 공유) | `api/presales/route.ts`, `services/cheongyakService.ts` |
| 인증/사용자 | `api/auth/[...nextauth]`, `lib/auth.ts`, `LoginModal.tsx` 등 | `app/my/` |
| 검색 | `SearchFilter.tsx`(고아 컴포넌트), `ApartmentAutocomplete.tsx` | `api/log/search` |
| AI검색 | `app/ai-search/ai-search-client.tsx`, `lib/ai-search.ts`, `lib/gemini.ts` | `AiSearchCache`에 캐싱 |
| 관리자 | `app/admin/{dashboard,users}` | `api/admin/{dashboard,users,users/[id]}` |
| 로그 | `api/log/{view,search,error,heartbeat,leave}` | 30초 하트비트 폴링 |

---

## D. DB 구조

Enum: `Role`(GUEST/USER/VERIFIED/ADMIN), `PropertyCategory`(APT/OFFICETEL/LIVING_STAY/REDEVELOPMENT), `RedevelopmentStage`(6단계), `PresaleHouseType`(APT/OFFICETEL/URBAN/REMAIN)

| Model | 목적 | 실제 사용처 |
|---|---|---|
| User | 사용자 | `api/admin/*`, `api/community/*` |
| Account/Session/VerificationToken | NextAuth 표준 | adapter 내부용(JWT 전략이라 Session은 사실상 미사용) |
| Post/Comment | 커뮤니티 | `api/community/*` |
| Transaction/TradeHistory | **레거시(미사용)** | 스키마 주석: "라이브 앱에서는 사용하지 않음" — 실거래/전월세는 DB 미저장, MOLIT 라이브 조회 |
| Apartment | 건축물대장/커뮤니티시설 **캐시** (마스터DB 아님) | `api/apt/[name]/*` |
| AiSearchCache | AI검색 질의응답 캐시(30분 TTL) | `api/ai-search/route.ts` |
| Property | 오피스텔/생숙/재개발용 범용 매물(스텁, 현재 빈 테이블) | `api/properties` |
| RedevelopmentProject | 재개발 구역 | `api/properties`(연결 안 됨) |
| Presale | 분양/청약 | `api/presales`(연결 안 됨) |
| PageView/SearchLog/ActiveSession/ErrorLog | 로그 | `api/log/*`, `api/admin/dashboard` |
| Report | 신고(관리자) | 접수 UI 없어 항상 0건 |

**요청 카테고리별 저장 위치 요약**
- 아파트: `Apartment`(부가정보 캐시만, 목록 자체는 DB에 없음)
- 실거래/전월세: DB 미저장, MOLIT 라이브 조회
- 사용자: `User`(+Account/Session/VerificationToken)
- 관심단지: **모델 자체가 없음** — 기능 미구현
- 검색기록: `SearchLog` / AI검색캐시: `AiSearchCache`
- 학교/학군: DB 모델 없음, NEIS 라이브 조회
- 커뮤니티: `Post`+`Comment`(+`Report`)
- 재개발: `RedevelopmentProject` / 분양: `Presale`
- 광고: 전용 모델 없음(`AdContainer.tsx`는 env 토글 placeholder)
- 로그: `PageView`, `SearchLog`, `ActiveSession`, `ErrorLog`, `Report`
- 관리자: 전용 모델 없음, `User.role=ADMIN` + 로그 테이블 집계

---

## E. Apartment 데이터 현황

`Apartment` 모델(스키마 주석: "실거래가처럼 실시간 API가 있는 데이터가 아니라... 미리 채워둔 값을 상세페이지가 그대로 읽어 보여준다")은 `(name, dong)` 키의 **건축물대장 캐시**다.

| 필드 | 상태 |
|---|---|
| 고유 단지 ID | 없음 (MOLIT에 실세계 ID가 없어 근본적으로 불가) |
| 단지명 | 일부 (자유 텍스트, 정규화 안 됨) |
| 시도/시군구 | 외부 API에서만 사용 (저장은 `lawdCd`만) |
| 법정동 | 있음(`dong`) / 행정동 | 없음 |
| 도로명주소 | 없음 / 지번주소 | 일부(`jibun`, 지번 일부만) |
| 위도/경도 | **없음** (컬럼 자체가 없음) |
| 세대수 | 있음(`totalHouseholds`) / 동수 | 없음 |
| 준공일 | 없음 / 사용승인일 | 있음(`approvalDate`) |
| 건설사 | 없음 / 난방방식 | 없음 |
| 용적률/건폐율 | 있음(`far`/`bcr`) |
| 총 주차대수 | 있음(`parkingCount`) / 세대당 주차대수 | 없음(계산값) |
| 최고층 | 없음 / 평형·전용면적 | 외부 API(거래 단위)에서만 |
| 실거래/전월세/학교/재개발/분양 연결 | 전부 없음(FK 없음, 런타임 매칭) |

**판단: "아파트 MASTER DB"라고 부를 수 없다.** 좌표조차 저장하지 않고, 고유 ID·전체주소·건설사·동수·최고층 등 마스터DB 기본 요건이 모두 빠져 있으며, 이 앱에는 "전체 단지 목록" 개념 자체가 없다(코드 주석에서도 자인: "별도의 '단지 마스터 목록' 데이터가 필요한데 이 앱엔 아직 없다").

---

## F. 실거래 / 전월세 구조

- **API**: data.go.kr MOLIT RTMS (`RTMSDataSvcAptTradeDev`=매매, `RTMSDataSvcAptRent`=전월세, silv/officetel/villa 변형 포함), `src/lib/api-molit.ts`. Env: `DATA_GO_KR_API_KEY`.
- 매매/전월세는 동일 함수(`fetchMolitData`)를 `type`만 바꿔 호출 — 완전히 동일한 코드 경로.
- **호출 시점**: 서버사이드 전용, 사용자 요청마다 라이브 호출(지도 pan/zoom, 상세페이지 로드, "더보기" 클릭마다).
- **캐싱**: `revalidate:3600`(Next fetch 캐시) + `force-dynamic` 라우트는 별도 인메모리 TTL 캐시(`server-cache.ts`, 1시간). 전부 프로세스 인메모리라 서버리스 인스턴스 간 미공유, 재배포/콜드스타트 시 초기화.
- **DB 저장**: 없음. `Transaction`/`TradeHistory`는 죽은 레거시 모델.
- **지역코드**: URL 파라미터 → DB 캐시 → Kakao 지오코딩 → 하드코딩 기본값(`11680` 강남구 등) 순 폴백.
- **아파트-거래 매칭**: 이름 문자열 매칭만(ID 없음), 정규화 후 양방향 `includes()`, `dong` 필터로 좁힘.
- **동일 브랜드 오매칭 위험**: 실제 사례가 코드 주석에 명시(예: "롯데캐슬"이 여러 무관 단지를 끌어옴, "푸르지오"가 다른 동의 1차/2차를 혼동). `dong`을 못 구하면 위험 상존.
- **최근 거래 없는 단지**: 홈 "더보기"는 3개월 윈도우, 지도는 12개월 윈도우로 완화하지만 그 이상 거래가 없으면 앱 어디에도 나타나지 않음(대체 마스터 목록이 없으므로).

---

## G. 지도 구조

- **SDK**: Kakao Maps JS SDK(`react-kakao-maps-sdk`)
- **마커 데이터 출처**: 오직 `/api/transactions?months=12` — 최근 12개월 MOLIT 매매 데이터. `Apartment`/`Property`는 쿼리하지 않음.
- **좌표**: MOLIT엔 없음, `(dong, name)` 단위로 Kakao 키워드 검색 지오코딩, 인메모리 캐시만(DB 미저장, `Apartment`에 애초에 lat/lng 컬럼이 없음).
- **Clustering**: 커스텀 픽셀 근접 그룹핑(Kakao 네이티브 클러스터러 미사용) — 겹치는 마커도 개별 칩으로 모두 보이게 그리드 배치(사용자의 "칩 vs 배지" 선호와 일치).
- **Pan/zoom**: `dragend` 시 새 중심을 역지오코딩해 `lawdCd` 재계산 후 재조회, 줌만으로는 재요청 없음(재클러스터링만).
- **최근 거래 없는 단지**: 12개월 윈도우 밖이면 지도에서 완전히 사라짐 — 코드 주석에서도 "존재 근거가 없어 마커를 만들 수 없다"고 명시.
- **검증 — "실거래 데이터가 있어야 지도에 나타나는 구조인가?"**: **예.** 독립적인 단지 레지스트리가 없어 최근 12개월 무거래 단지는 구조적으로 지도에서 배제된다. 알려진 제약이지 우발적 버그가 아니다.

---

## H. 통계 기능

| 기능명 | 데이터출처 | 구현수준 |
|---|---|---|
| 최근하락/최고가/최고상승 | MOLIT(외부) | 정상 작동 (N=3 표본평균 방식) |
| 거래량 | MOLIT(외부) | 정상 작동 |
| 가격비교/여러단지비교 | 내부 `/api/apt/[name]` | 정상 작동(클라이언트 계산, 캐시 없음) |
| 갭투자 | MOLIT(외부) | 정상 작동, **단일 최신거래 비교로 이상치 취약**(다른 지표는 이미 N=3 평균으로 개선됐으나 이 함수만 예외) |
| 많이산단지/역전세 | MOLIT(외부) | 정상 작동(역전세는 반전세 오탐 버그 이미 수정 이력 있음) |
| 분위지도 | MOLIT+Kakao 좌표 | 정상 작동, **단지당 최신거래 1건 기준으로 5분위 산정**(이상치 취약) |
| 공급물량/인구변화/외지인비율/경사고도/대단지/인기단지 | 없음 | **정직한 stub**("coming soon" + 사유 명시, 검증 결과 사유 실제와 일치) |
| 학군 — 학교수/학원밀집도 | NEIS+Kakao(실데이터) | 정상 작동 |
| 학군 — 특목고 진학률 | **학교명 해시(가짜)** | 🚩 **목업 데이터가 "(시 평균 상회)" 문구와 함께 실사용자에게 노출 중** — 코드 스스로 "모의 진학률 산출 로직"이라 인정하면서도 화면엔 실통계처럼 표시됨. 이 앱의 자체 원칙(임의값 생성 금지)에 정면 위배되는 **이미 배포된 실사용자 노출 버그**. |
| 부동산 도구(계산기) | 클라이언트 계산 | 정상 작동, "추정치"라고 정직하게 고지 |

---

## I. Gemini 의존성

| 파일 | 기능 | 그룹 |
|---|---|---|
| `lib/ai-search.ts` → `classifyQuery()` | 자연어 질문→의도/조건 구조화 파싱 | **C** — 대체 시 별도 NLU 파서 신규 구축 필요, 실패 시 폴백 없이 검색 전체 중단(유일한 완전-중단 지점) |
| `lib/ai-search.ts` → `generateBriefing()` | 결과 요약 문장 생성 | **A** — 결정적 폴백 문장 이미 구현됨, 데이터 자체는 Gemini 없이도 100% 노출 |
| `lib/gemini.ts` | REST 호출 공용 래퍼 | 인프라(독자 기능 없음), 키 없으면 `null` 반환(예외 아님) |

- 캐시: `AiSearchCache`(질문+지역 해시, 30분 TTL) — 동일 질문 반복 시 재호출 없음.
- OpenAI/Claude 등 다른 생성형 AI 흔적 없음, Gemini만 사용. Env: `GEMINI_API_KEY`.

---

## J. 재개발 기능 현황

**구현률 약 15%** — UI 껍데기 + DB 스키마만 존재, 데이터 0건.

- 페이지(`/redevelopment`)는 있으나 정적 empty-state만 렌더링(fetch 로직 없음). 상세페이지 없음.
- `RedevelopmentProject` 모델은 존재하고 `GET /api/properties?category=REDEVELOPMENT`도 동작하지만, **어떤 화면도 이 API를 호출하지 않는 고아(orphaned) 엔드포인트**.
- 저장 함수(`upsertRedevelopmentProject`)는 구현됐으나 호출하는 크롤러/관리자UI/배치가 전무한 죽은 코드. 게다가 `zoneName`에 DB unique 제약이 없어 read-then-write 패턴이 동시성 상황에서 row 중복을 만들 수 있는 잠재 결함 존재.
- `/map`의 재개발 레이어 토글은 `COMING_SOON_LAYERS`에 걸려 있어 켜도 안내 배너만 뜸.
- 데이터 출처: 전국 통합 공공데이터가 없어 수동입력/지자체별 크롤러가 필요하다고 코드가 스스로 인정 — 샘플/가짜 데이터로 채우지 않고 정직하게 비워둔 점은 긍정적.

**향후 추천엔진용 후보 필드(구현 없이 목록만)**: `stage`, `targetHouseholds`, `lawdCd`, `lat/lng`, `polygonGeojson`(기존 필드) + 조합설립일/사업시행인가일/관리처분인가일/이주철거일/착공일/입주예정일, 시공사, 조합원수/일반분양 비율, 용적률·건폐율 변경 전후, 구역면적, 인근 기존 아파트와의 거리(FK 없음), 프리미엄 시세, 진행 지연 이력, 출처 신뢰도/최종확인일(신규 필드 후보).

---

## K. 분양 기능 현황

**구현률 약 15%** — 스키마와 미검증 수집 스텁만 존재, end-to-end 경로 전무.

- 전용 라우트 없음(재개발 탭 안의 "분양·청약" 서브탭도 정적 안내문만).
- `Presale` 모델은 비교적 잘 설계됨(청약홈 PK `houseManageNo` unique, status를 날짜에서 파생).
- `services/cheongyakService.ts`의 `syncApplyhomeListings()`는 **작성자 스스로 "엔드포인트/필드명을 라이브로 검증하지 못했다"고 명시한 미검증 스텁**이며, 이를 호출하는 크론/스크립트/관리자 액션이 전혀 없음.
- `GET /api/presales`는 동작하나 테이블이 항상 비어 있어 빈 배열만 반환.
- **스키마-매핑 불일치**: `latitude/longitude`, `minPrice/maxPrice` 컬럼이 있는데도 유일한 upsert 경로의 data 객체에 이 필드들이 아예 빠져 있음(향후 "필드가 있으니 붙이면 된다"는 오판을 유발할 함정).
- 관리자 대시보드가 청약홈 파이프라인을 **실제 호출 검증 없이 API 키 존재 여부만으로 "정상"이라 표시** — 오해 유발 소지.
- `SearchFilter.tsx`의 "분양권" 탭은 앱 어디서도 import되지 않는 고아 컴포넌트.

**향후 추천/미래가치 분석용 후보 필드**: `houseType`, `totalSupplyHouseholds`, 청약 타임라인 3종, `constructCompany`(브랜드 매칭), `locationAddress`(+향후 `lawdCd`), `RedevelopmentProject.stage`와의 느슨한 연결(재개발→일반분양 전환 신호), (미구현이지만 자리 있는) `minPrice/maxPrice`로 인근 시세 대비 분양가 갭, (미구현) 좌표.

---

## L. 관리자 기능

- **인증**: `Role`(GUEST/USER/VERIFIED/ADMIN) + `ADMIN_EMAIL` 부트스트랩 폴백, `requireAdmin()`(서버) + `src/proxy.ts`(라우트 매처) 이중 가드 — 신규 admin 페이지 추가 시 가드 누락 위험이 구조적으로 낮음.
- **데이터 등록/수정 UI**: 없음. Apartment/Property/RedevelopmentProject/Presale/AiSearchCache는 전부 오프라인 스크립트/서비스 레이어로만 채워짐.
- **광고 관리**: 없음. `AdContainer.tsx`는 env 토글 placeholder일 뿐 슬롯 편집 기능 없음.
- **로그/트래킹 대시보드**: 실제로 살아있음(20초 폴링, UV/PV/실시간접속/인기단지/인기검색어/공공API 헬스체크/에러로그 20건) — MOLIT은 실호출 검증, 청약홈/건축물대장은 키 존재만 확인(K 섹션의 오표시 문제와 동일 원인).
- **사용자 관리**: 목록 조회 + 강퇴(banned)만 가능, role 변경 UI 없음.
- **재개발/분양 관리**: 없음.
- **"지역별 추천 서비스 ON/OFF" 지원 가능성**: 인증/가드 인프라는 재사용 가능하고 `lawdCd`가 대부분 테이블에 이미 존재해 지역 키로 쓸 수 있으나, feature-flag를 저장할 모델·CRUD UI·서비스단 연동 지점이 전부 신규 구축 필요. "기존 admin 위에 얹는" 수준이지 전면 재설계는 아님.

---

## M. 사용자/행동 데이터

| 항목 | 상태 |
|---|---|
| 검색 기록 | 있음(부분) — `SearchLog`, 단 개인별 조회 UI 없음 |
| 관심단지(찜) | **없음** |
| 최근 본 단지 | 일부(비영속) — sessionStorage/PageView뿐, "내 목록" 화면 없음 |
| 비교 이력 | 없음(즉석 처리만) |
| 검색 조건 저장 | 없음 |
| 클릭 로그 | 일부(페이지 이동 단위만) |
| 사용자 선호 | 없음 |
| 추천 결과 저장 | 없음 |
| 알림 시스템 | 없음 |

**요약**: `PageView`/`SearchLog`에 로그인 사용자의 `userId`가 이미 남고 있어 "쓰기만 되고 읽지 않는" 원시 데이터가 축적 중 — 콜드스타트용 암묵 신호로 즉시 활용 가능. 그러나 찜/선호/비교이력/알림 등 "사용자 의도를 명시적으로 담는" 구조는 전무해 신규 설계 필요. 마이페이지(`app/my/`)에는 이런 데이터를 보여줄 자리 자체가 없음.

---

## N. 성능·비용·구조적 리스크

| 항목 | 위험도 | 근거 요약 |
|---|---|---|
| API 호출 과다 | 높음 | AI 조건검색 1건이 건축물대장+학교 검색 등 최대 30개+ 외부 호출을 팬아웃(`ai-search.ts:264-295`) |
| 동일 데이터 반복 조회 | 높음 | `apt/[name]/info`가 캐시 여부 무관 매 요청 네이버 스크래핑, AI검색 경로는 `Apartment` DB 캐시를 아예 안 거치고 별도 라이브 조회 |
| 외부 API 장애 의존 | 높음 | 지역코드 해석 전체가 제3자 개인 Cloud Run(`REGCODE_PROXY`) 단일 경로에 의존, 폴백 없음 |
| 단지 식별자 불안정 | 높음 | 전부 `name`+`dong` 문자열 매칭, `PageView.complexId`도 합성 문자열일 뿐 진짜 ID 아님 |
| 잘못된 아파트 매칭 위험 | 높음 | `includes()` 부분일치 기반, `dong` 미확보 시 브랜드명 충돌 가능 |
| Gemini 비용 | 중간 | 저비용 모델+캐시로 완화되나 요청빈도 제한(rate limit) 전무 |
| 지도 API 비용 | 중간 | 인메모리 지오코딩 캐시가 서버리스 인스턴스 간 미공유 |
| 캐시 부족 | 중간 | 영속 캐시는 `AiSearchCache`/`Apartment`뿐, 나머지 전부 인메모리(콜드스타트마다 리셋) |
| 지역코드 오류 가능성 | 중간 | 폴백 체인 말단이 하드코딩 기본값(강남구 등) |
| 데이터 최신성 | 중간 | 건축물대장은 오프라인 스크립트로만 갱신, 주기 실행 크론 없음 |
| Vercel 서버리스 제약 | 중간 | AI검색 순차 파이프라인(Gemini→외부팬아웃→Gemini)이 최악의 경우 타임아웃에 근접 가능 |
| DB 쿼리 과다(N+1) | 낮음~중간 | 인덱스는 적절, 관리자 대시보드 폴링만 다소 무거움(트래픽 낮아 위험 낮음) |
| 데이터 중복 | 낮음~중간 | Apartment/Property 필드 중복이나 의도적 설계로 문서화됨 |
| 보안상 위험한 코드 | 낮음 | 하드코딩 시크릿 없음, Raw SQL 미사용. 경미하게 `DATA_GO_KR_API_KEY` 일부(앞뒤 5자)가 에러 응답에 마스킹 노출 |

---

## O. 추천 플랫폼 전환 준비도

(수치는 정확한 측정값이 아니라 현재 코드 기준의 개발 준비도에 대한 정성적 평가)

| 항목 | 준비도 | 필요 작업 |
|---|---|---|
| 아파트 MASTER DB | 10% | 좌표/고유식별/전체주소/동수/최고층/건설사/난방방식 등 신규 컬럼 + 전체 단지 목록 확보 전략 필요 |
| 이집 단지점수 | 0% | 점수체계 자체 미설계, 원재료(실거래/학군/건축물대장)는 부분적으로 존재 |
| 사용자 조건 검색 | 40% | AI검색이 이미 조건 파싱(가격/주차/신축/학교근접 등) 수행 중 — 규칙 기반 병행/보강 여지 |
| 사용자 취향 | 0% | 선호 데이터 모델 전무 |
| 나와의 궁합 | 0% | 사용자 취향 + 단지점수 둘 다 없어 전제조건 미충족 |
| 추천 TOP5 | 0% | 추천 로직 자체 없음 |
| 추천 이유 | 10% | AI검색의 `generateBriefing()`이 "근거 문장 생성" 패턴은 이미 보유(그라운딩 방식도 검증됨) — 추천 이유 생성에 재사용 가능성 있음 |
| 추천 결과 지도 연동 | 30% | 지도 마커/클러스터링 인프라는 성숙, 추천 데이터 소스만 연결하면 됨 |
| 사용자 기준 단지 비교 | 50% | `multi-compare`/`compare` 통계 기능이 이미 라이브로 동작 중 |
| 지역별 추천 서비스 활성화 | 20% | 관리자 인증/가드 인프라 재사용 가능, feature-flag 모델·UI·서비스 연동은 신규 |

---

## P. 반드시 보호해야 할 기존 기능

| 기능 | 관련 파일 | 의존 데이터 | 변경 시 위험요소 |
|---|---|---|---|
| 지도 마커/클러스터링 | `app/map/page.tsx`, `MapViewer.tsx` | `/api/transactions`(MOLIT 라이브) | 마스터DB 도입 시 클러스터링·칩 레이아웃 로직과 새 데이터소스 통합 실수 가능 |
| 단지 상세페이지(4존 구조) | `app/apt/[name]/apt-client.tsx` 및 하위 패널들 | Apartment 캐시 + MOLIT + 네이버 스크래핑 | 이름+동 매칭 로직을 마스터DB ID 기반으로 바꿀 때 기존 URL/캐시 키 호환성 깨질 위험 |
| AI 자연어 검색 | `lib/ai-search.ts`, `api/ai-search/route.ts` | Gemini, `AiSearchCache`, 다수 내부 API | 그라운딩 가드레일(사실 기반 문장 생성)을 건드리면 환각 위험 재발 |
| 통계 16메뉴(정상 작동 항목) | `app/stats/*` | MOLIT 라이브 + 인메모리 캐시 | N=3 평균 등락률 로직은 과거 버그 수정 이력이 있어 회귀 주의 |
| 학군(학교수/학원밀집도) — 진학률 제외 | `app/school/*`, `api/school/*` | NEIS, Kakao Local | 진학률 가짜 데이터 제거 시 학교수/학원밀집도 정상 로직까지 실수로 건드리지 않도록 주의 |
| 관리자 대시보드 | `app/admin/dashboard`, `api/admin/dashboard` | PageView/SearchLog/ActiveSession/ErrorLog | 실시간 폴링 구조(20초/30초 하트비트) 변경 시 프레즌스 집계 깨질 위험 |
| 인증(Kakao/Naver OAuth) | `lib/auth.ts`, `proxy.ts` | NextAuth, `Role` enum | 관리자 가드 로직과 얽혀 있어 세션 전략(JWT) 변경 시 admin 접근 자체가 막힐 위험 |
| 커뮤니티(글/댓글/신고) | `app/community/*`, `api/community/*` | `Post`/`Comment`/`Report` | 마스터DB 도입 시 `Post.aptName` 문자열 태그가 새 단지 식별자와 어긋날 위험 |

---

## Q. README 평가

`create-next-app` 기본 템플릿 그대로.

- 프로젝트 설명: 없음(이집이 무엇인지 소개 전무)
- 설치법: `npm run dev`만 안내, `postinstall: prisma generate`/`prisma db push` 등 실제 필요 단계 누락
- 환경변수 설명: 전혀 없음(`.env.example` 없음). 실제 참조되는 변수는 최소 16개(`DATABASE_URL`, `DATA_GO_KR_API_KEY`, `GEMINI_API_KEY`, Kakao/Naver 관련 4종, `NEIS_API_KEY`, `NEXTAUTH_SECRET`, `ADMIN_EMAIL` 등)
- 운영/배포 설명: 없음(middleware→proxy.ts 개명, Supabase 풀러/IPv6 이슈 등 실제 겪은 문제 미문서화)

**업데이트 시점 제안**: 지금 당장 급하지 않음. (1) 협업자 합류/코드베이스 인계 직전, (2) 새 환경 재배포/DB 재프로비저닝 시점, (3) STEP 1 이후 별도 "문서 정리" STEP이 편성될 때 `.env.example`과 함께 정비 권장.

---

## R. 핵심 문제 TOP 10

1. **[데이터 무결성, 심각]** `/school`의 "평균 특목고 진학률"이 학교명 해시로 만든 가짜 수치이며 "(시 평균 상회)" 문구와 함께 실사용자에게 노출 중 — 자체 원칙 위배, 이미 배포된 버그.
2. **아파트 MASTER DB 부재** — `Apartment`는 좌표·고유ID·전체목록이 없는 부가정보 캐시일 뿐, 추천 시스템의 전제조건이 충족되지 않음.
3. **지도가 최근 12개월 무거래 단지를 구조적으로 누락** — 독립 단지 레지스트리가 없어 발생하는 알려진 한계.
4. **재개발/분양 기능 구현률 약 15%** — DB 스키마만 있고 UI/데이터수집 파이프라인 전무, 저장 함수는 죽은 코드.
5. **단지 식별자가 이름+동 문자열 매칭에 전면 의존** — 브랜드명 충돌 오매칭 위험이 실사례로 문서화되어 있음에도 구조적으로 상존.
6. **지역코드 해석이 제3자 개인 Cloud Run 프록시(`REGCODE_PROXY`) 단일 경로에 의존, 폴백 없음** — 단일 장애점.
7. **AI검색 `classifyQuery()` 실패 시 폴백 없이 검색 기능 전체 중단** — 유일한 Gemini 완전-의존 지점.
8. **개인화 추천에 필요한 찜/선호/비교이력/알림 데이터 모델이 전무** — 마이페이지에 이를 보여줄 자리조차 없음.
9. **갭투자/분위지도 통계가 단일 최신거래 기준이라 이상치에 취약** — 같은 파일 내 다른 지표는 이미 N=3 평균으로 개선된 패턴이 이 둘에는 미적용.
10. **관리자 대시보드가 청약홈/건축물대장 파이프라인을 실제 호출 검증 없이 "API 키 존재"만으로 정상 표시** — 운영 중 실패를 늦게 발견할 위험.

---

## S. STEP 2로 넘어가기 전 권고사항

- STEP 2(아파트 MASTER DB 설계) 착수 시, 본 진단서 E섹션의 "없음/일부" 필드(좌표, 고유식별, 전체주소, 동수, 최고층, 건설사, 난방방식)를 우선 채우는 것을 설계 목표로 삼을 것을 권고한다.
- 단지 식별자 불안정(R-5) 해결이 MASTER DB 설계의 핵심 목표가 되어야 한다 — 다만 이전 세션 기록상 "MOLIT에는 안정적 단지 ID가 없다"는 근본 제약이 이미 확인된 바 있어, ID 자체 발급(내부 생성) 전략이 필요할 수 있다.
- 재개발(`RedevelopmentProject`)·분양(`Presale`) 테이블은 현재 `Apartment`/`Property`와 FK 관계가 전혀 없다 — STEP 3(연결 구조 설계) 범위이지만, STEP 2에서 MASTER DB 스키마를 짤 때 이 두 테이블과의 향후 연결 가능성(예: `lawdCd`/좌표 기반 근접 매칭)을 염두에 두고 설계하면 STEP 3 재작업을 줄일 수 있다.
- `/school` 특목고 진학률 가짜 데이터(R-1)는 STEP 1의 조사 범위를 벗어난 별도의 시급한 이슈로 판단된다 — STEP 2 착수 전에 별도로 처리할지, STEP 2~3 진행과 병행할지 사용자 판단이 필요하다(이번 STEP에서는 코드 수정 금지 원칙에 따라 조사만 하고 건드리지 않았다).
- 지역별 추천 서비스 ON/OFF(로드맵의 지역 확장 전략)를 위해서는 `FeatureFlag`/`Region` 성격의 신규 설정 테이블이 필요하다는 점을 STEP 2 스키마 설계 시 함께 고려할 것을 권고한다.
- 사용자 개인화(찜/선호/비교이력) 데이터 모델은 STEP 7(사용자 조건 및 취향 모델 설계)의 범위이나, `PageView`/`SearchLog`에 이미 쌓이고 있는 `userId` 기반 로그를 콜드스타트 신호로 재사용하는 방안을 그 시점에 함께 검토할 것을 제안한다.
