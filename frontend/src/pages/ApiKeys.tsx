import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Key, Plus, Trash2, Copy, Check, AlertTriangle, Activity, Boxes, Terminal } from 'lucide-react'
import api from '../lib/api'
import { chatCapableModels } from '../lib/models'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { clsx } from 'clsx'

interface APIKey {
  id: number; name: string; key: string; is_active: boolean
  persona_id?: number | null; persona_name?: string | null; model_name?: string | null
  request_count: number; prompt_tokens: number; completion_tokens: number
  created_at: string; last_used_at?: string
}
interface Persona { id: number; name: string; emoji?: string; base_model: string }

// Public OpenAI-compatible base URL. The clean /v1 path needs an nginx route;
// /api/v1/openai is always proxied, so we advertise that — it works with any
// OpenAI client out of the box.
const apiBase = `${window.location.origin}/api/v1/openai`

function snippets(key: string, model: string) {
  const m = model || 'llama3:8b'
  return {
    curl: `curl ${apiBase}/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${m}", "messages": [{"role": "user", "content": "Hello!"}]}'`,
    python: `from openai import OpenAI

client = OpenAI(base_url="${apiBase}", api_key="${key}")

resp = client.chat.completions.create(
    model="${m}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(resp.choices[0].message.content)`,
    js: `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${apiBase}", apiKey: "${key}" });

const resp = await client.chat.completions.create({
  model: "${m}",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(resp.choices[0].message.content);`,
  }
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  return (
    <div className="relative group">
      <pre className="text-xs text-gray-300 font-mono bg-gray-950 rounded-lg p-3 overflow-x-auto whitespace-pre">{code}</pre>
      <button onClick={copy} className="absolute top-2 right-2 btn-ghost p-1.5 opacity-70 hover:opacity-100">
        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<APIKey[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [models, setModels] = useState<string[]>([])
  const [name, setName] = useState('')
  const [expose, setExpose] = useState('')          // '' | persona:<id> | model:<name>
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<APIKey | null>(null)
  const [tab, setTab] = useState<'curl' | 'python' | 'js'>('python')
  const [params, setParams] = useSearchParams()

  const load = () => api.get('/auth/api-keys').then(({ data }) => setKeys(data)).catch(() => {})
  useEffect(() => {
    load()
    api.get('/personas').then(({ data }) => setPersonas(data)).catch(() => {})
    api.get('/models/ollama/list').then(({ data }) =>
      setModels(chatCapableModels(data.models?.map((m: any) => m.name) || []))).catch(() => {})
  }, [])

  // Deep-link from the Personas page: /api-keys?expose=<personaId>
  useEffect(() => {
    const p = params.get('expose')
    if (p && personas.some((x) => String(x.id) === p)) {
      setExpose(`persona:${p}`)
      const persona = personas.find((x) => String(x.id) === p)
      if (persona && !name) setName(`${persona.name} API`)
      params.delete('expose'); setParams(params, { replace: true })
    }
  }, [personas])

  const newKeyModel = useMemo(() => newKey?.model_name || models[0] || 'llama3:8b', [newKey, models])

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      const body: any = { name }
      if (expose.startsWith('persona:')) body.persona_id = +expose.slice(8)
      else if (expose.startsWith('model:')) body.model = expose.slice(6)
      const { data } = await api.post('/auth/api-keys', body)
      setNewKey(data)
      setKeys((k) => [data, ...k])
      setName(''); setExpose('')
      toast.success('API key created')
    } catch {
      toast.error('Failed to create key')
    } finally { setCreating(false) }
  }

  const deleteKey = async (id: number) => {
    if (!confirm('Delete this API key? Any apps using it will stop working.')) return
    await api.delete(`/auth/api-keys/${id}`)
    setKeys((k) => k.filter((x) => x.id !== id))
    if (newKey?.id === id) setNewKey(null)
    toast.success('Key deleted')
  }

  const copy = async (s: string) => { await navigator.clipboard.writeText(s); toast.success('Copied') }
  const mask = (key: string) => key.slice(0, 7) + '••••••••' + key.slice(-4)
  const exposesLabel = (k: APIKey) =>
    k.persona_name ? `${k.persona_name}` : k.model_name ? k.model_name : 'Any model'

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">API Keys</h1>
        <p className="text-gray-400 mt-1">Expose your models and personas as an OpenAI-compatible API. Point any OpenAI client at NebulaX.</p>
      </div>

      {/* New key banner with ready-to-use snippets */}
      {newKey && (
        <div className="card border-primary-700 bg-primary-900/10 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-100">Save your new API key</p>
              <p className="text-sm text-gray-400 mb-3">This is the only time the full key is shown.</p>
              <div className="flex items-center gap-2 mb-4">
                <code className="flex-1 bg-gray-950 rounded-lg px-3 py-2 text-sm text-primary-300 font-mono break-all">{newKey.key}</code>
                <button onClick={() => copy(newKey.key)} className="btn-secondary flex-shrink-0"><Copy className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center gap-2 mb-2 text-xs">
                <span className="text-gray-500">Endpoint:</span>
                <code className="text-gray-300 font-mono">{apiBase}</code>
                {newKey.model_name && <span className="badge bg-gray-800 text-gray-400 ml-1">model: {newKey.model_name}</span>}
              </div>
              <div className="flex gap-1 mb-2">
                {(['python', 'js', 'curl'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)}
                    className={clsx('px-2.5 py-1 rounded text-xs', tab === t ? 'bg-primary-900/50 text-primary-300' : 'text-gray-500 hover:text-gray-300')}>
                    {t === 'js' ? 'Node' : t === 'curl' ? 'curl' : 'Python'}
                  </button>
                ))}
              </div>
              <CodeBlock code={snippets(newKey.key, newKeyModel)[tab]} />
            </div>
            <button onClick={() => setNewKey(null)} className="btn-ghost p-1 flex-shrink-0 text-gray-500">✕</button>
          </div>
        </div>
      )}

      {/* Create form */}
      <div className="card mb-6">
        <h2 className="text-base font-semibold text-gray-100 mb-4">Create a key</h2>
        <form onSubmit={createKey} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div>
            <label className="label">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My App" className="input w-full" required />
          </div>
          <div>
            <label className="label">Expose</label>
            <select value={expose} onChange={(e) => setExpose(e.target.value)} className="input w-full">
              <option value="">Any model (caller chooses)</option>
              {personas.length > 0 && (
                <optgroup label="Personas">
                  {personas.map((p) => <option key={p.id} value={`persona:${p.id}`}>{p.emoji || '🤖'} {p.name}</option>)}
                </optgroup>
              )}
              {models.length > 0 && (
                <optgroup label="Models">
                  {models.map((m) => <option key={m} value={`model:${m}`}>{m}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <button type="submit" disabled={creating || !name.trim()} className="btn-primary flex-shrink-0 h-[42px]">
            <Plus className="w-4 h-4" /> Create
          </button>
        </form>
        <p className="text-xs text-gray-600 mt-2">
          Bind a key to a persona and callers automatically get its model, system prompt and temperature — no setup on their end.
        </p>
      </div>

      {/* Keys list */}
      <div className="card p-0 overflow-hidden overflow-x-auto">
        {keys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-600">
            <Key className="w-10 h-10 mb-3" />
            <p className="font-medium">No API keys yet</p>
            <p className="text-sm mt-1">Create one above to expose a model</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                {['Name', 'Exposes', 'Key', 'Usage', 'Last used', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', k.is_active ? 'bg-green-500' : 'bg-gray-600')} />
                      <span className="font-medium text-gray-200">{k.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 badge bg-gray-800 text-gray-300">
                      {k.persona_name ? <Boxes className="w-3 h-3" /> : <Terminal className="w-3 h-3" />}
                      {exposesLabel(k)}
                    </span>
                  </td>
                  <td className="px-4 py-3"><code className="font-mono text-xs text-gray-500">{mask(k.key)}</code></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-gray-400" title={`${k.prompt_tokens + k.completion_tokens} tokens`}>
                      <Activity className="w-3.5 h-3.5 text-gray-600" />
                      {k.request_count.toLocaleString()} req · {(k.prompt_tokens + k.completion_tokens).toLocaleString()} tok
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {k.last_used_at ? format(new Date(k.last_used_at), 'MMM d, HH:mm') : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => copy(k.key)} className="btn-ghost p-1.5" title="Copy key"><Copy className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deleteKey(k.id)} className="btn-ghost p-1.5 text-red-500 hover:text-red-400" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
