# DESIGN SYSTEM 2 — Foundation Tokens + Typography + Semantic Color + Core Components

상태: **구현 완료 — commit/push 안 함(ChatGPT 검수 대기)**

시작 HEAD: `f167b32`(DESIGN SYSTEM 1 + AREA MODEL V1 + CHANGELOG 문서
커밋 직후, origin/main과 일치 확인, working tree clean 확인 후 시작).

DB/schema/migration 변경 **0건**. 비즈니스/데이터 로직 변경 **0건**
(`prisma/schema.prisma` 미변경, API route 미변경 — `git diff --stat` §7에서
재확인).

---

## 1. 결정 사항(이미 승인된 그대로 반영)

| # | 결정 | 반영 위치 |
|---|---|---|
| 1 | 브랜드 Main Green = `#13A367` | `globals.css` `--primary-color: var(--ejip-green)` |
| 2 | `#03c75a`는 legacy/deprecated, 삭제하지 않음 | `--legacy-naver-green: #03c75a` 보존 |
| 3 | 모바일 root font-size 14px override 제거 | `globals.css` 해당 규칙 삭제 |
| 4 | 기본 root font-size = 16px | `body`에 별도 override 없음(브라우저 기본 16px 유지) |
| 5 | 일반 본문 14px 미만 남발 금지 | `--font-size-body: 0.9375rem`(15px) 기본값으로 채택 |
| 6 | 최소 UI text = 12px | `--font-size-caption: 0.75rem`이 하한, 그 밑 토큰 없음 |
| 7 | Lucide 우선, emoji 제거 방향(전수 아님) | 이번 STEP에서 새로 만든 컴포넌트(Chip/Badge/SectionHeader/AreaChip)에 emoji 미사용 |
| 8 | 전용면적 기반 | AreaChip contract 그대로 |
| 9 | 검증 안 된 공급평형 추정 금지 | `shouldShowPyeongLabel()`이 구조적으로 강제 |
| 10 | AreaChip 대표 라벨 = "전용 84㎡" 스타일 | 유지 |
| 11 | ㎡→평은 "약 N평" 보조 표시만 | 기존 `formatPyeong`/`getUniquePyeongLabels` 그대로 유지(변경 없음) |
| 12 | raw exclusive area precision 보존 | `area-utils.ts` 미변경 |
| 13 | 근접 전용면적 임의 병합 금지 | `AreaSelector`가 여전히 raw 값 단위로 칩 생성 |

---

## 2. 실제로 구현한 것 vs 문서만 남긴 것(정직한 구분)

44개 섹션 스펙 중 **토큰 foundation + AreaChip 관련 4개 핵심 컴포넌트 +
회귀 수정 + 검증**을 실제 코드로 구현했다. Search/Button/Card/Filter
foundation은 이번 STEP에서 **컴포넌트를 새로 만들지 않았다** — 아래
§10(DS-3 contract)에 다음 STEP 대상으로 명시적으로 남긴다(미구현을
오류로 위장하지 않는다는 프로젝트 원칙에 따라 여기서 분명히 밝힌다).

### 구현함(코드)
- `globals.css` 토큰 foundation 전체 재작성(색/타이포/spacing/radius/shadow/control-height)
- `TradeTimelineList.tsx` 375px 회귀 실측 수정
- `src/components/ui/Chip.tsx` + `.module.css`
- `src/components/ui/Badge.tsx` + `.module.css`
- `src/components/ui/SectionHeader.tsx` + `.module.css`
- `src/components/ui/AreaChip.tsx` + `.module.css`
- `src/lib/area-chip-rules.ts`(순수 로직 분리, 단위 테스트용)
- `AreaSelector.tsx`를 위 Chip/AreaChip로 교체(동작 100% 동일, 시각적 변경 없음)
- `scripts/apartment-score/verify-design-system-2.ts`(22개 assert)

### 문서/방향만 남김(코드 미구현, §10에서 다음 STEP 대상으로 명시)
- Search System(HeaderSearchTrigger/HeroSearch 변형) — 기존 `ApartmentSearchTrigger` 유지, 신규 분리 안 함
- Button 변형(Primary/Secondary/Tertiary/Destructive/Icon) — 기존 인라인 버튼 스타일 유지
- Card foundation(BasicCard/ListRow/StatusCard) — 미구현
- Filter foundation(FilterBar/FilterChip/SelectFilter) — 미구현
- BottomNav/Header — 토큰 참조는 이미 되어 있으나(기존 구현), 이번 STEP에서 별도 foundation 컴포넌트로 추출하지 않음
- Loading/Empty/Error 3-tier 공통 컴포넌트 — 미구현(기존 페이지별 개별 처리 유지)

---

## 3. Typography scale

| 토큰 | 값 | 용도 |
|---|---|---|
| `--font-size-display` | 1.75rem(28px) | Hero 숫자 |
| `--font-size-page-title` | 1.25rem(20px) | 페이지 타이틀 |
| `--font-size-section-title` | 1.125rem(18px) | 섹션 타이틀 |
| `--font-size-card-title` | 1rem(16px) | 카드 타이틀 |
| `--font-size-body` | 0.9375rem(15px) | 본문 기본 |
| `--font-size-body-sm` | 0.875rem(14px) | 보조 본문 |
| `--font-size-caption` | 0.75rem(12px) | caption/metadata 하한 |

`--line-height-tight/normal/relaxed`(1.3/1.5/1.7), `--font-weight-regular
~extrabold`(400~800) 함께 정의. 기존 페이지에 소급 적용하지 않음(§36
"강제 마이그레이션 없음" 원칙) — 신규/수정 컴포넌트부터 적용.

## 4. Semantic color

`--primary-color`(브랜드)와 `--up-color`/`--down-color`(가격 등락, 빨강
=상승/파랑=하락 관행 유지)를 분리하고, 별도로 `--warning-color`/
`--info-color`/`--error-color`를 신설해 "브랜드 그린=긍정 전부"라는
재사용을 끊었다. `--text-muted`는 `#8f8f8f`(대비 ~3.5:1, WCAG AA 미달)
→ `#6b7280`(~4.8:1)로 교체.

## 5. Spacing / Radius / Shadow / Control height

기존 코드가 관행적으로 쓰던 값을 그대로 토큰화(값 변경 없음, 이름만
부여) — `--space-1`~`--space-12`(4px 배수), `--radius-sm`~`--radius-2xl`
+`--radius-pill`, `--shadow-sm/md/lg/card`, `--control-height-sm/md/lg`
(36/44/52px, md=44px가 터치 타깃 기준).

## 6. 신규 foundation 컴포넌트

### Chip (`src/components/ui/Chip.tsx`)
클릭으로 선택 상태를 바꾸는 인터랙티브 컨트롤. `active`/`disabled`/
`dashed` variant. `min-height: var(--control-height-md)`(44px)로 터치
타깃 보장, `:focus-visible` outline 포함.

### Badge (`src/components/ui/Badge.tsx`)
상태/정보 표시 전용(non-interactive). `beta`/`status`/`positive`/
`negative`/`warning`/`neutral`/`regionalStrength` 7개 variant.
`positive`/`negative`는 `--up-color`/`--down-color`를 재사용(가격
상승/하락 의미) — `--error-color`나 브랜드 그린을 여기 쓰지 않는다.

### SectionHeader (`src/components/ui/SectionHeader.tsx`)
`title`(필수) / `description`(optional) / `action`(optional, label +
onClick 또는 href). Statistics V2가 바로 재사용 가능한 최소 계약.

### AreaChip (`src/components/ui/AreaChip.tsx`)
AREA MODEL V1 §19 contract 그대로:
```ts
interface AreaChipData {
  id: string;
  exclusiveAreaM2: number;
  displayLabel: string;
  supplyAreaM2: number | null;
  pyeongLabel: string | null;
  tradeCount: number;
}
```
`shouldShowPyeongLabel()`(`src/lib/area-chip-rules.ts`)이 "supplyAreaM2가
null이면 pyeongLabel이 있어도 표시하지 않는다"를 구조적으로 강제 —
개발 모드에서는 계약 위반 시(`supplyAreaM2 === null && pyeongLabel` 존재)
`console.warn`도 띄운다.

## 7. AreaSelector 교체(동작 변경 없음)

`AreaSelector.tsx`의 인라인 버튼 마크업을 `Chip`/`AreaChip`으로
교체했다. 오늘은 공급면적 데이터가 없으므로(`AREA MODEL V1` §8, coverage
0%) `supplyAreaM2`/`pyeongLabel`은 항상 `null`로 넘긴다 — 표시 라벨,
active 스타일(solid `--primary-color`), 전체 가로 스크롤(칩 상한 없음,
`MAX_CHIPS` 재도입 안 함), "▼ 전체 평형" 모달까지 브라우저에서 실측
검증해 동작이 기존과 100% 동일함을 확인했다(§8).

## 8. 375px 회귀 수정(TradeTimelineList)

root font-size 16px 복구 후 375px 폭에서 거래 테이블 가격 셀(굵은 가격 +
▲/▼ 증감 배지)이 말줄임(`...`)되는 걸 실측으로 발견했다. **14px로 되돌려
우회하지 않고** 원인을 직접 수정했다:
- 각 셀의 실제 렌더링 폭(`scrollWidth`)을 브라우저에서 직접 측정
- `colgroup` 비율을 22/14/36/28% → 17/14/44/25%로 재배분
- 계약월 표시를 4자리 연도(`2026.08`) → 2자리(`26.08`)로 축소해 폭 확보
- 셀 padding 0.3rem → 0.2rem, 증감 배지 여백 0.25rem → 0.15rem으로 미세 조정

**검증**: 375/390/430px 및 데스크톱(1707px)에서 로드된 전체 60개 행
(최고 33억까지) 전부 `scrollWidth <= clientWidth`(overflow 없음) 확인.
320px(스펙 최소 요구치 미만)에서는 여전히 overflow 발생 — 스펙 범위
밖이라 이번 STEP에서 추가 대응하지 않음(§11 unresolved에 기록).

## 9. 접근성

- Chip: `min-height: var(--control-height-md)`(44px), `:focus-visible`
- SectionHeader action: `:focus-visible`
- AreaChip: `aria-pressed`(Chip에서 상속)

## 10. DS-3 contract(다음 STEP 대상)

1. Search System(HeaderSearchTrigger/HeroSearch) 분리 구현
2. Button variant 컴포넌트화(현재 페이지마다 인라인 스타일 반복)
3. Card foundation(BasicCard/ListRow/StatusCard)
4. Filter foundation(FilterBar/FilterChip/SelectFilter) — Statistics V2 선행 조건
5. BottomNav/Header를 실제 foundation 컴포넌트로 추출(현재는 토큰만 참조, 구조는 기존 그대로)
6. Loading/Empty/Error 3-tier 공통 컴포넌트
7. 기존 페이지(Home/Statistics/Map 등)를 새 typography/spacing 토큰으로 점진 마이그레이션

## 11. Statistics V2 contract

`SectionHeader`가 바로 재사용 가능(§6). Filter foundation은 §10-4로
이연 — Statistics V2 착수 전 선행 필요.

## 12. Unresolved

1. AREA MODEL V1 §24에서 발견된 "약" 접두어 불일치(Hero "약 25.7평" vs 칩
   "25.7평") — 이번 STEP도 코드 변경 안 함(범위 밖, 별도 소규모 STEP 후보).
2. 320px 미만 극단적으로 좁은 화면에서 TradeTimelineList 가격 셀이 여전히
   overflow(§8) — DS-2 스펙 최소 요구치(375px)는 만족하나 320px 기준
   기기(iPhone SE 1세대급)는 대응 안 됨.
3. §2에 나열한 "문서만 남긴" 6개 foundation 영역(Search/Button/Card/
   Filter/Nav-Header/Loading-Empty-Error) — DS-3에서 구현.

## 13. 검증 결과

- `npx tsc --noEmit`: 0 errors
- `npx eslint src`: 0 errors(무관한 기존 warning 3건만, 이번 STEP 파일 아님)
- `npx next build`: 성공(30 static + 다수 dynamic 라우트 정상 생성)
- `scripts/apartment-score/verify-design-system-2.ts`: 22/22 PASS(신규)
- `scripts/apartment-score/verify-apt-detail-ia.ts`: 13/13 PASS(기존, 회귀 없음 재확인)
- 브라우저 실측: Home/Statistics/Map/Redevelopment/Presales/Apt-Detail을
  375/390/430px + 데스크톱(1707px)에서 확인, TradeTimelineList 외 추가
  regression 없음
