# 초기 로딩 성능 최적화 — 설계 문서

날짜: 2026-08-09

## 배경

홈/시장통계/학군정보 페이지의 데이터 로딩이 경쟁 서비스 대비 현저히 느리다는 문제 제기. 원인을 코드 레벨에서 특정했다.

## 진단

- **`/api/stats/dashboard`**: 페이지 진입마다 최근 12개월(그래프/랭킹용) + 2014년~현재 연도별 통계(최대 13년치, ~150개월)를 합쳐 최대 ~170개월치를 국토부(MOLIT) API에서 조회한다. MOLIT API의 초당 요청 제한 때문에 동시성 3, 요청당 200ms 페이싱으로 순차 처리하는 `fetchMonthsThrottled`를 통과하므로 **최소 10초 이상** 걸린다. 응답 캐싱이 전혀 없어 동일 지역을 다시 조회해도 매번 처음부터 재실행된다.
- **`/api/school/apartments`**: 최근 12개월치를 `Promise.all`로 이미 병렬 조회하고 있어 상대적으로 빠르지만, 역시 캐싱이 없어 매번 재조회된다.
- **`/api/school`**: NEIS 학교 목록 조회(보통 1~2페이지)로 상대적으로 가볍다.
- **홈 지도(`/api/transactions`)**: 이미 병렬 조회 + 3개월 단위 페이징이 되어 있어 상대적으로 덜 심각하다. 이번 범위에서는 캐싱만 추가한다.

## 결정 사항 (사용자 확인 완료)

1. React Query로 전환하지 않고 **기존 SWR 기반**으로 개선한다.
2. 공통 서버 TTL 캐시 + `/api/stats/dashboard` 분리 + 지연 로딩(스켈레톤) 방향으로 진행한다.

## 설계

### A. 공통 서버 캐시 헬퍼 — `src/lib/server-cache.ts`

```ts
const store = new Map<string, { value: unknown; expiresAt: number }>();

export async function getOrSetCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fetcher();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
```

기존 라우트들이 이미 모듈 레벨 `Map` 캐시 패턴(`lawdCdCache`, `geocodeCache`)을 쓰고 있으므로 동일한 스타일을 재사용한다. 서버 인스턴스 생존 기간 동안만 유효(재배포/재시작 시 초기화)하며, 이 프로젝트 규모에서는 별도 Redis 등 외부 캐시 도입은 과설계로 판단해 제외한다.

적용 대상과 TTL:
- `/api/stats/dashboard` (분리 후의 "최근 12개월" 응답): `lawdCd` 기준, TTL 30분
- `/api/stats/yearly` (신규, 연도별 표): `lawdCd` 기준, TTL 60분 (변경 빈도가 더 낮음)
- `/api/school/apartments`: `schoolName+lawdCd` 기준, TTL 30분
- `/api/school`: `region+type` 기준, TTL 60분

### B. `/api/stats/dashboard` 분리

기존 `route.ts`에서 "연도별(2014~올해) 통계표" 계산 부분(`yearlyTasks`, `yearlyTable` 생성 로직)을 들어내어 신규 `src/app/api/stats/yearly/route.ts`로 옮긴다. 기존 라우트는 `rollingTasks`(최근 12개월, apt+rent 24개월치)만 조회하도록 축소되어 응답 시간이 큰 폭으로 줄어든다. 두 라우트 모두 동일한 `resolveLawdCd`/`fetchMonthsThrottled`/`isValidTrade` 등 헬퍼를 공유해야 하므로, 이 헬퍼들을 `src/lib/molit-stats-helpers.ts`로 추출해 두 라우트에서 재사용한다(중복 방지).

### C. 클라이언트 지연 로딩 (스켈레톤)

`stats-client.tsx`:
- 기존 `useSWR('/api/stats/dashboard?...')`는 그대로 유지(축소된 응답을 받음 — 요약/그래프/랭킹/갭투자용).
- `yearlyTable`은 별도 `useSWR('/api/stats/yearly?...')`로 조회하고, "표로 보기" 탭이 실제로 렌더링될 때만 요청되도록 SWR의 조건부 키(`chartView === 'table' ? '/api/stats/yearly?...' : null`)를 사용한다 — 처음부터 두 요청을 동시에 쏘지 않고, 필요한 시점에만 두 번째 요청이 나가게 한다.
- 연도별 표 로딩 중에는 기존 로딩 문구 대신 표 형태의 스켈레톤(회색 바 placeholder row 5~6개)을 보여준다.

`school-client.tsx`: 이미 개별 `useEffect`+`fetch`로 병렬 실행되고 있으므로 구조 변경은 하지 않고, 서버 캐시(A)만으로 재방문 속도를 개선한다.

## 검증 계획

- `npm run build` 클린 빌드.
- 로컬에서 같은 지역을 두 번 연속 조회해 두 번째 응답이 캐시로 인해 눈에 띄게 빨라지는지 확인(정확한 초 단위 비교는 로컬 네트워크 환경에 따라 달라지므로, "캐시 히트 로그"를 임시로 남겨 확인하거나 응답 시간을 콘솔에 로그).
- "표로 보기" 탭 최초 진입 시 스켈레톤이 보이다가 데이터로 교체되는지 수동 확인.
