# E-JIP GYEONGGI 8 PUBLIC BETA PREP + PREVIEW QA V1

날짜: 2026-09-28 · 브랜치 `gyeonggi-8-public-beta-preview-v1`(main 2343646 기준) · **로컬 전용 — push·배포·env 변경·DB 쓰기 0**

## 1. 목적

경기 승인 8구(41111·41113·41115·41117·41131·41133·41150·41210)를 **Preview 빌드에서만** 공개해 모바일 QA를 할 수 있게 한다.
Production은 경기 전 축 닫힘을 유지한다.

## 2. 기준 상태

| 항목 | 값 |
|---|---|
| main = origin/main | 2343646 (eb87b2e 내구성 수정 배포 기록) |
| 8527c6e (blocker 준비) | 로컬 브랜치 `gyeonggi-beta-blockers-prep`에만 있음 · main 미포함 · 미배포 |
| 8527c6e의 부모 | 5d03257 — 이후 main 변경(eb87b2e·2343646)은 cron/sync 파일과 문서만 건드림 |
| Production 경기 | `GYEONGGI_BETA_ENABLED = false` → 경기 전 축 닫힘 |

## 3. 8527c6e 검토 — **FULL 재사용**

- 코드 파일 겹침 0: 5d03257..main은 `src/lib/sync/*`, `scripts/*-molit-fetch.ts`, `src/lib/sync-coverage.ts`만 바꿨다. 8527c6e는 지도·리포트 링크·학교·테스트만 바꿨다.
- cherry-pick 결과 b7bc120. 충돌은 `CHANGELOG.md` 하나였고, 두 항목을 모두 남겨 해결했다.
- 낡은 가정 없음: 모든 게이트가 `isPublicRegionAllowed`(allowlist)를 쓰고, 그 판정은 이번 STEP의 스위치를 그대로 따른다.
- **병합 순서 주의(미해결, 기록만)**: 로컬 전용 d9622da(서울 25 Preview 준비)도 같은 리포트 CTA 문제를 다른 helper로 고쳤다
  (`isReportRegionOpen` ↔ 이번 `publicAptReportHref`/`publicCompareReportHref`). 또 `enablement.ts`의 `buildLawdCdEnablementMap`,
  `apt-client.tsx` 642행, `CompareV2.tsx`, `apt-report-cta-flow.test.ts`도 둘 다 수정한다.
  두 번째로 병합하는 쪽이 helper를 하나로 합쳐야 한다(의미는 같다: aptSeq 앞 5자리의 `report` 축).

## 4. 구현 — Preview 전용 스위치

`src/lib/region/enablement.ts`

```
resolveGyeonggi8PreviewFlag(vercelEnv, flag) = vercelEnv === 'preview' && flag === 'true'
GYEONGGI_8_BETA_PREVIEW_ENABLED = resolve(process.env.NEXT_PUBLIC_VERCEL_ENV, process.env.NEXT_PUBLIC_GYEONGGI_8_BETA_PREVIEW)
ENABLEMENT_BY_LAWDCD.gyeonggiBeta = GYEONGGI_BETA_ENABLED(false) || GYEONGGI_8_BETA_PREVIEW_ENABLED
```

- 이 스위치가 여는 목록과 축은 Production 스위치를 켤 때와 같다(`GYEONGGI_BETA_LAWDCDS` × `GYEONGGI_BETA_ENABLEMENT`):
  app·search·map·detail만 열고, report·stats·sitemap·seoIndex·cronSync는 닫는다.
- 기본값은 닫힘이다. env가 없거나, `'preview'`/`'true'`와 조금이라도 다르면(대소문자·공백·`1` 포함) false다.
  Production에 플래그를 잘못 넣어도 VERCEL_ENV가 `'production'`이라 열리지 않는다.
- 빌드 산출물 확인(env 없이 빌드): 값이 정의되지 않은 NEXT_PUBLIC 변수는 Next가 치환하지 않는다. 그래서 chunk에 `process.env.…` 조회가 남고, 브라우저에서는 undefined라 false다.
  Preview에서 두 값이 정의되면 빌드 시 리터럴로 인라인된다(서울 25 Preview와 같은 방식).
- cronSync는 바꾸지 않았다. Preview의 경기 8구 상세·지도는 DB-first가 아니라 live MOLIT 경로를 탄다.
  이는 `isTradeDbFirstLawdCd = false`의 기존 설계대로다.

## 5. QA 결과(시뮬레이션 + 실제 env 재로딩, DB·네트워크 0)

| 영역 | 확인 내용 | 근거 테스트 |
|---|---|---|
| 검색 | allowlist 32 = 부산 16 + 서울 8 + 경기 8. 경기는 정확히 8구다. 41135, 부모 시 41110·41130, 나머지 경기, registry 밖 코드는 닫힘. alias fallback도 같은 게이트를 쓴다 | preview-on, public-exposure-guard 5·14·16 |
| 지도 | 8구는 안내 없음. 41135·나머지 경기는 "아직 지원하지 않는 지역"(0건 문구와 분리, 캐시에 보존). null 좌표는 마커 없음(0,0·다른 단지 좌표 없음). 닫힌 구는 MOLIT·master 조회 전에 거부 | preview-on, blockers 1–3b·10·11, readiness 6·8 |
| 상세 | detail 축 게이트: 본 API·info·education·score·verify·facilities. canonical aptSeq 좌표가 없으면 NO_COORDINATE(이름 검색으로 내려가지 않음). 점수는 입지 피처가 없으면 부적격 | readiness 7·12, public-exposure-guard 7 |
| 선택기 | 경기 시도는 보인다. "경기도 전체"는 `isSidoPartiallyPublic('41') = true`라 없다. 구 목록 = 정확히 8구. 부산·서울은 그대로 | preview-on |
| 리포트·통계·SEO·sitemap | 8구 리포트 CTA·비교 리포트 CTA 없음. 리포트 페이지 BLOCKED. 상세는 NOINDEX(canonical 없음). stats 축 닫힘. sitemap은 부산 전용 구성이라 경기 0 | preview-on, readiness 13–16, sitemap-scope |
| 학교·위치 | lawdCd로 "수원시 장안구"처럼 구 전체를 정한다(수원 4구·성남 2구 분리, 시 단위 합산 없음). 연속 토큰 정확 일치. 부산 통학구역을 경기 동명 학교에 쓰지 않는다. 유치원은 "준비 중". 법정동은 정확 일치(교동 ≠ 매교동). info/facilities 캐시는 lawdCd 범위 | preview-on, blockers 7–9b, readiness 9–11b·164·175 |
| 회귀 | 부산 전 축, 서울 8구(report 닫힘, DB-first 유지), 차단 서울 17구가 Preview env에서도 그대로 | preview-on |
| Production 오설정 | VERCEL_ENV=production + 플래그 true → 경기 전 축 닫힘, 선택기에 경기 없음, allowlist 24 | preview-prod-misconfig |

## 6. 관찰(범위 밖, 변경 없음)

- `/api/stats/supply`(분양 원천, 청약홈)는 서울 deny-list만 본다. 경기 분양 목록은 지금도 Production에서 열려 있는 **기존 동작**이다. 실거래·master와 무관하고, 이번 스위치로 바뀌지 않는다.
- Preview 배포가 어느 DB를 보는지(Production DB 공유 여부)는 **확인 필요**다. 공유한다면 Preview QA의 읽기는 사용자 조작 단위의 가벼운 조회뿐이다. live MOLIT 조회는 cron과 같은 키 쿼터를 쓴다.

## 7. cron 런타임 검증 — PENDING (실행 준비 완료, 이번 STEP에서 미실행)

- 검증기 `scripts/audit-cron-durability-runtime-verify.ts --verify`(사용자 작업 파일, 읽기만 했다). READ ONLY 트랜잭션 안에서 순차 조회 3개를 돈다(coverage, 매매 GROUP BY, 전월세 GROUP BY). 모두 lawd_cd·deal_ymd 범위로 제한되고, 전체 테이블 조회는 없다.
- 실행 전 스냅샷 있음: `tmp/cron-durability-verify/snapshot-2026-09-27T02-23-10-070Z.json`(09-27 11:23 KST). 그때 경기 sale coverage 0/24, 중복 키 0.
- 검증기가 확인하는 것: 셀 단위 영속화(distinct verifiedAt), 구 순서 = staleness 예상 순서, recheck stalest-first, 복원 0, 등기 삭제 0, 중복 자연키 0, 등기 채움, INVALID 미기록.
- 한계: `cancelFlipsUp`는 개수만 준다. 새 취소가 진짜인지는 원천 대조가 따로 필요하다.
- 이번 STEP은 Production DB 부하를 피하라는 지시에 따라 실행하지 않았다. 증거가 없으므로 PASS로 판정하지 않는다.

## 8. 모바일 Preview QA 매트릭스(360 / 375 / 390 px)

| 화면 | 수원 영통 41117 | 성남 수정 41131 | 의정부 41150 | 광명 41210 | 분당 41135(닫힘) |
|---|---|---|---|---|---|
| 선택기 | 경기도 → 8구만, "경기도 전체" 없음, 버튼 줄바꿈·잘림 없음 | 同 | 同 | 同 | 목록에 없음 |
| 검색 | 단지·지역 결과가 해당 구뿐, 다른 경기 없음 | 同 | 同 | 同 | 결과 0(단지명 검색도) |
| 지도 | 마커 = 그 구, 상단 안내 없음, 하단 0건/부분 문구 구분 | 同 | 同 | 同 | 상단 중립 안내 + 하단 "아직 지원하지 않는 지역", 마커 0 |
| 상세 | 리포트 카드 없음, 점수 부적격 표시 정직, 학교·유치원 "준비 중" | 同 | 同 | 同 | 직접 URL → 준비 중(데이터 조회 전 차단) |
| 비교 | 비교 리포트 CTA 없음 | 同 | 同 | 同 | 슬롯 해석 거부 |

공통 확인: 가로 스크롤 없음 · 라벨 잘림 없음 · 하단 내비와 겹침 없음 · 지도 컨트롤·마커 탭 영역 ≥ 44px · 부산(해운대 26350)·서울(마포 11440) 회귀 1회씩.

## 9. Preview 배포 절차(사용자 승인 필요 — 이번 STEP에서 실행하지 않음)

1. Vercel → Environment Variables에 `NEXT_PUBLIC_GYEONGGI_8_BETA_PREVIEW=true`를 **Preview 환경, 브랜치 `gyeonggi-8-public-beta-preview-v1` 한정**으로 추가한다.
   브랜치를 한정하지 않으면 다른 모든 Preview에서도 경기가 열린다. Production에는 넣지 않는다.
2. "Automatically expose System Environment Variables"가 켜져 있는지 확인한다(`NEXT_PUBLIC_VERCEL_ENV` 공급). 꺼져 있으면 스위치는 닫힌 채다(fail-closed).
3. `git push origin gyeonggi-8-public-beta-preview-v1`(main 아님). 브랜치 push라서 Production 배포가 아니다.
4. Preview URL에서 선택기에 경기도가 보이면 스위치가 켜진 것이다. 이어서 §8 매트릭스를 수행한다.
5. 되돌리기: env 삭제 후 재배포하거나 브랜치 Preview를 폐기한다. Production 영향은 없다.

## 10. 테스트·빌드

| 명령 | 결과 |
|---|---|
| `npx tsx --test` 신규 3파일 | 14/14 |
| `npx tsx --test src/lib/region/*.test.ts src/lib/report/*.test.ts src/lib/sitemap-scope.test.ts src/lib/seo/*.test.ts src/lib/map/*.test.ts` | 456/456 |
| `npx tsx --test` src 전체(193파일, integration 제외, DB env 없음) | 2724/2726 — 실패 2건(community-launch §15, recent-auth-parity §5)은 소스 정규식 테스트로, 워크트리 CRLF 체크아웃에서만 실패. 같은 두 파일을 main 체크아웃에서 돌리면 46/46 통과 → 변경과 무관 |
| `npx eslint` 변경 파일 | 0 errors, 2 warnings(apt-client 749·773 기존 unused disable) |
| `npx tsc --noEmit` | 21 errors 전부 `scripts/`(기존), src 0 → FAIL_EXISTING_SCRIPT_ERRORS |
| `npm run build`(Preview env 없음 = Production 동등) | exit 0 |

## 11. 알려진 문제·다음 STEP

- d9622da와 병합 충돌 예정(§3). 서울 25를 먼저 병합하면 이 브랜치를 rebase하면서 리포트 CTA helper를 하나로 합친다.
- 다음: (a) 사용자 승인 → Preview env + 브랜치 push → §8 모바일 QA, (b) 사용자가 `!`로 cron 런타임 검증 `--verify` 실행.
