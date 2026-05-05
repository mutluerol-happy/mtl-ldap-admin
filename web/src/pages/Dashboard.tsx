import { useEffect, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { useToast } from '../components/ui/Toast'
import { api, type DashboardStats, type ExternalAuditSnapshot } from '../lib/api'
import { useAutoRefresh } from '../lib/useAutoRefresh'

const RANGE_OPTIONS = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

export function Dashboard() {
  const toast = useToast()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [days, setDays] = useState(7)
  // v0.10: external audit counter (slapd accesslog)
  const [extSnap, setExtSnap] = useState<ExternalAuditSnapshot | null>(null)

  const load = async () => {
    try {
      const s = await api.stats(days)
      setStats(s)
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  const loadExt = async () => {
    try {
      setExtSnap(await api.externalAudit())
    } catch {
      /* sessiz: external opsiyonel */
    }
  }

  useEffect(() => {
    load()
    loadExt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days])

  // v0.9+v0.10: Auto-refresh — internal stats + external snapshot
  useAutoRefresh(async () => {
    try {
      const s = await api.stats(days)
      setStats(s)
    } catch {
      /* sessiz */
    }
    loadExt()
  }, 10_000)

  return (
    <Layout>
      <PageHeader
        title="Dashboard"
        subtitle={stats ? `${stats.totalEvents.toLocaleString()} events in last ${days}d` : 'loading...'}
        actions={
          <div className="flex gap-1">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={`px-3 py-1 text-xs font-mono border transition-colors ${
                  days === r.days
                    ? 'border-amber bg-amber/10 text-amber'
                    : 'border-ink-700 text-ink-300 hover:border-ink-500'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />
      <PageBody>
        {!stats ? (
          <div className="label-mono p-8">// loading stats...</div>
        ) : (
          <div className="space-y-4">
            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <Stat label="logins" value={stats.loginSuccess} accent="ok" />
              <Stat label="failed logins" value={stats.loginFailed} accent={stats.loginFailed > 0 ? 'err' : 'muted'} />
              <Stat label="users created" value={stats.userCreated} accent="muted" />
              <Stat label="users deleted" value={stats.userDeleted} accent="muted" />
              <Stat label="password resets" value={stats.passwordResets} accent="muted" />
              <Stat label="total events" value={stats.totalEvents} accent="muted" />
            </div>

            {/* v0.10: External audit (slapd accesslog) — non-mtl-ldap-admin ops */}
            <div className="panel p-3">
              <div className="flex items-center justify-between mb-2.5">
                <div className="label-mono">// external LDAP traffic (accesslog)</div>
                <span className="text-[10px] font-mono text-ink-500">
                  {extSnap?.available
                    ? `updated ${new Date(extSnap.updatedAt).toISOString().slice(11, 16)}Z`
                    : 'overlay not configured — see Audit → external'}
                </span>
              </div>
              {extSnap?.available ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat label="ext last 24h" value={countSource(extSnap, 'external', '24h')} accent="muted" />
                  <Stat label="ext last 1h" value={countSource(extSnap, 'external', '1h')} accent="muted" />
                  <Stat label="write ops" value={extSnap.writeOps} accent="muted" />
                  <Stat label="read ops" value={extSnap.readOps} accent="muted" />
                </div>
              ) : (
                <div className="text-xs font-mono text-ink-500 px-2 py-3 border border-ink-700 border-dashed">
                  {extSnap?.error || 'loading...'}
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="panel p-4">
              <div className="label-mono mb-3">// activity over time</div>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <AreaChart data={stats.timeline}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="date" stroke="#737373" tick={{ fontSize: 10, fontFamily: 'monospace' }} />
                    <YAxis stroke="#737373" tick={{ fontSize: 10, fontFamily: 'monospace' }} />
                    <Tooltip
                      contentStyle={{
                        background: '#0a0a0a',
                        border: '1px solid #262626',
                        fontFamily: 'monospace',
                        fontSize: 11,
                      }}
                      labelStyle={{ color: '#e8e6e3' }}
                    />
                    <Area type="monotone" dataKey="logins" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                    <Area type="monotone" dataKey="failures" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} />
                    <Area type="monotone" dataKey="mutations" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <Legend
                items={[
                  { color: '#10b981', label: 'logins' },
                  { color: '#ef4444', label: 'failures' },
                  { color: '#f59e0b', label: 'mutations' },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top actors */}
              <div className="panel p-4">
                <div className="label-mono mb-3">// most active users</div>
                {stats.topActors.length === 0 ? (
                  <div className="label-mono py-8 text-center">// no data</div>
                ) : (
                  <div style={{ width: '100%', height: 240 }}>
                    <ResponsiveContainer>
                      <BarChart data={stats.topActors} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                        <XAxis type="number" stroke="#737373" tick={{ fontSize: 10, fontFamily: 'monospace' }} />
                        <YAxis
                          dataKey="actor"
                          type="category"
                          stroke="#737373"
                          tick={{ fontSize: 11, fontFamily: 'monospace' }}
                          width={80}
                        />
                        <Tooltip
                          contentStyle={{
                            background: '#0a0a0a',
                            border: '1px solid #262626',
                            fontFamily: 'monospace',
                            fontSize: 11,
                          }}
                        />
                        <Bar dataKey="count" fill="#f59e0b" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Action breakdown */}
              <div className="panel p-4">
                <div className="label-mono mb-3">// action breakdown</div>
                {stats.actions.length === 0 ? (
                  <div className="label-mono py-8 text-center">// no data</div>
                ) : (
                  <div className="max-h-[240px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {stats.actions.map((a) => (
                          <tr key={a.action} className="border-b border-ink-700 last:border-0">
                            <td className="py-1.5 font-mono text-xs text-amber">{a.action}</td>
                            <td className="py-1.5 text-right">
                              <Bar2 value={a.count} max={stats.actions[0].count} />
                            </td>
                            <td className="py-1.5 pl-2 font-mono text-xs text-ink-300 w-12 text-right">
                              {a.count}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top failed IPs (brute-force radar) */}
              <div className="panel p-4">
                <div className="label-mono mb-3">// brute-force radar (failed logins by ip)</div>
                {stats.topFailedIPs.length === 0 ? (
                  <div className="text-sm text-ink-500 font-mono py-8 text-center">
                    // no failures — quiet skies ✨
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {stats.topFailedIPs.map((ip) => (
                        <tr key={ip.ip} className="border-b border-ink-700 last:border-0">
                          <td className="py-2 font-mono text-xs">{ip.ip}</td>
                          <td className="py-2 text-right font-mono text-xs text-err">
                            {ip.count} fail{ip.count > 1 ? 's' : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Recent failures */}
              <div className="panel p-4">
                <div className="label-mono mb-3">// recent failures</div>
                {stats.recentFailures.length === 0 ? (
                  <div className="text-sm text-ink-500 font-mono py-8 text-center">
                    // no recent failures
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {stats.recentFailures.map((f) => (
                      <div key={f.id} className="font-mono text-xs flex justify-between gap-2 border-b border-ink-700 pb-1">
                        <span className="text-ink-500">{fmtTime(f.timestamp)}</span>
                        <span className="text-amber truncate">{f.action}</span>
                        <span className="text-ink-300 truncate">{f.actor || '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
  value: number
  accent: 'ok' | 'err' | 'muted'
}) {
  const color =
    accent === 'ok' ? 'text-ok' : accent === 'err' ? 'text-err' : 'text-ink-100'
  return (
    <div className="panel p-4 border-l-2 border-l-ink-700">
      <div className="label-mono mb-1">{label}</div>
      <div className={`text-2xl font-light font-mono ${color}`}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function Bar2({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="w-full h-1.5 bg-ink-800">
      <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
    </div>
  )
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex gap-4 mt-2">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5">
          <span className="w-2 h-2" style={{ background: i.color }} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
            {i.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function fmtTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19)
}

// v0.10: External audit snapshot'ından source+window'a göre sayım.
// Dashboard counter'ları için. snapshot.last24h/last1h zaten total veriyor;
// burada source bazında ayrıştırıyoruz (recent listesinden).
function countSource(
  snap: ExternalAuditSnapshot,
  source: 'external' | 'mtl-ldap-admin',
  window: '24h' | '1h'
): number {
  const cutoff = window === '1h'
    ? Date.now() - 60 * 60 * 1000
    : Date.now() - 24 * 60 * 60 * 1000
  return snap.recent.filter((e) => {
    if (e.source !== source) return false
    return new Date(e.timestamp).getTime() >= cutoff
  }).length
}
