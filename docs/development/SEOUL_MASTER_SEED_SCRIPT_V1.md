# E-JIP SEOUL MASTER SEED SCRIPT V1

서울 `ApartmentMaster` **Tier A(매매 discovery) 6,843행**을 나중에 create-only로 적재할 전용 스크립트. **CODE ONLY** — 이번 STEP에서 `--apply`를 실행하지 않았고 Production write는 0이다.

- 날짜: 2026-09-19 (KST) · 기준 커밋 `17df55e` · 선행: `SEOUL_MASTER_SEED_PLAN_V1.md`
- 파일: `scripts/seed-seoul-apartment-master.ts`(실행·의존성) · `scripts/seed-seoul-apartment-master-logic.ts`(순수 판정) · `scripts/seed-seoul-apartment-master.test.ts`(24개)
- 산출물(로컬, 커밋 안 함): `tmp/seoul-master-seed-run/` — summary · ready-to-insert · existing-skipped · review-required · coordinate-missing · district-status · source-errors · identity-corrections · excluded-tier-b · held-back-and-out-of-target · coordinate-reverse-audit · checkpoints/ · raw/ · pilot-11140/

## 1. 기존 seed 스크립트를 쓰지 않는 이유

`scripts/apartment_master_seed.ts`(부산 M3/M4-B)는 서울에서 안전하지 않다.

| 결함 | 서울에서의 결과 |
|---|---|
| `numOfRows=1000` 1쪽만, totalCount 미검증 | 노원구 1,042행 셀 절단 |
| 오류 응답을 `[]`로 반환 | 실패한 달이 "거래 없음"이 되어 단지 누락 |
| `deduplicateCoordinates()`가 **전체** master 조회 후 update | 서울 실행이 부산 좌표 공유 28단지를 null로 만들 수 있음 |
| `"{동} {단지명}"` 키워드 첫 결과를 `normalized` 좌표로 저장 | 다른 단지 좌표 저장 위험 |
| upsert | 첫 seed에 불필요한 덮어쓰기 경로 |

## 2. 설계

| 항목 | 구현 |
|---|---|
| 원천 | MOLIT 매매만(`RTMSDataSvcAptTradeDev`). 전월세 API를 호출하지 않아 Tier B는 구조적으로 후보가 되지 않는다 |
| paging | `fetchSaleCell` — totalCount까지 모든 페이지, 수집 수 = totalCount일 때만 COMPLETE. 첫 페이지 실패 = ERROR, 이후 실패·개수 불일치·totalCount 변동 = PARTIAL |
| 오류 분류 | HTTP_ERROR · PARSE_ERROR · TIMEOUT · RESULT_CODE · RATE_LIMITED · NETWORK — 빈 결과로 바꾸지 않음. 재시도는 제한 횟수만(제한 4회·타임아웃 2회·5xx 2회) |
| 구 보류 | COMPLETE가 아닌 셀이 하나라도 있으면 그 구 전체 PARTIAL → 그 구 행 0. 보류 구의 부분 데이터는 identity 판정에도 쓰지 않음. 다른 구 응답에 실린 그 구 aptSeq도 HELD_BACK |
| identity | aptSeq 필수 · 서울 25구 prefix · 필수 필드(이름·법정동·umdCd 5자리·지번) · 원천끼리 법정동코드/지번 충돌 없음(`classifyIdentity`). 이름·지번·좌표로 merge/생성 없음 |
| 여러 구 오기재 | 이름·법정동·지번이 같으면 **aptSeq 앞 5자리 구**를 canonical로(요청 구는 identity로 쓰지 않음), `identity-corrections.json` 기록. 다르면 REVIEW |
| 계획 범위 | 계획 artifact의 Tier B/REVIEW aptSeq가 매매에 나타나도 `EXCLUDED_PLAN_*`로 제외(승인 범위 고정) |
| 기존 행 | `apt_seq = ANY(서울 aptSeq 목록)`만 조회(READ ONLY 트랜잭션) → EXISTING_SKIPPED. 다른 필드 비교·수정 없음 |
| 좌표 | Kakao **주소 검색**(`address.json`, `analyze_type=exact`) `서울 {구} {법정동} {지번}` → `REGION_ADDR` 결과 중 시도=서울·구·법정동·산 여부·본번·부번이 모두 같은 결과가 **정확히 1개**일 때만 EXACT. 동 대표점·다른 구·여러 개·지번 해석 불가는 lat/lng null. 키워드 검색은 호출하지 않는다 |
| 부산 격리 | DB 조회는 서울 aptSeq로만, 쓰기는 `sggCd`가 서울 25구이고 aptSeq가 그 코드로 시작하는 행만(`createMaster` 가드). 전역 좌표 정리 없음 |
| create-only | 쓰기 경로는 `prisma.apartmentMaster.create` 하나. update/upsert/delete/createMany/raw write 없음(테스트 12가 소스로 고정). unique 위반(P2002) = DUPLICATE → SKIP |
| 생성 필드 | aptSeq · name · normalizedName · sido('서울특별시') · sigungu · sggCd · umdName · umdCd · jibun · buildYear · latitude/longitude(EXACT만) · geocodeQuality('exact' / 조회했으나 불일치 'failed' / 미조회 null). `roadAddress` 등 enrichment 필드는 넣지 않음 |
| checkpoint | `checkpoints/<구>.json` — 상태(PENDING→FETCHED→VALIDATED→COORDINATED→READY / PARTIAL / BLOCKED), 셀 결과, 좌표 결과. 재실행 시 완료 구는 재수집하지 않고, PARTIAL 구만 다시 수집, 좌표는 끝난 행을 건너뜀. 수집 창(24개월)이 바뀌면 재수집 |
| Kakao 제한 | 429는 2회만 재시도 → RATE_LIMITED면 좌표 단계 즉시 중단(나머지 PENDING, 구 상태 VALIDATED) → 다음 실행에서 이어감. `--skip-coordinates`로 좌표 없이 dry-run 가능(apply는 거부) |

## 3. Apply 게이트 (전부 필요)

1. `--apply`
2. `ALLOW_PROD_DB_WRITE=1` (BACKFILL 가드 재사용 — `_prod-db-guard.ts`)
3. `--district=<서울 구 코드>` 명시, 대상 구 전부 READY
4. `--expect-ready=<dry-run READY 수>` 와 실제 READY 수 일치
5. 좌표 단계 생략(`--skip-coordinates`) 아님

apply 진입 전 콘솔에 대상 구 · READY · 기존 SKIP · REVIEW · DB 종류(PRODUCTION/NON_PRODUCTION, 호스트 문자열은 출력 안 함)를 찍고, 게이트가 하나라도 막히면 사유를 `summary.json`에 남기고 쓰기 DB 객체를 만들지 않는다. apply 직전 기존 aptSeq를 한 번 더 조회한다. 실제 apply에는 읽기 가드도 통과해야 하므로 `ALLOW_PROD_DB_READ=1`도 함께 필요하다.

## 4. Rollback artifact

`applied-<timestamp>.json` (schema `seoul-master-seed-applied/v1`): batch 시작/종료 시각 · 대상 구 · DB 종류 · 삽입 행 `{aptSeq, id, sggCd, createdAt}` · SKIP · 실패 · 실행하지 않은 삭제 템플릿
`DELETE FROM apartment_masters WHERE id = ANY($1::int[]) AND sgg_cd LIKE '11%' AND created_at BETWEEN $2 AND $3` (+ params). 이번 STEP에서는 가짜 DB로 구조만 검증(테스트 23).

## 5. Dry-run 결과 (Production READ ONLY)

### 중구 파일럿 (`--district=11140`, 별도 폴더 `pilot-11140/`)

READY **107** · 기존 0 · REVIEW 0 · 좌표 EXACT **107/107** · MOLIT 24쪽 · Kakao 107회 · 계획 Tier A 107과 차이 0.

### 전체 25개 구

| 항목 | 결과 |
|---|---|
| 창 | 202410~202609(24개월) |
| 셀 | 600/600 COMPLETE, source error 0, 다중 페이지 1(노원구 1,042행 → 2쪽, COMPLETE) |
| 구 상태 | 25/25 READY, 보류 0 |
| discovered | 6,843 = READY 6,843 (기존 0 · REVIEW 0 · 보류 0 · 계획 제외 0 · 대상 밖 0) |
| 계획 대비 | 계획 Tier A 6,843 중 지금 없는 것 0 · 지금 있으나 계획에 없는 것 0 |
| identity 정정 | 4(11140-1012 · 11230-2029 · 11320-87 · 11590-3369, 모두 표기 동일한 이웃 구 오기재) |
| 좌표 | EXACT **6,839 (99.94%)** · NO_MATCH 2 · 지번 해석 불가 2 · ERROR 0 · RATE_LIMITED 0 |
| 호출 | MOLIT 601쪽 · Kakao 6,843(파일럿 포함 6,950, 429 0) |
| 재실행 | 25구 checkpoint 재사용, MOLIT 0 · Kakao 0 호출, 결과 동일 |

좌표 미확보 4건(lat/lng null로 적재 예정, `coordinate-missing.json`):

| aptSeq | 단지 | 법정동 지번 | 사유 |
|---|---|---|---|
| 11200-4192 | 라체르보푸르지오써밋 | 행당동 128 | NO_MATCH(신축 — Kakao 지번 결과 없음) |
| 11215-5148 | 롯데캐슬리버파크시그니쳐 | 자양동 863 | NO_MATCH(신축) |
| 11530-4350 | 하버라인4단지 | 항동 가-238 | 블록 지번(해석 불가) |
| 11740-5234 | 고덕풍경채어바니티 | 고덕동 BL-3-1 | 블록 지번(해석 불가) |

### 좌표 독립 검증 (`coordinate-reverse-audit.json`)

- 구별 5건(125건) 좌표를 Kakao 역지오코딩으로 다시 조회: **124/125가 원천 필지와 같음**. 1건(11590-1 건영(103동-106동), 노량진동 324)은 정방향은 필지 일치였지만 그 대표점이 이웃 필지(상도동 414)로 역조회됨 — Kakao 필지 대표점이 필지 경계 밖에 찍히는 사례.
- 좌표를 공유하는 READY 행: 35그룹 · 88행, **전부 같은 법정동+지번**(계획 단계 같은 필지 35그룹·88 aptSeq와 일치). 서로 다른 필지가 같은 좌표인 경우 0.

### 부산 격리 확인 (READ ONLY)

dry-run 후 `apartment_masters`: 서울 0 · 부산 3,438 · 부산 최종 `updated_at` 2026-09-11(오늘 변경 없음) · 부산 좌표 fingerprint `98dd4a454ff92ac91bd1625a6407e37e`(파일럿 apply 전후 비교 기준).

## 6. 테스트

`scripts/seed-seoul-apartment-master.test.ts` 24개(+보류 구 identity 1): 1000행 초과 페이지 · totalCount 완전성 · HTTP/파싱/타임아웃 ≠ 빈 결과 · 부분 셀 구 보류 · 기존 SKIP · aptSeq 없음 · 서울 외 · 오기재 정정 · 동명/동지번 유지 · create-only(소스 고정) · 필지 일치 채택/거부 · 키워드 미사용 · 부산 불변 · Tier B/REVIEW 제외 · checkpoint/좌표 재개 · dry-run 쓰기 0 · 게이트 4종 · 구 필터 · rollback artifact · 재실행 멱등 · 동시 삽입 충돌.

```
npx tsx --test scripts/seed-seoul-apartment-master.test.ts        pass 24  fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"           pass 190 fail 0
npx eslint (신규 3파일)                                             exit 0
npx tsc --noEmit                                                  신규 파일 0 · src 0 · 기존 25건 scripts/tmp → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                                     exit 0
```

## 7. 알려진 한계

- 좌표 4건 null(신축 2 · 블록 지번 2). 후속 enrichment에서 건축물대장 주소로 재시도 가능(이 스크립트는 update 경로가 없으므로 별도 STEP).
- 정방향 필지 일치 좌표 중 역조회 불일치 약 1/125 — 필요하면 역조회 검증 단계를 추가할 수 있다(단지당 Kakao 1회 추가).
- 창은 실행 시점 KST 기준 최근 24개월이라 달이 바뀌면 후보가 달라질 수 있다 — checkpoint의 창이 다르면 자동 재수집, 계획 대비 차이는 `summary.planComparison`에 기록.
- Kakao 일일 한도는 확인하지 않았다(이번 6,950회 동안 429 0).

## 8. 파일럿 제안

```
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/seed-seoul-apartment-master.ts --apply --district=11140 --expect-ready=107
```

중구 **107행**(좌표 107/107 EXACT). 승인 후에만 실행. 사후 감사: 서울 107 · 부산 3,438 · 부산 fingerprint 불변 · `applied-*.json` id 107개.
