/**
 * LedgerFlow TypeScript Interfaces
 * All interfaces match backend camelCase responses exactly.
 */

// ============================================================================
// App State
// ============================================================================

export type ActiveView =
  | 'dashboard'
  | 'transactions'
  | 'accounts'
  | 'accountLedger'
  | 'invoices'
  | 'bills'
  | 'contacts'
  | 'reports'
  | 'settings'

export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
}

// ============================================================================
// Settings
// ============================================================================

export interface Settings {
  id: number
  businessName: string
  currency: string
  fiscalYearStart: number
  defaultTaxRate: number
  createdAt: string
  updatedAt: string
}

export interface SettingsUpdate {
  businessName?: string
  currency?: string
  fiscalYearStart?: number
  defaultTaxRate?: number
}

// ============================================================================
// Accounts
// ============================================================================

export interface Account {
  id: number
  code: string
  name: string
  type: string
  subType: string
  description: string
  openingBalance: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AccountBalance {
  accountId: number
  accountName: string
  accountCode: string
  accountType: string
  balance: number
  debitTotal: number
  creditTotal: number
}

export interface CreateAccountData {
  code: string
  name: string
  type: string
  subType?: string
  description?: string
  openingBalance?: number
}

export interface UpdateAccountData {
  code?: string
  name?: string
  type?: string
  subType?: string
  description?: string
  isActive?: boolean
}

// ============================================================================
// Categories
// ============================================================================

export interface Category {
  id: number
  name: string
  type: string
  description: string
  isActive: boolean
  createdAt: string
}

export interface CreateCategoryData {
  name: string
  type: string
  description?: string
}

export interface UpdateCategoryData {
  name?: string
  type?: string
  description?: string
  isActive?: boolean
}

// ============================================================================
// Contacts
// ============================================================================

export interface Contact {
  id: number
  name: string
  type: string
  email: string
  phone: string
  address: string
  taxId: string
  notes: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateContactData {
  name: string
  type: string
  email?: string
  phone?: string
  address?: string
  taxId?: string
  notes?: string
}

export interface UpdateContactData {
  name?: string
  type?: string
  email?: string
  phone?: string
  address?: string
  taxId?: string
  notes?: string
  isActive?: boolean
}

// ============================================================================
// Journal Entries / Transactions
// ============================================================================

export interface JournalLine {
  id: number
  entryId: number
  accountId: number
  accountName: string
  accountCode: string
  debit: number
  credit: number
  description: string
}

export interface JournalEntry {
  id: number
  date: string
  description: string
  reference: string
  type: string
  contactId: number | null
  contactName: string
  categoryId: number | null
  categoryName: string
  lines: JournalLine[]
  totalAmount: number
  createdAt: string
}

export interface TransactionFilters {
  fromDate?: string
  toDate?: string
  accountId?: number
  categoryId?: number
  type?: string
  search?: string
  limit?: number
  offset?: number
}

export interface RecordIncomeData {
  date: string
  amount: number
  depositAccountId: number
  revenueAccountId: number
  description: string
  contactId?: number
  categoryId?: number
  reference?: string
}

export interface RecordExpenseData {
  date: string
  amount: number
  payFromAccountId: number
  expenseAccountId: number
  description: string
  contactId?: number
  categoryId?: number
  reference?: string
}

export interface RecordTransferData {
  date: string
  amount: number
  fromAccountId: number
  toAccountId: number
  description: string
  reference?: string
}

// ============================================================================
// Invoices
// ============================================================================

export interface InvoiceLine {
  id: number
  invoiceId: number
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export interface Invoice {
  id: number
  invoiceNumber: string
  customerId: number
  customerName: string
  issueDate: string
  dueDate: string
  status: string
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  amountPaid: number
  balanceDue: number
  notes: string
  lines: InvoiceLine[]
  createdAt: string
  updatedAt: string
}

export interface CreateInvoiceData {
  customerId: number
  issueDate: string
  dueDate: string
  taxRate?: number
  notes?: string
  lines: { description: string; quantity: number; unitPrice: number }[]
}

export interface UpdateInvoiceData {
  customerId?: number
  issueDate?: string
  dueDate?: string
  taxRate?: number
  notes?: string
  lines?: { description: string; quantity: number; unitPrice: number }[]
}

export interface RecordInvoicePaymentData {
  amount: number
  depositAccountId: number
  date?: string
}

// ============================================================================
// Bills
// ============================================================================

export interface BillLine {
  id: number
  billId: number
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export interface Bill {
  id: number
  billNumber: string
  vendorId: number
  vendorName: string
  issueDate: string
  dueDate: string
  status: string
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  amountPaid: number
  balanceDue: number
  notes: string
  lines: BillLine[]
  createdAt: string
  updatedAt: string
}

export interface CreateBillData {
  vendorId: number
  issueDate: string
  dueDate: string
  taxRate?: number
  notes?: string
  lines: { description: string; quantity: number; unitPrice: number }[]
}

export interface UpdateBillData {
  vendorId?: number
  issueDate?: string
  dueDate?: string
  taxRate?: number
  notes?: string
  lines?: { description: string; quantity: number; unitPrice: number }[]
}

export interface RecordBillPaymentData {
  amount: number
  payFromAccountId: number
  date?: string
}

// ============================================================================
// Dashboard
// ============================================================================

export interface DashboardSummary {
  cashBalance: number
  totalIncome: number
  totalExpenses: number
  netIncome: number
  accountsReceivable: number
  accountsPayable: number
}

export interface MonthlyData {
  month: string
  income: number
  expenses: number
}

export interface CategoryBreakdown {
  category: string
  amount: number
  percentage: number
}

// ============================================================================
// Reports
// ============================================================================

export interface ProfitLossReport {
  fromDate: string
  toDate: string
  revenue: { accountName: string; accountCode: string; amount: number }[]
  totalRevenue: number
  expenses: { accountName: string; accountCode: string; amount: number }[]
  totalExpenses: number
  netIncome: number
}

export interface BalanceSheetReport {
  asOf: string
  assets: {
    accounts: { accountName: string; accountCode: string; balance: number }[]
    total: number
  }
  liabilities: {
    accounts: { accountName: string; accountCode: string; balance: number }[]
    total: number
  }
  equity: {
    accounts: { accountName: string; accountCode: string; balance: number }[]
    total: number
  }
}

export interface TrialBalanceReport {
  fromDate?: string
  toDate?: string
  accounts: {
    accountName: string
    accountCode: string
    accountType: string
    debit: number
    credit: number
  }[]
  totalDebits: number
  totalCredits: number
}

export interface AccountLedgerEntry {
  id: number
  date: string
  description: string
  reference: string
  debit: number
  credit: number
  runningBalance: number
}
