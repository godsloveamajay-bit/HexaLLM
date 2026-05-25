import { useState, useEffect } from 'react'
import { Plus, Trash2, RefreshCw, Loader2, CheckCircle2, XCircle, Server, Copy, ExternalLink, Wrench } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

interface MCPServer {
  id: number
  name: string
  description: string | null
  url: string
  is_active: boolean
  last_ping_at: string | null
  tools_cache: MCPTool[] | null
  created_at: string
}

interface MCPTool {
  name: string
  description?: string
  inputSchema?: { properties?: Record<string, any> }
}

const EXAMPLE_SERVERS = [
  { name: 'GitHub', description: 'Read repos, issues, PRs', url: 'http://localhost:3001/sse', hint: 'npx @modelcontextprotocol/server-github' },
  { name: 'Filesystem', description: 'Read/write local files (sandboxed)', url: 'http://localhost:3002/sse', hint: 'npx @modelcontextprotocol/server-filesystem /path' },
  { name: 'Postgres', description: 'Query a PostgreSQL database', url: 'http://localhost:3003/sse', hint: 'npx @modelcontextprotocol/server-postgres postgresql://...' },
  { name: 'Brave Search', description: 'Web search via Brave API', url: 'http://localhost:3004/sse', hint: 'npx @modelcontextprotocol/server-brave-search' },
]

export default function MCPServersPage() {
  const [servers, setServers] = useState<MCPServer[]>([])
  const [loading, setLoading] = useState(true)
  const [pinging, setPinging] = useState<Set<number>>(new Set())
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', url: '' })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const { data } = await api.get('/mcp')
      setServers(data)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    if (!form.name.trim() || !form.url.trim()) { toast.error('Name and URL required'); return }
    setSaving(true)
    try {
      await api.post('/mcp', form)
      toast.success('MCP server added')
      setForm({ name: '', description: '', url: '' })
      setShowForm(false)
      load()
    } catch { toast.error('Failed to add server') }
    finally { setSaving(false) }
  }

  const del = async (id: number) => {
    if (!confirm('Remove this MCP server?')) return
    await api.delete(`/mcp/${id}`)
    setServers((s) => s.filter((x) => x.id !== id))
    toast.success('Removed')
  }

  const ping = async (id: number) => {
    setPinging((s) => new Set(s).add(id))
    try {
      const { data } = await api.post(`/mcp/${id}/ping`)
      if (data.status === 'ok') {
        toast.success(`Connected — ${data.tool_count} tool${data.tool_count !== 1 ? 's' : ''} available`)
        load()
      } else {
        toast.error(`Connection failed: ${data.detail}`)
      }
    } catch { toast.error('Ping failed') }
    finally { setPinging((s) => { const n = new Set(s); n.delete(id); return n }) }
  }

  const useExample = (ex: typeof EXAMPLE_SERVERS[0]) => {
    setForm({ name: ex.name, description: ex.description, url: ex.url })
    setShowForm(true)
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <Server className="w-6 h-6 text-primary-400" /> MCP Servers
          </h1>
          <p className="text-gray-400 mt-1">
            Connect Model Context Protocol servers to give agents powerful new tools — databases, GitHub, browsers, and more.
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex-shrink-0 gap-1.5">
          <Plus className="w-4 h-4" /> Add Server
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="card mb-6">
          <h2 className="font-semibold text-gray-100 mb-4">Add MCP Server</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Name *</label>
                <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="GitHub" />
              </div>
              <div>
                <label className="label">SSE URL *</label>
                <input className="input" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="http://localhost:3001/sse" />
              </div>
            </div>
            <div>
              <label className="label">Description</label>
              <input className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What does this server provide?" />
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3 text-xs text-gray-500 font-mono">
              <p className="text-gray-400 mb-1 font-sans font-medium text-xs">How to run an MCP server locally:</p>
              <p>npx @modelcontextprotocol/server-github --port 3001</p>
              <p className="text-gray-600 mt-1 font-sans">Then enter http://localhost:3001/sse as the URL above.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={create} disabled={saving} className="btn-primary flex-1 justify-center">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add Server
              </button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Example servers */}
      {!servers.length && !loading && (
        <div className="card mb-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Popular MCP Servers</h2>
          <div className="grid grid-cols-2 gap-2">
            {EXAMPLE_SERVERS.map((ex) => (
              <button key={ex.name} onClick={() => useExample(ex)}
                className="text-left p-3 rounded-lg border border-gray-700/50 hover:border-primary-700/50 hover:bg-primary-900/10 transition-colors">
                <p className="text-sm font-medium text-gray-200">{ex.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{ex.description}</p>
                <p className="text-xs text-gray-700 mt-1 font-mono truncate">{ex.hint}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
        </div>
      ) : servers.length === 0 ? (
        <div className="text-center py-12 text-gray-600">
          <Server className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No MCP servers connected yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <div key={server.id} className="card">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-100">{server.name}</h3>
                    <span className={clsx('w-2 h-2 rounded-full flex-shrink-0',
                      server.last_ping_at ? 'bg-green-500' : 'bg-gray-600')} />
                  </div>
                  {server.description && <p className="text-sm text-gray-400">{server.description}</p>}
                  <p className="text-xs text-gray-600 font-mono mt-1">{server.url}</p>

                  {server.tools_cache && server.tools_cache.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {server.tools_cache.map((t) => (
                        <span key={t.name} className="badge bg-primary-900/20 text-primary-400 text-xs">
                          <Wrench className="w-2.5 h-2.5 mr-1" />{t.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {server.last_ping_at && (
                    <p className="text-xs text-gray-600 mt-2">
                      Last connected {formatDistanceToNow(new Date(server.last_ping_at), { addSuffix: true })}
                      {server.tools_cache ? ` · ${server.tools_cache.length} tools` : ''}
                    </p>
                  )}
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => ping(server.id)} disabled={pinging.has(server.id)} className="btn-secondary text-sm gap-1">
                    {pinging.has(server.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Test
                  </button>
                  <button onClick={() => del(server.id)} className="btn-secondary text-sm text-red-400 hover:text-red-300">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* OpenAI compat info */}
      <div className="card mt-6 bg-primary-900/10 border-primary-800/30">
        <h2 className="font-semibold text-primary-300 mb-2 flex items-center gap-2">
          <ExternalLink className="w-4 h-4" /> OpenAI-Compatible API
        </h2>
        <p className="text-sm text-gray-400 mb-3">
          NebulaX exposes an OpenAI-compatible endpoint. Point any OpenAI SDK or tool at your instance:
        </p>
        <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-300 space-y-1">
          <p>Base URL: <span className="text-primary-400">http://your-server/api/v1/openai</span></p>
          <p>API Key: <span className="text-primary-400">any active NebulaX API key (nai_...)</span></p>
          <p>Endpoint: <span className="text-primary-400">POST /api/v1/openai/chat/completions</span></p>
        </div>
      </div>
    </div>
  )
}
