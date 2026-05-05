import { useRef, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'
import { api, getToken } from '../lib/api'

export function Ldif() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<{
    added: number
    failed: number
    errors?: string[]
  } | null>(null)
  const [busy, setBusy] = useState(false)

  const onExport = () => {
    // /api/ldif/export Authorization header gerektiriyor; window.open kullanamayız.
    // Fetch + blob + programmatic download.
    const token = getToken()
    fetch(api.exportLDIFUrl(), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error('export failed')
        const filename =
          res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ||
          'ldap-export.ldif'
        return res.blob().then((blob) => ({ blob, filename }))
      })
      .then(({ blob, filename }) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        toast.ok('export downloaded')
      })
      .catch((e) => toast.err(e.message))
  }

  const onImport = async (file: File) => {
    setBusy(true)
    setResult(null)
    try {
      const res = await api.importLDIF(file)
      setResult(res)
      if (res.failed === 0) {
        toast.ok(`imported ${res.added} entries`)
      } else {
        toast.err(`${res.failed} of ${res.added + res.failed} entries failed`)
      }
    } catch (e) {
      toast.err((e as Error).message)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Layout>
      <PageHeader
        title="LDIF"
        subtitle="bulk import and export · admin only"
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Export */}
          <div className="panel p-6">
            <div className="label-mono mb-2">// export</div>
            <h2 className="text-lg font-light mb-1">Download directory snapshot</h2>
            <p className="text-sm text-ink-300 mb-4">
              Dumps every entry under your configured BaseDN as a standards-compliant
              LDIF file. Binary and non-ASCII values are base64-encoded automatically.
            </p>
            <div className="bg-ink-950 border border-ink-700 px-3 py-2 font-mono text-xs text-ink-500 mb-4">
              # filename: ldap-export-YYYY-MM-DD-HHMMSS.ldif
            </div>
            <Button variant="primary" onClick={onExport}>
              download .ldif →
            </Button>
          </div>

          {/* Import */}
          <div className="panel p-6">
            <div className="label-mono mb-2">// import</div>
            <h2 className="text-lg font-light mb-1">Bulk add from LDIF file</h2>
            <p className="text-sm text-ink-300 mb-4">
              Adds new entries from a LDIF file. Existing entries are not modified —
              <code className="text-amber px-1">changetype</code> blocks are skipped in
              this version. Max upload size: 25 MB.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".ldif,.txt,text/plain"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onImport(f)
              }}
              disabled={busy}
              className="block text-sm text-ink-300 font-mono file:mr-3 file:py-2 file:px-4 file:border-0 file:bg-amber file:text-ink-950 file:font-medium hover:file:bg-amber/90 file:cursor-pointer"
            />
            {busy && <div className="label-mono mt-3">// importing...</div>}
          </div>
        </div>

        {result && (
          <div className="panel p-6 mt-4">
            <div className="label-mono mb-2">// result</div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <Stat label="added" value={result.added} accent="ok" />
              <Stat
                label="failed"
                value={result.failed}
                accent={result.failed > 0 ? 'err' : 'muted'}
              />
            </div>
            {result.errors && result.errors.length > 0 && (
              <div>
                <div className="label-mono mb-2">errors</div>
                <pre className="bg-ink-950 border border-ink-700 p-3 text-xs font-mono text-err max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {result.errors.join('\n')}
                </pre>
              </div>
            )}
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
    accent === 'ok' ? 'text-ok' : accent === 'err' ? 'text-err' : 'text-ink-500'
  return (
    <div className="border-l-2 border-ink-700 pl-4">
      <div className="label-mono">{label}</div>
      <div className={`text-3xl font-light font-mono ${color}`}>{value}</div>
    </div>
  )
}
