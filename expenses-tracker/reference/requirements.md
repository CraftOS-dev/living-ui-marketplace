# Expenses tracker: requirements

Personal use only: one person, one home currency, no accounts or sign-in.
The front shows only what is essential; advanced features are reachable
with a click but never crowd Home. No emoji anywhere: categories wear line
icons.

Visual language (redesign of 2026-10-07): a warm soft dashboard. A warm
gray canvas holding one cream app shell with large rounded corners; white,
sand and one dark card; dark primary pills with an accent dot;
generous radii, no card borders; Manrope; one type scale of 12, 13, 14, 15
and 26 px; pointer cursor on everything clickable. Every color comes from
the host's theme tokens: switching the theme pack, light or dark mode, or
custom colors recolors the app (highlights use the theme's accent; the sand
and dark cards are mixed from the theme). Nothing light sits on light or dark
on dark in any pack: where a pack's accent is its text color or its surface
is its background, the app picks other theme colors that contrast. Only the
red "over" and green "good" state colors are fixed. The app names no
particular AI agent: it says "your AI agent". Numbers always read
"1,234.50": "," separates thousands and "." is the decimal point, whatever
the browser language; typing "," in an amount adds nothing, and a comma that
is not between thousands is refused, never misread.

## Frame

1. A slim icon rail on the left (wide screens): Home, Expenses, Insights,
   Budgets; Recurring, Receipts, Import and export; Categories and Settings
   at the bottom. The current page is a solid circle with an accent icon;
   hovering an icon shows its name. On phones a floating bottom bar with
   Home, Expenses, a raised "+" in the middle, Insights and a menu for the
   rest. Every page works down to 320 px wide.

## Home dashboard

2. A greeting with today's date, a search box (opens Expenses with the
   search) and an "Add expense" pill with an accent "+".
3. The first open asks which currency the user spends in; nothing else is
   seeded besides the categories.
4. "Spending in <month>": a sand card with a legend (the five biggest
   categories and everything else, with amounts) and a spending ring: a
   thick segmented ring, labels written along the band, an open gap holding
   three icon shortcuts (scan a receipt, import a CSV, insights) and the
   total in the middle. Hovering a segment shows its numbers in the middle;
   clicking a segment or a legend row opens those expenses.
5. Under the ring, "Daily spending": one bar per day of the month with
   dashed gridlines and the axis on the right; today in the accent, days over
   the daily allowance in coral, a pale bar behind each day for the daily
   allowance when a budget is set; a bar opens that day's expenses.
6. "Spending days": a dark calendar of the month; days with spending are
   filled, the three biggest days are in the accent, today is ringed; a day opens
   its expenses. Its month menu switches the whole dashboard to another
   month.
7. "Monthly budget": a gauge of what is left (or over), the amount spent in
   a bubble at the end of the arc, and a "Change" button that sets the
   monthly limit.
8. "Compared with <last month>": the percentage of last month spent by the
   same day, with a bar.
9. "Recent expenses": the five latest as soft rows (icon, what, category and
   day, where it came from, amount), "Add new +" and a link to all.
10. While receipts wait for the AI agent a status line says so and links to
    Receipts; unreadable receipts are counted there too.

## Adding an expense

11. The "+" grows into a full entry screen with a circular reveal from where
    it was pressed; Back or Escape shrinks it back.
12. Three numbered steps side by side (stacked on narrow screens), read in
    order: 1 Amount (required), 2 Category, 3 Details with Save at its end.
    The next step to do has a solid number, finished ones a check. Step 1 is
    a dark amount display with a blinking caret and a keypad (digits,
    decimal point, delete). The physical keyboard types into the amount too; Enter
    saves. Only the amount is required: Save stays disabled until it is
    more than zero, and the currency's decimals are respected.
13. Category tiles with icons (most used first); the chosen one turns dark
    with its icon on the accent. Details, all optional: what it was for;
    when (Today, Yesterday, or Other day, which opens a month calendar to
    pick any day); a receipt file; "Paid in another currency" (converted at
    that day's rate, with a preview; the European Central Bank rate through
    Frankfurter, or currency-api when Frankfurter does not answer or lacks
    the currency).
14. "Have a receipt? Let your AI agent read it" in the header: photos or
    PDFs are handed to the agent and the screen closes.
15. After saving, a dark pill confirms what was added with Undo.
16. Tapping any expense opens the same screen to edit it, with Delete.

## Expenses

17. A month at a time (month switcher pill), search across all months, a
    category filter; grouped by day in rounded cards with day totals.
18. Select mode moves many expenses to a category or deletes them from a
    floating dark bar.
19. When the month has uncategorized expenses, a sand card offers "Ask
    your AI agent to sort them": firing lands a pending request and the button
    shows its state (sent, working, done with the result, or refused).

## Insights

20. For a chosen month: spent, per day, number of expenses, against last
    month; the ring with its legend; every category as a row with segmented
    bars against its budget (or the month); the last 12 months as bars (a
    bar selects that month); the biggest expenses.

## Budgets

21. A whole-month limit with its gauge, and a limit per category with
    segmented bars; empty means no limit; saving on Enter or leaving the box.
    Each limit is a clearly outlined field with its own fill (never the same
    color as the row it sits in), "Set limit" while empty, and the saved
    amount written "1,250.00".

## Recurring

22. Recurring expenses (weekly, monthly, yearly) record themselves on each
    date; past dates are recorded at once (the dialog says how many). Pause
    with a switch, edit and delete; deleting keeps what was recorded.

## Categories

23. Category cards (icon, name, count, this month); a card opens an editor
    with the name, an icon picker of line icons, and Delete with a choice of
    where its expenses go. Names are unique ignoring case.

## Receipts

24. Drop several receipts at once. Each row shows its state: waiting for
    the AI agent, reading, recorded (with the expense), or could not be read
    (with the reason, Type it in, Try again); any can be deleted.

## Import and export

25. Import a bank or card CSV: delimiter, header, date, amount and
    description columns, date layout, decimal mark and which amounts are
    spending are detected from the data and can each be changed; the preview
    counts new, already here, money in, without an amount and unreadable,
    and shows the first rows. Nothing is written until Import. Re-importing
    an overlapping statement adds only what is new. Past imports can be
    undone. Export any range as CSV.

## Settings

26. Change the home currency (amounts keep their numbers; nothing is
    converted); a dark card lists what to ask the AI agent.

## The AI agent

27. Every action in the UI exists as a CLI operation; `app.guide` gives the
    conventions, the category names and icon set, and recipes for receipts
    and CSV files. Data written by any route obeys the same record rules.

## Changes

- 2026-10-07: First version.
- 2026-10-07: Complete redesign of the interface (dashboard with spending
  ring, daily bars, dark calendar, budget gauge; "+" opens a full-screen
  entry with a circular reveal and keypad; icon rail). Categories use line
  icons instead of emoji (`icon` field, migration 1700000300).
- 2026-10-07: Colors follow the host theme tokens (theme packs, light
  and dark, custom colors) instead of a fixed yellow palette; the entry
  screen is rebalanced into two even columns with Save underneath.
- 2026-10-07: Colors are derived with contrast checks for every theme pack
  (nothing light on light or dark on dark; distinct ring colors where a pack
  is monochrome). The entry screen is three numbered steps; "Other day" opens
  an in-app day picker. "CraftBot" is now "your AI agent" everywhere, and the
  `craftbot` source and added_by values are `agent` (migration 1700000400).
- 2026-10-07: Exchange rates no longer fail when Frankfurter is briefly
  unreachable (currency-api answers instead, also for currencies the ECB
  does not publish); the preview no longer toasts on every keystroke.
  Numbers use "," for thousands and "." for decimals everywhere; "," typed
  in the entry screen is no longer a decimal point.
- 2026-10-07: Budget limits are outlined fields ("Set limit" when empty) and
  amount fields show "1,250.00". An open page reloads itself onto a newly
  deployed version (after the server comes back, or when the tab is shown
  again), waiting while the entry screen or a dialog is open.
