import { useState } from 'react'
import { toast } from 'sonner'

import { api } from '@/api'
import type { RecordType } from '@/types'
import { navigateTo } from '@/hooks/useHashRoute'
import { useUiActions } from '@/components/MainView'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function CreateListDialog({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const { refreshLists } = useUiActions()
  const [name, setName] = useState('')
  const [parentObject, setParentObject] = useState<RecordType>('deal')
  const [withStages, setWithStages] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!name.trim()) {
      setError('Give your list a name')
      return
    }
    setSubmitting(true)
    try {
      const list = await api.lists.create({
        name: name.trim(),
        parent_object: parentObject,
        with_default_stages: withStages,
      })
      toast.success(`List “${list.name}” created`)
      refreshLists()
      setOpen(false)
      setName('')
      setError('')
      navigateTo(`lists/${list.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create list')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New list</DialogTitle>
          <DialogDescription>
            A list groups records for a workflow — a pipeline, a program, a cohort.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="list-name">Name</Label>
            <Input
              id="list-name"
              autoFocus
              placeholder="e.g. Partnerships pipeline"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError('')
              }}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
            />
            {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label>Records in this list</Label>
            <Select value={parentObject} onValueChange={(value) => setParentObject(value as RecordType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deal">Deals</SelectItem>
                <SelectItem value="person">People</SelectItem>
                <SelectItem value="company">Companies</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={withStages} onCheckedChange={(checked) => setWithStages(checked === true)} />
            Start with default stages (editable on the board)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting}>
            Create list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
