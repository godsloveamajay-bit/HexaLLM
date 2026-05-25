import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { isTauri } from '../lib/platform'

export function useAutoUpdate() {
  useEffect(() => {
    if (!isTauri()) return

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
        // Silently ignore — updater errors must not disturb normal usage
      }
    })()

    return () => { cancelled = true }
  }, [])
}
