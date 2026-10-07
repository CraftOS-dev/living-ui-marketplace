/// <reference path="../pb_data/types.d.ts" />
/**
 * app.guide: how the AI agent operates this app through the agent-app CLI.
 * Written as conventions plus ready-to-run recipes for the jobs a user
 * actually hands over (a receipt photo, a bank CSV, "how much this month").
 */

function guide(app) {
  const ex = require(`${__hooks}/lib_expenses.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const cur = ex.homeCurrency(app);
  const cats = ex.categoryList(app).map((c) => c.getString('name'));
  const run = 'agent-app run <project>';
  return {
    app: 'Expenses tracker: a personal expense tracker. One person, one home currency.',
    home_currency: cur,
    currency_decimals: money.exponent(cur),
    today: u.today(),
    categories: cats,
    category_icons: require(`${__hooks}/lib_icons.js`).ICONS,
    conventions: [
      'amount: a plain positive number in major units with "." as the decimal point and no thousands separators, e.g. 12.50 or 1234 (never 1,234.50). Expenses are always positive.',
      'date: YYYY-MM-DD (the day it was paid). Omit it for today.',
      'currency: ISO code. Omit it when the expense is in ' + cur + '. Any other currency is converted to ' + cur + ' at that day\'s rate (ECB via Frankfurter, else currency-api) and the original amount is kept; if no rate can be had, pass rate=<' + cur + ' per 1 unit> as well.',
      'category: an existing category name (case ignored) or id; empty for uncategorized. Unknown names are refused with the list of valid ones: create a new one only if the user wants it (categories.add --name "Coffee" --icon coffee). Icons come from a fixed set (see category_icons); never use emoji.',
      'note: short and human, what it was for or where (e.g. "Lunch at Ichiran", "Uber to airport"). Max 200 characters.',
      'Lists (ids, items) are JSON strings, e.g. --ids \'["abc","def"]\'.',
      'Every write returns the stored record: read it back and check amount, date and category before telling the user it is done.',
    ],
    recipes: {
      'Add one expense the user mentioned': run + ' expenses.add --amount 12.50 --note "Lunch" --category "Food and drink" [--date 2026-10-05]',
      'A receipt image or PDF the user gave you in chat':
        'Read it (describe_image for images, read_pdf for PDFs). Use the TOTAL actually paid (after tax, tip and discounts), the purchase date, the merchant as the note, the currency printed on it, and the best-fitting category. Then: ' +
        run +
        ' expenses.add --amount <total> --date <YYYY-MM-DD> --note "<merchant>" --category "<category>" [--currency <code if not ' +
        cur +
        '>] --receipt_path "<absolute path of the file>" --skip_if_duplicate true. The file is stored with the expense. If any value is unreadable, ask the user instead of guessing.',
      'Several receipts at once': 'Repeat expenses.add per receipt (each with its own --receipt_path). Or, for line items without files, use expenses.add-many --items \'[{"amount":"4.50","date":"2026-10-05","note":"Coffee","category":"Food and drink"}]\'.',
      'A bank or card CSV the user gave you':
        '1) ' +
        run +
        ' import.preview --path "<absolute path>" : shows the columns it found, the mapping it chose, counts (new, duplicate, not_expense = money in, empty, invalid) and the first rows. 2) Check the mapping against the header and sample rows: date_column, amount_column (money OUT; if the file has separate debit and credit columns, choose the debit one), note_column, date_format (if date_format_ambiguous is true, decide DD/MM vs MM/DD from the data), expenses_are (negative when spending is negative and income positive; positive or all otherwise). 3) Fix anything with options on the same call (e.g. --import_id <id> --amount_column 3 --date_format DD/MM/YYYY) and preview again. 4) ' +
        run +
        ' import.run --import_id <id> [same options]. Report how many were added and skipped. Duplicates already in the app are skipped automatically, so re-importing an overlapping statement is safe. 5) If the user wants categories, list uncategorized rows (expenses.list --uncategorized true --month <YYYY-MM>) and set them with expenses.set-category --ids \'[...]\' --category "<name>".',
      'Undo a CSV import': run + ' import.list, then ' + run + ' import.undo --import_id <id> (removes every expense that import added; confirm with the user first).',
      'How much did I spend': run + ' summary.month [--month YYYY-MM] (total, per category, budget, biggest, vs last month); ' + run + ' summary.trend --months 12 for the monthly totals.',
      'Find and fix an expense': run + ' expenses.list --q "uber" [--month YYYY-MM], then ' + run + ' expenses.update --expense_id <id> --amount 18.20 [--category ...] [--date ...] [--note ...].',
      'Delete an expense (confirm with the user first)': run + ' expenses.delete --expense_id <id>',
      'Categorize uncategorized expenses': run + ' expenses.list --uncategorized true, decide each from the note, then ' + run + ' expenses.set-category --ids \'["id1","id2"]\' --category "<existing name>". Leave an expense uncategorized when unsure.',
      'Budgets': run + ' settings.update --monthly_budget 1500 (0 removes it); per category: ' + run + ' categories.update --category_id "Groceries" --budget 400.',
      'Recurring payments (rent, subscriptions)': run + ' recurring.add --note "Netflix" --amount 15.49 --cadence monthly --start_date <next charge YYYY-MM-DD> --category "Subscriptions". Due charges are added automatically on their dates.',
      'Export': run + ' export.csv --from 2026-01-01 --to 2026-12-31 returns the CSV text (save it where the user wants).',
    },
  };
}

module.exports = { guide: guide };
