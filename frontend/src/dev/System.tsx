import { useEffect, useState, useCallback } from 'react'
import { Gauge, RefreshCw, Cpu, MemoryStick, HardDrive, Thermometer, Zap, Activity } from 'lucide-react'
import { api } from '../lib/api'

type Host = {
  cpu_percent: number
  cpu_count: number
  load_avg: number[]
  mem: { total: number; used: number; percent: number }
  disk: { total: number; used: number; percent: number }
  uptime_sec: number
  hostname: string
  processes: { pid: number; name: string; cpu_percent: number; mem_mb: number; cmd: string }[]
}
type Gpu = {
  index: number
  name: string
  mem_total_mb: number
  mem_used_mb: number
  mem_free_mb: number
  util_percent: number
  mem_util_percent: number
  temp_c: number
  power_w: number
  power_limit_w: number
}
type SystemData = {
  fetched_at: string
  host: Host
  gpu: Gpu[]
  services: { unit: string; active: boolean; since?: string; pid?: string }[]
  ollama: { ok: boolean; models?: string[]; detail?: string }
  vllm: { ok: boolean; status?: number; model?: string | null; detail?: string }
}

const fmtBytes = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : `${(n / (1 << 20)).toFixed(0)} MB`)
const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

function Bar({ pct, color = '#4ade80' }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#0d1117' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, ok = true }: { icon: any; label: string; value: string; sub?: string; ok?: boolean }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: '#30363d', background: '#161b22' }}>
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest mb-1.5" style={{ color: '#8b949e' }}>
        <Icon size={11} /> {label}
      </div>
      <div className="font-mono text-lg font-bold" style={{ color: ok ? '#e6edf3' : '#f87171' }}>
        {value}
      </div>
      {sub && <div className="font-mono text-[10px] mt-0.5" style={{ color: '#6e7681' }}>{sub}</div>}
    </div>
  )
}

export default function System() {
  const [data, setData] = useState<SystemData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api.get('/dev/system', { timeout: 20000 })
      setData(r.data)
      setError(null)
      setStale(false)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'failed')
      setStale(true)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  const h = data?.host

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Gauge size={18} style={{ color: '#4ade80' }} />
        <div className="flex-1">
          <h1 className="font-mono font-bold text-lg" style={{ color: '#e6edf3' }}>system monitor</h1>
          <p className="font-mono text-xs" style={{ color: '#8b949e' }}>
            host · gpu · engines · processes — polled every 5s
            {data && <span className="ml-2" style={{ color: '#6e7681' }}>· {new Date(data.fetched_at).toLocaleTimeString()}</span>}
          </p>
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
        <div className="font-mono text-[11px] mb-4 p-2 rounded border" style={{ color: 'rgba(248,113,113,0.85)', borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.05)' }}>
          {error}
        </div>
      )}

      {h && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Kpi icon={Cpu} label="cpu" value={`${h.cpu_percent}%`} sub={`${h.cpu_count} cores · load ${h.load_avg.map((l) => l.toFixed(2)).join(' / ')}`} />
            <Kpi icon={MemoryStick} label="ram" value={`${h.mem.percent}%`} sub={`${fmtBytes(h.mem.used)} / ${fmtBytes(h.mem.total)}`} />
            <Kpi icon={HardDrive} label="disk" value={`${h.disk.percent}%`} sub={`${fmtBytes(h.disk.used)} / ${fmtBytes(h.disk.total)}`} />
            <Kpi icon={Activity} label="uptime" value={fmtUptime(h.uptime_sec)} sub={h.hostname} />
          </div>

          <div className="rounded-lg border p-3 mb-4" style={{ borderColor: '#30363d', background: '#161b22' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-xs font-semibold" style={{ color: '#e6edf3' }}>gpu</span>
              <div className="flex items-center gap-3 font-mono text-[10px]" style={{ color: '#8b949e' }}>
                <span className="flex items-center gap-1"><Thermometer size={10} style={{ color: '#fbbf24' }} /> {data?.gpu?.[0]?.temp_c ?? '—'}°C</span>
                <span className="flex items-center gap-1"><Zap size={10} style={{ color: '#fbbf24' }} /> {data?.gpu?.[0]?.power_w ?? '—'} W</span>
              </div>
            </div>
            {data?.gpu?.length ? (
              data.gpu.map((g) => (
                <div key={g.index} className="mb-3 last:mb-0">
                  <div className="flex justify-between font-mono text-[11px] mb-1">
                    <span style={{ color: '#e6edf3' }}>{g.name} <span className="text-[10px]" style={{ color: '#6e7681' }}>· GPU {g.index}</span></span>
                    <span style={{ color: '#8b949e' }}>{fmtBytes(g.mem_used_mb * 1e6)} / {fmtBytes(g.mem_total_mb * 1e6)} VRAM</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1"><Bar pct={g.mem_util_percent} /></div>
                    <span className="font-mono text-[11px] w-24 text-right" style={{ color: '#8b949e' }}>{g.mem_util_percent}% vram</span>
                    <span className="font-mono text-[11px] w-20 text-right" style={{ color: g.util_percent > 60 ? '#fbbf24' : '#4ade80' }}>{g.util_percent}% util</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="font-mono text-xs py-2" style={{ color: '#8b949e' }}>no nvidia-smi output</div>
            )}
          </div>

          <div className="rounded-lg border overflow-hidden mb-4" style={{ borderColor: '#30363d', background: '#161b22' }}>
            <div className="px-3 py-2 border-b font-mono text-xs font-semibold" style={{ borderColor: '#30363d', color: '#e6edf3' }}>services</div>
            <table className="w-full text-left font-mono text-[12px]">
              <tbody>
                {data?.services.map((s) => (
                  <tr key={s.unit} className="border-b last:border-0" style={{ borderColor: '#30363d' }}>
                    <td className="px-3 py-2" style={{ color: '#e6edf3' }}>
                      <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: s.active ? '#4ade80' : 'rgba(248,113,113,0.6)' }} />
                      {s.unit}
                    </td>
                    <td className="px-3 py-2 text-right" style={{ color: s.active ? '#4ade80' : '#f87171' }}>{s.active ? 'active' : 'down'}</td>
                    <td className="px-3 py-2 text-right text-[11px]" style={{ color: '#6e7681' }}>{s.pid ? `pid ${s.pid}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2 border-t font-mono text-[11px]" style={{ borderColor: '#30363d', color: '#8b949e' }}>
              ollama: {data?.ollama?.ok ? `connected · ${data.ollama.models?.length ?? '?'} models` : `down · ${data?.ollama?.detail ?? '?'}`}
              <span className="mx-2" style={{ color: '#30363d' }}>|</span>
              vllm: {data?.vllm?.ok ? `healthy · ${data.vllm.model ?? '?'}` : `down · ${data?.vllm?.detail ?? '?'}`}
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#30363d', background: '#161b22' }}>
            <div className="px-3 py-2 border-b font-mono text-xs font-semibold" style={{ borderColor: '#30363d', color: '#e6edf3' }}>processes</div>
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr style={{ color: '#6e7681' }}>
                  <th className="px-3 py-1.5 font-normal">pid</th>
                  <th className="px-3 py-1.5 font-normal">name</th>
                  <th className="px-3 py-1.5 font-normal text-right">cpu%</th>
                  <th className="px-3 py-1.5 font-normal text-right">mem</th>
                  <th className="px-3 py-1.5 font-normal">cmd</th>
                </tr>
              </thead>
              <tbody>
                {h.processes.map((p) => (
                  <tr key={p.pid} className="border-b last:border-0" style={{ borderColor: '#30363d' }}>
                    <td className="px-3 py-1.5" style={{ color: '#6e7681' }}>{p.pid}</td>
                    <td className="px-3 py-1.5" style={{ color: '#e6edf3' }}>{p.name}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: p.cpu_percent > 50 ? '#fbbf24' : '#8b949e' }}>{p.cpu_percent}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: '#8b949e' }}>{p.mem_mb} MB</td>
                    <td className="px-3 py-1.5 truncate max-w-[420px]" style={{ color: '#6e7681' }}>{p.cmd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !error && (
        <div className="flex items-center justify-center py-20">
          <div className="w-5 h-5 border-2 border-[#4ade80] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {stale && <div className="fixed bottom-4 right-4 font-mono text-[11px] px-2 py-1 rounded" style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}>API unreachable — retrying…</div>}
    </div>
  )
}