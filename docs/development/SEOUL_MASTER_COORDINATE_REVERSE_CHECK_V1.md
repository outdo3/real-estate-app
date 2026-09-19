# E-JIP SEOUL MASTER COORDINATE REVERSE CHECK V1

서울 Tier A seed 좌표에 **역방향 필지 검증**을 추가했다. 원칙: **WRONG COORDINATE < NULL COORDINATE**. CODE + DRY-RUN만 — `--apply` 미실행, Production write 0.

- 날짜: 2026-09-19 (KST) · 기준 커밋 `be79d12` · 선행: `SEOUL_MASTER_SEED_SCRIPT_V1.md`
- 변경: `scripts/seed-seoul-apartment-master-logic.ts` · `scripts/seed-seoul-apartment-master.ts` · `scripts/seed-seoul-apartment-master.test.ts`(+14)
- 산출물(로컬): `tmp/seoul-master-seed-run/coordinate-reverse-audit.json`(6,843행 전부) · `coordinate-reverse-mismatch.json` · `coordinate-missing.json` · `pilot-11140/`

## 1. 계기

SEED SCRIPT V1의 표본 역조회 125건 중 1건(11590-1 건영(103동-106동))이 정방향은 노량진동 324와 필지 일치였지만, 반환 좌표를 역지오코딩하면 상도동 414였다. 정방향 일치만으로는 좌표가 그 필지 위에 있다는 보장이 없다.

## 2. 규칙

| 단계 | 조건 | 결과 |
|---|---|---|
| 정방향 | Kakao 주소 검색 `서울 {구} {법정동} {지번}` → `REGION_ADDR` 중 시도 서울·구·법정동·산 여부·본번·부번이 모두 같은 결과가 정확히 1개 | 아니면 `FORWARD_NO_MATCH` / `AMBIGUOUS` / `JIBUN_UNPARSEABLE` (역방향 호출 안 함) |
| 역방향 | 정방향 좌표 → Kakao `coord2address` 지번 주소가 같은 시도·구·법정동·산 여부·본번·부번(부번 0 = 없음) | 같으면 `VERIFIED`, 다르면 `REVERSE_MISMATCH`(사유: GU·DONG·MOUNTAIN·MAIN_LOT·SUB_LOT), 지번 주소 없음 `REVERSE_NO_RESULT` |
| 저장 | `VERIFIED`만 lat/lng·`geocodeQuality='exact'` | 그 밖의 종결 상태는 lat/lng null·`'failed'`. 정방향 좌표는 artifact 기록으로만 남는다 |
| identity | 좌표 결과와 무관 | 좌표가 null이어도 READY 그대로 insert 대상(canonical 단지를 버리지 않음) |

미종결 상태(`ERROR`, `RATE_LIMITED`)가 남은 구는 READY가 되지 않아 apply 게이트에서 막힌다.

## 3. Checkpoint · rate safety

- 좌표 항목을 `{v:2, status, forward, reverse}`로 저장. SEED SCRIPT V1 checkpoint의 정방향 결과(`EXACT` 좌표·`NO_MATCH` 등)는 **재호출 없이** 이어받아 역방향만 호출했다(정방향 0회).
- `VERIFIED` 등 종결 상태는 다시 부르지 않는다(재실행 호출 0 — 테스트 R12).
- 429: 2회만 재시도 → `RATE_LIMITED`면 좌표 단계를 즉시 멈추고 나머지 `PENDING`, 다음 실행에서 남은 단계부터(정방향이 끝난 행은 역방향만 — 테스트 R13).

## 4. 결과 (Production READ ONLY dry-run)

| 항목 | 값 |
|---|---|
| Tier A READY | 6,843 (계획 대비 차이 0, 25/25 구 READY) |
| 정방향 필지 일치 | 6,839 |
| **역방향 검증 통과(VERIFIED)** | **6,726 (98.29%)** |
| **REVERSE_MISMATCH** | **113 (1.65%)** |
| 기존 누락(정방향 불일치 2 · 블록 지번 2) | 4 — 그대로 null |
| **좌표 null 합계** | **117 (1.71%)** |
| Kakao 호출 | 역방향 6,839 + 중구 폴더 107 · 정방향 0 · MOLIT 0 · 429 0 |

불일치 사유(113): SUB_LOT 65 · MAIN_LOT 28 · MAIN_LOT+SUB_LOT 13 · MOUNTAIN+MAIN_LOT+SUB_LOT 1 · 다른 법정동/구 6.

다른 법정동·구로 떨어진 6건(정방향만으로는 저장됐을 좌표):

| aptSeq | 단지 | 목표 필지 | 역조회 필지 |
|---|---|---|---|
| 11170-2810 | 리첸시아용산B | 용산구 문배동 40-31 | 용산구 원효로1가 133-3 |
| 11290-25 | 한신플러스A | 성북구 동소문동4가 280 | 성북구 동소문동7가 23 |
| 11590-1 | 건영(103동-106동) | 동작구 노량진동 324 | 동작구 상도동 414 |
| 11620-2044 | 보라매우성 | 관악구 봉천동 1696 | **동작구** 신대방동 706 |
| 11620-27 | 해태보라매타워 | 관악구 봉천동 729-32 | **동작구** 신대방동 708 |
| 11620-4336 | 캐릭터그린빌 | 관악구 봉천동 729-24 | **동작구** 신대방동 395-73 |

### 구별 분포

| 구 | READY | VERIFIED | REVERSE_MISMATCH | 좌표 null | VERIFIED 비율 |
|---|---|---|---|---|---|
| 종로구 11110 | 99 | 99 | 0 | 0 | 100.0% |
| 중구 11140 | 107 | 106 | 1 | 1 | 99.1% |
| 용산구 11170 | 183 | 179 | 4 | 4 | 97.8% |
| 성동구 11200 | 159 | 157 | 1 | 2 | 98.7% |
| 광진구 11215 | 208 | 203 | 4 | 5 | 97.6% |
| 동대문구 11230 | 274 | 271 | 3 | 3 | 98.9% |
| 중랑구 11260 | 234 | 222 | 12 | 12 | 94.9% |
| 성북구 11290 | 176 | 174 | 2 | 2 | 98.9% |
| 강북구 11305 | 116 | 113 | 3 | 3 | 97.4% |
| 도봉구 11320 | 179 | 178 | 1 | 1 | 99.4% |
| 노원구 11350 | 289 | 287 | 2 | 2 | 99.3% |
| 은평구 11380 | 404 | 403 | 1 | 1 | 99.8% |
| 서대문구 11410 | 235 | 230 | 5 | 5 | 97.9% |
| 마포구 11440 | 288 | 281 | 7 | 7 | 97.6% |
| 양천구 11470 | 378 | 376 | 2 | 2 | 99.5% |
| 강서구 11500 | 519 | 511 | 8 | 8 | 98.5% |
| 구로구 11530 | 376 | 374 | 1 | 2 | 99.5% |
| 금천구 11545 | 125 | 124 | 1 | 1 | 99.2% |
| 영등포구 11560 | 255 | 250 | 5 | 5 | 98.0% |
| 동작구 11590 | 209 | 202 | 7 | 7 | 96.7% |
| 관악구 11620 | 238 | 234 | 4 | 4 | 98.3% |
| 서초구 11650 | 503 | 493 | 10 | 10 | 98.0% |
| 강남구 11680 | 472 | 455 | 17 | 17 | 96.4% |
| 송파구 11710 | 369 | 366 | 3 | 3 | 99.2% |
| 강동구 11740 | 448 | 438 | 9 | 10 | 97.8% |

### 중구 파일럿

READY **107** · VERIFIED **106** · REVERSE_MISMATCH 1(11140-30 동평화패션타운, 신당동 217-95 → 217-92) · 좌표 null 1. 전체 실행과 별도 폴더(`pilot-11140/`) 실행 결과 동일.

### 부산 격리

dry-run 후 `apartment_masters`: 서울 0 · 부산 3,438 · 부산 좌표 fingerprint `98dd4a454ff92ac91bd1625a6407e37e`(SEED SCRIPT V1 때와 동일) · 부산 최종 `updated_at` 2026-09-11. 역방향 단계는 DB를 읽지도 쓰지도 않는다.

## 5. 테스트

`scripts/seed-seoul-apartment-master.test.ts` 38개(기존 24 + R1~R14): 양방향 일치 VERIFIED · 인접 필지 null · 법정동/구/본번/부번/산 불일치 null · 역방향 결과 없음·오류 · 복수 필지 · 기존 누락 유지 · identity 유지 · 부산 불변 · dry-run 쓰기 0 · V1 checkpoint 이어받기(정방향 0회) · 도중 429 안전 정지/재개 · 중구 107 identity.

```
npx tsx --test scripts/seed-seoul-apartment-master.test.ts   pass 38  fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"      pass 204 fail 0
npx eslint (변경 3파일)                                        exit 0
npx tsc --noEmit                                             변경 파일 0 · src 0 · 기존 25건 → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                                exit 0
```

## 6. 알려진 한계

- V1 checkpoint에서 이어받은 행은 `forwardAddress`가 null이다(V1이 저장하지 않음). 정방향은 목표 필지와 일치한 결과였으므로 `targetLot`이 곧 정방향 필지다. 새로 조회하는 행은 Kakao `address_name`을 기록한다.
- 좌표 null 117건은 이 스크립트로 채울 수 없다(create-only, update 경로 없음) — 건축물대장 주소 등으로 별도 enrichment STEP.
- SUB_LOT 불일치 65건 대부분은 같은 본번의 인접 부번(수 m 수준일 가능성이 높음)이지만, 어느 쪽이 맞는지 판단할 근거가 없어 원칙대로 null이다.

## 7. 파일럿 제안

```
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/seed-seoul-apartment-master.ts --apply --district=11140 --expect-ready=107
```

중구 **107행** 삽입, 좌표 **106행**(99.1%) · null 1행(11140-30). 승인 후에만. 사후 감사: 서울 107 · 좌표 non-null 106 · 부산 3,438 · 부산 fingerprint 불변 · `applied-*.json` id 107개.
