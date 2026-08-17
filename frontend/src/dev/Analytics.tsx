import { useEffect, useState, useCallback } from 'react'
import { BarChart2, RefreshCw, AlertTriangle } from 'lucide-react'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { api } from '../lib/api'

type AnalyticsData = {
  hours: number
  totals: {
    requests: number
    errors: number
    error_rate: number
    tokens: number
    avg_latency_ms: number | null
    avg_ok_latency_ms: number | null
  }
  per_model: { model: string; requests: number; tokens: number; avg_latency_ms: number | null; errors: number }[]
  endpoints: { endpoint: string; requests: number }[]
  hourly: { hour: string; requests: number; tokens: number; errors: number }[]
}

const fmtMs = (ms: number | null) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`)
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [hours, setHours] = useState(24)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (h: number) => {
    try {
      const r = await api.get('/dev/analytics', { params: { hours: h }, timeout: 15000 })
      setData(r.data)
      setError(null)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'failed')
    }
  }, [])

  useEffect(() => {
    load(hours)
  }, [hours, load])

  const t = data?.totals

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <BarChart2 size={18} style={{ color: '#4ade80' }} />
        <div className="flex-1">
          <h1 className="font-mono font-bold text-lg" style={{ color: '#e6edf3' }}>request analytics</h1>
          <p className="font-mono text-xs" style={{ color: '#8b949e' }}>traffic from request_logs — requests, tokens, latency, errors</p>
        </div>
        <div className="flex items-center gap-1 font-mono text-xs">
          {[24, 72, 168].map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className="px-2 py-1 rounded border transition-colors"
              style={
                hours === h
                  ? { color: '#4ade80', borderColor: 'rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.08)' }
                  : { color: '#8b949e', borderColor: '#30363d', background: 'transparent' }
              }
            >
              {h < 24 ? `${h}h` : h < 168 ? `${h / 24}d` : '7d'}
            </button>
          ))}
          <button
            onClick={() => load(hours)}
            className="flex items-center gap-1.5 ml-1 px-2 py-1 rounded border transition-colors hover:bg-[#161b22]"
            style={{ borderColor: '#30363d', color: '#8b949e' }}
          >
            <RefreshCw size={12} /> refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="font-mono text-[11px] mb-4 p-2 rounded border" style={{ color: 'rgba(248,113,113,0.85)', borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.05)' }}>
          {error}
        </div>
      )}

      {data && t && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'requests', value: String(t.requests), sub: `last ${data.hours}h` },
              { label: 'tokens', value: fmtK(t.tokens), sub: `${t.tokens.toLocaleString()} total` },
              { label: 'errors', value: String(t.errors), sub: `${t.error_rate}% of traffic`, ok: t.error_rate < 5 },
              { label: 'avg latency', value: fmtMs(t.avg_ok_latency_ms), sub: 'successful requests' },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border p-3" style={{ borderColor: '#30363d', background: '#161b22' }}>
                <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: '#8b949e' }}>{k.label}</div>
                <div className="font-mono text-lg font-bold" style={{ color: k.ok === false ? '#f87171' : '#e6edf3' }}>{k.value}</div>
                <div className="font-mono text-[10px] mt-0.5" style={{ color: '#6e7681' }}>{k.sub}</div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border p-3 mb-4" style={{ borderColor: '#30363d', background: '#161b22' }}>
            <div className="font-mono text-xs font-semibold mb-2" style={{ color: '#e6edf3' }}>requests per hour</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.hourly}>
                  <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6e7681' }} interval={3} />
                  <YAxis tick={{ fontSize: 10, fill: '#6e7681' }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#6e7681' }} />
                  <Tooltip
                    contentStyle={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, fontSize: 11, fontFamily: 'monospace' }}
                    labelStyle={{ color: '#e6edf3' }}
                  />
                  <Bar dataKey="requests" fill="rgba(74,222,128,0.55)" name="requests" />
                  <Area yAxisId="right" dataKey="tokens" fill="rgba(251,191,36,0.15)" stroke="#fbbf24" name="tokens" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden mb-4" style={{ borderColor: '#30363d', background: '#161b22' }}>
            <div className="px-3 py-2 border-b font-mono text-xs font-semibold" style={{ borderColor: '#30363d', color: '#e6edf3' }}>by model</div>
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr style={{ color: '#6e7681' }}>
                  <th className="px-3 py-1.5 font-normal">model</th>
                  <th className="px-3 py-1.5 font-normal text-right">requests</th>
                  <th className="px-3 py-1.5 font-normal text-right">tokens</th>
                  <th className="px-3 py-1.5 font-normal text-right">avg latency</th>
                  <th className="px-3 py-1.5 font-normal text-right">errors</th>
                </tr>
              </thead>
              <tbody>
                {data.per_model.map((m) => (
                  <tr key={m.model} className="border-b last:border-0" style={{ borderColor: '#30363d' }}>
                    <td className="px-3 py-1.5" style={{ color: '#e6edf3' }}>{m.model}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: '#8b949e' }}>{m.requests}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: '#8b949e' }}>{m.tokens.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: '#8b949e' }}>{fmtMs(m.avg_latency_ms)}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: m.errors > 0 ? '#f87171' : '#4ade80' }}>{m.errors}</td>
                  </tr>
                ))}
                {!data.per_model.length && (
                  <tr><td className="px-3 py-3" colSpan={5} style={{ color: '#6e7681' }}>no requests in this window</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#30363d', background: '#161b22' }}>
            <div className="px-3 py-2 border-b font-mono text-xs font-semibold" style={{ borderColor: '#30363d', color: '#e6edf3' }}>top endpoints</div>
            <table className="w-full text-left font-mono text-[11px]">
              <tbody>
                {data.endpoints.map((e) => (
                  <tr key={e.endpoint} className="border-b last:border-0" style={{ borderColor: '#30363d' }}>
                    <td className="px-3 py-1.5" style={{ color: '#e6edf3' }}>{e.endpoint}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: '#8b949e' }}>{e.requests}</td>
                    <td className="px-3 py-1.5 w-40">
                      <div className="h-1 rounded-full overflow-hidden ml-auto" style={{ background: '#0d1117' }}>
                        <div className="h-full" style={{ width: `${(e.requests / (data.endpoints[0]?.requests || 1)) * 100}%`, background: '#4ade80' }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totals.errors > 0 && (
            <div className="mt-3 font-mono text-[11px] flex items-center gap-1.5" style={{ color: 'rgba(248,113,113,0.85)' }}>
              <AlertTriangle size={12} /> {data.totals.errors} error responses in the last {data.hours}h — check the logs page.
            </div>
          )}
        </>
      )}

      {!data && !error && (
        <div className="flex items-center justify-center py-20">
          <div className="w-5 h-5 border-2 border-[#4ade80] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}