# E-JIP SCHOOL REGION TRANSITION + COUNT CONTRACT FIX V1

`SCHOOL_REGION_STATE_COUNT_PARITY_AUDIT_V1`이 남긴 두 결함(P0·P1)을 수정한다.

- 구현·배포: 2026-09-21 15:45~16:15 KST · 커밋 **`f8fd221`** (기준 `dd08a47`)
- 제품 결정: **OPTION B** — 모든 학교 유형 보존, 요약 카드도 같은 dataset
- **DB INSERT/UPDATE/DELETE 0 · schema 0 · migration 0 · NEIS write 0**

## 판정

**PASS** — 16개 구·군 전부 `total = 초+중+고+기타`이고 **카드 == 전체 목록**(불일치 0),
서구 **24(11/7/5/1)**, 부산혜송학교 정상 노출, 전환 후 이전 지역 잔존 0.

---

## 1~3. P0 — 지역 전환 시 이전 목록 제거

### 무엇이 문제였나

`setSchools`가 **성공 응답에서만** 호출되고 지역 변경 시 초기화가 없었으며, 목록 `<ul>`이
**`loading`과 무관하게** 렌더됐다. 그래서 제목은 즉시 새 지역으로 바뀌는데 **목록은 이전 지역이
그대로 남았다.** 요청 취소·stale 가드도 없었다.

### 무엇을 바꿨나 (`src/app/school/school-client.tsx`)

```tsx
useEffect(() => {
  const controller = new AbortController();
  let cancelled = false;

  setSchools([]);          // ① 전환 즉시 이전 목록을 버린다
  setLoading(true);

  (async () => {
    try {
      const res = await fetch(url, { signal: controller.signal });   // ② 취소 가능
      const json = await res.json();
      if (cancelled) return;                                          // ③ 늦은 응답 무시
      if (json.success) setSchools(json.data);
    } catch (error) {
      if (!cancelled && (error as Error)?.name !== 'AbortError') console.error(…);
    } finally {
      if (!cancelled) setLoading(false);
    }
  })();

  return () => { cancelled = true; controller.abort(); };
}, [regionName, activeTab]);
```

통계도 동일하게 처리하고(`setStats(EMPTY_STATS)` + abort + cancelled), 목록은 **로딩 중 렌더하지 않는다**:

```tsx
{loading && <div>불러오는 중입니다...</div>}
{!loading && schools.length === 0 && <div>{hasDistrict ? '…조회된 학교가 없습니다.' : '구·군을 선택하면…'}</div>}
<ul className={styles.schoolList}>
  {!loading && schools.map(…)}
</ul>
```

| §2 시나리오 | 결과 |
|---|---|
| 동래구 요청 시작 → 서구로 변경 → 서구 완료 → **뒤늦은 동래구 응답** | `controller.abort()` + `cancelled` 가드로 **무시**. 동래구가 다시 들어오지 않는다 |
| 빠른 연속 전환(서구→동구→남구) | 앞선 요청이 전부 abort되고 **마지막 것만** 적용 |
| `sigungu=''` | **0행 + "구·군을 선택하면…"** 안내 |

`setSchools([])`는 `regionName`과 `activeTab` **둘 다**에 대해 동작한다 — 탭만 바꿔도
이전 탭 목록이 새 제목 아래 남지 않는다.

## 4. Region parity

표시 지역·요청 지역·렌더된 dataset이 모두 같은 `region` 객체에서 나오고,
이제 **렌더된 dataset도 현재 요청 결과만** 남는다(이전에는 여기만 어긋날 수 있었다).

## 5~8. P1 — 카운트 계약 통일 (OPTION B)

### 학교급 버킷을 한 곳에서 판정 (`src/lib/neis-sido-codes.ts`)

```ts
export function classifySchoolKind(kind) {
  if (kind === '초등학교') return 'elementary';
  if (kind === '중학교')   return 'middle';
  if (kind === '고등학교') return 'high';
  return 'other';                 // 특수·외국인·각종·방송통신·평생학교 + unknown/null
}
export function bucketForTab(tab) { … }  // 전체/학원가 → null(필터 없음)
```

- **초/중/고는 정확히 일치할 때만** 그 버킷이다. `방송통신고등학교`는 접미사가 같아도 **기타**다 —
  이름으로 묶으면 초/중/고 숫자가 조용히 부풀어 오른다.
- **unknown/null도 버리지 않고** 기타로 센다(§7). source의 `SCHUL_KND_SC_NM`은 그대로 보존된다.
- **목록 라우트와 통계 라우트가 같은 함수를 쓴다** — 두 숫자가 다시 갈라질 수 없다(테스트로 고정).

### 탭 계약 (§8)

| 탭 | 동작 |
|---|---|
| **전체** | 그 지역 **모든 학교 유형** (임의 제거 없음) |
| 초등 / 중등 / 고등 | 해당 버킷만 |
| 학원가 | 학교급 필터 없음 |

특수학교 전용 탭은 만들지 않았다(§8 지시).

### 요약 카드 (§6)

`totalSchools = elem + mid + high + **other**`, 응답에 `otherCount` 추가.
화면 표기: **`총 24개교 (초11/중7/고5/기타1)`**

## 9~10. 테스트 — 19건 통과

| 구분 | 내용 |
|---|---|
| **전환(P0)** | `setSchools([])` · `setStats(EMPTY_STATS)` · `AbortController` · `cancelled` 가드 · `{!loading && schools.map(` 존재를 소스로 고정 |
| **카운트(P1)** | 서구 24 = 11+7+5+1 재현 · `N = A+B+C+D` · 부산혜송학교 = 기타(전체 포함, 초/중/고 미포함) |
| **기타 보존(§7)** | 특수·외국인·각종(중/고)·방송통신(중/고)·고등기술·공동실습소·평생학교(고/중) + `null`/`undefined`/미래 학교급 → 전부 기타 |
| **부풀림 방지** | `방송통신고등학교`→기타 · `방송통신중학교`→기타 · `고등기술학교`→기타 · `고등학교`→high |
| **계약 분기 방지** | 두 라우트가 `classifySchoolKind` 사용 · stats total에 `otherCount` 포함 |

**src 전체 1,884 pass / 0 fail** · tsc `src/` 오류 0 · eslint exit 0 · `npm run build` ✓.

## 11. 부산 16개 구·군 — 운영 실측

| 구 | 카드 total | 초 | 중 | 고 | 기타 | 합=total | 전체 목록 | 카드=목록 |
|---|---|---|---|---|---|---|---|---|
| 중구 | 9 | 4 | 1 | 4 | 0 | ✅ | 9 | ✅ |
| **서구** | **24** | **11** | **7** | **5** | **1** | ✅ | **24** | ✅ |
| 동구 | 20 | 6 | 5 | 5 | 4 | ✅ | 20 | ✅ |
| 영도구 | 26 | 12 | 8 | 6 | 0 | ✅ | 26 | ✅ |
| 부산진구 | 66 | 30 | 19 | 17 | 0 | ✅ | 66 | ✅ |
| 동래구 | 52 | 23 | 14 | 13 | 2 | ✅ | 52 | ✅ |
| 남구 | 53 | 21 | 13 | 15 | 4 | ✅ | 53 | ✅ |
| 북구 | 53 | 27 | 15 | 9 | 2 | ✅ | 53 | ✅ |
| 해운대구 | 65 | 32 | 18 | 14 | 1 | ✅ | 65 | ✅ |
| 사하구 | 58 | 26 | 16 | 14 | 2 | ✅ | 58 | ✅ |
| 금정구 | 53 | 21 | 12 | 14 | 6 | ✅ | 53 | ✅ |
| 강서구 | 45 | 21 | 11 | 7 | 6 | ✅ | 45 | ✅ |
| 연제구 | 30 | 16 | 8 | 4 | 2 | ✅ | 30 | ✅ |
| 수영구 | 22 | 10 | 6 | 4 | 2 | ✅ | 22 | ✅ |
| 사상구 | 39 | 20 | 10 | 5 | 4 | ✅ | 39 | ✅ |
| 기장군 | 39 | 22 | 8 | 5 | 4 | ✅ | 39 | ✅ |

**`total = 초+중+고+기타` 불일치 0 · 카드 vs 전체목록 불일치 0 · wrong-district 0.**
직전 감사가 지적한 **40건 어긋남이 전부 해소**됐다.

## 12. Production QA (브라우저, 실제 DOM)

`/school?sido=부산광역시&sigungu=서구`:

| 항목 | 값 |
|---|---|
| 제목 | `🏫 부산광역시 서구 전체 학교 목록` |
| 요약 카드 | **`총 24개교 (초11/중7/고5/기타1)`** |
| 목록 `<li>` 수 | **24** |
| **부산혜송학교** | **노출됨** ✅ |
| 타 지역 학교 | **0** |

탭 전환 실측(같은 `useEffect`를 타는 경로): 전체 52/52 → 초등 **23/23**(교동초·금강초·낙민초…) →
고등 **13/13**(금정고…) — **매 상태에서 카드와 목록이 일치**하고 이전 탭 행이 남지 않았다.

좁은 폭(390·375·360px)에서 요약 카드·목록 항목·제목 **가로 오버플로 0**.

> **정직하게 적습니다.** 전환 **도중의 sub-second 프레임**은 운영에서 캡처하지 못했다 —
> 샘플링 루프가 CDP `Runtime.evaluate` 45초 한도에 걸려 두 번 중단됐다. 확인한 것은
> **① 전환 후 최종 상태가 항상 정확**하고 **② 초기화·abort·cancelled·로딩 게이트가 소스에 존재**한다는 것이다
> (테스트로 고정). "전환 중 이전 행이 보이지 않는다"는 **코드 계약으로는 보장되지만 운영 프레임으로는 미촬영**이다.

## 13. No-write assertion

| 항목 | 값 |
|---|---|
| DB INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| schema · migration | **0 · 0** |
| NEIS source write | **0** (읽기 전용 API) |
| 변경 파일 | `neis-sido-codes.ts(+test)` · `api/school/route.ts` · `api/school/stats/route.ts` · `school-client.tsx` |

## 14~15. Commit / Deploy

커밋 **`f8fd221`** (5파일), push·배포 완료. 배포 후 운영에서 `otherCount` 응답 확인.

## 16. 남은 학교 blocker

1. **(가칭) 학교의 실제 소재 구를 말할 출처가 없다.** NEIS가 설립 교육지원청 주소를 주므로
   여전히 목록·집계에서 제외된다. 표시하려면 별도 데이터가 필요하다.
2. **학업성취도·특목고 진학률·학급당 인원은 "데이터 준비 중"** — NEIS에 없는 값이라 지어내지 않는다.
3. **학원 수는 카카오 API 한도로 최대 45건**까지만 실집계(서구 "학원 45개"는 그 상한에 걸린 값일 수 있다).
4. **지역 선택이 영속화되지 않는다** — 새로고침·뒤로가기마다 "부산광역시 전체"로 시작한다.
   이번 수정으로 그 상태가 **0행 + 안내**로 정직해졌지만, 매번 지역을 다시 고르는 UX는 그대로다.
5. **"기타"가 무엇인지 화면에서 알 수 없다.** 서구 기타 1이 특수학교라는 사실은 목록을 봐야 안다.

## 17. 다음 권고

1. **지역 선택 영속화(P2)를 검토하십시오.** 남은 것 중 사용자 체감이 가장 큽니다 —
   지금은 진입할 때마다 "부산광역시 전체"에서 다시 고르게 됩니다.
2. **"기타" 툴팁/부제**를 붙이면(예: `기타 1 (특수학교)`) 숫자의 의미가 화면에서 닫힙니다. 작은 변경입니다.
3. **학원 45개의 상한 표기**를 고려하십시오 — 카카오 한도라 "45+"가 정확한 표현입니다.
