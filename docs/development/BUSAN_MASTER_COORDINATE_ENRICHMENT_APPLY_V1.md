# E-JIP BUSAN MASTER COORDINATE ENRICHMENT APPLY V1

`MASTER_COORDINATE_GAP_AUDIT_V1`이 READY_EXACT로 확정한 부산 master **35행의 좌표만** 채운다. 사용자 승인 완료.

- 날짜: 2026-09-20 (KST) · 기준 커밋 `7b6fa25`
- **승인 Production UPDATE: 35행 · `latitude` · `longitude` · `geocodeQuality` 3개 컬럼만**
- 서울 좌표 변경 0 · sale backfill 0 · cancellation repair 0 · schema 0 · runtime `src/` 변경 0

## 판정

**PASS — 정확히 35행이 갱신됐고, 부산 지도 marker가 2,885 → 2,920(+35)이 됐다. 사라진 marker 0.**

STOP 조건 전부 미해당: 대상 35 일치 · 역방향 재검증 35/35 통과 · 모호 결과 0 · 좌표 충돌 0 · 승인 외 컬럼 변경 0 · 서울 무변경 · master 총수 불변 · 취소/거래 수치 불변.

---

## 1. 승인 범위

| 항목 | 값 |
|---|---|
| 지역 | 부산 (`sgg_cd LIKE '26%'`) |
| 행 | **정확히 35** |
| 허용 컬럼 | `latitude` · `longitude` · `geocodeQuality` |
| 금지 | aptSeq · 이름 · sido/sgg/dong · jibun · 도로명주소 · 세대수 · 주차 · 대장 필드 · 점수 · `createdAt` |

## 2. 후보 재생성 (감사 결과를 그대로 믿지 않는다)

감사 산출물이 아니라 **현재 Production 상태**에서 다시 만들었다:

```
부산 latitude IS NULL AND longitude IS NULL      → 37행
그중 본번/부번으로 파싱되는 정확 필지 보유        → 36 후보
```

## 3. 쓰기 전 엄격 재검증

승인 규칙 그대로, **완화 없음**:

```
정방향  search/address?analyze_type=exact
        → 지번 결과(REGION_ADDR) 중 시도·구·법정동·산·본번·부번이 전부 같은 결과가 정확히 1건일 때만 EXACT
역방향  그 좌표 → coord2address → 같은 필지로 되돌아올 때만 VERIFIED
```

| 결과 | 건 |
|---|---|
| **VERIFIED_EXACT** | **35** |
| REJECTED | 1 — `26380-29` 삼풍아파트(사하구 괴정동 487-6), 역방향 `SUB_LOT` 불일치 |
| ERROR / 모호(AMBIGUOUS) | **0** |

Kakao 호출 72회(정방향 36 + 역방향 36). 이름 검색 · 부분일치 · 같은 동 최근접 · 첫 결과 · 중심점 · 이웃 단지 좌표는 **전부 사용하지 않았다**.

## 4. Kakao 키 경로

| 항목 | 값 |
|---|---|
| 사용한 env 이름 | **`KAKAO_CLIENT_ID`**(서버용 REST 키) |
| 사용하지 않은 것 | `NEXT_PUBLIC_KAKAO_MAP_API_KEY` — 클라이언트 노출 JS 키이고, 이 endpoint에서 **401** |
| 키 값 출력 | **0** — artifact·로그에 env 이름만 기록 |
| runtime 웹앱 동작 | **변경 0** (이 키 선택은 이번 enrichment 스크립트 안에만 있다) |

## 5. 좌표 중복 검사

35개 후보 좌표를 **좌표 보유 master 전체**와 대조: **완전 일치 0건**. 같은 필지 증거 없는 충돌이 하나라도 있으면 쓰기 전에 멈추도록 되어 있었으나 해당 사례가 없었다.

## 6. Rollback artifact (쓰기 **전에** 생성)

`tmp/busan-coordinate-enrichment/rollback-2026-09-20T05-08-58-042Z.json`

행마다 `id` · `aptSeq` · `name` · `oldLatitude`(전부 `null`) · `oldLongitude`(전부 `null`) · `oldGeocodeQuality` · 새 값 3개를 담았고, 되돌림 SQL도 함께 기록했다:

```sql
UPDATE apartment_masters SET latitude = NULL, longitude = NULL, geocode_quality = NULL
WHERE apt_seq IN ( … 35개 … );
```

**되돌림은 실행하지 않았다.**

## 7. Dry-run 계획 (실제 쓰기 직전)

| 항목 | 값 |
|---|---|
| 대상 행 | 35 |
| latitude / longitude / geocodeQuality 갱신 | 35 / 35 / 35 |
| **그 밖 필드 변경** | **0** |
| 부산 before | masters 3,438 · 좌표 보유 3,401 · 좌표 없음 37 |
| 부산 expected after | masters 3,438 · 좌표 보유 **3,436** · 좌표 없음 **2** |

## 8. Production UPDATE

한 트랜잭션 안에서 행마다:

```sql
UPDATE apartment_masters SET latitude = $1, longitude = $2, geocode_quality = 'exact'
WHERE apt_seq = $3 AND latitude IS NULL AND longitude IS NULL
```

`latitude IS NULL AND longitude IS NULL`을 조건에 넣어 그 사이 다른 경로가 채운 행은 덮어쓰지 않게 했다. bulk blind update 아님.

**영향 행 35 / 대상 35.**

구별 갱신: 부산진구 7 · 금정구 5 · 남구 3 · 해운대구 3 · 수영구 3 · 기장군 3 · 서구 2 · 동구 2 · 중구 1 · 영도구 1 · 동래구 1 · 북구 1 · 사하구 1 · 연제구 1 · 사상구 1.

## 9. 사후 검증

| 확인 | 결과 |
|---|---|
| 갱신 행 | **정확히 35** |
| 부산 master 총수 | **3,438** (불변) |
| 부산 좌표 보유 | 3,401 → **3,436** |
| 부산 좌표 없음 | 37 → **2** |
| 35행 lat/lng not null | **35/35** |
| 35행 `geocodeQuality='exact'` | **35/35** |
| 무효 좌표(0·한국 범위 밖) | **0** |
| 승인 외 필드 | 세대수 0 · 주차 0 · 대장 PK 0 · 도로명주소 0 — **전부 이전과 같이 null** |
| **`updated_at`** | **변하지 않았다** — 35행 max `2026-09-11T11:51:36Z`로 이전과 동일. raw SQL이라 Prisma `@updatedAt`이 걸리지 않았고 DB 트리거도 없다 |
| 서울 | masters 6,843 · 좌표 6,726 · null **117** — **한 행도 건드리지 않음** |

남은 부산 좌표 없음 **2행**: `26440-147` 에코델타호반써밋스마트시티(강서구 강동동, 지번 `가-` 파싱 불가) · `26380-29` 삼풍아파트(사하구 괴정동 487-6, 역방향 SUB_LOT 불일치).

## 10. 지도 영향 (운영 DB + 운영 함수 직접 측정)

| | before | after | 차이 |
|---|---|---|---|
| **부산 렌더 marker** | **2,885** | **2,920** | **+35** |
| 서울 렌더 marker | 5,819 | **5,819** | **0** |
| 부산 좌표 없어 버려진 단지 / 행 | 37 / 115 | **2 / 3** | −35 / −112 |

**사라진 기존 marker 0 · 예상 밖 신규 marker 0.**

## 11. 구별 marker 변화 — 손실 0

| 구 | before → after | | 구 | before → after |
|---|---|---|---|---|
| 부산진구 | 351 → **358** (+7) | | 서구 | 137 → **139** (+2) |
| 사하구 | 288 → **289** (+1) | | 기장군 | 119 → **122** (+3) |
| 동래구 | 275 → **276** (+1) | | 영도구 | 113 → **114** (+1) |
| 해운대구 | 272 → **275** (+3) | | 동구 | 75 → **77** (+2) |
| 금정구 | 233 → **238** (+5) | | 중구 | 50 → **51** (+1) |
| 수영구 | 214 → **217** (+3) | | 강서구 | 42 → 42 (0) |
| 남구 | 213 → **216** (+3) | | 연제구 | 206 → **207** (+1) |
| 북구 | 157 → **158** (+1) | | 사상구 | 140 → **141** (+1) |
| | | | **합계** | **2,885 → 2,920 (+35)** |

**marker가 줄어든 구 0개.** 강서구만 +0인데, 그 구의 좌표 없는 master 1개가 복구 불가 2건 중 하나(`가-` 지번)다.

## 12. 우선순위 단지 QA

| 단지 | aptSeq | 위치 | 좌표 | 지도 해석 | 다른 master 상속 |
|---|---|---|---|---|---|
| **대운스카이뷰1차** | `26380-2073` | 사하구 하단동 592-10 | `35.1056813715389, 128.965119557184` | aptSeq **자기 것**, marker 생성 | **없음** |
| **롯데캐슬인피니엘** | `26290-4786` | 남구 문현동 1257 | `35.1345336553614, 129.073292078353` | aptSeq **자기 것**, marker 생성 | **없음** |

두 단지가 회복된 112행 중 76행(68%)을 차지한다.

## 13. 제품 영향

의도한 변화:

| 기능 | 변화 |
|---|---|
| 지도 marker | **+35** |
| 지도 → 상세 클릭 경로 | 35개 단지에 **새로 생김** |
| 학교 배정 단지 목록(`latitude: { not: null }` 필터) | 35개가 **포함 대상이 됨** |
| 상세 교육 거리 | 35개에 대해 **계산 가능해짐** |

변화 없음(확인):

| 기능 | 확인 |
|---|---|
| 검색 identity | 대운스카이뷰1차·롯데캐슬인피니엘·해운대역푸르지오더원 모두 **정확한 aptSeq로 검색됨**(좌표와 무관 — master row 기준) |
| 리포트 수치 | 부산 30일 **1,784건 · 2억원대 · 471.3만원/㎡** — 이전과 동일 |
| 거래 수 · 통계 · record-high · compare | 거래 테이블 집계라 영향 없음 |
| sitemap / SEO | 단지를 싣지 않음 |
| 주요 라우트 | `/` `/map` `/stats` `/report/city/busan` `/report/district/26380` `/sitemap.xml` `/robots.txt` 전부 200 |

> **관찰(이번 범위 밖)**: 검색 응답의 `lat`/`lng`는 `apartmentLocationFeature`에서 온다(master가 아니다). 그래서 이번 35개는 검색 결과에서 여전히 `lat: null`이다. 승인 범위가 master 좌표였으므로 건드리지 않았다 — 별도 판단 대상.
>
> **운영 캐시**: `/api/transactions`의 DB-first 응답은 `getOrSetCache` **30분 TTL**이라 UPDATE 직후 HTTP 응답은 한동안 이전 값을 돌려준다. 위 marker 수치는 캐시를 타지 않는 **DB + 운영 함수 직접 측정**이다.

## 14. 서울 격리

| 지표 | 값 |
|---|---|
| 서울 master | **6,843** (불변) |
| 서울 좌표 보유 / 없음 | **6,726 / 117** (불변) |
| 서울 좌표 UPDATE | **0** |
| 서울 master `updated_at` max | `2026-09-19T08:37:00Z` (이번 STEP 이전 값 그대로) |

## 15. 취소 · 매매 격리

| 지표 | 값 |
|---|---|
| 매매 행 | **865,421** (baseline) |
| 취소 행 | 16,345 |
| 확정 false-cancel | **28/28 취소**, 복구 0, 최신 변경 `2026-09-18T19:59:54Z` |
| 과다 취소 상한 | **334** |
| 전원취소 그룹 | **273** |
| 서울 매매 행 / coverage cell | **46** / **0** |
| cancellation repair · Seoul apply · Defect B delete | **0 · 0 · 0** |
| 이번 STEP 이후 `error_logs` | **0**(최신 2건은 05:08Z 업데이트보다 3시간 앞선 02:07·02:08Z 전월세 MOLIT_PARTIAL) |

## 16. No-write assertion (승인 범위 밖)

| 항목 | 값 |
|---|---|
| 승인된 UPDATE | **35행 × 3컬럼** |
| 그 밖 Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| schema / migration | 0 / 0 |
| runtime `src/` 변경 | **0** |
| 배포 | **불필요**(runtime 변경 없음) |

## 17. 테스트

```
npx eslint scripts/enrich-busan-master-coordinates.ts        exit 0
npx tsx --test src/lib/map-marker-coords.test.mjs …          pass 36  fail 0
npx tsc --noEmit    src/ 0 · 기존 scripts 21 + tmp 4 = FAIL_EXISTING_SCRIPT_ERRORS (건수 불변)
```

## 18. 남은 것 · 다음

1. **부산 잔여 2행** — `26380-29`(역방향 SUB_LOT 불일치, 수동 판단 대상) · `26440-147`(지번 `가-`, 주소 증거 부족). 둘 다 추정으로 채우지 않는다.
2. **서울 117행**은 이 방법으로 줄지 않는다(`MASTER_COORDINATE_GAP_AUDIT_V1` §9: 표본 12/12 재거부). 도로명주소 확보 → 건축물대장 paging 수정 → 재시도 순서가 필요하고 각각 별도 승인 대상이다.
3. **검색 좌표(`apartmentLocationFeature`)**가 master와 별개 원천이라는 점 — 필요하면 별도 STEP.
4. 운영 `/api/transactions` 캐시 30분 때문에 사용자 화면 반영은 최대 30분 지연된다(코드상 정상 동작).
