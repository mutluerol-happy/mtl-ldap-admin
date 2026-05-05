import { useEffect, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Dialog } from '../components/ui/Dialog'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../lib/auth'
import {
  api,
  ApiError,
  type RawEntry,
  type Schema,
  type SchemaAttribute,
  type SchemaObjectClass,
  type TreeNode,
} from '../lib/api'

type LoadedNode = TreeNode & {
  expanded: boolean
  children?: LoadedNode[]
  loading?: boolean
}

export function TreePage() {
  const { me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const toast = useToast()

  const [roots, setRoots] = useState<LoadedNode[] | null>(null)
  const [selected, setSelected] = useState<RawEntry | null>(null)
  const [createOUOpen, setCreateOUOpen] = useState(false)
  const [createOUParent, setCreateOUParent] = useState<string>('')

  const loadRoot = async () => {
    try {
      const r = await api.treeChildren()
      setRoots(r.items.map((n) => ({ ...n, expanded: false })))
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  useEffect(() => {
    loadRoot()
  }, [])

  // Recursive update helper
  const updateNode = (
    nodes: LoadedNode[],
    dn: string,
    fn: (n: LoadedNode) => LoadedNode
  ): LoadedNode[] => {
    return nodes.map((n) => {
      if (n.dn === dn) return fn(n)
      if (n.children) {
        return { ...n, children: updateNode(n.children, dn, fn) }
      }
      return n
    })
  }

  const toggleExpand = async (n: LoadedNode) => {
    if (!roots) return
    if (n.expanded) {
      setRoots((r) => (r ? updateNode(r, n.dn, (x) => ({ ...x, expanded: false })) : r))
      return
    }
    if (n.children) {
      setRoots((r) => (r ? updateNode(r, n.dn, (x) => ({ ...x, expanded: true })) : r))
      return
    }
    setRoots((r) => (r ? updateNode(r, n.dn, (x) => ({ ...x, loading: true })) : r))
    try {
      const r = await api.treeChildren(n.dn)
      setRoots((roots) =>
        roots
          ? updateNode(roots, n.dn, (x) => ({
              ...x,
              loading: false,
              expanded: true,
              children: r.items.map((c) => ({ ...c, expanded: false })),
            }))
          : roots
      )
    } catch (e) {
      toast.err((e as Error).message)
      setRoots((r) =>
        r ? updateNode(r, n.dn, (x) => ({ ...x, loading: false })) : r
      )
    }
  }

  const select = async (n: LoadedNode) => {
    try {
      const e = await api.getEntry(n.dn)
      setSelected(e)
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  const onCreateOU = (parentDN: string) => {
    setCreateOUParent(parentDN)
    setCreateOUOpen(true)
  }

  const onDeleteOU = async (dn: string) => {
    if (!confirm(`Delete OU "${dn}"?\n\nThe OU must be empty.`)) return
    try {
      await api.deleteOU(dn)
      toast.ok('deleted')
      loadRoot()
      if (selected?.dn === dn) setSelected(null)
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  return (
    <Layout>
      <PageHeader
        title="Directory Tree"
        subtitle="advanced — browse the raw DIT"
        actions={
          isAdmin && (
            <Button variant="primary" onClick={() => onCreateOU('')}>
              + new OU
            </Button>
          )
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Tree */}
          <div className="panel p-4">
            <div className="label-mono mb-3">// dit</div>
            {roots === null ? (
              <div className="label-mono">// loading...</div>
            ) : (
              <div className="font-mono text-sm">
                {roots.map((n) => (
                  <Node
                    key={n.dn}
                    node={n}
                    depth={0}
                    onToggle={toggleExpand}
                    onSelect={select}
                    selectedDN={selected?.dn}
                    isAdmin={isAdmin}
                    onCreateOU={onCreateOU}
                    onDeleteOU={onDeleteOU}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Detail */}
          <div className="lg:sticky lg:top-4 self-start">
            {selected ? (
              <EntryDetail
                entry={selected}
                onEdited={async () => {
                  // Edit sonrası seçili entry'yi yeniden çek (cached state stale).
                  try {
                    const e = await api.getEntry(selected.dn)
                    setSelected(e)
                  } catch (err) {
                    toast.err((err as Error).message)
                  }
                }}
              />
            ) : (
              <div className="panel p-6 text-center text-sm text-ink-500 font-mono">
                // pick an entry to inspect
              </div>
            )}
          </div>
        </div>
      </PageBody>

      <CreateOUDialog
        open={createOUOpen}
        parentDN={createOUParent}
        onClose={() => setCreateOUOpen(false)}
        onCreated={() => {
          setCreateOUOpen(false)
          loadRoot()
        }}
      />
    </Layout>
  )
}

function Node({
  node,
  depth,
  onToggle,
  onSelect,
  selectedDN,
  isAdmin,
  onCreateOU,
  onDeleteOU,
}: {
  node: LoadedNode
  depth: number
  onToggle: (n: LoadedNode) => void
  onSelect: (n: LoadedNode) => void
  selectedDN?: string
  isAdmin?: boolean
  onCreateOU: (parentDN: string) => void
  onDeleteOU: (dn: string) => void
}) {
  const indent = depth * 16
  const isOU = node.objectClass.some((oc) => oc.toLowerCase() === 'organizationalunit')
  const isSelected = selectedDN === node.dn

  return (
    <div>
      <div
        className={`flex items-center gap-1 group px-1 py-0.5 transition-colors ${
          isSelected ? 'bg-amber/10' : 'hover:bg-ink-800/50'
        }`}
        style={{ paddingLeft: 4 + indent }}
      >
        {/* Expand toggle */}
        {node.hasChildren ? (
          <button
            onClick={() => onToggle(node)}
            className="w-4 text-ink-500 hover:text-amber transition-colors text-xs"
          >
            {node.loading ? '…' : node.expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4 text-ink-700">·</span>
        )}

        {/* RDN */}
        <button onClick={() => onSelect(node)} className="text-left flex-1 truncate">
          <span className={isOU ? 'text-amber' : 'text-ink-100'}>{node.rdn}</span>
          <span className="text-[10px] text-ink-500 ml-2 font-mono uppercase">
            {node.objectClass[0] || ''}
          </span>
        </button>

        {/* Inline actions */}
        {isAdmin && isOU && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
            <button
              onClick={() => onCreateOU(node.dn)}
              className="text-[10px] text-ink-500 hover:text-amber transition-colors"
              title="create child OU"
            >
              +ou
            </button>
            <button
              onClick={() => onDeleteOU(node.dn)}
              className="text-[10px] text-ink-500 hover:text-err transition-colors"
              title="delete OU (must be empty)"
            >
              del
            </button>
          </div>
        )}
      </div>

      {node.expanded && node.children && (
        <div>
          {node.children.map((c) => (
            <Node
              key={c.dn}
              node={c}
              depth={depth + 1}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedDN={selectedDN}
              isAdmin={isAdmin}
              onCreateOU={onCreateOU}
              onDeleteOU={onDeleteOU}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function EntryDetail({ entry, onEdited }: { entry: RawEntry; onEdited: () => void }) {
  const [editing, setEditing] = useState(false)
  const attrs = Object.entries(entry.attributes).sort()
  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <div className="label-mono mb-1">// dn</div>
          <div className="font-mono text-xs text-amber break-all">{entry.dn}</div>
        </div>
        <Button size="sm" variant="primary" onClick={() => setEditing(true)}>
          edit
        </Button>
      </div>

      <div className="label-mono mb-2">attributes ({attrs.length})</div>
      <div className="border border-ink-700 max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {attrs.map(([name, values]) => (
              <tr key={name} className="border-b border-ink-700 last:border-0">
                <td className="px-3 py-2 font-mono text-xs text-amber align-top whitespace-nowrap">
                  {name}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-ink-300 break-all">
                  {values.length === 1 ? (
                    <span>{truncateValue(values[0])}</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {values.map((v, i) => (
                        <li key={i}>{truncateValue(v)}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EntryEditDialog
        open={editing}
        entry={entry}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false)
          onEdited()
        }}
      />
    </div>
  )
}

function truncateValue(v: string): string {
  if (v.length > 200) return v.slice(0, 200) + '…(' + v.length + ' chars)'
  return v
}

function CreateOUDialog({
  open,
  parentDN,
  onClose,
  onCreated,
}: {
  open: boolean
  parentDN: string
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
    }
  }, [open])

  const submit = async () => {
    setBusy(true)
    try {
      await api.createOU({ name, parentDN: parentDN || undefined, description })
      toast.ok(`created: ou=${name}`)
      onCreated()
    } catch (e) {
      toast.err((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="new organizational unit"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name}>
            create
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {parentDN && (
          <div>
            <div className="label-mono mb-1">parent</div>
            <div className="font-mono text-xs text-ink-300 bg-ink-950 border border-ink-700 px-3 py-2 break-all">
              {parentDN}
            </div>
          </div>
        )}
        <Input
          label="name (ou)"
          mono
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="engineering"
          required
        />
        <Input
          label="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </Dialog>
  )
}

// v0.9: DN Tree'den entry edit. Users.tsx'teki AttributesTab'ın generic
// versiyonu — keyfi DN üstünde çalışır (user, group, OU, ppolicy entry, vb).
// PATCH /api/entries/attributes ve POST /api/entries/objectClasses çağrıları
// kullanır.
//
// Reuse stratejisi: Users.tsx'teki AttributesTab inline tab; bu Dialog tek
// başına çalışan versiyon. Backend semantic'i aynı, ama UI kabuğu farklı
// (Dialog vs Tab). İkisini ortak component'e refactor etmek gelecek
// iterasyonda yapılır; şimdilik kontrollü duplikasyon.

const PROTECTED_ATTRS_TREE = new Set([
  'objectclass', 'userpassword', 'creatorsname', 'createtimestamp',
  'modifiersname', 'modifytimestamp', 'entryuuid', 'entrycsn',
  'structuralobjectclass', 'subschemasubentry', 'hassubordinates',
  'memberof', // operational, memberOf overlay tarafından yönetilir
])

// pwd*'la başlayanların TÜMÜ değil sadece server-managed olanları gizle.
// pwdMaxFailure, pwdMinLength, pwdLockout vs. POLICY config attribute'larıdır
// ve ppolicy entry'lerinde edit edilebilir olmalı.
const PWD_OPERATIONAL_HIDDEN = new Set([
  'pwdchangedtime',
  'pwdaccountlockedtime', // user disable/enable endpoint'i kullanılır
  'pwdfailuretime',
  'pwdhistory',
  'pwdreset',
  'pwdpolicysubentry',
  'pwdgraceusetime',
])

// RDN attribute'unu bul: entry.dn'in ilk parçasından "uid"/"cn"/"ou" gibi.
// Bu attr da edit'lenemez (RDN değişimi modDN gerektirir, ayrı flow).
function rdnAttribute(dn: string): string | null {
  const m = dn.match(/^([A-Za-z][A-Za-z0-9-]*)=/)
  return m ? m[1].toLowerCase() : null
}

type TreePending =
  | { kind: 'add'; attr: string; values: string[] }
  | { kind: 'replace'; attr: string; values: string[] }
  | { kind: 'delete'; attr: string }

function EntryEditDialog({
  open,
  entry,
  onClose,
  onSaved,
}: {
  open: boolean
  entry: RawEntry
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [schema, setSchema] = useState<Schema | null>(null)
  const [pending, setPending] = useState<TreePending[]>([])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Record<string, string[]>>({})
  const [adding, setAdding] = useState(false)
  const [newAttr, setNewAttr] = useState('')
  const [newValue, setNewValue] = useState('')

  useEffect(() => {
    if (!open) {
      setPending([])
      setEditing({})
      setAdding(false)
      setNewAttr('')
      setNewValue('')
      return
    }
    api.getSchema().then(setSchema).catch((e) => toast.err((e as Error).message))
  }, [open])

  const rdnAttr = rdnAttribute(entry.dn)

  // Hangi attr'lar editör tarafından gizlenmeli?
  const isHidden = (name: string) => {
    const ln = name.toLowerCase()
    if (PROTECTED_ATTRS_TREE.has(ln)) return true
    if (PWD_OPERATIONAL_HIDDEN.has(ln)) return true
    return false
  }

  // Schema'dan allowed attrs (objectClass hierarchy'sine göre MAY+MUST)
  const ocs = (entry.attributes['objectClass'] || entry.attributes['objectclass'] || [])
    .map((s) => s.toLowerCase())
  const allowedAttrs: SchemaAttribute[] = (() => {
    if (!schema || ocs.length === 0) return []
    const ocByName = new Map<string, SchemaObjectClass>()
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
  })()

  // Görünür attribute satırları (RDN ve hidden hariç)
  const visibleEntries = Object.entries(entry.attributes)
    .filter(([name]) => !isHidden(name))
    .filter(([name]) => name.toLowerCase() !== rdnAttr)
    .map(([attr, values]) => {
      const ln = attr.toLowerCase()
      const def = allowedAttrs.find((a) => a.names.some((n) => n.toLowerCase() === ln))
      return { attr, values, def }
    })
    .sort((a, b) => a.attr.localeCompare(b.attr))

  // Eklenebilir attribute'lar
  const present = new Set(Object.keys(entry.attributes).map((a) => a.toLowerCase()))
  const addableAttrs = allowedAttrs
    .filter((a) => !a.noUserMod)
    .filter((a) => !a.names.some((n) => isHidden(n)))
    .filter((a) => a.names.every((n) => n.toLowerCase() !== rdnAttr))
    .filter((a) => {
      if (a.singleValue && a.names.some((n) => present.has(n.toLowerCase()))) return false
      return true
    })
    .sort((a, b) => (a.names[0] || '').localeCompare(b.names[0] || ''))

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
    if (!confirm(`delete attribute "${attr}"?`)) return
    setPending((prev) => [
      ...prev.filter((p) => p.attr !== attr),
      { kind: 'delete', attr },
    ])
  }
  const queueAdd = () => {
    if (!newAttr || !newValue.trim()) return
    setPending((prev) => {
      const ex = prev.find((p) => p.kind === 'add' && p.attr === newAttr) as
        | Extract<TreePending, { kind: 'add' }>
        | undefined
      if (ex) {
        return prev
          .filter((p) => !(p.kind === 'add' && p.attr === newAttr))
          .concat({ kind: 'add', attr: newAttr, values: [...ex.values, newValue.trim()] })
      }
      return [...prev, { kind: 'add', attr: newAttr, values: [newValue.trim()] }]
    })
    setNewValue('')
    setNewAttr('')
    setAdding(false)
  }
  const removePending = (i: number) =>
    setPending((prev) => prev.filter((_, idx) => idx !== i))

  const save = async () => {
    if (pending.length === 0) {
      onClose()
      return
    }
    const mod = {
      add: {} as Record<string, string[]>,
      replace: {} as Record<string, string[]>,
      delete: {} as Record<string, string[]>,
    }
    for (const p of pending) {
      if (p.kind === 'add') mod.add[p.attr] = (mod.add[p.attr] || []).concat(p.values)
      else if (p.kind === 'replace') mod.replace[p.attr] = p.values
      else mod.delete[p.attr] = []
    }
    setBusy(true)
    try {
      await api.modifyEntry(entry.dn, mod)
      toast.ok(`updated: ${entry.dn}`)
      onSaved()
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="edit entry" size="lg" footer={null}>
      <div className="space-y-4">
        <div className="font-mono text-xs text-ink-500 break-all bg-ink-950 border border-ink-700 px-3 py-2">
          {entry.dn}
        </div>

        {!schema ? (
          <div className="label-mono">// loading schema...</div>
        ) : (
          <>
            <div>
              <div className="label-mono mb-2">// current attributes</div>
              {visibleEntries.length === 0 ? (
                <div className="text-xs text-ink-500 font-mono px-3 py-4 border border-ink-700 border-dashed">
                  no editable attributes — use "+ add" below
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
                            {isEditing ? (
                              <TreeValueEditor
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
                                    {truncateValue(v)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            {isEditing ? (
                              <>
                                <Button size="sm" variant="primary" onClick={() => commitEdit(attr)}>ok</Button>
                                <Button size="sm" variant="ghost" onClick={() => cancelEdit(attr)}>cancel</Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => startEdit(attr, values)}>edit</Button>
                                <Button size="sm" variant="danger" onClick={() => queueDelete(attr)}>del</Button>
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

            <div>
              {!adding ? (
                <Button size="sm" variant="secondary" onClick={() => setAdding(true)}
                  disabled={addableAttrs.length === 0}>
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
                    <Button size="sm" variant="primary" onClick={queueAdd}
                      disabled={!newAttr || !newValue.trim()}>queue</Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      setAdding(false); setNewAttr(''); setNewValue('')
                    }}>cancel</Button>
                  </div>
                </div>
              )}
            </div>

            {pending.length > 0 && (
              <div className="border border-warn/30 bg-warn/5 p-3">
                <div className="label-mono mb-1.5 text-warn">
                  // {pending.length} pending change(s)
                </div>
                <div className="space-y-1">
                  {pending.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs font-mono">
                      <span>
                        <span className={`uppercase tracking-wider mr-2 ${
                          p.kind === 'delete' ? 'text-err' : p.kind === 'add' ? 'text-ok' : 'text-warn'
                        }`}>{p.kind}</span>
                        <span className="text-amber">{p.attr}</span>
                        {'values' in p && (
                          <span className="text-ink-300"> = {p.values.join(', ')}</span>
                        )}
                      </span>
                      <button onClick={() => removePending(i)}
                        className="text-ink-500 hover:text-err" type="button">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-ink-700">
          <Button variant="ghost" onClick={onClose}>cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || pending.length === 0}>
            {busy ? 'applying...' : `apply ${pending.length || ''} change${pending.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function TreeValueEditor({
  values, singleValue, onChange,
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
          <input value={v} onChange={(e) => setAt(i, e.target.value)}
            className="flex-1 h-8 bg-ink-950 border border-ink-700 px-2 text-xs font-mono focus:outline-none focus:border-amber" />
          {!singleValue && (
            <button type="button" onClick={() => removeAt(i)}
              className="text-xs text-ink-500 hover:text-err font-mono px-2">✕</button>
          )}
        </div>
      ))}
      {!singleValue && (
        <button type="button" onClick={append}
          className="text-[10px] text-ink-500 hover:text-amber font-mono">+ value</button>
      )}
    </div>
  )
}
