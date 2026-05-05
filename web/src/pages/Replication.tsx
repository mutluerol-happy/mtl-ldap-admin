// v0.9: Replication sayfası (placeholder).
//
// Bu sayfa şu an sadece "henüz yapılandırılmadı" mesajı ve LDIF örnekleriyle
// kullanıcıya nasıl bir adım atması gerektiğini gösterir. Backend
// /api/replication/status'dan { configured: false, message: ... } döner.
//
// İkinci sunucu eklendiğinde:
//   1. cn=config'de syncrepl provider/consumer ayarlanır (LDIF aşağıda)
//   2. Backend gerçek state'i (cn=Monitor sayaçları + olcSyncrepl entry'leri)
//      okuyup providers/consumers array'lerini doldurur
//   3. Bu sayfa otomatik olarak gerçek tabloyu render eder; kod değişikliği yok.

import { useEffect, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { useToast } from '../components/ui/Toast'
import { api } from '../lib/api'

export function Replication() {
  const toast = useToast()
  const [status, setStatus] = useState<{
    configured: boolean
    message: string
    providers: unknown[]
    consumers: unknown[]
  } | null>(null)

  useEffect(() => {
    api
      .replicationStatus()
      .then(setStatus)
      .catch((e) => toast.err((e as Error).message))
  }, [])

  if (!status) {
    return (
      <Layout>
        <PageHeader title="replication" subtitle="// syncrepl status" />
        <PageBody>
          <div className="label-mono">// loading...</div>
        </PageBody>
      </Layout>
    )
  }

  if (!status.configured) {
    return (
      <Layout>
        <PageHeader title="replication" subtitle="// not configured" />
        <PageBody>
          <div className="space-y-6">
            <div className="border border-warn/30 bg-warn/5 p-4">
              <div className="label-mono text-warn mb-1.5">// not configured</div>
              <p className="text-sm text-ink-100 leading-relaxed">{status.message}</p>
            </div>

            <Section title="when the second server is ready">
              <ol className="text-sm text-ink-300 space-y-2 list-decimal list-inside leading-relaxed">
                <li>İkinci sunucuya da openldap-servers kur, aynı baseDN'e (dc=mtl,dc=com) sahip olsun.</li>
                <li>Provider (master) tarafında syncprov overlay'i aç ve consumer için bir replikasyon kullanıcısı oluştur.</li>
                <li>Consumer tarafında olcSyncrepl directive'i tanımla.</li>
                <li>İlk senkronizasyon tamamlanınca <code className="font-mono text-amber">/api/replication/status</code> gerçek state'i göstermeye başlar.</li>
              </ol>
            </Section>

            <Section title="provider — syncprov overlay (LDIF)">
              <Code>{`# Module yükle (zaten varsa skip):
dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: syncprov.la

# Overlay'i {2}mdb'ye bağla (index'i kendi sunucunda doğrula):
dn: olcOverlay=syncprov,olcDatabase={2}mdb,cn=config
changetype: add
objectClass: olcOverlayConfig
objectClass: olcSyncProvConfig
olcOverlay: syncprov
olcSpCheckpoint: 100 10
olcSpSessionLog: 200`}</Code>
            </Section>

            <Section title="consumer — syncrepl directive (LDIF)">
              <Code>{`dn: olcDatabase={2}mdb,cn=config
changetype: modify
add: olcSyncrepl
olcSyncrepl: rid=001
  provider=ldap://master.example.tld
  bindmethod=simple
  binddn="cn=replicator,dc=mtl,dc=com"
  credentials="GIZLI"
  searchbase="dc=mtl,dc=com"
  schemachecking=on
  type=refreshAndPersist
  retry="60 +"
  timeout=1
-
add: olcUpdateRef
olcUpdateRef: ldap://master.example.tld`}</Code>
            </Section>

            <Section title="firewall">
              <p className="text-sm text-ink-300">
                Consumer → Provider yönünde 389/TCP (veya 636 LDAPS) açık olmalı.
                İlk full sync büyük dizinlerde dakikalar sürebilir; sonra sadece
                delta gönderilir.
              </p>
            </Section>
          </div>
        </PageBody>
      </Layout>
    )
  }

  // configured: true — ileride buraya gerçek tablo gelecek
  return (
    <Layout>
      <PageHeader title="replication" subtitle="// active" />
      <PageBody>
        <div className="text-sm text-ink-300">
          Replication state will be rendered here. Providers: {status.providers.length},
          Consumers: {status.consumers.length}.
        </div>
      </PageBody>
    </Layout>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label-mono mb-2">// {title}</div>
      <div className="border border-ink-700 bg-ink-950/50 p-3">{children}</div>
    </div>
  )
}

function Code({ children }: { children: string }) {
  return (
    <pre className="text-[11px] font-mono text-ink-100 whitespace-pre-wrap leading-relaxed">
      {children}
    </pre>
  )
}
