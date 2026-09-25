# E-JIP GYEONGGI MASTER FULL BATCH APPLY V1

경기 첫 배치 나머지 7구 `ApartmentMaster` **1,077행 Production 적재**(사용자 승인, 2026-09-25 KST). 41115 파일럿(116)과 합쳐 경기 master **1,193**. 경기 공개는 계속 닫힘.

- 기준 코드 `6124038` · 실행기 `scripts/national-backfill/gyeonggi-master-seed.ts --apply` · 구마다 1회, 승인 순서 고정
- 적용 기록(로컬, 커밋 안 함): `tmp/gyeonggi-master-seed/applied/<runId>.json` · `.intent.json` · `.verify.json`

## 1. 사전 확인

git HEAD = origin/main = `6124038` · 다른 seed/backfill 프로세스 0 · 8구 checkpoint·raw 캐시(255개월) 존재 · 41115 기록 온전(116) · 경기 master 116 전부 41115 · 가드 `{ guarded: true, openAxes: [] }` · 운영 GET으로 경기 검색·지도·상세 차단, sitemap 경기 0 · 부산/서울 fingerprint 기록.

## 2. 구별 적용

각 구: preflight(READ ONLY) 값이 전부 기대와 같을 때만 apply 1회 → 자동 verify(12항목, 운영 GET 포함) PASS 확인 후 다음 구.

| 순서 | 구 | 기대 | insert | 좌표 | null | REVIEW | 실패 | runId | verify |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 41111 | 155 | 155 | 155 | 0 | 0 | 0 | `gg-master-41111-2026-09-25T11-25-23-718Z-2bb9ea` | 12/12 |
| 2 | 41117 | 148 | 148 | 148 | 0 | 0 | 0 | `gg-master-41117-2026-09-25T11-26-19-634Z-b1d1d7` | 12/12 |
| 3 | 41133 | 93 | 93 | 91 | 2 | 0 | 0 | `gg-master-41133-2026-09-25T11-27-11-642Z-f0ea18` | 12/12 |
| 4 | 41131 | 92 | 92 | 90 | 2 | 0 | 0 | `gg-master-41131-2026-09-25T11-27-36-804Z-23d853` | 12/12 |
| 5 | 41210 | 104 | 104 | 100 | 4 | 0 | 0 | `gg-master-41210-2026-09-25T11-28-23-564Z-4de966` | 12/12 |
| 6 | 41113 | 196 | 196 | 192 | 4 | 0 | 0 | `gg-master-41113-2026-09-25T11-28-48-158Z-90a077` | 12/12 |
| 7 | 41150 | 289 | 289 | 282 | 7 | 0 | 0 | `gg-master-41150-2026-09-25T11-29-27-896Z-bdddd7` | 12/12 |

41111·41117은 승인 명령대로 `--allow-null-coords` 없이, 나머지 5구는 포함해 실행. update 0 · delete 0.

## 3. 8구 독립 검증 (별도 READ ONLY 스크립트)

| 항목 | 결과 |
|---|---|
| 경기 master | **1,193** = 41111 155 · 41113 196 · 41115 116 · 41117 148 · 41131 92 · 41133 93 · 41150 289 · 41210 104 |
| 좌표 | 1,174 · null 19 |
| parity | 계획 1,193 대비 missing 0 · extra 0 · 필드 불일치 0 · aptSeq 중복 0 · enrichment 필드 null · basicSpecSource UNKNOWN → **MASTER_PARITY_EXACT** |
| null 좌표 | 계획 19 = DB 19, 계획 밖 null 0, 계획상 null인데 좌표 있음 0, 전부 `geocodeQuality='failed'`, 좌표 행은 전부 `exact` |
| 거래 연결 | aptSeq 정확 일치 · 같은 구: linked 1,193 · orphan 0 · 다른 구 연결 0 |
| 좌표 무결성 | 범위 밖·0,0 없음 · 같은 좌표 26그룹(전부 같은 필지) · 다른 필지 같은 좌표 0 |
| 부산 / 서울 | 3,438 / 6,843 — fingerprint 적용 전과 동일 |
| 41135 | master 0 · 거래 0(REVIEW 그대로) |
| 과거 전용 131 | master 0 |

## 4. 공개 노출 (운영 GET)

8구 × (검색 3건 · 지도 · 상세 · 점수 · 단지 리포트 · 상세 페이지 · 비교 리포트 · `/stats/compare` · stats rankings) + `large-complex?sidoCode=41` + sitemap: **누출 0**(검색 21회 경기 결과 0, 지도 전부 `regionUnsupported`, 상세·점수 `UNSUPPORTED_REGION`, 페이지 전부 noindex·단지명 없음, sitemap 경기 0). 가드 `{ guarded: true, openAxes: [] }`.

## 5. 부산·서울 회귀

배치 전/후 같은 스크립트(검색 6 · 마커 8구 · 상세 5 · 페이지 11 · sitemap · 점수 · 정보) 출력 **완전히 동일**.

## 6. 일일 리포트 — NO_IMPACT

`/report/daily/2026-09-25`·`2026-09-24` 화면 텍스트 배치 전후 동일(백필 감지는 거래 행 기준).

## 7. Rollback 준비 (실행 안 함)

적용 기록 8개(파일럿 포함) · id 1,193개 전부 서로 다름(구마다 연속 구간 12270–13462) · 각 기록의 rollback 게이트를 **평가만** 하면 전부 allowed — 각자 자기 구·runId·id·created_at 창만 지운다. 구 전체를 지우는 문장 없음.

## 8. 다음

GYEONGGI_CRON_AND_PUBLIC_READINESS_AUDIT. 범위 밖으로 남긴 것: 경기 공개·경기 cron·null 좌표 19행 보강·41135·과거 전용 131.
