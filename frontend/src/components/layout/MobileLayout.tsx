import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { MessageSquare, Cpu, Bot, BookOpen, Settings, Brain, Zap } from 'lucide-react'
import { useState } from 'react'
import { clsx } from 'clsx'
import ThemeToggle from '../ui/ThemeToggle'
import { LogoMark } from '../Logo'
import UserAvatar from '../ui/UserAvatar'
import { useAuth } from '../../store/auth'
import { DEV_FEATURES } from '../../lib/devFeatures'

const PRIMARY_TABS = [
  { to: '/chat',      icon: MessageSquare, label: 'Chat',      dev: false },
  { to: '/agents',    icon: Bot,           label: 'Agents',    dev: true },
  { to: '/memory',    icon: Brain,         label: 'Memory',    dev: false },
  { to: '/workflows', icon: Zap,           label: 'Workflows', dev: true },
  { to: '/settings',  icon: Settings,      label: 'Settings',  dev: false },
].filter(i => DEV_FEATURES || !i.dev)

export default function MobileLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <div className="flex flex-col bg-gray-950 light:bg-gray-50 transition-colors duration-300" 
         style={{ height: '100dvh' }}>
      {/* Header */}
      <header className="glass flex-shrink-0 flex items-center justify-between px-4 
                         border-b border-gray-700/50 light:border-gray-300/30
                         bg-gray-900/50 light:bg-white/50 backdrop-blur-xl"
              style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(env(safe-area-inset-top) + 52px)' }}>
        <div className="flex items-center gap-2.5 mt-auto pb-1 w-full justify-between">
          <div className="flex items-center gap-2">
            <LogoMark size={26} className="shrink-0" />
            <span className="font-bold text-gray-100 light:text-gray-950 text-sm tracking-wide">HexaLLM</span>
          </div>
          {user && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 light:text-gray-600">{user.username}</span>
              <ThemeToggle />
              <NavLink to="/settings">
                <UserAvatar user={user} size={28} className="shadow" />
              </NavLink>
            </div>
          )}
          {!user && (
            <ThemeToggle />
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto min-h-0">
        <Outlet />
      </main>

      {/* Bottom tab bar */}
      <nav className="glass flex-shrink-0 border-t border-gray-700/50 light:border-gray-300/30 
                      flex items-stretch bg-gray-900/50 light:bg-white/50 backdrop-blur-xl"
           style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {PRIMARY_TABS.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} className={({ isActive }) =>
            clsx('tab-link flex-1 text-gray-400 light:text-gray-600 hover:text-gray-200 light:hover:text-gray-900', 
                  isActive && 'active text-primary-400 light:text-primary-500')}>
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
