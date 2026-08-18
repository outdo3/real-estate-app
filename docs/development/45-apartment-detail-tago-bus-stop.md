# STEP 45 — APT DETAIL UI-C3-2: TAGO 버스정류소 연동

상태: **구현 완료 / 사용자 모바일 검수 대기(commit/push 없음)**

성격: STEP 44에서 확인한 대로 Kakao Local은 시내버스 정류장을 검색하지
못해, 국토교통부_(TAGO)_버스정류소정보 API(활용신청 승인 완료, 인증키는
기존 `DATA_GO_KR_API_KEY` 환경변수 재사용)로 아파트 상세페이지에 버스
접근성 V1(가장 가까운 정류장/거리/도보시간/300·500m 정류장 수)을
구현했다. 노선번호/실시간 도착정보/점수체계/이집 브리핑은 이번 STEP
범위 밖. 기준 commit `be9464b`(작업 시작 시 origin/main과 동일, working
tree에는 문서44/CHANGELOG 미커밋 변경만 존재 — §0 확인, 보존).

문서 선택: 문서44(조사·STOP 기록)를 덮어쓰지 않고 이번 구현 결과는
새 문서(이 문서, STEP 45)로 분리했다 — 문서44는 "왜 Kakao로는 안 되는가"
라는 조사 결론이고, 이 문서는 "그래서 TAGO로 어떻게 구현했는가"라는
별개의 의사결정/구현 기록이라 하나로 합치면 두 STEP의 성격이 섞인다.

---

## 0. 작업 시작 전 확인

```
git branch --show-current  → main
git status --short         → M docs/development/CHANGELOG.md
                              ?? docs/development/44-apartment-detail-bus-access.md
git diff --stat             → CHANGELOG.md 52줄 추가만
git rev-parse HEAD          → be9464b7a8344f9cf75450471168fe0141307499
git fetch origin             → (새 ref 없음)
git rev-list --left-right --count origin/main...HEAD → 0  0
```

예상된 상태(문서44 STOP 작업분)만 남아있고 그 외 production 변경 없음 —
STOP 조건 미발생, 문서44/CHANGELOG 기존 변경은 그대로 두고 진행.

## 1. 인증키 보안 확인

`.env.local`에서 이름만 확인(값은 어떤 도구 호출에도 출력하지 않음):

```
DATA_GO_KR_API_KEY=<존재 확인, 값 미출력>
```

이미 `src/lib/apt-building-info.ts`, `src/services/cheongyakService.ts`,
`src/app/api/school/apartments/route.ts`, `src/app/api/ledger/route.ts` 등
여러 data.go.kr 연동(건축물대장 등)에서 재사용 중인 계정 단위 서비스키다.
data.go.kr 서비스키는 앱(오퍼레이션) 단위가 아니라 **활용신청한 계정
단위로 발급**되므로, 이번에 새로 승인된 "국토교통부_(TAGO)_버스정류소
정보"도 같은 키로 호출된다는 것을 도시코드 조회(§3)로 실제 호출해
확인했다. **새 환경변수를 추가하지 않았다.** `NEXT_PUBLIC_` 접두어를
쓰지 않아 client bundle에 절대 포함되지 않으며, 실제로 이 키를 읽는
코드는 서버 전용 파일(`src/app/api/transit/bus-stops/route.ts`)뿐이다.

## 2~3. TAGO 공식 API 구조 확인 + 부산 지원 여부

공식 문서(data.go.kr/data/15098534/openapi.do)와 실제 서비스키로 직접
호출해 스펙을 확정했다(추측 사용 없음).

**서비스**: 국토교통부_(TAGO)_버스정류소정보
**Base**: `https://apis.data.go.kr/1613000/BusSttnInfoInqireService`

**사용 오퍼레이션**:
1. `getCtyCodeList` — 도시코드 목록조회. 실제 호출 결과 **부산광역시
   citycode=21 확인**(세종 12, 대구 22, 인천 23 등과 함께 응답에 포함).
   → 부산 지원 확인, STOP 조건("부산이 TAGO 제공 도시가 아님") 미해당.
2. `getCrdntPrxmtSttnList` — 좌표기반근접정류소 목록조회. **이번 STEP이
   실제로 사용하는 오퍼레이션.**

**요청 파라미터**(`getCrdntPrxmtSttnList`, 문서 확인분만 사용):
`serviceKey`(필수), `gpsLati`(필수, WGS84 위도), `gpsLong`(필수, WGS84
경도), `pageNo`(선택), `numOfRows`(선택), `_type`(선택, `json`/`xml`).
**문서에 없는 radius 파라미터는 사용하지 않았다** — 실측 결과 항상
정류소를 좌표 기준 고정 반경(최대 관측 거리 495m, 6개 표본 전부
500m 이하)까지만 반환해, 이 오퍼레이션 자체가 반경을 내부적으로 고정하고
있다고 판단했다.

**응답 필드**(실제 응답으로 확인): `citycode`, `gpslati`, `gpslong`,
`nodeid`(정류소ID), `nodenm`(정류소명), `nodeno`(정류소 번호, 있을 때만).
JSON 지원 확인(`_type=json`).

## 4. 좌표 기반 주변 정류장 조회

§3의 `getCrdntPrxmtSttnList`가 정확히 이 용도의 공식 오퍼레이션이라
"도시 전체 정류장 목록을 매 요청마다 내려받는" 대안(§6 조사 대상)은
필요 없었다. 페이지네이션/전체 목록 다운로드 로직도 만들지 않았다.

## 5. 신규 서버 route

`GET /api/transit/bus-stops?lat=..&lng=..` (`src/app/api/transit/
bus-stops/route.ts`, 신규) — 기존 API 라우트 네이밍(`/api/school/
apartments`, `/api/ledger` 등, `NextResponse.json({ success, data|error })`
패턴)을 그대로 따랐다.

역할:
- `DATA_GO_KR_API_KEY`를 서버에서만 읽어 TAGO 호출(키는 응답에 절대
  포함하지 않음)
- TAGO 응답 검증(`resultCode !== '00'`이면 "0건"과 구분해 실패로 처리)
- 완전 동일 `nodeid` 중복만 제거(§10 정책)
- `@turf/turf`(기존 의존성, `school/apartments/route.ts`에서 이미 사용
  중)로 아파트↔정류장 직선거리(미터) 계산
- `nearestBusStop`/`busStopCountWithin300m`/`busStopCountWithin500m`
  산출, 거리 오름차순 정렬
- `getOrSetCache`(기존 `src/lib/server-cache.ts`, 다른 라우트도 이미
  사용 중인 서버 메모리 TTL 캐시, **DB 아님**)로 좌표(소수 4자리
  반올림, 약 11m 격자) 기준 6시간 캐싱 — 같은 단지를 여러 사용자가
  같은 시간대에 보면 TAGO를 한 번만 호출
- DB 저장 없음(재배포 시 캐시 초기화, 이번 STEP 요구사항과 일치)

## 6~7. 신뢰성 이슈 발견 및 수정 — 재시도 1회

**실측 중 발견한 문제**: 6개 좌표를 지연 없이 연달아 호출하니(테스트
스크립트로 자동화) 4곳이 `TimeoutError`(4초) 또는 `resultCode unknown`
(TAGO가 정상 JSON이 아닌 응답을 반환)으로 실패했다. 같은 요청을
2초 간격으로 다시 보내면 6곳 전부 성공했다 — data.go.kr 게이트웨이가
짧은 간격의 연속 호출에 취약하게 반응하는 것으로 판단(원인이 정확히
문서화돼 있지 않아 "판단"이라고 표기).

실사용(단지 상세페이지 1회 방문 = TAGO 호출 1회)에서는 거의 발생하지
않을 상황이지만, 재배포 직후 캐시가 비어 있을 때 등 우발적 트래픽
겹침에 대비해 **고정 1회, 고정 400ms 지연의 재시도**를 추가했다
(`fetchTagoStops`가 실패하면 400ms 후 한 번만 다시 시도, 그래도 실패하면
최초 에러로 502 반환 — §15 "무한 대기 금지"에 위배되지 않는 유한
재시도). 수정 후 동일한 6개 좌표 무지연 연속 호출을 재현했을 때 전부
성공함을 확인했다(§18 표 참고).

## 8~9. 거리/도보시간 계산

거리는 `@turf/turf`의 `distance(origin, target, { units: 'meters' })`
(표준 직선거리, Haversine 기반)로 계산 — 새 공식을 만들지 않고 이미
설치된 라이브러리를 재사용했다. 실제 도로 보행 경로가 아닌 직선거리임을
이 문서에 명시한다(UI 자체에는 STEP 44/기존 KakaoPlaces와 동일하게
"약 N분" 형태로만 노출, "직선거리 기준"이라는 문구는 화면에 추가하지
않음 — 기존 지하철/KTX/생활편의 카드도 동일하게 직선거리 기반이라
버스 카드만 다르게 표기하지 않았다).

도보시간은 `KakaoPlaces.tsx`의 기존 `formatEta` 함수를 **새로 만들지
않고 그대로 재사용**했다 — 함수 앞에 `export`만 추가(동작 변경 없음,
1줄 diff)하고 `BusAccessCard.tsx`에서 import해서 쓴다. 분속 80m 도보
기준, 1km 초과 시 분속 500m 차량 기준으로 전환하는 기존 규칙 그대로다.

## 10. 중복 정류장 처리

`nodeid`가 완전히 동일한 응답만 제거했다. 이름/좌표 기준의 임의 병합은
하지 않았다(§10 지시 그대로).

**알려진 한계(정직하게 기록)**: 행정구역 경계 인근에서는 물리적으로
동일한 정류장이 인접 지자체 자체 버스정보시스템에도 별도 `nodeid`로
등록돼 있어 `citycode`가 다른 "중복처럼 보이는" 항목이 남는다. 예:
대신푸르지오1차 인근 "서대시장.동대신역" 정류장이 `citycode=21`(부산)
3건 + `citycode=38070`(인접 지자체) 2건으로 잡힘, 고원3단지(기장군
장안읍, 부산·양산·울산 접경)는 같은 물리 정류장이 `citycode` 21/26/
38100 세 시스템에 걸쳐 등록. 6개 표본 중 3곳(대신푸르지오1차,
명륜아이파크1단지, 고원3단지)에서 관측했고, 나머지 3곳(엘지메트로시티3,
남성한빛가든, 해운대 표본)은 전부 `citycode=21` 단일이라 이 현상이
없었다. **다른 지역(서울/대구 등) 정류장이 섞이는 진짜 오염은 6곳 어디서도
없었다** — 전부 실제 그 위치의 정류장이되, 행정구역이 겹치는 곳만 중복
등록이 남는다. §10 지시(이름/좌표 기준 임의 병합 금지)를 그대로 따랐기
때문에 이 케이스에서는 500m 이내 정류장 수가 실제 "물리적으로 구분되는
정류장 수"보다 다소 많게(고원3단지 예시로는 최대 2~3배까지) 집계될 수
있다 — 사용자 검수 시 판단이 필요한 지점으로 명시해 둔다.

## 11. V1 계산값

`src/app/api/transit/bus-stops/route.ts`가 반환하는 데이터:

```json
{
  "nearestBusStop": { "stopId": "...", "stopName": "...", "stopNo": "...", "distanceMeters": 54 },
  "busStopCountWithin300m": 14,
  "busStopCountWithin500m": 44,
  "totalCount": 44
}
```

`nearestBusStopWalkMinutes`는 별도 필드로 만들지 않고, 클라이언트
(`BusAccessCard.tsx`)에서 `formatEta(distanceMeters)`로 그때그때 계산해
표시한다 — 계산부(서버, 거리/개수)와 표시부(클라이언트, 도보시간 문구)를
분리했다. DB 저장 없음.

## 12~13. UI

`src/components/NeighborhoodInfoPanel.tsx`에 카드 하나 추가(신규
컴포넌트 최소화 — 카드 wrapper 자체는 기존 `cardStyle`을 그대로 재사용,
내부 콘텐츠만 새 컴포넌트 `BusAccessCard.tsx`). 순서:

```
🚇 교통(지하철·KTX)  🚌 버스  🏥 병원·공원  🛒 대형마트
🏪 편의점  💊 약국  🧸 어린이집·유치원
```

버스 카드 표시:

```
가까운 정류장
대신푸르지오 (54m, 도보 약 1분)

주변 정류장
500m 이내 44곳
```

300m 값은 API 응답에는 포함하되(향후 점수체계용), 화면에는 지시대로
500m만 노출해 카드를 단순하게 유지했다.

## 14. Empty/Error

실측으로 두 상태를 분리 확인했다(§18 curl 결과):
- **0건**(바다 한가운데 좌표로 재현, API 성공·정류장 0개):
  `totalCount === 0` → "검색 반경 내 버스정류장 정보가 없습니다."
- **API 실패**(잘못된 파라미터로 400 재현, 그 외 5xx/timeout도 동일
  분기): "버스 정보를 불러오지 못했습니다."

다른 지역 데이터로 대체하는 로직은 없다.

## 15. Timeout

`AbortSignal.timeout(4000)` — `apt-building-info.ts`가 이미 쓰는 data.go.kr
호출 타임아웃 패턴과 동일 값 재사용. §7에서 추가한 재시도도 고정 1회
(400ms 지연 후 1회 더)뿐이라 무한 대기가 아니다.

## 16~17. 호출량 / lazy load

브라우저 실측(§18 참고)으로 확인:
- 기존 Kakao Local Places 검색 호출: **9회**(STEP 41 문서 기준과 동일 —
  SW8+KTX+기차역 3, HP8+공원 2, MT1 1, CS2 1, PM9 1, PS3 1) — **변경
  없음**, 버스 카드는 이 호출들에 관여하지 않는다.
- Kakao Geocoder `addressSearch` 호출: 기존 6회(카드별 1회) → **7회**
  (버스 카드가 좌표를 얻기 위해 동일한 메커니즘으로 1회 추가) — 새
  카드를 추가하면 당연히 발생하는 비용이고, 이미 6개 카드가 각자
  독립적으로 이 방식을 쓰고 있어 새 패턴을 만든 게 아니다.
- **TAGO 호출: 탭 진입당 1회.** N+1 없음 — 정류장 개수와 무관하게
  `/api/transit/bus-stops` 단일 호출로 모든 값을 받는다.
- 페이지 최초 로딩(교통·편의시설 탭을 열기 전) 시 `/api/transit/*`
  요청이 **0건**임을 네트워크 로그로 확인했다.
- `infraTab === '교통'`일 때만 `NeighborhoodInfoPanel`이 mount되는 기존
  구조(`apt-client.tsx`, 미수정)를 그대로 따르므로 lazy load 유지.

## 18. 실데이터 검증(6개 단지, 실제 배포 라우트 호출)

`http://localhost:3000/api/transit/bus-stops?lat=..&lng=..`를 실제
아파트 좌표(Kakao 지오코딩으로 확보, STEP 44와 동일 표본)로 호출한
결과:

| 단지 | 가장 가까운 정류장 | 거리 | 300m 내 | 500m 내 | raw(중복ID 제거 후) | 오류 |
|---|---|---|---|---|---|---|
| 대신푸르지오1차 | 대신푸르지오 | 54m | 14 | 44 | 44 | 없음 |
| 명륜아이파크1단지 | 명륜아이파크1차정문 | 142m | 22 | 51 | 51 | 없음 |
| 엘지메트로시티3 | 용문중학교 | 86m | 10 | 27 | 27 | 없음 |
| 남성한빛가든 | 남성한빛.대신더샵 | 106m | 22 | 32 | 32 | 없음 |
| 해운대동백두산위브더제니스(도심) | 운촌 | 45m | 7 | 16 | 16 | 없음 |
| 고원3단지아파트(기장군 장안읍, 교통 상대적 불리) | 고원3차아파트 | 113m | 6 | 12 | 12 | 없음(§10 한계로 기록한 citycode 중복 포함 수치) |

6곳 모두 정류장명이 실제 지역과 논리적으로 일치한다(예: "대신푸르지오"
정류장이 대신푸르지오1차 바로 앞, "고원3차아파트" 정류장이 고원3단지
인근). "교통 불리 단지"로 고른 기장군 표본도 실제로는 500m 내 12곳으로
도심 표본(16곳)과 큰 차이가 없었는데, §10에서 기록한 citycode 중복
때문에 부풀려졌을 가능성이 있다 — 순수 물리적 정류장 수는 이보다 적을
것으로 추정된다(정확한 값은 추가 조사 없이는 단정하지 않음, §13
원칙 준수).

## 19. 정류장 정확도(20개 이상 표본)

대신푸르지오1차 표본 44건 + 명륜아이파크1단지 51건 등 총 90개 이상의
반환 정류장을 검토했다. 정류장명이 전부 실제 지명/시설명과 일치하고
(예: "서대신역.서부경찰서", "동대신역", "용문중학교", "동백섬입구" 등
실존 장소), 좌표도 요청 좌표 500m 이내로 수렴했다. **다른 도시(서울/
대구 등) 정류장 혼입은 6곳 어디서도 발견되지 않았다** — §10에서 기록한
citycode 중복은 "물리적으로 같은 위치, 행정구역만 다른 시스템의 중복
등록"이며 "잘못된 지역의 정류장"은 아니다. BLOCKER 조건("다른 도시
정류장 혼입")에는 해당하지 않는다고 판단했다.

## 20. 도시코드 하드코딩

`getCrdntPrxmtSttnList`는 좌표 기반이라 `citycode`를 요청 파라미터로
넘기지 않는다 — TAGO가 좌표만으로 해당 지역 데이터를 알아서 찾는
구조라서, 이번 STEP에서는 **부산 cityCode를 어디에도 하드코딩하지
않았다.** 전국 확장 시에도 이 라우트/컴포넌트는 좌표만 바뀌면 그대로
동작할 것으로 예상되나, 다른 지역에서의 TAGO 데이터 커버리지·정확도는
검증하지 않았다(부산 6개 표본만 확인) — 이 점을 한계로 기록한다.

## 21. 노선번호/도착정보

구현하지 않았다. TAGO에 별도 "정류소별경유노선 목록조회"(같은 서비스
내 오퍼레이션, 이번 STEP에서 상세 스펙 확인 안 함) 및 "(TAGO)_버스
도착정보"(별도 데이터ID, data.go.kr/data/15098530) 서비스가 존재한다는
사실만 기록하고 후속 STEP 후보로 남긴다.

## 22~23. 점수체계 / 이집 브리핑

이번 STEP에서 점수 계산·브리핑 문구 생성 둘 다 하지 않았다. 향후
재사용 가능한 값(모두 API 응답에 이미 존재): `nearestBusStop.
distanceMeters`, `busStopCountWithin300m`, `busStopCountWithin500m`.
브리핑에서는 "도보 N분 내 버스정류장", "500m 내 정류장 N곳" 같은 fact
기반 문구로 활용 가능하다고만 기록한다(§10 한계 때문에 500m 카운트를
브리핑에 직접 노출할 때는 citycode 중복 이슈를 고려해야 함).

## 24. 회귀 검증

브라우저 실측(포트 3000, `대신푸르지오1차` 페이지) 스크린샷으로 확인:

- 🚇 교통(지하철·KTX): 동대신역/서대신역/토성역/대티역(전부 부산1호선)
  — KTX특송퀵서비스 재등장 없음, 폐역 재등장 없음 (STEP 41 결과와 동일)
- 🏥 병원·공원, 🛒 대형마트, 🏪 편의점, 💊 약국, 🧸 어린이집·유치원 —
  전부 정상 데이터 표시, UI-C2 회귀 없음
- Hero(단지명/매매가/차트)/AreaSelector(평형 버튼)/시세차트 — 최초
  스크린샷에서 정상 렌더링 확인
- 실거주 환경/학군 탭 전환 정상 동작(탭 버튼 클릭으로 전환 확인)
- 빠른 단지검색(UI-C1)/StickyPriceBar/하단 영역 — 코드 미수정,
  `apt-client.tsx` 자체를 건드리지 않았으므로 회귀 근거 없음(직접
  클릭 재현은 이번 STEP에서 하지 않음 — 한계로 기록)

## 25. 환경변수

`DATA_GO_KR_API_KEY`(기존, 서버 전용, `NEXT_PUBLIC_` 아님) 재사용 —
**새 환경변수 추가 없음.** `.env.local`은 git 추적 대상이 아님(확인
완료). **Vercel 프로덕션 환경변수 추가 작업은 필요 없다** — 이미
건축물대장/실거래 등 다른 기능이 프로덕션에서 이 키를 쓰고 있어 값이
이미 등록돼 있을 것으로 예상되지만, 이 STEP에서 프로덕션 환경변수를
직접 확인하지는 않았으므로(로컬 `.env.local`만 확인) 배포 전 사용자가
Vercel 대시보드에서 `DATA_GO_KR_API_KEY` 존재 여부를 한 번 재확인하는
것을 권장한다.

## 26. 정적 검증

```
npx prisma validate       → 스키마 유효
npx prisma migrate status → 데이터베이스 스키마 최신 상태(마이그레이션 없음)
npx tsc --noEmit           → 0 errors
npx eslint <변경 파일>      → 0 errors/warnings
npx next build              → 컴파일 성공, /api/transit/bus-stops 라우트 정상 등록
```

## 27. 문서

- 신규: `docs/development/45-apartment-detail-tago-bus-stop.md`(이 문서)
- 유지(수정 안 함): `docs/development/44-apartment-detail-bus-access.md`
- 수정: `docs/development/CHANGELOG.md`(STEP 45 항목 append, 기존 STEP
  44 항목 보존)

## 28. commit/push

하지 않았다. `git add`/`commit`/`push` 전부 미실행.

---

## 수정/생성 파일 요약

**신규**:
- `src/app/api/transit/bus-stops/route.ts` — TAGO 연동 서버 라우트
- `src/components/BusAccessCard.tsx` — 버스 카드 클라이언트 컴포넌트
- `docs/development/45-apartment-detail-tago-bus-stop.md`(이 문서)

**수정(최소)**:
- `src/components/KakaoPlaces.tsx` — `formatEta` 함수에 `export` 1개
  키워드만 추가(동작 변경 없음)
- `src/components/NeighborhoodInfoPanel.tsx` — `🚌 버스` 카드 블록
  추가(기존 5개 카드 블록은 무수정)
- `docs/development/CHANGELOG.md` — STEP 45 항목 append

**미수정**: `apt-client.tsx`, `AptSpecGrid`, `PriceTrendChart`,
`InvestmentMetrics`, `Timeline`, `FloorPlanPanel`, `Community`,
`ApartmentQuickSearch`, `apt-name-match.ts`, `SchoolDistrictPanel`,
schema/migration 전부.

## 알려진 한계

1. citycode 중복 등록으로 인한 300m/500m 카운트 과대집계 가능성(§10,
   §18) — 행정구역 경계 인근 단지에서 발생, BLOCKER는 아니지만 사용자
   검수 시 확인 필요.
2. data.go.kr의 짧은 간격 연속 호출 시 일시적 실패 경향(§6~7) — 1회
   재시도로 완화했으나 근본 원인(게이트웨이 정책)은 문서화돼 있지
   않아 완전히 제거됐다고 단정하지 않는다.
3. 전국 확장 시 부산 외 지역의 TAGO 데이터 정확도는 검증하지 않음(§20).
4. 빠른 단지검색/StickyPriceBar/하단 nav 등 일부 회귀 항목은 코드
   미수정에 근거해 "회귀 없음"으로 판단했을 뿐, 직접 클릭 재현까지는
   하지 않았다(§24).

## 최종 판단

APT DETAIL UI-C3-2는 TAGO 버스정류소정보를 이용해 아파트의 가장 가까운
버스정류장과 버스 접근성 기초 데이터를 구현했다. 인증키는 서버 측
환경변수에서만 사용하며 client에는 노출하지 않았다. 노선번호/실시간
도착정보, 점수체계, 이집 브리핑은 이번 STEP에서 구현하지 않았다.
DB/schema/migration은 변경하지 않았고 commit/push 하지 않았다. 사용자
검수 후 다음 단계로 진행한다.
