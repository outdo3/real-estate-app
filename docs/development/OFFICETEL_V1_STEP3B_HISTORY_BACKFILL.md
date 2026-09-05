# OFFICETEL V1 STEP 3B — 실거래 이력 최초 Production 적재

- 상태: **완료**
- 선행: `OFFICETEL_V1_STEP3A_BACKFILL_DRYRUN.md` (READ ONLY 감사, Production write 0)
- Production write: **INSERT 314,965행** / UPDATE 0 / DELETE 0 / DDL·migration·index 0
- 실행: 로컬 CLI `scripts/officetel/step3b-history-backfill.ts --apply`
- 성격: **최초 backfill 1회 전용.** incremental sync / cron **미생성**

---

## 0. 사전 게이트

| 항목 | 값 | 판정 |
| --- | ---: | --- |
| `officetel_trade_histories` | 0행 | PASS (최초 적재 전제) |
| `officetel_rent_histories` | 0행 | PASS |
| `officetel_masters` | 5,056건 (주소 그룹 5,009) | PASS |
| STEP 3A 스윕 불완전 셀 | 0 | PASS |
| DB size (before) | **560.1 MB** = 8 GB의 6.84% | PASS |

---

## 1. 원천 아티팩트 — 왜 재호출하지 않았는가

STEP 3A §9는 "apply 시점에 MOLIT을 다시 부른다"고 설계했다. **이번 STEP은 그렇게 하지 않았고, 그 이유를 명시한다.**

STEP 3B 지시는 STEP 3A 검증 아티팩트를 쓰고 **감사 수치와 정확히 일치하지 않으면 write 전 STOP**할 것을 요구했다. 재호출은 진행 중인 202609와 지연 취소 때문에 314,965와 반드시 어긋나 그 게이트를 통과할 수 없다. 재현 가능성 측면에서도 고정된 NDJSON이 강하다.

**대가는 명확히 기록한다.** 적재된 취소 상태는 스윕 시각 스냅샷이다:

| dataset | NDJSON | 스윕 시각(= `sourceFetchedAt`) | 행 |
| --- | --- | --- | ---: |
| SALE | `step3a-sale-rows.ndjson` | 2026-09-05 02:07:02 KST | 88,674 |
| RENT | `step3a-rent-rows.ndjson` | 2026-09-05 02:28:38 KST | 226,291 |

`sourceFetchedAt`에 `now()`가 아니라 **스윕 파일 mtime**을 넣었다 — 방금 원천에서 확인한 것처럼 위장하지 않기 위해서다. 그 이후의 지연 취소는 반영돼 있지 않으며, 이는 STEP 3A가 이미 식별한 재확인 스윕(STEP 3C 후보)의 대상이다.

### write 전 총계 게이트 (dry-run으로 먼저 통과)

| | SALE | RENT |
| --- | ---: | ---: |
| 데이터 있는 셀 + 빈 셀 | 3,617 + 367 = **3,984** (감사 3,984) | 2,962 + 62 = **3,024** (감사 3,024) |
| 원천 행 vs 감사값 | 88,674 vs 88,674 → **차이 0** | 226,291 vs 226,291 → **차이 0** |
| PARTIAL / INVALID 셀 | 0 / 0 | 0 / 0 |
| canonicalKey 생성 실패 | 0 | 0 |

---

## 2. APPLY 결과

`--apply` 1회, 중단 없음.

| | SALE | RENT | 합계 |
| --- | ---: | ---: | ---: |
| 준비 | 88,674 | 226,291 | 314,965 |
| **INSERT** | **88,674** | **226,291** | **314,965** |
| 중복 skip | 0 | 0 | 0 |
| UPDATE | 0 | 0 | **0** |
| DELETE | 0 | 0 | **0** |
| 적재된 셀 | 3,617 | 2,962 | 6,579 |
| PARTIAL / INVALID / 미완료 셀 | 0 / 0 / 0 | 0 / 0 / 0 | **0** |

아키텍처: 셀(lawdCd×dealYmd) 단위 · 500행/트랜잭션 · manifest 체크포인트 · PARTIAL/INVALID 셀은 **쓰지 않음** · `createMany(skipDuplicates)` 멱등.

`occurrenceIndex`는 NDJSON 파일 순서(= 원천 응답 순서)로 `assignOccurrenceIndexes()`가 부여했고, 분포가 STEP 3A와 **완전히 동일**하다:

- SALE `0:81341 1:4996 2:1168 3:571 4:258 5:142 6:70 7:61 8:34 9:27 10:3 11:1 12:1 13:1`
- RENT `0:225051 1:1172 2:43 3:10 4:6 5:3 6:3 7:3`

---

## 3. MASTER LINKAGE (Production 실측)

연결 규칙은 STEP 3A 감사와 **동일**하다 — 거래 행의 building-level canonicalKey로 주소 그룹을 찾아 **master가 정확히 1건일 때만** 연결한다. 동(棟)을 추측해서 붙이지 않는다.

| | SALE (88,674) | RENT (226,291) |
| --- | ---: | ---: |
| canonicalKey 생성 | **88,674 (100.00%)** | **226,291 (100.00%)** |
| `officetelMasterId` 연결 | **86,306 (97.33%)** | **221,279 (97.79%)** |
| `officetelMasterId` NULL | 2,368 (2.67%) | 5,012 (2.21%) |
| └ UNRESOLVED_MULTI | 1,779 | 4,616 |
| └ MASTER_MISS | 589 | 396 |

전체 314,965행 중 linkable **307,585 (97.66%)** / unresolved 7,380 (2.34%) — STEP 3A 예측과 **정확히 일치**.

unresolved는 고치지 않았다. 원천이 동을 주지 않아 구조적으로 해소 불가능한 잔여분이다.

---

## 4. DATA QUALITY (Production 실측)

| 항목 | SALE | RENT |
| --- | ---: | ---: |
| 행 수 | **88,674** | **226,291** |
| `floor` NULL | 0 | 0 |
| 전용면적 결측/이상 | 0 | 0 |
| 금액 결측/이상 | 0 | 0 (보증금·월세 동시 0 = 0) |
| `dealDate` NULL | 0 | 0 |
| canonicalKey 결측/접두사 이상 | 0 / 0 | 0 / 0 |
| **자연키 중복** | **0** | **0** |
| 구 / 월 | 16 / 249 | 16 / 189 |
| 기간 | 2006-01-02 ~ 2026-09-02 | 2011-01-01 ~ 2026-09-03 |

SALE 취소: **2,354행**. `cancelDate` 없는 취소 0 · 비취소인데 `cancelDate` 있는 행 0 · `YY.MM.DD` 형식 위반 **0**.

RENT: 전세 66,518 (29.39%) / 월세 159,773 (70.61%). `useRenewalRight` **true 2,303 (1.02%) / false 0 / null 223,988 (98.98%)** — 원천에 "미사용" 값이 없으므로 `false`를 한 건도 만들지 않았다. `contractTerm` 127,138 (56.18%) · `contractType` 127,770 (56.46%) → 약 44% 결측, UI에서 "정보 없음"과 구분 필요.

---

## 5. IDENTICAL SIBLING — 병합하지 않음

`occurrenceIndex`를 제외한 모든 원천 필드가 동일한 행:

| | 묶음 | 관련 행 | 추가 행 | 최대 묶음 |
| --- | ---: | ---: | ---: | ---: |
| SALE | 4,433 | 11,069 | 6,636 (7.48%) | 11 |
| RENT | 948 | 1,953 | 1,005 (0.44%) | 8 |

STEP 3A 수치와 **완전히 동일**. 원천은 이 행들을 구분할 정보를 주지 않으므로 "중복 신고"인지 "같은 날 같은 조건의 별개 계약"인지 판별 불가하다. STEP 1 §8 계약대로 **병합·제거하지 않았다.** 평균가·중앙값 산식은 이 가중치 왜곡을 명시해야 한다.

---

## 6. CANCELLATION TRUST LIMITS (재확인)

| 구간 | 행 | 취소 | 취소율 |
| --- | ---: | ---: | ---: |
| **2006 ~ 2019 (14년)** | **57,555** | **0** | **0.00%** |
| 2020 | 6,993 | 589 | 8.42% |
| 2021 | 6,709 | 699 | 10.42% |
| 2022 | 4,482 | 278 | 6.20% |
| 2023 | 3,126 | 274 | 8.77% |
| 2024 | 3,215 | 146 | 4.54% |
| 2025 | 4,003 | 269 | 6.72% |
| 2026 | 2,591 | 99 | 3.82% |

**Production 적재 후에도 절벽이 그대로 확인된다.** 2019년 이전의 `dealCanceled=false`는 **검증된 참(true zero)이 아니라 원천 미제공**이다.

유지되는 제한:

- **officetel Record High(역대 최고가) — 구현 금지 유지.** 2020 이전 취소 미제공 + `rgstDate` 부재로 TYPE B 검증 불가.
- "전 기간 검증된 최고가" 류의 주장 금지.
- 장기 통계/연도별 시세 추이 = **LIMITED**, 구간 표기 필수.
- RENT는 원천에 취소 필드 자체가 없다 — 취소 개념을 노출하지 않는다.
- 지연 취소(12개월 초과 93건) 재확인 스윕은 **이 STEP에서 만들지 않았다** (STEP 3C 후보).

---

## 7. 알려진 master 모호성 — `26230 | 전포동 | 897-0`

Production master 3건이 같은 주소에 존재한다 (표시명 전부 "전포엘에이치"):

| id | canonicalKey |
| ---: | --- |
| 392 | `OFFI:26230:전포동:897-0:지하주차장2` |
| 393 | `OFFI:26230:전포동:897-0:기계,전기실` |
| 394 | `OFFI:26230:전포동:897-0:오피스텔동` |

건축물대장 표제부가 지하주차장·기계전기실을 별도 동으로 반환한 것을 STEP 2.1이 master로 적재했다.

**이 STEP은 history 적재 전용이므로 master를 수정/삭제하지 않았다** (별도 승인 필요).

영향 정량화 — 이 모호성 때문에 unresolved로 남은 행:

| | 행 | 정리 시 linkage |
| --- | ---: | --- |
| SALE | **18** | 97.33% → 97.35% (+0.02pp) |
| RENT | **79** | 97.79% → 97.82% (+0.03pp) |
| 합계 | **97** | 307,585 → 307,682 |

즉 실제 이득은 97행으로 작다. 나머지 UNRESOLVED_MULTI(6,298행)는 한 지번에 동이 여러 개인 **실제 건물**이라 정리 대상이 아니다.

---

## 8. STORAGE / CAPACITY (실측)

| | before | after | 증가 |
| --- | ---: | ---: | ---: |
| **DB 전체** | **560.1 MB** | **702.0 MB** | **+141.9 MB** |
| 8 GB 사용률 | 6.84% | **8.57%** | +1.73pp |

| 테이블 | total | heap | index | rows |
| --- | ---: | ---: | ---: | ---: |
| `apartment_trade_histories` | 472.0 MB | 223.0 | 249.0 | 864,201 |
| **`officetel_rent_histories`** | **104.1 MB** | 48.9 | 55.2 | 226,291 |
| `apartment_rent_histories` | 62.5 MB | 31.3 | 31.2 | 125,545 |
| **`officetel_trade_histories`** | **37.7 MB** | 18.8 | 18.9 | 88,674 |
| `officetel_masters` | 2.9 MB | 1.9 | 1.0 | 5,056 |

**STEP 3A 예측 검증**: 추가 128~146 MB / 적재 후 688~707 MB / 8.4~8.6%
**실측**: 추가 **141.9 MB** / **702.0 MB** / **8.57%** → **전부 예측 범위 안**.

인덱스가 heap보다 크다는 예측(오피스텔 `canonicalKey`가 길어 자연키 UNIQUE 인덱스 비용이 큼)도 실측으로 확인됐다 — RENT 55.2 vs 48.9 MB, SALE 18.9 vs 18.8 MB.

잔여 약 7.3 GB.

---

## 9. 무관 테이블 영향

| 테이블 | 적재 후 | 판정 |
| --- | ---: | --- |
| `apartment_trade_histories` | 864,201 | 변화 없음 |
| `apartment_rent_histories` | 125,545 | 변화 없음 |
| `officetel_masters` | 5,056 | 변화 없음 |

schema / migration / index / cron / UI 변경 **0**.

---

## 10. 검증

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | **24 errors — 전부 기존 스크립트**(`FAIL_EXISTING_SCRIPT_ERRORS`, STEP 3A와 동일 baseline). STEP 3B 신규 **0건** |
| officetel identity/normalize 테스트 | **39/39 PASS** |
| dry-run vs apply 대조 | 준비 행 수·linkage·occurrence 분포 전부 일치 |
| NDJSON oracle 대조 | 셀별 행 수 차이 0 |
| 자연키 중복 | 0 / 0 |
| 미완료 셀 | **0** |
| 배포 | **불필요** — 런타임 코드 무변경(CLI 스크립트 + 문서만) |

---

## 11. 알려진 문제 / 다음 STEP

1. **incremental re-sync 없음** — 이 STEP은 최초 backfill 전용이다. 오피스텔 `assignOccurrenceIndexes()`는 **도착 순서** 기반이라, 같은 셀을 두 번째로 동기화하면 `RENT_OCCURRENCE_SAFETY_V1`에서 아파트 RENT에 실제로 발생한 슬롯 밀림 오염이 재현될 수 있다. **occurrence 계약이 굳어지기 전에는 어떤 오피스텔 셀도 재동기화하지 않는다.**
2. 지연 취소(12개월 초과 93건) 재확인 스윕 미구현 — STEP 3C 후보.
3. `26230|전포동|897-0` master 3건 정리 시 97행이 linkable로 전환(별도 승인 필요).
4. master 좌표 0.00% — 오피스텔 Map/거리 기반 기능의 선행 조건.
5. master 표시명 공백 390건(7.71%).
6. BLOCKED 유지: Record High / E-JIP Score / Finance / Map 레이어 / 공급면적·평형 표기.
