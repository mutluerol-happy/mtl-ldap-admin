import { ReactNode } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useI18n, useT } from '../lib/i18n'

// GitHub Sponsors link — repo açılırken belirlenen sabit. Coffee tooltip'i
// i18n'den çekilir.
const SPONSOR_URL = 'https://github.com/sponsors/mutluerol-happy'

export function Layout({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth()
  const isAdmin = me?.role === 'admin'
  const conn = me?.connection
  const t = useT()

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <aside className="w-60 bg-ink-900 border-r border-ink-700 flex flex-col">
          {/* Brand */}
          <div className="px-5 py-5 border-b border-ink-700">
            <Link to="/" className="block">
              <div className="font-mono text-amber text-base font-medium tracking-tight">
                {t('app.name')}
              </div>
              <div className="label-mono mt-0.5">{t('login.subtitle')}</div>
            </Link>
          </div>

          {/* Connection indicator */}
          {conn && (
            <div className="px-5 py-3 border-b border-ink-700">
              <div className="label-mono mb-1">// connection</div>
              <div className="flex items-center gap-2">
                <span
                  className={`w-1.5 h-1.5 ${
                    conn.tls ? 'bg-ok' : 'bg-err'
                }`}
                aria-hidden
              />
              <span className="font-mono text-xs uppercase tracking-wider">
                {conn.type}
              </span>
            </div>
            {conn.warning && (
              <div className="text-[10px] text-warn mt-1.5 leading-tight">
                ⚠ {conn.warning}
              </div>
            )}
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          {isAdmin && (
            <NavSection label="Insights">
              <NavItem to="/dashboard">{t('nav.dashboard')}</NavItem>
              <NavItem to="/monitor">{t('nav.monitor')}</NavItem>
            </NavSection>
          )}

          <NavSection label={t('nav.directory')}>
            {isAdmin && <NavItem to="/users">{t('nav.users')}</NavItem>}
            {isAdmin && <NavItem to="/groups">{t('nav.groups')}</NavItem>}
            {isAdmin && <NavItem to="/schema">{t('nav.schema')}</NavItem>}
            {isAdmin && <NavItem to="/tree">{t('nav.tree')}</NavItem>}
          </NavSection>

          {isAdmin && (
            <NavSection label={t('nav.tools')}>
              <NavItem to="/import">{t('nav.importCSV')}</NavItem>
              <NavItem to="/templates">{t('nav.templates')}</NavItem>
              <NavItem to="/ldif">{t('nav.ldif')}</NavItem>
              <NavItem to="/webhooks">{t('nav.webhooks')}</NavItem>
              <NavItem to="/audit">{t('nav.audit')}</NavItem>
              <NavItem to="/replication">{t('nav.replication')}</NavItem>
              <NavItem to="/settings">{t('nav.settings')}</NavItem>
            </NavSection>
          )}

          <NavSection label={t('nav.account')}>
            <NavItem to="/me">{t('nav.profile')}</NavItem>
          </NavSection>
        </nav>

        {/* Footer */}
        <div className="border-t border-ink-700 p-4 space-y-2">
          <div>
            <div className="label-mono">// signed in as</div>
            <div className="font-mono text-sm text-ink-100 truncate">{me?.user.uid}</div>
            <div className="label-mono mt-0.5">
              {isAdmin ? <span className="text-amber">{t('common.admin')}</span> : t('common.user')}
            </div>
          </div>
          <button
            onClick={logout}
            className="text-xs text-ink-500 hover:text-ink-100 transition-colors font-mono"
          >
            ↪ {t('nav.logout')}
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 bg-ink-950">{children}</main>
      </div>
    </div>
  )
}

// TopBar global navigation bar — her sayfada üstte sabit. Sağda dil dropdown
// ve sponsor (kalp) butonu.
function TopBar() {
  const { lang, setLang } = useI18n()
  const t = useT()
  return (
    <div className="h-10 bg-ink-900 border-b border-ink-700 flex items-center justify-end px-4 gap-3">
      {/* Dil seçici — minimal SELECT, sağ üst */}
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as 'en' | 'tr')}
        aria-label={t('app.langSelector')}
        className="bg-ink-950 border border-ink-700 text-xs font-mono text-ink-100 px-2 py-1 focus:outline-none focus:border-amber"
      >
        <option value="en">EN</option>
        <option value="tr">TR</option>
      </select>

      {/* Sponsor / coffee — kalp emoji, hover tooltip */}
      <a
        href={SPONSOR_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={t('app.sponsor')}
        aria-label={t('app.sponsor')}
        className="text-base hover:scale-110 transition-transform"
      >
        ❤️
      </a>
    </div>
  )
}

function NavSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="label-mono px-2 py-1.5">{label}</div>
      {children}
    </div>
  )
}

function NavItem({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center px-2 py-1.5 text-sm transition-colors ${
          isActive
            ? 'bg-ink-800 text-ink-100 border-l-2 border-amber pl-1.5'
            : 'text-ink-300 hover:text-ink-100 hover:bg-ink-800/50'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="border-b border-ink-700 bg-ink-900/50">
      <div className="px-8 py-6 flex items-end justify-between gap-4">
        <div>
          <div className="label-mono mb-1">/ {title.toLowerCase()}</div>
          <h1 className="text-2xl font-light tracking-tight">{title}</h1>
          {subtitle && (
            <div className="text-xs text-ink-500 mt-1 font-mono">{subtitle}</div>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="p-8">{children}</div>
}
