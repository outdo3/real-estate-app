# STEP 34 — MAP INITIAL LOAD AUDIT: 예상 외 지역 최초 진입 시 구형 지도 UI 노출 조사

상태: 조사 완료 / production 코드 변경 없음 / commit·push 없음

성격: 조사 전용(코드/CSS/API/DB/schema 변경 없음). 기준 commit
`c9919f36ec1cd02b0c4b1e450868144daf9fe6d4`(origin/main과 동일, working tree는
문서33 관련 미커밋 변경만 존재 — §0 확인).

---

## 0. 작업 시작 전 확인

```
git status --short        → M docs/development/CHANGELOG.md (문서33 관련, 기존)
                             ?? docs/development/33-...md (기존)
git rev-parse HEAD         → c9919f36ec1cd02b0c4b1e450868144daf9fe6d4
git fetch origin           → (no new refs)
git rev-parse origin/main  → c9919f36ec1cd02b0c4b1e450868144daf9fe6d4
git rev-list --left-right --count origin/main...HEAD → 0  0
```

local == origin/main, 기존 미커밋 변경(문서33)은 보존. 이번 STEP은 이 문서 생성 +
CHANGELOG에 STEP 34 항목만 추가.

## 1. 사용자 신고 현상

시골(비수도권, 사용자가 평소 쓰지 않는) 지역에서 실제 모바일 기기로 앱을 최초 실행 →
첨부 스크린샷과 같이 상단 가로 pill 탭("← 메인으로 / 단지 / 학교 / 재개발 / 경매") +
"이 지역에서 재검색" + "내 위치" 버튼이 있는 **구형 지도 UI**가 표시됨. 이후 홈으로
이동했다가 다시 지도에 들어가니 현재 최신 UI(우측 세로 카테고리 필, 하단 5메뉴 탭바,
드래그 종료 시 자동 재조회)로 정상 표시됨.

## 2. 구형 UI 코드 존재 여부

전체 저장소에서 스크린샷 문구를 전수 검색:

| 검색어 | 결과 |
|---|---|
| `메인으로` | `src/app/map/page.tsx` **주석에만** 존재(코드 676행 근처: `"메인으로" 버튼은 제거`) |
| `이 지역에서 재검색` | `src/app/map/page.tsx` **주석에만** 존재(582-585행: `"이 지역에서 재검색" 버튼을 거치던 이전 방식은...`) |
| `내 위치` | `src/app/map/page.tsx`(현재 UI에도 존재, 상단 검색창 옆 버튼) + `src/components/MapViewer.tsx`(분양 상세페이지용 소형 임베드 지도, 500px, 상단 pill 탭 없음) |
| `단지`/`학교`/`재개발` | `src/app/map/page.tsx`의 **현재** 우측 세로 레이어 버튼 라벨(`LAYER_LABEL`, 656-664행)로 존재 — 위치·모양이 스크린샷과 다름(세로 배치, 가로 pill 탭 아님) |
| `경매` | `src/app/map/page.tsx`에는 없음(현재는 `경·공매`), `src/app/tools/page.tsx`에 무관한 문맥으로 1건 |

**결론: 스크린샷과 동일한 "← 메인으로 + 가로 pill 탭 + 이 지역에서 재검색" 조합의
UI를 렌더링하는 코드는 현재 production 소스 어디에도 존재하지 않는다.** 위 문자열이
남아있는 유일한 곳은 현재 코드가 *왜 이렇게 바뀌었는지*를 설명하는 한글 주석뿐이며,
주석은 렌더링되지 않는다.

## 3. Git 히스토리로 구형 UI 존재 시기 확정

`git log --follow -p -- src/app/map/page.tsx`로 실제 도입/제거 커밋을 확인:

| 커밋 | 시각(KST) | 내용 |
|---|---|---|
| `e142456` | 2026-08-10 13:06:19 | `⬅ 메인으로` 버튼 도입(`onClick={() => router.push('/')}`) |
| `4647f08` | 2026-08-10 13:41:36 | `🔄 이 지역에서 재검색` 버튼 도입 |
| `f87d69e` | 2026-08-11 17:23:08 | **"지도 UI 개편"** — 두 버튼 모두 제거. 하단 전역 5메뉴 탭바(`MapBottomNav`)로 "메인으로" 대체, `dragend` 이벤트 자동 재조회로 "이 지역에서 재검색" 버튼 대체, 우측 세로 카테고리 필로 가로 탭 대체 |

즉 스크린샷과 일치하는 구형 UI는 **2026-08-10 13:06 ~ 2026-08-11 17:23(약 28시간)
동안에만 실제 production에 존재**했다. 오늘(2026-08-15) 기준 약 4일 전에 이미
코드에서 완전히 제거된 상태다. main 브랜치 하나만 존재하고(`git branch -a` 확인),
origin/main과 항상 동일하게 배포되는 구조이므로 별도 legacy 브랜치/프리뷰 배포가
남아있어서가 아니라, **한때 실제로 배포됐던 구버전이 사용자 기기 쪽에 남아있다가
다시 노출된 것**으로 좁혀진다.

## 4. `/map` 진입 경로(A~F) 조사

`grep -rn "/map"` 결과, `/map`으로 연결되는 모든 진입점(Header.tsx 상단/사이드
NavButton, home-client.tsx 퀵메뉴 `<Link href="/map">`, MapBottomNav 등)이
전부 **동일한 단일 컴포넌트** `src/app/map/page.tsx`(`export default function
FullscreenMapPage`)로 귀결된다. 별도의 legacy map 컴포넌트나 `/map-old`류
경로는 존재하지 않는다(`Glob src/app/map*` → `src/app/map/page.tsx` 1건만).

유일하게 별도로 존재하는 지도 컴포넌트는 `src/components/MapViewer.tsx`인데, 이는
분양 상세페이지(`presale-detail-client.tsx`) 등에 삽입되는 500px 높이의 **소형
임베드 지도**로, 스크린샷의 전체화면 pill 탭 UI와 구조 자체가 다르다(검색창+내
위치 버튼만 있고 "메인으로/단지/학교/재개발/경매" 탭이 없음) — 이것이 구형 UI의
정체는 아니다.

진입 경로 간 코드상 차이:

- A(직접 URL)/E(새로고침): 브라우저의 **완전한 문서 내비게이션**(top-level
  navigation) — HTML 문서 자체를 네트워크/캐시에서 새로 가져옴.
- B(홈→지도)/C(하단nav→지도)/D(다른 페이지→지도): Next.js **클라이언트 사이드
  전환**(`router.push`/`<Link>`) — 이미 로드된 최신 JS 런타임 안에서 RSC 페이로드만
  fetch. 문서 전체를 다시 받지 않는다.
- F(PWA/홈화면 실행): 이 프로젝트에는 `manifest.json`, service worker(`sw.js`),
  `next-pwa` 등 PWA 관련 설정이 **전혀 없다**(§6 참고) — "홈 화면에 추가"를 했더라도
  이는 실제 설치형 PWA가 아니라 일반 브라우저 북마크 단축아이콘과 동일하게 동작한다.
  즉 F는 사실상 A와 같은 "완전한 문서 내비게이션" 경로다.

**이 A(전체 문서 내비게이션) vs B~D(클라이언트 전환)의 차이가, "최초 진입은 구형 →
홈→지도 재진입은 최신"이라는 사용자 관찰과 정확히 일치하는 유일한 코드/아키텍처
근거다.**

## 5. 최초 렌더링 조건 / 지역 기반 UI 분기 조사

`src/app/map/page.tsx` 전체를 읽고 `mounted`/`hydration`/`loading`/
`navigator.geolocation`/`currentLocation`/`center`/`mapReady`/`localStorage`/
`sessionStorage`/`cookie`/URL query/router state/`useEffect`/dynamic import/
fallback UI를 전수 확인한 결과:

- **지역·좌표에 따라 다른 UI "버전"을 렌더링하는 분기는 없다.** `DEFAULT_FALLBACK_LAWD_CD
  = '26140'`(부산 서구), `center` 기본값(부산 서구 좌표)은 전부 **데이터 조회 실패
  시의 폴백 지역**일 뿐이며, 어떤 지역이든 렌더링되는 JSX 컴포넌트/UI 셸은 항상
  동일하다. "부산/비부산", "지원 지역/미지원 지역"을 구분해 다른 컴포넌트를 렌더링하는
  코드는 없음(`부산` 검색 결과 2건 모두 데이터 폴백 값일 뿐 UI 분기 아님).
- geolocation 성공/실패/timeout 분기(544-580행, 690-718행)는 오직 `setCenter(...)`
  호출 대상만 바꾼다 — 성공하면 GPS 좌표, 실패하면 IP 기반(`ipinfo.io`) 좌표, 그것도
  실패하면 아무 것도 안 바뀜(초기값 부산 서구 유지). **어느 경우든 렌더링되는 UI
  구조(검색창, 우측 레이어 필, 하단 탭바)는 100% 동일**하고 pill 탭 같은 다른 UI로
  전환되지 않는다.
- 데이터가 없는 지역(예: 최근 12개월 실거래가 0건인 시골 지역)은 `aptMarkers`가
  빈 배열이 되어 **지도 위에 마커만 안 뜨는 것**이지, UI 셸 자체가 바뀌지 않는다.
- `mapLoadError`/`!apiKey` 조기 return 두 곳(628-649행)은 카카오맵 스크립트
  로드 실패/키 누락 시의 에러 화면이며, 스크린샷의 구형 UI와 전혀 다른 모양(빨간
  배경 에러 카드)이라 해당 없음.
- localStorage/sessionStorage: 지도 관련 코드에는 **둘 다 전혀 사용되지 않는다**.
  저장소 전체에서 유일한 sessionStorage 사용처는 `src/lib/live-presence.ts`(커뮤니티
  익명 세션 ID)로, 지도 UI/상태와 무관.

## 6. Service Worker / PWA / 브라우저 캐시 조사

저장소 전체에서 `service worker`, `sw.js`, `next-pwa`, `manifest.json`,
`Cache API`, `caches.open`, `serviceWorker.register`, `stale-while-revalidate`,
`workbox` 검색 결과 **전부 매치 없음**(무관한 prisma 스킬 참고문서 1건 제외).
`public/` 디렉터리에도 아이콘/파비콘류만 있고 manifest나 sw 파일 없음.
`next.config.ts`에도 PWA 플러그인/커스텀 `headers()` 설정 없음(`allowedDevOrigins`만
존재, 개발환경 전용).

→ **이 앱에는 Service Worker/PWA 캐시 레이어가 아예 존재하지 않는다.** 따라서
"구버전 JS가 SW 캐시에 박혀서 계속 나온다"는 경로는 원천적으로 불가능하다. 남는
가능성은 **브라우저 자체의 일반 HTTP 캐시**뿐이다.

### production 응답 헤더 실측 (읽기 전용, `curl`)

```
GET https://real-estate-app-park11.vercel.app/map
Cache-Control: public, max-age=0, must-revalidate
Age: 1671
X-Vercel-Cache: HIT
X-Nextjs-Prerender: 1
X-Nextjs-Stale-Time: 300
```

`next build` 확인 결과 `/map`은 `○ (Static)` — 빌드 시 정적 HTML로 프리렌더되고
Vercel Edge에 캐시된다(위 `X-Vercel-Cache: HIT`, `Age`가 이를 보여줌). 다만
`Cache-Control: public, max-age=0, must-revalidate`이므로 **정상 네트워크
상태에서는 브라우저가 매번 서버에 재검증(ETag)해야 하고**, 실측 시점 `Age`는
약 28분으로 오늘 빌드된 최신 UI를 정확히 반영하고 있었다(구형 UI 아님 — 현재
Vercel CDN에 남아있는 구형 캐시는 없음).

→ Vercel CDN 레벨에서는 4일 전 구버전이 지금까지 캐시되어 있을 가능성은 낮다(배포마다
갱신됨, 실측도 최신 UI 확인). **문제가 있다면 CDN이 아니라 사용자 "기기 자체"의
캐시/네트워크 경로**라는 뜻이다.

## 7. GPS 지연/실패 관련 fallback 경로

`navigator.geolocation.getCurrentPosition` 성공 전에는 `center`가 기본값(부산
서구)으로 유지된 채 **이미 동일한 최신 UI가 렌더링된 상태**로 대기한다(로딩
게이트는 `isMapReady`/`isLoadingData`에만 걸림, GPS 완료 여부와는 무관). 실패
시 IP 폴백, 그마저 실패하면 기본 좌표 유지 — 어느 케이스든 **UI 셸이 아니라
지도 중심 좌표만** 바뀐다. 즉 "시골이라 GPS/역지오코딩이 느리거나 실패해서
다른 UI가 뜬다"는 코드 경로는 존재하지 않는다.

## 8. 재현 테스트

- `next build` 정적 프리렌더 여부 확인 완료(§6).
- production `/map` 응답 헤더 실측 완료(§6) — 최신 UI, 캐시 정상.
- 실제 시골 지역 좌표/약전계 통신 환경(3G, 통신사 압축 프록시 등)을 이 조사
  환경에서 재현할 방법은 없었다 — **사용자의 실제 기기·네트워크 로그 없이 "시골
  자체가 원인"이라고 단정하지 않는다**(요청사항 준수). 코드 근거로 확정 가능한
  것은 "그런 UI를 만드는 코드가 지금 없다"는 사실과 "그 UI가 실제로 배포됐던
  시기"까지이며, 그 이후 왜 사용자 기기에 재노출됐는지는 기기 측 캐시 동작에 대한
  추정이다.

## 9. 판정

**B. 버그 가능성 높음 — 재현은 안 되지만 코드상 경로가 존재(단, "현재 코드의
버그"가 아니라 "과거에 실제로 배포됐던 구버전이 기기에 남아 재노출된 것") /
C. 일시적 캐시 문제 가능성**에 해당한다. 정리하면:

- 현재 production 코드에는 스크린샷 UI를 만드는 경로가 **없다**(A는 아님 — 지금
  코드가 어떤 조건에서 구형 UI를 그리는 게 아니다).
- 그러나 그 UI는 2026-08-10~08-11에 **실제로 이 도메인에서 배포됐던 진짜
  과거 버전**이며, Service Worker/PWA/localStorage 등 이 앱이 자체적으로 관리하는
  캐시는 전혀 없으므로, 남는 설명은 **사용자 기기/브라우저(혹은 통신사 프록시)의
  HTTP 캐시가 그 시점의 응답을 들고 있다가, 신호가 약한 지역에서 "완전한 문서
  네비게이션"(A/E/F 경로) 요청 시 재검증 없이(또는 재검증 실패 후 폴백으로) 그
  캐시를 다시 보여줬다**는 것이다. 이후 홈→지도 재진입(B/C/D 경로, 클라이언트
  사이드 전환)은 이미 메모리에 로드된 최신 JS 런타임을 그대로 쓰므로 정상적으로
  최신 UI가 보인다 — 이 비대칭이 사용자가 관찰한 패턴과 정확히 일치한다.
- 근거 강도: 코드/git/배포 헤더로 확인 가능한 부분은 전부 확인했고 이론적 정합성도
  높지만, 실제 기기의 캐시 상태를 직접 들여다본 것은 아니므로 **완전한 A(확정)로는
  분류하지 않는다.**

### 질문에 대한 답

- **예상하지 못한 지역에서 발생할 수 있는 현상인가?** — 지역 자체보다는 "그
  기기에서 최근(수일 내) 이 도메인에 접속한 적이 있는지 + 그 시점의 네트워크
  품질"에 좌우되는 현상으로 보인다. 다만 신호가 약한 시골 지역은 재검증 요청이
  실패/타임아웃될 가능성이 도심보다 높아 이 현상이 "더 잘 드러나는" 조건일 수 있다.
- **지역 데이터 부족 때문에 구형 UI가 나올 수 있는가?** — 아니다. §5에서 확인한
  대로 데이터 유무는 마커 표시 여부에만 영향을 주고 UI 셸에는 영향을 주지 않는다.
- **다시 발생할 가능성이 있는가?** — 있다. 원인이 "그 시점에 캐시된 과거 응답"이라면
  캐시 TTL 정책상 시간이 지나며 자연 소멸하겠지만, 유사하게 신호가 약한 환경에서
  낡은 캐시가 재노출되는 유형의 문제 자체는 앞으로도 반복될 수 있다.
- **수정이 필요한가?** — 코드 자체에 고쳐야 할 버그는 발견되지 않았다(현재 코드는
  지역/데이터 여부와 무관하게 항상 동일한 최신 UI를 그린다). 다만 원한다면
  `/map` 문서 응답에 더 강한 캐시 무효화 신호(`Cache-Control: no-store` 등)를
  추가하는 예방적 조치는 검토 가능 — 이는 이번 STEP 범위 밖이며 사용자 승인
  필요.
- **지금 수정해야 하는 우선순위인가?** — 아니다. 재현 불가, 현재 코드에 결함 없음,
  1회성 관찰.
- **B2 작업 전에 막아야 하는 BLOCKER인가?** — 아니다. B2(문서33, apt 상세페이지
  스펙/차트)와 이번 지도 이슈는 서로 다른 페이지/코드 경로이고, 이번 조사에서
  발견된 것은 "과거 배포가 캐시로 재노출됐을 가능성"이지 현재 코드의 결함이
  아니므로 B2 진행을 막을 이유가 없다.

## 10. STOP 조건 확인

발견된 것은 (1) 4일 전 실제로 배포됐다 제거된 구버전 UI의 흔적, (2) 이 앱에
Service Worker/PWA/localStorage 기반 캐시가 없다는 사실, (3) `/map`이 정적
프리렌더 + `max-age=0, must-revalidate`로 서빙된다는 사실 — 이며 현재 코드 안에
"legacy UI 렌더 경로", "지역별 UI 분기", "잘못된 fallback"은 **존재하지 않는다**.
따라서 이번 STEP에서 고칠 production 코드 자체가 없었고, 요청대로 어떤 수정도
하지 않았다.

## 11. 문서/기록

- 이 문서(`docs/development/34-map-initial-load-legacy-ui-audit.md`) 신규 생성.
- `docs/development/CHANGELOG.md`에 STEP 34 조사 항목만 추가.
- 기존 미커밋 변경(문서33, CHANGELOG의 STEP33 항목)은 그대로 보존.
- commit/push 없음.
