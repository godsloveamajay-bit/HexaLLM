import { useState, useEffect } from 'react'
import { Plus, Search, Download, Heart, Cpu, User, Globe, Lock, Trash2, X, Loader2 } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { useAuth } from '../store/auth'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

interface Model {
  id: number; name: string; slug: string; description?: string; base_model: string;
  tags: string[]; is_public: boolean; is_fine_tuned: boolean; parameter_count?: string;
  license: string; downloads: number; likes: number; owner_username?: string; created_at: string;
}

const POPULAR_BASES = ['qwen3:14B', 'llama3:8B', 'openchat:7B', 'Qwen2.5-Coder:7B', 'deepseek-r1:latest', 'mistral:7b', 'gemma2:2b', 'phi3:mini']

function ModelCard({ model, onDelete, onLike, isOwner }: { model: Model; onDelete: () => void; onLike: () => void; isOwner: boolean }) {
  return (
    <div className="card hover:border-gray-700 transition-all fade-in">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-600 to-secondary-600 flex items-center justify-center flex-shrink-0">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-100 truncate">{model.name}</h3>
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <User className="w-3 h-3" />{model.owner_username}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {model.is_fine_tuned && <span className="badge bg-secondary-900/40 text-secondary-300">fine-tuned</span>}
          {model.is_public
            ? <span className="badge bg-green-900/40 text-green-300"><Globe className="w-3 h-3 mr-1" />public</span>
            : <span className="badge bg-gray-800 text-gray-400"><Lock className="w-3 h-3 mr-1" />private</span>}
        </div>
      </div>

      {model.description && <p className="text-sm text-gray-400 mb-3 line-clamp-2">{model.description}</p>}

      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className="badge bg-gray-800 text-gray-400">{model.base_model}</span>
        {model.parameter_count && <span className="badge bg-gray-800 text-gray-400">{model.parameter_count}</span>}
        {model.tags.slice(0, 3).map((t) => <span key={t} className="badge bg-primary-900/30 text-primary-400">{t}</span>)}
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-3">
          <button onClick={onLike} className="flex items-center gap-1 hover:text-red-400 transition-colors">
            <Heart className="w-3.5 h-3.5" />{model.likes}
          </button>
          <span className="flex items-center gap-1"><Download className="w-3.5 h-3.5" />{model.downloads}</span>
          <span>{formatDistanceToNow(new Date(model.created_at), { addSuffix: true })}</span>
        </div>
        {isOwner && (
          <button onClick={onDelete} className="text-gray-600 hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

export default function ModelsPage() {
  const { user } = useAuth()
  const [models, setModels] = useState<Model[]>([])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'hub' | 'mine'>('hub')
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pullingModel, setPullingModel] = useState('')
  const [form, setForm] = useState({
    name: '', description: '', base_model: POPULAR_BASES[0],
    tags: '', is_public: true, parameter_count: '', system_prompt: '', license: 'MIT',
  })

  const load = async () => {
    setLoading(true)
    try {
      const endpoint = tab === 'mine' ? '/models/my' : `/models?search=${search}`
      const { data } = await api.get(endpoint)
      setModels(data)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [tab, search])

  const createModel = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/models', { ...form, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) })
      toast.success('Model created!')
      setShowCreate(false)
      load()
    } catch (err: any) { toast.error(err.response?.data?.detail || 'Failed') }
  }

  const deleteModel = async (id: number) => {
    await api.delete(`/models/${id}`)
    toast.success('Model deleted')
    setModels((m) => m.filter((x) => x.id !== id))
  }

  const likeModel = async (id: number) => {
    const { data } = await api.post(`/models/${id}/like`)
    setModels((m) => m.map((x) => x.id === id ? { ...x, likes: data.likes } : x))
  }

  const pullModel = async () => {
    if (!pullingModel.trim()) return
    toast.loading(`Pulling ${pullingModel}...`, { id: 'pull' })
    try {
      await api.post('/models/ollama/pull', { model: pullingModel })
      toast.success(`Pulled ${pullingModel}!`, { id: 'pull' })
      setPullingModel('')
    } catch { toast.error('Pull failed', { id: 'pull' }) }
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-100">Model Hub</h1>
          <p className="text-gray-400 mt-1">Discover, create, and share AI models</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary self-start sm:self-auto">
          <Plus className="w-4 h-4" /> New Model
        </button>
      </div>

      {/* Ollama pull */}
      <div className="card mb-6 flex items-center gap-3">
        <Download className="w-5 h-5 text-primary-400 flex-shrink-0" />
        <input
          value={pullingModel}
          onChange={(e) => setPullingModel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && pullModel()}
          placeholder="Pull an Ollama model (e.g. llama3:8B)"
          className="input flex-1"
        />
        <button onClick={pullModel} disabled={!pullingModel.trim()} className="btn-secondary flex-shrink-0">Pull</button>
      </div>

      {/* Tabs + search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1 self-start">
          {(['hub', 'mine'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={clsx('px-4 py-1.5 rounded-md text-sm font-medium transition-all',
              tab === t ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-100')}>
              {t === 'hub' ? 'Model Hub' : 'My Models'}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search models..." className="input pl-9" />
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
        </div>
      ) : models.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          <Cpu className="w-12 h-12 mx-auto mb-3" />
          <p className="text-lg font-medium">{tab === 'mine' ? 'No models yet' : 'No models found'}</p>
          <p className="text-sm mt-1">Create one to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {models.map((m) => (
            <ModelCard
              key={m.id}
              model={m}
              isOwner={m.owner_username === user?.username}
              onDelete={() => deleteModel(m.id)}
              onLike={() => likeModel(m.id)}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-100">Create Model</h2>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={createModel} className="space-y-4">
              <div>
                <label className="label">Name *</label>
                <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="label">Base Model *</label>
                <select
                  className="input"
                  value={POPULAR_BASES.includes(form.base_model) ? form.base_model : 'custom'}
                  onChange={(e) => setForm((f) => ({ ...f, base_model: e.target.value === 'custom' ? '' : e.target.value }))}
                >
                  {POPULAR_BASES.map((b) => <option key={b} value={b}>{b}</option>)}
                  <option value="custom">custom (type below)</option>
                </select>
                {!POPULAR_BASES.includes(form.base_model) && (
                  <input
                    className="input mt-2"
                    placeholder="e.g. llama3.2:1b, mistral:7b-instruct"
                    value={form.base_model}
                    required
                    onChange={(e) => setForm((f) => ({ ...f, base_model: e.target.value }))}
                  />
                )}
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input resize-none" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label className="label">System Prompt</label>
                <textarea className="input resize-none" rows={2} placeholder="You are a helpful assistant..." value={form.system_prompt} onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Parameters</label>
                  <input className="input" placeholder="7B" value={form.parameter_count} onChange={(e) => setForm((f) => ({ ...f, parameter_count: e.target.value }))} />
                </div>
                <div>
                  <label className="label">License</label>
                  <select className="input" value={form.license} onChange={(e) => setForm((f) => ({ ...f, license: e.target.value }))}>
                    {['MIT', 'Apache-2.0', 'CC-BY-4.0', 'Llama 3', 'Other'].map((l) => <option key={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Tags (comma-separated)</label>
                <input className="input" placeholder="chat, coding, multilingual" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="public" checked={form.is_public} onChange={(e) => setForm((f) => ({ ...f, is_public: e.target.checked }))} className="accent-primary-500" />
                <label htmlFor="public" className="text-sm text-gray-300">Make public</label>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary flex-1 justify-center">Cancel</button>
                <button type="submit" className="btn-primary flex-1 justify-center">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
