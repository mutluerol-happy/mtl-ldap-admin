import { useEffect, useRef, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'
import { api, type BulkSummary, type Group } from '../lib/api'
import { parseCSV, type CSVRow } from '../lib/csv'

// LDAP user fields we map CSV columns into
type Field = 'uid' | 'firstName' | 'lastName' | 'email' | 'password'

const REQUIRED_FIELDS: Field[] = ['uid', 'firstName', 'lastName']
const ALL_FIELDS: { key: Field; label: string; required: boolean }[] = [
  { key: 'uid', label: 'uid', required: true },
  { key: 'firstName', label: 'first name', required: true },
  { key: 'lastName', label: 'last name', required: true },
  { key: 'email', label: 'email', required: false },
  { key: 'password', label: 'password', required: false },
]

type Mapping = Record<Field, string | null>

// Heuristik: aynı isim / benzer ismi otomatik eşleştir.
const HINTS: Record<Field, string[]> = {
  uid: ['uid', 'username', 'login', 'user'],
  firstName: ['firstname', 'first_name', 'givenname', 'given_name', 'first', 'name'],
  lastName: ['lastname', 'last_name', 'surname', 'sn', 'family', 'last'],
  email: ['email', 'mail', 'e-mail', 'e_mail'],
  password: ['password', 'passwd', 'pass'],
}

function autoMap(headers: string[]): Mapping {
  const lower = headers.map((h) => h.toLowerCase().replace(/[\s_-]/g, ''))
  const out: Mapping = {
    uid: null, firstName: null, lastName: null, email: null, password: null,
  }
  for (const f of ALL_FIELDS) {
    const candidates = HINTS[f.key].map((h) => h.replace(/[\s_-]/g, ''))
    const idx = lower.findIndex((h) => candidates.includes(h))
    if (idx >= 0) out[f.key] = headers[idx]
  }
  return out
}

export function Import() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<CSVRow[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [mapping, setMapping] = useState<Mapping | null>(null)

  const [groups, setGroups] = useState<Group[]>([])
  const [groupsToAddTo, setGroupsToAddTo] = useState<string[]>([])

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BulkSummary | null>(null)

  useEffect(() => {
    api.listGroups().then((r) => setGroups(r.items)).catch(() => {})
  }, [])

  const onFile = (file: File) => {
    setResult(null)
    file.text().then((text) => {
      const parsed = parseCSV(text)
      setHeaders(parsed.headers)
      setRows(parsed.rows)
      setWarnings(parsed.warnings)
      setMapping(autoMap(parsed.headers))
    })
  }

  const reset = () => {
    setHeaders([])
    setRows([])
    setWarnings([])
    setMapping(null)
    setResult(null)
    setGroupsToAddTo([])
    if (fileRef.current) fileRef.current.value = ''
  }

  const validation = (() => {
    if (!mapping) return { ok: false, errors: [] as string[] }
    const errors: string[] = []
    for (const f of REQUIRED_FIELDS) {
      if (!mapping[f]) errors.push(`required field "${f}" not mapped`)
    }
    return { ok: errors.length === 0, errors }
  })()

  const previewUsers = (() => {
    if (!mapping) return []
    return rows.map((r) => ({
      uid: mapping.uid ? r[mapping.uid] : '',
      firstName: mapping.firstName ? r[mapping.firstName] : '',
      lastName: mapping.lastName ? r[mapping.lastName] : '',
      email: mapping.email ? r[mapping.email] || '' : '',
      password: mapping.password ? r[mapping.password] || '' : '',
    }))
  })()

  const submit = async () => {
    if (!validation.ok) return
    setBusy(true)
    try {
      const summary = await api.bulkCreateUsers(previewUsers, groupsToAddTo)
      setResult(summary)
      if (summary.failed === 0) {
        toast.ok(`imported ${summary.ok} users`)
      } else {
        toast.err(`${summary.failed} of ${summary.ok + summary.failed} failed`)
      }
    } catch (e) {
      toast.err((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout>
      <PageHeader
        title="CSV Import"
        subtitle={
          rows.length > 0
            ? `${rows.length} rows · ${headers.length} columns`
            : 'bulk-create users from a CSV file'
        }
        actions={
          rows.length > 0 && (
            <Button variant="ghost" onClick={reset}>
              start over
            </Button>
          )
        }
      />
      <PageBody>
        {rows.length === 0 ? (
          <UploadStep fileRef={fileRef} onFile={onFile} />
        ) : result ? (
          <ResultStep result={result} onReset={reset} />
        ) : (
          <>
            {/* Column mapping */}
            <div className="panel p-6 mb-4">
              <div className="label-mono mb-3">// step 1 — map columns</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ALL_FIELDS.map((f) => (
                  <div key={f.key}>
                    <div className="label-mono mb-1">
                      {f.label} {f.required && <span className="text-amber">*</span>}
                    </div>
                    <select
                      value={mapping?.[f.key] || ''}
                      onChange={(e) =>
                        setMapping((m) => (m ? { ...m, [f.key]: e.target.value || null } : m))
                      }
                      className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber"
                    >
                      <option value="">— skip —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {validation.errors.length > 0 && (
                <div className="mt-3 bg-err/10 border border-err/30 px-3 py-2 text-xs text-err font-mono">
                  {validation.errors.join(' · ')}
                </div>
              )}
            </div>

            {/* Groups */}
            <div className="panel p-6 mb-4">
              <div className="label-mono mb-3">// step 2 — add to groups (optional)</div>
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => {
                  const selected = groupsToAddTo.includes(g.cn)
                  return (
                    <button
                      key={g.cn}
                      onClick={() =>
                        setGroupsToAddTo((s) =>
                          s.includes(g.cn) ? s.filter((x) => x !== g.cn) : [...s, g.cn]
                        )
                      }
                      className={`px-3 py-1.5 text-xs font-mono border transition-colors ${
                        selected
                          ? 'bg-amber/10 text-amber border-amber'
                          : 'bg-ink-950 text-ink-300 border-ink-700 hover:border-ink-500'
                      }`}
                    >
                      {selected && '✓ '}
                      {g.cn}
                    </button>
                  )
                })}
                {groups.length === 0 && (
                  <div className="text-xs text-ink-500 font-mono">// no groups yet</div>
                )}
              </div>
            </div>

            {/* Preview */}
            <div className="panel p-6 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="label-mono">
                  // step 3 — preview ({previewUsers.length} users)
                </div>
                {warnings.length > 0 && (
                  <div className="text-xs text-warn font-mono">
                    ⚠ {warnings.length} warning{warnings.length > 1 ? 's' : ''}
                  </div>
                )}
              </div>
              <div className="border border-ink-700 max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-ink-900">
                    <tr className="border-b border-ink-700">
                      <Th>uid</Th>
                      <Th>name</Th>
                      <Th>email</Th>
                      <Th>password</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewUsers.slice(0, 100).map((u, i) => (
                      <tr key={i} className="border-b border-ink-700 last:border-0">
                        <Td className="font-mono text-amber">{u.uid || <Missing />}</Td>
                        <Td className="font-mono text-xs">
                          {u.firstName || <Missing />} {u.lastName || <Missing />}
                        </Td>
                        <Td className="font-mono text-xs text-ink-300">{u.email || '—'}</Td>
                        <Td className="font-mono text-xs text-ink-500">
                          {u.password ? '••••••••' : <span className="text-warn">none</span>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previewUsers.length > 100 && (
                <div className="label-mono mt-2">
                  // showing first 100 of {previewUsers.length}
                </div>
              )}
            </div>

            {/* Action */}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset}>
                cancel
              </Button>
              <Button
                variant="primary"
                onClick={submit}
                disabled={!validation.ok || busy}
              >
                {busy ? 'importing...' : `import ${previewUsers.length} users →`}
              </Button>
            </div>
          </>
        )}
      </PageBody>
    </Layout>
  )
}

function UploadStep({
  fileRef,
  onFile,
}: {
  fileRef: React.RefObject<HTMLInputElement>
  onFile: (f: File) => void
}) {
  return (
    <div className="panel p-12">
      <div className="max-w-xl mx-auto text-center">
        <div className="label-mono mb-3">// upload</div>
        <h2 className="text-lg font-light mb-2">Pick a CSV file to import</h2>
        <p className="text-sm text-ink-300 mb-6">
          The first row should be column headers. Required columns:{' '}
          <code className="text-amber">uid</code>, <code className="text-amber">firstName</code>{' '}
          (or similar), <code className="text-amber">lastName</code>. You'll map columns in the
          next step.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
          }}
          className="block mx-auto text-sm text-ink-300 font-mono file:mr-3 file:py-2 file:px-4 file:border-0 file:bg-amber file:text-ink-950 file:font-medium hover:file:bg-amber/90 file:cursor-pointer"
        />
        <div className="mt-8 pt-6 border-t border-ink-700">
          <div className="label-mono mb-2">// example</div>
          <pre className="bg-ink-950 border border-ink-700 px-3 py-2 text-xs font-mono text-ink-300 text-left overflow-x-auto">
{`uid,first_name,last_name,email,password
jane,Jane,Smith,jane@example.org,
bob,Bob,Jones,bob@example.org,initpass123`}
          </pre>
        </div>
      </div>
    </div>
  )
}

function ResultStep({ result, onReset }: { result: BulkSummary; onReset: () => void }) {
  return (
    <div>
      <div className="panel p-6 mb-4">
        <div className="label-mono mb-2">// result</div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Stat label="created" value={result.ok} accent="ok" />
          <Stat
            label="failed"
            value={result.failed}
            accent={result.failed > 0 ? 'err' : 'muted'}
          />
        </div>
        {result.failed > 0 && (
          <div>
            <div className="label-mono mb-2">errors</div>
            <div className="border border-ink-700 max-h-64 overflow-y-auto">
              {result.results
                .filter((r) => r.status === 'failed')
                .map((r, i) => (
                  <div
                    key={i}
                    className="flex justify-between gap-3 px-3 py-2 border-b border-ink-700 last:border-0 text-xs font-mono"
                  >
                    <span className="text-amber">{r.uid}</span>
                    <span className="text-err">{r.error}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onReset}>
          import another file
        </Button>
      </div>
    </div>
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
function Missing() {
  return <span className="text-err">missing</span>
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
    accent === 'ok' ? 'text-ok' : accent === 'err' ? 'text-err' : 'text-ink-500'
  return (
    <div className="border-l-2 border-ink-700 pl-4">
      <div className="label-mono">{label}</div>
      <div className={`text-3xl font-light font-mono ${color}`}>{value}</div>
    </div>
  )
}
