# Study Continuity, Translation, and Automatic Pronunciation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated articles visibly include Chinese translation, resume the exact study card after an app restart, and add default-on automatic pronunciation with mute and volume controls.

**Architecture:** Keep vocabulary and review history in the existing Node/SQLite API, while storing the active study session snapshot and speech preferences in the app's local storage. Restore the snapshot after the catalog loads, persist every card/flip/rating state change, and let the existing Capacitor TTS plus browser `speechSynthesis` fallback share one volume/mute policy. Keep the article JSON contract backward-compatible by accepting common translation field aliases and rendering translation open by default.

**Tech Stack:** React 19, TypeScript, Vite, Capacitor Text-to-Speech, Vitest, Node `node:test`, existing localStorage and SQLite stores.

## Global Constraints

- Preserve the user-facing `element` content as read-only.
- Keep Hermes/API keys server-side; do not put them in localStorage or Vite output.
- Default automatic pronunciation is enabled and uses the maximum supported app volume (`1.0`); the device media volume remains outside the app's control.
- A resumed session must restore the same card order and current index; changing the study range explicitly starts a new session and replaces the snapshot.
- Every production behavior change must have a failing test observed before implementation and a fresh passing verification afterward.

---

### Task 1: Make article translation reliable and visible

**Files:**
- Modify: `server/articles.cjs`
- Test: `server/test/article.test.cjs`
- Modify: `src/components/ArticlePanel.tsx`
- Test: `src/components/ArticlePanel.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- `parseGeneratedArticle()` must normalize `translationZh`, `translation`, `translation_zh`, and `chineseTranslation` into `GeneratedArticle.translationZh`.
- `ArticleResult` must render the Chinese translation section open when translation text exists, and show a clear missing-translation notice when the model omitted it.

- [x] **Step 1: Write failing parser and UI helper tests**

Add a server fixture that returns `chineseTranslation` while requesting `includeTranslation: true`; assert the API returns that text as `translationZh`. Add a frontend helper test asserting a non-empty translation is marked visible and a null translation produces the missing notice.

- [x] **Step 2: Run the focused tests and observe the expected failures**

Run `node --test server/test/article.test.cjs` and `npx vitest run src/components/ArticlePanel.test.ts`. The new alias test must fail because the parser currently only reads `translationZh` or `translation`, and the visibility test must fail because the UI currently renders a closed `<details>` only when text exists.

- [x] **Step 3: Implement the smallest parser and rendering changes**

Normalize the aliases in `parseGeneratedArticle`, keep `includeTranslation: false` returning `null`, and render `<details open>` with a `中文翻譯` summary. When the value is missing, render `尚未取得中文翻譯，請重新生成文章。` without inventing a translation.

- [x] **Step 4: Run focused tests again**

Run the same two commands and require all existing and new tests to pass.

---

### Task 2: Persist and restore the active study session

**Files:**
- Modify: `src/types.ts`
- Modify: `src/storage.ts`
- Create: `src/storage.test.ts`
- Modify: `src/api.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Add `StudyResumeSnapshot` with `version: 1`, `session`, `currentIndex`, `flipped`, `hasFlipped`, `activeRangeIds`, and `savedAt`.
- Export `loadStudySnapshot()`, `saveStudySnapshot()`, and `clearStudySnapshot()` from `src/storage.ts`; invalid JSON, an invalid session, or an out-of-range index must return `null` rather than crash the app.

- [x] **Step 1: Write failing storage tests**

Test that a valid snapshot round-trips through localStorage, that an index beyond `session.cards.length` is clamped to the session length, and that malformed JSON or a missing card list returns `null`.

- [x] **Step 2: Run `npx vitest run src/storage.test.ts` and verify RED**

The test must fail because no snapshot type or storage functions exist yet.

- [x] **Step 3: Implement versioned snapshot storage**

Use a separate key (`morphemeDesk:study-resume:v1`) so existing preferences remain compatible. Validate only the fields needed for safe restoration, preserve the full `StudySession` card order, and catch storage quota/security errors.

- [x] **Step 4: Wire App initialization to restore before creating a new session**

Load ranges and the snapshot together. If the snapshot's active ranges match the saved preferences and its session has cards, restore the snapshot's session/index/flip state and fetch only the summary; otherwise create a new session as today. Mark initialization complete only after this branch so the persistence effect cannot overwrite a snapshot before it is restored.

- [x] **Step 5: Persist every study state transition**

After initialization, persist the active session, current index, flip state, answer state, and range IDs in an effect. Explicit range changes reset index to zero and replace the snapshot. Keep completed sessions at `currentIndex === cards.length` so reopening shows the completion state coherently.

- [x] **Step 6: Run storage and existing UI tests**

Run `npx vitest run src/storage.test.ts src/card-context.test.ts src/range-utils.test.ts src/swipe-utils.test.ts` and confirm all pass.

---

### Task 3: Add automatic pronunciation, mute, and volume settings

**Files:**
- Modify: `src/types.ts`
- Modify: `src/storage.ts`
- Create: `src/speech.ts`
- Create: `src/speech.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Flashcard.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- `AppPreferences` gains `speechMuted: boolean` and `speechVolume: number`.
- `src/speech.ts` exports `DEFAULT_SPEECH_VOLUME = 1`, `AUTO_SPEAK_DELAY_MS = 900`, and `normalizeSpeechVolume(value: unknown): number` clamped to `0.1..1`.
- `Flashcard` replaces the manual speaker action with `speechMuted` and `onToggleSpeech`; the top-right control labels itself `關閉自動發音` or `開啟自動發音`.

- [x] **Step 1: Write failing speech preference tests**

Assert the default volume is `1`, values below/above the supported range clamp to `0.1`/`1`, and invalid values return the default. Add a component-level contract assertion for the mute button labels through the exported label helper.

- [x] **Step 2: Run `npx vitest run src/speech.test.ts` and observe RED**

The test must fail before the helper and preference fields exist.

- [x] **Step 3: Implement speech settings and persistence**

Extend preference loading with backward-compatible defaults. `speakCurrent` passes the configured volume to Capacitor Text-to-Speech and `SpeechSynthesisUtterance.volume`; muting cancels current speech and suppresses automatic speech, while keyboard `S` remains an explicit forced pronunciation action.

- [x] **Step 4: Schedule pronunciation on each newly displayed card**

Use one cancellable timeout keyed by `currentCard.lexemeId`, `loading`, and mute state. After `AUTO_SPEAK_DELAY_MS`, pronounce the current headword once; rapid swipes cancel the old timer so stale words are never spoken.

- [x] **Step 5: Add the settings slider**

In the settings panel add an accessible `range` input from 10–100 with a percentage output, save it with the existing preferences button, and show the mute state next to the control. Do not expose or persist API keys.

- [x] **Step 6: Run speech and UI tests**

Run `npx vitest run src/speech.test.ts src/storage.test.ts src/components/ArticlePanel.test.ts` and confirm all pass.

---

### Task 4: Full verification, mobile checks, and publication

**Files:**
- Review: all modified files and `docs/superpowers/plans/2026-08-17-study-continuity-audio-translation.md`

- [x] **Step 1: Run the full project gate**

Run `npm run check`; require TypeScript, 27+ server tests, all Vitest tests, and Vite build to exit 0.

- [x] **Step 2: Build the Funnel APK**

Run `npm run android:build`, inspect `android/app/src/main/assets/capacitor.config.json`, and verify the APK contains the Funnel URL without any secret values.

- [x] **Step 3: Verify the live web path at A54 dimensions**

Use the browser at `412x915` to reload the Funnel URL without cache, confirm the card renders, the translation section is visible in a generated/saved article, and `document.body.scrollWidth === window.innerWidth`.

- [x] **Step 4: Review protected content and publish**

Run `git diff -- element` and `git status --short`, then commit and push only the intended source/docs changes. Record the APK path and commit hash for installation.
