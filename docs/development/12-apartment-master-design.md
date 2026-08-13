# 이집 Apartment Master 데이터 모델·식별자·수집정책 설계 — MASTER M2

작성일: 2026-08-13
성격: 조사 + 설계 전용(schema/migration/DB 변경/코드 수정/commit/push 전부 없음). MASTER M1(`11-apartment-master-analysis.md`)의 결론을 전제로, 실제 구축 전 데이터 모델·식별자·수집정책·갱신정책·지역확장 방식을 확정하기 위한 근거를 추가로 확보했다.

---

## A. 조사 목적

M1이 "Apartment Master가 필요한가"에 답했다면, M2는 "그 Master의 한 행(row)은 정확히 무엇이고, 어떤 필드·식별자·정책으로 구성돼야 하는가"에 답한다. 추측이 아니라 M1보다 넓은 범위(10개 지역, 18개월, 총 64,705건)의 실측과 신규 API 조사(건축물대장 표제부/총괄표제부 비교, mgmBldrgstPk 단위 판정)로 근거를 확보했다.

---

## B. M1 결과 재확인

작업 시작 전 `git status`(clean, main=origin/main 동일 커밋)와 다음 문서를 재확인했다: `11-apartment-master-analysis.md`, `10-presale-location-market-analysis.md`, `09-presale-detail-ui.md`, `06-presale-initial-backfill.md`, `DECISIONS.md`, `CHANGELOG.md`. M1의 최종 판단(신규 `ApartmentMaster` 모델 + 기존 `Apartment` 점진 이관, aptSeq는 "유용하지만 복합키/추가 검증 필요")을 이번 STEP의 전제로 그대로 사용했으며 뒤집지 않았다.

Prisma schema 재확인 결과, `Apartment` 모델을 참조하는 FK는 schema 전체에 **존재하지 않음**을 재확인했다(`grep`으로 `Apartment`가 정의부 외에는 주석 1곳에만 등장). 코드에서 `prisma.apartment`를 쓰는 곳은 정확히 3개 파일뿐임을 재확인했다: `api/apt/[name]/route.ts`(lawdCd/dong 캐시 조회), `api/apt/[name]/info/route.ts`(건축물대장 결과 upsert), `api/apt/[name]/facilities/route.ts`(커뮤니티시설 캐시 조회). 셋 다 `(name, dong)` 키로만 접근하며 `id`를 다른 곳에서 참조하지 않는다.

---

## C. ApartmentMaster 정의(질문 A에 대한 답)

### C-1. 실측 근거

이번 STEP에서 서울 마포구 데이터를 심층 조사하던 중, `"공덕SK리더스뷰"`라는 **동일 이름·동일 지번(공덕동 479)**의 단지가 실제로는 **두 개의 서로 다른 `aptSeq`**(`11440-5909`, `11440-5910`)로 나뉘어 있는 사례를 발견했다. 원본 거래 데이터를 직접 대조한 결과:

| aptSeq | 관측된 동(aptDong) | 전용면적대 |
|---|---|---|
| `11440-5909` | 101/102/103동 | 84~115㎡대 |
| `11440-5910` | 201/202동 | 59㎡대 |

이는 데이터 결함이 아니라 **같은 브랜드·같은 지번이라도 동군(building group)·면적대·분양차수가 다르면 MOLIT가 별도 `aptSeq`를 부여한다**는 것을 보여주는 실제 사례다. 또한 `getBrRecapTitleInfo`(총괄표제부) 조회 결과, 같은 지번에 총괄표제부 레코드가 여러 건 잡힐 수 있다는 것이 기존 코드 주석(`apt-building-info.ts`)에도 이미 기록돼 있었다 — 즉 "주소(지번) 1개 = 단지 1개"라는 가정도 항상 성립하지는 않는다.

### C-2. 결론

**ApartmentMaster의 한 행은 "MOLIT `aptSeq` 1개(또는 그에 상응하는 건축물대장 총괄표제부 레코드 1개)"로 정의하는 것을 권장한다** — "주소 단위"나 "건축물대장 표제부(개별 동) 단위"가 아니다.

- 주소 단위(지번)로 묶으면 §C-1의 공덕SK리더스뷰처럼 실제로는 별개인 두 단지를 하나로 잘못 합치게 된다.
- 건축물대장 표제부(개별 동) 단위로 쪼개면 §G-2에서 확인하듯 하나의 실제 단지(예: e편한세상 송도 더퍼스트비치, 11개 동)가 11개 행으로 과도하게 분해된다.
- `aptSeq` 단위는 실거래 연결의 최소 단위이자, 사용자가 "하나의 단지"로 인식하는 단위(같은 이름·같은 동군)와 실질적으로 일치한다.

---

## D. aptSeq 검증 결과(확장, 질문 C)

### D-1. 조사 범위

M1(4개 지역: 서울 강남구/경기 성남분당구/부산 서구/대구 수성구, 18개월, 16,579건)에 더해, 이번 STEP에서 **6개 지역**을 추가로 18개월씩 실측했다.

| 지역 | lawdCd | 총 거래 | aptSeq 확보 | 고유 aptSeq | 동일명-다른단지 충돌 |
|---|---|---|---|---|---|
| 서울 마포구 | 11440 | 4,999 | 4,999(100%) | 272 | 7건 |
| 부산 해운대구 | 26350 | 6,956 | 6,956(100%) | 294 | 4건 |
| 경기 수원영통구 | 41117 | 9,607 | 9,607(100%) | 146 | 3건 |
| 인천 연수구 | 28185 | 8,535 | 8,535(100%) | 194 | 8건 |
| 전북 전주덕진구 | **52113**(§D-3 참고) | 7,772 | 7,772(100%) | 240 | 6건 |
| 경남 창원성산구 | 48250 | 10,257 | 10,257(100%) | 399 | 6건 |

**10개 지역 합계: 64,705건, aptSeq null 비율 0.000%.**

### D-2. 안정성/유일성 재확인

- **같은 aptSeq, 다른 이름(불안정)**: 6개 신규 지역 전부 0건.
- **같은 aptSeq, 다른 주소(불안정)**: 6개 신규 지역 전부 0건.
- **같은 이름+주소, 다른 aptSeq**: 마포구에서 1건(§C-1 공덕SK리더스뷰) — 조사 결과 데이터 결함이 아니라 동군 분리로 판명.
- **동일 정규화 이름, 다른 단지(다른 aptSeq) 충돌**: M1(강남구 10건) + M2(6개 지역 합계 34건) = **총 44건 관측**. "현대", "삼성", "신동아"처럼 흔한 이름일수록 전국 어디서나 반복적으로 이 충돌이 발생함을 확인했다 — **이름 매칭은 전국 확장 시 절대 단독 식별자로 쓸 수 없다**는 M1의 결론을 더 강한 근거로 재확인했다.
- **단지명 변경 + aptSeq 유지 사례**: 이번 관측 기간(18개월)에서는 발견되지 않았다 — **단, 이는 "그런 사례가 없다"는 증거가 아니라 "18개월이라는 짧은 관측 기간 안에서는 재건축/개명처럼 수년 단위로 드물게 발생하는 이벤트를 포착할 수 없었다"는 한계**로 기록한다(§T, §R에서 다시 다룸).

### D-3. 실측 중 발견한 중대 사례 — 전북 행정구역(도) 단위 코드 이관

전북 전주덕진구를 알려진 코드(`45113`)로 조회했을 때 **18개월 전 기간 `totalCount=0`**이 나왔다(API 오류 아님, `resultCode=000` 정상 응답). 추가 조사 결과:

| lawdCd | 결과 |
|---|---|
| `45111`(구, 전주 완산구) | 0건 |
| `45113`(구, 전주 덕진구) | 0건 |
| `45790`(구, 군산시) | 0건 |
| `52111`(신) | **403건**, 응답의 `estateAgentSggNm`="전북 전주시 완산구" |
| `52113`(신) | **401건**, `estateAgentSggNm`="전북 전주시 덕진구" |
| `52790`(신) | **9건** |

**MOLIT는 이미 옛 전라북도 지역 전체(전주·군산 등)의 `LAWD_CD` 시/도 접두어를 `45`에서 `52`로 이관 완료한 상태였다** — 이는 2024년 전북특별자치도 출범과 연동된 것으로 추정된다(이번 STEP에서 원인을 공식 문서로 확정하지는 못함, 정황 근거). 반면 `REGCODE_PROXY`(이 프로젝트가 의존하는 제3자 Cloud Run)에 `52` 접두어로 조회하면 **결과가 0건**이었다 — REGCODE_PROXY는 이 이관을 전혀 모르고 있다.

**이는 M1이 발견한 인천 서구 사례(구 단위 개편)보다 훨씬 큰 규모(도 전체)의 실측 사례**이며, "REGCODE_PROXY가 최신 상태라고 가정하면 안 된다"는 것을 명확한 증거로 보여준다. 이번 STEP에서 이 코드 이관을 해결하는 로직은 만들지 않는다(§R).

---

## E. 외부 식별자 정책(질문 B, D)

### E-1. 두 후보 재확인 + 실측 보강

| 식별자 | 단위 판정(이번 STEP 실측) | 근거 |
|---|---|---|
| `aptSeq` | 단지(§C 정의) 단위 | §D |
| `mgmBldrgstPk` | **단지(총괄표제부) 단위로 보임** | §G-3 |

### E-2. mgmBldrgstPk 단지/건물 판정(질문 D)

e편한세상 송도 더퍼스트비치(11개 동, 세대수 1,302)를 두 가지 엔드포인트로 각각 조회해 비교했다.

- `getBrRecapTitleInfo`(총괄표제부, 단지 전체 집계): 1개 레코드, `mgmBldrgstPk = 1.0000000000000042e+21`
- `getBrTitleInfo`(표제부, 개별 동 단위): 조회 시 1개 레코드만 반환("121동"), **동일한 `mgmBldrgstPk` 값**

**같은 `mgmBldrgstPk`가 총괄표제부·표제부 양쪽에서 동일하게 나타난다는 것은, 이 값이 개별 동이 아니라 단지(총괄표제부가 대표하는 건축물군) 단위의 식별자라는 것**을 뒷받침한다. 다만:

- `getBrTitleInfo`를 별도 파라미터 없이 호출하면 전체 동(11개) 중 1개만 반환되는 것으로 관측돼(§G-2), 개별 동을 전수 열거하려면 추가 파라미터/반복 호출이 필요해 보인다(이번 STEP에서 완전히 규명하지 못함, 확인 필요 사항).
- `apt-building-info.ts` 기존 코드 주석이 "같은 지번에 총괄표제부가 여러 건 잡히는 경우(드묾)"를 이미 언급하고 있어, `mgmBldrgstPk`도 §C-1(공덕SK리더스뷰)과 유사한 분리 등록 사례에서는 한 "단지"에 여러 값이 존재할 수 있다.
- 값 자체가 매우 큰 정수(`1e+21` 규모)로, **JavaScript `Number`로 역직렬화하면 정밀도 손실 위험이 있다 — 반드시 문자열로 취급해야 한다**(M1에서 이미 지적, 이번 STEP 실측으로 재확인).

**결론**: `mgmBldrgstPk`는 단지 식별자 후보로 유효하나, `aptSeq`와 마찬가지로 "복합키/추가 검증 필요"(M1의 aptSeq 판정과 동일한 신중도)로 다루는 것을 권장한다 — 단독으로 100% 신뢰하는 unique 제약을 걸지 않는다.

### E-3. 복합키 필요성(질문 C)

`aptSeq` 자체가 이미 `{lawdCd}-{일련번호}` 형식으로 지역코드를 내장하고 있어(M1 재확인), `aptSeq + 지역코드`처럼 별도 복합키를 만드는 것은 **중복 정보**다. 대신 실질적으로 유용한 보조 검증은:

- `aptSeq`(1차 unique 후보) + `umdCd/jibun`(주소 일치 여부를 무결성 검증에 사용, §X 참고) — unique 제약 자체가 아니라 **정합성 검증 트리거**로 활용.

---

## F. MOLIT 필드 분석(질문 E의 일부, §5 요청)

원본 XML 필드 전수를 용도별로 분류했다(M1에서 확인한 필드 + 이번 STEP에서 재확인).

| 분류 | 필드 |
|---|---|
| 1. 식별자 | `aptSeq`(단지), `sggCd`(=lawdCd, 지역) |
| 2. 이름 | `aptNm` |
| 3. 주소 | `umdNm`(법정동명), `jibun`(지번), `roadNm`(도로명), `roadNmBonbun`/`roadNmBubun`(도로명 본번/부번), `bonbun`/`bubun`(지번 본번/부번) |
| 4. 행정구역 | `umdCd`(법정동코드), `sggCd`, `roadNmCd`(도로명코드), `roadNmSggCd` |
| 5. 건물 기본정보 | `buildYear`(건축년도, 참고용 — §H에서 건축물대장 값과 우선순위 비교) |
| 6. 거래정보 | `dealAmount`/`dealYear`/`dealMonth`/`dealDay`/`excluUseAr`(전용면적)/`floor`/`dealingGbn`(거래유형)/`registryDate`(등기일자)/`dealCanceled`(해제여부) |
| 7. Master에 저장 불필요 | `buyerGbn`/`slerGbn`(매수/매도자 구분, 개인정보 성격이라 저장 부적절), `landCd`/`landLeaseholdGbn`(대지권 관련, 거래 단위 정보라 단지 마스터와 무관), `cdealDay`/`cdealType`(취소거래 관련, 거래 단위) |

**결론**: 1~4번 분류(`aptSeq`/`sggCd`/`aptNm`/`umdNm`/`umdCd`/`jibun`/`roadNm` 등)만 Master에 저장하고, 5~6번(건축년도/거래정보)은 M1에서 확정한 대로 "건축년도는 건축물대장 우선", "거래정보는 저장하지 않고 실시간 조회 유지"(§N) 원칙을 그대로 따른다. 7번은 저장하지 않는다.

---

## G. 건축물대장 연결 분석(질문 D, §6 요청)

### G-1. 조회 성공 실측(서울/부산/경기 각 1건 이상, M1 대비 확장 검증)

M1에서 성공 확인한 사례(부산 서구 e편한세상 송도 더퍼스트비치, 비스타동원더비치테라스, 대구 용마맨션)에 더해, 이번 STEP은 §E-2에서 총괄표제부/표제부 두 엔드포인트를 교차 검증했다. `sigunguCd(=lawdCd)` + `bjdongCd(=MOLIT umdCd 그대로 사용)` + `bun/ji(=jibun)`만으로 REGCODE_PROXY 없이 정상 조회됨을 재확인했다(M1 §E-2의 발견을 재확인).

### G-2. 단지 하나에 건축물대장 레코드가 몇 개 연결되는가

- **총괄표제부(`getBrRecapTitleInfo`)**: **1건**(단지 전체 집계 — `mainBldCnt`=11로 11개 동이 있음을 필드로 표시하지만, 레코드 자체는 1건).
- **표제부(`getBrTitleInfo`)**: 이번 호출 방식(동을 지정하지 않음)으로는 **1건만 반환**됐다 — 11개 동 전체를 열거하려면 개별 동 이름/일련번호를 추가로 지정해 반복 호출해야 하는 것으로 보이나, 이번 STEP에서 그 방법까지 완전히 규명하지는 못했다(확인 필요 사항, §T).

### G-3. mainBldCnt 및 동수 관련 필드

`mainBldCnt`(주동 수)와 `atchBldCnt`(부속동 수) 둘 다 존재함을 재확인했다. `totalDongTotCnt`류의 별도 필드는 이번 응답 전문에서 관측되지 않았다 — `mainBldCnt`가 요청안이 찾는 "동수" 필드에 해당하는 것으로 판단한다.

### G-4. Master에 저장할 건축물대장 필드(최종 후보)

`useAprDay`(사용승인일) / `platPlc`(지번주소) / `newPlatPlc`(도로명주소) / `mgmBldrgstPk`(관리번호, 문자열 저장) / `hhldCnt`(세대수) / `mainBldCnt`(동수) / `totPkngCnt`(주차대수) / `vlRat`(용적률) / `bcRat`(건폐율) / `mainPurpsCdNm`(주용도) — M1에서 이미 확인한 목록을 그대로 유지, 이번 STEP에서 추가로 확정한 필드는 없다.

---

## H. 주소 표준화 정책(질문 F, §7 요청)

### H-1. 저장 후보와 출처

| 필드 | 출처 | 비고 |
|---|---|---|
| `sido`/`sigungu`(텍스트) | `estateAgentSggNm`(MOLIT, §D-3에서 실측 확인 — 실제 지역명이 담긴 필드) 또는 REGCODE_PROXY 역산 | **§D-3 발견에 따라 REGCODE_PROXY보다 MOLIT 자체 응답의 지역명 필드를 우선 신뢰하는 것을 권장** — REGCODE_PROXY는 이관을 놓칠 수 있음이 실측으로 확인됐기 때문 |
| `lawdCd`(=`sggCd`) | MOLIT | 코드 자체(§D-3의 이관 문제를 안고 있으므로 §H-2에서 대응 정책 별도 제시) |
| `umdName`/`umdCd` | MOLIT | |
| `jibun` | MOLIT | 파싱 시 반드시 문자열로 강제 처리(M1 §X-2에서 발견한 `fast-xml-parser` 숫자 자동변환 함정 재확인 필요) |
| `roadAddress`(도로명주소 완성형) | 건축물대장 `newPlatPlc` | 조합 로직 불필요, 이미 완성된 텍스트 |
| `jibunAddress`(지번주소 완성형) | 건축물대장 `platPlc` | 위와 동일 |

### H-2. 행정구역 개편 대응 정책(§D-3 근거)

**행정구역 "이름"만 저장하지 않고, 반드시 "코드 + 코드의 유효 시점 정보"를 함께 저장하는 것을 권장**한다. 구체적으로:

1. `lawdCd`는 저장하되, **이 코드가 "언제 확인된 값인지"(`lawdCdVerifiedAt` 성격의 타임스탬프, 또는 최소한 레코드의 `updatedAt`)를 함께 관리**해, 향후 이관이 재발했을 때 "이 Master 행의 `lawdCd`가 최신인지 오래된 것인지" 구분할 수 있게 한다.
2. **"과거 거래 데이터의 코드"와 "현재 지도/주소 체계"를 분리해서 다룬다** — 실거래 연결(§N)은 항상 그 시점에 유효했던 `lawdCd`로 이뤄지므로 과거 데이터 자체를 소급 변경할 필요는 없지만, Master의 "현재 이 단지가 속한 지역"은 최신 `lawdCd`를 유지해야 한다. 즉 **거래 이력의 `lawdCd`(불변, 시점 기록)와 Master의 대표 `lawdCd`(가변, 최신 상태)를 개념적으로 분리**해야 한다.
3. REGCODE_PROXY를 지역 유효성의 유일한 진실 공급원으로 삼지 않는다 — **MOLIT 응답 자체의 `estateAgentSggNm` 필드나 실제 거래 존재 여부("이 lawdCd로 최근 거래가 조회되는가")를 코드 유효성의 보조 신호로 함께 사용**하는 것을 권장한다(이번 STEP에서 실제로 이 방법으로 `52` 이관을 발견했다).

---

## I. 좌표 확보 정책(질문 무관, §8 요청 — M1 F절 재확인 + 정책화)

### I-1. 우선순위

1. **정확한 도로명주소**(건축물대장 `newPlatPlc`) → Kakao 주소검색
2. **정확한 지번주소**(건축물대장 `platPlc` 또는 MOLIT `umdNm`+`jibun` 조합) → Kakao 주소검색
3. Kakao 키워드검색(단지명+동) — 1/2가 실패했을 때만 보조로 사용

이 순서는 Presale 지오코딩(P2-C/06 문서)이 이미 확정한 "번지 유지 우선, 행정구역 대표좌표 금지" 원칙과 동일한 사고방식이다.

### I-2. 금지 사항(그대로 재확인)

동 중심 좌표 저장 금지 / 시군구 중심 좌표 저장 금지 / 임의 좌표 생성 금지 / `area_only`(행정구역 대표) 좌표를 단지 좌표처럼 저장 금지 — Presale에서 이미 검증된 원칙을 그대로 계승한다.

### I-3. `geocodeQuality` 저장 필요성

**필요하다고 판단한다.** Presale의 `exact`/`normalized`/`area_only`/`failed` 4분류를 그대로 재사용하는 것을 권장한다 — 다만 M1/P2-D4-A에서 이미 지적했듯 **Presale은 이 분류값 자체를 컬럼으로 저장하지 않아 사후 구분이 불가능하다는 한계**가 있었다(10 문서 §2 재확인 사항). ApartmentMaster는 이 한계를 반복하지 않도록, **`geocodeQuality` 컬럼을 실제로 스키마에 포함해 저장하는 것을 명시적으로 권장**한다(§J).

---

## J. 후보 ApartmentMaster 스키마(질문 없음, §9 요청 — 문서 전용, 실제 schema 아님)

```
ApartmentMaster (문서용 후보 — Prisma schema 아님)

  id                 Int      @id @default(autoincrement())   // 내부 PK

  // 외부 식별자 (둘 다 nullable, 둘 다 unique 후보 — §E)
  aptSeq             String?  @unique   // MOLIT, "{lawdCd}-{seq}"
  mgmBldrgstPk       String?  @unique   // 건축물대장 총괄표제부 관리번호(문자열!)

  // 이름
  name               String             // 원본 표기(MOLIT aptNm 또는 건축물대장 bldNm 우선)
  normalizedName     String             // 매칭 보조용(§I, M1) — PK/unique 아님

  // 주소 (원본 필드 분리 보존, §H)
  sido               String?
  sigungu            String?
  lawdCd             String?            // = sggCd
  lawdCdUpdatedAt    DateTime?          // §H-2 — 코드 확인 시점
  umdName            String?
  umdCd              String?
  jibun              String?
  roadAddress        String?            // 건축물대장 newPlatPlc
  jibunAddress       String?            // 건축물대장 platPlc

  // 좌표 (§I)
  latitude           Float?
  longitude          Float?
  geocodeQuality     String?            // 'exact' | 'normalized' | 'failed' (area_only는 저장 안 함, Presale 정책 계승)

  // 건물 정보 (§G)
  totalHouseholds    Int?               // 건축물대장 hhldCnt
  mainBuildingCount  Int?               // 건축물대장 mainBldCnt(동수)
  parkingCount       Int?               // 건축물대장 totPkngCnt
  far                Float?             // 용적률
  bcr                Float?             // 건폐율
  buildYear          Int?               // 참고용(MOLIT), 아래 approvalDate가 있으면 그것을 우선
  approvalDate       String?            // 건축물대장 useAprDay 기반, 우선 필드

  createdAt          DateTime @default(now())
  updatedAt          DateTime @default(now()) @updatedAt
```

### J-1. 필드별 정리표

| 필드 | 출처 | nullable | unique | index 필요 | 갱신 가능성 |
|---|---|---|---|---|---|
| `id` | 자체 | 아니오 | PK | - | 불변 |
| `aptSeq` | MOLIT | 예(§D-2, 무거래 단지엔 없음) | 예(nullable unique) | 예(실거래 매칭 조회 빈번) | 매우 낮음(§D 실측) |
| `mgmBldrgstPk` | 건축물대장 | 예 | 예(nullable unique) | 예 | 매우 낮음(추정, 장기검증 필요) |
| `name` | MOLIT/건축물대장 | 아니오 | 아니오 | 아니오(정규화 이름으로 검색) | 낮음(재건축 시 변경 가능) |
| `normalizedName` | 계산값 | 아니오 | 아니오 | **예**(매칭 후보 검색용) | `name` 변경 시 재계산 |
| `sido`/`sigungu` | MOLIT `estateAgentSggNm` 우선(§H-2) | 예 | 아니오 | 예(지역 필터) | 개편 시(드묾) |
| `lawdCd` | MOLIT `sggCd` | 예 | 아니오 | 예 | 개편 시(§D-3처럼 실제 발생) |
| `umdName`/`umdCd`/`jibun` | MOLIT | 예 | 아니오 | `jibun`+`umdCd` 복합 index(건축물대장 재조회용) | 낮음 |
| `roadAddress`/`jibunAddress` | 건축물대장 | 예 | 아니오 | 아니오 | 낮음 |
| `latitude`/`longitude` | Kakao | 예(§I-2) | 아니오 | 예(공간 검색, P2-D4-A 반경검색 재사용 전제) | 보정 시 |
| `geocodeQuality` | 계산값 | 예 | 아니오 | 아니오 | `latitude` 갱신 시 동반 |
| `totalHouseholds`/`mainBuildingCount`/`parkingCount`/`far`/`bcr` | 건축물대장 | 예 | 아니오 | 아니오 | 낮음(리모델링 시) |
| `buildYear`/`approvalDate` | MOLIT/건축물대장 | 예 | 아니오 | 아니오 | 매우 낮음 |
| `createdAt`/`updatedAt` | 자체 | 아니오 | 아니오 | 예(`updatedAt`, 갱신 배치용) | 자동 |

**이 스키마는 문서 후보일 뿐이며, 이번 STEP에서 실제 Prisma schema에 반영하지 않는다.**

---

## K. Unique/Index 정책 요약

- **Unique 후보**: `aptSeq`(nullable), `mgmBldrgstPk`(nullable). 요청안이 제시한 "aptSeq 단독 unique"는 **아니오** — nullable unique로 둔다(§E, §R).
- **강한 색인 필요**: `normalizedName`(이름 기반 후보 검색), `lawdCd`(지역별 조회), `latitude`/`longitude`(공간 검색, DB 엔진에 따라 PostGIS 등 별도 검토 필요 — 이번 STEP 범위 밖).
- **복합 index 후보**: `(umdCd, jibun)` — 건축물대장 재조회 캐시 키로 유용.

---

## L. 기존 Apartment 이관 전략(§10 요청)

### L-1. 의존 코드 재확인(§B에서 이미 수행)

3개 파일만 `prisma.apartment`에 의존, FK 없음(§B) — M1의 조사와 동일 결론을 재확인했다.

### L-2. 전략 비교

| 전략 | 평가 |
|---|---|
| A. 기존 Apartment 확장 | `[name, dong]` unique 정책 자체가 §D의 이름충돌 문제를 해결 못함 — 근본 구조를 바꿔야 해서 사실상 B와 다르지 않음 |
| **B. ApartmentMaster 신규 생성 후 점진적 이관** | **권장(M1과 동일 결론 재확인)** — 3개 파일의 의존이 단순(`(name, dong)` 조회/upsert)해 이관 리스크가 낮음. 신규 `ApartmentMaster`를 채우면서 기존 `Apartment` 캐시 조회 로직을 점차 `ApartmentMaster` 조회로 교체 가능 |
| C. 기존 Apartment 제거 후 완전 교체 | FK가 없어 기술적으로는 가능하나, 이번 STEP은 "구현하지 않는다"는 원칙상 M3 이후 판단할 사항이며 지금 결정할 필요 없음 |

**이번 STEP에서는 실제 이관을 수행하지 않는다.** B안을 M3 이후 실행 전략으로 재확인한다.

---

## M. Presale 연결 구조(§11 요청)

```
Presale 좌표(latitude/longitude, 728/1,046건 확보 — P2-D4-A)
  ↓
ApartmentMaster 좌표(§I)
  ↓
거리 계산 — @turf/turf의 distance() 재사용 가능(§N에서 확인, M1이 이미 발견)
  ↓
반경 N km 아파트 후보
  ↓
aptSeq(있으면) 우선 매칭, 없으면 normalizedName 보조 매칭(§D-2, §C)
  ↓
MOLIT 실거래(§N)
```

### M-1. 반경 정책

**이번 STEP에서 특정 반경을 확정하지 않는다** — P2-D4-A가 이미 실측한 대로(500m/1km/2km에서 Kakao API 자체 상한 때문에 넓혀도 후보가 늘지 않는 지역이 있었음) 반경 자체보다 **API/데이터 가용성의 한계가 먼저 문제가 된다.** ApartmentMaster가 구축되면 Kakao 반경검색 대신 **DB 좌표 검색(예: `latitude`/`longitude` 범위 조건 또는 PostGIS)으로 대체 가능해져 이 상한 문제 자체가 사라질 잠재력**이 있다는 점만 설계 방향으로 기록한다.

### M-2. 도시 밀도별 반경 차등 필요성

`school/apartments/route.ts`가 이미 1.5km 고정 반경을 쓰고 있으나(§N), 밀도가 다른 지역(예: 서울 강남 vs 지방 중소도시)에서 같은 반경이 적절한지는 이번 STEP에서 검증하지 않았다 — M3에서 실제 구축 지역(부산 서구)의 밀도로 재평가할 사항으로 남긴다.

### M-3. 거리순 노출 개수

이번 STEP에서 확정하지 않는다(요청 범위 — "몇 개가 적절한가"는 실제 UI 설계 시점(P2-D4-B 재개 시)에 결정할 사항).

### M-4. 좌표 없는 Presale(318건, 30.4%) 처리

P2-D4-A가 이미 확정한 정책(area_only 저장 금지, "이 지역 최근 실거래"로 표현, "주변"이라는 단어 쓰지 않음)을 ApartmentMaster 연결에도 그대로 계승한다 — 좌표 없는 Presale은 ApartmentMaster 반경검색 자체를 적용할 수 없으므로 시/군/구 단위 근사만 가능하다.

---

## N. 실거래 연결 구조(§12 요청)

M1에서 이미 확인한 대로 MOLIT API는 `aptSeq`로 직접 조회하는 기능이 없다(`LAWD_CD`+`DEAL_YMD`만 지원). 따라서 연결 구조는:

```
ApartmentMaster.lawdCd + 조회 대상 월
  ↓ MOLIT 월별 조회(기존 fetchMolitData 재사용)
  ↓ 응답에서 aptSeq == ApartmentMaster.aptSeq인 항목만 필터
최근 실거래
```

**단지명 매칭을 기본키로 쓰지 않는다**(요청 원칙 그대로) — `aptSeq`가 있으면 그것으로 필터링하고, `aptSeq`가 없는 Master 행(무거래 신축 등)은 보조로 `umdCd`+`normalizedName` 조합 매칭을 쓰되 **결과에 "정확 매칭"과 "근사 매칭"을 구분해서 표시하는 것을 권장**한다(§D-2의 44건 이름충돌 실측이 이 구분의 필요성을 뒷받침한다).

### N-1. @turf/turf 재사용 가능성(질문, §11)

**가능하다.** `src/app/api/school/apartments/route.ts`가 이미 `point()`+`distance()`(단위 km)로 학교-아파트 간 정밀 거리를 계산하는 데 쓰고 있음을 M1에서 확인했고, 이번 STEP에서 코드를 재확인해 동일 함수가 ApartmentMaster-Presale 거리 계산에도 그대로 재사용 가능한 범용 함수임을 재확인했다. 신규 패키지 설치가 필요 없다(이미 `package.json`에 있음).

---

## O. 지역 확장 전략(§13 요청)

### O-1. Phase 구조

```
Phase 1  부산 서구(156개 고유 aptSeq, M1에서 확인 — 전수 수동검증 가능한 규모)
Phase 2  부산 전체
Phase 3  전국
```

### O-2. schema/식별자 정책의 전국 확장 가능성(질문 G)

**그대로 사용 가능하다고 판단한다** — 근거:

1. `aptSeq` 형식(`{lawdCd}-{seq}`)이 지역코드를 내장하고 있어 별도 지역별 스키마 분기가 필요 없다.
2. §D-3에서 발견한 "행정구역 코드 이관"(전북 45→52) 문제는 **schema 구조의 결함이 아니라 `lawdCd` "값"의 신선도 문제**다 — §H-2에서 제안한 정책(코드 확인 시점 저장 + MOLIT 응답 자체를 신뢰 신호로 사용)으로 스키마 변경 없이 대응 가능하다.
3. 건축물대장 조회 방식(`sigunguCd`+`bjdongCd`+`bun/ji`)도 전국 공통 API라 지역별 예외 처리가 필요 없다.

**단, M6(전국 확장) 시점까지 §D-3류의 지역코드 이관 사례가 몇 건이나 더 있는지는 이번 STEP에서 전수조사하지 않았다** — 강원/제주 등 과거 특별자치도 전환 사례도 유사한 문제가 있을 가능성이 있어(추정, 확인 필요), 전국 확장 직전 재점검을 권장한다.

---

## P. 동기화 정책(§14 요청)

| 트리거 | 처리 |
|---|---|
| 최초 구축 | §V(M1)의 복합 전략(MOLIT 우선 → Kakao 보완 → 건축물대장 enrichment) |
| **신규 aptSeq 발견**(요청안 예시 흐름) | 월별 MOLIT 조회 결과에 기존 `ApartmentMaster.aptSeq`에 없는 값이 나오면 → 해당 `umdCd`/`jibun`으로 Master 후보 레코드 생성(이름/주소만 채운 최소 상태) → 좌표(Kakao)/건축물대장 enrichment는 별도 배치로 후속 처리. **이 흐름 자체는 설계상 타당하다고 판단**하나, 이번 STEP에서 실제 구현/스케줄러는 만들지 않는다. |
| 단지명 변경 | MOLIT `aptNm`이 기존 저장값과 다름을 감지 → 자동 덮어쓰기가 아니라 플래그만 남기고 수동 확인 권장(§D-2에서 18개월 내 관측 사례가 없어 자동화 규칙을 확정할 근거가 부족) |
| 주소/행정구역 개편 | §H-2 정책(코드 신선도 관리) |
| 좌표 보정 | 필요시 수동 또는 재지오코딩(자동 주기 불필요, M1과 동일 결론) |
| 건축물대장 정보 갱신 | 분기~반기 단위 재조회 제안(자주 바뀌지 않는 정보, M1과 동일) |

**이번 STEP에서 스케줄러(cron)는 설계만 하고 만들지 않는다.**

---

## Q. 데이터 출처별 역할(§15 요청)

| 소스 | 역할 |
|---|---|
| MOLIT 실거래 API | 단지 발견(seed) / `aptSeq` 확보 / 거래 연결 / 지역명 신선도 보조 신호(§H-2) |
| 건축물대장(`BldRgstHubService`) | 준공일 / 동수 / 세대수 / 주차 / 용적률·건폐율 / `mgmBldrgstPk` |
| Kakao | 좌표(유일한 원천, §I) / 무거래 신축 단지 발견 보조(M1 §V) |
| 기존 `Apartment` | legacy 캐시 — 점진 이관 대상(§L), 신규 데이터의 소스로 사용하지 않음 |
| REGCODE_PROXY | **보조적으로만 사용, 지역코드 유효성의 최종 권위로 신뢰하지 않음(§D-3, §H-2)** |

### 소스 실패 시 저장 가능 범위

- MOLIT만 성공(건축물대장/Kakao 실패): `aptSeq`/`name`/`umdName`/`umdCd`/`jibun`/`lawdCd`만 채운 최소 Master 행 — 좌표/세대수는 null.
- 건축물대장만 추가 성공: 건물 정보(§G-4) 채움, 좌표는 여전히 null.
- Kakao까지 성공: 좌표+`geocodeQuality` 채움 — 이 단계에서 비로소 Presale 반경검색(§M)에 활용 가능.

---

## R. 기술부채(§17 요청)

`school/apartments/route.ts`의 `fetchBuildYearFromRegistry()`가 폐기된 건축물대장 API(`BldRgstService_v2/getBrTitleInfo`)를 여전히 호출하는 문제(M1에서 발견)는 **이번 STEP에서도 수정하지 않는다.** ApartmentMaster 구축 이후 별도 STEP에서 교체 여부를 판단하도록 기술부채로 유지한다.

추가로 이번 STEP에서 발견한 미확정 사항(§S에서 M3 진입 조건과 함께 정리):

- 건축물대장 표제부(개별 동)를 전수 열거하는 정확한 호출 방법 미규명(§G-2).
- `mgmBldrgstPk`의 장기(수년 단위) 안정성 미검증(§E-2).
- 단지명 변경 + `aptSeq` 유지 사례를 실측으로 확인하지 못함(18개월 관측 한계, §D-2).
- §D-3류의 행정구역 코드 이관이 전북 외에 추가로 몇 건 있는지 전수조사하지 못함(§O-2).

---

## S. M3 구현안 및 진입 조건(§16 요청)

### S-1. M3 진입 전 확정 여부 체크

| 항목 | 확정 여부 |
|---|---|
| ApartmentMaster row 의미 | **확정**(§C — aptSeq 1개 = 1행) |
| 내부 PK | **확정**(§J — 자체 `id`) |
| aptSeq 정책 | **확정**(nullable unique, §E) |
| unique 정책 | **확정**(§K) |
| 주소 정책 | **확정**(원본 필드 분리 보존 + 코드 신선도 관리, §H) |
| 좌표 품질 정책 | **확정**(`geocodeQuality` 컬럼 신설 권장, §I-3) |
| 건축물대장 연결 정책 | **대체로 확정**(§G) — 단, 개별 동 전수 열거 방법은 미확정 |
| 기존 Apartment 병행 정책 | **확정**(B안, §L) |
| 신규 단지 발견 정책 | **설계만 완료, 실측 미검증**(§P) |

### S-2. M3 권장 범위

**부산 서구 우선(Phase 1, §O)** — M1이 이미 확인한 156개 고유 `aptSeq` 규모에서, 이번 STEP이 확정한 스키마 후보(§J)로 **소량 실제 구축 검증**을 수행하는 것을 M3의 범위로 권장한다.

---

## T. 미확정 사항(§21 요청 문항 45 대응)

1. §G-2(건축물대장 표제부 개별 동 전수 열거 방법)
2. §E-2(`mgmBldrgstPk` 장기 안정성)
3. §D-2(단지명 변경+aptSeq 유지 사례 — 관측 기간 한계)
4. §O-2(전북 외 행정구역 코드 이관 추가 사례 전수조사)
5. §M-2(도시 밀도별 반경 차등 필요 여부 — 부산 서구 실측 전까지는 판단 보류)
6. §J의 후보 schema 자체(index 세부사항, PostGIS 도입 여부 등)는 M3 착수 시점에 재확정 필요

---

## U. 최종 권고

Apartment Master의 한 행은 **`aptSeq` 단위**로 정의하고, **내부 PK(자체 `id`) + `aptSeq`/`mgmBldrgstPk`(둘 다 nullable unique)** 구조로 설계하며, **주소는 원본 필드를 분리 보존하되 `lawdCd`의 신선도를 별도 관리**하고(§D-3의 전북 사례가 이 필요성을 강하게 뒷받침), **좌표는 Kakao만을 원천으로 `geocodeQuality`를 함께 저장**하는 것을 권고한다. 기존 `Apartment`는 삭제하지 않고 신규 `ApartmentMaster`로 점진 이관하며, 초기 구축은 부산 서구로 한정한다. M3는 이 설계를 바탕으로 한 소량 실제 구축 검증으로 진행할 것을 권장한다.

---

## 최종 보고

1. **ApartmentMaster 한 행의 최종 정의**: MOLIT `aptSeq` 1개(또는 상응하는 건축물대장 총괄표제부 1건) = 1행. §C
2. **aptSeq 추가 조사 범위**: 6개 신규 지역(서울 마포/부산 해운대/경기 수원영통/인천 연수/전북 전주덕진/경남 창원성산), 각 18개월. §D-1
3. **조사한 실거래 건수**: 이번 STEP 48,126건(6개 지역) + M1 16,579건(4개 지역) = **총 64,705건, 10개 지역**. §D-1
4. **aptSeq null 비율**: **0.000%**(64,705건 전량). §D-1
5. **aptSeq 지역간 중복 여부**: 0건(형식상 lawdCd 내장으로 구조적 불가, 10개 지역 전수 확인). §D(M1+M2 종합)
6. **aptSeq 월별 안정성**: 6개 신규 지역 전부 불안정 사례 0건(M1의 4개 지역과 합쳐 10개 지역 모두 0건). §D-2
7. **동일명-다른단지 사례 수**: **총 44건**(M1 강남구 10건 + M2 6개 지역 34건). §D-2
8. **단지명 변경 + aptSeq 유지 사례 여부**: **미발견**(18개월 관측 한계 — 없다는 증거는 아님). §D-2, §T
9. **aptSeq 최종 평가**: M1의 "B(유용하지만 복합키/추가 검증 필요)"를 그대로 유지·강화 — 64,705건 규모로도 불안정 사례가 없어 신뢰도는 더 높아졌으나, 관측 기간 한계(18개월)와 MOLIT의 aptSeq 직접조회 미지원(§N)이라는 구조적 제약은 여전함.
10. **권장 내부 PK**: 자체 `id`(autoincrement). §J, §R
11. **권장 external identifier**: `aptSeq`(nullable unique) + `mgmBldrgstPk`(nullable unique, 문자열). §E, §J
12. **권장 unique 정책**: `aptSeq` 단독 unique는 아님(nullable unique로 완화) — §D-2의 관측 한계 때문. §K
13. **mgmBldrgstPk 조사 결과**: 총괄표제부/표제부 양쪽에서 동일 값 확인 → **단지 단위 식별자로 판단**, 단 장기 안정성 미검증 + 드물게 한 지번에 복수 존재 가능(기존 코드 주석). §E-2
14. **MOLIT에서 Master에 저장할 필드**: `aptSeq`/`aptNm`/`umdNm`/`umdCd`/`jibun`/`sggCd`/`roadNm` 등(§F 1~4분류), 거래정보(5~6분류)는 저장 안 함.
15. **건축물대장에서 저장할 필드**: `useAprDay`/`platPlc`/`newPlatPlc`/`mgmBldrgstPk`/`hhldCnt`/`mainBldCnt`/`totPkngCnt`/`vlRat`/`bcRat`/`mainPurpsCdNm`. §G-4
16. **건축물대장 연결 성공/실패 사례**: 성공(e편한세상 송도 더퍼스트비치, 비스타동원더비치테라스, 용마맨션 — M1) + 이번 STEP 총괄표제부/표제부 교차검증 성공. 실패 사례는 M1의 조사 스크립트 결함(파싱 문제)이었을 뿐 API 자체 실패 사례는 확인되지 않음. §G
17. **umdCd 직접 활용 가능 여부**: **가능**(REGCODE_PROXY 우회 경로, M1에서 발견, 이번 STEP 재확인). §G-1
18. **REGCODE_PROXY 필요 여부**: 거래 있는 단지는 불필요(umdCd로 대체 가능). 무거래 신축 단지의 지역코드 확보에는 여전히 필요할 수 있음 — 단, §D-3에서 확인했듯 **REGCODE_PROXY 자체를 지역코드 유효성의 최종 근거로 신뢰해서는 안 됨**. §D-3, §H-2
19. **주소 저장 정책**: 원본 필드 분리 보존(단일 텍스트 컬럼 금지), 건축물대장의 완성형 주소(`platPlc`/`newPlatPlc`) 활용. §H-1
20. **행정구역 개편 대응 정책**: `lawdCd`에 신선도(확인 시점) 관리 추가 + MOLIT 응답 자체를 지역코드 유효성 보조 신호로 사용 + 거래이력의 lawdCd(불변)와 Master 대표 lawdCd(가변) 개념적 분리. §H-2
21. **좌표 확보 정책**: 도로명주소→지번주소→키워드 순 Kakao 지오코딩만 사용, 행정구역 대표좌표/임의좌표 금지. §I-1~2
22. **geocodeQuality 저장 필요 여부**: **필요**(Presale이 사후 구분 불가능했던 한계를 반복하지 않기 위해 컬럼으로 명시 저장 권장). §I-3
23. **후보 ApartmentMaster 필드 수**: 21개(§J 스키마 후보 기준, PK/timestamps 포함).
24. **주요 index 후보**: `normalizedName`, `lawdCd`, `latitude`/`longitude`, `(umdCd, jibun)` 복합. §K
25. **기존 Apartment 의존 코드**: 3개 파일(`api/apt/[name]/route.ts`, `info/route.ts`, `facilities/route.ts`), FK 없음. §B, §L-1
26. **기존 Apartment 처리 권장안**: B(신규 모델 생성 후 점진 이관), M1과 동일 결론 재확인. §L-2
27. **Property와의 관계**: 이번 STEP에서 추가 조사 없음(M1에서 이미 0건·미사용 확인, 변경 없음).
28. **Presale 연결 방식**: 좌표→ApartmentMaster 좌표→@turf/turf 거리계산→aptSeq 우선 매칭. §M
29. **실거래 연결 방식**: `lawdCd`+월 단위 MOLIT 조회 후 `aptSeq`로 사후 필터링(MOLIT가 aptSeq 직접조회 미지원이라 이 구조가 유일). §N
30. **@turf/turf 재사용 가능 여부**: **가능**(이미 `school/apartments/route.ts`에서 실사용 중, 신규 패키지 불필요). §N-1
31. **주변 아파트 거리 정책 권장안**: 이번 STEP에서 특정 반경 확정 안 함 — Kakao API 상한 문제 자체가 ApartmentMaster 도입으로 해소될 잠재력이 있다는 방향만 제시. §M-1
32. **좌표 없는 Presale 처리 정책**: P2-D4-A 기존 정책(시/군/구 단위 근사, "주변" 표현 금지) 그대로 계승. §M-4
33. **M3 최초 구축 권장 지역**: 부산 서구(156개 고유 단지, M1 확인). §O-1, §S-2
34. **부산→전국 확장 방식**: schema/식별자 정책 변경 없이 그대로 확장 가능(단, §D-3류 행정구역 이관 재점검 필요). §O-2
35. **최초 Master 구축 방식**: MOLIT 우선(aptSeq 확보) → Kakao 보완(무거래 단지) → 건축물대장 enrichment(M1 §V 계승).
36. **신규 aptSeq 발견 시 처리 방식**: 월별 조회에서 미등록 aptSeq 발견 시 최소 정보로 Master 후보 생성 → 후속 배치로 enrichment(설계만, 미구현). §P
37. **Master 갱신 주기 권장안**: 이름/거래 관련은 월 단위 감지, 건축물대장은 분기~반기, 좌표는 필요시 수동. §P
38. **데이터 출처별 역할**: MOLIT(발견/식별/거래), 건축물대장(건물정보), Kakao(좌표), 기존 Apartment(legacy, 신규 소스 아님), REGCODE_PROXY(보조적, 최종 권위 아님). §Q
39. **발견된 기존 코드 문제**: (a) `school/apartments/route.ts`의 폐기 API 호출(M1 재확인, 미수정), (b) **전북(전주/군산 등) 전체 지역의 MOLIT `LAWD_CD` 접두어가 `45`→`52`로 이미 이관됐으나 이 프로젝트의 `REGCODE_PROXY`는 전혀 인지하지 못하는 상태(이번 STEP 신규 발견, 인천 서구 사례보다 훨씬 큰 규모)**, (c) 마포구 "공덕SK리더스뷰"처럼 동일 이름·주소인데 aptSeq가 다른 사례가 실제로 존재함(단, 조사 결과 데이터 결함이 아니라 동군 분리로 판명).
40. **이번 STEP에서 코드 수정 여부**: **없음**.
41. **DB 변경 여부**: **없음**(조회만 수행).
42. **생성/수정 문서**: 신규 `docs/development/12-apartment-master-design.md`(본 문서), `docs/development/CHANGELOG.md` 갱신 예정.
43. **git diff --stat**: 아래 참고.
44. **git status --short**: 아래 참고.
45. **미확정 사항**: §T의 6개 항목(건축물대장 개별 동 열거 방법/mgmBldrgstPk 장기안정성/단지명변경 사례/추가 행정구역 이관 전수조사/도시밀도별 반경/schema 세부사항).
46. **M3 진입 가능 여부**: **가능**(§S-1 — 9개 핵심 항목 중 7개 확정, 2개는 "대체로 확정" 또는 "설계만 완료" 수준으로 M3 진행을 막을 정도는 아님).
47. **최종 판단**: 아래 참고.

### git diff --stat / git status --short

```
$ git status --short
 M docs/development/CHANGELOG.md
?? docs/development/11-apartment-master-analysis.md
?? docs/development/12-apartment-master-design.md
```

(`11-apartment-master-analysis.md`와 `CHANGELOG.md`의 M1 변경분은 이전 STEP에서부터 미commit 상태로 남아있던 것이며, 이번 M2 STEP에서도 commit하지 않는다 — 사용자 지시에 따름.)

---

## 최종 판단

### **A. 설계가 충분히 확정되어 MASTER M3 소량 구축 검증으로 진행 가능**

**근거**:

1. M3 진입에 필요한 9개 핵심 항목(§S-1) 중 7개가 명확히 확정됐고, 나머지 2개(건축물대장 연결의 세부 호출방법, 신규단지 발견 정책)도 **"방향은 확정, 세부 구현만 M3에서 실측하며 다듬으면 되는 수준"**이라 M3 진행 자체를 막지 않는다.
2. 이번 STEP에서 10개 지역·64,705건이라는 훨씬 넓은 실측으로 `aptSeq`의 신뢰도(null 0%, 불안정 0건)가 M1보다 더 강하게 재확인됐고, 유일하게 발견된 예외(공덕SK리더스뷰)도 데이터 결함이 아니라 §C의 row 정의(aptSeq 단위)를 오히려 뒷받침하는 사례로 해석됐다.
3. §D-3에서 발견한 행정구역 코드 이관(전북 45→52) 문제는 크지만, **schema 구조를 바꿔야 하는 문제가 아니라 "값의 신선도 관리 정책"(§H-2)으로 대응 가능**하다는 것을 이번 STEP에서 확인했다 — 즉 이 발견이 M3 진행을 막을 근본적 결함은 아니다.
4. 부산 서구(Phase 1)라는 현실적이고 검증 가능한 초기 범위가 M1부터 이미 확정돼 있고, 이번 STEP은 그 범위에 적용할 스키마·정책을 구체화했다.

M3에서 다뤄야 할 남은 불확실성(§T)은 "설계를 다시 해야 하는 수준"이 아니라 "소량 실제 구축 과정에서 실측하며 확정하면 되는 수준"으로 판단한다.

---

commit 하지 않는다. push 하지 않는다. MASTER M3로 넘어가지 않는다. ApartmentMaster schema를 만들지 않는다. DB를 변경하지 않는다. P2-D4-B를 시작하지 않는다. 재개발/커뮤니티 작업을 시작하지 않는다.

검수를 기다립니다.

---

## 최종 검수 결정 (2026-08-13)

MASTER M2(Apartment Master 데이터 모델·식별자·수집정책 설계)를 **최종 완료**로 승인한다.

### 1. ApartmentMaster 1행의 의미 — 확정

**MOLIT `aptSeq` 1개 = `ApartmentMaster` 1행**(§C의 결론 그대로 확정).

단, **내부 PK는 `aptSeq` 자체를 사용하지 않는다.**

```
ApartmentMaster.id   → 이집 내부 PK(자체 autoincrement)
aptSeq                → MOLIT 외부 식별자(nullable unique 후보)
```

`aptSeq`는 §D의 실측(10개 지역, 64,705건, null 0%, 불안정 0건)으로 높은 신뢰도를 확인했지만, 이 값이 이집이 통제할 수 없는 **외부 시스템(MOLIT)의 식별자**라는 근본적 성격은 변하지 않는다 — 그래서 내부 관계(FK 등)의 절대 기준(PK)으로 직접 쓰지 않고, 내부 `id`를 두고 `aptSeq`는 매칭/검증용 외부 키로만 취급한다는 §R의 설계를 그대로 확정한다.

### 2. REGCODE_PROXY 최종 정책 — 확정

M2에서 발견한 전북 지역코드 이관 사례(전북 전역의 MOLIT `LAWD_CD` 접두어가 `45`→`52`로 이미 이관됐으나 `REGCODE_PROXY`가 이를 전혀 반영하지 못함, §D-3)를 **중요 기술 결정**으로 기록한다.

- 향후 ApartmentMaster 구축에서 **`REGCODE_PROXY`를 지역코드의 authoritative source(최종 권위 있는 근거)로 사용하지 않는다.**
- 가능한 경우 MOLIT 원본의 `sggCd`(=lawdCd)/`umdCd`를 우선 활용한다(§G-1, §H).
- `REGCODE_PROXY` **제거 여부는 이번 STEP에서 결정하지 않는다** — 실제 M3 구현 과정에서 기존 의존 코드(`geocode-apt.ts`/`region-utils.ts`/`apt-building-info.ts`)를 다시 조사한 뒤 결정한다.
- 이번 STEP에서 관련 코드를 수정하지 않는다(§9 금지 항목).

### 3. mgmBldrgstPk 최종 정책 — 확정

건축물대장 조사 결과(§E-2) `mgmBldrgstPk`는 **유용한 외부 식별자**로 기록하되, **MOLIT `aptSeq`와 동일한 의미의 식별자로 간주하지 않는다** — 소관 기관과 갱신 주기, 단위(§E-2에서 확인한 "단지 단위로 보이나 장기 안정성 미검증") 모두 `aptSeq`와 독립적이기 때문이다.

향후 연결 구조는 다음 방향으로 설계한다(개념만 확정, 실제 relation/mapping 방식은 M3 소량 검증 이후 최종 결정):

```
ApartmentMaster → MOLIT aptSeq (실거래 연결용 외부 식별자)
ApartmentMaster → 건축물대장 식별자/연결정보 (건물정보 enrichment용, mgmBldrgstPk 포함)
```

### 4. MASTER M3 방향 — 확정

MASTER M3는 **"ApartmentMaster 소량 실제 구축 검증"** 단계로 정의한다.

- **전국 구축 금지, 부산 전체 구축도 금지.**
- M3에서는 성격이 다른 두 지역을 소량 비교한다: **부산 서구 + 부산 해운대구**.
  - 부산 서구 → 작은 데이터셋(M1 확인 156개 고유 단지)에서 사람이 직접 검수하기 쉬운 **Alpha Master**.
  - 부산 해운대구 → 단지/거래량/유형이 더 다양한 환경(M2 실측 294개 고유 단지, 서구의 약 2배 규모)에서의 **구조 Stress Test**.
- 실제 적재 건수와 표본 선정 방식은 **M3 설계 시점에 다시 확정**한다 — 이번 STEP에서 미리 정하지 않는다.
- M3는 처음부터 대량 적재하지 않는다.

### 5. Master 구축 테스트와 사용자 테스트의 구분 — 개념 기록

Apartment Master **데이터 구축** 테스트와 실제 **사용자 Alpha/Beta 테스트**는 별개 트랙임을 문서에 명시한다.

```
Master M3        : 부산 서구 + 부산 해운대구 소량 데이터 "구조" 검증(엔지니어링 관점)

향후 사용자 테스트 : 서구 Alpha → 해운대 Challenge → 부산 Beta → 전국 표본 Beta → 전국
                    (사용자에게 실제 노출되는 서비스 관점, 별도 전략)
```

이번 STEP에서는 사용자 테스트 관련 기능을 구현하지 않는다(§9 금지 항목) — 위 구분은 향후 로드맵 참고용 개념 기록일 뿐이다.

MASTER M3로 진행한다(단, 이번 커밋에서는 M3를 시작하지 않는다).
