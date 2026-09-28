# E-JIP GYEONGGI 8 PREVIEW FINAL BLOCKER + DEPLOY V1

날짜: 2026-09-28 · 브랜치 `gyeonggi-8-public-beta-preview-v1` · main/Production 변경 0

## 1. 공급 API 노출 수정 (`4401d13`)

**문제:** `/api/stats/supply`는 서울만 막는 deny-list(`isSeoulPublicBlocked`)였다. 경기는 전 축이 닫혀 있는데도 경기 분양 데이터를 돌려줬다.
Production 실측(2026-09-28): `sido=경기도` → 186건, `sido=경기도&sigungu=수원시` → 12건. **이 수정은 아직 Production에 없다.**

**결정:** enablement에 명시적 `supply` 축을 추가했다.
`stats`로 판정하면 서울 beta 8구의 기존 공급 노출(stats 닫힘 + 공급 허용, SEOUL_BETA_EXPOSURE_LEAK_CLOSE_V1)이 조용히 바뀐다.
`app`으로 판정하면 Preview 경기 8구가 열린다. 그래서 둘 다 쓰지 않았다.

| 축 값 | supply |
|---|---|
| 부산(시도 층) | true |
| 서울 beta 8구 | true (기존 정책 유지) |
| 경기 beta 8구(Production 스위치·Preview 스위치 공통) | false |
| 그 밖(NOT_ENABLED) | false |

**게이트** `src/lib/stats/supply-region-gate.ts` `decideSupplyRegion(sidoFull, sigungu)`
- 시도만: 시도 층 `supply`가 true인 시도만 통과한다(부산). "서울 전체"·"경기도 전체"는 막힌다.
- 시도 + 시군구: 그 시도 registry 노드 중 하나로 해석한다. 먼저 fullName이 정확히 일치하는 노드("수원시 장안구" → 41111), 없으면 짧은 이름이 정확히 하나 일치하는 노드. 0개나 2개 이상이면 UNKNOWN_REGION.
  부모 시("수원시" 41110)는 자기 노드(닫힘)로 판정한다. 다른 시도 이름·부분 일치·공백 변형은 막힌다.
- registry 밖 시도(대구 등)는 막힌다. 이전에는 통과했지만 UI 선택기로는 도달할 수 없는 경로다.
- **"전국"(sido 없음) 요청은 바꾸지 않았다.** 청약홈 전국 목록이라 경기 행도 포함된다. 이를 막으면 부산 사용자의 "전국" 칩이 바뀌므로 별도 제품 결정 대상이다.
- seed apply 게이트의 `PUBLIC_AXES`에 `supply`를 추가했다(경기 seed 대상이 공급에서도 닫혀 있어야 guarded).

## 2. Preview 게이트 재확인

두 값이 모두 참일 때만 열린다: `NEXT_PUBLIC_VERCEL_ENV === 'preview'`, `NEXT_PUBLIC_GYEONGGI_8_BETA_PREVIEW === 'true'`.
테스트(실제 env 재로딩) 결과:

| 조건 | 결과 |
|---|---|
| Production + true | CLOSED |
| env 없음 | CLOSED |
| Preview + 잘못된 값(TRUE·' true'·1·false·빈 값) | CLOSED |
| Preview + 'true' | 정확히 8구 app·search·map·detail |

## 3. Vercel 설정 감사(읽기 전용)

| 항목 | 값 |
|---|---|
| `autoExposeSystemEnvs` | true → `NEXT_PUBLIC_VERCEL_ENV` 공급됨 (배포 번들에 `gyeonggiBeta:!0` 인라인 확인) |
| productionBranch | main · GitHub 연결 · 브랜치 배포 enabled |
| Deployment Protection | **없음**(ssoProtection null, 비밀번호 없음) → Preview URL은 누구나 열 수 있다. 응답에는 Vercel이 `x-robots-tag: noindex`를 붙인다 |
| `DATABASE_URL` | **Production 전용** → Preview에는 DB가 없다 |

**추가한 env(유일한 Vercel 변경):** `NEXT_PUBLIC_GYEONGGI_8_BETA_PREVIEW=true`
- 범위: Config 타입, **Preview · 브랜치 `gyeonggi-8-public-beta-preview-v1` 한정**. Production에는 GYEONGGI 변수가 0개다.
- Vercel은 GitHub에 없는 브랜치에는 브랜치 한정 변수를 거부한다(`branch_not_found`). 그래서 순서를 이렇게 했다: 브랜치 push → 변수 추가 → 해당 Preview 재배포.

## 4. 배포

| 배포 | target | 상태 |
|---|---|---|
| `real-estate-7h19fqpy5` (push 직후, 플래그 없음) | preview | Ready |
| `real-estate-6tt1qz044` (`dpl_C4RnEwMpVHURL7ZRaXSAuKqAcmgH`, 플래그 포함 재배포) | **preview** | Ready |
| 브랜치 alias | `real-estate-app-git-gyeonggi-8-public-beta-preview-v1-park11.vercel.app` | |
| Production 최신 | `real-estate-4tkiadhzq` (1일 전) — 변화 없음 | |

main·origin/main = 2343646 그대로.

## 5. Preview smoke(가벼운 요청만 — 각 게이트가 DB·MOLIT 전에 끝나는 경로 위주)

| 항목 | Preview | Production(e-jip.com) |
|---|---|---|
| 선택기(실제 REGCODE 목록 48행에 배포와 같은 필터 적용) | 시도 서울·부산·경기도 · "경기도 전체" 없음 · 정확히 8구 | 경기도 없음 |
| `/api/stats/supply` 경기 영통·장안·분당·수원시·경기도 전체 | 전부 UNSUPPORTED | **OK — 경기도 186건·수원시 12건(기존 누출, 미배포 수정)** |
| `/api/transactions` 41135 | regionUnsupported | regionUnsupported |
| `/api/transactions` 41117 | 미호출(게이트가 열려 live MOLIT로 간다) | regionUnsupported |
| `/api/apt/x/verify` 41135-1 | regionUnsupported | regionUnsupported |
| `/api/apt/x/verify` 41117-1 | **500 — 게이트 통과 후 DB 없음** | regionUnsupported |
| 상세 41117 | 200 · 단지 제목 · `noindex, nofollow` · canonical 없음 (NOINDEX) | 일반 제목 · noindex · canonical 없음 (BLOCKED) |
| 상세 41135 | BLOCKED(일반 제목 · noindex · canonical 없음) | BLOCKED |
| 리포트 41117·41135 | BLOCKED(noindex · canonical 없음) | BLOCKED |
| sitemap.xml | 500(DB 없음) | 200 · 139 URL · 경기 0 |

**검증하지 못한 것(DB 필요):** 검색 결과, 지도 마커(master 좌표), 상세 데이터, 비교, sitemap(Preview).

## 6. 모바일 QA — HOLD

Preview에 DB가 없어 검색·지도·상세·비교를 실측할 수 없다. 오류 화면을 QA 결과로 쓰지 않는다.
진행하려면 사용자 결정이 필요하다.
- (a) Production `DATABASE_URL`을 이 브랜치 Preview에만 추가한다. 이 경우 Preview의 일반 사용(분석 이벤트·캐시 upsert 등)이 Production DB에 쓴다. Deployment Protection도 함께 켜는 것을 권장한다.
- (b) 읽기 전용 DB 역할·복제본을 만들어 Preview에 연결한다(인프라 작업).
- (c) Production 승인 후 실측한다.

## 7. 테스트·빌드

| 명령 | 결과 |
|---|---|
| `npx tsx --test` 공급·region·report·sitemap·seo·map·seed-logic | 640 pass · 0 fail · 6 skipped(DB integration, env 없음) |
| src 전체(integration 제외) | 2733/2735 — 실패 2건은 기존 워크트리 CRLF 전용(main 체크아웃 46/46) |
| eslint 변경 파일 | 0 problems |
| `npx tsc --noEmit` | 21 기존 `scripts/` 오류, 그 밖 0 → FAIL_EXISTING_SCRIPT_ERRORS |
| `npm run build`(Preview env 없음) | exit 0 · Vercel Preview 빌드 2회 Ready |

## 8. cron 런타임 검증

PENDING. 수동 cron 호출 없음. 검증기 `--verify`는 이번 STEP에서도 실행하지 않았다.
