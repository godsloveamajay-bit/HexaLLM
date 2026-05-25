import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { MessageSquare, Cpu, Bot, BookOpen, Settings, Brain, Zap } from 'lucide-react'
import { useState } from 'react'
import { clsx } from 'clsx'
import { useAuth } from '../../store/auth'

const PRIMARY_TABS = [
  { to: '/chat',      icon: MessageSquare, label: 'Chat'      },
  { to: '/agents',    icon: Bot,           label: 'Agents'    },
  { to: '/memory',    icon: Brain,         label: 'Memory'    },
  { to: '/workflows', icon: Zap,           label: 'Workflows' },
  { to: '/settings',  icon: Settings,      label: 'Settings'  },
]

export default function MobileLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <div className="flex flex-col bg-gray-950" style={{ height: '100dvh' }}>
      {/* Header */}
      <header className="glass flex-shrink-0 flex items-center justify-between px-4 border-b border-gray-700/50"
              style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(env(safe-area-inset-top) + 52px)' }}>
        <div className="flex items-center gap-2.5 mt-auto pb-1 w-full justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-900/40">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white">
                <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"/>
              </svg>
            </div>
            <span className="font-bold text-gray-100 text-sm tracking-wide">NebulaX AI</span>
          </div>
          {user && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{user.username}</span>
              <NavLink to="/settings">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-600 to-primary-800
                                flex items-center justify-center text-xs font-bold text-white shadow">
                  {user.username?.[0]?.toUpperCase()}
                </div>
              </NavLink>
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto min-h-0">
        <Outlet />
      </main>

      {/* Bottom tab bar */}
      <nav className="glass flex-shrink-0 border-t border-gray-700/50 flex items-stretch"
           style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {PRIMARY_TABS.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} className={({ isActive }) =>
            clsx('tab-link flex-1', isActive && 'active')}>
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
