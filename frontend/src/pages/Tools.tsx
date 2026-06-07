import { useEffect, useState } from 'react'
import {
  Wrench, Sparkles, Check, X, Trash2, Play, Pencil, Save, ShieldCheck,
  ChevronDown, ChevronRight, Loader2, AlertTriangle, Power,
} from 'lucide-react'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import py from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import api from '../lib/api'
import { loadModelOptions, defaultModelValue, ModelOption } from '../lib/models'
import { useAuth } from '../store/auth'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'

SyntaxHighlighter.registerLanguage('python', py)

interface Tool {
  id: number; name: string; description: string; input_description: string
  code: string; prompt: string; status: 'pending' | 'approved' | 'rejected'
  enabled: boolean; run_count: number; last_error?: string | null
  created_at: string; approved_at?: string | null
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-900/40 text-amber-300',
  approved: 'bg-green-900/40 text-green-300',
  rejected: 'bg-gray-800 text-gray-500',
}

export default function ToolsPage() {
  const { user } = useAuth()
  const [tools, setTools] = useState<Tool[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [generating, setGenerating] = useState(false)

  const load = () => api.get('/tools').then(({ data }) => setTools(data)).catch(() => {})
  useEffect(() => {
    load()
    loadModelOptions(!!user?.is_admin).then((opts) => {
      setModels(opts)
      setModel(defaultModelValue(opts))
    }).catch(() => {})
  }, [user])

  const generate = async () => {
    if (!prompt.trim()) return
    setGenerating(true)
    try {
      const { data } = await api.post('/tools/generate', { prompt: prompt.trim(), model })
      setTools((t) => [data, ...t])
      setPrompt('')
      toast.success(`Drafted “${data.name}” — review and approve it below`)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Generation failed')
    } finally { setGenerating(false) }
  }

  const patch = async (id: number, body: Partial<Tool>) => {
    const { data } = await api.patch(`/tools/${id}`, body)
    setTools((t) => t.map((x) => (x.id === id ? data : x)))
    return data
  }
  const act = async (id: number, action: 'approve' | 'reject') => {
    try {
      const { data } = await api.post(`/tools/${id}/${action}`)
      setTools((t) => t.map((x) => (x.id === id ? data : x)))
      toast.success(action === 'approve' ? 'Approved — now available in Agents' : 'Rejected')
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
  }
  const remove = async (id: number) => {
    if (!confirm('Delete this tool?')) return
    await api.delete(`/tools/${id}`)
    setTools((t) => t.filter((x) => x.id !== id))
  }

  const approvedCount = tools.filter((t) => t.status === 'approved' && t.enabled).length

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
          <Wrench className="w-6 h-6 text-primary-400" /> AI Tools
        </h1>
        <p className="text-gray-400 mt-1">
          The AI writes its own tools — you review, test and approve them. Approved tools become selectable in Agents and run inside the sandbox.
        </p>
      </div>

      {/* Generate */}
      <div className="card mb-6">
        <h2 className="text-base font-semibold text-gray-100 mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary-400" /> Describe a tool
        </h2>
        <textarea
          value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Convert a temperature between Celsius and Fahrenheit. Input: JSON like {&quot;value&quot;: 100, &quot;to&quot;: &quot;F&quot;}."
          rows={3} className="input w-full resize-y" />
        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
          <select value={model} onChange={(e) => setModel(e.target.value)} className="input max-w-[220px]">
            {models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <button onClick={generate} disabled={generating || !prompt.trim() || !model} className="btn-primary">
            {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Writing…</> : <><Sparkles className="w-4 h-4" /> Generate tool</>}
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-2 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
          Generated code never runs until you approve it — and even then only inside the isolated sandbox.
        </p>
      </div>

      {approvedCount > 0 && (
        <p className="text-sm text-gray-500 mb-3">
          <b className="text-green-400">{approvedCount}</b> approved tool{approvedCount !== 1 ? 's' : ''} available to your agents.
        </p>
      )}

      {/* Tools */}
      {tools.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-gray-600">
          <Wrench className="w-10 h-10 mb-3" />
          <p className="font-medium">No tools yet</p>
          <p className="text-sm mt-1">Describe one above and let the AI write it.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tools.map((t) => (
            <ToolCard key={t.id} tool={t} onPatch={patch} onAct={act} onRemove={remove} onChange={load} />
          ))}
        </div>
      )}
    </div>
  )
}

function ToolCard({ tool, onPatch, onAct, onRemove }: {
  tool: Tool
  onPatch: (id: number, body: Partial<Tool>) => Promise<Tool>
  onAct: (id: number, action: 'approve' | 'reject') => Promise<void>
  onRemove: (id: number) => Promise<void>
  onChange: () => void
}) {
  const [open, setOpen] = useState(tool.status === 'pending')
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState(tool.code)
  const [testInput, setTestInput] = useState('')
  const [testOut, setTestOut] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setCode(tool.code) }, [tool.code])

  const saveCode = async () => {
    setSaving(true)
    try { await onPatch(tool.id, { code }); setEditing(false); toast.success('Saved') }
    catch (e: any) { toast.error(e?.response?.data?.detail || 'Invalid code') }
    finally { setSaving(false) }
  }
  const runTest = async () => {
    setRunning(true); setTestOut(null)
    try {
      const { data } = await api.post(`/tools/${tool.id}/test`, { input: testInput })
      setTestOut(data.output)
    } catch (e: any) { setTestOut(e?.response?.data?.detail || 'Test failed') }
    finally { setRunning(false) }
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-primary-300 font-semibold">{tool.name}</code>
            <span className={clsx('badge', STATUS_BADGE[tool.status])}>{tool.status}</span>
            {tool.status === 'approved' && (
              <button onClick={() => onPatch(tool.id, { enabled: !tool.enabled })}
                className={clsx('badge inline-flex items-center gap-1', tool.enabled ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-500')}
                title={tool.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}>
                <Power className="w-3 h-3" /> {tool.enabled ? 'enabled' : 'disabled'}
              </button>
            )}
            {tool.run_count > 0 && <span className="text-xs text-gray-600">{tool.run_count} runs</span>}
          </div>
          <p className="text-sm text-gray-300 mt-1.5">{tool.description}</p>
          {tool.input_description && <p className="text-xs text-gray-500 mt-1">Input: {tool.input_description}</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {tool.status === 'pending' && (
            <button onClick={() => onAct(tool.id, 'approve')} className="btn-primary py-1.5 px-3 text-sm" title="Approve">
              <Check className="w-4 h-4" /> Approve
            </button>
          )}
          {tool.status !== 'rejected' && (
            <button onClick={() => onAct(tool.id, 'reject')} className="btn-ghost p-1.5 text-gray-400" title="Reject">
              <X className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => onRemove(tool.id)} className="btn-ghost p-1.5 text-red-500 hover:text-red-400" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {tool.last_error && (
        <div className="mt-2 text-xs text-red-400 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span className="break-words">Last run failed: {tool.last_error.slice(0, 200)}</span>
        </div>
      )}

      <button onClick={() => setOpen((o) => !o)} className="mt-3 text-sm text-gray-400 hover:text-gray-200 flex items-center gap-1">
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} Code & test
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Code */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">Implementation</span>
              {editing ? (
                <div className="flex gap-1">
                  <button onClick={saveCode} disabled={saving} className="btn-secondary py-1 px-2 text-xs">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                  </button>
                  <button onClick={() => { setCode(tool.code); setEditing(false) }} className="btn-ghost py-1 px-2 text-xs">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setEditing(true)} className="btn-ghost py-1 px-2 text-xs"><Pencil className="w-3 h-3" /> Edit</button>
              )}
            </div>
            {editing ? (
              <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={Math.min(20, code.split('\n').length + 1)}
                className="input w-full font-mono text-xs resize-y" spellCheck={false} />
            ) : (
              <div className="rounded-lg overflow-hidden text-xs">
                <SyntaxHighlighter language="python" style={oneDark} customStyle={{ margin: 0, background: '#0b0b0c', fontSize: '0.75rem' }}>
                  {tool.code}
                </SyntaxHighlighter>
              </div>
            )}
          </div>

          {/* Test */}
          <div>
            <span className="text-xs text-gray-500">Test in sandbox</span>
            <div className="flex gap-2 mt-1">
              <input value={testInput} onChange={(e) => setTestInput(e.target.value)}
                placeholder="input string (e.g. {&quot;n&quot;: 5})" className="input flex-1 font-mono text-xs" />
              <button onClick={runTest} disabled={running} className="btn-secondary flex-shrink-0">
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run
              </button>
            </div>
            {testOut != null && (
              <pre className="mt-2 bg-gray-950 rounded-lg p-3 text-xs text-gray-300 font-mono whitespace-pre-wrap break-words max-h-48 overflow-auto">{testOut}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
