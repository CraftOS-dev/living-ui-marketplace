# Requirements (from the founder's brief)

From the YC Application brief (2026-10-26), which this app was cloned from:

1. A pipeline for creating, perfecting and submitting the application. Do not overcomplicate preparing and submitting it.
2. The pipeline makes sure the applicant did everything right; your AI agent checks it and flags it (zero marketing speak, co-founders, the startup explained in one sentence, past achievements, and the rest of the published guidance).
3. Your AI agent warns, flags, helps fill the application, and suggests things to do before preparing it.
4. Rank the probability of getting in.
5. Your AI agent gets all the information and infers it, so the applicant does not type everything; it fills as much as it can.
6. Production-level code and professional UI and UX.

Added 2026-10-30, for this clone:

7. Clone the YC Application app into a new app for the a16z speedrun submission (speedrun.a16z.com/apply/form).
8. Change the logo and the content. Keep the tips, or add more made specifically for a16z speedrun.

## Changes

- 2026-10-31: Reviews are manual. Editing/saving answers or founder fields must not enqueue agent reviews. Keep the last field and whole-application feedback visible during edits and while an explicitly requested review runs, label feedback from earlier saved inputs as changed since review, and provide an explicit Review again button. Duplicate clicks while a review is queued/running must not enqueue duplicate work. Preserve all existing application data and unrelated functionality.

- 2026-10-31: Remove the two owner-approved leftover chat messages (mqhn6dddqwxw94r and 82c8wb5qtxm7grn) without re-importing data or resetting live answers again. Provide a confirmation-guarded, ID-targeted messages.remove operation; it removes only the selected message and leaves unrelated records alone.
- 2026-10-31: app.reset requires confirm=true before any changes and clears all chat messages, including queued messages and agent replies, alongside its existing reset fields. A reset must leave the chat empty and no old queued messages eligible for relay.
- ~~2026-10-31: Chat status must distinguish waiting (pending), working on it (claimed), completed (done), canceled (rejected), and not delivered (failed). Answered messages must not show waiting. The message list must not expose terminal requests as unanswered sent/queued messages.~~
- 2026-10-31: Chat status must distinguish waiting (pending), working on it (claimed), completed (done), canceled (rejected), and not delivered (failed). Answered messages must not show waiting. Request statuses are read only through the frontend's platform-provided useAgentRequest subscription; app hooks must not read or change the host's request queue.
