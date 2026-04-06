import { useEffect, useState, useCallback } from 'react'
import { Card, Button, Input, Select, Table, Badge, Modal, EmptyState } from '../ui'
import { XIcon } from '../Icons'
import type { TableColumn } from '../ui'
import type { AppController } from '../../AppController'
import type { AppState, Company, Contact, Deal } from '../../types'

interface CompaniesPageProps {
  controller: AppController
}

const INDUSTRY_OPTIONS = [
  { value: '', label: 'All Industries' },
  { value: 'technology', label: 'Technology' },
  { value: 'finance', label: 'Finance' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'retail', label: 'Retail' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'education', label: 'Education' },
  { value: 'media', label: 'Media' },
  { value: 'other', label: 'Other' },
]

const SIZE_OPTIONS = [
  { value: '', label: 'Select Size' },
  { value: '1-10', label: '1-10' },
  { value: '11-50', label: '11-50' },
  { value: '51-200', label: '51-200' },
  { value: '201-500', label: '201-500' },
  { value: '501-1000', label: '501-1000' },
  { value: '1001+', label: '1001+' },
]

// ============================================================================
// Company Detail Panel
// ============================================================================

function CompanyDetailPanel({
  company,
  controller,
  onClose,
}: {
  company: Company
  controller: AppController
  onClose: () => void
}) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [loadingRelated, setLoadingRelated] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoadingRelated(true)
      try {
        const [contactsRes, dealsRes] = await Promise.all([
          controller.fetchContacts({ companyId: company.id, perPage: 50 }),
          controller.fetchDeals({ companyId: company.id, perPage: 50 }),
        ])
        if (!cancelled) {
          setContacts(contactsRes.items)
          setDeals(dealsRes.items)
        }
      } catch (err) {
        console.error('[CompanyDetail] Failed to load related data:', err)
      } finally {
        if (!cancelled) setLoadingRelated(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [company.id, controller])

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 440,
        backgroundColor: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-primary)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.2)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--border-primary)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)' }}>
          {company.name}
        </h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <XIcon size={14} />
        </Button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <InfoRow label="Industry" value={company.industry} />
          <InfoRow label="Size" value={company.size} />
          <InfoRow label="Website" value={company.website} />
          <InfoRow label="Phone" value={company.phone} />
          <InfoRow label="Domain" value={company.domain} />
          <InfoRow label="Revenue" value={company.annualRevenue != null ? `$${company.annualRevenue.toLocaleString()}` : null} />
          <InfoRow label="City" value={company.city} />
          <InfoRow label="Country" value={company.country} />
          {company.description && (
            <div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
                Description
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                {company.description}
              </div>
            </div>
          )}
        </div>

        {/* Contacts List */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h4 style={{ margin: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', fontWeight: 600 }}>
            Contacts ({contacts.length})
          </h4>
          {loadingRelated ? (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>Loading...</div>
          ) : contacts.length === 0 ? (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>No contacts</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {contacts.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 'var(--space-2)',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-primary)',
                    fontSize: 'var(--font-size-sm)',
                  }}
                >
                  <span style={{ color: 'var(--text-primary)' }}>
                    {c.firstName} {c.lastName}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>{c.jobTitle || ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Deals List */}
        <div>
          <h4 style={{ margin: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', fontWeight: 600 }}>
            Deals ({deals.length})
          </h4>
          {loadingRelated ? (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>Loading...</div>
          ) : deals.length === 0 ? (
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>No deals</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {deals.map((d) => (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 'var(--space-2)',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-primary)',
                    fontSize: 'var(--font-size-sm)',
                  }}
                >
                  <span style={{ color: 'var(--text-primary)' }}>{d.title}</span>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <Badge variant="primary" size="sm">{d.stageName || 'Unknown'}</Badge>
                    <span style={{ color: 'var(--color-success)', fontWeight: 500 }}>
                      ${d.value.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', width: 90, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

// ============================================================================
// New Company Modal
// ============================================================================

function NewCompanyModal({
  open,
  onClose,
  controller,
}: {
  open: boolean
  onClose: () => void
  controller: AppController
}) {
  const [form, setForm] = useState({
    name: '',
    industry: '',
    size: '',
    website: '',
    phone: '',
    domain: '',
    description: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError('Company name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await controller.createCompany({
        name: form.name.trim(),
        industry: form.industry || undefined,
        size: form.size || undefined,
        website: form.website.trim() || undefined,
        phone: form.phone.trim() || undefined,
        domain: form.domain.trim() || undefined,
        description: form.description.trim() || undefined,
      } as any)
      setForm({ name: '', industry: '', size: '', website: '', phone: '', domain: '', description: '' })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create company')
    } finally {
      setSaving(false)
    }
  }

  const industryFormOptions = INDUSTRY_OPTIONS.filter((o) => o.value !== '')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Company"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} loading={saving}>Create Company</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {error && (
          <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>{error}</div>
        )}
        <Input
          label="Company Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Acme Inc."
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <Select
            label="Industry"
            options={[{ value: '', label: 'Select Industry' }, ...industryFormOptions]}
            value={form.industry}
            onChange={(e) => setForm({ ...form, industry: e.target.value })}
          />
          <Select
            label="Size"
            options={SIZE_OPTIONS}
            value={form.size}
            onChange={(e) => setForm({ ...form, size: e.target.value })}
          />
        </div>
        <Input
          label="Website"
          value={form.website}
          onChange={(e) => setForm({ ...form, website: e.target.value })}
          placeholder="https://example.com"
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <Input
            label="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+1 555-0100"
          />
          <Input
            label="Domain"
            value={form.domain}
            onChange={(e) => setForm({ ...form, domain: e.target.value })}
            placeholder="example.com"
          />
        </div>
      </div>
    </Modal>
  )
}

// ============================================================================
// Companies Page
// ============================================================================

export function CompaniesPage({ controller }: CompaniesPageProps) {
  const [state, setState] = useState<AppState>(controller.getState())
  const [search, setSearch] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = controller.subscribe(setState)
    return unsub
  }, [controller])

  const loadCompanies = useCallback(async () => {
    setLoading(true)
    try {
      await controller.fetchCompanies({
        page,
        perPage: 20,
        search: search || undefined,
        industry: industryFilter || undefined,
      })
    } catch (err) {
      console.error('[CompaniesPage] Failed to load companies:', err)
    } finally {
      setLoading(false)
    }
  }, [controller, page, search, industryFilter])

  useEffect(() => {
    loadCompanies()
  }, [loadCompanies])

  const companies = state.companies
  const items = companies?.items || []

  const handleSearch = () => {
    setPage(1)
    loadCompanies()
  }

  const handleRowClick = async (company: Company) => {
    try {
      await controller.getCompany(company.id)
    } catch (err) {
      console.error('[CompaniesPage] Failed to get company:', err)
    }
  }

  const handleCloseDetail = () => {
    controller.setState({ selectedCompany: null }, false)
  }

  const columns: TableColumn<Company>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => <span style={{ fontWeight: 500 }}>{c.name}</span>,
    },
    {
      key: 'industry',
      header: 'Industry',
      render: (c) => c.industry || '\u2014',
    },
    {
      key: 'size',
      header: 'Size',
      render: (c) => c.size || '\u2014',
    },
    {
      key: 'contactCount',
      header: 'Contacts',
      align: 'center',
      render: (c) => <span>{c.contactCount}</span>,
    },
    {
      key: 'dealCount',
      header: 'Deals',
      align: 'center',
      render: (c) => <span>{c.dealCount}</span>,
    },
  ]

  return (
    <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)' }}>
          Companies
          {companies && (
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginLeft: 'var(--space-2)' }}>
              ({companies.total})
            </span>
          )}
        </h2>
        <Button onClick={() => controller.setState({ showCompanyForm: true }, false)}>
          New Company
        </Button>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, maxWidth: 320 }}>
          <Input
            placeholder="Search companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <div style={{ width: 180 }}>
          <Select
            options={INDUSTRY_OPTIONS}
            value={industryFilter}
            onChange={(e) => {
              setIndustryFilter(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={handleSearch}>
          Search
        </Button>
      </div>

      {/* Table */}
      <Card padding="none">
        {loading ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading companies...
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No companies found"
            message="Create your first company to get started"
            action={
              <Button onClick={() => controller.setState({ showCompanyForm: true }, false)}>
                New Company
              </Button>
            }
          />
        ) : (
          <Table
            columns={columns}
            data={items}
            onRowClick={handleRowClick}
            rowKey={(c) => c.id}
          />
        )}
      </Card>

      {/* Pagination */}
      {companies && companies.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            Page {companies.page} of {companies.pages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= companies.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* Detail Panel */}
      {state.selectedCompany && (
        <CompanyDetailPanel
          company={state.selectedCompany}
          controller={controller}
          onClose={handleCloseDetail}
        />
      )}

      {/* New Company Modal */}
      <NewCompanyModal
        open={state.showCompanyForm}
        onClose={() => controller.setState({ showCompanyForm: false }, false)}
        controller={controller}
      />
    </div>
  )
}
