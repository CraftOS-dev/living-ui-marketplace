# Tasks: Word Improve

Every task cites what it implements. These features already exist in the published app `word-improve` 1.0.0, so the build tasks are recorded as done. T-14 to T-17 are the agent operations added in the move to the Agent App Framework (2026-11-11). They mirror the existing UI and add no feature.

## Build
- [x] T-1 (F-SES-1, F-SES-2): the sessions sidebar (`components/SessionList.tsx`):
  - cards show title, status label and mode;
  - the list loads the 500 most recently updated sessions (`apiAdapter.ts` `handleListSessions`, `toSummary`, `fallbackTitle`);
  - a click opens a session, the open card is highlighted, and the newest opens on load (`AppController.initialize`, `loadSession`).
- [x] T-2 (F-SES-3, F-SES-7): "New session" resets the main area to the form (`AppController.startNewSession`). The session header shows the title with mode, tone and variant tags (`components/MainView.tsx`).
- [x] T-3 (F-SES-4): the rename dialog, opened from the sidebar's "⋯" menu or the header (`components/RenameModal.tsx`):
  - trims the name and ignores an empty or unchanged one;
  - Enter saves and Escape cancels;
  - saves `title` through the record API (`handleRenameSession`).
- [x] T-4 (F-SES-5): delete from the "⋯" menu or the header, behind "Delete this session? This cannot be undone." (`AppController.deleteSession`, `handleDeleteSession`).
- [x] T-5 (F-SES-6): the LLM state, from `GET /api/ops/integrations/status` (`ops.pb.js`, through `_craftbot_bridge.llmAvailable`: CraftBot's bridge or a running framework bridge). It shows as the sidebar footer and the "No language model connected" warning.
- [x] T-6 (F-NEW-1, F-NEW-2, F-NEW-3, F-NEW-4, F-NEW-5): the new-session form (`components/SessionInput.tsx`):
  - the textarea;
  - three mode chips;
  - the Tone select for Tone shift (default Formal) and the Instruction field for Custom;
  - the Variants select (2–5, default 3);
  - the "Paste some text first" and "Add a custom instruction or pick a different mode" checks.
- [x] T-7 (F-NEW-6): "Generate variants" (`AppController.createAndGenerate`):
  - creates the draft (`handleCreateSession`), then generates (`handleGenerate`, `generatePayload`, `applyGeneration`);
  - one model call through `POST /api/ops/ai/generate` (`ops.pb.js`, `_craftbot_bridge.callLLM`), with the prompt from `sessionGenerationPrompt`;
  - shows "Generating variants…" while it runs, then the toast.
- [x] T-8 (F-NEW-7): JSON answer parsing and validation (`parseJsonResponse`, `validateStructuredVariants`), with stub variants and the "(stub)" title when the answer is missing, unusable or short (`stubStructuredVariants`, `stubTitle`).
- [x] T-9 (F-MRG-1, F-MRG-2, F-MRG-5): sentence and paragraph splitting (`splitParagraphs`, `splitSentences` with the abbreviation guard), then the alignment into merge rows (`buildSegments`, `detectReorderNote`):
  - agreed rows, conflicts with notes, additions and paragraph breaks;
  - rendered by `components/MergeView.tsx` with its numbering and the sentences, picked and to-go counts.
- [x] T-10 (F-MRG-3, F-MRG-4): conflict cards and addition buttons, saved through `PUT /api/segments/<id>_s<pos>/select` in the shim (`handleSelectSegment`, which clamps the selection):
  - conflict cards: pick, click again to unpick, the others dim, and empty cards are disabled;
  - additions: Skip and Include.
- [x] T-11 (F-MRG-6): "Regenerate" and the draft view's "Generate variants" (`AppController.regenerate`). They clear the compiled text, then generate with a salt that adds the regeneration line to the prompt, replacing every pick.
- [x] T-12 (F-RES-1, F-RES-2): the live compile after every pick, open and generation (`handleCompile`, `joinUnits`). It saves `compiled_text` and `status`, then computes the word-level LCS diff (`wordDiff`). The result is rendered by `components/CompiledResult.tsx` with the word counts and the no-changes hint.
- [x] T-13 (F-RES-3, F-RES-4): Copy to the clipboard with "Copied" and the toast. The result pane resizes on a drag of the divider, side by side or stacked below 1024 px (`MainView.tsx`).
- [x] T-14 (F-AGT-1, F-AGT-2, F-AGT-5): the agent operations:
  - routes `/api/ops/sessions/{list,get,result,create,regenerate,pick,delete}` in `pb/pb_hooks/agent_ops.pb.js`, with the operations in `lib_agent.js`;
  - `lib_agent_text.js` ports the shim's engine function by function;
  - `sessions.create` validates like the form, creates, generates and compiles, and reports `llm.answered`, `model_variants` and `stub_variants`;
  - all 9 operations are declared in `operations.json` and served to agents by `a2app_routes.pb.js`.
- [x] T-15 (F-AGT-3, F-AGT-7): the read-only operations `sessions.list`, `sessions.get` and `sessions.result`:
  - the merge view with MergeView's numbering, labels, notes and pickability;
  - the live compile;
  - the word diff, capped at 1,500,000 cells and using integer-coded words in an `Int32Array`.
  - `integrations.status` reports what the person's screen will do.
- [x] T-16 (F-AGT-4): `sessions.pick`:
  - takes one pick or an all-or-nothing batch in one transaction;
  - choices `original`, `A`–`E` or `none` for conflicts, `include` or `skip` for additions;
  - refuses agreed rows, paragraph breaks and disabled cards (409), then compiles.
- [x] T-17 (F-AGT-6): `sessions.regenerate` and `sessions.delete` are declared destructive, so the adapter asks for the person's approval.
- [x] T-18 (F-AGT-1): renaming through `a2app <app> data sessions update <id> --title`. AGENT_APP.md records the trimming and non-empty convention.

## Verification
- [x] Parity test: `lib_agent_text.js` against `apiAdapter.ts` in node (11,748 checks, including 4,000 fuzzed sentence splits and 3,000 fuzzed word diffs). Every operation was also checked on PocketBase 0.39.7 against the UI's own code run on the same server: 928 checks without a model and 880 with a fake model bridge, with stored bytes identical (2026-11-11).
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 9 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
