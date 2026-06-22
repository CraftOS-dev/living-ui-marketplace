import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { CellAlign, ColumnType, Sheet, SheetSummary } from '../types'
import {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  getCellFormat,
  makeRef,
  parseRef,
  renameColumn,
  setCellFormat,
  setCellRaw,
  setColumnType,
} from '../utils/grid'
import { exportSheet, importFile } from '../utils/fileio'
import { Alert, Button, Modal } from './ui'
import { Toolbar } from './Toolbar'
import { FormulaBar } from './FormulaBar'
import { Grid } from './Grid'
import { SheetTabs } from './SheetTabs'
import { ColumnMenu } from './ColumnMenu'

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  const [sheets, setSheets] = useState<SheetSummary[]>([])
  const [active, setActive] = useState<Sheet | null>(null)
  const [selectedRef, setSelectedRef] = useState('A1')
  const [loading, setLoading] = useState(true)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [colMenu, setColMenu] = useState<{ index: number; anchor: { x: number; y: number } } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SheetSummary | null>(null)

  useAgentAware('MainView', {
    activeSheet: active?.name ?? null,
    sheetCount: sheets.length,
    selectedCell: selectedRef,
  })

  // --- initial load ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ok = await controller.healthCheck()
      if (!ok) {
        if (!cancelled) {
          setFatalError('Cannot reach the Craft Sheets backend. Make sure it is running.')
          setLoading(false)
        }
        return
      }
      try {
        let list = await controller.listSheets()
        let current: Sheet
        if (list.length === 0) {
          current = await controller.createSheet({ name: 'Sheet 1' })
          list = await controller.listSheets()
        } else {
          const lastId = controller.getLastSheetId()
          const pick = list.find((s) => s.id === lastId) ?? list[0]
          current = await controller.getSheet(pick.id)
        }
        if (cancelled) return
        setSheets(list)
        setActive(current)
        controller.rememberLastSheet(current.id)
      } catch (err) {
        if (!cancelled) setFatalError(String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [controller])

  // Keep the selection inside the active sheet's bounds.
  useEffect(() => {
    if (!active) return
    const pos = parseRef(selectedRef) ?? { col: 0, row: 0 }
    const col = Math.max(0, Math.min(pos.col, active.columns.length - 1))
    const row = Math.max(0, Math.min(pos.row, active.numRows - 1))
    const clamped = makeRef(col, row)
    if (clamped !== selectedRef) setSelectedRef(clamped)
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- persistence helper ---------------------------------------------------
  const applyAndSave = useCallback(
    async (next: Sheet) => {
      setActive(next) // optimistic
      try {
        const saved = await controller.saveSheet(next)
        setActive(saved)
        setSheets((prev) =>
          prev.map((s) =>
            s.id === saved.id
              ? { ...s, name: saved.name, numCols: saved.columns.length, numRows: saved.numRows }
              : s
          )
        )
      } catch (err) {
        toast.error('Failed to save changes')
        console.error('[Craft Sheets] save failed', err)
      }
    },
    [controller]
  )

  // --- cell + formatting handlers ------------------------------------------
  const commitCell = useCallback(
    (ref: string, raw: string) => {
      if (!active) return
      applyAndSave(setCellRaw(active, ref, raw))
    },
    [active, applyAndSave]
  )

  const toggleBold = () => {
    if (!active) return
    const fmt = getCellFormat(active, selectedRef)
    applyAndSave(setCellFormat(active, selectedRef, { bold: !fmt.bold }))
  }
  const alignCell = (align: CellAlign) =>
    active && applyAndSave(setCellFormat(active, selectedRef, { align }))
  const backgroundCell = (color: string | null) =>
    active && applyAndSave(setCellFormat(active, selectedRef, { bg: color }))

  // --- structural handlers --------------------------------------------------
  const handleAddRow = () => active && applyAndSave(addRow(active))
  const handleAddColumn = () => active && applyAndSave(addColumn(active))
  const handleDeleteRow = () => {
    if (!active) return
    const row = parseRef(selectedRef)?.row ?? 0
    applyAndSave(deleteRow(active, row))
  }
  const handleDeleteColumn = () => {
    if (!active) return
    const col = parseRef(selectedRef)?.col ?? 0
    applyAndSave(deleteColumn(active, col))
  }

  // --- sheet (tab) handlers -------------------------------------------------
  const refreshSheets = useCallback(async () => {
    const list = await controller.listSheets()
    setSheets(list)
    return list
  }, [controller])

  const switchSheet = async (id: number) => {
    if (active?.id === id) return
    try {
      const full = await controller.getSheet(id)
      setActive(full)
      setSelectedRef('A1')
      controller.rememberLastSheet(id)
    } catch {
      toast.error('Could not open that sheet')
    }
  }

  const addSheet = async () => {
    try {
      const created = await controller.createSheet({ name: `Sheet ${sheets.length + 1}` })
      await refreshSheets()
      setActive(created)
      setSelectedRef('A1')
      controller.rememberLastSheet(created.id)
    } catch {
      toast.error('Could not create a sheet')
    }
  }

  const renameSheet = async (id: number, name: string) => {
    try {
      if (active && active.id === id) {
        await applyAndSave({ ...active, name })
      } else {
        const full = await controller.getSheet(id)
        await controller.saveSheet({ ...full, name })
        await refreshSheets()
      }
    } catch {
      toast.error('Could not rename the sheet')
    }
  }

  const doDeleteSheet = async (target: SheetSummary) => {
    setConfirmDelete(null)
    try {
      await controller.deleteSheet(target.id)
      const list = await refreshSheets()
      if (active?.id === target.id) {
        if (list.length > 0) {
          const next = await controller.getSheet(list[0].id)
          setActive(next)
          controller.rememberLastSheet(next.id)
        } else {
          const fresh = await controller.createSheet({ name: 'Sheet 1' })
          await refreshSheets()
          setActive(fresh)
          controller.rememberLastSheet(fresh.id)
        }
        setSelectedRef('A1')
      }
      toast.success(`Deleted "${target.name}"`)
    } catch {
      toast.error('Could not delete the sheet')
    }
  }

  // --- import / export ------------------------------------------------------
  const handleImport = async (file: File) => {
    try {
      const input = await importFile(file)
      const created = await controller.createSheet(input)
      await refreshSheets()
      setActive(created)
      setSelectedRef('A1')
      controller.rememberLastSheet(created.id)
      toast.success(`Imported "${created.name}"`)
    } catch (err) {
      console.error('[Craft Sheets] import failed', err)
      toast.error('Could not import that file')
    }
  }

  const handleExport = (format: 'csv' | 'xlsx') => {
    if (!active) return
    try {
      exportSheet(active, format)
    } catch {
      toast.error('Export failed')
    }
  }

  // --- column menu actions --------------------------------------------------
  const handleRenameColumn = (index: number, name: string) =>
    active && applyAndSave(renameColumn(active, index, name))
  const handleRetypeColumn = (index: number, type: ColumnType) =>
    active && applyAndSave(setColumnType(active, index, type))
  const handleDeleteColumnByIndex = (index: number) =>
    active && applyAndSave(deleteColumn(active, index))

  const selectedRaw = useMemo(
    () => active?.cells[selectedRef]?.raw ?? '',
    [active, selectedRef]
  )
  const selectedFormat = active ? getCellFormat(active, selectedRef) : {}

  // --- render ---------------------------------------------------------------
  if (loading) {
    return (
      <div style={centerStyle}>
        <div className="craft-sheets-spinner" />
        <p style={{ color: 'var(--text-secondary)', marginTop: 'var(--space-3)' }}>Loading Craft Sheets…</p>
        <style>{spinnerCss}</style>
      </div>
    )
  }

  if (fatalError) {
    return (
      <div style={{ ...centerStyle, padding: 'var(--space-6)' }}>
        <div style={{ maxWidth: 420, width: '100%' }}>
          <Alert variant="error" title="Backend unavailable">
            {fatalError}
          </Alert>
          <div style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Toolbar
        format={selectedFormat}
        onNewSheet={addSheet}
        onAddRow={handleAddRow}
        onAddColumn={handleAddColumn}
        onDeleteRow={handleDeleteRow}
        onDeleteColumn={handleDeleteColumn}
        onToggleBold={toggleBold}
        onAlign={alignCell}
        onBackground={backgroundCell}
        onImport={handleImport}
        onExport={handleExport}
      />

      <FormulaBar selectedRef={selectedRef} raw={selectedRaw} onCommit={(raw) => commitCell(selectedRef, raw)} />

      {active && (
        <Grid
          sheet={active}
          selectedRef={selectedRef}
          onSelect={setSelectedRef}
          onCommitCell={commitCell}
          onOpenColumnMenu={(index, anchor) => setColMenu({ index, anchor })}
        />
      )}

      <SheetTabs
        sheets={sheets}
        activeId={active?.id ?? null}
        onSelect={switchSheet}
        onAdd={addSheet}
        onRename={renameSheet}
        onDelete={(id) => {
          const target = sheets.find((s) => s.id === id)
          if (target) setConfirmDelete(target)
        }}
      />

      {colMenu && active && (
        <ColumnMenu
          index={colMenu.index}
          column={active.columns[colMenu.index]}
          anchor={colMenu.anchor}
          canDelete={active.columns.length > 1}
          onRename={handleRenameColumn}
          onRetype={handleRetypeColumn}
          onDelete={handleDeleteColumnByIndex}
          onClose={() => setColMenu(null)}
        />
      )}

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete sheet?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => confirmDelete && doDeleteSheet(confirmDelete)}>
              Delete
            </Button>
          </>
        }
      >
        This will permanently delete <strong>{confirmDelete?.name}</strong> and all of its data.
      </Modal>
    </div>
  )
}

const centerStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
}

const spinnerCss = `
  .craft-sheets-spinner {
    width: 32px; height: 32px;
    border: 3px solid var(--border-primary);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
`
