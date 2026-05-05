import { useEffect, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Dialog } from '../components/ui/Dialog'
import { Empty } from '../components/ui/Empty'
import { useToast } from '../components/ui/Toast'
import { api, type Webhook, type WebhookDelivery } from '../lib/api'

const COMMON_EVENTS = [
  '*',
  'auth.login',
  'auth.login.fail',
  'user.create',
  'user.delete',
  'user.password.reset',
  'user.unlock',
  'group.create',
  'group.member.add',
  'self.reset.success',
  'self.mfa.enable',
]

export function Webhooks() {
  const toast = useToast()
  const [items, setItems] = useState<Webhook[] | null>(null)
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null)
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null)

  const load = async () => {
    try {
      const r = await api.listWebhooks()
      setItems(r.items)
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const onDelete = async (w: Webhook) => {
    if (!confirm(`Delete webhook "${w.name}"?`)) return
    try {
      await api.deleteWebhook(w.name)
      toast.ok(`deleted: ${w.name}`)
      load()
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  const onTest = async (w: Webhook) => {
    try {
      await api.testWebhook(w.name)
      toast.ok('test event queued — check deliveries')
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  return (
    <Layout>
      <PageHeader
        title="Webhooks"
        subtitle={items ? `${items.length} configured` : 'loading...'}
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            + new webhook
          </Button>
        }
      />
      <PageBody>
        {items === null ? (
          <div className="label-mono p-8">// loading...</div>
        ) : items.length === 0 ? (
          <Empty
            title="No webhooks configured"
            hint="Webhooks fire on every audit event. Use them to notify Slack, Discord, or any HTTP endpoint."
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                create first webhook
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {items.map((w) => (
              <div key={w.id} className="panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-amber">{w.name}</span>
                      <KindBadge kind={w.kind} />
                      {!w.enabled && (
                        <span className="text-[10px] font-mono uppercase tracking-wider text-ink-500 bg-ink-800 border border-ink-700 px-1.5 py-0.5">
                          disabled
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-ink-300 mt-1 truncate">
                      → {w.url}
                    </div>
                    <div className="font-mono text-xs text-ink-500 mt-1">
                      events: {w.events}
                    </div>
                  </div>
                </div>

                <div className="hairline my-3" />
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setDeliveriesFor(w)}>
                    deliveries
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onTest(w)}>
                    test
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(w)}>
                    edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => onDelete(w)}>
                    delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>

      <WebhookEditor
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
        }}
      />
      <DeliveriesDialog
        webhook={deliveriesFor}
        onClose={() => setDeliveriesFor(null)}
      />
    </Layout>
  )
}

function KindBadge({ kind }: { kind: string }) {
  const colors: Record<string, string> = {
    slack: 'text-amber border-amber/50',
    discord: 'text-amber border-amber/50',
    generic: 'text-ink-300 border-ink-700',
  }
  return (
    <span
      className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 border ${colors[kind] || colors.generic}`}
    >
      {kind}
    </span>
  )
}

function WebhookEditor({
  target,
  onClose,
  onSaved,
}: {
  target: Webhook | 'new' | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const isNew = target === 'new'

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<'generic' | 'slack' | 'discord'>('generic')
  const [secret, setSecret] = useState('')
  const [events, setEvents] = useState('*')
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (target === 'new') {
      setName('')
      setUrl('')
      setKind('generic')
      setSecret('')
      setEvents('*')
      setEnabled(true)
    } else if (target) {
      setName(target.name)
      setUrl(target.url)
      setKind(target.kind)
      setSecret('')
      setEvents(target.events)
      setEnabled(target.enabled)
    }
  }, [target])

  if (!target) return null

  const submit = async () => {
    setBusy(true)
    try {
      await api.saveWebhook({ name, url, kind, secret, events, enabled })
      toast.ok(`saved: ${name}`)
      onSaved()
    } catch (e) {
      toast.err((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'new webhook' : `edit · ${(target as Webhook).name}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name || !url}>
            save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="name"
          mono
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isNew}
          placeholder="ops-slack"
          required
        />
        <Input
          label="url"
          mono
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
          required
        />

        <div>
          <div className="label-mono mb-1.5">kind</div>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'generic' | 'slack' | 'discord')}
            className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber"
          >
            <option value="generic">generic — raw audit JSON</option>
            <option value="slack">slack — incoming webhook format</option>
            <option value="discord">discord — webhook embed</option>
          </select>
        </div>

        <Input
          label="secret (HMAC signing — optional)"
          mono
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          hint="if set, requests include X-MTL-Signature: sha256=..."
        />

        <div>
          <div className="label-mono mb-1.5">events</div>
          <input
            value={events}
            onChange={(e) => setEvents(e.target.value)}
            placeholder="* or comma-separated actions"
            className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber"
          />
          <div className="flex flex-wrap gap-1 mt-2">
            {COMMON_EVENTS.map((ev) => (
              <button
                key={ev}
                type="button"
                onClick={() => {
                  if (ev === '*') {
                    setEvents('*')
                  } else if (events === '*' || events === '') {
                    setEvents(ev)
                  } else if (!events.split(',').map((x) => x.trim()).includes(ev)) {
                    setEvents(events + ',' + ev)
                  }
                }}
                className="text-[10px] font-mono px-1.5 py-0.5 border border-ink-700 text-ink-300 hover:border-amber hover:text-amber"
              >
                + {ev}
              </button>
            ))}
          </div>
          <div className="text-xs text-ink-500 font-mono mt-1.5">
            "*" all events · "user.*" prefix · csv for multiple
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm font-mono cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-amber"
          />
          <span>enabled</span>
        </label>
      </div>
    </Dialog>
  )
}

function DeliveriesDialog({
  webhook,
  onClose,
}: {
  webhook: Webhook | null
  onClose: () => void
}) {
  const toast = useToast()
  const [items, setItems] = useState<WebhookDelivery[] | null>(null)

  useEffect(() => {
    if (!webhook) return
    setItems(null)
    api
      .webhookDeliveries(webhook.id, 100)
      .then((r) => setItems(r.items))
      .catch((e) => toast.err((e as Error).message))
  }, [webhook])

  if (!webhook) return null

  return (
    <Dialog
      open
      onClose={onClose}
      title={`deliveries · ${webhook.name}`}
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          close
        </Button>
      }
    >
      {!items ? (
        <div className="label-mono">// loading...</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-ink-500 font-mono py-4">
          // no deliveries yet
        </div>
      ) : (
        <div className="border border-ink-700 max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-ink-900">
              <tr className="border-b border-ink-700">
                <Th>time</Th>
                <Th>action</Th>
                <Th>http</Th>
                <Th>status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="border-b border-ink-700 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-ink-500 whitespace-nowrap">
                    {fmtTime(d.timestamp)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-amber">{d.action}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {d.httpStatus || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 ${
                        d.status === 'ok'
                          ? 'text-ok bg-ok/10 border border-ok/30'
                          : 'text-err bg-err/10 border border-err/30'
                      }`}
                    >
                      {d.status}
                    </span>
                    {d.error && (
                      <span className="ml-2 text-xs text-err font-mono">{d.error}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="label-mono text-left px-3 py-2">{children}</th>
}
function fmtTime(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + 'Z'
}
