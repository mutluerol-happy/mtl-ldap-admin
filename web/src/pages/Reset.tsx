import { FormEvent, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { api, ApiError } from '../lib/api'

export function Reset() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) setErr('Geçersiz reset linki — token yok')
  }, [token])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (pw !== pw2) {
      setErr('parolalar eşleşmiyor')
      return
    }
    if (pw.length < 8) {
      setErr('parola en az 8 karakter olmalı')
      return
    }
    setBusy(true)
    try {
      await api.resetWithToken(token, pw)
      setDone(true)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'işlem başarısız')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-ink-950">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="font-mono text-amber text-2xl font-medium tracking-tight">
            MTL Password Reset
          </div>
          <div className="label-mono mt-1">// set new password</div>
        </div>

        {done ? (
          <div className="panel p-6 space-y-4">
            <div className="label-mono">// success</div>
            <p className="text-sm text-ink-100">
              Parolanız değiştirildi. Şimdi giriş yapabilirsiniz.
            </p>
            <Link
              to="/login"
              className="block text-center text-xs text-amber font-mono pt-2 border-t border-ink-700"
            >
              go to login →
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="panel p-6 space-y-4">
            <Input
              label="new password"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              hint="minimum 8 characters"
              autoFocus
              required
            />
            <Input
              label="confirm"
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              required
            />

            {err && (
              <div className="bg-err/10 border border-err/30 px-3 py-2 text-xs text-err font-mono">
                {err}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              disabled={busy || !token}
              className="w-full"
            >
              {busy ? 'updating...' : 'set password'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
