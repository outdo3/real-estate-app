# E-JIP SEOUL MASTER REMAINING 24 DISTRICTS APPLY V1

서울 Tier A 나머지 24개 구 **6,736행 Production create-only 적재**(사용자 승인). 중구(11140) 107행은 파일럿에서 이미 적재. Tier B·REVIEW·다른 지역·enable 없음.

- 날짜: 2026-09-19 (KST) · 기준 커밋 `8eedf11`
- 선행: `SEOUL_MASTER_JUNG_GU_PILOT_APPLY_V1.md`
- 저장소 코드 변경 없음 — 승인된 `scripts/seed-seoul-apartment-master.ts`를 구마다 그대로 호출. 순서·감사는 로컬 driver(세션 scratchpad, 저장소 밖)로 실행.

## 1. 승인

"서울 Tier A 나머지 24개 구 6,736건 Production 적재 승인." 중구 재삽입·Tier B 2,244·REVIEW 18·전월세 전용·경기·부산·오피스텔·분양·재개발 제외.

## 2. Baseline (READ ONLY, 2026-09-19T08:31Z)

서울 107(중구 107, 다른 구 0) · 전체 3,545 · 서울/부산 외 0 · 부산 3,438 · fingerprint `98dd4a454ff92ac91bd1625a6407e37e` · 부산 최종 updated_at 2026-09-11T11:51:36.073Z · 부산 좌표 null 37.
기대값은 승인 dry-run artifact(`tmp/seoul-master-seed-run/full-dryrun-20260919/`, reverse check 반영본)에서 읽음: 24구 · 6,736행 · VERIFIED 6,620 · null 116.

## 3. 구별 순차 절차 (코드 오름차순)

구마다:

1. **적재 직전 dry-run** `--district=<구>` — checkpoint 재사용(MOLIT·Kakao 호출 0이어야 함). READY·기존·REVIEW·Tier B·계획 REVIEW·보류·VERIFIED·null이 승인 artifact와 같고, 삽입 예정 행(aptSeq·이름·법정동·umdCd·지번·건축년도·좌표·좌표상태)이 승인 artifact 행과 **완전히 같을 때만** 진행.
2. **apply** — `ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/seed-seoul-apartment-master.ts --apply --district=<구> --expect-ready=<승인 artifact의 그 구 READY 수>`.
3. **즉시 read-back** — 그 구 DB 전 행을 삽입 예정 행과 필드별 비교, DB id = applied artifact id.
4. **부산 확인** — 수·fingerprint·updated_at·좌표 null.

어느 하나라도 다르면 그 자리에서 정지(이미 끝난 구는 유지, rollback 없음).

### 정지 1회와 원인

첫 실행에서 성동구(11200) 적재 직전 점검이 `OUT_OF_TARGET = 1`로 정지했다(쓰기 없음). 그 1행은 **11140-1012 한진해모로** — 승인 dry-run의 identity 정정 4건 중 하나로, MOLIT가 성동구 응답에도 싣지만 canonical 구는 중구이며 파일럿에서 이미 11140으로 적재됐다(DB 확인). 단일 구 실행에서는 정상적으로 "대상 밖"으로 분류된다. READY 159와 삽입 예정 행은 승인 artifact와 같았다.
→ driver 점검을 "OUT_OF_TARGET 행이 **승인 identity 정정 중 이 구에 실렸고 canonical 구가 다른 aptSeq와 정확히 같을 때만** 허용"으로 좁혀 재개했다(허용 목록: 11200→11140-1012 · 11290→11230-2029 · 11305→11320-87 · 11620→11590-3369, 그 밖의 구는 0). 완료 구(종로·용산)는 재실행하지 않았다.

## 4. 구별 결과

| 구 | 삽입 | SKIP | 실패 | insert batch | 대상 밖(허용) |
|---|---|---|---|---|---|
| 종로구 11110 | 99 | 0 | 0 | 2.3s | — |
| 용산구 11170 | 183 | 0 | 0 | 4.1s | — |
| 성동구 11200 | 159 | 0 | 0 | 3.4s | 11140-1012 |
| 광진구 11215 | 208 | 0 | 0 | 4.4s | — |
| 동대문구 11230 | 274 | 0 | 0 | 5.8s | — |
| 중랑구 11260 | 234 | 0 | 0 | 4.7s | — |
| 성북구 11290 | 176 | 0 | 0 | 3.7s | 11230-2029 |
| 강북구 11305 | 116 | 0 | 0 | 2.6s | 11320-87 |
| 도봉구 11320 | 179 | 0 | 0 | 3.3s | — |
| 노원구 11350 | 289 | 0 | 0 | 5.4s | — |
| 은평구 11380 | 404 | 0 | 0 | 7.6s | — |
| 서대문구 11410 | 235 | 0 | 0 | 4.6s | — |
| 마포구 11440 | 288 | 0 | 0 | 6.1s | — |
| 양천구 11470 | 378 | 0 | 0 | 6.8s | — |
| 강서구 11500 | 519 | 0 | 0 | 9.4s | — |
| 구로구 11530 | 376 | 0 | 0 | 6.8s | — |
| 금천구 11545 | 125 | 0 | 0 | 2.2s | — |
| 영등포구 11560 | 255 | 0 | 0 | 5.1s | — |
| 동작구 11590 | 209 | 0 | 0 | 4.0s | — |
| 관악구 11620 | 238 | 0 | 0 | 4.5s | 11590-3369 |
| 서초구 11650 | 503 | 0 | 0 | 8.7s | — |
| 강남구 11680 | 472 | 0 | 0 | 8.5s | — |
| 송파구 11710 | 369 | 0 | 0 | 6.6s | — |
| 강동구 11740 | 448 | 0 | 0 | 8.2s | — |
| **합계** | **6,736** | **0** | **0** | **128.7s** | 4 |

매 구 read-back 차이 0 · 부산 확인 통과. 시각: 08:31:35Z 시작 ~ 08:37:01Z 마지막 구 완료(성동구 정지·재개 포함). DB 오류·타임아웃·P2002 0. 외부 API 호출 0.

## 5. 최종 Production 감사 (READ ONLY, 08:37:32Z)

| 항목 | 기대 | 실제 |
|---|---|---|
| apartment_masters 전체 | 10,281 | 10,281 |
| 서울 | 6,843 | 6,843 |
| 부산 | 3,438 | 3,438 |
| 서울·부산 외 | 0 | 0 |
| 서울 aptSeq non-null / unique | 6,843 / 6,843 | 6,843 / 6,843 |
| aptSeq 앞 5자리 ≠ sgg_cd | 0 | 0 |
| 서울 좌표 non-null(`exact`) | 6,726 | 6,726 |
| 서울 좌표 null(`failed`) | 117 | 117 |
| 서울 enrichment 필드 채워진 행 | 0 | 0 |
| 25개 구 행 수·좌표·null = 승인 dry-run | 전부 | 전부 일치(아래) |
| 전 행 read-back(6,843) vs 승인 dry-run | 차이 0 | 차이 0 · 승인 목록 밖 행 0 |

| 구 | 기대 | 실제 | 좌표 | null |
|---|---|---|---|---|
| 종로구 | 99 | 99 | 99 | 0 |
| 중구 | 107 | 107 | 106 | 1 |
| 용산구 | 183 | 183 | 179 | 4 |
| 성동구 | 159 | 159 | 157 | 2 |
| 광진구 | 208 | 208 | 203 | 5 |
| 동대문구 | 274 | 274 | 271 | 3 |
| 중랑구 | 234 | 234 | 222 | 12 |
| 성북구 | 176 | 176 | 174 | 2 |
| 강북구 | 116 | 116 | 113 | 3 |
| 도봉구 | 179 | 179 | 178 | 1 |
| 노원구 | 289 | 289 | 287 | 2 |
| 은평구 | 404 | 404 | 403 | 1 |
| 서대문구 | 235 | 235 | 230 | 5 |
| 마포구 | 288 | 288 | 281 | 7 |
| 양천구 | 378 | 378 | 376 | 2 |
| 강서구 | 519 | 519 | 511 | 8 |
| 구로구 | 376 | 376 | 374 | 2 |
| 금천구 | 125 | 125 | 124 | 1 |
| 영등포구 | 255 | 255 | 250 | 5 |
| 동작구 | 209 | 209 | 202 | 7 |
| 관악구 | 238 | 238 | 234 | 4 |
| 서초구 | 503 | 503 | 493 | 10 |
| 강남구 | 472 | 472 | 455 | 17 |
| 송파구 | 369 | 369 | 366 | 3 |
| 강동구 | 448 | 448 | 438 | 10 |

### 좌표 null 117 분류

| 원인 | 수 |
|---|---|
| 역방향 필지 불일치(REVERSE_MISMATCH) | 113 |
| Kakao 지번 결과 없음(FORWARD_NO_MATCH: 행당동 128, 자양동 863) | 2 |
| 블록형 지번(가-238, BL-3-1) | 2 |
| 기타 | 0 |

### 집중 확인 구(전 행 비교)

| 구 | 비교 행 | 차이 | VERIFIED | null(역방향 불일치 + 기타) |
|---|---|---|---|---|
| 강남구 | 472 | 0 | 455 | 17 (17 + 0) |
| 노원구 | 289 | 0 | 287 | 2 (2 + 0) |
| 강동구 | 448 | 0 | 438 | 10 (9 + 블록 지번 1) |
| 송파구 | 369 | 0 | 366 | 3 (3 + 0) |
| 중랑구 | 234 | 0 | 222 | 12 (12 + 0) |

## 6. 부산 격리

| 항목 | 전 | 후(매 구 + 최종) |
|---|---|---|
| 부산 master | 3,438 | 3,438 |
| fingerprint | `98dd4a454ff92ac91bd1625a6407e37e` | 동일 |
| 최종 updated_at | 2026-09-11T11:51:36.073Z | 동일 |
| 좌표 null | 37 | 37 |

부산 INSERT 0 · UPDATE 0 · DELETE 0.

## 7. Rollback artifact

`tmp/seoul-master-seed-run/applied-*.json` 25개(중구 1 + 이번 24, 사본 `remaining-24/`): 행 6,843(이번 6,736) · id 고유 6,843 · DB 서울 id 전부 포함. 각 행 `{id, aptSeq, sggCd, createdAt}` + 실행하지 않은 삭제 템플릿(id 목록 + `sgg_cd LIKE '11%'` + batch 시각). 구별 로그 `remaining-24/district-log.json`, 최종 감사 `remaining-24/final-audit.json`.

## 8. 기존 서울 매매 46행

master와 aptSeq로 대조(MASTER → 거래 방향, 읽기만): **46/46 EXACT**(구·법정동·지번·정규화 이름 일치). 매핑 변경 없음.

## 9. 공개 상태

`src/` · `vercel.json` · `prisma/schema.prisma` 변경 0. `enablement.ts`의 `'11'`은 주석(미출시) 그대로 → stats/cronSync/seoIndex/sitemap/report/학군 점수 모두 닫힘. Production: `/api/stats/dashboard?sidoCode=11`·`?lawdCd=11680` → `UNSUPPORTED_REGION` · sitemap 139 URL, 서울 0.

## 10. 최종 확인

Production INSERT 6,736(누적 서울 6,843) · UPDATE 0 · DELETE 0 · schema 0 · migration 0 · enrichment 0 · stats/cronSync/SEO enable 0.

## 11. 남은 한계 · 다음

- 서울 master는 identity + 좌표만 있다: 세대수·동수·주차·용적률·도로명주소 없음(건축물대장 enrichment 별도 STEP, `backfill-apartment-master-basic-data.ts`는 부산 하드코딩이라 지역 인자화 필요).
- 좌표 null 117 — enrichment 단계에서 건축물대장 주소 등으로 재시도 가능(seed 스크립트는 update 경로 없음).
- Tier B 2,244(전월세 전용)·REVIEW 18 미적재.
- 서울 매매·전월세 적재, 커버리지 셀, cron 회전, 취소 결함 A, 점수 보정 전에는 공개하지 않는다(`SEOUL_MASTER_SEED_PLAN_V1.md` §16).
- 다음 지시 전까지 sale/rent backfill·공개 작업을 시작하지 않는다.
