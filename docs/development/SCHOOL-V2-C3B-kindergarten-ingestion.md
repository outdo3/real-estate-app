# SCHOOL V2-C3B — Kindergarten Official Data Ingestion

**[2026-08-21 최종 결과] 성공 — 부산 367개 유치원 ingestion 완료.**
최초 조사(§1-18, 아래)에서는 인증키가 없어 BLOCKER 상태로 종료했으나,
사용자가 `KINDERGARTEN_API_KEY`를 발급·설정한 뒤 "SCHOOL V2-C3B
RESUME AFTER API KEY" STEP(§19 이하)에서 실제 ingestion까지
완료했다. 최종 상태는 문서 하단 §19-32 참고 — 아래 §1-18은 최초
조사 당시 기록을 그대로 보존한다(무엇을 몰랐고 무엇을 확인했는지
추적 가능하도록, 사후 수정하지 않음).

---

## [최초 조사 기록, 2026-08-21] 결과 요약: BLOCKER — 유치원알리미 전용 인증키 없음

다만 이번 STEP에서 **어린이집(C3A)보다 훨씬 유리한 source를 실제로
확인했다** — 공식 기관코드(`kinderCode`)와 좌표(`lttdcdnt`/
`lngtcdnt`)까지 한 오퍼레이션에서 전부 확인된 REST/JSON API이며,
심의유형도 **자동승인**이다(어린이집 cpmsapi021은 개발/운영 모두
수동 심의). Kindergarten/KindergartenStat은 이 시점까지 0행 —
가짜/추정 데이터 생성 없음.

작업은 별도 worktree(`D:\anti2\aaa\e-jip-school-c3b`, branch
`school-v2-c3b`, base `82f4914`)에서 진행했고, main worktree의
SCHOOL V2-C3A(어린이집) 미커밋 작업물과 `school-v2-c2a` branch는
전혀 건드리지 않았다.

## 0. 시작 상태

```
(main worktree) HEAD == origin/main == 82f4914, C3A 미커밋 변경 그대로
(school-v2-c2a branch) origin/school-v2-c2a == da17c0a
(신규 worktree) git worktree add ../e-jip-school-c3b -b school-v2-c3b 82f4914
  → HEAD=82f4914, branch=school-v2-c3b, working tree clean
```

## 1. 기존 SCHOOL V2-B Source 재확인(§3) — 재조사 결과 방향 전환

기존 V2-B는 `15037485`(교육부_통합제공 유치원 현황, 파일데이터)를
유력 후보로 봤다. 이번 STEP에서 직접 재확인한 결과:

- `data.go.kr/data/15037485/fileData.do` — 이용허락범위 **"제한
  없음"**, 그러나 **URL 필드가 `e-childschoolinfo.moe.go.kr/
  openData.do`(포털 다운로드 페이지)일 뿐 직접 파일 URL이 아님**.
- `openData.do` 실제 방문 결과: **시도/공시차수/공시항목을 드롭다운
  으로 선택 후 `javascript:startDownload();` 링크를 눌러야 하는
  수동 UI**임을 직접 확인(폼이 자기 자신에게 POST — 안정적인 단일
  URL로 자동화 불가, 어린이집 C3A의 "어린이집 기본정보" SHEET와
  동일 패턴).
- **이 파일 경로는 이번 STEP에서 primary 후보에서 제외**했다 —
  대신 같은 포털의 **OpenAPI("일반현황", `basicInfo2`)**를 직접
  확인했더니 자동화 가능한 진짜 REST API였고, 그 안에 파일 경로가
  주던 것과 같은 핵심 필드(정원/연령별 원아수/학급수/좌표)가 **이미
  포함**돼 있었다(§6). 파일 경로보다 이쪽이 명백히 우월해 이걸
  primary 후보로 전환했다.

## 2. Legal Gate(§4) — CLEARED

`e-childschoolinfo.moe.go.kr/openApi/openApiList.do`에서 "일반현황"
오퍼레이션 상세를 직접 열람(2026-08-21):

| 항목 | 값(원문) |
|---|---|
| 기능명 | 일반현황 |
| URL | `https://e-childschoolinfo.moe.go.kr/api/notice/basicInfo2.do` |
| 엑셀다운로드 URL | `https://e-childschoolinfo.moe.go.kr/api/notice/excelDownload/basicInfo2.do` |
| 제공방식 | REST |
| 데이터포맷 | **JSON, XLSX** |
| 등록일자 | 2022-04-26 |
| 적재주기 | 비정기(수시) |
| 제공기관 | 교육부 |
| **심의여부** | **자동승인** |
| 이용허락조건 | *"저작자와 출처를 표시하면 영리목적의 이용을 포함한 변경 및 자유이용을 허락합니다."* |

라이선스 문구가 어린이집 cpmsapi021과 완전히 동일하고, **상충하는
다른 페이지를 발견하지 못했다** — CLEARED로 확정.

`EducationSource` 등록(`scripts/education/
register-kindergarten-source.ts`, id=4):

```json
{
  "code": "moe_kindergarten_basicinfo_api",
  "displayName": "유치원알리미 일반현황(basicInfo2)",
  "provider": "교육부",
  "sourceType": "API",
  "sourceUrl": "https://e-childschoolinfo.moe.go.kr/api/notice/basicInfo2.do",
  "licenseCode": "ATTRIBUTION_ONLY_FREE_USE",
  "commercialUseAllowed": true,
  "modificationAllowed": true,
  "legalReviewStatus": "CLEARED"
}
```

기존 source 3건(childcare×2, neis) 변경/삭제 없음 — id=4로 신규
추가만.

## 3. 자동화 가능성(§5)

| 확인 항목 | 결과 |
|---|---|
| 직접 download 가능 | **예**(REST, JSON) — 파일 경로(§1)와 달리 수동 UI 불필요 |
| stable URL | **예**, `basicInfo2.do?key=&sidoCode=&sggCode=&pageCnt=&currentPage=` 고정 패턴 |
| pagination | **예**(`pageCnt`/`currentPage`, 실제 요청 파라미터로 확인) |
| 변경 감지(Last-Modified/ETag/hash) | 별도 확인 안 됨(REST 응답이라 파일 메타데이터 개념 자체가 적용 안 됨) — 재호출 자체가 항상 최신값이라 "변경 감지"보다 "주기적 재호출"이 이 API의 자연스러운 갱신 모델 |
| 자동 갱신 가능 여부 | **가능**(사람이 매번 클릭할 필요 없는 진짜 API) |

**운영 리스크: 낮음.** 파일 경로였다면 사람이 매번 드롭다운을
조작해야 하는 구조였을 것 — API 경로 채택으로 이 문제 자체가
사라졌다.

## 4. 실제 Raw Schema 확인(§6)

브라우저로 "일반현황" 오퍼레이션 상세 페이지의 **요청인자 표**와
**출력항목 표**를 직접 읽어 확인(실제 화면 accessibility tree,
추측 아님).

### 요청 파라미터(원문)

| 변수명 | 타입 | 설명 |
|---|---|---|
| key | STRING(필수) | 인증키 |
| pageCnt | NUMBER | 페이지당 목록 수 |
| currentPage | NUMBER | 페이지 번호 |
| sidoCode | NUMBER(필수) | 시도코드 |
| sggCode | NUMBER(필수) | 시군구코드 |
| timing | NUMBER | 공시차수, "YYYYT"(예 20201) — **최근 3년간의 정보만 제공** |

샘플 URL(원문): `https://e-childschoolinfo.moe.go.kr/api/notice/
basicInfo2.do?key=apikey&sidoCode=27&sggCode=27140`

### 응답 필드(원문, 32개 전부)

`kinderCode, officeedu, subofficeedu, kindername, establish,
rppnname, ldgrname, edate, odate, addr, telno, faxno, hpaddr,
opertime, clcnt3, clcnt4, clcnt5, mixclcnt, shclcnt, prmstfcnt,
ag3fpcnt, ag4fpcnt, ag5fpcnt, mixfpcnt, spcnfpcnt, ppcnt3, ppcnt4,
ppcnt5, mixppcnt, shppcnt, pbnttmng, rpstYn, lttdcdnt, lngtcdnt`

### §요청6 항목별 확인 결과

| 항목 | 상태 |
|---|---|
| 공식 유치원 기관코드 | **AVAILABLE**(`kinderCode`) — §7 |
| 유치원명 | **AVAILABLE**(`kindername`) |
| 시도 | **UNKNOWN(직접 필드 아님)** — 응답에 텍스트 시도명 필드가 없음, 요청 파라미터(`sidoCode`)로만 스코프됨(§9에서 이 값을 그대로 저장에 사용) |
| 시군구 | 상동(`sggCode` 요청 파라미터로만) |
| 주소 | **AVAILABLE**(`addr`) — 도로명/지번 구분 필드는 없음(단일 문자열) |
| 설립유형 | **AVAILABLE**(`establish`) |
| 공립/사립 | `establish` 값이 이를 포함하는지는 실제 값 확인 전까지 미확정(인증키 없어 실제 값 미확인) |
| 학급수 | **AVAILABLE**(연령별: `clcnt3/4/5`, `mixclcnt`, `shclcnt` — 총계 필드는 없음) |
| 정원 | **AVAILABLE**(총계 `prmstfcnt` + 연령별 `ag3/4/5fpcnt`, `mixfpcnt`, `spcnfpcnt`) |
| 현원/원아수 | **AVAILABLE**(연령별 `ppcnt3/4/5`, `mixppcnt`, `shppcnt` — 총계 필드는 없음) |
| 연령별 원아수 | **AVAILABLE**(정확히 이 형태로 제공) |
| 교직원수 | **NOT_AVAILABLE**(이 오퍼레이션 응답에 없음 — "근속연수현황" 등 별도 카테고리 후보, 이번 STEP 범위 밖) |
| 통학차량 | **NOT_AVAILABLE**(별도 "통학차량현황" 카테고리, 이번 STEP 범위 밖) |
| 방과후 | **NOT_AVAILABLE**(별도 "방과후 과정 편성 운영 현황" 카테고리, 범위 밖) |
| 운영시간 | **AVAILABLE**(`opertime`) — C1 schema에 저장할 컬럼 없어 IGNORED(§9) |
| 급식 | **NOT_AVAILABLE**(응답/카테고리 목록 어디에도 없음) |
| 특수교육 | **부분 AVAILABLE**(`shclcnt`/`spcnfpcnt`/`shppcnt` = 특수학급 학급수/정원/원아수) |
| 기준연도/공시일 | **AVAILABLE**(`pbnttmng`, "YYYYT" 형식) |
| latitude | **AVAILABLE**(`lttdcdnt`) |
| longitude | **AVAILABLE**(`lngtcdnt`) |

**중요**: 위 AVAILABLE 표시는 필드가 요청/응답 스펙 표에 **실존함을
직접 확인**했다는 뜻이다. 실제 값(예: 좌표가 정말 정확한지, `establish`
값이 정확히 어떤 문자열인지)은 **인증키가 없어 실 데이터로 확인하지
못했다** — §35에서 별도로 명시.

## 5. Official Code 확인(§7) — **AVAILABLE, HIGH confidence**

`kinderCode`가 응답 필드로 명시적으로 존재한다 — SCHOOL V2-B에서
UNKNOWN으로 남았던 질문이 이번 STEP에서 **해소됐다**.
`Kindergarten.officialCode`를 canonical identity로 채택하고,
ingestion 시 `identityConfidence`를 C1 기본값 `LOW` 대신 **`HIGH`**로
명시 override한다(이름/주소 fallback이 아니라 실제 공식 코드이므로).

## 6. Canonical Identity(§8)

우선순위: `kinderCode` → (다른 identifier 없음) → composite fallback
불필요(코드가 확인됐으므로). 이름 단독 identity는 사용하지 않는다 —
`Kindergarten.kindergartenName`에 unique 제약 없음(C1 schema 그대로
유지).

## 7. Field Mapping(§9)

### Kindergarten

| raw field | 목적지 | 분류 |
|---|---|---|
| `kinderCode` | `officialCode` | **DIRECT** |
| `kindername` | `kindergartenName` | **DIRECT** |
| `establish` | `establishmentType` | **DIRECT** |
| `addr` | `address` | **DIRECT**(roadAddress는 별도 필드 없어 NOT_AVAILABLE) |
| `lttdcdnt`/`lngtcdnt` | `latitude`/`longitude` | **DIRECT**(0은 미기재로 간주, null 처리) |
| 요청 파라미터 `sidoCode`/`sggCode` | `sidoCode`/`sigunguCode` | **NORMALIZED**(응답 필드 아니라 조회 스코프에서 유도 — 어린이집 arcode와 동일 원칙) |
| `officeedu`, `subofficeedu`, `rppnname`, `ldgrname`, `edate`, `odate`, `telno`, `faxno`, `hpaddr`, `opertime`, `rpstYn` | (없음) | **IGNORED**(C1 schema에 대응 컬럼 없음) |

### KindergartenStat

| raw field | 목적지 | 분류 |
|---|---|---|
| `prmstfcnt` | `capacity` | **DIRECT**(source가 이미 총계로 제공) |
| `clcnt3/4/5`, `mixclcnt`, `shclcnt` | `ageBreakdown.byAge.*.classCount` | **NORMALIZED**(정규화 JSON, §23) |
| `ag3/4/5fpcnt`, `mixfpcnt`, `spcnfpcnt` | `ageBreakdown.byAge.*.capacity` | **NORMALIZED** |
| `ppcnt3/4/5`, `mixppcnt`, `shppcnt` | `ageBreakdown.byAge.*.enrollment` | **NORMALIZED** |
| `pbnttmng` | `referenceYear`(앞 4자리 파싱) | **NORMALIZED** |
| (없음) | `classCount`, `enrollment`(단일 총계 필드) | **의도적으로 비움** — source가 총계 필드를 제공하지 않아(연령별만 있음) 임의 합산해서 채우지 않는다(derived 값을 source-provided 필드에 섞지 않는다는 원칙, §11) |
| (없음) | `staffCount`, `hasShuttle`, `hasAfterSchool` | **NOT_AVAILABLE**(이 오퍼레이션 범위 밖, §4) |

C1 schema로 이번 STEP의 필수 요건(officialCode, 정원, 연령별
원아수/학급수)을 전부 저장할 수 있었다 — **SCHEMA_CHANGE_REQUIRED
= NO**.

## 8. Static/Temporal 재확인(§10)

- CORE/SLOW_CHANGE: `kinderCode`, `kindername`, `addr`, `establish` — Kindergarten에 저장
- TEMPORAL: 학급수/정원/원아수(연령별) — KindergartenStat.ageBreakdown + capacity
- SNAPSHOT(통학차량/방과후 등): 이번 오퍼레이션에는 없음 — 향후 별도 API 카테고리 연동 시 재검토

## 9. ageBreakdown JSON 구조(§23) — 정규화 스키마 정의

```json
{
  "schemaVersion": "moe-kindergarten-basicinfo2-v1",
  "byAge": {
    "age3":    { "classCount": <int|null>, "capacity": <int|null>, "enrollment": <int|null> },
    "age4":    { "classCount": <int|null>, "capacity": <int|null>, "enrollment": <int|null> },
    "age5":    { "classCount": <int|null>, "capacity": <int|null>, "enrollment": <int|null> },
    "mixed":   { "classCount": <int|null>, "capacity": <int|null>, "enrollment": <int|null> },
    "special": { "classCount": <int|null>, "capacity": <int|null>, "enrollment": <int|null> }
  }
}
```

raw dump가 아니라 명시적으로 정의된 구조 — 값이 없는 연령대는
`null`(0으로 채우지 않음).

## 10. 좌표(§12)

`lttdcdnt`/`lngtcdnt`가 실제 응답 필드로 존재한다. **의미(기관
대표점/주소 geocode/정문 등)가 문서에 명시돼 있지 않아**
`coordinateType`은 `UNKNOWN`으로 둔다(ENTRANCE 추정 금지, 지시
그대로). `coordinateSource`는 값이 있을 때만 `'moe_kindergarten_api'`
로 기록하도록 스크립트에 구현했다(§ingest 코드).

## 11. 부산 Scope(§13) 및 전국 확장 구조(§14)

`--sido=26`(기본값, 부산광역시), `--sggcode=<코드>`(단일 지역 override)
CLI 파라미터화 — `BUSAN_DISTRICTS` 배열은 어린이집/학교 스크립트와
동일하게 "이번 실행 대상 목록"일 뿐 로직에 하드코딩된 분기가 아니다
(코드에 `if (sido === '26')`류 조건 없음). **NATIONWIDE_KINDERGARTEN_
ARCHITECTURE_READY = YES**(조건부, 전국 일괄 `--all` loop 자체는
미구현 — 어린이집/학교와 동일한 의도적 보류).

## 12. Sample Request 실측(§ auth 확인)

```
$ curl "https://e-childschoolinfo.moe.go.kr/api/notice/basicInfo2.do?key=test&sidoCode=26&sggCode=26140"
{"status":"DENIED","message":"유효하지 않은 키"}
```

인증 게이트가 실제로 작동함을 확인(placeholder 키로 명확한 거부
응답, JSON 형식 확인) — 이 API 전용 정식 키가 없으면 어떤 데이터도
받을 수 없다.

## 13. 인증키(§ 필요 key)

env 전수 확인 결과 이 API 전용 키 없음(`NEIS_API_KEY`,
`DATA_GO_KR_API_KEY` 등 기존 키는 도메인이 달라 재사용 불가 — 어린이집
cpmsapi021과 동일 결론). **필요한 키**: `e-childschoolinfo.moe.go.kr`
전용 서비스키(env 변수명 후보 `KINDERGARTEN_API_KEY`) — 신청 위치:
`e-childschoolinfo.moe.go.kr` → OPEN API → API 제공목록 → "일반현황"
→ (포털 내 활용신청 절차). **심의여부가 "자동승인"으로 확인돼**
어린이집보다 승인 마찰이 낮을 것으로 예상되나, 실제 신청은 진행하지
않았다(사용자 승인 없이 신청 금지).

## 14. Dry-run/Ingestion(§18-19) — 실행 불가(BLOCKER)

`ingest-kindergartens.ts --dry-run` 실행 결과, env에 키가 없어
fetch 자체를 시도하지 않고 즉시 안전하게 중단하도록 구현·확인:

```
=== SCHOOL V2-C3B Kindergarten Ingestion ===
dry-run: true, sido: 26
target districts: 16
BLOCKER: KINDERGARTEN_API_KEY not set in env. Cannot proceed (no key requested without user approval).
```

## 15. Tests(§ verify script)

`scripts/education/verify-kindergarten-normalization.ts` — **17개
assertion 전부 PASS.** fixture는 실제 API 응답이 아니라 확인된 필드
명세 기준의 구조 검증용 합성 데이터임을 스크립트 자체에 명시했다
(§ 상단 주석, 인증키 확보 전까지 실제 값 검증은 불가능).

## 16. EducationSource 최종 상태

| id | code | legalReviewStatus | 비고 |
|---|---|---|---|
| 1 | `childcare_national_api` | CLEARED | 어린이집 primary(C3A) |
| 2 | `childcare_national_sheet` | REVIEW_REQUIRED | 어린이집 secondary 후보(비활성) |
| 3 | `neis_school_info` | CLEARED | 학교 master(C2A) |
| 4 | `moe_kindergarten_basicinfo_api` | **CLEARED** | 유치원 primary(이번 STEP, 신규) |

기존 1~3 row 변경/삭제 없음.

## 17. 자동 갱신 전략(§ refresh, 설계만)

```
유치원알리미 basicInfo2(REST, 공식, 심의 자동승인)
  → 주기적 fetch(--sido/--sggcode 파라미터화된 이 스크립트 재사용)
  → officialCode(kinderCode) 기준 upsert(이미 idempotent 설계)
  → 신규 유치원: create
  → 기존 유치원 정보 변경: update
  → KindergartenStat: referenceYear(pbnttmng 파생) 기준 연도별 row 누적
  → 폐원: 공식 상태 필드 미확인 — isActive 자동 false 전환 로직은
    후속 STEP에서 검토(hard delete 금지 원칙 유지)
  → audit
```

scheduler 구현은 이번 STEP에서 하지 않았다.

## 18. Anomalies/한계(정직하게 기록)

- 실제 API 응답을 한 번도 받지 못해(§13 BLOCKER) enrollment>capacity
  같은 이상치 감사, district별 실 count, public/private breakdown
  실측은 **전부 수행하지 못했다** — 인증키 확보 후 반드시 재실행
  필요.
- `establish`(설립유형) 실제 값 종류(공립/사립/국립 등 정확한
  문자열)도 미확인 — normalize 로직은 "원문 그대로 저장"이라 이후
  실 데이터가 들어와도 코드 변경 없이 그대로 작동할 것으로 예상되나
  검증되지 않았다.

---

# SCHOOL V2-C3B RESUME AFTER API KEY(2026-08-21 추가)

**결과: 성공.** `KINDERGARTEN_API_KEY` 발급 후 부산 367개 유치원을
실제로 ingestion했다. 인증은 성공했으나 **실제 응답이 문서화된 명세
표와 2곳에서 달랐다** — 명세만 믿고 코드를 짜면 조용히 0건 수집되는
버그가 났을 지점이라, 실제 sample 호출을 먼저 한 것이 정확히
의도대로 작동했다.

## 19. 실제 API 응답 vs 문서화된 명세 — 불일치 2건 발견·수정

| 항목 | 포털 명세 표(§4 문서화) | **실제 응답(2026-08-21 실측)** | 조치 |
|---|---|---|---|
| 식별자 필드명 | `kinderCode`(camelCase) | **`kindercode`**(전부 소문자) | 코드 수정, 실제 필드명 채택 |
| 응답 wrapper | 명세 표에 없음(암묵적으로 최상위 배열 가정) | **`{ kinderInfo: [...] }`**(다른 top-level 키: `pageCnt`, `currentPage`, `sidoList`, `sggList`, `timing`, `status`) | 코드 수정, `data.kinderInfo` 사용 |
| (참고, 미사용 필드) | `rpstYn` | `rpst_yn`(snake_case) | 매핑 대상 아니라 영향 없음, 기록만 |

"명세와 response가 다르면 실제 response 우선" 원칙 그대로 적용했다.
이 불일치를 실제 sample 호출 없이 넘어갔다면 `ingest-kindergartens.ts`가
매 실행마다 `fetched: 0`으로 조용히 실패했을 것이다(§5의 최초 dry-run
에서 실제로 이 문제를 잡아냈다).

## 20. Canonical Identity 최종 확인(§4)

`officialCode`(`kindercode`) 커버리지 **367/367(100%)** — 누락 0건,
중복 0건. 실제 UUID 형태 코드 확인(예: `1ecec08c-fa21-b044-e053-
0a32095ab044`) — 유치원알리미 내부 PK로 보이며 형식이 안정적이다.
name+address 기반 fallback identity는 이번 ingestion에서 단 1건도
필요하지 않았다.

## 21. Dry-run 결과(§5)

```
fetched: 367, Busan rows: 367, valid: 367, invalid: 0, skipped: 0
officialCode missing: 0, officialCode duplicate: 0
16개 구·군 전부 0건 없이 실데이터 확인(3~40건 분포)
coverage(dry-run 예측 = 실제 ingestion과 100% 동일, §23):
  address 100%, establishment 100%, coordinate 100%, capacity 100%,
  ageBreakdown 100%
staff/shuttle/afterSchool: 이 오퍼레이션 자체에 필드가 없어 전 행
  null 유지(0으로 채우지 않음, NOT_AVAILABLE 의미 보존)
```

## 22. Actual Ingestion 결과(§6)

```
Kindergarten: created 367, updated 0
KindergartenStat: created 367, updated 0
```

## 23. 부산 16개 구·군 QA(§7) — 전부 READY

| 구·군 | count | address | establishment | coordinate | capacity | 판정 |
|---|---|---|---|---|---|---|
| 중구(26110) | 3 | 100% | 100% | 100% | 100% | READY |
| 서구(26140) | 10 | 100% | 100% | 100% | 100% | READY |
| 동구(26170) | 7 | 100% | 100% | 100% | 100% | READY |
| 영도구(26200) | 10 | 100% | 100% | 100% | 100% | READY |
| 부산진구(26230) | 40 | 100% | 100% | 100% | 100% | READY |
| 동래구(26260) | 27 | 100% | 100% | 100% | 100% | READY |
| 남구(26290) | 25 | 100% | 100% | 100% | 100% | READY |
| 북구(26320) | 39 | 100% | 100% | 100% | 100% | READY |
| 해운대구(26350) | 34 | 100% | 100% | 100% | 100% | READY |
| 사하구(26380) | 37 | 100% | 100% | 100% | 100% | READY |
| 금정구(26410) | 19 | 100% | 100% | 100% | 100% | READY |
| 강서구(26440) | 24 | 100% | 100% | 100% | 100% | READY |
| 연제구(26470) | 17 | 100% | 100% | 100% | 100% | READY |
| 수영구(26500) | 16 | 100% | 100% | 100% | 100% | READY |
| 사상구(26530) | 24 | 100% | 100% | 100% | 100% | READY |
| 기장군(26710) | 35 | 100% | 100% | 100% | 100% | READY |

합계 367. **16개 구·군 전부 READY**(지역별 기준 차등 없음, 전부 동일
coverage 기준 적용).

**설립유형 분포(전체)**: 사립(사인) 189, 공립(병설) 100, 사립(법인)
42, 공립(단설) 36 — 사립 계 231(63%), 공립 계 136(37%).

## 24. Coordinate Audit(§8)

- valid(0이 아니고 null도 아님): 367/367(100%)
- 부산 범위 밖(위도 34.5~35.6, 경도 128.5~129.6 밖): **0건**
- `coordinateType`은 여전히 `UNKNOWN`으로 저장(의미가 공식 문서에
  명시돼 있지 않아 ENTRANCE/OFFICIAL_POINT 등으로 추정하지 않음,
  지시 그대로 유지)

## 25. Stat Audit(§9)

- capacity: null 0 / zero 0 / positive 367
- enrollment(연령별 합, ageBreakdown 기준): 대부분 capacity 이내,
  **2건에서 연령별 원아수 합이 인가정원을 1명 초과**(273→274,
  92→93) — source 자체의 실제 운영 현황일 수 있어(인가정원 초과
  운영이 실제로 발생 가능) 오류로 단정하지 않고 사실만 기록한다.

## 26. Age Breakdown(§10) — 실측 구조 확정

```json
{
  "schemaVersion": "moe-kindergarten-basicinfo2-v1",
  "byAge": {
    "age3":    { "classCount": 1, "capacity": 16, "enrollment": 8 },
    "age4":    { "classCount": 1, "capacity": 24, "enrollment": 18 },
    "age5":    { "classCount": 1, "capacity": 26, "enrollment": 26 },
    "mixed":   { "classCount": 0, "capacity": 0,  "enrollment": 0 },
    "special": { "classCount": 0, "capacity": 0,  "enrollment": 0 }
  }
}
```
(실제 "푸른유치원" row 그대로) raw API payload 전체를 dump하지
않고, 정의된 구조로만 정규화해 저장했다.

## 27. Duplicate Audit(§11)

- **officialCode 중복: 0건**(GROUP BY 쿼리 재확인)
- **same name, different code: 6건**(파랑새유치원/명성유치원/
  푸른유치원/대림유치원/고은유치원/햇빛유치원, 각 2곳) — 전부 실제
  주소가 다른 별개 기관으로 확인(예: 대림유치원 = 북구 금곡대로
  268 vs 해운대구 대천로103번길 47) — **자동 merge하지 않음**
- same address, different code / same coordinate, multiple institution:
  이번 STEP에서 별도 조사하지 않음(발견된 anomaly 없음)

## 28. Second-run Idempotency(§12)

```
2차 실행: created 0, updated 367
duplicate 발생: 0건(officialCode 기준 재확인)
```

핵심 안전성(중복 미생성)은 충족 — 단 학교/어린이집과 동일하게
필드 diff 없이 매번 재기록하는 한계가 그대로 있다(§13 unresolved로
기록, 전국 확장 전 개선 후보).

## 29. Resumability(§13)

이번 실행 규모(16개 구·군, 최대 40건/구)에서는 중단 시나리오가
실질적으로 발생하지 않았다 — district 단위 loop + 페이지네이션
구조 자체는 이미 있어 재실행 시 idempotent upsert로 안전하다.

## 30. 전국 확장 판정(§14) — NATIONWIDE_KINDERGARTEN_ARCHITECTURE_READY = **YES**

부산 16개 구·군 100% coverage로 실증됐고, `--sido`/`--sggcode`
파라미터만으로 다른 시도 수집이 가능한 구조임을 코드 리뷰 + 실행
결과로 재확인. 전국 일괄 loop(`--all`) 자체는 이번 STEP에서도
만들지 않았다(의도적 보류, 전국 대량 ingestion 금지 지시 준수).

## 31. 최종 EducationSource 상태

id=4(`moe_kindergarten_basicinfo_api`) `legalReviewStatus=CLEARED`
그대로 — 변경 없음(이미 §2에서 CLEARED로 등록됨).

## 32. DB 최종 카운트

```
EducationSource: 4
School: 664 (school-v2-c2a 원본 데이터, 이 worktree DB에도 공유됨 — C2A branch 자체는 미변경)
Kindergarten: 367
KindergartenStat: 367
Childcare / ChildcareStat: 0 (main worktree C3A 작업, 이 worktree 코드/git 이력과 무관 — 동일 DB 공유이나 C3A는 여전히 자체 인증키 대기 중)
```
