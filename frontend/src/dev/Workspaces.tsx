import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderKanban, Plus, Trash2, Pencil, Copy, Check, Play, KeyRound, Braces, FlaskConical, RefreshCw, AlertCircle } from 'lucide-react'
import { useAuth } from '../store/auth'
import { useDevStore, type Workspace, type WorkspaceItem, type WorkspaceKey } from './devStore'
import {
  fetchWorkspaces, createWorkspace, renameWorkspace, deleteWorkspace,
  fetchItems, deleteItem, renameItem,
  fetchKeys, createKey, revokeKey,
} from './workspacesApi'

type Tab = 'playground' | 'request' | 'keys'

const KIND_LABEL: Record<Tab, { label: string; icon: typeof FlaskConical }> = {
  playground: { label: 'Playground Presets', icon: FlaskConical },
  request: { label: 'API Requests', icon: Braces },
  keys: { label: 'API Keys', icon: KeyRound },
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export default function Workspaces() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { activeWorkspaceId, setActiveWorkspace, loadPreset, loadRequest } = useDevStore()

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [tab, setTab] = useState<Tab>('playground')
  const [items, setItems] = useState<WorkspaceItem[]>([])
  const [keys, setKeys] = useState<WorkspaceKey[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null

  const reload = useCallback(async () => {
    const list = await fetchWorkspaces()
    setWorkspaces(list)
    if (list.length && (activeWorkspaceId === null || !list.some((w) => w.id === activeWorkspaceId))) {
      setActiveWorkspace(list[0].id)
    }
  }, [activeWorkspaceId, setActiveWorkspace])

  const loadTab = useCallback(async (wsId: number, t: Tab) => {
    setLoading(true)
    setError(null)
    try {
      if (t === 'keys') {
        setKeys(await fetchKeys(wsId))
      } else {
        setItems(await fetchItems(wsId, t))
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload().catch(() => {})
  }, [reload])

  useEffect(() => {
    if (activeWorkspaceId !== null) loadTab(activeWorkspaceId, tab)
  }, [activeWorkspaceId, tab, loadTab])

  if (!user) {
    return (
      <div className="p-8 font-mono text-sm" style={{ color: '#8b949e' }}>
        sign in to use workspaces — <a href="/login" className="underline" style={{ color: '#4ade80' }}>/login</a>
      </div>
    )
  }

  const makeWorkspace = async () => {
    const name = window.prompt('workspace name:')
    if (!name) return
    try {
      const ws = await createWorkspace(name)
      setWorkspaces((prev) => [...prev, ws])
      setActiveWorkspace(ws.id)
      setTab('playground')
      await loadTab(ws.id, 'playground')
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'failed to create')
    }
  }

  const rename = async (ws: Workspace) => {
    const name = window.prompt('rename workspace:', ws.name)
    if (!name || name === ws.name) return
    try {
      const updated = await renameWorkspace(ws.id, name)
      setWorkspaces((prev) => prev.map((w) => (w.id === ws.id ? updated : w)))
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'failed to rename')
    }
  }

  const remove = async (ws: Workspace) => {
    if (!window.confirm(`delete workspace "${ws.name}" and all its presets/requests?`)) return
    try {
      await deleteWorkspace(ws.id)
      setWorkspaces((prev) => prev.filter((w) => w.id !== ws.id))
      if (activeWorkspaceId === ws.id) setActiveWorkspace(null)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'failed to delete')
    }
  }

  const copyPayload = async (item: WorkspaceItem) => {
    await navigator.clipboard.writeText(JSON.stringify(item.payload, null, 2))
    setCopied(item.id)
    setTimeout(() => setCopied(null), 1500)
  }

  const useItem = async (item: WorkspaceItem) => {
    if (item.kind === 'playground') {
      loadPreset(item)
      navigate('/playground')
    } else {
      loadRequest(item)
      navigate('/api')
    }
  }

  const removeItem = async (item: WorkspaceItem) => {
    if (!active) return
    await deleteItem(active.id, item.id)
    setItems((prev) => prev.filter((i) => i.id !== item.id))
  }

  const renameItemNow = async (item: WorkspaceItem) => {
    if (!active) return
    const name = window.prompt('rename:', item.name)
    if (!name || name === item.name) return
    const updated = await renameItem(active.id, item.id, name)
    setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
  }

  const makeKey = async () => {
    if (!active) return
    const name = window.prompt('key name:', 'dev-key')
    if (!name) return
    const model = window.prompt('bind to model (optional, e.g. hex-4.2-turbo):', '') || undefined
    try {
      const k = await createKey(active.id, name, model)
      setKeys((prev) => [k, ...prev])
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'failed to create key')
    }
  }

  const removeKey = async (k: WorkspaceKey) => {
    if (!window.confirm(`revoke key "${k.name}"?`)) return
    await revokeKey(k.id)
    setKeys((prev) => prev.filter((x) => x.id !== k.id))
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <FolderKanban size={18} style={{ color: '#4ade80' }} />
        <div className="flex-1">
          <h1 className="font-mono font-bold text-lg" style={{ color: '#e6edf3' }}>workspaces</h1>
          <p className="font-mono text-xs" style={{ color: '#8b949e' }}>
            organize playground presets, API requests and scoped keys per project
          </p>
        </div>
        <button
          onClick={makeWorkspace}
          className="flex items-center gap-2 font-mono text-sm px-4 py-2 rounded font-semibold"
          style={{ background: '#4ade80', color: '#0d1117' }}
        >
          <Plus size={14} /> new workspace
        </button>
      </div>

      {error && (
        <div className="font-mono text-[11px] flex items-start gap-1.5 mb-4" style={{ color: 'rgba(248,113,113,0.85)' }}>
          <AlertCircle size={12} className="mt-[1px] flex-shrink-0" style={{ color: 'rgba(248,113,113,0.6)' }} />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {workspaces.length === 0 ? (
        <div className="rounded-lg border p-8 flex flex-col items-center gap-2 font-mono text-sm" style={{ borderColor: '#30363d', background: '#161b22', color: '#8b949e' }}>
          <FolderKanban size={20} />
          <span>no workspaces yet</span>
          <span className="text-xs" style={{ color: '#6e7681' }}>create one to start saving presets and requests</span>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[260px_1fr] gap-4">
          {/* workspace list */}
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#30363d', background: '#161b22' }}>
            <div className="px-3 py-2 border-b font-mono text-[10px] uppercase tracking-widest" style={{ borderColor: '#30363d', color: '#8b949e' }}>
              {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}
            </div>
            <div className="p-2 space-y-1">
              {workspaces.map((ws) => (
                <div
                  key={ws.id}
                  onClick={() => setActiveWorkspace(ws.id)}
                  className="group rounded px-2.5 py-2 cursor-pointer"
                  style={
                    ws.id === activeWorkspaceId
                      ? { background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)' }
                      : { border: '1px solid transparent' }
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[13px] truncate" style={{ color: ws.id === activeWorkspaceId ? '#4ade80' : '#e6edf3' }}>
                      {ws.name}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); rename(ws) }} className="p-1 rounded hover:bg-[#0d1117]" style={{ color: '#8b949e' }}>
                        <Pencil size={11} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); remove(ws) }} className="p-1 rounded hover:bg-[#0d1117]" style={{ color: '#f87171' }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                  <div className="font-mono text-[10px] mt-0.5" style={{ color: '#6e7681' }}>
                    {ws.item_count} items · {ws.key_count} keys
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* workspace detail */}
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#30363d', background: '#161b22' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: '#30363d' }}>
              <div className="font-mono font-bold" style={{ color: '#e6edf3' }}>{active?.name}</div>
              {active?.description && (
                <div className="font-mono text-xs mt-0.5" style={{ color: '#8b949e' }}>{active.description}</div>
              )}
              <div className="font-mono text-[10px] mt-1" style={{ color: '#6e7681' }}>created {active ? fmtDate(active.created_at) : ''}</div>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-2 border-b" style={{ borderColor: '#30363d' }}>
              {(Object.keys(KIND_LABEL) as Tab[]).map((t) => {
                const k = KIND_LABEL[t]
                const Icon = k.icon
                return (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className="flex items-center gap-1.5 font-mono text-xs px-2.5 py-1.5 rounded transition-colors"
                    style={
                      tab === t
                        ? { color: '#0d1117', background: '#4ade80', fontWeight: 700 }
                        : { color: '#8b949e', background: '#0d1117', border: '1px solid #30363d' }
                    }
                  >
                    <Icon size={12} />
                    {k.label}
                  </button>
                )
              })}
              <button
                onClick={() => active && loadTab(active.id, tab)}
                className="ml-auto flex items-center gap-1 font-mono text-[10px] px-2 py-1.5 rounded border transition-colors hover:bg-[#0d1117]"
                style={{ borderColor: '#30363d', color: '#8b949e' }}
              >
                <RefreshCw size={11} /> refresh
              </button>
            </div>

            <div className="p-3">
              {loading ? (
                <div className="font-mono text-sm" style={{ color: '#6e7681' }}>loading…</div>
              ) : tab === 'keys' ? (
                <div className="space-y-2">
                  <button
                    onClick={makeKey}
                    className="flex items-center gap-2 font-mono text-xs px-3 py-1.5 rounded border transition-colors hover:bg-[#0d1117]"
                    style={{ borderColor: 'rgba(74,222,128,0.4)', color: '#4ade80' }}
                  >
                    <KeyRound size={12} /> generate key
                  </button>
                  {keys.length === 0 ? (
                    <div className="font-mono text-sm p-4 text-center" style={{ color: '#6e7681' }}>
                      no keys — generate one to call the API as this workspace
                    </div>
                  ) : (
                    keys.map((k) => (
                      <div key={k.id} className="rounded border p-3" style={{ borderColor: '#30363d', background: '#0d1117' }}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[13px]" style={{ color: '#e6edf3' }}>{k.name}</span>
                          {k.model_name && (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.08)' }}>
                              {k.model_name}
                            </span>
                          )}
                          <button
                            onClick={() => removeKey(k)}
                            className="ml-auto p-1 rounded hover:bg-[#161b22]"
                            style={{ color: '#f87171' }}
                            title="revoke"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <code className="font-mono text-xs flex-1 truncate" style={{ color: '#4ade80' }}>
                            {k.key.slice(0, 18)}…{k.key.slice(-6)}
                          </code>
                          <span className="font-mono text-[10px]" style={{ color: '#6e7681' }}>
                            {k.request_count} req · {k.completion_tokens} out tok
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : items.length === 0 ? (
                <div className="font-mono text-sm p-4 text-center" style={{ color: '#6e7681' }}>
                  no saved {tab === 'playground' ? 'presets' : 'requests'} — save one from the playground / api explorer
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.id} className="rounded border p-3 flex items-center gap-3" style={{ borderColor: '#30363d', background: '#0d1117' }}>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[13px] truncate" style={{ color: '#e6edf3' }}>{item.name}</div>
                        <div className="font-mono text-[10px] mt-0.5" style={{ color: '#6e7681' }}>
                          {fmtDate(item.created_at)}
                          {item.payload && 'model' in item.payload && ` · ${String(item.payload.model)}`}
                        </div>
                      </div>
                      <button onClick={() => useItem(item)} className="flex items-center gap-1.5 font-mono text-xs px-2.5 py-1.5 rounded transition-colors" style={{ background: '#4ade80', color: '#0d1117', fontWeight: 700 }}>
                        <Play size={11} /> load
                      </button>
                      <button onClick={() => copyPayload(item)} className="p-1.5 rounded border transition-colors hover:bg-[#161b22]" style={{ borderColor: '#30363d', color: '#8b949e' }} title="copy JSON">
                        {copied === item.id ? <Check size={13} style={{ color: '#4ade80' }} /> : <Copy size={13} />}
                      </button>
                      <button onClick={() => renameItemNow(item)} className="p-1.5 rounded border transition-colors hover:bg-[#161b22]" style={{ borderColor: '#30363d', color: '#8b949e' }} title="rename">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => removeItem(item)} className="p-1.5 rounded border transition-colors hover:bg-[#161b22]" style={{ borderColor: '#30363d', color: '#f87171' }} title="delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
