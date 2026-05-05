import { FormEvent, useEffect, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Dialog } from '../components/ui/Dialog'
import { Empty } from '../components/ui/Empty'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../lib/auth'
import { api, ApiError, type Group, type User } from '../lib/api'
import { useAutoRefresh } from '../lib/useAutoRefresh'

export function Groups() {
  const { me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const toast = useToast()

  const [groups, setGroups] = useState<Group[] | null>(null)
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [managing, setManaging] = useState<Group | null>(null)

  const load = async (query = q) => {
    try {
      const res = await api.listGroups(query)
      setGroups(res.items)
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  const refresh = async () => {
    try {
      const res = await api.listGroups(q)
      setGroups(res.items)
    } catch {
      /* sessiz */
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

  const onDelete = async (g: Group) => {
    if (!confirm(`Delete group "${g.cn}"? Members will not be deleted.`)) return
    try {
      await api.deleteGroup(g.cn)
      toast.ok(`deleted: ${g.cn}`)
      load()
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  return (
    <Layout>
      <PageHeader
        title="Groups"
        subtitle={
          groups ? `${groups.length} entries · groupOfNames` : 'loading...'
        }
        actions={
          isAdmin && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              + new group
            </Button>
          )
        }
      />
      <PageBody>
        <form onSubmit={onSearch} className="flex gap-2 mb-4">
          <Input
            placeholder="search by cn or description..."
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

        {groups === null ? (
          <div className="label-mono p-8">// loading directory...</div>
        ) : groups.length === 0 ? (
          <Empty title="No groups found" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {groups.map((g) => (
              <div key={g.dn} className="panel p-4 hover:border-ink-500 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-amber text-sm">{g.cn}</div>
                    <div className="text-xs text-ink-500 font-mono truncate mt-0.5">
                      {g.dn}
                    </div>
                    {g.description && (
                      <div className="text-sm text-ink-300 mt-2">{g.description}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-2xl text-ink-100 leading-none">
                      {g.members.length}
                    </div>
                    <div className="label-mono mt-1">members</div>
                  </div>
                </div>
                <div className="hairline my-3" />
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setManaging(g)}>
                    {isAdmin ? 'manage' : 'view'} members
                  </Button>
                  {isAdmin && (
                    <Button size="sm" variant="danger" onClick={() => onDelete(g)}>
                      delete
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>

      <CreateGroupDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          load()
        }}
      />
      <ManageMembersDialog
        group={managing}
        canEdit={isAdmin}
        onClose={() => setManaging(null)}
      />
    </Layout>
  )
}

function CreateGroupDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [cn, setCn] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setCn('')
      setDescription('')
    }
  }, [open])

  const submit = async () => {
    setBusy(true)
    try {
      await api.createGroup({ cn, description })
      toast.ok(`created: ${cn}`)
      onCreated()
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="new group"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !cn}>
            create
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="cn" mono value={cn} onChange={(e) => setCn(e.target.value)} required />
        <Input
          label="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="label-mono mt-2">
          // a placeholder member (the admin bind DN) is added so the entry passes
          <br />
          // groupOfNames validation. you can remove it after adding real members.
        </div>
      </div>
    </Dialog>
  )
}

function ManageMembersDialog({
  group,
  canEdit,
  onClose,
}: {
  group: Group | null
  canEdit: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [members, setMembers] = useState<string[]>([]) // member DN listesi
  const [picker, setPicker] = useState('')

  useEffect(() => {
    if (!group) return
    setMembers(group.members)
    api.listUsers().then((r) => setAllUsers(r.items)).catch(() => {})
  }, [group])

  if (!group) return null

  // member DN listesinden uid çıkarma: "uid=happy,ou=users,dc=..." → "happy"
  const memberUids = members
    .map((dn) => {
      const m = dn.match(/^uid=([^,]+),/i)
      return m ? m[1] : null
    })
    .filter(Boolean) as string[]

  const remove = async (uid: string) => {
    try {
      await api.removeGroupMember(group.cn, uid)
      setMembers((m) => m.filter((dn) => !dn.toLowerCase().startsWith(`uid=${uid.toLowerCase()},`)))
      toast.ok(`removed: ${uid}`)
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  const add = async () => {
    const uid = picker.trim()
    if (!uid) return
    try {
      await api.addGroupMember(group.cn, uid)
      // optimistic refresh: tam DN'i bilemediğimizden uid'i geçici tut
      const found = allUsers.find((u) => u.uid === uid)
      if (found) setMembers((m) => [...m, found.dn])
      setPicker('')
      toast.ok(`added: ${uid}`)
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  const candidates = allUsers
    .filter((u) => !memberUids.includes(u.uid))
    .filter((u) => !picker || u.uid.toLowerCase().includes(picker.toLowerCase()))

  return (
    <Dialog
      open={!!group}
      onClose={onClose}
      title={`members · ${group.cn}`}
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          close
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="font-mono text-xs text-ink-500 break-all bg-ink-950 border border-ink-700 px-3 py-2">
          {group.dn}
        </div>

        {canEdit && (
          <div>
            <div className="label-mono mb-1.5">add member</div>
            <div className="flex gap-2">
              <input
                list="user-options"
                placeholder="type or pick a uid..."
                value={picker}
                onChange={(e) => setPicker(e.target.value)}
                className="flex-1 h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber"
              />
              <datalist id="user-options">
                {candidates.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.firstName} {u.lastName}
                  </option>
                ))}
              </datalist>
              <Button onClick={add} disabled={!picker}>
                add
              </Button>
            </div>
          </div>
        )}

        <div>
          <div className="label-mono mb-1.5">current members ({members.length})</div>
          {members.length === 0 ? (
            <div className="text-sm text-ink-500 font-mono py-4">// empty group</div>
          ) : (
            <div className="border border-ink-700 max-h-64 overflow-y-auto">
              {members.map((dn) => {
                const m = dn.match(/^uid=([^,]+),/i)
                const uid = m ? m[1] : null
                return (
                  <div
                    key={dn}
                    className="flex items-center justify-between px-3 py-2 border-b border-ink-700 last:border-0 row-hover"
                  >
                    <div className="font-mono text-xs truncate">
                      {uid ? <span className="text-amber">{uid}</span> : null}
                      <span className="text-ink-500 ml-2">{dn}</span>
                    </div>
                    {canEdit && uid && (
                      <button
                        onClick={() => remove(uid)}
                        className="text-xs text-ink-500 hover:text-err transition-colors font-mono ml-2"
                      >
                        remove
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
