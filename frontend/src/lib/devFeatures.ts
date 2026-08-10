// Dev-variant features. Prod (ai.hexallm.co.uk) is built without
// VITE_DEV_FEATURES, so these routes/pages/nav items are excluded from the
// production bundle. Set VITE_DEV_FEATURES=1 in a dev build to include them.
export const DEV_FEATURES = import.meta.env.VITE_DEV_FEATURES === '1'

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
