import { useState, useEffect, useRef } from 'react'
import { Brain, Loader2, CheckCircle, AlertCircle, Lightbulb, ListTodo, TrendingUp, Trophy, Clock, Sparkles, Target, ArrowRight } from 'lucide-react'
import { Button, Card, Badge } from '../ui'
import type { AppController } from '../../AppController'
import type { ContentAnalysisData, AnalysisStatus } from '../../types'

interface AnalysisViewProps {
  controller: AppController
}

type ReportTab = 'summary' | 'performance' | 'categories' | 'insights' | 'ideas' | 'todos'

const PRIORITY_COLORS: Record<string, string> = {
  high: 'var(--color-error)',
  medium: 'var(--color-warning)',
  low: 'var(--text-muted)',
}

export function AnalysisView({ controller }: AnalysisViewProps) {
  const [analysis, setAnalysis] = useState<ContentAnalysisData | null>(null)
  const [status, setStatus] = useState<AnalysisStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [activeTab, setActiveTab] = useState<ReportTab>('summary')
  const pollRef = useRef<number | null>(null)
  const analysisIdRef = useRef<number | null>(null)

  useEffect(() => {
    controller.getLatestAnalysis().then(setAnalysis)
  }, [controller])

  const startPolling = (analysisId: number) => {
    if (pollRef.current) clearInterval(pollRef.current)
    analysisIdRef.current = analysisId
    pollRef.current = window.setInterval(async () => {
      const id = analysisIdRef.current
      if (!id) return
      const s = await controller.getAnalysisStatus(id)
      if (s) {
        setStatus(s)
        if (s.status === 'completed' || s.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setRunning(false)
          if (s.status === 'completed') {
            const result = await controller.getAnalysis(id)
            setAnalysis(result)
          }
        }
      }
    }, 2000)
  }

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const handleStart = async () => {
    const result = await controller.startAnalysis()
    if (result) {
      setRunning(true)
      setStatus({ id: result.analysisId, status: 'running', progress: 0, progressMessage: 'Starting...' })
      startPolling(result.analysisId)
    }
  }

  const report = analysis?.report

  const TABS: { key: ReportTab; label: string; icon: any; count?: number }[] = [
    { key: 'summary', label: 'Summary', icon: CheckCircle },
    { key: 'performance', label: 'Performance', icon: Trophy, count: report?.performance_ranking?.length },
    { key: 'categories', label: 'Categories', icon: TrendingUp, count: report?.content_categories?.length },
    { key: 'insights', label: 'Insights', icon: Lightbulb, count: (report?.recommendations?.length || 0) },
    { key: 'ideas', label: 'Content Ideas', icon: Sparkles, count: (report?.content_ideas?.length || 0) },
    { key: 'todos', label: 'Action Items', icon: ListTodo, count: (report?.todos?.length || 0) },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-bold)', margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Brain size={22} style={{ color: 'var(--color-primary)' }} /> AI Analysis
          </h2>
          {analysis?.completedAt && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: 'var(--space-1) 0 0' }}>
              Last run: {new Date(analysis.completedAt).toLocaleString()} · {analysis.videoCountAnalyzed} videos
            </p>
          )}
        </div>
        <Button variant="primary" onClick={handleStart} disabled={running}>
          {running ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={14} />}
          {running ? 'Analyzing...' : 'Run Analysis'}
        </Button>
      </div>

      {/* Progress */}
      {running && status && (
        <Card style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ padding: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--color-primary)' }} />
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)' }}>{status.progressMessage}</span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginLeft: 'auto' }}>{status.progress}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: 'var(--color-primary)', borderRadius: 'var(--radius-full)',
                width: `${status.progress}%`, transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
        </Card>
      )}

      {/* Error */}
      {analysis?.status === 'failed' && !running && (
        <Card style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ padding: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-error)' }}>
            <AlertCircle size={16} />
            <span style={{ fontSize: 'var(--text-sm)' }}>{analysis.errorMessage || 'Analysis failed. Try again.'}</span>
          </div>
        </Card>
      )}

      {/* Empty */}
      {!analysis && !running && (
        <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <Brain size={48} style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-4)', opacity: 0.3 }} />
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-2)' }}>No analysis yet</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            Sync your YouTube data first, then click "Run Analysis"
          </p>
        </div>
      )}

      {/* ═══════════ REPORT WITH TABS ═══════════ */}
      {analysis?.status === 'completed' && report && (
        <div>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 'var(--space-1)', borderBottom: '1px solid var(--border-primary)', marginBottom: 'var(--space-4)', overflowX: 'auto' }}>
            {TABS.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.key
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                  padding: 'var(--space-2) var(--space-3)', background: 'none', border: 'none',
                  borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                  color: isActive ? 'var(--color-primary)' : 'var(--text-muted)',
                  fontWeight: isActive ? 'var(--font-semibold)' : 'var(--font-normal)',
                  fontSize: 'var(--text-sm)', cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1,
                  display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                }}>
                  <Icon size={14} />
                  {tab.label}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span style={{
                      fontSize: '10px', background: isActive ? 'var(--color-primary)' : 'var(--bg-tertiary)',
                      color: isActive ? 'white' : 'var(--text-muted)',
                      borderRadius: 'var(--radius-full)', padding: '1px 6px', fontWeight: 'var(--font-semibold)',
                    }}>{tab.count}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* ── Summary Tab ── */}
          {activeTab === 'summary' && (
            <Card style={{ background: 'linear-gradient(135deg, var(--bg-secondary), var(--bg-tertiary))' }}>
              <div style={{ padding: 'var(--space-5)' }}>
                <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {report.summary || analysis.summary}
                </p>

                {/* Quick stats row */}
                {(report.timing_analysis || report.thumbnail_insights) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-primary)' }}>
                    {report.timing_analysis && (
                      <div>
                        <h4 style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          <Clock size={12} /> Timing
                        </h4>
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                          {report.timing_analysis}
                        </p>
                      </div>
                    )}
                    {report.thumbnail_insights && (
                      <div>
                        <h4 style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          <Target size={12} /> Thumbnails
                        </h4>
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                          {report.thumbnail_insights}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── Performance Tab ── */}
          {activeTab === 'performance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {(report.performance_ranking || []).map((v: any, i: number) => {
                const scoreColor = v.score >= 7 ? 'var(--color-success)' : v.score >= 4 ? 'var(--color-warning)' : 'var(--color-error)'
                return (
                  <Card key={i}>
                    <div style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 'var(--radius-md)',
                        background: i === 0 ? 'var(--color-primary)' : 'var(--bg-tertiary)',
                        color: i === 0 ? 'white' : 'var(--text-primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 'var(--font-bold)', fontSize: 'var(--text-sm)', flexShrink: 0,
                      }}>
                        #{i + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)', display: 'block' }}>{v.title}</span>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{v.reason}</span>
                      </div>
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%',
                        border: `3px solid ${scoreColor}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 'var(--font-bold)', fontSize: 'var(--text-sm)', color: scoreColor, flexShrink: 0,
                      }}>
                        {v.score}
                      </div>
                    </div>
                  </Card>
                )
              })}
              {!report.performance_ranking?.length && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No performance data</p>}
            </div>
          )}

          {/* ── Categories Tab ── */}
          {activeTab === 'categories' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--space-3)' }}>
              {(report.content_categories || []).map((c: any, i: number) => (
                <Card key={i}>
                  <div style={{ padding: 'var(--space-4)' }}>
                    <h4 style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>{c.category}</h4>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                      <Badge variant="default" size="sm">{c.video_count} videos</Badge>
                      <Badge variant="primary" size="sm">~{c.avg_views} views</Badge>
                    </div>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>{c.insight}</p>
                  </div>
                </Card>
              ))}
              {!report.content_categories?.length && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No category data</p>}
            </div>
          )}

          {/* ── Insights Tab (Recommendations) ── */}
          {activeTab === 'insights' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {(report.recommendations || analysis.recommendations || []).map((rec: any, i: number) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
                  borderLeft: '3px solid var(--color-warning)',
                }}>
                  <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', color: 'var(--color-primary)', minWidth: 24 }}>{i + 1}.</span>
                  <span style={{ fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
                    {typeof rec === 'string' ? rec : JSON.stringify(rec)}
                  </span>
                </div>
              ))}
              {!(report.recommendations?.length || analysis.recommendations?.length) && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No recommendations</p>}
            </div>
          )}

          {/* ── Content Ideas Tab ── */}
          {activeTab === 'ideas' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {(report.content_ideas || analysis.contentIdeas || []).map((idea: any, i: number) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
                  borderLeft: '3px solid var(--color-primary)',
                }}>
                  <ArrowRight size={14} style={{ color: 'var(--color-primary)', marginTop: 3, flexShrink: 0 }} />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 2 }}>
                      <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' }}>{idea.title}</span>
                      <Badge variant="info" size="sm">{idea.format}</Badge>
                    </div>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{idea.reasoning}</span>
                  </div>
                </div>
              ))}
              {!(report.content_ideas?.length || analysis.contentIdeas?.length) && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No content ideas</p>}
            </div>
          )}

          {/* ── Action Items Tab ── */}
          {activeTab === 'todos' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {(report.todos || analysis.todos || []).map((todo: any, i: number) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)',
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: PRIORITY_COLORS[todo.priority] || 'var(--text-muted)', flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 'var(--text-sm)', flex: 1 }}>{todo.task}</span>
                  <span style={{
                    fontSize: '10px', color: PRIORITY_COLORS[todo.priority] || 'var(--text-muted)',
                    fontWeight: 'var(--font-semibold)', textTransform: 'uppercase',
                  }}>{todo.priority}</span>
                </div>
              ))}
              {!(report.todos?.length || analysis.todos?.length) && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No action items</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
