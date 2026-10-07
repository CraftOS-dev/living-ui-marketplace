/** Shapes answered by the app's operations (pb_hooks/ops*.pb.js). */

export type Source = 'app' | 'agent' | 'receipt' | 'csv' | 'recurring';

export interface Expense {
  id: string;
  date: string;
  amount: string;
  amount_minor: number;
  currency: string;
  note: string;
  category: string | null;
  category_id: string | null;
  category_icon: string | null;
  source: Source;
  receipt_id: string | null;
  import_id: string | null;
  recurring_id: string | null;
  created: string;
  original_amount?: string;
  original_currency?: string;
  fx_rate?: number;
  receipt?: Receipt;
}

export interface ExpenseList {
  currency: string;
  count: number;
  total: string;
  total_minor: number;
  expenses: Expense[];
}

export interface Settings {
  currency: string;
  currency_decimals: number;
  currency_confirmed: boolean;
  monthly_budget: string | null;
  monthly_budget_minor: number;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  sort: number;
  count: number;
  recent_count: number;
  month_total: string;
  month_total_minor: number;
  budget: string | null;
  budget_minor: number;
}

export interface MonthCategory {
  id: string | null;
  name: string;
  icon: string;
  total: string;
  total_minor: number;
  count: number;
  budget: string | null;
  budget_minor: number;
  share: number;
}

export interface MonthSummary {
  month: string;
  currency: string;
  total: string;
  total_minor: number;
  count: number;
  uncategorized: number;
  days_in_month: number;
  day_of_month: number;
  days_left: number;
  daily_average: string;
  daily_average_minor: number;
  daily:{ date: string; total: string; total_minor: number }[];
  previous: { month: string; through_day: number; total: string; total_minor: number };
  budget: { amount: string; amount_minor: number; left: string; left_minor: number; used_pct: number } | null;
  categories: MonthCategory[];
  biggest: Expense[];
}

export interface Trend {
  currency: string;
  months: { month: string; total: string; total_minor: number; count: number }[];
  average: string;
  average_minor: number;
}

export type ReceiptStatus = 'waiting' | 'reading' | 'done' | 'failed';

export interface Receipt {
  id: string;
  status: ReceiptStatus;
  error: string;
  added_by: 'app' | 'agent';
  file: string;
  file_path: string;
  url: string;
  expense_id: string | null;
  created: string;
  updated: string;
  expense?: Expense;
}

export interface Recurring {
  id: string;
  note: string;
  amount: string;
  amount_minor: number;
  currency: string;
  category: string | null;
  category_id: string | null;
  category_icon: string | null;
  cadence: 'weekly' | 'monthly' | 'yearly';
  start_date: string;
  next_date: string;
  count_added: number;
  active: boolean;
}

export interface ImportColumn {
  index: number;
  name: string;
  kind: 'date' | 'amount' | 'text' | 'empty';
  samples: string[];
}

export interface ImportMapping {
  date_column: number | null;
  amount_column: number | null;
  note_column: number | null;
  category_column: number | null;
  date_format: string | null;
  decimal: '.' | ',';
  expenses_are: 'negative' | 'positive' | 'all';
  currency: string;
  create_categories: boolean;
  skip_duplicates: boolean;
}

export type PlannedStatus = 'new' | 'duplicate' | 'not_expense' | 'empty' | 'invalid';

export interface PlannedRow {
  line: number;
  date: string | null;
  amount: string | null;
  note: string;
  category: string | null;
  status: PlannedStatus;
  problem: string;
  new_category?: boolean;
}

export interface ImportPreview {
  import_id: string;
  filename: string;
  status: 'previewed' | 'imported' | 'undone';
  delimiter: string;
  has_header: boolean;
  header: string[];
  columns: ImportColumn[];
  mapping: ImportMapping;
  date_formats: string[];
  date_format_ambiguous: boolean;
  counts: Record<'rows' | PlannedStatus, number>;
  total: string;
  total_minor: number;
  home_currency: string;
  new_categories: string[];
  rows: PlannedRow[];
  problems: PlannedRow[];
}

export interface ImportRecord {
  id: string;
  filename: string;
  status: 'previewed' | 'imported' | 'undone';
  rows: number;
  added: number;
  skipped: number;
  created: string;
  updated: string;
}
