import { useState, useEffect } from 'react'
import { Network, List, Zap, AlertCircle, FileText, Bot, User } from 'lucide-react'
import { toast } from 'react-toastify'
import { useAgentAware } from '../agent/hooks'
import { Button, Modal, Select, Alert } from './ui'
import { SessionSidebar } from './SessionSidebar'
import { GraphView } from './GraphView'
import { TreeView } from './TreeView'
import { SummaryView } from './SummaryView'
import type { AppController } from '../AppController'
import type { AppState, NodeType, BrainstormNode } from '../types'

const TYPE_COLORS: Record<string, string> = {
  question: 'var(--color-info, #3b82f6)',
  answer: 'var(--color-success, #22c55e)',
  idea: 'var(--color-primary, #FF4F18)',
}

const TEXTAREA_STYLE: React.CSSProperties = {
  width: '100%', background: 'var(--bg-primary)',
  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
  borderRadius: 'var(--radius-md)', padding: '8px 10px', fontSize: 13,
  color: 'var(--text-primary)', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
}

interface Props {
  controller: AppController
}

export function MainView({ controller }: Props) {
  const [state, setState] = useState<AppState>(controller.getState())

  // add-child modal
  const [addingToParentId, setAddingToParentId] = useState<number | null>(null)
  const [newContent, setNewContent] = useState('')
  const [newNodeType, setNewNodeType] = useState<NodeType>('question')

  // delete modal
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  // edit modal
  const [editingNode, setEditingNode] = useState<BrainstormNode | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editNodeType, setEditNodeType] = useState<NodeType>('question')
  const [editSaving, setEditSaving] = useState(false)

  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => controller.subscribe(setState), [controller])

  useAgentAware('MainView', {
    activeSessionId: state.activeSessionId,
    nodeCount: state.nodes.length,
    view: state.view,
    agentRunning: state.agentRunning,
  })

  // ── Session handlers ────────────────────────────────────────────────────────

  async function handleSelectSession(id: number) {
    try { await controller.loadSession(id) }
    catch { toast.error('Failed to load session') }
  }

  async function handleCreateSession(title: string, topic: string) {
    try { await controller.createSession(title, topic); toast.success('Session created') }
    catch { toast.error('Failed to create session') }
  }

  async function handleRenameSession(id: number, title: string) {
    try { await controller.renameSession(id, title); toast.success('Renamed') }
    catch { toast.error('Failed to rename session') }
  }

  async function handleDeleteSession(id: number) {
    try { await controller.deleteSession(id); toast.success('Session deleted') }
    catch { toast.error('Failed to delete session') }
  }

  // ── Node handlers ───────────────────────────────────────────────────────────

  function errMsg(e: unknown, fallback: string) {
    return e instanceof Error && e.message ? e.message : fallback
  }

  async function handleExpand(nodeId: number) {
    try { await controller.expandNode(nodeId); toast.success('Expanded with AI') }
    catch (e) { toast.error(errMsg(e, 'Expand failed')) }
  }

  async function handleAnswer(nodeId: number) {
    try { await controller.answerNode(nodeId); toast.success('Answered with AI') }
    catch (e) { toast.error(errMsg(e, 'Answer failed')) }
  }

  function handleDeleteRequest(nodeId: number) {
    setDeleteConfirmId(nodeId)
  }

  async function confirmDelete() {
    if (deleteConfirmId === null) return
    try { await controller.deleteNode(deleteConfirmId); toast.success('Deleted') }
    catch { toast.error('Delete failed') }
    finally { setDeleteConfirmId(null) }
  }

  async function handleAddChild(parentId: number) {
    setAddingToParentId(parentId)
    setNewContent('')
    setNewNodeType('question')
  }

  async function submitAddChild() {
    if (!newContent.trim() || addingToParentId === null || !state.activeSessionId) return
    try {
      await controller.createNode({
        sessionId: state.activeSessionId,
        parentId: addingToParentId,
        content: newContent.trim(),
        nodeType: newNodeType,
      })
      toast.success('Node added')
      setAddingToParentId(null)
    } catch { toast.error('Failed to add node') }
  }

  async function handleUpdatePosition(nodeId: number, x: number, y: number) {
    try { await controller.updateNodePosition(nodeId, x, y) } catch { /* silent */ }
  }

  async function handleExplore() {
    try { await controller.exploreSession(); toast.success('AI explored the graph') }
    catch (e) { toast.error(errMsg(e, 'Explore failed')) }
  }

  // ── Edit handlers ───────────────────────────────────────────────────────────

  function handleOpenEdit(nodeId: number) {
    const node = state.nodes.find(n => n.id === nodeId)
    if (!node) return
    setEditingNode(node)
    setEditContent(node.content)
    setEditNodeType(node.nodeType)
  }

  async function handleSaveEdit() {
    if (!editingNode) return
    setEditSaving(true)
    try {
      await controller.updateNode(editingNode.id, {
        content: editContent.trim(),
        nodeType: editNodeType,
      })
      toast.success('Saved')
      setEditingNode(null)
    } catch { toast.error('Save failed') }
    finally { setEditSaving(false) }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!state.initialized) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-secondary)' }}>
        Loading…
      </div>
    )
  }

  return (
    <div className="app-layout">
      <button className="sidebar-toggle" onClick={() => setSidebarOpen(o => !o)} title="Toggle sessions">
        <List size={16} />
      </button>

      {sidebarOpen && (
        <SessionSidebar
          sessions={state.sessions}
          activeSessionId={state.activeSessionId}
          onSelect={handleSelectSession}
          onCreate={handleCreateSession}
          onRename={handleRenameSession}
          onDelete={handleDeleteSession}
        />
      )}

      <div className="main-area">
        <div className="toolbar">
          <div className="toolbar-left">
            {state.activeSessionId && (
              <span className="session-label">
                {state.sessions.find(s => s.id === state.activeSessionId)?.title ?? ''}
                <span className="node-count">{state.nodes.length} nodes</span>
              </span>
            )}
          </div>
          <div className="toolbar-right">
            {state.activeSessionId && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleExplore}
                loading={state.agentRunning}
                disabled={state.agentRunning}
                icon={<Zap size={13} />}
              >
                AI Explore
              </Button>
            )}
            <div className="view-toggle">
              <button className={`toggle-opt ${state.view === 'graph' ? 'active' : ''}`} onClick={() => controller.setView('graph')} title="Graph view">
                <Network size={14} />
              </button>
              <button className={`toggle-opt ${state.view === 'tree' ? 'active' : ''}`} onClick={() => controller.setView('tree')} title="Tree view">
                <List size={14} />
              </button>
              <button className={`toggle-opt ${state.view === 'summary' ? 'active' : ''}`} onClick={() => controller.setView('summary')} title="Summary view">
                <FileText size={14} />
              </button>
            </div>
          </div>
        </div>

        {state.error && (
          <div style={{ padding: '8px 12px' }}>
            <Alert variant="error">{state.error}</Alert>
          </div>
        )}

        <div className="view-area">
          {state.view === 'graph' && (
            <GraphView
              nodes={state.nodes}
              activeSessionId={state.activeSessionId}
              expandingNodeId={state.expandingNodeId}
              onExpand={handleExpand}
              onAnswer={handleAnswer}
              onDelete={handleDeleteRequest}
              onAddChild={handleAddChild}
              onEdit={handleOpenEdit}
              onUpdatePosition={handleUpdatePosition}
            />
          )}
          {state.view === 'tree' && (
            <TreeView
              nodes={state.nodes}
              expandingNodeId={state.expandingNodeId}
              onExpand={handleExpand}
              onAnswer={handleAnswer}
              onDelete={handleDeleteRequest}
              onAddChild={handleAddChild}
              onEdit={handleOpenEdit}
            />
          )}
          {state.view === 'summary' && (
            <SummaryView
              nodes={state.nodes}
              activeSessionId={state.activeSessionId}
              controller={controller}
            />
          )}
        </div>
      </div>

      {/* ── Edit node modal ─────────────────────────────────────────────────── */}
      <Modal
        open={editingNode !== null}
        onClose={() => setEditingNode(null)}
        title="Edit node"
        size="md"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setEditingNode(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} loading={editSaving} disabled={!editContent.trim() || editSaving}>Save</Button>
          </div>
        }
      >
        {editingNode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Metadata strip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-muted)' }}>
              <span
                style={{
                  background: TYPE_COLORS[editingNode.nodeType],
                  color: '#fff', borderRadius: 9999, padding: '2px 8px',
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                }}
              >
                {editingNode.nodeType}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {editingNode.createdBy === 'agent' ? <Bot size={11} /> : <User size={11} />}
                {editingNode.createdBy === 'agent' ? 'Created by AI' : 'Created by you'}
              </span>
              <span>Depth {editingNode.depth}</span>
            </div>

            {/* Type selector */}
            <Select
              label="Type"
              value={editNodeType}
              onChange={e => setEditNodeType(e.target.value as NodeType)}
              options={[
                { value: 'question', label: 'Question' },
                { value: 'answer', label: 'Answer' },
                { value: 'idea', label: 'Idea' },
              ]}
            />

            {/* Content editor */}
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Content</label>
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveEdit() }}
                rows={6}
                autoFocus
                style={TEXTAREA_STYLE}
              />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>⌘↵ to save</p>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Add child modal ──────────────────────────────────────────────────── */}
      <Modal
        open={addingToParentId !== null}
        onClose={() => setAddingToParentId(null)}
        title="Add node"
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setAddingToParentId(null)}>Cancel</Button>
            <Button onClick={submitAddChild} disabled={!newContent.trim()}>Add</Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select
            label="Type"
            value={newNodeType}
            onChange={e => setNewNodeType(e.target.value as NodeType)}
            options={[
              { value: 'question', label: 'Question' },
              { value: 'answer', label: 'Answer' },
              { value: 'idea', label: 'Idea' },
            ]}
          />
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Content</label>
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitAddChild() }}
              placeholder="Enter your question, answer, or idea…"
              autoFocus
              rows={3}
              style={TEXTAREA_STYLE}
            />
          </div>
        </div>
      </Modal>

      {/* ── Delete confirmation ──────────────────────────────────────────────── */}
      <Modal
        open={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        title="Delete node?"
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete}>Delete</Button>
          </div>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)', fontSize: 13 }}>
          <AlertCircle size={16} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
          This will delete the node and all its descendants.
        </div>
      </Modal>

      <style>{`
        .app-layout { display: flex; height: 100vh; overflow: hidden; background: var(--bg-primary); position: relative; }
        .main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
        .toolbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 12px; border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
          background: var(--bg-secondary); gap: 8px; flex-shrink: 0;
        }
        .toolbar-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .toolbar-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .session-label { font-size: 13px; font-weight: 500; color: var(--text-primary); display: flex; align-items: center; gap: 8px; }
        .node-count { font-size: 11px; color: var(--text-muted); background: var(--bg-tertiary); padding: 1px 6px; border-radius: 9999px; }
        .view-toggle { display: flex; border: 1px solid var(--border-color, rgba(255,255,255,0.1)); border-radius: var(--radius-md); overflow: hidden; }
        .toggle-opt {
          display: flex; align-items: center; justify-content: center;
          padding: 5px 9px; background: transparent; border: none; cursor: pointer;
          color: var(--text-secondary); transition: all 0.15s;
        }
        .toggle-opt:hover { color: var(--text-primary); background: var(--bg-tertiary); }
        .toggle-opt.active { background: var(--color-primary); color: #fff; }
        .view-area { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
        .sidebar-toggle {
          display: none; position: absolute; top: 10px; left: 10px; z-index: 20;
          background: var(--bg-secondary); border: 1px solid var(--border-color, rgba(255,255,255,0.1));
          border-radius: var(--radius-md); padding: 6px; cursor: pointer; color: var(--text-secondary);
        }
        @media (max-width: 768px) {
          .app-layout { flex-direction: column; }
          .sidebar-toggle { display: flex; }
          .toolbar { padding-left: 44px; }
        }
      `}</style>
    </div>
  )
}
