# Personal-Finance & Spend-App UX Patterns (Monarch, Copilot, YNAB, Lunch Money, Simplifi, Rocket Money, Tiller, Mercury/Brex/Ramp), 2025-2026

Scope note: researched October 2026. Mint's 2024 shutdown is context only. Rivals courted Mint users with migration paths, e.g. YNAB's "Transitioning From Mint to YNAB" support page ([YNAB](https://support.ynab.com/en_us/transitioning-from-mint-HJJSQvW7a.md)) and Copilot's Mint data import ([tooldirectory.ai](https://tooldirectory.ai/tools/copilot-money)). Monarch's help center (help.monarch.com) and Mercury's support site (support.mercury.com) returned HTTP 403 to direct fetches. Facts attributed to those domains come from search-engine excerpts of the official pages, and are marked "(search excerpt)".

---

## 1. Transaction list design: columns, grouping, inline editing, splits, review flows, bulk edit, search/filter, keyboard shortcuts, notes/attachments, tags, merchant cleanup

### Takeaway
The best transaction lists treat review as a triage queue. Every new transaction starts "unreviewed" and carries a small, quiet indicator. The user can clear it with one key, a swipe, or a bulk action. Category can be edited in place without opening a detail view. A side panel or drawer holds the rarer actions: splits, notes, attachments, and merchant renames. Copilot (web) and Mercury/Ramp come closest to keyboard-first triage. Lunch Money is spreadsheet-like but documents few real key bindings.

### Cited Findings
**Copilot Money (web/Mac)**
- A "light-blue unreviewed transaction indicator" appears next to every transaction needing review, in all transaction list views. Unreviewed items can be resolved from any list and marked reviewed in bulk. — [Copilot help: Copilot Money for Web](https://help.copilot.money/en/articles/11780342-copilot-money-for-web)
- Documented web shortcuts: arrow keys move up/down the list; **X** selects a transaction; **R** marks it Reviewed; **C** changes the category; **⌘+A** selects all; **⌘+Shift+A** deselects all. — [Copilot help: Copilot Money for Web](https://help.copilot.money/en/articles/11780342-copilot-money-for-web)
- Users can "quick edit a transaction's category without opening the transaction" from list views. Bulk actions can change category, review status and transaction type. — [Copilot help](https://help.copilot.money/en/articles/11780342-copilot-money-for-web)
- Filters (combinable) cover Account, Category, Date, Recurring, Review Status, Tag and Type. The filtered view shows running "Total spent, Total income, and Net". Results can be sorted by date or amount, and the user can export all transactions or just the filtered subset. — [Copilot help](https://help.copilot.money/en/articles/11780342-copilot-money-for-web)
- New transactions surface in a "To Review" section on the Dashboard tab. — [search excerpt of Copilot help](https://help.copilot.money/en/articles/11157550-quick-start-guide)
- Recurring transactions get an "[R]" marker in lists. — [Copilot help: Create recurrings](https://help.copilot.money/en/articles/3760068-create-recurrings)

**Monarch Money**
- Review model: each transaction is either "needs review" or "reviewed". Status is set manually, in bulk, or automatically by if-then rules. Example rule uses: mark Amazon/Costco/Walmart purchases "needs review" so they get split, mark rule-processed items "already reviewed", flag transactions over an amount, or flag all transactions from rarely used accounts. A dashboard card lists items needing review on open, and email/push alerts are available. (Launched April 29, 2022.) — [Monarch blog: Transaction review](https://www.monarch.com/blog/transaction-review)
- Mobile "swipe to review" (Aug 13, 2024) shows each transaction as a card: "swipe right to review", "swipe left to skip". The entry point is a dashboard banner reading "let's review some transactions". The queue can be filtered by category, merchant or amount, and each card lets the user edit the category, tags, notes and splits. — [Monarch: Review on the go & Smart Split](https://www.monarch.com/review-on-the-go-and-smart-split)
- Merchant cleanup: users can upload custom logos for merchants and accounts ("edit merchant details"), merge duplicate merchant names in Merchant settings, and use rules to rename merchants. — [search excerpt of Monarch help: Tips & Tricks](https://help.monarch.com/hc/en-us/articles/28953573066260-Tips-Tricks-for-Using-Monarch)
- Receipt scanning (Dec 2025 Winter Release): Monarch "will scan the receipt, find a match, and split and recategorize as needed… add details to the notes section and attach an image of the receipt itself". Example: a $147.83 Costco charge split into groceries, household supplies and electronics. — [Monarch blog: Winter Release](https://www.monarch.com/blog/winter-release)
- A Chrome extension syncs, splits and categorizes Amazon (later Target) orders against card charges. — [Monarch blog: Target extension](https://www.monarch.com/blog/monarch-extension-for-target)
- A full transaction activity log arrived July 2026, and a mobile activity log in September 2026. — [Monarch What's New](https://www.monarch.com/whats-new)

**Lunch Money**
- Inline, spreadsheet-like editing: "Transaction details are updated from the Transactions page by clicking into any of the cells in the table view." A checkbox at the far left of each row adds it to the selection, and SHIFT selects a range. An arrow at the far right opens a Transaction Details side panel. — [Lunch Money: Transaction Actions](https://support.lunchmoney.app/finances/transactions/transaction-actions)
- Bulk actions: set Date, Payee, Category, Note or Currency; set all to uncategorized; remove all notes; move to account; add or remove tags; link or unlink recurring; mark reviewed/unreviewed. — [Lunch Money: Transaction Actions](https://support.lunchmoney.app/finances/transactions/transaction-actions)
- Status is binary reviewed/unreviewed. Synced transactions default to unreviewed and manual ones to reviewed. The row checkbox icon is gray when unreviewed and green when reviewed. A column-header checkmark marks every unreviewed item in the current view. A prompt on the right side appears when the active view contains unreviewed items. An optional setting auto-marks a transaction reviewed when its date, amount, category, payee, notes or account changes. Rules can set status and override these defaults. — [Lunch Money: Transaction Status](https://support.lunchmoney.app/finances/transactions/transaction-status)
- Keyboard: a company reply (Jan 12, 2021) lists support for tabbing between fields, reviewing transactions, navigating the table "like a spreadsheet", creating new transactions/recurring items, and closing side panels with Esc. Users still request single-key column shortcuts ("c" category, "n" notes), a VS Code-style command palette, Enter-to-confirm in modals, and shortcut tooltips. — [Lunch Money feedback: Keyboard shortcuts](https://feedback.lunchmoney.app/general-feature-request/p/keyboard-shortcuts)

**YNAB**
- Matched transactions show a match icon. Clicking it "reveals details on both matched transactions, and an Unmatch button". The pending-transaction clock icon sits in line with the cleared/uncleared icons. — [YNAB blog](https://www.ynab.com/blog/8-ways-your-budget-just-got-better)
- The web "Manage Payees" view was made "roomier and easier to scan". — [YNAB blog](https://www.ynab.com/blog/8-ways-your-budget-just-got-better)

**Mercury / Ramp / Brex (business spend)**
- The Mercury Transactions page filters by date, keywords, payment method, categories, GL codes, accounts, policies, receipts and cards. Users can add receipts and notes, select up to 100 transactions per page, and bulk-apply categories through "the action bar at the bottom of the screen". — [search excerpt of Mercury support: Accounting page](https://support.mercury.com/hc/en-us/articles/35624712696340-Navigating-the-Accounting-page); [search excerpt of Mercury support: Categorizing](https://support.mercury.com/hc/en-us/articles/46276513379348-Categorizing-transactions)
- Mercury (Aug 2025) added bulk editing of categories and GL codes. The same page cites "spreadsheet-style controls", "one-click Data Views", real-time cashflow graphs and interactive money-movement breakdowns. — [Mercury blog: August 2025 product updates](https://mercury.com/blog/august-2025-product-updates)
- Exports cover all transactions or the filtered subset, as .csv or .xlsx. — [search excerpt of Mercury support: Exporting](https://support.mercury.com/hc/en-us/articles/28768700685844-Exporting-transaction-data)
- Ramp's Accounting Agent review list has a "Suggested action" column with badges such as "Waiting for Cardholder", "Waiting for Approval" and "Mark ready". — [search excerpt of Ramp support: Accounting Agent admin guide](https://support.ramp.com/hc/en-us/articles/45051740591251-Ramp-Accounting-Agent-Enablement-Daily-Use-Admin-guide)
- Comparable keyboard model in Kick, a bookkeeping app (not one of the target apps, but the clearest documented example of this pattern): Enter or x selects, Esc clears bulk select, Shift+arrows multi-select, Cmd+arrows paginate. Single letters jump to fields: c category, v counterparty, g GL, e entity, m memo, l class, t task. ⌘K opens a command portal. — [Kick docs: Keyboard shortcuts](https://docs.kick.co/reference/keyboard-shortcuts)

### Inferences
- Common pattern: a binary review flag with a subtle accent dot (Copilot light-blue) or a check icon that turns from gray to green (Lunch Money). Then several ways to clear it: R key, swipe, bulk action, or a header "mark all". A non-blocking "you have N to review" prompt sits on the dashboard or the side of the list.
- The best inline-edit pattern: arrow keys move focus, X toggles selection, and a single letter opens a typeahead for one field (C = category in Copilot; c/v/g/m in Kick). A bottom floating action bar appears when rows are selected (Mercury). This fits a double-entry app well. "Category" maps to the offset account, and an agent can drive the same commands.
- The list should show live totals for the filtered set (spent/income/net, as in Copilot). In a ledger these become debit/credit sums and the net for the filter.
- Monarch's receipt flow is a good model for agent behavior: match, split, recategorize, put the parsed details in the notes, and attach the image. The agent's edits should be recorded in an activity log, which Monarch added in 2026.

### Gaps
- No official documentation found for Mercury's own keyboard shortcuts or a ⌘K palette. The Mercury "Command" feature is conversational (see Q7), and Mercury support pages could not be fetched.
- Lunch Money does not publish a list of specific key bindings. Only general capabilities are documented.
- No official source found for the exact column sets (e.g., whether Monarch shows the account column by default) or for day-grouping headers. These are visible in screenshots, but no text source was found.

---

## 2. Rules: creation from an edit, rule editors, retroactive application

### Takeaway
Leading apps offer a rule at the moment of correction. Monarch shows a rule widget after any change. Lunch Money auto-suggests a "match exactly" rule when a category or payee changes. Both offer to apply the rule to past transactions: Monarch with an "Apply # changes to existing transactions" checkbox, Lunch Money with "Create & Apply", which lets the user deselect specific matches. Copilot's alternative is "no rules, just a per-user model that learns from reviews". Ramp lets users correct the agent in natural language.

### Cited Findings
- Monarch: "A rule widget appears automatically when you make any changes to a transaction anywhere in Monarch". If existing transactions match, a checkbox "Apply # changes to existing transactions" applies the rule retroactively. Criteria include merchant name, amount and more. Actions can rename the merchant, update the category, add tags, or hide the transaction. Rules live in Settings > Rules. — [search excerpt of Monarch help: Creating Transaction Rules](https://help.monarch.com/hc/en-us/articles/360048393372)
- Monarch rules can set review status ("needs review"/"reviewed"). — [Monarch blog: Transaction review](https://www.monarch.com/blog/transaction-review)
- Monarch Smart Split (Aug 2024): rules match on merchant, amount, account or category and split by exact dollar amounts or by percentages. They can apply to existing or new transactions and can be created on mobile or desktop. — [Monarch: Smart Split](https://www.monarch.com/review-on-the-go-and-smart-split)
- Lunch Money rules can be created five ways: automatically when the category changes (a "match exactly" rule, can be disabled), automatically on payee rename, from a transaction edit, as system rules when a recurring expense is created, or manually with "Add a New Rule". — [Lunch Money: Rules](https://support.lunchmoney.app/setup/rules.md)
- Lunch Money conditions: payee and notes ("contains" / "starts with" / "matches exactly"), category, amount (expense/income type, with between, >, >=, <, <=, =), day-of-month range ("supports date wrapping"), and account. Actions: set payee, notes or category; set uncategorized; add tags; link recurring or disable recurring suggestions; split; mark reviewed/unreviewed; send an email notification; delete. Splitting and updating the original transaction's properties "are mutually exclusive". — [Lunch Money: Rules](https://support.lunchmoney.app/setup/rules.md)
- Lunch Money retroactivity: "Create & Apply" runs a new rule over existing matches. A "Suggested Rules" view lists rules to approve, and "Save and Apply" shows which transactions will be affected, with options to deselect specific matches. "One-time rules" with "delete rule after use" handle cases like removing a manual placeholder once the real import arrives. A setting controls whether rules run on transaction updates. Rules do NOT run by default on transactions created through the API. — [Lunch Money: Rules](https://support.lunchmoney.app/setup/rules.md)
- Tiller AutoCat keeps rules on a dedicated AutoCat sheet in the user's spreadsheet. Example: description contains "Starbucks" and amount under $25 → Coffee, over $25 → Dining Out. Rules also clean up descriptions and apply notes and tags, and run when new transactions arrive daily. — [Tiller: AutoCat](https://tiller.com/features/autocat/); [Tiller: categorization automation](https://tiller.com/categorization-automation-workflows/)
- Copilot positions its per-user ML as "eliminating the need for manual rule creation", learning from each review/correction. — [search excerpt summarizing Copilot](https://tooldirectory.ai/tools/copilot-money); see Q7 for the official doc.
- Ramp Accounting Agent corrections are natural language, e.g. "Code Uber rides for the LA sales team to 'Client travel' going forward". The system learns from these corrections and explanations. — [Ramp blog: Accounting Agent launch](https://ramp.com/blog/accounting-agent-launch)
- The agent fills blank GL/department/class/location fields when confidence is high, but "does not override employee values, admin values, or rule values". — [search excerpt of Ramp support](https://support.ramp.com/hc/en-us/articles/45051740591251-Ramp-Accounting-Agent-Enablement-Daily-Use-Admin-guide)
- Simplifi users have asked for the ability to pick which past transactions a new rule applies to. This suggests Simplifi's retroactive application is all-or-nothing, or unclear. — [Simplifi community](https://community.simplifimoney.com/discussion/comment/33792/)

### Inferences
- Recommended flow: after the user (or agent) edits payee or category, show a non-modal toast or inline card: "Always categorize *Payee* as *Category*? [Create rule] [Create & apply to N past]". Include a preview list of the N matches with checkboxes, following Lunch Money's "Save and Apply" with deselection.
- Precedence matters when an AI agent writes too. Ramp's rule — AI never overrides user, admin, or rule values — is a good one to copy. Explicit rules should beat ML guesses.
- The rule editor should support a condition builder (payee contains/starts/equals, amount range, account, day-of-month) and an action list (set category/account, rename payee, tag, split by amount or %, mark reviewed, link recurring). For double-entry, "split by %" maps to multi-line postings.
- One-time rules are an elegant way to reconcile a manual placeholder entry against a later import.

### Gaps
- Could not fetch Monarch's full rules article (403), so rule-ordering/priority semantics and the exact widget design are unconfirmed.
- No source found on how Copilot handles an explicit "always" preference if the user wants one. The YNAB "Manage Payees" auto-categorization was only briefly described.

---

## 3. Recurring transactions/subscriptions detection and display; upcoming bills

### Takeaway
Recurring items are first-class objects, not just tags. A recurring schedule is matched by a payee/amount filter. The app shows "paid vs left to pay this month", future non-monthly items and archived items. Upcoming expected charges also appear on the dashboard and in budget bars (Copilot draws expected recurring spend as outlined bars). Rocket Money makes subscription discovery and cancellation its core value.

### Cited Findings
- The Copilot Recurrings tab groups items into "paid and left to pay recurrings for the current month, future recurrings that occur less frequently, and archived recurrings". It offers list and grid views (list only on Mac/iPad). Details show editable underlined filters "to ensure the recurring is still capturing the correct transaction", plus Key Metric and Last Account Used fields. — [Copilot help: Recurrings tab overview](https://help.copilot.money/en/articles/9778259-recurrings-tab-overview)
- Copilot recurring schedules can be weekly, bi-weekly, monthly or non-monthly. The user creates one by searching for the transaction by name. After saving, the next expected payment is noted and the transactions get an [R] mark. — [Copilot help: Create recurrings](https://help.copilot.money/en/articles/3760068-create-recurrings)
- The Copilot dashboard has an "Upcoming" section listing expected recurring charges. — [9to5Mac, June 2025](https://9to5mac.com/2025/06/26/copilot-money-is-the-budgeting-app-youve-been-looking-for/)
- In Copilot's Categories tab, "outlined bars represent anticipated recurring expenses". — [Copilot help: Categories tab](https://help.copilot.money/en/articles/9504513-categories-tab-overview)
- Copilot users have requested calendar views of upcoming bills, credit-card due dates and customizable recurring periods, which suggests these are not fully built. — [Copilot roadmap: credit card due dates](https://roadmap.copilot.money/feature-requests/p/credit-card-due-dates-and-statements); [Copilot roadmap: customizable periods](https://roadmap.copilot.money/feature-requests/p/customizable-recurring-periods)
- Lunch Money auto-detects recurring transactions "if there is a clear pattern" from sync or CSV and creates a *suggested* recurring item with those transactions linked. Rules can link to recurring items or disable suggestions. A transaction linked to a recurring item cannot then be split or grouped, so split or group it first, then link. — [search excerpt of Lunch Money: Creating recurring items / rules](https://support.lunchmoney.app/finances/recurring-items/creating-recurring-items)
- Simplifi's projected cash flow uses expected income and bills to show "your expected balance tomorrow, the day after that, and well into the future by projecting your balances day by day". On web it is a graph per account. On mobile, a row of upcoming transactions shows the projected balance under each upcoming amount. — [Quicken blog](https://www.quicken.com/blog/6-ways-Simplifi-helps-track-your-money/)
- Rocket Money "scans financial transactions and aggregates recurring payments into a single view". Premium includes a cancellation assistant: in-app cancellation requests for some services (e.g., Amazon Prime, Spotify) and step-by-step instructions for others, plus bill negotiation. — [search excerpts: Rocket Money reviews](https://www.thequalityedit.com/articles/rocket-money-review); [Clark](https://clark.com/save-money/rocket-money-review/amp/)
- Copilot is described as tracking subscriptions with pause/cancel/price-increase alerts. — [Subscrybe](https://subscrybe.com/copilot-shows-the-importance-of-ux-design-and-gamification/) (third-party; not confirmed in Copilot docs)
- Reviewers complain that Monarch's AI "misses true subscriptions that dedicated subscription trackers catch" and that its Recurring feature is "half-baked". — [checkthat.ai review aggregation](https://checkthat.ai/brands/monarch/reviews) (aggregator; treat as indicative)

### Inferences
- For a double-entry app: recurring items = scheduled templates (payee, amount ± tolerance, cadence, accounts). Show a monthly "Paid / Due / Overdue" split and a 30-90 day forward projection of account balances, as in Simplifi.
- Auto-detected recurrences should arrive as *suggestions* the user accepts (Lunch Money), not silent schedules. An agent can propose them with evidence: the last N matching transactions and the interval.
- Showing expected recurring spend inside budget bars (outlined segments) is a cheap, high-value visual (Copilot).

### Gaps
- No primary-source detail on Monarch's recurring/bills calendar UI (help center blocked).
- No official confirmation of Copilot price-increase alerts. No source for a true calendar grid view in any of these apps.

---

## 4. Budgets: envelope (YNAB), category budgets with rollover (Monarch, Copilot), flex budgeting; visual indicators

### Takeaway
Three models dominate:
- **YNAB:** zero-based envelope ("Ready to Assign", Targets, Auto-Assign).
- **Copilot/Monarch:** category budgets with rollover and pacing colors.
- **Monarch Flex and Simplifi:** a "flexible" bucket or "spending plan" that answers "how much can I safely spend".

The best indicators are pace-aware: color reflects projected end-of-month spend, not just the share already spent, and YNAB pairs each color with an icon.

### Cited Findings
**YNAB**
- Terminology: "To Be Budgeted" became "Ready to Assign", and Goals became "Targets". Auto-Assign "will consider any dollars you have ready to assign and develop a preview" based on upcoming bills, monthly expenses and targets. The Home tab is "the new command center". — [search excerpts of YNAB pages](https://www.ynab.com/whats-new/a-goal-youll-never-forget)
- Category detail has a clickable "Assign $x.xx to meet your target". — [search excerpt, YNAB](https://www.ynab.com/whats-new/a-goal-youll-never-forget)
- "Plan Reset" "pulls every available dollar back to Ready to Assign, so you can answer the question fresh, category by category". Progress bars got a new look matching mobile. — [YNAB blog](https://www.ynab.com/blog/8-ways-your-budget-just-got-better)
- Available-column colors: **Red** = cash overspending (must cover); **Yellow** = underfunded (credit overspending or not enough for an upcoming scheduled transaction/target); **Green** = positive and covers upcoming scheduled transactions; **Gray** = zero and not underfunded.
- Icons: credit card with "!" = credit overspending; calendar = not enough for a later-this-month scheduled transaction; pie chart = progress to target; green check = target met; "Zz" = target snoozed. — [YNAB: Colors and Icons in Your Plan](https://support.ynab.com/en_us/colors-and-icons-in-your-plan-HJQv_XHko.md)

**Copilot**
- Category bars are pace-aware: "If the bar… is green, this means you're on pace to stay within your budget… yellow to orange if you are on pace to go over budget based on your spend so far this month. Once you are over budget, this bar will turn red." Past months show only green/red. Outlined bars mark anticipated recurring spend. A "Rebalance Budgets" action is available. — [Copilot help: Categories tab](https://help.copilot.money/en/articles/9504513-categories-tab-overview)
- Dashboard "spending line": the "dotted line represents the ideal spending rate", the "solid line represents your spending rate", and a point at the end marks today's progress versus the ideal. "Free to Spend" at the top shows what can still be spent without going over. — [search excerpt of Copilot help: Dashboard tab](https://help.copilot.money/en/articles/6045480-dashboard-tab-overview)
- Rollover budgets carry unused amounts into the next month. Reviewers describe this as feeling "like a gift". — [Subscrybe](https://subscrybe.com/copilot-shows-the-importance-of-ux-design-and-gamification/)
- Budgeting is optional in Copilot. Without a budget, the Categories chart compares against last month's spending. — [Copilot help: Categories tab](https://help.copilot.money/en/articles/9504513-categories-tab-overview); [Copilot help: Optional budgeting](https://help.copilot.money/en/articles/6282850-optional-budgeting)

**Monarch**
- Flex Budgeting groups spending into fixed, flexible and non-monthly. It focuses the user on "how much flexible spending you have left each month", as opposed to traditional per-category budgets. Both styles support rollover, spending alerts and forecasts. Monarch also supports zero-based budgeting. — [Experian review](https://experian.com/blogs/ask-experian/monarch-money-review/); [Sacra](https://sacra.com/c/monarch-money/)
- Goals (Dec 2025 redesign) show "On track", "Ahead" or "At risk" statuses. Pay-down goals compare avalanche and snowball strategies. — [Monarch blog: Winter Release](https://www.monarch.com/blog/winter-release)

**Simplifi**
- The Spending Plan subtracts bills, scheduled transfers and savings goals from projected income to show what's "safe to spend" for the rest of the month, including a per-day amount. — [Money Crashers](https://www.moneycrashers.com/simplifi-quicken-review/); [Quicken Simplifi](https://www.quicken.com/products/simplifi/)

### Inferences
- For bookkeeping, envelope semantics can be modeled as sub-accounts of equity or cash. The visual lesson carries over regardless of method:
  - pace-aware colors (green → yellow/orange → red), with icons so color is not the only signal (YNAB);
  - outlined or hatched segments for committed-but-unpaid amounts;
  - a single headline number ("Ready to Assign", "Free to Spend", "Safe to spend").
- Preview-before-commit (YNAB Auto-Assign preview) is a strong pattern for any agent-driven allocation: show the proposed assignments, then the user confirms.
- Red striping for overspending (per YNAB search excerpts) is a good non-color cue.

### Gaps
- Monarch's budget-screen visuals (bar styles, rollover display) could not be confirmed from primary docs (help center 403).
- The "red striped" detail for YNAB came from a search excerpt, not the fetched doc.

---

## 5. Dashboards & reports: cash flow, Sankey, net worth, investments, category trends, MoM comparisons; chart styling

### Takeaway
Monarch is the reporting leader: a configurable Reports page with bar, donut, Sankey, treemap and line charts, saved reports with relative date ranges, and share-with-amounts-hidden. Copilot's dashboard leads with one pacing chart (the spending line) and a "Free to Spend" number. Simplifi leads with projected balances. Net worth over time and investment benchmarking are standard.

### Cited Findings
- Monarch Sankey (Sept 29, 2023) shows "where your money comes from and where it goes each month". It can be shared "with all dollar amounts hidden". — [Monarch blog: Visualize your cash flow](https://www.monarch.com/blog/visualize-your-cash-flow-like-never-before)
- The Monarch Cash Flow page shows total income, total spend, net difference and savings rate for any period, broken down by category, merchant or tag, with a Sankey on web. Sacra describes Monarch as the only PF app offering both bar and Sankey views. — [Sacra](https://sacra.com/c/monarch-money/) (third-party analysis)
- Monarch Reports (Feb 26, 2025):
  - charts: bar, donut and Sankey;
  - grouping: merchant, category, account and classification (e.g., tax-deductible);
  - relative date ranges ("This month", "Last year", "Last 2 quarters") that update on load;
  - saved/bookmarked reports;
  - "dynamic y-axis scaling on vertical bar charts" so outliers don't distort trends;
  - improved colors and contrast "particularly in dark mode". — [Monarch blog: Saved reports](https://www.monarch.com/blog/saved-reports-and-more)
- Monarch added a treemap view (Aug 2026) that "sizes every category by the amount behind it". It also added forecasting/what-if (Apr 2026), side-by-side forecast comparison (Jul 2026), and mobile reports parity (Jun 2026). — [Monarch What's New](https://www.monarch.com/whats-new)
- "Sparkle" icons on dashboard widgets, Accounts and Transactions reveal "instant, contextual insights" (unusual spending, net worth drivers). A Weekly Recap goes to the dashboard and email. — [Monarch blog: Winter Release](https://www.monarch.com/blog/winter-release)
- The Copilot dashboard shows the spending line (dotted ideal vs solid actual), Free to Spend, a Budgets snapshot of trending categories, and an Upcoming list. Copilot has separate tabs for transactions, cash flow, accounts, investments, categories and recurring. — [Copilot help: Dashboard](https://help.copilot.money/en/articles/6045480-dashboard-tab-overview); [9to5Mac](https://9to5mac.com/2025/06/26/copilot-money-is-the-budgeting-app-youve-been-looking-for/)
- Copilot tracks investments intraday, benchmarks against the S&P 500, includes crypto wallets, and pulls Zillow values for real estate in net worth. — [tooldirectory.ai](https://tooldirectory.ai/tools/copilot-money) (third-party summary)
- Copilot users requested an "Income vs Expenses / Cash Flow Graph". — [Copilot feedback](https://feedback.copilot.money/feature-requests/p/income-vs-expenses-cash-flow-graph)
- Copilot's monthly cash-flow summaries are described as resembling a "Spotify Wrapped" format. — [Subscrybe](https://subscrybe.com/copilot-shows-the-importance-of-ux-design-and-gamification/)
- Simplifi shows projected balances as a graph per account on web, and on mobile as upcoming items with the projected balance under each. — [Quicken blog](https://www.quicken.com/blog/6-ways-Simplifi-helps-track-your-money/)
- Mercury's transactions page includes "real-time cashflow graphs" and "interactive money movement breakdowns". — [Mercury blog Aug 2025](https://mercury.com/blog/august-2025-product-updates)

### Inferences
- Default dashboard for a bookkeeping app:
  1. a hero number with a pacing chart (Copilot);
  2. a "needs review" card;
  3. an upcoming-bills list;
  4. net worth over time.
- Reports should be a configurable query builder with chart-type switching (bar/donut/Sankey/treemap), grouping by account/category/payee/tag, relative date presets and "save report". Double-entry makes a Sankey (income accounts → expense accounts + savings) easy to derive correctly.
- Chart details worth copying: dynamic y-axis clipping of outliers, privacy mode with amounts hidden, and per-widget AI explainers ("sparkle") that an agent can populate.

### Gaps
- No primary-source description of Monarch Sankey layout details (node ordering, hover behavior, group/category toggle), or of chart color palettes for any app.
- Net worth chart styling (stacked assets/liabilities vs single line) is not documented in sources found.

---

## 6. Design language: typography, color, density, dark mode, motion, empty states, onboarding; why Copilot and Mercury are considered beautiful

### Takeaway
Copilot's acclaim comes from Apple-native polish: an Apple Design Award 2024 finalist, App Store Editor's Choice, emoji category icons, colorful but meaning-bearing bars, widgets, and dark mode. Mercury's reputation is calm restraint: a near-monochrome dark navy/indigo palette, a custom typeface, product language rather than banking jargon, and color reserved for meaning (red/yellow only for errors and warnings). Both reserve strong color for state.

### Cited Findings
- Copilot was an Apple Design Awards 2024 finalist and has been featured as Editor's Choice, a 2023 App Store Awards finalist, and in "Apps We Love". It was founded by ex-Google engineer Andres Ugarte with the explicit goal of being beautiful enough for an ADA nomination. — [search excerpts: Subscrybe / App Store data](https://subscrybe.com/?p=32994); [9to5Mac](https://9to5mac.com/2025/06/26/copilot-money-is-the-budgeting-app-youve-been-looking-for/)
- Copilot's environment is "filled with colors and emojis" and "heavily inspired by Apple's interface". It offers dark/light mode and interactive widgets in all sizes, and was a Webby "Best UX" nominee. — [Subscrybe](https://subscrybe.com/copilot-shows-the-importance-of-ux-design-and-gamification/)
- Copilot shipped its "first real design refresh since launch" in 2025 and a web app in December 2025. — [tooldirectory.ai](https://tooldirectory.ai/tools/copilot-money) (third-party)
- Copilot uses Apple FinanceKit for real-time Apple Card data. — [9to5Mac](https://9to5mac.com/2025/06/26/copilot-money-is-the-budgeting-app-youve-been-looking-for/)
- Copilot's color carries meaning: green = on pace, yellow→orange = trending over, red = over budget, light-blue dot = unreviewed. — [Copilot help: Categories](https://help.copilot.money/en/articles/9504513-categories-tab-overview); [Copilot help: Web](https://help.copilot.money/en/articles/11780342-copilot-money-for-web)
- Mercury color system: green as primary ("growth framing"), blue secondary ("stability"), red and yellow "reserved exclusively for errors and warnings". "The color system… is built around calm, not energy", and "emotional neutrality is the default". The breakdown counts 108 modal instances against 10 onboarding screens and notes the post-login experience "can feel like being dropped into a cockpit". — [925 Studios: Mercury design breakdown](https://www.925studios.co/blog/mercury-design-breakdown) (third-party analysis)
- Mercury uses a custom typeface, Arcadia, with "unusual 480-weight headlines". Its palette is deep navy-charcoal with an indigo accent. Navigation uses "product language rather than banking language" and onboarding "starts with just an email address". The same source cites an NPS of 73.8 versus an industry average of 34 and compares Mercury's approach to Linear. — [search excerpt: blakecrosley.com Mercury guide](https://blakecrosley.com/pt-BR/guides/design/mercury) (third-party; NPS figure unverified)
- Mercury uses "morphing animation and subtle signs" to explain card functions. — [search excerpt: UX Planet](https://uxplanet.org/captivating-design-of-the-mercury-fintech-app-d472bc0288bb) (paywalled)
- Monarch improved colors and contrast "particularly in dark mode" in reports (Feb 2025). — [Monarch blog](https://www.monarch.com/blog/saved-reports-and-more)
- YNAB uses a consistent color + icon vocabulary in the plan (green/yellow/red/gray plus calendar, pie, check and Zz icons). — [YNAB: Colors and Icons](https://support.ynab.com/en_us/colors-and-icons-in-your-plan-HJQv_XHko.md)

### Inferences
- "Color reserved for meaning" is the shared principle. Mercury does it by restraint, Copilot by consistent semantic colors on top of playful emoji icons. For a near-monochrome, compact app (which matches this user's stated direction), follow Mercury:
  - neutral surfaces;
  - one accent color;
  - green/red only for amounts and status, never for decoration;
  - semantic icons duplicating each color state (YNAB).
- Density: Mercury and Lunch Money are dense and table-first. Copilot is roomier and mobile-led. A desktop bookkeeping app should take the dense table approach and borrow Copilot's small touches (a status dot, pacing chart, category emoji/icon).
- Tabular numerals and right-aligned amounts are implied best practice but were not documented in the sources found (see Gaps).

### Gaps
- No primary design-team write-ups (Mercury or Copilot blogs) found about typography, motion or empty states. Third-party breakdowns are the only sources, and some are of uncertain rigor (the NPS figure in particular).
- No sources found on empty-state or onboarding copy for Monarch, Copilot or YNAB beyond Mercury's "email-only start".

---

## 7. AI features: Monarch AI Assistant, Copilot ML categorization, Rocket Money, Lunch Money, Mercury, Ramp, Brex; confidence and correction

### Takeaway
Two AI patterns are emerging:
- **Silent, confidence-gated automation with easy correction.** Copilot applies a prediction only when confident, badges it, and surfaces its "top two guesses". Ramp auto-posts low-risk items and queues the rest with context.
- **Conversational assistants.** Monarch's Assistant mostly reads and answers. Mercury Command, Ramp and Brex take actions too: categorize, pay, set memos.

Users correct either through the normal review UI or in natural language. MCP and agent integrations are now shipping, e.g. Monarch MCP in Oct 2026.

### Cited Findings
**Copilot Intelligence (categorization)**
- "Each Copilot user gets their own AI model, so all you have to do to make it even smarter is to review your transactions." It activates after the user reviews 30 transactions. Inputs: "the name of the transaction, amount, day of the week, which card was used, and a few other data points". — [Copilot help: Copilot Intelligence for spending](https://intercom.help/copilotmoney/en/articles/8182433-copilot-intelligence-for-spending)
- Confidence gating: "If Copilot Intelligence can't find a pattern and is not very confident in the prediction, it won't apply it." Confident predictions show an "Intelligence" badge next to the category. For possibly wrong predictions, Copilot will "surface the top two guesses at the front of the list to make it easy to re-categorize". Users are encouraged to keep a zero backlog. (The fetched page displayed the date Aug 20, 2026, which is likely a last-updated date, not the launch date.) — [Copilot help](https://intercom.help/copilotmoney/en/articles/8182433-copilot-intelligence-for-spending)

**Monarch**
- The AI Assistant (Winter Release, Dec 18, 2025) answers questions such as "Why did my net worth change this month?" or "What did I overspend on?" using the user's own data. It was shaped by a panel of CFPs, CFTs, PhDs and coaches. It appears advisory and is not documented as editing transactions. — [Monarch blog: Winter Release](https://www.monarch.com/blog/winter-release)
- "Sparkle" contextual insights sit on widgets, accounts and transactions. Receipt scanning auto-matches, splits and recategorizes. — [Monarch blog: Winter Release](https://www.monarch.com/blog/winter-release)
- Monarch shipped a "Faster AI Assistant" (Sept 2026) and an MCP integration (Oct 2026) to "Connect Monarch to Claude, ChatGPT, and other AI tools". — [Monarch What's New](https://www.monarch.com/whats-new)
- Comparison claim: Copilot's AI "works quietly in the background on categorization accuracy, where it is the strongest", while Monarch's assistant is "the strongest conversational implementation". — [unstar.app comparison](https://unstar.app/blog/ynab-rocket-money-monarch-everydollar-copilot-budget-apps-ranked-2026) (third-party opinion)

**Lunch Money**
- No native LLM categorizer was found. Lunch Money offers a Zapier template (Mar 2026) that watches *unreviewed* transactions, has AI assign a category, and updates the transaction. A user-reported bug says autocategorization can overwrite a manually selected category on manual entry. — [Lunch Money blog: Zapier](https://lunchmoney.app/blog/lunch-money-is-now-on-zapier); [Lunch Money feedback bug](https://feedback.lunchmoney.app/bugs/p/autocategorization-changes-the-manually-selected-category-when-creating-a-transa)

**Mercury Command**
- Mercury Command is "a conversational interface built directly into your Mercury account". It answers questions (balances, finding transactions) and takes actions: sending payments, freezing cards, updating card limits, categorizing transactions, and creating/sending invoices. — [search excerpt of Mercury support: Mercury Command overview](https://support.mercury.com/hc/en-us/articles/50304702652436-Mercury-Command-overview); [01net](https://www.01net.it/mercury-launches-command-a-new-way-to-run-your-business-through-banking/)

**Ramp**
- The Accounting Agent auto-codes GL, department, class, location and custom fields, and splits bills at line-item level. Ramp claims "up to 3.5 times more auto-coding than legacy tools, with 90%+ accuracy". — [search excerpt of Ramp blog](https://ramp.com/blog/accounting-agent-launch)
- Low-risk items (e.g., a "$17 Uber ride") are coded, checked and synced "with a full audit trail". For the rest, reviewers get context: "submission completeness checks, coding certainty assessments, vendor history". Admins choose what Ramp can do: "code, review, sync, or all of the above". Corrections are in natural language. — [Ramp blog: Accounting Agent launch (Feb 12, 2026)](https://ramp.com/blog/accounting-agent-launch)

**Brex**
- Brex Assistant auto-populates receipts (from L3 data), memos, attendees and categories. An "auto-pilot" mode is available. Users can give commands like "Assign all DoorDash charges to my WFH stipend". ML "guide[s] managers to expenses worthy of human review and automates the rest". — [search excerpts of Brex: Brex Assistant](https://www.brex.com/support/brex-assistant); [Brex AI](https://brex.com/platform/brex-ai)

**Rocket Money**
- No specific AI-confidence UI found. Its automation centers on recurring detection, cancellation and bill negotiation. — [search excerpts: reviews](https://www.thequalityedit.com/articles/rocket-money-review)

### Inferences
- For an agent-operated ledger, combine these patterns:
  1. Apply a category only above a confidence threshold, and show a subtle badge (Copilot's "Intelligence") marking it as machine-applied.
  2. Leave below-threshold items unreviewed, with the top-2 suggestions pinned at the top of the picker.
  3. Auto-post only low-risk/low-amount items, with an audit trail (Ramp).
  4. Never let AI override user-set or rule-set values (Ramp).
  5. Accept natural-language standing instructions and turn them into visible, editable rules (Ramp/Brex → Lunch Money-style rule).
  6. For assistant answers, the Monarch "sparkle" pattern (contextual insight per widget) is lighter-weight than a chat pane.
- Mercury Command shows that chat-driven *actions* (pay, categorize) are acceptable in banking. A local bookkeeping app should still add a confirmation step for destructive or financial actions.

### Gaps
- Not found: how Mercury Command confirms actions before executing (support page blocked), or whether Monarch's Assistant cites the transactions it used.
- No source for Rocket Money's AI features or for any app showing numeric confidence percentages. Copilot's badge is binary.

---

## 8. Imports: CSV mapping, de-duplication, manual accounts

### Takeaway
CSV import is a secondary but expected feature. Monarch auto-maps columns and offers an explicit overlap policy ("Prioritize CSV" replaces the range, "Prioritize Monarch" only fills missing history). Lunch Money applies rules and recurring detection to CSV imports the same way as synced data. YNAB exposes match/unmatch for imported vs manually entered transactions.

### Cited Findings
- Monarch CSV import: the user reviews suggested column mappings and accepts or changes them. Overlap policy: "Prioritize CSV" deletes and replaces all existing transactions between the CSV's earliest and latest dates. "Prioritize Monarch" keeps existing data and imports only missing earlier transactions. Imports work into both synced and manual accounts, and balance history can be imported separately. — [search excerpts of Monarch help: Importing transactions](https://help.monarch.com/hc/en-us/articles/41843105489300-Importing-Balances-and-Transactions-Manually); [Monarch help: Account balance history](https://help.monarch.com/hc/en-us/articles/14882425704212)
  - Caveat: the "keyword-based" auto-detection wording in search excerpts may come from a third-party tool, not Monarch.
- Lunch Money rules apply to synced and manually or CSV-imported transactions alike. Recurring suggestions are generated from CSV imports too. — [Lunch Money: Rules](https://support.lunchmoney.app/setup/rules.md); [search excerpt: Lunch Money recurring](https://support.lunchmoney.app/finances/recurring-items/creating-recurring-items)
- Lunch Money "one-time rules" ("delete rule after use") can remove a manual placeholder once the real import arrives, a lightweight de-dup pattern. — [Lunch Money: Rules](https://support.lunchmoney.app/setup/rules.md)
- In YNAB, imported transactions that match a manual entry show a match icon. Clicking it shows both transactions with an Unmatch button. — [YNAB blog](https://www.ynab.com/blog/8-ways-your-budget-just-got-better)
- Monarch email forwarding (Jul 2026) and receipt scanning (Dec 2025) are additional ingestion paths. — [Monarch What's New](https://www.monarch.com/whats-new); [Monarch Winter Release](https://www.monarch.com/blog/winter-release)
- Duplicate transactions from bank sync are a recurring user complaint (Monarch, YNAB). — [checkthat.ai](https://checkthat.ai/brands/monarch/reviews); [Fortune: YNAB pros and cons](https://fortune.com/article/ynab-pros-and-cons)

### Inferences
- For a local app, CSV import is the main ingestion path, so it deserves first-class UX:
  - auto-mapped columns with a preview grid;
  - a saved per-account mapping profile;
  - sign-convention and date-format pickers;
  - an explicit overlap policy (replace range vs. fill gaps vs. match);
  - a post-import "matched / new / possible duplicate" review screen with Match/Unmatch (YNAB).
- Imported rows should land "unreviewed" and run through rules and the agent's categorizer before display.

### Gaps
- No primary detail found on Lunch Money's or YNAB's CSV column-mapping screens, or on Copilot's import (beyond Mint import).
- De-dup algorithms (date window, amount tolerance) are not documented publicly in sources found.

---

## 9. What users praise and complain about (Reddit and reviews)

### Takeaway
Users praise design polish and low-effort categorization (Copilot), flexibility, reports and household features (Monarch), and the behavior change the method produces (YNAB). They complain most about bank-sync breakage, duplicates, price, setup effort and platform limits (Copilot was Apple-only until Dec 2025). Weak recurring detection is also a complaint (Monarch). Direct Reddit threads could not be fetched, so most evidence comes from aggregators.

### Cited Findings
- Monarch complaints: sync issues with specific banks (Synchrony, Chase, some credit unions) are "the most common complaint". Others: real setup effort in the first weeks, broken links and duplicate transactions, price, AI missing true subscriptions, and a "half-baked" Recurring feature. — [checkthat.ai review aggregation](https://checkthat.ai/brands/monarch/reviews); [Gerald summaries](https://joingerald.com/learn/money-basics/monarch-reviews) (aggregators)
- Bank connections across apps "break weekly, sometimes daily", with Chase, Capital One, USAA and Wells Fargo requiring reauth every 7-14 days. — [unstar.app](https://unstar.app/blog/ynab-rocket-money-monarch-everydollar-copilot-budget-apps-ranked-2026) (aggregator)
- Copilot complaints: historically Apple-only, and an older complaint that income wasn't tracked like Monarch's. — [maketecheasier](https://maketecheasier.com/monarch-app-mint-replacement/)
- Copilot has since added a web app (Dec 2025). — [tooldirectory.ai](https://tooldirectory.ai/tools/copilot-money)
- YNAB praise: an evangelical user base. Users say they save more in the first month than the annual fee. YNAB complaints: price ($14.99/mo or $99/yr) is "the most frequent complaint", plus sync breakage and duplicates. Reconciliation and manual entry split the community. — [Fortune: YNAB pros and cons](https://fortune.com/article/ynab-pros-and-cons); [pocketclear YNAB complaints](https://pocketclear.app/blog/ynab-complaints-problems.html)
- An r/ynab "pain points" thread exists (Jun 2024) via a Reddit mirror. Contents were not fetched. — [r/ynab mirror](https://lr.in.psf.lt/r/ynab/comments/1dro0mo/ynab_painpoints)
- Rocket Money praise: finds forgotten subscriptions, and its clean dashboard shows upcoming payments and potential savings. Complaints: custom categories need Premium ($6-12/mo). — [search excerpts: Rocket Money reviews](https://www.thequalityedit.com/articles/rocket-money-review); [Rob Berger](https://robberger.com/?p=4166)
- Lunch Money users have long asked for richer keyboard shortcuts and a command palette. — [Lunch Money feedback](https://feedback.lunchmoney.app/general-feature-request/p/keyboard-shortcuts)
- Mercury: the "cockpit" critique, i.e. post-login density can overwhelm less sophisticated users. — [925 Studios](https://www.925studios.co/blog/mercury-design-breakdown)

### Inferences
- A local, single-user app avoids the #1 complaint category (aggregator sync breakage) entirely. It should put that saved effort into CSV import, de-dup, and review speed.
- Setup effort is a real churn risk, so pre-seeded charts of accounts or categories, auto-suggested rules, and an agent that does the first categorization pass matter.
- Power users (Lunch Money, YNAB communities) want keyboard-first review and a command palette, which is a differentiator.

### Gaps
- Could not retrieve r/MonarchMoney, r/CopilotMoney, r/ynab or r/personalfinance threads directly. Findings come from aggregators and third-party review sites of varying rigor.
- No Wirecutter/NerdWallet/Verge primary texts were fetched in this pass.
- No App Store review summary data was retrieved for Copilot or Monarch.
