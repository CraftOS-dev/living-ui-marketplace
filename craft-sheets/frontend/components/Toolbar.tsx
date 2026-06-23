import { useRef, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Columns3,
  Download,
  FilePlus2,
  Italic,
  PaintBucket,
  Rows3,
  Trash2,
  Type,
  Underline,
  Upload,
} from 'lucide-react'
import { Button, Divider } from './ui'
import { ColorPicker } from './ColorPicker'
import type { CellAlign, CellFormat } from '../types'

interface ToolbarProps {
  format: CellFormat
  onNewSheet: () => void
  onAddRow: () => void
  onAddColumn: () => void
  onDeleteRow: () => void
  onDeleteColumn: () => void
  onToggleBold: () => void
  onToggleItalic: () => void
  onToggleUnderline: () => void
  onAlign: (align: CellAlign) => void
  onBackground: (color: string | null) => void
  onFontColor: (color: string | null) => void
  onImport: (file: File) => void
  onExport: (format: 'csv' | 'xlsx') => void
}

function Group({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'contents' }}>{children}</div>
}

export function Toolbar(props: ToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const align = props.format.align ?? 'left'

  const [customColors, setCustomColors] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('craft-sheets-custom-colors') ?? '[]') }
    catch { return [] }
  })

  const handleAddCustomColor = (color: string) => {
    setCustomColors((prev) => {
      const next = [color, ...prev.filter((c) => c !== color)].slice(0, 10)
      localStorage.setItem('craft-sheets-custom-colors', JSON.stringify(next))
      return next
    })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        borderBottom: '1px solid var(--border-primary)',
        backgroundColor: 'var(--bg-secondary)',
      }}
    >
      <Group>
        <Button size="sm" variant="primary" icon={<FilePlus2 size={14} />} onClick={props.onNewSheet}>
          New
        </Button>
      </Group>

      <Divider orientation="vertical" spacing="sm" />

      <Group>
        <Button size="sm" variant="secondary" icon={<Rows3 size={14} />} onClick={props.onAddRow}>
          Row
        </Button>
        <Button size="sm" variant="secondary" icon={<Columns3 size={14} />} onClick={props.onAddColumn}>
          Column
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="Delete selected row"
          icon={<Trash2 size={14} />}
          onClick={props.onDeleteRow}
        >
          Row
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="Delete selected column"
          icon={<Trash2 size={14} />}
          onClick={props.onDeleteColumn}
        >
          Col
        </Button>
      </Group>

      <Divider orientation="vertical" spacing="sm" />

      <Group>
        <Button
          size="sm"
          variant={props.format.bold ? 'primary' : 'ghost'}
          title="Bold (Ctrl+B)"
          onClick={props.onToggleBold}
        >
          <Bold size={14} />
        </Button>
        <Button
          size="sm"
          variant={props.format.italic ? 'primary' : 'ghost'}
          title="Italic (Ctrl+I)"
          onClick={props.onToggleItalic}
        >
          <Italic size={14} />
        </Button>
        <Button
          size="sm"
          variant={props.format.underline ? 'primary' : 'ghost'}
          title="Underline (Ctrl+U)"
          onClick={props.onToggleUnderline}
        >
          <Underline size={14} />
        </Button>
        <Button
          size="sm"
          variant={align === 'left' ? 'primary' : 'ghost'}
          title="Align left"
          onClick={() => props.onAlign('left')}
        >
          <AlignLeft size={14} />
        </Button>
        <Button
          size="sm"
          variant={align === 'center' ? 'primary' : 'ghost'}
          title="Align center"
          onClick={() => props.onAlign('center')}
        >
          <AlignCenter size={14} />
        </Button>
        <Button
          size="sm"
          variant={align === 'right' ? 'primary' : 'ghost'}
          title="Align right"
          onClick={() => props.onAlign('right')}
        >
          <AlignRight size={14} />
        </Button>
      </Group>

      <Group>
        <ColorPicker
          icon={<PaintBucket size={14} />}
          label="Fill color"
          currentColor={props.format.bg ?? null}
          onChange={props.onBackground}
          customColors={customColors}
          onAddCustomColor={handleAddCustomColor}
        />
        <ColorPicker
          icon={<Type size={14} />}
          label="Font color"
          currentColor={props.format.color ?? null}
          onChange={props.onFontColor}
          customColors={customColors}
          onAddCustomColor={handleAddCustomColor}
        />
      </Group>

      <Divider orientation="vertical" spacing="sm" />

      <Group>
        <Button
          size="sm"
          variant="secondary"
          icon={<Upload size={14} />}
          onClick={() => fileInput.current?.click()}
        >
          Import
        </Button>
        <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={() => props.onExport('csv')}>
          CSV
        </Button>
        <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={() => props.onExport('xlsx')}>
          Excel
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) props.onImport(file)
            e.target.value = ''
          }}
        />
      </Group>
    </div>
  )
}
