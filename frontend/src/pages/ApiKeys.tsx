import { useEffect, useState } from 'react'
import { Key, Plus, Trash2, Copy, Check, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { clsx } from 'clsx'

interface APIKey {
  id: number; name: string; key: string; is_active: boolean;
  created_at: string; last_used_at?: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<APIKey[]>([])
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<APIKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState<Record<number, boolean>>({})

  useEffect(() => {
    api.get('/auth/api-keys').then(({ data }) => setKeys(data)).catch(() => {})
  }, [])

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      const { data } = await api.post('/auth/api-keys', { name })
      setNewKey(data)
      setKeys((k) => [data, ...k])
      setName('')
      toast.success('API key created!')
    } catch {
      toast.error('Failed to create key')
    } finally { setCreating(false) }
  }

  const deleteKey = async (id: number) => {
    if (!confirm('Delete this API key? Any apps using it will stop working.')) return
    await api.delete(`/auth/api-keys/${id}`)
    setKeys((k) => k.filter((x) => x.id !== id))
    toast.success('Key deleted')
  }

  const copyKey = async (key: string) => {
    await navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const mask = (key: string) => key.slice(0, 6) + '•'.repeat(20) + key.slice(-4)

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">API Keys</h1>
        <p className="text-gray-400 mt-1">Use API keys to authenticate from your applications</p>
      </div>

      {/* New key banner */}
      {newKey && (
        <div className="card border-primary-700 bg-primary-900/10 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-100">Save your new API key</p>
              <p className="text-sm text-gray-400 mb-3">This is the only time it will be shown in full.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-950 rounded-lg px-3 py-2 text-sm text-primary-300 font-mono break-all">
                  {newKey.key}
                </code>
                <button onClick={() => copyKey(newKey.key)} className="btn-secondary flex-shrink-0">
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button onClick={() => setNewKey(null)} className="btn-ghost p-1 flex-shrink-0 text-gray-500">✕</button>
          </div>
        </div>
      )}

      {/* Create form */}
      <div className="card mb-6">
        <h2 className="text-base font-semibold text-gray-100 mb-4">Create New Key</h2>
        <form onSubmit={createKey} className="flex gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. My App, CI/CD)"
            className="input flex-1"
            required
          />
          <button type="submit" disabled={creating || !name.trim()} className="btn-primary flex-shrink-0">
            <Plus className="w-4 h-4" /> Create
          </button>
        </form>
      </div>

      {/* Keys list */}
      <div className="card p-0 overflow-hidden overflow-x-auto">
        {keys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-600">
            <Key className="w-10 h-10 mb-3" />
            <p className="font-medium">No API keys yet</p>
            <p className="text-sm mt-1">Create one above to get started</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                {['Name', 'Key', 'Created', 'Last Used', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                      <span className="font-medium text-gray-200">{k.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="font-mono text-xs text-gray-400">
                      {revealed[k.id] ? k.key : mask(k.key)}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{format(new Date(k.created_at), 'MMM d, yyyy')}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {k.last_used_at ? format(new Date(k.last_used_at), 'MMM d, yyyy') : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setRevealed((r) => ({ ...r, [k.id]: !r[k.id] }))} className="btn-ghost p-1.5" title="Toggle visibility">
                        {revealed[k.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => copyKey(k.key)} className="btn-ghost p-1.5" title="Copy">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteKey(k.id)} className="btn-ghost p-1.5 text-red-500 hover:text-red-400" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-6 card bg-gray-900/30">
        <h3 className="text-sm font-medium text-gray-100 mb-2">Usage Example</h3>
        <pre className="text-xs text-gray-400 font-mono overflow-x-auto">{`curl -X POST http://localhost:8000/api/v1/chat/completions \\
  -H "Authorization: Bearer nai_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "llama3.2:3b", "messages": [{"role": "user", "content": "Hello!"}]}'`}</pre>
      </div>
    </div>
  )
}
