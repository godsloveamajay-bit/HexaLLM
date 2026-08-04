import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Globe, Lock, Copy, Loader2, Cpu, BookOpen, Brain, Zap, Bot, FlaskConical, Search, Code2, Star, Webhook, SlidersHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { loadModelOptions, defaultModelValue, prettyModel, ModelOption } from '../lib/models'
import { useAuth } from '../store/auth'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import PersonalitySliders from '../components/PersonalitySliders'
import { normalizeTraits, isActive as personalityActive, type TraitKey } from '../lib/personality'

interface KnowledgeBase { id: number; name: string }
interface Persona {
  id: number
  name: string
  description: string | null
  emoji: string
  base_model: string
  system_prompt: string | null
  tools: string[]
  knowledge_base_id: number | null
  use_memory: boolean
  temperature: number
  max_tokens: number | null
  personality?: Record<string, number> | null
  is_public: boolean
  is_favorite: boolean
  uses: number
  last_used_at?: string | null
  owner_username?: string
  created_at: string
}

const AVAILABLE_TOOLS = ['web_search', 'code_exec', 'read_file', 'write_file']

const PRESET_EMOJIS = ['🤖', '🧠', '💼', '🔬', '🎨', '📝', '🛡️', '🚀', '🎓', '💡', '🔧', '🧪']

function PersonaForm({
  initial, modelOptions, kbs, onSave, onCancel
}: {
  initial?: Partial<Persona>
  modelOptions: ModelOption[]
  kbs: KnowledgeBase[]
  onSave: (data: any) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    emoji: initial?.emoji || '🤖',
    base_model: initial?.base_model || defaultModelValue(modelOptions),
    system_prompt: initial?.system_prompt || '',
    tools: initial?.tools || [],
    knowledge_base_id: initial?.knowledge_base_id ?? null as number | null,
    use_memory: initial?.use_memory ?? false,
    temperature: initial?.temperature ?? 0.7,
    personality: normalizeTraits(initial?.personality) as Record<TraitKey, number>,
    is_public: initial?.is_public ?? false,
  })
  const [saving, setSaving] = useState(false)

  const toggleTool = (t: string) =>
    setForm((f) => ({ ...f, tools: f.tools.includes(t) ? f.tools.filter((x) => x !== t) : [...f.tools, t] }))

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return }
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      {/* Emoji + Name */}
      <div className="flex gap-3">
        <div>
          <label className="label">Icon</label>
          <select
            value={form.emoji}
            onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
            className="input w-20 text-xl text-center"
          >
            {PRESET_EMOJIS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="label">Name *</label>
          <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="My Coding Assistant" />
        </div>
      </div>

      <div>
        <label className="label">Description</label>
        <input className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What does this persona do?" />
      </div>

      <div>
        <label className="label">Base Model</label>
        <select className="input" value={form.base_model} onChange={(e) => setForm((f) => ({ ...f, base_model: e.target.value }))}>
          {modelOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      <div>
        <label className="label">System Prompt</label>
        <textarea className="input resize-none" rows={4} value={form.system_prompt}
          onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
          placeholder="You are an expert software engineer who..." />
      </div>

      <div>
        <label className="label">Tools</label>
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_TOOLS.map((t) => (
            <button key={t} type="button" onClick={() => toggleTool(t)}
              className={clsx('badge cursor-pointer transition-all',
                form.tools.includes(t) ? 'bg-primary-900/60 text-primary-300 border-primary-700' : 'bg-gray-800 text-gray-500 border-gray-700'
              )}>
              {t.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {kbs.length > 0 && (
        <div>
          <label className="label">Knowledge Base (optional)</label>
          <select className="input" value={form.knowledge_base_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, knowledge_base_id: e.target.value ? +e.target.value : null }))}>
            <option value="">None</option>
            {kbs.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Temperature: {form.temperature}</label>
          <input type="range" min={0} max={2} step={0.1} value={form.temperature}
            onChange={(e) => setForm((f) => ({ ...f, temperature: +e.target.value }))}
            className="w-full accent-primary-500" />
        </div>
        <div className="flex flex-col gap-2 pt-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.use_memory} onChange={(e) => setForm((f) => ({ ...f, use_memory: e.target.checked }))} className="accent-primary-500" />
            <span className="text-sm text-gray-300">Use memory</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_public} onChange={(e) => setForm((f) => ({ ...f, is_public: e.target.checked }))} className="accent-primary-500" />
            <span className="text-sm text-gray-300">Make public</span>
          </label>
        </div>
      </div>

      <div>
        <label className="label flex items-center gap-1.5">
          <SlidersHorizontal className="w-3.5 h-3.5 text-primary-400" /> Personality
          {personalityActive(form.personality) && <span className="badge bg-primary-900/40 text-primary-300 text-[10px]">active</span>}
        </label>
        <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-3">
          <PersonalitySliders value={form.personality} onChange={(p) => setForm((f) => ({ ...f, personality: p }))} />
        </div>
        <p className="text-xs text-gray-600 mt-1">When active, personality drives the model's voice and sampling (overriding the temperature above) everywhere this persona is used — chat, agents, and the exposed API.</p>
      </div>

      <div className="flex gap-2 pt-2">
        <button onClick={submit} disabled={saving} className="btn-primary flex-1 justify-center">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Save Persona
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

function PersonaCard({ persona, onEdit, onDelete, onFork, onDuplicate, onToggleFavorite, onExpose, isOwn }: {
  persona: Persona; onEdit?: () => void; onDelete?: () => void; onFork?: () => void; onDuplicate?: () => void; onToggleFavorite?: () => void; onExpose?: () => void; isOwn: boolean
}) {
  const { user } = useAuth()
  // Show the branded variant label; hide raw base names from non-admins.
  const baseLabel = (user?.is_admin || persona.base_model?.startsWith('hex-'))
    ? prettyModel(persona.base_model) : 'HexaLLM model'
  return (
    <div className={clsx('card flex flex-col gap-3', persona.is_favorite && 'ring-1 ring-secondary-500/40')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{persona.emoji}</span>
          <div>
            <p className="font-semibold text-gray-100">{persona.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{baseLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isOwn && (
            <button onClick={onToggleFavorite} title={persona.is_favorite ? 'Unpin favorite' : 'Pin as favorite'}
              className={clsx('transition-colors', persona.is_favorite ? 'text-secondary-400' : 'text-gray-600 hover:text-secondary-400')}>
              <Star className="w-4 h-4" fill={persona.is_favorite ? 'currentColor' : 'none'} />
            </button>
          )}
          {persona.is_public ? <Globe className="w-3.5 h-3.5 text-green-500" /> : <Lock className="w-3.5 h-3.5 text-gray-600" />}
        </div>
      </div>

      {persona.description && <p className="text-sm text-gray-400">{persona.description}</p>}

      {persona.system_prompt && (
        <p className="text-xs text-gray-600 bg-gray-800/50 rounded p-2 line-clamp-2 font-mono">{persona.system_prompt}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {persona.tools.map((t) => <span key={t} className="badge bg-primary-900/30 text-primary-400 text-xs">{t.replace('_', ' ')}</span>)}
        {persona.knowledge_base_id && <span className="badge bg-green-900/30 text-green-400 text-xs"><BookOpen className="w-3 h-3 mr-1" />KB</span>}
        {persona.use_memory && <span className="badge bg-secondary-900/30 text-secondary-400 text-xs"><Brain className="w-3 h-3 mr-1" />Memory</span>}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-gray-800">
        <span className="text-xs text-gray-600">
          {persona.owner_username ? `by ${persona.owner_username} · ` : ''}
          {persona.uses} uses
          {persona.last_used_at && ` · used ${formatDistanceToNow(new Date(persona.last_used_at), { addSuffix: true })}`}
        </span>
        <div className="flex gap-1">
          {!isOwn && <button onClick={onFork} className="btn-secondary text-xs py-1 px-2 gap-1"><Copy className="w-3 h-3" />Fork</button>}
          {isOwn && <>
            <button onClick={onExpose} title="Expose as API" className="btn-secondary text-xs py-1 px-2 gap-1 text-primary-300 hover:text-primary-200"><Webhook className="w-3 h-3" />API</button>
            <button onClick={onDuplicate} title="Duplicate" className="btn-secondary text-xs py-1 px-2"><Copy className="w-3 h-3" /></button>
            <button onClick={onEdit} title="Edit" className="btn-secondary text-xs py-1 px-2"><Pencil className="w-3 h-3" /></button>
            <button onClick={onDelete} title="Delete" className="btn-secondary text-xs py-1 px-2 text-red-400 hover:text-red-300"><Trash2 className="w-3 h-3" /></button>
          </>}
        </div>
      </div>
    </div>
  )
}

export default function PersonasPage() {
  const { user } = useAuth()
  const [mine, setMine] = useState<Persona[]>([])
  const [community, setCommunity] = useState<Persona[]>([])
  const [kbs, setKbs] = useState<KnowledgeBase[]>([])
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const [tab, setTab] = useState<'mine' | 'community'>('mine')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Persona | null>(null)

  const load = async () => {
    try {
      const [mineRes, commRes, kbRes, optsRes] = await Promise.allSettled([
        api.get('/personas'),
        api.get('/personas/community'),
        api.get('/knowledge'),
        loadModelOptions(!!user?.is_admin),
      ])
      if (mineRes.status === 'fulfilled') setMine(mineRes.value.data)
      if (commRes.status === 'fulfilled') setCommunity(commRes.value.data)
      if (kbRes.status === 'fulfilled') setKbs(kbRes.value.data)
      if (optsRes.status === 'fulfilled' && optsRes.value.length) setModelOptions(optsRes.value)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const save = async (data: any) => {
    if (editing) {
      await api.patch(`/personas/${editing.id}`, data)
      toast.success('Persona updated')
    } else {
      await api.post('/personas', data)
      toast.success('Persona created')
    }
    setShowForm(false)
    setEditing(null)
    load()
  }

  const del = async (id: number) => {
    if (!confirm('Delete this persona?')) return
    await api.delete(`/personas/${id}`)
    setMine((m) => m.filter((p) => p.id !== id))
    toast.success('Deleted')
  }

  const toggleFavorite = async (p: Persona) => {
    // optimistic flip + re-sort favorites first
    setMine((m) =>
      [...m.map((x) => (x.id === p.id ? { ...x, is_favorite: !x.is_favorite } : x))]
        .sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite))
    )
    try { await api.post(`/personas/${p.id}/favorite`) }
    catch { toast.error('Failed to update favorite'); load() }
  }

  const fork = async (id: number) => {
    await api.post(`/personas/${id}/fork`)
    toast.success('Forked to your personas')
    load()
  }

  const duplicate = async (id: number) => {
    try { await api.post(`/personas/${id}/duplicate`); toast.success('Duplicated'); load() }
    catch { toast.error('Failed to duplicate') }
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Personas</h1>
          <p className="text-gray-400 mt-1">Custom AI configurations with their own model, tools, knowledge, and personality.</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary flex-shrink-0 gap-1.5">
          <Plus className="w-4 h-4" /> New Persona
        </button>
      </div>

      {showForm && (
        <div className="card mb-6">
          <h2 className="font-semibold text-gray-100 mb-4">{editing ? 'Edit Persona' : 'New Persona'}</h2>
          <PersonaForm
            initial={editing || undefined}
            modelOptions={modelOptions}
            kbs={kbs}
            onSave={save}
            onCancel={() => { setShowForm(false); setEditing(null) }}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800 pb-1">
        {(['mine', 'community'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx('px-4 py-2 text-sm font-medium rounded-t-lg transition-colors capitalize', tab === t ? 'text-primary-400 border-b-2 border-primary-500' : 'text-gray-500 hover:text-gray-300')}>
            {t === 'mine' ? `My Personas (${mine.length})` : `Community (${community.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
        </div>
      ) : tab === 'mine' ? (
        mine.length === 0 ? (
          <div className="text-center py-12 text-gray-600">
            <Bot className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No personas yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {mine.map((p) => (
              <PersonaCard key={p.id} persona={p} isOwn
                onEdit={() => { setEditing(p); setShowForm(true) }}
                onDelete={() => del(p.id)}
                onDuplicate={() => duplicate(p.id)}
                onToggleFavorite={() => toggleFavorite(p)}
                onExpose={() => navigate(`/api-keys?expose=${p.id}`)}
              />
            ))}
          </div>
        )
      ) : (
        community.length === 0 ? (
          <div className="text-center py-12 text-gray-600">
            <Globe className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No public personas yet. Be the first to share one!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {community.map((p) => (
              <PersonaCard key={p.id} persona={p} isOwn={false} onFork={() => fork(p.id)} />
            ))}
          </div>
        )
      )}
    </div>
  )
}
