import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, FileText, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { formatDateShort } from '@/lib/format'
import type { Attachment, RecordType } from '@/types'
import { api } from '@/api'
import { authService } from '@/services/AuthService'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}

export function FilesTab({ recordType, recordId }: { recordType: RecordType; recordId: number }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(() => {
    api.files
      .list(recordType, recordId)
      .then(setFiles)
      .catch(() => toast.error('Could not load files'))
      .finally(() => setLoading(false))
  }, [recordType, recordId])

  useEffect(() => {
    load()
  }, [load])

  const upload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Files are limited to 10 MB')
      return
    }
    setUploading(true)
    try {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ''
      const chunk = 0x8000
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
      }
      await api.files.upload({
        record_type: recordType,
        record_id: recordId,
        file_name: file.name,
        data_base64: btoa(binary),
      })
      toast.success(`${file.name} uploaded`)
      load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const download = async (attachment: Attachment) => {
    try {
      const response = await authService.authFetch(api.files.downloadUrl(attachment.id))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = attachment.fileName
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Download failed')
    }
  }

  const remove = async (attachment: Attachment) => {
    await api.files.remove(attachment.id)
    toast.success('File deleted')
    load()
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} loading={uploading}>
        <Upload /> Upload file
      </Button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) upload(file)
          event.target.value = ''
        }}
      />

      {files.length === 0 ? (
        <EmptyState
          icon={FileText}
          compact
          title="No files attached"
          description="Contracts, decks, and docs live here (up to 10 MB each)."
        />
      ) : (
        <div className="space-y-1">
          {files.map((attachment) => (
            <div key={attachment.id} className="group flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{attachment.fileName}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatSize(attachment.size)} · {formatDateShort(attachment.createdAt)}
              </span>
              <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <Button variant="ghost" size="icon-sm" onClick={() => download(attachment)} aria-label="Download">
                  <Download />
                </Button>
                <Button variant="ghost" size="icon-sm" className="hover:text-destructive" onClick={() => remove(attachment)} aria-label="Delete">
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
