# E-JIP HOME SHARE ENTRY V1

## 목적

홈(`/`)에는 공유 진입점이 없었다. SHARE UX V2의 공통 시트([카카오톡] [공유하기] [링크 복사])를
**그대로 재사용**해 홈에서도 `https://e-jip.com/`을 공유할 수 있게 한다. 새 공유 로직 0.

## 분석

- 12개 공유 표면은 모두 `ShareAction` → `useShareSheet` → `ShareSheet`(body portal, z 3000)를 쓴다.
- `url="/"`을 넘기면 `buildCanonicalShareUrl` → `withCanonicalOrigin('/', resolveCanonicalShareOrigin(siteConfig.url))`
  → 어느 호스트(localhost/*.vercel.app)에서 눌러도 `https://e-jip.com/`. `params`를 넘기지 않으므로 쿼리/디버그 파라미터도 실리지 않는다.
- 모바일 홈 헤더는 로고(좌) + 로그인/프로필(우)뿐이고 가운데가 비어 있다(메뉴는 fixed 하단 탭바) → 프로필과 충돌 없이 우측에 아이콘 하나를 둘 자리가 있다.

## 설계 결정

1. 위치: **헤더 우측, 로그인/프로필 버튼 바로 왼쪽**(우선순위 1안). hero 영역은 건드리지 않는다.
2. `Header`에 선택 prop `actionSlot` 추가. 주면 `[actionSlot][HeaderAuthButton]`을 `.rightCluster`(margin-left:auto)로 묶고,
   **주지 않으면 기존 DOM 그대로** `<HeaderAuthButton />`만 렌더한다 → 다른 모든 페이지 영향 0.
3. 버튼은 `ShareAction variant="icon"` 그대로. 떠 있는 버튼용 흰 원/테두리/그림자만 `button.headerShareBtn`으로 제거해
   검색창보다 시각적으로 약하게 둔다(터치 영역 44×44 유지, lucide `Share2`).
4. 문구: title `이집(E-JIP)`, text `복잡한 부동산, 이집으로 쉽게.\n부산 아파트 실거래가·거래량·학군·부동산 정보를 한곳에서 확인하세요.`
   - 공통 계약(`withEjipSuffix`)상 **카카오 카드 제목은 `이집(E-JIP) | 이집`**이 된다. 요청서 §4의 "기존 패턴 우선" 규칙에 따라 공통 빌더를 바꾸지 않았다.
   - 카카오 설명은 공통 `stripUrls`가 줄바꿈을 공백으로 합친다. 네이티브 공유 본문은 줄바꿈 유지.
5. 분석: 공통 훅의 `share_attempt/share_kakao/share_native/share_copy/share_success`를 그대로 쓴다. 1st-party 이벤트에는
   page/source 필드가 없어 홈 구분 불가, GA4는 `page_location`으로 구분된다. 새 이벤트/스키마 0.

## 구현 내용

- `src/components/Header.tsx` / `Header.module.css` — `actionSlot` prop + `.rightCluster`
- `src/app/home-client.tsx` / `home-client.module.css` — 헤더 `ShareAction` + `button.headerShareBtn`
- `src/lib/share/shareChannels.test.ts` — §I 3건(홈 URL 정규화, 공통 컴포넌트 재사용·자체 구현 금지, Header 기본 분기 불변)

## 테스트 결과

- `npx tsx --test src/lib/share/shareChannels.test.ts src/lib/share/ejipShareCard.test.ts` → 50 pass / 0 fail
- `npx tsx --test` map-entry-context / feature-flags / recent-auth-parity → 40 pass / 0 fail
- `npx tsc --noEmit` → FAIL_EXISTING_SCRIPT_ERRORS(25건 전부 `scripts/`·`tmp/`, `src/` 0)
- `npm run lint` → exit 1, 1,638 errors = `.worktrees/` 1,633 + `scripts/` 5. 변경 파일 3개 errors 0 / warnings 0
- `npm run build` → exit 0
- 로컬 `next start` iframe 실측 360/375/390/1280: 헤더 overflow 0, 겹침 0, 공유 버튼 44×44, 헤더 높이 56(데스크톱 65) 불변
- 로컬 SSR ↔ 배포 전 Production: title/description/H1/JSON-LD 4/소개 본문 121자/내부 링크 3개 동일

## 알려진 문제 / 남은 공유 갭

- 카카오 카드 제목 `이집(E-JIP) | 이집` 중복감 — 공통 접미사 규칙 변경은 별도 결정 필요.
- 1st-party 공유 이벤트에 표면(source) 구분 없음 — 표면별 공유 지표가 필요하면 별도 STEP.
- 듀얼 카카오톡 실기기 검증 NOT_TESTED(SHARE UX V2부터 이어진 항목).
