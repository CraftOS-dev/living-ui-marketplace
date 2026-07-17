import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Download } from 'lucide-react'
import { toast } from 'sonner'

import { downloadTextFile, formatCompactCurrency } from '@/lib/format'
import type { ActivityVolumeReport, FunnelReport, ListInfo, VelocityReport, WinRateReport } from '@/types'
import { api } from '@/api'
import { useUiActions } from '@/components/MainView'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const CHART = {
  c1: 'hsl(var(--chart-1))',
  c2: 'hsl(var(--chart-2))',
  c3: 'hsl(var(--chart-3))',
  c4: 'hsl(var(--chart-4))',
  c5: 'hsl(var(--chart-5))',
  grid: 'hsl(var(--border))',
  ink: 'hsl(var(--muted-foreground))',
}

// Fixed categorical order — validated palette (dataviz skill)
const VOLUME_SERIES: { key: 'emails' | 'notes' | 'tasks' | 'meetings' | 'changes'; label: string; color: string }[] = [
  { key: 'emails', label: 'Emails', color: CHART.c2 },
  { key: 'notes', label: 'Notes', color: CHART.c4 },
  { key: 'tasks', label: 'Tasks', color: CHART.c3 },
  { key: 'meetings', label: 'Meetings', color: CHART.c5 },
  { key: 'changes', label: 'Changes', color: CHART.c1 },
]

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      {label ? <div className="mb-1 font-semibold">{label}</div> : null}
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

/** Reports (F8.2): funnel, win rate, velocity, activity volume + CSV export. */
export function Reports() {
  const { lists } = useUiActions()
  const dealLists = lists.filter((list) => list.parentObject === 'deal')
  const [listId, setListId] = useState(0)
  const [months, setMonths] = useState(6)
  const [funnel, setFunnel] = useState<FunnelReport | null>(null)
  const [winRate, setWinRate] = useState<WinRateReport | null>(null)
  const [velocity, setVelocity] = useState<VelocityReport | null>(null)
  const [volume, setVolume] = useState<ActivityVolumeReport | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.reports.funnel(listId),
      api.reports.winRate(months),
      api.reports.velocity(listId),
      api.reports.activityVolume(8),
    ])
      .then(([funnelData, winRateData, velocityData, volumeData]) => {
        setFunnel(funnelData)
        setWinRate(winRateData)
        setVelocity(velocityData)
        setVolume(volumeData)
      })
      .catch(() => toast.error('Could not load reports'))
      .finally(() => setLoading(false))
  }, [listId, months])

  useEffect(() => {
    load()
  }, [load])

  const exportReport = async (report: string) => {
    try {
      const csv = await api.reports.exportCsv(report, listId, months, 8)
      downloadTextFile(`report-${report}.csv`, csv)
      toast.success('Report exported')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed')
    }
  }

  if (loading && !funnel) {
    return (
      <div className="grid gap-3 p-6 pl-14 md:grid-cols-2 md:pl-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-64 w-full" />
        ))}
      </div>
    )
  }

  const maxReached = Math.max(1, ...(funnel?.stages.map((stage) => stage.reached) || []))
  const maxDays = Math.max(1, ...(velocity?.stages.map((stage) => stage.avgDays) || []))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-4 pl-14 md:p-6 md:pl-6">
        {/* Filter row — one row above the charts */}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">Reports</h1>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={String(listId)} onValueChange={(value) => setListId(Number(value))}>
              <SelectTrigger className="h-7 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Default pipeline</SelectItem>
                {dealLists.map((list: ListInfo) => (
                  <SelectItem key={list.id} value={String(list.id)}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(months)} onValueChange={(value) => setMonths(Number(value))}>
              <SelectTrigger className="h-7 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Last 3 months</SelectItem>
                <SelectItem value="6">Last 6 months</SelectItem>
                <SelectItem value="12">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Headline stats */}
        {winRate ? (
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-3.5">
                <div className="label-caps">Win rate</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  {winRate.overall.winRate !== null ? `${winRate.overall.winRate}%` : '—'}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3.5">
                <div className="label-caps">Avg deal size</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{formatCompactCurrency(winRate.overall.avgDealSize)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3.5">
                <div className="label-caps">Total won</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{formatCompactCurrency(winRate.overall.totalWonValue)}</div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Funnel — stage entity colors, direct conversion labels */}
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-3">
              <CardTitle>Funnel conversion{funnel?.list ? ` · ${funnel.list.name}` : ''}</CardTitle>
              <Button variant="ghost" size="icon-sm" onClick={() => exportReport('funnel')} aria-label="Export funnel CSV">
                <Download />
              </Button>
            </CardHeader>
            <CardContent>
              {funnel && funnel.stages.length > 0 ? (
                <div className="space-y-2">
                  {funnel.stages.map((entry) => (
                    <div key={entry.stage.id} className="flex min-w-0 items-center gap-2" title={`${entry.stage.name}: ${entry.reached} reached · ${entry.conversion}%`}>
                      <span className="w-16 shrink-0 truncate text-[12px] text-muted-foreground sm:w-24">{entry.stage.name}</span>
                      <div className="h-5 min-w-0 flex-1 rounded-sm bg-muted/60">
                        <div
                          className="flex h-5 items-center rounded-sm pl-1.5"
                          style={{ width: `${Math.max(3, (entry.reached / maxReached) * 100)}%`, backgroundColor: entry.stage.color }}
                        >
                          <span className="text-[10px] font-semibold text-white/95 tabular-nums">{entry.reached}</span>
                        </div>
                      </div>
                      <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{entry.conversion}%</span>
                    </div>
                  ))}
                  {funnel.lostCount > 0 ? (
                    <p className="pt-1 text-[11px] text-muted-foreground">{funnel.lostCount} in lost stages (excluded from funnel)</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">No pipeline data yet.</p>
              )}
            </CardContent>
          </Card>

          {/* Velocity */}
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-3">
              <CardTitle>Deal velocity — avg days per stage</CardTitle>
              <Button variant="ghost" size="icon-sm" onClick={() => exportReport('velocity')} aria-label="Export velocity CSV">
                <Download />
              </Button>
            </CardHeader>
            <CardContent>
              {velocity && velocity.stages.some((entry) => entry.samples > 0) ? (
                <div className="space-y-2">
                  {velocity.stages
                    .filter((entry) => !entry.stage.isWon && !entry.stage.isLost)
                    .map((entry) => (
                      <div key={entry.stage.id} className="flex min-w-0 items-center gap-2" title={`${entry.stage.name}: avg ${entry.avgDays} days (${entry.samples} samples)`}>
                        <span className="w-16 shrink-0 truncate text-[12px] text-muted-foreground sm:w-24">{entry.stage.name}</span>
                        <div className="h-4 min-w-0 flex-1 rounded-sm bg-muted/60">
                          <div
                            className="h-4 rounded-sm"
                            style={{ width: `${Math.max(entry.avgDays > 0 ? 3 : 0, (entry.avgDays / maxDays) * 100)}%`, backgroundColor: entry.stage.color }}
                          />
                        </div>
                        <span className="w-12 shrink-0 text-right text-[12px] tabular-nums">{entry.avgDays}d</span>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">Move deals between stages to build velocity history.</p>
              )}
            </CardContent>
          </Card>

          {/* Won value by month — single hue */}
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-1">
              <CardTitle>Won value by month</CardTitle>
              <Button variant="ghost" size="icon-sm" onClick={() => exportReport('win-rate')} aria-label="Export win-rate CSV">
                <Download />
              </Button>
            </CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={winRate?.months || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: CHART.ink, fontSize: 11 }} axisLine={{ stroke: CHART.grid }} tickLine={false} />
                  <YAxis tickFormatter={(value: number) => formatCompactCurrency(value)} tick={{ fill: CHART.ink, fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--accent))' }} />
                  <Bar dataKey="wonValue" name="Won value" fill={CHART.c2} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Win rate % by month — separate chart, never dual-axis */}
          <Card>
            <CardHeader className="pb-1">
              <CardTitle>Win rate by month</CardTitle>
            </CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={(winRate?.months || []).map((month) => ({ ...month, winRate: month.winRate ?? undefined }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: CHART.ink, fontSize: 11 }} axisLine={{ stroke: CHART.grid }} tickLine={false} />
                  <YAxis domain={[0, 100]} tickFormatter={(value: number) => `${value}%`} tick={{ fill: CHART.ink, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="winRate" name="Win rate %" stroke={CHART.c3} strokeWidth={2} dot={{ r: 3, fill: CHART.c3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Activity volume — stacked, fixed series order, legend */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between pb-1">
              <CardTitle>Activity volume — last 8 weeks</CardTitle>
              <Button variant="ghost" size="icon-sm" onClick={() => exportReport('activity-volume')} aria-label="Export activity CSV">
                <Download />
              </Button>
            </CardHeader>
            <CardContent>
              <div className="mb-2 flex flex-wrap gap-3">
                {VOLUME_SERIES.map((series) => (
                  <span key={series.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: series.color }} />
                    {series.label}
                  </span>
                ))}
              </div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volume?.weeks || []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: CHART.ink, fontSize: 11 }} axisLine={{ stroke: CHART.grid }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: CHART.ink, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--accent))' }} />
                    {VOLUME_SERIES.map((series, index) => (
                      <Bar
                        key={series.key}
                        dataKey={series.key}
                        name={series.label}
                        stackId="volume"
                        fill={series.color}
                        stroke="hsl(var(--card))"
                        strokeWidth={1}
                        radius={index === VOLUME_SERIES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                        maxBarSize={40}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
