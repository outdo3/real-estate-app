# 학군정보 탭 개선 — 설계 문서

날짜: 2026-08-10

## 배경

"프로젝트 명칭 변경 및 UX/성능 최적화 종합 작업" 요청의 5번째(마지막) 하위 프로젝트. 대상
파일은 `src/app/school/school-client.tsx`(배정 단지 UI)와
`src/app/api/school/apartments/route.ts`(배정 단지 데이터). 요구사항 5가지:

1. 배정가능단지 기본 정렬 '신축순', [거리순] 토글
2. 정렬 정확도 개선(특히 준공연도)
3. [더보기] 버튼
4. 누락된 가격 정보 복구
5. '시세보기' 버튼을 [실거래가 보기](기존 단지상세 이동 유지) + [매물 보기](네이버 부동산
   외부링크, 신규)로 교체

`src/app/api/school/route.ts`(학교 랭킹 통계)는 완전히 합성/해시 기반 mock 데이터이지만, 이번
요청 범위에 포함되지 않으므로 손대지 않는다.

## 진단

- **정렬**: `school-client.tsx:65`의 `useState<'distance'|'newest'>('distance')`. 토글 버튼
  2개(`거리순`/`신축순`)는 이미 존재하므로 기본값만 바꾸면 된다.
- **준공연도/가격 정확도**: `src/app/api/school/apartments/route.ts:91-116`이 준공연도·가격을
  오직 "최근 12개월 매매 거래를 단지명으로 매칭"해서 채운다. 최근 12개월 내 거래가 없는
  단지는 두 값 다 비게 된다("가격 정보 없음", 준공연도는 UI에서 아예 안 보임). 그런데 같은
  파일이 이미 카카오 로컬 API로 각 단지의 지번주소(`address_name`, 예: "부산광역시 서구
  암남동 507-3")를 받아오고 있으면서 지금은 좌표 계산에만 쓰고 버린다.
- **더보기**: `apartments/route.ts:136-139`가 거리 1.5km 이내로 필터링한 뒤 무조건 상위
  5개로 잘라 반환한다. 클라이언트가 더 보여줄 데이터 자체가 없다.
- **시세보기**: `school-client.tsx:358`에 단지상세 페이지로 가는 `<Link>` 하나만 있다.

## 결정 사항 (사용자 확인 완료)

준공연도 정확도는 3번 하위 프로젝트(단지 상세페이지 개선)에서 이미 만든 K-APT
건축물대장(`BldRgstService_v2/getBrTitleInfo`) 조회 패턴을 재사용해서 확보한다. 실거래
유무와 무관하게 정확한 값을 얻을 수 있기 때문이다. 단, 이미 배포·검증된
`src/app/api/apt/[name]/info/route.ts`는 건드리지 않고, `apartments/route.ts` 안에 같은
패턴을 별도로(용도에 맞게 단순화해서) 구현한다 — 기존 기능의 회귀 위험을 이번 작업 범위
밖에 두기 위함이다.

## 설계

### A. 기본 정렬 '신축순' — `school-client.tsx`

`useState<'distance' | 'newest'>('distance')` → `useState<'distance' | 'newest'>('newest')`
한 줄 변경. 토글 버튼 UI/로직은 기존 그대로.

### B. 준공연도를 건축물대장 API로 확보 — `apartments/route.ts`

1. 카카오 검색 결과 각 항목의 `address_name`(지번주소, 공백 구분: "...시 ...구 {동} {지번}")
   에서 마지막 토큰을 지번, 그 앞 토큰을 동 이름으로 파싱하는 헬퍼를 추가한다. "산51"처럼
   파싱이 안 되는 형태(산번지 등)는 조용히 건너뛴다(기존 `info/route.ts`도 이 케이스를
   지원하지 않으므로 동일 수준 유지).
2. 법정동 코드 목록(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?is_ignore_zero=true`)
   은 요청당 **한 번만** 조회해 모든 단지가 공유한다(단지마다 중복 조회 방지).
3. 각 단지(반경 1.5km 이내로 필터링된 것들)에 대해 병렬로
   `BldRgstService_v2/getBrTitleInfo`(sigunguCd + bjdongCd + bun/ji)를 호출해 `useAprDay`
   (사용승인일, 예: "20240315")의 앞 4자리를 준공연도로 사용한다. 개별 호출은 2.5초
   타임아웃 + 실패 시 `null`로 폴백(하나가 느리거나 실패해도 전체가 막히지 않음).
4. 기존 MOLIT 매칭으로 얻은 `buildYear`(있다면)와 이번 건축물대장 조회 결과가 둘 다 있으면
   건축물대장 값을 우선한다(더 신뢰도 높은 소스). MOLIT 쪽만 있으면 그 값을 폴백으로 쓴다.

### C. 가격 정보 복구 — `apartments/route.ts`

MOLIT 매매 조회 기간을 12개월 → 24개월로 확대(`months` 생성 루프의 length만 변경). 여전히
24개월 내 거래가 전혀 없는 단지는 "가격 정보 없음"으로 정상적으로 남는다(가격은 실거래
데이터로만 채울 수 있으므로 이게 유일하고 합리적인 개선 레버).

### D. 더보기 — `apartments/route.ts` + `school-client.tsx`

- 서버: `slice(0, 5)` → `slice(0, 20)`으로 확대(카카오 반경 검색 한 페이지 분량 그대로 사용,
  추가 페이징 호출 없음).
- 클라이언트: `visibleApts` 개수를 담는 state(초기값 5)를 추가하고, 정렬된 `aptList`를
  `slice(0, visibleApts)`로 렌더링. 목록 아래 `[더보기]` 버튼을 "더 보여줄 항목이 있을 때만"
  노출하고, 클릭 시 +5. `selectedSchool`이 바뀌면(다른 학교 선택) 5로 리셋한다.

### E. 시세보기 → 실거래가 보기 + 매물 보기 — `school-client.tsx`

기존 `<Link href="/apt/...">시세 보기 &gt;</Link>` 한 줄을 다음 두 링크로 교체:

```tsx
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
```

기존 `.linkBtn` 스타일을 그대로 재사용(새 CSS 불필요), 두 버튼은 세로로 나란히 배치.

## 검증 계획

- `npm run build` + `npx tsc --noEmit` 클린
- 실제 학교를 클릭해 배정 단지 목록이 신축순으로 기본 정렬되는지, [거리순] 토글이 되는지
  확인
- 최근 거래가 없는 단지에서도 준공연도가 채워지는지(건축물대장 매칭 성공 케이스), 매칭
  자체가 안 되는 단지는 준공연도 없이 조용히 넘어가는지 확인
- [더보기] 클릭 시 5개씩 늘어나는지, 다른 학교로 전환 시 5개로 리셋되는지 확인
- [실거래가 보기]가 기존처럼 단지상세로, [매물 보기]가 새 탭으로 네이버 부동산 검색을
  여는지 확인
- 서로 다른 지역 학교 2곳으로 회귀 확인(하드코딩된 값 없이 실제로 지역마다 다른 결과가
  나오는지)
