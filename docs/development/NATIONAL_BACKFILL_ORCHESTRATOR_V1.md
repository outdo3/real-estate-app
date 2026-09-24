# NATIONAL BACKFILL ORCHESTRATOR V1

- 일시: 2026-09-24 (KST)
- 범위: 구현 + 테스트 + Production **읽기 전용** audit/plan + 3셀 원천 검증. Production write 0 · apply 0 · 공개/cron 변경 0

## 1. 기존 구조(재사용)

| 조각 | 위치 | 재사용 |
|---|---|---|
| 셀 수집(전 페이지, totalCount 대조, 오류=PARTIAL) | `seed-seoul-apartment-master-logic.fetchSaleCell` | 그대로 |
| 계획(insert·취소 flip/restore·등기일·자연키 skip 선계산) | `backfill-seoul-sale.runBackfill` → `planSaleCellWrites` | 그대로 |
| 셀 checkpoint + raw gzip 재사용 + quota 정지 | 같은 driver | 그대로 |
| apply 게이트(env 3종·expect-inserts·READY·기존행 승인) + `syncOneSaleCell` | 같은 driver | 그대로(전국 게이트를 앞에 한 겹 추가) |
| Production 가드 | `_prod-db-guard` | 그대로 |

서울 전용 하드코딩(최소 일반화, 기본값은 서울 동작 불변): `resolveScope`·`classifyTradeMaster`의 `SEOUL_CODES`
→ 선택 인자 `allowedDistricts`·`knownCodes` / master 조회 `sgg_cd LIKE '11%'` → `masterAptSeqsFor(sgg_cd IN …)` /
PARTIAL 자동 재시도 → `retryPartial`(전국은 `--retry-errors`일 때만). 기존 driver 테스트 전부 통과.

## 2. 전국 inventory

출처: registry.ts와 같은 `REGCODE_PROXY`(MOLIT quota 무관). `region-inventory.snapshot.json`으로 고정,
생성기(`build-inventory-snapshot.ts`)는 registry(부산·서울·경기 89개)와 코드·이름·leaf가 **완전히 일치**할 때만 저장.

- 16 시도 · 261 시군구 · leaf 250 · 부모 시 11(수원·성남·안양·안산·고양·용인·청주·천안·전주·포항·창원)
- leaf 판정: 같은 앞 4자리 + **자식 이름이 부모 이름으로 시작**할 때만 부모(영동군 43740 / 증평군 43745 오판정 수정)
- 알려진 공백(코드를 만들지 않음): 세종(36) 0행 · 전북 52 계열 없음(45만) · 대구 군위(27720) 없음(47720만) · 부천·화성 일반구 자식 없음
- 코드 체계 검토 메모(unverified, 보수적 방향으로만 작동): 시도 45·51, 47720, 41190, 41590, 28177

## 3. Production 읽기 전용 audit (2026-09-24 22:23 KST)

| 상태 | 수 | 내용 |
|---|---|---|
| COMPLETE | 24 | 부산 16 + 서울 8 (2006-01부터 249개월, cron 유지, 어제 검증) |
| PARTIAL | 2 | 11680 강남 46행 · 27110 대구 중구 86행(둘 다 2026-08만) |
| REVIEW_REQUIRED | 37 | 전북 45 계열 15 · 강원 51 계열 18 · 28177 · 41190 · 41590 · 47720 |
| BLOCKED | 11 | 부모 시 코드 |
| NOT_STARTED | 187 | 서울 16 · 경기 40 · 인천 9 · 광역시 23 · 도 99 |

inventory 밖 lawd_cd의 행 0. 다중 페이지 prior = 6.4%(해운대 16/249개월, 관측 최대).
수요 증거: 비공개 지역 상세 조회는 90일간 5개 구·각 ≤3 세션 — 순위 근거로 쓰기에 부족해 쓰지 않았다.

## 4. quota 모델

| 항목 | 값 | 근거 |
|---|---|---|
| 일일 한도 | 10,000 | 운영 정책 |
| 예비 | 2,000 | 운영 정책 |
| cron | 479 | 코드 상수: 부산(4+10+2)×16 + 서울(4+10)×8 = 368 × 1.3 |
| 앱 live MOLIT | 1,000 | **가정**(계측 없음). 참고: 09-24 22:30 KST 잔여 8,917 → 당일 누적 ≈1,083(cron+앱) |
| 안전 backfill 예산 | 6,521 | 한도 − 예비 − cron − 앱 |

호출 추정 = 월 수(255, 2005-07~2026-09) + 추가 페이지(이력 있으면 DB 월별 실측, 없으면 prior) × 여유(1.15 미지·1.1 기지).
2-pass: apply(`syncOneSaleCell`)는 셀마다 원천을 다시 가져오므로 **apply = dry-run**. 실행 시 driver가 `--max-calls`·예비분에서 멈춘다(추정이 틀려도 초과 불가).

## 5. checkpoint · resume · 게이트

`tmp/national-backfill/{readiness.json,readiness.csv,plan.json,summary.json,districts/<lawdCd>/{checkpoint.json,checkpoints/,raw/,…}}`

- 셀: PENDING · FETCHED · READY · APPLIED · EMPTY_VALID · REVIEW · BLOCKED · ERROR (driver가 기록한 상태로만 매핑)
- 구: 나쁜 상태 우선 집계. 코드 불연속(12개월 이상 앞/뒤 0건, 전부 0건)은 REVIEW
- resume: APPLIED 재적용 없음 · REVIEW/BLOCKED 자동 통과 없음 · ERROR는 `--retry-errors` · READY는 `--replan`일 때만(raw 재사용) · 기간이 다른 checkpoint는 다시 계획 · checkpoint가 있는데 `--resume`이 없으면 거부
- 구 격리: 구마다 별도 디렉터리·driver 실행, 한 구의 예외는 그 구만 ERROR
- apply 게이트(전국): env 3종 · 계획 구 == 요청 구 · 전 구 READY · expect-inserts == 재계획 insert · 기록 hash == raw 재계획 hash(MOLIT 0콜) == `--plan-hash` · review 0 · 새 review 없음 · 기존 행 UPDATE는 승인 필요 · 2시간 내 관측 quota − apply 추정 ≥ 예비. 통과 후에도 driver 게이트 재통과
- 공개(`publicReady`)는 항상 false, cron은 verify 통과 구를 `CRON_EXPANSION_CANDIDATES`로 출력만

## 6. 원천 검증(3콜)

| 셀 | 결과 |
|---|---|
| 41135 분당 2020-07 | 946행(1페이지 — 1000 근접, 다중 페이지 여유 타당) · 취소 4 · 계획 insert 946 · master 없음 946 |
| 41135 분당 2006-01 | 288행 — 초기 달 원천 존재 |
| 28177 미추홀 2017-01 | 225행 — 개칭(2018) 이전 달이 현 코드로 조회됨(검토 메모 1개월 반증, 전 기간 확인 전까지 REVIEW 유지) |

DB write 0. 잔여 quota 8,917 → 8,915.

## 7. 첫 전국 배치(권고)

`plan --strategy=priority --max-calls=3000 --max-districts=10` → PLANNED. 한 시의 일반구는 묶음으로만.

수원 41111·41113·41115·41117 · 성남 41131·41133·41135 · 의정부 41150 · 광명 41210
= 9구 · dry-run 2,817 · apply 2,817 · 합계 5,634(안전 예산 6,521 안).

dry-run: `ALLOW_PROD_DB_READ=1 npx tsx scripts/national-backfill/orchestrator.ts dry-run`
(apply 명령은 별도 승인 전까지 제공하지 않는다.)

## 8. 검증

- `npx tsx --test scripts/national-backfill/orchestrator.test.ts scripts/backfill-seoul-sale.test.ts scripts/audit-seoul-sale-backfill-plan.test.ts` 58/58
- `npx tsx --test "src/**/*.test.ts"` 2055/2055 · tsc 전체 27(기존 scripts/tmp, 신규·변경 파일 0) · src 0 · eslint 0 · build 0

## 9. 알려진 한계 / 다음

- 미이력 구의 원천 행 수는 모른다(추정은 호출 수만). dry-run이 실제 값을 준다
- 앱 live MOLIT 사용량은 계측값이 없다 — 일일 잔여 관측으로 보정 필요
- REVIEW 37구는 코드 연속성 probe(구당 2~3콜) 후 해제 여부 판단
- 세종·전북 52·군위 27720은 inventory 스냅샷 갱신이 선행
- 경기 9구 적재 후에도 master 0 → 지도·검색 노출 전 master seed STEP 필요
