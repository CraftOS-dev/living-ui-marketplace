# Incumbent small-business accounting suites (QuickBooks Online, Xero, Zoho Books, Sage Accounting, FreeAgent): UI, UX, features and workflows, 2025-2026

Scope note for the report writer:
- **Products:** QuickBooks Online (QBO), Xero, Zoho Books, Sage Accounting (cloud, formerly Sage Business Cloud Accounting), FreeAgent.
- **Date checked:** October 2026.
- **Search-summary tags.** Several help centres block automated fetching (support.freeagent.com, Capterra and PCMag return 403 or "unable to fetch"; many Sage KB pages redirect or 404). Where a fact comes only from a search-engine result summary rather than a fetched page, it is tagged "(search summary)". Treat those as less certain.
- **Product tags.** "[Sage 50]" or "[Intacct]" marks a different Sage product, not Sage Accounting.
- **Older material.** Anything from before 2024 is marked "(older)".

---

## 1. Navigation, information architecture, home dashboard, global search, quick-create

### Takeaway
All five suites put the same modules in a persistent nav: Sales/Invoices, Purchases/Bills, Banking, Contacts, Reports, Accounting. QBO (July 2025) and Xero (2025-26 rollout) both rebuilt their home page as a grid of customizable widgets. Each has a "tasks" or "feed" widget that surfaces work to do (unreconciled lines, overdue invoices). In QBO that feed also summarizes what the AI agents did. Zoho Books has by far the most complete keyboard layer: two-key create shortcuts and Shift+digit module jumps.

### Cited Findings
**QuickBooks Online**
- **July 2025 redesign.** QBO's web layout was "completely redesigned and personalized". The homepage became "customizable widgets with a powerful business feed that shows real-time intelligent insights, recommendations, and summarizes the workflows and tasks completed by the AI agents". Rollout began July 1, 2025 for US QBO customers. — [Intuit press release, 1 Jul 2025](https://investors.intuit.com/_assets/_08ee5483ec4c057568cc8774f3fd6aad/intuit/news/2025-07-01_Intuit_Introduces_Ground_Breaking_Virtual_Team_of__1258.pdf)
- **Navigation bar tools.**
  - The new bar has a **Global Create button**, **Bookmarks** (moved to the top of the menu), a **Business Feed** with AI suggestions, and **My Apps**. My Apps groups functions into "apps" (accounting, expenses, sales, payroll, project management), and users can pin their top three. — [SVA (search summary)](https://accountants.sva.com/biz-tips/get-ready-for-the-new-quickbooks-online-experience); [TeachUcomp (search summary)](https://www.teachucomp.com/the-navigation-bar-in-quickbooks-online-instructions/)
  - The **Feed** button shows "tasks you may want to do" and gives access to the AI agents. — [TeachUcomp (search summary)](https://www.teachucomp.com/the-navigation-bar-in-quickbooks-online-instructions/)
- **Customer Hub.** A CRM area, included in most QBO plans, where the Customer Agent lives. — [Intuit press release](https://investors.intuit.com/_assets/_08ee5483ec4c057568cc8774f3fd6aad/intuit/news/2025-07-01_Intuit_Introduces_Ground_Breaking_Virtual_Team_of__1258.pdf)
- **(Older, 2022) Business view vs Accountant view.**
  - Business view uses owner language; for example Chart of Accounts lives at Bookkeeping > Chart of Accounts, while Accountant view has it top-level.
  - In both views, users can hide unused pages under "More", reorder items and bookmark pages. — [Insightful Accountant, Aug 2022](https://insightfulaccountant.com/accounting-tech/general-ledger/new-quickbooks-online-navigation-view/)
- **Keyboard shortcuts.**
  - **Ctrl+Alt+/** shows the list.
  - **Open forms and pages:** Ctrl+Alt+I invoice, W check, X expense, E estimate, R receive payment, C customers, V suppliers/vendors, A chart of accounts, F search transactions, L lists, H help.
  - **Inside a form:** Ctrl+Alt+S save & new, D save & close, M save & send, P print.
  - — [Dummies QBO UK cheat sheet](https://www.dummies.com/article/technology/software/money-management-software/quickbooks/quickbooks-online-for-dummies-uk-edition-cheat-sheet-263742/). The same page also lists Ctrl+Alt+X for "close window", which clashes with Expense. Treat that one as unreliable.

**Xero**
- **New homepage (2025-26 rollout).**
  - **Widgets:** net profit/loss, a "recent invoice payments widget", a "cash in and out widget", and a "tasks widget" that flags priority items such as bank reconciliation, overdue invoices and outstanding bills.
  - **Customization:** "create your own view by dragging and dropping widgets", and "show or hide widgets for a detailed or pared-back view". Layouts adapt to device size.
  - **Rollout:** gradual, with a holiday pause and the "next wave beginning in January". A temporary option lets users revert to the old dashboard.
  - **Xero's claim:** "70% of customers say the new Xero homepage makes it easier to stay on top of their business". — [Xero new homepage page](https://www.xero.com/uk/campaign/new-homepage-navigation/)
  - The menu listed on that page (Accounting Software, Send Invoices, …, JAX) is the marketing-site menu, not the in-app nav. — same source
- **(Older, 2021) Slash navigation.**
  - Press "/" then a shortcut key and Enter to navigate from any screen except Fixed Assets, Reporting, Projects, Expenses and Payroll.
  - The same "/" box offers an **"Add new"** option under the search bar (quick create). — [Armstrong Watson, Jul 2021](https://www.armstrongwatson.co.uk/news/2021/07/xero-tips-and-tricks-keyboard-shortcuts)
- **Shortcuts in new invoicing.**
  - New invoicing added keyboard shortcuts for approving, previewing, printing and sending.
  - All date-entry shortcuts (for example "t-1" for yesterday, or "18/2/23" auto-filling to 18 Feb 2023) work there as of end-2024. — [Xero Product Ideas (search summary)](https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/47706080-new-invoicing-typeable-dates-in-date-fields); [Xero new invoicing](https://www.xero.com/campaign/new-invoicing)

**Zoho Books**
- **Shortcut panel.** Opened with **Shift+?**. Every shortcut is user-editable via an Edit icon. — [Zoho keyboard shortcuts](https://www.zoho.com/uk/books/help/getting-started/keyboard-shortcuts.html)
  - **General:** `/` search, `Option+/` advanced search, `Cmd+/` Zia search, `Option+0` Navigate To, `S` settings, `O` organizations.
  - **Module jumps:** `Shift+1` Dashboard, `Shift+2` Items, `Shift+3` Banking, `Shift+4` Customers, `Shift+5` Vendors, `Shift+6` Reports, `Shift+7` Documents.
  - **Letter jumps:** `Shift+I` Invoices, `Shift+J` Journals, `Shift+B` Bills, `Shift+X` Expenses, `Shift+Z` Chart of Accounts, `Shift+R` Payments Received, `Shift+M` Payments Made.
  - **Create chords:** `C+I` invoice, `C+J` journal, `C+E` quote, `C+N` credit note, `C+B` bill, `C+X` expense, `C+A` account, `C+4` customer, `C+5` vendor, `C+1` customer payment, `C+M` vendor payment.
  - **On a list:** `N` new, `Option+A` select all, `Option+I` import, `Option+E` export.
  - **On a record:** `E` edit, `M` email, `P` print, `D` PDF.
  - **In the editor:** `Option+S` save & send.
- **Home page tabs:** **Dashboard / Getting Started / Announcements / Recent Updates**. — [Zoho Home help](https://www.zoho.com/books/help/home/index.md)
- **Dashboard widgets:** — same source
  - **Total Receivables** and **Total Payables**, each split into Current and Overdue, with inline create actions.
  - **Cash Flow:** opening/closing balance, incoming, outgoing.
  - **Income and Expense:** cash/accrual toggle.
  - **Top Expenses:** pie chart.
  - **Projects:** unbilled hours and expenses.
  - **Bank and Credit Cards.**
  - **Account Watchlist:** live balances of chosen accounts.
- **Other entry points.**
  - Reports can be added as panels to custom dashboards. — [Zoho reports help](https://www.zoho.com/books/help/reports/)
  - Ask Zia sits behind an icon in the right sidebar. — [Zoho AI features](https://www.zoho.com/us/books/help/ai-features/ai-features.html)
  - An "Accountant" nav section holds Transaction Locking and Currency Adjustments. — [Zoho transaction lock](https://zstatic.zohostatic.com/books/help/accountant/transaction-lock.md)

**Sage Accounting**
- **Confirmed menu paths:**
  - Banking → Manage bank rules
  - Banking → [account] → Reconcile
  - Settings → Business settings → Financial settings → Accounting dates & VAT
  - Settings → Business Settings → Currencies
  - — [Sage KB bank rules](https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=222001000100746); [Sage CA KB reconcile](https://ca-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=240304191541010); [Sage KB year end](https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=222001000101111)
- **Dashboard (product tour).**
  - Described as "Everything you need, all in one place": cash flow, profits and customer data, plus a cash-flow forecast.
  - A Copilot-driven **"Know what you need to do"** task area highlights unreconciled transactions and unsubmitted invoices. — [Sage product tour](https://assets.sage.com/product-tour/dist/sbca/en-GB/index.html)
- A reminder appears on login when recurring invoices are due. — [Sage KB (search summary)](https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=200427112159437)

**FreeAgent**
- **Overview screen.** "A series of financial overview panels": Cashflow, Invoice Timeline, Expenses, Tax Timeline. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/115001218610)
  - **Cashflow:** has a top-right dropdown for the last 12, 6 or 3 months. — same source; [FreeAgent dashboard](https://www.freeagent.com/features/dashboard/)
  - **Invoice Timeline:** expected (overdue + due) versus received, per month. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/115001218610)
  - **Tax Timeline:** upcoming VAT, Self Assessment, Corporation Tax and payroll dates with amounts, exportable to a calendar. — [FreeAgent dashboard](https://www.freeagent.com/features/dashboard/)
  - **Tax Timeline changes:** June 2023 added file, mark-paid and filter. June 2024 let users choose which items show. — [FreeAgent timeline](https://www.freeagent.com/timeline)
- **Accounting tab.** Has a dropdown that contains **Find and Fix**. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/24572810244242)
- **Banking search.** Searches by description, category or amount. — [FreeAgent banking](https://www.freeagent.com/features/banking/)

### Inferences
- The **"home = widgets + a tasks/feed list"** pattern is now standard. QBO's feed, which "summarizes the workflows and tasks completed by the AI agents", is the closest precedent for an agent-operated app: a reverse-chronological log of what the agent did, with links to undo or review.
- **Keyboard model.** Zoho's chord scheme ("C then I" to create an invoice, Shift+digit for modules, single letters on a selected record, a user-editable shortcuts sheet on Shift+?) is the most reusable for a desktop-first local app. QBO's Ctrl+Alt+letter set is shallower and collides with browser and OS shortcuts.
- **Typed dates.** Xero's typed-date grammar ("t-1") suits dense data entry.

### Gaps
- No primary source found for QBO's 2025 left-rail order or full app list, or for its global search behaviour.
- Xero's in-app top menu labels (Sales / Purchases / Reporting / Accounting / Contacts) and global search were not confirmed from a primary page.
- Not verified: Sage's full nav order or any 2024-26 nav redesign; FreeAgent's full top-nav tab list and quick-create menu.

---

## 2. Bank feeds and reconciliation

### Takeaway
There are four distinct review models:
- **QBO (2025-26):** a dense table with inline editing and batch "Post", grouped by AI confidence.
- **Xero:** one card per statement line, the bank line on the left and Match/Create/Transfer/Discuss on the right, now with JAX auto-reconciling high-confidence lines into a reviewable "Reconciled" page.
- **Zoho Books:** a list with a right-hand matches pane.
- **FreeAgent:** an "explanation" form per line plus a "For Approval" queue for machine-explained lines.

QBO, Zoho and Sage keep a separate statement tick-off reconciliation (statement end balance, cleared, difference = 0). Xero relies on a reconciliation report. FreeAgent compares balances.

### Cited Findings
**QuickBooks Online: new AI-powered banking page**
- **Tabs:** **Pending** (downloaded, awaiting action) and **Posted**. — [QBO help: new AI-powered banking page](https://quickbooks.intuit.com/learn-support/en-global/help-article/matching-rules/learn-updates-new-ai-powered-banking-page/L0hR7A9Zf_ROW_en)
  - An **Excluded** list also exists. Excluding a line moves it there and "QuickBooks will not download it again". — [QBO help (search summary)](https://quickbooks.intuit.com/learn-support/en-us/banking/how-to-exclude-expenses-from-downloaded-bank-transactions/00/239501)
- **Columns:** Bank Description, From/To, Category, Product/Service, Transaction type. Columns are customizable via the settings gear. — [QBO help](https://quickbooks.intuit.com/learn-support/en-global/help-article/matching-rules/learn-updates-new-ai-powered-banking-page/L0hR7A9Zf_ROW_en)
- **Actions and markers:** — same source
  - Actions: **Post**, **Match**, **Categorise**, **Split**.
  - A **"Pair"** badge marks transfers and card payments between your own accounts.
  - A **"RULE"** badge shows when a rule supersedes a suggestion.
  - A **sparkle icon labelled "Suggested by AI"** marks AI suggestions.
  - "Categorisation history" is tracked per From/To.
  - A **"Ready to post" banner** appears.
  - A switch reverts to the classic view.
- **Editing behaviour:**
  - Vendor, category, class and location are edited inline with "no pop-up windows".
  - Hovering reveals the full bank text.
  - Users can "post a transaction and still make changes afterward".
  - Suggestions explain their reasoning "based on your historical activity", and one-to-many matching is improved. — [Porte Brown, Oct 2025](https://blog.portebrown.com/quickbooks-onlines-new-bank-feed-what-to-expect-in-october-2025)
- **Comments and requests:**
  - Comments on a bank line automatically feed a **Request List** for the accountant. — [Porte Brown](https://blog.portebrown.com/quickbooks-onlines-new-bank-feed-what-to-expect-in-october-2025)
  - A "Requests" feature asks a client or team member for details, with automated follow-ups and an audit trail. — [Insightful Accountant, May 2026](https://blog.insightfulaccountant.com/intuit-bank-feeds-experience-transitions-may-8-2026)
- **Speed and posting:**
  - Background posting means "you continue working while rows post".
  - Attachments can be dragged and dropped onto lines.
  - Common actions are ">50% faster".
  - An optional warning fires when posting without a payee. — [Firm of the Future](https://www.firmofthefuture.com/product-update/accountants-quickbooks-bank-feed-transition/); [Insightful Accountant](https://blog.insightfulaccountant.com/intuit-bank-feeds-experience-transitions-may-8-2026)
- **Timeline:**
  - The new layout became the default on **Oct 1, 2025**. — [Porte Brown](https://blog.portebrown.com/quickbooks-onlines-new-bank-feed-what-to-expect-in-october-2025)
  - The opt-out was removed on **May 8, 2026**, when it became "the standard for all QuickBooks Online and QuickBooks Online Accountant users". — [Insightful Accountant](https://blog.insightfulaccountant.com/intuit-bank-feeds-experience-transitions-may-8-2026)
  - Firm of the Future dates the default rollout for accountant products to May 8, 2026, so there was likely a staged rollout by audience. — [Firm of the Future](https://www.firmofthefuture.com/product-update/accountants-quickbooks-bank-feed-transition/)
- **July 2025 update:** added an expanded categorization history and statement upload. — [Unofficial QB Accountants Podcast ep. 101 (search summary)](https://unofficialquickbooksaccountantspodcast.transistor.fm/101)
- **Intuit Assist auto-matching (Nov 2024):** automatically matches invoices paid through QuickBooks Payments and bills paid through QuickBooks Bill Pay to the corresponding bank lines. — [CPA Practice Advisor (search summary)](https://www.cpapracticeadvisor.com/2024/11/20/quickbooks-adds-gen-ai-financial-assistant-to-power-business-growth/152256/)
- **(Older, 2014-2016 classic feed) features:** — [QBO bank feeds release notes](https://quickbooks.intuit.com/r/whats-new/quickbooks-online-bank-feeds-release-notes)
  - "Recognized" pre-matched transactions accepted by batch action.
  - Matching one deposit to several open invoices or bills.
  - CSV statement import.
  - "Copy bank detail to memo".
  - Batch delete of excluded lines.
  - Tab and arrow-key navigation inside expanded rows.
  - A payee column that remembers names.
- **Reconcile flow:**
  - **Setup screen:** Account, Ending balance, Ending date, with the last statement ending date shown.
  - **Header:** Statement ending balance, Beginning balance, **Cleared balance** (updates as rows are ticked), **Difference** (target $0.00).
  - **Body:** a checkbox per transaction. **Edit info** changes the balance or date.
  - **Finishing:** **Finish now** completes the reconciliation and auto-generates a reconciliation report. Past reports are under **History by account**. — [QBO help: reconcile](https://quickbooks.intuit.com/learn-support/en-global/help-article/statement-reconciliation/reconcile-account-quickbooks-online/L3XzsllsK_ROW_en)
  - The finish control is a dropdown with **Finish now** and **Save for later**. — [Fit Small Business (search summary)](https://fitsmallbusiness.com/bank-reconciliation-quickbooks-online/)
- **Undo reconciliation:**
  - QBO **Accountant** users can undo a whole reconciliation in one step. Ordinary QBO users must un-clear transactions one by one. — [NerdWallet (search summary)](https://www.nerdwallet.com/business/software/learn/undo-reconciliation)
  - Intuit publishes an "Avoid undoing a reconciliation" article. — [QBO help](https://quickbooks.intuit.com/learn-support/en-us/help-articles/avoid-undoing-a-reconciliation/00/261414)

**Xero**
- **Reconcile screen layout.**
  - Side by side: the bank statement line on the left, "possible matches and options" on the right.
  - Four tabs on the right: **Match / Create / Transfer / Discuss**.
  - A suggested match is "highlighted in light green", and you confirm it with **OK**. A **Find & Match** button allows manual search.
  - The account header shows **Statement Balance** and **Balance in Xero**.
  - The Create form uses **Who** (contact), **What** (account code) and **Why** (description). — [Fit Small Business](https://fitsmallbusiness.com/connect-and-reconcile-bank-account-xero/)
- **Transfer** is recorded once and Xero creates the mirror transaction in the other account. **Discuss** saves a note on an unresolved line so it can be finished later. — [Poolwerx/Xero guide (search summary)](https://evolutionplatform.poolwerx.com.au/support/solutions/articles/13000105360-xero-reconcile-your-bank-account)
- **Find & Match details:**
  - Shows the outstanding difference.
  - **Adjustments → Minor adjustment** writes off rounding to a chosen GL account. **Adjustments → Bank fee** creates a fee line (contact, description, account, tax rate).
  - **Split** divides a matched bill or invoice into a part payment and a remaining balance. — [Telleroo (search summary)](https://www.telleroo.com/blog/reconciling-payments-in-xero-a-step-by-step-guide); [1st Formations (search summary)](https://help.1stformations.co.uk/accounting-service/using-xeros-find-and-match-function)
- **Cash coding** (bulk mode):
  - A spreadsheet view of statement lines, sortable by date, payee, reference, description and amount.
  - Tick boxes and bulk coding of up to **200 lines at once**. — [Insightful Accountant (search summary)](https://insightfulaccountant.com/accounting-tech/general-ledger/10-reasons-why-you-should-be-using-xero-cash-coding); [Meru Accounting (search summary)](https://meruaccounting.com/working-on-cash-coding-in-xero)
- **Two undo verbs:** — [SaasAnt](https://www.saasant.com/blog/xero-unreconcile-remove-redo/)
  - **Unreconcile** breaks the link but keeps both the bank line and the transaction.
  - **Remove & Redo** deletes the created payment or Spend/Receive Money and returns the line to the Reconcile queue.
  - Both are under **Options** on a reconciled line, or reached from Account Transactions.
- **Reconciliation report.** Lists Balance in Xero, outstanding payments/receipts not matched to statement lines, unreconciled statement lines, and Statement Balance. — [Insightful Accountant (search summary)](https://insightfulaccountant.com/accounting-tech/general-ledger/xero-in-on-xero-reconciliation-differences/)
- **(Older, 2021) reconcile redesign.**
  - More whitespace and larger fonts for WCAG accessibility, consistency with other Xero screens, and multi-device support. — [Xero blog](https://blog.xero.com/product-updates/why-weve-updated-the-bank-reconciliation-design/)
  - A user toggle between an **enlarged** view and a **compact** view "that displays more transactions on screen". — [Xero blog](https://blog.xero.com/product-updates/new-look-bank-reconciliation/)
- **JAX automatic bank reconciliation (beta from Dec 2025).**
  - **How it works:** reconciles lines automatically when confidence is high and leaves the rest. A new **"Reconciled" page** shows bank information and the accounting entries side by side, where users "review, edit, or undo any of those reconciliations".
  - **Controls:** automation can be switched on or off **per bank account**.
  - **Targets and results:** Xero's internal goal is >80% of lines. Trial users report saving 4-7 hours a week.
  - **Plans:** Grow (AU/NZ/UK), Growing (US), and Standard or above elsewhere. — [CFOtech](https://cfotech.com.au/story/xero-rolls-out-ai-bank-reconciliation-with-jax-tool)
  - **Provenance labels:** each match carries the method used, **Rule / Match / Memory / Prediction / Manual**. Memory means your own history; Prediction means how other Xero users reconciled similar lines. Users can edit account codes or remove & redo, and JAX "learns from corrections". — [Xero reconcile page](https://www.xero.com/us/accounting-software/reconcile-bank-transactions/)
  - **Later claims:** ~50% of monthly reconciliation time saved, 100M+ transactions auto-reconciled, and "complex splits" (one payment across categories) coming. — [Xero Xerocon US release](https://www.xero.com/media-releases/new-ai-innovations-xerocon-denver/)

**Zoho Books**
- **Feed tabs:** **Uncategorized Transactions** and **All Transactions**, with a filter for Matched or Categorized. — [Zoho help: matching](https://zstatic.zohostatic.com/books/help/banking/matching-transactions.md)
- **Matches pane.**
  - Clicking a line opens a **right-hand pane** of "best possible matches". A **"Match found"** tag appears when criteria align and amounts are equal.
  - Match search filters by amount range, date range, contact, type and reference.
  - A **"Multi-select & Match"** toggle matches one line to several transactions. — same source
- **Undo verbs:**
  - **Unmatch** turns the record back into a "Manually Added" transaction.
  - **Uncategorize** deletes the transaction that categorising created. — same source
- **Pane buttons:** "Match transaction" or **"Categorize Manually"** at the bottom of the pane. — [Zoho KB](https://www.zoho.com/books/kb/banking/auto-categorization-of-transactions.html)
- **Transfers:**
  1. Categorise the withdrawal as "Transfer To Another Account".
  2. Zoho immediately creates a manually added transaction in the destination account.
  3. The deposit line is matched to it from Possible Matches, which avoids duplicates. — [Zoho KB](https://www.zoho.com/books/kb/banking/match-tf-transactions.html)
- **Reconcile flow:**
  - Banking → account → gear → **Reconcile Account** → Start Date / End Date / **Closing Balance** → **Start Reconciliation**.
  - Tick transactions. Only matched, categorized and manually added items are listed. **+Add Transaction** adds adjustments.
  - The header shows **Cleared Amount** and **Difference**. Closing Balance can be edited inline.
  - Buttons: **"Save and Reconcile Later"** / **"Reconcile"**. Attachments are allowed.
  - Undo: hover a period → More → **"Undo Reconciliation"**. Later periods must be undone first.
  - The opening balance can no longer be edited once any reconciliation exists. — [Zoho help: reconciliation](https://zstatic.zohostatic.com/books/help/banking/reconciliation.md)

**Sage Accounting**
- **Bank feed lines:** each incoming line has **Match**, **Create** and **Transfer** buttons in the middle of the row. Match links to an existing payment or receipt, or pays outstanding invoices. — [Sage help (search summary; page now 404)](https://help.sbc.sage.com/en-us/accounting/banking/bank%20feeds/bank-feeds-downloaded-transactions.html)
- **Payment processors:** Stripe and GoCardless payouts are auto-matched and auto-categorised ("instant reconciliation"). — [Sage product tour](https://assets.sage.com/product-tour/dist/sbca/en-GB/index.html)
- **Reconcile flow:** — [Sage CA KB](https://ca-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=240304191541010)
  - Banking → account → **Reconcile**. Enter **Statement Date**, **Statement End Balance** and **Reference** (e.g. the statement page), then **Apply**.
  - A **Reconciled** checkbox column, or **Reconcile All Entries** / **Unreconcile All Entries**.
  - **Interest and Charges** posts bank interest and fees during reconciliation.
  - The **Finish** menu includes **Save for later**.
  - Past reconciliations are under **Reconciliations** on the bank record.
- **Fixing a difference:** re-enter the end balance and press Apply until the difference is zero, and untick wrong lines. — [Sage help (search summary)](https://help.sbc.sage.com/en-us/start/banking/extra-bank-reconcile-discrepancies.html)

**FreeAgent**
- **Explanation types:** — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/5545357536914)
  - **Money out:** Sales Refund, Payment, Bill Payment, Transfer to Another Account, Money Paid to User, Purchase of Capital Asset, Purchase of Stock, Credit Note Refund.
  - **Money in:** Invoice Receipt, Sales, Transfer from Another Account, Refund, Bill Refund, Money Received from User, Disposal of Capital Asset, Sale of Stock.
  - Invoice Receipt and Bill Payment show an Invoice or Bill dropdown.
- **For Approval queue.**
  - Machine-explained lines go into a dedicated **"For Approval"** tab. Their text is **coloured orange with an orange "eye" icon**. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/115001586004); [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/115001217310)
  - Introduced June 2020 (older). — [FreeAgent blog](https://freeagent.com/blog/smarter-faster-better-banking)
- **Bulk approve:** a select-all checkbox to the left of "Date". — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/115001217310)
- **Multiple item splitting (Aug 2025):** one bank line can pay several invoices or bills. — [FreeAgent timeline](https://www.freeagent.com/timeline)
- **Find & Fix (27 May 2025):**
  - Bulk-edits accounting category, VAT rate and description on up to **100** bank explanations, bill items or expenses at once.
  - Filters: date, category, VAT rate, amount, contact, "description contains".
  - Locked periods cannot be touched.
  - A **Bulk Edit History** records from/to values. — [FreeAgent blog](https://www.freeagent.com/blog/introducing-find-and-fix/); [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/24572810244242)
- **Reconciliation approach:** there is no tick-off screen.
  - A **Bank Reconciliation report** checks FreeAgent's balance against the statement. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/7096372611346)
  - Feed accounts show **"Balance at bank"** in the "Bank details" sidebar for comparison. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/360021458319)
- **Statement upload:** banks without a feed are imported as QIF uploads. — [UK Business Forums](https://www.ukbusinessforums.co.uk/threads/freeagent-opinion.424006/)

### Inferences
- **Patterns worth rebuilding for an agent-operated local app:**
  1. **Provenance labels** on every auto-handled line, as in Xero's Rule / Match / Memory / Prediction / Manual. These tell the user why the agent did something.
  2. **A "Reconciled by agent" review page** with per-line undo (Xero), plus a **per-account automation on/off switch**.
  3. **Confidence-grouped batch posting** (QBO "Ready to post"; see §13).
  4. **A FreeAgent-style "For Approval" tab** with a distinct colour for machine-made entries.
  5. **Two separate undo verbs:** *unlink* versus *delete the created transaction* (Xero Unreconcile vs Remove & Redo; Zoho Unmatch vs Uncategorize).
- **Two kinds of "reconcile".** (a) Clearing feed lines into the ledger. (b) Proving a statement balance with tick-off, a Difference counter and save-for-later. QBO, Zoho and Sage keep (b) as a distinct, lockable step, and Zoho prevents editing the opening balance once (b) exists. A local app that imports CSV/OFX statements should support both.
- **Density.** Xero offers an enlarged-vs-compact toggle, and QBO users disliked the readability of the new table (§15). Density control is worth shipping.

### Gaps
- Not verified: QBO's exact Match dialog fields and Split dialog, and whether QBO has a keyboard flow in the new banking page.
- Not verified: Xero's in-app tab names (Reconcile / Cash coding / Bank statements / Account transactions) from a primary page; Xero Central blocked fetching.
- Not verified: Sage feed tab names (e.g., "To Review") and the Create form fields; FreeAgent's exact tab label for unexplained lines.

---

## 3. Categorization rules and bank rules

### Takeaway
Every suite pairs deterministic, ordered **rules** (conditions → actions, optional auto-apply) with **learned suggestions** from history, and shows them with different badges.
- **QBO:** up to 5 conditions, All/Any logic, drag-to-reorder priority, and an opt-in "auto-add" that bypasses review.
- **Xero:** rules propose (they need OK) unless JAX auto-reconciliation is enabled.
- **FreeAgent:** "Guess" works through a fixed precedence list, first match wins, and has a user-maintained exclusion list.

### Cited Findings
**QuickBooks Online**
- **Rule fields:** Money in / Money out; one account or all; **All / Any** conditions; **up to 5 conditions**. Each condition is on Description, Bank text or Amount, using Contains / Doesn't contain / Is exactly. — [QBO help: bank rules](https://quickbooks.intuit.com/learn-support/en-us/banking/how-to-set-and-use-banking-rules-for-downloaded-transactions/00/262188)
- **Actions:** set transaction type, category, payee, tax and customer, with more fields depending on settings. — same source
- **Marking and management:** rule-applied lines get a **"RULE"** badge. Rules can be copied, disabled, enabled and deleted. **Priority reorder**: the highest-priority rule applies first. — same source
- **Auto-add:**
  - Enabled with "Automatically confirm transactions this rule applies to". These lines skip Pending and post directly. — same source
  - Auto-add runs on sign-in, on file upload, and when an auto-add rule is created or modified. Reorder is done by dragging. — [QBO help (search summary)](https://quickbooks.intuit.com/learn-support/en-us/banking/how-to-set-and-use-banking-rules-for-downloaded-transactions/00/239551)
- **Pitfall:** "Bank text" (raw) and "Description" (simplified) are different. "Show full bank description" reveals the raw text. — [QBO help](https://quickbooks.intuit.com/learn-support/en-us/banking/how-to-set-and-use-banking-rules-for-downloaded-transactions/00/262188)
- **(Older, 2014):** rule import/export between companies, OR logic across conditions, and a per-vendor toggle to disable auto-categorization. — [QBO release notes](https://quickbooks.intuit.com/r/whats-new/quickbooks-online-bank-feeds-release-notes)
- **Learned suggestions.**
  - If you regularly categorize lines with a given name in the bank description, QBO suggests that category and **shows the past transactions it found similar**.
  - A same-amount, same-date posted expense is suggested as a match. — [QBO help: Ready to post (search summary)](https://quickbooks.intuit.com/learn-support/en-ca/help-article/account-management/use-ready-post-quickbooks-online/L9jzjf8Xe_CA_en_CA)

**Xero**
- **Rule types:** Spend money, Receive money, Transfer money. — [Insightful Accountant (search summary)](https://insightfulaccountant.com/accounting-tech/general-ledger/xero-in-on-xero-an-overview-of-bank-rules/)
- **Conditions:** "Any" or "All", on Payee, Reference, Description, Amount, Analysis Code or "Any Text Field". — same source
- **Actions and scope:** — [Insightful Accountant](https://insightfulaccountant.com/accounting-tech/general-ledger/xero-in-on-xero-bank-rules-tips-tricks/)
  - Set the contact (existing or new).
  - Allocate lines by **fixed amounts and/or percentages**, including tracking categories (e.g. a split across departments).
  - Apply to all bank accounts or specific ones.
  - Each rule needs a title.
  - Classic rules **suggest** a transaction that still needs **OK**.
- **"Rule" as an auto-reconcile method.** "Rule" is one of the four auto-reconciliation methods JAX uses. With automation on, rule hits can be reconciled without a click. — [Xero reconcile page](https://www.xero.com/us/accounting-software/reconcile-bank-transactions/)

**Zoho Books**
- **Path:** Banking → account → gear (next to Import Statement) → **Manage Transaction Rules** → New Rule. — [Zoho help](https://www.zoho.com/sa/books/help/banking/transaction-rule.html)
- **Rule fields:** — [Zoho help: transaction rules](https://zstatic.zohostatic.com/books/help/banking/transaction-rule.md)
  - Applies to Deposits or Withdrawals.
  - "All the following criteria matches" / "Any one of the following criteria matches".
  - Condition fields: Payee, Description, Reference Number, Amount.
  - Operators: Is / Contains / Starts with / Is empty, and =, >, >=, <, <= for amounts.
  - Actions: Record As, Account, Paid Via, and Reference from the statement or entered manually.
- **Two modes:** lines become **"Recognized Transactions"** that the user confirms, or are auto-categorized when "Allow Zoho Books to categorize my bank statements" is on. This reading should be checked against the page. — same source
- **Rule prompt:** after a manual categorisation, Zoho prompts you to create a rule. Later matching lines open with the form pre-filled. — [Zoho KB](https://www.zoho.com/books/kb/banking/auto-categorization-of-transactions.html)

**Sage Accounting**
- **Path:** Banking → Manage bank rules → Bank Account dropdown → Create rule. — [Sage KB](https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=222001000100746)
- **Rule fields:** name, Payments or Receipts, and "Activate this rule when saving". — same source
- **Conditions:** Field (e.g. Reference, Amount) with Equals / Contains / Does not contain. **Conditions are case-sensitive.** — same source
- **Actions:** Transaction type, Contact, Method, Reference, Description, Ledger Account, VAT Rate. — same source
- **Priority and limits:** priority is settable, with a limit of **300 rules per bank account**. Rules apply to the next batch of incoming lines. — same source
- **[Sage 50 CA]** Only one rule applies per transaction, so the most specific rule should go first. — [Sage 50 help](https://help-sage50.na.sage.com/en-ca/core/2024/Content/ConnectedServices/BankingService/About_Bank_Rules.htm)

**FreeAgent**
- **Guess precedence.** Guess works through this list and stops at the first match: — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/115001586004)
  1. matching manually added transactions
  2. PayPal
  3. transfers between your accounts
  4. paying invoices / credit notes
  5. bills / bill refunds
  6. "similarly explained transactions"
- **Guess controls:** specific terms can be excluded from guessing, and Guess can be disabled. — [FreeAgent support: Manage Guess (search summary)](https://support.freeagent.com/hc/en-gb/articles/360014732520)
- **ML model (older, since June 2020):** adapted from a language model pre-trained on text and fine-tuned on "tens of millions of bank transactions". It had explained 18M+ transactions by Aug 2023. — [FreeAgent blog](https://www.freeagent.com/blog/how-freeagent-uses-ai/)
- **User-defined bank rules arrived late:** custom bank rules for practices in May 2026, and for unincorporated landlords in Aug 2026. — [FreeAgent timeline](https://www.freeagent.com/timeline)

### Inferences
- **Rule model** (common denominator):
  - direction (in/out/transfer), account scope, All/Any logic, a small number of conditions (QBO caps at 5);
  - text operators plus numeric operators for amount (Zoho's set is the most complete);
  - actions = contact + account + tax + memo, with percentage/fixed splits (Xero);
  - explicit priority ordering, first match wins;
  - a per-rule "auto-post" flag that is off by default.
- **Badges.** Badge "rule" and "AI suggestion" differently (QBO RULE vs sparkle), and let the user jump from a badge to the rule or to the similar past transactions.
- **For an AI agent:** Zoho's "create a rule from this manual categorisation?" prompt and FreeAgent's exclusion list are good human-in-the-loop hooks. The agent can propose a rule and the user accepts it, or the user can stop the learner from generalising a merchant.

### Gaps
- Not verified: QBO rule split-by-percentage action; Xero rule-ordering semantics; Sage's AND/OR semantics for multiple conditions.

---

## 4. Invoicing: editor, statuses, reminders, payments, credit notes, recurring, quotes, statements

### Takeaway
The invoice editor is the same shape everywhere: header (customer, number, dates, terms), a line-item grid with per-line tax, totals, notes and terms, then save variants (Draft / Save & Send / Save & Send later).
- **Xero (classic switched off Feb 2025)** and **QBO (2024)** both forced migrations to new editors with live preview.
- **Reminders** are rule-based everywhere and becoming AI-driven: the QBO Payments Agent, JAX payment follow-ups, Sage Copilot chasing and the Zoho Zia Invoice Agent.
- **Zoho** publishes the clearest status model.

### Cited Findings
**QuickBooks Online**
- **New editor migration.** The new invoice layout reached Plus/Advanced users from **May 6, 2024**. It has a "Manage" panel with live preview, while older tooling lives under Settings → Custom form styles. — [SaasAnt (search summary)](https://www.saasant.com/blog/edit-invoice-template-quickbooks/)
  - Community threads ask how to remove Qty/Rate columns and how to revert to the old layout. — [QB Community](https://quickbooks.intuit.com/community/reports-and-accounting-5/how-to-revert-back-to-old-invoice-layout-57645); [QB Community](https://quickbooks.intuit.com/community/reports-and-accounting-5/how-do-i-remove-the-qty-and-rate-from-my-invoice-in-new-layout-53830)
- **Sales tax "See the math".** On invoices and sales receipts, "See the math" breaks down how automated sales tax was calculated. — [QBO help: sales tax](https://quickbooks.intuit.com/learn-support/en-us/sales-tax/set-up-sales-tax/00/185792)
- **Payments Agent:**
  - "predict[s] late payments, automate[s] invoice tracking, and create[s] and send[s] invoices and reminders", and claims customers are paid "5 days faster".
  - The 5-day figure comes from Intuit Assist beta users of outstanding-invoice notifications and **AI-drafted invoice reminders**, and is not available in QBO Advanced. — [Intuit press release](https://investors.intuit.com/_assets/_08ee5483ec4c057568cc8774f3fd6aad/intuit/news/2025-07-01_Intuit_Introduces_Ground_Breaking_Virtual_Team_of__1258.pdf)

**Xero**
- **New invoicing replaced classic.** Classic invoicing was switched off on **27 Feb 2025 (NZDT)**. — [Xero new invoicing (search summary)](https://www.xero.com/uk/campaign/new-invoicing/)
- **Delivered:** — [Xero new invoicing](https://www.xero.com/campaign/new-invoicing)
  - a creation screen where you "show and hide the fields that matter to you"
  - "a live, side-by-side email preview"
  - an optimised email format
  - a simpler customer payment flow
  - keyboard shortcuts
  - faster date picking
- **Roadmap:** — same source
  - a reimagined template editor
  - progress payments
  - smarter automated reminders
  - SMS invoices (AU only)
  - an end-to-end statement workflow
  - multiple delivery addresses
  - reorderable rows
- **Feature page:** — [Xero invoicing](https://www.xero.com/us/accounting-software/send-invoices/)
  - a **"Pay now" button** (card, ACH debit, Apple Pay, Google Pay, Klarna via Stripe/GoCardless)
  - repeating invoices
  - automated reminders with custom wording that stop once the payment is reconciled
  - quote → invoice conversion
  - a notification "the moment a customer opens your invoice"
  - JAX natural-language invoice creation in Xero, WhatsApp or SMS
- **JAX payment follow-ups.** Adapts to payment behaviour by "consolidating multiple invoices, sending perfectly timed nudges, or pivoting to SMS for non-responsive clients". — [IT Brief](https://itbrief.co.uk/story/xero-adds-ai-tools-to-jax-for-small-business-finance)

**Zoho Books**
- **Editor field order:** — [Zoho invoice help](https://www.zoho.com/books/help/invoice/)
  - Customer Name → Invoice# (auto series) → Order Number → Invoice Date → Terms → Due Date → Salesperson → Price List.
  - **Item table:** qty, rate and tax auto-filled from the item; discount as % or fixed; bulk add; header rows and subtotal rows.
  - Then Shipping Charges (taxable) → **Adjustment** (±) → Customer Notes → Terms & Conditions → attachments.
- **Save buttons:** **Save as Draft / Save and Send / Save and Send Later**. — same source
- **Record actions:** Record Payment, Send, **Mark as Sent**, Void (with a reason; a void can be reactivated), Clone, **Write Off** (to Bad Debt), Apply Credits, Convert, PDF. — same source
- **Statuses:** **Draft, Pending Approval, Accepted/Rejected (approval), Sent** (emailed *or* marked sent), **Viewed, Partially Paid, Paid, Overdue, Void**. — [Zoho KB statuses](https://zstatic.zohostatic.com/books/kb/invoices/quotes-invoices-status.md); [Zoho invoice help](https://www.zoho.com/books/help/invoice/)
- **Quote → invoice:** Sales → Quotes → **Convert → Convert to Invoice**. A popup supports **progress invoicing**, and the quote becomes **"Invoiced"**. To change the customer, you delete the invoice, edit the quote and re-convert. — [Zoho help: convert quote](https://www.zoho.com/books/help/quote/convert-to-inv.md)
- **Zia Invoice Agent:** a Zia icon on the invoice list shows cards for outstanding, slow payers and late invoices, with buttons **Set Payment Reminder / Send Payment Reminders / View Invoices**. — [Zoho AI features](https://www.zoho.com/us/books/help/ai-features/ai-features.html)

**Sage Accounting**
- **Recent invoice changes:** colour-coded invoice status, the customer's outstanding balance visible, and **on hold** / **disputed** flags set from the invoice. — [Sage product updates (search summary)](https://www.sage.com/en-gb/sage-business-cloud/sage-accounting/product-updates/)
- **Product tour features:** — [Sage product tour](https://assets.sage.com/product-tour/dist/sbca/en-GB/index.html)
  - branded templates
  - "Use AI to draft bulk invoices for review" and bulk quotes
  - AI-drafted reminder emails
  - payment by bank transfer, card, wallets, Direct Debit, Tap to Pay
- **Recurring invoices:**
  - Created from new, from a copied invoice, or from a copied recurring invoice. Frequencies include daily, weekly and monthly. — [Sage KB (search summary)](https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=222001000100993)
  - A separate Recurring Invoice tab offers Pause / Copy / Delete. An **"Action Required"** status appears when a global change (e.g. a tax rate) affects one. — [Sage KB (search summary)](https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=222001000100997)
- **Automatic chasing.** Overdue reminders were a long-standing feature request (older). — [Sage Community](https://communityhub.sage.com/gb/sage-accounting-and-individual/f/sage-accounting-general-discussion/201575/can-i-have-sage-send-reminders-automatically-when-invoices-become-overdue) Now Copilot "automatically follows up on late invoices using your tone and timing". — [Sage product updates (search summary)](https://www.sage.com/en-gb/sage-business-cloud/sage-accounting/product-updates/)

**FreeAgent**
- **Invoice features:** — [FreeAgent invoicing](https://www.freeagent.com/features/invoicing/)
  - itemised invoices from a price list, with VAT per line flowing to the VAT return
  - a "theme designer" (logo, font, colours)
  - recurring invoices
  - estimate → invoice conversion
  - billing tracked time and expenses
  - multi-language invoices
  - Pay Now / payment links via Tyl, Stripe, GoCardless, PayPal
- **Reminders:**
  - "Invoice Reminder Rules" fire N days before or after the due date, with optional recurring reminders that stop when the invoice is paid in full. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/115001223604)
  - Automatic thank-you emails. — [FreeAgent blog](https://www.freeagent.com/blog/invoice-reminder-and-thank-you-emails/)
- **Recent additions:** — [FreeAgent timeline](https://www.freeagent.com/timeline)
  - pro-forma invoices (Aug 2025)
  - "Invoice quick actions" from the table, such as downloading a PDF or sending a reminder (Sep 2025)
  - bulk PDF download of up to 100 (Aug 2026)
  - automated Stripe reconciliation (Apr 2025)
  - Tap to Pay (Feb 2026)

### Inferences
- **A minimal "production" invoice model:**
  - header: contact, number series, issue date, terms → due date, reference/PO
  - lines: item, description, qty, rate, discount, tax code, account, optional tracking
  - header and subtotal rows (Zoho)
  - shipping and a ± Adjustment row
  - notes and terms, attachments
- **Statuses** (Zoho's set is the reference): Draft → (Awaiting approval) → Sent/Viewed → Partially paid → Paid, with Overdue as a derived flag and Void (reversible) separate from Delete. Write-off goes to Bad Debt.
- **Live preview** beside the editor is now table stakes (Xero, QBO).
- **Agent-friendly patterns:**
  - Zoho's "Mark as Sent" for invoices delivered outside the app.
  - QBO's "See the math" explainability for computed tax.
  - Sage's "Action Required" state when a global change invalidates a recurring template.

### Gaps
- Not verified: QBO credit memo, recurring and statement screens; Xero credit notes and statements in new invoicing; Zoho customer statements and portal.
- Not verified: Sage invoice editor columns; FreeAgent's full status list (Draft / Scheduled / Sent / Overdue / Paid).

---

## 5. Bills and accounts payable (capture, approval, payment, vendor credits, aged payables)

### Takeaway
Bill capture has converged on one pipeline: drop, email-forward or photograph a document → OCR/AI extracts supplier, dates, amounts and lines → a **draft** lands in a review queue with a count → a human approves → it posts → it is later matched to the bank payment. Xero adds pre-payment fraud checks (JAX Bill Protection), and Sage's queue is literally called "Draft to approve".

### Cited Findings
**QuickBooks Online**
- **Receipt/bill capture:**
  - Documents go to Banking → **Receipts** tab, into **For Review** (processed within about 5 minutes).
  - The user picks **Document type: Bill or Receipt**. Date and amount are pre-filled. Bills allow only one expense account (no line split).
  - Input by drag and drop, email or mobile photo.
  - The paid bill is later matched to the bank feed. — [Insightful Accountant (older; date not shown)](https://insightfulaccountant.com/accounting-tech/general-ledger/quickbooks-online-receipt-capture-can-now-import-bills-too)
- **Forwarding address.** A third-party guide says each user gets an "@assist.intuit.com" forwarding address. Emailed documents land as receipts unless the user chooses **Create bill**. — [Tailride (third-party, search summary)](https://tailride.so/blog/how-to-email-invoices-to-quickbooks)
- **Bill Pay matching.** Bills paid through QuickBooks Bill Pay are auto-matched to bank lines by Intuit Assist. — [CPA Practice Advisor (search summary)](https://www.cpapracticeadvisor.com/2024/11/20/quickbooks-adds-gen-ai-financial-assistant-to-power-business-growth/152256/)

**Xero**
- **Bills feature page:** — [Xero bills](https://www.xero.com/us/accounting-software/pay-bills/)
  - upload or forward to a Xero email inbox; AI extraction creates "draft bills ready for approval" ("Smart Document Capture")
  - duplicate bills are detected and flagged
  - roles control who creates and who approves
  - bills organised by status (Draft, Awaiting approval, Awaiting payment, Paid), with planned payment dates
  - repeating bills
  - payment files exported for batch payment in online banking; free US ACH
  - an **Aged Payables Detail** report
- **JAX Bill Protection.** "Automatically inspects every bill before payment, flagging unusual amounts, altered bank details, or unfamiliar suppliers." — [Xero Xerocon London release](https://www.xero.com/us/media-releases/xero-announces-new-ai-innovations-xerocon-london/); [IT Brief](https://itbrief.co.uk/story/xero-adds-ai-tools-to-jax-for-small-business-finance)
- **Cash Flow Actions.** Suggests delaying non-critical bills to protect payroll. — same sources

**Zoho Books**
- **Documents module with auto-scan (older, 2017 post):** — [Zoho blog (older)](https://blog.zoho.com/books/auto-scan-receipts-document-management.html)
  - extracts date, amount and merchant
  - input by upload, a dedicated forwarding email (lands in an **Inbox** tab), or mobile scan
  - a document can become an expense, bill or purchase order, or be matched to feeds
- Vendor Credits has its own help page. — [Zoho llms index → vendor credits](https://www.zoho.com/books/help/vendor-credits/index.md)
- The Payables reports include Vendor Balance Summary. — [Zoho reports help](https://www.zoho.com/books/help/reports/)

**Sage Accounting**
- **AI Capture ("Purchase automation"):** — [Sage KB](https://gb-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=222001000101064)
  - **Input:** drag and drop, email forwarding or mobile camera. PDF/JPG/PNG/TIFF up to 20 MB, 25 files per upload, one transaction per file.
  - **Queue:** documents land in a **"Draft to approve"** tab that shows a count. Status goes to **"To review"** after about 1 minute. "Select a transaction row to view the draft invoice".
  - **Allowance:** only approvals count against it (Standard 30/month, Plus 100/month, then £0.20 each).
- **AP page claims.** "You review and approve each draft before it posts"; duplicates "detected and flagged automatically". — [Sage AP page (search summary)](https://www.sage.com/en-gb/sage-business-cloud/sage-accounting/features/accounts-payable/)

**FreeAgent**
- **Smart Capture for bills (5 Nov 2024):** — [FreeAgent blog](https://www.freeagent.com/blog/smart-capture-for-bills/)
  - drag and drop, mobile camera or upload, singly or in bulk
  - data extracted, with an AI-suggested category
  - matched to the bank payment, then the user hits "approve"
  - 10 files a month free, then Smart Capture Unlimited at £5 + VAT a month
- **Jenesys partnership (May 2025).** Its AI agent "Jack" takes documents via WhatsApp, email or fetch, extracts line items, assigns GL codes and "learns individual accountant preferences". — [Accountancy Age](https://accountancyage.com/2025/05/14/freeagent-launches-new-features-and-ai-partnership-at-accountex-2025/)

### Inferences
- **Reusable pipeline for a local app:**
  - **Inbox:** a watched folder or drag-drop zone, plus an optional email import.
  - **Extraction:** produces a **draft** bill or expense with field-level provenance.
  - **"Drafts to approve" queue:** shows a count badge. Sage counts usage only on approval, which suits per-action AI cost.
  - **Duplicate check:** same supplier + number + amount.
  - **Pre-payment anomaly checks** (Xero Bill Protection): amount outlier, changed bank details, new supplier.
  - **Matching:** auto-match to the later bank payment.
- **Statuses:** Xero's bill states (Draft / Awaiting approval / Awaiting payment / Paid) map cleanly onto a single-user flow if "approval" means "user confirms the agent's draft".

### Gaps
- Not verified: QBO vendor credits, the batch bill payment UI, and aged payables screen details.
- Not verified: Xero batch payment screen layout; Zoho bill approval states; Sage supplier payment runs, credit notes, aged creditors and AutoEntry; FreeAgent bill status names.

---

## 6. Receipts, attachments and expense claims

### Takeaway
Attachments are first-class on bank lines and transactions everywhere, and AI now **pairs receipts with bank lines automatically**:
- **FreeAgent** retries the match every 24 hours for 7 days.
- **QBO** offers drag-and-drop onto feed rows.
- **Xero JAX** flags missing receipts and can chase documents.

### Cited Findings
- **QBO:**
  - Drag-and-drop attachments onto bank feed rows (2025-26). — [Firm of the Future](https://www.firmofthefuture.com/product-update/accountants-quickbooks-bank-feed-transition/)
  - Attachments on bank transactions since 2015 (older). — [QBO release notes](https://quickbooks.intuit.com/r/whats-new/quickbooks-online-bank-feeds-release-notes)
  - The Receipts tab pre-fills date, vendor, amount and last-4 card digits, then matches the receipt to a feed transaction. — [Tailride (third-party, search summary)](https://tailride.so/blog/how-to-email-invoices-to-quickbooks)
- **Xero:**
  - Receipts and files attach to reconciled transactions. — [Xero reconcile page](https://www.xero.com/us/accounting-software/reconcile-bank-transactions/)
  - JAX "identifies missing receipts and flags them for follow-up". — [Xero Xerocon London release](https://www.xero.com/us/media-releases/xero-announces-new-ai-innovations-xerocon-london/)
  - **Document Requests** (Partner Hub): JAX requests documents, sends reminders, answers clarifications and matches documents to transactions, with "customers approve each step". — [Xero Xerocon US release](https://www.xero.com/media-releases/new-ai-innovations-xerocon-denver/)
- **Zoho Books:**
  - Attachments on invoices and reconciliations (from desktop, cloud or Documents). — [Zoho invoice help](https://www.zoho.com/books/help/invoice/); [Zoho reconciliation](https://zstatic.zohostatic.com/books/help/banking/reconciliation.md)
  - "Image to Text" AI custom fields, in Early Access. — [Zoho AI features](https://www.zoho.com/us/books/help/ai-features/ai-features.html)
- **Sage Accounting:**
  - Snap or upload receipts on Standard and Plus, with Copilot capturing the data. — [Sage Community (search summary)](https://communityhub.sage.com/gb/sage-accounting-and-individual/f/sage-accounting-general-discussion/241366/clarification-on-pricing-updates/580989)
  - "Sage Copilot reads totals, tax, and dates". — [Sage product tour](https://assets.sage.com/product-tour/dist/sbca/en-GB/index.html)
- **FreeAgent:**
  - **Smart Capture for receipts (Nov 2023):** extracts date and amount and attaches the file to a matching Money-out transaction that is For approval or explained. If nothing matches, it re-checks every 24 hours for 7 days. The transaction must be dated within the receipt date + 2 business days. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/12583752961554)
  - **Later additions:** suggested matches (Nov 2025), attachment preview (May 2026), multiple attachments per transaction (Jul 2026), and an attachment-status column in the Show Transactions report (Jun 2026). — [FreeAgent timeline](https://www.freeagent.com/timeline)
  - **Out-of-pocket expenses** are their own record type, repaid via "Money Paid to User". — [FreeAgent blog](https://www.freeagent.com/blog/introducing-find-and-fix/); [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/5545357536914)

### Inferences
- FreeAgent's matching window (receipt date to +2 business days, retried daily for 7 days) is a concrete, reusable heuristic for an agent pairing receipts with card lines.
- An "attachment status" column ("missing receipt") on transaction lists (FreeAgent 2026; JAX missing-receipt flags) is a cheap, high-value audit aid.

### Gaps
- Not verified: Xero Expenses (claims) UI; QBO expense-claim flow; Zoho expense claims; FreeAgent mileage claim UI.

---

## 7. Tax (VAT/GST, MTD, US sales tax, per-line rates, inclusive vs exclusive)

### Takeaway
- **QBO:** US sales tax is fully automated from ship-to address, product tax category and customer exemption, with a "See the math" explanation.
- **UK suites** (Xero, Sage, FreeAgent) file VAT to HMRC under MTD and now ship automated pre-submission checks: Sage Copilot error detection, FreeAgent VAT Checker, and JAX VAT checking (planned).
- **MTD for Income Tax** started 6 April 2026 and is a 2026 battleground.

### Cited Findings
- **QBO (US automated sales tax):**
  - **Rate inputs:** customer tax status (exempt customers set in Customer Hub → Customers → Additional info → "This customer is tax exempt" + reason); location (the "ship to" address, or the business address if none; origin-based states use the seller location); and item type.
  - **Explanation:** "See the math" on the form.
  - **Nexus:** economic-nexus threshold alerts. — [QBO help: set up sales tax](https://quickbooks.intuit.com/learn-support/en-us/sales-tax/set-up-sales-tax/00/185792)
  - **Canadian equivalent:** assigns "sales tax categories to anything you sell". — [QBO CA help](https://quickbooks.intuit.com/learn-support/en-ca/help-article/sales-taxes/learn-quickbooks-online-calculates-sales-tax/L8VWCLobK_CA_en_CA)
  - **Bank rules** can set the tax field. — [QBO help: bank rules](https://quickbooks.intuit.com/learn-support/en-us/banking/how-to-set-and-use-banking-rules-for-downloaded-transactions/00/262188)
- **Xero:**
  - JAX "VAT checking" is listed among upcoming JAX additions. — [Xero Xerocon London release](https://www.xero.com/us/media-releases/xero-announces-new-ai-innovations-xerocon-london/)
  - Corporation Tax filing is coming later in 2026 (UK). — [IT Brief](https://itbrief.co.uk/story/xero-adds-ai-tools-to-jax-for-small-business-finance)
  - The Find & Match bank-fee adjustment includes a tax rate. — [1st Formations (search summary)](https://help.1stformations.co.uk/accounting-service/using-xeros-find-and-match-function)
- **Zoho Books:**
  - Tax is set per invoice line and auto-filled from the item. — [Zoho invoice help](https://www.zoho.com/books/help/invoice/)
  - Tax reports include Overseas tax, VAT MOSS, OSS/IOSS and FEC. — [Zoho reports help](https://www.zoho.com/books/help/reports/)
  - Manual journal lines carry a Tax column and a Sales/Purchases transaction type. — [Zoho manual journal](https://www.zoho.com/books/help/accountant/manual-journal.md)
- **Sage Accounting:**
  - **Copilot VAT:** deadline alerts; "checks your books for mistakes" and flags "common mistakes HMRC would care about"; calculates VAT owed; submits directly to HMRC. — [Sage product updates (search summary)](https://www.sage.com/en-gb/sage-business-cloud/sage-accounting/product-updates/); [Sage product tour](https://assets.sage.com/product-tour/dist/sbca/en-GB/index.html)
  - **VAT scheme:** set at Settings → Business Settings → Accounting Dates & VAT → **VAT Scheme** (e.g. Flat Rate, then enter the %). — [Sage help (search summary)](https://help.accounting.sage.com/en-gb/accounting/tax/flat-rate-vat.html)
  - **MTD for Income Tax:** starts 6 Apr 2026, with quarterly updates due 7 Aug / 7 Nov / 7 Feb / 7 May. Thresholds are £50k, then £30k (2027) and £20k (2028). The free **Sage Sole Trader** app covers it. — [Sage MTD ITSA (search summary)](https://www.sage.com/en-gb/making-tax-digital/self-assessment/)
- **FreeAgent:**
  - **VAT Checker:** flags rates that differ from the default, custom VAT values, 0%/5%/Exempt items, and VAT charged to non-UK contacts, then produces a summary. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/35615496100498-Use-FreeAgent-s-VAT-Checker)
  - VAT Checker shipped for practices in June 2026 and for owners and landlords in September 2026. — [FreeAgent timeline](https://www.freeagent.com/timeline)
  - **MTD for Income Tax:** compulsory from 6 Apr 2026 for income over £50k. Quarterly deadlines are 7 Aug / 7 Nov / 7 Feb / 7 May. — [FreeAgent MTD ITSA](https://freeagent.com/features/mtd-for-income-tax)
  - Automated approvals and submissions arrived in April 2026, and quarterly updates from mobile in June 2026. — [FreeAgent timeline](https://www.freeagent.com/timeline); [FreeAgent blog](https://www.freeagent.com/blog/mtd-quarterly-updates-mobile/)
  - Self Assessment is filed directly. — [FreeAgent product news](https://www.freeagent.com/central/category/product-news)

### Inferences
- **Per-line tax:** a tax code on every line, defaulted from the item or account and overridable, with a computed breakdown the user can open ("See the math") is the consistent pattern.
- **Pre-filing check:** an agent-run checklist (FreeAgent VAT Checker / Sage Copilot) is a natural AI task that is easy to make explainable, because each finding links to a transaction.

### Gaps
- **Tax-inclusive vs tax-exclusive line entry** was not verified for any of the five; no source was retrieved.
- Not verified: the VAT return screen layouts (box 1-9 drill-down) for Xero, Sage and Zoho, and Zoho's UK MTD and US sales tax screens.

---

## 8. Multi-currency (foreign invoices, realized/unrealized FX, revaluation)

### Takeaway
All five revalue open foreign balances and post the difference to system FX accounts. They differ on cadence:
- **QBO:** manual "home currency adjustment".
- **Zoho:** manual "Currency Adjustment" with a preview and mandatory notes.
- **FreeAgent:** automatic **daily** revaluation, shown on each invoice.
- **Xero:** automatic, using system accounts 497/498.

### Cited Findings
- **QBO:**
  - A **home currency adjustment** creates a journal entry with zero gain/loss on AR/AP and records the date, currency and rate.
  - The effect on AR/AP shows as **unrealized** gain/loss; the effect on bank accounts as **realized**.
  - QBO saves **one exchange rate per day per account**.
  - The Transaction Detail report explains unrealized amounts. — [QBO help: home currency adjustments FAQ (search summary)](https://quickbooks.intuit.com/learn-support/global/banking/frequently-asked-questions-about-home-currency-adjustments/00/381543); [QBO help (search summary)](https://quickbooks.intuit.com/learn-support/en-us/help-article/multicurrency/enter-home-currency-adjustments-foreign-balances/L40cB0sr4_US_en_US)
- **Xero:**
  - System account **497 Bank Revaluations** holds unrealised gains/losses on foreign bank balances. Account **498 Unrealised Currency Gains** holds them on open invoices and bills.
  - Rates sync from XE.com (a third party says every 6 hours).
  - Realised and unrealised gains are calculated automatically. — [BI4Cloud (third-party, search summary)](https://support.bi4cloud.com/hc/en-us/articles/15195500532495)
  - Users ask Xero to change how bank-account unrealised gains behave. — [Xero Product Ideas](https://productideas.xero.com/forums/967121-users-setup/suggestions/45766984-multicurrency-change-behaviour-of-unrealised-gai)
- **Zoho Books:**
  - Accountant → **Currency Adjustments** → **+ Make an Adjustment** → currency, date, new rate, and **Notes (mandatory)**.
  - A preview lists open transactions with a **"Gain or Loss (BCY)"** column, where a negative sign means a loss.
  - It needs at least one open foreign transaction. — [Zoho help: currency adjustments](https://www.zoho.com/books/help/accountant/base-currency.html)
- **Sage Accounting (Plus plan):**
  - Settings → Business Settings → Currencies → "Enable Foreign Currency Transactions", with "Use Live Exchange Rates" (ECB) or manual rates. EUR, GBP and USD are built in.
  - Realised differences post to an "Exchange Rate Gains and Losses" ledger account. — [Sage KB (search summary)](https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=222001000101257)
  - A "Foreign Bank Revaluation Wizard" exists but may be a [Sage 50] article. — [Sage KB](https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=211022133636373)
- **FreeAgent:**
  - An **Unrealised / Realised gains panel at the bottom of each invoice**.
  - Unpaid invoices are revalued **daily** (one entry per day per currency) against Trade Debtors, with the offset in Unrealised Gain/Loss. The gain is realised on payment. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/115001219150)
  - Bills are also revalued daily. — [AccountingWEB](https://www.accountingweb.co.uk/community/industry-insights/freeagent-unveils-multi-currency-bills)
  - XE.com mid-market rates (since 2010, older). — [FreeAgent blog](https://www.freeagent.com/blog/multi-currency-arrives/)

### Inferences
- **Recommended pattern** for a local app: store transaction rate and amounts in both currencies; revalue open items on demand or at period end into system accounts; show an "FX gain/loss" panel per document (FreeAgent); require a note on manual revaluations (Zoho).

### Gaps
- Not verified: the realized-gain posting UI and the foreign-invoice editor currency field for Xero and Zoho.
- Unrealised revaluation of debtors/creditors in Sage cloud was not confirmed.

---

## 9. Chart of accounts, journals, manual journals, opening and conversion balances

### Takeaway
Primary-source detail was thin here except for Zoho's manual journal editor. Its notable features are a per-journal "Reporting Method" (Accrual only / Cash only / both), a Contact and Tax column on journal lines, and Draft/Published statuses.

### Cited Findings
- **Zoho Books manual journal editor:** — [Zoho manual journal](https://www.zoho.com/books/help/accountant/manual-journal.md)
  - **Header:** Date, Journal# (auto or manual via gear), Notes, **Reporting Method** ("Accrual only", "Cash only", "Accrual and Cash" default), Currency.
  - **Line columns:** Account, Contact, Transaction Type (Sales/Purchases), Tax, Debits, Credits, Reporting Tags. Debits and credits must balance.
  - **Statuses:** **Draft** (not posted) and **Published**, plus Pending Approval / Approved / Rejected when approvals are on.
- **Zoho other:** an Opening Balances settings page exists (not fetched), and the bank opening balance locks once reconciled. — [Zoho llms index](https://zstatic.zohostatic.com/books/help/llms.txt); [Zoho reconciliation](https://zstatic.zohostatic.com/books/help/banking/reconciliation.md)
- **QBO:** Chart of Accounts is reached with Ctrl+Alt+A. In Business view (2022, older) it sits under Bookkeeping. — [Dummies](https://www.dummies.com/article/technology/software/money-management-software/quickbooks/quickbooks-online-for-dummies-uk-edition-cheat-sheet-263742/); [Insightful Accountant 2022](https://insightfulaccountant.com/accounting-tech/general-ledger/new-quickbooks-online-navigation-view/)
- **Xero:** uses numeric system accounts, e.g. 497 / 498 for FX. — [BI4Cloud (search summary)](https://support.bi4cloud.com/hc/en-us/articles/15195500532495)
- **Sage Accounting:** calls accounts **"Ledger Accounts"**, e.g. as a bank-rule action. — [Sage KB](https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=222001000100746)
- **FreeAgent:** — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/24572810244242); [FreeAgent timeline](https://www.freeagent.com/timeline)
  - The chart is **"accounting categories"**.
  - Recurring journal entries auto-post on a chosen frequency (Sep 2025).
  - Per-contact opening balances for trade debtors and creditors (Dec 2025).
  - Change of year end (May 2024).

### Inferences
- **Journal patterns** worth copying:
  - Draft vs Published journals give the AI agent a staging area: the agent drafts, the user publishes.
  - Optional contact and tax per journal line.
  - Recurring journals.
  - Per-contact opening AR/AP balances for conversion from another system.

### Gaps
- Not verified: QBO journal entry screen, Xero manual journal screen and conversion balances wizard, Sage journals and opening balances, and FreeAgent's "Start date and opening balances" screen.

---

## 10. Reports (P&L, BS, cash flow, aged AR/AP, TB, GL, drill-down, comparisons, custom, tracking)

### Takeaway
- **Zoho Books** has the most fully documented report customizer: Compare With, Group By, account filters, column chooser with drag reorder, cash/accrual basis, a **table-density setting (Classic / Compact / Super Compact)**, formula rows, saved and scheduled reports.
- **Xero** focuses on a layout editor with formula rows and report packs.
- **FreeAgent** added packaged "Management Reports" (2025) and "Tracking Groups" (2026).
- **Xero's** dimension model is notably limited: 2 tracking categories.

### Cited Findings
- **Zoho Books:**
  - **Report categories:** — [Zoho reports help](https://www.zoho.com/books/help/reports/)
    - Business Overview (P&L, Cash Flow, Balance Sheet, Business Performance Ratios, Movement of Equity)
    - Sales, Inventory, Receivables (aging), Payables, Payments Received
    - Activity (Activity Logs)
    - Tax
  - **Report features:** scheduling, shared access levels, PDF layout config. "Draft transactions never appear in reports." — same source
  - **Custom report builder:** — [Zoho custom reports](https://www.zoho.com/books/help/reports/custom-reports.md)
    - Parent and child modules.
    - General Filters: Date Range, **Compare With** (previous periods / years), **Group By**, **Filter Accounts** (all / with transactions / non-zero), and Advanced Filters (projects, reporting tags, branches).
    - **Show/Hide Columns** with drag reorder.
    - Layout: **Report Basis** (cash/accrual), **Table Density: Classic / Compact / Super Compact**, paper, font, margins.
    - Account Groups, Text Fields and **Formula Rows**.
    - Sharing: Only Me / Selected / Everyone.
  - **AI on reports:** charts, **View Forecast**, **View Anomaly**, and **Zia Insights**. — [Zoho AI features](https://www.zoho.com/us/books/help/ai-features/ai-features.html)
- **Xero:**
  - **Reporting enhancements:** — [Xero blog: reporting enhancements](https://blog.xero.com/product-updates/reporting-enhancements/)
    - formula rows shown as **percentages** in the report
    - auto-mapping of account codes to report codes, with a banner that "flags unmapped accounts"
    - paste formatted Trading Statements from Excel
    - custom reports reusable in Advisor Report Packs
    - more flexible Account Transactions report
  - **Layout editor:** supports formulas with built-in functions. — [CBC Partners (search summary)](https://cbcpartners.com.au/xero-resources/use-the-layout-editor-to-customise-reports/)
  - **Tracking categories:** **2 active** (4 total including archived), up to 100 options each. Every line carries one option per category. Reporting is via a P&L tracking filter or the **Tracking Summary** report, and reports can't break out both categories together. — [FieldProMax (search summary)](https://www.fieldpromax.com/blog/xero-tracking-categories-for-job-costing-setup-and-limits)
  - **Other reports:** Bank Reconciliation Summary (missing, deleted or duplicated transactions) and Aged Payables Detail. — [Xero reconcile page](https://www.xero.com/us/accounting-software/reconcile-bank-transactions/); [Xero bills](https://www.xero.com/us/accounting-software/pay-bills/)
- **QBO:**
  - Reports → **Standard reports** has a search field. The Exceptions to Closing Date report, Transaction Detail report and reconciliation reports (History by account) all exist. — [QBO help: closed books](https://quickbooks.intuit.com/learn-support/en-us/help-article/customer-company-settings/edit-closed-books/L76xHuaZ5_US_en_US); [QBO help: reconcile](https://quickbooks.intuit.com/learn-support/en-global/help-article/statement-reconciliation/reconcile-account-quickbooks-online/L3XzsllsK_ROW_en)
  - The **Finance Agent** offers "robust reporting, KPI analysis, and scenario planning and forecasting based on performance and peer benchmarking" (mid-market). — [Intuit press release](https://investors.intuit.com/_assets/_08ee5483ec4c057568cc8774f3fd6aad/intuit/news/2025-07-01_Intuit_Introduces_Ground_Breaking_Virtual_Team_of__1258.pdf)
- **Sage Accounting:**
  - A cash-flow forecasting tool. — [Sage product tour](https://assets.sage.com/product-tour/dist/sbca/en-GB/index.html)
  - Reviewers value Excel export. — [Capterra (search summary)](https://capterra.com/p/168740/Sage-One-UK/reviews/)
- **FreeAgent:**
  - **Management Reports (27 May 2025):** Executive Summary, P&L, Balance Sheet, Aged Debtors & Creditors and Notes; yearly / quarterly / monthly with comparison periods; a cover page. — [FreeAgent blog](https://www.freeagent.com/blog/management-reports-have-arrived/)
  - **Updates and other reports:** — [FreeAgent timeline](https://www.freeagent.com/timeline)
    - report selection and spreadsheet export (Sep 2025)
    - notes per report (Dec 2025)
    - **Tracking Groups** (Sep 2026)
    - a Show Transactions report with a VAT-rate column (Sep 2026)
  - A 2026 review says there is no custom reporting. — [ANNA review](https://anna.money/blog/guides/freeagent-accounting-software-review/)

### Inferences
- **Reusable report spec:**
  - date range + "Compare with N previous periods"
  - cash/accrual basis toggle
  - filters by account, contact and tag
  - a column chooser
  - a **density switch** (Zoho's three levels)
  - formula rows
  - saved views
  - "drafts excluded" as an explicit rule
- **Dimensions.** Avoid Xero's 2-dimension cap. A flexible tag model (Zoho reporting tags, FreeAgent Tracking Groups) better suits personal and small-business mixed use.

### Gaps
- Drill-down from a report line to transactions was not explicitly confirmed for any product, though it is widely assumed.
- Not verified: QBO "modern view" reports and Advanced's custom report builder; trial balance and GL layouts for any product.

---

## 11. Period close (lock dates, closing date/password, year-end, adjusting entries, accountant workflows)

### Takeaway
- **Zoho Books** has the most granular model:
  - per-module locks (Sales, Purchases, Banking, Accounts), each with a mandatory reason;
  - partial unlock for a date range.
- **Xero** has two lock dates: one for everyone except advisers, one for all users.
- **QBO** has one closing date with an optional password and an "Exceptions to Closing Date" report.
- **FreeAgent** locks automatically after a tax filing or signed accounts.
- **Sage** has a "Year End Lockdown" date.

### Cited Findings
- **QBO:**
  - Settings → Account and settings → **Advanced** → Accounting → **Closing date** and closing password. Admins only.
  - Changes after close appear in the **Exceptions to Closing Date** report. — [QBO help: edit closed books](https://quickbooks.intuit.com/learn-support/en-us/help-article/customer-company-settings/edit-closed-books/L76xHuaZ5_US_en_US); [QBO help (search summary)](https://quickbooks.intuit.com/learn-support/en-us/customer-company-settings/change-the-closing-date-password/00/186067)
- **Xero:**
  - **Settings:** Settings → General Settings → Financial Settings → **Lock Dates**, with two dates: "all users except advisers" and "all users". After the lock, transactions dated earlier can't be added or edited.
  - **Example:** lock non-advisers at year end and lock advisers a month earlier so the accountant can still post year-end journals. — [Chargebee docs (search summary)](https://www.chargebee.com/docs/1.0/integrations/articles-and-faq/understanding-lock-dates-in-xero.html); [Wise-Sync (search summary)](https://cw.wise-sync.com/support/solutions/articles/36000041312-faq-setting-and-working-with-lock-dates-in-xero)
  - **Open user requests:** an automatic monthly lock date [Product Ideas](https://productideas.xero.com/forums/967136-banking-chart-of-accounts/suggestions/49770101-lock-dates-option-for-an-auto-lock-date-every-mo); separate lock dates for sales tax and the accounting period [Product Ideas](https://productideas.xero.com/forums/967136-banking-chart-of-accounts/suggestions/49408478-lock-date-separate-lock-dates-for-sales-tax-and); a confirmation when editing before lock dates [Product Ideas](https://productideas.xero.com/forums/967121-users-setup/suggestions/48739364-confirmation-when-editing-transaction-before-lock).
  - **XeroForce month-end agent:** a template that handles reconciliation review and manual entries. Early access, with GA later in 2026. — [Xero Xerocon US release](https://www.xero.com/media-releases/new-ai-innovations-xerocon-denver/)
  - **Xero Partner Hub:** shows "live book health, work status, and month-end readiness". — [Xero Xerocon London release](https://www.xero.com/us/media-releases/xero-announces-new-ai-innovations-xerocon-london/)
- **Zoho Books:**
  - Accountant → **Transaction Locking**. The modules **Sales, Purchases, Banking, Accounts** each get a Lock Date and a **required Reason**, or **Lock All Transactions**.
  - **Unlock Completely**, or **Unlock Partially** (a date range plus a reason, which can be disabled again).
  - A setting "Restrict transaction locking with negative stock". — [Zoho transaction lock](https://zstatic.zohostatic.com/books/help/accountant/transaction-lock.md)
- **Sage Accounting:**
  - Settings → Business settings → Financial settings → Accounting dates & VAT: change the **Year End Date**, and set **"Year End Lockdown"** to block back-dated entries.
  - To post missed entries, remove the lockdown date. — [Sage KB](https://gb-kb.sage.com/portal/app/portlets/results/view2.jsp?k2dockey=222001000101111)
- **FreeAgent:**
  - **Automatic locks** after a Self Assessment return is filed or marked filed, or after a company's year-end accounts are approved and signed.
  - **Manual locks** need full (level 8) access, and the latest allowed lock date is one week ago. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/115001222324)
  - Automatic locks lift only by un-filing or removing the signature. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/360021404099)
  - Find & Fix cannot touch locked periods. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/24572810244242)

### Inferences
- **Single-user mapping.** "Adviser vs everyone" becomes **"agent vs human"**: lock the period against the AI agent earlier than against the human, as in Xero's two-date model.
- **Lock records.** Require a reason on every lock and unlock (Zoho), allow time-boxed partial unlocks, and keep an "exceptions after close" report (QBO).
- **Event-driven locks.** Auto-lock on filing events (FreeAgent) is a good default once VAT or tax returns are produced.

### Gaps
- Not verified: QBO's warning-only vs password-required closing options; Xero's year-end close steps; whether Sage's lockdown is year-only or any date.

---

## 12. Audit trail, history and notes on records

### Takeaway
- **QBO** has the strongest global audit log: filter by user, date and event, with per-transaction history, kept 2 years.
- **Xero** puts "History & Notes" on each record but (per users) shows *that* a record was edited, not *what* changed.
- **FreeAgent's** Bulk Edit History records explicit from→to values.

### Cited Findings
- **QBO:**
  - **Audit log:** Settings → **Audit log**. Filter by User, Date or Events; 150 records per page; **View** in the History column opens a per-transaction audit history (for certain types); events kept **2 years**; admin access. — [QBO help: audit log (search summary)](https://quickbooks.intuit.com/learn-support/en-us/help-article/audit-log/use-audit-log-quickbooks-online/L2WoVnW6I_US_en_US)
  - **Comments** on bank lines feed a Request List. — [Porte Brown](https://blog.portebrown.com/quickbooks-onlines-new-bank-feed-what-to-expect-in-october-2025)
  - **Ready to post** keeps a per-transaction **Policy reviews** log (see §13). — [QBO help: Ready to post](https://quickbooks.intuit.com/learn-support/en-ca/help-article/account-management/use-ready-post-quickbooks-online/L9jzjf8Xe_CA_en_CA)
- **Xero:**
  - **History & Notes** covers invoices, bills, transactions, items and contacts, with user notes. An API endpoint can read notes and history and add notes. — [Databuzz (search summary)](https://databuzz.com.au/fmaccounting-link-xero-edition-update-notes-history-and-attachments)
  - Users complain that history "only shows when a user edited a transaction, but not what they edited". — [Xero Product Ideas (search summary)](https://productideas.xero.com/forums/939198/suggestions/44960347?page=3)
  - **Discuss tab** notes live on unreconciled lines. — [Fit Small Business](https://fitsmallbusiness.com/connect-and-reconcile-bank-account-xero/)
  - After a Remove & Redo, the fix must be documented by hand in History & Notes. — [SaasAnt](https://www.saasant.com/blog/xero-unreconcile-remove-redo/)
- **Zoho Books:**
  - An **Activity Logs** report. — [Zoho reports help](https://www.zoho.com/books/help/reports/)
  - Mandatory reasons on locks and partial unlocks. — [Zoho transaction lock](https://zstatic.zohostatic.com/books/help/accountant/transaction-lock.md)
  - Mandatory notes on currency adjustments. — [Zoho currency adjustments](https://www.zoho.com/books/help/accountant/base-currency.html)
- **FreeAgent:** **Bulk Edit History** keeps "a clear record of what's been changed (from/to states included)". — [FreeAgent blog](https://www.freeagent.com/blog/introducing-find-and-fix/)
- **Sage Accounting:** no source retrieved.

### Inferences
- **Field-level history.** For an agent-operated ledger, store from→to values per field with an actor (`user` / `agent` / `rule` / `import`) and a reason. This fixes Xero's best-known audit complaint, and the QBO log plus the FreeAgent bulk-edit log show how to present it.
- **Notes.** Notes on every record (Xero History & Notes, QBO comments) double as the channel through which the agent asks the human a question, as in Xero's "Discuss" tab and QBO's Request list.

### Gaps
- Not verified: the Sage Accounting audit trail, Zoho's per-record Comments & History panel, and per-record edit history in FreeAgent.

---

## 13. AI features as of 2025-2026 (Intuit Assist / QuickBooks agents, Xero JAX, Zoho Zia, Sage Copilot, FreeAgent)

### Takeaway
- **QBO:** the most mature *review UX* for AI work. "Ready to post" groups high-confidence lines. **Three-level confidence icons** (green check / blue info / orange alert) back each suggestion. A user-editable **"Transaction posting policy"** sets the thresholds, and a per-transaction **"Policy reviews"** log shows exactly which checks passed or held.
- **Xero JAX:** the most autonomous. It auto-reconciles high-confidence lines, labels each with its method (Rule / Match / Memory / Prediction), and offers a Reconciled page plus a per-account kill switch.
- **Zoho Zia:** leans conversational. Its CoCreate agent fills forms visibly, with "Take Control" / "Resume Autofill".
- **Sage Copilot:** routes AI output into drafts-to-approve.
- **FreeAgent:** keeps a quiet, long-running ML "Guess", marked orange and routed to For Approval.

### Cited Findings
**QuickBooks Online (Intuit Assist and agents)**
- **Agent line-up (announced 1 July 2025):** — [Intuit press release, 1 Jul 2025](https://investors.intuit.com/_assets/_08ee5483ec4c057568cc8774f3fd6aad/intuit/news/2025-07-01_Intuit_Introduces_Ground_Breaking_Virtual_Team_of__1258.pdf)
  - **Payments Agent:** predicts late payments, tracks invoices, creates and sends invoices and reminders.
  - **Accounting Agent:** "automates bookkeeping and transaction categorization, and assists in reconciliation".
  - **Finance Agent:** reporting, KPIs, scenario planning, forecasting, peer benchmarking.
  - **Customer Agent:** in Customer Hub. Sources leads, drafts email replies, schedules meetings.
  - **Marketing Agent:** via Mailchimp, "later this year".
  - **Payroll Agent:** "runs payroll when you say so".
  - **Project Management Agent:** quotes, milestones, budgets.
  - The release states "the customer is always in control". Its footnote says 45% of surveyed users of the AI-powered bank feed save 12 hours a month.
- **Plan availability:** Advanced includes the Accounting, Payments, Customer and PM agents. As of Sept 2025 most agents were on Essentials / Plus / Premium. — [Resident / Insightful Accountant (search summary)](https://resident.com/amp/story/business-and-finance/2025/09/26/beyond-bookkeeping-how-intuits-virtual-ai-team-redefines-growth-for-entrepreneurs)
- **Ready to post (Accounting AI; Essentials and up, not EasyStart):** — [QBO help: Ready to post](https://quickbooks.intuit.com/learn-support/en-ca/help-article/account-management/use-ready-post-quickbooks-online/L9jzjf8Xe_CA_en_CA)
  - **Where it appears:** a **banner** on Pending, or a **"Ready to post" filter**.
  - **Review flow:** select **Review**, and all ready lines are auto-selected. Review category, payee and amount; edit inline or expand; untick to defer; **Post** in a batch, or post a single line from the Action column.
  - **Qualifying criterion:** "The evidence supports a single, clear category and a payee or customer if your books usually include one."
  - **Confidence icons:**
    - **Green checkmark:** strong historical support.
    - **Blue info:** some variation among similar past transactions.
    - **Orange alert:** limited data; review carefully.
  - **Transaction posting policy** (Account and settings → Accounting):
    - Required fields From/To, Class and Location, each set to "Based on categorization history" / "Always required" / "Never required". Category is always required.
    - An **Amount threshold**, above which nothing auto-qualifies.
    - An **Effective date**, limiting which history is used.
    - Free-text **"Transaction posting notes"** describing company-specific preferences.
  - **Policy reviews tab** on each transaction: the check log, grouped as "Held for review" (failed checks) and "Ready to post" (passed), with reasons.
- **Suggestion display:**
  - A sparkle icon reads "Suggested by AI". — [QBO help: AI banking page](https://quickbooks.intuit.com/learn-support/en-global/help-article/matching-rules/learn-updates-new-ai-powered-banking-page/L0hR7A9Zf_ROW_en)
  - Suggestions list the past transactions found similar. — [QBO help: Ready to post (search summary)](https://quickbooks.intuit.com/learn-support/en-ca/help-article/account-management/use-ready-post-quickbooks-online/L9jzjf8Xe_CA_en_CA)
  - Supplier and category suggestions appear "even when bank descriptions are unclear". — [Insightful Accountant](https://blog.insightfulaccountant.com/intuit-bank-feeds-experience-transitions-may-8-2026)
- **(Nov 2024) Intuit Assist** was released as a generative-AI assistant for US QBO, with "done-for-you" experiences such as auto-matching Payments and Bill Pay transactions. — [CPA Practice Advisor (search summary)](https://www.cpapracticeadvisor.com/2024/11/20/quickbooks-adds-gen-ai-financial-assistant-to-power-business-growth/152256/)

**Xero (JAX)**
- **Auto bank reconciliation:** — [CFOtech](https://cfotech.com.au/story/xero-rolls-out-ai-bank-reconciliation-with-jax-tool); [Xero reconcile page](https://www.xero.com/us/accounting-software/reconcile-bank-transactions/)
  - only "when it's highly confident"
  - labels Rule / Match / Memory / Prediction / Manual
  - a Reconciled page where every line can be reviewed, edited or undone
  - a per-bank-account on/off toggle
  - learns from corrections
- **Other JAX capabilities:** — [Xero Xerocon London release](https://www.xero.com/us/media-releases/xero-announces-new-ai-innovations-xerocon-london/); [Xero Xerocon US release](https://www.xero.com/media-releases/new-ai-innovations-xerocon-denver/); [IT Brief](https://itbrief.co.uk/story/xero-adds-ai-tools-to-jax-for-small-business-finance)
  - Smart Document Capture
  - **Book Health & anomaly detection:** flags unreconciled items, duplicates, missing documents and anomalies, with real-time updates as they are fixed
  - Document Requests ("customers approve each step")
  - Bill Protection
  - Cash Flow Actions
  - payment follow-ups
  - planned: bank-statement extraction, VAT checking, complex split payments
- **Accuracy control.** A **"JAX Assure control system"** is meant to reduce hallucinations, and a collaboration with OpenAI covers web research. 73% of Xero customers had used AI in the platform since March 2025. — [CPA Practice Advisor, Oct 2025](https://www.cpapracticeadvisor.com/2025/10/07/xero-adds-new-features-to-ai-financial-superagent-jax/170382/)
- **XeroForce:** a natural-language custom agent builder with templates, including a month-end agent. Early access; GA later in 2026. — [Xero Xerocon US release](https://www.xero.com/media-releases/new-ai-innovations-xerocon-denver/)
- **External integrations:** Claude, Microsoft 365 Copilot and ChatGPT. Xero MCP Server usage rose 10x from Dec 2025 to May 2026. — same source

**Zoho Books (Zia)**
- **Enabling:** Settings → **AI Preferences**, choosing an **AI provider and model**. — [Zoho AI features](https://www.zoho.com/us/books/help/ai-features/ai-features.html)
- **Features:** — same source
  - **Ask Zia:** a right-sidebar chat that creates items and transactions and answers data questions; it asks follow-ups when details are missing; with a speech mic.
  - **CoCreate Agent:** + New → CoCreate Agent fills quotes, sales orders, invoices and credit notes from natural language **visibly on screen**. The user can **"Take Control"** and then **"Resume Autofill"**.
  - **AI-suggested bank categorization (Early Access):** pre-fills Category, Customer/Vendor and Account from history; editable before save.
  - **Zia Invoice Agent:** cards with action buttons.
  - **Report AI:** Zia Insights, Forecast and Anomaly on reports.
  - **"Generate With Zia":** for email templates, with tone controls and Insert.
  - **Blueprint generation.**
- No confidence display is documented for any feature. — same source

**Sage Accounting (Copilot)**
- **Availability:** from April 2026, Copilot is "available at no extra charge for all users". — [Sage product updates (search summary)](https://www.sage.com/en-gb/sage-business-cloud/sage-accounting/product-updates/) It was first planned as a paid add-on from March 2025 (older, superseded). — [Sage Community](https://communityhub.sage.com/gb/sage-accounting-and-individual/f/sage-accounting-general-discussion/241366/clarification-on-pricing-updates/580989)
- **Claims:** — [Sage product tour](https://assets.sage.com/product-tour/dist/sbca/en-GB/index.html)
  - automatic invoice chasing ("paid 7 days faster")
  - automated data entry ("5 hours/week")
  - VAT deadline alerts and error checks
  - AI-drafted bulk invoices and quotes "for review"
- **Review pattern:** AI output lands in the **"Draft to approve"** queue. — [Sage KB](https://gb-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=222001000101064)
- **[Intacct] Sage's agent announcements** target Intacct, not Sage Accounting: Close, AP, Time and Assurance agents, plus the Finance Intelligence Agent (4 Nov 2025). The Assurance agent "catches errors at entry, stopping mistakes before they post". — [Sage newsroom](https://www.sage.com/en-gb/company/digital-newsroom/2025/11/sage-announces-finance-intelligence-agent-to-power-high-performance-finance-teams/)
- **Accountant assistant.** Sage announced a free AI assistant for every accountant in May 2025. — [Sage newsroom](https://www.sage.com/en-gb/company/digital-newsroom/2025/05/14/sage-gives-every-accountant-a-free-ai-assistant/)

**FreeAgent**
- **Guess.** ML auto-explanation since 2020 that "gets smarter over time as it learns from you". Review happens through orange text, an eye icon, the For Approval tab and bulk approve. — [FreeAgent banking](https://www.freeagent.com/features/banking/); [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/115001586004)
- **Approach.** FreeAgent's AI stance is that "trained professionals need to remain accountable for the results". — [FreeAgent blog](https://www.freeagent.com/blog/how-freeagent-uses-ai/)
- **Other AI-adjacent features:** Smart Capture with an AI category suggestion, the VAT Checker, the Jenesys "Jack" agent partnership, and rental-statement extraction for landlords (June 2026). — [FreeAgent blog](https://www.freeagent.com/blog/smart-capture-for-bills/); [Accountancy Age](https://accountancyage.com/2025/05/14/freeagent-launches-new-features-and-ai-partnership-at-accountex-2025/); [FreeAgent timeline](https://www.freeagent.com/timeline)
- **No chat assistant found.** No LLM chat assistant was found for FreeAgent as of Oct 2026 (FreeAgent subagent; absence of evidence).

### Inferences
- **Patterns to adopt for an agent operating a local ledger:**
  1. **A user-editable "posting policy"** (QBO): required fields, an amount ceiling, history window, free-text house rules the agent reads. This is the natural configuration surface for an AI bookkeeper.
  2. **A per-item check log** ("Policy reviews": passed vs held, with reasons) as the explanation UI.
  3. **Three-tier confidence icons**, not raw percentages.
  4. **Method/provenance labels** (Xero's Rule / Match / Memory / Prediction / Manual).
  5. **A batch approve view** of only the high-confidence items, pre-selected, with untick-to-defer.
  6. **Visible form-filling** with "Take Control / Resume" (Zoho CoCreate) for agent-created documents.
  7. **Drafts, never posted, for anything created from documents** (Sage, Xero, FreeAgent).
  8. **A per-account automation kill switch** and a **Reconciled-by-agent page** with undo.
  9. **A feed** summarising what agents did (QBO business feed).
- **Explanation over scores.** None of the incumbents show numeric confidence scores. All prefer icons or categories plus "similar past transactions" as evidence.

### Gaps
- Not verified: how the QBO Payments Agent's AI-drafted reminders are reviewed before sending; whether JAX invoice creation via WhatsApp/SMS requires confirmation.
- No confidence UI found for Zia or Sage Copilot.

---

## 14. Design language (density, colour, typography, money columns, negatives, chips, empty states)

### Takeaway
Primary sources say little about visual specifics. What is documented:
- **Density is a live tension.** Xero offers enlarged vs compact views; Zoho offers Classic / Compact / Super Compact report density; QBO's 2025 banking table drew readability complaints.
- **Status and AI provenance are colour-coded:** QBO green/blue/orange confidence icons and a sparkle for AI; FreeAgent orange text and eye icon; Xero light-green suggested match; Sage colour-coded invoice status.
- **Brand systems:** FreeAgent moved to the **Circular** typeface (2023), and Sage builds on its **"Carbon by Sage"** React component library.

### Cited Findings
- **QBO:**
  - Confidence icons are a green checkmark, blue info and orange alert. — [QBO help: Ready to post](https://quickbooks.intuit.com/learn-support/en-ca/help-article/account-management/use-ready-post-quickbooks-online/L9jzjf8Xe_CA_en_CA)
  - A sparkle icon marks "Suggested by AI". **RULE** and **Pair** badges mark rule hits and transfers. Columns are configurable via the gear. — [QBO help: AI banking page](https://quickbooks.intuit.com/learn-support/en-global/help-article/matching-rules/learn-updates-new-ai-powered-banking-page/L0hR7A9Zf_ROW_en)
  - Hovering reveals full bank text, and editing is inline with no pop-ups. — [Porte Brown](https://blog.portebrown.com/quickbooks-onlines-new-bank-feed-what-to-expect-in-october-2025)
- **Xero:**
  - The 2021 reconcile redesign changed "white space and font size" for WCAG and aimed at consistency across features. An optional condensed view was being scoped (older). — [Xero blog](https://blog.xero.com/product-updates/why-weve-updated-the-bank-reconciliation-design/)
  - Users toggle between "enlarged, zoomed-in view, or a compact view that displays more transactions on screen" (older). — [Xero blog](https://blog.xero.com/product-updates/new-look-bank-reconciliation/)
  - Suggested matches are highlighted in light green. — [Fit Small Business](https://fitsmallbusiness.com/connect-and-reconcile-bank-account-xero/)
  - The home page uses drag-and-drop widgets with show/hide. — [Xero new homepage](https://www.xero.com/uk/campaign/new-homepage-navigation/)
- **Zoho Books:**
  - Report table density comes in Classic / Compact / Super Compact. — [Zoho custom reports](https://www.zoho.com/books/help/reports/custom-reports.md)
  - A "Match found" tag marks bank matches. — [Zoho matching](https://zstatic.zohostatic.com/books/help/banking/matching-transactions.md)
  - A negative sign denotes an FX loss in "Gain or Loss (BCY)". — [Zoho currency adjustments](https://www.zoho.com/books/help/accountant/base-currency.html)
- **Sage Accounting:**
  - Invoice status is colour-coded. — [Sage product updates (search summary)](https://www.sage.com/en-gb/sage-business-cloud/sage-accounting/product-updates/)
  - The design system uses tokens built with Style Dictionary and the React library **"Carbon by Sage"** (not IBM Carbon). — [Sage GitHub (search summary)](https://github.com/Sage)
- **FreeAgent:**
  - **April 2023 "new look":** typeface changed from Source Sans Pro to **Circular**; "you'll still see blue, but we'll also be introducing new accent colours and gradients"; a simpler logo; "no changes to the product itself". — [FreeAgent blog](https://www.freeagent.com/blog/new-look-for-freeagent/)
  - Dark mode exists on mobile only (Apr 2023). — [FreeAgent timeline](https://www.freeagent.com/timeline)
  - Orange marks machine-guessed rows. — [FreeAgent support (search summary)](https://support.freeagent.com/hc/en-gb/articles/115001586004)
  - The tone is informal and British ("mission control for your small business", "avoid any nasty surprises"). — [FreeAgent dashboard](https://www.freeagent.com/features/dashboard/)

### Inferences
- **A small, consistent semantic palette** works best:
  - one hue reserved for "machine-made / needs approval" (FreeAgent orange; QBO sparkle)
  - green / neutral / amber for confidence
  - light-green or accent highlight for a suggested match
  - status chips for document lifecycle
- **Ship a density toggle.** Bookkeepers working long lists want compact; owners and accessibility want enlarged.

### Gaps
- No primary source found for:
  - right-aligned money columns or tabular figures;
  - negative-number style (minus vs parentheses vs red) or debit/credit column presentation;
  - exact brand hex values, typefaces in-app (QBO, Xero, Zoho, Sage) or status chip colours;
  - empty-state designs.
- These were not retrievable with the available tools (PCMag and Capterra blocked; search budget exhausted).

---

## 15. What users praise and complain about (UX themes)

### Takeaway
- **Praise:** clean dashboards, fast reconciliation via feeds and rules, and ease of learning. Xero, Zoho and FreeAgent are praised for simplicity.
- **Complaints:**
  - forced UI migrations: the QBO 2025 banking page and invoice layout, Xero's classic-invoicing shutdown;
  - readability and density regressions;
  - unreliable bank feeds;
  - shallow reporting and customisation (Xero, FreeAgent, Sage);
  - dimension limits (Xero tracking);
  - audit history that doesn't show what changed (Xero);
  - slow performance and "too many clicks" (Sage, Zoho).

### Cited Findings
- **QBO:**
  - **July 2025 complaints about the new banking page:** "ugly, horrible to navigate, harder to read, and makes everyone's lives more difficult" (a user claiming 300+ clients); "adds more resistance to my workflow"; slowness and bugs; anger at forced migration, since reverting required a survey.
  - **Intuit's response:** a revert option via Gear > Switch until September 2025. — [QB Community thread](https://quickbooks.intuit.com/community/banking-4/new-banking-page-not-good-24079)
  - **Feed reliability:** feeds break when banks change MFA or API connections and need re-authentication. — [search summary of QB Community threads](https://quickbooks.intuit.com/learn-support/en-ca/banking-currency/re-what-is-wrong-with-qbo/01/1547929/highlight/true)
  - **New invoice layout:** threads complain about it and ask to revert. — [QB Community](https://quickbooks.intuit.com/community/other-questions-72/why-did-you-change-my-invoicing-format-144869)
- **Xero:**
  - **Praise (Capterra):** "UI design is simple and clean"; a dashboard with a "real-time view of cash flow, bank balances, and outstanding invoices".
  - **Cons (Capterra):** email-only support; limited for "detailed reporting or advanced customizations"; "a longer click path and more fields". — [Capterra (search summary)](https://capterra.com/p/120109/Xero/reviews/)
  - **Limits and requests:** the tracking-category cap is a recurring frustration. — [FieldProMax (search summary)](https://www.fieldpromax.com/blog/xero-tracking-categories-for-job-costing-setup-and-limits) Users want typeable dates in new invoicing [Product Ideas](https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/47706080-new-invoicing-typeable-dates-in-date-fields) and more keyboard shortcuts [Product Ideas](https://productideas.xero.com/forums/939198-for-small-businesses/suggestions/44960281-navigation-more-keyboard-shortcuts-in-xero).
- **Zoho Books:**
  - **Praise:** clean layout, straightforward navigation, "extremely easy to use without needing training", value, and the Zoho ecosystem. About 4.4/5 from ~671 reviews (site not named in the summary).
  - **Complaints:** lag on high-volume entries and imports; broken feeds and missing transactions; an interface "not always clear, requiring users to dig", which can "feel dated"; slow support; tier-gated features. — [Capterra (search summary)](https://capterra.com/p/163115/Zoho-Books/reviews/); [PeerSpot (search summary)](https://www.peerspot.com/products/zoho-books-pros-and-cons); [Software Advice (search summary)](https://www.softwareadvice.com/accounting/zoho-books-profile)
- **Sage Accounting:**
  - **Praise:** user-friendly, easy navigation, Excel export, reliable invoicing, feed-assisted reconciliation.
  - **Complaints (Capterra):** beginners find navigation confusing; performance; learning curve; limited customisation; multi-user cost; inconsistent support. — [Capterra (search summary)](https://capterra.com/p/168740/Sage-One-UK/reviews/)
  - **Complaints (TrustRadius / Software Advice):** "slow loading compared with Xero"; feeds once a day with the previous day's data; "outdated", "too many clicks"; an extra reconcile step that "feels like overkill". These sets may include Sage 50 reviews. — [TrustRadius (search summary)](https://www.trustradius.com/products/sage-accounting/reviews); [Software Advice (search summary)](https://www.softwareadvice.com/accounting/sage-business-cloud-accounting-profile/reviews/)
- **FreeAgent:**
  - **Praise:** easy navigation, low learning curve, well-organised dashboard, "learns the more you use it". — [Capterra (search summary)](https://www.capterra.com/p/122008/FreeAgent/reviews/?page=2) Also "excellent bank reconciliation" and "excellent" MTD VAT. — [UK Business Forums](https://www.ukbusinessforums.co.uk/threads/freeagent-opinion.424006/)
  - **Complaints:** not always intuitive; slow on complex data; basic reports; missing neobank feeds (e.g., Wise). — [Capterra (search summary)](https://www.capterra.com/p/122008/FreeAgent/reviews/?page=5) Also "fairly basic" templates, no custom reporting, and "fairly surface-level" dashboards. — [ANNA review 2026](https://anna.money/blog/guides/freeagent-accounting-software-review/)
  - **Price:** "costly when not banking with NatWest". It is free with NatWest, RBS, Ulster and Mettle. — [UK Business Forums](https://www.ukbusinessforums.co.uk/threads/freeagent-opinion.424006/); [ANNA review](https://anna.money/blog/guides/freeagent-accounting-software-review/)

### Inferences
- **Design lessons:**
  - Never take away a dense, fast view in favour of a "cleaner" one. QBO's backlash was about readability and workflow resistance, not features.
  - Keep keyboard-first entry (typeable dates, shortcuts).
  - Show *what* changed in history.
  - Don't cap analysis dimensions at two.
- **Local single-user advantages.** A local app sidesteps the most-cited operational complaints (feed reliability, support, multi-user pricing) but must make file or CSV import painless, since QIF/CSV upload is the fallback even in FreeAgent and QBO.

### Gaps
- No Reddit (r/Bookkeeping, r/QuickBooks) threads were retrieved; the session search budget ran out.
- No G2, PCMag, Forbes Advisor or NerdWallet review text was retrievable; PCMag was blocked.
- Several sentiment summaries come from search snippets that blend Capterra, PeerSpot and Software Advice.
