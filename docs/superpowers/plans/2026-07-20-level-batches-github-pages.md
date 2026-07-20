# LEVEL Batch Groups and GitHub Pages Architecture Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task.

**Goal:** Make every CEEC LEVEL independently reviewable in deterministic random groups of 40 cards, and publish the web frontend through GitHub Pages while letting the Android app load that site.

**Architecture:** The catalog generator creates stable `level_batch` ranges beneath each LEVEL unit. The existing union selection API accepts any combination of those ranges, so selections can span LEVELs without changing card semantics. GitHub Pages serves only the Vite frontend; `VITE_API_BASE_URL` points the site and remote APK to a separately hosted vocabulary API/Hermes bridge. Local development keeps the current relative `/api` proxy.

**Tech Stack:** Python catalog generator, SQLite/Node API, React/Vite, Vitest, Capacitor Android, GitHub Actions Pages deployment.

## Global Constraints

- Preserve all existing uncommitted CEEC/import/UI work; do not reset, checkout, or overwrite it.
- Treat any user-facing `element` content as read-only.
- Use a deterministic seed per LEVEL so regenerated data keeps the same groups and card membership.
- Keep secrets server-side; never put Hermes API keys in the Vite bundle, GitHub repository, or APK.
- A GitHub Pages site cannot execute the Node/SQLite/Hermes backend; document the required API origin explicitly.

---

### Task 1: Define and test deterministic LEVEL batches (RED first)

**Files:** `scripts/build_scope.py`, `scripts/test_level_batches.py`, `server/test/api.test.cjs`

1. Add failing tests for a seeded LEVEL partition: all members stay within one LEVEL, full groups contain 40 unique lexemes, only the final group may be smaller, and the same input produces the same order.
2. Add a failing API contract test that discovers `kind: "level_batch"` ranges, verifies their counts, and selects batches from two LEVELs together.
3. Run the focused tests and record the expected failure before implementation.

### Task 2: Generate and expose LEVEL batch ranges

**Files:** `scripts/build_scope.py`, `data/generated/ranges.json`, `data/generated/vocabulary.json`, `data/generated/vocabulary.sqlite3`, `data/generated/validation_report.json`, `data/generated/quality_report.json`, `data/generated/vocabulary_review.csv`, `server/db.cjs`

1. Implement stable seeded shuffling and 40-card partitioning for standard CSV sources that expose `difficulty`/`unit` LEVELs, using stable IDs and a documented seed.
2. Emit `level_batch` ranges beneath the matching LEVEL unit with names such as `LEVEL 2｜隨機組 01（40）` and correct parent/lexeme membership.
3. Rebuild generated artifacts from the current sources without touching protected `element` content.
4. Update API ordering/serialization only where needed; preserve union and ancestor normalization behavior.
5. Run the focused tests, API tests, and the existing project check command.

### Task 3: Make the range picker clear and cross-LEVEL friendly

**Files:** `src/types.ts`, `src/range-utils.ts`, `src/components/RangeDrawer.tsx`, related tests/styles

1. Add the range kind to the UI model if missing and render LEVEL batch groups in their own labelled sub-list.
2. Keep individual LEVEL, cross-LEVEL multi-select, and “全部” selection working with existing ancestor normalization.
3. Add/adjust tests for selecting two batch groups from different LEVELs and preserving the 40-card preset without silently replacing the chosen groups.
4. Verify at the required 405×720 mobile viewport.

### Task 4: Add configurable API origin and GitHub Pages deployment

**Files:** `src/api.ts`, `vite.config.ts`, `public/.nojekyll`, `.github/workflows/deploy-pages.yml`, `.env.example`, `docs/GITHUB_PAGES_ARCHITECTURE.md`, `README.md`

1. Make all frontend API requests resolve against optional `VITE_API_BASE_URL`, while retaining relative `/api` requests locally.
2. Make Vite’s base path configurable for a project Pages URL.
3. Add a least-privilege GitHub Actions workflow that builds `dist` and deploys it with the official Pages actions.
4. Document repository variables, API CORS/origin requirements, local versus Pages behavior, and the fact that backend/Hermes hosting remains separate.
5. Add a static test/check for the workflow and verify a production build with a representative base/API origin.

### Task 5: Point Capacitor at the published site

**Files:** `capacitor.config.ts`, `package.json`, `docs/ANDROID_GITHUB_PAGES.md`

1. Keep `CAP_SERVER_URL` optional for local bundled builds, but document the GitHub Pages URL used for the remote-site APK build.
2. Add a reproducible build command that sets `VITE_API_BASE_URL` and `CAP_SERVER_URL`, then runs `npm run build && npx cap sync android`.
3. State update behavior: web UI changes flow after Pages deployment; native Capacitor changes still require an APK rebuild; API changes require the API host to be redeployed.
4. Run TypeScript/Vite checks and inspect the generated Capacitor config without embedding secrets.

### Task 6: Final verification and handoff

1. Run focused batch tests, API tests, `npm run check`, production build, and any available Android sync/build check.
2. Review `git diff` to confirm protected content was not changed and that unrelated user edits were preserved.
3. Commit only after verification, with a message that names both the batch ranges and Pages architecture; report any intentionally uncommitted user changes separately.
