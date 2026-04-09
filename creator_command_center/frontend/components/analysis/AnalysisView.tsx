import { useState, useEffect, useRef } from 'react'
import { Brain, Play, Loader2, CheckCircle, AlertCircle, Lightbulb, ListTodo, TrendingUp, Image, Clock, BarChart3 } from 'lucide-react'
import { Button, Card, Badge, EmptyState } from '../ui'
import type { AppController } from '../../AppController'
import type { ContentAnalysisData, AnalysisStatus } from '../../types'

interface AnalysisViewProps {
  controller: AppController
}

type ReportTab = 'overview' | 'performance' | 'categories' | 'timing' | 'thumbnails' | 'recommendations' | 'ideas' | 'todos'

const REPORT_TABS: { key: ReportTab; label: string; icon: any }[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'performance', label: 'Performance', icon: TrendingUp },
  { key: 'categories', label: 'Categories', icon: BarChart3 },
  { key: 'timing', label: 'Timing', icon: Clock },
  { key: 'thumbnails', label: 'Thumbnails', icon: Image },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'ideas', label: 'Content Ideas', icon: Brain },
  { key: 'todos', label: 'Todos', icon: ListTodo },
]

export function AnalysisView({ controller }: AnalysisViewProps) {
  const [analysis, setAnalysis] = useState<ContentAnalysisData | null>(null)
  const [status, setStatus] = useState<AnalysisStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [activeTab, setActiveTab] = useState<ReportTab>('overview')
  const pollRef = useRef<number | null>(null)
  const analysisIdRef = useRef<number | null>(null)

  // Load latest analysis on mount
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

  // Cleanup on unmount
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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semibold)', margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Brain size={20} /> AI Analysis
        </h2>
        <Button variant="primary" onClick={handleStart} disabled={running}>
          {running ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />}
          {running ? 'Analyzing...' : 'Run Analysis'}
        </Button>
      </div>

      {/* Progress bar */}
      {running && status && (
        <Card style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ padding: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)' }}>{status.progressMessage}</span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{status.progress}%</span>
            </div>
            <div style={{ height: 8, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: 'var(--color-primary)', borderRadius: 'var(--radius-full)',
                width: `${status.progress}%`, transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
        </Card>
      )}

      {/* Error state */}
      {analysis?.status === 'failed' && (
        <Card style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ padding: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-error)' }}>
            <AlertCircle size={16} />
            <span style={{ fontSize: 'var(--text-sm)' }}>{analysis.errorMessage || 'Analysis failed'}</span>
          </div>
        </Card>
      )}

      {/* No analysis yet */}
      {!analysis && !running && (
        <EmptyState
          title="No analysis yet"
          message="Click 'Run Analysis' to get AI-powered insights about your content. Make sure you've synced your YouTube data first."
        />
      )}

      {/* Analysis Report */}
      {analysis?.status === 'completed' && report && (
        <div>
          {/* Meta info */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
            <Badge variant="success" size="sm"><CheckCircle size={10} /> Completed</Badge>
            <Badge variant="default" size="sm">{analysis.videoCountAnalyzed} videos analyzed</Badge>
            {analysis.completedAt && <Badge variant="default" size="sm">{new Date(analysis.completedAt).toLocaleString()}</Badge>}
          </div>

          {/* Report tabs */}
          <div style={{ display: 'flex', gap: 'var(--space-1)', borderBottom: '1px solid var(--border-primary)', marginBottom: 'var(--space-4)', overflowX: 'auto' }}>
            {REPORT_TABS.map(tab => {
              const Icon = tab.icon
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                  padding: 'var(--space-2) var(--space-3)', background: 'none', border: 'none',
                  borderBottom: activeTab === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
                  color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--text-muted)',
                  fontWeight: activeTab === tab.key ? 'var(--font-semibold)' : 'var(--font-normal)',
                  fontSize: 'var(--text-xs)', cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1,
                  display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                }}>
                  <Icon size={12} /> {tab.label}
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          {activeTab === 'overview' && (
            <Card>
              <div style={{ padding: 'var(--space-4)' }}>
                <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-3)' }}>Summary</h3>
                <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{report.summary || analysis.summary}</p>
              </div>
            </Card>
          )}

          {activeTab === 'performance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {(report.performance_ranking || []).map((v, i) => (
                <Card key={i}>
                  <div style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-primary)', width: 40, textAlign: 'center' }}>
                      #{i + 1}
                    </span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' }}>{v.title}</span>
                      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: 'var(--space-1) 0 0' }}>{v.reason}</p>
                    </div>
                    <Badge variant="primary" size="sm">{v.score}/10</Badge>
                  </div>
                </Card>
              ))}
              {!(report.performance_ranking?.length) && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No performance data</p>}
            </div>
          )}

          {activeTab === 'categories' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 'var(--space-3)' }}>
              {(report.content_categories || []).map((c, i) => (
                <Card key={i}>
                  <div style={{ padding: 'var(--space-4)' }}>
                    <h4 style={{ fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-2)' }}>{c.category}</h4>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                      <Badge variant="default" size="sm">{c.video_count} videos</Badge>
                      <Badge variant="info" size="sm">avg {c.avg_views} views</Badge>
                    </div>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{c.insight}</p>
                  </div>
                </Card>
              ))}
              {!(report.content_categories?.length) && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No category data</p>}
            </div>
          )}

          {activeTab === 'timing' && (
            <Card>
              <div style={{ padding: 'var(--space-4)' }}>
                <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{report.timing_analysis || 'No timing analysis available'}</p>
              </div>
            </Card>
          )}

          {activeTab === 'thumbnails' && (
            <Card>
              <div style={{ padding: 'var(--space-4)' }}>
                <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{report.thumbnail_insights || 'No thumbnail analysis available'}</p>
              </div>
            </Card>
          )}

          {activeTab === 'recommendations' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {(report.recommendations || analysis.recommendations || []).map((rec, i) => (
                <Card key={i}>
                  <div style={{ padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-3)' }}>
                    <Lightbulb size={16} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 'var(--text-sm)' }}>{typeof rec === 'string' ? rec : JSON.stringify(rec)}</span>
                  </div>
                </Card>
              ))}
              {!(report.recommendations?.length || analysis.recommendations?.length) && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No recommendations</p>}
            </div>
          )}

          {activeTab === 'ideas' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {(report.content_ideas || analysis.contentIdeas || []).map((idea, i) => (
                <Card key={i}>
                  <div style={{ padding: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                      <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' }}>{idea.title}</span>
                      <Badge variant="info" size="sm">{idea.format}</Badge>
                    </div>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{idea.reasoning}</p>
                  </div>
                </Card>
              ))}
              {!(report.content_ideas?.length || analysis.contentIdeas?.length) && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No content ideas</p>}
            </div>
          )}

          {activeTab === 'todos' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {(report.todos || analysis.todos || []).map((todo, i) => (
                <Card key={i}>
                  <div style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <ListTodo size={14} style={{ flexShrink: 0, color: todo.priority === 'high' ? 'var(--color-error)' : todo.priority === 'medium' ? 'var(--color-warning)' : 'var(--text-muted)' }} />
                    <span style={{ fontSize: 'var(--text-sm)', flex: 1 }}>{todo.task}</span>
                    <Badge variant={todo.priority === 'high' ? 'error' : todo.priority === 'medium' ? 'warning' : 'default'} size="sm">
                      {todo.priority}
                    </Badge>
                  </div>
                </Card>
              ))}
              {!(report.todos?.length || analysis.todos?.length) && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No todos</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
