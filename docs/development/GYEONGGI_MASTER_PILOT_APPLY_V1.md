# E-JIP GYEONGGI MASTER PILOT APPLY V1

41115 수원 팔달구 `ApartmentMaster` **116행 Production 적재**(사용자 승인, 2026-09-25 KST). 경기 공개는 계속 닫힘.

- 기준 코드 `fbb6585` · 실행기 `scripts/national-backfill/gyeonggi-master-seed.ts --apply`
- runId **`gg-master-41115-2026-09-25T05-17-45-769Z-91ac48`**
- 적용 기록(로컬, 커밋 안 함): `tmp/gyeonggi-master-seed/applied/<runId>.json` · `.intent.json` · `.verify.json`

## 1. 사전 확인

- git HEAD = origin/main = `fbb6585`, 다른 seed/backfill 프로세스 0, checkpoint(41115)·raw 캐시 존재.
- preflight(READ ONLY): 후보 116 · READY 116 · GEOCODE_MISSING/REVIEW/UNRESOLVED/SKIP_EXISTING 0 · insert 116 · 좌표 116/116 · plan hash `96c97397b1d879c3a3126833b27e6f4262fd2acc5b0546038922776acb075feb` · 게이트 allowed · 가드 true · 기존 경기 master 0 · Kakao 0.
- 적용 전 스냅샷: 서울 6,843(fp `f9c3e3fa…`) · 부산 3,438(fp `4b06d745…`) · 경기 0 · max id 12269.

## 2. 적용 (1회 실행)

```
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/national-backfill/gyeonggi-master-seed.ts --apply --district=41115 --expect-inserts=116 --expect-plan-hash=96c97397b1d879c3a3126833b27e6f4262fd2acc5b0546038922776acb075feb --live
```

insert **116** · update 0 · delete 0 · 실패 0 · exit 0. id 12270–12385, DB created_at 2026-09-25T05:17:46.063Z ~ 05:17:49.373Z. 자동 verify 12/12 PASS.

## 3. 독립 검증 (별도 READ ONLY 스크립트)

| 항목 | 결과 |
|---|---|
| 경기 master | 0 → **116**(전부 41115), 41135 0, 다른 경기 구 0 |
| 부산 / 서울 | 3,438 / 6,843 — **fingerprint 적용 전과 동일**, last updated 불변 |
| 계획 대비 parity | missing 0 · extra 0 · 필드 불일치 0(aptSeq·name·normalizedName·sido·sigungu·sggCd·umdName·umdCd·jibun·buildYear·lat·lng·geocodeQuality) · enrichment 필드 전부 null · basicSpecSource UNKNOWN → **MASTER_PARITY_EXACT** |
| aptSeq 중복 | 0 |
| 거래 연결 | linked 116 · orphan 0 · 다른 구 거래 연결 0 |
| 좌표 | 116/116, 0/0 없음, lat 37.258–37.291 · lng 126.981–127.043(팔달구 범위), 같은 좌표 2그룹(화서주공 4/5단지 화서동 650, 우만주공 1/2단지 우만동 28 — 같은 필지, aptSeq 별도 행), 다른 필지 같은 좌표 0 |

## 4. 공개 노출 (운영 GET)

- 검색 화서주공4단지·월드메르디앙·우만주공1단지·화서·팔달 → 경기 결과 0
- 지도 `/api/transactions?lawdCd=41115`(전체·marker) → 0, `regionUnsupported`
- 상세·점수·정보·교육·검증 API(41115-20, 41115-60) → 전부 `UNSUPPORTED_REGION`/`regionUnsupported`
- `/apt/…?lawdCd=41115`, `/report/apt/41115-*` → 일반 제목, noindex·nofollow, canonical 없음, 단지명 노출 없음
- `/report/compare`, `/stats/compare`(부산 vs 41115) → noindex, 단지명 노출 없음
- `/api/stats/*?lawdCd=41115`, `large-complex?sidoCode=41` → `UNSUPPORTED_REGION`
- sitemap 140 · 경기 0 · `computePublicExposureGuarded` = `{ guarded: true, openAxes: [] }` · 선택기 경기 숨김(정책)

## 5. 부산·서울 회귀

적용 전/후 같은 스크립트(검색 6 · 마커 8구 · 상세 5 · 페이지 11 · sitemap) 출력 **완전히 동일**. 부산 마커 275/236 · 서울 8구 241/87 · 차단 서울 0 · 부산 리포트 canonical 유지 · 부산 stats(rankings·large-complex) 정상.

## 6. 일일 리포트 영향 — NO_IMPACT

`detectBackfill`은 `apartment_trade_histories`의 그날 신규 행만 보고, master 조회는 부산 행 보강 전용이다. `/report/daily/2026-09-25`(이미 거래 적재로 WITHHELD)·`2026-09-24` 화면 텍스트가 적용 전후 동일.

## 7. Rollback 준비 (실행 안 함)

적용 기록: runId · id 116개 · aptSeq · 구 41115 · created_at 최소/최대 · 행별 updatedAt. rollback 게이트를 **평가만** 해 보면 allowed(id 116 전부 기록과 일치) — 실행 시 정확히 이 116행만 지운다.

```
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/national-backfill/gyeonggi-master-seed.ts --rollback=tmp/gyeonggi-master-seed/applied/gg-master-41115-2026-09-25T05-17-45-769Z-91ac48.json --run-id=gg-master-41115-2026-09-25T05-17-45-769Z-91ac48 --expect-deletes=116   # NOT EXECUTED
```

## 8. 다음

GYEONGGI_MASTER_FULL_BATCH_POLICY — 나머지 7구(1,077행: 좌표 1,058 + null 19) 적재 범위와 null 좌표 정책 결정. apply 범위 확장은 `GG_APPLY_ALLOWED_DISTRICTS` 코드 변경이 필요하다.
