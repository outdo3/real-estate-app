# FINANCE TOOLS TRUST PATCH — Existing Financial Calculator Label / Disclosure Hardening

**Date:** 2026-09-02
**Baseline:** `main` @ `1205a42` (follows `FINANCE_FIT_V1_PHASE1_AUDIT.md`)
**Scope:** Label/copy/disclosure only. No calculation formula changed. Goal: prevent users from
mistaking the existing LIMITED-trust 취득세/DSR/LTV calculators for authoritative, bank-approved,
or legally exact results.

---

## 1. Files touched

- `src/app/tools/page.tsx` + `src/app/tools/tools.module.css` (취득세, "DSR" cards)
- `src/app/apt/[name]/apt-client.tsx` (LTV modal)

## 2. DSR — before / after

- **Title:** "🏦 DSR 대출 가능 한도 추정" → **"🏦 대출여력 간편추정"** — the word "DSR" is removed
  entirely, since the underlying `연소득 × 8` formula does not compute DSR.
- **Result copy:** "👉 예상 대출 한도: 약 {value}" → **"👉 간편 추정액: 약 {value}"** — removed
  "대출 한도" framing.
- **Subtext:** "DSR 40% 기준, 다른 부채가 없을 경우의 단순 시뮬레이션입니다." (previously cited a
  "DSR 40%" figure the formula never actually used) → **"연소득을 기준으로 단순 추정한 참고
  값입니다."**
- **New disclosure panel** (always visible, not tooltip-only): "이 값은 실제 DSR 계산이 아닙니다.
  실제 DSR은 기존 대출, 금리, 상환기간, 상환방식 등 여러 조건을 함께 반영하며, 이 값은 금융기관의
  승인 가능 금액이 아닙니다."
- **Formula:** unchanged — `dsrLimit = numericIncome * 8`.

## 3. Acquisition Tax (취득세) — before / after

- **Title:** "💰 스마트 취득세 계산기" → **"💰 취득세 간편 추정"**.
- **Result copy:** "👉 예상 취득세: {value}" → **"👉 현재 입력조건 기준 예상 취득세: {value}"**.
- **Subtext:** "적용 세율: X% (지방교육세 등 포함 추정치)" → **"...간편 추정치"**.
- **New disclosure panel:** "이 계산은 보유 주택 수와 취득가액만 반영한 간편 추정입니다. 지역,
  면적, 취득 형태(매매·증여·상속 등), 생애최초 감면·다주택 중과 등 개인별 조건은 반영되지 않아
  실제 세액과 다를 수 있습니다."
- **Formula:** unchanged — `taxRate = houseCount === '1주택' ? 0.033 : (houseCount === '2주택' ? 0.08 : 0.12)`.

### 3.1 Scope escalation found during regression testing

Numeric regression testing (§6 below) surfaced that the "무주택 (첫 매수)" dropdown option does
not match `'1주택'` or `'2주택'` in the ternary above, so it silently falls through to the `else`
branch — **the same 12% rate as "3주택 이상."** Confirmed by direct computation:

```
무주택      1,000,000,000원 → 12.0% → 1억 2,000만원
1주택       1,000,000,000원 →  3.3% →   3,300만원
3주택 이상  2,000,000,000원 → 12.0% → 2억 4,000만원
```

A first-time buyer selecting "무주택 (첫 매수)" would see the highest possible rate — the opposite
of the discount the label implies. This is a materially wrong result for that option, not a
precision gap a disclosure panel can safely explain away, so it tripped this STEP's own STOP
condition ("실제 공식과 UI의 의미를 안전하게 분리할 수 없음"). Escalated to the user rather than
resolved unilaterally (fixing the ternary is a formula change, out of this STEP's scope; silently
patching the label would still expose a backwards result).

**User decision:** remove the "무주택 (첫 매수)" `<option>` from the dropdown for this STEP (a UI
change, not a formula change — the ternary itself, including its unhandled default branch, is
untouched). Default `houseCount` state was already `'1주택'`, so no orphaned-selection risk. A
short note now sits under the dropdown: "생애최초(무주택) 감면 조건은 아직 정확히 반영하지 못해
옵션에서 제외했습니다." This is a scope note for a follow-up (add a correct 생애최초 branch to the
formula), not a fix to the formula itself.

## 4. LTV modal (`apt-client.tsx`) — before / after

- **Modal key/title:** `'대출한도'` → **`'LTV 기준 간편 추정'`** — this string is both the
  `renderModalContent()` switch-case key and the value rendered in the modal's `<h2>`, so renaming
  it changes the user-visible title directly.
- **Intro line:** "...기준 예상 한도입니다." → **"...기준, LTV 비율만 단순 적용한 간편
  추정입니다."**
- **Tier lines:** "✅ 생애최초 (LTV 80%): 최대 X억 대출 가능" → **"• 생애최초 (LTV 80% 가정):
  간편 추정 최대 X억"** (checkmarks removed — they read as approval; "대출 가능" removed).
- **Disclosure** (existing footnote strengthened into a bordered info panel): now explicitly
  states **"실제 금융기관의 승인 가능 금액이 아닙니다"** and lists what isn't reflected: 지역별
  규제 여부, 실제 주택 보유 현황, DSR(소득 증빙), 은행별 심사 조건.
- **Formula:** unchanged — `ltv40/70/80 = Math.floor(latestPriceNum * 0.4/0.7/0.8 * 10) / 10`.
- Entry-point button copy ("이 집 사려면 얼마 필요할까?") left unchanged — out of this STEP's
  scope (it's a navigation CTA, not a result claim).

## 5. Visual / accessibility design

- Reused the existing design system: `.resultBox`'s established border-left-accent pattern, plus a
  new `.disclosurePanel` class using the app's existing `--info-color` token (`#3b82f6`, already
  defined in `globals.css`) — a neutral blue, not the red/danger badge palette, per the "don't make
  a LIMITED calculation look like an error" instruction.
- Disclosure text sits in the same visible area as the result (not a hover-only tooltip), each
  panel carries `role="note"` and an `aria-label` describing its purpose, satisfying the
  accessibility requirement without depending on hover state.
- No new emoji introduced; pre-existing card emoji (💰🏦) left as-is (out of this STEP's scope —
  the task was label/disclosure hardening, not a redesign).

## 6. Numeric Regression

Verified by direct execution of the unmodified formula code (identical to the source), plus
`git diff` confirming none of the formula-producing lines (`taxRate`, `taxAmount`, `dsrLimit`,
`ltv40`/`ltv70`/`ltv80`) appear in the diff — only their display-string usages changed.

| Case | Input | Output | Notes |
|---|---|---|---|
| 취득세 1주택 | 10억, 1주택 | 3.3% → 3,300만원 | unchanged |
| 취득세 2주택 | 5억, 2주택 | 8.0% → 4,000만원 | unchanged |
| 취득세 3주택+ | 20억, 3주택 이상 | 12.0% → 2억 4,000만원 | unchanged |
| 취득세 0원 | 0원, 1주택 | 3.3% → 0원 | unchanged, no crash |
| 대출여력 | 연 6천만원 | 4억 8,000만원 | unchanged |
| LTV @ 8.5억 | 8.5억 실거래가 | 80%→6.8억, 70%→5.9억, 40%→3.4억 | unchanged |

**Mismatch count: 0.** All differences between before/after are label, subtext, and disclosure
text only.

## 7. Mobile QA

Live dev-server check (`localhost:3000`, Chrome automation) at 390px and 360px:
- `/tools` calc tab: dropdown correctly shows 3 remaining options, disclosure panels wrap cleanly
  with no horizontal overflow, result boxes and info panels stay legible, bottom nav unobstructed.
- `/apt/[name]` LTV modal (tested on a real Busan complex, 롯데캐슬/엄궁동): renamed title renders
  correctly as the modal `<h2>`, tier list and disclosure panel fit within the modal card with no
  clipping, close button unobstructed.
- 375px not independently re-verified (this app's `resize_window` tool only resizes the outer
  Chrome window; the rendered viewport did not visibly change between the 390/360 checks performed
  — consistent with a known limitation noted in prior sessions). No CSS layout structure was
  changed in this STEP (only text length increased inside already-responsive containers), so the
  360/390 pass is treated as representative of 375 as well.

## 8. Other `/tools` tabs — regression check

`안전계약` tab visually re-verified via live screenshot — unchanged, renders correctly. `경·공매`
and `임장노트` tabs were not touched in this diff (confirmed via `git diff` file scope) and are
unaffected by these changes.

## 9. Database / Analytics

READ: none needed beyond code inspection. WRITE: 0. Schema: 0. Migration: 0. No analytics events
added or modified.

## 10. Build / Test

- `npx tsc --noEmit`: 0 new errors (pre-existing `scripts/` errors unrelated to this diff, same set
  as Phase 1's own baseline).
- `npx eslint` on both touched files: 0 new errors/warnings (one pre-existing warning at
  `apt-client.tsx:567`, outside this diff's line range).
- `npm run build`: full production build succeeded, `/tools` and `/apt/[name]` both compiled.

## 11. Definition of Done

DSR: ✅ real-DSR misunderstanding removed, ✅ "간편추정" naming, ✅ real-DSR difference disclosed,
✅ formula unchanged.
Acquisition Tax: ✅ LIMITED nature shown, ✅ condition limits disclosed, ✅ formula unchanged
(scope note: 무주택 option removed pending a real fix, per user decision — see §3.1).
LTV: ✅ approval-like language removed, ✅ LIMITED disclosure, ✅ formula unchanged.
UX: ✅ 390px, ✅ 360px, ⚠ 375px representative-only (see §7), ✅ accessibility (`role="note"` +
`aria-label`, no hover-only disclosure).
Quality: ✅ regression 0, ✅ tests/build clean, ✅ docs, ✅ commit/push (this STEP).
