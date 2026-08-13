import { useState } from 'react'
import { Play, Braces, Copy, Check } from 'lucide-react'
import { api } from '../lib/api'

const ENDPOINTS = [
  { id: 'health', label: 'GET /health', method: 'GET', path: '/health', body: '' },
  { id: 'variants', label: 'GET /models/hexallm/variants', method: 'GET', path: '/models/hexallm/variants', body: '' },
  { id: 'ollama', label: 'GET /models/ollama', method: 'GET', path: '/models/ollama', body: '' },
  {
    id: 'chat',
    label: 'POST /chat/completions',
    method: 'POST',
    path: '/chat/completions',
    body: JSON.stringify(
      {
        model: 'hex-4.2-turbo',
        messages: [{ role: 'user', content: 'hello — who are you?' }],
        stream: false,
        temperature: 0.7,
      },
      null,
      2
    ),
  },
]

const STYLE = {
  panel: { background: '#161b22', borderColor: '#30363d' },
  input: { background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' },
}

export default function ApiExplorer() {
  const [active, setActive] = useState(ENDPOINTS[0].id)
  const [body, setBody] = useState(ENDPOINTS[0].body)
  const [resp, setResp] = useState<string | null>(null)
  const [status, setStatus] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const ep = ENDPOINTS.find((e) => e.id === active)!

  const select = (id: string) => {
    const next = ENDPOINTS.find((e) => e.id === id)!
    setActive(id)
    setBody(next.body)
    setResp(null)
    setStatus(null)
  }

  const run = async () => {
    setLoading(true)
    setResp(null)
    setStatus(null)
    try {
      let r
      if (ep.method === 'GET') {
        r = await api.get(ep.path)
      } else {
        let parsed: unknown
        try { parsed = JSON.parse(body) } catch { parsed = undefined }
        r = await api.post(ep.path, parsed)
      }
      setStatus(r.status)
      setResp(JSON.stringify(r.data, null, 2))
    } catch (e: any) {
      setStatus(e?.response?.status ?? 0)
      setResp(JSON.stringify(e?.response?.data ?? { error: e?.message }, null, 2))
    } finally {
      setLoading(false)
    }
  }

  const curl = () => {
    const token = localStorage.getItem('token')
    const auth = token ? `  -H "Authorization: Bearer ${token}" \\\n` : ''
    const data = ep.method === 'POST' ? `  -H "Content-Type: application/json" \\\n  -d '${body.replace(/\n\s*/g, ' ')}' \\\n` : ''
    return `curl -s "${window.location.origin}/api/v1${ep.path}" \\\n${auth}${data}  -X ${ep.method}`
  }

  const copyCurl = async () => {
    await navigator.clipboard.writeText(curl())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Braces size={18} style={{ color: '#4ade80' }} />
        <div>
          <h1 className="font-mono font-bold text-lg" style={{ color: '#e6edf3' }}>api explorer</h1>
          <p className="font-mono text-xs" style={{ color: '#8b949e' }}>
            hit the backend directly — every response comes back as raw JSON
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-lg border overflow-hidden" style={STYLE.panel}>
          <div className="p-3 flex flex-wrap gap-1.5 border-b" style={{ borderColor: '#30363d' }}>
            {ENDPOINTS.map((e) => (
              <button
                key={e.id}
                onClick={() => select(e.id)}
                className="font-mono text-xs px-2.5 py-1.5 rounded transition-colors"
                style={
                  active === e.id
                    ? { color: '#0d1117', background: '#4ade80', fontWeight: 700 }
                    : { color: '#8b949e', background: '#0d1117', border: '1px solid #30363d' }
                }
              >
                {e.label}
              </button>
            ))}
          </div>
          <div className="p-3 space-y-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest mb-1" style={{ color: '#8b949e' }}>
                {ep.method === 'GET' ? 'request' : 'request body (json)'}
              </div>
              {ep.method === 'GET' ? (
                <div className="font-mono text-sm px-3 py-2 rounded border" style={STYLE.input}>
                  GET /api/v1{ep.path}
                </div>
              ) : (
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  spellCheck={false}
                  className="w-full font-mono text-xs p-3 rounded border outline-none focus:border-[#4ade80] resize-y"
                  style={STYLE.input}
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={run}
                disabled={loading}
                className="flex items-center gap-2 font-mono text-sm px-4 py-2 rounded font-semibold disabled:opacity-40"
                style={{ background: '#4ade80', color: '#0d1117' }}
              >
                <Play size={14} /> {loading ? 'sending…' : 'send'}
              </button>
              <button
                onClick={copyCurl}
                className="flex items-center gap-2 font-mono text-xs px-3 py-2 rounded border transition-colors hover:bg-[#0d1117]"
                style={{ borderColor: '#30363d', color: '#8b949e' }}
              >
                {copied ? <Check size={13} style={{ color: '#4ade80' }} /> : <Copy size={13} />}
                {copied ? 'copied' : 'copy curl'}
              </button>
            </div>
            <pre
              className="font-mono text-xs p-3 rounded border overflow-x-auto whitespace-pre-wrap"
              style={{ background: '#010409', borderColor: '#30363d', color: '#4ade80' }}
            >
              {curl()}
            </pre>
          </div>
        </div>

        <div className="rounded-lg border overflow-hidden flex flex-col" style={STYLE.panel}>
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: '#30363d' }}>
            <span className="font-mono text-xs font-semibold" style={{ color: '#e6edf3' }}>response</span>
            {status !== null && (
              <span
                className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  color: status < 400 ? '#4ade80' : '#f87171',
                  background: 'rgba(74,222,128,0.08)',
                }}
              >
                HTTP {status}
              </span>
            )}
          </div>
          <pre
            className="flex-1 font-mono text-xs p-4 overflow-auto min-h-[420px] whitespace-pre-wrap"
            style={{ background: '#0d1117', color: '#e6edf3' }}
          >
            {resp ?? (loading ? '…' : '— send a request —')}
          </pre>
        </div>
      </div>
    </div>
  )
}
