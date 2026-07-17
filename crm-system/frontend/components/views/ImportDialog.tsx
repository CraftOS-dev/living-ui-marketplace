import { useMemo, useRef, useState } from 'react'
import { FileUp, Upload } from 'lucide-react'
import { toast } from 'sonner'

import type { ImportReport, RecordType } from '@/types'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface ImportDialogProps {
  recordType: RecordType
  listId?: number
  open: boolean
  setOpen: (open: boolean) => void
  onImported: () => void
}

/** CSV import with a column-mapping step and dedupe (F2.7). */
export function ImportDialog({ recordType, listId, open, setOpen, onImported }: ImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [fields, setFields] = useState<string[]>([])
  const [dedupe, setDedupe] = useState(true)
  const [importing, setImporting] = useState(false)
  const [report, setReport] = useState<ImportReport | null>(null)

  const rowCount = useMemo(() => Math.max(0, csvText.trim().split('\n').length - 1), [csvText])

  const reset = () => {
    setCsvText('')
    setFileName('')
    setHeaders([])
    setMapping({})
    setReport(null)
  }

  const handleFile = async (file: File) => {
    const text = await file.text()
    setCsvText(text)
    setFileName(file.name)
    setReport(null)

    const firstLine = text.split('\n')[0] || ''
    const parsedHeaders = firstLine.split(',').map((header) => header.trim().replace(/^"|"$/g, ''))
    setHeaders(parsedHeaders)

    const { fields: importableFields } = await api.dataio.importFields(recordType)
    setFields(importableFields)

    // Auto-map on normalized header names
    const auto: Record<string, string> = {}
    for (const header of parsedHeaders) {
      const normalized = header.toLowerCase().replace(/\s+/g, '_')
      if (importableFields.includes(normalized)) auto[header] = normalized
    }
    setMapping(auto)
  }

  const runImport = async () => {
    setImporting(true)
    try {
      const result = await api.dataio.importCsv({
        record_type: recordType,
        csv_text: csvText,
        mapping,
        dedupe,
        ...(listId ? { list_id: listId } : {}),
      })
      setReport(result)
      if (result.created > 0) {
        toast.success(result.message)
        onImported()
      } else {
        toast.info(result.message)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) reset()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import {recordType === 'person' ? 'people' : `${recordType}s`} from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV, map its columns to fields, and we’ll dedupe by {recordType === 'company' ? 'domain' : 'email'}.
          </DialogDescription>
        </DialogHeader>

        {!csvText ? (
          <button
            className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border py-10 text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="h-6 w-6" />
            <span className="text-[13px] font-medium">Choose a CSV file</span>
            <span className="text-xs">First row must be column headers</span>
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px]">
              <span className="truncate font-medium">{fileName}</span>
              <span className="shrink-0 text-muted-foreground">{rowCount} rows</span>
            </div>

            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              <p className="label-caps">Column mapping</p>
              {headers.map((header) => (
                <div key={header} className="flex items-center gap-2">
                  <span className="w-1/2 truncate text-[13px]">{header}</span>
                  <Select
                    value={mapping[header] || 'skip'}
                    onValueChange={(value) =>
                      setMapping((current) => {
                        const next = { ...current }
                        if (value === 'skip') delete next[header]
                        else next[header] = value
                        return next
                      })
                    }
                  >
                    <SelectTrigger className="h-7 w-1/2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">— Skip —</SelectItem>
                      {fields.map((field) => (
                        <SelectItem key={field} value={field}>
                          {field.replace(/_/g, ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={dedupe} onCheckedChange={(checked) => setDedupe(checked === true)} />
              Skip rows matching an existing {recordType === 'company' ? 'domain' : 'email'}
            </label>

            {report ? (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-[13px]">
                <div className="font-medium">{report.message}</div>
                {report.errors.length > 0 ? (
                  <ul className="mt-1 list-inside list-disc text-xs text-destructive">
                    {report.errors.slice(0, 5).map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) handleFile(file)
            event.target.value = ''
          }}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {report ? 'Done' : 'Cancel'}
          </Button>
          {csvText && !report ? (
            <Button onClick={runImport} loading={importing} disabled={Object.keys(mapping).length === 0}>
              <Upload /> Import {rowCount} rows
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
