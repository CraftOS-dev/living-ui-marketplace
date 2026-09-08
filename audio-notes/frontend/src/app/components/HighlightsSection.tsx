import { useState, useEffect } from 'react';
import type { AudioSession, ActionItem, HighlightSection } from '../types.ts';
import { parseHighlightSections, serializeHighlightSections } from '../utils.ts';
import {
  ListChecks,
  Copy,
  Check,
  Plus,
  Trash2,
  Calendar,
  User,
  CheckSquare2,
  Square,
  ListTodo,
  Edit2,
} from 'lucide-react';

interface HighlightsSectionProps {
  session: AudioSession;
  onUpdateSession: (fields: Partial<AudioSession>) => void;
  onClearCompletedActions?: () => void;
}

export function HighlightsSection({
  session,
  onUpdateSession,
  onClearCompletedActions,
}: HighlightsSectionProps): React.JSX.Element {
  const [sections, setSections] = useState<HighlightSection[]>(() =>
    parseHighlightSections(session.key_highlights)
  );
  const [copiedSectionId, setCopiedSectionId] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);

  // New action item form state
  const [newActionTitle, setNewActionTitle] = useState('');
  const [newActionAssignee, setNewActionAssignee] = useState('');
  const [newActionDueDate, setNewActionDueDate] = useState('');
  const [showAddActionForm, setShowAddActionForm] = useState(false);

  // Sync state when active session changes
  useEffect(() => {
    setSections(parseHighlightSections(session.key_highlights));
  }, [session.id, session.key_highlights]);

  // Update a specific highlight section
  const handleUpdateSectionContent = (id: string, content: string) => {
    const updated = sections.map((s) => (s.id === id ? { ...s, content } : s));
    setSections(updated);
  };

  const handleBlurSectionContent = () => {
    const serialized = serializeHighlightSections(sections);
    if (serialized !== session.key_highlights) {
      onUpdateSession({ key_highlights: serialized });
    }
  };

  const handleUpdateSectionTitle = (id: string, title: string) => {
    const updated = sections.map((s) => (s.id === id ? { ...s, title } : s));
    setSections(updated);
    onUpdateSession({ key_highlights: serializeHighlightSections(updated) });
    setEditingTitleId(null);
  };

  // Add a new highlight section
  const handleAddSection = () => {
    const newSection: HighlightSection = {
      id: `sec-${Date.now()}`,
      title: `Highlights Section ${sections.length + 1}`,
      content: '',
    };
    const updated = [...sections, newSection];
    setSections(updated);
    onUpdateSession({ key_highlights: serializeHighlightSections(updated) });
    setEditingTitleId(newSection.id);
  };

  // Delete a highlight section
  const handleDeleteSection = (id: string) => {
    if (sections.length <= 1) {
      // Clear content rather than removing all
      const cleared = [{ id: 'sec-1', title: 'Key Highlights', content: '' }];
      setSections(cleared);
      onUpdateSession({ key_highlights: serializeHighlightSections(cleared) });
      return;
    }
    const updated = sections.filter((s) => s.id !== id);
    setSections(updated);
    onUpdateSession({ key_highlights: serializeHighlightSections(updated) });
  };

  // Copy section content
  const handleCopySection = (section: HighlightSection) => {
    if (!section.content) return;
    void navigator.clipboard.writeText(`${section.title}\n\n${section.content}`);
    setCopiedSectionId(section.id);
    setTimeout(() => setCopiedSectionId(null), 2000);
  };

  // Action Items methods
  const actionItems: ActionItem[] = session.action_items || [];

  const toggleActionItem = (itemId: string) => {
    const updated = actionItems.map((item) =>
      item.id === itemId ? { ...item, completed: !item.completed } : item
    );
    onUpdateSession({ action_items: updated });
  };

  const deleteActionItem = (itemId: string) => {
    const updated = actionItems.filter((item) => item.id !== itemId);
    onUpdateSession({ action_items: updated });
  };

  const handleAddActionItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newActionTitle.trim()) return;

    const newItem: ActionItem = {
      id: `act-${Date.now()}`,
      title: newActionTitle.trim(),
      completed: false,
      assignee: newActionAssignee.trim() || undefined,
      dueDate: newActionDueDate || undefined,
    };

    onUpdateSession({ action_items: [...actionItems, newItem] });
    setNewActionTitle('');
    setNewActionAssignee('');
    setNewActionDueDate('');
    setShowAddActionForm(false);
  };

  const completedCount = actionItems.filter((i) => i.completed).length;
  const totalCount = actionItems.length;

  return (
    <div className="flex flex-col gap-7">
      {/* Multiple Key Highlights Sections */}
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between pb-2 border-b border-[var(--lui-border)]/40">
          <div className="flex items-center gap-2">
            <ListChecks size={15} className="opacity-70" />
            <h3 className="text-[14px] sm:text-[15px] font-semibold tracking-tight text-[var(--lui-foreground)]">
              Key Highlights & Insights
            </h3>
            <span className="text-xs font-mono tabular-numbers text-[var(--lui-muted)]">
              ({sections.length} {sections.length === 1 ? 'section' : 'sections'})
            </span>
          </div>

          <button
            onClick={handleAddSection}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--lui-foreground)] hover:opacity-80 transition-opacity px-2.5 py-1 rounded-md border border-[var(--lui-border)]/70 hover:bg-[var(--lui-accent)]"
          >
            <Plus size={13} />
            <span>Add Highlights Section</span>
          </button>
        </div>

        {/* List of Highlight Sections */}
        {sections.map((section, index) => (
          <div key={section.id} className="flex flex-col gap-2 group">
            {/* Section Header */}
            <div className="flex items-center justify-between">
              {editingTitleId === section.id ? (
                <div className="flex items-center gap-1.5 flex-1 max-w-sm">
                  <input
                    type="text"
                    defaultValue={section.title}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleUpdateSectionTitle(section.id, e.currentTarget.value);
                      }
                      if (e.key === 'Escape') setEditingTitleId(null);
                    }}
                    onBlur={(e) => handleUpdateSectionTitle(section.id, e.target.value)}
                    className="w-full px-2 py-0.5 text-xs font-semibold rounded bg-[var(--lui-background)] border border-[var(--lui-border)] text-[var(--lui-foreground)] focus:outline-none"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h4
                    onClick={() => setEditingTitleId(section.id)}
                    className="text-[13px] font-semibold text-[var(--lui-foreground)] tracking-tight cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1.5"
                    title="Click to rename section"
                  >
                    <span>{section.title || `Section ${index + 1}`}</span>
                    <Edit2 size={11} className="opacity-0 group-hover:opacity-70 transition-opacity" />
                  </h4>
                </div>
              )}

              <div className="flex items-center gap-2">
                {section.content && (
                  <button
                    onClick={() => handleCopySection(section)}
                    className="flex items-center gap-1 text-[11px] text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] transition-colors"
                  >
                    {copiedSectionId === section.id ? (
                      <Check size={12} className="text-emerald-500" />
                    ) : (
                      <Copy size={12} />
                    )}
                    <span>{copiedSectionId === section.id ? 'Copied' : 'Copy'}</span>
                  </button>
                )}

                {sections.length > 1 && (
                  <button
                    onClick={() => handleDeleteSection(section.id)}
                    title="Delete this highlight section"
                    className="opacity-0 group-hover:opacity-100 p-1 text-[var(--lui-muted)] hover:text-red-500 rounded transition-opacity"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Section Textbox */}
            <textarea
              value={section.content}
              onChange={(e) => handleUpdateSectionContent(section.id, e.target.value)}
              onBlur={handleBlurSectionContent}
              placeholder="• Discussion point or strategic finding&#10;• Metric or takeaway reached&#10;• Critical milestone or blocker"
              rows={6}
              className="doc-textarea w-full p-4 sm:p-5 text-[13.5px] sm:text-[14px] font-sans leading-relaxed text-[var(--lui-foreground)] placeholder:text-[var(--lui-muted)]/50 resize-y min-h-[120px] lg:min-h-[160px]"
            />
          </div>
        ))}
      </div>

      {/* Action Items Box */}
      <div className="doc-box p-4 sm:p-5 lg:p-6 flex flex-col gap-3.5 lg:gap-4">
        <div className="flex items-center justify-between pb-2 border-b border-[var(--lui-border)]/40">
          <div className="flex items-center gap-2">
            <ListTodo size={15} className="opacity-70" />
            <h3 className="text-[14px] sm:text-[15px] font-semibold tracking-tight text-[var(--lui-foreground)]">
              Action Items
            </h3>
            {totalCount > 0 && (
              <span className="text-xs font-mono tabular-numbers text-[var(--lui-muted)]">
                ({completedCount}/{totalCount})
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {completedCount > 0 && onClearCompletedActions && (
              <button
                onClick={onClearCompletedActions}
                className="text-[11px] text-[var(--lui-muted)] hover:text-red-500 transition-colors"
              >
                Clear completed
              </button>
            )}

            <button
              onClick={() => setShowAddActionForm(!showAddActionForm)}
              className="flex items-center gap-1 text-[11px] font-medium text-[var(--lui-foreground)] hover:opacity-80 transition-opacity"
            >
              <Plus size={13} />
              <span>Add task</span>
            </button>
          </div>
        </div>

        {/* Add item inline form */}
        {showAddActionForm && (
          <form
            onSubmit={handleAddActionItem}
            className="p-3 rounded-lg bg-[var(--lui-card)]/40 border border-[var(--lui-border)]/60 flex flex-col gap-2"
          >
            <input
              type="text"
              placeholder="Task title..."
              value={newActionTitle}
              onChange={(e) => setNewActionTitle(e.target.value)}
              autoFocus
              className="w-full px-2.5 py-1 text-xs rounded bg-[var(--lui-background)] border border-[var(--lui-border)]/70 text-[var(--lui-foreground)] focus:outline-none"
            />

            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
              <div className="flex items-center gap-1.5 text-xs text-[var(--lui-muted)] flex-1">
                <User size={12} />
                <input
                  type="text"
                  placeholder="Assignee (e.g. David)"
                  value={newActionAssignee}
                  onChange={(e) => setNewActionAssignee(e.target.value)}
                  className="w-full px-2 py-0.5 text-xs rounded bg-[var(--lui-background)] border border-[var(--lui-border)]/60 text-[var(--lui-foreground)]"
                />
              </div>

              <div className="flex items-center gap-1.5 text-xs text-[var(--lui-muted)]">
                <Calendar size={12} />
                <input
                  type="date"
                  value={newActionDueDate}
                  onChange={(e) => setNewActionDueDate(e.target.value)}
                  className="w-full sm:w-auto px-2 py-0.5 text-xs rounded bg-[var(--lui-background)] border border-[var(--lui-border)]/60 text-[var(--lui-foreground)]"
                />
              </div>

              <div className="flex items-center justify-end gap-1.5 pt-1 sm:pt-0">
                <button
                  type="button"
                  onClick={() => setShowAddActionForm(false)}
                  className="px-2 py-1 text-xs text-[var(--lui-muted)] hover:text-[var(--lui-foreground)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-2.5 py-1 text-xs rounded bg-[var(--lui-foreground)] text-[var(--lui-background)] font-medium"
                >
                  Save
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Task rows */}
        {actionItems.length === 0 ? (
          <p className="text-xs text-[var(--lui-muted)]/70 py-3">
            No action items assigned. Click "+ Add task" to track next steps.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--lui-border)]/30">
            {actionItems.map((item) => (
              <div
                key={item.id}
                className="py-2 flex items-start justify-between gap-3 group"
              >
                <div className="flex items-start gap-2.5 flex-1 min-w-0">
                  <button
                    onClick={() => toggleActionItem(item.id)}
                    className="mt-0.5 text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] transition-colors"
                  >
                    {item.completed ? (
                      <CheckSquare2 size={16} className="text-emerald-500" />
                    ) : (
                      <Square size={16} className="text-[var(--lui-muted)]/60" />
                    )}
                  </button>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 flex-1 min-w-0">
                    <span
                      className={`text-[13px] font-normal leading-snug ${
                        item.completed
                          ? 'line-through text-[var(--lui-muted)]/60'
                          : 'text-[var(--lui-foreground)]'
                      }`}
                    >
                      {item.title}
                    </span>

                    {(item.assignee || item.dueDate) && (
                      <div className="flex items-center gap-2 text-[11px] text-[var(--lui-muted)]/80 font-mono tabular-numbers">
                        {item.assignee && (
                          <span className="px-1.5 py-0.2 rounded bg-[var(--lui-background)] border border-[var(--lui-border)]/40 font-sans">
                            @{item.assignee}
                          </span>
                        )}
                        {item.dueDate && <span>{item.dueDate}</span>}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => deleteActionItem(item.id)}
                  title="Delete item"
                  className="opacity-0 group-hover:opacity-100 p-1 text-[var(--lui-muted)] hover:text-red-500 rounded transition-opacity"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
