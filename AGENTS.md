<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# E-JIP PROJECT RULES

## Product identity

E-JIP is a data-driven housing decision platform that helps users decide where to live. Its core product flow is `DATA -> INTERPRETATION -> COMPARISON -> RECOMMENDATION -> ACTION`; it is not merely a real-estate listing service. Preserve this direction and do not reshape existing features into copies of competing services.

## Safe autonomous mode and scope

- For safe, reversible work, analyze the relevant code, choose the safest implementation consistent with the existing contract, implement it, test it, and report the actual result without waiting for approval over minor choices.
- Safe autonomous choices include component structure, CSS/layout, spacing, typography, responsive behavior, naming, minor copy, safe refactoring, non-destructive performance work, tests, QA, documentation, and obvious bug fixes within an existing contract.
- Ask for approval before high-risk or hard-to-reverse work: DB/schema/migrations, destructive or bulk production writes, major auth/security behavior, Score formula or semantics, legal/policy risk, destructive changes, or irreversible product direction.
- This refines, rather than removes, the approval flow in `CLAUDE.md`: reversible/safe work proceeds autonomously; high-risk/irreversible work stops for approval.
- Do not implement unrelated features. Record useful out-of-scope ideas as final-report recommendations. Small changes strictly required to complete the requested step may proceed.
- Do not remain idle over low-risk alternatives; choose the best safe option and continue.

## Data truth policy

- Prefer real, attributable data. Never invent missing data or false precision.
- Never expose another apartment's data as a fallback.
- Distinguish `missing`, `unavailable`, API error, unresolved identity, and a verified true zero. An API failure or unresolved identity is not "no transactions"; only a successful, trustworthy zero result is "no transactions".
- Never disguise a failed lookup as absent data. Preserve provenance and data-quality states wherever available.

## Apartment canonical identity

- Across search, map, detail, and trade flows, do not re-identify an apartment by name alone.
- Prefer the current canonical contract and available identifiers: `Apartment.id`, `ApartmentMaster` identity, `aptSeq`, `lawdCd`, `dong`, and canonical apartment name.
- Do not add name-only re-search behavior that could connect another complex or unrelated trades.

## Unit Master protection

- Preserve `ApartmentUnitType.canonicalExclusiveArea` as the exact identity. Do not confuse UI rounding with identity.
- Presentation may group raw micro-variants of the same exact exclusive area, but must not merge different exclusive areas.
- Use `representativePyeong` only when supplied by trustworthy Unit Master data. Never treat `exclusiveArea / 3.3058` as a representative pyeong.
- If Unit Master is unavailable, fall back to the exact exclusive-area square-meter label.
- Do not present a derived or guessed label as an official pyeong label. Do not hardcode inferred supply area or representative pyeong.

## E-JIP Score protection

- E-JIP Score V2 is a trust-critical system. Do not change its formula, category weights, eligibility, provenance, fallback semantics, or normalization without user approval.
- Before proposing a Score change, document: anomaly -> cause -> reproduction -> impact -> regression analysis -> comparison, then request approval.
- Keep the objective E-JIP Score separate from any future personalized score.

## Database and production safety

- Without explicit user approval, do not modify the Prisma schema, create or apply migrations, alter production schema, perform destructive DB operations, execute bulk production writes, or mass-update/delete existing production data. Additive schema changes also require approval.
- Read-only DB investigation may proceed autonomously when secrets and sensitive data remain protected.
- If a DB change appears necessary, stop and report why it is needed, its scope, rollback plan, and impact on existing data.
- Treat a push to `main` as potentially triggering a Vercel production deployment.

## Auth, security, and secrets

- Do not change OAuth account-linking policy, NextAuth security behavior, session strategy, provider security settings, or token handling without explicit approval.
- Never print, copy into documentation, commit, or log secrets, API keys, passwords, or tokens.
- Do not read or output the contents of `.env` or `.env.local`; environment-variable names may be referenced when necessary.

## Worktree preservation

- At the start of every task, run `git branch --show-current`, `git status --short`, and `git log -5 --oneline --decorate`.
- Treat all pre-existing modified and untracked files as user work. Unless explicitly in scope, never edit, overwrite, delete, restore, reset, clean, stage, or commit them.
- Currently known user work includes `package.json`, `package-lock.json`, `.claude/settings.local.json`, `ApartmentAutocomplete.tsx.bak`, `my_prod.html`, `prisma/schema_old.prisma`, and `tmp/`; always trust the fresh status over this snapshot.

## Git, commit, and push safety

- Never use `git reset --hard`, `git clean -fd`, force push, unrelated restore, or history rewriting.
- Prefer history-preserving rollback such as a targeted revert when rollback is required.
- A task commit may contain only files belonging to that step; verify staged names before committing.
- After requirements and verification pass, Codex may autonomously commit and push safe, reversible UI, bug-fix, read-path, test, or documentation work when the user's task authorizes delivery.
- Obtain approval before committing or pushing DB/schema/migration work, production bulk writes, major auth/security changes, Score formula changes, destructive changes, or irreversible product direction.

## Next.js 16.3 rule

- Follow the generated Next.js block above. Before any Next.js implementation, read the relevant documentation from the installed version at `node_modules/next/dist/docs/` and heed its deprecations. Do not rely on remembered APIs when the local documentation differs.

## UI and UX

- Work mobile-first and QA important UI at 360px, 375px, and 390px.
- Ensure no horizontal overflow, clipped text, bottom-navigation overlap, undersized touch targets, or fixed/floating UI covering content.
- Validate desktop as a responsive layout, not merely an enlarged mobile screen.
- Do not add decorative emoji to product UI. Prefer the established `lucide-react` icon system.
- Keep primary information large and clear, secondary text readable, and avoid unjustified whitespace growth.

## Search and Map V2.1

- Preserve the `REGION` / `APARTMENT` result contract, canonical identity handoff, selected-marker priority, new-build marker, request cancellation, stale-response prevention, and duplicate-request reduction.
- Preserve marker priority: `SELECTED > NEW_BUILD > DEFAULT`.
- Guard against search-performance regressions.

## Detail and area

- On apartment detail, prohibit fake pyeong values and preserve Hero area-label accuracy, Unit Master fallback, price/trade truth, Favorite/Auth behavior, and canonical search identity.
- In `AreaSelector`, display labels may change, but `selectedArea`, `canonicalExclusiveArea`, and trade-filter identity must remain semantically unchanged.

## Community direction

- Do not reduce Community to a generic message board. Its long-term direction includes Busan real-time, regional, and apartment communities connected contextually to map, detail, and data, with comments and return visits at the center.
- Do not implement Community V2 outside an explicitly requested scope.

## Tests and verification

- Report only commands actually run and their real exit results. Never claim expected, presumed, or likely PASS.
- Default verification is targeted validation, then `npx tsc --noEmit`, `npm run lint`, and `npm run build`, proportionate to the change and risk.
- If repository-wide typecheck failure comes only from pre-existing script errors, report `FAIL_EXISTING_SCRIPT_ERRORS` and distinguish them from errors introduced by the current change.
- Do not repeat the same heavy build unnecessarily.

## Production evidence

- Prefer actual production and manual evidence over agent narrative. A user-confirmed production result or regression visible in a real screenshot overrides a previous report or assumption.

## Documentation

- Record important development steps in `docs/development/`. Update `CHANGELOG.md` and `DECISIONS.md` when genuinely required by the project's existing policy.
- Do not perform broad documentation refactors merely to document a scoped change.
