import { useEffect, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Dialog } from '../components/ui/Dialog'
import { useToast } from '../components/ui/Toast'
import { api, type PosixInfo, type User } from '../lib/api'

const COMMON_SHELLS = [
  '/bin/bash',
  '/bin/zsh',
  '/bin/sh',
  '/bin/fish',
  '/sbin/nologin',
  '/usr/sbin/nologin',
]

export function PosixDialog({
  user,
  onClose,
  onSaved,
}: {
  user: User | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [info, setInfo] = useState<PosixInfo | null>(null)
  const [autoUID, setAutoUID] = useState(true)
  const [uidNumber, setUIDNumber] = useState('')
  const [gidNumber, setGIDNumber] = useState('')
  const [homeDirectory, setHomeDirectory] = useState('')
  const [loginShell, setLoginShell] = useState('/bin/bash')
  const [gecos, setGecos] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    api
      .getPosix(user.uid)
      .then((info) => {
        setInfo(info)
        if (info.hasPosix) {
          setAutoUID(false)
          setUIDNumber(String(info.uidNumber || ''))
          setGIDNumber(String(info.gidNumber || ''))
          setHomeDirectory(info.homeDirectory || '')
          setLoginShell(info.loginShell || '/bin/bash')
          setGecos(info.gecos || '')
        } else {
          setAutoUID(true)
          setUIDNumber('')
          setGIDNumber('')
          setHomeDirectory(`/home/${user.uid}`)
          setLoginShell('/bin/bash')
          setGecos(`${user.firstName} ${user.lastName}`)
        }
      })
      .catch((e) => toast.err((e as Error).message))
  }, [user])

  if (!user) return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = await api.setPosix(user.uid, {
        uidNumber: autoUID ? 0 : parseInt(uidNumber) || 0,
        gidNumber: parseInt(gidNumber) || 0,
        homeDirectory: homeDirectory || undefined,
        loginShell: loginShell || undefined,
        gecos: gecos || undefined,
      })
      toast.ok(
        info?.hasPosix
          ? `updated posix for ${user.uid}`
          : `posixAccount enabled for ${user.uid} · uid=${result.uidNumber}`
      )
      onSaved()
    } catch (e) {
      toast.err((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm(`Remove posixAccount from "${user.uid}"?`)) return
    setBusy(true)
    try {
      await api.removePosix(user.uid)
      toast.ok(`posixAccount removed from ${user.uid}`)
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
      title={`posix · ${user.uid}`}
      size="md"
      footer={
        <>
          {info?.hasPosix && (
            <Button variant="danger" onClick={remove} disabled={busy}>
              remove posix
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {info?.hasPosix ? 'save' : 'enable posixAccount'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!info ? (
          <div className="label-mono">// loading...</div>
        ) : (
          <>
            {!info.hasPosix && (
              <div className="bg-amber/10 border border-amber/30 px-3 py-2 text-xs text-amber font-mono">
                // user does not yet have posixAccount class.
                // saving will add the auxiliary class with the values below.
              </div>
            )}

            {/* UID number */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="label-mono">uid number</div>
                <label className="flex items-center gap-1.5 text-xs font-mono cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoUID}
                    onChange={(e) => setAutoUID(e.target.checked)}
                    className="accent-amber"
                  />
                  <span className="text-ink-300">auto-assign next available</span>
                </label>
              </div>
              <input
                type="number"
                value={uidNumber}
                onChange={(e) => setUIDNumber(e.target.value)}
                disabled={autoUID}
                placeholder={autoUID ? 'will be calculated on save' : ''}
                className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber disabled:opacity-50"
              />
            </div>

            <Input
              label="gid number"
              type="number"
              mono
              value={gidNumber}
              onChange={(e) => setGIDNumber(e.target.value)}
              placeholder="defaults to uid number"
              hint="leave empty for primary group = uid"
            />

            <Input
              label="home directory"
              mono
              value={homeDirectory}
              onChange={(e) => setHomeDirectory(e.target.value)}
              placeholder={`/home/${user.uid}`}
            />

            <div>
              <div className="label-mono mb-1.5">login shell</div>
              <input
                list="shell-options"
                value={loginShell}
                onChange={(e) => setLoginShell(e.target.value)}
                className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber"
              />
              <datalist id="shell-options">
                {COMMON_SHELLS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>

            <Input
              label="gecos"
              value={gecos}
              onChange={(e) => setGecos(e.target.value)}
              hint="comment field, traditionally full name"
            />
          </>
        )}
      </div>
    </Dialog>
  )
}
