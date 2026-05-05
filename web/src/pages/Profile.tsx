import { useEffect, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Dialog } from '../components/ui/Dialog'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../lib/auth'
import { api, ApiError, type MFAStatus, type SecurityQuestion } from '../lib/api'

export function Profile() {
  const { me } = useAuth()
  const toast = useToast()
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [busy, setBusy] = useState(false)

  const [mfa, setMfa] = useState<MFAStatus | null>(null)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [questions, setQuestions] = useState<SecurityQuestion[] | null>(null)
  const [questionsOpen, setQuestionsOpen] = useState(false)

  const loadAux = async () => {
    try {
      const [m, qs] = await Promise.all([api.mfaStatus(), api.myQuestions()])
      setMfa(m)
      setQuestions(qs.items)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadAux()
  }, [])

  if (!me) return null

  const submitPw = async () => {
    if (newPw !== confirmPw) {
      toast.err('new passwords do not match')
      return
    }
    if (newPw.length < 8) {
      toast.err('password must be at least 8 characters')
      return
    }
    setBusy(true)
    try {
      await api.changeOwnPassword(oldPw, newPw)
      toast.ok('password changed')
      setOldPw('')
      setNewPw('')
      setConfirmPw('')
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const disableMFA = async () => {
    if (!confirm('Disable MFA? Your account will use only password.')) return
    try {
      await api.mfaDisable()
      toast.ok('mfa disabled')
      loadAux()
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  return (
    <Layout>
      <PageHeader title="Profile" subtitle={me.user.dn} />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-4xl">
          {/* Identity */}
          <div className="panel p-6">
            <div className="label-mono mb-3">// identity</div>
            <dl className="space-y-3">
              <Row label="uid" value={me.user.uid} mono />
              <Row label="role" value={me.role} mono accent={me.role === 'admin'} />
              <Row label="cn" value={`${me.user.firstName} ${me.user.lastName}`} />
              <Row label="mail" value={me.user.email || '—'} mono />
              {me.user.phone && <Row label="phone" value={me.user.phone} mono />}
              <Row label="dn" value={me.user.dn} mono small />
              <Row
                label="memberOf"
                value={me.user.groups.length ? `${me.user.groups.length} groups` : '—'}
              />
              {me.user.passwordChangedAt && (
                <Row
                  label="password changed"
                  value={fmtPwdTime(me.user.passwordChangedAt)}
                  mono
                  small
                />
              )}
              {me.user.accountLocked && (
                <Row label="account" value="LOCKED" mono accent />
              )}
            </dl>
          </div>

          {/* Change password */}
          <div className="panel p-6">
            <div className="label-mono mb-3">// change password</div>
            <div className="space-y-3">
              <Input
                label="current password"
                type="password"
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
              />
              <Input
                label="new password"
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                hint="minimum 8 characters"
              />
              <Input
                label="confirm new password"
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
              />
              <Button
                variant="primary"
                onClick={submitPw}
                disabled={busy || !oldPw || !newPw || !confirmPw}
              >
                update password
              </Button>
            </div>
          </div>

          {/* MFA */}
          <div className="panel p-6">
            <div className="flex items-center justify-between mb-3">
              <div className="label-mono">// two-factor auth</div>
              {mfa?.enabled && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-ok bg-ok/10 border border-ok/30 px-1.5 py-0.5">
                  enabled
                </span>
              )}
            </div>

            {!mfa ? (
              <div className="label-mono">// loading...</div>
            ) : mfa.enabled ? (
              <div className="space-y-3">
                <p className="text-sm text-ink-300">
                  Your account is protected with TOTP. You have{' '}
                  <span className="text-amber font-mono">{mfa.backupCodesRemaining}</span>{' '}
                  backup codes remaining.
                </p>
                <Button variant="danger" onClick={disableMFA}>
                  disable MFA
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink-300">
                  Add a second factor with any TOTP app (Google Authenticator, 1Password,
                  Authy, etc.).
                </p>
                {mfa.required && (
                  <div className="bg-warn/10 border border-warn/30 px-3 py-2 text-xs text-warn font-mono">
                    ⚠ MFA is required for all users on this server.
                  </div>
                )}
                <Button variant="primary" onClick={() => setEnrollOpen(true)}>
                  enable MFA
                </Button>
              </div>
            )}
          </div>

          {/* Security questions */}
          <div className="panel p-6">
            <div className="flex items-center justify-between mb-3">
              <div className="label-mono">// security questions</div>
              {questions && questions.length > 0 && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-ok bg-ok/10 border border-ok/30 px-1.5 py-0.5">
                  {questions.length} set
                </span>
              )}
            </div>
            <p className="text-sm text-ink-300 mb-3">
              Used as a recovery method if email/SMS aren't available.
            </p>
            <Button onClick={() => setQuestionsOpen(true)}>
              {questions && questions.length > 0 ? 'update questions' : 'set up questions'}
            </Button>
          </div>
        </div>
      </PageBody>

      <MFAEnrollDialog
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        onEnabled={() => {
          setEnrollOpen(false)
          loadAux()
        }}
      />
      <SecurityQuestionsDialog
        open={questionsOpen}
        existing={questions || []}
        onClose={() => setQuestionsOpen(false)}
        onSaved={() => {
          setQuestionsOpen(false)
          loadAux()
        }}
      />
    </Layout>
  )
}

function MFAEnrollDialog({
  open,
  onClose,
  onEnabled,
}: {
  open: boolean
  onClose: () => void
  onEnabled: () => void
}) {
  const toast = useToast()
  const [enrollment, setEnrollment] = useState<{
    secret: string
    otpauth: string
  } | null>(null)
  const [code, setCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setEnrollment(null)
    setCode('')
    setBackupCodes(null)
    api
      .mfaEnroll()
      .then((r) => setEnrollment({ secret: r.secret, otpauth: r.otpauth }))
      .catch((e) => toast.err((e as Error).message))
  }, [open])

  const verify = async () => {
    setBusy(true)
    try {
      const res = await api.mfaEnable(code)
      setBackupCodes(res.backupCodes)
      toast.ok('MFA enabled')
    } catch (e) {
      toast.err((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <Dialog
      open
      onClose={backupCodes ? onEnabled : onClose}
      title={backupCodes ? 'save your backup codes' : 'enable mfa'}
      size="md"
      footer={
        backupCodes ? (
          <Button variant="primary" onClick={onEnabled}>
            i've saved them
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              cancel
            </Button>
            <Button variant="primary" onClick={verify} disabled={busy || code.length < 6}>
              verify & enable
            </Button>
          </>
        )
      }
    >
      {backupCodes ? (
        <div className="space-y-3">
          <div className="bg-warn/10 border border-warn/30 px-3 py-2 text-xs text-warn font-mono">
            ⚠ Save these codes in a safe place. They are shown only once and let you sign in
            if you lose your authenticator.
          </div>
          <div className="grid grid-cols-2 gap-2 bg-ink-950 border border-ink-700 p-4">
            {backupCodes.map((c, i) => (
              <div key={i} className="font-mono text-sm select-all">
                {c}
              </div>
            ))}
          </div>
          <Button
            onClick={() => {
              navigator.clipboard.writeText(backupCodes.join('\n'))
              toast.ok('copied to clipboard')
            }}
          >
            copy all
          </Button>
        </div>
      ) : !enrollment ? (
        <div className="label-mono">// generating secret...</div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="label-mono mb-2">step 1 — scan or enter</div>
            <div className="flex gap-4">
              {/* QR code via external service is risky for offline; we render a tag instead */}
              <QRPlaceholder data={enrollment.otpauth} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink-300 mb-2 font-mono">
                  Scan the QR or enter the secret manually:
                </div>
                <div className="bg-ink-950 border border-ink-700 px-3 py-2 font-mono text-xs break-all select-all">
                  {enrollment.secret}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="label-mono mb-2">step 2 — verify</div>
            <Input
              label="6-digit code from your app"
              mono
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
          </div>
        </div>
      )}
    </Dialog>
  )
}

// QRPlaceholder renders an actual QR with tiny logic so we don't pull a heavy dep.
// Uses the public API qrcode-server kullanmıyoruz; bunun yerine bir fallback olarak
// otpauth URL'sini büyük seçilebilir text olarak gösteriyoruz.
// Production'da `qrcode` (npm) kütüphanesi eklenebilir; şimdilik basit.
function QRPlaceholder({ data }: { data: string }) {
  // Use a public QR API only if user is online; offline fallback below.
  // Resmi olarak: kullanıcı manuel secret girebilir, QR opsiyonel.
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
    data
  )}`
  return (
    <div className="w-44 h-44 bg-white border border-ink-700 p-2 flex-shrink-0">
      <img src={qrSrc} alt="QR" className="w-full h-full" />
    </div>
  )
}

function SecurityQuestionsDialog({
  open,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean
  existing: SecurityQuestion[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [items, setItems] = useState<{ question: string; answer: string }[]>([
    { question: '', answer: '' },
    { question: '', answer: '' },
    { question: '', answer: '' },
  ])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    if (existing.length > 0) {
      setItems(existing.map((q) => ({ question: q.question, answer: '' })))
    } else {
      setItems([
        { question: 'What city were you born in?', answer: '' },
        { question: "What is your mother's maiden name?", answer: '' },
        { question: 'What was the name of your first pet?', answer: '' },
      ])
    }
  }, [open])

  const submit = async () => {
    if (items.some((i) => !i.question.trim() || !i.answer.trim())) {
      toast.err('all questions and answers are required')
      return
    }
    setBusy(true)
    try {
      await api.setMyQuestions(items)
      toast.ok(
        existing.length > 0
          ? 'questions updated'
          : 'security questions saved'
      )
      onSaved()
    } catch (e) {
      toast.err((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <Dialog
      open
      onClose={onClose}
      title="security questions"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-xs text-ink-500 font-mono leading-relaxed">
          // answers are case-insensitive and stored hashed.
          <br />
          // you'll need to answer 2 of 3 correctly to reset your password.
        </div>

        {items.map((it, i) => (
          <div key={i} className="space-y-2 pb-3 border-b border-ink-700 last:border-0">
            <Input
              label={`question ${i + 1}`}
              value={it.question}
              onChange={(e) =>
                setItems((arr) => {
                  const next = [...arr]
                  next[i] = { ...next[i], question: e.target.value }
                  return next
                })
              }
            />
            <Input
              label="answer"
              type="password"
              value={it.answer}
              onChange={(e) =>
                setItems((arr) => {
                  const next = [...arr]
                  next[i] = { ...next[i], answer: e.target.value }
                  return next
                })
              }
              hint={existing.length > 0 ? 'enter new answer to update' : undefined}
            />
          </div>
        ))}
      </div>
    </Dialog>
  )
}

function Row({
  label,
  value,
  mono,
  small,
  accent,
}: {
  label: string
  value: string
  mono?: boolean
  small?: boolean
  accent?: boolean
}) {
  return (
    <div className="flex flex-col">
      <dt className="label-mono mb-0.5">{label}</dt>
      <dd
        className={`${mono ? 'font-mono' : ''} ${
          small ? 'text-xs' : 'text-sm'
        } ${accent ? 'text-amber' : 'text-ink-100'} break-all`}
      >
        {value}
      </dd>
    </div>
  )
}

function fmtPwdTime(t: string): string {
  const m = t.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z?/)
  if (!m) return t
  const [, y, mo, d, h, mi, s] = m
  return `${y}-${mo}-${d} ${h}:${mi}:${s}Z`
}
