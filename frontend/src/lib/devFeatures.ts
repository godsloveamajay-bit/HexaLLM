// Dev-variant features. Prod (ai.hexallm.co.uk) is built without
// VITE_DEV_FEATURES, so these routes/pages/nav items are excluded from the
// production bundle. Set VITE_DEV_FEATURES=1 in a dev build to include them.
export const DEV_FEATURES = import.meta.env.VITE_DEV_FEATURES === '1'

// Where to land after sign-in. /dashboard is a dev-only admin page — it is
// excluded from the production bundle (ai.hexallm.co.uk), so admins fall back
// to /chat there. Navigating to a non-existent route renders a blank page.
export function postLoginPath(isAdmin: boolean): string {
  return DEV_FEATURES && isAdmin ? '/dashboard' : '/chat'
}

export const DEV_FEATURE_PAGES = [
  'agents',
  'tools',
  'personas',
  'workflows',
  'knowledge',
  'mcp',
  'remote-cli',
  'downloads',
  'analytics',
  'api-keys',
]
