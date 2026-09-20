# E-JIP MASTER COORDINATE GAP AUDIT V1

`MAP_TIER2_FALLBACK_REMOVAL_V1` §9가 "fallback보다 두 자릿수 큰 공백"으로 지목한 **master 좌표 없음**의 규모·원인·복구 가능성을 부산/서울 각각 정량화한다.

- 날짜: 2026-09-20 (KST) · 기준 커밋 `3b5ce6f`
- **Production INSERT/UPDATE/DELETE 0** · 좌표 변경 0 · master 변경 0 · schema 0 · Seoul sale apply 0 · cancellation repair 0 · runtime 변경 0
- 도구(이번 STEP 추가, read-only): `scripts/audit-master-coordinate-gap.ts` · `scripts/audit-master-coordinate-geocode-dryrun.ts`

## 판정

**PASS — 부산은 35개(112행)가 엄격 규칙으로 복구 가능하고, 서울 114개는 재조회로 복구되지 않는다(같은 규칙이 이미 거부한 집합).**

STOP 조건 미해당: fuzzy 추론 0 · 좌표 충돌 0 · Production write 0 · runtime 변경 0 · master identity는 온전하다(좌표만 결측). 건축물대장 paging 결함은 **이번 복구 경로를 막지 않는다**(§8).

---

## 1. Master baseline (Production 실측)

| | 부산 | 서울 |
|---|---|---|
| master 총수 | **3,438** | **6,843** |
| 좌표 둘 다 있음 | 3,401 | 6,726 |
| lat만 없음 / lng만 없음 | 0 / 0 | 0 / 0 |
| **둘 다 없음** | **37** | **117** |
| **COORD_INVALID**(0·한국 범위 밖·NaN) | **0** | **0** |

좌표는 "있거나 없거나"뿐이고 **반쪽 좌표·무효 좌표는 하나도 없다**.

`geocodeQuality` 분포 — 원인을 그대로 보여준다:

| | 부산 | 서울 |
|---|---|---|
| `exact` | 2,833 | 6,726 |
| `normalized` | 568 | 0 |
| `failed` | **1** | **117** |
| `(null)` — 시도 기록 자체가 없음 | **36** | 0 |

**서울 117 = 전부 `failed`**(엄격 규칙이 돌아서 거부한 것) · **부산 37 = 36 `(null)` + 1 `failed`**(36개는 이 경로로 **한 번도 시도된 적이 없다**).

## 2. 현재 지도 창 영향 — 기존 값 재현

지도 규칙 그대로: `sale` · `dealCanceled=false` · **최근 12개월**(2025-09-20~) · `dong|name` 완전일치.

| | 좌표 없는 master | 창 안 영향 단지 | 영향 거래 행 |
|---|---|---|---|
| **부산** | 37 | **37** | **115** |
| **서울** | 117 | **93** | **812** |

**기존 알려진 값(부산 37/115 · 서울 93/812)을 정확히 재현했다.**

> **거래 출처가 지역마다 다르다** — 처음 DB만으로 세었을 때 서울이 1단지/1행으로 나왔다. 서울은 `cronSync`가 꺼져 있어 지도가 **live MOLIT**을 쓰고 DB에는 강남 파일럿 45행(창 안)뿐이기 때문이다. 그래서 부산은 DB(`apartment_trade_histories`), 서울은 **수집해 둔 원천 캐시**(= live MOLIT이 돌려주는 것과 같은 행, 창 안 5,914단지)로 센다. 이 구분을 하지 않으면 서울 수치가 틀린다.

## 3. 구별 분해

**부산** — 16개 구 전부에 1~7개씩 흩어져 있고 집중된 곳이 없다.

| 구 | master | 좌표없음 | 영향단지 | 행 | 손실% |
|---|---|---|---|---|---|
| 부산진구 | 411 | 7 | 7 | 7 | 1.70 |
| 금정구 | 313 | 5 | 5 | 6 | 1.60 |
| 남구 | 256 | 3 | 3 | **32** | 1.17 |
| 해운대구 | 311 | 3 | 3 | 3 | 0.96 |
| 수영구 | 254 | 3 | 3 | 4 | 1.18 |
| 기장군 | 155 | 3 | 3 | 3 | 1.94 |
| 사하구 | 340 | 2 | 2 | **47** | 0.59 |
| 서구 | 173 | 2 | 2 | 3 | 1.16 |
| 동구 | 101 | 2 | 2 | 2 | 1.98 |
| 중구·영도구·동래구·북구·강서구·연제구·사상구 | — | 각 1 | 각 1 | 1~2 | 0.32~2.27 |

행 수는 **사하구 47 · 남구 32**에 몰려 있다 — 단지 수가 아니라 거래가 많은 두 단지 때문이다(§7).

**서울** — 상위 10개 구:

| 구 | master | 좌표없음 | 영향단지 | 행 | 손실% |
|---|---|---|---|---|---|
| 11680 강남 | 472 | 17 | 13 | 103 | 3.60 |
| 11260 중랑 | 234 | 12 | 9 | 24 | 5.13 |
| 11740 강동 | 448 | 10 | 8 | **240** | 2.23 |
| 11650 서초 | 503 | 10 | 7 | 13 | 1.99 |
| 11500 강서 | 519 | 8 | 7 | 22 | 1.54 |
| 11440 마포 | 288 | 7 | 7 | 19 | 2.43 |
| 11590 동작 | 209 | 7 | 6 | 102 | 3.35 |
| 11215 광진 | 208 | 5 | 5 | 64 | 2.40 |
| 11410 서대문 | 235 | 5 | 4 | 7 | 2.13 |
| 11560 영등포 | 255 | 5 | 2 | 38 | 1.96 |

## 4·5. 서울 117 원인

`SEOUL_MASTER_COORDINATE_REVERSE_CHECK_V1` §4가 이미 확정한 분류와 현재 DB가 일치한다(117 전부 `geocodeQuality='failed'`):

| 분류 | 건 |
|---|---|
| **B. FORWARD_RESULT_REVERSE_MISMATCH** | **113** — SUB_LOT 65 · MAIN_LOT 28 · MAIN_LOT+SUB_LOT 13 · MOUNTAIN+MAIN_LOT+SUB_LOT 1 · 다른 법정동/구 6 |
| A/C. 기존 누락(정방향 불일치 2 · 블록 지번 2) | 4 |
| **합계** | **117** |

즉 **주소가 없어서가 아니라, 정방향 좌표가 그 필지 위로 돌아오지 않아서 버린 것**이다. `WRONG COORDINATE < NULL COORDINATE` 원칙이 의도대로 작동한 결과다.

> 로컬 artifact(`tmp/seoul-master-seed-run/coordinate-reverse-*.json`)는 마지막 구(강동 448건)만 남아 있어 117 전수 근거가 아니다 — 위 분류는 문서 §4의 전수 기록을 따른다.

## 6. 부산 37 원인

| 분류 | 건 | 근거 |
|---|---|---|
| **시도 기록 없음(`geocodeQuality` null)** | **36** | 이 엄격 경로로 **한 번도 geocode된 적이 없다** — 서울보다 먼저 만들어진 import |
| `failed` | 1 | 지번이 `가-` 형태라 본번/부번 파싱 불가(§7) |

부산 36개는 서울 117개와 **성격이 정반대**다: 서울은 "시도했고 거부됨", 부산은 "시도된 적 없음". 그래서 부산만 재시도에 의미가 있다.

## 7. 건축물대장 paging 감사 (코드만, 실행 0)

| helper | `pageNo` | `numOfRows` | `totalCount` 처리 | 전 페이지 수집 | 판정 |
|---|---|---|---|---|---|
| `src/lib/apt-building-info.ts` (라이브 런타임) | **없음** | 5 | **읽지 않음** | 아니오 | **UNSAFE** |
| `scripts/backfill-basic-data-logic.ts` LENIENT(부산) | **없음**(`numOfRows=5`) | 5 | 부산은 의도적으로 보지 않음 | 아니오 | **UNSAFE / PARTIAL** |
| 동 STRICT(서울) | **`pageNo=1`** | 100 | `totalCount > 수신` → `incomplete`/REVIEW | 100건까지 + 잘림 탐지 | **SAFE** |

근거는 같은 파일의 실측 주석이다: *"BldRgstHubService는 pageNo가 없으면 numOfRows를 무시하고 1건만 준다(응답 numOfRows=1, totalCount=4인데 item 1건)"*. 따라서 **라이브/부산 경로의 대장 응답은 이번 감사에서 authoritative evidence로 쓰지 않았다.**

**중요**: 이번 복구 경로는 대장을 **전혀 쓰지 않는다**. 부산 36개의 주소 증거는 MOLIT master seed의 `umdName + jibun`(법정 필지)이다. 그래서 **대장 paging 결함은 이 복구를 막지 않는다** — STOP 조건 미해당. 코드 수정도 하지 않았다.

## 8. 주소 증거 수준

| 수준 | 부산 (37) | 서울 (117) |
|---|---|---|
| L1 official road address | 0 | 0 |
| **L2 official exact legal lot** | **36** | **114** |
| L3 ledger address | 0 | 0 |
| **L4 name + dong only** | **1** | **3** |
| L5 insufficient | 0 | 0 |

`roadAddress`·`jibunAddress`는 부산·서울 **양쪽 모두 0건**이다(건축물대장 미연동). 그래서 유일하게 쓸 수 있는 증거는 **법정 필지(L2)** 뿐이다. L4 4건(부산 1 · 서울 3)은 자동 복구 후보에서 제외했다.

## 9·10. Geocode dry-run (READ ONLY, 좌표 저장 0)

승인된 규칙을 그대로 옮겨 썼다 — **완화 없음**:

```
정방향  search/address?analyze_type=exact
        → 지번 결과(REGION_ADDR) 중 시도·구·법정동·산·본번·부번이 전부 같은 결과가 정확히 1건일 때만 EXACT
역방향  그 좌표 → coord2address → 같은 필지로 되돌아올 때만 VERIFIED
```

이름 검색 · 부분일치 · 같은 동 최근접 · 첫 결과 · 중심점 · 이웃 단지 좌표는 **전부 사용하지 않았다**.

| | 대상 | VERIFIED_EXACT | REVERSE_MISMATCH | NO_RESULT/MULTIPLE |
|---|---|---|---|---|
| **부산** (CANDIDATE 전수) | 36 | **35** (112행) | 1 (1행) | 0 |
| **서울** (이미 거부된 집합 표본) | 12 / 114 | **0** | **12** | 0 |

- Kakao 호출 96회. **DB write 0 · 좌표 저장 0.**
- 서울 표본 12/12가 다시 `REVERSE_MISMATCH` — **같은 주소로 재조회해도 결과가 같다**는 것을 실측으로 확인했다. 서울 114개는 재시도가 아니라 **더 나은 주소 증거**(도로명/대장)가 있어야 움직인다.

> **발견(부수)**: Kakao REST(local) API는 **REST 키**를 요구한다. 기존 seed 스크립트가 쓰는 `NEXT_PUBLIC_KAKAO_MAP_API_KEY`(JS 키)는 현재 이 endpoint에서 **401**이고, `KAKAO_CLIENT_ID`가 200이다. 향후 enrichment 실행 전에 확인이 필요하다(값은 기록하지 않았고, 코드 수정도 하지 않았다).

## 11. 복구 분류

| 분류 | 부산 master | 창 안 단지 | 행 | 서울 master | 창 안 단지 | 행 |
|---|---|---|---|---|---|---|
| **READY_EXACT** | **35** | 35 | **112** | **0** | 0 | 0 |
| REVIEW_REQUIRED(역방향 불일치) | 1 | 1 | 1 | — | — | — |
| **PREVIOUSLY_REJECTED_STRICT**(재조회 무의미) | — | — | — | **114** | 90 | **779** |
| NO_SOURCE(L4/L5) | 1 | 1 | 2 | 3 | 3 | 33 |
| LEDGER_BLOCKED | 0 | 0 | 0 | 0 | 0 | 0 |

`LEDGER_BLOCKED`가 0인 이유: 복구에 대장을 쓰지 않기 때문이다(§7).

## 12. 안전 복구 후 사용자 영향 (시뮬레이션 — DB 미변경)

| | 현재 marker | READY_EXACT만 반영 | 회복 | 개선 | 남는 공백 |
|---|---|---|---|---|---|
| **부산** | **2,885** | **2,920** | **+35 단지 / +112행** | **+1.21%** | 2 단지 / 3행 |
| **서울** | 5,819 | 5,819 | **0** | 0% | 93 단지 / 812행 |

부산은 좌표 공백이 사실상 사라지고(37 → 2), 서울은 이 방법으로 줄지 않는다.

## 13. 복구 우선순위 (부산 READY_EXACT, 창 안 거래행 순)

| # | aptSeq | 단지 | 구 | 동 | 창 행 | 최근 거래 |
|---|---|---|---|---|---|---|
| 1 | `26380-2073` | **대운스카이뷰1차** | 사하구 | 하단동 | **46** | 2026-08-21 |
| 2 | `26290-4786` | **롯데캐슬인피니엘** | 남구 | 문현동 | **30** | 2026-09-18 |
| 3 | `26410-237` | 세진 | 금정구 | 남산동 | 2 | 2026-09-10 |
| 4 | `26500-1391` | 금오파크빌 | 수영구 | 광안동 | 2 | 2026-09-05 |
| 5 | `26140-118` | 송암파크빌 | 서구 | 암남동 | 2 | 2026-09-02 |
| 6~35 | — | 용진힐타운 · 해운대역푸르지오더원 · 대원 · 대신빌라 · 상마타운 · 대우리치빌 · 애뜰안 · 동경쉐르빌 · 초량위드빌 · 삼성빌라 … | 13개 구 | — | 각 1 | 2026-08~09 |

상위 2개가 **112행 중 76행(68%)** 을 차지한다.

**복구 불가 2건**: `26380-29` 삼풍아파트(사하구 괴정동 487-6) — 역방향 `SUB_LOT` 불일치, REVIEW_REQUIRED / `26440-147` 에코델타호반써밋스마트시티(강서구 강동동) — 지번이 `가-`라 파싱 불가, NO_SOURCE.

## 14. 좌표 중복 안전성

READY_EXACT 35개의 후보 좌표를 **기존 좌표 보유 master 전체**와 대조:

| 확인 | 결과 |
|---|---|
| 기존 master와 좌표 완전 일치 | **0건** |

같은 필지/단지군 공유로 인한 정당한 중복도 없었고, 다른 단지 좌표를 덮어쓸 위험도 없다. 충돌이 있었다면 `same lot` 여부를 따져 REVIEW로 돌릴 예정이었으나 해당 사례가 없다.

## 15. 제품 영향 — 좌표만 결측, identity는 온전

master row 자체는 정상이다(aptSeq·이름·동·지번 보유). 빠진 것은 좌표뿐이다.

| 기능 | 영향 | 근거 |
|---|---|---|
| **지도 marker** | **생성 안 됨** | 좌표 없으면 `map/page.tsx`가 행을 버린다 |
| **지도 클릭 → 상세** | 도달 경로 없음 | marker가 없으므로 |
| **학교 배정 단지 목록** | **제외됨** | `/api/school/apartments`가 `latitude: { not: null }`로 거른다 |
| 상세 교육 거리 | 계산 불가 | 좌표가 없으면 거리 null |
| 검색 | **정상** | master row가 있으므로 검색된다(좌표 필수 아님) |
| 단지 상세 | **정상** | 이름 기반 경로 |
| 리포트 · 통계 · 최근 실거래 · record-high · compare | **정상** | 거래 테이블 집계, master는 enrichment |
| sitemap/SEO | 영향 없음 | 단지를 싣지 않는다 |

## 16. 향후 enrichment 제안 (이번 STEP 실행 0)

| 안 | 대상 | 예상 Production UPDATE |
|---|---|---|
| **A. READY_EXACT 좌표 batch update** | 부산 35 | **35행**(`latitude`·`longitude`·`geocodeQuality='exact'`만) |
| B. REVIEW_REQUIRED 수동 큐 | 부산 1 | 0(사람 판단 후 별도) |
| C. 대장 paging 수정 후 재시도 | 서울 114 · 부산 1 | 0(선행 작업 필요) |
| D. NO_RESULT/NO_SOURCE 유지 | 부산 1 · 서울 3 | 0 |

- A는 좌표 컬럼만 건드리고 identity·이름·주소는 그대로 둔다. 되돌림은 해당 35행을 다시 null로 만드는 것.
- C가 서울의 유일한 실질 경로다 — 도로명주소(대장 `newPlatPlc`)를 확보하면 L1 증거로 다시 시도할 수 있다. 그 전에 **§7의 UNSAFE paging을 먼저 고쳐야** 대장 주소를 신뢰할 수 있다.
- **이번 STEP에서는 어느 것도 실행하지 않았다.**

## 17. No-write assertion

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| 좌표 변경 | **0** |
| master 변경 | **0** |
| schema / migration | 0 / 0 |
| Seoul sale apply · cancellation repair | 0 · 0 |
| runtime 코드 변경 | **0** (`git status -- src/` 비어 있음) |
| 외부 호출 | Kakao 96회(읽기 전용 geocode dry-run) · MOLIT 0 |

## 18. 테스트

```
npx eslint scripts/audit-master-coordinate-gap.ts scripts/audit-master-coordinate-geocode-dryrun.ts   exit 0
npx tsx --test src/lib/map-marker-coords.test.mjs scripts/backfill-seoul-sale.test.ts   pass 36  fail 0
npx tsc --noEmit    src/ 0 · 기존 scripts 21 + tmp 4 = FAIL_EXISTING_SCRIPT_ERRORS (건수 불변)
```

runtime을 바꾸지 않아 build는 돌리지 않았다.

## 19. Blockers · 다음

1. **Blocker 없음** — STOP 조건 전부 미해당.
2. **권고**: 안 A(부산 35행 좌표 batch update)를 승인 대상으로 올린다. 비용은 35행 UPDATE, 효과는 지도 marker +35(+1.21%)이고 그중 2개 단지가 76행을 차지한다. fuzzy 추론 0 · 좌표 충돌 0 · 규칙은 서울 seed와 동일.
3. 서울 114개는 **재조회로 해결되지 않는다**. 도로명주소 확보 → §7 paging 수정 → 재시도 순서가 필요하며, 각각 별도 승인 대상이다.
4. Kakao REST 키 이슈(§9 발견)를 enrichment 실행 전에 확인해야 한다.
