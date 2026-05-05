import { InputHTMLAttributes, forwardRef } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  hint?: string
  error?: string
  mono?: boolean
}

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, hint, error, mono, className = '', ...rest }, ref) => (
    <label className="block">
      {label && <div className="label-mono mb-1.5">{label}</div>}
      <input
        ref={ref}
        className={`w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-amber transition-colors ${
          mono ? 'font-mono' : ''
        } ${error ? 'border-err' : ''} ${className}`}
        {...rest}
      />
      {hint && !error && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
      {error && <div className="mt-1 text-xs text-err">{error}</div>}
    </label>
  )
)
Input.displayName = 'Input'
