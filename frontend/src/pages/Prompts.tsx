import { useEffect, useState } from 'react'
import { Plus, Trash2, Copy, History, RotateCcw, Search, Loader2, BookMarked } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import Skeleton from '../components/ui/Skeleton'
import { useAuth } from '../store/auth'

interface Prompt {
  id: number
  title: string
  description?: string | null
  content: string
  variables?: Record<string, any> | null
  tags: string[]
  is_public: boolean
  is_system: boolean
  owner_id: number
  owner_name: string
  use_count: number
  updated_at: string
}

interface PromptVersion {
  id: number
  version_number: number
  title: string
  content: string
  created_at: string
}

export default function PromptsPage() {
  const { user } = useAuth()
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Prompt | null>(null)
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', content: '', tags: '', is_public: false })
  const [vars, setVars] = useState<Record<string, string>>({})
  const [rendered, setRendered] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/prompts', { params: { mine_only: false, search: search || undefined } })
      setPrompts(data.prompts || [])
    } catch {
      toast.error('Failed to load prompts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [search])

  const loadVersions = async (id: number) => {
    try {
      const { data } = await api.get(`/prompts/${id}/versions`)
      setVersions(data.versions || [])
    } catch {
      toast.error('Failed to load versions')
    }
  }

  const selectPrompt = async (p: Prompt) => {
    setSelected(p)
    setRendered('')
    setVars({})
    await loadVersions(p.id)
  }

  const createPrompt = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.content.trim()) return
    setSaving(true)
    try {
      const { data } = await api.post('/prompts', {
        title: form.title,
        description: form.description || undefined,
        content: form.content,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        is_public: form.is_public,
      })
      setPrompts((ps) => [data, ...ps])
      setShowCreate(false)
      setForm({ title: '', description: '', content: '', tags: '', is_public: false })
      toast.success('Prompt saved')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to save prompt')
    } finally {
      setSaving(false)
    }
  }

  const deletePrompt = async (id: number) => {
    if (!confirm('Delete this prompt?')) return
    try {
      await api.delete(`/prompts/${id}`)
      setPrompts((ps) => ps.filter((p) => p.id !== id))
      if (selected?.id === id) setSelected(null)
      toast.success('Deleted')
    } catch {
      toast.error('Failed to delete')
    }
  }

  const restoreVersion = async (versionId: number) => {
    if (!selected) return
    try {
      const { data } = await api.post(`/prompts/${selected.id}/versions/${versionId}/restore`)
      setSelected(data)
      setPrompts((ps) => ps.map((p) => (p.id === data.id ? data : p)))
      await loadVersions(data.id)
      toast.success('Version restored')
    } catch {
      toast.error('Failed to restore version')
    }
  }

  const usePrompt = async () => {
    if (!selected) return
    try {
      const { data } = await api.post(`/prompts/${selected.id}/use`, { variables: vars })
      setRendered(data.content || '')
      if (data.warning) toast(data.warning)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to render prompt')
    }
  }

  const copyRendered = async () => {
    if (!rendered) return
    await navigator.clipboard.writeText(rendered)
    toast.success('Copied')
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Prompt Library</h1>
          <p className="text-gray-400 mt-1">Save, version, and reuse prompts.</p>
        </div>
        <button onClick={() => setShowCreate((v) => !v)} className="btn-primary">
          <Plus className="w-4 h-4" /> New Prompt
        </button>
      </div>

      {showCreate && (
        <form onSubmit={createPrompt} className="card space-y-3">
          <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="input" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <textarea className="input min-h-[120px]" placeholder="Prompt content. Use {{variable}} for templates." value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          <input className="input" placeholder="Tags (comma separated)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} />
            Public
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}</button>
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="card space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input className="input pl-9" placeholder="Search prompts..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {loading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : prompts.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No prompts yet.</p>
          ) : (
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {prompts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectPrompt(p)}
                  className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${selected?.id === p.id ? 'bg-primary-900/30 text-primary-200' : 'hover:bg-gray-800 text-gray-300'}`}
                >
                  <div className="text-sm font-medium truncate">{p.title}</div>
                  <div className="text-xs text-gray-500 truncate">{p.tags?.join(', ') || 'No tags'}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card space-y-4">
          {!selected ? (
            <p className="text-gray-500 text-sm">Select a prompt to view, edit, or restore versions.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-100">{selected.title}</h2>
                  {selected.description && <p className="text-sm text-gray-400">{selected.description}</p>}
                </div>
                <button onClick={() => deletePrompt(selected.id)} className="text-gray-600 hover:text-red-400 p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <textarea
                className="input min-h-[140px] font-mono text-sm"
                value={selected.content}
                onChange={(e) => setSelected({ ...selected, content: e.target.value })}
              />

              <div className="flex flex-wrap gap-2">
                {(Object.keys(selected.variables || {}) as string[]).map((key) => (
                  <input
                    key={key}
                    className="input text-xs"
                    placeholder={key}
                    value={vars[key] || ''}
                    onChange={(e) => setVars({ ...vars, [key]: e.target.value })}
                  />
                ))}
              </div>

              <div className="flex gap-2">
                <button onClick={usePrompt} className="btn-primary">Render</button>
                <button onClick={copyRendered} disabled={!rendered} className="btn-secondary"><Copy className="w-4 h-4" /> Copy</button>
              </div>
              {rendered && (
                <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap">{rendered}</pre>
              )}

              <div className="border-t border-gray-800 pt-3">
                <div className="flex items-center gap-2 mb-2">
                  <History className="w-4 h-4 text-gray-400" />
                  <p className="text-sm font-medium text-gray-200">Version history</p>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {versions.map((v) => (
                    <div key={v.id} className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-200 truncate">v{v.version_number} · {v.title}</p>
                        <p className="text-xs text-gray-500">{new Date(v.created_at).toLocaleString()}</p>
                      </div>
                      <button onClick={() => restoreVersion(v.id)} className="btn-ghost text-xs">
                        <RotateCcw className="w-3.5 h-3.5" /> Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
