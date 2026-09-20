# E-JIP HOUSEHOLDS SOURCE PRECEDENCE HARDENING V1

낡은 캐시가 보정된 master 세대수를 다시 가릴 수 있는 **구조**를 제거한다.

- 날짜: 2026-09-20 (KST) · 기준 커밋 `ed0a045` → `72f941c`
- **Production DB write 0** — 캐시 0 · master 0 · schema 0 · INSERT/UPDATE/DELETE 0
- runtime `src/` 변경(배포 포함) · cancellation 0 · sale apply 0 · 서울 데이터 0

## 판정

**PASS** — 세대수의 권위가 master로 옮겨졌고, 오늘 값이 달라지는 페이지는 **0건**이다. 보완 케이스 11건은 전부 값을 지켰다.

---

## 1. 이전 우선순위 (실제 코드 기준)

```
fetchCachedRegistry()
  ├ cached   = apartments(name + dong)            ← jibun identity guard 통과 시
  └ byJibun  = apartments(dong + jibun)           ← 이름 제약 없음
      게이트: parkingCount && far && bcr && approvalDate
      통과 시 즉시 return { ..., totalHouseholds: cached.totalHouseholds ?? null }

if (!isFullyPopulated) → fetchMasterRegistrySupplement()   ← master, 빈 필드만 보충
if (!isFullyPopulated) → live 건축물대장                     ← 빈 필드만 보충 + 캐시 upsert
```

**결함의 정확한 위치**: 게이트는 네 필드만 본다. `totalHouseholds`는 게이트에 **없고** 그냥 딸려 나온다. 네 필드가 채워진 캐시 행은 세대수가 낡아도 통과하고, 그 값이 truthy이므로 `isFullyPopulated`가 참이 되어 **master 보충이 한 번도 실행되지 않는다.**

경동이 master 892인데 화면에 72로 남아 있던 경로가 이것이다. 값을 손으로 고쳐도 구조는 그대로라, master 세대수를 보정할 때마다 재발할 수 있었다.

## 2. 새 세대수 우선순위

```
세대수        MASTER(non-null) > CACHE > LIVE
그 밖의 필드   CACHE > MASTER > LIVE        (기존 그대로, 한 글자도 안 바꿈)
```

구현의 핵심은 **master 보충을 조건 없이 부르는 것**이다. 캐시가 세대수를 줬을 때야말로 master를 봐야 하는 순간인데, 예전 조건(`!isFullyPopulated`)은 정확히 그 경우를 건너뛰었다.

master 세대수가 `null`이면 캐시 값을 그대로 쓴다 — master에 없고 캐시에만 있는 **보완 케이스가 값을 잃으면 안 된다**.

## 3. 변경 파일

| 파일 | 내용 |
|---|---|
| `src/lib/registry-precedence.ts` (신규) | `mergeMasterIntoRegistry` · `mergeLiveIntoRegistry` · `isFullyPopulated` · `masterApprovalYear` — 병합 규칙만 담은 순수 모듈 |
| `src/lib/registry-precedence.test.mjs` (신규) | 규칙 고정 테스트 15개 |
| `src/app/api/apt/[name]/info/route.ts` | master 보충을 무조건 호출 · 병합을 공용 모듈로 위임 · `§MASTER_EXACT_CROSSCHECK`가 읽은 master row 재사용 |

**이 라우트가 유일한 대상이다.** `apartments` 캐시를 읽는 다른 라우트(education · facilities · verify · apt) 중 세대수를 쓰는 곳은 없고, score 라우트는 세대수를 **`apartmentMaster`에서 직접** 읽는다.

## 4. 보완 케이스 (master 세대수 없음 + 캐시 값 있음)

tier1 게이트를 충족하는 캐시 행 기준 **11건**. 배포 후 Production에서 11건 전수 확인 — **11 / 11 값 유지**:

| 단지 | 세대수 | 함께 유지된 값 |
|---|---|---|
| 대신롯데캐슬 | 142 | 1.73대(246대) · 315.9% · 28.3% · 2002년 |
| 삼호 | 213 | 1.04대(221대) · 371.6% · 24.1% · 1998년 |
| 롯데캐슬 | 713 | 1.87대(1,335대) · 269.6% · 16.2% · 2007년 |
| 개포자이프레지던스 | 3,375 | 1.78대(6,019대) · 249.8% · 20.3% · 2023년 |
| 래미안원베일리 | 2,990 | 1.85대(5,532대) · 299.8% · 19.9% · 2023년 |
| 진주혁신도시중흥에스클래스 | 726 | 1.81대(1,316대) · 2020년 |
| 진주문산코아루 | 520 | 1.36대(708대) · 2010년 |
| 송암파크빌 | 18 | 0.78대(14대) · 2002년 |
| 롯데 | 400 | 3.81대(1,524대) · 2005년 |
| 대운스카이뷰1차 | 46 | 1.30대(60대) · 2022년 |
| 강남한신휴플러스6단지 | 378 | 0.92대(346대) · 2015년 |

> 앞 STEP에서 이 집합을 **9건**으로 보고했다. 그때 쓴 질의가 INNER JOIN이라 같은 지번에 master가 여럿이면 행이 중복되고 master가 없는 캐시 행은 빠졌다. 캐시 행 1개당 master 1개로 축약해 다시 세면 게이트 기준 **11건**, 게이트를 빼면 **14건**이다. 정정한다.

## 5. stale 캐시 회귀 테스트

| 시나리오 | 기대 | 결과 |
|---|---|---|
| master 892 · 캐시 **72** | **892** | PASS — 이번 수정의 핵심 |
| master 892 · 캐시 892 (경동) | 892 | PASS |
| master 15 · 캐시 15 (우성빌라) | 15 | PASS |
| master null · 캐시 213 | 213 | PASS |
| master/캐시 둘 다 null · live 165 | 165 | PASS |

synthetic stale 케이스에서 캐시의 parking 962 · FAR 51.47 · BCR 22.31 · 승인일 1995년이 **전부 보존**되는 것까지 함께 고정했다.

## 6~7. 경동 / 우성빌라 Production QA (배포 후)

| 단지 | 결과 |
|---|---|
| 경동 (우동 974) | **892세대** · 1995년 · **세대당 1.08대 (총 962대)** · 51.5% · 22.3% |
| 해운대경동제이드 (같은 필지) | **892세대** — 이름 표기가 달라도 동일 |
| 우성빌라 (중동 1505-3) | **15세대** · 1994년 · **세대당 1.20대 (총 18대)** · 28.7% · 40.7% |

## 8. 다른 캐시 필드 보존

`parkingCount` · `far` · `bcr` · `approvalDate`는 **캐시 우선을 그대로 유지**한다. 캐시 행을 버리지 않고 필드 단위로 병합한다.

승인일이 특히 중요하다: master의 `use_approval_date`가 null인 단지가 많아 화면의 "1995년"은 캐시가 주고 있다. 행을 버리는 방식이었다면 그 값이 사라졌을 것이다(앞 STEP에서 캐시 행 삭제안을 기각한 이유와 같다).

## 9. 기능 QA

| 기능 | 결과 |
|---|---|
| 상세 info | 200 · 위 표대로 |
| score / education / facilities (경동) | 200 / 200 / 200 |
| school | 200 |
| large-complex · dashboard · rankings · supply · sitemap · transactions | 200 · **응답 바이트 수가 배포 전과 완전히 동일**(10,595 / 72,871 / 39,513 / 252,785 / 20,168 / 93) |
| 5xx | **0** |

## 10. 성능

- 추가되는 것은 **인덱스 조회 1회**다. 게다가 이 질의는 **새 질의가 아니다** — 기존 `fetchMasterRegistrySupplement`가 쓰던 where 절 그대로이고, 바뀐 것은 *얼마나 자주 도느냐*뿐이다.
- `§MASTER_EXACT_CROSSCHECK`가 이미 master row를 읽는 경로에서는 그 row에 registry 필드를 함께 select 해 **재사용**한다 — 같은 단지에 master 조회가 두 번 나가지 않는다. **N+1 없음**(요청당 최대 1회).
- live 건축물대장 호출 수: 전체 캐시 행 시뮬레이션에서 **54 → 54, 변화 없음**. 바깥으로 일을 밀어내지 않는다.
- 배포 후 실측 중앙값(각 8회): 경동 **0.413s**(min 0.391 / max 0.713) · 대신롯데캐슬 **0.410s**(min 0.372 / max 0.685).

## 11. 테스트 / 빌드

```
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"   2,367 pass / 0 fail   (기존 2,352 + 신규 15)
npx eslint (변경 3파일)                                   exit 0
npx tsc --noEmit                                         src/ 0 에러
npm run build                                            ✓ Compiled successfully
```

`npx tsc --noEmit` 전체는 기존 `scripts/` 21건 + `tmp/` 6건으로 `FAIL_EXISTING_SCRIPT_ERRORS`이며, `src/`와 이번 신규 파일은 **0건**이다.

## 12. DB write 단언

| 항목 | 값 |
|---|---|
| 캐시 write | **0** |
| master write | **0** |
| INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| schema / migration | 0 / 0 |
| cancellation repair · Seoul sale apply | 0 · 0 |

이번 STEP의 모든 DB 접근은 `SET TRANSACTION READ ONLY` 하의 조회였다.

## 13~14. 커밋 / 배포

- 커밋 `72f941c` — `ed0a045..72f941c` push 완료
- Production 배포 `real-estate-diehvp1wr` · Ready · 빌드 36s

## 15. 배포 후 Production QA 요약

| 확인 | 결과 |
|---|---|
| 경동 | **892** |
| 우성빌라 | **15** |
| master-null / 캐시-값 보완 11건 | **11 / 11 유지** |
| master·캐시 둘 다 값 있고 어긋나는 행 | **0** |
| 5xx | **0** |

## 16. Blockers

없음. 다만 짚어 둘 사실: **이 변경으로 오늘 값이 달라지는 페이지는 0건이다.** 95개 캐시 행 전체에 새 병합을 적용해 현재 Production 데이터로 시뮬레이션한 결과 변경 0건이었고, master와 캐시가 둘 다 값을 가지면서 어긋나는 행은 좌천시민(캐시 40 vs master 120) 하나뿐인데 그 행은 애초에 게이트를 통과하지 못해 이미 master가 이기고 있었다.

즉 이번 STEP은 **지금을 고치는 변경이 아니라 다음을 지키는 변경**이다. 실제 효과는 게이트를 충족하는 나머지 55개 행에서, 앞으로 master 세대수를 보정할 때 나타난다.

## 17. 다음 권고

1. **REVIEW 63건** — 여전히 최우선. 세대당 주차 2.0 초과로 남은 30건이 전부 여기 있고(엘지 41.33 · 대림2 16.86 · 대림 14.82), 막고 있는 판단은 하나다: `공동주택`으로 분류됐는데 0세대인 레코드를 주거 경계에서 어떻게 다룰 것인가. **이제 그 보정이 캐시에 가려지지 않는다.**
2. **파생비율 null 12건** · **UNKNOWN 724** · **서울 117 좌표** · **28행 false-cancel** · **서울 sale apply** — 별도 승인 대기
3. 같은 구조를 다른 필드로 넓힐지는 별도 판단 — 지금은 세대수 한 필드만 뒤집었다. parking·FAR·BCR은 캐시가 더 최신인 경우가 있을 수 있어 근거 없이 뒤집지 않았다.
