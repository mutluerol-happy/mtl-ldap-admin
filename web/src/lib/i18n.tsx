// Minimal i18n — external lib yerine in-house. Sebep: 700+ string ama format/plural
// gereksinimi yok; tek ihtiyaç dictionary lookup + {{var}} replace + persistence.
//
// Kullanım:
//   import { useT } from '../lib/i18n'
//   const t = useT()
//   <button>{t('user.delete')}</button>
//   toast.ok(t('user.created', { uid: 'happy' }))
//
// Dil değiştirme:
//   const { lang, setLang } = useI18n()
//   setLang('tr')
//
// Locale file'ları locales/en.ts ve locales/tr.ts. Aynı key tree, farklı value.
// Eksik key → key string'i olduğu gibi gösterilir (kırmızı renkli `[missing:foo.bar]`
// yerine sessiz fallback).

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { en } from '../locales/en'
import { tr } from '../locales/tr'

type Lang = 'en' | 'tr'
type Dict = typeof en // tüm key'ler en'de tanımlı; tr eksik bırakılırsa en fallback

const STORAGE_KEY = 'mtl-ldap-admin:lang'
const DICTS: Record<Lang, Dict> = { en, tr: tr as Dict }

type I18nCtx = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const Ctx = createContext<I18nCtx | null>(null)

function detectInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'tr' || saved === 'en') return saved
  } catch {
    /* localStorage yoksa fallback */
  }
  // Browser language hint
  if (typeof navigator !== 'undefined') {
    const nav = (navigator.language || '').toLowerCase()
    if (nav.startsWith('tr')) return 'tr'
  }
  return 'en'
}

function lookup(dict: any, key: string): string | undefined {
  const parts = key.split('.')
  let cur: any = dict
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  return typeof cur === 'string' ? cur : undefined
}

function expand(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : ''
  )
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectInitialLang())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      /* ignore */
    }
    // <html lang="..."> attribute güncelle — accessibility için faydalı
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang
    }
  }, [lang])

  const t = (key: string, vars?: Record<string, string | number>) => {
    const dict = DICTS[lang]
    let v = lookup(dict, key)
    if (v === undefined && lang !== 'en') {
      v = lookup(DICTS.en, key)
    }
    if (v === undefined) {
      // Production'da loud fail değil — key'i olduğu gibi geri ver.
      // Geliştirme sırasında konsol uyarısı:
      if (typeof console !== 'undefined') {
        console.warn('[i18n] missing key:', key)
      }
      return key
    }
    return expand(v, vars)
  }

  return <Ctx.Provider value={{ lang, setLang: setLangState, t }}>{children}</Ctx.Provider>
}

export function useI18n() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useI18n must be used inside I18nProvider')
  return c
}

export function useT() {
  return useI18n().t
}
