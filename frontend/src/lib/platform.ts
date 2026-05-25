declare global {
  interface Window {
    Capacitor?: { isNativePlatform(): boolean; getPlatform(): string }
  }
}

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const isCapacitor = (): boolean =>
  typeof window !== 'undefined' &&
  'Capacitor' in window &&
  (window.Capacitor?.isNativePlatform() ?? false)

export const isNative = (): boolean => isTauri() || isCapacitor()

export const getPlatform = (): 'tauri' | 'capacitor' | 'web' => {
  if (isTauri()) return 'tauri'
  if (isCapacitor()) return 'capacitor'
  return 'web'
}
