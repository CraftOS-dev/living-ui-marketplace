# funds tests

Run against a scratch copy of the app (never the delivered folder, never a live port), with the frontend built
(`npm run build --prefix frontend`) for the screen tests. Node must be on the PATH: the notices and packs are drawn
by `engine/funds/render.mjs`, and the tests read the PDF text back with pdf.js from the frontend's packages.

`VO_APP=<scratch copy> VO_PORT=3190 VO_BRIDGE=3290 node run_all.mjs` (each test resets the database through
`tools/dev/reset.sh` and starts it with `tools/dev/serve.sh`, which starts the mock bridge). Holdings come from the
portfolio module (its holdings import, `lib.mjs` addHolding); no stand-ins are needed.

| File | What |
|---|---|
| `t01_empty.mjs` | Empty database: every funds read op as owner, partner, analyst, finance and your AI agent (no 5xx); empty answers honest (unknown with a reason, never zero); people-only ops refuse your AI agent first; the fund data switch. |
| `t02_capital.mjs` | LPs and commitments (an LP proposal accepted), sealed tax id, wire details with a second member, a call in three steps (exact lines, fee-paying only, balances after the notice, your AI agent's review, issue with the PIN, PDF and CSV per LP, ledger rows), metrics net beside gross, payments (a proposal accepted, settled), a late call in Next with Record received and Remind, a distribution with the waterfall estimate, voids, opening balances, statements (administrator and bank) and reconciliation, ILPA and XLSX exports, notices sent by the mock Gmail with their attachments. |
| `t03_close.mjs` | Quarter close: open, mark_note jobs, sourced marks, Approve all from Next with the PIN (finance or a partner; not analysts, platform or your AI agent), freeze with a hash, the letter by lp_letter, edits with AI-use counts, finalise, packs sent, the quarter Sent; reserves with sourced assumptions (engine vector), preview, scenarios; the fund raise board; LP questions; undo and audit. |
| `t04_agent.mjs` | The LP importer through the kernel's imports; allow and propose rules; marks after a follow-on; search; app.guide and the AI use inventory. |
| `t05_fixes.mjs` | Preferred return compounding in the LPA; LP names in Japanese, Chinese, Korean, Greek, Cyrillic and accented Latin read back from the notice PDFs (subset fonts, under 120 KB); recall and subscription line repayment calls; void notices drafted for LPs who received the notice; statements, bank lines and opening balances and holdings through the kernel importer; holdings read for the caller (fund scope and restricted deals: rows withheld and counted, fund totals whole). |
| `seed_ui.mjs` | A realistic Fund I (USD 50M, 2024, one LP named in Japanese) and a Fund II raise for screenshots and manual review. |
| `flow_ui.mjs` | Through the screens: a call in three screens and one PIN, Record received fills the bar, Approve all from Focus with the PIN, hover and pointer checks. |
| `shots.mjs` | Every funds page and dialog light and dark at 1440 and 390; console errors, sideways scroll, word counts. |
| `pdf_shot.mjs` | Renders a call notice and an LP pack (the Japanese LP's) and a distribution notice to PNG with pdf.js for review. |
