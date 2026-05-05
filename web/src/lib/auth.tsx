import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { api, getToken, setToken, type Me } from './api'

type LoginResult =
  | { kind: 'ok' }
  | { kind: 'mfa'; challenge: string; uid: string }

type AuthState = {
  me: Me | null
  loading: boolean
  login: (uid: string, password: string) => Promise<LoginResult>
  completeMFA: (challenge: string, code?: string, backupCode?: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const AuthCtx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    if (!getToken()) {
      setMe(null)
      setLoading(false)
      return
    }
    try {
      const data = await api.me()
      setMe(data)
    } catch {
      setMe(null)
      setToken(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const login = async (uid: string, password: string): Promise<LoginResult> => {
    const res = await api.login(uid, password)
    if (res.mfaRequired && res.challenge) {
      return { kind: 'mfa', challenge: res.challenge, uid: res.uid || uid }
    }
    if (!res.token) throw new Error('beklenmedik yanıt')
    setToken(res.token)
    await refresh()
    return { kind: 'ok' }
  }

  const completeMFA = async (challenge: string, code?: string, backupCode?: string) => {
    const res = await api.mfaVerify(challenge, code, backupCode)
    if (!res.token) throw new Error('beklenmedik yanıt')
    setToken(res.token)
    await refresh()
  }

  const logout = () => {
    setToken(null)
    setMe(null)
    location.href = '/login'
  }

  return (
    <AuthCtx.Provider value={{ me, loading, login, completeMFA, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
