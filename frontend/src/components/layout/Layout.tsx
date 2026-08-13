import { useState } from 'react'
import { Outlet, Link } from 'react-router-dom'
import Sidebar from './Sidebar'
import ThemeToggle from '../ui/ThemeToggle'
import { Menu, Search } from 'lucide-react'
import { LogoMark } from '../Logo'
import UserAvatar from '../ui/UserAvatar'
import { useAuth } from '../../store/auth'
import { useAutoUpdate } from '../../hooks/useAutoUpdate'
import { clsx } from 'clsx'

export default function Layout() {
  const { user } = useAuth()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('hexa-sidebar') === '1')
  const [mobileOpen, setMobileOpen] = useState(false)
  useAutoUpdate()

  const toggleSidebar = () => {
    if (window.innerWidth < 1024) {
      setMobileOpen(true)
      return
    }
    setCollapsed((c) => {
      localStorage.setItem('hexa-sidebar', c ? '0' : '1')
      return !c
    })
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 overflow-hidden transition-colors duration-300
                    light:bg-gray-50">
      {/* Header — Gemini-style: hamburger + brand + actions */}
      <header className="h-14 flex-shrink-0 z-50 flex items-center gap-1 sm:gap-2 px-2 sm:px-3
                         border-b border-gray-800 light:border-gray-300/40 bg-gray-900/80 light:bg-white/80 backdrop-blur-xl">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg hover:bg-gray-800 light:hover:bg-gray-200/70 text-gray-400 light:text-gray-600 transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        <Link to="/chat" className="flex items-center gap-2.5 select-none px-1">
          <LogoMark size={26} className="shrink-0" />
          <span className="font-bold text-gray-100 light:text-gray-950 text-sm tracking-wide hidden sm:inline">
            HexaLLM <span className="text-primary-400">AI</span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {user && (
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
              className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-800/60 light:bg-gray-200/60
                         border border-gray-700/50 light:border-gray-300/50
                         text-gray-500 light:text-gray-600 hover:text-gray-300 light:hover:text-gray-900
                         hover:bg-gray-800 light:hover:bg-gray-300/70 transition-colors text-xs"
              title="Open command palette"
            >
              <Search className="w-3 h-3" />
              <span>Search</span>
              <kbd className="flex items-center gap-0.5 text-[10px] text-gray-600 light:text-gray-700 ml-1">
                <span>⌘</span><span>K</span>
              </kbd>
            </button>
          )}

          <ThemeToggle />

          {user ? (
            <Link to="/settings" aria-label="Settings">
              <UserAvatar
                user={user}
                size={32}
                className="shadow hover:shadow-primary-900/40 transition-shadow"
              />
            </Link>
          ) : (
            <Link to="/login" className="hidden sm:flex items-center px-3 py-1.5 rounded-lg text-sm font-medium
                               text-gray-300 light:text-gray-700 hover:bg-gray-800 light:hover:bg-gray-200/70 transition-colors">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0 relative">
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 light:bg-black/40 lg:hidden backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />

        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}