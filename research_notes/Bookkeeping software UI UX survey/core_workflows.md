# Core bookkeeping workflows and how to implement them correctly (generic, 2025-2026)

Scope: an implementation reference for a local, single-user, offline double-entry bookkeeping app (personal and small business). Bank data arrives only by file import (no bank-feed API), and an AI agent drives the app through the same operations as the UI. Jurisdiction-specific rules are marked **[JURISDICTION]**. Items under "Inferences" are design recommendations drawn from the cited findings plus general practice. They were not individually verified against a source in this session.

Quick map of sections: (1) money representation, (2) double-entry core and chart of accounts, (3) import formats and dedupe, (4) matching and reconciliation, (5) categorization rules, (6) invoicing and receivables, (7) bills, payables and expenses, (8) sales tax / VAT / GST, (9) multi-currency, (10) financial statements, (11) period close and audit trail, (12) recurring, budgets and forecasting, (13) personal finance in double-entry, (14) data-integrity checks.

---

## 1. Money representation: integer minor units vs decimals, currency precision, tax rounding, why floats are wrong

### Takeaway
Store every amount as an exact integer count of the currency's minor unit (or as an exact fixed-point decimal), always together with its ISO 4217 currency code. Get the exponent from the ISO 4217 table (JPY 0, USD/EUR/GBP 2, BHD/KWD/OMR/TND/JOD 3), not from a hard-coded "2". Never use binary floats. Tax rounding (per line or per invoice) is a policy choice that changes totals, so record which method each document used and store the computed tax amounts. Don't recompute them later.

### Cited Findings
- Binary floats can't represent most decimal money values exactly: "almost all typical numbers in finance can't be represented precisely unless they happen to be powers of 2". Example: $2.78 is stored as 2.7799999713897705078125. — [Modern Treasury: Floats don't work for storing cents](https://www.moderntreasury.com/journal/floats-dont-work-for-storing-cents)
- Language rounding defaults differ: Ruby rounds half away from zero, Python 3 rounds half to even. The order of operations also changes results: in their example, computing tax separately gave $16.77 and computing it inline gave $16.78. — [Modern Treasury](https://www.moderntreasury.com/journal/floats-dont-work-for-storing-cents)
- Modern Treasury stores all currency as 64-bit integers in minor units ("$12.34" is `1234`) in PostgreSQL `bigint`, with the ISO 4217 code stored separately to give the number of decimal places. The range is above 92 quadrillion dollars. Alternatives are BigInt (arbitrary size, for crypto), BigDecimal (used by Java Money and Ruby's money gem), strings, and split whole/fraction storage. — [Modern Treasury](https://www.moderntreasury.com/journal/floats-dont-work-for-storing-cents)
- ISO 4217 gives each currency a "minor unit" exponent. 0 decimals: JPY, KRW, BIF, CLP, DJF, GNF, ISK, PYG, RWF, UGX, VND. 3 decimals: BHD, IQD, JOD, KWD, LYD, OMR, TND. 4 decimals: CLF and UYW (unit-of-account/funds codes). SIX Group maintains the list for ISO and SNV, and the current base edition is ISO 4217:2015. — [Wikipedia: ISO 4217](https://en.wikipedia.org/wiki/ISO_4217)
- Fowler's Money pattern: store amount and currency together as one value object. Use integral minor units or fixed-point decimals, not floats. Forbid arithmetic across currencies. Handle the allocation problem ("Foemmel's Conundrum": splitting 5 cents 70/30 leaves a remainder that someone must get). — [Martin Fowler: Money](https://martinfowler.com/eaaCatalog/money.html)
- **[JURISDICTION: UK VAT]** HMRC's rounding concession (referenced as VAT Notice 700 para 17.5): the first sub-paragraph allows the total VAT *payable* on an invoice to be rounded down to a whole penny. The alternative line-level methods ("rounding down to one tenth of a penny", "rounding to the nearer 1p or 0.5p", rounding to 3 digits) do not allow rounding down to whole pennies. This is tax-neutral for invoice traders because the supplier's output tax and the customer's input tax move together. — [HMRC VATREC12010](https://www.gov.uk/hmrc-internal-manuals/vat-trader-records/vatrec12010)
- **[JURISDICTION: UK VAT retailers]** Line-level options for retailers include rounding (up and down) to the nearest 1p, calculating to at least 5 decimal places and then rounding to 4, or truncating at no less than 6 decimal places. — [HMRC VATREC12020](https://www.gov.uk/hmrc-internal-manuals/vat-trader-records/vatrec12020) (via search snippet)
- Practitioner summary of the UK rule: "If you calculate VAT at line level or invoice level, you must not round the VAT figure down, however, you may round (up and down) each VAT calculation." — [AccountingWEB: VAT rounding rules](https://www.accountingweb.co.uk/any-answers/vat-rounding-rules). This reads as conflicting with the HMRC manual's "rounding down of VAT payable" at invoice level. The HMRC manual is the primary source.
- **Source discrepancy:** the HMRC internal manual points to Notice 700 para 17.5 for rounding, but a fetch of the current [VAT Notice 700](https://www.gov.uk/guidance/vat-guide-notice-700) found section 17 titled "VAT invoices for particular situations" with no rounding text. The paragraph has probably been renumbered.

### Inferences
- **Schema:** `amount_minor BIGINT NOT NULL` plus `currency CHAR(3) NOT NULL`. Ship a static ISO 4217 table (code, exponent, name) inside the app, since it runs offline, and let the user add custom commodities (crypto, stocks, loyalty points) with their own precision.
- **JS/TS caveat:** JavaScript `number` is a float64 and is only exact up to 2^53−1 (about 9.007e15). That is fine for minor units in household and small-business books, but if you use 64-bit integers, serialize them as strings or BigInt over JSON. Any decimal input from the UI or the agent ("12.34") should be parsed from a string straight into integer minor units. Never parse it through `parseFloat`.
- **Higher-precision intermediates:** quantities, unit prices, exchange rates and tax rates need more precision than the currency has. Store them as decimal strings or scaled integers (for example a rate as a numerator/denominator, or 10+ significant digits). Do the arithmetic in an exact decimal library and round once, to the currency's exponent, when producing a line total or posting amount.
- **Rounding policy as data:** store `rounding_mode` (half-up / half-even / truncate) and `tax_calc_level` (line / invoice) per organisation and snapshot them onto each document. Store the computed `tax_amount_minor` on each line and on the document, so historical documents never change when the policy changes.
- **Allocation:** when splitting an amount by percentages (split rules, cash-basis proration, multi-line payments), use a largest-remainder allocator so the parts always sum exactly to the whole.
- **Agent API:** accept amounts as strings with an explicit currency, and reject anything with more decimals than the currency allows, unless it is a price/rate field.

### Gaps
- The full current text of HMRC Notice 700's rounding paragraph wasn't retrieved, so the paragraph number is uncertain (see discrepancy above).
- ECJ case C-302/07 (J D Wetherspoon) on EU VAT rounding came up in search but wasn't fetched. EU-wide rounding rules beyond the UK aren't covered here.
- No 2024-2026 ISO 4217 amendments were found in the fetched source. New codes such as ZWG and XCG need checking against SIX Group's current list.

---

## 2. Double-entry core: account types, normal balances, standard charts, journal entries vs transactions, splits, contra accounts, retained earnings, year-end close, opening balances, suspense accounts

### Takeaway
Use the five root types (Asset, Liability, Equity, Income/Revenue, Expense). A transaction is an atomic set of two or more postings ("splits") whose debits equal their credits. Store transactions immutably and *derive* balances from them. Opening balances go against an Opening Balances equity account. Retained earnings can be computed for reporting, and a formal closing entry can be generated at year-end (hledger `close --retain` does exactly this).

### Cited Findings
- **Debit-normal accounts** ("funds you own, or uses of money": assets, expenses) increase with a debit and decrease with a credit. **Credit-normal accounts** ("funds you owe, or sources of money": liabilities, equity, revenue) increase with a credit. — [Modern Treasury: Accounting for Developers Part I](https://www.moderntreasury.com/journal/accounting-for-developers-part-i)
- "The sum of all credit normal balances always equals the sum of all debit normal balances." — [Modern Treasury Part I](https://www.moderntreasury.com/journal/accounting-for-developers-part-i)
- A transaction is "an atomic event that affects account balances" with "at least two entries". Each entry belongs to one transaction and one account. "It's more accurate to store immutable transactions and always compute balances from those transactions. Mutating balances directly creates a system that is prone to errors." — [Modern Treasury Part I](https://www.moderntreasury.com/journal/accounting-for-developers-part-i)
- Minimal schema: an entries table with `id, transaction_id, account_id, amount, direction`, enforcing "sum of debit amounts == sum of credit amounts, per transaction". — [Modern Treasury Part II](https://www.moderntreasury.com/journal/accounting-for-developers-part-ii)
- Fowler: an Account's balance is the sum of its Accounting Entries. An Accounting Transaction links the entries of a transfer and can be two-legged or multi-legged. "Accounting Transactions...work very well with Event Sourcing." — [Martin Fowler: Accounting Narrative](https://martinfowler.com/eaaDev/AccountingNarrative.html)
- Chart-of-accounts numbering where the first digit is the type: 1xxx assets, 2xxx liabilities, 3xxx equity, then revenue, cost of goods sold, operating expenses, and 9xxx other gains/losses. Small businesses can use 3-digit codes (100-199 assets). "A gap between account numbers allows for adding accounts in the future." Standard order: current assets → property, plant and equipment → current liabilities → long-term liabilities → equity → operating revenues → COGS → operating expenses → non-operating items. A small retailer "may need as few as one hundred accounts". — [AccountingCoach: Chart of Accounts](https://www.accountingcoach.com/chart-of-accounts/explanation)
- Contra accounts include Allowance for Doubtful Accounts (against Accounts Receivable) and Accumulated Depreciation (against fixed assets). — [AccountingCoach: Chart of Accounts](https://www.accountingcoach.com/chart-of-accounts/explanation)
- Closing process: revenues, expenses and dividends/drawings are *temporary* accounts. Closing entries "move the period's net income into equity and bring temporary accounts to zero": debit revenues and credit Income Summary, credit expenses and debit Income Summary, close Income Summary to Capital/Retained Earnings, then close drawings/dividends to Capital/RE. The post-closing trial balance contains only permanent accounts (assets, liabilities, equity). — [LedgerLoom workbook ch.4](https://ledgerloom.readthedocs.io/en/stable/workbook/ch04_closing_and_post_close.html); [Fit Small Business](https://fitsmallbusiness.com/what-is-closing-journal-entries/)
- hledger `close` prints a "closing balances" transaction and an "opening balances" transaction that bring balances to and from zero. `--retain` generates a retained-earnings transaction for revenue/expense accounts (default account `equity:retained earnings`), and `--migrate` emits both closing and opening transactions (defaults `equity:closing balances` / `equity:opening balances`). — [hledger Close.hs source](https://hackage-content.haskell.org/package/hledger-1.42.1/docs/src/Hledger.Cli.Commands.Close.html) (via search summary)
- Beancount opening balances: open the account, `pad` it from `Equity:Opening-Balances`, then assert the real balance with a `balance` directive. A pad needs a later balance assertion to consume it. — [Beancount syntax](https://beancount.io/docs/Basics/syntax)

### Inferences
- **Sign convention:** either store `amount` with `direction ∈ {debit, credit}` (Modern Treasury) or store signed amounts with debit positive and credit negative, so that each transaction's postings sum to exactly 0 (the plaintext-accounting convention). Signed storage makes the balance invariant one `SUM()=0` check and makes balances plain sums. Display then flips the sign for credit-normal accounts.
- **Terminology for the UI:** call the header a "transaction" (date, description/payee, reference, status, source) and the lines "splits/postings" (account, amount, memo, contact, tax code, reconciliation state). A "journal entry" in the UI should be the manual/advanced form of the same object, not a separate data model.
- **Starter business chart** (4-digit, gaps of 10):
  - Assets: 1000 Bank-Checking, 1010 Savings, 1050 Cash on hand, 1100 Accounts Receivable, 1150 Allowance for Doubtful Accounts (contra), 1200 Inventory, 1300 Prepaid Expenses, 1400 Undeposited Funds/Clearing, 1500 Equipment, 1510 Accumulated Depreciation (contra)
  - Liabilities: 2000 Accounts Payable, 2100 Credit Card(s), 2200 Sales Tax/VAT Payable (output), 2210 VAT Receivable (input; or one net VAT control account), 2300 Accrued Liabilities, 2400 Unearned Revenue, 2500 Loans Payable, 2900 Suspense
  - Equity: 3000 Owner's Capital/Contributions, 3100 Owner's Drawings (contra-equity), 3200 Retained Earnings, 3900 Opening Balance Equity
  - Income: 4000 Sales, 4100 Service Revenue, 4900 Other Income/Interest
  - COGS: 5000
  - Expenses: 6000+ (Advertising, Bank Fees, Insurance, Meals, Office, Professional Fees, Rent, Software/Subscriptions, Travel, Utilities, Depreciation Expense, Bad Debt Expense, FX Gain/Loss), with 6999 Uncategorized Expense and 4999 Uncategorized Income
- **Personal chart:** Assets (Checking, Savings, Cash, Brokerage, Retirement, Property/Vehicle, Receivables-from-friends), Liabilities (Credit Cards, Mortgage, Auto Loan, Student Loan), Equity (Opening Balances), Income (Salary, Interest, Dividends, Capital Gains, Gifts), Expenses (Housing, Utilities, Groceries, Dining, Transport, Health, Insurance, Entertainment, Taxes, Fees, Uncategorized).
- **Retained earnings, computed approach (recommended for a single-user app):**
  - The balance sheet shows "Current Year Earnings" as the sum of P&L since the fiscal-year start.
  - "Retained Earnings" is the posted RE balance plus all P&L before the fiscal-year start.
  - Nothing is posted until the year is locked.
  - At year-end close, optionally post an explicit closing transaction (like hledger `--retain`) so exported ledgers are self-describing. If you do, the computed formula must exclude closing transactions to avoid double-counting (flag them `kind=closing`).
- **Suspense / uncategorized:** an imported line with no confident category posts to Uncategorized Income or Uncategorized Expense (by sign) or to Suspense. The books stay balanced, and the "needs review" list is simply "postings to these accounts". Period close should require them to be zero.
- **Opening balances:** offer a wizard. For each account, enter the balance as of the start date, post it against Opening Balance Equity, and create a balance assertion or reconciliation checkpoint at that date. For businesses migrating mid-year, also enter AR/AP open items individually so the aging reports work.
- **Contra accounts:** model them as an account flag (`contra_of = parent`) so reports net them under the parent (for example Equipment less Accumulated Depreciation) while keeping the normal side opposite to the parent type.

### Gaps
- I didn't fetch a standard published *personal* chart of accounts (for example GnuCash's default account tree). The personal chart above is inferred.
- No authoritative source was fetched on how commercial products (Xero, QBO) compute vs post retained earnings. The recommendation above is a design inference.

---

## 3. Bank statement import formats, parsing, and duplicate detection

### Takeaway
Support OFX/QFX first (structured, with a per-account unique FITID), then CAMT.053 and MT940 for European/business users, CSV with a saved column-mapping profile per bank, and QIF as legacy. Dedupe by (account, bank transaction ID) when one exists, and otherwise by a content fingerprint plus fuzzy matching. Treat statement opening/closing balances as reconciliation checkpoints.

### Cited Findings
**OFX / QFX**
- OFX 1.x (for example 1.03) is SGML, not XML: opening tags need not have closing tags. OFX 2.x moved to XML, where end tags are required. — [MSSQLTips: OFX in SQL Server](https://www.mssqltips.com/sqlservertip/11756/open-financial-exchange-in-sql-server/); [Haskell ofx package docs](https://hackage.haskell.org/package/ofx-0.4.4.0/docs/Data-OFX.html)
- A downloaded file has OFX headers (tag:value lines followed by a blank line) and then the OFX data. HTTP headers usually aren't present in files on disk. — [Haskell ofx docs](https://hackage.haskell.org/package/ofx-0.4.4.0/docs/Data-OFX.html)
- STMTTRN fields:
  - TRNTYPE (CREDIT, DEBIT, INT, DIV, FEE, SRVCHG, DEP, ATM, POS, XFER, CHECK, PAYMENT, CASH, DIRECTDEP, DIRECTDEBIT, REPEATPMT, OTHER)
  - DTPOSTED ("Date transaction was posted to account") and DTUSER ("Date user initiated transaction, if known")
  - TRNAMT
  - FITID ("Transaction ID issued by financial institution. Used to detect duplicate downloads")
  - NAME, MEMO ("Extra information not in NAME"), CHECKNUM
  - CORRECTFITID/CORRECTACTION (REPLACE or DELETE) for corrections to earlier transactions
  — [Haskell ofx docs](https://hackage.haskell.org/package/ofx-0.4.4.0/docs/Data-OFX.html)
- Amounts are "signed from the perspective of the customer": negative for debits/checks/fees/purchases, positive for credits/deposits. "If there is no decimal point, there is an implied decimal point at the end of the value." Dates use `YYYYMMDDHHMMSS.XXX` with an optional `[gmt offset:tz]`. — [Haskell ofx docs](https://hackage.haskell.org/package/ofx-0.4.4.0/docs/Data-OFX.html)
- FITID must be unique within a given account and is used to match duplicates. — [Liquid Technologies OFX 2.1.1 schema: FITID](https://schemas.liquid-technologies.com/OFX/2.1.1/fitid.html) (via search summary)

**QIF**
- QIF is plain ASCII. The first line is a header such as `!Type:Bank`. Fields:
  - `D` date
  - `T` total (money out is negative; with splits, T is the sum of the splits)
  - `P` payee
  - `M` memo
  - `L` category
  - `N` number/check number
  - `C` cleared status
  - `^` ends a record
  — [Wikipedia: Quicken Interchange Format](https://en.wikipedia.org/wiki/Quicken_Interchange_Format)
- QIF dates are ambiguous (for example 13/02/2004 vs 11/14/2003 in one file). Practitioners report that no importer can always resolve this, so users must check. — [GnuCash-user list: QIF spec ambiguity](https://lists.gnucash.org/pipermail/gnucash-user/2014-April/054357.html)

**CAMT.053 (ISO 20022)**
- Structure:
  - GrpHdr (MsgId ≤35 chars, CreDtTm, pagination)
  - Stmt: one account per reporting period, with Id, optional ElctrncSeqNb ("sequential counter for gap/duplicate detection"), optional FrToDt, and Acct.Id.IBAN or Acct.Id.Othr
  - at least two balances, OPBD and CLBD (mandatory), plus optional CLAV/ITBD/ITAV
  — [Mambu Payments: camt.053 business logic](https://docs.mambupayments.com/docs/camt053-xsd-business-logic)
- "Bal.Amt must be a positive number. The sign of the balance is conveyed by Bal.CdtDbtInd (CRDT ... DBIT ...)". Entry `Amt` is also positive, with `CdtDbtInd` CRDT/DBIT. — [Mambu](https://docs.mambupayments.com/docs/camt053-xsd-business-logic); [Adyen: business account statement](https://docs.adyen.com/business-accounts/business-account-statement)
- Ntry fields: NtryRef (bank reference, max 35 chars, used as the idempotency key: "In the case of two records with the same idempotency key, the second one will be discarded"), Sts (BOOK in camt.053), BookgDt, ValDt, BkTxCd, and optionally RvslInd, AcctSvcrRef, AddtlNtryInf. — [Mambu](https://docs.mambupayments.com/docs/camt053-xsd-business-logic)
- Batch entries: NtryDtls/TxDtls carry Refs (EndToEndId, UETR), RmtInf (Ustrd ≤140 chars, or Strd) and RltdPties (debtor/creditor). "The sum of all TxDtls.Amt values must equal the parent Ntry.Amt." — [Mambu](https://docs.mambupayments.com/docs/camt053-xsd-business-logic)
- OPBD is the booked balance at the start of the period (equal to the prior closing booked balance). CLBD is the closing booked balance including all entries. — [Adyen](https://docs.adyen.com/business-accounts/business-account-statement)

**MT940 (SWIFT)**
- Tags:
  - `:20:` transaction reference
  - `:25:` account
  - `:28C:` statement number/page (5n/5n)
  - `:60F:`/`:60M:` opening balance (final/intermediate)
  - `:61:` statement line
  - `:86:` information to account owner
  - `:62F:`/`:62M:` closing balance
  - `:64:` closing available
  — [ČSOB MT940 description](https://www.csob.sk/documents/11005/123723/SWIFT_format_description_MT940.docx); [Westpac MT940](https://bankrec.westpac.com.au/docs/statements/mt940/)
- `:61:` layout: value date YYMMDD, optional entry date MMDD, D/C mark, amount with comma decimals, transaction type code, owner reference, `//` bank reference, optional supplementary details. Example: `:61:1507020702D115945,00F014NARRATIVE//0207150143062089`. Balances are D/C + YYMMDD + currency + amount. "Details reported in [:60F:] will match those reported in the previous statements Final Closing Balance." `:86:` holds up to 6 lines of narrative. — [Westpac MT940](https://bankrec.westpac.com.au/docs/statements/mt940/)
- Some banks prefix `:86:` subfields with `<` codes (bank-specific). — [ČSOB / Polish bank MT940 specs, via search](https://www.csob.sk/documents/11005/123723/SWIFT_format_description_MT940.docx)

**CSV and dedupe in practice**
- Actual Budget imports CSV, QIF, OFX, QFX and CAMT and recommends OFX/QFX. Its CSV options are date format, delimiter, "Flip Amount" (negate all amounts), "Split amount into separate inflow/outflow columns" and a multiplier. — [Actual Budget: Importing](https://actualbudget.org/docs/transactions/importing)
- Actual's dedupe: "After checking the id, Actual will look for transactions around the same date, with the same amount, and with a similar payee." "It will always favor the imported transaction. If it matches a manually-entered transaction, it will update the date to match the imported transaction." — [Actual Budget](https://actualbudget.org/docs/transactions/importing)
- GnuCash: CSV lacks OFX's unique IDs, so its duplicate detection "is not as reliable". Duplicate matching uses account, amount and date (plus FITID for OFX). — [GnuCash-user: CSV matching produces duplicates?](https://lists.gnucash.org/pipermail/gnucash-user/2021-March/095650.html)

### Inferences
- **Normalized import model.** Every parser emits `ImportedLine{account_hint, bank_txn_id?, posted_date, value_date?, amount_minor (signed: + = money into the account), currency, payee_raw, memo_raw, reference?, check_no?, status: posted|pending, balance_after?, raw_json}` plus `StatementMeta{account_id, currency, period_from/to, opening_balance?, closing_balance?, seq_no?}`. Keep the raw line for audit and re-parsing.
- **Sign normalization.** OFX is already from the customer's view. CAMT/MT940 use positive amounts with a D/C indicator, so DBIT/D becomes negative. Credit-card OFX (CCSTMTRS) also uses the customer view, where purchases are negative. For a liability account, the posting must *credit* the card on a purchase. In signed storage, money out of the card (a purchase) is a negative posting to the liability, which increases the amount owed. Test this explicitly.
- **CSV mapping profile** saved per account/bank:
  - delimiter, encoding (UTF-8/Windows-1252/BOM), header rows to skip
  - date column + format (`DD/MM/YYYY` vs `MM/DD/YYYY`)
  - amount as either one signed column or separate debit/credit (in/out) columns
  - a flip-sign flag, decimal mark (`.` or `,`), thousands separator, parentheses-as-negative
  - payee/description/memo columns, optional balance column, optional ID column
  - On first import, auto-detect a date format that parses every row unambiguously. If both D/M and M/D parse all rows, ask the user or agent instead of guessing (this is the same QIF ambiguity).
- **Dedupe keys, in priority order:**
  1. `(account_id, bank_txn_id)` from FITID / NtryRef / AcctSvcrRef / a CSV ID column. This is an exact, enforced unique index.
  2. For ID-less formats, a fingerprint `hash(account_id, posted_date, amount_minor, normalized_description)` plus an occurrence index for identical same-day lines (two identical €3.50 coffees on one day are legitimate). The occurrence index is computed within the file, and re-importing an overlapping file reproduces the same index.
  3. Fuzzy match against existing *manual* entries (see section 4). This is a match, not a duplicate.
- **Overlapping statements:** record the file hash so the same file is never imported twice, and record each statement's period so you can warn about gaps and overlaps. CAMT ElctrncSeqNb and MT940 `:28C:` enable gap detection.
- **Pending vs posted:** pending lines have unstable IDs and amounts (card authorizations, tips). Either skip them by default (camt.053 entries are BOOK only), or store them in a separate staging state that is never reconciled and is replaced when the posted line arrives. OFX CORRECTACTION=REPLACE/DELETE should update or remove the *staged/unconfirmed* line, or create a reversing suggestion if the line is already confirmed.
- **Statement balances:** when the file supplies closing balances (OFX LEDGERBAL, CAMT CLBD, MT940 62F), auto-create a reconciliation checkpoint suggestion, and warn if the books' cleared balance after import ≠ the bank balance.
- **QFX** is Quicken's branded OFX variant, so parse it with the same OFX parser and ignore Intuit-specific tags. (This is general knowledge and wasn't sourced this session.)

### Gaps
- The OFX spec PDF from financialdataexchange.org wasn't fetched directly, so exact header fields (OFXHEADER:100, DATA:OFXSGML, VERSION, CHARSET) and the LEDGERBAL/AVAILBAL definitions come from general knowledge, not a primary source.
- QFX-specific fields (INTU.BID etc.) weren't verified.
- No authoritative CSV standard for bank exports exists. Column conventions vary by bank.

---

## 4. Matching imported lines and statement reconciliation

### Takeaway
Run a two-stage pipeline:
1. **Match** each imported line to an existing open item (manual entry, invoice payment, bill payment, the other leg of a transfer) using exact amount + date window + payee similarity.
2. Otherwise **create** a new transaction via rules/suggestions.

Reconciliation is a separate, explicit procedure. The user (or agent) enters the statement end date and ending balance and marks items cleared until cleared balance − statement balance = 0. Then the reconciled items are locked.

### Cited Findings
- GnuCash's import matcher scores the date using a "Likely matched day threshold" (default 4 days) and an "Unlikely matched day threshold" (default 14 days). "A transaction which is within the 14 day window will likely be matched if there is no other higher scoring transaction." — [GnuCash-user: CSV matching produces duplicates?](https://lists.gnucash.org/pipermail/gnucash-user/2021-March/095650.html)
- GnuCash's Bayesian process is used to pick the *transfer account* (the category) from previous assignments, not for duplicate detection. It tokenizes payee/memo text. — [GnuCash-user: Bayes matching](https://lists.gnucash.org/pipermail/gnucash-user/2018-March/075240.html) (via search summary)
- Actual Budget matches existing transactions by id, then "around the same date, with the same amount, and with a similar payee", and favours the imported data (it updates the date of a matched manual entry). — [Actual Budget](https://actualbudget.org/docs/transactions/importing)
- Bank reconciliation procedure:
  - **Balance per bank** is adjusted for deposits in transit, outstanding checks and bank errors.
  - **Balance per books** is adjusted for bank fees/debit memos, interest earned/credit memos, NSF (returned) checks and company errors.
  - "Only adjustments to the Balance per Books require entries."
  - "Adjusted balance per BANK must equal Adjusted balance per BOOKS."
  — [AccountingCoach: Bank Reconciliation](https://www.accountingcoach.com/bank-reconciliation/explanation)
- Beancount balance assertions check the balance "at the beginning of the specified day (before any transactions on that day)" and raise an error on mismatch. — [Beancount syntax](https://beancount.io/docs/Basics/syntax)
- hledger checks assertions in date order (parse order within a day) and stops with an error if one fails. `check recentassertions` "reports accounts whose latest assertion is more than 7 days before their latest posting, a reminder to keep reconciling." — [hledger: Checking for errors](https://hledger.org/checking-for-errors.html)

### Inferences
- **Match scoring** for an imported line L against candidate C (unreconciled postings in the same account, or open AR/AP items):
  - Amount: exact equality is required, or a configured tolerance for FX/fee differences.
  - Date: score = 1.0 if |Δdays| ≤ 4, linear down to 0 at 14 days, excluded beyond that (GnuCash defaults). Allow C dated *before* L (checks clear later) more than after.
  - Text: normalized payee/description similarity (token Jaccard or trigram), plus exact reference matches (invoice number in remittance info, check number = CHECKNUM) as strong signals.
  - Auto-accept only a single candidate above a high threshold. Otherwise show ranked suggestions. Never auto-match to a reconciled posting.
- **Transfer detection:**
  - A line in account A with amount −X and a line (imported or existing) in own account B with +X, within the date window (allow about 1-5 business days), with transfer-ish text (TRNTYPE=XFER, "transfer", a payment to a card issuer whose card account exists) becomes one transaction with two postings (A −X, B +X).
  - If only one side has been imported so far, post to a "Transfers in transit" clearing account (or directly to B, unreconciled). When the second file arrives, match it rather than creating a second transaction.
  - Credit-card payments are the most common case: checking −X matched to card +X.
- **Payment matching:**
  - An incoming amount equal to an open invoice's balance (or summing to a set of invoices) with the customer name or invoice number in the text should be suggested as "apply payment to invoice". That creates the payment transaction (Dr Bank / Cr AR) and applies it to the invoice.
  - The same applies to bills (Dr AP / Cr Bank).
  - Support one-to-many (one deposit pays several invoices) and many-to-one (instalments).
- **Reconciliation procedure (per account):**
  1. Pick the statement end date and enter the statement ending balance. Pre-fill it from the imported CLBD/LEDGERBAL/62F if available.
  2. The opening balance is the last reconciliation's ending balance (it can't be edited here).
  3. List the unreconciled postings up to the end date. Lines matched from that statement's import come pre-ticked.
  4. Show the cleared balance = opening + ticked items, and difference = statement balance − cleared balance.
  5. Allow "add missing item" (bank fee, interest) inline. These are the book-side adjustments.
  6. Finish is enabled only when the difference is exactly 0. On finish, set `reconciled_at` and `reconciliation_id` on each ticked posting and store the reconciliation record (account, period, statement balance, cleared count/total, outstanding items snapshot).
  7. Allow "undo last reconciliation" (only the latest one, not arbitrary history) as an audited action.
- **Reconciled-item protection:** editing amount/account/date on a reconciled posting must be blocked, or require an explicit "unreconcile" with a reason that is logged. Deleting is blocked. Corrections should be reversing entries.
- **Reconciliation report:** statement balance, outstanding deposits and outstanding payments (ticked = no, date ≤ end), adjusted balance = book balance, items cleared this reconciliation, and any changes to previously reconciled items since then (a discrepancy report).
- Map Beancount/hledger balance assertions onto reconciliation checkpoints. A failing checkpoint shows up as a data-integrity error (section 14).

### Gaps
- No published scoring weights from commercial products (Xero/QBO match suggestions) were found. The weights above are design proposals.
- No authoritative guidance was found on how many days an inter-account transfer typically takes. The 1-5 business-day window is an assumption.

---

## 5. Categorization rules: structure, precedence, learning from corrections

### Takeaway
A rule = ordered conditions (payee/description text ops, amount ranges, account, direction) plus actions (set category account, contact, tax code, tags, memo, or a split by percentage/amount). Evaluate in explicit priority order with first match wins (QuickBooks model). Apply rules only to unconfirmed/new lines unless the user explicitly re-runs them. Learn from corrections by proposing a rule (or a payee→category default), not by silently changing history.

### Cited Findings
- QuickBooks Online bank rules:
  - Evaluated top to bottom by priority. When a transaction satisfies Rule #1, it is applied and evaluation stops. Users drag to reorder.
  - Up to 5 conditions per rule, on Description, Bank text or Amount, with operators Contains, Doesn't contain, Is exactly.
  - Actions assign payee, category, class, and splits by percentage or fixed amount.
  - "Auto-add" confirms matching transactions without review. It only runs when there are fewer than 300 pending transactions.
  — [QuickBooks: How to set and use bank rules](https://quickbooks.intuit.com/learn-support/en-us/banking/how-to-set-and-use-banking-rules-for-downloaded-transactions/00/263139); [open-exam-prep: QBO bank feeds & rules](https://open-exam-prep.com/study-guides/cpb-bookkeeper/qbo-setup-banking-lists/qbo-bank-feeds-rules); [QuickBooks AU: setup bank rules](https://quickbooks.intuit.com/au/resources/product-updates/how-to-setup-quickbooks-online-bank-rules/)
- GnuCash learns the category ("transfer account") from past assignments with a Bayesian tokenizer over payee/memo. — [GnuCash-user: Bayes matching](https://lists.gnucash.org/pipermail/gnucash-user/2018-March/075240.html)
- hledger CSV rules can match records with regex `if` blocks, for example matching merchant category codes with `if \?MCC581[114]`. — [hledger manual](https://hledger.org/hledger.html) (fragment only)

### Inferences
- **Rule schema:**
  ```
  Rule {
    id, name, priority:int, enabled,
    scope: {accounts:[...]|any, direction: in|out|any},
    match: all|any,
    conditions:[{field: payee|description|memo|reference|amount|abs_amount|bank_txn_type,
                 op: contains|not_contains|equals|starts_with|regex|gt|lt|between,
                 value, case_insensitive:true}],
    actions:[set_category(account_id) | set_contact | set_tax_code | add_tags | set_memo |
             split[{account_id, percent|fixed_minor, tax_code?}] | mark_transfer(account_id) | auto_confirm:bool],
    created_from: manual|learned, stats:{times_applied, last_applied_at}
  }
  ```
- **Precedence:** explicit priority with first match wins is predictable and easy to explain to an agent. Optionally add "more specific beats less specific" only as a tie-breaker suggestion in the rule editor, not at runtime.
- **Split by percent:** use a largest-remainder allocation so the splits sum to the line exactly (section 1). The final split takes the remainder. When a tax code is set, compute tax per split.
- **Learning:**
  - When the user re-categorizes an imported line, compute the normalized payee key (strip card numbers, dates, store numbers, trailing digits).
  - If the last N (say 2-3) confirmations for that key used the same account, propose "Create rule: payee contains X → Category Y". Don't apply it retroactively without consent.
  - Keep a lightweight payee→last-category memory, plus an optional naive-Bayes token model (the GnuCash approach) for suggestions below rule level.
  - Order of application: exact transaction match (section 4) → user rules → learned suggestions → Uncategorized.
- **Agent parity:** expose `rules.list/create/update/reorder/test(rule, sample_lines)` with a dry run that returns which lines would change, so the agent can preview before committing.

### Gaps
- Xero's bank-rule precedence and its "cash coding" were not researched this session.
- hledger's exact precedence when several `if` blocks match wasn't confirmed (fetched text was truncated).

---

## 6. Invoicing and receivables: numbering, statuses, payments, credit notes, write-offs, aging, statements, accrual vs cash

### Takeaway
An invoice is a document that, once *approved/sent*, posts Dr Accounts Receivable / Cr Revenue (+ Cr Output Tax). Payments are separate transactions (Dr Bank / Cr AR) *applied* to one or more invoices. Status is derived from the amounts applied and from dates. Credit notes are their own negative documents applied against invoices. Write-offs post to Bad Debt Expense or the Allowance. Aging uses days past due as of a date. Cash-basis reports prorate each payment across the invoice's lines.

### Cited Findings
- **[JURISDICTION: UK VAT]** VAT invoices must carry a unique, sequential invoice number, and a missing required field can make an invoice invalid for VAT. — [Stripe: Invoices in the UK](https://stripe.com/gb/resources/more/invoices-in-the-uk)
- Aging groups open invoice balances by days past due as of a date. Common buckets: current, 1-30, 31-60, 61-90, 90+. — [Metabase: AR aging](https://www.metabase.com/metrics/accounts-receivable-aging); [Ramp: AR aging report](https://ramp.com/blog/accounts-payable/ar-aging-report)
- Bad debts:
  - The **direct write-off method** records the expense only when a specific invoice is deemed uncollectible (Dr Bad Debt Expense / Cr AR, no contra account).
  - The **allowance method** estimates each period (Dr Bad Debt Expense / Cr Allowance for Doubtful Accounts) and follows the matching principle, so it is preferred for material receivables.
  - Recovery takes two entries: reinstate the receivable (crediting the Allowance under the allowance method, or a Bad Debt Recovery income account under direct write-off), then record the cash.
  — [Ramp: bad debt recovery](https://ramp.com/blog/bad-debt-recovery-journal-entry); [Eduyush: bad debt expense](https://eduyush.com/blogs/accounting/bad-debt-expense-journal-entry)
- Cash-basis reporting of partially paid invoices: payment % = payment ÷ total due, applied to each line. Example: taxable $1,000 + non-taxable $100, paid $200 → 18.18% → taxable sales recognized $181.80 → tax at 8% = $14.54. Credits/discounts reduce the line before the percentage is computed. — [QuickBooks: Handle cash basis sales tax](https://quickbooks.intuit.com/learn-support/en-us/sales-taxes/handle-cash-basis-sales-tax/00/248797)
- Another implementation of the same proportional approach: "the system takes the percentage that was paid and allocates that percentage toward each invoice item/account", rather than paying the highest charge first. — [Campspot: cash basis FAQ](https://support.campspot.com/campspot-accounting-cash-basis-faq)
- Accrued revenue adjusting entry (work done, not yet invoiced): Dr Accounts Receivable / Cr Service Revenue. Unearned revenue recognized: Dr Unearned Revenues / Cr Service Revenues. — [AccountingCoach: Adjusting entries](https://www.accountingcoach.com/adjusting-entries/explanation)

### Inferences
- **Numbering:**
  - Use a per-series counter (prefix + zero-padded integer, for example `INV-2026-0042`) allocated **when the invoice leaves draft** (approve/send), not when the draft is created. That avoids gaps from deleted drafts.
  - Numbers are never reused. A voided invoice keeps its number and stays visible.
  - Credit notes use their own series (`CN-…`).
- **Statuses (stored lifecycle + derived payment state):**
  - Stored lifecycle: `draft` (no ledger impact, editable, deletable), `approved/sent` (posted to the ledger, number assigned), `void` (posted reversal, keeps its number).
  - Derived: `unpaid`, `partially_paid` (0 < applied < total), `paid` (applied == total), `overdue` (balance > 0 and today > due_date).
  - Editing a sent invoice: allowed only if it has no payments and its period isn't locked. Implement it as an audited reversal-and-repost (or a new version) so the history survives. Otherwise require a credit note.
- **Payment application:** use a `payment_allocations(payment_txn_id, document_id, amount_minor)` table. One payment can cover many invoices, and one invoice can receive many payments. Overpayments become customer credit (a negative AR balance on the contact, or a prepayment account) that can be applied later. Each allocation is immutable, and un-applying creates a reversing allocation.
- **Credit note:** a negative sales document that posts Dr Revenue (+ Dr Output Tax) / Cr AR, applied to one or more invoices or refunded (Dr AR / Cr Bank). It has its own status: open/applied/refunded.
- **Write-off:** for a small app, default to direct write-off: a "write off balance" action posts Dr Bad Debt Expense (and, **[JURISDICTION]** where bad-debt VAT relief applies, Dr/Cr Output Tax adjustment) / Cr AR, allocated to the invoice so it becomes `paid (written off)`. Offer an allowance-method mode for accrual businesses with material AR.
- **Aging:** compute as of any date from documents, allocations and credit notes dated ≤ that date. Bucket by days past *due date* (with an option for invoice date). Totals must tie to the AR control account balance at that date, so show a "reconciles to GL" check.
- **Customer statement:**
  - Activity type: opening balance + invoices/credits/payments in the period + closing balance.
  - Open-item type: unpaid invoices with aging.
  - Generate it as a PDF/HTML from the same queries.
- **Accrual vs cash toggle:**
  - Accrual: report the posted ledger as-is.
  - Cash: build the P&L from payment transactions, prorating each payment allocation across the invoice/bill lines (QBO method) by line ratio, with largest-remainder rounding. Exclude AR/AP and unapplied documents.
  - Bank transactions categorized directly (no invoice) are identical in both views.

### Gaps
- No primary-source invoice requirements beyond the UK were fetched (for example the EU VAT Directive art. 226 invoice contents, or US practice, where there is no federal invoice law).
- Bad-debt VAT relief conditions (UK: 6 months past due, etc.) weren't researched.

---

## 7. Bills, payables, expense receipts, reimbursable expenses

### Takeaway
Bills mirror invoices: approval posts Dr Expense/Asset (+ Dr Input Tax) / Cr Accounts Payable. Payments post Dr AP / Cr Bank and are applied to bills. Vendor credits mirror credit notes. Receipts are attachments that become either a bill or a direct spend transaction. Reimbursable expenses go through a clearing or "due to owner/employee" liability, and billable costs can be re-invoiced to a customer.

### Cited Findings
- Accrued expense adjusting entry: Dr Interest Expense / Cr Interest Payable for interest incurred but not yet paid. Prepaid expenses are recorded as an asset and expensed as used (Dr Insurance Expense / Cr Prepaid Insurance). — [AccountingCoach: Adjusting entries](https://www.accountingcoach.com/adjusting-entries/explanation)
- The aging buckets used for AR apply equally to AP aging (current, 1-30, 31-60, 61-90, 90+). — [DocuClipper: AP aging](https://www.docuclipper.com/docs/ap-aging-report/) (via search summary); [Metabase](https://www.metabase.com/metrics/accounts-receivable-aging)

### Inferences
- **Bill lifecycle:** draft → approved (posted) → derived partially_paid/paid/overdue → void. A bill's "number" is the *vendor's* reference: store it and warn on duplicate (vendor, reference) to catch double entry, with an internal ID separately.
- **Direct spend vs bill:** most personal and micro-business spending never goes through AP. The imported card/bank line is categorized directly (Dr Expense / Cr Bank or Card). Only use bills when there is a gap between receiving the bill and paying it, and the user wants AP tracking.
- **Receipts:**
  - Store the image/PDF in an app-local attachment store with a content hash, linked to a transaction or bill.
  - The agent can extract vendor, date, total and tax from the receipt and then *match* it to an imported card line (same amount ± tip tolerance, date ±3 days) instead of creating a duplicate.
  - Unmatched receipts sit in an inbox.
- **Reimbursable expenses (owner/employee paid personally):**
  - Dr Expense / Cr "Due to Owner" (or Employee Reimbursements Payable). Repaying them: Dr Due to Owner / Cr Bank.
  - Sole-trader shortcut: Cr Owner's Capital/Contributions.
- **Billable expenses (re-charged to a client):** tag the expense line with `billable_to = customer`. When invoicing, pull in unbilled items, either crediting the original expense account (pass-through) or posting to a "Reimbursed expense income" account. This choice is a configuration option.
- **Prepaid expenses:** create an amortization schedule (asset → expense, straight-line per month) as a recurring journal (section 12), so period close can verify it has run.

### Gaps
- Specific guidance on reimbursable-expense accounting from a primary standard wasn't fetched. The above follows general practice.

---

## 8. Sales tax / VAT / GST: tax codes, inclusive vs exclusive, input vs output, liability accounts, return summary, reverse charge

### Takeaway
Model tax through **tax codes**: a code has one or more components, each with a rate, an effective-date range and a GL account, plus flags (recoverable, reverse-charge, exempt/zero/out-of-scope, report boxes). Lines carry a tax code and an `amounts_are: inclusive|exclusive|no_tax` mode. Output tax on sales credits a liability. Input tax on purchases debits a receivable (or the same control account). A return summarizes a period by box and posts a settlement entry moving the net to "tax payable" and then to the bank on payment. Reverse charge posts equal output and input tax on the purchase.

### Cited Findings
- **[JURISDICTION: UK]** To extract VAT from a VAT-inclusive price, use the VAT fraction. For 20% it is "20⁄120 ... which is the same as one-sixth." HMRC publishes revised fractions when rates change. — [HMRC VAT Notice 700 §7.3.1](https://www.gov.uk/guidance/vat-guide-notice-700)
- **[JURISDICTION: UK]** Reverse charge for services received from abroad:
  - The supplier doesn't charge VAT. The customer enters output tax in Box 1 (value × UK rate) and the same figure as input tax in Box 4, so the net effect on Box 5 is nil.
  - — [Tax Adviser: Reverse charge accounting](https://www.taxadvisermagazine.com/article/reverse-charge-accounting-when-it-relevant)
  - However, "a common myth is that the Box 4 entry ... is always the same as the Box 1 entry. It is not!" Input tax must be restricted for private/non-business use or exempt-supply attribution.
  - — [Tax Adviser: Avoiding a trip up](https://www.taxadvisermagazine.com/article/avoiding-trip) (via search summary)
- Under cash-basis sales tax, tax is recognized only when payment is received, prorated across taxable lines (see the worked example in section 6). — [QuickBooks: cash basis sales tax](https://quickbooks.intuit.com/learn-support/en-us/sales-taxes/handle-cash-basis-sales-tax/00/248797)
- UK rounding concession for VAT on invoices (see section 1). — [HMRC VATREC12010](https://www.gov.uk/hmrc-internal-manuals/vat-trader-records/vatrec12010)

### Inferences
- **Tax code schema:**
  ```
  TaxCode {code, name, kind: standard|reduced|zero|exempt|out_of_scope|reverse_charge|import,
           components:[{name, rate_decimal, valid_from, valid_to, output_account_id, input_account_id,
                        recoverable_pct (0..100), compound:bool}],
           report_mapping:{box_ids...}}
  ```
  Compound components cover jurisdictions like Quebec QST-on-GST historically. Simple VAT/GST uses one component, US sales tax may have state+county+city components.
- **Exclusive:** tax = round(net × rate), gross = net + tax.
- **Inclusive:** tax = round(gross × rate/(1+rate)) (for 20% that is gross/6), net = gross − tax.
- Compute per line or per document per the rounding policy (section 1). Store net, tax and gross per line.
- **Postings:**
  - Sales invoice: Dr AR (gross) / Cr Revenue (net) / Cr Output Tax (tax).
  - Purchase: Dr Expense (net + non-recoverable tax) / Dr Input Tax (recoverable tax) / Cr AP or Bank (gross).
  - Reverse charge purchase: Dr Expense (net) / Cr AP (net), plus Dr Input Tax (recoverable part) / Cr Output Tax (full). It nets to zero only when fully recoverable.
- **Liability accounts:** either separate Output Tax (liability) and Input Tax (asset) accounts, or one "VAT Control" liability account. Separate accounts make the return boxes easier to audit, and both net into "Tax payable" on the balance sheet.
- **Tax return workflow:**
  1. Pick the period (monthly/quarterly) and basis (accrual/invoice vs cash; **[JURISDICTION]**).
  2. Aggregate taxable amounts and tax per box from posted lines dated in the period (accrual) or from payments in the period (cash).
  3. Show drill-down to source lines.
  4. "File" (a manual mark, since the app is offline) posts a settlement transaction: Dr Output Tax / Cr Input Tax / Cr VAT Payable (or Dr VAT Receivable for a refund).
  5. Lock the period's tax-relevant transactions (separate tax lock date).
  6. Record the payment to the authority against VAT Payable.
- **Late adjustments:** any later change to a filed period must land in the *next* return as an adjustment, never silently alter a filed return. So the return stores a snapshot of included line IDs and totals.
- **US sales tax** is generally single-stage, collected on sales only with no input credit. Purchases' sales tax is just part of the expense cost, so tax codes for US users usually have `recoverable_pct = 0` on purchases. **[JURISDICTION]** (General knowledge, not sourced this session.)

### Gaps
- EU VAT Directive reverse charge (art. 196), EU OSS, Australian GST/BAS, Canadian GST/HST/QST and US state sales-tax specifics weren't researched. Treat them as plug-in jurisdiction modules.
- UK Making Tax Digital (digital record-keeping and API filing) requirements weren't covered. An offline app couldn't file via MTD anyway without bridging software.

---

## 9. Multi-currency: transaction vs home currency, rates, realized and unrealized FX gains/losses

### Takeaway
Every posting stores its transaction-currency amount *and* its home (functional) currency amount at the rate used. Each transaction must balance in home currency, and per currency where possible. On settlement, the difference between the home value at the invoice rate and at the payment rate is a **realized** FX gain/loss. At period end, open *monetary* items (foreign-currency bank balances, AR, AP, loans) are revalued to the closing rate, and the difference posts as **unrealized** FX gain/loss, typically auto-reversed on day 1 of the next period. Non-monetary items stay at historical rates.

### Cited Findings
- IAS 21: at the reporting date, monetary items (cash, receivables, payables) are retranslated at the closing rate. Exchange differences arising on settlement or retranslation of monetary items are recognised in profit or loss in the period they arise. The exception is monetary items forming part of a net investment in a foreign operation, which go to OCI in consolidated statements. — [LearnSignal: IAS 21](https://www.learnsignal.com/blog/ias-21-the-effects-of-changes-in-foreign-exchange-rates/); [ACCA: IAS 21 article](https://accaglobal.com/an/en/member/discover/cpd-articles/corporate-reporting/ias21-exchange.html)
- IAS 21 doesn't distinguish "realized" from "unrealized" for recognition purposes. Both go to profit or loss when they arise. — [LearnSignal: IAS 21](https://www.learnsignal.com/blog/ias-21-the-effects-of-changes-in-foreign-exchange-rates/) (search summary)
- Fowler's Money pattern: never add amounts in different currencies without explicit conversion. — [Martin Fowler: Money](https://martinfowler.com/eaaCatalog/money.html)
- Beancount builds a per-commodity daily price time series from transactions and `price` directives, and uses it for market value and unrealized gains. `@` price annotations record conversion rates, and `{}` cost basis tracks lots. — [Beancount: Inventories](https://beancount.io/docs/Basics/inventories)

### Inferences
- **Posting schema:** `amount_minor` + `currency` + `home_amount_minor` + `rate` (decimal string, transaction currency → home). Invariants: Σ `home_amount_minor` = 0 per transaction, and for single-currency transactions also Σ `amount_minor` = 0.
- Cross-currency transactions (for example a EUR card purchase settled in a USD account) have postings in different currencies. The home amounts balance, with an FX gain/loss or rounding posting if needed.
- **Rates:** offline means the user or agent enters rates or imports a rate CSV into a `rates(date, from, to, rate, source)` table. Default to the transaction date's rate (IAS 21's spot rate at transaction date; an average rate for a period is commonly allowed as an approximation, though that IAS 21 wording wasn't fetched here). The *bank's actual* converted amount from the statement is authoritative for bank postings.
- **Realized gain/loss on payment:**
  - Invoice EUR 1,000 at 1.10 → USD 1,100 AR.
  - Payment EUR 1,000 received when the rate is 1.08 → USD 1,080 cash.
  - Posting: Dr Bank USD 1,080 (EUR 1,000), Dr FX Loss USD 20, Cr AR USD 1,100 (EUR 1,000). The AR in EUR is fully cleared.
- **Unrealized revaluation (period end):**
  - For each open foreign-currency monetary balance (bank accounts in foreign currency, open AR/AP items, foreign loans), compute closing-rate home value − carried home value.
  - Post Dr/Cr Unrealized FX Gain/Loss vs each account, in home currency only (foreign amount 0).
  - Auto-reverse on the first day of the next period, so the realized gain at settlement is computed against the original rate.
  - Store the revaluation run (rate table snapshot) for audit.
- **Non-monetary items** (equipment, prepaid expenses, inventory, equity) are never revalued.
- **Reports** are in home currency by default, with optional "show foreign amounts" columns. Foreign bank account registers show the account's own currency.

### Gaps
- The full text of IAS 21 paragraphs 21-23 (initial recognition and the average-rate allowance) wasn't retrieved (the IAS Plus fetch returned no body).
- The 2025 IAS 21 "lack of exchangeability" amendment wasn't verified.
- US GAAP ASC 830 wasn't researched.

---

## 10. Financial statements: P&L, balance sheet, cash flow (indirect), trial balance, general ledger, aged AR/AP, comparisons, accrual/cash

### Takeaway
All statements are queries over the same immutable postings:
- trial balance = per-account balances (debits = credits);
- P&L = income/expense movement over a period;
- balance sheet = asset/liability/equity balances at a date plus computed current-year earnings;
- general ledger = per-account postings with running balance;
- cash flow (indirect) = net income ± non-cash items ± working-capital changes, plus investing and financing, reconciling to the change in cash.

### Cited Findings
- The indirect method starts with net income and adds back non-cash expenses like depreciation and amortization.
  - "If a current asset's balance (other than cash) had increased, the amount of the increase is subtracted from the amount of net income", and decreases are added.
  - "If a current liability's balance (other than loans payable) had increased, the amount of the increase is added."
  - Investing activities are purchases and sales of noncurrent assets.
  - Financing activities are issuing and repurchasing stock/bonds, dividends, and borrowing/repaying loans.
  - The net change in cash must agree with the balance-sheet cash change.
  — [AccountingCoach: Cash flow statement](https://www.accountingcoach.com/cash-flow-statement/explanation)
- The post-closing trial balance contains only permanent accounts. — [LedgerLoom ch.4](https://ledgerloom.readthedocs.io/en/stable/workbook/ch04_closing_and_post_close.html)
- Aged AR/AP buckets: current, 1-30, 31-60, 61-90, 90+. — [Metabase](https://www.metabase.com/metrics/accounts-receivable-aging)
- Cash-basis P&L uses proportional allocation of payments to invoice lines. — [QuickBooks](https://quickbooks.intuit.com/learn-support/en-us/sales-taxes/handle-cash-basis-sales-tax/00/248797)

### Inferences
- **Cash-flow classification as data:** give each account a `cash_flow_category ∈ {cash, operating_wc, non_cash_addback, investing, financing, equity_owner}`. Defaults: AR/AP/inventory/prepaids/accruals → operating; fixed assets → investing; loans, owner capital and drawings → financing; accumulated depreciation → non-cash add-back.
- Compute the indirect method as `NI + Σ(non-cash) − Δ(operating current assets) + Δ(operating current liabilities) + investing Δ + financing Δ`.
- Assert the result equals Δ(cash accounts). Show any residual as an "unclassified" line rather than hiding it.
- For personal users, a direct-method "money in/out by category" view is usually more useful.
- **Comparisons:** P&L columns for this period vs the prior period/same period last year/budget, with Δ and Δ%. Balance sheet as of multiple dates. A period selector with presets (this month, quarter, fiscal year, YTD, last N months, custom) and a configurable fiscal-year start.
- **Balance sheet equity section:** contributed capital, drawings, retained earnings (computed or posted), current-year earnings (computed). Check: Assets = Liabilities + Equity.
- **Drill-down everywhere:** report cell → GL postings → transaction. The agent needs the same: `reports.run(type, params)` returns structured rows with account IDs, so it can follow up with `ledger.query`.
- **Accrual/cash toggle** applies to P&L, tax reports and the cash-flow view. Balance-sheet cash basis is non-standard (it removes AR/AP), so offer it with a warning or not at all.

### Gaps
- No primary standard (IAS 7 / ASC 230) text was fetched. The classification guidance comes from AccountingCoach.

---

## 11. Period close: lock dates, checklist, year-end retained earnings, audit trail (immutability, void vs delete, reversing entries)

### Takeaway
Close by setting a **lock date**: no postings can be created or changed on or before it. Optionally use a softer lock with override and a hard lock. Lock only after a checklist passes. Posted transactions are immutable. Corrections are reversing (or difference) entries dated in an open period, and "delete" is allowed only for drafts. Keep an append-only audit log of every operation, including who: user vs agent.

### Cited Findings
- Xero has two lock dates. A "Period lock date ... stops all users except advisers from making changes on or before the set date". An "Adviser lock date ... stops all users, including advisers". After setting one, "users can't add or edit transactions ... if the transaction date is earlier than the lock date". — [Chargebee KB: Xero lock dates](https://www.chargebee.com/docs/billing/1.0/kb/accounting/xero-lock-dates); [Wise-Sync: Xero lock dates FAQ](https://cw.wise-sync.com/support/solutions/articles/36000041312-faq-setting-and-working-with-lock-dates-in-xero)
- Users have asked Xero for separate lock dates for sales tax vs the accounting period, which shows the need for a tax-specific lock. — [Xero Product Ideas](https://productideas.xero.com/forums/967136-banking-chart-of-accounts/suggestions/49408478-lock-date-separate-lock-dates-for-sales-tax-and)
- Modern Treasury ledger transactions are `pending` (mutable), `posted` (immutable) or `archived` (cancelled, for example a failed payment). "Once a ledger transaction is posted or archived its status and entries are immutable". Metadata is still editable. "To undo the effect of a posted Ledger Transaction, you will need to write a second reversing Ledger Transaction." — [Modern Treasury docs: Ledger Transaction object](https://docs.moderntreasury.com/reference/ledger-transaction-object) (via search summary)
- On mutation: "if the data has been mutated, then the data is irreversibly destroyed and becomes impossible to figure out what changed." Corrections are either a full reversal plus a new correct entry, or a single differential adjustment. — [Modern Treasury: Enforcing immutability](https://moderntreasury.com/journal/enforcing-immutability-in-your-double-entry-ledger)
- Fowler's adjustment patterns:
  - **Reversal Adjustment**: keep the wrong entry, post the opposite, post the correct one.
  - **Replacement Adjustment**: delete and recreate, which loses history.
  - **Difference Adjustment**: post only the delta.
  — [Martin Fowler: Accounting Narrative](https://martinfowler.com/eaaDev/AccountingNarrative.html)
- Adjusting entries at period end: accrued expenses, accrued revenues, prepaid expenses (deferrals), unearned revenues, and depreciation (Dr Depreciation Expense / Cr Accumulated Depreciation). — [AccountingCoach: Adjusting entries](https://www.accountingcoach.com/adjusting-entries/explanation)
- Closing entries zero the temporary accounts into retained earnings, and the post-closing trial balance contains only permanent accounts. — [LedgerLoom ch.4](https://ledgerloom.readthedocs.io/en/stable/workbook/ch04_closing_and_post_close.html)

### Inferences
- **Lock model:** `books_lock_date` (hard: rejects any create/update/delete with date ≤ lock) and `tax_lock_date` (rejects changes to tax-coded lines in filed periods). Single user means no adviser override. Unlocking is an explicit, audited action with a reason. The agent should be able to *propose* an unlock but require user confirmation (permission tier).
- **Month-end checklist** (each item is an automated check that links to a fix screen):
  1. All bank and card accounts reconciled through the period end (last reconciliation date ≥ period end).
  2. Unreconciled items older than N days reviewed.
  3. Uncategorized/Suspense balances = 0 for the period.
  4. No unmatched imported lines in the inbox for the period.
  5. Transfers-in-transit clearing account = 0, or explained.
  6. Recurring journals run: depreciation, prepaid amortization, accruals.
  7. AR/AP aging totals = control account balances.
  8. Tax return for the period prepared/filed (if applicable).
  9. FX revaluation run (if multi-currency).
  10. Trial balance balances, and no integrity errors (section 14).
  11. Review P&L vs prior period for anomalies.
  12. Set the lock date.
- **Year-end:** run the month-end checklist for the last month, then optionally post the closing transaction (temporary accounts → Retained Earnings, drawings → capital/RE), lock the year, and open the new year (computed balances carry forward automatically, so no opening entries are needed inside the same book).
- **Void vs delete:**
  - Draft: hard delete is OK (log it).
  - Posted, period open, not reconciled, no allocations: "void" creates a reversal dated either the original date (if open) or today, and marks the original `voided_by`. Both remain visible, and reports net them to zero.
  - Posted and reconciled or allocated: void is blocked until it is unreconciled or unallocated.
  - Locked period: corrections must be dated in the open period (a prior-period adjustment).
- **Edit semantics:** to keep the UI friendly, "edit a posted transaction" can be implemented internally as reversal + new version, linked with `supersedes_id`. Alternatively, if the app keeps mutable rows, the audit log must store full before/after snapshots. Prefer immutable versioning.
- **Audit log:** append-only `events(id, ts, actor: user|agent:<session>, operation, entity, entity_id, before_json, after_json, reason, idempotency_key)`. Since the agent uses the same operations as the UI, every write goes through one command layer that validates (balance, lock, reconciliation), logs, and applies atomically. Optionally hash-chain the events so tampering is detectable. **[JURISDICTION]** Some regimes (for example Germany's GoBD, or France's anti-fraud software rules for cash systems) mandate immutability/traceability. These weren't researched here.
- **Reversing entries for accruals:** support "auto-reverse on date X" on a journal, so month-end accruals reverse on day 1 of the next month.

### Gaps
- Jurisdiction-specific audit-trail mandates (GoBD, French LF 2016 art. 88, UK MTD digital links) weren't fetched.
- No source was found on record-retention periods (often 5-7 years, varying by country).

---

## 12. Recurring transactions, budgets vs actuals, cash flow forecasting basics

### Takeaway
Recurring items are *templates plus a schedule* that generate drafts or postings on due dates (invoices, bills, journals such as depreciation and amortization, expected bank payments). Budgets are per-account, per-period target amounts compared against actuals from the ledger. A basic cash forecast = current cash + scheduled/recurring inflows and outflows + open AR/AP by expected date, projected forward.

### Cited Findings
- Adjusting entries that recur every period (depreciation, prepaid amortization, accrued interest) are standard period-end items. — [AccountingCoach: Adjusting entries](https://www.accountingcoach.com/adjusting-entries/explanation)
- Aging distribution gives a forward view of cash: if most AR is current or 1-30 days, inflows are predictable, and if it is migrating to 60+, forecasts must allow for delays. — [Metabase: AR aging](https://www.metabase.com/metrics/accounts-receivable-aging)
- Loan amortization: fixed payment M = P·r·(1+r)^n / ((1+r)^n − 1). Each period's interest = balance × r and principal = payment − interest. — [Wikipedia: Mortgage calculator](https://en.wikipedia.org/wiki/Mortgage_calculator); [Chase: Loan amortization](https://chase.com/personal/mortgage/education/financing-a-home/loan-amortization)

### Inferences
- **Recurring template:**
  ```
  {kind: invoice|bill|journal|expected_txn, template_payload, schedule: RRULE (FREQ=MONTHLY;BYMONTHDAY=-1 etc.),
   start, end|count, next_run, mode: draft|auto_post, last_generated_id}
  ```
  - Generation is idempotent: a unique key of (template_id, occurrence_date), so a missed app launch catches up without duplicates.
  - Since the app is offline and local, generation runs on app open or agent invocation, not on a server cron.
- **Expected transactions** (rent, subscriptions) generated as "scheduled", not posted. They should *match* the imported bank line when it arrives (section 4) instead of duplicating it.
- **Budgets:** `budget(id, name, fiscal_year)`, `budget_lines(account_id, period_yyyymm, amount_minor)`. Offer fill helpers: copy last year's actuals ± %, even split of an annual figure. Report: actual, budget, variance, variance %, per period and YTD. Sign-normalize so a favourable variance is clear for both income and expense. Personal users may prefer envelope-style budgets. Whether to support that is a product decision, but keep the double-entry budget as variance reporting only.
- **Cash forecast (13-week or 12-month):**
  - Start: current cleared and uncleared cash balances.
  - Add: open invoices by due date (optionally adjusted by the customer's average days-late), recurring templates, scheduled expected transactions, open bills by due date, loan schedules, and budgeted lines not covered by the above.
  - Show a running balance and flag weeks below a minimum threshold.
- **Loan schedules:** generate the amortization table from principal, rate, term and start. Each payment posts Dr Loan (principal) / Dr Interest Expense (interest) / Cr Bank. Match the imported bank payment to the scheduled split. The bank's actual interest figure wins, and the schedule then re-amortizes.

### Gaps
- No authoritative source on cash-forecasting methodology for small businesses was fetched. The above is standard practice.
- RRULE (RFC 5545) wasn't fetched, though it is the obvious schedule encoding.

---

## 13. Personal finance in double-entry: net worth, credit cards, loans/mortgages, investments at market value

### Takeaway
Personal books use the same five types:
- net worth = assets − liabilities (equity, computed);
- credit cards are liabilities (credit-normal), where a purchase increases the balance owed and a payment from checking is a transfer (not an expense);
- mortgages and loans are liabilities, and each payment splits into principal (reduces the liability) and interest (expense);
- investments are held as quantities of commodities at cost (lots), valued at market using a price table, with unrealized gains shown in reports (or revalued) and realized gains booked on sale.

### Cited Findings
- Liabilities are credit-normal: a credit increases them and a debit decreases them. — [Modern Treasury Part I](https://www.moderntreasury.com/journal/accounting-for-developers-part-i)
- A fixed-rate loan payment splits into interest = remaining balance × periodic rate and principal = payment − interest. Early payments are mostly interest. — [Wikipedia: Mortgage calculator](https://en.wikipedia.org/wiki/Mortgage_calculator); [Wikipedia: Fixed-rate mortgage](https://en.wikipedia.org/wiki/Fixed-rate_mortgage); [Chase](https://chase.com/personal/mortgage/education/financing-a-home/loan-amortization)
- Beancount lots carry cost basis per unit, acquisition date and an optional label. Lot matching on sale uses the cost spec `{}` and the account's booking method (FIFO/LIFO/etc.). Price directives create a daily price series used for net worth over time and unrealized gains vs cost basis. — [Beancount: Inventories](https://beancount.io/docs/Basics/inventories)
- hledger documents investment tracking with commodities, costs and market prices. — [hledger: Track investments](https://hledger.org/investments.html) (not fetched in detail)

### Inferences
- **Net worth report:** assets − liabilities at a series of dates (month-ends), with investments at market value using the latest price ≤ date, plus a trend chart. It is just the balance sheet with equity collapsed into one line.
- **Credit cards:**
  - Purchase: Dr Expense / Cr Card.
  - Payment: Dr Card / Cr Checking.
  - Refund: Dr Card / Cr Expense.
  - Interest/fees: Dr Expense / Cr Card.
  - Reconcile to the card statement's closing balance like a bank account.
  - "Available credit" = limit − balance, as account metadata.
- **Mortgage:** on setup, record the loan (Dr Property / Cr Mortgage, plus a down payment from cash) or just the current balance via opening balances. Escrow, if any, is a separate asset (Escrow) funded by part of the payment, with taxes and insurance paid out of it.
- **Investments:**
  - Brokerage account = a parent with a cash sub-account and holdings by commodity (ticker).
  - Buy: Dr Holdings (qty @ cost) / Cr Brokerage Cash (+ fees to the cost basis or to an expense).
  - Sell: Cr Holdings (qty at lot cost) / Dr Cash (proceeds) / Cr or Dr Realized Gain/Loss.
  - Dividends: Cr Dividend Income / Dr Cash.
  - Market value: `prices(date, commodity, currency, price)` filled manually or by CSV import (offline).
  - Unrealized gain: show it in reports as market value − cost basis (computed, no postings). An optional period-end "mark-to-market" journal to Unrealized Gains (equity/OCI or income) can be a user preference. Beancount-style computation avoids polluting the ledger.
- **Assets at estimated value** (house, car): periodic revaluation journals to an Unrealized Gain/Loss (or Equity:Revaluation) account. Depreciating vehicles may use an expense.
- **Personal "transfers"** (checking → savings, paying the card) must never appear as income or expense. Transfer detection (section 4) is critical for personal users.

### Gaps
- Tax-lot rules (wash sales, average-cost for UK Section 104 pools / Canadian ACB) weren't researched and are **[JURISDICTION]**.
- No primary source was fetched on personal-finance reporting conventions (for example savings rate).

---

## 14. Data-integrity checks the app should run

### Takeaway
Run a validation suite on every write (hard invariants that reject the write) and on demand / before close (soft checks that produce a reviewable list). It is modelled on hledger's `check` command (balanced, assertions, accounts, commodities, payees, ordered dates, recent assertions) plus bookkeeping-specific checks: locked-period writes, unreconciled old items, negative balances, duplicates, control-account ties.

### Cited Findings
- hledger's `check` covers accounts (postings only to declared accounts), commodities, payees, balanced transactions, balance assertions, ordereddates, uniqueleafnames, recentassertions and tags, run in a documented order. — [hledger-lib JournalChecks](https://hackage-origin.haskell.org/package/hledger-lib-1.32/docs/Hledger-Data-JournalChecks.html); [PTA forum: correctness checks RFC](https://forum.plaintextaccounting.org/t/rfc-correctness-checks-ordereddates-balance-assertions-hledger/254); [hledger 1.34 release notes](https://forum.plaintextaccounting.org/t/ann-hledger-1-34-released/281)
- `recentassertions` flags accounts whose latest assertion is more than 7 days before their latest posting. Failed balance assertions stop processing with the location. — [hledger: Checking for errors](https://hledger.org/checking-for-errors.html)
- Enforce sum(debits) == sum(credits) per transaction. — [Modern Treasury Part II](https://www.moderntreasury.com/journal/accounting-for-developers-part-ii)
- camt.053 ElctrncSeqNb supports gap/duplicate detection between statements. In batch entries, the TxDtls amounts must sum to the parent entry amount. — [Mambu camt.053](https://docs.mambupayments.com/docs/camt053-xsd-business-logic)
- AR aging ties to receivables, and reconciliation must reach a zero difference. — [AccountingCoach: Bank reconciliation](https://www.accountingcoach.com/bank-reconciliation/explanation)

### Inferences
**Hard invariants (reject the write):**
1. Each transaction balances: Σ home amounts = 0 (and per currency for single-currency transactions). It has at least 2 postings and no zero-only transactions.
2. Each amount has a valid currency, and its precision ≤ the currency exponent.
3. The account exists, is active (not archived) on the transaction date, and is not a parent/header account if headers are non-postable.
4. Date > books lock date (and > tax lock date for tax-coded lines).
5. No edits to reconciled postings or allocated documents without an explicit unreconcile/unallocate.
6. Payment allocations ≤ document open balance, and Σ allocations ≤ payment amount.
7. Unique (account, bank_txn_id). Unique document numbers per series.

**Soft checks (an integrity report with a fix link per item):**
1. Possible duplicates: same account, same amount, |Δdate| ≤ 3 days, similar payee, neither linked to a distinct bank_txn_id. Also duplicate vendor bill references.
2. Unreconciled items older than N days (for example 60) in reconciled accounts.
3. Accounts with no reconciliation or balance checkpoint within the last statement cycle (hledger-style "recent assertions"). Balance checkpoints that now fail because of later edits to the period.
4. Uncategorized/Suspense/Opening-Balance-Equity residual balances, and a non-zero Transfers-in-transit balance.
5. Negative balances where implausible: a bank account below zero without a flagged overdraft, a cash-on-hand balance below zero, a credit card with a debit balance (overpaid), a negative inventory quantity.
6. AR/AP control account ≠ the sum of open documents. A tax control account ≠ the sum of unfiled period tax.
7. Overdue invoices/bills. Drafts older than N days.
8. Transactions dated in the future, or far outside the fiscal year (typo years such as 2062).
9. Gaps or overlaps between imported statement periods (seq numbers, date ranges), and statement opening balance ≠ previous closing.
10. FX: foreign-currency balances not revalued at period end. Missing rates for dates used.
11. Recurring templates with missed runs.
12. Trial balance totals equal (a sanity check for the derived-balance cache, if one is kept). Recompute cached balances from postings and compare.

- Surface all of these to the agent as `integrity.run()`, returning machine-readable findings `{code, severity, entity_ids, message, suggested_action}`, so the agent can triage and propose fixes through the normal command layer.

### Gaps
- I didn't find a canonical published list of integrity checks for commercial SMB packages. The above combines hledger's checks with standard bookkeeping review practice.

---
