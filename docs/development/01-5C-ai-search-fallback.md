# STEP 1.5-C — AI 검색 실패 안전장치

작성일: 2026-08-12

## 기존 검색 흐름

```
사용자 검색어
  → (DB 캐시 확인: AiSearchCache, 30분 TTL)
  → classifyQuery(query)  — Gemini에게 의도(intent)/조건(가격·주차·신축 등) 분류를 요청
  → 지역코드(lawdCd) 결정 — 분류 결과의 sido/sigungu → 코드 레벨 지역명 감지 → 클라이언트 폴백 지역
  → intent별 분기: runConditionSearch / runRegionalStats / runCompare (전부 실제 MOLIT/DB/공공데이터 조회, Gemini 미사용)
  → generateBriefing(intent, 조회된 실제 데이터 요약) — Gemini에게 자연어 요약 문장 생성 요청
  → DB 캐시 저장
  → 응답
```

`src/app/api/ai-search/route.ts`가 오케스트레이션을 담당하고, 실제 로직은 `src/lib/ai-search.ts`에 있다. Gemini는 이 흐름에서 정확히 두 지점(`classifyQuery`, `generateBriefing`)에서만 호출되며, 나머지(지역 코드 해석, MOLIT 조회, 건축물대장 조회, DB 캐시)는 전부 결정적 코드다.

## 단일 실패지점

`src/app/api/ai-search/route.ts`(수정 전):

```ts
const classification = await classifyQuery(query);
if (!classification) {
  return NextResponse.json({
    success: false,
    error: 'AI 검색을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
  });
}
```

`classifyQuery()`가 `null`을 반환하면(즉 Gemini 호출이 어떤 이유로든 실패하면) 검색이 여기서 즉시 끝난다. HTTP 상태 코드 자체는 200(서버가 죽는 500 크래시는 아님)이지만, `success: false`와 함께 사용자에게 "AI 검색을 사용할 수 없습니다"라는 문구만 노출되고, 이후 단계(지역 인식, 실거래 조회, 브리핑 생성)는 전혀 실행되지 않는다 — 실제로는 국토부 실거래 데이터로 충분히 답할 수 있는 질문이었어도 마찬가지다.

## 원인

`src/lib/gemini.ts`의 `callGeminiJSON()`을 확인한 결과, 이미 다음 실패 케이스를 전부 `null`로 통일해서 반환하도록 구현되어 있었다(추가로 손볼 필요 없음):

| 실패 케이스 | 처리 |
|---|---|
| `GEMINI_API_KEY` 미설정 | `!apiKey`면 fetch 자체를 시도하지 않고 즉시 `null` |
| 네트워크 오류/타임아웃 | `AbortSignal.timeout(15000)` + try/catch → `null` |
| HTTP 오류 응답(429 rate limit 포함) | `!res.ok`면 `null` |
| 응답에 candidates/text가 없음 | `null` |
| JSON 파싱 실패(`JSON.parse(text)`가 throw) | try/catch로 감싸져 있어 `null` |
| retry | 없음(1회 시도) — 이번 STEP에서도 retry를 추가하지 않았다(요청 범위 밖) |

즉 **`classifyQuery` 자체는 이미 안전하게 실패를 흡수하고 있었고, 문제는 그 실패를 받아들이는 상위 호출자(`route.ts`)가 아무 대안 없이 검색을 끝내버린 것**이었다.

## 기존 fallback

새 로직을 만들기 전에 프로젝트 안에서 재사용 가능한 것을 조사했다.

| 로직 | 위치 | 재사용 가능 여부 |
|---|---|---|
| `detectLeadingRegionKeyword(query)` | `src/lib/ai-search.ts` | **가능** — 질문이 시/군/구 이름(또는 그 축약형, 예: "해운대")으로 시작하면 `{sido, sigungu, remainder}`를 결정적으로 반환. 원래는 "LLM이 지역을 놓쳤을 때"의 보정용으로만 쓰이던 코드. |
| `detectSortIntent(query)` | `src/lib/ai-search.ts` | 가능하지만 이번 fallback에서는 굳이 필요하지 않음(정렬은 결과가 있어야 의미가 있고, route.ts가 이미 `classification` 성공/실패와 무관하게 별도로 호출함) |
| 가격(억 단위) 추출 정규식 | 없음 | 전체 코드베이스에 억 단위 금액을 정규식으로 뽑아내는 로직이 존재하지 않음(확인 완료: `home-client.tsx`의 "5억 이하"는 정적 예시 문구일 뿐 파서가 아님) |
| 평형/면적 추출 정규식 | 없음 | 없음 |
| 신축/구축 판별 정규식 | 없음 | 없음 |
| 주차 조건 정규식 | 없음 | 없음 |
| `runConditionSearch()`가 조건이 전부 `null`일 때의 동작 | `src/lib/ai-search.ts` | **이미 지원됨** — 조건 필터를 전혀 적용하지 않고 세대수 내림차순으로 대표 단지 목록을 반환하도록 이미 구현되어 있음(정상 경로에서 "부산 서구 아파트"처럼 조건 없는 질문에도 쓰이는 바로 그 로직). |

**결론**: 지역명 인식과 "조건 없는 단지 목록 조회"만 안전하게 재사용 가능했다. 가격/평형/신축/주차 조건을 문장에서 뽑아내는 로직은 프로젝트에 전혀 없었고, 이번 STEP에서 새로 만들지 않았다(원칙 5: "이 모든 기능을 새로 구현하라는 의미가 아니다").

## 새 fallback 설계

```
classifyQuery(query) 실패
  → detectLeadingRegionKeyword(query)로 지역명 인식 시도
    성공 → intent를 'condition_search'로 간주하고, 조건은 전부 null/false로 둔
            "임시 분류 결과"를 만들어 이후 흐름(지역코드 해석 → runConditionSearch → generateBriefing)을
            Gemini 성공 시와 동일한 코드 경로로 그대로 흘려보낸다.
    실패 → 검색을 진행할 안전한 근거가 없으므로, 기술적 오류 문구 대신
            "지역과 가격 조건을 조금 더 구체적으로 입력해주세요" 안내로 종료한다(HTTP 200, success:false).
```

핵심 설계 결정:
- **새로운 분기/중복 로직을 만들지 않았다.** `classification` 변수에 "임시 분류 결과" 객체를 대입하기만 하면, 그 아래의 지역코드 해석·조건검색·브리핑 생성 코드는 Gemini가 정상 분류했을 때와 완전히 동일한 코드를 그대로 탄다.
- 가격/신축/주차/초등학교 등은 전부 `null`/`false`로 남겨둔다 — 알 수 없는 조건을 추측해서 채우지 않는다(원칙 C).
- 단지명(`complexName`)도 `null`로 둔다 — `detectLeadingRegionKeyword`가 반환하는 `remainder`(지역명을 뗀 나머지 문자열)를 단지명으로 쓰지 않았다. 예를 들어 "서구 5억 이하 신축 아파트"의 remainder는 "5억 이하 신축 아파트"인데, 이걸 단지명으로 취급하면 존재하지 않는 단지를 찾다가 "결과 없음"으로 끝나는 등 더 나쁜 사용자 경험이 되기 때문이다(원칙 C: 알 수 없는 정보를 추측하지 않는다).
- intent는 항상 `'condition_search'`로 고정했다. `regional_stats`나 `compare`로 잘못 추측할 근거가 없고, `condition_search`는 조건이 전부 비어 있어도 "그 지역의 대표 단지 목록"이라는 안전하고 유용한 결과를 만들어낸다(원칙 A: 기존 로직으로 안전하게 처리 가능한 경우 그대로 사용).

## 변경 내용

`src/app/api/ai-search/route.ts` 한 곳만 수정했다.

```ts
// 변경 전
const classification = await classifyQuery(query);
if (!classification) {
  return NextResponse.json({ success: false, error: 'AI 검색을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.' });
}

// 변경 후 (요지)
let classification = await classifyQuery(query);
if (!classification) {
  const detected = detectLeadingRegionKeyword(query);
  if (detected) {
    console.warn('[ai-search] Gemini 의도분류 실패 — 지역명 기반 fallback으로 대체', { regionDetected: true });
    classification = {
      intent: 'condition_search',
      sido: detected.sido,
      sigungu: detected.sigungu,
      maxPriceEok: null,
      minParkingPerHousehold: null,
      minTotalHouseholds: null,
      newBuildOnly: false,
      nearElementarySchool: false,
      complexName: null,
      compareTargetA: null,
      compareTargetB: null,
    };
  } else {
    console.warn('[ai-search] Gemini 의도분류 실패 — 지역명도 인식하지 못해 fallback 불가');
    return NextResponse.json({
      success: false,
      error: '찾으시는 지역이나 조건을 조금 더 구체적으로 입력해주세요. 예: "부산 서구 5억 이하 아파트"',
    });
  }
}
```

`const` → `let`로 바꾼 것 외에는 `classifyQuery` 실패 분기 안에서만 코드를 추가했다. 그 아래(지역코드 해석부터 캐시 저장까지)는 한 줄도 수정하지 않았다.

## Gemini 정상 경로

`classifyQuery`가 성공하면 이번 변경이 전혀 개입하지 않는다 — `if (!classification)` 블록 자체가 실행되지 않으므로 기존 prompt, 스키마, 결과 형식, 캐시 동작이 정확히 그대로다. 실제로 로컬에서 Gemini가 정상 응답하는 상태로 "부산 서구 5억 이하 아파트", "부산 서구 4억 이하 아파트", "부산 서구 아파트" 세 질문을 테스트해 변경 전과 동일한 형태의 응답(실제 단지 목록 + Gemini가 생성한 자연스러운 브리핑 문장)을 확인했다(아래 "테스트 결과" 참고).

## Gemini 실패 경로

`GEMINI_API_KEY`를 비운 상태로 재현했다.

- 지역명으로 시작하는 질문("서구 아파트 ...")은 `detectLeadingRegionKeyword`가 "부산광역시/서구"를 인식 → fallback 분류로 `runConditionSearch`가 실제 MOLIT 실거래 데이터를 조회 → **실제 단지 10건 목록과 함께 `success:true` 응답**을 확인했다. 브리핑 문장도 `generateBriefing`이 자체 Gemini 호출에 실패하면서(같은 이유로 키가 없으므로) 자동으로 결정적 fallback 문장(단지명+세대수+실거래가 나열)으로 대체되어 응답에 포함됐다 — 이 부분은 STEP 1 진단에서 이미 "정상"으로 확인된 기존 기능이라 이번에 손대지 않았다.
- 지역명도 인식할 수 없는 질문("asdkjaskjd 이상한거 ...")은 `success:false`와 함께 "지역과 가격 조건을 조금 더 구체적으로 입력해주세요..." 안내 문구를 반환했다. **HTTP 상태 코드는 200**이었다 — 500으로 죽지 않았다(변경 전에도 이 특정 지점은 200이었지만, 이번 변경으로 지역명이 있는 경우까지 실제 검색이 가능해진 것이 핵심 개선이다).

## 사용자 경험

과제에서 요구한 우선순위 그대로 구현됐다:

1. 기존 규칙(지역명 인식)으로 검색 가능 → 실제 단지 목록으로 정상 검색 진행
2. 일부 조건만 이해 가능한 경우 → 이번 STEP의 fallback 범위에서는 "지역"만 안전하게 추출 가능했고, 가격/신축/주차 등은 추출 로직이 없어 임의로 채우지 않음(전부 비워둠) — 즉 "일부 조건만 사용하고 나머지는 추가하지 않는다"는 원칙을 지역 vs 나머지 조건의 이분법으로 구현
3. 안전하게 해석 불가능 → 기존 UI의 `errorBox`(`src/app/ai-search/ai-search-client.tsx`)에 그대로 표시되는 `error` 문자열을 "지역과 가격 조건을 조금 더 구체적으로 입력해주세요. 예: ..."로 바꿔, Gemini/AI라는 기술적 표현 없이 사용자가 다음에 뭘 하면 되는지 안내한다. UI 컴포넌트 자체는 수정하지 않았다(서버가 내려주는 `error` 문자열만 바뀜, 렌더링 방식은 기존 그대로).

## 테스트 결과

- **TypeScript**: `npx tsc --noEmit` — 오류 없음.
- **lint**: `npx eslint`(`src/app/api/ai-search/route.ts`, `src/lib/ai-search.ts`) — 오류/경고 없음.
- **build**: `npx next build` — 성공. `/api/ai-search`, `/ai-search` 라우트 정상 포함.
- **런타임 시나리오 (로컬 개발 서버, 실제 MOLIT 데이터 사용)**:

| 시나리오 | 검색어 | Gemini 상태 | 결과 |
|---|---|---|---|
| A. Gemini 정상 | "부산 서구 5억 이하 아파트" | 정상(실제 키) | `success:true`, 실제 단지 목록 + Gemini 브리핑. 변경 전과 동일 |
| C. 간단한 검색 | "부산 서구 5억 이하 아파트" (재요청) | 정상 | `cached:true`로 30분 캐시 재사용 확인 |
| D. 가격 조건 | "부산 서구 4억 이하 아파트" | 정상 | 가격 필터 정상 적용된 결과 확인 |
| E. 지역 조건 | "부산 서구 아파트" | 정상 | Gemini가 `regional_stats`로 분류 → 지역 통계 브리핑 정상 반환(이번 변경과 무관한 기존 동작) |
| B. Gemini 실패 + 지역명 인식 가능 | "서구 아파트 ..." | `GEMINI_API_KEY` 비움 | fallback 분류 적용, 실제 MOLIT 단지 10건 반환, `success:true` |
| F. 이해 불가 + 지역명 없음 | "asdkjaskjd 이상한거 ..." | `GEMINI_API_KEY` 비움 | `success:false`, 안내 문구, **HTTP 200**(500 아님) |
| G. Gemini JSON 파싱 실패 | — | — | 별도로 재현하지 않음(아래 "남은 한계" 참고) |

Gemini 실패 재현은 `.env`/`.env.local` 파일을 수정하지 않고, 로컬 개발 서버 프로세스를 `GEMINI_API_KEY=`(빈 값)로 재시작하는 방식으로 진행했다(프로세스 환경변수만 일시적으로 덮어씀). 테스트 종료 후 서버를 다시 일반 상태(`.env`의 실제 값)로 재시작해 원상복구했다.

## 남은 한계

- **시나리오 G(Gemini가 200을 반환하지만 스키마와 다른/깨진 JSON을 줄 경우)는 별도로 재현하지 않았다.** `callGeminiJSON`의 `JSON.parse(text)`가 이미 try/catch 안에 있어 코드 리뷰로는 "실패하면 catch되어 null 반환"임을 확인했지만, Gemini가 실제로 이런 응답을 주게 만드는 것은 이번 STEP에서 다루지 않는 범위(Gemini 응답을 조작하는 테스트 하네스가 없음)라 실제 호출로는 검증하지 못했다.
- **가격/평형/신축/주차 등 조건은 Gemini가 실패하면 여전히 전부 무시된다.** 이는 의도된 설계(원칙 C: 추측 금지, 기존 파서 없음)이지, 미해결 버그가 아니다. 향후 이 조건들까지 fallback에서 살리려면 각 조건별 정규식 파서를 새로 만드는 별도 작업이 필요하다(이번 STEP 범위 밖).
- **compare 의도(두 단지 비교)는 Gemini가 실패하면 fallback 대상이 아니다.** 비교 대상 단지명 2개를 안전하게 추출할 방법이 없어(원칙 C), 이런 질문은 지역명이 앞에 있어도 "지역과 가격 조건을 조금 더 구체적으로 입력해주세요" 안내로 끝난다 — compare 질문에는 다소 어색한 안내 문구이지만, 잘못된 비교 대상을 지어내는 것보다는 안전하다고 판단했다.
- **fallback 사용 여부는 `console.warn`으로만 로깅되고 DB(ErrorLog)에는 남지 않는다.** STEP 1.5-B에서 "정상이 아닌 상태를 오류 로그와 혼동하지 않는다"는 원칙을 막 정리한 직후라, "AI 실패 → 규칙 기반으로 대체 성공"은 실제 오류가 아니므로 관리자 대시보드의 "🚨 시스템 에러 로그"(ErrorLog 기반)에 굳이 섞지 않기로 판단했다. 필요하면 향후 별도의 경량 카운터(예: 관리자 대시보드에 "AI 분류 성공률" 같은 지표)로 다룰 수 있다 — 이번 STEP에서 새 로그 시스템은 만들지 않았다.
- (STEP 1.5-C와 무관하게, 테스트 중 우연히 관찰됨) `src/lib/apt-building-info.ts:81`의 `itemsArr.reduce((best, cur) => ...)`가 `itemsArr`이 빈 배열일 때 `TypeError: Reduce of empty array with no initial value`를 던지는 것을 로그에서 확인했다. 이미 상위 try/catch(같은 파일의 `fetchBuildingRegistryInfo` 함수 전체를 감싸는 catch)가 잡아서 `null`을 반환하므로 실제 응답은 정상적으로 내려갔지만(해당 단지의 `parkingInfo`/`totalHouseholds`가 "정보 없음"으로 처리됨), 콘솔에 매번 스택 트레이스가 찍히는 사소한 기존 버그로 보인다. 이번 STEP의 범위(AI 검색 fallback)와 무관하고 대규모 리팩터링 금지 원칙에도 해당해 수정하지 않았다 — 발견 사실만 기록한다.

## 최종 검수 결과 (2026-08-12)

사용자 검수에서 구현 방향 전체가 승인됐다. 다음 세 가지만 최종 반영/확정했다.

1. **사용자 안내 문구 수정**: "지역과 가격 조건을 조금 더 구체적으로 입력해주세요." → **"찾으시는 지역이나 조건을 조금 더 구체적으로 입력해주세요."** (`src/app/api/ai-search/route.ts`). Gemini 실패는 가격 검색뿐 아니라 비교(compare) 질문이나 기타 질문에서도 발생할 수 있으므로, 특정 검색 유형("가격")에 종속되지 않는 문구로 교체했다. 로직·조건·HTTP 상태 코드는 변경하지 않았다.
2. **fallback 로그 수준 유지**: `console.warn` 수준으로 유지하고, 이번 STEP에서는 `ErrorLog` DB에 저장하지 않기로 확정했다. 향후 사용자 검색 분석/AI fallback 통계를 별도로 설계할 때 구조화하기로 함(이번 STEP에서 새 로그 체계를 만들지 않는다는 원래 원칙과 일치).
3. **`apt-building-info.ts`의 빈 배열 `reduce()` 문제는 이번 STEP 범위 밖으로 확정**: 수정하지 않고, 기존 버그/기술부채로만 기록을 유지한다(위 "남은 한계" 항목 그대로 보존).

## 향후 자체 검색엔진과의 관계

이번 STEP은 "Gemini 없이도 이집만의 검색엔진을 만든다"는 방향이 아니다. 오히려 정반대로, **Gemini가 실패했을 때 이미 존재하는 최소한의 결정적 코드(지역명 인식, 조건 없는 기본 목록 조회)로 사용자를 빈손으로 돌려보내지 않는 안전망**만 추가했다. STEP 1 로드맵의 "STEP 13 — Gemini 의존성 최적화 및 선택적 AI 구조 검토"에서 만약 가격/신축/주차 등 조건까지 규칙 기반으로 대체하는 것을 검토하게 된다면, 이번에 재사용한 `detectLeadingRegionKeyword`/`runConditionSearch`의 "조건 null 허용" 설계가 그 확장의 출발점이 될 수 있다. 다만 그 결정은 이번 STEP의 범위가 아니며, 이번 fallback은 어디까지나 "장애 시 최소 동작 보장"이 목적이다.
