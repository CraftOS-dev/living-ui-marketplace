# Plain-text accounting and open-source / self-hosted double-entry bookkeeping tools (2025-2026): data models, rigor, import and rules, reconciliation, reports, UI, and AI-agent integrations

Research date: 2026-10-28. Method note: the session's web-search budget ran out early, so almost all evidence below comes from **primary sources fetched directly**: official docs, manuals, GitHub source trees and READMEs, and the GitHub and PyPI APIs. Community opinion (Reddit, HN) could **not** be gathered, so it is listed as a gap. Fava keyboard shortcuts and colors were read from Fava's frontend source code (main branch).

---

## 1. Data model: accounts, transactions/postings, assertions, pad, tags/links/metadata, documents, commodities/prices/lots, opening balances, amount storage

### Takeaway
The plain-text tools (Beancount, hledger, Ledger) use the cleanest model for a rigorous app. Accounts are colon-separated trees under five root types. A transaction is a header (date, flag, payee, narration, tags, links, metadata) plus N postings that must sum to zero per currency. Dated **balance assertions** act as checkpoints, and decimal amounts are exact, with tolerance inferred from the precision the user typed. The GUI and self-hosted apps (Firefly III, Actual, Manager.io, Frappe Books) put friendlier abstractions on top: source/destination accounts, payees, categories, "receipts/payments", tax templates. These usually give up generality in exchange: no multi-leg sources in Firefly III, no multi-currency in Actual, and a single company currency in Frappe Books.

### Cited Findings

**Version snapshot (as of Oct 2026)**
- Beancount v3: 3.0.0 was released on PyPI on 2024-06-22, and the latest is 3.2.3 (2026-05-05). Beangulp (importer framework) is at 0.2.0 (2025-01-20) and beanquery at 0.2.0 (2025-03-24). — [PyPI beancount](https://pypi.org/project/beancount/); [PyPI beangulp](https://pypi.org/project/beangulp/); [PyPI beanquery](https://pypi.org/project/beanquery/)
- Fava v1.30 (2024-12-29) added Beancount v3 support. Query support moved to the `beanquery` package, which has "minor differences in syntax, the provided columns and functions", and v3 importers use beangulp. Fava v1.30.13 (2026-05-19) "drops support for Beancount version 2", so importers must use beangulp. The latest tag is v1.30.16 (PyPI 2026-08-18). — [Fava CHANGES](https://github.com/beancount/fava/blob/main/CHANGES); [PyPI fava](https://pypi.org/project/fava/)
- The "Beancount Vnext" design doc (Martin Blais, July 2020) planned a C++ core emitting protobuf directives and the split of query and ingest into separate projects. It is a design doc, not release notes. I found no primary confirmation that the C++ core shipped in 3.x. — [Beancount Vnext: Goals & Design](https://beancount.github.io/docs/beancount_v3/)
- hledger manual version 1.52 (stable); the dev manual is labelled 1.99. — [hledger manual](https://hledger.org/hledger.html)
- Ledger v3.4.1 (2025-10-26). — [ledger releases](https://github.com/ledger/ledger/releases)
- GnuCash 5.17 (2026-09-27). — [GnuCash releases](https://github.com/Gnucash/gnucash/releases)
- Firefly III latest stable is v6.7.9 (2026-10-11), with develop builds published almost daily. — [firefly-iii releases](https://github.com/firefly-iii/firefly-iii/releases)
- Actual v26.10.0 (2026-10-02), about 29.8k GitHub stars. — [actualbudget/actual](https://github.com/actualbudget/actual)
- Akaunting 3.3.0 (2026-10-27). — [akaunting releases](https://github.com/akaunting/akaunting/releases)
- Frappe Books: the Electron/Vue desktop repo `frappe/books` (last release v0.36.0, 2025-11-06) is **archived**. Its README says it "has reached its end of life and is superseded by [Frappe Books](https://github.com/frappe/frappe-books)", which is a Frappe Framework app (v16.0.1, 2026-10-26). — [frappe/books README](https://github.com/frappe/books); [frappe/frappe-books](https://github.com/frappe/frappe-books)
- New Frappe Books installs on a Frappe site ("Your team then signs in to that site from a browser… There is no file to download and no .db file to keep"). It runs on MariaDB 11.8, PostgreSQL 18 or SQLite 3. — [Frappe Books installation](https://docs.frappe.io/books/installation)

**Beancount (v3) directives and model**
- Directives: `open` (with optional constraint currencies and booking method), `close`, `commodity` (with metadata such as `name:` and `asset-class:`), transactions, `balance`, `pad`, `note`, `document`, `price`, `event`, `query`, `custom`. Syntax: `YYYY-MM-DD open Account [Currency,...] ["BookingMethod"]`. — [Beancount Language Syntax](https://beancount.github.io/docs/beancount_language_syntax/)
- Account names have five roots (Assets, Liabilities, Equity, Income, Expenses), with colon-separated components starting with a capital letter or number. Currencies are 2-24 characters (capitals and digits plus `.`, `_`, `-`, `'`). Dates are ISO 8601. — [Beancount Language Syntax](https://beancount.github.io/docs/beancount_language_syntax/)
- Transaction flags: `*` means completed and `!` means incomplete; other flags are user-defined. Tags `#tag` and links `^link` group transactions, and `pushtag`/`poptag` apply tags to a block. Metadata `key: value` can attach to directives and postings; values may be strings, accounts, currencies, dates, tags, numbers or amounts; every directive automatically carries `filename` and `lineno`. — [Beancount Language Syntax](https://beancount.github.io/docs/beancount_language_syntax/)
- The posting "weight" (balancing) rules are:
  - amount only: the amount itself;
  - price only: units × price currency;
  - cost only: units × cost currency;
  - cost + price: the price is ignored and the cost is used.
  The weights must sum to zero across all currencies. One posting's amount may be omitted and interpolated. Amounts may contain arithmetic `( ) * / - +`. — [Beancount Language Syntax](https://beancount.github.io/docs/beancount_language_syntax/)
- Lots: cost `{…}` versus price `@`/`@@`. Booking methods include STRICT (the default; requires an unambiguous match), NONE, and FIFO/LIFO. You cannot hold negative units of a cost-basis commodity unless the whole position is negative. — [Beancount Language Syntax](https://beancount.github.io/docs/beancount_language_syntax/)
- `balance` is checked at the **beginning** of its date, before that day's transactions. It checks one commodity, aggregates all lots, and parent accounts include child balances. A local tolerance can be given as `balance Account Amount ~ tolerance`. — [Beancount Language Syntax](https://beancount.github.io/docs/beancount_language_syntax/)
- `pad Account EquityAccount` auto-inserts the transaction that fills the gap up to the next balance assertion; an unused pad is an error. — [Beancount Language Syntax](https://beancount.github.io/docs/beancount_language_syntax/)
- `option "documents" "<dir>"` points at a directory tree that mirrors account names. Files prefixed `YYYY-MM-DD` are automatically turned into Document entries. — [Beancount Language Syntax](https://beancount.github.io/docs/beancount_language_syntax/); [Fava help: features](https://github.com/beancount/fava/blob/main/src/fava/help/features.md)
- `operating_currency` affects display only. `plugin` loads Python transforms, and `include` splits files. — [Beancount Language Syntax](https://beancount.github.io/docs/beancount_language_syntax/)
- Numeric storage is exact decimal: "We do not use floating-point numbers… to allow us to perform exact sums without any rounding error". — [Beancount Precision & Tolerances](https://beancount.github.io/docs/precision_tolerances/)
- Tolerance is inferred **per currency from the input digits**, as half of the last digit: 2 decimals for USD gives 0.005 USD. With mixed precisions in one transaction, the coarsest wins. Integer amounts do **not** infer a 0.5 tolerance. — [Beancount Precision & Tolerances](https://beancount.github.io/docs/precision_tolerances/)
- Related options:
  - `option "inferred_tolerance_default" "USD:0.003"` (or `"*:0.001"`) applies only when no tolerance can be inferred;
  - a multiplier option overrides the default 0.5;
  - postings at cost or price can expand the tolerance (for example, `2.345 RGAGX {45.00 USD}` implies 0.045 USD).
  — [Beancount Precision & Tolerances](https://beancount.github.io/docs/precision_tolerances/)
- Balance assertions infer a tolerance of 1 unit of the least significant digit written in the assertion. — [Beancount Precision & Tolerances](https://beancount.github.io/docs/precision_tolerances/)
- Core plugins named in the Vnext plan, which define what "pedantic" checking means: `auto_accounts`, `check_closing`, `check_commodity`, `close_tree`, `coherent_cost`, `currency_accounts`, `implicit_prices`, `leafonly`, `noduplicates`, `nounused`, `onecommodity`, `sellgains`, `unique_prices`. — [Beancount Vnext](https://beancount.github.io/docs/beancount_v3/)

**hledger**
- Status marks are unmarked, `!` pending and `*` cleared. They work at transaction or posting level, and can be filtered with `-U/-P/-C` or `status:`, `status:!`, `status:*`. Ledger calls "unmarked" "uncleared". — [hledger manual: Status](https://hledger.org/hledger.html)
- Balance assertions (`= AMT` after a posting) are checked in **date order** (parse order within a day), which differs from Ledger's parse-order checking.
  - `=` is single-commodity and subaccount-exclusive.
  - `==` is a "sole commodity" assertion: no other commodities may be present.
  - `=*` and `==*` include subaccounts.
  - Assertions ignore status filters and compare exact amounts, not display precision.
  - `-I` disables them.
  — [hledger manual: Balance assertions](https://hledger.org/hledger.html)
- Balance **assignments** are a posting with no amount plus `= $409.32`; the amount is computed. They are used for opening balances or for "adjust to reality" entries. — [hledger manual: Balance assignments](https://hledger.org/hledger.html)
- Costs are written `@`/`@@`. The manual notes significant limitations in lot tracking. The `commodity $1,000.00` directive sets display style; precision is otherwise inferred from journal amounts. — [hledger manual](https://hledger.org/hledger.html)

**Ledger CLI**
- State: uncleared (the default), `*` cleared, `!` pending. "What these mean is entirely up to you": the author uses cleared for "reconciled" and pending for "in the middle of a reconciliation". — [Ledger 3 manual §5.5](https://ledger-cli.org/doc/ledger3.html)
- Virtual postings: `(Account)` is unbalanced and excluded with `--real`; `[Account]` must balance against other bracketed postings. — [Ledger 3 manual §5.8](https://ledger-cli.org/doc/ledger3.html)
- Balance assertion `Assets:Cash $-20.00 = $500.00` checks a single commodity only. The special value `= 0` asserts the account is empty across all commodities. A balance assignment `Assets:Cash = $500.00` computes the posting amount. — [Ledger 3 manual §5.10](https://ledger-cli.org/doc/ledger3.html)
- Lot annotations: price `{$50.00}`, date `[2012-04-10]` and note `(…)`, revealed with `--lots`. — [Ledger 3 manual §5.20-5.21](https://ledger-cli.org/doc/ledger3.html)

**GnuCash**
- Reconciliation status lives per split in the register R field: `n` (new / not reconciled), `c` (cleared) and `y` (reconciled). The account window footer shows cleared, reconciled and total balances. — [GnuCash Guide §4.4](https://code.gnucash.org/docs/C/gnucash-guide/txns-reconcile1.html)

**Firefly III (v6)**
- Every transaction has a source and a destination account. Account types are asset (default / shared / savings / cash wallet / credit card), expense, revenue, cash, and liabilities (loan / debt / mortgage). "Firefly III does not use liability accounts for credit cards." — [Firefly III account types](https://docs.firefly-iii.org/references/firefly-iii/account-types/)
- Storage: each "journal" contains two "transactions" (−250 from bank, +250 to Amazon), so the transaction count is always twice the journal count. — [Firefly III transactions](https://docs.firefly-iii.org/explanation/financial-concepts/transactions/)
- Split constraints:
  - withdrawals can split only the destinations;
  - deposits must end in one asset account;
  - transfer splits must share source and destination.
  — [Firefly III transactions](https://docs.firefly-iii.org/explanation/financial-concepts/transactions/)
- Opening balance is a dated transaction from an auto-created "opening balance account". Its date matters: "the balance of the account before the opening balance is zero". — [Firefly III accounts](https://docs.firefly-iii.org/explanation/financial-concepts/accounts/); [transaction types](https://docs.firefly-iii.org/references/firefly-iii/transaction-types/)
- Special transaction types are opening balance, reconciliation (stores the difference) and liability credit (start debt). — [Firefly III transaction types](https://docs.firefly-iii.org/references/firefly-iii/transaction-types/)
- Currencies: up to 8 decimals ("you will not be able to add cryptocurrencies" in some cases), each with a symbol, code and name. Asset accounts have one main currency. A transaction in a foreign currency, and a cross-currency transfer, require **both** amounts. Each administration has a primary currency. — [Firefly III currencies (explanation)](https://docs.firefly-iii.org/explanation/financial-concepts/currencies/); [How to use currencies](https://docs.firefly-iii.org/how-to/firefly-iii/features/currencies/)
- A "virtual balance" is always added to the actual balance, for example a credit limit. — [Firefly III accounts](https://docs.firefly-iii.org/explanation/financial-concepts/accounts/)

**Actual Budget (reference; not double-entry)**
- Amounts are integers, "the value multiplied by 100, whatever the currency. For example, $120.30 is 12030 and ¥1,500 is 150000". — [Actual API reference](https://actualbudget.org/docs/api/reference)
- Transaction fields include `imported_id`, `imported_payee`, `transfer_id` (pointing at the other side of a transfer), `cleared`, and split children via `is_parent: true` + `subtransactions`. — [Actual API reference](https://actualbudget.org/docs/api/reference)
- "The Actual Budget software is currency agnostic and does not support multi-currency". The workaround is experimental rule-template FX rules. — [Actual multi-currency](https://actualbudget.org/docs/budgeting/multi-currency)

**Manager.io**
- The Chart of Accounts has a left side (balance sheet accounts and groups) and a right side (P&L accounts and groups). Subtotals ("New Total"), such as Gross Profit or Operating Profit, build a multi-step P&L. — [Manager guide: Chart of Accounts](https://www.manager.io/guides/chart-of-accounts)
- Control accounts / subsidiary ledgers: special accounts sit under a control account (customizable). — [Manager guide: Special Accounts](https://www.manager.io/guides/special-accounts)
- Starting Balances is a dedicated Settings screen with sub-forms for bank/cash, balance sheet accounts, sales and purchase invoices, fixed assets, investments, inventory, employees, capital accounts and exchange rates. It is offered as an alternative to one long opening journal entry. — [Manager guide: Starting Balances](https://www.manager.io/guides/starting-balances)

**Frappe Books (new, Frappe Framework)**
- There are Ledger accounts (posting) and Group accounts (folders). Balances display with a Dr/Cr suffix ("1,000.00 Dr"). The standard chart has five roots: Application of Funds (Assets), Source of Funds (Liabilities), Equity, Income and Expenses. Each root is debit-normal or credit-normal. — [Frappe Books Chart of Accounts](https://docs.frappe.io/books/chart-of-accounts)
- Opening balances are a single Journal Entry of type "Opening Entry", balanced against "Opening Balance Equity". — [Frappe Books Setup Opening Balances](https://docs.frappe.io/books/setup-opening-balances)

### Inferences
- Recommended core schema for our app:
  - `accounts`: a path such as `Assets:Bank:Checking`, a root type, open/close dates, allowed commodities, and an optional booking method;
  - `transactions`: date, flag/status, payee, narration, tags[], links[], meta JSON, source/import fingerprint;
  - `postings`: account, units (decimal), commodity, optional cost/price, per-posting status and meta;
  - `balance_assertions`: date, account, amount, commodity, tolerance, include_subaccounts;
  - `prices`;
  - `documents`, linked to a transaction or an account.
  
  This mirrors Beancount and keeps every GUI concept (payee, category, transfer) expressible as postings.
- Amount storage: store exact decimals, as a decimal string or as integer minor units plus a `commodities.precision` column. Actual's fixed ×100 multiplier (even for ¥) and Firefly's 8-decimal cap are known limitations to avoid.
- Validate balancing per currency with a Beancount-style inferred tolerance (half of the least significant digit), not a global epsilon.
- Treat Beancount's semantics as the reference for assertions: checked at start of day, subaccount-inclusive, per commodity. Offer hledger's `==` "sole commodity" variant for multi-currency accounts.
- Opening balances: support both a dedicated "starting balances" form (Manager.io, Frappe "Opening Entry") and a `pad`-like / balance-assignment mechanism (Beancount `pad`, hledger/Ledger `=`). An AI agent can then establish balances from a statement without hand-computing the difference.
- Keep links (`^invoice-123`) and tags as first-class fields. Fava, hledger and Firefly III all filter by them, and they are how an agent can group an invoice, its payment and its refund.

### Gaps
- No authoritative "what's new in Beancount 3" changelog was retrieved. Exactly what 3.x changed at the core level (versus the Vnext plan) is unverified, beyond the ecosystem moves to beanquery/beangulp and Fava dropping v2.
- Beancount's HIFO/AVERAGE booking methods and the exact `pad` failure messages were not confirmed from the fetched text, which named STRICT/NONE/FIFO/LIFO.
- Manager.io's internal amount precision and storage were not documented in the fetched guides.

---

## 2. Validation rules and error presentation

### Takeaway
The plain-text tools validate the whole ledger on every load. Beyond parse errors, they check that transactions balance, that assertions pass, and optionally (strict/pedantic) that accounts, commodities and payees were declared and accounts were open. Fava then lists every error in a sortable File / Line / Error table whose cells link back to source. The GUI apps instead block bad input at the form: Frappe Books refuses an unbalanced journal, Firefly III enforces typed source/destination accounts, and Manager.io enforces lock dates.

### Cited Findings
- **hledger** always checks parseable syntax, balanced transactions and passing balance assertions.
  - `-s/--strict` adds: all accounts declared, all commodities declared, and all commodity conversions declared explicitly.
  - `hledger check` runs individual checks: accounts, commodities, ordereddates, payees, uniqueleafnames, and more.
  — [hledger manual: Strict mode / check](https://hledger.org/hledger.html)
- **Ledger** `--strict` warns on undeclared accounts, for example `Warning: "…Master.dat", line 6: Unknown account 'Liabilities:Tithe Owed'`. `--pedantic` makes this stricter, and `tag` pre-declarations only matter under these flags. — [Ledger 3 manual §4.6](https://ledger-cli.org/doc/ledger3.html)
- **Beancount**:
  - postings must sum to zero per currency within the inferred tolerance;
  - a `close` prevents future postings;
  - unused `pad` directives trigger errors;
  - balance assertions are checked at the start of their date.
  — [Beancount Language Syntax](https://beancount.github.io/docs/beancount_language_syntax/); [Precision & Tolerances](https://beancount.github.io/docs/precision_tolerances/)
- **Fava's Errors page** is a sortable table with columns File, Line and Error. The line number links to the source ("Show source %(file)s:%(lineno)s"), and account names in error messages become links to the account page. The source is `frontend/src/reports/errors/Errors.svelte`. — [Fava Errors.svelte](https://github.com/beancount/fava/blob/main/frontend/src/reports/errors/Errors.svelte)
- Fava "up-to-date indicators" appear next to accounts whose `open` has `fava-uptodate-indication: TRUE`:
  - green: the last entry is a passing balance check;
  - red: the last entry is a failing balance check;
  - yellow: the last entry is not a balance check;
  - grey dot: not updated within `uptodate-indicator-grey-lookback-days`.
  — [Fava help: features](https://github.com/beancount/fava/blob/main/src/fava/help/features.md)
- **Frappe Books** journal-entry rules: each row has a debit or a credit but not both; amounts are not negative; total debits equal total credits. "If the entry does not obey a rule, Frappe Books shows an error and does not save the entry." When a row is added it is pre-filled with the balancing amount. — [Frappe Books Journal Entries](https://docs.frappe.io/books/journal-entries)
- **Firefly III** rejects duplicate IBANs or account numbers across asset accounts; expense and revenue accounts may share one. — [Firefly III accounts](https://docs.firefly-iii.org/explanation/financial-concepts/accounts/)
- **Firefly III** rule actions can fail silently. "Firefly III does not report this in the user interface because rules are often executed asynchronously"; errors go to logs or to Slack/Discord notifications. — [Firefly III rules](https://docs.firefly-iii.org/how-to/firefly-iii/features/rules/)
- **Manager.io** lock date: when enabled, it "prevents editing, deleting, or adding transactions dated on or before the lock date". Small adjustments that do not alter financial statement numbers are still allowed. — [Manager guide: Lock Date](https://www.manager.io/guides/lock-date-form)
- **Actual**: editing a locked (reconciled) transaction shows a warning that must be confirmed; the transaction stays locked after the edit. — [Actual Reconciliation](https://actualbudget.org/docs/accounts/reconciliation)

### Inferences
- Implement validation in two layers:
  1. **Hard invariants on write**: per-currency zero-sum, no postings to closed accounts, dates within the lock date. Reject them like Frappe Books does.
  2. **Ledger-wide checks run continuously**: assertion failures, unused pads, undeclared commodities, duplicates (Beancount `noduplicates`), unordered dates. Surface them in a Fava-style Errors view: sortable, deep-linked to the entry, with a badge count in the sidebar.
- Per-account "freshness" dots (Fava's green/red/yellow/grey) are a cheap, high-value health signal. They also tell an AI agent which accounts need a statement import or assertion next.
- Never let rule or automation failures be silent, which is Firefly III's documented weakness. Log every agent and rule action with a result.

### Gaps
- Fava's sidebar error badge is not documented in the fetched help. It is probably present (the "Errors" link), but I did not confirm the exact UI from source.
- GnuCash's "read-only threshold" (days) book option, a period lock, was not verified from fetched docs.

---

## 3. Import pipelines, rule engines, and de-duplication

### Takeaway
Two families exist:
- **Code/config-driven importers** that emit candidate entries into a review step: Beancount's beangulp + Fava Import page, hledger CSV `.rules` files, Ledger `convert`.
- **GUI rule engines** applied on import: Firefly III triggers/actions with strict mode, Actual's staged rules with auto-learning, Manager.io bank rules, GnuCash's Bayesian matcher.

De-duplication spans a spectrum: exact source IDs (OFX FITID, `imported_id`, external_id), content hashes (Firefly III, Ledger UUID), and fuzzy date/amount/payee windows (beangulp ±2 days, Actual, GnuCash) through to hledger's deliberately simple "latest date seen" overlap detection.

### Cited Findings

**Beancount / beangulp / Fava import**
- The beangulp `Importer` ABC has these methods: `name`, `identify(filepath)`, `account(filepath)`, `date(filepath)`, `filename(filepath)`, `extract(filepath, existing)`, `deduplicate(entries, existing)` and `sort`. — [beangulp importer.py](https://github.com/beancount/beangulp/blob/master/beangulp/importer.py)
- The default `deduplicate()` compares each new entry with existing entries "dated within a 5 days window… (two days prior and two days past)" using `cmp()`. Duplicates are marked with metadata `__duplicate__`. `find_similar_entries(..., window_days=2)` is in `similar.py`. — [beangulp importer.py](https://github.com/beancount/beangulp/blob/master/beangulp/importer.py); [beangulp similar.py](https://github.com/beancount/beangulp/blob/master/beangulp/similar.py)
- Fava Import page workflow:
  - you upload files into `import-dirs`, configured with `custom "fava-option" "import-config" "my-import.py"`;
  - a matching importer shows an **Extract** button, which displays the extracted entries to "review, edit, or skip before saving";
  - unmatched files go to a collapsed "Non-importable Files" section;
  - **Move** files the statement into `<documents>/<account>/<name>`.
  — [Fava help: import](https://github.com/beancount/fava/blob/main/src/fava/help/import.md)
- Fava import details:
  - only Transaction, Balance and Note entries are supported;
  - `__source__` metadata displays the raw CSV row or XML fragment next to each entry and is stripped on save, as are all `_`-prefixed keys;
  - entries marked duplicate by `deduplicate()` show a pre-checked "ignore duplicate" box;
  - hooks have the signature `hook_fn(new_entries_list, existing_entries)` over 4-tuples `(filename, entries, account, importer)`.
  — [Fava help: import](https://github.com/beancount/fava/blob/main/src/fava/help/import.md)
- Unreleased Fava changes on main: the import dialog "now shows all extracted entries at once instead of one at a time and the entries can be grouped and saved group by group". v2-style 2-tuple hooks were removed. — [Fava CHANGES](https://github.com/beancount/fava/blob/main/CHANGES)
- **smart_importer** (v1.2, 2025-10-17) adds ML hooks `PredictPostings` and `PredictPayees` that train on existing entries. It "only works by appending onto incomplete single-legged postings (i.e. It will not work by modifying postings with accounts like 'Expenses:TODO')". — [smart_importer README](https://github.com/beancount/smart_importer); [PyPI smart-importer](https://pypi.org/project/smart-importer/)
- **beancount-import** (jbms, about 474 stars, v1.5.0 on 2026-10-14) features:
  - a web UI that walks through *pending* entries one by one;
  - unknown legs are `Expenses:FIXME`, predicted by a "learned classifier (currently decision tree-based)";
  - it matches and merges against both existing and other pending transactions, showing the journal lines to be added or removed per candidate.
  
  Its metadata records source IDs (to avoid re-import), marks *cleared* postings ("a cleared posting can only match an uncleared posting"), and feeds classifier training. — [beancount-import README](https://github.com/jbms/beancount-import); [PyPI](https://pypi.org/project/beancount-import/)

**hledger CSV rules**
- Rules-file directives:
  - file and format: `source` (with glob; picks the newest match; may pipe through a cleaning command `source x.csv | script`), `archive`, `encoding`, `separator`, `decimal-mark`, `date-format`, `timezone`;
  - ordering: `newest-first`, `intra-day-reversed`;
  - mapping: `skip`, `fields`, field assignments;
  - conditionals: `if` blocks, `if` tables, `skip`/`end` inside an if;
  - other: `balance-type`, `include`.
  — [hledger manual: CSV rules cheatsheet](https://hledger.org/hledger.html)
- `if` block matching:
  - matchers on separate lines are **OR**ed;
  - lines starting `&` / `&&` are **AND**ed; `& !` / `&& !` means AND NOT (1.41/1.42);
  - since 1.42 they can be combined on one line, e.g. `%description amazon && %date 2025-01-01`;
  - a whole-record matcher is a case-insensitive regex over a reconstructed comma-joined record;
  - a field matcher uses `%3` or `%description`;
  - `!` negates (since 1.32);
  - match groups are available as `\1` in assignments (since 1.32).
  — [hledger manual: if block / Matchers](https://hledger.org/hledger.html)
- Example rules:
  ```
  if groceries
   account2 expenses:groceries
  if
  monthly service fee
  atm transaction fee
   account2 expenses:business:banking
   comment  XXX deductible ? check it
  ```
  — [hledger manual: if block](https://hledger.org/hledger.html)
- `if` tables are compact: `if,HLEDGERFIELD1,HLEDGERFIELD2` followed by `MATCHER,VALUE1,VALUE2` rows. The first character after `if` is the separator. Later matching rows override earlier ones. — [hledger manual: if table](https://hledger.org/hledger.html)
- `hledger import` and dedup: it supports `--dry-run` and `--catchup`. "We don't call this 'deduplication', as it's generally not possible to reliably detect duplicates in bank CSV". Instead import "remembers the latest date processed previously in each CSV file (saving it in a hidden file), and skips any records prior to that date". This assumes stable file names, stable dates, stable same-date order, and newest items carrying the newest dates. — [hledger manual: import / Overlap detection](https://hledger.org/hledger.html)
- Auto postings (`= QUERY` rules, enabled with `--auto`) add postings to matching transactions. — [hledger manual: Auto postings](https://hledger.org/hledger.html)

**Ledger convert**
- `ledger convert download.csv --input-date-format "%m/%d/%Y" --invert --account Assets:MyBank --rich-data` expects a header line naming the fields (date, payee/desc, amount/credit/debit, code, note, …). With `--rich-data` it adds metadata `CSV:` (the original line), `Imported:` (the date) and `UUID:` (a checksum of the line). "If an entry with the same 'UUID' tag is already included in the normal ledger file… this entry will not be printed again." — [Ledger 3 manual §7.2.1.2](https://ledger-cli.org/doc/ledger3.html)
- Categorization in Ledger:
  - `payee Aldi` / `alias ^ALDI SUED SAGT DANKE` normalizes payees;
  - an `account Expenses:Food` block with `payee ^(Aldi|REWE)$` sub-directives sets the account;
  - `--auto-match` picks an account from the journal history.
  — [Ledger 3 manual §7.2.1.2](https://ledger-cli.org/doc/ledger3.html)

**GnuCash generic import matcher (QIF / OFX / CSV / MT940 / MT942 / DTAUS)**
- The matcher looks for existing transactions in the target account "within a predefined time window (~±42 days)". Match probability uses date, amount, transaction IDs, check numbers, description and memo. Unassigned transfer accounts default to an **Imbalance** account. — [GnuCash manual §6.16.7](https://code.gnucash.org/docs/C/gnucash-manual/trans-import.html)
- Per-row actions are checkboxes **A** (Add), **U+C** (Update existing + Clear) and **C** (Clear existing, don't import). An **Info** column shows a match-quality bar. Default background colors:
  - Gold: add, needs a transfer account;
  - Green: add with a matched account, or U+C, or C;
  - Brown: poor match, intervention required;
  - Blue: selected.
  
  Imported rows get status `c` (cleared). There are also "Append" and "Reconcile after match" options. — [GnuCash manual §6.16.7](https://code.gnucash.org/docs/C/gnucash-manual/trans-import.html)
- Preferences:
  - "Use Bayesian matching";
  - Match display threshold, Auto-add threshold (red zone) and Auto-clear threshold (green zone);
  - Likely match day threshold (default 4 days) and Unlikely match day threshold (default 14 days);
  - commercial ATM fee threshold;
  - "Enable update match action".
  — [GnuCash manual §10 Preferences](https://code.gnucash.org/docs/C/gnucash-manual/set-prefs.html)
- The Bayesian matcher keeps per-token weights per account. Before GnuCash 3.0, accounts were stored as name strings, so renames lost the learning. Low-weight tokens (1-2) are noise. Splitting only on spaces loses IDs like `123456/201501`. Adding weight bonuses caused false positives. — [GnuCash wiki: Bayes](https://wiki.gnucash.org/wiki/Bayes)

**Firefly III rule engine and data importer**
- Rules live in **rule groups**, ordered, and run when transactions are created or updated, or are applied manually to existing transactions (per rule or per group). "You cannot fire other rules from a rule", and rules cannot create transactions (use webhooks instead). — [Firefly III rules](https://docs.firefly-iii.org/how-to/firefly-iii/features/rules/)
- **Strict** means ALL triggers must match; non-strict means ANY. Any trigger can be inverted ("NOT"). There are three "stop processing" switches:
  - per rule: skip the remaining rules in the group;
  - per trigger: non-strict only; may lead to unpredictable results;
  - per action: skip later actions.
  
  Mixing AND/OR ("budget is Groceries and shop is A or B") "will not work". — [Firefly III rules](https://docs.firefly-iii.org/how-to/firefly-iii/features/rules/)
- Triggers:
  - text (starts / ends / contains / is) on description, notes, attachment name or notes;
  - properties: type, reconciled, has attachments / category / budget / subscription / tag / notes / external URL / external ID, IDs;
  - amount and foreign amount (more / less / exact), currency, foreign currency;
  - source or destination account ID / name / IBAN / number, or is cash;
  - meta: tag, SEPA CI, category, budget, subscription, external ID, internal reference, external URL;
  - nine date fields (transaction, interest, book, process, due, payment, invoice, created, updated) with on / before / after.
  
  Dates may be keywords (`today`, `start of this month`), relative (`-1y -6m`) or semi-specific patterns (`xxxx-xx-10`). Amounts must be written with dots. — [Firefly III rule triggers](https://docs.firefly-iii.org/references/firefly-iii/rule-triggers/)
- Actions:
  - set or clear category, budget and tags;
  - link a subscription or piggy bank;
  - set description or notes;
  - set source or destination, swap them, or use the cash account;
  - delete the transaction ("no undo");
  - convert between withdrawal, deposit and transfer, which may auto-create expense or revenue accounts.
  
  An **expression engine** allows computed values. — [Firefly III rule actions](https://docs.firefly-iii.org/references/firefly-iii/rule-actions/)
- The data importer is a separate tool for CSV, CAMT, GoCardless, SimpleFIN, Salt Edge and others. Its duplicate detection has two modes:
  - **Content-based**: Firefly hashes the submitted transaction array before rules/webhooks run. Editing a transaction later doesn't change the hash, but changing mappings or bank capitalization does.
  - **Identifier-based**: compares a chosen column such as external identifier, notes, description or internal reference.
  — [Firefly III duplicate detection](https://docs.firefly-iii.org/references/data-importer/duplicate-detection/); [Firefly III docs sitemap](https://docs.firefly-iii.org/sitemap.xml)

**Actual Budget**
- Rule conditions are is / is not, contains / does not contain, matches (regex), one of / not one of. They apply to imported payee, payee, account, category, date, notes, amount and cleared, and are case-insensitive.
- Rule actions set category, payee, notes (prepend/append), cleared, account, date or amount. There is an experimental formula / template mode.
- Rules run in stages **pre / default / post** and are auto-ranked from least to most specific ("contains" before "is"); the last rule wins.
- Renaming a payee offers to create a `pre`-stage rule. Categorizing creates or updates a `default`-stage rule from the most frequently used category for that payee. Learning can be disabled per payee or globally.

— [Actual Rules](https://actualbudget.org/docs/budgeting/rules/)
- Importing supports CSV, QIF, OFX, QFX and CAMT, plus bank sync (SimpleFIN, GoCardless, Pluggy.ai, and others). The CSV mapper has "Flip amount", "Split amount into separate inflow/outflow columns" and "Multiply amount" options. — [Actual Importing](https://actualbudget.org/docs/transactions/importing)
- Actual dedup:
  - an OFX id is checked first;
  - then it looks "around the same date, with the same amount, and with a similar payee";
  - it always favors the imported transaction, updating a manual entry's date to the bank date.
  — [Actual Importing](https://actualbudget.org/docs/transactions/importing)
- API: `importTransactions(accountId, txns, {defaultCleared, dryRun, reimportDeleted, payeeNameNormalization})` runs rules and dedups ("Transactions with the same imported_id will never be added more than once"). `addTransactions` is raw: "does not avoid duplicates". — [Actual API reference](https://actualbudget.org/docs/api/reference)
- **Conflict (reimportDeleted default):** the importing guide says the "Reimport deleted transactions" checkbox is checked by default for file imports. The API reference says "the file import UI defaults to false". — [Actual Importing](https://actualbudget.org/docs/transactions/importing); contradicted by [Actual API reference](https://actualbudget.org/docs/api/reference)
- Manual merging: select two equal-amount transactions and press **G**. The kept transaction is chosen as:
  1. bank-synced over others;
  2. then file-imported over others;
  3. then the earlier date.
  
  Empty fields are copied over from the dropped one. — [Actual Merging](https://actualbudget.org/docs/transactions/merging)

**Manager.io**
- Bank statement import accepts QIF, OFX, QFX, QBO, STA, SWI, 940, IIF, CAMT053 and CAMT052 ("most reliable"); CSV and XML are "less reliable"; PDF is not supported. Imports create Receipts or Payments. "To undo an import, use the History screen to reverse the changes." Duplicates "usually occur when banks change transaction dates between exports". — [Manager guide: Import bank statement](https://www.manager.io/guides/import-bank-statement)
- Bank rules are Payment Rules and Receipt Rules: "more detailed rules (with more conditions) are applied before general rules". Uncategorized imported items go to the **Suspense** account, with a yellow notice linking to Uncategorized Payments/Receipts. A payment/receipt pair can be converted into an inter-account transfer. — [Manager guide: Bank Rules](https://www.manager.io/guides/bank-rules); [Bank and Cash Accounts](https://www.manager.io/guides/bank-and-cash-accounts); [Inter Account Transfers](https://www.manager.io/guides/inter-account-transfers)

### Inferences
- Use a **staging queue** ("inbox") between parsing and posting, as Fava Extract, beancount-import and GnuCash's matcher all do. Each candidate carries its raw source line (`__source__` / `CSV:`), a fingerprint, a proposed categorization with confidence, and a proposed action. The action set is GnuCash's A / U+C / C vocabulary: add new, update+clear existing, mark existing cleared/skip.
- Unknown legs should go to a visible suspense account (`Expenses:Uncategorized`, Manager's Suspense, GnuCash's Imbalance) rather than being hidden. A counter badge drives the agent's to-do list.
- Use layered dedup:
  1. a stable external ID (OFX FITID, bank txn ID) as `imported_id`;
  2. a hash of the normalized source row (Ledger UUID, Firefly content hash);
  3. a fuzzy match on same amount ± a few days ± similar payee (beangulp ±2 days; GnuCash 4/14-day thresholds; Actual), shown to the user or agent as a "probable duplicate", never silently dropped.
  
  Store fingerprints even for deleted items, so "reimport deleted?" (Actual) is an explicit choice.
- For rules, combine Actual's **stages** (payee cleanup before categorization) and **auto-learn on categorize** with Firefly's explicit **strict (all) / any** switch and **stop processing**. Keep hledger's compact `if` table as an import format the agent can read and write. Avoid Firefly's limitations: no mixed AND/OR, silent failures.
- An AI agent should write *rules*, not just categorize individual transactions. Every categorization an agent makes could propose a reusable rule (Actual's auto-learn pattern), with a preview of the matching transactions (Actual's rule editor shows matches).

### Gaps
- Firefly III's data-importer configuration UI (roles and mapping screens) was not examined in detail.
- Manager.io's exact bank-rule condition syntax (contains / equals per field) was not in the fetched guide text.
- Accuracy numbers for smart_importer, beancount-import or GnuCash Bayes: none found.

---

## 4. Reconciliation workflows and transaction states

### Takeaway
All tools converge on the same model:
- three states per transaction or split: unmarked/new, cleared, reconciled (or locked);
- a reconcile session keyed by a **statement date and ending balance**, where users tick items until a **difference** reaches zero, then **finish/lock**;
- an escape hatch that posts an adjustment for an unexplained difference: GnuCash "Balance" to Orphan, Firefly III auto reconciliation transaction, Actual "Create reconciliation transaction".

Plain-text tools reconcile instead via **balance assertions plus `*`/`!` flags**.

### Cited Findings
- **GnuCash** reconcile flow:
  - Starting the reconcile: Actions → Reconcile asks for **Statement Date**, a non-editable **Starting Balance** (from the last reconciliation), an **Ending Balance** (pre-filled with the present balance; the user enters the statement's), **Include Sub-accounts** (same commodity only) and **Enter Interest Payment** (it can auto-open for bank, credit and other account types).
  - The reconcile window has two panes, **Funds In** and **Funds Out**, listing unreconciled items with an R checkbox. Keyboard: arrows, Space toggles, Tab switches panes, and Ctrl-A then Space toggles a whole pane.
  - A **Difference** field must reach 0.00. Then Finish sets R to `y`; Postpone keeps the ticks as `c`. The status bar shows e.g. "Cleared: USD 954.79 Reconciled: USD 0.00".
  - The **Balance** button posts the unexplained remainder to `Orphan-XXX`.
  - You cannot set `y` from the register; it requires the reconcile window. Editing pre-reconciliation transactions breaks the next starting balance.
  
  — [GnuCash Guide §4.4](https://code.gnucash.org/docs/C/gnucash-guide/txns-reconcile1.html)
- An Aug-2026 gnucash-user thread is titled "Reconcile Operation overrides User-entered Ending Balance". It suggests friction around the auto-filled ending balance. I did not read the thread body. — [gnucash-user 2026-08](https://lists.gnucash.org/pipermail/gnucash-user/2026-August/121376.html)
- **Firefly III** reconcile flow:
  - from an asset account, enter a start date and balance and an end date and balance;
  - the list shows the range "plus a few earlier and later dated transactions", and you tick matching items;
  - delete or edit return you to the reconcile page with ticks preserved;
  - the "Reconciliation options" amount is shown as <0 / >0 / =0;
  - "Store reconciliation" marks ticked items reconciled and can create an automated correction transaction (special type "Reconciliation").
  
  Rules can trigger on "transaction is reconciled", and search supports `reconciled:true`. — [Firefly III reconcile](https://docs.firefly-iii.org/how-to/firefly-iii/finances/reconcile/); [rule triggers](https://docs.firefly-iii.org/references/firefly-iii/rule-triggers/); [search](https://docs.firefly-iii.org/references/firefly-iii/search/)
- **Actual** reconcile flow:
  - each transaction has a cleared circle (gray = pending, green = cleared); clicking the account balance header reveals Cleared and Uncleared totals;
  - the 🔒 icon starts the reconciliation (hover shows the last reconciled date), defaulting to the cleared total, with "Use last synced total" for bank-sync accounts;
  - the difference updates live as you tick, then "All reconciled!" leads to **Lock transactions**;
  - unlocking a transaction reverts it to Cleared;
  - "Create reconciliation transaction" is also used to revalue off-budget assets (e.g. a house).
  
  Shortcut **L** toggles cleared on selected rows. — [Actual Reconciliation](https://actualbudget.org/docs/accounts/reconciliation); [Actual Tips & Tricks](https://actualbudget.org/docs/getting-started/tips-tricks)
- **Manager.io**:
  - the Bank Reconciliations tab lists Date, Bank account, **Statement balance**, **Discrepancy** (click a non-zero value to see the causing transactions) and Status (Reconciled / Not Reconciled);
  - receipts and payments carry a **cleared date**; without one they are *pending*;
  - the Bank & Cash list shows Cleared Balance, Pending Deposits, Pending Withdrawals and Uncategorized counts, where Actual balance = Cleared + Pending Deposits − Pending Withdrawals.
  
  — [Manager guide: Bank Reconciliations](https://www.manager.io/guides/bank-reconciliations); [Bank and Cash Accounts](https://www.manager.io/guides/bank-and-cash-accounts); [Payments](https://www.manager.io/guides/payments)
- **Plain text**:
  - hledger suggests uncleared = "recorded but not yet reconciled; needs review" and pending = "tentatively reconciled (if needed, eg during a big reconciliation)". Note that `=*` means *subaccount-inclusive*, not "cleared-only". hledger's balance assertions always consider postings of all statuses.
  - Ledger: cleared = "reconciled with my bank statement", pending = "in the middle of a reconciliation".
  - Beancount: `*` versus `!`, plus `balance` directives; Fava's up-to-date indicator shows whether the last entry is a passing balance check.
  
  — [hledger manual: Status, Assertions and status](https://hledger.org/hledger.html); [Ledger 3 manual §5.5](https://ledger-cli.org/doc/ledger3.html); [Fava help: features](https://github.com/beancount/fava/blob/main/src/fava/help/features.md)
- GnuCash's import matcher has "Reconcile after match", which starts reconciliation straight after an import. — [GnuCash manual §6.16.7](https://code.gnucash.org/docs/C/gnucash-manual/trans-import.html)

### Inferences
- Model reconciliation as a first-class record, as Manager does: `{account, statement_date, statement_balance, opening_balance, status, discrepancy, created_by}`. Linked postings get `reconciled_in = <id>`. When a session finishes, write a **balance assertion** at the statement date. The plain-text invariant then guards the reconciled history.
- States per posting: `unmarked → pending (!) → cleared (*) → reconciled/locked`. Show three running totals in the account header (cleared, uncleared/pending, total), which is the common pattern across GnuCash, Actual and Manager.
- Protect reconciled items: warn on edit (Actual) or refuse without an override (gnucash-mcp, section 9). Pair this with a global lock date (Manager).
- Offer the adjustment escape hatch explicitly: "post difference to Reconciliation Adjustments". Log it so the agent and user can audit later.
- For the AI agent, reconciliation is the natural verifiable checkpoint. The agent can propose ticks from statement lines, but the ending balance must come from a document, never be inferred. The difference must reach zero before lock.

### Gaps
- Akaunting's reconciliation screen was not fetched; Akaunting docs list a "Banking, Feeds, and Reconciliations" section but I didn't open a reconciliation page.
- Frappe Books bank reconciliation: I found no evidence of a reconciliation feature in the fetched docs.

---

## 5. Reports, filters, query languages, budgets and forecasts

### Takeaway
Fava sets the bar for exploratory reporting:
- Income Statement, Balance Sheet and Trial Balance as account trees with charts (bar, line, treemap, sunburst, icicle);
- a global time / account / advanced filter bar with rich syntax;
- interval and conversion switches;
- a SQL-like BQL query page with chart auto-detection and CSV/XLSX export.

hledger offers a composable query language (`acct:`, `desc:`, `tag:`, `amt:`, `status:`…) with forecasting and budgets from periodic rules. Budgets range from Fava's custom-directive budgets and Firefly III's per-period amounts to Actual's envelope (zero-sum) model.

### Cited Findings

**Fava**
- Report pages and shortcuts:
  - g i Income Statement, g b Balance Sheet, g t Trial Balance, g j Journal, g q Query;
  - g h Holdings, g c Commodities, g d Documents, g E Events, g s Statistics;
  - g e Editor, g n Import, g o Options, g H Help, g a account selector.
  — [Fava AsideContents.svelte](https://github.com/beancount/fava/blob/main/frontend/src/sidebar/AsideContents.svelte); [AccountSelector.svelte](https://github.com/beancount/fava/blob/main/frontend/src/sidebar/AccountSelector.svelte)
- Chart components in the frontend: BarChart, LineChart, ScatterPlot, Treemap, Sunburst, Icicle, and a ConversionAndInterval control. Conversion modes are `at_cost` (the default), `at_value` and `units`, or conversion to a specific currency. — [Fava charts dir](https://github.com/beancount/fava/tree/main/frontend/src/charts); [Fava stores/chart.ts](https://github.com/beancount/fava/blob/main/frontend/src/stores/chart.ts)
- Intervals are year, quarter, month, week and day, plus fiscal year. The unreleased version adds fiscal years and quarters as report intervals. — [Fava util/date.py](https://github.com/beancount/fava/blob/main/src/fava/util/date.py); [Fava CHANGES](https://github.com/beancount/fava/blob/main/CHANGES)
- The Income Statement page renders `ChartSwitcher` above two columns of `TreeTable`s. Chart labels include "Net Profit". — [IncomeStatement.svelte](https://github.com/beancount/fava/blob/main/frontend/src/reports/tree_reports/IncomeStatement.svelte); [Fava json_api.py](https://github.com/beancount/fava/blob/main/src/fava/json_api.py)
- **Time filter**:
  - forms: `2015`, `2012-Q1`, `2010-10`, `2016-W12` (ISO weeks), `2015-06-12`, `FY2018`, `FY2018-Q3`, and ranges such as `2010 - 2012-10`;
  - relative variables: `year`, `quarter`, `month`, `week`, `day`, `fiscal_year`, `fiscal_quarter`, with offsets (`month-10`, `year-1 - year`, `(month)-10` = the 10th of this month).
  
  Filtering applies Beancount "clamp" summarisation: prior Income/Expenses are rolled into `account_previous_earnings`, other prior activity into `account_previous_balances`, and within-period conversions are posted to `account_current_conversions`. — [Fava help: filters](https://github.com/beancount/fava/blob/main/src/fava/help/filters.md)
- **Account filter**: a full name, a component, or a regex. — [Fava help: filters](https://github.com/beancount/fava/blob/main/src/fava/help/filters.md)
- **Advanced filter**:
  - `#tag`, `^link`, amount comparisons `= 100.20` / `>= 100` (absolute units);
  - `payee:"restaurant"`, `narration:'…'`, any metadata such as `document:"\.pdf$"`;
  - a bare string searches payee + narration;
  - `-` negates, e.g. `-(^link #tag)`;
  - `any(…)` and `all(…)` work over postings, e.g. `any(account:"Cash$")`, `all(-account:"^Expenses:Food")`, `any(units > 80)`;
  - a space means AND, a comma means OR, and parentheses group;
  - matching is case-insensitive with Python regex.
  — [Fava help: filters](https://github.com/beancount/fava/blob/main/src/fava/help/filters.md)
- **Query page**: BQL via beanquery. A two-column result (date or string + inventory) automatically renders a line or treemap chart. Results export as CSV, or as xlsx/ods with `fava[excel]`. — [Fava help: features](https://github.com/beancount/fava/blob/main/src/fava/help/features.md); [Fava CHANGES](https://github.com/beancount/fava/blob/main/CHANGES)
- Example BQL:
  ```
  SELECT payee, SUM(COST(position)) AS balance WHERE account ~ 'Expenses' GROUP BY payee
  ```
  — [Fava help: features](https://github.com/beancount/fava/blob/main/src/fava/help/features.md)
- **Budgets**: `2014-02-10 custom "budget" Expenses:Groceries "monthly" 40.00 EUR`, with daily, weekly, monthly, quarterly or yearly periods. A budget is valid until superseded, is broken down to a daily rate, and is summed over any range. It appears in the Net Profit/Expenses charts and in the "Changes (monthly)" and "Balances (monthly)" reports. — [Fava help: budgets](https://github.com/beancount/fava/blob/main/src/fava/help/budgets.md)
- Sidebar links via `custom "fava-sidebar-link"`. The `/jump?time=month` handler and the new `/toggle?filter=-%23tag` handler support saved views. The `default-page` option and `fiscal-year-end` (e.g. `04-05` for the UK, `15-31` for Japan) are also available. — [Fava help: features](https://github.com/beancount/fava/blob/main/src/fava/help/features.md); [Fava help: options](https://github.com/beancount/fava/blob/main/src/fava/help/options.md)

**hledger**
- Query terms:
  - `acct:` (the default), `amt:` (signed vs absolute comparison depending on a leading +/-), `code:`, `cur:`, `desc:`;
  - `date:PERIODEXPR` (e.g. `date:2021-07-27..nextquarter`; may include a report interval since 1.52), `date2:`, `depth:[REGEX=]N`;
  - `note:` (right of `|`), `payee:` (left of `|`), `real:`, `status:`, `tag:`, `not:`, `expr:`.
  — [hledger manual: Query types](https://hledger.org/hledger.html)
- Periodic transactions `~ PERIOD` generate forecast transactions only with `--forecast`. They "begin only after the last non-forecasted transaction's date" and end 6 months from today by default. Inspect them with `hledger print --forecast tag:generated`. The same rules act as budget goals with `--budget`. — [hledger manual: Periodic transactions](https://hledger.org/hledger.html)

**Ledger**
- Ledger has budgeting and forecasting (manual chapter 9) via periodic transactions and period expressions. — [Ledger 3 manual §9](https://ledger-cli.org/doc/ledger3.html)

**Firefly III**
- Budgets attach only to withdrawals, with periods daily, weekly, monthly, quarterly, every half year or yearly (no bi-weekly). Overlapping amounts both get debited. Budgets count only a transaction's main currency, never the foreign amount. Income can't auto-fund budgets. Categories are "not monetized". — [Firefly III budgets](https://docs.firefly-iii.org/explanation/financial-concepts/budgets/)
- Search is AND-only, using `key:value` filters with `-` negation, e.g. `description_contains`, `type:withdrawal`, `reconciled:true`, `amount`, `more`, `less`, `currency_is:EUR`, `foreign_currency_is:USD`. — [Firefly III search](https://docs.firefly-iii.org/references/firefly-iii/search/)

**Actual**
- Envelope / zero-sum budgeting: categories act as envelopes. Over-budgeting is deducted from next month's available amount. "Hold for next month" supports the "month ahead" strategy. — [Actual Envelope Budgeting](https://actualbudget.org/docs/getting-started/envelope-budgeting)
- The budget view can render several months side by side. — [Actual Tips & Tricks](https://actualbudget.org/docs/getting-started/tips-tricks)
- Custom reports and an experimental Sankey report exist. — [Actual docs sitemap](https://actualbudget.org/sitemap.xml)

**Manager.io**
- Reports tab:
  - financial statements;
  - Trial Balance, General Ledger Summary and General Ledger Transactions;
  - many "Summary" reports: Tax, Customer, Supplier, Bank Account, Fixed Asset, Receipts & Payments, and others.
- "Advanced Queries" on any tabular screen offer Select / Where / Order by / Group by, saved as named queries.
- Balance sheet layouts can be chosen when generating reports.

— [Manager guide: Reports](https://www.manager.io/guides/reports); [Advanced Queries](https://www.manager.io/guides/advanced-queries); [Chart of Accounts](https://www.manager.io/guides/chart-of-accounts)

**Akaunting**
- Akaunting is accrual-based, with a "Cash" option in reports. — [Akaunting Accrual vs Cash](https://akaunting.com/hc/docs/frequently-asked-questions/accrual-vs-cash/)

### Inferences
- Adopt Fava's **global filter bar** (time | account | advanced) persisted in the URL, together with its relative-period grammar (`month`, `year-1 - year`, `FY2025-Q3`). It is compact, keyboard-friendly, and easy for an AI agent to emit as strings.
- Give the agent a **read-only query tool** that speaks a constrained SQL/BQL-like language over postings, with the result returned as JSON with exact decimal strings. This is the beanquery-mcp pattern, and a BQL fine-tuning dataset exists (section 9).
- Default Income Statement with time filtering should use "clamp" semantics: P&L starts at zero, balance-sheet accounts carry forward. That prevents a common bug in naive date filtering.
- Budgets: choose either Fava/hledger-style per-account periodic budgets, which fit double entry, or an envelope layer like Actual's. For a personal-plus-small-business app, per-account periodic budgets plus a forecast via recurring templates (hledger `~`) is simpler. Envelope budgeting can be layered later.

### Gaps
- BQL reference details (tables, columns, functions in beanquery 0.2) were not fetched.
- Firefly III reports and charts pages were not fetched; Firefly III piggy banks and subscriptions were not covered.
- Actual's "tracking budget" mode details were not fetched.

---

## 6. UI design: layout, navigation, keyboard shortcuts, density, debit/credit colors, account trees

### Takeaway
Fava and Actual are the strongest UI references for a keyboard-driven, dense, single-user app:
- Fava: left sidebar of reports with two-key "g x" shortcuts, a top filter bar, tree tables with balances, and charts on top;
- Actual: left sidebar with accounts and balances, an editable spreadsheet-like register with single-key bulk actions, a Ctrl+K command palette, and Ctrl+P privacy masking.

Manager.io uses a tabbed module list (Bank & Cash, Receipts, Payments, …) with configurable columns and saved queries. Frappe Books uses a collapsible chart-of-accounts tree with "Dr/Cr" suffixed balances. Color use is restrained: Fava colors only diffs and gains/losses (green/red, invertible), not debits versus credits.

### Cited Findings

**Fava**
- Sidebar shortcuts are listed in section 5. Further keys: `n` opens the new-transaction form (bookmarkable via `#add-transaction`); `?` shows the keyboard-shortcut overlay; `r` is bound in the header; filter focus is `f t` (time), `f a` (account) and `f f` (advanced filter). — [AsideContents.svelte](https://github.com/beancount/fava/blob/main/frontend/src/sidebar/AsideContents.svelte); [FilterForm.svelte](https://github.com/beancount/fava/blob/main/frontend/src/sidebar/FilterForm.svelte); [Header.svelte](https://github.com/beancount/fava/blob/main/frontend/src/sidebar/Header.svelte); [Fava help: features](https://github.com/beancount/fava/blob/main/src/fava/help/features.md)
- Journal toggles:
  - entry types: `s o` open, `s c` close, `s t` transaction, `s b` balance, `s n` note, `s d` document, `s p` pad, `s q` query, `s C` custom, `s B` budget;
  - transaction status: `t c` cleared `*`, `t p` pending `!`, `t o` other flags `x`;
  - documents: `d l` #linked documents;
  - `m` metadata, `p` postings.
  — [JournalFilters.svelte](https://github.com/beancount/fava/blob/main/frontend/src/reports/journal/JournalFilters.svelte)
- Charts: `c` / `C` cycle to the next or previous chart. Editor: Ctrl/Cmd+S saves, and the menu exposes Mod+D, Mod+/ and Ctrl+Alt+] / [. Query and Import submit with Ctrl/Cmd+Enter. — [ChartSwitcher.svelte](https://github.com/beancount/fava/blob/main/frontend/src/charts/ChartSwitcher.svelte); [SaveButton.svelte](https://github.com/beancount/fava/blob/main/frontend/src/editor/SaveButton.svelte); [EditorMenu.svelte](https://github.com/beancount/fava/blob/main/frontend/src/reports/editor/EditorMenu.svelte); [QueryEditor.svelte](https://github.com/beancount/fava/blob/main/frontend/src/reports/query/QueryEditor.svelte); [Extract.svelte](https://github.com/beancount/fava/blob/main/frontend/src/reports/import/Extract.svelte)
- Editor: a source editor with autocomplete for accounts, payees and tags, red highlighting of trailing whitespace, and an "Align Amounts" command. `currency-column` (default 61) aligns currencies. The `insert-entry` regex option controls where new entries are inserted. — [Fava help: features](https://github.com/beancount/fava/blob/main/src/fava/help/features.md); [Fava help: options](https://github.com/beancount/fava/blob/main/src/fava/help/options.md)
- Documents: drag a file onto an account name in a tree table (it highlights blue) to store it under `<documents>/<account>/` with a date prefix. Dropping onto a journal row adds `document:` metadata to the transaction. — [Fava help: features](https://github.com/beancount/fava/blob/main/src/fava/help/features.md)
- Colors:
  - CSS tokens are `--error: hsl(0 100% 30%)`, `--warning: hsl(52 84% 56%)`, `--green: hsl(151 100% 25%)`;
  - `--diff-positive` is green and `--diff-negative` red;
  - the option `invert-gains-losses-colors` swaps them;
  - `invert-income-liabilities-equity` flips the sign display of credit-normal accounts, because "In Beancount the Income, Liabilities and Equity accounts tend to have a negative balance".
  
  Dark mode is supported via `data-color-scheme`. — [Fava base CSS](https://github.com/beancount/fava/tree/main/frontend/css); [Fava help: options](https://github.com/beancount/fava/blob/main/src/fava/help/options.md)
- Account-tree trimming options are `show-closed-accounts` (default false), `show-accounts-with-zero-balance`, `show-accounts-with-zero-transactions` (default true) and `collapse-pattern`. The `locale` option controls number grouping (e.g. `en_IN` → `11,11,111.33`). Translations cover 18+ languages. — [Fava help: options](https://github.com/beancount/fava/blob/main/src/fava/help/options.md); [Fava help: features](https://github.com/beancount/fava/blob/main/src/fava/help/features.md)

**hledger-web**
- hledger-web "provides a more user-friendly UI than the hledger CLI or hledger-ui TUI, showing more at once (accounts, the current account register, balance charts) and allowing history-aware data entry, interactive searching, and bookmarking".
- Search is S or `/`.
- Modes are `--serve-browse` (default; auto-exits after 2 minutes idle), `--serve` and `--serve-api` (JSON API).
- `--allow=view|add|edit` sets the access level. There is no access control otherwise. It writes "a numbered backup of the main journal file… on every edit".

— [hledger-web manual 1.52](https://hledger.org/hledger-web.html)

**Actual**
- Layout: a left sidebar holding Budget, Reports and Schedules navigation and the account list grouped into on-budget and off-budget. Payees, Rules and Tags live under Settings and can be pinned. The top-right holds the privacy eye, notifications, sync, server status and help. — [Actual UI overview](https://actualbudget.org/docs/tour/user-interface)
- Shortcuts:
  - general: Ctrl/Cmd+K command palette (also jumps to accounts), `?` help, Ctrl+O switch budget, Ctrl+P privacy filter, Ctrl+Z / Ctrl+Shift+Z undo/redo;
  - budget page: Enter / Shift+Enter move between categories, `0` current month, ←/→ change month;
  - account page: Ctrl+B bank sync, Ctrl+I import, `T` new transaction, `F` filter or show selected;
  - selection: Ctrl+A, Space, Shift+Space range, J/K or arrows;
  - bulk actions on the selection: `E` date, `P` payee, `N` notes, `C` category, `M` amount, `L` cleared, `A` account, `S` schedule, `D` delete, `U` duplicate, `G` merge, `R` make transfer;
  - entry: Enter / Shift+Enter / Tab move, Ctrl+Enter adds and closes.
  — [Actual Tips & Tricks](https://actualbudget.org/docs/getting-started/tips-tricks)
- Other UX details: math in amount fields (`16.99*1.1`); a running-balance column (only when sorted by date descending); an optional view of multiple budget months side by side; the privacy filter is visual only and reveals on hover. — [Actual Tips & Tricks](https://actualbudget.org/docs/getting-started/tips-tricks)

**Manager.io**
- The module list is tabs: Bank and Cash Accounts, Receipts, Payments, Inter Account Transfers, Bank Reconciliations, Customers, Sales Invoices, … Fixed Assets, Journal Entries, Reports, Settings. Tabs must be enabled ("If the Bank & Cash Accounts tab is not visible, you need to enable it in your tab settings"). — [Manager guides index](https://www.manager.io/guides); [Bank and Cash Accounts](https://www.manager.io/guides/bank-and-cash-accounts)
- Every list screen has "Edit Columns" and an Advanced Queries dropdown next to search. Clickable numbers drill down: a balance shows its transactions, a discrepancy shows its causes, a tax code's count shows its transactions. — [Manager guide: Advanced Queries](https://www.manager.io/guides/advanced-queries); [Bank Reconciliations](https://www.manager.io/guides/bank-reconciliations); [Tax Codes](https://www.manager.io/guides/tax-codes)
- Batch operations exist as a guide topic. — [Manager guides index](https://www.manager.io/guides)

**Frappe Books**
- The chart of accounts is a tree with folder icons for groups and circles for ledgers, balances shown as "1,000.00 Dr", and Expand/Collapse all controls. Clicking a ledger opens a side panel; hovering over a group shows "…" with Add account / Add group. It is "not available on a phone". — [Frappe Books Chart of Accounts](https://docs.frappe.io/books/chart-of-accounts)

### Inferences
- The best fit for "full-window, flat, compact, near-monochrome" is:
  - a Fava-style left nav with mnemonic `g x` shortcuts;
  - an Actual-style dense editable register with single-key bulk actions and a Ctrl+K palette;
  - a Fava-style tree table for Balance Sheet / P&L with an optional treemap.
  
  Use color only for semantic state: red for errors and failed assertions, green for passed assertions and reconciled items, amber for pending. Use sign or Dr/Cr suffixes rather than red/green for debit versus credit. Fava and Frappe follow this restraint.
- Offer a display toggle like Fava's `invert-income-liabilities-equity` so credit-normal accounts show positive in reports, while storage keeps signed amounts.
- Clickable aggregates that drill to their constituent transactions (Manager) are a cheap but powerful pattern. They also map directly to agent tool calls ("explain this number").

### Gaps
- Firefly III UI layout (AdminLTE "v1" vs the newer "v2" layout, dashboard widgets), its keyboard support, and its color conventions were not verified from primary sources in this session.
- Akaunting UI (sidebar modules, dashboard widgets) was not examined beyond docs navigation (Sales → Invoices, Banking → Transactions, Double-Entry → Chart of Accounts / Manual Journals, Settings → Taxes).
- Manager.io's visual styling (density, colors) and its exact tab-customization UI were not available; the `tabs` guide slug returned 404.

---

## 7. Manager.io specifics (tabs, receipts/payments, transfers, reconciliations, tax codes, fixed assets, lock date, audit history)

### Takeaway
Manager.io is a "module per tab" double-entry system. Cash movement is captured as **Receipts** and **Payments** against Bank/Cash accounts, each with a cleared date, plus **Inter Account Transfers**. Imports create these documents and rules allocate them, with the remainder parked in **Suspense**. Reconciliations are statement-balance records with a computed discrepancy. Controls include a **Lock Date** and a full **History** audit log (user / type / action filters) that can reverse imports.

### Cited Findings
- Guide topics show the module breadth:
  - banking: bank-and-cash-accounts, receipts, payments, inter-account-transfers, bank-reconciliations, expense-claims;
  - sales: customers, sales quotes/orders/invoices, credit-notes, late-payment-fees, billable-time, withholding-tax-receipts, delivery-notes;
  - purchasing: suppliers, purchase quotes/orders/invoices, debit-notes, goods-receipts;
  - operations: projects, inventory (items/transfers/write-offs), production-orders, employees, payslips;
  - assets: investments, fixed-assets, depreciation-entries, intangible-assets, amortization-entries;
  - capital: capital-accounts, special-accounts;
  - general: folders, journal-entries, reports, settings;
  - settings topics: bank-rules, currencies, tax-codes, lock-date-form, recurring-transactions, forecasts, custom-fields, divisions, user-permissions, access-tokens, extensions, themes, starting-balances, advanced-queries, batch-operations, edit-columns, form-defaults.
  — [Manager guides index](https://www.manager.io/guides)
- Bank & Cash list columns: Cleared Balance ("sum of all Payments, Receipts, and Inter Account Transfers… marked as Cleared"), Pending Deposits, Pending Withdrawals, Uncategorized Payments/Receipts counts, and a yellow Suspense notice. — [Manager guide: Bank and Cash Accounts](https://www.manager.io/guides/bank-and-cash-accounts)
- Receipts and Payments: "Receipts without a cleared date are pending and help track deposits in transit"; "Payments without a cleared date are pending and help you track outstanding checks". — [Manager guide: Receipts](https://www.manager.io/guides/receipts); [Payments](https://www.manager.io/guides/payments)
- Inter Account Transfers: columns Date, Reference, Paid from, Received in, Description. A Payment/Receipt pair created by import can be converted into a transfer. — [Manager guide: Inter Account Transfers](https://www.manager.io/guides/inter-account-transfers)
- Bank Reconciliations: columns Date, Bank account, Statement balance, Discrepancy (drill-down), Status. — [Manager guide: Bank Reconciliations](https://www.manager.io/guides/bank-reconciliations)
- Tax Codes are defined under Settings with a rate or rate combination. The list shows a Transactions count with drill-down, and codes apply to invoices, receipts, payments and more. — [Manager guide: Tax Codes](https://www.manager.io/guides/tax-codes)
- Fixed Assets lifecycle:
  - create the asset (cost starts at zero);
  - allocate the purchase Payment or Purchase Invoice line to "Fixed assets — At cost" and select the asset;
  - on sale, allocate the sale to the same account, then mark the asset **Disposed** with a disposal date;
  - an automatic entry zeroes book value, posting the difference to "Fixed assets — Loss on disposal".
  
  Depreciation runs through Depreciation Entries. — [Manager guide: Fixed Assets](https://www.manager.io/guides/fixed-assets)
- Lock Date (Settings): a checkbox "Lock accounting periods" plus a date. It "prevents editing, deleting, or adding transactions dated on or before the lock date… Typically set to the last day of a completed accounting period after reconciliation and finalization". — [Manager guide: Lock Date](https://www.manager.io/guides/lock-date-form)
- History (top-right button) records "all modifications… who changed what and when". Each row has a View button showing exact values, with filters for User, Type and Action (Create / Update / Delete). It is included in backups by default and can be excluded to shrink them. Imports are undone through History. — [Manager guide: History](https://www.manager.io/guides/history); [Import bank statement](https://www.manager.io/guides/import-bank-statement)
- Currencies: base currency, foreign currencies and exchange rates under Settings, with exchange-rate starting balances. — [Manager guide: Currencies](https://www.manager.io/guides/currencies); [Starting Balances](https://www.manager.io/guides/starting-balances)

### Inferences
- Manager's **document-first** UX ("Receipt", "Payment", "Transfer" forms that generate postings) is friendlier for small-business users than raw postings, while remaining double-entry underneath. Our app could expose both: quick forms for receipt, payment and transfer, plus a raw journal-entry editor.
- The History pattern is the right audit design for an agent-operated app. Store an append-only change log of `{actor (user | agent), entity type, action, before, after, timestamp}` with filters and per-change view and revert. Make "undo this import / this agent session" a first-class operation.
- Combine the lock date with reconciliation: suggest setting the lock date to the last reconciled statement date.

### Gaps
- Manager.io's exact tax-code edit form (inclusive/exclusive, multi-rate components, tax-account mapping) and the depreciation methods were not in the fetched text.
- Manager.io's tabs/Summary customization and its desktop vs Cloud edition differences were not verified.

---

## 8. Akaunting and Frappe Books: invoicing, bills, tax rates, multi-currency

### Takeaway
- **Akaunting** (v3.3.0, Laravel, self-hosted or cloud) is invoice-centric. Its core is income/expense *transactions* with categories, invoices and bills. True double-entry (chart of accounts, manual journals, general ledger) is the paid **Double Entry app**, and taxes are typed (Normal / Inclusive / Compound / Fixed / Withholding).
- **Frappe Books** is now a Frappe Framework web app. The old Electron app is archived. It is strictly double-entry: group/ledger chart, Dr/Cr, submit-to-post documents, tax *templates* on items, and party-currency invoices with a single company currency for the books.

### Cited Findings
- Akaunting Chart of Accounts and Manual Journals: "You need to Install or Purchase the Double Entry App to use the Chart of Accounts feature" (the same applies to Manual Journals).
  - Account types: Bank & Cash, Current Asset, Depreciation, Fixed Asset, Inventory, Non-current Asset, Prepayment, Equity, Direct Costs, Expense, Other Income, Revenue, Sales, Current Liability, Liability, Non-current Liability.
  - Classes: Assets, Liabilities, Expenses, Income, Equity.
  
  A CoA import template has sheets chart_of_accounts, items, item_taxes and taxes. — [Akaunting: Creating a Chart of Accounts](https://akaunting.com/hc/docs/double-entry-accounting/creating-a-chart-of-accounts/)
- Akaunting manual journals have Date, Currency, Description, lines (Account, Note, Debit or Credit), Number, **Basis (Accrual or Cash)**, Reference and an uploaded document. "Creating a manual journal for a transaction may duplicate data in reports." — [Akaunting: Creating a New Manual Journal](https://akaunting.com/hc/docs/double-entry-accounting/creating-a-new-manual-journal/)
- Akaunting taxes (Settings → Taxes → New tax): Name, Rate (%) and Type, which is one of Compound, Fixed, Inclusive, Normal or Withholding. The docs give a worked compound-tax example. — [Akaunting: Selecting a Tax Type](https://akaunting.com/hc/docs/taxes-and-filing/selecting-a-tax-type/)
- Akaunting transactions: Banking → Transactions → New Income / New Expense, with fields Date, Payment method, Account, Amount, Category and Transaction number. A transaction can be **Connect**ed to an invoice or bill, with partial-payment split. — [Akaunting: Transactions](https://akaunting.com/hc/docs/banking-feeds-reconciliations/transactions/)
- Akaunting invoices (Sales → Invoices): customers require Name and **Payment Currency**. Invoices support line and global discounts (Settings → Localization → Discount Location), notes, footer, category and attachments. Recurring bills and split bill and invoice payments are documented. — [Akaunting: Creating an Invoice](https://akaunting.com/hc/docs/invoices-and-estimates/creating-an-invoice/); [Akaunting docs index](https://akaunting.com/hc/docs/)
- Akaunting is accrual by default, with a Cash option in reports. — [Akaunting: Accrual vs Cash](https://akaunting.com/hc/docs/frequently-asked-questions/accrual-vs-cash/)
- Frappe Books multi-currency:
  - invoices may be in the customer's or supplier's currency, but "All ledger entries, payments, and reports use the company currency" (chosen in the setup wizard and not changeable there);
  - the exchange rate is fetched for the invoice date from a public service, with a warning to enter it manually if unavailable;
  - the header shows e.g. `1 USD = 83.12 INR` with a swap button;
  - the rate is fixed once submitted.
  — [Frappe Books Multi Currency Invoicing](https://docs.frappe.io/books/multi-currency-invoicing)
- Frappe Books taxes: "A tax template has one or more tax rates and the accounts that get the tax. You set a tax template on each item", and per-row tax is computed from the row item's template. Only a Books Manager or System Manager can change templates. There are India-specific GST heads and GST reports. — [Frappe Books Taxes](https://docs.frappe.io/books/taxes); [Chart of Accounts](https://docs.frappe.io/books/chart-of-accounts)
- Frappe Books payments: types include Receive ("A customer pays you…"). Submitting a payment makes the ledger entries and reduces the outstanding amount on the settled invoices. — [Frappe Books Payments](https://docs.frappe.io/books/payments)
- Frappe Books journal entries: Save, then Submit (posting); Entry Type (e.g. Opening Entry) "does not change the ledger entries"; optional Reference Number/Date for outside documents. — [Frappe Books Journal Entries](https://docs.frappe.io/books/journal-entries)
- The Frappe Books Import Wizard takes CSV per import type (e.g. Sales Invoice, Item) or typed rows. It is restricted to the Books Manager or System Manager roles. — [Frappe Books Import Wizard](https://docs.frappe.io/books/import-wizard)
- Frappe docs pages expose "Copy page as Markdown for LLMs", "Open in ChatGPT" and "Open in Claude" actions. — [Frappe Books docs](https://docs.frappe.io/books/journal-entries)

### Inferences
- For our small-business mode, model tax as **tax codes/templates mapped to liability accounts**, with typed calculation (normal/exclusive, inclusive, compound, withholding). Apply them on invoice and bill lines and on receipts/payments, as Manager.io and Frappe do. The resulting postings must remain plain double-entry so reports and assertions still work.
- Multi-currency: Frappe's "documents in party currency, books in company currency, rate frozen at submit" is a simple, safe default. Beancount's per-commodity inventories and price directives are the more general option. A local single-user app could store postings in the original commodity plus an optional `@ price`, convert at report time (Fava's at_cost / at_value / units), and post realized FX gain/loss on settlement (gnucash-mcp does this automatically, section 9).
- Akaunting shows the risk of bolting double entry onto a transaction/category app: it warns that manual journals can duplicate report data. Our app should be double-entry at the core from day one.

### Gaps
- Akaunting's multi-currency details (exchange rates, account currency) and reconciliation page were not fetched.
- ERPNext accounting was not researched separately. Frappe Books now runs on Frappe Framework v16 like ERPNext, but I found no primary text comparing the two.
- Frappe Books bank reconciliation: not found.

---

## 9. What AI-tool developers do with these tools (LLM categorization, MCP servers)

### Takeaway
By late 2026 every tool in scope has community MCP servers. Actual (s-stefanov/actual-mcp, about 271 stars), Firefly III (several, with 140-152 operations) and GnuCash (ninetails-io/gnucash-mcp, 86 tools) have the richest ones; Beancount and hledger have query-centric and CLI-wrapping ones. The mature designs converge on a set of safety patterns:
- **read-only by default** with an explicit `--enable-write`;
- **dry-run on every write**;
- **validate after write** (`hledger check`);
- **automatic backups and audit logs**;
- **protect reconciled items**;
- **machine-readable integer or decimal amounts with explicit sign conventions**;
- **tool presets** to save tokens;
- a single **"orientation" summary call**.

ML categorization predates LLMs (smart_importer, beancount-import's decision tree, GnuCash Bayes). Newer work adds an executable benchmark for accounting agents on Beancount ledgers and a BQL fine-tuning dataset.

### Cited Findings
- GitHub repository counts (stars as of 2026-10-28; last push dates):
  - **Actual**: s-stefanov/actual-mcp 271 (pushed 2026-10-28), agigante80/actual-mcp-server 73, henfrydls/actual-budget-mcp 17.
  - **Firefly III**: etnperlong/firefly-iii-mcp 91, daften/fireflyiii-mcp 27 ("140 tools via stdio (PAT) or HTTP (OAuth)"), fabianonetto/mcp-server-firefly-iii 24, RadCod3/LamPyrid 24, YakupEmreYerli/mcp-firefly-iii ("152 operations behind 5 scoped tools").
  - **hledger**: iiAtlas/hledger-mcp 65.
  - **Beancount**: vanto/beanquery-mcp 53, StdioA/beancount-mcp 11, klinikal/beanie-mcp ("querying Beancount v3 ledgers in plain English"), mekanics/mcp-beancount.
  - **Ledger**: minhyeoky/mcp-server-ledger 51.
  - **GnuCash**: ninetails-io/gnucash-mcp 84.
  - **Akaunting**: two tiny servers (uk7itsolutions/akaunting-mcp-laravel, LibreCodeCoop/akaunting-mcp, read-only with OAuth).
  - **Hosted Beancount**: CPUtester5465/countbean-plugin 33 ("Countbean plugin for Claude Code — hosted plain-text (Beancount) accounting").
  — [GitHub search API: beancount mcp](https://api.github.com/search/repositories?q=beancount+mcp&sort=stars); [firefly iii mcp](https://api.github.com/search/repositories?q=firefly+iii+mcp&sort=stars); [actual budget mcp](https://api.github.com/search/repositories?q=actual+budget+mcp&sort=stars); [hledger mcp](https://api.github.com/search/repositories?q=hledger+mcp&sort=stars); [gnucash mcp](https://api.github.com/search/repositories?q=gnucash+mcp&sort=stars); [akaunting mcp](https://api.github.com/search/repositories?q=akaunting+mcp&sort=stars)
- **actual-mcp** (s-stefanov) tools:
  - transactions and accounts: get / create / update transactions, get accounts, balance history;
  - reporting: spending-by-category, monthly-summary, budget-vs-actual, net-worth, category-trends, spending-by-payee, cash-flow;
  - custom reports and dashboards CRUD;
  - categories, category groups, payees (incl. `merge-payees`) and rules CRUD;
  - prompts `financial-insights` and `budget-review`.
  
  Reporting tools "return JSON rather than markdown, so amounts stay machine-readable. Every amount is an integer number of cents, and each response carries an `amountsIn` field describing the sign conventions". Writes require `--enable-write`. A sync TTL (`ACTUAL_SYNC_TTL_MS`) controls re-download freshness, and one serialized connection is shared. — [actual-mcp README](https://github.com/s-stefanov/actual-mcp)
- **hledger-mcp** (iiAtlas):
  - modes: "safe `--read-only` mode"; `--skip-backup` otherwise `.bak` files are created before appends;
  - write tools: `hledger_add_transaction` ("after validating with `hledger check`", with `dryRun`), `hledger_remove_entry` (by exact text and location, re-validated), `hledger_import` (runs against a temporary copy), `hledger_rewrite`, `hledger_close` (closing/opening/retain-earnings);
  - "All write tools include a `dryRun` parameter";
  - hledger-web runs in `view` mode for read-only sessions.
  — [hledger-mcp README](https://github.com/iiAtlas/hledger-mcp)
- **gnucash-mcp** (ninetails-io), 86 tools:
  - role modules: `core` (29, always loaded; includes reconciliation, audit log, backups), `bookkeeper` (30), `investor` (13), `business` (27: invoices, bills, sales tax, jobs);
  - an orientation dashboard in one call: book currency, data range, CoA summary by branch, assets/liabilities with top items, receivables/payables, frequently used accounts with short `%guid` ids ("fewer tokens"), reconciliation status, net-worth trajectory, monthly net, runway, budget pacing, scheduled items;
  - statement entry is a "rehearsal" dry-run classifying each line (new / already entered / needs a look), then a commit that "refuses wholesale rather than land a month that doesn't tie".
  — [gnucash-mcp README](https://github.com/ninetails-io/gnucash-mcp)
- gnucash-mcp safety: a per-day human-readable audit log (e.g. `POST INVOICE id:000019 total: 1500.00 … txn:a1b2c3d4`); automatic backups before the first write of a session, verified with `PRAGMA integrity_check`; "Reconciled splits are protected… refuses to delete or modify reconciled splits without an explicit override"; "Voiding ≠ deleting", using GnuCash's void (values zeroed, record kept); a warning not to edit in the GnuCash desktop app concurrently. — [gnucash-mcp README](https://github.com/ninetails-io/gnucash-mcp)
- **beanquery-mcp** (vanto) is minimal: tools `set_ledger_file` and `run_query` (BQL); resources `beanquery://tables` and `beanquery://accounts`. It carries a privacy warning that ledger contents go to LLM providers and recommends self-hosted LLMs or redaction. — [beanquery-mcp README](https://github.com/vanto/beanquery-mcp)
- **firefly-iii-mcp** (etnperlong) filters tools by presets (default, full, basic, budget, reporting, admin, automation) or custom tags "to reduce token usage", e.g. `FIREFLY_III_TOOLS="accounts,transactions,categories"`. — [firefly-iii-mcp README](https://github.com/etnperlong/firefly-iii-mcp)
- **mcp-server-ledger** (minhyeoky) is "A Model Context Protocol server for interacting with Ledger CLI… enables Large Language Models" to run Ledger reports. — [mcp-server-ledger](https://github.com/minhyeoky/mcp-server-ledger)
- **Open Accounting Bench** (bex-co, pre-alpha v0.2):
  - it measures "whether an AI agent can *do* accounting correctly". Agents edit a real Beancount ledger in isolated, no-network containers;
  - grading is deterministic, state-based and five-layer: "no LLM judge is required. A balanced-but-misclassified entry fails";
  - the primary metric is Verified Task Completion Rate;
  - there are stable, dynamic (seeded generators) and holdout tracks.
  — [open-accounting-bench README](https://github.com/bex-co/open-accounting-bench)
- **bql-lora** (tarioch) is a training-data generator and dataset for fine-tuning LLMs on BQL, "validated against beanquery". — [GitHub search: beancount llm](https://api.github.com/search/repositories?q=beancount+llm&sort=stars)
- **Beancount-Trans** (dhr2333, 82 stars): upload bills and auto-convert them to auditable Beancount double-entry data with reports (Chinese-language project). — [GitHub search: beancount llm](https://api.github.com/search/repositories?q=beancount+llm&sort=stars)
- **beancount-smart-query** (fengkx, 22 stars, last pushed 2023): "Query beancount in human language with the help of AI". — [GitHub search: beancount gpt](https://api.github.com/search/repositories?q=beancount+gpt&sort=stars)
- Pre-LLM ML categorization:
  - smart_importer `PredictPostings` / `PredictPayees` hooks train on existing entries;
  - beancount-import uses a decision-tree classifier for `Expenses:FIXME` legs;
  - GnuCash uses token/account Bayesian weights.
  — [smart_importer](https://github.com/beancount/smart_importer); [beancount-import](https://github.com/jbms/beancount-import); [GnuCash wiki: Bayes](https://wiki.gnucash.org/wiki/Bayes)
- Actual's API is a Node package (`@actual-app/api`), not HTTP. It "allows to run the UI in headless mode", works on a local copy of the budget, and the "primary use case is custom importers and exporters". `importTransactions` supports `dryRun`. — [Actual API](https://actualbudget.org/docs/api/); [Actual API reference](https://actualbudget.org/docs/api/reference)

### Inferences
- Design our agent tool surface from day one around the converged patterns:
  1. an `orientation`/`summary` tool, as in gnucash-mcp;
  2. a read-only `query` tool over postings, as in beanquery-mcp;
  3. `propose_*` writes that return a diff and validation result without committing (dry-run);
  4. `commit` that re-validates (balance, assertions, lock date) and refuses atomically if it would break invariants;
  5. auto-snapshot before the first write of each agent session;
  6. an append-only audit log tagged with actor `agent` and a session id, which drives Manager-style "undo this session";
  7. hard protection of reconciled and locked postings, with void instead of delete.
- Return amounts as exact decimal strings plus commodity, or integer minor units with an explicit `scale` and sign convention (Actual MCP's `amountsIn`). Never return floats.
- Use short stable ids for frequently used accounts in tool outputs (gnucash-mcp `%guid`) to cut tokens. Expose tool presets/roles (Firefly MCP, gnucash-mcp modules) so a categorizing agent doesn't load invoicing tools.
- For categorization, combine deterministic rules (fast, explainable) with an ML/LLM fallback that writes to a suspense/uncategorized account plus a confidence score. When the user confirms, convert repeated confirmations into rules. Grade agent behaviour on resulting ledger state, as Open Accounting Bench does: balanced-but-misclassified counts as a failure.
- Because MCP servers expose ledger contents to model providers (beanquery-mcp's privacy warning), a local-first app should let users scope what the agent can read, for example by account subtree or by redacting payee names.

### Gaps
- I found no quantitative accuracy comparisons of LLM versus classical (smart_importer, Bayes) categorization.
- I did not read the source of the Firefly III or Actual MCP servers beyond READMEs. Claims about their write-safety (confirmation, dry-run) are therefore limited to what the READMEs state; the actual-mcp README states only `--enable-write`.
- I could not survey Reddit, HN or plaintextaccounting.org discussions, or blog posts on LLM + Beancount workflows (e.g. "beancount + GPT categorization" write-ups), because the web-search budget was exhausted. These would add practitioner opinion on how reliable LLM categorization is in practice.
