import { useEffect, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Dialog } from '../components/ui/Dialog'
import { Empty } from '../components/ui/Empty'
import { useToast } from '../components/ui/Toast'
import { api, type Group, type Template, type TemplateConfig } from '../lib/api'

export function Templates() {
  const toast = useToast()
  const [items, setItems] = useState<Template[] | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [editing, setEditing] = useState<Template | 'new' | null>(null)

  const load = async () => {
    try {
      const r = await api.listTemplates()
      setItems(r.items)
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  useEffect(() => {
    load()
    api.listGroups().then((r) => setGroups(r.items)).catch(() => {})
  }, [])

  const onDelete = async (t: Template) => {
    if (!confirm(`Delete template "${t.name}"?`)) return
    try {
      await api.deleteTemplate(t.name)
      toast.ok(`deleted: ${t.name}`)
      load()
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  return (
    <Layout>
      <PageHeader
        title="Templates"
        subtitle={
          items ? `${items.length} templates · stored in audit.db` : 'loading...'
        }
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            + new template
          </Button>
        }
      />
      <PageBody>
        {items === null ? (
          <div className="label-mono p-8">// loading...</div>
        ) : items.length === 0 ? (
          <Empty
            title="No templates yet"
            hint='Templates pre-fill new-user fields: groups to add, default email domain, password strategy. Use them on the "Users → + new user" dialog.'
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                create first template
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {items.map((t) => (
              <div
                key={t.name}
                className="panel p-4 hover:border-ink-500 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-amber text-sm">{t.name}</div>
                    {t.config.description && (
                      <div className="text-sm text-ink-300 mt-1">
                        {t.config.description}
                      </div>
                    )}
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-3 mt-4 text-xs font-mono">
                  <div>
                    <dt className="label-mono">groups</dt>
                    <dd className="text-ink-300">
                      {t.config.groups?.length
                        ? t.config.groups.join(', ')
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-mono">email domain</dt>
                    <dd className="text-ink-300">
                      {t.config.defaultEmailDomain || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-mono">password</dt>
                    <dd className="text-ink-300">
                      {t.config.passwordStrategy || 'manual'}
                      {t.config.passwordStrategy === 'random' &&
                        t.config.passwordLength &&
                        ` (${t.config.passwordLength})`}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-mono">updated</dt>
                    <dd className="text-ink-500">{fmt(t.updatedAt)}</dd>
                  </div>
                </dl>

                <div className="hairline my-3" />
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                    edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => onDelete(t)}>
                    delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>

      <TemplateEditor
        target={editing}
        groups={groups}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
        }}
      />
    </Layout>
  )
}

function TemplateEditor({
  target,
  groups,
  onClose,
  onSaved,
}: {
  target: Template | 'new' | null
  groups: Group[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const isNew = target === 'new'
  const [name, setName] = useState('')
  const [config, setConfig] = useState<TemplateConfig>({
    description: '',
    groups: [],
    defaultEmailDomain: '',
    passwordStrategy: 'manual',
    passwordLength: 16,
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (target === 'new') {
      setName('')
      setConfig({
        description: '',
        groups: [],
        defaultEmailDomain: '',
        passwordStrategy: 'manual',
        passwordLength: 16,
      })
    } else if (target) {
      setName(target.name)
      setConfig({ ...target.config })
    }
  }, [target])

  if (!target) return null

  const submit = async () => {
    if (!name.trim()) {
      toast.err('name is required')
      return
    }
    setBusy(true)
    try {
      await api.saveTemplate(name.trim(), config)
      toast.ok(`saved: ${name}`)
      onSaved()
    } catch (e) {
      toast.err((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggleGroup = (cn: string) => {
    setConfig((c) => {
      const has = c.groups?.includes(cn)
      return {
        ...c,
        groups: has ? c.groups?.filter((g) => g !== cn) : [...(c.groups || []), cn],
      }
    })
  }

  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      title={isNew ? 'new template' : `edit · ${(target as Template).name}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name.trim()}>
            save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="name"
          mono
          placeholder="developer"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isNew}
          hint={!isNew ? 'name is immutable; delete and recreate to rename' : undefined}
        />
        <Input
          label="description"
          value={config.description || ''}
          onChange={(e) => setConfig({ ...config, description: e.target.value })}
          placeholder="Engineering team default account"
        />

        <div>
          <div className="label-mono mb-1.5">groups to add (optional)</div>
          <div className="flex flex-wrap gap-2 p-3 bg-ink-950 border border-ink-700 min-h-[3rem]">
            {groups.length === 0 ? (
              <div className="text-xs text-ink-500 font-mono">// no groups available</div>
            ) : (
              groups.map((g) => {
                const selected = config.groups?.includes(g.cn)
                return (
                  <button
                    key={g.cn}
                    onClick={() => toggleGroup(g.cn)}
                    className={`px-3 py-1.5 text-xs font-mono border transition-colors ${
                      selected
                        ? 'bg-amber/10 text-amber border-amber'
                        : 'bg-ink-900 text-ink-300 border-ink-700 hover:border-ink-500'
                    }`}
                  >
                    {selected && '✓ '}
                    {g.cn}
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="default email domain"
            mono
            placeholder="example.org"
            value={config.defaultEmailDomain || ''}
            onChange={(e) => setConfig({ ...config, defaultEmailDomain: e.target.value })}
            hint="if set, email defaults to {uid}@{domain}"
          />
          <div>
            <div className="label-mono mb-1.5">password strategy</div>
            <select
              value={config.passwordStrategy || 'manual'}
              onChange={(e) =>
                setConfig({
                  ...config,
                  passwordStrategy: e.target.value as 'manual' | 'random',
                })
              }
              className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber"
            >
              <option value="manual">manual (admin sets)</option>
              <option value="random">random (auto-generate, show once)</option>
            </select>
          </div>
        </div>

        {config.passwordStrategy === 'random' && (
          <Input
            label="password length"
            type="number"
            mono
            value={String(config.passwordLength || 16)}
            onChange={(e) =>
              setConfig({ ...config, passwordLength: parseInt(e.target.value) || 16 })
            }
            min={12}
            max={64}
            hint="12-64 characters"
          />
        )}
      </div>
    </Dialog>
  )
}

function fmt(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + 'Z'
}
