import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { api, ApiError, type SecurityQuestion, type SelfServiceConfig } from '../lib/api'

type Method = 'email' | 'sms' | 'questions'

export function Forgot() {
  const [cfg, setCfg] = useState<SelfServiceConfig | null>(null)
  const [uid, setUid] = useState('')
  const [method, setMethod] = useState<Method | ''>('')
  const [stage, setStage] = useState<'pick' | 'sent' | 'questions'>('pick')
  const [questions, setQuestions] = useState<SecurityQuestion[]>([])
  const [answers, setAnswers] = useState<string[]>([])
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .selfServiceConfig()
      .then(setCfg)
      .catch(() => setCfg({ methods: [], enabled: false }))
  }, [])

  // Picks first available method by default
  useEffect(() => {
    if (cfg && cfg.methods.length > 0 && !method) {
      setMethod(cfg.methods[0])
    }
  }, [cfg])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (method === 'email' || method === 'sms') {
        const r = await api.requestReset(uid, method)
        setInfo(r.message)
        setStage('sent')
      } else if (method === 'questions') {
        const r = await api.getPublicQuestions(uid)
        if (r.items.length === 0) {
          setErr('Bu kullanıcı için kayıtlı güvenlik sorusu yok.')
          return
        }
        setQuestions(r.items)
        setAnswers(new Array(r.items.length).fill(''))
        setStage('questions')
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'işlem başarısız')
    } finally {
      setBusy(false)
    }
  }

  const submitQuestions = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (newPw !== newPw2) {
      setErr('parolalar eşleşmiyor')
      return
    }
    if (newPw.length < 8) {
      setErr('parola en az 8 karakter olmalı')
      return
    }
    setBusy(true)
    try {
      await api.verifyQuestions(uid, answers, newPw)
      setInfo('Parolanız başarıyla değiştirildi. Şimdi giriş yapabilirsiniz.')
      setStage('sent')
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'doğrulama başarısız')
    } finally {
      setBusy(false)
    }
  }

  if (!cfg) return null

  if (!cfg.enabled) {
    return (
      <Centered>
        <div className="panel p-6 max-w-sm w-full">
          <div className="label-mono mb-2">// not enabled</div>
          <p className="text-sm text-ink-300">
            Self-service password reset is not enabled on this server. Contact your
            administrator.
          </p>
          <Link
            to="/login"
            className="mt-4 inline-block text-xs text-ink-500 hover:text-amber font-mono"
          >
            ← back to login
          </Link>
        </div>
      </Centered>
    )
  }

  return (
    <Centered>
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="font-mono text-amber text-2xl font-medium tracking-tight">
            MTL Password Reset
          </div>
          <div className="label-mono mt-1">// account recovery</div>
        </div>

        {stage === 'pick' && (
          <form onSubmit={submit} className="panel p-6 space-y-4">
            <Input
              label="user id"
              mono
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              autoFocus
              required
            />

            <div>
              <div className="label-mono mb-1.5">recovery method</div>
              <div className="space-y-1.5">
                {cfg.methods.map((m) => (
                  <label
                    key={m}
                    className={`flex items-center gap-2 px-3 py-2 border cursor-pointer transition-colors ${
                      method === m
                        ? 'border-amber bg-amber/10'
                        : 'border-ink-700 hover:border-ink-500'
                    }`}
                  >
                    <input
                      type="radio"
                      name="method"
                      checked={method === m}
                      onChange={() => setMethod(m)}
                      className="accent-amber"
                    />
                    <span className="font-mono text-sm">
                      {m === 'email' && 'email — receive a reset link'}
                      {m === 'sms' && 'sms — receive a reset link'}
                      {m === 'questions' && 'security questions'}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {err && (
              <div className="bg-err/10 border border-err/30 px-3 py-2 text-xs text-err font-mono">
                {err}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              disabled={busy || !uid || !method}
              className="w-full"
            >
              {busy ? 'submitting...' : 'continue →'}
            </Button>

            <div className="text-center pt-2 border-t border-ink-700">
              <Link
                to="/login"
                className="text-xs text-ink-500 hover:text-amber font-mono"
              >
                ← back to login
              </Link>
            </div>
          </form>
        )}

        {stage === 'questions' && (
          <form onSubmit={submitQuestions} className="panel p-6 space-y-4">
            <div className="label-mono">// answer your security questions</div>

            {questions.map((q, i) => (
              <Input
                key={q.index}
                label={q.question}
                value={answers[i]}
                onChange={(e) =>
                  setAnswers((a) => {
                    const next = [...a]
                    next[i] = e.target.value
                    return next
                  })
                }
                required
              />
            ))}

            <div className="border-t border-ink-700 pt-4 space-y-3">
              <Input
                label="new password"
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                hint="minimum 8 characters"
                required
              />
              <Input
                label="confirm new password"
                type="password"
                value={newPw2}
                onChange={(e) => setNewPw2(e.target.value)}
                required
              />
            </div>

            {err && (
              <div className="bg-err/10 border border-err/30 px-3 py-2 text-xs text-err font-mono">
                {err}
              </div>
            )}

            <Button type="submit" variant="primary" disabled={busy} className="w-full">
              {busy ? 'verifying...' : 'reset password'}
            </Button>
          </form>
        )}

        {stage === 'sent' && (
          <div className="panel p-6 space-y-4">
            <div className="label-mono">// done</div>
            <p className="text-sm text-ink-100">{info}</p>
            <Link
              to="/login"
              className="block text-center text-xs text-ink-500 hover:text-amber font-mono pt-2 border-t border-ink-700"
            >
              ← back to login
            </Link>
          </div>
        )}
      </div>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-ink-950">
      {children}
    </div>
  )
}
