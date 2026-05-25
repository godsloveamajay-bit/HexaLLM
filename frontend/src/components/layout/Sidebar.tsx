import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, MessageSquare, Bot, Cpu, Wand2,
  BarChart3, FileText, Key, LogOut, Settings, BookOpen, X, ImageIcon,
  Brain, Zap, Server, Users,
} from 'lucide-react'
import { useAuth } from '../../store/auth'
import { clsx } from 'clsx'

interface Props {
  isOpen: boolean
  onClose: () => void
}

const BASE_NAV = [
  { to: '/chat',      icon: MessageSquare, label: 'Chat'       },
  { to: '/image',     icon: ImageIcon,     label: 'Image Gen'  },
  { to: '/agents',    icon: Bot,           label: 'Agents'     },
  { to: '/personas',  icon: Users,         label: 'Personas'   },
  { to: '/workflows', icon: Zap,           label: 'Workflows'  },
  { to: '/memory',    icon: Brain,         label: 'Memory'     },
  { to: '/mcp',       icon: Server,        label: 'MCP Servers'},
  { to: '/models',    icon: Cpu,           label: 'Model Hub'  },
  { to: '/knowledge', icon: BookOpen,      label: 'Knowledge'  },
  { to: '/train',     icon: Wand2,         label: 'Training'   },
  { to: '/analytics', icon: BarChart3,     label: 'Analytics'  },
  { to: '/api-keys',  icon: Key,           label: 'API Keys'   },
]

const ADMIN_EXTRA = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/logs',      icon: FileText,         label: 'Logs'      },
]

export default function Sidebar({ isOpen, onClose }: Props) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const navItems = user?.is_admin ? [...BASE_NAV, ...ADMIN_EXTRA] : BASE_NAV

  return (
    <aside
      className={clsx(
        'flex flex-col w-52 bg-gray-900/95 border-r border-gray-700/50 px-2 py-3',
        'fixed top-12 bottom-0 left-0 z-50',
        'transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full',
        'lg:static lg:translate-x-0 lg:top-auto lg:bottom-auto lg:z-auto lg:transition-none',
      )}
    >
      <button
        onClick={onClose}
        className="lg:hidden absolute top-2 right-2 p-1.5 rounded-lg hover:bg-gray-800 text-gray-500"
        aria-label="Close menu"
      >
        <X className="w-4 h-4" />
      </button>

      <nav className="flex-1 space-y-0.5 mt-6 lg:mt-0 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            className={({ isActive }) => clsx('sidebar-link', isActive && 'active')}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-3 pt-3 border-t border-gray-700/50 space-y-0.5">
        <NavLink
          to="/settings"
          onClick={onClose}
          className={({ isActive }) => clsx('sidebar-link', isActive && 'active')}
        >
          <Settings className="w-4 h-4" />
          Settings
        </NavLink>
        <button
          onClick={() => { logout(); navigate('/login') }}
          className="sidebar-link w-full text-left text-red-400/80 hover:text-red-400 hover:bg-red-900/10"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>

      {user && (
        <div className="mt-3 pt-3 border-t border-gray-700/50 px-1 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-600 to-primary-800
                          flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            {user.username?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-200 truncate">{user.username}</p>
            {user.is_admin && <p className="text-[10px] text-primary-500 font-medium">Admin</p>}
          </div>
        </div>
      )}
    </aside>
  )
}
