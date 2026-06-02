import { useEffect, useState } from 'react'

/** User-selectable preference. 'auto' follows the OS colour-scheme. */
export type Theme = 'dark' | 'light' | 'auto'
/** What actually gets painted. */
export type ResolvedTheme = 'dark' | 'light'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches
  } catch {
    return true
  }
}

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem('theme')
    if (t === 'light' || t === 'dark' || t === 'auto') return t
  } catch {}
  return 'dark'
}

/** Collapse a preference (incl. 'auto') down to dark|light for painting. */
export function resolveTheme(t: Theme): ResolvedTheme {
  if (t === 'auto') return systemPrefersDark() ? 'dark' : 'light'
  return t
}

export function applyTheme(t: Theme) {
  const resolved = resolveTheme(t)
  const el = document.documentElement
  el.classList.toggle('light', resolved === 'light')
  try {
    localStorage.setItem('theme', t)
  } catch {}
  // keep the mobile status-bar colour in sync with the surface
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#fbf7f3' : '#1f1611')
}

/**
 * Theme state synced to <html class> + localStorage.
 * Returns the stored preference, a setter, and the resolved (painted) theme.
 * While the preference is 'auto', live OS colour-scheme changes are followed.
 */
export function useTheme(): [Theme, (t: Theme) => void, ResolvedTheme] {
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getTheme()))

  useEffect(() => {
    applyTheme(theme)
    setResolved(resolveTheme(theme))
    if (theme !== 'auto') return
    // Follow the OS while in auto mode.
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = () => {
      applyTheme('auto')
      setResolved(resolveTheme('auto'))
    }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [theme])

  const setTheme = (t: Theme) => setThemeState(t)
  return [theme, setTheme, resolved]
}
