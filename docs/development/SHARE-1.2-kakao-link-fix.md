# STEP SHARE-1.2 — KakaoTalk 공유 카드/CTA 클릭 → 상세페이지 이동 문제

상태: **코드 조사 완료(버그 없음 확인) — 실제 물리기기 클릭 검증은 아직 미완료
(Kakao Developers 콘솔 확인이 사용자 액션으로 필요)**

## 문제

실기기 KakaoTalk에서 공유 카드는 정상 표시(SHARE-1.1에서 이미 해결)되지만,
카드 본문 또는 "이집에서 자세히 보기" CTA를 클릭해도 아파트 상세페이지로
이동하지 않는다는 리포트.

## 완료 판정 기준(이번 STEP 시작 시 명시)

payload 검증만으로 완료 처리하지 않는다 — 실제 KakaoTalk 클릭 성공이 필요.
**이 기준을 그대로 지켰고, 이번 STEP에서 실제 물리기기 클릭까지는 확인하지
못했다** — 아래 unresolved 참고.

## 기존 코드 재확인(재작성 없음)

`src/components/KakaoShareButton.tsx`를 처음부터 다시 읽고 구조 확인 —
SHARE-1/SHARE-1.1에서 만든 그대로, 재작성 없음:

```ts
Kakao.Share.sendDefault({
  objectType: 'feed',
  content: { title, description, imageUrl, link: { mobileWebUrl, webUrl } },
  buttons: [{ title: '이집에서 자세히 보기', link: { mobileWebUrl, webUrl } }],
})
```

`buildShareUrl()`은 `window.location.origin + pathname + search`를 그대로
조합 — production 도메인/preview 도메인 구분 없이 항상 "지금 실제로 열려있는
도메인"을 쓴다(하드코딩된 origin 없음, localhost 유입 불가능).

## 실물 payload 검증(production, 2개 아파트, 실제 클릭 이벤트로 캡처)

`window.Kakao.Share.sendDefault`를 몽키패치해 실제 버튼 클릭이 만드는
payload를 그대로 캡처했다(코드 수정이 아니라 브라우저 런타임에서만 검증 —
저장소에는 아무 흔적도 남지 않음). 텍스트 추출 도구가 쿼리스트링을 포함한
값을 자동 차단해, 캡처한 값을 페이지에 직접 렌더링한 뒤 스크린샷으로
읽었다(값 자체를 로그/파일로 옮기지 않음).

**아파트 A — 대신롯데캐슬(`lawdCd=26140&dong=서대신동3가`)**:

```text
content.link.mobileWebUrl = https://real-estate-app-park11.vercel.app/apt/%EB%8C%80%EC%8B%A0%EB%A1%AF%EB%8D%B0%EC%BA%90%EC%8A%AC?lawdCd=26140&dong=%EC%84%9C%EB%8C%80%EC%8B%A0%EB%8F%993%EA%B0%80
content.link.webUrl        = (위와 완전히 동일)
buttons[0].link.mobileWebUrl = (위와 완전히 동일)
buttons[0].link.webUrl       = (위와 완전히 동일)
```

**아파트 B — 대신푸르지오1차(`lawdCd=26140&dong=서대신동1가`)**:

```text
content.link.mobileWebUrl === buttons[0].link.mobileWebUrl  → true
content.link.mobileWebUrl === content.link.webUrl           → true
```

두 아파트 전부 확인된 것:

- **origin이 실제 production 도메인**(`real-estate-app-park11.vercel.app`) —
  localhost/preview 도메인 유입 없음.
- **pathname의 아파트명이 정확히 한 번만 percent-encoding됨** — 디코딩하면
  "대신롯데캐슬"/"대신푸르지오1차"로 정확히 복원됨, `%25`로 시작하는 이중
  인코딩 패턴 전혀 없음.
- **`lawdCd`(26140)와 `dong`(서대신동3가/서대신동1가) 둘 다 쿼리스트링에
  정확히 보존**됨(단축/생략 없음, `/apartments`나 홈으로 축약되지 않음).
- **`content.link`와 `buttons[0].link`가 완전히 동일한 URL**(카드 클릭과
  CTA 클릭이 서로 다른 곳으로 가는 문제 없음).
- **`mobileWebUrl === webUrl`**(두 필드가 다른 값이라 한쪽만 깨지는 경우
  없음).

**결론: payload/코드 레벨 버그는 발견되지 않았다.** SHARE-1/1.1에서 검증한
것과 동일하게 이번에도(R6 이후 최신 배포 기준) 완전히 정확한 payload가
production에서 실제로 만들어지고 있다.

## 추가 code-level 가능성 점검(섹션 9 지시대로 하나만 추측해서 고치지 않음)

- **navigator.share fallback 회귀**: `handleShare()`의 우선순위(Kakao SDK →
  navigator.share → clipboard)는 SHARE-1 이후 무변경 확인. SDK가 준비된
  상태(`sdkReadyRef.current` true)면 navigator.share로 떨어질 경로 자체가
  없음(코드 구조상 `return`으로 즉시 종료) — 회귀 없음.
- **iOS/Android 앱링크 하이재킹**: production 도메인에
  `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`,
  `/apple-app-site-association` 전부 **404**(존재하지 않음) — 다른 앱이
  이 도메인의 링크를 가로채도록 등록된 흔적 없음.
- **응답 헤더**: 실제 아파트 상세 페이지 응답에 `X-Frame-Options`나
  `Content-Security-Policy`로 인앱 브라우저 렌더링을 막을 만한 헤더 없음,
  예상치 못한 리다이렉트(`Location` 헤더) 없음.
- **CTA 문구**: "이집에서 자세히 보기" 그대로 유지(변경 없음).
- **카카오 전용 공유 이미지**: `public/brand/share/ejip-kakao-share-1200x630.jpg`
  그대로 유지, SEO/Twitter OG(`ejip-og-main-1200x630.jpg`)는 건드리지
  않음.

## 판정: 카테고리 B(섹션 24)

```text
A. 링크 payload 자체가 틀림           → 아니다(2개 아파트로 실물 검증)
B. payload는 정확하지만 클릭이 안 됨   → 이 경우로 판단
C. CTA만 실패                        → 아니다(카드/CTA link 완전 동일)
D. card만 실패                       → 아니다(위와 동일)
```

코드가 만들어 보내는 값 자체는 완벽하므로, 클릭이 안 되는 원인은 **Kakao
Developers 콘솔 설정** 쪽일 가능성이 가장 높다. Claude는 카카오 개발자
콘솔에 접근/변경할 수 없어(로그인 필요, 이 세션에 권한 없음) 코드를
추측으로 고치지 않고 정확히 확인해야 할 항목만 아래에 남긴다.

## 사용자가 확인해야 할 Kakao Developers 설정(섹션 8)

앱: **이집(앱 ID 1534780)** — 새 앱 생성 금지, 기존 앱에서만 확인.

1. **내 애플리케이션 → 이집 → 앱 설정 → 플랫폼(Platform)**
   - "Web" 플랫폼이 등록되어 있는지 확인.
   - 등록된 사이트 도메인이 정확히 `https://real-estate-app-park11.vercel.app`
     인지 확인(트레일링 슬래시 유무, http/https, 오래된 preview 도메인이
     남아있는지 등 문자 그대로 비교).
   - 등록이 없거나 다른 도메인이면 정확한 production 도메인을 추가.
2. **제품 설정 → 카카오톡 공유(Kakao Talk Sharing)**
   - 활성화 상태(ON)인지 확인(SHARE-1에서 이미 정상 동작한 이력이 있어
     가능성은 낮지만, 재확인 대상).
3. 위 두 가지를 확인/수정한 뒤에도 문제가 재현되면, 실제 클릭 시
   KakaoTalk이 표시하는 오류 메시지(있다면)를 캡처해 다음 STEP에 전달.

이 설정들은 코드 저장소 밖의 외부 서비스 설정이라 Claude가 직접 확인하거나
변경할 수 없다.

## typecheck / lint / build

이번 STEP은 코드 변경이 없어(버그를 찾지 못함) 별도 diff가 없다. 그래도
기존 상태가 여전히 깨끗한지 재확인:

```text
npx tsc --noEmit   — 0 errors
npx eslint(KakaoShareButton.tsx) — 0 errors
npx next build     — 성공, 기존 라우트 회귀 없음
```

## unresolved

1. **실제 물리기기 KakaoTalk 클릭 테스트는 이번 STEP에서 수행하지
   못했다** — 이 환경에는 KakaoTalk 앱이 설치된 물리 기기가 없다. 사용자가
   위 Kakao Developers 설정을 확인/수정한 뒤 직접 실기기에서 카드 클릭과
   CTA 클릭을 각각 테스트해야 한다.
2. 만약 도메인 등록을 확인/수정했는데도 여전히 재현되면, 카카오톡 앱
   버전별(Android/iOS) 차이, 또는 카카오 인앱 브라우저 자체의 문제일
   가능성까지 열어두고 다음 STEP에서 추가 조사가 필요하다.

## APARTMENT SCORE S1 판단

코드/payload 자체에는 BLOCKER가 없다(완전히 검증됨) — 하지만 실제 클릭
성공이라는 이번 STEP의 완료 기준 자체는 아직 충족되지 않았다. 코드
관점에서는 GO, **실사용 완료 관점에서는 사용자의 Kakao Developers 설정
확인 + 실기기 클릭 테스트가 남아있어 조건부**로 판단한다.
