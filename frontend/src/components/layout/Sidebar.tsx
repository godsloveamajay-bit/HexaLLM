import { useEffect } from 'react'
import { NavLink, useNavigate, Link } from 'react-router-dom'
import {
  MessageSquare, Cpu, ImageIcon, Clapperboard, Brain, Wand2, LayoutDashboard,
  LogOut, Settings, Sun, Moon, MonitorSmartphone, LogIn, UserPlus,
  Pencil, ChevronDown, X, Cable,
} from 'lucide-react'
import { useAuth } from '../../store/auth'
import { useSessions } from '../../store/sessions'
import { useTheme } from '../../lib/theme'
import { DEV_FEATURES } from '../../lib/devFeatures'
import UserAvatar from '../ui/UserAvatar'
import { clsx } from 'clsx'
import { useState } from 'react'

interface Props {
  collapsed: boolean
  mobileOpen: boolean
  onCloseMobile: () => void
}

// Gemini-style recency buckets for the conversation list.
function groupOf(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.floor((start(today) - start(d)) / 86_400_000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return 'Previous 7 days'
  return 'Older'
}

const GROUP_ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Older']

const EXTRA_LINKS = [
  { to: '/models', icon: Cpu, label: 'Model Hub' },
  { to: '/image', icon: ImageIcon, label: 'Image Gen' },
  { to: '/video', icon: Clapperboard, label: 'Video Gen' },
  { to: '/memory', icon: Brain, label: 'Memory' },
  { to: '/train', icon: Wand2, label: 'Training' },
  { to: '/remote-cli', icon: Cable, label: 'Remote CLI' },
]

const ADMIN_LINK = { to: '/admin', icon: LayoutDashboard, label: 'Admin' }

export default function Sidebar({ collapsed, mobileOpen, onCloseMobile }: Props) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [theme, setTheme] = useTheme()
  const [showApps, setShowApps] = useState(false)
  const { sessions, activeId, loaded, fetch, setActive, remove } = useSessions()

  useEffect(() => {
    if (user && !loaded) fetch()
  }, [user, loaded, fetch])

  const nextTheme = theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark'
  const themeMeta = {
    dark: { icon: Sun, label: 'Light mode' },
    light: { icon: MonitorSmartphone, label: 'System theme' },
    auto: { icon: Moon, label: 'Dark mode' },
  }[theme]

  const openChat = (id: number) => {
    setActive(id)
    onCloseMobile()
    navigate('/chat')
  }
  const startNew = () => {
    onCloseMobile()
    navigate('/chat?new=1')
  }

  const groups = GROUP_ORDER
    .map((g) => ({ group: g, items: sessions.filter((s) => groupOf(s.updated_at) === g) }))
    .filter((g) => g.items.length > 0)

  const links = [...EXTRA_LINKS, ...(user?.is_admin ? [ADMIN_LINK] : [])]

  const themeButton = (
    <button
      onClick={() => setTheme(nextTheme)}
      className={clsx('sidebar-link w-full text-left', collapsed && !mobileOpen && 'justify-center px-0')}
      aria-label="Switch theme"
      title={`Theme: ${theme}`}
    >
      <themeMeta.icon className="w-4 h-4 flex-shrink-0" />
      {(!collapsed || mobileOpen) && themeMeta.label}
    </button>
  )

  // ── Collapsed icon rail (desktop) ───────────────────────────────────────
  if (collapsed && !mobileOpen) {
    return (
      <aside className="flex flex-col w-16 bg-gray-900/95 light:bg-white/90 border-r border-gray-800 light:border-gray-300/40
                        flex-shrink-0">
        <div className="p-2 space-y-1">
          <button onClick={startNew} title="Start new chat"
            className="w-full p-2.5 rounded-lg flex justify-center text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors">
            <Pencil className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
          {sessions.slice(0, 12).map((s) => (
            <button key={s.id} onClick={() => openChat(s.id)}
              title={s.title}
              className={clsx('w-full p-2.5 rounded-lg flex justify-center transition-colors',
                activeId === s.id ? 'bg-primary-900/40 text-primary-300' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800')}>
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
            </button>
          ))}
        </div>
        <div className="p-2 space-y-1 border-t border-gray-800 light:border-gray-300/40">
          {user && <NavLink to="/models" title="Model Hub"
            className={({ isActive }) => clsx('flex justify-center p-2.5 rounded-lg transition-colors', isActive ? 'bg-primary-900/40 text-primary-300' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800')}>
            <Cpu className="w-4 h-4" />
          </NavLink>}
          {themeButton}
          <NavLink to="/settings" title="Settings"
            className={({ isActive }) => clsx('flex justify-center p-2.5 rounded-lg transition-colors', isActive ? 'bg-primary-900/40 text-primary-300' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800')}>
            <Settings className="w-4 h-4" />
          </NavLink>
          {user ? (
            <button onClick={() => { logout(); navigate('/login') }} title="Logout"
              className="w-full flex justify-center p-2.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-900/10 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          ) : (
            <Link to="/login" title="Sign in"
              className="flex justify-center p-2.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors">
              <LogIn className="w-4 h-4" />
            </Link>
          )}
        </div>
      </aside>
    )
  }

  // ── Expanded sidebar (desktop / mobile drawer) ─────────────────────────
  return (
    <aside
      className={clsx(
        'flex flex-col w-64 bg-gray-900/95 light:bg-white/90 border-r border-gray-800 light:border-gray-300/40',
        'fixed top-14 bottom-0 left-0 z-50',
        'transition-transform duration-300 ease-in-out',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        'lg:static lg:top-auto lg:bottom-auto lg:z-auto lg:translate-x-0 lg:transition-none',
      )}
    >
      <button
        onClick={onCloseMobile}
        className="lg:hidden absolute top-2 right-2 p-1.5 rounded-lg hover:bg-gray-800 text-gray-500"
        aria-label="Close menu"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Recent header */}
      <div className="px-3 pt-3 pb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1">Recent</span>
        {user && (
          <button onClick={startNew} title="Start new chat"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors">
            <Pencil className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Conversation history */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1 space-y-3">
        {!user && (
          <div className="space-y-2 px-1 py-3">
            <Link to="/login" onClick={onCloseMobile} className="sidebar-link">
              <LogIn className="w-4 h-4" />Sign in
            </Link>
            <Link to="/register" onClick={onCloseMobile} className="btn-primary w-full justify-center py-2 mt-1 text-sm">
              <UserPlus className="w-4 h-4" />Create free account
            </Link>
          </div>
        )}
        {user && groups.map(({ group, items }) => (
          <div key={group}>
            <p className="px-2 pb-1 text-xs font-medium text-gray-500">{group}</p>
            <div className="space-y-0.5">
              {items.map((s) => (
                <div key={s.id} onClick={() => openChat(s.id)}
                  className={clsx('flex items-center gap-2 px-2 py-2 rounded-xl cursor-pointer group text-sm transition-colors',
                    activeId === s.id ? 'bg-primary-900/40 text-primary-300' : 'hover:bg-gray-800 text-gray-400')}>
                  <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{s.title}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); remove(s.id) }}
                    className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                    title="Delete chat"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {user && loaded && sessions.length === 0 && (
          <p className="px-2 py-3 text-xs text-gray-600 text-center">No chats yet — start one below.</p>
        )}
      </div>

      {/* Bottom: app links + theme + settings + profile */}
      <div className="px-2 py-2 border-t border-gray-800 light:border-gray-300/40 space-y-0.5">
        {user && (
          <button onClick={() => setShowApps((v) => !v)}
            className="sidebar-link w-full text-left">
            <ChevronDown className={clsx('w-4 h-4 transition-transform', showApps && 'rotate-180')} />
            Apps &amp; Tools
          </button>
        )}
        {showApps && user && (
          <div className="space-y-0.5 pb-1">
            {links.map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} onClick={onCloseMobile}
                className={({ isActive }) => clsx('sidebar-link', isActive && 'active')}>
                <Icon className="w-4 h-4" />{label}
              </NavLink>
            ))}
          </div>
        )}

        {themeButton}
        <NavLink to="/settings" onClick={onCloseMobile}
          className={({ isActive }) => clsx('sidebar-link', isActive && 'active')}>
          <Settings className="w-4 h-4" />Settings
        </NavLink>

        {user ? (
          <button onClick={() => { logout(); navigate('/login') }}
            className="sidebar-link w-full text-left text-red-400/80 hover:text-red-400 hover:bg-red-900/10">
            <LogOut className="w-4 h-4" />Logout
          </button>
        ) : (
          <Link to="/login" onClick={onCloseMobile} className="sidebar-link">
            <LogIn className="w-4 h-4" />Sign in
          </Link>
        )}

        {user && (
          <div className="mt-2 pt-2 border-t border-gray-800 light:border-gray-300/40 px-1 flex items-center gap-2">
            <UserAvatar user={user} size={28} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-200 light:text-gray-800 truncate">{user.username}</p>
              {user.is_admin && <p className="text-[10px] text-primary-500 font-medium">Admin</p>}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}