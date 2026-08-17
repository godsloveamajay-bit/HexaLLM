import { useEffect, useState, useCallback } from 'react'
import { FileText, RefreshCw, Search } from 'lucide-react'
import { api } from '../lib/api'

const UNITS = ['hexallm-backend', 'hexallm-vllm', 'ollama', 'hexallm-tunnel', 'hexallm-dev']

type LogData = { unit: string; lines: number; entries: string[]; error?: string }

const fmtLine = (line: string) => {
  const m = line.match(/^([\dT:.+-]+) (\w+) (\w+)(?:\]?.*?)(\s+(?:INFO|ERROR|WARNING|WARN|DEBUG|CRITICAL|FATAL)[: ]?)?/)
  if (!m) return { ts: null, level: null, rest: line }
  const level = m[4]?.trim().split(' ')[0] || null
  const rest = line.slice(m[0].length).replace(/^\]?\s*/, '')
  return { ts: m[1], level, rest: rest || line }
}

export default function Logs() {
  const [unit, setUnit] = useState(UNITS[0])
  const [lines, setLines] = useState(300)
  const [q, setQ] = useState('')
  const [data, setData] = useState<LogData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api.get('/dev/logs', { params: { unit, lines, q: q.trim() }, timeout: 15000 })
      setData(r.data)
      setError(r.data?.error || null)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'failed')
    }
  }, [unit, lines, q])

  useEffect(() => {
    load()
    if (paused) return
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [load, paused])

  const levelColor = (lvl: string | null) => {
    if (!lvl) return '#8b949e'
    if (lvl.includes('ERROR') || lvl.includes('CRITICAL') || lvl.includes('FATAL')) return '#f87171'
    if (lvl.includes('WARN')) return '#fbbf24'
    if (lvl.includes('DEBUG')) return '#60a5fa'
    return '#4ade80'
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <FileText size={18} style={{ color: '#4ade80' }} />
        <div className="flex-1">
          <h1 className="font-mono font-bold text-lg" style={{ color: '#e6edf3' }}>live logs</h1>
          <p className="font-mono text-xs" style={{ color: '#8b949e' }}>
            journalctl tail — {data ? `${data.lines} lines` : 'loading'} · auto-refresh 6s {paused && '· paused'}
          </p>
        </div>
        <button
          onClick={() => setPaused((p) => !p)}
          className="font-mono text-xs px-2 py-1 rounded border transition-colors"
          style={paused ? { color: '#fbbf24', borderColor: 'rgba(251,191,36,0.4)' } : { color: '#8b949e', borderColor: '#30363d' }}
        >
          {paused ? 'resume' : 'pause'}
        </button>
        <button
          onClick={load}
          className="flex items-center gap-1.5 font-mono text-xs px-2 py-1 rounded border transition-colors hover:bg-[#161b22]"
          style={{ borderColor: '#30363d', color: '#8b949e' }}
        >
          <RefreshCw size={12} /> refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {UNITS.map((u) => (
          <button
            key={u}
            onClick={() => setUnit(u)}
            className="font-mono text-[11px] px-2 py-1 rounded border transition-colors"
            style={
              unit === u
                ? { color: '#4ade80', borderColor: 'rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.08)' }
                : { color: '#8b949e', borderColor: '#30363d', background: 'transparent' }
            }
          >
            {u}
          </button>
        ))}
        <select
          value={lines}
          onChange={(e) => setLines(Number(e.target.value))}
          className="font-mono text-[11px] px-1.5 py-1 rounded border"
          style={{ color: '#8b949e', borderColor: '#30363d', background: '#0d1117' }}
        >
          {[100, 300, 500, 1000].map((n) => (
            <option key={n} value={n}>{n} lines</option>
          ))}
        </select>
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: '#6e7681' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="filter (enter)…"
            className="font-mono text-[11px] pl-7 pr-2 py-1 rounded border w-44"
            style={{ color: '#e6edf3', borderColor: '#30363d', background: '#0d1117' }}
          />
        </div>
      </div>

      {error && (
        <div className="font-mono text-[11px] mb-3 p-2 rounded border" style={{ color: 'rgba(248,113,113,0.85)', borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.05)' }}>
          {error}
        </div>
      )}

      <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#30363d', background: '#0d1117' }}>
        <div className="max-h-[70vh] overflow-y-auto py-1">
          {data?.entries.map((line, i) => {
            const { ts, level, rest } = fmtLine(line)
            return (
              <div key={`${ts}-${i}`} className="flex font-mono text-[11px] leading-relaxed px-2 whitespace-pre-wrap break-all hover:bg-[#161b22]">
                <span className="flex-shrink-0 pr-2 select-none" style={{ color: '#30363d' }}>
                  {ts ? `${ts} ` : '— '}
                </span>
                <span className="flex-shrink-0 pr-2 select-none" style={{ color: levelColor(level) }}>
                  {level ? `${level} ` : ''}
                </span>
                <span style={{ color: '#8b949e' }}>{rest}</span>
              </div>
            )
          })}
          {data && !data.entries.length && (
            <div className="px-3 py-6 font-mono text-xs text-center" style={{ color: '#6e7681' }}>no log lines{q ? ' match filter' : ''}</div>
          )}
        </div>
      </div>
    </div>
  )
}