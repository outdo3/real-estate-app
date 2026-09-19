# E-JIP SEOUL MASTER JUNG-GU PILOT APPLY V1

서울 중구(11140) `ApartmentMaster` 107행 **Production create-only 적재**(사용자 승인). 다른 구·Tier B·REVIEW·enable 없음.

- 날짜: 2026-09-19 (KST) · 기준 커밋 `86887df`
- 선행: `SEOUL_MASTER_SEED_PLAN_V1.md` → `SEOUL_MASTER_SEED_SCRIPT_V1.md` → `SEOUL_MASTER_COORDINATE_REVERSE_CHECK_V1.md`
- 코드 변경 없음(승인된 스크립트 그대로 실행)

## 1. 승인

사용자 승인: "서울 중구(11140) MASTER 107건 Production 파일럿 적재 승인." 범위는 중구 107행 INSERT만.

## 2. 적재 전 baseline (READ ONLY)

| 항목 | 기대 | 실제 |
|---|---|---|
| 서울 master | 0 | 0 |
| 부산 master | 3,438 | 3,438 |
| 부산 fingerprint | `98dd4a45…` | `98dd4a454ff92ac91bd1625a6407e37e` |
| 부산 최종 updated_at | — | 2026-09-11T11:51:36.073Z |
| 부산 좌표 null | — | 37 |
| 서울 매매 행 | — | 46(강남구 1개 구) |

적재 직전 dry-run(`--district=11140`, 같은 checkpoint 재사용 · 외부 호출 0 · DB PRODUCTION): 대상 구 11140 · READY 107 · 기존 0 · REVIEW 0 · Tier B 0 · 좌표 VERIFIED 106 · null 1(11140-30) — 전부 기대값과 같아 진행. 전체 25구 dry-run 산출물은 `tmp/seoul-master-seed-run/full-dryrun-20260919/`에 보존.

## 3. 실행 명령 (승인된 그대로)

```
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/seed-seoul-apartment-master.ts --apply --district=11140 --expect-ready=107
```

출력: `[APPLY 점검] 대상 구 11140 · READY 107 · 기존 SKIP 0 · REVIEW 0 · DB PRODUCTION` → `[APPLY] inserted 107 · skippedExisting 0 · failed 0` (exit 0).

## 4. 결과

| 항목 | 값 |
|---|---|
| inserted | **107** |
| skipped existing / P2002 | 0 |
| failed / DB error / timeout | 0 |
| batch | 2026-09-19T08:06:24.140Z ~ 08:06:26.823Z (**2.68초**) |
| id 범위 | 5427 ~ 5533(107개 연속) |
| 외부 API 호출 | 0(checkpoint 재사용, enrichment 없음) |

## 5. 적재 직후 감사 (READ ONLY)

| 항목 | 기대 | 실제 |
|---|---|---|
| 서울 master 합계 | 107 | 107 |
| 중구(11140) | 107 | 107 |
| 서울 다른 구 | 0 | 0 |
| 전체 master | 3,545 | 3,545 |
| aptSeq non-null / unique | 107 / 107 | 107 / 107 |
| 좌표 non-null(`geocode_quality='exact'`) | 106 | 106 |
| 좌표 null(`'failed'`) | 1 | 1 — **11140-30 동평화패션타운**(신당동 217-95, REVERSE_MISMATCH) |
| sido/sigungu = 서울특별시/중구 | 107 | 107 |
| enrichment 필드(도로명·세대수·관리번호) | 0 | 0 |
| 전 행 read-back vs dry-run(이름·구·법정동·umdCd·지번·건축년도·좌표·품질) | 차이 0 | 차이 0(107/107) |
| DB id = artifact id | 일치 | 일치 |

표본 10건(aptSeq 순 균등 간격):

| aptSeq | 단지 | 법정동 | umdCd | 지번 | 건축년도 | 좌표 |
|---|---|---|---|---|---|---|
| 11140-1 | 경서 | 남창동 | 11200 | 205-44 | 1970 | 37.55680, 126.97760 |
| 11140-1053 | 상지리츠빌장충동카일룸 | 장충동1가 | 14300 | 104 | 2008 | 37.56004, 127.00721 |
| 11140-1141 | 래미안하이베르 | 신당동 | 16200 | 851 | 2011 | 37.56183, 127.02265 |
| 11140-1255 | 신당역솔하임 | 신당동 | 16200 | 140-23 | 2016 | 37.56541, 127.02123 |
| 11140-1303 | 충무로헤센스마트 | 충무로5가 | 13300 | 90 | 2018 | 37.56140, 126.99850 |
| 11140-1361 | 삼정아트테라스정동 | 정동 | 16700 | 37 | 2020 | 37.56320, 126.97193 |
| 11140-16 | 충무 | 묵정동 | 13600 | 11-2 | 1982 | 37.56078, 127.00069 |
| 11140-32 | 삼성 | 신당동 | 16200 | 843 | 1999 | 37.55817, 127.01790 |
| 11140-47 | 글로리안(B) | 신당동 | 16200 | 432-970 | 2002 | 37.55058, 127.00638 |
| 11140-65 | 벨레어카운티 | 신당동 | 16200 | 407-17 | 2004 | 37.55880, 127.00874 |

## 6. 부산 격리

| 항목 | 적재 전 | 적재 후 |
|---|---|---|
| 부산 master | 3,438 | 3,438 |
| fingerprint(apt_seq·좌표·updated_at) | `98dd4a454ff92ac91bd1625a6407e37e` | `98dd4a454ff92ac91bd1625a6407e37e` |
| 최종 updated_at | 2026-09-11T11:51:36.073Z | 2026-09-11T11:51:36.073Z |
| 좌표 null | 37 | 37 |

부산 UPDATE 0 · DELETE 0. 좌표 정리·전역 dedupe 없음(스크립트에 경로 없음).

## 7. Rollback artifact

`tmp/seoul-master-seed-run/applied-2026-09-19T08-06-24-140Z.json` (schema `seoul-master-seed-applied/v1`, 로컬 보관): entries **107**, 각 `{id, aptSeq, sggCd, createdAt}`, 전부 sggCd 11140. 실행하지 않은 템플릿:

```
DELETE FROM apartment_masters WHERE id = ANY($1::int[]) AND sgg_cd LIKE '11%' AND created_at BETWEEN $2 AND $3
-- $1 = 107개 id, $2/$3 = batch 시작/종료 시각
```

## 8. 기존 서울 매매 · 공개 상태

- 서울 매매 46행(강남구) 그대로 — 중구 master와 연결되지 않으며 매핑 변경 없음.
- `src/`·`vercel.json` 변경 0. `enablement.ts`의 `'11'`은 여전히 주석(미출시) → app/report/stats/sitemap/seoIndex/cronSync 모두 false.
- Production 확인: `/api/stats/dashboard?lawdCd=11140` → `UNSUPPORTED_REGION` · `/report/district/11140` → 기존 "리포트를 만들 수 없는 지역입니다"(noindex, 코드 게이트) · sitemap 139 URL, 서울 0.

## 9. 최종 확인

Production INSERT 107 · UPDATE 0 · DELETE 0 · 서울 107 · 중구 107 · 부산 3,438 · 좌표 106/1 · schema 0 · migration 0 · stats/cronSync/SEO enable 0.

## 10. 다음

나머지 24구 6,736행(좌표 VERIFIED 6,620 · null 116)은 **별도 명시 승인 전까지 적재하지 않는다**.
