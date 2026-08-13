export function isDevSite(): boolean {
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h.startsWith('dev.')
}

export const DEV_ACCENT = {
  bg: '#0d1117',
  panel: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#8b949e',
  green: '#4ade80',
  amber: '#fbbf24',
  red: '#f87171',
  cyan: '#4FF3FF',
}
