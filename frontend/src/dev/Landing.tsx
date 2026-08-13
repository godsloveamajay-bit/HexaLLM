import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FlaskConical, FolderKanban, Braces, Server, Activity, TerminalSquare, ArrowRight } from 'lucide-react'
import { useAuth } from '../store/auth'
import { baseURL } from '../lib/api'

const TOOLS = [
  { to: '/playground', icon: FlaskConical, name: 'playground', desc: 'raw model access — params, streaming, timings', hint: 'POST /chat/completions' },
  { to: '/workspaces', icon: FolderKanban, name: 'workspaces', desc: 'presets, requests and scoped keys per project', hint: 'persisted on the backend' },
  { to: '/api', icon: Braces, name: 'api explorer', desc: 'hit endpoints directly, read raw JSON responses', hint: 'curl generator built in' },
  { to: '/models', icon: Server, name: 'live models', desc: 'the ollama registry on the host, live-polled', hint: 'size · quant · family' },
]

type Health = { status?: string; version?: string; ollama?: string }

export default function Landing() {
  const { user } = useAuth()
  const [health, setHealth] = useState<Health | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  const [variantCount, setVariantCount] = useState<number | null>(null)
  const [rawCount, setRawCount] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const t0 = performance.now()
      try {
        const h = await fetch(`${baseURL}/health`)
        const d: Health = await h.json()
        if (!alive) return
        setHealth(d)
        setLatency(Math.round(performance.now() - t0))
        const v = await (await fetch(`${baseURL}/models/hexallm/variants`)).json()
        setVariantCount((Array.isArray(v) ? v : v.variants ?? []).length)
        const m = await (await fetch(`${baseURL}/models/ollama`)).json()
        setRawCount(m.models?.length ?? 0)
      } catch {
        if (alive) setHealth({ status: 'down' })
      }
    }
    load()
    const t = setInterval(load, 8000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const ok = health?.ollama === 'connected'

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      {/* ── Hero ── */}
      <div className="rounded-lg border p-6 md:p-10 mb-4 relative overflow-hidden" style={{ borderColor: '#30363d', background: '#010409' }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(600px 200px at 20% 0%, rgba(74,222,128,0.08), transparent)' }}
        />
        <div className="relative">
          <div className="flex items-center gap-2 font-mono text-xs mb-4" style={{ color: '#8b949e' }}>
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: ok ? '#4ade80' : 'rgba(248,113,113,0.6)' }} />
            {ok ? 'backend online — ollama connected' : 'backend unreachable'}
            {health?.version && <span>· v{health.version}</span>}
            {latency !== null && <span>· {latency} ms</span>}
          </div>
          <h1 className="font-mono font-bold text-3xl md:text-5xl tracking-tight mb-3" style={{ color: '#e6edf3' }}>
            HEXA<span style={{ color: '#4ade80' }}>DEV</span>
          </h1>
          <p className="font-mono text-sm md:text-base max-w-2xl leading-relaxed mb-6" style={{ color: '#8b949e' }}>
            the developer environment behind the HexaLLM platform.
            <br />
            raw model access, the live API, and the guts of the inference host — no consumer gloss.
          </p>
          <div className="flex flex-wrap items-center gap-3 font-mono text-sm">
            <Link
              to="/playground"
              className="flex items-center gap-2 px-4 py-2.5 rounded font-bold transition-transform hover:translate-y-[-1px]"
              style={{ background: '#4ade80', color: '#0d1117' }}
            >
              open playground <ArrowRight size={15} />
            </Link>
            <Link
              to="/workspaces"
              className="flex items-center gap-2 px-4 py-2.5 rounded border transition-colors hover:bg-[#161b22]"
              style={{ borderColor: '#30363d', color: '#e6edf3' }}
            >
              <FolderKanban size={15} /> create a workspace
            </Link>
            <span className="text-xs" style={{ color: '#6e7681' }}>
              {user ? `signed in as ${user.email || user.username}` : 'guests get limited access — sign in for full tools'}
            </span>
          </div>
        </div>
      </div>

      {/* ── System strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'virtual models', value: variantCount !== null ? String(variantCount) : '…', tone: '#4ade80' },
          { label: 'raw ollama models', value: rawCount !== null ? String(rawCount) : '…', tone: '#fbbf24' },
          { label: 'api latency', value: latency !== null ? `${latency} ms` : '…', tone: '#e6edf3' },
          { label: 'environment', value: 'DEV · vite', tone: '#fbbf24' },
        ].map((k) => (
          <div key={k.label} className="rounded-lg border p-3" style={{ borderColor: '#30363d', background: '#161b22' }}>
            <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: '#8b949e' }}>{k.label}</div>
            <div className="font-mono text-lg font-bold" style={{ color: k.tone }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Tool cards ── */}
      <div className="grid md:grid-cols-2 gap-3 mb-6">
        {TOOLS.map(({ to, icon: Icon, name, desc, hint }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-lg border p-4 transition-colors hover:bg-[#161b22]"
            style={{ borderColor: '#30363d', background: '#010409' }}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <Icon size={16} style={{ color: '#4ade80' }} />
              <span className="font-mono font-bold" style={{ color: '#e6edf3' }}>{name}</span>
              <ArrowRight size={13} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#4ade80' }} />
            </div>
            <div className="font-mono text-xs mb-2" style={{ color: '#8b949e' }}>{desc}</div>
            <div className="font-mono text-[10px] px-1.5 py-0.5 rounded inline-block" style={{ color: '#6e7681', background: '#0d1117', border: '1px solid #21262d' }}>
              {hint}
            </div>
          </Link>
        ))}
      </div>

      {/* ── Quick start ── */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#30363d', background: '#161b22' }}>
        <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: '#30363d' }}>
          <span className="font-mono text-xs font-semibold" style={{ color: '#e6edf3' }}>quick start — talk to a model in one shot</span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ color: '#8b949e', background: '#0d1117' }}>base url: {baseURL}</span>
        </div>
        <pre className="font-mono text-xs p-4 overflow-x-auto leading-relaxed" style={{ color: '#4ade80', background: '#0d1117' }}>
{`# streaming chat against a virtual model
curl -N ${baseURL}/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"hex-4.2-turbo","messages":[{"role":"user","content":"what can you do?"}],"stream":true}'

# add your key (create one under workspaces)
#   -H "Authorization: Bearer $HEXA_KEY"`}
        </pre>
      </div>
    </div>
  )
}