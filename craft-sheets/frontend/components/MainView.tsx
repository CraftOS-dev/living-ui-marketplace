import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { CellAlign, CellFormat, ColumnType, Sheet, SheetSummary } from '../types'
import {
  addColumn,
  addRow,
  autofill,
  deleteColumn,
  deleteRow,
  getCellFormat,
  getSelectionRefs,
  insertColumn,
  insertRow,
  makeRef,
  parseRef,
  pasteRange,
  pasteRangeFull,
  renameColumn,
  setCellRaw,
  setColumnType,
  setColumnWidth,
  setFreezePanes,
  setRangeFormat,
  setRowHeight,
  type CellRect,
} from '../utils/grid'
import { exportSheet, exportWorkbook, importWorkbook } from '../utils/fileio'
import { Alert, Button, Modal } from './ui'
import { Toolbar } from './Toolbar'
import { FormulaBar } from './FormulaBar'
import { Grid } from './Grid'
import { SheetTabs } from './SheetTabs'
import { ColumnMenu } from './ColumnMenu'
import { RowMenu } from './RowMenu'
import { FindReplace } from './FindReplace'

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  const [sheets, setSheets] = useState<SheetSummary[]>([])
  const [active, setActive] = useState<Sheet | null>(null)
  const [selectedRef, setSelectedRef] = useState('A1')
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null)
  const [ctrlSelectedRefs, setCtrlSelectedRefs] = useState<Set<string>>(new Set())
  const undoStack = useRef<Sheet[]>([])
  const redoStack = useRef<Sheet[]>([])
  const [undoAvailable, setUndoAvailable] = useState(false)
  const [redoAvailable, setRedoAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [colMenu, setColMenu] = useState<{ index: number; anchor: { x: number; y: number } } | null>(null)
  const [rowMenu, setRowMenu] = useState<{ index: number; anchor: { x: number; y: number } } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SheetSummary | null>(null)
  const [findOpen, setFindOpen] = useState(false)

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
      if (active) {
        undoStack.current = [...undoStack.current.slice(-49), active]
        setUndoAvailable(true)
      }
      // A fresh edit invalidates redo history.
      redoStack.current = []
      setRedoAvailable(false)
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
    [active, controller]
  )

  const applyWithoutUndo = useCallback(
    async (prev: Sheet) => {
      setActive(prev)
      try {
        const saved = await controller.saveSheet(prev)
        setActive(saved)
        setSheets((list) =>
          list.map((s) =>
            s.id === saved.id
              ? { ...s, name: saved.name, numCols: saved.columns.length, numRows: saved.numRows }
              : s
          )
        )
      } catch {
        toast.error('Failed to undo')
      }
    },
    [controller]
  )

  // --- selection handlers ---------------------------------------------------
  const handleSelect = useCallback((ref: string) => {
    setSelectedRef(ref)
    setSelectionEnd(null)
    setCtrlSelectedRefs(new Set())
  }, [])

  const handleSelectionEnd = useCallback((end: string | null) => {
    setSelectionEnd(end)
  }, [])

  const handleCtrlSelect = useCallback((ref: string) => {
    setCtrlSelectedRefs((prev) => {
      const next = new Set(prev)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  }, [])

  const handleUndo = useCallback(() => {
    const prev = undoStack.current[undoStack.current.length - 1]
    if (!prev) return
    undoStack.current = undoStack.current.slice(0, -1)
    setUndoAvailable(undoStack.current.length > 0)
    if (active) {
      redoStack.current = [...redoStack.current.slice(-49), active]
      setRedoAvailable(true)
    }
    applyWithoutUndo(prev)
  }, [applyWithoutUndo, active])

  const handleRedo = useCallback(() => {
    const next = redoStack.current[redoStack.current.length - 1]
    if (!next) return
    redoStack.current = redoStack.current.slice(0, -1)
    setRedoAvailable(redoStack.current.length > 0)
    if (active) {
      undoStack.current = [...undoStack.current.slice(-49), active]
      setUndoAvailable(true)
    }
    applyWithoutUndo(next)
  }, [applyWithoutUndo, active])

  const effectiveRefs = useMemo(() => {
    const rectRefs = selectionEnd ? getSelectionRefs(selectedRef, selectionEnd) : [selectedRef]
    return [...new Set([...rectRefs, ...ctrlSelectedRefs])]
  }, [selectedRef, selectionEnd, ctrlSelectedRefs])

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
    const bold = !getCellFormat(active, selectedRef).bold
    applyAndSave(setRangeFormat(active, effectiveRefs, { bold: bold || undefined }))
  }
  const toggleItalic = () => {
    if (!active) return
    const italic = !getCellFormat(active, selectedRef).italic
    applyAndSave(setRangeFormat(active, effectiveRefs, { italic: italic || undefined }))
  }
  const toggleUnderline = () => {
    if (!active) return
    const underline = !getCellFormat(active, selectedRef).underline
    applyAndSave(setRangeFormat(active, effectiveRefs, { underline: underline || undefined }))
  }
  const alignCell = (align: CellAlign) =>
    active && applyAndSave(setRangeFormat(active, effectiveRefs, { align }))
  const backgroundCell = (color: string | null) =>
    active && applyAndSave(setRangeFormat(active, effectiveRefs, { bg: color }))

  const fontColorCell = (color: string | null) =>
    active && applyAndSave(setRangeFormat(active, effectiveRefs, { color: color ?? undefined }))

  const handleClearSelection = useCallback(() => {
    if (!active) return
    let next = active
    for (const ref of effectiveRefs) next = setCellRaw(next, ref, '')
    applyAndSave(next)
  }, [active, effectiveRefs, applyAndSave])

  const handlePaste = useCallback(
    (values: string[][]) => {
      if (!active) return
      applyAndSave(pasteRange(active, selectedRef, values))
    },
    [active, selectedRef, applyAndSave]
  )

  const handleRichPaste = useCallback(
    (cells: { raw: string; format: CellFormat | null }[][]) => {
      if (!active) return
      applyAndSave(pasteRangeFull(active, selectedRef, cells))
    },
    [active, selectedRef, applyAndSave]
  )

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
  const handleResizeColumn = (index: number, width: number) =>
    active && applyAndSave(setColumnWidth(active, index, width))
  const handleResizeRow = (row: number, height: number) =>
    active && applyAndSave(setRowHeight(active, row, height))
  const handleInsertRow = (index: number, side: 'above' | 'below') =>
    active && applyAndSave(insertRow(active, side === 'above' ? index : index + 1))
  const handleInsertColumn = (index: number, side: 'left' | 'right') =>
    active && applyAndSave(insertColumn(active, side === 'left' ? index : index + 1))
  const handleAutofill = (source: CellRect, target: CellRect) =>
    active && applyAndSave(autofill(active, source, target))
  const handleToggleFreezeRow = () =>
    active && applyAndSave(setFreezePanes(active, active.frozenRows > 0 ? 0 : 1, active.frozenCols))
  const handleToggleFreezeCol = () =>
    active && applyAndSave(setFreezePanes(active, active.frozenRows, active.frozenCols > 0 ? 0 : 1))

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
      handleSelect('A1')
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
      handleSelect('A1')
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
        handleSelect('A1')
      }
      toast.success(`Deleted "${target.name}"`)
    } catch {
      toast.error('Could not delete the sheet')
    }
  }

  // --- import / export ------------------------------------------------------
  const handleImport = async (file: File) => {
    try {
      const inputs = await importWorkbook(file)
      if (inputs.length === 0) throw new Error('empty workbook')
      const created: Sheet[] = []
      for (const input of inputs) {
        created.push(await controller.createSheet(input))
      }
      await refreshSheets()
      setActive(created[0])
      handleSelect('A1')
      controller.rememberLastSheet(created[0].id)
      toast.success(
        created.length === 1
          ? `Imported "${created[0].name}"`
          : `Imported ${created.length} sheets from "${file.name}"`
      )
    } catch (err) {
      console.error('[Craft Sheets] import failed', err)
      toast.error('Could not import that file')
    }
  }

  const handleExport = async (format: 'csv' | 'xlsx') => {
    if (!active) return
    try {
      if (format === 'csv') {
        exportSheet(active, 'csv')
        return
      }
      const fullSheets = await Promise.all(sheets.map((s) => controller.getSheet(s.id)))
      exportWorkbook(fullSheets, 'xlsx')
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
        onToggleItalic={toggleItalic}
        onToggleUnderline={toggleUnderline}
        onAlign={alignCell}
        onBackground={backgroundCell}
        onFontColor={fontColorCell}
        onImport={handleImport}
        onExport={handleExport}
        onUndo={handleUndo}
        onRedo={handleRedo}
        undoAvailable={undoAvailable}
        redoAvailable={redoAvailable}
        onOpenFind={() => setFindOpen(true)}
        frozenRows={active?.frozenRows ?? 0}
        frozenCols={active?.frozenCols ?? 0}
        onToggleFreezeRow={handleToggleFreezeRow}
        onToggleFreezeCol={handleToggleFreezeCol}
      />

      <FormulaBar selectedRef={selectedRef} raw={selectedRaw} onCommit={(raw) => commitCell(selectedRef, raw)} />

      {active && (
        <Grid
          sheet={active}
          selectedRef={selectedRef}
          selectionEnd={selectionEnd}
          ctrlSelectedRefs={ctrlSelectedRefs}
          onSelect={handleSelect}
          onSelectionEnd={handleSelectionEnd}
          onCtrlSelect={handleCtrlSelect}
          onCommitCell={commitCell}
          onOpenColumnMenu={(index, anchor) => setColMenu({ index, anchor })}
          onOpenRowMenu={(index, anchor) => setRowMenu({ index, anchor })}
          onResizeColumn={handleResizeColumn}
          onResizeRow={handleResizeRow}
          onPaste={handlePaste}
          onRichPaste={handleRichPaste}
          onToggleBold={toggleBold}
          onToggleItalic={toggleItalic}
          onToggleUnderline={toggleUnderline}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClearSelection={handleClearSelection}
          onAutofill={handleAutofill}
          onOpenFind={() => setFindOpen(true)}
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
          onInsertLeft={(index) => handleInsertColumn(index, 'left')}
          onInsertRight={(index) => handleInsertColumn(index, 'right')}
          onDelete={handleDeleteColumnByIndex}
          onClose={() => setColMenu(null)}
        />
      )}

      {rowMenu && active && (
        <RowMenu
          index={rowMenu.index}
          anchor={rowMenu.anchor}
          canDelete={active.numRows > 1}
          onInsertAbove={(index) => handleInsertRow(index, 'above')}
          onInsertBelow={(index) => handleInsertRow(index, 'below')}
          onDelete={() => applyAndSave(deleteRow(active, rowMenu.index))}
          onClose={() => setRowMenu(null)}
        />
      )}

      {findOpen && active && (
        <FindReplace
          sheet={active}
          onSelect={handleSelect}
          onReplaceOne={(ref, raw) => commitCell(ref, raw)}
          onReplaceAll={(replacements) => {
            let next = active
            for (const { ref, raw } of replacements) next = setCellRaw(next, ref, raw)
            applyAndSave(next)
          }}
          onClose={() => setFindOpen(false)}
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
