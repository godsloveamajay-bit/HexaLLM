import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, MessageSquare, Bot, Brain, Image, Database, BookOpen,
  BarChart2, Terminal, Download, Settings, Key, FileText, Workflow,
  Server, Cpu, User, Hash, ChevronRight,
} from 'lucide-react'
import api from '../../lib/api'
import { useAuth } from '../../store/auth'

interface NavItem {
  id: string
  label: string
  path: string
  icon: React.ReactNode
  keywords?: string
  adminOnly?: boolean
}

interface Session {
  id: number
  title: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'chat',       label: 'Chat',           path: '/chat',       icon: <MessageSquare className="w-4 h-4" />, keywords: 'message talk ai' },
  { id: 'image',      label: 'Image Gen',      path: '/image',      icon: <Image className="w-4 h-4" />,         keywords: 'generate picture draw' },
  { id: 'agents',     label: 'Agents',         path: '/agents',     icon: <Bot className="w-4 h-4" />,           keywords: 'automation run' },
  { id: 'models',     label: 'Models',         path: '/models',     icon: <Brain className="w-4 h-4" />,         keywords: 'ollama llm' },
  { id: 'train',      label: 'Train',          path: '/train',      icon: <Cpu className="w-4 h-4" />,           keywords: 'fine-tune finetune dataset' },
  { id: 'knowledge',  label: 'Knowledge',      path: '/knowledge',  icon: <Database className="w-4 h-4" />,      keywords: 'kb rag documents files' },
  { id: 'memory',     label: 'Memory',         path: '/memory',     icon: <BookOpen className="w-4 h-4" />,      keywords: 'remember context' },
  { id: 'personas',   label: 'Personas',       path: '/personas',   icon: <User className="w-4 h-4" />,          keywords: 'character system prompt' },
  { id: 'workflows',  label: 'Workflows',      path: '/workflows',  icon: <Workflow className="w-4 h-4" />,      keywords: 'pipeline chain steps' },
  { id: 'mcp',        label: 'MCP Servers',    path: '/mcp',        icon: <Server className="w-4 h-4" />,        keywords: 'model context protocol plugin' },
  { id: 'remote-cli', label: 'Remote CLI',     path: '/remote-cli', icon: <Terminal className="w-4 h-4" />,      keywords: 'cli terminal nebula daemon' },
  { id: 'downloads',  label: 'Downloads',      path: '/downloads',  icon: <Download className="w-4 h-4" />,      keywords: 'apps install desktop mobile' },
  { id: 'analytics',  label: 'Analytics',      path: '/analytics',  icon: <BarChart2 className="w-4 h-4" />,     keywords: 'stats usage metrics', adminOnly: true },
  { id: 'logs',       label: 'Logs',           path: '/logs',       icon: <FileText className="w-4 h-4" />,      keywords: 'history requests debug', adminOnly: true },
  { id: 'api-keys',   label: 'API Keys',       path: '/api-keys',   icon: <Key className="w-4 h-4" />,           keywords: 'token access' },
  { id: 'settings',   label: 'Settings',       path: '/settings',   icon: <Settings className="w-4 h-4" />,      keywords: 'profile password account' },
  { id: 'dashboard',  label: 'Dashboard',      path: '/dashboard',  icon: <BarChart2 className="w-4 h-4" />,     keywords: 'admin overview', adminOnly: true },
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [sessions, setSessions] = useState<Session[]>([])
  const navigate = useNavigate()
  const { user, token } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => { setOpen(false); setQuery('') }, [])

  // Open on Ctrl+K / Cmd+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [close])

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      if (token) {
        api.get('/chat/sessions').then(r => {
          setSessions((r.data || []).slice(0, 20))
        }).catch(() => {})
      }
    }
  }, [open, token])

  const visibleNavItems = NAV_ITEMS.filter(item =>
    !item.adminOnly || user?.is_admin
  )

  const q = query.toLowerCase().trim()

  const filteredNav = q
    ? visibleNavItems.filter(item =>
        item.label.toLowerCase().includes(q) ||
        (item.keywords ?? '').includes(q)
      )
    : visibleNavItems

  const filteredSessions = q
    ? sessions.filter(s => s.title?.toLowerCase().includes(q)).slice(0, 5)
    : sessions.slice(0, 5)

  const allResults = [
    ...filteredNav.map(item => ({ type: 'nav' as const, item })),
    ...filteredSessions.map(s => ({ type: 'session' as const, session: s })),
  ]

  // Clamp activeIdx
  const clampedIdx = Math.min(activeIdx, Math.max(allResults.length - 1, 0))

  const goTo = (idx: number) => {
    const result = allResults[idx]
    if (!result) return
    if (result.type === 'nav') navigate(result.item.path)
    else navigate(`/chat?session=${result.session.id}`)
    close()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, allResults.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); goTo(clampedIdx) }
    if (e.key === 'Escape')    close()
  }

  // Reset index when query changes
  useEffect(() => setActiveIdx(0), [query])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative w-full max-w-xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
          <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search pages, chats…"
            className="flex-1 bg-transparent text-gray-100 placeholder-gray-500 text-sm outline-none"
          />
          <kbd className="hidden sm:flex items-center gap-1 text-[10px] text-gray-600 border border-gray-700 rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1">
          {allResults.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">No results for "{query}"</p>
          )}

          {/* Navigation section */}
          {filteredNav.length > 0 && (
            <>
              {(filteredSessions.length > 0 || q === '') && (
                <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider px-4 pt-2 pb-1">
                  Pages
                </p>
              )}
              {filteredNav.map((item, i) => {
                const globalIdx = i
                return (
                  <button
                    key={item.id}
                    onMouseEnter={() => setActiveIdx(globalIdx)}
                    onClick={() => goTo(globalIdx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      clampedIdx === globalIdx
                        ? 'bg-primary-600/20 text-primary-300'
                        : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    <span className={clampedIdx === globalIdx ? 'text-primary-400' : 'text-gray-500'}>
                      {item.icon}
                    </span>
                    <span className="text-sm flex-1">{item.label}</span>
                    {clampedIdx === globalIdx && <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
                  </button>
                )
              })}
            </>
          )}

          {/* Chat sessions section */}
          {filteredSessions.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider px-4 pt-3 pb-1">
                Recent chats
              </p>
              {filteredSessions.map((session, i) => {
                const globalIdx = filteredNav.length + i
                return (
                  <button
                    key={session.id}
                    onMouseEnter={() => setActiveIdx(globalIdx)}
                    onClick={() => goTo(globalIdx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      clampedIdx === globalIdx
                        ? 'bg-primary-600/20 text-primary-300'
                        : 'text-gray-400 hover:bg-gray-800'
                    }`}
                  >
                    <Hash className={`w-4 h-4 flex-shrink-0 ${clampedIdx === globalIdx ? 'text-primary-400' : 'text-gray-600'}`} />
                    <span className="text-sm truncate flex-1">{session.title || 'Untitled chat'}</span>
                    {clampedIdx === globalIdx && <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
                  </button>
                )
              })}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-800 text-[10px] text-gray-600">
          <span className="flex items-center gap-1"><kbd className="border border-gray-700 rounded px-1">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="border border-gray-700 rounded px-1">↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd className="border border-gray-700 rounded px-1">esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
