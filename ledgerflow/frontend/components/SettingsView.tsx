import { useState, useEffect } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { Settings, Account } from '../types'
import { Card, Button, Input, Select, Alert, EmptyState } from './ui'
import type { SelectOption } from './ui'
import { toast } from 'react-toastify'

const currencyOptions: SelectOption[] = [
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - British Pound' },
  { value: 'MYR', label: 'MYR - Malaysian Ringgit' },
  { value: 'SGD', label: 'SGD - Singapore Dollar' },
  { value: 'AUD', label: 'AUD - Australian Dollar' },
  { value: 'CAD', label: 'CAD - Canadian Dollar' },
  { value: 'JPY', label: 'JPY - Japanese Yen' },
  { value: 'CNY', label: 'CNY - Chinese Yuan' },
  { value: 'INR', label: 'INR - Indian Rupee' },
]

const monthOptions: SelectOption[] = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' }, { value: '3', label: 'March' },
  { value: '4', label: 'April' }, { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' }, { value: '9', label: 'September' },
  { value: '10', label: 'October' }, { value: '11', label: 'November' }, { value: '12', label: 'December' },
]

interface SettingsViewProps {
  controller: AppController
}

export function SettingsView({ controller }: SettingsViewProps) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedResult, setSeedResult] = useState<string | null>(null)

  // Form
  const [businessName, setBusinessName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [fiscalYearStart, setFiscalYearStart] = useState('1')
  const [defaultTaxRate, setDefaultTaxRate] = useState('0')

  useAgentAware('SettingsView', { loading, hasSettings: !!settings })

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [s, accts] = await Promise.all([
          controller.getSettings(),
          controller.getAccounts(),
        ])
        setSettings(s)
        setAccounts(accts)
        setBusinessName(s.businessName || '')
        setCurrency(s.currency || 'USD')
        setFiscalYearStart(String(s.fiscalYearStart || 1))
        setDefaultTaxRate(String(s.defaultTaxRate || 0))
      } catch {
        toast.error('Failed to load settings')
      } finally { setLoading(false) }
    }
    load()
  }, [controller])

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await controller.updateSettings({
        businessName,
        currency,
        fiscalYearStart: parseInt(fiscalYearStart),
        defaultTaxRate: parseFloat(defaultTaxRate) || 0,
      })
      setSettings(updated)
      toast.success('Settings saved')
    } catch (e: any) {
      toast.error(e.message || 'Failed to save settings')
    } finally { setSaving(false) }
  }

  const handleSeed = async () => {
    setSeeding(true)
    setSeedResult(null)
    try {
      const result = await controller.seedAccounts()
      setSeedResult(`Successfully created ${result.count} default accounts.`)
      const accts = await controller.getAccounts()
      setAccounts(accts)
      toast.success('Default accounts seeded')
    } catch (e: any) {
      toast.error(e.message || 'Failed to seed accounts')
    } finally { setSeeding(false) }
  }

  if (loading) return <EmptyState message="Loading settings..." />

  return (
    <div style={{ maxWidth: 600 }}>
      <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
        Settings
      </h2>

      {/* Business Settings */}
      <Card padding="md" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
          Business Settings
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Input label="Business Name" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="My Business" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <Select label="Currency" options={currencyOptions} value={currency} onChange={e => setCurrency(e.target.value)} />
            <Select label="Fiscal Year Start" options={monthOptions} value={fiscalYearStart} onChange={e => setFiscalYearStart(e.target.value)} />
          </div>
          <Input label="Default Tax Rate (%)" type="number" step="0.01" min="0" max="100" value={defaultTaxRate} onChange={e => setDefaultTaxRate(e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={handleSave} loading={saving}>Save Settings</Button>
          </div>
        </div>
      </Card>

      {/* Chart of Accounts Seed */}
      <Card padding="md">
        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
          Chart of Accounts Seed
        </div>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
          Seed default chart of accounts with standard asset, liability, equity, revenue, and expense accounts.
        </p>
        {seedResult && (
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <Alert variant="success">{seedResult}</Alert>
          </div>
        )}
        <Button
          variant="secondary"
          onClick={handleSeed}
          loading={seeding}
          disabled={accounts.length > 0}
        >
          Seed Default Accounts
        </Button>
        {accounts.length > 0 && (
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
            {accounts.length} accounts already exist. Seeding is only available when no accounts are present.
          </p>
        )}
      </Card>
    </div>
  )
}
