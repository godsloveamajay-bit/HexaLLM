import { useState } from 'react'
import { Outlet, Link } from 'react-router-dom'
import Sidebar from './Sidebar'
import ThemeToggle from '../ui/ThemeToggle'
import { Menu, Search, LogIn } from 'lucide-react'
import { useAuth } from '../../store/auth'
import { useAutoUpdate } from '../../hooks/useAutoUpdate'

export default function Layout() {
  const { user } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  useAutoUpdate()

  return (
    <div className="flex flex-col h-screen bg-gray-950 overflow-hidden transition-colors duration-300
                    light:bg-gray-50">
      {/* Topbar */}
      <header className="fixed top-0 left-0 right-0 h-12 z-50 flex items-center justify-between px-4
                         glass border-b border-gray-700/50 light:border-gray-300/30 flex-shrink-0
                         bg-gray-900/50 light:bg-white/50 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-gray-800/70 light:hover:bg-gray-200/70 
                       text-gray-400 light:text-gray-600 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <Link to="/chat" className="flex items-center gap-2.5 select-none">
            <div className="w-7 h-7 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5">
                <defs>
                  <linearGradient id="topbar-hex" x1="0.15" y1="0" x2="0.85" y2="1">
                    <stop offset="0%" stopColor="#4FF3FF"/>
                    <stop offset="50%" stopColor="#A78BFA"/>
                    <stop offset="100%" stopColor="#3B82F6"/>
                  </linearGradient>
                </defs>
                <path d="M12 2L20.66 7L20.66 17L12 22L3.34 17L3.34 7Z" fill="url(#topbar-hex)"/>
                <path d="M12 6.5L16.76 9.25L16.76 14.75L12 17.5L7.24 14.75L7.24 9.25Z" fill="rgb(var(--g-950))"/>
              </svg>
            </div>
            <span className="font-bold text-gray-100 light:text-gray-950 text-sm tracking-wide">HexaLLM AI</span>
          </Link>
        </div>

        {user && (
          <div className="flex items-center gap-2">
            {/* Ctrl+K hint — click also opens palette */}
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
              className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-gray-800/60 light:bg-gray-200/60
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

            <ThemeToggle />

            <Link to="/settings">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-600 to-primary-800
                              flex items-center justify-center text-xs font-bold text-white shadow
                              hover:shadow-primary-900/40 transition-shadow">
                {user.username?.[0]?.toUpperCase()}
              </div>
            </Link>
          </div>
        )}

        {!user && (
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link to="/login" className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg
                             text-gray-400 light:text-gray-600 hover:text-gray-200 light:hover:text-gray-900 
                             transition-colors text-sm">
              <LogIn className="w-3.5 h-3.5" />
              Sign in
            </Link>
            <Link to="/register" className="btn-primary py-1.5 px-3 text-sm">
              Create free account
            </Link>
          </div>
        )}
      </header>

      <div className="flex flex-1 pt-12 min-h-0">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 light:bg-black/40 lg:hidden backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <main className="flex-1 overflow-auto min-h-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
