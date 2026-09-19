# E-JIP SEOUL MASTER SIDO NORMALIZATION V1

서울 `ApartmentMaster` 6,843행의 `sido`를 프로젝트 표준 축약 표기로 정정: **'서울특별시' → '서울'**(사용자 승인 Production UPDATE). seed 스크립트도 registry 축약 표기를 쓰도록 수정.

- 날짜: 2026-09-19 (KST) · 기준 커밋 `73f85f9`
- 변경: `scripts/seed-seoul-apartment-master-logic.ts`(sido = registry shortName) · `scripts/normalize-seoul-master-sido.ts`(신규, dry-run 기본) · `scripts/normalize-seoul-master-sido.test.ts`(신규 7)
- 산출물(로컬): `tmp/seoul-master-sido-normalization/` — before-*.json(6,843행 스냅샷) · rollback-*.json(되돌림 템플릿, 미실행) · applied-*.json(결과)

## 1. 승인 · 배경

사용자 승인: "Production 서울 apartment master 6,843건의 sido 값을 서울특별시 → 서울로 일괄 수정."
부산 master는 `sido='부산'`(축약)이고 `large-complex`(`where.sido = getSido(code).shortName`)와 점수 `peer-context`(`where { sido }`)가 이 표기로 조회한다. 서울 seed가 전체 명칭 '서울특별시'로 적재해 관행과 어긋났다(`SEOUL_SALE_BACKFILL_PLAN_V1.md` §18). 표준은 registry(`src/lib/region/registry.ts:58-60`: 부산·서울·경기).

## 2. Baseline (READ ONLY)

| 항목 | 값 |
|---|---|
| 서울 master | 6,843 |
| 서울 sido='서울특별시' / '서울' | 6,843 / 0 |
| 서울 aptSeq unique | 6,843 |
| 서울 좌표 non-null / null | 6,726 / 117 |
| 대상(이중 조건) / 대상 중 서울 밖 | 6,843 / 0 |
| 부산 master · sido 값 | 3,438 · ['부산'] |
| 부산 fingerprint(apt_seq·sido·name·좌표·updated_at) | `7785079a8c1fb0e68d9f4beabbfe171e` |
| 부산 최종 updated_at · 좌표 null | 2026-09-11T11:51:36.073Z · 37 |
| 전체 master | 10,281 |

## 3. 변경

```
UPDATE apartment_masters SET sido = '서울' WHERE sido = '서울특별시' AND sgg_cd LIKE '11%'
```

- 한 트랜잭션, 영향 행 수가 `--expect=6843`과 다르면 트랜잭션 되돌림(`assertAffected`).
- raw `SET sido`만 — 다른 컬럼(`updated_at` 포함) 불변.
- 실행: `ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/normalize-seoul-master-sido.ts --apply --expect=6843`
- 결과: **affected 6,843** · 0.97초 · 2026-09-19T11:50:57Z.

## 4. 사후 감사

| 항목 | 기대 | 실제 |
|---|---|---|
| 서울 master | 6,843 | 6,843 |
| sido='서울' | 6,843 | 6,843 |
| sido='서울특별시' 잔여 | 0 | 0 |
| aptSeq unique | 6,843 | 6,843 |
| 좌표 non-null / null | 6,726 / 117 | 6,726 / 117 |
| 스냅샷 비교(행 누락·추가) | 0 / 0 | 0 / 0 |
| sido 외 컬럼 변경(id·aptSeq·이름·정규화이름·sggCd·sigungu·법정동·umdCd·지번·건축년도·좌표·geocodeQuality·created_at·updated_at) | 0 | 0 |
| 부산 fingerprint | 불변 | `7785079a…` 동일(부산 기존 좌표 fingerprint `98dd4a45…`도 동일) |
| 부산 updated_at · sido · 좌표 null | 불변 | 2026-09-11 · ['부산'] · 37 |
| 전체 master | 10,281 | 10,281 |

INSERT 0 · DELETE 0 · UPDATE = 서울 6,843행의 sido만.

## 5. Rollback

`rollback-*.json`(실행하지 않음): `UPDATE apartment_masters SET sido='서울특별시' WHERE id = ANY($1::int[]) AND sgg_cd LIKE '11%' AND sido='서울'` + 스냅샷 id 6,843개. `before-*.json`에 전 행의 이전 값 보존.

## 6. Seed 스크립트

`toCreateData`의 `sido`를 literal에서 `SEOUL_SIDO_SHORT = getSido('11')!.shortName`('서울')으로 바꿨다 — 앞으로 서울 seed가 다시 전체 명칭을 쓰지 않는다. 부산·경기 코드 경로는 변경 없음.

## 7. 조회 준비도 (READ ONLY, 기능은 서울에서 닫힌 그대로)

| 경로 | 조회 형태 | 결과 |
|---|---|---|
| large-complex | `sido = getSido('11').shortName` | **6,843**행 조회됨. 단 route는 `totalHouseholds IS NOT NULL`도 요구 → 서울 0(세대수 enrichment 전) — 서울에서 쓰려면 건축물대장 enrichment 필요 |
| 점수 peer-context | 대상 master의 sido(은마 11680-218 → '서울') | peer universe **6,843** |

부산 large-complex 조회는 3,181(세대수 있는 행) — 변경 없음.

## 8. 공개 상태

`src/` · `vercel.json` · `prisma/` 변경 0. stats·cronSync·SEO·sitemap·report·학군 점수·large-complex 서울 노출 모두 그대로 닫힘.

## 9. 테스트

`scripts/normalize-seoul-master-sido.test.ts` 7개(요구 1~8): seed가 '서울'을 냄·전체 명칭 literal 없음 · registry 축약 표기(부산·서울·경기) · large-complex 조회 값 = 서울 master sido · peer-context가 대상 master sido로 조회 · 이중 조건 UPDATE와 서울 밖 대상 거부 · 영향 행 수/baseline/apply 게이트 · 스냅샷 비교.

```
npx tsx --test scripts/normalize-seoul-master-sido.test.ts scripts/seed-seoul-apartment-master.test.ts   pass 45 fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"                                                  pass 217 fail 0
npx eslint (변경 3파일)                                                                                  exit 0
npx tsc --noEmit                                                                                          변경 파일 0 · src 0 · 기존 25건 → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                                                                             exit 0
```

## 10. 남은 한계 · 다음

- 서울 large-complex는 sido가 맞아도 세대수(`totalHouseholds`)가 없어 비어 있다 — 건축물대장 enrichment(부산 하드코딩된 `backfill-apartment-master-basic-data.ts`의 지역 인자화)가 선행.
- 서울 매매 backfill은 이 STEP 범위 밖(`SEOUL_SALE_BACKFILL_PLAN_V1.md`, Defect A 선결).
