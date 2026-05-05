import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { ApiError, api, type SelfServiceConfig } from '../lib/api'

export function Login() {
  const { login, completeMFA } = useAuth()
  const nav = useNavigate()
  const [uid, setUid] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState<'creds' | 'mfa'>('creds')
  const [challenge, setChallenge] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [ssCfg, setSSCfg] = useState<SelfServiceConfig | null>(null)

  useEffect(() => {
    api.selfServiceConfig().then(setSSCfg).catch(() => setSSCfg({ methods: [], enabled: false }))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const res = await login(uid, password)
      if (res.kind === 'mfa') {
        setChallenge(res.challenge)
        setStage('mfa')
      } else {
        nav('/users')
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'giriş başarısız')
    } finally {
      setLoading(false)
    }
  }

  const submitMFA = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      if (useBackup) {
        await completeMFA(challenge, undefined, mfaCode)
      } else {
        await completeMFA(challenge, mfaCode)
      }
      nav('/users')
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'doğrulama başarısız')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-ink-950">
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, #fff 0, #fff 1px, transparent 1px, transparent 3px)',
        }}
      />

      <div className="w-full max-w-sm relative">
        <div className="mb-8">
          <div className="font-mono text-amber text-2xl font-medium tracking-tight">
            MTL LDAP Admin
          </div>
          <div className="label-mono mt-1">openldap console</div>
        </div>

        {stage === 'creds' ? (
          <form onSubmit={submit} className="panel p-6 space-y-4">
            <div className="label-mono">// authenticate</div>

            <Input
              label="user id"
              mono
              placeholder="happy"
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              autoFocus
              required
            />
            <Input
              label="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {err && (
              <div className="bg-err/10 border border-err/30 px-3 py-2 text-xs text-err font-mono">
                {err}
              </div>
            )}

            <Button type="submit" variant="primary" disabled={loading} className="w-full">
              {loading ? 'binding...' : 'sign in →'}
            </Button>

            {ssCfg?.enabled && (
              <div className="text-center pt-2 border-t border-ink-700">
                <Link
                  to="/forgot"
                  className="text-xs text-ink-500 hover:text-amber transition-colors font-mono"
                >
                  forgot password?
                </Link>
              </div>
            )}
          </form>
        ) : (
          <form onSubmit={submitMFA} className="panel p-6 space-y-4">
            <div>
              <div className="label-mono">// two-factor authentication</div>
              <div className="text-sm text-ink-300 mt-2">
                Enter the 6-digit code from your authenticator app.
              </div>
            </div>

            <Input
              label={useBackup ? 'backup code' : 'authenticator code'}
              mono
              placeholder={useBackup ? 'xxxx-xxxx-xxxx' : '123456'}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              autoFocus
              required
            />

            {err && (
              <div className="bg-err/10 border border-err/30 px-3 py-2 text-xs text-err font-mono">
                {err}
              </div>
            )}

            <Button type="submit" variant="primary" disabled={loading} className="w-full">
              {loading ? 'verifying...' : 'verify →'}
            </Button>

            <div className="flex justify-between text-xs font-mono pt-2 border-t border-ink-700">
              <button
                type="button"
                onClick={() => {
                  setUseBackup((v) => !v)
                  setMfaCode('')
                  setErr('')
                }}
                className="text-ink-500 hover:text-amber transition-colors"
              >
                {useBackup ? '← use authenticator app' : 'use backup code →'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStage('creds')
                  setMfaCode('')
                  setErr('')
                }}
                className="text-ink-500 hover:text-ink-100 transition-colors"
              >
                cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
