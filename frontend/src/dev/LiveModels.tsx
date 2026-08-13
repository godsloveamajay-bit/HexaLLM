import { useEffect, useState } from 'react'
import { Server, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'

type RawModel = {
  name: string
  size?: number
  details?: { family?: string; parameter_size?: string; quantization_level?: string }
}

export default function LiveModels() {
  const [models, setModels] = useState<RawModel[] | null>(null)
  const [health, setHealth] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const h = await api.get('/health')
      setHealth(h.data?.ollama ?? 'unknown')
      const m = await api.get('/models/ollama')
      setModels(m.data?.models ?? [])
      setError(null)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'failed to load')
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [])

  const fmtSize = (bytes?: number) => {
    if (!bytes) return '—'
    const gb = bytes / 1024 / 1024 / 1024
    return `${gb.toFixed(1)} GB`
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Server size={18} style={{ color: '#4ade80' }} />
        <div className="flex-1">
          <h1 className="font-mono font-bold text-lg" style={{ color: '#e6edf3' }}>live models</h1>
          <p className="font-mono text-xs" style={{ color: '#8b949e' }}>
            raw ollama registry on the host — refreshes every 6s
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs">
          <span
            className="px-2 py-1 rounded"
            style={{
              color: health === 'connected' ? '#4ade80' : '#fbbf24',
              background: health === 'connected' ? 'rgba(74,222,128,0.08)' : 'rgba(251,191,36,0.08)',
            }}
          >
            ollama: {health ?? '…'}
          </span>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-2 py-1 rounded border transition-colors hover:bg-[#161b22]"
            style={{ borderColor: '#30363d', color: '#8b949e' }}
          >
            <RefreshCw size={12} /> refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="font-mono text-xs p-3 rounded-lg border mb-4" style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#f87171', background: 'rgba(248,113,113,0.06)' }}>
          ✗ {error}
        </div>
      )}

      {models === null && !error ? (
        <div className="font-mono text-sm" style={{ color: '#6e7681' }}>loading…</div>
      ) : !models || models.length === 0 ? (
        <div className="rounded-lg border p-8 flex flex-col items-center gap-2 font-mono text-sm" style={{ borderColor: '#30363d', background: '#161b22', color: '#8b949e' }}>
          <Server size={20} />
          <span>no raw models visible</span>
          <span className="text-xs" style={{ color: '#6e7681' }}>
            raw ollama access is reserved for admins and Hyper+ plans — sign in with an admin account to see the full registry
          </span>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#30363d', background: '#161b22' }}>
          <table className="w-full font-mono text-[13px]">
            <thead>
              <tr className="text-left border-b" style={{ borderColor: '#30363d', color: '#8b949e' }}>
                <th className="px-3 py-2 font-medium text-[11px] uppercase tracking-widest">model</th>
                <th className="px-3 py-2 font-medium text-[11px] uppercase tracking-widest">family</th>
                <th className="px-3 py-2 font-medium text-[11px] uppercase tracking-widest">params</th>
                <th className="px-3 py-2 font-medium text-[11px] uppercase tracking-widest">quant</th>
                <th className="px-3 py-2 font-medium text-[11px] uppercase tracking-widest text-right">size</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.name} className="border-b last:border-0" style={{ borderColor: '#21262d' }}>
                  <td className="px-3 py-2" style={{ color: '#4ade80' }}>{m.name}</td>
                  <td className="px-3 py-2" style={{ color: '#e6edf3' }}>{m.details?.family ?? '—'}</td>
                  <td className="px-3 py-2" style={{ color: '#8b949e' }}>{m.details?.parameter_size ?? '—'}</td>
                  <td className="px-3 py-2" style={{ color: '#fbbf24' }}>{m.details?.quantization_level ?? '—'}</td>
                  <td className="px-3 py-2 text-right" style={{ color: '#8b949e' }}>{fmtSize(m.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
