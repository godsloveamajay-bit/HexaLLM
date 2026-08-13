import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, NavLink, Outlet } from 'react-router-dom'
import { FlaskConical, Braces, Server, Activity, LogOut, LogIn, TerminalSquare, FolderKanban } from 'lucide-react'
import { useAuth } from '../store/auth'
import { baseURL } from '../lib/api'
import { isDevSite } from './isDev'

const PlaygroundPage = lazy(() => import('./Playground'))
const LandingPage = lazy(() => import('./Landing'))
const ApiExplorerPage = lazy(() => import('./ApiExplorer'))
const LiveModelsPage = lazy(() => import('./LiveModels'))
const StatusPage = lazy(() => import('./Status'))
const WorkspacesPage = lazy(() => import('./Workspaces'))

const LoginPage = lazy(() => import('../pages/Login'))
const RegisterPage = lazy(() => import('../pages/Register'))
const OAuthCallbackPage = lazy(() => import('../pages/OAuthCallback'))

const NAV = [
  { to: '/playground', label: 'Playground', icon: FlaskConical },
  { to: '/workspaces', label: 'Workspaces', icon: FolderKanban },
  { to: '/api', label: 'API Explorer', icon: Braces },
  { to: '/models', label: 'Live Models', icon: Server },
  { to: '/status', label: 'Status', icon: Activity },
]

function Spinner() {
  return (
    <div className="flex items-center justify-center h-full min-h-[50vh]">
      <div className="w-5 h-5 border-2 border-[#4ade80] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function TopBar() {
  const { user, logout } = useAuth()
  const [healthy, setHealthy] = useState<boolean | null>(null)

  useEffect(() => {
    const check = () => {
      fetch(`${baseURL}/health`)
        .then((r) => r.json())
        .then((d) => setHealthy(d?.ollama === 'connected'))
        .catch(() => setHealthy(false))
    }
    check()
    const t = setInterval(check, 10000)
    return () => clearInterval(t)
  }, [])

  return (
    <header className="h-12 flex items-center gap-4 px-4 border-b" style={{ borderColor: '#30363d', background: '#010409' }}>
      <div className="flex items-center gap-2 select-none">
        <TerminalSquare size={18} style={{ color: '#4ade80' }} />
        <span className="font-mono font-bold tracking-tight" style={{ color: '#e6edf3' }}>
          HEXA<span style={{ color: '#4ade80' }}>DEV</span>
        </span>
        <span
          className="font-mono text-[10px] px-1.5 py-0.5 rounded border"
          style={{ color: '#fbbf24', borderColor: 'rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.08)' }}
        >
          DEV ENV
        </span>
      </div>

      <div className="hidden md:flex items-center gap-2 font-mono text-xs" style={{ color: '#8b949e' }}>
        <span>dev.hexallm.co.uk</span>
        <span>·</span>
        <span>vite dev server</span>
        <span>·</span>
        <span className="text-[11px]" style={{ color: '#6e7681' }}>the playground may be unstable — it's the dev frontier</span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-1.5 font-mono text-xs">
          <span
            className="w-2 h-2 rounded-full inline-block"
            style={{ background: healthy === null ? '#6e7681' : healthy ? '#4ade80' : '#f87171' }}
          />
          <span style={{ color: '#8b949e' }}>{healthy === null ? 'checking…' : healthy ? 'ollama online' : 'ollama down'}</span>
        </div>
        {user ? (
          <>
            <span className="font-mono text-xs max-w-[180px] truncate" style={{ color: '#8b949e' }}>
              {user.email || user.username}
            </span>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 font-mono text-xs px-2 py-1 rounded border transition-colors hover:bg-[#161b22]"
              style={{ color: '#8b949e', borderColor: '#30363d' }}
            >
              <LogOut size={12} /> exit
            </button>
          </>
        ) : (
          <NavLink
            to="/login"
            className="flex items-center gap-1.5 font-mono text-xs px-2 py-1 rounded border transition-colors hover:bg-[#161b22]"
            style={{ color: '#4ade80', borderColor: 'rgba(74,222,128,0.4)' }}
          >
            <LogIn size={12} /> sign in
          </NavLink>
        )}
      </div>
    </header>
  )
}

function Sidebar() {
  return (
    <aside
      className="w-52 flex flex-col border-r shrink-0 hidden md:flex"
      style={{ borderColor: '#30363d', background: '#010409' }}
    >
      <nav className="flex flex-col gap-1 p-3">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1 px-2" style={{ color: '#6e7681' }}>
          developer tools
        </div>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 font-mono text-[13px] px-2.5 py-2 rounded transition-colors ${
                isActive ? '' : 'hover:bg-[#161b22]'
              }`
            }
            style={({ isActive }) =>
              isActive
                ? { color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)' }
                : { color: '#8b949e', border: '1px solid transparent' }
            }
          >
            <Icon size={15} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto p-3 font-mono text-[10px] leading-relaxed" style={{ color: '#6e7681' }}>
        <div className="mb-1" style={{ color: '#8b949e' }}>
          ▲ This is the developer environment.
        </div>
        consumer chat, image gen and the rest live on the main site. here: raw
        model access, the API, and the guts.
      </div>
    </aside>
  )
}

function MobileNav() {
  return (
    <nav className="flex md:hidden gap-1 px-2 py-2 border-t" style={{ borderColor: '#30363d', background: '#010409' }}>
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className="flex-1 flex flex-col items-center gap-0.5 font-mono text-[10px] py-1.5 rounded"
          style={({ isActive }) =>
            isActive ? { color: '#4ade80', background: 'rgba(74,222,128,0.1)' } : { color: '#8b949e' }
          }
        >
          <Icon size={15} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

function Shell() {
  return (
    <div className="h-screen flex flex-col" style={{ background: '#0d1117' }}>
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <MobileNav />
    </div>
  )
}

export default function DevPortal() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
      <Route path="/" element={<Shell />}>
        <Route index element={<LandingPage />} />
        <Route path="playground" element={<PlaygroundPage />} />
        <Route path="workspaces" element={<WorkspacesPage />} />
        <Route path="api" element={<ApiExplorerPage />} />
        <Route path="models" element={<LiveModelsPage />} />
        <Route path="status" element={<StatusPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/playground" replace />} />
    </Routes>
  )
}

export { isDevSite }
