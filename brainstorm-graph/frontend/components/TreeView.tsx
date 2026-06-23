import { useState } from 'react'
import { ChevronRight, ChevronDown, Bot, Expand, MessageSquare, Plus, Trash2 } from 'lucide-react'
import type { BrainstormNode } from '../types'

const TYPE_COLORS: Record<string, string> = {
  question: 'var(--color-info, #3b82f6)',
  answer: 'var(--color-success, #22c55e)',
  idea: 'var(--color-primary, #FF4F18)',
}

interface Props {
  nodes: BrainstormNode[]
  expandingNodeId: number | null
  onExpand: (id: number) => void
  onAnswer: (id: number) => void
  onDelete: (id: number) => void
  onAddChild: (parentId: number) => void
  onEdit: (id: number) => void
}

interface NodeRowProps {
  node: BrainstormNode
  nodes: BrainstormNode[]
  depth: number
  expandingNodeId: number | null
  onExpand: (id: number) => void
  onAnswer: (id: number) => void
  onDelete: (id: number) => void
  onAddChild: (parentId: number) => void
  onEdit: (id: number) => void
}

function NodeRow({ node, nodes, depth, expandingNodeId, onExpand, onAnswer, onDelete, onAddChild, onEdit }: NodeRowProps) {
  const [open, setOpen] = useState(true)
  const children = nodes.filter(n => n.parentId === node.id)
  const color = TYPE_COLORS[node.nodeType] || TYPE_COLORS.idea
  const isExpanding = expandingNodeId === node.id

  return (
    <div className="tree-node">
      <div
        className="tree-row"
        style={{ paddingLeft: depth * 18 + 8 }}
        onClick={() => onEdit(node.id)}
        title="Click to view/edit"
      >
        <button className="toggle-btn" onClick={e => { e.stopPropagation(); setOpen(o => !o) }}>
          {children.length > 0
            ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)
            : <span style={{ display: 'inline-block', width: 12 }} />}
        </button>

        <span className="type-dot" style={{ background: color }} title={node.nodeType} />

        <span className="row-content" title={node.content}>{node.content}</span>

        {node.createdBy === 'agent' && <Bot size={10} className="agent-icon" />}
        {isExpanding && <span className="spin-sm">⟳</span>}

        <div className="row-actions" onClick={e => e.stopPropagation()}>
          <button className="row-btn" onClick={() => onExpand(node.id)} title="Expand with AI" disabled={isExpanding}>
            <Expand size={10} />
          </button>
          {node.nodeType === 'question' && (
            <button className="row-btn" onClick={() => onAnswer(node.id)} title="Answer with AI" disabled={isExpanding}>
              <MessageSquare size={10} />
            </button>
          )}
          <button className="row-btn" onClick={() => onAddChild(node.id)} title="Add child">
            <Plus size={10} />
          </button>
          <button className="row-btn danger" onClick={() => onDelete(node.id)} title="Delete">
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {open && children.map(child => (
        <NodeRow
          key={child.id}
          node={child}
          nodes={nodes}
          depth={depth + 1}
          expandingNodeId={expandingNodeId}
          onExpand={onExpand}
          onAnswer={onAnswer}
          onDelete={onDelete}
          onAddChild={onAddChild}
          onEdit={onEdit}
        />
      ))}

      <style>{`
        .tree-node { display: flex; flex-direction: column; }
        .tree-row {
          display: flex; align-items: center; gap: 6px; padding-top: 4px; padding-bottom: 4px;
          padding-right: 8px; border-radius: var(--radius-sm); cursor: default;
          transition: background 0.1s;
        }
        .tree-row:hover { background: var(--bg-tertiary); }
        .toggle-btn { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 0; display: flex; align-items: center; flex-shrink: 0; }
        .type-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .row-content { flex: 1; font-size: 12.5px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .agent-icon { color: var(--text-muted); flex-shrink: 0; }
        .spin-sm { font-size: 12px; color: var(--text-muted); animation: spin 1s linear infinite; flex-shrink: 0; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .row-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; flex-shrink: 0; }
        .tree-row:hover .row-actions { opacity: 1; }
        .row-btn {
          display: flex; align-items: center; justify-content: center;
          padding: 3px; background: transparent; border: none; cursor: pointer;
          color: var(--text-secondary); border-radius: 3px; transition: all 0.15s;
        }
        .row-btn:hover { background: var(--bg-secondary); color: var(--text-primary); }
        .row-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .row-btn.danger:hover { color: var(--color-error, #ef4444); }
      `}</style>
    </div>
  )
}

export function TreeView({ nodes, expandingNodeId, onExpand, onAnswer, onDelete, onAddChild, onEdit }: Props) {
  const roots = nodes.filter(n => n.parentId === null)

  if (nodes.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        No nodes yet. Create a session to start.
      </div>
    )
  }

  return (
    <div className="tree-view">
      {roots.map(root => (
        <NodeRow
          key={root.id}
          node={root}
          nodes={nodes}
          depth={0}
          expandingNodeId={expandingNodeId}
          onExpand={onExpand}
          onAnswer={onAnswer}
          onDelete={onDelete}
          onAddChild={onAddChild}
          onEdit={onEdit}
        />
      ))}
      <style>{`
        .tree-view { padding: 8px 4px; overflow-y: auto; height: 100%; }
      `}</style>
    </div>
  )
}
