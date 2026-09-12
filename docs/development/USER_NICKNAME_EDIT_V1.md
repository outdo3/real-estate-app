# USER NICKNAME EDIT V1

브랜치: `main` / 기준 커밋: `da8ecac`

로그인 사용자가 MY 프로필 카드에서 자기 닉네임을 직접 바꿀 수 있게 한다.
**스키마 변경 없음**, migration 없음.

## 1. 감사 결과 (구현 전)

| 질문 | 답 |
|---|---|
| User 모델 | `name String @map("nickname")` — **NOT NULL**, **unique 없음** |
| 기존 수정 API | **없음.** `/api/my/{favorites,preferences,recent}`만 존재 |
| MY 프로필 로딩 | `useSession()` — 별도 fetch 없음 |
| 세션의 name | NextAuth 기본 동작으로 로그인 시 `user.name → token.name → session.user.name` |
| 커뮤니티 작성자명 | **live join.** Post/Comment는 `authorId`만 저장하고 조회 시 `author: { select: { name } }` |
| 기존 글/댓글 반영 | **자동 반영.** snapshot이 아니므로 bulk update가 필요 없다 |
| uniqueness | **없음** — 중복 닉네임 허용이 현재 정책 |
| 관리자 회원목록 | `u.name`을 DB에서 읽으므로 즉시 반영 |
| 재로그인 overwrite | **덮어쓰지 않음** (§7 참고) |

→ **스키마 변경 불필요. 현재 스키마로 그대로 구현.**

## 2. 재로그인 보호 — 이미 안전했다 (§7)

가장 먼저 확인한 위험이다. 사용자가 닉네임을 바꿔도 다음 로그인에 provider 이름으로
되돌아가면 기능 자체가 무의미하기 때문이다.

설치된 next-auth v4의 `core/lib/callback-handler.js`를 직접 읽어 확인했다: 이미 연결된
계정으로 다시 로그인하면

```js
return { session, user: userByAccount, isNewUser };
```

**기존 사용자를 그대로 반환하고 `updateUser`를 호출하지 않는다.** `createUser`는 신규
가입 때만 실행된다. 우리 코드도 로그인 경로에서 `name`을 건드리지 않는다.

→ 보호 장치를 **새로 만들지 않았다.** 이미 그렇게 동작한다. 대신 이 전제가 깨지면
바로 드러나도록 테스트로 고정했다(v4 동작 + 우리 콜백 + 어댑터 세 가지).

## 3. 검증 규칙 (§3)

`src/lib/nickname.ts` — 순수 함수.

- `trim`
- 빈 문자열 거부
- **2~20자** (코드 포인트 기준)
- 제어문자 거부 (C0 `0x00-0x1F`, DEL/C1 `0x7F-0x9F`)
- **중복 허용** — `User.name`에 unique가 없고, 임의로 붙이면 이미 같은 이름을 쓰는
  기존 사용자가 저장에 실패한다
- 금칙어 사전 **없음** — 운영 기준 없이 만든 필터는 멀쩡한 이름을 막고 막아야 할 것은
  못 막는다

길이를 `Array.from().length`로 세는 이유: `'집🏠'.length`는 3이지만 사용자가 보는 글자는
2개다. `.length`를 쓰면 이모지 두 개짜리 닉네임이 "4자"로 계산돼 거부된다.

제어문자 판정은 정규식 문자 클래스가 아니라 **코드 포인트 비교**로 한다 — 소스에
제어문자를 리터럴로 적으면 에디터/도구마다 다르게 보이고 diff가 조용히 깨진다.

## 4. API (§4)

`PUT /api/my/profile`

```
요청  { "nickname": "이집유저" }
성공  { "success": true,  "data": { "nickname": "이집유저" } }
실패  { "success": false, "error": "닉네임은 2~20자로 입력해주세요." }
```

기존 `/api/my/preferences` 패턴을 그대로 따른다.

- `userId`는 **항상** `requireUser()`가 돌려준 세션 사용자에서만 온다.
  요청 본문의 사용자 식별자는 신뢰하지 않는 정도가 아니라 **아예 읽지 않는다.**
- 인증 확인이 본문 파싱보다 먼저 온다.
- 미로그인 401, 차단 계정 403 (`requireUser`의 기존 동작).
- 이 라우트는 `name`만 쓴다. 이메일·이미지는 코드에 등장하지 않는다(§2/§10).
- 실패 로그에 닉네임 값을 남기지 않는다 — 정적 문자열 하나만 찍는다(테스트로 고정).

## 5. 세션 갱신 (§5)

세션이 JWT 전략이라 `token.name`은 **로그인 시점에 구워진다.** DB만 바꾸면 토큰이
갱신될 때까지 헤더와 MY에 옛 이름이 남는다.

그래서 저장 후 `useSession().update()`를 호출하고, `jwt` 콜백에 `trigger === 'update'`
분기를 추가했다.

```ts
if (trigger === 'update' && token.id) {
  const fresh = await prisma.user.findUnique({ where: { id: token.id }, select: { name: true } });
  if (fresh) token.name = fresh.name;
}
```

**`update()`가 넘긴 값을 쓰지 않고 DB에서 다시 읽는 이유**: `update()`의 인자는
클라이언트가 정하는 값이다. 그대로 토큰에 넣으면 저장하지 않은 이름을 자기 세션에
표시할 수 있다(표시명 위조). DB를 진실로 삼으면 그 경로가 생기지 않는다. 그래서
클라이언트도 인자를 넘기지 않는다 — `updateSession()`을 인자 없이 부른다.

커뮤니티 작성자명은 원래 User를 live join하므로 이 경로와 무관하게 항상 정확하다.

조회는 **명시적 update 때만** 일어난다. 매 요청 인증 비용은 그대로다.
조회가 실패해도 `try/catch`로 삼켜 로그인 상태를 깨뜨리지 않는다 — 이름만 갱신되지 않는다.

> 이 변경은 `authOptions.callbacks.jwt`를 건드린다. AGENTS.md의 auth 승인 규칙에
> 걸리는 영역이라 범위를 명시해 둔다: **추가만 했고**(기존 분기 그대로), 명시적
> update 트리거에서만 동작하며, 세션 전략·provider·계정 연결 로직은 손대지 않았다.

## 6. UI (§2/§8)

MY 프로필 카드 **인라인 편집**. 모달을 새로 만들지 않았다.

```
표시: [아바타] 이집유저 [일반회원] [닉네임 변경]
                user@example.com

편집: [아바타] [__________________]
                [저장] [취소]
                user@example.com
```

- 저장 중 입력·버튼 `disabled`, 라벨이 `저장 중...`으로 바뀐다
- 오류는 `role="alert"`, 성공은 `role="status"`로 인라인 표시(2.5초)
- Enter 저장 / Escape 취소
- 입력 `font-size: 16px` — iOS·안드로이드는 16px 미만 입력에 자동 확대를 걸어
  키보드가 열릴 때 화면이 튄다
- `닉네임 변경` 버튼은 시각적으로 작지만 터치 타깃 32px, 저장/취소는 40px
- **이메일은 읽기 전용**, 프로필 사진 수정 기능 없음(§2/§10)

## 7. 커뮤니티 반영 (§6)

| 대상 | 동작 |
|---|---|
| 새 글 작성자명 | 새 닉네임 |
| 새 댓글 작성자명 | 새 닉네임 |
| **기존 글/댓글 작성자명** | **새 닉네임** (live join) |
| 관리자 회원목록 | 새 닉네임 |

Post/Comment에 작성자명 컬럼이 없고 조회 시마다 User를 join하므로 **bulk update가
필요 없고, 하지 않았다.** 테스트가 이 전제(비정규화 컬럼 부재 + live join select)를
고정한다.

## 8. 모바일 밀도 (§8)

`.nickname`이 이미 `flex-wrap: wrap`이라 360px에서 이름 + 역할 배지 + 변경 버튼이 한 줄에
안 들어가면 자연스럽게 접힌다. 편집 모드는 입력 1줄(약 38px) + 버튼 행(40px)이라
표시 모드 대비 카드 높이가 약 50~60px 늘어난다 — 카드 구조 자체는 그대로다.

> CSS 박스 계산이며 **브라우저 실측이 아니다.** 이 환경에 브라우저가 없어
> 360 / 390 / 430px 실제 렌더는 확인하지 못했다 — **DEVICE QA REQUIRED.**

## 9. 테스트

`src/lib/nickname.test.ts` — 24개, 전부 PASS.

검증(정상/trim/빈 값/길이 경계/코드 포인트/제어문자/잘못된 형태/금칙어 부재) ·
스키마 무변경(name non-unique, email unique 유지) · 커뮤니티 snapshot 부재 ·
소유권(세션 사용자만, body userId 미사용, 인증 우선) · 범위(이메일·사진 미수정) ·
로그 PII 부재 · update 트리거 전용 조회 · **클라이언트 값 미신뢰** · 조회 실패 내성 ·
세션 갱신 배선 · **재로그인 overwrite 부재** · provider/링크 로직 무변경 · UI 계약 ·
16px 입력.

전체: `npx tsx --test "src/**/*.test.ts"` → **922/922 PASS**

## 10. 검증

```
npx tsc --noEmit          src/ 오류 0
npx eslint <변경 파일>     오류 0 (auth.ts:54 경고는 HEAD에도 동일 — 사전 존재)
npm run build             Compiled successfully · ƒ /api/my/profile 등록 확인
```

## 11. 건드리지 않은 것 (§10)

OAuth 콜백 URL · provider credentials · Naver 검수 설정 · DB 스키마/migration ·
이메일 수정 · 프로필 사진 수정 · 커뮤니티 재설계 — 전부 무변경.
