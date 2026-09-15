# COMMUNITY IMAGE ORPHAN CLEANUP V1 — PHASE 1 (Production DRY-RUN 감사)

- 기준 HEAD: `a855366` (main)
- 범위: orphan 사진 **감사 도구 + Production dry-run + PHASE 2 삭제 설계(테스트로 고정)**.
- 하지 않은 것: Storage 삭제, DB 쓰기, schema/migration, bucket policy, Data API, auth, cron. `--apply`는 스크립트에서 거부된다.
- **판정: CLEAN** — Production orphan 후보 0, 검토 필요 0, DB 참조 누락 0.

## 1. 현재 구조(코드 기준)

| 항목 | 실제 |
|---|---|
| bucket | `community-images` (public, `file_size_limit` 2,097,152, `allowed_mime_types` `image/jpeg`,`image/webp` — 이번 dry-run에서 bucket API 읽기로 확인) |
| 경로 | `posts/{userId}/{uploadSession uuid}/{file uuid}.{webp\|jpg}` — `image-rules.ts` `buildImagePath` / `parseImagePath` (`USER_ID_RE` `[A-Za-z0-9_-]{1,64}`, UUID v1–8) |
| DB | `PostImage.path` `@unique`, `Post` 삭제 시 cascade. `Post.author`는 onDelete 미지정(=Restrict) → 글이 있는 사용자는 삭제되지 않음. 사용자 삭제 API 없음 |
| 업로드 세션 | 브라우저 `submitBlockPost`가 **등록/저장 버튼을 누른 순간** 새 사진만 `crypto.randomUUID()` 세션으로 순차 업로드(사진 선택 시점에는 업로드하지 않음). 세션당 최대 5개 |
| 영수증 | HMAC 서명, `UPLOAD_TOKEN_TTL_MS` = **6h** (`image-upload-token.ts`). 경로·크기는 영수증 값만 사용 |
| 글 연결 | V1 `POST /api/community/posts`(content+images) nested create / V2 블록 생성 `persistCreateBlockPost` / V2 수정 `persistEditBlockPost`의 새 사진. **PostImage에 새 경로가 들어가는 길은 이 셋뿐이며 모두 유효 영수증 필요** |
| 수정 | 트랜잭션 커밋 후에만 제거 사진 Storage 삭제(`removeWithRetry` 2회). 실패 시 `[community-image-orphan]` 로그 + `imageCleanup: 'pending'` |
| 실패 정리 | 서버: 생성/수정 트랜잭션 실패 시 이번 요청의 새 사진 삭제. 클라이언트: 어느 단계든 실패하면 `DELETE /api/community/images?session=` → 서버가 본인 세션 prefix의 **미참조** 객체만 삭제 |
| 글 삭제 | DB에서 경로 확보 → `post.delete` → Storage 삭제(2회). 실패 시 orphan 로그 |

## 2. orphan이 생길 수 있는 실제 경로

| # | 경로 | 결과 |
|---|---|---|
| 1 | 업로드 도중/후, 글 요청 응답 전에 탭 종료·앱 종료·네트워크 단절 | 클라이언트 세션 정리 호출이 실행되지 않음 → **미참조 객체 잔존** (주 원인) |
| 2 | 실패 후 클라이언트 세션 정리 `DELETE` 자체가 네트워크 오류 | 잔존(클라이언트는 조용히 무시, 서버 로그 없음) |
| 3 | 서버 생성/수정 트랜잭션 실패 + 새 사진 정리 2회 실패 | 잔존 + `[community-image-orphan] write failed and new-upload cleanup failed` 로그 |
| 4 | 글 삭제 커밋 후 Storage 삭제 2회 실패 / Storage 미설정 | 잔존 + orphan 로그 |
| 5 | 수정 커밋 후 제거 사진 Storage 삭제 실패 | 잔존 + orphan 로그 |
| 6 | 서버는 업로드 성공했지만 응답 유실(클라이언트는 실패로 인식) | 클라이언트가 세션 정리 호출 → 서버가 미참조 확인 후 삭제(정상 정리). 호출 실패 시 #2 |

역방향(DB 참조 있음 + Storage 없음)은 설계상 발생 경로가 없다: 연결 직전에 `storage.exists()`를 확인하고, 세션 정리는 미참조만 지운다.
이론적 경합(같은 세션의 정리 호출과 글 생성 동시 진행)은 클라이언트가 순차 await라 정상 흐름에서는 생기지 않는다.

## 3. orphan 정의와 안전 창

자동 삭제 가능 후보(`SAFE_ORPHAN_CANDIDATE`)는 **모두** 만족해야 한다.

1. Storage에 객체 존재(bucket 전체 목록에서 얻음 — 클라이언트 입력 없음)
2. 같은 문자열의 `PostImage.path` 없음 (DB가 source of truth)
3. `posts/` prefix + `parseImagePath` 정확 일치
4. `created_at`·`size`·`mimetype` 존재, 확장자와 MIME 일치, 크기 ≤ bucket 한도
5. 경로의 `userId`가 User 테이블에 실제 존재
6. `now - created_at >= 24h` (경계 포함)

분류 우선순위: REFERENCED → 경로 규칙(REVIEW) → 메타데이터(REVIEW) → 소유자(REVIEW) → 나이(RECENT / CANDIDATE).
참조된 객체는 어떤 이유로도 후보가 되지 않는다. 미래 `created_at`(시계 차이)은 나이가 음수라 RECENT로 보호된다.

| 분류 | 의미 | 삭제 대상 |
|---|---|---|
| A REFERENCED | Storage + PostImage | 아니오 |
| B RECENT_UNREFERENCED | 미참조 + 24h 미만 | 아니오 |
| C SAFE_ORPHAN_CANDIDATE | 위 6조건 | PHASE 2에서만 |
| D DB_MISSING_STORAGE | PostImage 있음 + 객체 없음(개별 `object/info`로 재확인) | 아니오 — 무결성 문제 |
| E REVIEW_REQUIRED | `WRONG_PREFIX` `MALFORMED_PATH` `MISSING_CREATED_AT` `INVALID_CREATED_AT` `MISSING_SIZE` `MIME_EXT_MISMATCH` `OVERSIZED` `UNKNOWN_OWNER` | 아니오 |

**안전 창 근거.** 영수증은 업로드 직후 `exp = now + 6h`로 발급되고, PostImage에 새 경로가 들어가는 세 경로 모두 유효 영수증이 필요하다.
따라서 객체 생성 후 6h가 지나면 그 경로를 새로 참조할 방법이 구조적으로 없다(미참조 상태가 영구화). 24h는 그 위 18h 여유이며,
코드는 **12h(TTL + 6h) 미만 창을 거부**한다. 24h보다 길게 둘 구조적 이유는 찾지 못했다. 단, 앞으로 영수증 TTL을 늘리거나
영수증 없이 경로를 연결하는 기능(예: 임시저장 초안)을 추가하면 이 불변식이 깨지므로 창과 하한을 함께 재검토해야 한다(`ORPHAN_MIN_AGE_HOURS_FLOOR`가 TTL에서 계산되므로 TTL 변경은 자동 반영).

## 4. 구현

| 파일 | 내용 |
|---|---|
| `src/lib/community/image-orphan-audit.ts` | 순수 분류 `classifyCommunityImageObjects`, 오케스트레이션 `findCommunityImageOrphans({ minAgeHours })`, 읽기 전용 Storage 프로브(list/info만, bucket 상수 고정, 폴더 재귀·1000개 페이지·5만 개/깊이 6 상한), redact, 키 종류 판별, CLI 인자, PHASE 2 `planOrphanCleanup`/`applyOrphanCleanup`. env를 읽지 않음. 앱 런타임에서 import하지 않음 |
| `scripts/community/audit-image-orphans.ts` | Production dry-run CLI. `_prod-db-guard` DIAGNOSTIC(`ALLOW_PROD_DB_READ=1` 필요). `APPLY_ENABLED = false` → `--apply` 거부(exit 2). 삭제 메서드가 있는 Storage 클라이언트를 만들지 않음. DB는 `findMany`/`count`만 |
| `src/lib/community/community-image-orphan-audit.test.ts` | 26개 |

실행: `ALLOW_PROD_DB_READ=1 npx tsx scripts/community/audit-image-orphans.ts [--verbose] [--min-age-hours=24]`

순서: Storage 전체 list → PostImage.path fresh 조회(1000행 cursor) → 경로 소유자 User 조회 → 분류 → DB_MISSING_STORAGE 개별 존재 확인.
어느 단계든 실패하면 `stage=STORAGE|DB|CONFIRM`으로 끝나고 후보를 하나도 계산하지 않는다(부분 목록으로 판정하지 않음).
Storage 키는 앱과 같은 `SUPABASE_SERVICE_ROLE_KEY`를 우선하고, 로컬에는 기존 `verify-community-images-storage.ts`와 같이 옛 이름 `SUPABASE_KEY`를 보조로 쓴다.
**키 종류가 service_role/secret이 아니면 중단**한다 — anon 키는 목록이 빈 배열로 올 수 있어 "객체 0"으로 오판할 위험이 있기 때문. 출력은 키 종류뿐.

## 5. Production DRY-RUN 결과 (2026-09-15T01:15:22Z)

```
COMMUNITY IMAGE ORPHAN AUDIT (DRY-RUN — nothing is deleted)
bucket: community-images   key kind: service_role   min age: 24h
Storage objects:          2
Storage bytes:            351396 (343.2 KB)
DB PostImage refs:        2
Posts (total / w/ images): 1 / 1
A Referenced:             2
B Recent unreferenced:    0
C Safe orphan candidates: 0
D Missing storage refs:   0
E Review required:        0
  DB refs w/ invalid path: 0
Potential reclaim bytes:  0 (0 B)
Oldest candidate age:     -
Newest candidate age:     -
Phase 2 plan (not executed): NOTHING  [cap 100/run, STOP > 500 objects or > 500.00 MB]
Data API: /rest/v1/ HTTP 503, /rest/v1/post_images HTTP 503 (non-2xx = OFF)
```

독립 교차 확인(읽기 전용 트랜잭션 `SET TRANSACTION READ ONLY`, 일회성 쿼리 — 커밋하지 않음):
`storage.objects WHERE bucket_id='community-images'` → 2행, 351,396 bytes, `posts/` 밖 0, 두 객체 모두 약 18.7h 전 생성.
`post_images` → 2행, `bytes` 합 351,396, 생성 약 18.7h 전. API 스캔 결과와 개수·바이트가 정확히 일치한다.

- 현재 남은 실제 이미지 게시글 1건(사진 2장)은 읽기만 했다. Production 쓰기 0.
- `--apply` 실행 → `REFUSED ... Nothing was deleted.` exit 2. `ALLOW_PROD_DB_READ` 없이 실행 → guard BLOCKED.
- 비용 영향: orphan 0 bytes → **0**. bucket 전체도 343 KB로 Storage 요금에 의미 있는 영향 없음.

## 6. PHASE 2 삭제 설계(이번에 실행하지 않음)

`applyOrphanCleanup({ mode, batch, minAgeHours }, deps)` — 테스트로만 동작 확인.

1. Storage list → 2. DB refs fresh query → 3. 후보 산출(`findCommunityImageOrphans`)
4. `planOrphanCleanup`: 후보 > **500개** 또는 > **500MB**면 `STOP`(배치 없음, 사람이 원인 확인). 아니면 오래된 순 **최대 100개**
5. 적용 시 배치 각 항목을 **다시** 검증(분류·경로 규칙·현재 시각 기준 나이) → 부적격은 `skippedIneligible`
6. 삭제 직전 배치 경로의 PostImage 참조 **재조회** → 참조된 것 제외(`skippedReferenced`). 재조회 실패 시 `DB_RECHECK_FAILED`로 **전부 중단**
7. `mode !== 'apply'`면 여기서 반환 — remove 호출 없음
8. 20개 청크로 `remove`, 청크당 최대 2회 시도(bounded retry)
9. 경로별 `exists()`로 검증 → `deleted` / `failed`(아직 있음) / `unverified`(확인 실패), `partial` 플래그. 조용한 실패 없음
10. cap(100) 초과 배치는 예외로 거부

TOCTOU: 6단계 재조회와 8단계 삭제 사이에 창이 남지만, 후보는 생성 후 ≥ 24h라 §3 불변식상 그 사이에 새 참조가 생길 수 없다.
재조회는 이 불변식이 코드 변경으로 깨졌을 때를 위한 두 번째 방어선이다.

STOP 기준: 현재 규모(객체 2개)에서 정상 발생률은 하루 수 개 이하로 예상되므로 500개/500MB는 "버그나 공격" 신호로 충분히 낮고,
100개/run은 Storage remove 요청 5건으로 끝나는 크기다. 규모가 커지면 dry-run 수치로 재조정한다.

PHASE 2 구현 시 제안: 목록 조회를 Storage list API(폴더 수만큼 요청, 세션이 늘면 선형 증가) 대신 DB의 `storage.objects` 읽기 전용 단일 쿼리로
바꾸는 것을 검토(이번 교차 확인에서 읽기 가능 확인). 삭제는 반드시 Storage API로만(`storage.objects` 행 직접 삭제 금지).

## 7. Cron 검토(생성하지 않음)

| 항목 | 판단 |
|---|---|
| 자동화 필요 여부 | **현재 불필요.** 사진 글 1건, orphan 0. 주 원인(#1)은 등록 도중 이탈이라 발생률이 낮고 비용 영향이 없다 |
| 권장 | 당분간 **수동 dry-run**(월 1회 또는 커뮤니티 사진 기능 변경 후). orphan이 반복 관측되거나 사진 글이 주 수십 건 이상이 되면 cron 전환 |
| 주기(전환 시) | 하루 1회, 기존 sync cron(19/21/23 UTC)과 겹치지 않는 시간 |
| 실행 비용 | 1회/일 × 수 초(현재 규모 list 요청 4건 + DB 쿼리 3건). Vercel 함수 호출 30회/월 수준. 세션 수가 수천이 되면 list 요청이 선형 증가 → §6의 SQL 목록 조회로 전환 권장 |
| 인증 | 기존 `src/lib/cron-auth.ts`(`CRON_SECRET`) 패턴 재사용. 경로 입력을 받지 않음 |
| 운영 위험 | 잘못된 분류로 실제 사진 삭제 → 공개 URL 404(CDN 캐시 1h 후). 복구 불가(버전 관리 없음). 완화: 24h 창, 재조회, cap/STOP, 첫 몇 주는 cron도 dry-run 모드로만 운영 후 결과 비교 |

## 8. 보안 확인

- `SUPABASE_SERVICE_ROLE_KEY`를 읽는 src 파일은 여전히 `src/lib/supabase/server-storage.ts` 하나(`server-only`) — 기존 테스트 29 PASS.
- 새 감사 모듈은 `process.env`를 읽지 않고 앱 런타임 어디서도 import되지 않음(테스트 15). 빌드 후 `.next/static`에서 `SUPABASE_SERVICE_ROLE_KEY`·`service_role`·`image-orphan`·`storage/v1` 0건.
- Data API: Production `/rest/v1/`·`/rest/v1/post_images` HTTP 503(OFF). src에 `/rest/v1` 호출 0(테스트 16).
- 프로브 URL은 `object/list/community-images`, `object/info/community-images/`만(테스트 14b). 다른 bucket 접근 불가(상수).
- Storage 경로는 bucket 목록에서만 얻는다. DB `PostImage.path`가 참조 판정의 source of truth.
- 출력: 개수·바이트·나이. `--verbose`여도 경로는 userId/UUID 앞 4자만.

## 9. 테스트 결과

| 명령 | 결과 |
|---|---|
| `npx tsx --test src/lib/community/community-image-orphan-audit.test.ts` | 26/26 pass |
| `npx tsx --test $(find src -name "*.test.ts" -o -name "*.test.mjs")` | 1932/1932 pass |
| `npx tsc --noEmit` | exit 2 — **FAIL_EXISTING_SCRIPT_ERRORS**: 25 오류, 전부 기존 `scripts/**`·`tmp/**`(15파일). 변경 파일·src 0 |
| `npx eslint` (변경 3파일) | exit 0 |
| `npm run build` | exit 0 |

## 10. 알려진 한계

- 경로 #2(클라이언트 정리 호출 실패)는 서버 로그가 남지 않아 dry-run으로만 발견된다.
- `UNKNOWN_OWNER`는 삭제하지 않는다(예: `qa-storage-verify` 검증 잔여물). 필요 시 사람이 개별 판단.
- 공개 bucket이라 삭제 후 최대 1h CDN 캐시 창이 있다(COMMUNITY_IMAGE_UPLOAD_V1 §QA와 동일).
- 감사 스캔은 5만 객체에서 멈춘다(부분 결과로 판정하지 않음). 그 규모 전에 SQL 목록 조회로 전환 필요.

## 11. 다음 STEP (승인 필요)

PHASE 2 — 실제 삭제(`--apply`) 또는 cron 자동화는 **사용자 명시 승인 후에만** 진행한다. 현재 후보 0이라 즉시 필요하지 않다.
