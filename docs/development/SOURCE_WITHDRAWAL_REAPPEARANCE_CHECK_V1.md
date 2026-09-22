# E-JIP SOURCE WITHDRAWAL REAPPEARANCE CHECK V1

READ ONLY. MOLIT 2셀(각 1회 전 페이지) · SELECT만 · Production write 0 · 정책 구현 0.
원천 raw는 `tmp/withdrawal-reappearance-check/raw-*.json.gz`에 보존했다.

## 배경

`POST_CRON_CANCELLATION_JUNGGU_REVALIDATION_V2.md` §20이 부산 202609에서 **원천이 조용히 회수한 active 행 3건**
(940812, 950148, 950521)을 기록했고, `SIBLING_COUNT_MISMATCH_SINGLE_GROUP_AUDIT_V1.md`가 canceled 행 1건(636871)을 더해
withdrawal 목록은 4건이었다. 2026-09-22 04:59 KST sale-sync가 940812·950521(그리고 950148)에 registry_date를 보충했는데,
보충은 원천에 **같은 자연키 행이 있어야만** 생기므로 재등장 여부를 확인했다.

## 결과

| 항목 | 940812 | 950521 |
|---|---|---|
| 셀 | 26380:202609 (COMPLETE) | 26290:202609 (COMPLETE) |
| 단지 / aptSeq | 아람센트럴시티 `26380-1960` | 대연동동일스위트 `26290-102` |
| 거래 | 17,000 · 2026-09-01 · 7층 · 49.26㎡ | 8,000 · 2026-09-09 · 4층 · 31.8492㎡ |
| 원천 존재 | **있음** — 자연키 정확 일치 1건 | **있음** — 자연키 정확 일치 1건 |
| 원천 상태 | active · registry `26.09.11` | active · registry `26.09.18` |
| DB 상태 | active · registry `26.09.11` · updated 09-22 04:59:46 KST | active · registry `26.09.18` · updated 09-22 04:59:41 KST |
| 자연키 | `id:26380-1960::49.26::sale\|17000\|2026-09-01\|7\|0` | `id:26290-102::31.8492::sale\|8000\|2026-09-09\|4\|0` |
| 셀 parity | 원천 106 = DB 106 · DB-only 0 | 원천 139 = DB 139 · DB-only 0 |
| 다음 cron 계획(셀) | insert·flip·restore·supplement 0 | 0 |

**판정: 두 건 모두 REAPPEARED.** 940812 단지는 09-20 확인 때 "24,200 / 09-12 / 3층만" 있었지만 오늘은 그 건과 17,200 / 09-15 / 10층까지 3건을 보고한다.
950521 단지는 "이달 0건"이었지만 오늘 이 거래 1건을 보고한다.

## registry 보충 경로

`planSaleCellWrites`의 행 루프(`src/lib/sync/sale-sync-core.ts:462-485`): `existingMap.get(naturalKeyStr(row))`로 **원천 행과 자연키가 같은 DB 행**을 찾고,
`classifyRow`(`scripts/write-policy-logic.ts:51`)가 둘 다 비취소 + DB registry 비어 있음 + 원천 registry 있음이면 `updateRegistryOnly`,
형제 registry 모호성 검사 통과 후 `registrySupplements`에 들어간다. 원천이 행을 다시 보고했고 그 행에 이제 registry_date가 붙어 있었다 — 그것이 보충의 원인이다.

## 해석

두 건은 **영구 회수가 아니라 일시적 부재**였다. 신고 후 원천 응답에서 빠졌다가 등기(registry_date 09-11 / 09-18)가 붙은 뒤 다시 나타났다.
DB는 그 사이 행을 지우지 않았기 때문에(delete 경로 없음) 아무것도 잃지 않았다 — "withdrawal이면 즉시 지우자" 정책이 있었다면 두 거래를 잘못 삭제했을 것이다.

## withdrawal 목록 갱신

| id | 이전 | 지금 |
|---|---|---|
| 940812 | withdrawn(active) | **REAPPEARED** — 목록에서 제외 |
| 950521 | withdrawn(active) | **REAPPEARED** — 목록에서 제외 |
| 950148 | withdrawn(active) | **미확인** — 오늘 registry 보충을 받았으므로 재등장 가능성이 높다(26470:202609, 이번 2셀 범위 밖) |
| 636871 | withdrawn(canceled, SIBLING_COUNT_MISMATCH) | 변화 없음(이번 범위 밖) |

남은 목록: **2건**(950148 미확인, 636871).

## 다음

1. 950148 확인 — 26470:202609 1셀, 같은 probe로 read-only.
2. withdrawal 정책 결정 전 원칙: **관찰 1회로 withdrawn 판정하지 않는다.** 최소 두 번 이상의 cron 간격을 두고 연속 부재일 때만 후보로 올린다.
