import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

export function getTheme(): Theme {
  try {
    return (localStorage.getItem('theme') as Theme) || 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(t: Theme) {
  const el = document.documentElement
  el.classList.toggle('light', t === 'light')
  try {
    localStorage.setItem('theme', t)
  } catch {}
  // keep the mobile status-bar colour in sync with the surface
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', t === 'light' ? '#fbf7f3' : '#1f1611')
}

/** Theme state synced to <html class> + localStorage. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(getTheme)
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))
  return [theme, toggle]
}
