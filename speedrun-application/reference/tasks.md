# Tasks: a16z speedrun Application

Every task cites what it implements. These features already exist in the published app `speedrun-application` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-3): the header with speedrun's wordmark and the five-step stepper. Each step's meta line and state are worked out from the pipeline, the ink pill slides between steps, and an empty route opens the first step not done (`components/Shell.tsx`, `components/SpeedrunLogo.tsx`, `pipeline.get`).
- [x] T-2 (F-FRM-4, F-FRM-5): the odds and deadline pills, and the rail with "Next", "Your odds" and "Tell your AI agent" (`Frame` in `components/Shell.tsx`).
- [x] T-3 (F-FRM-6): the `--sr-*` palette on a neutral zinc base with speedrun's blue, light and dark, the same in every style pack (`theme.css`).
- [x] T-4 (F-FRM-7): an open page reloads onto a new build once no dialog or field is focused (`lib/live.ts`).
- [x] T-5 (F-SRC-1, F-SRC-2, F-SRC-3, F-SRC-4): add a link, upload files up to 50 MB (choose or drop, several at once), each source's state with its summary on hover, and removal behind a confirm (`pages/Links.tsx`, `lib_sources.js`).
- [x] T-6 (F-SRC-5, F-SRC-6, F-SRC-7, F-SRC-8, F-AGT-3): "Fill my application" fires `gather_requested` and follows the request. The agent's summary shows under "From your AI agent", progress shows in 24 segments, and with nothing to read the start is refused. It comes with the `gather_requested` playbook (`gather.start|begin|finish`, `lib_agent.js`).
- [x] T-7 (F-TEAM-1, F-TEAM-2, F-TEAM-3, F-TEAM-5, F-TEAM-6): founders added by name (duplicates refused), CEO first with "Make CEO", name, title, builds it end-to-end, full-time and years, "Looks right", and removal with the founder's relevant experience (`pages/Team.tsx`, `lib_team.js`).
- [x] T-8 (F-TEAM-4): "Form details" with speedrun's per-founder fields, the CEO's extra required fields, the "<n> missing" count, the form's country list and the education choices.
- [x] T-9 (F-TEAM-7, F-TEAM-8): the "Full-time founders" ring, "Team checks", and each founder's relevant experience and agent question on their card.
- [x] T-10 (F-ANS-1, F-ANS-2, F-ANS-3, F-ANS-4, F-ANS-5): five section tiles, four filters with counts, and question cards with an editor per type (yes/no, choice, month, date, rows, number with unit, long, short). Each card has a counter, saves after 700 ms, and opens its yes/no follow-ups (`pages/Answers.tsx`, `components/QuestionCard.tsx`, `lib_questions.js`).
- [x] T-11 (F-ANS-6, F-ANS-7, F-ANS-8, F-AGT-6): "Looks right" and "Confirm all <n>". The agent's text over a founder's answer becomes "Your AI agent suggests" with "Use it" and "Keep mine", and the agent's question shows on the answer (`lib_answers.js`).
- [x] T-12 (F-ANS-9): full-time or part-time and the number of full-time founders are derived from the team page until written by hand.
- [x] T-13 (F-ANS-10): the "Nothing answered yet" start card with "Add links or files" and "Answer myself".
- [x] T-14 (F-REV-1, F-REV-2, F-REV-4, F-REV-5, F-REV-6, F-AGT-10): manual review. "Review again" flushes pending saves and stores a frozen `review_request` snapshot (migration 1793403300), and duplicate requests join. The review notices and per-answer states keep the old feedback visible, and an outdated shorter version cannot be used (`components/ReviewAgain.tsx`, `answers.recheck`, `lib_judge.js`).
- [x] T-15 (F-REV-3, F-REV-7): the reviewer's structured verdict per answer through the host language model in JSON mode (strength, "Reads as", issues, missing parts, a shorter version), and the whole-application review shown on Polish (`lib_judge.js`).
- [x] T-16 (F-POL-1, F-POL-5, F-POL-6): the odds gauge with band, rank and the moves worth most, "How the odds are worked out", and the not-ready start card (`lib_odds.js`, `review.odds`, `pages/Polish.tsx`).
- [x] T-17 (F-POL-2, F-POL-3): every check from speedrun's guidance as grouped bars with totals, and "Fix next" with Fix links (`lib_checks.js`, `review.checks`, `components/Charts.tsx`).
- [x] T-18 (F-POL-4, F-SUB-2): the founders' confirmations: "Before you apply" on Polish and the team video's four points on Submit (`confirms.set`, `lib/actions.ts`).
- [x] T-19 (F-SUB-1, F-SUB-3, F-SUB-4, F-SUB-5, F-AGT-5): "Fix these first", "Fill the form" (with "Fill anyway" when blockers are left) firing `fill_form_requested`, the fill status and step count, and "Open speedrun". It comes with the `fill_form_requested` playbook (`pages/Submit.tsx`, `submit.ready|packet|progress`, `lib_submit.js`).
- [x] T-20 (F-SUB-6, F-SUB-7, F-SUB-8): "I submitted" locks what was sent. Then "Where it stands" records the interview, accepted or not this time, and "Apply again" starts the next cohort (`submit.done|status|next-cohort`).
- [x] T-21 (F-SUB-9): the cohort picker and deadline field, using speedrun's calendar (`lib_cohorts.js`, `settings.update`, cron `sr_cohort`).
- [x] T-22 (F-SUB-10, F-SUB-11): copy every answer with the founders' blocks, the Markdown download (`export.markdown`), and the "Nothing to send yet" start card.
- [x] T-23 (F-MSG-1, F-MSG-2, F-MSG-3, F-AGT-4): "Tell your AI agent" in the rail, with delivery states read through `useAgentRequest` (`lib/message-status.ts`). A message refused by the cooldown is queued and relayed by `sr_messages`. It comes with the `message_sent` playbook (`messages.send|reply`, `lib_agent.js`).
- [x] T-24 (F-AGT-1, F-AGT-2): the 41 agent operations generated from the catalog into `operations.json` and served by `a2app_routes.pb.js` through the same handlers the View calls, with `app.guide`, `app.status` and `app.founder-todo` (`cat_*.js`, `tools/gen.mjs`, `lib_guide.js`).
- [x] T-25 (F-AGT-7, F-AGT-8): founders-only operations refuse the agent (`agent_not_permitted`), and `founders.remove`, `sources.remove` and `messages.remove` need approval and `--confirm true` (`lib_auth.js`, `lib_ops.js`).
- [x] T-26 (F-AGT-9): the application locks after submission (`submitted_locked`).
- [x] T-27 (F-AGT-11): `app.reset --confirm true` clears answers, all chat messages, activity, the review and the gather and fill state (`lib_pipeline.js`).
- [x] T-28 (F-AGT-12): the agent attaches files by path, never from inside the app's own folder (`localFile` in `lib_util.js`).

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 41 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
