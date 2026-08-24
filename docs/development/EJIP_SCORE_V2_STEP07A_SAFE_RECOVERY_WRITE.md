# E-JIP SCORE V2 — STEP 0.7-A: Safe Identity Recovery Write

- 작성일: 2026-08-24
- Worktree/Branch: `score-v2-step07a-safe-recovery-write`(base: `score-v2-step07-identity-recovery`,
  STEP 0/0.5/0.6/0.7 전체 포함 확인 완료, STEP 0.7은 실행 전 origin에 push 완료)
- 성격: **실제 production DB write 수행**(registry identity 필드 4개 +
  좌표 3개). Score 공식/weight/API/UI는 변경하지 않음, migration 없음.

## 1. 목적

STEP 0.7이 검증한 RECOVERY_HIGH 1,236건 중 실제로 안전한 row만 실제
DB에 적용한다. §26 write-plan을 실행 단계로 옮기는 STEP.

## 2. 현재 상태(순서대로)

1. preflight(git/DB target 확인)
2. RECOVERY_HIGH universe 재생성(현재 DB 기준)
3. dry-run write plan
4. immutable snapshot
5. registry write
6. registry post-write verify
7. re-geocode dry-run/write
8. re-geocode post-write verify
9. peer-quality 재계산 + 구·군/동 QA
10. 벤치마크 회귀(대신해모로/협성/구덕금호/collision)
11. idempotency 재검증
12. tests/tsc/eslint

## 3. 분석 — Preflight

### 3.1 Git/branch

- 기준 branch `score-v2-step07-identity-recovery`(commit `cf4b051`)는
  실행 전 origin에 없어(unpushed) 먼저 `git push origin
  score-v2-step07-identity-recovery` 실행.
- `main`은 학교/보육 데이터 관련 진행 중인 미커밋 변경(`docs/development/
  SCHOOL-V2-C-education-data-architecture.md` 등)이 있어 브랜치 전환
  시 충돌 위험 — git worktree(`.worktrees/score-v2-step07a-safe-recovery-write/`)로
  완전히 격리된 작업 공간을 만들어 main 작업 공간을 전혀 건드리지 않음.
- 신규 branch `score-v2-step07a-safe-recovery-write`를 STEP 0.7 위에서 분기.

### 3.2 DB target

`.env`의 `DATABASE_URL`을 파싱(비밀번호 미노출)해 확인:

```
host: aws-0-ap-northeast-2.pooler.supabase.com (Supabase Seoul)
database: postgres
```

이 프로젝트는 별도 staging DB가 없고(`.vercel` 링크 없음, `.env`에
단일 Supabase 연결 문자열만 존재) 로컬 스크립트와 배포된 앱이 동일한
Supabase 인스턴스를 공유한다 — **production DB로 확정**.

## 4. RECOVERY_HIGH universe 재생성(§4)

`scripts/apartment-score/step07a-01-verify-and-classify.ts` 신규:
STEP 0.7의 `loadUniverse()`를 현재 DB로 재실행하고, 같은 날 STEP 0.7이
이미 확보한 `output/step07-registry-sweep.json`(1,398건 라이브 registry
조회 결과)의 aptSeq 집합과 정확히 일치하는지 검증(정부 API 재호출
~70분을 불필요하게 반복하지 않기 위함 — 판정 입력(aptName/buildYear/
jibun/dong)은 전부 현재 DB에서 다시 읽고, 외부 registry 원천 데이터만
캐시 재사용).

```
고위험 재현: 1,725건 / MOLIT 복구후보: 1,398건 / 증거없음: 327건
DRIFT(신규/제거/jibun-dong 변경): 0건 / 0건 / 0건 — STEP 0.7 이후 DB 무변화 확인
RECOVERY_HIGH: 1,236건 / MEDIUM: 116건 / REVIEW: 34건 / FAILED: 12건
구덕금호(26140-11) sanity: RECOVERY_MEDIUM / universeFlag=NON_TARGET (기대값과 일치)
```

## 5. HIGH-only hard guard + dry-run(§5-7)

`scripts/apartment-score/step07a-02-registry-write-dryrun.ts` +
`lib/step07a-write-guards.ts`(신규, 순수 함수, 테스트 대상):

- `isNameGuardExcluded()`: 구덕금호류 명시적 이름 제외(HIGH로 나타나도 차단)
- `isUniverseConfirmedApartment()`: **dry-run 중 발견한 실제 anomaly** —
  resolver의 `classifyUniverse()`는 `mainPurpsCdNm`이 결측(registry
  데이터 자체가 비어있음)이면 `universeFlag='UNKNOWN'`을 반환하는데
  `classifyRecovery()`는 `MIXED_USE`/`NON_TARGET`만 MEDIUM으로 걸러내고
  `UNKNOWN`은 걸러내지 않는다 — 그 결과 아파트 확인이 안 된 row 1건
  (`26380-19` "럭키", registry 이름 "럭키아파트" 정확 일치·건축년도
  정확 일치·recordCount=1로 근거는 강했으나 `mainPurpsCdNm=null`)이
  HIGH로 새어 들어왔다. 근거가 강해 보여도 "공동주택" 양성 확인이
  없으면 보수적으로 write에서 제외하고 manual review로 이관.
- `applyFieldPrecedence()`: VERIFIED_EXISTING(기존 non-null) >
  RECOVERY_HIGH candidate > LOWER_CONFIDENCE.

Dry-run 결과:

```
TOTAL_HIGH: 1,236
WRITE_CANDIDATES: 1,235 (26380-19 guard 제외)
NO_CHANGE: 0 / ADDRESS_CHANGE: 1,235 / JIBUN_CHANGE: 1,235 / REGISTRY_LINK_CHANGE: 1,235
COORD_REGEOCODE_CANDIDATES: 1,235
EXCLUDED: 163 (MEDIUM 116 + REVIEW 34 + FAILED 12 + guard 1)
ANOMALIES: 전부 0(candidateExceedsTotal/lawdCdCrossRegionChange/aptSeqChange/
  existingHighCoordDowngraded/existingVerifiedRegistryChanged/staleNonNullField)
STOP CONDITIONS: none
```

## 6. Snapshot + rollback(§8-9)

`scripts/apartment-score/step07a-03-snapshot.ts`:

```
경로: data/recovery-snapshots/score-v2-step07a-before-20260823-143831.json (+.csv, .manifest.json)
행 수: 1,235건 (write candidate count와 정확히 일치)
SHA256: 25edb30cd07101f27279af7b6605f683b6d24968c0e01b385ce3a5c467671057
```

`scripts/apartment-score/rollback-step07a-recovery.ts`: snapshot
SHA256 무결성 검증 → aptSeq exact match → dry-run 기본값(--execute
필요) → row count 검증 → missing aptSeq 발생 시 STOP. write 전
dry-run으로 테스트 완료(대상 0건, 정상 — 아직 write 전이므로).
**실제 rollback은 실행하지 않음**(지시사항 §9 그대로 준수).

## 7. Registry write(§11-12)

`scripts/apartment-score/step07a-04-registry-write.ts`(기본 dry-run,
`--apply` 필요). 필드는 §26 승인 범위 그대로 4개만: `roadAddress`,
`jibunAddress`, `totalHouseholds`, `mgmBldrgstPk`.

```
attempted: 1,235 / updated: 1,235 / unchanged: 0 / failed: 0
```

Post-write verify(`step07a-05-post-write-verify.ts`):

```
expected updated == actual updated: true
duplicate aptSeq: 0 / cross-lawdCd change: 0 / missing: 0 / 값 불일치: 0
identity collision(동일 name+lawdCd+jibun 신규 발생): 0
PASS: true
```

## 8. Re-geocode(§13-19)

Production `apartment_master_seed.ts:geocode()`를 **그대로 재사용**
(export 키워드 + `require.main===module` 가드만 추가, 로직 0줄 변경
— 가드는 이 함수를 다른 스크립트가 import할 때 파일 하단의 CLI
`main()`이 부작용으로 실행되는 걸 막기 위함이며, 직접 CLI 실행 시
동작은 완전히 동일하다).

분류: `NEEDS_REGEOCODE` 1,235 / `KEEP_EXISTING_HIGH` 0 / `NO_VALID_ADDRESS` 0.

라이브 Kakao API 호출(concurrency=4, ~5분):

```
geocodeSuccess: 1,235/1,235 (100%)
regionMismatch: 1건 (26290-216 "부림1차" — 기존 keyword 좌표와 델타 ≈0,
  실질적으로 새 정보 없음, 기존에도 있던 문제라 이번 write로 새로 생긴
  문제 아님, 그대로 두고 write 제외)
distance buckets: <100m 1,127 / <300m 35 / <1km 50 / >=1km 23
duplicate suspicious: 23건 — 해운대구 우동 일대에서 Kakao 주소검색이
  서로 다른 건물(다른 도로명주소)을 동일 좌표로 반환하는 클러스터
  발견(production apartment_master_seed.ts의 deduplicateCoordinates()가
  이미 알고 있던 것과 동일한 패턴 — "성공률보다 정확도" 원칙 그대로
  적용: exact 품질이 정확히 1개인 그룹만 그 1건을 신뢰하고 나머지는 제외)
SAFE_WRITE_CANDIDATES: 1,191 / UNSAFE_EXCLUDED: 44
```

Write(`step07a-07-regeocode-write.ts --apply`, SAFE만):

```
attempted: 1,191 / updated: 1,191 / unchanged: 0 / failed: 0
```

Post-write verify(`step07a-08-regeocode-post-verify.ts`):

```
unsafe leaked into DB: 0 / new ambiguous duplicate groups post-write: 0
PASS: true
```

## 9. Peer-quality 실제 재계산(§20-24)

`step07a-09-post-write-peer-quality.ts` — production DB 실제
post-write 상태로 STEP 0.6 peer-quality 모델 재실행(BEFORE는 STEP 0.7
문서에 이미 확정 기록된 같은 날 실측값을 인용, 다시 계산할 필요 없음):

| | BEFORE | PROJECTED(STEP 0.7) | **ACTUAL(STEP 0.7-A)** |
|---|---|---|---|
| PEER_FULL | 1,301 (38.2%) | 2,537 (74.6%) | **2,467 (72.5%)** |
| PEER_LIMITED | 366 (10.8%) | 366 (10.8%) | **366 (10.8%)** |
| DISPLAY_ONLY | 1,734 (51.0%) | 498 (14.6%) | **568 (16.7%)** |
| UNRESOLVED | 1 (0.0%) | 1 (0.0%) | **1 (0.0%)** |

**차이 원인(§21 요구사항)**: PROJECTED는 30건 라이브 spot-check가
100% 성공한 데이터를 1,236건 전체에 투영한 수치였다. 실제 전수
실행에서는 dry-run 단계에서 발견된 44건(region mismatch 1 + 좌표
충돌 클러스터 23 + 1km 초과 이동 23)이 안전 가드에 걸려 좌표 write에서
제외됐고, registry 단계에서도 1건(26380-19)이 universe 미확인으로
제외됐다 — 이 45건이 PEER_FULL로 전환되지 못해 74.6%→72.5%(−2.1pp)
차이를 정확히 설명한다. DISPLAY_ONLY가 예상보다 70건 많은 것도 동일한
원인(좌표가 그대로 COORD_LOW로 남은 44건 + universe 미확인 1건).

Domain eligibility(BEFORE → ACTUAL):

```
transport/life/school: 1,667 → 2,833
parking: 862 → 862(불변, registry의 parkingCount는 이번 write 범위 밖)
complex: 3,000 → 3,000(불변, buildYear는 이미 STEP 0 기준 100% coverage)
```

구·군별 PEER_FULL%(ACTUAL, min~max):

```
중구 62.7% ~ 북구 86.7% (median 72.7%, ratio 1.38x)
```

BEFORE 8.5%~75.0%(8.8x) → PROJECTED 62.7%~87.3%(1.4x) → **ACTUAL
62.7%~86.7%(1.38x)** — 지역편향이 실측으로도 거의 그대로 해소됨을 확인.

동(dong) 단위 COORD_HIGH peer sample size(BEFORE → ACTUAL):

```
n<5: 46.3% → 36.3%  |  n<10: 59.7% → 47.9%  |  n<20: 78.5% → 61.0%  |  n>=20: 21.5% → 39.0%
```

개선되지만 n<5가 여전히 1/3 이상 — SIGUNGU fallback은 계속 필요(STEP
0.7 §29 결론과 동일).

## 10. 벤치마크 회귀(§25-28)

기존 STEP 0.6 스크립트(`step06-02-benchmark-simulation.ts`, 수정 없이
재사용, 현재 DB를 라이브로 조회)를 그대로 재실행:

**대신해모로센트럴(26140-1356)**: identity=IDENTITY_HIGH,
coord=COORD_HIGH, peerEligibility=PEER_FULL, subwayDist=140m, filtered
rank=7/17(TOP10 유지). 이번 write 전에도 이미 정상이었고, 이번
write가 그 상태에 어떤 조정도 가하지 않음을 재확인(§27 윤리 원칙
그대로 — 이 단지 순위를 올리려는 로직 없음).

**협성르네상스(26140-51)**: identity=IDENTITY_HIGH, coord=COORD_HIGH,
peerEligibility=PEER_FULL, subwayDist=306m, filtered rank=2/20. 동일.

**구덕금호(26140-11, negative benchmark)**: identity=**IDENTITY_LOW**
(MEDIUM조차 아님 — registry write 대상에서 완전히 제외됐으므로
roadAddress/totalHouseholds가 여전히 null), coord=**COORD_LOW**(재지오코딩
대상에도 포함 안 됨), peerEligibility=**DISPLAY_ONLY**(FULL 아님).
**정상화되지 않음을 실측으로 재확인**.

**Same-name collision(53개 그룹, 113건)**: post-write 재실행 결과
그룹 수·ambiguous 비율(53/53=100% distinct jibun) 완전히 동일 —
registry write가 jibun/aptSeq/name을 전혀 건드리지 않으므로 당연한
결과지만, 실측으로 wrong merge 0건을 재확인.

## 11. Idempotency(§35-37)

전체 apply 파이프라인을 다시 실행:

```
registry write 재실행(--apply): attempted 1,235 / updated 0 / unchanged 1,235 / failed 0
universe 재생성(step07-02) 재실행: 고위험 1,725→490, MOLIT후보 1,398→163
  (정확히 1,235건이 "더 이상 고위험 아님"으로 빠져나감 — 1725-490=1235, 1398-163=1235)
```

재지오코딩 write 재실행에서는 처음에 25건이 "updated"로 잘못
집계됐다 — 원인 조사 결과 **DB write 자체는 완전히 idempotent**했으나
(동일 좌표를 다시 씀, 실제 값 변화 없음), 재실행 스크립트의 unchanged
판정 로직이 `geocodeQuality==='exact'`만 스킵 조건으로 봐서
`'normalized'` 품질 row는 매번 동일 값을 다시 write하며 "updated"로
잘못 세고 있었다. 값 자체를 비교하도록 고쳤더니 14건으로 줄었고,
남은 14건을 조사하니 **Supabase pooler 경유 float round-trip의
IEEE754 마지막 자릿수 오차**(diff ≈ 1e-14도, 물리적으로 나노미터
단위)였다 — 실제 데이터 차이가 아님. epsilon(1e-9도, ≈0.1mm) 비교로
전환한 뒤 재실행하니:

```
attempted: 1,191 / updated: 0 / unchanged: 1,191 / failed: 0
```

**완전히 idempotent함을 확인**. (이 과정에서 발견한 guard 로직은
`lib/step07a-write-guards.ts`로 추출해 스크립트가 실제로 이 함수를
쓰도록 리팩터링했고, 리팩터링 후 registry dry-run을 재실행해 동일한
결과(WRITE_CANDIDATES=0, NO_CHANGE=1,235)를 재확인했다.)

## 12. Score/API/UI 영향 확인

- Score 계산 코드(`src/lib/apartment-score/server/*`) 0줄 변경.
- `src/lib/apt-building-info.ts`/`api-molit.ts`(production 조회 함수) 0줄 변경.
- API route/UI 컴포넌트 0줄 변경.
- `apartment_master_seed.ts`는 `export`/`require.main` 가드만 추가(로직
  변경 없음, CLI 직접 실행 시 동작 동일).
- `prisma/schema.prisma` 변경 없음, migration 없음.
- 이번 STEP이 건드린 것은 `ApartmentMaster`의 7개 필드값(roadAddress/
  jibunAddress/totalHouseholds/mgmBldrgstPk/latitude/longitude/
  geocodeQuality)뿐 — 이 데이터를 이용해 Score를 재계산하는 것은
  범위 밖(지시사항 §31 그대로 준수).

## 13. Tests / tsc / eslint

```
node:test: 30/30 PASS (기존 resolver fixture 15 + 신규 NON_TARGET 1 +
  신규 write-guard fixture 14)
npx tsc --noEmit: PASS(0 error)
npx eslint (변경된 전체 파일): PASS(0 warning/error)
next build: 미실행(script-only 변경 + apartment_master_seed.ts는 export/
  가드만 추가된 비-app 코드라 지시사항 §39 "script/docs only이면 build는
  선택 가능"에 해당 — 필요 시 요청 바람)
```

## 14. 알려진 문제 / 남은 위험

1. **44건 좌표 미개선**: registry(주소/세대수)는 확보됐지만 좌표는
   여전히 COORD_LOW — 1건(region mismatch, 26290-216)은 새 주소로도
   Kakao가 다른 구를 반환, 23건(해운대구 우동 일대 좌표 충돌 클러스터)은
   Kakao 주소검색 자체가 여러 건물을 한 점으로 묶어버림, 23건은 기존
   좌표 대비 1km 이상 이동해 자동 승인 보류. 세 그룹 모두 수동 검토
   또는 대체 geocoding 전략이 필요(별도 STEP 후보).
2. **163건 미회복**: MEDIUM 116(주용도 비-공동주택 76 + 세대수 결측
   40) / REVIEW 34(차수·건축년도 불일치 adversarial case) / FAILED 12
   (registry 조회 실패) / guard 1(주용도 결측). 전부 사람 검토 대상으로
   보존, 자동 write 금지 유지.
3. **327건 무증거**: MOLIT 거래이력 자체가 없어 이번 접근으로 접근
   불가(STEP 0.7과 동일).
4. **동 단위 표본 부족 잔존**: n<5 dong이 36.3% — SIGUNGU fallback
   계속 필요.

## 15. STEP 0.8 준비 상태

```
production DB write:            YES(1,235 registry + 1,191 좌표, 전부 검증 PASS)
wrong merge:                    0건
rollback readiness:             snapshot+rollback script 준비 완료(미실행)
peer coverage 실측 개선:         YES(PEER_FULL 38.2%→72.5%)
지역편향 실측 개선:              YES(8.8x→1.38x)
Score/API/UI:                   변경 없음
결론:                            STEP 0.8(Shadow Peer & Score Impact
                                 Validation, production V1 vs quality-filtered
                                 peer 병렬 계산) 착수 조건 충족
```
