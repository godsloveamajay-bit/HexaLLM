import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../lib/api'
import { Gauge, RefreshCw, Cpu, MemoryStick, HardDrive, Thermometer, Zap, Activity } from 'lucide-react'
import { useAuth } from '../store/auth'

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
type Service = { unit: string; active: boolean; since?: string; pid?: string }
type SystemData = {
  fetched_at: string
  host: Host
  gpu: Gpu[]
  services: Service[]
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
  const { user, token } = useAuth()
  const [data, setData] = useState<SystemData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [polling, setPolling] = useState(false)
  const [intervalRef, setIntervalRef] = useState<ReturnType<typeof setInterval> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await api.get('/dev/system', { timeout: 20000 })
      setData(r.data)
      setError(null)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'failed')
    }
  }, [])

  const startPolling = useCallback(() => {
    if (intervalRef) clearInterval(intervalRef)
    const t = setInterval(load, 5000)
    setIntervalRef(t)
    setPolling(true)
  }, [load])

  const stopPolling = useCallback(() => {
    if (intervalRef) {
      clearInterval(intervalRef)
      setIntervalRef(null)
    }
    setPolling(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // WebSocket connection — pushes system stats ~every 3s; falls back to polling
  useEffect(() => {
    if (!token) return

    try {
      wsRef.current = new WebSocket(`wss://dev.hexallm.co.uk/api/v1/dev/ws/system?token=${token}`)
    } catch (e) {
      setPolling(true)
      return
    }

    wsRef.current.onopen = () => {
      setWsConnected(true)
      stopPolling()
    }

    wsRef.current.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.fetched_at) {
          setData(msg)
          setError(null)
        }
      } catch (e) {
        // ignore malformed messages
      }
    }

    wsRef.current.onclose = () => {
      setWsConnected(false)
      const ft = setTimeout(() => setPolling(true), 3000)
      return () => clearTimeout(ft)
    }

    wsRef.current.onerror = () => {
      setWsConnected(false)
      const ft = setTimeout(() => setPolling(true), 3000)
      return () => clearTimeout(ft)
    }

    return () => {
      wsRef.current?.close()
    }
  }, [token])

  // Keep polling state in sync
  useEffect(() => {
    if (polling && !intervalRef) startPolling()
    if (!polling && intervalRef) stopPolling()
  }, [polling])

  const h = data?.host

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Gauge size={18} style={{ color: '#4ade80' }} />
        <div className="flex-1">
          <h1 className="font-mono font-bold text-lg" style={{ color: '#e6edf3' }}>system monitor</h1>
          <p className="font-mono text-xs" style={{ color: '#8b949e' }}>
            host · gpu · engines · processes {wsConnected ? '· WS' : ''} {polling && '· polling'} {data && <span className="ml-2" style={{ color: '#6e7681' }}>· {new Date(data.fetched_at).toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              wsRef.current?.close()
              setPolling(false)
              setWsConnected(false)
              setData(null)
              setError(null)
            }}
            className="flex items-center gap-1.5 font-mono text-xs px-2 py-1 rounded border transition-colors hover:bg-[#161b22]"
            style={{ borderColor: '#30363d', color: '#8b949e' }}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15l-5-5l-5 5H5l5 5l5-5z"/>
              <path d="M18 6l6 6m0 0l-6 6m6-6H3"/>
            </svg>
            disconnect WS
          </button>
          {polling && (
            <button
              onClick={() => stopPolling()}
              className="flex items-center gap-1.5 font-mono text-xs px-2 py-1 rounded border transition-colors hover:bg-[#161b22]"
              style={{ borderColor: '#30363d', color: '#8b949e' }}
            >
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="m16 12-4 4-4-4"/>
              </svg>
              stop polling
            </button>
          )}
          {!polling && (
            <button
              onClick={load}
              className="flex items-center gap-1.5 font-mono text-xs px-2 py-1 rounded border transition-colors hover:bg-[#161b22]"
              style={{ borderColor: '#30363d', color: '#8b949e' }}
            >
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1={12} y1={1} x2={12} y2={7}/>
                <line x1={12} y1={5} x2={12} y2={9}/>
                <line x1={4.23} y1={15.23} x2={5.64} y2={17.77}/>
                <line x1={19.77} y1={5.64} x2={18.23} y2={4.23}/>
                <line x1={12} y1={19} x2={12} y2={23}/>
                <line x1={5.64} y1={17.77} x2={4.23} y2={15.23}/>
                <line x1={18.23} y1={4.23} x2={19.77} y2={5.64}/>
                <line x1={12} y1={7} x2={12} y2={1}/>
              </svg>
              refresh
            </button>
          )}
        </div>
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
            <div className="px-3 py-2 border-t font-mono text-xs font-semibold" style={{ borderColor: '#30363d', color: '#8b949e' }}>
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

      {error && <div className="fixed bottom-4 right-4 font-mono text-[11px] px-2 py-1 rounded" style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}>API unreachable — retrying…</div>}
    </div>
  )
}