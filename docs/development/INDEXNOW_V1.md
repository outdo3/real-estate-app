# INDEXNOW V1

브랜치: `main` / 기준 커밋: `81a7ccc`
프로덕션 도메인: `https://e-jip.com`

Bing·Naver 등 IndexNow 참여 검색엔진에 URL 변경을 통지하는 연동. DB/schema/migration 변경 없음.

## 0. 현재 상태

| 항목 | 상태 |
|---|---|
| IndexNow 클라이언트 | **완료** |
| 사이트맵 일괄 제출 스크립트 | **완료** (dry-run으로 실제 프로덕션 사이트맵 검증) |
| 테스트 | **완료** (26개) |
| 키 파일 (`/<key>.txt`) | **대기** — 사용자 키 필요 |
| 초기 제출 | **대기** — 키 설정 후 1회 실행 |

작업 지시문의 `INDEXNOW_KEY=<여기에 사용자가 생성한 키>` 자리가 placeholder 그대로였다.
키를 **지어내지 않았다** — 사용자가 Bing/IndexNow 화면에서 이미 발급받은 값이 따로 있고,
다른 키를 만들어 올리면 그 값이 고아가 된다. 키가 없는 동안 클라이언트는
`NOT_CONFIGURED`로 동작하며 **네트워크 요청을 아예 보내지 않는다.**

## 1. 키는 비밀이 아니다

IndexNow의 소유 확인 방식 자체가 "이 키를 사이트 루트에 공개 텍스트 파일로 올려라"다.
즉 키는 누구나 읽을 수 있어야 정상 동작한다. `NEXTAUTH_SECRET`, OAuth client secret,
API 키 같은 **진짜 비밀과 같은 취급을 하지 않는다**(§7).

그렇다고 아무 데나 찍지도 않는다. 제출 실패 시 응답 본문을 로그나 반환값에 싣지
않는다 — IndexNow는 오류 응답에 키를 되돌려주는 경우가 있고, 키를 교체했을 때 옛 값이
로그에 남으면 혼란만 준다. 반환값에 키가 섞이지 않는 것은 테스트로 고정돼 있다.

## 2. 키 파일

```
https://e-jip.com/<INDEXNOW_KEY>.txt   →   200, text/plain, 키 한 줄
```

`public/<key>.txt`로 둔다. Vercel이 `public/`을 정적으로 서빙하므로 리다이렉트도 HTML
렌더링도 없이 평문으로 나간다.

파일은 손으로 만들지 않고 스크립트가 만든다:

```
INDEXNOW_KEY=<키> npm run indexnow:write-key
```

- 파일 **이름**과 제출 페이로드의 **값**이 같아야 하는데, 사람이 두 곳에 따로 적으면
  언젠가 갈라진다. 출처는 환경변수 하나이고 파일은 거기서 파생된다.
- 키를 교체하면 `public/` 루트의 옛 키 파일을 지운다(둘이 남으면 어느 쪽이 현행인지
  알 수 없다). `brand/` 같은 다른 정적 자산은 건드리지 않는다.
- **만들어진 파일은 커밋해야 한다.** 커밋하지 않으면 프로덕션에서 404가 되고 IndexNow가
  키를 확인하지 못한다.

테스트가 파일이 존재할 때 형식(이름=내용, HTML 없음, 파일 1개)을 검사한다.

## 3. 클라이언트

`src/lib/indexnow/submit.ts`

```ts
submitIndexNow(urls: string[]): Promise<IndexNowResult>
```

엔드포인트 `https://api.indexnow.org/indexnow`, 페이로드는 `host` / `key` /
`keyLocation` / `urlList`.

### 통과 규칙

| 입력 | 결과 |
|---|---|
| `https://e-jip.com/...` | 통과 |
| 외부 도메인 (`example.com`, `e-jip.com.evil.test`) | 거부 |
| `localhost`, `127.0.0.1` | 거부 |
| `*.vercel.app` (프리뷰 호스트) | 거부 |
| `http://` | 거부 |
| `/api/`, `/admin`, `/my`, `/community/write` | 거부 |
| 중복 URL | 제거(처음 등장 순서 유지) |

허용 호스트는 `siteConfig`(= `NEXT_PUBLIC_SITE_URL`)에서 나온다 — 호스트를 코드에 박지
않는다. 오리진이 https가 아니면(로컬 개발 등) `NOT_CONFIGURED`가 되어 **아무것도
제출하지 않는다.** 로컬에서 실수로 통지가 나가는 경로 자체를 없앤다.

규격 상한 10,000개 단위로 나눠 보낸다.

### 절대 던지지 않는다

이 함수는 나중에 커뮤니티 글 발행 같은 사용자 요청 흐름에 붙을 수 있다. 검색엔진 통지가
실패했다고 글 발행이 실패하면 안 된다. 그래서 모든 실패를 값으로 돌려준다:

```
NOT_CONFIGURED | NO_URLS | SUBMITTED | FAILED
```

## 4. 제출 성공의 의미

```
SUBMITTED  =  검색엔진에 URL이 바뀌었다고 통지했다
SUBMITTED  ≠  색인됐다
```

크롤링 여부, 색인 여부, 순위는 전부 검색엔진의 별도 판단이며 IndexNow는 거기에 관여하지
않는다. 반환 타입 이름을 `SUBMITTED`로 둔 것도, 스크립트가 "색인 완료"라고 출력하지
않는 것도 같은 이유다.

## 5. 사이트맵 일괄 제출

```
npm run indexnow:submit-sitemap -- --dry-run   # 보기만
npm run indexnow:submit-sitemap                # 실제 통지
```

프로덕션 `sitemap.xml`을 그대로 읽어 그 URL만 제출한다. **색인 범위를 여기서 다시
정의하지 않는다** — 사이트맵이 곧 색인 대상이고, 두 곳에서 정하면 갈라진다
(`BUSAN_LAUNCH_SCOPE_SITEMAP_FIX_V1`의 부산 16개 정책을 그대로 물려받는다).

### `&amp;` 디코드

사이트맵의 지역 URL은 `?sido=...&amp;sigungu=...` 형태다. `&amp;`는 XML에서 `&` 한
글자를 뜻하는 올바른 이스케이프이므로, 디코드하지 않고 제출하면 `amp;sigungu`라는
존재하지 않는 파라미터가 붙은 URL을 통지하게 된다. 파서가 이를 푼다(테스트로 고정).

### 범위 밖이면 멈춘다

부산 밖 `sido` 파라미터가 하나라도 있으면 **제출하지 않고 종료한다.** 조용히 걸러내면
사이트맵 정책이 바뀐 사실을 아무도 모른 채 통지만 나간다.

### dry-run 실측 (2026-09-12)

```
사이트맵 URL: 36개
제출 대상: 36개 (거부 0개)
범위 밖 지역: 0개
```

내역: 정적 4개(`/`, `/stats`, `/school`, `/community`) + 부산 16개 구·군 × 2(통계/학군)
= 32개. 커뮤니티 글 URL은 현재 0개다.

## 6. 자동화 정책

**반복 제출 cron을 만들지 않았다.** IndexNow는 "바뀐 것"을 알리는 통지 채널이지 전체
목록을 주기적으로 재전송하는 곳이 아니다. 같은 URL을 매일 다시 보내면 얻는 것 없이
쿼터만 쓴다. `vercel.json`에 IndexNow 항목이 없음을 테스트가 확인한다.

### 지금 (V1)

도메인 전환 직후처럼 "한 번 전체를 알려야 하는" 상황에 스크립트를 수동 실행한다.

### 앞으로 붙일 수 있는 지점

- 커뮤니티 글 발행 / 수정 / 삭제
- 리포트 발행 / 수정
- 향후 매물(owner listing) 등록 / 수정 / 삭제
- 새로 색인 대상이 되는 단지 상세 URL
- 지역 확장

**지금은 붙이지 않았다** — 존재하지 않는 워크플로우에 가짜 훅을 만들지 않는다. 해당
흐름이 생기면 `submitIndexNow()`를 호출하면 되고, 실패가 값으로 돌아오므로 호출부를
깨뜨리지 않는다.

## 7. 전국 확장 규칙

서울·경기 등을 열 때, IndexNow 제출 대상에 포함되는 조건:

1. 해당 지역이 **데이터 신뢰 기준을 통과**하고
2. 사이트맵에 **의도적으로 추가된 뒤**

사이트맵을 원본으로 삼기 때문에 (2)가 되면 IndexNow는 자동으로 따라온다. 반대로
말하면, 데이터 없이 사이트맵만 넓히면 IndexNow도 같이 넓어진다 — 범위 검사가 그때
멈춰 세우는 안전핀이다.

## 8. 남은 작업 (사용자)

1. `INDEXNOW_KEY`를 알려주거나 `.env.local` / Vercel 환경변수에 설정
2. `npm run indexnow:write-key` → `public/<key>.txt` 생성 후 **커밋**
3. 프로덕션 재배포
4. `https://e-jip.com/<key>.txt` 가 200 / 키 한 줄로 열리는지 확인
5. `npm run indexnow:submit-sitemap` 1회 실행, HTTP 응답 코드 기록
6. Bing Webmaster Tools → IndexNow 에서 수신 내역 확인

## 9. 검증

```
npx tsx --test src/lib/indexnow/indexnow.test.ts      26/26 PASS
npx tsx --test "src/**/*.test.ts"                     879/879 PASS
npx tsc --noEmit                                      src/ 오류 0
npm run build                                         Compiled successfully
dry-run (실제 프로덕션 sitemap)                        36 URL, 거부 0, 범위 밖 0
```

Bing Webmaster Tools 화면은 이 환경에서 볼 수 없다 — **CONSOLE QA REQUIRED**.

## 10. Naver 호환

Naver는 IndexNow 참여 검색엔진이며 `api.indexnow.org` 공용 엔드포인트로 들어온 통지를
공유받는다. 별도 엔드포인트나 별도 키가 필요하지 않다. 다만 네이버의 수집/색인 반영은
서치어드바이저 쪽 정책을 따르며 IndexNow 통지가 그것을 보장하지 않는다(§4와 같은 구분).
