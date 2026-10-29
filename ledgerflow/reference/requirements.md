# Ledgerflow: requirements

## Origin

The first Ledgerflow (a V1 Living UI with a FastAPI backend) was an
income and expense tracker with accounts, invoices, bills, contacts and a
few reports. Money was stored as floats, there were no bank statements to
import, no reconciliation, no rules, no tax handling beyond a rate field,
no locks or audit trail, and the AI agent could only read screens. This
rebuild redoes it from scratch as a V2 agent app on PocketBase: real
double-entry books built around the bank inbox, with the AI agent as a
colleague whose work is labelled, gated and reversible.

## Binding (asked for by the person on 2026-10-28)

1. Same process as the last two rebuilds: research first (the state of
   the art in bookkeeping software: QuickBooks Online, Xero, FreshBooks,
   Wave, Zoho Books, Sage, FreeAgent, NetSuite, Odoo, AI-native tools such
   as Digits, Puzzle, Pilot and Bench, plain-text accounting with
   Beancount/Fava and hledger, GnuCash, Firefly III, Akaunting,
   Manager.io, and the personal-finance apps that set the UX bar), then
   design, then implement (`../reports/Bookkeeping software UI UX survey.md`).
2. V1 is either ported to V2 or redone: redone.
3. Design after the newer agent apps, CAD Workshop in particular: slim
   rail, title bar, flat compact panels, near-monochrome.
4. Heavy AI agent integration: everything the person can do is an op;
   the agent categorizes, reads receipts, answers questions, prepares the
   close, drafts invoices and reminders; its work is labelled with its
   reason and confidence and can be reverted.
5. Production level: no placeholder copy, a control works end to end or
   is not shown; correct money handling; verified with a gate, a smoke
   test of every op group and end-to-end UI flows.
6. PocketBase is started silently while testing (never open the browser).

## Decisions

- Personal and business in one set of books (`entity`: business,
  personal or both) instead of two apps; the chart, reports and labels
  follow the choice.
- Integer minor units with ISO 4217 exponents; a home currency with
  rates; every transaction balances at home.
- The inbox is the center: statement lines are staged, suggested, then
  booked or matched, never written straight into the ledger.
- Suggestions have one precedence (match, document, transfer, rule,
  memory, AI) and three confidence levels, never percentages.
- The AI agent proposes by default. A posting policy (off by default)
  lets high-confidence proposals post up to a ceiling; system suggestions
  of chosen kinds can post on import; rules can be automatic. The agent
  has its own lock date and cannot sign off, reconcile, write off, move
  locks or change its policy.
- Undo is generic: every op records the records it changed and can be
  undone as a unit, refused inside a locked period or after a later change.
- Plain-text export (Beancount, hledger, CSV) so the books never depend on
  the app.
- Out of scope: bank feeds (no aggregator keys; statements are imported),
  payroll, inventory, filing tax returns (figures are prepared, not
  submitted), multi-user permissions.

## Acceptance

- Gate: types, build, fresh migrations, operations, triggers, hooks and
  egress all pass.
- Smoke test (142 checks) over every op group: setup, import and dedup,
  suggestions, rules, AI proposals and policy, invoices, bills, credits,
  multi-currency payments, write-off, reconciliation, every report
  balanced, close and locks, undo/redo, run revert, recurring, ECB rates,
  export, files, asks.
- End-to-end UI (36 checks): onboarding, paste import, booking by
  inspector and keyboard, rule from a line, expense dialog, invoice and
  payment, reports, reconciliation to zero, Ctrl Z, approving an AI entry,
  closing and reopening a month, palette, Ask AI, policy, phone bar.
