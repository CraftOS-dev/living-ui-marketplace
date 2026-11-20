# Tasks: YC Application

Every task cites what it implements. These features already exist in the published app `yc-application` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-3): the header with YC's logo and the five-step stepper. Step states are worked out from the pipeline (`lib_pipeline.js`), meta lines carry counts, and an empty route opens the first step not done (`components/Shell.tsx`, `lib/router.ts`).
- [x] T-2 (F-FRM-4): the odds pill (shown when the odds are ready) and the deadline pill with its tip (shown while preparing).
- [x] T-3 (F-FRM-5): the rail on every step: "Next" (`nextAction`), "Your odds" (hidden on Polish), and "Tell your AI agent".
- [x] T-4 (F-FRM-6): the neutral `--yc-*` palette in light and dark, with YC orange reserved for emphasis, Manrope, the YC logo SVG, and no emoji or em dashes (`theme.css`).
- [x] T-5 (F-FRM-7): reload onto a new build after a reconnect or a tab show, waiting while a dialog or field is focused (`lib/live.ts`).
- [x] T-6 (F-SRC-1, F-SRC-2, F-SRC-3, F-SRC-4): Links and files: add a link, upload or drop a file up to 50 MB, source rows with their state and summary, and removal behind a confirmation (`pages/Links.tsx`, `lib_sources.js`).
- [x] T-7 (F-SRC-5, F-SRC-6, F-SRC-8): "Fill my application" fires `gather_requested` (`gather.start`, founders only, refused without a source or founder). It follows the request and shows the "From your AI agent" summary.
- [x] T-8 (F-SRC-7): "Your application" progress: percentage, answered count, 24 segments.
- [x] T-9 (F-TEAM-1, F-TEAM-2, F-TEAM-3, F-TEAM-4): founder cards. Add with the duplicate-name refusal, edit facts and contacts, "Looks right", and remove with profile answers in one transaction (`pages/Team.tsx`, `lib_team.js`).
- [x] T-10 (F-TEAM-5): the equity ring and "Team checks" from the team group of checks.
- [x] T-11 (F-TEAM-6, F-TEAM-7): the four profile questions per founder (`fp.<id>.<field>`), and the agent's `need` shown on the card.
- [x] T-12 (F-ANS-1, F-ANS-2, F-ANS-10): Answers: section tiles with mini rings, the Needs you / Empty / To confirm / Flagged filters with counts, and the start card when nothing is answered (`pages/Answers.tsx`).
- [x] T-13 (F-ANS-3, F-ANS-4, F-ANS-5): `QuestionCard` with YC's wording and tip and an editor per type (yes/no, choice, month grid, long, one line). It has the counter, a 700 ms autosave, and yes/no gates (`lib_questions.js`, `lib_answers.js`).
- [x] T-14 (F-ANS-6, F-ANS-7, F-ANS-9, F-AGT-6): "Looks right" and "Confirm all <n>". The agent's text on a founder-owned answer becomes "Your AI agent suggests" with "Use it" / "Keep mine", and the agent's questions show as "Your AI agent asks: …".
- [x] T-15 (F-ANS-8, F-AGT-10): the reviewer reads judged answers and the whole application through the host language model in JSON mode (`lib_judge.js`, job `yc_review`). It shows "Reads as", issues and a shorter version, plus the offline and error states with "Try again".
- [x] T-16 (F-POL-1, F-POL-5, F-POL-6): the odds model (seven factors, caps, modifiers, five bands) with the gauge, top moves, and "How the odds are worked out". It is not ready until the team and five answers are in (`lib_odds.js`, `pages/Polish.tsx`).
- [x] T-17 (F-POL-2, F-POL-3): about 50 checks from YC's guidance, decided from facts and verdicts, shown as grouped bars and the ranked "Fix next" with links to each fix (`lib_checks.js`, `components/Charts.tsx`).
- [x] T-18 (F-POL-4, F-SUB-2): the founder confirmations: five "Before you apply" switches and the four founder-video rules with the video link (`confirms.set`).
- [x] T-19 (F-SUB-1, F-SUB-3, F-SUB-4, F-AGT-5): Submit: "Fix these first", and "Fill the form" firing `fill_form_requested` with the "Fill anyway" confirmation. The status pill and section count follow `submit.progress` (`lib_submit.js`).
- [x] T-20 (F-SUB-5, F-SUB-6): "Open YC" and "I submitted", behind "Did you press Submit on YC?". The sent snapshot is stored and edits lock (`submitted_locked`).
- [x] T-21 (F-SUB-7, F-SUB-8): "Where it stands": interview time, "Interview booked", "Accepted", "Not this time", and "Apply again for <batch>?" (`submit.status`, `submit.next-batch`).
- [x] T-22 (F-SUB-9, F-SUB-11): batch and deadline (the next four batches, the time left or late), "A YC founder recommends us", and the move of an untouched install to the next open batch (`lib_batches.js`, job `yc_batch`).
- [x] T-23 (F-SUB-10, F-SUB-12): "Copy every answer", the Markdown download (`export.markdown`), and the "Nothing to send yet" state.
- [x] T-24 (F-MSG-1, F-MSG-2, F-MSG-3, F-AGT-4): "Tell your AI agent": the thread of the last four messages with delivery states. `messages.send` fires `message_sent`, a refused ask is queued and re-sent by the job `yc_messages`, and replies come from `messages.reply`.
- [x] T-25 (F-AGT-1, F-AGT-2): the catalog of 39 agent operations in 13 modules, generated into `operations.json`, `routes.pb.js` and `ops.gen.ts` (`tools/gen.mjs`) and served by `a2app_routes.pb.js`. `app.guide`, `app.status` and `app.founder-todo` come with it.
- [x] T-26 (F-AGT-3): the `gather_requested` playbook: read the sources, add the missing ones, add founders, write answers, ask what is missing, check the deadline, `gather.finish`.
- [x] T-27 (F-AGT-7, F-AGT-8, F-AGT-9): the caller rules in `lib_auth.js` and `lib_ops.js`. Founders-only operations refuse the agent, destructive agent calls need approval and `--confirm true`, and edits are refused after submission.

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 39 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
