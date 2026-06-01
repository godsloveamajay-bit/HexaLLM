import { useState, useEffect, useRef } from 'react'
import { Plus, Play, Trash2, Pencil, Loader2, Clock, CheckCircle2, XCircle, Zap, Bot } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

interface Workflow {
  id: number
  name: string
  description: string | null
  task: string
  model: string
  tools: string[]
  system_prompt: string | null
  max_steps: number
  schedule: string | null
  is_active: boolean
  run_count: number
  last_run_at: string | null
  last_result: string | null
  last_error: string | null
  created_at: string
}

const AVAILABLE_TOOLS = ['web_search', 'code_exec', 'read_file', 'write_file']

const SCHEDULE_PRESETS = [
  { label: 'Manual only', value: 'manual' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Every Monday', value: '0 9 * * 1' },
]

function WorkflowForm({ initial, ollamaModels, onSave, onCancel }: {
  initial?: Partial<Workflow>
  ollamaModels: string[]
  onSave: (data: any) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    task: initial?.task || '',
    model: initial?.model || (ollamaModels[0] || 'llama3:8B'),
    tools: initial?.tools || ['web_search'],
    system_prompt: initial?.system_prompt || '',
    max_steps: initial?.max_steps ?? 10,
    schedule: initial?.schedule || 'manual',
    is_active: initial?.is_active ?? true,
  })
  const [saving, setSaving] = useState(false)

  const toggleTool = (t: string) =>
    setForm((f) => ({ ...f, tools: f.tools.includes(t) ? f.tools.filter((x) => x !== t) : [...f.tools, t] }))

  const submit = async () => {
    if (!form.name.trim() || !form.task.trim()) { toast.error('Name and task required'); return }
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Name *</label>
          <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Daily news digest" />
        </div>
        <div>
          <label className="label">Model</label>
          <select className="input" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}>
            {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Task *</label>
        <textarea className="input resize-none" rows={3} value={form.task}
          onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
          placeholder="Search for today's top AI news and write a brief summary..." />
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Schedule</label>
          <select className="input" value={form.schedule}
            onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}>
            {SCHEDULE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Max Steps: {form.max_steps}</label>
          <input type="range" min={3} max={20} value={form.max_steps}
            onChange={(e) => setForm((f) => ({ ...f, max_steps: +e.target.value }))}
            className="w-full mt-2 accent-primary-500" />
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={submit} disabled={saving} className="btn-primary flex-1 justify-center">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Save Workflow
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [ollamaModels, setOllamaModels] = useState<string[]>(['llama3:8B'])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Workflow | null>(null)
  const [running, setRunning] = useState<Set<number>>(new Set())
  // run_count at the moment each workflow was triggered → detect completion.
  const runBaseline = useRef<Map<number, number>>(new Map())

  const load = async () => {
    try {
      const [wfRes, modRes] = await Promise.allSettled([
        api.get('/workflows'),
        api.get('/models/ollama/list'),
      ])
      if (wfRes.status === 'fulfilled') setWorkflows(wfRes.value.data)
      if (modRes.status === 'fulfilled') {
        const names = modRes.value.data.models?.map((m: any) => m.name) || []
        if (names.length) setOllamaModels(names)
      }
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  // While any workflow is running, poll until each one's run_count increments
  // (= the background agent finished), then surface the result.
  useEffect(() => {
    if (running.size === 0) return
    const iv = setInterval(async () => {
      try {
        const { data } = await api.get('/workflows')
        setWorkflows(data)
        setRunning((cur) => {
          const next = new Set(cur)
          for (const id of cur) {
            const wf = data.find((w: Workflow) => w.id === id)
            if (wf && wf.run_count > (runBaseline.current.get(id) ?? 0)) {
              next.delete(id)
              runBaseline.current.delete(id)
              if (wf.last_error) toast.error(`"${wf.name}" failed`)
              else toast.success(`"${wf.name}" finished`)
            }
          }
          return next
        })
      } catch {}
    }, 4000)
    return () => clearInterval(iv)
  }, [running])

  const save = async (data: any) => {
    if (editing) {
      await api.patch(`/workflows/${editing.id}`, data)
      toast.success('Workflow updated')
    } else {
      await api.post('/workflows', data)
      toast.success('Workflow created')
    }
    setShowForm(false)
    setEditing(null)
    load()
  }

  const del = async (id: number) => {
    if (!confirm('Delete this workflow?')) return
    await api.delete(`/workflows/${id}`)
    setWorkflows((w) => w.filter((x) => x.id !== id))
    toast.success('Deleted')
  }

  const run = async (id: number) => {
    // Remember the run_count now; the poller marks it done when this increments.
    // (Agent runs take minutes on CPU, so we keep "running" until then.)
    const wf = workflows.find((w) => w.id === id)
    runBaseline.current.set(id, wf?.run_count ?? 0)
    setRunning((s) => new Set(s).add(id))
    try {
      await api.post(`/workflows/${id}/run`)
      toast.success('Workflow started — running in background…')
    } catch {
      toast.error('Failed to trigger')
      setRunning((s) => { const next = new Set(s); next.delete(id); return next })
      runBaseline.current.delete(id)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <Zap className="w-6 h-6 text-primary-400" /> Workflows
          </h1>
          <p className="text-gray-400 mt-1">Automate tasks with scheduled or manual agent runs.</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary flex-shrink-0 gap-1.5">
          <Plus className="w-4 h-4" /> New Workflow
        </button>
      </div>

      {showForm && (
        <div className="card mb-6">
          <h2 className="font-semibold text-gray-100 mb-4">{editing ? 'Edit Workflow' : 'New Workflow'}</h2>
          <WorkflowForm
            initial={editing || undefined}
            ollamaModels={ollamaModels}
            onSave={save}
            onCancel={() => { setShowForm(false); setEditing(null) }}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
        </div>
      ) : workflows.length === 0 ? (
        <div className="text-center py-12 text-gray-600">
          <Zap className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No workflows yet. Create one to automate agent tasks.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map((wf) => (
            <div key={wf.id} className="card">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-100">{wf.name}</h3>
                    <span className={clsx('badge text-xs', wf.is_active ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-500')}>
                      {wf.is_active ? 'active' : 'paused'}
                    </span>
                    <span className="badge bg-gray-800 text-gray-500 text-xs">
                      <Clock className="w-3 h-3 mr-1" />
                      {SCHEDULE_PRESETS.find((p) => p.value === wf.schedule)?.label || wf.schedule || 'manual'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 truncate">{wf.task}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-xs text-gray-600">{wf.model}</span>
                    {wf.tools.map((t) => <span key={t} className="badge bg-primary-900/20 text-primary-500 text-xs">{t.replace('_', ' ')}</span>)}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => run(wf.id)} disabled={running.has(wf.id)} className="btn-primary text-sm gap-1">
                    {running.has(wf.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    Run
                  </button>
                  <button onClick={() => { setEditing(wf); setShowForm(true) }} className="btn-secondary text-sm"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => del(wf.id)} className="btn-secondary text-sm text-red-400 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>

              {(wf.last_result || wf.last_error) && (
                <div className={clsx('mt-3 p-2.5 rounded-lg text-xs', wf.last_error ? 'bg-red-900/10 border border-red-800/40 text-red-300' : 'bg-gray-800/60 text-gray-400')}>
                  {wf.last_error ? (
                    <span className="flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5" /> {wf.last_error}</span>
                  ) : (
                    <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> {wf.last_result}</span>
                  )}
                </div>
              )}

              <div className="mt-2 text-xs text-gray-600">
                {wf.run_count} runs{wf.last_run_at ? ` · last ${formatDistanceToNow(new Date(wf.last_run_at), { addSuffix: true })}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
