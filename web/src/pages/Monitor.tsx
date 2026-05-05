import { useEffect, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'
import { api, type MonitorInfo } from '../lib/api'

export function Monitor() {
  const toast = useToast()
  const [info, setInfo] = useState<MonitorInfo | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const load = async () => {
    try {
      const i = await api.monitor()
      setInfo(i)
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [autoRefresh])

  return (
    <Layout>
      <PageHeader
        title="Monitor"
        subtitle="cn=Monitor — replication & runtime"
        actions={
          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-1.5 text-xs font-mono cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="accent-amber"
              />
              <span className="text-ink-300">auto 5s</span>
            </label>
            <Button onClick={load}>refresh</Button>
          </div>
        }
      />
      <PageBody>
        {!info ? (
          <div className="label-mono p-8">// loading...</div>
        ) : !info.available ? (
          <div className="panel p-6">
            <div className="label-mono mb-2">// not available</div>
            <p className="text-sm text-ink-300">{info.error || 'cn=Monitor okunamadı.'}</p>
            <p className="text-xs text-ink-500 font-mono mt-3">
              OpenLDAP'ta back-monitor overlay'inin yüklü olması gerekir. Bitnami imajı bunu
              varsayılan olarak yapar; manuel kurulumlarda <code>moduleload back_monitor</code>
              ve <code>database monitor</code> direktifleri eklenmelidir.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Top stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="active conns" value={info.currentConnections} />
              <Stat label="total conns" value={info.totalConnections} />
              <Stat
                label="threads active"
                value={info.threads ? `${info.threads.active}/${info.threads.max}` : '—'}
              />
              <Stat
                label="threads pending"
                value={info.threads?.pending ?? 0}
                accent={info.threads && info.threads.pending > 0 ? 'warn' : 'muted'}
              />
            </div>

            {/* Operations + Statistics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <KVPanel title="operations (completed)" data={info.operations} />
              <KVPanel title="statistics" data={info.statistics} />
            </div>

            {/* contextCSN */}
            {info.contextCSN && (
              <div className="panel p-4">
                <div className="label-mono mb-2">// contextCSN (head of replication log)</div>
                <code className="font-mono text-xs text-amber break-all">{info.contextCSN}</code>
              </div>
            )}

            {/* Replication */}
            <div className="panel p-4">
              <div className="label-mono mb-3">// replication</div>
              {!info.replication || info.replication.length === 0 ? (
                <div className="text-sm text-ink-500 font-mono">
                  // no replicas configured (single-master deployment)
                </div>
              ) : (
                <div className="space-y-3">
                  {info.replication.map((r) => (
                    <div key={r.dn} className="border border-ink-700 p-3">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="font-mono text-xs text-amber break-all">{r.dn}</div>
                        {r.state && (
                          <span className="text-[10px] font-mono uppercase tracking-wider text-ok bg-ok/10 border border-ok/30 px-1.5 py-0.5">
                            {r.state}
                          </span>
                        )}
                      </div>
                      {r.uri && (
                        <div className="text-xs font-mono text-ink-300 mb-1">→ {r.uri}</div>
                      )}
                      {r.description && (
                        <div className="text-xs text-ink-500 mb-1">{r.description}</div>
                      )}
                      {r.lastCSN && (
                        <div className="text-xs font-mono text-ink-300 mt-2">
                          <span className="label-mono inline mr-2">last csn:</span>
                          <span className="break-all">{r.lastCSN}</span>
                        </div>
                      )}
                      {r.raw && r.raw.length > 0 && (
                        <details className="mt-2">
                          <summary className="label-mono cursor-pointer hover:text-amber">
                            raw monitorInfo ({r.raw.length})
                          </summary>
                          <pre className="bg-ink-950 border border-ink-700 p-2 mt-1 text-[10px] text-ink-300 overflow-auto">
                            {r.raw.join('\n')}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </PageBody>
    </Layout>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: 'ok' | 'warn' | 'muted'
}) {
  const color =
    accent === 'ok' ? 'text-ok' : accent === 'warn' ? 'text-warn' : 'text-ink-100'
  return (
    <div className="panel p-4">
      <div className="label-mono mb-1">{label}</div>
      <div className={`text-2xl font-light font-mono ${color}`}>{value}</div>
    </div>
  )
}

function KVPanel({
  title,
  data,
}: {
  title: string
  data?: Record<string, number>
}) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1])
  return (
    <div className="panel p-4">
      <div className="label-mono mb-3">// {title}</div>
      {entries.length === 0 ? (
        <div className="text-sm text-ink-500 font-mono">// no data</div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k} className="border-b border-ink-700 last:border-0">
                <td className="py-1.5 font-mono text-xs text-amber">{k}</td>
                <td className="py-1.5 text-right font-mono text-xs text-ink-300">
                  {v.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
