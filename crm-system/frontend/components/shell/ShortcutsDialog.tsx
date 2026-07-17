import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ['⌘', 'K'], description: 'Command palette — search & quick actions' },
  { keys: ['/'], description: 'Search' },
  { keys: ['C'], description: 'Create record in current context' },
  { keys: ['T'], description: 'New task' },
  { keys: ['?'], description: 'This shortcut reference' },
  { keys: ['↑', '↓'], description: 'Move through table rows' },
  { keys: ['Enter'], description: 'Open the focused row' },
  { keys: ['Space'], description: 'Peek the focused row in a side panel' },
  { keys: ['Esc'], description: 'Close panels and dialogs' },
]

export function ShortcutsDialog({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.description} className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 hover:bg-accent/40">
              <span className="text-[13px]">{shortcut.description}</span>
              <span className="flex shrink-0 gap-1">
                {shortcut.keys.map((key) => (
                  <kbd key={key} className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                    {key}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
