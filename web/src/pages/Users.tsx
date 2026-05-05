import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Dialog } from '../components/ui/Dialog'
import { Empty } from '../components/ui/Empty'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../lib/auth'
import {
  api,
  ApiError,
  type BulkSummary,
  type Group,
  type RawEntry,
  type Schema,
  type SchemaAttribute,
  type SchemaObjectClass,
  type Template,
  type User,
} from '../lib/api'
import { downloadCSV, toCSV } from '../lib/csv'
import { PosixDialog } from '../components/PosixDialog'
import { useAutoRefresh } from '../lib/useAutoRefresh'

export function Users() {
  const { me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const toast = useToast()

  const [users, setUsers] = useState<User[] | null>(null)
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [pwTarget, setPwTarget] = useState<User | null>(null)
  const [posixTarget, setPosixTarget] = useState<User | null>(null)
  const [moveTarget, setMoveTarget] = useState<User | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<
    null | 'delete' | 'group-add' | 'group-remove' | 'password-reset'
  >(null)

  const load = async (query = q) => {
    try {
      const res = await api.listUsers(query)
      setUsers(res.items)
      setSelected(new Set())
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  // Auto-refresh için: selection sıfırlamayan, hatayı sessizce yutan varyant.
  // Tablo verisini günceller ama kullanıcı işaretlediği checkbox'lar kalır.
  const refresh = async () => {
    try {
      const res = await api.listUsers(q)
      setUsers(res.items)
    } catch {
      /* sessiz: arka plan refresh, hata için toast gösterme */
    }
  }

  useEffect(() => {
    load('')
  }, [])

  useAutoRefresh(refresh, 10_000)

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    load()
  }

  const onDelete = async (u: User) => {
    if (!confirm(`Delete user "${u.uid}"?`)) return
    try {
      await api.deleteUser(u.uid)
      toast.ok(`deleted: ${u.uid}`)
      load()
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  const onUnlock = async (u: User) => {
    try {
      await api.unlockUser(u.uid)
      toast.ok(`unlocked: ${u.uid}`)
      load()
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  // v0.9: kalıcı disable/enable. Lock'la farkı:
  //   - lock → ppolicy geçici (manuel unlock veya pwdLockoutDuration sonrası açılır)
  //   - disable → admin tarafından kalıcı; sentinel + shadowExpire=0 ile sssd dahil
  //     tüm bind path'leri bloke
  const onDisable = async (u: User) => {
    if (!confirm(`Disable user "${u.uid}"? Re-enable etmeyene kadar bind edemez.`)) return
    try {
      await api.disableUser(u.uid)
      toast.ok(`disabled: ${u.uid}`)
      load()
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  const onEnable = async (u: User) => {
    try {
      await api.enableUser(u.uid)
      toast.ok(`enabled: ${u.uid}`)
      load()
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  const onResetMFA = async (u: User) => {
    if (!confirm(`Reset MFA for "${u.uid}"? They will need to re-enroll on next login.`)) return
    try {
      await api.adminMFADisable(u.uid)
      toast.ok(`mfa reset: ${u.uid}`)
      load()
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  const toggleSelect = (uid: string) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const toggleAll = () => {
    if (!users) return
    if (selected.size === users.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(users.map((u) => u.uid)))
    }
  }

  return (
    <Layout>
      <PageHeader
        title="Users"
        subtitle={users ? `${users.length} entries · objectClass=inetOrgPerson` : 'loading...'}
        actions={
          isAdmin && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              + new user
            </Button>
          )
        }
      />
      <PageBody>
        <form onSubmit={onSearch} className="flex gap-2 mb-4">
          <Input
            placeholder="search by uid, cn, or mail..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="font-mono"
          />
          <Button type="submit">search</Button>
          {q && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setQ('')
                load('')
              }}
            >
              clear
            </Button>
          )}
        </form>

        {/* Bulk action bar — only when selection exists and admin */}
        {isAdmin && selected.size > 0 && (
          <div className="panel border-amber/50 bg-amber/5 px-4 py-3 mb-4 flex items-center justify-between">
            <div className="font-mono text-sm">
              <span className="text-amber">{selected.size}</span>
              <span className="text-ink-300"> selected</span>
              <button
                onClick={() => setSelected(new Set())}
                className="ml-3 text-xs text-ink-500 hover:text-ink-100 transition-colors"
              >
                clear
              </button>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => setBulkAction('group-add')}>
                add to group
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setBulkAction('group-remove')}
              >
                remove from group
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setBulkAction('password-reset')}
              >
                reset passwords
              </Button>
              <Button size="sm" variant="danger" onClick={() => setBulkAction('delete')}>
                delete
              </Button>
            </div>
          </div>
        )}

        {users === null ? (
          <div className="label-mono p-8">// loading directory...</div>
        ) : users.length === 0 ? (
          <Empty title="No users found" hint="Try clearing the search or create a new user." />
        ) : (
          <div className="panel overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-700">
                  {isAdmin && (
                    <Th className="w-10">
                      <input
                        type="checkbox"
                        checked={selected.size === users.length}
                        onChange={toggleAll}
                        className="accent-amber"
                      />
                    </Th>
                  )}
                  <Th>uid</Th>
                  <Th>name</Th>
                  <Th>mail</Th>
                  <Th>groups</Th>
                  <Th className="text-right">actions</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.dn} className="row-hover border-b border-ink-700 last:border-0">
                    {isAdmin && (
                      <Td>
                        <input
                          type="checkbox"
                          checked={selected.has(u.uid)}
                          onChange={() => toggleSelect(u.uid)}
                          className="accent-amber"
                        />
                      </Td>
                    )}
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className={`font-mono ${u.disabled ? 'text-ink-500 line-through' : 'text-amber'}`}>
                          {u.uid}
                        </span>
                        {u.disabled && (
                          <span className="text-[10px] font-mono uppercase tracking-wider text-ink-300 bg-ink-700 border border-ink-500 px-1.5 py-0.5">
                            disabled
                          </span>
                        )}
                        {u.accountLocked && (
                          <span
                            className="text-[10px] font-mono uppercase tracking-wider text-err bg-err/10 border border-err/30 px-1.5 py-0.5"
                            title={`locked at ${u.accountLockedTime}`}
                          >
                            locked
                          </span>
                        )}
                        {!u.accountLocked && !u.disabled && u.recentFailures > 0 && (
                          <span className="text-[10px] font-mono uppercase tracking-wider text-warn bg-warn/10 border border-warn/30 px-1.5 py-0.5">
                            {u.recentFailures} fail
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <div>
                        {u.firstName} {u.lastName}
                      </div>
                      <div className="text-xs text-ink-500 font-mono truncate max-w-xs">
                        {u.dn}
                      </div>
                    </Td>
                    <Td className="font-mono text-ink-300">{u.email || '—'}</Td>
                    <Td>
                      <GroupChips groups={u.groups} />
                    </Td>
                    <Td className="text-right">
                      {isAdmin && (
                        <div className="flex justify-end gap-1 flex-wrap">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                            edit
                          </Button>
                          {u.accountLocked && (
                            <Button size="sm" variant="secondary" onClick={() => onUnlock(u)}>
                              unlock
                            </Button>
                          )}
                          {/* v0.9: kalıcı disable toggle. Lock'la ayrı görsel/semantic. */}
                          {u.disabled ? (
                            <Button size="sm" variant="secondary" onClick={() => onEnable(u)}>
                              enable
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => onDisable(u)}
                              title="kalıcı pasifleştir (kullanıcı bind edemez)">
                              disable
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setMoveTarget(u)}
                            title="başka OU'ya taşı">
                            move
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setPwTarget(u)}>
                            password
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => onResetMFA(u)} title="reset MFA (lost device)">
                            mfa
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setPosixTarget(u)}>
                            posix
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => onDelete(u)}>
                            delete
                          </Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          load()
        }}
      />
      <EditUserDialog
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
        }}
      />
      <PasswordDialog user={pwTarget} onClose={() => setPwTarget(null)} />
      {posixTarget && (
        <PosixDialog
          user={posixTarget}
          onClose={() => setPosixTarget(null)}
          onSaved={() => {
            setPosixTarget(null)
            load()
          }}
        />
      )}
      <MoveUserDialog
        user={moveTarget}
        onClose={() => setMoveTarget(null)}
        onMoved={() => {
          setMoveTarget(null)
          load()
        }}
      />

      <BulkActionDialog
        action={bulkAction}
        uids={Array.from(selected)}
        onClose={() => setBulkAction(null)}
        onDone={() => {
          setBulkAction(null)
          load()
        }}
      />
    </Layout>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`label-mono text-left px-4 py-2.5 ${className}`}>{children}</th>
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>
}

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')

  const [uid, setUid] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [generated, setGenerated] = useState<{
    uid: string
    password: string
  } | null>(null)

  useEffect(() => {
    if (!open) return
    setUid('')
    setFirstName('')
    setLastName('')
    setEmail('')
    setPassword('')
    setSelectedTemplate('')
    setGenerated(null)
    api.listTemplates().then((r) => setTemplates(r.items)).catch(() => {})
  }, [open])

  const tpl = templates.find((t) => t.name === selectedTemplate)

  // Auto-fill email when template selected and uid is set
  useEffect(() => {
    if (tpl?.config.defaultEmailDomain && uid && !email) {
      setEmail(`${uid}@${tpl.config.defaultEmailDomain}`)
    }
  }, [tpl, uid])

  const submit = async () => {
    setBusy(true)
    try {
      if (selectedTemplate) {
        const res = await api.applyTemplate(selectedTemplate, {
          uid, firstName, lastName,
          email: email || undefined,
          password: password || undefined,
        })
        if (res.generatedPassword) {
          setGenerated({ uid, password: res.generatedPassword })
          toast.ok(`created: ${uid} (password generated)`)
        } else {
          toast.ok(`created: ${uid}`)
          onCreated()
        }
        if (res.groupErrors && Object.keys(res.groupErrors).length > 0) {
          toast.err(`some groups failed: ${Object.keys(res.groupErrors).join(', ')}`)
        }
      } else {
        await api.createUser({ uid, firstName, lastName, email, password })
        toast.ok(`created: ${uid}`)
        onCreated()
      }
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  if (generated) {
    return (
      <Dialog
        open
        onClose={onCreated}
        title={`generated password · ${generated.uid}`}
        size="md"
        footer={
          <>
            <Button
              onClick={() => {
                navigator.clipboard.writeText(generated.password)
                toast.ok('copied to clipboard')
              }}
            >
              copy
            </Button>
            <Button variant="primary" onClick={onCreated}>
              done
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="bg-warn/10 border border-warn/30 px-3 py-2 text-xs text-warn font-mono">
            ⚠ Save this password now — it will not be shown again.
          </div>
          <div className="bg-ink-950 border border-ink-700 px-4 py-4 font-mono text-lg break-all select-all">
            {generated.password}
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="new user"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !uid || !firstName || !lastName}>
            create
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {templates.length > 0 && (
          <div>
            <div className="label-mono mb-1.5">template (optional)</div>
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber"
            >
              <option value="">— no template —</option>
              {templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} {t.config.description ? `· ${t.config.description}` : ''}
                </option>
              ))}
            </select>
            {tpl && (
              <div className="text-xs text-ink-500 font-mono mt-1.5 leading-relaxed">
                {tpl.config.groups?.length ? `→ ${tpl.config.groups.join(', ')}` : ''}
                {tpl.config.passwordStrategy === 'random' && ' · password will be auto-generated'}
              </div>
            )}
          </div>
        )}

        <Input label="uid" mono value={uid} onChange={(e) => setUid(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3">
          <Input label="first name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          <Input label="last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </div>
        <Input label="email" type="email" mono value={email} onChange={(e) => setEmail(e.target.value)} />
        {tpl?.config.passwordStrategy !== 'random' && (
          <Input
            label="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="leave empty to set later"
          />
        )}
      </div>
    </Dialog>
  )
}

function EditUserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: User | null
  onClose: () => void
  onSaved: () => void
}) {
  const [tab, setTab] = useState<'profile' | 'attrs'>('profile')

  useEffect(() => {
    if (user) setTab('profile')
  }, [user])

  if (!user) return null

  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      title={`edit · ${user.uid}`}
      size="lg"
      footer={null}
    >
      {/* Tab strip */}
      <div className="flex border-b border-ink-700 -mt-2 mb-4">
        <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>
          profile
        </TabButton>
        <TabButton active={tab === 'attrs'} onClick={() => setTab('attrs')}>
          attributes
        </TabButton>
      </div>

      {tab === 'profile' ? (
        <ProfileTab user={user} onClose={onClose} onSaved={onSaved} />
      ) : (
        <AttributesTab user={user} onClose={onClose} onSaved={onSaved} />
      )}
    </Dialog>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-xs font-mono uppercase tracking-wider transition-colors ${
        active
          ? 'text-amber border-b-2 border-amber -mb-px'
          : 'text-ink-500 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  )
}

function ProfileTab({
  user,
  onClose,
  onSaved,
}: {
  user: User
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [firstName, setFirstName] = useState(user.firstName)
  const [lastName, setLastName] = useState(user.lastName)
  const [email, setEmail] = useState(user.email)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await api.updateUser(user.uid, { firstName, lastName, email })
      toast.ok(`updated: ${user.uid}`)
      onSaved()
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="font-mono text-xs text-ink-500 break-all bg-ink-950 border border-ink-700 px-3 py-2">
        {user.dn}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="first name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <Input label="last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <Input label="email" mono value={email} onChange={(e) => setEmail(e.target.value)} />
      <div className="flex justify-end gap-2 pt-2 border-t border-ink-700">
        <Button variant="ghost" onClick={onClose}>cancel</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>save</Button>
      </div>
    </div>
  )
}

// Profile tab'ında zaten gösterilen attribute'lar — Attributes tab'ında gizli
// kalsın ki çift bakım olmasın.
const PROFILE_ATTRS = new Set(['uid', 'cn', 'givenname', 'sn', 'mail', 'objectclass', 'userpassword'])

// Schema-level olarak hiç gösterilmesin (ppolicy operational, vs.)
const HIDDEN_ATTRS = new Set([
  'pwdchangedtime', 'pwdaccountlockedtime', 'pwdfailuretime', 'pwdhistory',
  'pwdreset', 'pwdpolicysubentry', 'pwdgraceusetime', 'memberof',
  'creatorsname', 'createtimestamp', 'modifiersname', 'modifytimestamp',
  'entryuuid', 'entrycsn', 'structuralobjectclass', 'hassubordinates',
  'subschemasubentry',
])

type PendingChange =
  | { kind: 'add'; attr: string; values: string[] }
  | { kind: 'replace'; attr: string; values: string[] }
  | { kind: 'delete'; attr: string }

function AttributesTab({
  user,
  onClose,
  onSaved,
}: {
  user: User
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [entry, setEntry] = useState<RawEntry | null>(null)
  const [schema, setSchema] = useState<Schema | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingChange[]>([])
  const [adding, setAdding] = useState(false)
  const [newAttr, setNewAttr] = useState('')
  const [newValue, setNewValue] = useState('')
  // Editing per-attr local state: attr name → working values
  const [editing, setEditing] = useState<Record<string, string[]>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([api.getEntry(user.dn), api.getSchema()])
      .then(([e, s]) => {
        if (cancelled) return
        setEntry(e)
        setSchema(s)
      })
      .catch((e) => toast.err((e as Error).message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [user.dn])

  // Hangi objectClass'lar var → MAY+MUST kümesi
  const allowedAttrs = useMemo<SchemaAttribute[]>(() => {
    if (!schema || !entry) return []
    const ocs = (entry.attributes['objectClass'] || entry.attributes['objectclass'] || []).map(
      (s) => s.toLowerCase()
    )
    if (ocs.length === 0) return schema.attributes
    // BFS objectClass hierarchy; mtl-ldap-admin'nin schema cache'i superClass'ı veriyor
    const ocByName = new Map<string, typeof schema.objectClasses[number]>()
    for (const oc of schema.objectClasses) {
      for (const n of oc.names) ocByName.set(n.toLowerCase(), oc)
    }
    const allowedSet = new Set<string>()
    const visited = new Set<string>()
    const queue = [...ocs]
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (visited.has(cur)) continue
      visited.add(cur)
      const def = ocByName.get(cur)
      if (!def) continue
      ;(def.must || []).forEach((a) => allowedSet.add(a.toLowerCase()))
      ;(def.may || []).forEach((a) => allowedSet.add(a.toLowerCase()))
      ;(def.superClass || []).forEach((s) => {
        if (!visited.has(s.toLowerCase())) queue.push(s.toLowerCase())
      })
    }
    return schema.attributes.filter((a) =>
      a.names.some((n) => allowedSet.has(n.toLowerCase()))
    )
  }, [schema, entry])

  // Mevcut entry attr'larını profile/hidden filtreleyip render edelim
  const visibleEntries = useMemo(() => {
    if (!entry) return [] as { attr: string; values: string[]; def?: SchemaAttribute }[]
    const list: { attr: string; values: string[]; def?: SchemaAttribute }[] = []
    for (const [attr, values] of Object.entries(entry.attributes)) {
      const ln = attr.toLowerCase()
      if (PROFILE_ATTRS.has(ln) || HIDDEN_ATTRS.has(ln)) continue
      const def = allowedAttrs.find((a) =>
        a.names.some((n) => n.toLowerCase() === ln)
      )
      list.push({ attr, values, def })
    }
    return list.sort((a, b) => a.attr.localeCompare(b.attr))
  }, [entry, allowedAttrs])

  // "+ add" picker'ında gösterilecek attr listesi: allowed - already-present - protected
  const addableAttrs = useMemo(() => {
    if (!entry) return [] as SchemaAttribute[]
    const present = new Set(Object.keys(entry.attributes).map((a) => a.toLowerCase()))
    return allowedAttrs
      .filter((a) => !a.noUserMod)
      .filter((a) => !a.names.some((n) => PROFILE_ATTRS.has(n.toLowerCase())))
      .filter((a) => !a.names.some((n) => HIDDEN_ATTRS.has(n.toLowerCase())))
      .filter((a) => {
        // single-valued + zaten var → eklemeye uygun değil
        if (a.singleValue && a.names.some((n) => present.has(n.toLowerCase()))) return false
        return true
      })
      .sort((a, b) => (a.names[0] || '').localeCompare(b.names[0] || ''))
  }, [allowedAttrs, entry])

  const startEdit = (attr: string, values: string[]) => {
    setEditing((prev) => ({ ...prev, [attr]: [...values] }))
  }
  const cancelEdit = (attr: string) => {
    setEditing((prev) => {
      const next = { ...prev }
      delete next[attr]
      return next
    })
  }
  const commitEdit = (attr: string) => {
    const vals = (editing[attr] || []).filter((v) => v.trim() !== '')
    setPending((prev) => [
      ...prev.filter((p) => p.attr !== attr),
      vals.length === 0
        ? { kind: 'delete' as const, attr }
        : { kind: 'replace' as const, attr, values: vals },
    ])
    cancelEdit(attr)
  }
  const queueDelete = (attr: string) => {
    if (!confirm(`delete attribute "${attr}" from entry?`)) return
    setPending((prev) => [
      ...prev.filter((p) => p.attr !== attr),
      { kind: 'delete', attr },
    ])
  }
  const queueAdd = () => {
    if (!newAttr || !newValue.trim()) return
    setPending((prev) => {
      // Aynı attr için pending varsa: değerleri birleştir
      const existing = prev.find((p) => p.kind === 'add' && p.attr === newAttr) as
        | Extract<PendingChange, { kind: 'add' }>
        | undefined
      if (existing) {
        return prev
          .filter((p) => !(p.kind === 'add' && p.attr === newAttr))
          .concat({ kind: 'add', attr: newAttr, values: [...existing.values, newValue.trim()] })
      }
      return [...prev, { kind: 'add', attr: newAttr, values: [newValue.trim()] }]
    })
    setNewValue('')
    setAdding(false)
    setNewAttr('')
  }
  const removePending = (idx: number) => {
    setPending((prev) => prev.filter((_, i) => i !== idx))
  }

  const save = async () => {
    if (pending.length === 0) {
      onClose()
      return
    }
    const mod: {
      add: Record<string, string[]>
      replace: Record<string, string[]>
      delete: Record<string, string[]>
    } = { add: {}, replace: {}, delete: {} }
    for (const p of pending) {
      if (p.kind === 'add') mod.add[p.attr] = (mod.add[p.attr] || []).concat(p.values)
      else if (p.kind === 'replace') mod.replace[p.attr] = p.values
      else if (p.kind === 'delete') mod.delete[p.attr] = []
    }
    setBusy(true)
    try {
      await api.modifyUserAttributes(user.uid, mod)
      toast.ok(`attributes updated: ${user.uid}`)
      onSaved()
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="label-mono p-4">// loading entry + schema...</div>
  }
  if (!entry) {
    return <div className="text-err font-mono text-xs p-4">entry not found</div>
  }

  return (
    <div className="space-y-4">
      <div className="font-mono text-xs text-ink-500 break-all bg-ink-950 border border-ink-700 px-3 py-2">
        {user.dn}
      </div>

      {/* v0.9: ObjectClass yönetimi */}
      <ObjectClassSection
        entry={entry}
        schema={schema}
        onChanged={async () => {
          // ObjectClass değişiklikleri ANINDA uygulanır (ayrı API call,
          // pending kuyruğunda tutulmaz). Sonrasında entry'i tekrar oku ki
          // allowedAttrs picker'ı yeni MAY/MUST set'iyle güncellensin.
          try {
            const fresh = await api.getEntry(user.dn)
            setEntry(fresh)
          } catch (e) {
            toast.err((e as Error).message)
          }
        }}
      />

      {/* Existing attributes */}
      <div>
        <div className="label-mono mb-2">// current attributes</div>
        {visibleEntries.length === 0 ? (
          <div className="text-xs text-ink-500 font-mono px-3 py-4 border border-ink-700 border-dashed">
            no extra attributes — use "+ add" below
          </div>
        ) : (
          <div className="border border-ink-700 divide-y divide-ink-700">
            {visibleEntries.map(({ attr, values, def }) => {
              const isEditing = editing[attr] !== undefined
              const pendingFor = pending.find((p) => p.attr === attr)
              return (
                <div key={attr} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-amber text-sm">{attr}</span>
                        {def?.singleValue && (
                          <span className="text-[10px] font-mono text-ink-500 uppercase">single</span>
                        )}
                        {pendingFor && (
                          <span className="text-[10px] font-mono uppercase tracking-wider text-warn bg-warn/10 border border-warn/30 px-1.5 py-0.5">
                            pending {pendingFor.kind}
                          </span>
                        )}
                      </div>
                      {def?.description && (
                        <div className="text-[10px] text-ink-500 font-mono mt-0.5">
                          {def.description}
                        </div>
                      )}
                      {isEditing ? (
                        <ValueListEditor
                          values={editing[attr]}
                          singleValue={def?.singleValue}
                          onChange={(vs) =>
                            setEditing((prev) => ({ ...prev, [attr]: vs }))
                          }
                        />
                      ) : (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {values.map((v, i) => (
                            <span
                              key={i}
                              className="font-mono text-xs bg-ink-800 border border-ink-700 px-2 py-0.5"
                            >
                              {v}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {isEditing ? (
                        <>
                          <Button size="sm" variant="primary" onClick={() => commitEdit(attr)}>
                            ok
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => cancelEdit(attr)}>
                            cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => startEdit(attr, values)}>
                            edit
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => queueDelete(attr)}>
                            del
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add attribute */}
      <div>
        {!adding ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            + add attribute
          </Button>
        ) : (
          <div className="border border-amber/30 bg-amber/5 p-3 space-y-2">
            <div className="label-mono">// add attribute</div>
            <select
              value={newAttr}
              onChange={(e) => setNewAttr(e.target.value)}
              className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber"
            >
              <option value="">— pick attribute —</option>
              {addableAttrs.map((a) => (
                <option key={a.oid} value={a.names[0] || ''}>
                  {a.names[0]}
                  {a.singleValue ? ' (single)' : ''}
                  {a.description ? ` — ${a.description.slice(0, 40)}` : ''}
                </option>
              ))}
            </select>
            <Input
              placeholder="value"
              mono
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), queueAdd())}
            />
            <div className="flex gap-1">
              <Button size="sm" variant="primary" onClick={queueAdd} disabled={!newAttr || !newValue.trim()}>
                queue
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdding(false)
                  setNewAttr('')
                  setNewValue('')
                }}
              >
                cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Pending list */}
      {pending.length > 0 && (
        <div className="border border-warn/30 bg-warn/5 p-3">
          <div className="label-mono mb-1.5 text-warn">// {pending.length} pending change(s)</div>
          <div className="space-y-1">
            {pending.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs font-mono">
                <span>
                  <span
                    className={`uppercase tracking-wider mr-2 ${
                      p.kind === 'delete' ? 'text-err' : p.kind === 'add' ? 'text-ok' : 'text-warn'
                    }`}
                  >
                    {p.kind}
                  </span>
                  <span className="text-amber">{p.attr}</span>
                  {'values' in p && (
                    <span className="text-ink-300"> = {p.values.join(', ')}</span>
                  )}
                </span>
                <button
                  onClick={() => removePending(i)}
                  className="text-ink-500 hover:text-err"
                  type="button"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-3 border-t border-ink-700">
        <Button variant="ghost" onClick={onClose}>cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy || pending.length === 0}>
          {busy ? 'applying...' : `apply ${pending.length || ''} change${pending.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  )
}

function ValueListEditor({
  values,
  singleValue,
  onChange,
}: {
  values: string[]
  singleValue?: boolean
  onChange: (vs: string[]) => void
}) {
  const setAt = (i: number, v: string) => {
    const next = [...values]
    next[i] = v
    onChange(next)
  }
  const removeAt = (i: number) => onChange(values.filter((_, j) => j !== i))
  const append = () => onChange([...values, ''])
  return (
    <div className="mt-1.5 space-y-1">
      {values.map((v, i) => (
        <div key={i} className="flex gap-1">
          <input
            value={v}
            onChange={(e) => setAt(i, e.target.value)}
            className="flex-1 h-8 bg-ink-950 border border-ink-700 px-2 text-xs font-mono focus:outline-none focus:border-amber"
          />
          {!singleValue && (
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="text-xs text-ink-500 hover:text-err font-mono px-2"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {!singleValue && (
        <button
          type="button"
          onClick={append}
          className="text-[10px] text-ink-500 hover:text-amber font-mono"
        >
          + value
        </button>
      )}
    </div>
  )
}

// dnToCN "cn=foo,ou=groups,dc=mtl,dc=com" → "foo".
// RDN'in ilk parçasının değer bölümünü ayıklar; cn=, ou=, uid= her şey çalışır.
// LDAP DN escape (\,) içeren CN'lerle pratikte karşılaşmayız; basit tutuyoruz.
function dnToCN(dn: string): string {
  const m = dn.match(/^[A-Za-z][A-Za-z0-9-]*=([^,]+)/)
  return m ? m[1] : dn
}

// GroupChips users tablosunda memberOf'u render eder. İlk 3 grup chip olarak,
// gerisi "+N more" tıklanabilir popover'la. Tıklamadışı kapatma için
// document-level click handler kullanır.
function GroupChips({ groups }: { groups: string[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (groups.length === 0) {
    return <span className="text-xs text-ink-500">—</span>
  }
  const cns = groups.map(dnToCN)
  const visible = cns.slice(0, 3)
  const overflow = cns.length - 3

  return (
    <div ref={ref} className="flex flex-wrap gap-1 items-center relative">
      {visible.map((cn, i) => (
        <span
          key={i}
          className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 bg-ink-800 border border-ink-700 text-ink-300"
          title={cn}
        >
          {cn}
        </span>
      ))}
      {overflow > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className="text-[10px] font-mono text-amber hover:underline cursor-pointer"
        >
          +{overflow} more
        </button>
      )}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-ink-900 border border-ink-700 px-3 py-2 shadow-lg min-w-[220px] max-w-sm">
          <div className="label-mono mb-1.5">// all groups ({cns.length})</div>
          <div className="flex flex-wrap gap-1">
            {cns.map((cn, i) => (
              <span
                key={i}
                className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 bg-ink-800 border border-ink-700 text-ink-300"
              >
                {cn}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PasswordDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const toast = useToast()
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user) setPw('')
  }, [user])

  if (!user) return null

  const submit = async () => {
    if (pw.length < 8) {
      toast.err('password must be at least 8 characters')
      return
    }
    setBusy(true)
    try {
      await api.setUserPassword(user.uid, pw)
      toast.ok(`password reset: ${user.uid}`)
      onClose()
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      title={`reset password · ${user.uid}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>reset</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="new password"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          hint="minimum 8 characters"
          autoFocus
        />
      </div>
    </Dialog>
  )
}

function BulkActionDialog({
  action,
  uids,
  onClose,
  onDone,
}: {
  action: 'delete' | 'group-add' | 'group-remove' | 'password-reset' | null
  uids: string[]
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [groups, setGroups] = useState<Group[]>([])
  const [groupCN, setGroupCN] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BulkSummary | null>(null)

  useEffect(() => {
    if (!action) {
      setGroupCN('')
      setResult(null)
      return
    }
    if (action === 'group-add' || action === 'group-remove') {
      api.listGroups().then((r) => setGroups(r.items)).catch(() => {})
    }
  }, [action])

  if (!action) return null

  const titles = {
    delete: `delete ${uids.length} users`,
    'group-add': `add ${uids.length} users to group`,
    'group-remove': `remove ${uids.length} users from group`,
    'password-reset': `reset passwords for ${uids.length} users`,
  }

  const exec = async () => {
    setBusy(true)
    try {
      let res: BulkSummary
      switch (action) {
        case 'delete':
          res = await api.bulkDeleteUsers(uids)
          break
        case 'group-add':
          if (!groupCN) return
          res = await api.bulkAddToGroup(groupCN, uids)
          break
        case 'group-remove':
          if (!groupCN) return
          res = await api.bulkRemoveFromGroup(groupCN, uids)
          break
        case 'password-reset':
          res = await api.bulkResetPasswords(uids)
          break
      }
      setResult(res)
      if (res.failed === 0) toast.ok(`${res.ok} done`)
      else toast.err(`${res.failed} failed`)
    } catch (e) {
      toast.err((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Result view (especially important for password-reset)
  if (result) {
    const hasPasswords = result.results.some((r) => r.generatedPassword)
    return (
      <Dialog
        open
        onClose={onDone}
        title="result"
        size="lg"
        footer={
          <>
            {hasPasswords && (
              <Button
                onClick={() => {
                  const csv = toCSV(
                    ['uid', 'password', 'status'],
                    result.results.map((r) => ({
                      uid: r.uid,
                      password: r.generatedPassword || '',
                      status: r.status,
                    }))
                  )
                  downloadCSV(`password-reset-${Date.now()}.csv`, csv)
                }}
              >
                download passwords (CSV)
              </Button>
            )}
            <Button variant="primary" onClick={onDone}>
              done
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="ok" value={result.ok} accent="ok" />
            <Stat
              label="failed"
              value={result.failed}
              accent={result.failed > 0 ? 'err' : 'muted'}
            />
          </div>

          {hasPasswords && (
            <div className="bg-warn/10 border border-warn/30 px-3 py-2 text-xs text-warn font-mono">
              ⚠ Generated passwords are shown once. Download the CSV before closing.
            </div>
          )}

          <div className="border border-ink-700 max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-ink-900">
                <tr className="border-b border-ink-700">
                  <th className="label-mono text-left px-3 py-2">uid</th>
                  {hasPasswords && (
                    <th className="label-mono text-left px-3 py-2">password</th>
                  )}
                  <th className="label-mono text-left px-3 py-2">status</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r, i) => (
                  <tr key={i} className="border-b border-ink-700 last:border-0">
                    <td className="px-3 py-2 font-mono text-amber">{r.uid}</td>
                    {hasPasswords && (
                      <td className="px-3 py-2 font-mono text-xs select-all">
                        {r.generatedPassword || '—'}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <span
                        className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 ${
                          r.status === 'ok'
                            ? 'text-ok bg-ok/10 border border-ok/30'
                            : 'text-err bg-err/10 border border-err/30'
                        }`}
                      >
                        {r.status}
                      </span>
                      {r.error && (
                        <span className="ml-2 text-xs text-err font-mono">{r.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={titles[action]}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>cancel</Button>
          <Button
            variant={action === 'delete' ? 'danger' : 'primary'}
            onClick={exec}
            disabled={
              busy ||
              ((action === 'group-add' || action === 'group-remove') && !groupCN)
            }
          >
            {busy ? 'running...' : 'confirm'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="font-mono text-xs text-ink-300 bg-ink-950 border border-ink-700 px-3 py-2 max-h-32 overflow-y-auto">
          {uids.join(', ')}
        </div>

        {(action === 'group-add' || action === 'group-remove') && (
          <div>
            <div className="label-mono mb-1.5">group</div>
            <select
              value={groupCN}
              onChange={(e) => setGroupCN(e.target.value)}
              className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber"
            >
              <option value="">— pick a group —</option>
              {groups.map((g) => (
                <option key={g.cn} value={g.cn}>
                  {g.cn}
                </option>
              ))}
            </select>
          </div>
        )}

        {action === 'delete' && (
          <div className="bg-err/10 border border-err/30 px-3 py-2 text-xs text-err font-mono">
            ⚠ This permanently deletes the user entries. Cannot be undone.
          </div>
        )}

        {action === 'password-reset' && (
          <div className="bg-warn/10 border border-warn/30 px-3 py-2 text-xs text-warn font-mono">
            New random passwords will be generated for each user. They will be shown once and
            can be exported as CSV.
          </div>
        )}
      </div>
    </Dialog>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: 'ok' | 'err' | 'muted'
}) {
  const color =
    accent === 'ok' ? 'text-ok' : accent === 'err' ? 'text-err' : 'text-ink-500'
  return (
    <div className="border-l-2 border-ink-700 pl-4">
      <div className="label-mono">{label}</div>
      <div className={`text-3xl font-light font-mono ${color}`}>{value}</div>
    </div>
  )
}

// MoveUserDialog kullanıcıyı başka bir OU'ya (parent container'a) taşır.
// LDAP modDN op'u; refint overlay yüklü olduğunda member referansları otomatik
// güncellenir (sizin sunucuda yüklü). UI iki adım:
//   1. /api/tree/containers'tan tüm OU/organization'ları çek
//   2. seçili olan parent'a POST /api/users/{uid}/move
function MoveUserDialog({
  user,
  onClose,
  onMoved,
}: {
  user: User | null
  onClose: () => void
  onMoved: () => void
}) {
  const toast = useToast()
  const [containers, setContainers] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    setSelected('')
    api
      .listContainerOUs()
      .then((res) => {
        // Mevcut parent'ı listenin başına çıkarmaya gerek yok; sadece DN'inden
        // mevcut parent'ı çıkar — kullanıcı zaten orada, tekrar oraya taşıma anlamsız.
        const currentParent = user.dn.split(',').slice(1).join(',')
        setContainers(res.items.filter((d) => d !== currentParent))
      })
      .catch((e) => toast.err((e as Error).message))
  }, [user])

  if (!user) return null

  const submit = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await api.moveUser(user.uid, selected)
      toast.ok(`moved: ${user.uid} → ${selected}`)
      onMoved()
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const currentParent = user.dn.split(',').slice(1).join(',')

  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      title={`move · ${user.uid}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !selected}>
            move
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="label-mono mb-1">// current location</div>
          <div className="font-mono text-xs text-ink-300 bg-ink-950 border border-ink-700 px-3 py-2 break-all">
            {currentParent}
          </div>
        </div>
        <div>
          <div className="label-mono mb-1">// new parent</div>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber"
          >
            <option value="">— select container —</option>
            {containers.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="text-[11px] text-ink-500 font-mono leading-relaxed">
          // memberOf güncellemesi refint overlay tarafından otomatik yapılır.<br />
          // DN değişeceğinden eski uid referansı kullanan dış sistemler etkilenebilir.
        </div>
      </div>
    </Dialog>
  )
}

// v0.9: ObjectClass yönetimi.
//
// AttributesTab içine yerleştirilen sub-section. Mevcut entry'nin objectClass
// listesini gösterir; aux class ekleme/kaldırma için collapsible picker.
//
// Tasarım kararları:
//   - Structural class'lar non-removable (LDAP semantiği). Read-only chip.
//   - Aux class'lar tıklanınca kaldırılır (confirm sorulur).
//   - "+ add auxiliary" picker schema'daki tüm AUXILIARY class'ları gösterir;
//     zaten eklenmiş olanları filtreler.
//   - Değişiklikler ANINDA uygulanır (pending kuyrukta tutulmaz). Sebep: yeni
//     bir aux class eklendiğinde MAY/MUST attribute'ları aşağıdaki "current
//     attributes" picker'ında ANINDA görünmeli; yoksa kullanıcı kafası karışır.
//   - shadowAccount eklendiğinde shadowExpire MUST değil (MAY) — değer girmek
//     opsiyonel; UI bunu sormaz, sonra "+ add attribute" ile gelir.
//   - posixAccount eklendiğinde uid/uidNumber/gidNumber/homeDirectory MUST.
//     posixAccount için bu UI yetersiz — kullanıcı zaten POSIX dialog'u
//     kullanmalı. Bu yüzden posixAccount picker'da gizli (POSIX akışı ayrı).
function ObjectClassSection({
  entry,
  schema,
  onChanged,
}: {
  entry: RawEntry | null
  schema: Schema | null
  onChanged: () => void | Promise<void>
}) {
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)

  if (!entry || !schema) return null

  const currentOCs = (entry.attributes['objectClass'] || entry.attributes['objectclass'] || [])
    .map((s) => s.toLowerCase())

  // Schema'daki tüm class'lar lookup için
  const ocByName = new Map<string, SchemaObjectClass>()
  for (const oc of schema.objectClasses) {
    for (const n of oc.names) ocByName.set(n.toLowerCase(), oc)
  }

  // Render edilecek mevcut class'lar — schema'da tanımı varsa kind'ını,
  // yoksa "unknown" olarak göster
  const visible = currentOCs.map((name) => {
    const def = ocByName.get(name)
    return {
      name,
      kind: (def?.kind || 'UNKNOWN') as 'STRUCTURAL' | 'AUXILIARY' | 'ABSTRACT' | 'UNKNOWN',
      // Display-friendly orijinal isim (ilk capitalize'dan al)
      display: def?.names[0] || name,
    }
  })

  // Eklenebilecek aux class'lar
  // Hidden list: zaten POSIX gibi özel akışları olan class'ları gizle.
  const HIDDEN_AUX = new Set(['posixaccount']) // POSIX dialog'u var
  const addable = schema.objectClasses
    .filter((oc) => oc.kind === 'AUXILIARY')
    .filter((oc) => !oc.names.some((n) => currentOCs.includes(n.toLowerCase())))
    .filter((oc) => !oc.names.some((n) => HIDDEN_AUX.has(n.toLowerCase())))
    .sort((a, b) => (a.names[0] || '').localeCompare(b.names[0] || ''))

  const addOC = async () => {
    if (!picked) return
    setBusy(true)
    try {
      await api.modifyEntryObjectClasses(entry.dn, { add: [picked] })
      toast.ok(`+ ${picked}`)
      setPicked('')
      setAdding(false)
      await onChanged()
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const removeOC = async (name: string) => {
    if (!confirm(`Remove auxiliary class "${name}"? İçindeki attribute'lar da silinir.`)) return
    setBusy(true)
    try {
      await api.modifyEntryObjectClasses(entry.dn, { remove: [name] })
      toast.ok(`- ${name}`)
      await onChanged()
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="label-mono mb-2">// objectClass</div>
      <div className="border border-ink-700 px-3 py-2.5 flex flex-wrap gap-1.5 items-center">
        {visible.map(({ name, kind, display }) => {
          const isStructural = kind === 'STRUCTURAL' || kind === 'ABSTRACT'
          const isAux = kind === 'AUXILIARY'
          const baseClasses =
            'text-[11px] font-mono px-2 py-0.5 border'
          const classByKind = isStructural
            ? 'bg-amber/10 border-amber/30 text-amber'
            : isAux
            ? 'bg-ink-800 border-ink-600 text-ink-100'
            : 'bg-ink-900 border-ink-700 text-ink-500'
          return (
            <span key={name} className={`${baseClasses} ${classByKind} flex items-center gap-1.5`}>
              {display}
              <span className="text-[9px] uppercase tracking-wider opacity-60">{kind.toLowerCase()}</span>
              {isAux && (
                <button
                  type="button"
                  onClick={() => removeOC(display)}
                  disabled={busy}
                  className="text-ink-500 hover:text-err disabled:opacity-30 ml-0.5"
                  title="kaldır"
                >
                  ✕
                </button>
              )}
            </span>
          )
        })}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={busy || addable.length === 0}
            className="text-[11px] font-mono text-amber hover:underline disabled:opacity-30 ml-1"
          >
            + add auxiliary
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2 border border-amber/30 bg-amber/5 p-3 space-y-2">
          <div className="label-mono">// add auxiliary class</div>
          <select
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber"
          >
            <option value="">— pick aux class —</option>
            {addable.map((oc) => (
              <option key={oc.oid} value={oc.names[0] || ''}>
                {oc.names[0]}
                {oc.must && oc.must.length > 0 ? ` (MUST: ${oc.must.join(', ')})` : ''}
                {oc.description ? ` — ${oc.description.slice(0, 50)}` : ''}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <Button size="sm" variant="primary" onClick={addOC} disabled={busy || !picked}>
              add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setPicked('') }}>
              cancel
            </Button>
          </div>
          {picked && (() => {
            const def = addable.find((o) => o.names[0] === picked)
            if (!def?.must || def.must.length === 0) return null
            return (
              <div className="text-[11px] font-mono text-warn">
                ⚠ MUST attribute'lar: {def.must.join(', ')} — eklemeden hemen sonra
                "+ add attribute" ile değer ata, yoksa sunucu schema violation atar.
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
