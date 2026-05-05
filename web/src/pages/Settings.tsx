// v0.10: Settings sayfası — admin SMTP, SMS, LDAPS ayarlarını UI'dan yönetir.
//
// Üç sekme:
//   - SMTP: host/port/user/pass/from/startTLS, "send test" butonu
//   - SMS: generic HTTP gateway (method/url/body/auth template), "send test" butonu
//   - LDAPS: cert/key PEM textarea upload + apply toggle
//
// Tüm credential'lar backend'de AES-GCM (key=JWTSecret derive) ile encrypted
// saklanır. UI'a hiçbir secret leak olmaz — password/auth alanları boş gelir,
// sadece "hasPassword: true" flag'iyle "kayıtlı" gösterilir.

import { FormEvent, useEffect, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import {
  api,
  ApiError,
  type LDAPSStatus,
  type SMSSettingsView,
  type SMTPSettingsView,
} from '../lib/api'

type Tab = 'smtp' | 'sms' | 'ldaps'

export function Settings() {
  const [tab, setTab] = useState<Tab>('smtp')
  return (
    <Layout>
      <PageHeader title="settings" subtitle="// integrations" />
      <PageBody>
        <div className="flex border-b border-ink-700 mb-6">
          <TabBtn active={tab === 'smtp'} onClick={() => setTab('smtp')}>SMTP</TabBtn>
          <TabBtn active={tab === 'sms'} onClick={() => setTab('sms')}>SMS</TabBtn>
          <TabBtn active={tab === 'ldaps'} onClick={() => setTab('ldaps')}>LDAPS</TabBtn>
        </div>

        {tab === 'smtp' && <SMTPTab />}
        {tab === 'sms' && <SMSTab />}
        {tab === 'ldaps' && <LDAPSTab />}
      </PageBody>
    </Layout>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-5 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors ${
        active ? 'text-amber border-b-2 border-amber -mb-px' : 'text-ink-500 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  )
}

// ---- SMTP ----

function SMTPTab() {
  const toast = useToast()
  const [view, setView] = useState<SMTPSettingsView | null>(null)
  const [busy, setBusy] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [form, setForm] = useState({
    enabled: false,
    host: '',
    port: 587,
    username: '',
    password: '',
    from: '',
    replyTo: '',
    startTLS: true,
  })
  const [clearPw, setClearPw] = useState(false)

  useEffect(() => {
    api.getSMTPSettings()
      .then((v) => {
        setView(v)
        setForm({
          enabled: v.enabled,
          host: v.host,
          port: v.port || 587,
          username: v.username,
          password: '',
          from: v.from,
          replyTo: v.replyTo || '',
          startTLS: v.startTLS,
        })
      })
      .catch((e) => toast.err((e as Error).message))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const v = await api.updateSMTPSettings({
        ...form,
        password: form.password || undefined,
        clearPassword: clearPw,
      })
      setView(v)
      setForm((f) => ({ ...f, password: '' }))
      setClearPw(false)
      toast.ok('SMTP settings saved')
    } catch (e2) {
      toast.err(e2 instanceof ApiError ? e2.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const sendTest = async () => {
    if (!testTo) return
    setTestBusy(true)
    try {
      await api.testSMTP(testTo)
      toast.ok(`test mail sent → ${testTo}`)
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'failed')
    } finally {
      setTestBusy(false)
    }
  }

  if (!view) return <div className="label-mono">// loading...</div>

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            className="accent-amber" />
          <span className="font-mono text-sm">enabled</span>
        </label>
        <span className="label-mono">
          {view.enabled ? '✓ active' : '— disabled, password reset email will not work'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Input label="host" mono required value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="smtp.example.com" />
        </div>
        <Input label="port" mono type="number" value={String(form.port)}
          onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 587 })} />
      </div>

      <Input label="username" mono value={form.username}
        onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="auth username (opsiyonel)" />

      <div>
        <Input label={`password ${view.hasPassword ? '(stored — boş bırakırsan değişmez)' : ''}`}
          mono type="password" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          disabled={clearPw} />
        {view.hasPassword && (
          <label className="flex items-center gap-2 mt-1.5 text-xs font-mono text-err cursor-pointer">
            <input type="checkbox" checked={clearPw} onChange={(e) => setClearPw(e.target.checked)}
              className="accent-err" />
            kayıtlı şifreyi sil
          </label>
        )}
      </div>

      <Input label="from" mono required value={form.from}
        onChange={(e) => setForm({ ...form, from: e.target.value })}
        placeholder='"MTL LDAP" <noreply@example.com>' />
      <Input label="reply-to (opsiyonel)" mono value={form.replyTo}
        onChange={(e) => setForm({ ...form, replyTo: e.target.value })} />

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.startTLS}
          onChange={(e) => setForm({ ...form, startTLS: e.target.checked })}
          className="accent-amber" />
        <span className="font-mono text-sm">use STARTTLS (port 587'de zorunlu, 465 implicit TLS için kapat)</span>
      </label>

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'saving...' : 'save'}
        </Button>
      </div>

      <div className="border border-ink-700 p-4 mt-6">
        <div className="label-mono mb-2">// send test mail</div>
        <div className="flex gap-2">
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)}
            placeholder="happy@example.com"
            className="flex-1 h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber" />
          <Button type="button" variant="secondary" onClick={sendTest} disabled={testBusy || !testTo}>
            {testBusy ? 'sending...' : 'send test'}
          </Button>
        </div>
        <div className="text-[11px] font-mono text-ink-500 mt-1.5">
          test, kayıtlı (yeni değil) ayarları kullanır — önce save et.
        </div>
      </div>
    </form>
  )
}

// ---- SMS ----

function SMSTab() {
  const toast = useToast()
  const [view, setView] = useState<SMSSettingsView | null>(null)
  const [busy, setBusy] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [form, setForm] = useState({
    enabled: false,
    method: 'POST',
    urlTemplate: '',
    bodyTemplate: '',
    contentType: 'application/json',
    authHeader: '',
    successSubstring: '',
    messageTemplate: 'MTL Password Reset code: {{otp}} (valid 10min)',
  })
  const [clearAuth, setClearAuth] = useState(false)

  useEffect(() => {
    api.getSMSSettings()
      .then((v) => {
        setView(v)
        setForm({
          enabled: v.enabled,
          method: v.method || 'POST',
          urlTemplate: v.urlTemplate,
          bodyTemplate: v.bodyTemplate || '',
          contentType: v.contentType || 'application/json',
          authHeader: '',
          successSubstring: v.successSubstring || '',
          messageTemplate: v.messageTemplate || 'MTL Password Reset code: {{otp}} (valid 10min)',
        })
      })
      .catch((e) => toast.err((e as Error).message))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const v = await api.updateSMSSettings({
        ...form,
        authHeader: form.authHeader || undefined,
        clearAuthHeader: clearAuth,
      })
      setView(v)
      setForm((f) => ({ ...f, authHeader: '' }))
      setClearAuth(false)
      toast.ok('SMS settings saved')
    } catch (e2) {
      toast.err(e2 instanceof ApiError ? e2.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const sendTest = async () => {
    if (!testPhone) return
    setTestBusy(true)
    try {
      await api.testSMS(testPhone)
      toast.ok(`test SMS sent → ${testPhone}`)
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'failed')
    } finally {
      setTestBusy(false)
    }
  }

  if (!view) return <div className="label-mono">// loading...</div>

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="accent-amber" />
        <span className="font-mono text-sm">enabled</span>
      </label>

      <div className="border border-amber/30 bg-amber/5 p-3 text-xs font-mono text-ink-100 leading-relaxed">
        Generic HTTP SMS gateway. Template syntax: <span className="text-amber">{'{{phone}}'}</span>,{' '}
        <span className="text-amber">{'{{message}}'}</span>,{' '}
        <span className="text-amber">{'{{otp}}'}</span>,{' '}
        <span className="text-amber">{'{{uid}}'}</span>. Hem URL'de hem body'de kullanılabilir.
        <br /><br />
        Örnek: Netgsm GET URL → <code className="text-amber">https://api.netgsm.com.tr/sms/send/get?usercode=X&password=Y&gsmno={'{{phone}}'}&message={'{{message}}'}&msgheader=BAS</code>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div>
          <div className="label-mono mb-1.5">method</div>
          <select value={form.method}
            onChange={(e) => setForm({ ...form, method: e.target.value })}
            className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber">
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </select>
        </div>
        <div className="col-span-3">
          <Input label="content-type" mono value={form.contentType}
            onChange={(e) => setForm({ ...form, contentType: e.target.value })} />
        </div>
      </div>

      <div>
        <div className="label-mono mb-1.5">URL template</div>
        <input value={form.urlTemplate}
          onChange={(e) => setForm({ ...form, urlTemplate: e.target.value })}
          required
          className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber" />
      </div>

      {form.method === 'POST' && (
        <div>
          <div className="label-mono mb-1.5">body template (opsiyonel)</div>
          <textarea value={form.bodyTemplate}
            onChange={(e) => setForm({ ...form, bodyTemplate: e.target.value })}
            rows={3}
            placeholder='{"to":"{{phone}}","text":"{{message}}"}'
            className="w-full bg-ink-950 border border-ink-700 px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber" />
        </div>
      )}

      <div>
        <div className="label-mono mb-1.5">message template (SMS body content)</div>
        <input value={form.messageTemplate}
          onChange={(e) => setForm({ ...form, messageTemplate: e.target.value })}
          className="w-full h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber" />
      </div>

      <div>
        <Input label={`auth header ${view.hasAuthHeader ? '(stored — boş bırakırsan değişmez)' : ''}`}
          mono type="password" value={form.authHeader}
          onChange={(e) => setForm({ ...form, authHeader: e.target.value })}
          placeholder='örn: "Authorization: Bearer xxx"'
          disabled={clearAuth} />
        {view.hasAuthHeader && (
          <label className="flex items-center gap-2 mt-1.5 text-xs font-mono text-err cursor-pointer">
            <input type="checkbox" checked={clearAuth} onChange={(e) => setClearAuth(e.target.checked)}
              className="accent-err" />
            kayıtlı auth header'ı sil
          </label>
        )}
      </div>

      <Input label="success substring (opsiyonel — response body bunu içermeli; boşsa HTTP 2xx yeterli)"
        mono value={form.successSubstring}
        onChange={(e) => setForm({ ...form, successSubstring: e.target.value })}
        placeholder='örn: "00 " (Netgsm)' />

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'saving...' : 'save'}
        </Button>
      </div>

      <div className="border border-ink-700 p-4 mt-6">
        <div className="label-mono mb-2">// send test SMS</div>
        <div className="flex gap-2">
          <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)}
            placeholder="+905551234567"
            className="flex-1 h-9 bg-ink-950 border border-ink-700 px-3 text-sm font-mono focus:outline-none focus:border-amber" />
          <Button type="button" variant="secondary" onClick={sendTest} disabled={testBusy || !testPhone}>
            {testBusy ? 'sending...' : 'send test'}
          </Button>
        </div>
        <div className="text-[11px] font-mono text-ink-500 mt-1.5">
          test gönderiminde {'{{otp}}'} = "123456", {'{{uid}}'} = "test" placeholder'larıyla.
        </div>
      </div>
    </form>
  )
}

// ---- LDAPS ----

function LDAPSTab() {
  const toast = useToast()
  const [status, setStatus] = useState<LDAPSStatus | null>(null)
  const [certPEM, setCertPEM] = useState('')
  const [keyPEM, setKeyPEM] = useState('')
  const [caPEM, setCaPEM] = useState('')
  const [applyConfig, setApplyConfig] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    try {
      setStatus(await api.getLDAPSStatus())
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!certPEM || !keyPEM) return
    setBusy(true)
    try {
      const s = await api.uploadLDAPSCert({ certPEM, keyPEM, caPEM: caPEM || undefined, applyConfig })
      setStatus(s)
      setCertPEM('')
      setKeyPEM('')
      setCaPEM('')
      toast.ok(applyConfig ? 'cert uploaded + applied to slapd' : 'cert uploaded (apply pending)')
    } catch (e2) {
      toast.err(e2 instanceof ApiError ? e2.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const fileRead = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const r = new FileReader()
    r.onload = () => setter(typeof r.result === 'string' ? r.result : '')
    r.readAsText(f)
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Status block */}
      <div className="border border-ink-700 p-4">
        <div className="label-mono mb-2">// current status</div>
        {!status || (!status.certPath && !status.enabled) ? (
          <div className="text-sm text-ink-500 font-mono">no certificate uploaded yet</div>
        ) : (
          <div className="space-y-1.5 text-xs font-mono">
            <Row label="enabled" value={status.enabled ? <span className="text-ok">✓ applied to slapd</span> : <span className="text-warn">— uploaded but not applied</span>} />
            <Row label="subject" value={status.certSubject || '—'} />
            <Row label="issuer" value={status.certIssuer || '—'} />
            <Row label="valid from" value={status.certNotBefore?.slice(0, 10) || '—'} />
            <Row label="valid until" value={
              status.certNotAfter ? (
                <ExpiryBadge until={status.certNotAfter} />
              ) : '—'
            } />
            <Row label="cert path" value={status.certPath || '—'} />
            <Row label="key path" value={status.keyPath || '—'} />
            {status.lastApplyError && (
              <Row label="last error" value={<span className="text-err">{status.lastApplyError}</span>} />
            )}
          </div>
        )}
      </div>

      <div className="border border-warn/30 bg-warn/5 p-4 text-xs font-mono leading-relaxed">
        <div className="label-mono mb-2 text-warn">// önemli</div>
        UI sadece <strong>cert dosyalarını</strong> yazar ve <strong>cn=config</strong>'a olcTLS* attribute'larını set eder.
        slapd'ın LDAPS port'unda dinlemesi için ayrıca sysconfig dosyası düzenlenmeli:
        <br /><br />
        <code className="text-amber">SLAPD_URLS="ldapi:/// ldap:/// ldaps:///"</code> <span className="text-ink-500">→ /etc/sysconfig/slapd</span>
        <br />
        Sonra <code className="text-amber">systemctl restart slapd</code>.
        <br /><br />
        Bu adım UI'dan yapılmıyor (sysconfig'e yazma + service restart yetkisi gerektirir).
      </div>

      {/* Upload form */}
      <form onSubmit={submit} className="space-y-4">
        <div className="label-mono">// upload new certificate</div>

        <PEMField label="server certificate (.crt / .pem)" value={certPEM} onChange={setCertPEM}
          onFile={fileRead(setCertPEM)} placeholder="-----BEGIN CERTIFICATE-----" />
        <PEMField label="private key (.key / .pem)" value={keyPEM} onChange={setKeyPEM}
          onFile={fileRead(setKeyPEM)} placeholder="-----BEGIN PRIVATE KEY-----" />
        <PEMField label="CA chain (opsiyonel)" value={caPEM} onChange={setCaPEM}
          onFile={fileRead(setCaPEM)} placeholder="-----BEGIN CERTIFICATE-----" />

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={applyConfig}
            onChange={(e) => setApplyConfig(e.target.checked)}
            className="accent-amber" />
          <span className="font-mono text-sm">apply to slapd cn=config (önerilir)</span>
        </label>

        <Button type="submit" variant="primary" disabled={busy || !certPEM || !keyPEM}>
          {busy ? 'uploading...' : 'upload'}
        </Button>
      </form>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="text-ink-500 w-24">{label}</div>
      <div className="text-ink-100 flex-1 break-all">{value}</div>
    </div>
  )
}

function ExpiryBadge({ until }: { until: string }) {
  const days = Math.floor((new Date(until).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  const cls = days < 0 ? 'text-err' : days < 30 ? 'text-warn' : 'text-ok'
  return (
    <span className={cls}>
      {until.slice(0, 10)} ({days < 0 ? `${-days} days expired` : `${days} days left`})
    </span>
  )
}

function PEMField({
  label, value, onChange, onFile, placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="label-mono">{label}</div>
        <label className="text-[11px] font-mono text-amber hover:underline cursor-pointer">
          <input type="file" accept=".crt,.pem,.key,.cer" onChange={onFile} className="hidden" />
          choose file
        </label>
      </div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        rows={4}
        className="w-full bg-ink-950 border border-ink-700 px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-amber" />
    </div>
  )
}
