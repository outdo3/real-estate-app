# 이집 분양 목록 서비스 — P2-D2

작성일: 2026-08-13
성격: `/presales` 사용자 목록 페이지 실제 구현(UI 실 구현, API 최소 확장). P2-D1 설계(`07-presale-ui-ux-design.md`)의 최종 결정을 그대로 따름.

---

## 1. 구현 구조

- `src/app/presales/page.tsx` — 서버 컴포넌트, `generateMetadata`만 담당(`apt/[name]/page.tsx`와 동일한 기존 패턴 재사용)
- `src/app/presales/presales-client.tsx` — 클라이언트 컴포넌트, `useSWR`로 `/api/presales` 조회, 필터/카드목록/페이지네이션 렌더
- `src/app/presales/page.module.css` — 기존 CSS 변수(`--primary-color`, `--radius-*`, `--shadow-card` 등)와 커뮤니티/재개발 페이지의 카드·페이지네이션 패턴을 재사용
- `src/app/api/presales/route.ts` — 기존 `GET` 핸들러 확장(재작성 아님, `computePresaleStatus()` 등 기존 로직 그대로 유지)
- `src/app/redevelopment/redevelopment-client.tsx`, `redevelopment.module.css` — "분양·청약" 탭의 정적 안내 카드 하단에 `/presales`로 가는 링크 1줄만 추가(기존 탭 구조·로직 변경 없음)

## 2. API 변경사항

기존 `GET /api/presales`는 실제로 호출하는 프론트가 코드상 전혀 없었음(문서에서만 언급)을 사전에 확인해, 응답 구조를 안전하게 확장했다.

### 추가된 쿼리 파라미터
| 파라미터 | 설명 |
|---|---|
| `page` | 1부터 시작, 기본 1 |
| `region` | `subscriptionAreaName` 정확 매치(시/도 단위) |
| `priceMax` | `30000`/`50000`/`70000`/`100000`/`over`(만원 단위, `maxPrice` 기준) |
| `status`(기존) | `upcoming`/`ongoing`/`closed`/`unsold` |

### 응답 구조 변경
```
이전: { success, data: Presale[] }
이후: { success, data: { items, total, page, pageSize, totalPages, regions } }
```
`regions`는 `subscriptionAreaName` 기준 `groupBy` 실측 결과(하드코딩 없음) — 지역 필터 옵션을 실제 DB 데이터로만 구성한다.

## 3. Pagination 정책

`pageSize = 20`(고정, 기존 `/api/community/posts`와 동일). `region`/`priceMax`는 DB `where` 절에서 걸러내고, `status`는 기존과 동일하게(날짜 기반 계산값이라 컬럼이 아님) 전체를 읽어와 JS에서 계산·필터한 뒤 메모리에서 페이지네이션한다. 현재 규모(1,046건)에서는 이 방식이 무리 없다는 기존 API의 전제를 그대로 유지했다.

## 4. 정렬 정책

상태 우선순위(`접수중` → `접수예정` → `접수마감` → `무순위`) 정렬 후, 같은 그룹 내에서는 `receiptStartDate desc`(기존 정렬 유지). 실측(2026-08-13) 기준 접수중 0건/접수예정 7건이므로, 이 7건이 항상 목록 최상단에 노출된다. P2-D1 §F 결론(상태를 과도하게 세분화하지 않음)을 그대로 유지하면서, "지금 청약 가능한 공고가 과거 아카이브에 묻히지 않아야 한다"는 §C-2 니즈를 정렬로 해결했다.

## 5. 필터 정책

1차 필터 3종(P2-D1 §E-1 그대로 채택):
- **지역**: `regions` facet(API가 실시간 `groupBy`로 산출) 기반 select, 시/도 단위(예: "경기", "서울")
- **상태**: 접수중/접수예정/접수마감/무순위(잔여세대) — 내부 코드값 비노출
- **가격**: 3억 이하/5억 이하/7억 이하/10억 이하/10억 초과, `maxPrice`(최고 분양가) 기준

가격 구간은 구현 전 실측 분포(총 1,046건)로 재검증했다: ~3억 45 / ~5억 174 / ~7억 306 / ~10억 233 / 10억초과 288 — 요청안 예시 구간이 실 데이터로도 적절함을 확인 후 그대로 채택했다.

상세 필터(입주예정연도/공급유형/주택유형/공급세대규모)는 이번 STEP에서 구현하지 않았다 — §7로 후속 확장 후보로 남긴다.

## 6. 가격 표시 정책

`minPrice`/`maxPrice`(만원 단위 원본)를 그대로 두고 화면에서만 변환:
- `min === max`: `7억 9,831만원`처럼 단일 표시
- `min !== max`: `4억 4,555만원 ~ 4억 4,812만원`
- 둘 다 null: `가격 미공개`(현재 1,046건 전량 확보돼 실제로는 발생하지 않지만 방어 로직 포함)

## 7. 상태 라벨

내부 코드값 → 한국어 라벨 매핑:
`ongoing`→접수중, `upcoming`→접수예정, `closed`→접수마감, `unsold`→무순위(잔여세대). `computePresaleStatus()` 로직 자체는 수정하지 않았다.

## 8. 카드 구조

공고명(2줄 ellipsis) / 상태배지+지역(한 줄) / 분양가 / 총공급세대+입주예정월(한 줄) / "청약홈에서 공고 보기 ↗"(외부 링크, `target=_blank`). `constructCompany`(98%만 확보) 등은 카드에 넣지 않고 상세페이지(P2-D3) 몫으로 남겼다.

## 9. 카드 클릭 정책

`/presales/[id]` 상세페이지가 아직 없으므로 카드 자체는 클릭 비활성(존재하지 않는 라우트로 보내지 않음). 대신 각 카드 하단에 `pblancUrl`(청약홈 원문) 링크만 CTA로 제공한다. **P2-D3에서 상세페이지가 생기면 카드 클릭을 `router.push('/presales/[id]')`로 교체할 예정** — `presales-client.tsx`의 카드 렌더 부분을 수정하면 된다.

## 10. `/redevelopment` 연결

"분양·청약" 탭(기존 100% 정적 안내 카드)의 문구 아래에 "분양정보 전체 보기 →"(`/presales`) 링크 1줄만 추가했다. 탭 구조, "재개발" 탭, 기존 안내 문구는 전혀 건드리지 않았다.

## 11. Loading/Empty/Error

- Loading: "목록을 불러오는 중입니다..."
- Empty: "조건에 맞는 분양정보가 없습니다."
- Error: "분양정보를 불러오지 못했습니다."(API 실패시 `success: false` 응답을 그대로 노출, 빈 데이터로 위장하지 않음)

## 12. 모바일/PC 처리

`page.module.css`는 모바일 기본(카드 1열, 필터 `flex-wrap`)에서 시작해 `min-width: 768px`(2열)/`1024px`(3열)로 확장하는 기존 코드베이스 관례(`globals.css`, `community/page.module.css`)를 그대로 재사용했다. 카드 타이틀은 `-webkit-line-clamp: 2`로 긴 공고명 대응, 지역 텍스트는 ellipsis 처리해 가로 스크롤을 방지했다.

## 13. 테스트 결과

### API (curl, 실제 DB 데이터 기준)
| 테스트 | 결과 |
|---|---|
| 기본 조회 | `total=1046`, `pageSize=20` 정상 |
| `page=2` | 정상, 20건 반환 |
| `region=세종` | `total=7`, `regions.length=17` 정상 |
| `status=upcoming` | `total=7`, 전부 `upcoming` 정상 |
| `status=ongoing` | `total=0`(정상 — 실제 데이터에 접수중 0건) |
| `priceMax=30000` | `total=45`(사전 분포 조사와 일치) |
| `priceMax=over` | `total=288`(사전 분포 조사와 일치) |
| `region=서울&priceMax=30000`(복합) | `total=0`, `success:true`(오류 아닌 정상 빈 결과) |
| `status=bogus`(잘못된 값) | `400` 반환 |
| `priceMax=bogus`(잘못된 값) | `400` 반환 |
| `page=999`(범위 밖) | `success:true`, `page`를 `totalPages`(53)로 clamp |
| 매치 없는 지역 | `success:true`, `total=0`(빈 배열, 에러 아님) |

### 브라우저(Chrome, `localhost:3000`)
- `/presales` 최초 로드, 카드/배지/가격/필터 정상 렌더 확인(스크린샷)
- 상태 필터 `접수중` 선택 → "검색 결과 0건" + Empty state 정상 표출 확인
- 지역 필터 `경기` 선택 → `검색 결과 365건`으로 즉시 갱신, 카드 전부 "경기" 태그 확인, 페이지 1로 리셋 확인
- 페이지네이션 "다음" 클릭 → 2페이지 카드로 정상 전환(`1/19` 표시, 365÷20=19페이지 일치)
- `/redevelopment` "분양·청약" 탭 → "분양정보 전체 보기 →" 링크 클릭 → `/presales` 정상 이동 확인, "재개발" 탭은 변경 없음 확인

### 알려진 한계
- 이번 세션의 브라우저 자동화 도구(`resize_window`)가 실제 렌더 뷰포트를 축소하지 못해(원격 세션 제약으로 추정), **360~390px 모바일 화면의 실제 스크린샷 검증은 하지 못했다.** 대신 CSS를 코드 리뷰로 검증했다 — 카드 grid 기본 1열, 필터 `flex-wrap`, 타이틀 2줄 ellipsis, 지역 텍스트 ellipsis 등 이 프로젝트가 이미 다른 페이지(`community`, `globals.css`)에서 실사용 중인 모바일 우선 패턴을 그대로 재사용했으므로 위험도는 낮다고 판단하지만, **실기기/디바이스 툴바를 통한 육안 확인은 검수 단계에서 별도로 권장**한다.
- 청약홈 외부 링크(`pblancUrl`) 클릭 후 실제 청약홈 사이트 도달 여부는 이번 테스트에서 실제 클릭까지는 하지 않았다(외부 정부 사이트로의 불필요한 접근을 피함). `pblancUrl`은 P2-A/B 단계에서 이미 100% 확보·검증된 필드라 링크 자체는 신뢰할 수 있다.

## 14. TypeScript / lint / build

- `npx tsc --noEmit`: 오류 없음
- `npm run lint`: 오류 0, 경고 5(전부 이번 변경과 무관한 기존 파일 — `prisma/seed.js`, `scripts/fetchData.js`, `ai-search-client.tsx`, `apt-client.tsx`, `ViewTracker.tsx`의 기존 `eslint-disable` 관련 경고)
- `npm run build`: 성공, `/presales`가 정적(○) 페이지로 생성됨, `/api/presales`는 동적(ƒ) 라우트로 정상 포함

## 15. P2-D3 연결 사항

- 카드 클릭 정책을 `/presales/[id]`로 교체(§9)
- 상세 필터(입주예정연도/공급유형/주택유형/공급세대규모) 도입 검토
- 상세페이지 구현 시 이번 목록 API의 `items` 응답 필드(이미 전체 `Presale` 컬럼 포함)를 그대로 참고 가능
