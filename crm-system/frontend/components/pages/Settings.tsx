import { useCallback, useEffect, useState } from 'react'
import { Database, Mail, Plus, Sparkles, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'

import type { AiStatus, EmailTemplate, SmtpConfig } from '@/types'
import type { AuthUser } from '@/auth_types'
import { api } from '@/api'
import { authService } from '@/services/AuthService'
import { BACKEND_URL } from '@/api'
import { useAuth } from '@/components/auth/AuthProvider'
import { useUiActions } from '@/components/MainView'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { RecordAvatar } from '@/components/common/RecordAvatar'

export function Settings() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4 pl-14 md:p-6 md:pl-6">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Tabs defaultValue="email">
          <TabsList>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
            {isAdmin ? <TabsTrigger value="team">Team</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="email">
            <EmailSettings isAdmin={isAdmin} />
          </TabsContent>
          <TabsContent value="templates">
            <TemplateSettings />
          </TabsContent>
          <TabsContent value="data">
            <DataSettings isAdmin={isAdmin} />
          </TabsContent>
          <TabsContent value="ai">
            <AiSettings />
          </TabsContent>
          {isAdmin ? (
            <TabsContent value="team">
              <TeamSettings />
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    </div>
  )
}

// ── Email / SMTP ────────────────────────────────────────────────────────────

function EmailSettings({ isAdmin }: { isAdmin: boolean }) {
  const [config, setConfig] = useState<SmtpConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    api.email.config().then(setConfig).catch(() => toast.error('Could not load SMTP config'))
  }, [])

  const save = async () => {
    if (!config) return
    setSaving(true)
    try {
      const saved = await api.email.saveConfig({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        from_email: config.fromEmail,
        from_name: config.fromName,
        use_tls: config.useTls,
      })
      setConfig(saved)
      toast.success('SMTP settings saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const result = await api.email.testConfig()
      if (result.ok) toast.success('Test email sent — check your inbox')
      else toast.error(result.error || 'Test failed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  if (!config) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4" /> SMTP email
          {config.configured ? <Badge variant="secondary">Configured</Badge> : <Badge variant="outline">Not configured</Badge>}
        </CardTitle>
        <CardDescription>
          {isAdmin
            ? 'Emails composed on records send through this server and are logged to the timeline.'
            : 'Only workspace admins can change SMTP settings.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>SMTP host</Label>
            <Input
              placeholder="smtp.example.com"
              disabled={!isAdmin}
              value={config.host}
              onChange={(event) => setConfig({ ...config, host: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Port</Label>
            <Input
              type="number"
              disabled={!isAdmin}
              value={config.port}
              onChange={(event) => setConfig({ ...config, port: Number(event.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input
              disabled={!isAdmin}
              value={config.username}
              onChange={(event) => setConfig({ ...config, username: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input
              type="password"
              disabled={!isAdmin}
              value={config.password}
              onChange={(event) => setConfig({ ...config, password: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>From email</Label>
            <Input
              type="email"
              placeholder="you@company.com"
              disabled={!isAdmin}
              value={config.fromEmail}
              onChange={(event) => setConfig({ ...config, fromEmail: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>From name</Label>
            <Input
              disabled={!isAdmin}
              value={config.fromName}
              onChange={(event) => setConfig({ ...config, fromName: event.target.value })}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <Switch
            disabled={!isAdmin}
            checked={config.useTls}
            onCheckedChange={(checked) => setConfig({ ...config, useTls: checked })}
          />
          Use TLS (STARTTLS on 587, SSL on 465)
        </label>
        {isAdmin ? (
          <div className="flex gap-2">
            <Button onClick={save} loading={saving}>
              Save settings
            </Button>
            <Button variant="outline" onClick={test} loading={testing} disabled={!config.configured}>
              Send test email
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ── Templates ───────────────────────────────────────────────────────────────

function TemplateSettings() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [editing, setEditing] = useState<EmailTemplate | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    api.email.templates().then(setTemplates).catch(() => toast.error('Could not load templates'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      if (editing.id) await api.email.updateTemplate(editing.id, { name: editing.name, subject: editing.subject, body: editing.body })
      else await api.email.createTemplate({ name: editing.name, subject: editing.subject, body: editing.body })
      toast.success('Template saved')
      setEditing(null)
      load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (template: EmailTemplate) => {
    await api.email.removeTemplate(template.id)
    toast.success('Template deleted')
    load()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email templates</CardTitle>
        <CardDescription>
          Reusable emails with variables: {'{{first_name}}, {{name}}, {{company}}, {{deal}}'} fill in at send time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <div className="space-y-2.5 rounded-md border border-border p-3">
            <Input
              placeholder="Template name"
              value={editing.name}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
            <Input
              placeholder="Subject — e.g. Next steps, {{first_name}}"
              value={editing.subject}
              onChange={(event) => setEditing({ ...editing, subject: event.target.value })}
            />
            <Textarea
              rows={7}
              placeholder="Body…"
              value={editing.body}
              onChange={(event) => setEditing({ ...editing, body: event.target.value })}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} loading={saving} disabled={!editing.name.trim()}>
                Save template
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setEditing({ id: 0, name: '', subject: '', body: '', createdAt: null, updatedAt: null })
            }
          >
            <Plus /> New template
          </Button>
        )}
        <div className="space-y-1">
          {templates.map((template) => (
            <div key={template.id} className="group flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{template.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{template.subject}</div>
              </div>
              <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100" onClick={() => setEditing(template)}>
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 hover:text-destructive group-hover:opacity-100"
                onClick={() => remove(template)}
                aria-label="Delete template"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {templates.length === 0 && !editing ? (
            <p className="text-[13px] text-muted-foreground">No templates yet.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Data (seed / clear / export) ────────────────────────────────────────────

function DataSettings({ isAdmin }: { isAdmin: boolean }) {
  const { refreshLists } = useUiActions()
  const [seeding, setSeeding] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  const seed = async () => {
    setSeeding(true)
    try {
      await api.dataio.seedDemo()
      toast.success('Demo data loaded')
      refreshLists()
      window.dispatchEvent(new CustomEvent('crm:data-changed', { detail: { seed: true } }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Seeding failed')
    } finally {
      setSeeding(false)
    }
  }

  const clear = async () => {
    setClearing(true)
    try {
      await api.dataio.seedClear()
      toast.success('Workspace cleared — a fresh Sales Pipeline is ready')
      refreshLists()
      window.dispatchEvent(new CustomEvent('crm:data-changed', { detail: { seed: true } }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Clear failed')
    } finally {
      setClearing(false)
      setConfirmClear(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-4 w-4" /> Workspace data
        </CardTitle>
        <CardDescription>
          Switch between the demo workspace and a clean slate. User accounts and SMTP settings are always kept.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button onClick={seed} loading={seeding} disabled={!isAdmin && false}>
          <Sparkles /> Load demo data
        </Button>
        <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmClear(true)}>
          <Trash2 /> Clear all CRM data
        </Button>
        {!isAdmin ? <p className="w-full text-xs text-muted-foreground">Heads up: this affects everyone in the workspace.</p> : null}

        <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all CRM data?</AlertDialogTitle>
              <AlertDialogDescription>
                Every person, company, deal, list, note, task, and timeline entry is removed for the whole workspace.
                User accounts and SMTP settings are kept. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction destructive onClick={clear}>
                {clearing ? 'Clearing…' : 'Clear everything'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

// ── AI ──────────────────────────────────────────────────────────────────────

function AiSettings() {
  const [status, setStatus] = useState<AiStatus | null>(null)

  useEffect(() => {
    api.ai.status().then(setStatus).catch(() => setStatus({ configured: false, model: '' }))
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> AI features
          {status?.configured ? <Badge variant="secondary">Active · {status.model}</Badge> : <Badge variant="outline">Not configured</Badge>}
        </CardTitle>
        <CardDescription>
          Record summaries, email drafting, lead scoring, and "Ask your CRM" run on demand through CraftBot's LLM
          provider. Nothing runs in the background, and every invocation is audited.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status?.configured ? (
          <p className="text-[13px] text-muted-foreground">
            All AI surfaces are live. Look for the <Sparkles className="inline h-3 w-3" /> icon on record pages, the
            email composer, and the sidebar.
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Connect an LLM provider in CraftBot settings and the AI surfaces light up automatically — no configuration
            needed here.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ── Team (admin) ────────────────────────────────────────────────────────────

function TeamSettings() {
  const [users, setUsers] = useState<AuthUser[]>([])

  useEffect(() => {
    authService
      .authFetch(`${BACKEND_URL}/api/auth/users`)
      .then((response) => response.json())
      .then((data) => setUsers(data.users || []))
      .catch(() => toast.error('Could not load users'))
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" /> Workspace members
        </CardTitle>
        <CardDescription>
          Everyone shares this CRM workspace. New teammates join by registering on the login screen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {users.map((member) => (
          <div key={member.id} className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2">
            <RecordAvatar name={member.username} color="#7c9ce8" size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{member.username}</div>
              <div className="truncate text-[11px] text-muted-foreground">{member.email}</div>
            </div>
            <Badge variant={member.role === 'admin' ? 'default' : 'secondary'}>{member.role}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
