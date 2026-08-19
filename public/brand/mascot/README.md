# 이집이(ejipy) Mascot 자산 규격

이 디렉터리는 캐릭터 `이집이` 이미지 자산이 배치되는 위치다.
BRAND STEP 56-B2는 구조/규격만 정의했고, STEP 56-B3에서 사용자
원본을 검수(24종 중 mascot 7종 전부 APPROVED)한 뒤, STEP 57-A에서
실제 7개 포즈 파일(WebP, `brand-source/mascot/`의 원본을 800px
장변으로 리사이즈 후 재인코딩)을 이 디렉터리에 배치하고 Header/
FullPageLoader/Home/AI 검색 empty state에 연결했다.

## 필요 포즈 (파일명 규칙)

`docs/development/56-brand-system-application-plan.md`의 "STEP 56-B
자산 제작 항목"과 동일한 우선순위를 따른다.

| 파일명 | 포즈 | 용도 | 우선순위 |
|---|---|---|---|
| `ejipy-default.webp` | 기본/중립 | empty state 기본 | 중 |
| `ejipy-search.webp` | 돋보기 들고 찾는 중 | AI 조건검색 대기(6-3) | **최우선** |
| `ejipy-analyze.webp` | 노트/차트 정리 중 | section loading 보조(6-2) | 중 |
| `ejipy-loading.webp` | 걷는/일하는 동작 | `FullPageLoader` global loading | 높음 |
| `ejipy-empty.webp` | 두리번거리는 기본 포즈 | 검색결과없음/최근본단지없음 | 높음 |
| `ejipy-guide.webp` | 안내하는 포즈(손짓 등) | onboarding, 준비 중 안내 | 낮음 |
| `ejipy-error.webp` | (사용 자제 — 아래 참고) | — | 보류 |

`ejipy-error`는 우선순위를 매기지 않는다 — 56-A 문서의 "6-5. Error /
Retry" 전략상 에러 상태는 신뢰감을 캐릭터보다 우선하기로 설계돼 있어
(과도한 귀여움 금지), 에러 화면에 캐릭터를 쓸지 자체를 STEP 57에서
다시 판단한다.

## 파일 포맷

- **주 포맷: WebP**(투명 배경) — 압축률이 좋음. 이 프로젝트는
  `next/image`를 쓰지 않고 `<img>` 태그를 그대로 쓰는 기존 패턴이라,
  최적화(리사이즈+재인코딩)는 빌드 타임이 아니라 STEP 57-A에서
  Pillow로 미리 만들어 커밋해두는 방식으로 처리했다.
- PNG fallback은 두지 않는다(WebP는 모든 대상 브라우저에서 지원됨).
- 배경은 투명이어야 한다(카드/오버레이 등 다양한 배경 위에 얹히므로).
- 실제 배치된 7개 파일은 `brand-source/mascot/`의 1254px 원본을
  장변 800px로 리사이즈 후 WebP(quality 88)로 재인코딩한 것 —
  각 46~81KB, 200KB 권장 상한 이내.

## 적용 현황 (STEP 57-A)

- `ejipy-default` → Home hero(작은 인사 캐릭터)
- `ejipy-loading` → `FullPageLoader` 공통 컴포넌트(전역 로딩 —
  apt 상세페이지 로딩에도 간접 반영됨)
- `ejipy-empty` → Home "최근 본 단지" empty, AI 검색 결과 없음
- `ejipy-search`, `ejipy-analyze`, `ejipy-guide`, `ejipy-error` →
  자산은 이 디렉터리에 있으나 아직 소비하는 화면 없음(다음 STEP에서
  연결 예정)
- 캐릭터가 없어도 기존 텍스트(로딩 메시지/empty 문구)는 그대로
  남아 있어, 이미지 로드 실패 시에도 정보 전달은 깨지지 않는다.
