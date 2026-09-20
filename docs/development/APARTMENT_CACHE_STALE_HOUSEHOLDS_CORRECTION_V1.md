# E-JIP APARTMENT CACHE STALE HOUSEHOLDS CORRECTION V1

master는 보정됐지만 tier1 `apartments` 캐시가 옛 세대수를 계속 노출하던 2개 단지를 정리한다.

- 날짜: 2026-09-20 (KST) · 기준 커밋 `fc0cfd7`
- **승인된 Production UPDATE**: `apartments` **정확히 2행**의 `total_households`
- master 0 · INSERT 0 · DELETE 0 · 다른 캐시 행 0 · 다른 캐시 컬럼 0 · schema 0 · runtime `src/` 0 · 서울 0 · cancellation 0 · sale apply 0

## 판정

**PASS** — 2행만 바뀌었고, 두 단지 모두 Production 화면에서 정상 세대수로 확인된다.

---

## 1. 대상 확인

승인 시점 값과 현재 Production 값이 정확히 일치했다(하나라도 다르면 STOP하도록 구현):

| aptSeq | 캐시 행 | 캐시 세대수 | master 세대수 |
|---|---|---|---|
| `26350-2` | id **399** · 해운대경동제이드 · 우동 974 | **72** | **892** |
| `26350-278` | id **255** · 우성빌라(백세해운대빌라2차) · 중동 1505-3 | **4** | **15** |

대상 지번의 캐시 행은 각각 1개뿐이고(중복 없음), 두 행 모두 연결된 Unit Master는 0건이다.

> 캐시 행의 이름이 master 이름과 다르다(`해운대경동제이드` vs `경동`). tier1 조회가 `dong + jibun`으로도 찾기 때문에(`byJibun`, 이름 제약 없음) 이름이 달라도 같은 필지의 행이 읽힌다. 그래서 이름이 아니라 **지번으로** 대상을 특정했다.

## 2. 우선순위 재확인 — 왜 가려졌나

```
tier1  apartments 캐시   ← parkingCount && far && bcr && approvalDate 가 전부 있으면 즉시 채택
  ↓
tier2  apartment_masters ← 빈 필드만 보충
  ↓
tier3  live 건축물대장   ← 빈 필드만 보충 + 캐시에 upsert
```

핵심은 **`totalHouseholds`가 tier1 게이트에 들어 있지 않다**는 점이다. 게이트는 네 필드(`parkingCount`·`far`·`bcr`·`approvalDate`)만 보고, 세대수는 `cached.totalHouseholds ?? null`로 **그냥 딸려 나온다**. 두 캐시 행은 네 필드가 모두 채워져 있어 세대수가 낡았는데도 tier1을 통과했고, 그 뒤 `isFullyPopulated`가 세대수까지 truthy로 보면서 tier2(master)가 아예 실행되지 않았다.

즉 master를 아무리 정확히 고쳐도 이 두 행은 화면에 도달하지 못하는 구조였다. 코드는 바꾸지 않았다.

## 3. UPDATE vs INVALIDATE — 선택과 근거

세 가지를 실측으로 비교했다. 결정적인 사실: **master의 `use_approval_date`가 두 건 모두 NULL**이다. 화면의 `1995년` / `1994년`은 master가 아니라 **캐시**가 주고 있었다.

| 방식 | 결과 | 판정 |
|---|---|---|
| **A. 세대수만 exact update** | tier1이 계속 채택 → 새 세대수 + 캐시의 parking/far/bcr/승인일 그대로 | **채택** |
| B. 세대수만 NULL로 무효화 | tier1이 세대수 null → tier2 master가 892/15 보충, 나머지는 캐시 값 유지 → 화면 동일 | 표시 결과는 같으나 승인 값(892/15)과 다름 |
| C. 캐시 행 삭제 | parking/far/bcr/**승인일**을 전부 잃는다. master에 승인일이 없고 live는 이 다건 필지에 null을 주므로 **사용승인일이 사라진다** | **기각 — 데이터 손실** |

C는 "전체 cache 삭제 금지" 이전에 **이 2행 삭제만으로도 실제 손실**이 발생해서 기각했다. A를 택했고, 승인된 값 그대로 썼다.

## 4. 승인 밖 필드

캐시의 `parking_count` · `far` · `bcr` · `approval_date` · `name` · `jibun` · `lawd_cd`, 그리고 master 전체는 **읽기만** 했다. 쓰기 SQL은 `total_households` 한 컬럼만 건드린다.

## 5. 쓰기 안전장치

1. 승인 시점 baseline(72 / 4)과 master(892 / 15)를 **현재 Production에서 다시 읽어** 대조 — 하나라도 다르면 STOP
2. 대상 지번의 캐시 행이 정확히 2개인지 확인 — 다르면 STOP
3. **rollback artifact를 쓰기 전에** 생성(`tmp/apartment-cache-stale/rollback-2026-09-20T11-01-52-682Z.json`) — 행별 old 값 + 되돌림 SQL. 실행하지 않았다
4. UPDATE는 행마다 `id` + `total_households = 기대 old`일 때만. 영향 행이 1이 아니면 **트랜잭션 전체 롤백**
5. 단일 트랜잭션. 실제 guard 불일치 **0건**

## 6. 사후 검증

| 항목 | 결과 |
|---|---|
| 변경 행 | **2 / 2** |
| 변경 컬럼 | `total_households` **only** |
| 경동(id 399) | 72 → **892** · parking 962 · far 51.47 · bcr 22.31 · 승인일 1995년 **전부 불변** |
| 우성빌라(id 255) | 4 → **15** · parking 18 · far 28.65 · bcr 40.65 · 승인일 1994년 **전부 불변** |
| master | **불변**(892 / 15, parking·비율·FAR·BCR·도로명 그대로) |
| 캐시 전체 행 수 | **95 → 95**(INSERT/DELETE 0) |
| **캐시가 master를 가리는 행** | **0** |

남은 "캐시 ≠ master" 행 9개는 전부 **master 세대수가 NULL**인 경우다(서울 7 · 부산 2). 캐시가 master에 없는 값을 채워주는 방향이라 가리는 것이 아니고, 이번 결함과 반대 상황이다. **양쪽에 값이 있으면서 어긋나는 행은 0건**이다.

## 7. Production QA

| 요청 | 화면 |
|---|---|
| 경동 (우동 974) | **892세대** · 사용승인일 1995년 · **세대당 1.08대 (총 962대)** · 용적률 51.5% · 건폐율 22.3% |
| 해운대경동제이드 (같은 필지) | **892세대** — 이름 표기가 달라도 동일 |
| 우성빌라 (중동 1505-3) | **15세대** · 사용승인일 1994년 · **세대당 1.20대 (총 18대)** · 용적률 28.7% · 건폐율 40.7% |

`총주차대수` **총량(962대 · 18대)은 보정 전과 같다** — parking을 건드리지 않았다는 것이 화면에서도 확인된다. 세대당 비율은 상세 API가 `formatParking`으로 **재계산**하므로 13.36 → 1.08, 4.50 → 1.20으로 자동 정상화됐다.

## 8. 회귀 / 격리

| 기능 | 결과 |
|---|---|
| large-complex · dashboard · rankings · supply · sitemap | 200 · **응답 바이트 수가 쓰기 전과 완전히 동일**(10,595 / 72,871 / 39,513 / 252,785 / 20,168) |
| /api/transactions · school | 200 |
| 주차 Score(경동) | 정상 — parking 51 (총점 53) |

| 격리 | 값 |
|---|---|
| 부산 master | **3,438** 불변 |
| 서울 master | **6,843** 불변 |
| 서울 좌표 보유 | **6,726** 불변(117 미보유 그대로) |
| 매매 총건 | **865,421** 불변 |
| 취소 | **16,345** 불변 |
| false-cancel 28 · Seoul sale apply | 손대지 않음 |

## 9. 테스트

```
npx eslint scripts/fix-apartment-cache-stale-households.ts   exit 0
npx tsc --noEmit    src/ 0 · 신규 파일 0 (기존 scripts/tmp 오류는 건수 불변)
```

runtime `src/`를 바꾸지 않아 build/전체 suite는 `fc0cfd7` 상태 그대로다.

## 10. 남은 일 / 권고

1. **구조적 재발 가능성** — 이번엔 값을 맞췄지만, `totalHouseholds`가 tier1 게이트에 없는 구조는 그대로다. 앞으로 master 세대수를 고칠 때마다 네 필드가 채워진 캐시 행은 다시 가릴 수 있다. 해당 캐시 행은 현재 **56개**(tier1 게이트 충족)다. 근본 해법은 둘 중 하나이고 **코드 변경이라 별도 STEP이 필요**하다:
   - `isFullyPopulated` 판정에서 세대수를 빼고 **master를 세대수의 단일 출처로** 삼는다
   - 또는 tier1 게이트에 세대수를 포함시켜, 세대수가 없거나 낡으면 tier2로 내려가게 한다
2. **REVIEW 63건** — 세대당 주차 2.0 초과로 남은 30건이 전부 여기 있다(엘지 41.33 · 대림2 16.86 · 대림 14.82). 판단할 것은 하나: `공동주택`으로 분류됐는데 0세대인 레코드를 주거 경계에서 어떻게 다룰 것인가
3. **파생비율 null 12건** · **UNKNOWN 724** · **서울 117 좌표** · **28행 false-cancel** · **서울 sale apply** — 전부 별도 승인 대기
