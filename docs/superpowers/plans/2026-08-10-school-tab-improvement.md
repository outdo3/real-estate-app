# 학군정보 탭 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/app/school/school-client.tsx` / `src/app/api/school/apartments/route.ts`의
"배정 가능 단지" 목록에서 5가지를 고친다: 기본 정렬을 신축순으로, 준공연도를 건축물대장
API로 정확하게, 가격 정보 조회 기간 확대, [더보기] 페이징, '시세보기'를
[실거래가 보기]+[매물 보기]로 분리.

**Architecture:** `apartments/route.ts`에 카카오 지번주소 기반 건축물대장(K-APT) 조회 함수를
새로 추가한다(기존 `src/app/api/apt/[name]/info/route.ts`의 동일 패턴을 이 라우트 전용으로
재구현 — 그 파일은 건드리지 않는다). 법정동 코드 목록은 요청당 한 번만 조회해 모든 단지가
공유하고, 개별 건축물대장 조회는 화면에 노출될 최대 20개에 대해서만 병렬로 수행한다.
클라이언트(`school-client.tsx`)는 정렬 기본값과 페이징 state만 추가한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `fast-xml-parser`(이미 의존성에
있음, `info/route.ts`에서 이미 사용 중). 테스트 프레임워크 없음 — `npm run build` + 로컬
브라우저 수동 확인이 검증 기준.

## Global Constraints

- `src/app/api/apt/[name]/info/route.ts`는 이미 배포·검증된 코드이므로 이번 작업에서
  수정하지 않는다 — 동일한 건축물대장 조회 패턴을 `apartments/route.ts` 안에 별도로
  구현한다.
- `src/app/api/school/route.ts`(학교 랭킹 통계, 합성 데이터)는 이번 요청 범위 밖이므로
  건드리지 않는다.
- 건축물대장 조회는 화면에 실제로 노출될 상위 20개(반경 1.5km 필터 + 거리순 정렬 후)에
  대해서만 수행한다 — 필터링 전 전체 카카오 검색 결과에 대해 조회하지 않는다(불필요한 외부
  API 호출 방지).
- 개별 건축물대장 조회가 실패해도(타임아웃, 매칭 실패, 지번 파싱 불가 등) 전체 응답이
  실패하지 않고 해당 단지의 준공연도만 비어야 한다.
- `npm run build` 클린 통과가 각 태스크의 필수 검증 기준이다.
- 별도 브랜치/워크트리 없이 `main`에서 바로 작업한다. 각 태스크 완료 시 로컬 커밋만 하고
  push는 하지 않는다.

---

## Task 1: 배정가능단지 기본 정렬을 '신축순'으로 변경

**Files:**
- Modify: `src/app/school/school-client.tsx`

- [ ] **Step 1: `aptSort` 초기값 변경**

현재(65번째 줄 부근):
```tsx
  const [aptSort, setAptSort] = useState<'distance' | 'newest'>('distance');
```

다음으로 교체:
```tsx
  const [aptSort, setAptSort] = useState<'distance' | 'newest'>('newest');
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 3: 수동 스모크 테스트**

Run: `npm run dev` → `/school` 접속 → 아무 학교나 클릭 → 배정 단지 목록 상단의 정렬 토글에서
"신축순"이 활성 상태로 기본 선택되어 있는지, 목록이 준공연도 내림차순으로 정렬돼 있는지
확인. "거리순" 클릭 시 정상적으로 거리 기준으로 재정렬되는지도 확인. dev 서버 종료.

- [ ] **Step 4: Commit**

```bash
git add src/app/school/school-client.tsx
git commit -m "feat: 배정가능단지 기본 정렬을 신축순으로 변경"
```

---

## Task 2: 준공연도를 건축물대장 API로 확보 + 가격 조회 기간 확대

**Files:**
- Modify: `src/app/api/school/apartments/route.ts`

**Interfaces:**
- Produces: `fetchBuildYearFromRegistry(aptName: string, addressName: string, lawdCd: string, regcodes: any[]): Promise<number | null>` — 이 태스크 안에서만 쓰이는 모듈 내부 함수.

- [ ] **Step 1: import 추가**

현재(1~4번째 줄):
```ts
import { NextResponse } from 'next/server';
import { point, distance } from '@turf/turf';
import { fetchMolitData } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
```

다음으로 교체:
```ts
import { NextResponse } from 'next/server';
import { point, distance } from '@turf/turf';
import { fetchMolitData } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { XMLParser } from 'fast-xml-parser';
```

- [ ] **Step 2: 건축물대장 조회 헬퍼 함수 추가**

현재(`normalizeAptName` 함수 바로 다음, `export async function GET` 바로 앞):
```ts
const normalizeAptName = (name: string) => {
  if (!name) return '';
  return name.replace(/\s+/g, '').replace(/아파트$/, '');
};

export async function GET(request: Request) {
```

다음으로 교체:
```ts
const normalizeAptName = (name: string) => {
  if (!name) return '';
  return name.replace(/\s+/g, '').replace(/아파트$/, '');
};

// 카카오 지번주소("...구 암남동 507-3")에서 동 이름과 지번을 분리한다.
// "산51"처럼 파싱 불가능한 형태(산번지 등)는 null을 반환해 건너뛴다.
const parseDongJibun = (addressName: string): { dong: string; jibun: string } | null => {
  const tokens = (addressName || '').trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const jibun = tokens[tokens.length - 1];
  const dong = tokens[tokens.length - 2];
  if (!/^\d+(-\d+)?$/.test(jibun)) return null;
  return { dong, jibun };
};

const BUILD_YEAR_API_KEY = process.env.DATA_GO_KR_API_KEY || '';

// 카카오 지번주소를 기반으로 건축물대장(표제부)에서 사용승인일(준공연도)을 조회한다.
// 실거래 유무와 무관하게 정확한 값을 얻을 수 있다 — src/app/api/apt/[name]/info/route.ts의
// 동일한 K-APT 조회 패턴을 이 라우트 용도(준공연도만 필요)에 맞춰 재구현한 것이다. 그 파일은
// 이미 배포·검증된 코드라 건드리지 않고 별도로 둔다.
async function fetchBuildYearFromRegistry(
  aptName: string,
  addressName: string,
  lawdCd: string,
  regcodes: any[]
): Promise<number | null> {
  if (!BUILD_YEAR_API_KEY || !lawdCd) return null;
  const parsed = parseDongJibun(addressName);
  if (!parsed) return null;

  const match = regcodes.find((r: any) => (r.name || '').includes(parsed.dong) && r.code.startsWith(lawdCd));
  if (!match) return null;
  const bjdongCd = match.code.substring(5, 10);

  const parts = parsed.jibun.split('-');
  const bunNum = parseInt(parts[0], 10);
  const jiNum = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  if (isNaN(bunNum)) return null;
  const bun = bunNum.toString().padStart(4, '0');
  const ji = jiNum.toString().padStart(4, '0');

  const cleanKey = encodeURIComponent(decodeURIComponent(BUILD_YEAR_API_KEY.trim().replace(/['"]/g, '')));
  const bldUrl = `http://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo?serviceKey=${cleanKey}&sigunguCd=${lawdCd}&bjdongCd=${bjdongCd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=100`;

  try {
    const res = await fetch(bldUrl, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const xmlData = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
    const jsonObj = parser.parse(xmlData);
    const items = jsonObj.response?.body?.items?.item;
    if (!items) return null;
    const itemsArr = Array.isArray(items) ? items : [items];
    const aptCleanName = normalizeAptName(aptName);
    const target = itemsArr.find((it: any) => {
      const bldNm = (it.bldNm || '').replace(/\s+/g, '');
      return bldNm.includes(aptCleanName) || aptCleanName.includes(bldNm);
    }) || itemsArr[0];

    const useAprDay = target?.useAprDay ? String(target.useAprDay) : '';
    if (useAprDay.length >= 4) {
      const year = parseInt(useAprDay.substring(0, 4), 10);
      if (!isNaN(year) && year > 1900) return year;
    }
    return null;
  } catch (e) {
    return null;
  }
}

export async function GET(request: Request) {
```

- [ ] **Step 3: 법정동 코드 목록을 요청당 1회 조회 + MOLIT 조회 기간 24개월로 확대**

현재:
```ts
      // 실거래가/준공연도: 공공데이터포털(MOLIT) 최근 12개월 매매 데이터에서 이름 매칭으로 조회
      const realAptInfo = new Map<string, { priceStr: string; buildYear: number | null }>();
      if (lawdCd) {
        try {
          const now = new Date();
          const months = Array.from({ length: 12 }, (_, i) => {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
          });
```

다음으로 교체:
```ts
      // 법정동 코드 목록은 요청당 한 번만 조회해 모든 단지의 건축물대장 조회가 공유한다.
      let regcodes: any[] = [];
      if (BUILD_YEAR_API_KEY && lawdCd) {
        try {
          const regRes = await fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?is_ignore_zero=true`, { signal: AbortSignal.timeout(2500) });
          const regData = await regRes.json();
          regcodes = regData.regcodes || [];
        } catch (e) {
          console.warn('Failed to load regcodes for building registry lookup', e);
        }
      }

      // 실거래가: 공공데이터포털(MOLIT) 최근 24개월 매매 데이터에서 이름 매칭으로 조회
      // (12개월에서 확대 — 여전히 24개월 내 거래가 전혀 없는 단지는 정상적으로 "가격 정보
      // 없음"으로 남는다. 준공연도는 아래에서 건축물대장으로 별도 확보하므로 이 매칭에
      // 의존하지 않는다.)
      const realAptInfo = new Map<string, { priceStr: string; buildYear: number | null }>();
      if (lawdCd) {
        try {
          const now = new Date();
          const months = Array.from({ length: 24 }, (_, i) => {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
          });
```

- [ ] **Step 4: 거리 계산 후 건축물대장 준공연도 조회 추가**

현재:
```ts
      // 3. Turf.js를 사용하여 학교와 아파트 간의 직선거리(반경) 계산
      const apartmentsWithDistance = searchedApartments.map(apt => {
        const aptPoint = point([parseFloat(apt.x), parseFloat(apt.y)]);
        const dist = distance(schoolPoint, aptPoint, { units: 'kilometers' });

        const cleanName = apt.place_name.replace(/ 아파트$/, '').trim();
        const matched = realAptInfo.get(normalizeAptName(cleanName));

        return {
          id: apt.id,
          name: cleanName,
          price: matched?.priceStr || '가격 정보 없음',
          buildYear: matched?.buildYear ?? null,
          dist
        };
      });

      // 4. 반경 1.5km 이내 아파트 필터 및 거리순(오름차순) 정렬
      const nearbyApartments = apartmentsWithDistance
        .filter(apt => apt.dist <= 1.5)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 5);

      // 5. 프론트엔드용 데이터 가공 (현실적인 도보 시간 계산 알고리즘)
      return nearbyApartments.map(apt => {
```

다음으로 교체:
```ts
      // 3. Turf.js를 사용하여 학교와 아파트 간의 직선거리(반경) 계산
      const apartmentsWithDistance = searchedApartments.map(apt => {
        const aptPoint = point([parseFloat(apt.x), parseFloat(apt.y)]);
        const dist = distance(schoolPoint, aptPoint, { units: 'kilometers' });

        const cleanName = apt.place_name.replace(/ 아파트$/, '').trim();
        const matched = realAptInfo.get(normalizeAptName(cleanName));

        return {
          id: apt.id,
          name: cleanName,
          addressName: apt.address_name || '',
          price: matched?.priceStr || '가격 정보 없음',
          buildYear: matched?.buildYear ?? null,
          dist
        };
      });

      // 4. 반경 1.5km 이내 아파트 필터 및 거리순(오름차순) 정렬, 상위 20개만 사용
      const nearbyApartments = apartmentsWithDistance
        .filter(apt => apt.dist <= 1.5)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 20);

      // 4-1. 건축물대장에서 정확한 준공연도를 조회해 MOLIT 매칭값을 덮어쓴다(실거래 유무와
      // 무관하게 더 신뢰도 높은 값). 화면에 실제로 노출될 최대 20개에 대해서만 병렬 조회한다.
      const withRegistryBuildYear = await Promise.all(nearbyApartments.map(async apt => {
        const registryBuildYear = await fetchBuildYearFromRegistry(apt.name, apt.addressName, lawdCd, regcodes);
        return { ...apt, buildYear: registryBuildYear ?? apt.buildYear };
      }));

      // 5. 프론트엔드용 데이터 가공 (현실적인 도보 시간 계산 알고리즘)
      return withRegistryBuildYear.map(apt => {
```

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 6: 수동 스모크 테스트**

Run: `npm run dev` → `/school` 접속 → 최근 거래가 뜸한 지역의 학교를 클릭 → 배정 단지 중
"가격 정보 없음"인 단지도 준공연도(예: "2019년")는 채워져 있는지 확인(건축물대장 매칭
성공 케이스). 네트워크 탭 등에서 `/api/school/apartments` 응답이 500 에러 없이 정상
반환되는지 확인. dev 서버 종료.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/school/apartments/route.ts"
git commit -m "feat: 배정단지 준공연도를 건축물대장 API로 확보, 가격 조회 기간을 24개월로 확대"
```

---

## Task 3: [더보기] 버튼 (서버 반환 개수 확대 + 클라이언트 페이징)

**Files:**
- Modify: `src/app/school/school-client.tsx`

**Interfaces:**
- Consumes: `/api/school/apartments` 응답이 이제 최대 20개까지 반환됨(Task 2에서 변경).

- [ ] **Step 1: `visibleApts` state 추가**

현재(64~65번째 줄 부근):
```tsx
  const [aptList, setAptList] = useState<any[]>([]);
  const [aptSort, setAptSort] = useState<'distance' | 'newest'>('newest');
```

다음으로 교체:
```tsx
  const [aptList, setAptList] = useState<any[]>([]);
  const [aptSort, setAptSort] = useState<'distance' | 'newest'>('newest');
  const [visibleApts, setVisibleApts] = useState<number>(5);
```

- [ ] **Step 2: 학교 변경 시 5개로 리셋**

현재(106~123번째 줄 부근):
```tsx
  useEffect(() => {
    if (selectedSchool && selectedSchool.name) {
      const fetchApts = async () => {
```

다음으로 교체:
```tsx
  useEffect(() => {
    setVisibleApts(5);
    if (selectedSchool && selectedSchool.name) {
      const fetchApts = async () => {
```

- [ ] **Step 3: 목록에 `.slice(0, visibleApts)` 적용 + [더보기] 버튼 추가**

현재:
```tsx
              <div className={styles.aptList}>
                {[...aptList].sort((a, b) => {
                  if (aptSort === 'newest') {
                    return (b.buildYear || 0) - (a.buildYear || 0);
                  } else {
                    return (a.distance || 0) - (b.distance || 0);
                  }
                }).map(apt => (
```

다음으로 교체:
```tsx
              <div className={styles.aptList}>
                {[...aptList].sort((a, b) => {
                  if (aptSort === 'newest') {
                    return (b.buildYear || 0) - (a.buildYear || 0);
                  } else {
                    return (a.distance || 0) - (b.distance || 0);
                  }
                }).slice(0, visibleApts).map(apt => (
```

같은 블록, 현재(목록 `map`이 끝나는 `))}` 바로 다음, `</div>` 다음의 모달 바디 마지막 지점,
즉 아래 코드):
```tsx
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
```

다음으로 교체:
```tsx
                ))}
              </div>
              {aptList.length > visibleApts && (
                <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                  <button onClick={() => setVisibleApts((v) => v + 5)} className={styles.sortBtn}>
                    더보기 ({aptList.length - visibleApts}개 더 있음)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 5: 수동 스모크 테스트**

Run: `npm run dev` → `/school` 접속 → 배정 단지가 5개 넘게 잡히는 학교를 클릭 →
처음에는 5개만 보이고 "더보기" 버튼이 남은 개수와 함께 뜨는지, 클릭 시 5개씩 더 보이는지
확인. 다른 학교를 클릭하면 다시 5개로 리셋되는지 확인. dev 서버 종료.

- [ ] **Step 6: Commit**

```bash
git add src/app/school/school-client.tsx
git commit -m "feat: 배정단지 목록에 5개씩 더보기 페이징 추가"
```

---

## Task 4: '시세보기'를 [실거래가 보기] + [매물 보기]로 분리

**Files:**
- Modify: `src/app/school/school-client.tsx`

- [ ] **Step 1: 링크 버튼 교체**

현재:
```tsx
                    <div style={{ textAlign: 'right' }}>
                      <div className={styles.aptPrice}>{apt.price}</div>
                      <Link href={`/apt/${encodeURIComponent(apt.name)}?lawdCd=${region.lawdCd}&type=apt`} className={styles.linkBtn}>시세 보기 &gt;</Link>
                    </div>
```

다음으로 교체:
```tsx
                    <div style={{ textAlign: 'right' }}>
                      <div className={styles.aptPrice}>{apt.price}</div>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                        <Link href={`/apt/${encodeURIComponent(apt.name)}?lawdCd=${region.lawdCd}&type=apt`} className={styles.linkBtn}>
                          실거래가 보기 &gt;
                        </Link>
                        <a
                          href={`https://new.land.naver.com/search?query=${encodeURIComponent(apt.name)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.linkBtn}
                        >
                          매물 보기 ↗
                        </a>
                      </div>
                    </div>
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 3: 수동 스모크 테스트**

Run: `npm run dev` → `/school` 접속 → 학교 클릭 → 배정 단지 항목마다 "실거래가 보기"와
"매물 보기" 버튼이 나란히 보이는지 확인. "실거래가 보기" 클릭 시 기존처럼 단지 상세페이지로
이동하는지, "매물 보기" 클릭 시 새 탭으로 네이버 부동산 검색 결과가 열리는지 확인. dev 서버
종료.

- [ ] **Step 4: Commit**

```bash
git add src/app/school/school-client.tsx
git commit -m "feat: 시세보기 버튼을 실거래가 보기 + 매물 보기(네이버 부동산)로 분리"
```

---

## Task 5: 최종 클린 빌드 및 통합 확인

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 클린 빌드**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: 통합 수동 확인**

Run: `npm run dev` → `/school` 접속 → 서로 다른 지역 학교 2곳으로 5개 항목을 순서대로 확인:
1. 배정 단지가 신축순으로 기본 정렬되고, 거리순 토글이 되는지
2. 최근 거래가 없는 단지에도 준공연도가 채워지는지(건축물대장 매칭 성공 케이스), 매칭
   자체가 안 되는 단지는 준공연도 없이 조용히 넘어가는지(페이지 깨짐 없음)
3. 배정 단지가 5개 넘을 때 [더보기]로 늘어나고, 학교 전환 시 5개로 리셋되는지
4. [실거래가 보기]/[매물 보기]가 각각 정상 동작하는지
5. 지역마다 실제로 다른 결과가 나오는지(하드코딩 없음 회귀 확인)
그리고 배정 단지가 아예 없는 학교(반경 1.5km 내 아파트 없음)로도 확인해 "인근 아파트 매물
없음" 폴백이 깨지지 않는지 확인.

- [ ] **Step 4: git 상태 확인**

Run: `git status`
Expected: 커밋되지 않은 변경 없음.

(이번 작업은 아직 push하지 않는다 — 사용자가 지정하는 시점에 push한다. 이 작업이 5개
하위 프로젝트 중 마지막이므로, 완료 후 전체 종합 review 여부도 함께 확인한다.)
