# COMMUNITY IMAGE UPLOAD RATE LIMIT V1 — 사진 업로드 사용자별 한도

- 기준 HEAD: `05c8ca4` (main)
- 범위: `POST /api/community/images`에만 사용자별 한도 추가. 편집기 UI·PostImage schema·bucket policy·Data API·auth 무변경.
- 새 저장소·외부 서비스·secret·migration 없음.

## 1. 현재 업로드 구조(코드 기준)

| 항목 | 실제 |
|---|---|
| endpoint | `POST /api/community/images?session=<uuid>` — **요청 1건 = 사진 1장**(본문 = 압축된 WebP/JPEG 바이트) |
| 인증 | `requireUser()` → NextAuth `getServerSession` 사용자. 비로그인 401, 차단 계정 403 |
| userId | 핸들러가 `auth.user.id`만 사용. 경로 `posts/{userId}/{session}/{uuid}.{ext}`는 서버가 생성 |
| 글당 최대 | 5장(`MAX_IMAGES_PER_POST`, 같은 세션 prefix 목록이 5개 이상이면 409) |
| 크기 | 클라이언트 원본 10MB·5천만 픽셀, 서버 저장본 1.5MB(선언 길이 초과는 본문 읽기 전 413), bucket 2MB |
| 세션 | 브라우저 `submitBlockPost`가 등록/저장 시 새 사진만 새 세션 UUID로 **순차** 업로드 |
| 영수증 | HMAC 서명, 6시간 만료. 글 생성/수정은 영수증만 신뢰 |
| 정리 | 어느 단계든 실패하면 브라우저가 `DELETE /api/community/images?session=` → 본인 세션의 미참조 객체 삭제 |
| 기존 rate limit 유틸 | 없음. Redis/KV/Upstash 의존성 없음. `molit-rate-guard.ts`는 외부 API용 인스턴스 로컬 게이트 |
| 런타임 | Vercel 서버리스(Node). 인스턴스가 여러 개일 수 있고 메모리는 인스턴스마다 따로 |

## 2. 한도 없던 때의 악용 면

- 로그인 계정 하나로 세션 UUID만 바꾸면 세션당 5장 제한을 무한히 우회 → Storage 용량 증가(장당 최대 1.5MB).
- 업로드 후 세션 정리를 반복하면 용량은 남지 않지만 함수 호출·Storage 쓰기가 계속 발생.
- 잘못된 바이트를 반복 전송해도 매번 본문 읽기·판별 비용 발생.

## 3. 선택한 한도

| 층 | 기준 | 한도 | 저장 위치 | 성격 |
|---|---|---|---|---|
| 저장 한도(10분) | 이 사용자 경로에 **최근 10분 동안 생성되어 아직 남아 있는 사진 수** | 20장 | `storage.objects`(DB) | 모든 인스턴스 공유 |
| 저장 한도(24시간) | 같은 기준, 최근 24시간 | 100장 | `storage.objects`(DB) | 모든 인스턴스 공유 |
| 요청 한도(10분) | 업로드 요청 수(성공·실패·형식 오류 포함, 거절된 요청은 제외) | 40회 | 프로세스 메모리 | **인스턴스 로컬, best-effort** |

- 키: `community-image-upload:{userId}` — `userId`는 서버 세션에서만. IP는 쓰지 않는다(로그인 필수 API라 계정 기준이 더 정확하고, raw IP를 다루지 않기 위해).
- 관리자도 **같은 한도**(예외 없음).
- 경계: 20장째 성공, 21장째 429. 요청 40번째 허용, 41번째 429. 24시간 100장째 성공, 101장째 429.
- 판정 순서: 인증 → 세션 UUID → Storage 설정 → 선언 길이(413) → **요청 한도 → 저장 한도** → 본문 읽기 → 형식(415) → 세션 5장(409) → 업로드.
  한도에 걸리면 본문을 읽지 않고 Storage를 부르지 않는다.
- 10분 버스트 창이 이미 짧아 별도 1분 버스트 한도는 두지 않았다(V1 단순성).

### 왜 storage.objects인가

Supabase Storage는 객체마다 `storage.objects` 행(`bucket_id`, `name`, `created_at` …)을 남긴다. 앱 DB 역할이 이 테이블을 읽을 수 있음을
Production에서 읽기 전용 트랜잭션으로 확인했다(`has_table_privilege(... 'SELECT') = true`). 모든 인스턴스가 같은 DB를 보므로,
**새 저장소 없이** 인스턴스 간 공유되는 한도가 되고, 비용의 실체(저장된 사진)를 직접 센다.

쿼리(읽기 전용 1건, `src/lib/community/image-upload-usage-db.ts`):
`bucket_id = 'community-images' AND name COLLATE "C" >= 'posts/{userId}/' AND name COLLATE "C" < 'posts/{userId}0' AND created_at > now() - 24h`
에서 10분/24시간 개수와 가장 오래된 객체가 창을 벗어나기까지 남은 초를 구한다.
- `'0'`은 C collation에서 `'/'` 바로 다음 문자라 이 구간은 정확히 `posts/{userId}/` 접두만 포함한다(`{userId}1`, `{userId}_`, `{userId}-x` 제외 — 테스트 14d).
  LIKE를 쓰지 않아 userId의 `_` 와일드카드 문제가 없고, 기존 인덱스 `idx_objects_bucket_id_name (bucket_id, name COLLATE "C")`와 모양이 맞다.
- 시각은 DB `now()` 기준(서버 시계 차이 무관). Prisma tagged template 파라미터 바인딩만 사용.
- Production 검증(읽기 전용): 없는 사용자 → 0/0, 실제 사진 2장 작성자 → 10분 0, 24시간 2, 만료까지 17,772초(객체 약 19.1시간 전 생성과 일치).
  현재 행 2개라 플래너는 seq scan을 선택(규모가 커지면 인덱스 사용 예상 — 미측정).

### 정리하면 다시 올릴 수 있다(의도)

세션 정리로 지운 객체는 행이 사라져 저장 한도에서 빠진다. 한도 때문에 등록이 중간에 실패해도 브라우저가 세션 정리를 호출하므로
정상 사용자는 정리 후 재시도할 수 있다. 이 "올리고 지우기 반복"은 요청 한도(메모리)가 줄인다.

## 4. 서버리스 한계(정직하게)

- **요청 한도는 인스턴스 로컬이다.** Vercel이 인스턴스를 N개 띄우면 이론상 사용자당 최대 40×N회/10분까지 가능하고, 콜드 스타트마다 초기화된다.
  강한 보안 장치가 아니라 한 인스턴스에 몰리는 반복을 줄이는 best-effort다. 메모리는 키 5,000개 상한(만료분 → 오래된 키 순 제거).
- **저장 한도는 공유되지만 원자적이지 않다.** 조회와 업로드 사이 경합으로 동시 요청 수만큼 초과할 수 있다. 브라우저는 순차 업로드라 정상 흐름에서는 해당 없음.
- **사용량 조회 실패 시 fail-open**: DB 오류·권한 문제면 업로드를 막지 않고 요청 한도만 적용한다.
  `[community-images] rate limit usage unavailable`(오류 이름만, 사용자 id·원문 없음)를 `console.error`로 남긴다. 게시글 저장이 어차피 DB를 필요로 하므로 업로드만 막는 이득보다 오판 차단 위험이 크다고 판단.
- `storage.objects`는 Supabase가 관리하는 스키마다. 앱은 읽기만 한다. Supabase가 이 테이블 구조를 바꾸면 조회가 실패 → fail-open(위 로그로 감지).

## 5. 응답

- HTTP **429**, 본문 `{ "success": false, "error": "사진 업로드 요청이 많습니다. 잠시 후 다시 시도해 주세요." }`
- `Retry-After: <초>` — 가장 오래된 해당 사진(또는 요청)이 창을 벗어날 때까지(최소 1초). 한도를 크게 넘긴 경합 상황에서는 실제보다 짧을 수 있다.
- 내부 사유(요청/10분/24시간)·개수는 응답에 없다. 서버 로그에만 `[community-images] rate limited { reason }`(info, 사용자 id·IP 없음).
- 429는 error_logs에 쓰지 않는다(`console.log`). 비정상 버스트 추적은 ADMIN SYSTEM HEALTH V2 범위로 미룬다.
- 편집기는 서버 `error` 문자열을 그대로 보여주고 세션 정리를 호출한다(기존 `submitBlockPost` 흐름, UI 변경 없음).

## 6. 정상 사용자 영향

- 5장짜리 글: 10분에 4개, 하루 20개까지 저장 한도에 걸리지 않는다. 사진을 지운 글·삭제한 글·실패 후 정리된 사진은 세지 않는다.
- 실패 후 재시도: 5장 제출을 10분에 8번까지(요청 한도).
- 수정에서 사진 교체: 새 사진만 업로드, 제거한 사진은 커밋 후 삭제되므로 저장 한도에서 빠진다.
- 현재 Production 사진 글 1건·사진 2장 규모에서는 실사용자가 한도에 닿을 가능성이 사실상 없다.

## 7. 편집기 회귀

변경은 업로드 핸들러의 한 단계(본문 읽기 전)와 응답 헤더 전달뿐. 글당 5장·커서 삽입·교체·여러 장·영수증·글 생성·수정 저장·세션 정리 코드는 수정하지 않았다.
기존 편집기/업로드 테스트(community-images, editor v2/2.1/2.1a/2.2, delete navigation) 전부 통과. 세션 정리 DELETE는 한도를 적용하지 않는다.

## 8. 보안

- `SUPABASE_SERVICE_ROLE_KEY`를 읽는 src 파일은 여전히 `server-storage.ts` 하나(기존 테스트 29). 새 파일은 env를 읽지 않음.
- 새 DB 모듈·deps 모듈은 `server-only`. 클라이언트 컴포넌트 import 없음(테스트 15).
- 한도 키는 서버 세션 사용자 id로만 생성. 라우트는 요청의 userId류 입력을 읽지 않음(테스트 8).
- 토큰·쿠키·IP 로그 없음. Data API 호출 없음(src `/rest/v1` 0). bucket policy 무변경.

## 9. 테스트 결과

| 명령 | 결과 |
|---|---|
| `npx tsx --test src/lib/community/community-image-upload-rate-limit.test.ts` | 18/18 pass |
| `npx tsx --test $(find src -name "*.test.ts" -o -name "*.test.mjs")` | 1950/1950 pass |
| `npx tsc --noEmit` | exit 2 — FAIL_EXISTING_SCRIPT_ERRORS(기존 scripts/tmp 25건, src 0) |
| `npx eslint` 변경 파일 | exit 0 |
| `npm run build` | exit 0 |

## 10. 향후 확장

- 트래픽이 커지거나 요청 한도의 인스턴스 로컬 한계가 문제가 되면: 공유 KV(Upstash/Vercel KV 등, 유료·승인 필요) 또는
  DB 테이블 기반 카운터(migration 승인 필요)로 요청 한도를 옮긴다.
- `storage.objects` 조회 지연을 dry-run으로 측정해 필요 시 조건 조정.
- 429 빈도·사유 집계는 ADMIN SYSTEM HEALTH V2에서 검토.
