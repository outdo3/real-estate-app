# E-JIP GYEONGGI MASTER FULL BATCH POLICY V1

경기 첫 배치 나머지 7구 master 적재의 **범위·null 좌표 정책·실행 방식** 결정과 apply 준비. **Production write 0.**

- 날짜: 2026-09-25 (KST) · 기준 `e3a16d4`(41115 파일럿 116행 적재 완료)
- 사용자 결정(2026-09-25): ① null 좌표 19행 **포함** ② **7회 단일 구 실행**

## 1. 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 대상 | 41111 · 41113 · 41117 · 41131 · 41133 · 41150 · 41210 (7구) | 매매 전체 이력 적재·parity 완료 구. 41115는 적재 완료(재실행 시 SKIP_EXISTING 116, insert 0) |
| 제외 | 41135(REVIEW) · 과거 전용 131 | 41135는 원천 층 공란 정책 미정. 과거 단지는 서울 정책(재건축 승계 증거 없음) |
| null 좌표 | **포함** — 19행 lat/lng null · `geocodeQuality='failed'` | 서울 규칙과 같다(`SEOUL_MASTER_COORDINATE_REVERSE_CHECK_V1` §2 "좌표가 null이어도 insert — canonical 단지를 버리지 않음", 운영 서울 null 117행) |
| 실행 | 구마다 1회, 총 7회 | 한 번에 한 구 게이트 유지 → 구마다 runId·해시·검증·rollback 단위. 첫 실패에서 멈춘다 |
| 순서 | 41111 → 41117 → 41133 → 41131 → 41210 → 41113 → 41150 | 좌표 100% 구 먼저, 그다음 규모 작은 순 |

## 2. null 좌표 master의 제품 동작 (코드 확인)

| 표면 | 동작 | 위험 |
|---|---|---|
| 지도 | `resolveApartmentCoords`: dong+name 완전일치만(2순위 이름 매칭 제거됨, MAP_TIER2_FALLBACK_REMOVAL_V1) → aptSeq는 붙고 좌표 null → **마커 없음** | 다른 단지 좌표 차용 0 |
| 상세 | `resolveCanonicalCoords`: aptSeq로 찾으면 좌표가 없어도 이름 검색으로 내려가지 않음 → NO_COORDINATE | 오좌표 0 |
| 주변 단지(분양·학교) | 위경도 범위 조건이라 자동 제외 | 없음 |
| 검색 | lat/lng null로 결과 반환(서울 117행과 같은 동작) | 경기는 공개 차단 중 |

미포함 시에는 19개 단지가 master 없이 남아, 공개 후 검색 불가·상세 canonical identity 없음이 된다. 좌표는 나중에 별도 enrichment(update 경로 — 승인 필요)로 채울 수 있다.

## 3. 재계획 (운영 READ ONLY preflight, `--allow-null-coords`, Kakao 0)

| 순서 | 구 | insert | 좌표 | null | plan hash | 게이트 |
|---|---|---|---|---|---|---|
| 1 | 41111 수원 장안구 | 155 | 155 | 0 | `4bdc17b8b8cf0d6ee06a48ed681ccefb5a287a3b850761e6c8722a9c2cb71e33` | allowed |
| 2 | 41117 수원 영통구 | 148 | 148 | 0 | `8c08d08ca79eecf21c05efd68c90808834f6b7e10f08c06cc434ea9fb4d77027` | allowed |
| 3 | 41133 성남 중원구 | 93 | 91 | 2 | `16ab0041a7e9180a2f9c337736b6ef7a12a37f700a7eb973124e0e5f34df6908` | allowed |
| 4 | 41131 성남 수정구 | 92 | 90 | 2 | `3bd2fd2499a3f1f59ebdb4b4a0e878b7899e692f22e06b20231f84bcc185f2b7` | allowed |
| 5 | 41210 광명시 | 104 | 100 | 4 | `08bdf71238bf1e30cb4dd4eb537a26f89133cf0bcd63b99ec228dd670f0e848f` | allowed |
| 6 | 41113 수원 권선구 | 196 | 192 | 4 | `20f55d1d56d67c27864f716128720f9f754b78c0f226ddc77b5b0d4200832dc8` | allowed |
| 7 | 41150 의정부시 | 289 | 282 | 7 | `ec6cb051bc2b8c193474dee724756037843925b1f0647ca040045d54cce7730b` | allowed |
| | **합계** | **1,077** | **1,058** | **19** | | |

모든 해시가 dry-run(`252cadb`) 값과 같다(좌표만/null 포함 두 변형 모두). 기존 경기 master 116(41115)은 적용 기록으로 출처가 확인돼 unexpected 0. 적용 후 경기 master 예상 **1,193**(좌표 1,174 · null 19).

## 4. 코드 변경

- `GG_APPLY_ALLOWED_DISTRICTS`: `['41115']` → 첫 배치 8구(41135 제외). `EXACTLY_ONE_DISTRICT_REQUIRED`는 유지.
- 적용 기록에 `nullCoordAptSeqs`(계획상 null 좌표 aptSeq) 추가. 사후 검증 `COORDS_COMPLETE` → **`COORDS_AS_PLANNED`**: 계획상 null인 aptSeq만 null, 나머지는 전부 좌표. 41115 기록 재검증 8/8 PASS.
- null 좌표 행은 여전히 `--allow-null-coords`를 명시해야 들어간다 — 빠뜨리면 insert 수·해시가 달라 게이트가 거부한다.

## 5. 실행 명령 — **NOT EXECUTED** (구마다 1회, 순서대로, 실패 시 중단)

공통 접두: `ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/national-backfill/gyeonggi-master-seed.ts --apply --allow-null-coords --live`

```
… --district=41111 --expect-inserts=155 --expect-plan-hash=4bdc17b8b8cf0d6ee06a48ed681ccefb5a287a3b850761e6c8722a9c2cb71e33
… --district=41117 --expect-inserts=148 --expect-plan-hash=8c08d08ca79eecf21c05efd68c90808834f6b7e10f08c06cc434ea9fb4d77027
… --district=41133 --expect-inserts=93  --expect-plan-hash=16ab0041a7e9180a2f9c337736b6ef7a12a37f700a7eb973124e0e5f34df6908
… --district=41131 --expect-inserts=92  --expect-plan-hash=3bd2fd2499a3f1f59ebdb4b4a0e878b7899e692f22e06b20231f84bcc185f2b7
… --district=41210 --expect-inserts=104 --expect-plan-hash=08bdf71238bf1e30cb4dd4eb537a26f89133cf0bcd63b99ec228dd670f0e848f
… --district=41113 --expect-inserts=196 --expect-plan-hash=20f55d1d56d67c27864f716128720f9f754b78c0f226ddc77b5b0d4200832dc8
… --district=41150 --expect-inserts=289 --expect-plan-hash=ec6cb051bc2b8c193474dee724756037843925b1f0647ca040045d54cce7730b
```

각 실행 직후 자동 verify(`--live` 포함)가 PASS여야 다음 구로 간다. 마지막에 8구 전체 독립 검증(파일럿 V1과 같은 스크립트: parity · 거래 연결 · 좌표 · 부산/서울 fingerprint · 공개 차단).

## 6. 알려진 한계

- 자동 verify의 `MASTER_COUNT_DELTA`는 **그 실행 직후** 기준이다(적용 전 시도별 수와 비교). 뒤 구가 적용된 뒤 앞 구 기록을 다시 verify하면 경기 증가분이 커서 실패한다 — 전체 검증은 별도 스크립트로 한다.
- 체크포인트·raw 캐시는 로컬 `tmp/`(이 PC)에만 있다.
- 19행 좌표 보강은 이번 범위 밖(update 경로 — 별도 승인).
- 경기 공개(검색·지도·상세·선택기)와 경기 cron은 여전히 닫혀 있다 — 별도 STEP.
