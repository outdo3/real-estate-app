# SCHOOL V2-C6 — Official Attendance Zone(학구도) Integration Audit + Busan Pilot

- **STEP**: SCHOOL V2-C6
- **성격**: SOURCE VERIFICATION + BUSAN PILOT + DATA MODEL DESIGN — migration/production write/main merge 없음. C2B 통계 트랙 재개 없음. SchoolInfo legal gate 변경 없음.
- **Branch**: `school-v2-c6-attendance-zone` (worktree `D:/anti2/aaa/e-jip-school-c6`, base `9ac7320` = `school-v2-c2bb`)
- **선행 문서**: [SCHOOL-V2-C2BA-identity-disambiguation.md](./SCHOOL-V2-C2BA-identity-disambiguation.md), [SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md](./SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md) — 전부 보존, 이 문서는 완전히 별개의 데이터 소스(학구도)를 다룬다.
- **확인일**: 2026-08-22.

---

## 0. 핵심 요약

공식 학구도 데이터(한국교육시설안전원, 무료·**이용허락범위 제한없음**)를 실제로 확보해 부산 아파트 7건에 대해 **공식 GIS 조회 도구로 실제 통학구역을 조회**했다. 결과: 초등학교는 진짜 1:1 zone이지만 **7건 중 2건(29%)이 이미 단일 학교가 아닌 "공동통학구역"**이었고, 중·고등학교는 애초에 1:1이 아니라 **"학교군"(여러 후보 중 배정)** 구조임을 실제 UI 결과로 확정했다. 공식 서비스 자체가 "재산권 등의 법적효력 없음, 정확한 사항은 관할 교육지원청에 확인" 고지를 명시하므로, 이집 UI에서도 절대 "배정학교"로 단정하면 안 된다.

---

## 1. 공식 학구도 Source 확정

| 항목 | 내용 |
|---|---|
| 제공기관 | **한국교육시설안전원**(2026-01-01부로 재단법인한국지방교육행정연구재단에서 업무 이관 — data.go.kr 등록 정보로 확인) |
| 소관기관 | 교육부 |
| 관련법령 | 초·중등교육법(초등: 시행령 제16조, 중학교: 시행령 제68조) |
| 표준데이터셋제공시스템 | 학구도안내서비스(schoolzone.emac.kr) |
| 데이터 형식 | **SHP**(초등학교통학구역, 공간정보) + **CSV**(학교학구도연계정보, 속성 크로스워크) — 둘 다 data.go.kr에서 직접 확인 |
| 다운로드 방식 | 파일 다운로드(원문파일등록) + 그리드 + 오픈API(둘 다 지원, 그리드는 5만 건 제한) |
| 갱신주기 | **반기**(연 2회, **매년 3월·9월** 배포 — 페이지 원문 확인) |
| 기준연도 | 최신 데이터기준일자 **2026-03-20** |
| 전국 데이터 여부 | **전국 17개 시도교육청 관할 지역 전체**(페이지 설명 원문: "초등학교통학구역은 전국 17개 시도교육청의 관할지역을 공간정보로 제공") — **부산 포함 확인**(실제 조회로 재확인, §6) |
| 이용허락범위 | **"이용허락범위 제한 없음"** — data.go.kr 라이선스 섹션에 명시된 원문 그대로. 상업적 이용/변경/재가공 전부 이 표현상 자유(SchoolInfo의 KOGL 제3유형처럼 변경금지 조건이 없음) |
| 비용 | 무료 |
| 출처표시 | 명시적 KOGL 유형 라벨은 없으나("이용허락범위 제한없음"은 통상 KOGL 제1유형보다도 자유로운, data.go.kr 자체 별도 카테고리) 관례상 출처표시는 유지 권장 |

**ATTENDANCE_ZONE_LEGAL_GATE = CLEARED(원본 파일 이용에 한함)** — 지시사항의 "불명확하면 REVIEW_REQUIRED" 기본값과 달리, 이번엔 data.go.kr 라이선스 섹션에서 "이용허락범위 제한 없음"이라는 명확한 문구를 직접 확인했으므로 REVIEW_REQUIRED로 남기지 않는다. 단, 이는 **원본 SHP/CSV 파일 다운로드·가공에 대한 라이선스**이지, schoolzone.emac.kr의 **라이브 조회 UI를 스크래핑하는 것에 대한 별도 이용약관**은 확인하지 않았다 — 실제 구현은 라이브 UI가 아니라 다운로드한 원본 파일을 이집 서버에서 처리하는 방식을 권고(§12).

---

## 2. 데이터 종류 구분 — 실측으로 확정

공식 사이트(schoolzone.emac.kr) 실제 조회 결과, "학구도"라는 이름 아래 **최소 3가지 구조가 다른 개념**이 섞여 있음을 실측으로 확인했다:

| 종류 | 실측 근거 | 구조 |
|---|---|---|
| **초등학교 통학구역**(순수 1:1) | 예: 녹명초등학구역 → 녹명초등학교 1개교만 | 주소 → 학교 1:1 |
| **초등학교 공동통학구역**(복수 선택) | 예: "대신초동신초공동통학구역" → 동신초/대신초 2개교, "온천초공덕초금성초공동(일방)통학구역" → 온천초(**큰**)/금성초(**작은**)/공덕초(**작은**) 3개교 | 주소 → 학교 N개 중 선택. "(일방)" 표기와 "큰/작은" 구분 필드가 실제로 존재하나 그 정확한 행정적 의미(우선순위/정원기준 등)는 이번 조사에서 확인하지 못함 — **추정 금지, UNKNOWN으로 남김** |
| **중학교 학교군/중학구/공동학구** | 예: "9학교군" → 명호중/오션중/경일중/명지중 4개교 후보, "서부고등학군"(고등학교도 동일 구조) → 명호고/경일고/건국고/부산여고/다대고... | 주소 → **학교군**(여러 학교 pool). 1:1 배정이 아님 — 초·중등교육법 시행령 제68조 근거로 명시적으로 "학교군·중학구·공동학구"를 함께 규정 |

**초등학교만 진짜 1:1 zone이라고 가정하면 안 된다는 것도 이번 실측으로 확인** — §6/§7에서 실제로 7건 중 2건이 초등학교조차 공동학구였다.

---

## 3. 부산 실제 데이터 확보

원본 SHP/CSV 파일 자체는 data.go.kr의 세션 기반 다운로드(POST + 쿠키)를 통해 프로그래밍적으로 내려받지 못했다(브라우저로 다운로드를 트리거했으나 완료된 파일을 확인하지 못함 — 이번 STEP에서 인증/스크래핑 우회는 시도하지 않음, 정직하게 한계로 기록). 대신:

1. **CSV 파일(학교학구도연계정보) 필드 스키마와 실제 미리보기 50행**을 공식 페이지에서 직접 확인(§5).
2. **schoolzone.emac.kr의 공식 라이브 조회 UI**를 통해 부산 아파트 7건의 실제 통학구역·학교군을 조회(§6) — 이건 원본 데이터를 그대로 서비스하는 공식 화면이므로 결과 자체는 신뢰할 수 있는 실측이다.

이 조합으로 §6/§7의 파일럿을 진행했다. **geometry 원본(polygon 좌표 자체)은 확보하지 못했다** — CRS/invalid geometry/hole 등 §4의 세부 항목은 이번 STEP에서 검증 불가로 남긴다(한계로 명시, §13에서 향후 조달 방법 제안).

---

## 4. CRS / Geometry 검증 — 미확인(한계)

원본 SHP 파일을 확보하지 못해 CRS, polygon/multipolygon, invalid geometry, hole, overlap 등을 직접 검증하지 못했다. **PostGIS 도입 금지** 지시와 무관하게, 이번 STEP은 파일 자체를 못 받아 Node/Python 오프라인 파일럿도 수행하지 못했다 — 정직한 한계로 기록한다. §6의 파일럿은 공식 UI가 이미 point-in-polygon을 수행한 **결과값**을 그대로 가져온 것이지, 이집이 직접 geometry 연산을 한 것은 아니다.

---

## 5. School Identity 검증

CSV(학교학구도연계정보) 실제 필드: `학구ID, 학교ID, 학교명, 학교급구분, 시도교육청코드, 시도교육청명, 교육지원청코드, 교육지원청명, 데이터기준일자`.

**학교ID 실제 형식**(미리보기 50행에서 확인): `"B000005015"`, `"B000002295"` 등 — **"B" + 9자리 숫자**.

이는 다음 두 코드 체계 어느 쪽과도 다르다:
- NEIS `SD_SCHUL_CODE`(canonical `School.neisSchoolCode`, 순수 숫자, 예 `"7171046"`)
- SchoolInfo `SCHUL_CODE`(예 `"S020001449"`)

**분류: B. OFFICIAL_OTHER_CODE** — 공식 기관이 부여한 코드이지만 canonical과 직접 조인 불가능한 제3의 체계. **학교명 단독 자동 조인은 하지 않는다**(지시사항 그대로 준수).

**안전한 연결 방법**: C2B-A에서 이미 검증·커밋된 `schoolinfo-identity-resolver.ts`와 **동일한 방법론**(이름+시군구+학교급, 필요시 동 단위 disambiguation)을 재사용할 수 있다 — CSV의 `학교명`+`시도교육청명`+`교육지원청명`+`학교급구분` 조합이 그 입력이 된다. 이번 STEP에서 실제로 이 조인을 코드로 구현하지는 않았다(파일 미확보로 대량 데이터가 없어 실익이 없음) — **C. NAME_REGION_MATCH 방식이 유일한 실용적 경로**라는 결론만 확정한다.

---

## 6. 부산 초등학교 Pilot (실제 데이터, 7건 — 목표 10건에서 축소)

**축소 사유(정직하게 기록)**: 원본 SHP 파일을 직접 받아 대량 좌표를 일괄 처리하지 못해, 공식 라이브 UI로 건별 수동 조회했다 — 조회당 소요 시간이 있어 서구/해운대구/강서구/동래구/부산진구/사하구 6개 구·군 7건까지 진행하고 기장군은 포함하지 못했다. 대신 조회한 7건 모두 **실제 ApartmentMaster 좌표/주소를 가진 진짜 단지**이고, 임의로 가장 가까운 학교를 배정학교로 가정한 사례는 하나도 없다.

| # | 지역 | 아파트(ApartmentMaster) | 검색 결과 매칭 | 학구/학교군 | 매칭 학교(직선거리) | 유형 |
|---|---|---|---|---|---|---|
| 1 | 강서구 | 극동스타클래스(명지동) | 명지오션시티극동스타클래스아파트 | 명호초등학구역 | 명호초등학교(241m) | 단일 |
| 2 | 서구 | 향원에이스타운(서대신동2가) | 향원에이스타운 101동 | **대신초동신초공동통학구역** | 동신초(431m) / 대신초(668m) | **공동학구(대칭)** |
| 3 | 해운대구 | 에이스빌라(중동) | 해동에이스빌라 | 동백초통학구역 | 동백초등학교(694m) | 단일 |
| 4 | 강서구 | 유나베네스1차(녹산동) | 유나베네스1차입구 | 녹명초등학구역 | 녹명초등학교(283m) | 단일 |
| 5 | 동래구 | 신화타워(온천동) | 신화타워 | **온천초공덕초금성초공동(일방)통학구역** | 온천초(**큰**,547m) / 금성초(**작은**,4517m) / 공덕초(**작은**,9543m) | **공동학구(비대칭/일방)** |
| 6 | 부산진구 | 현대2차(양정동) | 현대아파트2단지 | 양성초등학구역 | 양성초등학교(227m) | 단일 |
| 7 | 사하구 | 스마트더블유(장림동) | 사하장림역스마트더블유아파트 | 장림초등학구역 | 장림초등학교(187m) | 단일 |

**임의 배정 없음 재확인**: 7건 모두 공식 UI가 반환한 결과를 그대로 기록했다 — "가장 가까운 학교"를 추정해 채운 항목은 없다.

---

## 7. Nearby School(직선거리 최근접) vs Attendance Zone School 비교

C5 audit(`c5-sample-distance-audit.ts`)에서 이미 실측한 "최근접 초등학교" 값과 대조:

| 아파트 | A. 최근접(C5 audit, Kakao SC4 기준) | B. 공식 통학구역(이번 STEP) | 일치 여부 |
|---|---|---|---|
| 극동스타클래스 | 명호초등학교 242m | 명호초등학교 241m | **일치**(같은 학교, 오차 1m는 소스 차이) |
| 현대2차 | 양성초등학교 210m | 양성초등학교 227m | **일치** |
| 스마트더블유 | 장림초등학교 174m | 장림초등학교 187m | **일치** |
| 향원에이스타운 | (C5 audit 표본에 없음, 신규 조회) | **동신초/대신초 2개교 중 선택**(단일 "정답" 없음) | **A 개념 자체가 성립 안 함** — nearest는 "가장 가까운 1개"를 전제하는데 zone은 "선택 가능한 2개"를 반환 |
| 신화타워 | (C5 audit 표본에 없음, 신규 조회) | **온천초(큰)/금성초·공덕초(작은) 3개교**, 그중 최근접(온천초 547m)이 "큰"으로 표시 | 최근접=1순위("큰")로 우연히 일치하지만, "작은" 옵션 2개가 별도로 존재한다는 사실 자체를 nearest 개념은 전혀 표현 못 함 |

**실증 결론(§7 요구사항)**: 단순 "일치/불일치"로 딱 나뉘지 않는다 — 3건(단일학구)은 개념적으로 같은 답을 주지만, **2건(29%)은 nearest가 "정답 1개"를 강요하는 반면 공식 데이터는 "선택지 여러 개"를 준다.** 이것이 정확히 SCHOOL V2 UI에서 "가까운 학교"와 "통학구역 학교"를 분리해야 하는 실증 근거다 — nearest 하나만 보여주면 실제로 선택 가능한 다른 학교(예: 신화타워의 금성초/공덕초)의 존재 자체를 부모가 알 수 없게 된다.

---

## 8. 경계/예외 사례

실측으로 확인된 것과 이번 STEP에서 확인하지 못한 것을 구분한다.

| 사례 | 상태 | Safe Behavior |
|---|---|---|
| 공동통학구역(대칭) | **실측 확인**(§6 #2) | 후보 학교 전부 나열, 단일 "배정학교"로 표시 금지 |
| 공동통학구역(비대칭/일방, 큰/작은) | **실측 확인**(§6 #5) | "큰/작은" 의미가 확정되지 않았으므로 이 구분 자체를 UI에 직접 노출하지 않고, "복수 후보 존재"까지만 안전하게 표시 권고 |
| 중학교/고등학교 학교군 | **실측 확인**(§2, §6 #1의 중학교 tab) | "배정 중학교/고등학교" 표현 금지, "학교군(N개 후보)" 형태로만 |
| polygon 경계 위 아파트 | 미확인(표본 7건 모두 경계에서 충분히 떨어져 있었음) | 후속 표본에서 재확인 필요 |
| 신규 아파트/신도시 | 미확인 | 갱신주기가 반기(3월/9월)이므로 그 사이 준공한 신축 단지는 구버전 데이터 기준일 수 있음 — "데이터기준일자" 필드를 반드시 함께 표시해야 함 |
| 폐교/학교 신설 예정 | 미확인 | School.isActive(canonical)와 학구도의 학교 상태를 별도 검증 없이 신뢰하면 안 됨 |
| 좌표 품질 낮음(ApartmentMaster geocodeQuality≠exact) | 이번 파일럿은 전부 exact만 사용해 미확인 | normalized/failed 품질 좌표는 point-in-polygon 자체가 신뢰 불가 — 그런 단지는 애초에 조회하지 않는 것이 안전 |
| No polygon(구역 자체가 없는 지역) | 미확인 | 조회 결과가 빈 값이면 "거리 확인 중"류 표현으로 처리(SCHOOL V2-C5-A 원칙 재사용) |

**절대 임의 배정 금지 재확인**: 위 어떤 예외 사례에서도, 데이터가 불명확하면 "가장 가까운 학교"로 임의 대체하지 않는다.

---

## 9. UI 의미 정의 (신중하게 확정)

공식 사이트 자체의 고지사항 원문(그대로 인용, 2026-08-22 확인):

> "본 지리정보시스템에서 제공하는 각종 지도 및 학구(통학구역) 정보는 자료 관리 시점과 서비스 시점의 차이로 인해 실제와 차이가 발생할 수 있으므로 **단순 열람용으로 참조**하시기 바라며, **'재산권 등의 법적효력'이 없음**을 알려드립니다. **학교 배정 등 학구(통학구역)에 대한 정확한 사항은 관할 교육청(교육지원청)에 반드시 확인하시기 바랍니다.**"

이집도 **이 수준 이상으로 확정적으로 표현할 근거가 없다.**

| 금지 표현 | 허용 표현 |
|---|---|
| "배정학교" | "공식 통학구역 기준 학교" |
| "여기로 배정됩니다" | "통학구역상 이 학교입니다(참고용, 최종 확인은 교육지원청)" |
| "우리 아이 학교" | "통학구역 학교(안내용)" |

**추천 caveat 문구**(C5-A 톤 유지, 과도한 경고 지양): `"공식 통학구역 기준이며, 실제 배정은 교육지원청 확인이 필요해요."`

---

## 10. 중학교 처리

§2/§6에서 실측 확정한 대로, 중학교(및 고등학교)는 **"학교군"** 개념이라 초등학교식 1:1 표시를 쓰면 안 된다.

**권장 UX**: `"9학교군 (4개교 중 배정: 명호중·오션중·경일중·명지중)"` 형태 — 후보 학교 전부 나열하되 "이 중 하나로 배정"이라는 뉘앙스를 명확히 하고, 절대 "배정 중학교: OO중학교"처럼 하나만 골라 표시하지 않는다.

---

## 11. 데이터 모델 제안 (설계만, migration 없음)

```prisma
// FUTURE PROPOSAL — 이번 STEP에서 migration 안 함
model AttendanceZone {
  id            Int      @id @default(autoincrement())
  source        String   // 'moe_school_zone_shp' (EducationSource.code 후보)
  zoneId        String   // 학구ID (예: "Z000100415") — 원본 그대로
  zoneName      String   // 학구명(예: "명호초등학구역", "온천초공덕초금성초공동(일방)통학구역")
  zoneType      String   // 'SINGLE' | 'JOINT_SYMMETRIC' | 'JOINT_ASYMMETRIC' | 'MIDDLE_SCHOOL_GROUP' | 'HIGH_SCHOOL_GROUP'
  schoolLevel   String   // 학교급구분 원문(초등학교/중학교/고등학교)
  sourceYear    String   // 데이터기준일자(예: "2026-03-20")
  sidoEduCode   String   // 시도교육청코드(원본, 6~7자리, canonical 코드와 다름)
  jiwonCode     String?  // 교육지원청코드
  // geometry: 이번 STEP은 원본 파일을 확보하지 못해 저장 형식 미확정 —
  // 후속 STEP에서 SHP→GeoJSON 변환 후 Json 컬럼 또는 별도 저장소로 결정.
  provenance    String   // 확인 URL/근거

  schools AttendanceZoneSchool[]

  @@unique([source, zoneId])
}

// 하나의 학구가 여러 학교를 가질 수 있다(공동학구/학교군) — N:M 관계로 설계.
model AttendanceZoneSchool {
  id              Int             @id @default(autoincrement())
  zoneId          Int
  zone            AttendanceZone  @relation(fields: [zoneId], references: [id])
  externalSchoolId String         // CSV의 "학교ID"(B00000xxxx) — 원본 그대로, canonical과 미조인
  schoolName      String
  canonicalSchoolId Int?          // School.id — resolver(§5)로 확정된 경우만 채움, 아니면 null
  priority        String?         // '큰' | '작은' | null — §2에서 의미 미확정이라 원문 그대로만 저장
}
```

**ApartmentEducationLink vs runtime point-in-polygon 비교**(§12):

| 방식 | 장점 | 단점 |
|---|---|---|
| A. Runtime point-in-polygon(매 요청 시 계산) | 저장소 불필요, 학구 변경 시 재계산 불필요 | geometry 원본을 서버에 상시 로드해야 함, 응답속도 저하 위험, V1에 PostGIS 없이는 매 요청 연산 비용 큼 |
| B. `ApartmentEducationLink`(사전 계산해 저장) | 조회 빠름, 좌표 없이도 캐시된 결과 제공 가능 | 학구 갱신(3월/9월)마다 재계산(rematch) 파이프라인 필요, ApartmentMaster 신규/좌표변경 시 갱신 누락 위험 |

**V1 추천: B(사전 계산 저장)** — 학구가 반기 단위로만 바뀌고(§13), ApartmentMaster 좌표도 자주 바뀌지 않으므로 매 요청 실시간 연산의 이점이 크지 않다. PostGIS 없이 Node 라이브러리로 배치 시점에 한 번 계산해 저장하는 편이 V1 단순성에 맞다(§12).

---

## 12. 저장 방식 판단

**추천: A(원본 SHP/GeoJSON 파일 보존 + offline point-in-polygon + `ApartmentEducationLink` 결과 저장)**.

- PostGIS 도입 없이 Node geometry 라이브러리(예: `@turf/turf`—이미 이 프로젝트에 존재, `booleanPointInPolygon` 함수 제공)로 배치 스크립트에서 1회 계산.
- 원본 SHP/CSV는 별도 저장소(S3/로컬 파일)에 원문 그대로 보존 — 재현성·감사 추적 목적.
- 결과(§11 `AttendanceZoneSchool` ↔ `ApartmentMaster`)만 DB에 저장.
- B(geometry 자체를 DB에 JSON으로 저장)는 다음 갱신 시 diff 로직이 복잡해지고 V1에 불필요한 것으로 판단, 이번 제안에서 채택하지 않음.

**이번 STEP은 실제로 구현하지 않는다** — 원본 파일도 확보하지 못했으므로(§3) 구현 여부를 떠나 아직 착수할 수 없는 상태.

---

## 13. 자동 갱신 가능성 (설계만)

```
매년 3월/9월(§1 갱신주기) → data.go.kr 신규 파일 등록 감지
  → 다운로드(수동 또는 세션 인증 자동화 — 이번 STEP에서 자동화 방법 확인 못함, §3 한계)
  → validate(§4 CRS/geometry 검증, 이번 STEP 미수행)
  → diff(이전 버전과 학구ID/경계 변경분 비교)
  → apartment-zone rematch(변경된 학구에 속한 ApartmentEducationLink만 재계산)
```

**이번 STEP에서 scheduler 구현하지 않음**(지시사항 "NOT NOW") — 구조 설계만. 수동 1회성 파일로 끝나는 구조는 장기 운영안으로 채택하지 않는다는 원칙에 동의하며, 위 파이프라인이 그 대안이다.

---

## 14. Coverage 기준

이번 STEP은 **7건 표본**뿐이라 통계적으로 유의미한 coverage 수치를 낼 수 없다 — 억지로 퍼센트를 만들지 않는다.

향후 실제 구현 시 반드시 분리해야 할 두 지표:

```
BUSAN_APARTMENT_ATTENDANCE_ZONE_COVERAGE
  = point-in-polygon 매칭 가능한 ApartmentMaster(exact geocode) 단지 수
    / 부산 ApartmentMaster 전체 단지 수

ELEMENTARY_ZONE_SOURCE_COVERAGE
  = 학구도 SHP가 실제로 커버하는 지리적 면적(또는 학교 수)
    / 부산 canonical School(초등, C2B-B 기준 305개) 수
```

"matched 대상 중 100%" 같은 착시 표현 금지 — 항상 분모를 명시.

---

## 15. Parent UX Data Contract 제안 (설계만)

```ts
interface SchoolAccessInfo {
  nearbySchools: {
    school: string;
    distanceMeters: number;
    distanceType: 'STRAIGHT_LINE'; // SCHOOL V2-C5-A 원칙 재사용, "도보 N분" 금지
  }[];

  attendanceZone: {
    status: 'AVAILABLE' | 'JOINT_ZONE' | 'SCHOOL_GROUP' | 'NOT_FOUND' | 'DATA_UNAVAILABLE';
    zoneType: 'SINGLE' | 'JOINT_SYMMETRIC' | 'JOINT_ASYMMETRIC' | 'MIDDLE_SCHOOL_GROUP' | 'HIGH_SCHOOL_GROUP' | null;
    schools: { name: string; priority: string | null }[]; // JOINT/GROUP이면 2개 이상
    sourceYear: string; // 데이터기준일자 — 반드시 표시
    source: string; // "한국교육시설안전원 학구도"
    confidence: 'OFFICIAL_ZONE_MATCH'; // identity resolver 신뢰도(§5)와는 별개 축
  } | null; // 데이터 자체가 없으면 null, 절대 추정 채우지 않음
}
```

중학교/고등학교는 `attendanceZone.zoneType`이 `*_SCHOOL_GROUP`일 때 `schools` 배열이 항상 2개 이상이라는 것을 소비 측(SCHOOL V2-D)이 반드시 알고 렌더링해야 한다 — 단일 문자열로 뭉개면 안 됨.

---

## 16. Score와의 분리 확인

이번 STEP은 코드 변경이 없으므로 Score(`ApartmentLocationFeature`/`nearestElementaryDistanceM`/`school-access-sentence.ts`)를 전혀 건드리지 않았다. §15의 `attendanceZone`은 `nearbySchools`(Score가 참조하는 것과 같은 개념)와 명시적으로 분리된 별도 필드로 설계했다 — Score formula 변경은 이번 STEP 범위 밖이며 앞으로도 별도 future STEP 결정 사항으로 유지.

---

## 17. Legal/Source Gate

§1에서 확정한 대로 **`ATTENDANCE_ZONE_LEGAL_GATE = CLEARED`**(원본 파일 기준, "이용허락범위 제한없음" 원문 확인) — 단, 이는 `SCHOOLINFO_COORDINATE_USE_GATE`/`SCHOOLINFO_STATISTICS_USE_GATE`(둘 다 CONDITIONAL, LEGAL-1)와는 **완전히 별개의 데이터 소스·라이선스**임을 명확히 한다. 이번 STEP은 SchoolInfo의 게이트 상태를 전혀 변경하지 않았다.

---

## 18. Tests

이번 STEP은 point-in-polygon을 공식 UI에 위임했고(원본 geometry 미확보, §3/§4), 실제 코드(resolver/파서)를 작성하지 않았다 — 따라서 신규 테스트 대상 코드가 없다. `tsc`/`lint`는 코드 변경이 없어 실행하지 않았다(레포에 실제 diff는 이 문서와 CHANGELOG뿐).

---

## 19. 문서

이 파일 신규(`SCHOOL-V2-C6-attendance-zone-audit.md`) — 기존 C2B-A/LEGAL-1/C5 계열 문서 전부 보존, 겹치는 내용 없음(완전히 다른 데이터 소스).
