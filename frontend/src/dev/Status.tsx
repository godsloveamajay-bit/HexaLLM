import { useEffect, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { api, baseURL } from '../lib/api'

export default function Status() {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null)
  const [variantCount, setVariantCount] = useState<number | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    const t0 = performance.now()
    try {
      const h = await fetch(`${baseURL}/health`)
      setHealth(await h.json())
      setLatency(Math.round(performance.now() - t0))
      const v = await api.get('/models/hexallm/variants')
      setVariantCount(Array.isArray(v.data) ? v.data.length : v.data?.variants?.length ?? 0)
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'failed')
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Activity size={18} style={{ color: '#4ade80' }} />
        <div className="flex-1">
          <h1 className="font-mono font-bold text-lg" style={{ color: '#e6edf3' }}>status</h1>
          <p className="font-mono text-xs" style={{ color: '#8b949e' }}>backend + ollama health, polled every 8s</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 font-mono text-xs px-2 py-1 rounded border transition-colors hover:bg-[#161b22]"
          style={{ borderColor: '#30363d', color: '#8b949e' }}
        >
          <RefreshCw size={12} /> refresh
        </button>
      </div>

      {error && (
        <div className="font-mono text-xs p-3 rounded-lg border mb-4" style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#f87171', background: 'rgba(248,113,113,0.06)' }}>
          ✗ {error}
        </div>
      )}

      {health && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'backend', value: String(health.status ?? '?'), ok: health.status === 'ok' },
            { label: 'version', value: String(health.version ?? '?'), ok: true },
            { label: 'ollama', value: String(health.ollama ?? '?'), ok: health.ollama === 'connected' },
            { label: 'api latency', value: latency !== null ? `${latency} ms` : '—', ok: true },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border p-3" style={{ borderColor: '#30363d', background: '#161b22' }}>
              <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: '#8b949e' }}>{k.label}</div>
              <div className="font-mono text-lg font-bold flex items-center gap-2" style={{ color: k.ok ? '#4ade80' : '#f87171' }}>
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: k.ok ? '#4ade80' : '#f87171' }} />
                {k.value}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#30363d', background: '#161b22' }}>
        <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: '#30363d' }}>
          <span className="font-mono text-xs font-semibold" style={{ color: '#e6edf3' }}>raw /health payload</span>
          {variantCount !== null && (
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ color: '#8b949e', background: '#0d1117' }}>
              {variantCount} virtual models
            </span>
          )}
        </div>
        <pre className="font-mono text-xs p-4 overflow-x-auto whitespace-pre-wrap" style={{ background: '#0d1117', color: '#e6edf3' }}>
          {health ? JSON.stringify(health, null, 2) : '…'}
        </pre>
      </div>
    </div>
  )
}
