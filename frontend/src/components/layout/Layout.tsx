import { useState } from 'react'
import { Outlet, Link } from 'react-router-dom'
import Sidebar from './Sidebar'
import { Menu, Search, LogIn } from 'lucide-react'
import { useAuth } from '../../store/auth'
import { useAutoUpdate } from '../../hooks/useAutoUpdate'

export default function Layout() {
  const { user } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  useAutoUpdate()

  return (
    <div className="flex flex-col h-screen bg-gray-950 overflow-hidden">
      {/* Topbar */}
      <header className="fixed top-0 left-0 right-0 h-12 z-50 flex items-center justify-between px-4
                         glass border-b border-gray-700/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-gray-800/70 text-gray-400 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <Link to="/chat" className="flex items-center gap-2.5 select-none">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700
                            flex items-center justify-center shadow-lg shadow-primary-900/40">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white">
                <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"/>
              </svg>
            </div>
            <span className="font-bold text-gray-100 text-sm tracking-wide">NebulaX AI</span>
          </Link>
        </div>

        {user && (
          <div className="flex items-center gap-2">
            {/* Ctrl+K hint — click also opens palette */}
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
              className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-gray-800/60 border border-gray-700/50
                         text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors text-xs"
              title="Open command palette"
            >
              <Search className="w-3 h-3" />
              <span>Search</span>
              <kbd className="flex items-center gap-0.5 text-[10px] text-gray-600 ml-1">
                <span>⌘</span><span>K</span>
              </kbd>
            </button>

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
            <Link to="/login" className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg
                             text-gray-400 hover:text-gray-200 transition-colors text-sm">
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
            className="fixed inset-0 z-40 bg-black/60 lg:hidden backdrop-blur-sm"
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
