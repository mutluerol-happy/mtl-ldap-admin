// v0.9: Auto-refresh hook.
//
// Belirli bir aralıkla (varsayılan 10 sn) verilen fn'i çağırır. Sadece tarayıcı
// sekmesi VISIBLE olduğunda çalışır — arka plan tab'larında battery/CPU
// harcamaz. document.visibilitychange dinleyip aktif olduğunda hemen refresh,
// gizlendiğinde interval durdurur. Cleanup fonksiyonu component unmount'ta
// hem interval'ı hem listener'ı söker.
//
// Kullanım:
//   useAutoRefresh(load, 10_000)
//
// fn senkron veya async olabilir; await'lenmez (parallel callback'ler önceki
// henüz bitmemişken yeni interval kovalayabilir, ama mtl-ldap-admin'nin tüm endpoint'leri
// idempotent ve hızlı olduğu için sorun olmaz).
import { useEffect, useRef } from 'react'

export function useAutoRefresh(fn: () => void | Promise<void>, intervalMs = 10_000) {
  // fn'i ref'te tut — değişse bile interval'ı yeniden kurma. Aksi halde her
  // render'da yeni interval başlatırız ki en kötüsü bu.
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer !== null) return
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          fnRef.current()
        }
      }, intervalMs)
    }
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Tekrar görünür olunca hemen bir refresh tetikle (kullanıcı geri
        // dönünce stale veri görmesin), sonra normal interval'a devam.
        fnRef.current()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])
}
