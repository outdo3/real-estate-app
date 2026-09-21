# E-JIP SEOUL SALE PHASE A FULL-HISTORY APPLY V1

서울 중구(`11140`) 전체 이력 Production apply 시도. 사용자 승인 하에 진행했으나
**§1 quota precheck에서 정지**했다.

- 시각: 2026-09-21 11:28~11:32 KST · 기준 커밋 `9891e2f`
- **Production INSERT 0 · UPDATE 0 · DELETE 0** · 서울 apply 0 · env 0 · schema 0 · runtime `src/` 변경 0

## 판정

**QUOTA_BLOCKED — write 전 정지.**

MOLIT quota 잔여가 예약분(2,000) 위로 **324**밖에 없는데, 수집에 **255 call**이 필요하다.
실측 외부 소비가 **분당 14~23 call(최대 2분간 46 burst)** 이라 수집 중 예약분을 깨고
**STOP_RESERVE로 중도 정지할 현실적 위험**이 있다.

§1이 지시한 대로 **범위를 줄이거나 cell을 건너뛰지 않고** 정지했다.

데이터 준비 상태 자체는 문제없다 — 직전 dry-run(`SEOUL_SALE_PHASE_A_FULL_DRYRUN_V1`)이
모든 게이트를 통과했고, 이번에 막은 것은 **오직 quota 안전 마진**이다.

---

## 0. Safe start

`main` · HEAD `9891e2f` · origin 동기 · 기존 modified/untracked user work 전부 보존. reset·stash·clean 0.

## 1. Quota precheck — **정지 사유**

driver의 `x-ratelimit-remaining` 실측(1-cell dry-run, 호출 1회씩):

| # | 시각(UTC) | remaining | 직전 대비 | 내 호출 | 외부 소비 |
|---|---|---|---|---|---|
| 0 | 02:11:57 | 2,666 | — | (full dry-run 255) | — |
| 1 | 02:28:27 | **2,372** | −294 | 1 | **293** / 16.5분 ≈ 18/분 |
| 2 | 02:29:45 | **2,371** | −1 | 1 | **0** / 1.3분 |
| 3 | 02:31:43 | **2,324** | −47 | 1 | **46** / 2.0분 ≈ **23/분** |

**외부 소비는 꾸준하지 않고 burst다** — 78초 동안 0, 바로 다음 118초 동안 46.
20분 평균은 약 **17/분**.

### 예산 계산

| 항목 | 값 |
|---|---|
| 현재 remaining | **2,324** |
| 예약분(reserve) | 2,000 |
| **사용 가능 headroom** | **324** |
| 필요한 수집 호출 | **255** (255 cell × 1) |
| 수집 소요 시간 | 약 96초(직전 dry-run 실측 `ms.total` 96,019) |
| 그 96초 동안 예상 외부 소비 | 17/분 → **약 27** · burst 시 **40+** |
| 예상 잔여 | **2,032 ~ 2,042** |
| **예약분 대비 여유** | **약 32~42** |

**관측된 burst 하나(2분간 46)가 수집 중에 오면 예약분이 깨진다.**
그때 driver는 `STOP_RESERVE`로 멈추고 나머지 셀을 PENDING으로 남긴다 —
**부분 수집 상태가 되어 apply를 할 수 없고**, headroom만 소진된다.

32~42 call의 여유는 46 call burst에 대해 **충분한 안전 마진이 아니다.** → **STOP.**

### quota를 이유로 하지 않은 것

- 범위 축소 **안 함**(2005-07~2026-09 255셀 그대로)
- cell 건너뛰기 **안 함**
- reserve 낮추기(`--reserve-calls`) **안 함**
- 부분 apply **안 함**

## 2~7. 나머지 preflight — 수행하지 않음

§1에서 정지했으므로 fresh dry-run(§2)·master policy(§3)·reconciliation(§4)·delta(§5)·
write plan(§6)·cancellation(§7)은 **이번 회차에 실행하지 않았다**(각 255 call이 필요).

직전 STEP(`SEOUL_SALE_PHASE_A_FULL_DRYRUN_V1`, 11:10~11:16 KST, 약 20분 전)의 측정이 그대로 유효하며,
그 값들은 전부 성공 조건을 만족했다:

| 항목 | 값 |
|---|---|
| cells | 255 / **255 COMPLETE** · PARTIAL 0 · FAILED 0 |
| fresh source **N** | **17,823** (active 17,486 · canceled 337) |
| master exact | **17,276** · **MASTER_MISSING 547**(38 aptSeq, transaction-only 승인됨) |
| invalid · review | **0 · 0** |
| existing **E** | **943** exact · DB-only **0** · field/status mismatch **0 / 0** |
| planned inserts **I** | **16,880** · planned updates **0** · deletes **0** |
| collision · expectedSkips **S** | **0 / 0 · 0** |
| **expected actual inserts (I−S)** | **16,880** |
| 관계 | **N = E + source-only → 17,823 = 943 + 16,880 ✓** |
| 취소 이상 | all-canceled 0 · false-cancel 0 · overcancel 0 · sibling mismatch 0 |

**단, 이 숫자는 apply 직전에 반드시 재측정해야 한다**(원천이 최근 며칠 새 1행씩 움직였다).

## 8. Hard stop conditions

발동: **`quota unsafe`**. 나머지 조건은 판정 대상에 오르지 않았다(수집 미실행).

`MASTER_MISSING 547`은 §8 명시대로 **STOP 사유가 아니다** — transaction-only 정책으로 승인됨.

## 9~17. Apply 이후 항목 — 해당 없음

apply를 하지 않았으므로 §9~§15는 해당 없음.

| 항목 | 상태 |
|---|---|
| **서울 enablement**(§16) | **변경 0** — `enablement.ts`에 `'11'` 없음(app/report/stats/sitemap/seoIndex/cronSync 전 축 false) |
| **env cleanup**(§17) | `ALLOW_PROD_DB_WRITE` · `DEFECT_A_GATE_PASS` · `APPROVE_CANCEL_RATCHET_REPAIR` · `SALE_CANCEL_RESTORE_ENABLED` **전부 NOT SET / 선언 없음**. write gate는 **한 번도 부여하지 않았다** |

## No-write assertion

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| 이번 STEP 중 생성된 행 · 갱신된 행 | **0 · 0** (`created/updated since 02:30:15Z` 모두 `[]`) |
| 전체 / active / canceled | 866,366 / 849,994 / 16,372 — **STEP 시작과 동일** |
| 중구 | **943** (888 / 55) · master exact 943/943 — 불변 |
| 서울 989 · 강남 46 · 부산 865,291 · 대구 86 | **전부 불변** |
| known Defect-A 28 | restored **28** 유지 (`newest_update` 2026-09-21T01:34:01Z 불변) |
| source-withdrawal 4건 | **untouched** |
| MOLIT 호출 | **3** (quota 측정용 1-cell dry-run 3회) |

driver는 3회 모두 `writes {insert: 0, update: 0, delete: 0}`을 보고했다.

## 발견 — 다음 시도의 호출량을 **절반으로** 줄일 수 있다

driver는 `--out` 디렉터리의 `checkpoints/`를 재사용한다. 수집 루프는 dry-run과 apply가
**공유**하며(`runBackfill` 1) 셀별 수집 — "dry-run은 항상"), 이미 수집된 셀은 다시 부르지 않는다.
`backfill-seoul-sale.test.ts` 15번이 이를 명시적으로 보장한다:

```
test('15 · checkpoint 재개 — 수집한 셀은 다시 부르지 않고 같은 결과')
  assert.equal(log.length, 0);            // fetch 0회
  assert.equal(r2.summary.calls, 0);      // 호출 0
  assert.deepEqual(r2.summary.plan, r1.summary.plan);
```

따라서 **같은 `--out`으로** dry-run → apply를 이어서 하면:

| 단계 | 호출 |
|---|---|
| fresh dry-run (`--out=DIR`) | **255** |
| apply (`--out=DIR` 동일) | **0** (checkpoint 재사용) |
| **합계** | **255** (기존 예상 510의 절반) |

부수 효과로 **dry-run과 apply 사이에 원천이 바뀔 위험이 사라진다** — 검증한 계획이 그대로 쓰인다.
quota 창이 넉넉하면 굳이 이 방식을 쓸 필요는 없지만, 마진이 빠듯할 때 유효한 선택지다.

(이 재개 방식은 계획 문서 §14가 이미 채택한 관행이다 — *"MOLIT quota 예약분(2,000)을 지키느라
다음 quota 창에서 checkpoint로 이어 받는다"*. cell 건너뛰기가 아니다.)

## 남은 blocker

**MOLIT quota 하나뿐이다.** 데이터·정책·게이트는 전부 준비됐다.

- 한도 **10,000/창**(endpoint별), **Production 라이브 조회·부산 cron과 공유**
- 현재 잔여 **2,324**, 예약분 2,000 → 사용 가능 **324**
- 필요 **255**(checkpoint 방식) 또는 **510**(일반 방식)

## 다음 권고

1. **quota 창이 회복된 뒤 재시도한다.** 안전 기준: **remaining ≥ 2,600**(= 255 + 예약 2,000 + burst 마진 350).
   일반 방식(510)으로 하려면 **≥ 2,900**. 창이 새로 열리면(10,000) 어느 쪽이든 여유롭다.
2. **재시도 절차는 이번과 동일하다** — ① quota 확인 → ② 같은 `--out`으로 fresh dry-run →
   ③ 전 셀 READY 확인 후 그 run의 `expectedActualInserts`를 `--expect-inserts`에 넣어 apply.
   **숫자를 고정하지 말 것**(원천이 움직인다). driver가 불일치를 스스로 거부한다.
3. **부산 cron 시간대를 피한다** — 04:00 / 06:00 / 08:00 KST에 각각 sale·rent·recheck가
   같은 quota를 쓴다. 그 직후는 잔여가 가장 낮다.
4. **apply 후 검증은 준비돼 있다** — `scripts/audit-junggu-pilot-apply-verify.ts`가 전/후 스냅샷과
   원천↔DB 전수 parity를 낸다. 중구 기대값 **943 + 16,880 = 17,823행**.
   전수 parity는 apply run의 `ready-inserts.json`을 쓰면 **추가 MOLIT 호출 0**으로 가능하다.
5. **서울 노출은 계속 닫아 둔다.** Phase B(종로·용산)·Phase C는 범위 밖이다.

## 기준선 (이번 STEP 전후 동일)

| 지표 | 값 |
|---|---|
| 전체 sale 행 | 866,366 (active 849,994 · canceled 16,372) |
| 서울 989 = 중구 **943** + 강남 46 | 불변 |
| 부산 865,291 · 대구 86 | 불변 |
| all-canceled · suspect · multi-sibling | 245 · 304 · 13,110 |
| 자연키 중복(전역 / 중구) | 0 / 0 |
| known 28 | restored 28 |
