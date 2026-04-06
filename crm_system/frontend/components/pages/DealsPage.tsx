import { useEffect, useState, useCallback, DragEvent } from 'react'
import { Card, Button, Input, Select, Table, Badge, Modal, EmptyState } from '../ui'
import type { TableColumn } from '../ui'
import type { AppController } from '../../AppController'
import type { AppState, Deal, DealBrief, PipelineStage, Company } from '../../types'

interface DealsPageProps {
  controller: AppController
}

type ViewMode = 'kanban' | 'table'

const priorityBadge = (p: string) => {
  const map: Record<string, 'info' | 'warning' | 'error' | 'default'> = {
    low: 'info',
    medium: 'warning',
    high: 'error',
  }
  return map[p] || 'default'
}

// ============================================================================
// Kanban Deal Card
// ============================================================================

function DealCard({
  deal,
  onClick,
  onDragStart,
}: {
  deal: DealBrief
  onClick: () => void
  onDragStart: (e: DragEvent) => void
}) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        padding: 'var(--space-3)',
        backgroundColor: isHovered ? 'var(--bg-primary)' : 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-md)',
        cursor: 'grab',
        transition: 'background-color 0.15s',
        marginBottom: 'var(--space-2)',
      }}
    >
      <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 'var(--space-1)' }}>
        {deal.title}
      </div>
      {deal.companyName && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
          {deal.companyName}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-success)' }}>
          ${deal.value.toLocaleString()}
        </span>
        <Badge variant={priorityBadge(deal.priority)} size="sm">
          {deal.priority}
        </Badge>
      </div>
    </div>
  )
}

// ============================================================================
// Kanban Column
// ============================================================================

function KanbanColumn({
  stage,
  onDealClick,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  stage: PipelineStage
  onDealClick: (dealId: number) => void
  onDragStart: (e: DragEvent, dealId: number, stageId: number) => void
  onDragOver: (e: DragEvent) => void
  onDrop: (e: DragEvent, stageId: number) => void
}) {
  const [isDragOver, setIsDragOver] = useState(false)
  const headerColor = stage.color || 'var(--color-primary)'

  return (
    <div
      style={{
        minWidth: 280,
        maxWidth: 300,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: isDragOver ? 'var(--bg-primary)' : 'transparent',
        borderRadius: 'var(--radius-md)',
        transition: 'background-color 0.15s',
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragOver(true)
        onDragOver(e)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        setIsDragOver(false)
        onDrop(e, stage.id)
      }}
    >
      {/* Column Header */}
      <div
        style={{
          padding: 'var(--space-3)',
          borderBottom: `3px solid ${headerColor}`,
          marginBottom: 'var(--space-2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            {stage.name}
          </span>
          <Badge variant="default" size="sm">
            {stage.dealCount}
          </Badge>
        </div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
          ${stage.totalValue.toLocaleString()}
        </div>
      </div>

      {/* Cards */}
      <div style={{ flex: 1, minHeight: 100, padding: '0 var(--space-1)' }}>
        {stage.deals.length === 0 ? (
          <div
            style={{
              padding: 'var(--space-4)',
              textAlign: 'center',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-muted)',
              border: '2px dashed var(--border-primary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            No deals
          </div>
        ) : (
          stage.deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              onClick={() => onDealClick(deal.id)}
              onDragStart={(e) => onDragStart(e, deal.id, stage.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Kanban View
// ============================================================================

function KanbanView({
  pipeline,
  controller,
  onDealClick,
}: {
  pipeline: PipelineStage[]
  controller: AppController
  onDealClick: (dealId: number) => void
}) {
  const handleDragStart = (e: DragEvent, dealId: number, stageId: number) => {
    e.dataTransfer.setData('dealId', String(dealId))
    e.dataTransfer.setData('sourceStageId', String(stageId))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = async (e: DragEvent, targetStageId: number) => {
    e.preventDefault()
    const dealId = parseInt(e.dataTransfer.getData('dealId'), 10)
    const sourceStageId = parseInt(e.dataTransfer.getData('sourceStageId'), 10)

    if (!dealId || sourceStageId === targetStageId) return

    try {
      await controller.moveDeal(dealId, targetStageId, 0)
    } catch (err) {
      console.error('[KanbanView] Failed to move deal:', err)
    }
  }

  if (!pipeline || pipeline.length === 0) {
    return <EmptyState message="No pipeline stages configured" />
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        overflowX: 'auto',
        padding: 'var(--space-2) 0',
        minHeight: 400,
      }}
    >
      {pipeline.map((stage) => (
        <KanbanColumn
          key={stage.id}
          stage={stage}
          onDealClick={onDealClick}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      ))}
    </div>
  )
}

// ============================================================================
// Deal Detail Modal
// ============================================================================

function DealDetailModal({
  deal,
  onClose,
  controller,
}: {
  deal: Deal
  onClose: () => void
  controller: AppController
}) {
  const [forecasting, setForecasting] = useState(false)
  const [forecast, setForecast] = useState<{ closeProbability: number; reasoning: string | null } | null>(null)

  const handleForecast = async () => {
    setForecasting(true)
    try {
      const result = await controller.forecastDeal(deal.id)
      setForecast({ closeProbability: result.closeProbability, reasoning: result.reasoning })
    } catch (err) {
      console.error('[DealDetail] Forecast failed:', err)
    } finally {
      setForecasting(false)
    }
  }

  return (
    <Modal open={true} onClose={onClose} title={deal.title} size="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <InfoRow label="Company" value={deal.companyName} />
          <InfoRow label="Stage" value={deal.stageName} />
          <InfoRow label="Value" value={`$${deal.value.toLocaleString()}`} />
          <InfoRow label="Priority" value={deal.priority} />
          <InfoRow label="Probability" value={deal.probability != null ? `${deal.probability}%` : null} />
          <InfoRow label="Expected Close" value={deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toLocaleDateString() : null} />
          <InfoRow label="Owner" value={deal.owner} />
          <InfoRow label="Status" value={deal.status} />
        </div>

        {deal.description && (
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
              Description
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              {deal.description}
            </div>
          </div>
        )}

        {/* Contacts */}
        {deal.contacts && deal.contacts.length > 0 && (
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
              Associated Contacts
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {deal.contacts.map((c) => (
                <Badge key={c.id} variant="primary" size="sm">
                  {c.firstName} {c.lastName}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* AI Forecast */}
        <div style={{ borderTop: '1px solid var(--border-primary)', paddingTop: 'var(--space-3)' }}>
          <Button variant="secondary" size="sm" onClick={handleForecast} loading={forecasting}>
            Forecast Deal
          </Button>
          {forecast && (
            <Card style={{ marginTop: 'var(--space-3)' }}>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-1)' }}>
                Close Probability: {(forecast.closeProbability * 100).toFixed(0)}%
              </div>
              {forecast.reasoning && (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                  {forecast.reasoning}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </Modal>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

// ============================================================================
// New Deal Modal
// ============================================================================

function NewDealModal({
  open,
  onClose,
  controller,
  stages,
  companies,
}: {
  open: boolean
  onClose: () => void
  controller: AppController
  stages: { id: number; name: string }[]
  companies: Company[]
}) {
  const [form, setForm] = useState({
    title: '',
    stageId: '',
    companyId: '',
    value: '',
    priority: 'medium',
    expectedCloseDate: '',
    description: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      setError('Deal title is required')
      return
    }
    if (!form.stageId) {
      setError('Stage is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await controller.createDeal({
        title: form.title.trim(),
        stageId: Number(form.stageId),
        companyId: form.companyId ? Number(form.companyId) : undefined,
        value: form.value ? Number(form.value) : 0,
        priority: form.priority,
        expectedCloseDate: form.expectedCloseDate || undefined,
        description: form.description.trim() || undefined,
      } as any)
      setForm({ title: '', stageId: '', companyId: '', value: '', priority: 'medium', expectedCloseDate: '', description: '' })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create deal')
    } finally {
      setSaving(false)
    }
  }

  const stageOptions = [
    { value: '', label: 'Select Stage' },
    ...stages.map((s) => ({ value: String(s.id), label: s.name })),
  ]

  const companyOptions = [
    { value: '', label: 'No Company' },
    ...companies.map((c) => ({ value: String(c.id), label: c.name })),
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Deal"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} loading={saving}>Create Deal</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {error && (
          <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>{error}</div>
        )}
        <Input
          label="Deal Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Enterprise License Deal"
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <Select
            label="Stage"
            options={stageOptions}
            value={form.stageId}
            onChange={(e) => setForm({ ...form, stageId: e.target.value })}
          />
          <Select
            label="Company"
            options={companyOptions}
            value={form.companyId}
            onChange={(e) => setForm({ ...form, companyId: e.target.value })}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <Input
            label="Value ($)"
            type="number"
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            placeholder="10000"
          />
          <Select
            label="Priority"
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          />
        </div>
        <Input
          label="Expected Close Date"
          type="date"
          value={form.expectedCloseDate}
          onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })}
        />
      </div>
    </Modal>
  )
}

// ============================================================================
// Deals Page
// ============================================================================

export function DealsPage({ controller }: DealsPageProps) {
  const [state, setState] = useState<AppState>(controller.getState())
  const [viewMode, setViewMode] = useState<ViewMode>('kanban')
  const [loading, setLoading] = useState(true)
  const [companies, setCompanies] = useState<Company[]>([])

  useEffect(() => {
    const unsub = controller.subscribe(setState)
    return unsub
  }, [controller])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([
        controller.fetchPipeline(),
        controller.fetchDeals({ perPage: 100 }),
        controller.fetchStages(),
      ])
    } catch (err) {
      console.error('[DealsPage] Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }, [controller])

  useEffect(() => {
    loadData()
    controller.fetchCompanies({ perPage: 100 }).then((res) => {
      setCompanies(res.items)
    }).catch(() => {})
  }, [controller, loadData])

  const pipeline = state.pipeline || []
  const deals = state.deals?.items || []
  const stages = state.stages || []

  const handleDealClick = async (dealId: number) => {
    try {
      await controller.getDeal(dealId)
    } catch (err) {
      console.error('[DealsPage] Failed to get deal:', err)
    }
  }

  const handleCloseDealDetail = () => {
    controller.setState({ selectedDeal: null }, false)
  }

  // Table columns
  const columns: TableColumn<Deal>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (d) => <span style={{ fontWeight: 500 }}>{d.title}</span>,
    },
    {
      key: 'companyName',
      header: 'Company',
      render: (d) => d.companyName || '\u2014',
    },
    {
      key: 'stageName',
      header: 'Stage',
      render: (d) => <Badge variant="primary" size="sm">{d.stageName || 'Unknown'}</Badge>,
    },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      render: (d) => (
        <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>
          ${d.value.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (d) => <Badge variant={priorityBadge(d.priority)} size="sm">{d.priority}</Badge>,
    },
    {
      key: 'expectedCloseDate',
      header: 'Expected Close',
      render: (d) => d.expectedCloseDate ? new Date(d.expectedCloseDate).toLocaleDateString() : '\u2014',
    },
  ]

  return (
    <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)' }}>
          Deals
        </h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {/* View Toggle */}
          <div
            style={{
              display: 'flex',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-primary)',
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setViewMode('kanban')}
              style={{
                padding: 'var(--space-2) var(--space-3)',
                fontSize: 'var(--font-size-sm)',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: viewMode === 'kanban' ? 'var(--color-primary)' : 'var(--bg-secondary)',
                color: viewMode === 'kanban' ? '#fff' : 'var(--text-secondary)',
                fontWeight: 500,
              }}
            >
              Kanban
            </button>
            <button
              onClick={() => setViewMode('table')}
              style={{
                padding: 'var(--space-2) var(--space-3)',
                fontSize: 'var(--font-size-sm)',
                border: 'none',
                borderLeft: '1px solid var(--border-primary)',
                cursor: 'pointer',
                backgroundColor: viewMode === 'table' ? 'var(--color-primary)' : 'var(--bg-secondary)',
                color: viewMode === 'table' ? '#fff' : 'var(--text-secondary)',
                fontWeight: 500,
              }}
            >
              Table
            </button>
          </div>
          <Button onClick={() => controller.setState({ showDealForm: true }, false)}>
            New Deal
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading deals...
        </div>
      ) : viewMode === 'kanban' ? (
        <KanbanView
          pipeline={pipeline}
          controller={controller}
          onDealClick={handleDealClick}
        />
      ) : (
        <Card padding="none">
          {deals.length === 0 ? (
            <EmptyState
              title="No deals found"
              message="Create your first deal to get started"
              action={
                <Button onClick={() => controller.setState({ showDealForm: true }, false)}>
                  New Deal
                </Button>
              }
            />
          ) : (
            <Table
              columns={columns}
              data={deals}
              onRowClick={(d) => handleDealClick(d.id)}
              rowKey={(d) => d.id}
            />
          )}
        </Card>
      )}

      {/* Deal Detail Modal */}
      {state.selectedDeal && (
        <DealDetailModal
          deal={state.selectedDeal}
          onClose={handleCloseDealDetail}
          controller={controller}
        />
      )}

      {/* New Deal Modal */}
      <NewDealModal
        open={state.showDealForm}
        onClose={() => controller.setState({ showDealForm: false }, false)}
        controller={controller}
        stages={stages}
        companies={companies}
      />
    </div>
  )
}
