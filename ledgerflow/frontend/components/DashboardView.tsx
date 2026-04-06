import { useState, useEffect } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { ActiveView, DashboardSummary, JournalEntry, Invoice, Bill, MonthlyData, CategoryBreakdown } from '../types'
import { Card, Badge, Button, Table, EmptyState } from './ui'
import type { TableColumn } from './ui'
import { toast } from 'react-toastify'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface DashboardViewProps {
  controller: AppController
  onNavigate: (view: ActiveView) => void
  onNewTransaction: (tab?: string) => void
}

export function DashboardView({ controller, onNavigate, onNewTransaction }: DashboardViewProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [recentTxns, setRecentTxns] = useState<JournalEntry[]>([])
  const [overdueInvoices, setOverdueInvoices] = useState<Invoice[]>([])
  const [overdueBills, setOverdueBills] = useState<Bill[]>([])
  const [chartData, setChartData] = useState<MonthlyData[]>([])
  const [expenseBreakdown, setExpenseBreakdown] = useState<CategoryBreakdown[]>([])
  const [loading, setLoading] = useState(true)

  useAgentAware('DashboardView', { loading, hasSummary: !!summary })

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [s, recent, overdue, chart, breakdown] = await Promise.allSettled([
          controller.getDashboardSummary(),
          controller.getRecentTransactions(10),
          controller.getOverdueItems(),
          controller.getIncomeExpenseChart(6),
          controller.getExpenseBreakdown(),
        ])
        if (s.status === 'fulfilled') setSummary(s.value)
        if (recent.status === 'fulfilled') setRecentTxns(recent.value)
        if (overdue.status === 'fulfilled') {
          setOverdueInvoices(overdue.value.invoices || [])
          setOverdueBills(overdue.value.bills || [])
        }
        if (chart.status === 'fulfilled') setChartData(chart.value)
        if (breakdown.status === 'fulfilled') setExpenseBreakdown(breakdown.value)
      } catch {
        toast.error('Failed to load dashboard')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [controller])

  if (loading) {
    return <EmptyState message="Loading dashboard..." />
  }

  const kpis = summary ? [
    { label: 'Cash Balance', value: summary.cashBalance, color: summary.cashBalance >= 0 ? 'var(--color-success)' : 'var(--color-error)' },
    { label: 'Total Income', value: summary.totalIncome, color: 'var(--color-success)' },
    { label: 'Total Expenses', value: summary.totalExpenses, color: 'var(--color-error)' },
    { label: 'Net Income', value: summary.netIncome, color: summary.netIncome >= 0 ? 'var(--color-success)' : 'var(--color-error)' },
    { label: 'Accounts Receivable', value: summary.accountsReceivable, color: 'var(--color-info)' },
    { label: 'Accounts Payable', value: summary.accountsPayable, color: 'var(--color-warning)' },
  ] : []

  // Chart calculations
  const maxChartValue = Math.max(...chartData.map(d => Math.max(d.income, d.expenses)), 1)

  // Expense breakdown max
  const maxExpense = Math.max(...expenseBreakdown.map(e => e.amount), 1)

  const txnColumns: TableColumn<JournalEntry>[] = [
    { key: 'date', header: 'Date', width: '100px', render: (t) => formatDate(t.date) },
    { key: 'description', header: 'Description' },
    {
      key: 'type', header: 'Type', width: '90px',
      render: (t) => (
        <Badge variant={t.type === 'income' ? 'success' : t.type === 'expense' ? 'error' : 'info'} size="sm">
          {t.type}
        </Badge>
      ),
    },
    {
      key: 'totalAmount', header: 'Amount', width: '110px', align: 'right',
      render: (t) => (
        <span style={{ color: t.type === 'income' ? 'var(--color-success)' : t.type === 'expense' ? 'var(--color-error)' : 'var(--text-primary)', fontWeight: 'var(--font-weight-medium)' as any }}>
          {formatMoney(t.totalAmount)}
        </span>
      ),
    },
  ]

  const barColors = ['var(--color-primary)', 'var(--color-info)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-error)', '#9333EA', '#EC4899', '#14B8A6']

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        {kpis.map((kpi) => (
          <Card key={kpi.label} padding="sm">
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>
              {kpi.label}
            </div>
            <div
              style={{
                fontSize: 'var(--font-size-xl)',
                fontWeight: 'var(--font-weight-bold)' as any,
                color: kpi.color,
                lineHeight: 'var(--line-height-tight)',
              }}
            >
              {formatMoney(kpi.value)}
            </div>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <Button size="sm" onClick={() => onNewTransaction('income')}>+ Income</Button>
        <Button size="sm" variant="secondary" onClick={() => onNewTransaction('expense')}>+ Expense</Button>
        <Button size="sm" variant="secondary" onClick={() => onNavigate('invoices')}>+ Invoice</Button>
      </div>

      {/* Charts Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        {/* Income vs Expense Chart */}
        <Card padding="sm">
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
            Income vs Expenses (6 Months)
          </div>
          {chartData.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', textAlign: 'center', padding: 'var(--space-6) 0' }}>No data yet</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)', height: 160, padding: '0 var(--space-1)' }}>
              {chartData.map((d) => (
                <div key={d.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 130, width: '100%' }}>
                    {/* Income bar */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                      {d.income > 0 && (
                        <span style={{ fontSize: '9px', color: 'var(--color-success)', marginBottom: 2 }}>
                          {d.income >= 1000 ? `${(d.income / 1000).toFixed(0)}k` : d.income.toFixed(0)}
                        </span>
                      )}
                      <div
                        style={{
                          width: '100%',
                          height: `${Math.max((d.income / maxChartValue) * 110, d.income > 0 ? 4 : 0)}px`,
                          backgroundColor: 'var(--color-success)',
                          borderRadius: '2px 2px 0 0',
                          minWidth: 8,
                        }}
                      />
                    </div>
                    {/* Expense bar */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                      {d.expenses > 0 && (
                        <span style={{ fontSize: '9px', color: 'var(--color-error)', marginBottom: 2 }}>
                          {d.expenses >= 1000 ? `${(d.expenses / 1000).toFixed(0)}k` : d.expenses.toFixed(0)}
                        </span>
                      )}
                      <div
                        style={{
                          width: '100%',
                          height: `${Math.max((d.expenses / maxChartValue) * 110, d.expenses > 0 ? 4 : 0)}px`,
                          backgroundColor: 'var(--color-error)',
                          borderRadius: '2px 2px 0 0',
                          minWidth: 8,
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: 2 }}>{d.month}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', marginTop: 'var(--space-2)' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: 'var(--color-success)', display: 'inline-block' }} /> Income
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: 'var(--color-error)', display: 'inline-block' }} /> Expenses
            </span>
          </div>
        </Card>

        {/* Expense Breakdown */}
        <Card padding="sm">
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
            Expense Breakdown
          </div>
          {expenseBreakdown.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', textAlign: 'center', padding: 'var(--space-6) 0' }}>No expenses yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {expenseBreakdown.slice(0, 8).map((item, idx) => (
                <div key={item.category} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <div style={{ width: 80, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {item.category}
                  </div>
                  <div style={{ flex: 1, height: 16, backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${(item.amount / maxExpense) * 100}%`,
                        backgroundColor: barColors[idx % barColors.length],
                        borderRadius: 'var(--radius-sm)',
                        minWidth: item.amount > 0 ? 4 : 0,
                      }}
                    />
                  </div>
                  <div style={{ width: 70, fontSize: 'var(--font-size-xs)', color: 'var(--text-primary)', textAlign: 'right', flexShrink: 0 }}>
                    {formatMoney(item.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Bottom Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'var(--space-3)',
        }}
      >
        {/* Recent Transactions */}
        <Card padding="sm">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)' }}>
              Recent Transactions
            </div>
            <Button size="sm" variant="ghost" onClick={() => onNavigate('transactions')}>View All</Button>
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)' }}>
            <Table
              columns={txnColumns}
              data={recentTxns}
              emptyMessage="No transactions yet"
              rowKey={(t) => t.id}
            />
          </div>
        </Card>

        {/* Overdue Items */}
        <Card padding="sm">
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
            Overdue Items
          </div>
          {overdueInvoices.length === 0 && overdueBills.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', textAlign: 'center', padding: 'var(--space-4) 0' }}>
              No overdue items
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {overdueInvoices.map((inv) => (
                <div
                  key={`inv-${inv.id}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 'var(--space-2)',
                    backgroundColor: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--font-size-xs)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Badge variant="error" size="sm">Invoice</Badge>
                    <span style={{ color: 'var(--text-primary)' }}>{inv.customerName}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Due {formatDate(inv.dueDate)}</span>
                    <span style={{ color: 'var(--color-error)', fontWeight: 'var(--font-weight-medium)' as any }}>{formatMoney(inv.balanceDue)}</span>
                  </div>
                </div>
              ))}
              {overdueBills.map((bill) => (
                <div
                  key={`bill-${bill.id}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 'var(--space-2)',
                    backgroundColor: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--font-size-xs)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Badge variant="warning" size="sm">Bill</Badge>
                    <span style={{ color: 'var(--text-primary)' }}>{bill.vendorName}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Due {formatDate(bill.dueDate)}</span>
                    <span style={{ color: 'var(--color-error)', fontWeight: 'var(--font-weight-medium)' as any }}>{formatMoney(bill.balanceDue)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
