import { useEffect } from 'react'
import toast from 'react-hot-toast'

export function useAutoUpdate() {
  useEffect(() => {
    // Only runs inside the Tauri desktop app
    if (!(window as any).__TAURI__) return

    let cancelled = false
    ;(async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const { relaunch } = await import('@tauri-apps/plugin-process')

        const update = await check()
        if (cancelled || !update) return

        toast.loading(`Downloading update ${update.version}…`, { id: 'auto-update', duration: Infinity })

        await update.downloadAndInstall()
        if (cancelled) return

        toast.success('Update ready — restarting in 3 s', { id: 'auto-update', duration: 3000 })
        setTimeout(() => relaunch(), 3000)
      } catch {
        // Silently swallow — updater errors must not affect normal usage
      }
    })()

    return () => { cancelled = true }
  }, [])
}
