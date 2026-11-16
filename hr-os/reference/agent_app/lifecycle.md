### Lifecycle

Onboarding and offboarding checklists, pre-boarding for new hires, letters,
separations with the exit interview and the full and final statement,
assets, the employee handbook and grievances. Pages under `#/lifecycle`
(home, board per person, tasks, checklists, templates, letters, letter
templates, separations, settlement, assets, handbook, grievances, welcome),
print pages `#/print/lifecycle/letter/<id>` and
`#/print/lifecycle/settlement/<id>`, the profile tab `Lifecycle`, two Inbox
sections and Home widgets.

Requirements:

- [x] Checklist templates (onboarding, offboarding, custom) per entity, one default per kind; country defaults seeded on `entity.created` (first-day essentials, equipment, accounts, documents and deadlines for US, JP, SG, IN, MY, GB, AU; generic for other countries); `checklist-templates.seed` adds them to an entity that lacks them
- [x] Tasks with a lane (HR, manager, IT, the person, a named member, your AI agent), a due offset from the first or last day, a kind (task, document upload, signature); drag to reorder and an inline "+" in the editor
- [x] Onboarding starts on `employment.hired` (first day today, ahead or at most 30 days ago); offboarding on an approved separation, or on `employment.ended` without one
- [x] Manager tasks follow the manager (re-resolved on `employment.changed`); with no IT role, HR takes IT tasks
- [x] Pre-boarding: a person with a sign-in sees a welcome page (days to go, arrival time, place, contact, what to bring, a note), their tasks, documents and letters to acknowledge, handbook pages to read
- [x] Daily reminders (one digest per member, 09:00 local per entity), your AI agent asked again for its open tasks
- [x] Separations (resignation, termination, retirement, end of contract, death, other) with notice and last day, reason, reason code, rehire eligibility; approval kind `separation` (the manager, then HR); on approval the employment ends on the last day (kernel), offboarding starts and `separation.approved` is emitted; a moved last day re-ends the employment and emits `separation.changed`
- [x] Exit interview form (questions of type text, rating, choice, yes or no); answers for HR only
- [x] Full and final statement: claims to reimburse, advances and loans to recover, leave to pay out (days, and the amount once the final pay run pays them), assets not returned, the final pay run (number, status, calculated), totals per currency: the final payslip's gross, deductions and net once payroll calculated it, an estimate before (printable)
- [x] Letters: templates by kind (offer, appointment, confirmation, experience, salary certificate, warning, relieving, custom) in markdown with placeholders, country defaults (Japanese 在職証明書 and 退職証明書), drafts with a live preview, issue (frozen, stored as a document of the person, signed by the issuer), acknowledgement, void; pay placeholders only for people who may see that pay; your AI agent drafts as a proposal (`draft_letter` jobs)
- [x] Assets: issue, return (condition, lost), retire, value, history, on the profile and in offboarding; CSV import (check, then import) and export
- [x] Handbook: pages in markdown with categories, drafts and published versions, acknowledgement per version, who has read it, `handbook.text` for answering people's questions
- [x] Grievances: types, a confidential report (optionally anonymous), investigator, sharing with members or your AI agent, notes internal or for the reporter, status and resolution the reporter reads; never shown to managers unless HR assigns or shares; your AI agent sees only the count until shared

Collections:

| Collection | Purpose | Notes |
|---|---|---|
| checklist_templates | Checklist templates | `tasks` json `[{key, title, description, assignee, due_offset_days, kind, document_category}]`, `is_default` per entity and kind, `builtin` (country defaults) |
| checklists | A checklist of one employment | `anchor_day` (first or last day), `separation`, `first_day` json |
| tasks | Checklist tasks | `assignee_kind` hr, manager, it, employee, member, agent; `assignee_member`; `due`; `document` (the upload) |
| letter_templates | Letter templates | `body` markdown with `{{placeholders}}`, `country`, `language` en or ja |
| letters | Letters | number `L0001`, `body` (draft source), `issued_body` (frozen), `document` (the person's document; its acknowledgement is the one record of it) |
| separations | Separations | number `S0001`, `approval`, `exit_interview` json (form questions and answers), `settlement_payrun`, `events` |
| exit_forms | Exit interview forms | `questions` json |
| assets | Assets | tag `A0001`, `status` in_stock, issued, retired; `value_minor`; `history` json |
| handbook, handbook_versions, handbook_acks | Handbook pages, published versions, acknowledgements | a page keeps its draft and its published version |
| grievance_types, grievances | Grievances | number `G0001`; `anonymous`, `assignee`, `shared_with`, `agent_shared`, `notes` json |

Operations (78, groups `lifecycle`, `checklist-templates`, `checklists`,
`tasks`, `letter-templates`, `letters`, `separations`, `exit-forms`,
`assets`, `handbook`, `grievance-types`, `grievances`): 27 reads, 30 people
only, 18 proposals, 7 deletions. Your AI agent completes only the tasks
assigned to it, drafts letters, checklists, assets and handbook pages as
proposals, never issues or voids a letter, never requests, approves or
withdraws a separation, never reads exit interview answers, and reads a
grievance only when HR shared it. Subjects, descriptions, notes,
resolutions, reasons and exit interview answers are secret params (kept out
of the audit trail).

Triggers: `onboarding_help` (do the tasks assigned to your AI agent on a
checklist; asked by HR from the checklist or by giving it a task, and when a
checklist opens only if the company switched that on; never asked again on
its own) and `letter_draft` (write a letter HR asked for with
`letters.request-draft`). Recipes in `guide_lifecycle.js`.

Events emitted: `separation.approved { separation, employment, last_day, kind }`
(a subscriber may answer `{ payrun }`; it is kept as the settlement pay run),
`separation.changed { separation, employment, last_day, kind }`,
`checklist.completed { checklist, employment, kind }`. Subscribed:
`entity.created`, `employment.hired`, `employment.ended`,
`employment.changed`. Approval kind: `separation`. Cron:
`lifecycle_daily` (hourly; each entity's work runs once after 09:00 local).
