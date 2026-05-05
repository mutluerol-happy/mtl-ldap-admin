import { ReactNode } from 'react'

export function Empty({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="panel py-16 px-6 text-center">
      <div className="label-mono mb-2">// nothing here</div>
      <div className="text-ink-300 text-sm">{title}</div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
