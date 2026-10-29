# Freelancer/very-small-business and mid-market/ERP accounting products: UI, UX, features and workflows (FreshBooks, Wave, Odoo Accounting 17/18/19, Oracle NetSuite, plus Kashoo and Bonsai)

Scope note: research done in late October 2026. Primary sources are official docs (odoo.com/documentation, docs.oracle.com, support.freshbooks.com, support.waveapps.com) and release notes, plus analyst and review coverage. Wave's support centre and some oracle.com/netsuite.com pages returned HTTP 403 to the fetch tool, so the Wave and NetSuite-AI details below come from search-result excerpts of those official pages (cited to the official URL) or from secondary coverage. Treat vendor-blog or SEO-site claims marked "low reliability" with care. Harvest was not researched in depth (see Gaps in the invoicing section).

---

## 1. Information architecture and home dashboards

### Takeaway
The freelancer tools (FreshBooks, Wave) open on a widget dashboard built around money owed, profit and spending, with a global "Create new" button. Odoo opens on an Accounting Dashboard of per-journal cards, each card a work queue (bank, sales, purchases). NetSuite uses role-published dashboards made of portlets (KPIs, KPI meters, reminders, saved searches, shortcuts). For a single-user app, the useful mix is Odoo-style work-queue cards ("N to reconcile", "N to review"), FreshBooks-style health widgets that can be reordered and hidden, and NetSuite-style reminders that say what needs attention.

### Cited Findings
**FreshBooks dashboard**
- The dashboard is "a quick snapshot of your business' health and cash flow". Users click **Edit Dashboard** to show or hide widgets with checkboxes and reorder them by dragging the **::** handle. — [FreshBooks Support: Dashboard](https://support.freshbooks.com/hc/en-us/articles/115015407988)
- The widgets are:
  - **Outstanding Invoices**: Overdue vs Outstanding totals plus accounts aging by interval, with a currency toggle. The "Overdue" and "Outstanding" links open filtered invoice lists.
  - **Payout Overview**: FreshBooks Payments, which is Stripe-powered. It has instant payout and a "View Payout History" link.
  - **Bank Connections**: Plaid or Yodlee connections with a "Connected" / "Connection Issue" status and a "Manage Bank Connections" link.
  - **Profit and Loss**: monthly income, expenses and net profit on a "Billed (Accrual)" basis. Filters are date range (default "This year"), group by month or quarter, currency and accounting method.
  - **Revenue and Expenses** (hidden by default): six months of "Amount Received" plus outstanding invoices vs "Amount Spent" plus outstanding bills.
  - **Monthly Recurring Revenue** (Select plan only): recurring revenue from templates and retainers, with a forecast.
  - **Total Profit (Cash Based)** (hidden by default): "Collected (Cash-Based)".
  - **Revenue by Client**: top 4 clients plus "Other Client(s)".
  - **Spending**: expenses grouped "by expense parent category".
  - **Unbilled Time**: hours by client, toggled between "Unbilled Amount" and "Unbilled Time".
  - A **Create New** button creates clients, invoices, expenses, estimates, bills, vendors and other records.

  — [FreshBooks Support: Dashboard](https://support.freshbooks.com/hc/en-us/articles/115015407988)
- On the Total Profit graph, tooltip circles show Sales, COGS and Expenses, and a "Profit & Loss Report" link in the top-right corner drills down. — [FreshBooks Support (search excerpt)](https://support.freshbooks.com/hc/en-us/articles/115015407988); [FreshBooks blog: dashboard widgets](https://www.freshbooks.com/blog/dashboard-widgets)

**Wave navigation**
- The left-side menu is:
  - **Create new**: transaction, estimate, invoice, recurring invoice, bill, customer, vendor, product or service.
  - **Dashboard**: "View your business at a glance".
  - **Sales & Payments**: invoices, estimates, checkouts, customers, products and services.
  - **Purchases**: bills, vendors, products and services.
  - **Accounting**: the Transactions page, tags and the chart of accounts.
  - **Banking**: connected bank accounts and payout history.

  — [Wave Support: Overview of your Wave account](https://support.waveapps.com/hc/en-us/articles/32453204338324)
- Note that **tags** sit under Accounting next to the chart of accounts, as a lightweight dimension. — [Wave Support: Overview of your Wave account](https://support.waveapps.com/hc/en-us/articles/32453204338324)

**Odoo Accounting dashboard and menus**
- The top-level menus are **Customers** (invoices), **Vendors** (bills), **Accounting** (core records), **Reporting** and **Configuration**. Odoo ships two apps: **Invoicing** (invoices, payments, vendor bills) and **Accounting** (Invoicing plus reporting, bank reconciliation, budgets and assets). — [Odoo 18 docs: Accounting and Invoicing](https://www.odoo.com/documentation/18.0/applications/finance/accounting.html)
- From the Accounting Dashboard, a bank journal card gives two entry points. Clicking the journal name opens all transactions. Clicking **Reconcile items** opens only the transactions Odoo pre-selected for reconciliation. — [Odoo bank reconciliation guide (search excerpt, Odoo partner blog)](https://r-taparia.odoo.com/blog/managing-business-with-odoo-4/mastering-bank-and-credit-card-transaction-reconciliation-with-odoo-erp-accounting-41)
- In Odoo 19 the same view is reached by clicking the journal name on the Accounting Dashboard or the **"x to reconcile"** button on the card. — [Odoo 19 docs: Bank reconciliation](https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/reconciliation.html)
- Currency-rate auto-update can be set up from the Accounting Dashboard. — [Odoo 18 docs: Multi-currency](https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started/multi_currency.html)

**NetSuite role-based dashboards**
- Dashboards are built from **portlets**: KPIs, trend graphs, reminders, report snapshots, tasks, saved searches and navigation shortcuts. — [Cleverence summary of Oracle docs](https://www.cleverence.com/articles/oracle-documentation/dashboards-overview-netsuite-4829/)
- The **KPI Meter** portlet is "a semi-circular meter providing comparison, date range, and threshold values at a glance". — [Cleverence summary of Oracle docs](https://www.cleverence.com/articles/oracle-documentation/dashboards-overview-netsuite-4829/); see also [Oracle docs: Key Performance Indicators](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N595760.html)
- Reminders are clickable, for example for overdue approvals. Admins can publish a standard dashboard layout per role, and what appears follows that role's permissions. For example, a controller sees bank reconciliations and DSO, while a warehouse lead sees open picks. — [Cleverence summary of Oracle docs](https://www.cleverence.com/articles/oracle-documentation/dashboards-overview-netsuite-4829/); [NetSuite: insider's guide to dashboards](https://www.netsuite.com/portal/resource/articles/business-strategy/an-insiders-guide-to-getting-the-most-out-of-your-netsuite-dashboards.shtml)

### Inferences
- **Reusable pattern: action-count cards.** Odoo's journal card with "N to reconcile" and NetSuite's reminders portlet are both "what needs my attention" counters that deep-link into a filtered work queue. For an app an AI agent also runs, the home screen should lead with queues such as "12 bank lines unmatched", "4 agent entries to review", "2 invoices overdue" and "tax period closes in 6 days". Charts come second.
- **Reusable pattern: user-curated widgets.** FreshBooks' Edit Dashboard with checkboxes and :: drag handles is a cheap way to let one user tailor the home screen. Persist the layout locally.
- **Cash vs accrual toggle on the P&L widget.** FreshBooks offers both "Billed (Accrual)" and "Collected (Cash-Based)" profit views. This suits personal and small-business users who think in cash but whose books are accrual.
- Wave's IA (Sales & Payments / Purchases / Accounting / Banking) is the simplest model that still separates AR, AP, the ledger and bank. It is a good default sidebar for a small app.

### Gaps
- I could not fetch Odoo's official description of every journal-card element (graphs, "to validate", "late bills" counts, Upload button) for 18/19. Only the "Reconcile items" / "x to reconcile" entry points are confirmed.
- I found no official documentation of Wave's current dashboard widgets, because the support site returned 403.
- NetSuite's Redwood dashboard redesign: community posts suggest Redwood UI was not generally available and was slower than Classic, but the post date is unclear ([NetSuite Professionals archive](https://archive.netsuiteprofessionals.com/t/23218719/how-can-i-turn-on-redwood-ui-in-netsuite); [Oracle community thread](https://community.oracle.com/customerconnect/discussion/799299/slowness-of-redwood-uis)). Treat its status in late 2026 as unverified.

---

## 2. Hiding or exposing double-entry: simplified income/expense entry vs journals, and how "categories" map to accounts

### Takeaway
Wave and FreshBooks hide double-entry behind "categories" that are really chart-of-accounts accounts, and attach a category to each bank transaction or expense. Journal entries exist but are an advanced path. Odoo is openly double-entry: every invoice, bill and payment generates a journal entry and journal items users can browse and mass-edit. NetSuite is fully GL-based. The pattern worth reusing is a "category" picker that is really an account picker, backed by a visible ledger for power users and the agent.

### Cited Findings
- **Wave: categories are accounts.**
  - To categorize, go to Accounting > Transactions, click the **Category** field and pick an account, or click **Add a new category** to create one. — [Wave Support (search excerpt): Review your transactions / categorizing](https://support.waveapps.com/hc/en-us/articles/208622646)
  - The Chart of Accounts has five tabs: **Assets**, **Liabilities & Credit Cards**, **Income**, **Expense** and **Equity** (owner contributions, drawings, profits). It is reached via Accounting > Chart of Accounts. — [Wave Support: Overview of your Chart of Accounts page](https://support.waveapps.com/hc/en-us/articles/115004972106)
  - "Categorizing transactions in Wave allows you to track your income and expenses under specific accounts in your reports." — [Wave Support (search excerpt)](https://support.waveapps.com/hc/en-us/articles/208621646)
- **FreshBooks: entries vs bank lines.**
  - Reconciliation pairs bank transactions with "FreshBooks Entries" (expenses, invoice payments, bill payments, other income, credits).
  - Some bank lines can be classed without a matching entry: **Mark as Transfer**, **Mark as Owner's Equity**, **Mark as an Expense Refund**. These are effectively canned journal entries with friendly names.

  — [FreshBooks Support: reconcile simple transactions](https://support.freshbooks.com/hc/en-us/articles/360039682172)
- FreshBooks' accounting features, such as Bank Reconciliation, are only on Plus, Premium and Select plans (and trials). — [FreshBooks Support (search excerpt)](https://support.freshbooks.com/hc/en-us/articles/360039682172)
- FreshBooks markets "tax friendly" expense categories "with tax time in mind". — [FreshBooks: expenses and receipts tracking](https://www.freshbooks.com/expenses-and-receipts-tracking)
- **Odoo: explicit double-entry.**
  - "Every entry needs a corresponding and opposite counterpart in a different account, with one account debited and the other credited". Odoo automatically generates journal entries for all transactions.
  - Retained earnings are calculated automatically, "without year-end rollovers".

  — [Odoo 18 docs: Accounting](https://www.odoo.com/documentation/18.0/applications/finance/accounting.html)
- Odoo uses a special **current year's earnings** account type (typically account 999999). At year end, a miscellaneous entry allocates these earnings to equity. — [Odoo 18 docs: Year-end closing](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/year_end.html)
- **Odoo 19 account-picker changes.**
  - You can now "Add descriptions on accounts to explain when to use each account".
  - Income accounts are prioritized on customer invoices, and expense and fixed-asset accounts on bills.
  - Default taxes apply only to invoices and bills, not miscellaneous entries.

  — [Odoo 19 release notes](https://www.odoo.com/odoo-19-release-notes)
- Odoo users can select many lines under Accounting > Accounting > **Journal Items** and change fields such as analytic distribution in bulk. — [Odoo 18 docs: Analytic accounting](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/analytic_accounting.html)

### Inferences
- **Reusable pattern: the category is an account.** Keep one chart of accounts, but label income and expense accounts as "categories" in simple flows (as Wave does). Group them under the five Wave-style tabs.
- **Reusable pattern: account descriptions as guidance** (Odoo 19). Store a one-line "use this when…" description on each account. It helps the human, and it is ideal grounding text for an AI agent choosing an account.
- **Reusable pattern: canned entries named in plain words** (FreshBooks Mark as Transfer / Owner's Equity / Expense Refund). These hide the debit and credit for the common cases where no source document exists.
- **Reusable pattern: context-ranked account pickers** (Odoo 19 puts income accounts first on invoices and expense accounts first on bills). These reduce mis-postings.
- **Automatic current-year earnings** (Odoo) avoids a closing-entry ritual for single users. The balance sheet can compute retained earnings on the fly.

### Gaps
- I did not verify FreshBooks' manual journal entry screen or its chart-of-accounts UI (layout and columns).
- I did not verify NetSuite's "GL Impact" subtab on transactions this session. It is widely known but not sourced here.

---

## 3. Bank import and reconciliation (feeds, statement formats, matching rules, reconciliation screens)

### Takeaway
There are three distinct reconciliation paradigms:
1. **Continuous matching** of each bank line to a ledger entry: FreshBooks, Wave and Odoo.
2. **Side-by-side grids then submit**, followed by a separate statement-reconciliation step: NetSuite's Match Bank Data, then Reconcile Account Statement.
3. **Rules engines** that pre-match or auto-post: Odoo reconciliation models and NetSuite reconciliation rules.

Odoo 19 replaced the three-panel widget of Odoo 17/18 with a simpler list ("Bank Matching" view) that has inline per-row action buttons and keyboard shortcuts. Formats: Odoo imports CAMT.053, CSV, OFX, QIF and CODA. NetSuite's default parsers cover CSV, BAI2, OFX, QFX and CAMT.053. FreshBooks takes bank connections or CSV.

### Cited Findings
**Odoo 17/18 reconciliation widget (superseded in 19)**
- The layout has three panels:
  - **Left**: the transactions list, newest first.
  - **Bottom-right**: counterpart options in tabs: "Match existing entries", "Batch payments", "Manual operations" and "Discuss".
  - **Top-right**: the "resulting entry", showing what is left to balance.
- Buttons are **Validate** (confirm and advance to the next transaction), **To Check** (flag as uncertain, with a matching filter) and **Fully Paid** (close a partially matched invoice).
- Odoo "pre-selects the matching entries automatically" based on reconciliation models, and suggestions are listed first.
- "Lines are silently reconciled unless a write-off entry is required, which launches a reconciliation wizard".

— [Odoo 18 docs: Bank reconciliation](https://www.odoo.com/documentation/18.0/applications/finance/accounting/bank/reconciliation.html)

**Odoo 19 Bank Matching view**
- It is "composed of lines for each transaction of the journal with the newest displayed first".
- Each row shows date, label, partner, action buttons, amount and an ellipsis menu ("Open Journal Entry", "Delete Transaction").
- The suggested-action buttons on each row are **Set Partner**, **Set Account** (write-off), **Receivable/Payable**, **Reconcile** (match invoices, bills, payments), **Batches**, and one button per reconciliation model.
- Once a row is reconciled, its buttons are "replaced with the counterpart entry/entries it was matched with or the account(s) it was written off to".
- Automatic matching runs in sequence: exact matches first, then discounted matches, using partner and amount.
- The default filter is "Not Matched", which you remove to see history.

— [Odoo 19 docs: Bank reconciliation](https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/reconciliation.html)
- The Odoo 19 release notes add:
  - The reconciliation interface is "simplified", with "Keyboard shortcuts" on reconciliation views.
  - "Draft entries can now be reconciled", and related exchange and cash-basis moves are generated as drafts.
  - Users can "Fully reconcile or write off partially reconciled items".
  - Starting and ending balances can be corrected manually after a statement goes through OCR.

  — [Odoo 19 release notes](https://www.odoo.com/odoo-19-release-notes)
- The docs do not list the individual shortcut keys. — [Odoo 19 docs](https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/reconciliation.html)

**Odoo reconciliation models (the rule engine)**
- There are three types:
  1. **Button to generate counterpart entry**: a one-click button in reconciliation that sets accounts, amounts, labels and analytic distribution.
  2. **Rule to suggest counterpart entry**: for recurring transactions.
  3. **Rule to match invoices/bills**.
- Conditions are label contains, amount, partner, journal and **regex**.
- **Auto-validate** reconciles without user action when the conditions are met perfectly.
- **Payment tolerance** handles underpayments such as cash discounts.
- **Partner mapping** sets the partner from text in labels or notes.
- The defaults are an invoices/bills perfect match, partial-payment underpayment handling and bank-fee identification by label.
- "Sequencing matters": the perfect-match model should run first.

— [Odoo 18 docs: Reconciliation models](https://www.odoo.com/documentation/18.0/applications/finance/accounting/bank/reconciliation_models.html)
- Odoo 19: "Automated reconciliation models" were enhanced for better transaction recognition. — [Odoo 19 release notes](https://www.odoo.com/odoo-19-release-notes)

**Odoo statement import and manual entry**
- Supported formats are **SEPA CAMT.053**, **CSV**, **OFX**, **QIF** and **CODA** (Belgium).
- CSV import has three steps: pick the file, set formatting options, then map columns to Odoo fields. You run a **test** before importing.
- Manual entry: open the bank journal, click **New**, and fill **Partner** and **Label** "to ease the reconciliation process".
- Statements are *optional containers* for transactions. Users must "create an opening transaction" for the initial balance.
- Statements are created from the kanban view with the **Statement** button on separator lines between transactions, or in the list view by selecting lines and setting the **Statement** column.

— [Odoo 18 docs: Transactions](https://www.odoo.com/documentation/18.0/applications/finance/accounting/bank/transactions.html)

**NetSuite Match Bank Data and Reconcile Account Statement**
- The **Match Bank Data** page shows "side-by-side grids of imported bank lines and account transactions". From it you can:
  - match;
  - mark account transactions "cleared pending submission" when no bank line exists;
  - exclude imported bank lines;
  - review matched and user-cleared transactions;
  - **Submit** to clear.
- The **Reconcile Account Statement** page then reviews submitted transactions, includes or excludes them, and finalizes the statement.
- **Intelligent Transaction Matching** runs reconciliation rules automatically on import.
- **Automated Cash Application** generates customer payments from bank lines and auto-creates, matches and clears them.
- The feature is switched on per account with the **"Use Match Bank Data and Reconcile Account Statement Pages"** checkbox. Manual reconciliation without import is supported.

— [Oracle docs: Bank Data Matching and Reconciliation](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_4842302228.html)
- System reconciliation rules compare **Amount**, **Date**, **Transaction number** (check numbers and IDs) and **Number format** (ignore prefixes and leading zeros). Users can add custom rules on supported fields. — [Oracle docs search excerpt: Matching Bank Data](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4843222719.html) (the page itself returned 404 when fetched)
- A **Run Reconciliation Rules** button re-runs the automatic matching on demand. — [NetSuite Professionals archive](https://archive.netsuiteprofessionals.com/t/23155612/how-does-the-run-reconciliation-rules-button-work-on-the-mat)
- 2025.2 added bulk selection across pages (even with filters applied) and bulk submit or undo of matched and cleared GL transactions, on both pages. — [Rand Group: NetSuite 2025.2](https://www.randgroup.com/insights/oracle-netsuite/netsuite-2025-2-release-featured-updates-and-enhancements/)
- Import routes:
  - The default parsers support CSV, BAI2, OFX, QFX and CAMT.053.
  - BAI2 can carry multiple accounts in one file.
  - CSV requires configuring a CSV parser (a column map).
  - The Bank Feeds SuiteApp does automated daily imports.

  — [Oracle docs: Supported File Formats for Default Parsers](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1508961121.html); [invoicedataextraction.com explainer](https://invoicedataextraction.com/blog/import-bank-statements-netsuite)

**FreshBooks reconciliation**
- The screen has two columns: **"Unreconciled Bank Transactions"** on the left and **"FreshBooks Entries"** on the right.
- **Unmatched** is the default sub-tab, and a **Matched** sub-tab shows history. Users reach the screen from Accounting via the **"# left to match"** link on each account.
- Buttons are **Match**, **Mark As** (Transfer / Owner's Equity / Expense Refund) and **Unmatch Transactions**.
- **"Likely Matches"** are shown as rows with checkboxes. Users can **Confirm and Continue** (accept all), uncheck bad pairs, or **Skip** to review one at a time.
- A settings icon next to search filters by date range and entry type (Payments, Check Payments, Expenses, Credits, Bill Payments).

— [FreshBooks Support: reconcile simple transactions](https://support.freshbooks.com/hc/en-us/articles/360039682172)
- Reconciliation is continuous ("rather than reconciling statement periods"). The selected bank amount must equal the selected FreshBooks amount. Once all bank lines are assigned, the bank and FreshBooks balances at the top of the screen should be equal. Sources are a bank connection or manually uploaded CSV. The Reconciliation Start Date can go back only to the first imported transaction, and connections pull at most 90 days. — [FreshBooks Support (search excerpt)](https://support.freshbooks.com/hc/en-us/articles/360039682172)

**Wave transactions and auto-categorization**
- Wave auto-categorizes bank-imported transactions **once every 24 hours** and merges certain duplicates (Pro plan). It "needs to learn" from the user's manual categorizations before auto-categorization starts. — [Wave Support: Automated bookkeeping with auto-updates](https://support.waveapps.com/hc/en-us/articles/4988928647188)
- Auto-categorized or merged transactions show a **purple highlight**. A **thumbs-up icon** confirms the category, or the user recategorizes. Wave learns from these choices. Users can **mark as reviewed**, and can view all transactions that were auto-categorized, merged, or "created from a scanned receipt". — [Wave Support: Review auto-updates to your transactions](https://support.waveapps.com/hc/en-us/articles/26387836091668) (search excerpt; the page returned 403)
- The Transactions page lets users view, create, filter, sort and edit transactions. — [Wave Support: Overview of the Transactions page](https://support.waveapps.com/hc/en-us/articles/208621646); [Wave Support: Filter and sort your transactions](https://support.waveapps.com/hc/en-us/articles/25233855417492-Filter-and-sort-your-transactions)
- Pricing change: automatic bank imports moved behind the Pro paywall (about $16–19/month), which frustrated users who had relied on them for free. — [checkthat.ai review aggregator](https://checkthat.ai/brands/wave/reviews) (aggregator, moderate reliability); the Pro plan is listed at $19/month or $170/year with "automatic bank transaction imports, automatic merging and categorization" — [Merchant Maverick](https://www.merchantmaverick.com/reviews/wave-accounting-review/) / [FitSmallBusiness](https://fitsmallbusiness.com/wave-review)

**Kashoo**
- Kashoo offers "automatically reconcile bank feeds from connected bank accounts", but users report inconsistent bank syncing and matching. One review says the reconciliation statement is not automated. — [crm.org Kashoo review 2025](https://crm.org/news/kashoo-review); [The CFO Club](https://thecfoclub.com/tools/kashoo-review/)

### Inferences
- **The best rules UI for a local app is Odoo's three-type model:** buttons, suggestion rules and match rules. Conditions are label/regex, amount range, partner and account, with an "auto-validate" flag and an explicit **sequence**. For an AI agent this maps neatly: the agent can propose a new rule from repeated manual decisions, and the user approves it once.
- **Odoo 19 is the better layout for a single user:** a dense list of bank lines with inline suggestion chips. Clicking a chip resolves the line, and the chip is then replaced by what it matched. Add keyboard navigation (j/k or arrow keys, Enter to accept, a key for "To Check"). The three-panel 17/18 widget is heavier and was deprecated in 19.
- **Batch acceptance of high-confidence matches** (FreshBooks "Likely Matches" with Confirm and Continue / Skip) is the right AI-review idiom. Show a checklist of proposed pairs, all pre-checked, so the user unchecks the bad ones and confirms in one click.
- **Keep two concepts separate:** *matching* (continuous, line by line) and *statement reconciliation* (a periodic check that the ending balance agrees, as on NetSuite's Reconcile Account Statement page). A local app benefits from both: continuous matching for daily use, and a statement sign-off that the period-close checklist can require.
- **Import formats a local app should support:** CSV with a saved column mapping and a test or preview step (Odoo, NetSuite), plus OFX/QFX, QIF and CAMT.053. BAI2 is mostly a US corporate format and is optional.
- **"To Check" / "needs review" as a first-class status** (Odoo To Check, Wave purple highlight and thumbs-up). Every agent-posted bank categorization should land in this state until confirmed.

### Gaps
- I could not confirm the Odoo 19 reconciliation keyboard shortcut keys. They are announced but not listed in the fetched docs.
- The full column list of NetSuite's Match Bank Data grids was not retrievable (404 on the section page).
- Wave's statement-upload formats (CSV/OFX/QFX) and the Transactions page column layout could not be verified, because the support pages returned 403.
- I did not verify FreshBooks' CSV import column requirements.

---

## 4. Invoicing, estimates, recurring invoices, payments, late reminders, client portals, time-to-invoice

### Takeaway
FreshBooks is the reference for service-business invoicing. It turns tracked time into invoices with a "Review Unbilled Time" dialog and supports deposits, retainers, recurring invoices, automatic reminders and a client portal. Wave covers recurring invoices, a "Pay now" button and fixed 3/7/14-day reminders (Pro). Odoo has configurable **follow-up levels** (email, SMS, letter, manual action) and a customer statement or follow-up report. Bonsai chains proposal, contract and invoice for freelancers.

### Cited Findings
- **FreshBooks time-to-invoice.**
  - Time Tracking > **Generate Invoice** (top right) > pick the client, whose unbilled hours show next to the name > **Continue**.
  - A **Review Unbilled Time** pop-up then offers:
    - **Date Range**: All Time, This Month, Last Month or Custom.
    - **Choose Projects**: Select All, or individual projects.
    - Time-entry format: **Detailed**, **Grouped** or **Simple**.
  - Entries are automatically marked billed, and unbilled project or client expenses can be added in the same flow.

  — [FreshBooks Support (search excerpt)](https://support.freshbooks.com/hc/en-us/articles/227602308); [FreshBooks: mark time as unbilled](https://www.freshbooks.com/hub/feature-news/mark-time-as-unbilled)
- FreshBooks billing features include automatic customizable **Payment Reminders**, a **Client Self-Service Portal**, automated **Recurring Invoices** (with reminders for late payers), **Deposits** requested on estimates, Buy Now Pay Later, and **Client Retainers**. — [FreshBooks features](https://freshbooks.com/features)
- Estimates and proposals convert to invoices or projects. — [softwareconnect FreshBooks review](https://softwareconnect.com/reviews/freshbooks)
- **Wave invoicing.**
  - Recurring invoices need the Pro Plan or online payments, and can switch between automatic and manual billing on any schedule.
  - Customers can get automatic reminders **3, 7 and 14 days after the due date** (Pro).
  - Online payments add a secure **"Pay now"** button on the invoice.

  — [Wave: recurring billing](https://www.waveapps.com/payments/recurring-billing); [Wave Pro](https://waveapps.com/pro); [Wave invoicing](https://waveapps.com/invoicing)
- **Odoo follow-ups.**
  - Configured under Accounting > Configuration > **Follow-up Levels**. Each level has a Description, Due Dates (days overdue) and actions: email, SMS, letter, or a **Manual Action** that assigns someone to call. The list shows which channels are enabled.
  - The **Customer Statement** (follow-up letter) can be customized, sent by email or print, can zoom into open invoices and payments, and schedules the next follow-up.

  — [Cybrosys: follow-up levels in Odoo 18](https://www.cybrosys.com/blog/overview-of-follow-up-levels-and-follow-up-in-odoo-18); [Odoo docs (older, readthedocs mirror): automated follow-ups](https://documentation-user.readthedocs.io/en/latest/accounting/receivables/getting_paid/automated_followups.html)
- Odoo 19 additions:
  - A new partner-ledger variant, the **follow-up report**, separates overdue from due invoices.
  - WhatsApp messages can be used on follow-up levels.
  - You can "Exclude specific moves from follow-ups".
  - Invoice duplicate detection uses **red** ("highly likely duplicates") and **yellow** ("potential") warnings, highlighted on the Reference field in lists.

  — [Odoo 19 release notes](https://www.odoo.com/odoo-19-release-notes)
- **Kashoo** invoicing uses customizable templates with automatic reminders. — [crm.org Kashoo review](https://crm.org/news/kashoo-review)
- **Bonsai**: "create a proposal, turn it into a contract, and then your invoices are ready to go". It bundles CRM, time tracking, contract templates and accounting or tax estimates. Reviewers praise the "well-designed and user-friendly platform". — [Capterra: Bonsai reviews](https://capterra.com/p/238825/Bonsai/reviews/); [GetApp: Bonsai](https://www.getapp.com/project-management-planning-software/a/bonsai/reviews/)

### Inferences
- **The unbilled-time to invoice dialog** (FreshBooks: date range, projects, Detailed/Grouped/Simple line format, auto-mark-billed) is directly reusable. It is also an ideal agent task: "Draft April invoice for Client X from unbilled time", which the user reviews in the same dialog.
- **Reminder schedules as data:** Odoo-style levels (days overdue, then channel and template) generalize Wave's fixed 3/7/14 days. For a local single-user app without email infrastructure, the "channel" can be "create a task or reminder for the user" or "agent drafts the email".
- **Duplicate-invoice warnings in two severities** (Odoo 19 red/yellow) are a cheap safeguard, especially when an agent creates documents.
- A client portal is mostly irrelevant for a local single-user app. A shareable PDF plus a payment link is the realistic equivalent.

### Gaps
- Harvest was not researched (time-tracking-to-invoice is covered by the FreshBooks example).
- I did not get FreshBooks' per-invoice screen layout (line columns, tax columns, the "Send" flow) or its reminder schedule options.
- I did not verify Wave's estimate-to-invoice conversion or its customer statements.

---

## 5. Bills and payables, receipt scanning, expense reports

### Takeaway
All four products have converged on "capture, extract, draft, human review, post". Odoo digitizes bills by upload, drag-drop or a per-journal email alias. It shows extracted values highlighted on the document preview and has a "Reload AI data" action. NetSuite Bill Capture (OCI Document Understanding) shows the source file in a **split view** next to the created bill. FreshBooks' app extracts merchant, total and taxes, then moves reviewed documents into Expenses or Bills. Wave Receipts creates transactions from scanned receipts that land in the review queue.

### Cited Findings
- **Odoo bill digitization.**
  - Settings offer three modes: **Do not digitize**, **Digitize on demand only** (a manual "Digitize document" action) or **Digitize automatically**. An optional **Single Invoice Line Per Tax** setting collapses lines by tax.
  - Bills arrive by drag-and-drop or **Upload** in the purchase journal, through a journal **email alias** (e.g., `vendor-bills@…`), or from scanners that email that alias.
  - Recognized fields are vendor, bill reference, date, payment reference, bank details, due date, currency, line descriptions, quantities, unit prices, taxes, amounts and totals.
  - "Extracted data appears highlighted in the document preview". Users click fields to edit, or use **Reload AI data**. An unknown vendor triggers vendor creation with the name pre-filled.
  - It is an IAP service at one credit per document. XML e-invoices skip OCR.

  — [Odoo 18 docs: Invoice digitization](https://www.odoo.com/documentation/18.0/applications/finance/accounting/vendor_bills/invoice_digitization.html)
- Odoo 19:
  - OCR manual correction lets users select text portions on the document to populate fields, including custom fields and line items.
  - Accounting–Documents integration is automated and on by default, with "Management with AI" (sorting and actions via prompts) and a "New Journal Entry" server action that creates entries from documents.
  - Physical expense cards (Mastercard, Stripe Issuing) sync automatically.
  - "Mixed deductibility" adds a per-line "Professional percentage".
  - Duplicate bills are automatically excluded from posting.

  — [Odoo 19 release notes](https://www.odoo.com/odoo-19-release-notes)
- **NetSuite Bill Capture** is native OCR plus machine learning that extracts bill fields and routes bills through approvals. The 2025.1 enhancements are:
  - PO data can populate fields when a PO is linked (line items "requiring a review").
  - Item lines can be aggregated into one.
  - **Split View**: "the uploaded file can be viewed in a split view next to the created bill".

  — [RSM: NetSuite Bill Capture enhancements 2025.1](https://technologyblog.rsmus.com/uncategorized/netsuite-bill-capture-enhancements-2025-1/)
- Bill Capture uses OCI Document Understanding with custom generative-AI models. One customer reportedly cut per-invoice entry time from 2.5 minutes to 45 seconds. — [Houseblend article](https://www.houseblend.io/articles/en/netsuite-document-ai-extraction-factures) (consultancy blog; the stat is anecdotal)
- **FreshBooks receipts.**
  - The iOS and Android app "automatically capture[s] the merchant, totals, and taxes".
  - For select users, bills get line-item capture.
  - "Once you've reviewed the data, the documents will be moved into the Expenses or Bills section".
  - Receipts can also be emailed in. Categories are "tax friendly".

  — [FreshBooks: digital receipts capture](https://www.freshbooks.com/blog/digital-receipts-capture); [FreshBooks: expenses and receipts](https://www.freshbooks.com/expenses-and-receipts-tracking)
- **Wave Receipts.**
  - Receipt capture is included in Pro. Starter users can add it for **$11/month or $96/year**. — [Merchant Maverick](https://www.merchantmaverick.com/reviews/wave-accounting-review/)
  - Transactions "created from a scanned receipt" appear in the auto-updates review. — [Wave Support (search excerpt)](https://support.waveapps.com/hc/en-us/articles/26387836091668)
  - Conflicting claim: Digits (a competitor) says Wave "lacks built-in OCR technology to scan receipts and invoices and instantly match them to transactions". — [Digits vs Wave](https://digits.com/compare/wave/). This conflicts with Wave's own receipt-scanning product. It may refer to matching receipts to existing bank transactions rather than extraction, so treat it as competitor marketing.
- Third-party Odoo OCR modules (not native) advertise per-field confidence scores and a design rule that "extraction always creates a draft account.move — never a silent auto-post", with the source file and an extraction log attached. — [Ecosire AI invoice/bill OCR module](https://ecosire.com/apps/odoo/ai-invoice-bill-ocr) (vendor marketing; useful as a design pattern only)

### Inferences
- **Reusable pattern: document beside form.** NetSuite's Split View and Odoo's highlighted preview, where clicking a highlighted region fills the field, are the canonical review UI for AI-extracted bills and receipts. For a local app: PDF or image on the left with bounding boxes, the draft bill on the right, and fields colored by confidence.
- **Reusable pattern: drafts only.** Extraction or agent output always creates a draft, never a posted entry. Posting is a separate explicit action, which matches Odoo, FreshBooks ("once you've reviewed") and NetSuite approvals.
- **Reusable pattern: inbox folder or alias.** Odoo's per-journal email alias maps to a local "drop folder" that the agent watches.
- **Mixed deductibility / professional %** (Odoo 19) matters for personal plus small-business users who split a phone or car between personal and business use.
- Duplicate-bill detection before posting is essential once documents arrive automatically.

### Gaps
- I did not verify Odoo Expenses app expense-report flows (submit, approve, reimburse) for 18/19 beyond the 19 release-note items.
- FreshBooks bills/AP screen details (bill list columns, partial payments) were not retrieved.
- NetSuite expense reports and approvals were not researched.

---

## 6. Taxes: per-line tax codes, tax groups, tax reports, sales tax/VAT

### Takeaway
Odoo has the most complete and most reusable tax model:
- each tax has a computation type, a scope, an "included in price" flag and a "label on invoices";
- **tax groups** aggregate taxes in invoice totals;
- **tax grids** (tags) on base and tax distribution lines feed the country tax return;
- **fiscal positions** substitute taxes.

FreshBooks and Wave expose simpler per-line sales taxes. I could not verify those in detail.

### Cited Findings
- Odoo tax computation types are **Fixed Amount**, **Percentage**, **Percentage Tax Included**, **Division** and **Group of Taxes**. — [Odoo 18 docs: Taxes](https://www.odoo.com/documentation/18.0/applications/finance/accounting/taxes.html)
- Odoo tax fields include:
  - **Tax Name** (shown in back-end selectors) and **Label on Invoices** (on PDFs and portal lines).
  - **Tax Group**, which aggregates in the invoice totals section.
  - **Tax Type** (Sales / Purchase / None) and **Included in Price**.
  - **Distribution for Invoices** and **Distribution for Refunds**. Each has one Base line plus one or more "% of tax" lines (typically summing to 100%), and optional negative lines for reverse charge. Each line can carry **Tax Grids** (tags) used for reporting.

  — [Odoo 18 docs: Taxes](https://www.odoo.com/documentation/18.0/applications/finance/accounting/taxes.html)
- Odoo's **Tax Return** report aggregates base and tax amounts by period according to the country localization. **Fiscal Positions** swap one tax for another based on conditions such as customer location. — [Odoo 18 docs: Taxes](https://www.odoo.com/documentation/18.0/applications/finance/accounting/taxes.html)
- Odoo 19 redesigned fiscal positions: "Tax mappings removed. Each tax declares in which fiscal position it is applicable (empty means all) and declares which taxes from other fiscal positions it replaces". — [Odoo 19 release notes](https://www.odoo.com/odoo-19-release-notes)
- Odoo 18 has a **Tax Return lock date** to set after the monthly or quarterly return is filed. — [Odoo forum: lock dates wizard](https://odoo.com/ko_KR/forum/odoo-for-accounting-firms-35/lock-dates-wizard-266980)
- FreshBooks' receipt scanning captures taxes from receipts automatically. — [FreshBooks: digital receipts capture](https://www.freshbooks.com/blog/digital-receipts-capture)

### Inferences
- **A minimal tax model worth copying for a local app:**
  - Tax(name, invoice label, rate, type = percent/fixed, price_included, scope = sales/purchase, group).
  - Distribution lines (base vs tax portion, with the account and a **report tag**).
  - The tax report is then just "sum of tagged base and tax amounts in a period".
- After filing a return, set a **tax lock date** so the filed period cannot change silently.
- Per-line tax selection, with a tax-group subtotal in the invoice footer (Odoo), is the right display for VAT/GST users. US sales-tax users get the same with one rate per jurisdiction.

### Gaps
- FreshBooks and Wave tax UIs (how many taxes per line, tax summary report names, compound taxes) were not verified this session.
- NetSuite SuiteTax and tax codes were not researched.
- I did not retrieve Odoo's tax closing entry workflow (the "Closing Entry" button on the tax report).

---

## 7. Multi-currency and FX revaluation

### Takeaway
Odoo records **realized** exchange differences automatically, in a configured exchange-difference journal and gain/loss accounts, whenever a foreign-currency invoice is paid at a different rate. Rates update manually or from a web service daily, weekly or monthly. NetSuite runs period-end **"Revalue Open Foreign Currency Balances"** as a close-checklist task and posts unrealized gain/loss in revaluation transactions.

### Cited Findings
- Odoo rates:
  - Manual rates go under Accounting > Configuration > Currencies > Rates tab.
  - Automatic updates are set up from the Accounting Dashboard: change the Interval from Manually to **Daily, Weekly or Monthly** and choose the web service.

  — [Odoo 18 docs: Multi-currency](https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started/multi_currency.html)
- Odoo records exchange fluctuation automatically, for example when a customer pays a month after invoicing. The journal and gain/loss accounts are set in Accounting > Configuration > Settings > Default Accounts. Exchange-difference entries appear in the Miscellaneous journal with foreign and company-currency amounts. Bank lines carry an **Amount in Currency** field. — [Odoo 18 docs: Multi-currency](https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started/multi_currency.html)
- In Odoo 19, exchange-difference and cash-basis moves are generated in draft when reconciling draft entries. — [Odoo 19 release notes](https://www.odoo.com/odoo-19-release-notes)
- NetSuite:
  - At period end, users "generate currency revaluation transactions for open customer and vendor transactions, foreign-currency-denominated accounts, and other non-equity balance sheet accounts".
  - Open AR and AP get a separate revaluation transaction from other accounts, and the variance posts to **Unrealized Gain/Loss**.
  - Completed revaluations are under Transactions > Financial > Revalue Open Currency Balances > List.

  — [Kolleno: Revalue open currency balances](https://www.kolleno.com/revalue-open-currency-balances-in-netsuite/); [Oracle docs: Generating Revaluations](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1430227.html)
- NetSuite revaluation needs the **Currency Revaluation** permission (Create minimum, Full to delete) plus **Override Period Restrictions** when run from the checklist. — [Oracle docs: Using the Period Close Checklist](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html)
- Unrealized entries are commonly auto-reversed in the next period. A community post notes the system-generated reversal cannot be deleted. — [Kolleno](https://www.kolleno.com/revalue-open-currency-balances-in-netsuite/); [NetSuite Professionals archive](https://archive.netsuiteprofessionals.com/t/115833/currency-revaluation-reversal-of-unrealized-gain-loss-as-per)

### Inferences
- For a personal or small-business local app:
  - (a) Store both the transaction-currency amount and the base-currency amount on every line (Odoo's "Amount in Currency").
  - (b) Post realized FX gain/loss automatically on reconciliation.
  - (c) Offer an optional month-end "Revalue open balances" step that creates an auto-reversing unrealized entry, presented as a close-checklist item (NetSuite).
- Rate fetching should be explicit and logged: show the date and source for each rate used, so the agent and user can audit conversions.

### Gaps
- I could not confirm Odoo 18's **Unrealized Currency Gains/Losses** report and its "Adjustment Entry" button from a fetched official page. It is commonly referenced but unverified here.
- I did not verify FreshBooks' or Wave's multi-currency behaviour (whether they post FX gains/losses or only display converted totals).

---

## 8. Reports, drill-down, analytic accounts/tags, budgets, cash-flow forecasting

### Takeaway
Odoo leads among these products for dimensional reporting:
- **analytic plans** contain analytic accounts;
- a per-line **analytic distribution widget** splits a line by percentage;
- **analytic distribution models** auto-apply by account prefix, partner or product;
- **budgets** come in two kinds: analytic budgets with Budgeted / Achieved / Committed / Theoretical columns, and financial budgets added as a column on the P&L.

Wave offers lightweight **tags**. FreshBooks' widgets link through to reports. NetSuite 2025.2 adds ML forecasting in Planning and Budgeting.

### Cited Findings
- **Odoo analytic accounting.**
  - Analytic accounts are created at Configuration > Analytic Accounts and grouped in **Analytic Plans** (Configuration > Analytic Plans).
  - A plan's **Default Applicability** is *Optional*, *Mandatory* (the entry cannot be confirmed without it) or *Unavailable*.
  - The **Analytic Distribution widget** is an invoice and bill line column. Users pick accounts per plan column and set percentage splits.
  - Mass edits are done from Journal Items.
  - **Analytic Distribution Models** auto-apply by account prefix (e.g., "601"), partner, product, product category or company. All conditions must match, models are ordered by drag-and-drop, and a model can be created directly from the distribution popup.
  - The feature is enabled under Settings > Analytics.

  — [Odoo 18 docs: Analytic accounting](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/analytic_accounting.html)
- **Odoo budgets.**
  - **Analytic Budgets** live at Accounting > Accounting > Analytic Budgets > New. You **Add a line** per analytic account and amount.
  - When a budget is Open, the columns are **Budgeted**, **Achieved** ("confirmed journal entries for the associated analytic account"), **Committed** (Achieved plus confirmed unbilled POs) and an optional **Theoretical** (pro-rata to date). A **Details** button drills into lines.
  - **Generate** creates monthly, quarterly or yearly budgets.
  - Revisions keep the original.
  - **Financial budgets** are made on the P&L report: click **Budget**, name it, and "a new column labeled with the budget name will appear next to the Balance column" with % variance.

  — [Odoo 18 docs: Budget](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/budget.html)
- Odoo standard reports include balance sheet, P&L, cash flow, tax returns and partner ledgers. — [Odoo 18 docs: Accounting](https://www.odoo.com/documentation/18.0/applications/finance/accounting.html)
- Odoo 19 adds:
  - an **Annual Statements** composite report (balance sheet, P&L and trial balance together);
  - report annotations visible in the report chatter;
  - audit reports created and exported via Knowledge;
  - deferred miscellaneous entries with start and end dates.

  — [Odoo 19 release notes](https://www.odoo.com/odoo-19-release-notes)
- Wave puts **tags** under Accounting. — [Wave Support: Overview of your Wave account](https://support.waveapps.com/hc/en-us/articles/32453204338324)
- FreshBooks dashboard widgets drill into reports: the P&L link, category links in Spending, and client names in Revenue by Client. Monthly Recurring Revenue includes forecasts. — [FreshBooks Support: Dashboard](https://support.freshbooks.com/hc/en-us/articles/115015407988)
- NetSuite 2025.2 Planning and Budgeting adds "multivariate forecasting" that uses ML models to pick the forecasting method. — [Crowe: NetSuite 2025.2](https://www.crowe.com/insights/netsuite-blog/netsuite-2025-2-release-smarter-ai-stronger-compliance)
- NetSuite 2025.2 offers predictive analytics to "anticipate cash flow issues". — [Crowe: NetSuite 2025.2](https://www.crowe.com/insights/netsuite-blog/netsuite-2025-2-release-smarter-ai-stronger-compliance)
- NetSuite Next promises Narrative Insights: "automated summaries and trend analysis embedded across records and reports". — [Futurum: SuiteWorld 2025](https://futurumgroup.com/insights/netsuite-accelerates-ai-adoption-with-suiteworld-2025-announcements/)

### Inferences
- **A distribution widget with % splits is overkill for most single users.** A simpler pattern is Wave-style tags (Project, Personal vs Business, Client) applied per line, with the option to split a line. Odoo's *applicability* concept (mandatory / optional / hidden per plan) is worth stealing, for example "Business/Personal tag is mandatory on expense lines".
- **A budget column on the P&L** (Odoo financial budgets) is the most legible budget UI: Actual | Budget | Variance %, with monthly budgets generated by a "Generate" helper.
- **Drill-down everywhere:** dashboard widget to report to account ledger to journal entry to source document. FreshBooks and Odoo both chain these.
- **Cash-flow forecasting** for a local app can be derived from open invoices (due dates), open bills, recurring templates (FreshBooks MRR forecast) and scheduled transactions. An agent can narrate it ("Narrative Insights" style), but the numbers must stay traceable.

### Gaps
- I did not verify whether Odoo has a native cash-flow *forecast* (as opposed to the cash-flow statement) in 18/19.
- I did not retrieve the Odoo report drill-down UI (the "Audit" button on report lines, unfold/fold, comparison periods) from official pages this session.
- I did not verify NetSuite report drill-down or saved-search UI.

---

## 9. Period close and locking; audit trail

### Takeaway
NetSuite has the most explicit close UX: a **Period Close Checklist** of ordered tasks with status icons, padlocked tasks whose prerequisites are unmet, and per-ledger locks (Lock A/R, Lock A/P, Lock All) before Close. Odoo 18 uses a **Lock Dates** wizard with Sales, Purchases, Tax Return, Lock Everything and an irreversible **Hard Lock**, plus time-boxed exceptions for named users with a reason. Audit history is immutable field-level **System Notes** in NetSuite. In Odoo it is the chatter plus an Audit Trail, which Odoo 19 made available by default in light form.

### Cited Findings
- **NetSuite Period Close Checklist.**
  - It is reached via Setup > Accounting > **Manage Accounting Periods**. — [Oracle docs: Using the Period Close Checklist](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html)
  - The tasks, in order, are:
    1. Lock A/R
    2. Lock A/P
    3. Lock Payroll
    4. Lock All
    5. Resolve Date/Period Mismatches (inventory)
    6. Review Negative Inventory
    7. Review Inventory Cost Accounting
    8. Review Inventory Activity (OneWorld)
    9. Review Custom GL Plug-ins Executions
    10. Create Intercompany Adjustments
    11. **Revalue Open Foreign Currency Balances**
    12. Recognize Revenue
    13. Reclassify Revenue
    14. Calculate Consolidated Exchange Rates
    15. Eliminate Intercompany Transactions
    16. Create Period End Journals
    17. GL Audit Numbering
    18. **Close**

    — [Oracle docs: Using the Period Close Checklist](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html)
  - The status icons are **Task Complete**, **Task Partially Done** and **Task Not Started**. Action icons are **Go To Task** and a **Locked Task** padlock, whose hover text lists the prerequisites. A **Modified By** column records who changed each status.
  - Lock tasks can be done while earlier periods are open, but "You can't, however, complete any other checklist tasks including closing the period until all previous periods have been closed".

  — [Oracle docs: Using the Period Close Checklist](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html)
- Locking A/R blocks posting to any accounts-receivable account: invoices, credit memos, payments and journal entries. A/P works the same way. OneWorld can lock per subsidiary. — [Kolleno: close a period](https://www.kolleno.com/netsuite-tutorial-how-to-close-an-accounting-period/); [Oracle docs: Locking Accounting Periods in OneWorld](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1452163.html)
- **NetSuite System Notes.**
  - They record date and time, who made the change, the context or interface, the type (**Create, Set, Change, Unset**), the field, and the **Old Value** and **New Value**.
  - They are shown on the record's **System Information** subtab, and "can't be edited by any user, script or app".

  — [Oracle docs: System Notes Overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_158644279544.html); [RSM: system audit functionality](https://technologyblog.rsmus.com/technologies/netsuite/system-audit-functionality-in-netsuite/)
- **Odoo 18 lock dates.**
  - The Lock Dates wizard sets a **sales lock date** (blocks sales-journal entries), a **purchase lock date**, a **tax return lock date** (after a monthly or quarterly return), a **lock everything** date that allows exceptions, and a **hard lock date** with no exceptions. — [Odoo forum: lock dates wizard](https://odoo.com/ko_KR/forum/odoo-for-accounting-firms-35/lock-dates-wizard-266980)
  - Exceptions are granted to specific users for a duration with a reason, by users who have the access right. — [Odoo forum: lock dates wizard](https://odoo.com/ko_KR/forum/odoo-for-accounting-firms-35/lock-dates-wizard-266980)
  - Editing anything dated on or before a lock date errors. A normal lock can be moved later, while the hard lock is permanent. — [Cybrosys Odoo 18 book: Lock dates](https://www.cybrosys.com/odoo/odoo-books/v18/accounting/lock-dates/)
- **Odoo year-end.**
  - The docs give a pre-close checklist:
    - banks fully reconciled;
    - no draft invoices;
    - bills confirmed;
    - expenses validated;
    - payments encoded;
    - **suspense accounts closed**;
    - depreciation and deferred revenue booked.
  - Then run the tax report, set the **Lock Everything** date to the last day of the prior fiscal year (Accounting > Accounting > Lock Dates), allocate current year's earnings, and finally set the **Hard Lock date** for "data inalterability".

  — [Odoo 18 docs: Year-end closing](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/year_end.html)
- **Odoo 19 audit and review.**
  - A "Light audit trail" is available by default to all users.
  - Report annotations show in report chatters.
  - Invoicing-only users can post moves, but "they are automatically flagged as 'To review'" for accountants and cannot reset reviewed moves.

  — [Odoo 19 release notes](https://www.odoo.com/odoo-19-release-notes)
- Odoo 19 marketing (Smile) says closing "Odoo guides you through the process and flags any anomalies or inconsistencies". — [Smile: Odoo v19 integrated AI](https://smile.eu/en/publications-and-events/odoo-v19-discover-what-s-new-integrated-ai) (partner marketing, no feature detail)

### Inferences
- **The period-close checklist is the single best pattern for a local app run by an AI agent.** It gives an ordered list of tasks, each with a status icon and a "Go to task" link, and tasks stay padlocked until their prerequisites are met. Tasks for a small business would be:
  1. Import and match all bank lines.
  2. Reconcile statement ending balances.
  3. Clear suspense / "To check".
  4. Review agent-created entries.
  5. Revalue FX (optional).
  6. File tax and set the tax lock.
  7. Lock the period.

  The agent can do the preparation; the human ticks the sign-offs.
- **Lock dates by domain** (sales, purchases, tax, everything, hard) are a clean model. For a single user, a "Lock everything through <date>" setting plus a "tax filed through <date>" lock is sufficient. Exceptions should be logged with a reason (Odoo), so agent edits to locked periods become impossible or auditable.
- **An immutable field-level change log** (NetSuite System Notes: who, when, context, field, old to new) should record **actor = user | agent** and context = UI | agent tool | import. This is the core trust mechanism for agent-operated books.
- **"To review" auto-flag on posts by less-privileged actors** (Odoo 19) maps directly onto the agent: agent-posted entries are flagged To Review until the human approves them.

### Gaps
- I did not fetch the official Odoo 18 "Audit trail" documentation (setting location, report columns). The Odoo 18 lock-date exception fields are confirmed only via forum and secondary sources.
- I did not verify NetSuite's accounting-period setup (Manage Accounting Periods list columns, the "Allow Non-G/L Changes" checkbox).

---

## 10. AI features as of 2025–2026, and how users review or approve AI output

### Takeaway
- **Odoo 19 (released 2025)** brings platform AI: AI agents you chat with that can act, AI fields, "Ask AI" natural-language search turned into domains, "Use AI to fill in fields", AI document management, OCR with manual text-select correction, and enhanced automated reconciliation.
- **NetSuite** announced "NetSuite Next" at SuiteWorld (October 2025): Ask Oracle, AI Canvas, Narrative Insights, and agentic close and reconciliation workflows that can be human-in-the-loop. GA was promised in 12–18 months, so status by late 2026 is uncertain. It also ships an **AI Connector Service built on MCP** so external assistants (Claude, ChatGPT, Gemini) can read and act on NetSuite data under role permissions.
- **FreshBooks and Wave** AI is narrower: ML auto-categorization and receipt extraction. Wave's review idiom is a purple highlight plus a thumbs-up.

### Cited Findings
**Odoo**
- Odoo 19 AI:
  - "Chat with AI agents that can learn from your documents and perform actions".
  - Users can "query their own database records".
  - "AI fields" and "Ask AI search" turn natural language into Odoo domains.
  - "Use AI to fill in fields" works across forms.
  - Email-template prompts and "Files for fields and actions" are available.
  - Documents "Management with AI" sorts and triggers actions via prompts.
  - "Automated reconciliation models" are enhanced for transaction recognition.

  — [Odoo 19 release notes](https://www.odoo.com/odoo-19-release-notes)
- Odoo 19 is described by a partner as having bank reconciliation "assistance with automatic transaction matching", "Accounting closing guidance with anomaly flagging", recommendations that improve "by learning from your usage and history", and "an open architecture, capable of leveraging different engines". — [Smile](https://smile.eu/en/publications-and-events/odoo-v19-discover-what-s-new-integrated-ai) (partner marketing)
- **Low reliability:** an Odoo-module vendor blog claims Odoo 19 AI bank reconciliation matches "with 70–85 percent accuracy" vs "30–45 percent" for Odoo 17 rules, with a "suggested matches" panel and a hosted ML endpoint that can be disabled. — [Ecosire blog: Odoo 19 accounting new features](https://ecosire.com/es/blog/odoo-19-accounting-new-features-2026). These numbers are not corroborated by Odoo's own docs or release notes, so do not rely on them.
- The Odoo 18 OCR review UI has highlighted extracted values on the preview, click-to-edit, and **Reload AI data**. — [Odoo 18 docs: Invoice digitization](https://www.odoo.com/documentation/18.0/applications/finance/accounting/vendor_bills/invoice_digitization.html)

**NetSuite**
- NetSuite Next (SuiteWorld 2025):
  - **Ask Oracle** (natural-language "search, navigate, analyze, and act" with role-based permissions).
  - **AI Canvas** ("a visual workspace for collaborative problem-solving and triggering agentic workflows").
  - **Narrative Insights**.
  - **Agentic workflows** ("autonomous or human-in-the-loop automation for complex reconciliations and vendor selection").
  - LLM ingestion of contracts, invoices and policies.
  - **SuiteAgents** framework, **AI Studios** ("manage prompts and outputs"), and AI toolkits via APIs.
  - BILL partnership for "AI-powered bill capture, matching, payment proposals, and reconciliation".
  - Rollout "over the next 12 months", with emphasis on human-in-the-loop.

  — [Futurum Group: SuiteWorld 2025](https://futurumgroup.com/insights/netsuite-accelerates-ai-adoption-with-suiteworld-2025-announcements/)
- Coverage also names "Autonomous Close" and agentic payment proposals and reconciliations, with "general availability expected within 12 to 18 months". — [IT Brief: SuiteWorld 2025 day 1–2](https://itbrief.com.au/story/suiteworld-2025-day-1-2-netsuite-next-sets-a-new-pace-for-ai-in-business); [Nucleus Research SuiteWorld 2025 note](https://nucleusresearch.com/wp-content/uploads/2025/11/z194-SuiteWorld-2025-updates-and-announcements.pdf)
- The **NetSuite AI Connector Service**:
  - It is protocol-driven and supports **MCP**, with "Standard and Custom MCP tools".
  - Organizations choose models, "define the data they can access, and govern how the models interact with NetSuite".
  - Later "MCP Apps" surface NetSuite data inside Claude, with Gemini, ChatGPT and other compliant assistants also supported.

  — [Oracle press release (SuiteCloud AI, 7 Oct 2025)](https://www.oracle.com/sg/news/announcement/sw25-netsuite-expands-suitecloud-platform-new-ai-innovation-2025-10-07); [IT Brief: AI Connector Service](https://itbrief.co.uk/story/netsuite-ai-connector-service-have-ai-your-way); [ITPro: NetSuite MCP Apps in Claude](https://itpro.com/software/netsuite-announces-new-mcp-apps-for-ai-connector-service-allowing-users-to-access-financial-data-directly-within-claude); [diginomica](https://diginomica.com/netsuite-mcp-integration-enterprise-data-actions-any-llm-agent). The Oracle press release page returned 403 to direct fetch; details are from the search excerpts and coverage.
- NetSuite 2025.2:
  - **NetSuite Expert** answers plain-English questions from Help Center and SuiteAnswers "complete with source links".
  - ML multivariate forecasting in Planning and Budgeting.
  - Predictive cash-flow analytics.

  — [Crowe: NetSuite 2025.2](https://www.crowe.com/insights/netsuite-blog/netsuite-2025-2-release-smarter-ai-stronger-compliance); [Forvis Mazars: AI in NetSuite 2025.2](https://www.forvismazars.us/forsights/2025/09/discover-ai-innovations-across-netsuite-2025-release-2)
- NetSuite Bill Capture review uses a split view of the source file beside the bill, and PO-derived line items "requiring a review". — [RSM: Bill Capture 2025.1](https://technologyblog.rsmus.com/uncategorized/netsuite-bill-capture-enhancements-2025-1/)

**Wave**
- Auto-categorization runs every 24 hours from the "transaction description and your past activity". The review UI is a **purple highlight** with a **thumbs-up** to confirm or recategorize, and the system learns from those choices. — [Wave Support: auto-updates](https://support.waveapps.com/hc/en-us/articles/4988928647188); [Wave Support: review auto-updates](https://support.waveapps.com/hc/en-us/articles/26387836091668)

**FreshBooks**
- FreshBooks AI: secondary sources say it launched "AI-powered expense categorization" (2024) and invoicing that "predicts client payment timing", with 2026 updates adding "predictive analytics, unified workspaces, and embedded payments". — [elitecontentmarketer FreshBooks stack](https://elitecontentmarketer.com/stack/freshbooks); [todaytesting FreshBooks review 2026](https://todaytesting.com/freshbooks-promo-codes-and-review/). Low reliability: these are SEO/affiliate sites, and I found no FreshBooks primary announcement this session.
- FreshBooks "Likely Matches" in reconciliation is a confirm-all-or-uncheck review pattern ("Confirm and Continue" / "Skip"). — [FreshBooks Support](https://support.freshbooks.com/hc/en-us/articles/360039682172)

### Inferences
- **Review idioms that work, ranked by suitability for a local agent-operated app:**
  1. **Status flag plus queue**: Odoo "To review" or "To Check", Wave purple highlight. Agent output is visible but marked until confirmed.
  2. **Batch confirm with uncheck** (FreshBooks Likely Matches). Accept many high-confidence proposals at once.
  3. **Source beside draft** (NetSuite split view, Odoo highlighted OCR). Use it for document extraction.
  4. **One-tap thumbs-up that also trains rules** (Wave). Confirming feeds back into the categorizer or rules.
  5. **Answers with source links** (NetSuite Expert). Agent explanations should cite the entries and documents they rely on.
- **MCP as the agent interface:** NetSuite's AI Connector Service validates exposing the ledger to agents through MCP tools with role-scoped permissions and "standard + custom tools". A local app can offer an MCP or tool surface (create draft entry, propose match, run report, explain balance) with every write landing as draft or To-review, and a permission level per tool.
- **Draft-first reconciliation:** Odoo 19's "draft entries can now be reconciled", with exchange and cash-basis moves also drafted. This shows how an agent can stage a complete reconciliation as drafts that the user posts in one action.
- The NetSuite Next "autonomous close" claims were roadmap items as of the late-2025 announcements. A local app should treat close automation as preparation plus checklist rather than autonomy.

### Gaps
- I found no FreshBooks or Wave primary-source announcement of generative-AI assistants (chat, natural-language reports) for 2025–2026. There may be features I could not verify.
- I could not confirm which NetSuite Next features (Ask Oracle, AI Canvas, Autonomous Close) reached GA by October 2026.
- I could not confirm Odoo 19 AI licensing (Enterprise only?) or which LLM providers it uses.
- Odoo 20 / Odoo Experience 2025 announcements were not researched.

---

## 11. Design language, density, and what users praise and complain about

### Takeaway
FreshBooks and Bonsai are praised as friendly and easy, with complaints about time-entry tedium and plan limits. Wave is praised for being free and simple, but trust has eroded: features moved to Pro, payroll problems, and support or lockout complaints. Odoo is praised for integration and automation, but called complex, unintuitive for newcomers and overkill for tiny businesses. NetSuite is the archetype of a dense, dated, click-heavy ERP UI, with a Redwood redesign in progress that users report as slower.

### Cited Findings
- **FreshBooks.**
  - Rated 4.5/5 from 4,511 users (Capterra aggregate). The time tracker is "intuitive".
  - Complaints:
    - entering many time entries is slow, and "you still have to add each day separately even for the same type of work";
    - you "can't view every unpaid invoice together unless you archive things";
    - limits on billable clients and internal users.

  — [Capterra AE: FreshBooks](https://www.capterra.ae/reviews/142390/freshbooks); [Software Advice: FreshBooks](https://www.softwareadvice.com/project-management/freshbooks-profile/) (via search summary)
- **Wave.**
  - Free Starter plus Pro at $19/month ($170/year). — [Merchant Maverick](https://www.merchantmaverick.com/reviews/wave-accounting-review/)
  - Complaints:
    - automatic bank imports moved to the Pro paywall;
    - a mid-2025 payroll processor migration "broke tax filings for some users";
    - Trustpilot 1.2/5 from 180 reviews;
    - BBB A rating but 201 complaints, over lockouts, fund holds and payroll failures.

    — [checkthat.ai Wave reviews 2026](https://checkthat.ai/brands/wave/reviews) (aggregator; figures not independently verified)
- **Odoo Accounting.**
  - G2 rating 4.3/5 from 77 reviews. Praised for automation, real-time sync and integration with the Odoo suite.
  - Cons: "the interface can feel less intuitive", onboarding is hard, it is "overly complex and not suitable for smaller companies that need simple accounting", and setup may need technical expertise.

  — [G2: Odoo Accounting comparisons and reviews](https://www.g2.com/compare/odoo-accounting-vs-quickbooks-online); [G2 Odoo Accounting reviews](https://g2.com/products/odoo-accounting/reviews?page=8) (via search summary)
- **NetSuite.**
  - "36% of reviewers" find the UI problematic, "outdated and clunky".
  - Lists refresh and drop-downs are "not very intuitive".
  - "Frequent clicks, inconsistent menu paths, and dense layouts slow down workflows".
  - Accounting setup requires prior NetSuite knowledge or paid consultants.

  — [PeerSpot: what needs improvement with NetSuite](https://www.peerspot.com/questions/what-needs-improvement-with-netsuite-erp); [TrustRadius](https://tr-web.dev.trustradius.com/products/netsuite-erp/reviews?qs=7); [Capterra NetSuite reviews](https://www.capterra.com/p/135757/NetSuite/reviews/?page=17)
  - Redwood UIs are reported slower to open than Classic. — [Oracle Customer Connect thread](https://community.oracle.com/customerconnect/discussion/799299/slowness-of-redwood-uis)
- **Kashoo** is praised for value and "incredible ease of use" from $30/month, but bank sync and matching are inconsistent. — [crm.org](https://crm.org/news/kashoo-review); [The CFO Club](https://thecfoclub.com/tools/kashoo-review/)
- **Bonsai**: 93% positive sentiment in the cited summary, praised as "well-designed and user-friendly". — [Capterra: Bonsai](https://capterra.com/p/238825/Bonsai/reviews/)
- **Odoo vs QuickBooks**: G2 reviewers rate QuickBooks higher on beginner friendliness. — [G2: QuickBooks vs Odoo Accounting](https://www.g2.com/compare/intuit-quickbooks-vs-odoo-accounting)

### Inferences
- **Density sweet spot for a single-user app:** use NetSuite or Odoo data depth (real ledger, rules, locks, audit log) with FreshBooks or Wave surface simplicity (category language, one primary action per screen, a friendly dashboard). The complaints show that density without guidance ("which account?", "where is it?") is what users hate. Odoo 19's account descriptions and NetSuite's padlocked-task hovers are the antidote.
- **Avoid per-day repetitive entry** (the FreshBooks complaint). Support bulk or multi-day time entry and bulk categorization, which an agent can also do.
- **"Show all unpaid" must be one filter away** (the FreshBooks complaint). Use saved filters such as Overdue, Outstanding, To review and Unmatched as tabs.
- Trust and continuity matter (Wave complaints about features moving behind paywalls and payroll breakage). A local-first app's pitch of "your data, no lock-out, no paywall shuffles" directly answers these pain points.

### Gaps
- I gathered no primary design-system documentation for any product. Odoo's Owl/Bootstrap-based web client, FreshBooks' design system and NetSuite Redwood guidelines were not fetched. Typography, color and spacing specifics are not documented here.
- I found no reliable keyboard-shortcut lists for FreshBooks, Wave or NetSuite. Odoo's general web-client shortcuts (Alt-key overlays, command palette) are not covered by the sources above.
- Reddit threads were not retrieved directly; the complaint data comes from review aggregators.
