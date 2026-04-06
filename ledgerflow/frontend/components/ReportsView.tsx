import { useState } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { ProfitLossReport, BalanceSheetReport, TrialBalanceReport } from '../types'
import { Card, Button, Input, Table, Tabs, TabList, Tab, TabPanel, EmptyState } from './ui'
import type { TableColumn } from './ui'
import { toast } from 'react-toastify'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function firstOfYear(): string {
  const y = new Date().getFullYear()
  return `${y}-01-01`
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

interface ReportsViewProps {
  controller: AppController
}

export function ReportsView({ controller }: ReportsViewProps) {
  // P&L
  const [plFrom, setPlFrom] = useState(firstOfYear())
  const [plTo, setPlTo] = useState(todayStr())
  const [plReport, setPlReport] = useState<ProfitLossReport | null>(null)
  const [plLoading, setPlLoading] = useState(false)

  // Balance Sheet
  const [bsDate, setBsDate] = useState(todayStr())
  const [bsReport, setBsReport] = useState<BalanceSheetReport | null>(null)
  const [bsLoading, setBsLoading] = useState(false)

  // Trial Balance
  const [tbFrom, setTbFrom] = useState(firstOfYear())
  const [tbTo, setTbTo] = useState(todayStr())
  const [tbReport, setTbReport] = useState<TrialBalanceReport | null>(null)
  const [tbLoading, setTbLoading] = useState(false)

  useAgentAware('ReportsView', { hasPlReport: !!plReport, hasBsReport: !!bsReport, hasTbReport: !!tbReport })

  const generatePL = async () => {
    setPlLoading(true)
    try {
      const report = await controller.getProfitLoss(plFrom, plTo)
      setPlReport(report)
    } catch { toast.error('Failed to generate P&L report') }
    finally { setPlLoading(false) }
  }

  const generateBS = async () => {
    setBsLoading(true)
    try {
      const report = await controller.getBalanceSheet(bsDate)
      setBsReport(report)
    } catch { toast.error('Failed to generate balance sheet') }
    finally { setBsLoading(false) }
  }

  const generateTB = async () => {
    setTbLoading(true)
    try {
      const report = await controller.getTrialBalance(tbFrom, tbTo)
      setTbReport(report)
    } catch { toast.error('Failed to generate trial balance') }
    finally { setTbLoading(false) }
  }

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)' as any,
    color: 'var(--text-primary)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    padding: 'var(--space-2) 0',
    borderBottom: '1px solid var(--border-primary)',
  }

  const lineStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    padding: 'var(--space-1) 0',
    fontSize: 'var(--font-size-sm)',
  }

  const totalStyle: React.CSSProperties = {
    ...lineStyle,
    fontWeight: 'var(--font-weight-bold)' as any,
    borderTop: '2px solid var(--border-primary)',
    paddingTop: 'var(--space-2)',
    marginTop: 'var(--space-1)',
  }

  const tbColumns: TableColumn<{ accountName: string; accountCode: string; accountType: string; debit: number; credit: number }>[] = [
    { key: 'accountCode', header: 'Code', width: '80px', render: (r) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{r.accountCode}</span> },
    { key: 'accountName', header: 'Account' },
    { key: 'accountType', header: 'Type', width: '90px', render: (r) => <span style={{ color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{r.accountType}</span> },
    {
      key: 'debit', header: 'Debit', width: '110px', align: 'right',
      render: (r) => r.debit > 0 ? <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(r.debit)}</span> : <span style={{ color: 'var(--text-muted)' }}>-</span>,
    },
    {
      key: 'credit', header: 'Credit', width: '110px', align: 'right',
      render: (r) => r.credit > 0 ? <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(r.credit)}</span> : <span style={{ color: 'var(--text-muted)' }}>-</span>,
    },
  ]

  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
        Financial Reports
      </h2>

      <Tabs defaultTab="pl">
        <TabList>
          <Tab id="pl">Profit & Loss</Tab>
          <Tab id="bs">Balance Sheet</Tab>
          <Tab id="tb">Trial Balance</Tab>
        </TabList>

        {/* Profit & Loss */}
        <TabPanel id="pl">
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', marginBottom: 'var(--space-3)' }}>
            <div style={{ minWidth: 140 }}>
              <Input label="From" type="date" value={plFrom} onChange={e => setPlFrom(e.target.value)} />
            </div>
            <div style={{ minWidth: 140 }}>
              <Input label="To" type="date" value={plTo} onChange={e => setPlTo(e.target.value)} />
            </div>
            <Button size="sm" onClick={generatePL} loading={plLoading}>Generate</Button>
          </div>

          {plLoading && <EmptyState message="Generating report..." />}
          {!plLoading && !plReport && <EmptyState message="Select date range and click Generate" />}
          {plReport && (
            <Card padding="md">
              <div style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}>
                <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any }}>Profit & Loss Statement</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{plReport.fromDate} to {plReport.toDate}</div>
              </div>

              {/* Revenue */}
              <div style={sectionHeaderStyle}>REVENUE</div>
              {plReport.revenue.map((item) => (
                <div key={item.accountCode} style={lineStyle}>
                  <span style={{ color: 'var(--text-secondary)' }}>{item.accountCode} - {item.accountName}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-success)' }}>{formatMoney(item.amount)}</span>
                </div>
              ))}
              {plReport.revenue.length === 0 && <div style={{ ...lineStyle, color: 'var(--text-muted)' }}>No revenue accounts</div>}
              <div style={totalStyle}>
                <span>Total Revenue</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-success)' }}>{formatMoney(plReport.totalRevenue)}</span>
              </div>

              <div style={{ height: 'var(--space-4)' }} />

              {/* Expenses */}
              <div style={sectionHeaderStyle}>EXPENSES</div>
              {plReport.expenses.map((item) => (
                <div key={item.accountCode} style={lineStyle}>
                  <span style={{ color: 'var(--text-secondary)' }}>{item.accountCode} - {item.accountName}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-error)' }}>{formatMoney(item.amount)}</span>
                </div>
              ))}
              {plReport.expenses.length === 0 && <div style={{ ...lineStyle, color: 'var(--text-muted)' }}>No expense accounts</div>}
              <div style={totalStyle}>
                <span>Total Expenses</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-error)' }}>{formatMoney(plReport.totalExpenses)}</span>
              </div>

              <div style={{ height: 'var(--space-4)' }} />

              {/* Net Income */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: 'var(--space-3)',
                backgroundColor: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-lg)',
                fontWeight: 'var(--font-weight-bold)' as any,
              }}>
                <span>NET INCOME</span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  color: plReport.netIncome >= 0 ? 'var(--color-success)' : 'var(--color-error)',
                }}>
                  {formatMoney(plReport.netIncome)}
                </span>
              </div>
            </Card>
          )}
        </TabPanel>

        {/* Balance Sheet */}
        <TabPanel id="bs">
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', marginBottom: 'var(--space-3)' }}>
            <div style={{ minWidth: 140 }}>
              <Input label="As of Date" type="date" value={bsDate} onChange={e => setBsDate(e.target.value)} />
            </div>
            <Button size="sm" onClick={generateBS} loading={bsLoading}>Generate</Button>
          </div>

          {bsLoading && <EmptyState message="Generating report..." />}
          {!bsLoading && !bsReport && <EmptyState message="Select date and click Generate" />}
          {bsReport && (
            <Card padding="md">
              <div style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}>
                <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any }}>Balance Sheet</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>As of {bsReport.asOf}</div>
              </div>

              {/* Assets */}
              <div style={sectionHeaderStyle}>ASSETS</div>
              {bsReport.assets.accounts.map((item) => (
                <div key={item.accountCode} style={lineStyle}>
                  <span style={{ color: 'var(--text-secondary)' }}>{item.accountCode} - {item.accountName}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(item.balance)}</span>
                </div>
              ))}
              <div style={totalStyle}>
                <span>Total Assets</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(bsReport.assets.total)}</span>
              </div>

              <div style={{ height: 'var(--space-3)' }} />

              {/* Liabilities */}
              <div style={sectionHeaderStyle}>LIABILITIES</div>
              {bsReport.liabilities.accounts.map((item) => (
                <div key={item.accountCode} style={lineStyle}>
                  <span style={{ color: 'var(--text-secondary)' }}>{item.accountCode} - {item.accountName}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(item.balance)}</span>
                </div>
              ))}
              <div style={totalStyle}>
                <span>Total Liabilities</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(bsReport.liabilities.total)}</span>
              </div>

              <div style={{ height: 'var(--space-3)' }} />

              {/* Equity */}
              <div style={sectionHeaderStyle}>EQUITY</div>
              {bsReport.equity.accounts.map((item) => (
                <div key={item.accountCode} style={lineStyle}>
                  <span style={{ color: 'var(--text-secondary)' }}>{item.accountCode} - {item.accountName}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(item.balance)}</span>
                </div>
              ))}
              <div style={totalStyle}>
                <span>Total Equity</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(bsReport.equity.total)}</span>
              </div>

              <div style={{ height: 'var(--space-3)' }} />

              {/* Verification */}
              {(() => {
                const lPlusE = bsReport.liabilities.total + bsReport.equity.total
                const balanced = Math.abs(bsReport.assets.total - lPlusE) < 0.01
                return (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 'var(--space-3)',
                    backgroundColor: balanced ? 'var(--color-success-light)' : 'var(--color-error-light)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--font-size-sm)',
                  }}>
                    <span>Assets = Liabilities + Equity</span>
                    <span style={{ fontWeight: 'var(--font-weight-bold)' as any }}>
                      {formatMoney(bsReport.assets.total)} {balanced ? '=' : '!='} {formatMoney(lPlusE)}
                      {balanced ? ' (Balanced)' : ' (UNBALANCED)'}
                    </span>
                  </div>
                )
              })()}
            </Card>
          )}
        </TabPanel>

        {/* Trial Balance */}
        <TabPanel id="tb">
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', marginBottom: 'var(--space-3)' }}>
            <div style={{ minWidth: 140 }}>
              <Input label="From" type="date" value={tbFrom} onChange={e => setTbFrom(e.target.value)} />
            </div>
            <div style={{ minWidth: 140 }}>
              <Input label="To" type="date" value={tbTo} onChange={e => setTbTo(e.target.value)} />
            </div>
            <Button size="sm" onClick={generateTB} loading={tbLoading}>Generate</Button>
          </div>

          {tbLoading && <EmptyState message="Generating report..." />}
          {!tbLoading && !tbReport && <EmptyState message="Select date range and click Generate" />}
          {tbReport && (
            <Card padding="none">
              <div style={{ textAlign: 'center', padding: 'var(--space-3)' }}>
                <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any }}>Trial Balance</div>
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)' }}>
                <Table
                  columns={tbColumns}
                  data={tbReport.accounts}
                  emptyMessage="No accounts with activity"
                  rowKey={(r, i) => `${r.accountCode}-${i}`}
                />
              </div>
              {/* Totals row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '80px 1fr 90px 110px 110px',
                padding: 'var(--space-3)',
                borderTop: '2px solid var(--border-primary)',
                fontWeight: 'var(--font-weight-bold)' as any,
                fontSize: 'var(--font-size-sm)',
              }}>
                <span />
                <span>TOTALS</span>
                <span />
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatMoney(tbReport.totalDebits)}</span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatMoney(tbReport.totalCredits)}</span>
              </div>
              {/* Verification */}
              {(() => {
                const balanced = Math.abs(tbReport.totalDebits - tbReport.totalCredits) < 0.01
                return (
                  <div style={{
                    padding: 'var(--space-2) var(--space-3)',
                    backgroundColor: balanced ? 'var(--color-success-light)' : 'var(--color-error-light)',
                    fontSize: 'var(--font-size-xs)',
                    textAlign: 'center',
                    borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
                  }}>
                    {balanced ? 'Debits = Credits (Balanced)' : `UNBALANCED: Debits ${formatMoney(tbReport.totalDebits)} != Credits ${formatMoney(tbReport.totalCredits)}`}
                  </div>
                )
              })()}
            </Card>
          )}
        </TabPanel>
      </Tabs>
    </div>
  )
}
