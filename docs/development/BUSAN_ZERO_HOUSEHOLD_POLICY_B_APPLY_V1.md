# E-JIP BUSAN ZERO-HOUSEHOLD POLICY B APPLY V1

POLICY B로 확정된 부산 master 37개의 세대수와, 그에 딸린 파생 주차비율 34건을 보정한다.

- 날짜: 2026-09-20 (KST) · 기준 커밋 `7e43b10`
- **승인된 Production UPDATE**: `total_households` **37** · `parking_per_household` **34**
- **`parking_count` 변경 0** · FAR · BCR · buildingCount · approvalDate · roadAddress · 좌표 · identity · 캐시 · 서울 · sale · cancellation · schema 전부 불변

## 판정

**PASS** — 승인 집합을 Production에서 전수 재생성해 37 / 34를 정확히 재현했고, 계획한 행만 계획한 값으로 바뀌었다. 세대당 주차 이상치 **30 → 2**.

---

## 1. 승인 범위와 실제 write

| 필드 | 승인 | 실제 |
|---|---|---|
| `total_households` | 37 | **37** |
| `parking_per_household` | 34 | **34** |
| `parking_count` | **0** | **0** |
| 그 밖 모든 필드 | 0 | **0** |

파생비율이 비어 있던 3건은 **채우지 않았다** — null 채우기는 보정이 아니라 새 범위다.

## 2. 대상 재생성 — 감사 artifact를 쓰지 않았다

부산 `BUILDINGHUB_TITLE` / `GENERAL_TITLE` master **2,714건 전수**를 현재 Production에서 다시 읽고, safe pager로 대장을 다시 조회해 POLICY B 판정을 처음부터 다시 만들었다.

**1차 실행은 STOP됐다 — 그리고 그게 맞았다.**

| | 1차 | 재조회 후 |
|---|---|---|
| AUTO_SAFE_NEW | 37 | **37** |
| 파생비율 대상 | 34 | **34** |
| rate limit | 347 | 9 |
| **미해결 조회 실패** | **18** | **0** |

1차에서 수치는 이미 37 / 34로 맞았지만 **18개 필지를 읽지 못한 상태였다.** 수가 맞는다는 것은 완전성의 증거가 아니다 — 못 읽은 18건 중에 38번째 대상이 있었을 수도 있다. 앞 STEP에서 신설한 STOP 조건("미해결 조회 실패가 1건이라도 있으면 중단")이 정확히 여기서 걸렸다. 18건만 더 긴 간격으로 재조회해 **조회 실패 0**을 만든 뒤, 새로 추가된 대상이 없음을 확인하고 37 / 34를 확정했다.

## 3. 제외 확인

| 대상 | 결과 |
|---|---|
| 한보장산 `26350-52` | **제외됨** — 부속건축물인데 호수 1 신고(근거 상충). 대상 집합에 없고 STOP 규칙이 한 번 더 확인 |
| roadAddress-only REVIEW 19 | 건드리지 않음 |
| UNKNOWN 724 | 건드리지 않음 |
| 기존 AUTO 42 · ALREADY_OK 132 | 건드리지 않음 |
| 부산 외 aptSeq · 중복 aptSeq | 0 · 0 |

## 4~5. 대상 수

- households: **37**
- parking_per_household: **34** (37 중 기존 값이 있고 `parking_count`도 있는 행)
- 파생비율 null 유지: 3

## 6. 쓰기 전 필드 잠금

37건 전부에 대해 old/new 세대수, `parking_count`, old/new 파생비율을 확보하고, 승인 밖 필드(FAR · BCR · buildingCount · approvalDate · roadAddress)는 스냅샷만 남겼다. `parking_count`는 **읽기 전용 증거**로만 쓰였다 — UPDATE의 `SET` 절에 등장하지 않고 `WHERE` 조건에만 등장한다.

severe 4건 기대값 사전 대조 — **4 / 4 일치**(하나라도 다르면 STOP):

| 단지 | 기대 | 실측 |
|---|---|---|
| 엘지 | 48 → 1,848 · 주차 1,984 | 일치 · 비율 **1.07** |
| 대림2 | 42 → 682 · 주차 708 | 일치 · 비율 **1.04** |
| 대림 | 104 → 1,424 · 주차 1,541 | 일치 · 비율 **1.08** |
| 삼호가든맨션 | 90 → 1,076 · 주차 743 | 일치 · 비율 **0.69** |

## 7. Rollback artifact

쓰기 **전** 생성(`tmp/zero-household-apply/rollback-2026-09-20T13-27-11-692Z.json`). 37행의 aptSeq · 단지명 · old/new 세대수 · `parking_count` · old/new 파생비율 · 공식 근거 · 분류 사유 + 되돌림 SQL. **실행하지 않았다.**

## 8~11. 쓰기 결과와 사후 검증

| 항목 | 결과 |
|---|---|
| households 변경 | **37 / 37** |
| parking_per_household 변경 | **34 / 34** |
| **parking_count 변경** | **0** |
| 예상과 다른 값 | **0** |
| **승인 밖 필드 drift** | **0** |
| 한보장산 건드림 | **false** |
| 214건 전체 파생 불변식 위반 | **0** |
| optimistic guard 불일치 | **0** |

행마다 `apt_seq` + 기대 old 값이 일치할 때만 UPDATE했고, 파생비율은 `parking_count`와 옛 비율이 **둘 다** 맞을 때만 썼다. 단일 트랜잭션.

## 12. 이상치 before/after (영향 214 전체, Production 재계산)

| 임계 | 보정 전 | 보정 후 | 기대 |
|---|---|---|---|
| > 2.0 | 30 | **2** | 2 ✓ |
| > 5.0 | 22 | **0** | 0 ✓ |
| > 10.0 | 13 | **0** | 0 ✓ |

남은 2건은 이번 정책의 대상이 아니었다:

| aptSeq | 단지 | 비율 |
|---|---|---|
| `26140-106` | 송도탑스빌 | 3.02 |
| `26410-289` | 구서쌍용스윗닷홈 | 2.04 |

## 13~16. severe Production QA

| 단지 | 화면 |
|---|---|
| **엘지** | **1,848세대** · 세대당 **1.07대 (총 1,984대)** · 263.3% · 2003년 |
| **대림2** | **682세대** · 세대당 **1.04대 (총 708대)** · 14.5% · 1997년 |
| **대림** | **1,424세대** · 세대당 **1.08대 (총 1,541대)** · 24.9% · 1993년 |
| **삼호가든맨션** | **1,076세대** · 세대당 **0.69대 (총 743대)** · 1986년 |

주차 **총량(1,984 · 708 · 1,541 · 743)은 전부 보정 전과 같다** — `parking_count`를 건드리지 않았다는 것이 화면에서도 확인된다. 단지 identity도 불변.

삼호가든맨션은 세대수만 확정됐고 **주차는 여전히 UNRESOLVED**다(13동 743 + 1동 473). 그 값은 그대로 두었다.

## 17. 캐시 선점

| 항목 | 값 |
|---|---|
| 보정 37건에 붙은 `apartments` 캐시 행 | **0** |
| tier1 게이트 충족 | **0** |
| 가려진 보정값 | **0** |

애초에 캐시 행이 없고, 있더라도 `HOUSEHOLDS_SOURCE_PRECEDENCE_HARDENING_V1` 배포 이후 세대수는 master가 이긴다.

## 18. 기능 QA

| 기능 | 결과 |
|---|---|
| 상세 info | 200 · 위 표대로 |
| **주차 Score(엘지)** | **74점** — 41.33대 시절에는 의미 없던 값이 1.07대 기준의 실제 점수가 됐다(총점 41) |
| large-complex · dashboard · rankings · supply · sitemap · transactions · school | 200 · **응답 바이트 수가 쓰기 전과 완전히 동일**(10,595 / 72,871 / 39,513 / 252,785 / 20,168 / 93 / 412) |

large-complex 진입 경계는 1,938세대이고 이번 최대 신규값이 엘지 1,848이라 **목록 구성은 바뀌지 않는다**.

## 19~20. 격리

| 항목 | 값 |
|---|---|
| 부산 master | **3,438** 불변 |
| 서울 master | **6,843** 불변 |
| 서울 좌표 보유 | **6,726** 불변 |
| 부산 UNKNOWN | **724** 불변 |
| 매매 총건 | **865,421** 불변 |
| 취소 | **16,345** 불변 |
| **all-canceled groups** | **273** 불변 |
| **suspect upper bound** | **334** 불변 |
| Seoul sale | **46** 불변 |
| 배포 이후 생성 행 · all-canceled 그룹 건드림 | 0 · 0 |

취소 수치는 `audit-cancel-cron-validation-v1.ts`의 자체 정의로 재측정했다.

## 21. No-unapproved-write assertion

| 항목 | 값 |
|---|---|
| 허용된 write | `total_households` 37 · `parking_per_household` 34 |
| `parking_count` · FAR · BCR · buildingCount · approvalDate · roadAddress | **0** |
| 캐시 · 좌표 · 서울 · sale · cancellation · schema | **0** |
| INSERT / DELETE | **0 / 0** |
| runtime `src/` 변경 | **0** |

## 22. 테스트

```
npx tsx --test scripts/ledger-zero-household-policy.test.mjs    19 pass / 0 fail
npx tsx --test "scripts/**/*.test.mjs" "scripts/**/*.test.ts"   576 pass / 0 fail
npx eslint (신규 2파일)                                          exit 0
npx tsc --noEmit    신규 파일 0 에러 (기존 scripts/tmp 건수 불변)
```

## 23~24. 커밋 / push

`7e43b10`(앞 STEP의 로컬 보류분)과 이번 커밋을 함께 push했다. docs/scripts만 포함, 사용자 작업 파일 제외.

## 25. Blockers

없음.

## 26. 다음 권고

1. **한보장산 `26350-52` 1건** — 사람 판단 대상. 부속건축물(경비실)로 신고됐는데 호수 1이 함께 적혀 있어 공식 근거가 상충한다.
2. **남은 이상치 2건** — 송도탑스빌 3.02 · 구서쌍용스윗닷홈 2.04. 이번 정책 대상이 아니었으므로 별도 확인이 필요하다.
3. **파생비율 null 12 + 3건** · **roadAddress-only REVIEW 19** · **UNKNOWN 724** · **서울 117 좌표** · **28행 false-cancel** · **서울 sale apply** — 전부 별도 승인 대기.
