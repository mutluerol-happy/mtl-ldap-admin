import { createContext, useContext, useState, ReactNode, useCallback } from 'react'

type Toast = { id: number; kind: 'ok' | 'err' | 'info'; message: string }
type ToastCtx = {
  show: (kind: Toast['kind'], message: string) => void
  ok: (m: string) => void
  err: (m: string) => void
  info: (m: string) => void
}

const Ctx = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  const value: ToastCtx = {
    show,
    ok: (m) => show('ok', m),
    err: (m) => show('err', m),
    info: (m) => show('info', m),
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`panel px-4 py-3 text-sm font-mono border-l-2 toast-enter ${
              t.kind === 'ok'
                ? 'border-l-ok'
                : t.kind === 'err'
                ? 'border-l-err'
                : 'border-l-amber'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
