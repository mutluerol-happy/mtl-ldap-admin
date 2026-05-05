import { useEffect, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { Empty } from '../components/ui/Empty'
import { useToast } from '../components/ui/Toast'
import { api, type AuditEntry, type ExternalAuditSnapshot } from '../lib/api'
import { useAutoRefresh } from '../lib/useAutoRefresh'

const ACTIONS = [
  'auth.login',
  'auth.login.fail',
  'auth.login.ratelimited',
  'password.change',
  'user.create',
  'user.update',
  'user.delete',
  'user.password.reset',
  'user.unlock',
  // v0.9
  'user.disable',
  'user.enable',
  'user.move',
  'entry.modify',
  'entry.objectClass',
  'group.create',
  'group.delete',
  'group.member.add',
  'group.member.remove',
  'ldif.export',
  'ldif.import',
]

const PAGE_SIZE = 50

export function Audit() {
  const toast = useToast()
  const [items, setItems] = useState<AuditEntry[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)

  // Filters
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [status, setStatus] = useState('')
  // v0.10: feed tab — "mtl-ldap-admin" (default, internal audit DB) | "external" (slapd accesslog)
  const [feed, setFeed] = useState<'internal' | 'external'>('internal')
  const [extSnap, setExtSnap] = useState<ExternalAuditSnapshot | null>(null)

  const load = async (overrideOffset = offset) => {
    try {
      const res = await api.listAudit({
        limit: PAGE_SIZE,
        offset: overrideOffset,
        actor: actor || undefined,
        action: action || undefined,
        status: status || undefined,
      })
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  useEffect(() => {
    load(0)
    setOffset(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, action, status])

  // v0.9: Auto-refresh sadece ilk sayfada (offset=0). Pagination varken
  // kullanıcı eski kayıtlara bakıyorsa altından çekmeyelim.
  useAutoRefresh(async () => {
    if (offset !== 0) return
    try {
      const res = await api.listAudit({
        limit: PAGE_SIZE,
        offset: 0,
        actor: actor || undefined,
        action: action || undefined,
        status: status || undefined,
      })
      setItems(res.items)
      setTotal(res.total)
    } catch {
      /* sessiz */
    }
  }, 10_000)

  const next = () => {
    if (offset + PAGE_SIZE >= total) return
    const o = offset + PAGE_SIZE
    setOffset(o)
    load(o)
  }
  const prev = () => {
    if (offset === 0) return
    const o = Math.max(0, offset - PAGE_SIZE)
    setOffset(o)
    load(o)
  }

  return (
    <Layout>
      <PageHeader
        title="Audit"
        subtitle={
          feed === 'internal'
            ? items ? `${total} entries · sqlite` : 'loading...'
            : extSnap?.available
              ? `${extSnap.last24h} ops in last 24h · slapd accesslog`
              : 'slapd accesslog not available'
        }
        actions={
          feed === 'internal' ? (
            <div className="text-xs font-mono text-ink-500">
              {total > 0 &&
                `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`}
            </div>
          ) : null
        }
      />
      <PageBody>
        <div className="flex border-b border-ink-700 mb-4">
          <FeedTab active={feed === 'internal'} onClick={() => setFeed('internal')}>
            internal audit
          </FeedTab>
          <FeedTab active={feed === 'external'} onClick={() => {
            setFeed('external')
            api.externalAudit().then(setExtSnap).catch((e) => toast.err((e as Error).message))
          }}>
            external (slapd accesslog)
          </FeedTab>
        </div>

        {feed === 'external' ? (
          <ExternalFeed snap={extSnap} onRefresh={() => api.externalAudit().then(setExtSnap)} />
        ) : (
          <></>
        )}
        {feed === 'internal' && (
        <>
        {/* Filter bar */}
        <div className="panel p-3 mb-4 flex flex-wrap gap-3 items-end">
          <FilterField label="actor uid">
            <input
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="any"
              className="h-8 w-40 bg-ink-950 border border-ink-700 px-2 text-sm font-mono focus:outline-none focus:border-amber"
            />
          </FilterField>
          <FilterField label="action">
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="h-8 w-56 bg-ink-950 border border-ink-700 px-2 text-sm font-mono focus:outline-none focus:border-amber"
            >
              <option value="">any</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-8 w-32 bg-ink-950 border border-ink-700 px-2 text-sm font-mono focus:outline-none focus:border-amber"
            >
              <option value="">any</option>
              <option value="ok">ok</option>
              <option value="fail">fail</option>
            </select>
          </FilterField>
          {(actor || action || status) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setActor('')
                setAction('')
                setStatus('')
              }}
            >
              clear
            </Button>
          )}
        </div>

        {items === null ? (
          <div className="label-mono p-8">// loading audit log...</div>
        ) : items.length === 0 ? (
          <Empty title="No audit entries" hint="Try clearing the filters." />
        ) : (
          <>
            <div className="panel overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-700">
                    <Th>time</Th>
                    <Th>actor</Th>
                    <Th>action</Th>
                    <Th>target</Th>
                    <Th>ip</Th>
                    <Th>status</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <tr
                      key={e.id}
                      className="row-hover border-b border-ink-700 last:border-0 align-top"
                    >
                      <Td className="font-mono text-xs text-ink-300 whitespace-nowrap">
                        {fmtTime(e.timestamp)}
                      </Td>
                      <Td className="font-mono text-amber">{e.actor || '—'}</Td>
                      <Td className="font-mono text-xs">{e.action}</Td>
                      <Td className="font-mono text-xs text-ink-300 break-all max-w-xs">
                        {e.target || '—'}
                      </Td>
                      <Td className="font-mono text-xs text-ink-500">{e.ip || '—'}</Td>
                      <Td>
                        <StatusPill status={e.status} />
                        {e.details && (
                          <div className="text-xs text-ink-500 font-mono mt-0.5">
                            {e.details}
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex justify-between items-center mt-4">
              <Button size="sm" variant="ghost" onClick={prev} disabled={offset === 0}>
                ← previous
              </Button>
              <div className="label-mono">
                page {Math.floor(offset / PAGE_SIZE) + 1} of{' '}
                {Math.max(1, Math.ceil(total / PAGE_SIZE))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={next}
                disabled={offset + PAGE_SIZE >= total}
              >
                next →
              </Button>
            </div>
          </>
        )}
        </>
        )}
      </PageBody>
    </Layout>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="label-mono text-left px-4 py-2.5">{children}</th>
}
function Td({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <td className={`px-4 py-2.5 ${className}`}>{children}</td>
}
function FilterField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="label-mono mb-1">{label}</div>
      {children}
    </div>
  )
}
function StatusPill({ status }: { status: string }) {
  const ok = status === 'ok'
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
        ok ? 'text-ok bg-ok/10 border border-ok/30' : 'text-err bg-err/10 border border-err/30'
      }`}
    >
      {status}
    </span>
  )
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z'
}

// v0.10: Feed tab başlığı (audit DB / external accesslog arasında geçiş)
function FeedTab({
  active, onClick, children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-xs font-mono uppercase tracking-wider transition-colors ${
        active ? 'text-amber border-b-2 border-amber -mb-px' : 'text-ink-500 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  )
}

// v0.10: slapd accesslog'undan derive edilen event listesi.
// Internal audit'ten farkları:
//   - retention slapd tarafında, biz sadece okur ve gösteririz
//   - filter (actor/action/status) yok — sadece kaynak (mtl-ldap-admin/external) ayrımı
//   - 5 dakikada bir backend tarafında refresh edilir (snap.updatedAt)
function ExternalFeed({
  snap, onRefresh,
}: {
  snap: ExternalAuditSnapshot | null
  onRefresh: () => void
}) {
  const [filter, setFilter] = useState<'all' | 'external' | 'mtl-ldap-admin'>('external')

  if (!snap) {
    return <div className="label-mono">// loading external audit...</div>
  }

  if (!snap.available) {
    return (
      <div className="border border-warn/30 bg-warn/5 p-4 space-y-3">
        <div className="label-mono text-warn">// external audit not available</div>
        <div className="text-sm text-ink-100 leading-relaxed">
          {snap.error || 'cn=accesslog erişilemiyor'}
        </div>
        <div className="text-xs font-mono text-ink-300 leading-relaxed">
          Setup için <code className="text-amber">accesslog</code> overlay'i kur:
          <pre className="mt-2 bg-ink-950 border border-ink-700 p-2 overflow-x-auto whitespace-pre">{`# /tmp/accesslog.ldif
dn: olcDatabase=mdb,cn=config
objectClass: olcDatabaseConfig
objectClass: olcMdbConfig
olcDatabase: mdb
olcDbDirectory: /var/lib/ldap/accesslog
olcSuffix: cn=accesslog
olcAccess: {0}to dn.subtree="cn=accesslog"
  by dn.exact="cn=admin,dc=mtl,dc=com" read by * none
olcLimits: dn.exact="cn=admin,dc=mtl,dc=com" size.soft=unlimited size.hard=unlimited
olcDbMaxsize: 1073741824

dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: accesslog.la

dn: olcOverlay=accesslog,olcDatabase={2}mdb,cn=config
objectClass: olcOverlayConfig
objectClass: olcAccessLogConfig
olcOverlay: accesslog
olcAccessLogDB: cn=accesslog
olcAccessLogOps: writes reads
olcAccessLogSuccess: TRUE
olcAccessLogPurge: 30+00:00 01+00:00`}</pre>
          <code className="text-amber mt-2 block">
            mkdir -p /var/lib/ldap/accesslog && chown ldap:ldap /var/lib/ldap/accesslog
          </code>
          <code className="text-amber mt-1 block">
            ldapadd -Y EXTERNAL -H ldapi:/// -f /tmp/accesslog.ldif
          </code>
        </div>
      </div>
    )
  }

  const filtered = snap.recent.filter((e) => {
    if (filter === 'all') return true
    return e.source === filter
  })

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <CounterBox label="last 24h" value={snap.last24h} />
        <CounterBox label="last 1h" value={snap.last1h} />
        <CounterBox label="write ops" value={snap.writeOps} />
        <CounterBox label="read ops" value={snap.readOps} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['external', 'mtl-ldap-admin', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border ${
                filter === f
                  ? 'text-amber border-amber bg-amber/10'
                  : 'text-ink-500 border-ink-700 hover:text-ink-100'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="label-mono">
            updated {fmtTime(snap.updatedAt)}
          </span>
          <Button size="sm" variant="ghost" onClick={onRefresh}>refresh</Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty title="no events match filter" />
      ) : (
        <div className="panel">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-700">
              <tr>
                <Th>time</Th>
                <Th>op</Th>
                <Th>source</Th>
                <Th>authz</Th>
                <Th>target</Th>
                <Th>result</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={i} className="border-b border-ink-700 last:border-0 row-hover">
                  <Td className="text-xs font-mono text-ink-500 whitespace-nowrap">
                    {fmtTime(e.timestamp)}
                  </Td>
                  <Td>
                    <span className="font-mono text-amber text-xs uppercase">{e.op}</span>
                  </Td>
                  <Td>
                    <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 border ${
                      e.source === 'external'
                        ? 'text-warn bg-warn/10 border-warn/30'
                        : 'text-ink-500 bg-ink-800 border-ink-700'
                    }`}>
                      {e.source}
                    </span>
                  </Td>
                  <Td className="font-mono text-xs text-ink-300 break-all max-w-xs">
                    {(e.reqAuthz || '').replace(/^dn:/, '')}
                  </Td>
                  <Td className="font-mono text-xs text-ink-300 break-all max-w-xs">
                    {e.reqDN || '—'}
                  </Td>
                  <Td>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 border ${
                      e.result === '0' || e.result === ''
                        ? 'text-ok bg-ok/10 border-ok/30'
                        : 'text-err bg-err/10 border-err/30'
                    }`}>
                      {e.result || '0'}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CounterBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border border-ink-700 px-3 py-2.5">
      <div className="label-mono">{label}</div>
      <div className="text-2xl font-light font-mono text-amber">{value}</div>
    </div>
  )
}
