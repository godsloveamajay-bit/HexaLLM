import { useState } from 'react'
import { Outlet, Link } from 'react-router-dom'
import Sidebar from './Sidebar'
import { Sparkle, Menu } from 'lucide-react'
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
                         bg-gray-900 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Hamburger — visible only below lg */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <Link to="/chat" className="flex items-center gap-2.5 select-none">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700
                            flex items-center justify-center shadow-sm">
              <Sparkle className="w-4 h-4 text-white fill-white" />
            </div>
            <span className="font-bold text-gray-100 text-sm tracking-wide">NebulaX AI</span>
          </Link>
        </div>

        {user && (
          <div className="flex items-center gap-2.5">
            <span className="text-xs text-gray-500 hidden sm:block">{user.email}</span>
            <Link to="/settings">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-600 to-primary-800
                              flex items-center justify-center text-xs font-bold text-white">
                {user.username?.[0]?.toUpperCase()}
              </div>
            </Link>
          </div>
        )}
      </header>

      {/* Below topbar */}
      <div className="flex flex-1 pt-12 min-h-0">
        {/* Mobile overlay — tap outside to close sidebar */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
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
