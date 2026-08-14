# STEP 25 — PROJECT ROADMAP R1: 현재 구현 상태 전수점검 + 다음 개발 우선순위 확정 조사

상태: 조사 완료 / 다음 STEP 결정 대기

성격: 조사·정리 전용(코드/DB/schema/env/Vercel/Supabase 변경 없음, commit/push 없음). 기준 commit
`e991060374cc2a2bf3b01f1f08a9eec521995dd7`.

---

## 0. 조사 방법

- `docs/development/` 전체 29개 파일(문서 26개 + CHANGELOG + DECISIONS + 00-ROADMAP)을 직접 읽거나(20-24번은 이번 세션에서 직접 작성해 이미 숙지) 병렬 조사 에이전트로 전수 확인(01~15번, 17개 문서).
- `src/app/**` 전체 route/page(33개 API route, 20개 page.tsx)와 핵심 컴포넌트(Header, home-client, map/page.tsx, stats 등)를 조사 에이전트로 확인.
- `src/app/api/**` 33개 라우트 전수 조사(목적/DB/외부API/캐시/ErrorLog 연결 여부).
- 아파트/재개발/커뮤니티/MY·로그인/SEO 5개 영역을 조사 에이전트로 확인.
- Prisma 20개 model 사용 현황은 `grep -rl "prisma\.<model>\."`로 직접 교차검증(문서 서술만 믿지 않음).
- 문서에 적힌 내용은 가능한 한 코드 근거와 대조했다 — 특히 M4-C 의미는 문서14 원문(§AB, §F)에서 직접 확인했다(추측 아님).

---

## 1. 문서 전수 조사 요약

### 1-A. STEP 0~1.5 (기반 진단)

| STEP | 문서 | 상태 | 핵심 결론 |
|---|---|---|---|
| STEP 0 | (00-ROADMAP 내) | 완료 | 개발 기록 체계 구축 |
| STEP 1 | `01-current-system-audit.md` | 완료(최초 감사) | Apartment 모델은 마스터DB 아님(준비도 10%), `/school` 특목고 진학률 **해시 기반 가짜 데이터** 발견(최우선 이슈), 지도는 무거래 단지 구조적 누락, 재개발 구현률 약 15%(스키마만), 단지 식별이 이름+동 문자열 매칭 전면 의존, REGCODE_PROXY 단일장애점 |
| STEP 1.5-A | `01-5A-school-data-integrity.md` | 완료 | `/school` 가짜 수치 전부 제거, "데이터 준비 중"으로 대체 |
| STEP 1.5-B | `01-5B-admin-api-status-integrity.md` | 완료(사용자 승인) | 관리자 대시보드 "공공 API 상태"를 5단계(정상/설정됨/미연동/확인필요/오류)로 정정 |
| STEP 1.5-C | `01-5C-ai-search-fallback.md` | 완료(사용자 승인) | AI검색 Gemini 실패 시 지역명 기반 폴백 추가(완전 중단 방지) |

**Gemini 의존성(STEP1 결론)**: `classifyQuery()`(의도분류)는 그룹 C(대체 어려운 지점)였으나 STEP 1.5-C에서 지역명 인식 폴백이 추가되어 완화됨. `generateBriefing()`(요약문 생성)은 그룹 A(결정적 폴백 있음, 데이터 자체는 Gemini 없이도 100% 노출). **결론: 부분 완화됨(완전 의존 지점 1곳이 STEP 1.5-C로 줄어듦), OpenAI/Claude 등 다른 생성형 AI 사용 없음.**

### 1-B. P1~P2 (분양/청약홈)

| STEP | 문서 | 상태 | 핵심 결론 |
|---|---|---|---|
| P1 | `02-presale-api-analysis.md` | 완료 | 청약홈 API 연동 가능성 확인, 필드명 버그 발견 |
| P2-A | `03-presale-data-policy.md` | 완료 | 저장정책 확정(분양가 단위=만원, 언론보도 교차검증) |
| P2-B | `04-presale-db-integration.md` | 완료 | `Presale`/`PresaleHouseTypeDetail` schema 도입, 8건 검증 |
| P2-C | `05-presale-sync-operations.md` | 완료 | 동기화 정책 확정(area_only 좌표 저장 금지), 관리자 수동 트리거 UI |
| P2-C2 | `06-presale-initial-backfill.md` | 완료 | **Presale 1,046건, PresaleHouseTypeDetail 5,395건** 백필(최근 3년), 좌표 728건(69.6%) |
| P2-D1 | `07-presale-ui-ux-design.md` | 완료 | 분양 화면 설계, `/presales/[id]`(PK 기반 URL) 확정 |
| P2-D2 | `08-presale-list-ui.md` | 완료(모바일 승인) | `/presales` 목록 구현 |
| P2-D3 | `09-presale-detail-ui.md` | 완료(모바일 승인) | `/presales/[id]` 상세 구현(B3/B4 이전 버전) |
| P2-D4-A | `10-presale-location-market-analysis.md` | 완료(판단 B) | Apartment Master 부재로 주변 아파트 비교 보류 판정 |

### 1-C. MASTER M1~M4 (Apartment Master)

| STEP | 문서 | 상태 | 핵심 결론 |
|---|---|---|---|
| M1 | `11-apartment-master-analysis.md` | 완료 | `aptSeq`(MOLIT)를 핵심 식별자로 확정, REGCODE_PROXY 우회 경로 발견 |
| M2 | `12-apartment-master-design.md` | 완료 | ApartmentMaster schema 설계, 전북 LAWD_CD 45→52 이관 발견 |
| M3 | `13-apartment-master-m3-pilot.md` | 완료 | 부산 서구+해운대 **33건** 실제 구축(pilot) |
| M4-A | `14-apartment-master-m4-expansion-analysis.md` | 완료 | 부산 전체 확장 조사, 건축물대장 실패 원인 재규명(건물 형태), **M4-C = 무거래 단지 보강 + 실거래 DB 캐시로 명시적 분리·후속 과제화(미착수)** |
| M4-B | `15-apartment-master-m4-busan-build.md` | 완료(사용자 승인) | 부산 16개 구·군 전체 구축, **ApartmentMaster 3,402건**(좌표 90.2%) |

### 1-D. P2-D4-B (분양 상세 지도/주변비교) — 문서16~24

문서16(B 조사)→17(B1 API)→18(B2 API)→19(B3 UI)→22(B3-FIX)→23(B4-A 조사)→24(B4 구현) 순서로 전부 **완료 / 사용자 최종 승인**. 사이에 병행 진행된 INFRA I1(문서20, 조사 완료·최종 승인)/I2-A(문서21, 관측성 보강 완료·최종 승인)도 완료. 상세는 이번 세션 작업 내역 그대로(추가 조사 불필요).

### 1-E. 문서 전수 결론

- **완료(사용자 승인까지 끝난) STEP**: 0, 1, 1.5(A/B/C), P1, P2-A~D4(B/B1/B2/B3/B3-FIX/B4/B4-A), M1~M4-B, INFRA I1, INFRA I2-A = **총 20개 이상의 완결된 STEP**.
- **명시적으로 미착수·후속 분리된 항목**: M4-C(무거래 단지 보강+실거래 캐시), INFRA I2-B(region/pooler 구조 변경).
- **⚠️ 중요 발견**: `00-PROJECT-ROADMAP.md`(최초 로드맵)는 "STEP 2~15 = 대기" 상태로 남아 있다. 그런데 실제로 지난 세션들에서 진행된 작업(P1~P2-D4, M1~M4-B, INFRA I1/I2-A)은 이 STEP 2~15 번호 체계에 속하지 않는 **별도 트랙**이다. 즉 원래 로드맵(아파트 마스터DB→점수체계→추천엔진→홈 개편)의 "STEP 2"에 해당하는 것이 사실상 M1~M4-B로 이미 상당 부분 진행됐지만, 로드맵 문서 자체는 갱신되지 않아 "대기"로 표시된 채 방치돼 있다. **00-PROJECT-ROADMAP.md는 현재 실제 진행 상황을 반영하지 못하는 stale 문서로 판단한다** — 이번 R1 문서가 사실상 그 갱신판 역할을 한다.

---

## 2. Route/Page 전수 조사 (20개 page.tsx)

| 라우트 | 파일 | 상태 |
|---|---|---|
| `/` | `page.tsx`→`home-client.tsx` | 완료(AI검색 히어로+추천프롬프트+Quick메뉴, 전부 정적 링크+광고, 자체 API 호출 없음) |
| `/map` | `map/page.tsx`(911줄) | 완료(apt/school 실데이터, officetel/생숙/재개발/경공매 4종은 정직한 "준비 중" 배너) |
| `/stats` | `stats/page.tsx`→`stats-client.tsx` | 완료(16항목 그리드, 10 실데이터+6 정직한 준비중) |
| `/stats/[type]` | `stats/[type]/page.tsx` | 완료(슬러그별 동적 라우팅, 미확인 슬러그 404) |
| `/redevelopment` | `redevelopment-client.tsx` | **UI 껍데기뿐**(탭만 있고 데이터 fetch 로직 자체가 없음, 항상 "준비 중" 고정 문구) |
| `/presales` | `presales-client.tsx` | 완료 |
| `/presales/[id]` | `presale-detail-client.tsx` | 완료(B1~B4 전부 반영) |
| `/apt/[name]` | `apt-client.tsx`(821줄) | 완료(실거래 타임라인/시세/학군/커뮤니티 4구역, MOLIT 라이브+건축물대장/네이버 캐시) |
| `/school` | `school-client.tsx` | 완료 |
| `/school/[id]` | `school-detail-client.tsx` | 완료 |
| `/community` | `page.tsx` | 완료(SWR 목록) |
| `/community/[id]` | `post-client.tsx` | 완료(상세, 수정 API는 있으나 수정 UI 없음) |
| `/community/write` | `page.tsx` | 완료(작성만, 수정 모드 없음) |
| `/ai-search` | `ai-search-client.tsx` | 완료 |
| `/tools` | `page.tsx` | 완료(세금/대출 계산기 = 명시적 "간단 모의 로직", 안전계약체크/경공매비교/임장노트 4탭) |
| `/terms`, `/privacy` | 정적 페이지 | 완료 |
| `/my` | `page.tsx` | **최소 기능만**(프로필+역할뱃지+커뮤니티 바로가기+관리자 링크, 찜/최근본항목/알림 없음) |
| `/admin/dashboard` | `page.tsx` | 완료(실데이터 대시보드, 20초 폴링) |
| `/admin/users` | `page.tsx` | 완료(목록+강퇴, role 변경 UI 없음) |

**하단 네비게이션**: `Header.tsx`가 상단바+하단탭바(홈/지도/통계/재개발·분양/MY)를 CSS로 겸함(모바일 미디어쿼리로 하단 고정). `/map`만 Header를 아예 안 쓰고 자체 `MapBottomNav`를 구현(풀스크린 커스텀 UI라 상단 로고바가 지도를 가리는 것을 막기 위함) — 이 방식이 유일한 예외이며 다른 페이지가 중복 구현한 사례는 없음.

---

## 3. API Route 전수 조사 (33개)

전체 인벤토리는 조사 에이전트가 이미 표로 상세 정리했다(도메인별: 아파트 6개/분양 5개/학교 3개/통계 3개/커뮤니티 6개/관리자 4개/로그 5개/기타 2개, 총 33+auth 1개... 정확히는 33개 route.ts 파일). 핵심만 요약:

- **캐시 정책**: `getOrSetCache`(in-memory, TTL 5분~1시간)를 아파트 실거래/학교/통계/분양-주변비교 라우트가 광범위하게 사용. `ai-search`는 별도 DB 캐시(`AiSearchCache`, 30분).
- **ErrorLog(`logServerError`) 연결 현황**: **분양(presales) 전체 5개 + ai-search + apt/[name]**만 연결됨. 학교 3개/통계 3개/커뮤니티 6개/관리자 3개/기타 매물(transactions/ledger/properties) 3개는 전부 `console`에만 의존 — **구조적 관측성 공백이 분양 외 전 영역에 존재**(INFRA I2-A는 분양 도메인에만 적용됐음을 재확인).
- **admin 영역**: dashboard(실데이터 다중 카드)/users(목록+ban)/presales/sync(수동 트리거)뿐. **신고(Report) 처리 API는 존재하지 않음**(count 표시만).

---

## 4. Prisma Model 20개 사용 현황 (직접 grep 교차검증)

| 분류 | Model | 근거 |
|---|---|---|
| **A. 실사용(핵심)** | `Presale`, `PresaleHouseTypeDetail` | 분양 전 영역(B1~B4) |
| | `ApartmentMaster` | `nearby-apartments.ts` 1곳에 집중돼 있으나 B1~B4 전체가 이를 경유 — 3,402건 실데이터 |
| | `User`, `Account`, `Session`, `VerificationToken` | NextAuth `PrismaAdapter`(`src/lib/auth.ts`)가 내부적으로 관리, 앱 코드가 직접 쿼리하지 않음(정상 패턴) |
| | `Post`, `Comment` | 커뮤니티 CRUD 전체 |
| | `PageView`, `SearchLog`, `ActiveSession` | 관리자 대시보드 실시간 지표 + 로그 API 5종 |
| | `ErrorLog` | 분양+ai-search+apt 상세만(§3 공백 참고) |
| **B. 부분 사용** | `Apartment` | 20건뿐, `/api/apt/[name]/info`,`/facilities` 캐시 용도로만 사용, 좌표 없음 |
| **C. 사실상 미사용/스텁** | `Property` | `publicDataService.ts`+`/api/properties`뿐, 0건, 호출 화면 없음(orphan) |
| | `RedevelopmentProject` | 위와 동일 경로, 0건, UI가 이 API를 호출하지 않음(orphan) |
| | `Report` | 스키마만 존재, 신고 UI/API 전무, admin 대시보드에서 count(항상 0)만 표시 |
| | `Transaction`, `TradeHistory` | 코드 전체 0건 사용(schema 주석에도 "라이브 앱 미사용" 명시된 구시대 모델) |
| | `AiSearchCache` | 1곳(ai-search route)에서만 사용 — A로 볼 수도 있으나 단일 캐시 테이블 성격이라 별도 표기 |

---

## 5. 외부 데이터 소스 조사

| 소스 | 용도 | 호출 방식 | 캐시/실패 처리 |
|---|---|---|---|
| **MOLIT**(국토부 실거래) | 아파트 실거래(전 영역), 분양-주변비교, 통계 3종 | `src/lib/api-molit.ts` 단일 클라이언트, 매 요청 실시간 | `getOrSetCache`(1시간, lawdCd+월 단위), 실패 시 에러 플레이스홀더 |
| **건축물대장**(data.go.kr) | 세대수/용적률/건폐율/준공연도 | `apt-building-info.ts`, `ledger`, `school/apartments` | DB upsert가 사실상 캐시(Apartment 모델) |
| **Kakao** | 지오코딩/키워드검색/카테고리검색(학원)/지도SDK | REST 직접 호출(JS 키를 KA/Origin 헤더 우회로 재사용) + 클라이언트 SDK | 라우트별 개별 in-memory 캐시 |
| **청약홈**(odcloud.kr) | 분양 데이터 동기화 | `cheongyakService.ts`, **관리자 수동 트리거만**(자동 크론 없음) | 없음(1회성 배치) |
| **Gemini**(`gemini-flash-lite-latest`) | AI검색 의도분류+요약 | `src/lib/gemini.ts`, `ai-search` 라우트 1곳만 | `AiSearchCache`(30분), 실패 시 지역명 폴백(§1-A) |

---

## 6. 아파트 영역

- 독립 목록 페이지 **없음**(검색 자동완성으로만 진입, `/map`·`/stats`·`RegionSelectModal`에서 재사용).
- 상세페이지(4구역: 요약/실거래/환경·학군/커뮤니티)는 실데이터 기반으로 완성도 높음. 단, 단지 마스터DB(ApartmentMaster)와 아직 연결되지 않아 여전히 이름+동 문자열 매칭에 의존(감사STEP1이 지적한 구조적 리스크가 아파트 상세 자체에는 아직 해소 안 됨 — ApartmentMaster는 현재 "분양 주변비교"에만 쓰이고 있음).
- **UI 재검토 후보**: 이 세션에서 B3/B4로 정리한 분양 상세와 비교하면, 아파트 상세(`apt-client.tsx`, 821줄)는 그 이전 세대 UI 패턴(더 많은 섹션, 탭 구조)이라 spacing/카드 스타일 일관성 재검토 후보로 표시한다(수정하지 않음, 후보로만 기록).

## 7. 재개발 영역

**구현률 낮음** — UI는 탭만 있는 정적 empty-state, API 자체가 없음(`/api/redevelopment*` 미존재), `RedevelopmentProject` 모델은 0건 orphan. 크롤러/수동입력 파이프라인 전무. STEP1 감사(15%)와 사실상 동일한 상태가 유지되고 있다 — **이번 세션 작업(P2-D4)은 재개발을 전혀 건드리지 않았으므로 당연한 결과**.

## 8. 커뮤니티 영역

작성/댓글/삭제/고정(관리자)은 실제 작동. **수정 UI 없음**(API는 존재), **신고 기능 전무**(모델만 존재). 관리자 전용 모더레이션 화면(신고 처리, 일괄 관리)도 없음.

## 9. MY / 로그인 영역

로그인(카카오·네이버 OAuth, JWT 세션)은 실제 작동. MY 페이지는 프로필+바로가기 수준. **관심단지(찜)/최근 본 항목/알림/설정 기능은 DB 필드 자체가 없어 완전 미착수**(schema에 favorite/bookmark 관련 필드·모델 0건, 직접 grep 확인).

## 10. SEO 상태

robots.ts/sitemap.ts 존재(커뮤니티 게시글까지 동적 포함). **`/apt/[name]`, `/presales/[id]`, `/redevelopment` 전부 sitemap 미등록** — 핵심 콘텐츠가 검색엔진에 노출되지 않는 구조적 공백. `generateMetadata`는 apt(파라미터 기반)·presales(DB 조회 기반, 더 정교함) 둘 다 구현됨. JSON-LD 구조화 데이터는 프로젝트 전체 0건.

## 11. INFRA 상태 (이번 세션 직접 확인)

- **INFRA I1**(문서20): 완료/최종 승인. Session Pooler(서버리스 비권장) 구조 확인, region cross(iad1↔ap-northeast-2) 확인. **구조 변경은 하지 않음**.
- **INFRA I2-A**(문서21): 완료/최종 승인. 분양(presales) 4개 API에만 `logServerError` 연결. **실제로 이 로깅 덕분에 이번 세션 중 Session Pooler 소진(EMAXCONNSESSION, pool_size:15) 실제 사고를 원인까지 규명한 전례가 있음**(문서21/CHANGELOG 기록).
- **INFRA I2-B**: 미착수(region/pooler 변경) — I2-A 관측 데이터가 더 쌓인 뒤 판단하기로 결정된 상태 그대로.
- **dev/prod DB 분리 여부**: `.env`(DATABASE_URL/GEMINI_API_KEY/SUPABASE_KEY/SUPABASE_URL)와 `.env.local`(NEXTAUTH/카카오/네이버/NEIS/DATA_GO_KR 등 나머지 키)로 파일은 나뉘어 있으나, **DATABASE_URL은 `.env` 하나뿐 — 로컬 개발과 production이 동일 Supabase DB를 공유하는 구조**(분리 없음). 이는 INFRA I1이 지적한 위험과 결합되어 실제로 이번 세션 중 로컬 테스트가 production 장애를 유발한 사고의 근본 원인이었다(§11 위 참고).
- **backup/monitoring/rate limit**: 이번 조사 범위에서 별도 backup 정책, APM/모니터링 도구, API rate limit 미들웨어를 코드에서 발견하지 못했다 — **확인 필요/미구현으로 기록**(Vercel/Supabase 대시보드 자체 기능 사용 여부는 코드로 확인 불가).

## 12. 정책/세제 개인화 기능 (§22 요청 — 향후 로드맵 후보 기록만)

무주택/1주택/다주택, 실거주/투자 목적, 지역, 예산 등 사용자 상황에 따라 정책/세제/규제 변화를 설명·추천하는 기능은 **현재 코드/schema 어디에도 착수 흔적이 없다**(User 모델에 관련 필드 없음). 로드맵 후보로만 기록하며, **법률/세무 확정 판단 도구가 아니라 근거·기준일·출처를 명시하는 의사결정 보조 구조로 설계해야 한다**는 원칙을 이번 문서에 남긴다. 착수 시점은 최소한 개인 맞춤 추천(User 조건 모델, 로드맵 STEP 7)이 어느 정도 갖춰진 이후가 자연스럽다 — 그 전에는 "누구에게 보여줄지"를 정의할 사용자 데이터 자체가 없다.

## 13. 매물 증감 기능 (§23 요청 — 향후 로드맵 후보 기록만)

지역별/단지별 매물 수 증감 기능도 착수 흔적 없음. 데이터 수집처(네이버부동산 등) 자체가 약관/법적 문제 소지가 있어 **이번 조사에서도 구현 대상으로 판단하지 않는다** — 별도 법적 검토가 선행돼야 하는 항목으로만 기록.

## 14. UI 리뉴얼 원칙 (§24 요청 — 기록)

사용자 결정: 기존 구현 화면을 일괄 리뉴얼하지 않고, B3/B4에서 실제로 적용한 순서(**화면 하나 → 기능 확인 → 데이터 확인 → UI 설계 → 사용자 확인 → 구현 → 모바일 검수 → 최종 승인**)를 다음 화면 재검토에도 동일하게 적용한다. 이 원칙을 이번 로드맵에 공식 반영한다 — §26 다음 STEP 후보 선정에도 이 원칙(작은 단위로 쪼개 검수 사이클을 돈다)을 그대로 적용했다.

---

## 15. 기능 상태 분류 총괄

### [완료]
분양 전체(P1~P2-D4-B4, B1~B4), Apartment Master(M1~M4-B), INFRA I1/I2-A, STEP0/1/1.5, 아파트 상세, 지도 apt/school 레이어, 통계 10항목, 커뮤니티 작성/댓글/삭제/고정, 로그인(카카오/네이버), 관리자 대시보드/유저관리, SEO 기본 골격(robots/sitemap 존재)

### [완료하지만 UI 재검토 예정]
아파트 상세(`apt-client.tsx`, 821줄 — B3/B4 이후 기준으로 spacing/카드 일관성 재검토 후보), 지도 `/map`(911줄, B4 지도와 별개로 구현된 구세대 커스텀 마커 시스템 — 문서23에서 이미 "공통 core는 있으나 완전 재사용은 아님"으로 평가됨), 홈 화면(정적 링크 위주, 실제 개인화 데이터 없음)

### [부분 구현]
커뮤니티(수정 API만 있고 UI 없음, 신고 모델만 있고 기능 없음), 아파트 영역(상세는 있으나 목록 페이지 없음, ApartmentMaster 미연결), SEO(robots/sitemap은 있으나 핵심 상세페이지 3종 미등록, JSON-LD 없음)

### [미착수]
재개발(UI 껍데기+빈 DB), MY 관심단지/최근본항목/알림, 사용자 조건/취향 모델(로드맵 STEP 7), 이집 점수체계(STEP 5~6), 추천 엔진(STEP 8~11), M4-C(무거래단지 보강+실거래캐시), INFRA I2-B, 정책/세제 개인화, 매물 증감

### [출시 전 필수 — 후보로 제시, 확정 아님]
- ErrorLog 관측성 공백(분양 외 전 영역) — 특히 학교/통계/커뮤니티 API 오류 발생 시 원인 파악 불가능한 상태는 사용자 대면 서비스 운영 리스크
- SEO: `/apt/[name]`·`/presales/[id]` sitemap 미등록(핵심 콘텐츠 검색 유입 불가)
- dev/prod DB 미분리(이미 1회 실제 장애 유발 전례)
- 커뮤니티 신고 기능 부재(사용자 생성 콘텐츠 서비스에서 최소한의 안전장치)

### [출시 후 고도화 — 후보로 제시]
재개발 전체, MY 개인화 기능, 이집 점수/추천 엔진 전체, M4-C, INFRA I2-B, 정책/세제 개인화, 매물 증감, JSON-LD

---

## 16. 모바일 A/B/C/D 평가

| 화면 | 등급 | 근거 |
|---|---|---|
| 분양 목록/상세(B1~B4) | **A** | 이번 세션 모바일 실기기 검수 완료, 세로밀도까지 최종 승인 |
| 홈 | **A** | 최근 리뉴얼(AI검색 히어로), 별도 모바일 이슈 보고 없음 |
| 지도(`/map`) | **B** | 실사용 가능하나 911줄 커스텀 마커 시스템으로 B4 대비 상호작용 패턴이 다름(clustering/compact-detailed 전환 등 복잡도 높음), 최근 모바일 재검수 기록 없음 |
| 통계 | **B** | 16항목 그리드 자체는 동작하나, 이번 조사에서 `[type]/type-client.tsx` 개별 상세 화면의 모바일 밀도는 확인 못함(확인 필요) |
| 아파트 상세 | **B** | 4구역 구성으로 정보량 많음, B3 이전 세대 UI라 세로밀도 재검토 여지(문서 STEP1이 이미 "UI 재검토 후보"로 지적) |
| 커뮤니티 | **B** | 기본 CRUD는 되나 신고/수정 UI 부재가 모바일 경험의 완결성을 낮춤 |
| MY | **C** | 기능 자체가 프로필 카드 수준뿐이라 "개선 필요"를 넘어 콘텐츠 자체가 부족 |
| 재개발 | **D** | 정적 "준비 중" 문구뿐, 사실상 사용 불가 |

## 17. UI 일관성 조사 (구체적 근거만, 주관적 평가 제외)

- **spacing**: B3-FIX/B4에서 확정한 `.aptCard` 계열 spacing(padding 0.6rem 0.9rem 등)은 분양 상세에만 적용됨. 아파트 상세(`apt-client.tsx`)·재개발·커뮤니티는 이 정리 이전 spacing 규칙을 그대로 사용 중(직접 값 비교는 이번 STEP에서 CSS 파일을 열람하지 않아 미실시 — 확인 필요로 남김).
- **color**: `--primary-color`(#03c75a) 그린 사용 규칙(강조=그린, 중립=회색)은 B3/B4/지도 마커에서 일관되게 확인됨(이번 세션에서 직접 검증). 다른 화면의 색상 일관성은 이번 STEP에서 개별 대조하지 않음(확인 필요).
- **empty state**: 분양(B3)은 "정확한 위치정보가 없어 지도를 표시할 수 없습니다" 같은 구체적 안내를 쓰는 반면, 재개발은 "재개발·재건축 구역 정보 연동 준비 중입니다" 한 문장뿐 — 안내 문구의 정보량 편차가 존재.
- **정보 우선순위**: 아파트 상세는 4구역(요약→실거래→환경/학군→커뮤니티) 순서, 분양 상세는 7단계(기본정보→일정→주택형→위치→지도→비교→CTA) 순서로 서로 다른 정보 설계 원칙을 쓰고 있어(둘 다 나름의 근거가 있지만) 두 "상세페이지" 간 구조적 일관성은 낮다.

---

## 18. 다음 STEP 후보 3개

### 후보 1 — 아파트 상세페이지 재검토 (§14 원칙 적용 1순위 후보)

- **무엇을**: `apt-client.tsx`(821줄) 화면 하나를 B3/B4와 동일한 사이클(기능확인→데이터확인→UI설계→사용자확인→구현→모바일검수→승인)로 재검토.
- **왜 지금**: STEP1 감사가 이미 "UI 재검토 후보"로 지적했고, 이번 R1도 동일하게 확인(§6/§16/§17). 분양 상세는 이번 세션에 최신 수준으로 정리됐는데, 아파트 상세는 이집의 또 다른 핵심 콘텐츠이면서 여전히 구세대 UI. 사용자가 실제로 가장 많이 드나들 화면 중 하나(단지 정보 확인).
- **예상 범위**: 821줄 단일 파일 + CSS, 4구역 재검토(전면 재작성이 아니라 B3처럼 구역별 spacing/정보구조 조정 가능성 높음). ApartmentMaster 연결 여부는 별도 판단(이번엔 붙이지 않고 UI만 볼 수도 있음).
- **위험도**: 중(실거래 API 로직 자체는 건드릴 필요 없음, UI/spacing 위주면 낮음 — 범위 정의에 따라 달라짐).
- **선행조건**: 없음(즉시 착수 가능).
- **사용자 체감 효과**: 높음(가장 많이 보는 화면 중 하나, 최근 정리된 분양 상세와 나란히 비교되는 화면).

### 후보 2 — 커뮤니티 신고 기능 + 게시글 수정 UI 완성

- **무엇을**: 이미 스키마(Report)/API(PATCH)가 존재하는데 UI만 없는 두 기능을 완성. 신고 버튼+처리 화면, 게시글 수정 폼.
- **왜 지금**: 사용자 생성 콘텐츠(UGC) 서비스에서 신고 기능 부재는 운영 리스크이며, 이미 스키마까지 있어 "설계"는 끝난 상태 — 구현만 남음(선행조건이 거의 없는 저위험 작업).
- **예상 범위**: 작음(기존 모델/API 재사용, 신규 API 1~2개(`POST /report`, admin 처리 화면) + UI 컴포넌트 2개).
- **위험도**: 낮음(신규 도메인 로직 없음, 기존 패턴 재사용).
- **선행조건**: 없음.
- **사용자 체감 효과**: 중(커뮤니티 활성 사용자에게만 체감, 다만 안전장치로서 가치 있음).

### 후보 3 — ErrorLog 관측성 확장 (분양 외 전 영역)

- **무엇을**: INFRA I2-A가 분양 4개 API에만 붙인 `logServerError`를 학교/통계/커뮤니티/관리자 등 나머지 라우트로 확장.
- **왜 지금**: 이번 세션 중 실제로 겪은 production 장애(Session Pooler 소진)가 "우연히 읽은 로그"로 규명됐다는 사실 자체가, 로깅이 없는 나머지 영역에서는 같은 사고가 나도 원인을 알 수 없다는 뜻. 순수 관측성 보강이라 위험이 거의 없다.
- **예상 범위**: 20개 이상 라우트에 동일 패턴(이미 확립된 `logServerError`+`buildErrorLogMessage`) 반복 적용 — 반복 작업이지만 기계적이라 안전.
- **위험도**: 매우 낮음(INFRA I2-A와 동일 패턴 검증됨, 기존 응답 계약 변경 없음).
- **선행조건**: 없음.
- **사용자 체감 효과**: 낮음(사용자는 직접 못 느끼지만, 향후 장애 대응 속도에 큰 영향).

---

## 19. 최종 추천 1순위

**후보 1(아파트 상세페이지 재검토)을 1순위로 추천한다.**

이유: (1) 사용자 체감 가치가 가장 크다 — 분양 상세를 방금 최신 수준으로 정리한 직후라, 같은 원칙을 아파트 상세에도 적용하면 두 핵심 콘텐츠 화면의 일관성이 동시에 올라간다. (2) §14 원칙(작은 단위로 쪼개 검수 사이클을 도는 방식)에 가장 잘 맞는 다음 대상이다 — 이미 STEP1과 이번 R1 양쪽에서 재검토 후보로 지목된 화면. (3) 선행조건이 없어 즉시 착수 가능하다. (4) 후보2(신고기능)·후보3(로깅확장)은 둘 다 여전히 가치 있고 위험도가 낮아 후속으로 이어가기 좋은 후보이지만, 사용자 체감 효과는 후보1이 명확히 더 크다.

다만 이는 추천일 뿐이며, 사용자가 후보2/3을 먼저 선택해도 선행조건 충돌은 없다 — 세 후보는 서로 독립적이다.
