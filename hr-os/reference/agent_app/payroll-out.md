## Payroll out: bank files, journals, filings, year-end documents, reports, rule packs

What happens after a pay run is locked: the money leaves (a bank file a person uploads, cash and cheque lists), the books get a GL journal, the authorities get their filings on time, people get their year-end tax documents, and the rule packs that compute pay stay current. Built from locked runs only; nothing here changes a locked figure.

### Requirements

- [x] Bank payment files for a locked run: `generic_csv`, `nacha_ppd` (US ACH, PPD credits, 94-character records blocked to 10, entry hash, optional balancing offset), `aba` (AU direct entry, 120 characters, CRLF, optional self-balancing record), `sepa_pain001` (pain.001.001.03, SEPA, SALA), `bacs_csv`, `zengin` (全銀 給与/賞与振込, 120-byte JIS records, half-width katakana from the furigana), `sg_giro_csv`, `in_neft_csv`, `my_maybank_csv`, `my_cimb_txt`; layouts that are not a published standard say "check with your bank"
- [x] Validation per person before a file is written: routing check digit, BSB, IBAN length and mod 97, BIC, IFSC, sort code, account lengths, kana that has no bank form, zero pay; the problems name the person and the field (numbers masked)
- [x] Split pay across a person's approved accounts (fixed, percent, rest) and released salary holds
- [x] Exporting needs the PIN (people only); the file is stored with its SHA-256; downloads are audited; a run becomes paid only when a person confirms the upload with the bank's reference (or marks a cash, cheque or outside payment paid, PIN)
- [x] Cash and cheque lists with cheque numbers, who received their pay, and the notes and coins to draw; printable with a signature column
- [x] GL journal per run: debits and credits by the component's GL and liability accounts, by line code and payee, by cost centre and department, balanced per group; generic CSV, Xero manual journal CSV, QuickBooks journal CSV
- [x] Filings ledger per entity and period from the enabled packs, country data and HR OS's builtins: due days with weekend and holiday rules (US 941, 940, W-2, state quarterlies; UK FPS, EPS, PAYE, P60, P11D; AU STP, BAS, STP finalisation; JP 源泉 monthly or 納期の特例, 社会保険, 住民税, 算定基礎届, 年末調整, 源泉徴収票 and 給与支払報告書; SG CPF, IR8A; IN TDS, 24Q, Form 16, ECR, ESI; MY PCB, EPF, SOCSO, HRDF, EA, Form E), US 941 deposits monthly or semi-weekly next to the quarterly 941, AU payday super 7 days after each pay day; amounts from locked lines, worksheet and data file, submit with reference, accepted or rejected, not needed, amend when a later run changes the figures, a voided run's rows not needed (or amend when filed), built by itself (entity created, run locked or voided, hourly), reminders once a day
- [x] Year-end documents from locked runs: W-2 and W-3 data, P60, P45, P11D, 源泉徴収票 and 給与支払報告書 (by municipality), IR8A, Form 16 Part B, 24Q by quarter, EA and CP8D, Australian income statement; print pages, CSV data, issue to employees with the PIN (hashed snapshots they open in self-service)
- [x] Payroll reports: register, cost by entity, department or cost centre in the reporting currency, owed to each authority by payee and month, year to date per person, headcount and average pay
- [x] Rule packs: list by country, steps, tables, fields and vectors run live, drafts shown as a diff against the active version, activation with the PIN only when every vector passes, monthly checks of official sources by your AI agent

### Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| payout_settings | Per entity: bank file format, employer bank details per format, file options, GL accounts, journal layout, filing preferences | one row per entity |
| bank_files | A written bank file of a run | protected file, `hash` (SHA-256), `items` with masked accounts only, status exported, uploaded, superseded, void, `reference` |
| payout_lists | Cash and cheque lists of a run | cheque numbers, received |
| journal_exports | A GL journal file of a run | balanced `lines` |
| filings | The statutory ledger | unique (entity, kind, period); `due_day`, `due_manual`, status todo, prepared, submitted, accepted, rejected, not_needed, amend; `worksheet`, data file, `reference` |
| yearend_docs | Year-end documents issued to employees | `data` snapshot, `hash`, issued or withdrawn |

### Operations (51)

- Pay-out: `payout.overview`, `payout.run`, `payout.formats`, `payout.settings`, `payout.settings-set` (people), `payout.list`, `payout.list-set` (people), `payout.confirm-upload` (PIN, people), `payout.mark-paid` (PIN, people); `bankfiles.export` (PIN, people), `bankfiles.download` (people), `bankfiles.list`, `bankfiles.void` (people)
- Journal: `journal.preview`, `journal.export` (people), `journal.download` (people), `journal.accounts`, `journal.accounts-set` (proposal)
- Filings: `filings.list`, `filings.get`, `filings.generate`, `filings.prepare`, `filings.submit`, `filings.result`, `filings.skip`, `filings.reopen` (those four people only), `filings.set-due` (proposal), `filings.download` (people), `filings.calendar`
- Year end: `yearend.overview`, `yearend.document`, `yearend.csv` (people), `yearend.issue` and `yearend.withdraw` (PIN, people), `yearend.issued`, `yearend.mine`, `yearend.view`
- Reports: `payreports.register`, `payreports.cost`, `payreports.remittance`, `payreports.ytd`, `payreports.headcount`
- Rule packs: `packs.list` (compact; `--in-use`, default for your AI agent, and `--country`), `packs.get`, `packs.test`, `packs.activate` and `packs.retire` (PIN, people), `packs.draft` (proposal), `packs.discard` (people), `packs.ask-update`, `packs.check-updates`

### Your AI agent

Reads everything here when the company lets it see pay (`agent_sees_pay`). Explains bank file problems, prepares filing worksheets, proposes GL accounts and due days, drafts rule pack updates (`pack_update_draft` when a person asks on a pack, `rule_update_check` for one pack in use a day when the company switched the monthly checks on; `packs.checked` when nothing is drafted). Never writes or downloads bank files, confirms uploads, marks runs paid, submits filings, issues documents, exports CSV, or activates packs.

### Events

Subscribes to `entity.created` (kernel) and `payrun.locked`, `payrun.voided`, `payrun.paid` (payroll-core) to build and refresh the ledger at once; the hourly cron does the rest.
