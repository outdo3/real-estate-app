# STEP 22 — PRESALE P2-D4-B3-FIX: 주택형 표시 일관성 수정

상태: P2-D4-B3-FIX 구현 완료 / 사용자 최종 승인 (2026-08-14)

## 최종 승인 기록 (2026-08-14)

사용자 모바일 최종 검수 결과 이상 없음으로 확인되어 **완료 / 사용자
최종 승인**으로 확정됐다. production commit `398d33a`("fix: align
presale market comparison labels")로 배포되었고, 배포 후 production
`nearby-market` API 응답에 `supplyArea` 필드가 실제로 포함되는 것을
확인해 반영을 검증했다.

**최종 확정 내용**:
1. 대표 주택형 표시는 `supplyArea` 기반(기존 상세 UI와 동일 알고리즘)
2. 비교 전용면적은 `exclusiveArea`(houseTy 숫자부) 보조 표시 —
   "비교 전용면적 약 OO㎡"
3. 두 개념을 사용자 UI에서 명확히 분리(같은 chip/제목에 섞이지 않음)
4. `houseTypeDetailId`(PresaleHouseTypeDetail 실제 PK) 연결 유지,
   index matching 없음
5. B2 비교 계산 로직(houseTy parser/±1㎡/aptSeq/6→12→24개월 fallback)
   변경 없음
6. `recentMedianPrice` 계산 로직 변경 없음(3건=가운데값/2건=평균/
   1건=해당값)
7. 사용자 UI 라벨은 "최근 거래 대표가격"(구 "최근 거래 중앙값")
8. ⓘ 안내문에 대표가격 계산 방식 설명 제공
9. 모바일 검수 완료(사용자 최종 승인)
10. production 반영 확인 완료(`supplyArea` 필드 실측 확인)

## 추가 UI 문구 수정 (같은 미커밋 작업 위에서)

주택형 표시 일관성 수정과 별개로, "최근 거래 중앙값"이라는 통계 용어가
일반 사용자에게 낯설다는 판단에 따라 표시 문구만 추가로 수정했다
(`recentMedianPrice` 필드명·median 계산 로직·API는 전혀 변경하지 않음):

- 카드 라벨: "최근 거래 중앙값" → "최근 거래 대표가격"
- 보조 문구: "최근 {N}개월 거래 기준" → "최근 {N}개월 · 최대 3건 기준"
- ⓘ 안내문에 계산 방식 설명 추가: "최근 거래 대표가격은 비슷한
  전용면적의 최근 거래 최대 3건을 기준으로 계산합니다. 3건이면 가운데
  가격, 2건이면 두 거래의 평균, 1건이면 해당 거래가격을 사용합니다."

## 모바일 실기기에서 발견된 문제

B3("주변 아파트 실거래 비교") 기능 자체는 정상 동작했으나, 실기기 검수에서
사용자 혼란 가능성이 있는 표시 문제가 발견됐다. `e편한세상 송도
더퍼스트비치`(id=479) 공고 기준:

- 기존 "주택형 · 분양가" 섹션: `79.75㎡ A`, `79.48㎡ B`, `79.85㎡ C`,
  `80.18㎡ D`, `79.87㎡ E`, `80㎡ F` ...
- B3 chip: `60㎡ B`, `60㎡ D`, `60㎡ C`, `60㎡ F` ...

같은 페이지 안에 "79.48㎡ B"와 "60㎡ B"가 동시에 존재해, 사용자가 이를
서로 다른 주택형처럼 오인할 수 있는 문제였다.

## 왜 두 값이 다른가 — 실제 데이터 출처 확인

코드를 수정하기 전에 두 표시가 각각 어떤 필드에서 나오는지 먼저
확인했다(추측 금지).

**기존 "주택형 · 분양가" 표시** — `src/app/presales/[id]/presale-detail-client.tsx`
의 `formatHouseTypeTitle()`:

```ts
const typeSuffix = d.houseTy?.match(/([A-Za-z]+)$/)?.[1] || '';
return d.supplyArea != null
  ? `${formatArea(d.supplyArea)}㎡${typeSuffix ? ` ${typeSuffix}` : ''}`
  : d.houseTy || '주택형 정보 없음';
```

→ `PresaleHouseTypeDetail.supplyArea`(공급면적, 청약홈 API `SUPLY_AR` 원본
그대로 저장된 값) + `houseTy` 문자열 끝 알파벳(suffix)을 정규식으로 추출.

**B3 chip 표시(수정 전)** — `nearby-market-section.tsx`의
`houseTypeChipLabel()`이 `h.exclusiveArea`를 사용했는데, 이 값은 B2에서
`src/lib/presale-house-type.ts`의 `parsePresaleHouseType()`이
`houseTy`(예: `"059.6290B"`) 문자열의 **숫자부만** 파싱해 만든 값
(`59.629`)이다. 이 값은 P2-D4-B2에서 "청약홈 API가 HOUSE_TY를
전용면적이라 직접 정의하지 않지만, 「주택공급에 관한 규칙」 제21조제5항
+ 실측 100% 일치를 근거로 실거래 비교 계산 전용으로만 쓴다"고 승인된
값이다(`presale-house-type.ts` 상단 주석 참고) — **처음부터 "대표
표시명"으로 쓰도록 설계된 값이 아니었다.**

정리하면 `supplyArea`(공급면적, 청약홈 API 원본)와 `exclusiveArea`
(houseTy 숫자부, B2 비교 계산 파생값)는 애초에 다른 개념이며, 반올림
방식도 달랐다(전자는 소수점 2자리, 후자는 chip 공간상 정수 반올림) —
그래서 "79.48" vs "60"처럼 크게 달라 보였다.

## 정책 — 두 개념을 UI에서 분리

- **① 분양 주택형 표시**(chip 라벨, 선택 제목): `supplyArea` + suffix,
  기존 "주택형·분양가" 섹션과 동일한 알고리즘·동일한 반올림 규칙 사용
- **② 실거래 비교용 전용면적**: `exclusiveArea`(houseTy 숫자부)는 그대로
  유지, "비교 전용면적 약 OO㎡" 문구로 보조 정보처럼 노출

B2의 `parsePresaleHouseType`/±1㎡ tolerance/aptSeq 연결/MOLIT
`excluUseArea` 비교/6→12→24개월 fallback/median/differenceAmount 계산은
전혀 변경하지 않았다.

## 연결 key — index matching 사용하지 않음

`nearby-market` API의 `buildHouseTypes()`는 이미 `houseTypeDetailId: h.id`
로 `PresaleHouseTypeDetail`의 실제 PK를 반환하고 있었다(배열 index
아님). 이 값은 `/api/presales/[id]`가 반환하는 `houseTypeDetails[].id`와
정확히 같은 테이블의 같은 PK다. 이번 FIX는 이 기존 연결 방식을 그대로
유지하면서, 같은 PK로 조회한 행에 `supplyArea` 필드 하나만 추가로
얹었다 — suffix 문자열이나 배열 순서로 연결하는 로직은 어디에도 없다.

## API 변경 (additive만)

`src/app/api/presales/[id]/nearby-market/route.ts`:

1. `presale.findUnique`의 `houseTypeDetails.select`에 `supplyArea: true`
   추가(기존 `id`/`houseTy`/`topAmount`는 그대로).
2. `buildHouseTypes()`가 반환하는 각 houseType 객체에 `supplyArea: h.supplyArea`
   필드 추가(파싱 실패 branch·성공 branch 둘 다).

기존 필드(`houseTypeDetailId`, `houseTy`, `exclusiveArea`,
`presaleTopAmount`, `comparisonAvailable`, `comparisons`)는 의미·계산
방식 그대로 — breaking change 없음. B1 API(`nearby-apartments`)는
전혀 건드리지 않았다.

## UI 변경

`src/app/presales/[id]/nearby-market-section.tsx`:

- `NearbyMarketHouseType` 타입에 `supplyArea` 추가
- `houseTypeChipLabel()`을 `exclusiveArea` 기반에서 `supplyArea` 기반으로
  변경(기존 상세 UI의 `formatHouseTypeTitle`과 동일한 알고리즘 —
  `formatArea`(소수점 2자리 반올림) + suffix, `supplyArea`가 없으면
  원본 `houseTy` 코드로 폴백. 이 폴백도 기존 UI와 동일한 정책이다).
  chip 전용이던 `formatAreaWhole`(정수 반올림)는 더 이상 쓰이지 않아
  제거했다.
- 선택 요약에 "비교 전용면적 약 OO㎡" 줄을 기존 "비슷한 전용면적 OO~OO㎡"
  문구 앞에 추가(같은 `.summaryNote` 문단 안에 `<br/>`로 연결 — 새
  CSS 클래스나 여백 규칙을 추가하지 않기 위함, §14 "기존 UI 수정 금지"
  범위를 넘지 않으려는 선택).
- `sortHouseTypes()`(정렬 정책), chip/카드 CSS(`page.module.css`)는
  전혀 수정하지 않았다.

`presale-detail-client.tsx`(기존 "주택형·분양가" 섹션 자체)는 이번
STEP에서 한 줄도 수정하지 않았다 — 표시 알고리즘을 "재사용"이 아니라
"동일하게 재구현"하는 방식을 선택했는데, 이는 §14(기존 UI 파일을
건드리지 않는다)를 문자 그대로 지키기 위한 판단이다. 대신 두 파일의
알고리즘(같은 정규식 `/([A-Za-z]+)$/`, 같은 반올림
`Math.round(v*100)/100`)이 완전히 동일함을 실측 데이터로 교차검증했다
(아래 참고).

## 실제 검증 — e편한세상 송도 더퍼스트비치 (id=479)

`/api/presales/479`와 `/api/presales/479/nearby-market`을 직접 조회해
12개 주택형 전부 교차검증(오연결 0건):

| houseTypeDetailId | houseTy | supplyArea(기존) | FIX 후 chip 라벨 | topAmount 일치 |
|---|---|---|---|---|
| 2580 | 059.9840A | 79.748 | 79.75㎡ A | ✓ |
| 2581 | 059.6290B | 79.479 | 79.48㎡ B | ✓ |
| 2582 | 059.9560C | 79.854 | 79.85㎡ C | ✓ |
| 2583 | 059.9440D | 80.176 | 80.18㎡ D | ✓ |
| 2584 | 059.9910E | 79.873 | 79.87㎡ E | ✓ |
| 2585 | 059.9770F | 79.995 | 80㎡ F | ✓ |
| 2586~2590 | 084.xxxx A~E | 111.1x~111.9x | 111.1x~111.9x㎡ A~E | ✓(2590만 topAmount 84000, 나머지 85000 — 정확히 반영됨, 오연결 아님) |
| 2591 | 099.9350 (suffix 없음) | 131.833 | 131.83㎡ | ✓ |

목표로 제시된 예시("79.48㎡ B", "최고 분양가 5억 8,000만원", "비교
전용면적 약 59.63㎡", "비슷한 전용면적 58.63㎡ ~ 60.63㎡")와 실제 FIX
결과가 정확히 일치함을 브라우저로 직접 확인했다(스크린샷 기준 텍스트
동일).

## 추가 표본 검증 (§13 A~G 전 항목)

로컬 dev 서버로 8개 공고, 총 88개 주택형(id=479 12개 포함)을
`houseTypeDetailId` 기준 1:1 교차검증 — **오연결 0건**.

| 범주 | 표본 | 결과 |
|---|---|---|
| A. 주택형 많은 공고 | id=78(20개), id=156(20개) | 20/20, 20/20 매칭 |
| B. suffix 많은 공고 | id=479(A~F), id=8(A~F) | 매칭 |
| C. suffix 없는 공고 | id=156 다수, id=5, id=8 일부 | `houseTy`에 알파벳 없음 → suffix 빈 문자열 정상 처리 |
| D. 동일/유사 면적 여러 suffix | id=5 (80.88/80.94/81.28/80.77, A~D) | 서로 다른 라벨로 정확히 분리, 오연결 없음 |
| E. comparisons 없는 타입 | id=755, id=630 다수 | `comparisonAvailable:true`이지만 `comparisons:[]`, 라벨 정상 |
| F. 6개월 사례 | id=755 (`monthsSearched:6`) | 정상 |
| G. 24개월 fallback | id=479, id=847, id=630, id=900 (`monthsSearched:24`) | 정상 |

`supplyArea`가 `null`인 실제 행은 현재 DB 전체에 존재하지 않아(read-only
쿼리로 확인), "houseTy 원본 코드로 폴백" 경로는 코드 검토로만 확인했고
실데이터로는 트리거되지 않았다 — 한계로 명시한다.

## 계산 결과 무변경 확인

id=479의 FIX 전/후 `nearby-market` 응답을 `supplyArea` 필드만 제외하고
JSON 문자열로 비교 — **완전히 동일**(byte-identical)함을 스크립트로
확인했다. `houseTypes[].comparisons`(주변단지 목록·distance·buildYear·
recentTransactions·recentMedianPrice·differenceAmount)와
`monthsSearched`가 FIX 전후 전혀 바뀌지 않았다.

## 모바일 확인

이번 환경의 브라우저 자동화 도구는 실제 창 리사이즈(360/375/390px)가
동작하지 않는다 — B3 최초 구현(문서 19번) 때도 동일하게 확인된 도구
제약이다. 따라서 근사 검증으로 대체했다:

- CSS(`page.module.css`의 `.chip`/`.chipRow`)는 이번 STEP에서 **전혀
  수정하지 않았다** — `.chip`은 `white-space: nowrap` +
  `flex-shrink: 0`, `.chipRow`는 `overflow-x: auto` + `flex-wrap: nowrap`
  이미 적용되어 있어 텍스트 길이와 무관하게 줄바꿈이 일어나지 않는
  구조다.
- 실제 브라우저로 `/presales/479`를 로드해 스크린샷으로 확인한 결과,
  길어진 라벨(`79.48㎡ B`, `111.99㎡ C` 등)도 한 줄 pill 형태를
  유지하며 가로로 나열되고, 선택된 chip은 기존 `--primary-color`
  (#03c75a) 초록색을 그대로 유지했다. 뷰포트 폭 자체는 데스크톱
  해상도였지만(도구 제약), nowrap은 컨테이너 폭과 무관하게 항상
  적용되는 규칙이라 모바일 폭에서도 동일하게 동작할 것으로 판단한다 —
  다만 완전한 360/375/390px 뷰포트 스크린샷은 도구 제약으로 확보하지
  못했다.
- 사용자가 이미 실기기에서 "주택형 chip 가로 스크롤 정상"을 확인한
  바 있고, 이번 STEP은 그 CSS를 전혀 바꾸지 않았으므로 회귀 위험은
  낮다고 판단하나, 최종 확인은 사용자 실기기 재검수로 한다.

## FIX 전/후 요약

**FIX 전**: `[60㎡ B] [60㎡ D] [60㎡ C] [60㎡ F] ...` / 선택 시 "60㎡ B"

**FIX 후**: `[79.48㎡ B] [80.18㎡ D] [79.85㎡ C] [80㎡ F] ...` / 선택 시
"79.48㎡ B" + "비교 전용면적 약 59.63㎡" + "비슷한 전용면적 58.63㎡ ~
60.63㎡의 주변 아파트 실거래와 비교합니다."

## 회귀 검증

- `npx prisma validate` — 통과(schema 변경 없음)
- `npx prisma migrate status` — up to date
- `npx tsc --noEmit` — 오류 0
- `npx eslint`(변경 파일) — 오류 0
- `npm run build` — 성공, `/api/presales`, `/api/presales/[id]`,
  `/api/presales/[id]/nearby-apartments`, `/api/presales/[id]/nearby-market`,
  `/presales`, `/presales/[id]` 전부 기존과 동일하게 라우트 목록에 포함
- 로컬 dev 서버에서 4개 API(`/api/presales`, `/api/presales/479`,
  `/api/presales/479/nearby-apartments`, `/api/presales/479/nearby-market`)
  전부 200 확인, 기존 API consumer(B1/기존 상세) 무손상

## DB 영향

없음. schema/migration 변경 없음, DB 데이터 변경 없음(전부 read-only
조회로 검증).

## 후속

사용자 모바일 최종 검수 결과 이상 없음으로 확인되어, P2-D4-B3 및
P2-D4-B3-FIX 모두 완료 / 사용자 최종 승인으로 확정됐다(§최종 승인 기록
참고). B4(지도)는 별도 지시 전까지 착수하지 않는다.
