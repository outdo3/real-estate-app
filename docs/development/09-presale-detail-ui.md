# 이집 분양 상세 서비스 — P2-D3

작성일: 2026-08-13
성격: `/presales/[id]` 상세페이지 실제 구현(UI 실 구현, 신규 API 추가). P2-D1 최종 결정(URL `/presales/[id]`, DB PK 기반)과 P2-D2 목록 구조를 그대로 따름.

---

## 1. 상세 URL

`/presales/[id]` — `Presale.id`(DB Primary Key) 기반. 분양명·`houseManageNo`를 URL 식별자로 쓰지 않음(P2-D1 §N-1 결정, `apt/[name]`의 이름 기반 라우팅 충돌 이력을 반복하지 않기 위함).

## 2. 상세 API

`GET /api/presales/[id]` (`src/app/api/presales/[id]/route.ts`, 신규)

- 응답: `{ success, data: { ...Presale 전체 필드, status, houseTypeDetails: [...] } }`
- `houseTypeDetails`는 `presale.houseTypeDetails` relation을 `modelNo asc`로 정렬해 포함
- `status`는 목록 API와 동일하게 `computePresaleStatus()`로 매 요청마다 계산(로직 수정 없음)
- id가 정수가 아니면 `400`, 존재하지 않으면 `404`, 그 외 서버 오류는 `500` — `/api/community/posts/[id]`의 기존 패턴을 그대로 재사용

## 3. 화면 구조

`src/app/presales/[id]/page.tsx`(서버, `generateMetadata`에서 실제 `prisma.presale.findUnique`로 DB 데이터를 조회해 title/description 생성 — `community/[id]/page.tsx`의 기존 패턴 재사용, Prisma 조회는 `try/catch`로 방어) + `presale-detail-client.tsx`(클라이언트, `useSWR`).

섹션 순서(모바일/PC 동일 우선순위): A. 상단 핵심요약 → B. 청약 일정 → C. 주택형·분양가 → D. 사업정보 → E. 위치정보 → F. 청약홈 CTA.

## 4. 상단 핵심정보

공고명(H1) / 상태배지 + 지역(한 줄) / 분양가(범위 또는 단일) + "최고 분양가 기준" 캡션 / 총공급세대 + 입주예정월(한 줄). 긴 공고명(30자 이상)도 `word-break: keep-all`로 줄바꿈 처리.

## 5. 상태 표시

목록과 동일한 한국어 라벨(접수중/접수예정/접수마감/무순위(잔여세대))을 그대로 재사용. `computePresaleStatus()` 로직은 수정하지 않음.

## 6. 가격 표시

`min === max`면 단일 가격, 다르면 범위, 둘 다 null이면 "가격 미공개" — 목록 페이지와 동일한 변환 규칙(만원→억+만원). 주택형별 `topAmount`도 동일한 변환 함수 사용.

## 7. 청약일정

`announcementDate`(모집공고) / `receiptStartDate~receiptEndDate`(청약접수) / `winnerDate`(당첨발표) / `contractStartDate~contractEndDate`(계약기간) / `moveInExpectedYm`(입주예정) 5개 행. 값이 없는 행(시작·종료일 둘 다 없거나 단일 날짜가 없음)은 목록에서 제외한다(요청안의 "숨기거나 정보없음 처리" 중 숨기는 방식 채택 — 실측 결과 날짜 필드는 대부분 100% 확보돼 있어 실사용에서 행이 숨겨지는 경우는 드묾). 날짜는 원본 ISO 문자열의 날짜 부분만 그대로 잘라 `YYYY.MM.DD`로 표시(타임존 변환 없이 결정론적으로 처리).

## 8. 주택형 UX

P2-D1 §H-2 결정대로 `<details>/<summary>` 네이티브 아코디언으로 구현(별도 상태관리 없이 접근성·시맨틱 확보). 접었을 때 요약: `{면적}㎡ {타입} · 공급 {N}세대 · 최고 {가격}`. 펼치면 일반공급/특별공급/총공급/최고 분양가/원본 주택형 코드 5행. `houseTypeDetails`가 0건인 공고는 "주택형 정보가 없습니다."로 표시(존재 자체를 가정하지 않음).

## 9. HOUSE_TY 표시 방식

면적 숫자는 `houseTy` 원본 문자열을 파싱하지 않고, 이미 ㎡ 단위로 저장돼 있는 `supplyArea` 컬럼을 그대로 사용한다(P2-A에서 이미 검증·확정된 필드). `houseTy`(예: `"055.9700A"`)에서는 끝 영문자만 정규식으로 추출해 타입 라벨(예: "A")로만 사용하고, 원본 코드 전체는 아코디언 펼침 영역에 "원본 주택형 코드"로 그대로 병기해 원본값을 훼손하지 않는다. `supplyArea`가 없는 경우에만 `houseTy` 원본을 그대로 노출(임의 환산 없음).

## 10. 공급면적 표시

`supplyArea`(㎡, P2-A에서 이미 확정된 단위)를 그대로 `{n}㎡` 형식으로 표시. 단위를 추측하거나 평형으로 임의 환산하지 않음.

## 11. 공급세대 표시

`generalSupply`/`specialSupply`/`totalSupply`를 그대로 표시하되 `0`(실제 값)과 `null`(정보 없음)을 명확히 구분한다(`!= null` 체크). `totalSupply`는 API 원본이 아니라 두 값의 합산 필드이므로, 상위 `Presale.totalSupplyHouseholds`와 자연히 다를 수 있음(기존 P2-B 정책 유지) — UI에서 두 값을 억지로 일치시키거나 혼용하지 않는다(상단 요약에는 `totalSupplyHouseholds`만, 아코디언 내부에는 `totalSupply`만 사용).

## 12. 사업정보

`constructCompany`/`businessEntityName`/`houseSecdName`/`rentSecdName`을 표시하며, null이면 "정보 없음"으로 명시(빈 문자열/공백으로 위장하지 않음). `constructCompany` 2% 미확보 사례(id=105 등)로 실측 검증함.

## 13. 위치정보 처리

`MapViewer.tsx`(Kakao Maps SDK)는 `/map` 페이지에서만 스크립트가 로드되고 있어, 상세페이지에 그대로 임베드하면 스크립트 로딩 로직을 새로 추가해야 함을 확인했다. "이번 STEP에서 대규모 지도 기능을 만들지 않는다"는 원칙에 따라, 인터랙티브 지도 대신 **위치 카드**(주소 텍스트 + 좌표 있을 때만 "카카오맵에서 보기 ↗" 외부 링크)로 최소 구현했다. 좌표가 없으면 "정확한 위치정보 준비 중"만 표시하고 임의 좌표를 생성하지 않는다. 실제 인터랙티브 지도 임베드는 P2-D4에서 결정한다.

## 14. 청약홈 CTA

`pblancUrl`이 있으면 하단에 "청약홈에서 모집공고 보기 ↗" 버튼(새 탭, `noopener noreferrer`)을 배치. 100% 확보된 필드라 조건부 렌더는 방어적 차원.

## 15. 목록 카드 클릭 변경

`presales-client.tsx`의 카드에 `role="button"`/`onClick`(→ `router.push('/presales/${id}')`)을 추가해 카드 전체를 클릭 가능하게 변경했다. 카드 내부 "청약홈에서 공고 보기" 링크는 `onClick={(e) => e.stopPropagation()}`로 이벤트 충돌을 막아, 링크 클릭 시 새 탭만 열리고 카드 자체의 상세 이동은 발생하지 않음을 실측 확인했다.

## 16. Loading/Error/404

- Loading: "상세 정보를 불러오는 중입니다..."
- 404(id는 정상이나 데이터 없음): "분양정보를 찾을 수 없습니다." + "분양정보 목록으로 돌아가기"(`Link`) 링크
- 400(잘못된 id 형식): "⚠️ 잘못된 분양정보 id입니다."
- 500(서버 오류): "⚠️ 분양정보를 불러오지 못했습니다."

세 메시지가 서로 다른 문자열이라 사용자·검수자 모두 원인을 구분할 수 있다.

## 17. 뒤로가기 UX

별도 컴포넌트를 새로 만들지 않고, 이 프로젝트 전역에 이미 있는 `Header`의 `←`(`router.back()`) 버튼을 그대로 재사용했다(`apt/[name]`, `community/[id]`, `school/[id]`와 동일한 기존 관례). 필터 상태 복원은 구현하지 않았다 — 뒤로가기 시 `/presales`가 새로 마운트되며 지역/상태/가격 필터는 초기화된다(요청안 §17 "복잡한 상태 저장 구현까지는 무리하지 않는다"를 그대로 따른 의도적 범위 제한, 알려진 한계로 기록).

## 18. metadata

`generateMetadata()`가 실제 `prisma.presale.findUnique`로 조회한 `houseName`/`subscriptionAreaName`/`minPrice`/`maxPrice`/`receiptStartDate`/`receiptEndDate`로 title/description을 생성한다. 존재하지 않는 id는 "분양정보를 찾을 수 없습니다 - 이집"으로 대체(가짜 문구 생성 없음). `buildOpenGraph()`로 기존 OG 패턴 재사용. canonical/구조화 데이터/sitemap은 P2-D5로 유보.

## 19. 테스트 결과

### API(로컬, 실제 DB 데이터 기준)
| 시나리오 | id | 결과 |
|---|---|---|
| 일반 APT + 좌표 있음 | 34(두산위브더제니스 대연) | 200, 5개 주택형, `latitude` 존재 |
| 신혼희망타운 + 좌표 없음 | 39 | 200, `latitude: null` |
| `minPrice === maxPrice` | 88 | 200, `35800 === 35800` |
| `minPrice !== maxPrice` | 1 | 200, `79831 / 81214` |
| `constructCompany` null | 105 | 200, `constructCompany: null` |
| 주택형 최다(20개) | 78(판교TH212) | 200, `houseTypeDetails.length === 20` |
| 존재하지 않는 id | 101046 | 404, "분양정보를 찾을 수 없습니다." |
| 잘못된 id 형식 | abc | 400, "잘못된 분양정보 id입니다." |

### 브라우저(Chrome, localhost)
- id=78(주택형 20개): 상단 요약/청약일정 5행/아코디언 20개 전부 정상 렌더, 아코디언 클릭 시 일반공급 6세대·특별공급 0세대(0과 null 구분됨)·총공급·최고분양가·원본코드 정상 펼침 확인
- id=105: "시공사: 정보 없음", "정확한 위치정보 준비 중" 정상 확인
- id=34: "카카오맵에서 보기 ↗" 링크 좌표 있을 때만 노출 확인
- id=101046: 404 상태 + "분양정보 목록으로 돌아가기" 링크, 탭 타이틀 "분양정보를 찾을 수 없습니다 - 이집" 확인
- `/presales/abc`: "⚠️ 잘못된 분양정보 id입니다." 확인
- 목록 카드 클릭 → `/presales/1` 이동 확인(탭 타이틀에 실제 houseName 반영된 것도 확인)
- 카드 내부 "청약홈에서 공고 보기" 클릭 → 새 탭(`applyhome.co.kr`)만 열리고 원래 탭은 `/presales`에 그대로 유지됨을 확인(이벤트 충돌 없음)
- Header `←` 버튼 클릭 → `/presales` 목록으로 정상 복귀 확인

### 알려진 한계
- 필터 상태 복원 미구현(§17)
- 인터랙티브 지도 미구현, 위치 카드로 대체(§13) — P2-D4에서 재검토

## 20. TypeScript / lint / build

- `npx tsc --noEmit`: 오류 없음
- `npm run lint`: 최초 실행 시 `no-html-link-for-pages` 오류 1건 발견(404 상태의 "목록으로 돌아가기"가 `<a href>`였음) → `next/link`의 `Link`로 교체 후 재실행, 오류 0. 경고 5건은 이번 변경과 무관한 기존 파일
- `npm run build`: 성공, `/presales/[id]`가 동적(ƒ) 라우트로 정상 포함, `/api/presales/[id]`도 정상 포함

## 21. P2-D4 연결 사항

- 위치정보를 카드 링크 대신 실제 인터랙티브 지도(Kakao Maps SDK)로 교체할지 결정
- "이 지역 최근 실거래" 등 P2-D1 §K-2/§L에서 검토한 지역 단위 비교 기능
- 상세 필터(P2-D2에서 보류된 입주예정연도/공급유형/주택유형/공급세대규모) 재검토
