/**
 * NoteEditor — an inline rich-text note that converts Markdown as you type,
 * Notion/GitHub-style: "# " becomes a heading, "- " a bullet, "1. " a numbered
 * list, "- [ ] " a checkbox, "> " a quote, "```" a code block, **bold**, etc.
 * Built on TipTap (ProseMirror) with StarterKit's input rules; content is
 * stored as Markdown via tiptap-markdown so the `note` field stays portable.
 */
import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import { cn } from '../../kit/index.ts';

export function NoteEditor({
  value,
  resetKey,
  onChange,
  placeholder = 'Write a note — type "# " for a heading, "- " for a list, "- [ ] " for a checkbox…',
  className,
}: {
  /** Current Markdown value. */
  value: string;
  /** When this changes (e.g. a different card), the editor reloads its content. */
  resetKey: string;
  /** Fires on every edit with the serialized Markdown (debounce persistence upstream). */
  onChange: (markdown: string) => void;
  placeholder?: string | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  const loadedKey = useRef<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noreferrer', target: '_blank' } }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ linkify: true }),
    ],
    content: value,
    editorProps: { attributes: { class: 'cos-prose focus:outline-none' } },
    onCreate: () => {
      loadedKey.current = resetKey;
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.storage.markdown.getMarkdown());
    },
  });

  // Reload content only when the card changes — never mid-typing (that would
  // fight the cursor as the debounced save round-trips back through props).
  useEffect(() => {
    if (editor === null || loadedKey.current === resetKey) return;
    loadedKey.current = resetKey;
    editor.commands.setContent(value, false);
  }, [editor, resetKey, value]);

  return <EditorContent editor={editor} className={cn('cos-note', className)} />;
}
