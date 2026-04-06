import { useState, useEffect, useCallback } from 'react'
import { Button, Card, Table, Badge, Textarea, Alert, EmptyState } from '../ui'
import type { AppController } from '../../AppController'
import type { AppState, ImportJob } from '../../types'

const BACKEND_URL = 'http://localhost:3113/api'

interface ImportExportPageProps {
  controller: AppController
  state: AppState
}

export function ImportExportPage({ controller }: ImportExportPageProps) {
  const [importData, setImportData] = useState('')
  const [importing, setImporting] = useState(false)
  const [exportingContacts, setExportingContacts] = useState(false)
  const [exportingDeals, setExportingDeals] = useState(false)
  const [importHistory, setImportHistory] = useState<ImportJob[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await fetch(`${BACKEND_URL}/import/jobs`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setImportHistory(Array.isArray(data) ? data : data.items || [])
    } catch {
      // History endpoint may not exist, that's ok
      setImportHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const handleImport = async () => {
    setImportError(null)
    if (!importData.trim()) {
      showToast('Please paste JSON data to import')
      return
    }
    let parsed: unknown[]
    try {
      parsed = JSON.parse(importData)
      if (!Array.isArray(parsed)) {
        setImportError('Data must be a JSON array of objects')
        return
      }
    } catch {
      setImportError('Invalid JSON format')
      return
    }
    setImporting(true)
    try {
      const result = await controller.importContacts({ data: parsed as Array<Record<string, unknown>> })
      showToast(`Imported ${result.importedRows} of ${result.totalRows} rows`)
      setImportData('')
      loadHistory()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed'
      setImportError(msg)
      showToast('Import failed')
    } finally {
      setImporting(false)
    }
  }

  const handleExportContacts = async () => {
    setExportingContacts(true)
    try {
      await controller.exportContacts()
      showToast('Contacts exported')
    } catch {
      showToast('Export failed')
    } finally {
      setExportingContacts(false)
    }
  }

  const handleExportDeals = async () => {
    setExportingDeals(true)
    try {
      const res = await fetch(`${BACKEND_URL}/export/deals`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'deals_export.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      showToast('Deals exported')
    } catch {
      showToast('Deals export failed')
    } finally {
      setExportingDeals(false)
    }
  }

  const historyColumns = [
    {
      key: 'entityType',
      header: 'Entity',
      render: (j: ImportJob) => <Badge variant="default">{j.entityType}</Badge>,
    },
    {
      key: 'fileName',
      header: 'Source',
      render: (j: ImportJob) => j.fileName || 'JSON Import',
    },
    {
      key: 'status',
      header: 'Status',
      render: (j: ImportJob) => {
        const v = j.status === 'completed' ? 'success' : j.status === 'failed' ? 'error' : 'warning'
        return <Badge variant={v as any} dot>{j.status}</Badge>
      },
    },
    {
      key: 'imported',
      header: 'Imported',
      render: (j: ImportJob) => `${j.importedRows} / ${j.totalRows}`,
    },
    {
      key: 'skipped',
      header: 'Skipped',
      render: (j: ImportJob) => j.skippedRows,
    },
    {
      key: 'createdAt',
      header: 'Date',
      render: (j: ImportJob) =>
        j.createdAt ? new Date(j.createdAt).toLocaleString() : '--',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 9999,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-primary)',
          }}
        >
          {toast}
        </div>
      )}

      <h1 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any }}>
        Import / Export
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        {/* Import Section */}
        <Card>
          <h3 style={{ margin: 0, marginBottom: 'var(--space-3)', fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any }}>
            Import Contacts
          </h3>
          <p style={{ margin: 0, marginBottom: 'var(--space-3)', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            Paste a JSON array of contact objects. Each object should have at least firstName and lastName.
          </p>
          {importError && (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <Alert variant="error" onClose={() => setImportError(null)}>
                {importError}
              </Alert>
            </div>
          )}
          <Textarea
            value={importData}
            onChange={(e) => setImportData(e.target.value)}
            rows={10}
            placeholder={`[\n  { "firstName": "John", "lastName": "Doe", "email": "john@example.com" },\n  { "firstName": "Jane", "lastName": "Smith", "email": "jane@example.com" }\n]`}
          />
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button onClick={handleImport} loading={importing}>
              Import
            </Button>
          </div>
        </Card>

        {/* Export Section */}
        <Card>
          <h3 style={{ margin: 0, marginBottom: 'var(--space-3)', fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any }}>
            Export Data
          </h3>
          <p style={{ margin: 0, marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            Download your CRM data as CSV files.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <Button
              variant="secondary"
              onClick={handleExportContacts}
              loading={exportingContacts}
              fullWidth
            >
              Export Contacts CSV
            </Button>
            <Button
              variant="secondary"
              onClick={handleExportDeals}
              loading={exportingDeals}
              fullWidth
            >
              Export Deals CSV
            </Button>
          </div>
        </Card>
      </div>

      {/* Import History */}
      <Card padding="none">
        <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any }}>
            Import History
          </h3>
        </div>
        <div style={{ padding: 'var(--space-3) 0 0' }}>
          {loadingHistory ? (
            <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading...
            </div>
          ) : importHistory.length === 0 ? (
            <EmptyState message="No import history" />
          ) : (
            <Table columns={historyColumns} data={importHistory} rowKey={(j) => j.id} />
          )}
        </div>
      </Card>
    </div>
  )
}
