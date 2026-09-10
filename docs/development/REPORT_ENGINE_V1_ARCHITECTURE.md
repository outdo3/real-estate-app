# E-JIP REPORT ENGINE V1 — DATA / TEMPLATE ARCHITECTURE

> READ-ONLY 감사. **Production write 없음. schema 변경 없음. migration 없음.**
> 이 문서는 구현 전 설계 기준이며, 여기서 코드를 만들지 않는다.
> 실측일: 2026-09-10 / HEAD `c25d881` / branch `main`.

모든 수치는 Production DB **읽기 전용** 조회 실측값이다(추정 없음).

---

## 1. 데이터 인벤토리 (실측 커버리지)

| 테이블 | 행 수 | 비고 |
|---|---|---|
| `ApartmentMaster` | **3,418** | aptSeq 3,418(**100%**), 좌표 3,401(99.5%), 세대수 3,181(93.1%), 주차 2,417(**70.7%**), buildYear 3,418(100%) |
| `ApartmentTradeHistory` | **864,628** | aptSeq **100%**, 취소건 16,272(1.9%) |
| `ApartmentRentHistory` | 125,709 | 전월세(보증금+월세, 취소 개념 없음) |
| `ApartmentLocationFeature` | 3,401 | master의 99.5% |
| `ApartmentMarketFeature` | 2,937 | master의 **85.9%** |
| `ApartmentUnitType` | **99** | master의 **2.9%** ← 아래 §3 참고 |
| `OfficetelMaster` / `OfficetelTradeHistory` | 5,056 / 88,674 | |
| `School` / `Presale` / `RedevelopmentProject` | 664 / 1,046 / 1,798 | |
| `SyncCoverageCell` | 240 | SALE 208 + RENT 32, 전부 `COMPLETE` |

지역 집계 기반: `lawdCd` **18종**, `dong` **178종**.
최근 30일 계약 **1,929건**, 최근 2년 계약 **63,357건**(모두 취소 제외).

> 확인 필요: 부산 자치구·군은 16개인데 `lawdCd`가 18종이다. 리포트 집계 전에
> 2개가 무엇인지(폐지 코드/오분류/인접지역) 확인해야 한다. **이번 STEP에서는
> 추정하지 않고 미해결로 남긴다.**

### 1.1 필드별 판정

| 항목 | 판정 | 근거 / 소스 |
|---|---|---|
| 거래 건수 | **READY** | `ApartmentTradeHistory` + `dealCanceled` 필터 |
| 최근 실거래가 | **READY** | 동 테이블 / `ApartmentMarketFeature.latestTradePrice` |
| 거래 이력 | **READY** | 2006~ 전체 보유 |
| 전용면적(㎡) | **READY** | `exclusiveArea` raw Decimal |
| **평형 라벨(공식)** | **BLOCKED** | `ApartmentUnitType` 99행(2.9%). AGENTS.md Unit Master 원칙상 `exclusiveArea/3.3058`을 대표평형으로 쓰는 것 **금지** → 리포트는 **㎡ 라벨만** 쓴다 |
| 계약일 | **READY** | `dealYear/Month/Day` + `dealDate` |
| 취소 상태 | **READY** | `dealCanceled` + `cancelDate` raw |
| 아파트 canonical identity | **READY** | 거래 100%에 `aptSeq` |
| 준공연도 | **READY** | 100% |
| 세대수 | **READY**(93.1%) | 결측은 "정보 없음" 표기 |
| 주차 | **LIMITED**(70.7%) | 29.3%는 반드시 "정보 없음" |
| 교통/교육/생활 | **READY**(99.5%) | `ApartmentLocationFeature` (+`qualityFlag`,`validUntil`) |
| 시장지표(12/36개월 중앙값·건수·변동) | **LIMITED**(85.9%) | `ApartmentMarketFeature` |
| E-JIP Score | **READY**(조건부) | `GET /api/apt/[name]/score` — `status`, `coverage`, `confidence`, `peerContext`, `briefing` 포함. `INSUFFICIENT_DATA`면 점수 미표기 |
| 매매/전월세 관계 | **LIMITED** | 두 테이블 존재하나 동일 단지·면적 매칭 계약이 리포트용으로 검증된 적 없음 |
| 구/동 집계 | **READY** | 위 실측 |
| 오피스텔 | **LIMITED** | master/trade 있으나 canonical source id 부재(schema 주석) — 아파트와 동일 신뢰도로 섞지 않는다 |
| 재개발/분양/학교 | **READY**(참고용) | 리포트 V1 필수 아님 |

---

## 2. 신뢰 규칙 (리포트가 반드시 지켜야 할 것)

1. **"역대 신고가" 금지.** 과거 전체 구간의 취소 검증이 불가능하다.
   허용 표현은 **"최근 2년 최고 거래가"**뿐이며, 근거는 `dealDate >= now()-2y AND dealCanceled=false`
   (실측 모집단 63,357건). 문구에 기간을 반드시 함께 노출한다.
2. **MOLIT 부분실패/실패는 0건이 아니다.** `SyncCoverageCell.status`가
   `COMPLETE`/`EMPTY_VALID`일 때만 "검증된 0건"이라고 말할 수 있고,
   `PARTIAL`/`INVALID`는 "확인 중"으로 표기한다.
3. **취소건 제외**를 모든 집계 기본값으로 한다(현행 지도/상세와 동일).
4. **aptSeq 우선 identity.** 이름만으로 단지를 다시 찾지 않는다(거래 100%가 aptSeq 보유).
5. **평형 라벨 금지**(§1.1) — ㎡ 표기.
6. **표본 부족 게이트.** 최근 1년 거래 10건 미만인 동이 **52개** 있다.
   그런 스코프는 지표를 만들지 말고 "표본 부족"으로 명시한다.
7. **결측은 결측으로.** 다른 단지·다른 기간 값으로 대체하지 않는다.

---

## 3. §7 오늘의 실거래 — **가능(YES). 단, 조건부.**

`ApartmentTradeHistory`는 계약일과 관측일을 **이미 분리해서** 갖고 있다.

| 필드 | 의미 |
|---|---|
| `dealDate` (`dealYear/Month/Day`) | **실제 계약일** |
| `createdAt` | **이 행이 최초로 우리 DB에 들어온 시각 = 최초 관측일** (append-only) |
| `sourceFetchedAt` | 마지막으로 API 응답에서 재확인된 시각 |

### 3.1 실측 — 관측일 분포

```
createdAt distinct days = 10   (2026-08-29 ~ 2026-09-09)

  2026-08-29   n=855,045   dealDate 2006-01-01 ~ 2026-08-28   ← 초기 백필
  2026-09-03   n=  8,921   dealDate 2006-11-01 ~ 2026-09-03   ← 2차 백필
  2026-09-04   n=    101   dealDate 2026-01-31 ~ 2026-09-04
  2026-09-05   n=      1
  2026-09-06   n=      2
  2026-09-07   n=    206   dealDate 2026-06-18 ~ 2026-09-07
  2026-09-08   n=    129   dealDate 2026-05-05 ~ 2026-09-08
  2026-09-09   n=     89   dealDate 2026-02-10 ~ 2026-09-09
```

**증거의 핵심**: 9/9에 새로 관측된 89건의 계약일이 2026-02-10까지 거슬러 올라간다.
즉 "오늘 수집됨 ≠ 어제 계약됨"이 데이터로 확인되며, 이 리포트가 필요한 이유 자체가 증명된다.

### 3.2 검출 로직 (제안)

```sql
-- "오늘 새로 확인된 부산 아파트 실거래"
SELECT apt_seq, apt_name, dong, lawd_cd, exclusive_area,
       deal_amount, deal_date,          -- 실제 계약일: 행마다 반드시 함께 노출
       created_at                       -- 최초 관측일
FROM apartment_trade_histories
WHERE created_at >= :dayStart AND created_at < :dayEnd   -- KST 경계
  AND deal_canceled = false
ORDER BY deal_amount DESC;
```

### 3.3 반드시 함께 구현할 가드 (없으면 거짓말이 된다)

1. **백필 오염 가드.** 8/29(855,045건)·9/3(8,921건)은 신규 관측이 아니라 백필이다.
   앞으로도 백필이 돌면 그날 수치가 폭증한다. → 백필 run을 기록·제외하는 장치 없이는
   "그날 관측 수"를 그대로 신뢰할 수 없다. **V1에서는 일일 상한 초과 시 리포트를
   자동 보류**(수치 노출 금지)하는 것이 최소 안전장치다.
2. **동기화 미실행 vs 진짜 0건 구분.** 9/5=1건, 9/6=2건처럼 사실상 미실행으로 보이는 날이 있다.
   `SyncCoverageCell`(해당 dataset/lawdCd/dealYmd)의 `status`/`verifiedAt`으로
   "검증됨"을 확인한 경우에만 0건을 0건이라 말한다. 아니면 "수집 확인 중".
3. **`SyncCoverageCell`은 일일 로그가 아니다.** `@@unique([dataset,lawdCd,dealYmd])` 로
   **upsert**되므로 `insertedCount`/`verifiedAt`은 *마지막* 실행값만 남는다.
   → **집계 기준은 `createdAt`(append-only)**, `SyncCoverageCell`은 **신선도/검증 여부**
   판단에만 쓴다. (이 둘을 바꿔 쓰면 과거 일자 수치가 조용히 틀어진다.)
4. **가용 구간 한계.** 진짜 증분 관측은 2026-08-30 이후뿐이다. 그 이전 날짜로는
   이 리포트를 만들 수 없다.

### 3.4 문구 규칙

- 제목: **"오늘 새로 확인된 실거래"** (❌ "오늘 거래", ❌ "오늘 계약")
- 각 행에 **계약일**을 반드시 병기.
- 상단에 `dataAsOf`(마지막 검증 시각)와 관측 기준일을 명시.

---

## 4~6. 리포트별 지표 (지리 레벨별로 다르게)

### A. 부산 전체
| 블록 | 판정 |
|---|---|
| 기간 총 거래건수 / 신규 관측 건수 | READY |
| 구별 분포(18코드 확인 후) | READY |
| 활발한 구 TOP N | READY |
| 주요 거래(최근 2년 최고가 기준) | READY |
| "시장 방향" | **LIMITED** — 단순 전월 대비 건수·중앙값 변화만 사실로 제시. 전망·예측 금지 |

### B. 구 단위
거래건수 / 동별 분포 / 대표 단지(거래건수 상위) / 전월·전년 대비 변화 / 주요 거래 — 전부 READY.

### C. 동 단위
거래건수 / 주요 단지 / 최근 실거래 목록 / 우세 면적대(㎡ 밴드) / 요약 — READY.
**단 최근 1년 10건 미만 동 52개는 지표 생성 금지**(§2-6).

### D. 아파트 단지 리포트
- **PRIMARY**: 단지명·주소, 준공연도, 세대수, 최근 실거래가(면적·계약일 병기), 최근 2년 최고 거래가, 12개월 거래건수, E-JIP Score(+confidence)
- **SECONDARY**: 12/36개월 ㎡당 중앙값, 12개월 변동, 지하철 거리/명, 초등 거리, 생활 인프라 카운트
- **OPTIONAL**: 주차(70.7%), 전월세 관계(LIMITED), peerContext 백분위
- 한 줄 요약은 Score API의 `briefing.summary`를 **그대로** 쓴다(신규 생성 금지).

### E. 비교 리포트 (2단지)
**Compare V2를 그대로 재사용한다.** 이미 갖춰진 것:
- `MetricTrust = SAFE | LIMITED | UNSAFE | MISSING`
- `MetricDirection = higher-better | lower-better | neutral | context-only`
- `CompareDifference`, `TradeoffSummary`
→ **승자 날조 금지 요구가 이미 구조로 해결되어 있다.** 우열은 `direction`+`trust`가
`SAFE`인 지표에서만 결정론적으로 표기하고, 나머지는 "차이 없음/판단 불가"로 둔다.
3단지 확장은 payload를 배열로 두면 막히지 않는다(V1은 2단지).

### F. 오늘의 실거래 — §3.

---

## 7. ReportEnvelope (문서 계약 — 이번 STEP에서 코드로 만들지 않음)

```
ReportEnvelope
  reportType     'city' | 'district' | 'dong' | 'apt' | 'compare' | 'daily'
  scope          { lawdCd?, dong?, aptSeq?, aptSeqs?[], date? }   // canonical id 기준
  generatedAt    ISO8601
  dataAsOf       ISO8601                  // SyncCoverageCell.verifiedAt 기반
  trust {
    completeness 'COMPLETE' | 'PARTIAL' | 'UNVERIFIED'
    basis        { coverageCells, canceledExcluded: true, sampleSize }
    notes[]
  }
  title / subtitle
  metrics[]      { key, label, value, displayValue, unit, trust, direction? }
  charts[]       { key, type, series }     // 결정론적 집계만
  highlights[]   { key, label, value, contextLabel }   // 예: '최근 2년 최고 거래가'
  rows[]         { ..., dealDate, observedAt? }        // daily는 계약일 필수
  interpretation { source: 'EJIP_SCORE_BRIEFING' | 'RULE', text, ruleId? }
  sourceNotes[]  { source, fetchedAt, qualityFlag? }
  navigationTargets[] { label, href }      // E-JIP 딥링크
```

원칙: **템플릿은 DB를 직접 조회하지 않는다.** 모든 화면은 이 envelope만 읽는다.
`metrics[].trust`가 `MISSING`이면 템플릿은 "정보 없음"을 렌더할 뿐 값을 만들지 않는다.

---

## 8. URL 구조 (canonical id 기준)

```
/report/city/busan?period=30d
/report/district/{lawdCd}?period=30d          예: /report/district/26350
/report/dong/{lawdCd}/{dong}?period=30d
/report/apt/{aptSeq}                          ← 이름 아님(거래 100%가 aptSeq 보유)
/report/compare?a={aptSeq}&b={aptSeq}
/report/daily/{YYYY-MM-DD}                    ← 관측일 기준(계약일 아님)
```
표시명은 쿼리로 붙이더라도 **identity는 항상 코드/aptSeq**로 한다.

## 9. 출력/공유 아키텍처

| 형식 | 방식 | 비고 |
|---|---|---|
| 반응형 웹 | 서버 렌더 + envelope | 기본 |
| 이미지 저장 | **클라이언트 캔버스 렌더** 우선 | 서버 헤드리스 브라우저는 비용/콜드스타트가 커서 V1 회피 |
| PDF | 브라우저 인쇄 경로(`@media print`) | PDF 안에서는 링크 클릭 가능 |
| 공유 | Web Share API: **텍스트+리포트 URL**(+가능 시 이미지 파일) | |

**중요**: 공유된 이미지는 그 자체로 딥링크가 될 수 없다 → 공유 payload에 **항상 리포트 URL을 함께** 싣는다. QR은 인쇄/데스크톱 보조수단으로만.

## 10. 일반 사용자 vs 중개사 PRO 경계 (이번 STEP 구현 안 함)

envelope에 `interpretation.source`가 이미 있으므로, PRO는 **별도 필드**로만 확장한다:
```
brokerLayer?  { office, agentName, phone, logoAssetId, comment, listings[], cta }
```
- E-JIP 객관 해석(`interpretation`)과 중개사 의견(`brokerLayer.comment`)은
  **데이터 모델에서 분리**하고 화면에서도 시각적으로 분리한다.
- 두 값을 한 문자열로 합치지 않는다(합치는 순간 책임 주체가 섞인다).

## 11. 비용/런타임

- **생성형 AI 불필요.** 한 줄 해석은 Score API의 `briefing`(결정론적)로 충분하다.
  Gemini 의존 확대 금지 원칙과도 맞는다.
- 지역 리포트는 집계 쿼리 1~3회. 인덱스 `(lawd_cd, deal_date)`, `(deal_date)` 존재.
- 단지 리포트는 `ApartmentMarketFeature`/`LocationFeature`가 **이미 사전계산**되어 있어 조회가 가볍다.
- 캐시: 지역·일일 리포트는 스코프+기간이 캐시키로 안정적 → CDN `s-maxage` 적용 가능
  (단 **부분실패 응답은 캐시 금지** — 현행 마커 API와 동일 규칙).
- 새 유료 외부 서비스 **불필요**.

## 12. 템플릿 골격 (모바일 우선, 카카오톡 공유 가독성 기준)

공통: `헤더(제목/스코프/기간)` → `KPI 3~4개` → `차트 1개` → `핵심 목록 5~8행`
→ `하이라이트` → `E-JIP 해석 1~2줄` → `푸터(dataAsOf/출처/신뢰 배지)` → `저장/공유 CTA`

- 카카오톡 썸네일에서 읽혀야 하므로 **KPI 숫자는 크게, 1화면 1메시지**.
- 데스크톱 대시보드를 축소해 넣지 않는다.
- 표는 모바일에서 가로 스크롤 금지 — 행 단위 카드로 접는다.

## 13. 구현 로드맵

| STEP | 내용 | 예상 |
|---|---|---|
| REPORT-1 | ReportEnvelope 타입 + 지역 집계 read 레이어(순수 함수+테스트) | 1~2일 |
| REPORT-2 | 지역 리포트(시/구/동) — 표본 게이트 포함 | 2~3일 |
| REPORT-3 | 단지 리포트(Score/Feature 재사용) | 2일 |
| REPORT-4 | 비교 리포트(Compare V2 재사용) | 1~2일 |
| REPORT-5 | 오늘의 실거래(+§3.3 가드 3종) | 2~3일 |
| REPORT-6 | 이미지/PDF/공유 | 2~3일 |
| REPORT-7 | Production QA | 1~2일 |

## 14. 착수 전 선행 확인 (블로커성)

1. **`lawdCd` 18종의 정체 확인** — 구별 집계의 분모가 걸린 문제.
2. **백필 run 식별 수단** — §3.3-1. 없으면 daily 리포트는 수치 보류 규칙과 함께만 출시.
3. 매매/전월세 매칭 계약 검증 여부(현재 LIMITED).
